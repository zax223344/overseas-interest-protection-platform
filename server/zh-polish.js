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

/* ============ ② 媒体自称词表（尾部剥离用） ============ */
/* 英文媒体名/域名：尾部命中即剥离（大小写不敏感） */
const MEDIA_EN = [
  'THISDAYLIVE', 'Devdiscourse', 'Newswire', 'africanews', 'Africanews',
  'CapitalFM', 'Capital FM', 'DAILY POST', 'Daily Trust', 'Vanguard', 'Punch',
  'Premium Times', 'The Cable', 'Channels TV', 'Arise TV', 'TVC News',
];
/* 域名尾巴（正则片段）：-nhk.or.jp / -tgnews.com.ng / -vijesti.me 等 */
const DOMAIN_TAIL = '(?:\\.[a-z]{2,4}){1,2}';

/* 中文媒体名（机翻后仍残留的）：尾部命中即剥离 */
const MEDIA_ZH = [
  '每日信托', '纽约时报', '卫报尼日利亚新闻', '克什米尔自由新闻', '首尔经济日报',
  '印度斯坦时报', '布宜诺斯艾利斯时报', '艾雷德尔免费新闻', '新德里电视台',
  '印度新闻', '印度快报', '论坛报', '黎明报', '美联社新闻', '路透社新闻',
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

/* HTML 实体残留（Google News desc 路径偶发漏网） */
const ENTITY_FIX = [
  [/&#0?39;|&apos;/g, "'"],
  [/&quot;/g, '"'],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&#(\d+);/g, (m, d) => { try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return ''; } }],
];

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
    out = out.replace(/[\s\-–—|｜]{1,3}[一-龥]{2,8}\s*\.\s*(?:com|net|org|news|live)\s*$/i, '').trim();
    /* 尾部 "- XX报/日报/时报/新闻/周刊/通讯社/先驱报"（通用启发：正常标题不会以"- 媒体型后缀词"结尾，
     * 兜住词表外的东方先驱报/《卫报》尼日利亚新闻类长尾） */
    out = out.replace(/[\s\-–—|｜]{1,3}[《“]?[一-龥]{2,10}(?:报|日报|时报|新闻|周刊|通讯社|电视台|电台|先驱报|邮报)[》”]?\s*$/, '').trim();
    /* 尾部 "- ThePointNG" 类词表外无点英文媒体名（首字母大写驼峰，剥后主体须仍含中文且≥8字）。
     * 正常中文标题不会以 "- 英文大写词组" 结尾；主体保护双条件防误剥。 */
    const gen = out.match(/[\s\-–—|｜]{1,3}([A-Z][A-Za-z]{3,20})\s*$/);
    if (gen) {
      const kept = out.slice(0, gen.index).trim();
      if (/[\u4e00-\u9fa5]/.test(kept) && kept.replace(/[^\u4e00-\u9fa5]/g, '').length >= 8) out = kept;
    }
    if (out === before) break;
  }
  return out;
}

/* 标题/正文通用抛光：URL、emoji、实体、标点、缩写 */
function polish(text) {
  let t = String(text || '');
  if (!t) return t;
  /* HTML 实体 */
  for (const [re, to] of ENTITY_FIX) t = t.replace(re, to);
  /* URL 残留（含全角冒号变体 https：//）——标题正文都不该有 */
  t = t.replace(/https?[:：]\/\/\S*/gi, '');
  /* emoji / 变体选择符 / 各类符号残留 */
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}\u{200B}-\u{200D}]/gu, '');
  /* 前缀 "上一篇：" "下一篇：" "最新：" */
  t = t.replace(/^(上一篇|下一篇|最新|更新|快讯|突发)[:：]\s*/, '');
  /* 首句引导词剥离："据报道，" "消息人士称，"（标题正文通用，机翻高频） */
  t = t.replace(/^(据报道|消息人士称|目击者说|警方称|官方表示|当局称|政府称|军方称|据悉)[，,]?\s*/, '');
  /* 尾部 "作者：xxx（，xxx记者）" */
  t = t.replace(/\s*作者[:：].*$/, '');
  /* 尾部 @handle（@CapitalFM） */
  t = t.replace(/\s*@[A-Za-z0-9_]{2,20}\s*$/, '');
  /* 标点/数字硬伤 */
  for (const [re, to] of PUNCT_FIX) t = t.replace(re, to);
  /* 缩写替换（左右非字母数字边界） */
  for (const [k, v] of Object.entries(ABBR)) {
    t = t.replace(new RegExp('(?<![A-Za-z0-9])' + k + '(?![A-Za-z0-9])', 'g'), v);
  }
  for (const [k, v] of Object.entries(NAMES)) {
    t = t.replace(new RegExp('(?<![A-Za-z0-9])' + k + '(?![A-Za-z0-9])', 'g'), v);
  }
  return t.trim();
}

/* 标题专用抛光：通用 polish + 尾部媒体剥离（正文太长不剥尾，防误伤） */
function polishTitle(text) {
  let t = polish(text);
  if (!t) return t;
  t = _stripMediaTail(t);
  /* 剥完收尾：尾部悬空连接符/引号清理（’为实体&#8217;转换残留；“”正常引语不清防破坏引语） */
  t = t.replace(/[\s\-–—|｜,，:：'’]+$/, '').trim();
  return t;
}

module.exports = { polish, polishTitle, ABBR, NAMES, MEDIA_EN, MEDIA_ZH };
