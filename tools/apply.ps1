<#
  技能卡片中文说明浮层 —— 安装器

  做四件事：
   1) 把插件本体（仓库根的 lib/ data/ package.json cordis.patch.yml）
      复制进一个 desktop generation 目录
      （.generations\live\dsh-skill-zh-overlay+<ver>+local0000000），这是
      dsh-desktop 认可的落盘位置；generation 必须自包含，
      不能反向引用源码目录。
   2) 在 web profile 的 package.json 里登记四处，让它出现在
      「已安装插件」列表里并可被开关：
        dependencies.                        —— 市场的 readInstalled() 读这个
        pnpm.overrides.                      —— link: 指向 generation
        dsh.profile.bundles[]                —— 有它=启用，无它=停用
        dsh.desktop.generationProjection     —— desktop 的版本投影
      同时更新 .generations\desired.json。
   3) 把 data/skill-zh-map.json 从仓库根同步进 generation 里那份。
   4) 给 dsh-skill-mcp-panel 的 lib/client.js 装上装饰脚本（卡片展开时把中文说明
      渲染到英文原文上方）。这一步复用 lib/installer.js 的实现 —— 插件启动时也会
      自己跑一遍，两边同一份逻辑、幂等，重复执行不会叠加。

  幂等、可回滚、面板插件升级后重跑即可。

  用法（在仓库根执行，或 -FromRepo 指定仓库根）：
    pwsh -NoProfile -File tools/apply.ps1            # 安装 / 更新
    pwsh -NoProfile -File tools/apply.ps1 -Check     # 只看状态
    pwsh -NoProfile -File tools/apply.ps1 -Revert    # 完整还原
    pwsh -NoProfile -File tools/apply.ps1 -Profile web
#>
[CmdletBinding()]
param(
    [switch]$Revert,
    [switch]$Check,
    [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$Harness    = Join-Path $env:APPDATA 'dsh-desktop\harness'
$Profiles   = Join-Path $Harness 'profiles'
$ProfileDir = Join-Path $Profiles $Profile
$ProfileJson= Join-Path $ProfileDir 'package.json'
$Generations= Join-Path $Profiles '.generations'
$LiveDir    = Join-Path $Generations 'live'
$DesiredJson= Join-Path $Generations 'desired.json'
$ClientJs   = Join-Path $ProfileDir 'node_modules\dsh-skill-mcp-panel\lib\client.js'
$NodeModules= Join-Path $ProfileDir 'node_modules'

# 仓库根 = 本脚本所在目录的上一级（tools/ 的父目录）。
$SrcDir     = Split-Path -Parent $PSScriptRoot
$MapJson    = Join-Path $SrcDir 'data\skill-zh-map.json'
$Fragment   = Join-Path $SrcDir 'lib\patch.fragment.js'

$PluginName = 'dsh-skill-zh-overlay'
$PluginVer  = '1.0.0'
# generation 目录名形如 <pkg>+<ver>+<shortHash>；本地包用一个固定短标记。
$GenId      = "$PluginName+$PluginVer+local0000000"
$GenDir     = Join-Path $LiveDir $GenId
$GenPkgDir  = Join-Path $GenDir "node_modules\$PluginName"
$LinkPath   = Join-Path $NodeModules $PluginName
$LinkSpec   = "link:../.generations/live/$GenId/node_modules/$PluginName"

# 前端补丁逻辑跑「已安装的那份」——lib/installer.js 靠自身真实路径往上找 profiles/，
# 从仓库根跑会落到工作区里，找不到面板。（必须定义在 $GenPkgDir 之后。）
$Installer  = Join-Path $GenPkgDir 'lib\installer.js'

$MarkerStart = '/* __SKILL_ZH_OVERLAY__ */'
$MarkerEnd   = '/* __SKILL_ZH_OVERLAY_END__ */'
$BakExt      = '.skvzh.bak'

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string]$p) { [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8) }
function Write-Text([string]$p, [string]$t) { [System.IO.File]::WriteAllText($p, $t, $Utf8NoBom) }

