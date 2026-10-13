"""  v1 版本接口汇总 """

from fastapi import APIRouter
from app.api.v1 import health

api_router = APIRouter()
api_router.include_router(health.router)

@api_router.get("/stats", tags=["系统"], summary="统计概览")

# 后期再把stats单独拆出来

async def stats():
    """工作台统计信息
    
    p0阶段返回占位数据，p1再接入真实统计
    
    """
    return {"papers": 0,
        "parsed": 0,
        "pages": 0,
        "refs": 0,
        "avg_quality": None,
        "llm_tokens": 0,
        }

