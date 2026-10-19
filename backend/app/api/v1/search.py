"""检索接口。

三个端点分工：
    POST /search            执行检索
    GET  /search/index      查看索引状态（有多少块、是否可向量检索）
    POST /papers/{id}/embed 为指定论文生成向量（放在 papers 路由下，此处不含）
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.schemas.search import (
    IndexStatusOut,
    SearchHitOut,
    SearchRequest,
    SearchResponse,
)
from app.services import chunk_service, embedding, retrieval

router = APIRouter(prefix="/search", tags=["检索"])


@router.post("", response_model=SearchResponse, summary="混合检索")
async def search(
    payload: SearchRequest,
    db: AsyncSession = Depends(get_db),
) -> SearchResponse:
    """检索论文正文。

    默认使用混合检索（BM25 + 向量 + RRF 融合）。嵌入服务不可用时
    自动降级为纯 BM25，并在 degraded_reason 中说明原因，
    而不是直接返回错误——检索能力变弱比完全不可用更有价值。
    """
    result = await retrieval.retrieve(
        db, payload.query, top_k=payload.top_k, allow_vector=payload.allow_vector
    )
    return SearchResponse(
        query=result.query,
        mode=result.mode,
        hits=[
            SearchHitOut(
                chunk_id=h.chunk_id,
                paper_id=h.paper_id,
                text=h.text,
                section_title=h.section_title,
                page_start=h.page_start,
                page_end=h.page_end,
                citation=h.citation,
                score=h.score,
                sources=h.sources,
                bm25_rank=h.bm25_rank,
                vector_rank=h.vector_rank,
            )
            for h in result.hits
        ],
        bm25_candidates=result.bm25_candidates,
        vector_candidates=result.vector_candidates,
        degraded_reason=result.degraded_reason,
    )


@router.get("/index", response_model=IndexStatusOut, summary="索引状态")
async def index_status(db: AsyncSession = Depends(get_db)) -> IndexStatusOut:
    """查看分块与向量的入库情况。

    用途：判断是否需要先调用嵌入接口。embedded 为 0 时检索只能走 BM25。
    """
    total, embedded = await chunk_service.count_chunks(db)
    available = embedding.is_available()

    if total == 0:
        hint = "empty"
    elif available and embedded > 0:
        hint = "hybrid"
    else:
        hint = "bm25"

    return IndexStatusOut(
        chunks=total,
        embedded=embedded,
        embedding_available=available,
        embedding_model=settings.embedding_model,
        mode_hint=hint,
    )
