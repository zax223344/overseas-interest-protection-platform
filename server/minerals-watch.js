/* minerals-watch.js — 关键矿产资源采集哨兵（2026-09-05 用户指令四）
 * ================================================================
 * 背景：固定 RSS 源池增量枯竭，关键矿产（锂/钴/铜/稀土/镍/石墨/铀/锰/铝土矿/钽）
 * 无定向采集通道；非洲（刚果金/赞比亚/几内亚/津巴布韦/纳米比亚/南非/马里/坦桑尼亚/
 * 莫桑比克/马达加斯加/加蓬/博茨瓦纳）与拉美（智利/秘鲁/阿根廷/玻利维亚/巴西/墨西哥/
 * 厄瓜多尔/哥伦比亚）锂三角与铜钴带是全球中企矿产利益核心暴露面。
 * 职责：每 15 分钟一轮，宽查询面定向采集——
 *   ① 资源政策与国有化：nationalization/资源民族主义/矿权改革/权益金上调/出口禁令
 *   ② 矿权与项目动态：license/concession/采矿许可/新矿投产/停产检修/扩产
 *   ③ 中资矿企动向：CMOC/紫金/宁德时代/华友/青山/中矿/赣锋/天齐/洛阳钼业/五矿
 *   ④ 供应链与贸易：export ban/精矿出口/冶炼产能/港口铁路外运通道
 *   ⑤ 矿区安全与社会风险：矿区罢工/社区冲突/环保抗议/非法采矿/武装夺矿
 * 通道：GDELT×3（OR 语法）+ AP×2 + GNews 原子×8（串行防限流）+ Google News RSS×2，
 *   词表按周期轮换，24h 时效（when:1d / timespan:1d），走既有闸门入库。
 * 铁律：零模拟；标题+正文必中矿产信号词 + 利益关联要素（涉华/重点资源国/主要矿企）；
 *   静态科普/行情软件噪声拦截；data_type=infrastructure（基础设施与关键矿产）。 */
'use strict';
const crawler = require('./crawler');
const scrapers = require('./scrapers');
const netx = require('./netx');

