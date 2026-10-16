# 科研小助手 Agent · 技术文档

> 版本：v0.1　|　本文档是提交用技术文档（PDF，≤30 页）的主稿，开发过程中持续补充。

## 目录

1. 项目概述
2. 需求分析
3. 系统架构设计
4. AI 技术方案（选型理由 / 集成方式 / 优化策略）
5. 核心功能实现
6. 测试与部署
7. 创新点说明
8. 总结与展望

---

## 附录 B：技术选型记录

> 记录每个技术决策的「为什么」，用于第 4.1 节「选型理由」。

| 决策点 | 选择 | 备选 | 理由 |
| --- | --- | --- | --- |
| Web 框架 | FastAPI + Pydantic v2 | Flask / Django | 官方技术栈推荐；原生 async 支持 SSE 流式；Pydantic 自动校验并生成 API 文档 |
| 数据库驱动 | SQLAlchemy 2.0 async + aiosqlite | 直接用 sqlite3 | ORM 抽象层让将来切换 PostgreSQL 只改连接串 |
| 配置管理 | pydantic-settings | os.getenv | 自动类型转换与校验；API Key 用 SecretStr 包装，避免日志泄露 |
| 错误处理 | 自定义 AppError + 统一处理器 | 直接抛 HTTPException | 前端只需处理一种错误格式；未处理异常对外不暴露堆栈 |
| PDF 解析 | PyMuPDF | pypdf / 手写解析 | 官方推荐工具；可同时获取文字、坐标、字号、表格结构 |
| 图论分析 | NetworkX | 手写 numpy 实现 | 官方技术栈推荐；内置 PageRank、介数中心性等算法 |

| 代码规范工具 | Ruff | flake8 + isort + black | 一个工具覆盖 lint 与格式化，速度极快；配置中显式忽略 B008（FastAPI 的 `Depends()` 属于该规则的误报）与 N818（异常类名不加 Error 后缀更简洁），并在配置里注明理由 |

## 附录 A：踩坑记录

> 开发过程中实际遇到并解决的问题。这部分是一手材料，用于第 4 章「优化策略」与第 6 章「测试与部署」。

- SQLite 默认不开外键约束，必须在连接时 PRAGMA foreign_keys=ON，
  否则外键写了等于没写（实测：插入不存在的 pid 竟然成功）
- .gitignore 里 ! 反向排除必须紧跟被排除规则，
  否则 .env.* 会把 .env.example 一并吃掉
- FastAPI 内置 /docs 与 /redoc 从 cdn.jsdelivr.net 加载 swagger-ui / redoc 资源，
  该 CDN 在部分网络下 TLS 连接被重置（WinError 10054），表现为
  「页面标题正确但内容白屏」（HTML 返回 200，静态资源加载失败）。
  对策：下载静态资源到 app/static/ 自托管。已实测：关闭代理后仍可正常打开。
- GitHub 推送报 `Recv failure: Connection was reset` 未必是被阻断：
  本次重试后成功，属偶发网络抖动。判断方法：分别测 443 与 22 端口，
  并重试 2~3 次后再下结论。长期方案是配置 SSH 密钥（已配置，免密免代理）。
- 单元测试直接暴露了 4 个肉眼难以发现的缺陷：旧版 arXiv 编号不支持下划线、
  Windows 下 basename 不识别正斜杠、元组漏解包、扫描件判定顺序错误。
  这类缺陷靠人工点击界面很难覆盖，是引入 pytest 的直接收益。
- FastAPI 的文件上传接口依赖 python-multipart，它是 fastapi 的可选依赖，
  只装 `fastapi` 时不会自动带上；缺失时接口在运行时报
  `RuntimeError: Form data requires "python-multipart" to be installed`。
  对策：写入 pyproject.toml 主依赖。教训：代码正确不等于能跑起来，依赖也是代码的一部分。
- 测试用内存 SQLite 时必须使用 StaticPool：`sqlite:///:memory:` 是「每条连接一个
  独立实例」，建表连接与接口连接看到的不是同一个库，表现为 `no such table`。
  同时应在 import app.main 之前替换 db.session 的 engine，
  让 lifespan 的建表也走测试库，从而完全不触碰真实的 data/app.db。
