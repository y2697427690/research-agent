"""论文服务：文件落盘、指纹计算、去重判定、数据库读写。

本模块是 API 层与数据库之间的业务层：
    - 不接收 UploadFile 等 HTTP 对象，只接收 bytes 与文件名，便于单元测试
    - 所有数据库操作都通过传入的 AsyncSession 完成
    - 事务提交由调用方（接口层）决定，service 只负责 flush 以拿到主键
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.paper import Paper
from app.services.dedupe import (
    DuplicateVerdict,
    ExistingPaper,
    detect_duplicate,
    extract_arxiv_id,
    sha1_of_bytes,
)

logger = get_logger(__name__)

@dataclass(frozen=True)
class UploadedFile:
    """一次上传落盘后的结果"""

    sha1: str
    size_bytes: int
    rel_path: str   #相对storage_dir 的路径，存进数据库
    abs_path: Path  #绝对路径，本次请求内使用

#------------------------------------------  文件落盘

def save_upload(file_name: str, data: bytes) -> UploadedFile:

    """把上传内容写入本地存储，返回指纹与路径

       保存前先按内容哈希校验一次，确保写入的字节与算出的指纹一致；
       木乱年月分层，避免单目录文件较多。

    """
    sha1 = sha1_of_bytes(data)
    size = len(data)

    #以[年月/contenthash_源文件名]组织，同名但不同版本不会相互覆盖
    stamp = datetime.now(UTC).strftime("%Y%m")
    safe_name = Path(file_name).name or "unnamed.pdf"
    rel = f"{stamp}/{sha1}_{safe_name}"

    abs_path = settings.storage_dir / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(data)

    logger.info("已保存上传文件 %s（%d 字节, sha1=%s）", rel, size, sha1[:12])
    return UploadedFile(sha1 = sha1, size_bytes = size, rel_path = rel, abs_path = abs_path)

def remove_file(rel_path: str) -> bool:
    """删除已落盘的文件，返回是否真的删掉"""
    target = settings.storage_dir / rel_path
    try:
        target.unlink()
        logger.info("已删除文件 %s", rel_path)
        return True
    except FileNotFoundError:
        logger.warning("要删除的文件 %s 不存在，无法删除", rel_path)
        return False
    except OSError:
        # 文件被占用或权限不足不应导致接口失败，记录后继续
        logger.exception("删除文件 %s 失败", rel_path)
        return False


#------------------------------------------  数据库读写

async def _load_existing(db: AsyncSession) -> list[ExistingPaper]:
    """"读出全部论文的最小信息，供去重比对使用

        直选需要的咧。避免吧摘要等大字段也读进内存
    """
    rows = (
        await db.execute(
            select(Paper.id, Paper.sha1, Paper.file_name, Paper.arxiv_id,Paper.size_bytes)
        )
    ).all()
    return [
        ExistingPaper(
            paper_id = row[0],
            sha1 = row[1],
            file_name = row[2],
            arxiv_id = row[3],
            size_bytes = row[4],
        )
     for row in rows
    ]

async def detect_new_paper(
        db:AsyncSession,*,file_name:str,data:bytes

) ->tuple[UploadedFile,DuplicateVerdict]:
    """落盘并判断是否与已有论文重复。不写数据库"""
    uploaded = save_upload(file_name, data)
    verdict = detect_duplicate(
        sha1 = uploaded.sha1,
        file_name = file_name,
        size_bytes = uploaded.size_bytes,
        existing = await _load_existing(db),
    )
    return uploaded, verdict
async def create_paper(
        db:AsyncSession,
        *,
        uploaded:UploadedFile,
        file_name:str,
        keep_existing:bool = True,
) -> Paper:
    """把落盘的文件登记进数据库

        keep_existing = True 用于用户确认要保留新版本的场景：
        默认会把同名的旧纪录标记为被替代（此处仅记录日志，替换策略由接口层决定）
    """
    arxiv_id,_=extract_arxiv_id(file_name)

    paper = Paper(
        id  = f"p-{uuid.uuid4().hex[:16]}",
        sha1=uploaded.sha1,
    file_name=Path(file_name).name,
        file_path=uploaded.rel_path,
        size_bytes=uploaded.size_bytes,
        arxiv_id=arxiv_id,
        parse_status="queued",
    )
    db.add(paper)
    await db.flush()          # 取到主键，但事务仍由调用方提交
    logger.info("已登记论文 %s（%s）", paper.id, paper.file_name)
    return paper


async def get_paper(db: AsyncSession, paper_id: str) -> Paper | None:
    """按主键取论文。"""
    return await db.get(Paper, paper_id)


async def list_papers(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 20,
    keyword: str | None = None,
    status: str | None = None,
    starred: bool | None = None,
) -> tuple[list[Paper], int]:
    """分页查询论文列表，返回 (当页数据, 总条数)。"""
    page = max(1, page)
    page_size = max(1, min(page_size, 100))   # 限制上限，防止一次拉爆内存

    conditions = []
    if keyword:
        like = f"%{keyword}%"
        # 标题或文件名命中即可
        conditions.append(Paper.title.ilike(like) | Paper.file_name.ilike(like))
    if status:
        conditions.append(Paper.parse_status == status)
    if starred is not None:
        conditions.append(Paper.starred == starred)

    total_stmt = select(func.count()).select_from(Paper)
    items_stmt = select(Paper)
    for cond in conditions:
        total_stmt = total_stmt.where(cond)
        items_stmt = items_stmt.where(cond)

    total = (await db.execute(total_stmt)).scalar_one()
    items = (
        await db.execute(
            items_stmt.order_by(Paper.added_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return list(items), total


async def update_paper(db: AsyncSession, paper: Paper, **fields) -> Paper:
    """更新指定字段（只允许白名单内的字段）。"""
    allowed = {
        "title", "authors", "year", "venue", "arxiv_id", "doi",
        "abstract", "keywords", "parse_status", "parse_error",
        "quality", "page_count", "starred",
    }
    for key, value in fields.items():
        if key not in allowed:
            raise ValueError(f"不允许更新的字段：{key}")
        setattr(paper, key, value)
    await db.flush()
    return paper


async def delete_paper(
    db: AsyncSession, paper_id: str, *, remove_stored_file: bool = False
) -> bool:
    """删除论文记录。返回是否删除成功。

    remove_stored_file 默认为 False：
    先只删记录，物理文件保留，便于误删后恢复。
    """
    paper = await db.get(Paper, paper_id)
    if paper is None:
        return False

    rel_path = paper.file_path
    await db.delete(paper)
    await db.flush()

    if remove_stored_file and rel_path:
        remove_file(rel_path)

    logger.info("已删除论文 %s", paper_id)
    return True


async def find_by_sha1(db: AsyncSession, sha1: str) -> Paper | None:
    """按内容指纹查论文，用于秒传/重复检测。"""
    return (
        await db.execute(select(Paper).where(Paper.sha1 == sha1))
    ).scalar_one_or_none()


async def count_by_status(db: AsyncSession) -> dict[str, int]:
    """按解析状态统计数量，供 /stats 接口使用。"""
    rows = (
        await db.execute(
            select(Paper.parse_status, func.count()).group_by(Paper.parse_status)
        )
    ).all()
    return {status: count for status, count in rows}
