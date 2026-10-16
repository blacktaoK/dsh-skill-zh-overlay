/**
 * dsh-skill-zh-overlay —— 客户端补丁安装器（宿主侧）
 *
 * 职责：给 dsh-skill-mcp-panel 的前端束 lib/client.js 注入装饰脚本。
 *
 * 为什么这件事必须在插件里自动做，而不是让用户跑脚本：
 *   中文浮层需要两半——宿主注入 `window.__SKILL_ZH_MAP__`（本插件的另一半，
 *   见 lib/index.js）+ 客户端装饰脚本读它渲染。第二半必须进到面板的前端束里，
 *   而前端束是别人包的构建产物，没有扩展点。过去的做法是让用户手工跑
 *   tools/apply.ps1，于是 `dsh plugin add dsh-skill-zh-overlay` 装完不生效。
 *   插件本身就是宿主插件，有完整文件权限，这件事该它自己干。
 *
 * 安全边界（克制地写 node_modules 里的第三方文件）：
 *   - 幂等：marker 已在就一个字都不写。
 *   - 先备份：首次写入前存一份 <client.js>.skvzh.bak，永不覆盖已有备份。
 *   - 可还原：revert() 从备份恢复，并保留备份文件供人工核对。
 *   - 失败不致命：任何异常都吞掉并 warn，面板本身照常工作。
 *   - 只改一个文件：除 client.js 与它的备份外不碰任何东西。
 *
 * 锚点：面板束的 factory 开头 `factory: (require) => {`。这与 apply.ps1 用的
 * 是同一个锚点，两套安装方式不会互相破坏——都先剥离旧段再插入。
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** readdirSync 的容错包装：目录读不到就返回空数组。 */
function safeReaddir(path) {
    try {
        return readdirSync(path, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
            .map((entry) => entry.name);
    } catch (error) {
        return [];
    }
}

/**
 * 本模块所在目录的绝对路径。
 *
 * 必须用 `fileURLToPath`，不能用 `new URL(import.meta.url).pathname`：
 * 后者在 Windows 上不去掉前导斜杠、也不做百分号解码，路径里一旦有空格
 * （如 `AppData` 之类被编码成 `%20` 的目录名）就会指向一个不存在的文件，
 * 于是"装饰脚本读不到"，补丁静默失效。
 */
function hereDir() {
    return dirname(fileURLToPath(import.meta.url));
}

/** 补丁段起止标记，apply.ps1 与本模块共用，保证两种安装方式互认。 */
export const MARKER_START = '/* __SKILL_ZH_OVERLAY__ */';
export const MARKER_END = '/* __SKILL_ZH_OVERLAY_END__ */';

/** 备份扩展名。apply.ps1 用同一个，避免出现两份"原始"备份。 */
export const BAK_EXT = '.skvzh.bak';

/** 面板前端束的锚点：factory 开头。 */
const ANCHOR = 'factory: (require) => {';

/** 提供装饰脚本的面板包名与相对路径。 */
const PANEL_PACKAGE = 'dsh-skill-mcp-panel';
const CLIENT_RELATIVE = join('lib', 'client.js');

/** 前缀，让所有日志一眼能认出是本插件。 */
const LOG_PREFIX = '[skill-zh-overlay]';

/**
 * 面板前端束的候选位置。
 *
 * 插件从 `profiles/<name>/node_modules/dsh-skill-zh-overlay/lib/installer.js`
 * 运行，回退两级（跳过包名目录）就是它所在的 node_modules，面板就在那里。
 *
 * **为什么有两个候选**：dsh 插件目录是 junction（`profiles/web/node_modules/`
 * 下的 `dsh-skill-zh-overlay` 指向 `profiles/.generations/live/.../`）。
 * Node 解析模块时会顺着 junction 走到**真实路径**，于是 `import.meta.url`
 * 拿到的是 `.generations/...` 那条，`../../` 落在 generation 的 node_modules
 * 里 —— 而面板装在 profile 的 node_modules，两边不在一起，于是就"找不到面板"。
 * 所以两个都要算：真实路径优先（Node 默认的行为），链接路径兜底。
 *
 * @returns 绝对路径候选列表，按优先级排列
 */
function candidateClientPaths() {
    const here = hereDir() /* .../node_modules/dsh-skill-zh-overlay/lib */;
    const packageRoot = join(here, '..');
    const out = [join(packageRoot, '..', PANEL_PACKAGE, CLIENT_RELATIVE)];

    // dsh 的插件目录是 junction：真实路径落在
    // `profiles/.generations/<gen>/node_modules/<包>`，而面板装在
    // `profiles/<profile>/node_modules/`。Node 解析模块时给的是**真实路径**，
    // 所以光回退两级会落在 generation 的 node_modules 里，找不到面板。
    //
    // 解法：从真实路径往上走，找到 `profiles/`，再把 `profiles/<名字>/node_modules`
    // 全列出来当候选。这样无论插件在哪个 generation、哪个 profile，都能找到面板。
    let dir = packageRoot;
    for (let i = 0; i < 8; i += 1) {
        const parent = dirname(dir);
        if (!parent || parent === dir) break;
        // 到达 profiles/ 时停止：它的下一层就是各 profile 目录。
        if (basename(parent) === 'profiles') {
            for (const entry of safeReaddir(parent)) {
                out.push(join(parent, entry, 'node_modules', PANEL_PACKAGE, CLIENT_RELATIVE));
            }
            break;
        }
        dir = parent;
    }

    return [...new Set(out)];
}

/**
 * 读装饰脚本本体。
 *
 * 脚本与安装器放在同一个 lib/ 下（patch.fragment.js），这样它在
 * package.json 的 files 白名单里，pnpm 安装不会把它漏掉——过去放在
 * tools/ 而 tools/ 不在白名单，正是 `dsh plugin add` 装完不生效的原因。
 *
 * @returns 脚本源码，读不到返回 undefined
 */
function readFragment() {
    const path = join(hereDir(), 'patch.fragment.js');
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        console.warn(`${LOG_PREFIX} 读不到装饰脚本 ${path}：${String(error)}`);
        return undefined;
    }
}

