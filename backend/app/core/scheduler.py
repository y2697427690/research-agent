"""定时任务：每天检查一遍订阅。

为什么用 AsyncIOScheduler 而不是 cron：
  项目要能在本地、Windows、容器里一键跑起来，cron 只存在于类 Unix 系统，
  而 APScheduler 是个纯 Python 库，跟着进程走，部署方式不用改。

为什么默认不启动：
  `settings.subscription_enabled` 默认 False。真正的定时抓取只应在部署环境开，
  否则本地开发/跑测试时每次启动都会去请求 arXiv（慢，还容易被限流）。
  线上通过 APP_SUBSCRIPTION_ENABLED=true 打开。
"""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import SessionLocal
from app.services import subscription_scheduler

logger = get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _run_daily_check() -> None:
    """定时任务入口。异常必须自己吞掉，否则调度器会把这个 job 停掉。"""
    try:
        await subscription_scheduler.run_due_checks(
            SessionLocal,
            min_interval_hours=settings.subscription_min_interval_hours,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("订阅定时任务异常：%s", exc)


def start_scheduler() -> AsyncIOScheduler | None:
    """按配置启动调度器；已关闭或已启动时返回 None。"""
    global _scheduler

    if not settings.subscription_enabled:
        logger.info("订阅定时检查未启用（APP_SUBSCRIPTION_ENABLED=false）")
        return None
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler(timezone=None)   # None = 跟随系统时区
    scheduler.add_job(
        _run_daily_check,
        CronTrigger(hour=settings.subscription_check_hour, minute=0),
        id="daily_subscription_check",
        replace_existing=True,
        # 错过时间点（比如进程当时没在跑）时不要立刻补跑，
        # 交给 min_interval_hours 判断，避免启动瞬间抢跑
        misfire_grace_time=3600,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("订阅定时检查已启动：每天 %02d:00", settings.subscription_check_hour)
    return scheduler


def shutdown_scheduler() -> None:
    """应用关闭时停掉调度器，避免测试/热重载时残留定时任务。"""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("订阅定时检查已停止")
