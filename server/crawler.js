'use strict';
/**
 * server/crawler.js — 特种兵爬虫（一键全网深抓）
 * ───────────────────────────────────────────────────────────
 * 架构定位（用户需求）：
 *   · 底座 / 常规力量 = 注册数据源（scrapers.js），由系统自动定时补数据（_refreshReal 每120s + _approvedSyncScan 每15s 自循环分发）。
 *   · 特种兵 = 本模块，不定时由"一键采集"触发，突破系统注册源，直接对全网
 *     （搜索引擎 / 社交平台 / 各国媒体网站）按关键词（默认"涉华负面"）做深度抓取。
 * 安全约束：
 *   · 仅接受"关键词(query)"，绝不接受"任意URL" —— 所有目标主机固定白名单(复用 scrapers._hostAllowed，SSRF 防护)。
 *   · 抓取失败一律返回空数组，由前端回退到模板模拟，系统永远"活"。
 *
 * 暴露：crawlAll()  /  crawlQuery(q)  /  chinaNegative(text)
 */
const netx = require('./netx');
const scrapers = require('./scrapers');
/* 实体识别与预警规则引擎（前后端同源，全平台唯一关联中枢） */
const ENTITY = require('../entities.js');

/* ===== 搜索引擎（全网聚合，国内可直连 Bing；Google 被墙故用 Bing 替代）
 * 实测(2026-07)：cn.bing.com/search?q=..&format=rss + 浏览器UA → 返回真实RSS（可用）
 *               www.bing.com/news/search 302→cn.bing.com 后无RSS（不可用，已弃）      ===== */
const SEARCH_ENGINES = [
  { id:'bing_cn',   name:'Bing全网搜索(RSS聚合)', type:'bingweb', url:'https://cn.bing.com/search' }
];

/* ===== 社交平台（涉华负面主战场） ===== */
const SOCIAL_TARGETS = [
  { id:'reddit',    name:'Reddit 社交讨论', type:'reddit',    url:'https://www.reddit.com/search.json' },
  { id:'mastodon',  name:'Mastodon 开源社交', type:'mastodon', url:'https://mastodon.social/api/v2/search' }
];

