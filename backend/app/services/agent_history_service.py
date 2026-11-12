"""把一次 Agent 执行写库 / 读回来。

放在 service 而不是路由里：
  落库逻辑（JSON 编码、字段映射）与 HTTP 无关，放这里既能被接口复用，
  也能被"离线跑一批问题做统计"的脚本直接调用。
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import AgentRun, AgentStep


async def save_run(db: AsyncSession, result: dict) -> str:
    """保存一次执行，返回 run_id。"""
    run = AgentRun(
        question=result["question"],
        answer=result.get("answer", ""),
        used_tools=",".join(result.get("used_tools", [])),
        tool_calls=int(result.get("tool_calls", 0)),
    )
    db.add(run)
    await db.flush()   # 拿到 run.id 后才能挂 steps

    for s in result.get("steps", []):
        db.add(
            AgentStep(
                run_id=run.id,
                index=int(s.get("index", 0)),
                thought=s.get("thought", ""),
                tool=s.get("tool", ""),
                # 参数统一存 JSON 字符串：不同工具的参数结构不同，建列存不下
                args_json=json.dumps(s.get("args") or {}, ensure_ascii=False),
                ok=bool(s.get("ok")),
                observation=s.get("observation", ""),
            )
        )
    await db.flush()
    return run.id


def to_dict(run: AgentRun) -> dict:
    """ORM → 可序列化结构（含每一步）。"""
    return {
        "id": run.id,
        "question": run.question,
        "answer": run.answer,
        "used_tools": [t for t in (run.used_tools or "").split(",") if t],
        "tool_calls": run.tool_calls,
        "created_at": run.created_at,
        "steps": [
            {
                "index": s.index,
                "thought": s.thought,
                "tool": s.tool,
                "args": json.loads(s.args_json or "{}"),
                "ok": s.ok,
                "observation": s.observation,
            }
            for s in (run.steps or [])
        ],
    }


async def recent(db: AsyncSession, limit: int = 10) -> list[AgentRun]:
    return list(
        (
            await db.execute(
                select(AgentRun).order_by(AgentRun.created_at.desc()).limit(int(limit))
            )
        ).scalars().all()
    )


async def get(db: AsyncSession, run_id: str) -> AgentRun | None:
    return await db.get(AgentRun, run_id)
