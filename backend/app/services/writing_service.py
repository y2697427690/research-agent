"""论文框架生成（需求 1.6.1）。

关键约束：References 只能从库内论文里挑。
需求原文要求"真实没有幻觉的 References"，所以把库内标题作为唯一候选喂给模型，
返回后**再用标题做一次白名单校验** —— 模型即使编造，也会被过滤掉。
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.paper import Paper
from app.services import llm

logger = get_logger(__name__)

SECTIONS = ["Abstract", "Introduction", "Related Work", "Method",
            "Experiments", "Conclusion", "References"]

SYSTEM_PROMPT = """你是论文写作助手。根据用户的想法，生成论文的 7 段框架。

只输出一个 JSON 对象，不要任何解释：
{"sections":[{"title":"Abstract","points":["要点1","要点2"]},...],
 "references":["库内论文标题1","库内论文标题2"]}

规则：
1. sections 必须依次为 Abstract / Introduction / Related Work / Method / Experiments / Conclusion / References；
2. 每段 2~3 条要点，每条不超过 40 字；
3. references 只能从给定的库内论文标题中挑选，原样复制标题；一条都挑不出就返回空数组，**绝不编造**。
"""


def _extract(text: str) -> dict | None:
    i, j = text.find("{"), text.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        data = json.loads(text[i:j + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def build_outline(db: AsyncSession, idea: str) -> dict:
    """返回 {sections:[{title, points}], references:[{title, paper_id, in_library}]}"""
    rows = (
        await db.execute(
            select(Paper.id, Paper.title).where(Paper.title.is_not(None)).limit(40)
        )
    ).all()
    titles = [(pid, (t or "").strip()) for pid, t in rows if (t or "").strip()]
    lib_map = {t: pid for pid, t in titles}
    library = "\n".join(f"- {t}" for _, t in titles) or "（库内暂无论文）"

    raw = await llm.chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"想法：{idea[:400]}\n\n库内论文：\n{library}"},
        ],
        temperature=0.4,
    )
    data = _extract(raw or "") or {}

    sections = []
    for item in (data.get("sections") or []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        points = [str(p).strip() for p in (item.get("points") or []) if str(p).strip()]
        if title and points:
            sections.append({"title": title, "points": points[:4]})
    if not sections:
        # 模型没按 JSON 返回：退化成"整段文本"，前端仍能显示，但明确标 degraded
        text = (raw or "").strip()
        sections = [{"title": "模型输出（未按结构返回）", "points": [text[:600]] if text else []}]

    # 白名单校验：模型编造的参考文献一律丢弃
    picked = []
    for t in (data.get("references") or []):
        name = str(t).strip()
        if name in lib_map and name not in [p["title"] for p in picked]:
            picked.append({"title": name, "paper_id": lib_map[name], "in_library": True})
        elif name:
            logger.warning("写作框架：丢弃库外参考文献 %s", name[:60])

    return {
        "idea": idea,
        "sections": sections,
        "references": picked,
        "candidates": [{"title": t, "paper_id": pid} for pid, t in titles[:8]],
        "degraded": not bool(data.get("sections")),
    }


DIAGRAM_PROMPTS = {
    "tikz": "生成可直接编译的 LaTeX TikZ 代码，画论文方法架构图",
    "dot": "生成 Graphviz DOT 代码，画论文方法架构图",
    "mermaid": "生成 Mermaid flowchart 代码，画论文方法架构图",
    "matplotlib": "生成 Python matplotlib 代码，画论文方法架构图",
}


async def build_diagram(db: AsyncSession, idea: str, fmt: str = "mermaid") -> dict:
    """按指定格式生成架构图代码。

    只返回代码本身（剥掉模型爱加的 ` 围栏），前端直接展示/复制。
    不做“预览渲染”：TikZ/Graphviz 需要本地工具链，预览会误导用户以为能跑。
    """
    fmt = fmt if fmt in DIAGRAM_PROMPTS else "mermaid"
    raw = await llm.chat(
        [
            {"role": "system", "content": (
                "你是论文绘图助手。" + DIAGRAM_PROMPTS[fmt] +
                "。只输出代码，不要解释；代码要能直接运行。"
            )},
            {"role": "user", "content": f"论文想法：{idea[:400]}"},
        ],
        temperature=0.3,
    )
    code = (raw or "").strip()
    # 剥掉 `lang ... ` 围栏
    if code.startswith("`"):
        lines = code.splitlines()
        if lines and lines[0].startswith("`"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("`"):
            lines = lines[:-1]
        code = "\n".join(lines).strip()
    return {"format": fmt, "code": code[:4000], "empty": not bool(code)}