/* ===== 各国媒体网站 RSS（列入白名单；被墙源抓取失败静默跳过，系统仍活） ===== */
const MEDIA_FEEDS = [
  { id:'bbc_world',      name:'BBC World',            country:'英国',     url:'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id:'aljazeera',      name:'Al Jazeera',           country:'卡塔尔',   url:'https://www.aljazeera.com/xml/rss/all.xml' },
  { id:'france24',       name:'France24',             country:'法国',     url:'https://www.france24.com/en/rss' },
  { id:'dw',             name:'DW',                    country:'德国',     url:'https://www.dw.com/en/rss/rss-en-all' },
  { id:'nhk',            name:'NHK World',             country:'日本',     url:'https://www3.nhk.or.jp/nhkworld/en/news/rss.xml' },
  { id:'guardian',       name:'The Guardian',         country:'英国',     url:'https://www.theguardian.com/world/rss' },
  { id:'apnews',         name:'AP News',              country:'美国',     url:'https://apnews.com/index.rss' },
  { id:'scmp',           name:'南华早报 SCMP',         country:'中国香港', url:'https://www.scmp.com/rss/91/feed' },
  { id:'strait',         name:'Straits Times',        country:'新加坡',   url:'https://www.straitstimes.com/rss/world' },
  { id:'cna',            name:'Channel NewsAsia',     country:'新加坡',   url:'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_wrapper=news' },
  { id:'bangkokpost',    name:'Bangkok Post',         country:'泰国',     url:'https://www.bangkokpost.com/rss/news' },
  { id:'jpost',          name:'Jerusalem Post',       country:'以色列',   url:'https://www.jpost.com/rss/rssfeeds/2' },
  { id:'tass',           name:'TASS',                 country:'俄罗斯',   url:'https://tass.com/rss' },
  { id:'rt',             name:'RT',                   country:'俄罗斯',   url:'https://www.rt.com/rss/news/' },
  { id:'globaltimes',    name:'Global Times',         country:'中国',     url:'https://www.globaltimes.cn/rss/world.xml' },
  { id:'chinadaily',     name:'China Daily',          country:'中国',     url:'https://www.chinadaily.com.cn/rss/world/rss_world.xml' }
];

/* ===== 涉华负面判定：须同时命中"中国相关词"与"负面/风险词" ===== */
const CHINA_TERMS = [
  '中国','Chinese','China','中资','华人','华侨','中方','出海','驻外','使馆','一带一路','中企','国企','华裔',
  "China's",'Beijing','Chinese companies','overseas Chinese','Taiwan','Hong Kong','Xinjiang','Tibet'
];
const NEG_TERMS = [
  '批评','指责','威胁','制裁','抵制','抗议','反对','抨击','警惕','风险','冲突','攻击','间谍','渗透','撤资','禁令','限制',
  '打压','敌意','负面','逮捕','起诉','调查','排华','反华',
  'diss','critic','sanction','threat','boycott','protest','spy','ban','risk','attack','warns','crackdown','backlash',
  'hostile','condemn','accuse','arrest','probe','ban','sanctions'
];
function chinaRelated(text){
  /* 2026-08-27 统一走后端严格涉华判定，避免 "Chinese" 单独作为形容词误标 */
  return scrapers.isChinaRelatedStrict(text);
}
function chinaNegative(text){
  if(!text) return false;
  if(!chinaRelated(text)) return false;
  var low = text.toLowerCase();
  for(var j=0;j<NEG_TERMS.length;j++){ if(low.indexOf(NEG_TERMS[j].toLowerCase())>=0) return true; }
  return false;
}
/* 风险词命中（不要求涉华）：地震/袭击/冲突/制裁/疫情等硬风险信号 */
const RISK_TERMS = NEG_TERMS.concat([
  '地震','海啸','台风','洪水','爆炸','枪击','绑架','恐怖','疫情','疫苗','政变','骚乱','动乱','戒严','罢工','示威',
  'earthquake','tsunami','typhoon','flood','explosion','shooting','kidnap','terror','outbreak','coup','riot','unrest','strike','evacuat','killed','dead','war'
]);
/* 海外利益要素词（不要求负面）：项目/投资/能源/港口/领事/撤侨/航运等 —— 涉华 + 命中任一 = 与中国海外利益安全相关 */
const INTEREST_TERMS = [
  '海外','项目','投资','合作','港口','矿产','能源','石油','天然气','电站','铁路','公路','基建','工程','园区','承包',
  '一带一路','中欧班列','领事','签证','撤侨','护航','航运','供应链','关税','贸易','出口','进口','并购','债务','贷款',
  '劳工','务工','员工','侨民','留学生','游客','安保','保险','汇率','外交','协定','谈判','军演','演习','部署','基地',
  'overseas','project','investment','cooperation','port','mining','energy','oil','gas','power plant','railway','infrastructure',
  'belt and road','consular','visa','evacuation','shipping','supply chain','tariff','trade','export','import','merger','debt','loan',
  'workers','citizens','students','tourists','security','insurance','exchange rate','diplomatic','agreement','negotiation',
  'military exercise','deployment','base','navy','fleet','pipeline','contract','deal'
];
function interestRelated(text){
  if(!text) return false;
  var low = text.toLowerCase();
  for(var i=0;i<INTEREST_TERMS.length;i++){ if(low.indexOf(INTEREST_TERMS[i].toLowerCase())>=0) return true; }
  return false;
}
/* ===== 短英文词整词匹配（防子串误伤：Counter-Strike≠strike罢工、award≠war、Ukraine≠rain）===== */
const EXACT_EN = ['war','strike','riot','coup','ban','risk','dead','spy','base','deal','oil','gas'];
function _kwHit(low, kw){
  var k = kw.toLowerCase();
  if(EXACT_EN.indexOf(k)>=0){
    try{ return new RegExp('(?<![a-z-])'+k+'(?![a-z-])').test(low); }
    catch(e){ return low.indexOf(k)>=0; }
  }
  return low.indexOf(k)>=0;
}
function hasRisk(text){
  if(!text) return false;
  var low = text.toLowerCase();
  for(var i=0;i<RISK_TERMS.length;i++){ if(_kwHit(low, RISK_TERMS[i])) return true; }
  return false;
}
/* ===== 无关主题噪声黑名单（电竞/游戏/体育/娱乐——除非涉华负面，一律丢弃）===== */
const NOISE_RE = /电竞|电子竞技|游戏攻略|游戏指南|游戏更新|CS:GO|CSGO|CS2|Counter-Strike|反恐精英|英雄联盟|League of Legends|Dota|王者荣耀|绝地求生|PUBG|Valorant|无畏契约|守望先锋|炉石传说|星际争霸|魔兽世界|原神|米哈游|Steam平台|主机游戏|手游|网游|Major冠军|Major赛事|战队夺冠|职业选手|电竞选手|锦标赛MVP|总决赛MVP|季后赛|常规赛|NBA|英超|西甲|意甲|德甲|欧冠联赛|世界杯预选赛|转会费|球星|球员合同|演唱会|综艺节目|票房|影视剧|电视剧|明星八卦|娱乐圈|选秀节目|颁奖典礼|格莱美|奥斯卡/i;
function isNoise(text){
  if(!text) return false;
  return NOISE_RE.test(text);
}

/* ===== 12要素自动分类（与前端 COLLECTED_DB/数据库浏览 的 data_type 一一对应） =====
 * 优先级从具体到宽泛：灾害→卫生→恐袭→军事→制裁→动荡→政治→基建→涉华安全→地缘→开源 */
const CLASSIFY_RULES = [
  { type:'natural_disasters', kw:['地震','海啸','台风','飓风','洪水','山体滑坡','泥石流','火山','干旱','野火','山火','暴雨','强震','余震','earthquake','tsunami','typhoon','hurricane','cyclone','flood','landslide','volcano','wildfire','drought','magnitude','quake','storm'] },
  { type:'public_health',     kw:['疫情','疫苗','病毒','传染病','霍乱','埃博拉','流感','病例','公共卫生','防疫','outbreak','epidemic','pandemic','virus','cholera','ebola','vaccine','infection','disease control','health emergency'] },
  { type:'terror_events',     kw:['恐怖','恐袭','自杀式','人体炸弹','汽车炸弹','绑架','劫持','人质','极端组织','伊斯兰国','基地组织','博科圣地','青年党','俾路支','terror','suicide bomb','car bomb','kidnap','hostage','hijack','extremist','ISIS','al-qaeda','boko haram','al-shabaab','militant attack'] },
  { type:'military_conflicts',kw:['战争','交火','空袭','武装冲突','军事冲突','边境冲突','导弹袭击','无人机袭击','炮击','停火','前线','攻势','开战','war','airstrike','air strike','missile strike','shelling','ceasefire','offensive','troops','clashes','drone strike','battle','frontline','armed conflict','invasion'] },
  { type:'sanctions_data',    kw:['制裁','出口管制','实体清单','禁运','关税','贸易限制','冻结资产','黑名单','长臂管辖','sanction','embargo','export control','entity list','tariff','blacklist','trade restriction','asset freeze'] },
  { type:'social_unrest',     kw:['抗议','示威','骚乱','罢工','游行','暴乱','戒严','宵禁','打砸','动乱','protest','riot','demonstration','unrest','curfew','looting','strike','uprising','mass rally'] },
  { type:'political_events',  kw:['政变','选举','弹劾','内阁','辞职','议会解散','政局','政权更迭','总统被','军政府','coup','election','impeach','parliament dissolv','president oust','government collapse','political crisis','resign','junta','regime change'] },
  { type:'infrastructure',    kw:['港口','铁路','管道','电站','电网','大坝','基建','停电','断电','通信中断','光缆','桥梁坍塌','port','railway','pipeline','power plant','power grid','dam','infrastructure','blackout','power outage','undersea cable','bridge collapse'] },
  { type:'geopolitical_intel',kw:['地缘','军演','演习','联盟','条约','边境争端','领土争端','南海','台海','北约','部署','军事基地','geopolit','military exercise','alliance','treaty','border dispute','territorial','NATO','strait','deployment','military base','naval'] }
];
function classify(text, isChinaRel, isChinaNeg){
  var low = (text||'').toLowerCase();
  for(var i=0;i<CLASSIFY_RULES.length;i++){
    var r = CLASSIFY_RULES[i];
    for(var j=0;j<r.kw.length;j++){
      if(_kwHit(low, r.kw[j])){
        /* 涉华+安全风险类内容归"涉华安全"优先级：恐袭/军事/动荡等仍按事件本体分类，
         * 但纯舆情/打压/间谍类涉华内容在下方兜底归 security_events */
        return r.type;
      }
    }
  }
  if(isChinaNeg || (isChinaRel && hasRisk(text))) return 'security_events';
  return 'osint_intel';
}

/* ===== 预设特种兵任务（一键采集默认执行） ===== */
const PRESET_QUERIES = [
  /* —— 负面/风险类 —— */
  '中资企业 海外 遇袭',
  '华人 海外 安全事件',
  '中国公民 海外 遇害',
  '中企 海外 项目 风险',
  '涉华 制裁 最新',
  '反华 抗议 示威',
  'Chinese workers attacked overseas',
  'China sanctions latest news',
  'Chinese embassy security warning',
  /* —— 海外利益全景类（用户指示：不限于负面，涉华海外利益安全相关都要）—— */
  '中国 海外 项目 最新进展',
  '一带一路 项目 动态',
  '中企 海外 投资 并购',
  '中国 领事保护 提醒',
  '中国公民 撤侨 撤离',
  '中欧班列 供应链',
  'China overseas investment news',
  'Belt and Road project latest',
  'Chinese nationals evacuation advisory',
  /* —— 全球事件类（用户指示：不一定涉华，中资企业所在国的海外利益安全信息都要，
   *    审核环节把关；覆盖灾害/恐袭/政局/制裁/动荡/卫生/基建 12 要素）—— */
  '巴基斯坦 安全局势 最新',
  '缅甸 冲突 局势',
  '非洲 矿区 袭击',
  '中东 局势 最新',
  'terrorist attack today',
  'military coup latest',
  'major earthquake damage',
  'disease outbreak alert',
  'port strike supply chain disruption',
  'new sanctions announced'
];

/* ===== 解析器 ===== */
function parseBingNews(xml){
  return (scrapers.parseRss(xml) || []).map(function(it){
    return { title:it.title, description:it.description, link:it.link, pubDate:it.pubDate, platform:'Bing新闻' };
  });
}
function parseReddit(json){
  var d = (json && json.data && json.data.children) || [];
  return d.slice(0,20).map(function(c){
    var x = c.data || {};
    return { title:x.title||'', description:(x.selftext||'').slice(0,300), link:'https://www.reddit.com'+(x.permalink||''), pubDate:'', platform:'Reddit' };
  });
}
function parseMastodon(json){
  var s = (json && json.statuses) || [];
  return s.slice(0,15).map(function(x){
    var txt = (x.content||'').replace(/<[^>]*>/g,' ');
    return { title:txt.slice(0,120), description:txt, link:x.url||'', pubDate:x.created_at||'', platform:'Mastodon' };
  });
}

/* ===== 抓取单个目标（快速失败：Bing 12s，境外社交/媒体 6s，失败静默返回[]） ===== */
async function fetchSearch(target, q){
  var enc = encodeURIComponent(q);
  var url = target.url;
  var tmo = 6000;
  if(target.type==='bingweb'){ url += '?q='+enc+'&format=rss'; tmo = 12000; }
  else if(target.type==='reddit') url += '?q='+enc+'&sort=new&limit=25';
  else if(target.type==='mastodon') url += '?q='+enc+'&resolve=false';
  var text = await scrapers.fetchText(url, tmo);
  if(!text) return [];
  try{
    if(target.type==='reddit') return parseReddit(JSON.parse(text));
    if(target.type==='mastodon') return parseMastodon(JSON.parse(text));
    return parseBingNews(text); /* bingweb 返回 RSS */
  }catch(e){ return []; }
}
async function fetchFeed(feed){
  var text = await scrapers.fetchText(feed.url, 6000);
  if(!text) return [];
  try{
    return (scrapers.parseRss(text) || []).map(function(it){
      return { title:it.title, description:it.description, link:it.link, pubDate:it.pubDate, platform:feed.name, _mediaCountry:feed.country };
    });
  }catch(e){ return []; }
}

/* ===== 归一化 + 相关性闸门 + 涉华负面标记 ===== */
function normalizeItem(it){
  var text = (it.title||'') + ' ' + (it.description||'');
  if(!text.trim()) return null;
  /* 噪声闸门（最前置）：电竞/游戏/体育/娱乐类内容一律丢弃（除非涉华负面舆情）
   * —— 修复案例：《所有CS:GO和CS2的Major冠军及MVP》因 Counter-Strike 含 strike 子串误入 */
  if(isNoise(text) && !chinaNegative(text)) return null;
  /* 相关性双重闸门：
   *   ① Bing网页搜索结果噪音大（百科/官网/词典页），必须"涉华负面"或"硬风险词"才保留；
   *   ② 其他源：命中海外利益安全关键词 或 涉华负面 → 保留；否则丢弃（绝不污染系统） */
  var isSearch = (it.platform==='Bing新闻'||it.platform==='Bing搜索');
  if(isSearch){
    /* 垃圾页黑名单：字典/百科/官网/教程类一律丢弃 */
    if(/字典|词典|拼音|百科|翻译|releases|官网|门户|教程|学习平台|dictionary|tourism|learning|omniglot|怎么读|是什么意思|简介|公司介绍|招聘|招标公告|definition|britannica|encyclopedia|wikipedia|what is|history of|facts about/i.test(text)) return null;
    /* 搜索结果闸门（全球版，用户指示：不一定涉华——全球范围内跟中国海外利益安全
     * 相关的信息都可采集（中资企业所在国的灾害/恐袭/政局/制裁等），采集面放宽，
     * 由采集库人工审核把最后一道关）：
     *   涉华负面 / 硬风险词(全球) / 海外利益安全关键词 / 涉华+利益要素 —— 任一命中即保留 */
    if(!chinaNegative(text) && !hasRisk(text) && !scrapers.relevant(text) && !(chinaRelated(text) && interestRelated(text))) return null;
  } else {
    if(!scrapers.relevant(text) && !chinaNegative(text)) return null;
  }
  /* 中国海外利益相关性闸门：剔除纯国内事务/民生噪声，仅保留与中国海外利益安全相关情报 */
  if(!scrapers.chinaOverseasGate(text).pass) return null;
  var country = it._mediaCountry || scrapers.extractCountry(text) || '';
  var cn = chinaNegative(text);
  var cr = chinaRelated(text);
  var cat = classify(text, cr, cn);
  return {
    title: it.title || '(无标题)',
    content: it.description || it.title || '',
    country: country,
    source: it.platform || '特种兵爬虫',
    severity: cn ? '高' : '中',
    url: it.link || '',
    category: cat,
    data_type: cat,
    platform: it.platform || '',
    chinaNegative: cn,
    /* 双轨制根因修复：下游统计统一读 _chinaNegative（与 globalmedia/negtool 对齐），
     * 此处双写防止单字段统计漏 crawler 路径的负面条目 */
    _chinaNegative: cn,
    chinaRelated: cr,
    pubDate: it.pubDate || ''
  };
}

/* ==================================================================
 * 真正的开放网络检索（crawlWeb）
 *   —— 突破"注册源白名单"限制：对任意关键词，实时调用搜索引擎检索全网，
 *      解析真实结果URL，逐个抓取结果页并抽取正文，过 chinaOverseasGate 相关性闸门。
 *  SSRF 防护：仅允许公网主机；拦截私有/回环/链路本地/云元数据地址与内部域名。
 *  零模拟数据：仅返回真实抓取的页面正文；抓取失败一律跳过返回空。            ===== */
const dns = require('dns');
const dnsPromises = dns.promises;
const PRIVATE_RE = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
/* 结果页垃圾主机（百科/词典/社交视频/电商/纯搜索页）—— 开放检索不跟进，避免污染 */
const JUNK_HOST_RE = /wikipedia|wiktionary|baike|dict|dictionary|iciba|cambridge|britannica|encyclopedia|merriam|oxford|youdao|baidu\.com\/s|bing\.com\/dict|youtube|facebook|twitter\.com\/search|instagram|tiktok|\.gov\/(search|$)|amazon|tripadvisor|imdb|github\.com\/search|zhihu|douyin|weibo|reddit\.com\/r\//i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* SSRF 安全主机判定：仅放行可解析的公网主机；拦截内网/回环/元数据地址与内部域名。
 * DNS 解析不可用时（受限环境）放行进 fetch，由 fetch 自身安全失败（绝不连内网）。 */
async function isPublicHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h.endsWith('.internal') || h.endsWith('.svc') || h.endsWith('.cluster.local')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {            // 字面 IPv4
    if (PRIVATE_RE.test(h) || h.startsWith('169.254')) return false;
    return true;
  }
  try {
    const { address } = await dnsPromises.lookup(h);
    if (!address) return true;                         // 解析为空 → 放行进 fetch 验证
    if (PRIVATE_RE.test(address)) return false;
    if (address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return false;
    if (address.startsWith('::ffff:') && PRIVATE_RE.test(address.slice(7))) return false;
    return true;
  } catch (e) { return true; }                          // DNS 受限 → 放行，fetch 兜底
}
/* 开放网络抓取（带 SSRF 防护）：仅抓取公网页面，失败/内网一律返回 null */
async function fetchPublic(url, timeout) {
  timeout = timeout || 12000;
  let u; try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!(await isPublicHost(u.hostname))) return null;
  return netx.smartFetch(url, {
    timeout,
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
               'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }
  }).then(r => (r.ok ? r.text() : null)).catch(() => null);
}
function _stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
/* 从文章页抽取正文
 * 要点：先剥离脚本/导航/推荐栏，再优先按"正文容器 + <p> 段落"抽取。
 * 背景：直接回退整个 <body> 会把"相关阅读/更多新闻"栏目里其它稿件的标题一并吞入，
 *       既污染正文，又让风险评分命中不属于本文的威胁词（实测 AP 稿件出现该问题）。 */
