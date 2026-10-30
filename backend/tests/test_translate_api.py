"""通用翻译接口的后端测试。

不联网：把 llm.chat 换成假函数，只验证「提示词方向、缓存、错误处理」这三件事。
真实模型调用由线上验证脚本覆盖。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.services.translate_service as ts
from app.core.exceptions import LLMUnavailable
from app.main import app


@pytest.fixture()
def client():
    ts.clear_text_cache()
    with TestClient(app) as c:
        yield c
    ts.clear_text_cache()


def test_zh2en_calls_model_and_returns_text(client, monkeypatch):
    calls: list[list[dict]] = []

    async def fake_chat(messages, temperature=0.0, **kwargs):
        calls.append(messages)
        return "We propose a new attention mechanism."

    monkeypatch.setattr(ts.llm, "chat", fake_chat)
    r = client.post("/api/v1/translate",
                    json={"text": "我们提出了一个新的注意力机制。", "direction": "zh2en"})
    assert r.status_code == 200
    body = r.json()
    assert body["text"].startswith("We propose")
    assert body["direction"] == "zh2en"
    assert body["cached"] is False
    # 用的是「中译英」提示词，而不是整篇论文那套英译中提示词
    assert "中文摘要翻译成英文" in calls[0][0]["content"]


def test_same_text_hits_cache(client, monkeypatch):
    count = {"n": 0}

    async def fake_chat(messages, temperature=0.0, **kwargs):
        count["n"] += 1
        return "cached translation"

    monkeypatch.setattr(ts.llm, "chat", fake_chat)
    payload = {"text": "同一段中文", "direction": "zh2en"}
    first = client.post("/api/v1/translate", json=payload).json()
    second = client.post("/api/v1/translate", json=payload).json()
    assert first["cached"] is False
    assert second["cached"] is True
    assert count["n"] == 1, "第二次应命中缓存，不再调用模型"


def test_llm_unavailable_is_reported(client, monkeypatch):
    async def fake_chat(messages, temperature=0.0, **kwargs):
        raise LLMUnavailable("未配置 APP_LLM_API_KEY")

    monkeypatch.setattr(ts.llm, "chat", fake_chat)
    r = client.post("/api/v1/translate", json={"text": "测试", "direction": "zh2en"})
    assert r.status_code in (503, 500)
    assert "APP_LLM_API_KEY" in r.text or "模型" in r.text


def test_empty_text_rejected_by_schema(client):
    r = client.post("/api/v1/translate", json={"text": "", "direction": "zh2en"})
    assert r.status_code == 422
