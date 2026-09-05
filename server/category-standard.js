/* ============================================================
 * ORPS 分类体系标准 v2.0 —— 单一事实源（任务 #627）
 * 依据：《分类体系优化方案》（2026-09-05 用户指令统一修订）
 * ------------------------------------------------------------
 * 三层结构：
 *   一级 = 风险域（5 个）：violence / governance / economy / society / nature
 *   二级 = 事件类型（18 个子类，即 intel_data.data_type 受控词表）
 *   交叉标签（4 组，与事件类型正交，不占 data_type）：
 *     ① 涉华关联  → data_json.chinaRelated（isChinaRelatedStrict 唯一判定源）
 *     ② 情报来源  → data_json._sourceType（通道溯源铁律）
 *     ③ 紧急程度  → severity（red/orange/yellow/blue 四级）
 *     ④ 影响范围  → data_json.risk_scope（project/national/regional/country）
 * ------------------------------------------------------------
 * 旧 14 类 → 新 18 类 退役迁移（存量迁移 + 触发器写时归一双保险）：
 *   security_events  → crime_events（涉华语义降为交叉标签，不再占类别）
 *   political_events → regime_change（elections 关键词拆分 → election_events）
 *   osint_intel      → geopolitical_intel（开源情报降为来源标签）
 *   economic_risk    → financial_market / business_climate（按关键词拆分）
 *   legal_compliance → sanctions_data（合规） / business_climate（诉讼罚款）
 * 消费方：server.js 分类器/预警 typeMap/异动标签/采集词表、DB 触发器、
 *         前端 /api/category/standard.js（index.html 先于 app.js 加载）。
 * 铁律：改类别只改本文件；任何消费方不得自带副本词表。
 * ============================================================ */
'use strict';

/* ===== 一级：风险域（5 个）===== */
const DOMAINS = [
  { key: 'violence',  label: '暴力与安全' },
  { key: 'governance', label: '政治与治理' },
  { key: 'economy',   label: '经济与金融' },
  { key: 'society',   label: '社会与运营' },
  { key: 'nature',    label: '自然与基础设施' }
];

/* ===== 二级：事件类型（18 子类 = data_type 受控词表）=====
 * label 用于 DB 触发器 category 字段（中文受控词）与前端展示；
 * alertType 为预警中心沿用多年的风险类型过滤值（前端过滤器兼容，不新增枚举）；
 * rules 为内容分类正则（标题优先、正文兜底，顺序即优先级）；
 * gap 为 GDELT 缺口调度定向词；gnews 为 GNews 原子查询（英文+原子词铁律）。 */
