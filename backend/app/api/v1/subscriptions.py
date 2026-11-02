"""订阅接口：关键词订阅 + 手动检查 + 命中列表。

在线演示不打日志噪音：check 会真的请求 arXiv（约 1~3 秒），
前端按钮上要显示"检查中"，与 PDF 下载一致。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import InvalidRequest, NotFound
from app.core.logging import get_logger
from app.db.session import get_db
from app.schemas.common import Ok
from app.schemas.subscription import (
    SubscriptionCheckOut,
    SubscriptionCreate,
    SubscriptionHitOut,
    SubscriptionListOut,
    SubscriptionOut,
)
from app.services import subscription_service

logger = get_logger(__name__)

router = APIRouter(prefix="/subscriptions", tags=["订阅"])


def _to_out(sub, hits=None) -> SubscriptionOut:
    """ORM → 响应模型。

    hit_count 用 len(sub.hits)：关系是 lazy="selectin"，列表查询时已一并取回；
    latest 只取最近 3 条做预览，避免列表页返回上百条摘要。
    """
    ordered = sorted(sub.hits, key=lambda h: h.found_at, reverse=True) if sub.hits else []
    latest = [
        SubscriptionHitOut(
            id=h.id, arxiv_id=h.arxiv_id, version=h.version, title=h.title,
            authors=h.authors, summary=h.summary, published=h.published,
            abs_url=h.abs_url, pdf_url=h.pdf_url, in_library=h.in_library,
            found_at=h.found_at,
        )
        for h in ordered[:3]
    ]
    return SubscriptionOut(
        id=sub.id,
        keyword=sub.keyword,
        category=sub.category,
        max_results=sub.max_results,
        enabled=sub.enabled,
        last_checked_at=sub.last_checked_at,
        created_at=sub.created_at,
        hit_count=len(sub.hits or []),
        latest=latest,
    )


@router.get("", response_model=SubscriptionListOut, summary="订阅列表")
async def list_subscriptions(
    db: AsyncSession = Depends(get_db),
) -> SubscriptionListOut:
    subs = await subscription_service.list_all(db)
    items = [_to_out(s) for s in subs]
    return SubscriptionListOut(items=items, total=len(items))


@router.post("", response_model=SubscriptionOut, summary="新建订阅")
async def create_subscription(
    payload: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    try:
        sub = await subscription_service.create(
            db, payload.keyword, payload.category, payload.max_results
        )
    except ValueError as exc:
        raise InvalidRequest(str(exc)) from exc
    await db.commit()
    await db.refresh(sub)
    return _to_out(sub)


@router.delete("/{sub_id}", response_model=Ok, summary="删除订阅")
async def delete_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
) -> Ok:
    if not await subscription_service.delete(db, sub_id):
        raise NotFound("订阅不存在", {"subscription_id": sub_id})
    await db.commit()
    return Ok(ok=True)


@router.post("/{sub_id}/check", response_model=SubscriptionCheckOut, summary="立即检查一次")
async def check_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
) -> SubscriptionCheckOut:
    sub = await subscription_service.get(db, sub_id)
    if sub is None:
        raise NotFound("订阅不存在", {"subscription_id": sub_id})
    try:
        stats = await subscription_service.check(db, sub)
    except Exception as exc:  # noqa: BLE001 - 上游网络/限流
        logger.warning("订阅检查失败 %s: %s", sub_id, exc)
        raise InvalidRequest("检查失败：arXiv 可能限流，请稍后重试") from exc
    await db.commit()
    return SubscriptionCheckOut(
        subscription_id=sub_id,
        fetched=stats["fetched"],
        added=stats["added"],
        message=f"检索 {stats['fetched']} 条，新增 {stats['added']} 条",
    )


@router.get(
    "/{sub_id}/hits",
    response_model=list[SubscriptionHitOut],
    summary="某条订阅的抓取结果",
)
async def list_hits(
    sub_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[SubscriptionHitOut]:
    sub = await subscription_service.get(db, sub_id)
    if sub is None:
        raise NotFound("订阅不存在", {"subscription_id": sub_id})
    hits = await subscription_service.recent_hits(db, sub_id, limit)
    return [
        SubscriptionHitOut(
            id=h.id, arxiv_id=h.arxiv_id, version=h.version, title=h.title,
            authors=h.authors, summary=h.summary, published=h.published,
            abs_url=h.abs_url, pdf_url=h.pdf_url, in_library=h.in_library,
            found_at=h.found_at,
        )
        for h in hits
    ]
