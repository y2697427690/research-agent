"""论文相关接口。

本层只负责 HTTP：解析请求、调用 service、组装响应、映射错误。
不写 SQL，也不做业务判断。
"""


from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    EmbeddingUnavailable,
    InvalidRequest,
    LLMUnavailable,
    NotFound,
    UploadTooLarge,
)
from app.core.logging import get_logger
from app.db.session import SessionLocal, get_db
from app.models.chunk import Chunk
from app.models.paper import Paper
from app.models.translation import ChunkTranslation
from app.schemas.chunk import (
    ChunkOut,
    ChunksResponse,
    TranslateRequest,
    TranslateResponse,
)
from app.schemas.common import Ok, Page
from app.schemas.paper import (
    DuplicateInfo,
    PaperCreateResult,
    PaperOut,
    PaperUpdate,
    ParseStateOut,
    UploadResponse,
)
from app.schemas.search import EmbedRequest, EmbedResponse
from app.services import (
    chunk_service,
    paper_service,
    parser_service,
    translate_service,
)
from app.services.dedupe import DuplicateVerdict

router = APIRouter(prefix="/papers", tags=["论文"])
logger = get_logger(__name__)


# ---------------------------------------------------------------- 辅助转换


def _to_duplicate_info(v: DuplicateVerdict) -> DuplicateInfo:
    """把 service 层的判定结果转成对外结构。"""
    return DuplicateInfo(
        kind=v.kind,
        message=v.describe(),
        existing_paper_id=v.existing.paper_id if v.existing else None,
        existing_file_name=v.existing.file_name if v.existing else None,
        reasons=v.reasons,
    )


# ---------------------------------------------------------------- 上传


@router.post("/upload", response_model=UploadResponse, summary="上传论文")
async def upload_papers(
    files: list[UploadFile] = File(..., description="一个或多个 PDF 文件"),
    force: bool = Query(
        default=False,
        description="为 true 时即使检出重复也强制入库（用户已确认保留）",
    ),
    db: AsyncSession = Depends(get_db),
) -> UploadResponse:
    """批量上传论文。

    对每个文件：落盘 → 算内容指纹 → 与库中已有论文比对。
    检出重复时默认不入库，把判定结果返回给前端由用户决定；
    带 force=true 时忽略重复直接入库。
    """
    if not files:
        raise InvalidRequest("没有收到文件")
    if len(files) > settings.max_files_per_request:
        raise InvalidRequest(
            f"单次最多上传 {settings.max_files_per_request} 个文件，"
            f"本次收到 {len(files)} 个"
        )

    limit = settings.max_upload_mb * 1024 * 1024
    results: list[PaperCreateResult] = []

    for upload in files:
        name = upload.filename or "unnamed.pdf"
        try:
            data = await upload.read()
            if len(data) > limit:
                raise UploadTooLarge(
                    f"{name} 超过单文件上限 {settings.max_upload_mb} MB"
                )
            if not data:
                raise InvalidRequest(f"{name} 是空文件")
            # 校验文件头：真正的 PDF 一定以 %PDF- 开头。
            # 不加这一步的话，用户拖进一个 .txt / .docx 也能"上传成功"入库，
            # 直到解析阶段才失败，届时错误信息对用户毫无意义。
            if not data.startswith(b"%PDF-"):
                raise InvalidRequest(f"{name} 不是 PDF 文件（缺少 %PDF- 文件头）")

            uploaded, verdict = await paper_service.detect_new_paper(
                db, file_name=name, data=data
            )

            # 检出重复且未强制入库：不入库，返回判定结果
            if verdict.is_duplicate and not force:
                results.append(
                    PaperCreateResult(
                        accepted=False,
                        file_name=name,
                        duplicate=_to_duplicate_info(verdict),
                    )
                )
                continue

            paper = await paper_service.create_paper(
                db, uploaded=uploaded, file_name=name
            )
            results.append(
                PaperCreateResult(
                    accepted=True,
                    file_name=name,
                    paper=PaperOut.model_validate(paper),
                    # 即使强制入库，也把重复信息带上，便于前端标注
                    duplicate=_to_duplicate_info(verdict) if verdict.is_duplicate else None,
                )
            )
        except (InvalidRequest, UploadTooLarge) as exc:
            # 可预期的输入问题：记录后作为单文件失败返回，不影响其它文件
            logger.warning("上传 %s 被拒绝：%s", name, exc.message)
            results.append(
                PaperCreateResult(accepted=False, file_name=name, error=exc.message)
            )

    await db.commit()

    response = UploadResponse(
        results=results,
        accepted=sum(1 for r in results if r.accepted),
        duplicates=sum(1 for r in results if r.duplicate and not r.accepted),
        failed=sum(1 for r in results if r.error),
    )
    logger.info(
        "上传完成：成功 %d / 重复 %d / 失败 %d",
        response.accepted, response.duplicates, response.failed,
    )
    return response

# ---------------------------------------------------------------- 查询


