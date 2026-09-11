/* ============================================================
 * server/enterprise-risk.js — 涉企风险预警研判（2026-09-08 #698 v2 全风险域重做）
 * ================================================================
 * 用户原话（2026-09-08 04:19）：「不能只是歧视性检查·制裁·管控数据，还有其他的
 *   安全风险预警……既然是涉企风险预警研判，所有风险预警都要包含，想象力」
 *   「要多利用AI大模型」「数据要摘录最核心最重点的，不能是国内的，
 *   跟中国海外利益安全相关的数据」
 *
 * v2 全风险域设计（七域，与事件研判中心「案卷单元」差异化——本区是企业视角全域指挥台）：
 *   ① 管控与制裁（六维细分：出口管制/投资审查/歧视性执法/制裁清单/数字管控/政策突变）
 *   ② 武装冲突波及（战区中资项目/资产）
 *   ③ 恐袭与遇袭（中企人员/项目遇袭——挂 china_terror 专项通道真货）
 *   ④ 社会动荡与治安（排华骚乱/罢工/治安案件）
 *   ⑤ 政局与政策（政权更迭/违约风险/政策转向）
 *   ⑥ 经济与金融（汇兑限制/通胀/金融市场风险）
 *   ⑦ 灾害与设施（海外自然灾害/基础设施中断波及中企）
 * 数据铁律：仅涉华海外利益相关（chinaRelated 严格口径 + 涉华实体词），国别≠中国，
 *   国内事件零收录；GDELT 1.0 机翻 CAMEO 模板句全池拒收；零模拟、零臆测。
 * 端点（router 挂 /api/entrisk）：
 *   GET /overview       七域全景 + 国别压力榜 + 72h 红橙预警流（核心重点数据）
 *   GET /briefing       AI 全球涉企安全风险大盘研判（Kimi，真实统计装配，30min 缓存）
 *   GET /country-judge  单国全风险域 AI 研判（规则模板回落）
 *   GET /forecast       未来30天涉企风险前瞻（LLM + 真实统计装配，30min 缓存）
 * ============================================================ */
'use strict';
const express = require('express');
const netx = require('./netx');
const scrapers = require('./scrapers');
const globalmedia = require('./globalmedia');
const reportsEngine = require('./reports-engine');   /* pvKimi() 取 LLM 供应商 */
const { ENTERPRISES } = require('./ent-assets');     /* #702 ①：35 企资产注册表（服务端 join 底座） */
const RL = require('./risk-level'); /* #724 P0-3：定级读取归一单一来源——与 ai-watch/恐袭/研判中心同源，杜绝功能区口径漂移 */

const UA_HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };

/* ============================================================
 * L3 实采通道（#698：库内 sanctions_data 通道为 GDELT 1.0 机翻模板重灾区，
 * 实测 7429 条粗筛池中 5805 条 CAMEO 模板句；真实涉企管控新闻几乎为零。
 * 与 #697 同破局路：Google News RSS 定向实采，30 分钟一轮轮换 4 查询。）
 * ============================================================ */

/* ============================================================
 * 实战化重设计（2026-09-10 需求一）：从「涉华事件流」升级为「涉企定向风险流」
 * 根因——「最新涉企风险事件」面板曾混入中国公民个人犯罪（绑架案）、正面新闻
 * （一带一路/中企合作）、中方作主语（中国出口管制）、外交讲话（驻法大使发言）、
 * 国内媒体（百度百家号）、GDELT 模板句（"（8 篇报道）"格式）等与中资企业无
 * 直接/间接关系的数据。
 *
 * 核心设计：每事件必须答"影响哪家中资/项目/哪类主体"——四档涉企锚点。
 *   A 企业直击（40）：命中 35 企品牌名/英文名 + 管控/执法动作
 *   B 涉企动作（25）：chinese company/firm/executives + 管控动作
 *   C 人员资产（30）：中资项目/园区/中方员工遇袭/中方人员伤亡
 *   D 经营环境（12）：仅 35 企布局国 × 政局/冲突/灾害重大事件
 * 价值闸：个人犯罪/正面新闻/中方作主语/国内媒体/外交讲话 拒收（不锚定）
 * 影响度评分 = 锚点档 + 动作烈度 + 时效 + 来源可信度（可解释）
 * 排序按影响度（实战化：从「时间流」转为「优先级流」）
 * ================================================================ */

