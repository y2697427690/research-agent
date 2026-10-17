# 一键更新线上服务器
#
# 背景：国内云服务器访问 GitHub 常被阻断，无法直接在服务器上 git pull。
# 流程改为「本地打包 → scp 上传 → 服务器从 bundle 拉取 → 重启服务」。
#
# 用法（在你自己的电脑上执行）：
#     .\deploy\update_online.ps1
#     .\deploy\update_online.ps1 -Ip 47.96.97.141
#     .\deploy\update_online.ps1 -SkipRestart      # 只更新代码，不重启服务
#
# 前置条件：
#   1. 本机已能免密 ssh root@<IP>（已配置过公钥）
#   2. 本地改动已提交（脚本会检查并提示）

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
        $dirty | ForEach-Object { Write-Host ("      " + $_) }
        $ans = Read-Host "    仍然继续？(y/N)"
        if ($ans -ne "y") {
            Write-Host "    已取消" -ForegroundColor Red
            exit 1
        }
    }
    $head = (git rev-parse --short HEAD).Trim()
    Write-Host ("    本地 HEAD: " + $head)

    Write-Host ""
    Write-Host "==> 2/4 打包 git bundle" -ForegroundColor Cyan
    if (Test-Path $bundle) { Remove-Item $bundle -Force }
    git bundle create $bundle --all | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git bundle 失败" }
    $sizeMB = [math]::Round((Get-Item $bundle).Length / 1MB, 2)
    Write-Host ("    已生成: " + $bundle + " (" + $sizeMB + " MB)")
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host ("==> 3/4 上传到 root@" + $Ip + ":/root/repo.bundle") -ForegroundColor Cyan
scp $bundle ("root@" + $Ip + ":/root/repo.bundle")
if ($LASTEXITCODE -ne 0) { throw ("scp 上传失败，请检查能否免密 ssh root@" + $Ip) }
Write-Host "    上传完成"

Write-Host ""
Write-Host "==> 4/4 服务器端拉取并重启" -ForegroundColor Cyan
# 服务器作为部署目标，应保持为仓库的纯镜像：先丢弃服务器上的任何本地改动
# （例如曾用 sed 手工修过的文件），否则 git pull 会因「本地改动将被覆盖」而拒绝合并。
# .env 与 data/ 均在 .gitignore 中，不受 reset 影响。
$cmd = "cd " + $AppDir + " && git reset --hard HEAD -q && git pull /root/repo.bundle main && git --no-pager log --oneline -3"
if (-not $SkipRestart) {
    $cmd = $cmd + " && systemctl restart research-agent && sleep 4 && systemctl is-active research-agent && curl -s -m 10 http://127.0.0.1:8000/api/v1/health"
}
ssh ("root@" + $Ip) $cmd
if ($LASTEXITCODE -ne 0) { throw "服务器端更新失败" }

Write-Host ""
Write-Host "==> 完成" -ForegroundColor Green
if (-not $SkipRestart) {
    Write-Host ("    在线验证: python deploy/verify_online.py")
    Write-Host ("    接口文档: http://" + $Ip + ":8000/docs")
}
