/* ===== 涉华人员安全专项哨兵（2026-08-25 用户铁指令）=====
 * 7×24 每 30 分钟一轮：通过全球信息搜索引擎（GDELT DOC 2.0 + Google News RSS + Bing News RSS）
 * 以「中国#袭击；中国#绑架；中国公民#绑架」等关键词组合（#=组合检索）检索采集。
 *
 * 背景（漏采复盘）：2026-08-24 刚果金上加丹加省普韦托地区，载有多名中国公民的车辆
 * 遭武装人员袭击，司机中枪身亡、3 名中国公民被绑走（法语小站 magazinelaguardia 首发，
 * 标题「Pweto : un homme tué et des chinois enlevé par des bandits」）。系统零采集。
 * 根因三层：
 *  ① scrapeGdeltThemes 主通道是 AP 检索，GDELT 只在 AP 空结果时兜底——AP 对泛词组
 *     总能返回结果，覆盖 65 语种机器翻译的 GDELT 实际永不开火；
 *  ② 无「涉华人员遇袭/绑架」跨切关键词的搜索引擎级专项轮（既有主题词偏叙事类）；
 *  ③ 全球搜索引擎对该量级的小站根本不收录——必须有高危国别本地小源直采层。
 *
 * 本模块三层采集：
 *  L1 GDELT 复杂布尔（EN/FR/ES/PT 多语种，sourcelang 限定，无地点硬约束——地点交给过滤层）；
 *  L2 Google News RSS / Bing News RSS 原子双词查询（搜索引擎不支持括号分组，原子词保证 AND 语义）；
 *  L3 高危国别本地小源直采 RSS（含 TLS 老旧站 curl 兜底）。
 * 收录铁律：标题+摘要必须同时命中「涉华要素」与「暴力要素」，排除经贸隐喻噪声。
 * 本模块只采集不写库；入库由 server.js / action-collect.js 走各自既有链路。
 */
const netx = require('./netx.js');
const crawler = require('./crawler.js');
const globalmedia = require('./globalmedia.js');
const { execFile } = require('child_process');

/* ---- 收录判定正则 ---- */
const CN_RE = /china|chinese|beijing|中国|中资|中企|中方|华人|华侨|华裔|chinois|chinoise|\bchinos?\b|chinesa|chineses|一带一路/i;
const VIOLENCE_RE = /attack|attacked|attacks|ambush\w*|shoot\w*|shot|gunmen|gunfire|kidnap\w*|abduct\w*|hostage\w*|ransom|seized|kill\w*|dead|death|died|murder\w*|massacre|assault\w*|raid\w*|blast|bomb\w*|enlev\w*|kidnapp\w*|otages?|tu[ée]e?s?\b|assassin\w*|attaqu\w*|bandits?|secuestr\w*|asesin\w*|ataque|muert\w*|rehen\w*|sequestr\w*|mort[oa]s?\b|ref[ée]n\w*|袭击|绑架|劫持|遇害|枪击|身亡|遇难|被杀|打死/i;
/* 经贸/金融/网安「隐喻暴力」噪声（China attacks tariffs / Chinese hackers attack volume 之类）——本哨兵只管人员安全 */
const ECON_NOISE_RE = /tariff|sanction|trade war|export control|import ban|\bcurbs?\b|stock|shares|market|rally|gdp|economy|inflation|chip|semiconductor|deficit|financial|hacker|cyber|deepseek|关税|制裁|股价|股市|芯片|黑客/i;