# manifest 里读一个可能不存在的字段，没读到返回 $null。
function Get-Field($obj, [string]$name) {
    if ($null -eq $obj) { return $null }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p) { return $null }
    return $p.Value
}

function Read-Profile { Get-Content -LiteralPath $ProfileJson -Raw -Encoding UTF8 | ConvertFrom-Json }
function Save-Profile($j) {
    # 原子写：临时文件 + 改名，避免写坏 manifest。
    $tmp = "$ProfileJson.tmp-$PID-$(Get-Random)"
    Write-Text $tmp (($j | ConvertTo-Json -Depth 100) + "`n")
    Move-Item -LiteralPath $tmp -Destination $ProfileJson -Force
}

# ── 状态检查 ────────────────────────────────────────────────────────────
if ($Check) {
    $j = Read-Profile
    $inDeps    = $null -ne (Get-Field (Get-Field $j 'dependencies') $PluginName)
    $inOver    = $null -ne (Get-Field (Get-Field (Get-Field $j 'pnpm') 'overrides') $PluginName)
    $bundles   = @(Get-Field (Get-Field (Get-Field $j 'dsh') 'profile') 'bundles')
    $inBundles = $bundles -contains $PluginName

    Write-Host "仓库根     : $SrcDir"
    Write-Host "generation : $GenDir"
    Write-Host ("             " + $(if (Test-Path -LiteralPath $GenPkgDir) { '已落盘' } else { '缺失' }))
    Write-Host "profile 登记"
    Write-Host ("             dependencies: " + $(if ($inDeps) { '有' } else { '无' }))
    Write-Host ("             overrides   : " + $(if ($inOver) { '有' } else { '无（可选）' }))
    Write-Host ("             bundles     : " + $(if ($inBundles) { '有（已启用）' } else { '无（停用/未装）' }))
    Write-Host "链接       : $LinkPath"
    Write-Host ("             " + $(if (Test-Path -LiteralPath $LinkPath) { '已安装' } else { '未安装' }))
    Write-Host "client.js 补丁"
    Write-Host ("             " + $(if ((Test-Path -LiteralPath $ClientJs) -and (Read-Text $ClientJs).Contains($MarkerStart)) { '已安装' } else { '未安装' }))
    Write-Host ("备份       : " + $(if (Test-Path -LiteralPath ($ClientJs + $BakExt)) { $ClientJs + $BakExt } else { '无' }))
    return
}

# ── 还原 ────────────────────────────────────────────────────────────────
if ($Revert) {
    $bak = $ClientJs + $BakExt
    if (Test-Path -LiteralPath $bak) {
        Copy-Item -LiteralPath $bak -Destination $ClientJs -Force
        Write-Host '已还原 client.js'
    } else { Write-Host 'client.js 无备份，跳过' }

    # 撤掉 profile 登记
    if (Test-Path -LiteralPath $ProfileJson) {
        $j = Read-Profile
        $changed = $false
        if ($null -ne (Get-Field $j.dependencies $PluginName)) {
            $j.dependencies.PSObject.Properties.Remove($PluginName); $changed = $true
        }
        if ($null -ne (Get-Field $j.pnpm.overrides $PluginName)) {
            $j.pnpm.overrides.PSObject.Properties.Remove($PluginName); $changed = $true
        }        $bundles = @(Get-Field $j.dsh.profile 'bundles')
        if ($bundles -contains $PluginName) {
            $j.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne $PluginName })
            $changed = $true
        }
        if ($null -ne (Get-Field $j.dsh.desktop.generationProjection.plugins $PluginName)) {
            $j.dsh.desktop.generationProjection.plugins.PSObject.Properties.Remove($PluginName); $changed = $true
        }
        if ($changed) { Save-Profile $j; Write-Host '已从 profile package.json 撤销登记' }
    }

    if (Test-Path -LiteralPath $DesiredJson) {
        $want = @(Get-Content -LiteralPath $DesiredJson -Raw -Encoding UTF8 | ConvertFrom-Json)
        if ($want -contains $GenId) {
            $kept = @($want | Where-Object { $_ -ne $GenId })
            Write-Text $DesiredJson (($kept | ConvertTo-Json) + "`n")
            Write-Host '已从 desired.json 撤销'
        }
    }

    if (Test-Path -LiteralPath $LinkPath) {
        $item = Get-Item -LiteralPath $LinkPath -Force
        if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
            [System.IO.Directory]::Delete($LinkPath)
        } else {
            Remove-Item -LiteralPath $LinkPath -Recurse -Force
        }
        Write-Host '已移除插件链接'
    }
    if (Test-Path -LiteralPath $GenDir) {
        Remove-Item -LiteralPath $GenDir -Recurse -Force
        Write-Host '已移除 generation 目录'
    }
    Write-Host '重启 dsh 后生效。'
    return
}

