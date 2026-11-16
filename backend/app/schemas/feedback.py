"""点赞/踩的请求与响应。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class FeedbackIn(BaseModel):
    value: int = Field(..., description="1 = 赞，-1 = 踩")


class FeedbackOut(BaseModel):
    paper_id: str
    up: int = 0
    down: int = 0