/* ---- L1：GDELT 复杂布尔查询（多语种，无地点硬约束）---- */
const GDELT_QUERIES = [
  { id: 'cn-attack', focus: '中国#袭击',
    q: '(China OR Chinese) (attack OR attacked OR ambush OR shooting OR gunmen OR assaulted)' },
  { id: 'cn-kidnap', focus: '中国#绑架',
    q: '(China OR Chinese) (kidnap OR kidnapped OR kidnapping OR abduct OR abducted OR abduction OR hostage)' },
  { id: 'cn-citizen-kidnap', focus: '中国公民#绑架',
    q: '("Chinese nationals" OR "Chinese citizens" OR "Chinese workers" OR "Chinese expatriates" OR "Chinese engineers" OR "Chinese miners") (kidnapped OR abducted OR hostage OR seized OR abduction OR ransom OR missing)' },
  { id: 'cn-staff-attack', focus: '中方人员/中资项目#袭击',
    q: '("Chinese nationals" OR "Chinese workers" OR "Chinese company" OR "Chinese mine" OR "Chinese miners" OR "Chinese-run" OR "Chinese-owned") (attacked OR killed OR ambush OR shooting OR shot OR raid OR bombed OR targeted)' },
  { id: 'cn-fr', focus: '法语区#涉华袭击绑架',
    q: 'chinois (enlevé OR enlevés OR kidnappé OR kidnappés OR otage OR otages OR attaque OR attaqués OR tué OR tués OR assassiné) sourcelang:french' },
  { id: 'cn-es', focus: '西语区#涉华袭击绑架',
    q: '(chinos OR "ciudadanos chinos" OR "trabajadores chinos" OR "empresa china" OR "minera china") (secuestrados OR secuestrado OR ataque OR atacados OR muertos OR asesinado OR rehenes) sourcelang:spanish' },
  { id: 'cn-pt', focus: '葡语区#涉华袭击绑架',
    q: '(chineses OR "cidadãos chineses" OR "trabalhadores chineses" OR "empresa chinesa") (sequestrados OR sequestrado OR ataque OR mortos OR assassinado OR reféns) sourcelang:portuguese' }
];

