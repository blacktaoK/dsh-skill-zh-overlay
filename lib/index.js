/**
 * dsh-skill-zh-overlay —— 宿主侧
 *
 * 三件事：
 *   1. 给 dsh web 的 index.html 注入 `globalThis.__SKILL_ZH_MAP__`
 *      （手写映射 + 自动生成结果合并后的表）。客户端装饰脚本读它渲染浮层。
 *   2. 给面板的前端束打上装饰脚本（installer.js，幂等）。
 *   3. 开 `/skill-zh-overlay/api`：浏览器侧按需请求「这个技能的中文说明」，
 *      宿主用当前默认模型现场生成。这样没有手写映射的技能也有中文可看。
 *
 * 自动生成的三层来源，优先级从高到低：
 *   - data/auto-zh.json     上一次（或别的机器）生成并落盘的缓存
 *   - 本次进程内生成的结果
 *   - 手写映射 data/skill-zh-map.json（永不覆盖）
 * 缓存按「技能名 + 原文的 sha1 前 16 位」失效：技能描述的英文一改，旧译文
 * 自动作废，不会把过期的中文贴上去。
 *
 * 为什么走自己注册的 HTTP 路由而不是 Typert：
 *   Typert 的一元方法虽然也走 `POST /api/<ns>/<method>`，但它挂在 dsh 自己的
 *   网关上，路由前缀归 dsh 所有；本插件挂在自己命名的前缀下，与 dsh 版本、
 *   网关 schema 演进完全解耦，也不占用别人的命名空间。
 *
 * 项目/分类那类元信息（scope、groups）不在这里猜：前端装饰脚本只关心
 * 「这块中文说得对不对」，其余交给面板自己。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePatched } from './installer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');
const MAP_PATH = join(DATA_DIR, 'skill-zh-map.json');
const CACHE_PATH = join(DATA_DIR, 'auto-zh.json');

const LOG = '[skill-zh-overlay]';

/** 注入到页面的全局变量名，客户端装饰脚本按这个键读取。 */
const GLOBAL_NAME = '__SKILL_ZH_MAP__';

/** 浏览器侧按需生成的接口前缀。 */
const API_PREFIX = '/skill-zh-overlay/api';

/** 一次最多生成多少条，防止有人一口气把账单打穿。 */
const MAX_BATCH = 8;

/** 单次生成的字数与耗时上限。 */
const MAX_OUTPUT_TOKENS = 700;
const TIMEOUT_MS = 60000;

/**
 * 读取 JSON 文件，失败一律返回空对象（插件不能因为数据文件坏了而不启动）。
 * @param {string} path 绝对路径
 * @param {string} what 用于日志的描述
 * @returns {Record<string, any>}
 */
function readJsonObject(path, what) {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    } catch (error) {
        // 缓存文件不存在是正常情况，不吵。
        if (what !== '缓存') console.warn(`${LOG} 读不到${what} ${path}：${String(error)}`);
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.warn(`${LOG} ${what}不是合法 JSON：${String(error)}`);
        return {};
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`${LOG} ${what}顶层必须是对象。`);
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
 * 读取手写映射表。键以下划线开头的当作注释丢弃。
 * @returns {Record<string, { zh?: string, tag?: string, bullets?: string[] }>}
 */
export function readMap() {
    return readJsonObject(MAP_PATH, '映射表');
}

/** 读磁盘上的自动生成缓存。 */
function readCache() {
    const raw = readJsonObject(CACHE_PATH, '缓存');
    /** @type {Record<string, { zh: string, tag?: string, bullets?: string[], hash?: string, model?: string }>} */
    const out = {};
    for (const [name, value] of Object.entries(raw)) {
        if (!value || typeof value !== 'object') continue;
        if (typeof value.zh !== 'string' || value.zh.trim() === '') continue;
        out[name] = value;
    }
    return out;
}

/**
 * 原文指纹：技能描述变了，旧译文就该作废。
 * @param {string} text 英文原文
 * @returns {string} 16 位十六进制
 */
