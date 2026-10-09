# 后端设计方案 v2（FastAPI）

> 状态：**待评审**（本文件只有设计，尚无对应代码）
> 目标：为已完成的 [`research-assistant`](../README.md) 前端补 FastAPI 后端，逐条覆盖需求 1.1~1.6，并把前端从 mock 数据切到真实 API。
> 大模型：**OpenAI 兼容 API**（DeepSeek / OpenAI / 本地 vLLM 均可，只换 `base_url`）。
> v2 相对 v1 的变化：技术栈从「纯标准库」改为 **FastAPI + Pydantic v2 + SQLAlchemy 2.0(async)**；
> 校验、路由、文档、DI 全部交给框架，代码量和出错面大幅减少。

---

## 0. 依赖可行性（本机已实测，非推测）

### 0.1 网络与安装

| 检查项 | 实测结果 |
| --- | --- |
| DNS `pypi.org` | ✅ 151.101.192.223（54 ms） |
| HTTPS `https://pypi.org/simple/` | ✅ 200（241 ms） |
| 清华镜像 `pypi.tuna.tsinghua.edu.cn` | ✅ 200（1243 ms，备用源） |
| **`pip install fastapi uvicorn[standard] pydantic`** | ✅ **成功** |

> v1 里「pip 会卡住」的判断是错的——那是我第一次尝试时没指定 `--timeout/--retries` 导致的，不是网络问题。此处更正。

### 0.2 版本实测（这是环境里真实装上的版本，方案按此写）

| 包 | 实测版本 | 说明 |
| --- | --- | --- |
| fastapi | **0.143.0** | |
| starlette | 1.7.0 | FastAPI 底层 |
| pydantic | **2.14.1** | v2 API |
| pydantic-settings | 2.15.0 | 读 `.env` |
| uvicorn | 0.54.0 | |
| SQLAlchemy | **2.1.4** | 2.1 新于 2.0，API 兼容 |
| aiosqlite | 0.22.1 | |
| **greenlet** | 3.5.6 | ⚠️ 见 0.3 |
| alembic | 1.20.0 | |
| PyMuPDF | **1.28.2** | ⚠️ 见 0.3 |
| openai | **3.29.0** | ⚠️ 见 0.3 |
| httpx | 0.28.1 | |
| tenacity / orjson / arxiv / APScheduler | 9.2.1 / 3.13.0 / 4.0.1 / 3.11.3 | |
| pytest / pytest-asyncio / respx | 9.1.1 / 1.4.0 / 0.23.1 | |
| numpy / pandas | 2.3.5 / 3.0.1 | 已装 |

### 0.3 实测踩到的三个坑（都已解决，写进方案避免重犯）

**坑 1：`SQLAlchemy` 的 async 需要 `greenlet`，但它不是自动依赖**

```
ImportError: The SQLAlchemy asyncio module requires that the Python 'greenlet' library is installed.
```

只 `pip install SQLAlchemy` 是不够的，必须 `pip install "SQLAlchemy[asyncio]"`（或显式装 greenlet）。
**这条会让后端在 import 阶段就崩**，所以 `pyproject.toml` 里必须写 `SQLAlchemy[asyncio]`，不能写 `SQLAlchemy`。

**坑 2：PyMuPDF 1.28 起 `import fitz` 已废弃**

```
warning: The `fitz` API is deprecated and will be removed in future. Use `import pymupdf` instead.
```

新代码一律 `import pymupdf`，不要用 `import fitz`。
另外 `page.find_tables()` 会提示官方建议装 `pymupdf_layout` 以获得更好的版面分析——
**是否引入 `pymupdf_layout` 列为待决项**（见 §13 第 6 条）。

**坑 3：`openai` 装成了 3.29.0（跨大版本）**

已实测确认**仍兼容**我们需要的用法：

| 检查 | 结果 |
| --- | --- |
| `from openai import AsyncOpenAI` | ✅ |
| `client.chat.completions.create(...)` | ✅ 存在 |
| 支持的关键参数 | ✅ `model` / `messages` / `stream` / `temperature` / `response_format` 全在 |
| `AsyncOpenAI.__init__` 参数 | `api_key, admin_api_key, workload_identity, organization, project, webhook_secret, provider` |

但 pyproject 里**不写死 3.x 的通配版本**，而是用 `openai>=1.54,<4`，
并在 `llm/client.py` 里做一次启动自检（启动时调一次极短的请求，失败则降级到 fallback 适配器）。

### 0.4 核心能力端到端实测（不是「应该能」，是「已经跑通」）

**FastAPI 框架能力**

| 能力 | 实测 |
| --- | --- |
| POST JSON + Pydantic v2 校验 | ✅ 正常请求 200 |
| 校验失败自动 422 | ✅ 返回 422（不用手写校验器） |
| `UploadFile` + multipart 上传 | ✅ 读到文件名/大小/magic（`%PDF-` 校验可行） |
| `StreamingResponse` + `text/event-stream` | ✅ `200 text/event-stream`，SSE 文本格式正确可解析 |
| `/openapi.json` 自动生成 | ✅ |
| TestClient（用于集成测试） | ✅ |

**PyMuPDF 解析能力**

| 测试对象 | 实测结果 |
| --- | --- |
| `1706.03762v1.pdf`（15 页英文论文） | ✅ 第 1 页抽出 **2719 字**，首行 `Attention Is All You Need` |
| span 级信息 | ✅ **219 个 span**，含 `size=17.2 font=NimbusRomNo9L-Medi bbox=[211.5,99.8,399.9,117.0]` → **字号/字体/坐标齐全，版面分析可行** |
| `科研小助手Agent-AI大模型.pdf`（7 页中文，Type3 位图字体） | ✅ 抽出 **4301 字**，且**标题层级保留**：`科研小助手Agent` / `1. 产品功能` / `1.1 PDF文件管理和解析` / `基本的CRUD操作…` |
| `page.find_tables()` | ⚠️ 该页返回 0 个表格（第 1 页本就无表格；官方提示装 `pymupdf_layout` 可增强） |

> **关键结论**：连那份「Type3 位图字体 + 中文 + 需要 ActualText 才能还原字符」的硬骨头 PDF，
> PyMuPDF 都能一次抽出 4301 字并保留标题层级——**这正是我在 v1 方案里要手写几百行才能做到的事**。
> 选 PyMuPDF 的判断被实测证实。

**SQLAlchemy 2.1 async + aiosqlite**

| 能力 | 实测 |
| --- | --- |
| `Mapped` / `mapped_column` 声明式模型 | ✅ |
| `create_async_engine("sqlite+aiosqlite:///:memory:")` | ✅ |
| `PRAGMA journal_mode=WAL` 事件钩子 | ✅ 生效 |
| `async_sessionmaker` 写入 → 提交 → 读回 | ✅ `p-1 Attention Is All You Need` |