function extractArticle(html) {
  let h = String(html || '');
  /* 1) 剥离非正文结构（含推荐位/相关阅读/广告/评论区） */
  h = h.replace(/<(script|style|noscript|svg|footer|nav|header|aside|form|figure|figcaption)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<div[^>]*(?:class|id)="[^"]*(?:related|recommend|promo|more-from|trending|newsletter|subscribe|advert|sidebar|comment|share|social|tags?|breadcrumb|most-read|popular)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, ' ');
  /* 2) 定位正文容器：语义标签 → 常见正文类名
   * 注意：正文容器内部普遍存在嵌套 <div>，用非贪婪匹配找 </div> 会在第一个子 div 处提前截断
   * （实测 AP 稿件正文因此只剩 60~100 字）。故对类名容器改为"定位起点 + 向后取窗口"。 */
  let scope = '';
  const startRe = /<div[^>]*(?:class|id)="[^"]*(?:RichTextStoryBody|article-body|articleBody|story-body|storyBody|entry-content|post-content|content__article|c-article|article__body|Page-content)[^"]*"[^>]*>/i;
  const sm = h.match(startRe);
  if (sm && sm.index >= 0) {
    scope = h.slice(sm.index, sm.index + 80000);
    /* 遇到页脚/推荐区标记即截断，避免吞入其它稿件 */
    const cut = scope.search(/<(?:footer|aside)\b|(?:class|id)="[^"]*(?:related|more-from|most-read|newsletter|recirc)[^"]*"/i);
    if (cut > 500) scope = scope.slice(0, cut);
  }
  if (!scope) {
    const box = h.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || h.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    scope = box ? box[1] : h;
  }
  /* 3) 按段落抽取：只取有实质长度的 <p>，避免吞入导航短文本与其它稿件标题 */
  const ps = scope.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const paras = [];
  for (let i = 0; i < ps.length; i++) {
    const t = _stripTags(ps[i]);
    if (t.length < 45) continue;                                   /* 过短：多为图注/按钮/栏目名 */
    if (/^(Copyright|©|All rights reserved|Sign up|Subscribe|Follow us|Read more|Advertisement)/i.test(t)) continue;
    paras.push(t);
    if (paras.join(' ').length > 1800) break;
  }
  let clean = paras.join(' ').replace(/\s+/g, ' ').trim();
  /* 4) 段落法失效（部分站点无 <p> 结构）时，才回退到容器纯文本 */
  if (clean.length < 120) {
    const fb = _stripTags(scope || (h.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, h])[1]);
    if (fb.length > clean.length) clean = fb;
  }
  return clean.length > 40 ? clean.slice(0, 1600) : '';
}
/* 解析搜索引擎结果页（Bing b_algo 块）：抽标题/URL/摘要，过滤垃圾主机与重复域名 */
function parseSerp(html, max) {
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) || [];
  const seen = {}, out = [];
  blocks.forEach(b => {
    if (out.length >= max) return;
    const hm = b.match(/<h2>[\s\S]*?<a[^>]*href=["“]([^"”]+)["“][^>]*>/i) ||
               b.match(/<a[^>]*href=["“]([^"”]+)["“][^>]*>/i);
    if (!hm) return;
    let url, host, proto, path;
    try { const u = new URL(hm[1]); url = u.href; host = u.hostname; proto = u.protocol; path = u.pathname || ''; } catch (e) { return; }
    if (proto !== 'http:' && proto !== 'https:') return;
    if (JUNK_HOST_RE.test(host)) return;
    const key = host + (path.split('/')[1] || '');
    if (seen[key]) return; seen[key] = 1;
    const tm = b.match(/<h2>[\s\S]*?<a[^>]*href=["“][^"”]+[""][^>]*>([\s\S]*?)<\/a>/i);
    const snip = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    out.push({ url, title: _stripTags(tm ? tm[1] : ''), snippet: _stripTags(snip ? snip[1] : '') });
  });
  return out;
}
function u_protocol(u) { try { return u.protocol; } catch (e) { return ''; } }

/* ==================================================================
 * 开放网络检索通道（真实通道 + 通道健康台账）
 * ------------------------------------------------------------------
 * 铁律：只使用实测可用的真实检索通道。实测不可用的通道一律如实标注
 *      为「不可用/通道预留」，绝不以任何方式伪造检索结果。
 * 实测结论（本机出网环境，2026-08-02 逐一实测）：
 *   · AP 通讯社站内全文检索  → 可用【主通道】差分实测：两组不同关键词结果零交集，
 *                              命中与关键词高度相关，确认为真实检索而非推荐位
 *   · GDELT DOC 2.0 全球检索 → 间歇可用【辅通道】：官方限速 1 次/5 秒，
 *                              本机出网常触发 429 与连接超时，已加排队/退避/缓存
 *   · Bing 网页 SERP / Bing News RSS → 不可用：强制跳转 cn.bing.com 首页
 *   · Google News RSS / DuckDuckGo / Yahoo / Mojeek / SearX → 不可用：网络层不可达
 *   · 塔斯社 / 法新社 站内检索 → 不可用：检索结果由前端 JS 渲染，HTML 中无文章链接
 *   · 尼日利亚 Premium Times / RT 站内检索 → 不可用：差分实测结果不随关键词变化（侧栏推荐位）
 *   · ReliefWeb API → 通道预留：v1 已下线，v2 需注册 appname 授权（403）
 * ================================================================== */
const WEB_CHANNELS = [
  { id: 'apnews', name: 'AP 美联社站内全文检索', scope: '全球通讯社稿库', status: 'live', note: '主通道，关键词真实检索（差分实测通过），支持翻页' },
  { id: 'gdelt', name: 'GDELT 全球新闻全文检索', scope: '全球 10 万+ 媒体 / 65 种语言', status: 'degraded', note: '辅通道，官方限速 1 次/5 秒，本机出网常 429/超时，已加排队退避与 15 分钟缓存' },
  { id: 'article', name: '检索命中页正文抓取', scope: '跟进检索命中的真实文章 URL', status: 'live', note: '带 SSRF 防护，抽取真实正文后过相关性闸门' },
  { id: 'bing_serp', name: 'Bing 网页/新闻检索', scope: '通用网页', status: 'unavailable', note: '强制跳转 cn.bing.com 首页，返回与查询无关内容，已停用以防污染系统' },
  { id: 'googlenews', name: 'Google News RSS 检索', scope: '全球新闻', status: 'unavailable', note: '网络层不可达（连接超时）' },
  { id: 'ddg', name: 'DuckDuckGo HTML', scope: '通用网页', status: 'unavailable', note: '网络层不可达（连接超时）' },
  { id: 'mojeek', name: 'Mojeek 独立索引', scope: '通用网页', status: 'unavailable', note: '网络层不可达（fetch failed）' },
  { id: 'searx', name: 'SearX 元搜索', scope: '聚合检索', status: 'unavailable', note: '网络层不可达（fetch failed）' },
  { id: 'reliefweb', name: 'ReliefWeb 人道事件检索 API', scope: '联合国人道事件库', status: 'reserved', note: 'v1 已下线、v2 需注册 appname 授权（返回 403），通道预留' }
];

/* AP 通讯社站内检索：关键词 → 真实文章 URL 列表（差分实测确认为真实检索） */
const AP_ART_RE = /href="(https:\/\/apnews\.com\/article\/[^"]+)"/g;
/* AP 请求冷却：AP 搜索对高频请求会返回 429，模块级共享冷却时间 */
let _apCooldownUntil = 0;
async function apSearch(query, opts) {
  opts = opts || {};
  if (Date.now() < _apCooldownUntil) return [];
  const want = Math.min(60, opts.maxrecords || 30);
  const maxPage = Math.min(3, Math.max(1, opts.pages || 2));
  const out = [], seen = {};
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
  };
  for (let pg = 1; pg <= maxPage && out.length < want; pg++) {
    if (Date.now() < _apCooldownUntil) break;
    const url = 'https://apnews.com/search?q=' + encodeURIComponent(String(query || '').trim()) +
                '&s=0' + (pg > 1 ? '&p=' + pg : '');
    let html = null;
    try {
      const r = await netx.smartFetch(url, { headers, timeout: 18000 });
      if (r.status === 429) { _apCooldownUntil = Date.now() + 5 * 60 * 1000; break; }
      if (!r.ok) break;
      html = await r.text();
    } catch (e) { break; }
    if (!html) break;
    let m; AP_ART_RE.lastIndex = 0; let added = 0;
    while ((m = AP_ART_RE.exec(html)) !== null) {
      const u = m[1].split('#')[0];
      if (seen[u]) continue; seen[u] = 1;
      /* 从检索结果页就近抽取真实标题：AP 结果页标题在 aria-label 或 data-gtm-region 属性中 */
      let title = '';
      const idx = html.indexOf(m[1]);
      if (idx > 0) {
        const seg = html.slice(Math.max(0, idx - 800), idx + 1200);
        const tm = seg.match(/aria-label="([^"]{16,200})"/i) ||
                   seg.match(/data-gtm-region="([^"]{16,200})"/i) ||
                   seg.match(/<span[^>]*class="[^"]*PagePromoContentIcons-text[^"]*"[^>]*>([\s\S]{5,200}?)<\/span>/i) ||
                   seg.match(/>([^<>{}]{18,180})<\/a>/);
        if (tm) title = _stripTags(tm[1]).replace(/\s+/g, ' ').trim();
      }
      /* 从结果页就近抽取发布日期（2026-08-13：AP 条目原本无日期，时效闸门无法校验 → 旧闻漏洞）
       * 2026-08-22 修正张冠李戴：旧版 ±1500 窗口从头扫，第一个命中的往往是**上一条卡片**的日期，
       * 旧文借此拿到新鲜日期混过时效闸反复入库（喀布尔中餐馆爆炸旧闻删了又来）。
       * 现优先取链接**之后**同卡片内的日期；取不到再取之前窗口里**最后一个**（离本卡片最近）日期。 */
      let apDate = '';
      if (idx > 0) {
        const D1 = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})/g;
        const D2 = /(\d{4}-\d{2}-\d{2})/g;
        const after = html.slice(idx, idx + 1200);
        let dm = after.match(D1) || after.match(D2);
        if (!dm) {
          const before = html.slice(Math.max(0, idx - 1200), idx);
          const all = before.match(D1) || before.match(D2);
          if (all && all.length) dm = [all[all.length - 1]];
        }
        if (dm) { const pd = new Date(dm[0]); if (!isNaN(pd.getTime())) apDate = pd.toISOString(); }
      }
      out.push({ url: u, title: title, domain: 'apnews.com', language: 'English', seendate: '', publishedAt: apDate, _src: 'apnews' });
      added++;
      if (out.length >= want) break;
    }
    if (!added) break;
    await _sleep(2000); // AP 分页间隔 2 秒，降低触发 429 概率
  }
  return out;
}

