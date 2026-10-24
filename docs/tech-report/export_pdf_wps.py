"""用 WPS 把 docx 导出为 PDF（COM 调用，无需手动点菜单）。

为什么走 COM
------------------------------------------------------------------------
本机有 WPS 12，它兼容 Word 的自动化接口（KWPS.Application）。
用 COM 打开文档、更新域（目录、页码才会生成）、再导出 PDF，
整个流程可由脚本一次完成，避免"打开 → 点菜单 → 选路径"的重复劳动。

注意
------------------------------------------------------------------------
- 域必须显式更新（Fields.Update），否则目录只有占位文字。
- 导出用 ExportAsFixedFormat，格式号 17 即 wdFormatPDF。
- 用完必须 Quit 并释放 COM 对象，否则 WPS 进程会留在后台。
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOCX = HERE / "技术文档.docx"
PDF = HERE / "技术文档.pdf"


def main() -> int:
    if not DOCX.exists():
        print("  找不到 技术文档.docx，先运行 build_docx.py", file=sys.stderr)
        return 1

    try:
        import win32com.client as win32  # type: ignore
    except ImportError:
        print("  缺少 pywin32，请执行：python -m pip install pywin32", file=sys.stderr)
        return 2

    app = None
    doc = None
    try:
        # 依次尝试 WPS 与 Word 的 ProgID，哪个能用用哪个
        for progid in ("KWPS.Application", "Word.Application"):
            try:
                app = win32.Dispatch(progid)
                print(f"  使用 {progid}")
                break
            except Exception:  # noqa: BLE001
                app = None
        if app is None:
            print("  未找到可用的 WPS/Word COM 接口", file=sys.stderr)
            return 3

        app.Visible = False
        doc = app.Documents.Open(str(DOCX), ReadOnly=False)

        # 更新所有域：目录、页码、共几页
        try:
            doc.Fields.Update()
            for section in doc.Sections:
                section.Footers(1).Range.Fields.Update()
                for toc in section.TablesOfContents:
                    toc.Update()
        except Exception as exc:  # noqa: BLE001
            print(f"  ⚠️ 更新域失败（目录可能不显示页码）：{exc}")

        if PDF.exists():
            PDF.unlink()
        doc.ExportAsFixedFormat(str(PDF), 17)   # 17 = wdFormatPDF
        print(f"  PDF : {PDF.name}（{PDF.stat().st_size / 1024:.0f} KB）")
    finally:
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:  # noqa: BLE001
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:  # noqa: BLE001
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
