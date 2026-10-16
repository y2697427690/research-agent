"""数据库连接与会话管理。

使用 SQLAlchemy 2.0 异步引擎 + aiosqlite 驱动。
连接建立时统一设置 SQLite PRAGMA：SQLite 的默认值对 Web 应用并不合适。
"""
from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# 保证数据目录存在：否则 engine 首次连接时会因路径不存在而失败
settings.data_dir.mkdir(parents=True, exist_ok=True)

# echo=False 表示不打印每条 SQL，调试时可临时改为 True
engine = create_async_engine(settings.db_url, echo=False, future=True)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:
    """每条新连接建立时执行的设置。

    journal_mode=WAL    读写可并发，不互相阻塞
    synchronous=NORMAL  性能与安全的折中
    foreign_keys=ON     SQLite 默认关闭外键约束，必须显式打开
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# expire_on_commit=False：commit 之后仍可读取对象属性，
# 否则 FastAPI 把 ORM 对象序列化成响应时会触发额外查询甚至报错
SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖注入用的会话提供者。

    用法：
        @router.get("/xxx")
        async def xxx(db: AsyncSession = Depends(get_db)):
            ...

    请求结束（或抛异常）时自动回滚并关闭会话。
    """
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
