# dsh-skill-zh-overlay

给 [dsh-skill-mcp-panel](https://github.com/Fishquito7/dsh-skill-mcp-panel) 的技能卡片加一块**中文说明浮层**。

展开技能卡片时，最上方显示中文速览 + 分类标签 + 要点列表，下面才是面板原本的英文原文，做到中英对照。适合看不懂英文 description 的用户快速判断「这个技能是干什么的、什么时候该用」。

```
┌─ office-pptx ──────────────────────────  ● 已启用  ⌄ ┐
│  ┌──────────────────────────────────────────────┐   │
│  │ 中文说明   [Office · PPT]                     │   │
│  │ 创建、读取、编辑、检查 PowerPoint 演示文稿…     │   │
│  │  • PPTX 是输入或要交付时就该先加载它。          │   │
│  │  • 默认用内置 Python 环境与随包演示库…          │   │
│  │ ──────────────────────────────────────────── │   │
│  │ EN · Create, read, edit, and check PowerPoint…│   │
│  └──────────────────────────────────────────────┘   │
│  Create, read, edit, and check PowerPoint… 来源: dsh-office │
└─────────────────────────────────────────────────────┘
```

## 它由两半组成

这个功能不是单个文件，而是**一个宿主插件 + 一处前端补丁**：

| 组成 | 位置 | 干什么 |
| --- | --- | --- |
| **宿主插件** `dsh-skill-zh-overlay` | 作为 bundle 挂进 profile | 读映射表，往 `index.html` 注入 `window.__SKILL_ZH_MAP__` |
| **前端补丁** `tools/patch.fragment.js` | 插进 `dsh-skill-mcp-panel/lib/client.js` 顶部 | 读那个全局常量，在卡片展开区渲染中文块 |

为什么非要两半：`/plugins` 是 client-modules 的前缀路由，**未知路径一律 404**
（`@deepseek-ai/dsh-client-modules/lib/index.js:977` 的 `bundleResource`，未知资源返回 `{status:404}`，见 `lib/index.js:990`），所以自定义 json 没法放在那里被前端 fetch 到。数据只能走宿主侧注入。

前端补丁必须改 `client.js` 本体，是因为面板的前端束是**打包产物**，没有留给外部插件的渲染扩展点。

## 仓库结构

```
dsh-skill-zh-overlay/
├── package.json           插件清单（含 dsh.bundle.patch 指向 cordis.patch.yml）
├── cordis.patch.yml       插件自己的 loader patch：把自己 insert 进来
├── lib/
│   └── index.js           宿主侧：读映射表 → 注册 index 注入行
├── data/
│   └── skill-zh-map.json  ★ 中文映射表，日常只改这个
└── tools/
    ├── apply.ps1          安装器（Windows / PowerShell）
    └── patch.fragment.js  注入到面板 client.js 的那段装饰脚本
```

## 安装

前置：已经装了 `dsh-skill-mcp-panel`，且 `dsh-desktop` 的 profile 名叫 `web`
（不是的话加 `-Profile <名字>`）。

```powershell
git clone https://github.com/blacktaoK/dsh-skill-zh-overlay.git
cd dsh-skill-zh-overlay
pwsh -NoProfile -File tools/apply.ps1
```

装完**重启 dsh**（插件登记需要重启才加载），然后刷新页面。

`apply.ps1` 做的事：

1. 把插件本体复制进一个 desktop generation 目录
   （`profiles\.generations\live\dsh-skill-zh-overlay+1.0.0+local0000000`）
2. 在 profile 的 `package.json` 里登记四处，让它出现在**插件市场的「已安装」列表**里：
   - `dependencies` —— 市场的 `readInstalled()` 读这里
   - `pnpm.overrides` —— `link:` 指向 generation
   - `dsh.profile.bundles[]` —— **在列表里 = 启用，移除 = 停用**
   - `dsh.desktop.generationProjection` —— desktop 的版本投影
3. 同步 `.generations\desired.json`
4. 给 `dsh-skill-mcp-panel/lib/client.js` 打前端补丁

其他命令：

```powershell
pwsh -NoProfile -File tools/apply.ps1 -Check     # 看当前装了没有
pwsh -NoProfile -File tools/apply.ps1 -Revert    # 完整还原
```

## 改中文说明

只需要动 `data/skill-zh-map.json`，然后重跑安装器：

```powershell
pwsh -NoProfile -File tools/apply.ps1
```

**不用重启 dsh，刷新页面即可**（映射表由宿主在每次渲染 index 时重新读）。

### 映射表格式

```json
{
  "_readme": "以 _ 开头的键是注释，会被忽略",

  "技能名": {
    "zh": "一句话中文简介，显示在卡片展开区最上方。",
    "tag": "分类标签，显示为小徽章",
    "bullets": ["要点一", "要点二（2-4 条，讲清什么时候用 / 有什么坑）"],
    "en": "可选；填了就固定显示这段英文，不填则用 SKILL.md 里真实的 description"
  }
}
```

`技能名` 必须和卡片上的技能名完全一致（也是面板写在 DOM 上的 `data-skill-name`）。

卡片里显示「**暂无中文说明 —— 在 data/skill-zh-map.json 里给 "xxx" 加一条**」时，
就说明这个技能还没收录，把 `xxx` 照抄成新的 key 即可。

## 原理

```
宿主插件 lib/index.js
   │  注册 webserver/index-inject 回调
   ▼
<profile> 渲染 index.html 时
   │  推入一行 { kind: 'global', name: '__SKILL_ZH_MAP__', value: {...} }
   ▼
<head><script>globalThis["__SKILL_ZH_MAP__"] = {...}</script></head>
   │
   ▼
tools/patch.fragment.js（在面板 client.js 的 factory 里执行）
   │  MutationObserver 盯 [data-skill-name] 卡片
   │  找到展开区 .SKV_cardDetails 里的 p.SKV_meta（面板渲染的英文原文行）
   ▼
把中文块 insertBefore 到那一行前面
```

关键锚点（面板 v2.1.5）：

- 卡片根节点带 `data-skill-name`（`lib/client.js:1569`）
- 展开了才有 `.SKV_cardDetails`，其下 `p.SKV_meta` 是英文原文 + `来源: xxx`（`lib/client.js:1604-1609`）
- 补丁插入点在 `factory: (require) => {` 之后（`lib/client.js:3`）

面板是**手风琴**：同时只有一张卡展开。点另一张会把当前这张折叠、
`.SKV_cardDetails` 整个销毁；点回来会重建，补丁靠 `MutationObserver`
+ 点击后补跑（50/150/400ms）重新插入，所以来回切也不会丢。

## 已知限制

- **面板插件升级会覆盖 `client.js`**，补丁丢失、中文块消失。重跑 `apply.ps1` 恢复
  （原始文件备份在 `lib/client.js.skvzh.bak`，`-Revert` 用它还原）。
- 面板改版后 `data-skill-name` / `.SKV_cardDetails` / `.SKV_meta` 这些锚点可能变，
  补丁会静默失效（整体包在 try/catch 里，不影响面板本身）。届时对着新版 `client.js`
  调整 `tools/patch.fragment.js` 里的选择器。
- 映射表要**手工维护**，不会自动翻译：`SKILL.md` 里的 description 是英文的，
  没有本地翻译环节。
- 位置靠后的「来源: dsh-office」是面板自己渲染的，不属于本项目。

## License

MIT
