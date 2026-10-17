#!/usr/bin/env bash
# 科研小助手 Agent · 服务器一键部署脚本
#
# 用途：在全新的 Ubuntu 22.04 / 24.04 服务器上把后端跑起来。
# 用法（以 root 执行）：
#     bash deploy/setup_server.sh
#
# 脚本做的事：
#   1. 安装基础工具（git / curl / 编译工具）
#   2. 确保 Python >= 3.11 可用
#   3. 拉取代码到 /opt/research-agent
#   4. 创建虚拟环境并安装依赖
#   5. 生成 .env（若不存在）
#   6. 配置 systemd 服务（开机自启 + 崩溃自动重启）
#   7. 启动并打印访问地址
#
# 幂等性：脚本可重复执行。已存在的仓库会 pull，已存在的 venv 会复用。

set -euo pipefail

REPO_URL="https://github.com/y2697427690/research-agent.git"
APP_DIR="/opt/research-agent"
SERVICE="research-agent"
PORT="8000"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[!] %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 前置检查

if [ "$(id -u)" -ne 0 ]; then
    echo "请以 root 执行：sudo bash deploy/setup_server.sh"
    exit 1
fi

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
    warn "本脚本针对 Ubuntu 编写，其它发行版请手动部署或调整包管理器命令"
fi

log "0/6 系统信息"
. /etc/os-release
echo "    发行版: ${PRETTY_NAME:-unknown}"
echo "    架构:   $(uname -m)"
echo "    内存:   $(free -h | awk '/^Mem:/{print $2}')"

# ---------------------------------------------------------------- 1. 基础工具

log "1/6 安装基础工具（git / curl / build-essential）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq git curl ca-certificates build-essential

# ---------------------------------------------------------------- 2. Python

log "2/6 检查 Python 版本（需要 >= 3.11）"
PY=""
for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
        ver=$("$candidate" -c 'import sys; print("%d.%d" % sys.version_info[:2])')
        major=${ver%%.*}
        minor=${ver##*.}
        if [ "$major" -eq 3 ] && [ "$minor" -ge 11 ]; then
            PY="$candidate"
            break
        fi
    fi
done

if [ -z "$PY" ]; then
    warn "系统 Python 低于 3.11，尝试通过 deadsnakes PPA 安装 3.12"
    apt-get install -y -qq software-properties-common
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -y -qq
    apt-get install -y -qq python3.12 python3.12-venv python3.12-dev
    PY="python3.12"
fi

echo "    使用解释器: $PY"
"$PY" --version

# venv 模块在部分镜像里需要单独安装
if ! "$PY" -c 'import venv' >/dev/null 2>&1; then
    apt-get install -y -qq "${PY}-venv"
fi

# ---------------------------------------------------------------- 3. 代码

log "3/6 获取代码到 $APP_DIR"
# SKIP_GIT=skip 用于服务器无法访问 GitHub 的场景（代码已由本地打包上传）
if [ "${SKIP_GIT:-auto}" = "skip" ]; then
    echo "    已指定 SKIP_GIT=skip，跳过 git 同步"
    if [ ! -d "$APP_DIR/backend" ]; then
        echo "    错误：$APP_DIR/backend 不存在，请先把代码上传到该目录"
        exit 1
    fi
elif [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    if git fetch --all -q 2>/dev/null; then
        git reset --hard origin/main
        echo "    已更新到 origin/main"
    else
        warn "git fetch 失败（可能无法访问 GitHub），继续使用现有代码"
    fi
elif [ -d "$APP_DIR/backend" ]; then
    echo "    目录已存在但无 .git，跳过克隆，直接使用现有代码"
else
    mkdir -p "$(dirname "$APP_DIR")"
    if ! git clone "$REPO_URL" "$APP_DIR"; then
        warn "从 GitHub 克隆失败。若服务器访问不了 GitHub，请改为："
        warn "  在本地执行 git bundle create repo.bundle --all，再用 scp 上传后在服务器 clone"
        exit 1
    fi
    echo "    已克隆仓库"
fi

cd "$APP_DIR/backend"

# ---------------------------------------------------------------- 4. 依赖

log "4/6 创建虚拟环境并安装依赖（首次耗时较长）"
if [ ! -d .venv ]; then
    "$PY" -m venv .venv
fi
PIP_ARGS=(--timeout 30 --retries 3)
./.venv/bin/python -m pip install -q -U pip "${PIP_ARGS[@]}"

# 国内服务器直连 PyPI 常出现下载失败（表现为 "No matching distribution found"）。
# 先试默认源，失败则自动切清华镜像重试。
if ./.venv/bin/python -m pip install -q -e . "${PIP_ARGS[@]}"; then
    echo "    已安装主依赖（默认源）"
else
    warn "默认 PyPI 源安装失败，切换清华镜像重试"
    ./.venv/bin/python -m pip config set global.index-url \
        https://pypi.tuna.tsinghua.edu.cn/simple >/dev/null
    ./.venv/bin/python -m pip config set global.trusted-host \
        pypi.tuna.tsinghua.edu.cn >/dev/null
    ./.venv/bin/python -m pip install -q -e . "${PIP_ARGS[@]}"
    echo "    已安装主依赖（清华镜像，该源已写入本 venv 的 pip 配置）"
fi
./.venv/bin/python -c "import fastapi, sqlalchemy, pymupdf, networkx; print('    依赖自检通过')"

# ---------------------------------------------------------------- 5. 环境变量

log "5/6 准备 .env"
if [ ! -f .env ]; then
    cp .env.example .env
    warn "已从模板创建 backend/.env —— 请编辑它并填入真实的 APP_LLM_API_KEY"
    warn "命令：nano $APP_DIR/backend/.env"
else
    echo "    已存在 .env，保持不动"
fi

# ---------------------------------------------------------------- 6. systemd

log "6/6 配置 systemd 服务 $SERVICE"
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Research Assistant Agent API
Documentation=https://github.com/y2697427690/research-agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/backend
# 应用自身通过 pydantic-settings 读取 backend/.env，故此处不重复注入 EnvironmentFile，
# 避免 systemd 对注释与空值的解析差异。
ExecStart=${APP_DIR}/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
Restart=always
RestartSec=3
# 解析 541 页书籍等场景会占用较多 CPU，给足启动时间
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE}" >/dev/null 2>&1
systemctl restart "${SERVICE}"

sleep 4
if systemctl is-active --quiet "${SERVICE}"; then
    echo "    服务已启动"
else
    warn "服务未能启动，查看日志："
    journalctl -u "${SERVICE}" -n 40 --no-pager || true
    exit 1
fi

# ---------------------------------------------------------------- 完成

IP=$(curl -s --max-time 6 https://ifconfig.me 2>/dev/null || curl -s --max-time 6 https://api.ipify.org 2>/dev/null || echo "<服务器公网IP>")

log "部署完成"
cat <<EOF

    访问地址:  http://${IP}:${PORT}/docs
    健康检查:  http://${IP}:${PORT}/api/v1/health

    常用命令:
      查看状态   systemctl status ${SERVICE}
      查看日志   journalctl -u ${SERVICE} -f
      重启服务   systemctl restart ${SERVICE}
      修改配置   nano ${APP_DIR}/backend/.env && systemctl restart ${SERVICE}

    下一步（若外网打不开）:
      确认云控制台的防火墙/安全组已放行 TCP ${PORT}

EOF
