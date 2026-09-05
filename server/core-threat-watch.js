/* ===== 海外核心安全威胁一分钟哨兵（2026-08-27 用户铁指令）=====
 * 7×24 每 60 秒一轮：专门针对
 *   · 巴基斯坦（中巴经济走廊/CPEC）
 *   · 阿富汗
 *   · 非洲（萨赫勒、非洲之角、中非、东非、西非、南部非洲）
 *   · 中亚（哈萨克斯坦、乌兹别克斯坦、吉尔吉斯斯坦、塔吉克斯坦、土库曼斯坦）
 *   · 东南亚（缅甸、泰国、菲律宾、印尼、马来西亚、柬埔寨、老挝、越南）
 * 采集四类核心安全事件：恐怖袭击、海外袭击、绑架、重大刑事案件。
 *
 * 设计原则：
 *  1. 高频：1 分钟一轮，确保突发事件第一时间进入系统。
 *  2. 定向：不以全球泛检索浪费配额，而是按「区域×事件类型」矩阵分轮查询。
 *  3. 多源：GDELT DOC 2.0（复杂布尔）+ Google/Bing News RSS（原子词）+ 高危本地 RSS 直采。
 *  4. 保真：标题+摘要必须命中事件类型词；严禁把日常执法/选举/体育/经济噪声当安全事件。
 *  5. 入库：本模块只采集不直接写库；server.js 每 60 秒调用一次，走 _ingestLinkedItems 既有闸门。
 */
'use strict';
const netx = require('./netx.js');
const crawler = require('./crawler.js');
const globalmedia = require('./globalmedia.js');
const { execFile } = require('child_process');

