"""v1 版本接口汇总。"""
from fastapi import APIRouter

from app.api.v1 import health, papers

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(papers.router)




