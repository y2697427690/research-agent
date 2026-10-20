# 一键启动：后端 + 前端
#
# 用法（在仓库根目录）：
#     .\start.ps1
#     .\start.ps1 -Port 8000
#     .\start.ps1 -NoBrowser      # 只启动服务，不自动开浏览器
#
# 做的事：
#   1. 检查虚拟环境与端口占用
#   2. 后台启动 uvicorn（带 --reload-dir app，只监视代码目录，
#      避免写数据库触发重启导致请求被掐断）
#   3. 等待健康检查通过
#   4. 用默认浏览器打开前端页面

param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$page = Join-Path $root "frontend\index.html"

Write-Host "==> 1/4 检查环境" -ForegroundColor Cyan
if (-not (Test-Path $python)) {
    Write-Host "    找不到虚拟环境：$python" -ForegroundColor Red
    Write-Host "    请先在 backend 目录创建并安装依赖，见 docs/setup.md" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $page)) {
    Write-Host "    找不到前端页面：$page" -ForegroundColor Red
    exit 1
}
Write-Host "    虚拟环境与前端页面都在"

Write-Host ""
Write-Host "==> 2/4 检查端口 $Port" -ForegroundColor Cyan
$occupied = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($occupied) {
    $owner = ($occupied | Select-Object -First 1).OwningProcess
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue
    Write-Host "    端口 $Port 已被占用（PID $owner）" -ForegroundColor Yellow
    if ($info) { Write-Host ("    " + $info.CommandLine) -ForegroundColor DarkGray }
    Write-Host "    如果这就是本项目之前启动的服务，可以直接用；" -ForegroundColor Yellow
    Write-Host "    否则先停止它：Stop-Process -Id $owner -Force" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "==> 3/4 启动后端" -ForegroundColor Cyan
    # --reload-dir app：只监视代码目录。不加的话 uvicorn 会监视整个 backend，
    # 上传/翻译写 data/app.db 时会被当成「代码变了」而重启，请求随即被掐断。
    $args = @(
        "-m", "uvicorn", "app.main:app",
        "--host", "127.0.0.1",
        "--port", "$Port",
        "--reload",
        "--reload-dir", "app"
    )
    Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $backend -WindowStyle Minimized
    Write-Host "    已在后台启动（最小化窗口，关闭该窗口即停止服务）"

    # 等待健康检查通过，最多等 20 秒
    $ok = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 1000
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2 -UseBasicParsing
            if ($resp.StatusCode -eq 200) { $ok = $true; break }
        } catch {
            # 还没起来，继续等
        }
    }
    if ($ok) {
        Write-Host "    健康检查通过" -ForegroundColor Green
    } else {
        Write-Host "    后端启动超时，请查看那个最小化的窗口里的报错" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "==> 4/4 打开前端页面" -ForegroundColor Cyan
Write-Host "    后端接口文档： http://127.0.0.1:$Port/docs"
Write-Host "    前端页面   ： $page"
if (-not $NoBrowser) {
    Start-Process $page
    Write-Host "    已用默认浏览器打开。若页面顶部提示「未连接后端」，按 Ctrl+Shift+R 强制刷新。" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "==> 完成" -ForegroundColor Green
Write-Host "    停止服务：关闭后端那个最小化的窗口，或执行："
Write-Host "      Get-NetTCPConnection -LocalPort $Port -State Listen | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force }"
