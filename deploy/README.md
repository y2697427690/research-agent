# 部署说明

> 目标：把后端部署到一台云服务器，让评审可以通过公网 URL 访问在线演示。

---

## 一、服务器要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| 系统 | **Ubuntu 22.04 / 24.04 LTS** | 24.04 自带 Python 3.12；22.04 自带 3.10，脚本会自动补装 3.12 |
| 配置 | **2 核 2 GB** 起 | 解析大型 PDF 时更从容；1 核可用但慢 |
| 磁盘 | 40 GB 以上 | 依赖约 1 GB，上传的 PDF 另占空间 |
| 带宽 | 3 Mbps 起 | 上传 PDF 与 LLM 流式输出够用 |
| 端口 | 放行 **22**（SSH）与 **8000**（API） | 云控制台的「防火墙 / 安全组」里配置 |

> **不想备案**：直接访问 `http://<公网IP>:8000`，走非 80 端口，**无需备案**。
> 若使用域名 + 80/443，国内机房需要先完成 ICP 备案（约 2~3 周）。

---

## 二、一键部署

登录服务器（root），执行：

```bash
# 1. 装 git（用于拉取代码）
apt-get update -y && apt-get install -y git

# 2. 获取代码
git clone https://github.com/y2697427690/research-agent.git /opt/research-agent

# 3. 执行部署脚本
bash /opt/research-agent/deploy/setup_server.sh
```

脚本会依次完成：安装基础工具 → 确保 Python ≥ 3.11 → 拉取代码 →
建虚拟环境并装依赖 → 生成 `.env` → 配置 systemd → 启动服务 → 打印访问地址。

**幂等**：可重复执行；已存在的仓库会 `git reset --hard origin/main`，已存在的 venv 会复用。

---

## 三、填写 API Key

脚本首次运行会从模板生成 `backend/.env`，但 **Key 是空的**，需要手动填：

```bash
nano /opt/research-agent/backend/.env
```

填入：

```ini
APP_LLM_BASE_URL=https://api.deepseek.com/v1
APP_LLM_API_KEY=sk-你的真实Key
```

保存（`Ctrl+O` → 回车 → `Ctrl+X`），然后重启服务：

```bash
systemctl restart research-agent
```

> **安全提醒**：`.env` 已在 `.gitignore` 中，不会被提交。**不要**把它复制到其它地方或写进文档。

---

## 四、验证

```bash
# 服务状态
systemctl status research-agent

# 本机自检
curl -s http://127.0.0.1:8000/api/v1/health

# 外网访问（在你自己的电脑上打开）
# http://<公网IP>:8000/docs
```

**健康检查的期望返回**：

```json
{
  "status": "ok",
  "app": "科研小助手 Agent API",
  "version": "0.1.0",
  "db": { "ok": true, "url_scheme": "sqlite+aiosqlite" },
  "llm": { "configured": true, "...": "..." }
}
```

> `db.ok` 必须为 `true`；`llm.configured` 在填了 Key 后应为 `true`。

---

## 五、常用运维命令

| 操作 | 命令 |
| --- | --- |
| 查看状态 | `systemctl status research-agent` |
| 实时日志 | `journalctl -u research-agent -f` |
| 最近 100 行日志 | `journalctl -u research-agent -n 100 --no-pager` |
| 重启 | `systemctl restart research-agent` |
| 停止 / 启动 | `systemctl stop research-agent` / `systemctl start research-agent` |
| 更新代码并重启 | `cd /opt/research-agent && git pull && systemctl restart research-agent` |
| 重跑部署脚本 | `bash /opt/research-agent/deploy/setup_server.sh` |

---

## 六、故障排查

### 6.1 外网打不开，但本机 `curl` 正常

**原因**：云控制台的防火墙 / 安全组没放行 8000。

**解决**：控制台 → 服务器详情 → 防火墙（或安全组）→ 添加规则 → TCP 8000 → 授权对象 `0.0.0.0/0`。

### 6.2 服务起不来

```bash
journalctl -u research-agent -n 60 --no-pager
```

常见原因：

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `ModuleNotFoundError: No module named 'app'` | 工作目录不对 | 检查 service 文件里的 `WorkingDirectory` |
| `No module named 'greenlet'` | 装成了 `SQLAlchemy` 而非 `SQLAlchemy[asyncio]` | `./.venv/bin/python -m pip install "SQLAlchemy[asyncio]"` |
| `python: command not found` | venv 未创建成功 | 删除 `.venv` 重跑脚本 |
| `Address already in use` | 8000 端口被占 | `ss -lntp \| grep 8000` 查占用进程 |

### 6.3 `/docs` 白屏

本项目已把 swagger-ui 静态资源本地化到 `backend/app/static/`，**不依赖外部 CDN**。

若仍白屏，多半是浏览器缓存：`Ctrl + Shift + R` 强制刷新。

### 6.4 上传大文件失败

默认单文件上限 200 MB（`APP_MAX_UPLOAD_MB`）。若需更大，同时调整两处：

1. `backend/.env` 里的 `APP_MAX_UPLOAD_MB`
2. 若启用 nginx，调整 `client_max_body_size`

### 6.5 依赖安装很慢或失败

服务器在国内访问 PyPI 可能较慢，可换镜像源：

```bash
/opt/research-agent/backend/.venv/bin/python -m pip config set global.index-url \
  https://pypi.tuna.tsinghua.edu.cn/simple
```

然后重跑部署脚本。

---

## 七、可选：nginx 反向代理与域名

当前直接用 `http://<IP>:8000` 即可。若之后需要绑定域名或加 HTTPS：

```bash
sudo apt install -y nginx
sudo cp /opt/research-agent/deploy/nginx.conf /etc/nginx/sites-available/research-agent
sudo ln -s /etc/nginx/sites-available/research-agent /etc/nginx/sites-enabled/
# 编辑 server_name 为你的域名
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS 可用 certbot 免费申请：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

> ⚠️ `deploy/nginx.conf` 里已为 SSE 关闭了 `proxy_buffering` —— **这一项对问答流式输出是必需的**，否则回答会憋一大段才显示。

---

## 八、可选：Docker 部署

官方技术栈推荐 Docker + Docker-Compose，若需要可后续补充 `Dockerfile` 与 `compose.yaml`。
当前以 systemd + venv 部署，优点是调试直观、依赖清晰；容器化的收益是环境完全可复现。
