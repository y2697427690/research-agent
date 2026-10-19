"""v1 版本接口汇总。"""
from fastapi import APIRouter

from app.api.v1 import health, papers, search

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(papers.router)
api_router.include_router(search.router)
