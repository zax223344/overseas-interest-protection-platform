/* customs-watch.js — 各国海关动态及海外合规监管哨兵（2026-09-04 用户指令）
 * ================================================================
 * 背景：日采集量未达标（全天 ~2000/4000，晚间主通道 1469 候选仅入库 8 条——固定 982 路 RSS
 * 增量枯竭），且合规类缺口最大（法律合规 21/140、制裁管制 63/140），既有 compliance_watch
 * 聚焦制裁/清单（今日仅 6 条），海关动态（关税/贸易救济/通关/查扣）无专门通道。
 * 职责：每 15 分钟一轮，宽查询面定向采集——
 *   ① 海关政策与通关动态：customs/关税调整/进口禁令/通关延误/查扣缉私/原产地规则
 *   ② 贸易救济：anti-dumping/countervailing/safeguard/Section 301·232
 *   ③ 出口管制与制裁：export control/Entity List/SDN/OFAC/BIS/双用途
 *   ④ 外资审查与合规执法：CFIUS/FDI 审查/外国补贴规制/反垄断/监管罚款
 *   ⑤ 涉华专项：每条查询面均挂涉华或重点国要素
 * 通道：GDELT×3（OR 语法）+ GNews 原子×6（串行防限流）+ Google News RSS×2，
 *   词表按周期轮换，24h 时效（when:1d / timespan:1d），走既有闸门入库。
 * 铁律：零模拟；标题+正文必中海关/合规信号词 + 利益关联要素；静态科普/海淘代购类拦截；
 *   data_type 逐项判定（制裁管制→sanctions_data，其余→legal_compliance）。 */
'use strict';
const crawler = require('./crawler');
const scrapers = require('./scrapers');
const netx = require('./netx');

