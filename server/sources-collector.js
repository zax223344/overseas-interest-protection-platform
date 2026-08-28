/* sources-collector.js — 94 源工程包采集器（2026-08-28）
 * ================================================================
 * 用户提供 94 源目录（sources-registry.js），实测 feeds 活源 11 个。
 * 采集架构（不建独立 Python 系统，全并入既有 Node/PG 链路）：
 *   ① 活源直采：11 个真实 RSS（netx + 竞速）→ 走既有闸门入库
 *   ② 死源复活：GNews site: 检索替代（Reuters/AP/SCMP 等 RSS 死了，
 *      但 site:reuters.com 检索通道活着——media_feeds.js 已验证模式）
 *   ③ stance 立场标签随条目入库 data_json.stance，供证据链使用
 * 铁律：零模拟；只采真实抓取内容；过 chinaOverseasGate。
 * ================================================================ */
'use strict';
const netx = require('./netx');
const scrapers = require('./scrapers');
const { SOURCES, rssSources, get } = require('./sources-registry');

/* 实测活源（2026-08-28 两轮探测 + 重试确认） */
const LIVE_RSS_IDS = [
  'cn_chinanews', 'pk_app', 'ru_tass', 'ng_premiumtimes', 'ng_vanguard',
  'br_folha', 'br_brasil247', 'pe_andina', 'bbc_world', 'th_bangkokpost', 'qa_aljazeera'
];

/* 死源 → GNews site: 复活清单（取工程包高价值死源，每轮轮换查 2 个站）
 * 2026-08-28 扩充（用户指令：34 重点国全覆盖）：补零产出国
 * 沙特/阿联酋/秘鲁/阿尔及利亚/安哥拉 + 低产出国 印尼/刚果金/智利/越南/柬埔寨 */
const SITE_REVIVE = [
  { id: 'reuters',        site: 'reuters.com',        q: 'china OR Chinese' },
  { id: 'apnews',         site: 'apnews.com',         q: 'china OR Chinese' },
  { id: 'scmp',           site: 'scmp.com',           q: 'china' },
  { id: 'pk_dawn',        site: 'dawn.com',           q: 'CPEC OR China OR Gwadar' },
  { id: 'pk_tribune',     site: 'tribune.com.pk',     q: 'CPEC OR China' },
  { id: 'id_antara',      site: 'antaranews.com',     q: 'china OR investment' },
  { id: 'kz_kazinform',   site: 'inform.kz',          q: 'china OR investment' },
  { id: 'sa_arabnews',    site: 'arabnews.com',       q: 'china' },
  { id: 'aljazeera_alt',  site: 'aljazeera.com',      q: 'china belt road' },
  { id: 'un_news_alt',    site: 'news.un.org',        q: 'china' },
  { id: 'irrawaddy',      site: 'irrawaddy.com',      q: 'china OR pipeline' },
  { id: 'premium_alt',    site: 'premiumtimesng.com', q: 'china OR kidnapped' },
  /* ——— 2026-08-28 重点国扩充（34 国全覆盖）——— */
  { id: 'sa_gulfnews',    site: 'gulfnews.com',       q: 'china OR Chinese',        _c: '阿联酋' },
  { id: 'ae_khaleej',     site: 'khaleejtimes.com',   q: 'china OR trade',          _c: '阿联酋' },
  { id: 'pe_comercio',    site: 'elcomercio.pe',      q: 'chancay OR china',        _c: '秘鲁' },
  { id: 'dz_aps',         site: 'aps.dz',             q: 'china OR algerian',       _c: '阿尔及利亚' },
  { id: 'ao_angop',       site: 'angop.ao',           q: 'china OR investment',     _c: '安哥拉' },
  { id: 'id_jakpost',     site: 'jakartapost.com',    q: 'china OR nickel',         _c: '印尼' },
  { id: 'id_tempo',       site: 'tempo.co',           q: 'china OR smelter',        _c: '印尼' },
  { id: 'cd_actualite',   site: 'actualite.cd',       q: 'chinois OR mine',         _c: '刚果（金）' },
  { id: 'cl_mercurio',    site: 'emol.com',           q: 'china OR lithium',        _c: '智利' },
  { id: 'vn_vnexpress',   site: 'vnexpress.net',      q: 'china OR trade',          _c: '越南' },
  { id: 'kh_phnom',       site: 'phnompenhpost.com',  q: 'china OR investment',     _c: '柬埔寨' },
  { id: 'th_nation',      site: 'nationthailand.com', q: 'china OR rail',           _c: '泰国' },
  { id: 'my_star',        site: 'thestar.com.my',     q: 'china OR ECRL',           _c: '马来西亚' },
  { id: 'eg_ahram',       site: 'english.ahram.org.eg', q: 'china OR suez',         _c: '埃及' },
  { id: 'rs_tanjug',      site: 'tanjug.rs',          q: 'china OR railway',        _c: '塞尔维亚' },
  { id: 'mx_news',        site: 'mexiconewsdaily.com', q: 'china OR investment',    _c: '墨西哥' },
  { id: 'za_news24',      site: 'news24.com',         q: 'china OR mining',         _c: '南非' },
  { id: 'gn_guineenews',  site: 'guineenews.org',     q: 'simandou OR chine',       _c: '几内亚' },
  { id: 'tz_citizen',     site: 'thecitizen.co.tz',   q: 'china OR port',           _c: '坦桑尼亚' },
  { id: 'ke_standard',    site: 'standardmedia.co.ke', q: 'china OR railway',       _c: '肯尼亚' },
  { id: 'etReporter',     site: 'addisstandard.com',  q: 'china OR ethiopia',       _c: '埃塞俄比亚' },
  { id: 'zambia',         site: 'zambianobserver.com', q: 'china OR mine',          _c: '赞比亚' },
  { id: 'arg_buenos',     site: 'batimes.com.ar',     q: 'china OR lithium',        _c: '阿根廷' },
  { id: 'br_folha2',      site: 'agenciabrasil.ebc.com.br', q: 'china OR trade',   _c: '巴西' },
  { id: 'iq_iraqinews',   site: 'iraqinews.com',      q: 'china OR oil',            _c: '伊拉克' },
  { id: 'tj_asia',        site: 'asiaplustj.info',    q: 'china OR tajik',          _c: '塔吉克斯坦' },
  { id: 'uk_guardian',    site: 'theguardian.com',    q: 'china',                   _c: '英国' },
  { id: 'de_dw',          site: 'dw.com',             q: 'china OR chinese',        _c: '德国' },
  { id: 'jp_japantimes',  site: 'japantimes.co.jp',   q: 'china',                   _c: '日本' },
  { id: 'au_smh',         site: 'smh.com.au',         q: 'china OR darwin',         _c: '澳大利亚' },
  { id: 'ca_globe',       site: 'theglobeandmail.com', q: 'china',                  _c: '加拿大' }
];

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' };

