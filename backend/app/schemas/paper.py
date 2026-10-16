"""论文相关的请求与响应模型。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# 解析状态机：与 models/paper.py 中的取值保持一致
PARSE_STATUSES = ("queued", "parsing", "done", "failed", "need_review")


class PaperOut(BaseModel):
    """论文详情的对外结构。

    from_attributes 让 Pydantic 能直接从 SQLAlchemy 的 ORM 对象转换，
    省掉手工逐字段拼装。
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    file_name: str = Field(description="上传时的原始文件名")
    size_bytes: int = Field(description="文件字节数")
    sha1: str = Field(description="内容指纹，用于去重")
    title: str | None = None
    authors: str | None = None
    year: int | None = None
    venue: str | None = None
    arxiv_id: str | None = None
    doi: str | None = None
    abstract: str | None = None
    keywords: str | None = None
    parse_status: str = Field(description="解析状态：queued/parsing/done/failed/need_review")
    parse_error: str | None = None
    quality: float | None = None
    page_count: int | None = None
    starred: bool = False
    added_at: datetime
    updated_at: datetime

class DuplicateInfo(BaseModel):
    """重复检测结果。kind 的取值语义见 services/dedupe.py。"""

    kind: str = Field(description="identical/newer_version/older_version/likely_duplicate")
    message: str = Field(description="给用户看的中文说明")
    existing_paper_id: str | None = None
    existing_file_name: str | None = None
    reasons: list[str] = Field(default_factory=list)

class PaperCreateResult(BaseModel):
    """上传单个文件的处理结果。"""

    accepted: bool = Field(description="是否已入库")
    file_name: str
    paper: PaperOut | None = Field(default=None, description="入库成功时的论文记录")
    duplicate: DuplicateInfo | None = Field(
        default=None, description="检出重复时返回，前端据此提示用户选择"
    )
    error: str | None = Field(default=None, description="处理失败的原因")

class UploadResponse(BaseModel):
    """POST /papers/upload 的响应。"""

    results: list[PaperCreateResult] = Field(default_factory=list)
    accepted: int = Field(default=0, description="成功入库数量")
    duplicates: int = Field(default=0, description="检出重复数量")
    failed: int = Field(default=0, description="失败数量")

class PaperUpdate(BaseModel):
    """PATCH /papers/{id} 的请求体。所有字段可选，只更新传入的部分。"""

    title: str | None = None
    authors: str | None = None
    year: int | None = Field(default=None, ge=1000, le=2999)
    venue: str | None = None
    arxiv_id: str | None = None
    doi: str | None = None
    abstract: str | None = None
    keywords: str | None = None
    starred: bool | None = None