**结论：FastAPI 路线全部前置条件已验证通过，可以直接开工。**

---

## 1. 技术选型

### 1.1 依赖清单（含取舍理由）

```toml
# pyproject.toml   —— 版本号为本机实测可用的版本
[project]
name = "research-assistant-backend"
requires-python = ">=3.11"
dependencies = [
  # ---- Web 框架 ----
  "fastapi>=0.143,<1",          # 自带 OpenAPI/Swagger，Pydantic v2 校验
  "uvicorn[standard]>=0.54",    # ASGI server
  "pydantic>=2.14,<3",          # 请求/响应模型
  "pydantic-settings>=2.15",    # 从 .env 读配置（API Key 只走环境变量）
  "python-multipart>=0.0.32",   # 文件上传
  "orjson>=3.13",               # 更快的 JSON 序列化（ORJSONResponse）

  # ---- 数据层 ----
  "SQLAlchemy[asyncio]>=2.1,<3",  # ⚠️ 必须带 [asyncio]，否则 greenlet 缺失 → import 就崩
  "aiosqlite>=0.22",
  "alembic>=1.20",               # 迁移（从一开始就有 schema 版本）

  # ---- PDF 解析 ----
  "PyMuPDF>=1.28",             # ★ 主力：文字+坐标+字号+字体+图片+find_tables，一次拿全
  "pypdf>=5.1",                # 备选：PyMuPDF 失败时降级

  # ---- HTTP / LLM ----
  "httpx>=0.28",
  "openai>=1.54,<4",           # OpenAI 兼容（DeepSeek 也用它）；3.x 已实测兼容
  "tenacity>=9.2",

  # ---- 定时任务 ----
  "APScheduler>=3.11",

  # ---- 工具 ----
  "numpy>=2.0", "pandas>=2.2", "arxiv>=2.1",
]

[project.optional-dependencies]
# 向量检索：默认不装（会拉进 torch，约 2 GB）。要开混合检索时装：
vectors = ["sentence-transformers>=3.3", "torch>=2.2"]
dev = ["pytest>=9.1", "pytest-asyncio>=1.4", "respx>=0.23", "httpx>=0.28", "ruff>=0.7"]
```

**为什么这些而不是别的**

| 选择 | 备选 | 理由 |
| --- | --- | --- |
| **FastAPI** | Flask / Django | 你指定；且自带 Pydantic 校验 + OpenAPI 文档，正好省掉 v1 里手写的 `validate.py` |
| **PyMuPDF** | pypdf / pdfplumber | PyMuPDF 一次调用就能拿到「文字+坐标+字号+字体名+图片」，**版面分析必需**；pypdf 拿不到字号和可靠坐标。pypdf 留作降级 |
| **SQLAlchemy 2.0 async** | 裸 aiosqlite / Tortoise | 表多（16 张）且关系复杂，ORM 能省掉大量手写 SQL；async 与 FastAPI 天然配合 |
| **SQLite + aiosqlite** | PostgreSQL | 单机演示足够；SQLAlchemy 抽象层让将来换 PG 只改连接串 + 迁移脚本 |
| **httpx** | requests | 原生 async，与 FastAPI 同事件循环；也能用于 TestClient |
| **openai SDK** | 手写 httpx 调 `/chat/completions` | SDK 已处理好 SSE 流式解析、重试、超时；DeepSeek 完全兼容 |
| **不引入 Celery/Redis** | Celery + Redis | 单机部署没必要。解析任务用 `asyncio.create_task` + `jobs` 表状态机，重启可续跑（见 §6.5）。要横向扩展时再换 |
| **不引入 alembic 之外的重型依赖** | — | 保持容器小、启动快 |

### 1.2 一个必须讲清的性能陷阱

FastAPI 是 async 的，但 **PDF 解析、sentence-transformers 推理都是 CPU 密集且阻塞的**。
如果在 `async def` 里直接调用，会把整个事件循环卡死（所有请求一起变慢）。

规则（写进代码规范，评审时按这条检查）：

```python
# ❌ 错误：阻塞事件循环，其它请求全部排队
@app.post("/api/papers")
async def upload(file: UploadFile):
    text = fitz.open(...).get_text()      # C 扩展，阻塞！

# ✅ 正确：CPU 密集丢线程池
from anyio import to_thread
text = await to_thread.run_sync(parse_pdf_sync, path)
```

同理：`sentence-transformers` 的 `encode()`、`numpy` 大矩阵运算、`hashlib` 大文件哈希全部走
`to_thread.run_sync` 或 `run_in_executor`。

---

## 2. 架构

```
┌────────────────────────────────────────────────────────────────────────┐
│  浏览器（research-assistant 前端，已完成，待接 API）                     │
└───────────────────────────┬────────────────────────────────────────────┘
                            │ fetch / EventSource(SSE)
┌───────────────────────────▼────────────────────────────────────────────┐
│  ui 层  FastAPI app                                                     │
│   /docs  /redoc  /openapi.json   ← 自动生成，评审可直接点开调接口         │
│   CORS 中间件 · GZip 中间件 · 请求日志中间件 · 全局异常处理器             │
│   Pydantic v2 模型校验（请求体/查询参数/响应体，全部有类型）              │
│   依赖注入：get_db() / get_llm() / get_current_user() / get_settings()   │
├────────────────────────────────────────────────────────────────────────┤
│  api/v1 路由层（只做「取参数 → 调 service → 组装响应」，不写业务）        │
│   papers · uploads · duplicates · retrieve · qa · translate             │
│   graph · discover · writing · jobs · stats · health                    │
├────────────────────────────────────────────────────────────────────────┤
│  services 业务层（纯 Python，可脱离 FastAPI 单测）                       │
│   parser/   PDF 结构化解析（PyMuPDF 主力 + pypdf 降级）                  │
│   dedupe · chunker · index(BM25) · retrieve(混合) · qa(RAG)             │
│   translate · graph · discover · writing · jobs(worker)                 │
├────────────────────────────────────────────────────────────────────────┤
│  llm 层  LLMClient（openai SDK）+ 任务级模型路由 + 重试 + 计费 + 降级     │
├────────────────────────────────────────────────────────────────────────┤
│  数据层  SQLAlchemy 2.0 async ORM  →  SQLite(WAL) / 可换 PostgreSQL      │
│          文件系统：原始 PDF · 抽取图片 · 向量缓存(.npy)                  │
│          Alembic 管理 schema 版本                                       │
└────────────────────────────────────────────────────────────────────────┘
```

**分层纪律**（评审要点）：`api/` 里不出现 SQL；`services/` 里不出现 `Request`/`HTTPException`；
`models/` 里不做业务判断。这样 `services/` 可以被 pytest 直接调用，前端没写完也能先测后端。

---

## 3. 目录结构

