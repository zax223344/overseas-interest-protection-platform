/* channel-watch.js — 海上战略通道哨兵（维度⑤，2026-08-28）
 * ================================================================
 * 依据官方框架：海上战略通道安全是三大支柱之一。全球80%+货物贸易走海运，
 * 中国约95%进出口货运量由海运承担。八大咽喉点（马六甲/霍尔木兹/曼德-红海/
 * 苏伊士/巴拿马/台湾海峡/几内亚湾/亚丁湾）任何风吹草动都直接威胁中国海外利益。
 * 职责：每 30 分钟一轮专项采集——
 *   ① GDELT 按通道关键词检索（通航/封锁/海盗/袭击油轮/航运中断）
 *   ② 海运专业 RSS（Maritime Executive / gCaptain）直采
 *   ③ 出口数据挂通道标签（channel_tags）走既有闸门入库，data_type=infrastructure
 * 铁律：零模拟，全部真实抓取；条目必须命中通道+安全信号双要素。 */
'use strict';
/* GDELT seendate(20260829T120000Z) → ISO 统一转换（2026-08-29 Task #465 排雷：
   原始 seendate 无人解析，被 stale-single-source 闸当无日期旧闻误杀） */
const _sdIso = (a) => {
  if (a.publish_time || a.publishedAt) return a.publish_time || a.publishedAt;
  if (!a.seendate) return a.pubDate || '';
  const iso = String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  return iso !== String(a.seendate) ? iso : (a.pubDate || a.seendate || '');
};
const crawler = require('./crawler');
/* GDELT 单查询 30s 硬竞速：复杂查询偶发挂起，绝不让单次检索阻塞哨兵轮次 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);
const scrapers = require('./scrapers');
const netx = require('./netx');
/* RSS/HTML 直取（2026-08-28）：netx.smartFetch + Response.text() + 竞速兜底。
 * 已实测：Treasury（需代理回退）/gCaptain 通，maritime-executive 会挂死由竞速兜住。 */
const _fetchPage = (u, ms) => Promise.race([
  netx.smartFetch(u, { timeout: ms || 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
    .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
  new Promise(res => setTimeout(() => res(null), (ms || 10000) + 2000))
]);

const CHANNEL_RSS = [
  { name: 'Maritime Executive', url: 'https://www.maritime-executive.com/rss.xml' },
  { name: 'gCaptain', url: 'https://gcaptain.com/feed/' }
];

/* 通道×事件矩阵（每轮轮换 2 条；走 crawler.gdeltSearch 的节流+缓存+熔断） */
const CHANNEL_QUERIES = [
  'Strait of Hormuz tanker attack OR boarding OR seizure',
  'Strait of Malacca piracy OR robbery OR boarding',
  'Red Sea Houthi missile OR drone OR tanker attack',
  'Gulf of Guinea piracy OR kidnapping tanker',
  'Suez Canal blockage OR disruption OR delay',
  'Panama Canal drought restriction OR transit',
  'Taiwan Strait naval tension OR shipping',
  'Gulf of Aden piracy OR attack OR convoy',
  'Chinese vessel attacked OR hijacked OR detained',
  'Chinese oil tanker rerouting OR war risk'
];

/* GNews 原子查询集（GNews 不支持 OR 操作符——2026-08-28 实测含 OR 返回 0 条） */
const CHANNEL_GNEWS_QUERIES = [
  'Strait of Hormuz tanker',
  'Malacca Strait piracy',
  'Red Sea shipping attack',
  'Gulf of Guinea piracy',
  'Suez Canal disruption',
  'Panama Canal restriction',
  'Chinese vessel attacked',
  'Chinese tanker hijacked'
];
/* 通道安全信号（必须与通道词同时命中；2026-08-28 扩充：hit/struck/damage/sank/toll/warning/risk 等） */
const CHANNEL_SEC_RE = /pirac|pirate|hijack|seiz|attack|missile|drone|boarding|robber|blocka|closur|disrupt|delay|grounding|collision|detain|war risk|rerout|escort|convoy|\bhit\b|struck|damage|sank|sunk|fire|explos|threat|warning|tension|military|naval|drill|exercise|restrict|limit|suspend|halt|toll|tariff|accident|incident|safety|risk|绑架|劫持|袭击|海盗|封锁|中断|滞留|扣留|绕行|护航|演习|军演|受限|暂停|事故|险情|警告/i;
const CHANNEL_NAME_RE = /hormuz|malacca|red sea|bab el|suez|panama canal|taiwan strait|gulf of guinea|aden|strait|canal|channel|海峡|运河|红海|海盗|油轮|货轮|商船|航运|tanker|bulker|cargo ship|vessel|container ship|shipping/i;

/* Google News RSS 检索（2026-08-28 实测高可用：英文查询返回当天真实新闻，Hormuz 100条/OFAC 58条；
 * 中文参数返回空——故只用于英文查询。Bing 网页搜索已弃：返回百科/官网首页非新闻。）
 * when:1d 限定当天，与哨兵时效铁律对齐。 */
async function _gnewsRss(q, max) {
  /* 2026-08-28 实测：Google News 对并发请求立即限流（3 并发全挂），必须串行 + 单次重试 */
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:3d') + '&hl=en-US&gl=US&ceid=US:en',
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  try {
    let text = await _once();
    for (let r = 0; !text && r < 2; r++) { await new Promise(s => setTimeout(s, 2000)); text = await _once(); }  /* 间歇限流重试×2 */
    if (!text) return [];
    const items = (scrapers.parseRss(text) || []).slice(0, max || 10);
    return items.map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Google News', country: '',
      _sourceType: 'gnews'
    }));
  } catch (e) { return []; }
}

