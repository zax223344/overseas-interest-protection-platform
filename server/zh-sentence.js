/**
 * zh-sentence.js — CAMEO 事件标题「全要素中文句式」单一事实源
 * ================================================================
 * 任务 #784（2026-09-13 用户拍板：「一是，改句式，改成中文表达的全要素句式。」）
 *
 * 背景：GDELT 归档/GDELT Events 通道没有原始新闻标题，靠 CAMEO 码表拼句，
 * 旧句式 `{国}：{A1} 对 {A2} 动词` 有三个病：
 *   ① 电报体——ASCII 空格把「以色列方 对 伊朗方 发动军事打击」拼成公式而非中文句子；
 *   ② 要素缺失——时间只出现在部分行、地点只有 gdelt-events 有；
 *   ③ 主体失格——城市/机构/人名当战争动词主语（「珀斯胁迫警方」「监狱胁迫美国」），
 *      且旧可信度闸只要求「双方任一合格」→ 全部漏网（见 title-sanity.archiveTplConf）。
 *
 * 本模块把「要素 → 中文句子」收敛为唯一出口，供两条合成通道共用：
 *   · server/backfill-archive.js::_title()     （GDELT 2.1 归档）
 *   · server/gdelt-events.js::_toItem()        （GDELT Events 2.0 实时）
 *
 * 输出句形（全要素：国家 / 地点 / 主体 / 动作 / 对象 / 规模 / 时间 / 来源）：
 *   {国家}（{地点}）：{主句}（{N} 篇报道） · {YYYY-MM-DD} · {来源域名}
 *   主句分支（按可恢复要素自动选择，句句通顺中文）：
 *     双主体  {A1}{对|与|向}{A2}{动作}      例：以色列对伊朗发动军事打击
 *     单主体  {A1}{动作}                    例：以色列发动军事打击
 *     仅受害  {A2}{承受句}                  例：警方遭胁迫
 *     无主体  {中性句}                      例：发生军事打击
 *
 * 铁律合规：只做「要素 → 中文表述」，不新增任何事实；主体失格即降级为中性转述
 * （对应 _tplLowConf 标记），条目照常入库（用户铁律：采集量不能少）。
 */
'use strict';

const TS = require('./title-sanity');

/* ---------- 一、动作框架 ----------
 * t  双主体介词（对/与/向/''）；'' 表示及物动词直接连宾语（袭击/逮捕/绑架/暗杀）
 * v  双主体及物动作短语
 * p  仅受害方（A2）时的承受句（''= 该动作无自然被动式 → 退回中性句）
 * s  单主体动作短语
 * nf 中性转述句（无可信主体时使用，本身已是完整中文小句）
 */
