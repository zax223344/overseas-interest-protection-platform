/**
 * title-sanity.js — 标题可信度单一事实源（任务 #777 P0，2026-09-12 用户拍板）
 * ================================================================
 * 背景（#777 采集审计）：近 7 天 115,398 条入库中，
 *   ① 5,037 条为 GDELT 归档 CAMEO 模板句（「德国：德国方 涉军事打击」源自职业摔角网站），
 *      根因 = 归档库只给事件编码+SOURCEURL 不给标题，回捞失败即用码表拼句，
 *      且**无行为体—动词语义兼容性校验** → GDELT 误码被原样放大为"军事情报"；
 *   ② 76 条为站点 chrome 标题（terradaily「关于地球的新闻」、africa.com「类别|africa.com」），
 *      根因 = 回捞取到 feed channel 元数据 / 页面通用标题。
 *
 * 本模块提供三件事，供 backfill-archive / backfill-titles / globalmedia 共用：
 *   · normActor        —— 行为体名合法性（单字碎片「副」「极」直接作废）
 *   · archiveTplConf   —— 归档模板标题可信度（军事/暴力码须行为体具备武力能力）
 *   · isSiteChrome     —— 站点 chrome / channel 元数据标题识别
 *
 * 设计铁律（用户"采集量不能少"）：本模块**只判定、不丢弃**。判定为低可信的条目
 * 由调用方降级为「中性事件转述 + _tplLowConf 标记」，条目照常入库，总量不减。
 */
'use strict';

const { US_STATE_ZH } = require('./gdelt-actors');
const { GD_COUNTRIES } = require('./crawler');

/* 平台覆盖国中文名集合（GD_COUNTRIES 键 = 中文国名）。
 * #784 补充：STATE_RE 是手写清单，漏了塞拉利昂/厄立特里亚等小国 →
 * 这些国家当主语时被误判"无行为能力"而降级。国名兜底用 GD_COUNTRIES 单一取源。 */
const _CN_COUNTRIES = new Set(Object.keys(GD_COUNTRIES).map(s => String(s).trim()));

/* ---------- 一、行为体名合法性 ---------- */

/* 无主语意义的碎片词（出现在行为体位即作废）。
 * 注：「状态」是 actorZh('state') / 「邻域」是 actorZh('neighborhood') 的直译残留——
 * GDELT 归档给的是泛词，落到中文后成为无意义主语（实测「书记 状态 对 参议员 发动军事打击」）。 */
const ACTOR_FRAG = new Set([
  '副', '极', '代表', '其他', '其它', '某', '该', '此', '其', '本', '方', '者', '人',
  '州', '市', '县', '区', '镇', '村', '部', '局', '处', '科', '司', '厅', '委', '办',
  '状态', '邻域', '国籍', '机关', '单位', '部门', '人士',
  '政府方', '官方', '有关方面', '消息人士', '分析人士', '观察人士',
  /* #784（2026-09-13）：占位/泛指行为体——不是真实主体，出现在主语位即作废。 */
  '相关方', '多方', '各方', '对方', '我方', '你方', '某一方',
  '不明行为体', '行为体', '目标', '目标方', '相关目标'
]);

/* 「X方」国别简称的**保留白名单**（中文媒体惯用）。其余「XX方」一律还原为「XX」——
 * 实测 GDELT 行为体名把国名机械加「方」产生大量非惯用形态
 * （尼日利亚方/澳大利亚方/埃塞俄比亚方/斯里兰卡方），中文里不这么写。 */
const SIDE_KEEP = new Set(['伊方', '美方', '以方', '俄方', '乌方', '中方', '日方', '韩方',
  '英方', '法方', '德方', '印方', '巴方', '土方', '越方', '泰方', '菲方', '黎方', '叙方',
  '埃方', '墨方', '沙方', '朝方', '澳方', '加方', '意方']);

/**
 * 「X方」归一：#784 起长国名 + 方 一律还原（尼日利亚方 → 尼日利亚）；
 * 单字惯用简称（伊方/美方/中方）保留；纯占位（相关方/多方）返回 ''。
 * ★ 守卫：词根若本身以机构/称谓字收尾（苏丹**军**方 / 中国**官**方 / 英国**警**方），
 *   说明「方」不是国别后缀而是词的一部分 → 原样保留（否则会被错切成「苏丹军」）。
 */
