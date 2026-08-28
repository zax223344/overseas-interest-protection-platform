/**
 * server/scrapers.js — 后端真实情报抓取（无 CORS 限制）
 *
 * 设计要点：
 *  1. 在 Node 服务端直接 fetch 外部开放源（USGS / GDACS / GDELT / ReliefWeb / WHO / Google News 等），
 *     浏览器同源调用 /api/scrape 不再受 CORS 限制 —— 这是"真正实时采集"的关键。
 *  2. 仅允许白名单主机（防 SSRF），且拒绝私有地址；绝不接受任意 url 直抓。
 *  3. 不依赖浏览器 DOM(DOMParser)，用轻量正则解析 RSS/Atom/GeoJSON/JSON。
 *  4. 所有抓取失败一律返回空数组，由前端回退到模板模拟 —— 系统永远"活"。
 *
 * 暴露：scrapeSource(key) / scrapeCategory(cat) / scrapeAll() / proxyFetchText(url)
 */
'use strict';
const netx = require('./netx');

/* ===== 主机白名单（SSRF 防护） ===== */
const ALLOWED_HOSTS = [
  'earthquake.usgs.gov', 'gdacs.org', 'api.gdeltproject.org', 'api.reliefweb.int',
  'who.int', 'news.google.com', 'feeds.bbci.co.uk', 'www.reutersagency.com',
  'www.xinhuanet.com', 'world.people.com.cn', 'chinese.people.com.cn', 'world.huanqiu.com',
  'www.ceic.ac.cn', 'mfa.gov.cn', 'www.mofcom.gov.cn', 'cdn.jsdelivr.net',
  'www.chinanews.com', 'chinanews.com',
  /* —— 特种兵爬虫目标主机（搜索引擎/社交/各国媒体，SSRF 白名单） —— */
  'www.bing.com', 'cn.bing.com',
  'www.reddit.com', 'old.reddit.com', 'hn.algolia.com',
  'www.aljazeera.com', 'www.france24.com', 'www.dw.com', 'www3.nhk.or.jp',
  'www.theguardian.com', 'apnews.com', 'www.scmp.com', 'www.straitstimes.com',
  'www.channelnewsasia.com', 'www.bangkokpost.com', 'www.jpost.com', 'tass.com',
  'www.rt.com', 'www.globaltimes.cn', 'www.chinadaily.com.cn', 'www.voanews.com',
  'mastodon.social', 'mastodon.world',
  /* ===== 国际开源情报源扩容（2026-07-30 接入，均为公开免费、无需 Key） =====
   * 说明：以下主机全部纳入 SSRF 白名单并注册为采集通道。部分境外主机在国内网络
   * 环境下直连超时（探测结果见 SOURCE_TIER='probe'），系统按退避策略周期性重试，
   * 网络条件具备时（境外部署/专线/代理）自动恢复供数，绝不因此伪造数据。 */
  /* — 国际主流媒体 — */
  'reuters.com', 'www.reuters.com', 'reutersagency.com', 'www.bbc.com', 'www.bbc.co.uk',
  'rss.dw.com', 'www.npr.org', 'feeds.npr.org', 'www.voachinese.com',
  'sputnikglobe.com', 'en.yna.co.kr', 'chinese.aljazeera.net',
  /* — 地缘政治智库 — */
  'www.understandingwar.org', 'understandingwar.org', 'www.cfr.org', 'cfr.org',
  'www.crisisgroup.org', 'crisisgroup.org', 'thediplomat.com', 'www.thediplomat.com',
  'carnegieendowment.org', 'www.chathamhouse.org', 'chathamhouse.org',
  'warontherocks.com', 'www.rand.org', 'rand.org', 'eurasianet.org', 'www.eurasianet.org',
  /* — 聚合 / 立场对比 — */
  'ground.news', 'www.allsides.com',
  /* — 联合国 / 人道 / 冲突数据 — */
  'news.un.org', 'www.who.int', 'digitallibrary.un.org', 'api.unhcr.org',
  'data.humdata.org', 'www.hrw.org', 'hrw.org', 'www.amnesty.org',
  'www.internal-displacement.org', 'internal-displacement.org', 'acleddata.com',
  /* — 灾害 / 地球观测 — */
  'www.seismicportal.eu', 'seismicportal.eu', 'eonet.gsfc.nasa.gov', 'services.swpc.noaa.gov',
  /* — 学术 / 军备 / 冲突数据库 — */
  'www.sipri.org', 'sipri.org', 'ucdp.uu.se', 'correlatesofwar.org', 'www.start.umd.edu',
  /* — 制裁 / 贸易 / 政府开放数据 — */
  'ustr.gov', 'www.ustr.gov', 'ofac.treasury.gov', 'home.treasury.gov',
  'data.gov', 'www.data.gov', 'data.europa.eu', 'data.gov.uk', 'open.canada.ca',
  'data.gov.au', 'www.data.gouv.fr',
  /* — 百科 / 知识图谱 — */
  'zh.wikipedia.org', 'en.wikipedia.org', 'query.wikidata.org', 'archive.org',
  /* — 海运 / 领事保护 / 合规官方源（2026-08-28 六维哨兵：通道/合规/领保直采） — */
  'gcaptain.com', 'www.gcaptain.com', 'maritime-executive.com', 'www.maritime-executive.com',
  'fleetmon.com', 'www.fleetmon.com', 'cs.mfa.gov.cn', 'www.mfa.gov.cn',
  'www.bis.gov', 'bis.gov', 'home.treasury.gov', 'ofac.treasury.gov'
];
function _hostAllowed(host) {
  if (!host) return false;
  host = host.toLowerCase();
  // 拒绝私有/内网地址
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === 'localhost' || host === '0.0.0.0') return false;
  return ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

/* ===== 国家/地区名称表（中英，用于从标题抽取国家） ===== */
const COUNTRIES = [
  '巴基斯坦', '苏丹', '缅甸', '刚果(金)', '刚果', '尼日利亚', '伊拉克', '也门', '马里', '尼日尔',
  '肯尼亚', '埃塞俄比亚', '秘鲁', '墨西哥', '南非', '伊朗', '印度', '土耳其', '埃及', '哥伦比亚',
  '菲律宾', '阿富汗', '叙利亚', '孟加拉国', '泰国', '阿尔及利亚', '阿根廷', '智利', '委内瑞拉',
  '利比亚', '索马里', '中非', '莫桑比克', '坦桑尼亚', '赞比亚', '津巴布韦', '乌克兰', '阿联酋',
  '沙特', '哈萨克斯坦', '蒙古', '老挝', '柬埔寨', '印尼', '马来西亚', '越南', '安哥拉', '摩洛哥',
  '突尼斯', '约旦', '塞尔维亚', '以色列', '黎巴嫩', '巴勒斯坦', '俄罗斯', '巴西', '瓜达尔',
  '中国', '美国', '英国', '法国', '德国', '日本', '韩国', '朝鲜', '西班牙', '意大利',
  'Poland', 'Pakistan', 'Sudan', 'Myanmar', 'Burma', 'Nigeria', 'Iraq', 'Yemen', 'Mali', 'Niger',
  'Kenya', 'Ethiopia', 'Peru', 'Mexico', 'South Africa', 'Iran', 'India', 'Turkey', 'Egypt',
  'Colombia', 'Philippines', 'Afghanistan', 'Syria', 'Thailand', 'Algeria', 'Argentina', 'Chile',
  'Venezuela', 'Libya', 'Somalia', 'Mozambique', 'Tanzania', 'Ukraine', 'Russia', 'Brazil',
  'United States', 'United Kingdom', 'France', 'Germany', 'Japan', 'China', 'Israel', 'Lebanon',
  'Palestine', 'Saudi Arabia', 'United Arab Emirates'
];
function extractCountry(text) {
  if (!text) return '';
  for (let i = 0; i < COUNTRIES.length; i++) {
    const c = COUNTRIES[i];
    if (text.indexOf(c) >= 0) return c;
  }
  return '';
}
/* 事发国提取（排除中国，2026-08-18）：海外利益预警平台中"中国"是行为主体（中资/中企/中国公民被害），
 * 永远不是事发地。若不排除，"中资工厂中国籍业主被害（坦桑尼亚）"会被错标成"中国"。
 * 其余国别按表内顺序取首个命中（单国标题可靠；多国标题取表内靠前项）。 */
function extractOverseasCountry(text) {
  if (!text) return '';
  for (let i = 0; i < COUNTRIES.length; i++) {
    const c = COUNTRIES[i];
    if (c === '中国' || c === 'China') continue;
    if (text.indexOf(c) >= 0) return c;
  }
  return '';
}

