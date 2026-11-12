"""Agent 执行轨迹的 ORM 模型。

为什么要落库（评审意见原文要求"落库执行轨迹"）：
  只把轨迹放在 HTTP 响应里，刷新页面就没了 —— 既不能复盘"模型上次是怎么想的"，
  也无法统计"哪个工具最常失败"。落库后可以：
    1. 界面展示「最近执行」，评审能回看；
    2. 统计工具使用率与失败率，为后续调优提供依据。

为什么拆两张表：
  run 是"一次任务"，step 是"这一步调了什么"。合成一张表要存 JSON 数组，
  查询"某工具失败率"就得在应用层展开，失去 SQL 的意义。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _now() -> datetime:
    return datetime.now(UTC)


class AgentRun(Base):
    """一次 Agent 任务。"""

    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: "run_" + uuid.uuid4().hex[:12]
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, default="")

    # 用逗号拼存工具名：这里只做展示与粗统计，不值得再建关联表
    used_tools: Mapped[str] = mapped_column(Text, default="")
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    steps: Mapped[list[AgentStep]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentStep.index",
        lazy="selectin",       # 列表页要显示步数，避免 N+1
    )


class AgentStep(Base):
    """轨迹中的一步：思考 + 工具 + 参数 + 观测。"""

    __tablename__ = "agent_steps"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: "stp_" + uuid.uuid4().hex[:12]
    )
    run_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True
    )
    index: Mapped[int] = mapped_column(Integer, default=0)
    thought: Mapped[str] = mapped_column(Text, default="")
    tool: Mapped[str] = mapped_column(String(64), default="")
    args_json: Mapped[str] = mapped_column(Text, default="{}")
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    observation: Mapped[str] = mapped_column(Text, default="")

    run: Mapped[AgentRun] = relationship(back_populates="steps")