const SIDE_BASE_STOP = /[军警民兵队部局院会司校团党府界方区州省旗员长]$/;

function normSide(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(.{1,8}?)方$/);
  if (!m) return t;
  if (SIDE_KEEP.has(t)) return t;
  if (ACTOR_FRAG.has(t)) return '';
  const base = m[1];
  if (base.length <= 1) return t;          /* 「警方」「军方」「美方」等：base 单字，保留 */
  if (SIDE_BASE_STOP.test(base)) return t; /* 词根以机构字收尾 → 「方」是词的一部分 */
  return base;
}

/**
 * 行为体名合法性：单字碎片 / 纯标点 / 无义词一律作废（返回 ''）。
 * 作废后 _title 自动落到「国家：名词式（N 篇报道）」中性形态，不产生虚假主语。
 */
function normActor(s) {
  s = String(s || '').trim().replace(/^[·•\-–—\s|]+|[·•\-–—\s|]+$/g, '');
  if (!s) return '';
  s = normSide(s);                                   /* #784 「XX方」还原（尼日利亚方→尼日利亚） */
  if (!s) return '';
  if (/^[\u4e00-\u9fa5]$/.test(s)) return '';        /* 纯单字中文（副/极/州…） */
  if (/^[A-Za-z]{1,2}$/.test(s)) return '';          /* 1~2 个字母（A、Us…） */
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(s)) return ''; /* 纯符号 */
  if (ACTOR_FRAG.has(s)) return '';
  return s;
}

/* ---------- 二、归档模板标题可信度（动词决定所需主体能力等级） ---------- */

/* 行政区划后缀：GDELT 常把「地名」填进 Actor 位（实测「加利福尼亚州发起抗议」
 * 「纽约州胁迫媒体」「威尔士展示武力」「以方与村庄交战」）。
 * 地名不是行为主体：作主语时降为地点要素，作对称动词的另一方时整条判误码。 */
const PLACE_SUF_RE = /(州|省|邦|市|县|区|岛|港|镇|村|庄|郡)$/;
/* 以「区/邦」收尾但实为机构/建制的词，不得按地名处理 */
const PLACE_ALLOW = new Set(['联邦', '军区', '战区', '警区', '防区', '管区', '辖区', '边区', '自治区']);
const _US_STATE_VALS = new Set(Object.values(US_STATE_ZH));

function isPlaceActor(name) {
  const t = String(name || '').trim();
  if (!t) return false;
  if (PLACE_ALLOW.has(t)) return false;
  if (_US_STATE_VALS.has(t)) return true;
  return t.length >= 2 && PLACE_SUF_RE.test(t);
}

/* CAMEO 码 → 所需主体能力等级：
 *   mil   = 战争行为（打击/轰炸/封锁/占领/空袭/屠杀/清洗/绑架），须军事主体或国家
 *   state = 国家行为（制裁/禁运/外交要求/反对/拒绝/威胁/降级外交），须国家或政权机构
 *   law   = 执法行为（逮捕/强制行动），军事/执法/国家任一即可
 * 背景：#777 审计实测「警方 实施轰炸」「学校 采取强制行动」「银行 降级外交关系」
 * 「警方 对 抗议者 实施制裁」等 375 条/周 的主体—动词权限错配，均属 GDELT 误码。 */
const REQUIRE_MIL = new Set([
  '15', '19', '20', '175', '176', '182', '183', '185', '186',
  '190', '192', '193', '194', '195', '196', '201', '202', '203', '204'
]);
const REQUIRE_STATE = new Set(['10', '11', '12', '13', '16', '172', '173']);
const REQUIRE_LAW = new Set(['17', '174']);

/* #784（2026-09-13）对称行为：语义要求**双方**都是行为主体，不能有一方是地名。
 * 「以方与村庄交战」「美国与多方关系降级」——只有一方合格时句子本身不成立 → 判误码降级。 */
const REQUIRE_BOTH = new Set(['16', '19', '196']);