const FRAME = {
  '10':  { t: '向', v: '提出要求',            p: '被提出要求',            s: '提出要求',            nf: '发生外交交涉' },
  '11':  { t: '对', v: '表达反对',            p: '',                      s: '表达反对',            nf: '发生反对表态' },
  '12':  { t: '对', v: '拒绝合作',            p: '被拒绝合作',            s: '拒绝合作',            nf: '发生拒绝合作' },
  '13':  { t: '对', v: '发出威胁',            p: '遭威胁',                s: '发出威胁',            nf: '发生威胁言论' },
  '14':  { t: '对', v: '提出抗议',            p: '',                      s: '发起抗议',            nf: '发生抗议活动' },
  '15':  { t: '对', v: '展示军事姿态',        p: '遭军事威慑',            s: '展示军事姿态',        nf: '出现军事姿态展示' },
  '16':  { t: '与', v: '降级外交关系',        p: '',                      s: '降级外交关系',        nf: '发生外交关系降级' },
  '17':  { t: '对', v: '施加胁迫',            p: '遭胁迫',                s: '施加胁迫',            nf: '发生胁迫行为' },
  '18':  { t: '',   v: '袭击',                p: '遭袭击',                s: '发动袭击',            nf: '发生袭击事件' },
  '19':  { t: '与', v: '发生武装冲突',        p: '',                      s: '发生武装冲突',        nf: '发生武装冲突' },
  '20':  { t: '对', v: '实施大规模暴力',      p: '遭大规模暴力',          s: '实施大规模暴力',      nf: '发生大规模暴力事件' },
  '144': { t: '',   v: '引发骚乱',            p: '',                      s: '引发骚乱',            nf: '发生骚乱' },
  '145': { t: '对', v: '发起暴力示威',        p: '',                      s: '发起暴力示威',        nf: '发生暴力示威' },
  '172': { t: '对', v: '实施禁运制裁',        p: '遭禁运制裁',            s: '实施禁运制裁',        nf: '发生禁运制裁' },
  '173': { t: '对', v: '实施制裁',            p: '遭制裁',                s: '实施制裁',            nf: '发生制裁' },
  '174': { t: '',   v: '逮捕',                p: '遭逮捕',                s: '实施逮捕',            nf: '发生逮捕拘留' },
  '175': { t: '',   v: '绑架',                p: '遭绑架',                s: '实施绑架',            nf: '发生劫持绑架事件' },
  '176': { t: '',   v: '劫持人质',            p: '遭劫持',                s: '劫持人质',            nf: '发生劫持人质事件' },
  '182': { t: '',   v: '袭击',                p: '遭袭击',                s: '发动袭击',            nf: '发生袭击事件' },
  '183': { t: '对', v: '发动自杀式爆炸袭击',  p: '遭自杀式爆炸袭击',      s: '发动自杀式爆炸袭击',  nf: '发生自杀式爆炸袭击' },
  '185': { t: '',   v: '企图暗杀',            p: '遭暗杀企图',            s: '企图暗杀',            nf: '发生暗杀未遂事件' },
  '186': { t: '',   v: '暗杀',                p: '遭暗杀',                s: '实施暗杀',            nf: '发生暗杀事件' },
  '190': { t: '对', v: '发动军事打击',        p: '遭军事打击',            s: '发动军事打击',        nf: '发生军事打击' },
  '192': { t: '对', v: '实施封锁',            p: '遭封锁',                s: '实施封锁',            nf: '发生封锁行动' },
  '193': { t: '对', v: '实施轰炸',            p: '遭轰炸',                s: '实施轰炸',            nf: '发生轰炸事件' },
  '194': { t: '',   v: '占领',                p: '遭占领',                s: '占领领土',            nf: '发生领土占领' },
  '195': { t: '对', v: '发动空袭',            p: '遭空袭',                s: '发动空袭',            nf: '发生空袭事件' },
  '196': { t: '与', v: '违反停火协议',        p: '',                      s: '违反停火协议',        nf: '停火遭破坏' },
  '201': { t: '对', v: '实施大规模驱逐',      p: '遭驱逐',                s: '实施大规模驱逐',      nf: '发生大规模驱逐' },
  '202': { t: '对', v: '实施大规模杀戮',      p: '遭杀戮',                s: '实施大规模杀戮',      nf: '发生大规模杀戮' },
  '203': { t: '对', v: '实施族群清洗',        p: '遭族群清洗',            s: '实施族群清洗',        nf: '发生族群清洗' },
  '204': { t: '对', v: '使用大规模杀伤性武器', p: '遭大规模杀伤性武器攻击', s: '使用大规模杀伤性武器', nf: '发生大规模杀伤性武器使用' }
};

/* 根码 → 代表子码（GDELT Events 通道只有根码；归档通道有精确子码） */
const ROOT_REP = { '10': '10', '11': '11', '12': '12', '13': '13', '14': '14', '15': '15', '16': '16', '17': '17', '18': '18', '19': '19', '20': '20' };

/* GDELT Events 通道 category 中文名 → 根码（存量迁移用） */
const CAT2ROOT = {
  '抗议示威': '14', '武力展示': '15', '关系降级': '16', '胁迫': '17',
  '袭击': '18', '交战': '19', '大规模暴力': '20'
};

