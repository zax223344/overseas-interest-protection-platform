'use strict';
const netx = require('./netx');
/* ============================================================================
 * server/fulltext.js —— 情报正文深度抽取引擎（Full-Text & Fact Extraction）
 * ----------------------------------------------------------------------------
 * 背景：RSS / GDELT 等聚合源返回的 description 往往等于 title（一句话概述），
 *       入库后预警详情只有一行标题，分析员无法判断"发生了什么、伤亡多少、
 *       涉及哪家中资企业、我方资产是否受损"。
 *
 * 本模块职责：
 *   ① 回源抓取原文 HTML（真实网络请求，绝不生成内容）
 *   ② 抽取正文段落（article / articleBody / 语义容器 / <p> 兜底 多策略打分）
 *   ③ 抽取元数据（发布时间、作者、站点名、首图、语言）
 *   ④ 结构化要素抽取 factSheet：伤亡、金额、时间、地点、涉事主体、
 *      武装组织、处置行动、事件性质 —— 全部来自正文原文，逐条附带原文佐证句
 *
 * 铁律：抽不到就是抽不到。失败返回 null，由调用方降级保留原始摘要，
 *       绝不编造任何一个字。
 * ==========================================================================*/

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ===== 网络层 ===== */
async function _fetchHtml(url, timeout) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const r = await netx.smartFetch(url, {
      timeout: timeout || 9000,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache'
      }
    });
    if (!r.ok) return null;
    const ct = String(r.headers.get('content-type') || '');
    if (ct && !/html|xml|text/i.test(ct)) return null;
    const html = await r.text();
    /* 超大页面截断，避免正则回溯爆栈 */
    return html.length > 1600000 ? html.slice(0, 1600000) : html;
  } catch (e) {
    return null;
  }
}

/* ===== HTML 工具 ===== */
const _ENT = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&ldquo;': '"', '&rdquo;': '"', '&lsquo;': "'",
  '&rsquo;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&middot;': '·',
  '&laquo;': '«', '&raquo;': '»', '&euro;': '€', '&pound;': '£', '&yen;': '¥',
  '&copy;': '©', '&reg;': '®', '&deg;': '°', '&times;': '×', '&bull;': '·'
};
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip|middot|laquo|raquo|euro|pound|yen|copy|reg|deg|times|bull);/g,
      m => _ENT[m] || m)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } });
}

/* 移除非正文块级噪声 */
function stripNoiseBlocks(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ');
}

function tagText(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')          /* 换行/制表全部压平，避免导航块伪装成长段落 */
    .trim();
}

/* 段落噪声：导航、订阅、版权、广告、社交按钮 */
const NOISE_PARA_RE = new RegExp([
  'cookie', 'subscribe', 'newsletter', 'advertisement', 'sponsored content',
  'all rights reserved', 'terms of (use|service)', 'privacy policy',
  'sign (up|in) (to|for)', 'follow us on', 'share this', 'read more',
  'click here', 'related articles', 'most read', 'trending now',
  'copyright ©', 'reuters\\. all', 'ap\\. all',
  '版权所有', '未经授权', '不得转载', '责任编辑', '扫码关注', '关注我们',
  '点击.{0,4}(查看|阅读|下载)', '阅读原文', '更多精彩', '推荐阅读', '相关阅读',
  '广告', '订阅', '登录后可', '评论区', '免责声明', '本文来源', '稿件来源'
].join('|'), 'i');

/* 导航/菜单/栏目条识别：这类块常被误当成长段落混进正文首段 */
const NAV_WORD_RE = /首页|风闻|频道|栏目|客户端|APP下载|下载客户端|登录|注册|个人中心|关于我们|联系我们|加入我们|网站地图|意见反馈|投稿|广告合作|更多>|查看更多|上一页|下一页|返回顶部|搜索|导航|专题|排行|热搜|直播|视频|图片|专栏|观察员|会员|我的|设置|退出|Home|Log ?in|Sign ?in|Sign ?up|Register|Menu|Search|Sections?|Newsletters?|About ?Us|Contact ?Us|Site ?map|Subscribe|Watch|Listen|Podcasts?|Games|Puzzles|Weather|Sports|Culture|Travel|Lifestyle|More ?»/gi;

