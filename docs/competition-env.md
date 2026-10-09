# 比赛环境与技术栈要求（官方条款整理）

> 来源：大赛官方「比赛环境」页面（选手提供截图，两张）。
> 用途：本文是**官方条款的整理稿**，技术文档（`docs/architecture.md` 第 3 章选型理由）需引用本文。
> 说明：正文忠实转录官方内容；凡我方补充的对照说明，一律用 `★` 标出，与官方内容区分。

---

## 1. 技术栈要求

> 官方原文抬头即为：**技术选型不做强制限定**。以下为推荐技术栈与架构选型建议。
> ★ 这一点很关键：下面的表是**推荐**，不是**强制**。但若未采用推荐项，建议在技术文档中说明理由。

### 1.1 前端框架与可视化（交互与渲染层）

官方原文：本赛项要求作品以**现代全栈 Web 应用**为呈现形式，需深度结合大语言模型（LLM）与 **Agent 架构**，技术选型不做强制限定。以下为推荐技术栈与架构选型建议：

| 框架 / 技术 | 推荐场景 | 特点与适用功能 |
| --- | --- | --- |
| React + Next.js 14+ | 全栈 Agent Web 应用（**推荐首选**） | App Router、Server Component，处理 PDF 阅读器与 Agent 对话 |
| Vue 3 + Nuxt 3 | 渐进式 AI 科研平台 | Composition API、服务端渲染，密集的阅读器与图表展示 |
| ECharts / AntV G6 / Cytoscape.js | 局域引用图谱绘制（**核心推荐**） | 专用于渲染 20 篇+ 论文的引用图谱、交互高亮 |
| PDF.js / React-PDF | PDF 文档渲染与交互 | 实现单/双栏**排版渲染**、划词翻译、**联动滚动** |
| KaTeX / MathJax | 学术公式与 LaTeX 渲染 | 高性能渲染学术论文中的公式 |
| Mermaid.js / TikZ.js / Chart.js | 架构拓扑图与数据可视化 | 渲染 Agent 自动生成的逻辑拓扑图、柱状图、三维雷达图 |

### 1.2 Agent 架构与 RAG 管道（Backend & Agent Engine）

| 技术 / 框架 | 用途 | 说明 |
| --- | --- | --- |
| LangChain / LlamaIndex / LangGraph | Agent 流程编排与 RAG 引擎 | 用于实现**任务规划（Task Planning）**、**多智能体（Multi-Agent）状态机路由** |
| FastAPI / Python Async API | 高性能 Agent 后端 | 适配 PDF OCR、**PyMuPDF** 文档解析、数值计算，支持**异步 RAG 流式对话响应** |
| Milvus / Qdrant / Chroma / FAISS | 向量数据库（Vector DB） | 存储论文文本分片（Chunk）向量，支撑高精度 RAG 学术知识问答检索 |
| Sickle / Pyblish / BeautifulSoup / Playwright | 学术数据抓取与 API 集成 | 对接 arXiv 开放档案接口，爬虫批量下载、解析参考文献全文与元数据 |
| NetworkX / igraph | **图论计算引擎** | 后端批量解析多篇论文引用关系，挖掘**领域基石论文、边缘交叉论文** |

### 1.3 AI 模型与 API 接入

| 类型 | 推荐选项 | 适用功能 |
| --- | --- | --- |
| 大语言模型（LLM） | DeepSeek-V3/R1、OpenAI GPT-4o/o3/o4、Claude 3.5/3.7 Sonnet、Qwen2.5 | 负责智能体**任务规划（Task Planning）**、多文献综合对话，实现**低幻觉**学术问答 |
| **多模态与 OCR 模型** | GPT-4o、Gemini 2.0/Pro Vision、**Qwen2-VL**、**PaddleOCR**、**MinerU / Marker** | 处理**扫描版 PDF**、复杂期刊版式，完成论文图文细粒度识别、公式图表提取 |
| **Embedding & Rerank 向量重排模型** | **BGE-M3**、**bge-reranker-large**、OpenAI Text-Embedding-3 | 生成多语言高质量语义向量；**检索后重排序**，支撑文献溯源，**降低回答幻觉** |

