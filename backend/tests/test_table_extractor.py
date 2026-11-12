"""表格抽取的测试：用 PyMuPDF 现画一张带框线的表，再抽回来。

为什么自己画：真实论文里的表格各色各样，测试要的是"提取链路是否通"，
所以构造最小可控样本（2×2 边框表），断言行列数与内容即可。
"""
from pathlib import Path

import pymupdf
import pytest

from app.services.table_extractor import extract_tables, tables_to_blocks


@pytest.fixture()
def pdf_with_table(tmp_path: Path) -> Path:
    path = tmp_path / "t.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    # 画 2×2 网格：外框 + 中间竖线 + 横线
    x0, y0, x1, y1 = 72, 72, 372, 172
    page.draw_rect(pymupdf.Rect(x0, y0, x1, y1))
    page.draw_line((x0, (y0 + y1) / 2), (x1, (y0 + y1) / 2))
    page.draw_line(((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1))
    page.insert_text((x0 + 10, y0 + 28), "Model", fontsize=12)
    page.insert_text(((x0 + x1) / 2 + 10, y0 + 28), "BLEU", fontsize=12)
    page.insert_text((x0 + 10, y0 + 78), "Transformer", fontsize=12)
    page.insert_text(((x0 + x1) / 2 + 10, y0 + 78), "28.4", fontsize=12)
    doc.save(path)
    doc.close()
    return path


def test_extract_table_rows(pdf_with_table: Path):
    tables = extract_tables(pdf_with_table)
    assert tables, "应至少识别出 1 张表"
    t = tables[0]
    assert t.page == 1
    assert t.row_count == 2 and t.col_count == 2
    flat = " ".join(cell for row in t.rows for cell in row)
    assert "Transformer" in flat and "28.4" in flat


def test_markdown_roundtrip(pdf_with_table: Path):
    md = extract_tables(pdf_with_table)[0].to_markdown()
    lines = md.splitlines()
    assert lines[0].startswith("|") and set(lines[1].replace("|", "").replace("-", "").strip()) == set()
    assert "Transformer" in md


def test_blocks_shape(pdf_with_table: Path):
    blocks = tables_to_blocks(extract_tables(pdf_with_table))
    b = blocks[0]
    assert b["type"] == "table"
    assert b["rows"] and b["row_count"] == 2
    assert "markdown" in b


def test_missing_file_returns_empty():
    assert extract_tables("no-such-file.pdf") == []


def test_no_table_returns_empty(tmp_path: Path):
    path = tmp_path / "plain.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "just text, no ruled table", fontsize=12)
    doc.save(path)
    doc.close()
    assert extract_tables(path) == []
