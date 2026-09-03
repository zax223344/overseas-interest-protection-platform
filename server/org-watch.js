/* ===== 威胁组织专项采集哨兵（2026-09-02 用户铁指令）=====
 * 针对前端 threats.js 组织库（THREAT_DATA.organizations，运行时动态读取+10min 缓存，
 * 组织库扩充后自动扩面不写死清单）做定向采集：
 *   ① GDELT 组织别名布尔查询（sourcecountry 取自 crawler.GD_COUNTRIES 权威码表，禁手写 ISO）
 *   ② Google News RSS 英文原子查询（GNews 不支持 OR/中文，串行+间歇重试）
 *   ③ 复用 core-threat-watch 高危国别本地 RSS 矩阵，按组织正则二次匹配
 * 频度：30min 一轮（与五路哨兵同档）；高频组织（巴塔/俾路支/ISWAP/JNIM/青年党/胡塞等）
 * 每轮全查，低频组织分片轮询，避免单次轮次打爆外网。
 * 体积豁免（用户原话："不受采集限度影响，采集数据越多越好，其他的一样"）：
 *   条目标记 _sourceType='org_watch' + _orgId + _orgName，server.js 三处体积闸门
 *   （_eventClusterOk 事件簇帽 / _catStructureOk 类别结构帽 / _capAlertQueue 预警国别帽）
 *   对 org_watch 放行；其余质量闸门（垃圾标题/墓碑/历史旧案/时效/翻译/去重）全站一致。
 * 铁律：本模块只采集不直接写库；一律走 _ingestLinkedItems → _preInsertGate 唯一管线；
 *   出网一律 netx.smartFetch（必带 timeout，返回须 .text()），禁裸 fetch。 */
'use strict';
const fs = require('fs');
const path = require('path');
const netx = require('./netx.js');
const crawler = require('./crawler.js');
const scrapers = require('./scrapers.js');
const coreThreatWatch = require('./core-threat-watch.js');

/* ---- 本地自然日（与 server.js _todayKey 同口径，禁 toISOString UTC 日） ---- */
function _todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ===== ① 组织清单：运行时动态解析 threats.js（法照抄 models-analysis.js L110-135）+ 10min 缓存 ===== */
let _orgCache = { t: 0, list: [] };
function loadOrgs(force) {
  if (!force && _orgCache.list.length && Date.now() - _orgCache.t < 10 * 60 * 1000) return _orgCache.list;
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'threats.js'), 'utf8');
    const i = src.indexOf('const THREAT_DATA=');
    if (i < 0) throw new Error('THREAT_DATA 未找到');
    const rest = src.slice(i + 'const THREAT_DATA='.length);
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) throw new Error('THREAT_DATA 括号未闭合');
    const obj = (new Function('return ' + rest.slice(0, end + 1)))();
    const list = (obj.organizations || []).map(o => ({
      id: String(o.id || o.name || '').trim(),
      name: String(o.name || '').trim(),
      aliases: Array.isArray(o.aliases) ? o.aliases.map(s => String(s).trim()).filter(Boolean) : [],
      type: o.type || '', threatLevel: Number(o.threatLevel) || 0,
      operatingRegions: Array.isArray(o.operatingRegions) ? o.operatingRegions.map(s => String(s).trim()).filter(Boolean) : []
    })).filter(o => o.id && o.name);
    _orgCache = { t: Date.now(), list };
    return list;
  } catch (e) {
    console.warn('[ORG-WATCH] threats.js 组织库解析失败:', e.message);
    return _orgCache.list.length ? _orgCache.list : [];
  }
}

/* ===== ② 活动区域 → GDELT sourcecountry 码（唯一真源 crawler.GD_COUNTRIES，禁手写） =====
 * operatingRegions 是含修饰的自由中文（"尼日利亚东北"/"阿富汗（全国）"/"刚果（金）东部"），
 * 用 GD_COUNTRIES 键做子串匹配取码；最长键优先消解（"索马里" 吃掉 "马里"、"印度尼西亚" 吃掉 "印度"）。
 * 特殊片区用显式补丁表映射到 GD_COUNTRIES 已收录国。 */
