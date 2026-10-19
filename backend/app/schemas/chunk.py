"""论文正文分块的响应模型。

阅读器需要按章节渲染真实正文，因此把分块暴露成一个只读接口。
注意这里返回的是「检索用的块」，不是 PDF 的原始段落：
块的边界由分块策略决定（约 700 字符、带重叠），
因此相邻块可能有少量重复文字，这是为检索召回率做的取舍。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ChunkOut(BaseModel):
    """一个正文分块。"""

    id: str
    chunk_index: int
    text: str
    char_count: int = 0
    section_title: str | None = None
    level: int = 0
    page_start: int = 1
    page_end: int = 1
    embedded: bool = Field(False, description="是否已生成向量")


class ChunksResponse(BaseModel):
    """某篇论文的全部分块，按序号升序。"""

    paper_id: str
    page_count: int | None = None
    chunks: list[ChunkOut] = Field(default_factory=list)
