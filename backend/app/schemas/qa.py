"""问答接口的请求与响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.services.rag import DEFAULT_TOP_K


class AskRequest(BaseModel):
    """提问请求。"""

    question: str = Field(..., min_length=1, max_length=500, description="问题")
    # 必须与服务层的 DEFAULT_TOP_K 保持一致：
    # 这里原先是写死的 6，服务层改成 8 之后两处脱节，
    # 导致「不传参数」的请求（也就是真实用户的默认路径）
    # 反而用回过时的值，实测会拒答「编码器由哪些子层组成」这类问题。
    top_k: int = Field(DEFAULT_TOP_K, ge=1, le=20, description="检索并交给模型的片段数")
    allow_vector: bool = Field(True, description="是否允许向量检索")
    paper_ids: list[str] = Field(
        default_factory=list,
        description="把检索限定在这些论文内；传 2 篇及以上时自动切换为对比模式",
    )


class CitationOut(BaseModel):
    """回答引用的一个来源。"""

    index: int = Field(..., description="回答中的引用编号")
    chunk_id: str
    paper_id: str
    citation: str = Field(..., description="出处描述，如「3.2 节（第 4 页）」")
    text: str = Field(..., description="原文片段")


class AnswerResponse(BaseModel):
    """非流式问答的响应。"""

    question: str
    answer: str
    citations: list[CitationOut] = Field(default_factory=list)
    invalid_marks: list[int] = Field(
        default_factory=list,
        description="模型引用但实际不存在的编号。非空说明模型编造了引用",
    )
    hit_count: int = 0
    mode: str = Field(..., description="hybrid / bm25 / empty")
    refused: bool = Field(False, description="是否因检索无命中而拒答")