export function fingerprint(text) {
    return createHash('sha1').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 原文是不是已经是中文？
 *
 * 和客户端装饰脚本用完全相同的判据（`patch.fragment.js` 里的 looksChinese）：
 * 中文字符占非空白字符三成以上。两处必须一致，否则会出现「宿主认为该翻译、
 * 前端认为不该显示」或者反过来。
 *
 * @param {string} text 技能描述
 * @returns {boolean}
 */
export function looksChinese(text) {
    if (!text) return false;
    const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
    const solid = (String(text).match(/\S/g) || []).length || 1;
    return cjk / solid >= 0.3;
}

/** 进程内缓存：本轮已经生成过的条目，避免重开页面又打一次模型。 */
const memory = new Map();

/**
 * 把三份来源合并成前端要的那张表。
 *
 * 优先级：手写 > 自动。手写条目永远压过自动生成——作者写的那条是校对过的，
 * 模型不可能更准。
 *
 * @param {Record<string, any>} manual 手写映射
 * @param {Record<string, any>} cache 磁盘缓存
 * @returns {Record<string, any>}
 */
export function mergeTables(manual, cache) {
    const out = { ...cache, ...manual };
    // 手写里显式 noOverlay 的条目留给前端判断，这里不删。
    return out;
}

/**
 * 从技能服务的候选里取「技能名 → 英文原文」。
 *
 * ctx.skills 是 provider 注册表；每个 provider 的 list() 返回本 root 下的候选。
 * 这里只读 description，不读正文——正文可能几十 KB，不需要。
 *
 * @param {any} ctx 宿主上下文
 * @param {string} cwd 作用域
 * @returns {Promise<Record<string, string>>}
 */
async function collectDescriptions(ctx, cwd) {
    /** @type {Record<string, string>} */
    const out = {};
    const skills = ctx.get('skills');
    if (!skills || typeof skills.list !== 'function') return out;
    let listed;
    try {
        listed = await skills.list({ cwd });
    } catch (error) {
        console.warn(`${LOG} 枚举技能失败：${String(error)}`);
        return out;
    }
    const rows = Array.isArray(listed) ? listed : (listed?.candidates ?? []);
    for (const row of rows) {
        if (!row || typeof row.name !== 'string') continue;
        if (typeof row.description !== 'string' || row.description.trim() === '') continue;
        // 同名多条时取第一条：root 优先级已经由 registry 排过序。
        if (out[row.name] === undefined) out[row.name] = row.description;
    }
    return out;
}

/**
 * 让模型写一条中文说明。
 *
 * 输出强制成 JSON，这样不用去猜模型会不会多写一句「以下是说明：」。
 * @param {any} ctx 宿主上下文
 * @param {{ name: string, description: string }} skill 目标技能
 * @returns {Promise<{ zh: string, tag?: string, bullets?: string[] } | undefined>}
 */
async function generateOne(ctx, skill) {
    const llm = ctx.get('llm');
    if (!llm || typeof llm.stream !== 'function') {
        console.warn(`${LOG} 没有可用的 llm 服务，跳过自动生成。`);
        return undefined;
    }

    // 路由：优先配置文件里写死的，其次取用户当前的默认模型。
    let provider = configProvider(ctx);
    let model = configModel(ctx);
    if (provider === undefined || model === undefined) {
        const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
        provider = selection?.provider;
        model = selection?.model;
    }
    if (!provider || !model) {
        console.warn(`${LOG} 拿不到默认模型路由，跳过自动生成。`);
        return undefined;
    }

    const { createUserMessage, BlockAssembler } = await import('@deepseek-ai/dsh-llm');

    const system = [
        '你在给中文用户写一段技能说明书。输入是一个 AI 编程助手「技能」的名字和它的英文原始描述。',
        '输出必须是一个 JSON 对象，恰好三个字段：',
        '  "zh"：一到两句中文，说清这技能能干什么、什么时候该用它，不超过 80 个字，不要用「该技能」「此工具」这类翻译腔。',
        '  "tag"：四到八字的中文分类标签，形如「办公 · Word」「数据 · 质量」，用中点分隔。',
        '  "bullets"：2 到 3 条中文要点，每条不超过 45 字，写使用时的关键约束或容易踩的坑。',
        '只输出 JSON，不要 Markdown 代码块，不要任何解释。不要编造原文里没有的能力。'
    ].join('\n');

    const user = [
        `技能名：${skill.name}`,
        '英文原始描述：',
        skill.description
    ].join('\n');

    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const assembler = new BlockAssembler();
    try {
        for await (const chunk of llm.stream({
            provider,
            model,
            messages: [createUserMessage({
                content: [{ type: 'text', text: user }],
                source: { kind: 'dsh-skill-zh-overlay' }
            })],
            system,
            maxTokens: MAX_OUTPUT_TOKENS,
            purpose: 'skill-zh-overlay',
            signal
        })) {
            assembler.push(chunk);
        }
    } catch (error) {
        console.warn(`${LOG} 生成 ${skill.name} 的中文说明失败：${String(error)}`);
        return undefined;
    }

    if (assembler.finish && assembler.finish.kind !== 'stop') {
        console.warn(`${LOG} 生成 ${skill.name} 时模型提前结束：${assembler.finish.kind}`);
        return undefined;
    }

    const text = assembler.blocks()
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

    const parsed = parseModelJson(text);
    if (!parsed || typeof parsed.zh !== 'string' || parsed.zh.trim() === '') {
        console.warn(`${LOG} ${skill.name} 的模型输出没法解析成 JSON，丢弃。`);
        return undefined;
    }

    /** @type {{ zh: string, tag?: string, bullets?: string[] }} */
    const entry = { zh: parsed.zh.trim() };
    if (typeof parsed.tag === 'string' && parsed.tag.trim() !== '') entry.tag = parsed.tag.trim();
    if (Array.isArray(parsed.bullets)) {
        const bullets = parsed.bullets
            .filter((b) => typeof b === 'string' && b.trim() !== '')
            .slice(0, 3)
            .map((b) => b.trim());
        if (bullets.length > 0) entry.bullets = bullets;
    }
    return entry;
}

/**
 * 把模型输出解析成对象。容忍 ```json 围栏和前后多嘴的解释。
 * @param {string} text
 * @returns {Record<string, any> | undefined}
 */
export function parseModelJson(text) {
    const raw = String(text ?? '').trim();
    if (raw === '') return undefined;
    const candidates = [];
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fenced) candidates.push(fenced[1]);
    candidates.push(raw);
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            // 换下一个候选
        }
    }
    return undefined;
}

