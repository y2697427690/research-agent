"""分块翻译服务：按需翻译 + 持久化缓存。

为什么要缓存：翻译是逐块调大模型的付费操作。
同一篇论文第二次打开时若重新翻译，既慢又重复花钱，
因此译文写入 chunk_translations 表，命中即直接读库。

为什么支持 limit：
一次性翻译上百个块会让请求持续数分钟，浏览器可能超时，
且中途失败会浪费已完成的调用。分批推进可以让每批独立成功与否，
已完成的立即落库，用户也能边翻边看。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.chunk import Chunk
from app.models.translation import ChunkTranslation
from app.services import llm

logger = get_logger(__name__)

# 单次请求最多同时翻译多少块。
# 太高会被服务端限流（429），太低又慢；实测 4 路比较平衡。
DEFAULT_CONCURRENCY = 4

# 单块原文超过此长度就截断后再翻译。
# 分块本身上限约 700 字符，这里只是防御异常输入。
MAX_CHARS_PER_CHUNK = 2000

SYSTEM_PROMPT = """你是专业的学术论文翻译。请严格遵守：

1. 只输出中文译文，不要任何解释、评论、前言或总结。
2. 专业术语保留英文原文，并在其后用括号给出中文，例如：
   multi-head attention（多头注意力）。
3. 数字、公式、变量名（如 dmodel）、引用编号（如 [1]）必须原样保留。
4. 不要合并或拆分句子，保持与原文相同的段落结构。
5. 如果原文是表格残片或乱序文本，直译即可，不要尝试重新组织。
"""


@dataclass
class TranslateStats:
    """一次翻译任务的结果。"""

    total: int = 0          # 本次待翻译的块数
    translated: int = 0     # 成功翻译的块数
    failed: int = 0         # 失败的块数
    skipped: int = 0        # 已有译文而跳过的块数
    chars: int = 0          # 产出的译文总字符数
    model: str | None = None
    errors: list[str] = field(default_factory=list)


def build_messages(text: str) -> list[dict]:
    """构造翻译用的消息。

    原文用分隔线包起来，是为了让模型清楚知道「从哪到哪是需要翻译的内容」，
    减少它把 prompt 里的说明也翻译进去的概率。
    """
    body = (text or "").strip()[:MAX_CHARS_PER_CHUNK]
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"翻译下面这段英文：\n-----\n{body}\n-----"},
    ]


async def translate_text(text: str) -> str:
    """翻译一段文本。失败抛 LLMUnavailable（由 llm.chat 统一转换）。"""
    raw = await llm.chat(build_messages(text), temperature=0.1)
    return raw.strip()


async def _translate_one(text: str, sem: asyncio.Semaphore) -> tuple[str | None, str | None]:
    """在信号量保护下翻译一块。返回 (译文, 错误信息)，二者必有其一为 None。

    不向外抛异常：单块失败不应让整批失败，失败信息记录下来由调用方汇总。
    """
    async with sem:                      # 拿不到许可证就在这里排队
        try:
            return await translate_text(text), None
        except Exception as exc:         # noqa: BLE001 单块失败不影响其它块
            return None, f"{type(exc).__name__}: {exc}"[:160]


async def translate_paper(
    db: AsyncSession,
    paper_id: str,
    *,
    lang: str = "zh",
    limit: int | None = None,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> TranslateStats:
    """为某篇论文尚未翻译的分块生成译文。

    limit 为 None 时翻译全部待翻译块；建议由接口按批传值。
    """
    stats = TranslateStats(model=settings.llm_model_chat)

    if not llm.is_available():
        stats.errors.append("未配置 APP_LLM_API_KEY")
        return stats

    # 已翻译过的块 id：用子查询排除，避免把已有译文重翻一遍
    translated_ids = select(ChunkTranslation.chunk_id).where(
        ChunkTranslation.lang == lang
    )

    stmt = (
        select(Chunk)
        .where(Chunk.paper_id == paper_id, Chunk.id.not_in(translated_ids))
        .order_by(Chunk.chunk_index)
    )
    if limit is not None:
        stmt = stmt.limit(max(1, limit))

    pending = list((await db.execute(stmt)).scalars().all())
    stats.total = len(pending)
    if not pending:
        return stats

    logger.info("开始翻译 %s：%d 块，并发 %d", paper_id, len(pending), concurrency)

    sem = asyncio.Semaphore(max(1, concurrency))
    results = await asyncio.gather(
        *(_translate_one(chunk.text, sem) for chunk in pending)
    )

    for chunk, (zh, err) in zip(pending, results, strict=True):
        if zh is None:
            stats.failed += 1
            if err and len(stats.errors) < 5:   # 只保留前几条错误，避免刷屏
                stats.errors.append(err)
            continue
        db.add(ChunkTranslation(
            id=f"{chunk.id}-{lang}",
            chunk_id=chunk.id,
            lang=lang,
            text=zh,
            char_count=len(zh),
            model=settings.llm_model_chat,
        ))
        stats.translated += 1
        stats.chars += len(zh)

    await db.flush()
    logger.info(
        "翻译完成 %s：成功 %d，失败 %d，产出 %d 字",
        paper_id, stats.translated, stats.failed, stats.chars,
    )
    return stats


async def count_progress(
    db: AsyncSession, paper_id: str, lang: str = "zh"
) -> tuple[int, int]:
    """返回 (分块总数, 已翻译数)，供前端显示进度。"""
    from sqlalchemy import func

    total = await db.scalar(
        select(func.count()).select_from(Chunk).where(Chunk.paper_id == paper_id)
    )
    done = await db.scalar(
        select(func.count())
        .select_from(ChunkTranslation)
        .join(Chunk, Chunk.id == ChunkTranslation.chunk_id)
        .where(Chunk.paper_id == paper_id, ChunkTranslation.lang == lang)
    )
    return int(total or 0), int(done or 0)