const SUBCATS = [
  /* —— 暴力与安全 —— */
  { key: 'terror_events', label: '恐怖袭击', icon: '💥', domain: 'violence', alertType: '安全风险',
    rules: /恐袭|恐怖|自杀式爆炸|汽车炸弹|武装分子伏击|绑架|劫持|人质|枪手|塔利班|基地组织|博科|青年党|terror|suicide bomb|car bomb|vbied|kidnap|hostage|gunmen|militant|ambush|isis|isil|taliban|qaeda|al-shabaab|boko haram/i,
    gap: '(attack OR bombing OR kidnapping OR militant)', gnews: ['terror attack', 'suicide bombing', 'kidnapping foreign workers', 'armed militants attack'] },
  { key: 'military_conflicts', label: '武装冲突', icon: '⚔️', domain: 'violence', alertType: '安全风险',
    rules: /战争|空袭|导弹|交火|停火|炮击|无人机袭击|军事行动|战线|叛军|反政府武装|war|airstrike|missile|ceasefire|shelling|artillery|drone strike|offensive|frontline|rebels|insurgents/i,
    gap: '(airstrike OR shelling OR clashes OR offensive)', gnews: ['airstrike', 'armed clashes', 'rebel attack', 'military offensive'] },
  { key: 'mass_violence', label: '群体性暴力', icon: '👥', domain: 'violence', alertType: '安全风险',
    rules: /骚乱|暴动|打砸|械斗|部族冲突|族群冲突|仇杀|暴徒|私刑|riot|rioting|lynch|mob (?:attack|violence)|communal (?:violence|clash)/i,
    gap: '(riot OR mob OR communal violence)', gnews: ['riot', 'communal violence', 'mob attack', 'ethnic clash'] },
  { key: 'crime_events', label: '社会治安事件', icon: '🚨', domain: 'violence', alertType: '安全风险',
    rules: /枪击|抢劫|谋杀|海盗|劫船|走私|贩毒|诈骗|盗窃|治安|被捕|越狱|shooting|robbery|murder|homicide|piracy|seajack|smuggl|traffick|fraud|heist|jailbreak/i,
    gap: '(shooting OR robbery OR murder OR piracy)', gnews: ['shooting', 'armed robbery', 'piracy attack', 'drug trafficking arrest'] },
  /* —— 政治与治理 —— */
  { key: 'regime_change', label: '政权变动', icon: '🏛️', domain: 'governance', alertType: '政治风险',
    rules: /政变|兵变|军政府|弹劾|政权更迭|戒严|军管|紧急状态|解散议会|政府垮台|coup|junta|impeach|martial law|state of emergency|dissolve parliament|government (?:collapse|overthrown)/i,
    gap: '(coup OR junta OR martial law)', gnews: ['military coup', 'state of emergency', 'government dissolved', 'political crisis'] },
  { key: 'election_events', label: '选举事件', icon: '🗳️', domain: 'governance', alertType: '政治风险',
    rules: /选举|大选|公投|投票|计票|当选|议席|\belections?\b|\bballot\b|referendum|polling station|vote count|re-election/i,
    gap: '(election OR ballot OR referendum)', gnews: ['election result', 'election protest', 'referendum', 'parliament election'] },
  { key: 'geopolitical_intel', label: '地缘外交', icon: '🌐', domain: 'governance', alertType: '地缘战略风险',
    rules: /外交|会晤|峰会|协议|争端|紧张|对峙|制裁外交|diplomat|summit|treaty|dispute|tension|standoff|foreign policy/i,
    gap: '(summit OR dispute OR tension OR diplomatic)', gnews: ['diplomatic tension', 'summit meeting', 'border dispute', 'foreign policy'] },
  { key: 'policy_shift', label: '政策法规突变', icon: '📜', domain: 'governance', alertType: '政治风险',
    rules: /政策突变|新法规|禁令|国有化|征收|外资审查|准入限制|许可证吊销|decree|nationaliz|expropriat|policy (?:shift|change|overhaul)|new (?:law|regulation)|investment screening|license revoked|ban on foreign/i,
    gap: '(decree OR nationalization OR new regulation)', gnews: ['new regulation', 'nationalization', 'investment screening', 'policy change'] },
  /* —— 经济与金融 —— */
  { key: 'sanctions_data', label: '制裁与合规', icon: '🚫', domain: 'economy', alertType: '经济风险',
    rules: /制裁|出口管制|实体清单|黑名单|反倾销|反补贴|禁运|安全审查|洗钱|反垄断|sanction|tariff|export control|entity list|blacklist|anti-dumping|countervailing|embargo|cfius|uflpa|money laundering|antitrust/i,
    gap: '(sanctions OR tariff OR embargo)', gnews: ['sanctions imposed', 'export control', 'entity list', 'new tariff'] },
  { key: 'financial_market', label: '金融市场风险', icon: '📉', domain: 'economy', alertType: '经济风险',
    rules: /债务危机|通胀|汇率|金融市场|股市|股灾|央行|利率|货币贬值|银行倒闭|挤兑|违约|debt crisis|inflation|recession|default|currency|central bank|interest rate|stock market|bank (?:run|collapse)|currency crisis/i,
    gap: '(inflation OR debt OR default OR currency)', gnews: ['inflation crisis', 'currency devaluation', 'debt default', 'central bank rate'] },
  { key: 'business_climate', label: '营商环境恶化', icon: '💼', domain: 'economy', alertType: '经济风险',
    rules: /营商环境|外资撤离|劳工成本|评级下调|税制|投资环境|经营受阻|成本飙升|business climate|rating downgrade|labor cost|operating environment|investment climate|business (?:cost|environment) (?:rise|worsen)/i,
    gap: '(expropriation OR business climate OR labor cost)', gnews: ['business climate', 'credit rating downgrade', 'labor cost rise', 'foreign investment rules'] },
  /* —— 社会与运营 —— */
  { key: 'social_unrest', label: '社会动荡', icon: '💬', domain: 'society', alertType: '社会文化风险',
    rules: /抗议|示威|罢工|停工|宵禁|protest|strike action|curfew|demonstration|sit-in/i,
    gap: '(protest OR strike OR demonstration OR curfew)', gnews: ['protest', 'general strike', 'demonstration', 'worker strike'] },
  { key: 'public_health', label: '公共卫生', icon: '🧬', domain: 'society', alertType: '安全风险',
    rules: /疫情|病毒|传染病|霍乱|埃博拉|麻疹|疟疾|食品安全|outbreak|epidemic|pandemic|virus|cholera|ebola|mpox|measles|malaria|food safety/i,
    gap: '(outbreak OR cholera OR epidemic OR famine)', gnews: ['cholera outbreak', 'dengue outbreak', 'measles outbreak', 'food safety alert'] },
  { key: 'cyber_security', label: '网络与信息安全', icon: '💻', domain: 'society', alertType: '网络安全',
    rules: /网络攻击|数据泄露|勒索软件|黑客|漏洞利用|钓鱼|间谍软件|cyberattack|cyber attack|data breach|ransomware|malware|phishing|cve-|ddos|spyware|apt\d+/i,
    gap: '(cyberattack OR ransomware OR hacking OR breach)', gnews: ['ransomware attack', 'cyberattack', 'data breach', 'hacker arrest'] },
  { key: 'industrial_accident', label: '生产安全事故', icon: '⚠️', domain: 'society', alertType: '运营风险',
    rules: /矿难|工厂火灾|爆炸事故|坍塌|气体泄漏|中毒事故|火灾事故|工亡|安全事故|mine collapse|factory fire|gas (?:leak|explosion)|industrial accident|explosion at|building collapse|scaffolding collapse|workplace death/i,
    gap: '(mine collapse OR factory fire OR gas leak)', gnews: ['factory fire', 'mine collapse', 'gas explosion', 'industrial accident'] },
  { key: 'environmental_event', label: '环境生态事件', icon: '🌿', domain: 'society', alertType: '自然环境风险',
    rules: /污染|原油泄漏|化学泄漏|有毒物质|排放超标|生态破坏|沙漠化|水危机|pollution|oil spill|chemical (?:leak|spill)|toxic|emission|environmental damage|ecological disaster|water crisis/i,
    gap: '(oil spill OR pollution OR chemical leak)', gnews: ['oil spill', 'chemical leak', 'pollution scandal', 'environmental disaster'] },
  /* —— 自然与基础设施 —— */
  { key: 'natural_disasters', label: '自然灾害', icon: '🌊', domain: 'nature', alertType: '自然环境风险',
    rules: /地震|洪水|台风|飓风|暴雨|海啸|火山|山火|旱灾|饥荒|earthquake|flood|typhoon|hurricane|tsunami|volcano|wildfire|cyclone|drought|famine|landslide/i,
    gap: '(earthquake OR flood OR typhoon OR landslide)', gnews: ['earthquake', 'flood', 'typhoon', 'wildfire'] },
  { key: 'infrastructure', label: '基础设施中断', icon: '🚧', domain: 'nature', alertType: '运营风险',
    rules: /港口|矿山|管道|铁路|大桥|电站|电网|供应链|关键矿产|稀土|停电|断电|停运|停摆|port (?:closure|shutdown)|mine|mining|pipeline|railway|bridge|power plant|supply chain|critical mineral|rare earth|lithium|cobalt|blackout|power outage/i,
    gap: '(pipeline OR railway OR port OR blackout)', gnews: ['pipeline explosion', 'railway accident', 'port shutdown', 'power outage'] }
];

