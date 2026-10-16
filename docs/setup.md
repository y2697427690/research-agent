# 环境配置说明

> 本文档对应比赛提交要求 §2.1「环境配置：提供完整的**环境配置说明**（含环境变量模板、依赖清单）」。
>
> 目标：任何人拿到这个仓库后，能在 **10 分钟内**把前后端跑起来。

---

## 1. 环境要求

| 组件 | 版本要求 | 实测版本 | 是否必需 | 说明 |
| --- | --- | --- | --- | --- |
| **Python** | ≥ 3.11 | 3.12.14 / 3.14.7 | ✅ 必需 | 后端运行环境 |
| **Node.js** | ≥ 18 | v18.19.0 | ⚠️ 仅开发 | 前端**零依赖**，运行不需要 Node；只有跑前端自测脚本时才需要 |
| **SQLite** | 内置 | — | ✅ 必需 | Python 标准库自带，无需安装 |
| **Git** | ≥ 2.30 | 2.53.0 | ⚠️ 开发需要 | 拉取代码与版本管理 |
| 大模型 API | OpenAI 兼容 | — | ⚠️ 可选 | 未配置时后端仍可运行，走规则降级 |

### 为什么 Python 要 ≥ 3.11

代码中使用了 `X | None` 联合类型语法与 `Mapped[...]` 类型标注，这些需要 3.10+ 与 3.11+ 的运行时支持。

---

## 2. 后端配置

### 2.1 创建虚拟环境

**虚拟环境是必需的**，不要直接装在系统 Python 或 conda base 里——否则不同项目的依赖会互相污染。

```powershell
cd backend

# 创建（把 python 换成你自己的解释器路径）
python -m venv .venv

# 激活
.\.venv\Scripts\Activate.ps1        # Windows PowerShell
# source .venv/bin/activate         # macOS / Linux
```

**激活成功的标志**：命令行提示符前出现 `(.venv)`。

> **如果 PowerShell 报「禁止运行脚本」**：
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```
> 这只对当前窗口生效，关闭后恢复。

### 2.2 安装依赖

```powershell
python -m pip install -e ".[dev]"
```

| 部分 | 内容 |
| --- | --- |
| `-e` | 以「可编辑模式」安装当前目录，让你能 `import app.*` |
| `.[dev]` | 额外安装开发依赖（pytest / ruff / respx） |

> **⚠️ 一定要用 `python -m pip` 而不是直接 `pip`**。
> 实测踩坑：直接 `pip install` 时，若终端里的 `pip` 指向了 conda base，
> 依赖会被装到 base 而不是 `.venv`，`import fastapi` 就会失败。
> `python -m pip` 保证用的是**当前解释器**的 pip。

**依赖清单**（声明在 `backend/pyproject.toml`）：

| 分类 | 包 |
| --- | --- |
| Web 框架 | `fastapi`、`uvicorn[standard]`、`pydantic`、`pydantic-settings`、`orjson` |
| 文件上传 | `python-multipart`（**fastapi 的可选依赖，必须显式安装**，否则上传接口报错） |
| 数据层 | `SQLAlchemy[asyncio]`（方括号不能省，否则缺 greenlet 直接崩）、`aiosqlite`、`alembic` |
| PDF 解析 | `PyMuPDF` |
| 大模型 | `openai`、`httpx`、`tenacity` |
| 图论 | `networkx` |
| 数据处理 | `numpy`、`pandas`、`arxiv`、`APScheduler` |
| 开发依赖 | `pytest`、`pytest-asyncio`、`respx`、`ruff` |

> **向量检索**（可选，会拉入约 2GB 的 torch）：
> ```powershell
> python -m pip install -e ".[vectors]"
> ```

### 2.3 配置环境变量

```powershell
# 复制模板
copy .env.example .env
```

然后编辑 `backend/.env`，**至少填入 API Key**：

```ini
APP_LLM_BASE_URL=https://api.deepseek.com/v1
APP_LLM_API_KEY=sk-你的真实Key
APP_LLM_MODEL_CHAT=deepseek-chat
APP_LLM_MODEL_REASONER=deepseek-reasoner
APP_LOG_LEVEL=INFO
APP_DEBUG=true
```

**所有变量**（前缀 `APP_` 由 `pydantic-settings` 的 `env_prefix` 定义）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_APP_NAME` | `科研小助手 Agent API` | 应用名 |
| `APP_APP_VERSION` | `0.1.0` | 版本号 |
| `APP_DEBUG` | `true` | 调试模式 |
| `APP_LOG_LEVEL` | `INFO` | 日志级别（DEBUG / INFO / WARNING / ERROR） |
| `APP_LLM_BASE_URL` | `https://api.deepseek.com/v1` | 大模型接口地址 |
| `APP_LLM_API_KEY` | 空 | **API Key，绝不提交** |
| `APP_LLM_MODEL_CHAT` | `deepseek-chat` | 对话模型 |
| `APP_LLM_MODEL_REASONER` | `deepseek-reasoner` | 推理模型 |
| `APP_LLM_TIMEOUT` | `60.0` | 请求超时（秒） |
| `APP_LLM_MAX_RETRY` | `2` | 失败重试次数 |
| `APP_DATA_DIR` | `backend/data` | 数据目录 |
| `APP_STORAGE_DIR` | `backend/data/papers` | PDF 存储目录 |
| `APP_STATIC_DIR` | `backend/app/static` | 文档页静态资源目录 |
| `APP_MAX_UPLOAD_MB` | `200` | 单文件上传上限（MB） |
| `APP_MAX_FILES_PER_REQUEST` | `10` | 单次上传文件数上限 |

### 2.4 启动

```powershell
uvicorn app.main:app --reload --port 8000
```

