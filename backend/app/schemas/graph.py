"""引用图谱接口的响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class GraphNodeOut(BaseModel):
    """图上的一个节点。"""

    id: str
    label: str
    in_library: bool = Field(..., description="是否已入库（未入库的只能看，不能点进去）")
    arxiv_id: str | None = None
    year: int | None = None
    venue: str | None = None
    in_degree: int = Field(0, description="被库内论文引用的次数")
    out_degree: int = Field(0, description="引用了多少篇文献")
    pagerank: float = Field(0.0, description="库内 PageRank")
    cluster: int = Field(0, description="所属连通分量编号，从 1 开始")


class GraphEdgeOut(BaseModel):
    """一条引用边。"""

    source: str
    target: str
    ref_index: int = 0
    match_method: str = Field("none", description="arxiv / title / none")


class GraphResponse(BaseModel):
    """完整的引用图。"""

    nodes: list[GraphNodeOut] = Field(default_factory=list)
    edges: list[GraphEdgeOut] = Field(default_factory=list)
    library_count: int = 0
    external_count: int = 0
    edge_count: int = 0
    cluster_count: int = 0
    top_by_pagerank: list[dict] = Field(default_factory=list)
    top_by_in_degree: list[dict] = Field(default_factory=list)
    isolated: list[str] = Field(default_factory=list, description="与库内其它论文无引用关系的论文")
    pagerank_scope: str = Field(
        "library",
        description="PageRank 的计算范围。库内论文之间的引用才完整，外部论文只有入边，"
                    "放进去会把分布摊平，因此只在库内子图上计算",
    )


class RebuildResponse(BaseModel):
    """重建引用的结果。"""

    papers: int = 0
    total_refs: int = 0
    matched: int = 0
    by_arxiv: int = 0
    by_title: int = 0
    external: int = 0
    details: list[dict] = Field(default_factory=list)
