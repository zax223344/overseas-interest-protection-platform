/**
 * zh-polish.js — L1 中文译文抛光层（2026-08-29 翻译质量改造 #483）
 *
 * 依据：intel_data 近 7 天 800 条真实样本统计——英文残留 236 条(29.5%)、
 * 媒体自称/来源词残留 17 条、疑似病句 87 条。三类高频病症：
 *   ① 尾部垃圾："- THISDAYLIVE"、"-nhk.or.jp"、"- 每日信托"、"作者：娜娜·卡里卡里，高级全球事务记者"、
 *      "https：//www"（全角冒号 URL）、"@CapitalFM"、"上一篇："、emoji（🔴💧🇳🇪）
 *   ② 缩写不译：NIA / PIMS / NYSC / BLA / ISWAP / Kogi…
 *   ③ 硬译小错：半角分号、数字全角逗号("1，678")、"9 / 11"、"AK - 47"、HTML 实体残留(&#039;)
 *
 * 词表全部来自真实样本，禁止拍脑袋扩表（扩表须先跑样本统计验证频次）。
 * 挂点：server.js `_translateAny` 产出后（全链路译文必经）+ `_localizeTitleTail` 中文主体路径。
 *
 * 2026-09-02 翻译质量反馈修复（"译文没有中文阅读逻辑"）：
 *   ① "作者：" 剥离加位置锚定（仅标题场景，正文不截断）；
 *   ② URL 分策略：标题全删，正文只删 google/rss 跳转链、保留信息链接；
 *   ③ _stripMediaTail 混排守卫加严（主体须纯中文才剥英文尾）；
 *   ④ 媒体尾巴词表扩充（EL PAGES/Aaj/TRT/开放杂志/下午新闻尼日利亚 等实测残留）；
 *   ⑤ 军事术语纠正（MILITARY_CTX 守卫 + LABOR_GUARD 负向守卫，罢工→打击 等）；
 *   ⑥ HTML 实体补全（&nbsp;/&#x27;）+ 付费墙营销句/"阅读更多" 整句删除 + 直引号配对修复。
 */
'use strict';

/* ============ ① 缩写 → 中文全称（左右边界保护，避免误伤子串） ============ */
/* 键：缩写原文；值：中文全称。频次来源：800 条样本高频榜 + 历史病句样本 */
const ABBR = {
  /* 机构/组织 */
  'NIA': '国家调查局',            /* 印度 National Investigation Agency（样本 5 次，全部印度 terror_events） */
  'PIMS': '巴基斯坦医学科学研究所', /* 样本 5 次（伊斯兰堡医院火灾系列） */
  'NYSC': '尼日利亚国家青年服务团', /* 样本 5 次（科吉绑架系列） */
  'BLA': '俾路支解放军',
  'ISWAP': '“伊斯兰国”西非省',
  'ISI': '三军情报局',            /* 巴基斯坦情报机构 */
  'CPEC': '中巴经济走廊',
  'CCECC': '中国土木工程集团',
};

/* 人名（高频政要，机翻不译直接残留） */
const NAMES = {
  'Atiku': '阿提库',              /* 尼日利亚前副总统，样本 5 次 */
};

/* ============ ①b 权威人名词表（2026-09-02 用户指令：政要人名错译残留全系统根治）============
 * 根因实测：部分翻译通道对政要人名不译或半译——"Xi近平""国家主席Xi""Xi Jinping""Xi在/Xi与/和Xi"
 * 直接残留入库（intel_data.title 45 条、翻译缓存 507 条；缓存另有 Trump 103 / Putin 30 / Jinping 26 条）。
 * 设计铁律：
 *   ① 只作用于含中文的文本（纯英文未译标题不动，避免制造新的中英混排）；
 *   ② "Xi" 用上下文锚定替换，并以板球语境守卫兜底——缓存实测 "India vs Sri Lanka XI"（11 人代表队）
 *      8 条，若裸替换会把"斯里兰卡Xi队"错改成"斯里兰卡习近平队"；守卫命中时全部裸 Xi 规则跳过；
 *   ③ (?<!陈) 负向保护："国防部发言人陈Xi"（陈姓人名罗马化残留）不是习近平，绝不误替换；
 *   ④ 括号剥离/全名模式优先于姓氏兜底，防"唐纳德·特朗普（唐纳德·特朗普）"重复（收尾有同词去重规则）；
 *   ⑤ 规则幂等：替换结果不再含可匹配模式，可安全重跑。
 * 挂点：polish() 内（_translateAny 产出必经，title/content/digest 全路径）+ server.js _cacheGet 读时自愈
 * + server/_backfill_names.js 存量清洗（三处共用本词表，单一事实源）。 */