@router.get("", response_model=Page[PaperOut], summary="论文列表")
async def list_papers(
    page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页条数"),
    keyword: str | None = Query(default=None, description="按标题或文件名模糊搜索"),
    status: str | None = Query(default=None, description="按解析状态过滤"),
    starred: bool | None = Query(default=None, description="只看星标"),
    db: AsyncSession = Depends(get_db),
) -> Page[PaperOut]:
    """分页查询论文列表。"""
    items, total = await paper_service.list_papers(
        db,
        page=page,
        page_size=page_size,
        keyword=keyword,
        status=status,
        starred=starred,
    )
    return Page[PaperOut](
        items=[PaperOut.model_validate(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/stats", summary="论文统计")
async def paper_stats(db: AsyncSession = Depends(get_db)) -> dict:
    """工作台统计信息，数据来自数据库。"""
    total = (await db.execute(select(func.count()).select_from(Paper))).scalar_one()
    by_status = await paper_service.count_by_status(db)
    avg_quality = (
        await db.execute(select(func.avg(Paper.quality)).where(Paper.quality.is_not(None)))
    ).scalar()
    total_pages = (
        await db.execute(select(func.coalesce(func.sum(Paper.page_count), 0)))
    ).scalar_one()

    return {
        "papers": total,
        "parsed": by_status.get("done", 0),
        "need_review": by_status.get("need_review", 0),
        "failed": by_status.get("failed", 0),
        "parsing": by_status.get("parsing", 0) + by_status.get("queued", 0),
        "pages": int(total_pages or 0),
        "avg_quality": round(float(avg_quality), 4) if avg_quality is not None else None,
        "by_status": by_status,
    }

async def _parse_in_background(paper_id: str) -> None:
    """后台任务：解析论文。

    必须自己创建数据库会话——请求结束后请求级的会话已被回收，
    直接复用会报错。
    """
    async with SessionLocal() as db:
        await parser_service.parse_paper_safely(db, paper_id)


@router.post("/{paper_id}/parse", response_model=ParseStateOut, summary="触发解析")
async def start_parse(
    paper_id: str,
    background: BackgroundTasks,
    wait: bool = Query(
        default=False,
        description="true 时等解析完成再返回；false 时立即返回，解析在后台执行",
    ),
    db: AsyncSession = Depends(get_db),
) -> ParseStateOut:
    """解析论文的 PDF。

    默认（wait=false）立即返回并把解析交给后台任务，适合批量上传后统一触发；
    wait=true 则等待解析完成，便于调试与单篇手动解析。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})

    # 已在解析中则不重复启动，避免同一篇被并行解析两次
    if paper.parse_status == "parsing":
        return ParseStateOut(
            paper_id=paper.id,
            parse_status=paper.parse_status,
            quality=paper.quality,
            page_count=paper.page_count,
            started=False,
        )

    if wait:
        outcome = await parser_service.parse_paper(db, paper_id)
        await db.commit()
        await db.refresh(paper)
        return ParseStateOut(
            paper_id=paper.id,
            parse_status=paper.parse_status,
            parse_error=paper.parse_error,
            quality=paper.quality,
            page_count=paper.page_count,
            # 以下字段由本次解析结果直接给出，避免响应中恒为 null
            section_count=outcome.section_count,
            reference_count=outcome.reference_count,
            is_scanned=outcome.is_scanned,
            needs_review=paper.parse_status == "need_review",
            warnings=outcome.warnings,
            started=True,
        )

    # 后台模式：先把状态置为 parsing 并提交。
    # 若等响应返回后再提交，前端立刻轮询会看到旧的 queued 状态而误以为没开始。
    paper.parse_status = "parsing"
    await db.commit()
    background.add_task(_parse_in_background, paper_id)

    return ParseStateOut(
        paper_id=paper.id,
        parse_status="parsing",
        started=True,
    )

@router.get("/{paper_id}/parse", response_model=ParseStateOut, summary="查询解析状态")
async def get_parse_state(
    paper_id: str, db: AsyncSession = Depends(get_db)
) -> ParseStateOut:
    """查询论文的解析状态，不触发解析。

    前端在后台解析模式下用它轮询进度，直到 parse_status 不再是 parsing。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})

    return ParseStateOut(
        paper_id=paper.id,
        parse_status=paper.parse_status,
        parse_error=paper.parse_error,
        quality=paper.quality,
        page_count=paper.page_count,
    )

@router.get("/{paper_id}", response_model=PaperOut, summary="论文详情")
async def get_paper(paper_id: str, db: AsyncSession = Depends(get_db)) -> PaperOut:
    """按 id 取论文详情。"""
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})
    return PaperOut.model_validate(paper)

# ---------------------------------------------------------------- 修改与删除


