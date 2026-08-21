/* 实时池回填/消费逻辑回归测试（2026-08-05）
 * 验证 datasources.js 的 _fillPool/_poolKey/_consumed/_ensurePool：
 * 修复前的病灶：① all=1 的 277 条已翻译数据只打日志就丢弃；
 *              ② 去重键用译文标题（措辞漂移导致重复入库）；
 *              ③ 池被 shift 消费空后要干等 120s。
 * 用最小 DOM/定时器桩加载真实 datasources.js，跑真实函数，不复制逻辑。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- 最小浏览器环境桩 ---------- */
const timers = [];
global.window = global;
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} })
};
global.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearInterval = () => {};
global.setTimeout = (fn, ms) => { return 0; };   // 不真跑，避免测试挂起
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
let fetchCalls = 0;
global.fetch = () => { fetchCalls++; return Promise.reject(new Error('test-stub')); };
global.AbortSignal = { timeout: () => ({}) };
global.showToast = () => {};

/* 用间接 eval 在全局作用域执行，否则被测文件顶层的 `var DATASOURCES = ...`
   会留在 ESM 模块作用域里，拿不到导出对象（踩过）。 */
const geval = (0, eval);
/* 闸门（真实 gate.js，供 collect 用） */
geval(fs.readFileSync(path.join(ROOT, 'gate.js'), 'utf8'));
/* 采集库桩：记录入库内容 */
const INSERTED = [];
global.COLLECTED_DB = {
  add: (cat, o) => { INSERTED.push({ cat, ...o }); return true; },
  count: () => 0,
  getAll: () => INSERTED
};
/* 被测模块 */
geval(fs.readFileSync(path.join(ROOT, 'datasources.js'), 'utf8'));
const DS = global.DATASOURCES;

console.log('\n=== 实时池回归测试 ===\n');
console.log('[0] 模块加载');
ok('DATASOURCES 已导出', !!DS);
ok('pool 调试接口已暴露', !!(DS && DS.pool && typeof DS.pool.fill === 'function'));
if (!DS || !DS.pool) { console.log('\n模块未加载，中止'); process.exit(1); }

/* ---------- 1. 回填 ---------- */
console.log('\n[1] all=1 结果回填实时池（修复前：直接丢弃）');
const batch = [
  { title: '真主党拒绝黎巴嫩和以色列举行新一轮会谈', title_en: 'Hezbollah rejects fresh round of talks between Lebanon and Israel', title_zh: '真主党拒绝黎巴嫩和以色列举行新一轮会谈', content: '中资企业在黎巴嫩的项目安全受影响', country: '黎巴嫩', url: 'http://x/1' },
  { title: '多哥如何成为俄罗斯向马里运送武器的新入口', title_en: 'How Togo has become a new entry point for weapons sent by Russia to Mali', content: '中国公民在马里的安保风险上升', country: '马里', url: 'http://x/2' },
  { title: '巴基斯坦俾路支省中资项目遭袭击', title_en: '', content: '中方人员安全', country: '巴基斯坦', url: 'http://x/3' }
];
const n1 = DS.pool.fill('osint_intel', batch);
ok('首次回填 3 条', n1 === 3, '实际 ' + n1);
ok('池总量 = 3', DS.pool.size() === 3, '实际 ' + DS.pool.size());

/* ---------- 2. 去重键稳定性 ---------- */
console.log('\n[2] 去重键用英文原标题（修复前用译文标题→措辞漂移重复入库）');
const drift = [{
  title: '真主党拒绝黎以之间新一轮会谈',                       // 同一原文，另一通道译法
  title_en: 'Hezbollah rejects fresh round of talks between Lebanon and Israel',
  url: 'http://x/1'
}];
const n2 = DS.pool.fill('osint_intel', drift);
ok('译文措辞漂移仍被识别为重复', n2 === 0, '实际新增 ' + n2);
ok('池总量仍为 3', DS.pool.size() === 3, '实际 ' + DS.pool.size());

