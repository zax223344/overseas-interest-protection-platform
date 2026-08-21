/* 端到端：真实后端 → 回填实时池 → 跑真实 tick/collect → 检查入库内容（2026-08-05）
 * 回答用户两个问题：① 入库的是不是中文；② 引擎跑起来到底有没有数据流进来。
 * 需要后端在 3000 端口运行。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:3000';

/* ---- 桩环境 ---- */
const timers = [];
global.window = global;
global.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }) };
global.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearInterval = () => {};
global.setTimeout = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
/* 必须先存原生引用，否则覆盖后 timeout 里再引用 globalThis.AbortSignal 会自递归爆栈 */
const NativeAbortSignal = globalThis.AbortSignal;
global.AbortSignal = { timeout: (ms) => NativeAbortSignal.timeout(Math.max(ms || 0, 150000)) };
global.showToast = () => {};

const INSERTED = [];
global.COLLECTED_DB = { add: (cat, o) => { INSERTED.push({ cat, ...o }); return true; }, count: () => 0, getAll: () => INSERTED };

const geval = (0, eval);
geval(fs.readFileSync(path.join(ROOT, 'gate.js'), 'utf8'));
geval(fs.readFileSync(path.join(ROOT, 'datasources.js'), 'utf8'));
const DS = global.DATASOURCES;

console.log('\n=== 端到端：自动采集 + 落库即中文 ===\n');

/* 1) 真实拉全量 */
console.log('[1] 请求后端全量采集 /api/scrape?all=1 ...');
const t0 = Date.now();
const r = await fetch(BASE + '/api/scrape?all=1', { signal: NativeAbortSignal.timeout(150000) });
const j = await r.json();
const cats = Object.keys(j.data || {});
let total = 0; cats.forEach(c => total += (j.data[c] || []).length);
console.log('    后端返回 ' + total + ' 条 / ' + cats.length + ' 分类，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

/* 2) 回填池（模拟 _refreshReal 第②步的新逻辑） */
let refill = 0;
cats.forEach(c => { refill += DS.pool.fill(c, j.data[c] || []); });
console.log('[2] 回填实时池: ' + refill + ' 条，池总量 ' + DS.pool.size());
if (DS.pool.size() === 0) { console.log('\n❌ 池为空，自动采集必然无数据流。中止。'); process.exit(1); }

/* 3) 启动真实引擎（注册 5s 调度器），再把所有源设为立即到期，连跑 12 轮 tick */
DS.startEngine();
DS.REGISTRY.forEach(s => { DS._state[s.id] = { status: 'online', health: 95, lastT: '-', nextDue: 0, todayN: 0, totalN: 0, boost: 1 }; });
const tickFn = timers.find(t => t.ms === 5000);
if (!tickFn) { console.log('❌ 5s 调度器未注册，引擎没起来'); process.exit(1); }
console.log('[3] 执行调度 tick（模拟引擎运行）...');
for (let round = 0; round < 12; round++) {
  DS.REGISTRY.forEach(s => { DS._state[s.id].nextDue = 0; });
  if (tickFn) tickFn.fn();
}
console.log('    入库条数: ' + INSERTED.length + '，池剩余 ' + DS.pool.size() + '，已消费标记 ' + DS.pool.consumed());

/* 4) 检查入库质量 */
console.log('\n[4] 入库数据质量检查');
const zh = INSERTED.filter(x => /[\u4e00-\u9fa5]/.test(String(x.title || '').slice(0, 30)));
const foreign = INSERTED.filter(x => !/[\u4e00-\u9fa5]/.test(String(x.title || '').slice(0, 30)));
const withEn = INSERTED.filter(x => x.title_en);
const withUrl = INSERTED.filter(x => x.url);
console.log('    中文标题       : ' + zh.length + ' / ' + INSERTED.length);
console.log('    残留外文标题   : ' + foreign.length);
console.log('    带 title_en溯源: ' + withEn.length);
console.log('    带 url 链接    : ' + withUrl.length);
const byCat = {};
INSERTED.forEach(x => byCat[x.cat] = (byCat[x.cat] || 0) + 1);
console.log('    分类分布       : ' + JSON.stringify(byCat));

if (foreign.length) {
  console.log('\n[4b] 残留外文明细');
  foreign.forEach(x => console.log('    ! ' + JSON.stringify(String(x.title).slice(0, 90)) + '  | en=' + JSON.stringify(String(x.title_en || '').slice(0, 50))));
}
console.log('\n[5] 入库样例（前 6 条）');
INSERTED.slice(0, 6).forEach((x, i) => {
  console.log('  ' + (i + 1) + '. [' + x.cat + '] ' + String(x.title).slice(0, 52));
  if (x.title_en) console.log('      原文: ' + String(x.title_en).slice(0, 52));
});

const okCollect = INSERTED.length > 0;
const okZh = foreign.length === 0;
console.log('\n=== 判定 ===');
console.log((okCollect ? '✅' : '❌') + ' 自动采集有数据流入库: ' + INSERTED.length + ' 条');
console.log((okZh ? '✅' : '❌') + ' 落库即中文: 残留外文 ' + foreign.length + ' 条');
process.exit(okCollect && okZh ? 0 : 1);
