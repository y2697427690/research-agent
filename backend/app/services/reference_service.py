"""参考文献视图服务：把「库里已有的引用数据」组织成前端能直接渲染的形状。

背景：参考文献在解析阶段就已经抽取并匹配过了（见 citations 表），
但前端一直拿不到 —— 阅读器里点 [12] 只能弹"未抽取到参考文献"。
本模块负责回答三个问题：
  1. 这篇论文一共有几条参考文献？
  2. 第 N 条指向谁（库内论文 / 外部 arXiv / 未识别）？
  3. 第 N 条在正文里被引用了多少次、分别在第几个分块？
第三个问题是双向跳转的关键：从参考文献跳回正文时，需要知道跳哪一段。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.chunk import Chunk
from app.models.citation import Citation

logger = get_logger(__name__)

# 正文里的引文角标。学术论文常见三种写法，都要认：
#   [12]        单条
#   [12, 15]    多条，逗号分隔（中英文逗号都有）
#   [12-14]     区间
# 注意 [N] 也可能出现在公式或图表编号里，这里只做正则提取，
# 是否"真的是文献引用"由后端解析阶段已经判定过（见 citations 表），
# 所以这里不再做语义判断，避免误伤。
CITE_GROUP = re.compile(r"\[([0-9,，\-–—\s]+)\]")


def extract_cite_numbers(text: str) -> list[int]:
    """从一段正文里抽出所有引文编号，按出现顺序返回。

    "[1]" -> [1]；"[12, 15]" -> [12, 15]；"[3-5]" -> [3, 4, 5]
    重复出现的编号会重复返回 —— 调用方需要"次数"，重复正是信息。
    """
    numbers: list[int] = []
    for group in CITE_GROUP.findall(text or ""):
        for part in re.split(r"[,，]", group):
            part = part.strip()
            if not part:
                continue
            rng = re.match(r"^(\d+)\s*[-–—]\s*(\d+)$", part)
            if rng:
                start, end = int(rng.group(1)), int(rng.group(2))
                # 区间最多展开 50 个，防止 [1-9999] 这种脏数据把内存打爆
                if 0 <= end - start <= 50:
                    numbers.extend(range(start, end + 1))
                continue
            if part.isdigit():
                numbers.append(int(part))
    return numbers
@dataclass
class ReferenceItemView:
    """一条参考文献 + 它在正文里的被引情况。"""

    ref_no: int
    text: str = ""
    arxiv_id: str | None = None
    matched_paper_id: str | None = None
    matched_title: str | None = None
    match_method: str = "none"
    cited_in: list[int] = field(default_factory=list)
    # 是否疑似"应付式引用"（出现在 [12,13,14] 这类成串引用里）
    suspicious: bool = False
    evidence: str = ""

    @property
    def cited_count(self) -> int:
        """被引用的段落数（同一段里出现两次只算一次）。"""
        return len(self.cited_in)

async def build_references(db: AsyncSession, paper_id: str) -> list[ReferenceItemView]:
    """查某篇论文的参考文献，并补上「正文里被引几次、在哪几段」。

    性能上的两个关键点：
      1. 只查需要的列（chunk_index / text），绝不 select(Chunk) ——
         分块表里有 1536 维向量，一篇论文几百块，全查出来是几十 MB 的无用数据；
      2. 正文只扫一遍，边扫边建「编号 → 段落列表」的索引，
         而不是对每条参考文献各扫一遍正文（40 条 × 500 段 = 2 万次正则）。
    """
    rows = (
        await db.execute(
            select(Citation)
            .where(Citation.source_paper_id == paper_id)
            .order_by(Citation.ref_index)
        )
    ).scalars().all()
    if not rows:
        return ReferenceReport()

    chunks = (
        await db.execute(
            select(Chunk.chunk_index, Chunk.text)
            .where(Chunk.paper_id == paper_id)
            .order_by(Chunk.chunk_index)
        )
    ).all()

    cited_map: dict[int, list[int]] = {}
    # 判定"疑似应付式"的两个计数器：
    #   grouped：该编号在「一次括号里有 ≥2 个编号」的段落中出现过几次
    #   solo   ：该编号在"只有它一个、且同段没有别的编号"的段落中出现过几次
    # 只有「全部出现都是成串罗列、从未被单独讨论」才算疑似 ——
    # 学术界成串引用是正常写法（如 [31,2,5]），单凭这一条会冤枉一半文献。
    grouped: dict[int, int] = {}
    solo: dict[int, int] = {}
    group_re = re.compile(r"\[([0-9,，\-–—\s]+)\]")

    for chunk_index, text in chunks:
        nums_in_chunk = extract_cite_numbers(text)
        for no in nums_in_chunk:
            bucket = cited_map.setdefault(no, [])
            if not bucket or bucket[-1] != chunk_index:
                bucket.append(chunk_index)

        grouped_here: set[int] = set()
        for m in group_re.finditer(text):
            nums = extract_cite_numbers("[" + m.group(1) + "]")
            if len(nums) >= 2:
                grouped_here.update(nums)
        for n in set(nums_in_chunk):
            if n in grouped_here:
                grouped[n] = grouped.get(n, 0) + 1
            else:
                solo[n] = solo.get(n, 0) + 1

    items: list[ReferenceItemView] = []
    for row in rows:
        no = row.ref_index
        g_count = grouped.get(no, 0)
        s_count = solo.get(no, 0)
        # 只在「成串出现至少 2 段、且从未被单独讨论」时判为疑似
        is_suspicious = g_count >= 2 and s_count == 0
        items.append(
            ReferenceItemView(
                ref_no=no,
                text=re.sub(r"^\s*\[\d+\]\s*", "", row.raw_text or "").strip(),
                arxiv_id=row.target_arxiv_id,
                matched_paper_id=row.target_paper_id,
                matched_title=row.target_title,
                match_method=row.match_method or "none",
                cited_in=cited_map.get(no, []),
                suspicious=is_suspicious,
                evidence=(
                    f"仅在成串引用中出现（{g_count} 段），正文无单独讨论"
                    if is_suspicious else ""
                ),
            )
        )
    # 判断引用体系：正文里一个 [n] 都没有、参考文献却不少 →
    # 基本可以断定是作者-年份式（这是学术界两套并行的引用规范）
    style = "author-year" if not cited_map and items else "numeric"

    logger.info(
        "参考文献视图 %s：%d 条，正文命中 %d 种编号，风格=%s",
        paper_id, len(items), len(cited_map), style,
    )
    return ReferenceReport(items=items, citing_style=style)

@dataclass
class ReferenceReport:
    """一篇论文的参考文献汇总（列表 + 统计 + 引用体系）。"""

    items: list[ReferenceItemView] = field(default_factory=list)
    citing_style: str = "numeric"

    @property
    def total(self) -> int:
        return len(self.items)

    @property
    def cited_total(self) -> int:
        return sum(1 for i in self.items if i.cited_in)

    @property
    def note(self) -> str | None:
        """作者-年份式引用时给一句说明，其他情况不打扰用户。"""
        if self.citing_style == "author-year" and self.items:
            return "该篇使用作者-年份式引用（如 (Smith et al., 2020)），暂不支持角标跳转；参考文献列表仍可查看。"
        return None



