/* ============================================================
 * 核心威胁专项哨兵（2026-08-28 用户指令）
 * 体检实测 24h 四类零产出：涉华人员袭击 0 / 涉华绑架 0 / 政变 0 / 外资审查 0。
 * 既有通道（consular/cn-security/compliance）覆盖了前两类但 GNews 召回波动大，
 * 本哨兵补充专用原子查询矩阵，每 10 分钟一轮，串行防限流。
 * 通道复用已验证模式：GDELT（crawler.gdeltSearch 节流）+ GNews（_gnewsRss 串行+重试）。
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

/* GNews RSS：串行+重试×2（已验证：并发即限流） */
async function _gnewsRss(q, max) {
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:3d') + '&hl=en-US&gl=US&ceid=US:en',
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
      publish_time: it.pubDate || '', source: 'Google News', country: '', _sourceType: 'core_threat_watch'
    }));
  } catch (e) { return []; }
}

/* ===== 弱类专项查询矩阵（体检零产出四类 + 补强恐袭/海盗）=====
 * GDELT 支持复杂查询（每轮 2 条轮换）；GNews 原子查询（每轮 3 条串行轮换）。 */
const CT_GDELT_QUERIES = [
  '(Chinese OR China) (citizens OR workers OR engineers OR nationals) (kidnapped OR abducted OR attacked OR killed OR hostage)',
  'Chinese company OR Chinese nationals (attacked OR kidnapped OR killed) abroad',
  'coup OR military takeover OR junta (Africa OR Asia OR Latin America)',
  'foreign investment screening OR CFIUS (China OR Chinese)',
  'Gulf of Guinea (piracy OR pirates OR kidnapped seafarers)',
  'Strait of Hormuz OR Red Sea (tanker attacked OR shipping threatened)'
];
const CT_GNEWS_QUERIES = [
  'Chinese workers attacked',
  'Chinese nationals kidnapped',
  'Chinese company seized abroad',
  'military coup',
  'foreign investment screening China',
  'Gulf of Guinea piracy',
  'seafarers kidnapped',
  'tanker attacked'
];

/* 核心威胁信号二次校验（防搜索漂移：标题必须命中真实信号词） */
const CT_VALID_RE = /中国|中方|华人|华侨|中资|Chinese|China|coup|政变|军政府|junta|military takeover|piracy|海盗|kidnap|绑架|abduct|hostage|人质|attacked|袭击|killed|身亡|investment screening|外资审查|CFIUS|export control|出口管制|sanction|制裁|entity list|实体清单|tanker|油轮|seized|扣押|militants|叛军|武装/i;
const CT_NOISE_RE = /lineup|Premier League|cricket|box office|电影|票房|联赛/i;

async function runCoreThreatWatch(opts) {
  opts = opts || {};
  const out = [];
  const cyc = Math.floor(Date.now() / (10 * 60 * 1000));
  /* ① GDELT：每轮 2 条轮换 */
  const gq = [0, 3].map(i => CT_GDELT_QUERIES[(cyc + i) % CT_GDELT_QUERIES.length]);
  for (const q of gq) {
    try {
      const arts = await _gdelt(q, { timespan: '1d', maxrecords: opts.maxPerQuery || 12 });
      (arts || []).forEach(a => {
        out.push({
          title: a.title || '', content: '', url: a.url || a.link || '',
          publish_time: a.publish_time || a.publishedAt || a.seendate || '',
          source: a.source || a.domain || 'GDELT', country: a.country || '',
          _sourceType: 'core_threat_watch', _viaGdelt: true
        });
      });
    } catch (e) {}
  }
  /* ② GNews：每轮 3 条原子查询串行 */
  const nq = [0, 3, 6].map(i => CT_GNEWS_QUERIES[(cyc + i) % CT_GNEWS_QUERIES.length]);
  for (const q of nq) {
    try {
      const arts = await _gnewsRss(q, opts.maxPerQuery || 10);
      arts.forEach(a => out.push(a));
    } catch (e) {}
  }
  /* 过滤：信号校验 + 噪声拦截 + 去重 */
  const seen = new Set();
  const filtered = out.filter(it => {
    const t = String(it.title || '');
    if (!t.trim() || t.length < 10) return false;
    if (CT_NOISE_RE.test(t)) return false;
    if (!CT_VALID_RE.test(t)) return false;
    const k = String(it.url || t).toLowerCase().replace(/[?#].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { items: filtered, count: filtered.length };
}

module.exports = { runCoreThreatWatch, CT_GDELT_QUERIES, CT_GNEWS_QUERIES };
