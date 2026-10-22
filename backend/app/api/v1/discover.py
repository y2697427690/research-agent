"""论文发现接口：arXiv 检索与一键入库。

两个端点：
    GET  /discover/search   按关键词检索 arXiv（不写库）
    POST /discover/ingest   把指定编号的论文下载进来，走与上传一致的
                            「去重 → 落盘 → 登记」流程

为什么入库要复用 paper_service 而不是另写一套
------------------------------------------------------------------------
去重判定（内容指纹、arXiv 编号与版本、文件名规范化）和落盘逻辑
都在 paper_service 里，且已被上传接口与单元测试覆盖。
另写一套必然出现「上传能识别重复、入库识别不了」这类不一致。
所以这里只负责「下载 PDF」，剩下交给同一套服务。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import InvalidRequest
from app.core.logging import get_logger
from app.db.session import get_db
from app.models.paper import Paper
from app.schemas.discover import (
    ArxivItemOut,
    DiscoverSearchResponse,
    IngestRequest,
    IngestResponse,
)
from app.schemas.paper import DuplicateInfo, PaperOut
from app.services import discover, paper_service

router = APIRouter(prefix="/discover", tags=["论文发现"])
logger = get_logger(__name__)


@router.get("/search", response_model=DiscoverSearchResponse, summary="检索 arXiv")
async def search_arxiv(
    q: str = Query(..., min_length=1, max_length=200, description="关键词或 arXiv 查询语法"),
    max_results: int = Query(10, ge=1, le=discover.MAX_RESULTS_LIMIT, description="返回条数"),
    sort: str = Query("relevance", pattern="^(relevance|recent)$", description="相关度 / 最新"),
    db: AsyncSession = Depends(get_db),
) -> DiscoverSearchResponse:
    """按关键词检索 arXiv，并标出哪些已经在库里。

    标记「是否已在库」是为了让前端把按钮显示成「已在库」而不是「入库」——
    否则用户点了才发现重复，白等一次下载。
    """
    try:
        items = await discover.search(q, max_results=max_results, sort=sort)
    except Exception as exc:  # noqa: BLE001 - 上游网络/限流都可能失败
        logger.warning("arXiv 检索失败: %s: %s", type(exc).__name__, exc)
        raise InvalidRequest(
            "arXiv 检索失败，请稍后重试",
            {"reason": f"{type(exc).__name__}: {exc}"[:200]},
        ) from exc

    # 一次查出库里已有的 arXiv 编号，避免逐条查询
    known: set[str] = set()
    if items:
        wanted = {it.arxiv_id for it in items}
        rows = (await db.execute(
            select(Paper.arxiv_id).where(Paper.arxiv_id.in_(wanted))
        )).scalars().all()
        known = {r for r in rows if r}

    effective, _quoted = discover.build_query(q)
    hint = None
    if not items:
        hint = (
            "没有找到匹配的论文。可以换更具体的关键词，"
            "或直接使用 arXiv 语法，例如 ti:transformer、au:hinton。"
        )

    return DiscoverSearchResponse(
        query=q,
        effective_query=effective,
        total=len(items),
        items=[
            ArxivItemOut(
                arxiv_id=it.arxiv_id,
                version=it.version,
                title=it.title,
                authors=it.authors,
                summary=it.summary,
                published=it.published,
                updated=it.updated,
                primary_category=it.primary_category,
                categories=it.categories,
                comment=it.comment,
                pdf_url=it.pdf_url,
                abs_url=it.abs_url,
                in_library=it.arxiv_id in known,
            )
            for it in items
        ],
        hint=hint,
    )


@router.post("/ingest", response_model=IngestResponse, summary="从 arXiv 下载入库")
async def ingest_arxiv(
    payload: IngestRequest,
    db: AsyncSession = Depends(get_db),
) -> IngestResponse:
    """下载指定 arXiv 论文的 PDF 并入库。

    只做入库，不触发解析：解析是重操作（一篇约 1 秒，但会占住连接），
    由前端在入库成功后单独调用 `/papers/{id}/parse`，
    这样界面可以先显示「已入库」再显示解析进度。
    """
    arxiv_id = payload.arxiv_id.strip()
    try:
        data = await discover.download_pdf(arxiv_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("下载 arXiv PDF 失败 %s: %s", arxiv_id, exc)
        raise InvalidRequest(
            f"下载 arXiv:{arxiv_id} 失败",
            {"reason": f"{type(exc).__name__}: {exc}"[:200]},
        ) from exc

    # 文件名带上 arXiv 编号：入库后 extract_arxiv_id 能直接识别，
    # 后续做引用匹配、版本判定都依赖它。
    file_name = f"{arxiv_id}.pdf"

    uploaded, verdict = await paper_service.detect_new_paper(
        db, file_name=file_name, data=data
    )

    if verdict.is_duplicate and not payload.force:
        logger.info("arXiv 入库检出重复: %s kind=%s", arxiv_id, verdict.kind)
        return IngestResponse(
            accepted=False,
            arxiv_id=arxiv_id,
            file_name=file_name,
            duplicate=DuplicateInfo(
                kind=verdict.kind,
                message=verdict.describe(),
                existing_paper_id=verdict.existing.paper_id if verdict.existing else None,
                existing_file_name=verdict.existing.file_name if verdict.existing else None,
                reasons=verdict.reasons,
            ),
            message=verdict.describe(),
        )

    paper = await paper_service.create_paper(
        db, uploaded=uploaded, file_name=file_name
    )
    await db.commit()
    await db.refresh(paper)
    logger.info("arXiv 入库成功: %s -> %s", arxiv_id, paper.id)

    return IngestResponse(
        accepted=True,
        arxiv_id=arxiv_id,
        file_name=file_name,
        paper=PaperOut.model_validate(paper),
        message="已入库，接下来可以触发解析",
    )
