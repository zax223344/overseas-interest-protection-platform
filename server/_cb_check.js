/* _cb_check.js —— 国别回填（_backfillCountry）离线验证（2026-09-01 country-backfill-dev）
 * 用法：node _cb_check.js
 * ① 动态抽取 server.js 中真实的 _backfillCountry 及其依赖（_SIG_COUNTRIES / GAP_COUNTRY_EN /
 *    _BF_* 常量 / _bfIndex），不复制代码——测的就是线上将执行的那份函数。
 * ② 跑规定用例（漏斗拒样本 / 不覆盖规则 / 边界防误伤），输出 PASS/FAIL。
 * ③ 只读查询 intel_sidepool 近 3 天 reason 含 no-country 的真实拒收条目，统计四层命中率。
 * 只读，不改库不重启服务。 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'server.js');
const src = fs.readFileSync(SRC, 'utf8');

/* ---- ① 动态抽取真实函数与依赖 ---- */
function must(cond, msg) { if (!cond) { console.error('[EXTRACT-FAIL] ' + msg); process.exit(1); } }
const sigM = src.match(/const _SIG_COUNTRIES = \[[^\r\n]*\];/);
must(sigM, '未找到 _SIG_COUNTRIES');
const gapStart = src.indexOf('const GAP_COUNTRY_EN = {');
must(gapStart >= 0, '未找到 GAP_COUNTRY_EN');
const gapEnd = src.indexOf('};', gapStart);
must(gapEnd > gapStart, 'GAP_COUNTRY_EN 块截取失败');
const gapCode = src.slice(gapStart, gapEnd + 2);
const bfStart = src.indexOf('/* ===== 国别回填');
must(bfStart >= 0, '未找到国别回填块');
const bfEnd = src.indexOf('/* 通用 linked 入库通道', bfStart);
must(bfEnd > bfStart, '国别回填块结束标记未找到');
const bfCode = src.slice(bfStart, bfEnd);
must(/function _backfillCountry/.test(bfCode), '回填块内无 _backfillCountry');
must(/function _bfIndex/.test(bfCode), '回填块内无 _bfIndex');

/* const/let 行首声明降为 var：sloppy 直 eval 中 var 才外泄到本模块作用域 */
const code = (sigM[0] + '\n' + gapCode + '\n' + bfCode)
  .replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
/* eslint-disable-next-line no-eval */
eval(code);
must(typeof _backfillCountry === 'function', '_backfillCountry 未成功注入');
must(typeof _SIG_COUNTRIES !== 'undefined' && _SIG_COUNTRIES.length > 50, '_SIG_COUNTRIES 未注入');
must(typeof GAP_COUNTRY_EN !== 'undefined' && Object.keys(GAP_COUNTRY_EN).length > 20, 'GAP_COUNTRY_EN 未注入');
console.log('[EXTRACT] OK —— 已动态抽取真实 _backfillCountry（国名 ' + _SIG_COUNTRIES.length + ' / GAP英文 ' + Object.keys(GAP_COUNTRY_EN).length + ' / 城市 ' + _BF_CITY_COUNTRY.length + ' 组 / ccTLD ' + Object.keys(_BF_CCTLD).length + ' 个）');

/* ---- ② 规定用例 ---- */
let pass = 0, fail = 0;
function T(name, it, expectCountry, expectRet) {
  const ret = _backfillCountry(it);
  const got = it.country || '';
  const ok = (expectRet === undefined ? true : ret === expectRet)
    && (expectCountry === undefined ? true : got === expectCountry);
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' → country=' + JSON.stringify(got) + ' ret=' + ret + (ok ? '' : ' (期望 country=' + JSON.stringify(expectCountry) + ' ret=' + expectRet + ')'));
}
console.log('\n===== 规定用例（漏斗拒样本 + 不覆盖 + 边界）=====');
T('拒样本1 塔拉克河（菲律宾城市锚）', { title: '桥梁倒塌后，车辆坠入塔拉克河，4人仍然失踪' }, '菲律宾', true);
T('拒样本2 MP PWD（印度中央邦公共工程部）', { title: 'Will be rebuilt after water level stabilises: MP PWD Chief Engineer inspects collapsed Ramghat-Hanuman Dhara bridge' }, '印度', true);
T('拒样本3 肯尼亚（中文国名，country 空）', { title: '肯尼亚航空罢工在主要机场造成数千人死亡' }, '肯尼亚', true);
T('拒样本4 无国别证据（该拒就拒）', { title: '黄金和银价格今日呈现下跌趋势' }, '', false);
T('不覆盖 已有国别（country=沙特 保持）', { title: '巴基斯坦爆炸', country: '沙特' }, '沙特', false);
/* 边界防误伤 */
T('L2 英文国名大小写不敏感', { title: 'india floods kill 12 after monsoon' }, '印度', true);
T('L2 词边界 Indian Ocean 不误中 India', { title: 'Indian Ocean trade routes disrupted' }, '', false);
T('L2 词边界 Niger 不误中 Nigeria', { title: 'Niger junta extends transition period' }, '尼日尔', true);
T('L1 长名优先 南苏丹不被苏丹抢注', { title: '南苏丹油田地区爆发冲突' }, '南苏丹', true);
T('L3 曼谷→泰国', { title: '曼谷市中心发生爆炸袭击' }, '泰国', true);
T('L3 河内（title_zh 兜底）', { title: 'Bridge collapse', title_zh: '河内大桥坍塌致多人受伤' }, '越南', true);
T('L4 信源域 .ph→菲律宾', { title: 'Floods destroy coastal bridges', url: 'https://www.pna.gov.ph/articles/1209156' }, '菲律宾', true);
T('L4 信源域 .co.ke→肯尼亚', { title: 'Bus crash on highway leaves 9 dead', url: 'https://www.standardmedia.co.ke/article/2001485' }, '肯尼亚', true);
T('L4 通用域 .com 不误标', { title: 'Global markets tumble amid uncertainty', url: 'https://www.reuters.com/article/global-markets' }, '', false);
T('L1 别名 印尼归一为印度尼西亚', { title: '印尼苏拉威西发生山体滑坡' }, '印度尼西亚', true);
T('标记位 _countryBackfilled', { title: '雅加达多地爆发抗议' }, '印度尼西亚', true);
const _mk = { title: '雅加达多地爆发抗议' }; _backfillCountry(_mk);
console.log((_mk._countryBackfilled === true ? 'PASS' : 'FAIL') + ' | _countryBackfilled 标记写入（审计可观测）');
if (_mk._countryBackfilled === true) pass++; else fail++;
console.log('----- 规定用例合计: PASS ' + pass + ' / FAIL ' + fail + ' -----');

