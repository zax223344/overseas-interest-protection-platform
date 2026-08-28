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

/* US Treasury RSS 已移除（实测 503 反爬返回 HTML 而非 RSS；OFAC 动态由 GDELT/crawlWeb 检索覆盖） */
const COMPLIANCE_RSS = [];

/* 双语言查询（2026-08-28 实测教训：cn.bing.com 英文查询只返回百科/知乎垃圾页，中文查询才有效；
 * GDELT 则相反——英文全球媒体覆盖好。各用所长） */
const COMPLIANCE_QUERIES_EN = [
  'OFAC sanctions Chinese company OR entity list',
  'entity list OR SDN list Chinese addition',
  'CFIUS Chinese acquisition review',
  'export control semiconductor China chip',
  'EU investment screening OR foreign subsidy China',
  'Chinese companies blacklisted OR sanctioned overseas'
];
/* GNews 原子查询集（GNews 不支持 OR 操作符——含 OR 的查询返回 0 条，2026-08-28 实测） */
const COMPLIANCE_GNEWS_QUERIES = [
  'OFAC sanctions Chinese company',
  'entity list Chinese companies',
  'CFIUS Chinese acquisition',
  'export control China semiconductor',
  'China sanctions announced',
  'Chinese companies blacklisted'
];

/* 制裁合规信号（标题必须命中） */
const SANCTION_SEC_RE = /sanction|entity list|sdn|ofac|cfius|export control|blacklist|black-list|embargo|tariff|anti-dumping|countervailing|审查|管制|制裁|实体清单|黑名单|禁令|禁运|关税|反倾销|反补贴|封禁|下架|限制/i;
/* 利益关联：涉华或重点国 */
const INTEREST_RE = /china|chinese|beijing|中国|中资|中企|中方|涉华|对华|华为|tiktok|字节|小米|比亚迪|巴基斯坦|哈萨克|印尼|尼日利亚|俄罗斯|伊朗|越南|印度| Saudi|阿联酋|非洲|拉美|东南亚|中亚|一带一路|belt and road/i;
/* 静态体裁排除（Bing 中文检索带出的解读/视点/百科类是知识文章不是动态，禁止入库） */
const STATIC_GENRE_RE = /解读|视点|百科|知乎|百度经验|话题广场|系列文章|最佳实践|指南|手册|白皮书|培训|课程|讲座|盘点|综述|什么是|_官网$|官方网站$/i;

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

async function runComplianceWatch(opts) {
  opts = opts || {};
  const out = [];
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  /* 双通道：GDELT 英文 + Bing 中文，各轮换 1 条 */
  const qEn = COMPLIANCE_QUERIES_EN[cyc % COMPLIANCE_QUERIES_EN.length];
  const _push = (arts) => (arts || []).forEach(a => {
    out.push({
      title: a.title || '', content: a.description || a.content || '', url: a.url || a.link || '',
      publish_time: _sdIso(a),
      source: a.source || a.domain || a.platform || '全网检索', country: a.country || '', _sourceType: 'compliance_watch'
    });
  });
  /* ① GDELT 英文（GDELT 惩罚箱零产出时该查询也过一遍 Bing） */
  try {
    let arts = await _gdelt(qEn, { timespan: '1d', maxrecords: opts.maxPerQuery || 12 });
    if (!arts || !arts.length) arts = await _gnewsRss(qEn, opts.maxPerQuery || 10);
    _push(arts);
  } catch (e) {}
  /* ② GNews RSS 原子查询×3 并发（2026-08-28 实测：召回对措辞极敏感——
   * 'export control China semiconductor' 62条 vs 'OFAC sanctions Chinese company' 0条，
   * 单查询轮换会出现整轮空手；每轮并发 3 条互补） */
  try {
    const gq = [0, 2, 4].map(i => COMPLIANCE_GNEWS_QUERIES[(cyc + i) % COMPLIANCE_GNEWS_QUERIES.length]);
    for (const q of gq) { _push(await _gnewsRss(q, opts.maxPerQuery || 10)); }  /* 串行：并发触发限流 */
  } catch (e) {}
  const filtered = out.filter(it => {
    const t = String(it.title || '') + ' ' + String(it.content || '');
    if (!t.trim()) return false;
    if (STATIC_GENRE_RE.test(String(it.title || ''))) return false;   /* 解读/百科/指南类静态文章拦截 */
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

module.exports = { runComplianceWatch, COMPLIANCE_QUERIES_EN, COMPLIANCE_GNEWS_QUERIES, COMPLIANCE_RSS };
