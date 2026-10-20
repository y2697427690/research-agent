"""检索链路测试：融合、向量索引、混合检索、分块入库。

关键设计：所有涉及嵌入的地方都用 monkeypatch 替换为确定性假向量，
测试不访问网络，也不会消耗嵌入额度。
"""
import numpy as np
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.db.session as db_session
from app.core.config import settings
from app.services import chunk_service, embedding, retrieval
from app.services.bm25 import IndexedChunk
from app.services.fusion import RRF_K, rrf_fuse
from app.services.vector_store import (
    VectorIndex,
    normalize_rows,
    pack_vectors,
    unpack_vectors,
)

# ---------------------------------------------------------------- RRF


def test_rrf_fuse_both_sources_beat_single_source():
    """两路都靠前的文档，必须高于只在单路第一的文档。"""
    fused = rrf_fuse({"bm25": ["X", "Y"], "vector": ["Y", "Z"]})
    scores = {doc: s for doc, s, _ in fused}
    assert scores["Y"] > scores["X"]
    assert scores["Y"] > scores["Z"]


def test_rrf_fuse_scores_match_formula():
    """分数应为 Σ 1/(k+rank)。"""
    fused = rrf_fuse({"bm25": ["A", "B"], "vector": ["B", "A"]})
    scores = {doc: s for doc, s, _ in fused}
    expected = round(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 6)
    assert scores["A"] == pytest.approx(expected, abs=1e-6)
    assert scores["A"] == pytest.approx(scores["B"], abs=1e-6)


def test_rrf_fuse_high_rank_in_one_source_is_penalized():
    """一路第一但另一路极差，应低于两路都稳定的文档。"""
    fused = rrf_fuse({
        "bm25": ["TOP", "B", "C"],
        "vector": ["B"] + [f"filler{i}" for i in range(50)] + ["TOP"],
    })
    scores = {doc: s for doc, s, _ in fused}
    assert scores["B"] > scores["TOP"]


def test_rrf_fuse_reports_ranks_and_respects_top_k():
    fused = rrf_fuse({"bm25": ["A", "B", "C"]}, top_k=2)
    assert len(fused) == 2
    doc, score, ranks = fused[0]
    assert doc == "A"
    assert ranks == {"bm25": 1}


def test_rrf_fuse_empty_and_invalid():
    assert rrf_fuse({}) == []
    assert rrf_fuse({"bm25": []}) == []
    with pytest.raises(ValueError):
        rrf_fuse({"bm25": ["A"]}, k=0)


# ---------------------------------------------------------------- 向量索引


def test_pack_unpack_roundtrip():
    vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
    back = unpack_vectors(pack_vectors(vectors), 3)
    assert np.allclose(back, np.array(vectors, dtype=np.float32))


def test_unpack_rejects_dimension_mismatch():
    blob = pack_vectors([[0.1, 0.2, 0.3]])
    with pytest.raises(ValueError):
        unpack_vectors(blob, 4)


def test_normalize_rows_produces_unit_length():
    m = normalize_rows(np.array([[3.0, 4.0], [0.0, 0.0]], dtype=np.float32))
    assert float(np.linalg.norm(m[0])) == pytest.approx(1.0)
    # 全零行不能变成 nan
    assert np.allclose(m[1], [0.0, 0.0])


def test_vector_index_orders_by_similarity():
    chunks = [IndexedChunk(f"c{i}", "p1", f"t{i}") for i in range(3)]
    m = np.array([[1, 0], [0.9, 0.1], [0, 1]], dtype=np.float32)
    idx = VectorIndex()
    idx.build(chunks, m)
    ranked = idx.search([1.0, 0.0], top_k=3)
    assert [i for i, _ in ranked] == [0, 1]
    assert ranked[0][1] > ranked[1][1]


def test_vector_index_rejects_dimension_mismatch():
    idx = VectorIndex()
    idx.build([IndexedChunk("c0", "p1", "t")], np.array([[1.0, 0.0]], dtype=np.float32))
    with pytest.raises(ValueError):
        idx.search([1.0, 0.0, 0.0])


def test_vector_index_zero_query_returns_empty():
    idx = VectorIndex()
    idx.build([IndexedChunk("c0", "p1", "t")], np.array([[1.0, 0.0]], dtype=np.float32))
    assert idx.search([0.0, 0.0]) == []


