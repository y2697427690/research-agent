"""ORM 声明式基类。

所有数据表模型都继承 Base，Base.metadata 会收集全部表定义，
create_all / Alembic 迁移都依赖它。
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""
