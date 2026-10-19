"""问答接口。

两个端点：
    POST /qa          非流式，一次性返回完整回答（便于调试与自动化测试）
    POST /qa/stream   SSE 流式，边生成边推送（前端使用）
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, get_db
from app.schemas.qa import AnswerResponse, AskRequest, CitationOut
from app.services import rag

router = APIRouter(prefix="/qa", tags=["问答"])


@router.post("", response_model=AnswerResponse, summary="问答（非流式）")
async def ask(
    payload: AskRequest,
    db: AsyncSession = Depends(get_db),
) -> AnswerResponse:
    """检索 + 生成 + 引用校验，一次性返回。

    invalid_marks 非空表示模型编造了引用编号——这些编号已被移除，
    该字段用于观测模型行为，不展示给最终用户。
    """
    result = await rag.answer(
        db, payload.question,
        top_k=payload.top_k, allow_vector=payload.allow_vector,
    )
    return AnswerResponse(
        question=result.question,
        answer=result.answer,
        citations=[
            CitationOut(
                index=c.index,
                chunk_id=c.chunk_id,
                paper_id=c.paper_id,
                citation=c.citation,
                text=c.text,
            )
            for c in result.citations
        ],
        invalid_marks=result.invalid_marks,
        hit_count=result.hit_count,
        mode=result.mode,
        refused=result.refused,
    )


def _sse(event: dict) -> str:
    """把事件编码成 SSE 帧。

    SSE 规定每条消息以 data: 开头、以空行结束。
    这里不额外写 event: 字段，而是把类型放进 JSON 里，
    前端只需监听一种消息、按 payload.type 分支即可，更不易出错。
    """
    return "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"


@router.post(
    "/stream",
    summary="问答（SSE 流式）",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def ask_stream(payload: AskRequest) -> StreamingResponse:
    """流式问答。响应为 text/event-stream。

    事件顺序：citations → token（多次）→ done
    出错时为 error 事件。

    这里不用 Depends(get_db)：流式响应的数据库会话生命周期
    与请求不同步，依赖的清理可能早于生成器结束，
    因此改成在生成器内部自行开启与关闭会话。
    """

    async def event_stream() -> AsyncIterator[str]:
        async with SessionLocal() as db:
            try:
                async for event in rag.answer_stream(
                    db, payload.question,
                    top_k=payload.top_k, allow_vector=payload.allow_vector,
                ):
                    yield _sse(event)
            except Exception as exc:              # noqa: BLE001 兜住生成器内异常
                yield _sse({
                    "type": "error",
                    "message": "服务内部错误",
                    "reason": f"{type(exc).__name__}: {exc}"[:200],
                })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            # 关闭各级缓冲，否则前端会等整段生成完才收到内容
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
