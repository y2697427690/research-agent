"""BM25 关键词检索。

BM25 是纯统计方法，不需要任何模型。它解决「给定问题，找出包含相关关键词的
文本块」这件事，优势在于精确术语匹配（如 β1、P100、multi-head），
与向量检索互补——向量擅长语义相近，BM25 擅长字面精确。

参数采用文献通用默认值 k1=1.5、b=0.75，不做调参：
本项目的目标是「结果可解释」，而不是刷到最高分。
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

# ---------------------------------------------------------------- 参数
# k1 控制词频饱和速度：k1 越大，重复出现同一个词的收益越持久
# b  控制长度归一化强度：b=0 不做归一化，b=1 完全按长度归一

K1 = 1.5
B = 0.75

# 英文停用词：这些词几乎出现在每个块里，对区分度没有帮助，
# 保留它们只会让打分被噪声稀释。
# 采用「多行文本 + split」的紧凑写法而不是列表字面量：120 个词写成
# ["a", "about", ...] 会严重降低可读性，属于规则建议反而变差的情形，
# 故在本行显式忽略 SIM905。
_STOPWORD_TEXT = """
a about above after again all also an and any are as at be because been before
being below between both but by can could did do does doing down during each few
for from further had has have having he her here hers him his how i if in into is
it its itself just may me more most may might my no nor not of off on once only or
other our ours out over own same she should so some such than that the their
them then there these they this those through to too under until up very was we
were what when where which while who whom why will with would you your
"""

STOPWORDS = frozenset(_STOPWORD_TEXT.split())  # noqa: SIM905

# 中文没有空格，用 2-gram 切分是免分词库的标准做法。
# 例如「注意力机制」→ 注意 / 意力 / 力机 / 机制
_CJK_BLOCK = re.compile(r"[\u4e00-\u9fff]+")

# 英文与符号词：支持连字符与点号连接的复合词（multi-head、dot-product、h.264）。
# 用 [^\W_] 而不写 [a-z] 是为了同时容纳希腊字母（β1）与非 ASCII 字母。
_WORD = re.compile(r"[^\W_]+(?:[-.][^\W_]+)*", re.UNICODE)


# ---------------------------------------------------------------- 分词

def tokenize(text: str) -> list[str]:
    """把文本切成检索用的词项。

    英文：小写化 → 去停用词 → 保留复合词（multi-head 视为一个词）
    中文：连续汉字切 2-gram

    不做词干化（stemming）：head 与 heads 若被合并，会降低精确匹配能力，
    而精确匹配正是 BM25 相对向量检索的价值所在。
    """
    if not text:
        return []

    lowered = text.lower()
    tokens: list[str] = []

    # 先把中文片段单独抽出来切 2-gram，避免与英文规则互相干扰
    for block in _CJK_BLOCK.findall(lowered):
        if len(block) == 1:
            tokens.append(block)
        else:
            tokens.extend(block[i:i + 2] for i in range(len(block) - 1))

    # 把中文替换成空格后，剩余部分按英文规则切分
    rest = _CJK_BLOCK.sub(" ", lowered)
    for m in _WORD.finditer(rest):
        word = m.group(0)
        if len(word) < 2:
            continue
        if word in STOPWORDS:
            continue
        tokens.append(word)

    return tokens

# ---------------------------------------------------------------- 数据结构


@dataclass(frozen=True)
class IndexedChunk:
    """进入索引的一个块。只保留检索与展示所需的字段。"""

    chunk_id: str
    paper_id: str
    text: str
    section_title: str | None = None
    page_start: int = 1
    page_end: int = 1

    @property
    def citation(self) -> str:
        """溯源描述，用于回答时标注出处。"""
        section = self.section_title or "前置内容"
        if self.page_start == self.page_end:
            return f"{section}（第 {self.page_start} 页）"
        return f"{section}（第 {self.page_start}-{self.page_end} 页）"


class BM25Index:
    """BM25 倒排索引。

    用法：
        index = BM25Index()
        index.build([IndexedChunk(...), ...])
        hits = index.search("what is multi-head attention", top_k=5)
    """

    def __init__(self) -> None:
        # 按顺序保存的块，下标即内部 doc_id
        self.chunks: list[IndexedChunk] = []
        # 每块的长度（词项数）
        self.doc_len: list[int] = []
        # 平均块长，用于长度归一化
        self.avgdl: float = 0.0
        # 倒排表：词项 -> {doc_id: 该词在该块出现的次数}
        self.postings: dict[str, dict[int, int]] = {}
        # 文档频率：词项出现在多少个块里
        self.df: dict[str, int] = {}

    def __len__(self) -> int:
        return len(self.chunks)

    def build(self, chunks: list[IndexedChunk]) -> None:
        """用给定块重建索引（清空旧内容，所以在增量更新时可重复调用）。"""
        self.chunks = list(chunks)
        self.doc_len = []
        self.postings = {}
        self.df = {}

        for doc_id, chunk in enumerate(self.chunks):
            tokens = tokenize(chunk.text)
            self.doc_len.append(len(tokens))
            # 同一次检索里统计词频，用普通 dict 即可
            tf: dict[str, int] = {}
            for token in tokens:
                tf[token] = tf.get(token, 0) + 1
            for token, count in tf.items():
                self.postings.setdefault(token, {})[doc_id] = count
                self.df[token] = self.df.get(token, 0) + 1

        self.avgdl = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 0.0

    @property
    def vocab_size(self) -> int:
        """词表大小，便于观察索引规模。"""
        return len(self.postings)

    @property
    def max_idf(self) -> float:
        """本语料下一个词能达到的最大 IDF（即只出现在一个块中的词）。

        用于把 IDF 换算成「相对区分度」：IDF 的绝对值与语料规模强相关，
        只有 2 个块时上限约 0.69，而 5 万个块时上限可达 10 以上，
        因此任何绝对阈值都会在小语料或大语料上失效。
        """
        n = len(self.chunks)
        if n <= 1:
            return 0.0
        return math.log((n - 1 + 0.5) / (1 + 0.5) + 1.0)

    # ------------------------------------------------------------ 打分

    def idf(self, term: str) -> float:
        """词的逆文档频率。

        df 越小（词越罕见）→ IDF 越大 → 命中它越值钱。
        公式用带平滑的 +1 变体，保证 IDF 恒为正；
        否则当某词出现在过半块中时，log 结果为负，
        会出现「出现得越多反而扣分」的反直觉现象。
        """
        n = len(self.chunks)
        df = self.df.get(term, 0)
        if n == 0 or df == 0:
            return 0.0
        return math.log((n - df + 0.5) / (df + 0.5) + 1.0)

    def score(self, query: str) -> list[tuple[int, float]]:
        """对全部块打分，返回按分数降序的 (doc_id, score)。

        只返回分数大于 0 的块（即至少命中一个查询词的块）。
        """
        if not self.chunks:
            return []

        tokens = tokenize(query)
        if not tokens:
            return []

        scores = [0.0] * len(self.chunks)

        # 同一个词在问题里出现多次不重复累加，否则「attention attention」
        # 会把分数刷高，但语义上与单个 attention 没有区别
        for term in dict.fromkeys(tokens):
            posting = self.postings.get(term)
            if not posting:
                continue

            term_idf = self.idf(term)
            for doc_id, tf in posting.items():
                dl = self.doc_len[doc_id]
                # 长度归一化：块越长，同样的词频得分越低
                denominator = tf + K1 * (1 - B + B * dl / self.avgdl)
                scores[doc_id] += term_idf * (tf * (K1 + 1)) / denominator

        ranked = [(doc_id, s) for doc_id, s in enumerate(scores) if s > 0.0]
        ranked.sort(key=lambda pair: -pair[1])
        return ranked

    def search(
        self, query: str, top_k: int = 10, min_score: float = 0.0
    ) -> list[SearchHit]:
        """检索，返回带来源信息的命中列表。

        min_score 用于过滤弱相关结果：BM25 分数没有绝对量纲，
        只要命中一个词就会有分数，因此过低的分数往往只是噪声。
        """
        if top_k <= 0:
            return []

        ranked = self.score(query)
        if not ranked:
            return []

        query_terms = list(dict.fromkeys(tokenize(query)))

        hits: list[SearchHit] = []
        for doc_id, raw_score in ranked:
            if raw_score <= min_score:
                continue
            chunk = self.chunks[doc_id]
            matched = [
                t for t in query_terms
                if doc_id in self.postings.get(t, {})
            ]
            hits.append(SearchHit(
                chunk=chunk,
                score=round(raw_score, 4),
                matched_terms=matched,
            ))
            if len(hits) >= top_k:
                break
        return hits

@dataclass
class SearchHit:
    """一条检索命中。"""

    chunk: IndexedChunk
    score: float
    matched_terms: list[str]

    def describe(self) -> str:
        """便于日志与调试的单行描述。"""
        terms = "/".join(self.matched_terms)
        return f"[{self.score:.3f}] {self.chunk.citation}  命中: {terms}"
