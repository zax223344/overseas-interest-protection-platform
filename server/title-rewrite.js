/**
 * title-rewrite.js — L2 中文标题句式重写引擎（2026-08-29 翻译质量改造 #484）
 *
 * 目标：机翻产出的欧化语序/插入语/框架句重组为中文自然语序。
 * 设计铁律（保守优先，宁可不重写不可写错）：
 *   ① 只有病句检测命中（badOrder ≥ 2）才动手，健康标题一律原样返回；
 *   ② 每步变换有长度/中文占比保护，产出异常（过短/外文占比升高）即回退原句；
 *   ③ 槽位（地点/类型/伤亡）抽不齐不做模板句，模板句只在 badOrder ≥ 3 时启用；
 *   ④ 溯源：调用方在重写发生时负责把原文存入 title_en（server.js 已有此约定）。
 *
 * 病句样本依据（800 条实测）：
 *   "在拉格曼的人力车中有14人在气瓶爆炸中受伤"        → 框架句
 *   "恐怖的女学生，13岁，在前往中国食物后被绑架和轮奸"  → 插入语割裂
 *   "据报道，肯尼亚爆发的五起疑似登革热死亡病例达到…"   → 引导词开头
 *   "咆哮的老鼠：越南如何在出口游戏中击败中国和印度"    → 评论文（无事件词，不触发）
 *
 * 2026-09-02 翻译质量反馈修复（"译文没有中文阅读逻辑"）：
 *   ① 新增高危病句特征（highRisk）：欧化被动（"被"字+长串名词）、"对X进行了Y"冗余、
 *      ≥3 连"的"定语链、"，作为X，"插入语错位、一逗到底≥4 段——命中 1 条即触发条件重写，
 *      不必等 badOrder≥2；
 *   ② 新增高置信变换：fixDuiJinxing / fixAsAppositive / fixTimePostfix（后置时间状语归位）；
 *   ③ <8 字碎片标题（逗号/动词原形开头）也进入处理；
 *   ④ quality()：全大写缩写（IRGC/TTP/ICE 类专名）不扣分；标题尾部残留英文实词再扣 15，
 *      供下游 zhq<40 pivot 重译兜底感知。
 */
'use strict';

/* ============ 事件类型分类（词表 → 12 大类之一） ============ */
const TYPE_RULES = [
  { kw: /恐怖袭击|自杀式|恐袭|炸弹|爆炸物|路边炸弹/, label: '恐袭' },
  { kw: /绑架|劫持|绑匪|赎金/, label: '绑架' },
  { kw: /空袭|炮击|交火|武装冲突|攻势|进攻|打击/, label: '武装冲突' },
  { kw: /洪水|山洪|地震|台风|飓风|暴雨|滑坡|泥石流|洪灾/, label: '灾害' },
  { kw: /霍乱|埃博拉|麻疹|登革热|疫情|病毒|病例|死亡病例/, label: '疫情' },
  { kw: /抗议|示威|罢工|游行/, label: '抗议' },
  { kw: /抢劫|凶杀|谋杀|轮奸|强奸|盗窃|治安/, label: '治安案件' },
  { kw: /爆炸|枪击|开枪|袭击|遇袭/, label: '袭击事故' },
];
function classify(zh) {
  for (const r of TYPE_RULES) if (r.kw.test(zh)) return r.label;
  return '';
}

/* ============ 槽位抽取 ============ */
function slots(zh, countryCn) {
  const s = { loc: '', city: '', type: '', cas: [], zh: String(zh || '') };
  s.type = classify(s.zh);
  /* 城市后缀规则（与 server.js _extractElements 同思路，自足实现避免依赖） */
  const cm = s.zh.match(/([一-龥]{2,6}?)(省|市|州|首都|地区|镇)/);
  if (cm) s.city = cm[1] + cm[2];
  /* 伤亡数字 */
  const reCas = /(\d+)\s*(?:多)?\s*(?:名|人)\s*(死亡|遇难|丧生|身亡|受伤|伤|失踪|被杀|获释|获救)/g;
  let m;
  while ((m = reCas.exec(s.zh)) !== null) s.cas.push(m[1] + (m[1] === '1' ? '人' : '人') + m[2]);
  /* 国名兜底 */
  s.loc = s.city || String(countryCn || '');
  return s;
}