const REGION_PATCH = {
  '萨赫勒': ['尼日尔', '马里', '布基纳法索', '乍得', '毛里塔尼亚'],
  '东南亚': ['缅甸', '菲律宾', '泰国', '印度尼西亚', '马来西亚'],
  '中亚': ['哈萨克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '乌兹别克斯坦'],
  '红海': ['也门'], '曼德海峡': ['也门'], '亚丁湾': ['也门'],
  '孟加拉边境': ['孟加拉国'], '孟加拉': ['孟加拉国'],
  '印度次大陆': ['印度', '巴基斯坦'],
  '中缅边境': ['缅甸'], '中国边境': [], '中国新疆': [],   /* 国内区域不出码（海外平台） */
  '欧洲': [], '亚洲': [], '南美': [], '中美洲': [], '全球': []   /* 过大片区不做国别限定，走全球别名查询 */
};
const _GD_KEYS = Object.keys(crawler.GD_COUNTRIES).sort((a, b) => b.length - a.length);
function regionsToCountries(regions) {
  const out = [];
  for (const r of (regions || [])) {
    if (Object.prototype.hasOwnProperty.call(REGION_PATCH, r)) {
      REGION_PATCH[r].forEach(cn => { if (crawler.GD_COUNTRIES[cn] && out.indexOf(cn) < 0) out.push(cn); });
      continue;
    }
    /* 子串匹配：命中最长键后剔除其包含的短键（防 "印度尼西亚" 双中 "印度"） */
    const hits = _GD_KEYS.filter(k => r.indexOf(k) >= 0);
    const best = hits.filter((k, i) => !hits.some((o, j) => j !== i && o.length > k.length && o.indexOf(k) >= 0));
    best.forEach(cn => { if (out.indexOf(cn) < 0) out.push(cn); });
  }
  return out;
}

/* ===== ③ 别名挑选：1-3 个最具辨识度英文词（长名优先；≥4 字母直接用，2-3 字母必须带国别限定） ===== */
const ALIAS_STOP = /^(is|aa|aq|is|al|el|the|army|front|movement|brigade|brigades|group|organization|organisation|party|force|forces|council|committee|union|united|national|islamic|muslim|people|peoples|revolutionary|liberation|resistance)$/i;
function pickLatinAliases(org) {
  const terms = [org.name].concat(org.aliases || []);
  const latin = [];
  for (const t of terms) {
    const s = String(t || '').trim();
    if (!s || !/^[\x21-\x7e][\x20-\x7e]*$/.test(s)) continue;   /* 仅纯 ASCII（含空格/连字符） */
    const core = s.replace(/[^A-Za-z0-9]/g, '');
    if (core.length < 2) continue;
    if (ALIAS_STOP.test(s)) continue;                            /* "IS"/"AA" 类歧义停用词 */
    latin.push(s);
  }
  /* 长名优先（更具辨识度），同长取先出现者；最多 3 个 */
  const uniq = [];
  latin.forEach(s => { if (!uniq.some(u => u.toLowerCase() === s.toLowerCase())) uniq.push(s); });
  uniq.sort((a, b) => b.length - a.length);
  return uniq.slice(0, 3);
}
/* 短缩写（核心字母 2-3）：单独检索歧义大，只在带国别限定时使用 */
function _aliasCoreLen(s) { return String(s || '').replace(/[^A-Za-z0-9]/g, '').length; }

/* ===== ④ 高频/低频分组：高频组织每轮全查，低频分片轮询 ===== */
const HIGH_FREQ_RE = /巴塔|俾路支|胡塞|青年党|塔利班|基地组织|伊斯兰国|博科圣地|tehrik|ttp\b|baloch|\bbla\b|\bblf\b|iswap|jnim|shabaab|houthi|taliban|\bisis\b|\bisil\b|daesh|boko haram|aqap|al-qaeda|al qaeda/i;
function splitGroups(orgs) {
  const high = [], low = [];
  for (const o of orgs) {
    const txt = o.id + ' ' + o.name + ' ' + (o.aliases || []).join(' ');
    if (HIGH_FREQ_RE.test(txt) || o.threatLevel >= 8.5) high.push(o);
    else low.push(o);
  }
  /* 稳定排序保证轮询确定性 */
  high.sort((a, b) => a.id < b.id ? -1 : 1);
  low.sort((a, b) => a.id < b.id ? -1 : 1);
  return { high, low };
}
/* 低频分片：每 30min 轮次取 8 个，按轮次号轮转全覆盖 */
const LOW_BATCH = 8;
function pickLowBatch(low) {
  if (low.length <= LOW_BATCH) return low.slice();
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const start = (cyc * LOW_BATCH) % low.length;
  const out = [];
  for (let i = 0; i < Math.min(LOW_BATCH, low.length); i++) out.push(low[(start + i) % low.length]);
  return out;
}

/* ===== ⑤ 组织匹配正则（标题+摘要必须命中，防搜索漂移） ===== */
function buildOrgRe(org) {
  const base = [org.name].concat(org.aliases || []).map(s => String(s || '').trim()).filter(s => s.length >= 2);
  /* 2026-09-02 别名变体全配对（用户指令）：连字符↔空格互换变体并入匹配——
   * "al-Qaeda"/"al Qaeda" 双吃，根治拼写变体误杀（首轮审计 124 条拒因最大头） */
  const vset = new Set();
  base.forEach(t => {
    vset.add(t);
    if (t.indexOf('-') >= 0) vset.add(t.replace(/-/g, ' '));
    if (t.indexOf(' ') >= 0) vset.add(t.replace(/ /g, '-'));
  });
  const terms = Array.from(vset);
  const parts = terms
    .sort((a, b) => b.length - a.length)
    .map(t => {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      /* 纯 ASCII 词（含连字符/空格的多词短语）加词边界；CJK 直接包含匹配 */
      return /^[\x21-\x7e][\x20-\x7e]*$/.test(t) ? '(?:^|[^a-z])' + esc + '(?:[^a-z]|$)' : esc;
    });
  if (!parts.length) return null;
  try { return new RegExp(parts.join('|'), 'i'); } catch (e) { return null; }
}

/* ---- 噪声过滤（体育/娱乐/财经等非安全主题） ---- */
const NOISE_RE = /\bfootball\b|\bsoccer\b|\bFIFA\b|\bWorld Cup\b|\bNBA\b|\btennis\b|\bcricket\b|\bgolf\b|election campaign|stock market|shares rally|box office|concert|festival|award show|movie|film premiere|fashion show|娱乐|电影节|演唱会|体育赛事/i;
/* 组织动态事件词（命中组织词的同时须有安全语境，杜绝 "Taliban 发言人谈经济" 类软闻） */
/* 2026-09-02 扩为「组织行为语境」（用户指令）：原事件词 + 组织行为词（审判/嫌疑人/重建/
 * 总部/招募/勾连/网络/据点/融资/武器/走私/警告/行动等）——组织已命中别名兜底，语境可放宽不串台。
 * 短词防子串噪声：kills/ties/cell/operation/hq/arms 带词边界（避开 parties/cooperation/properties）。 */
const EVENT_RE = /terror|attack|ambush|shooting|gunmen|gunfire|kidnap|abduct|hostage|ransom|blast|bomb|suicide|militant|insurgent|extremist|assault|raid|massacre|murder|killed|killing|kills\b|dead|death|casualt|arrest|detained|capture|clash|offensive|strike|airstrike|drone|explosion|execute|behead|recruit|luring|lured|financ|sanction|designat|convict|sentenced|trial|suspect|surrender|ceasefire|leader|commander|spokesman|claimed responsibility|warns|warning|threat|\boperations?\b|\boperatives?\b|headquarters|\bhq\b|funding|\bties\b|network|\bcell\b|hideout|stronghold|regroup|resurgence|propaganda|pledge|defect|weapons|\barms\b|convoy|indictment|charges|plea|probe|questioning|manhunt|crackdown|smuggl|traffick|safe haven|sanctuary|rebuild|袭击|恐袭|绑架|劫持|人质|赎金|爆炸|枪击|武装|伏击|突袭|屠杀|谋杀|遇害|身亡|遇难|死亡|伤亡|逮捕|抓获|击毙|头目|指挥官|发言人|宣称负责|认罪|判刑|审判|投降|停火|招募|融资|制裁|据点|老巢|重建|勾连|审讯/i;

/* ---- 工具函数 ---- */
function _decodeEnt(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
}
function _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function _freshOk(dateStr, maxDays) {
  if (!dateStr) return true;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return true;
  return (Date.now() - t) <= (maxDays || 2) * 24 * 3600 * 1000;
}
function _gdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z';
}
/* GDELT 单查询 30s 硬竞速（GDELT 限流 5s/IP 由 crawler 内部节流；复杂查询偶发挂起不阻塞轮次） */
function _gdelt(q, o) {
  return Promise.race([
    crawler.gdeltSearch(q, o).catch(() => []),
    new Promise(res => setTimeout(() => res([]), 30000))
  ]);
}
/* GNews RSS 英文原子查询（只支持英文原子词：OR/中文返回空；串行+间歇重试×2，channel-watch 同源排雷） */
async function _gnewsRss(q, max) {
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:2d') + '&hl=en-US&gl=US&ceid=US:en',
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  try {
    let text = await _once();
    for (let r = 0; !text && r < 2; r++) { await new Promise(s => setTimeout(s, 2000)); text = await _once(); }
    if (!text) return [];
    return (scrapers.parseRss(text) || []).slice(0, max || 10).map(it => ({
      title: it.title || '', desc: it.description || '', url: it.link || '', pub: it.pubDate || ''
    }));
  } catch (e) { return []; }
}
/* 本地 RSS 直取（netx 必带 timeout + .text() + 竞速兜底） */
function _fetchFeed(u, ms) {
  return Promise.race([
    netx.smartFetch(u, { timeout: ms || 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 'Accept': 'application/rss+xml,application/xml,text/xml,*/*' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), (ms || 12000) + 2000))
  ]);
}