def test_vector_index_build_validates_row_count():
    idx = VectorIndex()
    with pytest.raises(ValueError):
        idx.build(
            [IndexedChunk("c0", "p1", "t")],
            np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
        )


# ---------------------------------------------------------------- 数据库夹具

# 假向量：块 0 指向 x 轴，块 1 指向 y 轴。
# 这样「查询向量」就能确定性地决定排序，不受真实模型影响。
FAKE_EMBEDDING = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)

CHUNKS = [
    # 含 attention，BM25 能命中
    ("c0", "multi-head attention computes several heads in parallel", 1, "3.2 Attention", []),
    # 不含 word/order，BM25 无法命中，只能靠向量
    ("c1", "positional encoding injects sequence information", 2, "3.5 Encoding", [1]),
]


@pytest.fixture
async def db_session_fixture(tmp_path, monkeypatch):
    """独立的内存数据库，两个分块：c0 有向量、c1 也有向量。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", maker)

    from app.db.base import Base
    from app.models import chunk, paper  # noqa: F401
    from app.models.chunk import Chunk
    from app.models.paper import Paper

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with maker() as session:
        session.add(Paper(
            id="p1", sha1="a" * 40, file_name="t.pdf", file_path="t.pdf", size_bytes=1
        ))
        await session.flush()
        vecs = {
            "c0": FAKE_EMBEDDING[0],
            "c1": FAKE_EMBEDDING[1],
        }
        for chunk_id, text, page, section, _ in CHUNKS:
            session.add(Chunk(
                id=chunk_id, paper_id="p1", chunk_index=int(chunk_id[1]),
                text=text, char_count=len(text), section_title=section,
                page_start=page, page_end=page,
                embedding=pack_vectors([vecs[chunk_id].tolist()]),
                embedding_model=settings.embedding_model,
            ))
        await session.commit()

    retrieval.invalidate()
    yield maker
    await engine.dispose()
    retrieval.invalidate()


@pytest.fixture(autouse=True)
def _reset_cache():
    retrieval.invalidate()
    yield
    retrieval.invalidate()


# ---------------------------------------------------------------- 混合检索


async def test_retrieve_hybrid_uses_both_sources(db_session_fixture, monkeypatch):
    """BM25 与向量都命中时，mode=hybrid，来源应包含两者。"""
    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [1.0, 0.0]        # 与 c0 同向

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    async with db_session_fixture() as db:
        result = await retrieval.retrieve(db, "attention", top_k=5)

    assert result.mode == "hybrid"
    assert result.hits
    assert result.hits[0].chunk_id == "c0"
    assert "bm25" in result.hits[0].sources
    assert result.degraded_reason is None


async def test_retrieve_finds_chunk_that_bm25_cannot(db_session_fixture, monkeypatch):
    """查询词在正文里不存在时，只有向量能召回——这是混合检索的核心价值。"""
    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [0.0, 1.0]        # 与 c1 同向

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    async with db_session_fixture() as db:
        result = await retrieval.retrieve(db, "word order", top_k=5)

    # BM25 完全没有命中，只剩向量一路，因此 mode 为 vector
    assert result.mode == "vector"
    assert result.hits
    assert result.hits[0].chunk_id == "c1"
    assert result.hits[0].sources == ["vector"]


async def test_retrieve_degrades_when_embedding_unavailable(db_session_fixture, monkeypatch):
    """未配置嵌入模型时降级为纯 BM25，并说明原因。"""
    monkeypatch.setattr(embedding, "is_available", lambda: False)

    async with db_session_fixture() as db:
        result = await retrieval.retrieve(db, "attention", top_k=5)

    assert result.mode == "bm25"
    assert result.hits
    assert result.hits[0].sources == ["bm25"]
    assert result.degraded_reason is not None


async def test_retrieve_degrades_when_embedding_raises(db_session_fixture, monkeypatch):
    """嵌入调用抛异常时不能中断检索，必须降级。"""
    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def boom(text: str):
        raise RuntimeError("网络炸了")

    monkeypatch.setattr(embedding, "embed_one", boom)

    async with db_session_fixture() as db:
        result = await retrieval.retrieve(db, "attention", top_k=5)

    assert result.mode == "bm25"
    assert result.degraded_reason and "网络炸了" in result.degraded_reason


async def test_retrieve_allow_vector_false_forces_bm25(db_session_fixture, monkeypatch):
    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [0.0, 1.0]

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    async with db_session_fixture() as db:
        result = await retrieval.retrieve(db, "attention", allow_vector=False)

    assert result.mode == "bm25"
    assert result.vector_candidates == 0


async def test_retrieve_empty_query_and_empty_index(db_session_fixture):
    async with db_session_fixture() as db:
        assert (await retrieval.retrieve(db, "   ")).mode == "empty"
        # 无任何命中时为 empty（索引为空或问题完全无关）
        assert (await retrieval.retrieve(db, "zzz-nonexistent-xyz")).mode in (
            "bm25", "hybrid", "vector", "empty")


async def test_index_cache_rebuilds_on_data_change(db_session_fixture):
    from app.models.chunk import Chunk

    async with db_session_fixture() as db:
        first = await retrieval.retrieve(db, "attention")
        assert first.hits
        # 新增一个分块后，签名变化应触发重建
        db.add(Chunk(
            id="c9", paper_id="p1", chunk_index=9, text="attention extra content",
            char_count=23, section_title="New", page_start=9, page_end=9,
        ))
        await db.commit()
        retrieval.invalidate()
        second = await retrieval.retrieve(db, "attention")
        assert second.hits


async def test_hit_citation_format(db_session_fixture, monkeypatch):
    monkeypatch.setattr(embedding, "is_available", lambda: False)
    async with db_session_fixture() as db:
        result = await retrieval.retrieve(db, "attention")
    hit = result.hits[0]
    assert "第" in hit.citation and "页" in hit.citation
    assert hit.section_title in hit.citation


# ---------------------------------------------------------------- 分块入库


async def test_replace_chunks_writes_and_is_idempotent(db_session_fixture):
    from app.services.pdf_parser import ParsedDocument, Section

    doc = ParsedDocument(page_count=2)
    doc.page_texts = {
        1: "第一章正文内容。" * 60,
        2: "第二章正文内容。" * 60,
    }
    doc.sections = [Section(level=1, title="第一章", page_no=1),
                    Section(level=1, title="第二章", page_no=2)]

    async with db_session_fixture() as db:
        n1 = await chunk_service.replace_chunks(db, "p1", doc)
        await db.commit()
        assert n1 > 0

        # 重复执行不应累加
        n2 = await chunk_service.replace_chunks(db, "p1", doc)
        await db.commit()
        assert n2 == n1

        total, embedded = await chunk_service.count_chunks(db, "p1")
        # 注意原有 2 个测试分块已被替换掉
        assert total == n1


async def test_embed_pending_marks_and_counts(db_session_fixture, monkeypatch):
    """尚未嵌入的块应被批量嵌入，并记录模型名。"""
    from app.models.chunk import Chunk

    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_texts(texts):
        return [[0.5, 0.5] for _ in texts]

    monkeypatch.setattr(embedding, "embed_texts", fake_embed_texts)

    async with db_session_fixture() as db:
        db.add(Chunk(id="c7", paper_id="p1", chunk_index=7, text="not embedded yet",
                     char_count=16, section_title="X", page_start=7, page_end=7))
        await db.commit()

        stats = await chunk_service.embed_pending(db, "p1")
        await db.commit()

    assert stats.total == 1
    assert stats.embedded == 1
    assert stats.failed == 0
    assert stats.dim == 2


async def test_embed_pending_without_key_reports_error(db_session_fixture, monkeypatch):
    monkeypatch.setattr(embedding, "is_available", lambda: False)
    async with db_session_fixture() as db:
        stats = await chunk_service.embed_pending(db)
    assert stats.embedded == 0
    assert stats.errors


# ---------------------------------------------------------------- HTTP 层


def test_search_index_endpoint():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        resp = client.get("/api/v1/search/index")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {"chunks", "embedded", "embedding_available", "mode_hint"}


def test_search_endpoint_validates_query():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        assert client.post("/api/v1/search", json={"query": ""}).status_code == 422
        assert client.post("/api/v1/search", json={"query": "x", "top_k": 0}).status_code == 422

# ---------------------------------------------------------------- 关键词信息量过滤


async def test_bm25_skipped_when_only_common_terms_match(tmp_path, monkeypatch):
    """语料足够大时，若 BM25 只命中「到处都有」的词，应跳过该路并写入原因。

    场景来自实测：问句里带了一个在整篇论文中反复出现的模型名，
    BM25 用这个通用词凑出一堆无关候选，在 RRF 里把向量检索的正确答案挤下去。
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    from app.models.chunk import Chunk
    from app.models.paper import Paper
    from app.services.vector_store import pack_vectors

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", maker)

    from app.db.base import Base
    from app.models import chunk, paper  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 30 个块，每块都含 "transformer"（通用词），只有 1 块含真正的答案词
    texts = [f"transformer block number {i} about a common topic" for i in range(29)]
    texts.insert(5, "transformer encoder stacks composed of two sub-layers each")

    async with maker() as session:
        session.add(Paper(id="p9", sha1="b" * 40, file_name="t.pdf",
                          file_path="t.pdf", size_bytes=1))
        await session.flush()
        for i, text in enumerate(texts):
            session.add(Chunk(
                id=f"k{i}", paper_id="p9", chunk_index=i, text=text,
                char_count=len(text), section_title=f"S{i}",
                page_start=i + 1, page_end=i + 1,
                embedding=pack_vectors([[1.0, 0.0]]),
                embedding_model=settings.embedding_model,
            ))
        await session.commit()

    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [1.0, 0.0]

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    retrieval.invalidate()
    async with maker() as db:
        # 只含通用词的查询：BM25 会命中 29 个块，但没有任何区分度
        result = await retrieval.retrieve(db, "transformer", top_k=5)
    await engine.dispose()
    retrieval.invalidate()

    assert result.mode == "vector"
    assert result.bm25_candidates == 0
    assert result.degraded_reason is not None
    assert "高频词" in result.degraded_reason


