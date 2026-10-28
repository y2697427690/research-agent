"""arXiv 检索与入库。

为什么用 arxiv 这个库、而不是手写 Atom 解析
------------------------------------------------------------------------
arXiv 官方 API 返回 Atom XML：条目里有十几个命名空间下的字段
（primary_category、comment、journal_ref、多个 link…），
手写解析要处理命名空间、分页、重试与限速，代码量与出错面都不小。
这个库已经处理好这些，也是项目技术栈里原有的依赖（arxiv 4.0.1）。
本模块只补两件它不管的事：
  1. 查询语句的构造（用户随手输入的中文式关键词要变成可用查询）
  2. 网络失败与「零结果」的兜底

关于速率限制
------------------------------------------------------------------------
arXiv 官方要求客户端两次请求间隔不少于 3 秒，否则可能被限流甚至短暂封禁。
所以这里显式设置 delay_seconds=3.0；「零结果后放宽查询」的第二次请求
也必须先 sleep，不能立刻发。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import anyio
import arxiv
import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

# 单次检索的整体超时。arxiv 库本身不暴露 timeout 参数，
# 所以用 anyio.fail_after 在外层兜住「网络卡住」的情况。
_SEARCH_TIMEOUT = 30.0

# arXiv 官方要求的最小请求间隔（秒）
_DELAY_SECONDS = 3.0

# 允许返回的最大条数：再多也没有意义，反而拖慢页面
MAX_RESULTS_LIMIT = 25

# arXiv 查询语法里的字段前缀与运算符。
# 用户自己写了这些，就原样传给 arXiv，不再替它加引号。
_QUERY_SYNTAX = re.compile(r"\b(ti|au|abs|all|cat|co|jr|rn|id):|\b(AND|OR|NOT)\b", re.I)


@dataclass
class ArxivItem:
    """一条 arXiv 检索结果，字段与前端卡片一一对应。"""

    arxiv_id: str                 # 去掉版本号的编号，如 1706.03762
    version: str | None           # 版本号，如 v5（入库时用于去重判定）
    title: str
    authors: list[str] = field(default_factory=list)
    summary: str = ""             # 摘要（arXiv 给的是整段，前端截断显示）
    published: str | None = None  # 首发日期 YYYY-MM-DD
    updated: str | None = None
    primary_category: str | None = None
    categories: list[str] = field(default_factory=list)
    comment: str | None = None    # 作者备注，常含「已被 XX 会议接收」
    pdf_url: str = ""
    abs_url: str = ""
    withdrawn: bool = False       # arXiv 已撤稿：没有 PDF，不允许入库


def build_query(raw: str) -> tuple[str, bool]:
    """把用户输入变成 arXiv 查询语句。

    返回 (查询语句, 是否由我们加了引号)。

    为什么要加引号：实测 `all:layer normalization` 会混进大量物理论文，
    而 `all:"layer normalization"` 的第一条就是《Layer Normalization》。
    arXiv 的检索器在有引号时按短语匹配，精度高得多。
    但短语过于严格，所以调用方在零结果时可以用未加引号的版本重试。
    """
    q = (raw or "").strip()
    if not q:
        return "", False
    # 用户已经写了 arXiv 语法或引号 → 尊重原样
    if _QUERY_SYNTAX.search(q) or '"' in q:
        return q, False
    if " " in q:
        return f'all:"{q}"', True
    return f"all:{q}", False


def build_fallback_query(raw: str) -> str:
    """零结果时用的宽松查询：同样走 all 字段，但不要求是连续短语。"""
    q = (raw or "").strip()
    if _QUERY_SYNTAX.search(q) or '"' in q:
        return q
    return f"all:{q}"


def _is_withdrawn(summary: str | None, comment: str | None) -> bool:
    """判断是否已被 arXiv 撤稿。

    arXiv 的惯例是撤稿论文把摘要替换成一句说明，常见写法：
      "This submission has been withdrawn by arXiv administrators…"
      "This paper has been withdrawn by the author…"
    这类论文没有 PDF，点「入库」只会得到一个 404。
    在检索结果里提前标出来，比让用户等一次失败的下载更好。
    """
    text = f"{summary or ''} {comment or ''}".lower()
    return "withdrawn" in text


def _to_item(result: arxiv.Result) -> ArxivItem:
    """把 arxiv.Result 转成我们自己的结构。

    get_short_id() 返回带版本号的形如 1706.03762v5；
    拆开保存：编号用于与库内论文匹配（去重、引用），版本号用于「谁更新」。
    """
    short = result.get_short_id() or ""
    match = re.match(r"(?P<id>[^v]+)(?P<ver>v\d+)?$", short)
    arxiv_id = match.group("id") if match else short
    version = match.group("ver") if match else None

    def day(value) -> str | None:
        return value.date().isoformat() if value else None

    summary = (result.summary or "").strip()
    comment = (result.comment or None)

    return ArxivItem(
        arxiv_id=arxiv_id,
        version=version,
        title=(result.title or "").strip(),
        authors=[a.name for a in (result.authors or [])][:20],
        summary=summary,
        published=day(result.published),
        updated=day(result.updated),
        primary_category=result.primary_category,
        categories=list(result.categories or []),
        comment=comment,
        withdrawn=_is_withdrawn(summary, comment),
        pdf_url=result.pdf_url or "",
        abs_url=result.entry_id or "",
    )


def _search_sync(query: str, max_results: int, sort: str) -> list[ArxivItem]:
    """同步执行检索（arxiv 库是同步的，调用方会用线程包起来）。"""
    client = arxiv.Client(
        page_size=max_results,
        delay_seconds=_DELAY_SECONDS,
        num_retries=2,
    )
    criterion = (
        arxiv.SortCriterion.SubmittedDate
        if sort == "recent"
        else arxiv.SortCriterion.Relevance
    )
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=criterion,
    )
    return [_to_item(r) for r in client.results(search)]


async def search(
    raw_query: str,
    max_results: int = 10,
    sort: str = "relevance",
) -> list[ArxivItem]:
    """按关键词检索 arXiv。

    两次尝试的编排：
      第一次用短语查询（精度高）；
      零结果且我们确实加过引号时，等满 3 秒再用宽松查询试一次。

    为什么把同步库放进线程：arxiv 的 Client 用的是阻塞式 http 请求，
    直接在事件循环里跑会把整个服务卡住（FastAPI 是异步框架，
    一个阻塞调用会让其它请求一起等）。
    """
    query, quoted = build_query(raw_query)
    if not query:
        return []
    limit = max(1, min(int(max_results or 10), MAX_RESULTS_LIMIT))

    items = await anyio.to_thread.run_sync(
        lambda: _search_sync(query, limit, sort)
    )
    if items or not quoted:
        return items

    # 短语太严导致零结果：等满限速间隔后用宽松查询重试一次
    logger.info("arXiv 短语查询无结果，放宽重试: %s", query)
    await anyio.sleep(_DELAY_SECONDS)
    fallback = build_fallback_query(raw_query)
    return await anyio.to_thread.run_sync(
        lambda: _search_sync(fallback, limit, sort)
    )


def _pdf_candidates(arxiv_id: str) -> list[str]:
    """下载 PDF 时依次尝试的编号。

    先试带版本号的（用户看到的就是这一版），再试不带版本号的：
    少数旧论文只保留无版本号入口；被撤稿的论文两者都 404，
    由调用方给出「可能已被撤稿」的提示。
    """
    aid = (arxiv_id or "").strip()
    bare = re.sub(r"v\d+$", "", aid)
    return [aid] if bare == aid else [aid, bare]


async def download_pdf(arxiv_id: str, max_mb: int = 60) -> bytes:
    """下载某篇论文的 PDF 原文。

    为什么不直接存 arXiv 给的 pdf_url：
    那个 URL 带版本号（…/pdf/1706.03762v5），而入库时要按编号去重，
    统一用 https://arxiv.org/pdf/<编号> 让 arXiv 返回最新版本，
    文件名也由调用方按编号生成，便于后续 extract_arxiv_id 识别。

    关于带版本号失败的情况：
    被撤稿的论文（arXiv 上标注 withdrawn）没有 PDF，带版本号会 404；
    少数旧论文只保留无版本号的入口。所以 vN 失败后会用不带版本号再试一次。
    """
    aid = (arxiv_id or "").strip()
    if not re.match(r"^[a-zA-Z0-9.\-/_]+$", aid):
        raise ValueError(f"非法的 arXiv 编号: {aid}")

    candidates = _pdf_candidates(aid)

    limit = max_mb * 1024 * 1024
    last_error: Exception | None = None
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(90.0, connect=15.0),
        headers={"User-Agent": "research-agent/0.1 (arxiv ingest)"},
    ) as client:
        for candidate in candidates:
            url = f"https://arxiv.org/pdf/{candidate}"
            try:
                response = await client.get(url)
                response.raise_for_status()
                data = response.content
            except httpx.HTTPError as exc:
                last_error = exc
                logger.info("下载 %s 失败（%s），尝试下一个入口", url, exc)
                continue

            if len(data) > limit:
                raise ValueError(f"PDF 超过 {max_mb} MB 上限")
            # arXiv 偶尔会返回 HTML 的错误页（限流时），必须校验文件头
            if not data.startswith(b"%PDF"):
                raise ValueError("下载到的内容不是 PDF（可能被 arXiv 限流）")
            return data

    assert last_error is not None
    raise last_error
