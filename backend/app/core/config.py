"""应用配置。

所有敏感信息（API Key 等）只从环境变量或 .env 文件读取，
不允许硬编码在代码里，也不会传给前端。
"""
from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根目录（backend/）
# __file__ 是 app/core/config.py，向上三级才是 backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """从环境变量读取配置。

    变量名规则：APP_ + 字段名大写。
    例如字段 llm_api_key 对应环境变量 APP_LLM_API_KEY。
    """

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_prefix="APP_",
        extra="ignore",
        # 环境变量值前后的空格很难排查，交给 pydantic 自动去掉
        str_strip_whitespace=True,
    )

    # ---------- 基本信息 ----------
    app_name: str = "科研小助手 Agent API"
    app_version: str = "0.1.0"
    debug: bool = True
    log_level: str = "INFO"

    # ---------- 大模型（OpenAI 兼容）----------
    # 默认指向 DeepSeek；改用 OpenAI 或本地 Ollama 只需覆盖 APP_LLM_BASE_URL
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: SecretStr | None = None
    llm_model_chat: str = "deepseek-chat"
    llm_model_reasoner: str = "deepseek-reasoner"
    llm_timeout: float = 60.0
    llm_max_retry: int = 2

    # ---------- 存储 ----------
    static_dir: Path = BACKEND_DIR / "app" / "static"
    data_dir: Path = BACKEND_DIR / "data"
    storage_dir: Path = BACKEND_DIR / "data" / "papers"

    # ---------- 上传限制 ----------
    max_upload_mb: int = 200
    max_files_per_request: int = 10

    # ---------- CORS ----------
    # 前端用 file:// 直接打开时，浏览器发送的 Origin 是字符串 "null"，必须显式允许。
    # 注意 localhost 与 127.0.0.1 在浏览器看来是**两个不同的来源**，
    # 只配置其中一个会导致「用另一个地址打开时所有请求被 CORS 拦下」，
    # 表现为前端提示「无法连接后端服务」，很容易误判成服务没起。
    # 因此本地开发常用的几种地址都列上。
    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "null",
    ]

    # ---------- 嵌入模型（向量检索）----------
    # 留空则向量检索自动降级为纯 BM25，检索功能不中断。
    # 默认指向阿里云百炼的 OpenAI 兼容端点。
    embedding_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    embedding_api_key: SecretStr | None = None
    embedding_model: str = "text-embedding-v3"
    # 百炼对单次请求的文本条数有限制，因此批量时要分批
    embedding_batch_size: int = 10
    embedding_timeout: float = 30.0
    # 向量维度不硬编码：首次调用后从响应里读出来，避免模型换了维度就崩
    embedding_dim: int | None = None

    @property
    def embeddings_enabled(self) -> bool:
        """是否配置了嵌入模型。未配置时检索走纯 BM25。"""
        return self.embedding_api_key is not None

    @property
    def has_llm(self) -> bool:
        """是否配置了大模型 Key。未配置时后续走规则降级逻辑。"""
        return self.llm_api_key is not None

    @property
    def db_url(self) -> str:
        """SQLAlchemy 连接串。

        SQLite + aiosqlite 异步驱动；路径里必须是正斜杠，
        所以用 as_posix() 把 Windows 的反斜杠转过来。
        """
        return f"sqlite+aiosqlite:///{(self.data_dir / 'app.db').as_posix()}"


@lru_cache
def get_settings() -> Settings:
    """只在首次调用时读取配置，之后复用同一实例。"""
    return Settings()


settings = get_settings()
