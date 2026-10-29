"""技术文档构建脚本：Markdown 章节 → HTML → PDF（Edge 无头打印）。

为什么用这条路
------------------------------------------------------------------------
本机没有 Word、没有 LibreOffice、没有 pandoc，但有 Edge。
Edge 的 `--headless --print-to-pdf` 可以把 HTML 精确排版成 PDF：
字体、页边距、分页、表格边框全部可控，中文字体（微软雅黑）也没问题。
内容用 Markdown 写，便于版本管理与逐章审阅；构建时再统一转成 HTML/PDF。

用法（在仓库根目录）
------------------------------------------------------------------------
    python docs/tech-report/build.py            # 生成 PDF
    python docs/tech-report/build.py --html     # 只生成 HTML（调试排版用）

章节文件按文件名排序拼接：ch01-*.md、ch02-*.md … appA-*.md。
图片放在 docs/tech-report/img/，Markdown 里写 ![图 1-1](img/xxx.png)。
"""
from __future__ import annotations

import argparse
import html
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT_PDF = HERE / "技术文档.pdf"
OUT_HTML = HERE / "技术文档.html"

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# ---------------------------------------------------------------- Markdown

def _inline(text: str) -> str:
    """行内元素：先转义，再处理代码与粗体，避免把 HTML 当标签。"""
    # 行内代码先占位，避免其中的 * _ 被解析
    codes: list[str] = []

    def stash(m: re.Match) -> str:
        codes.append(f"<code>{html.escape(m.group(1))}</code>")
        return f"\x00{len(codes) - 1}\x00"

    text = re.sub(r"`([^`]+)`", stash, text)
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    # 链接
    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>',
        text,
    )
    for i, code in enumerate(codes):
        text = text.replace(f"\x00{i}\x00", code)
    return text


