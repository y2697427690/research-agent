"""核实 FastAPI 后端的核心依赖是否真的可用（不猜测，只测实际 API）。"""
import sys, importlib, json, traceback

print("Python", sys.version.split()[0])
print("=" * 66)

def ver(mod):
    try:
        m = importlib.import_module(mod)
        return getattr(m, "__version__", "?")
    except Exception as e:
        return "IMPORT-FAIL: %s" % e

print("【版本实测】")
for m in ["fastapi", "starlette", "pydantic", "uvicorn", "sqlalchemy", "aiosqlite",
          "pymupdf", "openai", "httpx", "tenacity", "orjson", "arxiv", "apscheduler",
          "pytest", "numpy", "pandas", "alembic", "pydantic_settings", "greenlet"]:
    print("  %-18s %s" % (m, ver(m)))

print()
print("【缺失检查】")
for m in ["pydantic_settings", "alembic", "greenlet", "multipart", "pytest_asyncio"]:
    try:
        importlib.import_module(m)
        print("  OK    " + m)
    except Exception as e:
        print("  缺失  %-18s %s" % (m, type(e).__name__))

print()
print("【FastAPI 最小可用性】")
try:
    from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
    from fastapi.responses import StreamingResponse, ORJSONResponse
    from pydantic import BaseModel, Field, ConfigDict, SecretStr
    from fastapi.testclient import TestClient

    class Item(BaseModel):
        name: str = Field(min_length=1)
        n: int = Field(default=1, ge=1, le=10)

    app = FastAPI()

    @app.post("/echo", response_model=Item)
    async def echo(it: Item):
        return it

    @app.post("/up")
    async def up(f: UploadFile = File(...)):
        data = await f.read()
        return {"name": f.filename, "size": len(data), "magic": data[:5].decode("latin-1")}

    @app.get("/sse")
    async def sse():
        async def gen():
            yield b"event: token\ndata: {\"t\":\"hi\"}\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    c = TestClient(app)
    r = c.post("/echo", json={"name": "ok", "n": 3}); print("  POST /echo       ", r.status_code, r.json())
    r = c.post("/echo", json={"name": "", "n": 99});  print("  校验失败用例      ", r.status_code, "（应为 422）")
    r = c.post("/up", files={"f": ("a.pdf", b"%PDF-1.7 hello", "application/pdf")})
    print("  上传(multipart)   ", r.status_code, r.json())
    r = c.get("/sse"); print("  SSE 流            ", r.status_code, r.headers.get("content-type"), repr(r.text[:40]))
    print("  OpenAPI 生成      ", "OK" if "openapi" in c.get("/openapi.json").json() else "FAIL")
except Exception:
    print("  FastAPI 测试失败：")
    traceback.print_exc()

print()
print("【PyMuPDF 解析实测】")
try:
    import pymupdf
    print("  pymupdf 版本:", pymupdf.__version__)
    p = r"D:\Desktop\科研小助手\pdf\1706.03762v1.pdf"
    import os
    if os.path.exists(p):
        doc = pymupdf.open(p)
        print("  页数:", doc.page_count)
        page = doc[0]
        t = page.get_text()
        print("  第 1 页文本长度:", len(t))
        print("  首行:", repr(t.strip().splitlines()[0][:70]) if t.strip() else "(空)")
        d = page.get_text("dict")
        spans = [sp for b in d["blocks"] if b["type"] == 0 for l in b["lines"] for sp in l["spans"]]
        print("  span 数:", len(spans))
        if spans:
            s = spans[0]
            print("  首个 span: size=%.1f font=%s bbox=%s" % (s["size"], s["font"], [round(x, 1) for x in s["bbox"]]))
        try:
            tabs = page.find_tables()
            print("  find_tables():", len(tabs.tables), "个表格")
        except Exception as e:
            print("  find_tables() 不可用:", type(e).__name__, e)
        print("  图片数:", len(page.get_images()))
        doc.close()
    else:
        print("  测试 PDF 不存在（跳过）")

    # 顺带测中文 PDF（需求文件就是中文 + Type3 位图字体，最能压测解析能力）
    p2 = r"D:\Desktop\科研小助手\科研小助手Agent-AI大模型.pdf"
    if os.path.exists(p2):
        doc2 = pymupdf.open(p2)
        txt = "".join(doc2[i].get_text() for i in range(doc2.page_count))
        print("  中文需求 PDF: %d 页, 抽出 %d 字" % (doc2.page_count, len(txt)))
        print("  片段:", repr(txt.strip()[:80]))
        doc2.close()
except Exception:
    traceback.print_exc()

print()
print("【openai SDK 3.x 兼容性】")
try:
    import openai, inspect
    print("  openai", openai.__version__)
    from openai import AsyncOpenAI
    sig = inspect.signature(AsyncOpenAI.__init__)
    print("  AsyncOpenAI 参数:", ", ".join(list(sig.parameters)[:8]))
    print("  有 chat.completions.create:", hasattr(AsyncOpenAI(api_key="x").chat.completions, "create"))
    # 关键：流式调用签名是否仍然支持 stream=True
    from openai.resources.chat.completions import AsyncCompletions
    ps = list(inspect.signature(AsyncCompletions.create).parameters)
    need = [k for k in ("model", "messages", "stream", "temperature", "response_format") if k in ps]
    print("  create() 支持的关键参数:", need)
except Exception:
    traceback.print_exc()

print()
print("【SQLAlchemy 2.x async 实测】")
try:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
    from sqlalchemy import String, select, event
    import asyncio

    class Base(DeclarativeBase):
        pass

    class P(Base):
        __tablename__ = "p"
        id: Mapped[str] = mapped_column(String(16), primary_key=True)
        title: Mapped[str] = mapped_column(String(200))

    async def main():
        eng = create_async_engine("sqlite+aiosqlite:///:memory:")

        @event.listens_for(eng.sync_engine, "connect")
        def _pragma(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        mk = async_sessionmaker(eng, expire_on_commit=False)
        async with mk() as s:
            s.add(P(id="p-1", title="Attention Is All You Need"))
            await s.commit()
        async with mk() as s:
            row = (await s.execute(select(P).where(P.id == "p-1"))).scalar_one()
            print("  写入并读回:", row.id, row.title)
        await eng.dispose()

    asyncio.run(main())
except Exception:
    traceback.print_exc()

print()
print("=" * 66)
print("核实完毕")
