"""论文相关接口。

本层只负责 HTTP：解析请求、调用 service、组装响应、映射错误。
不写 SQL，也不做业务判断。
"""
from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import InvalidRequest, NotFound, UploadTooLarge
from app.core.logging import get_logger
from app.db.session import get_db
from app.models.paper import Paper
from app.schemas.common import Ok, Page
from app.schemas.paper import (
    DuplicateInfo,
    PaperCreateResult,
    PaperOut,
    PaperUpdate,
    UploadResponse,
)
from app.services import paper_service
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