/* GDELT 全局限速：官方要求 ≥5 秒/次，超限返回 429 */
let _gdeltLast = 0;
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function _gdeltThrottle() {
  const gap = Date.now() - _gdeltLast;
  if (gap < 6500) await _sleep(6500 - gap); /* 2026-08-17：GDELT 对单 IP 高频有惩罚箱，5.2s 余量不足 */
  _gdeltLast = Date.now();
}
/* GDELT 结果缓存（15 分钟）：本机出网限速严重，缓存可显著提高可用率，缓存的仍是真实检索结果 */
const _gdeltCache = new Map();
const GDELT_TTL = 15 * 60 * 1000;
/* GDELT 连续失败熔断：短时间内反复 429 时暂停该通道，避免拖慢整体采集 */
let _gdeltFailStreak = 0, _gdeltCooldownUntil = 0;
/* ===== GDELT sourcecountry 国别码权威表（2026-08-29 实测排雷，根因修复）=====
 * 实测：GDELT DOC API 只认 FIPS 10-4 两字码或英文国名；
 * ISO 两字码（VN）与三字码（VNM/PAK）一律返回 "Invalid/Unsupported Country." 召回 0。
 * 平台内任何 sourcecountry 查询必须经 GD_COUNTRIES 取码，禁止再手写 ISO 码。 */