```
backend/
├── pyproject.toml
├── .env.example                     ← 提交进仓库（不含真 Key）
├── .gitignore                       ← 忽略 .env / data/ / __pycache__
├── README.md                        ← 起服务、跑测试、配置说明
├── alembic.ini
├── alembic/versions/                ← 迁移脚本
│
├── app/
│   ├── main.py                      ← create_app()：挂路由/中间件/异常处理/生命周期
│   ├── core/
│   │   ├── config.py                ← Settings(BaseSettings)，读 .env
│   │   ├── logging.py               ← 结构化日志（JSON 行）
│   │   ├── security.py              ← 上传白名单、路径校验、Key 打码
│   │   ├── exceptions.py            ← 业务异常基类 + 全局 handler → 统一错误信封
│   │   └── deps.py                  ← get_db / get_llm / get_settings / 分页参数
│   ├── db/
│   │   ├── base.py                  ← DeclarativeBase
│   │   ├── session.py               ← async engine + sessionmaker + WAL pragma
│   │   └── init.py                  ← 建表/迁移入口
│   ├── models/                      ← SQLAlchemy ORM（16 张表，见 §4）
│   │   ├── paper.py author.py section.py element.py ref.py citation.py
│   │   ├── chunk.py term.py chat.py duplicate.py job.py recommendation.py
│   ├── schemas/                     ← Pydantic v2（请求/响应，与前端 JSON 一一对应）
│   │   ├── paper.py block.py duplicate.py retrieval.py qa.py
│   │   ├── graph.py recommendation.py writing.py job.py common.py
│   ├── api/
│   │   ├── router.py                ← 汇总 v1 路由
│   │   └── v1/
│   │       ├── health.py  papers.py  uploads.py  duplicates.py
│   │       ├── retrieve.py qa.py translate.py graph.py
│   │       ├── discover.py writing.py jobs.py stats.py
│   ├── services/
│   │   ├── parser/
│   │   │   ├── engine.py            ← 入口：parse_pdf(path) -> ParsedDoc
│   │   │   ├── pymupdf_extract.py   ← 文字/坐标/字号/字体/图片
│   │   │   ├── pypdf_fallback.py    ← 降级解析器
│   │   │   ├── layout.py            ← 归行、单双栏检测、归段
│   │   │   ├── structure.py         ← 标题层级/表格/图注/公式/参考文献/附录
│   │   │   └── quality.py           ← 解析置信度打分
│   │   ├── dedupe.py  chunker.py  index.py  retrieve.py  qa.py
│   │   ├── translate.py  graph.py  discover.py  writing.py
│   │   └── jobs.py                  ← 任务状态机 + worker
│   ├── llm/
│   │   ├── client.py                ← 封装 openai.AsyncOpenAI（chat/stream/embed）
│   │   ├── router.py                ← 任务 → 模型/温度 映射
│   │   ├── json_mode.py             ← 强制 JSON + 三重容错解析
│   │   ├── fallback.py              ← 无 Key 降级（模板 + 抽取式）
│   │   └── prompts/*.txt            ← 提示词独立成文件，便于迭代与 A/B
│   └── utils/
│       ├── text.py                  ← 规范化、分词（英文词干 + 中文 n-gram）
│       ├── hashing.py               ← 分块 SHA1、SimHash、MinHash
│       └── files.py                 ← 原子写、临时文件、安全文件名
│
├── data/                            ← 运行时生成，.gitignore
│   ├── app.db  papers/  images/  vectors/
├── tests/
│   ├── conftest.py                  ← 内存 SQLite + TestClient fixture
│   ├── unit/                        ← 纯函数测试（parser/layout/dedupe/bm25）
│   └── integration/                 ← 需求第 2 节的 4 个测试场景各一条
└── docs/api.md                      ← 导出给不看 Swagger 的人
```

---

## 4. 数据库设计

SQLAlchemy 2.0 声明式风格，字段与前端 JSON 一一对应（`models.py ↔ schemas.py` 是**唯一**的映射处）。

```python
class Base(DeclarativeBase):
    pass

class Paper(Base):
    __tablename__ = "papers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)      # p-<sha1[:10]>
    sha1: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    file_name: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    size_bytes: Mapped[int]
    page_count: Mapped[int | None]
    scanned: Mapped[bool] = mapped_column(default=False)
    title: Mapped[str | None] = mapped_column(Text)
    title_zh: Mapped[str | None] = mapped_column(Text)
    abstract: Mapped[str | None] = mapped_column(Text)
    abstract_zh: Mapped[str | None] = mapped_column(Text)
    year: Mapped[int | None]
    venue: Mapped[str | None] = mapped_column(String(256))
    arxiv_id: Mapped[str | None] = mapped_column(String(64), index=True)
    version: Mapped[str | None] = mapped_column(String(32))            # v7 / v1 / v1-scan
    doi: Mapped[str | None] = mapped_column(String(128))
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    quality: Mapped[float | None]                                      # 0~1 解析置信度
    parse_status: Mapped[str] = mapped_column(String(16), default="queued")
    parse_error: Mapped[str | None] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(default=utcnow)
    parsed_at: Mapped[datetime | None]
    starred: Mapped[bool] = mapped_column(default=False)
    scan_group: Mapped[str | None] = mapped_column(String(64), index=True)  # 同论文版本归并键

    authors: Mapped[list["Author"]] = relationship(back_populates="paper", cascade="all, delete-orphan")
    sections: Mapped[list["Section"]] = relationship(cascade="all, delete-orphan")
    chunks: Mapped[list["Chunk"]] = relationship(cascade="all, delete-orphan")
```

完整表清单（16 张，字段定义见 `backend/app/models/`）：

| 表 | 作用 | 前端对应 |
| --- | --- | --- |
| `papers` | 论文主表 | `papers[]` 全部字段 |
| `authors` | 作者（保序 + 机构 + 通讯作者） | 解析详情「② 作者」 |
| `sections` | 章节树（1/2/3 级 + 页码） | 阅读器左侧目录 / 解析详情「④ 章节层级」 |
| `elements` | 表格 / 图 / 公式 / 列表 | 阅读器 `formula`/`table`/`figure` 块 |
| `refs` | 参考文献条目（含 `local_paper_id`） | 阅读器 References 的「库中已有原文」 |
| `citations` | 引用边（src→dst） | 引用图谱的 edges |
| `chunks` | 检索单元（含 page/section/kind + 可选向量） | RAG 的证据来源 |
| `terms` / `term_stats` / `corpus_stats` | BM25 倒排与统计 | — |
| `chats` / `messages` | 会话与消息（含 evidence JSON） | 问答页会话列表 + 消息流 |
| `dup_decisions` | 去重决策留痕 | 「覆盖/保留/都留」的结果 |
| `jobs` | 任务状态机 | 上传流水线进度条 |
| `recommendations` / `feedback` | 推荐与 👍👎 | 发现页 |
| `llm_calls` | LLM 调用审计（token/耗时） | `/api/stats` |

