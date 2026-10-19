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

from sqlalchemy.ext.asyncio import AsyncSession

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


@dataclass
class Citation:
    """回答引用的一个来源，用于前端渲染角标与原文片段。"""

    index: int
    chunk_id: str
    paper_id: str
    citation: str
    text: str


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


def build_snippets(hits) -> list[ContextSnippet]:
    """把检索命中转成带编号的资料片段。

    hits 为 retrieval.RetrievalHit 列表；这里只取需要的字段，
    避免让 rag 模块依赖检索模块的类型。
    """
    snippets = []
    for i, hit in enumerate(hits, start=1):
        snippets.append(ContextSnippet(
            index=i,
            chunk_id=hit.chunk_id,
            paper_id=hit.paper_id,
            citation=hit.citation,
            text=hit.text,
        ))
    return snippets


def build_context(snippets: list[ContextSnippet]) -> str:
    """把片段拼成给模型看的资料块。

    每段都带上「编号 + 出处」，模型回答时可以顺带指明章节，
    也让用户更容易判断这段话是否可信。
    """
    parts = []
    for s in snippets:
        parts.append(f"[{s.index}] 出处：{s.citation}\n{s.text}")
    return "\n\n".join(parts)


def build_messages(question: str, snippets: list[ContextSnippet]) -> list[dict]:
    """构造对话消息。

    资料放在 user 消息里而不是 system 里，是为了让「规则」与「素材」
    分处不同角色，模型更不容易把素材当成指令（也能降低注入风险：
    论文正文里若出现「忽略以上指令」之类的文字，位于 user 侧的素材
    不像 system 那样具有最高优先级）。
    """
    context = build_context(snippets)
    user_content = (
        f"资料片段如下：\n\n{context}\n\n"
        f"请依据以上资料回答下面的问题，并在每个结论后标注来源编号。\n\n"
        f"问题：{question}"
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


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

# 送给模型的片段数上限。太多会挤占上下文并引入噪声，
# 实测 top_k=6 足以覆盖绝大多数单点问题。
DEFAULT_TOP_K = 6


async def answer(
    db: AsyncSession,
    question: str,
    *,
    top_k: int = DEFAULT_TOP_K,
    allow_vector: bool = True,
) -> AnswerResult:
    """非流式问答：一次性返回完整回答。

    检索为空时直接返回固定拒答，不调用大模型——
    没有资料时让模型「自由发挥」是幻觉最主要的来源。
    """
    question = (question or "").strip()
    retrieved = await retrieval.retrieve(
        db, question, top_k=top_k, allow_vector=allow_vector
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

    snippets = build_snippets(retrieved.hits)
    messages = build_messages(question, snippets)
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

    retrieved = await retrieval.retrieve(
        db, question, top_k=top_k, allow_vector=allow_vector
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

    snippets = build_snippets(retrieved.hits)
    yield _snippet_event(snippets)

    messages = build_messages(question, snippets)
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