/* ---- ③ 真实拒收样本四层命中率（intel_sidepool 只读查询）---- */
async function realSamples() {
  console.log('\n===== 真实 no-country 拒收样本回填测试（intel_sidepool 近 3 天，只读）=====');
  let pool;
  try { pool = require('./db'); } catch (e) { console.log('[DB] db.js 加载失败，跳过真实样本: ' + e.message); return; }
  let rows = [];
  try {
    const r = await pool.query("SELECT title, title_zh, url FROM intel_sidepool WHERE reason LIKE '%no-country%' AND blocked_at >= NOW() - INTERVAL '3 days' LIMIT 500");
    rows = r.rows || [];
  } catch (e) { console.log('[DB] 查询失败（跳过真实样本，不影响规定用例结论）: ' + e.message); return; }
  if (!rows.length) { console.log('[DB] 近 3 天无 no-country 拒收样本'); return; }

  const idx = _bfIndex();
  const layerOf = (t, url) => {
    if (t.trim()) {
      for (const c of idx.cn) if (t.indexOf(c) >= 0) return 'L1-中文国名';
      for (const e of idx.en) if (e.re.test(t)) return 'L2-英文国名';
      for (const c of idx.city) if (c.ms.some(m => (m.re ? m.re.test(t) : t.indexOf(m.s) >= 0))) return 'L3-城市地标';
    }
    const _h = String(url || '').toLowerCase().match(/^https?:\/\/([^\/?#]+)/);
    if (_h) {
      const host = _h[1].replace(/^www\./, '');
      const _tld = host.match(/\.([a-z]{2})$/);
      if (_tld && _BF_CCTLD[_tld[1]]) return 'L4-信源域';
    }
    return null;
  };
  const stat = { total: rows.length, hit: 0, by: {}, byCountry: {} };
  const shown = [];
  for (const r of rows) {
    const it = { title: r.title || '', title_zh: r.title_zh || '', url: r.url || '', country: '' };
    const t = String(it.title || '') + ' ' + String(it.title_zh || '');
    const ok = _backfillCountry(it);
    if (ok) {
      stat.hit++;
      const L = layerOf(t, it.url) || '?';
      stat.by[L] = (stat.by[L] || 0) + 1;
      stat.byCountry[it.country] = (stat.byCountry[it.country] || 0) + 1;
      if (shown.length < 10) shown.push(L + ' → ' + it.country + ' | ' + String(it.title || '').slice(0, 60));
    }
  }
  console.log('真实拒收样本 ' + stat.total + ' 条 → 可回填 ' + stat.hit + ' 条（命中率 ' + (100 * stat.hit / stat.total).toFixed(1) + '%，其余为真无国别证据，仍按闸门拒收）');
  console.log('分层命中: ' + Object.keys(stat.by).map(k => k + '=' + stat.by[k]).join('，'));
  console.log('回填国别分布: ' + Object.keys(stat.byCountry).sort((a, b) => stat.byCountry[b] - stat.byCountry[a]).map(k => k + '=' + stat.byCountry[k]).join('，'));
  if (shown.length) { console.log('样本:'); shown.forEach(s => console.log('  ' + s)); }
}
realSamples().then(() => {
  console.log('\n===== 总结: PASS ' + pass + ' / FAIL ' + fail + (fail === 0 ? ' —— 全部通过' : ' —— 存在失败用例！') + ' =====');
  process.exit(fail === 0 ? 0 : 2);
});
