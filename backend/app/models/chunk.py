"""文本分块表。

分块是检索的基本单位：解析完成后把正文切成若干块并落库，
检索时从库里加载这些块重建索引。这样重启服务不必重新解析 PDF。

与 papers 表是「一对多」：删除论文时其所有分块应一并删除，
因此外键上声明 ondelete="CASCADE"。注意 SQLite 默认不启用外键约束，
本项目在 db/session.py 里已通过 PRAGMA foreign_keys=ON 打开。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.paper import utcnow


class Chunk(Base):
    """论文正文的一个分块。"""

    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)

    # 所属论文。级联删除：论文被删除时，其分块自动清掉，避免留下孤儿数据。
    paper_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("papers.id", ondelete="CASCADE"),
        index=True,
    )

    # 在本文档内的序号，从 0 开始；同一论文内唯一
    chunk_index: Mapped[int] = mapped_column(Integer)

    text: Mapped[str] = mapped_column(Text)
    char_count: Mapped[int] = mapped_column(Integer, default=0)

    # 溯源信息：回答时要能标出「这一段出自哪一章、第几页」
    section_title: Mapped[str | None] = mapped_column(String(512), default=None)
    level: Mapped[int] = mapped_column(Integer, default=0)
    page_start: Mapped[int] = mapped_column(Integer, default=1)
    page_end: Mapped[int] = mapped_column(Integer, default=1)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    # 复合唯一索引：保证同一论文内不会出现重复序号（重复插入会直接报错，
    # 比事后去重更早暴露问题），同时该索引也加速「按论文取全部块」的查询。
    __table_args__ = (
        Index("ix_chunks_paper_chunk", "paper_id", "chunk_index", unique=True),
    )

    def __repr__(self) -> str:
        return f"<Chunk {self.paper_id}#{self.chunk_index} {self.char_count}B>"

