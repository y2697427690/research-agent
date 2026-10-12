"""日志配置。

统一全项目的日志格式，并把 uvicorn 自身的日志也纳入同一套格式，
避免同一行日志出现两种样式或重复输出。
"""
import logging
import sys

from app.core.config import settings

# 日志格式：时间 | 级别 | 模块名 | 内容
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging() -> None:
    """配置根日志器，应用启动时调用一次。"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(fmt=LOG_FORMAT, datefmt=DATE_FORMAT))

    root = logging.getLogger()
    # 清掉已有 handler：否则重复调用会导致同一行日志打印多次
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())

    # uvicorn 默认会自己加 handler，这里清掉并让它向上冒泡到根日志器，
    # 从而统一使用上面的格式
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True


def get_logger(name: str) -> logging.Logger:
    """各模块用 logger = get_logger(__name__) 获取日志器。"""
    return logging.getLogger(name)