"""大模型客户端。

只负责「怎么调模型」：连接、重试、超时、流式。
不负责 prompt 构造与引用校验——那是 rag.py 的职责。

走 OpenAI 兼容接口，因此 DeepSeek / OpenAI / 本地 Ollama 都可用，
只改 APP_LLM_BASE_URL 与 APP_LLM_MODEL_CHAT 即可。

为什么必须支持流式：
生成长回答需要数秒到十几秒。一次性返回会让用户以为请求卡死，
而流式的「首字延迟」通常不到 1 秒，体验差别极大。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.exceptions import LLMUnavailable

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def _is_transient(exc: BaseException) -> bool:
    """判断异常是否值得重试。

    只重试临时性故障：连接失败、超时、限流（429）、服务端错误（5xx）。
    不重试：400 参数错误、401/403 认证失败。

    对永久性错误重试是纯浪费：重试多少次都不会成功，只会把「立刻失败」
    拖成「等几秒再失败」，并让错误信息被十几次重试淹没、更难排查。
    本项目实测踩到过：一把失效的 Key 触发了 3 次重试，
    真正的 401 原因被埋在长 traceback 里。
    """
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code >= 500
    return False


def is_available() -> bool:
    """是否配置了大模型 Key。"""
    return settings.has_llm


def _get_client() -> AsyncOpenAI:
    global _client
    if not is_available():
        raise LLMUnavailable("未配置 APP_LLM_API_KEY")
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.llm_api_key.get_secret_value(),
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
            max_retries=0,      # 重试统一交给 tenacity，避免与外层叠加
        )
    return _client


@retry(
    retry=retry_if_exception(_is_transient),
    stop=stop_after_attempt(settings.llm_max_retry + 1),
    wait=wait_exponential(multiplier=0.5, max=4),
    reraise=True,
)
async def _create(messages: list[dict], *, temperature: float, max_tokens: int | None):
    client = _get_client()
    return await client.chat.completions.create(
        model=settings.llm_model_chat,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )


async def chat(
    messages: list[dict],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> str:
    """一次性拿到完整回答。

    temperature 默认 0.2：问答要的是稳定与忠实，不是创意。
    温度高会让模型更爱自由发挥，与防幻觉的目标冲突。
    """
    try:
        resp = await _create(messages, temperature=temperature, max_tokens=max_tokens)
    except Exception as exc:                     # noqa: BLE001 统一转成领域异常
        logger.warning("大模型调用失败: %s: %s", type(exc).__name__, exc)
        # 认证失败单独指出：否则用户只看到「暂时不可用」，无从下手
        if isinstance(exc, AuthenticationError):
            raise LLMUnavailable(
                "大模型密钥无效，请检查 .env 中的 APP_LLM_API_KEY",
                {"reason": str(exc)[:200]},
            ) from exc
        raise LLMUnavailable(
            "大模型暂时不可用，请稍后重试",
            {"reason": f"{type(exc).__name__}: {exc}"[:200]},
        ) from exc

    if not resp.choices:
        raise LLMUnavailable("大模型返回为空")
    return (resp.choices[0].message.content or "").strip()


async def stream_chat(
    messages: list[dict],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    """流式生成，逐段产出文本增量。

    注意：流式一旦开始就不能重试——重试会导致前半段内容被重复输出。
    因此这里不做 tenacity 包装，失败直接抛给上层，
    由上层决定是「整段重来」还是「告知用户中断」。
    """
    client = _get_client()
    try:
        stream = await client.chat.completions.create(
            model=settings.llm_model_chat,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            text = getattr(delta, "content", None)
            if text:
                yield text
    except Exception as exc:                     # noqa: BLE001
        logger.warning("大模型流式调用失败: %s: %s", type(exc).__name__, exc)
        raise LLMUnavailable(
            "大模型流式输出中断",
            {"reason": f"{type(exc).__name__}: {exc}"[:200]},
        ) from exc
