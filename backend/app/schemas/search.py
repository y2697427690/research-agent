"""检索相关的请求与响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """检索请求。"""

    query: str = Field(..., min_length=1, max_length=500, description="检索问题")
    top_k: int = Field(8, ge=1, le=50, description="返回条数")
    # 关闭后只走 BM25，便于对比混合检索的效果差异
    allow_vector: bool = Field(True, description="是否允许向量检索（关闭则仅 BM25）")


class SearchHitOut(BaseModel):
    """一条检索结果。"""

    chunk_id: str
    paper_id: str
    text: str
    section_title: str | None = None
    page_start: int
    page_end: int
    citation: str = Field(..., description="溯源描述，如「3.1 节（第 2 页）」")
    score: float = Field(..., description="RRF 融合分数")
    sources: list[str] = Field(default_factory=list, description="命中来源：bm25 / vector")
    bm25_rank: int | None = None
    vector_rank: int | None = None


class SearchResponse(BaseModel):
    """检索响应。"""

    query: str
    mode: str = Field(..., description="hybrid=混合检索；bm25=降级为纯关键词；empty=索引为空")
    hits: list[SearchHitOut] = Field(default_factory=list)
    bm25_candidates: int = 0
    vector_candidates: int = 0
    degraded_reason: str | None = Field(
        None, description="降级原因。非空说明当前未使用向量检索及原因"
    )


class IndexStatusOut(BaseModel):
    """索引状态。用于判断是否需要先执行嵌入。"""

    chunks: int = Field(..., description="分块总数")
    embedded: int = Field(..., description="已生成向量的分块数")
    embedding_available: bool = Field(..., description="是否配置了嵌入模型")
    embedding_model: str
    mode_hint: str = Field(..., description="当前可用的检索模式")


class EmbedRequest(BaseModel):
    """嵌入任务请求。"""

    limit: int | None = Field(None, ge=1, le=5000, description="本次最多处理多少块")


class EmbedResponse(BaseModel):
    """嵌入任务结果。"""

    paper_id: str | None
    total: int
    embedded: int
    failed: int
    dim: int | None
    errors: list[str] = Field(default_factory=list)