**索引策略**（容易漏，先写清楚）：

```sql
CREATE INDEX idx_papers_group   ON papers(scan_group);
CREATE INDEX idx_papers_status  ON papers(parse_status);
CREATE INDEX idx_sections_paper ON sections(paper_id, ord);
CREATE INDEX idx_elements_paper ON elements(paper_id, ord);
CREATE INDEX idx_chunks_paper   ON chunks(paper_id, ord);
CREATE INDEX idx_terms_term     ON terms(term);          -- BM25 命中的关键索引
CREATE INDEX idx_cit_dst        ON citations(dst_paper_id);
CREATE UNIQUE INDEX idx_fb      ON feedback(rec_id, user_id);
```

SQLite 连接初始化必须开 WAL（并发读的关键）：

```python
@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragma(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()
```

---

## 5. API 设计

### 5.1 FastAPI 带来的三个直接好处

1. **自动文档**：`/docs`（Swagger UI）、`/redoc`、`/openapi.json`。评审不用看文档就能点着调接口。
2. **自动校验**：Pydantic v2 模型一写，非法请求自动返回结构化 422，**不用手写校验器**。
3. **响应模型**：`response_model=PaperOut` 会过滤掉不该暴露的字段（例如 `file_path`），避免信息泄露。

统一响应与错误：

```python
# 正常：直接返回 Pydantic 模型（FastAPI 自动序列化，ORJSONResponse 提速）
# 错误：全局 handler 统一成
{ "error": { "code": "PAPER_NOT_FOUND", "message": "论文不存在", "detail": {"paper_id": "p-x"} } }
```

```python
class AppError(Exception):
    code = "INTERNAL_ERROR"; status = 500
    def __init__(self, message: str, detail: dict | None = None): ...

class NotFound(AppError): code = "NOT_FOUND";       status = 404
class Duplicate(AppError): code = "DUPLICATE_PAPER"; status = 409
class LLMUnavailable(AppError): code = "LLM_UNAVAILABLE"; status = 503
class ParseFailed(AppError): code = "PARSE_FAILED";  status = 422

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return ORJSONResponse(status_code=exc.status,
        content={"error": {"code": exc.code, "message": str(exc), "detail": exc.detail}})
```

### 5.2 接口清单（按 FastAPI 路由分组标注）

前缀 `/api/v1`。带 🔄 的是长任务（立即返回 `job_id`），带 🌊 的是 SSE 流式。

#### 论文管理（需求 1.1）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{ status, llm:{configured,model,reachable}, db, version }` |
| GET | `/papers` | 列表 `?q=&filter=all\|low\|scanned\|starred&sort=&page=&page_size=` → `Page[PaperOut]` |
| POST | `/papers` 🔄 | **批量上传**（`list[UploadFile]`，最多 10 个，单文件 ≤200 MB）→ `{ uploads:[{upload_id,file_name,status,job_id}] }` |
| GET | `/papers/{id}` | 详情（含作者、章节树、元素统计） |
| PATCH | `/papers/{id}` | 改元数据（前端元数据抽屉） |
| DELETE | `/papers/{id}` | 删除（级联 chunks/索引/边 + 删文件） |
| POST | `/papers/{id}/star` | 收藏切换 |
| POST | `/papers/{id}/reparse` 🔄 | 重新解析 |
| GET | `/papers/{id}/parse` | 解析详情（7 个分区数据） |
| GET | `/papers/{id}/content?lang=en\|zh` | 阅读器正文 `{ sections:[{id,title,blocks:[Block]}] }` |
| GET | `/papers/{id}/refs` | 参考文献（含 `local_paper_id`） |
| GET | `/papers/{id}/versions` | 同论文各版本 |

#### 去重（需求 1.1.1）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/duplicates` | 待处理重复组 |
| GET | `/duplicates/{upload_id}` | 相似度 + 判定类型 + **版本 diff** + `lib_is_newer` + `suggest` |
| POST | `/duplicates/{upload_id}/resolve` | `{action:"overwrite"\|"keep"\|"keep_both"}` |

#### 检索与问答（需求 1.2）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/retrieve` | 只检索（调参/调试）：`{q,paper_ids,top_k,mode} → {hits:[Evidence]}` |
| POST | `/qa/chat` 🌊 | SSE：`evidence → token* → citations → done` |
| POST | `/qa/verify` | 对已有回答逐句归因（哪句来自哪段原文） |
| GET/POST/DELETE | `/chats` `/chats/{id}` | 会话管理 |

#### 阅读与翻译（需求 1.3）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/translate/selection` | 划词/局部翻译 `{paper_id,text,context} → {zh}` |
| POST | `/translate/full` 🔄 | 整篇翻译 `{paper_id,mode:"markdown"\|"layout"}` |
| GET | `/papers/{id}/translation` | 段落级译文（`block_id` 与原文对齐） |
| GET | `/papers/{id}/paragraph-map` | 段落对齐表（**中英同步滚动靠它**） |

#### 图谱（需求 1.5）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/graph/build` 🔄 | 抽取引用关系构图 |
| GET | `/graph` | `{nodes:[{id,title,year,in_degree,out_degree,pagerank,betweenness,core}], edges:[...]}` |
| GET | `/graph/insights` | 基石 / 边缘衍生 + 判定依据 |
| POST | `/graph/summary` 🌊 | 自动综述（流式） |
| POST | `/graph/future-work` | 未来工作：先检索「谁做过」再给建议 |

#### 发现与推荐（需求 1.4）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/discover/download-by-name` 🔄 | 按标题下载入库 |
| POST | `/papers/{id}/refs/download` 🔄 | 批量下载参考文献 |
| POST | `/discover/fetch` 🔄 | 刷新 arXiv |
| GET | `/recommendations?tab=daily\|weekly\|interest` | 推荐列表 |
| POST | `/recommendations/{id}/vote` | `{vote:"up"\|"down"}` |
| POST | `/recommendations/{id}/add` 🔄 | 加入文库 |

#### 写作助手（需求 1.6）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/writing/outline` | 框架 + References 核验结果 |
| POST | `/writing/verify-refs` | 参考文献真实性核验（Crossref/arXiv） |
| POST | `/writing/diagram` | `{idea,format:"tikz"\|"graphviz"\|"mermaid"} → {code}` |
| POST | `/writing/dataset` | 上传 CSV → `{head,rows,numeric_cols,chart}` |
| POST | `/writing/caption` | `{dataset_id,x_col,y_col} → {caption}` |
| POST | `/writing/translate` | 中→英 |

