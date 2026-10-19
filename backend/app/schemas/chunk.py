"""分块查询与翻译的响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ChunkOut(BaseModel):
    """一个正文分块。

    text_zh 是中文字段：未翻译时为 None，前端据此决定显示原文还是译文。
    """

    id: str
    chunk_index: int
    text: str
    text_zh: str | None = Field(None, description="中文译文，未翻译时为 null")
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
    total_chunks: int = 0
    translated_chunks: int = Field(0, description="已翻译的分块数")
    chunks: list[ChunkOut] = Field(default_factory=list)


class TranslateRequest(BaseModel):
    """翻译请求。"""

    lang: str = Field("zh", description="目标语言，当前仅支持 zh")
    limit: int | None = Field(
        None, ge=1, le=100,
        description="本次最多翻译多少块。分批推进可避免请求过久",
    )
    concurrency: int = Field(4, ge=1, le=8, description="并发请求数")


class TranslateResponse(BaseModel):
    """翻译任务结果。"""

    paper_id: str
    lang: str
    total: int = Field(0, description="本次待翻译块数")
    translated: int = 0
    failed: int = 0
    chars: int = 0
    model: str | None = None
    progress: tuple[int, int] = Field(
        (0, 0), description="(分块总数, 已翻译数)，便于前端显示整体进度"
    )
    errors: list[str] = Field(default_factory=list)
