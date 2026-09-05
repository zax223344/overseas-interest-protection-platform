/* ============================================================
 * 重点项目与 TIER1 弱国专项哨兵（2026-08-29 Task #465 采集质量审计）
 * 审计实测：近 7 天 BRI/重点项目命中仅 2 条(0.1%)；TIER1 五国占比 12.4%
 * （沙特/印尼/哈萨克仅十余条）；刚果(金)/吉布提/秘鲁/老挝/阿尔及利亚/
 * 阿联酋/希腊/巴拿马 8 个 TIER2 重点国零覆盖。
 * 本哨兵专用查询矩阵补强：20 个中资海外项目关键词 + TIER1 弱国事件，
 * 每 30 分钟一轮，通道复用已验证模式（GDELT 简单查询 30s 竞速 +
 * GNews 原子查询串行+重试×2；查询窗口 1 天对齐 24h 时效铁律），项目→国别权威映射直接补零覆盖国。
 * ============================================================ */
'use strict';
const netx = require('./netx');
const scrapers = require('./scrapers');
const crawler = require('./crawler');

/* GDELT 单查询 30s 硬竞速 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);

/* GNews RSS：串行+重试×2（并发即限流，铁律） */
async function _gnewsRss(q, max) {
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:1d') + '&hl=en-US&gl=US&ceid=US:en',
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  try {
    let text = await _once();
    for (let r = 0; !text && r < 2; r++) { await new Promise(s => setTimeout(s, 2000)); text = await _once(); }
    if (!text) return [];
    const items = (scrapers.parseRss(text) || []).slice(0, max || 10);
    return items.map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Google News', country: '', _sourceType: 'project_watch'
    }));
  } catch (e) { return []; }
}

/* ===== 项目×事件查询矩阵 =====
 * GNews 原子查询（英文铁律）：20 个重点项目 + TIER1 弱国，每轮 5 条串行轮换；
 * GDELT 简单 OR 查询（复杂查询会挂起——检索通道铁律）：每轮 2 条轮换。 */
const PROJ_GNEWS_QUERIES = [
  'Gwadar port', 'CPEC project', 'Hambantota port', 'Piraeus port',
  'Kyaukpyu pipeline', 'China-Laos railway', 'Jakarta-Bandung railway',
  'Mombasa-Nairobi railway', 'Chancay port', 'Simandou mine',
  'Kamoa-Kakula copper', 'Yamal LNG', 'China-Europe freight train',
  'Belt and Road project', 'Saudi Arabia attack', 'Indonesia unrest',
  'Kazakhstan explosion', 'Riyadh drone', 'Jakarta protest', 'Kazakhstani tenge'
];
const PROJ_GDELT_QUERIES = [
  '(Gwadar OR CPEC OR Hambantota OR Piraeus OR Chancay OR Simandou OR Kamoa OR Kyaukpyu)',
  '("China-Laos railway" OR "Jakarta-Bandung" OR "Mombasa-Nairobi" OR "Yamal LNG" OR "China-Europe freight")',
  '(Saudi Arabia OR Indonesia OR Kazakhstan) (attack OR explosion OR kidnapping OR protest OR strike)'
];

/* 项目/国别信号二次校验（防搜索漂移：标题必须命中真实项目或 TIER1 国名） */
const PROJ_VALID_RE = /Gwadar|瓜达尔|CPEC|中巴经济走廊|Hambantota|汉班托塔|Piraeus|比雷埃夫斯|Kyaukpyu|皎漂|Chancay|钱凯|Simandou|西芒杜|Kamoa|卡莫阿|Yamal|亚马尔|China-Laos|中老铁路|Jakarta-Bandung|雅万高铁|Whoosh|Mombasa-Nairobi|蒙内铁路|SGR|China-Europe freight|中欧班列|Belt and Road|一带一路|BRI|Saudi|沙特|Riyadh|利雅得|Jeddah|吉达|Indonesia|印尼|印度尼西亚|Jakarta|雅加达|Kazakhstan|哈萨克|Almaty|阿拉木图|Astana|阿斯塔纳/i;
const PROJ_NOISE_RE = /lineup|Premier League|cricket|box office|电影|票房|联赛|旅游攻略|travel guide|visa free|weather forecast|食谱|recipe/i;

