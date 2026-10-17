"""分块模块的测试。

覆盖：噪声清理、句子切分、章节归属继承（曾出现的 bug）、
分块长度控制、参考文献过滤、真实 PDF 回归。
"""
import os

import pytest

from app.services.chunking import (
    MAX_REFERENCE_DIGIT_RATIO,
    Chunk,
    _build_regions,
    chunk_document,
    clean_page_text,
    is_reference_like,
    split_sentences,
)
from app.services.pdf_parser import PageInfo, ParsedDocument, Section, parse_pdf

PDF_DIR = r"D:\Desktop\科研小助手\pdf"
STANDARD = os.path.join(PDF_DIR, "1706.03762v1.pdf")
SCANNED = os.path.join(PDF_DIR, "1706.03762v1_img.pdf")
BOOK = os.path.join(PDF_DIR, "UnderstandingDeepLearning_02_09_26_C.pdf")


def make_doc(pages: dict[int, str], sections: list[tuple[int, str, int]]) -> ParsedDocument:
    """构造一个测试用 ParsedDocument。sections 为 (level, title, page_no)。"""
    doc = ParsedDocument(page_count=max(pages) if pages else 0)
    doc.page_texts = dict(pages)
    doc.full_text = "\n\n".join(pages[p] for p in sorted(pages))
    doc.sections = [Section(level=lv, title=t, page_no=p) for lv, t, p in sections]
    doc.pages = [PageInfo(page_no=p, width=612, height=792,
                          char_count=len(pages[p]), image_count=0)
                 for p in sorted(pages)]
    return doc


# ---------------------------------------------------------------- 噪声清理


def test_clean_page_text_removes_arxiv_stamp_and_page_numbers():
    text = "arXiv:1706.03762v1  [cs.CL]  12 Jun 2017\n真实正文内容\n42\n另一行正文"
    cleaned, removed = clean_page_text(text)
    assert "arXiv:" not in cleaned
    assert "真实正文内容" in cleaned
    assert "另一行正文" in cleaned
    assert removed == 2


def test_clean_page_text_keeps_normal_numbers():
    """正文里的数字（如 28.4 BLEU）不能被当成页码删掉。"""
    cleaned, removed = clean_page_text("Our model achieves 28.4 BLEU on the task.")
    assert "28.4 BLEU" in cleaned
    assert removed == 0


# ---------------------------------------------------------------- 句子切分


def test_split_sentences_basic():
    text = "第一句结束。Second sentence here. Third one? Fourth!"
    sents = split_sentences(text)
    assert len(sents) >= 2
    assert any("Second sentence" in s for s in sents)


def test_split_sentences_merges_short_fragments():
    """过短碎片（如 'Fig.'）应与后文合并，避免产生一堆无意义的短句。"""
    sents = split_sentences("Fig. The model has six layers.")
    assert all(len(s) >= 5 for s in sents)


# ---------------------------------------------------------------- 章节归属


def test_build_regions_carries_section_to_following_pages():
    """章节归属必须继承到后续页（曾出现的 bug：只有起始页拿到标题）。"""
    doc = make_doc(
        pages={1: "前言内容", 2: "第一章的正文", 3: "第一章继续", 4: "第二章正文"},
        sections=[(1, "Chapter One", 2), (1, "Chapter Two", 4)],
    )
    regions = _build_regions(doc)
    mapping = {p: (t, lv) for t, lv, pages in regions for p in pages}
    assert mapping[1] == (None, 0)          # 首个章节之前
    assert mapping[2] == ("Chapter One", 1)
    assert mapping[3] == ("Chapter One", 1)  # 继承，不是 None
    assert mapping[4] == ("Chapter Two", 1)


def test_build_regions_later_section_on_same_page_wins():
    """同一页有多个章节起始时，后一个生效（页级切分的固有局限，需可预测）。"""
    doc = make_doc(
        pages={1: "内容", 2: "两个章节都从这页开始"},
        sections=[(1, "First Sec", 1), (1, "Second Sec", 2)],
    )
    mapping = {p: t for t, _, pages in _build_regions(doc) for p in pages}
    assert mapping[2] == "Second Sec"


# ---------------------------------------------------------------- 参考文献判定

REFERENCE_TEXT = (
    "[1] Ilya Sutskever, Oriol Vinyals, and Quoc VV Le. Sequence to sequence learning "
    "with neural networks. In Advances in Neural Information Processing Systems, 2014. "
    "[2] Kyunghyun Cho, Bart van Merrienboer. Learning phrase representations using RNN "
    "encoder-decoder for statistical machine translation. arXiv preprint, 2014. "
    "[3] Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio. Neural machine translation "
    "by jointly learning to align and translate. CoRR, abs/1409.0473, 2014."
)

TABLE_TEXT = (
    "steps (dev) (dev) base 1024 0.1 0.1 100K 4.92 25.8 5.29 24.9 5.00 25.5 "
    "(A) 4.91 25.8 5.01 25.4 5.16 25.1 (B) 5.01 25.4 6.11 23.7 5.19 25.3 "
    "2013 2014 2015 2016 90.4 91.7 91.8 92.0 0.5 0.6 0.7 0.8"
)


def test_is_reference_like_accepts_reference_list():
    assert is_reference_like(REFERENCE_TEXT) is True


def test_is_reference_like_rejects_table_with_citations():
    """含引用编号与年份的表格不能被误判为参考文献（实测遇到过的误删）。"""
    assert is_reference_like(TABLE_TEXT) is False


