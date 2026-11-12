"""Agent 轨迹落库的测试。

验证三件事：
  1. /agent/run 会把 run + steps 写进库，并回传 run_id；
  2. /agent/history 能列出、/agent/history/{id} 能读回完整轨迹；
  3. 不存在的 run_id 给可读错误，而不是 500。
"""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.agent_run import AgentRun, AgentStep  # noqa: F401  建表需要模型被导入
from app.services import llm


@pytest.fixture()
async def client(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def _override():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _override

    # 让 Agent 走一步工具再收尾，产生 2 条 step
    replies = [
        json.dumps({"thought": "先列论文", "action": "list_papers", "args": {}}, ensure_ascii=False),
        json.dumps({"thought": "可以回答", "final": "库里有 3 篇"}, ensure_ascii=False),
    ]

    async def fake_chat(messages, temperature=0.0, **kwargs):
        return replies.pop(0) if replies else json.dumps({"final": "结束"}, ensure_ascii=False)

    monkeypatch.setattr(llm, "chat", fake_chat)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c, maker
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_run_is_persisted(client):
    c, maker = client
    r = await c.post("/api/v1/agent/run", json={"question": "库里有几篇", "max_steps": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run_id"].startswith("run_")
    assert body["tool_calls"] == 1

    async with maker() as db:
        runs = (await db.execute(__import__("sqlalchemy").select(AgentRun))).scalars().all()
        assert len(runs) == 1
        assert runs[0].question == "库里有几篇"
        steps = (await db.execute(__import__("sqlalchemy").select(AgentStep))).scalars().all()
        assert len(steps) == 2, "应落库 2 步（工具 + final）"
        assert steps[0].tool == "list_papers"
        assert steps[0].ok is True
        # 参数以 JSON 字符串存，读回来能还原
        assert json.loads(steps[0].args_json) == {}


async def test_history_lists_and_returns_steps(client):
    c, _ = client
    run_id = (await c.post("/api/v1/agent/run", json={"question": "q1", "max_steps": 2})).json()["run_id"]

    lst = (await c.get("/api/v1/agent/history?limit=5")).json()
    assert lst["total"] == 1
    item = lst["items"][0]
    assert item["id"] == run_id
    assert item["step_count"] == 2

    detail = (await c.get(f"/api/v1/agent/history/{run_id}")).json()
    assert len(detail["steps"]) == 2
    assert detail["steps"][0]["thought"] == "先列论文"


async def test_history_unknown_id_is_readable(client):
    c, _ = client
    r = await c.get("/api/v1/agent/history/run_not_exist")
    assert r.status_code in (400, 404)
    assert "轨迹" in r.text