async function runChannelWatch(opts) {
  opts = opts || {};
  const out = [];
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const qs = [CHANNEL_QUERIES[cyc % CHANNEL_QUERIES.length], CHANNEL_QUERIES[(cyc + 3) % CHANNEL_QUERIES.length]];
  /* ① GDELT 检索（走 crawler 节流通道） */
  for (const q of qs) {
    try {
      const arts = await _gdelt(q, { timespan: '1d', maxrecords: opts.maxPerQuery || 12, lang: 'en' });
      (arts || []).forEach(a => {
        out.push({
          title: a.title || '', content: '', url: a.url || a.link || '',
          publish_time: _sdIso(a),
          source: a.source || a.domain || 'GDELT', country: a.country || '', _sourceType: 'channel_watch', _viaGdelt: true
        });
      });
    } catch (e) { /* GDELT 熔断则本轮跳过 */ }
  }
  /* ② 专业 RSS（走 scrapers.fetchText 既有通道：UA+白名单+竞速；2026-08-28 修复
   * 旧版误用 netx.smartFetch 返回值当 {body} —— 实际返回 fetch Response 对象，取 body 恒 undefined → 8h 零产出根因） */
  const rssTexts = await Promise.all(CHANNEL_RSS.map(s =>
    Promise.race([
      _fetchPage(s.url, 10000),
      new Promise(res => setTimeout(() => res(null), 12000))
    ])
  ));
  rssTexts.forEach((text, i) => {
    if (!text) return;
    try {
      const items = scrapers.parseRss(text) || [];
      items.slice(0, 8).forEach(it => {
        out.push({
          title: it.title || '', content: it.description || '', url: it.link || CHANNEL_RSS[i].url,
          publish_time: it.pubDate || '', source: CHANNEL_RSS[i].name, country: '', _sourceType: 'channel_watch'
        });
      });
    } catch (e) {}
  });
  /* ③ 过滤：通道词 + 安全信号双命中 */
  const filtered = out.filter(it => {
    const t = String(it.title || '') + ' ' + String(it.content || '');
    if (!t.trim()) return false;
    return CHANNEL_NAME_RE.test(t) && CHANNEL_SEC_RE.test(t);
  });
  /* 去重 */
  const seen = new Set();
  const uniq = filtered.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length };
}

module.exports = { runChannelWatch, CHANNEL_QUERIES, CHANNEL_RSS };