async def test_bm25_kept_when_specific_term_matches(tmp_path, monkeypatch):
    """命中罕见词时，关键词检索应当保留。"""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    from app.models.chunk import Chunk
    from app.models.paper import Paper
    from app.services.vector_store import pack_vectors

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", maker)

    from app.db.base import Base
    from app.models import chunk, paper  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    texts = [f"transformer block number {i} about a common topic" for i in range(29)]
    texts.insert(7, "dropout regularization is applied to sub-layer outputs")

    async with maker() as session:
        session.add(Paper(id="p8", sha1="c" * 40, file_name="t.pdf",
                          file_path="t.pdf", size_bytes=1))
        await session.flush()
        for i, text in enumerate(texts):
            session.add(Chunk(
                id=f"j{i}", paper_id="p8", chunk_index=i, text=text,
                char_count=len(text), section_title=f"S{i}",
                page_start=i + 1, page_end=i + 1,
                embedding=pack_vectors([[1.0, 0.0]]),
                embedding_model=settings.embedding_model,
            ))
        await session.commit()

    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [1.0, 0.0]

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    retrieval.invalidate()
    async with maker() as db:
        result = await retrieval.retrieve(db, "dropout regularization", top_k=5)
    await engine.dispose()
    retrieval.invalidate()

    assert result.mode == "hybrid"
    assert result.bm25_candidates > 0

