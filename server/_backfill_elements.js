/* 存量情报要素补全流程（计算型，零网络依赖）
 * 动态从 server.js 抽取与线上完全一致的纯函数并 eval：
 *  ① 空 location/date 尽力补全；② 已是国家级的 location 若能在正文命中具体城市则升级为城市；
 *  ③ 标题里残留的英文国名/媒体名/城市名本地化为中文。已有更精确的值绝不降级、抽不到留空，绝不臆造。
 * 用法: node _backfill_elements.js [--dry] */
const path = require('path');
const fs = require('fs');
const ENTITY = require('../entities.js');
const { pool, query } = require('./db');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function sliceFn(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
  const m = re.exec(SRC); if (!m) throw new Error('未找到函数 ' + name);
  let i = m.index + m[0].length - 1, d = 1;
  while (i < SRC.length && d > 0) { const c = SRC[++i]; if (c === '{') d++; else if (c === '}') d--; }
  return SRC.slice(m.index, i + 1);
}
function sliceConst(name) {
  let m = new RegExp('const ' + name + '\\s*=\\s*\\{', 'g').exec(SRC);
  if (m) { let i = SRC.indexOf('};', m.index) + 1; return SRC.slice(m.index, i + 1); }
  m = new RegExp('const ' + name + '\\s*=\\s*\\[', 'g').exec(SRC);
  if (m) { let i = SRC.indexOf('];', m.index) + 1; return SRC.slice(m.index, i + 1); }
  throw new Error('未找到常量 ' + name);
}

const CONSTS = ['_MEDIA_ALIAS', '_CITY_ALIAS'];
const FNS = ['_fmtDate', '_extractDateFromText', '_cnCountrySet', '_extractLocationFromText',
  '_countryPairs', '_localizeCountryNames', '_mediaPairs', '_localizeMedia',
  '_cityPairs', '_cnCitySet', '_extractCityFromText', '_localizeCities', '_extractElements'];
const harness = CONSTS.map(sliceConst).join('\n') + '\n' + FNS.map(sliceFn).join('\n');
/* 跨函数共享的模块级缓存变量，抽到 harness 顶层，避免 eval 模块内作用域隔离导致引用失败 */
const PREFIX = 'var _CTY_EN_PAIRS=null; var _CN_COUNTRY_SET=null; var _MEDIA_PAIRS=null; var _CITY_PAIRS=null; var _CN_CITY_SET=null;\n';
fs.writeFileSync(path.join(__dirname, '_bf_fns.js'),
  'const ENTITY = global.__ENTITY;\n' + PREFIX + harness +
  '\nmodule.exports = { _extractElements, _localizeCountryNames, _localizeMedia, _localizeCities, _extractCityFromText, _cnCountrySet, _cnCitySet };\n');
global.__ENTITY = ENTITY;
const F = require('./_bf_fns.js');

const DRY = process.argv.includes('--dry');
(async () => {
  const since = new Date(Date.now() - 60 * 864e5);
  const { rows } = await query(
    "SELECT id, data_json FROM intel_data WHERE collect_time >= $1 ORDER BY id",
    [since]);
  console.log('扫描行数(近60天): ' + rows.length);

  let upLocFill = 0, upLocCity = 0, upDate = 0, upTitle = 0, touched = 0, errs = 0;
  for (const r of rows) {
    const j = r.data_json;
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
    const it = Object.assign({}, j);
    it.title = j.title || ''; it.title_zh = j.title_zh || '';
    it.content = j.content || ''; it.content_zh = j.content_zh || '';
    it.country = j.country || ''; it.country_cn = j.country_cn || '';
    it.city = j.city || ''; it.location = j.location || ''; it.date = j.date || '';
    it.publishedAt = j.publishedAt || j.publish_time || ''; it.url = j.url || '';
    try {
      let cityHit = F._extractCityFromText(it.title);
      if (!cityHit) cityHit = F._extractCityFromText(it.content || it.content_zh || '');
      const existLoc = j.location || '';
      const existIsCountry = existLoc && F._cnCountrySet().has(existLoc);
      const existIsCity = existLoc && F._cnCitySet().has(existLoc);

      /* 标题本地化：国名 → 媒体 → 城市（长词优先） */
      let tt = it.title, titleChanged = false;
      const a = F._localizeCountryNames(tt); if (a !== tt) { tt = a; titleChanged = true; }
      const b = F._localizeMedia(tt); if (b !== tt) { tt = b; titleChanged = true; }
      const c = F._localizeCities(tt); if (c !== tt) { tt = c; titleChanged = true; }
      if (titleChanged) { it.title_en = it.title_en || it.title; it.title = tt; it.title_zh = tt; }

      /* 日期/空location 由抽取函数补（location 已设值时它不动，只补 date） */
      F._extractElements(it);

      const out = Object.assign({}, j);
      let changed = false;
      /* 地点：空→补；国家级→升级为城市；已是城市→不动 */
      if (cityHit && (!existLoc || existIsCountry)) {
        out.location = cityHit; if (!j.city) out.city = cityHit;
        if (existLoc) upLocCity++; else upLocFill++; changed = true;
      } else if (!existLoc && it.location) {
        out.location = it.location; if (it.city && !j.city) out.city = it.city;
        upLocFill++; changed = true;
      }
      if (it.date && (!j.date || j.date === '')) { out.date = it.date; upDate++; changed = true; }
      if (titleChanged && tt && tt !== j.title) { out.title = tt; out.title_zh = tt; upTitle++; changed = true; }

      if (changed) {
        touched++;
        if (!DRY) await query('UPDATE intel_data SET data_json=$1::jsonb WHERE id=$2', [JSON.stringify(out), r.id]);
      }
    } catch (e) { if (errs < 5) console.error('  row#' + r.id + ' err:', e.message); errs++; }
  }
  console.log((DRY ? '[DRY] ' : '') + '补全统计: 新填地点=' + upLocFill + ' 升级城市=' + upLocCity +
    ' 补日期=' + upDate + ' 标题本地化=' + upTitle + ' 实际改动行=' + touched + ' 错误=' + errs);
  fs.unlinkSync(path.join(__dirname, '_bf_fns.js'));
  await pool.end();
  console.log('BACKFILL_DONE');
})().catch(e => { console.error('BACKFILL_ERR', e.message); try { fs.unlinkSync(path.join(__dirname, '_bf_fns.js')); } catch {} process.exit(1); });
