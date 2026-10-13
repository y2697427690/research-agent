"""通用响应模型。

用 Pydantic 定义接口的输入输出结构，FastAPI 据此自动校验并生成 /docs 文档。
"""
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """分页响应的统一结构。

    用法：Page[PaperOut] 表示「论文列表的分页结果」。
    """

    items: list[T] = Field(default_factory=list, description="当前页数据")
    total: int = Field(default=0, description="总条数")
    page: int = Field(default=1, description="当前页码，从 1 开始")
    page_size: int = Field(default=20, description="每页条数")


class Ok(BaseModel):
    """仅表示操作成功的响应。"""

    ok: bool = True


class ErrorDetail(BaseModel):
    """错误响应中的 error 字段。

    与 app/core/exceptions.py 里 error_body() 产出的结构保持一致。
    """

    code: str = Field(description="错误码，供前端判断处理分支")
    message: str = Field(description="面向用户的错误说明")
    detail: dict = Field(default_factory=dict, description="附加信息，便于排查")


class ErrorResponse(BaseModel):
    """统一错误响应。"""

    error: ErrorDetail