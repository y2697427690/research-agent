"""RAG 问答：把检索结果交给大模型生成带引用的回答。

防幻觉的三层设计：
    第一层  检索无命中 → 不调用模型，直接回复「资料中没有相关内容」
    第二层  prompt 约束 → 只允许用给定片段作答，且每句必须标 [n]
    第三层  服务端校验 → 解析回答里所有 [n]，逐个核对是否真实存在

第三层是多数 RAG 系统省略的一步，但它是必要的：
模型编造引用编号是真实存在的问题，而「看起来有出处」恰恰是最难被发现的幻觉。
"""
from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunk import Chunk

# 起别名：本文件里已有一个 Citation 数据类（回答引用的来源），
# 直接导入会同名冲突，导致查询语句意外用到数据类上
from app.models.citation import Citation as CitationRow
from app.models.paper import Paper
from app.services import llm, retrieval

logger = logging.getLogger(__name__)

# 匹配回答中的引用标记，如 [1]、[12]
# 限制 1~2 位数字：论文回答引用数量不会超过 99，写 [1234] 必然是模型在胡编
_CITATION_RE = re.compile(r"\[(\d{1,2})\]")

SYSTEM_PROMPT = """你是一个严谨的科研文献助手。请严格遵守以下规则：

1. 只能依据我提供的资料片段作答，不得使用你自己的知识补充。
2. 每个结论句末尾必须标注来源编号，格式为方括号加数字，例如 [1] 或 [2][3]。
3. 只能使用资料中出现过的编号，不要编造编号。
4. 如果资料不足以回答问题，直接回答「提供的资料中没有相关内容」，不要猜测。
5. 用简明的中文回答；专业术语保留英文原文。
6. 不要输出与问题无关的客套话或额外说明。
7. 关于作者与机构：资料中若出现连续列出的作者名单（常见于论文首页块），
   可以按出现顺序回答「第 N 位作者是谁」。
   机构名若与作者名单成组出现在同一段，可按组内顺序对应推断，
   但必须注明「按解析顺序推断」，不要把它说成原文明确标注的结论。
8. 关于数值与引用：资料中的数字、公式、引用编号一律原样引用，不要换算或改写。
9. 关于实验配置：若问题问的是某个子模型（如 base / big）的配置，
   而资料只给出整体配置（例如「我们在 8 块 NVIDIA P100 上训练模型」），
   可以直接用整体配置作答，但须注明「论文给出的是整体训练配置，未按子模型分列」。
   只有在资料完全没有任何相关数字时才拒答。
"""

# 多篇论文对比专用提示词。
# 对比与单篇问答的区别在于：答案结构必须是「逐维度比对」，
# 并且要指出哪篇继承了什么、放弃了什么。这些约束单篇 prompt 不包含。
COMPARE_SYSTEM_PROMPT = """你是一个严谨的科研文献对比分析助手。请严格遵守：

1. 只能依据我提供的资料片段作答，不得使用你自己的知识补充。
2. 每个结论句末尾必须标注来源编号，格式为方括号加数字，例如 [1] 或 [2][3]。
3. 只能使用资料中出现过的编号，不要编造编号。
4. 回答结构要求：
   - 先分别说明各篇论文在问题相关维度上的做法（每篇都要有引用）；
   - 再给出对比结论：相同之处、差异之处、哪篇继承或改变了另一篇的什么；
   - 如果某个维度只有一篇论文有资料，明确说明「另一篇资料中未涉及」。
5. 资料不足以支撑某个对比维度时，直接说「资料不足」，不要靠常识补全。
6. 用简明的中文回答；专业术语保留英文原文。
7. 不要输出与问题无关的客套话或额外说明。
"""

REFUSAL_TEXT = "提供的资料中没有相关内容，无法回答这个问题。"


@dataclass
class ContextSnippet:
    """送给模型的一段资料。编号即回答里应当引用的编号。"""

    index: int                      # 从 1 开始
    chunk_id: str
    paper_id: str
    citation: str                   # 出处描述，如「3.2 节（第 4 页）」
    text: str
    # 论文标题：多篇对比时必须让模型知道「这段来自哪篇」，
    # 否则它只能看到「3.2 节」，分不清是 BERT 还是 Transformer 的 3.2 节
    paper_title: str | None = None


