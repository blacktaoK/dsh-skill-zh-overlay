/* __SKILL_ZH_OVERLAY__ */
/* 技能卡片中文说明浮层 —— 由 skill-zh-overlay/apply.ps1 注入。删除本段即恢复原状。
   中文数据由宿主侧 index 注入的 window.__SKILL_ZH_MAP__ 提供（无需额外 HTTP 路由）。 */
const __SKV_ZH__ = (() => {
    const TAG = 'skv-zh-overlay';
    const KEY = '__skillZhOverlayInstalled';
    if (window[KEY]) return window[KEY];
    const S = document.createElement('style');
    S.textContent = [
        '.skvzh-box{display:flex;flex-direction:column;gap:6px;margin:0 0 10px;padding:9px 11px;',
        'border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);',
        'border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent)}',
        '.skvzh-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
        '.skvzh-tag{flex:none;font-size:10.5px;line-height:16px;padding:1px 7px;border-radius:999px;',
        'background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);',
        'color:var(--dsw-alias-state-business-primary);white-space:nowrap}',
        '.skvzh-label{font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);letter-spacing:.03em}',
        '.skvzh-zh{margin:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-primary)}',
        '.skvzh-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:3px}',
        '.skvzh-list li{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
        '.skvzh-en{margin:0;padding-top:7px;border-top:1px dashed var(--dsw-alias-border-l2);',
        'font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}',
        '.skvzh-missing{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}'
    ].join('');
    document.head.appendChild(S);

    const MAP = (window.__SKILL_ZH_MAP__ && typeof window.__SKILL_ZH_MAP__ === 'object')
        ? window.__SKILL_ZH_MAP__ : {};

    const build = (name, description) => {
        const entry = MAP[name];
        const box = document.createElement('div');
        box.className = 'skvzh-box';

        if (!entry || !entry.zh) {
            const p = document.createElement('p');
            p.className = 'skvzh-missing';
            p.textContent = '暂无中文说明 —— 在 skill-zh-map.json 里给 "' + name + '" 加一条，重跑 apply.ps1 即可（不用重启 dsh）。';
            box.appendChild(p);
            return box;
        }

        const head = document.createElement('div');
        head.className = 'skvzh-head';
        const label = document.createElement('span');
        label.className = 'skvzh-label';
        label.textContent = '中文说明';
        head.appendChild(label);
        if (entry.tag) {
            const tag = document.createElement('span');
            tag.className = 'skvzh-tag';
            tag.textContent = entry.tag;
            head.appendChild(tag);
        }
        box.appendChild(head);

        const zh = document.createElement('p');
        zh.className = 'skvzh-zh';
        zh.textContent = entry.zh;
        box.appendChild(zh);

        if (Array.isArray(entry.bullets) && entry.bullets.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'skvzh-list';
            for (const b of entry.bullets) {
                const li = document.createElement('li');
                li.textContent = String(b);
                ul.appendChild(li);
            }
            box.appendChild(ul);
        }

        // 英文原文：entry.en 固定原文优先，否则回退到插件真实 description
        const enText = entry.en || description;
        if (enText) {
            const en = document.createElement('p');
            en.className = 'skvzh-en';
            en.textContent = 'EN · ' + enText;
            box.appendChild(en);
        }
        return box;
    };

    /**
     * 幂等装饰：每次调用都重新扫描，已挂好的跳过，缺的补上。
     *
     * 不能用「一次性 done 标记 + 早退」——卡片折叠时 SKV_cardDetails 根本
     * 不存在，标记一写就再也不会重试；而 React 展开卡片是一批同步 DOM 变更，
     * MutationObserver 的首个回调可能跑在详情节点挂载之前，之后又不再有变更，
     * 于是永久错过。改成每轮都校验，谁缺补谁。
     */
    const decorate = () => {
        for (const card of document.querySelectorAll('[data-skill-name]')) {
            const name = card.dataset.skillName;
            if (!name) continue;
            const host = card.querySelector('.SKV_cardDetails');
            if (!host) continue;                       // 折叠中，等展开再说
            // 已经挂过就不重复插（按技能名定位，React 重建子树后仍能认出）
            const stale = [...host.querySelectorAll(':scope > .skvzh-box')];
            if (stale.some((el) => el.dataset.skvzhFor === name)) continue;
            stale.forEach((el) => el.remove());         // 清掉可能残留的旧块
            const meter = host.querySelector('p.SKV_meta');
            if (!meter) continue;                       // 描述还没渲染出来
            const box = build(name, meter.textContent || '');
            box.dataset.skvzhFor = name;
            host.insertBefore(box, meter);
            const prov = meter.querySelector('.SKV_metaProvider');
            if (prov) { prov.style.display = 'block'; prov.style.marginTop = '4px'; }
        }
    };

    // 触发时机：MutationObserver 覆盖绝大多数变更；另外监听展开/折叠点击，
    // 在 React 提交后补一次（避免只靠 observer 的时序竞态）。
    // 不做常驻 rAF 循环——面板在后台时每帧扫描纯属浪费。
    let queued = false;
    const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; decorate(); });
    };

    // 点过卡片后在若干时间点补跑，覆盖 React 的提交延迟。
    const scheduleBurst = () => {
        schedule();
        for (const ms of [50, 150, 400]) setTimeout(schedule, ms);
    };

    let mo = null;
    try {
        decorate();
        mo = new MutationObserver(schedule);
        mo.observe(document.body, { childList: true, subtree: true });
        // 事件委托：捕获卡片区域的点击（不干扰面板自身处理）
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('[data-skill-name]')) scheduleBurst();
        }, true);
    } catch (e) { /* 装饰失败不影响面板本身 */ }

    const api = {
        decorate,
        map: MAP,
        stop: () => { if (mo) { mo.disconnect(); mo = null; } }
    };
    window[KEY] = api;
    return api;
})();
/* __SKILL_ZH_OVERLAY_END__ */
