"""论文表。

P0 阶段只建这一张表，用于验证建表流程与数据库连通性。
"""
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utcnow() -> datetime:
    """返回带时区的当前 UTC 时间。

    统一用 UTC 存储，避免服务器时区变化导致时间错乱。
    """
    return datetime.now(UTC)


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)

    # 文件指纹，用于内容级去重（同一篇论文换文件名也能识别）
    sha1: Mapped[str] = mapped_column(String(40), unique=True, index=True)

    file_name: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    # 以下字段解析后才会有值
    title: Mapped[str | None] = mapped_column(Text, default=None)
    authors: Mapped[str | None] = mapped_column(Text, default=None)
    year: Mapped[int | None] = mapped_column(Integer, default=None)
    venue: Mapped[str | None] = mapped_column(String(256), default=None)
    arxiv_id: Mapped[str | None] = mapped_column(String(64), default=None, index=True)
    doi: Mapped[str | None] = mapped_column(String(128), default=None)
    abstract: Mapped[str | None] = mapped_column(Text, default=None)
    keywords: Mapped[str | None] = mapped_column(Text, default=None)

    # 解析状态机：queued -> parsing -> done / failed / need_review
    # need_review 表示解析成功但置信度低（如扫描件），需人工校对
    parse_status: Mapped[str] = mapped_column(
        String(16), default="queued", index=True
    )
    parse_error: Mapped[str | None] = mapped_column(Text, default=None)

    # 解析置信度，0~1，低于阈值时置为 need_review
    quality: Mapped[float | None] = mapped_column(Float, default=None)
    page_count: Mapped[int | None] = mapped_column(Integer, default=None)

    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    def __repr__(self) -> str:
        return f"<Paper {self.id} {self.file_name!r} status={self.parse_status}>"
