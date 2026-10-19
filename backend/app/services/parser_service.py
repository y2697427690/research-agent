"""解析服务：把 pdf_parser 的结果落库，并维护解析状态机。

状态流转：
    queued → parsing → done
                     ↘ failed        （解析抛异常）
                     ↘ need_review  （解析成功但置信度低，如扫描件）

关于并发：parse_pdf 是 CPU 密集的同步函数（541 页书籍约 11 秒），
必须用 anyio.to_thread.run_sync 丢到线程池执行。实测直接调用会让
事件循环阻塞 833ms，而走线程池时其它请求仍能在 64ms 内得到响应。
"""

from __future__ import annotations

from dataclasses import dataclass

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.paper import Paper
from app.services import chunk_service, paper_service
from app.services.pdf_parser import ParsedDocument, parse_pdf

logger = get_logger(__name__)

# 置信度低于此值即标记为需人工校对
REVIEW_THRESHOLD = 0.6

# ---------------------------------------------------------------- 状态说明
#
# 解析状态机（Paper.parse_status）流转：
#
#     queued ──开始解析──> parsing ──成功且质量好──> done
#                              │
#                              ├──成功但质量低/扫描件──> need_review
#                              └──抛异常──────────────> failed
#
# 各状态含义：
#     queued       排队中，已入库但尚未解析
#     parsing      解析中
#     done         解析成功且置信度达标
#     need_review  解析完成但质量低，或判定为扫描件，需人工校对
#     failed       解析过程出错，原因写入 Paper.parse_error
#
# 两个入口的分工：
#     parse_paper          给「接口」调用。出错直接抛出，由接口层接住并返回给用户；
#                          不自己提交事务，由接口层统一提交。
#     parse_paper_safely   给「后台任务」调用。后台任务抛出的异常无人接收，
#                          因此必须自己捕获、回滚并写入 failed 状态，
#                          否则论文会永久停留在 parsing。

@dataclass
class ParseOutcome:
    """一次解析的结果摘要。"""

    paper_id: str
    status: str
    quality: float
    page_count: int
    section_count: int
    reference_count: int
    is_scanned: bool
    warnings: list[str]


async def _parse_in_thread(path: str) -> ParsedDocument:
    """在线程池里执行同步解析，避免阻塞事件循环。"""
    return await anyio.to_thread.run_sync(parse_pdf, path)


def _apply_result(paper: Paper, doc: ParsedDocument) -> None:
    """把解析结果写进 ORM 对象（不提交事务）。"""
    paper.page_count = doc.page_count
    paper.quality = doc.quality
    paper.title = doc.title or paper.title
    paper.abstract = doc.abstract or paper.abstract

    # 标记需要校对的两种情形：置信度低，或判定为扫描件
    paper.parse_status = "need_review" if (doc.needs_review or doc.quality < REVIEW_THRESHOLD) else "done"
    paper.parse_error = None if paper.parse_status == "done" else "; ".join(doc.warnings)[:1000]


async def parse_paper(db: AsyncSession, paper_id: str) -> ParseOutcome:
    """解析指定论文并更新数据库状态。

    调用方负责提交事务与处理异常；本函数只负责状态流转与写字段。
    """
    paper = await paper_service.get_paper(db, paper_id)
    if paper is None:
        raise ValueError(f"论文不存在：{paper_id}")

    # 状态：进入解析中
    paper.parse_status = "parsing"
    paper.parse_error = None
    await db.flush()

    abs_path = settings.storage_dir / paper.file_path
    logger.info("开始解析 %s（%s）", paper_id, abs_path)

    doc = await _parse_in_thread(str(abs_path))
    _apply_result(paper, doc)
    await db.flush()

    # 解析成功后立刻切块入库，检索侧才能马上用上这篇论文的正文。
    # 切块失败不应让已经成功的解析作废，因此单独兜住异常。
    chunk_count = 0
    try:
        chunk_count = await chunk_service.replace_chunks(db, paper_id, doc)
    except Exception:                             # noqa: BLE001 切块失败不致命
        logger.exception("切块失败 %s（解析结果仍然保留）", paper_id)

    logger.info(
        "解析结束 %s: status=%s quality=%.2f 页数=%d 章节=%d 参考文献=%d 分块=%d",
        paper_id, paper.parse_status, doc.quality, doc.page_count,
        len(doc.sections), len(doc.references), chunk_count,
    )
    return ParseOutcome(
        paper_id=paper_id,
        status=paper.parse_status,
        quality=doc.quality,
        page_count=doc.page_count,
        section_count=len(doc.sections),
        reference_count=len(doc.references),
        is_scanned=doc.is_scanned,
        warnings=doc.warnings,
    )


async def parse_paper_safely(db: AsyncSession, paper_id: str) -> ParseOutcome | None:
    """后台任务用的包装：自行处理异常并把失败写入数据库。

    后台任务没有请求上下文，异常若抛出会无人接收，
    因此这里必须自己兜住并落到 parse_status='failed'。
    """
    try:
        outcome = await parse_paper(db, paper_id)
        await db.commit()
        return outcome
    except Exception as exc:                      # noqa: BLE001 后台任务需兜住全部异常
        await db.rollback()
        logger.exception("解析失败 %s", paper_id)
        # 单独开一次事务记录失败原因
        paper = await paper_service.get_paper(db, paper_id)
        if paper is not None:
            paper.parse_status = "failed"
            paper.parse_error = f"{type(exc).__name__}: {exc}"[:1000]
            await db.commit()
        return None