/* 军事主体（具备武力投射能力）。注意：不含警察/警方——警方无权实施轰炸/空袭/占领。 */
const MIL_ACTOR_RE = /(军|部队|武装|联军|国防|防务|参谋|军区|战区|卫队|民兵|叛军|军阀|恐怖|圣战|塔利班|伊斯兰国|极端组织|激进组织|雇佣|特种部队|陆战队|空降兵|火箭军|国民警卫|海岸警卫|政府军|国民军|革命卫队|陆军|海军|空军|战机|战舰|火箭|导弹|无人机|坦克|军事|袭击者|枪手|武装分子|反政府|分离|游击|military|army|troops|forces|militia|terror|jihad|rebel|insurg|guerrilla|navy|soldier|gunmen|bomber|militant|warlord|air ?force|national ?guard|marine)/i;

/* 执法主体（仅够格执行逮捕/强制行动，不够格发动战争/制裁） */
const LAW_ACTOR_RE = /(警察|警方|宪兵|执法|边境巡逻队|特勤|安保力量|安全部队|安全力量|国民警卫|police|sheriff|border ?patrol|law ?enforcement|gendarmerie)/i;

/* 国家 / 政权机构（可实施军事行动、制裁、外交降级） */
const STATE_RE = /(政府|当局|政权|总统|总理|议会|国会|内阁|外交部|国防部|司令部|选举委员会|联盟|北约|联合国|美[国军]|美方|以色列|以方|伊朗|伊方|俄罗斯|俄方|乌克兰|乌方|中国|中方|印度|印方|巴基斯坦|巴方|阿富汗|叙利亚|伊拉克|也门|黎巴嫩|巴勒斯坦|沙特|埃及|土耳其|法国|德国|英国|日本|韩国|朝鲜|缅甸|苏丹|利比亚|索马里|埃塞俄比亚|尼日利亚|刚果|亚美尼亚|阿塞拜疆|委内瑞拉|哥伦比亚|墨西哥|巴西|南非|肯尼亚|马里|尼日尔|乍得|乌干达|卢旺达|莫桑比克|安哥拉|赞比亚|津巴布韦|哈萨克斯坦|乌兹别克斯坦|塔吉克斯坦|吉尔吉斯斯坦|土库曼斯坦|蒙古|越南|泰国|柬埔寨|老挝|马来西亚|新加坡|印度尼西亚|菲律宾|澳大利亚|加拿大|西班牙|意大利|波兰|荷兰|比利时|瑞典|挪威|芬兰|瑞士|奥地利|希腊|葡萄牙|丹麦|爱尔兰|捷克|匈牙利|罗马尼亚|塞尔维亚|白俄罗斯|格鲁吉亚|阿联酋|卡塔尔|科威特|巴林|阿曼|约旦|突尼斯|阿尔及利亚|摩洛哥|厄立特里亚|南苏丹|喀麦隆|加纳|科特迪瓦|塞内加尔|坦桑尼亚|新西兰|阿根廷|智利|秘鲁|玻利维亚|厄瓜多尔|古巴|海地|危地马拉|洪都拉斯|萨尔瓦多|尼加拉瓜|巴拿马|哥斯达黎加|多米尼加|尼泊尔|斯里兰卡|孟加拉|不丹|马尔代夫|巴新|巴布亚新几内亚)/;

/* 「X方」国别简称（以方/伊方/美方/委内瑞拉方…），长度 2~6 */
const STATE_SIDE_RE = /^[\u4e00-\u9fa5]{1,5}方$/;

/** 行为体能力分级：'mil' | 'law' | 'state' | ''（不具备任何行为能力） */
function actorClass(name) {
  let s = String(name || '').trim();
  if (s.length < 2) return '';
  s = normSide(s);                      /* #784 「XX方」先归一（埃塞俄比亚方→埃塞俄比亚） */
  if (s.length < 2) return '';
  if (MIL_ACTOR_RE.test(s)) return 'mil';
  if (LAW_ACTOR_RE.test(s)) return 'law';
  if (STATE_RE.test(s) || STATE_SIDE_RE.test(s)) return 'state';
  /* 国名兜底（含「XX方」形态）：手写 STATE_RE 覆盖不全（塞拉利昂/厄立特里亚/巴新…） */
  if (_CN_COUNTRIES.has(s) || _CN_COUNTRIES.has(s.replace(/方$/, ''))) return 'state';
  return '';
}