async def test_replace_chunks_preserves_embeddings_of_unchanged_text(db_session_fixture, monkeypatch):
    """重新解析时，块文本未变的向量必须复用，避免重复消耗嵌入额度。

    分块过程是确定性的：同一份内容重新解析得到完全相同的块文本，
    因此已有向量可以直接搬过去。若不保留，每次重新解析都要重新付费嵌入。
    """
    from app.models.chunk import Chunk
    from app.services.pdf_parser import ParsedDocument, Section

    doc = ParsedDocument(page_count=2)
    doc.page_texts = {1: "第一章正文内容。" * 60, 2: "第二章正文内容。" * 60}
    doc.sections = [Section(level=1, title="第一章", page_no=1),
                    Section(level=1, title="第二章", page_no=2)]

    async with db_session_fixture() as db:
        n1 = await chunk_service.replace_chunks(db, "p1", doc)
        await db.commit()

        # 模拟已嵌入
        rows = (await db.execute(select(Chunk).where(Chunk.paper_id == "p1"))).scalars().all()
        assert len(rows) == n1
        for r in rows:
            r.embedding = pack_vectors([[0.1, 0.2]])
            r.embedding_model = settings.embedding_model
        await db.commit()

        # 重新解析同一份内容
        n2 = await chunk_service.replace_chunks(db, "p1", doc)
        await db.commit()
        assert n2 == n1

        again = (await db.execute(select(Chunk).where(Chunk.paper_id == "p1"))).scalars().all()
        assert len(again) == n1
        kept = sum(1 for r in again if r.embedding is not None)
        assert kept == n1, f"文本未变的块应保留向量，实际保留 {kept} / {n1}"


