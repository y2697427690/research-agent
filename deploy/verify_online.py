"""线上环境验证脚本。

用途：确认部署在服务器上的服务能完成完整业务链路——
健康检查 → 上传 PDF → 触发解析 → 查询结果。

这是「部署可用性」的可执行证据，也可在提交材料中引用其输出。

用法（在你自己的电脑上运行，需要本机装有 httpx）：

    python deploy/verify_online.py
    python deploy/verify_online.py --base-url http://47.96.97.141:8000/api/v1
    python deploy/verify_online.py --pdf "D:/Desktop/科研小助手/pdf/1706.03762v1.pdf"

退出码：0 全部通过，1 有失败项。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

try:
    import httpx
except ImportError:
    print("需要 httpx：python -m pip install httpx")
    sys.exit(2)


DEFAULT_BASE = "http://47.96.97.141:8000/api/v1"
DEFAULT_PDF = r"D:\Desktop\科研小助手\pdf\1706.03762v1.pdf"


class Checker:
    """记录检查结果并按序打印。"""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def section(self, title: str) -> None:
        print()
        print("=" * 74)
        print(title)
        print("=" * 74)

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        mark = "PASS" if ok else "FAIL"
        print("  [%s] %s%s" % (mark, label, ("  ->  " + detail) if detail else ""))
        if ok:
            self.passed += 1
        else:
            self.failed += 1

    def summary(self) -> int:
        print()
        print("=" * 74)
        print("结果: %d 通过 / %d 失败" % (self.passed, self.failed))
        print("=" * 74)
        return 0 if self.failed == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    pdf = Path(args.pdf)
    c = Checker()

    print("目标服务: %s" % base)
    print("测试文件: %s" % pdf)

    if not pdf.exists():
        print("\n找不到测试 PDF：%s" % pdf)
        print("用 --pdf 指定一个真实 PDF 的路径")
        return 2

    with httpx.Client(base_url=base, timeout=180.0) as client:
        # ---------------- 1. 健康检查 ----------------
        c.section("1. 健康检查")
        try:
            r = client.get("/health")
            c.check("HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
            body = r.json()
            c.check("服务状态 ok", body.get("status") == "ok",
                    "status=%s" % body.get("status"))
            db = body.get("db", {})
            c.check("数据库连通", db.get("ok") is True,
                    "url_scheme=%s" % db.get("url_scheme"))
            llm = body.get("llm", {})
            print("       大模型配置: configured=%s model=%s base_url=%s"
                  % (llm.get("configured"), llm.get("model"), llm.get("base_url")))
            if not llm.get("configured"):
                print("       提示：尚未配置 API Key，问答功能将在 P4 阶段需要它")
        except httpx.HTTPError as exc:
            c.check("健康检查请求", False, str(exc))
            return c.summary()

        # ---------------- 2. 上传 ----------------
        c.section("2. 上传 PDF")
        t0 = time.perf_counter()
        with pdf.open("rb") as fh:
            r = client.post("/papers/upload",
                            files={"files": (pdf.name, fh, "application/pdf")})
        upload_cost = time.perf_counter() - t0
        c.check("HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        if r.status_code != 200:
            print("       响应: %s" % r.text[:400])
            return c.summary()

        body = r.json()
        result = body["results"][0]
        print("       耗时 %.2f 秒，文件 %.2f MB"
              % (upload_cost, pdf.stat().st_size / 1024 / 1024))

        paper = result.get("paper")
        dup = result.get("duplicate")
        if paper:
            paper_id = paper["id"]
            print("       新入库: id=%s arxiv_id=%s sha1=%s"
                  % (paper_id, paper.get("arxiv_id"), paper.get("sha1")))
        elif dup:
            paper_id = dup.get("existing_paper_id")
            print("       已存在（判为 %s），复用 id=%s" % (dup.get("kind"), paper_id))
        else:
            print("       响应: %s" % json.dumps(result, ensure_ascii=False)[:300])
            c.check("取得论文 id", False)
            return c.summary()

        c.check("取得论文 id", bool(paper_id), str(paper_id))

        # ---------------- 3. 触发解析（同步等待）----------------
        c.section("3. 触发解析（wait=true，等待完成）")
        t0 = time.perf_counter()
        r = client.post("/papers/%s/parse?wait=true" % paper_id)
        parse_cost = time.perf_counter() - t0
        c.check("HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        if r.status_code != 200:
            print("       响应: %s" % r.text[:400])
            return c.summary()

        state = r.json()
        print("       耗时 %.2f 秒" % parse_cost)
        print("       " + json.dumps(state, ensure_ascii=False, indent=7).replace("\n", "\n       "))
        c.check("解析完成（非 parsing）", state.get("parse_status") != "parsing",
                "status=%s" % state.get("parse_status"))
        c.check("解析状态合理",
                state.get("parse_status") in ("done", "need_review"),
                "status=%s" % state.get("parse_status"))
        if state.get("parse_status") == "done":
            c.check("置信度达标（>=0.6）",
                    (state.get("quality") or 0) >= 0.6,
                    "quality=%s" % state.get("quality"))

        # ---------------- 4. 查询详情 ----------------
        c.section("4. 查询论文详情")
        r = client.get("/papers/%s" % paper_id)
        c.check("HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        if r.status_code == 200:
            detail = r.json()
            c.check("页数已写入", bool(detail.get("page_count")),
                    "page_count=%s" % detail.get("page_count"))
            c.check("标题已提取", bool(detail.get("title")),
                    "title=%s" % detail.get("title"))
            c.check("文件名正确", detail.get("file_name") == pdf.name,
                    detail.get("file_name", ""))

        # ---------------- 5. 列表与统计 ----------------
        c.section("5. 列表与统计")
        r = client.get("/papers?page=1&page_size=5")
        c.check("列表 HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        if r.status_code == 200:
            lst = r.json()
            c.check("总数 >= 1", lst.get("total", 0) >= 1, "total=%s" % lst.get("total"))

        r = client.get("/papers/stats")
        c.check("统计 HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        if r.status_code == 200:
            print("       " + json.dumps(r.json(), ensure_ascii=False))

        # ---------------- 6. 错误格式 ----------------
        c.section("6. 错误响应格式")
        r = client.get("/papers/p-not-exist-xxx")
        c.check("不存在的论文返回 404", r.status_code == 404, "实际 %s" % r.status_code)
        try:
            err = r.json()
            ok = "error" in err and err["error"].get("code") == "NOT_FOUND"
            c.check("错误信封格式正确", ok,
                    json.dumps(err, ensure_ascii=False)[:120])
        except Exception:
            c.check("错误信封格式正确", False, r.text[:120])

    return c.summary()


if __name__ == "__main__":
    sys.exit(main())
