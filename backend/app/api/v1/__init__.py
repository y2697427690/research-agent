"""v1 版本接口汇总。"""
from fastapi import APIRouter

from app.api.v1 import discover, graph, health, papers, qa, search

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(papers.router)
api_router.include_router(search.router)
api_router.include_router(qa.router)
api_router.include_router(graph.router)
api_router.include_router(discover.router)