@router.patch("/{paper_id}", response_model=PaperOut, summary="更新论文元数据")
async def update_paper(
    paper_id: str,
    payload: PaperUpdate,
    db: AsyncSession = Depends(get_db),
) -> PaperOut:
    """更新论文元数据，只更新请求体中出现的字段。"""
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})

    # exclude_unset=True：只取客户端真正传了的字段，
    # 否则未传的字段会被当成 None 覆盖掉已有数据
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise InvalidRequest("请求体为空，没有可更新的字段")

    await paper_service.update_paper(db, paper, **fields)
    await db.commit()
    await db.refresh(paper)
    return PaperOut.model_validate(paper)


@router.delete("/{paper_id}", response_model=Ok, summary="删除论文")
async def delete_paper(
    paper_id: str,
    remove_file: bool = Query(
        default=False, description="是否同时删除已落盘的 PDF 文件"
    ),
    db: AsyncSession = Depends(get_db),
) -> Ok:
    """删除论文记录。默认保留物理文件，便于误删后恢复。"""
    deleted = await paper_service.delete_paper(
        db, paper_id, remove_stored_file=remove_file
    )
    if not deleted:
        raise NotFound("论文不存在", {"paper_id": paper_id})
    await db.commit()
    return Ok(ok=True)


# ---------------------------------------------------------------- 正文分块


@router.get("/{paper_id}/chunks", response_model=ChunksResponse, summary="论文正文分块")
async def list_chunks(
    paper_id: str,
    lang: str = Query("zh", description="要附带译文的目标语言"),
    db: AsyncSession = Depends(get_db),
) -> ChunksResponse:
    """按序号返回这篇论文的全部分块（可附带译文）。

    前端阅读器用它按章节渲染真实正文。返回的是检索用的块
    （约 700 字符、相邻块带重叠），因此相邻块可能重复少量文字。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})

    # 左连接取译文：没有译文的块 text_zh 为 None，前端据此决定显示原文
    rows = (await db.execute(
        select(Chunk, ChunkTranslation.text)
        .outerjoin(
            ChunkTranslation,
            (ChunkTranslation.chunk_id == Chunk.id)
            & (ChunkTranslation.lang == lang),
        )
        .where(Chunk.paper_id == paper_id)
        .order_by(Chunk.chunk_index)
    )).all()

    chunks = [
        ChunkOut(
            id=c.id,
            chunk_index=c.chunk_index,
            text=c.text,
            text_zh=zh,
            char_count=c.char_count,
            section_title=c.section_title,
            level=c.level,
            page_start=c.page_start,
            page_end=c.page_end,
            embedded=c.embedding is not None,
        )
        for c, zh in rows
    ]

    return ChunksResponse(
        paper_id=paper_id,
        page_count=paper.page_count,
        total_chunks=len(chunks),
        translated_chunks=sum(1 for c in chunks if c.text_zh),
        chunks=chunks,
    )


@router.post(
    "/{paper_id}/translate", response_model=TranslateResponse, summary="生成中文译文"
)
async def translate_paper(
    paper_id: str,
    payload: TranslateRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> TranslateResponse:
    """为尚未翻译的分块生成中文译文（按需调用，结果持久化）。

    与解析分开：翻译按量计费，只有用户真正需要对照阅读时才调用。
    支持 limit 分批推进，避免单次请求持续数分钟。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})

    req = payload or TranslateRequest()
    stats = await translate_service.translate_paper(
        db, paper_id,
        lang=req.lang, limit=req.limit, concurrency=req.concurrency,
    )
    await db.commit()

    if stats.total == 0 and stats.errors:
        # 没有可翻译的块且存在错误，说明是配置问题，明确告知
        raise LLMUnavailable(stats.errors[0])

    total, done = await translate_service.count_progress(db, paper_id, req.lang)

    return TranslateResponse(
        paper_id=paper_id,
        lang=req.lang,
        total=stats.total,
        translated=stats.translated,
        failed=stats.failed,
        chars=stats.chars,
        model=stats.model,
        progress=(total, done),
        errors=stats.errors,
    )


# ---------------------------------------------------------------- 向量化


@router.post("/{paper_id}/embed", response_model=EmbedResponse, summary="生成向量")
async def embed_paper(
    paper_id: str,
    payload: EmbedRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> EmbedResponse:
    """为这篇论文尚未嵌入的分块生成向量。

    与解析分开是为了让费用可控：解析免费且快，嵌入按量计费。
    未嵌入的论文仍可被 BM25 检索到，只是缺少语义召回能力。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise NotFound("论文不存在", {"paper_id": paper_id})

    limit = payload.limit if payload else None
    stats = await chunk_service.embed_pending(db, paper_id, limit=limit)
    await db.commit()

    if stats.total == 0 and stats.errors:
        # 没有可处理的块且存在错误，说明是配置或环境问题，明确告知
        raise EmbeddingUnavailable(stats.errors[0])

    return EmbedResponse(
        paper_id=paper_id,
        total=stats.total,
        embedded=stats.embedded,
        failed=stats.failed,
        dim=stats.dim,
        errors=stats.errors,
    )


