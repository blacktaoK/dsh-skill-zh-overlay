// 真机冒烟：调用已安装插件的 apply()，确认装饰脚本进了面板前端束。
// 用法: node test/smoke.mjs
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const web = process.env.DSH_PROFILE_DIR
  || 'C:/Users/kang/AppData/Roaming/dsh-desktop/harness/profiles/web';

const link = join(web, 'node_modules', 'dsh-skill-zh-overlay');
const client = join(web, 'node_modules', 'dsh-skill-mcp-panel', 'lib', 'client.js');

console.log('插件入口:', link);
console.log('面板束  :', client);

if (!existsSync(client)) {
  console.error('找不到面板束，请先 dsh plugin add dsh-skill-mcp-panel');
  process.exit(1);
}

const mod = await import(new URL('file:///' + join(link, 'lib', 'index.js').replace(/\\/g, '/')).href);
const rows = [];
mod.apply({ on(e, fn) { if (e === 'webserver/index-inject') fn(rows); } });

const text = readFileSync(client, 'utf8');
const ok = text.includes('/* __SKILL_ZH_OVERLAY__ */');

console.log('');
console.log('注入行数   :', rows.length);
console.log('中文条目数 :', Object.keys(rows[0]?.value || {}).length);
console.log('装饰脚本在 :', ok);
console.log('面板束大小 :', statSync(client).size, 'B');
console.log('');
console.log(ok ? '冒烟通过' : '冒烟失败：装饰脚本未进面板束');
process.exit(ok ? 0 : 1);