# ── 前置检查 ────────────────────────────────────────────────────────────
foreach ($f in @($MapJson, $Fragment, $ProfileJson)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "缺少文件：$f" }
}
if (-not (Test-Path -LiteralPath (Join-Path $SrcDir 'lib\index.js'))) { throw "插件源码不完整：$SrcDir" }

# 校验映射表是合法 JSON
try { $mapObj = Get-Content -LiteralPath $MapJson -Raw -Encoding UTF8 | ConvertFrom-Json }
catch { throw "skill-zh-map.json 不是合法 JSON：$($_.Exception.Message)" }
$names = @($mapObj.PSObject.Properties | Where-Object { -not $_.Name.StartsWith('_') } | ForEach-Object { $_.Name })
Write-Host "映射表条目（$($names.Count)）：$($names -join ', ')"

# ── 1) 同步插件源码到 generation 目录 ───────────────────────────────────
# generation 必须是自包含的：只复制 lib/ 与 data/，不建立指向工作区的链接。
# 这样 desktop 清理 / 重建 generation 时不会牵连工作区源码。
if (Test-Path -LiteralPath $GenPkgDir) { Remove-Item -LiteralPath $GenPkgDir -Recurse -Force }
New-Item -ItemType Directory -Path $GenPkgDir -Force | Out-Null
Copy-Item -Recurse -Force (Join-Path $SrcDir 'lib')  (Join-Path $GenPkgDir 'lib')
Copy-Item -Recurse -Force (Join-Path $SrcDir 'data') (Join-Path $GenPkgDir 'data')
Copy-Item -Force (Join-Path $SrcDir 'package.json')     (Join-Path $GenPkgDir 'package.json')
Copy-Item -Force (Join-Path $SrcDir 'cordis.patch.yml') (Join-Path $GenPkgDir 'cordis.patch.yml')
Write-Text (Join-Path $GenDir 'generation.json') (@{ pluginName = $PluginName; version = $PluginVer } | ConvertTo-Json -Compress)
Write-Text (Join-Path $GenDir 'package.json') (@{
    name = 'dsh-generation'; private = $true; version = '0.0.0'
    dependencies = @{ $PluginName = $PluginVer }
} | ConvertTo-Json -Depth 10)
Write-Host "已写入 generation：$GenDir"

# 映射表以 data/ 那份为准，同步进 generation（源码那份就是仓库里这份）。
Copy-Item -LiteralPath $MapJson -Destination (Join-Path $GenPkgDir 'data\skill-zh-map.json') -Force

# ── 2) profile package.json 登记 ────────────────────────────────────────
$j = Read-Profile
if ($null -eq (Get-Field $j 'dependencies')) { throw 'profile package.json 缺 dependencies 段' }

$j.dependencies | Add-Member -NotePropertyName $PluginName -NotePropertyValue $PluginVer -Force

