"""参考文献接口的测试。

三个关键做法：
  1. 用内存 SQLite + StaticPool，接口与建表共享同一个连接；
  2. 用 httpx.ASGITransport 代替 TestClient —— 让建表、造数据、发请求
     全都在同一个事件循环里。TestClient 会自建线程与循环，
     再在主线程 asyncio.run 造数据，aiosqlite 的连接会跨循环报错；
  3. pytest-asyncio 的 asyncio_mode=auto 已在 pyproject 配置，
     所以 async def 的测试函数会被自动执行，不需要装饰器。
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.chunk import Chunk
from app.models.citation import Citation
from app.models.paper import Paper

pytestmark = pytest.mark.asyncio


@pytest.fixture()
async def client():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # 建表：和在同一个循环里做，避免跨循环使用连接
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


async def _seed(maker, body_texts: list[str]) -> None:
    """造一篇论文 + 若干正文分块 + 3 条参考文献。

    file_path 是 NOT NULL（模型里没给默认值），必须显式给，
    否则 SQLite 会报 IntegrityError。
    """
    async with maker() as db:
        db.add(Paper(
            id="p-test",
            file_name="p-test.pdf",
            file_path="202601/p-test.pdf",
            size_bytes=1000,
            sha1="deadbeef",
            parse_status="done",
        ))
        for i, text in enumerate(body_texts):
            db.add(Chunk(
                id=f"c-{i}", paper_id="p-test", chunk_index=i, text=text,
                char_count=len(text), page_start=1, page_end=1,
            ))
        for n, title in enumerate(["Vaswani 2017", "Bahdanau 2015", "Britz 2017"], start=1):
            db.add(Citation(
                id=f"cit-{n}", source_paper_id="p-test", ref_index=n,
                target_title=title, match_method="title",
                raw_text=f"[{n}] {title}. Some Conference, 20xx.",
            ))
        await db.commit()


async def test_references_numeric_style(client):
    """正文里有 [1]、[2] → 数字制，且被引位置精确到分块。"""
    c, maker = client
    await _seed(maker, ["We use attention [1].", "Bahdanau et al [2] propose.", "no cite here"])

    r = await c.get("/api/v1/papers/p-test/references")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 3
    assert body["cited_total"] == 2
    assert body["citing_style"] == "numeric"
    assert body["note"] is None

    by_no = {it["ref_no"]: it for it in body["items"]}
    assert by_no[1]["cited_in"] == [0]
    assert by_no[2]["cited_in"] == [1]
    assert by_no[3]["cited_in"] == []
    # cited_count 是 dataclass 的 @property，不在 vars() 里，
    # 组装响应时必须显式传，否则会一直是 0（线上曾出现过：
    # cited_in 有值、cited_count 却是 0，前端全部显示"正文未引用"）
    assert by_no[1]["cited_count"] == 1
    assert by_no[2]["cited_count"] == 1
    assert by_no[3]["cited_count"] == 0
    # raw_text 开头的 [n] 必须被剥掉，否则前端显示双编号
    assert by_no[1]["text"].startswith("Vaswani")


async def test_references_author_year_style(client):
    """正文完全没有方括号 → 作者-年份式，并给出提示文案。"""
    c, maker = client
    await _seed(maker, ["As shown by Kaplan et al. (2020).", "Another claim."])

    body = (await c.get("/api/v1/papers/p-test/references")).json()
    assert body["citing_style"] == "author-year"
    assert body["cited_total"] == 0
    assert "作者-年份" in (body["note"] or "")


async def test_references_404_for_unknown_paper(client):
    """论文不存在 → 404，与其它 /papers 接口一致。"""
    c, _ = client
    r = await c.get("/api/v1/papers/not-exist/references")
    assert r.status_code == 404