# ---------------------------------------------------------------- 多篇对比

async def test_retrieve_filters_by_paper_ids(tmp_path, monkeypatch):
    """指定 paper_ids 时只能返回这些论文的片段。"""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    from app.models.chunk import Chunk
    from app.models.paper import Paper
    from app.services.vector_store import pack_vectors

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", maker)

    from app.db.base import Base
    from app.models import chunk, citation, paper, translation  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with maker() as session:
        for pid in ("pA", "pB"):
            session.add(Paper(id=pid, sha1=(pid * 20)[:40], file_name=pid + ".pdf",
                              file_path="x.pdf", size_bytes=1))
        await session.flush()
        for i in range(3):
            session.add(Chunk(id=f"pA-c{i}", paper_id="pA", chunk_index=i,
                              text=f"layer normalization detail {i}",
                              char_count=30, section_title="S", page_start=1, page_end=1,
                              embedding=pack_vectors([[1.0, 0.0]]),
                              embedding_model=settings.embedding_model))
            session.add(Chunk(id=f"pB-c{i}", paper_id="pB", chunk_index=i,
                              text=f"attention mechanism detail {i}",
                              char_count=30, section_title="S", page_start=1, page_end=1,
                              embedding=pack_vectors([[1.0, 0.0]]),
                              embedding_model=settings.embedding_model))
        await session.commit()

    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [1.0, 0.0]

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    retrieval.invalidate()
    async with maker() as db:
        only_a = await retrieval.retrieve(db, "layer normalization", top_k=6,
                                          paper_ids=["pA"])
        both = await retrieval.retrieve(db, "layer normalization", top_k=6,
                                        paper_ids=["pA", "pB"])
    await engine.dispose()
    retrieval.invalidate()

    assert only_a.hits
    assert {h.paper_id for h in only_a.hits} == {"pA"}
    # 两篇都指定时，两边都要有片段，否则对比无从谈起
    assert {h.paper_id for h in both.hits} == {"pA", "pB"}


async def test_retrieve_applies_per_paper_quota(tmp_path, monkeypatch):
    """语义最贴近的那篇不得占满全部名额（按论文配额抽取）。"""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    from app.models.chunk import Chunk
    from app.models.paper import Paper
    from app.services.vector_store import pack_vectors

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", maker)

    from app.db.base import Base
    from app.models import chunk, citation, paper, translation  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with maker() as session:
        for pid in ("pX", "pY"):
            session.add(Paper(id=pid, sha1=(pid * 20)[:40], file_name=pid + ".pdf",
                              file_path="x.pdf", size_bytes=1))
        await session.flush()
        # pX 的向量与查询完全一致（会被大量召回）；pY 的向量弱一些
        for i in range(20):
            session.add(Chunk(id=f"pX-c{i}", paper_id="pX", chunk_index=i,
                              text=f"normalization text {i}", char_count=30,
                              section_title="S", page_start=1, page_end=1,
                              embedding=pack_vectors([[1.0, 0.0]]),
                              embedding_model=settings.embedding_model))
        session.add(Chunk(id="pY-c0", paper_id="pY", chunk_index=0,
                          text="other content", char_count=20,
                          section_title="S", page_start=1, page_end=1,
                          embedding=pack_vectors([[0.6, 0.8]]),
                          embedding_model=settings.embedding_model))
        await session.commit()

    monkeypatch.setattr(embedding, "is_available", lambda: True)

    async def fake_embed_one(text: str):
        return [1.0, 0.0]

    monkeypatch.setattr(embedding, "embed_one", fake_embed_one)

    retrieval.invalidate()
    async with maker() as db:
        result = await retrieval.retrieve(db, "normalization", top_k=4,
                                          paper_ids=["pX", "pY"])
    await engine.dispose()
    retrieval.invalidate()

    papers = {h.paper_id for h in result.hits}
    assert "pY" in papers, "弱相关的那篇也必须进入上下文，否则无法对比"
    counts = {}
    for h in result.hits:
        counts[h.paper_id] = counts.get(h.paper_id, 0) + 1
    assert counts["pX"] <= 2, "按配额每篇最多约 top_k/篇数 条"
