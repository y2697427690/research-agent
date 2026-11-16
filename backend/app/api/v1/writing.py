"""写作助手接口（需求 1.6.1）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import InvalidRequest
from app.core.logging import get_logger
from app.db.session import get_db
from app.schemas.writing import OutlineIn, OutlineOut
from app.services import writing_service

logger = get_logger(__name__)

router = APIRouter(prefix="/writing", tags=["写作助手"])


@router.post("/outline", response_model=OutlineOut, summary="生成论文框架（References 仅取库内）")
async def generate_outline(
    payload: OutlineIn,
    db: AsyncSession = Depends(get_db),
) -> OutlineOut:
    """用真实模型生成 7 段框架。

    和旧实现的区别：旧版是前端本地模板拼的，看着能用但没有任何模型参与；
    这里走真实 LLM，且参考文献经库内白名单校验，编造的直接丢弃。
    """
    try:
        result = await writing_service.build_outline(db, payload.idea)
    except Exception as exc:  # noqa: BLE001
        logger.warning("框架生成失败：%s", exc)
        raise InvalidRequest("框架生成失败，请稍后重试") from exc
    return OutlineOut(**result)