- PATCH 接口必须用 `payload.model_dump(exclude_unset=True)` 取字段，
  否则客户端只传部分字段时，未传字段会被 None 覆盖，导致已有数据被清空。
- Windows PowerShell 5.1 不支持 `Invoke-RestMethod -Form` 与
  `System.Net.Http.MultipartFormDataContent`（需 PowerShell 7+）。
  做接口端到端验证时改用 Python 脚本（httpx）或 curl.exe 更可靠。
- 中文输出在 PowerShell 5.1 控制台会显示为乱码，执行 `chcp 65001` 可正常显示；
  这属于终端编码问题，不影响程序输出的实际内容。
- PDF 内置书签（`doc.get_toc()`）是目录最可靠的来源：实测官方两篇论文与
  541 页书籍都带书签，能直接给出「层级 / 标题 / 页码」三级结构，
  比从字号推断准确得多。解析策略应以「有书签用书签、无书签才回退」为第一原则。
- 标题提取必须排除竖排侧边文字：arXiv 论文左侧水印
  "arXiv:1706.03762v1 [cs.CL] 12 Jun 2017" 字号 20.0，比真正的标题（17.2）还大，
  其 bbox 为 (11,216,38,560) —— 宽 27、高 344。判据用「高度 > 宽度 × 2」即可排除。
- 标题行常与页码等文字合并成一行（如 "1 Introduction 1"、"Bibliography 464"），
  因此标题识别不能只用「整行相等」的正则，应改为「包含 + 长度限制」。
- 摘要边界不能只靠行距：实测摘要末行与下一节标题只差 31pt，
  必须把「遇到章节标题即停」作为主判据，行距阈值（约 18pt）作为辅助。
- 置信度评分必须对文本量敏感：合成的小样本 PDF（每页约 30 字符）会得到
  quality≈0.34 并被判为需校对，而真实论文（每页 800+ 字符）为 1.0。
  这一点已写成测试用例，确保评分不是常量。

## 附录 C：已知问题与后续优化

> 记录当前已知但暂缓处理的问题，以及处理时机。用于第 6 章「测试与部署」与第 8 章「局限性」。

| 编号 | 问题 | 影响 | 计划处理时机 |
| --- | --- | --- | --- |
| U-01 | 前端界面信息密度偏高，观感偏杂乱，需要简约化重构 | 用户体验（10% 权重） | P6 之后（有真实数据时），提交前 2 周做最后打磨 |
| I-01 | 前端目前使用演示数据，尚未接入后端 API | 功能演示 | P1~P2 完成接口后接入 |
| F-01 | 扫描件（无文本层 PDF）尚无 OCR 能力，只能标记 need_review | 官方 3.5 硬性用例之一 | P2 阶段引入视觉模型做页面识别 |
| F-02 | 公式仅按纯文本展示，未做 LaTeX 渲染 | 观感 | 引入 KaTeX 后处理 |
| T-01 | `ORJSONResponse` 已被 FastAPI 0.143 标记废弃 | 仅日志告警 | 下次改动 exceptions.py 时顺带替换 |
| P-01 | 书籍型 PDF 的参考文献区边界识别不稳：其 `Bibliography` 页眉每页出现，且文献区之后还有 `Index` 区，导致条目中混入索引内容 | 参考文献准确性（影响「引文核验」功能） | 用更稳的分栏阅读顺序 + 引用格式（作者-年份）聚类替代当前的行距切段 |
| P-02 | 双栏 PDF 的阅读顺序按「行优先」而非「栏优先」，导致跨栏的条目被拼接 | 同上 | 解析时按检测到的栏边界切分，再按栏内顺序输出 |
| P-03 | 表格提取能力弱：`page.find_tables()` 在前 60 页书籍中检测到 0 个表格 | 需求 1.1 要求表格提取 | 评估 `pymupdf_layout`（官方技术栈提及，可显著改善版面分析） |

| Q-01 | 4 条 `ORJSONResponse is deprecated` 告警（FastAPI 0.143 起内置序列化更快） | 仅日志告警 | 下次改动 exceptions.py 时替换为 JSONResponse |
  