/* 归档通道旧版动词/名词表（存量迁移解析用；与 backfill-archive 旧值域同源） */
const LEGACY_TRANS = {
  '10': '提出要求', '11': '表达反对', '12': '拒绝合作', '13': '发出威胁', '14': '发起抗议',
  '15': '展示军事姿态', '16': '降级外交关系', '17': '采取强制行动', '18': '发动袭击',
  '19': '发生武装冲突', '20': '实施大规模暴力', '144': '引发骚乱', '145': '发起暴力示威',
  '172': '实施禁运制裁', '173': '实施制裁', '174': '实施逮捕拘留', '175': '实施劫持绑架',
  '176': '劫持人质', '182': '发动袭击', '183': '发动自杀式爆炸袭击', '185': '企图暗杀',
  '186': '实施暗杀', '190': '发动军事打击', '192': '实施封锁', '193': '实施轰炸',
  '194': '占领领土', '195': '发动空袭', '196': '违反停火', '201': '实施大规模驱逐',
  '202': '实施大规模杀戮', '203': '实施族群清洗', '204': '使用大规模杀伤性武器'
};
const LEGACY_NOUN = {
  '10': '外交交涉', '11': '反对声明', '12': '拒绝事件', '13': '威胁言论事件', '14': '抗议活动',
  '15': '军事姿态展示', '16': '外交关系降级', '17': '强制行动', '18': '袭击事件',
  '19': '武装冲突', '20': '大规模暴力事件', '144': '骚乱', '145': '暴力示威',
  '172': '禁运制裁', '173': '制裁措施', '174': '逮捕拘留行动', '175': '劫持绑架事件',
  '176': '劫持人质事件', '182': '袭击事件', '183': '自杀式爆炸袭击', '185': '暗杀未遂事件',
  '186': '暗杀事件', '190': '军事打击', '192': '封锁行动', '193': '轰炸事件',
  '194': '领土占领', '195': '空袭事件', '196': '停火遭破坏', '201': '大规模驱逐',
  '202': '大规模杀戮', '203': '族群清洗', '204': '大规模杀伤性武器使用'
};

/* GDELT Events 实时通道的旧句式（_actPhrase 产物）→ 根码（存量迁移用；
 * 该通道行只有根码，且 db 内 category 已被通用分类器标准化，不能再当 CAMEO 码用） */
const GE_ROOT_SIG = [
  [/举行抗议示威/, '14'], [/展示武力/, '15'], [/关系降级/, '16'],
  [/胁迫/, '17'], [/袭击/, '18'], [/交战/, '19'], [/实施大规模暴力/, '20']
];
/* 兜底：data_type → 根码（标题被翻译改写、匹配不到动词时用） */
const DT2ROOT = {
  social_unrest: '14', military_conflicts: '19', geopolitical_intel: '17',
  terror_events: '18', mass_violence: '20'
};

function frameOf(code) {
  const k = String(code || '').trim();
  if (FRAME[k]) return FRAME[k];
  if (ROOT_REP[k]) return FRAME[ROOT_REP[k]];
  const r = k.slice(0, 2);                    /* CAMEO 3/4 位子码 → 根码（170→17、1823→18） */
  if (ROOT_REP[r]) return FRAME[ROOT_REP[r]];
  return null;
}

/** GDELT Events 旧句 → 根码（匹配不到返回 ''） */
function rootFromGdeltBody(body, dataType) {
  const b = String(body || '');
  for (const [re, code] of GE_ROOT_SIG) if (re.test(b)) return code;
  return DT2ROOT[String(dataType || '')] || '';
}

/* ---------- 二、要素清洗 ---------- */