async function _fetchText(url, ms) {
  return Promise.race([
    netx.smartFetch(url, { timeout: ms || 12000, headers: UA })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), (ms || 12000) + 2000))
  ]);
}

/* ① 活源直采 */
async function collectLiveRss(maxPerFeed) {
  const out = [];
  const live = rssSources().filter(s => LIVE_RSS_IDS.indexOf(s.id) >= 0);
  for (const s of live) {
    const text = await _fetchText(s.feeds[0], 12000);
    if (!text) continue;
    const items = (scrapers.parseRss(text) || []).slice(0, maxPerFeed || 10);
    items.forEach(it => out.push({
      title: it.title || '', content: it.description || '', url: it.link || s.url,
      publish_time: it.pubDate || '', source: s.name, country: s.country,
      stance: s.stance, risk_topics: s.risk_topics || [],
      _sourceType: 'sources_pack', _sourceId: s.id, region: s.region
    }));
  }
  return out;
}

/* ② 死源 GNews site: 复活（每轮轮换 4 个站，串行防限流）
 * 2026-08-28：2→4 站/轮（44 站全量 11 轮覆盖，15min/轮约 2.75h 全轮换一遍）；
 * 每轮保证 2 站来自零产出国优先级清单。 */
const PRIORITY_NATIONS = ['沙特', '阿联酋', '秘鲁', '阿尔及利亚', '安哥拉', '印尼', '刚果（金）', '智利', '越南', '柬埔寨'];
async function collectSiteRevive(cyc, maxPerQuery) {
  const out = [];
  const prio = SITE_REVIVE.filter(s => PRIORITY_NATIONS.indexOf(s._c) >= 0);
  const normal = SITE_REVIVE.filter(s => PRIORITY_NATIONS.indexOf(s._c) < 0);
  const picks = [
    prio[cyc % prio.length],
    prio[(cyc + 3) % prio.length],
    normal[cyc % normal.length],
    normal[(cyc + 5) % normal.length]
  ].filter(Boolean);
  for (const p of picks) {
    const meta = get(p.id) || {};
    const q = 'site:' + p.site + ' ' + p.q;
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:3d') + '&hl=en-US&gl=US&ceid=US:en';
    let text = await _fetchText(u, 12000);
    if (!text) { await new Promise(r => setTimeout(r, 2000)); text = await _fetchText(u, 12000); }
    if (!text) continue;
    const items = (scrapers.parseRss(text) || []).slice(0, maxPerQuery || 10);
    items.forEach(it => out.push({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: meta.name || p.site,
      country: p._c || meta.country || '', stance: meta.stance || 'I',
      risk_topics: meta.risk_topics || [],
      _sourceType: 'sources_pack', _sourceId: p.id, region: meta.region || ''
    }));
  }
  return out;
}

/* 统一入口：一轮 = 活源直采 + 2 个 site: 复活 */
async function runSourcesCollector(opts) {
  opts = opts || {};
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const live = await collectLiveRss(opts.maxPerFeed || 10);
  const revived = await collectSiteRevive(cyc, opts.maxPerQuery || 10);
  const all = live.concat(revived);
  /* URL 去重 */
  const seen = new Set();
  const uniq = all.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length, liveCount: live.length, revivedCount: revived.length };
}

module.exports = { runSourcesCollector, LIVE_RSS_IDS, SITE_REVIVE };