/* ---- 目标区域定义 ---- */
const REGIONS = {
  pakistan: { name: '巴基斯坦（CPEC）', iso: 'PAK', cn: '巴基斯坦', keywords:/pakistan|pakistani|karachi|islamabad|lahore|peshawar|balochistan|khyber|punjab|sindh|gwadar|cpec|中巴经济走廊|巴基斯坦/i },
  afghanistan: { name: '阿富汗', iso: 'AFG', cn: '阿富汗', keywords:/afghanistan|afghan|kabul|kandahar|herat|taliban|阿富汗/i },
  africa_sahel: { name: '萨赫勒', iso: 'MLI', cn: '马里', keywords:/mali|malian|bamako|niger|niamey|burkina faso|ouagadougou|sahel|tuareg|jnim|wagner|马里|尼日尔|布基纳法索|萨赫勒/i },  // 代表萨赫勒片区
  africa_horn: { name: '非洲之角', iso: 'SOM', cn: '索马里', keywords:/somalia|somali|mogadishu|al-shabaab|horn of africa|ethiopia|ethiopian|addis ababa|索马里|埃塞俄比亚/i },
  africa_central: { name: '中非', iso: 'CAF', cn: '中非', keywords:/central african republic|car\b|bangui|drc\b|congo|congolese|kinshasa|rwanda|kigali|goma|bukavu|中非|刚果金|刚果（金）|刚果民主共和国/i },
  africa_east: { name: '东非', iso: 'KEN', cn: '肯尼亚', keywords:/kenya|kenyan|nairobi|mombasa|tanzania|dar es salaam|uganda|kampala|rwanda|东非|肯尼亚|坦桑尼亚/i },
  africa_west: { name: '西非', iso: 'NGA', cn: '尼日利亚', keywords:/nigeria|nigerian|lagos|abuja|mali|burkina faso|niger|ghana|accra|ivory coast|cote d'ivoire|senegal|dakar|西非|尼日利亚/i },
  africa_south: { name: '南部非洲', iso: 'ZAF', cn: '南非', keywords:/south africa|south african|johannesburg|durban|cape town|zimbabwe|harare|zambia|lusaka|mozambique|angola|luanda|南部非洲|南非/i },
  central_asia: { name: '中亚', iso: 'KAZ', cn: '哈萨克斯坦', keywords:/kazakhstan|kazakh|almaty|astana|kyrgyzstan|bishkek|tajikistan|dushanbe|uzbekistan|tashkent|turkmenistan|ashgabat|central asia|中亚|哈萨克斯坦|吉尔吉斯斯坦|塔吉克斯坦|乌兹别克斯坦/i },
  southeast_asia: { name: '东南亚', iso: 'MMR', cn: '缅甸', keywords:/myanmar|burma|burmese|yangon|rangoon|naypyitaw|philippines|filipino|manila|thailand|thai|bangkok|indonesia|indonesian|jakarta|malaysia|malaysian|kuala lumpur|cambodia|phnom penh|laos|vientiane|vietnam|vietnamese|hanoi|ho chi minh|东南亚|缅甸|菲律宾|泰国|印尼|马来西亚/i }
};

/* ---- 事件类型正则（标题+摘要必须命中） ---- */
const EVENT_RE = /terror|terrorist|terrorism|attack|attacked|attacks|ambush|ambushed|shooting|shootings|shot|gunmen|gunfire|kidnap|kidnapped|kidnapping|abduct|abducted|abduction|hostage|hostages|ransom|blast|bomb|bombing|suicide|militant|insurgent|extremist|ISIS|Taliban|Boko Haram|Al-Shabaab|Al-Qaeda|Ansar|assault|raid|massacre|murder|murdered|killed|dead|death|deaths|casualt|violence|criminal|crime|robbery|robbers|bandits|gang|gangs|homicide|shootout|extortion|threat|threaten|恐吓|袭击|恐袭|绑架|劫持|人质|赎金|爆炸|枪击|武装|极端组织|塔利班|博科圣地|青年党|基地组织|伊斯兰国|伏击|突袭|屠杀|谋杀|遇害|身亡|遇难|死亡|伤亡|暴力|犯罪|抢劫|帮派|匪徒|恐怖分子/i;

/* ---- 噪声过滤：必须排除这些主题 ---- */
const NOISE_RE = /\bfootball\b|\bsoccer\b|\bFIFA\b|\bWorld Cup\b|\bmatch\b|\bscore\b|\btransfer\b|\bNBA\b|\btennis\b|election|poll|vote|campaign|parliament|senate|congress|minister|president said|prime minister|diplomat|summit|bilateral|trade deal|tariff|sanction|stock|shares|rally|market|GDP|inflation|chip|semiconductor|cyber|hacker|data breach|weather|forecast|climate|flood|earthquake|typhoon|festival|celebration|award|concert|movie|娱乐|选举|投票|议会|部长|总统|总理|外交|峰会|贸易|关税|制裁|股价|股市|芯片|黑客|天气|预报|气候|洪水|地震|台风|节日|庆典|电影|娱乐/i;

/* ---- 涉华要素（用于标记 interestLinked/ChinaRelated，但非涉华事件也入库） ---- */
const CN_RE = /china|chinese|beijing|中国|中资|中企|中方|华人|华侨|华裔|chinois|chinoise|\bchinos?\b|chinesa|chineses|citoyens chinois|一带一路|cpec|中巴经济走廊|gwadar|瓜达尔|karachi|卡拉奇|islamabad/i;

/* ---- L1：GDELT 区域×事件类型复杂布尔矩阵 ---- */
/* 每个查询含一个区域词组 + 一个事件类型词组；GDELT 2 天窗口，单查询 15 条 */
const GDELT_QUERIES = [
  /* 巴基斯坦 CPEC */
  { id:'pak-terror',  focus:'巴基斯坦/CPEC·恐袭', region:REGIONS.pakistan,
    q:'sourcecountry:PK (terror OR terrorist OR bombing OR suicide OR blast OR attack OR attacked OR ambush OR gunmen OR shooting OR militant OR Taliban OR ISIS OR Jaish OR Baloch OR TTP)' },
  { id:'pak-attack',  focus:'巴基斯坦/CPEC·袭击', region:REGIONS.pakistan,
    q:'sourcecountry:PK (attack OR attacked OR assault OR raid OR ambush OR gunfire OR shooting OR bomb OR explosion OR blast OR target OR killed)' },
  { id:'pak-kidnap',  focus:'巴基斯坦/CPEC·绑架', region:REGIONS.pakistan,
    q:'sourcecountry:PK (kidnap OR kidnapped OR kidnapping OR abduct OR abducted OR abduction OR hostage OR hostages OR ransom OR seized)' },
  { id:'pak-crime',   focus:'巴基斯坦/CPEC·重大刑案', region:REGIONS.pakistan,
    q:'sourcecountry:PK (murder OR murdered OR killing OR killed OR dead OR massacre OR gang OR criminal OR crime OR robbery OR shootout OR violence)' },

  /* 阿富汗 */
  { id:'afg-terror',  focus:'阿富汗·恐袭', region:REGIONS.afghanistan,
    q:'sourcecountry:AF (terror OR terrorist OR bombing OR suicide OR blast OR attack OR attacked OR ambush OR gunmen OR shooting OR militant OR Taliban OR ISIS)' },
  { id:'afg-kidnap',  focus:'阿富汗·绑架', region:REGIONS.afghanistan,
    q:'sourcecountry:AF (kidnap OR kidnapped OR kidnapping OR abduct OR abducted OR abduction OR hostage OR hostages OR ransom)' },

  /* 非洲片区（按 sourcecountry 分批，避免布尔过长） */
  { id:'africa-mali', focus:'马里/萨赫勒·恐袭绑架', region:REGIONS.africa_sahel,
    q:'sourcecountry:ML (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR militant OR JNIM OR Wagner OR blast OR shooting)' },
  { id:'africa-niger',focus:'尼日尔/萨赫勒·恐袭绑架', region:REGIONS.africa_sahel,
    q:'sourcecountry:NG (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR militant OR JNIM OR blast)' },
  { id:'africa-burkina',focus:'布基纳法索·恐袭绑架', region:REGIONS.africa_sahel,
    q:'sourcecountry:UV (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR militant OR JNIM OR blast)' },
  { id:'africa-somalia',focus:'索马里·恐袭绑架', region:REGIONS.africa_horn,
    q:'sourcecountry:SO (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR Al-Shabaab OR blast OR shooting)' },
  { id:'africa-nigeria',focus:'尼日利亚·恐袭绑架刑案', region:REGIONS.africa_west,
    q:'sourcecountry:NI (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR bandit OR gunmen OR Boko Haram OR criminal OR murder)' },
  { id:'africa-kenya',focus:'肯尼亚·恐袭绑架刑案', region:REGIONS.africa_east,
    q:'sourcecountry:KE (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR Al-Shabaab OR blast OR shooting)' },
  { id:'africa-car',focus:'中非·恐袭绑架', region:REGIONS.africa_central,
    q:'sourcecountry:CT (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR militia OR blast OR shooting)' },
  { id:'africa-drc',focus:'刚果（金）·恐袭绑架刑案', region:REGIONS.africa_central,
    q:'sourcecountry:CG (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR militia OR criminal OR murder OR shooting)' },
  { id:'africa-south',focus:'南非·重大刑案', region:REGIONS.africa_south,
    q:'sourcecountry:SF (murder OR killed OR shooting OR gang OR robbery OR criminal OR kidnapping OR abduct)' },

  /* 中亚 */
  { id:'ca-kaz',focus:'哈萨克斯坦·安全事件', region:REGIONS.central_asia,
    q:'sourcecountry:KZ (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR criminal OR murder)' },
  { id:'ca-kgz',focus:'吉尔吉斯斯坦·安全事件', region:REGIONS.central_asia,
    q:'sourcecountry:KG (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR criminal)' },
  { id:'ca-tjk',focus:'塔吉克斯坦·安全事件', region:REGIONS.central_asia,
    q:'sourcecountry:TI (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR criminal)' },
  { id:'ca-uzb',focus:'乌兹别克斯坦·安全事件', region:REGIONS.central_asia,
    q:'sourcecountry:UZ (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR criminal)' },

  /* 东南亚 */
  { id:'sea-myanmar',focus:'缅甸·恐袭刑案', region:REGIONS.southeast_asia,
    q:'sourcecountry:BM (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR coup OR junta OR military OR insurgent)' },
  { id:'sea-philippines',focus:'菲律宾·恐袭绑架', region:REGIONS.southeast_asia,
    q:'sourcecountry:RP (terror OR attack OR kidnap OR kidnapped OR abduct OR hostage OR Abu Sayyaf OR blast OR shooting)' },
  { id:'sea-thailand',focus:'泰国·恐袭绑架刑案', region:REGIONS.southeast_asia,
    q:'sourcecountry:TH (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR criminal)' },
  { id:'sea-indonesia',focus:'印尼·恐袭刑案', region:REGIONS.southeast_asia,
    q:'sourcecountry:ID (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR militant)' },
  { id:'sea-malaysia',focus:'马来西亚·恐袭绑架刑案', region:REGIONS.southeast_asia,
    q:'sourcecountry:MY (terror OR attack OR kidnap OR abduct OR hostage OR blast OR shooting OR criminal)' }
];

/* ---- L2：Google/Bing News RSS 原子查询 ---- */
/* 搜索引擎不支持括号分组，用原子词 + site: 限定高频国别媒体域名不现实；
 * 策略：原子词 = 区域名/城市名 + 事件类型 + (Chinese) ，结果靠标题正则二次过滤 */
const ATOMIC_QUERIES = [
  /* 巴基斯坦 */
  { q:'Pakistan terrorist attack', region:REGIONS.pakistan },
  { q:'Pakistan kidnapping Chinese', region:REGIONS.pakistan },
  { q:'Pakistan CPEC attack',        region:REGIONS.pakistan },
  { q:'Karachi blast shooting',      region:REGIONS.pakistan },
  { q:'Peshawar bombing',            region:REGIONS.pakistan },
  { q:'Balochistan attack',          region:REGIONS.pakistan },

  /* 阿富汗 */
  { q:'Afghanistan Taliban attack', region:REGIONS.afghanistan },
  { q:'Kabul blast bombing',        region:REGIONS.afghanistan },
  { q:'Afghanistan kidnapping',     region:REGIONS.afghanistan },

  /* 非洲 */
  { q:'Mali terrorist attack',     region:REGIONS.africa_sahel },
  { q:'Niger attack JNIM',         region:REGIONS.africa_sahel },
  { q:'Burkina Faso attack',       region:REGIONS.africa_sahel },
  { q:'Somalia Al-Shabaab attack', region:REGIONS.africa_horn },
  { q:'Nigeria kidnapping bandits',region:REGIONS.africa_west },
  { q:'Kenya attack Al-Shabaab',   region:REGIONS.africa_east },
  { q:'DRC kidnapping',            region:REGIONS.africa_central },
  { q:'South Africa shooting gang',region:REGIONS.africa_south },

  /* 中亚 */
  { q:'Kazakhstan attack shooting', region:REGIONS.central_asia },
  { q:'Kyrgyzstan border clash',    region:REGIONS.central_asia },
  { q:'Tajikistan attack',          region:REGIONS.central_asia },
  { q:'Uzbekistan attack',          region:REGIONS.central_asia },

  /* 东南亚 */
  { q:'Myanmar attack shooting',    region:REGIONS.southeast_asia },
  { q:'Philippines kidnapping Abu Sayyaf', region:REGIONS.southeast_asia },
  { q:'Thailand shooting crime',    region:REGIONS.southeast_asia },
  { q:'Indonesia terrorist attack', region:REGIONS.southeast_asia },
  { q:'Malaysia kidnapping',        region:REGIONS.southeast_asia }
];

/* ---- L3：高危国别本地 RSS 直采 ---- */
const LOCAL_FEEDS = [
  /* 巴基斯坦 */
  { name:'Dawn Pakistan', url:'https://www.dawn.com/feeds/home/', country:'巴基斯坦', iso:'PAK' },
  { name:'The News Pakistan', url:'https://www.thenews.com.pk/rss/today', country:'巴基斯坦', iso:'PAK' },
  { name:'Express Tribune', url:'https://tribune.com.pk/rss', country:'巴基斯坦', iso:'PAK' },
  /* 阿富汗 */
  { name:'Pajhwok Afghan News', url:'https://pajhwok.com/feed/', country:'阿富汗', iso:'AFG' },
  { name:'Kabul Now', url:'https://kabulnow.com/feed/', country:'阿富汗', iso:'AFG' },
  /* 非洲 */
  { name:'Actualité.cd', url:'https://actualite.cd/rss.xml', country:'刚果（金）', iso:'COD' },
  { name:'Radio Okapi', url:'https://www.radiookapi.net/feed', country:'刚果（金）', iso:'COD' },
  { name:'Premium Times Nigeria', url:'https://www.premiumtimesng.com/feed', country:'尼日利亚', iso:'NGA' },
  { name:'Garowe Online', url:'https://www.garoweonline.com/feed', country:'索马里', iso:'SOM' },
  { name:'Shabelle News', url:'https://www.shabellenews.com/feed', country:'索马里', iso:'SOM' },
  { name:'Daily Maverick', url:'https://www.dailymaverick.co.za/rss', country:'南非', iso:'ZAF' },
  /* 中亚 */
  { name:'AKIpress', url:'https://akipress.com/news.rss', country:'吉尔吉斯斯坦', iso:'KGZ' },
  { name:'Asia-Plus', url:'https://asiaplustj.info/ru/rss/news', country:'塔吉克斯坦', iso:'TJK' },
  /* 东南亚 */
  { name:'The Irrawaddy', url:'https://www.irrawaddy.com/feed/', country:'缅甸', iso:'MMR' },
  { name:'BenarNews Myanmar', url:'https://www.benarnews.org/english/news/myanmar/rss.xml', country:'缅甸', iso:'MMR' },
  { name:'Rappler', url:'https://www.rappler.com/feed/', country:'菲律宾', iso:'PHL' },
  { name:'Bangkok Post', url:'https://www.bangkokpost.com/rss/news.xml', country:'泰国', iso:'THA' },
  { name:'The Nation Thailand', url:'https://www.nationthailand.com/feed', country:'泰国', iso:'THA' }
];

/* ---- 工具函数 ---- */
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
  if (!dateStr) return true;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return true;
  return (Date.now() - t) <= (maxDays || 2) * 24 * 3600 * 1000;
}
function _eventCategory(title, desc) {
  const t = (String(title || '') + ' ' + String(desc || '')).toLowerCase();
  if (/kidnap|abduct|hostage|ransom|绑架|劫持|人质|赎金/.test(t)) return '绑架案';
  if (/terror|terrorist|bomb|suicide|isis|taliban|boko|shabaab|qaeda|militant|extremist|恐袭|恐怖分子|爆炸|自杀式/.test(t)) return '恐怖袭击';
  if (/attack|ambush|shooting|gunmen|gunfire|assault|raid|blast|袭击|伏击|枪击|武装/.test(t)) return '海外袭击';
  if (/murder|killed|dead|death|casualt|massacre|criminal|crime|robbery|gang|shootout|homicide|violence|murdered|遇害|身亡|遇难|死亡|屠杀|犯罪|抢劫|帮派/.test(t)) return '重大刑事案件';
  return '安全事件';
}
function _level(region, hasChina, cat) {
  if (hasChina) return 'red';
  if (cat === '恐怖袭击' || cat === '绑架案') return 'orange';
  if (region.iso === 'PAK' || region.iso === 'AFG' || region.iso === 'SOM' || region.iso === 'MLI' || region.iso === 'COD') return 'orange';
  return 'yellow';
}
function _accept(title, desc, region, channel) {
  const t = String(title || '');
  const all = t + ' ' + String(desc || '');
  if (t.length < 10) return false;
  if (!EVENT_RE.test(all)) return false;
  if (NOISE_RE.test(t)) return false;
  if (globalmedia._isSoftJunk && globalmedia._isSoftJunk(t)) return false;
  if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(t)) return false;
  /* 非 GDELT 通道（GNews/Bing/本地 RSS）必须命中对应区域关键词，避免搜索漂移 */
  if (region && region.keywords && channel !== 'gdelt') {
    if (!region.keywords.test(all)) return false;
  }
  /* 全通道标题必须命中至少一个区域关键词或明确事件地点词，杜绝「9/11 审判在美国」被标成巴基斯坦 */
  if (region && region.keywords && channel === 'gdelt') {
    if (!region.keywords.test(all)) return false;
  }
  return true;
}

