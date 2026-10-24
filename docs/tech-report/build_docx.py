"""技术文档 DOCX 构建：Markdown 章节 → Word 文档 →（可选）用 WPS 导出 PDF。

为什么还要 docx
------------------------------------------------------------------------
PDF 定稿前必然要反复改字、调表格。若只有 PDF/HTML，改一个字都要回到
Markdown 重新构建；而 docx 可以直接用 WPS 打开修改，同事/老师也能批注。
所以这里产出两份：
    · 技术文档.docx —— 可编辑的主文件（本脚本生成）
    · 技术文档.pdf  —— 由 WPS 自动导出（COM 调用，无需手动点菜单）

样式约定（与 build.py 的 HTML 版保持一致）
------------------------------------------------------------------------
    A4 / 页边距 20mm-17mm / 正文 10.5pt 微软雅黑 / 行高 1.6
    章标题 17pt（另起一页）、节 13pt、小节 11.5pt
    表格用 Table Grid + 表头浅蓝底
    代码块 Consolas 8.5pt + 浅灰底 + 左侧蓝边
    图片居中、图注 9pt 灰色
    页脚居中「第 X 页 / 共 Y 页」
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from build import META, md_to_html, read_chapters  # noqa: E402

CHAPTERS: list[tuple[str, str]] = read_chapters()

# 两遍排版：第一遍没有页码，make_report.py 从 PDF 里量出页码后写进这个文件，
# 第二遍构建时按它生成带真实页码的目录。
TOC_PAGES_FILE = HERE / 'toc_pages.json'
TOC_PAGES: dict[str, str] = {}
if TOC_PAGES_FILE.exists():
    try:
        TOC_PAGES = json.loads(TOC_PAGES_FILE.read_text(encoding='utf-8'))
    except Exception:
        TOC_PAGES = {}

CJK_FONT = "微软雅黑"
MONO_FONT = "Consolas"
BLUE = RGBColor(0x2F, 0x6F, 0xED)
DARK = RGBColor(0x1B, 0x22, 0x30)
GREY = RGBColor(0x5B, 0x64, 0x72)


# ---------------------------------------------------------------- 样式工具

def set_cjk(run_or_style, font: str = CJK_FONT) -> None:
    """同时设置西文与中文字体。

    python-docx 只设 font.name 时，中文仍走主题字体（宋体），
    必须单独写 w:eastAsia，否则整篇字体会不一致。
    """
    target = run_or_style.font
    target.name = font
    rpr = run_or_style.element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.append(fonts)
    fonts.set(qn("w:eastAsia"), font)
    fonts.set(qn("w:ascii"), font)
    fonts.set(qn("w:hAnsi"), font)


def shade(cell_or_par, color: str) -> None:
    """给单元格或段落加底色（Word 没有现成 API，只能写 XML）。"""
    el = cell_or_par._tc if hasattr(cell_or_par, "_tc") else cell_or_par._p
    pr = el.get_or_add_tcPr() if hasattr(el, "get_or_add_tcPr") else el.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color)
    pr.append(shd)


def add_field(paragraph, code: str, placeholder: str = "") -> None:
    """插入 Word 域（目录、页码都用它）。

    WPS/Word 打开时会按域代码自动生成内容；需要显式「更新域」才会刷新。
    """
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = code
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(sep)
    if placeholder:
        run._r.append(OxmlElement("w:t"))
        run._r[-1].text = placeholder
    run._r.append(end)


# ---------------------------------------------------------------- 骨架

def build_document() -> Document:
    doc = Document()

    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.6)
    section.left_margin = Cm(1.55)
    section.right_margin = Cm(1.55)

    normal = doc.styles["Normal"]
    normal.font.size = Pt(10.2)
    normal.font.color.rgb = DARK
    set_cjk(normal)
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_after = Pt(6)

    for name, size in (("Heading 1", 17), ("Heading 2", 13), ("Heading 3", 11.5)):
        st = doc.styles[name]
        st.font.size = Pt(size)
        st.font.bold = True
        st.font.color.rgb = BLUE if size >= 13 else RGBColor(0x24, 0x56, 0xC9)
        set_cjk(st)
        st.paragraph_format.space_before = Pt(14 if size < 17 else 0)
        st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.keep_with_next = True

    # 页脚：第 X 页 / 共 Y 页
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run("第 ")
    run.font.size = Pt(8.5)
    run.font.color.rgb = GREY
    add_field(footer, "PAGE")
    run = footer.add_run(" 页 / 共 ")
    run.font.size = Pt(8.5)
    run.font.color.rgb = GREY
    add_field(footer, "NUMPAGES")
    run = footer.add_run(" 页")
    run.font.size = Pt(8.5)
    run.font.color.rgb = GREY
    return doc


def add_cover(doc: Document) -> None:
    for _ in range(4):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("2026 科研小助手 Agent 大赛")
    r.font.size = Pt(10)
    r.font.color.rgb = BLUE
    set_cjk(r)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("———")
    r.font.size = Pt(12)
    r.font.color.rgb = BLUE

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(META["title"])
    r.font.size = Pt(26)
    r.font.bold = True
    r.font.color.rgb = DARK
    set_cjk(r)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(META["subtitle"])
    r.font.size = Pt(11.5)
    r.font.color.rgb = GREY
    set_cjk(r)

    for _ in range(6):
        doc.add_paragraph()

    for label, value in (
        ("参赛形式", META["form"]),
        ("作者", META["author"]),
        ("单位", META["org"]),
        ("日期", META["date"]),
        ("在线演示", META["demo"]),
    ):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(f"{label}：{value}")
        r.font.size = Pt(10.5)
        r.font.color.rgb = GREY
        set_cjk(r)

    # 封面不显示页码：用 Word 的「首页页眉页脚不同」，
    # 比分节更省事，也不会影响后面正文的连续页码。
    doc.sections[0].different_first_page_header_footer = True


def add_toc(doc: Document, toc_pages: dict[str, str]) -> None:
    """生成静态目录（标题 + 点线 + 真实页码）。

    为什么不用 Word 的 TOC 域：
    域需要「打开文档后更新」才会出现内容，而我们要直接由脚本导出 PDF，
    中间没人去按 F9，导出的就是占位文字。改成静态目录后，
    页码由 make_report.py 的两遍排版算出来（先排一次得到页码，再填回去）。
    """
    from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER

    doc.add_heading("目 录", level=1)

    # 只列章级标题：全文 30 页上限，二级标题会让目录占掉近两页；
    # 且 30 页规模的文档，按章跳转已足够，节级定位靠页眉与正文编号。
    for title, _body in CHAPTERS:
        _toc_line(doc, title, toc_pages.get(title, "—"), level=1,
                  align=WD_TAB_ALIGNMENT.RIGHT, leader=WD_TAB_LEADER.DOTS)

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def _toc_line(doc, text: str, page: str, *, level: int, align, leader) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.4
    p.paragraph_format.tab_stops.add_tab_stop(Cm(16.6), align, leader)
    if level == 2:
        p.paragraph_format.left_indent = Cm(0.8)
    r = p.add_run(text)
    r.font.size = Pt(10.5 if level == 1 else 9.8)
    r.font.bold = level == 1
    set_cjk(r)
    r2 = p.add_run("\t" + page)
    r2.font.size = Pt(9.8)
    set_cjk(r2)


# ---------------------------------------------------------------- 正文

# 列宽预设：按表头内容匹配（单位 cm，正文可用宽度约 17.6cm）
# 不设列宽时 Word 平均分配，四列的表会出现「模块」列空一大片、
# 「实现方式」被挤成窄条的情况，所以关键表都显式给宽度。
WIDTH_PRESETS: dict[tuple[str, ...], list[float]] = {
    ("模块", "条目", "已实现", "部分", "未实现", "一句话结论"): [2.6, 1.2, 1.6, 1.2, 1.6, 9.4],
    ("需求条目", "状态", "实现方式 / 未实现原因"): [4.6, 1.5, 11.5],
    ("模块", "需求条目", "状态", "实现方式 / 未实现原因"): [2.0, 4.4, 1.4, 9.6],
    ("未实现条目", "原因", "影响", "后续路径"): [3.2, 5.6, 2.6, 6.0],
    ("增项", "价值", "对应评分维度"): [6.4, 6.4, 4.6],
    ("用例", "结果"): [7.0, 10.4],
    ("状态", "条目数", "占比"): [6.0, 5.0, 5.0],
    ("原则", "具体做法"): [4.4, 13.2],
}

STATUS_COLORS = {
    "已实现": RGBColor(0x1E, 0x8E, 0x3E),
    "部分": RGBColor(0xC0, 0x7A, 0x00),
    "未实现": RGBColor(0x8A, 0x8A, 0x8A),
}


def _tight(paragraph) -> None:
    """收紧单元格内段落的行距与段后距。

    表格单元格默认继承正文样式（行距 1.6、段后 6pt），
    一行文字会被撑成两行的高度——34 行的表格因此多出两页。
    单元格里应该紧凑：行距 1.15、段后 0。
    """
    paragraph.paragraph_format.line_spacing = 1.15
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.space_before = Pt(0)


def add_table(doc: Document, header: list[str], rows: list[list[str]]) -> None:
    table = doc.add_table(rows=1, cols=len(header))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    widths = WIDTH_PRESETS.get(tuple(header))
    if widths and len(widths) == len(header):
        # Word 需要逐单元格设宽，只设 table.columns 在部分渲染器里不生效
        for i, width in enumerate(widths):
            for cell in table.columns[i].cells:
                cell.width = Cm(width)

    hdr = table.rows[0].cells
    for i, text in enumerate(header):
        hdr[i].text = ""
        _tight(hdr[i].paragraphs[0])
        r = hdr[i].paragraphs[0].add_run(text)
        r.font.size = Pt(8.8)
        r.font.bold = True
        set_cjk(r)
        shade(hdr[i], "EEF3FB")
        if widths and len(widths) == len(header):
            hdr[i].width = Cm(widths[i])

    for row in rows:
        cells = table.add_row().cells
        for i, text in enumerate(row[: len(header)]):
            cells[i].text = ""
            _tight(cells[i].paragraphs[0])
            r = cells[i].paragraphs[0].add_run(text)
            r.font.size = Pt(8.8)
            set_cjk(r)
            # 状态列着色：一眼看出哪些是已实现、哪些是缺口
            if text in STATUS_COLORS:
                r.font.color.rgb = STATUS_COLORS[text]
                r.font.bold = True
            if widths and len(widths) == len(header):
                cells[i].width = Cm(widths[i])
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_code(doc: Document, code: str) -> None:
    for line in code.splitlines() or [""]:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.15
        p.paragraph_format.left_indent = Cm(0.3)
        r = p.add_run(line if line else " ")
        r.font.size = Pt(8.5)
        r.font.name = MONO_FONT
        shade(p, "F7F8FA")


def add_image(doc: Document, path: Path, caption: str) -> None:
    if not path.exists():
        p = doc.add_paragraph()
        r = p.add_run(f"［缺图：{path.name}］")
        r.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = cap.add_run(caption)
        r.font.size = Pt(9)
        r.font.color.rgb = GREY
        return
    # 示意图（fig-*.png）用满宽 16.4cm 保证细节可读；
    # 界面截图（shot-*.png）用 14.2cm：屏幕截图细节多，但每张约多占 0.3 页，
    # 30 页上限下要留余量。
    width = Cm(14.2) if path.name.startswith("shot-") else Cm(16.4)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=width)
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = cap.add_run(caption)
    r.font.size = Pt(9)
    r.font.color.rgb = GREY
    set_cjk(r)


def render_chapters(doc: Document, chapters) -> None:
    """把 build.py 产出的 HTML 片段逐块还原成 Word 结构。

    复用同一套 Markdown 解析（md_to_html），再用正则把块切开，
    避免让 Markdown 解析器写两遍——两套解析器必然会跑偏。
    """
    import html as _html
    import re as _re

    def _txt(fragment: str) -> str:
        """去标签并还原 HTML 实体。

        踩过的坑：Markdown 里的英文引号会被 md_to_html 转成 &quot;，
        若只去标签不还原实体，正文会原样显示「&quot;资料中没有&quot;」。
        标题、段落、列表、表格统一走这个函数。
        """
        return _html.unescape(_re.sub(r"<[^>]+>", "", fragment)).strip()

    for idx, (_title, body) in enumerate(chapters):
        if idx > 0:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

        blocks = _re.findall(
            r"(<h[1-4]>.*?</h[1-4]>|<table>.*?</table>|<pre[^>]*>.*?</pre>"
            r"|<figure>.*?</figure>|<ul>.*?</ul>|<ol>.*?</ol>"
            r"|<blockquote>.*?</blockquote>|<p>.*?</p>)",
            body,
            _re.S,
        )
        for raw in blocks:
            text = _txt(raw)

            if raw.startswith("<h1"):
                doc.add_heading(text, level=1)
            elif raw.startswith("<h2"):
                doc.add_heading(text, level=2)
            elif raw.startswith("<h3"):
                doc.add_heading(text, level=3)
            elif raw.startswith("<h4"):
                doc.add_heading(text, level=4)
            elif raw.startswith("<table>"):
                head = [_txt(c) for c in _re.findall(r"<th>(.*?)</th>", raw, _re.S)]
                rows = []
                for tr in _re.findall(r"<tr>(.*?)</tr>", raw, _re.S):
                    cells = [_txt(c) for c in _re.findall(r"<td>(.*?)</td>", tr, _re.S)]
                    if cells:
                        rows.append(cells)
                add_table(doc, head, rows)
            elif raw.startswith("<pre"):
                code = _re.search(r"<code>(.*?)</code>", raw, _re.S)
                add_code(doc, _html.unescape(code.group(1)) if code else text)
            elif raw.startswith("<figure>"):
                src = _re.search(r'src="([^"]+)"', raw)
                cap = _re.search(r"<figcaption>(.*?)</figcaption>", raw, _re.S)
                add_image(doc, HERE / (src.group(1) if src else ""),
                          _html.unescape(cap.group(1)).strip() if cap else "")
            elif raw.startswith(("<ul>", "<ol>")):
                ordered = raw.startswith("<ol>")
                for idx_item, item in enumerate(
                    _re.findall(r"<li>(.*?)</li>", raw, _re.S), start=1
                ):
                    t = _txt(item)
                    if ordered:
                        # 不用 List Number 样式：Word 的编号列表共享同一套
                        # 编号计数器，全文会连续累加（5.4.1 里出现 10.、11.）。
                        # 直接写序号最稳，且换渲染器也不会变。
                        p = doc.add_paragraph()
                        p.paragraph_format.left_indent = Cm(0.75)
                        p.paragraph_format.first_line_indent = Cm(-0.75)
                        p.paragraph_format.space_after = Pt(2)
                        p.add_run(f"{idx_item}.  ")
                    else:
                        p = doc.add_paragraph(style="List Bullet")
                        p.paragraph_format.space_after = Pt(2)
                    r = p.add_run(t)
                    r.font.size = Pt(10.5)
                    set_cjk(r)
            elif raw.startswith("<blockquote>"):
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Cm(0.5)
                r = p.add_run(text)
                r.font.size = Pt(10)
                r.font.italic = True
                r.font.color.rgb = RGBColor(0x3A, 0x44, 0x60)
                set_cjk(r)
            elif raw.startswith("<p>"):
                p = doc.add_paragraph()
                r = p.add_run(text)
                r.font.size = Pt(10.5)
                set_cjk(r)


def main() -> int:
    chapters = CHAPTERS
    if not chapters:
        print("  没有章节文件", file=sys.stderr)
        return 1

    doc = build_document()
    add_cover(doc)
    add_toc(doc, TOC_PAGES)
    render_chapters(doc, chapters)

    out = HERE / "技术文档.docx"
    try:
        doc.save(out)
    except PermissionError:
        # 常见原因：用户正在 WPS 里打开这份文档。不要因此中断构建——
        # 另存一份继续走 PDF 流程，并明确告诉调用方实际产物路径。
        out = HERE / "技术文档-新.docx"
        doc.save(out)
        print(f"  ⚠️ 技术文档.docx 正被占用（WPS 打开中），已另存为 {out.name}")
    print(f"  DOCX: {out.name}（{len(chapters)} 章，{out.stat().st_size / 1024:.0f} KB）")
    print(f"  DOCX_PATH={out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
