"""引用图谱接口。

两个端点：
    GET  /graph          取当前引用图与度量指标
    POST /graph/rebuild  重新抽取全部论文的参考文献并匹配，重建引用边

为什么把「重建」单独做成一个接口：
抽取引用要重新解析 PDF（6 篇约 1~2 秒），不适合放在每次 GET 里。
前端打开图谱页调 GET，只在用户明确点「重建」或上传新论文后才调 rebuild。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.graph import (
    GraphEdgeOut,
    GraphNodeOut,
    GraphResponse,
    RebuildResponse,
)
from app.services import citation_service, graph_service

router = APIRouter(prefix="/graph", tags=["引用图谱"])


@router.get("", response_model=GraphResponse, summary="引用图谱")
async def get_graph(db: AsyncSession = Depends(get_db)) -> GraphResponse:
    """返回引用图：节点、边、以及入度 / PageRank / 连通分量等指标。

    节点分两类：已入库论文（可点进阅读器）与外部论文（仅在别人的参考文献里出现）。
    外部节点让图更完整，也提示用户「这篇还没上传」。
    """
    data = await graph_service.build_graph(db)
    return GraphResponse(
        nodes=[
            GraphNodeOut(
                id=n.id,
                label=n.label,
                in_library=n.in_library,
                arxiv_id=n.arxiv_id,
                year=n.year,
                venue=n.venue,
                in_degree=n.in_degree,
                out_degree=n.out_degree,
                pagerank=n.pagerank,
                cluster=n.cluster,
            )
            for n in data.nodes
        ],
        edges=[
            GraphEdgeOut(
                source=e.source,
                target=e.target,
                ref_index=e.ref_index,
                match_method=e.match_method,
            )
            for e in data.edges
        ],
        library_count=data.library_count,
        external_count=data.external_count,
        edge_count=data.edge_count,
        cluster_count=data.cluster_count,
        top_by_pagerank=data.top_by_pagerank,
        top_by_in_degree=data.top_by_in_degree,
        isolated=data.isolated,
    )


@router.post("/rebuild", response_model=RebuildResponse, summary="重建引用关系")
async def rebuild(db: AsyncSession = Depends(get_db)) -> RebuildResponse:
    """重新抽取全部论文的参考文献并匹配。

    需要重新解析 PDF，会读取磁盘上的原件；已删除文件的论文会被跳过并记录。
    """
    results = await citation_service.rebuild_all(db)
    await db.commit()

    return RebuildResponse(
        papers=len(results),
        total_refs=sum(r.total_refs for r in results),
        matched=sum(r.matched for r in results),
        by_arxiv=sum(r.by_arxiv for r in results),
        by_title=sum(r.by_title for r in results),
        external=sum(r.external for r in results),
        details=[
            {
                "paper_id": r.paper_id,
                "total_refs": r.total_refs,
                "matched": r.matched,
                "by_arxiv": r.by_arxiv,
                "by_title": r.by_title,
                "external": r.external,
            }
            for r in results
        ],
    )