/* GDELT seendate 格式化 */
function _gdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z';
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
    } catch (e) {}
  }
  return _curlFetch(url, timeoutMs);
}
function _dataTypeForCategory(cat) {
  if (cat === '恐怖袭击' || cat === '海外袭击') return 'terror_events';
  if (cat === '绑架案' || cat === '重大刑事案件') return 'security_events';
  return 'terror_events';
}
function _mkItem(o) {
  const iso = o.date ? new Date(o.date) : null;
  const isoStr = iso && !isNaN(iso.getTime()) ? iso.toISOString() : '';
  const cat = _eventCategory(o.title, o.desc);
  const hasChina = CN_RE.test(o.title + ' ' + o.desc);
  const region = o.region || REGIONS.southeast_asia;
  return {
    title: String(o.title || '').trim(),
    url: String(o.url || '').trim(),
    source: o.source || _host(o.url) || '核心威胁哨兵',
    domain: _host(o.url),
    date: isoStr, publish_time: isoStr, publishedAt: isoStr, seendate: o.seendate || '',
    content: String(o.desc || '').slice(0, 600),
    country: region.cn, country_cn: region.cn, iso2: region.iso, country_iso: region.iso,
    interestLinked: true, category: cat, data_type: _dataTypeForCategory(cat),
    _coreThreatWatch: true, _forceDataType: true, _focus: o.focus || '',
    _sourceType: 'core_threat_watch',
    _fromSource: 'CORE-THREAT:' + (o.channel || 'search') + ':' + region.iso,
    chinaRelated: hasChina,
    level: _level(region, hasChina, cat),
    _real: true
  };
}

