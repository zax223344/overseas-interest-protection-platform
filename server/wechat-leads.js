/* ===== 公众号线索 → 全球搜索 → 抓取入库 四步管线（2026-08-26 用户指令）=====
 * 用户定的新路径（替代"从公众号抓取数据入库"）：
 *   第一步：系统从公众号【查询】信息 —— 搜狗检索 20 个白名单安全公众号，拿到线索（标题+摘要+时间）
 *   第二步：【提取】信息 —— 从线索中抽取国家/城市、事件类型、涉华信号，构造英文检索式
 *   第三步：再从【全球搜索】信息 —— GDELT DOC 2.0 + Google News RSS + Bing News RSS 三通道
 *   第四步：【抓取数据，入库】 —— fulltext 抓全球媒体真实全文，条目交 server 既有闸门入库
 *
 * 关键区别：公众号文章本身【不再入库】，它只是"线索雷达"；入库数据全部来自全球媒体原文。
 * 零模拟铁律：线索/检索/正文全部真实；任何一步无结果就如实记 0，绝不补假数据。
 * 风控自律：不做搜狗跳转解析（原 antispider 重灾区），只检索结果页；与主通道共用 90min 冷却。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const oa = require('./wechat-oa');
const crawler = require('./crawler');
const fulltext = require('./fulltext');
const netx = require('./netx');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const CACHE_DIR = path.join(__dirname, '.cache');
const STATE_FILE = path.join(CACHE_DIR, 'wechat-leads.json');

const BATCH_SIZE = 10;          /* 每轮查询账号数（20 个号两轮一轮转） */
const LEAD_FRESH_MS = 7 * 864e5;   /* 线索新鲜窗：7 天（最终数据时效由全球来源自身日期决定） */
const LEAD_TTL_MS = 14 * 864e5;    /* 已处理线索记忆 14 天 */
const MAX_LEADS_PER_ROUND = 5;  /* 每轮最多跟进 5 条线索（控制 GDELT/RSS 请求量） */
const MAX_URLS_PER_LEAD = 3;    /* 每条线索最多跟进 3 个全球来源 */
const FETCH_BUDGET = 8;         /* 每轮全文抓取预算 */

