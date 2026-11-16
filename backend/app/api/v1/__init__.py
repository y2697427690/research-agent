"""v1 版本接口汇总。"""
from fastapi import APIRouter

from app.api.v1 import (
    agent,
    discover,
    eval,
    graph,
    health,
    papers,
    qa,
    search,
    subscriptions,
    translate,
    writing,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(agent.router)
api_router.include_router(papers.router)
api_router.include_router(search.router)
api_router.include_router(qa.router)
api_router.include_router(graph.router)
api_router.include_router(discover.router)
api_router.include_router(translate.router)
api_router.include_router(writing.router)
api_router.include_router(subscriptions.router)
api_router.include_router(eval.router)
