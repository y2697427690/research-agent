"""paper_service 的测试：文件落盘 + 数据库读写 + 去重联动。"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.services import paper_service


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """每个测试用独立的内存数据库与独立的存储目录。"""
    # 把存储目录指到临时目录，避免污染真实 data/papers
    monkeypatch.setattr(settings, "storage_dir", tmp_path / "papers")

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session

    await engine.dispose()


PDF_A = b"%PDF-1.4\n" + b"A" * 2000
PDF_A_TWEAKED = b"%PDF-1.4\n" + b"A" * 2000 + b"\n%%EOF\n"   # 同一篇，内容略有差异
PDF_B = b"%PDF-1.4\n" + b"B" * 3000


async def test_save_upload_writes_file_and_hash(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", tmp_path / "papers")
    up = paper_service.save_upload("1706.03762v1.pdf", PDF_A)

    import hashlib
    assert up.sha1 == hashlib.sha1(PDF_A).hexdigest()
    assert up.size_bytes == len(PDF_A)
    assert up.abs_path.exists()
    assert up.abs_path.read_bytes() == PDF_A
    # 路径形如 202610/<sha 前缀>_原名
    assert "1706.03762v1.pdf" in up.rel_path


async def test_save_upload_does_not_overwrite_same_name(tmp_path, monkeypatch):
    """同名不同内容必须落到不同文件，不能互相覆盖。"""
    monkeypatch.setattr(settings, "storage_dir", tmp_path / "papers")
    a = paper_service.save_upload("paper.pdf", PDF_A)
    b = paper_service.save_upload("paper.pdf", PDF_B)
    assert a.abs_path != b.abs_path
    assert a.abs_path.read_bytes() == PDF_A
    assert b.abs_path.read_bytes() == PDF_B


async def test_create_and_get_paper(db):
    up = paper_service.save_upload("1706.03762v1.pdf", PDF_A)
    paper = await paper_service.create_paper(db, uploaded=up, file_name="1706.03762v1.pdf")

    assert paper.id.startswith("p-")
    assert paper.parse_status == "queued"
    assert paper.arxiv_id == "1706.03762"

    fetched = await paper_service.get_paper(db, paper.id)
    assert fetched is not None
    assert fetched.file_name == "1706.03762v1.pdf"


async def test_duplicate_detection_via_service(db):
    """官方用例：先传 v1，再传 v7 -> newer_version。"""
    up1 = paper_service.save_upload("1706.03762v1.pdf", PDF_A)
    await paper_service.create_paper(db, uploaded=up1, file_name="1706.03762v1.pdf")

    up2, verdict = await paper_service.detect_new_paper(
        db, file_name="1706.03762v7.pdf", data=PDF_B
    )
    assert verdict.kind == "newer_version"
    assert verdict.existing is not None
    assert verdict.existing.file_name == "1706.03762v1.pdf"


async def test_identical_detection_via_service(db):
    up1 = paper_service.save_upload("1706.03762v1.pdf", PDF_A)
    await paper_service.create_paper(db, uploaded=up1, file_name="1706.03762v1.pdf")

    _, verdict = await paper_service.detect_new_paper(
        db, file_name="完全不同的名字.pdf", data=PDF_A
    )
    assert verdict.kind == "identical"


async def test_scan_copy_detection_via_service(db):
    """扫描件 1706.03762v1_img.pdf 应与 v1 原版匹配。"""
    up1 = paper_service.save_upload("1706.03762v1.pdf", PDF_A)
    await paper_service.create_paper(db, uploaded=up1, file_name="1706.03762v1.pdf")

    up2, verdict = await paper_service.detect_new_paper(
        db, file_name="1706.03762v1_img.pdf", data=PDF_B
    )
    assert verdict.kind == "likely_duplicate"
    assert verdict.existing.file_name == "1706.03762v1.pdf"


async def test_list_papers_pagination_and_filter(db):
    for i in range(5):
        up = paper_service.save_upload(f"paper{i}.pdf", PDF_A + bytes([i]))
        paper = await paper_service.create_paper(db, uploaded=up, file_name=f"paper{i}.pdf")
        if i % 2 == 0:
            paper.starred = True
    await db.flush()

    items, total = await paper_service.list_papers(db, page=1, page_size=2)
    assert total == 5
    assert len(items) == 2

    items2, total2 = await paper_service.list_papers(db, page=3, page_size=2)
    assert total2 == 5
    assert len(items2) == 1

    starred, total_starred = await paper_service.list_papers(db, starred=True)
    assert total_starred == 3

    hit, total_hit = await paper_service.list_papers(db, keyword="paper3")
    assert total_hit == 1


async def test_page_size_is_capped(db):
    items, _ = await paper_service.list_papers(db, page_size=99999)
    # 只是不应报错；上限在内部生效
    assert isinstance(items, list)


async def test_update_paper_rejects_unknown_field(db):
    up = paper_service.save_upload("a.pdf", PDF_A)
    paper = await paper_service.create_paper(db, uploaded=up, file_name="a.pdf")

    await paper_service.update_paper(db, paper, title="新标题", starred=True)
    assert paper.title == "新标题"
    assert paper.starred is True

    with pytest.raises(ValueError):
        await paper_service.update_paper(db, paper, id="hacked")


async def test_delete_paper_keeps_file_by_default(db):
    up = paper_service.save_upload("a.pdf", PDF_A)
    paper = await paper_service.create_paper(db, uploaded=up, file_name="a.pdf")
    pid, path = paper.id, up.abs_path

    assert await paper_service.delete_paper(db, pid) is True
    assert await paper_service.get_paper(db, pid) is None
    assert path.exists(), "默认不应删除物理文件"

    # 再删一次应返回 False
    assert await paper_service.delete_paper(db, pid) is False


async def test_delete_paper_with_file(db):
    up = paper_service.save_upload("a.pdf", PDF_A)
    paper = await paper_service.create_paper(db, uploaded=up, file_name="a.pdf")
    pid, path = paper.id, up.abs_path

    assert await paper_service.delete_paper(db, pid, remove_stored_file=True) is True
    assert not path.exists()


async def test_find_by_sha1(db):
    up = paper_service.save_upload("a.pdf", PDF_A)
    paper = await paper_service.create_paper(db, uploaded=up, file_name="a.pdf")

    found = await paper_service.find_by_sha1(db, up.sha1)
    assert found is not None and found.id == paper.id
    assert await paper_service.find_by_sha1(db, "0" * 40) is None


async def test_count_by_status(db):
    up = paper_service.save_upload("a.pdf", PDF_A)
    await paper_service.create_paper(db, uploaded=up, file_name="a.pdf")
    up2 = paper_service.save_upload("b.pdf", PDF_B)
    p2 = await paper_service.create_paper(db, uploaded=up2, file_name="b.pdf")
    p2.parse_status = "done"
    await db.flush()

    counts = await paper_service.count_by_status(db)
    assert counts.get("queued") == 1
    assert counts.get("done") == 1