const GD_COUNTRIES = {
  '巴基斯坦': ['PK', 'Pakistan'], '阿富汗': ['AF', 'Afghanistan'], '马里': ['ML', 'Mali'],
  '尼日尔': ['NG', 'Niger'], '布基纳法索': ['UV', 'Burkina Faso'], '索马里': ['SO', 'Somalia'],
  '尼日利亚': ['NI', 'Nigeria'], '肯尼亚': ['KE', 'Kenya'], '中非': ['CT', 'Central African Republic'],
  '刚果（金）': ['CG', 'DR Congo'], '刚果(金)': ['CG', 'DR Congo'], '南非': ['SF', 'South Africa'],
  '哈萨克斯坦': ['KZ', 'Kazakhstan'], '吉尔吉斯斯坦': ['KG', 'Kyrgyzstan'], '塔吉克斯坦': ['TI', 'Tajikistan'],
  '乌兹别克斯坦': ['UZ', 'Uzbekistan'], '缅甸': ['BM', 'Myanmar'], '菲律宾': ['RP', 'Philippines'],
  '泰国': ['TH', 'Thailand'], '印度尼西亚': ['ID', 'Indonesia'], '马来西亚': ['MY', 'Malaysia'],
  '俄罗斯': ['RS', 'Russia'], '沙特阿拉伯': ['SA', 'Saudi Arabia'], '沙特': ['SA', 'Saudi Arabia'],
  '印度': ['IN', 'India'], '伊朗': ['IR', 'Iran'], '伊拉克': ['IZ', 'Iraq'], '越南': ['VM', 'Vietnam'],
  '斯里兰卡': ['CE', 'Sri Lanka'], '吉布提': ['DJ', 'Djibouti'], '埃及': ['EG', 'Egypt'],
  '埃塞俄比亚': ['ET', 'Ethiopia'], '几内亚': ['GV', 'Guinea'], '秘鲁': ['PE', 'Peru'],
  '巴西': ['BR', 'Brazil'], '阿根廷': ['AR', 'Argentina'], '老挝': ['LA', 'Laos'],
  '柬埔寨': ['CB', 'Cambodia'], '孟加拉国': ['BG', 'Bangladesh'], '阿尔及利亚': ['AG', 'Algeria'],
  '阿联酋': ['AE', 'United Arab Emirates'], '希腊': ['GR', 'Greece'], '巴拿马': ['PA', 'Panama'],
  '乌克兰': ['UP', 'Ukraine'], '叙利亚': ['SY', 'Syria'], '也门': ['YM', 'Yemen'],
  '以色列': ['IS', 'Israel'], '黎巴嫩': ['LE', 'Lebanon'], '约旦': ['JO', 'Jordan'],
  '利比亚': ['LY', 'Libya'], '苏丹': ['SU', 'Sudan'], '摩洛哥': ['MO', 'Morocco'],
  '突尼斯': ['TS', 'Tunisia'], '赞比亚': ['ZA', 'Zambia'], '津巴布韦': ['ZI', 'Zimbabwe'],
  '莫桑比克': ['MZ', 'Mozambique'], '安哥拉': ['AO', 'Angola'], '尼泊尔': ['NP', 'Nepal'],
  '喀麦隆': ['CM', 'Cameroon'], '乍得': ['CD', 'Chad']
};
/* GDELT 返回的 sourcecountry 是英文国名 → 中文（反查用） */
const GD_EN2CN = {};
Object.keys(GD_COUNTRIES).forEach(cn => { const en = GD_COUNTRIES[cn][1]; if (!GD_EN2CN[en.toLowerCase()]) GD_EN2CN[en.toLowerCase()] = cn; });
function gdCode(cn) { const e = GD_COUNTRIES[String(cn || '').trim()]; return e ? e[0] : ''; }
function gdEn(cn) { const e = GD_COUNTRIES[String(cn || '').trim()]; return e ? e[1] : ''; }
function gdCnFromEn(en) { return GD_EN2CN[String(en || '').trim().toLowerCase()] || ''; }

