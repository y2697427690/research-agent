"""文本分块。

分块策略是「章节感知」而非固定长度切分：
先按解析得到的章节边界把全文划成若干区域，再在每个区域内按句子边界
切到目标长度。这样每个块都能带上「所属章节 + 页码范围」，
回答问题时才能准确标注出处（对应需求 3.2 的源头溯源要求）。

为什么不用固定长度硬切：
1. 硬切会把一句话、一个公式、一行表格从中间切断，检索命中后读起来没头没尾
2. 硬切丢失章节信息，无法判断这段属于「方法」还是「实验」
3. 论文的版面本身是结构化的，利用结构比忽略它效果更好
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.pdf_parser import ParsedDocument

# 句子边界：句号/问号/叹号后接空白，且下一个字符像是新句子的开头
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'\u201c\u2018])")

# 噪声行：arXiv 侧边水印、纯页码。这些进了 chunk 只会干扰检索
_NOISE_LINE = re.compile(
    r"^\s*(?:arXiv:\d{4}\.\d{4,5}v\d+\s*\[[^\]]*\]\s*.*|arXiv:\d{4}\.\d{4,5}v\d+|\d{1,3})\s*$"
)

# 图注/边栏标签行，形如 "Encoder:"、"Decoder:"、"Scaled Dot-Product Attention:"。
# 这类文字在 PDF 里是图中文字的独立文本块，但按 y 坐标排序时会落在正文两行之间，
# 拼成一整段后就插进了句子中间，把连续短语劈开。实测原句：
#     The encoder is composed of a stack of N = 6 identical layers. Each layer has two
#     Encoder:                          ← 图 1 的侧边标签
#     sub-layers. The first is a multi-head self-attention mechanism...
# 拼段后变成「Each layer has two Encoder: sub-layers.」，
# 导致「two sub-layers」这个关键短语检索不到，模型看到的语义也是破碎的。
# 判据：独立成行、以冒号结尾、长度很短（图上标签不会很长）。
_LABEL_LINE = re.compile(r"^\s*[A-Z][A-Za-z0-9 \-/&]{0,28}:\s*$")

# 默认参数：目标 700 字符、重叠 120 字符
DEFAULT_TARGET_CHARS = 700
DEFAULT_OVERLAP_CHARS = 120
MAX_CHUNKS_PER_DOC = 5000   # 防止异常输入产生海量块（541 页书籍实测约 1400 块）

# 建索引时默认跳过的区域：这些内容对问答没有帮助，却会大量占据检索结果。
# 实测 541 页书籍的 Bibliography + Index 占了全部块的 19%。
# 参考文献本身另有用途（引文核验），由 pdf_parser 的 references 单独提供，
# 不需要进入检索库。
DEFAULT_SKIP_SECTIONS = ("references", "bibliography", "index", "acknowledg")

# 参考文献列表的内容特征。除 [n] 编号与年份外，还要区分「含引用的表格」：
# 实测某论文 Table 3/4 里也有 [36] 与 2013 这类内容，仅凭前两个条件会误删表格。
# 数据对比（同一篇论文）：
#     表格   数字占比 0.300 / 0.112，平均词长 4.6 / 5.1，长词比例 0.291 / 0.369
#     文献   数字占比 0.053~0.086，平均词长 5.3~6.1，长词比例 0.393~0.553
# 因此加两条判据：数字占比要低（文献是大段文字，表格是密集数字），
# 且长词比例要高（文献含有大量标题类长单词）。
# 阈值取值偏保守：宁可漏掉几个噪声块，也不要误删表格这类真实内容。
_CITE_MARK = re.compile(r"\[\d+\]")
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_DIGIT = re.compile(r"\d")
_WORD = re.compile(r"[A-Za-z]+")

MAX_REFERENCE_DIGIT_RATIO = 0.10     # 数字占比上限
MIN_REFERENCE_LONG_WORD_RATIO = 0.35  # 长度 >= 6 的单词占比下限


def is_reference_like(text: str) -> bool:
    """判断一段文本是否像参考文献列表。

    四个条件同时满足才判定为文献：
      1. 至少 3 个 [n] 引用编号
      2. 至少 3 个四位年份
      3. 数字占比低于 0.10（表格数字密集，会被这一条排除）
      4. 长词（>=6 字母）占比不低于 0.35（文献含大量标题类长词）
    """
    if not text:
        return False
    if len(_CITE_MARK.findall(text)) < 3:
        return False
    if len(_YEAR.findall(text)) < 3:
        return False

    total = len(text)
    if len(_DIGIT.findall(text)) / total >= MAX_REFERENCE_DIGIT_RATIO:
        return False

    words = _WORD.findall(text)
    if not words:
        return False
    long_ratio = sum(1 for w in words if len(w) >= 6) / len(words)
    return long_ratio >= MIN_REFERENCE_LONG_WORD_RATIO


@dataclass
class Chunk:
    """一个文本分块。"""

    index: int                      # 在本文档内的序号，从 0 开始
    text: str
    section_title: str | None = None
    level: int = 0                  # 0 表示前置内容（标题/摘要区），1/2/3 对应章节层级
    page_start: int = 1
    page_end: int = 1

    @property
    def char_count(self) -> int:
        return len(self.text)

    def describe(self) -> str:
        """人类可读的来源描述，用于回答时标注出处。"""
        section = self.section_title or "前置内容"
        if self.page_start == self.page_end:
            return f"{section}（第 {self.page_start} 页）"
        return f"{section}（第 {self.page_start}-{self.page_end} 页）"


@dataclass
class ChunkStats:
    """分块统计，便于排查与写入日志。"""

    total: int = 0
    total_chars: int = 0
    avg_chars: float = 0.0
    sections: int = 0
    skipped_noise_lines: int = 0
    skipped_regions: int = 0     # 被跳过的区域数（参考文献/索引等）
    skipped_reference_chunks: int = 0   # 被识别为文献列表而跳过的块数


# 统计用：图注标签行的删除数单独计数，便于观察这类噪声的实际规模
def clean_page_text(text: str) -> tuple[str, int]:
    """去掉噪声行（arXiv 水印、纯页码、图注标签）。返回 (清洗后文本, 去掉的行数)。"""
    kept: list[str] = []
    removed = 0
    for line in text.splitlines():
        if _NOISE_LINE.match(line) or _LABEL_LINE.match(line):
            removed += 1
            continue
        kept.append(line)
    return "\n".join(kept), removed


def split_sentences(text: str) -> list[str]:
    """按句子边界切分，并合并过短的碎片。"""
    # 先把换行当成分隔（PDF 提取的换行常是排版换行，不是句子边界）
    normalized = re.sub(r"[ \t]+", " ", text)
    raw = re.split(r"\n+|(?<=[.!?])\s+(?=[A-Z0-9])", normalized)
    sentences = [s.strip() for s in raw if s and s.strip()]

    # 过短的碎片（如 "Fig. 1." 被切出的 "Fig."）与后一句合并
    merged: list[str] = []
    for s in sentences:
        if merged and len(merged[-1]) < 25:
            merged[-1] = merged[-1] + " " + s
        else:
            merged.append(s)
    return merged


def _pack(
    sentences: list[str], target: int, overlap: int
) -> list[str]:
    """把句子贪心装进目标长度的块，块之间保留 overlap 字符的重叠。

    重叠的意义：避免关键信息正好被切在块边界上而两边的块都检索不到。
    """
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for sentence in sentences:
        if not sentence:
            continue
        if current and current_len + len(sentence) > target:
            chunks.append(" ".join(current))
            # 取尾部若干句作为下一块的开头
            tail: list[str] = []
            tail_len = 0
            for prev in reversed(current):
                if tail_len + len(prev) > overlap:
                    break
                tail.insert(0, prev)
                tail_len += len(prev) + 1
            current = tail + [sentence]
            current_len = tail_len + len(sentence)
        else:
            current.append(sentence)
            current_len += len(sentence) + 1

    if current:
        chunks.append(" ".join(current))
    return chunks


def _build_regions(
    doc: ParsedDocument,
) -> list[tuple[str | None, int, list[int]]]:
    """把「页」按章节归属聚成区域。

    同一页上可能有多个章节起始（例如 "2 Background" 与 "3 Model Architecture"
    都从第 2 页开始）。由于我们只有页级文本，无法精确到行，
    因此约定：**一页归属于「该页及其之前最后一个开始的章节」**。
    这样既确定又可解释，不会出现页被重复计入两个章节。
    """
    pages = sorted(doc.page_texts.keys())
    if not pages:
        return []

    sections = sorted(doc.sections, key=lambda s: (s.page_no, s.level))
    page_section: dict[int, tuple[str | None, int]] = {}
    cursor = 0
    # current 记录「当前所处章节」。每页先看是否有新章节在本页开始，
    # 然后无论有无，都把 current 赋给这一页 —— 章节归属要沿后续页继承。
    current: tuple[str | None, int] = (None, 0)
    for pno in pages:
        while cursor < len(sections) and sections[cursor].page_no <= pno:
            current = (sections[cursor].title, sections[cursor].level)
            cursor += 1
        page_section[pno] = current

    regions: list[tuple[str | None, int, list[int]]] = []
    for pno in pages:
        title, level = page_section[pno]
        if regions and regions[-1][0] == title and regions[-1][1] == level:
            regions[-1][2].append(pno)
        else:
            regions.append((title, level, [pno]))
    return regions


def _should_skip(title: str | None, keywords: tuple[str, ...]) -> bool:
    """判断该区域是否应跳过（参考文献 / 索引 / 致谢等）。"""
    if not title or not keywords:
        return False
    lowered = title.strip().casefold()
    return any(lowered.startswith(k) for k in keywords)


def chunk_document(
    doc: ParsedDocument,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
    skip_sections: tuple[str, ...] = DEFAULT_SKIP_SECTIONS,
    drop_reference_like: bool = True,
) -> tuple[list[Chunk], ChunkStats]:
    """把一个已解析的文档切成检索用的块。

    skip_sections     排除不参与检索的区域（默认参考文献、索引、致谢）。
    drop_reference_like 额外按内容特征丢弃文献列表块，
                      用于参考文献没有被识别为独立章节的情况。
    两者都设为关闭即可保留全部内容。

    返回 (块列表, 统计信息)。纯计算，不涉及数据库与 IO，便于单元测试。
    """
    stats = ChunkStats()
    chunks: list[Chunk] = []
    index = 0

    for title, level, pages in _build_regions(doc):
        if _should_skip(title, skip_sections):
            stats.skipped_regions += 1
            continue

        # 拼接该区域所有页的正文，先清掉噪声行
        texts: list[str] = []
        for pno in pages:
            cleaned, removed = clean_page_text(doc.page_texts.get(pno, ""))
            stats.skipped_noise_lines += removed
            if cleaned.strip():
                texts.append(cleaned)
        body = "\n".join(texts).strip()
        if not body:
            continue

        sentences = split_sentences(body)
        if not sentences:
            continue

        for piece in _pack(sentences, target_chars, overlap_chars):
            piece = piece.strip()
            if len(piece) < 30:      # 太短的块对检索没有价值
                continue
            if drop_reference_like and is_reference_like(piece):
                stats.skipped_reference_chunks += 1
                continue
            chunks.append(Chunk(
                index=index,
                text=piece,
                section_title=title,
                level=level,
                page_start=pages[0],
                page_end=pages[-1],
            ))
            index += 1
            if len(chunks) >= MAX_CHUNKS_PER_DOC:
                break
        if len(chunks) >= MAX_CHUNKS_PER_DOC:
            break

    stats.total = len(chunks)
    stats.total_chars = sum(c.char_count for c in chunks)
    stats.avg_chars = round(stats.total_chars / stats.total, 1) if stats.total else 0.0
    stats.sections = len({c.section_title for c in chunks if c.section_title})
    return chunks, stats