/* ============ 病句检测（≥2 才动手；高危特征命中 1 条即动手） ============ */
function badOrderScore(zh) {
  let s = 0;
  if (/^在[一-龥a-zA-Z0-9]{1,20}(中|里|内)/.test(zh)) s += 2;   /* "在X中" 框架句开头 */
  if ((zh.match(/的/g) || []).length >= 3) s += 2;                 /* "的"字堆叠（欧化定语） */
  if (zh.split(/[,，、]/).length >= 4) s += 1;                     /* 碎句 */
  if (/^在[一-龥]{2,12}的?[一-龥]{2,10}[，,]/.test(zh)) s += 2;    /* "在X的Y，" 地点状语开头（机翻典型） */
  if (/[一-龥]\s*\d+\s*岁\s*，/.test(zh)) s += 1;                  /* "，13岁，" 插入语 */
  if (/^(因为|作为|尽管|然而|但是)/.test(zh)) s += 1;              /* 连接词开头（机翻语序） */
  if (/，(这|其|该)(是|意味着|表明)/.test(zh)) s += 1;              /* "，这是" 后置说明 */
  /* 2026-09-02 扩充（用户反馈：译文没有中文阅读逻辑） */
  if (/对[一-龥]{2,12}进行了[一-龥]{2,8}/.test(zh)) s += 2;        /* "对X进行了Y" 冗余结构 */
  if (/(?:[一-龥]{1,12}的){3,}/.test(zh)) s += 2;                  /* ≥3 连"的"定语链（欧化长定语） */
  if (/，作为[一-龥]{2,16}，/.test(zh)) s += 1;                    /* "，作为X，" 插入语错位 */
  if (/被[一-龥]{6,}(?:击中|击毙|打死|炸死|炸毁|摧毁|逮捕|拘留|扣押|绑架|暗杀|推翻|判刑|起诉|驱逐)/.test(zh)) s += 2; /* 欧化被动（"被"字+长串名词） */
  return s;
}

/* 高危病句特征（2026-09-02）：命中任意 1 条即允许条件重写，不必等 badOrder≥2。
 * 注意"被枪杀的"这类短被动是正常中文，不算欧化被动（要求"被"与动词间隔≥6字）。 */
function highRisk(zh) {
  return /对[一-龥]{2,12}进行了[一-龥]{2,8}/.test(zh)                    /* "对X进行了Y" */
    || /(?:[一-龥]{1,12}的){3,}/.test(zh)                              /* ≥3 连"的"定语链 */
    || /，作为[一-龥]{2,16}，/.test(zh)                                 /* 插入语错位 */
    || /被[一-龥]{6,}(?:击中|击毙|打死|炸死|炸毁|摧毁|逮捕|拘留|扣押|绑架|暗杀|推翻|判刑|起诉|驱逐)/.test(zh) /* 欧化被动 */
    || zh.split(/[,，、]/).length >= 4;                                 /* 一逗到底≥4 段 */
}

/* ============ 逐步变换（每步独立可回退） ============ */

