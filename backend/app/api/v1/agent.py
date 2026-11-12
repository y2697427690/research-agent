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
    AgentHistoryOut,
    AgentRunDetailOut,
    AgentRunHistoryItem,
    AgentRunRequest,
    AgentRunResponse,
    AgentStepOut,
    AgentToolListOut,
    AgentToolOut,
)
from app.services import agent_history_service

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

    # 落库：评审要求"落库执行轨迹"，刷新后还能在「最近执行」里回看
    run_id = await agent_history_service.save_run(db, result)
    await db.commit()

    return AgentRunResponse(
        question=result["question"],
        answer=result["answer"],
        steps=[AgentStepOut(**s) for s in result["steps"]],
        used_tools=result["used_tools"],
        tool_calls=result["tool_calls"],
        run_id=run_id,
    )


@router.get("/history", response_model=AgentHistoryOut, summary="最近执行轨迹")
async def list_history(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
) -> AgentHistoryOut:
    """列出最近几次执行（含步数），点击可看完整轨迹。"""
    runs = await agent_history_service.recent(db, limit)
    items = [
        AgentRunHistoryItem(
            id=r.id, question=r.question, answer=r.answer,
            used_tools=[t for t in (r.used_tools or "").split(",") if t],
            tool_calls=r.tool_calls, created_at=r.created_at,
            step_count=len(r.steps or []),
        )
        for r in runs
    ]
    return AgentHistoryOut(items=items, total=len(items))


@router.get("/history/{run_id}", response_model=AgentRunDetailOut, summary="某次执行的完整轨迹")
async def get_history(
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> AgentRunDetailOut:
    run = await agent_history_service.get(db, run_id)
    if run is None:
        raise InvalidRequest(f"轨迹不存在：{run_id}")
    data = agent_history_service.to_dict(run)
    return AgentRunDetailOut(
        id=data["id"], question=data["question"], answer=data["answer"],
        used_tools=data["used_tools"], tool_calls=data["tool_calls"],
        created_at=data["created_at"], step_count=len(data["steps"]),
        steps=[AgentStepOut(**st) for st in data["steps"]],
    )
