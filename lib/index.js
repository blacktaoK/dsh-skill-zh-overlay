/**
 * dsh-skill-zh-overlay —— 宿主侧
 *
 * 唯一职责：往 dsh web 的 index.html 里塞一个全局常量
 * `window.__SKILL_ZH_MAP__`，里面是「技能名 → 中文说明」的映射表。
 *
 * 客户端侧的装饰脚本（由 tools/patch.fragment.js 提供，installer
 * tools/apply.ps1 把它注入到 dsh-skill-mcp-panel 的 lib/client.js 顶部）
 * 读这个常量，在技能卡片展开时把中文说明插到英文原文上方。
 *
 * 为什么走 index 注入而不是 HTTP 路由：
 *   `/plugins` 是 client-modules 的前缀路由，未知路径一律 404
 *   （见 @deepseek-ai/dsh-client-modules/lib/index.js:977 `bundleResource`，
 *   未知资源返回 {status:404}，见 lib/index.js:990），
 *   所以自定义 json 没法放在那里被 fetch 到。
 *
 * 注入行的渲染见 @deepseek-ai/dsh-host-webserver/lib/index.js:24-52
 * 的 `renderRow`：kind:"global" 会渲染成
 *   <script>globalThis["__SKILL_ZH_MAP__"] = {...}</script>
 * 放在 <head>，早于应用脚本执行。
 *
 * 映射表从本插件的 data/skill-zh-map.json 读取，改完文件重跑
 * apply.ps1（或重启 dsh）即可生效。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePatched } from './installer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(HERE, '..', 'data', 'skill-zh-map.json');

const LOG = '[skill-zh-overlay]';

/** 注入到页面的全局变量名，客户端装饰脚本按这个键读取。 */
const GLOBAL_NAME = '__SKILL_ZH_MAP__';

/**
 * 读取映射表。键以下划线开头的当作注释丢弃。
 * @returns 技能名 → { zh, tag, bullets, en? } 的普通对象
 */
function readMap() {
    let raw;
    try {
        raw = readFileSync(MAP_PATH, 'utf8');
    } catch (error) {
        console.warn(`[skill-zh-overlay] 读不到映射表 ${MAP_PATH}：${String(error)}`);
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.warn(`[skill-zh-overlay] 映射表不是合法 JSON：${String(error)}`);
        return {};
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn('[skill-zh-overlay] 映射表顶层必须是对象。');
        return {};
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith('_')) continue;
        out[key] = value;
    }
    return out;
}

/**
 * 插件名：loader 用 id 定位我（必须在 package.json 的 dependencies /
 * dsh.profile.bundles 里与之一致）。
 */
export const name = 'dsh-skill-zh-overlay';

/**
 * 注册注入行，并确保客户端装饰脚本已就位。
 *
 * 两半缺一不可：本函数注入的是数据（window.__SKILL_ZH_MAP__），
 * 而读这份数据渲染浮层的装饰脚本必须进到面板的前端束里——由 installer
 * 负责，装完即生效，不再需要用户手工跑脚本。
 *
 * @param ctx 宿主插件上下文
 */
export function apply(ctx) {
    const map = readMap();
    const count = Object.keys(map).length;
    if (count === 0) {
        console.warn('[skill-zh-overlay] 映射表是空的，技能卡片不会有中文说明。');
    } else {
        console.log(`[skill-zh-overlay] 已加载 ${count} 条技能中文说明。`);
    }

    // 每渲染一次 index 都重新收集注入行，因此这里读 live 的映射表。
    ctx.on('webserver/index-inject', (table) => {
        table.push({
            kind: 'global',
            name: GLOBAL_NAME,
            value: readMap()
        });
    });

    // ── 客户端装饰脚本：自动打补丁 ──────────────────────────────────────
    // 幂等，已注入时不写任何文件；失败只 warn，不影响面板本身。
    try {
        const result = ensurePatched();
        if (result.changed) {
            console.log(`${LOG} ${result.reason}：${result.path}（刷新页面生效）`);
        } else if (result.reason !== '已注入，跳过') {
            console.warn(`${LOG} 装饰脚本未就位 —— ${result.reason}`);
        }
    } catch (error) {
        console.warn(`${LOG} 自动打补丁失败，不影响面板：${String(error)}`);
    }
}

export default { name, apply };