/* ---------- 第二步：要素提取词典 ---------- */
/* 国家：中文名（含常见别名）→ 英文检索词。覆盖系统重点国家；未命中则检索式不带国别。 */
const COUNTRY_MAP = [
  ['巴基斯坦', 'Pakistan'], ['阿富汗', 'Afghanistan'], ['尼日利亚', 'Nigeria'], ['尼日尔', 'Niger'],
  ['缅甸', 'Myanmar'], ['刚果（金）', 'Congo'], ['刚果(金)', 'Congo'], ['刚果金', 'Congo'], ['刚果（民）', 'Congo'],
  ['马里', 'Mali'], ['索马里', 'Somalia'], ['利比亚', 'Libya'], ['埃及', 'Egypt'], ['苏丹', 'Sudan'],
  ['南苏丹', 'South Sudan'], ['埃塞俄比亚', 'Ethiopia'], ['肯尼亚', 'Kenya'], ['坦桑尼亚', 'Tanzania'],
  ['赞比亚', 'Zambia'], ['安哥拉', 'Angola'], ['莫桑比克', 'Mozambique'], ['喀麦隆', 'Cameroon'],
  ['乍得', 'Chad'], ['中非', 'Central African Republic'], ['布基纳法索', 'Burkina Faso'], ['科特迪瓦', 'Ivory Coast'],
  ['加纳', 'Ghana'], ['塞内加尔', 'Senegal'], ['几内亚', 'Guinea'], ['津巴布韦', 'Zimbabwe'],
  ['印度', 'India'], ['孟加拉国', 'Bangladesh'], ['斯里兰卡', 'Sri Lanka'], ['尼泊尔', 'Nepal'],
  ['泰国', 'Thailand'], ['老挝', 'Laos'], ['柬埔寨', 'Cambodia'], ['越南', 'Vietnam'],
  ['菲律宾', 'Philippines'], ['马来西亚', 'Malaysia'], ['印度尼西亚', 'Indonesia'], ['印尼', 'Indonesia'],
  ['哈萨克斯坦', 'Kazakhstan'], ['乌兹别克斯坦', 'Uzbekistan'], ['吉尔吉斯斯坦', 'Kyrgyzstan'], ['塔吉克斯坦', 'Tajikistan'],
  ['土库曼斯坦', 'Turkmenistan'], ['蒙古', 'Mongolia'], ['伊朗', 'Iran'], ['伊拉克', 'Iraq'],
  ['叙利亚', 'Syria'], ['也门', 'Yemen'], ['沙特', 'Saudi Arabia'], ['阿联酋', 'UAE'],
  ['土耳其', 'Turkey'], ['以色列', 'Israel'], ['黎巴嫩', 'Lebanon'], ['约旦', 'Jordan'],
  ['乌克兰', 'Ukraine'], ['俄罗斯', 'Russia'], ['委内瑞拉', 'Venezuela'], ['哥伦比亚', 'Colombia'],
  ['秘鲁', 'Peru'], ['智利', 'Chile'], ['巴西', 'Brazil'], ['墨西哥', 'Mexico'],
  ['阿根廷', 'Argentina'], ['玻利维亚', 'Bolivia'], ['厄瓜多尔', 'Ecuador'], ['巴布亚新几内亚', 'Papua New Guinea'],
  ['所罗门群岛', 'Solomon Islands'], ['斐济', 'Fiji'], ['塞尔维亚', 'Serbia'], ['匈牙利', 'Hungary'],
  ['希腊', 'Greece'], ['吉布提', 'Djibouti']
];
/* 事件类型：中文关键词 → 英文检索词（按线索文本首次命中取前 2 个） */
const EVENT_MAP = [
  ['绑架', 'kidnapped'], ['劫持', 'hijacked'], ['带走', 'abducted'], ['掳走', 'abducted'],
  ['袭击', 'attack'], ['遇袭', 'attack'], ['枪击', 'shooting'], ['爆炸', 'explosion'],
  ['恐袭', 'terrorist attack'], ['武装冲突', 'armed clash'], ['冲突', 'clash'],
  ['抢劫', 'robbery'], ['骚乱', 'riot'], ['抗议', 'protest'], ['示威', 'demonstration'],
  ['政变', 'coup'], ['死亡', 'killed'], ['遇难', 'killed'], ['身亡', 'killed'],
  ['逮捕', 'arrested'], ['扣押', 'detained'], ['拘留', 'detained'],
  ['制裁', 'sanctions'], ['撤侨', 'evacuation'], ['撤离', 'evacuation'],
  ['海盗', 'piracy'], ['地震', 'earthquake'], ['洪水', 'flood'], ['台风', 'typhoon'],
  ['罢工', 'strike'], ['火灾', 'fire'], ['事故', 'accident'], ['坠机', 'plane crash'],
  ['安全预警', 'security warning'], ['风险提示', 'travel warning']
];
const CN_SIGNAL_RE = /中国|中资|中企|中方|华人|华侨|华裔|涉华|Chinese|China/i;

/* 全球结果相关性过滤（2026-08-26 实测：GDELT/GNews 宽松匹配会漂移——蛇咬地图/无关绑架案都能命中布尔式）：
 * 涉华线索：标题+正文必须含 China/Chinese/中国 且含事件词或国别词；
 * 非涉华线索：必须含国别词且含事件词。二者都不满足则丢弃（其他采集器会覆盖泛新闻，不浪费线索配额）。 */
function _relevantItem(ex, title, content) {
  const t = (String(title || '') + ' ' + String(content || '')).toLowerCase();
  if (!t) return false;
  const hasChina = /china|chinese|中国|中资|华人/.test(t);
  const hasEvent = ex.events.some(ev => t.indexOf(ev.toLowerCase().split(' ')[0]) >= 0);
  const hasCountry = ex.countryEn ? t.indexOf(ex.countryEn.toLowerCase()) >= 0 : false;
  if (ex.china) return hasChina && (hasEvent || hasCountry);
  return hasCountry && hasEvent;
}

