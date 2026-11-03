"""订阅的定时检查：调度器 + 到点判断。

拆成两层是为了可测试：
  · `should_check()`  纯函数，不碰数据库、不碰网络 —— 可以精确测"多久算过期"；
  · `run_due_checks()` 遍历启用的订阅，逐个调用 subscription_service.check()。

为什么不直接把逻辑写在 lifespan 里：
  lifespan 只负责"起/停调度器"，具体策略放这里，
  以后要改成"每周一次"或"按订阅单独设频率"都不用动启动代码。
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.services import subscription_service

logger = get_logger(__name__)

# arXiv 官方要求两次请求间隔 ≥3 秒，这里留 4 秒余量。
# 串行 + 间隔而不是并发：几个订阅同时抓容易触发限流，得不偿失。
BETWEEN_SUBSCRIPTIONS_SECONDS = 4.0


def should_check(
    last_checked_at: datetime | None,
    now: datetime | None = None,
    min_interval_hours: int = 20,
) -> bool:
    """判断这条订阅现在该不该抓。

    min_interval_hours 默认 20 而不是 24：给调度抖动留余量。
    比如每天 9:00 跑，某天因为重启晚了 2 小时，
    24 小时的严格间隔会让它跳过一整天；20 小时则仍会补上。
    """
    if last_checked_at is None:
        return True
    moment = now or datetime.now(UTC)
    # 数据库里可能存的是 naive datetime（SQLite 不保留时区），统一按 UTC 处理
    if last_checked_at.tzinfo is None:
        last_checked_at = last_checked_at.replace(tzinfo=UTC)
    return moment - last_checked_at >= timedelta(hours=min_interval_hours)


async def run_due_checks(
    session_factory: Callable[[], AsyncSession],
    min_interval_hours: int = 20,
) -> dict:
    """把所有"到点"的订阅各抓一次，返回统计。

    单条订阅失败不影响其他：arXiv 限流、网络抖动都可能发生，
    整批回滚会让其他订阅白跑一遍。
    """
    stats = {"checked": 0, "skipped": 0, "added": 0, "failed": 0}

    async with session_factory() as db:
        subs = await subscription_service.list_all(db, enabled_only=True)

    for sub in subs:
        if not should_check(sub.last_checked_at, min_interval_hours=min_interval_hours):
            stats["skipped"] += 1
            continue

        # 每次单独开 session：一条失败不污染其他订阅的状态
        try:
            async with session_factory() as db:
                fresh = await subscription_service.get(db, sub.id)
                if fresh is None:
                    continue
                result = await subscription_service.check(db, fresh)
                await db.commit()
                stats["checked"] += 1
                stats["added"] += result["added"]
        except Exception as exc:  # noqa: BLE001 - 上游网络/限流都算失败
            stats["failed"] += 1
            logger.warning("订阅 %s 自动检查失败：%s", sub.id, exc)

        await asyncio.sleep(BETWEEN_SUBSCRIPTIONS_SECONDS)

    logger.info(
        "订阅自动检查完成：检查 %d / 跳过 %d / 新增 %d / 失败 %d",
        stats["checked"], stats["skipped"], stats["added"], stats["failed"],
    )
    return stats
