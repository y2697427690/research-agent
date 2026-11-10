"""推荐相关（1.4.3）的测试。

覆盖两件事：
  1. _has_code：只看摘要/备注里的仓库域名，宁可漏报不误报；
  2. /discover/reason：返回首行理由 + 相关论文匹配，且失败时给可读错误。
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.paper import Paper
from app.services import llm, recommend_service
from app.services.discover import _has_code


def test_has_code_detects_common_hosts():
    assert _has_code("code: https://github.com/foo/bar", None) is True
    assert _has_code("模型与数据见 huggingface.co/xxx", "") is True
    assert _has_code("摘要里没有仓库", "备注也没有") is False
    # 只在 comment 里提到也要认
    assert _has_code("", "Code at gitlab.com/a/b") is True


def test_has_code_does_not_match_bare_words():
    """提到 github 但没写域名时不算 —— 避免把"我们在 GitHub 上讨论过"当成有代码。"""
    assert _has_code("we discussed this on GitHub", None) is False


@pytest.fixture()
async def client():
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
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c, maker
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_reason_returns_first_line_and_related(client, monkeypatch):
    c, maker = client
    async with maker() as db:
        db.add(Paper(id="p1", file_name="a.pdf", file_path="x/a.pdf", size_bytes=1,
                     sha1="aa", title="Attention Is All You Need"))
        await db.commit()

    async def fake_chat(messages, temperature=0.0, **kwargs):
        # 故意给多行，验证只取第一行
        return "该文在 Attention Is All You Need 的基础上改进注意力。\n（第二行应被丢弃）"

    monkeypatch.setattr(llm, "chat", fake_chat)
    r = await c.post("/api/v1/discover/reason",
                     json={"title": "New Paper", "summary": "abstract", "arxiv_id": "2510.1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reason"] == "该文在 Attention Is All You Need 的基础上改进注意力。"
    assert "Attention Is All You Need" in body["related"]


async def test_reason_failure_is_readable(client, monkeypatch):
    c, _ = client

    async def boom(messages, temperature=0.0, **kwargs):
        raise RuntimeError("upstream 500")

    monkeypatch.setattr(llm, "chat", boom)
    r = await c.post("/api/v1/discover/reason", json={"title": "X", "summary": ""})
    assert r.status_code == 400
    assert "推荐理由" in r.text