/* ===== 旧 14 类 → 新 18 类 基础映射 ===== */
const LEGACY_MAP = {
  terror_events: 'terror_events', military_conflicts: 'military_conflicts',
  security_events: 'crime_events',      /* 涉华安全 → 交叉标签；治安事件本体归 crime_events */
  political_events: 'regime_change',
  osint_intel: 'geopolitical_intel',    /* 开源情报 → 来源标签；内容归地缘外交兜底 */
  economic_risk: 'financial_market',
  sanctions_data: 'sanctions_data', legal_compliance: 'sanctions_data',
  public_health: 'public_health', cyber_security: 'cyber_security',
  social_unrest: 'social_unrest', natural_disasters: 'natural_disasters',
  infrastructure: 'infrastructure', geopolitical_intel: 'geopolitical_intel'
};

/* ===== 拆分规则（存量迁移/入库兜底时按关键词再分拣，仅对 legacy 来源生效）===== */
const SPLIT_RULES = [
  { from: 'political_events', to: 'election_events', re: /选举|大选|公投|投票|计票|当选|\belections?\b|\bballot\b|referendum|polling/i },
  { from: 'economic_risk', to: 'business_climate', re: /营商环境|外资|国有化|征收|评级|劳工|税|投资审查|经营|business|expropriat|nationaliz|rating|labor|tax|investment screen/i },
  { from: 'legal_compliance', to: 'business_climate', re: /诉讼|仲裁|罚款|监管|处罚|起诉|lawsuit|litigation|arbitration|\bfine[sd]?\b|penalt|regulat|indict|sued|court/i },
  { from: 'social_unrest', to: 'mass_violence', re: /骚乱|暴动|打砸|械斗|暴徒|riot|lynch|mob attack|communal violence/i },
  { from: 'infrastructure', to: 'industrial_accident', re: /矿难|火灾|爆炸|坍塌|泄漏|工亡|安全事故|fire|explosion|collapse|leak|accident/i },
  { from: 'infrastructure', to: 'environmental_event', re: /污染|原油|化学|有毒|排放|生态|pollution|oil spill|chemical|toxic|emission|ecological/i }
];