/* ① 引导词剥离："据报道，" "消息人士称，" 等 */
function stripLeadIn(zh) {
  return zh.replace(/^(据报道|消息人士称|目击者说|警方称|官方表示|当局称|政府称|军方称|消息称|据悉|通讯社报道)[，,]?\s*/, '');
}
/* ② 插入语规整："X，13岁，Y" → "X（13岁）Y"；"X，一名Y，Z" → "一名Y的X在Z"？保守：只做年龄 */
function fixAgeInsert(zh) {
  return zh.replace(/([一-龥a-zA-Z]{1,12})\s*，\s*(\d+)\s*岁\s*，\s*/g, '$1（$2岁）');
}
/* ③ 框架句重组："在X中有N人在Y中受伤/死亡" → "X发生Y，N人受伤/死亡" */
function fixFrameCas(zh) {
  return zh.replace(
    /在([一-龥]{2,14})中有(\d+)人在([一-龥]{2,14})中(受伤|死亡|丧生|遇难|身亡|失踪)/,
    '$1发生$3，$2人$4'
  );
}
/* ④ 一般框架句："在X的Y中，Z" → "X Y，Z"；"在X的Y，Z"（地点状语开头）→ "X Y，Z" */
function fixFrameGeneric(zh) {
  let t = zh.replace(/^在([一-龥]{2,12})的([一-龥]{2,10})中[，,]?\s*/, '$1$2，');
  t = t.replace(/^在([一-龥]{2,12})的([一-龥]{2,10})[，,]\s*/, '$1$2，');
  return t;
}
/* ⑤ 保底模板句（badOrder ≥ 3 且槽位齐）："【国·类型】核心分句，伤亡" */
function templateSentence(zh, s) {
  if (!s.type || !s.loc) return zh;
  /* 核心分句 = 含事件词/数字的最长分句，剥残余框架 */
  const parts = zh.split(/[,，、;；.。]/).filter(p => p && p.length >= 4);
  if (!parts.length) return zh;
  let core = parts.sort((a, b) => b.length - a.length)[0];
  core = core.replace(/^(在|据|但是|然而)/, '').trim();
  if (core.length < 6) return zh;
  let out = '【' + s.loc + '·' + s.type + '】' + core;
  if (s.cas.length) out += '，' + s.cas.join('，');
  /* 保护：模板句不短于原句一半，且中文占比不降 */
  if (out.replace(/[^\u4e00-\u9fa5]/g, '').length * 2 < zh.replace(/[^\u4e00-\u9fa5]/g, '').length) return zh;
  return out;
}
/* ⑥ "对X进行了Y" → "Y了X"（"对袭击进行了调查" → "调查了袭击"；Y 含"的"或超长则不动） */
function fixDuiJinxing(zh) {
  return zh.replace(/对([一-龥]{2,12})进行了([一-龥]{2,8})(?![一-龥])/g, (m, obj, verb) =>
    (verb.includes('的') || verb.length > 6) ? m : verb + '了' + obj);
}
/* ⑦ "X，作为Y，Z" → "作为Y，X Z"（插入语归位："拉合尔，作为文化首都，发生爆炸"） */
function fixAsAppositive(zh) {
  return zh.replace(/^([一-龥]{2,12})，作为([^，。！？]{2,16})，/, '作为$2，$1');
}
/* ⑧ 后置时间状语归位："暂停所有学术活动周三后，" → "周三后暂停所有学术活动，"
 * （机翻把 after Wednesday 甩到句尾；仅限具体日词+逗号/句末边界，"定于/在/至"结尾的正常语序不动） */
function fixTimePostfix(zh) {
  return zh.replace(/([一-龥A-Za-z0-9]{2,14})((?:周[一二三四五六日末]|本周|下周|今日|明日|昨日|当天|次日)后)(?=[，,。；;]|$)/g,
    (m, obj, time) => /[于在至到]$/.test(obj) ? m : time + obj);
}