/* ---- L2：Google News / Bing News 原子双词查询（不支持括号分组，原子词保证 AND 语义）---- */
const ATOMIC_QUERIES = [
  { q: 'Chinese attacked',        hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'Chinese kidnapped',       hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'Chinese abducted',        hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: '"Chinese nationals" killed', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: '"Chinese nationals" hostage', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: '"Chinese workers" attacked', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: '"Chinese mine" attacked', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'chinois enlevé',          hl: 'fr',    gl: 'FR', ceid: 'FR:fr' },
  { q: 'chinois tué',             hl: 'fr',    gl: 'FR', ceid: 'FR:fr' },
  { q: 'chinois attaque',         hl: 'fr',    gl: 'FR', ceid: 'FR:fr' },
  { q: 'chinos secuestrados',     hl: 'es',    gl: 'ES', ceid: 'ES:es' },
  { q: 'chineses sequestrados',   hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' }
];

/* ---- L3：高危国别本地小源直采（2026-08-25 实测可用性登记；legacy=TLS 老旧走 curl 兜底）---- */
const LOCAL_FEEDS = [
  { name: 'Actualité.cd',        url: 'https://actualite.cd/rss.xml',       country: '刚果（金）', iso: 'CD' },
  { name: 'Radio Okapi',         url: 'https://www.radiookapi.net/feed',    country: '刚果（金）', iso: 'CD' },
  { name: 'EventsRDC',           url: 'https://eventsrdc.com/feed/',        country: '刚果（金）', iso: 'CD' },
  { name: 'Congo Profond',       url: 'https://congoprofond.net/feed/',     country: '刚果（金）', iso: 'CD' },
  { name: 'Financial Afrik',     url: 'https://financialafrik.com/feed/',   country: '非洲',       iso: 'AF' },
  { name: 'Magazine La Guardia', url: 'https://magazinelaguardia.com/feed/', country: '刚果（金）', iso: 'CD', legacy: true },
  { name: 'Magazine La Guardia(alt)', url: 'https://magazinelaguardia.cd/feed/', country: '刚果（金）', iso: 'CD', legacy: true }
];

/* ---- 工具 ---- */
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
    if (title) items.push({ title, link, pub, desc });
  });
  return items;
}
function _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function _freshOk(dateStr, maxDays) {
  if (!dateStr) return true; /* 解析不出默认放行，交下游时效闸 */
  const t = Date.parse(dateStr);
  if (isNaN(t)) return true;
  return (Date.now() - t) <= (maxDays || 2) * 24 * 3600 * 1000;
}
function _accept(title, desc) {
  const t = String(title || ''); const all = t + ' ' + String(desc || '');
  if (t.length < 8) return false;
  if (!CN_RE.test(all)) return false;
  if (!VIOLENCE_RE.test(all)) return false;
  if (ECON_NOISE_RE.test(t)) return false;
  if (globalmedia._isSoftJunk && globalmedia._isSoftJunk(t)) return false;
  if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(t)) return false;
  return true;
}
const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';
function _curlFetch(url, timeoutMs) {
  return new Promise(resolve => {
    try {
      execFile(CURL_BIN, ['-sL', '--max-time', String(Math.ceil((timeoutMs || 15000) / 1000)), '--ciphers', 'DEFAULT@SECLEVEL=1', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url],
        { timeout: (timeoutMs || 15000) + 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
          if (err || !stdout) return resolve('');
          resolve(String(stdout));
        });
    } catch (e) { resolve(''); }
  });
}
async function _fetchText(url, timeoutMs, legacy) {
  if (!legacy) {
    try {
      const r = await netx.smartFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/rss+xml,application/xml,text/xml,*/*' }, timeout: timeoutMs || 15000 });
      if (r && r.ok) return await r.text();
    } catch (e) { /* 落 curl */ }
  }
  return _curlFetch(url, timeoutMs);
}
function _mkItem(o) {
  const iso = o.date ? new Date(o.date) : null;
  const isoStr = iso && !isNaN(iso.getTime()) ? iso.toISOString() : '';
  return {
    title: String(o.title || '').trim(),
    url: String(o.url || '').trim(),
    source: o.source || _host(o.url) || '涉华安全哨兵',
    domain: _host(o.url),
    date: isoStr, publish_time: isoStr, publishedAt: isoStr, seendate: o.seendate || '',
    content: String(o.desc || '').slice(0, 400),
    country: o.country || '', country_cn: o.country || '', iso2: o.iso || '',
    interestLinked: true, category: '涉华人员安全事件',
    _src: 'cnsec-' + (o.channel || 'search'), _cnsecWatch: true, _focus: o.focus || ''
  };
}