/* ---- 条目构造：唯一管线 _ingestLinkedItems 前的标准化 + 豁免标记三件套 ---- */
function _mkItem(o) {
  const iso = o.date ? new Date(o.date) : null;
  const isoStr = iso && !isNaN(iso.getTime()) ? iso.toISOString() : '';
  const txt = String(o.title || '') + ' ' + String(o.desc || '');
  const chinaRelated = scrapers.isChinaRelatedStrict(txt);
  return {
    title: String(o.title || '').trim(),
    url: String(o.url || '').trim(),
    source: o.source || _host(o.url) || '威胁组织哨兵',
    domain: _host(o.url),
    date: isoStr, publish_time: isoStr, publishedAt: isoStr, seendate: o.seendate || '',
    content: String(o.desc || '').replace(/<[^>]+>/g, '').slice(0, 600),
    country: o.country || '', country_cn: o.country || '',
    interestLinked: true, category: '威胁组织动态',
    data_type: 'terror_events', _forceDataType: true,
    _sourceType: 'org_watch',                 /* 体积限度豁免唯一凭据（三处闸门识别此标记放行） */
    _orgId: o.org.id, _orgName: o.org.name,   /* 组织溯源：预警/报告侧可按组织聚合 */
    _fromSource: 'ORG-WATCH:' + (o.channel || 'search') + (o.countryIso ? ':' + o.countryIso : ''),
    chinaRelated,
    level: chinaRelated ? 'red' : (o.highFreq ? 'orange' : 'yellow'),
    _real: true
  };
}
function _accept(title, desc, orgRe) {
  return _acceptWhy(title, desc, orgRe) === '';
}

