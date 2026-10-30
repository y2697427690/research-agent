"""通用文本翻译接口。

为什么单独开一个路由文件，而不是塞进 papers.py：
  · 它没有论文 id，和「按论文翻译分块」不是同一类资源；
  · 写作页与阅读器划词翻译都要用，属于公共能力；
  · 单独一个文件更容易在读代码时定位（`/translate` 一眼可懂）。

设计取舍：
  · 不落库。一次翻译几百字，落库的复杂度（建表、迁移、清理）远大于收益；
  · 进程内缓存。同一段文字重复点「翻译」不再重复付费，重启后清空可以接受。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import settings
from app.core.exceptions import InvalidRequest, LLMUnavailable
from app.core.logging import get_logger
from app.schemas.translate import TranslateTextRequest, TranslateTextResponse
from app.services import translate_service

logger = get_logger(__name__)

router = APIRouter(prefix="/translate", tags=["翻译"])


@router.post("", response_model=TranslateTextResponse, summary="通用文本翻译")
async def translate_text(payload: TranslateTextRequest) -> TranslateTextResponse:
    """把一段中文翻译成英文（或反向），用于写作页与划词翻译。

    与 `/papers/{id}/translate` 的区别：那个是「把整篇论文的分块逐段翻译并落库」，
    这个只处理用户当前手里的一小段文字，不碰数据库。
    """
    try:
        translated, cached = await translate_service.translate_free_text(
            payload.text, payload.direction
        )
    except ValueError as exc:
        # 空文本、模型返回空等：属于输入侧问题，不该报 500
        raise InvalidRequest(str(exc)) from exc
    except LLMUnavailable:
        # 未配置 Key / 上游失败：交给全局处理器转成 503 + 可读提示
        raise
    except Exception as exc:  # noqa: BLE001 - 上游偶发异常不应把堆栈抛给前端
        logger.warning("文本翻译失败: %s: %s", type(exc).__name__, exc)
        raise LLMUnavailable("翻译失败，请稍后重试") from exc

    return TranslateTextResponse(
        text=translated,
        direction=payload.direction,
        model=settings.llm_model_chat,
        cached=cached,
    )