/* ---- 主流程 ---- */
async function runCnSecurityWatch(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const out = []; const seenUrl = new Set();
  const stats = { gdelt: 0, gnews: 0, bing: 0, local: 0, dropped: 0 };
  /* 2026-09-03 时长止损：GDELT 串行查询限流时段单条顶满 30s 会拖爆
   * action-collect 的 6 分钟 HARD_CAP（同因 GDELT-THEMES 修复）。 */
  const _deadline = Date.now() + (opts.deadlineMs || 150000);
  const _timeLeft = () => _deadline - Date.now();
  const push = (it, ch) => {
    if (!it.url || seenUrl.has(it.url)) { stats.dropped++; return; }
    seenUrl.add(it.url); out.push(it); stats[ch]++;
  };

  /* L1：GDELT 复杂布尔（内部 5.2s 全局节流，天然串行） */
  if (!opts.skipGdelt) {
    for (const qs of GDELT_QUERIES) {
      if (_timeLeft() < 35000) { console.warn('[CNSEC-WATCH] 剩余时长预算不足，L1 提前止损（已抓 gdelt ' + stats.gdelt + '）'); break; }
      let arts = [];
      try {
        arts = await Promise.race([
          crawler.gdeltSearch(qs.q, { timespan: '1d', maxrecords: opts.maxPerQuery || 40 }),
          new Promise(resolve => setTimeout(() => resolve([]), 30000))
        ]) || [];
      } catch (e) { arts = []; }
      for (const a of arts) {
        if (!_accept(a.title, '')) { stats.dropped++; continue; }
        if (a.seendate && !_freshOk(String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'), 2)) { stats.dropped++; continue; }
        push(_mkItem({ title: a.title, url: a.url, desc: '', date: a.seendate ? String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z') : '', seendate: a.seendate, source: a.domain, focus: qs.focus, channel: 'gdelt' }), 'gdelt');
      }
    }
  }

  /* L2a：Google News RSS 原子查询（并发 3） */
  if (!opts.skipGnews) {
    for (let i = 0; i < ATOMIC_QUERIES.length; i += 3) {
      const batch = ATOMIC_QUERIES.slice(i, i + 3);
      const results = await Promise.all(batch.map(async aq => {
        try {
          const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(aq.q + ' when:1d') + '&hl=' + aq.hl + '&gl=' + aq.gl + '&ceid=' + encodeURIComponent(aq.ceid);
          const xml = await _fetchText(u, 15000);
          return _parseRss(xml).map(it => ({ it, aq }));
        } catch (e) { return []; }
      }));
      for (const arr of results) for (const { it, aq } of arr) {
        if (!_accept(it.title, it.desc)) { stats.dropped++; continue; }
        if (!_freshOk(it.pub, 2)) { stats.dropped++; continue; }
        push(_mkItem({ title: it.title, url: it.link, desc: it.desc, date: it.pub, source: 'Google News·' + (_host(it.link) || aq.q), focus: aq.q, channel: 'gnews' }), 'gnews');
      }
    }
  }

  /* L2b：Bing News RSS（英文原子集，并发 2） */
  if (!opts.skipBing) {
    const enSet = ATOMIC_QUERIES.filter(a => a.hl === 'en-US');
    for (let i = 0; i < enSet.length; i += 2) {
      const batch = enSet.slice(i, i + 2);
      const results = await Promise.all(batch.map(async aq => {
        try {
          const u = 'https://www.bing.com/news/search?q=' + encodeURIComponent(aq.q) + '&format=rss';
          const xml = await _fetchText(u, 15000);
          return _parseRss(xml);
        } catch (e) { return []; }
      }));
      for (const arr of results) for (const it of arr) {
        if (!_accept(it.title, it.desc)) { stats.dropped++; continue; }
        if (!_freshOk(it.pub, 2)) { stats.dropped++; continue; }
        push(_mkItem({ title: it.title, url: it.link, desc: it.desc, date: it.pub, source: 'Bing News·' + _host(it.link), channel: 'bing' }), 'bing');
      }
    }
  }

  /* L3：高危国别本地小源直采（并发 3；legacy 走 curl 兜底） */
  if (!opts.skipLocal) {
    for (let i = 0; i < LOCAL_FEEDS.length; i += 3) {
      const batch = LOCAL_FEEDS.slice(i, i + 3);
      const results = await Promise.all(batch.map(async f => {
        try {
          const xml = await _fetchText(f.url, 15000, f.legacy);
          return _parseRss(xml).map(it => ({ it, f }));
        } catch (e) { return []; }
      }));
      for (const arr of results) for (const { it, f } of arr) {
        if (!_accept(it.title, it.desc)) continue;   /* 本地源是综合新闻，大量不命中属正常，不计 dropped */
        if (!_freshOk(it.pub, 2)) continue;
        push(_mkItem({ title: it.title, url: it.link, desc: it.desc, date: it.pub, source: f.name, country: f.country, iso: f.iso, channel: 'local' }), 'local');
      }
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('[CNSEC-WATCH] 一轮(' + sec + 's): 候选 ' + out.length + '（gdelt ' + stats.gdelt + ' / gnews ' + stats.gnews + ' / bing ' + stats.bing + ' / 本地小源 ' + stats.local + '，过滤丢弃 ' + stats.dropped + '）');
  return { items: out, count: out.length, stats };
}

module.exports = { runCnSecurityWatch, GDELT_QUERIES, ATOMIC_QUERIES, LOCAL_FEEDS, CN_RE, VIOLENCE_RE };
