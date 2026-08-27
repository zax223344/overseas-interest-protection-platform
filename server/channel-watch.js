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
const crawler = require('./crawler');
/* GDELT 单查询 30s 硬竞速：复杂查询偶发挂起，绝不让单次检索阻塞哨兵轮次 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);
const netx = require('./netx');
const scrapers = require('./scrapers');

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

/* 通道安全信号（必须与通道词同时命中） */
const CHANNEL_SEC_RE = /pirac|pirate|hijack|seiz|attack|missile|drone|boarding|robber|blocka|closur|disrupt|delay|grounding|collision|detain|war risk|rerout|escort|convoy|绑架|劫持|袭击|海盗|封锁|中断|滞留|扣留|绕行|护航/i;
const CHANNEL_NAME_RE = /hormuz|malacca|red sea|bab el|suez|panama canal|taiwan strait|gulf of guinea|aden|strait|canal|channel|海峡|运河|红海|海盗|油轮|货轮|商船|航运/i;

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
          publish_time: a.publish_time || a.publishedAt || a.seendate || '',
          source: a.source || a.domain || 'GDELT', country: a.country || '', _sourceType: 'channel_watch', _viaGdelt: true
        });
      });
    } catch (e) { /* GDELT 熔断则本轮跳过 */ }
  }
  /* ② 专业 RSS（并行 + 硬超时竞速——实测 maritime-executive 会挂死连接，必须 race 兜底） */
  const _rssFetch = (u) => Promise.race([
    netx.smartFetch(u, { timeout: 12000 }).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  const rssResults = await Promise.allSettled(CHANNEL_RSS.map(s => _rssFetch(s.url)));
  rssResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    try {
      const items = scrapers.parseRss(r.value.body || '');
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
