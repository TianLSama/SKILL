# 把开发源码同步到 DSH 的运行时插件目录，避免工作区路径变化导致插件无法加载。
# 用法：
#   pwsh -File scripts\sync-to-dsh.ps1
#   pwsh -File scripts\sync-to-dsh.ps1 -Destination 'D:\somewhere\qwen-omni-bridge'
[CmdletBinding()]
param(
  [string]$Destination = (Join-Path $env:USERPROFILE '.dsh\plugins\qwen-omni-bridge')
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh\plugins'))
$dest = [IO.Path]::GetFullPath($Destination)

if (-not $dest.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "目标目录必须位于 $allowedRoot 内，拒绝写入：$dest"
}
if (-not (Test-Path (Join-Path $source 'index.js'))) {
  throw "找不到源码入口：$source\index.js"
}

Write-Host "同步源：$source"
Write-Host "目标：  $dest"
New-Item -ItemType Directory -Force $dest | Out-Null

foreach ($file in @('index.js', 'package.json', 'cordis.patch.yml', 'icon.svg', 'README.md')) {
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $dest $file) -Force
}
foreach ($dir in @('lib', 'locale')) {
  $target = Join-Path $dest $dir
  if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $source $dir) -Destination $target -Recurse -Force
}

# 安装运行期依赖（schemastery）。node_modules 留在目标目录，工作区路径变化不影响加载。
Push-Location $dest
try {
  npm install --omit=dev --no-package-lock --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败（exit $LASTEXITCODE）" }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host '同步完成。请在 DSH 中重新安装指向运行时副本的 bundle：'
Write-Host "  plugin_manager install_bundle target=$dest"