/** 地点要素：仅当能写出纯中文地名时才进标题（避免引入新的半中半英）。 */
function normLocZh(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/[\u4e00-\u9fa5]/.test(s)) return '';
  if (/[A-Za-z]{2,}/.test(s)) return '';                             /* 「大学 Of 内华达州」类机翻残渣 */
  if (/[\u4e00-\u9fa5A-Za-z]{1,3}(CITY|City)$/.test(s)) return '';   /* 「纽约 STATE」类残渣 */
  return s.replace(/^[（(]|[）)]$/g, '').trim();
}

/** 主体是否为「与国名同指的泛指」（「美国：美国遭军事打击」→ 去重降级） */
function sameAsCountry(a, cn) {
  if (!a) return true;
  const t = String(a).trim();
  if (t === cn) return true;
  if (t === cn + '方') return true;
  if (t.replace(/方$/, '') === cn) return true;
  return false;
}

/* ---------- 三、句子构造 ---------- */

/**
 * 由要素构造完整中文标题。
 * @param {object} o
 * @param {string} o.cn       国家（中文）
 * @param {string} [o.loc]    地点（中文，可选）
 * @param {string} [o.a1]     行为体1（已中文化/清洗）
 * @param {string} [o.a2]     行为体2
 * @param {string} o.code     CAMEO 事件码（子码优先，无则根码）
 * @param {number} [o.n]      报道量（NumMentions/NumArticles）
 * @param {string} [o.date]   事件日期（YYYY-MM-DD，脏值自动忽略）
 * @param {string} [o.dom]    来源域名（消歧用）
 * @returns {string} 标题
 */
/**
 * 要素规范化 + 可信度判定（buildTitle / 存量迁移共用同一入口，保证标题与标记同源）。
 * @returns {{cn,loc,A1,A2,k1,k2,conf,F}|null}
 */
function assess(o) {
  const cn = String((o && o.cn) || '').trim();
  const F = frameOf(o && o.code);
  if (!cn || !F) return null;
  let loc = normLocZh(o.loc);
  let A1 = TS.normActor(o.a1);
  let A2 = TS.normActor(o.a2);
  /* 地名主语 → 降为地点要素（「加利福尼亚州发起抗议」→「美国（加利福尼亚州）：发生抗议活动」）。
   * 只在主语（A1）位做此归位；A2 位的地名直接丢弃（把受害方塞进地名位会造成误导）。 */
  if (A1 && TS.isPlaceActor(A1)) { if (!loc) loc = A1; A1 = ''; }
  if (A2 && TS.isPlaceActor(A2)) { A2 = ''; }
  if (loc === cn) loc = '';
  const k1 = TS.actorClass(A1), k2 = TS.actorClass(A2);
  const conf = TS.archiveTplConf(A1, A2, o.code, '');
  return { cn, loc, A1, A2, k1, k2, conf, F };
}

/** 仅取可信度判定（存量迁移标记 _tplLowConf 用） */
function assessConf(o) {
  const a = assess(o);
  return a ? a.conf : 'ok';
}

function buildTitle(o) {
  const p = assess(o);
  if (!p) return '';                                  /* 未知码/无国名：调用方回退既有逻辑 */
  const { cn, loc, A1, A2, k2, conf, F } = p;

  let clause;
  if (!A1 && !A2) {
    clause = F.nf;
  } else if (conf === 'ok' && A1 && A2 && A1 !== A2) {
    clause = F.t ? (A1 + F.t + A2 + F.v) : (A1 + F.v + A2);
  } else if (conf === 'ok' && A1) {
    clause = A1 + F.s;
  } else if (F.p && k2 && !sameAsCountry(A2, cn)) {
    /* 主语失格、受害方合格：转为自然被动句「警方遭胁迫」，比丢弃要素更贴原记录 */
    clause = A2 + F.p;
  } else if (A1 && TS.subjectOk(A1, o.code, '')) {
    /* 主语本身合格、只是对称的另一方失格（如「以方 与 村庄 交战」）→ 保留单主体 */
    clause = A1 + F.s;
  } else {
    clause = F.nf;
  }

  const head = cn + (loc ? '（' + loc + '）' : '');
  const meta = [];
  if (Number(o.n) >= 1) meta.push('（' + Number(o.n) + ' 篇报道）');
  const dOk = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '').trim());
  if (dOk) meta.push(String(o.date).trim());
  const dom = String(o.dom || '').trim().replace(/:\d+$/, '');
  if (dom) meta.push(dom);
  return head + '：' + clause + (meta.length ? ' · ' + meta.join(' · ') : '');
}

