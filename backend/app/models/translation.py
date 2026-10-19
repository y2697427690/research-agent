"""分块译文表。

为什么不把译文直接放在 chunks 表里：
    1. 译文是**派生数据**——它可以由原文重新生成，而原文不能。
       派生数据和核心数据分表存，清缓存、换模型时不必碰核心表。
    2. SQLite 不支持「给已有表加列」的自动迁移（create_all 只建不改）。
       把译文放新表，新增这张表时不需要重建数据库，已上传的论文不会丢。

为什么不复用 llm 的对话缓存：译文按「块 + 目标语言」唯一，需要持久化，
和一次性的对话请求不是一回事。
"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.paper import utcnow


class ChunkTranslation(Base):
    """一个分块在某种目标语言下的译文。"""

    __tablename__ = "chunk_translations"

    id: Mapped[str] = mapped_column(String(48),primary_key=True)

    # 级联删除：分块被删除（重新解析）时，它的译文自动清掉。
    # 这很重要——重新解析后块内容可能变了，旧译文必须作废，
    # 否则会出现「译文对不上原文」的静默错误。

    chunk_id:Mapped[str] = mapped_column(
        String(48),
        ForeignKey("chunks.id",ondelete="CASCADE"),
        index=True,
        )

    #目标语言：先做zh，预留字段用于将来拓展
    lang:Mapped[str] = mapped_column(String(8),default="zh")

    text:Mapped[str] = mapped_column(Text)

    # 记录由哪个模型翻译，便于换模型后筛出需要重译的条目
    model: Mapped[str | None] = mapped_column(String(64), default=None)

    # 译文的字符数，界面上可以显示「已翻译 N 字」
    char_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    # 同一个块的同一种语言只允许一条译文：
    # 重复翻译时数据库直接拒绝，比事后去重更早暴露问题
    __table_args__ = (
        Index("ix_chunk_translation_unique", "chunk_id", "lang", unique=True),
    )

    def __repr__(self) -> str:
        return f"<ChunkTranslation {self.chunk_id}/{self.lang} {self.char_count}B>"