/* 提取线索要素 → 英文检索式（GDELT 布尔式 + 原子词式两种形态） */
function extractLead(lead) {
  const text = String(lead.title || '') + ' ' + String(lead.digest || '');
  let countryEn = '';
  for (const [cn, en] of COUNTRY_MAP) {
    if (text.indexOf(cn) >= 0) { countryEn = en; break; }
  }
  const events = [];
  for (const [cn, en] of EVENT_MAP) {
    if (text.indexOf(cn) >= 0 && events.indexOf(en) < 0) events.push(en);
    if (events.length >= 2) break;
  }
  const china = CN_SIGNAL_RE.test(text);
  if (!events.length && !china) return null;   /* 无事件也无涉华信号：不值得跟进 */
  /* GDELT 布尔式：国别 + (事件 OR) + (China OR Chinese) */
  let gdelt = '';
  if (countryEn) gdelt += '"' + countryEn + '" ';
  if (events.length) gdelt += '(' + events.join(' OR ') + ') ';
  if (china) gdelt += '(China OR Chinese)';
  gdelt = gdelt.trim();
  /* 原子词式（GNews/Bing 不支持括号分组，空格即 AND）：国别 事件 [Chinese] */
  const atomic = [countryEn, events[0] || '', china ? 'Chinese' : ''].filter(Boolean).join(' ');
  if (!gdelt || !atomic) return null;
  return { countryEn, events, china, gdelt, atomic };
}

/* ---------- 第三步：全球搜索三通道 ---------- */
function _decodeEnt(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
}
function _parseRss(xml) {
  const items = [];
  const blocks = (xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(b => {
    const tg = n => {
      const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    let title = _decodeEnt(tg('title')); let link = tg('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1]; }
    const pub = tg('pubDate') || tg('updated') || tg('published');
    const desc = _decodeEnt((tg('description') || tg('summary') || '').replace(/<[^>]+>/g, '').slice(0, 400));
    if (title && link) items.push({ title, link, pub, desc });
  });
  return items;
}
function _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
/* GDELT seendate 20260823T220000Z → ISO（铁律：直接消费必须先映射，否则被时效闸全杀） */
function _gdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z';
}
async function searchGlobal(ex, stats) {
  const found = []; const seenUrl = new Set();
  const push = (o) => {
    if (!o.url || seenUrl.has(o.url)) return;
    seenUrl.add(o.url);
    found.push(o);
  };
  /* GDELT 布尔检索（内部 6.5s 全局节流） */
  try {
    const arts = await Promise.race([
      crawler.gdeltSearch(ex.gdelt, { timespan: '3d', maxrecords: 15 }),
      new Promise(resolve => setTimeout(() => resolve([]), 30000))
    ]);
    (arts || []).forEach(a => {
      push({ title: a.title, url: a.url, date: _gdeltDate(a.seendate), source: a.domain || '', desc: '', channel: 'gdelt' });
      stats.gdelt++;
    });
  } catch (e) {}
  /* Google News RSS（原子词） */
  try {
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(ex.atomic) + '&hl=en-US&gl=US&ceid=US:en';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
    _parseRss(await r.text()).slice(0, 8).forEach(it => {
      push({ title: it.title, url: it.link, date: it.pub ? new Date(it.pub).toISOString() : '', source: 'Google News·' + _host(it.link), desc: it.desc, channel: 'gnews' });
      stats.gnews++;
    });
  } catch (e) {}
  /* Bing News RSS（原子词） */
  try {
    const u = 'https://www.bing.com/news/search?q=' + encodeURIComponent(ex.atomic) + '&format=rss';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
    _parseRss(await r.text()).slice(0, 8).forEach(it => {
      push({ title: it.title, url: it.link, date: it.pub ? new Date(it.pub).toISOString() : '', source: 'Bing News·' + _host(it.link), desc: it.desc, channel: 'bing' });
      stats.bing++;
    });
  } catch (e) {}
  return found;
}

/* ---------- GNews 包装页 → 真实出版商 URL ----------
 * Google News RSS 的 <link> 现在是 news.google.com/rss/articles/{base64} 包装页，
 * 直接请求返回的是 Google SPA，无法提取正文。必须调用 Google 内部 batchexecute
 * RPC 还原真实 URL。该 RPC 是 POST，而 netx.smartFetch 目前只支持 GET，因此
 * 复用已验证可用的 googlenewsdecoder Python 包（server/.cache/venv 隔离环境）。
 * 结果缓存 24h，避免同一 URL 反复 RPC。 */
function _findPythonExe() {
  const candidates = [
    path.join(__dirname, '.cache', 'venv', 'Scripts', 'python.exe'),
    path.join(__dirname, '.cache', 'venv', 'bin', 'python'),
    path.join(__dirname, '.cache', 'venv', 'bin', 'python3'),
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return process.env.PYTHON || 'python';
}
const _gnewsResolvedCache = new Map(); /* url → {url, at} */
async function _resolveGnewsUrl(gnewsUrl, log) {
  const cached = _gnewsResolvedCache.get(gnewsUrl);
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000) return cached.url;
  const py = _findPythonExe();
  const script = path.join(__dirname, 'decode-gnews.py');
  try {
    const env = Object.assign({}, process.env);
    if (!env.HTTP_PROXY && !env.http_proxy) env.HTTP_PROXY = 'http://127.0.0.1:7897';
    if (!env.HTTPS_PROXY && !env.https_proxy) env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    const { stdout } = await execFileAsync(py, [script, gnewsUrl], { env, timeout: 25000 });
    const r = JSON.parse(String(stdout || '{}').trim());
    if (r.ok && r.url) {
      _gnewsResolvedCache.set(gnewsUrl, { url: r.url, at: Date.now() });
      if (log) log('GNews 解析 ' + gnewsUrl.slice(-30) + ' → ' + r.url.slice(0, 80));
      return r.url;
    }
    if (log) log('GNews 解析失败: ' + (r.error || 'unknown'));
  } catch (e) {
    if (log) log('GNews 解析异常: ' + (e && e.message || e));
  }
  return null;
}

/* ---------- 状态 ---------- */
function _loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; } }
function _saveState(st) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(st));
  } catch (e) {}
}
const _titleKey = t => String(t || '').replace(/\s+/g, '').slice(0, 60);

