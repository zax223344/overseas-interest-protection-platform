/* sources-collector.js — 94 源工程包采集器（2026-08-28）
 * ================================================================
 * 用户提供 94 源目录（sources-registry.js），实测 feeds 活源 11 个。
 * 采集架构（不建独立 Python 系统，全并入既有 Node/PG 链路）：
 *   ① 活源直采：11 个真实 RSS（netx + 竞速）→ 走既有闸门入库
 *   ② 死源复活：GNews site: 检索替代（Reuters/AP/SCMP 等 RSS 死了，
 *      但 site:reuters.com 检索通道活着——media_feeds.js 已验证模式）
 *   ③ stance 立场标签随条目入库 data_json.stance，供证据链使用
 * 铁律：零模拟；只采真实抓取内容；过 chinaOverseasGate。
 * ================================================================ */
'use strict';
const netx = require('./netx');
const scrapers = require('./scrapers');
const { SOURCES, rssSources, get } = require('./sources-registry');

/* 实测活源（2026-08-28 两轮探测 + 重试确认） */
const LIVE_RSS_IDS = [
  'cn_chinanews', 'pk_app', 'ru_tass', 'ng_premiumtimes', 'ng_vanguard',
  'br_folha', 'br_brasil247', 'pe_andina', 'bbc_world', 'th_bangkokpost', 'qa_aljazeera'
];

/* 死源 → GNews site: 复活清单（取工程包高价值死源，每轮轮换查 2 个站） */
const SITE_REVIVE = [
  { id: 'reuters',        site: 'reuters.com',        q: 'china OR Chinese' },
  { id: 'apnews',         site: 'apnews.com',         q: 'china OR Chinese' },
  { id: 'scmp',           site: 'scmp.com',           q: 'china' },
  { id: 'pk_dawn',        site: 'dawn.com',           q: 'CPEC OR China OR Gwadar' },
  { id: 'pk_tribune',     site: 'tribune.com.pk',     q: 'CPEC OR China' },
  { id: 'id_antara',      site: 'antaranews.com',     q: 'china OR investment' },
  { id: 'kz_kazinform',   site: 'inform.kz',          q: 'china OR investment' },
  { id: 'sa_arabnews',    site: 'arabnews.com',       q: 'china' },
  { id: 'aljazeera_alt',  site: 'aljazeera.com',      q: 'china belt road' },
  { id: 'un_news_alt',    site: 'news.un.org',        q: 'china' },
  { id: 'irrawaddy',      site: 'irrawaddy.com',      q: 'china OR pipeline' },
  { id: 'premium_alt',    site: 'premiumtimesng.com', q: 'china OR kidnapped' }
];

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' };

async function _fetchText(url, ms) {
  return Promise.race([
    netx.smartFetch(url, { timeout: ms || 12000, headers: UA })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), (ms || 12000) + 2000))
  ]);
}

/* ① 活源直采 */
async function collectLiveRss(maxPerFeed) {
  const out = [];
  const live = rssSources().filter(s => LIVE_RSS_IDS.indexOf(s.id) >= 0);
  for (const s of live) {
    const text = await _fetchText(s.feeds[0], 12000);
    if (!text) continue;
    const items = (scrapers.parseRss(text) || []).slice(0, maxPerFeed || 10);
    items.forEach(it => out.push({
      title: it.title || '', content: it.description || '', url: it.link || s.url,
      publish_time: it.pubDate || '', source: s.name, country: s.country,
      stance: s.stance, risk_topics: s.risk_topics || [],
      _sourceType: 'sources_pack', _sourceId: s.id, region: s.region
    }));
  }
  return out;
}

/* ② 死源 GNews site: 复活（每轮轮换 2 个站，串行防限流） */
async function collectSiteRevive(cyc, maxPerQuery) {
  const out = [];
  const picks = [SITE_REVIVE[cyc % SITE_REVIVE.length], SITE_REVIVE[(cyc + 5) % SITE_REVIVE.length]];
  for (const p of picks) {
    const meta = get(p.id) || {};
    const q = 'site:' + p.site + ' ' + p.q;
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:3d') + '&hl=en-US&gl=US&ceid=US:en';
    let text = await _fetchText(u, 12000);
    if (!text) { await new Promise(r => setTimeout(r, 2000)); text = await _fetchText(u, 12000); }
    if (!text) continue;
    const items = (scrapers.parseRss(text) || []).slice(0, maxPerQuery || 10);
    items.forEach(it => out.push({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: meta.name || p.site,
      country: meta.country || '', stance: meta.stance || 'I',
      risk_topics: meta.risk_topics || [],
      _sourceType: 'sources_pack', _sourceId: p.id, region: meta.region || ''
    }));
  }
  return out;
}

/* 统一入口：一轮 = 活源直采 + 2 个 site: 复活 */
async function runSourcesCollector(opts) {
  opts = opts || {};
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const live = await collectLiveRss(opts.maxPerFeed || 10);
  const revived = await collectSiteRevive(cyc, opts.maxPerQuery || 10);
  const all = live.concat(revived);
  /* URL 去重 */
  const seen = new Set();
  const uniq = all.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length, liveCount: live.length, revivedCount: revived.length };
}

module.exports = { runSourcesCollector, LIVE_RSS_IDS, SITE_REVIVE };
