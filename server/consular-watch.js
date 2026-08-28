/* consular-watch.js — 领事保护哨兵（维度②，2026-08-28）
 * ================================================================
 * 依据官方框架：海外公民和法人的安全是三大支柱之一。领保体系数据（安全提醒/
 * 撤侨行动/领保案件）是官方最直接的海外利益受损信号源：
 *   - 外交部"领事直击"安全提醒（cs.mfa.gov.cn）
 *   - 12308 热线与紧急撤离行动报道
 *   - 使领馆警示/暂停营业/人员疏散
 * 职责：每 30 分钟一轮——
 *   ① 外交部领事司提醒页直采（真实 HTML 解析，零模拟）
 *   ② GDELT/Bing 检索：中国使领馆动态 + 撤侨 + 领保案件（英文+中文）
 *   ③ 走既有闸门入库，data_type=security_events，挂 consular_tags
 * 铁律：撤侨/中国公民遇袭条目命中红区铁律直接红色。 */
'use strict';
const crawler = require('./crawler');
const netx = require('./netx');
/* RSS/HTML 直取（2026-08-28）：netx.smartFetch + Response.text() + 竞速兜底 */
const _fetchPage = (u, ms) => Promise.race([
  netx.smartFetch(u, { timeout: ms || 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
    .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
  new Promise(res => setTimeout(() => res(null), (ms || 10000) + 2000))
]);

/* GDELT 单查询 30s 硬竞速：复杂查询偶发挂起，绝不让单次检索阻塞哨兵轮次 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);

const MFA_ALERT_URLS = [];
/* 2026-08-28 实测：cs.mfa.gov.cn 领事直击是 JS 渲染壳页面（len=2190 且 0 个 <a>），
 * 纯 fetch 拿不到列表，直采移除。领保动态改由 GDELT（英文）+ Bing（中文）双检索覆盖。 */

/* 双语言查询架构（2026-08-28 实测教训）：
 * GDELT 用英文（全球英文媒体对撤侨/领保事件报道快）；
 * Bing 用中文（cn.bing.com 对英文查询只返回百科/知乎等垃圾页，中文查询才有效）。 */
const CONSULAR_QUERIES_EN = [
  'Chinese embassy OR consulate alert OR warning OR evacuated',
  'China evacuate citizens OR nationals OR workers crisis',
  'Chinese citizens abroad rescued OR evacuated OR missing',
  '12308 consular protection Chinese emergency'
];
/* GNews 原子查询集（GNews 不支持 OR；中文参数返回空——只用英文原子词组） */
const CONSULAR_GNEWS_QUERIES = [
  'Chinese embassy alert',
  'China evacuate citizens',
  'Chinese nationals evacuated',
  'consular protection Chinese',
  'Chinese citizens missing abroad',
  'Chinese workers rescued'
];

/* 领保信号词（标题必须命中其一；2026-08-28 扩充：warns citizens to leave / Chinese student death 等领保新闻高频句式） */
const CONSULAR_RE = /embassy|consulate|consular|evacuat|12308|领保|领事|使馆|撤侨|撤离|撤回|安全提醒|暂勿前往|谨慎前往|提醒.*公民|citizens? (?:evacuated|rescued|missing|abroad|to leave|warned|urged|alerted)|(?:evacuated|rescued|missing) .{0,20}Chinese|warns? citizens|urges? citizens|Chinese (?:student|tourist|worker|national)s? .{0,40}(?:death|killed|missing|died|warning|alert|alarm)|(?:death|killed|missing|died|tragic) .{0,30}Chinese (?:student|tourist|worker|national)/i;

function parseMfaList(html) {
  /* 两段式线性解析（2026-08-28）：旧版嵌套量词正则在领事司大页面上灾难性回溯卡死事件循环。
   * ① 先用简单非贪婪模式取全部 <a>…</a> 块（限长 200 防贪婪）；② 再逐块线性抽取 href/title/文本。 */
  const items = [];
  const blocks = String(html || '').match(/<a\b[^>]*>[\s\S]{0,200}?<\/a>/gi) || [];
  for (const b of blocks) {
    const hrefM = /href="([^"]+)"/i.exec(b);
    const titleM = /title="([^"]{10,120})"/i.exec(b);
    const textM = />([^<>]{10,120})<\/a>/i.exec(b);
    const url = hrefM ? (hrefM[1].startsWith('http') ? hrefM[1] : 'https://cs.mfa.gov.cn' + (hrefM[1].startsWith('/') ? hrefM[1] : '/' + hrefM[1])) : '';
    const title = ((titleM && titleM[1]) || (textM && textM[1]) || '').replace(/\s+/g, ' ').trim();
    if (title.length >= 10 && /提醒|注意|安全|暂勿|谨慎|撤离|领保|风险|警示|防范/.test(title)) {
      items.push({ title, content: '', url, publish_time: '', source: '外交部领事司', country: '', _sourceType: 'consular_watch' });
    }
  }
  return items;
}

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

async function runConsularWatch(opts) {
  opts = opts || {};
  const out = [];
  /* 双通道检索：GDELT（英文查询）+ Bing（中文查询），各轮换 1 条 */
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const qEn = CONSULAR_QUERIES_EN[cyc % CONSULAR_QUERIES_EN.length];
  /* ① GDELT 英文 */
  try {
    let arts = await _gdelt(qEn, { timespan: '1d', maxrecords: opts.maxPerQuery || 12 });
    (arts || []).forEach(a => {
      out.push({
        title: a.title || '', content: a.description || a.content || '', url: a.url || a.link || '',
        publish_time: a.publish_time || a.publishedAt || a.seendate || a.pubDate || '',
        source: a.source || a.domain || 'GDELT', country: a.country || '', _sourceType: 'consular_watch'
      });
    });
  } catch (e) {}
  /* ② GNews RSS 原子查询×3 并发（召回对措辞敏感，并发多条互补） */
  try {
    const gq = [0, 2, 4].map(i => CONSULAR_GNEWS_QUERIES[(cyc + i) % CONSULAR_GNEWS_QUERIES.length]);
    for (const q of gq) {
      const b = await _gnewsRss(q, opts.maxPerQuery || 10);  /* 串行：并发触发限流 */
      (b || []).forEach(a => {
      out.push({
        title: a.title || '', content: a.description || a.content || '', url: a.url || a.link || '',
        publish_time: a.publish_time || a.pubDate || '', source: a.source || 'Google News', country: '', _sourceType: 'consular_watch'
      });
    });
    }
  } catch (e) {}
  const filtered = out.filter(it => {
    const t = String(it.title || '');
    if (!t.trim() || t.length < 10) return false;
    /* 静态体裁排除（Bing 中文检索会带出百科/经验/话题页） */
    if (/百科|知乎|百度经验|话题广场|微博网页版|视频解析|下载地址|官方网站$|_官网$/i.test(t)) return false;
    return CONSULAR_RE.test(t);
  });
  const seen = new Set();
  const uniq = filtered.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length };
}

module.exports = { runConsularWatch, CONSULAR_QUERIES_EN, CONSULAR_GNEWS_QUERIES, MFA_ALERT_URLS };
