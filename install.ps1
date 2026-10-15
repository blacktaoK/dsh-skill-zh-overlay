# 一键安装 / 检查 / 卸载（转发到 tools/apply.ps1）
#
#   pwsh -NoProfile -File install.ps1            # 安装或更新，并刷新页面提示
#   pwsh -NoProfile -File install.ps1 -Check     # 只看状态
#   pwsh -NoProfile -File install.ps1 -Revert    # 完整卸载还原
[CmdletBinding()]
param(
    [switch]$Revert,
    [switch]$Check,
    [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'
$apply = Join-Path $PSScriptRoot 'tools\apply.ps1'

$fwd = @{}
if ($Revert)  { $fwd['Revert']  = $true }
if ($Check)   { $fwd['Check']   = $true }
if ($Profile) { $fwd['Profile'] = $Profile }

& $apply @fwd
