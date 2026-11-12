"""图片抽取测试：先造一张位图，再把它嵌进 PDF，抽回来验证。"""
from pathlib import Path

import pymupdf
import pytest

from app.services.figure_extractor import extract_figures


def _make_png() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=200)
    page.draw_rect(pymupdf.Rect(10, 10, 190, 190), color=(1, 0, 0), fill=(1, 0, 0))
    pix = page.get_pixmap(dpi=100)
    data = pix.tobytes("png")
    doc.close()
    return data


@pytest.fixture()
def pdf_with_image(tmp_path: Path) -> Path:
    path = tmp_path / "img.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(72, 72, 372, 372), stream=_make_png())
    doc.save(path)
    doc.close()
    return path


def test_extract_figure(pdf_with_image: Path):
    figs = extract_figures(pdf_with_image)
    assert figs, "应至少抽到 1 张图"
    f = figs[0]
    assert f.page == 1
    assert f.width >= 80 and f.height >= 80
    assert f.data_url.startswith("data:image/")


def test_no_image_returns_empty(tmp_path: Path):
    path = tmp_path / "plain.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "no images here", fontsize=12)
    doc.save(path)
    doc.close()
    assert extract_figures(path) == []


def test_missing_file_returns_empty():
    assert extract_figures("no-such.pdf") == []