function _looksLikeNav(t) {
  /* ① 命中大量导航词 */
  const navHits = (t.match(NAV_WORD_RE) || []).length;
  if (navHits >= 4) return true;
  /* ② 标点密度极低但长度很长 —— 典型的词条堆砌 */
  const punct = (t.match(/[。，、；：！？.,;:!?"'）)]/g) || []).length;
  const density = punct / t.length;
  if (t.length > 120 && density < 0.012) return true;
  if (t.length > 60 && punct === 0) return true;
  /* ③ 短 token 密集（英文导航栏） */
  const toks = t.split(/\s+/);
  if (toks.length > 14) {
    const avg = t.replace(/\s+/g, '').length / toks.length;
    if (avg < 4.2 && density < 0.02) return true;
  }
  return false;
}

/* 署名/时间戳/站点推广样板：多见于 AP、路透等站点的正文首块，
 * 形如 "By MARI YAMAGUCHI Updated [hour]:[minute] ... Add AP News on Google ..."。
 * 这类内容不是事实细节，必须剔除，否则预警详情首段全是噪声。 */
const BYLINE_NOISE_RE = new RegExp([
  '\\[hour\\]|\\[minute\\]|\\[AMPM\\]|\\[timezone\\]|\\[monthFull\\]|\\[year\\]|\\[day\\]',
  'Add .{0,20}News (on|as) (Google|your)',
  'preferred source',
  'Leer en español',
  'Copyright \\d{4} The Associated Press',
  'All rights reserved',
  'This story (has been|was) (updated|corrected)',
  'Follow (AP|Reuters|us) (on|at)',
  'Sign up for (our|the) newsletter',
  'Share (this )?(on|via)',
  '本文为.{0,10}原创',
  '点击进入专题'
].join('|'), 'i');

function _isGoodParagraph(t) {
  if (!t) return false;
  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  const isCjk = cjk > t.length * 0.3;
  const minLen = isCjk ? 24 : 50;                 /* 中文段落阈值更低 */
  if (t.length < minLen) return false;
  if (t.length > 4000) return false;              /* 异常超长 = 整页塌陷成一块 */
  if (NOISE_PARA_RE.test(t)) return false;
  if (BYLINE_NOISE_RE.test(t)) return false;
  /* 纯署名行： "By XXX YYY" 开头且很短 */
  if (/^By\s+[A-Z][A-Za-z.'\-]+(\s+[A-Z][A-Za-z.'\-]+){0,3}\s*$/.test(t)) return false;
  /* 记者简介块："XXX is based in Tokyo and covers ... for The Associated Press. twitter mailto" */
  if (/\b(is|are) based in\b[\s\S]{0,200}\bcovers?\b/i.test(t)) return false;
  if (/\b(twitter|mailto|instagram|facebook)\b\s*$/i.test(t) && t.length < 400) return false;
  if (/^[A-Z][A-Za-z.'\- ]{2,40}\s+(is|was) (a|an|the) [a-z]+ (reporter|correspondent|writer|editor)\b/.test(t)) return false;
  if (/^[A-Z\s|·\-–—]{10,}$/.test(t)) return false;
  if (_looksLikeNav(t)) return false;
  /* 正文段落至少要有一个句子终止符 */
  if (isCjk) {
    if (!/[。！？；]/.test(t) && t.length < 60) return false;
  } else {
    if (!/[.!?]/.test(t)) return false;
  }
  return true;
}

/* 从一段 HTML 中取出所有合格段落
 * 说明：只取 p / h2 / h3 / blockquote。刻意排除 <li>——导航菜单与
 *       "相关阅读"列表几乎都是 li，且嵌套 li 会让非贪婪正则吞掉整块页面。 */
/* 剥离段首样板：署名、更新时间占位、站点推广语。
 * 采用"先剥离再判定"而不是"整段丢弃"，避免样板与正文粘在同一个块时误删真实内容。 */
const BOILER_PREFIX_RES = [
  /^By\s+[A-Z][A-Za-z.'\-]*(\s+[A-Z][A-Za-z.'\-]*){0,4}\s*/,
  /^(Updated|Published)\s*[^A-Za-z\u4e00-\u9fa5]{0,60}(\[[a-zA-Z]+\][^A-Za-z\u4e00-\u9fa5]{0,6}){1,8}\s*/i,
  /^(Updated|Published)\s+\d{1,2}:\d{2}\s*(AM|PM)?[^.]{0,50}?\d{4}\s*/i,
  /^Leer en español\s*/i,
  /^(Add\s+[A-Za-z ]{0,20}News\s+(on\s+Google|as\s+your\s+preferred\s+source)\s*)+/i,
  /^Share\s+(this\s+)?(on|via)[^.]{0,40}/i
];
function _stripBoilerplatePrefix(t) {
  let s = String(t || '').trim();
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const re of BOILER_PREFIX_RES) {
      const n = s.replace(re, '').trim();
      if (n !== s) { s = n; changed = true; }
    }
    if (!changed) break;
  }
  return s;
}

function _paragraphsFrom(htmlChunk) {
  const out = [];
  const seen = {};
  const blocks = String(htmlChunk || '').match(/<(p|h2|h3|blockquote)[^>]*>[\s\S]*?<\/\1>/gi) || [];
  blocks.forEach(b => {
    const t = _stripBoilerplatePrefix(tagText(b));
    if (!_isGoodParagraph(t)) return;
    const k = t.slice(0, 40);
    if (seen[k]) return;
    seen[k] = 1;
    out.push(t);
  });
  return out;
}

/* 候选正文容器（按优先级），逐个打分取最优 */
const CONTAINER_PATTERNS = [
  /<article[^>]*>([\s\S]*?)<\/article>/gi,
  /<div[^>]*itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<aside|$)/gi,
  /<div[^>]*(?:class|id)=["'][^"']*(?:article-body|articlebody|article__body|article-content|story-body|story__body|entry-content|post-content|post-body|content__article-body|caas-body|rich_media_content|main-content|news-content|content-body|body-text|text-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<aside|$)/gi,
  /<main[^>]*>([\s\S]*?)<\/main>/gi,
  /<section[^>]*(?:class|id)=["'][^"']*(?:article|content|story)[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi
];

function extractParagraphs(cleanHtml) {
  let best = [];
  let bestScore = 0;
  for (const re of CONTAINER_PATTERNS) {
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(cleanHtml)) && guard++ < 8) {
      const paras = _paragraphsFrom(m[1] || m[0]);
      const score = paras.reduce((a, p) => a + p.length, 0);
      if (score > bestScore) { bestScore = score; best = paras; }
    }
    if (bestScore > 600) break;   /* 已找到足够充实的正文，不再往下试 */
  }
  /* 兜底：全页 <p> 聚合 */
  if (bestScore < 260) {
    const all = _paragraphsFrom(cleanHtml);
    const score = all.reduce((a, p) => a + p.length, 0);
    if (score > bestScore) best = all;
  }
  return best;
}