#### 任务与系统

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/jobs/{job_id}` | 进度 `{status,done,total,message}` |
| GET | `/jobs?kind=parse` | 任务列表 |
| POST | `/jobs/{job_id}/cancel` | 取消 |
| GET | `/stats` | 工作台统计（含 LLM token 消耗） |
| GET | `/docs` `/redoc` `/openapi.json` | 框架自带 |

### 5.3 关键 Pydantic 模型（与前端字段严格对齐）

```python
# ---- 分页通用 ----
class Page(BaseModel, Generic[T]):
    items: list[T]; total: int; page: int; page_size: int

# ---- 论文 ----
class AuthorOut(BaseModel):
    ord: int; name: str; affiliation: str | None = None
    email: str | None = None; is_corresponding: bool = False

class PaperOut(BaseModel):
    id: str; file_name: str; title: str | None; title_zh: str | None
    authors: list[str]                    # 前端只用名字数组
    year: int | None; venue: str | None; arxiv_id: str | None
    version: str | None; pages: int | None; size_bytes: int
    quality: float | None; scanned: bool; starred: bool
    added_at: datetime; parsed_at: datetime | None
    sections: int; figures: int; tables: int; formulas: int; refs: int
    model_config = ConfigDict(from_attributes=True)   # ORM → JSON 自动转换

# ---- 阅读器 Block（与前端 reader.js 的 blockHtml 一一对应）----
class Block(BaseModel):
    id: str
    type: Literal["h1","h2","h3","p","list","formula","figure","table","reference"]
    en: str | None = None
    zh: str | None = None
    page: int | None = None
    cites: list[int] = []
    latex: str | None = None
    caption: str | None = None
    table: TableData | None = None        # {head:list[str], rows:list[list[str]], highlight_row:int|None}
    ref_no: int | None = None
    local_paper_id: str | None = None
    bbox: list[float] | None = None       # 用于「叠回原 PDF 页面」定位

# ---- 检索证据 ----
class Evidence(BaseModel):
    chunk_id: str; paper_id: str; paper_title: str
    page: int; section: str; kind: str
    text: str; score: float; relevance: float

# ---- 问答请求 ----
class ChatRequest(BaseModel):
    chat_id: str | None = None
    question: str = Field(min_length=1, max_length=2000)
    scope: Literal["single","multi"] = "single"
    paper_ids: list[str] = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    stream: bool = True

# ---- 去重 ----
class DiffItem(BaseModel):
    type: Literal["add","del","mod","same","warn"]; text: str

class DuplicateInfo(BaseModel):
    upload: UploadBrief; matched: PaperBrief
    similarity: float; kind: Literal["identical","version"]
    lib_is_newer: bool; suggest: Literal["overwrite","keep","keep_both"]
    diff: list[DiffItem]

# ---- 图谱 ----
class GraphNode(BaseModel):
    id: str; title: str; year: int | None
    in_degree: int; out_degree: int
    pagerank: float; betweenness: float
    core: Literal["foundation","frontier","peripheral","textbook","unknown"]
