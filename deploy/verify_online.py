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
    # 前端页面挂在站点根路径，而 base 是 API 前缀（…/api/v1）。
    # 前端检查必须去掉 /api/v1 后再请求，否则会查到 404。
    site = base[:-len("/api/v1")] if base.endswith("/api/v1") else base
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
            # 上传 v1 时，若库里已有同篇更高版本（v7），后端会判为 older_version
            # 并复用库内那条记录 —— 此时详情里的文件名是 v7，属于正常行为。
            # 因此判据改成「同一 arXiv 编号」，而不是死比文件名。
            import re as _re

            def _arxiv_key(name: str) -> str:
                m = _re.search(r"(\d{4}\.\d{4,5})", name or "")
                return m.group(1) if m else (name or "")

            got_name = detail.get("file_name", "")
            c.check("文件名与上传文件属于同一篇论文",
                    _arxiv_key(got_name) == _arxiv_key(pdf.name),
                    "上传 %s / 库内 %s" % (pdf.name, got_name))

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

        # ---------------- 7. 索引状态 ----------------
        c.section("7. 索引状态（分块与向量）")
        r = client.get("/search/index")
        c.check("索引状态 HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        status = r.json() if r.status_code == 200 else {}
        print("       " + json.dumps(status, ensure_ascii=False))
        c.check("已建立分块索引", status.get("chunks", 0) > 0,
                "chunks=%s" % status.get("chunks"))

        # 若还未向量化则补做一次。
        # 说明：每次执行本脚本都会重新解析，而解析会重建分块；
        # 块文本未变时向量会被复用，但首次运行仍需生成。
        if status.get("embedding_available") and status.get("embedded", 0) == 0:
            print("       发现尚未向量化，自动补做…")
            t0 = time.perf_counter()
            r = client.post("/papers/%s/embed" % paper_id, json={})
            if r.status_code == 200:
                stats = r.json()
                print("       嵌入完成：%d/%d 成功，维度 %s，耗时 %.2f 秒"
                      % (stats["embedded"], stats["total"], stats["dim"],
                         time.perf_counter() - t0))
            r = client.get("/search/index")
            status = r.json() if r.status_code == 200 else {}

        if status.get("embedding_available"):
            c.check("已完成向量化", status.get("embedded", 0) > 0,
                    "embedded=%s" % status.get("embedded"))

        # ---------------- 8. 检索 ----------------
        c.section("8. 检索（跨语言：中文提问英文论文）")
        query = "什么是位置编码"
        r = client.post("/search", json={"query": query, "top_k": 3, "allow_vector": False})
        bm25_hits = r.json().get("hits", []) if r.status_code == 200 else []
        print("       纯 BM25 命中 %d 条" % len(bm25_hits))

        r = client.post("/search", json={"query": query, "top_k": 3})
        c.check("检索 HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
        if r.status_code == 200:
            data = r.json()
            c.check("混合检索有结果", len(data["hits"]) > 0,
                    "mode=%s 命中=%d" % (data["mode"], len(data["hits"])))
            if data["hits"]:
                top = data["hits"][0]
                c.check("首位命中带出处", bool(top["citation"]),
                        top["citation"])
                c.check("向量检索在纯 BM25 之上的补充",
                        len(bm25_hits) == 0 and len(data["hits"]) > 0,
                        "BM25 %d 条 -> 混合 %d 条" % (len(bm25_hits), len(data["hits"])))

        # ---------------- 9. 问答 ----------------
        c.section("9. RAG 问答")
        if status.get("embedding_available"):
            # 不传 top_k，使用服务端默认值（当前为 8）。
            # 原先写死 6：库扩到 8 篇、1709 块之后，6 条片段已不足以命中
            # 「编码器由哪些子层组成」所需的 3.1 节（实测 6 条拒答、8 条正确）。
            # 验证脚本应与真实用户请求一致——用默认值，而不是写死一个过时的数字。
            r = client.post("/qa", json={"question": "编码器和解码器由哪些子层组成"})
            c.check("问答 HTTP 200", r.status_code == 200, "实际 %s" % r.status_code)
            if r.status_code == 200:
                ans = r.json()
                c.check("有回答内容", bool(ans["answer"]), ans["answer"][:60])
                c.check("回答带引用", len(ans["citations"]) > 0,
                        "引用 %d 条" % len(ans["citations"]))
                c.check("无编造引用编号", not ans["invalid_marks"],
                        "非法编号=%s" % ans["invalid_marks"])
                print("       回答: " + ans["answer"][:160].replace("\n", " "))

            # 无关问题必须拒答，这是防幻觉的关键行为
            r = client.post("/qa", json={"question": "今天北京天气怎么样", "top_k": 6})
            if r.status_code == 200:
                ans = r.json()
                c.check("无关问题被拒答", ans["refused"] is True,
                        "refused=%s" % ans["refused"])

        # ---------------- 10. SSE 流式 ----------------
        c.section("10. SSE 流式输出")
        t0 = time.perf_counter()
        stamps: list[float] = []
        final = None
        try:
            with client.stream("POST", "/qa/stream",
                               json={"question": "为什么自注意力比循环层更快",
                                     "top_k": 5}) as resp:
                c.check("流式 HTTP 200", resp.status_code == 200,
                        "实际 %s" % resp.status_code)
                c.check("content-type 为 event-stream",
                        "text/event-stream" in resp.headers.get("content-type", ""),
                        resp.headers.get("content-type", ""))
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[len("data: "):])
                    if event["type"] == "token":
                        stamps.append(time.perf_counter() - t0)
                    elif event["type"] == "done":
                        final = event
            c.check("收到 done 事件", final is not None)
            if stamps:
                buckets = len({int(s * 10) for s in stamps})
                c.check("逐段推送（非一次性返回）", buckets >= 2,
                        "%d 个 token 分布在 %d 个时间段，首字 %.2fs"
                        % (len(stamps), buckets, stamps[0]))
                print("       首字 %.2fs，总耗时 %.2fs"
                      % (stamps[0], time.perf_counter() - t0))
        except httpx.HTTPError as exc:
            c.check("SSE 流式请求", False, str(exc)[:120])

        # ------------------------------------------------------------------
        # 11. 前端页面
        #
        # 这一段是补上来的：此前验证脚本只测 API，于是「线上只有接口、
        # 页面根本没部署出去」这件事一直没被发现——服务器上从来没有 nginx，
        # 80 端口空着，而所有人都以为网站是好的。
        # 结论：验证必须覆盖「用户实际打开的那个地址」。
        # ------------------------------------------------------------------
        c.section("11. 前端页面（用户实际打开的地址）")
        try:
            r = client.get(site + "/")
            ok = r.status_code == 200 and "<title>" in r.text
            c.check("根路径返回页面", ok, "HTTP %s" % r.status_code)
            # 主题初始化脚本是近期版本才有的标记，用它判断前端是否为最新构建
            has_theme_script = "app.theme" in r.text
            c.check("前端为最新版本（含主题初始化脚本）",
                    has_theme_script,
                    "已包含 app.theme" if has_theme_script
                    else "index.html 中未找到 app.theme，前端可能是旧版本")
            for asset in ("/styles/theme.css", "/scripts/core/app.js",
                          "/scripts/core/api.js"):
                a = client.get(site + asset)
                c.check("静态资源可访问 %s" % asset,
                        a.status_code == 200 and len(a.text) > 1000,
                        "HTTP %s, %d 字节" % (a.status_code, len(a.text)))
            app_js = client.get(site + "/scripts/core/app.js").text
            c.check("前端脚本为最新版本（含主题切换逻辑）",
                    "toggle-theme" in app_js)
        except httpx.HTTPError as exc:
            c.check("前端页面请求", False, str(exc)[:120])

        # ------------------------------------------------------------------
        # 12. arXiv 检索（论文发现）
        #
        # 单独检查的意义：服务器在国内，能否访问 arxiv.org 与本地环境未必一致。
        # 这一项挂了说明发现页在线上不可用，而不是代码问题。
        # 注意 arXiv 有速率限制（约 3 秒一次），这里只发一次请求。
        # ------------------------------------------------------------------
        c.section("12. arXiv 检索（论文发现）")
        try:
            r = client.get("/discover/search",
                           params={"q": "layer normalization", "max_results": 3})
            c.check("arXiv 检索 HTTP 200", r.status_code == 200,
                    "实际 %s" % r.status_code)
            if r.status_code == 200:
                data = r.json()
                c.check("检索到结果", (data.get("total") or 0) > 0,
                        "total=%s" % data.get("total"))
                c.check("结果字段完整",
                        bool(data["items"]) and all(
                            it.get("title") and it.get("arxiv_id")
                            for it in data["items"]
                        ),
                        "首条: %s" % (data["items"][0]["title"][:40]
                                     if data.get("items") else "无"))
                print("       实际查询: %s"
                      % data.get("effective_query", "")[:60])
        except httpx.HTTPError as exc:
            c.check("arXiv 检索请求", False, str(exc)[:120])

    return c.summary()


if __name__ == "__main__":
    sys.exit(main())
