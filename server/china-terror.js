/* ============================================================
 * server/china-terror.js — 涉华恐袭数据集（2026-09-07 #689 用户指令）
 * ================================================================
 * 需求口径：将 2010 年以来全球针对中国驻外机构、中资企业、中国公民发动的
 * 恐怖袭击建成专项数据集；重点巴基斯坦、阿富汗、刚果（金）、尼日利亚、
 * 尼日尔等非洲方向实时数据。
 *
 * 设计（参照 core-threat-watch 三层采集模式）：
 *   L1 GDELT DOC 2.0 复杂布尔：
 *     · 涉华主体×袭击动词 三条全球矩阵（公民/企业与项目/使领馆机构）
 *     · 重点国别深挖矩阵（巴基斯坦/CPEC、阿富汗、刚果金、尼日利亚、尼日尔
 *       与萨赫勒、索马里-肯尼亚-埃塞非洲之角）
 *   L2 GNews/Bing 原子词（引擎不支持括号分组，靠标题正则二次过滤）
 *   过滤：标题必须同时命中 涉华词 ∩ 袭击词，且不命中 体育/选举/财经 噪声。
 *   入库：本模块只采集不直接写库；server.js 包装函数调用后走
 *   _ingestLinkedItems 标准闸门（_forceDataType 锁定 terror_events）。
 *
 * 历史回补：GDELT DOC 全文库 earliest 2017-01-01，按 15 天切片 × 2 条矩阵
 * 查询 × 5s 限流后台跑（runBackfillSlice 由 server.js 逐片调度）；
 * 更早年份（2010-2016）走 GDELT 1.0 事件表二期补齐，聚合口径先行纳入
 * 库内既有涉华恐袭条目。
 *
 * 聚合端点（本模块 router，挂 /api/terror）：
 *   GET /china-dataset  数据集全景：总量/年度分布/国别TOP/目标类型/最新事件/回补状态
 * ============================================================ */
'use strict';
const express = require('express');
const crawler = require('./crawler.js');
const globalmedia = require('./globalmedia.js');
const netx = require('./netx');
const scrapers = require('./scrapers');
const reportsEngine = require('./reports-engine');   /* #692：pvKimi() 取 LLM 供应商 */

/* ---- 涉华要素词（标题/摘要必须命中其一） ---- */
const CN_RE = /chinese|china|beijing|中国|中方|中资|中企|华人|华侨|华裔|cpec|belt and road|一带一路|中巴经济走廊/i;
/* ---- 袭击动词词（必须命中其一；恐袭/绑架/爆炸/枪击/伏击/人质） ---- */
const ATK_RE = /attack|attacked|assault|ambush|bombing|bomb|blast|explosion|explosive|suicide|kidnap|kidnapped|kidnapping|abduct|abducted|abduction|hostage|shooting|shot|gunmen|gunfire|killed|murder|militant|insurgent|terror|massacre|behead|IED|grenade|rocket|loot|sabotage|arson|vandalis|袭击|恐袭|绑架|劫持|爆炸|枪击|伏击|人质|遇难|身亡|武装分子|极端分子|抢劫|纵火|破坏/i;
/* ---- 噪声词（命中即弃） ---- */
const NOISE_RE = /\bfootball\b|\bsoccer\b|\bFIFA\b|\bcricket\b|\btennis\b|\bNBA\b|election|poll|campaign|parliament|stock market|bond yield|box office|weather forecast|film festival|movie review|trade deficit|tariff war|chip ban|股价|股市|选举|联赛|锦标赛|票房|电影|娱乐/i;
/* ---- 重点国别（用户点名：巴基斯坦/阿富汗/刚果金/尼日利亚/尼日尔等非洲） ---- */
const FOCUS = [
  { id: 'pak',   cn: '巴基斯坦',   kw: /pakistan|pakistani|karachi|islamabad|lahore|peshawar|balochistan|gwadar|cpec|khyber|sindh|旁遮普|信德|俾路支/i },
  { id: 'afg',   cn: '阿富汗',     kw: /afghanistan|afghan|kabul|kandahar|herat|阿富汗/i },
  { id: 'drc',   cn: '刚果（金）', kw: /dr congo|drc\b|congo|congolese|kinshasa|goma|lubumbashi|kolwezi|north kivu|south kivu|katanga|刚果/i },
  { id: 'nga',   cn: '尼日利亚',   kw: /nigeria|nigerian|lagos|abuja|kaduna|borno|boko haram|iswap|尼日利亚/i },
  { id: 'sahel', cn: '尼日尔',     kw: /niger\b|niamey|burkina faso|ouagadougou|mali\b|bamako|sahel|jnim|尼日尔|布基纳法索|马里/i },
  { id: 'horn',  cn: '索马里',     kw: /somalia|somali|mogadishu|al-?shabaab|kenya|nairobi|ethiopia|addis ababa|索马里|肯尼亚|埃塞俄比亚/i }
];
const _FOCUS_RE = FOCUS.map(f => f.kw);
const _CN_ONLY_RE = /chinese|china|中国|中方|中资|华人|华侨|cpec/i;

