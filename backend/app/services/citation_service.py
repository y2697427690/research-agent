"""引用关系抽取与匹配。

从每篇论文的参考文献列表里认出它引用了哪些论文，
生成「引用边」写入 citations 表，供后续图分析使用。

匹配优先级：
    1. arXiv 编号精确命中  —— 最可靠
    2. 库内标题包含        —— 兜底
    3. 都不中              —— 记为外部论文（未入库），仍作为图的节点

为什么是「拿库内标题去参考文献里找」而不是「从参考文献里抠出标题」：
学术参考文献的格式差异极大（作者缩写、大小写、期刊名、页码、年份位置都不同），
稳定地切出标题需要很多启发式规则且容易出错；
反过来，库内标题是干净且有限的，只需判断「这个标题的规范化形式
是否出现在这段参考文献里」，规则简单、可解释。
代价是对超短标题（如 BERT）容易误判，因此设最小长度门槛。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import anyio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.citation import Citation
from app.models.paper import Paper
from app.services import paper_service
from app.services.pdf_parser import parse_pdf

logger = get_logger(__name__)

# arXiv 编号：新式 1706.03762 / 老式 cs/0101001 与 hep-th/9901001
# 前面必须跟 arXiv: 或 abs/，避免把普通数字（页码、年份）误当成编号
_ARXIV_ID = re.compile(
    r"(?:arxiv[:\s]*|abs/)"
    r"(?P<id>(?:[a-z][a-z\-]*(?:\.[A-Za-z]{2})?/\d{7})|(?:\d{4}\.\d{4,5}))"
    r"(?:v\d+)?",
    re.IGNORECASE,
)

# 标题参与匹配的最小长度（归一化后）。
# 太短的标题（如 BERT）会出现在大量参考文献里，造成误判。
MIN_TITLE_LEN = 12

# 未匹配时给外部节点用的标题长度上限
FALLBACK_TITLE_LEN = 120


def normalize_title(text: str) -> str:
    """把文本压成便于「包含判断」的形式：小写 + 只留字母数字。

    "Layer normalization." 与 "Layer Normalization" 归一化后完全相同，
    因此可以直接做字符串包含判断。
    """
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def extract_arxiv_ids(text: str) -> list[str]:
    """从一段文字里抽出所有 arXiv 编号（去重、保持出现顺序）。"""
    ids: list[str] = []
    for match in _ARXIV_ID.finditer(text or ""):
        aid = match.group("id")
        if aid and aid not in ids:
            ids.append(aid)
    return ids


@dataclass
class RefMatch:
    """一条参考文献的匹配结果。"""

    ref_index: int
    raw_text: str
    match_method: str                 # arxiv | title | none
    target_paper_id: str | None = None
    target_arxiv_id: str | None = None
    target_title: str | None = None


def match_reference(
    raw_text: str,
    ref_index: int,
    library: list[Paper],
    self_id: str,
) -> RefMatch:
    """判断一条参考文献指向库内哪篇论文（或外部论文）。"""
    raw = (raw_text or "").strip()
    ids = extract_arxiv_ids(raw)

    # ---- 1) arXiv 编号精确命中 ----
    if ids:
        for paper in library:
            if paper.id == self_id:
                continue
            if (paper.arxiv_id or "") in ids:
                return RefMatch(
                    ref_index=ref_index,
                    raw_text=raw,
                    match_method="arxiv",
                    target_paper_id=paper.id,
                    target_arxiv_id=paper.arxiv_id,
                    target_title=paper.title,
                )

    # ---- 2) 库内标题包含 ----
    norm_ref = normalize_title(raw)
    for paper in library:
        if paper.id == self_id:
            continue
        norm_title = normalize_title(paper.title or "")
        if len(norm_title) >= MIN_TITLE_LEN and norm_title in norm_ref:
            return RefMatch(
                ref_index=ref_index,
                raw_text=raw,
                match_method="title",
                target_paper_id=paper.id,
                target_arxiv_id=paper.arxiv_id,
                target_title=paper.title,
            )

    # ---- 3) 外部论文（未入库）----
    # 仍然记下 arXiv 编号或文本片段，让它在图上有可读的标签
    return RefMatch(
        ref_index=ref_index,
        raw_text=raw,
        match_method="none",
        target_arxiv_id=ids[0] if ids else None,
        target_title=raw[:FALLBACK_TITLE_LEN] if raw else None,
    )


@dataclass
class CitationStats:
    """一次引用重建的结果。"""

    paper_id: str
    total_refs: int = 0
    matched: int = 0          # 命中库内论文的边数
    by_arxiv: int = 0
    by_title: int = 0
    external: int = 0         # 指向未入库论文的边数


async def rebuild_citations(db: AsyncSession, paper_id: str) -> CitationStats:
    """重建某篇论文的引用边。

    参考文献列表没有单独落库，因此这里重新解析一次 PDF 取它。
    解析是本地计算（15 页论文约 0.2 秒），比给 papers 表加列再迁移简单，
    也不会因为迁移失败而丢数据。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise ValueError(f"论文不存在：{paper_id}")

    abs_path = settings.storage_dir / paper.file_path
    doc = await anyio.to_thread.run_sync(parse_pdf, str(abs_path))
    refs = doc.references or []

    library = list((await db.execute(select(Paper))).scalars().all())

    # 先删旧边：重新解析后参考文献可能变了，旧边必须作废
    await db.execute(delete(Citation).where(Citation.source_paper_id == paper_id))

    stats = CitationStats(paper_id=paper_id, total_refs=len(refs))
    rows: list[Citation] = []

    for index, raw in enumerate(refs, start=1):
        match = match_reference(raw, index, library, paper_id)
        if match.match_method == "arxiv":
            stats.by_arxiv += 1
            stats.matched += 1
        elif match.match_method == "title":
            stats.by_title += 1
            stats.matched += 1
        else:
            stats.external += 1

        rows.append(Citation(
            id=f"{paper_id}-r{index}",
            source_paper_id=paper_id,
            ref_index=index,
            target_paper_id=match.target_paper_id,
            target_arxiv_id=match.target_arxiv_id,
            target_title=match.target_title,
            match_method=match.match_method,
            raw_text=match.raw_text[:1000],
        ))

    if rows:
        db.add_all(rows)
        await db.flush()

    logger.info(
        "引用重建完成 %s：共 %d 条，命中库内 %d（编号 %d / 标题 %d），外部 %d",
        paper_id, stats.total_refs, stats.matched,
        stats.by_arxiv, stats.by_title, stats.external,
    )
    return stats


async def rebuild_all(db: AsyncSession) -> list[CitationStats]:
    """重建全部论文的引用边。

    注意顺序：先解析全部论文拿到参考文献，再统一匹配。
    这里逐篇调用即可——匹配时读的是 papers 表的全量数据，
    与当前论文是否已重建无关。
    """
    paper_ids = list((await db.execute(select(Paper.id))).scalars().all())
    results: list[CitationStats] = []
    for pid in paper_ids:
        try:
            results.append(await rebuild_citations(db, pid))
        except Exception:                     # noqa: BLE001 单篇失败不影响其它篇
            logger.exception("重建引用失败：%s", pid)
    return results
