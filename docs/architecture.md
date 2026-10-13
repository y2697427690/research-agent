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

## 附录 A：踩坑记录

> 开发过程中实际遇到并解决的问题。这部分是一手材料，用于第 4 章「优化策略」与第 6 章「测试与部署」。

- SQLite 默认不开外键约束，必须在连接时 PRAGMA foreign_keys=ON，
  否则外键写了等于没写（实测：插入不存在的 pid 竟然成功）
- .gitignore 里 ! 反向排除必须紧跟被排除规则，
  否则 .env.* 会把 .env.example 一并吃掉


  