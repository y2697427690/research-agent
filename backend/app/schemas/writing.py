"""写作助手的请求 / 响应。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class OutlineIn(BaseModel):
    idea: str = Field(..., min_length=2, max_length=500, description="研究想法")


class OutlineSection(BaseModel):
    title: str
    points: list[str] = Field(default_factory=list)


class OutlineRef(BaseModel):
    title: str
    paper_id: str | None = None
    in_library: bool = True


class OutlineOut(BaseModel):
    idea: str
    sections: list[OutlineSection] = Field(default_factory=list)
    references: list[OutlineRef] = Field(default_factory=list)
    candidates: list[dict] = Field(default_factory=list)
    degraded: bool = Field(False, description="模型未按 JSON 返回时为 true")


class DiagramIn(BaseModel):
    idea: str = Field(..., min_length=2, max_length=500)
    format: str = Field("mermaid", description="tikz / dot / mermaid / matplotlib")


class DiagramOut(BaseModel):
    format: str
    code: str = ""
    empty: bool = False