/* ---------- 主流程：四步一轮 ---------- */
async function collect(opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const st = _loadState();
  const stats = { accounts: 0, accountsOk: 0, queries: 0, leads: 0, leadsNew: 0, followed: 0, gdelt: 0, gnews: 0, bing: 0, fetched: 0, errors: [] };
  const items = [];
  if (oa._internals.isFreqCooling()) {
    stats.errors.push('搜狗风控冷却中，本轮跳过');
    return { items, stats };
  }

  /* 第一步：公众号查询（轮巡 10 号 × 基线深翻页 2 页 + 涉华组合词 1 页；不做跳转解析） */
  const accounts = (opts.accounts && opts.accounts.length) ? opts.accounts : (() => {
    const full = oa.listAccounts();
    const off = (st._rotOffset | 0) % full.length;
    const batch = [];
    for (let i = 0; i < Math.min(BATCH_SIZE, full.length); i++) batch.push(full[(off + i) % full.length]);
    st._rotOffset = (off + BATCH_SIZE) % full.length;
    return batch;
  })();
  const COMBO_TERMS = ['中国', '华人', '中资', '袭击', '绑架', '海外'];
  const leads = [];
  const seenLeads = (st.seenLeads || []).filter(x => x && (Date.now() - (x.at || 0)) < LEAD_TTL_MS);
  const seenSet = new Set(seenLeads.map(x => x.k));
  for (const name of accounts) {
    stats.accounts++;
    if (oa._internals.isFreqCooling()) { stats.errors.push('搜狗风控冷却中，查询终止'); break; }
    try {
      st._pageRot = st._pageRot || {};
      const pr = (st._pageRot[name] | 0) % 3;
      const sr = await oa._internals.sogouSearch(name, null, pr + 1);
      if (sr.antispider) { oa._internals.noteAntispider(); stats.errors.push('搜狗反爬触发，冷却90分钟'); break; }
      if (sr.error) { stats.errors.push(name + ': ' + sr.error); continue; }
      st._pageRot[name] = (pr + 1) % 3;
      stats.accountsOk++;
      stats.queries += 2;
      let list = sr.list || [];
      /* 涉华组合词补查（每号每轮 1 个词，跨轮轮换） */
      st._comboRot = st._comboRot || {};
      const cr = (st._comboRot[name] | 0) % COMBO_TERMS.length;
      await oa._internals.sleep(oa._internals.jitter(2500, 4500));
      const sq = await oa._internals.sogouSearch(name, name + ' ' + COMBO_TERMS[cr]);
      if (sq.antispider) { oa._internals.noteAntispider(); stats.errors.push('搜狗反爬触发(组合词)，冷却90分钟'); }
      else if (!sq.error && sq.list && sq.list.length) {
        const seenT = new Set(list.map(x => x.title));
        sq.list.forEach(x => { if (!seenT.has(x.title)) list.push(x); });
        stats.queries++;
      }
      st._comboRot[name] = (cr + 1) % COMBO_TERMS.length;
      /* 线索筛选：7 天新鲜 + 未处理过 */
      const fresh = list.filter(x => x.title && (!x.ts || (Date.now() - x.ts) <= LEAD_FRESH_MS));
      stats.leads += fresh.length;
      for (const x of fresh) {
        const k = _titleKey(x.title);
        if (seenSet.has(k)) continue;
        leads.push({ account: name, title: x.title, digest: x.digest || '', ts: x.ts || 0, k });
        seenSet.add(k);
      }
      await oa._internals.sleep(oa._internals.jitter(2500, 4000));
    } catch (e) {
      stats.errors.push(name + ': ' + (e && e.message || e));
    }
  }
  stats.leadsNew = leads.length;

  /* 第二步：提取要素（只跟进能构造出有效检索式的线索，最新优先，每轮上限） */
  const actionable = [];
  for (const ld of leads) {
    const ex = extractLead(ld);
    if (ex) actionable.push({ lead: ld, ex });
  }
  actionable.sort((a, b) => (b.lead.ts || 0) - (a.lead.ts || 0));
  const follow = actionable.slice(0, MAX_LEADS_PER_ROUND);
  /* 未跟进的线索也记入已处理（低价值线索不反复消耗检索预算） */
  leads.forEach(ld => seenLeads.push({ k: ld.k, at: Date.now() }));
  st.seenLeads = seenLeads.slice(-600);

  /* 第三步 + 第四步：全球搜索 → 抓全文 → 组装入库条目 */
  let fetchBudget = FETCH_BUDGET;
  for (const { lead, ex } of follow) {
    stats.followed++;
    log('线索跟进 [' + lead.account + '] ' + lead.title.slice(0, 40) + ' → ' + ex.atomic);
    const found = await searchGlobal(ex, stats);
    /* 每条线索最多跟进 MAX_URLS_PER_LEAD 个来源，GDELT 优先（通讯社/大站时效准） */
    const picked = found.slice(0, MAX_URLS_PER_LEAD);
    for (const f0 of picked) {
      if (fetchBudget <= 0) break;
      /* GNews 包装页先做轻量相关性预筛，避免浪费解析 RPC */
      if (f0.channel === 'gnews' && f0.desc && !_relevantItem(ex, f0.title, f0.desc)) {
        stats.droppedIrrelevant = (stats.droppedIrrelevant || 0) + 1; continue;
      }
      /* GNews 包装页需先解析出真实出版商 URL */
      let targetUrl = f0.url;
      if (f0.channel === 'gnews') {
        stats.gnewsResolved = (stats.gnewsResolved || 0) + 1;
        const resolved = await _resolveGnewsUrl(f0.url, log);
        if (!resolved) { stats.gnewsResolveFailed = (stats.gnewsResolveFailed || 0) + 1; continue; }
        targetUrl = resolved;
      }
      fetchBudget--;
      let art = null;
      try { art = await fulltext.fetchArticle(targetUrl, { timeout: 9000 }); } catch (e) { if (log) log('全文抓取失败 ' + targetUrl.slice(0, 80) + ' : ' + (e && e.message || e)); }
      const content = art ? (art.fullText || art.summary || '') : (f0.desc || '');
      if (!content || content.length < 60) continue;   /* 抓不到正文且摘要太短：不入库（零模拟） */
      if (!_relevantItem(ex, (art && art.ogTitle) || f0.title, content)) { stats.droppedIrrelevant = (stats.droppedIrrelevant || 0) + 1; continue; }
      const dateIso = (art && art.publishedAt) || f0.date || '';
      items.push({
        title: (art && art.ogTitle) || f0.title,
        url: targetUrl,
        content: content.slice(0, 8000),
        digest: (art && art.summary) || f0.desc || content.slice(0, 200),
        source: (art && art.siteName) || f0.source || _host(targetUrl) || '全球媒体',
        date: dateIso, publishedAt: dateIso,
        data_type: 'osint_intel', category: '公众号线索跟进',
        language: (art && art.lang) || 'en', severity: '中',
        interestLinked: true, _real: true,
        _fromSource: 'WECHAT-LEAD', _sourceType: 'wechat_lead',
        _leadAccount: lead.account, _leadTitle: lead.title, _leadQuery: ex.atomic,
        _leadChannel: f0.channel
      });
      stats.fetched++;
    }
  }
  _saveState(st);
  return { items, stats };
}

module.exports = { collect, extractLead, _resolveGnewsUrl };
