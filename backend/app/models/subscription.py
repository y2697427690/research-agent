"""订阅与订阅命中的 ORM 模型。

为什么是两张表而不是一张：
  订阅（关键词）是"规则"，抓到的论文是"结果"。规则要能改（换关键词、
  停用），结果要能保留（用户过几天才回来看）。
  放一张表里，"改关键词"就得连带改历史结果的归属，很容易改坏。

为什么 hits 用唯一约束 (subscription_id, arxiv_id) 去重：
  arXiv 的检索结果按相关度排序，同一篇论文会连续多天出现。
  没有唯一约束就会出现"同一篇论文推了 5 次"，用户会关掉订阅。
  去重放在数据库层，比在 Python 里查一遍再插入更可靠（并发也安全）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:12]


class Subscription(Base):
    """一条订阅：关键词（或 arXiv 查询语法）+ 抓取参数。"""

    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: new_id("sub_")
    )

    # 用户输入的查询，既可以是关键词（"speculative decoding"），
    # 也可以是 arXiv 语法（ti:transformer）。
    keyword: Mapped[str] = mapped_column(String(200), nullable=False, index=True)

    # 可选的分类过滤，例如 cs.CL；为空表示全站检索。
    category: Mapped[str | None] = mapped_column(String(32), default=None)

    # 每次抓多少条。太大容易把一次抓取拖成几分钟，20 是经验值。
    max_results: Mapped[int] = mapped_column(Integer, default=20)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # 上次检查时间：调度器据此判断"今天是否已经抓过"，也用于前端显示"3 小时前更新"。
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    hits: Mapped[list[SubscriptionHit]] = relationship(
        back_populates="subscription",
        cascade="all, delete-orphan",
        lazy="selectin",   # 列表页要显示命中数，一次性取回避免 N+1
    )


class SubscriptionHit(Base):
    """一条抓取结果：某次检查为某个订阅找到的论文。"""

    __tablename__ = "subscription_hits"
    __table_args__ = (
        # 同一订阅下同一篇论文只留一条 —— 这就是"不重复推荐"的实现方式
        UniqueConstraint("subscription_id", "arxiv_id", name="uq_sub_arxiv"),
    )

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: new_id("hit_")
    )

    subscription_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("subscriptions.id", ondelete="CASCADE"),
        index=True,
    )

    arxiv_id: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str | None] = mapped_column(String(8), default=None)
    title: Mapped[str] = mapped_column(Text, nullable=False)

    # 作者用逗号拼接存：订阅推荐不需要结构化查询作者，
    # 单独建作者表属于过度设计。
    authors: Mapped[str] = mapped_column(Text, default="")

    summary: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[str | None] = mapped_column(String(16), default=None)
    abs_url: Mapped[str | None] = mapped_column(Text, default=None)
    pdf_url: Mapped[str | None] = mapped_column(Text, default=None)

    # 抓到时就已在库内：前端直接显示"已在库"，不必让用户白点一次入库
    in_library: Mapped[bool] = mapped_column(Boolean, default=False)

    found_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    subscription: Mapped[Subscription] = relationship(back_populates="hits")
