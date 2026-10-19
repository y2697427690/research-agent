"""分块的持久化与向量化。

职责：
1. 解析完成后把正文切成块写入数据库（同时保存溯源信息）
2. 为尚未嵌入的块调用嵌入模型生成向量

为什么把「切块」和「嵌入」分成两步：
- 切块是本地计算（快、免费）；嵌入是远程调用（慢、按量计费）
- 用户可能只想先拿到结构化解析结果，不希望每次都消耗嵌入额度
- 嵌入失败不应让已经成功的解析结果作废
- 未嵌入的块仍然能被 BM25 检索到，因此「检索不可用」这个状态不会出现
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.chunk import Chunk
from app.services import chunking, embedding
from app.services.pdf_parser import ParsedDocument
from app.services.vector_store import pack_vectors

logger = get_logger(__name__)


@dataclass
class EmbedStats:
    """一次嵌入任务的结果。"""

    total: int = 0          # 需要嵌入的块数
    embedded: int = 0       # 成功嵌入的块数
    failed: int = 0         # 失败的块数
    dim: int | None = None  # 向量维度
    errors: list[str] = field(default_factory=list)


async def replace_chunks(
    db: AsyncSession,
    paper_id: str,
    doc: ParsedDocument,
    *,
    target_chars: int = chunking.DEFAULT_TARGET_CHARS,
    overlap_chars: int = chunking.DEFAULT_OVERLAP_CHARS,
) -> int:
    """用本次解析结果重建该论文的全部分块。返回写入的块数。

    先删后插：重新解析同一篇论文时不应产生重复块；
    且旧块对应的向量已经过期，必须一并清除。
    """
    await db.execute(delete(Chunk).where(Chunk.paper_id == paper_id))

    pieces, stats = chunking.chunk_document(
        doc, target_chars=target_chars, overlap_chars=overlap_chars
    )
    if not pieces:
        logger.info("论文 %s 无可分块内容（可能是扫描件）", paper_id)
        return 0

    db.add_all([
        Chunk(
            id=f"{paper_id}-c{piece.index}",
            paper_id=paper_id,
            chunk_index=piece.index,
            text=piece.text,
            char_count=piece.char_count,
            section_title=piece.section_title,
            level=piece.level,
            page_start=piece.page_start,
            page_end=piece.page_end,
        )
        for piece in pieces
    ])
    await db.flush()

    logger.info(
        "论文 %s 分块完成: %d 块, 平均 %.0f 字符, 跳过文献块 %d",
        paper_id, stats.total, stats.avg_chars, stats.skipped_reference_chunks,
    )
    _invalidate_index()
    return stats.total


async def embed_pending(
    db: AsyncSession,
    paper_id: str | None = None,
    *,
    limit: int | None = None,
) -> EmbedStats:
    """为尚未嵌入（或模型已变更）的块生成向量。

    paper_id 为 None 时处理全部分块。
    每批嵌入后立即写库，中途失败也不会丢掉已完成的批次。
    """
    stats = EmbedStats()

    if not embedding.is_available():
        stats.errors.append("未配置 APP_EMBEDDING_API_KEY")
        return stats

    stmt = select(Chunk).where(
        (Chunk.embedding.is_(None)) | (Chunk.embedding_model != settings.embedding_model)
    )
    if paper_id is not None:
        stmt = stmt.where(Chunk.paper_id == paper_id)
    stmt = stmt.order_by(Chunk.paper_id, Chunk.chunk_index)
    if limit is not None:
        stmt = stmt.limit(limit)

    pending = list((await db.execute(stmt)).scalars().all())
    stats.total = len(pending)
    if not pending:
        return stats

    batch_size = max(1, settings.embedding_batch_size)
    for start in range(0, len(pending), batch_size):
        batch = pending[start:start + batch_size]
        try:
            vectors = await embedding.embed_texts([c.text for c in batch])
        except Exception as exc:  # noqa: BLE001 单批失败不应中断整个任务
            stats.failed += len(batch)
            msg = f"{type(exc).__name__}: {exc}"[:200]
            stats.errors.append(msg)
            logger.warning("嵌入失败（%d 块）: %s", len(batch), msg)
            continue

        dim = len(vectors[0]) if vectors else 0
        stats.dim = dim or stats.dim
        for chunk_row, vector in zip(batch, vectors, strict=True):
            chunk_row.embedding = pack_vectors([vector])
            chunk_row.embedding_model = settings.embedding_model
            stats.embedded += 1
        await db.flush()

    _invalidate_index()
    logger.info(
        "嵌入完成: 待处理 %d, 成功 %d, 失败 %d, 维度 %s",
        stats.total, stats.embedded, stats.failed, stats.dim,
    )
    return stats


async def count_chunks(
    db: AsyncSession, paper_id: str | None = None
) -> tuple[int, int]:
    """返回 (分块总数, 已嵌入数)。"""
    stmt_total = select(func.count()).select_from(Chunk)
    stmt_embedded = select(func.count()).select_from(Chunk).where(
        Chunk.embedding.is_not(None)
    )
    if paper_id is not None:
        stmt_total = stmt_total.where(Chunk.paper_id == paper_id)
        stmt_embedded = stmt_embedded.where(Chunk.paper_id == paper_id)
    total = await db.scalar(stmt_total)
    embedded = await db.scalar(stmt_embedded)
    return int(total or 0), int(embedded or 0)


def _invalidate_index() -> None:
    """分块或向量变化后让检索索引失效，下次检索自动重建。

    延迟导入避免模块级循环依赖：retrieval 依赖 models 与算法模块，
    而本模块只依赖它一个失效钩子。
    """
    from app.services import retrieval

    retrieval.invalidate()
