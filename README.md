# 科研小助手 Agent

> 面向科研文献的 AI 智能体：把 PDF 论文变成**可检索、可问答、可引用、可写作**的结构化知识库。

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.143-009688)](https://fastapi.tiangolo.com/)
[![Tests](https://img.shields.io/badge/tests-168%20passed-brightgreen)]()
[![Ruff](https://img.shields.io/badge/ruff-0%20issues-orange)]()
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 项目介绍

科研人员读论文有三个痛点：**读得慢**（一篇 15 页要精读半小时）、**跨论文难对比**（想找"谁最早提出某个方法"要翻十几篇）、**AI 回答无法溯源**（模型说得头头是道，但你不知道依据在哪一段）。

本项目把「论文 PDF」变成「可检索、可问答、可引用」的知识库：上传后自动结构化解析（标题、作者、三级目录、摘要、参考文献），再用混合检索找到最相关的原文片段，交给大模型组织成带出处的回答——**每一条结论都能点回原文核对**。

### 核心功能

| 模块 | 能力 | 状态 |
| --- | --- | --- |
| 文档管理 | 批量上传、**内容指纹去重**、版本识别、结构化解析 | ✅ 后端已实现 |
| 知识问答 | 单篇/多篇 RAG 问答，回答带出处角标，**引用编号服务端校验** | ⏳ 计划中 |
| 阅读与翻译 | 树状目录、引文双向跳转、划词翻译、中英对照 | ✅ 前端已实现（演示数据） |
| 引用图谱 | 引用网络、核心节点挖掘、自动综述 | ✅ 前端已实现（演示数据） |
| 发现与推荐 | arXiv 抓取、相关性推荐、用户反馈 | ✅ 前端已实现（演示数据） |
| 写作助手 | 框架生成、References 核验、图代码、CSV 可视化 | ✅ 前端已实现（演示数据） |

> **诚实说明**：前端目前运行在演示数据上（`frontend/scripts/data/mock-data.js`），后端已完成 P0~P2（骨架、上传去重、PDF 解析）。两者尚未接通，详见 [docs/architecture.md](docs/architecture.md) 附录 C。

---

## 技术架构

```
┌──────────────────────────────────────────────┐
│  前端  原生 HTML / CSS / JavaScript            │
│        零依赖、零构建，浏览器直接打开            │
└───────────────────┬──────────────────────────┘
                    │ HTTP / SSE
┌───────────────────▼──────────────────────────┐
│  FastAPI 后端                                 │
│  ├── api/       路由层（只处理 HTTP，不写 SQL） │
│  ├── schemas/   Pydantic 请求响应模型          │
│  ├── services/  业务层（解析 / 去重 / 检索…）    │
│  ├── models/    SQLAlchemy ORM                │
│  ├── db/        异步引擎与会话                 │
│  └── core/      配置 · 日志 · 统一错误          │
└───────────────────┬──────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   SQLite (WAL)           本地文件存储
```

### 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | 原生 HTML/CSS/JS | 零依赖、零构建，无需 Node.js 即可运行 |
| 后端 | Python 3.11+ / FastAPI / Pydantic v2 | 原生 async，支持 SSE 流式输出 |
| 数据 | SQLAlchemy 2.0 async + SQLite(WAL) | ORM 抽象层便于将来切换 PostgreSQL |
| PDF 解析 | PyMuPDF | 可同时获取文字、坐标、字号、表格结构 |
| 图论分析 | NetworkX | 引用网络与中心性分析 |
| 大模型 | OpenAI 兼容 API | DeepSeek / OpenAI / 本地 Ollama 均可切换 |
| 代码规范 | Ruff | 规则集 E/W/F/I/N/UP/B/SIM |
| 测试 | pytest + pytest-asyncio | 168 个用例 |

---

## 安装运行指南

### 环境要求

| 组件 | 版本要求 | 说明 |
| --- | --- | --- |
| Python | **≥ 3.11**（实测 3.12.14 / 3.14.7） | 后端 |
| Node.js | **不需要** | 前端零依赖，浏览器直接打开；仅跑前端自测时需要 |
| 数据库 | SQLite（Python 内置） | 无需额外安装 |
| 大模型 | OpenAI 兼容 API | 通过环境变量配置；未配置也可运行（走规则降级） |

### 后端

```bash
cd backend

# 1. 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# 2. 安装依赖（含开发依赖）
python -m pip install -e ".[dev]"

# 3. 配置环境变量
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
# 然后编辑 .env，填入自己的 API Key

# 4. 启动
uvicorn app.main:app --reload --port 8000
```

启动后访问 **http://127.0.0.1:8000/docs** 查看接口文档（Swagger UI）。

> **注意**：文档页的静态资源已本地化（`app/static/`），**不依赖外部 CDN**，离线环境同样可用。

### 前端

```bash
# 零依赖，直接用浏览器打开
start frontend\index.html       # Windows
# open frontend/index.html      # macOS
```

### 环境变量

所有敏感信息**只通过环境变量注入，不进仓库**。完整清单见 [`backend/.env.example`](backend/.env.example)：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_LLM_BASE_URL` | `https://api.deepseek.com/v1` | 大模型接口地址 |
| `APP_LLM_API_KEY` | 空 | API Key（**绝不提交**） |
| `APP_LLM_MODEL_CHAT` | `deepseek-chat` | 对话模型 |
| `APP_LLM_MODEL_REASONER` | `deepseek-reasoner` | 推理模型 |
| `APP_LOG_LEVEL` | `INFO` | 日志级别 |
| `APP_DEBUG` | `true` | 调试模式 |

环境配置的详细说明见 [`docs/setup.md`](docs/setup.md)。

---

## 项目信息

| 项 | 内容 |
| --- | --- |
| 作者 | 叶硕迪 |
| 学校 | 南京传媒学院 |
| 专业 | 计算机科学与技术 |
| 年级 | 2024 级 |
| 联系方式 | 2697427690@qq.com |
| 参赛形式 | 个人参赛（独立完成全部设计与开发） |

负责范围：需求梳理、系统设计、后端（FastAPI / 解析 / 检索 / 问答 / 图谱）、
前端（零依赖 SPA）、部署运维与文档。开发过程与 AI 使用情况见
[`docs/ai-usage.md`](docs/ai-usage.md)。

---

## 在线演示

服务已部署在阿里云 ECS（Ubuntu 22.04 / Python 3.12 / systemd 托管）。

| 入口 | 地址 |
| --- | --- |
| **接口文档（Swagger UI）** | http://47.96.97.141:8000/docs |
| **接口文档（ReDoc）** | http://47.96.97.141:8000/redoc |
| **健康检查** | http://47.96.97.141:8000/api/v1/health |
| **登录** | 无需登录 |

**线上验证**（在你自己的机器上运行，会完整走一遍 上传 → 解析 → 查询）：

```bash
python deploy/verify_online.py
```

> **说明**：当前部署使用「公网 IP + 8000 端口」，**不依赖域名与备案**。
> 部署脚本与运维说明见 [`deploy/README.md`](deploy/README.md)。
> 该 ECS 为 3 个月免费试用，到期前需完成续费或迁移（见 [docs/architecture.md](docs/architecture.md) 附录 C）。

---

## 演示视频

_（录制完成后填写）_

---

## 测试

```bash
# 后端：单元测试 + 接口测试 + 真实 PDF 回归
cd backend
python -m pytest tests -q
# 期望：168 passed

# 代码规范检查
python -m ruff check app tests
# 期望：All checks passed!

# 前端：无浏览器冒烟测试（需要 Node.js）
node frontend/tools/smoke/run.js
# 期望：80/80 通过，加载错误 0 个
```

### 测试覆盖

| 测试文件 | 用例数 | 覆盖内容 |
| --- | --- | --- |
| `tests/test_dedupe.py` | 34 | arXiv ID 提取的 20 种文件名变体、名称归一化、版本比较、扫描件识别 |
| `tests/test_paper_service.py` | 13 | 文件落盘、指纹计算、分页查询、删除策略 |
| `tests/test_api_papers.py` | 15 | 上传/列表/详情/更新/删除接口的 HTTP 行为与错误处理 |
| `tests/test_pdf_parser.py` | 12 | 合成 PDF 边界用例 + 官方三份真实 PDF 的回归基线 |

---

## 目录结构

```
.
├── frontend/                  前端（原生 HTML/CSS/JS，零依赖）
│   ├── index.html
│   ├── styles/                theme.css · app.css · views.css
│   ├── scripts/
│   │   ├── core/              工具 · 状态 · 组件 · RAG · 去重 · 写作
│   │   ├── data/              演示数据
│   │   └── views/             八个页面
│   ├── tools/smoke/           无浏览器冒烟测试（80 项）
│   └── README.md              前端专项说明
│
├── backend/                   后端（FastAPI）
│   ├── app/
│   │   ├── api/v1/            路由层
│   │   ├── core/              配置 · 日志 · 统一错误
│   │   ├── db/                异步引擎与会话
│   │   ├── models/            ORM 模型
│   │   ├── schemas/           Pydantic 模型
│   │   ├── services/          业务层（解析 / 去重 / 论文服务）
│   │   ├── static/            本地化的文档页资源
│   │   └── main.py            应用入口
│   ├── tests/                 168 个测试
│   ├── pyproject.toml         依赖与 ruff / pytest 配置
│   └── .env.example           环境变量模板
│
├── docs/                      文档
│   ├── requirements.md        需求原文整理
│   ├── competition-env.md     比赛环境与技术栈要求（官方条款）
│   ├── architecture.md        技术文档主稿（含踩坑记录与已知问题）
│   ├── backend-design.md      后端设计方案
│   └── setup.md               环境配置说明
│
├── README.md
├── CHANGELOG.md
├── LICENSE
├── .gitignore
└── .gitattributes
```

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 技术文档主稿：架构、AI 技术方案、踩坑记录、已知问题 |
| [docs/requirements.md](docs/requirements.md) | 需求原文整理 |
| [docs/competition-env.md](docs/competition-env.md) | 官方比赛环境与技术栈要求整理 |
| [docs/backend-design.md](docs/backend-design.md) | 后端设计方案（含依赖可行性实测） |
| [docs/setup.md](docs/setup.md) | 环境配置详细说明 |
| [frontend/README.md](frontend/README.md) | 前端架构与页面说明 |

---

## 开发进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 后端骨架（配置 / 日志 / 错误 / 数据库 / 健康检查） | ✅ 完成 |
| P1 | 上传、内容指纹去重、版本识别 | ✅ 完成 |
| P2 | PDF 结构化解析 + 解析状态机 | ✅ 完成 |
| P3 | 混合检索（BM25 + 向量 + RRF） | ✅ 完成 |
| P4 | RAG 问答与引用校验 | ✅ 完成 |
| P5 | 引用图谱分析 | ⏳ 下一个 |
| P6 | 论文发现与推荐 | 计划中 |
| P7 | 写作助手 | 计划中 |
| P8 | 前后端联调 | 计划中 |
| P9 | 在线演示部署 | ✅ 完成 |
| P10 | 技术文档与演示视频 | 计划中 |

---

## 开发说明

本项目开发过程中使用了 AI 辅助编程工具，协同方式与 Prompt 策略详见 [docs/architecture.md](docs/architecture.md)。

---

## 许可证

[MIT](LICENSE)
