"""引用边表。

每条记录表示「某篇论文的第 N 条参考文献指向某篇论文」。

为什么落库而不是每次现算：
1. 图分析要反复查询（入度、PageRank、连通分量），
   而解析 PDF 与匹配参考文献都很慢，必须缓存结果
2. 保留原始参考文献文本，便于事后核对匹配是否正确
   （这是「引文核验」功能的基础：能说清"凭什么判定它引用了这篇"）
3. 被引用但尚未上传的论文也要作为节点存在，
   因此需要记录外部论文的标识（arXiv 编号或标题）
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.paper import utcnow


class Citation(Base):
    """一条引用关系：source 论文引用了 target。"""

    __tablename__ = "citations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    # 引用方：一定是库内论文，所以直接外键 + 级联删除
    source_paper_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("papers.id", ondelete="CASCADE"),
        index=True,
    )

    # 这是该论文参考文献列表里的第几条（从 1 开始）。
    # 有了它，回答「[12] 指的是哪篇」时可以直接定位。
    ref_index: Mapped[int] = mapped_column(Integer, default=0)

    # 被引用方若已在库内，填它的 id；否则为 None。
    # 不用外键：外部论文不在 papers 表里，且被引方可能随时被上传进库，
    # 用可空字符串比外键灵活，重新匹配时直接更新即可。
    target_paper_id: Mapped[str | None] = mapped_column(
        String(32), default=None, index=True
    )

    # 外部论文的标识：优先 arXiv 编号，其次标题。
    # 两者都为空说明这条参考文献没被识别出来（例如书籍、网页链接）。
    target_arxiv_id: Mapped[str | None] = mapped_column(String(64), default=None)
    target_title: Mapped[str | None] = mapped_column(Text, default=None)

    # 匹配方式：arxiv（编号精确命中）/ title（标题模糊命中）/ none（未匹配）
    # 保留它是为了可解释——用户能看出"这条边是靠编号认出来的"还是"靠标题猜的"
    match_method: Mapped[str] = mapped_column(String(16), default="none")

    # 原始参考文献文本，便于核对
    raw_text: Mapped[str | None] = mapped_column(Text, default=None)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    # 同一篇论文的同一条参考文献只应有一条边，重复解析时靠它去重
    __table_args__ = (
        Index("ix_citation_source_ref", "source_paper_id", "ref_index", unique=True),
    )

    def __repr__(self) -> str:
        return f"<Citation {self.source_paper_id}#{self.ref_index} -> {self.target_paper_id or self.target_arxiv_id or self.target_title}>"
