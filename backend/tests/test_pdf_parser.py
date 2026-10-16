"""PDF 解析器的测试。

分两类：
1. 合成用例 —— 用 pymupdf 现场生成 PDF，覆盖边界情形，不依赖外部文件，任何环境都能跑
2. 真实 PDF 回归 —— 若本机存在比赛官方测试文件，则校验关键指标不退化
"""
import os

import pymupdf
import pytest

from app.services.pdf_parser import (
    is_vertical,
    normalize_title,
    parse_pdf,
    score_quality,
)

PDF_DIR = r"D:\Desktop\科研小助手\pdf"
STANDARD = os.path.join(PDF_DIR, "1706.03762v1.pdf")
SCANNED = os.path.join(PDF_DIR, "1706.03762v1_img.pdf")
BOOK = os.path.join(PDF_DIR, "UnderstandingDeepLearning_02_09_26_C.pdf")


# ---------------------------------------------------------------- 纯函数


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("3.2.1 Scaled Dot-Product Attention", "scaled dot-product attention"),
        ("1 Introduction", "introduction"),
        ("  A.1   Appendix   ", "appendix"),
        ("References", "references"),
        # 连字应被还原：LaTeX 生成的 PDF 里 ﬁ 很常见
        ("Conﬁguration", "configuration"),
        ("eﬀicacy", "efficacy"),
    ],
)
def test_normalize_title(raw, expected):
    assert normalize_title(raw) == expected


@pytest.mark.parametrize(
    ("bbox", "expected"),
    [
        ((11, 216, 38, 560), True),      # arXiv 侧边竖排水印：宽 27 高 344
        ((211, 100, 400, 117), False),   # 正常横排标题：宽 189 高 17
        ((100, 100, 300, 110), False),
    ],
)
def test_is_vertical(bbox, expected):
    assert is_vertical(bbox) is expected


def test_score_quality_full_marks():
    q, warnings = score_quality(char_per_page=2000, has_toc=True,
                                section_count=20, reference_count=40)
    assert q == 1.0
    assert warnings == []


def test_score_quality_scanned_is_zero():
    q, warnings = score_quality(char_per_page=0, has_toc=False,
                                section_count=0, reference_count=0)
    assert q == 0.0
    assert any("扫描件" in w for w in warnings)
    assert any("书签" in w for w in warnings)


# ---------------------------------------------------------------- 合成 PDF


def _make_pdf(path, pages_lines, toc=None):
    """用 pymupdf 生成测试 PDF。pages_lines: [[(text, x, y, size), ...], ...]"""
    doc = pymupdf.open()
    for lines in pages_lines:
        page = doc.new_page(width=612, height=792)
        for text, x, y, size in lines:
            page.insert_text((x, y), text, fontsize=size, fontname="helv")
    if toc:
        doc.set_toc(toc)
    doc.save(path)
    doc.close()


def test_parse_simple_synthetic_pdf(tmp_path):
    """两页、带书签的最小 PDF。"""
    path = tmp_path / "simple.pdf"
    _make_pdf(
        path,
        [
            [("My Paper Title", 200, 100, 18),
             ("Abstract", 280, 200, 11),
             ("This is the abstract text.", 110, 220, 10),
             ("1 Introduction", 108, 400, 12),
             ("Body of the introduction.", 108, 420, 10)],
            [("2 Method", 108, 100, 12),
             ("More body text here.", 108, 120, 10)],
        ],
        toc=[[1, "1 Introduction", 1], [1, "2 Method", 2]],
    )

    d = parse_pdf(path)
    assert d.page_count == 2
    assert d.is_scanned is False
    assert d.title == "My Paper Title"
    assert [s.title for s in d.sections] == ["1 Introduction", "2 Method"]
    assert all(s.source == "toc" for s in d.sections)
    assert d.abstract is not None
    assert "abstract text" in d.abstract
    assert d.references == []
    # 这份合成 PDF 每页仅约 30 个字符（真实论文 800+），
    # 置信度应偏低并判为需校对 —— 这正是评分机制的设计意图
    assert d.quality < 0.6
    assert d.needs_review is True


def test_quality_scales_with_text_volume(tmp_path):
    """置信度必须随正文文本量上升：验证评分不是常量。"""
    sparse = tmp_path / "sparse.pdf"
    _make_pdf(sparse, [[("1 Section", 108, 100, 12), ("short", 108, 120, 10)]])
    dense = tmp_path / "dense.pdf"
    _make_pdf(
        dense,
        [[("1 Section", 108, 100, 12)] + [
                        (f"Filler sentence number {i} with a bit more text to raise density.",
             108, 120 + i * 12, 10) for i in range(30)
        ]],
    )
    q_sparse = parse_pdf(sparse).quality
    q_dense = parse_pdf(dense).quality
    assert q_dense > q_sparse


