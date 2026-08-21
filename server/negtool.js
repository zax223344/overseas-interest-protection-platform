/* ===== 境外涉华负面情报专用采集器（2026-08-14 用户指令）=====
 * 只采"中国 + 负面"情报：制裁管制/关税壁垒/安全指控/军事围堵/舆情抹黑/排华事件/合规审查/供应链脱钩。
 * 与主通道的差异：专门的负面词库（8 大类 40+ 检索式轮动）、专门的负面判定闸、专门的日产出统计。
 * 零模拟铁律：全部来自 AP 开放检索 + GDELT 真实文章，闸门不过即丢弃。 */
const globalmedia = require('./globalmedia');
const scrapers = require('./scrapers');

/* ===== 独立检索通道（2026-08-14）=====
 * 不用 crawler 的共享 AP 冷却/GDELT 节流（其他通道触发 429 会连坐本工具返回空）。
 * 自带礼貌限速：AP 429 后冷却 10 分钟；GDELT 查询间隔 6s、429 退避。 */
const _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
let _apCool = 0, _gdLast = 0;
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* 统一抓取：优先本机代理（7897，GDELT 等境外站直连常被重置），代理失败回退直连 */
const https = require('https');
let _agent = null;
try {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  _agent = new HttpsProxyAgent(process.env.SOCIAL_PROXY || 'http://127.0.0.1:7897');
} catch (e) { _agent = null; }
function _httpGet(url, timeout, extraHeaders) {
  return new Promise(resolve => {
    const opts = {
      timeout: timeout || 18000,
      headers: Object.assign({ 'User-Agent': _UA, 'Accept-Encoding': 'identity' }, extraHeaders || {})
    };
    if (_agent) opts.agent = _agent;
    const rq = https.get(url, opts, r => {
      /* 重定向跟一层 */
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        const loc = r.headers.location;
        const rq2 = https.get(loc, opts, r2 => {
          const chunks = [];
          r2.on('data', c => chunks.push(c));
          r2.on('end', () => resolve({ status: r2.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        rq2.on('error', () => resolve({ status: 0, body: '' }));
        rq2.on('timeout', () => { rq2.destroy(); resolve({ status: 0, body: '' }); });
        return;
      }
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    rq.on('error', () => resolve({ status: 0, body: '' }));
    rq.on('timeout', () => { rq.destroy(); resolve({ status: 0, body: '' }); });
  });
}

/* AP 文章页补抓：搜索结果页常缺失日期，必须进入文章页解析 datePublished/dateModified 才能判定旧闻。
 * 为控制请求量，每轮只补抓前 _AP_ARTICLE_BUDGET 条缺失日期的链接。 */
let _AP_ARTICLE_BUDGET = 3;
async function _apArticleMeta(url) {
  const r = await _httpGet(url, 12000, { 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' });
  if (!r.body) return {};
  const html = r.body;
  let publishedAt = '', description = '';
  /* 1) JSON-LD */
  const ld = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ld) {
    try {
      const data = JSON.parse(ld[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      publishedAt = data.datePublished || data.dateModified || '';
      description = data.description || data.headline || '';
    } catch (e) {}
  }
  /* 2) meta 标签兜底 */
  if (!publishedAt) {
    const meta = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ||
                 html.match(/<meta[^>]+name=["']publishedDate["'][^>]+content=["']([^"']+)["']/i) ||
                 html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i);
    if (meta) publishedAt = meta[1];
  }
  /* 3) 首段正文兜底，用于后续事件时间提取 */
  if (!description) {
    const p = html.match(/<p[^>]*>([^<]{40,500})<\/p>/i);
    if (p) description = p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  return { publishedAt, description };
}

/* AP 站内检索（独立实现 + 日期抽取，必要时回抓文章页） */
async function _apFetch(query, max) {
  if (Date.now() < _apCool) return [];
  const out = [];
  const seen = {};
  /* AP 结果区用双引号 href + aria-label/data-gtm-region 放标题（单引号锚文本是侧栏"最新新闻"，2026-08-14 实测区分） */
  const re = /href="(https:\/\/apnews\.com\/article\/[^"]+)"/g;
  const url = 'https://apnews.com/search?q=' + encodeURIComponent(query) + '&s=0';
  const r = await _httpGet(url, 15000, { 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' });
  if (r.status === 429) { _apCool = Date.now() + 10 * 60 * 1000; console.warn('[NEG-TOOL] AP 429，冷却10分钟'); return []; }
  if (r.status !== 200 || !r.body) return [];
  const html = r.body;
  let m, fetchedArticles = 0, dateHits = 0;
  while ((m = re.exec(html)) && out.length < (max || 15)) {
    const u = m[1].split('#')[0];
    if (seen[u]) continue;
    seen[u] = 1;
    const idx = m.index;
    let title = '';
    const seg = html.slice(Math.max(0, idx - 800), idx + 1200);
    const tm = seg.match(/aria-label="([^"]{16,200})"/i) ||
               seg.match(/data-gtm-region="([^"]{16,200})"/i) ||
               seg.match(/<span[^>]*class="[^"]*PagePromoContentIcons-text[^"]*"[^>]*>([\s\S]{5,200}?)<\/span>/i) ||
               seg.match(/>([^<>{}]{18,180})<\/a>/);
    if (tm) title = tm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) continue; /* 无标题的链接不采（侧栏推荐位） */
    const seg2 = html.slice(Math.max(0, idx - 1500), idx + 1500);
    const dm = seg2.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})/) || seg2.match(/(\d{4}-\d{2}-\d{2})/);
    let pub = '';
    let description = '';
    if (dm) { const pd = new Date(dm[1]); if (!isNaN(pd.getTime())) pub = pd.toISOString(); }
    /* 搜索结果页缺日期时回抓文章页（预算控制，避免批量触发 AP 反爬） */
    if (!pub && _AP_ARTICLE_BUDGET > 0) {
      _AP_ARTICLE_BUDGET--;
      fetchedArticles++;
      try {
        const meta = await _apArticleMeta(u);
        if (meta.publishedAt) { pub = meta.publishedAt; dateHits++; }
        if (meta.description) description = meta.description;
      } catch (e) {}
    }
    out.push({ url: u, title, domain: 'apnews.com', language: 'en', publishedAt: pub, description });
  }
  if (fetchedArticles) console.log('[NEG-TOOL] AP 文章页补抓 ' + fetchedArticles + ' 条，获得日期 ' + dateHits + ' 条');
  return out;
}

/* GDELT DOC 2.0（独立实现 + 独立节流） */
async function _gdFetch(query, max) {
  const gap = Date.now() - _gdLast;
  if (gap < 6000) await _sleep(6000 - gap);
  _gdLast = Date.now();
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(query) +
    '&mode=artlist&maxrecords=' + (max || 15) + '&format=json&sort=datedesc&timespan=2d';
  for (let att = 0; att < 2; att++) {
    const r = await _httpGet(url, 20000, { 'Accept': 'application/json' });
    if (r.status === 429) { await _sleep(8000); _gdLast = Date.now(); continue; }
    if (r.status !== 200 || !r.body) return [];
    try {
      const j = JSON.parse(r.body);
      return ((j && j.articles) || []).map(a => ({
        url: a.url, title: a.title || '', domain: a.domain || '',
        language: a.language || 'en', publishedAt: a.seendate || ''
      }));
    } catch (e) { return []; }
  }
  return [];
}

/* 八大类负面检索词库（英文为主 + 中文补位），每类多条，轮换使用 */
const NEGATIVE_ARSENAL = {
  sanctions: [
    'China sanctions OR "sanctioned Chinese" OR "entity list"',
    'China "export control" OR "export curbs" retaliation',
    'China "forced labor" import ban OR UFLPA',
    'China sanctions lawmakers officials response'
  ],
  trade: [
    'China tariff OR "anti-dumping" OR "countervailing duties"',
    'China "trade war" OR "unfair trade practices"',
    'China WTO dispute complaint',
    'China "market distortion" OR "overcapacity" criticism'
  ],
  security: [
    'China espionage OR spy OR spying charges',
    'Chinese hackers cyberattack breach attributed',
    'China "influence operation" OR interference election',
    'China surveillance technology authoritarian export'
  ],
  military: [
    'China military threat Taiwan Strait',
    'China aggression "South China Sea" Philippines',
    'China military buildup concerns Pentagon',
    'China coast guard dangerous maneuvers'
  ],
  narrative: [
    'China "debt trap" Africa OR Asia criticism',
    'China disinformation campaign report',
    'China "wolf warrior" backlash',
    'China image decline survey unfavorable'
  ],
  exclusion: [
    'anti-China protest rally demonstration',
    'Chinese workers attacked kidnapped killed overseas',
    'Chinese community targeted discrimination attack',
    'sinophobia OR "anti-Chinese" incident'
  ],
  compliance: [
    'Huawei ban OR restriction security risk',
    'TikTok ban OR "data privacy" concerns',
    'China investment blocked CFIUS OR "national security review"',
    'Chinese apps banned India OR "data security"'
  ],
  decoupling: [
    'China "supply chain" decoupling OR de-risking',
    'China rare earth export weaponize concerns',
    'China port investment security scrutiny',
    'China "critical minerals" dominance warning'
  ],
  zh: [
    '中国 制裁 OR 反制 OR 出口管制',
    '反华 OR 排华 抗议 OR 袭击',
    '中国 债务陷阱 OR 威胁论',
    '对华 关税 OR 调查 OR 审查'
  ]
};
const ARSENAL_FLAT = [];
Object.keys(NEGATIVE_ARSENAL).forEach(k => NEGATIVE_ARSENAL[k].forEach(q => ARSENAL_FLAT.push({ cat: k, q })));

let _roundIdx = 0;

/* 专用负面判定：涉华 + 负面/对抗含义，双重确认（比主通道更严） */
const _NEG_RE = /sanction|tariff|ban|restrict|curb|export controls?|import ban|probe|investigat|raid|charg|accus|espionage|spy|hack|threat|aggress|coerc|interfer|backlash|protest|boycott|risk|warning|concern|critic|condemn|lawsuit|penalty|fine|violation|forced labor|debt trap|dumping|blacklist|block|reject|expel|tension|clash|detain|arrest|制裁|关税|禁令|限制|管制|调查|指控|间谍|黑客|威胁|抗议|抵制|批评|谴责|罚款|违规|逮捕|拘留|冲突|紧张|遇袭|排华|反华/i;
function _isChinaNegativeStrong(text) {
  const t = String(text || '');
  if (!t) return false;
  const hasChina = /中国|中资|中企|中方|华人|华侨|华裔|涉华|对华|一带一路|驻华|China|Chinese|Beijing|Huawei|TikTok|BRI|Belt and Road/i.test(t);
  if (!hasChina) return false;
  return _NEG_RE.test(t);
}

/* 单轮采集：轮换取 n 组检索式，AP 为主 + GDELT 兜底，全部过负面双闸 */
async function collect(opts) {
  opts = opts || {};
  const perRound = opts.perRound || 8;
  const out = [];
  const seen = new Set();
  /* 轮换选词 */
  const picks = [];
  for (let i = 0; i < perRound; i++) {
    picks.push(ARSENAL_FLAT[(_roundIdx * perRound + i) % ARSENAL_FLAT.length]);
  }
  _roundIdx++;
  /* 每轮给 AP 文章页补抓 5 个预算，专门用于搜索结果页缺日期的旧闻识别 */
  _AP_ARTICLE_BUDGET = 5;
  let apHits = 0, gdeltHits = 0;
  for (const pick of picks) {
    /* AP 不支持布尔语法：取首个 OR 分支转成朴素关键词检索（2026-08-14 实测布尔查询返回跑题结果） */
    const qAp = pick.q.split(' OR ')[0].replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim();
    let arts = [];
    try { arts = await _apFetch(qAp, 15); } catch (e) { arts = []; }
    if (arts.length) apHits += arts.length;
    /* AP 空则独立 GDELT 兜底（GDELT 支持完整布尔语法） */
    if (!arts.length) {
      try { arts = await _gdFetch(pick.q, 15); } catch (e) { arts = []; }
      if (arts.length) gdeltHits += arts.length;
    }
    for (const a of arts) {
      if (!a || !a.url || seen.has(a.url)) continue;
      const txt = String(a.title || '');
      if (!txt) continue;
      /* 专用负面双闸：先过通用垃圾/国内拦截，再过强化负面判定 + 官方负面闸 */
      if (globalmedia._isSoftJunk(txt)) continue;
      if (globalmedia._isDomesticChina(txt)) continue;
      if (!_isChinaNegativeStrong(txt)) continue;
      const gate = scrapers.chinaOverseasGate(txt);
      if (!globalmedia.chinaNegativeGate(txt, gate)) continue;
      seen.add(a.url);
      const sc = globalmedia.scoreDimensions(txt, []);
      out.push({
        title: txt, content: a.description || '', url: a.url,
        country: a.country || '国际', country_cn: a.country || '国际', country_iso: a.countryIso || 'INT',
        city: '', location: '',
        dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
        source: a.domain || '负面专项', credibility: globalmedia._sourceCredibility(a.domain || ''),
        category: '境外涉华负面情报', data_type: 'osint_intel',
        interestLinked: true, chinaRelated: false, sentiment: 'negative', _chinaNegative: true,
        language: a.language || 'en',
        date: a.publishedAt || a.seendate || '', publishedAt: a.publishedAt || a.seendate || '',
        publish_time: a.publishedAt || a.seendate || '',
        severity: '中',
        _real: true, _fromSource: 'NEG_TOOL:' + pick.cat,
        _sourceType: 'china_negative', _negCat: pick.cat
      });
    }
  }
  console.log('[NEG-TOOL] 检索式 ' + picks.length + ' 组 | AP命中 ' + apHits + ' / GDELT命中 ' + gdeltHits + ' | 过闸 ' + out.length + ' 条');
  return { count: out.length, items: out };
}

module.exports = { collect, NEGATIVE_ARSENAL, ARSENAL_FLAT, _isChinaNegativeStrong };
