/* 抽样预览：国家级 location 升级为城市的效果（只读） */
const path = require('path'), fs = require('fs');
const ENTITY = require('../entities.js'); global.__ENTITY = ENTITY;
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function sliceFn(n) { const re = new RegExp('function ' + n + '\\s*\\([^)]*\\)\\s*\\{', 'g'); const m = re.exec(SRC); let i = m.index + m[0].length - 1, d = 1; while (i < SRC.length && d > 0) { const c = SRC[++i]; if (c === '{') d++; else if (c === '}') d--; } return SRC.slice(m.index, i + 1); }
function sliceConst(n) { const m = new RegExp('const ' + n + '\\s*=\\s*\\{', 'g').exec(SRC); const i = SRC.indexOf('};', m.index) + 1; return SRC.slice(m.index, i + 1); }
const h = sliceConst('_CITY_ALIAS') + '\n' + ['_cnCountrySet', '_extractLocationFromText', '_countryPairs', '_localizeCountryNames', '_cityPairs', '_cnCitySet', '_extractCityFromText'].map(sliceFn).join('\n');
fs.writeFileSync(path.join(__dirname, '_bf_fns.js'), 'const ENTITY=global.__ENTITY;\nvar _CTY_EN_PAIRS=null;var _CN_COUNTRY_SET=null;var _CITY_PAIRS=null;var _CN_CITY_SET=null;\n' + h + '\nmodule.exports={_extractCityFromText,_cnCountrySet,_cnCitySet};');
const F = require('./_bf_fns.js');
const { pool, query } = require('./db');
(async () => {
  const since = new Date(Date.now() - 60 * 864e5);
  const { rows } = await query("SELECT id, data_json FROM intel_data WHERE collect_time >= $1 ORDER BY id DESC LIMIT 4000", [since]);
  let n = 0;
  for (const r of rows) {
    const j = r.data_json; if (!j || typeof j !== 'object') continue;
    const loc = j.location || '';
    if (loc && F._cnCountrySet().has(loc)) {
      let city = F._extractCityFromText(j.title || '');
      if (!city) city = F._extractCityFromText(j.content || j.content_zh || '');
      if (city && n < 15) { console.log('#' + r.id + ' [' + loc + ' -> ' + city + '] ' + String(j.title || '').slice(0, 48)); n++; }
    }
  }
  console.log('（国家级→城市 升级示例 ' + n + ' 条）');
  await pool.end(); fs.unlinkSync(path.join(__dirname, '_bf_fns.js'));
})().catch(e => { console.error(e.message); process.exit(1); });
