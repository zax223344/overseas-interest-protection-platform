/**
 * test_chain.js — 海外利益保护情报平台「源-流-用-馈」全链路自测
 *
 * 设计原则：本测试直接加载【真实源码】并抽取【真实分发函数】，
 * 不重写业务逻辑，因此测到的就是线上运行的代码。
 *   1) datasources.js  —— 数据源库（采集 / contributeBurst）
 *   2) scraper.js       —— COLLECTED_DB / ENTERPRISE_DB / THREAT_ORGS_DB
 *   3) app.js 中抽取    —— _addLiveAlert / _injectLiveIntoStores /
 *                          _applyLiveToCountryScore / _ingestApproved /
 *                          _fmtNow / _extractCountryFromText / _startApprovedSync
 *
 * 验证链路：
 *   A) 数据源采集 → 进入数据库(COLLECTED_DB) ？
 *   B) 审核通过 → 反哺各功能区（预警中心/事件流/国家分数/企业/威胁组织/自动预警/AI素材/实时流）？
 *   C) 系统自循环守护(_startApprovedSync) 能否在没有外部触发下自动把"已审核"数据分发全系统 ？
 *
 * 运行： node test_chain.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------- 1. 工具：从源码中抽取顶层 function 体（按花括号配对） ---------- */
function extractFn(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('[extract] 未找到函数: ' + name);
  let i = m.index;
  const start = src.indexOf('{', i);
  if (start < 0) throw new Error('[extract] 找不到函数体起始: ' + name);
  let depth = 0, k = start;
  for (; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}

/* ---------- 2. 浏览器环境最小桩 ---------- */
class LS {
  constructor() { this.m = {}; }
  getItem(k) { return k in this.m ? this.m[k] : null; }
  setItem(k, v) { this.m[k] = String(v); }
  removeItem(k) { delete this.m[k]; }
  clear() { this.m = {}; }
}
function fakeEl() {
  return {
    style: {}, textContent: '', innerHTML: '',
    classList: { toggle() {}, add() {}, remove() {} },
    querySelectorAll() { return []; },
    appendChild() {}, setAttribute() {}, addEventListener() {}
  };
}
const intervals = [];
const sandbox = {
  console,
  Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error,
  parseInt, parseFloat, isNaN, setTimeout: () => 0, clearTimeout: () => {},
  setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
  clearInterval: () => {},
  localStorage: new LS(),
  window: { _currentView: 'situation' },
  document: { getElementById: () => fakeEl(), querySelectorAll: () => [], addEventListener() {} },
  /* —— 预置全局（与 app.js 同名，用 var 声明以便跨脚本共享）—— */
  var: undefined
};
// 在上下文里声明需要的全局（用 var 使其成为共享全局属性）
const preamble = `
var _seenLiveIds = {};
var _seenLiveSigs = {};
var _liveCount = 0;
var _ingestedIds = {};
var LIVE_ALERTS = [];
var ALERTS = [];
var EVENTS = [];
var TERROR_EVENTS = [];
var DBCenter = { getAll: function(){ return []; } };
var SITUATION = { renderIntelPanels:function(){}, renderAlertSummary:function(){}, renderLiveStats:function(){} };
var ASSETS = { init:function(){} };
var THREAT_ASSESS = { init:function(){} };
var AUTOALERT = {
  _alerts: [], _key: 'orps_autoalert',
  _load: function(){ try{ this._alerts = JSON.parse(localStorage.getItem(this._key) || '[]'); }catch(e){ this._alerts=[]; } }
};
var AIREPORT = {
  _materialCart: null,
  _loadCart: function(){ try{ this._materialCart = JSON.parse(localStorage.getItem('orps_ai_material') || '[]'); }catch(e){ this._materialCart=[]; } },
  _saveCart: function(){ try{ localStorage.setItem('orps_ai_material', JSON.stringify(this._materialCart)); }catch(e){} }
};
function renderTicker(){}
function _refreshOpenViewLive(){}
function calcOverall(s){ var t=0; if(typeof DIMS!=='undefined'){ DIMS.forEach(function(d){ t+=(s[d.key]||0)*d.w; }); } return Math.round(t*10)/10; }
var DIMS = [
  {key:'security',name:'安全',w:0.2},{key:'political',name:'政治',w:0.15},{key:'economic',name:'经济',w:0.15},
  {key:'geopolitical',name:'地缘',w:0.15},{key:'operational',name:'运营',w:0.1},{key:'social',name:'社会',w:0.1},
  {key:'legal',name:'法律',w:0.05},{key:'natural',name:'自然',w:0.1}
];
var COUNTRIES = [
  { name:'巴基斯坦', scores:{security:6.0,political:5.0,economic:4.5,geopolitical:5.5,operational:5.0,social:4.0,legal:4.5,natural:3.0} },
  { name:'缅甸', scores:{security:7.0,political:6.0,economic:4.0,geopolitical:5.0,operational:5.5,social:5.0,legal:4.0,natural:4.0} },
  { name:'苏丹', scores:{security:8.0,political:7.0,economic:3.5,geopolitical:6.0,operational:6.0,social:5.5,legal:3.5,natural:5.0} }
];
`;
vm.createContext(sandbox);
vm.runInContext(preamble, sandbox, { filename: 'preamble.js' });

/* ---------- 3. 加载真实源码 ---------- */
const scraperSrc = read('scraper.js');
const dsSrc = read('datasources.js');
const appSrc = read('app.js');

vm.runInContext(scraperSrc, sandbox, { filename: 'scraper.js' });
vm.runInContext(dsSrc, sandbox, { filename: 'datasources.js' });

// 初始化数据库（播种模拟数据，模拟首次打开网页）
try { sandbox.COLLECTED_DB.init(); } catch (e) { console.warn('COLLECTED_DB.init warn:', e.message); }
try { sandbox.ENTERPRISE_DB.init(); } catch (e) { console.warn('ENTERPRISE_DB.init warn:', e.message); }
try { sandbox.THREAT_ORGS_DB.init(); } catch (e) { console.warn('THREAT_ORGS_DB.init warn:', e.message); }

// 清空播种数据，仅保留可控夹具，保证断言确定（不影响对真实代码逻辑的验证）
sandbox.COLLECTED_DB.clear();
try { sandbox.localStorage.removeItem(sandbox.ENTERPRISE_DB.KEY); } catch (e) {}
try { sandbox.localStorage.removeItem(sandbox.THREAT_ORGS_DB.KEY); } catch (e) {}

// 抽取真实分发函数并加载到上下文
['_addLiveAlert', '_injectLiveIntoStores', '_applyLiveToCountryScore',
 '_fmtNow', '_extractCountryFromText', '_ingestApproved', '_startApprovedSync', '_approvedSyncScan'
].forEach((fn) => {
  const code = extractFn(appSrc, fn);
  vm.runInContext(code, sandbox, { filename: 'app:' + fn + '.js' });
});
// 顶层标志位声明（extractFn 只抽函数体，app.js 的 var _approvedSyncStarted=false 不在其中，需补声明）
vm.runInContext('var _approvedSyncStarted=false;', sandbox, { filename: 'flagDecl.js' });
// 启动自循环守护（会向 intervals 注册一个 15000ms 的扫描回调，并置 _approvedSyncStarted=true）
vm.runInContext('try{ _startApprovedSync(); }catch(e){ console.log("[startSync err]", e.message); }', sandbox, { filename: 'startSync.js' });

/* ---------- 4. 测试夹具 ---------- */
// 企业资产夹具（巴基斯坦项目，用于验证企业联动）
sandbox.ENTERPRISE_DB.add({ country: '巴基斯坦', name: '某中资能源项目', sector: '能源', risk_level: 'low', risk_events: [] });
// 威胁组织夹具（活跃于巴基斯坦的武装组织，用于验证威胁组织联动）
sandbox.THREAT_ORGS_DB.add({ name: '测试武装组织A', category: 'terrorist', threat_level: 'high', active_regions: ['巴基斯坦', '阿富汗'] });

const C = sandbox;
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? '  ✅ PASS' : '  ❌ FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
}

