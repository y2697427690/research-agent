# 一键更新线上服务器
#
# 背景：国内云服务器访问 GitHub 常被阻断，无法直接在服务器上 git pull。
# 因此流程改为「本地打包 → scp 上传 → 服务器从 bundle 拉取」。
#
# 用法（在你自己的电脑上，PowerShell 里执行）：
#     .\deploy\update_online.ps1
#     .\deploy\update_online.ps1 -Ip 47.96.97.141
#     .\deploy\update_online.ps1 -SkipRestart      # 只更新代码不重启服务
#
# 前置条件：
#   1. 本机已能免密 ssh root@<IP>（已配置过公钥）
#   2. 本地仓库工作区干净或改动已提交

param(
    [string]$Ip = "47.96.97.141",
    [string]$AppDir = "/opt/research-agent",
    [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundle = Join-Path $env:TEMP "repo.bundle"

Write-Host "==> 1/4 检查本地仓库状态" -ForegroundColor Cyan
Push-Location $repoRoot
try {
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "    ! 工作区有未提交改动，线上将与本地不一致：" -ForegroundColor Yellow
        $dirty | ForEach-Object { Write-Host "      $_" }
        $ans = Read-Host "    仍然继续？(y/N)"
        if ($ans -ne "y") {
            Write-Host "    已取消" -ForegroundColor Red
            exit 1
        }
    }
    $head = (git rev-parse --short HEAD).Trim()
    Write-Host "    本地 HEAD: $head"

    Write-Host "`n==> 2/4 打包 git bundle" -ForegroundColor Cyan
    if (Test-Path $bundle) { Remove-Item $bundle -Force }
    git bundle create $bundle --all | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git bundle 失败" }
    $sizeMB = [math]::Round((Get-Item $bundle).Length / 1MB, 2)
    Write-Host "    已生成: $bundle ($sizeMB MB)"
}
finally {
    Pop-Location
}

Write-Host "`n==> 3/4 上传到服务器 root@${Ip}" -ForegroundColor Cyan
scp $bundle "root@${Ip}:/root/repo.bundle"
if ($LASTEXITCODE -ne 0) { throw "scp 上传失败（检查能否免密 ssh root@$Ip）" }
Write-Host "    上传完成"

Write-Host "`n==> 4/4 服务器拉取并重启" -ForegroundColor Cyan
$remote = @"
set -e
cd $AppDir
git pull /root/repo.bundle main
git --no-pager log --oneline -3
"@
if (-not $SkipRestart) {
    $remote += @"

systemctl restart research-agent
sleep 4
systemctl is-active research-agent
curl -s -m 10 http://127.0.0.1:8000/api/v1/health
"@
}
ssh "root@${Ip}" $remote
if ($LASTEXITCODE -ne 0) { throw "服务器端更新失败" }

Write-Host "`n==> 完成" -ForegroundColor Green
if (-not $SkipRestart) {
    Write-Host "    验证: http://${Ip}:8000/docs" -ForegroundColor Green
    Write-Host "    或运行: python deploy/verify_online.py" -ForegroundColor Green
}
