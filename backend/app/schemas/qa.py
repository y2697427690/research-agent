"""问答接口的请求与响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    """提问请求。"""

    question: str = Field(..., min_length=1, max_length=500, description="问题")
    top_k: int = Field(6, ge=1, le=20, description="检索并交给模型的片段数")
    allow_vector: bool = Field(True, description="是否允许向量检索")


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