/* GDELT DOC 2.0：关键词 → 全球新闻文章列表（真实开放网络检索，辅通道） */
async function gdeltSearch(query, opts) {
  opts = opts || {};
  const span = opts.timespan || '3d';
  const maxrec = Math.min(250, opts.maxrecords || 60);
  let q = String(query || '').trim();
  if (!q) return [];
  if (opts.country) q += ' ' + opts.country;
  if (opts.lang === 'en') q += ' sourcelang:english';
  const ck = q + '|' + span + '|' + maxrec;
  const hit = _gdeltCache.get(ck);
  if (hit && Date.now() - hit.t < GDELT_TTL) return hit.v;
  if (Date.now() < _gdeltCooldownUntil) return [];          // 熔断期直接跳过，不伪造任何数据
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) +
              '&mode=artlist&maxrecords=' + maxrec + '&format=json&sort=datedesc&timespan=' + span;
  for (let attempt = 0; attempt < 3; attempt++) {
    await _gdeltThrottle();
    try {
      const r = await netx.smartFetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeout: 20000 });
      if (r.status === 429) { await _sleep(6000 + attempt * 4000); continue; }   // 递增退避
      if (!r.ok) continue;
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch (e) { continue; }
      const arts = (j && j.articles) || [];
      const val = arts.map(a => ({
        url: a.url,
        title: a.title || '',
        domain: a.domain || '',
        language: a.language || '',
        sourcecountry: a.sourcecountry || '',
        seendate: a.seendate || '',
        _src: 'gdelt'
      })).filter(a => a.url && !JUNK_HOST_RE.test(a.domain || a.url));
      _gdeltCache.set(ck, { t: Date.now(), v: val });
      _gdeltFailStreak = 0;
      return val;
    } catch (e) { await _sleep(1500); }
  }
  if (++_gdeltFailStreak >= 3) { _gdeltCooldownUntil = Date.now() + 10 * 60 * 1000; _gdeltFailStreak = 0; }
  return [];
}
/* GDELT 时间戳 20260802T134500Z → ISO */
function _gdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z';
}

