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
        // 面板原有英文原文：默认折起，点「原文」才展开
        '.SKV_meta[data-skvzh-collapsed="1"]>.skvzh-native{display:none}',
        '.SKV_meta[data-skvzh-collapsed="1"][data-skvzh-open="1"]>.skvzh-native{display:inline;',
        'white-space:pre-wrap;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}',
        // 折起来的时候别让「来源: xxx」孤零零一行，补个说明它是什么
        '.SKV_meta[data-skvzh-collapsed="1"]::after{content:"原文已折叠";font-size:10.5px;line-height:16px;',
        'color:var(--dsw-alias-label-tertiary);opacity:.7;margin-left:6px}',
        '.skvzh-toggle{margin-left:6px;padding:0;border:0;background:none;cursor:pointer;',
        'font-size:11px;line-height:16px;color:var(--dsw-alias-state-business-primary);',
        'text-decoration:underline;text-underline-offset:2px;font-family:inherit}',
        '.skvzh-toggle:hover{opacity:.75}'
    ].join('');
    document.head.appendChild(S);

    const MAP = (window.__SKILL_ZH_MAP__ && typeof window.__SKILL_ZH_MAP__ === 'object')
        ? window.__SKILL_ZH_MAP__ : {};

    /**
     * 原文本身已经是中文吗？
     *
     * 技能描述有两种来源：英文上游（office-docx、archify 之类）和本来就是
     * 中文写的（work-report-writer、gov-doc-writing 这些）。后者再叠一个
     * 中文浮层，就是同一句话摆两遍，还把人看得更乱。
     */
    const CJK = /[\u4e00-\u9fff]/g;
    const looksChinese = (text) => {
        if (!text) return false;
        const cjk = (text.match(CJK) || []).length;
        // 中文字符占「非空白字符」的三成以上，就认定这条原文是中文写的。
        const solid = (text.match(/\S/g) || []).length || 1;
        return cjk / solid >= 0.3;
    };

    /**
     * 这条技能要不要加浮层？
     *
     * - 映射表里没有的：直接不管，不占位置、不说废话。
     * - 原文本身就是中文的：也不管（除非映射表显式写了 noOverlay: false）。
     */
    const shouldDecorate = (name, description) => {
        const entry = MAP[name];
        if (!entry || !entry.zh) return false;
        if (entry.noOverlay === true) return false;
        if (looksChinese(description)) return false;
        return true;
    };

    const build = (name) => {
        const entry = MAP[name];
        const box = document.createElement('div');
        box.className = 'skvzh-box';

        if (!entry || !entry.zh) return null;      // 没收录 → 什么都不加

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

        // 不再重复英文原文：面板自己的 .SKV_meta 就在下一行写着，
        // 这里再抄一遍只是把同一段话摆两次。
        return box;
    };

    /**
     * 面板自己那行 `<p class="SKV_meta">英文原文 + 来源</p>` 的处置。
     *
     * 中文框已经把「这技能干什么」讲清楚了，底下再铺一整段英文，卡片会长得
     * 没边。默认折起来，只留「来源: xxx」+ 一个「原文」小按钮；点了展开，
     * 再点收起。原文不删，只是默认不占版面。
     */
    const collapseNative = (meter) => {
        // 已经处理过：只确认标记还在，不重建、不重置展开状态。
        // 之前这里直接 return，导致面板重绘（加上补跑的 50/150/400ms）把
        // 「原文」抹成「收起原文」的问题——见 m02045 实测。
        if (meter.dataset.skvzhCollapsed === '1') {
            stripMarkers(meter);
            return;
        }
        meter.dataset.skvzhCollapsed = '1';

        const prov = meter.querySelector('.SKV_metaProvider');
        // 把描述正文单独包起来（面板渲染时是 meter 的裸文本 + 来源 span）
        const body = document.createElement('span');
        body.className = 'skvzh-native';
        for (const node of [...meter.childNodes]) {
            if (node === prov) continue;
            body.appendChild(node);
        }
        if (prov) meter.insertBefore(body, prov);
        else meter.appendChild(body);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'skvzh-toggle';
        btn.textContent = '原文';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const on = meter.dataset.skvzhOpen !== '1';
            meter.dataset.skvzhOpen = on ? '1' : '0';
            btn.textContent = on ? '收起原文' : '原文';
            // 标记一下「用户亲手展开过」，后续补跑不再覆盖按钮文案
            meter.dataset.skvzhTouched = '1';
        });
        if (prov) prov.after(btn);
        else meter.appendChild(btn);
    };

    /**
     * 折起状态下的收尾：按钮文案对齐当前展开状态，并清掉非本补丁留下的标记。
     *
     * 面板手风琴重绘 / 插件重装会只留下 `data-skvzh-collapsed` 而按钮消失，
     * 于是显示成「一段空白 + 来源 + 一个写着收起原文的按钮」；这里补回正常形态。
     */
    const stripMarkers = (meter) => {
        const btn = meter.querySelector(':scope > .skvzh-toggle');
        if (!btn) {
            // 标记在但按钮没了：说明这段 DOM 是重建的，整段重装一次。
            delete meter.dataset.skvzhCollapsed;
            delete meter.dataset.skvzhOpen;
            collapseNative(meter);
            return;
        }
        const want = meter.dataset.skvzhOpen === '1' ? '收起原文' : '原文';
        if (btn.textContent !== want) btn.textContent = want;
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
            const meter = host.querySelector('p.SKV_meta');
            const descText = meter ? (meter.textContent || '') : '';

            // 先清掉可能残留的旧块（旧版本留下的占位提示也在这里一并清掉）
            const stale = [...host.querySelectorAll(':scope > .skvzh-box')];
            const keep = stale.find((el) => el.dataset.skvzhFor === name);
            if (keep) {
                // 中文块还在，但面板可能把原文行重绘过（按钮丢了 / 文案回退），
                // 这里补一次，避免出现「空白 + 来源 + 收起原文」。
                if (meter) collapseNative(meter);
                continue;
            }
            stale.forEach((el) => el.remove());

            if (!meter) continue;                      // 描述还没渲染出来
            if (!shouldDecorate(name, descText)) continue;

            const box = build(name);
            if (!box) continue;
            box.dataset.skvzhFor = name;
            host.insertBefore(box, meter);
            // 中文框已经说清楚了，面板那行英文原文折起来，需要时点「显示原文」再看。
            collapseNative(meter);
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
