"""提交前预检：一条命令核对所有材料。"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
DESK_CANDIDATES = [Path("D:/Desktop"), Path.home() / "Desktop"]
OK, BAD = "  [OK]  ", "  [FAIL]"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((ok, label))
    print((OK if ok else BAD) + label + (f"  ({detail})" if detail else ""))


def main() -> int:
    print("=" * 60)
    # 1) 文档
    pdf = ROOT / "docs" / "submission" / "作品介绍文档.pdf"
    check(pdf.exists(), "作品介绍 PDF 存在", f"{pdf.stat().st_size // 1024} KB" if pdf.exists() else "")
    tech = ROOT / "docs" / "tech-report" / "技术文档.pdf"
    check(tech.exists(), "技术文档 PDF 存在")
    if tech.exists():
        try:
            import pymupdf
            n = pymupdf.open(tech).page_count
            check(n <= 30, f"技术文档页数 {n}（上限 30）")
        except Exception as exc:
            check(False, "技术文档页数检查失败", str(exc))

    # 2) 源码包
    zips = []
    for desk in DESK_CANDIDATES:
        zips += list(desk.glob("科研小助手Agent_源码_*.zip"))
    zips = sorted(zips)
    check(bool(zips), "源码 zip 在桌面", zips[-1].name if zips else "未找到")

    # 3) 线上服务
    try:
        with httpx.Client(base_url="http://47.96.97.141:8000", timeout=30) as c:
            check(c.get("/api/v1/health").status_code == 200, "线上服务健康")
            paths = c.get("/openapi.json").json()["paths"]
            check(len(paths) >= 30, f"线上接口数 {len(paths)}")
    except Exception as exc:
        check(False, "线上服务不可达", str(exc)[:60])

    # 4) 仓库状态
    try:
        out = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                             capture_output=True, text=True, timeout=30).stdout.strip()
        check(not out, "工作区干净（无未提交改动）", out.splitlines()[0] if out else "")
    except Exception as exc:
        check(False, "git 状态检查失败", str(exc)[:60])

    print("=" * 60)
    bad = sum(1 for ok, _ in results if not ok)
    print(f"  结果：{len(results) - bad} 通过 / {bad} 失败")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