/* ---- 主流程 ---- */
async function runCoreThreatWatch(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const out = []; const seenUrl = new Set();
  const stats = { gdelt:0, gnews:0, bing:0, local:0, dropped:0 };
  const push = (it, ch) => {
    if (!it.url || seenUrl.has(it.url)) { stats.dropped++; return; }
    seenUrl.add(it.url); out.push(it); stats[ch]++;
  };

  /* L1：GDELT 区域×事件矩阵（按国家分组串行，组内并发 3） */
  if (!opts.skipGdelt) {
    const groups = {};
    GDELT_QUERIES.forEach(qs => {
      const iso = qs.region.iso;
      groups[iso] = groups[iso] || [];
      groups[iso].push(qs);
    });
    for (const iso of Object.keys(groups)) {
      const batch = groups[iso];
      for (let i = 0; i < batch.length; i += 3) {
        const slice = batch.slice(i, i + 3);
        const results = await Promise.all(slice.map(qs => Promise.race([
          crawler.gdeltSearch(qs.q, { timespan: opts.timespan || '2d', maxrecords: opts.maxPerQuery || 15 }),
          new Promise(resolve => setTimeout(() => resolve([]), 25000))
        ]).catch(() => [])));
        for (let k = 0; k < slice.length; k++) {
          const qs = slice[k];
          for (const a of (results[k] || [])) {
            if (!_accept(a.title, '', qs.region, 'gdelt')) { stats.dropped++; continue; }
            const d = _gdeltDate(a.seendate);
            if (d && !_freshOk(d, 2)) { stats.dropped++; continue; }
            push(_mkItem({ title:a.title, url:a.url, desc:'', date:d, seendate:a.seendate, source:a.domain, focus:qs.focus, channel:'gdelt', region:qs.region }), 'gdelt');
          }
        }
      }
    }
  }

  /* L2a：Google News RSS 原子查询（并发 3） */
  if (!opts.skipGnews) {
    for (let i = 0; i < ATOMIC_QUERIES.length; i += 3) {
      const batch = ATOMIC_QUERIES.slice(i, i + 3);
      const results = await Promise.all(batch.map(async aq => {
        try {
          const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent(aq.q + ' when:1d') + '&hl=en-US&gl=US&ceid=US:en';
          const xml = await _fetchText(u, 15000);
          return _parseRss(xml).map(it => ({ it, aq }));
        } catch (e) { return []; }
      }));
      for (const arr of results) for (const { it, aq } of arr) {
        if (!_accept(it.title, it.desc, aq.region, 'gnews')) { stats.dropped++; continue; }
        if (!_freshOk(it.pub, 2)) { stats.dropped++; continue; }
        push(_mkItem({ title:it.title, url:it.link, desc:it.desc, date:it.pub, source:'Google News·' + (_host(it.link) || aq.q), focus:aq.q, channel:'gnews', region:aq.region }), 'gnews');
      }
    }
  }

  /* L2b：Bing News RSS（英文原子集，并发 2） */
  if (!opts.skipBing) {
    for (let i = 0; i < ATOMIC_QUERIES.length; i += 2) {
      const batch = ATOMIC_QUERIES.slice(i, i + 2);
      const results = await Promise.all(batch.map(async aq => {
        try {
          const u = 'https://www.bing.com/news/search?q=' + encodeURIComponent(aq.q) + '&format=rss';
          const xml = await _fetchText(u, 15000);
          return { aq, items: _parseRss(xml) };
        } catch (e) { return { aq: batch[0], items: [] }; }
      }));
      for (const { aq, items } of results) for (const it of items) {
        if (!_accept(it.title, it.desc, aq.region, 'bing')) { stats.dropped++; continue; }
        if (!_freshOk(it.pub, 2)) { stats.dropped++; continue; }
        push(_mkItem({ title:it.title, url:it.link, desc:it.desc, date:it.pub, source:'Bing News·' + _host(it.link), channel:'bing', region:aq.region }), 'bing');
      }
    }
  }

  /* L3：本地 RSS 直采（并发 4；未命中不计 dropped） */
  if (!opts.skipLocal) {
    for (let i = 0; i < LOCAL_FEEDS.length; i += 4) {
      const batch = LOCAL_FEEDS.slice(i, i + 4);
      const results = await Promise.all(batch.map(async f => {
        try {
          const xml = await _fetchText(f.url, 15000, f.legacy);
          return _parseRss(xml).map(it => ({ it, f }));
        } catch (e) { return []; }
      }));
      for (const arr of results) for (const { it, f } of arr) {
        const region = Object.values(REGIONS).find(r => r.iso === f.iso) || { cn:f.country, iso:f.iso, keywords:null };
        if (!_accept(it.title, it.desc, region, 'local')) continue;
        if (!_freshOk(it.pub, 2)) continue;
        push(_mkItem({ title:it.title, url:it.link, desc:it.desc, date:it.pub, source:f.name, channel:'local', region:region }), 'local');
      }
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('[CORE-THREAT] 一分钟哨兵(' + sec + 's): 候选 ' + out.length + '（gdelt ' + stats.gdelt + ' / gnews ' + stats.gnews + ' / bing ' + stats.bing + ' / 本地 ' + stats.local + '，过滤 ' + stats.dropped + '）');
  return { items: out, count: out.length, stats };
}

module.exports = { runCoreThreatWatch, REGIONS, GDELT_QUERIES, ATOMIC_QUERIES, LOCAL_FEEDS };