/* ===== 元数据 ===== */
function _meta(html, names) {
  for (const n of names) {
    let m = html.match(new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + n + '["\'][^>]*content=["\']([^"\']{2,600})["\']', 'i'));
    if (m) return decodeEntities(m[1]).trim();
    m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']{2,600})["\'][^>]*(?:property|name|itemprop)=["\']' + n + '["\']', 'i'));
    if (m) return decodeEntities(m[1]).trim();
  }
  return '';
}

/* 发布时间兜底：大量新闻站把日期写在 URL 路径里（/2026/08/03/、/2026_08_03_） */
function _dateFromUrl(url) {
  const m = String(url || '').match(/(20\d{2})[\/_\-](\d{1,2})[\/_\-](\d{1,2})/);
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function extractMeta(html, url) {
  const summary = _meta(html, ['og:description', 'twitter:description', 'description']);
  const publishedAt = _meta(html, [
    'article:published_time', 'article:modified_time', 'og:updated_time',
    'datePublished', 'pubdate', 'publishdate', 'date', 'DC.date.issued', 'sailthru.date'
  ]) || (function () {
    const m = html.match(/<time[^>]+datetime=["']([^"']{8,40})["']/i);
    return m ? m[1] : '';
  })() || _dateFromUrl(url);
  const author = _meta(html, ['author', 'article:author', 'og:article:author', 'twitter:creator', 'byl'])
    .replace(/^by\s+/i, '').slice(0, 60);
  let siteName = _meta(html, ['og:site_name', 'application-name', 'twitter:site']);
  if (!siteName) { try { siteName = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { siteName = ''; } }
  const image = _meta(html, ['og:image', 'twitter:image', 'twitter:image:src']);
  const ogTitle = _meta(html, ['og:title', 'twitter:title']) ||
    (function () { const m = html.match(/<title[^>]*>([\s\S]{2,300}?)<\/title>/i); return m ? decodeEntities(m[1]).trim() : ''; })();
  const lang = (html.match(/<html[^>]+lang=["']([a-zA-Z\-]{2,8})["']/i) || [, ''])[1];
  return { summary, publishedAt, author, siteName, image, ogTitle, lang };
}

/* ============================================================================
 * 结构化要素抽取 factSheet
 * 面向"中国海外利益安全"业务场景，抽取分析员真正需要的硬信息。
 * 每一项都附带正文原句作为佐证（evidence），可溯源、不可编造。
 * ==========================================================================*/

function _sentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?;；])\s*|(?<=\.)\s+(?=[A-Z])|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 6);
}

function _findAll(text, re, cap) {
  const out = [];
  const seen = {};
  let m;
  re.lastIndex = 0;
  let guard = 0;
  while ((m = re.exec(text)) && guard++ < 200) {
    const v = (m[0] || '').trim();
    if (!v || seen[v.toLowerCase()]) continue;
    seen[v.toLowerCase()] = 1;
    out.push(v);
    if (out.length >= (cap || 6)) break;
  }
  return out;
}

/* 伤亡：中英双语 */
const RE_KILLED = /(\d{1,5})\s*(?:名|人|位)?\s*(?:中国公民|中方人员|中国工人|工人|员工|平民|士兵|人质)?\s*(?:被打死|遇难|死亡|身亡|丧生|罹难|被杀|遭杀害)|(?:killed|dead|died|fatalities|death toll of)\s*[:\s]*(\d{1,5})|(\d{1,5})\s*(?:people|persons|workers|nationals|civilians|soldiers)?\s*(?:were\s+)?(?:killed|dead|died)/gi;
const RE_INJURED = /(\d{1,5})\s*(?:名|人|位)?\s*(?:中国公民|中方人员|工人|员工|平民)?\s*(?:受伤|负伤|重伤|轻伤)|(?:injured|wounded|hurt)\s*[:\s]*(\d{1,5})|(\d{1,5})\s*(?:people|persons|workers|others)?\s*(?:were\s+)?(?:injured|wounded)/gi;
const RE_MISSING = /(\d{1,5})\s*(?:名|人)?\s*(?:失踪|下落不明|被绑架|遭绑架|被劫持|被扣押)|(?:missing|kidnapped|abducted|held hostage|detained)\s*[:\s]*(\d{1,5})|(\d{1,5})\s*(?:people|workers|crew|nationals)?\s*(?:were\s+)?(?:missing|kidnapped|abducted|detained)/gi;
/* 金额/损失 */
/* 金额必须带货币标识，避免 "6 billion people" 这类非金额数字被误判为损失 */
const RE_MONEY = /(?:US\$|USD|RMB|CNY|EUR|GBP|JPY|€|£|¥|\$)\s?\d[\d,.]{0,15}\s*(?:亿|万亿|万|千万|百万|million|billion|trillion|bn)?|\d[\d,.]{0,15}\s*(?:亿|万亿|万|千万|百万)?\s*(?:美元|人民币|欧元|英镑|日元|卢比|卢布|第纳尔)|\d[\d,.]{0,15}\s*(?:million|billion|trillion)\s+(?:dollars?|euros?|yuan|pounds?|USD|EUR|RMB)/gi;
/* 时间点 */
const RE_DATE = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*(?:凌晨|上午|中午|下午|傍晚|晚间|深夜)?\s*\d{1,2}\s*[:时点]\s*\d{0,2}\s*分?)?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|(?:周|星期)[一二三四五六日天]|(?:on\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/gi;
/* 武装/威胁行为体 */
const RE_ACTOR = /俾路支解放军|俾路支解放阵线|\bBLA\b|\bBLF\b|塔利班|\bTaliban\b|巴基斯坦塔利班|\bTTP\b|伊斯兰国|\bISIS\b|\bISIL\b|\bDaesh\b|呼罗珊|\bISKP\b|基地组织|al[- ]?Qaeda|博科圣地|Boko Haram|索马里青年党|al[- ]?Shabaab|胡塞武装|\bHouthis?\b|真主党|\bHezbollah\b|哈马斯|\bHamas\b|\bM23\b|瓦格纳|\bWagner\b|海盗|\bpirates?\b|反政府武装|叛军|\brebels?\b|\bmilitants?\b|\binsurgents?\b|极端分子|恐怖分子|武装分子|\bgunmen\b|\bassailants?\b/gi;
/* 事件性质 */
const RE_INCIDENT = /自杀式(?:炸弹)?袭击|汽车炸弹|路边炸弹|爆炸袭击|恐怖袭击|武装袭击|枪击|绑架|劫持|抢劫|纵火|骚乱|暴乱|示威|游行|罢工|封锁|政变|军事冲突|交火|空袭|炮击|无人机袭击|导弹袭击|海盗劫持|网络攻击|数据泄露|制裁|禁令|征收|国有化|强制关停|吊销执照|反倾销|反补贴|安全事故|矿难|坍塌|火灾|泄漏|疫情|地震|洪水|台风|山体滑坡|suicide (?:bomb|attack)|car bomb|\bIEDs?\b|terror(?:ist)? attack|armed attack|\bshootings?\b|\bkidnapping\b|\babduction\b|\bhijack\w*\b|\barson\b|\briots?\b|\bunrest\b|\bprotests?\b|general strike|labou?r strike|\bblockade\b|\bcoup\b|\bairstrikes?\b|\bshelling\b|drone (?:strike|attack)|missile (?:strike|attack)|\bpiracy\b|cyber ?attack|data breach|\bsanctions?\b|export ban|expropriation|nationaliz\w*|mine collapse|\bexplosions?\b|\bwildfires?\b|gas leak|oil leak|\boutbreak\b|\bearthquakes?\b|\bfloods?\b|\btyphoons?\b|\blandslides?\b|bomb threat|death threat|\bthreatening (?:messages?|calls?|letters?)\b|\btrespass\w*\b|\bbreak-?in\b|\bintrusion\b|knife attack|\bstabbing\b|\bassaulted?\b|\bharassment\b|\bvandalism\b|\bdefaced?\b|\bdetention\b|\bdeported\b|\bexpelled\b|\bvisa (?:ban|restriction)\b|恐吓|炸弹威胁|安全威胁|非法闯入|强行闯入|持刀|持械|袭扰|骚扰|打砸|涂鸦破坏|扣押|拘留|遣返|驱逐出境|签证限制|停牌|摘牌|退市|实体清单|出口管制|强制审查|突击检查|查封/gi;
/* 我方处置行动 */
const RE_RESPONSE = /启动应急|应急响应|紧急撤离|组织撤离|撤侨|安全转移|暂停施工|停工|停产|关闭|加强安保|增派安保|提醒(?:中国)?公民|安全提醒|领事保护|领保|发布(?:安全)?警示|(?:大使馆|领事馆|使馆)(?:已|正)?(?:交涉|抗议|要求|敦促|核实|启动)|外交部(?:表示|回应|要求|敦促)|派出工作组|驻华|evacuat|suspend(?:ed)? (?:work|operation|production)|halt(?:ed)?|shut ?down|step(?:ped)? up security|travel (?:advisory|warning)|consular (?:protection|assistance)|embassy (?:said|urged|demanded|protested|confirmed)|foreign ministry|bomb (?:hunt|search|sweep|squad)|\barrested\b|\bdetained\b|police (?:investigation|probe|patrol)|lodged (?:a )?(?:protest|complaint)|filed (?:a )?(?:protest|complaint)|summoned the (?:ambassador|envoy)|issued (?:a )?(?:warning|alert|advisory)|报警|立案侦查|排爆|搜爆|加派警力|外交交涉|提出严正交涉|已被逮捕|已被拘留/gi;
/* 中方主体线索（正文里出现的中资/中国相关主体） */
const RE_CN_SUBJ = /中(?:国|方|资|企)[\u4e00-\u9fa5]{0,10}(?:公司|企业|集团|工厂|项目|工地|矿|电站|港口|铁路|大使馆|领事馆|工人|员工|公民|游客|船员|承包商)|(?:中国)?(?:华为|中兴通讯|中石油|中石化|中海油|国家电网|中国建筑|中国中铁|中铁建|中交建|中电建|中能建|中冶|中土|中钢|中铝|五矿|紫金矿业|洛阳钼业|宁德时代|比亚迪|\bBYD\b|吉利汽车|上汽集团|长城汽车|奇瑞|海尔|美的集团|小米|\bOPPO\b|\bvivo\b|阿里巴巴|腾讯|字节跳动|京东|拼多多|希音|\bSHEIN\b|\bTikTok\b|中远海运|\bCOSCO\b|招商局|中粮|三一重工|徐工|中信集团|工商银行|建设银行|中国银行|农业银行|国开行|进出口银行)|Chinese[- ](?:company|firm|companies|national|worker|engineer|contractor|embassy|consulate|investor|vessel|crew|mine|factory|project|state[- ]owned)/gi;

function extractFacts(text) {
  const t = String(text || '');
  if (t.length < 40) return null;
  const sents = _sentences(t);

  function evidence(kw) {
    if (!kw) return '';
    const low = kw.toLowerCase();
    for (const s of sents) {
      if (s.toLowerCase().indexOf(low) >= 0) return s.length > 180 ? s.slice(0, 180) + '…' : s;
    }
    return '';
  }

  const killed = _findAll(t, RE_KILLED, 4);
  const injured = _findAll(t, RE_INJURED, 4);
  const missing = _findAll(t, RE_MISSING, 4);
  const money = _findAll(t, RE_MONEY, 5).filter(v => /\d/.test(v) && v.length <= 40);
  const dates = _findAll(t, RE_DATE, 4);
  const actors = _findAll(t, RE_ACTOR, 5);
  const incidents = _findAll(t, RE_INCIDENT, 6);
  const responses = _findAll(t, RE_RESPONSE, 5);
  const cnSubjects = _findAll(t, RE_CN_SUBJ, 6);

  const facts = [];
  function push(label, icon, values, tone) {
    if (!values || !values.length) return;
    facts.push({
      label: label,
      icon: icon,
      value: values.join(' / '),
      tone: tone || 'normal',
      evidence: evidence(values[0])
    });
  }
  push('人员死亡', '💀', killed, 'critical');
  push('人员受伤', '🩹', injured, 'high');
  push('失踪/被扣', '❓', missing, 'high');
  push('事件性质', '⚡', incidents, 'high');
  push('威胁行为体', '🎯', actors, 'critical');
  push('中方涉及主体', '🇨🇳', cnSubjects, 'key');
  push('涉及金额/损失', '💰', money, 'normal');
  push('事发时间线索', '🕐', dates, 'normal');
  push('已采取处置', '🛡️', responses, 'good');

  if (!facts.length) return null;
  return {
    facts: facts,
    casualty: {
      killed: killed.length ? killed[0] : '',
      injured: injured.length ? injured[0] : '',
      missing: missing.length ? missing[0] : ''
    },
    hasCasualty: !!(killed.length || injured.length || missing.length),
    hasCnSubject: !!cnSubjects.length,
    incidentTypes: incidents,
    actors: actors
  };
}

/* ============================================================================
 * 社交聚合页识别
 * Lemmy / Reddit / HN / Telegram 的帖子页正文往往是空的，页面主体是评论区。
 * 直接抓这类页面会把"别人的评论"当成情报正文，进而抽出完全错误的要素
 * （实测某 Lemmy 帖抽出 "61 killed / Hamas"，实为评论区其他话题）。
 * 因此：这类链接必须改抓帖子指向的原文外链；没有外链的一律不回源。
 * ==========================================================================*/
const SOCIAL_HOST_RE = /(^|\.)(lemmy[\w.-]*|lemm\.ee|mander\.xyz|feddit[\w.-]*|beehaw\.org|sh\.itjust\.works|programming\.dev|sopuli\.xyz|slrpnk\.net|midwest\.social|reddthat\.com|discuss\.online|infosec\.pub|hexbear\.net|lemmygrad\.ml|abolish\.capital|sdf\.org|reddit\.com|redd\.it|news\.ycombinator\.com|t\.me|telegram\.me|x\.com|twitter\.com|mastodon[\w.-]*|bsky\.app)$/i;

function isSocialAggregator(url) {
  try {
    const u = new URL(url);
    if (SOCIAL_HOST_RE.test(u.hostname)) return true;
    /* 通用联邦宇宙帖子路径 */
    if (/^\/(post|comment)s?\/\d+/.test(u.pathname)) return true;
    if (/^\/r\/[^/]+\/comments\//.test(u.pathname)) return true;
    return false;
  } catch (e) { return false; }
}

/* 无意义摘要过滤（og:description 常被填成平台名） */
const JUNK_SUMMARY_RE = /^(lemmy|reddit|hacker news|hackernews|telegram|twitter|x|facebook|mastodon|bluesky|discuss|forum|home ?page|untitled|null|undefined)\s*$/i;

/* ===== 主入口：抓取并抽取单篇 ===== */
async function fetchArticle(url, opts) {
  opts = opts || {};
  const html = await _fetchHtml(url, opts.timeout || 9000);
  if (!html) return null;

  const meta = extractMeta(html, url);
  const clean = stripNoiseBlocks(html);
  let paragraphs = extractParagraphs(clean);

  /* 段落上限：保留信息密度，控制存储 */
  const MAX_CHARS = opts.maxChars || 3200;
  const kept = [];
  let total = 0;
  for (const p of paragraphs) {
    if (total + p.length > MAX_CHARS) {
      const room = MAX_CHARS - total;
      if (room > 80) kept.push(p.slice(0, room) + '…');
      break;
    }
    kept.push(p);
    total += p.length;
  }
  paragraphs = kept;

  const fullText = paragraphs.join('\n\n');
  /* 正文太短视为抽取失败（付费墙 / JS 渲染 / 反爬），交由调用方降级 */
  if (fullText.length < 120 && !meta.summary) return null;

  const factSheet = extractFacts(fullText || meta.summary);
  let summary = meta.summary || '';
  if (summary.length < 25 || JUNK_SUMMARY_RE.test(summary)) summary = (paragraphs[0] || '').slice(0, 300);

  return {
    url: url,
    fullText: fullText,
    paragraphs: paragraphs,
    summary: summary,
    publishedAt: meta.publishedAt || '',
    author: meta.author || '',
    siteName: meta.siteName || '',
    image: meta.image || '',
    ogTitle: meta.ogTitle || '',
    lang: meta.lang || '',
    charCount: fullText.length,
    paraCount: paragraphs.length,
    factSheet: factSheet,
    extractedAt: new Date().toISOString()
  };
}

/* ===== 批量补全（并发池 + 降级）===== */
async function enrichBatch(items, opts) {
  opts = opts || {};
  const concurrency = opts.concurrency || 5;
  const timeout = opts.timeout || 9000;
  const minLen = opts.minLen || 200;          /* content 短于此值才回源 */
  const budgetMs = opts.budgetMs || 90000;    /* 总时间预算，超时停止后续 */
  const t0 = Date.now();

  /* 决定每条数据真正应该回源抓取的地址：
   * 社交帖 → 帖子指向的原文外链；普通新闻 → 自身 url */
  function _targetUrl(it) {
    const ext = it.ext_url || it.extUrl || '';
    if (ext && /^https?:\/\//i.test(ext) && !isSocialAggregator(ext)) return ext;
    const own = it.url || '';
    if (own && /^https?:\/\//i.test(own) && !isSocialAggregator(own)) return own;
    return '';                /* 社交页且无外链 → 不回源，保留原帖文内容 */
  }

  const targets = [];
  (items || []).forEach(it => {
    if (!it || it._ftDone) return;
    const cur = String(it.content || it.desc || '');
    const title = String(it.title || '');
    /* content 等于 title 或过短 → 需要回源补全 */
    if (cur.length >= minLen && cur.trim() !== title.trim()) return;
    const tu = _targetUrl(it);
    if (tu) { it._ftTarget = tu; targets.push(it); return; }
    /* 无可用链接：若调用方提供了标题反查能力，则先找回原文地址再抓
     * （部分历史条目在采集环节丢失了 url，只剩一句标题，是"没细节"的根源） */
    if (opts.resolveUrl && title.length >= 12 && !it._ftNoUrl) {
      it._ftNeedResolve = true;
      targets.push(it);
    }
  });

  const stat = { total: targets.length, ok: 0, fail: 0, skipped: (items || []).length - targets.length, chars: 0 };
  if (!targets.length) return stat;

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      if (Date.now() - t0 > budgetMs) return;
      const it = targets[idx++];
      /* 步骤①：必要时先按标题反查原文地址 */
      if (it._ftNeedResolve) {
        let found = '';
        try { found = await opts.resolveUrl(it.title, it); } catch (e) { found = ''; }
        if (found && /^https?:\/\//i.test(found) && !isSocialAggregator(found)) {
          it._ftTarget = found;
          it.url = it.url || found;
          it._urlResolved = true;
          stat.resolved = (stat.resolved || 0) + 1;
        } else {
          it._ftDone = true; it._ftNoUrl = true; stat.fail++;
          continue;
        }
      }
      /* 步骤②：回源抓取正文 */
      let art = null;
      try { art = await fetchArticle(it._ftTarget, { timeout: timeout }); } catch (e) { art = null; }
      it._ftDone = true;
      if (!art) { stat.fail++; it._ftFail = true; continue; }
      it.source_url = it._ftTarget;   /* 记录正文实际来源，便于溯源核验 */

      /* 正文写入：content 承载详情，原摘要保留在 excerpt */
      const oldContent = String(it.content || '');
      if (art.fullText && art.fullText.length > oldContent.length) {
        it.excerpt = oldContent.slice(0, 300);
        it.content = art.fullText;
      } else if (art.summary && art.summary.length > oldContent.length) {
        it.content = art.summary;
      }
      it.fullText = art.fullText || '';
      it.paragraphs = art.paragraphs || [];
      it.detail = art.fullText || art.summary || '';
      it.charCount = art.charCount || 0;
      it.paraCount = art.paraCount || 0;
      if (art.publishedAt && !it.pubDate) it.pubDate = art.publishedAt;
      if (art.publishedAt) it.publishedAt = art.publishedAt;
      if (art.author) it.author = art.author;
      if (art.siteName) it.siteName = art.siteName;
      if (art.image) it.image = art.image;
      if (art.lang) it.srcLang = art.lang;
      if (art.factSheet) {
        it.factSheet = art.factSheet;
        it.hasCasualty = art.factSheet.hasCasualty;
        if (art.factSheet.incidentTypes && art.factSheet.incidentTypes.length) {
          it.incidentTypes = art.factSheet.incidentTypes;
        }
        if (art.factSheet.actors && art.factSheet.actors.length) {
          it.threatActors = art.factSheet.actors;
        }
      }
      it._ftAt = art.extractedAt;
      it.depth = art.charCount > 1200 ? 'full' : art.charCount > 300 ? 'partial' : 'brief';
      stat.ok++;
      stat.chars += art.charCount || 0;
    }
  }

  const pool = [];
  for (let i = 0; i < Math.min(concurrency, targets.length); i++) pool.push(worker());
  await Promise.all(pool);
  stat.sec = ((Date.now() - t0) / 1000).toFixed(1);
  return stat;
}

/* ===== 规范化预警编号 =====
 * 旧编号 PUB-chineseembassyinjapansay 可读性差、无业务含义。
 * 新规则：CN-{类型码}-{YYYYMMDD}-{序列}  例：CN-SEC-20260803-4F2A
 * 类型码取自风险类型，序列由标题稳定哈希生成（同一事件编号恒定，便于追溯）。*/
const TYPE_CODE = {
  '安全风险': 'SEC', '恐怖袭击': 'TER', '社会动荡': 'UNR', '军事冲突': 'MIL',
  '政治风险': 'POL', '经济制裁': 'SAN', '法律合规': 'LEG', '自然灾害': 'DIS',
  '公共卫生': 'HLT', '基础设施': 'INF', '网络安全': 'CYB', '开源情报': 'OSI',
  '地缘政治': 'GEO', '舆情风险': 'OPN'
};
function _hash4(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().slice(-4).padStart(4, '0');
}
function makeAlertNo(item) {
  if (!item) return '';
  const code = TYPE_CODE[item.type] || TYPE_CODE[item.category] || 'OSI';
  let d = new Date();
  const src = item.publishedAt || item.pubDate || item.time;
  if (src) { const p = new Date(src); if (!isNaN(p.getTime())) d = p; }
  const ymd = d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  return 'CN-' + code + '-' + ymd + '-' + _hash4(String(item.title || '') + '|' + (item.url || ''));
}

module.exports = {
  fetchArticle,
  enrichBatch,
  extractFacts,
  extractParagraphs,
  extractMeta,
  stripNoiseBlocks,
  decodeEntities,
  makeAlertNo
};