/* ===== 交叉标签 ④ 影响范围（其余三组已有既存字段，见文件头）===== */
const SCOPE_LABELS = { project: '项目级', national: '国家级', regional: '区域级', country: '国别级' };
const _SCOPE_REGIONAL_RE = /海峡|走廊|多国|区域|红海|苏伊士|霍尔木兹|马六甲|strait|corridor|region[- ]wide|multinational|multi[- ]country/i;
function scopeOf(it) {
  const t = String((it && it.title) || '') + ' ' + String((it && it.title_zh) || '');
  if (it && Array.isArray(it.asset_tags) && it.asset_tags.length) return 'project';
  if (it && (it.chinaRelated === true || /中资|中方|中国公民|华人|华侨|Chinese (?:company|citizen|worker)/i.test(t))) return 'national';
  if (_SCOPE_REGIONAL_RE.test(t)) return 'regional';
  return 'country';
}

/* ===== 分类引擎（server.js _classifyIntelType 与前端共用语义）===== */
const GENRE_RE = /综述|社评|专栏|观察家|深度分析|盘点|回顾|展望|解读|民调|民意调查|支持率|批准率|opinion|editorial|analysis|review of|commentary|explained|opinion poll|approval rating|survey/i;
const GENRE_EVENT_RE = /爆炸|袭击|枪击|绑架|劫持|恐袭|地震|洪水|政变|空袭|blast|attack|shooting|kidnap|hostage|killed|earthquake|coup|airstrike/i;

function classify(it) {
  const title = (String((it && it.title) || '') + ' ' + String((it && it.title_zh) || '')).toLowerCase();
  const all = title + ' ' + String((it && (it.content || it.desc || it.description)) || '').toLowerCase();
  /* 综述/评论/分析体裁前置：非事件类内容归地缘外交，不占事件类席位（分类器 v2 铁律） */
  if (GENRE_RE.test(title) && !GENRE_EVENT_RE.test(title)) return 'geopolitical_intel';
  for (const s of SUBCATS) { if (s.rules.test(title)) return s.key; }
  for (const s of SUBCATS) { if (s.rules.test(all)) return s.key; }
  return 'geopolitical_intel';
}

/* 多标签命中（恐袭 vs 武装冲突边界兜底：主类按优先级，全部命中记 category_tags） */
function tagsOf(it) {
  const title = (String((it && it.title) || '') + ' ' + String((it && it.title_zh) || '')).toLowerCase();
  const all = title + ' ' + String((it && (it.content || it.desc || it.description)) || '').toLowerCase();
  const hits = [];
  for (const s of SUBCATS) { if (s.rules.test(title) || s.rules.test(all)) { hits.push(s.key); if (hits.length >= 3) break; } }
  return hits;
}