/* 2026-09-02 普通数据条目（用户指令：未提组织名的同地区新闻以普通数据采集入库）——
 * 无 _orgId/_orgName 归因标记、不强制 terror_events（走管线通用分类），
 * 仍带 _sourceType='org_watch'（同源体积豁免），chinaRelated 同唯一源严格判定。 */
function _mkPlain(o) {
  const iso = o.date ? new Date(o.date) : null;
  const isoStr = iso && !isNaN(iso.getTime()) ? iso.toISOString() : '';
  const txt = String(o.title || '') + ' ' + String(o.desc || '');
  return {
    title: String(o.title || '').trim(),
    url: String(o.url || '').trim(),
    source: o.source || _host(o.url) || '地区安全动态',
    domain: _host(o.url),
    date: isoStr, publish_time: isoStr, publishedAt: isoStr,
    content: String(o.desc || '').replace(/<[^>]+>/g, '').slice(0, 600),
    country: o.country || '', country_cn: o.country || '',
    interestLinked: false, category: '地区安全动态',
    _sourceType: 'org_watch',
    _fromSource: 'ORG-WATCH-PLAIN:' + (o.channel || 'search'),
    chinaRelated: scrapers.isChinaRelatedStrict(txt),
    _real: true
  };
}
/* 普通通道准入：仅「未命中别名」类拒因可转入，标题非噪声 + 须过安全核心底线
 * 2026-09-04 P1 五哨兵体检收紧：原词表含 government/president/minister/parliament/
 * election/court/trial 等治理泛词，菲律宾站内政治新闻全放行（实测 143 条混入
 * "女权活动家去世/COA审计规则"等跑题条目）。收紧为安全核心词：暴力/冲突/军事/
 * 制裁/战略资源与基础设施；治理类政务词一律移除（有安全事件词的政务新闻仍可入）。
 * 短词加 \b 防子串：strike/striker、port/portrait、dam/damage、war/warning。 */
