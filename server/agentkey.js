/* ============================================================================
 * server/agentkey.js — AgentKey 连接器（部署进系统的实战数据源）
 * ----------------------------------------------------------------------------
 * 作用：把 AgentKey 上游供应商 API（用户自备密钥）封装为"搜索 + 全文抓取"能力，
 *       拉取结构化的「详细情报」（标题 + 完整正文 markdown + 来源 + URL + 时间 +
 *       国家 + 分类 + 语种），直接喂给数据中心 DBCenter（pending，可审核、可翻译）。
 *
 * 铁律：仅真实数据，零模拟。无密钥时回退读取 server/agentkey_data.json 种子文件
 *       （由 AgentKey 实拉并经审核落盘的真实详细数据），保证系统开箱即有详细内容。
 *
 * 配置（server/.env）：
 *   AGENTKEY_SERPER_KEY   搜索（Serper/Google）
 *   AGENTKEY_TAVILY_KEY   搜索（Tavily）
 *   AGENTKEY_EXA_KEY      搜索（Exa）
 *   AGENTKEY_BRAVE_KEY    搜索（Brave）
 *   AGENTKEY_FIRECRAWL_KEY 全文抓取（Firecrawl，返回 markdown 正文）
 *   AGENTKEY_JINA_KEY     全文抓取（Jina Reader）
 * 任一搜索 + 任一抓取密钥齐备即可全自动运行；仅配置搜索则保留摘要（无全文）。
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');
const scrapers = require('./scrapers');

const SEED_FILE = path.join(__dirname, 'agentkey_data.json');

const _env = (k, d) => process.env[k] || d || '';

/* ---------- 供应商注册（密钥缺失即视为未启用） ---------- */
const SEARCH_ENGINES = {
  serper: { key: _env('AGENTKEY_SERPER_KEY'),    url: 'https://google.serper.dev/search' },
  tavily: { key: _env('AGENTKEY_TAVILY_KEY'),    url: 'https://api.tavily.com/search' },
  brave:  { key: _env('AGENTKEY_BRAVE_KEY'),     url: 'https://api.search.brave.com/res/v1/web/search' },
  exa:    { key: _env('AGENTKEY_EXA_KEY'),       url: 'https://api.exa.ai/search' },
};
const SCRAPE_ENGINES = {
  firecrawl: { key: _env('AGENTKEY_FIRECRAWL_KEY'), url: 'https://api.firecrawl.dev/v1/scrape' },
  jina:      { key: _env('AGENTKEY_JINA_KEY'),      url: 'https://r.jina.ai/' },
};

function configuredEngines(map) { return Object.keys(map).filter(k => map[k] && map[k].key); }
function _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

/* ---------- 语种判定（Unicode 码点区间，避免源文件编码导致区间错序） ---------- */
function _guessLang(t) {
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[가-힯]/.test(t)) return 'ko';
  return 'en';
}

/* ---------- 分类（与 datasources._classifyCat 同源关键词规则） ---------- */
function _classify(text) {
  const t = String(text || '').toLowerCase();
  const RULES = [
    ['terror_events',     /terror|attack|bomb|suicide|kidnap|hostage|explosiv|爆炸|恐袭|绑架|袭击|炸弹|自杀式/],
    ['military_conflicts',/war|military|airstrike|air strike|clash|conflict|insurgent|武装|冲突|空袭|战争|叛军/],
    ['security_events',   /china|chinese|embassy|consulate|overseas|海外|中国|大使馆|中资|华人/],
    ['political_events',  /election|coup|protest|government|president|选举|政变|抗议|政府|总统/],
    ['social_unrest',     /riot|unrest|strike|demonstrat|骚乱|罢工|动荡|游行/],
    ['natural_disasters', /earthquake|flood|hurricane|typhoon|disaster|volcano|地震|洪水|台风|灾害|火山/],
    ['public_health',     /outbreak|epidemic|virus|cholera|pandemic|疫情|病毒|霍乱|流行/],
    ['sanctions_data',    /sanction|embargo|export control|制裁|禁运|出口管制/],
    ['infrastructure',    /pipeline|power grid|port|railway|refinery|mine|管道|电网|港口|铁路|炼油厂|矿区/],
    ['geopolitical_intel',/geopolit|diplomat|border|territory|sovereign|地缘|外交|边境|领土/],
    ['economic_risks',    /inflation|recession|debt|crisis|default|通胀|衰退|债务|危机|违约/],
  ];
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return 'osint_intel';
}

