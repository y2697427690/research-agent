"""通用文本翻译接口的请求 / 响应模型。

为什么单独一个 schema 文件：写作页的「中译英」不是翻译整篇论文，
而是翻译用户自己写的一小段中文摘要 —— 它的输入输出都很小，
和「按论文 id 翻译所有分块」是两件事，放一起只会让接口难读。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TranslateTextRequest(BaseModel):
    """请求体：一段待翻译的文本 + 方向。"""

    text: str = Field(
        ...,
        min_length=1,
        max_length=8000,
        description="待翻译原文。中文摘要通常 300~800 字，8000 是防御上限",
    )
    direction: Literal["zh2en", "en2zh"] = Field(
        "zh2en",
        description="翻译方向：zh2en（中→英，写作场景）/ en2zh（英→中，阅读场景）",
    )


class TranslateTextResponse(BaseModel):
    """响应体：译文 + 用的哪个模型 + 是否命中缓存。"""

    text: str = Field(..., description="译文")
    direction: str = Field(..., description="实际使用的翻译方向")
    model: str | None = Field(None, description="翻译所用模型，便于排查")
    cached: bool = Field(False, description="true 表示同一段文本之前翻译过，直接返回缓存")