const PLAIN_RE = /securit|militar|army|police|conflict|rebel|militia|protest|unrest|riot|\bstrike|kill|killed|died|death|attack|assault|shooting|blast|bomb|explosion|terror|ceasefire|sanction|embargo|border|refugee|displac|\bwar\b|coup|impeach|defense|defence|nuclear|missile|drone|airstrike|insurgent|extremist|jihad|militant|gunmen|hostage|kidnap|abduct|\barms\b|weapons?|smuggl|traffick|oil|gas|mineral|cobalt|lithium|copper|infrastructure|\bport\b|railway|\bdam\b|corridor|安全|军事|军队|警察|冲突|抗议|骚乱|罢工|袭击|枪击|爆炸|恐袭|停火|制裁|禁运|边境|难民|战争|政变|弹劾|国防|核|导弹|无人机|空袭|武装|极端|圣战|人质|绑架|军火|武器|走私|贩运|石油|天然气|矿产|钴|锂|铜|基础设施|港口|铁路|大坝|走廊/i;
function _tryPlain(why, title) {
  return why === '未命中本组织别名' && !NOISE_RE.test(String(title || '')) && PLAIN_RE.test(String(title || ''));
}
/* 2026-09-02 拦截可审计化：返回具体拒因（''=放行），供 droppedSamples 留证分析 */
function _acceptWhy(title, desc, orgRe) {
  const t = String(title || '');
  const all = t + ' ' + String(desc || '');
  if (t.length < 10) return '标题过短(<10字符)';
  if (NOISE_RE.test(t)) return '噪声标题(NOISE_RE)';
  if (!orgRe || !orgRe.test(all)) return '未命中本组织别名';
  if (!EVENT_RE.test(all)) return '缺安全事件语境(EVENT_RE)';
  return '';
}
/* 拦截样本留证（上限 300 条，随 stats 入 _orgWatchLastStats 供 status 端点查阅） */
function _dropRec(stats, orgId, ch, title, reason, url) {
  stats.dropped++;
  if (stats.droppedSamples.length < 300) {
    stats.droppedSamples.push({ org: orgId || '', ch: ch || '', reason, title: String(title || '').slice(0, 140), url: String(url || '').slice(0, 200) });
  }
}

