"""工具注册表：把已有能力包装成「模型可以自己选、自己调」的工具。

和原来的固定编排有什么不同：
  以前是「用户点问答 → 必然走 retrieve → 必然走 answer」；
  现在模型先看问题，再决定调哪个工具、要不要多步调用
  （比如先 list_papers 看有哪些论文，再 search_library 查细节）。
  这就是评审意见里说的「补上 Agent 这一半」。

为什么用 JSON 协议而不是 provider 的 function calling：
  换模型时不必重新适配；而且每一步的 thought / 参数都能落库展示，
  评审能看清"模型为什么调这个工具"，比黑盒 tool_calls 更可解释。
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.citation import Citation
from app.models.paper import Paper
from app.services import discover, llm, retrieval

logger = get_logger(__name__)


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Awaitable[Any]]
    # 观测结果截断长度：太长会把上下文塞爆，也让每一步的可读性变差
    max_chars: int = 1200


async def _search_library(db: AsyncSession, query: str, top_k: int = 6) -> Any:
    """库内混合检索：Agent 最常用的工具。"""
    result = await retrieval.retrieve(db, query, top_k=int(top_k))
    hits = getattr(result, "hits", result)
    out = []
    for h in hits[: int(top_k)]:
        out.append({
            "paper_id": getattr(h, "paper_id", ""),
            "chunk_index": getattr(h, "chunk_index", None),
            "text": (getattr(h, "text", "") or "")[:400],
        })
    return out


async def _list_papers(db: AsyncSession, limit: int = 20) -> Any:
    rows = (
        await db.execute(
            select(Paper.id, Paper.title, Paper.year).order_by(Paper.added_at.desc()).limit(int(limit))
        )
    ).all()
    return [{"id": r[0], "title": (r[1] or "")[:80], "year": r[2]} for r in rows]


async def _graph_insights(db: AsyncSession, limit: int = 8) -> Any:
    """引用图谱的核心节点：入度高 = 更像奠基工作。"""
    rows = (
        await db.execute(
            select(Citation.target_paper_id, func.count().label("n"))
            .where(Citation.target_paper_id.is_not(None))
            .group_by(Citation.target_paper_id)
            .order_by(func.count().desc())
            .limit(int(limit))
        )
    ).all()
    ids = [r[0] for r in rows]
    titles = {}
    if ids:
        titles = dict(
            (await db.execute(select(Paper.id, Paper.title).where(Paper.id.in_(ids)))).all()
        )
    return [
        {"paper_id": pid, "title": (titles.get(pid) or "")[:60], "in_degree": int(n)}
        for pid, n in rows
    ]


async def _discover_arxiv(db: AsyncSession, query: str, max_results: int = 5) -> Any:
    items = await discover.search(query, max_results=int(max_results), sort="recent")
    return [
        {
            "arxiv_id": it.arxiv_id, "title": (it.title or "")[:90],
            "published": it.published, "has_code": it.has_code,
        }
        for it in items
    ]


async def _translate(db: AsyncSession, text: str) -> Any:
    """简短的英译中：直接问模型，不复用翻译服务（避免再引一层依赖）。"""
    zh = await llm.chat(
        [
            {"role": "system", "content": "把下面的英文译成中文，只输出译文。"},
            {"role": "user", "content": text[:800]},
        ],
        temperature=0.1,
    )
    return {"zh": (zh or "").strip()[:600]}


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        Tool(
            name="search_library",
            description="在当前论文库中做混合检索（BM25 + 向量），返回最相关的正文片段。问论文内容时先用它。",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索词或问题"},
                    "top_k": {"type": "integer", "default": 6, "minimum": 1, "maximum": 12},
                },
                "required": ["query"],
            },
            handler=_search_library,
        ),
        Tool(
            name="list_papers",
            description="列出库内已有论文（标题 / 年份）。不知道库里有什么时先用它。",
            parameters={
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 20}},
            },
            handler=_list_papers,
            max_chars=900,
        ),
        Tool(
            name="graph_insights",
            description="查看引用图谱的核心节点（按被库内引用次数排序），用于判断哪篇是奠基工作。",
            parameters={
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 8}},
            },
            handler=_graph_insights,
            max_chars=800,
        ),
        Tool(
            name="discover_arxiv",
            description="去 arXiv 检索最新论文（不在库内），返回编号/标题/发布时间/是否有代码。",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5, "minimum": 1, "maximum": 10},
                },
                "required": ["query"],
            },
            handler=_discover_arxiv,
            max_chars=1000,
        ),
        Tool(
            name="translate",
            description="把一段英文（如摘要、标题）译成中文。",
            parameters={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
            handler=_translate,
            max_chars=700,
        ),
    ]
}


def schema_for_prompt() -> str:
    """给模型看的工具清单（JSON Schema 原文，省得模型猜参数名）。"""
    return json.dumps(
        [
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
            for t in TOOLS.values()
        ],
        ensure_ascii=False,
        indent=2,
    )


async def call(db: AsyncSession, name: str, args: dict[str, Any]) -> tuple[bool, str]:
    """执行一个工具，返回 (是否成功, 观测文本)。

    参数错误、工具不存在都返回 ok=False 而不是抛异常：
    Agent 需要看到错误并自己纠正（比如换个参数重试），一抛异常整轮就断了。
    """
    tool = TOOLS.get(name)
    if tool is None:
        return False, f"工具不存在：{name}。可用工具：{', '.join(TOOLS)}"

    # 只允许 schema 里声明过的参数，避免模型塞进无关字段导致 TypeError
    allowed = set((tool.parameters.get("properties") or {}).keys())
    kwargs = {k: v for k, v in (args or {}).items() if k in allowed}
    missing = [k for k in (tool.parameters.get("required") or []) if k not in kwargs]
    if missing:
        return False, f"缺少必填参数：{', '.join(missing)}"

    try:
        result = await tool.handler(db, **kwargs)
    except Exception as exc:  # noqa: BLE001 - 工具内部错误也要让模型知道
        logger.warning("Agent 工具 %s 执行失败：%s", name, exc)
        return False, f"执行失败：{exc}"

    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) > tool.max_chars:
        text = text[: tool.max_chars] + "…（已截断）"
    return True, text
