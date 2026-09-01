/* ===== 翻译链路熔断机制离线验证（_tr_check.js）=====
 * 不启动服务、不发真实网络请求。从 server.js 动态抽取：
 *   ① [TR-FUSE-BEGIN/END] 熔断状态机块（真实代码）
 *   ② _translateAny / _translateAnyRaw / _translationOk 真实函数定义
 * 注入 mock 翻译通道（带调用计数 + 行为开关），跑 4 个用例：
 *   A) Baidu 54004 → 12h 熔断，后续 5 条不再调 Baidu，仍走通 Google web
 *   B) MyMemory 429 → 12h 熔断
 *   C) 纯中文输入 → 不发起任何翻译请求
 *   D) 熔断到时 → 自动解除、恢复调用
 * 用法：node _tr_check.js */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

/* 按函数名抽取真实函数定义（花括号配平扫描） */
function extractFn(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('server.js 中未找到函数: ' + name);
  const start = src.indexOf('{', m.index);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error('函数括号未闭合: ' + name);
}

const i0 = SRC.indexOf('[TR-FUSE-BEGIN]');
const i1 = SRC.indexOf('[TR-FUSE-END]');
if (i0 < 0 || i1 < 0) { console.error('FAIL: server.js 缺少 [TR-FUSE] 标记块'); process.exit(1); }
const FUSE_BLOCK = SRC.slice(SRC.lastIndexOf('/*', i0), SRC.lastIndexOf('/*', i1));

const CODE = FUSE_BLOCK + '\n'
  + ['_translationOk', '_translateAny', '_translateAnyRaw'].map(n => extractFn(SRC, n)).join('\n');

const logs = [];
const mockConsole = {
  log: function () { logs.push('[log] ' + Array.prototype.join.call(arguments, ' ')); },
  warn: function () { logs.push('[warn] ' + Array.prototype.join.call(arguments, ' ')); }
};
const calls = { TranSmart: 0, Youdao: 0, Baidu: 0, MyMemory: 0, Libre: 0, Edge: 0, Google: 0 };
const mode = {
  tranSmart: 'qualityFail', youdao: 'qualityFail', baidu: 'err54004',
  myMemory: 'qualityFail', libre: 'down', edge: 'down', google: 'ok'
};
const GOOGLE_ZH = '谷歌网页通道模拟译文：这是一条用于验证熔断链路的合格中文内容。';
const BAIDU_ZH = '百度通道模拟译文：这是熔断解除后恢复调用的合格中文内容。';

/* mock 通道：仅替换网络边界，熔断/预检/质量判定全部走 server.js 真实代码 */
const deps = {
  console: mockConsole,
  process: { env: { BAIDU_TRANSLATE_APPID: 'test-appid', BAIDU_TRANSLATE_KEY: 'test-key' } },
  MYMEMORY_KEY: undefined,
  zhPolish: { polish: function (s) { return s; } },
  _fixMixedZh: async function (z) { return z; },
  _tryTranSmart: async function () {
    calls.TranSmart++;
    if (mode.tranSmart === 'err429') throw new Error('TranSmart HTTP 429');
    return mode.tranSmart === 'ok' ? GOOGLE_ZH : '';
  },
  _tryYoudao: async function () {
    calls.Youdao++;
    if (mode.youdao === 'err411') throw new Error('Youdao HTTP 411');
    return mode.youdao === 'ok' ? GOOGLE_ZH : '';
  },
  _baiduTranslateRetry: async function () {
    calls.Baidu++;
    if (mode.baidu === 'err54004') throw new Error('baidu err 54004(余额耗尽，当日熔断)');
    return mode.baidu === 'ok' ? BAIDU_ZH : '';
  },
  _myMemoryOne: async function () {
    calls.MyMemory++;
    if (mode.myMemory === 'err429') throw new Error('mymemory 429');
    if (mode.myMemory === 'quota') return '__QUOTA__';
    return mode.myMemory === 'ok' ? GOOGLE_ZH : '';
  },
  _tryLibreTranslate: async function () { calls.Libre++; return null; },
  _tryEdge: async function () { calls.Edge++; return null; },
  _tryGoogleWebTranslate: async function () {
    calls.Google++;
    return mode.google === 'ok' ? GOOGLE_ZH : '';
  }
};

const factory = new Function('deps', `
  const { console, process, MYMEMORY_KEY, zhPolish, _fixMixedZh,
    _tryTranSmart, _tryYoudao, _baiduTranslateRetry, _myMemoryOne,
    _tryLibreTranslate, _tryEdge, _tryGoogleWebTranslate } = deps;
` + CODE + `
  return { _translateAny, _translateAnyRaw, _translationOk, _trFuseOpen, _trFuseTrip, _trZhDominated, _TR_FUSE };
`);
const api = factory(deps);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  | ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  | ' + detail : '')); }
}
function totalCalls() { return calls.TranSmart + calls.Youdao + calls.Baidu + calls.MyMemory + calls.Libre + calls.Edge + calls.Google; }
const EN = 'Breaking news: armed group attacks convoy in eastern region, officials say';

