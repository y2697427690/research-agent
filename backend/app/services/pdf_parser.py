"""PDF 结构化解析。

解析策略分三层，从可靠到兜底：
    1. 优先使用 PDF 内置书签（TOC）—— 多数论文与书籍都带，能直接给出三级层级
    2. 无书签时回退到「字号 + 字重 + 编号正则」推断标题
    3. 都失败（如扫描件无文本层）则标记 need_review，不伪造内容

本模块只做纯计算与文件读取,不涉及数据库操作。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from app.core.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------- 常量

# 章节编号：1 / 1.2 / 1.2.3 / 附录 A / A.1
_HEADING_NUMBER = re.compile(
    r"^\s*(?:(\d+(?:\.\d+)*)|([A-Z](?:\.\d+)*)|(Appendix\s+[A-Z]))\s+\S",
    re.IGNORECASE,
)

# 摘要区起点
_ABSTRACT = re.compile(r"^\s*(abstract|摘\s*要)\s*$", re.IGNORECASE)

# 参考文献区起点
_REFERENCES = re.compile(
    r"^\s*(references|bibliography|参考文献)\s*$", re.IGNORECASE
)

# 正文里引用编号，如 [12] / [1,2] / [3-5]
_CITATION = re.compile(r"\[(\d+(?:\s*[,\-–]\s*\d+)*)\]")

# 编号标题：与 TOC 条目比对时用于归一化
_NUM_PREFIX = re.compile(r"^\s*(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)\s+")

# 扫描件判定阈值：抽样页平均字符数低于此值即视为无文本层
_SCAN_CHAR_THRESHOLD = 30

# ---------------------------------------------------------------- 数据结构

@dataclass
class Line:
    """一行文本，附带排版属性。"""

    text: str
    page_no: int          # 从 1 开始，便于与 TOC 的页码对齐
    bbox: tuple[float, float, float, float]
    size: float           # 主字号（取该行字符数最多的 span 的字号）
    bold: bool
    x0: float

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]


@dataclass
class TocEntry:
    """内置书签条目。"""

    level: int
    title: str
    page_no: int


@dataclass
class Section:
    """识别出的章节。"""

    level: int
    title: str
    page_no: int
    source: str = "toc"   # toc | heuristic


@dataclass
class PageInfo:
    """单页的版面统计。"""

    page_no: int
    width: float
    height: float
    char_count: int
    image_count: int
    columns: int = 1
    text_width_ratio: float = 0.0   # 正文块宽度占页宽的比例


@dataclass
class ParsedDocument:
    """解析结果。"""

    page_count: int = 0
    is_scanned: bool = False
    toc: list[TocEntry] = field(default_factory=list)
    sections: list[Section] = field(default_factory=list)
    title: str | None = None
    abstract: str | None = None
    references: list[str] = field(default_factory=list)
    full_text: str = ""
    # 按页正文（页码从 1 开始）。分块时需要按页定位，因此单独保留一份。
    page_texts: dict[int, str] = field(default_factory=dict)
    quality: float = 0.0
    needs_review: bool = False
    warnings: list[str] = field(default_factory=list)
    pages: list[PageInfo] = field(default_factory=list)

# ---------------------------------------------------------------- 基础：行提取

def is_vertical(bbox: tuple[float, float, float, float], ratio: float = 2.0) -> bool:
    """判断是否为竖排/侧边文字。

    实测：arXiv 论文左侧的 "arXiv:1706.03762v1 [cs.CL] 12 Jun 2017" 水印
    字号 20.0 比真正的标题（17.2）还大，bbox 为 (11,216,38,560)——
    宽 27、高 344，是竖排文字。不排除它就会把水印当成论文标题。
    """
    x0, y0, x1, y1 = bbox
    h = y1 - y0
    w = x1 - x0
    return h > 40 and h > w * ratio


def _line_from_spans(spans: list[dict], page_no: int) -> Line | None:
    """把一行里的多个 span 合并成一条 Line。

    实测发现编号与标题常被拆成独立 span（例如 '2' 与 'Background'），
    必须合并才能还原完整标题。
    """
    parts: list[str] = []
    for s in spans:
        t = s.get("text", "")
        if t:
            parts.append(t)
    text = "".join(parts).strip()
    if not text:
        return None

    # 主字号取「字符数最多的 span」的字号，比取第一个更稳
    main = max(spans, key=lambda s: len(s.get("text", "")))
    size = float(main.get("size", 0.0))
    font = str(main.get("font", ""))
    bold = ("Bold" in font) or ("Medi" in font) or ("Heavy" in font)

    x0 = min(float(s["bbox"][0]) for s in spans)
    y0 = min(float(s["bbox"][1]) for s in spans)
    x1 = max(float(s["bbox"][2]) for s in spans)
    y1 = max(float(s["bbox"][3]) for s in spans)

    return Line(text=text, page_no=page_no, bbox=(x0, y0, x1, y1),
                size=size, bold=bold, x0=x0)


def extract_lines(doc: pymupdf.Document, page_no: int) -> list[Line]:
    """提取某一页的全部文本行（按阅读顺序从上到下、从左到右）。"""
    page = doc[page_no - 1]
    lines: list[Line] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for raw in block["lines"]:
            line = _line_from_spans(raw["spans"], page_no)
            if line:
                lines.append(line)
    lines.sort(key=lambda ln: (round(ln.bbox[1], 1), ln.x0))
    return lines


def analyse_page(doc: pymupdf.Document, page_no: int) -> PageInfo:
    """统计单页的版面信息，并判断栏数。"""
    page = doc[page_no - 1]
    text = page.get_text().strip()
    info = PageInfo(
        page_no=page_no,
        width=float(page.rect.width),
        height=float(page.rect.height),
        char_count=len(text),
        image_count=len(page.get_images()),
    )

    # 栏数判断：正文块（宽度超过页宽 20% 的块）的 x0 聚类
    # 单栏论文的正文块 x0 高度一致；双栏则会在两个区间各聚一簇
    page_width = info.width
    body_x0 = []
    body_widths = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        x0, _, x1, _ = block["bbox"]
        w = x1 - x0
        if w > page_width * 0.2:
            body_x0.append(x0)
            body_widths.append(w)

    if body_x0:
        info.text_width_ratio = sum(body_widths) / len(body_widths) / page_width
        # 正文块平均宽度超过页宽 55% 视为单栏，否则按 x0 是否分成两簇判断
        if info.text_width_ratio > 0.55:
            info.columns = 1
        else:
            mid = page_width / 2
            left = sum(1 for x in body_x0 if x < mid)
            right = len(body_x0) - left
            info.columns = 2 if (left >= 2 and right >= 2) else 1

    return info


# ---------------------------------------------------------------- 第 2 层：TOC

# 常见连字（LaTeX 生成的 PDF 里 ﬁ ﬂ 很常见），比对前统一还原
_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl",
              "ﬅ": "ft", "ﬆ": "st"}


def normalize_title(text: str) -> str:
    """归一化标题，用于与内置 TOC 比对。

    处理四件事：还原连字、去编号前缀、压缩空白、统一大小写。
    实测这三步能把书籍 TOC 的命中率从 157/181 提升到 181/181——
    页眉页码等附加文字会跟在标题同一行，因此匹配时要用「包含」而非「相等」。
    """
    s = text
    for k, v in _LIGATURES.items():
        s = s.replace(k, v)
    s = _NUM_PREFIX.sub("", s.strip())
    s = re.sub(r"[\s\u00a0]+", " ", s)
    return s.casefold()


def parse_toc(doc: pymupdf.Document) -> list[TocEntry]:
    """读取 PDF 内置书签。"""
    entries: list[TocEntry] = []
    for level, title, page_no in doc.get_toc():
        title = (title or "").strip()
        if title and page_no > 0:
            entries.append(TocEntry(level=int(level), title=title, page_no=int(page_no)))
    return entries


def build_toc_index(toc: list[TocEntry]) -> tuple[dict[str, TocEntry], dict[str, TocEntry]]:
    """为 TOC 建两个索引：按归一化标题、按编号。

    实测：正文里的标题可能被拆成多个 span 或与 TOC 文字略有出入，
    只靠文字比对会漏，加一个「编号 -> 条目」的索引能显著提高命中率。
    """
    by_title: dict[str, TocEntry] = {}
    by_number: dict[str, TocEntry] = {}
    for entry in toc:
        by_title.setdefault(normalize_title(entry.title), entry)
        m = re.match(r"^\s*(\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)\s", entry.title)
        if m:
            by_number.setdefault(m.group(1), entry)
    return by_title, by_number


def match_toc(line: Line, by_title: dict, by_number: dict) -> TocEntry | None:
    """判断某一行是否是 TOC 中的标题。

    用「包含」而非「相等」比对：实测书籍的标题行里常混入页眉页码，
    例如 "2.1 Supervised learning 15"，相等比对会全部漏掉。
    """
    key = normalize_title(line.text)
    # 1) 整行匹配
    if key in by_title:
        return by_title[key]
    # 2) 包含式匹配：标题嵌入在行中（要求标题足够长，避免误命中）
    for norm_title, entry in by_title.items():
        if len(norm_title) >= 5 and norm_title in key:
            return entry
    # 3) 只按编号匹配：如正文是 "3.2.1 Scaled Dot-Product Attention"
    m = re.match(r"^\s*(\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)(?:\s|$)", line.text)
    if m and m.group(1) in by_number:
        entry = by_number[m.group(1)]
        # 编号相同但标题文字完全对不上时视为巧合（例如 "3 Results" 里的 3 是数字）
        b = normalize_title(entry.title)
        if len(b) >= 5 and b in key:
            return entry
    return None


# ---------------------------------------------------------------- 标题回退识别


def estimate_body_size(lines: list[Line]) -> float:
    """估计正文字号：取出现字符数最多的那个字号。"""
    weight: dict[float, int] = {}
    for ln in lines:
        weight[round(ln.size, 1)] = weight.get(round(ln.size, 1), 0) + len(ln.text)
    if not weight:
        return 0.0
    return max(weight.items(), key=lambda kv: kv[1])[0]


def is_heuristic_heading(line: Line, body_size: float) -> bool:
    """无 TOC 时的标题判定：编号前缀 + 字号/字重 + 长度限制。"""
    if len(line.text) > 120 or len(line.text) < 2:
        return False
    if line.width > 460:            # 通栏长行几乎不是标题
        return False
    if not _HEADING_NUMBER.match(line.text):
        return False
    bigger = line.size > body_size + 0.9
    return bigger or line.bold


# ---------------------------------------------------------------- 摘要与参考文献


def extract_abstract(lines: list[Line], stop_page: int | None = None) -> str | None:
    """提取摘要：从 Abstract 行之后，到下一个标题或空段为止。"""
    start = None
    for i, ln in enumerate(lines):
        if _ABSTRACT.match(ln.text) and ln.size <= 14:
            start = i + 1
            break
    if start is None:
        return None

    parts: list[str] = []
    prev_y = None
    for ln in lines[start:]:
        if _ABSTRACT.match(ln.text):
            continue
        # 遇到章节标题立即停：实测摘要末行与 "1 Introduction" 只差 31pt，
        # 单靠行距阈值会漏判，标题是最可靠的终止信号
        if _HEADING_NUMBER.match(ln.text) and ln.size >= 11.5:
            break
        # 行距阈值取 18：实测正文行距约 11pt，摘要与下一段之间的空隙约 21pt
        if prev_y is not None and ln.bbox[1] - prev_y > 18:
            break
        parts.append(ln.text)
        prev_y = ln.bbox[3]
        if len(" ".join(parts)) > 4000:
            break

    text = " ".join(parts).strip()
    return text or None


def _is_terminator_heading(text: str) -> bool:
    """判断是否是应终止参考文献收集的后续章节（索引、附录等）。"""
    n = normalize_title(text)
    if len(n) > 24:
        return False
    return n.startswith(("index", "appendix", "附录", "索引", "glossary", "术语"))


def _is_reference_heading(text: str) -> bool:
    """判断某行是否是参考文献区标题。

    用「包含 + 短行」而非「整行相等」：实测标题行常混入页码等文字，
    例如 "Bibliography 464"、页眉。同时限制长度，避免把正文里的
    "see References for details" 这类句子误判为标题。
    """
    n = normalize_title(text)
    if len(n) > 24:
        return False
    return (
        n in ("references", "bibliography")
        or n.startswith(("references", "bibliography"))
        or n.endswith(("references", "bibliography"))
    )


def find_references_start(
    lines: list[Line], toc: list[TocEntry] | None = None
) -> tuple[int, int] | None:
    """定位参考文献区的起止行下标。

    实测同一份书籍里 "Bibliography" 会在 51 个位置出现：目录提及、真正的
    章节标题（字号 20.7）、以及每页页眉（字号 10.0）。因此判定优先级为：
        1. TOC 中名为 References/Bibliography 的条目 —— 最权威
        2. 字号最大的匹配行 —— 章节标题通常比页眉大

    注意不要对字号设硬性下限：实测论文的 References 标题恰好是 12.0，
    设下限会直接漏掉。
    """
    toc = toc or []

    ref_entry = None
    next_page = None
    for i, e in enumerate(toc):
        if _is_reference_heading(e.title):
            ref_entry = e
            # 在参考文献之后寻找终止条目（Index / Appendix / 附录等）。
            # 实测书籍 TOC 为 'Bibliography p477' 紧接 'Index p527'，
            # 用 Index 作终止点可精确排除索引内容。
            for later in toc[i + 1:]:
                if _is_terminator_heading(later.title):
                    next_page = later.page_no
                    break
            if next_page is None and i + 1 < len(toc):
                next_page = toc[i + 1].page_no
            break

    if ref_entry is not None:
        start = next((k for k, ln in enumerate(lines)
                      if ln.page_no >= ref_entry.page_no), None)
        if start is not None:
            end = (len(lines) if next_page is None
                   else next((k for k, ln in enumerate(lines)
                              if ln.page_no >= next_page), len(lines)))
            if end > start:
                return start, end

    starts = [(i, ln) for i, ln in enumerate(lines) if _is_reference_heading(ln.text)]
    if not starts:
        return None
    i, _best = max(starts, key=lambda pair: pair[1].size)
    return i, len(lines)


def extract_references(
    lines: list[Line], toc: list[TocEntry] | None = None
) -> list[str]:
    """提取参考文献条目。

    优先按 [n] 编号切分；若正文里没有编号（如书籍格式），
    退化为按段落收集，且只在已定位的文献区范围内收集。
    """
    span = find_references_start(lines, toc)
    if span is None:
        return []
    start, end = span
    body = lines[start + 1:end]
    if not body:
        return []

    numbered: list[str] = []
    current: list[str] = []
    for ln in body:
        m = re.match(r"^\[(\d+)\]", ln.text.strip())
        if m:
            if current:
                numbered.append(" ".join(current).strip())
            current = [ln.text.strip()]
        elif current:
            current.append(ln.text.strip())
        if len(numbered) > 2000:
            break
    if current:
        numbered.append(" ".join(current).strip())

    numbered = [r for r in numbered if r]
    if numbered:
        return numbered

    # 无编号：按行距切段
    fallback: list[str] = []
    prev_y = None
    for ln in body:
        if prev_y is not None and ln.bbox[1] - prev_y > 14:
            fallback.append("\n")
        fallback.append(ln.text.strip())
        prev_y = ln.bbox[3]
    text = " ".join(fallback)
    segments = [seg.strip() for seg in text.split("\n") if len(seg.strip()) > 30]
    return segments[:500]


# ---------------------------------------------------------------- 质量评分


_QUALITY_WEIGHTS = {
    "text": 0.35,        # 抽到了足量文本（扫描件拿不到，权重最高）
    "toc": 0.25,         # 有内置书签
    "sections": 0.25,    # 识别出章节结构
    "references": 0.15,  # 识别出参考文献区
}


def score_quality(
    *, char_per_page: float, has_toc: bool, section_count: int, reference_count: int
) -> tuple[float, list[str]]:
    """计算解析置信度（0~1）并给出告警说明。

    评分规则对使用者透明：每一项的权重与阈值都在这里，
    便于在文档中解释「为什么这篇被判为 need_review」。
    """
    warnings: list[str] = []

    text_score = min(char_per_page / 800.0, 1.0)
    if char_per_page < _SCAN_CHAR_THRESHOLD:
        text_score = 0.0
        warnings.append("抽样页几乎取不到文本，疑似扫描件或无文本层")

    toc_score = 1.0 if has_toc else 0.0
    if not has_toc:
        warnings.append("PDF 没有内置书签，目录依靠字号推断，准确度下降")

    section_score = min(section_count / 8.0, 1.0)
    if section_count < 2:
        warnings.append("未能识别出章节结构")

    ref_score = min(reference_count / 10.0, 1.0)
    if reference_count == 0:
        warnings.append("未识别到参考文献区")

    quality = (
        text_score * _QUALITY_WEIGHTS["text"]
        + toc_score * _QUALITY_WEIGHTS["toc"]
        + section_score * _QUALITY_WEIGHTS["sections"]
        + ref_score * _QUALITY_WEIGHTS["references"]
    )
    return round(quality, 4), warnings


# ---------------------------------------------------------------- 入口


def parse_pdf(path: str | Path, sample_pages: int = 5) -> ParsedDocument:
    """解析一个 PDF 文件，返回结构化结果。

    sample_pages 只用于「扫描件判定」的抽样，不影响正文提取。
    """
    path = Path(path)
    result = ParsedDocument()

    with pymupdf.open(path) as doc:
        result.page_count = len(doc)
        if result.page_count == 0:
            result.warnings.append("PDF 没有页面")
            result.needs_review = True
            return result

        # 1) 页面级统计与扫描件判定
        total_chars = 0
        for pno in range(1, result.page_count + 1):
            info = analyse_page(doc, pno)
            result.pages.append(info)
            total_chars += info.char_count

        sample_n = min(sample_pages, result.page_count)
        sampled = result.pages[:sample_n]
        sampled_chars = sum(p.char_count for p in sampled) / max(sample_n, 1)
        result.is_scanned = sampled_chars < _SCAN_CHAR_THRESHOLD

        # 2) 内置 TOC
        result.toc = parse_toc(doc)
        by_title, by_number = build_toc_index(result.toc)

        # 3) 逐页提取行，识别标题
        all_lines: list[Line] = []
        for pno in range(1, result.page_count + 1):
            all_lines.extend(extract_lines(doc, pno))

        body_size = estimate_body_size(all_lines)
        seen: set[tuple[int, str]] = set()
        for ln in all_lines:
            entry = match_toc(ln, by_title, by_number) if result.toc else None
            if entry is not None:
                key = (entry.page_no, normalize_title(entry.title))
                if key not in seen:
                    seen.add(key)
                    result.sections.append(Section(
                        level=entry.level, title=entry.title,
                        page_no=entry.page_no, source="toc",
                    ))
            elif is_heuristic_heading(ln, body_size):
                key = (ln.page_no, normalize_title(ln.text))
                if key not in seen:
                    seen.add(key)
                    result.sections.append(Section(
                        level=1 if re.match(r"^\s*\d+\s", ln.text) else 2,
                        title=ln.text, page_no=ln.page_no, source="heuristic",
                    ))
        result.sections.sort(key=lambda s: (s.page_no, s.level))

        # 3.5) 汇总按页正文。分块需要按页定位，因此这里一并保留。
        by_page: dict[int, list[str]] = {}
        for ln in all_lines:
            by_page.setdefault(ln.page_no, []).append(ln.text)
        result.page_texts = {
            pno: "\n".join(texts) for pno, texts in sorted(by_page.items())
        }
        result.full_text = "\n\n".join(result.page_texts.values())

        # 4) 标题：第 1 页字号最大的短行（须排除竖排侧边水印）
        first_page_lines = [ln for ln in all_lines if ln.page_no == 1]
        if first_page_lines:
            candidates = [
                ln for ln in first_page_lines
                if 6 <= len(ln.text) <= 200
                and ln.width < 520
                and not is_vertical(ln.bbox)
            ]
            if candidates:
                best = max(candidates, key=lambda ln: ln.size)
                if best.size > body_size:
                    result.title = best.text

        # 5) 摘要与参考文献
        result.abstract = extract_abstract(first_page_lines)
        result.references = extract_references(all_lines, result.toc)

        # 6) 置信度
        char_per_page = total_chars / max(result.page_count, 1)
        result.quality, warnings = score_quality(
            char_per_page=char_per_page,
            has_toc=bool(result.toc),
            section_count=len(result.sections),
            reference_count=len(result.references),
        )
        result.warnings.extend(warnings)
        result.needs_review = result.quality < 0.6 or result.is_scanned

    logger.info(
        "解析完成 %s: %d 页, 章节 %d, 参考文献 %d, quality=%.2f%s",
        path.name, result.page_count, len(result.sections),
        len(result.references), result.quality,
        "（需校对）" if result.needs_review else "",
    )
    return result
