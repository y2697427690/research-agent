"""BM25 检索的测试。

覆盖：分词规则、IDF 方向、词频饱和、长度归一化、检索排序与过滤。
"""
import os

import pytest

from app.services.bm25 import (
    K1,
    STOPWORDS,
    BM25Index,
    IndexedChunk,
    SearchHit,
    tokenize,
)
from app.services.chunking import chunk_document
from app.services.pdf_parser import parse_pdf

STANDARD = r"D:\Desktop\科研小助手\pdf\1706.03762v1.pdf"


def make_index(texts: list[str]) -> BM25Index:
    idx = BM25Index()
    idx.build([
        IndexedChunk(chunk_id=f"c{i}", paper_id="p1", text=t,
                     section_title=f"Sec {i}", page_start=i + 1, page_end=i + 1)
        for i, t in enumerate(texts)
    ])
    return idx


# ---------------------------------------------------------------- 分词


def test_tokenize_removes_stopwords():
    tokens = tokenize("The model is a transformer")
    assert "the" not in tokens
    assert "is" not in tokens
    assert "a" not in tokens
    assert "model" in tokens
    assert "transformer" in tokens


def test_tokenize_keeps_hyphenated_terms_as_one_token():
    """multi-head 必须保持整体：拆开后 head 太常见，区分度会大幅下降。"""
    tokens = tokenize("multi-head attention and dot-product")
    assert "multi-head" in tokens
    assert "dot-product" in tokens
    assert "head" not in tokens


def test_tokenize_chinese_uses_bigrams():
    tokens = tokenize("注意力机制")
    assert tokens == ["注意", "意力", "力机", "机制"]


def test_tokenize_single_chinese_char():
    assert tokenize("猫") == ["猫"]


def test_tokenize_keeps_greek_and_digits():
    tokens = tokenize("the β1 parameter and P100 score")
    assert "β1" in tokens
    assert "p100" in tokens


def test_tokenize_drops_single_letters():
    tokens = tokenize("a b c model")
    assert "model" in tokens
    assert "a" not in tokens


def test_tokenize_empty_and_none_like():
    assert tokenize("") == []
    assert tokenize("   ") == []


def test_stopwords_does_not_contain_technical_terms():
    for word in ("attention", "model", "transformer", "network", "layer"):
        assert word not in STOPWORDS


# ---------------------------------------------------------------- IDF


def test_idf_decreases_with_document_frequency():
    """越常见的词 IDF 越低。"""
    idx = make_index([
        "attention model",
        "attention model",
        "attention model",
        "multi-head attention",
    ])
    idf_common = idx.idf("model")       # 出现在 3 个块
    idf_rare = idx.idf("multi-head")    # 出现在 1 个块
    assert idf_rare > idf_common > 0


def test_idf_is_positive_even_for_very_common_term():
    """出现在所有块里的词，IDF 仍应为正（公式里的 +1 保证这一点）。"""
    idx = make_index(["attention"] * 10)
    assert idx.idf("attention") > 0


def test_idf_zero_for_absent_term():
    idx = make_index(["attention"])
    assert idx.idf("nonexistentterm") == 0.0
    assert idx.idf("the") == 0.0        # 停用词不在索引里


def test_idf_zero_on_empty_index():
    idx = BM25Index()
    assert idx.idf("anything") == 0.0


# ---------------------------------------------------------------- 打分特性


def test_score_increases_with_term_frequency_but_saturates():
    """词频越高分越高，但收益递减且封顶（k1 的作用）。"""
    idx = make_index([
        "attention",
        "attention attention",
        "attention attention attention attention attention attention attention",
    ])
    ranked = dict(idx.score("attention"))
    assert ranked[0] < ranked[1] < ranked[2]
    # 7 次出现相比 2 次出现的增幅，应明显小于 2 次相比 1 次的增幅
    gain_1_to_2 = ranked[1] - ranked[0]
    gain_2_to_7 = ranked[2] - ranked[1]
    assert gain_2_to_7 < gain_1_to_2 * 3


def test_shorter_chunk_ranks_higher_for_same_term_frequency():
    """同样出现 2 次，短块得分更高（b 的长度归一化作用）。"""
    short = "attention attention"
    long_text = "attention attention " + " ".join(f"filler{i}" for i in range(60))
    idx = make_index([short, long_text])
    ranked = dict(idx.score("attention"))
    assert ranked[0] > ranked[1]