# pnpm.overrides 是可选的：dsh 靠 node_modules 里的 junction 解析 bundle，
# 不需要 overrides 也能工作。profile 本来没有 pnpm 段时就别硬塞一个进去。
$pnpm = Get-Field $j 'pnpm'
if ($null -ne $pnpm) {
    if ($null -eq (Get-Field $pnpm 'overrides')) {
        $pnpm | Add-Member -NotePropertyName 'overrides' -NotePropertyValue ([pscustomobject]@{})
    }
    $pnpm.overrides | Add-Member -NotePropertyName $PluginName -NotePropertyValue $LinkSpec -Force
}

$bundles = @(Get-Field $j.dsh.profile 'bundles')
if ($bundles -notcontains $PluginName) { $j.dsh.profile.bundles = @($bundles) + $PluginName }

$proj = Get-Field (Get-Field $j.dsh.desktop 'generationProjection') 'plugins'
if ($null -ne $proj) {
    $proj | Add-Member -NotePropertyName $PluginName -NotePropertyValue ([pscustomobject]@{
        generationId = $GenId; visibleVersion = $PluginVer
        previousOverride = [pscustomobject]@{ present = $false }
    }) -Force
}
Save-Profile $j
Write-Host "已登记到 profile package.json（dependencies / overrides / bundles / projection）"

# ── 2b) desired.json ────────────────────────────────────────────────────
if (Test-Path -LiteralPath $DesiredJson) {
    $want = @(Get-Content -LiteralPath $DesiredJson -Raw -Encoding UTF8 | ConvertFrom-Json)
    if ($want -notcontains $GenId) {
        Write-Text $DesiredJson ((@($want) + $GenId | ConvertTo-Json) + "`n")
        Write-Host "已写入 desired.json"
    } else { Write-Host 'desired.json 已含该 generation，跳过。' }
}

# ── 3) node_modules junction ────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $NodeModules)) { throw "profile node_modules 不存在：$NodeModules" }

if (Test-Path -LiteralPath $LinkPath) {
    $item = Get-Item -LiteralPath $LinkPath -Force
    if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
        $target = @($item.Target)[0]
        if ($target -ne $GenPkgDir) {
            [System.IO.Directory]::Delete($LinkPath)
            New-Item -ItemType Junction -Path $LinkPath -Target $GenPkgDir | Out-Null
            Write-Host '已重建插件链接（指向变了）'
        } else { Write-Host '插件链接已存在且指向正确，跳过。' }
    } else {
        throw "$LinkPath 已存在且不是链接，请先手工处理（避免覆盖真实目录）。"
    }
} else {
    New-Item -ItemType Junction -Path $LinkPath -Target $GenPkgDir | Out-Null
    Write-Host "已创建插件链接：$LinkPath -> $GenPkgDir"
}

# ── 4) client.js 装饰脚本 ───────────────────────────────────────────────
# 复用 lib/installer.js —— 与插件启动时走的是同一份实现，幂等。
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '未找到 node，跳过前端补丁。重启 dsh 时插件会自己补上。'
} else {
    $runner = @'
const instPath = process.argv[2];
const mod = await import(new URL('file:///' + instPath.replace(/\\/g, '/')));
const r = mod.ensurePatched();
console.log(r.changed ? '已写入 client.js 补丁' : 'client.js 补丁已是最新，跳过');
if (r.path) console.log('  面板束: ' + r.path);
if (!r.changed && r.reason) console.log('  原因: ' + r.reason);
'@
    $tmpRunner = Join-Path ([System.IO.Path]::GetTempPath()) "skvzh-run-$([guid]::NewGuid().ToString('N')).mjs"
    Write-Text $tmpRunner $runner
    try {
        & node $tmpRunner $Installer
        if ($LASTEXITCODE -ne 0) { throw "前端补丁步骤失败（exit $LASTEXITCODE）" }
    } finally {
        Remove-Item -LiteralPath $tmpRunner -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host '完成。'
Write-Host '插件与 manifest 改动需要重启 dsh 才会生效；client.js 补丁刷新页面即可。'
