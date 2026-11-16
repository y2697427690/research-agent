"""评测结果接口（只读）。

数据来自 deploy/eval_gold.py 跑完落盘的 docs/eval/report.json ——
不在接口里实时跑评测：一次要打 30 题真实模型，2~3 分钟，
页面打开时等不起，也会白烧钱。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from app.core.exceptions import NotFound

router = APIRouter(prefix="/eval", tags=["评测"])

def _find_report() -> Path:
    """向上找仓库根下的 docs/eval/report.json。

    写死 parents[N] 太脆（多一层包就失效，实测 404 过一次），
    改成「从当前文件逐级往上，找带 docs/eval 目录的那一级」。
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / "docs" / "eval").is_dir():
            return parent / "docs" / "eval" / "report.json"
    return Path(__file__).resolve().parents[2] / "docs" / "eval" / "report.json"


_REPORT = _find_report()


@router.get("/summary", summary="最近一次 gold set 评测结果")
async def eval_summary() -> dict:
    """返回评测摘要与逐题结果；还没有跑过评测时给 404。"""
    if not _REPORT.exists():
        raise NotFound("还没有评测结果，请先运行 deploy/eval_gold.py")
    try:
        data = json.loads(_REPORT.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise NotFound("评测结果文件损坏，请重新运行 eval_gold.py") from exc
    return data