```

### 5.4 SSE 流式问答（FastAPI 实现要点）

```python
@router.post("/qa/chat")
async def qa_chat(req: ChatRequest, db=Depends(get_db), llm=Depends(get_llm)):
    hits = await retrieve_hybrid(db, req.question, req.paper_ids, req.top_k)

    async def gen():
        yield sse("evidence", {"hits": [h.model_dump() for h in hits]})
        acc = []
        async for tok in llm.stream(task="qa", messages=build_prompt(req.question, hits)):
            acc.append(tok)
            yield sse("token", {"t": tok})
        text = "".join(acc)
        ok, valid, invalid = verify_citations(text, len(hits))     # ★ 引用校验
        await save_message(db, req.chat_id, "assistant", text, hits, ok)
        yield sse("citations", {"checked": True, "valid": valid, "invalid": invalid})
        yield sse("done", {"message_id": mid})

    return StreamingResponse(gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {orjson.dumps(data).decode()}\n\n"
```

**必须注意**：`StreamingResponse` 里不要再依赖 `Depends(get_db)` 的请求级 session——
请求头已经返回后 session 可能被关闭。做法是**在生成器内部**用 `async_session_maker()` 新开一个 session
（或用 `BackgroundTask` 落库）。这个坑很常见，写进代码规范。

---

## 6. 核心算法（与 v1 相同，此处只列关键决策与伪码）

### 6.1 PDF 结构化解析（需求 1.1.2，解析粒度是重点）

用 PyMuPDF 后，原来 v1 里最麻烦的「对象层/字符层」全部省掉，流程简化为四步：

```python
import pymupdf          # ⚠️ 1.28 起不要用 import fitz（已废弃）

def parse_pdf(path) -> ParsedDoc:
    doc = pymupdf.open(path)
    # ① 取原始 span（PyMuPDF 已给出 文字+bbox+字号+字体名+flags）
    spans = []
    for pno, page in enumerate(doc):
        d = page.get_text("dict")
        for blk in d["blocks"]:
            if blk["type"] != 0:                       # 图片块
                images.append(extract_image(pno, blk)); continue
            for line in blk["lines"]:
                for sp in line["spans"]:
                    spans.append(Span(pno, sp["text"], sp["bbox"], sp["size"],
                                      sp["font"], bool(sp["flags"] & 2**4)))  # bold
    # ② 版面：归行 → 检测单/双栏 → 归段        （layout.py）
    # ③ 结构：标题层级 / 表格 / 图注 / 公式 / 参考文献 / 附录  （structure.py）
    # ④ 置信度打分                              （quality.py）
```

> 实测印证：英文论文第 1 页拿到 **219 个 span**，每个都带 `size` / `font` / `bbox`；
> 中文需求 PDF（Type3 位图字体）也一次抽出 **4301 字并保留标题层级**。
> 也就是说，**「版面分析」所需的全部原始素材由 PyMuPDF 直接提供**，
> 我们只需要写「怎么用这些素材判定结构」，不用碰字节层的字体映射。

**双栏检测**：把所有 span 的 x0 做直方图，如果在页面中部出现明显的「空带」（宽度 > 页宽 8%），
且左右两侧文本块数都 > 20%，则判为双栏，按列分组后再按列内 y 排序。单栏则直接按 y 排序。

**标题层级判定**（可解释，不用模型）：

```
正文字号 = span 中出现次数最多的字号
level1: size ≥ 正文*1.25 且 (匹配 ^\d+(\.\d+)*\s+ 或 全大写 或 居中)
level2: size ≥ 正文*1.10 且 匹配 ^\d+\.\d+\s
level3: size ≥ 正文*0.98 且 (bold 或 匹配 ^\d+\.\d+\.\d+\s)
```

**表格**：PyMuPDF 的 `page.find_tables()` 直接给出行列结构（这是选它而不选 pypdf 的主要原因）。
⚠️ **实测提醒**：`find_tables()` 在某些页会返回 0 个表格，官方提示安装 `pymupdf_layout` 可获得显著更好的版面分析。
因此策略是「三级降级」：
`find_tables()` → 失败则「列聚类 + 对齐线」启发式 → 再失败则把该区域文本原样保留并标 `need_review`。
是否引入 `pymupdf_layout` 见 §13 待决项第 6 条。

**公式**：PyMuPDF 拿不到公式语义，做法是
「左右留白大 + 独立成行 + 含数学字符占比高 + 字号与正文不同」→ 标记为 `formula` 元素，
**原文与 bbox 原样保留，不尝试转 LaTeX**（见 §10 边界说明）。

**扫描件判定**：`page.get_text()` 长度 < 阈值 且 `page.get_images()` 覆盖面积 > 70% → `scanned=True`。

**置信度公式**（前端「解析优/良/需校对」的依据）：

```
quality = 0.35 * 有文本层的页数占比
        + 0.25 * (标题/作者/摘要/参考文献 命中数 / 4)
        + 0.20 * (识别出的表格+公式数 / 启发式预期数，上限 1)
        + 0.20 * 段落完整度(不含乱码/空段的段落占比)
```

### 6.2 内容去重（需求 1.1.1）

```
① 整文件 SHA1 相同                              → identical
② 规范化文本 → 5-gram shingle → MinHash(128)    → 估 Jaccard
  同时 SimHash(64bit)，汉明距离 ≤3 视为近似
  sim ≥ 0.97 → identical ；0.85 ≤ sim < 0.97 → version
③ 同论文归并：arxiv_id 相同 或 (标题相似度≥0.9 且 首作者相同) → scan_group
④ 版本 diff：章节标题 LCS 对齐 → 段级 3-gram Jaccard(>0.8=same) → 新增/删除/修改
⑤ 决策：lib_is_newer = versionNum(lib) > versionNum(upload)
        suggest = lib_is_newer ? "keep" : "overwrite"
```

### 6.3 混合检索 + RAG 问答（需求 1.2）

```
chunker：以 section 为边界，300~500 token 切块，重叠 80
  ★ 表格按「表头 + 每行」单独成 chunk   ← 否则表格数据检索不到，问答会答错数字
  ★ 公式单独成 chunk + 附上下文一句话
  每块记录 paper_id / section_id / page / kind  ← 决定「能否给出准确页码」

BM25（index.py，纯 Python + SQLite 倒排）
  idf = ln(1 + (N - df + 0.5)/(df + 0.5))
  score = Σ idf * tf*(k1+1)/(tf + k1*(1-b+b*len/avg_len))     k1=1.4, b=0.72
  标题/章节名命中 ×1.12

混合（retrieve.py）
  ① BM25 top 30
  ② 向量 top 30（sentence-transformers BGE-M3，中英同空间；未装则跳过）
  ③ RRF 融合 score = Σ 1/(60 + rank_i)      ← 免调参，比加权稳
  ④ 可选 rerank：top 20 交 LLM 打 0~1 分（一次调用，成本可控）
  ⑤ 返回 top_k，附 relevance = score / max_score

问答 prompt 三条硬约束（写死在 prompts/qa.txt）
  1. 只能依据 <evidence> 内容回答；证据不足就说「未在论文中找到」
  2. 每句话末尾标来源编号 [n]
  3. 禁止使用证据之外的数字/作者/结论
生成后 → verify_citations() → 越界的 [n] 进 invalid，前端标红
```

**为什么 BM25 不能省**：学术文本里「β1」「P100」「16×16」这类关键词，BM25 命中率高于向量；
而「承袭关系」这类语义问题向量更强。两者 RRF 融合是最稳的组合，且 RRF 不需要调权重。

### 6.4 arXiv 抓取与推荐（需求 1.4）

两种实现都行，设计里给两条路：

```python
# 路线 A：官方 arxiv 库（省事）
import arxiv
client = arxiv.Client(page_size=100, delay_seconds=3)   # 尊重 arXiv 的 3 秒限速
search = arxiv.Search(query="cat:cs.CL", max_results=100, sort_by=arxiv.SortCriterion.SubmittedDate)

# 路线 B：httpx 直接打 API（可控性更好，能拿原始 XML）
GET http://export.arxiv.org/api/query?search_query=cat:cs.CL&sortBy=submittedDate&max_results=100
```

**必须遵守**：arXiv 要求 ≤ 1 请求/3 秒，且要带 User-Agent；`tenacity` 做退避重试；抓取结果按 `arxiv_id` 幂等。

推荐打分（前端已按此公式展示权重）：

```
score = 0.45*内容相关性(与文库 chunk 的最大余弦/BM25 归一)
      + 0.20*代码可得性(github 链接存在 + star 归一)
      + 0.20*引用增速(近 7 天被引归一；Crossref/Semantic Scholar)
      + 0.10*作者/机构历史命中率
      + 0.05*用户反馈修正(👍 +0.06 / 👎 -0.30)
推荐理由 = LLM 依据「文库中与之最相似的 3 篇」生成，必须点名这 3 篇
```

### 6.5 任务状态机（替代 Celery）

```python
# jobs 表就是状态机；asyncio 后台任务推进；进程重启后可续跑
async def enqueue(kind: str, target: str, payload: dict) -> str: ...
async def worker_loop():                       # 在 lifespan 里启动
    while True:
        job = await claim_next_queued()        # UPDATE ... SET status='running' WHERE id=... RETURNING
        if not job: await asyncio.sleep(1); continue
        try:
            await DISPATCH[job.kind](job)      # 内部对 CPU 密集用 to_thread.run_sync
            await mark_done(job)
        except Exception as e:
            await mark_failed(job, str(e))
```

**为什么不上 Celery/Redis**：单机演示，多两个常驻进程和一套 broker 不值当。
但 `jobs` 表 + `DISPATCH` 字典的结构与 Celery 一致，将来要换只改这一处。横向扩展的替换点写进 §10。

---

## 7. 配置与安全

### 7.1 配置（pydantic-settings）

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")

    # LLM（OpenAI 兼容）
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: SecretStr | None = None          # ★ SecretStr：日志里自动打码
    llm_model_chat: str = "deepseek-chat"
    llm_model_reasoner: str = "deepseek-reasoner"
    llm_model_embed: str | None = None            # 空 → 纯 BM25
    llm_timeout: float = 60.0
    llm_max_retry: int = 2

    # 存储
    db_url: str = "sqlite+aiosqlite:///./data/app.db"
    storage_dir: Path = Path("./data/papers")
    max_upload_mb: int = 200
    max_files_per_request: int = 10

    # 服务
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:8080", "null"]
    #                                                        ↑ "null" 是 file:// 打开前端时的 Origin
    log_level: str = "INFO"
```

`.env.example`（进仓库，**不含真 Key**）：

```ini
APP_LLM_BASE_URL=https://api.deepseek.com/v1
APP_LLM_API_KEY=sk-换成你自己的
APP_LLM_MODEL_CHAT=deepseek-chat
APP_LLM_MODEL_REASONER=deepseek-reasoner
# APP_LLM_MODEL_EMBED=BAAI/bge-m3      # 留空则只用 BM25
```

### 7.2 安全清单

| 项 | 做法 |
| --- | --- |
| **API Key** | 只从环境变量 / `.env`；`.env` 进 `.gitignore`；用 `SecretStr` 保证日志打码；**前端永远拿不到 Key**（所有 LLM 调用在后端） |
| 上传限制 | 扩展名白名单 `.pdf`；校验 `%PDF-` magic number（防改扩展名）；单文件 ≤200 MB；单请求 ≤10 文件；`Content-Length` 前置检查 |
| 路径安全 | 落盘文件名用 `sha1.pdf` 重命名，**绝不拼用户输入**；读取时只从 DB 的 `file_path` 取 |
| SQL 注入 | 全程 SQLAlchemy 参数化；BM25 的 `IN (...)` 用 `bindparam(expanding=True)` |
| CORS | `allowed_origins` 白名单；`file://` 打开前端时 Origin 是 `null`，需要显式允许（开发期） |
| 请求体 | JSON > 5 MB 返回 413；上传走流式落盘，不整体读进内存 |
| 速率限制 | `/qa/chat` 与 `/translate/*` 加简单令牌桶（每 IP 每分钟 N 次），防 LLM 费用失控 |
| 响应过滤 | `response_model` 排除 `file_path` / `sha1` 等内部字段 |
| 审计 | `llm_calls` 记录每次调用（task/model/tokens/ms/status）；`/api/v1/stats` 汇总 |
| 异常不泄露 | 全局 handler 只回错误码 + 可读消息；堆栈只进日志 |

---

## 8. 测试策略

```python
# tests/conftest.py —— 关键：用内存 SQLite + 覆盖 get_db 依赖
@pytest_asyncio.fixture
async def client():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

| 层级 | 测什么 | 数量目标 |
| --- | --- | --- |
| 单元 | `layout.py` 归行/双栏、`structure.py` 标题判定、`dedupe.py` 相似度、BM25 打分、`json_mode.py` 容错解析 | 30+ |
| 集成 | **需求第 2 节的 4 个场景各一条**（见下表） | 4 条必过 |
| 契约 | 用 `/openapi.json` 校验响应结构与 `schemas/` 一致；前端字段名冒烟比对 | 1 套 |
| LLM | 用 `respx`/`httpx.MockTransport` 假响应，不真调（省钱且可离线） | 10+ |

**需求第 2 节的 4 个场景（评测时会被重点看）**：

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | 先传 `1706.03762v7.pdf`，再传 `1706.03762v1.pdf` | 第二次返回 `kind="version"`、`lib_is_newer=True`、`suggest="keep"`、`diff` 非空 |
| 2 | 传 `1706.03762v1.pdf`（标准文本 PDF） | `parse_status="done"`，标题/作者/摘要/参考文献全部抽到，`quality ≥ 0.9` |
| 3 | 传 `1706.03762v1_img.pdf`（扫描件） | `scanned=True`，**不返回编造文本**，`parse_status` 落到 `need_review` |
| 4 | 传 `UnderstandingDeepLearning_02_09_26_C.pdf`（541 页 / 21 MB） | 解析不超时、内存可控（流式逐页）、章节树 ≥ 20 个一级标题 |

---

## 9. 运行与部署

```bash
# 开发（热重载）
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
#   → API 文档 http://127.0.0.1:8000/docs

# 生产（单机，多 worker）
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
# ⚠️ 注意：多 worker 时 §6.5 的 in-process worker 会有 4 份，需要在 claim 时用
#    UPDATE ... WHERE status='queued' RETURNING 保证原子性（设计已按此写），
#    或干脆 --workers 1 + 线程池（推荐，符合单机演示场景）

# 迁移
alembic upgrade head

# 测试
pytest -q
```

**演示环境（对应提交要求 3.4「在线演示」）**：

```nginx
location /api/ { proxy_pass http://127.0.0.1:8000; proxy_buffering off; }   # SSE 关键：关缓冲
location /     { root /var/www/research-assistant; }                        # 前端静态文件
```

`proxy_buffering off` 是 SSE 能不能实时出字的关键，容易漏。

---

## 10. 边界与不做的事

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 扫描件 OCR | `pytesseract` 装了且系统有 tesseract 就调；否则**如实标 `need_review`，绝不编造文字** | 编造文字会直接摧毁「可溯源、防幻觉」这个卖点 |
| 公式 → LaTeX | **只识别位置 + 保留原图/原文**，不做语义还原 | 需要专用模型（如 pix2tex），成本和风险都高；需求只要求「识别公式」 |
| 复杂跨页表格 | 启发式还原，失败落 `need_review` | 前端已有「需校对」标识和元数据编辑入口 |
| 向量检索 | **可选**：未配 `APP_LLM_MODEL_EMBED` 时纯 BM25 | 避免强依赖 GPU/torch；BM25 在术语密集的学术文本上本身不弱 |
| 多用户 / 登录 | 单用户（`user_id='default'`） | 需求里「多用户」是加分项非必做；表结构已留 `user_id` |
| 横向扩展 | 不做（预期单机） | 若要做：SQLite→PostgreSQL、`jobs` 表→Redis+Celery、向量→pgvector/Qdrant、文件→S3。**替换点已集中在 `db/`、`jobs.py`、`index.py` 三处** |
| 公式/表格的人工校对界面 | 后端只提供 `PATCH /papers/{id}` 与 `elements` 更新，界面由前端已有抽屉承担 | 前端元数据抽屉已完成 |
| Prometheus/OpenTelemetry | 只做结构化日志 + `/api/v1/stats` | 演示场景不需要完整可观测栈 |

---

## 11. 分阶段交付计划

每阶段结束都可独立验收。P0 就能出 `/docs`，评审可以早点看到接口全貌。

| 阶段 | 内容 | 验收标准 | 预估 |
| --- | --- | --- | --- |
| **P0** | 骨架：`main.py` + config + db + alembic 初版 + 全局异常 + 中间件 + `/health` `/docs` | `curl /health` 通；**`/docs` 能打开并看到接口**；`alembic upgrade head` 建表成功 | 0.5 天 |
| **P1** | 全部 16 张表的 ORM + Pydantic schemas + papers CRUD + 上传落盘 + jobs 状态机 | 上传 PDF 能入库；列表/详情/改/删/收藏全通；进度条能轮询到 | 1.5 天 |
| **P2** | **PDF 解析流水线**（PyMuPDF + layout + structure + quality） | 39 篇测试 PDF 全部抽出文本；4 个必测文件达到 §8 的断言；`/papers/{id}/parse` 返回 7 个分区 | 2.5 天 |
| **P3** | 去重 + 版本 diff + 三种决策 | 场景 1 断言全过（`version` + `lib_is_newer` + diff） | 1 天 |
| **P4** | chunker + BM25 索引 + `/retrieve` | 需求 1.2 的 5 道例题检索都命中正确片段且页码正确 | 1.5 天 |
| **P5** | LLM 客户端 + RAG 问答（SSE）+ 引用校验 | `/docs` 里能直接试 `/qa/chat` 看到流式输出；编造的 `[n]` 被标进 `invalid` | 1.5 天 |
| **P6** | 阅读与翻译（局部/整篇/段落对齐） | 阅读器三种模式接真实数据；`paragraph-map` 可用于同步滚动 | 1 天 |
| **P7** | 引用图 + PageRank + 介数中心性 + 综述 + 未来工作 | 图谱页接真实引用边（不再是我手工标注的 `citesIds`） | 1.5 天 |
| **P8** | 发现与推荐（arXiv 抓取 + 打分 + 反馈） | 推荐页接真实 arXiv 结果，👍👎 改变排序 | 1.5 天 |
| **P9** | 写作助手（框架/核验/图代码/CSV/图注/翻译） | 写作页四个标签全部通 | 1 天 |
| **P10** | 前端接线（`api.js` + 改 `store.js`）+ 端到端联调 + `docs/api.md` + 部署脚本 | 全站无 mock 依赖；`pytest` 全绿 | 1.5 天 |

合计约 **16.5 人天**（比 v1 的 14 天略多，因为多做了 alembic 迁移、tasks 原子性、契约测试）。

**建议先做 P0→P5**：这条主干正好覆盖需求第 2 节唯一给出明确测试步骤的部分（去重 → 解析 → 问答），
也是最容易出成果、最容易验收的一段。做完再决定 P6~P10 的优先级。

---

## 12. 前端需要相应改动（很少，因为前面已分层）

| 文件 | 改动 |
| --- | --- |
| `scripts/core/api.js` | **新增**：`fetch` 封装（base url、错误信封解析、SSE 读取、重试） |
| `scripts/core/store.js` | actions 内部把 `U.sleep(...)` 换成 `await api.*`；`_runPipeline` 改为轮询 `/jobs/{id}` |
| `scripts/data/mock-data.js` | 保留为 **fallback**（后端不可用时前端仍可演示，也方便评审不启服务看界面） |
| `scripts/views/*.js` | **不动**（视图只读 store，早已解耦） |
| `index.html` | 加一行 `<script src="scripts/core/api.js"></script>`（在 store.js 之前） |
| 新增 `config.js` | 一行 `window.__API_BASE__ = 'http://127.0.0.1:8000/api/v1'`，方便切换部署地址 |

---

## 13. 需要你拍板的 6 件事

| # | 问题 | 我的建议 |
| --- | --- | --- |
| 1 | **向量检索要不要**（会拉进 torch ≈ 2 GB） | **先不加**。纯 BM25 先跑通主干，P4 之后再评估。已在 `pyproject.toml` 里做成可选 extra `[vectors]`，随时能开 |
| 2 | **扫描件 OCR** | 装了 tesseract 就用；没有就**如实标注需人工校对**，不返回假文本 |
| 3 | **公式处理深度** | 只做位置识别 + 保留原样，**不转 LaTeX** |
| 4 | **mock 数据是否保留** | 保留为 fallback（评审不启后端也能看界面） |
| 5 | **是否现在就开工 P0** | 建议先做 P0，**半天就能给你一个能打开 `/docs` 的骨架** |
| 6 | **是否安装 `pymupdf_layout`** | 建议 **P2 阶段再看**：先用内置 `find_tables()` 跑 39 篇测试集，统计表格识别率；不足再引入（它是独立包，不影响主依赖） |

---

## 附：需求 → 后端实现 覆盖对照

| 需求 | 接口 / 模块 |
| --- | --- |
| 1.1 基本 CRUD + 批量上传 | `POST/GET/PATCH/DELETE /papers`、`services/ingest.py` |
| 1.1 上传后解析提取文字 | `services/parser/*`、`POST /papers/{id}/reparse`、`GET /papers/{id}/parse` |
| 1.1 更高级解析（结构/公式/表格/图表） | `parser/structure.py`、`elements` 表、`GET /papers/{id}/content` |
| 1.1.1 内容去重 + 保留哪版 + 版本差异 | `services/dedupe.py`、`/duplicates*`、`dup_decisions` 表 |
| 1.1.2 解析粒度九项 | `sections`/`elements`/`refs` 表 + `GET /papers/{id}/parse` |
| 1.2.1 单篇 RAG 问答 + 参考原文 | `POST /qa/chat`、`POST /retrieve`、`evidence` 事件 |
| 1.2.2 多篇论文问答 | `scope="multi"` + `paper_ids[]` |
| 1.3.1 保留排版阅读 | `GET /papers/{id}/content`（带 `bbox`，可叠回原页） |
| 1.3.2 树状导航 + 引文跳转/跳回 | `sections` 树 + `blocks[].cites` + `refs[].local_paper_id` |
| 1.3.3.1 划词/局部翻译 | `POST /translate/selection` |
| 1.3.3.2 整篇翻译（两种方案） | `POST /translate/full`（`mode` 参数） |
| 1.3.3.3 中英同步滚动 | `GET /papers/{id}/paragraph-map` |
| 1.4.1 按名下载 + 参考文献批量下载 | `POST /discover/download-by-name`、`POST /papers/{id}/refs/download` |
| 1.4.2 定期刷新 arXiv | `POST /discover/fetch` + APScheduler |
| 1.4.3 每日/每周推荐 + 理由 + 代码优先 + 反馈 | `services/discover.py` 打分、`/recommendations*`、`feedback` 表 |
| 1.5.1 局域图谱 | `POST /graph/build`、`citations` 表 |
| 1.5.2 核心节点挖掘 | `GET /graph/insights`（入度/PageRank/介数中心性） |
| 1.5.3 自动综述 | `POST /graph/summary`（SSE） |
| 1.5.4 未来工作（排除已被尝试） | `POST /graph/future-work`（先检索再建议） |
| 1.6.1 框架 + References 无幻觉 | `POST /writing/outline`、`POST /writing/verify-refs` |
| 1.6.2 TikZ / Graphviz / Mermaid | `POST /writing/diagram` |
| 1.6.3 CSV → 图表 + Figure Caption | `POST /writing/dataset`、`POST /writing/caption` |
| 1.6.4 中文摘要/全文译英 | `POST /writing/translate` |
| 2. 测试数据 4 场景 | `tests/integration/` 各一条，见 §8 |
| 3.5 API 密钥不入库 | pydantic `SecretStr` + `.env` + `.gitignore` + 日志打码 |