def test_is_reference_like_rejects_plain_body():
    body = (
        "We propose a new simple network architecture, the Transformer, based solely on "
        "attention mechanisms. Experiments on two machine translation tasks show these "
        "models are superior in quality while being more parallelizable."
    )
    assert is_reference_like(body) is False


def test_is_reference_like_rejects_text_without_citations():
    text = "This section discusses the results from 2014 and 2016 in detail, twice."
    assert is_reference_like(text) is False


# ---------------------------------------------------------------- 分块行为


def test_chunk_document_respects_target_size():
    body = " ".join(f"This is sentence number {i} of the test document." for i in range(200))
    doc = make_doc(pages={1: body}, sections=[(1, "Only Section", 1)])
    chunks, stats = chunk_document(doc, target_chars=300, overlap_chars=50)
    assert stats.total == len(chunks) > 1
    # 允许一定溢出（单句超长时无法再切），但多数块应接近目标长度
    assert max(c.char_count for c in chunks) < 500
    assert stats.avg_chars > 150


def test_chunk_document_attaches_section_and_pages():
    doc = make_doc(
        pages={1: "第一章正文。" * 50, 2: "第一章续。" * 50, 3: "第二章正文。" * 50},
        sections=[(1, "第一章", 1), (1, "第二章", 3)],
    )
    chunks, _ = chunk_document(doc)
    assert chunks
    assert all(c.section_title for c in chunks)
    first = chunks[0]
    assert first.section_title == "第一章"
    assert first.page_start == 1
    assert isinstance(first.describe(), str)
    assert "第" in first.describe()


def test_chunk_document_skips_reference_sections():
    pages = {
        1: "正文内容。" * 100,
        2: "[1] Author One. Title one. 2019. [2] Author Two. Title two. 2020. "
           "[3] Author Three. Title three. 2021." * 5,
    }
    doc = make_doc(pages=pages, sections=[(1, "Intro", 1), (1, "References", 2)])
    chunks, stats = chunk_document(doc)
    assert stats.skipped_regions >= 1
    assert all(c.section_title != "References" for c in chunks)


def test_chunk_document_can_disable_skipping():
    pages = {1: "正文。" * 100, 2: "参考文献内容。" * 100}
    doc = make_doc(pages=pages, sections=[(1, "Intro", 1), (1, "References", 2)])
    kept, _ = chunk_document(doc)
    allc, _ = chunk_document(doc, skip_sections=(), drop_reference_like=False)
    assert len(allc) > len(kept)


def test_chunk_document_empty_document():
    doc = make_doc(pages={}, sections=[])
    chunks, stats = chunk_document(doc)
    assert chunks == []
    assert stats.total == 0
    assert stats.avg_chars == 0.0


def test_chunk_describe_format():
    c = Chunk(index=0, text="x" * 50, section_title="Method", page_start=3, page_end=3)
    assert "Method" in c.describe() and "3" in c.describe()
    c2 = Chunk(index=1, text="x" * 50, section_title=None, page_start=1, page_end=2)
    assert "前置" in c2.describe()


# ---------------------------------------------------------------- 真实 PDF 回归


@pytest.mark.skipif(not os.path.exists(STANDARD), reason="缺少官方测试 PDF")
def test_regression_standard_paper_chunks():
    doc = parse_pdf(STANDARD)
    assert doc.page_texts, "解析结果应包含按页正文"

    chunks, stats = chunk_document(doc)
    assert 40 <= len(chunks) <= 80
    assert all(c.char_count >= 30 for c in chunks)
    assert all(c.section_title for c in chunks[:5])
    # 分块后不应再有文献列表（该论文的 References 混在最后一章里）
    assert not any(is_reference_like(c.text) for c in chunks)
    assert stats.skipped_reference_chunks > 0
    assert stats.avg_chars > 400


@pytest.mark.skipif(not os.path.exists(STANDARD), reason="缺少官方测试 PDF")
def test_regression_standard_paper_keeps_tables():
    """含数字与引用的结果表格不能被当成文献列表删掉。"""
    doc = parse_pdf(STANDARD)
    chunks, _ = chunk_document(doc)
    joined = " ".join(c.text for c in chunks)
    assert "1024" in joined, "表格里的数值应保留"
    assert "Transformer (4 layers)" in joined or "WSJ only" in joined


@pytest.mark.skipif(not os.path.exists(SCANNED), reason="缺少官方扫描件 PDF")
def test_regression_scanned_has_no_chunks():
    doc = parse_pdf(SCANNED)
    chunks, stats = chunk_document(doc)
    assert chunks == []
    assert stats.total == 0


@pytest.mark.skipif(not os.path.exists(BOOK), reason="缺少长篇书籍 PDF")
def test_regression_book_chunks():
    doc = parse_pdf(BOOK)
    chunks, stats = chunk_document(doc)
    assert 1500 <= len(chunks) <= 2200
    assert stats.skipped_regions >= 2          # 至少跳过 Bibliography 与 Index
    titles = {(c.section_title or "").casefold() for c in chunks}
    assert not any(t.startswith("bibliography") for t in titles)
    assert not any(t.startswith("index") for t in titles)
    # 章节归属应覆盖多数块，而不是全落在「前置内容」
    named = sum(1 for c in chunks if c.section_title)
    assert named / len(chunks) > 0.95


def test_reference_digit_ratio_threshold_is_conservative():
    """阈值应偏保守：宁可漏过滤，也不要误删表格。"""
    assert MAX_REFERENCE_DIGIT_RATIO <= 0.15