/* ---------- 国家/地区判定（海外利益重点国别关键词） ---------- */
const COUNTRY_KW = [
  ['巴基斯坦', /pakistan|islamabad|karachi|gwadar|peshawar/],
  ['阿富汗',   /afghanistan|kabul|taliban|塔利班/],
  ['缅甸',     /myanmar|burma|yangon|rangoon/],
  ['尼日利亚', /nigeria|lagos|abuja/],
  ['苏丹',     /sudan|khartoum/],
  ['伊拉克',   /iraq|baghdad|basra/],
  ['伊朗',     /iran|tehran/],
  ['也门',     /yemen|sanaa|houthi|胡塞/],
  ['索马里',   /somalia|mogadishu/],
  ['叙利亚',   /syria|damascus|aleppo/],
  ['乌克兰',   /ukraine|kyiv|kiev|donbas|顿巴斯/],
  ['俄罗斯',   /russia|moscow|russian|俄罗斯|莫斯科/],
  ['以色列',   /israel|tel aviv|gaza|jerusalem/],
  ['黎巴嫩',   /lebanon|beirut/],
  ['印度',     /india|new delhi|indian|印度/],
  ['孟加拉国', /bangladesh|dhaka/],
  ['马来西亚', /malaysia|kuala lumpur/],
  ['印度尼西亚',/indonesia|jakarta/],
  ['哈萨克斯坦',/kazakhstan|astana|almaty/],
  ['肯尼亚',   /kenya|nairobi/],
  ['埃塞俄比亚',/ethiopia|addis ababa/],
  ['埃及',     /egypt|cairo/],
  ['刚果',     /congo|kinshasa|kinshasa/],
  ['墨西哥',   /mexico|mexican/],
  ['美国',     /united states|usa|washington|america|美国|华盛顿/],
  ['英国',     /united kingdom|britain|london|英国|伦敦/],
  ['法国',     /france|paris|french|法国|巴黎/],
  ['德国',     /germany|berlin|german|德国|柏林/],
  ['土耳其',   /turkey|ankara|istanbul|土耳其/],
  ['泰国',     /thailand|bangkok|泰国|曼谷/],
  ['越南',     /vietnam|hanoi|越南/],
  ['菲律宾',   /philippines|manila|菲律宾/],
  ['柬埔寨',   /cambodia|phnom penh/],
  ['老挝',     /laos|vientiane/],
  ['厄瓜多尔', /ecuador|quito/],
  ['秘鲁',     /peru|lima/],
  ['委内瑞拉', /venezuela|caracas/],
  ['莫桑比克', /mozambique|maputo/],
  ['安哥拉',   /angola|luanda/],
];
function _countryFrom(text) {
  const t = String(text || '').toLowerCase();
  for (const [c, re] of COUNTRY_KW) if (re.test(t)) return c;
  if (/china|chinese|中国|中资|华人/.test(t)) return '中国（涉海外利益）';
  return '其他/国际';
}

/* ---------- 搜索（任一可用引擎） ---------- */
async function searchWeb(query, opts) {
  opts = opts || {};
  const limit = opts.limit || 8;
  const engines = configuredEngines(SEARCH_ENGINES);
  if (!engines.length) return { ok: false, reason: 'no-search-key', results: [] };
  let lastErr = '';
  for (const name of engines) {
    try {
      const r = await _doSearch(name, query, limit);
      if (r && r.length) return { ok: true, engine: name, results: r };
    } catch (e) { lastErr = e.message || String(e); }
  }
  return { ok: false, reason: 'all-search-failed:' + lastErr, results: [] };
}