@dataclass
class Citation:
    """回答引用的一个来源，用于前端渲染角标与原文片段。"""

    index: int
    chunk_id: str
    paper_id: str
    citation: str
    text: str
    paper_title: str | None = None


@dataclass
class AnswerResult:
    """一次问答的完整结果。"""

    question: str
    answer: str
    citations: list[Citation] = field(default_factory=list)
    invalid_marks: list[int] = field(default_factory=list)
    hit_count: int = 0
    mode: str = "bm25"
    refused: bool = False


def build_snippets(hits, titles: dict[str, str] | None = None) -> list[ContextSnippet]:
    """把检索命中转成带编号的资料片段。

    hits 为 retrieval.RetrievalHit 列表；这里只取需要的字段，
    避免让 rag 模块依赖检索模块的类型。

    titles 为「论文 id → 标题」映射。单篇问答可省略；
    多篇对比时必须提供，否则模型无法区分某段文字来自哪篇论文。
    """
    title_map = titles or {}
    snippets = []
    for i, hit in enumerate(hits, start=1):
        snippets.append(ContextSnippet(
            index=i,
            chunk_id=hit.chunk_id,
            paper_id=hit.paper_id,
            citation=hit.citation,
            text=hit.text,
            paper_title=title_map.get(hit.paper_id),
        ))
    return snippets


def build_context(snippets: list[ContextSnippet]) -> str:
    """把片段拼成给模型看的资料块。

    每段带上「编号 + 论文名 + 出处」。多篇对比时论文名不可省：
    只写「3.2 节」模型无法判断这是哪篇论文的 3.2 节。
    """
    parts = []
    for s in snippets:
        where = f"《{s.paper_title}》{s.citation}" if s.paper_title else s.citation
        parts.append(f"[{s.index}] 出处：{where}\n{s.text}")
    return "\n\n".join(parts)