/* GDELT seendate(20260829T120000Z) → ISO（与 compliance-watch 同源排雷：
   原始 seendate 无人解析会被 stale 闸误杀） */
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
/* AP 站内检索 30s 硬竞速（与 GDELT 互补的真实独立通道：响应快、命中稳） */
const _ap = (q, o) => Promise.race([
  crawler.apSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);

/* ===== 查询词表（2026-09-04 实测校准基调：GDELT 支持 OR/多组 AND；GNews 仅原子查询） ===== */
/* GDELT 主查询池：海关/关税/贸易救济 × 利益关联。每轮 3 条轮换（cyc×3 偏移），4 轮全覆盖。 */
const CUSTOMS_GDELT_QUERIES = [
  '(customs OR tariff OR "import duty") (China OR Chinese OR Beijing)',
  '("anti-dumping" OR countervailing OR "trade remedy" OR safeguard) (China OR Chinese OR EU OR "European Union")',
  '("export control" OR "entity list" OR "SDN list" OR OFAC) (China OR semiconductor OR chip OR Huawei)',
  '(CFIUS OR "investment screening" OR "foreign subsidy" OR FDI) (China OR Chinese OR acquisition)',
  '(customs OR border OR port) (seizure OR seized OR smuggling OR confiscated) (cargo OR goods OR shipment)',
  '(tariff OR "trade war" OR "tariff hike") ("United States" OR Trump OR EU OR Brussels)',
  '("import ban" OR "export restriction" OR "import licensing") (critical OR mineral OR technology OR drone)',
  '(sanctions OR embargo OR blacklist) (evasion OR circumvention OR "third country" OR transshipment)',
  '("customs clearance" OR "border delay" OR "port congestion" OR "customs inspection") (cargo OR freight OR container OR shipping)',
  '("rules of origin" OR "HS code" OR "rules of origin" OR transshipment) (China OR Vietnam OR Mexico OR Thailand)',
  '("Section 301" OR "Section 232" OR "trade enforcement" OR "customs fraud") (tariff OR duty OR imports)',
  '("data compliance" OR antitrust OR "regulatory fine" OR penalty) (China OR Chinese OR TikTok OR Shein OR Temu)'
];
/* GNews 原子查询池（无 OR——含 OR 返回 0 条，compliance-watch 实测教训）。每轮 6 条串行。 */
const CUSTOMS_GNEWS_QUERIES = [
  'customs tariff China', 'China tariffs announced', 'EU tariffs Chinese goods', 'anti-dumping China',
  'countervailing duty Chinese', 'export control semiconductor', 'entity list Chinese companies', 'OFAC sanctions Chinese',
  'CFIUS review Chinese', 'investment screening China', 'customs seizure smuggling', 'customs clearance delay',
  'import ban Chinese products', 'trade remedy investigation', 'Section 301 tariffs', 'sanctions evasion network',
  'customs fraud imports', 'border tariff increase', 'foreign subsidy regulation', 'dual-use export control',
  'customs enforcement action', 'tariff hike announced', 'customs duty changes', 'trade compliance penalty'
];
/* Google News RSS 补充池（英文，when:1d）。每轮 2 条。 */
const CUSTOMS_GNRSS_QUERIES = [
  'customs policy change', 'tariff announcement', 'trade compliance enforcement', 'export control rules',
  'customs enforcement seizure', 'anti-dumping investigation', 'investment screening regulation', 'border trade measures'
];
/* AP 站内检索池（独立通道，原子关键词）。每轮 2 条。 */
const CUSTOMS_AP_QUERIES = [
  'customs tariff', 'China tariffs', 'export control', 'anti-dumping',
  'sanctions Chinese companies', 'trade restrictions', 'customs seizure', 'investment screening'
];

/* ===== 信号/关联/排除三层过滤 ===== */
/* 海关/合规信号（标题+正文必中其一） */
const CUSTOMS_SEC_RE = /customs|tariff|dut(y|ies)|anti-?dumping|countervailing|safeguard|export control|sanction|entity list|\bsdn\b|ofac|\bbis\b|cfius|investment screening|foreign subsidy|embargo|blacklist|seiz(e|ure|ed)|smuggl|clearance|border (tax|measure|adjustment|delay)|import (ban|restriction|licensing|duty)|export (ban|restriction|license|control)|trade (remedy|war|restriction|barrier|compliance|enforce)|section (301|232)|rules of origin|hs (code|classification)|\baeo\b|transshipment|海关|关税|反倾销|反补贴|保障措施|出口管制|进口管制|制裁|实体清单|黑名单|禁运|外资审查|合规|通关|清关|查扣|查缉|缉私|走私|贸易救济|原产地|转运规避/i;
/* 利益关联：涉华 OR 64 国底数重点国 OR 系统性主要经济体（其海关政策波及全球中企） */
const INTEREST_RE = /china|chinese|beijing|中国|中资|中企|中方|涉华|对华|华为|tiktok|字节|小米|比亚迪|shein|temu|巴基斯坦|哈萨克|印尼|尼日利亚|俄罗斯|伊朗|越南|印度|沙特|阿联酋|泰国|马来|缅甸|柬埔寨|老挝|埃及|埃塞|肯尼亚|几内亚|秘鲁|巴西|阿根廷|墨西哥|塞尔维亚|匈牙利|希腊|巴拿马|吉布提|斯里兰卡|孟加拉|伊拉克|阿富汗|刚果|南非|土耳其|波兰|捷克|乌兹别克|塔吉克|吉尔吉斯|蒙古|安哥拉|坦桑尼亚|赞比亚|白俄罗斯|委内瑞拉|古巴|朝鲜|缅|菲律宾|新加坡|\bEU\b|european union|europe|brussels|washington|\bUS\b|u\.s\.|united states|america|美国|欧盟|欧洲|英国|britain|\buk\b|日本|japan|德国|germany|法国|france|加拿大|canada|澳大利亚|australia|韩国|korea|一带一路|belt and road|非洲|拉美|东南亚|中亚|中东/i;
/* 静态体裁与消费噪声排除（海淘/代购/行邮攻略是 C 端消费内容，非海关监管动态） */
const STATIC_GENRE_RE = /解读|视点|百科|知乎|百度经验|话题广场|系列文章|最佳实践|指南|手册|白皮书|培训|课程|讲座|盘点|综述|什么是|_官网$|官方网站$|海淘|代购|行邮|个人物品|跨境包裹攻略|关税计算器|税率查询|shopping|haul|coupon|discount code|how to (import|shop)|gift guide/i;
/* 制裁管制类 data_type 判定（命中 → sanctions_data，其余海关/合规 → legal_compliance） */
const SANCTION_DT_RE = /sanction|entity list|\bsdn\b|ofac|export control|embargo|blacklist|dual-?use|\bbis\b|制裁|实体清单|出口管制|禁运|黑名单/i;

/* Google News RSS 检索（compliance-watch 实测高可用通道；并发立即限流→串行+间歇重试×2） */
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

async function runCustomsWatch(opts) {
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
      _sourceType: 'customs_watch'
    });
  });

  /* ① GDELT×3（软熔断：连续 2 空跳过剩余 GDELT；冷却期整体跳过，配额让给 GNews/AP） */
  const gdCooling = (() => { try { return crawler.gdeltStatus().cooling; } catch (e) { return false; } })();
  if (!gdCooling) {
    const gq = [0, 1, 2].map(i => CUSTOMS_GDELT_QUERIES[(cyc * 3 + i) % CUSTOMS_GDELT_QUERIES.length]);
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
  const aq = [0, 1].map(i => CUSTOMS_AP_QUERIES[(cyc * 2 + i) % CUSTOMS_AP_QUERIES.length]);
  for (const q of aq) { try { _push(await _ap(q, { maxrecords: 15, pages: 1 }), 'AP'); } catch (e) {} }
  /* ③ GNews 原子×8 串行（每轮 8 条互补，cyc 偏移轮换，3 轮全覆盖 24 词表） */
  const nq = [0, 1, 2, 3, 4, 5, 6, 7].map(i => CUSTOMS_GNEWS_QUERIES[(cyc * 8 + i) % CUSTOMS_GNEWS_QUERIES.length]);
  for (const q of nq) { _push(await _gnewsRss(q, 10), 'GNews'); }
  /* ④ Google News RSS×2（英文补充面） */
  const rq = [0, 1].map(i => CUSTOMS_GNRSS_QUERIES[(cyc * 2 + i) % CUSTOMS_GNRSS_QUERIES.length]);
  for (const q of rq) { _push(await _gnewsRss(q, 10), 'Google News'); }

  /* 三层过滤：信号必中 + 利益关联 + 静态/消费噪声拦截 */
  const filtered = out.filter(it => {
    const t = String(it.title || '') + ' ' + String(it.content || '');
    if (!String(it.title || '').trim()) return false;
    if (STATIC_GENRE_RE.test(String(it.title || ''))) return false;
    return CUSTOMS_SEC_RE.test(t) && (INTEREST_RE.test(t) || scrapers.isChinaRelatedStrict(t));
  });
  /* 逐项 data_type 判定：制裁管制 → sanctions_data；海关/合规 → legal_compliance */
  filtered.forEach(it => {
    const t = String(it.title || '') + ' ' + String(it.content || '');
    it.data_type = SANCTION_DT_RE.test(t) ? 'sanctions_data' : 'legal_compliance';
  });
  /* 模块内去重（URL 规范化 + 标题指纹） */
  const seen = new Set();
  const uniq = filtered.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length, stats: { fetched: fetched, filtered: filtered.length, gdeltSkipped: gdeltEmptyStreak >= 2 } };
}

module.exports = { runCustomsWatch, CUSTOMS_GDELT_QUERIES, CUSTOMS_GNEWS_QUERIES, CUSTOMS_GNRSS_QUERIES };
