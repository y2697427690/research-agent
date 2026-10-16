"""健康检查相关模型"""

# 健康检查真的调用LLM模型成本高，速度慢，频繁触发会导致性能问题，使用None更快，免费，无法副作用，如需真要验证连通性，
# 再单独提供接口按需调用
from pydantic import BaseModel, Field


class DBStatus(BaseModel):
    """数据库状态"""
    ok: bool = Field(description="数据库是否可连通")
    url_scheme: str = Field(description="数据库类型，例如sqlite+aiosqlite")

class LLMStatus(BaseModel):
    """大模型配置状态。"""
    configured: bool = Field(description="是否配置了API Key")
    base_url: str = Field(description="接口地址")
    model: str = Field(description="默认对话模型")
    #None 表示未探测；健康检查默认不主动请求外部api  避免了无key时也产生延迟
    reachable: bool | None = Field(default=None, description="是否连通，None表示未探测")

class HealthOut(BaseModel):
    """GET /health 的响应"""

    status: str = Field(description="ok表示服务正常")
    app: str = Field(description="应用名称")
    version: str = Field(description="应用版本")
    db: DBStatus
    llm: LLMStatus
