"""图片 / 图表抽取。

为什么返回 data URL 而不是存文件：
  存文件要额外做静态目录与清理策略，而论文插图通常几十张、每张几百 KB，
  一次请求直接内联返回最简单，也不会在磁盘上留垃圾。
  超过单张上限的图直接跳过（多半是整页扫描底图，不是插图）。
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

import pymupdf

MAX_FIGURES = 30
MIN_SIDE = 80          # 太小的是公式符号/装饰线，不是图
MAX_BYTES = 900_000    # 单张超过 ~900KB 多半是整页底图


@dataclass
class FigureData:
    page: int
    width: int
    height: int
    ext: str
    data_url: str

    @property
    def size(self) -> str:
        return f"{self.width}×{self.height}"


def extract_figures(path: str | Path, max_figures: int = MAX_FIGURES) -> list[FigureData]:
    """抽取 PDF 中内嵌的位图。

    只取位图（jpg/png 等），矢量图（很多论文的框架图是矢量）抽不出来 ——
    这类图需要按版面裁剪渲染，属未实现范围。
    """
    out: list[FigureData] = []
    try:
        doc = pymupdf.open(str(path))
    except Exception:
        return out

    try:
        for page_no in range(doc.page_count):
            if len(out) >= max_figures:
                break
            page = doc[page_no]
            try:
                images = page.get_images(full=True)
            except Exception:
                continue
            for info in images:
                xref = info[0]
                try:
                    raw = doc.extract_image(xref)
                except Exception:
                    continue
                if not raw or not raw.get("image"):
                    continue
                data, ext = raw["image"], (raw.get("ext") or "png").lower()
                if len(data) > MAX_BYTES:
                    continue
                w, h = int(raw.get("width") or 0), int(raw.get("height") or 0)
                if w < MIN_SIDE or h < MIN_SIDE:
                    continue
                if w * h > 40_000_000:      # 超大位图（扫描整页）跳过
                    continue
                mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
                out.append(
                    FigureData(
                        page=page_no + 1,
                        width=w,
                        height=h,
                        ext=ext,
                        data_url=f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}",
                    )
                )
                if len(out) >= max_figures:
                    break
    finally:
        doc.close()
    return out