/**
 * 定位真正存在的前端束文件。
 * @returns { path: string, text: string } 或 undefined
 */
function locateClient() {
    for (const path of candidateClientPaths()) {
        if (!existsSync(path)) continue;
        try {
            return { path, text: readFileSync(path, 'utf8') };
        } catch (error) {
            console.warn(`${LOG_PREFIX} 读不到前端束 ${path}：${String(error)}`);
        }
    }
    return undefined;
}

/**
 * 剥离已有的补丁段（若存在）。
 * @param text - client.js 内容
 * @returns 剥离后的内容；本来就没有则原样返回
 */
function stripPatch(text) {
    const start = text.indexOf(MARKER_START);
    if (start < 0) return text;
    const end = text.indexOf(MARKER_END);
    if (end < 0) {
        // 段不完整：宁可不动，也不要切出一个坏文件。
        console.warn(`${LOG_PREFIX} 检测到不完整的补丁段（缺结束标记），跳过写入，请先还原。`);
        return undefined;
    }
    return text.slice(0, start) + text.slice(end + MARKER_END.length);
}

/**
 * 查询补丁状态，不修改任何文件。
 * @returns { state: 'patched' | 'unpatched' | 'no-panel' | 'broken', path?: string, bytes?: number }
 */
export function patchState() {
    const found = locateClient();
    if (!found) return { state: 'no-panel' };
    const hasStart = found.text.includes(MARKER_START);
    const hasEnd = found.text.includes(MARKER_END);
    if (hasStart && !hasEnd) return { state: 'broken', path: found.path, bytes: found.text.length };
    return {
        state: hasStart ? 'patched' : 'unpatched',
        path: found.path,
        bytes: found.text.length
    };
}

/**
 * 确保装饰脚本已注入前端束。幂等：已注入则不做任何写入。
 *
 * @returns { changed: boolean, reason: string, path?: string }
 */
export function ensurePatched() {
    const found = locateClient();
    if (!found) {
        return {
            changed: false,
            reason: `找不到 ${PANEL_PACKAGE}/lib/client.js —— 请先安装面板插件（dsh plugin add dsh-skill-mcp-panel）`
        };
    }

    const { path, text } = found;

    // 已经打过：一个字都不写。
    if (text.includes(MARKER_START) && text.includes(MARKER_END)) {
        return { changed: false, reason: '已注入，跳过', path };
    }

    const fragment = readFragment();
    if (!fragment) return { changed: false, reason: '拿不到装饰脚本', path };

    const stripped = stripPatch(text);
    if (stripped === undefined) return { changed: false, reason: '旧补丁段不完整，未写入', path };

    const anchorAt = stripped.indexOf(ANCHOR);
    if (anchorAt < 0) {
        return {
            changed: false,
            reason: `前端束结构变了，找不到锚点 —— 面板版本可能已升级，需人工确认`,
            path
        };
    }

    // 首次写入前备份。已有备份就不覆盖（那才是真正的原始文件）。
    const backup = path + BAK_EXT;
    if (!existsSync(backup)) {
        try {
            copyFileSync(path, backup);
        } catch (error) {
            console.warn(`${LOG_PREFIX} 备份失败，为安全起见不写入：${String(error)}`);
            return { changed: false, reason: '备份失败', path };
        }
    }

    const insertAt = anchorAt + ANCHOR.length;
    const out = stripped.slice(0, insertAt) + '\n' + fragment + '\n' + stripped.slice(insertAt);

    try {
        writeFileSync(path, out, 'utf8');
    } catch (error) {
        console.warn(`${LOG_PREFIX} 写入失败：${String(error)}`);
        return { changed: false, reason: '写入失败', path };
    }

    return { changed: true, reason: '已注入装饰脚本', path };
}

/**
 * 从备份还原前端束。
 * @returns { changed: boolean, reason: string, path?: string }
 */
export function revertPatch() {
    const found = locateClient();
    if (!found) return { changed: false, reason: `找不到 ${PANEL_PACKAGE}/lib/client.js` };

    const { path } = found;
    const backup = path + BAK_EXT;
    if (!existsSync(backup)) {
        return { changed: false, reason: '没有备份，未还原（可能是手工安装且未备份）', path };
    }

    try {
        copyFileSync(backup, path);
        rmSync(backup, { force: true });
        return { changed: true, reason: '已从备份还原前端束', path };
    } catch (error) {
        console.warn(`${LOG_PREFIX} 还原失败：${String(error)}`);
        return { changed: false, reason: '还原失败', path };
    }
}