/* 板球语境守卫：命中即跳过全部裸 Xi 规则（比分/热身赛/三柱门等为板球报道特有词汇） */
const CRICKET_RE = /比分|直播|热身|练习赛|树桩|三柱门|击球|投球|板球|科隆博|检票员|巡边员|比赛|对阵|击败|Stumps|Warm-?up|Innings|\bODI\b|\bT20\b|\bSquad\b/i;

/* 无条件安全规则：括号原文剥离 + 其他政要全名/姓氏 + 窄域单字"习"规则 */
const NAME_FIX = [
  /* 先剥离"译名（原文）"括号（防替换后产生"唐纳德·特朗普（唐纳德·特朗普）"重复） */
  [/特朗普\s*（\s*Donald\s+Trump\s*）/g, '特朗普'],
  [/普京\s*（\s*Vladimir\s+Putin\s*）/g, '普京'],
  [/莫迪\s*（\s*Narendra\s+Modi\s*）/g, '莫迪'],
  [/拜登\s*（\s*Joe\s+Biden\s*）/g, '拜登'],
  [/马克龙\s*（\s*Emmanuel\s+Macron\s*）/g, '马克龙'],
  [/习近平\s*（\s*Xi\s+Jinping\s*）/g, '习近平'],
  [/金正恩\s*（\s*Kim\s+Jong\s+Un\s*）/g, '金正恩'],
  [/泽连斯基\s*（\s*Volodymyr\s+Zelensky\s*）/g, '泽连斯基'],
  /* "习、莫迪、普京将会晤"：单字"习"紧跟顿号且后接另一位政要 → 习近平（学习，等常用词不受影响） */
  [/习(?=[、，](?:莫迪|普京|拜登|特朗普|泽连斯基|金正恩|内塔尼亚胡))/g, '习近平'],
  /* 其他高频政要：全名优先，姓氏兜底（词边界防子串误伤） */
  [/Donald\s+Trump/g, '唐纳德·特朗普'],
  [/Vladimir\s+Putin/g, '弗拉基米尔·普京'],
  [/Narendra\s+Modi/g, '纳伦德拉·莫迪'],
  [/Joe\s+Biden/g, '乔·拜登'],
  [/Emmanuel\s+Macron/g, '埃马纽埃尔·马克龙'],
  [/Kim\s+Jong\s+Un/g, '金正恩'],
  [/Trump(?![A-Za-z0-9])/g, '特朗普'],
  [/Putin(?![A-Za-z0-9])/g, '普京'],
  [/Modi(?![A-Za-z0-9])/g, '莫迪'],
  [/Biden(?![A-Za-z0-9])/g, '拜登'],
  [/Macron(?![A-Za-z0-9])/g, '马克龙'],
  [/Zelensky(?![A-Za-z0-9])|Zelenskyy(?![A-Za-z0-9])/g, '泽连斯基'],
  [/Netanyahu(?![A-Za-z0-9])/g, '内塔尼亚胡'],
  [/Lavrov(?![A-Za-z0-9])/g, '拉夫罗夫'],
  [/Merkel(?![A-Za-z0-9])/g, '默克尔'],
];

/* 裸 Xi 上下文规则（板球语境守卫 + 陈姓负向保护下运行）：
 * 全名 → 混排"Xi近平" → 头衔在前 → 前置虚词（的/在/对/和…，Xi 紧跟单字虚词=人名用法）
 * → 动词/语境词在后 → 与特朗普配对 → 逗号后同位头衔 → 国别前缀 → 英文属格 */
