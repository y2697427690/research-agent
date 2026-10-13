"""健康检查接口

确认服务存活，数据库可联通，大模型配置是否就绪
"""

from fastapi import APIRouter,Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import get_db
from app.schemas.health import DBStatus, HealthOut, LLMStatus

router = APIRouter(tags=["系统"])
#  注意 get_logger 只有一个下划线！！！！！！！
logger = get_logger(__name__)


@router.get("/health", response_model=HealthOut, summary="健康检查")
async def health(db: AsyncSession = Depends(get_db)) -> HealthOut:
    """报告服务和数据库与大模型的当前状态"""
    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        # 健康检查报告问题而不是抛出问题
        # 这里吞掉异常并返回 db.ok=false，同时细节写入日志
        logger.exception("数据库连通性检查失败")
        db_ok = False

    return HealthOut(
        status = "ok",
        app = settings.app_name,
        version = settings.app_version,
        db = DBStatus(ok=db_ok, url_scheme=settings.db_url.split("://")[0]),
        llm = LLMStatus(
            configured = settings.has_llm,
            base_url = settings.llm_base_url,
            model = settings.llm_model_chat,
            reachable = None,
        ),
    )
