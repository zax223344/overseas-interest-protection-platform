/* 翻译辅助层回归：外文判定 / 地震模板 / 国家名本地化（2026-08-05）
 * 与 server.js 中的实现保持同源；改动 server.js 对应函数时同步更新此处。 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ENTITY = require('../entities.js');

let P = 0, F = 0;
const ok = (n, c, x) => c ? (P++, console.log('  ✅ ' + n)) : (F++, console.log('  ❌ ' + n + (x ? ' → ' + x : '')));

/* ---- 1. _looksForeign ---- */
function _looksForeign(s) {
  if (!s) return false;
  const body = String(s).replace(/^\s*[\[【][^\]】]{0,24}[\]】]\s*/, '').replace(/^[^:：]{0,12}[:：]\s*/, '');
  const FOREIGN_RUN = /([a-zA-Z]|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Arabic}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}|\p{Script=Thai}){4,}/u;
  if (!FOREIGN_RUN.test(body)) return false;
  const zh = (body.match(/[一-龥]/g) || []).length;
  const foreign = (body.match(/[a-zA-Z]/g) || []).length
                + (body.match(/\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Arabic}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}|\p{Script=Thai}/gu) || []).length;
  return zh === 0 || zh * 4 < foreign;
}
console.log('\n[1] 外文判定（中文标签前缀不得让外文标题逃过翻译；含非拉丁脚本）');
ok('中文标签+外文正文 → 需译', _looksForeign('[HDX 数据集] Afghanistan - Socio-economic assessment'));
ok('中文来源前缀+外文 → 需译', _looksForeign('参考消息：Hezbollah rejects fresh round of talks'));
ok('纯外文 → 需译', _looksForeign('Rare photos of ex-Myanmar leader'));
ok('俄语（西里尔） → 需译', _looksForeign('Живущие в Казахстане переселенцы из Синьцзяна встревожены новым китайским законом'));
ok('希腊语（Greek） → 需译', _looksForeign('Η Κίνα ενισχύει την ασφάλεια των υπερπόντιων επενδύσεών της'));
ok('阿拉伯语（Arabic） → 需译', _looksForeign('تزايد المخاوف على سلامة العمال الصينيين في الخارج'));
ok('已译中文 → 不重复译', !_looksForeign('俄罗斯莫斯科州遭无人机袭击已致5死10伤'));
ok('中文主体夹英文地名 → 不译', !_looksForeign('中国石油在Nigeria的海外项目遭武装袭击'));
ok('GEOINT 中文条目 → 不译', !_looksForeign('【GEOINT】Sentinel-2 卫星影像显示港口异常集结'));

/* ---- 2. 地震标题模板 ---- */
const _QUAKE_DIR = { N: '以北', S: '以南', E: '以东', W: '以西', NE: '东北方', NW: '西北方', SE: '东南方', SW: '西南方', NNE: '北偏东', ENE: '东偏北', ESE: '东偏南', SSE: '南偏东', SSW: '南偏西', WSW: '西偏南', WNW: '西偏北', NNW: '北偏西' };
function _formatQuakeTitle(s) {
  const m = /^\s*M\s*([\d.]+)\s*[-–—]\s*(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+?)\s*[,，]\s*(.+?)\s*$/i.exec(String(s || ''));
  if (!m) return '';
  const dir = _QUAKE_DIR[m[3].toUpperCase()];
  if (!dir) return '';
  let country = m[5].trim();
  try { const c = ENTITY.normalizeCountry(country); if (c) country = c; } catch (e) {}
  return country + ' ' + m[4].trim() + dir + ' ' + m[2] + ' 公里发生 M' + m[1] + ' 地震';
}
console.log('\n[2] USGS 地震标题模板（机翻搞不定的结构化格式）');
ok('WSW 方位 + 国家译名', _formatQuakeTitle('M 4.6 - 112 km WSW of Puerto Madero, Mexico') === '墨西哥 Puerto Madero西偏南 112 公里发生 M4.6 地震', _formatQuakeTitle('M 4.6 - 112 km WSW of Puerto Madero, Mexico'));
ok('全角逗号污染版仍可解析', _formatQuakeTitle('M 4.6 - 112 km WSW of Puerto Madero，Mexico').indexOf('墨西哥') === 0);
ok('带撇号地名', _formatQuakeTitle("M 4.9 - 204 km SE of Severo-Kuril'sk, Russia").indexOf('俄罗斯') === 0);
ok('普通新闻标题不误伤（走机翻）', _formatQuakeTitle('Hezbollah rejects fresh round of talks') === '');

/* ---- 3. 国家名本地化 ---- */
let _P = null;
function _countryPairs() {
  if (_P) return _P;
  const out = [];
  const A = ENTITY.COUNTRY_ALIAS || {};
  Object.keys(A).forEach(k => { if (/^[A-Za-z][A-Za-z .'\-]*$/.test(k) && k.length >= 4 && A[k]) out.push([k, A[k]]); });
  out.sort((a, b) => b[0].length - a[0].length);
  _P = out; return out;
}
function _localizeCountryNames(s) {
  let t = String(s || '');
  if (!t || !/[A-Za-z]{4,}/.test(t)) return t;
  _countryPairs().forEach(([en, zh]) => {
    const re = new RegExp('(?<![A-Za-z])' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'g');
    t = t.replace(re, zh);
  });
  return t;
}
console.log('\n[3] 英文国家名本地化（结构化标题中文占比高、逃过机翻）');
ok('UNHCR 结构化标题', _localizeCountryNames('[UNHCR 2024] Afghanistan 收容 流离失所人口 3,220,946').indexOf('阿富汗') > 0);
ok('长名优先（South Sudan 不被 Sudan 抢占）', _localizeCountryNames('[UNHCR] South Sudan 数据').indexOf('南苏丹') > 0, _localizeCountryNames('[UNHCR] South Sudan 数据'));
ok('句中英文国名替换', _localizeCountryNames('中资企业在 Nigeria 的项目遭袭击').indexOf('尼日利亚') > 0);
ok('整词匹配：Chinatown 不被拆成"中国town"', _localizeCountryNames('Chinatown 商户遭抢劫').indexOf('Chinatown') === 0, _localizeCountryNames('Chinatown 商户遭抢劫'));
ok('纯中文不变', _localizeCountryNames('俄罗斯莫斯科州遭无人机袭击') === '俄罗斯莫斯科州遭无人机袭击');
ok('台港澳表述合规', _localizeCountryNames('Taiwan 与 Hong Kong 航运数据') === '中国台湾 与 中国香港 航运数据', _localizeCountryNames('Taiwan 与 Hong Kong 航运数据'));

console.log('\n=== 结果: ' + P + ' 通过 / ' + F + ' 失败 ===\n');
process.exit(F ? 1 : 0);