/* ===== 主流程 ===== */
async function runOrgWatch(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const orgs = loadOrgs();
  const stats = { orgsTotal: orgs.length, orgsQueried: 0, gdelt: 0, gnews: 0, rss: 0, plain: 0, dropped: 0, droppedSamples: [], perOrg: {}, errors: [] };
  const out = [];
  const seenUrl = new Set();
  const seenTitle = new Set();
  const push = (it, ch, orgId) => {
    const tk = String(it.title || '').replace(/\s+/g, '').toLowerCase().slice(0, 60);
    if (!it.url || seenUrl.has(it.url) || (tk && seenTitle.has(tk))) { _dropRec(stats, orgId, ch, it.title, '轮内URL/标题去重', it.url); return; }
    seenUrl.add(it.url); if (tk) seenTitle.add(tk);
    out.push(it); stats[ch]++;
    stats.perOrg[orgId] = (stats.perOrg[orgId] || 0) + 1;
  };
  /* 普通数据通道（未提组织名的同地区新闻）：计数入 plain，不占 perOrg */
  const pushPlain = (it, ch) => {
    const tk = String(it.title || '').replace(/\s+/g, '').toLowerCase().slice(0, 60);
    if (!it.url || seenUrl.has(it.url) || (tk && seenTitle.has(tk))) { _dropRec(stats, '', ch, it.title, '轮内URL/标题去重', it.url); return; }
    seenUrl.add(it.url); if (tk) seenTitle.add(tk);
    out.push(it); stats.plain++;
  };

  if (!orgs.length) {
    console.warn('[ORG-WATCH] 组织库为空（threats.js 解析失败或无组织），本轮记 0');
    return { items: [], count: 0, stats };
  }
  const { high, low } = splitGroups(orgs);
  const lowBatch = pickLowBatch(low);
  const active = high.concat(lowBatch);
  stats.highFreq = high.length; stats.lowTotal = low.length; stats.lowBatch = lowBatch.length;

  /* 每组织预备：别名 / 国别码 / 匹配正则 */
  const plans = active.map(org => {
    const aliases = pickLatinAliases(org);
    const countries = regionsToCountries(org.operatingRegions);
    const orgRe = buildOrgRe(org);
    return { org, aliases, countries, orgRe, highFreq: high.indexOf(org) >= 0 };
  }).filter(p => p.aliases.length && p.orgRe);
  stats.orgsQueried = plans.length;

  /* ① GDELT：每组织 1-2 条查询（首个映射国 sourcecountry + 别名 OR；无映射国走全球别名查询）。
   * 短缩写（核心字母≤3）不带国别限定时不单独成查，只作 OR 从句跟长名同查。 */
  if (!opts.skipGdelt) {
    for (const p of plans) {
      try {
        const strong = p.aliases.filter(a => _aliasCoreLen(a) >= 4);
        const orSet = (strong.length ? strong : p.aliases).slice(0, 3);
        const orClause = '(' + orSet.map(a => /\s/.test(a) ? '"' + a + '"' : a).join(' OR ') + ')';
        const queries = [];
        if (p.countries.length) {
          for (const cn of p.countries.slice(0, p.highFreq ? 2 : 1)) {
            const code = crawler.gdCode(cn);
            if (code) queries.push({ q: 'sourcecountry:' + code + ' ' + orClause, cn, iso: code });
          }
        } else {
          /* 无国别映射：全球别名查询——短缩写不参与（歧义大），长名/短语加引号 */
          const gset = strong.length ? strong : [];
          if (gset.length) queries.push({ q: '(' + gset.map(a => '"' + a + '"').join(' OR ') + ')', cn: '', iso: '' });
        }
        for (const qs of queries) {
          const arts = await _gdelt(qs.q, { timespan: '2d', maxrecords: opts.maxPerQuery || 25 });
          for (const a of (arts || [])) {
            const _why = _acceptWhy(a.title, '', p.orgRe);
            if (_why) {
              if (_tryPlain(_why, a.title)) {
                const d = _gdeltDate(a.seendate);
                if (d && !_freshOk(d, 2)) { _dropRec(stats, '', 'gdelt', a.title, '时效>2天', a.url); continue; }
                pushPlain(_mkPlain({ title: a.title, url: a.url, date: d, source: a.domain, channel: 'gdelt', country: qs.cn }), 'gdelt');
              } else _dropRec(stats, p.org.id, 'gdelt', a.title, _why, a.url);
              continue;
            }
            const d = _gdeltDate(a.seendate);
            if (d && !_freshOk(d, 2)) { _dropRec(stats, p.org.id, 'gdelt', a.title, '时效>2天', a.url); continue; }
            push(_mkItem({ title: a.title, url: a.url, desc: '', date: d, seendate: a.seendate, source: a.domain, channel: 'gdelt', country: qs.cn, countryIso: qs.iso, org: p.org, highFreq: p.highFreq }), 'gdelt', p.org.id);
          }
        }
      } catch (e) { stats.errors.push(p.org.id + ':gdelt:' + e.message); }
    }
  }

  /* ② GNews 原子查询：最佳长名 + 国别英文名（无映射国且别名≥6 字母才裸查），串行防限流 */
  if (!opts.skipGnews) {
    for (const p of plans) {
      try {
        const best = p.aliases.filter(a => _aliasCoreLen(a) >= 4)[0] || '';
        if (!best) continue;
        const cnEn = p.countries.length ? crawler.gdEn(p.countries[0]) : '';
        let q = '';
        if (cnEn) q = best + ' ' + cnEn;
        else if (_aliasCoreLen(best) >= 6 || /\s/.test(best)) q = best;
        else continue;   /* 短缩写无国别限定 → 放弃 GNews（歧义大） */
        const items = await _gnewsRss(q, opts.maxPerQuery || 15);
        for (const it of items) {
          const _why = _acceptWhy(it.title, it.desc, p.orgRe);
          if (_why) {
            if (_tryPlain(_why, it.title)) {
              if (!_freshOk(it.pub, 2)) { _dropRec(stats, '', 'gnews', it.title, '时效>2天', it.url); continue; }
              pushPlain(_mkPlain({ title: it.title, url: it.url, desc: it.desc, date: it.pub, source: 'Google News·' + (_host(it.url) || best), channel: 'gnews', country: p.countries[0] || '' }), 'gnews');
            } else _dropRec(stats, p.org.id, 'gnews', it.title, _why, it.url);
            continue;
          }
          if (!_freshOk(it.pub, 2)) { _dropRec(stats, p.org.id, 'gnews', it.title, '时效>2天', it.url); continue; }
          push(_mkItem({ title: it.title, url: it.url, desc: it.desc, date: it.pub, source: 'Google News·' + (_host(it.url) || best), channel: 'gnews', country: p.countries[0] || '', countryIso: p.countries.length ? crawler.gdCode(p.countries[0]) : '', org: p.org, highFreq: p.highFreq }), 'gnews', p.org.id);
        }
      } catch (e) { stats.errors.push(p.org.id + ':gnews:' + e.message); }
    }
  }

  /* ③ 复用 core-threat-watch 高危国别本地 RSS 矩阵：条目命中某组织正则即归该组织（并发 4） */
  if (!opts.skipRss) {
    const feeds = coreThreatWatch.LOCAL_FEEDS || [];
    for (let i = 0; i < feeds.length; i += 4) {
      const batch = feeds.slice(i, i + 4);
      const results = await Promise.all(batch.map(async f => {
        try {
          const xml = await _fetchFeed(f.url, 12000);
          if (!xml) return [];
          return (scrapers.parseRss(xml) || []).map(it => ({ it, f }));
        } catch (e) { return []; }
      }));
      for (const arr of results) for (const { it, f } of arr) {
        const title = _decodeEnt(it.title || '');
        const desc = _decodeEnt(String(it.description || '').replace(/<[^>]+>/g, '').slice(0, 400));
        if (!_freshOk(it.pubDate, 2)) { _dropRec(stats, '', 'rss', _decodeEnt(it.title || ''), '时效>2天', it.link); continue; }
        let matched = false;
        for (const p of plans) {
          if (!_accept(title, desc, p.orgRe)) continue;
          push(_mkItem({ title, url: it.link, desc, date: it.pubDate, source: f.name, channel: 'rss', country: f.country, countryIso: f.iso, org: p.org, highFreq: p.highFreq }), 'rss', p.org.id);
          matched = true;
          break;   /* 一条 RSS 只归第一个命中的组织，避免多组织重复挂账 */
        }
        /* 2026-09-02 普通数据通道：未命中任何组织的高危国别 RSS 条目，
         * 非噪声且过泛政治安全底线（PLAIN_RE）即以普通数据入库——烹饪/音乐剧等纯民生拒收 */
        if (!matched) {
          if (PLAIN_RE.test(title + ' ' + desc) && !NOISE_RE.test(title)) {
            pushPlain(_mkPlain({ title, url: it.link, desc, date: it.pubDate, source: f.name, channel: 'rss', country: f.country }), 'rss');
          } else if (!PLAIN_RE.test(title + ' ' + desc)) {
            _dropRec(stats, '', 'rss', title, '普通通道-非政治安全语境', it.link);
          }
        }
      }
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const top = Object.keys(stats.perOrg).sort((a, b) => stats.perOrg[b] - stats.perOrg[a]).slice(0, 5)
    .map(k => k + '(' + stats.perOrg[k] + ')').join('/');
  console.log('[ORG-WATCH] 威胁组织哨兵(' + sec + 's): 组织库 ' + stats.orgsTotal + '（高频 ' + stats.highFreq + '/低频 ' + stats.lowTotal + '，本轮查询 ' + stats.orgsQueried + '）'
    + ' | 候选 ' + out.length + '（gdelt ' + stats.gdelt + '/gnews ' + stats.gnews + '/rss ' + stats.rss + '/普通 ' + stats.plain + '，过滤 ' + stats.dropped + '）'
    + (top ? ' | Top命中 ' + top : '')
    + (stats.errors.length ? ' | 错误 ' + stats.errors.length + '（' + stats.errors.slice(0, 3).join(';') + '）' : ''));
  if (!out.length && (stats.gdelt + stats.gnews + stats.rss) === 0) {
    console.warn('[ORG-WATCH] 本轮 0 候选——外网通道可能全挂（gdelt/gnews/rss 均 0），如实记录');
  }
  return { items: out, count: out.length, stats };
}

/* ---- start()：独立运行模式（server.js 内由 _runOrgWatch 调度，此处仅兜底） ---- */
let _timer = null;
function start(intervalMs) {
  if (_timer) return;
  _timer = setInterval(() => { runOrgWatch().catch(e => console.warn('[ORG-WATCH] 轮次异常:', e.message)); }, intervalMs || 30 * 60 * 1000);
}

module.exports = { runOrgWatch, runOnce: runOrgWatch, start, loadOrgs, splitGroups, pickLowBatch, pickLatinAliases, regionsToCountries, buildOrgRe, _todayKey };
