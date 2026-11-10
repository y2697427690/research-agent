"""Agent 主循环：让模型自己决定调哪个工具、调几次。

一轮 = 模型输出一段 JSON。两种形态：
  {"thought": "...", "action": "search_library", "args": {...}}   继续干活
  {"thought": "...", "final": "最终回答"}                          收工

为什么不用 while True + provider 的 function calling：
  1. 换模型（deepseek / 本地 / 别家）不用重写适配层；
  2. 每一步的 thought 都能存下来给界面展示，评审能看到"为什么调这个工具"。

护栏：
  · max_steps 上限（默认 4）：防止模型无限调工具烧钱；
  · 同一个工具 + 完全相同的参数只允许调一次：模型常会原地打转；
  · JSON 解析失败会提醒一次格式，仍失败就带着已有观察直接收尾。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import registry
from app.core.logging import get_logger
from app.services import llm

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一个科研助手 Agent，可以调用工具来回答问题。

可用工具（JSON Schema）：
{tools}

每一轮你必须**只输出一个 JSON 对象**，不要输出其它文字：
· 需要调工具时：{{"thought": "为什么调这个工具", "action": "工具名", "args": {{...}}}}
· 信息足够时：{{"thought": "为什么可以回答了", "final": "给用户的中文回答，引用论文时用《标题》"}}

规则：
1. 不要编造库内没有的内容；资料不足就直接说明"资料中未找到"，不要硬答。
2. 不要重复调用同一个工具且参数完全相同。
3. 最多 {max_steps} 步；到上限还没结论，就用已有信息尽力回答并说明局限。
4. 回答用中文，简洁，不要罗列工具调用过程。
"""


@dataclass
class Step:
    index: int
    thought: str = ""
    tool: str = ""
    args: dict[str, Any] = field(default_factory=dict)
    ok: bool = False
    observation: str = ""
    dedup: bool = False   # 被"同参重复"拦下的调用，不计入工具调用次数


def _extract_json(text: str) -> dict | None:
    """从模型输出里抠出第一个 JSON 对象。

    模型经常加代码围栏或前后废话，所以用「找第一个 { 到最后一个 }」再解析，
    失败返回 None（由调用方决定是否提示重试）。
    """
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    snippet = text[start : end + 1]
    try:
        data = json.loads(snippet)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def run(
    db: AsyncSession,
    question: str,
    max_steps: int = 4,
) -> dict:
    """执行一次 Agent 任务，返回 steps / answer / used_tools。"""
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(
            tools=registry.schema_for_prompt(), max_steps=max_steps
        )},
        {"role": "user", "content": question},
    ]
    steps: list[Step] = []
    seen: set[tuple[str, str]] = set()   # (tool, 归一化参数) 去重，防原地打转
    answer = ""

    for i in range(max_steps):
        raw = await llm.chat(messages, temperature=0.1)
        data = _extract_json(raw or "")

        if data is None:
            # 格式不对：提醒一次，让它重新输出 JSON
            messages.append({"role": "assistant", "content": (raw or "")[:500]})
            messages.append({
                "role": "user",
                "content": "上一条不是合法 JSON。请只输出一个 JSON 对象，字段为 thought + action/args 或 thought + final。",
            })
            steps.append(Step(index=i + 1, thought="（模型输出格式错误）", ok=False,
                              observation="格式错误，已提示重试"))
            continue

        if "final" in data:
            answer = str(data.get("final") or "").strip()
            steps.append(Step(index=i + 1, thought=str(data.get("thought") or ""),
                              tool="final", ok=True, observation=answer[:200]))
            break

        name = str(data.get("action") or "").strip()
        args = data.get("args") or {}
        if not isinstance(args, dict):
            args = {}

        key = (name, json.dumps(args, ensure_ascii=False, sort_keys=True))
        if key in seen:
            steps.append(Step(index=i + 1, thought=str(data.get("thought") or ""),
                              tool=name, args=args, ok=False, dedup=True,
                              observation="重复调用（同参数），已跳过"))
            messages.append({"role": "assistant", "content": json.dumps(data, ensure_ascii=False)})
            messages.append({"role": "user", "content": "这个调用与之前完全相同，请改用其它工具或直接给出 final。"})
            continue
        seen.add(key)

        ok, obs = await registry.call(db, name, args)
        steps.append(Step(index=i + 1, thought=str(data.get("thought") or ""),
                          tool=name, args=args, ok=ok, observation=obs))

        messages.append({"role": "assistant", "content": json.dumps(data, ensure_ascii=False)})
        messages.append({
            "role": "user",
            "content": f"工具 {name} 的观测结果（{'成功' if ok else '失败'}）：\n{obs}",
        })

    if not answer:
        # 走到上限（或格式一直不对）还没 final：再给模型一次「只收尾」的机会。
        # 直接拿观察拼一段兜底文本虽然也能用，但读起来像日志；
        # 让模型基于已有观察写一句人话，体验差别很大。
        messages.append({
            "role": "user",
            "content": "工具调用到此为止。请勿再调用工具，直接输出 "
                       '{"thought": "...", "final": "基于以上观察的中文回答，资料不足就说明不足"}',
        })
        try:
            raw = await llm.chat(messages, temperature=0.1)
            data = _extract_json(raw or "")
            if data and data.get("final"):
                answer = str(data["final"]).strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Agent 收尾调用失败：%s", exc)

    if not answer:
        tried = [s.tool for s in steps if s.tool and s.tool != "final"]
        answer = (
            "已达到最大工具调用步数，下面是目前掌握的信息：" +
            ("；".join(f"{s.tool}：{s.observation[:120]}" for s in steps if s.ok) or "（无）") +
            f"。未覆盖的工具尝试：{', '.join(tried) or '无'}。"
        )

    return {
        "question": question,
        "answer": answer,
        "steps": [
            {"index": s.index, "thought": s.thought, "tool": s.tool,
             "args": s.args, "ok": s.ok, "observation": s.observation,
             "dedup": s.dedup}
            for s in steps
        ],
        "used_tools": sorted({s.tool for s in steps if s.tool and s.tool != "final"}),
        "tool_calls": len([s for s in steps if s.tool and s.tool != "final" and not s.dedup]),
    }
