"""扫描件 OCR（依赖系统里的 tesseract）。

为什么用 tesseract 而不是 PaddleOCR：
  PaddleOCR 要装 paddlepaddle（几百 MB，且对 Python 版本挑剔）；
  tesseract 是单个系统包（Ubuntu `apt install tesseract-ocr tesseract-ocr-eng`），
  推理接口由 PyMuPDF 内置（`get_textpage_ocr`）直接调用，装完即用。

为什么默认只 OCR 前 N 页：
  一本 300 页扫描书全页 OCR 要十几分钟，会把上传请求拖死。
  先认前 20 页并标记「OCR 识别 · 需校对」，用户能看到效果，也留了扩展点。
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

import pymupdf

MAX_OCR_PAGES = 20
OCR_DPI = 200
# 一页平均可提取字符少于这个数，就认为没有文本层（扫描件）
SCANNED_THRESHOLD = 40


@dataclass
class OcrPage:
    page: int
    text: str


def is_available() -> bool:
    """系统里是否装了 tesseract。"""
    return shutil.which("tesseract") is not None


def needs_ocr(path: str | Path) -> bool:
    """判断是否该走 OCR：整篇平均每页几乎取不到文字。"""
    try:
        doc = pymupdf.open(str(path))
    except Exception:
        return False
    try:
        if doc.page_count == 0:
            return False
        sample = min(doc.page_count, 5)
        chars = 0
        for i in range(sample):
            chars += len(doc[i].get_text().strip())
        return (chars / sample) < SCANNED_THRESHOLD
    finally:
        doc.close()


def ocr_pdf(path: str | Path, max_pages: int = MAX_OCR_PAGES) -> list[OcrPage]:
    """逐页 OCR。

    不可用或失败时返回空列表 —— 调用方据此保持"需校对"状态，
    绝不假装解析成功（这是整个项目的一条底线）。
    """
    if not is_available():
        return []
    try:
        doc = pymupdf.open(str(path))
    except Exception:
        return []

    out: list[OcrPage] = []
    try:
        for i in range(min(doc.page_count, max_pages)):
            page = doc[i]
            try:
                tp = page.get_textpage_ocr(flags=0, language="eng", dpi=OCR_DPI, full=True)
                text = page.get_text(textpage=tp).strip()
            except Exception:
                continue
            if text:
                out.append(OcrPage(page=i + 1, text=text))
    finally:
        doc.close()
    return out


def to_chunks_text(pages: list[OcrPage]) -> list[tuple[int, str]]:
    """把 OCR 结果整理成 (页码, 文本) 列表，供分块入库。"""
    return [(p.page, p.text) for p in pages if p.text.strip()]
