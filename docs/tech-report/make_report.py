"""技术文档一键构建：Markdown → DOCX → PDF（含真实页码目录）。

两遍排版
------------------------------------------------------------------------
第一遍：目录页码全填「—」，生成 docx 并转 PDF，然后从 PDF 里量出
        每个标题实际落在第几页（按字号区分正文标题与目录条目）。
第二遍：把量到的页码写回目录，重新生成 docx 与 PDF。
        因为目录行数没变（只是字符从「—」变成数字），分页保持稳定；
        脚本最后会再量一次，若页码变化就再迭代一次（最多三次）。

用法
------------------------------------------------------------------------
    python docs/tech-report/make_report.py             # 完整构建
    python docs/tech-report/make_report.py --preview   # 只用 Edge 出 HTML/PDF 预览
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
VENV_PY = REPO / "backend" / ".venv" / "Scripts" / "python.exe"

NODE = Path(r"D:\dpHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe")
LO_CLI = Path(
    r"D:\dpHarness\resources\app.asar.unpacked\dsh\node_modules"
    r"\@deepseek-ai\libreoffice-kit\lib\cli.js"
)

DOCX = HERE / "技术文档.docx"
PDF = HERE / "技术文档.pdf"
TOC_FILE = HERE / "toc_pages.json"

# 标题字号：章 17pt、节 13pt。目录条目是 10.5/9.8pt，
# 用字号区分可以避免把目录页自身当成正文页。
MIN_SIZE_CH1 = 15.0
MIN_SIZE_CH2 = 12.0


def run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if proc.returncode != 0:
        print(proc.stdout[-800:])
        print(proc.stderr[-800:], file=sys.stderr)
        raise SystemExit(f"命令失败: {' '.join(cmd[:2])}")
    return proc.stdout or ""


# 实际参与转换的 docx 路径：build_docx.py 会在目标文件被占用时另存，
# 并通过 stdout 打印 DOCX_PATH=...，这里跟着它走，避免转换到旧文件。
CURRENT_DOCX: Path = DOCX


def build_docx() -> None:
    global CURRENT_DOCX
    out = run([str(VENV_PY), str(HERE / "build_docx.py")])
    for line in out.splitlines():
        if line.strip().startswith("DOCX_PATH="):
            CURRENT_DOCX = Path(line.strip().split("=", 1)[1])
    for line in out.splitlines():
        if "DOCX" in line or "占用" in line:
            print(f"  {line.strip()}")


def convert_pdf() -> int:
    if PDF.exists():
        PDF.unlink()
    run([str(NODE), str(LO_CLI), "convert", "--input", str(CURRENT_DOCX), "--output", str(PDF)])
    import pymupdf

    doc = pymupdf.open(PDF)
    pages = doc.page_count
    doc.close()
    return pages


def measure_pages() -> dict[str, str]:
    """从 PDF 大纲里取每个标题的页码。

    踩过两个坑，最终走大纲这条路：
      1) 按 span 匹配：LibreOffice 导出的 PDF 会把一行汉字拆成多个 span，
         而且顺序是乱的（「第 1 章 项目概述」被拆成「第」「1」「章」「目概述」「项」）；
      2) 按整页纯文本匹配：同样受上面这个问题影响，拼起来对不上。
    而 docx 里的 Heading 样式会被 LibreOffice 导出成 PDF 书签（大纲），
    书签自带准确页码，直接读它最可靠。
    """
    import pymupdf

    doc = pymupdf.open(PDF)
    outline = doc.get_toc(simple=True)   # [(level, title, page), ...]
    doc.close()

    found: dict[str, str] = {}
    for _level, title, page in outline:
        key = title.strip()
        if not key or key == "目 录":
            continue
        found.setdefault(key, str(page))
    return found

def collect_headings() -> list[tuple[str, int]]:
    """按文档顺序列出所有章/节标题，用于与 PDF 中的文字匹配。"""
    import re

    chapters: list[tuple[str, str]] = json.loads((HERE / ".chapters.json").read_text(encoding="utf-8"))
    out: list[tuple[str, int]] = []
    for title, body in chapters:
        out.append((title, 1))
        for m in re.finditer(r"<h2>(.*?)</h2>", body):
            out.append((re.sub(r"<[^>]+>", "", m.group(1)).strip(), 2))
    return out


def write_chapters_cache() -> None:
    """把解析后的章节缓存成 JSON，供页码匹配使用（避免重复实现 Markdown 解析）。"""
    from build import read_chapters

    (HERE / ".chapters.json").write_text(
        json.dumps(read_chapters(), ensure_ascii=False), encoding="utf-8"
    )


def main() -> int:
    preview_only = "--preview" in sys.argv
    write_chapters_cache()

    if preview_only:
        run([str(VENV_PY), str(HERE / "build.py")])
        return 0

    headings = collect_headings()

    # 第一遍：没有页码
    if TOC_FILE.exists():
        TOC_FILE.unlink()
    build_docx()
    total = convert_pdf()
    print(f"  第一遍：{total} 页")

    for attempt in range(3):
        measured = measure_pages()
        mapping = {h: measured.get(h, "—") for h, _ in headings}
        missing = [h for h, p in mapping.items() if p == "—"]
        if missing:
            print(f"  ⚠️ 有 {len(missing)} 个标题没量到页码：{missing[:3]}")

        current = json.loads(TOC_FILE.read_text(encoding="utf-8")) if TOC_FILE.exists() else {}
        if current == mapping and attempt > 0:
            print(f"  页码稳定（第 {attempt + 1} 轮）")
            break

        TOC_FILE.write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
        build_docx()
        total = convert_pdf()
        print(f"  第 {attempt + 2} 遍：{total} 页")

    print()
    print(f"  ✅ DOCX: {DOCX.name}（{DOCX.stat().st_size / 1024:.0f} KB）")
    print(f"  ✅ PDF : {PDF.name}（{total} 页，{PDF.stat().st_size / 1024:.0f} KB）")
    if total > 30:
        print(f"  ⚠️ 超过官方上限 30 页（当前 {total} 页）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