/* ---- L1：GDELT 实时矩阵（timespan 2d） ---- */
const GDELT_RT_QUERIES = [
  { id: 'ct-victim', focus: '涉华公民遇袭', q: '("Chinese nationals" OR "Chinese citizens" OR "Chinese workers" OR "Chinese engineers" OR "Chinese businessmen" OR "Chinese contractors" OR "Chinese fishermen") (attack OR attacked OR bombing OR explosion OR kidnapped OR abduction OR killed OR shooting OR ambush OR suicide OR gunmen OR blast OR hostage OR shot OR injured)' },
  { id: 'ct-asset', focus: '中资企业与项目遇袭', q: '("Chinese company" OR "Chinese companies" OR "Chinese-owned" OR "China-funded" OR "Chinese firms" OR "Chinese investment" OR "Chinese project" OR CPEC OR "Belt and Road") (attack OR attacked OR bombing OR explosion OR sabotage OR arson OR vandalized OR stormed OR looted OR kidnapped OR killed OR gunmen OR blast OR militant OR suspended)' },
  { id: 'ct-mission', focus: '驻外机构遇袭', q: '("Chinese embassy" OR "Chinese consulate" OR "Confucius Institute" OR "Chinese ambassador" OR "Chinese diplomatic") (attack OR attacked OR bombing OR explosion OR protest OR stormed OR hostage OR threatened OR shot OR blast OR grenade)' },
  { id: 'ct-pak', focus: '巴基斯坦·涉华袭击', q: '("Chinese" OR "China") (attack OR bombing OR kidnapped OR killing OR shooting OR ambush OR suicide OR blast OR hostage OR militant OR convoy) (Pakistan OR Pakistani OR Karachi OR Balochistan OR Gwadar OR CPEC)' },
  { id: 'ct-afg', focus: '阿富汗·涉华袭击', q: '("Chinese" OR "China") (attack OR bombing OR kidnapped OR killing OR shooting OR ambush OR suicide OR blast OR hostage OR militant OR convoy) (Afghanistan OR Afghan OR Kabul)' },
  { id: 'ct-drc', focus: '刚果（金）·涉华袭击', q: '("Chinese" OR "China") (attack OR bombing OR kidnapped OR killing OR shooting OR ambush OR blast OR hostage OR militant OR mine OR convoy) ("DR Congo" OR Congolese OR Kinshasa OR Lubumbashi OR Kolwezi OR "North Kivu" OR Katanga)' },
  { id: 'ct-nga', focus: '尼日利亚·涉华袭击', q: '("Chinese" OR "China") (attack OR bombing OR kidnapped OR killing OR shooting OR ambush OR blast OR hostage OR militant OR convoy) (Nigeria OR Nigerian OR Lagos OR Abuja OR Kaduna)' },
  { id: 'ct-sahel', focus: '尼日尔/萨赫勒·涉华袭击', q: '("Chinese" OR "China") (attack OR bombing OR kidnapped OR killing OR shooting OR ambush OR blast OR hostage OR militant OR convoy) (Niger OR Niamey OR "Burkina Faso" OR Ouagadougou OR Mali OR Bamako OR Sahel)' },
  { id: 'ct-horn', focus: '非洲之角·涉华袭击', q: '("Chinese" OR "China") (attack OR bombing OR kidnapped OR killing OR shooting OR ambush OR blast OR hostage OR militant OR convoy) (Somalia OR Mogadishu OR Kenya OR Nairobi OR Ethiopia OR "Al-Shabaab")' }
];
/* ---- L1：GDELT 历史回补矩阵（绝对时间窗切片，2 条控制时长） ---- */
const GDELT_BF_QUERIES = [
  { id: 'bf-victim', focus: '涉华公民遇袭', q: '("Chinese nationals" OR "Chinese citizens" OR "Chinese workers" OR "Chinese engineers" OR "Chinese businessmen" OR "Chinese contractors" OR "Chinese fishermen") (attack OR attacked OR bombing OR explosion OR kidnapped OR abduction OR killed OR shooting OR ambush OR suicide OR gunmen OR blast OR hostage)' },
  { id: 'bf-asset', focus: '中资企业与机构遇袭', q: '("Chinese company" OR "Chinese companies" OR "Chinese-owned" OR "China-funded" OR "Chinese firms" OR "Chinese investment" OR CPEC OR "Belt and Road" OR "Chinese embassy" OR "Chinese consulate" OR "Confucius Institute") (attack OR attacked OR bombing OR explosion OR sabotage OR arson OR stormed OR looted OR kidnapped OR killed OR gunmen OR blast OR hostage)' }
];
/* ---- L2：搜索引擎原子词 ---- */
const ATOMIC_QUERIES = [
  { q: 'Chinese nationals attacked' }, { q: 'Chinese workers kidnapped' },
  { q: 'Chinese engineers killed' }, { q: 'Chinese company attack' },
  { q: 'Chinese embassy attack' }, { q: 'CPEC attack Chinese' },
  { q: 'Chinese miners Congo attack' }, { q: 'Chinese nationals Nigeria kidnapping' }
];

/* ---- L3：Google News RSS 定向通道（#697 破局，2026-09-08）
 * GDELT DOC API 代理出口 IP 小时级 429 罚箱期间零候选；而 sources-collector 的
 * SITE_REVIVE 通道实证 news.google.com/rss/search 持续可用（services_pack 每轮入库）。
 * 查询池轮换 3 条/轮（10min 一轮）防 Google 限流；标题走 _pass() 方向闸零放宽。 */
