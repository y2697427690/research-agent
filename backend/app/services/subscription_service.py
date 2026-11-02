"""订阅服务：新建 / 列出 / 删除订阅，以及"检查一次"的抓取逻辑。

抓取复用 discover.search()（它已经处理了查询构造、失败兜底、限速），
所以本模块只负责三件事：
  1. 把检索结果变成 SubscriptionHit，并按 (订阅, arxiv_id) 去重；
  2. 标出"这篇已经在库里"，让前端直接显示「已在库」；
  3. 记录 last_checked_at，供调度器与界面显示"上次检查时间"。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.paper import Paper
from app.models.subscription import Subscription, SubscriptionHit
from app.services import discover

logger = get_logger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


async def create(
    db: AsyncSession,
    keyword: str,
    category: str | None = None,
    max_results: int = 20,
) -> Subscription:
    """新建订阅。同一关键词 + 分类视为重复，直接返回已有的那条。"""
    keyword = (keyword or "").strip()
    if not keyword:
        raise ValueError("关键词不能为空")

    existing = (
        await db.execute(
            select(Subscription).where(
                Subscription.keyword == keyword,
                Subscription.category == (category or None),
            )
        )
    ).scalars().first()
    if existing is not None:
        return existing

    sub = Subscription(
        keyword=keyword, category=category or None, max_results=max_results
    )
    db.add(sub)
    await db.flush()
    logger.info("新建订阅 %s：%s（分类 %s）", sub.id, keyword, category or "-")
    return sub


async def list_all(db: AsyncSession, enabled_only: bool = False) -> list[Subscription]:
    stmt = select(Subscription).order_by(Subscription.created_at.desc())
    if enabled_only:
        stmt = stmt.where(Subscription.enabled.is_(True))
    return list((await db.execute(stmt)).scalars().all())


async def get(db: AsyncSession, sub_id: str) -> Subscription | None:
    return await db.get(Subscription, sub_id)


async def delete(db: AsyncSession, sub_id: str) -> bool:
    sub = await db.get(Subscription, sub_id)
    if sub is None:
        return False
    await db.delete(sub)       # hits 由 cascade="all, delete-orphan" 一并删除
    await db.flush()
    return True


async def recent_hits(db: AsyncSession, sub_id: str, limit: int = 20) -> list[SubscriptionHit]:
    stmt = (
        select(SubscriptionHit)
        .where(SubscriptionHit.subscription_id == sub_id)
        .order_by(SubscriptionHit.found_at.desc())
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


async def check(db: AsyncSession, sub: Subscription) -> dict:
    """检查一次：抓取 → 去重入库 → 更新检查时间。

    返回 {"fetched": 检索到几条, "added": 新增几条}。
    去重靠两层：
      1. 先查该订阅已有的 arxiv_id 集合，避免无意义的插入尝试；
      2. 表上的唯一约束兜底（并发或历史数据异常时仍不会重复）。
    """
    query = sub.keyword if not sub.category else f"cat:{sub.category} AND all:{sub.keyword}"
    items = await discover.search(query, max_results=sub.max_results, sort="recent")

    known_ids = {
        row for row in (
            await db.execute(
                select(SubscriptionHit.arxiv_id).where(
                    SubscriptionHit.subscription_id == sub.id
                )
            )
        ).scalars().all()
    }

    # 一次查出这些 arxiv_id 里哪些已经在库，避免逐条查询
    wanted = {it.arxiv_id for it in items}
    in_library: set[str] = set()
    if wanted:
        rows = (
            await db.execute(
                select(Paper.arxiv_id).where(Paper.arxiv_id.in_(wanted))
            )
        ).scalars().all()
        in_library = {r for r in rows if r}

    added = 0
    for it in items:
        if it.arxiv_id in known_ids:
            continue
        db.add(
            SubscriptionHit(
                subscription_id=sub.id,
                arxiv_id=it.arxiv_id,
                version=it.version,
                title=it.title or "(无标题)",
                authors=", ".join(it.authors[:6]),
                summary=it.summary or "",
                published=it.published,
                abs_url=it.abs_url or None,
                pdf_url=it.pdf_url or None,
                in_library=it.arxiv_id in in_library,
            )
        )
        added += 1

    sub.last_checked_at = _now()
    await db.flush()
    logger.info("订阅 %s 检查完成：检索 %d 条，新增 %d 条", sub.id, len(items), added)
    return {"fetched": len(items), "added": added}
