/**
 * server/globalmedia.js — 全球多国媒体真实情报引擎（金矿层）
 *
 * 设计要点（铁律一：零模拟）：
 *  1. 主引擎 = GDELT DOC 2.0（crawler.gdeltSearch），按 sourcecountry 批量拉取
 *     全球 30+ 国家、每国数十家地方媒体（含俾路支邮报 The Balochistan Post 级别）
 *     的真实新闻报道。GDELT 已内置 5.2s 节流 + 缓存 + 熔断，绝不伪造。
 *  2. 补充 = 一批"实测可达"的直连 RSS（探测脚本验证 200 且有 item），覆盖
 *     巴基斯坦/阿富汗/尼日利亚/印度/缅甸/菲律宾/巴西/利比亚/巴尔干/波兰等。
 *  3. 相关性闸门：只保留命中「海外利益安全范畴 A-G 维度」或涉华/风险事件的真实条目，
 *     丢弃娱乐体育电竞等噪音。
 *  4. 维度评分：按命中维度（A 中方关联 95 / B BRI 85 / C 海上通道 75 / D 能源矿产 70 /
 *     E 资产密集国 55 / F 战略外溢 65 / G 全球航运 50）给每条数据打 dimScores/maxScore。
 *
 * 暴露：scrapeGlobalMedia(opts) / scrapeCountry(iso,opts) / GLOBAL_COUNTRIES /
 *       scoreDimensions(text,countryDims) / gateRelevant(text)
 */
'use strict';
const crawler = require('./crawler');
const netx = require('./netx');
const mediaFeeds = require('./media_feeds');
const scrapers = require('./scrapers');

/* ===== 全球 30+ 国家清单（ISO2 = GDELT sourcecountry 代码；dims = 该国典型海外利益维度）=====
 * 维度：A=中方直接关联 B=BRI重大项目/走廊 C=海上战略通道 D=能源/关键矿产供应链
 *       E=中方资产密集国+安全事件 F=战略外溢地点 G=全球航运/贸易通道
 * prio：1=重点(用户点名/中资密集) 2=高危 3=常规 */
const GLOBAL_COUNTRIES = [
  { iso:'PAK', cn:'巴基斯坦', dims:['A','E','F','B'], prio:1 },
  { iso:'AFG', cn:'阿富汗',   dims:['A','E','F'],      prio:1 },
  { iso:'NGA', cn:'尼日利亚', dims:['A','E'],          prio:1 },
  { iso:'MMR', cn:'缅甸',     dims:['A','E','F','B'],  prio:1 },
  { iso:'UKR', cn:'乌克兰',   dims:['F'],              prio:1 },
  { iso:'IND', cn:'印度',     dims:['A','E'],          prio:2 },
  { iso:'BGD', cn:'孟加拉国', dims:['E','B'],          prio:2 },
  { iso:'LKA', cn:'斯里兰卡', dims:['E','B'],          prio:2 },
  { iso:'NPL', cn:'尼泊尔',   dims:['E'],              prio:3 },
  { iso:'IRN', cn:'伊朗',     dims:['C','D','F'],      prio:2 },
  { iso:'IRQ', cn:'伊拉克',   dims:['D','E'],          prio:2 },
  { iso:'SYR', cn:'叙利亚',   dims:['F'],              prio:2 },
  { iso:'YEM', cn:'也门',     dims:['F','C'],          prio:2 },
  { iso:'SAU', cn:'沙特',     dims:['D','C'],          prio:2 },
  { iso:'ARE', cn:'阿联酋',   dims:['C','D'],          prio:2 },
  { iso:'ISR', cn:'以色列',   dims:['F'],              prio:3 },
  { iso:'LBN', cn:'黎巴嫩',   dims:['F'],              prio:3 },
  { iso:'JOR', cn:'约旦',     dims:['F'],              prio:3 },
  { iso:'EGY', cn:'埃及',     dims:['C','G'],          prio:2 },
  { iso:'LBY', cn:'利比亚',   dims:['C','D'],          prio:2 },
  { iso:'SDN', cn:'苏丹',     dims:['C','D'],          prio:2 },
  { iso:'DZA', cn:'阿尔及利亚', dims:['D'],            prio:3 },
  { iso:'MAR', cn:'摩洛哥',   dims:['C'],              prio:3 },
  { iso:'TUN', cn:'突尼斯',   dims:['C'],              prio:3 },
  { iso:'ETH', cn:'埃塞俄比亚', dims:['E'],            prio:2 },
  { iso:'KEN', cn:'肯尼亚',   dims:['E'],              prio:2 },
  { iso:'ZAF', cn:'南非',     dims:['D','E'],          prio:2 },
  { iso:'COD', cn:'刚果(金)', dims:['D','E'],          prio:2 },
  { iso:'ZMB', cn:'赞比亚',   dims:['D'],              prio:3 },
  { iso:'ZWE', cn:'津巴布韦', dims:['D','E'],          prio:3 },
  { iso:'MOZ', cn:'莫桑比克', dims:['E'],              prio:3 },
  { iso:'AGO', cn:'安哥拉',   dims:['D'],              prio:3 },
  { iso:'NER', cn:'尼日尔',   dims:['D','F'],          prio:3 },
  { iso:'MLI', cn:'马里',     dims:['F'],              prio:3 },
  { iso:'MEX', cn:'墨西哥',   dims:['E'],              prio:2 },
  { iso:'BRA', cn:'巴西',     dims:['D','E'],          prio:2 },
  { iso:'COL', cn:'哥伦比亚', dims:['E'],              prio:2 },
  { iso:'PER', cn:'秘鲁',     dims:['D','E'],          prio:2 },
  { iso:'ARG', cn:'阿根廷',   dims:['D','E'],          prio:3 },
  { iso:'VEN', cn:'委内瑞拉', dims:['D'],              prio:3 },
  { iso:'CHL', cn:'智利',     dims:['D'],              prio:3 },
  { iso:'IDN', cn:'印度尼西亚', dims:['E','B'],        prio:2 },
  { iso:'MYS', cn:'马来西亚', dims:['E','B'],          prio:2 },
  { iso:'VNM', cn:'越南',     dims:['E','B'],          prio:2 },
  { iso:'PHL', cn:'菲律宾',   dims:['E','B'],          prio:2 },
  { iso:'THA', cn:'泰国',     dims:['E','B'],          prio:2 },
  { iso:'KHM', cn:'柬埔寨',   dims:['E','B'],          prio:3 },
  { iso:'KAZ', cn:'哈萨克斯坦', dims:['D','B'],        prio:2 },
  { iso:'KGZ', cn:'吉尔吉斯斯坦', dims:['B'],          prio:3 },
  { iso:'UZB', cn:'乌兹别克斯坦', dims:['B'],          prio:3 },
  { iso:'TUR', cn:'土耳其',   dims:['C','F'],          prio:2 },
  { iso:'GRC', cn:'希腊',     dims:['G'],              prio:3 },
  { iso:'POL', cn:'波兰',     dims:['G'],              prio:3 },
  { iso:'SRB', cn:'塞尔维亚', dims:['F'],              prio:3 },
  { iso:'RUS', cn:'俄罗斯',   dims:['C','D','F'],      prio:2 },
  { iso:'AUS', cn:'澳大利亚', dims:['G','F'],          prio:3 },
  { iso:'ECU', cn:'厄瓜多尔', dims:['D','E'],          prio:3 },
  { iso:'HUN', cn:'匈牙利',   dims:['G','F'],          prio:3 },
  { iso:'CZE', cn:'捷克',     dims:['G','F'],          prio:3 }
];

/* ===== 海外利益安全维度分值表（基于总体国家安全观与官方定义）=====
 * 参考：《总体国家安全观学习纲要》《国家安全法》第三十三条、人民网理论频道
 * 海外利益安全主要包括：海外能源资源安全、海上战略通道、海外公民/法人安全、
 * 海外重大项目与投资安全、一带一路安全保障、国际反恐、全球公共卫生等。
 * 分值设计原则：直接关联 > 间接关联；资产/人员 > 通道 > 外溢风险 > 全球公共风险。
 * 阈值 60：仅当总关联分 ≥60 时视为与我海外利益安全相关，避免泛泛外国新闻入流。 */
const DIM_SCORE = { A:95, B:90, C:85, D:80, E:75, F:70, G:65, H:60, I:55 };
const DIM_LABEL = {
  A:'涉华/中资/公民直接关联', B:'一带一路重大项目/走廊', C:'海外能源资源安全',
  D:'海上战略通道安全', E:'海外公民/侨民/机构安全', F:'中资资产密集国+安全事件',
  G:'地区冲突/恐怖/制裁战略外溢', H:'国际贸易通道与供应链', I:'全球公共卫生与重大灾害'
};

/* ===== 维度关键词（命中即认定该维度相关）===== */
const DIM_KW = {
  A: ['中国','中资','华人','华侨','中方','使馆','中企','华裔','China','Chinese','Beijing','overseas Chinese','Chinese company','Chinese national','Chinese workers'],
  B: ['中巴经济走廊','中老铁路','雅万高铁','中欧班列','蒙内铁路','亚吉铁路','坦赞铁路','瓜达尔','皎漂','汉班托塔','比雷埃夫斯','钱凯','科伦坡港口城','中白工业园','中俄东线','亚马尔','北极LNG','Belt and Road','BRI','economic corridor','China-Pakistan','Jakarta-Bandung','China-Laos Railway'],
  C: ['石油','天然气','锂','钴','铜','稀土','矿产','能源','油气','煤炭','铁矿石','粮食','大豆','玉米','关键矿产','oil','gas','lithium','cobalt','copper','rare earth','energy','mining','iron ore','grain','wheat','soybean'],
  D: ['霍尔木兹','马六甲','苏伊士','红海','曼德','巴拿马','北极航道','台湾海峡','南海','巴士海峡','龙目海峡','望加锡','巽他','朝鲜海峡','直布罗陀','英吉利','多佛','保克','莫桑比克','Hormuz','Malacca','Suez','Red Sea','Panama Canal','Taiwan Strait','South China Sea'],
  E: ['中国公民','中方人员','华人','华侨','侨胞','台商','中国留学生','中国劳工','外派','援外','驻外','海外华人','Chinese tourist','Chinese student','Chinese labour','diaspora'],
  F: ['巴基斯坦','Pakistan','阿富汗','Afghan','缅甸','Myanmar','尼日利亚','Nigeria','伊拉克','Iraq','叙利亚','Syria','也门','Yemen','利比亚','Libya','苏丹','Sudan','南苏丹','South Sudan','索马里','Somalia','刚果','Congo','马里','Mali','尼日尔','Niger','乍得','Chad','乌克兰','Ukraine','伊朗','Iran','沙特','Saudi','阿联酋','UAE','土耳其','Turkey','埃及','Egypt','埃塞俄比亚','Ethiopia','肯尼亚','Kenya','坦桑尼亚','Tanzania','赞比亚','Zambia','安哥拉','Angola','加纳','Ghana','几内亚','Guinea','津巴布韦','Zimbabwe','南非','South Africa','俄罗斯','Russia','哈萨克斯坦','Kazakhstan','老挝','Laos','柬埔寨','Cambodia','越南','Vietnam','泰国','Thailand','马来西亚','Malaysia','印尼','Indonesia','菲律宾','Philippines','孟加拉','Bangladesh','斯里兰卡','Sri Lanka','巴西','Brazil','阿根廷','Argentina','智利','Chile','秘鲁','Peru','墨西哥','Mexico','委内瑞拉','Venezuela','厄瓜多尔','Ecuador','澳大利亚','Australia'],
  G: ['恐袭','恐怖主义','袭击','绑架','爆炸','冲突','战争','政变','骚乱','抗议','示威','罢工','制裁','封锁','禁运','海盗','劫持','叛乱','武装','极端组织','ISIS','塔利班','博科圣地','索马里青年党','terror','attack','kidnap','blast','conflict','war','coup','riot','protest','sanction','blockade','piracy','hijack','insurgency','militant','extremist'],
  H: ['港口','机场','铁路','运河','航运','贸易','供应链','中欧班列','货运','集装箱','航线','海运','logistics','supply chain','trade route','shipping','container','port','railway','canal'],
  I: ['疫情','传染病','瘟疫','大流行','地震','海啸','台风','洪水','飓风','火山','泥石流','干旱','饥荒','pandemic','epidemic','earthquake','tsunami','typhoon','flood','hurricane','volcano']
};

/* 核心高风险国家：与中国海外利益高度绑定且安全形势严峻 */
const CORE_RISK_COUNTRIES = ['巴基斯坦','阿富汗','缅甸','伊拉克','叙利亚','也门','利比亚','苏丹','南苏丹','索马里','刚果(金)','刚果（金）','马里','尼日尔','乍得','乌克兰'];
/* 关键利益国家：一带一路沿线、能源资源进口/投资密集国 */
const KEY_INTEREST_COUNTRIES = ['伊朗','沙特','阿联酋','土耳其','埃及','埃塞俄比亚','肯尼亚','坦桑尼亚','赞比亚','安哥拉','加纳','几内亚','津巴布韦','南非','俄罗斯','白俄罗斯','塞尔维亚','匈牙利','波兰','哈萨克斯坦','乌兹别克斯坦','吉尔吉斯斯坦','塔吉克斯坦','土库曼斯坦','蒙古','老挝','柬埔寨','越南','泰国','马来西亚','印度尼西亚','印尼','菲律宾','孟加拉国','孟加拉','斯里兰卡','尼泊尔','巴西','阿根廷','智利','秘鲁','墨西哥','委内瑞拉','厄瓜多尔','澳大利亚','新西兰'];

/* ===== 涉华专项/负面专项专用宽松闸门（在守住噪声/国内事件底线的前提下，
 * 解决通用 chinaOverseasGate 过度收紧导致新华社/中国日报等正常涉华外交/经贸/
 * BRI/国际安全新闻被批量拦截的问题）。 ===== */