/* 单条关键词的开放网络检索：AP站内检索 + GDELT 双通道 → 跟进真实文章页 → 抽正文 → 相关性闸门 → 12要素分类 */
async function crawlWebOne(q, opts) {
  opts = opts || {};
  const max = opts.max || 12;
  const maxPages = Math.min(max, opts.maxPages || 8);
  const chans = opts.channels || ['apnews', 'gdelt'];
  const merged = [], seenUrl = {};
  /* 主通道：AP 通讯社站内检索（稳定可用） */
  if (chans.indexOf('apnews') >= 0) {
    let apq = String(q || '');
    /* AP 站内检索不支持 GDELT 的括号 OR 语法，统一降解为关键词序列 */
    apq = apq.replace(/\bOR\b/g, ' ').replace(/[()"]/g, ' ').replace(/sourcelang:\w+/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      const ap = await apSearch(apq, { maxrecords: Math.max(20, max * 2), pages: opts.apPages || 2 });
      ap.forEach(a => { if (!seenUrl[a.url]) { seenUrl[a.url] = 1; merged.push(a); } });
    } catch (e) {}
  }
  /* 辅通道：GDELT 全球检索（间歇可用，失败不影响主通道） */
  if (chans.indexOf('gdelt') >= 0) {
    try {
      const gd = await gdeltSearch(q, {
        country: opts.country, lang: opts.lang, timespan: opts.timespan || '3d',
        maxrecords: Math.max(30, max * 3)
      });
      gd.forEach(a => { if (!seenUrl[a.url]) { seenUrl[a.url] = 1; merged.push(a); } });
    } catch (e) {}
  }
  /* 同一通稿常被数十个站点转载（GDELT 尤为明显）：按标题归一化去重，只留首见的一条 */
  const seenTitle = {}, dedup = [];
  merged.forEach(a => {
    const k = String(a.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '').slice(0, 48);
    if (k && seenTitle[k]) return;
    if (k) seenTitle[k] = 1;
    dedup.push(a);
  });
  const results = dedup;
  if (!results.length) return [];
  const pages = results.slice(0, maxPages);
  const fetched = await Promise.allSettled(pages.map(p => fetchPublic(p.url, 12000)));
  const items = [];
  fetched.forEach((fr, i) => {
    const p = pages[i];
    const html = (fr.status === 'fulfilled' && fr.value) ? fr.value : '';
    const art = html ? extractArticle(html) : '';
    /* 标题优先用检索结果页标题，缺失时从文章页 og:title / <title> 取真实标题 */
    let title = p.title || '';
    if (!title && html) {
      const om = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{5,200})["']/i) ||
                 html.match(/<title[^>]*>([\s\S]{5,200}?)<\/title>/i);
      if (om) title = _stripTags(om[1]).replace(/\s*[|\-–]\s*(AP News|Associated Press)\s*$/i, '');
    }
    p.title = title;
    /* 正文抓取失败时仅保留检索命中的真实标题，不做任何内容臆造 */
    const content = art || title || '';
    if (!content) return;
    const text = (title || '') + ' ' + content;
    /* 相关性闸门（与系统核心 gate.js / scrapers.chinaOverseasGate 同源）：
     * 仅保留涉我海外利益安全相关信息，杜绝无关外国新闻污染系统 */
    if (!scrapers.chinaOverseasGate(text).pass) return;
    const cr = chinaRelated(text), cn = chinaNegative(text);
    const cat = classify(text, cr, cn);
    const pub = _gdeltDate(p.seendate);
    const item = {
      title: p.title || '(无标题)',
      content: content,
      country: opts.country || scrapers.extractCountry(text) || '',
      source: p.domain || (() => { try { return new URL(p.url).hostname; } catch (e) { return '开放网络'; } })(),
      severity: cn ? '高' : '中',
      url: p.url,
      category: cat,
      data_type: cat,
      platform: '开放网络检索',
      chinaNegative: cn,
      _chinaNegative: cn,
      chinaRelated: cr,
      pubDate: pub,
      publishedAt: pub,
      lang: p.language || '',
      _channel: p._src || 'gdelt',
      _textFetched: !!art,
      /* 正文没抓到时 content 只是标题（概述性数据），标记待补全，
       * 由 fulltext.js 二次回源抓真实正文与结构化要素，抓不到就保持原样、绝不编造 */
      _ftPending: (!art || content.length < 400),
      _deep: true,
      _real: true
    };
    /* 统一关联：挂载中资主体 / 海外项目 / 国别 / 资产 / 风险分 / 预警等级 */
    try { ENTITY.enrich(item); } catch (e) {}
    /* 落地相关性复核（铁律：所有入库数据必须与我海外利益安全建立关联）：
     * 既未关联到中资主体/海外项目/海外资产，又非涉华负面，或仅"高风险但无关" → 判为无关外讯，不入库。
     * 与 SOCMINT 落地复核同源：必须 interestLinked，或（涉华负面 且 风险分≥40），
     * 杜绝"外国恐袭/灾害等高风险但零中国关联"讯号污染系统。 */
    /* 铁律(2026-08-18 用户)：凡采集到的数据均进预警中心，不再以 interestLinked 拦截入库 */
    /* if (!item.interestLinked && !(cn && (item.riskScore || 0) >= 40)) return; */
    items.push(item);
  });
  /* 二次去重：部分通道检索结果页无标题，标题需抓到文章页后才得到，此处再按标题归一去重一次 */
  const seen2 = {}, out = [];
  items.forEach(it => {
    const k = String(it.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '').slice(0, 48);
    if (k && seen2[k]) return;
    if (k) seen2[k] = 1;
    out.push(it);
  });
  return out;
}
/* 对外：真正开放网络检索（任意关键词 → GDELT 全球实时检索 → 真实正文 → 闸门过滤 → 实体关联） */
async function crawlWeb(q, opts) {
  if (!q || !String(q).trim()) return [];
  try { return await crawlWebOne(String(q).trim(), opts); }
  catch (e) { return []; }
}

/* ===== 对外接口 ===== */
function _collector(){
  var out = [], seen = {};
  return {
    push: function(items){
      (items||[]).forEach(function(it){
        var n = normalizeItem(it);
        if(!n) return;
        var key = (n.title||'').slice(0,60);
        if(seen[key]) return; seen[key] = 1;
        out.push(n);
      });
    },
    result: function(){ return out; }
  };
}
/* 一键采集默认执行：全部预设关键词 × (搜索引擎+社交) + 各国媒体 feed + 开放网络检索
 * 全并发（Promise.allSettled）：单目标最长 12s，全程 ≤ ~20s 返回，失败任务静默跳过 */
async function crawlAll(){
  var col = _collector();
  var engines = SEARCH_ENGINES.concat(SOCIAL_TARGETS);
  var tasks = [];
  PRESET_QUERIES.forEach(function(q){
    engines.forEach(function(eng){
      tasks.push(fetchSearch(eng, q).then(col.push).catch(function(){}));
    });
  });
  MEDIA_FEEDS.forEach(function(feed){
    tasks.push(fetchFeed(feed).then(col.push).catch(function(){}));
  });
  /* —— 真正的开放网络检索（GDELT 主通道）——
   * GDELT 官方限速 1 次/5 秒，故一键采集使用聚合式检索式，
   * 单次 maxrecords 拉满，由相关性闸门 + 实体引擎负责精筛，兼顾时效与覆盖。
   * 扩展：从 ENTITY 注册库生成企业/项目/国别靶向检索，覆盖多企业、多项目、多国家。 */
  function _buildWebSweeps() {
    var sweeps = [
      '("Chinese workers" OR "Chinese nationals" OR "Chinese engineers" OR "Chinese citizens") (attack OR killed OR kidnapped OR injured OR evacuated OR detained)',
      '("Chinese company" OR "Chinese firm" OR "Chinese-owned" OR "Chinese-run" OR "Belt and Road") (protest OR suspended OR halted OR seized OR sanction OR shut OR dispute)',
      '("Chinese embassy" OR "Chinese consulate" OR "Chinese vessel" OR "Chinese mine" OR "Chinese project") (security OR threat OR warning OR incident OR closed)',
      /* 新增：用工合规/环境/人权争议 */
      '("Chinese" OR "China") (forced labour OR slavery OR sweatshop OR wage theft OR tailings OR pollution OR land dispute)'
    ];
    /* 2) 重点中资企业靶向（英文别名召回率最高） */
    var entIds = ['BYD','Huawei','ZTE','CATL','Geely','CNPC','Sinopec','CNOOC','State Grid','CRRC','CCCC','PowerChina','COSCO','China Harbour','Xiaomi','DJI','Haier','Lenovo','Sany','Tencent','Alibaba','TPLink','CNBM','JCHX','Zoomlion','Huadian','SPIC','CHNENERGY'];
    ENTITY.ENTERPRISES.forEach(function(e) {
      if (entIds.indexOf(e.id) < 0) return;
      var en = (e.alias || []).filter(function(a) { return /^[A-Za-z]/.test(a); })[0];
      if (!en) return;
      sweeps.push('(' + en + ') (attack OR protest OR sanction OR seized OR dispute OR security OR explosion)');
    });
    /* 3) 重点海外项目靶向 */
    var projIds = ['CPEC','gwadar','hambantota','piraeus','djibouti','jakartabandung','mombasa','addisababa','laos','serbia','hungary','kampala','tanzania','ethiopia','myanmar','pakistan'];
    ENTITY.PROJECTS.forEach(function(p) {
      var idLow = (p.id || '').toLowerCase();
      var enLow = (p.en || '').toLowerCase();
      if (projIds.indexOf(idLow) < 0 && projIds.indexOf(enLow) < 0) return;
      var nm = p.en || p.name;
      sweeps.push('(' + nm + ') (security OR attack OR protest OR dispute OR halted OR risk)');
    });
    /* 4) 重点国别靶向（中资聚集/高风险） */
    var keyCountries = ['Pakistan','Myanmar','Indonesia','Serbia','Hungary','Kenya','Nigeria','Angola','Zambia','DRC','Ethiopia','Laos','Cambodia','Kazakhstan','Iran','Iraq','Saudi Arabia','UAE','Vietnam','Bangladesh','Sri Lanka','Tanzania','Egypt','Algeria','Afghanistan','Syria','Yemen','Sudan'];
    keyCountries.forEach(function(c) {
      sweeps.push('(Chinese OR China) ' + c + ' (company OR workers OR embassy OR project OR investment)');
    });
    /* 去重并截断上限（串行执行，每条约 20~40s） */
    var seen = {}, out = [];
    for (var i = 0; i < sweeps.length; i++) {
      var k = sweeps[i].toLowerCase().replace(/\s+/g, ' ').trim();
      if (!k || seen[k]) continue;
      seen[k] = 1; out.push(sweeps[i]);
    }
    return out.slice(0, 18); /* 上限 18 条，覆盖场景+企业+项目+国别 */
  }
  var WEB_SWEEPS = _buildWebSweeps();
  tasks.push((async function(){
    for (var i = 0; i < WEB_SWEEPS.length; i++) {
      try { col.push(await crawlWeb(WEB_SWEEPS[i], { max: 14, maxPages: 10, lang: 'en', timespan: '3d' })); } catch (e) {}
    }
  })());
  await Promise.allSettled(tasks);
  return col.result();
}
/* 自定义关键词深抓（特种兵精准打击）：以真正开放网络检索为主路径，社交/媒体为辅路径，合并去重 */
async function crawlQuery(q){
  if(!q) return [];
  var col = _collector();
  /* 主路径：任意关键词 → 实时全网检索（突破注册源白名单） */
  try{
    var web = await crawlWeb(q, { max: 14, maxPages: 8 });
    (web || []).forEach(function(it){ col.push([it]); });
  }catch(e){}
  /* 辅路径：既有社交/媒体检索（保留） */
  var engines = SEARCH_ENGINES.concat(SOCIAL_TARGETS);
  await Promise.allSettled(engines.map(function(eng){
    return fetchSearch(eng, q).then(col.push).catch(function(){});
  }));
  return col.result();
}

/* ============================================================
 * 标题反查原文 URL（resolveUrl）
 * 部分历史/深度检索条目入库时只留下标题、丢失了原文链接，
 * 导致无法回源抽正文，预警详情只剩一句概述。
 * 这里用真实检索通道（GDELT DOC 2.0 / AP 站内检索）按标题找回原文地址。
 * 严格要求标题高度相似才认定，找不到就返回空串，绝不猜测、绝不编造。
 * ============================================================ */
const _resolveCache = new Map();          // title → { t, url }
const RESOLVE_TTL = 6 * 60 * 60 * 1000;   // 命中结果缓存 6 小时

/* 标题分词：中英双语，英文按词、中文按 2-gram */
function _titleTokens(s) {
  const t = String(s || '').toLowerCase()
    .replace(/[""''«»„"‚'\u2013\u2014\-–—_|·•]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  const out = new Set();
  const en = t.match(/[a-z0-9]{2,}/g) || [];
  en.forEach(w => { if (!RESOLVE_STOP.has(w)) out.add(w); });
  const cn = t.replace(/[a-z0-9\s]/g, '');
  for (let i = 0; i + 1 < cn.length; i++) out.add(cn.slice(i, i + 2));
  return out;
}
const RESOLVE_STOP = new Set(['the','a','an','of','in','on','to','for','and','or','is','are','was','were','be','by','at','as','with','from','that','this','it','its','has','have','had','say','says','said','after','over','amid','new','not']);

/* Jaccard 相似度 */
function _titleSim(a, b) {
  const A = _titleTokens(a), B = _titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / Math.min(A.size, B.size);
}

/* URL slug 匹配：部分检索通道（如 AP 站内检索）结果页拿不到标题，
 * 但文章 URL 自带语义化 slug（/article/japan-china-embassy-threats-1200c79c…），
 * 用 slug 词与标题词的覆盖率判断是否为同一篇，避免"有正确结果却匹配不上"。 */
function _slugScore(url, title) {
  let slug = '';
  try {
    slug = decodeURIComponent(new URL(url).pathname);
  } catch (e) { slug = String(url || ''); }
  const parts = slug.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
  /* 去掉末尾的哈希 ID（长十六进制串）与纯数字段、过短词 */
  const toks = parts.filter(w =>
    w.length >= 3 && !/^\d+$/.test(w) && !/^[0-9a-f]{12,}$/.test(w) &&
    w !== 'article' && w !== 'news' && w !== 'story' && !RESOLVE_STOP.has(w));
  if (toks.length < 3) return 0;
  const T = _titleTokens(title);
  if (!T.size) return 0;
  let hit = 0;
  toks.forEach(w => { if (T.has(w)) hit++; });
  return hit / toks.length;
}

/* 综合打分：优先用真实标题比对，标题缺失时退回 URL slug 覆盖率 */
function _candScore(rawTitle, cand) {
  const byTitle = cand.title ? _titleSim(rawTitle, cand.title) : 0;
  if (byTitle > 0) return { score: byTitle, by: 'title' };
  const bySlug = _slugScore(cand.url, rawTitle);
  /* slug 判定更弱，做 0.9 折减，避免与真实标题命中同权 */
  return { score: bySlug * 0.9, by: 'slug' };
}

/* 从标题中提炼检索关键词（去掉中文译文段，保留信息量最大的实词） */
function _titleQuery(title) {
  let s = String(title || '').trim();
  /* 形如「中文译文 | English original」或「中文（English）」时优先取英文段 */
  const en = s.match(/[A-Za-z][A-Za-z0-9\s,.'’\-:;]{25,}/);
  if (en && en[0].trim().split(/\s+/).length >= 5) s = en[0].trim();
  s = s.replace(/[""''《》【】\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120);
}

/**
 * 按标题找回原文 URL
 * @param {string} title  条目标题（中/英）
 * @param {object} item   原始条目（可选，用于读取 source/country 辅助检索）
 * @returns {Promise<string>} 命中的原文 URL；找不到返回 ''
 */
async function resolveUrl(title, item) {
  const raw = String(title || '').trim();
  if (raw.length < 12) return '';
  const ck = raw.slice(0, 160);
  const hit = _resolveCache.get(ck);
  if (hit && Date.now() - hit.t < RESOLVE_TTL) return hit.url;

  const q = _titleQuery(raw);
  if (!q) return '';
  const isEn = (q.match(/[a-z]/gi) || []).length > q.length * 0.5;
  let best = '', bestScore = 0, bestBy = '';

  function _take(list) {
    for (const a of (list || [])) {
      if (!a || !a.url) continue;
      const r = _candScore(raw, a);
      if (r.score > bestScore) { bestScore = r.score; best = a.url; bestBy = r.by; }
    }
  }

  /* 通道一：AP 站内检索（英文标题优先走：响应 3~5 秒，命中率高且稳定） */
  if (isEn) {
    try { _take(await apSearch(q, { maxrecords: 20, pages: 1 })); } catch (e) {}
  }

  /* 通道二：GDELT 全球新闻检索（覆盖面最广，但本机常被限速，
   * 仅在 AP 未给出可信命中时才走，避免每条都空等数十秒） */
  if (bestScore < 0.72) {
    try { _take(await gdeltSearch(q, { maxrecords: 25, timespan: '14d' })); } catch (e) {}
  }

  /* 门槛：标题比对 ≥0.62；slug 比对折减后 ≥0.63（等价原始覆盖率 70%）。
   * 达不到就视为未命中，宁可没有正文，也绝不张冠李戴挂错原文。 */
  const gate = (bestBy === 'slug') ? 0.63 : 0.62;
  const url = (bestScore >= gate && best) ? best : '';
  _resolveCache.set(ck, { t: Date.now(), url: url });
  if (url && item && typeof item === 'object') {
    item._urlResolvedBy = 'title-search:' + bestBy;
    item._urlResolveScore = Math.round(bestScore * 100) / 100;
  }
  return url;
}

module.exports = { crawlAll, crawlQuery, crawlWeb, gdeltSearch, apSearch, resolveUrl, chinaNegative, chinaRelated, interestRelated, classify, isPublicHost, fetchPublic, extractArticle, WEB_CHANNELS, PRESET_QUERIES, MEDIA_FEEDS, SEARCH_ENGINES, SOCIAL_TARGETS, GD_COUNTRIES, gdCode, gdEn, gdCnFromEn };
