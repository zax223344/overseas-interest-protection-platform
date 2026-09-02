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
  const terms = [org.name].concat(org.aliases || []).map(s => String(s || '').trim()).filter(s => s.length >= 2);
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
const EVENT_RE = /terror|attack|attacked|ambush|shooting|shot|gunmen|gunfire|kidnap|kidnapped|kidnapping|abduct|abducted|hostage|ransom|blast|bomb|bombing|suicide|militant|insurgent|extremist|assault|raid|massacre|murder|murdered|killed|killing|dead|death|casualt|arrest|arrested|detained|capture|captured|clash|clashes|offensive|strike|airstrike|drone|explosion|execute|executed|behead|recruit|financing|sanction|designated|convict|sentenced|surrender|ceasefire|leader|commander|spokesman|claimed responsibility|warning|threat|袭击|恐袭|绑架|劫持|人质|赎金|爆炸|枪击|武装|伏击|突袭|屠杀|谋杀|遇害|身亡|遇难|死亡|伤亡|逮捕|抓获|击毙|头目|指挥官|发言人|宣称负责|认罪|判刑|投降|停火|招募|融资|制裁/i;

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
  const t = String(title || '');
  const all = t + ' ' + String(desc || '');
  if (t.length < 10) return false;
  if (NOISE_RE.test(t)) return false;
  if (!orgRe || !orgRe.test(all)) return false;    /* 必须命中本组织名/别名，杜绝串台 */
  if (!EVENT_RE.test(all)) return false;            /* 必须带安全事件语境 */
  return true;
}

/* ===== 主流程 ===== */
async function runOrgWatch(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const orgs = loadOrgs();
  const stats = { orgsTotal: orgs.length, orgsQueried: 0, gdelt: 0, gnews: 0, rss: 0, dropped: 0, perOrg: {}, errors: [] };
  const out = [];
  const seenUrl = new Set();
  const seenTitle = new Set();
  const push = (it, ch, orgId) => {
    const tk = String(it.title || '').replace(/\s+/g, '').toLowerCase().slice(0, 60);
    if (!it.url || seenUrl.has(it.url) || (tk && seenTitle.has(tk))) { stats.dropped++; return; }
    seenUrl.add(it.url); if (tk) seenTitle.add(tk);
    out.push(it); stats[ch]++;
    stats.perOrg[orgId] = (stats.perOrg[orgId] || 0) + 1;
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
            if (!_accept(a.title, '', p.orgRe)) { stats.dropped++; continue; }
            const d = _gdeltDate(a.seendate);
            if (d && !_freshOk(d, 2)) { stats.dropped++; continue; }
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
          if (!_accept(it.title, it.desc, p.orgRe)) { stats.dropped++; continue; }
          if (!_freshOk(it.pub, 2)) { stats.dropped++; continue; }
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
        if (!_freshOk(it.pubDate, 2)) continue;
        for (const p of plans) {
          if (!_accept(title, desc, p.orgRe)) continue;
          push(_mkItem({ title, url: it.link, desc, date: it.pubDate, source: f.name, channel: 'rss', country: f.country, countryIso: f.iso, org: p.org, highFreq: p.highFreq }), 'rss', p.org.id);
          break;   /* 一条 RSS 只归第一个命中的组织，避免多组织重复挂账 */
        }
      }
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const top = Object.keys(stats.perOrg).sort((a, b) => stats.perOrg[b] - stats.perOrg[a]).slice(0, 5)
    .map(k => k + '(' + stats.perOrg[k] + ')').join('/');
  console.log('[ORG-WATCH] 威胁组织哨兵(' + sec + 's): 组织库 ' + stats.orgsTotal + '（高频 ' + stats.highFreq + '/低频 ' + stats.lowTotal + '，本轮查询 ' + stats.orgsQueried + '）'
    + ' | 候选 ' + out.length + '（gdelt ' + stats.gdelt + '/gnews ' + stats.gnews + '/rss ' + stats.rss + '，过滤 ' + stats.dropped + '）'
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
