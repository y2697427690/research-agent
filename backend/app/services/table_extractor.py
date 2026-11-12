"""表格结构抽取（PyMuPDF find_tables）。

为什么独立成模块、不塞进 parse_pdf：
  表格有绘制线才能被识别，学术论文里相当一部分表格是"无边框三线表"，
  识别率天然有限。把它做成**可单独调用、可单独关闭**的能力，
  解析主流程不会被它拖慢或污染；识别失败就是"没抽到"，而不是解析失败。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

# 单篇最多抽多少张：书籍类 PDF 有上百张表，全抽会让接口变慢
MAX_TABLES = 40


@dataclass
class TableData:
    page: int              # 1 起
    rows: list[list[str]] = field(default_factory=list)
    bbox: tuple[float, float, float, float] | None = None

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def col_count(self) -> int:
        return max((len(r) for r in self.rows), default=0)

    def to_markdown(self) -> str:
        """转成 Markdown 管道表，供导出与前端渲染复用。"""
        if not self.rows:
            return ""
        width = self.col_count
        norm = [(r + [""] * width)[:width] for r in self.rows]
        head = "| " + " | ".join(norm[0]) + " |"
        sep = "| " + " | ".join(["---"] * width) + " |"
        body = ["| " + " | ".join(r) + " |" for r in norm[1:]]
        return "\n".join([head, sep, *body])


def extract_tables(
    path: str | Path,
    max_tables: int = MAX_TABLES,
    min_rows: int = 2,
    min_cols: int = 2,
) -> list[TableData]:
    """抽取 PDF 中的表格。

    min_rows / min_cols 用来过滤"识别出来的假表"：
    一列或一行的框通常是被误判的文本框，留下只会干扰阅读。
    """
    out: list[TableData] = []
    try:
        doc = pymupdf.open(str(path))
    except Exception:
        return out

    try:
        for page_no in range(doc.page_count):
            if len(out) >= max_tables:
                break
            try:
                finder = doc[page_no].find_tables()
            except Exception:
                continue

            for table in finder.tables:
                try:
                    rows = table.extract() or []
                except Exception:
                    continue
                cleaned = [
                    [(cell or "").replace("\n", " ").strip() for cell in row]
                    for row in rows
                ]
                cleaned = [r for r in cleaned if any(c for c in r)]
                if len(cleaned) < min_rows:
                    continue
                if max((len(r) for r in cleaned), default=0) < min_cols:
                    continue
                out.append(
                    TableData(page=page_no + 1, rows=cleaned, bbox=getattr(table, "bbox", None))
                )
                if len(out) >= max_tables:
                    break
    finally:
        doc.close()
    return out


def tables_to_blocks(tables: list[TableData]) -> list[dict]:
    """转成前端能直接渲染的结构（block: table）。"""
    return [
        {
            "type": "table",
            "page": t.page,
            "rows": t.rows,
            "row_count": t.row_count,
            "col_count": t.col_count,
            "markdown": t.to_markdown(),
        }
        for t in tables
    ]