/* ---------- 四、存量迁移：旧句形/新句形 → 要素 ---------- */

const _esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* 旧归档动词全表（含名词式），长词优先，避免「袭击」抢先吃掉「发动袭击」 */
const LEGACY_ALL = [...Object.values(LEGACY_TRANS), ...Object.values(LEGACY_NOUN)]
  .sort((a, b) => b.length - a.length).map(_esc).join('|');
const _RE_L_PAIR = new RegExp('^(.{1,40}?) 对 (.{1,40}?) (' + LEGACY_ALL + ')$');
const _RE_L_ONE = new RegExp('^(.{1,40}?) (' + LEGACY_ALL + ')$');
const _RE_L_SHE = new RegExp('^(.{1,40}?) 涉(' + LEGACY_ALL + ')$');
const _RE_L_NOUN = new RegExp('^(' + LEGACY_ALL + ')$');
/* 新句形（本模块产出，动词与主体之间**无空格**——这正是与旧电报体的形态区别）：
 * {A1}{对|与|向}{A2}{v} / {A1}{v}{A2} / {A1}{s} / {A2}{p}
 * ★ [^\s] 守卫：新句形内部不含空格，杜绝把旧「X 涉Y」「X 动词」误切进新句形。 */
const NEW_V = [...new Set(Object.values(FRAME).map(f => f.v))].sort((a, b) => b.length - a.length).map(_esc).join('|');
const NEW_S = [...new Set(Object.values(FRAME).map(f => f.s))].sort((a, b) => b.length - a.length).map(_esc).join('|');
const NEW_P = [...new Set(Object.values(FRAME).map(f => f.p).filter(Boolean))].sort((a, b) => b.length - a.length).map(_esc).join('|');
const _RE_N_PAIR = new RegExp('^([^\\s]{1,30}?)(对|与|向)([^\\s]{1,30}?)(' + NEW_V + ')$');
const _RE_N_ONE = new RegExp('^([^\\s]{1,30}?)(' + NEW_S + ')$');
const _RE_N_TRANS = new RegExp('^([^\\s]{1,30}?)(' + NEW_V + ')([^\\s]{1,30})$');
const _RE_N_PASS = new RegExp('^([^\\s]{1,30}?)(' + NEW_P + ')$');

/** 剥离「国家（地点）：主体句」外壳与尾部元信息 → {cn, loc, body, n, date, dom}
 * 结构约定（新旧句形一致）：正文段在前，` · ` 后全是元信息（报道量/日期/域名）。
 * 域名段兼容 `:443` 端口；机翻域名（「福克斯」「新闻网」）无法识别则丢弃（仅消歧用）。 */
