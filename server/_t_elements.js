/* 验证 _translateListToZhParallel 新增的要素抽取/正文补抓逻辑（2026-08-18）。
 * 直接复用 server.js 中新增的纯函数实现（逐字复制），并加载真实 crawler / entities。 */
const crawler = require('./crawler');
const ENTITY = require('../entities');

/* ===== 复制 server.js 新增函数（与线上一致） ===== */
const _MONTHS_EN = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function _fmtDate(y, mo, d) {
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, mo - 1, d);
  if (isNaN(dt.getTime())) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function _extractDateFromText(s) {
  if (!s) return '';
  let m;
  if ((m = s.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/))) return _fmtDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return _fmtDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/))) return _fmtDate(new Date().getFullYear(), +m[1], +m[2]);
  if ((m = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})/i))) { const mo = _MONTHS_EN[m[1].toLowerCase()]; if (mo) return _fmtDate(+m[3], mo, +m[2]); }
  if ((m = s.match(/(20\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})/i))) { const mo = _MONTHS_EN[m[2].toLowerCase()]; if (mo) return _fmtDate(+m[1], mo, +m[3]); }
  return '';
}
let _CN_COUNTRY_SET = null;
function _cnCountrySet() {
  if (_CN_COUNTRY_SET) return _CN_COUNTRY_SET;
  const s = new Set();
  try { Object.values(ENTITY.COUNTRY_ALIAS || {}).forEach(function (c) { if (/^[一-龥]/.test(String(c))) s.add(c); }); } catch (e) {}
  _CN_COUNTRY_SET = s; return s;
}
function _extractLocationFromText(text) {
  const t = String(text || '');
  if (!t) return '';
  let hit = '';
  const names = Array.from(_cnCountrySet()).sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < names.length; i++) { if (t.indexOf(names[i]) >= 0) { hit = names[i]; break; } }
  return hit;
}
function _extractElements(it) {
  if (!it || typeof it !== 'object') return it;
  if (!it.date) {
    let d = '';
    if (it.publishedAt && /^\d{4}/.test(String(it.publishedAt))) {
      const pd = new Date(String(it.publishedAt));
      if (!isNaN(pd.getTime())) d = _fmtDate(pd.getFullYear(), pd.getMonth() + 1, pd.getDate());
    }
    if (!d) d = _extractDateFromText(String(it.title || '') + ' ' + String(it.content || it.content_zh || ''));
    if (d) it.date = d;
  }
  if (!it.location && !it.city) {
    let loc = '';
    const cn = it.country_cn || (it.country && ENTITY && ENTITY.normalizeCountry ? ENTITY.normalizeCountry(it.country) : '');
    if (cn && /^[一-龥]/.test(cn)) loc = cn;
    if (!loc) loc = _extractLocationFromText(String(it.title || '') + ' ' + String(it.content || it.content_zh || ''));
    if (!loc) {
      const lm = String(it.title || '').match(/([一-龥]{2,6}?)(省|市|州|地区|特区|首都|共和国|联邦|边境|镇|岛|港|湾)/);
      if (lm) loc = lm[1] + lm[2];
    }
    if (loc) { it.location = loc; if (!it.city) it.city = loc; }
  }
  return it;
}
const _MEDIA_ALIAS = {
  'La Repubblica': '共和报', 'Le Monde': '世界报', 'Le Figaro': '费加罗报',
  'Der Spiegel': '明镜周刊', 'Die Zeit': '时代周报', 'The Guardian': '卫报',
  'The Washington Post': '华盛顿邮报', 'The New York Times': '纽约时报',
  'Al Jazeera': '半岛电视台', 'Al-Arabiya': '阿拉伯电视台', 'Al Mayadeen': '迈亚丁电视台',
  'Associated Press': '美联社', 'Reuters': '路透社', 'AFP': '法新社', 'Xinhua': '新华社'
};
let _MEDIA_PAIRS = null;
function _mediaPairs() {
  if (_MEDIA_PAIRS) return _MEDIA_PAIRS;
  const out = [];
  Object.keys(_MEDIA_ALIAS).forEach(function (k) { if (k.length >= 4) out.push([k, _MEDIA_ALIAS[k]]); });
  out.sort(function (a, b) { return b[0].length - a[0].length; });
  _MEDIA_PAIRS = out; return out;
}
function _localizeMedia(s) {
  let t = String(s || '');
  if (!t || !/[A-Za-z]{4,}/.test(t)) return t;
  _mediaPairs().forEach(function (p) {
    const re = new RegExp('(?<![A-Za-z])' + p[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'g');
    t = t.replace(re, p[1]);
  });
  return t;
}

/* ===== 断言 ===== */
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + ' => ' + JSON.stringify(got) + (ok ? '' : '  (期望 ' + JSON.stringify(want) + ')'));
  ok ? pass++ : fail++;
}

