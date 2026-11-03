"""订阅定时检查的测试。

重点验证「到点判断」这条纯逻辑：抓太勤会被 arXiv 限流，抓太懒会漏更新。
不涉及真实网络：run_due_checks 里把 check 换成假函数。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.subscription import Subscription
from app.services import subscription_scheduler, subscription_service

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


def test_should_check_when_never_checked():
    assert subscription_scheduler.should_check(None) is True


def test_should_check_respects_interval():
    now = datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc)
    # 刚查过 2 小时 → 跳过
    assert subscription_scheduler.should_check(now - timedelta(hours=2), now) is False
    # 19 小时（差 1 小时）→ 仍然跳过
    assert subscription_scheduler.should_check(now - timedelta(hours=19), now) is False
    # 20 小时 → 到点
    assert subscription_scheduler.should_check(now - timedelta(hours=20), now) is True
    # 两天前 → 到点
    assert subscription_scheduler.should_check(now - timedelta(days=2), now) is True


def test_should_check_handles_naive_datetime():
    """SQLite 不保留时区，读回来的 datetime 是 naive 的，不能因此崩掉。"""
    now = datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc)
    naive_old = datetime(2026, 11, 1, 9, 0)          # 两天前，无时区
    assert subscription_scheduler.should_check(naive_old, now) is True


async def test_run_due_checks_skips_recent_and_counts(maker, monkeypatch):
    """到期才抓、未到期跳过，且统计数字正确。"""
    async with maker() as db:
        fresh = Subscription(keyword="fresh", last_checked_at=None)
        recent = Subscription(
            keyword="recent",
            last_checked_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db.add_all([fresh, recent])
        await db.commit()

    called: list[str] = []

    async def fake_check(db, sub):
        called.append(sub.keyword)
        return {"fetched": 3, "added": 2}

    monkeypatch.setattr(subscription_service, "check", fake_check)
    # 跳过订阅之间的 4 秒等待
    monkeypatch.setattr(subscription_scheduler, "BETWEEN_SUBSCRIPTIONS_SECONDS", 0)

    stats = await subscription_scheduler.run_due_checks(maker)
    assert called == ["fresh"], f"只应抓到期的那条，实际：{called}"
    assert stats["checked"] == 1
    assert stats["skipped"] == 1
    assert stats["added"] == 2


async def test_run_due_checks_survives_single_failure(maker, monkeypatch):
    """一条订阅抓失败，不能影响其他订阅，也不能把整批吞掉。"""

    async with maker() as db:
        db.add_all([Subscription(keyword="bad"), Subscription(keyword="good")])
        await db.commit()

    async def flaky_check(db, sub):
        if sub.keyword == "bad":
            raise RuntimeError("arXiv 429")
        return {"fetched": 1, "added": 1}

    monkeypatch.setattr(subscription_service, "check", flaky_check)
    monkeypatch.setattr(subscription_scheduler, "BETWEEN_SUBSCRIPTIONS_SECONDS", 0)

    stats = await subscription_scheduler.run_due_checks(maker)
    assert stats["failed"] == 1
    assert stats["checked"] == 1
    assert stats["added"] == 1