/** 行为体是否具备实施军事/暴力行动的能力（向后兼容导出） */
function actorCapable(name) {
  const k = actorClass(name);
  return k === 'mil' || k === 'state';
}

/** 动词所需的主体能力等级：'mil' | 'state' | 'law' | ''（该动词不设闸） */
function requireLevel(ev, root) {
  for (const k of [String(ev || ''), String(root || '')]) {
    if (!k) continue;
    if (REQUIRE_MIL.has(k)) return 'mil';
    if (REQUIRE_STATE.has(k)) return 'state';
    if (REQUIRE_LAW.has(k)) return 'law';
  }
  return '';
}

/**
 * 主语是否具备该动词所需能力（#784 抽出：标题降级判定与可信度判定共用一个判据，
 * 避免「警方发动军事打击」这类「主语失格但仍被当主语」的漏网）。
 */
function subjectOk(a1, ev, root) {
  const need = requireLevel(ev, root);
  if (!need) return true;                    /* 非受限动词不设此闸 */
  const c1 = actorClass(a1);
  if (need === 'mil') return c1 === 'mil' || c1 === 'state';
  if (need === 'state') return c1 === 'state';
  return c1 === 'mil' || c1 === 'law' || c1 === 'state';
}

/**
 * 归档模板标题可信度。
 * @param {string} a1 行为体1（已中文化）
 * @param {string} a2 行为体2（已中文化）
 * @param {string} ev CAMEO 事件子码（如 '190'）
 * @param {string} root CAMEO root 码（如 '19'）
 * @returns {'ok'|'low'} low = 动词所需能力无人满足 / 主语不成主体 → GDELT 误码
 */
function archiveTplConf(a1, a2, ev, root) {
  if (!requireLevel(ev, root)) return 'ok';
  /* 主语（A1）必须具备动词所需能力。
   * #784 根修：旧规则「A1 或 A2 任一合格即放行」→「A1 垃圾 + A2 军事实体」全部漏网
   * （实测「公司与武装力量交战」「监狱胁迫美国」「珀斯胁迫警方」「方丈胁迫英国」）。 */
  if (!subjectOk(a1, ev, root)) return 'low';
  /* 对称动词：另一方不得是地名（「与村庄交战」这类结构不成立） */
  if (REQUIRE_BOTH.has(String(ev || '')) || REQUIRE_BOTH.has(String(root || ''))) {
    if (isPlaceActor(a1) || isPlaceActor(a2)) return 'low';
  }
  return 'ok';
}

/* ---------- 二·补：归档模板标题解析（还原行为体） ---------- */

/* 归档模板句的谓语词表（与 backfill-archive.js 的 VERB_TRANS/VERB_NOUN 值域同源）。
 * 用途：存量数据只有标题、没有原始行为体字段，须从模板句反解出 A1/A2 才能复核可信度。 */
const TPL_VERBS = [
  '提出要求', '表达反对', '拒绝合作', '发出威胁', '发起抗议', '展示军事姿态', '降级外交关系',
  '采取强制行动', '发动袭击', '发生武装冲突', '实施大规模暴力', '引发骚乱', '发起暴力示威',
  '实施禁运制裁', '实施制裁', '实施逮捕拘留', '实施劫持绑架', '劫持人质', '企图暗杀', '实施暗杀',
  '发动军事打击', '实施封锁', '实施轰炸', '占领领土', '发动空袭', '违反停火', '实施大规模驱逐',
  '实施大规模杀戮', '实施族群清洗', '使用大规模杀伤性武器', '发动自杀式爆炸袭击', '发生对抗',
  '外交交涉', '反对声明', '拒绝事件', '威胁言论事件', '抗议活动', '军事姿态展示', '外交关系降级',
  '强制行动', '袭击事件', '武装冲突', '大规模暴力事件', '骚乱', '暴力示威', '禁运制裁', '制裁措施',
  '逮捕拘留行动', '劫持绑架事件', '劫持人质事件', '自杀式爆炸袭击', '暗杀未遂事件', '暗杀事件',
  '军事打击', '封锁行动', '轰炸事件', '领土占领', '空袭事件', '停火遭破坏', '大规模驱逐',
  '大规模杀戮', '族群清洗', '大规模杀伤性武器使用', '对抗事件'
];
const _ESC = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _TPL_ALT = TPL_VERBS.slice().sort((a, b) => b.length - a.length).map(_ESC).join('|');
const _RE_PAIR = new RegExp('^(.{1,40}?) 对 (.{1,40}?) (' + _TPL_ALT + ')$');
const _RE_ONE = new RegExp('^(.{1,40}?) (' + _TPL_ALT + ')$');
const _RE_NOUN = new RegExp('^(' + _TPL_ALT + ')$');

