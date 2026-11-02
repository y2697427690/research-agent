"""参考文献接口的响应模型。

为什么要单独一个 schema 文件：
  参考文献视图虽然挂在 /papers 下，但它的字段（ref_no / cited_in / match_method）
  和论文模型的字段毫无关系，塞进 paper.py 只会让那个文件继续膨胀。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ReferenceItemOut(BaseModel):
    """一条参考文献 + 它在正文里的位置信息。"""

    ref_no: int = Field(..., description="参考文献编号，从 1 开始")
    text: str = Field("", description="参考文献原文（已剥掉开头的 [n] 前缀）")
    arxiv_id: str | None = Field(None, description="匹配到的 arXiv 编号")
    matched_paper_id: str | None = Field(None, description="若在库内，对应论文 id")
    matched_title: str | None = Field(None, description="匹配到的标题")
    match_method: str = Field("none", description="匹配方式：arxiv / title / none")
    cited_count: int = Field(0, description="正文里引用它的段落数")
    cited_in: list[int] = Field(
        default_factory=list,
        description="引用它的分块序号（升序），前端用来「跳到正文」",
    )


class ReferenceListOut(BaseModel):
    """一篇论文的完整参考文献视图。"""

    paper_id: str
    total: int = Field(0, description="参考文献总条数")
    cited_total: int = Field(0, description="被正文引用过的条数")
    citing_style: str = Field(
        "numeric",
        description="引用体系：numeric（[12] 式）/ author-year（(Smith, 2020) 式）",
    )
    note: str | None = Field(
        None,
        description="给用户看的说明，例如作者-年份式暂不支持跳转",
    )
    items: list[ReferenceItemOut] = Field(default_factory=list)