def md_to_html(md: str) -> str:
    """把 Markdown 子集转成 HTML。

    只支持写文档真正需要的语法：标题、段落、有序/无序列表、表格、
    代码块、图片、引用块、分隔线。刻意不引第三方库——
    少一个依赖，排版行为也完全可控。
    """
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # 代码块
        if line.startswith("```"):
            lang = line[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            cls = f' class="lang-{lang}"' if lang else ""
            out.append(f"<pre{cls}><code>{html.escape(chr(10).join(buf))}</code></pre>")
            continue

        # 标题
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            out.append(f"<h{level}>{_inline(m.group(2))}</h{level}>")
            i += 1
            continue

        # 分隔线
        if re.match(r"^---+$", line.strip()):
            out.append("<hr/>")
            i += 1
            continue

        # 表格：至少两行，第二行是 |---|---|
        if line.strip().startswith("|") and i + 1 < len(lines) and re.match(
            r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]
        ):
            header = [c.strip() for c in line.strip().strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            out.append("<table><thead><tr>")
            out.extend(f"<th>{_inline(c)}</th>" for c in header)
            out.append("</tr></thead><tbody>")
            for row in rows:
                out.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in row) + "</tr>")
            out.append("</tbody></table>")
            continue

        # 图片单独成段
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$", line.strip())
        if m:
            out.append(
                f'<figure><img src="{m.group(2)}" alt="{html.escape(m.group(1))}"/>'
                f"<figcaption>{html.escape(m.group(1))}</figcaption></figure>"
            )
            i += 1
            continue

        # 引用块
        if line.strip().startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append(f"<blockquote>{_inline(' '.join(buf))}</blockquote>")
            continue

        # 列表
        if re.match(r"^\s*(?:[-*]|\d+\.)\s+", line):
            ordered = bool(re.match(r"^\s*\d+\.\s+", line))
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines) and re.match(r"^\s*(?:[-*]|\d+\.)\s+", lines[i]):
                items.append(re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", lines[i]))
                i += 1
            out.append(f"<{tag}>" + "".join(f"<li>{_inline(x)}</li>" for x in items) + f"</{tag}>")
            continue

        # 空行
        if not line.strip():
            i += 1
            continue

        # 段落：连续非空行合并
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|```|\||>|\s*(?:[-*]|\d+\.)\s|!\[|---)", lines[i]
        ):
            buf.append(lines[i].strip())
            i += 1
        if buf:
            out.append(f"<p>{_inline(' '.join(buf))}</p>")
        else:
            i += 1

    return "\n".join(out)


# ---------------------------------------------------------------- 拼装

CJK_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif'

CSS = f"""
@page {{ size: A4; margin: 20mm 17mm 18mm 17mm; }}
* {{ box-sizing: border-box; }}
body {{
  font-family: {CJK_STACK};
  font-size: 10.5pt; line-height: 1.75; color: #1b2230; margin: 0;
}}
h1 {{ font-size: 17pt; margin: 0 0 10pt; padding-bottom: 6pt;
      border-bottom: 2pt solid #2f6fed; page-break-before: always; }}
h1:first-of-type {{ page-break-before: avoid; }}
h2 {{ font-size: 13pt; margin: 16pt 0 6pt; color: #1f3f8f; page-break-after: avoid; }}
h3 {{ font-size: 11.5pt; margin: 12pt 0 4pt; color: #2456c9; page-break-after: avoid; }}
h4 {{ font-size: 10.5pt; margin: 10pt 0 3pt; page-break-after: avoid; }}
p {{ margin: 0 0 7pt; text-align: justify; }}
ul, ol {{ margin: 0 0 8pt; padding-left: 18pt; }}
li {{ margin: 0 0 3pt; }}
table {{ border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; }}
th, td {{ border: 0.6pt solid #b9c2d0; padding: 4pt 6pt; vertical-align: top; }}
th {{ background: #eef3fb; text-align: left; font-weight: 600; }}
tr {{ page-break-inside: avoid; }}
code {{ font-family: Consolas, "Cascadia Mono", monospace; font-size: 9pt;
        background: #f2f4f7; padding: 0.5pt 3pt; border-radius: 2pt; }}
pre {{ background: #f7f8fa; border: 0.6pt solid #dde3ec; border-left: 2.5pt solid #2f6fed;
       padding: 7pt 9pt; margin: 6pt 0 9pt; overflow: hidden; page-break-inside: avoid; }}
pre code {{ background: none; padding: 0; font-size: 8.6pt; line-height: 1.55; }}
blockquote {{ margin: 6pt 0 9pt; padding: 6pt 9pt; background: #f6f8fc;
              border-left: 2.5pt solid #8aa6e8; color: #3a4460; }}
figure {{ margin: 8pt 0 10pt; text-align: center; page-break-inside: avoid; }}
img {{ max-width: 100%; border: 0.6pt solid #dde3ec; }}
figcaption {{ font-size: 9pt; color: #5b6472; margin-top: 3pt; }}
a {{ color: #2f6fed; text-decoration: none; }}
hr {{ border: none; border-top: 0.6pt solid #dde3ec; margin: 10pt 0; }}

/* 封面 */
.cover {{ page-break-after: always; padding-top: 55mm; text-align: center; }}
.cover .kicker {{ font-size: 10pt; letter-spacing: 3pt; color: #2f6fed; margin-bottom: 8mm; }}
.cover h1 {{ font-size: 24pt; border: none; page-break-before: avoid; margin: 0 0 6mm;
            line-height: 1.35; }}
.cover .sub {{ font-size: 12pt; color: #4a5468; margin-bottom: 30mm; }}
.cover .meta {{ font-size: 10.5pt; color: #4a5468; line-height: 2; }}
.cover .rule {{ width: 40mm; height: 2pt; background: #2f6fed; margin: 0 auto 8mm; }}

/* 目录 */
.toc {{ page-break-after: always; }}
.toc h1 {{ page-break-before: avoid; }}
.toc ol {{ list-style: none; padding-left: 0; font-size: 10.5pt; }}
.toc li {{ margin: 4pt 0; }}
.toc .lv2 {{ padding-left: 14pt; color: #4a5468; font-size: 9.8pt; }}
"""


def read_chapters() -> list[tuple[str, str]]:
    files = sorted(p for p in HERE.glob("*.md") if p.name != "README.md")
    chapters = []
    for f in files:
        # utf-8-sig：兼容带 BOM 的文件。踩过的坑——用 PowerShell 的
        # Out-File -Encoding utf8 写回 Markdown 会加 BOM，导致首行
        # "# 第 5 章 …" 匹配不上标题正则，标题退化成正文并带出 # 号。
        text = f.read_text(encoding="utf-8-sig")
        title = ""
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        chapters.append((title or f.stem, md_to_html(text)))
    return chapters


def build_toc(chapters: list[tuple[str, str]]) -> str:
    items = []
    for idx, (title, body) in enumerate(chapters, start=1):
        items.append(f'<li><span class="idx">{idx}</span> {html.escape(title)}</li>')
        for m in re.finditer(r"<h2>(.*?)</h2>", body):
            sub = re.sub(r"<[^>]+>", "", m.group(1))
            items.append(f'<li class="lv2">{html.escape(sub)}</li>')
    return f'<div class="toc"><h1>目 录</h1><ol>{"".join(items)}</ol></div>'


def build_html(meta: dict[str, str], chapters, with_toc: bool) -> str:
    cover = f"""
<div class="cover">
  <div class="kicker">2026 科研小助手 Agent 大赛</div>
  <div class="rule"></div>
  <h1>{html.escape(meta['title'])}</h1>
  <div class="sub">{html.escape(meta['subtitle'])}</div>
  <div class="meta">
    参赛形式：{html.escape(meta['form'])}<br/>
    作者：{html.escape(meta['author'])}<br/>
    单位：{html.escape(meta['org'])}<br/>
    日期：{html.escape(meta['date'])}<br/>
    在线演示：{html.escape(meta['demo'])}
  </div>
</div>"""
    body = "\n".join(b for _, b in chapters)
    toc = build_toc(chapters) if with_toc else ""
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>{html.escape(meta['title'])}</title>
<style>{CSS}</style></head>
<body>{cover}{toc}{body}</body></html>"""


META = {
    "title": "科研小助手 Agent",
    "subtitle": "面向科研文献的解析、问答与引用分析系统 · 技术文档",
    "form": "个人参赛",
    "author": "叶硕迪",
    "org": "南京传媒学院 · 计算机科学与技术 · 2024 级",
    # 预提交（10-31）用 10 月；最终提交（11-18）改这里为 11 月即可，
    # 文档标题页与页脚都读这个值
    "date": "2026 年 10 月",
    "demo": "http://47.96.97.141:8000/",
}


def find_edge() -> str:
    for p in EDGE_CANDIDATES:
        if Path(p).exists():
            return p
    raise SystemExit("未找到 Edge，无法导出 PDF")


def render_pdf(html_path: Path, pdf_path: Path) -> None:
    edge = find_edge()
    if pdf_path.exists():
        pdf_path.unlink()
    cmd = [
        edge,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}",
        html_path.as_uri(),
    ]
    subprocess.run(cmd, check=False, capture_output=True, timeout=180)


def add_page_numbers(pdf_path: Path) -> int:
    """给 PDF 每页底部加「3 / 29」，并返回总页数。

    为什么用后处理而不是 CSS：Chrome/Edge 的打印不支持 @page 的页脚计数器，
    而在 PDF 层写页码最可靠。只写 ASCII，避免中文字体嵌入问题。
    """
    import pymupdf

    doc = pymupdf.open(pdf_path)
    total = doc.page_count
    for idx, page in enumerate(doc, start=1):
        if idx == 1:          # 封面不写页码
            continue
        rect = page.rect
        page.insert_text(
            (rect.width / 2 - 12, rect.height - 22),
            f"{idx} / {total}",
            fontsize=8.5,
            fontname="helv",
            color=(0.42, 0.46, 0.52),
        )
    doc.saveIncr()
    doc.close()
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", action="store_true", help="只生成 HTML，不打印 PDF")
    args = ap.parse_args()

    chapters = read_chapters()
    if not chapters:
        print("  没有找到章节文件（ch01-*.md 等）", file=sys.stderr)
        return 1

    html_text = build_html(META, chapters, with_toc=True)
    OUT_HTML.write_text(html_text, encoding="utf-8")
    print(f"  HTML: {OUT_HTML.name}（{len(html_text) / 1024:.0f} KB，{len(chapters)} 章）")
    if args.html:
        return 0

    render_pdf(OUT_HTML, OUT_PDF)
    if not OUT_PDF.exists():
        print("  PDF 生成失败", file=sys.stderr)
        return 1
    total = add_page_numbers(OUT_PDF)
    size_kb = OUT_PDF.stat().st_size / 1024
    print(f"  PDF : {OUT_PDF.name}（{total} 页，{size_kb:.0f} KB）")
    if total > 30:
        print(f"  ⚠️ 超过官方上限 30 页（当前 {total} 页）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