function splitTitle(title) {
  const t = String(title || '').trim();
  const m = t.match(/^([^：]{1,40})：([\s\S]+)$/);
  if (!m) return null;
  const pre = m[1];
  const locM = pre.match(/（([^）]*)）\s*$/);
  const loc = locM ? locM[1].trim() : '';
  const cn = pre.replace(/（[^）]*）\s*$/, '').trim();
  const segs = m[2].split(' · ').map(s => s.trim()).filter(Boolean);
  let body = segs.length ? segs[0] : '';
  let n = 0, date = '', dom = '';
  const nm = body.match(/（(\d+) 篇报道）\s*$/);
  if (nm) { n = parseInt(nm[1], 10) || 0; body = body.slice(0, nm.index).trim(); }
  for (const p of segs.slice(1)) {
    if (!n && /^（(\d+) 篇报道）$/.test(p)) { n = parseInt(p.replace(/\D/g, ''), 10) || 0; continue; }
    if (!date && /^\d{4}-\d{2}(-\d{2})?$/.test(p)) { date = p; continue; }
    const dm = p.match(/^([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?$/i);
    if (!dom && dm) { dom = dm[1]; continue; }
  }
  return { cn, loc, body, n, date, dom };
}

/** 解析归档通道句形（旧/新）→ {a1,a2,kind} */
function parseArchiveBody(body) {
  let m;
  if ((m = body.match(_RE_L_PAIR))) return { a1: m[1], a2: m[2], kind: 'pair' };
  if ((m = body.match(_RE_N_PAIR))) return { a1: m[1], a2: m[3], kind: 'pair' };
  if ((m = body.match(_RE_L_SHE))) return { a1: '', a2: m[1], kind: 'she' };
  if ((m = body.match(_RE_L_ONE))) return { a1: m[1], a2: '', kind: 'one' };
  if ((m = body.match(_RE_N_PASS))) return { a1: '', a2: m[1], kind: 'she' };
  if ((m = body.match(_RE_N_ONE))) return { a1: m[1], a2: '', kind: 'one' };
  if ((m = body.match(_RE_N_TRANS))) return { a1: m[1], a2: m[3], kind: 'pair' };
  if (_RE_L_NOUN.test(body) || _RE_L_NOUN.test(body.replace(/^发生/, ''))) return { a1: '', a2: '', kind: 'noun' };
  return null;
}

/** 解析 GDELT Events 通道旧句形（_actPhrase 产物）→ {a1,a2} */
function parseGdeltBody(body, code) {
  const root = String(code || '');
  let m;
  if (root === '14') { m = body.match(/^(.+?)举行抗议示威(?:反对(.+))?$/); if (m) return { a1: m[1], a2: m[2] || '', kind: 'pair' }; }
  if (root === '15') { m = body.match(/^(.+?)展示武力(?:威慑(.+))?$/); if (m) return { a1: m[1], a2: m[2] || '', kind: 'pair' }; }
  if (root === '16') { m = body.match(/^(.+?)与(.+?)关系降级$/); if (m) return { a1: m[1], a2: m[2], kind: 'pair' }; }
  if (root === '17') { m = body.match(/^(.+?)胁迫(.+)$/); if (m) return { a1: m[1], a2: m[2], kind: 'pair' }; }
  if (root === '18') { m = body.match(/^(.+?)袭击(.+)$/); if (m) return { a1: m[1], a2: m[2], kind: 'pair' }; }
  if (root === '19') { m = body.match(/^(.+?)与(.+?)交战$/); if (m) return { a1: m[1], a2: m[2], kind: 'pair' }; }
  if (root === '20') { m = body.match(/^(.+?)实施大规模暴力(?:针对(.+))?$/); if (m) return { a1: m[1], a2: m[2] || '', kind: 'pair' }; }
  return null;
}

/** 判定一句话是否已经是「无主体中性句」（迁移时跳过） */
function isNeutralClause(body) {
  const b = String(body || '').trim();
  return Object.values(FRAME).some(f => f.nf === b);
}

/** 是否为「主体句」（含真实行为体，需要迁移） */
function isActorClause(body) {
  const b = String(body || '').trim();
  if (isNeutralClause(b)) return false;
  return /对|与|向/.test(b) || /[一-龥A-Za-z]{2,}/.test(b);
}

module.exports = {
  FRAME, ROOT_REP, CAT2ROOT, DT2ROOT, GE_ROOT_SIG, LEGACY_TRANS, LEGACY_NOUN,
  frameOf, rootFromGdeltBody, assess, assessConf, buildTitle, normLocZh, splitTitle,
  parseArchiveBody, parseGdeltBody, isNeutralClause, isActorClause,
  sameAsCountry
};
