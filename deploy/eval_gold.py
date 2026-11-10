"""Gold set 评测：Recall@K、引用准确率、拒答准确率。

为什么单独一个脚本、而不是塞进 pytest：
  评测要打真实模型与真实检索，跑一次 2~3 分钟、要花钱；
  它属于「实验数据」而不是「回归测试」——回归测试必须离线、秒级、可重复。

指标定义（写进报告的“指标说明”一节）：
  Recall@K    ：期望关键词是否出现在检索前 K 段里（衡量“检索得着”）
  引用准确率  ：回答给出的引用片段里，有多少条真的含期望关键词（衡量“引对了”）
  拒答准确率  ：库内没有的问题，是否明确拒答而不是编造（衡量“不瞎说”）

用法：
  python deploy/eval_gold.py                      # 打线上
  python deploy/eval_gold.py --base http://127.0.0.1:8000
  python deploy/eval_gold.py --selftest           # 不联网，验证统计逻辑
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
GOLD = ROOT / "docs" / "eval" / "gold.json"
REPORT = ROOT / "docs" / "eval" / "report.md"

REFUSAL_HINTS = ("未找到", "没有找到", "资料中未", "无法回答", "未提及", "没有相关",
                 "不足以", "无法确定", "未包含")


def any_keyword(text: str, keywords: list[str]) -> bool:
    low = (text or "").lower()
    return any(k.lower() in low for k in keywords)


def looks_refused(answer: str, citation_count: int) -> bool:
    """拒答判定：既没有引用，又出现了“找不到”类措辞。"""
    if citation_count > 0:
        return False
    return any(h in (answer or "") for h in REFUSAL_HINTS)


def evaluate(items: dict, base: str, top_k: int, timeout: float) -> dict:
    rows = []
    with httpx.Client(base_url=base, timeout=timeout) as c:
        # ---- 可答题：Recall@K + 引用准确率 ----
        for q in items["answerable"]:
            t0 = time.perf_counter()
            search = c.post("/api/v1/search", json={"query": q["question"], "top_k": top_k}).json()
            hits = search.get("hits") or search.get("results") or []
            hit_texts = [h.get("text", "") for h in hits]
            recall = any(any_keyword(t, q["keywords"]) for t in hit_texts)

            qa = c.post("/api/v1/qa", json={"question": q["question"], "top_k": top_k}).json()
            cites = qa.get("citations") or []
            good = [x for x in cites if any_keyword(x.get("text", ""), q["keywords"])]
            cite_prec = (len(good) / len(cites)) if cites else 0.0
            answered = bool(cites) and any_keyword(qa.get("answer", ""), q["keywords"])

            rows.append({
                "id": q["id"], "kind": "answerable", "answerable": True,
                "recall": recall, "cite_precision": round(cite_prec, 3),
                "answered": answered, "citations": len(cites),
                "cost": round(time.perf_counter() - t0, 2),
                "question": q["question"],
            })
            print(f"  {q['id']} recall={'✓' if recall else '✗'} "
                  f"cite_prec={cite_prec:.0%} cited={len(cites)} "
                  f"{rows[-1]['cost']}s | {q['question'][:34]}")

        # ---- 不可答题：拒答准确率 ----
        for q in items["unanswerable"]:
            qa = c.post("/api/v1/qa", json={"question": q["question"], "top_k": top_k}).json()
            cites = qa.get("citations") or []
            refused = looks_refused(qa.get("answer", ""), len(cites))
            rows.append({
                "id": q["id"], "kind": "unanswerable", "answerable": False,
                "refused": refused, "citations": len(cites),
                "question": q["question"],
            })
            print(f"  {q['id']} refused={'✓' if refused else '✗'} cited={len(cites)} "
                  f"| {q['question'][:34]}")

    ans = [r for r in rows if r["answerable"]]
    una = [r for r in rows if not r["answerable"]]
    return {
        "rows": rows,
        "recall": sum(r["recall"] for r in ans) / max(1, len(ans)),
        "cite_precision": statistics.mean([r["cite_precision"] for r in ans]) if ans else 0.0,
        "answered_rate": sum(r["answered"] for r in ans) / max(1, len(ans)),
        "refusal_rate": sum(r["refused"] for r in una) / max(1, len(una)),
        "n_ans": len(ans), "n_una": len(una),
        "avg_cost": statistics.mean([r["cost"] for r in ans]) if ans else 0.0,
    }


def write_report(result: dict, base: str, top_k: int) -> None:
    rows = result["rows"]
    lines = [
        "# Gold set 评测报告",
        "",
        f"- 目标服务：`{base}`",
        f"- 检索段数 K：{top_k}",
        f"- 题目：可答 {result['n_ans']} 题 / 不可答 {result['n_una']} 题",
        "",
        "## 指标",
        "",
        "| 指标 | 值 | 说明 |",
        "| --- | --- | --- |",
        f"| Recall@{top_k} | **{result['recall']:.1%}** | 期望事实是否出现在检索前 {top_k} 段 |",
        f"| 引用准确率 | **{result['cite_precision']:.1%}** | 引用片段中含期望事实的比例 |",
        f"| 可答率 | {result['answered_rate']:.1%} | 回答正文命中期望关键词且至少一条引用 |",
        f"| 拒答准确率 | **{result['refusal_rate']:.1%}** | 库内没有的问题是否明确拒答 |",
        f"| 平均问答耗时 | {result['avg_cost']:.1f} s | 单题端到端（检索 + 生成） |",
        "",
        "## 逐题结果",
        "",
        "| ID | 类型 | Recall | 引用准确率 | 引用数 | 题目 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        if r["answerable"]:
            lines.append(
                f"| {r['id']} | 可答 | {'✓' if r['recall'] else '✗'} | "
                f"{r['cite_precision']:.0%} | {r['citations']} | {r['question'][:38]} |"
            )
        else:
            lines.append(
                f"| {r['id']} | 不可答 | — | — | {r['citations']} | "
                f"{'✓ 已拒答' if r['refused'] else '✗ 未拒答'} |"
            )
    lines.append("")
    lines.append("> 本报告由 `deploy/eval_gold.py` 自动生成；题目见 `docs/eval/gold.json`。")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def selftest() -> int:
    """不联网，验证统计与判定逻辑本身没写错。"""
    items = json.loads(GOLD.read_text(encoding="utf-8"))
    assert len(items["answerable"]) == 25 and len(items["unanswerable"]) == 5
    assert any_keyword("this is 41.0 BLEU", ["41.0"])
    assert not any_keyword("nothing here", ["41.0"])
    assert looks_refused("资料中未找到相关片段", 0) is True
    assert looks_refused("资料中未找到", 2) is False
    print("  ✅ gold.json 结构正确（25 可答 + 5 不可答），判定函数自测通过")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://47.96.97.141:8000")
    ap.add_argument("--top-k", type=int, default=16)
    ap.add_argument("--timeout", type=float, default=180)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    items = json.loads(GOLD.read_text(encoding="utf-8"))
    print(f"  评测目标 {args.base}，K={args.top_k}，共 "
          f"{len(items['answerable'])}+{len(items['unanswerable'])} 题\n")
    result = evaluate(items, args.base, args.top_k, args.timeout)
    write_report(result, args.base, args.top_k)

    print("\n  ===== 汇总 =====")
    print(f"  Recall@{args.top_k}   : {result['recall']:.1%}")
    print(f"  引用准确率         : {result['cite_precision']:.1%}")
    print(f"  可答率             : {result['answered_rate']:.1%}")
    print(f"  拒答准确率         : {result['refusal_rate']:.1%}")
    print(f"  平均耗时           : {result['avg_cost']:.1f} s")
    print(f"\n  报告已写入 {REPORT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