---

## 2. 开发工具推荐

| 工具类型 | 推荐工具 | 作用说明 |
| --- | --- | --- |
| AI 辅助编程 | Cursor、Windsurf、Claude Code、Trae、GitHub Copilot | 辅助快速搭建系统架构、编写业务代码、调试前后端逻辑 |
| 文档与 PDF 分析调优 | **PyMuPDF**、PaddleOCR、MinerU、各类多模态大模型 | 解析调试 PDF 文件，处理论文交叉引用、图文提取、学术版式还原 |
| 版本控制与包管理 | **Git** + GitHub/Gitee、**uv** / pnpm | Git 管理代码版本；uv 管控 Python 依赖，pnpm 管控前端依赖，**留存完整提交记录** |
| 代码规范与环境容器 | **Docker + Docker-Compose**、ESLint + Ruff | Docker 镜像封装统一运行环境，实现一键部署、环境可复现；ESLint 校验 JS/TS，Ruff 规范 Python 代码 |

---

## 3. 特别说明（工程要求，非可选）

### 3.1 系统工程完整性

官方原文：参赛作品须具备完整的 **Web 前端交互界面**与 **Agent 后端/API 服务**。前端需重点呈现 **PDF 联动阅读、图谱可视化及可视化 Copilot**；后端需确保 **RAG 检索与工具调用的鲁棒性**。

### 3.2 抗幻觉与可追溯性

官方原文：系统必须具备 **Source Tracing（源头溯源）机制**，知识问答的输出成果需**明确标出参考原文位置/段落，防范大模型幻觉**。

### 3.3 API 费用与额度规划

官方原文：使用商业大模型 API **须自行承担费用**，建议选手合理规划用量，鼓励结合**开源大模型**（如 DeepSeek、Qwen）或**本地部署轻量模型**降低成本。

### 3.4 代码真实性与 AI 协同

官方原文：**允许并鼓励**使用 AI 辅助编程工具（Vibe Coding），但参赛选手**须理解并掌控项目的核心架构逻辑**，并在**技术文档中清晰说明 AI 的协同贡献与 Prompt 调优策略**。

> ★ 这一条把「AI 协同」从风险变成了**必须写清的加分项**。技术文档需单开一节，写两块内容：
> ① 各环节 AI 贡献 vs 我方主导的对照表；② 实际使用的 Prompt 调优策略。

### 3.5 测试用例兼容性

官方原文：必须确保系统**部署后**，能顺畅**加载并运行官方预置的 pdf/ 目录测试用例**（如 `1706.03762v1.pdf` vs `v7.pdf` 去重、`1706.03762v1_img.pdf` 扫描解析及 **500+ 页长篇书籍解析**）。

> ★ 这一条是**硬性验收**：三个用例跑不通，作品可能直接不合格。
> 官方用例与我们本地 `pdf/` 目录的对应关系：
>
> | 官方用例 | 本地文件 | 大小 |
> | --- | --- | --- |
> | v1 vs v7 去重 | `1706.03762v1.pdf`（2.0 MB）+ `1706.03762v7.pdf`（2.1 MB） | 文本层正常 |
> | 扫描件解析 | `1706.03762v1_img.pdf` | 4.5 MB，**无文本层** |
> | 500+ 页长篇书籍 | `UnderstandingDeepLearning_02_09_26_C.pdf` | 21.3 MB，541 页 |

---

## 4. ★ 我方现状对照与缺口清单

> 本节为我方分析，非官方内容。缺口分析的详细做法见 `docs/backend-design.md`。

### 4.1 已命中官方推荐项

| 官方推荐 | 我方实现 |
| --- | --- |
| FastAPI / Python Async API | ✅ 完全一致 |
| **PyMuPDF** | ✅ 主力 PDF 解析器，已实测可用（含中文 Type3 位图字体） |
| LLM：DeepSeek | ✅ OpenAI 兼容适配层，可切 DeepSeek / OpenAI / 本地 |
| Git + GitHub | ✅ 已建立仓库与提交规范 |
| Git 留存完整提交记录 | ⏳ 持续积累中 |