/* 35 企品牌名（中英）→ 命中即 A 档企业直击 */
const ENT_BRANDS_RE = (() => {
  const brands = [
    '华为', '中兴', '海康威视', '海康', '大华', '大疆', 'DJI', 'TikTok', '字节跳动',
    '中石油', 'CNPC', '中石化', 'Sinopec', '中远海运', 'COSCO', '中交建', '中建', '中铁建',
    '中铁', '中地海外', '中地', '中色', '中铝', '中粮', '中核', '中核工', '中核集团',
    '中工国际', '中国电建', '电建', '中国能建', '能建', '中移动', '中国移动', '中通服',
    '中信建设', '中信', '招商局', '招商', '葛洲坝', '中国路桥', '中土', '中纺', '中工',
    '国电', '国家电网', '华能', '中航', '中船', '兵器', '中国五矿', '五矿', '紫金矿业',
    '紫金', '比亚迪', 'BYD', '宁德时代', 'CATL', '联想', 'Lenovo', '小米', 'Xiaomi',
    '中通', '圆通', '顺丰', '菜鸟', '中国银行', '工商银行', '建设银行', '农业银行',
    '中投', '丝路基金', '国开行', '进出口银行'
  ];
  ENTERPRISES.forEach(e => {
    if (e.short && brands.indexOf(e.short) < 0) brands.push(e.short);
    if (e.name && brands.indexOf(e.name) < 0) brands.push(e.name);
  });
  return new RegExp(brands.filter(b => b && b.length >= 2).map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
})();

/* C 档人员资产关键词：中资项目/园区/中方员工/承包商 */
const CN_PROJECT_RE = /中资(项目|园区|企业|公司|员工|人员|工人|高管|承包商|代表团|游客|留学生|侨民)|中方(人员|员工|项目|企业|承包|机构|投资|驻.{0,12}机构|使领)|中国(员工|工人|游客|留学生|承包商|代表团|侨民)|中国工地|中国营地|中国商港|中国油田|中国电站|中国建筑工地|海外(中资|中企)|海外(项目|园区)遇袭|中国央企|中国国企/;

/* 35 企布局国 → D 档经营环境判据 */
const LAYOUT_COUNTRIES = new Set(ENTERPRISES.flatMap(e => e.countries));

/* 价值闸：个人犯罪（中国公民自然人，无企业属性） */
const PERSONAL_CRIME_RE = /中国公民.{0,20}(绑架|贩毒|诈骗|谋杀|洗钱|抢劫|凶杀|非法(务工|滞留|居留|入境)|涉黄|涉赌|被判)|中国(国民|游客|学生|工人).{0,15}(绑架|杀害|抢劫|性侵)|绑架|赎金|贩毒|凶杀|谋杀|非法(务工|滞留|居留|入境)|涉黄|涉赌/;

/* 价值闸：国内媒体源（境内媒体视角非境外风险情报） */
const DOMESTIC_MEDIA_DOMAINS = [
  'baijiahao.baidu.com', 'baijiahao.com', 'sina.com.cn', 'sina.cn', 'qq.com',
  'sohu.com', '163.com', 'chinanews.com', 'chinanews.com.cn', 'people.com.cn',
  'xinhuanet.com', 'news.cn', 'thepaper.cn', 'huanqiu.com', 'guancha.cn',
  'ifeng.com', 'cankaoxiaoxi.com', 'cnstock.com', 'stcn.com', 'cnfol.com',
  '21jingji.com', 'yicai.com', 'jiemian.com', 'wallstreetcn.com',
  'pconline.com.cn', 'zol.com.cn', 'bjnews.com.cn', 'ynet.com',
  'takungpao.com', 'wenweipo.com', 'chinatimes.com'
];

/* 价值闸：低质/UGC 来源（论坛/聚合站） */
const LOW_CRED_SOURCES = ['lemmy', 'reddit', 'twitter', 'facebook', 'youtube', 'tiktok', '微博', '知乎'];

/* 价值闸：外交讲话/发言人/使馆动态（非企业风险） */
const DIPLOMATIC_RE = /(驻.{1,12}大使|外交部(发言人|发言|记者会)|使馆(发布|通报|公告)|领事(提醒|保护|馆|发布会)|中国(驻.{1,12})?(大使|领事)|.{1,12}驻华大使|.{1,12}驻华(领事|代表)|.{1,12}大使.{0,8}(访问|会见|出席|举行|表示|称|说)|.{1,12}外长.{0,8}(访问|会见|通话|会晤))/;

/* 价值闸：正面/中性合作新闻 */
const POSITIVE_NEWS_RE = /(合作|拥抱|对话|高峰会|达成|签署|积极|正面|顺利|加强(对话|合作)|深化合作|共赢|互利|友好|战略伙伴|看好|赞许|欢迎)[\s\S]{0,15}(中国|中企|中方|华企)|中国(企业|公司|代表团).{0,12}(亮相|展示|参展|发布|签约|达成|出席)|一带一路.{0,8}(峰会|论坛|成果|合作)|海外(扩张|布局|拓展).{0,8}(中国|中企)/;

/* 动作烈度（与管控/执法动作词映射分值） */
const ACTION_SCORE = [
  { re: /(detain|arrest|raided|dawn raid|seiz|羁押|拘捕|扣押|突击检查|逮捕|被拘留|被拘押|失踪)/i, v: 30, name: '人员执法/羁押' },
  { re: /(entity list|export control|sanction|blacklist|实体清单|出口管制|制裁|黑名单|禁令|delist|除牌|摘牌|封禁|封杀|禁用)/i, v: 22, name: '制裁清单/出口管制' },
  { re: /(ban\b|banned|bans|bar\b|barred|curb|restrict|screening|审查|投资审查|禁用|禁运|驱逐)/i, v: 18, name: '禁令/审查' },
  { re: /(probe|investigat|scrutiny|raid|inspection|稽查|调查|搜查|约谈|质询)/i, v: 12, name: '调查/审查' }
];

/* 时效分 */
function _timeScore(ts) {
  if (!ts) return 0;
  const h = (Date.now() - ts) / 3600000;
  if (h <= 24) return 15;
  if (h <= 72) return 10;
  if (h <= 168) return 5;
  return 2;
}

/* 来源可信度分 */
function _credScore(domain) {
  if (!domain) return 0;
  if (globalmedia._sourceCredibility) {
    const c = globalmedia._sourceCredibility(String(domain));
    if (c >= 80) return 10;
    if (c >= 60) return 5;
    if (c >= 40) return 2;
  }
  return 0;
}

/**
 * 涉企锚点分类 + 实战化价值闸
 * @returns {object|null} { link, score, entName, reason, actionName, baseScore, actionScore, cred } 或 null（不入面板）
 */
function _entLink(title, rawTitle, country, sourceDomain) {
  const t = String(title || ''), r = String(rawTitle || '');
  const all = t + ' || ' + r;
  const src = String(sourceDomain || '').toLowerCase();

  /* ---- 价值闸 ---- */
  if (src && DOMESTIC_MEDIA_DOMAINS.some(x => src.indexOf(x.toLowerCase()) >= 0)) return null;
  if (sourceDomain && LOW_CRED_SOURCES.some(x => String(sourceDomain).toLowerCase().indexOf(x) >= 0)) return null;
  if (DIPLOMATIC_RE.test(t) || DIPLOMATIC_RE.test(r)) return null;
  if (CN_ACTOR_EN_RE.test(all) || CN_ACTOR_RE.test(all)) return null;
  if (PERSONAL_CRIME_RE.test(t) && !ENT_BRANDS_RE.test(all) && !CN_PROJECT_RE.test(all)) return null;
  if (POSITIVE_NEWS_RE.test(t)) return null;

  /* ---- 涉企锚点分类 ---- */
  let link = null, entName = null, baseScore = 0;
  if (ENT_BRANDS_RE.test(all)) {
    const m = all.match(ENT_BRANDS_RE);
    entName = m ? m[0] : null;
    const hasAction = ACTION_SCORE.some(a => a.re.test(all));
    if (hasAction) { link = 'A'; baseScore = 40; }
    else { link = 'B'; baseScore = 25; }
  }
  if (!link && /(chinese (compan|firm|entit|business|investor|tech|brand|bank|chipmak|manufacturer|chip|app|drone|stock|market)|china.?based)/i.test(all) && ACTION_SCORE.some(a => a.re.test(all))) {
    link = 'B'; baseScore = 25;
  }
  if (!link && CN_PROJECT_RE.test(t) && ACTION_SCORE.some(a => a.re.test(all))) {
    link = 'C'; baseScore = 30;
  }
  if (!link && country && LAYOUT_COUNTRIES.has(country)) {
    const envHit = /(政变|内战|战争|武装冲突|恐袭|恐怖袭击|爆炸|骚乱|暴动|罢工|大选|选举|政府(垮台|倒台|解散)|国家(紧急状态|戒严)|.+(停电|断网|地震|洪水|台风|海啸)|山火|火山)/i.test(t);
    if (envHit) { link = 'D'; baseScore = 12; }
  }
  if (!link) return null;

  let actScore = 0, actName = '一般风险';
  for (const a of ACTION_SCORE) {
    if (a.re.test(all)) { actScore = a.v; actName = a.name; break; }
  }
  const cred = _credScore(sourceDomain);
  return {
    link, entName, baseScore,
    actionScore: actScore, actionName: actName,
    cred,
    score: baseScore + actScore + cred,
    reason: link === 'A' ? '企业直击' + (entName ? '·' + entName : '') :
            link === 'B' ? '涉企动作（chinese company）' :
            link === 'C' ? '中资人员/项目遇袭' :
            link === 'D' ? '经营环境（布局国' + country + '）' : ''
  };
}

const GNEWS_ENT_POOL = [
  { id: 'ent-sanction', q: '"Chinese company" OR "Chinese companies" sanctioned' },
  { id: 'ent-ban',      q: '"Chinese companies" banned OR barred' },
  { id: 'ent-entity',  q: '"entity list" Chinese' },
  { id: 'ent-export',  q: 'US export controls Chinese chipmakers' },
  { id: 'ent-cfius',   q: 'Chinese investment CFIUS screening' },
  { id: 'ent-raid',    q: '"Chinese company" raided OR investigated' },
  { id: 'ent-detain',  q: 'Chinese executives detained OR arrested abroad' },
  { id: 'ent-tariff',  q: 'Chinese electric vehicles tariff' },
  { id: 'ent-telecom', q: 'Huawei OR ZTE ban OR sanctions' },
  { id: 'ent-app',     q: 'Chinese apps banned OR blocked' },
  { id: 'ent-blacklist', q: 'China blacklist companies procurement' },
  { id: 'ent-5g',      q: 'Chinese telecom equipment ban 5G' }
];
function _pubToSeen(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00Z';
}
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
/* ---- 涉企实采过滤：涉华实体词 + 管控动作词 双命中；中方作主语（反制/出口管制我方动作）拒收 ---- */
const ENT_HIT_RE = /chinese (compan|firm|entit|business|investor|nationals?|executives?|workers?|tech|brand|manufactur|supplier|seller|bank|chipmak|drone|telecom|energy|solar|battery|chip|goods|products|server|maker|giant)|china.?based|huawei|zte|tiktok|byd|catl|lenovo|inspur|ymtc|smic|sensetime|hikvision|dahua|xiaomi|\bdji\b|中芯|浪潮|联想|大华|海康|中国实体|中国企业|中国公司|中国公民|中资|中企/i;
const CTRL_RE = /sanction|blacklist|entity list|export control|\bban\b|\bbanned\b|\bbans\b|\bbar\b|\bbarred\b|curb|restrict|screening|cfius|tariff|raid|raided|investigat|probe|detain|arrest|freeze|frozen|seiz|delist|exclud|scrutiny|\bblock/i;
const CN_ACTOR_EN_RE = /\bchina (sanctions|bans|imposes|restricts|blacklists|curbs|tightens|expands|announces|introduces)\b|china's (sanctions|ban|restrictions|countermeasure)|北京.*(实施|宣布).*(制裁|禁止)|中方.*(实施).*(制裁|禁令)/i;
function _pass(t) {
  const s = String(t || '');
  if (!ENT_HIT_RE.test(s) || !CTRL_RE.test(s)) return false;
  if (CN_ACTOR_EN_RE.test(s)) return false;
  return true;
}
/* ---- 国别判定（标题关键词优先，未识别→国际：欧盟层动作对中企同样关键） ---- */
const ENT_GEO = [
  [/united states|u\.s\.|\bus\b|washington|american?|federal|congress/i, '美国'],
  [/european union|\beu\b|brussels/i, '欧盟'],
  [/\bindia\b|delhi|indian/i, '印度'],
  [/\bbritain\b|\buk\b|british|london/i, '英国'],
  [/german|berlin|germany/i, '德国'],
  [/australia|canberra/i, '澳大利亚'],
  [/canada|ottawa|canadian/i, '加拿大'],
  [/\bjapan\b|tokyo/i, '日本'],
  [/south korea|seoul/i, '韩国'],
  [/\btaiwan\b|taipei/i, '中国台湾'],
  [/vietnam|hanoi/i, '越南'],
  [/philippines|manila/i, '菲律宾'],
  [/indonesia|jakarta/i, '印度尼西亚'],
  [/\bpakistan\b|islamabad/i, '巴基斯坦'],
  [/nigeria|abuja/i, '尼日利亚'],
  [/russia|moscow/i, '俄罗斯']
];
function _country(t) {
  for (const g of ENT_GEO) { if (g[0].test(t)) return g[1]; }
  return '国际';
}
function _seenISO(sd) {
  const m = String(sd || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':00') : '';
}
/* ---- 级别启发式：涉人员执法/羁押→红；制裁/禁令/实体清单→橙；其余黄 ---- */
function _sev(t) {
  const s = String(t || '');
  if (/(detain|arrest|raided|dawn raid|seiz|羁押|拘捕|扣押|逮捕)/i.test(s)) return 'red';
  if (/(sanction|entity list|export control|blacklist|ban\b|delist|制裁|实体清单|黑名单|禁令)/i.test(s)) return 'orange';
  return 'yellow';
}
function _mkItem(a, focusId) {
  const title = String(a.title || '').trim();
  const isoDate = _seenISO(a.seendate);
  return {
    title, content: '',
    url: a.url || '',
    country: _country(title), country_cn: _country(title), country_iso: '', city: '', location: '',
    source: a.domain || 'Google News',
    credibility: globalmedia._sourceCredibility ? globalmedia._sourceCredibility(a.domain || '') : 60,
    category: '制裁与合规',
    data_type: 'sanctions_data',
    _forceDataType: true,
    interestLinked: true,
    chinaRelated: true,
    language: 'en',
    date: isoDate, publish_time: isoDate, publishedAt: isoDate, event_date: isoDate,
    severity: _sev(title),
    _real: true,
    _fromSource: 'ENT-RISK:' + (focusId || 'GNEWS'),
    _sourceType: 'ent_risk'
  };
}
/* ---- 实采一轮：轮换 4 查询（GNews 防限流） ---- */
let entGnCycle = 0;
const _state = { lastRun: null };
async function runEntRiskCollect() {
  const items = [], seen = new Set(), byQuery = [];
  const picks = [0, 1, 2, 3].map(i => GNEWS_ENT_POOL[(entGnCycle + i) % GNEWS_ENT_POOL.length]);
  entGnCycle = (entGnCycle + 4) % GNEWS_ENT_POOL.length;
  for (const gq of picks) {
    try {
      const arts = await _gnSearch(gq.q, 'when:3d');
      let ok = 0;
      for (const a of arts || []) {
        if (!a || !a.url || seen.has(a.url)) continue;
        if (!_pass(a.title || '')) continue;
        seen.add(a.url);
        items.push(_mkItem(a, gq.id));
        ok++;
      }
      byQuery.push(gq.id + ':' + ok + '/' + (arts ? arts.length : 0));
    } catch (e) { byQuery.push(gq.id + ':ERR:' + e.message); }
    await new Promise(r => setTimeout(r, 2500)); /* 防限流间隔 */
  }
  _state.lastRun = { at: new Date().toISOString(), queries: picks.length, candidates: items.length };
  return { items, count: items.length, stats: { byQuery } };
}

/* ============================================================
 * #698 v2 七域分类与污染闸
 * ============================================================ */
/* ---- 中企/涉华实体词（命中即入池，不含裸「中国」防泛化） ---- */
const CN_ENT_RE = /中资|中企|中国企业|中国公司|中国公民|中国员工|中国实体|中国车企|中国电池|华为|中兴|TikTok|字节跳动|海康威视|大疆|中远海运|中国银行|工商银行|宁德时代|比亚迪|chinese (compan|firm|entit|investor|business|nationals?|executives?|workers?)|china.?based|huawei|zte|byd|tiktok|catl/i;
/* ---- 污染闸一：GDELT 1.0 机翻 CAMEO 模板句拒收（全域适用） ----
 * 两种句式：①「国名：X 对 Y 实施制裁/发动军事打击」②「国名：中方/北京 实施禁运制裁/涉制裁措施」。 */
const CAMEO_JUNK_RE = /^[^：]{1,14}：.{1,26} 对 .{1,26} (实施|发动|发出|表达|提出|拒绝|展示|采取)|^[^：]{1,14}：(中方|中方人员|北京|习近平|中国政府|Chinese) [^，。]{0,16}(实施|涉|发动|发出|表达|提出|拒绝|展示|采取)/;
/* ---- 污染闸二：方向闸——中方作主语（我方对外动作/反制）不是「外方对中企管控」，拒收（管控域） ---- */
const CN_ACTOR_RE = /中方(人员)? 对 |中国政府 对 |北京(方面)? 对 /;
/* ---- 污染闸三：涉企相关性——管控域标题须命中中企实体词，或为外方对中方/中企动作句式（非模板） ---- */
const CN_TARGET_RE = /对\s?(中方|中方人员|中国公民|中国企业|中国公司|中企|中资)\s?(实施|进行|采取|发动|发起|予以)|针对(中国|中方|中企|中资)|对华(制裁|禁|管制|限制|打压|措施|行动)/;
/* ---- 六维管控细分（仅管控域内细分） ---- */
const DIMS = [
  { id: 'export',  cn: '出口管制与技术封锁', re: /entity list|export control|export ban|chip ban|semiconductor[\w\s]{0,20}(restrict|ban|curb)|technology (ban|restrict|control)|dual.?use|实体清单|出口管制|芯片(禁令|管制)|技术封锁|两用物项|算力(禁令|管制)/i },
  { id: 'invest',  cn: '投资审查与市场准入', re: /cfius|investment (screening|review|ban|restrict)|foreign investment (screen|review|ban)|procurement ban|banned from (bidding|tender|government)|market access|blacklist\w* (from|in) (eu|us|uk|india)|安全审查|投资审查|采购禁令|市场准入|排除中企|禁用中国(设备|装备)/i },
  { id: 'enforce', cn: '歧视性检查与执法', re: /(tax raid|raided|dawn raid|inspection|probe|scrutiny|investigat\w+|asset (freeze|seiz)|seiz\w+|detain\w+ (staff|employees|director)|arrest\w+ (chinese|staff|employee)|搜索(办公楼|驻地)|突击检查|税务稽查|稽查|冻结(中企|中资)?资产|扣押|羁押(员工|高管)|调查(中企|中资|华为|中兴)|(限制|禁止).*(华为|中兴|中企|中资))/i },
  { id: 'sanction', cn: '制裁清单与金融限制', re: /\bsanction\w*|ofac|designated (by|under)|sdn list|delist\w*|banking (restrict|ban|access)|制裁|列入.*清单|黑名单|除牌|摘牌|金融(限制|制裁)|冻结(账户|资产)/i },
  { id: 'digital', cn: '数字与数据管控', re: /data (law|rule|transfer|localization|restrict)|app (ban|block|restrict)|tiktok|wechat (ban|restrict)|5g ban|huawei (ban|5g)|网络安全审查|数据(安全法|出境|本地化)|应用程序(禁|下架)|封禁|数字(管控|限制|税)/i },
  { id: 'policy',  cn: '政策法规突变', re: /new (rule|regulation|law|policy|measure)|tighten\w*|restrict\w*[\w\s]{0,18}(chinese|china|beijing)|limit\w*[\w\s]{0,18}(chinese|china|beijing)|curb\w*[\w\s]{0,18}(chinese|china)|收紧|限制(中国|中企|中资|对华)|新规|新法案/i }
];
function _dimOf(t) {
  const s = String(t || '');
  for (const d of DIMS) { if (d.re.test(s)) return d; }
  return null;
}
/* ---- 七域：库内 category → 风险域映射（v2 全风险域） ---- */
const DOMAINS = [
  { id: 'control',  cn: '管控与制裁' },
  { id: 'conflict', cn: '武装冲突波及' },
  { id: 'terror',   cn: '恐袭与遇袭' },
  { id: 'unrest',   cn: '社会动荡与治安' },
  { id: 'politics', cn: '政局与政策' },
  { id: 'economy',  cn: '经济与金融' },
  { id: 'hazard',   cn: '灾害与设施' }
];
const CAT2DOMAIN = {
  '制裁与合规': 'control', '营商环境恶化': 'control', '政策法规突变': 'control',
  '武装冲突': 'conflict',
  '恐怖袭击': 'terror', '涉华恐袭': 'terror',
  '社会动荡': 'unrest', '群体性暴力': 'unrest', '社会治安事件': 'unrest',
  '政权变动': 'politics', '选举事件': 'politics',
  '金融市场风险': 'economy', '经济风险': 'economy',
  '自然灾害': 'hazard', '基础设施中断': 'hazard', '生产安全事故': 'hazard', '环境生态事件': 'hazard'
};
const DOMAIN_CN = {};
DOMAINS.forEach(d => { DOMAIN_CN[d.id] = d.cn; });

/* ---- 管控域级别启发式 ---- */
function _sevOf(t) {
  const s = String(t || '');
  if (/(detain|arrest|raided|dawn raid|seiz|羁押|拘捕|扣押|突击检查|逮捕)/i.test(s)) return 'red';
  if (/(sanction|ban|entity list|export control|blacklist|delist|制裁|禁令|实体清单|出口管制|黑名单|封禁)/i.test(s)) return 'orange';
  return 'yellow';
}
function _ts(time) {
  return new Date(String(time).replace('T', ' ').slice(0, 19).replace(' ', 'T')).getTime() || 0;
}

module.exports = function enterpriseRisk(ctx) {
  const q = ctx.query;
  const llmCall = (ctx.llm && ctx.llm.callMsg) || null;
  const router = express.Router();

  /* ---------- 公共聚合：涉企全风险域事件池（七域，SQL 粗筛 + JS 域分类） ----------
   * 口径（用户 #698-③）：仅涉华海外利益相关，国别≠中国（境内事件零收录）；
   * 地缘外交类（6779 条、机翻重灾区）不入池；china_terror 专项真货直接入恐袭域。 */
  async function _poolAgg() {
    /* #718 实时数据铁律：_sourceType='backfill'（补采主战役回灌，collect_time=当下
     * 但事件为 1-8 月旧闻）整体排除——七域分布/最新事件/研判证据全部基于实时采集，
     * 绝不让历史旧闻冒充当前涉企风险（用户原话：不能用旧数据，这是铁律）。 */
    const { rows } = await q(
      `SELECT id, country, event_date, collect_time, severity, source, data_json,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn,
              title AS title_raw
       FROM intel_data
       WHERE audit_status='approved'
         AND COALESCE(data_json->>'_sourceType','') <> 'backfill'
         AND COALESCE(country,'') NOT IN ('','中国')
         AND (
           data_json->>'_sourceType' IN ('ent_risk','china_terror')
           OR (data_json->>'chinaRelated' = 'true'
               AND data_json->>'category' IN ('制裁与合规','营商环境恶化','政策法规突变','武装冲突','恐怖袭击','涉华恐袭','社会动荡','群体性暴力','社会治安事件','政权变动','选举事件','金融市场风险','经济风险','自然灾害','基础设施中断','生产安全事故','环境生态事件'))
         )
       ORDER BY collect_time DESC LIMIT 20000`, []
    );
    const rel = [];
    for (const r of rows) {
      const t = String(r.title_cn || r.title_raw || '');
      const tAll = t + ' ' + String(r.title_raw || '');
      const j = r.data_json || {};
      if (CAMEO_JUNK_RE.test(t)) continue;                          /* 机翻模板全域拒收 */
      const st = j._sourceType || '';
      let domain = null, dimCn = '';
      if (st === 'china_terror') {
        domain = 'terror'; dimCn = '涉华遇袭';                      /* 专项通道已过 #691 方向闸 */
      } else if (st === 'ent_risk') {
        const dim = _dimOf(tAll) || DIMS[3];
        domain = 'control'; dimCn = dim.cn;                         /* 实采已过 _pass 双词闸 */
      } else {
        const cat = j.category || '';
        const dom = CAT2DOMAIN[cat];
        if (!dom) continue;
        if (dom === 'control') {
          /* 管控域三道闸：方向 + 六维命中 + 涉企相关性 */
          if (CN_ACTOR_RE.test(tAll)) continue;
          const dim = _dimOf(tAll);
          if (!dim) continue;
          if (!CN_ENT_RE.test(tAll) && !CN_TARGET_RE.test(t)) continue;
          dimCn = dim.cn;
        } else {
          /* 安全类六域：chinaRelated 严格口径已保证涉华；标题层复核涉华词防误标 */
          if (!CN_ENT_RE.test(tAll) && !/中国|中方|华人|华侨|涉华|对华/.test(t)) continue;
        }
        domain = dom;
      }
      const country = r.country || j.country || '';
      if (!country || country === '中国') continue;
      const time = j.publish_time || r.event_date || r.collect_time;
      const level = RL.assessLevel(j, r.severity || _sevOf(tAll)); /* #724 P0-3：定级单一来源（原本地三段兜底收敛，脏值回落 yellow 已内置） */
      const sourceDomain = (String(r.source || j.source || '').match(/([a-z0-9-]+\.[a-z]{2,})/i) || ['', ''])[1];
      /* 实战化：每事件必须通过涉企锚点闸——不锚定则不入"最新事件"/"红橙预警"面板 */
      const link = _entLink(t, r.title_raw, country, sourceDomain);
      rel.push({
        id: r.id, title: t.slice(0, 110), country,
        domain, domainCn: DOMAIN_CN[domain] || domain,
        dim: dimCn || DOMAIN_CN[domain],
        level, /* #724 P0-3：assessLevel 已保证四色归一，本地脏值守卫收敛删除 */
        time: String(time), ts: _ts(time),
        source: r.source || j.source || '',
        sourceDomain, url: j.url || '',
        link: link || null  /* 涉企锚点闸：null=不入"最新/预警"面板 */
      });
    }
    /* 聚合：七域分布 / 国别压力（近90天）/ 逐月 / 72h 红橙预警流 / 近30日 */
    const now = Date.now();
    const t90 = now - 90 * 86400000, t30 = now - 30 * 86400000, t72 = now - 3 * 86400000;
    const byDomain = {}, byCountry = {}, byMonth = {};
    let fresh30 = 0;
    const alerts72 = [];
    rel.forEach(e => {
      byDomain[e.domainCn] = (byDomain[e.domainCn] || 0) + 1;
      if (e.ts >= t90) byCountry[e.country] = (byCountry[e.country] || 0) + 1;
      if (e.ts >= t30) fresh30++;
      const m = String(e.time).slice(0, 7);
      if (/^20\d{2}-\d{2}$/.test(m)) byMonth[m] = (byMonth[m] || 0) + 1;
      if (e.ts >= t72 && (e.level === 'red' || e.level === 'orange')) alerts72.push(e);
    });
    alerts72.sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1) || b.ts - a.ts);
    /* #718 铁律补闸：latest/研判证据必须按【事件时间】近期取数——档案级通道
     * （china_terror/gap_scheduler 历史回补，event_date 为 2022-2025 旧闻）虽非
     * backfill 标记，但绝不允许冒充当前涉企风险进入"最新事件"与 AI 研判证据。 */
    const latest30 = rel.filter(e => e.ts >= t30).sort((a, b) => b.ts - a.ts).slice(0, 100);

    /* 实战化（需求一）："最新涉企风险事件"与"72h 红橙预警"仅展示有企业锚点的事件
     * （A/B/C/D 四档）——按影响度评分（锚点档+动作烈度+时效+来源可信度）降序，
     * 时效分现场计算（避免冷数据靠入池时间靠前）。 */
    function _impact(e) {
      if (!e.link) return 0;
      return e.link.score + _timeScore(e.ts);
    }
    const latest30Ent = latest30.filter(e => e.link).sort((a, b) => _impact(b) - _impact(a)).slice(0, 14);
    const alerts72Ent = alerts72.filter(e => e.link).sort((a, b) => _impact(b) - _impact(a)).slice(0, 16);
    const enterpriseFlow = rel.filter(e => e.ts >= t90 && e.link).sort((a, b) => _impact(b) - _impact(a)).slice(0, 60);
    const linkStats = { A: 0, B: 0, C: 0, D: 0 };
    enterpriseFlow.forEach(e => { if (e.link && e.link.link) linkStats[e.link.link]++; });
    return { rel, byDomain, byCountry, byMonth, fresh30, alerts72: alerts72Ent, latest30: latest30Ent, enterpriseFlow, linkStats };
  }

  /* #752 性能闸：_poolAgg 是 2 万行 × 多正则链的重型聚合（冷跑 2-4s，池满载时排队可达分钟级）。
   * 浏览器打开涉企视图一次并发 overview/enterprise-flow/briefing/forecast 多路请求，裸跑会同时
   * 触发多个 _poolAgg 把 PG 池打满（2026-09-10 实测 waiting=46/40 → eflow 请求 120s 无响应）。
   * 统一走 45s 记忆化 + in-flight 合并：并发请求共享同一次聚合，命中缓存秒回。 */
  const _aggMemo = { at: 0, p: null, data: null };
  function _poolAggCached() {
    if (_aggMemo.data && Date.now() - _aggMemo.at < 45 * 1000) return Promise.resolve(_aggMemo.data);
    if (_aggMemo.p) return _aggMemo.p;
    _aggMemo.p = _poolAgg()
      .then(d => { _aggMemo.data = d; _aggMemo.at = Date.now(); return d; })
      .finally(() => { _aggMemo.p = null; });
    return _aggMemo.p;
  }

  /* ---------- GET /overview：七域涉企风险全景 ---------- */
  router.get('/overview', async (req, res) => {
    try {
      const agg = await _poolAggCached();
      const cTop = Object.entries(agg.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const t90 = Date.now() - 90 * 86400000;
      const cDims = {};   /* 各国域构成 */
      agg.rel.forEach(e => {
        if (e.ts < t90) return;
        if (!cTop.some(c => c[0] === e.country)) return;
        cDims[e.country] = cDims[e.country] || {};
        cDims[e.country][e.domainCn] = (cDims[e.country][e.domainCn] || 0) + 1;
      });
      res.json({
        ok: true, generatedAt: new Date().toLocaleString('zh-CN'),
        kpi: {
          total: agg.rel.length,
          countries: Object.keys(agg.byCountry).length,
          fresh30: agg.fresh30,
          alerts72: agg.alerts72.length,
          enterpriseFlow: agg.enterpriseFlow.length,
          linkA: agg.linkStats.A, linkB: agg.linkStats.B, linkC: agg.linkStats.C, linkD: agg.linkStats.D,
          topPressure: cTop.length ? cTop[0][0] : '—'
        },
        domains: DOMAINS.map(d => ({ id: d.id, cn: d.cn, n: agg.byDomain[d.cn] || 0 })),
        byCountry: cTop.map(([country, n]) => ({ country, n, dims: cDims[country] || {} })),
        alerts72: agg.alerts72.map(e => ({
          id: e.id, title: e.title.slice(0, 100), country: e.country,
          domain: e.domainCn, dim: e.dim, level: e.level,
          time: String(e.time).slice(0, 16), url: e.url, source: e.source,
          link: e.link ? { tier: e.link.link, score: e.link.score, ent: e.link.entName, reason: e.link.reason, action: e.link.actionName } : null
        })),
        latest: agg.latest30.slice(0, 14).map(e => ({
          id: e.id, title: e.title.slice(0, 100), country: e.country,
          domain: e.domainCn, dim: e.dim, level: e.level,
          time: String(e.time).slice(0, 16), url: e.url, source: e.source,
          link: e.link ? { tier: e.link.link, score: e.link.score, ent: e.link.entName, reason: e.link.reason, action: e.link.actionName } : null
        })),
        byMonth: Object.keys(agg.byMonth).sort().slice(-14).map(m => ({ m, n: agg.byMonth[m] })),
        note: '涉企风险预警研判（全风险域 + 实战化涉企锚点）：每事件过四档涉企锚点闸（A 企业直击/B 涉企动作/C 人员资产/D 经营环境），未通过则不入"最新/预警"面板；个人犯罪/正面新闻/中方作主语/国内媒体/外交讲话/GDELT 模板 拒收；仅涉华海外利益相关数据；GDELT 机翻模板句全池拒收；零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- GET /enterprise-flow：涉企定向风险流（实战化面板，排序按影响度） ---------- */
  const _efCache = { at: 0, data: null };
  router.get('/enterprise-flow', async (req, res) => {
    try {
      const { link, country, domain, level, limit } = req.query;
      /* 不走短缓存：数据源是实时库 + 90 天池，过滤在内存中即时计算 */
      if (!req.query.refresh && _efCache.data && Date.now() - _efCache.at < 45 * 1000) {
        return res.json(Object.assign({ cached: true }, _efCache.data));
      }
      const agg = await _poolAggCached();
      let flow = agg.enterpriseFlow;
      if (link) flow = flow.filter(e => e.link && e.link.link === link);
      if (country) flow = flow.filter(e => e.country === country);
      if (domain) flow = flow.filter(e => e.domain === domain);
      if (level) flow = flow.filter(e => e.level === level);
      const lim = Math.min(120, Math.max(1, parseInt(limit) || 50));
      const items = flow.slice(0, lim).map(e => ({
        id: e.id, title: e.title, country: e.country,
        domain: e.domainCn, dim: e.dim, level: e.level,
        time: String(e.time).slice(0, 16), source: e.source, url: e.url,
        link: { tier: e.link.link, score: e.link.score, ent: e.link.entName, reason: e.link.reason, action: e.link.actionName }
      }));
      const data = {
        ok: true, generatedAt: new Date().toLocaleString('zh-CN'),
        kpi: { total: flow.length, linkA: flow.filter(e => e.link.link === 'A').length, linkB: flow.filter(e => e.link.link === 'B').length, linkC: flow.filter(e => e.link.link === 'C').length, linkD: flow.filter(e => e.link.link === 'D').length },
        items,
        filters: { link: link || null, country: country || null, domain: domain || null, level: level || null },
        note: '涉企定向风险流（90 天 · 实战化）：四档涉企锚点（A 企业直击 40 / B 涉企动作 25 / C 人员资产 30 / D 经营环境 12）+ 动作烈度（人员执法 30 / 制裁清单 22 / 禁令 18 / 调查 12）+ 时效（24h 15 / 72h 10 / 7d 5）+ 来源可信度（≥80 10 / ≥60 5 / ≥40 2）；按总分降序；价值闸：个人犯罪/正面新闻/中方作主语/国内媒体/外交讲话 拒收。'
      };
      _efCache.at = Date.now(); _efCache.data = data;
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- GET /briefing：AI 全球涉企安全风险大盘研判（30min 缓存） ---------- */
  const _brCache = { at: 0, data: null };
  router.get('/briefing', async (req, res) => {
    try {
      if (!req.query.refresh && _brCache.data && Date.now() - _brCache.at < 30 * 60 * 1000) {
        return res.json(Object.assign({ cached: true }, _brCache.data));
      }
      const agg = await _poolAggCached();
      const total = agg.rel.length;
      if (!total) {
        const d0 = { ok: true, empty: true, generatedAt: new Date().toLocaleString('zh-CN'), note: '库内暂无涉企风险记录——拒绝在空池上生成研判（零臆测原则）。' };
        _brCache.at = Date.now(); _brCache.data = d0;
        return res.json(d0);
      }
      const cTop = Object.entries(agg.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const dTop = Object.entries(agg.byDomain).sort((a, b) => b[1] - a[1]);
      const alerts = agg.alerts72.slice(0, 8);
      const ruleBr = [
        '一、当前态势。全球涉华涉企风险事件池累计 ' + total + ' 条，覆盖 ' + Object.keys(agg.byCountry).length + ' 国，近30天新增 ' + agg.fresh30 + ' 条，当前 72 小时红橙预警 ' + agg.alerts72.length + ' 条。风险域分布：' + dTop.map(d => d[0] + '（' + d[1] + '）').join('、') + '。',
        '二、重点风险提示。' + (alerts.length ? '当前最需关注：' + alerts.slice(0, 5).map(a => a.country + '·' + a.title.slice(0, 50)).join('；') + '。' : '近72小时无红橙级涉企预警，风险以黄级常规监控为主。') + '近90天压力国别前列：' + cTop.map(c => c[0] + '（' + c[1] + ' 条）').join('、') + '。',
        '三、研判结论。综合七域态势，中资企业海外经营当前面临的主要风险面为' + (dTop[0] ? dTop[0][0] : '综合风险') + '；' + (agg.rel.some(e => e.domain === 'terror' && e.level === 'red') ? '存在涉华遇袭红级事件，人员安全防范等级应上调；' : '') + (agg.rel.some(e => e.domain === 'control') ? '管控与制裁类动作具有连续性，合规成本持续承压；' : '') + '建议按国别压力榜实施差异化预警窗口。',
        '四、行动建议。一是对' + (cTop.slice(0, 3).map(c => c[0]).join('、') || '重点国别') + '布局的中资企业启动定向风险核查（人员安全/合规自查/资产盘点三件套）；二是 72h 红橙预警事件按一事一案跟进闭环；三是依托 30 天前瞻研判滚动校准风险窗口。'
      ].join('\n');
      let text = ruleBr, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是海外利益保护与企业安全风险研判参谋，为海外利益保护情报预警平台撰写《全球涉企安全风险研判》（大盘研判，供企业安全负责人30秒掌握全局）。必须分五段，段落标题固定：「一、态势判断与置信度」「二、重点风险提示（证据）」「三、研判结论」「四、行动建议」。硬性要求：①态势段给一句明确总结论+置信度档位（高/中/低）及定档依据；②证据段逐条引用给定红橙事件（国别+域+级别），禁止编造；③结论段按风险域给定向判断而非罗列数字；④建议段步骤化（一是/二是/三是）、每条带时限。所有数字必须来自给定真实统计；禁止虚构事件与日期；禁止免责套话；直击要害。';
          const usr = '七域池累计 ' + total + ' 条，覆盖 ' + Object.keys(agg.byCountry).length + ' 国，近30天 ' + agg.fresh30 + ' 条，72h红橙 ' + agg.alerts72.length + ' 条\n风险域分布：' + dTop.map(d => d[0] + '(' + d[1] + ")").join('、') + '\n近90天国别TOP：' + cTop.map(c => c[0] + '(' + c[1] + ')').join('、') + '\n72h红橙预警（最新，逐条含级别/国别/域/时间）：\n' + (alerts.length ? alerts.map((a, i) => (i + 1) + '.[' + a.level + '·' + a.country + '·' + a.domainCn + '·' + String(a.time).slice(0, 10) + '] ' + a.title.slice(0, 70)).join('\n') : '（近72小时无红橙级涉企预警）') + '\n各风险域近30天活跃度（供结论定向）：' + dTop.slice(0, 5).map(d => d[0] + ' 近30天 ' + agg.rel.filter(e => e.domainCn === d[0] && e.ts >= Date.now() - 30 * 86400000).length + ' 条').join('、');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 250) {
            text = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[ENT-RISK] briefing LLM 失败，回落规则模板:', e.message); }
      }
      const data = {
        ok: true, empty: false, briefing: text, llmOk,
        stats: { total, countries: Object.keys(agg.byCountry).length, fresh30: agg.fresh30, alerts72: agg.alerts72.length },
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：AI 全球涉企安全风险大盘研判（' + (llmOk ? 'Kimi 大模型' : '规则模板') + '）；上下文=七域全风险池真实统计 + 72h 红橙预警；仅涉华海外利益相关；零模拟。'
      };
      _brCache.at = Date.now(); _brCache.data = data;
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- GET /country-judge?country=：单国全风险域 AI 研判 ---------- */
  router.get('/country-judge', async (req, res) => {
    try {
      const country = String(req.query.country || '').trim().slice(0, 20);
      if (!country) return res.status(400).json({ ok: false, error: '缺少 country 参数' });
      const agg = await _poolAggCached();
      const evs = agg.rel.filter(e => e.country === country);
      if (!evs.length) return res.json({ ok: true, empty: true, country, note: '库内暂无该国涉企风险记录——拒绝在无数据国别上生成研判（零臆测原则）。' });
      const t90 = Date.now() - 90 * 86400000;
      const recent = evs.filter(e => e.ts >= t90);
      const doms = {};
      evs.forEach(e => { doms[e.domainCn] = (doms[e.domainCn] || 0) + 1; });
      const domTop = Object.entries(doms).sort((a, b) => b[1] - a[1]);
      const ruleJudge = [
        '一、总体态势。库内累计收录 ' + country + ' 涉华涉企风险事件 ' + evs.length + ' 条，其中近90天 ' + recent.length + ' 条' + (recent.length >= 3 ? '（风险活跃期）' : recent.length ? '（零星事件）' : '（近期无新事件，历史存量为主）') + '。风险强度按近90天事件量研判：' + (recent.length >= 5 ? '高风险区' : recent.length >= 2 ? '中风险区' : '低风险/间歇区') + '。',
        '二、主要风险域。' + domTop.map(d => d[0] + '（' + d[1] + ' 条）').join('、') + '。' + (domTop[0] ? '以' + domTop[0][0] + '为主导风险面。' : ''),
        '三、影响研判。涉及中资企业在该国的人员安全、合规成本、市场准入与资产安全。' + (evs.some(e => e.level === 'red') ? '存在红级事件（遇袭/涉人员执法类），在该国中企人员与资产安全须最高优先防范。' : '以橙黄级风险为主，重点影响经营连续性与供应链。'),
        '四、对策建议。一是对照主导风险域（' + (domTop.slice(0, 2).map(d => d[0]).join('、') || '相关域') + '）开展定向核查；二是在该国投资/投标决策中加入风险权重，重大项目预留退出预案；三是与驻外使领馆保持联络机制热更新，遇红级事件即启动应急处置。'
      ].join('\n');
      let judgeText = ruleJudge, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是海外利益保护与企业安全风险研判参谋，为海外利益保护情报预警平台撰写国别涉企风险研判（全风险域口径，参谋级）。必须分五段，段落标题固定：「一、态势判断与置信度」「二、关键证据」「三、影响评估」「四、风险预测（30天窗口）」「五、行动建议」。硬性要求：①态势段给风险档位结论（高/中/低风险区）+置信度档位及定档依据；②证据段逐条引用给定事件（含日期+级别+风险域），禁止编造；③影响段分人员安全/资产与项目/合规与经营连续性三个维度评估；④预测段给30天内方向判断与触发条件；⑤建议段步骤化、每条带时限。全部基于给定真实信息，信息不足写"暂无公开信息"。';
          const usr = '国别：' + country + '\n累计涉企风险事件 ' + evs.length + ' 条，近90天 ' + recent.length + ' 条，近30天 ' + evs.filter(e => e.ts >= Date.now() - 30 * 86400000).length + ' 条\n风险域分布：' + domTop.map(d => d[0] + '(' + d[1] + ')').join('、') + '\n代表性事件（最新10条，含日期/级别/域/来源）：\n' + evs.slice(0, 10).map((e, i) => (i + 1) + '.「' + e.title.slice(0, 60) + '」（' + String(e.time).slice(0, 10) + '，' + e.level + '级，' + e.domainCn + '，来源 ' + e.source + '）').join('\n');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 250) {
            judgeText = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[ENT-RISK] country judge LLM 失败，回落规则模板:', e.message); }
      }
      res.json({
        ok: true, country, total: evs.length, recent90: recent.length,
        domains: domTop.map(d => ({ domain: d[0], n: d[1] })),
        events: evs.slice(0, 10).map(e => ({ id: e.id, title: e.title, domain: e.domainCn, level: e.level, time: String(e.time).slice(0, 16) })),
        judgment: judgeText, llmOk, generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：单国涉企风险 AI 研判（全风险域；' + (llmOk ? 'Kimi 大模型' : '规则模板（引用真实库数字）') + '）；上下文=该国涉企风险事件全量记录；仅涉华海外利益相关；零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- GET /forecast：未来30天涉企风险前瞻（全风险域） ---------- */
  const _fcCache = { at: 0, data: null };
  router.get('/forecast', async (req, res) => {
    try {
      if (!req.query.refresh && _fcCache.data && Date.now() - _fcCache.at < 30 * 60 * 1000) {
        return res.json(Object.assign({ cached: true }, _fcCache.data));
      }
      const agg = await _poolAggCached();
      const total = agg.rel.length;
      if (!total) {
        const d0 = { ok: true, empty: true, generatedAt: new Date().toLocaleString('zh-CN'), note: '库内暂无涉企风险记录——拒绝在空池上生成预测（零臆测原则）。' };
        _fcCache.at = Date.now(); _fcCache.data = d0;
        return res.json(d0);
      }
      const cTop = Object.entries(agg.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const dTop = Object.entries(agg.byDomain).sort((a, b) => b[1] - a[1]);
      const months = Object.keys(agg.byMonth).sort();
      const last12 = months.slice(-12);
      const mAvg = last12.length ? Math.round(last12.reduce((s, m) => s + agg.byMonth[m], 0) / last12.length * 10) / 10 : 0;
      const ruleFc = [
        '一、总体态势预判。涉企风险七域池累计 ' + total + ' 条，覆盖 ' + Object.keys(agg.byCountry).length + ' 国，近30天 ' + agg.fresh30 + ' 条' + (mAvg ? '，近12个月月均约 ' + mAvg + ' 条——据此基线，未来30天全球涉企风险事件量预计在月均基线' + (agg.fresh30 > mAvg ? '上方（近30日已高于月均，风险活跃度处于抬升窗口）' : '附近波动') : '') + '。',
        '二、重点压力国别。近90天涉企风险事件前列：' + cTop.map(c => c[0] + '（' + c[1] + ' 条）').join('、') + '。相关国别的管控清单扩容、安全事件与社会动荡具有连续性特征，未来30天维持高压力判定。',
        '三、主要风险域。' + dTop.map(d => d[0] + ' ' + d[1] + ' 条').join('、') + '。管控与制裁类动作具有产业链传导性；恐袭与遇袭类直接威胁人员安全，权重最高；社会动荡类影响经营连续性与人员驻地安全。',
        '四、对策建议。一是对' + (cTop.slice(0, 3).map(c => c[0]).join('、') || '重点国别') + '布局的中资企业执行未来30天风险预警窗口（人员安全预案/合规清单比对/资产盘点）；二是建立风险事件月度基线监测，月度量超基线 50% 即触发专项研判；三是红级事件（遇袭/涉人员）按应急响应预案准备。'
      ].join('\n');
      let text = ruleFc, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是海外利益保护与企业安全风险研判参谋，为海外利益保护情报预警平台撰写《未来30天涉企风险前瞻》（全风险域口径，参谋级预测）。必须分五段，段落标题固定：「一、总体态势预判」「二、重点压力国别与方向」「三、主要风险域演变」「四、风险触发条件」「五、对策建议」。硬性要求：①预判给明确方向（抬升/平稳/回落）及依据基线数字；②前瞻判断以"研判/预计"表述并与事实明确区分；③触发条件段给出可观测的具体触发器（如制裁清单扩容、选举节点、月度量超基线50%）；④建议段步骤化、每条带时限。所有数字必须来自给定真实统计；禁止虚构具体事件、日期；禁止免责套话。';
          const usr = '七域池累计 ' + total + ' 条，近30天 ' + agg.fresh30 + ' 条，近12月月均 ' + mAvg + ' 条，72h红橙 ' + agg.alerts72.length + ' 条\n风险域分布：' + dTop.map(d => d[0] + '(' + d[1] + ')').join('、') + '\n近3个月逐月事件量（加速度依据）：' + months.slice(-3).map(m => m + ':' + agg.byMonth[m]).join('、') + '\n国别TOP（近90天）：' + cTop.map(c => c[0] + '(' + c[1] + ')').join('、') + '\n代表性最新事件（近30天实时口径）：\n' + agg.latest30.slice(0, 10).map((e, i) => (i + 1) + '.「' + e.title.slice(0, 70) + '」（' + e.country + '，' + e.domainCn + '，' + e.level + '级，' + String(e.time).slice(0, 10) + '）').join('\n');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 250) {
            text = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[ENT-RISK] forecast LLM 失败，回落规则模板:', e.message); }
      }
      const data = {
        ok: true, empty: false, forecast: text, llmOk,
        stats: { total, countries: Object.keys(agg.byCountry).length, fresh30: agg.fresh30, monthlyAvg: mAvg, alerts72: agg.alerts72.length },
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：基于涉企风险七域池真实统计的前瞻研判，' + (llmOk ? 'Kimi 大模型' : '规则模板') + '生成；预测为研判性结论，事实以实时情报流为准；仅涉华海外利益相关；零模拟。'
      };
      _fcCache.at = Date.now(); _fcCache.data = data;
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router._state = _state;

  /* ============================================================
   * #702 ① 企业资产维度（涉企区与事件研判中心差异化的根基）：
   *   /assets       35 企暴露面矩阵（企业布局国 × 七域风险池 join → AI 风险评分）
   *   /asset-judge  单企业 AI 深度研判（参谋级五段式，逐国证据 + 涉险项目）
   * ============================================================ */

  /* ---- 按国别聚合风险池（供资产 join） ---- */
  function _byCountry(agg) {
    const now = Date.now();
    const t30 = now - 30 * 86400000, t60 = now - 60 * 86400000;
    const byC = {};
    agg.rel.forEach(e => {
      const b = byC[e.country] = byC[e.country] || { n: 0, red: 0, orange: 0, recent30: 0, prior30: 0, domains: {}, events: [] };
      b.n++;
      if (e.level === 'red') b.red++; else if (e.level === 'orange') b.orange++;
      if (e.ts >= t30) b.recent30++;
      else if (e.ts >= t60) b.prior30++;
      b.domains[e.domainCn] = (b.domains[e.domainCn] || 0) + 1;
      b.events.push(e);
    });
    return byC;
  }

  /* ---- 企业 AI 风险评分（0-100，构成可解释） ----
   * 暴露广度 35 + 烈度 30 + 域覆盖 15 + 活跃度 15 + 加速度 5 */
  function _entScore(exposed, domainSet, recent30, prior30) {
    const red = exposed.reduce((s, c) => s + c.red, 0);
    const orange = exposed.reduce((s, c) => s + c.orange, 0);
    const parts = {
      breadth: Math.min(35, exposed.length * 3.5),
      severity: Math.min(30, red * 6 + orange * 2.5),
      domains: Math.min(15, domainSet.size * 2.5),
      activity: Math.min(15, recent30 * 1.5),
      accel: recent30 > prior30 && recent30 > 0 ? 5 : 0
    };
    const v = Math.min(100, Math.round(Object.values(parts).reduce((s, x) => s + x, 0)));
    return { value: v, parts, red, orange };
  }

  /* ---------- GET /assets：35 企暴露面矩阵 ---------- */
  router.get('/assets', async (req, res) => {
    try {
      const agg = await _poolAggCached();
      const byC = _byCountry(agg);
      const now = Date.now(), t90 = now - 90 * 86400000, t30 = now - 30 * 86400000, t60 = now - 60 * 86400000;
      const assets = ENTERPRISES.map(ent => {
        const exposed = ent.countries
          .filter(c => byC[c])
          .map(c => ({
            country: c, n: byC[c].n, red: byC[c].red, orange: byC[c].orange,
            recent90: byC[c].events.filter(e => e.ts >= t90).length,
            domains: Object.keys(byC[c].domains)
          }));
        const domainSet = new Set();
        let recent30 = 0, prior30 = 0, total = 0;
        exposed.forEach(x => {
          x.domains.forEach(d => domainSet.add(d));
          const b = byC[x.country];
          recent30 += b.recent30; prior30 += b.prior30; total += x.n;
        });
        const sc = _entScore(exposed, domainSet, recent30, prior30);
        const projectsAtRisk = ent.projects.filter(p => byC[p.c]);
        return {
          id: ent.id, name: ent.name, short: ent.short, industry: ent.industry,
          investment: ent.investment, personnel: ent.personnel,
          layoutCountries: ent.countries.length, projects: ent.projects.length,
          exposedCountries: exposed.length,
          total, red: sc.red, orange: sc.orange, recent30, prior30,
          domains: Array.from(domainSet),
          score: sc.value, scoreParts: sc.parts,
          topExposed: exposed.sort((a, b) => (b.red * 10 + b.n) - (a.red * 10 + a.n)).slice(0, 4)
            .map(x => ({ country: x.country, n: x.n, red: x.red, orange: x.orange })),
          projectsAtRisk: projectsAtRisk.map(p => ({ n: p.n, c: p.c, inv: p.inv, p: p.p, riskN: byC[p.c].n, riskRed: byC[p.c].red }))
        };
      }).sort((a, b) => b.score - a.score);
      const atRiskEnts = assets.filter(a => a.exposedCountries > 0 && (a.red > 0 || a.score >= 30)).length;
      const atRiskProjects = assets.reduce((s, a) => s + a.projectsAtRisk.filter(p => p.riskRed > 0 || p.riskN >= 3).length, 0);
      res.json({
        ok: true, generatedAt: new Date().toLocaleString('zh-CN'),
        kpi: { totalEnts: assets.length, atRiskEnts, atRiskProjects, topRiskEnt: assets.length ? assets[0].short : '—' },
        assets,
        note: '口径：企业暴露面 = 35 企布局国 × 七域风险池（涉华海外利益相关）join；AI 风险评分 = 暴露广度(35) + 烈度(30) + 域覆盖(15) + 活跃度(15) + 加速度(5)，构成可解释；涉险项目 = 项目所在国有风险事件。全部真实库计算，零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- GET /asset-judge?ent=：单企业 AI 深度研判（参谋级） ---------- */
  router.get('/asset-judge', async (req, res) => {
    try {
      const key = String(req.query.ent || '').trim();
      const ent = ENTERPRISES.find(e => e.short === key || e.name === key || String(e.id) === key);
      if (!ent) return res.status(400).json({ ok: false, error: '未匹配到企业档案（支持简称/全名/档案ID）' });
      const agg = await _poolAggCached();
      const byC = _byCountry(agg);
      const now = Date.now(), t90 = now - 90 * 86400000, t30 = now - 30 * 86400000, t60 = now - 60 * 86400000;
      /* 分国明细（仅布局国中有风险的） */
      const cDetail = ent.countries.filter(c => byC[c]).map(c => {
        const b = byC[c];
        return {
          country: c, n: b.n, red: b.red, orange: b.orange,
          recent90: b.events.filter(e => e.ts >= t90).length,
          domains: Object.entries(b.domains).sort((a, b2) => b2[1] - a[1]).map(x => x[0]),
          latest: b.events.filter(e => e.ts >= t90).sort((a, b2) => b2.ts - a.ts).slice(0, 3).map(e => ({
            title: e.title, level: e.level, time: String(e.time).slice(0, 10), source: e.source, domain: e.domainCn
          }))
        };
      }).sort((a, b) => (b.red * 10 + b.n) - (a.red * 10 + a.n));
      if (!cDetail.length) {
        return res.json({ ok: true, empty: true, ent: { name: ent.name, short: ent.short }, note: '该企业布局国在七域风险池内暂无涉企风险事件——不做无据研判（零臆测原则）。' });
      }
      const domainSet = new Set(); cDetail.forEach(c => c.domains.forEach(d => domainSet.add(d)));
      let recent30 = 0, prior30 = 0, total = 0;
      cDetail.forEach(c => { recent30 += byC[c.country].recent30; prior30 += byC[c.country].prior30; total += c.n; });
      const sc = _entScore(cDetail, domainSet, recent30, prior30);
      const projectsAtRisk = ent.projects.filter(p => byC[p.c]);
      const flatEvents = cDetail.flatMap(c => c.latest.map(e => Object.assign({ country: c.country }, e)))
        .sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 8);

      /* 参谋级五段式规则模板（真实数字装配，LLM 失败回落） */
      const topC = cDetail.slice(0, 3);
      const ruleJudge = [
        '一、态势判断与置信度。' + ent.name + '（' + ent.industry + '，海外人员 ' + ent.personnel + ' 人，投资额 ' + ent.investment + ' 亿美元，布局 ' + ent.countries.length + ' 国）当前海外风险暴露面：布局国中 ' + cDetail.length + ' 国存在涉企风险事件，累计 ' + total + ' 条（红 ' + sc.red + ' / 橙 ' + sc.orange + '），近30天新增 ' + recent30 + ' 条' + (recent30 > prior30 ? '（较前30天提速，风险处于上升通道）' : '（未超前30天基线）') + '。综合 AI 风险评分 ' + sc.value + '/100（烈度 ' + Math.round(sc.parts.severity) + ' / 广度 ' + Math.round(sc.parts.breadth) + ' / 域覆盖 ' + Math.round(sc.parts.domains) + ' / 活跃度 ' + Math.round(sc.parts.activity) + '）。研判置信度：' + (total >= 10 ? '高（样本充足）' : total >= 4 ? '中（建议持续跟踪印证）' : '低（样本有限，结论供参考）') + '。',
        '二、关键证据。' + topC.map(c => c.country + '（累计 ' + c.n + ' 条，红 ' + c.red + '，主导域 ' + (c.domains[0] || '综合') + '，最新：' + (c.latest[0] ? '「' + c.latest[0].title.slice(0, 40) + '」（' + c.latest[0].time + '）' : '—') + '）').join('；') + '。' + (flatEvents.length ? '代表性事件：' + flatEvents.slice(0, 4).map(e => '「' + e.title.slice(0, 45) + '」（' + e.country + '，' + e.time + '，' + e.level + '级）').join('；') + '。' : '')
      ].join('\n');
      const ruleJudgeFull = [
        ruleJudge,
        '三、影响评估。' + (sc.red > 0 ? '存在红级事件（' + sc.red + ' 条），海外人员与驻在地资产面临直接安全威胁，人员安全等级优先处置；' : '未检出红级事件，以经营连续性与合规成本影响为主；') + (projectsAtRisk.length ? '在险项目 ' + projectsAtRisk.length + ' 个（' + projectsAtRisk.slice(0, 3).map(p => p.n + '（' + p.c + '）').join('、') + '），涉及中方员工约 ' + projectsAtRisk.reduce((s, p) => s + p.p, 0) + ' 人、投资额 ' + projectsAtRisk.reduce((s, p) => s + p.inv, 0) + ' 亿美元；' : '') + '主导风险域为' + Array.from(domainSet).slice(0, 3).join('、') + '，对应' + (domainSet.has('管控与制裁') ? '合规与市场准入压力、' : '') + (domainSet.has('恐袭与遇袭') || domainSet.has('武装冲突波及') ? '人员安全与工程停摆风险、' : '') + '供应链与保险成本抬升。',
        '四、风险预测（30 天窗口）。基于当前基线（近30天 ' + recent30 + ' 条、前30天 ' + prior30 + ' 条）：' + (recent30 > prior30 ? '风险加速度为正，未来30天事件量大概率维持或高于当前水平，重点关注 ' + topC.slice(0, 2).map(c => c.country).join('、') + ' 方向的连续事件；' : '风险节奏平稳，预计以零星事件为主，但历史同类风险在政局节点（选举/换届/制裁清单扩容）存在跳升可能；') + '建议按周复核本评分。',
        '五、行动建议。一是对' + topC.slice(0, 2).map(c => c.country).join('、') + '方向立即执行人员安全核查与应急预案桌面推演（72 小时内）；二是涉险项目（' + (projectsAtRisk.slice(0, 2).map(p => p.n).join('、') || '暂无') + '）启动资产盘点与保险覆盖复核（本周内）；三是合规条线比对主导域清单（管控与制裁/数字管控）防新增限制（本周内）；四是建立每 72 小时风险快报机制，红级事件即时升级至企业安全负责人。'
      ].join('\n');

      let judgeText = ruleJudgeFull, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是央企海外安全事务参谋助手，为企业主要负责人撰写《企业海外风险研判》（参谋级，须可直接用于安全决策会）。必须分五段，段落标题固定：「一、态势判断与置信度」「二、关键证据」「三、影响评估」「四、风险预测（30天窗口）」「五、行动建议」。硬性要求：①态势段给明确结论+置信度档位（高/中/低）并用一句话说明定档依据；②证据段逐条引用给定事件（含国别+日期+级别），禁止编造；③影响段分别评估人员安全/在险资产与项目/供应链与合规三个维度；④预测段给30天内判定的具体方向与触发条件；⑤建议段必须步骤化（一是一是二是三是四是）、每条带时限（72小时内/本周内/持续）。全部数字来自给定真实统计，信息不足处如实写"暂无公开信息"，禁止空话套话。';
          const usr = '企业档案：' + ent.name + '（' + ent.industry + '），海外人员 ' + ent.personnel + ' 人，投资 ' + ent.investment + ' 亿美元，布局 ' + ent.countries.length + ' 国\n' +
            '风险暴露：布局国中 ' + cDetail.length + ' 国有涉企风险事件，累计 ' + total + ' 条（红 ' + sc.red + ' 橙 ' + sc.orange + '），近30天 ' + recent30 + ' 条（前30天 ' + prior30 + ' 条）\n' +
            'AI 风险评分：' + sc.value + '/100（构成：暴露广度 ' + Math.round(sc.parts.breadth) + '/35，烈度 ' + Math.round(sc.parts.severity) + '/30，域覆盖 ' + Math.round(sc.parts.domains) + '/15，活跃度 ' + Math.round(sc.parts.activity) + '/15，加速度 ' + sc.parts.accel + '/5）\n' +
            '风险域覆盖：' + Array.from(domainSet).join('、') + '\n' +
            '分国风险明细（按烈度排序）：\n' + cDetail.slice(0, 6).map(c => '· ' + c.country + '：累计 ' + c.n + ' 条（红 ' + c.red + ' 橙 ' + c.orange + '），近90天 ' + c.recent90 + ' 条，主导域 ' + c.domains.slice(0, 3).join('/') + '\n  最新事件：' + c.latest.map(e => '「' + e.title.slice(0, 50) + '」（' + e.time + '，' + e.level + '级，来源 ' + e.source + '）').join('；')).join('\n') + '\n' +
            '在险项目（所在国有风险事件）：' + (projectsAtRisk.length ? projectsAtRisk.map(p => p.n + '（' + p.c + '，投资 ' + p.inv + ' 亿，员工 ' + p.p + ' 人，当地风险事件 ' + byC[p.c].n + ' 条）').join('；') : '暂无');
          const r2 = await llmCall(pv, sys, usr);
          if (r2 && r2.text && r2.text.length > 300) {
            judgeText = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[ENT-RISK] asset-judge LLM 失败，回落规则模板:', e.message); }
      }
      res.json({
        ok: true, llmOk,
        ent: { id: ent.id, name: ent.name, short: ent.short, industry: ent.industry, investment: ent.investment, personnel: ent.personnel, countries: ent.countries.length, projects: ent.projects.length },
        score: { value: sc.value, parts: sc.parts },
        countries: cDetail.map(c => ({ country: c.country, n: c.n, red: c.red, orange: c.orange, recent90: c.recent90, domains: c.domains })),
        projectsAtRisk: projectsAtRisk.map(p => ({ n: p.n, c: p.c, inv: p.inv, p: p.p })),
        events: flatEvents,
        judgment: judgeText,
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: '口径：单企业 AI 深度研判（' + (llmOk ? 'Kimi 大模型 · 参谋级五段式' : '规则模板（引用真实库数字）') + '）；上下文 = 企业档案 × 布局国七域风险池 × 在险项目；仅涉华海外利益相关；零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  return router;
};

/* 供 server.js 调度器调用的实采入口（翻译/入库在 server.js 标准管线完成） */
module.exports.runEntRiskCollect = runEntRiskCollect;
module.exports.state = () => _state;
/* #703：CAMEO 机翻模板闸共享给 AI 值班分析师（垃圾情报不进研判线） */
module.exports.CAMEO_JUNK_RE = CAMEO_JUNK_RE;