/* 旧 key 归一（含关键词拆分；未知 key 返回 null 由调用方走 classify） */
function mapType(oldType, text) {
  if (!oldType) return null;
  if (SUBCATS.some(s => s.key === oldType)) return oldType;
  const base = LEGACY_MAP[oldType];
  if (!base) return null;
  const t = String(text || '');
  for (const r of SPLIT_RULES) { if (r.from === oldType && t && r.re.test(t)) return r.to; }
  return base;
}

/* ===== 派生消费表 ===== */
const KEYS = SUBCATS.map(s => s.key);
const LABELS = {};          /* key → 中文类别（DB 触发器 category 受控词） */
const ALERT_TYPES = {};     /* key → 预警中心风险类型（前端过滤器兼容枚举） */
const ICONS = {};           /* key → 图标 */
SUBCATS.forEach(s => { LABELS[s.key] = s.label; ALERT_TYPES[s.key] = s.alertType; ICONS[s.key] = s.icon; });

/* GDELT 类别均衡定向查询包（完整查询，锚定利益关联国） */
const GDELT_PACKS = {
  financial_market: [
    '(Pakistan OR Sri Lanka OR Egypt OR Nigeria OR Argentina OR Turkey) (debt crisis OR default OR inflation OR currency collapse OR recession)',
    '(Kazakhstan OR Uzbekistan OR Kenya OR Ethiopia OR Bangladesh) (economic crisis OR IMF OR inflation OR currency)',
    '(China OR Chinese) overseas (investment OR loan OR debt OR economy) (risk OR crisis OR default OR loss)'
  ],
  cyber_security: [
    '(Pakistan OR India OR Vietnam OR Philippines OR Nigeria OR Kenya) (cyberattack OR ransomware OR data breach OR hacking)',
    '(Kazakhstan OR Uzbekistan OR Indonesia OR Malaysia OR Egypt) (cyber attack OR ransomware OR hacker OR data leak)',
    'Chinese (company OR embassy OR bank) (cyberattack OR hack OR data breach OR ransomware)'
  ],
  regime_change: [
    '(Pakistan OR Bangladesh OR Myanmar OR Thailand OR Tunisia) (coup OR political crisis OR resignation OR military takeover)',
    '(Niger OR Mali OR Burkina Faso OR Sudan OR Chad) (junta OR coup OR political transition)',
    '(Sri Lanka OR Nepal OR Kyrgyzstan OR Moldova OR Georgia) (political crisis OR parliament OR government collapse)'
  ],
  election_events: [
    '(election OR ballot OR referendum) (dispute OR violence OR delay OR boycott) (Pakistan OR Bangladesh OR Indonesia OR Nigeria OR Kenya)',
    '(parliament OR presidential) election (crisis OR clash OR protest) (Asia OR Africa)'
  ],
  policy_shift: [
    '(nationalization OR expropriation OR investment screening) (mining OR port OR railway OR oil) (Africa OR Asia OR Latin America)',
    'foreign (investment OR mining) (license revoked OR permit suspended OR new regulation) (China OR Chinese)'
  ],
  public_health: [
    '(cholera OR dengue OR mpox OR measles) outbreak (Sudan OR Nigeria OR Congo OR Ethiopia OR Kenya OR Afghanistan)',
    '(Pakistan OR Afghanistan OR Yemen OR Syria) (polio OR cholera OR epidemic OR health crisis OR hospital attack)'
  ],
  sanctions_data: [
    'sanctions OR tariff OR "export control" (China OR Chinese) (impose OR new OR expand OR entity list)',
    '(Iran OR Russia OR Myanmar OR Venezuela OR Sudan) sanctions (China OR Chinese OR oil OR shipping)'
  ],
  business_climate: [
    '(Chinese OR China) (company OR project OR investment) (lawsuit OR fine OR license OR expropriation OR nationalization)',
    '(Pakistan OR Indonesia OR Kazakhstan OR Nigeria OR Vietnam) (court OR arbitration OR fine) (China OR Chinese OR mining OR investment)'
  ],
  infrastructure: [
    '(Kazakhstan OR Uzbekistan OR Pakistan OR Laos OR Ethiopia OR Kenya) (railway OR pipeline OR port OR power plant OR dam) (attack OR damage OR halt OR protest OR China)',
    '(CPEC OR "Belt and Road" OR Chinese-built) (port OR railway OR highway OR pipeline OR power) (attack OR disruption OR damage OR delay)'
  ],
  social_unrest: [
    '(strike OR demonstration OR curfew) (Bangladesh OR Kenya OR Nigeria OR Haiti OR Ecuador OR Bolivia OR Kazakhstan)',
    '(factory OR mine OR construction) (China OR Chinese) (strike OR protest OR labor dispute)'
  ],
  military_conflicts: [
    '(shelling OR airstrike OR ceasefire OR offensive OR clash) (Sudan OR Myanmar OR Ukraine OR Yemen OR Syria OR Congo)',
    '(border OR frontier) (clash OR shelling OR firing OR tension) (India OR Pakistan OR Afghanistan OR Tajikistan OR Kyrgyzstan)'
  ],
  crime_events: [
    '(shooting OR robbery OR murder OR piracy) (Pakistan OR Nigeria OR Kenya OR South Africa OR Mexico)',
    'Chinese (citizen OR worker OR businessman) (robbed OR shot OR killed OR kidnapped) OR Chinese-owned (shop OR factory) attacked'
  ],
  mass_violence: [
    '(riot OR communal violence OR mob attack) (India OR Nigeria OR Kenya OR Bangladesh OR Indonesia)',
    '(ethnic OR tribal) (clash OR violence) (Africa OR Asia)'
  ],
  industrial_accident: [
    '(mine collapse OR factory fire OR gas explosion OR industrial accident) (China OR Chinese OR Africa OR Asia)',
    '(construction OR factory OR mine) accident (killed OR trapped OR injured) (overseas OR foreign)'
  ],
  environmental_event: [
    '(oil spill OR chemical leak OR pollution) (river OR coast OR city) (Africa OR Asia OR Latin America)',
    '(toxic OR contamination) (water OR air OR soil) (village OR residents OR evacuat)'
  ],
  natural_disasters: [
    '(earthquake OR flood OR typhoon OR landslide OR volcano OR cyclone) (China OR Chinese) (citizen OR rescue OR evacuation OR aid)',
    '(earthquake OR flood OR typhoon OR drought OR famine) (Afghanistan OR Pakistan OR Nepal OR Bangladesh OR Philippines OR Indonesia OR Horn of Africa)'
  ]
};