console.log('— 日期抽取 —');
eq('中文年月日', _extractDateFromText('黎巴嫩南部2026年8月15日发生空袭'), '2026-08-15');
eq('ISO日期', _extractDateFromText('事件发生于2026-08-12'), '2026-08-12');
eq('月日(当年)', _extractDateFromText('8月17日报道'), _fmtDate(new Date().getFullYear(), 8, 17));
eq('英文Aug', _extractDateFromText('Floods hit on Aug 9, 2026'), '2026-08-09');
eq('无日期', _extractDateFromText('以色列飞机发动空袭'), '');

console.log('— 地点抽取 —');
eq('国名反推(黎巴嫩)', _extractLocationFromText('以色列飞机对黎巴嫩南部的镇发动空袭'), '黎巴嫩');
eq('国名反推(巴基斯坦)', _extractLocationFromText('巴基斯坦卡拉奇发生爆炸'), '巴基斯坦');
eq('中国不误吞中非', _extractLocationFromText('中非共和国局势紧张'), '中非');

console.log('— 媒体专名本地化 —');
eq('Reuters', _localizeMedia('Reuters: 中方回应'), '路透社: 中方回应');
eq('Al Jazeera', _localizeMedia('Al Jazeera reported the strike'), '半岛电视台 reported the strike');
eq('La Repubblica', _localizeMedia('La Repubblica: 中欧关系'), '共和报: 中欧关系');

console.log('— 要素抽取整合 —');
let a = { title: '2026年8月15日以色列飞机对黎巴嫩南部的Al-Mandarin和Deir Suryan镇发动了两次空袭', country_cn: '黎巴嫩' };
_extractElements(a);
eq('整合:date', a.date, '2026-08-15');
eq('整合:location回退国名', a.location, '黎巴嫩');
let b = { title: 'Xinhua: 中资企业在巴基斯坦项目开工', country: 'Pakistan' };
_extractElements(b);
eq('整合:location(英译中)', b.location, '巴基斯坦');
let c = { title: '俄方表态', publishedAt: '2026-08-10T13:00:00.000Z' };
_extractElements(c);
eq('整合:date来自publishedAt', c.date, '2026-08-10');
// 不覆盖已有值
let d = { title: 'x', date: '2025-01-01', location: '既有地点' };
_extractElements(d);
eq('不覆盖date', d.date, '2025-01-01');
eq('不覆盖location', d.location, '既有地点');

console.log('— 正文补抓(真实网络, 可能受出网限制) —');
(async () => {
  const url = 'https://apnews.com/article/israel-lebanon-hezbollah-airstrike-12345'; // 占位，实际用真实可访问URL测试
  // 用 AP 真实可访问文章测试抓取+抽取
  const realUrl = 'https://apnews.com/hub/world-news';
  const html = await crawler.fetchPublic(realUrl, 12000);
  console.log('  fetchPublic(' + realUrl + ') => ' + (html ? 'OK ' + html.length + ' 字节' : 'NULL(出网受限, 跳过)'));
  if (html) {
    const body = crawler.extractArticle(html);
    console.log('  extractArticle => ' + (body ? 'OK ' + body.length + ' 字: ' + body.slice(0, 60) + '…' : 'NULL'));
  }
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e.message); process.exit(2); });
