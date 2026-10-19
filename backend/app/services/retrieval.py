"""统一检索入口：混合检索（BM25 + 向量 + RRF）+ 自动降级。

设计要点：
1. 索引缓存
   每次检索都从数据库重建索引代价不小，因此进程内缓存。
   用「分块总数 + 已嵌入数」作为版本签名，数据变了才重建。

2. 自动降级
   嵌入服务不可用时（未配置 Key、网络失败、额度用尽）只走 BM25，
   并在结果里标记 mode="bm25"。功能变弱但绝不中断，
   这比让整个检索接口报 503 更好。

3. 只融合「已嵌入」的块参与向量检索
   未嵌入的块仍然能被 BM25 检索到，因此不会因为嵌入任务没跑完
   就完全检索不到内容。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.chunk import Chunk
from app.services import embedding
from app.services.bm25 import BM25Index, IndexedChunk
from app.services.fusion import rrf_fuse
from app.services.vector_store import VectorIndex

logger = logging.getLogger(__name__)

# 每一路先取出的候选数。取多于最终需要的数量，
# 让 RRF 有足够的重叠空间——两路都靠前的块才会浮上来。
CANDIDATE_MULTIPLIER = 3
MIN_CANDIDATES = 20

# 关键词检索的最低相对区分度：首位命中词的最大 IDF / 本语料最大 IDF。
# 低于该比例说明 BM25 只匹配到「到处都有」的常见词（如一篇论文里反复出现的
# 模型名），此时它给出的名次是噪声，进入 RRF 会把向量检索的正确答案挤下去。
# 实测案例：问句含「Transformer」时，BM25 用这个通用词凑出 20 条无关候选，
# 正确答案（3.1 节）被从第 1 名挤到第 5 名；跳过该路后回到第 1 名。
# 用比例而非绝对值，是因为 IDF 的量级与语料规模强相关
# （2 个块时上限约 0.69，上万块时可达 10 以上），绝对阈值必然失效。
MIN_INFORMATIVE_IDF_RATIO = 0.5

# 语料规模小于此值时不做上面的判断。
# 原因：块数很少时，任何词都会出现在相当比例的块中，df 分布没有统计意义，
# 相对区分度会普遍偏低，导致本来有效果的关键词检索被误判为噪声。
MIN_CORPUS_FOR_IDF_FILTER = 20


@dataclass
class RetrievalHit:
    """一条检索结果。"""

    chunk_id: str
    paper_id: str
    text: str
    section_title: str | None
    page_start: int
    page_end: int
    score: float
    sources: list[str] = field(default_factory=list)
    bm25_rank: int | None = None
    vector_rank: int | None = None

    @property
    def citation(self) -> str:
        section = self.section_title or "前置内容"
        if self.page_start == self.page_end:
            return f"{section}（第 {self.page_start} 页）"
        return f"{section}（第 {self.page_start}-{self.page_end} 页）"


@dataclass
class RetrievalResult:
    """一次检索的完整结果，含降级说明。"""

    query: str
    mode: str                      # hybrid / bm25 / empty
    hits: list[RetrievalHit] = field(default_factory=list)
    bm25_candidates: int = 0
    vector_candidates: int = 0
    degraded_reason: str | None = None


# ---------------------------------------------------------------- 索引缓存

_cache: dict[str, Any] = {
    "signature": None,
    "bm25": None,
    "vector": None,
    "chunks": {},
}


def invalidate() -> None:
    """数据变更后调用，让下次检索重建索引。"""
    _cache["signature"] = None
    _cache["bm25"] = None
    _cache["vector"] = None
    _cache["chunks"] = {}


async def _signature(db: AsyncSession) -> tuple[int, int]:
    """索引版本签名：(分块总数, 已嵌入数)。"""
    total = await db.scalar(select(func.count()).select_from(Chunk))
    embedded = await db.scalar(
        select(func.count()).select_from(Chunk).where(Chunk.embedding.is_not(None))
    )
    return int(total or 0), int(embedded or 0)


async def _build(db: AsyncSession) -> None:
    """从数据库加载分块并重建两个索引。"""
    stmt = select(
        Chunk.id, Chunk.paper_id, Chunk.text, Chunk.section_title,
        Chunk.page_start, Chunk.page_end, Chunk.embedding, Chunk.embedding_model,
    )
    rows = (await db.execute(stmt)).all()

    chunks_meta: dict[str, IndexedChunk] = {}
    bm25_chunks: list[IndexedChunk] = []
    vec_chunks: list[IndexedChunk] = []
    vec_list: list[np.ndarray] = []
    dim: int | None = None

    for row in rows:
        indexed = IndexedChunk(
            chunk_id=row.id,
            paper_id=row.paper_id,
            text=row.text,
            section_title=row.section_title,
            page_start=row.page_start,
            page_end=row.page_end,
        )
        chunks_meta[row.id] = indexed
        bm25_chunks.append(indexed)

        if not row.embedding:
            continue
        # 只使用与当前配置一致的模型产生的向量，避免维度/语义空间不一致
        if row.embedding_model != settings.embedding_model:
            continue
        arr = np.frombuffer(row.embedding, dtype=np.float32)
        if dim is None:
            dim = int(arr.size)
        elif arr.size != dim:
            logger.warning("分块 %s 的向量维度 %d 与其它 %d 不一致，已跳过",
                           row.id, arr.size, dim)
            continue
        vec_chunks.append(indexed)
        vec_list.append(arr)

    bm25 = BM25Index()
    bm25.build(bm25_chunks)

    vector = VectorIndex()
    if vec_list and dim:
        vector.build(vec_chunks, np.vstack(vec_list))

    _cache["bm25"] = bm25
    _cache["vector"] = vector
    _cache["chunks"] = chunks_meta
    _cache["signature"] = await _signature(db)
    logger.info("检索索引已重建: %d 块, 其中 %d 块可向量检索",
                len(bm25_chunks), len(vec_chunks))


async def ensure_index(db: AsyncSession, force: bool = False) -> None:
    """确保索引与数据库一致。数据没变时直接复用缓存。"""
    sig = await _signature(db)
    if force or _cache["signature"] != sig or _cache["bm25"] is None:
        await _build(db)


# ---------------------------------------------------------------- 检索


async def retrieve(
    db: AsyncSession,
    query: str,
    top_k: int = 8,
    allow_vector: bool = True,
) -> RetrievalResult:
    """混合检索。嵌入不可用时自动降级为纯 BM25。"""
    query = (query or "").strip()
    if not query:
        return RetrievalResult(query="", mode="empty")

    await ensure_index(db)
    bm25: BM25Index = _cache["bm25"]
    vector: VectorIndex = _cache["vector"]
    meta: dict[str, IndexedChunk] = _cache["chunks"]

    if len(bm25) == 0:
        return RetrievalResult(query=query, mode="empty")

    candidate_k = max(top_k * CANDIDATE_MULTIPLIER, MIN_CANDIDATES)

    rankings: dict[str, list[str]] = {}
    degraded: str | None = None
    vector_count = 0

    # 关键词检索的信息量判断。
    # 见 MIN_INFORMATIVE_IDF_RATIO 的说明：当一轮 BM25 的首位命中词也过于常见时，
    # 它给出的名次基本是噪声，进入 RRF 反而会把向量检索的正确答案挤下去。
    bm25_hits = bm25.search(query, top_k=candidate_k)
    if bm25_hits:
        top_idf = max(
            (bm25.idf(t) for t in bm25_hits[0].matched_terms), default=0.0
        )
        ceiling = bm25.max_idf
        ratio = (top_idf / ceiling) if ceiling > 0 else 0.0
        if len(bm25) < MIN_CORPUS_FOR_IDF_FILTER:
            # 语料太小，统计量不可靠，直接保留关键词检索结果
            ratio = 1.0
        if ratio >= MIN_INFORMATIVE_IDF_RATIO:
            rankings["bm25"] = [h.chunk.chunk_id for h in bm25_hits]
        else:
            degraded = (
                f"关键词检索仅命中高频词（最高 IDF {top_idf:.2f}，"
                f"相对区分度 {ratio:.0%}），已跳过该路"
            )
            logger.info("跳过 BM25 结果: %s", degraded)

    if allow_vector and len(vector) > 0 and embedding.is_available():
        try:
            query_vec = await embedding.embed_one(query)
            vector_hits = vector.search(query_vec, top_k=candidate_k)
            ids = [vector.chunks[i].chunk_id for i, _ in vector_hits]
            if ids:
                rankings["vector"] = ids
                vector_count = len(ids)
        except Exception as exc:  # noqa: BLE001 - 任何嵌入失败都应降级而非中断
            degraded = f"{type(exc).__name__}: {exc}"[:200]
            logger.warning("向量检索不可用，降级为纯 BM25: %s", degraded)
    elif allow_vector and not embedding.is_available():
        degraded = "未配置嵌入模型（APP_EMBEDDING_API_KEY 为空）"

    if not rankings:
        return RetrievalResult(query=query, mode="empty", degraded_reason=degraded)

    if "bm25" in rankings and "vector" in rankings:
        mode = "hybrid"
    elif "vector" in rankings:
        mode = "vector"
    else:
        mode = "bm25"
    fused = rrf_fuse(rankings, top_k=top_k)

    hits: list[RetrievalHit] = []
    for chunk_id, score, ranks in fused:
        info = meta.get(chunk_id)
        if info is None:
            continue
        hits.append(RetrievalHit(
            chunk_id=chunk_id,
            paper_id=info.paper_id,
            text=info.text,
            section_title=info.section_title,
            page_start=info.page_start,
            page_end=info.page_end,
            score=score,
            sources=sorted(ranks.keys()),
            bm25_rank=ranks.get("bm25"),
            vector_rank=ranks.get("vector"),
        ))

    return RetrievalResult(
        query=query,
        mode=mode,
        hits=hits,
        bm25_candidates=len(rankings.get("bm25", [])),
        vector_candidates=vector_count,
        degraded_reason=degraded,
    )