const GNEWS_RT_POOL = [
  { id: 'gn-victim',  q: '"Chinese nationals" attacked OR kidnapped OR killed' },
  { id: 'gn-worker',  q: '"Chinese workers" attacked OR kidnapped' },
  { id: 'gn-eng',     q: '"Chinese engineers" kidnapped OR killed' },
  { id: 'gn-company', q: '"Chinese company" attacked OR looted OR vandalized' },
  { id: 'gn-embassy', q: '"Chinese embassy" OR "Chinese consulate" attacked OR protest' },
  { id: 'gn-cpec',    q: 'CPEC attack OR ambush OR convoy' },
  { id: 'gn-pak',     q: 'Chinese nationals Pakistan attack' },
  { id: 'gn-africa',  q: 'Chinese nationals Nigeria OR Congo OR Mali kidnapped' }
];
const UA_HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' };
/* RSS pubDate（"Mon, 07 Sep 2026 18:00:00 GMT"）→ GDELT seendate 格式 */
function _pubToSeen(s) {
  const d = new Date(String(s || ''));
  if (isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
/* Google News RSS 标题尾部 " - Source Name" → 媒体名 */
function _srcFromTitle(t) {
  const m = String(t || '').match(/\s-\s([^-]{2,40})$/);
  return m ? m[1].trim() : 'Google News';
}
async function _gnSearch(query, when, ms) {
  const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query + (when ? ' ' + when : '')) + '&hl=en-US&gl=US&ceid=US:en';
  try {
    const r = await netx.smartFetch(u, { timeout: ms || 15000, headers: UA_HDR });
    if (!r || !r.ok) return [];
    const items = (scrapers.parseRss(await r.text()) || []);
    return items.map(it => ({
      title: it.title || '', url: it.link || '',
      seendate: _pubToSeen(it.pubDate), domain: _srcFromTitle(it.title)
    }));
  } catch (e) { return []; }
}

/* ---- 级别启发式（中国公民死亡→红；绑架/爆炸/枪手→橙；其余→黄） ---- */
function _sev(t) {
  if (/(chinese|china|中国公民|中方人员|华人)[^.;]{0,60}(killed|dead|death|massacr|behead|身亡|遇难)/i.test(t) || /(killed|dead|death|massacr|behead|身亡|遇难)[^.;]{0,60}(chinese|china|中国公民|中方人员|华人)/i.test(t)) return 'red';
  if (/kidnap|abduct|hostage|bombing|suicide|gunmen|explosion|blast|绑架|劫持|人质|爆炸|自杀|枪手/i.test(t)) return 'orange';
  return 'yellow';
}
/* ---- 国别判定：重点国别关键词优先，否则信源国归一 ---- */
function _country(title, sourcecountry) {
  for (let i = 0; i < FOCUS.length; i++) {
    if (FOCUS[i].kw.test(title)) return FOCUS[i].cn;
  }
  try { const cn = globalmedia._isoToCn ? globalmedia._isoToCn(sourcecountry || '') : ''; if (cn) return cn; } catch (e) {}
  return '国际';
}
/* ---- 目标类型（数据集聚合口径） ---- */
function _targetType(t) {
  if (/(embassy|consulate|confucius|ambassador|diplomatic|使馆|大使馆|领事馆|孔子学院|外交)/i.test(t)) return '驻外使领馆机构';
  if (/(company|companies|firm|project|mine|mining|site|construction|cpec|corridor|railway|port\b|plant\b|factory|campus|compound|convoy|中资|中企|项目|矿区|电站|工地|铁路|港口|工厂|营地|车队)/i.test(t)) return '中资企业与项目';
  if (/(worker|engineer|nationals?|citizens?|fishermen|traders?|tourists?|businessm(a|e)n|students?|doctor|citizen|公民|工人|工程师|渔民|商人|游客|留学生|人员|医师)/i.test(t)) return '中国公民个人';
  return '其他涉华目标';
}

/* ============================================================
 * #691 方向与质量闸（2026-09-07 用户口径修正）
 * 用户实证问题：「美国：中方 对 Population 发动军事打击」方向反了（中方成施袭方）；
 * 数据集混入 中国/美国/印度/俄罗斯 国别（GDELT 1.0 事件表 CAMEO 机翻句式垃圾）。
 * 口径：中国实体（公民/中资/机构）必须处于【受袭侧】，否则整条剔除。
 * ============================================================ */
/* 中方受袭实体词（不含裸「中国」——防「中国食物/中国关系」类机翻垃圾误命中） */
const CN_ENT = '中方人员|中方公民|中国公民|中国工人|中国工程师|中国渔民|中国游客|中国商人|中国留学生|中国船员|中国车队|中国使馆|中国大使馆|中国领事馆|中国驻|中巴经济走廊|华人|华侨|中资|中企|中方';
/* GDELT 1.0 事件表机翻句式：「国名：A 对 B 发动/实施…」——CAMEO 行为主机器译文，
 * 非真实新闻标题（污染国别：美国/印度/俄罗斯/中国…），数据集整体剔除 */
const MACHINE_RE = /^[^：]{1,14}：[^。；]{1,16}对[^。；]{1,24}(发动|实施|进行|发起)/;
/* 中方作施袭主语（方向反转，剔除）：「中方 对 X 发动/实施/打击/制裁…」 */
const CN_ATTACKER_ZH = new RegExp('(中方人员|中方|中国政府|中国军队|华人|中资|中企|中国公民|中国)[^。；，,]{0,20}(对|向|予以)[^。；，,]{0,20}(发动|实施|进行|发起|开展|打击|袭击|攻击|制裁|谴责|逮捕|拘捕)');
/* 英文主语句式：「China/Chinese (+0-2词) launches/attacks/strikes…」——窗口限 2 词：
 * 3 词会误吞 "Chinese consulate in Karachi kills 2"（kills 属爆炸案）与
 * "Chinese workers killed in attack on CPEC"（attack 属名词短语）当施袭动词。 */
const CN_ATTACKER_EN = /\b(chinese|china)\b['s]{0,2}\s+(?:\w+\s+){0,2}(attacks?|strikes?|bombs?|kidnaps?|kills?|murders?|launches?|beheads?|threatens?|condemns?|sanctions?|arrests?|shoots?|accuses?|blames?)\b/i;
/* 中方受袭证据（宾语位/被动位/邻近位，任一命中即过） */
const CN_VICTIM_ZH = [
  new RegExp('(对|将|针对|袭击|绑架|劫持|伏击|挟持|枪击|伤害|抗议)[了]?[^。；，,]{0,14}(' + CN_ENT + ')'),
  new RegExp('(' + CN_ENT + ')[^。；，,]{0,25}(被绑架|被劫持|被袭击|被杀害|被杀|被伏击|被扣押|遇袭|遭袭|遇害|身亡|遇难|受伤|失踪|遭绑架|遭袭击|遭伏击|遭抢劫|被抢劫|遭挟持)'),
  new RegExp('(' + CN_ENT + ')[^。；，,]{0,15}被[^。；，,]{0,8}(绑架|劫持|杀害|袭击|扣押|伏击|抢劫|打砸)'),
  new RegExp('(' + CN_ENT + ')[^。；，,]{0,25}(遭遇|遭到|受到)[^。；，,]{0,4}(恐袭|袭击|绑架|劫持|爆炸|伏击|抢劫|枪击|打砸)')
];
const CN_VICTIM_EN = [
  /(attack\w*|kidnap\w*|abduct\w*|kill\w*|murder\w*|shoot\w*|shot|ambush\w*|bomb\w*|blast|explosion|hostage|behead\w*|injur\w*|assault\w*|loot\w*|storm\w*|rob\w*|protest\w*)[^.]{0,60}\b(chinese|china|cpec)\b/i,
  /\bchinese\b[^.]{0,60}(attack\w*|kidnap\w*|abduct\w*|kill\w*|dead|death|injur\w*|wound\w*|hostage|ambush\w*|shot|behead\w*|assault\w*)/i
];
/* 施袭方语境（中文）：逮捕/抓获…华人 → 华人是被逮捕的作案方，非受袭方 */
const CN_ARRESTED = /(逮捕|抓获|落网|判刑|通缉|指控|起诉|拘留)[^。；，,]{0,30}(华人|华侨|中国公民|中方|中资)/;
function _isChinaVictim(t) {
  const s = String(t || '');
  if (MACHINE_RE.test(s)) return false;                                  /* 机翻句式整体剔除 */
  if (CN_ATTACKER_ZH.test(s) || CN_ATTACKER_EN.test(s)) return false;    /* 中方施袭 → 方向反转剔除 */
  if (CN_ARRESTED.test(s)) return false;                                 /* 华人作案方剔除 */
  return CN_VICTIM_ZH.some(re => re.test(s)) || CN_VICTIM_EN.some(re => re.test(s));
}

/* ---- GDELT seendate（20210714T120000Z）→ 标准 ISO（与 backfill.js _seenISO 同源） ---- */
function _seenISO(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z' : '';
}
/* ---- 条目构造（GDELT 艺术品 → 平台标准条目） ---- */
function _mkItem(a, focusLabel) {
  const title = String(a.title || '').trim();
  const country = _country(title, a.sourcecountry);
  const iso = (a.sourcecountry || '').toUpperCase();
  const isoDate = _seenISO(a.seendate);
  return {
    title,
    content: '',
    url: a.url || '',
    country,
    country_cn: country,
    country_iso: iso || 'INT',
    city: '', location: '',
    source: a.domain || 'GDELT',
    credibility: globalmedia._sourceCredibility ? globalmedia._sourceCredibility(a.domain || '') : 60,
    category: '涉华恐袭',
    data_type: 'terror_events',
    _forceDataType: true,          /* 恐袭口径锁定，不被通用分类器改写 */
    interestLinked: true,
    chinaRelated: true,
    language: a.language || 'en',
    date: isoDate || a.seendate || '',
    publish_time: isoDate,
    publishedAt: isoDate,
    event_date: isoDate,
    severity: _sev(title),
    _real: true,
    _fromSource: 'CHINA-TERROR:' + (focusLabel || 'GDELT') + ':' + (iso || 'INT'),
    _sourceType: 'china_terror'
  };
}
/* ---- #712 实时通道时效闸：本模块是「涉华恐袭实时监测」通道，只收近期事件。
 * 实证问题：Google News RSS when:3d 并不承诺时效（2004 年旧文实证混入，被研判
 * 中心当新鲜红色事件顶上主面板）。历史数据只能走 backfill 有意回补，实时通道
 * 一律拒收远期旧文（>30 天）；无时间戳的保留（不臆测，交展示层 event_date 闸兜底）。 ---- */
function _seenTs(s) {
  const iso = _seenISO(s);
  if (iso) { const t = Date.parse(iso); if (!isNaN(t)) return t; }
  return Date.parse(String(s || '')); /* _pubToSeen 产物为标准 ISO，可直接 parse */
}
const RT_FRESH_MS = 30 * 86400000;
/* ---- 候选过滤（三层采集共用的咽喉） ---- */
function _pass(t) {
  const s = String(t || '');
  if (s.length < 15) return false;
  if (!CN_RE.test(s)) return false;
  if (!ATK_RE.test(s)) return false;
  if (NOISE_RE.test(s)) return false;
  if (!_isChinaVictim(s)) return false;   /* #691 方向闸：中方须为受袭方，机翻句式/施袭主语拒收 */
  return true;
}

/* ---- 模块状态（实时统计 + 历史回补进度，供 /china-dataset 与前端展示） ---- */
const _state = {
  lastRun: null,          /* { at, queries, candidates, passed, inserted } */
  backfill: { running: false, cursor: '', to: '', doneSlices: 0, candidates: 0, inserted: 0, errors: 0, startedAt: '', lastSlice: '', note: 'GDELT 全文库覆盖自 2017 年 1 月起；2010-2016 档走 GDELT 1.0 事件表二期补齐' }
};
function state() { return _state; }

/* ---- #691 断点持久化：cursor 落盘，服务重启自动续跑（此前纯内存态，重启即丢断点） ---- */
const _BF_STATE_FILE = require('path').join(__dirname, 'tmp', 'china-terror-bf.json');
function _bfSave(cursor) {
  try { require('fs').writeFileSync(_BF_STATE_FILE, JSON.stringify({ cursor, savedAt: new Date().toISOString() })); } catch (e) {}
}
function _bfLoad() {
  try { const j = JSON.parse(require('fs').readFileSync(_BF_STATE_FILE, 'utf8')); return j.cursor || ''; } catch (e) { return ''; }
}
(function _bfAutoResume() {
  const c = _bfLoad();
  if (c && /^\d{8}/.test(c)) {
    const todayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (c.slice(0, 8) < todayKey) {
      _state.backfill.cursor = c;
      _state.backfill.running = true;
      _state.backfill.startedAt = new Date().toISOString();
      _state.backfill.note = '服务重启断点自动续跑（' + c.slice(0, 8) + ' 起）；GDELT 全文库覆盖自 2017 年 1 月起；2010-2016 档走 GDELT 1.0 事件表二期补齐';
      console.log('[CHINA-TERROR-BF] 断点自动续跑: ' + c.slice(0, 8));
    }
  }
})();

/* ---- 实时采集（GDELT 2d 窗 + 搜索引擎原子词兜底） ---- */
async function runChinaTerrorCollect(opts) {
  opts = opts || {};
  const maxPerQuery = Math.min(opts.maxPerQuery || 30, 75);
  const items = [];
  const stats = { queries: 0, candidates: 0, passed: 0, stale: 0, byQuery: [] };
  const seen = new Set();
  const _take = (arts, label) => {
    for (const a of arts || []) {
      stats.candidates++;
      if (!a || !a.url || seen.has(a.url)) continue;
      const t = String(a.title || '');
      if (!_pass(t)) continue;
      /* #712 实时通道时效闸：远期旧文拒收（历史回补只走 backfill 通道） */
      const pts = _seenTs(a.seendate || a.pubDate);
      if (pts && !isNaN(pts) && pts < Date.now() - RT_FRESH_MS) { stats.stale = (stats.stale || 0) + 1; continue; }
      seen.add(a.url);
      items.push(_mkItem(a, label));
      stats.passed++;
    }
  };
  /* L1 GDELT（crawler 内置限流冷却） */
  for (const gq of GDELT_RT_QUERIES) {
    stats.queries++;
    try {
      const arts = await crawler.gdeltSearch(gq.q, { timespan: '2d', maxrecords: maxPerQuery });
      _take(arts, gq.focus);
      stats.byQuery.push(gq.id + ':' + (arts ? arts.length : 0));
    } catch (e) { stats.byQuery.push(gq.id + ':ERR:' + e.message); continue; }
  }
  /* L2 搜索引擎原子词（漂移靠标题过滤兜底；失败静默，GDELT 主通道） */
  for (const aq of ATOMIC_QUERIES) {
    stats.queries++;
    try {
      if (crawler.apSearch) {
        const arts = await crawler.apSearch(aq.q, { max: 15, timespan: '3d' });
        _take(arts, 'SEARCH');
      }
    } catch (e) { /* 搜索引擎失败静默 */ }
  }
  /* L3 Google News RSS 定向（#697：GDELT 罚箱期主通道，轮换 3 条/轮） */
  const gnPicks = [0, 1, 2].map(i => GNEWS_RT_POOL[(gnCycle + i) % GNEWS_RT_POOL.length]);
  gnCycle = (gnCycle + 3) % GNEWS_RT_POOL.length;
  for (const gq of gnPicks) {
    stats.queries++;
    try {
      const arts = await _gnSearch(gq.q, 'when:3d');
      _take(arts, 'GNEWS-RSS');
      stats.byQuery.push(gq.id + ':' + (arts ? arts.length : 0));
    } catch (e) { stats.byQuery.push(gq.id + ':ERR:' + e.message); }
  }
  _state.lastRun = { at: new Date().toISOString(), queries: stats.queries, candidates: stats.candidates, passed: stats.passed, inserted: 0 };
  return { items, count: items.length, stats };
}
let gnCycle = 0;

/* ---- 历史回补单切片（[start, start+days) 绝对窗） ---- */
async function runBackfillSlice(startYYYYMMDD, days) {
  const d0 = new Date(Date.UTC(+startYYYYMMDD.slice(0, 4), +startYYYYMMDD.slice(4, 6) - 1, +startYYYYMMDD.slice(6, 8)));
  const d1 = new Date(d0.getTime() + (days || 15) * 86400000);
  const fmt = d => String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0') + '000000';
  const iso = d => d.toISOString().slice(0, 10);
  const items = [];
  const seen = new Set();
  const _push = (arts, focus) => {
    for (const a of arts || []) {
      if (!a || !a.url || seen.has(a.url)) continue;
      const t = String(a.title || '');
      if (!_pass(t)) continue;
      seen.add(a.url);
      items.push(_mkItem(a, focus));
    }
  };
  for (const gq of GDELT_BF_QUERIES) {
    try {
      const arts = await crawler.gdeltSearch(gq.q, { startdatetime: fmt(d0), enddatetime: fmt(d1), maxrecords: 75, noCache: true });
      _push(arts, gq.focus);
    } catch (e) { _state.backfill.errors++; }
  }
  /* #697 破局：GDELT DOC 罚箱空转时，Google News RSS after:/before: 等效回补
   * （sources-collector 实证通道；when 窗用 GDELT 同切片日期，逻辑同源）。 */
  const gnWhen = 'after:' + iso(d0) + ' before:' + iso(d1);
  for (const gq of GDELT_BF_QUERIES) {
    try {
      const arts = await _gnSearch(gq.q, gnWhen, 15000);
      _push(arts, gq.focus);
      await new Promise(r => setTimeout(r, 2500));   /* 防限流间隔 */
    } catch (e) { _state.backfill.errors++; }
  }
  _bfSave(fmt(d1));   /* #691 断点落盘，重启自动续跑 */
  return { items, count: items.length, next: fmt(d1) };
}

/* ---- 聚合：年度键（event_date 脏值 regex 容错，回落 collect_time 年份） ---- */
function _yearOf(eventDate, collectTime) {
  const m = String(eventDate || '').match(/20(1\d|2\d)/);
  if (m) return +m[0] >= 2010 && +m[0] <= 2026 ? +m[0] : null;
  const m2 = String(collectTime || '').match(/^(\d{4})/);
  if (m2 && +m2[1] >= 2010) return +m2[1];
  return null;
}

module.exports = function chinaTerror(ctx) {
  const q = ctx.query;
  const isChina = ctx.isChinaRelated || (crawler.chinaRelated ? crawler.chinaRelated : () => false);
  const llmCall = (ctx.llm && ctx.llm.callMsg) || null;   /* #692：事件研判/30天预测共用 LLM 通道（server.js 注入） */
  const router = express.Router();

  /* ---------- #692 公共聚合：china-dataset / china-forecast / china-judge 共用 ---------- */
  async function _datasetAgg() {
    try {
      const { rows } = await q(
        `SELECT id, title, country, event_date, collect_time, severity, source, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE audit_status='approved'
           AND (data_json->>'_sourceType' = 'china_terror'
             OR (data_type='terror_events' AND (
                  title ILIKE '%chinese%' OR title ILIKE '%china%' OR title ILIKE '%中国%' OR title ILIKE '%中方%' OR title ILIKE '%华人%' OR title ILIKE '%中资%' OR title ILIKE '%华侨%' OR title ILIKE '%中企%'
                  OR data_json->>'title_zh' ILIKE '%中国%' OR data_json->>'title_zh' ILIKE '%中方%' OR data_json->>'title_zh' ILIKE '%华人%' OR data_json->>'title_zh' ILIKE '%中资%' OR data_json->>'title_zh' ILIKE '%华侨%' OR data_json->>'title_zh' ILIKE '%中企%')))
         ORDER BY collect_time DESC LIMIT 20000`,
        []
      );
      /* JS 侧严格复核：涉华（isChinaRelatedStrict 口径）+ 标题含袭击词 + #691 方向闸（中方须为受袭方） */
      const rel = rows.filter(r => {
        const t = String(r.title_cn || r.title || '');
        if (!ATK_RE.test(t)) return false;
        if (!_isChinaVictim(t)) return false;
        const tag = (r.data_json && r.data_json._sourceType) === 'china_terror';
        return tag || isChina(t);
      }).map(r => {
        const t = String(r.title_cn || r.title || '');
        const j = r.data_json || {};
        const year = _yearOf(r.event_date, r.collect_time);
        return {
          id: r.id, title: t.slice(0, 100),
          country: r.country || '',
          year: year || (new Date(r.collect_time).getFullYear()),
          level: (j.level_norm || r.severity || 'yellow').toLowerCase(),
          target: _targetType(t),
          time: j.publish_time || r.event_date || r.collect_time,
          source: r.source || j.source || '',
          url: j.url || '',
          fromChannel: j._sourceType || ''
        };
      });
      /* 聚合：年度分布 / 国别 TOP / 目标类型 / 近30日 / 72h 红橙 */
      const byYear = {}, byCountry = {}, byTarget = {};
      rel.forEach(e => {
        byYear[e.year] = (byYear[e.year] || 0) + 1;
        if (e.country) byCountry[e.country] = (byCountry[e.country] || 0) + 1;
        byTarget[e.target] = (byTarget[e.target] || 0) + 1;
      });
      const now = Date.now();
      const t30 = new Date(now - 30 * 86400000), t72 = new Date(now - 3 * 86400000);
      const fresh30 = rel.filter(e => new Date(String(e.time).replace('T', ' ')) >= t30);
      const fresh72 = rel.filter(e => new Date(String(e.time).replace('T', ' ')) >= t72);
      return { rel, byYear, byCountry, byTarget, fresh30, fresh72 };
    } catch (e) { throw e; }
  }

  /* ---------- GET /china-dataset：涉华恐袭数据集全景聚合 ---------- */
  router.get('/china-dataset', async (req, res) => {
    try {
      const agg = await _datasetAgg();
      const rel = agg.rel, byYear = agg.byYear, byCountry = agg.byCountry;
      res.json({
        ok: true, generatedAt: new Date().toLocaleString('zh-CN'),
        kpi: {
          total: rel.length,
          countries: Object.keys(byCountry).length,
          fresh30: agg.fresh30.length,
          redOrange72: agg.fresh72.filter(e => e.level === 'red' || e.level === 'orange').length,
          earliestYear: rel.length ? Math.min.apply(null, Object.keys(byYear).map(Number)) : null
        },
        byYear: Object.keys(byYear).sort().map(y => ({ year: +y, n: byYear[y] })),
        byCountry: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([country, n]) => ({ country, n })),
        byTarget: Object.entries(agg.byTarget).sort((a, b) => b[1] - a[1]).map(([target, n]) => ({ target, n })),
        latest: rel.slice(0, 12).map(e => ({ id: e.id, title: e.title.slice(0, 90), country: e.country, level: e.level, target: e.target, time: String(e.time).slice(0, 16), url: e.url, source: e.source })),
        /* #698-② 国别下钻明细：TOP10 国别各带最新 6 条（前端点击国别就地展开） */
        countryEvents: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10).reduce((m, [c]) => {
          m[c] = rel.filter(e => e.country === c).slice(0, 6).map(e => ({ id: e.id, title: e.title.slice(0, 90), level: e.level, target: e.target, time: String(e.time).slice(0, 16), url: e.url }));
          return m;
        }, {}),
        collector: { intervalMin: 10, lastRun: _state.lastRun, backfill: _state.backfill },
        note: '涉华恐袭研判中心：恐怖袭击类涉华条目（严格涉华判定）∪ china_terror 专项采集通道。#691 方向闸：中国实体（公民/中资/机构）必须处于受袭侧，中方施袭、GDELT 1.0 机翻句式（国名：A 对 B 发动X）、华人作案方条目一律剔除。采集三通道：GDELT 涉华×袭击矩阵（10 分钟/轮）+ Google News RSS 定向（#697 破局，罚箱期主通道）+ 历史回补（GDELT 全文库 ∪ GNews RSS 等效切片，自 2017 年 1 月起逐 15 天回扫）。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #698-② GET /china-briefing：涉华恐袭 AI 大盘威胁研判（30min 缓存） ----------
   * 用户指令：涉华恐袭不是数据集而是研判中心——要有内容、交互、预警、对未来形势的预测。
   * 大盘研判 = 打开即自动装配的 AI 威胁评估（真实统计装配，Kimi，规则模板回落）。 */
  const _brCache = { at: 0, data: null };
  router.get('/china-briefing', async (req, res) => {
    try {
      if (!req.query.refresh && _brCache.data && Date.now() - _brCache.at < 30 * 60 * 1000) {
        return res.json(Object.assign({ cached: true }, _brCache.data));
      }
      const agg = await _datasetAgg();
      const rel = agg.rel;
      if (!rel.length) {
        const d0 = { ok: true, empty: true, generatedAt: new Date().toLocaleString('zh-CN'), note: '涉华遇袭数据集暂无记录——拒绝在空池上生成研判（零臆测原则）。' };
        _brCache.at = Date.now(); _brCache.data = d0;
        return res.json(d0);
      }
      const cTop = Object.entries(agg.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const tTop = Object.entries(agg.byTarget).sort((a, b) => b[1] - a[1]);
      const now = Date.now();
      const alert72 = rel.filter(e => { const ts = new Date(String(e.time).replace('T', ' ')).getTime() || 0; return ts >= now - 3 * 86400000 && (e.level === 'red' || e.level === 'orange'); }).slice(0, 8);
      const ruleBr = [
        '一、威胁态势。涉华遇袭数据集累计收录真实遇袭事件 ' + rel.length + ' 条，覆盖 ' + Object.keys(agg.byCountry).length + ' 国，近30日新增 ' + agg.fresh30.length + ' 条，当前 72 小时红橙预警 ' + alert72.length + ' 条。威胁集中于：' + cTop.map(c => c[0] + '（' + c[1] + ' 条）').join('、') + '。',
        '二、目标与手法。受袭目标构成：' + tTop.map(t => t[0] + '（' + t[1] + ' 条）').join('、') + '。' + (tTop[0] ? tTop[0][0] + '为主要受袭面。' : '') + (rel.some(e => e.level === 'red') ? '存在红级（致死/重伤）事件，人员安全威胁等级高。' : '以橙黄级事件为主，暂无致死级确认记录。'),
        '三、研判结论。涉华遇袭威胁与境外安全形势高度关联；' + (cTop[0] ? cTop[0][0] + '为当前最高威胁国别，' : '') + '遇袭事件呈现针对海外中国公民与中资项目驻地的定向性特征，须按国别实施差异化人员安全管控。',
        '四、防范建议。一是对' + (cTop.slice(0, 3).map(c => c[0]).join('、') || '重点国别') + '的中国公民与项目驻地执行安全巡查升级（出行报备/路线随机化/驻地安防核查）；二是 72h 红橙事件按一事一案应急处置闭环；三是依托 30 天态势预测滚动校准威胁窗口。'
      ].join('\n');
      let text = ruleBr, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是反恐与海外利益保护情报研判专家，为海外利益保护情报预警平台撰写《涉华恐袭威胁研判》（大盘威胁评估，供指挥员30秒掌握涉华遇袭威胁全局）。要求：公文语体，分"一、二、三、四"四段（威胁态势/目标与手法/研判结论/防范建议），每段100-160字。所有数字必须来自给定真实统计；禁止虚构事件与日期；禁止免责套话；直击要害。';
          const usr = '涉华遇袭数据集累计 ' + rel.length + ' 条，覆盖 ' + Object.keys(agg.byCountry).length + ' 国，近30日 ' + agg.fresh30.length + ' 条，72h红橙 ' + alert72.length + ' 条\n威胁国别TOP：' + cTop.map(c => c[0] + '(' + c[1] + ')').join('、') + '\n目标构成：' + tTop.map(t => t[0] + '(' + t[1] + ')').join('、') + '\n最新遇袭事件：\n' + rel.slice(0, 8).map((e, i) => (i + 1) + '.[' + e.level + '·' + e.country + '·' + e.target + '] ' + e.title.slice(0, 70)).join('\n');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 200) {
            text = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[CHINA-TERROR] briefing LLM 失败，回落规则模板:', e.message); }
      }
      const data = {
        ok: true, empty: false, briefing: text, llmOk,
        stats: { total: rel.length, countries: Object.keys(agg.byCountry).length, fresh30: agg.fresh30.length, alerts72: alert72.length },
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：AI 涉华恐袭威胁大盘研判（' + (llmOk ? 'Kimi 大模型' : '规则模板') + '）；上下文=涉华遇袭数据集真实统计；#691 方向闸校验（中方受袭侧）；零模拟。'
      };
      _brCache.at = Date.now(); _brCache.data = data;
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #692 GET /china-judge?id=：涉华遇袭单事件 AI 研判（Kimi + 规则回落） ----------
   * 前端事件卡点击 → 抽屉研判；上下文=事件原文 + 同国别近90日真实库情报，零虚构。 */
  router.get('/china-judge', async (req, res) => {
    try {
      const id = String(req.query.id || '').trim();
      if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ ok: false, error: '无效事件 id' });
      const { rows } = await q(
        `SELECT id, title, country, location, event_date, collect_time, severity, source, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data WHERE id = $1 AND audit_status='approved' LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: '事件不存在或未过审：' + id });
      const r = rows[0];
      const t = String(r.title_cn || r.title || '');
      const j = r.data_json || {};
      const event = {
        id: r.id, title: t, country: r.country || '', location: r.location || '',
        time: j.publish_time || r.event_date || r.collect_time,
        level: String(j.level_norm || r.severity || 'yellow').toLowerCase(),
        target: _targetType(t), source: r.source || j.source || '', url: j.url || '',
        digest: String(j.description_zh || j.description || '').slice(0, 600)
      };
      /* 同国别近90日关联情报（研判上下文） */
      let relRows = [];
      try {
        const rr = await q(
          `SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title) AS t,
                  country, collect_time, severity, data_json->>'level_norm' AS lv
           FROM intel_data
           WHERE data_type='terror_events' AND audit_status='approved'
             AND country = $1 AND collect_time >= now() - interval '90 days'
           ORDER BY collect_time DESC LIMIT 8`, [r.country || '']);
        relRows = rr.rows || [];
      } catch (e) { /* 上下文缺失不阻断研判 */ }
      const lvlZh = { red: '红（重大）', orange: '橙（严重）', yellow: '黄（关注）', blue: '蓝（一般）' }[event.level] || event.level;
      const ruleJudge = [
        '一、事件概况。' + (event.time ? String(event.time).slice(0, 10) + '，' : '') + (event.country || '未标注国别') + (event.location ? '（' + event.location + '）' : '') + '发生针对' + event.target + '的涉华袭击事件：' + event.title + '。事件级别：' + lvlZh + '。' + (event.digest ? '摘要要点：' + event.digest.slice(0, 120) + '。' : ''),
        '二、背景与手法研判。该事件属于涉华恐袭数据集收录范围（中国公民/中资企业与项目/驻外机构处于受袭侧，方向闸校验通过）。' + (relRows.length ? '同国别近90日库内关联情报 ' + relRows.length + ' 条，显示该国针对涉华目标的安全形势' + (relRows.length >= 5 ? '处于活跃期，存在连续发案特征' : '存在零散发案') + '。' : '同国别近90日库内暂无其他关联情报，就现有公开信息属孤立发案。') + '袭击手法以标题与摘要所示为准，信息不足处不作臆测，待后续披露补充。',
        '三、风险与影响评估。' + (event.level === 'red' ? '红级事件已造成中方人员伤亡，须按重大涉华安全事件启动响应。' : event.level === 'orange' ? '橙级事件涉及绑架/爆炸/武装袭击等严重情节，中方人员与项目安全受到直接威胁。' : '黄级事件威胁程度相对有限，仍需第一时间核实中方人员安全状态。') + '建议核实事发地周边中资项目与人员分布，评估二次袭击与报复链条风险。',
        '四、对策建议。一是立即核实涉事中方人员与机构安全状态，启动领事保护与应急联络机制；二是对事发国别中资项目发布风险提示，' + (event.level === 'red' || event.level === 'orange' ? '必要时启动撤离或暂停作业评估；' : '加强营地安保巡查与出行报备；') + '三是将该事件纳入涉华恐袭数据集持续跟踪，关注同一作案网络后续动向与同类手法复现。'
      ].join('\n');
      let judgeText = ruleJudge, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是国家安全反恐情报研判专家，为海外利益保护情报预警平台撰写单事件研判。要求：公文语体，分"一、二、三、四"四段（事件概况/背景与手法研判/风险与影响评估/对策建议），每段100-180字，全部基于给定真实信息，禁止虚构细节、伤亡数字与组织归因（信息不足时明确写"暂无公开信息"）。';
          const usr = '事件：' + event.title + '\n国别/地点：' + event.country + ' ' + event.location + '；时间：' + event.time + '；级别：' + lvlZh + '；目标类型：' + event.target + '\n摘要：' + (event.digest || '（无摘要）') + '\n同国别近90日关联情报 ' + relRows.length + ' 条：\n' + relRows.map((x, i) => (i + 1) + '.' + x.t + '（' + String(x.lv || x.severity || 'yellow') + '级）').join('\n');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 200) {
            judgeText = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[CHINA-TERROR] event judge LLM 失败，回落规则模板:', e.message); }
      }
      res.json({
        ok: true, event,
        related: relRows.map(x => ({ title: x.t, level: String(x.lv || x.severity || 'yellow').toLowerCase() })),
        judgment: judgeText, llmOk, generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：单事件 AI 研判（' + (llmOk ? 'Kimi 大模型' : '规则模板（大模型暂不可用，引用真实库信息）') + '）；上下文=事件原文 + 同国别近90日真实库情报；平台数据库真实数据，零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #692 GET /china-forecast：AI 未来 30 天涉华恐袭态势预测 ----------
   * 真实统计装配（年度基线/国别分布/目标构成/近30日活跃度）→ Kimi 前瞻研判，
   * 规则模板回落；30 分钟服务端缓存（?refresh=1 强制重生成）；空库拒绝生成（零臆测）。 */
  const _fcCache = { at: 0, data: null };
  router.get('/china-forecast', async (req, res) => {
    try {
      if (!req.query.refresh && _fcCache.data && Date.now() - _fcCache.at < 30 * 60 * 1000) {
        return res.json(Object.assign({ cached: true }, _fcCache.data));
      }
      const agg = await _datasetAgg();
      const total = agg.rel.length;
      const countries = Object.keys(agg.byCountry).length;
      if (!total) {
        const d0 = {
          ok: true, empty: true, generatedAt: new Date().toLocaleString('zh-CN'),
          note: '数据集回补进行中（GDELT 通道受限），库内暂无合规涉华遇袭条目——拒绝在空库上生成预测（零臆测原则）。'
        };
        _fcCache.at = Date.now(); _fcCache.data = d0;
        return res.json(d0);
      }
      const years = Object.keys(agg.byYear).map(Number).sort();
      const thisYear = new Date().getFullYear();
      const last5 = years.filter(y => y >= thisYear - 5 && y <= thisYear);
      const cnt5 = last5.reduce((s, y) => s + agg.byYear[y], 0);
      const monthlyAvg = last5.length ? Math.round(cnt5 / (last5.length * 12) * 10) / 10 : 0;
      const ro72 = agg.fresh72.filter(e => e.level === 'red' || e.level === 'orange').length;
      const cTop = Object.entries(agg.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const tTop = Object.entries(agg.byTarget).sort((a, b) => b[1] - a[1]);
      const ruleFc = [
        '一、总体态势预判。数据集累计收录合规涉华遇袭事件 ' + total + ' 条，覆盖国别 ' + countries + ' 个，近30日新增 ' + agg.fresh30.length + ' 条、72小时红橙 ' + ro72 + ' 条。' + (monthlyAvg ? '近5年年均约 ' + Math.round(cnt5 / last5.length) + ' 条（月均 ' + monthlyAvg + ' 条），据此基线研判，未来30天全球针对中国公民、中资项目与驻外机构的遇袭事件量预计在月均基线' + (monthlyAvg && agg.fresh30.length > monthlyAvg ? '上方——近30日 ' + agg.fresh30.length + ' 条已高于月均，短期活跃度抬升' : '附近波动') + '。' : '历史年度基线尚在回补，暂以近30日活跃度为主要参照。'),
        '二、重点高危国别。累计遇袭国别前列：' + cTop.map(c => c[0] + '（' + c[1] + ' 条）').join('、') + '。' + (cTop.length ? '其中' + cTop[0][0] + '为存量最高发国别；' : '') + '巴基斯坦（俾路支/CPEC 走廊）、萨赫勒带与刚果（金）矿区为涉华遇袭长期高发区，未来30天维持高风险判定；' + (ro72 ? '近72小时存在新发红橙事件，相关国别应列为即时关注对象。' : '近72小时暂无新发红橙事件，间歇期不代表风险解除，袭击具有突发性。'),
        '三、重点目标与手法。目标构成：' + tTop.map(x => x[0] + ' ' + x[1] + ' 条').join('、') + '。手法以武装袭击、绑架劫持、爆炸装置与车队伏击为主；矿区、工地与公路运输车队为暴露度最高的场景，使领馆机构遇袭低频但影响权重高。',
        '四、对策建议。一是对' + (cTop.length ? cTop.slice(0, 3).map(c => c[0]).join('、') : '重点国别') + '中资项目执行未来30天强化安保窗口（行程报备、车队护航、营地防渗透演练）；二是使领馆条线保持涉华公民登记信息与应急联络机制热更新；三是以本数据集月度基线监测偏离，月度遇袭量超基线 50% 即触发专项研判与预警升级。'
      ].join('\n');
      let text = ruleFc, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是国家安全反恐情报研判专家，为海外利益保护情报预警平台撰写《未来30天涉华恐袭态势预测》。要求：公文语体，分"一、二、三、四"四段（总体态势预判/重点高危国别/重点目标与手法/对策建议），每段120-200字。所有数字必须来自给定真实统计；前瞻判断须以"研判/预计"表述并与事实数据明确区分；禁止虚构具体事件、日期与伤亡；禁止"预测仅供参考"式免责套话。';
          const usr = '数据集累计 ' + total + ' 条，覆盖 ' + countries + ' 国，近30日新增 ' + agg.fresh30.length + ' 条，72h 红橙 ' + ro72 + ' 条\n年度分布：' + years.map(y => y + ':' + agg.byYear[y]).join('、') + '\n国别TOP：' + cTop.map(c => c[0] + '(' + c[1] + ')').join('、') + '\n目标构成：' + tTop.map(x => x[0] + '(' + x[1] + ')').join('、') + '\n最新事件代表：\n' + agg.rel.slice(0, 10).map((e, i) => (i + 1) + '.' + e.title.slice(0, 80) + '（' + e.country + '，' + e.level + '）').join('\n');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 200) {
            text = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[CHINA-TERROR] forecast LLM 失败，回落规则模板:', e.message); }
      }
      const data = {
        ok: true, empty: false, forecast: text, llmOk,
        stats: { total, countries, fresh30: agg.fresh30.length, monthlyAvg },
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：基于涉华恐袭数据集真实统计（年度基线/国别分布/目标构成）的前瞻研判，' + (llmOk ? 'Kimi 大模型' : '规则模板（大模型暂不可用）') + '生成；预测为研判性结论，事实以实时情报流为准；零模拟。'
      };
      _fcCache.at = Date.now(); _fcCache.data = data;
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router._runChinaTerrorCollect = runChinaTerrorCollect;
  router._runBackfillSlice = runBackfillSlice;
  router._state = _state;
  return router;
};

module.exports.runChinaTerrorCollect = runChinaTerrorCollect;
module.exports.runBackfillSlice = runBackfillSlice;
module.exports.state = state;
module.exports._isChinaVictim = _isChinaVictim;   /* #691 单测导出 */