/**
 * 从归档模板标题反解行为体。
 * @returns {{a1:string,a2:string}|null} null = 形态不匹配（未知来源标题）→ 调用方须 fail-open 放行
 */
function parseTplTitle(title) {
  const m = String(title || '').match(/^[^：]{1,24}：([\s\S]+)$/);
  if (!m) return null;
  const body = m[1].replace(/（\d+ 篇报道）\s*$/, '').trim();
  let mm;
  if ((mm = body.match(_RE_PAIR))) return { a1: mm[1].trim(), a2: mm[2].trim() };
  if ((mm = body.match(_RE_ONE))) return { a1: mm[1].trim(), a2: '' };
  if ((mm = body.match(/^(.{1,40}?) 涉/))) return { a1: '', a2: mm[1].trim() };
  if (_RE_NOUN.test(body)) return { a1: '', a2: '' };
  return null;                               /* 形态未知 → fail-open */
}

/* ---------- 三、站点 chrome / channel 元数据标题识别 ---------- */

/* 标题内含域名（"类别|africa.com"） */
const DOMAIN_IN_TITLE_RE = /[|｜]\s*(?:www\.)?[a-z0-9-]{2,}\.(?:com|org|net|cn|co|io|info|news|tv|me|us|uk|au|in|jp|kr|de|fr|ru|br|za|ng|pk|ir|il|tr|es|it|nl|sg|my|th|vn|ph|id)\b/i;

/* 站点通用标题 / 频道栏目名（必须锚定标题尾部，避免命中正文里的普通词。
 * 实测教训：「联系我们」「欢迎来到」「新闻中心」这类词大量出现在正常标题中部
 * （如「…税收战-联系我们」「红海告急… - 新闻中心 - 中国宁波网」），
 * 若不加尾部锚定会误伤真标题，已收窄为下列精确形态。） */
const SITE_CHROME_RES = [
  /(?:^|[-\u2013\u2014|｜·]\s*)关于[^，。；|｜]{0,12}(?:的|之)新闻\s*$/,  /* 地球日报-关于地球的新闻 */
  /突发新闻[，,]/,                                                      /* 海峡时报-突发新闻，新加坡新闻，亚洲 */
  /每日灵修|主日[|｜]|讲道[|｜]|弥撒[|｜]/,                              /* pcusa 每日灵修|长老会（美国） */
  /(?:^|[-\u2013\u2014|｜·]\s*)网站首页\s*$/,
  /(?:^|[-\u2013\u2014|｜·]\s*)栏目导航\s*$/
];

/**
 * 站点 chrome 标题判定（回捞取到 feed channel 元数据 / 页面通用标题）。
 * @param {string} title 候选标题
 * @param {string} url   条目 URL（保留参数，供后续扩展交叉验证）
 */
function isSiteChrome(title, url) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (DOMAIN_IN_TITLE_RE.test(t)) return true;
  for (const re of SITE_CHROME_RES) if (re.test(t)) return true;
  /* 不使用「标题|媒体名」通用兜底：实测该格式是本项目正规 RSS 标题的标准形态
   * （如「特朗普向欧洲审查制度宣战|ZeroHedge」），曾误伤 1,057 条真标题，已废弃。 */
  return false;
}

module.exports = {
  normActor, actorClass, actorCapable, archiveTplConf, isSiteChrome, parseTplTitle, normSide, isPlaceActor,
  requireLevel, subjectOk,
  MIL_ACTOR_RE, LAW_ACTOR_RE, STATE_RE, REQUIRE_MIL, REQUIRE_STATE, REQUIRE_LAW, REQUIRE_BOTH, TPL_VERBS
};
