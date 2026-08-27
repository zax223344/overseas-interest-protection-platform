/* compliance-watch.js — 政策法规与合规哨兵（维度⑥，2026-08-28）
 * ================================================================
 * 依据官方框架：东道国外资审查、出口管制、制裁清单、双边协定、涉外法治动态。
 * 中国海外利益正从商业风险转向"地缘政治武器化+法律规则双标化+行政手段极端化"，
 * OFAC 制裁/实体清单/CFIUS 审查/欧盟《国际采购工具》等是中企出海的系统性壁垒。
 * 职责：每 30 分钟一轮——
 *   ① GDELT 制裁合规矩阵检索（OFAC/entity list/CFIUS/export control/涉华制裁）
 *   ② 官方源直采（美财政部 OFAC press releases RSS + 商务部/官媒涉华经贸口径）
 *   ③ 走既有闸门入库，data_type=sanctions_data，挂 compliance_tags
 * 铁律：零模拟；标题必须命中制裁/管制信号 + 利益关联国或涉华要素。 */
'use strict';
const crawler = require('./crawler');
/* GDELT 单查询 30s 硬竞速：复杂查询偶发挂起，绝不让单次检索阻塞哨兵轮次 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);
const netx = require('./netx');
const scrapers = require('./scrapers');

const COMPLIANCE_RSS = [
  { name: 'US Treasury Press', url: 'https://home.treasury.gov/news/press-releases/feed' }
];

const COMPLIANCE_QUERIES = [
  'OFAC sanctions Chinese company OR entity list',
  'entity list OR SDN list Chinese addition',
  'CFIUS Chinese acquisition review',
  'export control semiconductor China chip',
  'EU investment screening OR foreign subsidy China',
  'Chinese companies blacklisted OR sanctioned overseas',
  '不可靠实体清单 OR 反外国制裁法',
  'India OR Vietnam OR Indonesia ban Chinese company OR app'
];

/* 制裁合规信号（标题必须命中） */
const SANCTION_SEC_RE = /sanction|entity list|sdn|ofac|cfius|export control|blacklist|black-list|embargo|tariff|anti-dumping|countervailing|审查|管制|制裁|实体清单|黑名单|禁令|禁运|关税|反倾销|反补贴|封禁|下架|限制/i;
/* 利益关联：涉华或重点国 */
const INTEREST_RE = /china|chinese|beijing|中国|中资|中企|中方|涉华|对华|华为|tiktok|字节|小米|比亚迪|巴基斯坦|哈萨克|印尼|尼日利亚|俄罗斯|伊朗|越南|印度| Saudi|阿联酋|非洲|拉美|东南亚|中亚|一带一路|belt and road/i;

async function runComplianceWatch(opts) {
  opts = opts || {};
  const out = [];
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const qs = [COMPLIANCE_QUERIES[cyc % COMPLIANCE_QUERIES.length], COMPLIANCE_QUERIES[(cyc + 4) % COMPLIANCE_QUERIES.length]];
  for (const q of qs) {
    try {
      const arts = await _gdelt(q, { timespan: '1d', maxrecords: opts.maxPerQuery || 12 });
      (arts || []).forEach(a => {
        out.push({
          title: a.title || '', content: '', url: a.url || a.link || '',
          publish_time: a.publish_time || a.publishedAt || a.seendate || '',
          source: a.source || a.domain || 'GDELT', country: a.country || '', _sourceType: 'compliance_watch', _viaGdelt: true
        });
      });
    } catch (e) {}
  }
  const _rssFetch = (u) => Promise.race([
    netx.smartFetch(u, { timeout: 12000 }).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  const rssResults = await Promise.allSettled(COMPLIANCE_RSS.map(s => _rssFetch(s.url)));
  rssResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    try {
      const items = scrapers.parseRss(r.value.body || '');
      items.slice(0, 8).forEach(it => {
        out.push({
          title: it.title || '', content: it.description || '', url: it.link || COMPLIANCE_RSS[i].url,
          publish_time: it.pubDate || '', source: COMPLIANCE_RSS[i].name, country: '', _sourceType: 'compliance_watch'
        });
      });
    } catch (e) {}
  });
  const filtered = out.filter(it => {
    const t = String(it.title || '') + ' ' + String(it.content || '');
    if (!t.trim()) return false;
    return SANCTION_SEC_RE.test(t) && (INTEREST_RE.test(t) || scrapers.isChinaRelatedStrict(t));
  });
  const seen = new Set();
  const uniq = filtered.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length };
}

module.exports = { runComplianceWatch, COMPLIANCE_QUERIES, COMPLIANCE_RSS };
