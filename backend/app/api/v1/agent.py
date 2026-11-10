"""Agent 接口：工具清单 + 多步执行。

和 /qa 的区别：
  /qa 是固定流水线（检索 → 生成），一次请求一次回答；
  /agent 让模型自己决定调哪个工具、调几次，返回每一步的
  thought / 工具 / 参数 / 观测，界面上可以逐步展开 —— 这就是评审
  意见里说的"模型自己多步调用并落库执行轨迹"。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import loop, registry
from app.core.exceptions import InvalidRequest
from app.core.logging import get_logger
from app.db.session import get_db
from app.schemas.agent import (
    AgentRunRequest,
    AgentRunResponse,
    AgentStepOut,
    AgentToolListOut,
    AgentToolOut,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/agent", tags=["Agent"])


@router.get("/tools", response_model=AgentToolListOut, summary="可用的工具清单")
async def list_tools() -> AgentToolListOut:
    """把注册表原样暴露出来，便于前端展示「这个 Agent 能干什么」。"""
    items = [
        AgentToolOut(name=t.name, description=t.description, parameters=t.parameters)
        for t in registry.TOOLS.values()
    ]
    return AgentToolListOut(items=items, total=len(items))


@router.post("/run", response_model=AgentRunResponse, summary="Agent 多步执行")
async def run_agent(
    payload: AgentRunRequest,
    db: AsyncSession = Depends(get_db),
) -> AgentRunResponse:
    try:
        result = await loop.run(db, payload.question, payload.max_steps)
    except Exception as exc:  # noqa: BLE001 - 上游模型不可用等
        logger.warning("Agent 执行失败：%s", exc)
        raise InvalidRequest("Agent 执行失败，请稍后重试") from exc

    return AgentRunResponse(
        question=result["question"],
        answer=result["answer"],
        steps=[AgentStepOut(**s) for s in result["steps"]],
        used_tools=result["used_tools"],
        tool_calls=result["tool_calls"],
    )
