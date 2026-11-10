"""推荐理由生成。

为什么把库内标题直接塞进提示词、而不是先做向量检索：
  库很小（几十篇），标题总长可控；而"先检索再解释"一旦检索没命中，
  模型就只能编关系。直接给全量标题，模型可以自己判断"与哪篇相关"，
  更不容易胡说，也省一次检索开销。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.paper import Paper
from app.services import llm

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是科研助手，负责说明"这篇新论文为什么值得推荐给用户"。

规则：
1. 只输出一句中文，40~80 字，不要分点、不要客套话。
2. 必须指出与库内哪篇论文相关、是什么关系（继承 / 改进 / 对比 / 同一问题的不同解法）。
3. 只能基于给出的信息推断；**如果看不出与任何库内论文的关系，就直说"与库内论文关系不明显"**，不要硬编。
4. 不要复述摘要，不要评价论文好坏。
"""


async def explain(db: AsyncSession, title: str, summary: str) -> tuple[str, list[str]]:
    """返回 (一句理由, 相关库内论文标题列表)。"""
    rows = (
        await db.execute(select(Paper.title).where(Paper.title.is_not(None)).limit(60))
    ).scalars().all()
    titles = [t.strip() for t in rows if t and t.strip()]

    library = "\n".join(f"- {t}" for t in titles) if titles else "（库内暂无论文）"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": (
            f"库内已有的论文：\n{library}\n\n"
            f"候选新论文标题：{title}\n候选摘要：{summary[:1200]}\n\n"
            "请给出推荐理由。"
        )},
    ]
    raw = await llm.chat(messages, temperature=0.2)
    reason = (raw or "").strip().splitlines()[0][:200]

    # 相关论文：只做"标题是否出现在理由里"的朴素匹配，用于前端展示依据
    related = [t for t in titles if t[:12] and t[:12].lower() in reason.lower()][:3]
    return reason, related
