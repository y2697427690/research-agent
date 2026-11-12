"""Agent 接口的请求 / 响应模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AgentRunRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000, description="用户问题")
    max_steps: int = Field(4, ge=1, le=8, description="最多调用几次工具")


class AgentStepOut(BaseModel):
    index: int
    thought: str = ""
    tool: str = ""
    args: dict[str, Any] = Field(default_factory=dict)
    ok: bool = False
    observation: str = ""


class AgentRunResponse(BaseModel):
    run_id: str = Field("", description="落库后的执行 id，可用 /agent/history/{run_id} 回看")
    question: str
    answer: str
    steps: list[AgentStepOut] = Field(default_factory=list)
    used_tools: list[str] = Field(default_factory=list)
    tool_calls: int = 0


class AgentToolOut(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class AgentToolListOut(BaseModel):
    items: list[AgentToolOut] = Field(default_factory=list)
    total: int = 0


class AgentRunHistoryItem(BaseModel):
    id: str
    question: str
    answer: str = ""
    used_tools: list[str] = Field(default_factory=list)
    tool_calls: int = 0
    created_at: datetime
    step_count: int = 0


class AgentHistoryOut(BaseModel):
    items: list[AgentRunHistoryItem] = Field(default_factory=list)
    total: int = 0


class AgentRunDetailOut(AgentRunHistoryItem):
    steps: list[AgentStepOut] = Field(default_factory=list)