/* ================= A) 数据源采集 → 数据库 ================= */
console.log('\n【A】数据源采集 → 进入采集库(COLLECTED_DB)');
const totalBefore = sandbox.COLLECTED_DB.totalCount();
const burstN = sandbox.DATASOURCES.contributeBurst();   // 真实"自动采集"按键同源逻辑
const totalAfter = sandbox.COLLECTED_DB.totalCount();
check('DATASOURCES 注册表已扩充至 ≥131 源', sandbox.DATASOURCES.REGISTRY.length >= 131,
      'REGISTRY=' + sandbox.DATASOURCES.REGISTRY.length);
check('contributeBurst 实际写入采集库', burstN > 0 && totalAfter > totalBefore,
      '本次采集 ' + burstN + ' 条；采集库 ' + totalBefore + ' → ' + totalAfter);
check('写入项 audit_status 默认为 pending(待审核)', (function () {
  const all = [];
  sandbox.COLLECTED_DB.CATEGORIES.forEach(c => sandbox.COLLECTED_DB.getAll(c).forEach(i => all.push(i)));
  const fresh = all.filter(i => i._fromSource && i.audit_status === 'pending');
  return fresh.length > 0;
})(), '存在待审核的采集项');

/* ================= B) 审核通过 → 全系统分发 ================= */
console.log('\n【B】审核通过 → 反哺系统各功能区（手动触发 _ingestApproved）');
// 构造一条确定性的待审核情报：巴基斯坦 / 安全事件 / 高风险
const catB = 'security_events';
const idB = sandbox.COLLECTED_DB.add(catB, {
  title: '公安部境外安保局：巴基斯坦某中资项目周边安全形势趋紧',
  country: '巴基斯坦', content: '巴基斯坦安全事件', source: '公安部境外安保局',
  severity: '高', category: '安全风险', data_type: catB, enterprise: '', url: '', tags: ['巴基斯坦']
});
sandbox.COLLECTED_DB.setAuditStatus(catB, idB, 'approved');

