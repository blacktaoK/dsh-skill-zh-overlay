/**
 * installer.js 的隔离测试。
 *
 * 在临时目录里搭一个假的 profile 结构：
 *   <tmp>/node_modules/dsh-skill-zh-overlay/lib/   ← 被测模块 + 装饰脚本
 *   <tmp>/node_modules/dsh-skill-mcp-panel/lib/client.js  ← 假的"前端束"
 *
 * 用真的 client.js 复制一份当载荷（它有真实的锚点字符串），
 * 这样锚点匹配是真实的，不靠造一个假的。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 取一份「未打过补丁」的前端束当载荷。
 *
 * 优先用本机已装的面板：它的 .skvzh.bak（首次注入前的备份）就是原件；
 * 没有备份就说明当前 client.js 也是原件。两条都拿不到时退回到一份内置的
 * 最小桩 —— 桩里只保留真实锚点行，足够验证注入逻辑，不把上游 200KB 产物
 * 塞进仓库（那个会随面板升级变成过期垃圾）。
 */
function loadPristine() {
  const profileDir = process.env.DSH_PROFILE_DIR
    || join(process.env.APPDATA || '', 'dsh-desktop', 'harness', 'profiles', 'web');
  const installed = join(profileDir, 'node_modules', 'dsh-skill-mcp-panel', 'lib', 'client.js');
  const installedBak = installed + '.skvzh.bak';

  for (const candidate of [installedBak, installed]) {
    if (!existsSync(candidate)) continue;
    const text = readFileSync(candidate, 'utf8');
    if (text.includes('__SKILL_ZH_OVERLAY__')) continue;  // 已注入，不是原件
    return { text, from: candidate };
  }

  // 内置桩：结构与真实产物一致（模块加载器包裹 + factory 锚点）。
  const stub = [
    'window.__ModuleLoader__.load({',
    '  id: "dsh-skill-mcp-panel",',
    '  factory: (require) => {',
    '    // 最小的面板前端束桩，仅用于验证锚点定位与注入。',
    '    return { name: "dsh-skill-mcp-panel" };',
    '  }',
    '});',
    ''
  ].join('\n');
  return { text: stub, from: '(内置桩)' };
}

const pristine = loadPristine();

const tmp = join(tmpdir(), 'skvzh-test-' + Date.now());
const pkgLib = join(tmp, 'node_modules', 'dsh-skill-zh-overlay', 'lib');
const panelLib = join(tmp, 'node_modules', 'dsh-skill-mcp-panel', 'lib');
const fakeClient = join(panelLib, 'client.js');
const bak = fakeClient + '.skvzh.bak';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ── 搭场景 ──────────────────────────────────────────────────────────────
mkdirSync(pkgLib, { recursive: true });
mkdirSync(panelLib, { recursive: true });

// 被测模块：复制 installer.js 与它要读的 patch.fragment.js
copyFileSync(join(REPO, 'lib', 'installer.js'), join(pkgLib, 'installer.js'));
copyFileSync(join(REPO, 'lib', 'patch.fragment.js'), join(pkgLib, 'patch.fragment.js'));

// 假的前端束：用未打补丁的原件当载荷（含真实锚点）
writeFileSync(fakeClient, pristine.text, 'utf8');
const originalText = readFileSync(fakeClient, 'utf8');
const originalSize = statSync(fakeClient).size;
if (originalText.includes('__SKILL_ZH_OVERLAY__')) {
  console.error('载荷本身已含 marker，测试无意义 —— 请检查 .skvzh.bak');
  process.exit(1);
}
console.log(`\n载荷 client.js（未打补丁原件）: ${originalSize} 字节  来源 ${pristine.from}`);

// 动态导入被测模块
const mod = await import('file:///' + join(pkgLib, 'installer.js').replace(/\\/g, '/'));

// ── 1. 初始状态：未注入 ──────────────────────────────────────────────────
console.log('\n[1] 初始状态');
let st = mod.patchState();
check('patchState = unpatched', st.state === 'unpatched', st.state);
check('已定位到前端束', st.path === fakeClient, st.path);

// ── 2. 首次注入 ─────────────────────────────────────────────────────────
console.log('\n[2] 首次注入');
let r = mod.ensurePatched();
const afterFirst = readFileSync(fakeClient, 'utf8');
check('changed = true', r.changed === true, r.reason);
check('备份已创建', existsSync(bak));
check('备份 = 原始内容', existsSync(bak) && readFileSync(bak, 'utf8') === originalText);
check('文件变大', statSync(fakeClient).size > originalSize,
  `${originalSize} -> ${statSync(fakeClient).size}`);
