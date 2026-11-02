"""订阅接口的请求 / 响应模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SubscriptionCreate(BaseModel):
    """新建订阅。"""

    keyword: str = Field(..., min_length=1, max_length=200, description="关键词或 arXiv 查询语法")
    category: str | None = Field(None, max_length=32, description="可选分类过滤，如 cs.CL")
    max_results: int = Field(20, ge=1, le=50, description="每次抓取条数")

    @property
    def effective_query(self) -> str:
        """把分类拼进查询：arXiv 支持 cat:cs.CL AND all:keyword。

        为什么要拼：用户只填关键词时，全站检索会把不相关学科的结果也带进来；
        限定分类后噪声明显更小。
        """
        q = self.keyword.strip()
        if not self.category:
            return q
        return f"cat:{self.category.strip()} AND all:{q}"


class SubscriptionHitOut(BaseModel):
    """一条抓取结果。"""

    id: str
    arxiv_id: str
    version: str | None = None
    title: str
    authors: str = ""
    summary: str = ""
    published: str | None = None
    abs_url: str | None = None
    pdf_url: str | None = None
    in_library: bool = False
    found_at: datetime


class SubscriptionOut(BaseModel):
    """一条订阅（含命中统计）。"""

    id: str
    keyword: str
    category: str | None = None
    max_results: int
    enabled: bool
    last_checked_at: datetime | None = None
    created_at: datetime
    hit_count: int = Field(0, description="累计抓到的论文数（已去重）")
    new_count: int = Field(0, description="最近一次检查新增的条数")
    latest: list[SubscriptionHitOut] = Field(
        default_factory=list, description="最近 3 条，用于列表页预览"
    )


class SubscriptionListOut(BaseModel):
    items: list[SubscriptionOut] = Field(default_factory=list)
    total: int = 0


class SubscriptionCheckOut(BaseModel):
    """手动触发一次检查的结果。"""

    subscription_id: str
    fetched: int = Field(0, description="检索到的条数")
    added: int = Field(0, description="去重后新增的条数")
    message: str = ""
