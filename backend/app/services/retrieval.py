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


def _take_per_paper(items, paper_of, per_paper: int):
    """按论文配额抽取：每篇论文最多取 per_paper 条，保持原有顺序。

    为什么对比场景必须做配额：
    若只按全局分数取前 N 条，语义上最贴近问题的那一篇会把名额吃光。
    实测问「两篇对 layer normalization 的使用有何不同」时，
    《Layer Normalization》一篇占满了 8 个片段，
    另一篇一个字都没进上下文，模型只能回答「资料不足」——
    这不是模型的问题，是检索没有覆盖到对比所需的双方。
    """
    if per_paper <= 0:
        return items
    used: dict[str, int] = {}
    out = []
    for item in items:
        pid = paper_of(item)
        if used.get(pid, 0) >= per_paper:
            continue
        used[pid] = used.get(pid, 0) + 1
        out.append(item)
    return out

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
    paper_ids: list[str] | None = None,
) -> RetrievalResult:
    """混合检索。嵌入不可用时自动降级为纯 BM25。

    paper_ids 用于把检索范围限定在指定论文内（多篇对比场景）。
    实现方式是「先多取候选、再按论文过滤」：
    索引是全局的，按论文另建索引既浪费内存又要处理增量更新，
    而候选列表本来就不长，事后过滤的代价可以忽略。
    过滤时会把候选深度放大，避免过滤后剩不下几条。
    """
    query = (query or "").strip()
    if not query:
        return RetrievalResult(query="", mode="empty")

    await ensure_index(db)
    bm25: BM25Index = _cache["bm25"]
    vector: VectorIndex = _cache["vector"]
    meta: dict[str, IndexedChunk] = _cache["chunks"]

    if len(bm25) == 0:
        return RetrievalResult(query=query, mode="empty")

    # 指定论文时放大候选深度：过滤会淘汰大量候选，
    # 若仍按原深度取，很容易过滤后一条都不剩
    scope_ids = set(paper_ids) if paper_ids else None
    depth_boost = 4 if scope_ids else 1
    candidate_k = max(top_k * CANDIDATE_MULTIPLIER, MIN_CANDIDATES) * depth_boost

    # 每篇论文的片段配额。
    #   指定了论文（多篇对比）：每篇保底 top_k/篇数 条，保证双方都有材料；
    #   未指定论文（全库检索）：每篇最多 3~4 条，避免被单篇垄断。
    #
    # 全库限流是实测出来的：问「Layer Normalization 在 Transformer 中放在什么位置」时，
    # 某篇论文（标题与问题语义几乎一致）的前 20 条命中全部来自它自己，
    # 其它论文一条都进不来；而它恰好解析质量只有 0.44、章节全丢、块内容残缺，
    # 模型拿着 20 条残块只能拒答。按论文限流后，ViT / Attention 的干净片段才有机会进入。
    per_paper = 0
    if scope_ids:
        per_paper = max(2, -(-top_k // len(scope_ids)))   # 向上取整
    else:
        paper_count = sum(1 for _ in {c.paper_id for c in meta.values()})
        if paper_count >= 4:
            per_paper = max(3, top_k // 2)

    rankings: dict[str, list[str]] = {}
    degraded: str | None = None
    vector_count = 0

    # 关键词检索的信息量判断。
    # 见 MIN_INFORMATIVE_IDF_RATIO 的说明：当一轮 BM25 的首位命中词也过于常见时，
    # 它给出的名次基本是噪声，进入 RRF 反而会把向量检索的正确答案挤下去。
    bm25_hits = bm25.search(query, top_k=candidate_k)
    if scope_ids:
        bm25_hits = [h for h in bm25_hits if h.chunk.paper_id in scope_ids]
    if per_paper:
        bm25_hits = _take_per_paper(
            bm25_hits, lambda h: h.chunk.paper_id, per_paper
        )
    # 被「信息量不足」判掉的关键词结果先留着：它不该在它是唯一可用路径时被丢掉。
    # 实测踩过：嵌入额度耗尽 → 向量路异常；同一查询的关键词路又被 IDF 过滤器跳过，
    # 于是两条路都没有结果，检索返回 empty，问答直接拒答。
    # 过滤器是「防噪声」的，前提是另有可用结果；否则宁可给出低置信度的召回。
    bm25_fallback: list[str] = []

    if bm25_hits:
        # 判据用「前若干个命中的最强词 IDF」，而不是只看第一名。
        # 只看第一名的问题：排名第一的块可能恰好只匹配到 "layer" 这类高频词，
        # 于是整条关键词检索被判定为无信息量而跳过；
        # 而其实查询里的 "normalization" 是能与正文精确对上的。
        head = bm25_hits[:5]
        top_idf = max(
            (bm25.idf(t) for h in head for t in h.matched_terms),
            default=0.0,
        )
        ceiling = bm25.max_idf
        ratio = (top_idf / ceiling) if ceiling > 0 else 0.0
        if len(bm25) < MIN_CORPUS_FOR_IDF_FILTER:
            # 语料太小，统计量不可靠，直接保留关键词检索结果
            ratio = 1.0
        bm25_ids = [h.chunk.chunk_id for h in bm25_hits]
        if ratio >= MIN_INFORMATIVE_IDF_RATIO:
            rankings["bm25"] = bm25_ids
        else:
            bm25_fallback = bm25_ids
            degraded = (
                f"关键词检索仅命中高频词（最高 IDF {top_idf:.2f}，"
                f"相对区分度 {ratio:.0%}），已跳过该路"
            )
            logger.info("跳过 BM25 结果: %s", degraded)

    if allow_vector and len(vector) > 0 and embedding.is_available():
        try:
            query_vec = await embedding.embed_one(query)
            vector_hits = vector.search(query_vec, top_k=candidate_k)
            ids = [
                vector.chunks[i].chunk_id
                for i, _ in vector_hits
                if scope_ids is None or vector.chunks[i].paper_id in scope_ids
            ]
            if per_paper:
                # 按论文配额裁剪：多篇对比时保证双方都在场，
                # 全库检索时避免语义最贴近的一篇占据全部名额
                ids = _take_per_paper(
                    ids, lambda cid: meta[cid].paper_id, per_paper
                )
            if ids:
                rankings["vector"] = ids
                vector_count = len(ids)
        except Exception as exc:  # noqa: BLE001 - 任何嵌入失败都应降级而非中断
            degraded = f"{type(exc).__name__}: {exc}"[:200]
            logger.warning("向量检索不可用，降级为纯 BM25: %s", degraded)
    elif allow_vector and not embedding.is_available():
        degraded = "未配置嵌入模型（APP_EMBEDDING_API_KEY 为空）"

    if not rankings and bm25_fallback:
        # 走到这里说明：向量路没有产出（异常或未配置），
        # 而关键词结果又因「信息量不足」被跳过。
        # 此时宁可给低置信度的召回，也不该返回空让问答直接拒答——
        # 用户至少还能看到相关原文，并可据此判断检索质量。
        rankings["bm25"] = bm25_fallback
        degraded = (
            (degraded + "；" if degraded else "")
            + "向量检索不可用，已回退到关键词检索结果（置信度较低）"
        )
        logger.info("向量不可用，回退到 BM25: %d 条", len(bm25_fallback))

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