/* ============ 主入口 ============ */
function rewrite(zh, meta) {
  let t = String(zh || '').trim();
  if (!t) return t;
  /* 碎片标题（以逗号/顿号/冒号或动词原形开头）即使 <8 字也处理（2026-09-02：
   * "，造成3人死亡" 这类残片不能因短而放过）；健康短文本仍跳过 */
  const fragment = /^[，,、；;：:]|^(暂停|继续|开始|宣布|表示|证实|否认|拒绝|要求|呼吁|报道|发生|爆发|引发|导致|造成|涉嫌|逮捕|拘留)/.test(t);
  if (t.length < 8 && !fragment) return t;
  if (!/[\u4e00-\u9fa5]/.test(t)) return t;           /* 非中文主体不重写 */
  /* 碎片开头悬空标点清理 */
  if (/^[，,、；;：:]+/.test(t)) t = t.replace(/^[，,、；;：:\s]+/, '').trim();
  const orig = t;
  const risky = highRisk(t);                          /* 高危病句：命中 1 条即触发条件重写 */

  /* 高置信变换：无条件执行（模式精确不误伤） */
  t = stripLeadIn(t);
  t = fixAgeInsert(t);
  t = fixFrameCas(t);
  t = fixTimePostfix(t);
  t = fixDuiJinxing(t);
  t = fixAsAppositive(t);
  /* 变换后复评病句分：已修好的句子不再叠加更激进的重写（防"对X进行了Y"修好后又被模板句包一层） */
  const score2 = badOrderScore(t);
  /* 条件变换：病句分达标或命中高危特征时做（泛化框架/模板句有结构假设） */
  if (score2 >= 2 || risky) t = fixFrameGeneric(t);
  if (score2 >= 3) t = templateSentence(t, slots(t, meta && meta.country));

  /* 终检：产出异常回退 */
  if (!t || t.length < 6) return orig;
  if (/[A-Za-z]/.test(t) && (t.match(/[A-Za-z]/g) || []).length > (orig.match(/[A-Za-z]/g) || []).length) return orig;
  return t.trim();
}

/* ============ L4 可读性质量评分（0-100，度量+监控用，不做硬阻塞） ============
 * 分项：混排残留（英文实义词）/ 译腔（badOrder）/ 要素完整度（地点+事件词+数字）。
 * 挂点：_localizeTitleTail 打分存 it.zhq + 采样日志；持续 <60 分批次触发告警观察。 */
function quality(zh) {
  const t = String(zh || '');
  if (!t) return 0;
  let score = 100;
  /* 混排：英文实义词（≥4字母且非常见保留词）每个 -8；
   * 2026-09-02：IRGC/TTP/ICE 类全大写缩写（专名）不扣分 */
  const keep = new Set(['CPEC', 'AK', 'COVID', 'OPEC', 'BRICS', 'G7', 'G20', 'AI']);
  const isAbbr = w => keep.has(w.toUpperCase()) || /^[A-Z]{2,6}$/.test(w);
  const enWords = (t.match(/[A-Za-z]{3,}/g) || []).filter(w => !isAbbr(w));
  if (enWords.length) score -= Math.min(40, enWords.length * 8);
  /* 尾部残留英文实词（媒体名/专名漏剥，如 "……袭击 Realclear Politics"）→ 再扣 15，
   * 供下游（server.js zhq<40 pivot 重译兜底）感知；尾部全为全大写缩写（IRGC）不扣 */
  const tail = t.match(/[A-Za-z][A-Za-z\s\-–—·&]*$/);
  if (tail) {
    const ws = tail[0].trim().split(/[\s\-–—·&]+/).filter(Boolean);
    if (ws.some(w => !isAbbr(w) && w.length >= 3)) score -= 15;
  }
  /* 译腔 */
  score -= Math.min(30, badOrderScore(t) * 6);
  /* 要素完整度：地点词 + 事件词 + 数字，各缺 -10 */
  if (!/[一-龥]{2}(省|市|州|首都|地区|镇|港|岛|边境)/.test(t) && !/(尼日利亚|巴基斯坦|阿富汗|肯尼亚|索马里|马里|尼日尔|印度|苏丹|缅甸|刚果|叙利亚|伊拉克|伊朗|乌克兰|俄罗斯|中国|越南|泰国|菲律宾|印尼|孟加拉)/.test(t)) score -= 10;
  if (!/(袭击|爆炸|绑架|枪击|冲突|洪水|地震|疫情|抗议|制裁|死亡|受伤|遇难|逮捕|事故|劫持|罢工|打击|空袭)/.test(t)) score -= 10;
  if (!/\d/.test(t)) score -= 10;
  return Math.max(0, Math.min(100, score));
}

module.exports = { rewrite, badOrderScore, highRisk, classify, slots, quality };
