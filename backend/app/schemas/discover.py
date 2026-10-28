"""论文发现（arXiv 检索与入库）的请求与响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.paper import DuplicateInfo, PaperOut


class ArxivItemOut(BaseModel):
    """一条 arXiv 检索结果。字段与前端卡片一一对应。"""

    arxiv_id: str = Field(..., description="去掉版本号的编号，如 1706.03762")
    version: str | None = Field(None, description="版本号，如 v5")
    title: str
    authors: list[str] = Field(default_factory=list)
    summary: str = Field("", description="摘要原文（较长，由前端截断）")
    published: str | None = Field(None, description="首发日期 YYYY-MM-DD")
    updated: str | None = None
    primary_category: str | None = Field(None, description="主分类，如 cs.CL")
    categories: list[str] = Field(default_factory=list)
    comment: str | None = Field(None, description="作者备注，常含会议/期刊接收信息")
    pdf_url: str = ""
    abs_url: str = ""
    in_library: bool = Field(
        False, description="该编号是否已在库中（前端据此把按钮显示为「已在库」）"
    )
    withdrawn: bool = Field(
        False,
        description="arXiv 已撤稿：没有 PDF 可下载，前端应禁用「入库」按钮并说明原因",
    )


class DiscoverSearchResponse(BaseModel):
    """检索结果。"""

    query: str = Field(..., description="用户原始输入")
    effective_query: str = Field("", description="实际发给 arXiv 的查询语句")
    total: int = 0
    items: list[ArxivItemOut] = Field(default_factory=list)
    hint: str | None = Field(
        None,
        description="用于界面提示的说明，例如零结果时提示可换关键词或使用 arXiv 语法",
    )


class IngestRequest(BaseModel):
    """把某篇 arXiv 论文下载入库。"""

    arxiv_id: str = Field(..., min_length=3, description="arXiv 编号，如 1706.03762")
    force: bool = Field(
        False,
        description="为 true 时即使检出重复也强制入库（用户已确认保留）",
    )


class IngestResponse(BaseModel):
    """入库结果。

    与上传接口保持一致的两态：
      accepted=True  已入库，paper 里有论文信息
      accepted=False 检出重复，duplicate 里说明与哪篇重复
    """

    accepted: bool = False
    arxiv_id: str = ""
    file_name: str = ""
    paper: PaperOut | None = None
    duplicate: DuplicateInfo | None = None
    message: str = ""