async function _doSearch(name, query, limit) {
  const e = SEARCH_ENGINES[name];
  if (name === 'serper') {
    const r = await fetch(e.url, {
      method: 'POST', headers: { 'X-API-KEY': e.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: limit }), signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error('serper ' + r.status);
    const j = await r.json();
    const arr = j.organicResults || j.organic || [];
    return arr.map(it => ({ title: it.title, url: it.link || it.url, snippet: it.snippet || it.description || '', source: _host(it.link || it.url), pubDate: it.date || (it.page_age || '') })).slice(0, limit);
  }
  if (name === 'tavily') {
    const r = await fetch(e.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: e.key, query, max_results: limit, search_depth: 'advanced' }), signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error('tavily ' + r.status);
    const j = await r.json();
    return (j.results || []).map(it => ({ title: it.title, url: it.url, snippet: it.content || '', source: _host(it.url), pubDate: '' })).slice(0, limit);
  }
  if (name === 'brave') {
    const r = await fetch(e.url + '?q=' + encodeURIComponent(query) + '&count=' + limit, {
      headers: { 'X-Subscription-Token': e.key, 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error('brave ' + r.status);
    const j = await r.json();
    const w = (j.web && j.web.results) || [];
    return w.map(it => ({ title: it.title, url: it.url, snippet: it.description || '', source: _host(it.url), pubDate: it.page_age || '' })).slice(0, limit);
  }
  if (name === 'exa') {
    const r = await fetch(e.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: e.key, query, num_results: limit }), signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error('exa ' + r.status);
    const j = await r.json();
    return (j.results || []).map(it => ({ title: it.title, url: it.url, snippet: it.text || '', source: _host(it.url), pubDate: it.publishedDate || '' })).slice(0, limit);
  }
  return [];
}

/* ---------- 全文抓取（markdown） ---------- */
async function scrapePage(url, opts) {
  opts = opts || {};
  const engines = configuredEngines(SCRAPE_ENGINES);
  if (!engines.length) return { ok: false, reason: 'no-scrape-key', content: '' };
  let lastErr = '';
  for (const name of engines) {
    try {
      const c = await _doScrape(name, url);
      if (c && c.trim()) return { ok: true, engine: name, content: c };
    } catch (e) { lastErr = e.message || String(e); }
  }
  return { ok: false, reason: 'all-scrape-failed:' + lastErr, content: '' };
}

async function _doScrape(name, url) {
  const e = SCRAPE_ENGINES[name];
  if (name === 'firecrawl') {
    const r = await fetch(e.url, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + e.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }), signal: AbortSignal.timeout(25000)
    });
    if (!r.ok) throw new Error('firecrawl ' + r.status);
    const j = await r.json();
    return (j.data && (j.data.markdown || j.data.content)) || '';
  }
  if (name === 'jina') {
    const r = await fetch(e.url + url, { headers: { 'Authorization': 'Bearer ' + e.key }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('jina ' + r.status);
    return await r.text();
  }
  return '';
}

/* ---------- 组装单条 ---------- */
function _mk(query, item, content, hasFull, engine) {
  const full = String(content || '').slice(0, 20000);
  return {
    title: item.title || '(无标题)',
    content: full,
    source: item.source || _host(item.url),
    url: item.url || '',
    pubDate: item.pubDate || '',
    country: _countryFrom(item.title + ' ' + full),
    category: _classify(item.title + ' ' + full),
    language: _guessLang(item.title + ' ' + full),
    _real: true, _crawler: true, _agentkey: true,
    query: query,
    hasFull: !!hasFull,
    scrapeEngine: engine || '',
    collect_time: new Date().toISOString()
  };
}

/* ---------- 采集：多 query → 搜索 → 抓全文 → 详细条目 ---------- */
async function collect(queries, opts) {
  opts = opts || {};
  const scrapeTop = Math.max(1, Math.min(opts.scrapeTop || 3, 8));
  const limitPer = Math.max(1, Math.min(opts.limitPer || 8, 15));
  const out = [];
  for (const q of queries) {
    const s = await searchWeb(q, { limit: limitPer });
    if (!s.ok) continue;
    for (const item of s.results.slice(0, scrapeTop)) {
      if (!item.url) continue;
      const sc = await scrapePage(item.url);
      if (sc.ok && sc.content.trim()) {
        out.push(_mk(q, item, sc.content, true, sc.engine));
      } else {
        // 无全文密钥或被拦截：保留真实搜索摘要（仍标注 hasFull:false，绝不编造正文）
        out.push(_mk(q, item, item.snippet || '', false, ''));
      }
    }
  }
  /* 中国海外利益相关性闸门：仅保留与中国海外利益安全相关的真实情报，
   * 剔除纯国内民生噪声/无关条目（零模拟铁律下，无关数据宁可丢弃也不编造） */
  return out.filter(it => scrapers.chinaOverseasGate((it.title || '') + ' ' + (it.content || '')).pass);
}

/* ---------- 种子文件回退（无密钥时开箱即有真实详细数据） ---------- */
function loadSeed() {
  try {
    const a = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8') || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function appendSeed(items) {
  const cur = loadSeed();
  // 按 url 去重
  const seen = {};
  cur.forEach(it => { if (it.url) seen[it.url] = 1; });
  let added = 0;
  items.forEach(it => { if (it.url && !seen[it.url]) { cur.push(it); seen[it.url] = 1; added++; } });
  try { fs.writeFileSync(SEED_FILE, JSON.stringify(cur, null, 2)); } catch (e) {}
  return added;
}

module.exports = {
  searchWeb, scrapePage, collect, loadSeed, appendSeed, configuredEngines,
  /* 供外部（种子构建脚本）复用的单条组装器，保证分类/国别逻辑与实时采集一致 */
  makeItem: function (query, item, content, hasFull, engine) { return _mk(query, item, content, hasFull, engine); },
  status: function () {
    return {
      search: configuredEngines(SEARCH_ENGINES),
      scrape: configuredEngines(SCRAPE_ENGINES),
      hasSeed: fs.existsSync(SEED_FILE),
      seedCount: fs.existsSync(SEED_FILE) ? loadSeed().length : 0
    };
  }
};