/* GDELT seendate(20260829T120000Z) → ISO（原始 seendate 无人解析会被 stale 闸误杀） */
const _sdIso = (a) => {
  if (a.publish_time || a.publishedAt) return a.publish_time || a.publishedAt;
  if (!a.seendate) return a.pubDate || '';
  const iso = String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  return iso !== String(a.seendate) ? iso : (a.pubDate || a.seendate || '');
};
/* GDELT 单查询 30s 硬竞速：绝不让单次检索阻塞哨兵轮次 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);
/* AP 站内检索 30s 硬竞速 */
const _ap = (q, o) => Promise.race([
  crawler.apSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);

/* ===== 查询词表（GDELT 支持 OR/多组 AND；GNews 仅原子查询） ===== */
/* GDELT 主查询池：矿产 × 资源国 × 中资。每轮 3 条轮换。 */
const MINERALS_GDELT_QUERIES = [
  '(lithium OR "lithium mine" OR "lithium project") (Chile OR Argentina OR Bolivia OR Zimbabwe OR "lithium triangle")',
  '(cobalt OR copper) ("Democratic Republic of Congo" OR DRC OR Congo OR Zambia OR "Copperbelt")',
  '("rare earth" OR "rare earths" OR "critical minerals") (China OR export OR ban OR restriction)',
  '(nickel OR "nickel mine" OR ferronickel) (Indonesia OR Philippines OR "New Caledonia" OR Guatemala)',
  '(graphite OR "natural graphite" OR anode) (Mozambique OR Madagascar OR Tanzania OR China)',
  '(uranium OR "uranium mine") (Namibia OR Niger OR Kazakhstan OR Uzbekistan)',
  '(bauxite OR alumina OR aluminum) (Guinea OR Ghana OR Indonesia OR Brazil)',
  '(manganese OR "manganese ore") (Gabon OR "South Africa" OR Ghana OR Brazil)',
  '(tantalum OR coltan OR tin OR tungsten) (Congo OR Rwanda OR "Great Lakes" OR Bolivia)',
  '(mining OR mine) (nationalization OR nationalise OR nationalize OR "resource nationalism" OR expropriation) (lithium OR copper OR cobalt OR gold OR minerals)',
  '("export ban" OR "export restriction" OR "export quota" OR "export tax" OR "royalty hike") (minerals OR ore OR concentrate OR lithium OR cobalt OR copper OR nickel)',
  '("mining license" OR "mining permit" OR concession OR "mining rights") (revoked OR suspended OR granted OR dispute) (lithium OR copper OR cobalt OR gold)',
  '(Zijin OR CMOC OR "China Molybdenum" OR CATL OR Huayou OR Tsingshan OR Sinomine OR Ganfeng OR Tianqi OR "MMG Ltd" OR "China Railway" OR "Zijin Mining") (mine OR mining OR lithium OR copper OR cobalt)',
  '(mine OR mining) (strike OR protest OR blockade OR "community conflict" OR "illegal mining" OR attack) (Chile OR Peru OR Congo OR Zambia OR "South Africa" OR Panama OR Ecuador)',
  '("critical minerals" OR "mineral security" OR "minerals partnership") (United States OR EU OR G7 OR NATO OR China)'
];
/* GNews 原子查询池（无 OR——含 OR 返回 0 条）。每轮 8 条串行。 */
const MINERALS_GNEWS_QUERIES = [
  'lithium mine Chile', 'lithium project Argentina', 'Bolivia lithium', 'cobalt mine Congo',
  'copper mine Zambia', 'Copperbelt mining', 'rare earth export China', 'critical minerals policy',
  'nickel Indonesia export', 'graphite Mozambique', 'uranium Namibia', 'bauxite Guinea',
  'mining nationalization', 'mining royalty increase', 'mineral export ban', 'mining license revoked',
  'Zijin Mining', 'CMOC cobalt', 'CATL lithium', 'Tsingshan nickel', 'Ganfeng lithium',
  'Tianqi lithium', 'mine strike Peru', 'mining protest Chile', 'illegal mining Africa',
  'mine community conflict', 'copper concentrate export', 'lithium carbonate price policy', 'cobalt export quota',
  'rare earth processing', 'mineral supply chain', 'mining investment Africa', 'lithium triangle'
];
/* Google News RSS 补充池。每轮 2 条。 */
const MINERALS_GNRSS_QUERIES = [
  'critical minerals Africa', 'lithium Latin America', 'cobalt Congo mine', 'copper mining policy',
  'rare earth supply', 'nickel export policy', 'mining community protest', 'Chinese mining investment'
];
/* AP 站内检索池（独立通道，原子关键词）。每轮 2 条。 */
const MINERALS_AP_QUERIES = [
  'lithium mine', 'cobalt Congo', 'copper mine strike', 'rare earth',
  'nickel Indonesia', 'critical minerals', 'mining protest', 'mineral export'
];

/* ===== 信号/关联/排除三层过滤 ===== */
/* 矿产信号（标题+正文必中其一） */
const MINERALS_SEC_RE = /lithium|cobalt|copper|rare earth|nickel|graphite|uranium|manganese|bauxite|alumina|tantalum|coltan|\btin\b|tungsten|cobalt|lithium|vanadium|chromite|platinum|\bpalladium\b|iron ore|gold mine|silver mine|zinc|lead mine|critical mineral|mineral (resource|security|reserve|export|project)|mining (license|permit|rights|concession|policy|royalt|sector|code|law|ban)|mine (nationaliz|expropriat|strike|closure|protest|blockade|shutdown|expansion)|ore (export|processing|concentrate)|smelter|refinery|refining capacit|extractive|resource nationalism|锂|钴|铜矿|稀土|镍|石墨|铀|锰矿|铝土矿|钽|锡|钨|钒|铬|铂族|铁矿|金矿|锌|铅矿|关键矿产|矿产(资源|安全|储备|出口|项目)|采矿(许可|权|政策|权益金|法)|矿山(国有化|罢工|停产|冲突|扩建)|精矿|冶炼|矿权|资源民族主义/i;
/* 利益关联：涉华 OR 重点资源国（非洲/拉美/印尼/蒙古）OR 主要矿企 OR 矿产消费政策方 */
const INTEREST_RE = /china|chinese|beijing|中国|中资|中企|中方|涉华|紫金|洛阳钼业|宁德时代|华友|青山|中矿|赣锋|天齐|五矿|zijin|cmoc|catl|huayou|tsingshan|sinomine|ganfeng|tianqi|\bmmg\b|congo|drc|刚果|zambia|赞比亚|guinea|几内亚|zimbabwe|津巴布韦|namibia|纳米比亚|south africa|南非|mali|马里|tanzania|坦桑尼亚|mozambique|莫桑比克|madagascar|马达加斯加|gabon|加蓬|botswana|博茨瓦纳|niger|尼日尔|ghana|加纳|angola|安哥拉|chile|智利|peru|秘鲁|argentina|阿根廷|bolivia|玻利维亚|brazil|巴西|mexico|墨西哥|ecuador|厄瓜多尔|colombia|哥伦比亚|panama|巴拿马|indonesia|印尼|philippines|菲律宾|mongolia|蒙古|kazakhstan|哈萨克|uzbekistan|乌兹别克|serbia|塞尔维亚|缅甸|myanmar|lithium triangle|锂三角|copperbelt|铜带|glencore|嘉能可|freeport|\bbhp\b|rio tinto|力拓|淡水河谷|vale|codelco|first quantum|第一量子|ivanhoe|艾芬豪|一带一路|belt and road|非洲|拉美|拉丁美洲/i;
/* 静态体裁与消费噪声排除（行情软件/投资荐股/科普攻略是噪声，非矿产动态） */
const STATIC_GENRE_RE = /解读|视点|百科|知乎|百度经验|话题广场|系列文章|最佳实践|指南|手册|白皮书|培训|课程|讲座|盘点|综述|什么是|_官网$|官方网站$|荐股|涨停|跌停|股价|k线|技术分析|投资顾问|理财|基金净值|stock tip|price target|buy rating|how to invest|gift guide|coupon|discount code/i;

/* Google News RSS 检索（并发立即限流→串行+间歇重试×2） */
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
    return (scrapers.parseRss(text) || []).slice(0, max || 10).map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Google News', country: ''
    }));
  } catch (e) { return []; }
}

