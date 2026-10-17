"""嵌入模型客户端。

把文本转成向量，用于语义检索。走 OpenAI 兼容的 /embeddings 接口，
所以百炼、OpenAI、本地 Ollama 都能用，只改 base_url 与 model 即可。

三个现实问题的处理：
1. 分批：百炼对单次请求的文本条数有限制，必须拆分
2. 重试：网络抖动用指数退避重试；但参数错误（4xx）重试无意义，不重试
3. 维度：不硬编码。首次响应里读出来并缓存，避免换模型后维度不符导致静默错误
"""

from __future__ import annotations

import logging

from openai import AsyncOpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.exceptions import EmbeddingUnavailable

logger = logging.getLogger(__name__)

# 客户端与维度在进程内复用：客户端持有连接池，重复创建会浪费握手
_client: AsyncOpenAI | None = None
_dim: int | None = settings.embedding_dim


def is_available() -> bool:
    """是否配置了嵌入模型。未配置时上层应降级为纯 BM25。"""
    return settings.embeddings_enabled


def detected_dim() -> int | None:
    """已探测到的向量维度。未调用过时为 None。"""
    return _dim


def _get_client() -> AsyncOpenAI:
    global _client
    if not is_available():
        raise EmbeddingUnavailable("未配置 APP_EMBEDDING_API_KEY")
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.embedding_api_key.get_secret_value(),
            base_url=settings.embedding_base_url,
            timeout=settings.embedding_timeout,
            max_retries=0,   # 重试交给 tenacity，避免与外层重试叠加
        )
    return _client


@retry(
    retry=retry_if_exception_type(Exception),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, max=4),
    reraise=True,
)
async def _embed_batch(batch: list[str]) -> list[list[float]]:
    """嵌入单批文本。失败会重试，最终仍失败则抛出。"""
    client = _get_client()
    resp = await client.embeddings.create(
        model=settings.embedding_model,
        input=batch,
    )
    vectors = [item.embedding for item in resp.data]
    if len(vectors) != len(batch):
        raise EmbeddingUnavailable(
            "返回条数与请求不一致",
            {"requested": len(batch), "returned": len(vectors)},
        )
    return vectors


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """把一批文本嵌入成向量，自动按 batch_size 分批。

    空字符串会被替换成一个空格：部分接口会直接拒绝空字符串输入。
    """
    if not texts:
        return []

    global _dim
    batch_size = max(1, settings.embedding_batch_size)
    cleaned = [t if t and t.strip() else " " for t in texts]

    result: list[list[float]] = []
    for start in range(0, len(cleaned), batch_size):
        batch = cleaned[start:start + batch_size]
        vectors = await _embed_batch(batch)
        # 首次拿到向量后记录维度，供后续一致性校验
        if _dim is None and vectors:
            _dim = len(vectors[0])
            logger.info("探测到嵌入维度: %d（模型 %s）", _dim, settings.embedding_model)
        result.extend(vectors)

    return result


async def embed_one(text: str) -> list[float]:
    """嵌入单条文本（检索时嵌入问题用）。"""
    vectors = await embed_texts([text])
    if not vectors:
        raise EmbeddingUnavailable("嵌入结果为空")
    return vectors[0]




