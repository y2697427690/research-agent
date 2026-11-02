"""订阅接口测试。

不联网：把 discover.search 换成假函数，只验证
「新建 / 去重 / 检查一次 / 删除」这几条业务规则。
真实 arXiv 检索由手动触发与线上验证覆盖。
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.services import discover as discover_service
from app.services import subscription_service

pytestmark = pytest.mark.asyncio


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


def _fake_item(arxiv_id: str, version: str = "v1", title: str = "Test Paper"):
    return discover_service.ArxivItem(
        arxiv_id=arxiv_id,
        version=version,
        title=title,
        authors=["Alice", "Bob"],
        summary="abstract text",
        published="2026-10-01",
        abs_url=f"https://arxiv.org/abs/{arxiv_id}",
        pdf_url=f"https://arxiv.org/pdf/{arxiv_id}",
    )


async def test_create_and_list(client):
    c, _ = client
    r = await c.post("/api/v1/subscriptions", json={"keyword": "speculative decoding"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["keyword"] == "speculative decoding"
    assert body["hit_count"] == 0
    assert body["category"] is None

    listed = (await c.get("/api/v1/subscriptions")).json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == body["id"]


async def test_duplicate_keyword_returns_same_subscription(client):
    c, _ = client
    first = (await c.post("/api/v1/subscriptions", json={"keyword": "LoRA"})).json()
    second = (await c.post("/api/v1/subscriptions", json={"keyword": "LoRA"})).json()
    assert first["id"] == second["id"], "同一关键词不应重复建订阅"
    assert (await c.get("/api/v1/subscriptions")).json()["total"] == 1


async def test_check_adds_hits_and_dedupes(client, monkeypatch):
    """检查一次应写入命中；同样的结果再检查一次不应重复写入。"""
    c, _ = client
    sub = (await c.post("/api/v1/subscriptions", json={"keyword": "diffusion"})).json()

    async def fake_search(query, max_results=20, sort="relevance"):
        return [_fake_item("2510.00001"), _fake_item("2510.00002")]

    monkeypatch.setattr(discover_service, "search", fake_search)

    first = (await c.post(f"/api/v1/subscriptions/{sub['id']}/check")).json()
    assert first["fetched"] == 2
    assert first["added"] == 2

    second = (await c.post(f"/api/v1/subscriptions/{sub['id']}/check")).json()
    assert second["fetched"] == 2
    assert second["added"] == 0, "同一篇论文不应重复推荐"

    hits = (await c.get(f"/api/v1/subscriptions/{sub['id']}/hits")).json()
    assert len(hits) == 2
    # in_library 默认 False（测试库没有论文）
    assert hits[0]["in_library"] is False


async def test_check_marks_in_library(client, monkeypatch):
    """抓到的论文若已在库，要标 in_library=True，前端才能直接显示「已在库」。"""
    c, maker = client
    from app.models.paper import Paper

    async with maker() as db:
        db.add(Paper(id="p1", file_name="p1.pdf", file_path="x/p1.pdf",
                     size_bytes=1, sha1="aa", arxiv_id="2510.00001"))
        await db.commit()

    sub = (await c.post("/api/v1/subscriptions", json={"keyword": "x"})).json()

    async def fake_search(query, max_results=20, sort="relevance"):
        return [_fake_item("2510.00001")]

    monkeypatch.setattr(discover_service, "search", fake_search)
    await c.post(f"/api/v1/subscriptions/{sub['id']}/check")

    hits = (await c.get(f"/api/v1/subscriptions/{sub['id']}/hits")).json()
    assert hits[0]["in_library"] is True


async def test_delete_subscription_and_hits(client, monkeypatch):
    c, _ = client
    sub = (await c.post("/api/v1/subscriptions", json={"keyword": "rag"})).json()

    async def fake_search(query, max_results=20, sort="relevance"):
        return [_fake_item("2510.00009")]

    monkeypatch.setattr(discover_service, "search", fake_search)
    await c.post(f"/api/v1/subscriptions/{sub['id']}/check")

    r = await c.delete(f"/api/v1/subscriptions/{sub['id']}")
    assert r.status_code == 200
    assert (await c.get("/api/v1/subscriptions")).json()["total"] == 0
    # 级联：订阅没了，它的命中记录也不该留下
    assert (await c.get(f"/api/v1/subscriptions/{sub['id']}/hits")).status_code == 404


async def test_404_for_unknown_subscription(client):
    c, _ = client
    assert (await c.post("/api/v1/subscriptions/not-exist/check")).status_code == 404
    assert (await c.delete("/api/v1/subscriptions/not-exist")).status_code == 404