/**
 * 把生成的条目写回缓存文件（失败只 warn，不影响返回给浏览器的结果）。
 *
 * 写成功也打一行日志：缓存是「重启后还认这些译文」的唯一凭据，缺了就
 * 每次刷新都要重新花钱生成，必须能从日志判断它到底落没落盘。
 */
function persistCache(cache) {
    const text = JSON.stringify(cache, null, 2) + '\n';
    try {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(CACHE_PATH, text, 'utf8');
        console.log(`${LOG} 缓存已写入 ${CACHE_PATH}（${Object.keys(cache).length} 条）`);
    } catch (error) {
        console.warn(`${LOG} 缓存写不进去：${CACHE_PATH} —— ${String(error)}`);
    }
}

/** 从宿主上下文里读配置（apply 时注入），避免每个调用点都传一遍。 */
let hostConfig = {};
function configProvider() {
    return hostConfig.provider;
}
function configModel() {
    return hostConfig.model;
}

/**
 * 处理一次「给我这些技能的中文说明」请求。
 *
 * @param {any} ctx 宿主上下文
 * @param {{ skills?: Array<{ name?: string, description?: string }> }} body 浏览器发来的清单
 * @returns {Promise<{ entries: Record<string, any>, missing: string[], model?: string }>}
 */
async function explainBatch(ctx, body) {
    const manual = readMap();
    const cache = readCache();
    const wanted = Array.isArray(body?.skills) ? body.skills.slice(0, MAX_BATCH) : [];

    /** @type {Record<string, any>} */
    const entries = {};
    /** @type {string[]} */
    const missing = [];
    /** @type {Record<string, any>} */
    const fresh = {};

    for (const row of wanted) {
        if (!row || typeof row.name !== 'string' || row.name === '') continue;
        const name = row.name;
        const description = typeof row.description === 'string' ? row.description : '';

        // 手写优先；原文是中文的没有加浮层的意义。
        if (manual[name]?.zh) { entries[name] = manual[name]; continue; }
        if (looksChinese(description)) continue;

        const hash = fingerprint(description);

        const hit = memory.get(name);
        if (hit && hit.hash === hash) { entries[name] = hit.entry; continue; }

        const cached = cache[name];
        if (cached && cached.hash === hash) {
            entries[name] = cached;
            memory.set(name, { hash, entry: cached });
            continue;
        }

        const entry = await generateOne(ctx, { name, description });
        if (!entry) { missing.push(name); continue; }
        entries[name] = entry;
        memory.set(name, { hash, entry });
        fresh[name] = { ...entry, hash, model: configModel(ctx) ?? '' };
    }

    if (Object.keys(fresh).length > 0) {
        persistCache({ ...cache, ...fresh });
        // 新结果立刻影响下一次 index 渲染。
        bumpRevision();
    } else {
        console.log(`${LOG} 本批 ${Object.keys(entries).length} 条全部命中缓存，没有新生成。`);
    }

    return { entries, missing, model: configModel(ctx) };
}