def test_parse_empty_pdf_marks_review(tmp_path):
    """空白页 PDF：应判为无文本层并标记需校对，而不是抛异常，也不得编造内容。"""
    path = tmp_path / "blank.pdf"
    doc = pymupdf.open()
    doc.new_page()
    doc.save(path)
    doc.close()

    d = parse_pdf(path)
    assert d.page_count == 1
    assert d.is_scanned is True
    assert d.needs_review is True
    assert d.quality < 0.6
    assert d.references == []
    assert d.abstract is None


def test_parse_pdf_without_toc_falls_back_to_heuristic(tmp_path):
    """无书签时应回退到字号 + 编号推断，source 标为 heuristic。"""
    path = tmp_path / "notoc.pdf"
    _make_pdf(
        path,
        [[("Title Here", 250, 90, 17),
          ("1 First Section", 108, 300, 13),
          ("Some ordinary body text of the paper.", 108, 320, 10),
          ("2 Second Section", 108, 500, 13),
          ("More ordinary body text follows.", 108, 520, 10)]],
    )
    d = parse_pdf(path)
    assert d.toc == []
    assert len(d.sections) >= 2
    assert any(s.source == "heuristic" for s in d.sections)


def test_extract_references_numbered(tmp_path):
    """按 [n] 编号的参考文献应逐条切分。"""
    path = tmp_path / "refs.pdf"
    _make_pdf(
        path,
        [[("References", 108, 100, 12),
          ("[1] First author. A paper title. 2019.", 108, 130, 10),
          ("[2] Second author. Another paper. 2020.", 108, 150, 10),
          ("[3] Third author. Third paper. 2021.", 108, 170, 10)]],
    )
    d = parse_pdf(path)
    assert len(d.references) == 3
    assert d.references[0].startswith("[1]")
    assert "Third paper" in d.references[2]


def test_extract_abstract_stops_at_heading(tmp_path):
    """摘要遇到章节标题必须停止（实测论文摘要与标题只差 31pt）。"""
    path = tmp_path / "abs.pdf"
    _make_pdf(
        path,
        [[("Abstract", 280, 100, 12),
          ("Abstract line one.", 110, 130, 10),
          ("Abstract line two.", 110, 145, 10),
          ("1 Introduction", 108, 180, 12),
          ("This is the introduction body, not the abstract.", 108, 200, 10)]],
    )
    d = parse_pdf(path)
    assert d.abstract is not None
    assert "introduction body" not in d.abstract


# ---------------------------------------------------------------- 真实 PDF 回归


@pytest.mark.skipif(not os.path.exists(STANDARD), reason="缺少官方测试 PDF")
def test_regression_standard_paper():
    """标准论文的关键指标（数值为实测基线，用于防止退化）。"""
    d = parse_pdf(STANDARD)
    assert d.page_count == 15
    assert d.is_scanned is False
    assert d.title == "Attention Is All You Need"      # 不得取到 arXiv 竖排水印
    assert len(d.sections) == 22                        # 与 TOC 条目数一致
    assert {s.level for s in d.sections} == {1, 2, 3}    # 三级层级都要有
    assert all(s.source == "toc" for s in d.sections)
    assert len(d.references) >= 30
    assert d.abstract is not None and len(d.abstract) > 800
    assert d.quality >= 0.9
    assert d.needs_review is False
    # 该论文是单栏，栏目判定不得误报双栏
    assert all(p.columns == 1 for p in d.pages)


@pytest.mark.skipif(not os.path.exists(SCANNED), reason="缺少官方扫描件 PDF")
def test_regression_scanned_pdf():
    """扫描件：必须如实标记为空，绝不能编造内容。"""
    d = parse_pdf(SCANNED)
    assert d.page_count == 15
    assert d.is_scanned is True
    assert d.title is None
    assert d.sections == []
    assert d.references == []
    assert d.abstract is None
    assert d.quality == 0.0
    assert d.needs_review is True
    assert any("扫描件" in w for w in d.warnings)


@pytest.mark.skipif(not os.path.exists(BOOK), reason="缺少长篇书籍 PDF")
def test_regression_long_book():
    """541 页书籍：章节规模与双栏识别。"""
    d = parse_pdf(BOOK)
    assert d.page_count == 541
    assert d.is_scanned is False
    assert d.title == "Understanding Deep Learning"
    assert len(d.sections) >= 150
    assert d.quality >= 0.8
    # 该书籍含双栏页面（索引部分），应能识别出来
    assert any(p.columns == 2 for p in d.pages)