### 4.2 缺口（按「评审影响 × 补齐成本」排序）

| 优先级 | 缺口 | 官方出处 | 补齐成本 | 计划做法 |
| --- | --- | --- | --- | --- |
| **P0** | **扫描件 OCR / 多模态识别** | 1.3 多模态与 OCR 模型；**3.5 硬性用例** | 中 | 用视觉大模型 API（Qwen-VL / GPT-4o）做「页面图 → Markdown」，复用现有 LLM 适配层 |
| **P1** | **NetworkX / igraph 图论计算** | 1.2 明确点名 | **极低** | `pip install networkx`，替换原计划中 numpy 手写的 PageRank |
| **P2** | **向量数据库 + Embedding/Rerank** | 1.2 向量数据库；1.3 Embedding & Rerank | 中高 | `faiss-cpu` + BGE-M3（或 API 嵌入），与 BM25 做 RRF 融合 + bge-reranker 重排 |
| **P3** | **PDF.js 渲染 PDF 原页面（排版渲染 / 联动滚动）** | 1.1 PDF.js / React-PDF | 中 | 阅读器加「原文视图」开关，与现有文本视图并存 |
| **P4** | **KaTeX / MathJax 公式渲染** | 1.1 KaTeX / MathJax | **低** | CDN 引入 KaTeX，替换当前纯文本 LaTeX 显示 |
| **P5** | **ECharts / AntV G6 引用图谱** | 1.1「核心推荐」 | 中 | 替换自研 SVG 力导向实现（改动集中在一个文件） |
| **P6** | **Docker / docker-compose 一键部署** | 2 开发工具推荐 | 低 | 写 `Dockerfile` + `compose.yaml` |
| **P7** | **LangGraph 多智能体编排** | 1.2 明确点名 | 中 | 至少把 QA Agent + 独立 Verifier Agent 的复核闭环做出来 |
| **P8** | **uv 替代 pip** | 2 版本控制与包管理 | 低 | P0 跑通后再切换，避免一次动太多 |

### 4.3 官方要求与我们既有优势的对应

| 官方特别说明 | 我方已有优势 |
| --- | --- |
| 3.1 前端需呈现 PDF 联动阅读、图谱可视化、Copilot | 阅读器（树状目录 / 引文双向跳转 / 中英对照同步滚动）、引用图谱、问答面板已完成 |
| 3.1 后端需确保 RAG 检索与工具调用鲁棒性 | 统一错误信封、任务状态机、降级策略已设计 |
| 3.2 必须 Source Tracing，标出参考原文位置/段落 | **引用角标可点击回原文 + 服务端校验引用编号是否越界**（这是我们的差异化亮点） |
| 3.3 API 费用自担，鼓励开源/本地模型 | LLM 适配层从设计上就支持 `base_url` 切换，本地 Ollama 零成本接入 |
| 3.4 需写清 AI 协同贡献与 Prompt 调优策略 | 列入技术文档第 9 章（待写） |
| 3.5 三个测试用例必须跑通 | PyMuPDF 已实测可解析文本 PDF 与 541 页书籍；**扫描件是唯一未解决项（P0）** |

---

## 5. ★ 技术文档需要据此回答的问题

官方 1 章与 3.4 条决定了技术文档必须正面回答以下问题（否则会被视为「选型无理由」）：

1. 前端为什么不用 React/Next.js？现有方案如何达成「现代全栈 Web 应用」的效果？
2. 引用图谱为什么不用 ECharts/G6？自研 SVG 的可控性优势是什么（或何时替换）？
3. 为什么采用/不采用 LangChain / LangGraph？多智能体是如何体现的？
4. 向量数据库选型理由（FAISS vs Milvus vs Qdrant），Embedding 与 Rerank 怎么组合？
5. 扫描件与复杂版式用什么模型处理，成本如何控制（呼应 3.3）？
6. **AI 协同贡献具体是什么？Prompt 调优策略是什么？**（3.4 强制要求）
7. Source Tracing 机制的实现细节（呼应 3.2）：如何保证每个结论都能定位到原文？