/* ===== 抓取源注册表（分类 → 真实端点） ===== */
const CN_WORLD = 'http://www.chinanews.com/rss/world.xml';   // 中新网·国际（国内可直连、稳定）
const SCRAPE_SOURCES = {
  /* —— 自然灾害：国际开放源（无墙） —— */
  usgs:        { name: 'USGS 地震监测', category: 'natural_disasters', type: 'geojson', tier: 'live', trusted: true,
                url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson' },
  /* 实测 rss.xml 与 gdacs_cap.xml 均返回空，仅 rss_24h.xml 有效（143 条 24 小时灾害事件） */
  /* 该 feed 体积约 430KB，55 源并发下 12s 默认超时不足，单独放宽到 30s */
  gdacs:       { name: 'GDACS 全球灾害预警', category: 'natural_disasters', type: 'rss', tier: 'live', trusted: true,
                timeout: 30000, url: 'https://www.gdacs.org/xml/rss_24h.xml' },
  /* —— 涉华 / 海外利益：中新网（国内直连、稳定） —— */
  cn_world:    { name: '中新网·国际', category: 'osint_intel', type: 'rss', url: CN_WORLD },
  /* 注：cn_scroll(中新网·滚动)、cn_china(中新网·国内) 为纯国内新闻源，与"海外利益安全"定位不符，已摘除（2026-07-31） */
  cn_pub:      { name: '中新网·国际(公共卫生)', category: 'public_health', type: 'rss', url: CN_WORLD },
  cn_finance:  { name: '中新网·财经', category: 'economic_risks', type: 'rss', url: 'http://www.chinanews.com/rss/finance.xml' },
  /* 中新网 mil.xml / taiwan.xml 已停更：返回的 XML 只有 channel 头、item 数为 0，
   * 保留会永久占用一个"离线"名额且每轮徒增一次请求，故移除。军事类由 cn_mc 覆盖。 */
  /* —— 关键词分类别名（同源国际 feed，按分类打标，保证每类都有真实数据） —— */
  cn_mc:       { name: '中新网·国际(军事)', category: 'military_conflicts', type: 'rss', url: CN_WORLD },
  cn_sec:      { name: '中新网·安全事件', category: 'security_events', type: 'rss', url: CN_WORLD },
  cn_terror:   { name: '中新网·恐袭', category: 'terror_events', type: 'rss', url: CN_WORLD },
  cn_pol:      { name: '中新网·政治', category: 'political_events', type: 'rss', url: CN_WORLD },
  cn_sanction: { name: '中新网·制裁', category: 'sanctions_data', type: 'rss', url: CN_WORLD },
  cn_social:   { name: '中新网·社会动荡', category: 'social_unrest', type: 'rss', url: CN_WORLD },
  cn_infra:    { name: '中新网·基建', category: 'infrastructure', type: 'rss', url: CN_WORLD },
  cn_geo:      { name: '中新网·地缘', category: 'geopolitical_intel', type: 'rss', url: CN_WORLD },

  /* ==================================================================
   * 国际开源情报源（2026-07-30 接入）
   *   tier: 'live'  = 实测直连可用（已验证返回真实条目）
   *         'probe' = 实测国内直连不通/需授权，按退避策略周期重试，通则自动供数
   *   trusted: true = 源本身即专业风险/灾害/人道情报，跳过通用相关性闸门
   * 诚实原则：probe 源在不可达期间返回空，绝不生成任何替代内容。
   * ================================================================== */

  /* —— 联合国系统（实测可用） —— */
  un_news_en:  { name: 'UN News 联合国新闻(英)', category: 'geopolitical_intel', type: 'rss', tier: 'live', trusted: true,
                url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml' },
  un_news_zh:  { name: 'UN News 联合国新闻(中)', category: 'geopolitical_intel', type: 'rss', tier: 'live', trusted: true,
                url: 'https://news.un.org/feed/subscribe/zh/news/all/rss.xml' },
  un_peace:    { name: 'UN 和平与安全', category: 'military_conflicts', type: 'rss', tier: 'live', trusted: true,
                url: 'https://news.un.org/feed/subscribe/en/news/topic/peace-and-security/feed/rss.xml' },
  who_news:    { name: 'WHO 世界卫生组织', category: 'public_health', type: 'rss', tier: 'live', trusted: true,
                url: 'https://www.who.int/rss-feeds/news-english.xml' },
  unhcr_pop:   { name: 'UNHCR 难民署人口统计', category: 'public_health', type: 'unhcr', tier: 'live', trusted: true,
                /* 实测：yearFrom 参数被 API 忽略（返回 1951 年起的历史数据），必须用 year= 精确指定 */
                url: 'https://api.unhcr.org/population/v1/population/?limit=20&year=2024&coa_all=true' },
  hdx_crisis:  { name: 'HDX 人道数据交换平台', category: 'public_health', type: 'hdx', tier: 'live', trusted: true,
                url: 'https://data.humdata.org/api/3/action/package_search?q=conflict+OR+displacement&rows=15&sort=metadata_modified+desc' },

  /* —— 冲突预警智库（实测可用） —— */
  crisisgroup: { name: 'ICG 国际危机组织', category: 'geopolitical_intel', type: 'rss', tier: 'live', trusted: true,
                url: 'https://www.crisisgroup.org/rss.xml' },

  /* —— 国际主流媒体（实测可用） —— */
  npr_world:   { name: 'NPR World', category: 'osint_intel', type: 'rss', tier: 'live',
                url: 'https://feeds.npr.org/1004/rss.xml' },
  france24_en: { name: 'France24 (英)', category: 'osint_intel', type: 'rss', tier: 'live',
                url: 'https://www.france24.com/en/rss' },
  /* France24 法语版通道可达但全法语内容，相关性闸门为中/英双语词表，法语条目
   * 结构性无法命中（实测 parsed=24 / relevant=0），接入等同恒零源；英文版已覆盖同一编辑部。 */
  rt_news:     { name: 'RT News', category: 'military_conflicts', type: 'rss', tier: 'live',
                url: 'https://www.rt.com/rss/news/' },
  tass_en:     { name: 'TASS 塔斯社', category: 'geopolitical_intel', type: 'rss', tier: 'live',
                url: 'https://tass.com/rss/v2.xml' },
  sputnik:     { name: 'Sputnik 卫星通讯社', category: 'geopolitical_intel', type: 'rss', tier: 'live',
                url: 'https://sputnikglobe.com/export/rss2/archive/index.xml' },
  yonhap_en:   { name: '韩联社 Yonhap', category: 'osint_intel', type: 'rss', tier: 'live',
                url: 'https://en.yna.co.kr/RSS/news.xml' },
  /* Global Times outbrain feed 更新缓慢（实测最新条目距今约 6 周），属真实但低频源，
   * 放宽时效窗口至 120 天，避免被 30 天默认闸门整体拦下 */
  globaltimes: { name: 'Global Times 环球时报(英)', category: 'osint_intel', type: 'rss', tier: 'live',
                maxAgeDays: 120, url: 'https://www.globaltimes.cn/rss/outbrain.xml' },
  /* China Daily RSS 已注销：world/china/bizchina 三个 feed 最新条目停留在 2017-12-12、
   * cndy 停留在 2019-12-04，属僵尸存档，不能作为实时源接入（若接入将持续注入 9 年前旧闻）。
   * 白名单保留其域名，待官方恢复更新后可直接启用。 */

  /* —— 灾害 / 地球观测（实测可用） —— */
  emsc_quake:  { name: 'EMSC 欧洲地中海地震中心', category: 'natural_disasters', type: 'emsc', tier: 'live', trusted: true,
                url: 'https://www.seismicportal.eu/fdsnws/event/1/query?limit=20&format=json&minmag=4.5' },
  nasa_eonet:  { name: 'NASA EONET 全球自然事件', category: 'natural_disasters', type: 'eonet', tier: 'live', trusted: true,
                url: 'https://eonet.gsfc.nasa.gov/api/v3/events?limit=20&status=open' },

  /* —— 制裁 / 贸易政策（实测可用） —— */
  ustr_press:  { name: 'USTR 美国贸易代表办公室', category: 'sanctions_data', type: 'rss', tier: 'live', trusted: true,
                url: 'https://ustr.gov/rss.xml' },

  /* —— 以下为实测国内直连不通 / 需授权的通道（周期重试，通则自动供数） —— */
  reuters:     { name: 'Reuters 路透社', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best' },
  apnews:      { name: 'AP News 美联社', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://apnews.com/index.rss' },
  bbc_world:   { name: 'BBC World', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  aljazeera:   { name: 'Al Jazeera 半岛电视台', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  dw_en:       { name: 'DW 德国之声', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://rss.dw.com/rdf/rss-en-all' },
  voa_world:   { name: 'VOA 美国之音', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://www.voanews.com/api/epiqq' },
  guardian:    { name: 'The Guardian 卫报', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://www.theguardian.com/world/rss' },
  isw:         { name: 'ISW 战争研究所', category: 'military_conflicts', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://www.understandingwar.org/rss.xml' },
  cfr:         { name: 'CFR 外交关系协会', category: 'geopolitical_intel', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://www.cfr.org/rss.xml' },
  diplomat:    { name: 'The Diplomat 外交学人(亚太)', category: 'geopolitical_intel', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://thediplomat.com/feed/' },
  carnegie:    { name: 'Carnegie 卡内基国际和平院', category: 'geopolitical_intel', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://carnegieendowment.org/rss/pubs' },
  chathamhouse:{ name: 'Chatham House 皇家国际事务研究所', category: 'geopolitical_intel', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://www.chathamhouse.org/rss/publications.xml' },
  wotr:        { name: 'War on the Rocks', category: 'military_conflicts', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://warontherocks.com/feed/' },
  rand:        { name: 'RAND 兰德公司', category: 'geopolitical_intel', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://www.rand.org/pubs.xml' },
  eurasianet:  { name: 'Eurasianet 欧亚网(中亚)', category: 'geopolitical_intel', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://eurasianet.org/rss.xml' },
  hrw:         { name: 'HRW 人权观察', category: 'social_unrest', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://www.hrw.org/rss/news' },
  amnesty:     { name: 'Amnesty 国际特赦组织', category: 'social_unrest', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://www.amnesty.org/en/rss/latest/news/' },
  acled:       { name: 'ACLED 武装冲突地点事件数据', category: 'military_conflicts', type: 'rss', tier: 'probe', trusted: true,
                url: 'https://acleddata.com/feed/' },
  gnews_sec:   { name: 'Google News·海外中企安全', category: 'security_events', type: 'rss', tier: 'probe',
                url: 'https://news.google.com/rss/search?q=chinese+workers+OR+embassy+attack&hl=en-US&gl=US&ceid=US:en' },
  reddit_world:{ name: 'Reddit r/worldnews', category: 'osint_intel', type: 'rss', tier: 'probe',
                url: 'https://www.reddit.com/r/worldnews/.rss' },
  reddit_geo:  { name: 'Reddit r/geopolitics', category: 'geopolitical_intel', type: 'rss', tier: 'probe',
                url: 'https://www.reddit.com/r/geopolitics/.rss' },
  /* GDELT 实测可直连，但官方限频"每 5 秒 1 次"，超频即 429；此处按 5 分钟最小间隔调用。
   * 首轮曾因限频误判为不可达，实际属 live 通道。 */
  gdelt_doc:   { name: 'GDELT 2.0 全球事件库', category: 'geopolitical_intel', type: 'gdelt', tier: 'live', trusted: true, minInterval: 300000,
                url: 'http://api.gdeltproject.org/api/v2/doc/doc?query=(china%20OR%20chinese)%20(attack%20OR%20protest%20OR%20sanction)&mode=artlist&maxrecords=20&format=json&timespan=2d' },
  reliefweb:   { name: 'ReliefWeb 人道报告(需注册appname)', category: 'public_health', type: 'reliefjson', tier: 'probe', trusted: true,
                url: 'https://api.reliefweb.int/v2/reports?appname=orps&limit=15&profile=list' }
};

/* 通道分层统计（供 /api/sources 与前端展示，绝不虚构） */
const SOURCE_TIER = {};
Object.keys(SCRAPE_SOURCES).forEach(k => { SOURCE_TIER[k] = SCRAPE_SOURCES[k].tier || 'live'; });
/* 分类 → 源 key 列表 */
const CATEGORY_MAP = {};
Object.keys(SCRAPE_SOURCES).forEach(k => {
  const cat = SCRAPE_SOURCES[k].category;
  (CATEGORY_MAP[cat] = CATEGORY_MAP[cat] || []).push(k);
});
/* COLLECTED_DB 分类 → 抓取分类（含 humanitarian 并入 public_health 展示） */
const CAT_TO_SCRAPE = {
  natural_disasters: ['natural_disasters'],
  public_health: ['public_health', 'humanitarian'],
  osint_intel: ['osint_intel'],
  security_events: ['security_events'],
  terror_events: ['terror_events'],
  military_conflicts: ['military_conflicts'],
  political_events: ['political_events'],
  sanctions_data: ['sanctions_data'],
  social_unrest: ['social_unrest'],
  infrastructure: ['infrastructure'],
  geopolitical_intel: ['geopolitical_intel'],
  economic_risks: ['economic_risks']
};

/* ===== 工具 ===== */
/* HTML 实体解码：还原为真实字符（旧版一律替换为空格，会破坏 AT&T、don't 等文本） */
const _ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', middot: '·' };
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(+d); } catch (e) { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, n) => (_ENT[n.toLowerCase()] !== undefined ? _ENT[n.toLowerCase()] : ' '));
}
function stripTags(s) {
  if (!s) return '';
  return decodeEntities(String(s)
      /* 必须先解开 CDATA：<![CDATA[标题]]> 内部若不含 '>'，会被 /<[^>]*>/ 当成单个标签整段吞掉，
       * 导致 title 为空、整条被丢弃（韩联社/China Daily 等 CDATA 源曾因此 0 条） */
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function _fetchText(url, timeout) {
  timeout = timeout || 15000;
  const u = (() => { try { return new URL(url); } catch (e) { return null; } })();
  if (!u || !_hostAllowed(u.hostname)) return Promise.resolve(null);
  return netx.smartFetch(url, {
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  })
    .then(r => (r.ok ? r.text() : null))
    .catch(() => null);
}
/* 供前端通过 /api/scrape?url= 使用的白名单代理 */
async function proxyFetchText(url) {
  return _fetchText(url, 15000);
}

/* ===== 解析器 ===== */
function parseRssItems(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(b => {
    function tag(name) {
      const m = b.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
      if (m) return stripTags(m[1]);
      return '';
    }
    let title = tag('title');
    let desc = tag('description') || tag('summary') || tag('content');
    let link = tag('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1]; }
    const pub = tag('pubDate') || tag('updated') || tag('published');
    if (title) items.push({ title, description: desc, link, pubDate: pub });
  });
  return items;
}
function parseUsgs(json) {
  const f = (json && json.features) || [];
  return f.slice(0, 20).map(x => {
    const p = x.properties || {};
    return { title: p.title || ('M' + (p.mag || '?') + ' 地震'), description: p.title || '', link: 'https://earthquake.usgs.gov/earthquakes/eventpage/' + (x.id || ''), pubDate: p.time };
  });
}
function parseGdelt(json) {
  const a = (json && json.articles) || [];
  /* GDELT DOC API 只返回标题+URL，没有摘要字段。
   * 以前把 title 复制给 description 冒充摘要，导致入库条目"只有一句话没有细节"。
   * 现在 description 留空、如实标记，由 fulltext.js 按 URL 回源抓真实正文。 */
  return a.slice(0, 20).map(x => ({
    title: x.title || '', description: '', link: x.url || '', pubDate: (x.seendate || '').slice(0, 10)
  }));
}
/* UNHCR 难民署人口统计：真实统计数字 → 可读情报条目（数据来自官方 API，非生成） */
function parseUnhcr(json) {
  const items = (json && json.items) || [];
  const latest = items.filter(x => Number(x.year) >= 2023);
  return latest
    .map(x => {
      const ref = Number(x.refugees) || 0, idp = Number(x.idps) || 0, asy = Number(x.asylum_seekers) || 0;
      const total = ref + idp + asy;
      if (!total) return null;
      /* API 以 coa_all=true 聚合时按"收容国"出行，coo_name 恒为 '-'；
       * 需在来源国(coo)与收容国(coa)之间择一作为主国家，否则条目会被全部丢弃 */
      const coo = (x.coo_name && x.coo_name !== '-') ? x.coo_name : '';
      const coa = (x.coa_name && x.coa_name !== '-') ? x.coa_name : '';
      const main = coo || coa;
      if (!main) return null;
      const label = coo ? (coo + (coa ? ' → ' + coa : '')) : (coa + ' 收容');
      return {
        title: '[UNHCR ' + x.year + '] ' + label + ' 流离失所人口 ' + total.toLocaleString(),
        description: '难民 ' + ref.toLocaleString() + ' 人 / 境内流离失所 ' + idp.toLocaleString() + ' 人 / 寻求庇护 ' + asy.toLocaleString() + ' 人（联合国难民署官方统计）',
        link: 'https://www.unhcr.org/refugee-statistics/',
        pubDate: String(x.year),
        _forceCountry: main,
        _weight: total
      };
    })
    .filter(Boolean)
    .sort((a, b) => b._weight - a._weight)
    .slice(0, 12);
}
/* HDX 人道数据交换平台：数据集索引（真实元数据） */
function parseHdx(json) {
  const r = (json && json.result && json.result.results) || [];
  return r.slice(0, 15).map(x => ({
    title: '[HDX 数据集] ' + (x.title || x.name || ''),
    description: String(x.notes || '').replace(/\s+/g, ' ').slice(0, 260),
    link: 'https://data.humdata.org/dataset/' + (x.name || ''),
    pubDate: x.metadata_modified || '',
    _forceCountry: (x.groups && x.groups[0] && (x.groups[0].display_name || x.groups[0].title)) || ''
  }));
}
/* EMSC 欧洲地中海地震中心（GeoJSON） */
function parseEmsc(json) {
  const f = (json && json.features) || [];
  return f.slice(0, 20).map(x => {
    const p = x.properties || {};
    const mag = p.mag || '?';
    const region = p.flynn_region || p.region || '未知区域';
    return {
      title: 'M' + mag + ' 地震 — ' + region + '（震源深度 ' + (p.depth || '?') + ' km）',
      description: 'EMSC 实时地震速报：震级 M' + mag + '，地点 ' + region + '，发震时刻 ' + (p.time || '') + '，深度 ' + (p.depth || '?') + ' 公里。',
      link: p.unid ? ('https://www.emsc-csem.org/Earthquake/earthquake.php?id=' + p.unid) : 'https://www.seismicportal.eu/',
      pubDate: p.time || ''
    };
  });
}
/* NASA EONET 全球自然事件（野火/风暴/火山/洪水等） */
function parseEonet(json) {
  const e = (json && json.events) || [];
  const CAT_ZH = { wildfires: '野火', severeStorms: '强风暴', volcanoes: '火山活动', floods: '洪水',
    drought: '干旱', dustHaze: '沙尘/霾', earthquakes: '地震', landslides: '滑坡',
    snow: '暴雪', seaLakeIce: '海冰', manmade: '人为灾害', waterColor: '水体异常', tempExtremes: '极端气温' };
  return e.slice(0, 20).map(x => {
    const cat = (x.categories && x.categories[0]) || {};
    const zh = CAT_ZH[cat.id] || cat.title || '自然事件';
    return {
      title: '[' + zh + '] ' + (x.title || ''),
      description: (x.description || x.title || '') + '（NASA EONET 地球观测自然事件系统实时监测）',
      link: (x.sources && x.sources[0] && x.sources[0].url) || x.link || '',
      pubDate: (x.geometry && x.geometry[0] && x.geometry[0].date) || ''
    };
  });
}
function parseRelief(json) {
  const d = (json && json.data) || [];
  return d.slice(0, 15).map(x => {
    const f = x.fields || {};
    const country = (f.primary_country && f.primary_country.name) || '';
    const title = f.name || '人道危机';
    return { title, description: (country ? '[' + country + '] ' : '') + (f.status || ''), link: '', pubDate: '', _forceCountry: country };
  });
}

/* ===== 相关性过滤：只保留与「海外利益安全/风险」相关的情报，剔除无关内容 =====
 * 这是防止"乱抓数据"（如养生/体育/娱乐）混入系统的关键闸门。
 * 命中任一关键词即保留；否则丢弃（前端回退到模板模拟，绝不污染系统）。 */
const RELEVANT_KW = [
  '安全', '袭击', '攻击', '冲突', '战争', '战乱', '交火', '制裁', '反制', '管制',
  '政变', '抗议', '示威', '游行', '罢工', '骚乱', '暴乱', '动荡', '政权', '边境',
  '地震', '灾害', '台风', '洪水', '飓风', '海啸', '火山', '干旱', '饥荒', '火灾',
  '疫情', '传染病', '卫生', '疾病', '疟疾', '霍乱', '猴痘', '新冠', '流感', '暴发',
  '恐怖', '绑架', '爆炸', '枪击', '劫持', '海盗', '武装', '极端', '撤侨', '撤离',
  '危机', '风险', '预警', '威胁', '外交', '地缘', '博弈', '军事', '国防', '演习',
  '投资', '中资', '华人', '华侨', '使馆', '中方', '出海', '海外', '驻外', '陷阱',
  '港口', '基建', '能源', '关税', '债务', '破产', '通胀', '汇率', '罢工', '断供',
  '维和', '护航', '安保', '治安', '犯罪', '抢劫', '绑架', 'rupt', 'attack', 'conflict',
  'war', 'sanction', 'terror', 'blast', 'earthquake', 'disaster', 'coup', 'protest',
  'embassy', 'Chinese', 'overseas', 'evacuation', 'crisis', 'risk', 'outbreak', 'epidemic',
  'unrest', 'riot', 'kidnap', 'hijack', 'piracy'
];
/* 短英文词整词匹配（防子串误伤：award≠war、Counter-Strike≠罢工、brisk≠risk） */
const _EXACT_EN = ['war', 'risk', 'coup', 'riot'];
function _relevant(text) {
  if (!text) return false;
  const low = text.toLowerCase();
  for (let i = 0; i < RELEVANT_KW.length; i++) {
    const k = RELEVANT_KW[i].toLowerCase();
    if (_EXACT_EN.indexOf(k) >= 0) {
      try { if (new RegExp('(?<![a-z-])' + k + '(?![a-z-])').test(low)) return true; continue; }
      catch (e) { /* fallthrough */ }
    }
    if (low.indexOf(k) >= 0) return true;
  }
  return false;
}

/* ===== 中国海外利益相关性闸门（平台核心定位：仅采集与中国海外利益安全相关的情报）=====
 * 背景：平台定位是「海外利益安全风险监测预警」，不是通用新闻聚合。此前闸门只按"风险关键词"
 * 放行，导致国内民生/社会新闻（如"河北美丽乡村建设""甘肃救灾""青年奔赴湖南"）混入，
 * 这些与海外利益安全无关，必须剔除。规则：
 *   ① 直接关联：涉华/中资/公民/重大项目/能源/通道/侨民——放行；
 *   ② 间接关联：发生在与中国海外利益高度相关的重点国家，且含安全事件/恐怖主义/
 *      地区冲突/制裁/海盗/能源/通道/重大灾害等信号——按海外利益安全关联度评分≥60放行；
 *   ③ 泛泛外讯：与中国海外利益无直接/间接关联的外国普通新闻（如美国内政、欧洲选举、
 *      无关体育赛事）——剔除；
 *   ④ 涉华内容：须带海外利益标记或属涉华负面/安全风险，否则视为国内事务剔除；
 *   ⑤ 纯中文、无海外标记、命中国内民生噪声的——剔除。 */
const AK_CHINA_TERMS = ['中国','Chinese','China','中资','华人','华侨','中方','出海','驻外','使馆','一带一路','中企','国企','华裔','涉华','对华',"China's",'Beijing','Chinese companies','overseas Chinese','Taiwan','Hong Kong','Xinjiang','Tibet','台湾','香港'];
const AK_NEG_TERMS = ['批评','指责','威胁','制裁','抵制','抗议','反对','抨击','警惕','风险','冲突','攻击','袭击','间谍','渗透','撤资','禁令','限制','打压','敌意','负面','逮捕','起诉','调查','排华','反华','芯片','关税','出口管制','技术封锁','diss','critic','sanction','threat','boycott','protest','spy','ban','risk','attack','assault','warns','crackdown','backlash','hostile','condemn','accuse','arrest','probe','sanctions','tariff','chip','export control','tech blockade'];
const AK_OVERSEAS_MARKERS = ['海外','境外','驻外','中资','华人','华侨','华裔','中国公民','中方人员','中企','国企','出海','使馆','领事','撤侨','一带一路','中巴经济走廊','中老铁路','雅万高铁','中欧班列','蒙内铁路','亚吉铁路','坦赞铁路','瓜达尔','皎漂','汉班托塔','比雷埃夫斯','钱凯','维和','护航','驻在国','东道国','投资所在国','项目所在国','非洲','中东','南亚','东南亚','中亚','拉美','东欧','西欧','北欧','南欧','亚太','东盟','海湾','红海','马六甲','北极','南太平洋','南海','台海','东海','台湾','香港','Chinese','overseas','embassy','consulate','evacuat','belt and road','BRI','abroad','foreign','diaspora','Chinese company','Chinese national'];
const AK_FOREIGN_COUNTRIES = ['阿富汗','巴基斯坦','印度','孟加拉','尼泊尔','斯里兰卡','不丹','缅甸','泰国','越南','老挝','柬埔寨','马来西亚','印尼','菲律宾','新加坡','文莱','哈萨克斯坦','乌兹别克','土库曼','吉尔吉斯','塔吉克','蒙古','朝鲜','韩国','日本','伊朗','伊拉克','叙利亚','沙特','阿联酋','卡塔尔','科威特','以色列','巴勒斯坦','约旦','黎巴嫩','土耳其','塞浦路斯','也门','阿曼','巴林','埃及','利比亚','阿尔及利亚','尼日利亚','安哥拉','刚果','苏丹','南苏丹','埃塞俄比亚','肯尼亚','坦桑尼亚','乌干达','莫桑比克','津巴布韦','南非','赞比亚','几内亚','马里','尼日尔','乍得','喀麦隆','加纳','塞内加尔','摩洛哥','突尼斯','俄罗斯','乌克兰','白俄罗斯','波兰','塞尔维亚','匈牙利','罗马尼亚','保加利亚','捷克','斯洛伐克','墨西哥','巴西','阿根廷','智利','秘鲁','哥伦比亚','委内瑞拉','古巴','厄瓜多尔','玻利维亚','哥斯达黎加','美国','加拿大','澳大利亚','新西兰','德国','法国','英国','意大利','西班牙','葡萄牙','荷兰','比利时','瑞士','瑞典','挪威','芬兰','丹麦','奥地利','希腊','Afghanistan','Pakistan','India','Bangladesh','Myanmar','Thailand','Vietnam','Malaysia','Indonesia','Philippines','Singapore','Kazakhstan','Iran','Iraq','Syria','Saudi','UAE','Israel','Palestine','Turkey','Yemen','Egypt','Libya','Nigeria','Angola','Russia','Ukraine','Mexico','Brazil','Argentina','America','Australia','Japan','Korea','Germany','France','Britain'];
const AK_CHINA_PROVINCES = ['北京','上海','天津','重庆','河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆','香港','澳门','广州','深圳','杭州','成都','武汉','西安','南京','青岛','大连','厦门','苏州'];
const AK_DOMESTIC_NOISE_RE = /美丽乡村|乡村振兴|农业农村|春耕|秋收|丰收|文旅|景区|门票|机票|携程|高铁出行|高考|考研|就业|招聘|房价|医保|社保|养老|低保|补贴|婚恋|育儿|直播带货|网红|综艺|演唱会|票房|影视剧|电视剧|明星|八卦|中超|CBA|全运|冬奥|春晚|菜价|油价|猪肉|家电|汽车降价|社区|物业|垃圾分类|救援|救灾|奔赴|返乡|乡土|务工|扎根|乡愁|山水|风光|特产|老字号|非遗|民俗|节庆|庙会|灯会|农家乐|村晚|采摘|踏青|赏花|夜市|美食|小吃|火锅|年夜饭|春运|五一|十一|假期|出游|文旅厅|文旅局|乡村振兴局/;
const AK_DOMESTIC_RISK = ['地震','海啸','台风','洪水','飓风','火山','疫情','恐袭','袭击','冲突','战争','政变','骚乱','抗议','制裁','绑架','爆炸','枪击','劫持','撤侨','撤离','边境','军事','国防','间谍','网络攻击','火灾','车祸','塌方','矿难','中毒','暴雨','强降雨','滑坡','泥石流'];
/* 涉华判定（2026-08-27 收紧）：只看真实命中中国/中方/华人等主体或 China + 明确主体。
 * 排除 "Chinese" 单独作为形容词（Chinese rivals/actors/officials 泛称）及港台疆藏单独出现的误标。
 * 与 gate.js / globalmedia.js / crawler.js 同源，统一 export 供后端调用。 */
function isChinaRelatedStrict(text){
  if(!text) return false;
  var t = String(text);
  // 强直接主体词
  if(/中国|中资|中企|中方|华人|华侨|华裔|涉华|对华|一带一路|中国驻|访华|驻华|CPEC|中巴经济走廊|北京|Beijing|Belt and Road|RMB|Yuan|BRICS|AIIB|Shanghai Cooperation|Xi Jinping/i.test(t)) return true;
  // China 作为整词出现
  if(/\bChina\b/i.test(t)) return true;
  // Chinese 必须依附明确主体：公民/企业/使馆/人员/项目/资产/学生/游客/船员等
  if(/\bChinese (?:citizen|national|company|companies|worker|workers|engineer|engineers|embassy|consulate|ambassador|official|officials|firm|firms|investment|investor|investors|tourist|tourists|student|students|crew|vessel|ship|ships|plane|national|nationals|nationality|flag|language|government|ministry|army|military|forces|naval|navy|aircraft|drone|drones|tech|technology|chip|chips|AI|telecom|app|apps|platform|platforms|owned|operated|contractor|contractors|mine|mining|project|projects|port|ports|base|bases|interest|interests|overseas|diaspora|community|communities|communist|communists)\b/i.test(t)) return true;
  // Chinese + 明确海外/安全语境（被袭/被绑/遇难/撤离等）
  if(/\bChinese\b/i.test(t) && /\b(?:attack|attacked|killed|kidnap|kidnapped|hostage|shooting|shot|injured|missing|arrested|detained|sentenced|executed|evacuat|rescue|rescued|embassy|consulate|citizen|national|company|worker|student|tourist|vessel|ship|plane|crew|overseas|abroad)\b/i.test(t)) return true;
  return false;
}
function _akChinaRelated(text){
  return isChinaRelatedStrict(text);
}
function _akChinaNegative(text){
  if(!text) return false;
  if(!_akChinaRelated(text)) return false;
  var low = text.toLowerCase();
  for(var j=0;j<AK_NEG_TERMS.length;j++){ if(low.indexOf(AK_NEG_TERMS[j].toLowerCase())>=0) return true; }
  /* 涉华安全事件（恐袭/袭击/爆炸/绑架/枪击/暴力/遇害/遇难等）即使无海外标记，也属海外利益安全负面信号 */
  if(AK_TOPIC_SECURITY_RE.test(text)) return true;
  return false;
}
function _akIsChinese(text){
  if(!text) return false;
  return /[一-龥]/.test(text);
}
function _akHasOverseasMarker(text){
  if(!text) return false;
  var low=text.toLowerCase();
  for(var i=0;i<AK_OVERSEAS_MARKERS.length;i++){ if(low.indexOf(AK_OVERSEAS_MARKERS[i].toLowerCase())>=0) return true; }
  for(var j=0;j<AK_FOREIGN_COUNTRIES.length;j++){ if(text.indexOf(AK_FOREIGN_COUNTRIES[j])>=0) return true; }
  return false;
}
function _akDomesticHasRisk(text){
  var low=text.toLowerCase();
  for(var i=0;i<AK_DOMESTIC_RISK.length;i++){ if(low.indexOf(AK_DOMESTIC_RISK[i].toLowerCase())>=0) return true; }
  return false;
}
/* ===== 主题噪声闸门（体育/娱乐/赛事，与海外利益安全无关）=====
 * 背景：原 chinaOverseasGate 只按"是否涉华+是否海外/负面"判定，导致英文体育新闻
 * 只要出现 "Chinese"（如 "Chinese rivals"）就被误判为涉华海外利益而放行。
 * 乒乓球亚运金牌战、演唱会、电影票房等既不是海外、也不是安全风险，必须剔除。
 * 规则：命中体育/娱乐特征词即判噪声；但同一文本若同时命中强安全事件词
 *       （恐袭/爆炸/枪击/绑架/踩踏等，含英文），不视为噪声——赛事现场恐袭属安全事件。 */
const AK_TOPIC_NOISE_RE = /table tennis|badminton|tennis match|football match|soccer|rugby|cricket|\bbok\b|volleyball|swimming|athletics|gymnastics|olympic|asian games|commonwealth games|world cup|gold medal|silver medal|bronze medal|mixed doubles|singles final|doubles final|qualifier|tournament|championship|premier league|\bnba\b|\bnfl\b|wimbledon|formula ?1|grand prix|cycling|marathon|boxing|wrestling|chess|esports|e-sports|surfing|sailing|canoe|kayak|concert|album release|grammy|oscar|emmy|box office|netflix|k-pop|pop star|reality show|乒乓球|羽毛球|网球|足球|篮球|排球|游泳|田径|体操|奥运|亚运|亚运会|全运会|省运会|城运会|学青会|运动会|冲浪|帆船|帆板|皮划艇|世界杯|金牌|银牌|铜牌|混双|单打|双打|选手|运动员|教练|奖牌|领奖台|综艺|演唱会|专辑|歌手|明星|电影票房|选秀|开幕|开赛/;
/* 纯国内百科/教育/科技/论坛/产品介绍/军事庆典噪声：与海外利益安全无关
 * 规则：命中即判为纯国内噪声；但若同时命中强安全事件词（AK_TOPIC_SECURITY_RE），
 *       则视为安全事件报道，不滤除——如"中国工程师在巴基斯坦遇袭"中虽含"工程师"
 *       但伴随安全事件，应保留。 */
const AK_DOMESTIC_EDU_TECH_RE = /百度百科|知乎|问答|是什么|是什么意思|区别|有什么区别|介绍|产品|官网|官方网站|APP|应用软件|邮箱|电子邮箱|游戏|外挂|作弊|FPS|AI学习|直播|带货|网红|考研|高考|助学金|学校|学生|校园|天文|伽马射线|天鹅座|卫星|发射|载人航天|中继卫星|成像|纪录|破纪录|DeepSeek|技术变革|人力|回答数|获得赞同|题主|展示|聊一下|产业链|防御部署|打击策略|和平精英|腾讯游戏|保驾护航|举报|不良信息|版权所有|执行主编|京ICP|建军节|招待会|纪念|庆祝|通令|记功|国防和军队|高质量推进|总书记|中央军委|国防部举办|深化.*安全互信|中文安全|纪念解放军|成立周年|网络暴力|谣言|虚假有害|电话举报|举报信箱/;
/* 涉华APP/技术禁令：虽含"APP"等技术词，但属海外利益安全（中国出海企业受阻），需放行 */
const AK_CHINA_APP_BAN_RE = /对(?:华|中).*?(?:APP|应用|软件|芯片|技术|5G|华为|中兴|TikTok|WeChat|抖音|微信|禁止|禁令|下架|封禁|限制)|(?:APP|应用|软件|芯片|技术).*?(?:对华|涉华|中国).*?(?:禁止|禁令|下架|封禁|限制|制裁)|印度.*?(?:中国|中企|字节|华为|小米).*?(?:禁令|禁止|下架|封禁)|美国.*?涉华.*?芯片|芯片.*?对华/i;
/* 文化/商业/历史/民俗/生活方式类噪声：与海外利益安全无关。
 * 若同时命中强安全事件/风险词（如"华人文化节遭恐袭"），则放行。 */
const AK_CULTURE_BUSINESS_JUNK_RE = /潮汕|徽商|晋商|浙商|闽商|商帮|商业.*(?:道德|伦理|智慧|哲学|思维|模式)|契约精神|老字号|非遗|民俗文化|文化节|民俗节|庙会|灯会|龙舟|舞狮|秧歌|腰鼓|皮影|剪纸|泥塑|刺绣|陶瓷|玉雕|木雕|竹编|草编|漆器|珐琅|年画|门神|春联|窗花|中国结|香包|荷包|肚兜|虎头鞋|长命锁|文房四宝|书法|国画|油画|水彩|版画|雕塑|数字艺术|文化遗产|传统.*文化|民间.*艺术|地方.*戏曲|方言.*保护|乡土|乡愁|宗祠|祭祖|族谱|家谱|客家|闽南|粤语|川剧|京剧|昆曲|越剧|豫剧|黄梅戏|秦腔|评剧|粤剧|潮剧|梨园|戏曲|曲艺|相声|小品|脱口秀|纪录片.*中国|人文.*中国|中国.*人文|中国历史|中国古代|近代中国|中华文明|华夏文明|五千年|传统文化|国学|儒家|道家|佛家|禅宗|茶道|酒文化|饮食文化|服饰文化|建筑文化|园林|故宫|长城|兵马俑|敦煌|丝绸之路.*文化|大运河|非遗传承|手工艺|匠人|匠心|品牌故事|创业故事|企业家精神|白手起家|奋斗史|成长史|发家史|商业传奇|财富故事|股市传奇|投资哲学|理财.*技巧|消费.*心理|营销.*策略|管理.*智慧|领导力|团队.*建设|企业文化|商业模式|互联网.*思维|产品.*经理|运营.*干货|职场.*经验|求职.*技巧|面试.*攻略|简历.*模板|PPT.*技巧|Excel.*技巧|英语.*学习|小语种|考研.*经验|高考.*志愿|留学.*申请|移民.*攻略|签证.*攻略|旅游.*攻略|美食.*推荐|穿搭.*技巧|美妆.*教程|护肤.*知识|健身.*教程|瑜伽.*入门|跑步.*指南|马拉松.*训练|骑行.*路线|钓鱼.*技巧|摄影.*教程|影评.*推荐|剧评.*推荐|书评.*推荐|音乐.*推荐|综艺.*推荐|动漫.*推荐|漫画.*推荐|小说.*推荐|网文.*创作|自媒体.*运营|短视频.*创作|直播.*带货|网红.*经济|粉丝.*运营|吃瓜|爆料|八卦|绯闻|恋情|结婚|离婚|出轨|整容|减肥|增肌|养生|中医|针灸|推拿|拔罐|艾灸|刮痧|食疗|保健品|减肥药|美白|祛痘|去皱|祛斑|植发|整形|医美|牙科|眼科|体检|疫苗/i;
const AK_TOPIC_SECURITY_RE = /terror|attack|bomb|blast|kidnap|stampede|shooting|gunman|riot|Chinese?(?: citizen| national| company| vessel| embassy)|恐袭|袭击|爆炸|绑架|踩踏|骚乱|枪击|使馆|领事|撤侨|(?:华人|华侨).*(?:袭击|绑架|遇害|遇害|伤亡|威胁|风险)|(?:袭击|绑架|遇害|伤亡|威胁|风险).*(?:华人|华侨)/;
/* 纯国内（台港）内部政务/选举/当局口号：无真实海外利益信号时属国内事务，非海外利益安全 */
const AK_DOMESTIC_POLITICS_RE = /民进党|国民党|蔡英文|赖清德|台独|选举|立法院|宪政|全民防卫|当局|两岸|港独|反修例|立法会|候选人|选战|造势|就职|施政|统战|阵营|政党/;
/* 真实海外利益安全信号：出现则视为与中国海外利益相关（台海军事/中资/撤侨/投资/项目等） */
const AK_OVERSEAS_INTEREST_RE = /中资|中企|国企|华人|华侨|华裔|中国公民|中方人员|驻外|使馆|领事|撤侨|一带一路|中巴经济走廊|中老铁路|雅万高铁|中欧班列|蒙内铁路|亚吉铁路|坦赞铁路|瓜达尔|皎漂|汉班托塔|比雷埃夫斯|钱凯|维和|护航|台海|台湾海峡|海峡|军事|演习|军演|导弹|战区|商船|航运|港口|侨胞|台商|中(?:资|企|国)人|投资|工程|项目|工厂|矿山|海外利益|境外资产/;

/* ===== 海外利益安全关联度评分（基于总体国家安全观官方定义） =====
 * 直接关联（A-E）：涉华/中资/公民、一带一路重大项目、能源资源、战略通道、海外侨民。
 * 间接关联（F-I）：重点国家安全事件、地区冲突/恐怖/制裁外溢、贸易通道、全球公卫/灾害。
 * 阈值 60：仅当得分≥60 才视为与我海外利益安全相关，杜绝泛泛外国新闻入库。 */
const OI_DIM_KW = {
  A: ['中国','Chinese','China','中资','华人','华侨','中方','中企','国企','华裔','涉华','对华','北京','Beijing','overseas Chinese','Chinese company','Chinese national','Chinese workers','Chinese investment','Chinese embassy','Chinese consulate','Chinese ambassador','RMB','Yuan','BRICS','AIIB','Shanghai Cooperation','Xi Jinping','Hong Kong','Taiwan','Macau','Xinjiang'],
  B: ['中巴经济走廊','中老铁路','雅万高铁','中欧班列','蒙内铁路','亚吉铁路','坦赞铁路','瓜达尔','皎漂','汉班托塔','比雷埃夫斯','钱凯','Belt and Road','BRI','economic corridor'],
  C: ['石油','天然气','锂','钴','铜','稀土','矿产','能源','油气','煤炭','铁矿石','粮食','大豆','关键矿产','oil','gas','lithium','cobalt','copper','rare earth','energy','mining','iron ore','grain'],
  D: ['霍尔木兹','马六甲','苏伊士','红海','曼德','巴拿马','北极航道','台湾海峡','南海','Hormuz','Malacca','Suez','Red Sea','Panama Canal','Taiwan Strait','South China Sea'],
  E: ['中国公民','中方人员','华人','华侨','侨胞','台商','中国留学生','中国劳工','外派','援外','驻外','海外华人','Chinese tourist','Chinese student','diaspora'],
  F: ['巴基斯坦','Pakistan','Pakistani','阿富汗','Afghan','Afghanistan','缅甸','Myanmar','Burmese','尼日利亚','Nigeria','Nigerian','伊拉克','Iraq','Iraqi','叙利亚','Syria','Syrian','也门','Yemen','Yemeni','利比亚','Libya','Libyan','苏丹','Sudan','Sudanese','南苏丹','South Sudan','索马里','Somalia','Somalian','刚果','Congo','Congolese','马里','Mali','Malian','尼日尔','Niger','乍得','Chad','Chadian','乌克兰','Ukraine','Ukrainian','伊朗','Iran','Iranian','沙特','Saudi','Saudi Arabian','阿联酋','UAE','Emirati','土耳其','Turkey','Turkish','埃及','Egypt','Egyptian','埃塞俄比亚','Ethiopia','Ethiopian','肯尼亚','Kenya','Kenyan','坦桑尼亚','Tanzania','Tanzanian','赞比亚','Zambia','Zambian','安哥拉','Angola','Angolan','加纳','Ghana','Ghanaian','几内亚','Guinea','Guinean','津巴布韦','Zimbabwe','Zimbabwean','南非','South Africa','South African','俄罗斯','Russia','Russian','哈萨克斯坦','Kazakhstan','Kazakh','老挝','Laos','Lao','柬埔寨','Cambodia','Cambodian','越南','Vietnam','Vietnamese','泰国','Thailand','Thai','马来西亚','Malaysia','Malaysian','印尼','Indonesia','Indonesian','菲律宾','Philippines','Filipino','孟加拉','Bangladesh','Bangladeshi','斯里兰卡','Sri Lanka','Sri Lankan','巴西','Brazil','Brazilian','阿根廷','Argentina','Argentine','智利','Chile','Chilean','秘鲁','Peru','Peruvian','墨西哥','Mexico','Mexican','委内瑞拉','Venezuela','Venezuelan','厄瓜多尔','Ecuador','Ecuadorian','澳大利亚','Australia','Australian'],
  G: ['恐袭','恐怖主义','恐怖分子','袭击','袭击者','被袭','遭到袭击','绑架','被绑架','绑架者','爆炸','爆炸案','炸弹','冲突','武装冲突','战争','政变','骚乱','抗议','示威','罢工','制裁','封锁','禁运','海盗','劫持','叛乱','武装','极端组织','ISIS','塔利班','terror','terrorism','terrorist','terrorists','attack','attacks','attacked','attacking','kidnap','kidnaps','kidnapped','kidnapping','kidnappers','blast','blasts','blasted','bomb','bombs','bombed','bombing','bombings','conflict','conflicts','war','wars','warfare','coup','coups','riot','riots','rioting','protest','protests','protesters','protesting','demonstration','demonstrations','demonstrators','strike','strikes','striking','sanction','sanctions','sanctioned','blockade','blockades','embargo','embargoes','piracy','pirate','pirates','pirating','hijack','hijacks','hijacked','hijacking','insurgency','insurgent','insurgents','insurgency','militant','militants','extremist','extremists','raid','raids','ambush','ambushes','shootout','shootouts','shooting','shootings','gunman','gunmen','clashes','uprising','rebellion','revolt','siege','hostage','hostages','massacre','massacres','assault','assaults','shelling','airstrike','airstrikes','killed','casualties','death','deaths','dead','wounded','injured'],
  H: ['港口','机场','铁路','运河','航运','贸易','供应链','中欧班列','货运','集装箱','航线','海运','logistics','supply chain','trade route','shipping','container'],
  I: ['疫情','传染病','瘟疫','大流行','地震','海啸','台风','洪水','飓风','火山','泥石流','干旱','饥荒','pandemic','epidemic','earthquake','tsunami','typhoon','flood','hurricane','volcano']
};
const OI_DIM_SCORE = { A:95, B:90, C:85, D:80, E:75, F:25, G:40, H:60, I:55 };
/* 关键词匹配：中文/混排用子串；纯 ASCII 用单词边界，避免 BRI 命中 hybridi、war 命中 warning 等 */
function _kwMatch(text, kw){
  if(!text || !kw) return false;
  if(/[^\x00-\x7F]/.test(kw)) return text.toLowerCase().indexOf(kw.toLowerCase()) >= 0;
  try{ return new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text); }
  catch(e){ return text.toLowerCase().indexOf(kw.toLowerCase()) >= 0; }
}
function _scoreOverseasInterest(text){
  if(!text) return { score:0, reasons:[] };
  /* 健康/民生/生活方式/科技八卦类噪声：无论发生在哪个重点国家，都不构成中国海外利益安全 */
  if(typeof _isHealthLifestyleNoise==='function' && _isHealthLifestyleNoise(text)) return { score:0, reasons:[] };
  var score = 0, reasons = [];
  for(var d in OI_DIM_KW){
    if(!Object.prototype.hasOwnProperty.call(OI_DIM_KW, d)) continue;
    var kws = OI_DIM_KW[d];
    var hit = false;
    for(var i=0;i<kws.length;i++){ if(_kwMatch(text, kws[i])){ hit = true; break; } }
    if(hit){ score += OI_DIM_SCORE[d]; reasons.push(d); }
  }
  /* F（重点国家）组合加权：必须同时命中涉华（A）或强海外利益信号才构成有效间接关联；
   * 仅因发生在重点国家且有能源/通道/灾害词（如"坦桑尼亚清洁烹饪能源运动"）不构成中国海外利益安全。 */
  var hasChina = reasons.indexOf('A') >= 0;
      var hasStrongOverseas = AK_STRONG_OVERSEAS_RE.test(text);
  if(reasons.indexOf('F') >= 0 && reasons.indexOf('G') >= 0){
    if(hasChina || hasStrongOverseas) score += 45;
  }
  else if(reasons.indexOf('F') >= 0 && (reasons.indexOf('C') >= 0 || reasons.indexOf('D') >= 0 || reasons.indexOf('H') >= 0)){
    if(hasChina || hasStrongOverseas) score += 35;
  }
  else if(reasons.indexOf('F') >= 0 && reasons.indexOf('I') >= 0){
    if(hasChina || hasStrongOverseas) score += 30;
  }
  return { score:score, reasons:reasons };
}
/* 境内事发地识别：事件发生在我境内 → 属国内治安/社会事务，不属"海外利益安全"。
 * 典型误判：'上海餐厅持刀伤人致2名日本公民受伤' —— 含外国国名但事发地在境内。 */
const AK_CN_MAINLAND_LOC_RE = /上海|北京|广州|深圳|天津|重庆|成都|武汉|西安|杭州|南京|苏州|青岛|大连|沈阳|哈尔滨|长沙|郑州|济南|合肥|福州|厦门|昆明|贵阳|南宁|海口|三亚|兰州|银川|西宁|乌鲁木齐|呼和浩特|石家庄|太原|长春|南昌|拉萨|广东|江苏|浙江|山东|河南|河北|湖南|湖北|四川|陕西|安徽|福建|江西|辽宁|吉林|黑龙江|山西|云南|贵州|广西|甘肃|青海|新疆|西藏|宁夏|内蒙古|海南|Shanghai|Beijing|Guangzhou|Shenzhen|Tianjin|Chongqing|Chengdu|Wuhan|Xi'?an|Hangzhou|Nanjing|Suzhou|Qingdao|Dalian|Shenyang|Harbin|Changsha|Zhengzhou|Jinan|Xiamen|Kunming|Urumqi|Lhasa|Guangdong|Zhejiang|Jiangsu|Shandong|Sichuan|Yunnan|Xinjiang|Tibet|Inner Mongolia/i;
/* 强海外利益信号：出现即认定为真实涉我海外利益（不含"中国公民/Chinese national"等在境内同样成立的弱词；
 * "撤离/evacuat"、"overseas/abroad"必须与中资/华人/侨胞/使馆/海外项目等同时出现，
 * 防止"Study Abroad"留学、"国内灾害撤离"等被误判为海外利益安全。 */
const AK_STRONG_OVERSEAS_RE = /中资|中企|华人|华侨|侨胞|华裔|中国公民|中方人员|驻外|使馆|领事馆|领馆|撤侨|一带一路|中欧班列|维和|护航|海外利益|境外资产|海外项目|境外投资|外派|援外|中国工人|中国工程师|中国企业|中国公司|中国船员|中国游客在|在(?:非洲|中东|东南亚|南亚|中亚|拉美|欧洲|美洲|大洋洲)|embassy|consulate|Belt and Road|Chinese workers|Chinese engineers|Chinese nationals abroad|Chinese company|Chinese firm|Chinese-owned|Chinese contractor|Chinese mine|Chinese vessel|Chinese crew|peacekeep|南海|South China Sea|(?:中资|中企|华人|华侨|侨胞|使馆|领事|海外|境外).*?(?:撤离|evacuat|overseas|abroad)|(?:撤离|evacuat|overseas|abroad).*?(?:中资|中企|华人|华侨|侨胞|使馆|领事|海外|境外)/i;
/* 境内事件逃逸信号：标题/首句已出现大陆地名时，必须命中这些明确的海外利益标记
 * 才不算国内事务。"中国公民/华人"等在境内同样成立，不能单独作为逃逸依据。
 * 例："上海餐馆持刀袭击致日本公民和中国公民受伤" → 仍属国内治安事件，拦截。 */
const AK_DOMESTIC_ESCAPE_RE = /中资|中企|国企|驻外|使馆|领事馆|领馆|撤侨|一带一路|中欧班列|维和|护航|海外利益|境外资产|海外项目|境外投资|外派|援外|中国企业.*海外|中国公司.*海外|中国船员|中国游客在|在(?:非洲|中东|东南亚|南亚|中亚|拉美|欧洲|美洲|大洋洲)|embassy|consulate|Belt and Road|Chinese workers|Chinese engineers|Chinese company.*abroad|Chinese firm.*abroad|Chinese-owned|Chinese contractor|Chinese mine|Chinese vessel|Chinese crew|peacekeep|南海|South China Sea|(?:中资|中企|使馆|领事|海外|境外).*?(?:撤离|evacuat|overseas|abroad)|(?:撤离|evacuat|overseas|abroad).*?(?:中资|中企|使馆|领事|海外|境外)/i;
/* 外国国名/民族形容词（用于判断标题中是否出现境外要素） */
const AK_FOREIGN_HINT_RE = /巴基斯坦|阿富汗|印度|缅甸|老挝|柬埔寨|泰国|越南|印尼|马来西亚|菲律宾|新加坡|日本|韩国|朝鲜|俄罗斯|乌克兰|哈萨克|吉尔吉斯|塔吉克|乌兹别克|土库曼|蒙古|伊朗|伊拉克|以色列|沙特|阿联酋|卡塔尔|土耳其|埃及|苏丹|埃塞俄比亚|肯尼亚|尼日利亚|南非|刚果|赞比亚|坦桑尼亚|安哥拉|加纳|几内亚|马里|尼日尔|乍得|索马里|利比亚|阿尔及利亚|摩洛哥|美国|加拿大|墨西哥|巴西|阿根廷|智利|秘鲁|委内瑞拉|厄瓜多尔|英国|法国|德国|意大利|西班牙|荷兰|比利时|瑞士|瑞典|挪威|波兰|希腊|澳大利亚|新西兰|巴新|所罗门|斐济|Pakistan|Afghan|India|Myanmar|Laos|Cambodia|Thai|Vietnam|Indonesia|Malaysia|Philippine|Singapore|Japan|Korea|Russia|Ukraine|Kazakh|Kyrgyz|Tajik|Uzbek|Mongolia|Iran|Iraq|Israel|Saudi|Emirates|Qatar|Turkey|Egypt|Sudan|Ethiopia|Kenya|Nigeria|South Africa|Congo|Zambia|Tanzania|Angola|Ghana|Guinea|Mali|Niger|Chad|Somalia|Libya|Algeria|Morocco|United States|American|Canada|Mexico|Brazil|Argentina|Chile|Peru|Venezuela|Britain|British|France|French|Germany|German|Italy|Spain|Netherlands|Australia|New Zealand/i;
/* 判定：事发地在我境内且无强海外利益信号 → 国内事务 */
function _akDomesticIncident(text){
  if(!text) return false;
  /* 以标题/首句窗口判定事发地：强信号必须同样出现在标题/首句，
   * 否则正文里随手提到的"使馆/领事馆"（如外方驻华机构）会让境内事件误逃逸。
   * 修复"上海餐馆持刀袭击致日本公民受伤"类误判：境内发生、仅含外国国名
   *（多为受害者国籍）≠ 海外利益安全，必须命中明确的境外利益逃逸信号才放行。
   * "中国公民/华人"等在境内同样成立，不能作为逃逸依据。 */
  var head = String(text).slice(0, 240);
  if(!AK_CN_MAINLAND_LOC_RE.test(head)) return false;
  if(AK_DOMESTIC_ESCAPE_RE.test(head)) return false;
  return true;
}
function _isTopicNoise(text){
  if(!text) return false;
  if(!AK_TOPIC_NOISE_RE.test(text.toLowerCase())) return false;
  /* 赛事/娱乐现场若出现真实安全事件（恐袭、爆炸、枪击、绑架、骚乱、人质、使馆遇袭、撤侨等）则放行；
   * 仅用 "blast" 等词形容批评/比赛强度（如 "critics blasted"）不构成真实安全事件，仍视为噪声。 */
  if(/terror|attack|bomb|shooting|gunman|kidnap|hostage|siege|stampede|riot|protesters?\s+(?:killed|shot|dead)|(?:killed|shot|dead)\s+in\s+(?:stadium|arena|attack)| embassy | consulate | evacuat|恐袭|袭击|爆炸|枪击|绑架|踩踏|骚乱|人质|劫持|围攻|使馆|领事|撤侨/i.test(text)) return false;
  return true;
}
/* 境外日常民事/行政/债务执法：法院法警因债务查封办公室、拍卖资产、强制腾退等，
 * 与"中国海外利益安全"无关，不应因"武装+重点国"规则被误收（2026-08-20）。
 * 但缉毒、缴械、反恐扣押武器爆炸物等真实安全行动不在此列。 */
const AK_ROUTINE_ENFORCEMENT_RE = /\b(?:bailiff|bailiffs|debt|debtor|creditor|auction|unpaid|arrears|owes?|owing|loan default|repossess|foreclos|evict|tax lien|revenue office|debt recovery|debt collection|强制执行|清债|讨债|债务|欠费|欠税|拍卖|查封办公室|查封资产|扣押财产|扣押资产|法警|执行局|债主|债权人|债务人|贷款违约|拖欠|欠款|欠缴|强制腾退|强行带走)\b/i;
const AK_ROUTINE_ENFORCEMENT_ACTION_RE = /\b(?:storm|storms|stormed|raided|raid|seize|seized|seizure|seizing|confiscat|attach|attached|take over|took over|taken over|repossess|repossessed|evict|evicted|foreclos|foreclosed|强制进入|冲入|闯入|占领|查封|扣押|强制腾退)\b/i;
function _isRoutineEnforcement(text){
  if(!text) return false;
  const low = text.toLowerCase();
  if(!AK_ROUTINE_ENFORCEMENT_RE.test(low)) return false;
  if(!AK_ROUTINE_ENFORCEMENT_ACTION_RE.test(low)) return false;
  if(/\b(?:weapon|weapons|explosive|explosives|drug|drugs|narcotic|narcotics|terrorist|terrorists|militant|militants|insurgent|insurgents|bomb|bombs|arms|ammunition|firearm|firearms|gun|guns|步枪|手枪|炸弹|毒品|武器|爆炸物|恐怖分子|武装分子|叛乱分子|极端组织)\b/i.test(low)) return false;
  return true;
}
/* 健康/民生/生活方式/科技八卦类噪声：与海外利益安全无关。
 * 典型误判："研究发现，糖替代品木糖醇与心脏病发作、中风和死亡的高风险有关"。
 * 豁免：真实公卫安全事件（疫情/霍乱/埃博拉/重大食物中毒/生物恐怖主义等）及
 * 药品/医疗物资出口管制、疫苗外交等涉我海外利益主题放行。 */
const AK_HEALTH_LIFESTYLE_NOISE_RE = /\b(木糖醇|xylitol|糖替代品|代糖|甜味剂|阿斯巴甜|三氯蔗糖|糖尿病|血糖|胰岛素|饮食|营养|维生素|蛋白质|减肥|肥胖|运动|睡眠|压力|心理健康|抑郁|焦虑|癌症|肿瘤|阿尔茨海默|痴呆|帕金森|心脏病|中风|心肌梗死|血压|胆固醇|疫苗接种|流感疫苗|感冒|普通病毒|细菌感染|抗生素|药物治疗|手术|医院|医生|患者|病历|医保|养生|保健|美容|护肤|化妆|香水|口红|面膜|洗发水|牙膏|牙刷|毛巾|纸巾|尿布|奶粉|婴儿|育儿|孕妇|产妇|月子|养老|退休金|彩票|抽奖|中奖|竞猜|投票|选秀|综艺|明星|演员|歌手|导演|编剧|制片人|主持人|网红|主播|博主|粉丝|点赞|转发|评论|弹幕|爆料|八卦|绯闻|恋情|结婚|离婚|出轨|整容|增肌|健身|瑜伽|跑步|马拉松|骑行|钓鱼|摄影|影评|剧评|书评|音乐推荐|综艺推荐|动漫推荐|漫画推荐|小说推荐|网文|游戏攻略|游戏评测|显卡|CPU|主板|内存|固态硬盘|显示器|机械键盘|鼠标|耳机|数码评测|手机评测|汽车评测|美食探店|旅游攻略|穿搭|美妆教程|护肤知识|健身教程|瑜伽入门|跑步指南|钓鱼技巧|摄影教程|咖啡|茶|酒|香烟|电子烟|烟草|酒精|毒品|赌博|色情)\b/i;
function _isHealthLifestyleNoise(text){
  if(!text) return false;
  if(!AK_HEALTH_LIFESTYLE_NOISE_RE.test(text)) return false;
  /* 豁免真实公卫安全事件与涉我医疗物资/疫苗外交 */
  if(/\b(疫情|传染病|瘟疫|大流行|霍乱|埃博拉|脊髓灰质炎|黄热病|登革热|疟疾|鼠疫|炭疽|生化武器|生物恐怖|实验室泄漏|疫苗外交|医疗物资|医疗援助|缺医少药|药品短缺|出口管制|禁运|制裁|WHO|世界卫生组织| CDC |卫生紧急状态|public health emergency|outbreak|epidemic|pandemic|cholera|ebola|polio|yellow fever|dengue|malaria|plague|anthrax)\b/i.test(text)) return false;
  return true;
}
/* CPEC/俾路支热点（2026-08-18 用户指令）：BLA/TTP/BLF 在俾路支省及中巴经济走廊沿线以中资
 * 项目/矿业/工程/营地为主要袭击目标。该语境下 矿业/项目/公司/营地 + 武装绑架/袭击 即视为高度涉我
 * 海外利益——即便一手英文报道未点名"Chinese"（2026-08-12 沙盖 Chagai 铜矿7矿工被 BLA 绑架，
 * Dawn 仅称 "private copper mining company"，无中国词 → 原判 indirect-no-china-link 丢弃，漏报）。
 * 袭击词仅限武装/绑架/伏击等激进语境，剔除"瓦斯爆炸/矿难事故"类纯安全事故，避免误纳巴国内矿难。 */
const AK_CPEC_HOTSPOT_RE = /俾路支|balochistan|chagai|沙盖|瓜达尔|gwadar|quetta|奎达|中巴经济走廊|CPEC|开伯尔|khyber|gilgit|吉尔吉特|waziristan|瓦济里斯坦/i;
const AK_CPEC_ASSET_RE = /矿|mine|mining|copper|gold|coal|project|company|firm|construction|engineer|worker|camp|port|power plant|dam|refinery|工程|项目|公司|企业|铜|金|煤|工人|工程师|营地|港口|电站/i;
const AK_CPEC_ATTACK_RE = /绑架|劫持|袭击|武装袭击|武装分子|恐怖分子?|枪击|伏击|人质|枪手|自杀式|abduct\w*|kidnap\w*|attack\w*|gunmen|gunman|armed (?:men|attackers?|assailants?|militants?)|militant\w*|insurgent\w*|terror\w*|ambush|hostage|suicide (?:bomb|attack|blast)|IED/i;
function _akCpecHotspot(text){
  return !!(text && AK_CPEC_HOTSPOT_RE.test(text) && AK_CPEC_ASSET_RE.test(text) && AK_CPEC_ATTACK_RE.test(text));
}
/* ===== 海外安全态势采集放宽（2026-08-18 用户指令）=====
 * "跟中国无关的外国治安新闻，只要涉及恐怖袭击、恐怖组织、犯罪组织、黑帮等，以及中国海外利益
 *  集中的国家，都要采集。" 此前闸门对无中国关联的外国安全事件一律 foreign-irrelevant/indirect-no-china-link
 *  拦截（实测：刚果金M23推进、海地黑帮火并 等被丢），与安全态势感知目标相悖。
 * 现放宽：① 涉恐怖/极端武装/犯罪组织/黑帮 的安全事件——不限国别一律采集；
 *        ② 中国海外利益集中国家（重点国）的安全/冲突/风险事件——一律采集。
 * 两道均要求命中"安全事件"词（袭击/爆炸/绑架/枪击/死亡等），防止纯评论/泛政治文混入；
 * 噪声过滤（体育娱乐/文化商业/国内事务）在本规则之前已执行，不受影响。 */
const AK_SEC_EVENT_RE = /恐怖袭击|爆炸|枪击|绑架|劫持|袭击|冲突|伏击|自杀式|汽车炸弹|武装|杀死|杀害|死亡|遇难|身亡|伤亡|政变|海盗|屠杀|terror|attack|blast|bomb|explos|shoot|shot|gunmen|gunman|gunfire|kill|dead|death|hostage|kidnap|abduct|clash|ambush|armed|suicide|car bomb|IED|coup|piracy|massacre|casualt|wound/i;
const AK_TERROR_CRIME_ORG_RE = /恐怖组织|恐怖分子|恐怖主义|极端组织|极端分子|武装组织|武装分子|犯罪组织|有组织犯罪|黑帮|黑手党|贩毒集团|恐怖|伊斯兰国|基地组织|塔利班|博科圣地|青年党|胡塞|真主党|哈马斯|俾路支|叛乱|反叛军|叛军|雇佣兵|terror|militant|insurgent|jihad|extremist|ISIS|ISIL|Islamic State|al[- ]?Qaeda|Taliban|Boko Haram|Al[- ]?Shabaab|Shabaab|Houthi|Hezbollah|Hamas|ISWAP|cartel|mafia|gang|crime syndicate|armed group|rebel|mercenar/i;
/* 中国海外利益集中国家（重点国，与 server.js _FOCUS_COUNTRIES 同源）：BRI 沿线 + 中资高风险所在国 */
const AK_FOCUS_COUNTRY_RE = /俾路支|瓜达尔|巴基斯坦|哈萨克|乌兹别克|吉尔吉斯|塔吉克|土库曼|老挝|柬埔寨|缅甸|印度尼西亚|印尼|马来西亚|泰国|越南|塞尔维亚|匈牙利|希腊|埃塞俄比亚|肯尼亚|吉布提|埃及|斯里兰卡|孟加拉国|尼泊尔|沙特|阿联酋|土耳其|白俄罗斯|波兰|苏丹|刚果|尼日利亚|伊拉克|也门|马里|尼日尔|索马里|阿富汗|叙利亚|利比亚|中非|莫桑比克|坦桑尼亚|赞比亚|津巴布韦|安哥拉|摩洛哥|突尼斯|阿尔及利亚|约旦|黎巴嫩|伊朗|印度|菲律宾|哥伦比亚|秘鲁|墨西哥|南非|阿根廷|智利|委内瑞拉|蒙古|喀麦隆|乍得|南苏丹|Balochistan|Gwadar|Pakistan|Kazakhstan|Uzbekistan|Kyrgyzstan|Tajikistan|Turkmenistan|Laos|Cambodia|Myanmar|Indonesia|Malaysia|Thailand|Vietnam|Serbia|Hungary|Greece|Ethiopia|Kenya|Djibouti|Egypt|Sri Lanka|Bangladesh|Nepal|Saudi|UAE|Emirates|Turkey|Belarus|Poland|Sudan|Congo|DRC|Nigeria|Iraq|Yemen|Mali|Niger|Somalia|Afghanistan|Syria|Libya|Central African|Mozambique|Tanzania|Zambia|Zimbabwe|Angola|Morocco|Tunisia|Algeria|Jordan|Lebanon|Iran|India|Philippines|Colombia|Peru|Mexico|South Africa|Argentina|Chile|Venezuela|Mongolia|Cameroon|Chad|South Sudan/i;
function chinaOverseasGate(text){
  if(!text) return {pass:true, reason:'empty'};
  if(_isTopicNoise(text)) return {pass:false, reason:'topic-noise'};  /* 体育/娱乐，无论是否涉华 */
  /* 健康/民生/生活方式/科技八卦类噪声（2026-08-27） */
  if(_isHealthLifestyleNoise(text)) return {pass:false, reason:'health-lifestyle-noise'};
  /* 境外日常民事/行政/债务执法：与中国海外利益安全无关，优先拦截（2026-08-20） */
  if(_isRoutineEnforcement(text)) return {pass:false, reason:'routine-enforcement'};
  /* 涉华APP/技术/芯片禁令：属中国海外利益安全（中国企业出海受阻/技术被封锁），优先放行 */
  if(AK_CHINA_APP_BAN_RE.test(text)) return {pass:true, reason:'china-tech-ban'};
  /* 纯国内百科/教育/科技/论坛/产品介绍/军事庆典噪声：QQ邮箱介绍、知乎问答、
   * 中华网论坛、天文发现、建军节招待会等，与海外利益安全无关。
   * 若同时命中强安全事件词（恐袭/袭击/爆炸等），则视为安全事件报道，不滤除。 */
  if(AK_DOMESTIC_EDU_TECH_RE.test(text) && !AK_TOPIC_SECURITY_RE.test(text)){
    return {pass:false, reason:'domestic-edu-tech-noise'};
  }
  /* 文化/商业/历史/民俗/生活方式类噪声：与海外利益安全无关。
   * 若同时命中强安全事件/风险词（如"华人文化节遭恐袭"），则放行。 */
  if(AK_CULTURE_BUSINESS_JUNK_RE.test(text) && !AK_TOPIC_SECURITY_RE.test(text) && !/遭袭|遇害|遇难|伤亡|死伤|制裁|出口管制|技术封锁|禁令|禁止|冻结|扣押|查封|调查|审查|抗议|示威|冲突|争端|摩擦|紧张|风险|威胁|警告|指责|批评|谴责|限制|打压|排斥|歧视|反华|排华|敌意|负面|危机|纠纷|诉讼|仲裁|罚款|处罚|违约|亏损|破产|倒闭|裁员|停工|停产|停建|中断|撤离|疏散|袭击|攻击|恐袭|爆炸|枪击|绑架|劫持|人质|谋杀|刺杀|暴力|抢劫|盗窃|破坏|损毁|损失/i.test(text)){
    return {pass:false, reason:'culture-business-junk'};
  }
  /* 事发地在我境内且无强海外利益信号 → 国内事务，不入海外利益安全平台 */
  if(_akDomesticIncident(text)) return {pass:false, reason:'china-domestic-incident'};
  /* CPEC/俾路支热点：矿业/项目/营地 + 武装绑架袭击 → 高度涉我海外利益，直接放行。
   * 置于涉华判定之前：一手英文报道常不点名"Chinese"，靠此规则兜住（2026-08-12 沙盖铜矿绑架）。 */
  if(_akCpecHotspot(text)) return {pass:true, reason:'cpec-hotspot-china-interest'};
  /* 海外安全态势（2026-08-18 用户指令）：① 涉恐怖/极端武装/犯罪组织/黑帮的安全事件——不限国别采集；
   * ② 中国海外利益集中国家（重点国）的安全/冲突事件——一律采集。即便与中国无直接关联。 */
  if(AK_SEC_EVENT_RE.test(text) && AK_TERROR_CRIME_ORG_RE.test(text)) return {pass:true, reason:'global-terror-crime'};
  if(AK_SEC_EVENT_RE.test(text) && AK_FOCUS_COUNTRY_RE.test(text)) return {pass:true, reason:'focus-country-security'};
  if(_akChinaRelated(text)){
    /* 纯国内（台港）内部政务/选举/当局口号，且无真实海外利益信号 → 国内噪声，不入海外利益安全平台 */
    if(AK_DOMESTIC_POLITICS_RE.test(text) && !AK_OVERSEAS_INTEREST_RE.test(text)){
      return {pass:false, reason:'china-domestic'};
    }
    /* 涉华条目必须同时满足：① 强海外利益信号（中资/中企/华人/华侨/使馆/一带一路/海外项目/台海军事等）
     * 且 ② 有风险/安全/负面含义（制裁/抗议/冲突/袭击/威胁/风险/损失/中断等）。
     * 否则视为国内社会/文化/商业/民生新闻或普通海外交流，拦截。 */
        /* 正面商业成就不是海外利益安全预警（2026-08-13 用户指令）：出货量超越对手/中标/签约/破纪录等，
       无风险/管制/负面含义时拦截 */
    var POS_ACHIEVE = /出货量|销量|市场份额|超越了?|超过|夺冠|中标|签约|荣获|获批|破纪录|创新高|营收|净利润|surpass\w*|exceed\w*|outpace\w*|record (shipment|sales|revenue)|wins? (contract|deal)|signs? (deal|contract)|secures? (deal|contract)|market share/i.test(text);
    var RISK_CTX = /制裁|管制|限制|禁令|禁止|封锁|断供|脱钩|审查|调查|风险|威胁|遇袭|袭击|死亡|伤亡|绑架|担忧|停产|停工|中断|停摆|撤离|疏散|sanction|ban|restrict|curb|block|halt|stop|risk|threat|attack|kill|fear|concern|review|probe|investigat|evacuat/i.test(text);
    if (POS_ACHIEVE && !RISK_CTX) return {pass:false, reason:'positive-business-news'};
var hasStrongOverseas = AK_STRONG_OVERSEAS_RE.test(text);
    /* 2026-08-13 经贸安全信号（用户指令：芯片禁令/出口管制/关键原材料/供应链这类必须采）。
     * 原强海外利益信号全是"中资/华人/使馆"类人员资产词，芯片/出口管制等经贸安全英文词不在表内 → 误拦。 */
    var hasTradeStrong = /export control|export curb|export restriction|export ban|export licen|sanction|tariff|entity list|blacklist|investment (screening|review)|CFIUS|anti-dumping|countervailing|trade war|decoupl|blockade|embargo|制裁|关税|实体清单|反倾销|反补贴|贸易战|脱钩|断供|出口管制|出口限制|出口禁令|禁运/i.test(text);
      var hasTradeWeak = /chips?|chipmakers?|semiconductor|supply chain|rare earth|critical minerals?|raw materials?|subsid|芯片|半导体|供应链|稀土|关键矿产|原材料/i.test(text);
      var hasTradeRisk = /restrict|curb|ban|block|halt|stop|disrupt|shortage|fear|worr|threat|risk|concern|tension|shutdown|suspend|delay|cancel|limit|squeez|crunch|限制|中断|停摆|停产|停工|短缺|担忧|担心|威胁|风险|紧张|暂停|取消|推迟/i.test(text);
      var hasTradeEcon = hasTradeStrong || (hasTradeWeak && hasTradeRisk);
    var hasRisk = _akChinaNegative(text) || AK_TOPIC_SECURITY_RE.test(text) ||
      /遭袭|遇害|遇难|伤亡|死伤|制裁|出口管制|技术封锁|禁令|禁止|冻结|扣押|查封|调查|审查|抗议|示威|冲突|争端|摩擦|紧张|风险|威胁|警告|指责|批评|谴责|限制|打压|排斥|歧视|侮辱|辱骂|骚扰|恐吓|威胁|反华|排华|敌意|负面|危机|纠纷|诉讼|仲裁|罚款|处罚|违约|亏损|破产|倒闭|裁员|停工|停产|停建|中断|撤离|疏散|炮击|逼近|袭击|攻击|恐袭|爆炸|枪击|绑架|劫持|人质|谋杀|刺杀|暴力|抢劫|盗窃|破坏|损毁|损失|死|亡|伤|危|险|擅闯|闯入|入侵|非法进入|围殴|殴打|伤害/i.test(text);
    if (hasStrongOverseas && hasRisk) return {pass:true, reason:'china-overseas-risk'};
    /* 涉华 + 经贸安全信号 → 直接放行（芯片流向管制/关键原材料出口限制/供应链中断等） */
    if (hasTradeEcon) return {pass:true, reason:'china-trade-econ-security'};
    /* 涉华军品扩散风险（2026-08-13 用户点名：中国产无人机被塔利班/基地组织武器化这类必须采） */
    if (/中国|Chinese|China/i.test(text) && /无人机|武器|军火|导弹|弹药|改装|军备|weaponiz|drone|UAV|arms|munition/i.test(text) && /塔利班|基地组织|恐怖|武装分子|叛乱|雇佣兵|Taliban|Qaeda|ISIS|ISIL|militant|terror|insurgent|rebel|mercenar/i.test(text)) return {pass:true, reason:'china-arms-proliferation'};
    return {pass:false, reason:'china-domestic'};
  }
  if(_akIsChinese(text)){
    /* 平台定位：中国海外利益安全。纯中文且无任何海外标记/外国国别 → 与海外利益无关，默认剔除
       （国内社会/民生/政务/体育/娱乐/纯国内灾害均不属海外利益安全范畴）。
       仅当含海外标记（海外/中资/华人/中国公民/使馆/一带一路重大项目/台港…）才进入涉华海外事务判定。 */
    if(!_akHasOverseasMarker(text) && !AK_OVERSEAS_INTEREST_RE.test(text)) return {pass:false, reason:'domestic-irrelevant'};
  }
  /* 非涉华外文内容：必须同时满足 ① 关联度评分≥60 且 ② 含涉华要素、强海外利益信号，
   * 或发生在核心/关键利益国且含安全/冲突/恐袭/制裁等战略外溢信号（F+G）。
   * 否则"坦桑尼亚清洁烹饪能源运动"等纯他国内政/民生新闻会借 F+C/D/H/I 组合误入。 */
  var sc = _scoreOverseasInterest(text);
  if(sc.score >= 60){
    var hasChinaLink = sc.reasons.indexOf('A') >= 0 || AK_STRONG_OVERSEAS_RE.test(text);
    /* F+G 风险外溢必须排除健康/民生/生活方式噪声（例：美国木糖醇健康研究含 "death" 被误判为安全事件） */
    var hasRiskSpillover = sc.reasons.indexOf('F') >= 0 && sc.reasons.indexOf('G') >= 0 && !_isHealthLifestyleNoise(text);
    if(hasChinaLink || hasRiskSpillover){
      return {pass:true, reason:'indirect-overseas-interest:' + sc.reasons.join(',')};
    }
    var EXEMPT=/霍尔木兹|苏伊士|马六甲|巴拿马运河|曼德海峡|红海|油轮|货轮|商船|航运|海运|航道|海峡|运河|海盗|亚丁湾|Hormuz|Suez|Malacca|Panama Canal|Bab el-Mandeb|Red Sea|tanker|cargo ship|vessel|shipping|maritime|piracy|strait|canal|中资|中企|中方|华人|华侨|中国公民|使馆|领事|撤侨|一带一路|Chinese|China/i;
    if(EXEMPT.test(text)) return {pass:true, reason:'exempt-interest'};
    return {pass:false, reason:'indirect-no-china-link'};
  }
  return {pass:false, reason:'foreign-irrelevant'};
}

/* ===== 归一化为通用条目 ===== */

/* ===== 时效闸门（实时性保障）=====
 * 背景：部分站点的 RSS 是多年未更新的僵尸存档（实测 China Daily world_rss.xml
 * 返回的仍是 2017-12 的条目）。这类陈年旧闻一旦进入预警链路，会以"实时情报"
 * 的面目污染态势感知。此处按 pubDate 做硬性时效过滤。
 * 规则：能解析出发布时间且早于 maxAgeDays 的条目直接丢弃；解析不出时间的条目
 *       予以保留（多数 feed 时间字段缺失但内容是新的），不做主观臆断。
 * 例外：trusted 统计型数据源（UNHCR 年度人口、HDX 数据集等）本身即历史统计，
 *       不适用新闻时效，跳过本闸门。 */
function _parsePub(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const t = Date.parse(String(v));
  return isNaN(t) ? 0 : t;
}
function freshFilter(items, maxAgeDays) {
  const days = maxAgeDays || 30;
  const floor = Date.now() - days * 86400000;
  return items.filter(it => {
    const t = _parsePub(it.pubDate);
    if (!t) return true;                 /* 无时间戳：保留，不臆测 */
    if (t > Date.now() + 86400000) return true; /* 时区导致的轻微未来时间，放行 */
    return t >= floor;
  });
}
function normalize(raw, sourceDef) {
  return raw.map(r => {
    const text = (r.title || '') + ' ' + (r.description || '');
    const country = r._forceCountry || extractCountry(text) || '';
    const title = r.title || '(无标题)';
    const desc = String(r.description || '').trim();
    /* 概述性数据识别：description 缺失 / 与标题雷同 / 过短，都说明这条只有"一句话概述"，
     * 打上 _ftPending 标记交由正文引擎（fulltext.js）回源抓全文补细节，
     * 抓不到就保留原摘要，绝不编造。 */
    const summaryOnly = !desc || desc === title || desc.length < 120;
    return {
      title: title,
      content: desc || title,
      country,
      source: sourceDef.name,
      severity: '中',
      url: r.link || '',
      category: sourceDef.category,
      pubDate: r.pubDate || '',
      _ftPending: summaryOnly
    };
  });
}

/* ===== 源健康度与失败退避 =====
 * 目的：注册了大量国际源后，若每次都串行等待不可达源超时，采集会被拖死。
 * 策略：① 连续失败 → 指数退避（1/3/10/30 分钟，上限 30 分钟）冷却期内直接跳过；
 *       ② 单源超时按 tier 区分（live 12s / probe 6s，快速失败）；
 *       ③ 全部通道并发执行，互不阻塞；
 *       ④ 健康状态如实记录并对外暴露，不可达就是不可达，绝不用替代内容填充。 */
const _health = {};
function _hs(key) {
  return _health[key] || (_health[key] = { ok: 0, fail: 0, streak: 0, lastTry: 0, lastOk: 0, items: 0, cooldownUntil: 0, ms: 0, err: '' });
}
const _BACKOFF = [60000, 180000, 600000, 1800000];
function _markOk(key, n, ms) {
  const h = _hs(key);
  h.ok++; h.streak = 0; h.lastTry = h.lastOk = Date.now(); h.items = n; h.cooldownUntil = 0; h.ms = ms; h.err = '';
}
function _markFail(key, err, ms) {
  const h = _hs(key);
  h.fail++; h.streak++; h.lastTry = Date.now(); h.ms = ms;
  h.err = String(err || 'unreachable').slice(0, 60);
  h.cooldownUntil = Date.now() + _BACKOFF[Math.min(h.streak - 1, _BACKOFF.length - 1)];
}

/* ===== 对外接口 ===== */
async function scrapeSource(key) {
  const def = SCRAPE_SOURCES[key];
  if (!def) return [];
  const h = _hs(key);
  /* 冷却期内跳过（避免不可达源反复拖慢整体采集） */
  if (h.cooldownUntil && Date.now() < h.cooldownUntil) return [];
  /* 限频源（如 GDELT 要求 ≥5s 一次，这里按源配置的最小间隔控制） */
  if (def.minInterval && h.lastTry && (Date.now() - h.lastTry) < def.minInterval) return [];
  const t0 = Date.now();
  const timeout = def.timeout || (def.tier === 'probe' ? 6000 : 12000);
  let text = await _fetchText(def.url, timeout);
  /* live 源重试一次：58 个源并发时本机连接数竞争会造成偶发超时（实测 USGS 单独抓
   * 1.5s 即通、并发轮次却 timeout）。probe 源不重试，避免为不可达源浪费时间。 */
  if (!text && def.tier !== 'probe') {
    await new Promise(r => setTimeout(r, 400));
    text = await _fetchText(def.url, timeout);
  }
  if (!text) { _markFail(key, 'timeout/unreachable', Date.now() - t0); return []; }
  try {
    let raw = [];
    if (def.type === 'geojson') raw = parseUsgs(JSON.parse(text));
    else if (def.type === 'gdelt') raw = parseGdelt(JSON.parse(text));
    else if (def.type === 'reliefjson') raw = parseRelief(JSON.parse(text));
    else if (def.type === 'unhcr') raw = parseUnhcr(JSON.parse(text));
    else if (def.type === 'hdx') raw = parseHdx(JSON.parse(text));
    else if (def.type === 'emsc') raw = parseEmsc(JSON.parse(text));
    else if (def.type === 'eonet') raw = parseEonet(JSON.parse(text));
    else raw = parseRssItems(text);
    if (!raw.length) { _markFail(key, 'empty payload', Date.now() - t0); return []; }
    /* trusted 源（灾害/人道/冲突专业数据库）本身即全量相关，跳过通用关键词闸门，
     * 否则 "M4.8 - 91 km W of ..." 这类结构化标题会被误杀 */
    let out = normalize(raw, def);
    /* 中国海外利益相关性闸门：仅保留与"中国海外利益安全"相关的情报，剔除国内民生噪声 */
    out = out.filter(it => chinaOverseasGate(it.title + ' ' + (it.content || '')).pass);
    if (!def.trusted) {
      out = out.filter(it => _relevant(it.title + ' ' + (it.content || '')));
      out = freshFilter(out, def.maxAgeDays);   /* 时效闸门：拦截僵尸存档 feed */
    }
    _markOk(key, out.length, Date.now() - t0);
    return out;
  } catch (e) { _markFail(key, e && e.message, Date.now() - t0); return []; }
}
async function scrapeCategory(cat) {
  const keys = (CAT_TO_SCRAPE[cat] || []).reduce((acc, c) => acc.concat(CATEGORY_MAP[c] || []), []);
  if (!keys.length) return [];
  /* 并发抓取：单源失败/超时不阻塞其他源 */
  const settled = await Promise.allSettled(keys.map(k => scrapeSource(k)));
  const out = [];
  const seen = Object.create(null);
  settled.forEach(s => {
    if (s.status !== 'fulfilled' || !s.value) return;
    s.value.forEach(it => {
      const k = String(it.title || '').replace(/\s+/g, '').slice(0, 50);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push(it);
    });
  });
  return out;
}
async function scrapeAll() {
  const cats = Object.keys(CAT_TO_SCRAPE);
  const settled = await Promise.allSettled(cats.map(c => scrapeCategory(c)));
  const data = {};
  cats.forEach((c, i) => { data[c] = (settled[i].status === 'fulfilled' && settled[i].value) || []; });
  return data;
}
/* 源健康快照（真实统计，供 /api/sources 与前端"数据源库"展示） */
function sourceHealth() {
  return Object.keys(SCRAPE_SOURCES).map(k => {
    const d = SCRAPE_SOURCES[k], h = _hs(k);
    let status = 'idle';
    if (h.lastOk && h.items > 0) status = 'online';
    else if (h.fail && !h.lastOk) status = (d.tier === 'probe' ? 'reserved' : 'offline');
    else if (h.lastOk) status = 'online';
    return {
      id: k, name: d.name, category: d.category, tier: d.tier || 'live', url: d.url,
      status, ok: h.ok, fail: h.fail, items: h.items, ms: h.ms,
      lastOk: h.lastOk ? new Date(h.lastOk).toISOString() : '',
      lastTry: h.lastTry ? new Date(h.lastTry).toISOString() : '',
      cooldownUntil: h.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : '',
      err: h.err
    };
  });
}

module.exports = { scrapeSource, scrapeCategory, scrapeAll, proxyFetchText, SCRAPE_SOURCES, sourceHealth,
  /* —— 供 crawler.js（特种兵）/ agentkey.js 复用 —— */
  fetchText: _fetchText, extractCountry, extractOverseasCountry, relevant: _relevant, parseRss: parseRssItems, chinaOverseasGate,
  isChinaRelatedStrict };