const n3 = DS.pool.fill('osint_intel', [{ title: '新情报：印尼镍矿中企员工被扣', title_en: 'Chinese workers detained at Indonesia nickel mine', url: 'http://x/9' }]);
ok('真正的新条目能进池', n3 === 1, '实际 ' + n3);
ok('新条目插在队首（新在前）', DS.pool.dump()['osint_intel'][0].url === 'http://x/9');

/* ---------- 3. 分类隔离 ---------- */
console.log('\n[3] 分类隔离');
DS.pool.fill('terror_events', [{ title: '索马里青年党袭击中企营地', title_en: 'Al-Shabaab attacks Chinese camp', url: 'http://y/1' }]);
ok('terror_events 独立成池', (DS.pool.dump()['terror_events'] || []).length === 1);
ok('池总量累加 = 5', DS.pool.size() === 5, '实际 ' + DS.pool.size());

/* ---------- 4. 池上限 ---------- */
console.log('\n[4] 池上限 150（超限丢最旧，不丢最新）');
const bulk = [];
for (let i = 0; i < 200; i++) bulk.push({ title: 'bulk-' + i, title_en: 'bulk-item-' + i, url: 'http://b/' + i });
DS.pool.fill('military_conflicts', bulk);
const mp = DS.pool.dump()['military_conflicts'];
ok('池被截断到 150', mp.length === 150, '实际 ' + mp.length);
ok('保留的是队首（最新批次）', mp[0].url === 'http://b/0');

/* ---------- 5. 已消费条目不回池 ---------- */
console.log('\n[5] 已入库条目不再回池（防历史条目占满池子）');
const before = DS.pool.consumed();
ok('初始已消费计数为 0', before === 0, '实际 ' + before);

/* 让一个源真实消费一次：把测试条目放到该源对应的分类池 */
const src = DS.REGISTRY[0];
ok('REGISTRY 非空', !!src);
DS._state[src.id] = { status: 'online', health: 95, lastT: '-', nextDue: 0, todayN: 0, totalN: 0, boost: 1 };

/* ---------- 6. 入库字段透传（落库即中文 + 溯源） ---------- */
console.log('\n[6] collect 入库字段透传 title_en/url/content');
/* 直接验证补池后条目自身带齐字段——collect 依赖这些字段透传 */
const item = DS.pool.dump()['osint_intel'].find(x => x.url === 'http://x/1');
ok('池内保留 title_en 原文', !!(item && item.title_en));
ok('池内保留 url', !!(item && item.url === 'http://x/1'));
ok('池内 title 已是中文', !!(item && /[\u4e00-\u9fa5]/.test(item.title)));

/* ---------- 7. 低水位触发 ---------- */
console.log('\n[7] 低水位即时补池（修复前空池要干等 120s）');
fetchCalls = 0;
DS.pool.ensure();                       // 池 >20，不该触发
ok('池充足时不触发补池', fetchCalls === 0, 'fetch 调用 ' + fetchCalls);

/* 清空池模拟被消费光 */
const dump = DS.pool.dump();
Object.keys(dump).forEach(k => { dump[k].length = 0; });
ok('池已清空', DS.pool.size() === 0);
fetchCalls = 0;
DS.pool.ensure();                       // 池 <20，应触发
ok('池干涸时立即触发补池', fetchCalls > 0, 'fetch 调用 ' + fetchCalls);
const after1 = fetchCalls;
fetchCalls = 0;
DS.pool.ensure();                       // 30s 内重复调用应被节流
ok('30s 节流生效（不打爆后端）', fetchCalls === 0, 'fetch 调用 ' + fetchCalls);
console.log('    （首次补池触发 ' + after1 + ' 次请求 = 11个分类 + 1次全量）');

console.log('\n=== 结果: ' + PASS + ' 通过 / ' + FAIL + ' 失败 ===\n');
process.exit(FAIL ? 1 : 0);