def build_messages(
    question: str,
    snippets: list[ContextSnippet],
    compare: bool = False,
) -> list[dict]:
    """构造对话消息。

    资料放在 user 消息里而不是 system 里，是为了让「规则」与「素材」
    分处不同角色，模型更不容易把素材当成指令（也能降低注入风险：
    论文正文里若出现「忽略以上指令」之类的文字，位于 user 侧的素材
    不像 system 那样具有最高优先级）。

    compare=True 时改用对比型提示词：要求按维度分别陈述再给结论。
    """
    context = build_context(snippets)
    if compare:
        ask = (
            "请对比以上论文在同一问题上的做法与结论。"
            "先分别说明各篇的做法（每篇都要有引用），再给出相同点、差异点，"
            "以及哪篇继承或改变了另一篇的什么。"
        )
    else:
        ask = "请依据以上资料回答下面的问题，并在每个结论后标注来源编号。"

    user_content = (
        f"资料片段如下：\n\n{context}\n\n"
        f"{ask}\n\n"
        f"问题：{question}"
    )
    return [
        {"role": "system", "content": COMPARE_SYSTEM_PROMPT if compare else SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


async def _paper_titles(db: AsyncSession, paper_ids: set[str]) -> dict[str, str]:
    """取论文标题映射，只查实际命中片段涉及的论文（通常 1~3 篇）。"""
    if not paper_ids:
        return {}
    rows = (await db.execute(
        select(Paper.id, Paper.title, Paper.file_name).where(Paper.id.in_(paper_ids))
    )).all()
    return {
        pid: (title or file_name or pid)
        for pid, title, file_name in rows
    }


async def _front_chunks(
    db: AsyncSession, paper_ids: set[str]
) -> dict[str, str]:
    """取每篇论文的「首页块」文本（chunk_index 最小的一块）。

    为什么必须固定加入：首页块包含标题、作者名单、机构与摘要开头，
    而这些是元信息类问题（作者是谁、第 N 位作者、在哪个机构）的唯一来源。
    语义检索不一定把它排进前几名——实测问「第 6 作者是谁」时，
    首页块确实被召回了，但另外 5 条都是注意力机制正文，
    模型面对 5 条无关 + 1 条混杂的作者信息，选择了拒答。
    把首页块作为固定片段加入，可以让「元信息一定在场」，
    与语义检索的结果互补。
    """
    if not paper_ids:
        return {}
    rows = (await db.execute(
        select(Chunk.paper_id, Chunk.text)
        .where(Chunk.paper_id.in_(paper_ids))
        .order_by(Chunk.paper_id, Chunk.chunk_index)
    )).all()

    front: dict[str, str] = {}
    for pid, text in rows:
        if pid not in front:          # 每篇只取序号最小的一块
            front[pid] = text or ""
    return front


def merge_with_front_matter(
    hits, titles: dict[str, str], front: dict[str, str]
) -> list[ContextSnippet]:
    """把首页块排在前面，检索命中接在后面，统一重新编号。

    编号顺序即引用顺序：首页块排在 [1..k]，
    这样模型引用元信息时会指向最先出现的片段，便于核对。
    """
    snippets: list[ContextSnippet] = []
    cursor = 1

    for pid, text in front.items():
        if not text.strip():
            continue
        snippets.append(ContextSnippet(
            index=cursor,
            chunk_id=f"{pid}-front",
            paper_id=pid,
            citation="论文首页（标题、作者与摘要开头）",
            text=text,
            paper_title=titles.get(pid),
        ))
        cursor += 1

    for snip in build_snippets(hits, titles):
        snip.index = cursor
        cursor += 1
        snippets.append(snip)

    return snippets


# 问题里出现这些词时，把参考文献列表也放进上下文
_REF_KEYWORDS = (
    "参考文献", "引用文献", "引用了哪些", "文献列表", "reference", "references",
    "引用信息", "被引", "citation",
)


def wants_references(question: str) -> bool:
    """判断问题是否在问参考文献。

    参考文献区在分块时被刻意过滤掉了（避免污染正文检索），
    因此它不在普通片段里，必须单独作为一段资料补进来，
    否则「列出关于 X 的参考文献」这类问题永远只能拒答。
    """
    text = (question or "").casefold()
    return any(k.casefold() in text for k in _REF_KEYWORDS)


async def build_reference_snippet(
    db: AsyncSession, paper_ids: set[str], titles: dict[str, str]
) -> str | None:
    """把指定论文的参考文献列表拼成一段资料文本。

    数据来自 citations 表（抽取引用关系时已落库的参考文献原文），
    不需要重新解析 PDF。每条截断到 300 字符，整体不超过 80 条，
    避免一份超长文献表把上下文挤爆。
    """
    if not paper_ids:
        return None

    rows = (await db.execute(
        select(
            CitationRow.source_paper_id,
            CitationRow.ref_index,
            CitationRow.raw_text,
        )
        .where(CitationRow.source_paper_id.in_(paper_ids))
        .order_by(CitationRow.source_paper_id, CitationRow.ref_index)
    )).all()
    if not rows:
        return None

    lines: list[str] = []
    current = None
    for pid, idx, raw in rows:
        if len(lines) > 80:
            lines.append("……（其余条目略）")
            break
        if pid != current:
            current = pid
            lines.append(f"【《{titles.get(pid, pid)}》的参考文献】")
        text = (raw or "").strip().replace("\n", " ")
        lines.append(f"[{idx}] {text[:300]}")

    return "\n".join(lines) if lines else None


async def _maybe_add_references(
    db: AsyncSession,
    question: str,
    snippets: list[ContextSnippet],
    titles: dict[str, str],
) -> list[ContextSnippet]:
    """问题涉及参考文献时，在末尾追加一段参考文献列表。

    追加在最后而不是最前：正文片段优先占编号，
    模型回答正文问题时引用的编号不会因为多了一段文献表而错位。
    """
    if not wants_references(question) or not titles:
        return snippets

    text = await build_reference_snippet(db, set(titles.keys()), titles)
    if not text:
        return snippets

    snippets.append(ContextSnippet(
        index=len(snippets) + 1,
        chunk_id="references",
        paper_id=next(iter(titles)),
        citation="参考文献列表",
        text=text,
    ))
    return snippets


def _norm(text: str) -> str:
    """把文本压成只含小写字母数字，用于标题包含判断。"""
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


# 标题参与匹配的最小长度：过短的标题（如 BERT）容易在问题里误命中
_MIN_TITLE_LEN = 12


async def expand_scope_by_title(
    db: AsyncSession, question: str, paper_ids: list[str] | None
) -> tuple[list[str] | None, list[str]]:
    """问题里明确提到某篇库内论文时，把它加入检索范围。

    解决的问题：前端问答范围默认锁定「文库第一篇」，
    用户问另一篇论文时，检索只在那篇里找，于是要么拒答，
    要么更糟——回答了被锁定那篇论文的内容（看起来像答对了，
    实际上答非所问，比拒答更容易误导人）。

    做法与引用匹配一致：把标题归一化后判断是否出现在问题里。
    只做「并集」不做「替换」：用户显式选中的论文不会被移除，
    只把问题点名的那篇补进来。
    返回 (新范围, 新增的 paper_id 列表)。
    """
    if not question:
        return paper_ids, []

    # 调用方没指定范围（= 全库检索）时直接返回：
    # 全库本来就能搜到任何论文，再做「扩展」只会帮倒忙。
    # 实测踩过：问「Layer Normalization 在 Transformer 中放在什么位置」，
    # 库里恰好有一篇论文标题就叫《Layer Normalization》，
    # 范围被收窄成只搜那一篇——而答案在另一篇里，结果必然拒答。
    # 这条规则只适用于「已锁定范围、但锁错了论文」的场景。
    if not paper_ids:
        return paper_ids, []

    rows = (await db.execute(select(Paper.id, Paper.title))).all()
    norm_q = _norm(question)

    added: list[str] = []
    current = list(paper_ids or [])
    for pid, title in rows:
        norm_title = _norm(title or "")
        if len(norm_title) < _MIN_TITLE_LEN:
            continue
        if norm_title and norm_title in norm_q and pid not in current:
            current.append(pid)
            added.append(pid)

    if not added:
        return paper_ids, []

    logger.info("问题点名了论文，已扩展检索范围: +%s", added)
    return current, added


def extract_marks(answer: str) -> list[int]:
    """按出现顺序抽出回答里的全部引用编号（含重复）。"""
    return [int(m) for m in _CITATION_RE.findall(answer or "")]


def split_marks(answer: str, snippet_count: int) -> tuple[list[int], list[int]]:
    """把引用编号分成「合法」与「非法」两组。

    合法：1 <= n <= snippet_count
    非法：越界（模型编造）或为 0（编号从 1 开始）

    返回 (合法编号去重后按出现顺序, 非法编号去重后按出现顺序)。
    """
    marks = extract_marks(answer)

    valid: list[int] = []
    invalid: list[int] = []
    for n in marks:
        if 1 <= n <= snippet_count:
            if n not in valid:
                valid.append(n)
        else:
            if n not in invalid:
                invalid.append(n)
    return valid, invalid


def sanitize_answer(answer: str, snippet_count: int) -> str:
    """移除回答中指向不存在来源的引用标记。

    为什么必须清除而不只是报告：
    用户看到 [7] 会以为是真实出处，而实际上可能只有 3 个片段。
    「看起来有依据的错误」比「明显没有依据」更难被发现，危害更大。
    """
    def _replace(match: re.Match) -> str:
        n = int(match.group(1))
        return match.group(0) if 1 <= n <= snippet_count else ""

    cleaned = _CITATION_RE.sub(_replace, answer or "")
    # 清除标记后可能留下多余空格，统一压缩
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([，。；、])", r"\1", cleaned)
    return cleaned.strip()


def build_citations(valid_marks: list[int], snippets: list[ContextSnippet]) -> list[Citation]:
    """按合法编号顺序生成引用列表，供前端渲染。"""
    by_index = {s.index: s for s in snippets}
    citations = []
    for n in valid_marks:
        s = by_index.get(n)
        if s is None:
            continue
        citations.append(Citation(
            index=s.index,
            chunk_id=s.chunk_id,
            paper_id=s.paper_id,
            citation=s.citation,
            text=s.text,
        ))
    return citations


# 模型依据 prompt 自行拒答时的常见措辞。
# 第一层防御（检索无命中即拒答）只能覆盖「完全没有相关片段」的情况；
# 而检索几乎总会返回若干片段（BM25 与向量都会凑出 top_k），
# 真正拦住无关问题的是第二层——prompt 约束让模型自己说「没有」。
# 因此需要识别这类回答，否则 refused 字段只反映第一层，会误导调用方。
_REFUSAL_PATTERNS = (
    "没有相关内容",
    "没有提供相关内容",
    "资料中没有",
    "资料中未",
    "无法回答",
    "无法确定",
    "不足以回答",
    "no relevant information",
    "not provided in",
    "cannot answer",
)


def looks_like_refusal(answer: str, citation_count: int) -> bool:
    """判断模型是否在拒答。

    同时满足两条才判定为拒答：
      1. 回答里没有任何合法引用（有引用说明它确实在引用资料作答）
      2. 含有拒答措辞
    只凭措辞判断会误伤「资料中没有提到 X，但提到了 Y [1]」这类部分回答。
    """
    if citation_count > 0:
        return False
    lowered = (answer or "").casefold()
    return any(p.casefold() in lowered for p in _REFUSAL_PATTERNS)


# ---------------------------------------------------------------- 编排

# 送给模型的片段数上限。
# 实测：top_k=6 时「训练 Base 模型用了多少 GPU」这类问题会拒答——
# 需要的 5.3 节训练细节排在更后面；提高到 8 即可命中；
# 再往上（10、12）答案不再变化，只是白耗 token，因此取 8。
DEFAULT_TOP_K = 8


async def answer(
    db: AsyncSession,
    question: str,
    *,
    top_k: int = DEFAULT_TOP_K,
    allow_vector: bool = True,
    paper_ids: list[str] | None = None,
) -> AnswerResult:
    """非流式问答：一次性返回完整回答。

    paper_ids 用于把检索限定在指定论文内；传入 2 篇及以上时自动切换为
    对比型提示词，要求按维度分别陈述再给结论。

    检索为空时直接返回固定拒答，不调用大模型——
    没有资料时让模型「自由发挥」是幻觉最主要的来源。
    """
    question = (question or "").strip()
    # 记录调用方显式指定的范围（判断是否对比模式只看这个）
    requested_ids = list(paper_ids or [])
    # 问题点名了某篇论文时把它补进范围，避免锁定错论文导致答非所问
    paper_ids, _added = await expand_scope_by_title(db, question, paper_ids)
    retrieved = await retrieval.retrieve(
        db, question, top_k=top_k, allow_vector=allow_vector, paper_ids=paper_ids
    )

    if not retrieved.hits:
        logger.info("检索无命中，拒答: %r", question[:60])
        return AnswerResult(
            question=question,
            answer=REFUSAL_TEXT,
            citations=[],
            invalid_marks=[],
            hit_count=0,
            mode=retrieved.mode,
            refused=True,
        )

    # 取命中片段涉及的论文标题：多篇对比时上下文里必须标出「这段来自哪篇」
    titles = await _paper_titles(db, {h.paper_id for h in retrieved.hits})
    # 是否启用对比提示词，只看「调用方显式指定了几篇」。
    # 不能用命中片段覆盖的论文数：问题点名某篇论文时我们会自动扩展范围，
    # 那只是为了让检索找对论文，并不意味着用户要做对比；
    # 否则一个单篇问题会得到「各篇论文在……维度上」这种对比式回答。
    compare = len(requested_ids) >= 2

    # 首页块固定加入：标题、作者名单与机构是元信息类问题的唯一来源，
    # 而语义检索不保证把它排进前列
    front = await _front_chunks(db, set(titles.keys()))
    snippets = merge_with_front_matter(retrieved.hits, titles, front)
    snippets = await _maybe_add_references(db, question, snippets, titles)
    messages = build_messages(question, snippets, compare=compare)
    try:
        text = await llm.chat(messages)
    except Exception:
        # 大模型不可用时降级为「只给检索结果、不给生成回答」，
        # 用户仍能看到相关原文，比整个请求失败更有用
        logger.exception("生成回答失败，降级返回片段")
        return AnswerResult(
            question=question,
            answer="大模型暂时不可用，以下是与问题最相关的原文片段，请直接参考。",
            citations=build_citations([s.index for s in snippets], snippets),
            invalid_marks=[],
            hit_count=len(snippets),
            mode=retrieved.mode,
            refused=False,
        )

    valid, invalid = split_marks(text, len(snippets))
    if invalid:
        logger.warning("模型引用了不存在的编号 %s（共 %d 个片段）", invalid, len(snippets))

    citations = build_citations(valid, snippets)
    cleaned = sanitize_answer(text, len(snippets))

    return AnswerResult(
        question=question,
        answer=cleaned,
        citations=citations,
        invalid_marks=invalid,
        hit_count=len(snippets),
        mode=retrieved.mode,
        # 第一层（检索无命中）之外，模型也可能依据 prompt 自行拒答
        refused=looks_like_refusal(cleaned, len(citations)),
    )


def _snippet_event(snippets: list[ContextSnippet]) -> dict[str, Any]:
    """把资料片段转成前端可直接渲染的结构（不含编号映射之外的信息）。"""
    return {
        "type": "citations",
        "snippets": [
            {
                "index": s.index,
                "chunk_id": s.chunk_id,
                "paper_id": s.paper_id,
                "citation": s.citation,
                "text": s.text,
            }
            for s in snippets
        ],
    }


async def answer_stream(
    db: AsyncSession,
    question: str,
    *,
    top_k: int = DEFAULT_TOP_K,
    allow_vector: bool = True,
    paper_ids: list[str] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """流式问答，产出 SSE 事件。

    事件类型：
        citations  先发送全部资料片段，前端可立即渲染「来源」区域
        token      回答的文本增量
        done       结束，携带净化后的完整回答、非法编号与引用列表
        error      出错时的说明

    为什么不在流式过程中就清洗非法引用编号：
    引用标记可能被拆到多个 token 里（先来 "["，再来 "3"，再来 "]"），
    逐 token 判断会误判。而且一旦把文本推给前端就无法收回。
    因此采用「先流式输出原文，done 事件里给出净化后的完整文本」，
    前端在收到 done 后用净化文本替换已显示内容。
    这样既保住了首字延迟，又保证了最终展示的引用真实可核。
    """
    question = (question or "").strip()
    if not question:
        yield {"type": "error", "message": "问题不能为空"}
        return

    # 记录调用方显式指定的范围（判断是否对比模式只看这个）
    requested_ids = list(paper_ids or [])
    # 问题点名了某篇论文时把它补进范围，避免锁定错论文导致答非所问
    paper_ids, _added = await expand_scope_by_title(db, question, paper_ids)
    retrieved = await retrieval.retrieve(
        db, question, top_k=top_k, allow_vector=allow_vector, paper_ids=paper_ids
    )

    # 第一层防幻觉：没有资料就拒答，不调用模型
    if not retrieved.hits:
        yield {"type": "citations", "snippets": []}
        yield {"type": "token", "text": REFUSAL_TEXT}
        yield {
            "type": "done",
            "answer": REFUSAL_TEXT,
            "citations": [],
            "invalid_marks": [],
            "hit_count": 0,
            "mode": retrieved.mode,
            "refused": True,
        }
        return

    titles = await _paper_titles(db, {h.paper_id for h in retrieved.hits})
    # 与 answer() 一致：对比模式只看调用方显式指定的论文数
    compare = len(requested_ids) >= 2

    front = await _front_chunks(db, set(titles.keys()))
    snippets = merge_with_front_matter(retrieved.hits, titles, front)
    snippets = await _maybe_add_references(db, question, snippets, titles)
    yield _snippet_event(snippets)

    messages = build_messages(question, snippets, compare=compare)
    pieces: list[str] = []
    try:
        async for piece in llm.stream_chat(messages):
            pieces.append(piece)
            yield {"type": "token", "text": piece}
    except Exception as exc:                      # noqa: BLE001 流式失败要告知前端
        logger.exception("流式生成失败")
        yield {
            "type": "error",
            "message": "生成回答时出错，请重试",
            "reason": f"{type(exc).__name__}: {exc}"[:200],
        }
        return

    raw = "".join(pieces)
    valid, invalid = split_marks(raw, len(snippets))
    if invalid:
        logger.warning("模型引用了不存在的编号 %s（共 %d 个片段）", invalid, len(snippets))

    cleaned = sanitize_answer(raw, len(snippets))
    final_citations = build_citations(valid, snippets)

    yield {
        "type": "done",
        "answer": cleaned,
        "citations": [
            {
                "index": c.index,
                "chunk_id": c.chunk_id,
                "paper_id": c.paper_id,
                "citation": c.citation,
                "text": c.text,
            }
            for c in final_citations
        ],
        "invalid_marks": invalid,
        "hit_count": len(snippets),
        "mode": retrieved.mode,
        "refused": looks_like_refusal(cleaned, len(final_citations)),
    }
