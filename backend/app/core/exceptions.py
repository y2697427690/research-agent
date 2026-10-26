"""统一错误处理。

所有业务异常都继承 AppError，由本模块注册的处理器转成同一格式的 JSON：
    {"error": {"code": "...", "message": "...", "detail": {...}}}
"""
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    """业务异常基类。

    用法：
        raise NotFound("论文不存在", {"paper_id": "p-1"})
    """

    code: str = "INTERNAL_ERROR"
    status: int = 500

    def __init__(self, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


class NotFound(AppError):
    code = "NOT_FOUND"
    status = 404


class DuplicatePaper(AppError):
    code = "DUPLICATE_PAPER"
    status = 409


class ParseFailed(AppError):
    code = "PARSE_FAILED"
    status = 422


class LLMUnavailable(AppError):
    code = "LLM_UNAVAILABLE"
    status = 503


class UploadTooLarge(AppError):
    code = "UPLOAD_TOO_LARGE"
    status = 413


class InvalidRequest(AppError):
    code = "INVALID_REQUEST"
    status = 400


def error_body(code: str, message: str, detail: dict | None = None) -> dict:
    """构造统一的错误响应体。"""
    return {"error": {"code": code, "message": message, "detail": detail or {}}}


def register_exception_handlers(app: FastAPI) -> None:
    """把所有处理器注册到 app 上，main.py 启动时调用一次。"""

    @app.exception_handler(AppError)
    async def _handle_app_error(request: Request, exc: AppError) -> ORJSONResponse:
        logger.warning("业务异常 %s: %s", exc.code, exc.message)
        return ORJSONResponse(
            status_code=exc.status,
            content=error_body(exc.code, exc.message, exc.detail),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> ORJSONResponse:
        """请求参数校验失败。

        exc.errors() 会指出具体是哪个字段不对，返回给前端便于排查。

        为什么要先 sanitize：Pydantic v2 的 errors() 里 ctx 可能带原始异常对象
        （例如自定义校验器抛的 ValueError）。直接塞进 ORJSONResponse 会抛
        "Type is not JSON serializable: ValueError"，最终变成 500 ——
        本该是 422 的请求反而看起来像服务器崩了。线上就踩到过：
        演示按钮把 {name,size} 这种假文件塞进 FormData，后端校验失败后 500。
        """
        safe_errors = []
        for err in exc.errors():
            item = {
                "type": str(err.get("type", "")),
                "loc": [str(x) for x in (err.get("loc") or [])],
                "msg": str(err.get("msg", "")),
            }
            ctx = err.get("ctx")
            if ctx:
                item["ctx"] = {str(k): str(v) for k, v in dict(ctx).items()}
            if "input" in err:
                raw = err.get("input")
                item["input"] = raw if isinstance(raw, (str, int, float, bool, type(None))) else repr(raw)[:200]
            safe_errors.append(item)

        return ORJSONResponse(
            status_code=422,
            content=error_body("VALIDATION_ERROR", "请求参数不合法",
                               {"errors": safe_errors}),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_error(
        request: Request, exc: StarletteHTTPException
    ) -> ORJSONResponse:
        """HTTP 层异常，例如路由不存在（404）、方法不允许（405）。"""
        return ORJSONResponse(
            status_code=exc.status_code,
            content=error_body("HTTP_ERROR", str(exc.detail)),
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> ORJSONResponse:
        """兜底处理器。

        对外只返回通用提示，真实异常与堆栈写进日志，
        避免向客户端泄露文件路径、库版本等内部信息。
        """
        logger.exception("未处理异常: %s %s", request.method, request.url.path)
        return ORJSONResponse(
            status_code=500,
            content=error_body("INTERNAL_ERROR", "服务器内部错误"),
        )


class EmbeddingUnavailable(AppError):
    """嵌入模型不可用（未配置 Key 或调用失败）。

    上层收到它时应降级为纯 BM25 检索，而不是让整个请求失败——
    检索能力会变弱，但功能不中断。
    """

    code = "EMBEDDING_UNAVAILABLE"
    status = 503

    def __init__(self, message: str = "嵌入模型不可用", detail: dict | None = None) -> None:
        super().__init__(message, detail)