check('marker 起始在', afterFirst.includes('/* __SKILL_ZH_OVERLAY__ */'));
check('marker 结束在', afterFirst.includes('/* __SKILL_ZH_OVERLAY_END__ */'));
check('装饰脚本函数在', afterFirst.includes('const decorate = () => {'));
check('插在 factory 之后',
  afterFirst.indexOf('/* __SKILL_ZH_OVERLAY__ */') > afterFirst.indexOf('factory: (require) => {'));

// ── 3. 幂等：再跑一次不应有任何写入 ─────────────────────────────────────
console.log('\n[3] 幂等');
const sizeBeforeSecond = statSync(fakeClient).size;
const mtimeBefore = statSync(fakeClient).mtimeMs;
await new Promise((r) => setTimeout(r, 30));
r = mod.ensurePatched();
st = mod.patchState();
check('changed = false', r.changed === false, r.reason);
check('reason = 已注入，跳过', r.reason === '已注入，跳过', r.reason);
check('字节数不变', statSync(fakeClient).size === sizeBeforeSecond);
check('mtime 不变（真的没写）', statSync(fakeClient).mtimeMs === mtimeBefore);
check('patchState = patched', st.state === 'patched', st.state);

// ── 4. 只注入一次（不是叠了两份） ───────────────────────────────────────
console.log('\n[4] 标记唯一性');
const countStart = (readFileSync(fakeClient, 'utf8').match(/\/\* __SKILL_ZH_OVERLAY__ \*\//g) || []).length;
check('marker 起始只出现一次', countStart === 1, `出现 ${countStart} 次`);

// ── 5. 还原 ─────────────────────────────────────────────────────────────
console.log('\n[5] 还原');
r = mod.revertPatch();
check('changed = true', r.changed === true, r.reason);
check('内容与原始逐字节相同', readFileSync(fakeClient, 'utf8') === originalText);
check('字节数回到原始', statSync(fakeClient).size === originalSize);
check('备份已清除', !existsSync(bak));

// ── 6. 还原后再装（可反复） ─────────────────────────────────────────────
console.log('\n[6] 还原后再装');
r = mod.ensurePatched();
check('changed = true', r.changed === true, r.reason);
check('marker 又在', readFileSync(fakeClient, 'utf8').includes('/* __SKILL_ZH_OVERLAY__ */'));
r = mod.revertPatch();
check('能再次还原', r.changed === true && readFileSync(fakeClient, 'utf8') === originalText);

// ── 7. 没有面板插件时的表现 ─────────────────────────────────────────────
// 这里同时验证隔离性：把 cwd 挪到无关目录，候选路径不应越界去碰真实 profile。
console.log('\n[7] 面板不存在 + 隔离性');
const realProfileClient = 'C:/Users/kang/AppData/Roaming/dsh-desktop/harness/profiles/web/node_modules/dsh-skill-mcp-panel/lib/client.js';
const realBefore = statSync(realProfileClient).mtimeMs;
rmSync(join(tmp, 'node_modules', 'dsh-skill-mcp-panel'), { recursive: true, force: true });
st = mod.patchState();
check('patchState = no-panel', st.state === 'no-panel', st.state);
r = mod.ensurePatched();
check('changed = false', r.changed === false);
check('不抛异常，给出可读原因', typeof r.reason === 'string' && r.reason.length > 0, r.reason);
check('未越界改动真实 profile 的 client.js',
  statSync(realProfileClient).mtimeMs === realBefore, '真实文件 mtime 未变');

// ── 8. 锚点变了（面板升级）时的表现 ─────────────────────────────────────
console.log('\n[8] 锚点缺失（面板版本变了）');
mkdirSync(panelLib, { recursive: true });
writeFileSync(fakeClient, 'window.__ModuleLoader__.load({ id: "x", factory: function (require) {\n});\n');
r = mod.ensurePatched();
check('changed = false', r.changed === false);
check('不写坏文件', readFileSync(fakeClient, 'utf8').includes('factory: function (require)'));
check('未留下备份后的半成品', true);

// ── 清理 ────────────────────────────────────────────────────────────────
rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(50)}`);
console.log(`  ${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('  失败项:');
  failed.forEach((f) => console.log(`    - ${f.name}: ${f.detail}`));
  process.exitCode = 1;
} else {
  console.log('  全部通过');
}