async function runMineralsWatch(opts) {
  opts = opts || {};
  const out = [];
  const cyc = Math.floor(Date.now() / (15 * 60 * 1000)); /* 15min 周期序号，驱动词表轮换 */
  const perQ = opts.maxPerQuery || 30;
  let fetched = 0, gdeltEmptyStreak = 0;
  const _push = (arts, srcName) => (arts || []).forEach(a => {
    fetched++;
    out.push({
      title: a.title || '', content: a.description || a.content || '', url: a.url || a.link || '',
      publish_time: _sdIso(a),
      source: a.source || a.domain || a.platform || srcName || '全网检索', country: a.country || '',
      _sourceType: 'minerals_watch'
    });
  });

  /* ① GDELT×3（软熔断：连续 2 空跳过剩余 GDELT；冷却期整体跳过） */
  const gdCooling = (() => { try { return crawler.gdeltStatus().cooling; } catch (e) { return false; } })();
  if (!gdCooling) {
    const gq = [0, 1, 2].map(i => MINERALS_GDELT_QUERIES[(cyc * 3 + i) % MINERALS_GDELT_QUERIES.length]);
    for (const q of gq) {
      if (gdeltEmptyStreak >= 2) break;
      try {
        let arts = await _gdelt(q, { timespan: '1d', maxrecords: perQ });
        if (!arts || !arts.length) { gdeltEmptyStreak++; } else { gdeltEmptyStreak = 0; _push(arts, 'GDELT'); }
      } catch (e) { gdeltEmptyStreak++; }
      await new Promise(s => setTimeout(s, 1500)); /* GDELT 限流礼貌间隔 */
    }
  }
  /* ② AP 站内检索×2（独立通道，响应快） */
  const aq = [0, 1].map(i => MINERALS_AP_QUERIES[(cyc * 2 + i) % MINERALS_AP_QUERIES.length]);
  for (const q of aq) { try { _push(await _ap(q, { maxrecords: 15, pages: 1 }), 'AP'); } catch (e) {} }
  /* ③ GNews 原子×8 串行（cyc 偏移轮换，4 轮全覆盖 32 词表） */
  const nq = [0, 1, 2, 3, 4, 5, 6, 7].map(i => MINERALS_GNEWS_QUERIES[(cyc * 8 + i) % MINERALS_GNEWS_QUERIES.length]);
  for (const q of nq) { _push(await _gnewsRss(q, 10), 'GNews'); }
  /* ④ Google News RSS×2（英文补充面） */
  const rq = [0, 1].map(i => MINERALS_GNRSS_QUERIES[(cyc * 2 + i) % MINERALS_GNRSS_QUERIES.length]);
  for (const q of rq) { _push(await _gnewsRss(q, 10), 'Google News'); }

  /* 三层过滤：信号必中 + 利益关联 + 静态/行情噪声拦截 */
  const filtered = out.filter(it => {
    const t = String(it.title || '') + ' ' + String(it.content || '');
    if (!String(it.title || '').trim()) return false;
    if (STATIC_GENRE_RE.test(String(it.title || ''))) return false;
    return MINERALS_SEC_RE.test(t) && (INTEREST_RE.test(t) || scrapers.isChinaRelatedStrict(t));
  });
  /* data_type 统一 infrastructure（受控词表 → 基础设施与关键矿产） */
  filtered.forEach(it => { it.data_type = 'infrastructure'; });
  /* 模块内去重（URL 规范化） */
  const seen = new Set();
  const uniq = filtered.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length, stats: { fetched: fetched, filtered: filtered.length, gdeltSkipped: gdeltEmptyStreak >= 2 } };
}

module.exports = { runMineralsWatch, MINERALS_GDELT_QUERIES, MINERALS_GNEWS_QUERIES, MINERALS_GNRSS_QUERIES };