def test_repeated_query_term_does_not_inflate_score():
    """问题里重复同一个词不应把分数刷高。"""
    idx = make_index(["attention model"])
    once = dict(idx.score("attention"))[0]
    twice = dict(idx.score("attention attention"))[0]
    assert once == pytest.approx(twice)


def test_score_ignores_terms_not_in_index():
    idx = make_index(["attention model"])
    assert idx.score("nonexistentterm") == []
    assert idx.score("") == []
    assert idx.score("the and of") == []      # 全是停用词


def test_score_empty_index():
    idx = BM25Index()
    assert idx.score("attention") == []
    assert len(idx) == 0


# ---------------------------------------------------------------- 检索


def test_search_returns_hits_with_metadata():
    idx = make_index(["multi-head attention mechanism", "convolutional network"])
    hits = idx.search("multi-head attention", top_k=5)
    assert hits
    hit = hits[0]
    assert isinstance(hit, SearchHit)
    assert hit.chunk.chunk_id == "c0"
    assert "multi-head" in hit.matched_terms
    assert hit.score > 0
    assert "第" in hit.chunk.citation
    assert isinstance(hit.describe(), str)


def test_search_respects_top_k():
    idx = make_index([f"attention in chunk {i}" for i in range(10)])
    assert len(idx.search("attention", top_k=3)) == 3
    assert len(idx.search("attention", top_k=100)) == 10


def test_search_top_k_zero_or_negative_returns_empty():
    idx = make_index(["attention"])
    assert idx.search("attention", top_k=0) == []
    assert idx.search("attention", top_k=-5) == []


def test_search_min_score_filters_weak_hits():
    idx = make_index(["attention alone", "attention attention attention"])
    all_hits = idx.search("attention")
    threshold = (all_hits[0].score + all_hits[-1].score) / 2
    filtered = idx.search("attention", min_score=threshold)
    assert len(filtered) < len(all_hits)
    assert all(h.score > threshold for h in filtered)


def test_search_ranking_is_descending():
    idx = make_index([
        "unrelated text about birds",
        "attention",
        "attention attention attention mechanism",
    ])
    hits = idx.search("attention", top_k=3)
    scores = [h.score for h in hits]
    assert scores == sorted(scores, reverse=True)
    assert hits[0].chunk.chunk_id == "c2"


def test_search_empty_query():
    idx = make_index(["attention"])
    assert idx.search("") == []
    assert idx.search("the of and") == []


# ---------------------------------------------------------------- 索引构建


def test_build_is_idempotent_and_clears_previous_state():
    idx = make_index(["attention model", "convolutional network"])
    assert len(idx) == 2
    idx.build([IndexedChunk(chunk_id="only", paper_id="p2", text="attention")])
    assert len(idx) == 1
    assert idx.chunks[0].chunk_id == "only"
    assert "network" not in idx.postings


def test_avgdl_and_vocab():
    idx = make_index(["attention model", "multi-head attention"])
    assert idx.avgdl > 0
    assert idx.vocab_size > 0
    assert "attention" in idx.postings


def test_k1_constant_is_conventional():
    assert K1 == 1.5


# ---------------------------------------------------------------- 真实数据


@pytest.mark.skipif(not os.path.exists(STANDARD), reason="缺少官方测试 PDF")
def test_regression_search_on_real_paper():
    """在真实论文上检索，排序应符合常识。"""
    doc = parse_pdf(STANDARD)
    chunks, _ = chunk_document(doc)
    assert chunks

    idx = BM25Index()
    idx.build([
        IndexedChunk(chunk_id=f"c{c.index}", paper_id="p1", text=c.text,
                     section_title=c.section_title,
                     page_start=c.page_start, page_end=c.page_end)
        for c in chunks
    ])

    hits = idx.search("multi-head attention", top_k=5)
    assert hits
    top_text = hits[0].chunk.text.lower()
    assert "attention" in top_text
    assert any("attention" in t or "multi" in t for t in hits[0].matched_terms)

    # 精确术语检索：positional encoding 应命中相关段落
    hits2 = idx.search("positional encoding", top_k=3)
    assert hits2
    assert "positional" in hits2[0].matched_terms

    # 完全无关的查询应没有结果
    assert idx.search("zzzz-unlikely-term-xyzzy") == []
