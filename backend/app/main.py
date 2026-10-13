"""FastAPI 应用入口

启动方式（在backend目录，虚拟环境已激活）
     uvicorn app.api.main:app --reload  --port 8000

     接口文档：http://localhost:8000/docs

"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.api.v1 import api_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import get_logger, setup_logging

logger = get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期: yield 之前是启动逻辑，之后是关闭逻辑"""
    setup_logging()
    logger.info("启动%s v%s",settings.app_name,settings.app_version)

    #必须导入模型模块，Base.metadata才知道有哪些表，否则create_all建不出来东西
    from app.db.base import Base
    from app.db.session import engine
    from app.models import paper  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("数据库表已就绪")

    yield
    await engine.dispose()
    logger.info("服务已停止")

def create_app() ->FastAPI:
    """组装FastAPI应用"""

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="科研小助手 Agent 后端 API。",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix="/api/v1")
    return app

app = create_app()