/** 生成结果变了就让前端知道该重取 index（换一个 revision 即可）。 */
let revision = 0;
function bumpRevision() {
    revision += 1;
}

/**
 * 读一次原始请求体。
 * @param {any} request Node 的 IncomingMessage
 * @param {number} limit 上限字节
 * @returns {Promise<any>}
 */
function readBody(request, limit) {
    return new Promise((resolve) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                // 超限就停止累积，但把流读完，避免客户端挂住。
                chunks.length = 0;
                size = limit + 1;
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (size > limit) return resolve(undefined);
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                resolve(undefined);
            }
        });
        request.on('error', () => resolve(undefined));
    });
}

/**
 * 插件名：loader 用 id 定位我（必须在 package.json 的 dependencies /
 * dsh.profile.bundles 里与之一致）。
 */
export const name = 'dsh-skill-zh-overlay';

/**
 * 依赖的服务。用软依赖：拿不到就退化成「只有手写映射」，不让插件起不来。
 */
export const inject = ['webServer'];

/**
 * 注册注入行、HTTP 路由，并确保客户端装饰脚本已就位。
 *
 * @param {any} ctx 宿主插件上下文
 * @param {{ provider?: string, model?: string, autoGenerate?: boolean }} [config] 插件配置
 */
export function apply(ctx, config = {}) {
    hostConfig = config ?? {};

    const manual = readMap();
    const cache = readCache();
    const merged = mergeTables(manual, cache);
    console.log(`${LOG} 手写 ${Object.keys(manual).length} 条，自动缓存 ${Object.keys(cache).length} 条。`);
    console.log(`${LOG} 缓存路径 ${CACHE_PATH}`);
    if (Object.keys(merged).length === 0) {
        console.warn(`${LOG} 目前一条中文都没有，卡片要等浏览器请求时才会自动生成。`);
    }

    // 每渲染一次 index 都重新合并，因此手写文件改了、自动缓存写了都能立刻反映。
    ctx.on('webserver/index-inject', (table) => {
        table.push({
            kind: 'global',
            name: GLOBAL_NAME,
            value: mergeTables(readMap(), readCache())
        });
    });

    // ── 浏览器按需生成 ─────────────────────────────────────────────────
    const webServer = ctx.get('webServer');
    if (webServer && typeof webServer.register === 'function' && config.autoGenerate !== false) {
        ctx.effect(() => webServer.register({
            kind: 'prefix',
            path: API_PREFIX,
            handler: async (request, response) => {
                const url = new URL(request.url ?? '/', 'http://localhost');
                const endpoint = url.pathname.slice(API_PREFIX.length) || '/';

                if (request.method === 'OPTIONS') {
                    response.writeHead(204, { 'access-control-allow-origin': 'same-origin' });
                    response.end();
                    return;
                }
                if (request.method !== 'POST' || endpoint !== '/explain') {
                    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
                    response.end('not found');
                    return;
                }

                const body = await readBody(request, 256 * 1024);
                if (body === undefined) {
                    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                    response.end(JSON.stringify({ error: 'bad request body' }));
                    return;
                }

                let result;
                try {
                    result = await explainBatch(ctx, body);
                } catch (error) {
                    console.warn(`${LOG} 生成批次失败：${String(error)}`);
                    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                    response.end(JSON.stringify({ error: String(error) }));
                    return;
                }

                response.writeHead(200, {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store',
                    'x-skill-zh-revision': String(revision)
                });
                response.end(JSON.stringify(result));
            }
        }), 'skill-zh-overlay: explain api');
    } else if (config.autoGenerate !== false) {
        console.warn(`${LOG} 拿不到 webServer，按需生成接口未注册；手写映射照常工作。`);
    }

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

export default { name, apply, inject };