function _reEscape(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const _CHINA_RELATED_RE = /中国|Chinese|China|Beijing|Shanghai|中资|中企|中方|华人|华侨|华裔|一带一路|Hong Kong|Taiwan|Macau|\bRMB\b|\bYuan\b|\bBRI\b|\bBelt and Road\b|Xi Jinping|对华|涉华/i;
/* 境外/国际要素：已登记国家名/ISO + 区域 + 外交/经济/安全/风险标记 */
const _FOREIGN_INTL_KW = [
  '国际','世界','全球','海外','境外','国外','外国','外交','外事','出访','访问','峰会','会晤','会谈','合作','援助','援建','投资','贸易','进出口','关税','协定','协议','备忘录','制裁','冲突','战争','政变','骚乱','抗议','示威','罢工','紧张','局势','安全','风险','威胁','警告','批评','指责','谴责','抵制','反华','排华','间谍','渗透','监听','袭击','爆炸','绑架','劫持','伤亡','遇害','遇难','事故','灾难','疫情','地震','洪水','台风','飓风','撤离','撤侨',
  'international','world','global','overseas','abroad','foreign','diplomat','diplomatic','summit','visit','cooperation','aid','investment','trade','tariff','agreement','sanction','conflict','war','coup','riot','protest','demonstration','strike','tension','security','risk','threat','warn','critic','condemn','accuse','blame','boycott','anti-china','anti-chinese','spy','espionage','surveillance','attack','kidnap','blast','explosion','explosive','casualty','casualties','killed','dead','injured','wounded','hostage','accident','disaster','pandemic','epidemic','earthquake','flood','typhoon','hurricane','evacuation','evacuate'
];
const _FOREIGN_OR_INTL_RE = new RegExp(
  GLOBAL_COUNTRIES.map(c => _reEscape(c.cn)).concat(
    GLOBAL_COUNTRIES.map(c => _reEscape(c.iso))
  ).concat(_FOREIGN_INTL_KW).join('|'),
  'i'
);
/* 强海外利益直接信号（负面通道兜底） */
const _STRONG_OVERSEAS_INTEREST_RE = /中资|中企|华人|华侨|侨胞|中方员工|中方人员|中国公民|使馆|领事馆|领事|撤侨|一带一路|海外项目|境外投资|外派|援外|中资营地|Chinese company|Chinese embassy|Chinese consulate|Belt and Road|overseas Chinese|Chinese workers|Chinese nationals|Chinese employees/i;

/* 涉华专项放行信号：必须是明确的海外利益/外交/经济/安全/BRI/关键国信号，
 * 不能仅靠“国际”“世界”“合作”等宽泛词。外国国名本身即视为境外要素。 */
const _CHINA_FOCUS_PASS_RE = /\b(海外|境外|国外|外交|外事|使馆|领事馆|领事|撤侨|援外|外派|中资|中企|中方人员|中国公民|中国留学生|中国劳工|一带一路|BRI|Belt and Road|中巴经济走廊|中老铁路|雅万高铁|中欧班列|蒙内铁路|亚吉铁路|坦赞铁路|瓜达尔|皎漂|汉班托塔|比雷埃夫斯|钱凯|科伦坡港口城|中白工业园|中俄东线|北极LNG|制裁|关税|贸易战|出口管制|贸易壁垒|技术封锁|反倾销|反补贴|经济胁迫|脱钩|遏制|围堵|冲突|战争|政变|恐袭|袭击|绑架|爆炸|骚乱|抗议|示威|罢工|紧张|安全|风险|威胁|间谍|渗透|监听|网络攻击|黑客|军事|军舰|战机|导弹|无人机|南海|台湾海峡|霍尔木兹|马六甲|苏伊士|红海|关键矿产|稀土|锂|钴|铜|石油|天然气|能源安全|供应链)\b|\b(overseas|abroad|diplomat|embassy|consulate|consular|evacuation|Belt and Road|BRI|CPEC|sanction|tariff|trade war|export control|tech blockade|anti-dumping|countervailing|coercion|decouple|containment|conflict|war|coup|terror|attack|kidnap|blast|riot|protest|strike|tension|security|risk|threat|spy|espionage|surveillance|cyberattack|hack|military|warship|warplane|missile|drone|South China Sea|Taiwan Strait|Hormuz|Malacca|Suez|Red Sea|rare earth|lithium|cobalt|copper|oil|gas|energy security|supply chain)\b/i;

function _chinaFocusGate(text, gate){
  if(!text) return false;
  // 通用闸门已经拦截的硬噪声/纯国内事件/纯文化商业垃圾，专项通道同样拦截
  if(gate && gate.reason && /topic-noise|domestic-junk|culture-business-junk|domestic-edu-tech-noise|china-domestic-incident|domestic-irrelevant/.test(gate.reason)) return false;
  if(!_CHINA_RELATED_RE.test(text)) return false;
  // scrapeChinaFocus 已通过 _CHINA_FOCUS_NOISE_RE 拦截社会文化娱乐噪声；
  // 这里需要明确的海外利益/外交/经济/安全/BRI/关键国信号，避免“国际/合作/世界”等宽泛词放行弱相关新闻
  if (_STRONG_OVERSEAS_INTEREST_RE.test(text)) return true;
  if (_CHINA_FOCUS_PASS_RE.test(text)) return true;
  // 命中外国国名（不含中国/港台）也放行：如 China-U.S., China-Brazil, African developers 等
  const hasForeignCountry = new RegExp(
    GLOBAL_COUNTRIES.filter(c => !/^(中国|中国香港|中国台湾|中国澳门|China|Chinese|Hong Kong|Taiwan|Macau)$/i.test(c.cn))
      .map(c => _reEscape(c.cn)).join('|'),
    'i'
  ).test(String(text || ''));
  return hasForeignCountry;
}
/* 关键利益国：能源/矿产/战略通道/一带一路重点国；负面信号命中这些国家时风险外溢明显 */
const _KEY_INTEREST_COUNTRY_RE = /\b(Iran|Pakistan|Afghanistan|Myanmar|Iraq|Syria|Yemen|Libya|Sudan|South Sudan|Somalia|Congo|DRC|Mali|Niger|Chad|Ukraine|Saudi Arabia|UAE|Turkey|Egypt|Ethiopia|Kenya|Tanzania|Zambia|Angola|Ghana|Guinea|Zimbabwe|South Africa|Russia|Belarus|Serbia|Hungary|Poland|Kazakhstan|Uzbekistan|Kyrgyzstan|Tajikistan|Turkmenistan|Mongolia|Laos|Cambodia|Vietnam|Thailand|Malaysia|Indonesia|Philippines|Bangladesh|Sri Lanka|Nepal|Brazil|Argentina|Chile|Peru|Mexico|Venezuela|Ecuador|Australia)\b|\b(伊朗|巴基斯坦|阿富汗|缅甸|伊拉克|叙利亚|也门|利比亚|苏丹|南苏丹|索马里|刚果|马里|尼日尔|乍得|乌克兰|沙特|阿联酋|土耳其|埃及|埃塞俄比亚|肯尼亚|坦桑尼亚|赞比亚|安哥拉|加纳|几内亚|津巴布韦|南非|俄罗斯|白俄罗斯|塞尔维亚|匈牙利|波兰|哈萨克斯坦|乌兹别克斯坦|吉尔吉斯斯坦|塔吉克斯坦|土库曼斯坦|蒙古|老挝|柬埔寨|越南|泰国|马来西亚|印度尼西亚|菲律宾|孟加拉国|斯里兰卡|尼泊尔|巴西|阿根廷|智利|秘鲁|墨西哥|委内瑞拉|厄瓜多尔|澳大利亚)\b/i;
/* 强负面/安全外溢信号 */
const _STRATEGIC_NEGATIVE_RE = /\b(sanction|ban|restriction|export control|embargo|tariff|trade war|boycott|blacklist|dual-use|forced labor|human rights abuses|genocide|espionage|spy|cyberattack|hack|theft of intellectual property|IP theft|technology theft|military aid|arms sales|missile|drone|warship|warplane|conflict zone|war zone|combat|airstrike|bombing|shelling|blockade|closure|strait|chokepoint|supply chain disruption|critical mineral|rare earth|lithium|cobalt|copper|oil|gas|energy security|nuclear)\b|\b(制裁|禁运|出口管制|限制|禁令|关税|贸易战|抵制|封锁|断供|扣押|冻结资产|间谍|网络攻击|黑客|知识产权盗窃|军售|武器|导弹|无人机|军舰|战机|冲突|空袭|轰炸|封锁|海峡|咽喉要道|供应链中断|关键矿产|稀土|锂|钴|铜|石油|天然气|能源安全|核)\b/i;

/* 纯国内自然灾害：事件发生在中国境内且无境外/关键国要素，不属海外利益安全 */
const _DOMESTIC_CHINA_DISASTER_RE = /\b(China|Chinese|中国)\b.*\b(typhoon|mudslide|landslide|flood|flooding|earthquake|tsunami|hurricane|drought|wildfire|blizzard|avalanche|tornado|evacuat)\b|\b(typhoon|mudslide|landslide|flood|flooding|earthquake|tsunami|hurricane|drought|wildfire|blizzard|avalanche|tornado|evacuat)\b.*\b(China|Chinese|中国)\b|\b(台风|泥石流|滑坡|洪水|地震|海啸|飓风|干旱|山火|暴风雪|雪崩|龙卷风|撤离)\b/i;

/* ===== 软性/评论体裁闸门（2026-08-13 方向偏差修复）=====
 * 背景：闸门在英文原文上跑，国内噪声正则多为中文词 → 英文软性新闻漏网入库。
 * 评论/观点/社论 与 生活方式/体育/娱乐/旅游/美食/农科 等内容不属海外利益安全情报。 */
const _SOFT_JUNK_RE = /\b(opinion|op-ed|editorial|commentary|columnist|essay|book review|movie review|film review)\b|^(意见|社论|评论|专栏|述评|观点|时评)[|：:丨 ]|\b(lifestyle|fashion|recipe|cuisine|travel guide|tourism|festival|concert|celebrity|gossip|horoscope|sports?|football|soccer|basketball|baseball|tennis|golf|olympics?|box office|tv series|drama series|reality show)\b|文化遗产|民俗|非遗|美食|旅游|足球|篮球|奥运|演唱会|电影|电视剧|综艺|时尚|考古/i;
/* 真实安全事件特征（2026-08-13 用户指令）：全球武装组织动态/战术能力类情报不设涉华门槛，
 * 主题检索通道中，袭击/爆炸/武装冲突/清剿/无人机武器化等真实安全事件即使不涉华也放行 */
const _SECURITY_EVENT_RE = /attack|blast|explosion|explosive|bombing|bomb|killed|deadly|militants?|terrorists?|terror|insurgents?|insurgency|gunmen|airstrike|air strike|drone strike|drone program|weapons program|arms deal|arms trafficking|\bVBIED\b|car bomb|suicide|ambush|kidnap|hostage|clash|offensive|ceasefire|weaponiz|assassination|shooting|raid|artillery|shelling|missile strike|\bIED\b|improvised explosive|warlord|militia|jihad|extremist/i;
function _isSecurityEvent(text){ return _SECURITY_EVENT_RE.test(String(text||'')); }
/* ===== 国内新闻硬拦截（2026-08-13 用户指令：国内数据不入系统，只要境外涉华+海外利益安全）=====
 * 背景：闸门对英文原文判定口径随标题措辞波动（"Floods in southern China kill 39"
 * 这类国内灾害/民生新闻曾从主题通道、涉华专项通道漏入）。统一在采集层硬拦：
 * 涉华文本被闸门判定为 china-domestic / china-domestic-incident 的，无论哪个通道一律丢弃。 */
/* 国内领域词：出现这些词且无明显境外要素时，即使没写具体地名也视为国内事务 */
const _DOMESTIC_DOMAIN_RE = /煤矿|瓦斯|矿难|井下|安监|煤监局|高考|中考|考研|公务员考试|国考|省考|职业资格|乡村振兴|扶贫|脱贫攻坚|共同富裕|美丽乡村|新农合|医保|社保|公积金|养老保险|个税|房产税|国内航班|高速公路|铁路事故|列车追尾|动车|高铁事故|纪委|监委|反腐|贪污|受贿|行贿|滥用职权|玩忽职守|职务犯罪|刑事案|民事案|法院宣判|检察院|公安部通缉|省公安厅|市公安局|县公安局|村委会|居委会|社区|小区|物业|开发商|楼盘|房价|楼市|股市|A股|港股|科创板|创业板|上证指数|深成指/i;
function _isDomesticChina(text) {
  const txt = String(text || '');
  if (!txt) return false;
  if (!/中国|北京|上海|广州|深圳|天津|重庆|China|Chinese|Beijing|Shanghai|Guangdong|Guangxi|Sichuan|Yunnan|Xinjiang|Tibet/i.test(txt)) return false;
  /* 收窄（2026-08-13 修正过度拦截）：含境外要素的涉华条目不是国内新闻——
   * ① 海外人员/资产/项目信号；② 文本同时提及外国地名/机构（涉华国际关系、海外事件） */
  if (/中资|中企|华人|华侨|华裔|中方员工|中方人员|中国公民|中国劳工|中国工人|留学生|使馆|领事馆|驻外|海外|境外|国外|一带一路|瓜达尔|中资营地|Chinese national|Chinese worker|Chinese citizen|Chinese compan|overseas Chinese|Chinese employees/i.test(txt)) return false;
  /* 中国+国内专属领域词 → 国内事务（如"中国调查煤矿安全官员"） */
  if (_DOMESTIC_DOMAIN_RE.test(txt) && !/(?:美国|日本|韩国|朝鲜|印度|俄罗斯|英国|法国|德国|澳大利亚|加拿大|联合国|欧盟|北约|巴基斯坦|阿富汗|伊朗|伊拉克|叙利亚|土耳其|沙特|以色列|乌克兰|巴西|阿根廷|智利|秘鲁|墨西哥|南非|尼日利亚|肯尼亚|埃塞俄比亚|埃及|利比亚|苏丹|马里|尼日尔|乍得|刚果|赞比亚|安哥拉|莫桑比克|坦桑尼亚|索马里|缅甸|泰国|越南|老挝|柬埔寨|马来西亚|新加坡|印尼|印度尼西亚|菲律宾|蒙古|哈萨克斯坦|乌兹别克斯坦|吉尔吉斯斯坦|塔吉克斯坦|土库曼斯坦|孟加拉|斯里兰卡|尼泊尔|欧洲|美洲|非洲|亚洲|Pakistan|Afghanistan|Iran|Iraq|Syria|Turkey|Saudi|Israel|Ukraine|Brazil|Argentina|Mexico|Nigeria|Kenya|Ethiopia|Egypt|Libya|Sudan|Myanmar|Thailand|Vietnam|Malaysia|Singapore|Indonesia|Philippines|Mongolia|Kazakhstan|Bangladesh|Sri Lanka|Nepal)/i.test(txt)) return true;
  if (/美国|日本|韩国|朝鲜|印度|俄罗斯|英国|法国|德国|澳大利亚|加拿大|联合国|欧盟|北约|巴基斯坦|阿富汗|伊朗|伊拉克|叙利亚|土耳其|沙特|以色列|乌克兰|波兰|荷兰|西班牙|意大利|希腊|瑞士|瑞典|挪威|芬兰|丹麦|比利时|奥地利|捷克|匈牙利|塞尔维亚|巴西|阿根廷|智利|秘鲁|墨西哥|哥伦比亚|委内瑞拉|古巴|南非|尼日利亚|肯尼亚|埃塞俄比亚|埃及|利比亚|苏丹|摩洛哥|阿尔及利亚|突尼斯|加纳|马里|尼日尔|乍得|喀麦隆|刚果|赞比亚|安哥拉|莫桑比克|坦桑尼亚|乌干达|卢旺达|索马里|缅甸|泰国|越南|老挝|柬埔寨|马来西亚|新加坡|印尼|印度尼西亚|菲律宾|文莱|东帝汶|蒙古|哈萨克斯坦|乌兹别克斯坦|吉尔吉斯斯坦|塔吉克斯坦|土库曼斯坦|阿塞拜疆|亚美尼亚|格鲁吉亚|孟加拉|斯里兰卡|尼泊尔|不丹|马尔代夫|新西兰|斐济|巴布亚|欧洲|澳洲|南美|北美|大洋洲|亚太|亚太经合|伊斯兰堡|长崎|华盛顿|首尔|东京|莫斯科|伦敦|巴黎|柏林|曼谷|雅加达|马尼拉|河内|吉隆坡|纽约|旧金山|洛杉矶|西雅图|United States|Japan|Korea|India|Russia|Britain|France|Germany|Australia|Canada|United Nations|UN |EU |NATO|Pakistan|Afghanistan|Iran|Iraq|Syria|Turkey|Saudi|Israel|Ukraine|Brazil|Argentina|Mexico|Africa|African|Libya|Sudan|Nigeria|Kenya|Ethiopia|Egypt|Myanmar|Thailand|Vietnam|Malaysia|Singapore|Indonesia|Philippines|Mongolia|Kazakhstan|Bangladesh|Sri Lanka|Nepal|New Zealand|Europe|European|Middle East|Latin America|Southeast Asia|Central Asia/i.test(txt)) return false;
  const g = scrapers.chinaOverseasGate(txt);
  return !g.pass && (g.reason === 'china-domestic' || g.reason === 'china-domestic-incident');
}

/* ===== 信源可信度分级（2026-08-13 用户指令：信源分级）=====
 * A=权威通讯社/官方/国际大报；B=主流大报/专业机构/智库；C=地方媒体/其他；D=社媒未证实 */
const _CRED_A_RE = /reuters|associated press|apnews|法新社|afp|新华社|xinhua|人民日报|bloomberg|financial times|wall street journal|nytimes|new york times|bbc|联合国|un news/i;
const _CRED_B_RE = /scmp|南华早报|al jazeera|半岛|dawn|the hindu|guardian|washington post|nikkei|economist|foreign policy|csis|jamestown|ctc|soufan|long war|diplomat|china daily|global times|cgtn|中国日报|环球时报|中国新闻社|ecns|caixin|财新|afp|kyodo|共同社|tass|塔斯社/i;
const _CRED_D_RE = /twitter|x\.com|telegram|facebook|reddit|mastodon|社交媒体|论坛|博客|blog/i;
function _sourceCredibility(name){
  const n = String(name || '');
  if (_CRED_D_RE.test(n)) return 'D';
  if (_CRED_A_RE.test(n)) return 'A';
  if (_CRED_B_RE.test(n)) return 'B';
  return 'C';
}
/* 人物特写/人文关怀故事（2026-08-13：如"不仅仅是一个职业-在危机地区做护士"——
 * "危机"撞风险词入库，但内容是人物叙事，无事件实质，无情报价值） */
const _FEATURE_PROFILE_RE = /不仅仅|的故事|自述|专访|特写|人物|一名.{0,8}(护士|医生|教师|志愿者|司机|厨师|农民|渔民|牧民|环卫|理发|邮递|售票)|more than a job|human interest|profile of|portrait of|feature story|first.person|my life as|a day in the life/i;
/* 解释性/分析/专家访谈类文章（2026-08-13 用户指令："为什么…可能是…"这类不是事件情报） */
const _ANALYSIS_PIECE_RE = /^为什么|^为何|^怎么|^如何|^(why|how)\s.{5,90}(could|may|might|would)\s+be|^(why|how)\s.{5,90}\?|分析人士|观察家|评论员文章|专家访谈|深度分析|told sputnik|former .{0,20}(analyst|official|colonel|diplomat).{0,30}(said|told)|retired .{0,20}(said|told)/i;
function _isSoftJunk(text){
  const t = String(text || '');
  if (_SOFT_JUNK_RE.test(t)) return true;
  /* 解释性/分析/专家访谈：标题即体裁特征 → 拦截 */
  if (_ANALYSIS_PIECE_RE.test(t.trim())) return true;
  /* 人物特写：有叙事特征且无安全事件实质 → 拦截 */
  if (_FEATURE_PROFILE_RE.test(t) && !_isSecurityEvent(t) && !/死亡|伤亡|遇害|遇难|爆炸|袭击|绑架|事故|撤离|殴打|枪击|killed|attack|blast|dead|injured|assault/i.test(t)) return true;
  return false;
}

function _chinaNegativeGate(text, gate){
  if(!text) return false;
  if(gate && gate.reason && /topic-noise|domestic-junk|culture-business-junk|domestic-edu-tech-noise|china-domestic-incident|domestic-irrelevant/.test(gate.reason)) return false;
  if(!_CHINA_RELATED_RE.test(text)) return false;
  // 严格正则 + 词干兜底：覆盖制裁/冲突/袭击等词的复数/时态/派生形式
  const hasNegativeSignal = _CHINA_NEGATIVE_KW_RE.test(text) ||
    /\b(sanction|tariff|embargo|boycott|ban|restrict|investigat|crackdown|probe|fine|seizure|freeze|penalt|lawsuit|arbitration|claim|withdraw|terminat|cancel|suspend|delay|postpone|default|loss|layoff|bankrupt|attack|terrorist|kidnap|blast|shoot|violence|killed?|casualt|conflict|war|coup|riot|protest|demonstration|strike|xenophob|anti.china|anti.chinese|spy|espionage|surveillance|threat|critic|condemn|accus|blame|warn|confrontation|friction|dispute|divergence|tension|crisis|deteriorat|downgrade|expel|detain|sink|intercept|ram|crash|accident|disaster|fire|collapse|leak|pollution|poison|pandemic|epidemic|earthquake|flood|typhoon|hurricane|dumping|subsidy|blockade|coercion|decouple|containment|blacklist|exclusion|eviction|deportation|complaint|recession|plunge|slump|decline)(s|es|ed|ing|tion|tions|ment|ments|ion|ions|ure|ures|ive|ized|ised)?\b/i.test(text);
  if(!hasNegativeSignal) return false;
  // 境外涉华负面必须带真实境外要素（不能仅靠“中国”二字）或强海外利益信号，避免把纯国内负面新闻纳入
  const txt = String(text || '');
  // 先拦截纯国内自然灾害（中国境内台风/滑坡/泥石流/洪水等），这些不属海外利益安全
  if (_DOMESTIC_CHINA_DISASTER_RE.test(txt)) return false;
  const hasStrongOverseas = _STRONG_OVERSEAS_INTEREST_RE.test(txt);
  // 判断“境外要素”：命中除中国/Chinese/China/Hong Kong/Taiwan/Macau 以外的国家/国际/外交/安全/经济信号；
  // 注意："撤离/疏散/evacuation" 在国内灾害中也很常见，不能单独作为境外要素；"撤侨" 才是强海外信号。
  // 自然灾害词（地震/洪水/台风/飓风等）在国内事件中常见，不单独作为境外要素。
  const foreignSignal = /\b(国际|世界|全球|海外|境外|国外|外国|外交|外事|出访|访问|峰会|会晤|会谈|合作|援助|援建|投资|贸易|进出口|关税|协定|协议|备忘录|制裁|冲突|战争|政变|骚乱|抗议|示威|罢工|紧张|局势|安全|风险|威胁|警告|批评|指责|谴责|抵制|反华|排华|间谍|渗透|监听|袭击|爆炸|绑架|劫持|伤亡|遇害|遇难|事故|灾难|疫情|撤侨|international|world|global|overseas|abroad|foreign|diplomat|diplomatic|summit|visit|cooperation|aid|investment|trade|tariff|agreement|sanction|conflict|war|coup|riot|protest|demonstration|strike|tension|security|risk|threat|warn|critic|condemn|accuse|blame|boycott|anti-china|anti-chinese|spy|espionage|surveillance|attack|kidnap|blast|explosion|explosive|casualty|casualties|killed|dead|injured|wounded|hostage|accident|disaster|pandemic|epidemic)\b/i.test(txt) ||
    /\b(internationals?|worldwide|globals?|overseas|abroad|foreign|diplomat|diplomatic|summits?|visits?|visited|visiting|cooperation|cooperate|aid|investigation|investigations|investigating|investment|investing|invest|trades?|traded|trading|tariffs?|tariff|agreements?|sanctions?|sanctioned|sanctioning|conflicts?|wars?|coups?|riots?|rioting|protests?|protesters?|protesting|demonstrations?|demonstrating|strikes?|striking|tensions?|security|risks?|threats?|threatening|warns?|warning|warned|critic|criticize|criticism|criticized|criticizing|condemn|condemns|condemned|condemning|accuse|accuses|accused|accusing|blame|blames|blamed|blaming|boycott|boycotts|boycotted|boycotting|anti.china|anti.chinese|spy|spies|spying|espionage|surveillance|attack|attacks|attacked|attacking|kidnap|kidnaps|kidnapped|kidnapping|blast|blasts|blasted|explosion|explosions|casualt|killed|kill|kills|killing|dead|injured|wounded|hostage|hostages|accident|accidents|disaster|disasters|pandemic|epidemic)\b/i.test(txt);
  const hasForeignCountry = new RegExp(
    GLOBAL_COUNTRIES.filter(c => !/^(中国|中国香港|中国台湾|中国澳门|China|Chinese|Hong Kong|Taiwan|Macau)$/i.test(c.cn))
      .map(c => _reEscape(c.cn)).join('|'),
    'i'
  ).test(txt);
  if (hasStrongOverseas || foreignSignal || hasForeignCountry) return true;
  // 兜底：涉华 + 强安全/战略外溢信号（出口管制、制裁、军售、能源安全、供应链中断等）→ 视为境外涉华负面风险
  if (_STRATEGIC_NEGATIVE_RE.test(text)) {
    // 但纯国内自然灾害除外（如中国境内台风/滑坡/泥石流），这些不属海外利益安全
    if (_DOMESTIC_CHINA_DISASTER_RE.test(text)) return false;
    return true;
  }
  return false;
}

function _hit(low, kw){ return kw.some(k => low.indexOf(k.toLowerCase()) >= 0); }

/** 计算文本与我海外利益安全的关联度得分（0-100+）
 * 直接命中 A/B/C/D/E 即可高分通过；
 * 外国新闻必须同时满足：① 发生在核心/关键利益国 ② 含安全/通道/能源/灾害信号，
 * 否则视为泛泛外讯，拒绝入库。 */
function scoreOverseasInterest(text){
  if(!text) return { score:0, reasons:[] };
  const low = text.toLowerCase();
  let score = 0, reasons = [];
  for(const d of ['A','B','C','D','E','F','G','H','I']){
    if(_hit(low, DIM_KW[d])){ score += DIM_SCORE[d]; reasons.push(d); }
  }
  return { score, reasons };
}

/** 相关性闸门：只保留与「海外利益安全」直接/间接相关的真实条目
 * 逻辑：先由 crawler.chinaRelated/interestRelated 判定；再按维度评分 ≥60 放行。
 * 杜绝：美国内政、欧洲普通社会新闻、无关体育赛事等泛泛外讯进入平台。 */
function gateRelevant(text){
  if(!text) return false;
  if(crawler.chinaRelated && crawler.chinaRelated(text)) return true;
  if(crawler.interestRelated && crawler.interestRelated(text)) return true;
  const sc = scoreOverseasInterest(text);
  return sc.score >= 60;
}

/** 维度评分：返回 { dims:[...], maxScore, scores:{} } */
function scoreDimensions(text, countryDims){
  const low = (text||'').toLowerCase();
  const dims = [];
  for(const d of ['A','B','C','D','E','F','G']){
    const kws = DIM_KW[d] || [];
    if(_hit(low, kws)) dims.push(d);
  }
  // 国家自带典型维度（资产密集国/战略外溢等）纳入基础分，但仅当条目已过闸门
  (countryDims || []).forEach(d => { if(dims.indexOf(d) < 0) dims.push(d); });
  let maxScore = 0;
  const scores = {};
  dims.forEach(d => { scores[d] = DIM_SCORE[d] || 0; if(scores[d] > maxScore) maxScore = scores[d]; });
  return { dims, maxScore, scores };
}

/* ===== 直连 RSS（大幅扩展版：全球新闻媒体 + 智库研究机构）=====
 * 主数据源来自 server/media_feeds.js，覆盖欧美、东亚、中亚、东南亚、南亚、拉美、
 * 非洲、东北亚、中东、西非、北非、西亚、北亚、大洋洲等区域。
 * 本清单经过去重合并，保留早期实测可达源作为兜底，新增大量国际主流媒体、
 * 地方媒体、智库与研究机构 RSS 通道。
 * 铁律一：只抓取登记清单内的源；不可达源自然失败，绝不伪造数据。
 * 并发控制：每批次并发 8 个请求，超时 10s，避免阻塞。 */
function _dedupByUrl(arr) {
  const seen = new Set();
  return (arr || []).filter(o => {
    const k = String(o.url || '').replace(/\/+$/, '').toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const LEGACY_DIRECT_RSS = [
  { cn:'巴基斯坦', iso:'PAK', name:'The News International', url:'https://www.thenews.com.pk/rss/1/1' },
  { cn:'巴基斯坦', iso:'PAK', name:'Modern Diplomacy', url:'https://moderndiplomacy.eu/feed/' },
  { cn:'巴基斯坦', iso:'PAK', name:'Pak Observer', url:'https://pakobserver.net/feed/' },
  { cn:'巴基斯坦', iso:'PAK', name:'Bol News', url:'https://bolnews.com/feed/' },
  { cn:'巴基斯坦', iso:'PAK', name:'Daily Pakistan', url:'https://en.dailypakistan.com.pk/feed/' },
  { cn:'巴基斯坦', iso:'PAK', name:'ProPakistani', url:'https://propakistani.pk/feed/' },
  { cn:'巴基斯坦', iso:'PAK', name:'TechJuice', url:'https://techjuice.pk/feed/' },
  { cn:'巴基斯坦', iso:'PAK', name:'The Current', url:'https://thecurrent.pk/feed/' },
  { cn:'阿富汗', iso:'AFG', name:'Khaama Press', url:'https://www.khaama.com/feed/' },
  { cn:'缅甸', iso:'MMR', name:'Myanmar Now', url:'https://myanmar-now.org/en/feed/' },
  { cn:'尼日利亚', iso:'NGA', name:'Vanguard', url:'https://www.vanguardngr.com/feed/' },
  { cn:'尼日利亚', iso:'NGA', name:'Sahara Reporters', url:'https://saharareporters.com/rss.xml' },
  { cn:'尼日利亚', iso:'NGA', name:'Premium Times', url:'https://www.premiumtimesng.com/feed/' },
  { cn:'印度', iso:'IND', name:'Indian Express', url:'https://indianexpress.com/feed/' },
  { cn:'孟加拉国', iso:'BGD', name:'Prothom Alo', url:'https://en.prothomalo.com/feed' },
  { cn:'利比亚', iso:'LBY', name:'Libya Herald', url:'https://libyaherald.com/feed/' },
  { cn:'巴西', iso:'BRA', name:'Folha', url:'https://feeds.folha.uol.com.br/poder/rss091.xml' },
  { cn:'菲律宾', iso:'PHL', name:'Rappler', url:'https://www.rappler.com/feed/' },
  { cn:'塞尔维亚', iso:'SRB', name:'Balkan Insight', url:'https://balkaninsight.com/feed/' },
  { cn:'波兰', iso:'POL', name:'Notes from Poland', url:'https://notesfrompoland.com/feed/' },
  { cn:'澳大利亚', iso:'AUS', name:'SBS News', url:'https://www.sbs.com.au/news/feed' },
  { cn:'伊朗', iso:'IRN', name:'Iran International', url:'https://www.iranintl.com/en/feed' },
  { cn:'肯尼亚', iso:'KEN', name:'Daily Nation', url:'https://nation.africa/kenya/rss.xml' },
  { cn:'肯尼亚', iso:'KEN', name:'The Standard', url:'https://www.standardmedia.co.ke/rss/kenya.php' },
  { cn:'埃塞俄比亚', iso:'ETH', name:'Ethiopia Observer', url:'https://www.ethiopiaobserver.com/feed' },
  { cn:'南非', iso:'ZAF', name:'News24 Top Stories', url:'https://feeds.capi24.com/v1/Search/articles/news24/TopStories/rss' },
  { cn:'越南', iso:'VNM', name:'VNExpress International', url:'https://e.vnexpress.net/rss/world.rss' },
  { cn:'柬埔寨', iso:'KHM', name:'The Cambodia Daily', url:'https://english.cambodiadaily.com/feed/' },
  { cn:'印度尼西亚', iso:'IDN', name:'Antara News', url:'https://www.antaranews.com/en/rss' },
  { cn:'墨西哥', iso:'MEX', name:'Mexico News Daily', url:'https://mexiconewsdaily.com/feed/' },
  { cn:'墨西哥', iso:'MEX', name:'El Financiero', url:'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/' },
  { cn:'哥伦比亚', iso:'COL', name:'Colombia Reports', url:'https://colombiareports.com/feed/' },
  { cn:'秘鲁', iso:'PER', name:'Peru Reports', url:'https://perureports.com/feed/' },
  { cn:'秘鲁', iso:'PER', name:'El Comercio', url:'https://elcomercio.pe/feed/' },
  { cn:'阿根廷', iso:'ARG', name:'Buenos Aires Times', url:'https://www.batimes.com.ar/feed/' },
  { cn:'津巴布韦', iso:'ZWE', name:'NewsDay Zimbabwe', url:'https://www.newsday.co.zw/feed/' },
  { cn:'委内瑞拉', iso:'VEN', name:'Caracas Chronicles', url:'https://www.caracaschronicles.com/feed/' },
  { cn:'厄瓜多尔', iso:'ECU', name:'Ecuador Times', url:'https://www.ecuadortimes.net/feed/' },
  { cn:'哈萨克斯坦', iso:'KAZ', name:'Astana Times', url:'https://astanatimes.com/feed/' },
  { cn:'匈牙利', iso:'HUN', name:'Hungary Today', url:'https://hungarytoday.hu/feed/' },
  { cn:'捷克', iso:'CZE', name:'Prague Morning', url:'https://praguemorning.cz/feed/' },
  { cn:'俄罗斯', iso:'RUS', name:'The Moscow Times', url:'https://www.themoscowtimes.com/rss/news' },
  { cn:'乌克兰', iso:'UKR', name:'Euromaidan Press', url:'https://euromaidanpress.com/feed/' },
  { cn:'乌克兰', iso:'UKR', name:'Kyiv Post', url:'https://www.kyivpost.com/feed/' },
  { cn:'叙利亚', iso:'SYR', name:'Syria Direct', url:'https://syriadirect.org/feed/' },
  { cn:'也门', iso:'YEM', name:'Yemen Times', url:'https://yementimes.com/feed/' },
  { cn:'伊拉克', iso:'IRQ', name:'Al-Monitor', url:'https://www.al-monitor.com/rss' },
  { cn:'肯尼亚', iso:'KEN', name:'The EastAfrican', url:'https://www.theeastafrican.co.ke/rss.xml' },
  { cn:'赞比亚', iso:'ZMB', name:'Lusaka Times', url:'https://www.lusakatimes.com/feed/' },
  { cn:'格鲁吉亚', iso:'GEO', name:'Civil Georgia', url:'https://civil.ge/feed/' }
];
const DIRECT_RSS = _dedupByUrl(LEGACY_DIRECT_RSS.concat(mediaFeeds.DIRECT_RSS || []));
const THINK_TANK_FEEDS = _dedupByUrl(mediaFeeds.THINK_TANK_FEEDS || []);
const CHINA_FOCUS_SOURCES = _dedupByUrl(mediaFeeds.CHINA_FOCUS_SOURCES || []);
const CHINA_NEGATIVE_SOURCES = _dedupByUrl(mediaFeeds.CHINA_NEGATIVE_SOURCES || []);

/* 境外涉华负面信号关键词：制裁、冲突、袭击、事故、撤资、歧视、反华、维权等 */
const _CHINA_NEGATIVE_KW_RE = new RegExp(
  '\\b(sanction|embargo|boycott|ban|restriction|crackdown|probe|investigation|fine|seizure|freeze|penalty|lawsuit|arbitration|claim|withdraw|pull\\s*out|terminate|cancel|suspend|delay|postpone|default|loss|layoff|bankruptcy|attack|terrorist|kidnap|blast|shooting|violence|killed|casualt|conflict|war|coup|riot|protest|demonstration|strike|xenophobia|anti-china|anti-chinese|spy|espionage|surveillance|security\\s*threat|cyber\\s*threat|data\\s*breach|military\\s*threat|threat|criticize|criticism|condemn|accuse|blame|warn|confrontation|friction|dispute|divergence|tension|crisis|deteriorate|downgrade|expel|detain|sink|intercept|ram|crash|accident|disaster|fire|collapse|leak|pollution|poisoning|pandemic|epidemic|earthquake|flood|typhoon|hurricane|dumping|subsidy|tariff|blockade|coercion|decouple|containment|blacklist|exclusion|eviction|deportation|complaint|recession|plunge|slump|decline)\\b|' +
  '制裁|抵制|禁运|封锁|限制|打压|审查|调查|罚款|扣押|查封|冻结|处罚|起诉|诉讼|仲裁|索赔|撤资|退出|终止|取消|暂停|推迟|搁置|违约|亏损|裁员|倒闭|破产|袭击|恐袭|绑架|爆炸|枪击|暴力|遇害|遇难|伤亡|死伤|冲突|战争|政变|骚乱|抗议|示威|罢工|游行|抵制|排斥|仇外|反华|排华|歧视|辱华|间谍|渗透|监听|安全威胁|网络安全|数据安全|军事威胁|威胁|批评|指责|谴责|警告|对抗|禁止|抨击|冲击|针对|反制|投诉|管控|管制|壁垒|惩罚|驱逐|遣返|断供|脱钩|遏制|围堵|争端|纠纷|摩擦|紧张|危机|风险|断交|降级|禁入|黑名单|反倾销|反补贴|保障措施|出口管制|加征关税|贸易壁垒|技术封锁|经济胁迫|强制|干涉|破坏|侵害|侵犯|危害|灾难|事故|火灾|泄露|泄漏|污染|中毒|疫情|地震|洪水|台风|飓风|衰退|下滑|下跌|暴跌|萧条|债务陷阱|禁飞|断航|停运|封锁|拦截|撞击|坠毁|沉没|倾覆|泄露|泄漏|辐射|故障|瘫痪|中断|罢工|罢课|罢市|游行|集会|聚众|骚乱|暴乱|哄抢|劫掠|抢劫|盗窃|偷盗|诈骗|欺诈|勒索|敲诈|威胁|恐吓|恐吓|绑架|劫持|人质|遇害|遇难|罹难|殉职|负伤|受伤|伤亡|致死|致命|死亡|丧生|遇害|遇难|毁灭|摧毁|损毁|损坏|破坏|坍塌|塌陷|滑坡|泥石流|海啸|干旱|饥荒|瘟疫|疫病|疫情|病毒|传染|感染|确诊|死亡|病亡|逝世|去世',
  'i'
);

function _isoToCn(iso) {
  const f = GLOBAL_COUNTRIES.find(c => c.iso === iso);
  return f ? f.cn : (iso || '');
}
/* GDELT 时间戳 20260802T134500Z → ISO（crawler.js 同名函数未导出，此处本地复用） */
function _gdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z';
}

/** 抓取单国 GDELT 真实媒体文章 */
async function scrapeCountry(iso, opts){
  opts = opts || {};
  const q = 'sourcecountry:' + iso;
  const arts = await crawler.gdeltSearch(q, { timespan: opts.timespan || '7d', maxrecords: opts.max || 18 });
  // 兜底：GDELT 偶发空（限流/熔断），用涉华全球检索补偿该国曝光
  if(!arts || !arts.length){
    const alt = await crawler.gdeltSearch('(China OR Chinese OR Beijing) ' + q, { timespan: opts.timespan || '7d', maxrecords: 8 });
    return alt || [];
  }
  return arts;
}

/**
 * 批量抓取全球多国真实媒体情报。
 * @param opts { countries?: subset, max?: 每国条数, timespan?, onCountry?: fn(cn,items) }
 * @returns { items:[带 country_cn/country_iso/dims 的真实条目], byCountry:{}, count }
 */
async function scrapeGlobalMedia(opts){
  opts = opts || {};
  const list = (opts.countries && opts.countries.length) ? opts.countries : GLOBAL_COUNTRIES;
  // prio 升序：先把重点/高危国数据喂满（用户点名 + 中资密集），其余轮转
  const ordered = list.slice().sort((a,b)=> (a.prio||9)-(b.prio||9));
  const out = [];
  const byCountry = {};
  for(const c of ordered){
    let arts = [];
    try { arts = await scrapeCountry(c.iso, opts); } catch(e){ arts = []; }
    // 相关性闸门 + 维度标注
    const tagged = [];
    for(const a of (arts||[])){
      const txt = (a.title||'') + ' ' + (a.domain||'');
      if(!gateRelevant(txt)) continue;
      const sc = scoreDimensions(a.title||'', c.dims);
      const item = Object.assign({}, a, {
        country_cn: c.cn, country_iso: c.iso,
        dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
        source: (a.domain || '').replace(/^www\./,'') || c.cn + '媒体',
        category: '全球媒体情报',
        data_type: 'osint_intel',
        interestLinked: true,
        language: a.language || '',
        publish_time: (a.seendate||'').replace(/T/,' ').replace(/Z$/,''),
        _real: true, _fromSource: 'GDELT:' + c.iso
      });
      tagged.push(item);
    }
    byCountry[c.cn] = tagged;
    out.push.apply(out, tagged);
    if(opts.onCountry) { try { opts.onCountry(c.cn, tagged); } catch(e){} }
  }
  return { items: out, byCountry: byCountry, count: out.length };
}

/* ===== 直连 RSS 抓取（用 Node 全局 fetch；host 受 DIRECT_RSS 清单约束，防 SSRF）=====
 * 仅抓取本文件 DIRECT_RSS 内已登记的可达源，绝不接受任意 URL。 */
const UA_REAL = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
async function _fetchRss(url, timeout) {
  timeout = timeout || 10000;
  try {
    const r = await netx.smartFetch(url, {
      timeout,
      headers: { 'User-Agent': UA_REAL, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
    });
    if (r.status !== 200) return '';
    return await r.text();
  } catch (e) { return ''; }
}
function _parseRss(xml) {
  const items = [];
  const blocks = (xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(b => {
    const tg = n => {
      const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    let title = tg('title');
    let link = tg('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1]; }
    const pub = tg('pubDate') || tg('updated') || tg('published');
    const desc = tg('description') || tg('summary') || '';
    if (title) items.push({ title: title, link: link, pubDate: pub, description: desc.replace(/<[^>]+>/g, '').slice(0, 400) });
  });
  return items;
}
/* RSS 条目 freshness：解析 pubDate/updated/published，仅保留 90 天内；无法解析时默认放行（避免误杀） */
const RSS_FRESH_DAYS = 1; /* 2026-08-13 用户铁律：预警只采近24小时鲜活数据，旧闻无预警价值 */
function _parseRssDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  // 常见非标准格式兜底
  const m = str.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (m) { d = new Date(m[1] + ' ' + m[2] + ' ' + m[3]); if (!isNaN(d.getTime())) return d; }
  return null;
}
function _isRssFresh(pubDate, maxDays) {
  const d = _parseRssDate(pubDate);
  if (!d) return true; // 无法解析默认放行
  const days = maxDays || RSS_FRESH_DAYS;
  return (Date.now() - d.getTime()) <= days * 24 * 60 * 60 * 1000;
}
/* ===== 并发控制辅助：分批执行 Promise ===== */
async function _batchRun(arr, fn, concurrency) {
  concurrency = concurrency || 8;
  const out = [];
  for (let i = 0; i < arr.length; i += concurrency) {
    const batch = arr.slice(i, i + concurrency);
    const res = await Promise.all(batch.map(fn));
    res.forEach(r => { if (r) out.push(r); });
  }
  return out;
}

/* 区域默认维度：当 GLOBAL_COUNTRIES 未登记某国时，按区域给维度 */
const REGION_DEFAULT_DIMS = {
  '东亚': ['A','E','B'], '东北亚': ['A','E','B'], '东南亚': ['E','B'],
  '南亚': ['A','E'], '中亚': ['B','D'], '西亚': ['C','D','F'], '中东': ['C','D','F'],
  '北非': ['C','D'], '西非': ['D','E'], '东非': ['D','E'], '南部非洲': ['D','E'],
  '欧洲': ['F','G'], '北美': ['G','F'], '拉美': ['D','E'], '大洋洲': ['G'],
  '俄罗斯与独联体': ['C','D','F'], '北亚': ['C','D','F']
};
function _resolveDims(s) {
  const cd = GLOBAL_COUNTRIES.find(c => c.iso === s.iso);
  if (cd && cd.dims && cd.dims.length) return cd.dims;
  const r = s.region || '';
  for (const k in REGION_DEFAULT_DIMS) {
    if (r.indexOf(k) >= 0) return REGION_DEFAULT_DIMS[k];
  }
  return ['E','F'];
}

function _tagRssItem(it, s, dims, fromSource) {
  const txt = (it.title || '') + ' ' + (it.description || '');
  if (_isSoftJunk(txt)) return null;
  if (_isDomesticChina(txt)) return null;
  if (!gateRelevant(txt)) return null;
  /* 统一过中国海外利益安全权威闸门，避免 gateRelevant 过松导致国内新闻/弱相关新闻流入 */
  const gate = scrapers.chinaOverseasGate(txt);
  if (!gate.pass) return null;
  /* 涉华判定铁律（2026-08-13 用户定义）：只看标题要素（中国/中资/华人等），
   * 不再按"来源是中国媒体"注入 A 维度——新华社发的世界新闻不是涉华情报 */
  const isChinaTitle = scrapers.isChinaRelatedStrict(it.title || '');
  const effectiveDims = (dims || []).slice();
  if (isChinaTitle && effectiveDims.indexOf('A') < 0) effectiveDims.push('A');
  const sc = scoreDimensions(it.title, effectiveDims);
  return {
    title: it.title, content: it.description || '', url: it.link || s.url,
    country_cn: s.cn, country_iso: s.iso, dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
    source: s.name, credibility: _sourceCredibility(s.name), category: '全球媒体情报', data_type: 'osint_intel',
    interestLinked: true, chinaRelated: isChinaTitle,
    language: s.lang || '', publish_time: (it.pubDate || ''),
    _real: true, _fromSource: (fromSource || 'RSS') + ':' + s.iso,
    _sourceType: s.type || 'media'
  };
}

/* ===== 航道与走廊安全专项采集通道（2026-08-14 用户指令）=====
 * 覆盖：海盗袭击/劫持商船/船员绑架、国际航运通道安全事件、地缘博弈外溢（红海/霍尔木兹等）、
 * 中欧班列与一带一路走廊运行安全。专用源 + 专用关键词 + 要道/走廊标签（与态势地图联动）。 */
const CHANNEL_WATCH_FEEDS = [
  { name: 'gCaptain', url: 'https://gcaptain.com/feed/', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'Maritime Executive', url: 'https://maritime-executive.com/rss', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'USNI News', url: 'https://news.usni.org/feed', cn: '美国', iso: 'US', lang: 'en' },
  { name: 'Splash247', url: 'https://splash247.com/feed/', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'Seatrade Maritime', url: 'https://www.seatrade-maritime.com/rss', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'Safety4Sea', url: 'https://safety4sea.com/feed/', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'MarineLink', url: 'https://www.marinelink.com/rss', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'TradeWinds', url: 'https://www.tradewindsnews.com/rss', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'RailFreight', url: 'https://www.railfreight.com/feed/', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'Railway Gazette', url: 'https://www.railwaygazette.com/rss', cn: '国际', iso: 'UN', lang: 'en' },
  { name: 'Railway Age', url: 'https://www.railwayage.com/feed/', cn: '美国', iso: 'US', lang: 'en' }
];

/* 通道/走廊关键词（命中即为航道安全相关） */
const _CHANNEL_WATCH_RE = /海盗|劫持商船|船员被|航道|海峡|运河|航运|商船|油轮|货轮|集装箱船|散货船|船东|船员|港口封锁|航道封锁|护航|胡塞|红海|曼德|亚丁湾|霍尔木兹|波斯湾|马六甲|苏伊士|巴拿马|直布罗陀|好望角|巽他|龙目|对马|宫古|北极航道|北方海路|中欧班列|铁路货运|跨境铁路|一带一路.*走廊|经济走廊|piracy|pirate|hijack|vessel|crew|seafarer|shipping|strait|canal|maritime|tanker|bulk carrier|container ship|cargo ship|freight|convoy|escort|houthi|red sea|gulf of aden|hormuz|malacca|suez|panama canal|gibraltar|bosphorus|bosporus|cape of good hope|sunda|lombok|tsushima|miyako|arctic route|northern sea route|china railway express|china-europe freight|belt and road corridor|economic corridor/i;

/* 要道/走廊标签（与态势地图 WORLDMAP._ALIASES 对应，命中即打标，前端地图联动可见） */
const _CHOKEPOINT_TAGS = [
  ['红海-曼德海峡', /红海|曼德|胡塞|亚丁湾|houthi|red sea|bab el-mandeb|gulf of aden/i],
  ['霍尔木兹海峡', /霍尔木兹|hormuz/i],
  ['马六甲海峡', /马六甲|malacca/i],
  ['苏伊士运河', /苏伊士|suez/i],
  ['巴拿马运河', /巴拿马|panama canal/i],
  ['直布罗陀海峡', /直布罗陀|gibraltar/i],
  ['好望角', /好望角|cape of good hope/i],
  ['巽他海峡', /巽他|sunda/i],
  ['龙目海峡', /龙目|lombok/i],
  ['对马海峡', /对马|tsushima/i],
  ['宫古海峡', /宫古|miyako/i],
  ['北极航道', /北极航道|东北航道|北方海路|arctic|northern sea route/i],
  ['黑海航道', /黑海|black sea/i],
  ['中欧班列', /中欧班列|china railway express|china-europe (freight|railway)|cre train/i],
  ['中巴经济走廊', /瓜达尔|中巴经济走廊|俾路支|gwadar|cpec|balochistan/i],
  ['海上丝绸之路', /海上丝绸之路|maritime silk road|科伦坡|汉班托塔|比雷埃夫斯|hambantota|piraeus/i]
];

async function scrapeChannelWatch(opts) {
  opts = opts || {};
  const out = [];
  const results = await _batchRun(CHANNEL_WATCH_FEEDS, async s => {
    let xml = '';
    try { xml = await _fetchRss(s.url, opts.timeout || 10000); } catch (e) { xml = ''; }
    if (!xml) return [];
    const parsed = _parseRss(xml);
    const tagged = [];
    for (const it of parsed) {
      const txt = (it.title || '') + ' ' + (it.description || '');
      const tt = String(it.title || ''); /* 判定只看标题：摘要含 risk/war 等词噪声大（2026-08-14 实测） */
      /* 必须命中航道/走廊关键词 */
      if (!_CHANNEL_WATCH_RE.test(tt)) continue;
      if (_isSoftJunk(txt)) continue;
      if (_isDomesticChina(txt)) continue;
      /* 先算要道/走廊标签 */
      const tags = [];
      for (const [name, re] of _CHOKEPOINT_TAGS) { if (re.test(tt)) tags.push(name); }
      /* 收紧（2026-08-14 实测修正）：纯商业航运新闻（造船订单/租船互换/财报）不采——
       * 必须命中 要道标签 或 安全/中断/延误/制裁等风险词 */
      const isSec = _isSecurityEvent(tt) || /piracy|hijack|海盗|劫持|封锁|blockade|attacks?|struck|hit by|war|warship|drones?|missiles?|mine|threat|risk|risks|sanction|disrupt|suspend|delay|shortage|escort|convoy|遇袭|袭击|中断|延误|暂停|威胁|风险|制裁|战争|水雷|导弹|对峙|护航/i.test(tt);
      if (!isSec && !tags.length) continue;
      const gate = scrapers.chinaOverseasGate(txt);
      if (!gate.pass && !isSec) continue;
      const isChina = /中国|Chinese|China|Beijing|中资|中企|华人|一带一路|中欧班列|China Railway/i.test(txt);
      const dims = ['F'];
      if (isChina) dims.push('A');
      const sc = scoreDimensions(it.title, dims);
      const t = {
        title: it.title, content: it.description || '', url: it.link || s.url,
        country_cn: s.cn, country_iso: s.iso, dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
        source: s.name, credibility: _sourceCredibility(s.name), category: '航道与走廊安全', data_type: 'osint_intel',
        interestLinked: true, chinaRelated: isChina,
        chokepoint_tags: tags,
        language: s.lang || 'en', publish_time: (it.pubDate || ''),
        _real: true, _fromSource: 'CHANNEL:' + s.name,
        _sourceType: 'channel_watch'
      };
      tagged.push(t);
    }
    return tagged;
  }, opts.concurrency || 5);
  results.forEach(r => out.push.apply(out, r));
  return { count: out.length, items: out };
}

/* ===== GDELT 主题检索增量通道（免密钥，高新鲜度）=====
 * 背景（2026-08-12 实测）：直连 RSS 源内容在首日采空后，60s 轮询每轮 95-225 条中仅 0-2 条为新 URL，
 * 日采 500 条目标无法达成。GDELT 主题检索（2天窗口+轮换查询词）可持续产出新文章 URL。
 * Google News RSS 在本机网络不可达（socket hang up），故走 GDELT。 */
const GDELT_THEME_QUERIES = [
  /* 涉华专项（每轮必抓） */
  { q: '(China OR Chinese OR Beijing) (sanction OR tariff OR "export control" OR blacklist)', cn: '美国', iso: 'US', focus: '涉华经贸科技摩擦' },
  { q: '(China OR Chinese) (military OR "South China Sea" OR Taiwan) (tension OR drill OR warn)', cn: '美国', iso: 'US', focus: '涉华军事安全' },
  { q: '("Belt and Road" OR BRI OR "Chinese investment") (project OR port OR railway) (Africa OR Asia OR Pakistan)', cn: '国际', iso: 'UN', focus: '一带一路/中资项目' },
  { q: '("Chinese workers" OR "Chinese nationals") (kidnapped OR attacked OR killed OR evacuated)', cn: '国际', iso: 'UN', focus: '中方人员安全' },
  /* 全球安全（轮询） */
  { q: '("terror attack" OR bombing OR gunmen OR hostage) kill', cn: '国际', iso: 'UN', focus: '全球恐袭' },
  { q: '(kidnapping OR abduction OR ransom) (Africa OR "Middle East" OR Asia)', cn: '国际', iso: 'UN', focus: '绑架劫持' },
  { q: '(protest OR riot OR coup OR unrest) (government OR police)', cn: '国际', iso: 'UN', focus: '社会动荡' },
  { q: '(war OR conflict OR airstrike OR ceasefire) (army OR military OR rebel)', cn: '国际', iso: 'UN', focus: '武装冲突' },
  { q: '(earthquake OR flood OR typhoon OR hurricane) (death OR casualty OR evacuate)', cn: '国际', iso: 'UN', focus: '自然灾害' },
  { q: '(outbreak OR epidemic OR pandemic) (virus OR disease OR health)', cn: '国际', iso: 'UN', focus: '公共卫生' },
  { q: '(cyberattack OR "data breach" OR ransomware OR hacking) (company OR government)', cn: '国际', iso: 'UN', focus: '网络安全' },
  { q: '(recession OR inflation OR "debt crisis" OR default) economy', cn: '国际', iso: 'UN', focus: '经济风险' },
  /* 高危国别专项（轮询） */
  { q: 'Pakistan (attack OR blast OR militant OR TTP)', cn: '巴基斯坦', iso: 'PK', focus: '巴基斯坦安全' },
  { q: 'Afghanistan (Taliban OR attack OR blast)', cn: '阿富汗', iso: 'AF', focus: '阿富汗安全' },
  { q: 'Nigeria (kidnapping OR "Boko Haram" OR bandits)', cn: '尼日利亚', iso: 'NG', focus: '尼日利亚安全' },
  { q: 'Somalia ("Al-Shabaab" OR Mogadishu) attack', cn: '索马里', iso: 'SO', focus: '索马里安全' },
  { q: 'Myanmar (conflict OR junta OR resistance) attack', cn: '缅甸', iso: 'MM', focus: '缅甸局势' },
  { q: 'Sudan (conflict OR RSF OR Khartoum) fighting', cn: '苏丹', iso: 'SD', focus: '苏丹局势' },
  { q: '(Mali OR Niger OR "Burkina Faso") (jihadist OR attack)', cn: '马里', iso: 'ML', focus: '萨赫勒安全' },
  { q: '(Congo OR DRC) (M23 OR fighting OR attack)', cn: '刚果（金）', iso: 'CD', focus: '刚果金局势' },
  /* 武装组织名专项（2026-08-12 用户点名主题） */
  { q: '(LeT OR "Lashkar-e-Taiba" OR JeM OR "Jaish-e-Mohammed" OR "Hizbul Mujahideen" OR ISI)', cn: '巴基斯坦', iso: 'PK', focus: '巴恐怖组织动态' },
  { q: '(Hamas OR Hezbollah OR Houthis) (attack OR support OR threat)', cn: '国际', iso: 'UN', focus: '中东武装组织' },
  { q: '(troops OR "security forces") (rescue OR hostages OR kidnapped) (terrorists OR bandits OR militants)', cn: '国际', iso: 'UN', focus: '营救/清剿行动' },
  { q: '(infiltration OR infiltrate) (terrorists OR militants) border', cn: '国际', iso: 'UN', focus: '渗透活动' },
  /* 全球武装组织动态/战术能力专项（2026-08-13 用户指令：这类全球范围数据都要采，不局限于涉华要素） */
  { q: 'Taliban (drone OR drones OR UAV OR unmanned) (attack OR weaponize OR modify OR strike)', cn: '阿富汗', iso: 'AF', focus: '塔利班无人机武器化' },
  { q: '("commercial drone" OR "commercial drones" OR DJI OR quadcopter) (weaponized OR modified OR attack) (militant OR terrorist OR Taliban OR ISIS)', cn: '国际', iso: 'UN', focus: '商用无人机武器化扩散' },
  { q: '("Al-Qaeda" OR "Al Qaeda" OR ISIS OR "Islamic State") (drone OR UAV OR technology OR experts) (training OR development OR attack)', cn: '国际', iso: 'UN', focus: '恐怖组织技术能力' },
  { q: '(VBIED OR "car bomb" OR "vehicle-borne" OR SVBIED) (explosion OR blast OR attack OR seized)', cn: '国际', iso: 'UN', focus: '车载爆炸装置' },
  { q: '(Balochistan OR Quetta OR Gwadar OR Kech) (blast OR attack OR militants OR "security forces")', cn: '巴基斯坦', iso: 'PK', focus: '俾路支安全行动' },
  { q: '(suicide attack OR "suicide bomber" OR ambush OR "checkpoint attack") (police OR army OR "security forces" OR civilians)', cn: '国际', iso: 'UN', focus: '自杀式/伏击袭击' },
  { q: '(militants OR terrorists OR insurgents) (killed OR arrested OR neutralized) (operation OR raid OR clash)', cn: '国际', iso: 'UN', focus: '反恐清剿战果' },
  { q: '("UN report" OR "monitoring team" OR "sanctions committee") (Taliban OR "Al-Qaeda" OR ISIS OR terrorist)', cn: '国际', iso: 'UN', focus: '联合国涉恐报告' },
  /* 涉华关键矿产/外资合规专项 */
  { q: '("critical minerals" OR "rare earth" OR lithium OR cobalt OR nickel) (China OR Chinese OR "supply chain")', cn: '国际', iso: 'UN', focus: '涉华关键矿产' },
  /* 航道与走廊安全专项（2026-08-14 用户指令：海盗/航运通道/中欧班列专用主题词） */
  { q: '(piracy OR hijack OR "crew kidnapped" OR "vessel seized") (vessel OR ship OR tanker OR crew)', cn: '国际', iso: 'UN', focus: '海盗袭击/劫持商船' },
  { q: '("Red Sea" OR Hormuz OR "Bab el-Mandeb" OR "Gulf of Aden" OR Suez OR Malacca) (ship OR shipping OR vessel OR tanker OR attack OR drone)', cn: '国际', iso: 'UN', focus: '国际航运通道安全' },
  { q: '("China Railway Express" OR "China-Europe freight" OR "China-Europe Railway") (delay OR block OR suspend OR attack OR sanction OR border)', cn: '国际', iso: 'UN', focus: '中欧班列运行安全' },
  { q: '(Houthi OR "Red Sea") (shipping OR vessel OR tanker OR container) (attack OR strike OR threaten)', cn: '也门', iso: 'YE', focus: '红海航运威胁' },
  { q: '("foreign investment" OR FDI) (screening OR review OR CFIUS OR restriction OR ban) (China OR security)', cn: '国际', iso: 'UN', focus: '外资安全审查/合规' },
  { q: '(China OR Chinese) (mine OR mining OR port OR infrastructure) (deal OR investment OR control) (Africa OR Asia OR "Latin America")', cn: '国际', iso: 'UN', focus: '中资海外资产布局' },
  /* 涉华经贸安全专项（2026-08-13 用户点名：芯片管制/原材料限制/供应链这类必须采到） */
  { q: '(China OR Chinese) (chip OR chips OR semiconductor) (export control OR restriction OR ban OR curb OR sanction)', cn: '美国', iso: 'US', focus: '对华芯片管制' },
  { q: '(China OR Beijing) ("export curbs" OR "export controls" OR "export restrictions") ("rare earth" OR "raw materials" OR gallium OR germanium OR antimony OR graphite)', cn: '国际', iso: 'UN', focus: '中国关键原材料出口管制' },
  { q: '("supply chain" OR production) (halt OR disruption OR shortage OR shutdown) (China OR "rare earth" OR chips OR components)', cn: '国际', iso: 'UN', focus: '供应链中断' },
  { q: '(Trump OR "US officials" OR Congress OR Senate OR House) (China OR Chinese) (sanction OR curb OR ban OR restriction OR "export control")', cn: '美国', iso: 'US', focus: '美对华政策动向' },
  /* 美欧对华法案/制裁/海关封堵专项（2026-08-13 用户指令：立法/执法/合规全链条纳入） */
  { q: '(China OR Chinese) (act OR bill OR legislation OR "executive order" OR amendment) (Congress OR Senate OR House OR "European Parliament" OR EU)', cn: '美国', iso: 'US', focus: '美欧涉华法案' },
  { q: '(customs OR "border protection" OR CBP OR WRO OR "withhold release" OR UFLPA) (China OR Chinese OR Xinjiang) (detain OR seize OR block OR import ban)', cn: '美国', iso: 'US', focus: '海关对华封堵' },
  { q: '(EU OR "European Commission" OR Brussels) (China OR Chinese) (sanction OR tariff OR "anti-subsidy" OR "due diligence" OR investigation OR duties)', cn: '欧洲', iso: 'EU', focus: '欧盟对华经贸执法' },
  { q: '(compliance OR "entity list" OR blacklist OR "denied persons") (China OR Chinese) (company OR firms OR entities)', cn: '国际', iso: 'UN', focus: '涉华合规审查' },
  /* 非洲矿业资源管控专项（2026-08-13 用户指令：不一定涉华也要采） */
  { q: '(cobalt OR copper OR lithium OR gold OR mining) (Congo OR DRC OR Zambia OR Zimbabwe OR Namibia OR Guinea OR Mali OR Botswana OR Tanzania) (control OR nationaliz OR revoke OR tax OR royalty OR "export ban" OR audit OR review)', cn: '非洲', iso: 'AF', focus: '非洲矿业管控' },
  { q: '(mining OR minerals) (Africa OR African) (policy OR law OR regulation OR license OR local content OR beneficiation)', cn: '非洲', iso: 'AF', focus: '非洲矿业政策' },
  /* 非洲恐袭专项（补强） */
  { q: '(ISWAP OR "Islamic State" OR jihadist) (Nigeria OR "West Africa" OR Sahel) (attack OR killed OR ambush)', cn: '尼日利亚', iso: 'NG', focus: '西非圣战动态' },
  { q: '(Cabo Delgado OR Mozambique) (insurgent OR attack OR beheaded OR village)', cn: '莫桑比克', iso: 'MZ', focus: '德尔加杜角叛乱' },
  /* 涉华负面专项（2026-08-25 用户指令：涉华负面采集量太少——反华抗议/项目受阻/债务叙事/排华事件/抹黑指控 全链条） */
  { q: '(China OR Chinese OR BRI OR "Belt and Road") (protest OR backlash OR opposition OR "anti-China" OR demonstration) (project OR mine OR port OR dam OR investment)', cn: '国际', iso: 'UN', focus: '涉华项目抗议/反对' },
  { q: '("debt trap" OR "debt-trap" OR default OR "loan restructur") (China OR Chinese) (Africa OR Asia OR "Sri Lanka" OR Pakistan OR Zambia OR Laos)', cn: '国际', iso: 'UN', focus: '涉华债务陷阱叙事' },
  { q: '(Chinese OR China) (mine OR mining OR company OR factory OR project) (suspend OR halt OR revoke OR cancel OR "shut down" OR block) (government OR court OR regulator)', cn: '国际', iso: 'UN', focus: '中资项目受阻/被停' },
  { q: '(Chinese nationals OR Chinese workers OR Chinese community OR Chinatown) (attacked OR harassed OR targeted OR discriminat OR assault OR robbed OR killed)', cn: '国际', iso: 'UN', focus: '排华/针对华人事件' },
  { q: '(China OR Chinese) (spy OR espionage OR "influence operation" OR interference OR "police station") (accused OR alleged OR charged OR arrested OR investigation)', cn: '国际', iso: 'UN', focus: '涉华间谍/渗透指控' },
  { q: '(China OR Chinese OR Huawei OR TikTok OR "Chinese apps") (ban OR restrict OR "national security" OR probe OR investigation) (government OR parliament OR regulator)', cn: '国际', iso: 'UN', focus: '涉华科技封堵/国安审查' },
  { q: '(Uyghur OR Xinjiang OR "forced labor" OR "forced labour") (sanction OR ban OR import OR report OR investigation)', cn: '国际', iso: 'UN', focus: '涉疆抹黑/强迫劳动叙事' },
  { q: '("South China Sea" OR Taiwan OR "gray zone" OR "grey zone") (China OR Chinese) (aggression OR incursion OR provocation OR "dangerous" OR confront)', cn: '国际', iso: 'UN', focus: '南海台海涉华摩擦叙事' }
];

/** GDELT 主题检索采集：2天窗口 + 轮换查询词，持续产出新文章 URL
 * 2026-08-12 修正：GDELT 有全局 5.2s 节流，8+ 并行查询全部超 18s 返回空。
 * 改为**顺序执行**（尊重节流）：AP 检索为主（3-5s 稳定），AP 空再 GDELT 兜底（45s 超时）。 */
async function scrapeGdeltThemes(opts) {
  opts = opts || {};
  const queries = opts.queries || GDELT_THEME_QUERIES;
  const out = [];
  const seenUrl = new Set();
  for (const qs of queries) {
    let arts = [];
    /* 2026-08-25 漏采根因修复：AP 与 GDELT 双通道并行合并（下游按 URL 去重）。
     * 旧逻辑「AP 有结果则 GDELT 不开火」——AP 是美联社一家之声，对泛词组总能返回结果，
     * 导致覆盖 65 语种机器翻译的 GDELT 实际闲置，非洲小源涉华安全事件系统性漏采
     * （8-24 刚果金上加丹加中国公民遇袭绑架案，法语小站首发，AP 无报道）。 */
    const plainQ = String(qs.q).replace(/\bOR\b/g, ' ').replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim();
    const [apArts, gdArts] = await Promise.all([
      Promise.race([
        crawler.apSearch(plainQ, { maxrecords: 25, pages: 2 }),
        new Promise(resolve => setTimeout(() => resolve([]), 20000))
      ]).catch(() => []),
      Promise.race([
        crawler.gdeltSearch(qs.q, { timespan: '2d', maxrecords: opts.maxPerQuery || 15 }),
        new Promise(resolve => setTimeout(() => resolve([]), 45000))
      ]).catch(() => [])
    ]);
    arts = (apArts || []).concat(gdArts || []);
    for (const a of arts) {
      if (!a.url || seenUrl.has(a.url)) continue;
      const txt = String(a.title || '');
      if (!txt) continue;
      if (_isSoftJunk(txt)) continue;
      if (_isDomesticChina(txt)) continue;
      if (_CHINA_FOCUS_NOISE_RE.test(txt)) continue;
      const gate = scrapers.chinaOverseasGate(txt);
      /* 2026-08-13 用户指令：全球武装组织动态/战术能力类情报不设涉华门槛——
       * 真实安全事件（袭击/爆炸/武装冲突/清剿/无人机武器化）即使不涉华也直接放行；
       * 非安全事件仍须同时过相关性闸 + 海外利益闸 */
      var isSec = _isSecurityEvent(txt);
      /* 豁免白名单（2026-08-17）：战略通道/航运/涉华主体主题不过 indirect 闸 */
      var _exempt = /霍尔木兹|苏伊士|马六甲|巴拿马运河|曼德海峡|红海|直布罗陀|好望角|油轮|货轮|商船|航运|海运|航道|海峡|运河|海盗|亚丁湾|Hormuz|Suez|Malacca|Panama Canal|Bab el-Mandeb|Red Sea|Gibraltar|tanker|cargo ship|vessel|shipping|maritime|piracy|strait|canal|中资|中企|中方|华人|华侨|中国公民|使馆|领事|撤侨|一带一路|Chinese|China/i.test(txt);
      if (!isSec && !_exempt && (!gateRelevant(txt) || !gate.pass)) continue;
      seenUrl.add(a.url);
      const isChina = /中国|Chinese|China|Beijing|中资|中企|华人|一带一路|Taiwan|Hong Kong|Belt and Road/i.test(txt);
      const dims = ['E', 'F'];
      if (isChina) dims.push('A');
      const sc = scoreDimensions(txt, dims);
      out.push({
        title: txt, content: String(a.summary || a.description || '').replace(/<[^>]+>/g, '').slice(0, 500),
        url: a.url,
        country_cn: qs.cn, country_iso: qs.iso, dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
        credibility: _sourceCredibility(a.domain || ''), source: (a.domain || a.source || 'AP/GDELT') + '（主题检索）', category: '全球媒体情报', data_type: 'osint_intel',
        interestLinked: true, chinaRelated: isChina,
        language: a.language || 'en', publish_time: a.publishedAt || a.pubDate || _gdeltDate(a.seendate),
        _real: true, _fromSource: 'GTHEME:' + qs.iso,
        _sourceType: 'gdelt_theme'
      });
    }
  }
  return { count: out.length, items: out };
}

/** 抓取全部直连 RSS 真实媒体（并发分批），标注国家/维度，过相关性闸门 */
async function scrapeDirectRss(opts) {
  opts = opts || {};
  const out = [];
  const byCountry = {};
  const list = opts.sources || DIRECT_RSS;
  const concurrency = opts.concurrency || 8;
  const timeout = opts.timeout || 10000;

  const results = await _batchRun(list, async s => {
    let xml = '';
    try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
    const parsed = _parseRss(xml);
    const dims = _resolveDims(s);
    const tagged = [];
    for (const it of parsed) {
      const t = _tagRssItem(it, s, dims, 'RSS');
      if (t) tagged.push(t);
    }
    return { cn: s.cn, tagged };
  }, concurrency);

  results.forEach(r => {
    byCountry[r.cn] = (byCountry[r.cn] || []).concat(r.tagged);
    out.push.apply(out, r.tagged);
  });
  return { items: out, byCountry: byCountry, count: out.length };
}

/* 智库专项涉华/亚太焦点识别：智库文章多为政策分析，标题不一定含硬性安全事件词，
 * 但来源本身或标题/描述中若出现中国/亚太/一带一路/供应链等关键词，即具情报价值。 */
const _CHINA_FOCUS_RE = /中国|Chinese|China|Beijing|Shanghai|Xi Jinping|一带一路|Belt and Road|BRI|Asia|Asian|Indo-Pacific|亚太|中印|中日|中美|中欧|中非|中国-东盟|RMB|Yuan|BRICS|AIIB|Shanghai Cooperation|CPEC|Gwadar|Hambantota|Piraeus|Karakoram|Xinjiang|Uyghur|Hong Kong|Taiwan|Macau|南中国海|South China Sea|supply chain|trade|investment|infrastructure/i;
function _isChinaFocusThinkTankItem(it, s) {
  const name = String(s.name || '').toLowerCase();
  const focus = String(s.focus || '').toLowerCase();
  const txt = String(it.title || '') + ' ' + String(it.description || '');
  // 来源本身就是中国研究/亚太研究专门机构
  const chinaTank = /china|chinese|merics|asan|lowy|aspi|east asia|siis|ciis|cicir|jiia|nids|kida|iseas|rsis|pangoal|cf40|cass|think tank china|asia society|carnegie china|brookings china|chinapower/.test(name + ' ' + focus);
  if (chinaTank && /china|chinese|asia|asian|india|japan|korea|pacific|belt and road|bri|supply chain|trade|security|investment|infrastructure|geopolitic/i.test(txt)) return true;
  return _CHINA_FOCUS_RE.test(txt);
}

/** 抓取全球智库/研究机构 RSS，重点保留涉华/海外利益安全相关研究成果 */
async function scrapeThinkTanks(opts) {
  opts = opts || {};
  const out = [];
  const byCountry = {};
  const list = opts.sources || THINK_TANK_FEEDS;
  const concurrency = opts.concurrency || 8;
  const timeout = opts.timeout || 10000;

  const results = await _batchRun(list, async s => {
    let xml = '';
    try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
    const parsed = _parseRss(xml);
    const dims = _resolveDims(s);
    const tagged = [];
    for (const it of parsed) {
      const t = _tagRssItem(it, s, dims, 'THINK_TANK');
      if (t) {
        t.category = '智库研究情报';
        tagged.push(t);
      } else if (_isChinaFocusThinkTankItem(it, s) && scrapers.chinaOverseasGate(String(it.title || '') + ' ' + String(it.description || '')).pass) {
        // 智库专项放行：标题/描述含中国/亚太焦点，且过中国海外利益安全权威闸门
        const isChinaTank = /china|chinese|merics|asan|lowy|aspi|east asia|siis|ciis|cicir|jiia|nids|kida|iseas|rsis|pangoal|cf40|cass|asia society|carnegie china|brookings china|chinapower/.test(((s.name || '') + ' ' + (s.focus || '')).toLowerCase());
        const effectiveDims = (dims || []).slice();
        if (isChinaTank && effectiveDims.indexOf('A') < 0) effectiveDims.push('A');
        const sc = scoreDimensions(it.title, effectiveDims);
        tagged.push({
          title: it.title, content: it.description || '', url: it.link || s.url,
          country_cn: s.cn, country_iso: s.iso, dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
          source: s.name, credibility: _sourceCredibility(s.name), category: '智库研究情报', data_type: 'osint_intel',
          interestLinked: true, chinaRelated: isChinaTank,
          language: s.lang || '', publish_time: (it.pubDate || ''),
          _real: true, _fromSource: 'THINK_TANK:' + s.iso,
          _sourceType: s.type || 'think_tank'
        });
      }
    }
    return { cn: s.cn, tagged };
  }, concurrency);

  results.forEach(r => {
    byCountry[r.cn] = (byCountry[r.cn] || []).concat(r.tagged);
    out.push.apply(out, r.tagged);
  });

  /* ===== DIRECT_RSS 扫描补充：专项源质量/时效不稳定时，从已有国际媒体 RSS 中
   *  捞取涉华外交/经贸/安全/BRI 等信号，提高涉华指标稳定性。 ===== */
  try {
    const scanSources = (DIRECT_RSS || []).filter(s => s && s.url);
    const seenUrl = new Set(out.map(it => it.url).filter(Boolean));
    const scanResults = await _batchRun(scanSources.slice(0, 100), async s => {
      let xml = '';
      try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
      const parsed = _parseRss(xml);
      const dims = _resolveDims(s);
      const tagged = [];
      for (const it of parsed) {
        if (!_isRssFresh(it.pubDate)) continue;
        const txt = (it.title || '') + ' ' + (it.description || '');
        if (_CHINA_FOCUS_NOISE_RE.test(txt)) continue;
        if (!gateRelevant(txt)) continue;
        const gate = scrapers.chinaOverseasGate(txt);
        if (_isSoftJunk(txt)) continue;
        if (_isDomesticChina(txt)) continue;
        if (!_chinaFocusGate(txt, gate)) continue;
        const sc2 = scoreDimensions(it.title, dims);
        tagged.push({
          title: it.title, content: it.description || '', url: it.link || s.url,
          country_cn: s.cn, country_iso: s.iso, dims: sc2.dims, maxScore: sc2.maxScore, dimScores: sc2.scores,
          source: s.name, credibility: _sourceCredibility(s.name), category: '涉华专项情报', data_type: 'osint_intel',
          interestLinked: true, chinaRelated: true,
          language: s.lang || '', publish_time: (it.pubDate || ''),
          _real: true, _fromSource: 'CHINA_FOCUS:SCAN:' + s.iso,
          _sourceType: s.type || 'media'
        });
      }
      return { cn: s.cn, tagged };
    }, concurrency);
    for (const r of scanResults) {
      for (const it of r.tagged || []) {
        if (!it.url || seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        out.push(it);
        byCountry[it.country_cn] = (byCountry[it.country_cn] || []).concat([it]);
      }
    }
  } catch (e) { console.warn('[CHINA FOCUS] RSS 扫描补充异常:', e.message); }

  return { items: out, byCountry: byCountry, count: out.length };
}

/* 涉华专项采集噪声：排除纯国内社会/文化/娱乐/体育等弱相关条目 */
const _CHINA_FOCUS_NOISE_RE = /动漫|漫画|游戏|电竞|演唱会|音乐节|电影|票房|明星|网红|穿搭|美妆|护肤|健身|瑜伽|跑步|马拉松|骑行|钓鱼|摄影|影评|剧评|书评|美食|探店|旅游攻略|民宿|酒店|度假|综艺|选秀|八卦|绯闻|恋情|结婚|离婚|出轨|整容|减肥|养生|中医|食疗|保健品|宠物|猫|狗|萌宠|星座|塔罗|占卜|风水|命理|解梦|幽默|笑话|段子|萌|可爱|吐槽|八卦|爆料|吃瓜|流量|粉丝|点赞|转发|弹幕|cosplay|二次元|手办|盲盒|潮玩|球鞋|香水|口红|包包|穿搭|街拍|晒单|开箱|测评|种草|拔草|Vlog|短视频|直播带货|主播|带货|助农|乡村振兴|共同富裕|文明实践|道德模范|好人榜|助学金|奖学金|高考|中考|考研|公务员考试|国考|省考|网课|培训|辅导班|课外班|奥数|英语角|校园八卦|大学排名|论文发表|期刊影响因子|院士|教授|博导|长江学者|杰青|实验室|天文台|观测站|望远镜|卫星发射|载人航天|空间站|宇航员|探月|火星探测|深空探测|黑洞|引力波|暗物质|量子计算|ChatGPT|文心一言|通义千问|智谱|月之暗面|DeepSeek|字节跳动|腾讯游戏|王者荣耀|和平精英|原神|崩坏|星穹铁道|绝区零|米哈游|网易游戏|暴雪|Steam|Epic|显卡|CPU|主板|内存|固态硬盘|显示器|机械键盘|鼠标|耳机|数码评测|手机评测|汽车评测|anime|manga|gaming|esports|concert|film review|celebrity|influencer|fashion|beauty|skincare|fitness|yoga|marathon|cycling|foodie|travel guide|homestay|hotel|variety show|gossip|romance|wedding|divorce|plastic surgery|weight loss|wellness|TCM|pet|horoscope|tarot|feng shui|vlog|unboxing|review/i;

/** 涉华专项采集：高命中中文媒体 + 涉华外媒。
 *  优先走 gate 判定；对中国/港台源中含中国关键词且非文化娱乐噪声的条目额外放行，
 *  避免 Sixth Tone 等社会文化源 flooding 系统。 */
async function scrapeChinaFocus(opts) {
  opts = opts || {};
  const out = [];
  const byCountry = {};
  const list = opts.sources || CHINA_FOCUS_SOURCES;
  const concurrency = opts.concurrency || 8;
  const timeout = opts.timeout || 10000;
  const results = await _batchRun(list, async s => {
    let xml = '';
    try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
    const parsed = _parseRss(xml);
    const dims = _resolveDims(s);
    const tagged = [];
    for (const it of parsed) {
      if (!_isRssFresh(it.pubDate)) continue;
      const txt = (it.title || '') + ' ' + (it.description || '');
      const sc = scoreDimensions(it.title, dims);
      const base = {
        title: it.title, content: it.description || '', url: it.link || s.url,
        country_cn: s.cn, country_iso: s.iso, dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
        source: s.name, credibility: _sourceCredibility(s.name), category: '涉华专项情报', data_type: 'osint_intel',
        language: s.lang || '', publish_time: (it.pubDate || ''),
        _real: true, _fromSource: 'CHINA_FOCUS:' + s.iso,
        _sourceType: s.type || 'media'
      };
      // 必须通过中国海外利益安全权威闸门；对涉华专项源适当放宽，避免正常外交/经贸/BRI新闻被批量拦截
      const gate = scrapers.chinaOverseasGate(txt);
      if (gateRelevant(txt) && (gate.pass || _chinaFocusGate(txt, gate))) {
        tagged.push(Object.assign({}, base, { interestLinked: true, chinaRelated: true }));
      }
    }
    return { cn: s.cn, tagged };
  }, concurrency);
  results.forEach(r => {
    byCountry[r.cn] = (byCountry[r.cn] || []).concat(r.tagged);
    out.push.apply(out, r.tagged);
  });
  return { items: out, byCountry: byCountry, count: out.length };
}

/** 境外涉华负面专项采集：聚焦境外媒体/智库发布的涉华负面信号。
 *  命中条件：与我海外利益安全相关 + 涉华 + 负面关键词 + 过权威闸门。
 *  结果标记 _chinaNegative=true，不计入常规涉华计数，独立统计。 */
async function scrapeChinaNegative(opts) {
  opts = opts || {};
  const out = [];
  const byCountry = {};
  const list = opts.sources || CHINA_NEGATIVE_SOURCES;
  const concurrency = opts.concurrency || 8;
  const timeout = opts.timeout || 10000;
  if (!list.length) return { items: out, byCountry: byCountry, count: 0 };
  const debug = opts.debug || false;
  const results = await _batchRun(list, async s => {
    let xml = '';
    try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
    const parsed = _parseRss(xml);
    const dims = _resolveDims(s);
    const tagged = [];
    let stale = 0, noise = 0, notRelevant = 0, gateFail = 0;
    for (const it of parsed) {
      if (!_isRssFresh(it.pubDate)) { stale++; continue; }
      const txt = (it.title || '') + ' ' + (it.description || '');
      if (_CHINA_FOCUS_NOISE_RE.test(txt)) { noise++; continue; }
      if (!gateRelevant(txt)) { notRelevant++; continue; }
      const gate = scrapers.chinaOverseasGate(txt);
      if (!_chinaNegativeGate(txt, gate)) { gateFail++; continue; }
      const sc = scoreDimensions(it.title, dims);
      tagged.push({
        title: it.title, content: it.description || '', url: it.link || s.url,
        country_cn: s.cn, country_iso: s.iso, dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
        source: s.name, credibility: _sourceCredibility(s.name), category: '境外涉华负面情报', data_type: 'osint_intel',
        interestLinked: true, chinaRelated: true, sentiment: 'negative', _chinaNegative: true,
        language: s.lang || '', publish_time: (it.pubDate || ''),
        _real: true, _fromSource: 'CHINA_NEGATIVE:' + s.iso,
        _sourceType: 'china_negative'
      });
    }
    if (tagged.length > 0 || parsed.length > 0) {
      console.log('[CHINA NEGATIVE] ' + s.name + ' | items=' + parsed.length + ' hit=' + tagged.length + ' stale=' + stale + ' noise=' + noise + ' notRelevant=' + notRelevant + ' gateFail=' + gateFail);
    }
    return { cn: s.cn, tagged };
  }, concurrency);
  results.forEach(r => {
    byCountry[r.cn] = (byCountry[r.cn] || []).concat(r.tagged);
    out.push.apply(out, r.tagged);
  });

  /* ===== GDELT 补充通道：用全球新闻大数据检索涉华负面信号，提高日采集量 =====
   *  并行发起 3 个核心查询，避免顺序等待；整体设 18 秒超时兜底。 */
  try {
    const gdeltQueries = [
      '(China OR Chinese OR Beijing) (sanction OR boycott OR ban OR restriction OR tariff)',
      '(China OR Chinese) (attack OR protest OR raid OR violence OR kidnapped OR killed)',
      '(BRI OR "Belt and Road") (backlash OR protest OR debt OR risk OR delay)'
    ];
    const seenUrl = new Set(out.map(it => it.url).filter(Boolean));
    const gdeltResults = await Promise.all(gdeltQueries.map(q =>
      Promise.race([
        crawler.gdeltSearch(q, { timespan: '2d', maxrecords: 25 }),
        new Promise(resolve => setTimeout(() => resolve([]), 18000))
      ]).catch(() => [])
    ));
    for (const arts of gdeltResults) {
      for (const a of arts || []) {
        if (!a.url || seenUrl.has(a.url)) continue;
        const txt = (a.title || '');
        if (_CHINA_FOCUS_NOISE_RE.test(txt)) continue;
        if (!gateRelevant(txt)) continue;
        const gate = scrapers.chinaOverseasGate(txt);
        if (_isSoftJunk(txt)) continue;
        if (_isDomesticChina(txt)) continue;
        if (!_chinaNegativeGate(txt, gate)) continue;
        seenUrl.add(a.url);
        const cn = _isoToCn(a.sourcecountry || '');
        const countryDims = (_resolveDims({ iso: a.sourcecountry || 'INT', region: '' }) || []);
        const sc = scoreDimensions(txt, countryDims);
        const item = {
          title: a.title, content: '', url: a.url,
          country_cn: cn || '国际', country_iso: a.sourcecountry || 'INT', dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
          source: a.domain || 'GDELT', credibility: _sourceCredibility(a.domain || ''), category: '境外涉华负面情报', data_type: 'osint_intel',
          interestLinked: true, chinaRelated: true, sentiment: 'negative', _chinaNegative: true,
          language: a.language || 'en', publish_time: _gdeltDate(a.seendate),
          _real: true, _fromSource: 'CHINA_NEGATIVE:GDELT:' + (a.sourcecountry || 'INT'),
          _sourceType: 'china_negative'
        };
        out.push(item);
        byCountry[cn] = (byCountry[cn] || []).concat([item]);
      }
    }
  } catch (e) { console.warn('[CHINA NEGATIVE] GDELT 补充异常:', e.message); }

  /* ===== 全球直连 RSS 扫描补充：AP/GDELT 不稳定时，从已有高质量国际媒体 RSS 中
   *  捞取涉华负面信号。使用更宽松的 _chinaNegativeGate，确保制裁/冲突/出口管制
   *  等信号不被通用闸门误拦。 ===== */
  try {
    const scanSources = (DIRECT_RSS || []).concat(THINK_TANK_FEEDS || []).filter(s => s && s.url);
    const seenUrl = new Set(out.map(it => it.url).filter(Boolean));
    const scanResults = await _batchRun(scanSources.slice(0, 90), async s => {
      let xml = '';
      try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
      const parsed = _parseRss(xml);
      const dims = _resolveDims(s);
      const tagged = [];
      for (const it of parsed) {
        if (!_isRssFresh(it.pubDate)) continue;
        const txt = (it.title || '') + ' ' + (it.description || '');
        if (_CHINA_FOCUS_NOISE_RE.test(txt)) continue;
        if (!gateRelevant(txt)) continue;
        const gate = scrapers.chinaOverseasGate(txt);
        if (_isSoftJunk(txt)) continue;
        if (_isDomesticChina(txt)) continue;
        if (!_chinaNegativeGate(txt, gate)) continue;
        const sc2 = scoreDimensions(it.title, dims);
        tagged.push({
          title: it.title, content: it.description || '', url: it.link || s.url,
          country_cn: s.cn, country_iso: s.iso, dims: sc2.dims, maxScore: sc2.maxScore, dimScores: sc2.scores,
          source: s.name, credibility: _sourceCredibility(s.name), category: '境外涉华负面情报', data_type: 'osint_intel',
          interestLinked: true, chinaRelated: true, sentiment: 'negative', _chinaNegative: true,
          language: s.lang || '', publish_time: (it.pubDate || ''),
          _real: true, _fromSource: 'CHINA_NEGATIVE:SCAN:' + s.iso,
          _sourceType: 'china_negative'
        });
      }
      return { cn: s.cn, tagged };
    }, concurrency);
    for (const r of scanResults) {
      for (const it of r.tagged || []) {
        if (!it.url || seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        out.push(it);
        byCountry[it.country_cn] = (byCountry[it.country_cn] || []).concat([it]);
      }
    }
  } catch (e) { console.warn('[CHINA NEGATIVE] RSS 扫描补充异常:', e.message); }

  return { items: out, byCountry: byCountry, count: out.length };
}

module.exports = {
  scrapeGlobalMedia, scrapeCountry, scrapeDirectRss, scrapeThinkTanks, scrapeChinaFocus, scrapeChinaNegative, scrapeChannelWatch,
  scrapeGdeltThemes, GDELT_THEME_QUERIES,
  GLOBAL_COUNTRIES, DIRECT_RSS, THINK_TANK_FEEDS, CHINA_FOCUS_SOURCES, CHINA_NEGATIVE_SOURCES,
  scoreDimensions, gateRelevant, scoreOverseasInterest, DIM_SCORE, DIM_LABEL, _isoToCn, _resolveDims,
  CHINA_FOCUS_QUERIES: mediaFeeds.CHINA_FOCUS_QUERIES,
  CHINA_NEGATIVE_QUERIES: mediaFeeds.CHINA_NEGATIVE_QUERIES,
  _CHINA_NEGATIVE_KW_RE,
  chinaFocusGate: _chinaFocusGate,
  _isSoftJunk, _isSecurityEvent, _isDomesticChina, _sourceCredibility,
  chinaNegativeGate: _chinaNegativeGate,
  scrapeTerrorAttacks
};

/* ===== 全球恐怖袭击/武装袭击专项采集 =====
 * 覆盖高危国家：巴基斯坦、阿富汗、马里、尼日利亚、尼日尔、印度、刚果金、埃及、利比亚、索马里等
 * 所有数据流转到预警中心，按色彩预警：直接涉及中国要素=红色，高危国家=橙色，一般=黄色 */
const TERROR_HIGH_RISK_COUNTRIES = [
  { iso:'PAK', cn:'巴基斯坦', prio:1 },
  { iso:'AFG', cn:'阿富汗', prio:1 },
  { iso:'MLI', cn:'马里', prio:1 },
  { iso:'NGA', cn:'尼日利亚', prio:1 },
  { iso:'NER', cn:'尼日尔', prio:1 },
  { iso:'IND', cn:'印度', prio:2 },
  { iso:'COD', cn:'刚果(金)', prio:1 },
  { iso:'EGY', cn:'埃及', prio:2 },
  { iso:'LBY', cn:'利比亚', prio:1 },
  { iso:'SOM', cn:'索马里', prio:1 },
  { iso:'MMR', cn:'缅甸', prio:2 },
  { iso:'IRQ', cn:'伊拉克', prio:2 },
  { iso:'SYR', cn:'叙利亚', prio:2 },
  { iso:'YEM', cn:'也门', prio:2 },
  /* 非洲扩容（2026-08-13：非洲每日大量恐袭，此前覆盖不足） */
  { iso:'BFA', cn:'布基纳法索', prio:1 },
  { iso:'MOZ', cn:'莫桑比克', prio:1 },
  { iso:'CMR', cn:'喀麦隆', prio:2 },
  { iso:'CAF', cn:'中非', prio:2 },
  { iso:'KEN', cn:'肯尼亚', prio:2 },
  { iso:'SDN', cn:'苏丹', prio:1 },
  { iso:'TCD', cn:'乍得', prio:2 },
  { iso:'ETH', cn:'埃塞俄比亚', prio:2 }
];

const _TERROR_ATTACK_RE = /terror|terrorist|attack|kidnap|kidnapped|kidnapping|abduct|abducted|abduction|hostage|blast|explosion|bombing|suicide|armed|militant|insurgent|extremist|ISIS|ISIL|Taliban|Boko Haram|Al-Shabaab|Al-Qaeda|AQIM|Ansar|gunmen|shooting|massacre|ambush|raid|assault|ransom|暴力|袭击|恐袭|绑架|绑架案|劫持|劫持案|爆炸|枪击|武装|极端组织|塔利班|博科圣地|索马里青年党|基地组织|伊斯兰国|ISIS|恐怖袭击|自杀式|人质|伏击|突袭|屠杀|斩首|处决|赎金/i;

/* 绑架案专项正则（全球，不限中国要素） */
const _KIDNAP_RE = /kidnap|kidnapped|kidnapping|abduct|abducted|abduction|hostage|ransom|绑架|绑架案|劫持|劫持案|人质|赎金/i;

/* 涉及中国人的刑事案件正则 */
const _CHINA_CRIME_RE = /中国|Chinese|China|Beijing|中资|中企|华人|华侨|华裔|留学生|游客|公民|公民遇害|公民被绑|公民遭袭/i;

async function scrapeTerrorAttacks(opts) {
  opts = opts || {};
  const out = [];
  const byCountry = {};
  const list = TERROR_HIGH_RISK_COUNTRIES;
  const concurrency = opts.concurrency || 6;
  const timeout = opts.timeout || 10000;

  const results = await _batchRun(list, async c => {
    const tagged = [];
    /* 通道1：GDELT 检索该国恐怖袭击/武装袭击 */
    try {
      const queries = [
        'sourcecountry:' + c.iso + ' (terror OR attack OR kidnap OR blast OR explosion OR bombing OR militant OR insurgent)',
        'sourcecountry:' + c.iso + ' (armed OR gunmen OR shooting OR ambush OR raid OR assault)',
        'sourcecountry:' + c.iso + ' (ISIS OR Taliban OR "Boko Haram" OR "Al-Shabaab" OR "Al-Qaeda" OR extremist)'
      ];
      const gdeltRes = await Promise.all(queries.map(q =>
        Promise.race([
          crawler.gdeltSearch(q, { timespan: '2d', maxrecords: 15 }),
          new Promise(resolve => setTimeout(() => resolve([]), 15000))
        ]).catch(() => [])
      ));
      for (const arts of gdeltRes) {
        for (const a of arts || []) {
          if (!a.url) continue;
          const txt = (a.title || '');
          if (!_TERROR_ATTACK_RE.test(txt)) continue;
          /* 涉华要素判定 */
          const hasChina = /中国|Chinese|China|Beijing|中资|中企|华人|华侨|一带一路|Belt and Road|BRI/i.test(txt);
          /* 预警等级：直接涉及中国=红色，高危国家=橙色，一般=黄色 */
          let level = 'yellow';
          if (hasChina) level = 'red';
          else if (c.prio === 1) level = 'orange';
          tagged.push({
            title: a.title, content: '', url: a.url,
            country_cn: c.cn, country_iso: c.iso,
            source: a.domain || 'GDELT', credibility: _sourceCredibility(a.domain || ''), category: '恐怖袭击/武装袭击', data_type: 'terror_events',
            interestLinked: true, chinaRelated: hasChina, _terrorAttack: true,
            language: a.language || 'en', publish_time: _gdeltDate(a.seendate),
            level: level, /* 红色/橙色/黄色 */
            _real: true, _fromSource: 'TERROR:GDELT:' + c.iso,
            _sourceType: 'terror_attack'
          });
        }
      }
    } catch (e) { console.warn('[TERROR] GDELT 检索失败:', e.message); }

    /* 通道2：RSS 源扫描 */
    try {
      const rssSources = (DIRECT_RSS || []).filter(s => s.iso === c.iso);
      const rssResults = await _batchRun(rssSources, async s => {
        let xml = '';
        try { xml = await _fetchRss(s.url, timeout); } catch (e) { xml = ''; }
        const parsed = _parseRss(xml);
        const tagged2 = [];
        for (const it of parsed) {
          if (!_isRssFresh(it.pubDate)) continue;
          const txt = (it.title || '') + ' ' + (it.description || '');
          if (!_TERROR_ATTACK_RE.test(txt)) continue;
          const hasChina = /中国|Chinese|China|Beijing|中资|中企|华人|华侨|一带一路|Belt and Road|BRI/i.test(txt);
          let level = 'yellow';
          if (hasChina) level = 'red';
          else if (c.prio === 1) level = 'orange';
          tagged2.push({
            title: it.title, content: it.description || '', url: it.link || s.url,
            country_cn: c.cn, country_iso: c.iso,
            source: s.name, category: '恐怖袭击/武装袭击', data_type: 'terror_events',
            interestLinked: true, chinaRelated: hasChina, _terrorAttack: true,
            language: s.lang || 'en', publish_time: it.pubDate || '',
            level: level,
            _real: true, _fromSource: 'TERROR:RSS:' + c.iso,
            _sourceType: 'terror_attack'
          });
        }
        return tagged2;
      }, 3);
      rssResults.forEach(r => tagged.push.apply(tagged, r));
    } catch (e) { console.warn('[TERROR] RSS 扫描失败:', e.message); }

    /* 通道3：全球绑架案专项（不限中国要素，东南亚/非洲重点） */
    try {
      const KIDNAP_FOCUS = ['PHL','IDN','MYS','THA','VNM','MMR','KHM','LAO','NGA','MLI','NER','COD','SOM','KEN','ETH'];
      if (KIDNAP_FOCUS.includes(c.iso)) {
        const kidnapQueries = [
          'sourcecountry:' + c.iso + ' (kidnap OR kidnapped OR kidnapping OR abduct OR abducted OR abduction OR hostage OR ransom)'
        ];
        const kidnapRes = await Promise.all(kidnapQueries.map(q =>
          Promise.race([
            crawler.gdeltSearch(q, { timespan: '3d', maxrecords: 10 }),
            new Promise(resolve => setTimeout(() => resolve([]), 12000))
          ]).catch(() => [])
        ));
        for (const arts of kidnapRes) {
          for (const a of arts || []) {
            if (!a.url) continue;
            const txt = (a.title || '');
            if (!_KIDNAP_RE.test(txt)) continue;
            /* 涉华刑事案件判定 */
            const hasChinaCrime = _CHINA_CRIME_RE.test(txt);
            let level = 'yellow';
            if (hasChinaCrime) level = 'red';
            else if (c.prio === 1) level = 'orange';
            tagged.push({
              title: a.title, content: '', url: a.url,
              country_cn: c.cn, country_iso: c.iso,
              source: a.domain || 'GDELT', category: '绑架案/刑事案件', data_type: 'security_events',
              interestLinked: true, chinaRelated: hasChinaCrime, _kidnapCase: true,
              language: a.language || 'en', publish_time: _gdeltDate(a.seendate),
              level: level,
              _real: true, _fromSource: 'KIDNAP:GDELT:' + c.iso,
              _sourceType: 'kidnap_case'
            });
          }
        }
      }
    } catch (e) { console.warn('[KIDNAP] 绑架案检索失败:', e.message); }

    return { cn: c.cn, tagged };
  }, concurrency);

  results.forEach(r => {
    byCountry[r.cn] = (byCountry[r.cn] || []).concat(r.tagged);
    out.push.apply(out, r.tagged);
  });

  console.log('[TERROR] 完成: ' + out.length + ' 条恐怖袭击/武装袭击情报 | ' +
    '红色(涉华)=' + out.filter(function(i){return i.level==='red';}).length + ' | ' +
    '橙色(高危国)=' + out.filter(function(i){return i.level==='orange';}).length + ' | ' +
    '黄色(一般)=' + out.filter(function(i){return i.level==='yellow';}).length);

  return { items: out, byCountry: byCountry, count: out.length };
}