| 地址 | 说明 |
| --- | --- |
| http://127.0.0.1:8000/docs | **Swagger UI 接口文档**（推荐从这里开始验证） |
| http://127.0.0.1:8000/redoc | ReDoc 风格的接口文档 |
| http://127.0.0.1:8000/openapi.json | OpenAPI 规范（机器可读） |
| http://127.0.0.1:8000/api/v1/health | 健康检查 |

首次启动会自动创建 `backend/data/app.db` 与数据表。

### 2.5 验证装好了

```powershell
# 1) 全部依赖能正常导入
python -c "import fastapi, sqlalchemy, aiosqlite, networkx, pymupdf, pydantic_settings, orjson; print('依赖导入 OK')"

# 2) 配置能加载、路径正确
python -c "from app.core.config import settings; print(settings.db_url)"

# 3) 单元测试通过
python -m pytest tests -q

# 4) 代码规范零告警
python -m ruff check app tests
```

**期望输出**：

```
依赖导入 OK
sqlite+aiosqlite:///D:/.../backend/data/app.db
82 passed
All checks passed!
```

---

## 3. 前端配置

前端**零依赖、零构建**，不需要 npm install。

```powershell
# 直接用浏览器打开
start frontend\index.html
```

如果要跑前端自测（需要 Node.js）：

```powershell
node frontend/tools/smoke/run.js
# 期望：80/80 通过，加载错误 0 个
```

如果要接后端 API（**目前尚未接通**），需修改 `frontend/scripts/config.js` 中的 API 地址：

```js
window.__API_BASE__ = 'http://127.0.0.1:8000/api/v1';
```

---

## 4. 常见问题

### 4.1 `ModuleNotFoundError: No module named 'app'`

**原因**：不在 `backend` 目录下运行。

```powershell
cd backend        # 必须先进入这个目录
python -c "from app.core.config import settings; print('ok')"
```

**验证方法**：`pwd` 的输出必须以 `backend` 结尾。

### 4.2 `ModuleNotFoundError: No module named 'greenlet'`

**原因**：`pyproject.toml` 里把 `SQLAlchemy[asyncio]` 写成了 `SQLAlchemy`。

```powershell
python -m pip install "SQLAlchemy[asyncio]"
```

### 4.3 `RuntimeError: Form data requires "python-multipart" to be installed`

**原因**：`python-multipart` 没装。它是 fastapi 的**可选依赖**，装普通 `fastapi` 时不会自动带上。

```powershell
python -m pip install python-multipart
```

### 4.4 依赖装到了 conda base 而不是 `.venv`

**现象**：虚拟环境里 `pip list` 几乎没有包，但 base 里多了一堆。

**原因**：使用了裸 `pip`，而它指向了 base 的 pip。

```powershell
# 正确做法
python -m pip install -e ".[dev]"

# 验证当前解释器
python -c "import sys; print(sys.prefix)"
# 应输出 ...\backend\.venv
```

### 4.5 `/docs` 页面白屏

**原因**：FastAPI 内置文档页从 `cdn.jsdelivr.net` 加载 swagger-ui 资源，该 CDN 在部分网络下连接被重置。

**本项目已解决**：静态资源已放入 `backend/app/static/`，通过 `StaticFiles` 自托管，不依赖外网。

**如果仍白屏**：按 `F12` 查看 Console 与 Network 面板，确认没有请求外部 CDN。必要时 `Ctrl + Shift + R` 强制刷新。

### 4.6 终端里中文显示乱码或被截断

**原因**：Windows PowerShell 5.1 控制台默认 GBK，与 Python 的 UTF-8 输出冲突。症状不只是乱码——当输出含 GBK 无法编码的字符（如中文引号 `“”`）时，Python 会**从该处截断整行**。

**解决**（两条都要）：

```powershell
chcp 65001
$env:PYTHONIOENCODING = "utf-8"
```

**更省心的替代方案**：把输出重定向到文件，用 VS Code 打开（全程 UTF-8，永不乱码）：

```powershell
python 你的脚本.py > out.txt 2>&1
code out.txt
```

### 4.7 `sqlite3.OperationalError: unable to open database file`

**排查顺序**：

1. `backend/data/` 目录是否存在且**可写**
2. 数据库路径是否正确：`python -c "from app.core.config import settings; print(settings.db_url)"`
3. 文件是否被其它进程占用（如另一个 uvicorn 实例）

### 4.8 端口 8000 被占用

```powershell
uvicorn app.main:app --reload --port 8001
```

---

## 5. 目录与数据说明

| 路径 | 内容 | 是否提交 |
| --- | --- | --- |
| `backend/.venv/` | 虚拟环境 | ❌ 已忽略 |
| `backend/data/app.db` | SQLite 数据库 | ❌ 已忽略 |
| `backend/data/papers/` | 上传的 PDF 文件 | ❌ 已忽略 |
| `backend/.env` | 本地环境变量（含密钥） | ❌ **已忽略，绝不提交** |
| `backend/.env.example` | 环境变量模板 | ✅ 提交 |
| `backend/app/static/` | 文档页静态资源 | ✅ 提交（约 3.8 MB） |
| `backend/*.txt`、`backend/try_*.py` | 开发调试的临时文件 | ❌ 已忽略 |

---

## 6. 依赖清单与版本锁定

- **直接依赖**：声明在 `backend/pyproject.toml` 的 `[project] dependencies`
- **开发依赖**：声明在同文件的 `[project.optional-dependencies] dev`
- **完整锁定清单**（含间接依赖的精确版本）：

```powershell
cd backend
python -m pip freeze > requirements.lock.txt
```

> 锁定清单用于**复现完全相同的环境**。建议在依赖稳定后生成一次并提交。