const before = {
  ALERTS: C.ALERTS.length, LIVE: C.LIVE_ALERTS.length, EVENTS: C.EVENTS.length,
  TERROR: C.TERROR_EVENTS.length, OSINT: sandbox.COLLECTED_DB.count('osint_intel'),
  AUTO: C.AUTOALERT._alerts.length, AI: (C.AIREPORT._materialCart || []).length,
  SCORE: (function () { const ct = C.COUNTRIES.find(c => c.name === '巴基斯坦'); return ct.scores.security; })(),
  ENT: sandbox.ENTERPRISE_DB.getByCountry('巴基斯坦')[0].risk_level,
  THR: sandbox.THREAT_ORGS_DB.getByRegion('巴基斯坦')[0].threat_level
};
const itemB = sandbox.COLLECTED_DB.getAll(catB).find(d => d.id === idB);
sandbox._ingestApproved(itemB, catB);   // 与审批动作钩子调用的是同一函数
const after = {
  ALERTS: C.ALERTS.length, LIVE: C.LIVE_ALERTS.length, EVENTS: C.EVENTS.length,
  TERROR: C.TERROR_EVENTS.length, OSINT: sandbox.COLLECTED_DB.count('osint_intel'),
  AUTO: C.AUTOALERT._alerts.length, AI: (C.AIREPORT._materialCart || []).length,
  SCORE: (function () { const ct = C.COUNTRIES.find(c => c.name === '巴基斯坦'); return ct.scores.security; })(),
  ENT: sandbox.ENTERPRISE_DB.getByCountry('巴基斯坦')[0].risk_level,
  THR: sandbox.THREAT_ORGS_DB.getByRegion('巴基斯坦')[0].threat_level
};

check('预警中心(ALERTS) 新增', after.ALERTS > before.ALERTS, before.ALERTS + '→' + after.ALERTS);
check('实时情报流(LIVE_ALERTS) 新增', after.LIVE > before.LIVE, before.LIVE + '→' + after.LIVE);
check('事件流(EVENTS) 新增', after.EVENTS > before.EVENTS, before.EVENTS + '→' + after.EVENTS);
check('恐情/安全流(TERROR_EVENTS) 新增', after.TERROR > before.TERROR, before.TERROR + '→' + after.TERROR);
check('采集库二次归类(osint_intel) 新增', after.OSINT > before.OSINT, before.OSINT + '→' + after.OSINT);
check('自动预警(AUTOALERT) 新增', after.AUTO > before.AUTO, before.AUTO + '→' + after.AUTO);
check('AI报告素材篮 新增(红/橙)', after.AI > before.AI, before.AI + '→' + after.AI);
check('国家风险分数(巴基斯坦 security) 上调', after.SCORE > before.SCORE, before.SCORE + '→' + after.SCORE);
check('企业资产联动：项目风险等级提升', after.ENT !== before.ENT && after.ENT === 'high', before.ENT + '→' + after.ENT);
check('威胁组织联动：活跃组织威胁等级变化', after.THR !== before.THR, before.THR + '→' + after.THR);

/* ================= C) 系统自循环守护 ================= */
console.log('\n【C】系统自我循环(_approvedSyncScan 守护)—— 不依赖外部触发自动分发');
// 清空已分发去重表，使守护重新扫描
Object.keys(C._ingestedIds).forEach(k => delete C._ingestedIds[k]);
// 再写入一条"已审核"情报（缅甸 / 恐袭 / 中风险=橙）
const catC = 'terror_events';
const idC = sandbox.COLLECTED_DB.add(catC, {
  title: '缅甸：某武装组织宣称对袭击负责', country: '缅甸', content: '缅甸恐袭事件',
  source: 'GTD恐怖主义数据库', severity: '中', category: '安全风险', data_type: catC, enterprise: '', url: '', tags: ['缅甸']
});
sandbox.COLLECTED_DB.setAuditStatus(catC, idC, 'approved');
const alertsBeforeDaemon = C.ALERTS.length;
// 守护已在启动时经由 _startApprovedSync() 注册；此处直接驱动扫描函数（即每15秒自动执行的逻辑）
check('自循环守护已启动(_approvedSyncStarted=true)', sandbox._approvedSyncStarted === true,
      'flag=' + sandbox._approvedSyncStarted);
try { vm.runInContext('typeof _approvedSyncScan==="function" && _approvedSyncScan();', sandbox, { filename: 'scan.js' }); } catch (e) {}
const alertsAfterDaemon = C.ALERTS.length;
check('守护自动把"已审核"数据分发全系统（无需外部触发）',
      alertsAfterDaemon > alertsBeforeDaemon,
      'ALERTS ' + alertsBeforeDaemon + '→' + alertsAfterDaemon + '（自动循环生效）');

/* ---------- 5. 汇总 ---------- */
console.log('\n========================================');
const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
console.log('测试结果: ' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
console.log('数据源总数: ' + sandbox.DATASOURCES.REGISTRY.length + ' 个');
console.log('结论: ' + (fail === 0
  ? '✅ 全链路打通 —— 数据源采集→入库→审核通过→全系统流动，且系统具备自循环能力（不依赖外部）。'
  : '❌ 存在未通过项，需排查。'));
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
