"""自动综述的测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.citation import Citation
from app.models.paper import Paper
from app.services import llm, survey_service


@pytest.fixture()
async def maker():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield session_maker
    await engine.dispose()


async def _seed(maker):
    async with maker() as db:
        db.add_all([
            Paper(id="p1", file_name="1.pdf", file_path="x/1.pdf", size_bytes=1,
                  sha1="a1", title="Foundational Work", abstract="basis"),
            Paper(id="p2", file_name="2.pdf", file_path="x/2.pdf", size_bytes=1,
                  sha1="a2", title="Derivative Work", abstract="follow-up"),
        ])
        # 让 p1 被引用 2 次，p2 一次都没有 → 综述应按 p1 在前
        db.add_all([
            Citation(id="c1", source_paper_id="p2", ref_index=1, target_paper_id="p1"),
            Citation(id="c2", source_paper_id="p2", ref_index=2, target_paper_id="p1"),
        ])
        await db.commit()


async def test_survey_orders_by_in_degree(maker, monkeypatch):
    await _seed(maker)
    prompts: list[str] = []

    async def fake_chat(messages, temperature=0.0, **kwargs):
        prompts.append(messages[-1]["content"])
        return "该方向以《Foundational Work》为奠基，《Derivative Work》在其上改进。"

    monkeypatch.setattr(llm, "chat", fake_chat)
    async with maker() as db:
        result = await survey_service.build(db)

    assert result["papers"][0]["title"] == "Foundational Work"
    assert result["papers"][0]["in_degree"] == 2
    assert result["papers"][1]["in_degree"] == 0
    # 提示词里必须带清单，否则模型无从下笔
    assert "Foundational Work" in prompts[0]


async def test_survey_truncates_by_sentence(maker, monkeypatch):
    await _seed(maker)
    long_text = "第一句介绍背景。" * 20   # 远超 250 字

    async def fake_chat(messages, temperature=0.0, **kwargs):
        return long_text

    monkeypatch.setattr(llm, "chat", fake_chat)
    async with maker() as db:
        result = await survey_service.build(db)
    assert len(result["summary"]) <= survey_service.MAX_CHARS
    # 截断后仍以完整句号结尾，不能是半句
    assert result["summary"].endswith("。")


async def test_survey_rejects_empty_library(maker):
    with pytest.raises(ValueError):
        async with maker() as db:
            await survey_service.build(db)