/* 项目→国别权威映射（命中即回填 country，直接补零覆盖重点国） */
const PROJ_COUNTRY_MAP = [
  [/(Gwadar|CPEC|瓜达尔|中巴经济走廊|Balochistan|俾路支)/i, '巴基斯坦'],
  [/Hambantota|汉班托塔/i, '斯里兰卡'],
  [/Piraeus|比雷埃夫斯/i, '希腊'],
  [/Kyaukpyu|皎漂/i, '缅甸'],
  [/Chancay|钱凯/i, '秘鲁'],
  [/Simandou|西芒杜/i, '几内亚'],
  [/Kamoa|卡莫阿/i, '刚果（金）'],
  [/Yamal|亚马尔/i, '俄罗斯'],
  [/China-Laos|中老铁路/i, '老挝'],
  [/(Jakarta-Bandung|雅万高铁|Whoosh|Indonesia|印尼|印度尼西亚|Jakarta|雅加达)/i, '印度尼西亚'],
  [/(Mombasa-Nairobi|蒙内铁路|SGR Kenya)/i, '肯尼亚'],
  [/(China-Europe freight|中欧班列)/i, '哈萨克斯坦'],
  [/(Saudi|沙特|Riyadh|利雅得|Jeddah|吉达)/i, '沙特阿拉伯'],
  [/(Kazakhstan|哈萨克|Almaty|阿拉木图|Astana|阿斯塔纳)/i, '哈萨克斯坦']
];

function _mapCountry(title) {
  for (const [re, cn] of PROJ_COUNTRY_MAP) if (re.test(title)) return cn;
  return '';
}

async function runProjectWatch(opts) {
  opts = opts || {};
  const out = [];
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  /* ① GDELT：每轮 2 条轮换 */
  const gq = [0, 2].map(i => PROJ_GDELT_QUERIES[(cyc + i) % PROJ_GDELT_QUERIES.length]);
  for (const q of gq) {
    try {
      const arts = await _gdelt(q, { timespan: '1d', maxrecords: opts.maxPerQuery || 12 });
      (arts || []).forEach(a => {
        /* GDELT seendate(20260829T120000Z) → 标准 ISO（与类别均衡器同源修复：
           不转换会被 stale-single-source 闸误判为无日期旧闻，CPEC 瓜达尔会议被误杀实测） */
        let pt = a.publish_time || a.publishedAt || '';
        if (!pt && a.seendate) {
          const iso = String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
          if (iso !== String(a.seendate)) pt = iso;
        }
        out.push({
          title: a.title || '', content: '', url: a.url || a.link || '',
          publish_time: pt,
          source: a.source || a.domain || 'GDELT', country: a.country || '',
          _sourceType: 'project_watch', _viaGdelt: true
        });
      });
    } catch (e) {}
  }
  /* ② GNews：每轮 5 条原子查询串行轮换 */
  const nq = [0, 4, 8, 12, 16].map(i => PROJ_GNEWS_QUERIES[(cyc + i) % PROJ_GNEWS_QUERIES.length]);
  for (const q of nq) {
    try {
      const arts = await _gnewsRss(q, opts.maxPerQuery || 10);
      arts.forEach(a => out.push(a));
    } catch (e) {}
  }
  /* 过滤：项目/国别信号校验 + 噪声拦截 + 去重 + 国别映射 */
  const seen = new Set();
  const filtered = out.map(it => {
    const c = _mapCountry(String(it.title || ''));
    if (c) it.country = c;
    return it;
  }).filter(it => {
    const t = String(it.title || '');
    if (!t.trim() || t.length < 10) return false;
    if (PROJ_NOISE_RE.test(t)) return false;
    if (!PROJ_VALID_RE.test(t)) return false;
    const k = String(it.url || t).toLowerCase().replace(/[?#].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { items: filtered, count: filtered.length };
}

module.exports = { runProjectWatch, PROJ_GNEWS_QUERIES, PROJ_GDELT_QUERIES };
