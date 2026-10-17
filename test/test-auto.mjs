/**
 * 自动生成相关的单元测试（不打模型、不联网）。
 *
 * 覆盖 host 侧纯函数：指认原文语言、算指纹、合并三份来源、解析模型输出。
 * 这些逻辑一旦错，症状是「中文说明文不对题」——很难靠看界面发现，
 * 所以必须钉住。
 *
 * 用法: node test/test-auto.mjs
 */
import { fingerprint, looksChinese, mergeTables, parseModelJson } from '../lib/index.js';

let pass = 0;
let fail = 0;

function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? '  —— ' + detail : ''}`);
  }
}

console.log('looksChinese');
check('英文原文判为英文', looksChinese('Create polished architecture diagrams as standalone HTML.') === false);
check('中文原文判为中文', looksChinese('工作汇报：按当前记录整理日报、周报、月报与阶段总结。') === true);
check('大半中文的小尾巴仍算中文', looksChinese('数据质量：查缺失、异常、单位、口径与重复记录（支持 xlsx）。') === true);
check('空串判为英文（不该跳过）', looksChinese('') === false);
check('纯符号判为英文', looksChinese('--- ... ===') === false);
check('恰好三成中文算中文', looksChinese('中文abc') === true, '3 汉字 / 10 非空白');

console.log('fingerprint');
const a = fingerprint('Create polished architecture diagrams.');
check('同文本同指纹', a === fingerprint('Create polished architecture diagrams.'));
check('改一个字指纹就变', a !== fingerprint('Create polished architecture diagrams!'));
check('长度 16', a.length === 16, a);
check('空值不炸', typeof fingerprint(undefined) === 'string');

console.log('parseModelJson');
check('裸 JSON', parseModelJson('{"zh":"画图","tag":"可视化","bullets":["一","二"]}')?.zh === '画图');
check('```json 围栏', parseModelJson('```json\n{"zh":"画图"}\n```')?.zh === '画图');
check('围栏 + 前后废话', parseModelJson('好的，这是结果：\n```json\n{"zh":"画图"}\n```\n希望有用')?.zh === '画图');
check('前后废话无围栏', parseModelJson('说明如下 {"zh":"画图"} 完毕')?.zh === '画图');
check('不是 JSON 返回 undefined', parseModelJson('抱歉我不会') === undefined);
check('数组不算对象', parseModelJson('["zh"]') === undefined);
check('空串', parseModelJson('') === undefined);

console.log('mergeTables');
const manual = { archify: { zh: '手写', tag: '可视化' }, plain: { zh: '只有手写' } };
const cache = { archify: { zh: '自动' }, extra: { zh: '只有自动' } };
const merged = mergeTables(manual, cache);
check('手写压过自动', merged.archify.zh === '手写');
check('自动条目保留', merged.extra.zh === '只有自动');
check('只手写的还在', merged.plain.zh === '只有手写');
check('合并不改原表', manual.archify.zh === '手写' && cache.archify.zh === '自动');

console.log('');
console.log(`  ${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