/* GNews 原子查询包（第一通道；英文+原子词铁律） */
const GNEWS_PACKS = {};
SUBCATS.forEach(s => { if (s.gnews && s.gnews.length) GNEWS_PACKS[s.key] = s.gnews; });

/* GDELT 缺口调度定向词（每类一个括号短语，与国家码拼接） */
const GAP_KEYWORDS = {};
SUBCATS.forEach(s => { if (s.gap) GAP_KEYWORDS[s.key] = s.gap; });

/* 安全类结构帽口径（缺口调度器 _SEC_STRUCT_TYPES）：暴力与安全域 4 类 */
const SEC_STRUCT_TYPES = ['terror_events', 'military_conflicts', 'mass_violence', 'crime_events', 'geopolitical_intel', 'social_unrest'];

/* 前端序列化（/api/category/standard.js 消费；index.html 先于 app.js 加载） */
function frontPayload() {
  return {
    v: 2,
    domains: DOMAINS,
    subcats: SUBCATS.map(s => ({ key: s.key, label: s.label, icon: s.icon, domain: s.domain, alertType: s.alertType })),
    keys: KEYS,
    legacyMap: LEGACY_MAP,
    splitRules: SPLIT_RULES.map(r => ({ from: r.from, to: r.to, re: r.re.source, flags: (r.re.flags || '').replace('g', '') })),
    scopeLabels: SCOPE_LABELS
  };
}

module.exports = {
  DOMAINS, SUBCATS, KEYS, LABELS, ALERT_TYPES, ICONS,
  LEGACY_MAP, SPLIT_RULES, SCOPE_LABELS,
  classify, mapType, tagsOf, scopeOf, frontPayload,
  GDELT_PACKS, GNEWS_PACKS, GAP_KEYWORDS, SEC_STRUCT_TYPES
};
