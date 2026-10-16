"""论文接口的 HTTP 层测试。

1. 内存 SQLite 默认「每条连接一个独立实例」，必须用 StaticPool 让连接共享，
   否则接口拿到的连接看不到建表连接创建的表（表现为 no such table）。
2. 必须在 import app.main 之前替换 db.session 里的 engine 与 SessionLocal，
   这样 lifespan 建表与接口查询都走测试库，真实数据库文件完全不被触碰。
"""
import pathlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.db.session as db_session
from app.core.config import settings

PDF_V1 = b"%PDF-1.4\n" + b"A" * 2000
PDF_V7 = b"%PDF-1.4\n" + b"B" * 3000
PDF_SCAN = b"%PDF-1.4\n" + b"C" * 5000


@pytest.fixture
def client(tmp_path, monkeypatch):
    # 上传的文件写到临时目录，不污染真实 data/papers
    monkeypatch.setattr(settings, "storage_dir", pathlib.Path(tmp_path) / "papers")

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # 让 lifespan 与接口都使用测试引擎
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", maker)

    async def _override_get_db():
        async with maker() as session:
            yield session

    from app.db.session import get_db
    from app.main import app

    app.dependency_overrides[get_db] = _override_get_db
    # monkeypatch.setattr(db_session, "engine", engine) 只改模块变量，
    # main.lifespan 里是 import engine 取的同一对象，因此同样生效
    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def _upload(client: TestClient, files, force: bool = False):
    return client.post(
        f"/api/v1/papers/upload?force={str(force).lower()}",
        files=[("files", (name, data, "application/pdf")) for name, data in files],
    )


# ---------------------------------------------------------------- 上传


def test_upload_single_pdf(client):
    r = _upload(client, [("1706.03762v1.pdf", PDF_V1)])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] == 1
    assert body["duplicates"] == 0
    paper = body["results"][0]["paper"]
    assert paper["arxiv_id"] == "1706.03762"
    assert paper["parse_status"] == "queued"
    assert paper["file_name"] == "1706.03762v1.pdf"


def test_upload_identical_is_rejected(client):
    _upload(client, [("1706.03762v1.pdf", PDF_V1)])
    body = _upload(client, [("改了个名字.pdf", PDF_V1)]).json()
    assert body["accepted"] == 0
    assert body["duplicates"] == 1
    dup = body["results"][0]["duplicate"]
    assert dup["kind"] == "identical"
    assert "完全相同" in dup["message"]


def test_official_case_v1_then_v7(client):
    """官方用例：先传 v1 再传 v7 -> 检出更新版本，默认不入库。"""
    _upload(client, [("1706.03762v1.pdf", PDF_V1)])
    body = _upload(client, [("1706.03762v7.pdf", PDF_V7)]).json()
    assert body["duplicates"] == 1
    dup = body["results"][0]["duplicate"]
    assert dup["kind"] == "newer_version"
    assert dup["existing_file_name"] == "1706.03762v1.pdf"
    assert "更新" in dup["message"]
    # 默认不入库
    assert client.get("/api/v1/papers").json()["total"] == 1


def test_force_upload_creates_record(client):
    _upload(client, [("1706.03762v1.pdf", PDF_V1)])
    body = _upload(client, [("1706.03762v7.pdf", PDF_V7)], force=True).json()
    assert body["accepted"] == 1
    assert body["results"][0]["duplicate"]["kind"] == "newer_version"
    assert client.get("/api/v1/papers").json()["total"] == 2


def test_upload_scanned_copy_detected(client):
    _upload(client, [("1706.03762v1.pdf", PDF_V1)])
    body = _upload(client, [("1706.03762v1_img.pdf", PDF_SCAN)]).json()
    assert body["results"][0]["duplicate"]["kind"] == "likely_duplicate"


def test_upload_multiple_files_mixed(client):
    _upload(client, [("1706.03762v1.pdf", PDF_V1)])
    body = _upload(client, [
        ("新论文.pdf", PDF_V7),
        ("1706.03762v1.pdf", PDF_V1),
    ]).json()
    assert body["accepted"] == 1
    assert body["duplicates"] == 1
    assert len(body["results"]) == 2


def test_upload_rejects_empty_file(client):
    body = _upload(client, [("empty.pdf", b"")]).json()
    assert body["accepted"] == 0
    assert body["failed"] == 1
    assert "空文件" in body["results"][0]["error"]


# ---------------------------------------------------------------- 查询


def test_list_papers_pagination(client):
    for i in range(3):
        _upload(client, [(f"p{i}.pdf", PDF_V1 + bytes([i]))])
    lst = client.get("/api/v1/papers?page=1&page_size=2").json()
    assert lst["total"] == 3
    assert len(lst["items"]) == 2
    assert lst["page"] == 1
    assert lst["page_size"] == 2


def test_list_papers_keyword(client):
    _upload(client, [("attention.pdf", PDF_V1)])
    _upload(client, [("其他.pdf", PDF_V7)])
    lst = client.get("/api/v1/papers?keyword=attention").json()
    assert lst["total"] == 1
    assert lst["items"][0]["file_name"] == "attention.pdf"


def test_get_paper_detail_and_404(client):
    pid = _upload(client, [("a.pdf", PDF_V1)]).json()["results"][0]["paper"]["id"]
    ok = client.get(f"/api/v1/papers/{pid}")
    assert ok.status_code == 200
    assert ok.json()["id"] == pid

    missing = client.get("/api/v1/papers/p-not-exist")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


def test_stats_reflects_database(client):
    assert client.get("/api/v1/papers/stats").json()["papers"] == 0
    _upload(client, [("a.pdf", PDF_V1)])
    s = client.get("/api/v1/papers/stats").json()
    assert s["papers"] == 1
    assert s["parsed"] == 0
    assert s["by_status"].get("queued") == 1


# ---------------------------------------------------------------- 修改与删除


def test_patch_paper_only_updates_given_fields(client):
    pid = _upload(client, [("a.pdf", PDF_V1)]).json()["results"][0]["paper"]["id"]

    body = client.patch(f"/api/v1/papers/{pid}", json={"title": "新标题"}).json()
    assert body["title"] == "新标题"
    # 未传的字段不应被清空 —— PATCH 的经典坑
    assert body["file_name"] == "a.pdf"
    assert body["sha1"]

    body2 = client.patch(f"/api/v1/papers/{pid}", json={"starred": True}).json()
    assert body2["starred"] is True
    assert body2["title"] == "新标题"


def test_patch_rejects_bad_year(client):
    pid = _upload(client, [("a.pdf", PDF_V1)]).json()["results"][0]["paper"]["id"]
    r = client.patch(f"/api/v1/papers/{pid}", json={"year": 99999})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_patch_empty_body_rejected(client):
    pid = _upload(client, [("a.pdf", PDF_V1)]).json()["results"][0]["paper"]["id"]
    r = client.patch(f"/api/v1/papers/{pid}", json={})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_delete_then_404(client):
    pid = _upload(client, [("a.pdf", PDF_V1)]).json()["results"][0]["paper"]["id"]
    assert client.delete(f"/api/v1/papers/{pid}").status_code == 200
    assert client.get(f"/api/v1/papers/{pid}").status_code == 404
    assert client.delete(f"/api/v1/papers/{pid}").status_code == 404