const NAME_FIX_XI = [
  [/Xi\s*Jinping/gi, '习近平'],
  [/Xi近平/g, '习近平'],
  [/(国家主席|总书记|主席|领导人|总统)Xi(?![A-Za-z0-9])/g, '$1习近平'],
  [/([的一是对而和跟为到让称向同应与祝就也才又但及或并据实会邀迎接])Xi(?![A-Za-z0-9])/g, '$1习近平'],
  [/在Xi(?!和\s*[A-Z])(?![A-Za-z0-9])/g, '在习近平'],            /* "在Xi预计访问"修，"在Xi和Fergana"（地名配对）不修 */
  [/'?s\s*Xi(?![A-Za-z0-9])/g, '的习近平'],                       /* "中国's Xi arrives" 类混排属格 */
  [/Xi's(?=\s*[一-龥])/g, '习近平的'],                             /* "cast Xi's 埃及 visit" 属格+中文 */
  [/(?<!陈)Xi(主席|总书记|委员长|总理|访问|抵达|会晤|会见|承诺|表示|指出|呼吁|强调|签署|出席|主持|通话|致电|致贺|视察|慰问|敦促|提出|宣布|欢迎|离开|解雇|启程|开始|出访|撰文|信号|发表|峰会|邀请|结束|乘坐|同意|设置|十年|即将|将|应|在|对|与|的|说|告诉|认为|感到|要求|计划|纪念|聚焦|似乎|此|自|政府|很|预计|拒绝|否认|警告|批评|祝贺)/g, '习近平$1'],
  [/Xi和(?=[一-龥]|Kim|Trump|Putin|Modi|Biden|Macron|金正恩|普京|特朗普)/g, '习近平和'], /* "Xi和Fergana"地名除外 */
  [/Xi(?=\s*[-–—~]\s*(?:特朗普|Trump))/g, '习近平'],              /* "Xi-特朗普峰会" */
  [/Xi(?=[，,][一-龥]{0,6}国家主席)/g, '习近平'],                  /* "Xi，中国国家主席"同位语 */
  [/中国Xi(?![A-Za-z0-9])/g, '中国领导人习近平'],
  /* 中英混排句式：Xi 后跟空格+英文谓语动词（"Xi says 中国…" / "President Xi welcomed by…" /
   * "Xi to Make First 埃及 Trip"）。lookahead 限定动词词表，"Xinhua"（Xi 后紧跟字母）不会命中 */
  [/Xi(?=\s+(?:says|said|calls?|called|arrives?|arrived|leaves?|left|signals?|signalled|kicks?|kicked|holds?|held|welcomes?|welcomed|meets?|met|urges?|urged|pledges?|pledged|vows?|vowed|warns?|warned|tells?|told|makes?|made|visits?|visited|attends?|attended|thanks?|thanked|hosts?|hosted|sends?|sent|receives?|received|launches?|launched|signs?|signed|addresses?|addressed|invites?|invited|begins?|began|starts?|started|ends?|ended|joins?|joined|set|to|is|was|will|has|had)\b)/g, '习近平'],
  /* 领导人列举："普京，Xi，佩泽什基安参加…"——Xi 后逗号（中/英文）紧跟另一位政要 */
  [/Xi(?=\s*[，,]\s*(?:Pezeshkian|Putin|Modi|Trump|Kim|Biden|Macron|Lavrov|佩泽什基安|普京|特朗普|莫迪|金正恩|拜登|马克龙|拉夫罗夫))/g, '习近平'],
  /* 谐音错译兜底："思思呼吁在习近平访问之前"——紧跟"呼吁在习近平"的极窄窗口，普通昵称"思思"不误伤 */
  [/思思(?=呼吁在习近平)/g, '习近平'],
];

/* 人名修正：只作用于含中文的文本（纯英文未译文本原样返回），供 polish() 与存量清洗/缓存自愈共用 */
function fixNames(t) {
  let s = String(t || '');
  if (!s || !/[\u4e00-\u9fa5]/.test(s)) return s;
  for (const rule of NAME_FIX) s = s.replace(rule[0], rule[1]);
  if (!CRICKET_RE.test(s)) {                 /* 板球报道中 "XI"=11 人队，跳过全部裸 Xi 规则 */
    for (const rule of NAME_FIX_XI) s = s.replace(rule[0], rule[1]);
  }
  /* 收尾去重："X（X）"同词括号回声（多规则叠加偶发） */
  s = s.replace(/([一-龥·]{2,6})（\s*\1\s*）/g, '$1');
  return s;
}

/* ============ ② 媒体自称词表（尾部剥离用） ============ */
/* 英文媒体名/域名：尾部命中即剥离（大小写不敏感）。
 * 2026-09-02 扩充（用户反馈：库里大量标题残留媒体尾巴），词表来自库内实测残留：
 * "- EL PAGES 英语"、"- Aaj English TV"、"- realcleardefense.com"、"- Dunya新闻"、"- TRT" 等 */
const MEDIA_EN = [
  'THISDAYLIVE', 'Devdiscourse', 'Newswire', 'africanews', 'Africanews',
  'CapitalFM', 'Capital FM', 'DAILY POST', 'Daily Trust', 'Vanguard', 'Punch',
  'Premium Times', 'The Cable', 'Channels TV', 'Arise TV', 'TVC News',
  'BBC', 'CNN', 'Reuters', 'Al Jazeera', 'Bloomberg', 'DW', 'Al Arabiya',
  'TRT', 'TRT World', 'Aaj English TV', 'Aaj News', 'EL PAGES',
  'Dunya News', 'Dunya', 'Realcleardefense', 'RealClearPolitics', 'PM News',
  'The Point NG', 'Asharq Al-Awsat',
];
/* 域名尾巴（正则片段）：-nhk.or.jp / -tgnews.com.ng / -vijesti.me 等 */
const DOMAIN_TAIL = '(?:\\.[a-z]{2,4}){1,2}';

/* 中文媒体名（机翻后仍残留的）：尾部命中即剥离。
 * 2026-09-02 扩充："-开放杂志"（Open Magazine）、"-下午新闻尼日利亚"（PM News Nigeria 整词被机翻）、
 * "-频道电视"（Channels Television）、"-魔术师" 等实测残尾。只剥标题尾部，正文来源信息不经过本表。 */
const MEDIA_ZH = [
  '每日信托', '纽约时报', '卫报尼日利亚新闻', '克什米尔自由新闻', '首尔经济日报',
  '印度斯坦时报', '布宜诺斯艾利斯时报', '艾雷德尔免费新闻', '新德里电视台',
  '印度新闻', '印度快报', '论坛报', '黎明报', '美联社新闻', '路透社新闻',
  '开放杂志', '下午新闻尼日利亚', '频道电视', '魔术师', '德国之声', '半岛电视台',
  '今日俄罗斯', '独立报', '电讯报', '国家报', '每日新闻',
];

/* ============ ③ 硬译小错修正（无上下文安全的才入表） ============ */
const PUNCT_FIX = [
  [/(\d)，(\d)/g, '$1,$2'],            /* "1，678" → "1,678" 数字间全角逗号 */
  [/\b9\s*\/\s*11\b/g, '9·11'],        /* "9 / 11恐怖袭击" → "9·11" */
  [/AK\s*-\s*47/gi, 'AK-47'],          /* "AK - 47步枪" → "AK-47" */
  [/;/g, '；'],                         /* 半角分号 → 全角 */
  [/，{2,}/g, '，'],                    /* 重复逗号 */
  [/。{2,}/g, '。'],
  [/\s{2,}/g, ' '],                    /* 多余空格压一 */
];

/* HTML 实体残留（Google News desc 路径偶发漏网）。
 * 2026-09-02 扩充：&nbsp;（译成 U+00A0 老残留）、&#x27; 十六进制变体、弯引号/省略号等印刷实体 */
const ENTITY_FIX = [
  [/&nbsp;/gi, ' '],
  [/&#0?39;|&#x27;|&apos;/gi, "'"],
  [/&quot;/gi, '"'],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&ldquo;/gi, '“'], [/&rdquo;/gi, '”'],
  [/&lsquo;/gi, '‘'], [/&rsquo;/gi, '’'],
  [/&hellip;/gi, '…'], [/&mdash;/gi, '—'], [/&ndash;/gi, '–'],
  [/&#(\d+);/g, (m, d) => { try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return ''; } }],
  [/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return ''; } }],
];

/* ============ ⑤ 军事术语纠正（2026-09-02：军事语境误译会致命）============
 * 根因：机翻通道把 military strike 统一误译成"罢工"（"美国罢工在婚礼上杀死4人"应为"美国打击"）、
 * explosion rocks 的 rock 译成"岩石"、convoy 译成"护航"等。设计铁律：
 *   ① 全局守卫：仅当文本含军事上下文关键词（MILITARY_CTX）才启用整组纠正——工人罢工是合法语义，
 *      没有军事上下文时绝不纠正；
 *   ② 负向守卫：文本含劳资语境词（LABOR_GUARD：工会/工人/加薪/总罢工…）时跳过"罢工"类纠正，
 *      防止"以色列全国大罢工"这类真实劳工新闻被误改；
 *   ③ 具体短语规则排在泛化"罢工"规则之前；规则幂等，可安全重跑；
 *   ④ 挂点：polish() 末尾（title/content 全路径必经）。 */
const MILITARY_CTX = /空袭|导弹|无人机|油轮|军舰|伤亡|死亡|军方|袭击|战争|以色列|伊朗|加沙|胡塞|部队|士兵|美伊|军事|爆炸|炮击|武装|战机|恐袭|海军|陆军|空军|特种部队|停火|报复|前线|阵地|杀死|打死|炸死|击毙|遇难|身亡/;
const LABOR_GUARD = /工会|工人|加薪|薪资|工资|劳资|雇员|裁员|待遇|职工|雇工|抗议|游行|示威|总罢工|大罢工|全国罢工|集体罢工|罢工潮|举行罢工|发动罢工|威胁罢工|投票罢工|罢工要求|员工|司机|护士|教师|矿工|清洁工|建筑工|公务员|渔民|农民/;
const MILITARY_FIX = [
  /* —— 具体短语错译（先于泛化"罢工"规则）—— */
  [/对美国罢工的支持/g, '对美国打击行动的声援'],
  [/无人机罢工/g, '无人机打击'],                 /* drone strike */
  [/爆炸岩石/g, '爆炸震撼'],                     /* explosion rocks */
  /* convoy（车队）误译为"护航"：military convoy = 护卫车队，袭击对象是"车队" */
  [/([一-龥])护航(?=的袭击|遭到袭击|遭袭|遇袭|被袭|目标)/g, '$1车队'],
  [/袭击了([一-龥]{0,6})护航/g, '袭击了$1车队'],
  /* offensive（攻势）误译为"冒犯" */
  [/军事冒犯/g, '军事攻势'],
  [/发动(了)?冒犯/g, '发动$1攻势'],
  /* Islamic Revolutionary Guard Corps 的 guard 误译为"守卫" */
  [/革命守卫(队)?/g, '革命卫队'],
  /* military theater（战区）误译为"剧院" */
  [/(?:战争|军事)剧院/g, '战区'],
  /* targeted killing 误译为"有针对性的杀戮" */
  [/有针对性的杀戮/g, '定点清除'],
  /* tanker（油罐车）误译为"坦克" */
  [/坦克卡车/g, '油罐车'],
  [/坦克(司机|驾驶员)/g, '油罐车$1'],
  /* —— 泛化规则放最后：military strike → "罢工"（LABOR_GUARD 负向守卫）—— */
  [/罢工/g, '打击'],
];

function fixMilitary(t) {
  if (!MILITARY_CTX.test(t)) return t;        /* 无军事上下文，绝不纠正 */
  const labor = LABOR_GUARD.test(t);          /* 劳资语境：罢工是合法语义 */
  let s = t;
  for (const [re, to] of MILITARY_FIX) {
    if (labor && re.source === '罢工') continue;
    s = s.replace(re, to);
  }
  return s;
}

/* ============ 抛光主函数 ============ */

/* 剥离标题尾部媒体名/来源残留。只动尾部，且要求剥离后主体仍够长（防误剥正常内容） */
function _stripMediaTail(t) {
  let out = String(t || '').trim();
  for (let round = 0; round < 3; round++) {         /* 最多剥 3 层（"-印度新闻-印度斯坦时报" 双层） */
    const before = out;
    /* 尾部 "- 英文媒体名"（词表限定） */
    for (const m of MEDIA_EN) {
      const re = new RegExp('[\\s\\-–—|｜]{1,3}' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
      out = out.replace(re, '').trim();
    }
    /* 尾部 "- 域名"（-nhk.or.jp / -tgnews.com.ng / - thisdaylive.com） */
    out = out.replace(new RegExp('[\\s\\-–—|｜]{1,3}[A-Za-z0-9][A-Za-z0-9.\\-]*' + DOMAIN_TAIL + '\\s*$', 'i'), '').trim();
    /* 尾部 "- 中文媒体名"（词表限定，最长优先已在表内排序时无关——replace 单点命中） */
    for (const m of MEDIA_ZH) {
      const re = new RegExp('[\\s\\-–—|｜]{1,3}' + m + '\\s*$');
      out = out.replace(re, '').trim();
    }
    /* 尾部 "- 中文媒体名 . com"（"- 自然新闻 . com" 类机翻媒体+域名） */
    out = out.replace(/[\s\-–—|｜]{1,3}[一-龥]{2,8}\s*\.\s*(?:com|net|org|news|live|tv)\s*$/i, '').trim();
    /* 尾部 "- 拉丁词+机翻媒体后缀"（"- Dunya新闻"、"- Aaj电视"、"- EL英语" 类混排残尾）：
     * 前段是拉丁词、后段是"新闻/时报/电视/英语"等媒体型后缀，整段剥离 */
    out = out.replace(/[\s\-–—|｜]{1,3}[A-Za-z][A-Za-z .]{0,24}[一-龥]{0,4}(?:新闻|时报|日报|卫报|电视|英语|频道|杂志|周刊)\s*$/, '').trim();
    /* 尾部 "- 媒体副标题链"（"- ABC新闻-突发新闻，最新新闻和视频"、"…-头条新闻，最新快讯" 类）：
     * 尾段同时含两个媒体型词（新闻/快讯/头条 ×2 或 ×视频/直播），尾端再放宽 ≤12 汉字 filler
     * （兜住"…最新新闻和视频"的"和视频"尾巴），整段剥离后由循环剥里层媒体名 */
    out = out.replace(/[\s\-–—|｜]{1,3}[一-龥][一-龥，,、和]{0,28}(?:新闻|快讯|头条)[一-龥，,、和]{0,28}(?:新闻|视频|头条|快讯|直播|最新消息)[一-龥，,、和]{0,12}\s*$/, '').trim();
    /* 尾部 "- 媒体名+国名"（"-第一财经日报尼日利亚"=BusinessDay Nigeria、"-加纳时报"类机翻残尾）：
     * 媒体型后缀后跟常见国名，整段剥离（国名必选——纯后缀结尾由下方通用启发规则兜底） */
    out = out.replace(/[\s\-–—|｜]{1,3}[一-龥]{0,10}(?:日报|时报|新闻|先驱报|邮报|卫报|电视台|频道|周刊|杂志|通讯社|论坛|报)(?:尼日利亚|加纳|肯尼亚|乌干达|坦桑尼亚|南非|津巴布韦|赞比亚|喀麦隆|塞内加尔|博茨瓦纳|马拉维|卢旺达|埃塞俄比亚|巴基斯坦|孟加拉国|斯里兰卡|尼泊尔|缅甸|菲律宾|印度尼西亚|马来西亚|印度|泰国|越南|柬埔寨|老挝|蒙古|尼日尔|马里|乍得|苏丹|索马里|莫桑比克|安哥拉|纳米比亚|莱索托|斯威士兰|突尼斯|摩洛哥|阿尔及利亚|利比亚|埃及|约旦|黎巴嫩|叙利亚|伊拉克|伊朗|阿富汗|土耳其)\s*$/, '').trim();
    /* 尾部 "- 专名+现在"（"-伦敦现在"=London Now 类机翻媒体名：正常标题不会以"-XX现在"结尾） */
    out = out.replace(/[\s\-–—|｜]{1,3}[一-龥]{2,12}现在\s*$/, '').trim();
    /* 尾部 "- XX报/日报/时报/新闻/英语/电视/频道/杂志…"（通用启发：正常标题不会以"- 媒体型后缀词"结尾，
     * 兜住词表外的残尾；前缀放宽到 0-10 汉字以覆盖"- 英语""- 新闻"这类极短残尾） */
    out = out.replace(/[\s\-–—|｜]{1,3}[《“]?[一-龥]{0,10}(?:报|日报|时报|新闻|新闻网|周刊|通讯社|电视台|电台|先驱报|邮报|电视|频道|英语|杂志|卫报|论坛)\s*[》”]?\s*$/, '').trim();
    /* 尾部 "- ThePointNG" / "- EL PAGES" 类词表外英文媒体名（首词大写，可多词，剥后主体须仍含中文且≥8字）。
     * 2026-09-02 加严（两重）：
     *   ① 主体必须是纯中文（无 3+ 连续英文字母）才允许剥——混排标题"拉塔基亚遭炮击Al-Masdar"
     *      里的地名/专名信息不再被误剥；
     *   ② 分隔符须与空白邻接——"Al-Masdar"内部的连字符不是分隔符，防止把复合专名劈开误剥。 */
    const gen = out.match(/(?:\s[-–—|｜]{0,2}\s*|[-–—|｜]\s+)([A-Z][A-Za-z]{1,20}(?:\s+[A-Z][A-Za-z]{0,20}){0,3})\s*$/);
    if (gen) {
      const kept = out.slice(0, gen.index).trim();
      if (/[\u4e00-\u9fa5]/.test(kept)
        && kept.replace(/[^\u4e00-\u9fa5]/g, '').length >= 8
        && !/[A-Za-z]{3,}/.test(kept)) out = kept;
    }
    if (out === before) break;
  }
  return out;
}

/* RSS 跳转链 URL（news.google.com/rss、feedproxy 等）：标题正文都删——这是采集器注入的跳转壳，
 * 不是正文信息。正文里的有意义链接（原文出处等）由下方 polish 保留，只有 polishTitle 全删。 */
const REDIRECT_URL = [
  /(?:https?[:：]\/\/)?[a-z0-9.-]*google\.com\/(?:rss|url)\/?\S*/gi,
  /(?:https?[:：]\/\/)?feedproxy\.[a-z0-9.-]+\/\S*/gi,
  /(?:https?[:：]\/\/)?feeds?\.feedburner\.com\/\S*/gi,
];

/* 付费墙/订阅营销句整句删除（"订阅低至""输入您的电子邮件"开头整句、"订阅……每周……美元"）。
 * 守卫：排除"订阅费/订阅量/订阅数/订阅用户/订阅价/订阅服"等合法报道词，防误删正文。 */
function _stripPaywallJunk(t) {
  let s = t;
  /* "订阅……每周/低至……美元" 型整句 */
  s = s.replace(/\s*(?:订阅|注册)(?![费量数用服价])(?:[^。！？\n]{0,50}?)(?:每周|每月|每年|低至|只需|仅需)(?:[^。！？\n]{0,40}?)(?:美元|欧元|英镑|人民币|元)[^。！？\n]*[。！？]?/g, '');
  /* 以"订阅低至/输入您的电子邮件/立即订阅…"开头的整句（含句首边界，保留前句句末标点） */
  s = s.replace(/(^|[。！？\n])\s*(?:订阅低至|注册低至|输入您?的?(?:电子)?邮[箱件]|留下您?的?(?:电子)?邮[箱件]|立即订阅|已经是会员|登录以(?:查看|阅读)|解锁(?:更多|全文)|免费试用)[^。！？\n]{0,80}[。！？]?/g, (m, b) => (b && /[。！？\n]/.test(b) ? b : ''));
  /* "阅读更多"类尾巴（含前导句读符号一起清） */
  s = s.replace(/[.。,，、;；!！]?\s*(?:阅读更多|阅读全文|继续阅读|点击阅读|点击此处|点击这里|了解更多|查看更多|故事继续)\s*[.。]?\s*/g, '');
  return s;
}

/* 标题/正文通用抛光：URL、emoji、实体、标点、缩写 */
function polish(text) {
  let t = String(text || '');
  if (!t) return t;
  /* HTML 实体（含 &nbsp;/&#x27; 十六进制变体），解码后再清洗 */
  for (const [re, to] of ENTITY_FIX) t = t.replace(re, to);
  /* RSS 跳转链 URL 删除（正文中的信息链接保留；标题全删由 polishTitle 负责） */
  for (const re of REDIRECT_URL) t = t.replace(re, '');
  /* 付费墙营销句/"阅读更多"整句删除 */
  t = _stripPaywallJunk(t);
  /* emoji / 变体选择符 / 各类符号残留 */
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}\u{200B}-\u{200D}]/gu, '');
  /* 前缀 "上一篇：" "下一篇：" "最新：" */
  t = t.replace(/^(上一篇|下一篇|最新|更新|快讯|突发)[:：]\s*/, '');
  /* 首句引导词剥离："据报道，" "消息人士称，"（标题正文通用，机翻高频） */
  t = t.replace(/^(据报道|消息人士称|目击者说|警方称|官方表示|当局称|政府称|军方称|据悉)[，,]?\s*/, '');
  /* 尾部 "作者：xxx（，xxx记者）"——仅标题场景剥（主体<80字、署名段≤40字且无句末标点）；
   * 正文一律不截：中段"作者："后接正文段落时含句号或主体超长，均不命中（2026-09-02 修复正文截断缺陷） */
  {
    const am = t.match(/(?:^|[\s\-–—|｜])作者[:：][^\n]{0,40}$/);
    if (am) {
      const head = t.slice(0, am.index);
      if (head.length < 80 && !/[。！？!?]/.test(am[0])) t = head.trim();
    }
  }
  /* 直引号配对修复（机翻引号断裂：是"X" → 是“X”；仅当引内含中文才转，英文原文引号不动；
   * 奇数个孤立引号先去掉最后一个再配对） */
  {
    if (((t.match(/"/g) || []).length) % 2 === 1) {
      const li = t.lastIndexOf('"');
      t = t.slice(0, li) + t.slice(li + 1);
    }
    t = t.replace(/"([^"]{1,80})"/g, (m, inner) => (/[\u4e00-\u9fa5]/.test(inner) ? '“' + inner + '”' : m));
  }
  /* 尾部 @handle（@CapitalFM） */
  t = t.replace(/\s*@[A-Za-z0-9_]{2,20}\s*$/, '');
  /* 标点/数字硬伤 */
  for (const [re, to] of PUNCT_FIX) t = t.replace(re, to);
  /* 权威人名词表修正（2026-09-02：Xi近平/国家主席Xi/Trump 等政要错译残留，见 NAME_FIX 注释） */
  t = fixNames(t);
  /* 缩写替换（左右非字母数字边界） */
  for (const [k, v] of Object.entries(ABBR)) {
    t = t.replace(new RegExp('(?<![A-Za-z0-9])' + k + '(?![A-Za-z0-9])', 'g'), v);
  }
  for (const [k, v] of Object.entries(NAMES)) {
    t = t.replace(new RegExp('(?<![A-Za-z0-9])' + k + '(?![A-Za-z0-9])', 'g'), v);
  }
  /* 军事术语纠正（上下文守卫，见 MILITARY_FIX 注释） */
  t = fixMilitary(t);
  return t.trim();
}

/* 标题专用抛光：通用 polish + 标题 URL 全删 + 尾部媒体剥离（正文太长不剥尾，防误伤） */
function polishTitle(text) {
  let t = polish(text);
  if (!t) return t;
  /* 标题里的 URL 一律全删（标题不应有链接；正文信息链接已在 polish 中保留） */
  t = t.replace(/https?[:：]\/\/\S+/gi, '').replace(/\s{2,}/g, ' ');
  t = _stripMediaTail(t);
  /* 剥完收尾：尾部悬空连接符/引号清理（’为实体&#8217;转换残留、“为机翻残留的前引号悬在尾部——
   * 正常闭引号”不清，防破坏引语；“”正常引语不清防破坏引语） */
  t = t.replace(/[\s\-–—|｜,，:：'’“]+\s*$/, '').trim();
  return t;
}

module.exports = { polish, polishTitle, fixNames, fixMilitary, ABBR, NAMES, NAME_FIX, MEDIA_EN, MEDIA_ZH, MILITARY_FIX };
