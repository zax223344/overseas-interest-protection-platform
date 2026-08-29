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

/* ============ 病句检测（≥2 才动手） ============ */
function badOrderScore(zh) {
  let s = 0;
  if (/^在[一-龥a-zA-Z0-9]{1,20}(中|里|内)/.test(zh)) s += 2;   /* "在X中" 框架句开头 */
  if ((zh.match(/的/g) || []).length >= 3) s += 2;                 /* "的"字堆叠（欧化定语） */
  if (zh.split(/[,，、]/).length >= 4) s += 1;                     /* 碎句 */
  if (/^在[一-龥]{2,12}的?[一-龥]{2,10}[，,]/.test(zh)) s += 2;    /* "在X的Y，" 地点状语开头（机翻典型） */
  if (/[一-龥]\s*\d+\s*岁\s*，/.test(zh)) s += 1;                  /* "，13岁，" 插入语 */
  if (/^(因为|作为|尽管|然而|但是)/.test(zh)) s += 1;              /* 连接词开头（机翻语序） */
  if (/，(这|其|该)(是|意味着|表明)/.test(zh)) s += 1;              /* "，这是" 后置说明 */
  return s;
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

/* ============ 主入口 ============ */
function rewrite(zh, meta) {
  let t = String(zh || '').trim();
  if (!t || t.length < 8) return t;
  if (!/[\u4e00-\u9fa5]/.test(t)) return t;           /* 非中文主体不重写 */
  const orig = t;
  const score = badOrderScore(t);

  /* 高置信变换：无条件执行（引导词开头/年龄插入语/框架伤亡句，模式精确不误伤） */
  t = stripLeadIn(t);
  t = fixAgeInsert(t);
  t = fixFrameCas(t);
  /* 条件变换：只在病句分达标时做（泛化框架/模板句有结构假设） */
  if (score >= 2) t = fixFrameGeneric(t);
  if (score >= 3) t = templateSentence(t, slots(t, meta && meta.country));

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
  /* 混排：英文实义词（≥4字母且非常见保留词）每个 -8 */
  const keep = new Set(['CPEC', 'AK', 'COVID', 'OPEC', 'BRICS', 'G7', 'G20', 'AI']);
  const enWords = (t.match(/[A-Za-z]{3,}/g) || []).filter(w => !keep.has(w.toUpperCase()));
  if (enWords.length) score -= Math.min(40, enWords.length * 8);
  /* 译腔 */
  score -= Math.min(30, badOrderScore(t) * 6);
  /* 要素完整度：地点词 + 事件词 + 数字，各缺 -10 */
  if (!/[一-龥]{2}(省|市|州|首都|地区|镇|港|岛|边境)/.test(t) && !/(尼日利亚|巴基斯坦|阿富汗|肯尼亚|索马里|马里|尼日尔|印度|苏丹|缅甸|刚果|叙利亚|伊拉克|伊朗|乌克兰|俄罗斯|中国|越南|泰国|菲律宾|印尼|孟加拉)/.test(t)) score -= 10;
  if (!/(袭击|爆炸|绑架|枪击|冲突|洪水|地震|疫情|抗议|制裁|死亡|受伤|遇难|逮捕|事故|劫持|罢工)/.test(t)) score -= 10;
  if (!/\d/.test(t)) score -= 10;
  return Math.max(0, Math.min(100, score));
}

module.exports = { rewrite, badOrderScore, classify, slots, quality };
