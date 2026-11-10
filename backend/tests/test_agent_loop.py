"""Agent 循环的离线测试：不联网，LLM 输出用脚本喂。

验证的是"循环本身"是否正确：
  · 模型给 final 就停；
  · 模型调工具 → 真实执行（空库检索返回 []）→ 观察回灌 → 再问；
  · 重复同参调用被拦；
  · 未知工具不炸，循环继续；
  · 到步数上限会再要一次「只收尾」的回答。
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.agent import loop
from app.db.base import Base
from app.services import llm


@pytest.fixture()
async def db():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with maker() as session:
        yield session
    await engine.dispose()


def scripted(monkeypatch, replies: list[str]) -> list[list[dict]]:
    """按顺序返回预设回复，并记录每次调用收到的 messages。"""
    seen: list[list[dict]] = []
    queue = list(replies)

    async def fake_chat(messages, temperature=0.0, **kwargs):
        seen.append(messages)
        return queue.pop(0) if queue else '{"thought": "结束", "final": "（无更多回复）"}'

    monkeypatch.setattr(llm, "chat", fake_chat)
    return seen


async def test_final_on_first_turn(db, monkeypatch):
    scripted(monkeypatch, [json.dumps({"thought": "直接答", "final": "这是回答"}, ensure_ascii=False)])
    r = await loop.run(db, "随便问问")
    assert r["answer"] == "这是回答"
    assert r["tool_calls"] == 0
    assert r["steps"][0]["tool"] == "final"


async def test_tool_then_final(db, monkeypatch):
    seen = scripted(monkeypatch, [
        json.dumps({"thought": "先检索", "action": "search_library", "args": {"query": "Transformer"}},
                   ensure_ascii=False),
        json.dumps({"thought": "够了", "final": "《Attention》提出了 Transformer"}, ensure_ascii=False),
    ])
    r = await loop.run(db, "谁提出了 Transformer")
    assert r["used_tools"] == ["search_library"]
    assert r["tool_calls"] == 1
    assert r["answer"] == "《Attention》提出了 Transformer"
    # 第二次调用时，上下文里必须带上工具的观测结果
    assert any("观测结果" in m["content"] for m in seen[1])


async def test_duplicate_tool_call_is_blocked(db, monkeypatch):
    same = json.dumps({"thought": "再查一次", "action": "search_library", "args": {"query": "x"}},
                      ensure_ascii=False)
    scripted(monkeypatch, [same, same, json.dumps({"thought": "停", "final": "ok"}, ensure_ascii=False)])
    r = await loop.run(db, "q", max_steps=3)
    assert r["tool_calls"] == 1, "同参重复调用不应真的执行两次"
    assert any("重复调用" in s["observation"] for s in r["steps"])


async def test_unknown_tool_does_not_crash(db, monkeypatch):
    scripted(monkeypatch, [
        json.dumps({"thought": "乱调", "action": "no_such_tool", "args": {}}, ensure_ascii=False),
        json.dumps({"thought": "改用直接答", "final": "兜底回答"}, ensure_ascii=False),
    ])
    r = await loop.run(db, "q")
    failed = [s for s in r["steps"] if s["tool"] == "no_such_tool"]
    assert failed and failed[0]["ok"] is False
    assert "工具不存在" in failed[0]["observation"]
    assert r["answer"] == "兜底回答"


async def test_max_steps_triggers_finalize(db, monkeypatch):
    """一直调工具时，会用最后一次「只收尾」的回复作为答案。"""
    call = json.dumps({"thought": "查", "action": "search_library", "args": {"query": "a"}},
                      ensure_ascii=False)
    call2 = json.dumps({"thought": "换词", "action": "search_library", "args": {"query": "b"}},
                       ensure_ascii=False)
    scripted(monkeypatch, [
        call, call2,
        json.dumps({"thought": "收尾", "final": "基于观察的答复"}, ensure_ascii=False),
    ])
    r = await loop.run(db, "q", max_steps=2)
    assert r["tool_calls"] == 2
    assert r["answer"] == "基于观察的答复"


async def test_bad_json_is_retried_then_final(db, monkeypatch):
    scripted(monkeypatch, [
        "我不是 JSON，我是一段废话",
        json.dumps({"thought": "修正", "final": "改正后的回答"}, ensure_ascii=False),
    ])
    r = await loop.run(db, "q")
    assert r["answer"] == "改正后的回答"
    assert any("格式错误" in s["observation"] for s in r["steps"])
