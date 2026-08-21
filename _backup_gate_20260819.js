/* gate.js — 前端权威"中国海外利益安全"相关性网关
 * 与 server/scrapers.js 的 chinaOverseasGate 完全同源（常量 + 逻辑一致），
 * 作为客户端清洗历史脏数据 + 入库硬过滤的最后一道闸。
 * 平台定位：中国海外利益安全风险监测。仅保留与"中国海外利益安全"直接/间接相关的情报：
 *   · 直接关联：涉华/中资/公民、一带一路重大项目、海外能源资源、海上战略通道、海外侨民；
 *   · 间接关联：发生在重点利益国家且含安全/冲突/恐怖/制裁/海盗/能源/通道/重大灾害信号；
 * 剔除纯国内民生/政务/体育/娱乐噪声及与中国海外利益无关的泛泛外讯。 */
(function (root) {
  'use strict';

  // ===== 同源常量（与 server/scrapers.js 保持一致）=====
  var AK_CHINA_TERMS = ['中国','Chinese','China','中资','华人','华侨','中方','出海','驻外','使馆','一带一路','中企','国企','华裔','涉华','对华',"China's",'Beijing','Chinese companies','overseas Chinese','Taiwan','Hong Kong','Xinjiang','Tibet','台湾','香港'];
  var AK_NEG_TERMS = ['批评','指责','威胁','制裁','抵制','抗议','反对','抨击','警惕','风险','冲突','攻击','袭击','间谍','渗透','撤资','禁令','限制','打压','敌意','负面','逮捕','起诉','调查','排华','反华','芯片','关税','出口管制','技术封锁','diss','critic','sanction','threat','boycott','protest','spy','ban','risk','attack','assault','warns','crackdown','backlash','hostile','condemn','accuse','arrest','probe','sanctions','tariff','chip','export control','tech blockade'];
  var AK_OVERSEAS_MARKERS = ['海外','境外','驻外','中资','华人','华侨','华裔','中国公民','中方人员','中企','国企','出海','使馆','领事','撤侨','一带一路','中巴经济走廊','中老铁路','雅万高铁','中欧班列','蒙内铁路','亚吉铁路','坦赞铁路','瓜达尔','皎漂','汉班托塔','比雷埃夫斯','钱凯','维和','护航','驻在国','东道国','投资所在国','项目所在国','非洲','中东','南亚','东南亚','中亚','拉美','东欧','西欧','北欧','南欧','亚太','东盟','海湾','红海','马六甲','北极','南太平洋','南海','台海','东海','台湾','香港','Chinese','overseas','embassy','consulate','evacuat','belt and road','BRI','abroad','foreign','diaspora','Chinese company','Chinese national'];
  var AK_FOREIGN_COUNTRIES = ['阿富汗','巴基斯坦','印度','孟加拉','尼泊尔','斯里兰卡','不丹','缅甸','泰国','越南','老挝','柬埔寨','马来西亚','印尼','菲律宾','新加坡','文莱','哈萨克斯坦','乌兹别克','土库曼','吉尔吉斯','塔吉克','蒙古','朝鲜','韩国','日本','伊朗','伊拉克','叙利亚','沙特','阿联酋','卡塔尔','科威特','以色列','巴勒斯坦','约旦','黎巴嫩','土耳其','塞浦路斯','也门','阿曼','巴林','埃及','利比亚','阿尔及利亚','尼日利亚','安哥拉','刚果','苏丹','南苏丹','埃塞俄比亚','肯尼亚','坦桑尼亚','乌干达','莫桑比克','津巴布韦','南非','赞比亚','几内亚','马里','尼日尔','乍得','喀麦隆','加纳','塞内加尔','摩洛哥','突尼斯','俄罗斯','乌克兰','白俄罗斯','波兰','塞尔维亚','匈牙利','罗马尼亚','保加利亚','捷克','斯洛伐克','墨西哥','巴西','阿根廷','智利','秘鲁','哥伦比亚','委内瑞拉','古巴','厄瓜多尔','玻利维亚','哥斯达黎加','美国','加拿大','澳大利亚','新西兰','德国','法国','英国','意大利','西班牙','葡萄牙','荷兰','比利时','瑞士','瑞典','挪威','芬兰','丹麦','奥地利','希腊','Afghanistan','Pakistan','India','Bangladesh','Myanmar','Thailand','Vietnam','Malaysia','Indonesia','Philippines','Singapore','Kazakhstan','Iran','Iraq','Syria','Saudi','UAE','Israel','Palestine','Turkey','Yemen','Egypt','Libya','Nigeria','Angola','Russia','Ukraine','Mexico','Brazil','Argentina','America','Australia','Japan','Korea','Germany','France','Britain'];
  var AK_TOPIC_NOISE_RE = /table tennis|badminton|tennis match|football match|soccer|rugby|cricket|\bbok\b|volleyball|swimming|athletics|gymnastics|olympic|asian games|commonwealth games|world cup|gold medal|silver medal|bronze medal|mixed doubles|singles final|doubles final|qualifier|tournament|championship|premier league|\bnba\b|\bnfl\b|wimbledon|formula ?1|grand prix|cycling|marathon|boxing|wrestling|chess|esports|e-sports|concert|album release|grammy|oscar|emmy|box office|netflix|k-pop|pop star|reality show|乒乓球|羽毛球|网球|足球|篮球|排球|游泳|田径|体操|奥运|亚运|亚运会|世界杯|金牌|银牌|铜牌|混双|单打|双打|选手|运动员|教练|奖牌|领奖台|综艺|演唱会|专辑|歌手|明星|电影票房|选秀/;
  var AK_TOPIC_SECURITY_RE = /terror|attack|bomb|blast|kidnap|stampede|shooting|gunman|riot|Chinese?(?: citizen| national| company| vessel| embassy)|恐袭|袭击|爆炸|绑架|踩踏|骚乱|枪击|使馆|领事|撤侨|(?:华人|华侨).*(?:袭击|绑架|遇害|伤亡|威胁|风险)|(?:袭击|绑架|遇害|伤亡|威胁|风险).*(?:华人|华侨)/;
  /* 纯国内（台港）内部政务/选举/当局口号：无真实海外利益信号时属国内事务，非海外利益安全 */
  var AK_DOMESTIC_POLITICS_RE = /民进党|国民党|蔡英文|赖清德|台独|选举|立法院|宪政|全民防卫|当局|两岸|港独|反修例|立法会|候选人|选战|造势|就职|施政|统战|阵营|政党/;
  /* 真实海外利益安全信号：出现则视为与中国海外利益相关（台海军事/中资/撤侨/投资/项目等） */
  var AK_OVERSEAS_INTEREST_RE = /中资|中企|国企|华人|华侨|华裔|中国公民|中方人员|驻外|使馆|领事|撤侨|一带一路|中巴经济走廊|中老铁路|雅万高铁|中欧班列|蒙内铁路|亚吉铁路|坦赞铁路|瓜达尔|皎漂|汉班托塔|比雷埃夫斯|钱凯|维和|护航|台海|台湾海峡|海峡|军事|演习|军演|导弹|战区|商船|航运|港口|侨胞|台商|中(?:资|企|国)人|投资|工程|项目|工厂|矿山|海外利益|境外资产/;

  /* ===== 海外利益安全关联度评分（基于总体国家安全观官方定义） =====
   * 直接关联（A-E）：涉华/中资/公民、一带一路重大项目、能源资源、战略通道、海外侨民。
   * 间接关联（F-I）：重点国家安全事件、地区冲突/恐怖/制裁外溢、贸易通道、全球公卫/灾害。
   * 阈值 60：仅当得分≥60 才视为与我海外利益安全相关，杜绝泛泛外国新闻。 */
  var OI_DIM_KW = {
    A: ['中国','Chinese','China','中资','华人','华侨','中方','中企','国企','华裔','涉华','对华','北京','Beijing','overseas Chinese','Chinese company','Chinese national','Chinese workers','Chinese investment','Chinese embassy','Chinese consulate','Chinese ambassador','RMB','Yuan','BRICS','AIIB','Shanghai Cooperation','Xi Jinping','Hong Kong','Taiwan','Macau','Xinjiang'],
    B: ['中巴经济走廊','中老铁路','雅万高铁','中欧班列','蒙内铁路','亚吉铁路','坦赞铁路','瓜达尔','皎漂','汉班托塔','比雷埃夫斯','钱凯','Belt and Road','BRI','economic corridor'],
    C: ['石油','天然气','锂','钴','铜','稀土','矿产','能源','油气','煤炭','铁矿石','粮食','大豆','关键矿产','oil','gas','lithium','cobalt','copper','rare earth','energy','mining','iron ore','grain'],
    D: ['霍尔木兹','马六甲','苏伊士','红海','曼德','巴拿马','北极航道','台湾海峡','南海','Hormuz','Malacca','Suez','Red Sea','Panama Canal','Taiwan Strait','South China Sea'],
    E: ['中国公民','中方人员','华人','华侨','侨胞','台商','中国留学生','中国劳工','外派','援外','驻外','海外华人','Chinese tourist','Chinese student','diaspora'],
    F: ['巴基斯坦','Pakistan','Pakistani','阿富汗','Afghan','Afghanistan','缅甸','Myanmar','Burmese','尼日利亚','Nigeria','Nigerian','伊拉克','Iraq','Iraqi','叙利亚','Syria','Syrian','也门','Yemen','Yemeni','利比亚','Libya','Libyan','苏丹','Sudan','Sudanese','南苏丹','South Sudan','索马里','Somalia','Somalian','刚果','Congo','Congolese','马里','Mali','Malian','尼日尔','Niger','乍得','Chad','Chadian','乌克兰','Ukraine','Ukrainian','伊朗','Iran','Iranian','沙特','Saudi','Saudi Arabian','阿联酋','UAE','Emirati','土耳其','Turkey','Turkish','埃及','Egypt','Egyptian','埃塞俄比亚','Ethiopia','Ethiopian','肯尼亚','Kenya','Kenyan','坦桑尼亚','Tanzania','Tanzanian','赞比亚','Zambia','Zambian','安哥拉','Angola','Angolan','加纳','Ghana','Ghanaian','几内亚','Guinea','Guinean','津巴布韦','Zimbabwe','Zimbabwean','南非','South Africa','South African','俄罗斯','Russia','Russian','哈萨克斯坦','Kazakhstan','Kazakh','老挝','Laos','Lao','柬埔寨','Cambodia','Cambodian','越南','Vietnam','Vietnamese','泰国','Thailand','Thai','马来西亚','Malaysia','Malaysian','印尼','Indonesia','Indonesian','菲律宾','Philippines','Filipino','孟加拉','Bangladesh','Bangladeshi','斯里兰卡','Sri Lanka','Sri Lankan','巴西','Brazil','Brazilian','阿根廷','Argentina','Argentine','智利','Chile','Chilean','秘鲁','Peru','Peruvian','墨西哥','Mexico','Mexican','委内瑞拉','Venezuela','Venezuelan','厄瓜多尔','Ecuador','Ecuadorian','澳大利亚','Australia','Australian'],
    G: ['恐袭','恐怖主义','恐怖分子','袭击','袭击者','被袭','遭到袭击','绑架','被绑架','绑架者','爆炸','爆炸案','炸弹','冲突','武装冲突','战争','政变','骚乱','抗议','示威','罢工','制裁','封锁','禁运','海盗','劫持','叛乱','武装','极端组织','ISIS','塔利班','terror','terrorism','terrorist','terrorists','attack','attacks','attacked','attacking','kidnap','kidnaps','kidnapped','kidnapping','kidnappers','blast','blasts','blasted','bomb','bombs','bombed','bombing','bombings','conflict','conflicts','war','wars','warfare','coup','coups','riot','riots','rioting','protest','protests','protesters','protesting','demonstration','demonstrations','demonstrators','strike','strikes','striking','sanction','sanctions','sanctioned','blockade','blockades','embargo','embargoes','piracy','pirate','pirates','pirating','hijack','hijacks','hijacked','hijacking','insurgency','insurgent','insurgents','militant','militants','extremist','extremists','raid','raids','ambush','ambushes','shootout','shootouts','shooting','shootings','gunman','gunmen','clashes','uprising','rebellion','revolt','siege','hostage','hostages','massacre','massacres','assault','assaults','shelling','airstrike','airstrikes','killed','casualties','death','deaths','dead','wounded','injured'],
    H: ['港口','机场','铁路','运河','航运','贸易','供应链','中欧班列','货运','集装箱','航线','海运','logistics','supply chain','trade route','shipping','container'],
    I: ['疫情','传染病','瘟疫','大流行','地震','海啸','台风','洪水','飓风','火山','泥石流','干旱','饥荒','pandemic','epidemic','earthquake','tsunami','typhoon','flood','hurricane','volcano']
  };
  var OI_DIM_SCORE = { A:95, B:90, C:85, D:80, E:75, F:25, G:40, H:60, I:55 };
  /* 关键词匹配：中文/混排用子串；纯 ASCII 用单词边界，避免 BRI 命中 hybridi、war 命中 warning 等 */
  function _kwMatch(text, kw){
    if(!text || !kw) return false;
    if(/[^\x00-\x7F]/.test(kw)) return text.toLowerCase().indexOf(kw.toLowerCase()) >= 0;
    try{ return new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text); }
    catch(e){ return text.toLowerCase().indexOf(kw.toLowerCase()) >= 0; }
  }
  function _scoreOverseasInterest(text){
    if(!text) return { score:0, reasons:[] };
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

  function _akChinaRelated(text) {
    if (!text) return false;
    var low = text.toLowerCase();
    for (var i = 0; i < AK_CHINA_TERMS.length; i++) { if (low.indexOf(AK_CHINA_TERMS[i].toLowerCase()) >= 0) return true; }
    return false;
  }
  function _akChinaNegative(text) {
    if (!text) return false;
    if (!_akChinaRelated(text)) return false;
    var low = text.toLowerCase();
    for (var j = 0; j < AK_NEG_TERMS.length; j++) { if (low.indexOf(AK_NEG_TERMS[j].toLowerCase()) >= 0) return true; }
    /* 涉华安全事件（恐袭/袭击/爆炸/绑架/枪击/暴力/遇害/遇难等）即使无海外标记，也属海外利益安全负面信号 */
    if (AK_TOPIC_SECURITY_RE.test(text)) return true;
    return false;
  }
  function _akIsChinese(text) {
    if (!text) return false;
    return /[一-龥]/.test(text);
  }
  function _akHasOverseasMarker(text) {
    if (!text) return false;
    var low = text.toLowerCase();
    for (var i = 0; i < AK_OVERSEAS_MARKERS.length; i++) { if (low.indexOf(AK_OVERSEAS_MARKERS[i].toLowerCase()) >= 0) return true; }
    for (var j = 0; j < AK_FOREIGN_COUNTRIES.length; j++) { if (text.indexOf(AK_FOREIGN_COUNTRIES[j]) >= 0) return true; }
    return false;
  }
  /* 境内事发地识别（与 server/scrapers.js 同源）：事件发生在我境内 → 属国内治安/社会事务，
   * 不属"海外利益安全"。典型误判：'上海餐厅持刀伤人致2名日本公民受伤'（含外国国名但事发地在境内）。 */
  var AK_CN_MAINLAND_LOC_RE = /上海|北京|广州|深圳|天津|重庆|成都|武汉|西安|杭州|南京|苏州|青岛|大连|沈阳|哈尔滨|长沙|郑州|济南|合肥|福州|厦门|昆明|贵阳|南宁|海口|三亚|兰州|银川|西宁|乌鲁木齐|呼和浩特|石家庄|太原|长春|南昌|拉萨|广东|江苏|浙江|山东|河南|河北|湖南|湖北|四川|陕西|安徽|福建|江西|辽宁|吉林|黑龙江|山西|云南|贵州|广西|甘肃|青海|新疆|西藏|宁夏|内蒙古|海南|Shanghai|Beijing|Guangzhou|Shenzhen|Tianjin|Chongqing|Chengdu|Wuhan|Xi'?an|Hangzhou|Nanjing|Suzhou|Qingdao|Dalian|Shenyang|Harbin|Changsha|Zhengzhou|Jinan|Xiamen|Kunming|Urumqi|Lhasa|Guangdong|Zhejiang|Jiangsu|Shandong|Sichuan|Yunnan|Xinjiang|Tibet|Inner Mongolia/i;
  /* 强海外利益信号（不含"中国公民"等在境内同样成立的弱词；
   * "撤离/evacuat"必须与中资/华人/侨胞/使馆/海外项目等同时出现，防止国内灾害撤离被误判为海外撤侨） */
  var AK_STRONG_OVERSEAS_RE = /中资|中企|华人|华侨|侨胞|华裔|中国公民|中方人员|驻外|使馆|领事馆|领馆|撤侨|一带一路|中欧班列|维和|护航|海外利益|境外资产|海外项目|境外投资|外派|援外|中国工人|中国工程师|中国企业|中国公司|中国船员|中国游客在|在(?:非洲|中东|东南亚|南亚|中亚|拉美|欧洲|美洲|大洋洲)|embassy|consulate|Belt and Road|Chinese workers|Chinese engineers|Chinese nationals abroad|Chinese company|Chinese firm|Chinese-owned|Chinese contractor|Chinese mine|Chinese vessel|Chinese crew|peacekeep|南海|South China Sea|(?:中资|中企|华人|华侨|侨胞|使馆|领事|海外|境外).*?(?:撤离|evacuat|overseas|abroad)|(?:撤离|evacuat|overseas|abroad).*?(?:中资|中企|华人|华侨|侨胞|使馆|领事|海外|境外)/i;
  /* 境内事件逃逸信号：标题/首句已出现大陆地名时，必须命中这些明确的海外利益标记
   * 才不算国内事务。"中国公民/华人"等在境内同样成立，不能单独作为逃逸依据。
   * 例："上海餐馆持刀袭击致日本公民和中国公民受伤" → 仍属国内治安事件，拦截。 */
  var AK_DOMESTIC_ESCAPE_RE = /中资|中企|国企|驻外|使馆|领事馆|领馆|撤侨|一带一路|中欧班列|维和|护航|海外利益|境外资产|海外项目|境外投资|外派|援外|中国企业.*海外|中国公司.*海外|中国船员|中国游客在|在(?:非洲|中东|东南亚|南亚|中亚|拉美|欧洲|美洲|大洋洲)|embassy|consulate|Belt and Road|Chinese workers|Chinese engineers|Chinese company.*abroad|Chinese firm.*abroad|Chinese-owned|Chinese contractor|Chinese mine|Chinese vessel|Chinese crew|peacekeep|南海|South China Sea|(?:中资|中企|使馆|领事|海外|境外).*?(?:撤离|evacuat|overseas|abroad)|(?:撤离|evacuat|overseas|abroad).*?(?:中资|中企|使馆|领事|海外|境外)/i;
  /* 外国国名/地点提示：首句若同时出现境内地名+外国国名，说明事发地不在境内 */
  var AK_FOREIGN_HINT_RE = /巴基斯坦|阿富汗|印度|缅甸|老挝|柬埔寨|泰国|越南|印尼|马来西亚|菲律宾|新加坡|日本|韩国|朝鲜|俄罗斯|乌克兰|哈萨克|吉尔吉斯|塔吉克|乌兹别克|土库曼|蒙古|伊朗|伊拉克|以色列|沙特|阿联酋|卡塔尔|土耳其|埃及|苏丹|埃塞俄比亚|肯尼亚|尼日利亚|南非|刚果|赞比亚|坦桑尼亚|安哥拉|加纳|几内亚|马里|尼日尔|乍得|索马里|利比亚|阿尔及利亚|摩洛哥|美国|加拿大|墨西哥|巴西|阿根廷|智利|秘鲁|委内瑞拉|厄瓜多尔|英国|法国|德国|意大利|西班牙|荷兰|比利时|瑞士|瑞典|挪威|波兰|希腊|澳大利亚|新西兰|巴新|所罗门|斐济|Pakistan|Afghan|India|Myanmar|Laos|Cambodia|Thai|Vietnam|Indonesia|Malaysia|Philippine|Singapore|Japan|Korea|Russia|Ukraine|Kazakh|Kyrgyz|Tajik|Uzbek|Mongolia|Iran|Iraq|Israel|Saudi|Emirates|Qatar|Turkey|Egypt|Sudan|Ethiopia|Kenya|Nigeria|South Africa|Congo|Zambia|Tanzania|Angola|Ghana|Guinea|Mali|Niger|Chad|Somalia|Libya|Algeria|Morocco|United States|American|Canada|Mexico|Brazil|Argentina|Chile|Peru|Venezuela|Britain|British|France|French|Germany|German|Italy|Spain|Netherlands|Australia|New Zealand/i;
  function _akDomesticIncident(text) {
    if (!text) return false;
    /* 以标题/首句窗口判定事发地：强信号必须同样出现在标题/首句，
     * 否则正文里随手提到的"使馆/领事馆"（如外方驻华机构）会让境内事件误逃逸。
     * 修复"上海餐馆持刀袭击致日本公民受伤"类误判：境内发生、仅含外国国名
     *（多为受害者国籍）≠ 海外利益安全，必须命中明确的境外利益逃逸信号才放行。
     * "中国公民/华人"等在境内同样成立，不能作为逃逸依据。 */
    var head = String(text).slice(0, 240);
    if (!AK_CN_MAINLAND_LOC_RE.test(head)) return false;
    if (AK_DOMESTIC_ESCAPE_RE.test(head)) return false;
    return true;
  }
  function _isTopicNoise(text) {
    if (!text) return false;
    if (!AK_TOPIC_NOISE_RE.test(text.toLowerCase())) return false;
    /* 赛事/娱乐现场若出现真实安全事件（恐袭、爆炸、枪击、绑架、骚乱、人质、使馆遇袭、撤侨等）则放行；
     * 仅用 "blast" 等词形容批评/比赛强度（如 "critics blasted"）不构成真实安全事件，仍视为噪声。 */
    if (/terror|attack|bomb|shooting|gunman|kidnap|hostage|siege|stampede|riot|protesters?\s+(?:killed|shot|dead)|(?:killed|shot|dead)\s+in\s+(?:stadium|arena|attack)| embassy | consulate | evacuat|恐袭|袭击|爆炸|枪击|绑架|踩踏|骚乱|人质|劫持|围攻|使馆|领事|撤侨/i.test(text)) return false;
    return true;
  }
  /* 纯国内百科/教育/科技/论坛等垃圾（与海外利益安全无关） */
  var AK_DOMESTIC_JUNK_RE = /QQ邮箱|微信|支付宝|百度|淘宝|京东|拼多多|美团|抖音|快手|小红书|哔哩哔哩|B站|知乎|微博|天涯|猫扑|中华网|中新网|人民网|新华网|央视网|光明网|求是网|学习强国|七一|八一|建军节|国庆节|春节|中秋|端午|清明|扶贫|乡村振兴|美丽乡村|共同富裕|文明实践|道德模范|好人榜|助学金|奖学金|高考|中考|考研|公务员考试|国考|省考|职业资格|学历提升|在线教育|网课|培训|辅导班|课外班|奥数|英语角|校园|大学排名|科研进展|学术会议|论文发表|期刊影响因子|SCI|Nature|论文|专利|发明|创新大赛|科技奖|院士|教授|博导|青千|长江学者|杰青|实验室|研究所|天文台|观测站|望远镜|卫星发射|载人航天|空间站|宇航员|航天员|探月|火星探测|深空探测|伽马射线|黑洞|引力波|暗物质|量子计算|AI模型|大模型|ChatGPT|文心一言|通义千问|智谱|月之暗面|DeepSeek|字节跳动|腾讯游戏|王者荣耀|和平精英|原神|崩坏|星穹铁道|绝区零|米哈游|网易游戏|暴雪|Steam|Epic|游戏攻略|游戏评测|显卡|CPU|主板|内存|固态硬盘|显示器|机械键盘|鼠标|耳机|数码评测|手机评测|汽车评测|美食探店|旅游攻略|穿搭|美妆|护肤|健身|瑜伽|跑步|马拉松|骑行|钓鱼|摄影|影评|剧评|书评|音乐推荐|综艺推荐|动漫|漫画|小说|网文|网络文学|自媒体|短视频|直播带货|网红|主播|粉丝|点赞|转发|评论|弹幕|吃瓜|爆料|八卦|绯闻|恋情|结婚|离婚|出轨|整容|减肥|增肌|养生|中医|针灸|推拿|拔罐|艾灸|刮痧|食疗|保健品|减肥药|美白|祛痘|去皱|祛斑|植发|整形|医美|牙科|眼科|体检|疫苗|医保|社保|公积金|住房公积金|养老保险|失业保险|工伤保险|生育保险|五险一金|个税|房产税|契税|印花税|增值税|发票|报销|记账|理财|基金|股票|债券|期货|外汇|黄金|白银|原油|比特币|以太坊|数字货币|区块链|NFT|元宇宙|Web3|DeFi|AIGC|生成式AI|自动驾驶|无人驾驶|智能网联|新能源汽车|电动车|充电桩|换电站|电池|锂电池|钠电池|固态电池|氢能源|光伏|风电|核电|水电|火电|储能|特高压|智能电网|碳中和|碳达峰|ESG|绿色金融|可持续发展|循环经济|垃圾分类|环保|节能减排|污染防治|生态修复|植树造林|野生动物保护|自然保护区|国家公园|湿地|海洋保护|气候变化|全球变暖|极端天气|暴雨|洪涝|干旱|台风|地震|火山|泥石流|滑坡|森林火灾|草原火灾|沙尘暴|雾霾|空气污染|水污染|土壤污染|噪音污染|光污染|辐射污染|核污染|化学污染|重金属污染|白色污染|塑料污染|微塑料|电子垃圾|医疗废物|建筑垃圾|农业污染|养殖污染|工业污染|交通污染|船舶污染|航空污染|噪音投诉|环境污染|生态破坏|物种灭绝|生物多样性|基因编辑|克隆|干细胞|试管婴儿|代孕|安乐死|器官移植|血液透析|心脏支架|人工关节|假肢|助听器|眼镜|隐形眼镜|OK镜|种植牙|烤瓷牙|牙套|矫正|脱毛|纹身|穿刺|电子烟|烟草|酒精|毒品|赌博|色情|暴力|犯罪|诈骗|传销|非法集资|洗钱|贪污|腐败|行贿|受贿|滥用职权|玩忽职守|徇私枉法|刑讯逼供|非法拘禁|绑架|勒索|抢劫|盗窃|诈骗|盗窃|抢夺|故意毁坏财物|寻衅滋事|聚众斗殴|故意伤害|故意杀人|过失致人死亡|强奸|猥亵|性骚扰|拐卖|收买被拐卖的妇女儿童|强迫劳动|强迫交易|串通投标|合同诈骗|贷款诈骗|信用卡诈骗|保险诈骗|偷税漏税|虚开发票|假冒注册商标|销售假冒注册商标的商品|侵犯著作权|侵犯商业秘密|不正当竞争|垄断|价格欺诈|虚假广告|消费欺诈|产品质量问题|食品安全|药品安全|医疗器械|化妆品|保健食品|特殊医学用途配方食品|婴幼儿配方食品|食品添加剂|农药残留|兽药残留|重金属超标|微生物污染|转基因食品|有机食品|绿色食品|无公害食品|地理标志产品|老字号|非遗|传统工艺|民间艺术|民俗文化|地方戏曲|方言|民俗节日|庙会|灯会|龙舟|舞狮|秧歌|腰鼓|皮影|剪纸|泥塑|刺绣|陶瓷|玉雕|木雕|竹编|草编|漆器|珐琅|景泰蓝|苏绣|湘绣|蜀绣|粤绣|云锦|壮锦|土家织锦|蜡染|扎染|蓝印花布|年画|门神|春联|福字|窗花|灯笼|中国结|香包|荷包|香囊|荷包|肚兜|虎头鞋|虎头帽|百家衣|长命锁|银饰|玉器|瓷器|紫砂壶|文房四宝|笔墨纸砚|书法|国画|油画|水彩|版画|雕塑|装置艺术|行为艺术|摄影艺术|影像艺术|数字艺术|新媒体艺术|交互艺术|公共艺术|环境艺术|景观设计|室内设计|建筑设计|工业设计|平面设计|UI设计|UX设计|视觉传达|品牌设计|广告设计|包装设计|书籍设计|字体设计|标志设计|海报设计|插画|漫画|动画|游戏设计|影视特效|后期制作|剪辑|调色|配音|配乐|音效|音乐制作|录音|混音|母带|编曲|作曲|作词|演唱|演奏|指挥|乐团|合唱团|歌剧|舞剧|音乐剧|话剧|戏曲|曲艺|杂技|魔术|马戏|木偶戏|布袋戏|提线木偶|皮影戏|变脸|吐火|滚灯|踩高跷|舞龙|舞凤|麒麟舞|貔貅舞|鳌鱼舞|英歌舞|傩舞|萨满舞|巫舞|原始宗教|道教|佛教|伊斯兰教|基督教|天主教|东正教|犹太教|印度教|锡克教|耆那教|祆教|摩尼教|萨满教|原始信仰|民间信仰|祖先崇拜|自然崇拜|图腾崇拜|生殖崇拜|灵魂观念|鬼神观念|天命观念|天人感应|阴阳五行|八卦|易经|风水|命理|八字|紫微斗数|奇门遁甲|六壬|太乙|择日|相术|手相|面相|骨相|摸骨|测字|解梦|占星|塔罗|灵数|色彩心理学|性格测试|MBTI|九型人格|DISC|大五人格|霍兰德|职业兴趣|能力倾向|智力测试|情商测试|心理测评|心理咨询|心理治疗|精神分析|认知行为|人本主义|存在主义|格式塔|家庭治疗|团体治疗|沙盘|绘画治疗|音乐治疗|舞蹈治疗|戏剧治疗|叙事治疗|焦点解决|动机式访谈|正念|冥想|禅修|瑜伽|太极|气功|八段锦|五禽戏|易筋经|站桩|打坐|辟谷|断食|轻断食|生酮|低碳|素食|纯素|有机|天然|无添加|零添加|非转基因|草饲|谷饲|散养|野生|捕捞|养殖|种植|酿造|发酵|腌制|熏制|晒干|烘干|冷冻|冷藏|保鲜|冷链|物流|仓储|配送|快递|外卖|网约车|共享单车|共享汽车|共享充电宝|共享雨伞|共享办公|共享住宿|民宿|客栈|青年旅舍|酒店|宾馆|旅馆|招待所|度假村|别墅|公寓|写字楼|商铺|厂房|仓库|土地|房产|地产|楼盘|小区|社区|物业|业委会|居委会|街道办|派出所|税务局|工商局|质监局|食药监局|环保局|安监局|消防队|交警大队|车管所|公积金中心|社保局|医保局|人社局|民政局|教育局|卫健委|文旅局|体育局|农业农村局|林业局|水利局|气象局|地震局|测绘局|档案局|文物局|新闻出版局|广播电视局|网信办|工信部|发改委|财政部|商务部|外交部|国防部|公安部|国安部|司法部|最高法|最高检|全国人大|全国政协|国务院|党中央|中央军委|中央纪委|中央组织部|中央宣传部|中央统战部|中央政法委|中央台办|中央外办|中央财办|中央农办|中央编委|中央党校|国家行政学院|社会主义学院|行政学院|干部学院|纪检监察|巡视巡察|审计监督|统计监督|舆论监督|群众监督|民主监督|法律监督|检察监督|审判监督|人大监督|政协监督|社会监督|媒体监督|网络监督|信访举报|12345|市长热线|便民服务中心|政务服务中心|行政服务中心|市民之家|数据大厅|智慧城市|数字政府|电子政务|一网通办|跨省通办|就近办|马上办|一次办|不见面审批|告知承诺|容缺受理|并联审批|联合验收|多规合一|多审合一|多证合一|证照分离|先照后证|双随机一公开|信用监管|包容审慎|柔性执法|轻微免罚|首违不罚|无事不扰|有求必应|接诉即办|吹哨报到|街乡吹哨|部门报到|网格化|精细化|智能化|专业化|社会化|法治化|国际化|市场化|便利化|营商环境|放管服|简政放权|放管结合|优化服务|降本增效|减税降费|退税缓税|留抵退税|加计抵减|研发费用加计扣除|固定资产加速折旧|小微企业|个体工商户|民营企业|私营企业|股份制企业|有限责任公司|股份有限公司|国有企业|集体企业|联营企业|外商投资企业|中外合资企业|中外合作企业|外资企业|台港澳投资企业|个人独资企业|合伙企业|农民专业合作社|家庭农场|农业合作社|农村集体经济|乡镇企业|街道企业|村办企业|校办企业|军办企业|科研院所|高等院校|三甲医院|三级医院|二级医院|一级医院|社区卫生服务中心|乡镇卫生院|村卫生室|诊所|门诊部|急救中心|疾控中心|卫生监督所|妇幼保健院|儿童医院|精神卫生中心|康复医院|护理院|养老院|福利院|敬老院|托老所|日间照料中心|居家养老|社区养老|机构养老|医养结合|长期护理|安宁疗护|临终关怀|器官捐献|遗体捐献|造血干细胞|无偿献血|志愿服务|慈善捐赠|公益信托|社会企业|影响力投资|ESG投资|绿色债券|碳交易|排污权交易|用能权交易|水权交易|林权交易|矿权交易|海域使用权|无居民海岛|养殖用海|旅游用海|海底电缆|海上风电|海洋牧场|深远海养殖|极地考察|大洋科考|深海探测|深渊科学|海底观测|海洋碳汇|蓝碳|红树林|海草床|盐沼|珊瑚礁|贝类礁|滨海湿地|河口|海湾|海峡|半岛|岛屿|群岛|暗沙|浅滩|大陆架|专属经济区|领海|毗连区|公海|国际海底区域|南极|北极|青藏高原|黄土高原|内蒙古高原|云贵高原|四川盆地|塔里木盆地|准噶尔盆地|柴达木盆地|吐鲁番盆地|汉中盆地|关中平原|河套平原|宁夏平原|成都平原|长江中下游平原|华北平原|东北平原|松嫩平原|三江平原|辽河平原|珠江三角洲|长江三角洲|黄河三角洲|闽南三角洲|胶州湾|杭州湾|北部湾|渤海湾|辽东湾|莱州湾|海州湾|大亚湾|大鹏湾|深圳湾|维多利亚港|胶州湾|辽东半岛|山东半岛|雷州半岛|舟山群岛|南海诸岛|东沙群岛|西沙群岛|中沙群岛|南沙群岛|台湾岛|海南岛|崇明岛|鼓浪屿|刘公岛|普陀山|峨眉山|五台山|九华山|黄山|泰山|华山|衡山|恒山|嵩山|庐山|武夷山|雁荡山|普陀山|青城山|龙虎山|三清山|井冈山|长白山|天山|昆仑山|祁连山|阿尔泰山|横断山|喜马拉雅山|珠穆朗玛峰|乔戈里峰|贡嘎山|梅里雪山|南迦巴瓦峰|四姑娘山|武夷山|丹霞山|张家界|九寨沟|黄龙|喀纳斯|稻城亚丁|香格里拉|丽江古城|大理古城|平遥古城|徽州古城|阆中古城|凤凰古城|镇远古城|青岩古镇|周庄|同里|乌镇|西塘|南浔|朱家角|宏村|西递|婺源|土楼|吊脚楼|窑洞|四合院|徽派建筑|岭南建筑|闽南建筑|川西民居|江南园林|皇家园林|私家园林|寺庙园林|书院|祠堂|牌坊|石窟|摩崖石刻|壁画|雕塑|青铜器|甲骨文|简牍|帛书|敦煌文书|永乐大典|四库全书|古籍善本|碑帖拓片|金石篆刻|书画装裱|古籍修复|文物保护|考古发掘|遗址公园|国家宝藏|博物馆|美术馆|图书馆|文化馆|科技馆|纪念馆|展览馆|会展中心|大剧院|音乐厅|体育中心|游泳馆|健身房|羽毛球馆|乒乓球馆|篮球馆|网球馆|足球场|滑雪场|滑冰场|攀岩馆|射击馆|马术俱乐部|高尔夫球场|保龄球馆|台球厅|棋牌室|麻将馆|KTV|酒吧|夜店|迪厅|网吧|电竞馆|密室逃脱|剧本杀|狼人杀|桌游吧|VR体验|AR游戏|真人CS|卡丁车|蹦床公园| trampoline park|水上乐园|主题公园|动物园|植物园|海洋馆|科技馆|天文馆|自然博物馆|地质博物馆|军事博物馆|革命纪念馆|名人故居|历史街区|文化产业园|创意园区|艺术区|798|红砖厂|M50|田子坊|宽窄巷子|锦里|夫子庙|城隍庙|豫园|南锣鼓巷|什刹海|后海|三里屯|国贸CBD|金融街|中关村|张江|深圳湾|前海|横琴|南沙|雄安|滨海新区|两江新区|天府新区|湘江新区|赣江新区|哈尔滨新区|长春新区|贵安新区|西咸新区|滇中新区|福州新区|南京江北新区|杭州钱塘新区|宁波前湾新区|合肥滨湖新区|济南新旧动能转换起步区|郑州航空港区|武汉长江新区|长沙湘江新区|广州南沙新区|深圳前海新区|珠海横琴新区|东莞滨海湾新区|中山翠亨新区|佛山三龙湾新区|惠州潼湖生态智慧区|江门大广海湾经济区|肇庆新区|汕头华侨试验区|湛江省域副中心|茂名滨海新区|阳江海上风电产业基地|云浮新区|韶关新区|清远省级职教城|梅州综合保税区|河源深河特别合作区|汕尾新区|揭阳滨海新区|潮州新区|汕头保税区|珠海保税区|深圳保税区|广州保税区|东莞保税区|佛山保税区|中山保税区|江门保税区|惠州保税区|肇庆保税区|清远保税区|韶关保税区|河源保税区|梅州保税区|汕尾保税区|揭阳保税区|潮州保税区|云浮保税区/i;
  /* 涉华APP/技术/芯片禁令：属中国海外利益安全（中国企业出海受阻/技术封锁），优先放行 */
  var AK_CHINA_APP_BAN_RE = /对(?:华|中).*?(?:APP|应用|软件|芯片|技术|5G|华为|中兴|TikTok|WeChat|抖音|微信|禁止|禁令|下架|封禁|限制)|(?:APP|应用|软件|芯片|技术).*?(?:对华|涉华|中国).*?(?:禁止|禁令|下架|封禁|限制|制裁)|印度.*?(?:中国|中企|字节|华为|小米).*?(?:禁令|禁止|下架|封禁)|美国.*?涉华.*?芯片|芯片.*?对华/i;
  /* 纯国内百科/教育/科技/论坛/产品介绍/军事庆典噪声（与海外利益安全无关）；若同时命中强安全事件词则放行 */
  var AK_DOMESTIC_EDU_TECH_RE = /百度百科|知乎|问答|是什么|是什么意思|区别|有什么区别|介绍|产品|官网|官方网站|APP|应用软件|邮箱|电子邮箱|游戏|外挂|作弊|FPS|AI学习|直播|带货|网红|考研|高考|助学金|学校|学生|校园|天文|伽马射线|天鹅座|卫星|发射|载人航天|中继卫星|成像|纪录|破纪录|DeepSeek|技术变革|人力|回答数|获得赞同|题主|展示|聊一下|产业链|防御部署|打击策略|和平精英|腾讯游戏|保驾护航|举报|不良信息|版权所有|执行主编|京ICP|建军节|招待会|纪念|庆祝|通令|记功|国防和军队|高质量推进|总书记|中央军委|国防部举办|深化.*安全互信|中文安全|纪念解放军|成立周年|网络暴力|谣言|虚假有害|电话举报|举报信箱/;
  /* 文化/商业/历史/民俗/生活方式类噪声：与海外利益安全无关。
   * 若同时命中强安全事件/风险词（如"华人文化节遭恐袭"），由后续逻辑放行。 */
  var AK_CULTURE_BUSINESS_JUNK_RE = /潮汕|徽商|晋商|浙商|闽商|商帮|商业.*(?:道德|伦理|智慧|哲学|思维|模式)|契约精神|老字号|非遗|民俗文化|文化节|民俗节|庙会|灯会|龙舟|舞狮|秧歌|腰鼓|皮影|剪纸|泥塑|刺绣|陶瓷|玉雕|木雕|竹编|草编|漆器|珐琅|年画|门神|春联|窗花|中国结|香包|荷包|肚兜|虎头鞋|长命锁|文房四宝|书法|国画|油画|水彩|版画|雕塑|数字艺术|文化遗产|传统.*文化|民间.*艺术|地方.*戏曲|方言.*保护|乡土|乡愁|宗祠|祭祖|族谱|家谱|客家|闽南|粤语|川剧|京剧|昆曲|越剧|豫剧|黄梅戏|秦腔|评剧|粤剧|潮剧|梨园|戏曲|曲艺|相声|小品|脱口秀|纪录片.*中国|人文.*中国|中国.*人文|中国历史|中国古代|近代中国|中华文明|华夏文明|五千年|传统文化|国学|儒家|道家|佛家|禅宗|茶道|酒文化|饮食文化|服饰文化|建筑文化|园林|故宫|长城|兵马俑|敦煌|丝绸之路.*文化|大运河|非遗传承|手工艺|匠人|匠心|品牌故事|创业故事|企业家精神|白手起家|奋斗史|成长史|发家史|商业传奇|财富故事|股市传奇|投资哲学|理财.*技巧|消费.*心理|营销.*策略|管理.*智慧|领导力|团队.*建设|企业文化|商业模式|互联网.*思维|产品.*经理|运营.*干货|职场.*经验|求职.*技巧|面试.*攻略|简历.*模板|PPT.*技巧|Excel.*技巧|英语.*学习|小语种|考研.*经验|高考.*志愿|留学.*申请|移民.*攻略|签证.*攻略|旅游.*攻略|美食.*推荐|穿搭.*技巧|美妆.*教程|护肤.*知识|健身.*教程|瑜伽.*入门|跑步.*指南|马拉松.*训练|骑行.*路线|钓鱼.*技巧|摄影.*教程|影评.*推荐|剧评.*推荐|书评.*推荐|音乐.*推荐|综艺.*推荐|动漫.*推荐|漫画.*推荐|小说.*推荐|网文.*创作|自媒体.*运营|短视频.*创作|直播.*带货|网红.*经济|粉丝.*运营|吃瓜|爆料|八卦|绯闻|恋情|结婚|离婚|出轨|整容|减肥|增肌|养生|中医|针灸|推拿|拔罐|艾灸|刮痧|食疗|保健品|减肥药|美白|祛痘|去皱|祛斑|植发|整形|医美|牙科|眼科|体检|疫苗/i;
  /* 海外利益安全豁免清单（2026-08-17 用户指令：误杀即漏报，这类主题永不判 domestic-junk）：
   * 战略通道/航运/涉华企业与人员——即"海外利益"本体，优先级高于一切噪声词表 */
  var AK_OVERSEAS_INTEREST_EXEMPT_RE = /霍尔木兹|苏伊士|马六甲|巴拿马运河|曼德海峡|红海|直布罗陀|好望角|油轮|货轮|商船|航运|海运|航道|海峡|运河|海盗|亚丁湾|Hormuz|Suez|Malacca|Panama Canal|Bab el-Mandeb|Red Sea|Gibraltar|tanker|cargo ship|vessel|shipping|maritime|piracy|strait|canal|中资|中企|中方|华人|华侨|中国公民|使馆|领事|撤侨|一带一路|Chinese|China/i;
  function _isDomesticJunk(text) {
    if (!text) return false;
    if (AK_OVERSEAS_INTEREST_EXEMPT_RE.test(text)) return false; /* 先豁免：涉海外利益主题永不判垃圾 */
    if (AK_DOMESTIC_JUNK_RE.test(text)) return true;
    if (AK_CULTURE_BUSINESS_JUNK_RE.test(text)) return true;
    return false;
  }
  /* CPEC/俾路支热点（2026-08-18，与 server/scrapers.js 同源）：BLA/TTP/BLF 在俾路支省及中巴
   * 经济走廊沿线以中资项目/矿业/工程/营地为主要袭击目标。该语境下 矿业/项目/公司/营地 + 武装绑架
   * /袭击 即视为高度涉我海外利益——即便一手英文报道未点名"Chinese"（2026-08-12 沙盖 Chagai 铜矿
   * 7矿工被 BLA 绑架，Dawn 仅称 "private copper mining company"，无中国词 → 原判 indirect-no-china-link 漏报）。
   * 袭击词仅限武装/绑架/伏击等激进语境，剔除"瓦斯爆炸/矿难事故"类纯安全事故。 */
  var AK_CPEC_HOTSPOT_RE = /俾路支|balochistan|chagai|沙盖|瓜达尔|gwadar|quetta|奎达|中巴经济走廊|CPEC|开伯尔|khyber|gilgit|吉尔吉特|waziristan|瓦济里斯坦/i;
  var AK_CPEC_ASSET_RE = /矿|mine|mining|copper|gold|coal|project|company|firm|construction|engineer|worker|camp|port|power plant|dam|refinery|工程|项目|公司|企业|铜|金|煤|工人|工程师|营地|港口|电站/i;
  var AK_CPEC_ATTACK_RE = /绑架|劫持|袭击|武装袭击|武装分子|恐怖分子?|枪击|伏击|人质|枪手|自杀式|abduct\w*|kidnap\w*|attack\w*|gunmen|gunman|armed (?:men|attackers?|assailants?|militants?)|militant\w*|insurgent\w*|terror\w*|ambush|hostage|suicide (?:bomb|attack|blast)|IED/i;
  function _akCpecHotspot(text) {
    return !!(text && AK_CPEC_HOTSPOT_RE.test(text) && AK_CPEC_ASSET_RE.test(text) && AK_CPEC_ATTACK_RE.test(text));
  }
  /* 海外安全态势采集放宽（2026-08-18，与 server/scrapers.js 同源）：① 涉恐怖/极端武装/犯罪组织/黑帮
   * 的安全事件——不限国别采集；② 中国海外利益集中国家（重点国）的安全/冲突事件——一律采集。
   * 即便与中国无直接关联。两道均要求命中"安全事件"词，防纯评论/泛政治文混入。 */
  var AK_SEC_EVENT_RE = /恐怖袭击|爆炸|枪击|绑架|劫持|袭击|冲突|伏击|自杀式|汽车炸弹|武装|杀死|杀害|死亡|遇难|身亡|伤亡|政变|海盗|屠杀|terror|attack|blast|bomb|explos|shoot|shot|gunmen|gunman|gunfire|kill|dead|death|hostage|kidnap|abduct|clash|ambush|armed|suicide|car bomb|IED|coup|piracy|massacre|casualt|wound/i;
  var AK_TERROR_CRIME_ORG_RE = /恐怖组织|恐怖分子|恐怖主义|极端组织|极端分子|武装组织|武装分子|犯罪组织|有组织犯罪|黑帮|黑手党|贩毒集团|恐怖|伊斯兰国|基地组织|塔利班|博科圣地|青年党|胡塞|真主党|哈马斯|俾路支|叛乱|反叛军|叛军|雇佣兵|terror|militant|insurgent|jihad|extremist|ISIS|ISIL|Islamic State|al[- ]?Qaeda|Taliban|Boko Haram|Al[- ]?Shabaab|Shabaab|Houthi|Hezbollah|Hamas|ISWAP|cartel|mafia|gang|crime syndicate|armed group|rebel|mercenar/i;
  var AK_FOCUS_COUNTRY_RE = /俾路支|瓜达尔|巴基斯坦|哈萨克|乌兹别克|吉尔吉斯|塔吉克|土库曼|老挝|柬埔寨|缅甸|印度尼西亚|印尼|马来西亚|泰国|越南|塞尔维亚|匈牙利|希腊|埃塞俄比亚|肯尼亚|吉布提|埃及|斯里兰卡|孟加拉国|尼泊尔|沙特|阿联酋|土耳其|白俄罗斯|波兰|苏丹|刚果|尼日利亚|伊拉克|也门|马里|尼日尔|索马里|阿富汗|叙利亚|利比亚|中非|莫桑比克|坦桑尼亚|赞比亚|津巴布韦|安哥拉|摩洛哥|突尼斯|阿尔及利亚|约旦|黎巴嫩|伊朗|印度|菲律宾|哥伦比亚|秘鲁|墨西哥|南非|阿根廷|智利|委内瑞拉|蒙古|喀麦隆|乍得|南苏丹|Balochistan|Gwadar|Pakistan|Kazakhstan|Uzbekistan|Kyrgyzstan|Tajikistan|Turkmenistan|Laos|Cambodia|Myanmar|Indonesia|Malaysia|Thailand|Vietnam|Serbia|Hungary|Greece|Ethiopia|Kenya|Djibouti|Egypt|Sri Lanka|Bangladesh|Nepal|Saudi|UAE|Emirates|Turkey|Belarus|Poland|Sudan|Congo|DRC|Nigeria|Iraq|Yemen|Mali|Niger|Somalia|Afghanistan|Syria|Libya|Central African|Mozambique|Tanzania|Zambia|Zimbabwe|Angola|Morocco|Tunisia|Algeria|Jordan|Lebanon|Iran|India|Philippines|Colombia|Peru|Mexico|South Africa|Argentina|Chile|Venezuela|Mongolia|Cameroon|Chad|South Sudan/i;
  function chinaOverseasGate(text) {
    if (!text) return { pass: true, reason: 'empty' };
    if (_isDomesticJunk(text)) return { pass: false, reason: 'domestic-junk' };
    if (_isTopicNoise(text)) return { pass: false, reason: 'topic-noise' };
    /* 涉华APP/技术/芯片禁令：虽含技术词，但属中国海外利益安全（中国企业出海受阻/技术封锁），优先放行 */
    if (AK_CHINA_APP_BAN_RE.test(text)) return { pass: true, reason: 'china-tech-ban' };
    /* 纯国内百科/教育/科技/论坛/产品介绍/军事庆典噪声：与海外利益安全无关；
     * 若同时命中强安全事件词则放行。 */
    if (AK_DOMESTIC_EDU_TECH_RE.test(text) && !AK_TOPIC_SECURITY_RE.test(text)) {
      return { pass: false, reason: 'domestic-edu-tech-noise' };
    }
    /* 事发地在我境内且无强海外利益信号 → 国内事务，不入海外利益安全平台 */
    if (_akDomesticIncident(text)) return { pass: false, reason: 'china-domestic-incident' };
    /* CPEC/俾路支热点：矿业/项目/营地 + 武装绑架袭击 → 高度涉我海外利益，直接放行。
     * 置于涉华判定之前：一手英文报道常不点名"Chinese"，靠此规则兜住（2026-08-12 沙盖铜矿绑架）。 */
    if (_akCpecHotspot(text)) return { pass: true, reason: 'cpec-hotspot-china-interest' };
    /* 海外安全态势（2026-08-18）：① 涉恐怖/极端武装/犯罪组织/黑帮的安全事件——不限国别采集；
     * ② 中国海外利益集中国家（重点国）的安全/冲突事件——一律采集。即便与中国无直接关联。 */
    if (AK_SEC_EVENT_RE.test(text) && AK_TERROR_CRIME_ORG_RE.test(text)) return { pass: true, reason: 'global-terror-crime' };
    if (AK_SEC_EVENT_RE.test(text) && AK_FOCUS_COUNTRY_RE.test(text)) return { pass: true, reason: 'focus-country-security' };
    if (_akChinaRelated(text)) {
      /* 纯国内（台港）内部政务/选举/当局口号，且无真实海外利益信号 → 国内噪声，不入海外利益安全平台 */
      if (AK_DOMESTIC_POLITICS_RE.test(text) && !AK_OVERSEAS_INTEREST_RE.test(text)) {
        return { pass: false, reason: 'china-domestic' };
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
      /* 2026-08-13 经贸安全信号（与 server/scrapers.js 同源）：芯片/出口管制/关键原材料/供应链涉华直接放行 */
      var hasTradeStrong = /export control|export curb|export restriction|export ban|export licen|sanction|tariff|entity list|blacklist|investment (screening|review)|CFIUS|anti-dumping|countervailing|trade war|decoupl|blockade|embargo|制裁|关税|实体清单|反倾销|反补贴|贸易战|脱钩|断供|出口管制|出口限制|出口禁令|禁运/i.test(text);
      var hasTradeWeak = /chips?|chipmakers?|semiconductor|supply chain|rare earth|critical minerals?|raw materials?|subsid|芯片|半导体|供应链|稀土|关键矿产|原材料/i.test(text);
      var hasTradeRisk = /restrict|curb|ban|block|halt|stop|disrupt|shortage|fear|worr|threat|risk|concern|tension|shutdown|suspend|delay|cancel|limit|squeez|crunch|限制|中断|停摆|停产|停工|短缺|担忧|担心|威胁|风险|紧张|暂停|取消|推迟/i.test(text);
      var hasTradeEcon = hasTradeStrong || (hasTradeWeak && hasTradeRisk);
      var hasRisk = _akChinaNegative(text) || AK_TOPIC_SECURITY_RE.test(text) || /撤离|疏散|紧急撤离|evacuat/i.test(text);
      if (hasStrongOverseas && hasRisk) return { pass: true, reason: 'china-overseas-risk' };
      if (hasTradeEcon) return { pass: true, reason: 'china-trade-econ-security' };
      /* 涉华军品扩散风险（2026-08-13 用户点名：中国产无人机被塔利班/基地组织武器化这类必须采） */
      if (/中国|Chinese|China/i.test(text) && /无人机|武器|军火|导弹|弹药|改装|军备|weaponiz|drone|UAV|arms|munition/i.test(text) && /塔利班|基地组织|恐怖|武装分子|叛乱|雇佣兵|Taliban|Qaeda|ISIS|ISIL|militant|terror|insurgent|rebel|mercenar/i.test(text)) return { pass: true, reason:'china-arms-proliferation'};
      return { pass: false, reason: 'china-domestic' };
    }
    if (_akIsChinese(text)) {
      if (!_akHasOverseasMarker(text) && !AK_OVERSEAS_INTEREST_RE.test(text)) return { pass: false, reason: 'domestic-irrelevant' };
    }
    /* 非涉华外文内容：必须同时满足 ① 关联度评分≥60 且 ② 含涉华要素、强海外利益信号，
     * 或发生在核心/关键利益国且含安全/冲突/恐袭/制裁等战略外溢信号（F+G）。
     * 否则"坦桑尼亚清洁烹饪能源运动"等纯他国内政/民生新闻会借 F+C/D/H/I 组合误入。 */
    var sc = _scoreOverseasInterest(text);
    if (sc.score >= 60){
      var hasChinaLink = sc.reasons.indexOf('A') >= 0 || AK_STRONG_OVERSEAS_RE.test(text);
      var hasRiskSpillover = sc.reasons.indexOf('F') >= 0 && sc.reasons.indexOf('G') >= 0;
      if(hasChinaLink || hasRiskSpillover){
        return { pass: true, reason: 'indirect-overseas-interest:' + sc.reasons.join(',') };
      }
      /* 豁免：战略通道/航运/涉华主体即使没有直接涉华关联也放行（2026-08-17 用户指令） */
      if (typeof AK_OVERSEAS_INTEREST_EXEMPT_RE !== 'undefined' && AK_OVERSEAS_INTEREST_EXEMPT_RE.test(text)) return { pass: true, reason: 'exempt-interest' };
      return { pass: false, reason: 'indirect-no-china-link' };
    }
    if (typeof AK_OVERSEAS_INTEREST_EXEMPT_RE !== 'undefined' && AK_OVERSEAS_INTEREST_EXEMPT_RE.test(text)) return { pass: true, reason: 'exempt-interest' };
    return { pass: false, reason: 'foreign-irrelevant' };
  }

  /* 受保护记录：用户主动添加的 GEOINT 卫星影像、种子真实数据等，清洗时跳过 */
  function _isProtected(item) {
    if (!item || typeof item !== 'object') return false;
    if (item._geoint === true) return true;
    if (item.intel_type && String(item.intel_type).indexOf('GEOINT') >= 0) return true;
    if (item.source && /GEOINT|Sentinel|Maxar|Planet|卫星/.test(item.source)) return true;
    if (item.title && String(item.title).indexOf('【GEOINT】') === 0) return true;
    return false;
  }

  var GATE = {
    chinaOverseasGate: chinaOverseasGate,
    isOverseas: function (title, content) {
      if (_isProtected({ title: title, content: content, _geoint: false })) return true;
      return chinaOverseasGate((title || '') + ' ' + (content || '')).pass;
    },
    _isProtected: _isProtected
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GATE;
  if (root) root.GATE = GATE;
})(typeof window !== 'undefined' ? window : null);
