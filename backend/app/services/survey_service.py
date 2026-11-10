"""需求 1.5.3：自动综述。

输入是"库内若干篇论文"，输出一段带出处的领域综述。
实现上不新造图谱算法，直接复用 citations 表统计入度：
  入度高 = 被同方向论文引用得多 = 更接近"奠基工作"，
  综述按入度从高到低介绍，读者看到的就是这个方向的脉络。

为什么把摘要截断到 300 字：20 篇 × 全文会超出上下文，且综述只需要
"这篇做了什么"，摘要足够；截断也能控制成本。
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.citation import Citation
from app.models.paper import Paper
from app.services import llm

logger = get_logger(__name__)

MAX_PAPERS = 12          # 一次综述最多用几篇，太多会稀释重点
ABSTRACT_CHARS = 300     # 每篇只喂摘要前 300 字
MAX_CHARS = 250          # 综述字数上限（需求 150~250 字）

SYSTEM_PROMPT = """你是科研综述作者。请根据给出的论文清单写一段中文领域综述。

规则：
1. 150~250 字，一段话，不要标题、不要分点、不要客套。
2. 必须提到具体论文，用《论文标题》的形式标注出处，至少提到 3 篇。
3. 先说这个方向在解决什么问题，再说奠基工作，最后说衍生/改进的方向。
4. 只能基于给出的信息；信息不足就写"从现有论文看"，不要编造结论或数字。
"""


async def build(db: AsyncSession, paper_ids: list[str] | None = None) -> dict:
    """返回 {"summary": str, "papers": [{title, in_degree}]}。"""
    stmt = select(Paper.id, Paper.title, Paper.abstract).where(Paper.title.is_not(None))
    if paper_ids:
        stmt = stmt.where(Paper.id.in_(paper_ids))
    rows = (await db.execute(stmt.limit(60))).all()
    if not rows:
        raise ValueError("库内没有可用于综述的论文")

    # 入度：被库内论文引用了多少次
    in_deg = dict(
        (await db.execute(
            select(Citation.target_paper_id, func.count())
            .where(Citation.target_paper_id.is_not(None))
            .group_by(Citation.target_paper_id)
        )).all()
    )

    papers = [
        {"id": pid, "title": (title or "").strip(),
         "abstract": (abstract or "").strip()[:ABSTRACT_CHARS],
         "in_degree": int(in_deg.get(pid, 0))}
        for pid, title, abstract in rows
    ]
    papers.sort(key=lambda p: (-p["in_degree"], p["title"]))
    papers = papers[:MAX_PAPERS]

    listing = "\n".join(
        f"- 《{p['title']}》（被库内引用 {p['in_degree']} 次）{p['abstract']}"
        for p in papers
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"论文清单：\n{listing}\n\n请写综述。"},
    ]
    raw = await llm.chat(messages, temperature=0.3)
    summary = (raw or "").strip()
    if not summary:
        raise ValueError("模型没有返回综述内容")

    # 长度兜底：模型经常写超（实测一次 577 字）。按句号切、凑够上限就停，
    # 直接硬截会把最后一句砍成半句，按句拼接读起来才完整。
    if len(summary) > MAX_CHARS:
        buf = ""
        for sent in summary.replace("\n", "").split("。"):
            if not sent.strip():
                continue
            candidate = buf + sent + "。"
            if len(candidate) > MAX_CHARS and buf:
                break
            buf = candidate
        summary = buf or summary[:MAX_CHARS]

    return {
        "summary": summary,
        "papers": [{"title": p["title"], "in_degree": p["in_degree"]} for p in papers],
    }
