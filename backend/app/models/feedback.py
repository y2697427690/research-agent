"""论文点赞/踩。

没有用户体系，所以不做"一人一票"，只记录累计票数（演示足够）。
单选：同一台浏览器用 localStorage 记住已投，服务端不强制去重。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class PaperFeedback(Base):
    __tablename__ = "paper_feedback"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: "fb_" + uuid.uuid4().hex[:12]
    )
    paper_id: Mapped[str] = mapped_column(String(32), index=True)
    # +1 赞 / -1 踩
    value: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