async function main() {
  console.log('== 用例 A：Baidu 54004 → 12h 熔断，后续 5 条不再调用 Baidu，仍走通 Google web ==');
  const r1 = await api._translateAny(EN);
  check('A1 首条触发 54004 后仍得到合格中文译文（Google web 兜底）', r1 === GOOGLE_ZH, 'result=' + String(r1).slice(0, 18) + '…');
  check('A2 首条确实调用过一次 Baidu', calls.Baidu === 1, 'Baidu 调用数=' + calls.Baidu);
  check('A3 Baidu 已进入熔断状态', api._TR_FUSE.has('Baidu'), 'fuse=' + JSON.stringify(api._TR_FUSE.get('Baidu')));
  let allOk = true;
  for (let i = 0; i < 5; i++) {
    const r = await api._translateAny(EN + ' (item ' + i + ')');
    if (r !== GOOGLE_ZH) allOk = false;
  }
  check('A4 熔断期间后续 5 条仍全部译出（其他通道兜底不受影响）', allOk);
  check('A5 熔断期间 Baidu 零调用（快速跳过，不发请求）', calls.Baidu === 1, 'Baidu 调用数仍=' + calls.Baidu);
  check('A6 Libre/Edge 触发熔断后同样仅首条 1 次调用', calls.Libre === 1 && calls.Edge === 1,
    'Libre=' + calls.Libre + ' Edge=' + calls.Edge);
  check('A6b MyMemory 质量不合格（非额度错误）不熔断、仍逐条尝试（设计如此：熔断只挡通道级错误）',
    calls.MyMemory === 6 && !api._TR_FUSE.has('MyMemory'), 'MyMemory=' + calls.MyMemory);
  check('A7 熔断触发日志输出', logs.some(l => l.indexOf('Baidu 熔断 12h') >= 0 && l.indexOf('54004') >= 0),
    (logs.filter(l => l.indexOf('Baidu 熔断') >= 0)[0]) || '(无)');

  console.log('== 用例 B：MyMemory 429 → 12h 熔断 ==');
  api._TR_FUSE.clear();
  deps.process.env.BAIDU_TRANSLATE_APPID = undefined; /* 本用例不配 Baidu，聚焦 MyMemory */
  mode.myMemory = 'err429';
  const b0 = calls.MyMemory;
  const rb = await api._translateAny(EN + ' (case B)');
  check('B1 MyMemory 429 后仍得到合格译文（Google web 兜底）', rb === GOOGLE_ZH);
  check('B2 MyMemory 已熔断', api._TR_FUSE.has('MyMemory'), 'fuse=' + JSON.stringify(api._TR_FUSE.get('MyMemory')));
  const rem = api._TR_FUSE.get('MyMemory') ? api._TR_FUSE.get('MyMemory').until - Date.now() : 0;
  check('B3 熔断时长 ≈ 12h', rem > 11.5 * 3600 * 1000 && rem <= 12 * 3600 * 1000, '剩余 ' + (rem / 3600000).toFixed(2) + 'h');
  for (let i = 0; i < 3; i++) await api._translateAny(EN + ' (case B ' + i + ')');
  check('B4 熔断期间后续 3 条 MyMemory 零调用', calls.MyMemory === b0 + 1, 'MyMemory 调用数=' + calls.MyMemory);

  console.log('== 用例 C：纯中文输入 → 不发起任何翻译请求 ==');
  api._TR_FUSE.clear();
  const c0 = totalCalls();
  const rc = await api._translateAny('今天天气很好');
  check('C1 中文输入直接返回原文', rc === '今天天气很好', 'result=' + rc);
  check('C2 全通道零请求', totalCalls() === c0, '新增请求数=' + (totalCalls() - c0));
  check('C3 预检函数判定正确', api._trZhDominated('今天天气很好') === true && api._trZhDominated(EN) === false);

  console.log('== 用例 D：熔断到时 → 自动解除、恢复调用 ==');
  api._TR_FUSE.clear();
  deps.process.env.BAIDU_TRANSLATE_APPID = 'test-appid';
  mode.myMemory = 'qualityFail';
  mode.baidu = 'err54004';
  await api._translateAny(EN + ' (case D trip)');
  const d0 = calls.Baidu;
  check('D1 Baidu 重新进入熔断', api._TR_FUSE.has('Baidu'));
  api._TR_FUSE.get('Baidu').until = Date.now() - 1; /* 模拟熔断到时 */
  mode.baidu = 'ok';
  const rd = await api._translateAny(EN + ' (case D recover)');
  check('D2 到时后自动解除并恢复调用 Baidu', calls.Baidu === d0 + 1, 'Baidu 调用数 ' + d0 + ' → ' + calls.Baidu);
  check('D3 恢复后译文来自 Baidu 通道', rd === BAIDU_ZH, 'result=' + String(rd).slice(0, 18) + '…');
  check('D4 解除日志输出', logs.some(l => l.indexOf('Baidu 熔断解除') >= 0),
    (logs.filter(l => l.indexOf('熔断解除') >= 0)[0]) || '(无)');

  console.log('');
  console.log('==== 结果：PASS ' + pass + ' / FAIL ' + fail + ' ====');
  console.log('---- 关键日志摘录 ----');
  logs.filter(l => l.indexOf('[TRANSLATE]') >= 0).slice(0, 20).forEach(l => console.log('  ' + l));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('验证脚本异常:', e); process.exit(1); });
