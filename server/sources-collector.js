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

/* ===== 2026-08-29 国别码归一化（根因修复：异动信号出现 PK/CN/BR 裸码 + CN 混进异动监测）=====
 * sources-registry 的 country 字段存 ISO 两位码，原样落库导致：
 * ① 异动引擎"中国"过滤（按中文名匹配）失效 → "CN·地缘情报"混进异动监测（海外利益平台，中国是行为主体永不是异动国）；
 * ② INTEREST_BASE.getTier('PK') 按中文名查梯队落空 → TIER 判定失真；
 * ③ 前端直接渲染裸码。出口统一归一化为中文国名。 */
const ISO2CN = {
  CN:'中国', US:'美国', GB:'英国', FR:'法国', HK:'中国香港', MO:'中国澳门', TW:'中国台湾',
  PK:'巴基斯坦', LK:'斯里兰卡', BD:'孟加拉国', ID:'印尼', VN:'越南', MY:'马来西亚', TH:'泰国',
  MM:'缅甸', KH:'柬埔寨', LA:'老挝', KZ:'哈萨克斯坦', UZ:'乌兹别克斯坦', TJ:'塔吉克斯坦',
  KG:'吉尔吉斯斯坦', RU:'俄罗斯', SA:'沙特', AE:'阿联酋', QA:'卡塔尔', IR:'伊朗', IQ:'伊拉克',
  EG:'埃及', DZ:'阿尔及利亚', NG:'尼日利亚', ZA:'南非', CD:'刚果（金）', GN:'几内亚',
  ET:'埃塞俄比亚', KE:'肯尼亚', MZ:'莫桑比克', AO:'安哥拉', DJ:'吉布提', BR:'巴西', PE:'秘鲁',
  AR:'阿根廷', CL:'智利', MX:'墨西哥', BO:'玻利维亚', EC:'厄瓜多尔', DE:'德国', RS:'塞尔维亚',
  HU:'匈牙利', GR:'希腊', CA:'加拿大', AU:'澳大利亚', PG:'巴布亚新几内亚', SB:'所罗门群岛',
  JP:'日本', KR:'韩国', KP:'朝鲜', IN:'印度', TR:'土耳其', UA:'乌克兰', IL:'以色列', PS:'巴勒斯坦',
  SD:'苏丹', LY:'利比亚', SO:'索马里', ML:'马里', NE:'尼日尔', TD:'乍得', SY:'叙利亚',
  YE:'也门', LB:'黎巴嫩', JO:'约旦', MA:'摩洛哥', TN:'突尼斯', TZ:'坦桑尼亚', UG:'乌干达',
  ZM:'赞比亚', ZW:'津巴布韦', MW:'马拉维', BW:'博茨瓦纳', NA:'纳米比亚', SN:'塞内加尔',
  BF:'布基纳法索', CM:'喀麦隆', CI:'科特迪瓦', SG:'新加坡', PH:'菲律宾', MN:'蒙古',
  PL:'波兰', BY:'白俄罗斯', RO:'罗马尼亚', CZ:'捷克', SK:'斯洛伐克', BG:'保加利亚',
  FI:'芬兰', SE:'瑞典', NO:'挪威', DK:'丹麦', NL:'荷兰', BE:'比利时', CH:'瑞士',
  AT:'奥地利', IT:'意大利', ES:'西班牙', PT:'葡萄牙', IE:'爱尔兰', NZ:'新西兰'
};
function iso2cn(c) {
  if (!c) return '';
  if (/[\u4e00-\u9fa5]/.test(String(c))) return String(c); /* 已是中文 */
  return ISO2CN[String(c).toUpperCase()] || '';
}

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
      publish_time: it.pubDate || '', source: s.name,
      /* 2026-08-29 国别归一化：ISO 码→中文；CN 源（中新网/新华网一带一路频道）中国是
       * 报道主体永不是事发地，按标题/摘要提取事发国，提不到留空（不落"中国"）。 */
      country: s.country === 'CN'
        ? (scrapers.extractOverseasCountry((it.title || '') + ' ' + (it.description || '')) || '')
        : iso2cn(s.country),
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
      country: p._c || iso2cn(meta.country) || '', /* 2026-08-29：ISO 码→中文归一化 */
      stance: meta.stance || 'I',
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
