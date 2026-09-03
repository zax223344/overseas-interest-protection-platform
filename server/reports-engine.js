/**
 * server/reports-engine.js —— 智库报告产品线统一后端引擎（2026-09-03）
 * =====================================================================
 * 一次实现 9 类专业分析报告：数据装配（纯 SQL+内存聚合）→ Kimi 研判 → 公文渲染 → 存库 → 定时生成 → API。
 *
 * 铁律（与平台一致，违反即返工）：
 *  1. 零模拟数据：所有数字必须来自真实 SQL 聚合；某节无数据就如实写"本周期内未监测到相关情报"。
 *  2. 只读消费：本引擎只 SELECT intel_data / intel_archive / interest-base 数据；
 *     唯一写通道是本产品线新表 report_products（DDL 自建，UPSERT 幂等）。
 *  3. 时区：按天/周期统计一律本地时区构造 Date（new Date(y, m-1, d)），禁 toISOString().slice(0,10)。
 *  4. 落库即中文：条目标题取 COALESCE(NULLIF(data_json->>'title_zh',''), title)；标题无汉字的条目不进报告正文节。
 *  5. LLM 失败降级：Kimi 失败重试 1 次，仍失败则报告照常出（客观数据节齐全），
 *     研判节写"本期待大模型研判服务恢复后补充生成"，绝不出半成品假研判。
 *
 * 注入式设计：server.js 只做 require + init(ctx)，本文件自注册路由与定时器。
 * ctx = { query, llm: { callMsg(pv, system, user) }, isChinaRelated, auth, app }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const scrapers = require('./scrapers');           /* isChinaRelatedStrict 兜底（server.js 注入优先） */
const INTEREST_BASE = require('./interest-base'); /* KEY_PROJECTS / STRAIT_CHANNELS / COUNTRY_TIERS / getTier */

let _ctx = null;            /* 注入上下文 */
const _generating = new Set(); /* "type|period" 生成锁（防并发重复生成） */

/* ============================================================
 * 一、通用工具
 * ============================================================ */
const _HAN = /[\u4e00-\u9fa5]/;
const _NOISE_RE = /\bNBA\b|lineup|Premier League|cricket|板球|联赛|锦标赛|世界杯|奥运会|box office|票房/i;
const _lvW = { red: 4, orange: 3, yellow: 2, blue: 1 };
const _LV_CN = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' };

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* 本地日期键：YYYY-MM-DD（本地时区，禁 toISOString） */
function _dayKey(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function _cnDate(d) {
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
/* 中文时间统一表达（2026-09-03 用户铁律：报告时间一律中文式，删除西式 GMT/RFC 尾注）
 * 输入兼容：ISO(2026-08-25T13:37:35[Z]) / RFC(Tue, 25 Aug 2026 13:37:35 GMT) /
 *          GDELT(20260825T133735Z) / 常规(2026-08-25 13:37) / 纯日期(2026-08-25)
 * 输出：带时刻 → 2026年8月25日 13时37分；纯日期 → 2026年8月25日；解析失败 → 原样 */
const _EN_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function _cnTime(s) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return '';
  /* 纯中文已合规 */
  if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(raw)) return raw;
  let y = 0, mo = 0, d = 0, h = null, mi = null;
  /* RFC 格式：Tue, 25 Aug 2026 13:37:35 GMT */
  let m = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})\s+(\d{1,2}):(\d{2})/i.exec(raw);
  if (m) { d = +m[1]; mo = _EN_MON[m[2].toLowerCase()] || 0; y = +m[3]; h = +m[4]; mi = +m[5]; }
  /* GDELT 紧凑格式：20260825T133735Z */
  if (!y) {
    m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(raw);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +m[4]; mi = +m[5]; }
  }
  /* ISO / 常规格式：2026-08-25T13:37:35 / 2026-08-25 13:37 / 2026-08-25 */
  if (!y) {
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(raw);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4] != null) { h = +m[4]; mi = +m[5] != null ? +m[5] : 0; } }
  }
  if (!y || !mo || !d || mo > 12 || d > 31) return raw; /* 解析失败保原样（不丢信息） */
  let out = y + '年' + mo + '月' + d + '日';
  if (h != null && h < 24) out += ' ' + h + '时' + String(mi || 0).padStart(2, '0') + '分';
  return out;
}
/* ISO 周：返回 { year, week, monday(Date 周一 00:00) } */
function _isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dn = (t.getDay() + 6) % 7;                /* 周一=0 */
  t.setDate(t.getDate() - dn + 3);                /* 本周四 */
  const y = t.getFullYear();
  const jan4 = new Date(y, 0, 4);
  const j4dn = (jan4.getDay() + 6) % 7;
  const week1Mon = new Date(y, 0, 4 - j4dn);      /* 该 ISO 年第 1 周周一 */
  const week = Math.round((t - week1Mon) / 604800000) + 1;
  const monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 3);
  return { year: y, week, monday };
}
/* 国别码→中文（与 server.js _ANOM_ISO2CN 同源精简版；已是中文原样返回） */
const _ISO2CN = {
  CN: '中国', US: '美国', GB: '英国', FR: '法国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
  PK: '巴基斯坦', LK: '斯里兰卡', BD: '孟加拉国', ID: '印尼', VN: '越南', MY: '马来西亚', TH: '泰国',
  MM: '缅甸', KH: '柬埔寨', LA: '老挝', KZ: '哈萨克斯坦', UZ: '乌兹别克斯坦', TJ: '塔吉克斯坦',
  KG: '吉尔吉斯斯坦', RU: '俄罗斯', SA: '沙特阿拉伯', AE: '阿联酋', QA: '卡塔尔', IR: '伊朗', IQ: '伊拉克',
  EG: '埃及', DZ: '阿尔及利亚', NG: '尼日利亚', ZA: '南非', CD: '刚果（金）', GN: '几内亚',
  ET: '埃塞俄比亚', KE: '肯尼亚', MZ: '莫桑比克', AO: '安哥拉', DJ: '吉布提', BR: '巴西', PE: '秘鲁',
  AR: '阿根廷', CL: '智利', MX: '墨西哥', BO: '玻利维亚', EC: '厄瓜多尔', DE: '德国', RS: '塞尔维亚',
  HU: '匈牙利', GR: '希腊', CA: '加拿大', AU: '澳大利亚', PG: '巴布亚新几内亚', SB: '所罗门群岛',
  JP: '日本', KR: '韩国', KP: '朝鲜', IN: '印度', TR: '土耳其', UA: '乌克兰', IL: '以色列', PS: '巴勒斯坦',
  SD: '苏丹', LY: '利比亚', SO: '索马里', ML: '马里', NE: '尼日尔', TD: '乍得', SY: '叙利亚',
  YE: '也门', LB: '黎巴嫩', JO: '约旦', MA: '摩洛哥', TN: '突尼斯', TZ: '坦桑尼亚', UG: '乌干达',
  ZM: '赞比亚', ZW: '津巴布韦', MW: '马拉维', BW: '博茨瓦纳', NA: '纳米比亚', SN: '塞内加尔',
  BF: '布基纳法索', CM: '喀麦隆', CI: '科特迪瓦', SG: '新加坡', PH: '菲律宾', MN: '蒙古',
  PL: '波兰', BY: '白俄罗斯', RO: '罗马尼亚', CZ: '捷克', SK: '斯洛伐克', BG: '保加利亚',
  FI: '芬兰', SE: '瑞典', NO: '挪威', DK: '丹麦', NL: '荷兰', BE: '比利时', CH: '瑞士',
  AT: '奥地利', IT: '意大利', ES: '西班牙', PT: '葡萄牙', IE: '爱尔兰', NZ: '新西兰',
  'UNITED STATES': '美国', 'UNITED KINGDOM': '英国', 'CHINA': '中国', 'IRAN': '伊朗', 'ISRAEL': '以色列',
  'RUSSIA': '俄罗斯', 'SAUDI ARABIA': '沙特阿拉伯', 'TURKEY': '土耳其', 'JAPAN': '日本', 'SOUTH KOREA': '韩国',
  'NORTH KOREA': '朝鲜', 'BRAZIL': '巴西', 'FRANCE': '法国', 'GERMANY': '德国', 'ITALY': '意大利',
  'INDIA': '印度', 'PAKISTAN': '巴基斯坦', 'MONGOLIA': '蒙古', 'INDONESIA': '印度尼西亚', 'NIGERIA': '尼日利亚'
};
function _iso2cn(c) {
  const s = String(c || '').trim();
  if (!s) return '';
  if (_HAN.test(s)) return s;
  return _ISO2CN[s.toUpperCase()] || s;
}
/* 归一化标题键（与 server.js _normTitleKey 同源精简版） */
function _normTitleKey(t) {
  return String(t || '').replace(/[\s，。：:、,·"'“”‘’（）()【】\[\]!?！？\-—·#*]+/g, '').toLowerCase().slice(0, 60);
}

/* ============================================================
 * 二、数据装配基座（fetch → 清洗 → 宽松签名归并，口径对齐 _generateDailyReport）
 * ============================================================ */
async function fetchItems(q, start, end) {
  const { rows } = await q(
    `SELECT id, data_type, title AS title_raw, country, severity, source, event_date, collect_time, data_json,
            COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title
     FROM intel_data WHERE collect_time >= $1 AND collect_time < $2 AND audit_status='approved'
     ORDER BY collect_time DESC`,
    [start, end]
  );
  const isChina = _ctx && _ctx.isChinaRelated ? _ctx.isChinaRelated : scrapers.isChinaRelatedStrict;
  return rows.map(r => {
    const j = r.data_json || {};
    return {
      id: r.id, type: r.data_type, title: r.title || '', titleRaw: r.title_raw || '',
      country: _iso2cn(r.country || j.country_cn || ''),
      severity: j.level_norm || r.severity || 'yellow',
      source: r.source || j.source || '',
      time: j.publish_time || r.event_date || _dayKey(new Date(r.collect_time)),
      url: j.url || '',
      digest: String(j.content_zh || j.summary || j.content || '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/<[^>]*>/g, ' ').replace(/<[^>]+/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, 400),
      china: !!isChina(String(r.title_raw || '') + ' ' + String(r.title || '')),
      negative: j._chinaNegative === true || j._chinaNegative === 'true',
      assets: Array.isArray(j.asset_tags) ? j.asset_tags : [],
      corr: Number(j.corroboration || 0),
      _sig: j._eventSig || ''
    };
  });
}
/* 三过滤：体育噪声 / 标题无汉字（落库即中文铁律）；同时归一标题中中文邻接的半角标点
 * （2026-09-03 实测：源标题"实施制裁.华盛顿"类残留——报告正文条目也须公文标点规范） */
function cleanItems(items) {
  return items.filter(i => {
    if (_NOISE_RE.test(String(i.title || ''))) return false;
    if (!_HAN.test(String(i.title || ''))) return false;
    if (i.title) i.title = i.title.replace(/([\u4e00-\u9fa5])[,;]([\u4e00-\u9fa5])/g, '$1，$2').replace(/([\u4e00-\u9fa5])\.([\u4e00-\u9fa5])/g, '$1。$2').replace(/([\u4e00-\u9fa5])[;:?!]([\u4e00-\u9fa5])/g, function (m, a, b) { return a + { ';': '；', ':': '：', '?': '？', '!': '！' }[m[1]] + b; });
    return true;
  });
}
/* 宽松签名归并（国别+日期相同且事件词交集≥2 即同事件；词集并集滚动扩大）——server.js 同款算法 */
function dedupeEvents(items) {
  const _sigOf = i => i._sig && String(i._sig).indexOf('|') >= 0 ? i._sig : 't:' + _normTitleKey(i.title);
  const seen = new Map();
  const sigParts = [];
  const _parseSig = s => {
    const p = String(s || '').split('|');
    if (p.length !== 3) return null;
    const words = (p[1] || '').split('+').filter(Boolean);
    if (!words.length) return null;
    return { country: p[0], words: new Set(words), date: p[2] };
  };
  items.forEach(i => {
    const k = _sigOf(i);
    if (!k || k === 't:') return;
    const parts = _parseSig(i._sig);
    if (parts) {
      for (const pair of sigParts) {
        const mp = pair[1];
        if (mp.country !== parts.country || mp.date !== parts.date) continue;
        let inter = 0;
        parts.words.forEach(w => { if (mp.words.has(w)) inter++; });
        if (inter >= 2) {
          parts.words.forEach(w => mp.words.add(w));
          const prev = seen.get(pair[0]);
          if ((_lvW[i.severity] || 0) * 100 + i.corr * 10 > (_lvW[prev.severity] || 0) * 100 + prev.corr * 10) seen.set(pair[0], i);
          return;
        }
      }
    }
    const prev = seen.get(k);
    if (!prev) { seen.set(k, i); if (parts) sigParts.push([k, parts]); return; }
    if ((_lvW[i.severity] || 0) * 100 + i.corr * 10 > (_lvW[prev.severity] || 0) * 100 + prev.corr * 10) {
      seen.set(k, i);
      if (parts) { const mp = sigParts.find(x => x[0] === k); if (mp) parts.words.forEach(w => mp[1].words.add(w)); }
    }
  });
  return Array.from(seen.values());
}
/* 跨节互斥 take（同 server.js：已在高位节展示的事件签名，低位节不再重复） */
function makeTake(list) {
  const shown = new Set();
  const _sigOf = i => i._sig && String(i._sig).indexOf('|') >= 0 ? i._sig : 't:' + _normTitleKey(i.title);
  return function take(src, n) {
    const out = [];
    for (const i of src) {
      const k = _sigOf(i);
      if (k && shown.has(k)) continue;
      if (k) shown.add(k);
      out.push(i);
      if (out.length >= n) break;
    }
    return out;
  };
}
/* 统计与条目节化 */
function lvStat(list) {
  const c = { red: 0, orange: 0, yellow: 0, blue: 0 };
  list.forEach(i => { c[i.severity] = (c[i.severity] || 0) + 1; });
  return c;
}
function toItem(i) {
  return { title: i.title, level: i.severity, country: i.country || '未标注', time: _cnTime(i.time) || '时间不详', url: i.url, digest: i.digest };
}
function section(name, list, n) {
  const st = lvStat(list);
  return { name, count: list.length, red: st.red, orange: st.orange, items: list.slice(0, n || 8).map(toItem) };
}

/* ============================================================
 * 三、威胁组织库（解析根目录 threats.js 的 THREAT_DATA，与 models-analysis.js 同源算法）
 * ============================================================ */
let _ORGS = null;
function loadOrgs() {
  if (_ORGS) return _ORGS;
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'threats.js'), 'utf8');
    const i = src.indexOf('const THREAT_DATA=');
    if (i < 0) throw new Error('THREAT_DATA 未找到');
    const rest = src.slice(i + 'const THREAT_DATA='.length);
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    const obj = (new Function('return ' + rest.slice(0, end + 1)))();
    _ORGS = (obj.organizations || []).map(o => ({
      id: o.id, name: o.name, aliases: o.aliases || [], type: o.type || '',
      threatLevel: o.threatLevel || 0, status: o.status || '',
      operatingRegions: o.operatingRegions || []
    }));
  } catch (e) {
    console.warn('[REPORTS] threats.js 组织库解析失败:', e.message);
    _ORGS = [];
  }
  return _ORGS;
}
function orgMatchers() {
  return loadOrgs().map(o => {
    const base = [o.name, ...o.aliases].map(s => String(s).trim()).filter(s => s.length >= 2);
    const vset = new Set();
    base.forEach(t => {
      vset.add(t);
      if (t.indexOf('-') >= 0) vset.add(t.replace(/-/g, ' '));
      if (t.indexOf(' ') >= 0) vset.add(t.replace(/ /g, '-'));
    });
    const parts = Array.from(vset).sort((a, b) => b.length - a.length)
      .map(t => /^[\x21-\x7e]+$/.test(t)
        ? t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^(.+)$/, '(?:^|[^a-z])$1(?:[^a-z]|$)')
        : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return { org: o, re: new RegExp(parts.join('|'), 'i') };
  });
}

/* ============================================================
 * 四、异动信号计算（与 server.js _runAnomalyWatch 同源口径：基线 7 日均值对比 + 内容实质校验）
 * ============================================================ */
const _ANOM_VIOLENT = new Set(['terror_events', 'security_events', 'military_conflicts']);
const _ANOM_SUBSTANCE_RE = /(袭击|爆炸|枪击|伤亡|死亡|击毙|击伤|绑架|交火|空袭|无人机打击|自杀式|路边炸弹|冲突升级|劫持|纵火|袭击者|武装分子|恐袭|扫射|炸弹|火箭弹|迫击炮|暗杀|伏击|炮击|开火|遇袭|丧生|死伤|炸死|炸伤|打死|枪杀|屠杀|发动攻击|bomb(?:ing|ed|s)?\b|attack(?:ed|s|ers?)?\b|airstrike|drone strike|shootout|gunfight|gunfire|kidnap\w*|explosion|blast|clash(?:es|ed)?\b|militant|insurgent|suicide|casualt\w*|killed|slain|death toll|massacre|hostage|hijack\w*|arson|ambush)/i;
const _ANOM_MEDIA_RE = /(标签|措辞|称谓|改称|不再称|不要称|不再将|不再使用|弃用|改口|报道政策|报道方针|编辑方针|编辑政策|用语|风格指南|措辞指南|style\s*guide|wording|terminology)/i;
function _triSim(a, b) {
  const tri = s => {
    const t = new Set();
    const cs = String(s).replace(/[\s，。：:、,·"'“”‘’（）()【】\[\]!?！？\-—]+/g, '');
    for (let i = 0; i + 3 <= cs.length; i++) t.add(cs.substr(i, 3));
    return t;
  };
  const A = tri(a), B = tri(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
/* 内容实质判定：pass / media（媒体舆论异动）/ suppress（非实质聚集）/ homo（单一事件多源） */
function anomSubstance(cat, titles) {
  const ts = (titles || []).map(s => String(s || '').trim()).filter(Boolean);
  if (ts.length < 3) return { action: 'pass', reason: '样例不足3条，不做内容校验' };
  const mediaHits = ts.filter(t => _ANOM_MEDIA_RE.test(t)).length;
  if (_ANOM_VIOLENT.has(cat)) {
    const substHits = ts.filter(t => !_ANOM_MEDIA_RE.test(t) && _ANOM_SUBSTANCE_RE.test(t)).length;
    if (substHits / ts.length < 0.3) {
      if (mediaHits / ts.length >= 0.5) return { action: 'media', reason: '样例' + mediaHits + '/' + ts.length + '条为媒体编辑政策/措辞类报道' };
      return { action: 'suppress', reason: '实质暴力/安全事件词命中率仅' + Math.round(substHits / ts.length * 100) + '%，非真实安全事件聚集' };
    }
  }
  if (ts.length >= 3) {
    let sum = 0, pairs = 0;
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { sum += _triSim(ts[i], ts[j]); pairs++; }
    if (pairs && sum / pairs >= 0.5) return { action: 'homo', reason: '样例标题平均相似度' + (Math.round(sum / pairs * 100) / 100) + '，系单一事件多源报道，非独立事件聚集' };
  }
  return { action: 'pass', reason: '内容实质校验通过' };
}
/* 近 7 日类别×国家基线（活跃库+归档库合并，与 _runAnomalyWatch 同源） */
async function _anomCounts(q, s, e) {
  const { rows } = await q(`
    SELECT data_type t, country c, COUNT(*)::int n FROM (
      SELECT data_type, country, collect_time, audit_status FROM intel_data
      UNION ALL
      SELECT data_type, country, collect_time, audit_status FROM intel_archive
    ) u WHERE collect_time >= $1 AND collect_time < $2 AND audit_status='approved' GROUP BY 1,2`, [s, e]);
  return rows;
}
const _ANOM_CAT_LABELS = {
  terror_events: '恐怖事件', military_conflicts: '军事冲突', security_events: '治安事件', social_unrest: '社会动荡',
  political_events: '政治动态', economic_risk: '经济风险', sanctions_data: '制裁数据', legal_compliance: '法律合规',
  cyber_security: '网络安全', infrastructure: '基础设施', natural_disasters: '自然灾害', public_health: '公共卫生'
};

/* ============================================================
 * 五、周期与调度（periodOf / 窗口 / 当期目标）
 * ============================================================ */
function weekKey(d) { const w = _isoWeek(d); return w.year + '-W' + String(w.week).padStart(2, '0'); }
function weekWindow(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key).trim());
  if (!m) throw new Error('周期格式错误（应为 YYYY-Wnn）');
  const y = +m[1], wk = +m[2];
  const jan4 = new Date(y, 0, 4);
  const j4dn = (jan4.getDay() + 6) % 7;
  const week1Mon = new Date(y, 0, 4 - j4dn);
  const start = new Date(week1Mon.getTime() + (wk - 1) * 7 * 86400000);
  return [start, new Date(start.getTime() + 7 * 86400000)];
}
function monthWindow(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key).trim());
  if (!m) throw new Error('周期格式错误（应为 YYYY-MM）');
  const y = +m[1], mo = +m[2];
  return [new Date(y, mo - 1, 1), new Date(y, mo, 1)];
}
function quarterWindow(key) {
  const m = /^(\d{4})-Q(\d)$/.exec(String(key).trim());
  if (!m) throw new Error('周期格式错误（应为 YYYY-Qn）');
  const y = +m[1], q = +m[2];
  return [new Date(y, (q - 1) * 3, 1), new Date(y, q * 3, 1)];
}
function dayWindow(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key).trim());
  if (!m) throw new Error('周期格式错误（应为 YYYY-MM-DD）');
  const start = new Date(+m[1], +m[2] - 1, +m[3]);
  return [start, new Date(start.getTime() + 86400000)];
}
function semiannualWindow(key) {
  const m = /^(\d{4})-S([12])$/.exec(String(key).trim());
  if (!m) throw new Error('周期格式错误（应为 YYYY-S1 或 YYYY-S2）');
  const y = +m[1], s = +m[2];
  return [new Date(y, (s - 1) * 6, 1), new Date(y, s * 6, 1)];
}
function yearlyWindow(key) {
  const m = /^(\d{4})$/.exec(String(key).trim());
  if (!m) throw new Error('周期格式错误（应为 YYYY）');
  const y = +m[1];
  return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
}
/* 全周期频率集（2026-09-03 用户指令：报告产品线各点全部支持 日/周/月/季/半年/年 报） */
const FREQ_ALL = ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'];
function currentPeriodOf(freq, now) {
  const y = now.getFullYear(), mo = now.getMonth();
  if (freq === 'daily') return _dayKey(now);
  if (freq === 'weekly') return weekKey(now);
  if (freq === 'monthly') return y + '-' + String(mo + 1).padStart(2, '0');
  if (freq === 'quarterly') return y + '-Q' + (Math.floor(mo / 3) + 1);
  if (freq === 'semiannual') return y + '-S' + (mo < 6 ? 1 : 2);
  if (freq === 'yearly') return String(y);
  return null;
}
function windowOfFreq(freq, key) {
  if (freq === 'daily') return dayWindow(key);
  if (freq === 'weekly') return weekWindow(key);
  if (freq === 'monthly') return monthWindow(key);
  if (freq === 'quarterly') return quarterWindow(key);
  if (freq === 'semiannual') return semiannualWindow(key);
  if (freq === 'yearly') return yearlyWindow(key);
  throw new Error('不支持的周期频率：' + freq);
}
/* 周期键 → 频率推断（历史期次徽标） */
function freqOfPeriodKey(key) {
  const s = String(key || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'daily';
  if (/^\d{4}-W\d{2}$/.test(s)) return 'weekly';
  if (/^\d{4}-Q\d$/.test(s)) return 'quarterly';
  if (/^\d{4}-S[12]$/.test(s)) return 'semiannual';
  if (/^\d{4}$/.test(s)) return 'yearly';
  if (/^\d{4}-\d{2}$/.test(s)) return 'monthly';
  return '';
}
/* 报告名称随所选周期改写（2026-09-03 用户指令：周期是实实在在变动的，名称也要跟着变）
 * 规则：名称尾部为「日报/周报/月报/季报/半年报/年报」→ 换成目标周期名词（涉华负面情报周报→季报）；
 *       尾部为「分析/评估/专报/简报」→ 在前面插入周期形容词（国别风险月度评估→季度评估）；
 *       与类型默认频率一致时不改写（幂等，默认期次名称保持原样）。 */
const FREQ_NOUN = { daily: '日报', weekly: '周报', monthly: '月报', quarterly: '季报', semiannual: '半年报', yearly: '年报' };
const FREQ_ADJ = { daily: '每日', weekly: '每周', monthly: '月度', quarterly: '季度', semiannual: '半年度', yearly: '年度' };
function titleForFreq(name, freq) {
  if (!name || !freq || !FREQ_NOUN[freq]) return name;
  const m = /^(.*?)(每日|每周|每月|每季|每半年|每年|日常|周度|月度|季度|半年度|年度)?(日报|周报|月报|季报|半年报|年报|分析|评估|专报|简报)$/.exec(String(name).trim());
  if (!m) return String(name).trim() + FREQ_NOUN[freq];
  const base = m[1], tail = m[3];
  if (tail === '分析' || tail === '评估' || tail === '专报' || tail === '简报') return base + FREQ_ADJ[freq] + tail;
  return base + FREQ_NOUN[freq];
}
/* 各类型当期目标：{ key, due } —— due=false 表示未到生成时点（周一06:00/每月1日06:00/每季首日06:00/每日07:00） */
function currentTarget(freq, now) {
  const y = now.getFullYear(), mo = now.getMonth();
  if (freq === 'daily') {
    const yst = new Date(y, mo, now.getDate() - 1);
    return { key: _dayKey(yst), due: now.getHours() >= 7 };
  }
  if (freq === 'weekly') {
    const dn = (now.getDay() + 6) % 7;                     /* 周一=0 */
    const monday = new Date(y, mo, now.getDate() - dn);
    const dueAt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 6, 0, 0);
    const lastSunday = new Date(monday.getTime() - 86400000); /* 上一完成周（含其周日） */
    return { key: weekKey(lastSunday), due: now >= dueAt };
  }
  if (freq === 'monthly') {
    const dueAt = new Date(y, mo, 1, 6, 0, 0);
    const prev = new Date(y, mo - 1, 1);
    return { key: prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0'), due: now >= dueAt };
  }
  if (freq === 'quarterly') {
    const qm = Math.floor(mo / 3) * 3;
    const dueAt = new Date(y, qm, 1, 6, 0, 0);
    const q = qm / 3 + 1;
    const pq = q === 1 ? 4 : q - 1, py = q === 1 ? y - 1 : y;
    return { key: py + '-Q' + pq, due: now >= dueAt };
  }
  return null; /* manual：无定时 */
}

/* ============================================================
 * 六、LLM 通道（Kimi 研判）
 * ============================================================ */
function pvKimi() {
  return {
    name: 'Kimi',
    base: (process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, ''),
    key: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'kimi-k2.7-code',
    /* 2026-09-03 真根因破案：kimi-k2.7-code 是推理模型，8000 max_tokens 会被思考阶段
     * 消耗殆尽（实测 finish_reason=length + content 空），复杂主题（制裁/冲突类）必然翻车。
     * 2026-09-03 二次放宽：季度大盘（5729 事件上下文）实测 16000 仍被思考吃光
     * （project-exposure 空内容 finish=length），放宽到 24000 并保留 300s 停滞超时 */
    maxTokens: 24000,
    /* 2026-09-03：kimi-k2.7 长公文生成（制裁/冲突类分节多、输出 6000+ 字）实测 180s 不够
     * （chokepoint 148s 成功、sanction/conflict 连续 180s 超时），放宽到 300s */
    timeout: 300000
  };
}
/* 兜底 callMsg（与 server.js _callOpenAiCompatMsg 同协议；server.js 注入优先） */
function _callMsgDefault(pv, system, user) {
  return new Promise((resolve) => {
    try {
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });
      msgs.push({ role: 'user', content: user });
      const body = JSON.stringify({ model: pv.model, messages: msgs, max_tokens: pv.maxTokens });
      const u = new URL(pv.base + '/chat/completions');
      const rq = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: pv.timeout, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pv.key, 'Content-Length': Buffer.byteLength(body) } }, (rs) => {
        const chunks = [];
        rs.on('data', c => chunks.push(c));
        rs.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let j = {};
          try { j = JSON.parse(raw); } catch (e) { return resolve({ text: '', error: '返回解析失败(HTTP ' + rs.statusCode + ')' }); }
          if (j.error || (j.code && j.code !== 0)) return resolve({ text: '', error: 'HTTP ' + rs.statusCode + ' ' + (((j.error || {}).message) || j.message || '') });
          const msg = ((j.choices || [])[0] || {}).message || {};
          if (!msg.content) return resolve({ text: '', error: '空内容' });
          resolve({ text: msg.content, error: '' });
        });
      });
      rq.on('error', e => resolve({ text: '', error: e.message }));
      rq.on('timeout', () => { rq.destroy(); resolve({ text: '', error: '调用超时' }); });
      rq.end(body);
    } catch (e) { resolve({ text: '', error: e.message }); }
  });
}
/* 2026-09-03 流式调用根治超时：kimi-k2.7 对"逐项研判"类 prompt 推理链深，
 * 非流式需整段生成完才返回（制裁/冲突类实测 >300s 必超时；咽喉要道 148s 险过）。
 * 改 stream:true 增量接收——① thinking/reasoning_content 增量也在流里，无长时间静默；
 * ② pv.timeout 语义变为"无数据停滞"超时（每收到 chunk 即重置）；
 * ③ 另设 _STREAM_TOTAL_MS 总时长硬帽。 */
function _callMsgStream(pv, system, user) {
  return new Promise((resolve) => {
    try {
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });
      msgs.push({ role: 'user', content: user });
      const body = JSON.stringify({ model: pv.model, messages: msgs, max_tokens: pv.maxTokens, stream: true });
      const u = new URL(pv.base + '/chat/completions');
      const t0 = Date.now();
      const done = (r) => { if (finished) return; finished = true; clearTimeout(totalTimer); try { rq.destroy(); } catch (e) {} resolve(r); };
      let finished = false;
      let buf = '', text = '', firstChunkAt = 0, errText = '';
      const rq = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: pv.timeout, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pv.key, 'Content-Length': Buffer.byteLength(body) } }, (rs) => {
        if (rs.statusCode !== 200) {
          rs.on('data', c => { errText += c.toString('utf8'); });
          rs.on('end', () => {
            let m = errText.slice(0, 200);
            try { const j = JSON.parse(errText); m = ((j.error || {}).message) || j.message || m; } catch (e) {}
            done({ text: '', error: 'HTTP ' + rs.statusCode + ' ' + m });
          });
          return;
        }
        rs.on('data', c => {
          if (!firstChunkAt) firstChunkAt = Date.now() - t0;
          buf += c.toString('utf8');
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return done(text ? { text, error: '' } : { text: '', error: '空内容' });
            try {
              const j = JSON.parse(payload);
              if (j.error) return done({ text: '', error: ((j.error || {}).message) || '流式返回错误' });
              const d = ((j.choices || [])[0] || {}).delta || {};
              if (d.content) text += d.content; /* reasoning_content 增量忽略（仅思考过程） */
            } catch (e) { /* 半行/心跳行，跳过 */ }
          }
        });
        rs.on('end', () => done(text ? { text, error: '' } : { text: '', error: '流提前断开' + (firstChunkAt ? '' : '（首字节未到）') }));
        rs.on('error', e => done({ text: '', error: e.message }));
      });
      rq.on('error', e => done({ text: '', error: e.message }));
      /* 停滞超时：流式下每 chunk 自动重置；只静默超过 pv.timeout 才断 */
      rq.on('timeout', () => done({ text: '', error: '流停滞' + Math.round(pv.timeout / 1000) + '秒（首字节' + (firstChunkAt ? firstChunkAt + 'ms' : '未到') + '，已累计' + text.length + '字）' }));
      const totalTimer = setTimeout(() => done({ text: '', error: '总时长超' + Math.round(_STREAM_TOTAL_MS / 1000) + '秒（已累计' + text.length + '字）' }), _STREAM_TOTAL_MS);
      rq.end(body);
    } catch (e) { resolve({ text: '', error: e.message }); }
  });
}
const _STREAM_TOTAL_MS = 600000;
/* 9 类共用 system prompt 基座（公文要求） */
const SYSTEM_PROMPT = '你是中国海外利益保护情报预警平台的高级情报分析员，为外交部、商务部、公安部、国家安全部、中央企业领导撰写专业分析报告。写作要求：一、严格党政机关公文语体，庄重、准确、简明，不用口语和网络用语；二、结构层次序号：一级"一、"，二级"（一）"，三级"1."，四级"（1）"；三、标点符号严格按 GB/T 15834：中文语境一律全角标点，并列词语用顿号、分句用逗号、句末用句号，书名号《》用于文件与报告名，引号用""\'\'，严禁出现半角逗号句号残留；四、数字用法按 GB/T 15835：统计数据用阿拉伯数字，约数用"约""余"；五、判断要有分寸，区分"已证实""研判认为""需持续关注"三级确定性表述；六、只基于给定数据研判，数据未涉及的领域不得杜撰；七、输出为纯文本公文，严禁使用任何 Markdown 语法（星号加粗、井号标题、反引号、竖线表格等）。';
/* 客观数据 → user prompt */
/* 对策建议撰写规范（《对策建议撰写规范手册》五段式+关键句式+时序分级，2026-09-03 用户指令） */
const RECOMMENDATION_SPEC = '【对策建议撰写规范（必须严格执行，源自《智库报告"对策建议"撰写规范手册》）】【宏观结构】对策体系按"总体思路→核心举措→保障机制→优先级与实施路径"四层组织：总体思路1段（战略定位、基本原则、目标年份）；核心举措3至5条（每条按五段式微观结构展开，一事一议，主建议不超过5条）；保障机制涵盖法治、资金、人才、考核；优先级与实施路径按时序分级：近期（0至6个月，摸底建机制试点）、中期（6至24个月，建平台推标准扩面）、远期（2至5年，制度定型）。【五段式微观结构】每条建议依次含：①形势判断（1句，点出痛点与时机，回指前文数据）；②战略目标（1句，含目标年份与覆盖率）；③具体行动（分2至4条，含牵头与配合单位）；④资源保障（钱、人、数据、法规来源明确）；⑤风险与成效（预期主要阻力与规避路径＋量化成效）。具体行动必须使用关键句式「由【牵头单位】会同【配合单位】，于【时间】前，通过【手段】，完成【可验收成果】，预计【成效或风险】。」。【四条生死线】精准（谁来做、做什么、怎么做，目标具体到部门机构）；可操作（给出工作流、工具或量化指标）；系统（组合拳，涵盖政治、经济、安全等多维度）；前瞻（针对前文研判的未来威胁趋势提出预案）；并标注国内法律框架内可行项与需国际决议支持项。【文风铁律】动宾结构开路（多用建立、推动、完善、试点），严禁"务必、必须、坚决"等口号式说教；以参谋员身份行文，用"建议、可考虑、宜"；缩略语首次出现写全称；数据注明口径（同比/环比、样本范围），杜绝"约数十""普遍认为"等模糊表述；牵头单位从外交部、商务部、公安部、国家安全部、国务院国资委、中央企业、驻外使领馆中按职责选定。';
function buildUserPrompt(def, periodKey, win, data) {
  const lines = [];
  lines.push('【报告类型】' + def.name + '（周期 ' + periodKey + '）');
  lines.push('【统计窗口】' + _cnDate(win[0]) + ' 至 ' + _cnDate(new Date(win[1].getTime() - 1)) + '（本地时间）');
  lines.push('【数据来源】平台 intel_data 真实采集库聚合（事件级去重后独立事件），以下全部为客观数据，禁止虚构补充。');
  const st = data.stats || {};
  lines.push('【总体统计】独立事件 ' + (st.total || 0) + ' 条；红 ' + (st.red || 0) + ' 条、橙 ' + (st.orange || 0) + ' 条、黄 ' + (st.yellow || 0) + ' 条、蓝 ' + (st.blue || 0) + ' 条。');
  lines.push('');
  lines.push('【分节数据】');
  (data.sections || []).forEach((s, si) => {
    lines.push('（' + _cnNum(si + 1) + '）' + s.name + '：' + (s.count || 0) + ' 条（红' + (s.red || 0) + '、橙' + (s.orange || 0) + '）' + (s.note ? '——' + s.note : ''));
    if (!s.items || !s.items.length) {
      lines.push('    本周期内未监测到相关情报。');
    } else {
      s.items.slice(0, 6).forEach((it, ii) => {
        lines.push('    ' + (ii + 1) + '. [' + (_LV_CN[it.level] || it.level || '—') + '][' + (it.country || '未标注') + '] ' + String(it.title || '').slice(0, 90) + '（' + (_cnTime(it.time) || '时间不详') + '）');
      });
      if (s.items.length > 6) lines.push('    另有 ' + (s.items.length - 6) + ' 条同类事件，详见客观数据节。');
    }
  });
  if (data.extraPrompt) lines.push('', data.extraPrompt);
  lines.push('', '【写作要求】' + def.promptBrief);
  lines.push('', RECOMMENDATION_SPEC);
  return lines.join('\n');
}
function _cnNum(n) { return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'][n - 1] || String(n); }
/* LLM 调用：失败重试 1 次，仍失败返回 ok:false（报告照常出，研判节降级文案） */
async function runLlm(def, periodKey, win, data) {
  const pv = pvKimi();
  if (!pv.key) return { ok: false, text: '', model: '', error: '未配置 LLM_API_KEY' };
  const user = buildUserPrompt(def, periodKey, win, data);
  let lastErr = '';
  for (let i = 0; i < 2; i++) {
    /* 优先流式（根治长推理超时）；流式失败第 2 次回落注入的非流式通道双保险 */
    const r = (i === 0) ? await _callMsgStream(pv, SYSTEM_PROMPT, user)
      : await ((_ctx && _ctx.llm && _ctx.llm.callMsg) ? _ctx.llm.callMsg(pv, SYSTEM_PROMPT, user) : _callMsgDefault(pv, SYSTEM_PROMPT, user));
    if (r && r.text) return { ok: true, text: stripMarkdown(r.text), model: pv.model };
    lastErr = (r && r.error) || '未知错误';
    console.warn('[REPORTS] ' + def.id + ' LLM 第' + (i + 1) + '次调用失败：' + lastErr);
  }
  return { ok: false, text: '', model: '', error: lastErr };
}
/* LLM 输出 Markdown 残留剥离（防御层：模型偶发违反"禁 Markdown"指令） */
function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, m => m.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')) /* 代码块去围栏 */
    .replace(/\*\*([^*]+)\*\*/g, '$1')   /* **加粗** */
    .replace(/\*([^*\n]+)\*/g, '$1')     /* *斜体* */
    .replace(/^#{1,6}\s*/gm, '')          /* 井号标题 */
    .replace(/`([^`]+)`/g, '$1')         /* 行内代码 */
    .replace(/^\s*[-*]\s+/gm, match => match.replace(/[*-]/, '•')) /* 无序列表符→圆点 */
    .replace(/\|/g, '｜')                 /* 竖线→全角 */
    .replace(/\r\n/g, '\n')
    .trim();
}
/* 公文成稿清洗（2026-09-03 用户铁律「太粗糙了，跟每日简报差距太大」）：
 *  ① 删除西式时间尾注（巴基斯坦，Tue, 25 Aug 2026 13:37:35 GMT）类括注；
 *  ② ……
 *  ③ 删除正文中的蛇形小写源类型残留（geopolitical_intel / xxx_watch 等内部代号）；
 *  ④ 空白归一：全角空格、连续空格、空括号、重复句读。 */
function polishGovText(text) {
  let t = String(text || '');
  if (!t) return t;
  /* URL/邮箱保护 */
  const holds = [];
  t = t.replace(/https?:\/\/[^\s<>"'，。；：）)]+/gi, m => { holds.push(m); return '\x00' + (holds.length - 1) + '\x00'; });
  /* ① 西式时间括注：含星期英文缩写或 GMT/+0800 时区的（…）整段删除 */
  t = t.replace(/（[^（）]*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?[^（）]*(?:GMT|UTC|[+-]\d{2}:?\d{2})[^（）]*）/gi, '');
  t = t.replace(/\([^()]*\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b[^()]*(?:GMT|UTC)\)/gi, '');
  /* ② 省略号残留归一：连续…全部收敛为句号（公文正文不用省略号） */
  t = t.replace(/\s*…+\s*/g, '。');
  /* ③ 内部源类型蛇形代号（前后为中文或行首行尾时） */
  t = t.replace(/(?:^|(?<=[\u4e00-\u9fa5，。；：、（）\s]))[a-z][a-z0-9]*_(?:intel|watch|feed|data|events?|daily|weekly|sentinel|matrix)(?=(?:$|[\s，。；：、）(][^a-zA-Z]|[\u4e00-\u9fa5]))/gi, '');
  /* ④ 空白归一 */
  t = t.replace(/[\u3000\t]+/g, '')
       .replace(/[ \t]{2,}/g, ' ')
       .replace(/（\s*）/g, '')
       .replace(/\(\s*\)/g, '')
       .replace(/[，。；：]{2,}/g, m => m[0])
       .replace(/\n{3,}/g, '\n\n')
       .replace(/ +\n/g, '\n');
  /* 还原 URL */
  t = t.replace(/\x00(\d+)\x00/g, (_, i) => holds[+i]);
  return t.trim();
}

/* ============================================================
 * 七、govPunctuate —— 公文标点后处理
 * 只动标点不动字词：① 中文语境半角→全角（跳过 URL/数字千分位/英文语境）；
 * ② 直引号统一弯引号；③ 连续重复标点归一。
 * ============================================================ */
function govPunctuate(text) {
  let t = String(text || '');
  if (!t) return t;
  /* 1) URL/邮箱占位保护 */
  const holds = [];
  t = t.replace(/https?:\/\/[^\s<>"'，。；：）)]+/gi, m => { holds.push(m); return '\x00' + (holds.length - 1) + '\x00'; });
  const isHan = c => !!c && /[\u4e00-\u9fa5]/.test(c);
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const p = t[i - 1] || '', n = t[i + 1] || '';
    if (c === ',') {
      if (/\d/.test(p) && /\d/.test(n)) out += ',';            /* 数字千分位 */
      else if (isHan(p) || isHan(n)) out += '，';               /* 中文语境 */
      else out += ',';
    } else if (c === '.') {
      if (isHan(p) && !/[A-Za-z0-9]/.test(n)) out += '。';      /* 中文句末句号 */
      else out += '.';
    } else if (c === ';' || c === ':' || c === '?' || c === '!') {
      if (isHan(p) || isHan(n)) out += { ';': '；', ':': '：', '?': '？', '!': '！' }[c];
      else out += c;
    } else out += c;
  }
  t = out;
  /* 2) 直引号 → 弯引号（成对交替） */
  t = t.replace(/"([^"]*)"/g, '“$1”').replace(/'([^']*)'/g, '‘$1’');
  /* 3) 连续重复标点归一（！！！→！），顿号逗号句号等全归一 */
  t = t.replace(/([，。；：？！、])\1+/g, '$1');
  /* 4) 还原 URL */
  t = t.replace(/\x00(\d+)\x00/g, (_, i) => holds[+i]);
  return t;
}

/* ============================================================
 * 八、渲染：深色 HUD 交互版 + 公文版（GB/T 9704-2012 风格）
 * ============================================================ */
function svgBars(chart) {
  const list = (chart || []).slice(0, 12);
  if (!list.length) return '';
  const W = 640, RH = 26, PAD = 8;
  const H = list.length * RH + PAD * 2;
  const max = Math.max.apply(null, list.map(x => x.value || 0)) || 1;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;height:auto;">';
  list.forEach((x, i) => {
    const y = PAD + i * RH;
    const bw = Math.max(2, Math.round((x.value || 0) / max * (W - 210)));
    s += '<text x="4" y="' + (y + 13) + '" fill="#8fb6d9" font-size="12" text-anchor="start">' + _esc(String(x.label || '').slice(0, 12)) + '</text>';
    s += '<rect x="120" y="' + (y + 3) + '" width="' + bw + '" height="14" rx="2" fill="#22d3ee" opacity="' + (0.45 + 0.55 * (x.value || 0) / max) + '"/>';
    s += '<text x="' + (124 + bw) + '" y="' + (y + 14) + '" fill="#dff3ff" font-size="12">' + (x.value || 0) + '</text>';
  });
  return s + '</svg>';
}
function _llmParas(text) {
  return String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
}
function renderHtml(def, periodKey, data, llmText, llmOk) {
  const st = data.stats || {};
  const _now = new Date();
  const nowCn = _now.getFullYear() + '年' + (_now.getMonth() + 1) + '月' + _now.getDate() + '日 ' + String(_now.getHours()).padStart(2, '0') + '时' + String(_now.getMinutes()).padStart(2, '0') + '分';
  const statCards = [
    ['独立事件', st.total || 0], ['红色', st.red || 0], ['橙色', st.orange || 0],
    ['涉华情报', st.chinaCount != null ? st.chinaCount : '—'], ['黄色', st.yellow || 0], ['蓝色', st.blue || 0]
  ].map(x => '<div class="rp-stat"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>').join('');
  const secs = (data.sections || []).map(s => {
    const rows = (s.items || []).map(it =>
      '<tr><td class="rp-lv rp-lv-' + _esc(it.level) + '">' + _esc(_LV_CN[it.level] || it.level || '—') + '</td>' +
      '<td class="rp-ct">' + _esc(it.country || '未标注') + '</td>' +
      '<td class="rp-tt">' + _esc(it.title) + (it.url ? ' <a class="rp-url" href="' + _esc(it.url) + '" target="_blank" rel="noopener">原文</a>' : '') + '</td>' +
      '<td class="rp-tm">' + _esc(it.time || '—') + '</td></tr>').join('');
    return '<div class="rp-sec"><h2>' + _esc(s.name) +
      '<span class="rp-cnt">' + (s.count || 0) + ' 条 · 红' + (s.red || 0) + ' 橙' + (s.orange || 0) + '</span></h2>' +
      (s.note ? '<p class="rp-note">' + _esc(s.note) + '</p>' : '') +
      (rows
        ? '<table class="rp-table"><thead><tr><th>级别</th><th>国别</th><th>事件</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="rp-empty">本周期内未监测到相关情报。</p>') +
      '</div>';
  }).join('');
  const judge = _llmParas(llmText).map(p => '<p>' + _esc(p) + '</p>').join('');
  const chart = data.chart && data.chart.length ? svgBars(data.chart) : '';
  return '<style>'
    + '.rp-wrap{background:#0a1428;color:#cfe3f5;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:22px;border-radius:12px;}'
    + '.rp-wrap a{color:#22d3ee;}'
    + '.rp-hd{margin-bottom:6px;}.rp-hd h1{color:#eaf6ff;font-size:21px;margin:0 0 6px;font-weight:600;letter-spacing:1px;}'
    + '.rp-line{height:2px;background:linear-gradient(90deg,#22d3ee 0%,rgba(34,211,238,0) 70%);margin:8px 0 4px;}'
    + '.rp-meta{color:#7aa5c9;font-size:12px;display:flex;gap:14px;flex-wrap:wrap;}'
    + '.rp-badge{display:inline-block;border:1px solid #1e3a5f;border-radius:4px;padding:1px 6px;font-size:11px;color:#9fc3e2;}'
    + '.rp-stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px;}'
    + '.rp-stat{background:#0e1f3a;border:1px solid #1e3a5f;border-radius:8px;padding:8px 16px;text-align:center;min-width:86px;}'
    + '.rp-stat span{display:block;color:#7aa5c9;font-size:12px;}.rp-stat b{display:block;color:#22d3ee;font-size:20px;font-weight:600;}'
    + '.rp-chart{background:#0d1d36;border:1px solid #1e3a5f;border-radius:10px;padding:12px 14px;margin-top:14px;}'
    + '.rp-chart .rp-cap{color:#8fb6d9;font-size:12px;margin-bottom:6px;}'
    + '.rp-sec{background:#0d1d36;border:1px solid #1e3a5f;border-radius:10px;margin-top:14px;padding:12px 14px;}'
    + '.rp-sec h2{color:#22d3ee;font-size:15px;margin:0 0 8px;font-weight:600;border-left:3px solid #22d3ee;padding-left:9px;display:flex;justify-content:space-between;align-items:center;}'
    + '.rp-cnt{color:#7aa5c9;font-size:12px;font-weight:400;}'
    + '.rp-note{color:#9fc3e2;font-size:13px;margin:0 0 8px;}'
    + '.rp-table{width:100%;border-collapse:collapse;font-size:13px;}'
    + '.rp-table th{color:#7aa5c9;text-align:left;padding:5px 8px;border-bottom:1px solid #1e3a5f;font-weight:500;}'
    + '.rp-table td{padding:6px 8px;border-bottom:1px solid #14294a;vertical-align:top;}'
    + '.rp-tt{color:#dff0fd;}.rp-tm{color:#7aa5c9;white-space:nowrap;}.rp-ct{white-space:nowrap;}'
    + '.rp-lv{font-weight:600;white-space:nowrap;}.rp-lv-red{color:#ff5c5c;}.rp-lv-orange{color:#ffa14e;}.rp-lv-yellow{color:#e8d34e;}.rp-lv-blue{color:#5cb3ff;}'
    + '.rp-url{font-size:12px;margin-left:6px;text-decoration:none;}'
    + '.rp-empty{color:#7aa5c9;font-size:13px;margin:4px 0;}'
    + '.rp-judge{background:#0d1d36;border:1px solid #1e3a5f;border-radius:10px;margin-top:14px;padding:14px 18px;}'
    + '.rp-judge h2{color:#22d3ee;font-size:15px;margin:0 0 10px;font-weight:600;border-left:3px solid #22d3ee;padding-left:9px;}'
    + '.rp-judge p{line-height:1.95;font-size:14px;margin:0 0 10px;text-indent:2em;color:#d7e9f9;}'
    + '.rp-judge p.rp-fallback{color:#8fb6d9;}'
    + '</style>'
    + '<div class="rp-wrap">'
    + '<div class="rp-hd"><h1>' + _esc(data.title) + '</h1>'
    + '<div class="rp-line"></div>'
    + '<div class="rp-meta"><span class="rp-badge">' + _esc(def.name) + '</span><span>周期：' + _esc(periodKey) + '</span>'
    + '<span>生成时间：' + _esc(nowCn) + '</span>'
    + '<span>研判模型：' + (llmOk ? _esc(pvKimi().model) : '待补充（大模型服务暂不可用）') + '</span></div></div>'
    + '<div class="rp-stats">' + statCards + '</div>'
    + (chart ? '<div class="rp-chart"><div class="rp-cap">' + _esc(data.chartCap || '分项统计') + '</div>' + chart + '</div>' : '')
    + secs
    + '<div class="rp-judge"><h2>综合研判与对策建议</h2>'
    + (llmOk ? judge : '<p class="rp-fallback">本期待大模型研判服务恢复后补充生成。</p>')
    + '</div></div>';
}
function renderGovHtml(def, periodKey, data, llmText, llmOk) {
  const st = data.stats || {};
  const now = new Date();
  const issueDate = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
  const paras = _llmParas(llmText);
  const judgeHtml = llmOk
    ? paras.map(p => '<p class="rgp-p">' + _esc(p) + '</p>').join('')
    : '<p class="rgp-p">本期待大模型研判服务恢复后补充生成。</p>';
  const secHtml = (data.sections || []).map((s, si) =>
    '<div class="rgp-h2">（' + _cnNum(si + 1) + '）' + _esc(s.name) + '</div>'
    + '<p class="rgp-p">' + (s.count || 0) + ' 条（红色 ' + (s.red || 0) + ' 条、橙色 ' + (s.orange || 0) + ' 条）。' + (s.note ? _esc(s.note) : '') + '</p>'
    + ((s.items || []).length
      ? (s.items.slice(0, 6).map((it, ii) =>
        '<p class="rgp-p">' + (ii + 1) + '.' + _esc(_LV_CN[it.level] || '') + '级：' + _esc(it.title) + '（' + _esc(it.country || '未标注') + '，' + _esc(it.time || '时间不详') + '）。</p>').join(''))
      : '<p class="rgp-p">本周期内未监测到相关情报。</p>')
  ).join('');
  return '<style>'
    /* GB/T 9704-2012 参考（与 daily_reports 公文版同规格）：版心 156×225mm、3 号仿宋、28.5 磅行距 */
    + '.rgp-paper{width:21cm;max-width:100%;margin:0 auto;background:#fff;color:#000;padding:37mm 26mm 35mm 28mm;font-family:"Times New Roman","仿宋_GB2312","FangSong_GB2312","仿宋","FangSong",serif;font-size:16pt;line-height:28.5pt;box-sizing:border-box;}'
    + '.rgp-paper *{box-sizing:content-box;}'
    + '.rgp-redhead{text-align:center;font-family:"方正小标宋简体","FZXiaoBiaoSong-B05S","宋体","SimSun",serif;color:#d40000;font-size:26pt;line-height:34pt;font-weight:700;letter-spacing:5px;margin:0 0 4pt;}'
    + '.rgp-redline{border:none;border-top:3px solid #d40000;margin:2pt 0 0;}'
    + '.rgp-qihao{text-align:center;font-family:"Times New Roman","楷体","KaiTi",serif;font-size:16pt;line-height:28.5pt;margin:2pt 0 0;}'
    + '.rgp-title{text-align:center;font-family:"方正小标宋简体","FZXiaoBiaoSong-B05S","华文中宋","STZhongsong","宋体","SimSun",serif;font-size:22pt;line-height:34pt;font-weight:700;margin:14pt 0 6pt;}'
    + '.rgp-h1{font-family:"黑体","SimHei",serif;font-size:16pt;font-weight:400;line-height:28.5pt;margin:12pt 0 2pt;text-align:left;}'
    + '.rgp-h2{font-family:"楷体","KaiTi",serif;font-size:16pt;font-weight:400;line-height:28.5pt;margin:8pt 0 0;text-align:left;}'
    + '.rgp-p{font-size:16pt;line-height:28.5pt;text-indent:2em;margin:0;}'
    + '.rgp-sign{text-align:right;margin-top:22pt;line-height:28.5pt;font-size:16pt;}'
    + '.rgp-sign .rgp-org{padding-right:2em;}'
    + '.rgp-footer{margin-top:32pt;font-size:14pt;line-height:22pt;font-family:"Times New Roman","仿宋_GB2312","FangSong_GB2312","仿宋","FangSong",serif;}'
    + '.rgp-fline{border:none;border-top:1pt solid #000;margin:0;}'
    + '.rgp-fline.thin{border-top:0.7pt solid #000;}'
    + '.rgp-frow{display:flex;justify-content:space-between;padding:2pt 1em;}'
    + '@media print{.rgp-paper{width:auto;padding:0;margin:0;}}'
    + '@page{size:A4;margin:37mm 26mm 35mm 28mm;}'
    + '</style>'
    + '<div class="rgp-paper">'
    + '<div class="rgp-redhead">海外利益保护情报预警平台</div>'
    + '<div class="rgp-redline"></div>'
    + '<div class="rgp-qihao">' + _esc(def.name) + '（' + _esc(periodKey) + '）</div>'
    + '<div class="rgp-title">' + _esc(data.title) + '</div>'
    + '<div class="rgp-h1">一、总体情况</div>'
    + '<p class="rgp-p">本周期（' + _cnDate(data.win[0]) + '至' + _cnDate(new Date(data.win[1].getTime() - 86400000)) + '）共监测独立情报事件 ' + (st.total || 0) + ' 条，其中红色 ' + (st.red || 0) + ' 条、橙色 ' + (st.orange || 0) + ' 条、黄色 ' + (st.yellow || 0) + ' 条、蓝色 ' + (st.blue || 0) + ' 条' + (st.chinaCount != null ? '，涉华情报 ' + st.chinaCount + ' 条' : '') + '。以上数据均来自平台真实采集库聚合。</p>'
    + '<div class="rgp-h1">二、分项态势</div>'
    + secHtml
    + '<div class="rgp-h1">三、综合研判与对策建议</div>'
    + judgeHtml
    + '<div class="rgp-sign"><div class="rgp-org">海外利益保护情报预警平台</div><div class="rgp-date">' + issueDate + '</div></div>'
    + '<div class="rgp-footer"><div class="rgp-fline"></div><div class="rgp-frow"><span>抄送：中心领导，相关业务部门。</span></div><div class="rgp-fline thin"></div><div class="rgp-frow"><span>海外利益保护情报预警平台办公室</span><span>' + issueDate + '印发</span></div><div class="rgp-fline"></div></div>'
    + '</div>';
}

/* ============================================================
 * 九、9 类报告装配器
 * ============================================================ */

/* 1. 涉华负面情报周报（六节：人员安全/财产受损/制裁合规/舆情攻击/间谍渗透/领事保护） */
const CN_NEG_SECTIONS = [
  { name: '人员安全', re: /袭击|绑架|劫持|枪击|伤亡|死亡|遇难|受伤|身亡|遇害|抢劫|失踪|勒索|遇袭|绑架案|安全事件/ },
  { name: '财产受损', re: /劫掠|哄抢|打砸|纵火|火灾|爆炸|受损|破坏|盗窃|侵占|工地|工厂|园区|矿区|资产|船只|店铺|银行账户|没收/ },
  { name: '制裁合规', re: /制裁|实体清单|出口管制|二级制裁|SDN|冻结资产|黑名单|管制清单|加征关税/ },
  { name: '舆情攻击', re: /舆情|抹黑|污蔑|炒作|抵制|谴责|批评|指控|负面言论|渗透报道|抗议示威|反华/ },
  { name: '间谍渗透', re: /间谍|情报人员|渗透|窃密|策反|黑客|网络攻击|网络渗透|监听|泄密|被捕.*情报/ },
  { name: '领事保护', re: /领事|领保|撤侨|撤离|使馆|大使馆|领事馆|外交交涉|安全提醒|航班调整/ }
];
async function assembleCnNegativeWeekly(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  /* 涉华负面双确认：_chinaNegative 标记 + isChinaRelatedStrict */
  const neg = items.filter(i => i.negative && i.china);
  const take = makeTake(neg);
  const mapped = CN_NEG_SECTIONS.map(sec => ({ sec, list: neg.filter(i => sec.re.test(i.title + ' ' + i.digest)) }));
  const used = new Set();
  mapped.forEach(m => m.list.forEach(i => used.add(i)));
  const other = neg.filter(i => !used.has(i));
  const sections = mapped.map(m => section(m.sec.name, take(m.list, 8), 8));
  sections.push(section('其他涉华动态', take(other, 8), 8));
  const st = lvStat(neg);
  return {
    title: '涉华负面情报周报',
    stats: Object.assign({ total: neg.length, chinaCount: neg.length }, st),
    sections,
    chart: CN_NEG_SECTIONS.map((s, i) => ({ label: s.name, value: sections[i].count })).concat([{ label: '其他', value: sections[6].count }]),
    chartCap: '六维涉华负面情报分布（条）',
    extraPrompt: '本报告聚焦涉华负面情报（平台标记 _chinaNegative 且经涉华严格口径复核）。涉华口径说明：中国公民/中资机构/中国政府/涉华事务直接相关的负面情报。'
  };
}

/* 2. 国别风险月度评估（TOP15 + 梯队/COSRI 高危国全集，环比上月） */
const CASUALTY_RE = /死亡|遇难|伤亡|受伤|身亡|丧生|遇难/;
async function assembleCountryRisk(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  /* 上月窗口计数（环比基数） */
  const prevEnd = win[0];
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 1, 1);
  const prevRows = await q(
    `SELECT country, COUNT(*)::int n FROM intel_data WHERE collect_time >= $1 AND collect_time < $2 AND audit_status='approved' GROUP BY 1`,
    [prevStart, prevEnd]
  );
  const prevMap = {};
  prevRows.rows.forEach(r => { const c = _iso2cn(r.country); prevMap[c] = (prevMap[c] || 0) + r.n; });
  /* 按国聚合 */
  const byC = {};
  items.forEach(i => {
    const c = i.country || '未标注';
    if (!byC[c]) byC[c] = { country: c, list: [], types: {}, china: 0, casualty: 0 };
    const b = byC[c];
    b.list.push(i);
    b.types[i.type] = (b.types[i.type] || 0) + 1;
    if (i.china) b.china++;
    if (CASUALTY_RE.test(i.title)) b.casualty++;
  });
  const top15 = Object.values(byC).sort((a, b) => b.list.length - a.list.length).slice(0, 15).map(x => x.country);
  /* COSRI 高危国（TIER1 + 安全分≥8）并入全集 */
  const highRisk = new Set(INTEREST_BASE.COUNTRY_TIERS.TIER1.map(x => x.cn));
  try {
    const scores = (INTEREST_BASE.COUNTRY_RISK_INDICATORS || {}).scores || {};
    Object.keys(scores).forEach(c => { if (scores[c] && scores[c].security >= 8) highRisk.add(c); });
  } catch (e) {}
  const focus = Array.from(new Set(top15.concat(Array.from(highRisk))));
  const take = makeTake(items);
  const sections = focus.map(c => {
    const b = byC[c];
    if (!b) return section(c, [], 0); /* 梯队国无数据：如实零条 */
    const st = lvStat(b.list);
    const types = Object.entries(b.types).sort((a, x) => x[1] - a[1]).slice(0, 3).map(t => (_ANOM_CAT_LABELS[t[0]] || t[0]) + t[1] + '条').join('、');
    const mom = prevMap[c] != null ? '，环比上月' + (b.list.length >= prevMap[c] ? '+' : '') + (b.list.length - prevMap[c]) + '条' : '';
    /* 数据驱动风险等级（红橙占比+伤亡+涉华） */
    const score = st.red * 3 + st.orange * 1.5 + b.casualty * 1 + b.china * 0.5;
    const level = score >= 10 ? '高风险' : score >= 5 ? '中高风险' : score >= 2 ? '中风险' : '关注级';
    const sec = section(c, take(b.list.sort((a, x) => (_lvW[x.severity] || 0) - (_lvW[a.severity] || 0)), 6), 6);
    sec.note = '主要类型：' + (types || '—') + '；涉华事件' + b.china + '条、伤亡类事件' + b.casualty + '条' + mom + '。数据画像建议关注等级：' + level + '。';
    return sec;
  });
  const st = lvStat(items);
  return {
    title: '国别风险月度评估',
    stats: Object.assign({ total: items.length, chinaCount: items.filter(i => i.china).length, countries: Object.keys(byC).length }, st),
    sections,
    chart: focus.filter(c => byC[c]).map(c => ({ label: c, value: byC[c].list.length })).sort((a, b) => b.value - a.value).slice(0, 12),
    chartCap: '国别情报量分布（条）',
    extraPrompt: '关注国范围：情报量前15国与平台梯队TIER1/COSRI高危国并集。环比口径：与上一自然月采集量对比。'
  };
}

/* 3. 中资项目安全暴露分析（asset_tags 命中 + 项目识别正则双通道，TOP20 项目分节） */
async function assembleProjectExposure(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  const projs = INTEREST_BASE.KEY_PROJECTS;
  const byP = {};
  const byCountry = {};
  items.forEach(i => { const c = i.country || '未标注'; byCountry[c] = (byCountry[c] || 0) + 1; });
  items.forEach(i => {
    const text = i.title + ' ' + i.digest;
    projs.forEach(p => {
      const hit = (i.assets && i.assets.indexOf(p.name) >= 0) || p.re.test(text);
      if (!hit) return;
      if (!byP[p.name]) byP[p.name] = { proj: p, list: [] };
      byP[p.name].list.push(i);
    });
  });
  const ranked = Object.values(byP).sort((a, b) => b.list.length - a.list.length);
  const top20 = ranked.slice(0, 20);
  const sections = top20.map(g => {
    const st = lvStat(g.list);
    const sec = section(g.proj.name, g.list.slice().sort((a, x) => (_lvW[x.severity] || 0) - (_lvW[a.severity] || 0)), 6);
    sec.note = '所在国：' + g.proj.country + '；本周期命中情报' + g.list.length + '条（红' + st.red + '、橙' + st.orange + '）；同国事件总量' + (byCountry[g.proj.country] || 0) + '条（周边事件密度' + (byCountry[g.proj.country] ? Math.round(g.list.length / byCountry[g.proj.country] * 100) : 0) + '%）。';
    sec.items = g.list.slice(0, 6).sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))).map(toItem); /* 最近事件时间线 */
    return sec;
  });
  const hitItems = new Set();
  ranked.forEach(g => g.list.forEach(i => hitItems.add(i)));
  const st = lvStat(Array.from(hitItems));
  return {
    title: '中资项目安全暴露分析',
    stats: Object.assign({ total: items.length, hitProjects: ranked.length, hitItems: hitItems.size, chinaCount: items.filter(i => i.china).length }, st),
    sections,
    chart: top20.map(g => ({ label: g.proj.name, value: g.list.length })),
    chartCap: '项目命中情报量 TOP20（条）',
    extraPrompt: '项目命中口径：条目 asset_tags 命中项目名，或标题/摘要命中项目识别正则（中英文别名）。在册项目总数 ' + projs.length + ' 个，本周期命中 ' + ranked.length + ' 个。'
  };
}

/* 4. 威胁组织活动季报（threats.js 组织库 name+aliases 归因） */
const TACTIC_RE = /(袭击|爆炸|绑架|劫持|枪击|炮击|空袭|无人机|自杀式|路边炸弹|伏击|暗杀|网络攻击|勒索|海盗|走私|洗钱|招募|煽动|政变|屠杀|火箭弹|导弹)/g;
async function assembleThreatOrg(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  const matchers = orgMatchers();
  const byOrg = {};
  items.forEach(i => {
    const text = i.title + ' ' + i.digest;
    matchers.forEach(m => {
      if (!m.re.test(text)) return;
      if (!byOrg[m.org.name]) byOrg[m.org.name] = { org: m.org, list: [], tactics: {}, countries: {} };
      const g = byOrg[m.org.name];
      g.list.push(i);
      g.countries[i.country || '未标注'] = (g.countries[i.country || '未标注'] || 0) + 1;
      let mm;
      const RE = new RegExp(TACTIC_RE.source, 'g');
      while ((mm = RE.exec(i.title))) g.tactics[mm[1]] = (g.tactics[mm[1]] || 0) + 1;
    });
  });
  const ranked = Object.values(byOrg).sort((a, b) => b.list.length - a.list.length).slice(0, 15);
  const sections = ranked.map(g => {
    const st = lvStat(g.list);
    const sec = section(g.org.name + '（' + (g.org.type || '—') + '）', g.list.slice().sort((a, x) => (_lvW[x.severity] || 0) - (_lvW[a.severity] || 0)), 6);
    const tacs = Object.entries(g.tactics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0] + x[1] + '次').join('、');
    const regs = Object.entries(g.countries).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0] + x[1] + '条').join('、');
    sec.note = '组织状态：' + (g.org.status || '—') + '；威胁等级 ' + (g.org.threatLevel || '—') + '；活动区域：' + (regs || '—') + '；手法关键词：' + (tacs || '标题未含典型手法词') + '。';
    return sec;
  });
  const st = lvStat(items);
  return {
    title: '威胁组织活动季报',
    stats: Object.assign({ total: items.length, orgs: Object.keys(byOrg).length, chinaCount: items.filter(i => i.china).length }, st),
    sections,
    chart: ranked.map(g => ({ label: g.org.name, value: g.list.length })),
    chartCap: '威胁组织关联情报量（条）',
    extraPrompt: '归因口径：条目标题/摘要命中组织名或别名（含连字符/空格变体，ASCII 缩写加词边界）。组织库共 ' + loadOrgs().length + ' 个组织，本周期命中 ' + Object.keys(byOrg).length + ' 个。'
  };
}

/* 5. 海上咽喉要道月报（interest-base 八大通道 + 袭击/劫持/扣押/水雷/封锁等事件词） */
const CHOKE_INCIDENT_RE = /袭击|劫持|扣押|水雷|封锁|海盗|导弹|爆炸|无人机|攻击|扰动|中断|停航|绕行|险情|碰撞|失事/;
async function assembleChokepoint(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  const channels = INTEREST_BASE.STRAIT_CHANNELS;
  const take = makeTake(items);
  const sections = channels.map(ch => {
    const list = items.filter(i => ch.re.test(i.title + ' ' + i.digest) && CHOKE_INCIDENT_RE.test(i.title + ' ' + i.digest));
    const sec = section(ch.name, take(list, 8), 8);
    sec.note = ch.note || '';
    return sec;
  });
  const hitItems = new Set();
  items.forEach(i => { if (CHOKE_INCIDENT_RE.test(i.title + ' ' + i.digest) && channels.some(ch => ch.re.test(i.title + ' ' + i.digest))) hitItems.add(i); });
  const st = lvStat(Array.from(hitItems));
  return {
    title: '海上咽喉要道月报',
    stats: Object.assign({ total: items.length, hitItems: hitItems.size, chinaCount: Array.from(hitItems).filter(i => i.china).length }, st),
    sections,
    chart: sections.map(s => ({ label: s.name, value: s.count })),
    chartCap: '各要道事件量（条）',
    extraPrompt: '事件口径：标题/摘要命中要道名（含中英文别名）且含袭击/劫持/扣押/水雷/封锁等事件关键词。'
  };
}

/* 6. 制裁合规动态分析（对华制裁/涉华实体/第三国制裁） */
const SANC_SCOPE_RE = /制裁|实体清单|出口管制|二级制裁|SDN|冻结.*资产|黑名单|管制清单/;
async function assembleSanction(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  const sanc = items.filter(i => i.type === 'sanctions_data' || SANC_SCOPE_RE.test(i.title + ' ' + i.digest));
  const zh = sanc.filter(i => i.china && /中国|对华|涉华|中方/.test(i.title + ' ' + i.digest));
  const zhEnt = sanc.filter(i => !zh.includes(i) && i.china && /实体清单|列入|中企|中国企业|中国公司|银行|华为|中兴|中芯|字节|比亚迪|宁德时代|海康/.test(i.title + ' ' + i.digest));
  const third = sanc.filter(i => !zh.includes(i) && !zhEnt.includes(i));
  const take = makeTake(sanc);
  const sections = [
    section('对华制裁措施', take(zh, 10), 10),
    section('涉华实体清单动态', take(zhEnt, 10), 10),
    section('第三国制裁动态', take(third, 10), 10)
  ];
  const st = lvStat(sanc);
  return {
    title: '制裁合规动态分析',
    stats: Object.assign({ total: items.length, sancTotal: sanc.length, chinaCount: zh.length + zhEnt.length }, st),
    sections,
    chart: sections.map(s => ({ label: s.name, value: s.count })),
    chartCap: '制裁合规情报分布（条）',
    extraPrompt: '口径：data_type 为制裁数据，或标题/摘要命中制裁/实体清单/出口管制/二级制裁/SDN 等词。对华制裁=直接针对中国主体；涉华实体=中国实体被列入清单；第三国制裁=其他制裁动态。'
  };
}

/* 7. 风险异动信号日报（与 _runAnomalyWatch 同源：7 日基线 + 内容实质校验） */
async function assembleAnomalyDaily(q, win) {
  const [d0, d1] = win;
  const b0 = new Date(d0.getTime() - 7 * 86400000);
  const hist = await _anomCounts(q, b0, d0);
  const base = {};
  hist.forEach(r => { const cn = _iso2cn(r.c); const k = r.t + '|' + cn; base[k] = (base[k] || 0) + r.n; });
  const tod = await _anomCounts(q, d0, d1);
  const tit = await q(
    `SELECT data_type t, country c, COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title FROM intel_data
     WHERE collect_time >= $1 AND collect_time < $2 AND audit_status='approved' ORDER BY collect_time DESC LIMIT 600`,
    [d0, d1]
  );
  const sampleMap = {};
  tit.rows.forEach(r => {
    const k = r.t + '|' + _iso2cn(r.c);
    if (!sampleMap[k]) sampleMap[k] = [];
    if (sampleMap[k].length < 5) sampleMap[k].push(r.title || '');
  });
  const signals = [];
  let scanned = 0, suppressed = 0;
  for (const r of tod) {
    const cn = _iso2cn(r.c);
    if (!cn || cn === '中国' || cn === 'CN' || cn === 'CHN' || cn === '未知' || cn === '全球') continue;
    scanned++;
    const k = r.t + '|' + cn;
    const total7 = base[k] || 0;
    const avg = total7 / 7, today = r.n;
    let ratio = 0, kind = '';
    if (total7 >= 3) {
      ratio = today / avg;
      if (today >= 4 && ratio >= 1.8) kind = '升温';
    } else if (today >= 6) kind = '突发';
    if (!kind) continue;
    const sub = anomSubstance(r.t, sampleMap[k] || []);
    if (sub.action === 'suppress') { suppressed++; continue; }
    const tier = INTEREST_BASE.getTier ? INTEREST_BASE.getTier(cn) : null;
    let level = 'yellow';
    if (ratio >= 4.5 && today >= 10 && tier === 'TIER1') level = 'red';
    else if (ratio >= 3 && today >= 8) level = 'orange';
    if (sub.action === 'media' || sub.action === 'homo') level = 'yellow';
    const samples = (sampleMap[k] || []).slice(0, 3).map(s => String(s).slice(0, 50));
    signals.push({
      country: cn, typeLabel: _ANOM_CAT_LABELS[r.t] || r.t, kind, level,
      today, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10,
      subAction: sub.action, subReason: sub.reason, samples
    });
  }
  signals.sort((a, b) => (b.ratio || 99) - (a.ratio || 99) || b.today - a.today);
  const sigSections = [
    { name: '风险升温信号', list: signals.filter(s => s.kind === '升温' && s.subAction === 'pass') },
    { name: '突发聚集信号', list: signals.filter(s => s.kind === '突发' && s.subAction === 'pass') },
    { name: '内容实质复核（媒体舆论/单一事件多源，降级关注）', list: signals.filter(s => s.subAction !== 'pass') }
  ];
  /* 信号对象 → 条目形态（title/level/country/time/digest） */
  const toSig = s => ({
    title: (s.subAction === 'media' ? '【媒体舆论异动】' : s.subAction === 'homo' ? '【单一事件多源报道】' : '【风险' + s.kind + '】') + s.country + '·' + s.typeLabel + '情报量异动：7日均' + s.avg + '条→今日' + s.today + '条' + (s.kind === '升温' ? '（' + s.ratio + '倍）' : ''),
    level: s.level, country: s.country, time: _dayKey(d0), url: '',
    digest: '基线：近7日日均' + s.avg + '条，今日' + s.today + '条。内容实质判定：' + (s.subAction === 'pass' ? '通过（真实事件聚集）' : s.subReason) + '。样例：' + s.samples.join('；')
  });
  const secAll = sigSections.map(x => {
    const list = x.list.map(toSig);
    const red = list.filter(i => i.level === 'red').length, orange = list.filter(i => i.level === 'orange').length;
    return { name: x.name, count: list.length, red, orange, items: list.slice(0, 12) };
  });
  const lv = { red: signals.filter(s => s.level === 'red').length, orange: signals.filter(s => s.level === 'orange').length, yellow: signals.filter(s => s.level === 'yellow').length, blue: 0 };
  return {
    title: '风险异动信号日报',
    stats: Object.assign({ total: signals.length, scanned, suppressed, chinaCount: null }, lv),
    sections: secAll,
    chart: secAll.map(s => ({ label: s.name.replace(/（.*）/, ''), value: s.count })),
    chartCap: '当日异动信号分布（项）',
    extraPrompt: '异动口径：类别×国家今日入库量对近7日均值≥1.8倍且≥4条（升温），或无基线且≥6条（突发）；全部经内容实质校验（媒体舆论异动/单一事件多源报道降级为黄色关注）。本日扫描方向' + scanned + '个，抑制非实质信号' + suppressed + '项。'
  };
}

/* 8. 热点冲突外溢专报（俄乌/红海/中东/萨赫勒四热点涉华外溢 + 通道影响） */
const HOTSPOTS = [
  { name: '俄乌方向', re: /俄乌|俄罗斯|乌克兰|基辅|莫斯科|顿巴斯|扎波罗热|赫尔松|克里米亚/ },
  { name: '红海方向', re: /红海|曼德|胡塞|也门|亚丁湾|苏伊士/ },
  { name: '中东方向', re: /以色列|加沙|黎巴嫩|伊朗|叙利亚|中东|约旦河西岸/ },
  { name: '萨赫勒方向', re: /萨赫勒|马里|尼日尔|布基纳法索|乍得|毛里塔尼亚|西非/ }
];
async function assembleSpillover(q, win) {
  const items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  const chinaItems = items.filter(i => i.china);
  const take = makeTake(chinaItems);
  const sections = HOTSPOTS.map(h => section(h.name + '涉华外溢动态', take(chinaItems.filter(i => h.re.test(i.title + ' ' + i.digest)), 8), 8));
  /* 咽喉通道影响（不必涉华，但须通道+事件词） */
  const chanItems = items.filter(i => INTEREST_BASE.STRAIT_CHANNELS.some(ch => ch.re.test(i.title + ' ' + i.digest)) && CHOKE_INCIDENT_RE.test(i.title + ' ' + i.digest));
  const takeChan = makeTake(chanItems);
  sections.push(section('海上咽喉通道影响', takeChan(chanItems, 8), 8));
  const st = lvStat(chinaItems);
  return {
    title: '热点冲突外溢专报',
    stats: Object.assign({ total: items.length, chinaCount: chinaItems.length, chanHit: chanItems.length }, st),
    sections,
    chart: sections.map(s => ({ label: s.name.replace(/涉华外溢动态|影响/, ''), value: s.count })),
    chartCap: '四热点涉华外溢与通道影响（条）',
    extraPrompt: '本报告定位为"涉华外溢视角"：只研判俄乌/红海/中东/萨赫勒四热点冲突对中国海外利益的传导影响（人员安全、资产运营、通道航运、供应链），不做纯域内战况综述。涉华口径为平台 isChinaRelatedStrict 严格标准。'
  };
}

/* 9. 专题分析模型报告（仅手动：交互式选题 → 模型矩阵深度分析）
 * 2026-09-03 用户指令重设计：「先大量给用户选择的专题内容」+「分析要详细深度、体现模型差异化」。
 * options = { topic, dims:[org|trend|country|china|project|chokepoint|sanction], countries:[], orgs:[], windowDays }
 * 未传 options 时保持默认三维（组织归因/趋势/国别），兼容旧入口。 */
const MODEL_DIMS = {
  org: '威胁组织归因分析',
  trend: '事件趋势分析',
  country: '国别分布分析',
  china: '涉华暴露分析',
  project: '中资项目关联分析',
  chokepoint: '海上咽喉要道动态',
  sanction: '制裁合规动态'
};
async function assembleModelExport(q, win, periodKey, opts) {
  const o = opts || {};
  let items = dedupeEvents(cleanItems(await fetchItems(q, win[0], win[1])));
  /* 选题过滤：国别聚焦 */
  if (Array.isArray(o.countries) && o.countries.length) {
    const want = new Set(o.countries.map(c => _iso2cn(c)));
    items = items.filter(i => want.has(i.country));
  }
  const dims = (Array.isArray(o.dims) && o.dims.length) ? o.dims.filter(d => MODEL_DIMS[d]) : ['org', 'trend', 'country'];
  const sections = [];
  /* —— 维度：威胁组织归因 —— */
  if (dims.indexOf('org') >= 0) {
    let matchers = orgMatchers();
    if (Array.isArray(o.orgs) && o.orgs.length) {
      const want = new Set(o.orgs.map(s => String(s).trim()));
      matchers = matchers.filter(m => want.has(m.org.name));
    }
    const byOrg = {};
    items.forEach(i => {
      const text = i.title + ' ' + i.digest;
      matchers.forEach(m => {
        if (!m.re.test(text)) return;
        if (!byOrg[m.org.name]) byOrg[m.org.name] = { org: m.org, list: [], countries: {}, tactics: {} };
        byOrg[m.org.name].list.push(i);
        const c = i.country || '未标注';
        byOrg[m.org.name].countries[c] = (byOrg[m.org.name].countries[c] || 0) + 1;
        let mm; const RE = new RegExp(TACTIC_RE.source, 'g');
        while ((mm = RE.exec(i.title))) byOrg[m.org.name].tactics[mm[1]] = (byOrg[m.org.name].tactics[mm[1]] || 0) + 1;
      });
    });
    const orgRanked = Object.values(byOrg).sort((a, b) => b.list.length - a.list.length).slice(0, 12);
    if (orgRanked.length) {
      const sec = section(MODEL_DIMS.org + '（模型输出）', orgRanked.map(g => {
        const tacs = Object.entries(g.tactics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0] + x[1] + '次').join('、');
        return {
          title: g.org.name + '：窗口内关联情报 ' + g.list.length + ' 条（' + Object.entries(g.countries).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0] + x[1] + '条').join('、') + '）',
          level: g.org.threatLevel >= 8 ? 'red' : g.org.threatLevel >= 6 ? 'orange' : 'yellow',
          country: Object.keys(g.countries)[0] || '—', time: _cnTime(g.list[0] && g.list[0].time) || '—', url: '',
          digest: (g.org.type || '') + '；状态：' + (g.org.status || '—') + '；手法关键词：' + (tacs || '标题未含典型手法词')
        };
      }), 12);
      sec.note = '归因口径：标题/摘要命中组织名或别名（含变体，ASCII 加词边界）。命中组织 ' + Object.keys(byOrg).length + ' 个。';
      sections.push(sec);
    } else {
      sections.push(section(MODEL_DIMS.org + '（模型输出）', [], 0));
    }
    var _orgChart = orgRanked.map(g => ({ label: g.org.name, value: g.list.length }));
  }
  /* —— 维度：事件趋势（窗口内按周分桶 + 红橙占比拐点） —— */
  if (dims.indexOf('trend') >= 0) {
    const byWeek = {};
    items.forEach(i => {
      const t = i.time && /^\d{4}-\d{2}-\d{2}/.test(String(i.time)) ? new Date(String(i.time).replace(' ', 'T')) : (i._ct || null);
      if (!t || isNaN(t)) return;
      const wk = weekKey(t);
      if (!byWeek[wk]) byWeek[wk] = { total: 0, ro: 0 };
      byWeek[wk].total++;
      if (i.severity === 'red' || i.severity === 'orange') byWeek[wk].ro++;
    });
    const weeks = Object.keys(byWeek).sort();
    const trendSec = section(MODEL_DIMS.trend + '（模型输出）', weeks.map(wk => ({
      title: wk + '：独立事件 ' + byWeek[wk].total + ' 条，红橙合计 ' + byWeek[wk].ro + ' 条（占比 ' + Math.round(byWeek[wk].ro * 100 / Math.max(1, byWeek[wk].total)) + '%）',
      level: byWeek[wk].ro / Math.max(1, byWeek[wk].total) >= 0.3 ? 'orange' : 'yellow',
      country: '—', time: wk, url: '', digest: ''
    })), 14);
    trendSec.note = '分桶口径：ISO 周；红橙占比≥30% 的周标记为橙色（威胁强度上行拐点候选）。';
    sections.push(trendSec);
  }
  /* —— 维度：国别分布 —— */
  if (dims.indexOf('country') >= 0) {
    const byC = {};
    items.forEach(i => { const c = i.country || '未标注'; byC[c] = (byC[c] || 0) + 1; });
    const topC = Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 12);
    sections.push(section(MODEL_DIMS.country + '（模型输出）', topC.map(x => ({
      title: x[0] + '：' + x[1] + ' 条', level: 'yellow', country: x[0], time: '—', url: '', digest: ''
    })), 12));
  }
  /* —— 维度：涉华暴露 —— */
  if (dims.indexOf('china') >= 0) {
    const zh = items.filter(i => i.china);
    const zhSec = section(MODEL_DIMS.china + '（模型输出）', zh.slice(0, 12).map(toItem), 12);
    zhSec.note = '涉华口径：isChinaRelatedStrict 严格标准；窗口内命中 ' + zh.length + ' 条（负面 ' + zh.filter(i => i.negative).length + ' 条）。';
    sections.push(zhSec);
  }
  /* —— 维度：中资项目关联 —— */
  if (dims.indexOf('project') >= 0) {
    const projs = INTEREST_BASE.KEY_PROJECTS;
    const byP = {};
    items.forEach(i => {
      const text = i.title + ' ' + i.digest;
      projs.forEach(p => {
        if ((i.assets && i.assets.indexOf(p.name) >= 0) || p.re.test(text)) {
          byP[p.name] = (byP[p.name] || 0) + 1;
        }
      });
    });
    const ranked = Object.entries(byP).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const prSec = section(MODEL_DIMS.project + '（模型输出）', ranked.map(x => ({
      title: x[0] + '：窗口内命中情报 ' + x[1] + ' 条', level: x[1] >= 5 ? 'orange' : 'yellow', country: '—', time: '—', url: '', digest: ''
    })), 12);
    prSec.note = '命中口径：asset_tags 或标题/摘要命中项目识别正则。在册项目 ' + projs.length + ' 个，命中 ' + Object.keys(byP).length + ' 个。';
    sections.push(prSec);
  }
  /* —— 维度：海上咽喉要道 —— */
  if (dims.indexOf('chokepoint') >= 0) {
    const channels = INTEREST_BASE.STRAIT_CHANNELS;
    const chSecs = channels.map(ch => {
      const list = items.filter(i => ch.re.test(i.title + ' ' + i.digest) && CHOKE_INCIDENT_RE.test(i.title + ' ' + i.digest));
      return { ch, n: list.length, list };
    }).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const cpSec = section(MODEL_DIMS.chokepoint + '（模型输出）', chSecs.map(x => ({
      title: x.ch.name + '：窗口内事件 ' + x.n + ' 条（' + x.list.slice(0, 2).map(i => String(i.title).slice(0, 40)).join('；') + '）',
      level: x.list.some(i => i.severity === 'red') ? 'red' : x.n >= 3 ? 'orange' : 'yellow',
      country: '—', time: '—', url: '', digest: x.ch.note || ''
    })), 10);
    cpSec.note = '口径：要道名（含中英文别名）且含袭击/劫持/扣押/封锁等事件词；八大要道命中 ' + chSecs.length + ' 条。';
    sections.push(cpSec);
  }
  /* —— 维度：制裁合规 —— */
  if (dims.indexOf('sanction') >= 0) {
    const sanc = items.filter(i => i.type === 'sanctions_data' || SANC_SCOPE_RE.test(i.title + ' ' + i.digest));
    const scSec = section(MODEL_DIMS.sanction + '（模型输出）', sanc.slice(0, 12).map(toItem), 12);
    scSec.note = '口径：制裁数据类或标题/摘要命中制裁/实体清单/出口管制等词；窗口内 ' + sanc.length + ' 条（涉华 ' + sanc.filter(i => i.china).length + ' 条）。';
    sections.push(scSec);
  }
  const st = lvStat(items);
  const dimNames = dims.map(d => MODEL_DIMS[d]).join('、');
  const topicLine = o.topic ? '专题主题：「' + o.topic + '」。' : '';
  const countryLine = (Array.isArray(o.countries) && o.countries.length) ? '国别聚焦：' + o.countries.map(_iso2cn).join('、') + '。' : '';
  const orgLine = (Array.isArray(o.orgs) && o.orgs.length) ? '组织聚焦：' + o.orgs.join('、') + '。' : '';
  return {
    title: o.topic ? ('专题分析模型报告：' + o.topic) : '专题分析模型报告',
    stats: Object.assign({ total: items.length, chinaCount: items.filter(i => i.china).length, orgs: dims.indexOf('org') >= 0 ? sections[0] && sections[0].count || 0 : null, dims: dims.length }, st),
    sections,
    chart: (dims.indexOf('org') >= 0 && typeof _orgChart !== 'undefined' && _orgChart.length) ? _orgChart
      : (dims.indexOf('country') >= 0 ? Object.entries(items.reduce((m, i) => { const c = i.country || '未标注'; m[c] = (m[c] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => ({ label: x[0], value: x[1] })) : []),
    chartCap: '专题模型指标分布（条）',
    extraPrompt: topicLine + countryLine + orgLine +
      '本报告为专题分析模型矩阵计算结果：分析维度 ' + dimNames + '；统计窗口近 ' + Math.round((win[1] - win[0]) / 86400000) + ' 天。' +
      '深度分析要求（模型差异化，明显高于常规报告）：（一）组织行为模式分析——从手法关键词分布推断袭击偏好与能力变化；（二）趋势拐点研判——逐周红橙占比变化，识别威胁强度上行/下行的拐点周并给出数据依据；（三）风险传导链——将组织活动/要道事件/制裁动态与中资项目暴露逐环关联，形成「事件→通道→项目→人员」的传导路径；（四）对我影响量化——涉华命中与项目命中按维度汇总，明确哪些在册项目处于传导链末端；（五）全部结论标注三级确定性（已证实/研判认为/需持续关注），每个判断须指向具体节数据。'
  };
}

/* ============================================================
 * 十、9 类报告定义
 * ============================================================ */
const REPORT_TYPES = [
  {
    id: 'cn-negative-weekly', name: '涉华负面情报周报', freq: 'weekly',
    desc: '每周一 06:00 生成上一 ISO 周，按人员安全/财产受损/制裁合规/舆情攻击/间谍渗透/领事保护六维归集涉华负面情报',
    periodKey: weekKey, window: weekWindow,
    assemble: assembleCnNegativeWeekly,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本周期涉华负面态势总体判断，置于最前）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）总体态势研判，须引用具体统计数字；（二）重点方向研判，选取数据量最大或红橙最集中的两至三个方向逐项研判，明确区分"已证实""研判认为""需持续关注"三级确定性表述；（三）对策建议，3至5条，按紧迫性排序，面向外交部、商务部、公安部及中央企业领导决策参考。'
  },
  {
    id: 'country-risk-monthly', name: '国别风险月度评估', freq: 'monthly',
    desc: '每月 1 日 06:00 生成上一自然月，情报量前 15 国与 TIER1/COSRI 高危国全集逐国画像与风险等级建议',
    periodKey: null, window: monthWindow,
    assemble: assembleCountryRisk,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本月国别风险总体格局）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）全球态势总体研判，须引用总量、环比、红橙结构等具体数字；（二）重点国别研判，选取事件量最大或风险等级最高的3至5国逐国研判，结合其数据画像（类型结构、伤亡类事件、涉华事件、环比变化）给出风险走势判断，区分"已证实""研判认为""需持续关注"；（三）对策建议，3至5条，按国别风险紧迫性排序。'
  },
  {
    id: 'project-exposure-quarterly', name: '中资项目安全暴露分析', freq: 'quarterly',
    desc: '每季首日 06:00 生成上一季度（可手动触发），中资重点项目情报命中与周边事件密度 TOP20 分析',
    periodKey: null, window: quarterWindow,
    assemble: assembleProjectExposure,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本季度中资项目安全暴露总体态势）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）项目暴露总体研判，须引用命中项目数、命中情报量、红橙结构等具体数字；（二）重点项目逐项研判，选取命中量最大或红橙最集中的3至5个项目，结合其所在国事件密度研判安全形势；（三）对策建议，3至5条，按项目风险紧迫性排序，面向中央企业安全生产与海外项目管理决策参考。'
  },
  {
    id: 'threat-org-quarterly', name: '威胁组织活动季报', freq: 'quarterly',
    desc: '每季首日 06:00 生成上一季度，威胁组织库归因关联情报的活动区域与手法分析',
    periodKey: null, window: quarterWindow,
    assemble: assembleThreatOrg,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本季度威胁组织活动总体态势）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）组织活动总体研判，须引用命中组织数、关联情报量等具体数字；（二）重点组织逐项研判，选取关联情报量最大的3至5个组织，结合其活动区域、手法关键词、组织状态研判威胁走向，区分"已证实""研判认为""需持续关注"；（三）对策建议，3至5条，面向公安部、国家安全部反恐与海外利益保护决策参考。'
  },
  {
    id: 'chokepoint-monthly', name: '海上咽喉要道月报', freq: 'monthly',
    desc: '每月 1 日 06:00 生成上一自然月，八大海上咽喉要道袭击/劫持/扣押/封锁类事件监测',
    periodKey: null, window: monthWindow,
    assemble: assembleChokepoint,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本月海上咽喉要道安全态势）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）要道安全总体研判，须引用各要道事件量等具体数字；（二）重点要道逐项研判，选取事件量最大或红橙最集中的2至3条要道，结合其战略地位（马六甲石油运输、霍尔木兹原油通道、曼德海峡中欧贸易动脉等）研判航运安全影响，区分"已证实""研判认为""需持续关注"；（三）对策建议，3至5条，涵盖航运预警、绕行评估与护航协作。'
  },
  {
    id: 'sanction-compliance-monthly', name: '制裁合规动态分析', freq: 'monthly',
    desc: '每月 1 日 06:00 生成上一自然月，对华制裁/涉华实体/第三国制裁三节归集',
    periodKey: null, window: monthWindow,
    assemble: assembleSanction,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本月制裁合规动态总体态势）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）制裁态势总体研判，须引用三节情报量等具体数字；（二）重点方向研判，对华制裁措施与涉华实体清单动态须逐项研判政策意图与合规影响，第三国制裁研判外溢风险，区分"已证实""研判认为""需持续关注"；（三）对策建议，3至5条，面向商务部及中央企业合规管理决策参考，涵盖合规审查、供应链替代与法律应对。'
  },
  {
    id: 'anomaly-daily', name: '风险异动信号日报', freq: 'daily',
    desc: '每日 07:00 生成昨日，类别×国家情报量异动信号汇总与内容实质判定（与每日简报 06:30 错峰）',
    periodKey: _dayKey, window: dayWindow,
    assemble: assembleAnomalyDaily,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括昨日风险异动信号总体情况）；随后按公文体撰写"综合研判与对策建议"（400至700字）：（一）异动信号总体研判，须引用信号数、扫描方向数、抑制数等具体数字；（二）重点信号逐项研判，选取级别最高或倍数最大的2至4项信号，结合其基线数据与内容实质判定结论研判风险走向，特别注明媒体舆论异动与单一事件多源报道类信号只作低度关注；（三）对策建议，2至4条，按信号级别排序。若无任何异动信号，如实写明并给出常态监测建议。'
  },
  {
    id: 'conflict-spillover-weekly', name: '热点冲突外溢专报', freq: 'weekly',
    desc: '每周一 06:00 生成上一 ISO 周，俄乌/红海/中东/萨赫勒四热点涉华外溢与海上通道影响（涉华外溢视角）',
    periodKey: weekKey, window: weekWindow,
    assemble: assembleSpillover,
    promptBrief: '请撰写：第一段"内容提要"（120字以内，概括本周期四热点涉华外溢总体态势）；随后按公文体撰写"综合研判与对策建议"（600至900字）：（一）外溢态势总体研判，须引用各方向涉华事件量等具体数字，明确本报告为涉华外溢视角，不做纯域内战况综述；（二）重点方向研判，选取涉华事件最集中的一至两个方向，研判其对中方人员安全、资产运营、航运通道、供应链的传导影响，区分"已证实""研判认为""需持续关注"；（三）对策建议，3至5条，涵盖人员撤离评估、资产安保与航运调整。'
  },
  {
    id: 'model-export', name: '专题分析模型报告', freq: 'manual', manualOnly: true,
    desc: '交互式选题（分析维度/国家/组织/时间窗自由组合）→ 模型矩阵深度分析：组织行为模式/趋势拐点/风险传导链/涉华暴露量化',
    periodKey: null, window: monthWindow,
    assemble: assembleModelExport,
    promptBrief: '请撰写：第一段"内容提要"（150字以内，概括本专题模型计算的核心结论）；随后按公文体撰写"综合研判与对策建议"（900至1400字，深度须明显高于常规周期报告）：（一）模型结果总体研判，须引用各分析维度的具体数字；（二）深度分析研判，按以下要求展开：组织行为模式分析（从手法关键词分布推断袭击偏好与能力变化）、趋势拐点研判（逐周红橙占比变化识别威胁强度拐点并给出数据依据）、风险传导链（组织活动/要道事件/制裁动态与中资项目暴露逐环关联，形成"事件→通道→项目→人员"传导路径）、对我影响量化（涉华与项目命中按维度汇总，点名处于传导链末端的在册项目）；（三）对策建议，3至6条，按风险传导链的紧迫环节排序，面向外交部、商务部、公安部、国家安全部及中央企业决策参考。注明本报告为专题分析模型矩阵计算结果，供深度研判参考。'
  }
];
function defOf(typeId) { return REPORT_TYPES.find(d => d.id === typeId); }

/* model-export 窗口特例：默认近 90 天；带选题 options 时按 windowDays（30/90/180/365）
 * 2026-09-03 周期化：显式 freq（日/周/月/季/半年/年）时窗口按该频率周期键计算 */
function periodWindowOf(def, key, freq, opts) {
  if (def.id === 'model-export') {
    const days = (opts && Number(opts.windowDays)) || 90;
    const d = Math.max(7, Math.min(365, days));
    const now = new Date();
    return [new Date(now.getFullYear(), now.getMonth(), now.getDate() - d), now];
  }
  if (freq && FREQ_ALL.indexOf(freq) >= 0) return windowOfFreq(freq, key);
  return def.window(key);
}

/* ============================================================
 * 十一、生成主流程：装配 → LLM 研判 → 清洗 → govPunctuate → 渲染 → UPSERT
 * ============================================================ */
async function generateReport(typeId, periodKey, opts) {
  const def = defOf(typeId);
  if (!def) throw new Error('未知报告类型：' + typeId);
  const o = opts || {};
  const freq = (o.freq && FREQ_ALL.indexOf(o.freq) >= 0) ? o.freq : '';
  /* model-export 带自定义选题：期次键用时间戳保证每次生成独立成期 */
  if (def.id === 'model-export' && o.custom) {
    periodKey = periodKey || ('SP' + Date.now().toString(36).toUpperCase());
  }
  const win = periodWindowOf(def, periodKey, freq, o);
  const lockKey = typeId + '|' + periodKey;
  if (_generating.has(lockKey)) { const e = new Error('该报告正在生成中，请稍候'); e.code = 429; throw e; }
  _generating.add(lockKey);
  try {
    const data = await def.assemble(_ctx.query, win, periodKey, o);
    data.win = win;
    /* 2026-09-03 名称随周期变动：有效频率（显式 freq 或期次键推断）≠ 类型默认频率时改写名称；
     * def2 让 LLM 提示词 / 标准版徽标 / 公文版头部 / 摘要 / 入库标题全部使用同一动态名称 */
    const effFreq = freq || freqOfPeriodKey(periodKey) || def.freq;
    const dynTitle = (!def.manualOnly && effFreq !== def.freq && FREQ_ALL.indexOf(effFreq) >= 0)
      ? titleForFreq(data.title || def.name, effFreq)
      : (data.title || def.name);
    const def2 = (dynTitle !== def.name) ? Object.assign({}, def, { name: dynTitle, title: dynTitle }) : def;
    const llm = await runLlm(def2, periodKey, win, data);
    /* 2026-09-03 公文成稿三道清洗：Markdown 剥离 → 残留清洗（西式时间/省略号/内部代号）→ 标点全角 */
    const llmText = llm.ok ? govPunctuate(polishGovText(stripMarkdown(llm.text))) : '';
    const html = renderHtml(def2, periodKey, data, llmText, llm.ok);
    const govHtml = renderGovHtml(def2, periodKey, data, llmText, llm.ok);
    const paras = _llmParas(llmText);
    /* 摘要取首个有实质内容的段落（跳过「内容提要」类短标题行） */
    const absPara = paras.find(p => p.replace(/[\s（(【】）)「」：:、，。]/g, '').length >= 15) || paras[0] || '';
    const summary = {
      typeName: def2.name, period: periodKey, freq: effFreq,
      total: (data.stats || {}).total || 0, red: (data.stats || {}).red || 0, orange: (data.stats || {}).orange || 0,
      sectionCounts: (data.sections || []).map(s => s.name + ':' + s.count).join('，'),
      abstract: llm.ok ? absPara.slice(0, 200) : '本期待大模型研判服务恢复后补充生成。',
      topic: o.topic || '',
      llmOk: llm.ok, llmError: llm.ok ? '' : llm.error
    };
    const dataJson = {
      stats: data.stats, sections: data.sections, chart: data.chart || [], chartCap: data.chartCap || '',
      extraPrompt: data.extraPrompt || '', win: [_dayKey(win[0]), _dayKey(win[1])],
      freq: effFreq,
      options: def.id === 'model-export' ? { topic: o.topic || '', dims: o.dims || null, countries: o.countries || null, orgs: o.orgs || null, windowDays: o.windowDays || 90 } : null,
      generatedAt: new Date().toISOString()
    };
    const r = await _ctx.query(
      `INSERT INTO report_products (rtype, period, title, html, gov_html, summary, data_json, llm_model, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (rtype, period) DO UPDATE SET title=$3, html=$4, gov_html=$5, summary=$6, data_json=$7, llm_model=$8, created_at=NOW()
       RETURNING id`,
      [typeId, periodKey, dynTitle, html, govHtml, JSON.stringify(summary), JSON.stringify(dataJson), llm.ok ? llm.model : null]
    );
    return { id: r.rows[0].id, period: periodKey, freq: effFreq, title: dynTitle, llmOk: llm.ok, llmError: llm.error || '' };
  } finally {
    _generating.delete(lockKey);
  }
}

/* ============================================================
 * 十二、定时补生成（每小时检查当期是否已生成，未生成则补）
 * ============================================================ */
let _schedTimer = null;
async function scheduleCheck() {
  if (!_ctx || !_ctx.query) return;
  const now = new Date();
  for (const def of REPORT_TYPES) {
    if (def.manualOnly) continue;
    try {
      const t = currentTarget(def.freq, now);
      if (!t || !t.due) continue;
      const r = await _ctx.query('SELECT id FROM report_products WHERE rtype=$1 AND period=$2', [def.id, t.key]);
      if (r.rows.length) continue;
      console.log('[REPORTS] 定时补生成：' + def.id + ' ' + t.key);
      await generateReport(def.id, t.key);
    } catch (e) {
      console.warn('[REPORTS] 定时生成失败 ' + def.id + ': ' + e.message);
    }
  }
}

/* ============================================================
 * 十三、API 路由（全部 authMiddleware）
 * ============================================================ */
function registerRoutes(app, auth) {
  /* 9 类产品类型 + 每类最近一期 */
  app.get('/api/reports/products/types', auth, async (req, res) => {
    try {
      const r = await _ctx.query('SELECT rtype, period, created_at FROM report_products ORDER BY created_at DESC');
      const last = {};
      r.rows.forEach(row => { if (!last[row.rtype]) last[row.rtype] = row; });
      res.json({ ok: true, types: REPORT_TYPES.map(d => ({
        id: d.id, name: d.name, freq: d.freq, freqs: FREQ_ALL, desc: d.desc, manualOnly: !!d.manualOnly,
        lastPeriod: (last[d.id] || {}).period || null,
        lastAt: (last[d.id] || {}).created_at || null
      })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* 手动生成（同步返回；LLM 最长约 3 分钟）
   * 2026-09-03 周期化：body.freq 可选日/周/月/季/半年/年——任一报告类型均可按任意周期生成；
   * 手动生成默认「当期」（含进行中周期，保证新系统也有数据），未传 freq 时回落该类型默认频率。
   * model-export 支持 body.options（交互式选题：topic/dims/countries/orgs/windowDays）。 */
  app.post('/api/reports/products/generate', auth, async (req, res) => {
    try {
      const { type, period, freq, options } = req.body || {};
      const def = defOf(type);
      if (!def) return res.status(400).json({ ok: false, error: '未知报告类型：' + type });
      const o = (options && typeof options === 'object') ? options : {};
      const useFreq = (freq && FREQ_ALL.indexOf(freq) >= 0) ? freq : '';
      let key = period;
      if (!key) {
        if (def.manualOnly) key = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        else {
          /* 手动默认当期（用户痛点：季报默认上一空季 → 无内容） */
          const t = currentPeriodOf(useFreq || def.freq, new Date()) || currentTarget(useFreq || def.freq, new Date()).key;
          key = t;
        }
      }
      if (def.manualOnly && o && (o.dims || o.topic || o.countries || o.orgs)) o.custom = true;
      /* 2026-09-03 根因修复：useFreq 必须传入 o.freq——此前被丢弃，导致前端选了周期
       * 服务端仍按类型默认频率取窗口，名称也不随周期变动 */
      if (useFreq) o.freq = useFreq;
      const out = await generateReport(def.id, String(key).trim(), o);
      res.json({ ok: true, id: out.id, period: out.period, freq: out.freq, llmOk: out.llmOk, llmError: out.llmError });
    } catch (e) {
      if (e.code === 429) return res.status(429).json({ ok: false, error: e.message });
      console.error('[REPORTS] 生成失败:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  /* 列表 */
  app.get('/api/reports/products/list', auth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const params = [];
      let where = '';
      if (req.query.type) { params.push(req.query.type); where = 'WHERE rtype=$1'; }
      const r = await _ctx.query(
        `SELECT id, rtype, period, title, created_at, summary FROM report_products ${where} ORDER BY created_at DESC LIMIT ${limit}`,
        params
      );
      res.json({ ok: true, list: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* 详情 */
  app.get('/api/reports/products/detail/:id', auth, async (req, res) => {
    try {
      const r = await _ctx.query(
        'SELECT id, rtype, period, title, html, gov_html, summary, llm_model, created_at FROM report_products WHERE id=$1',
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: '报告不存在' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* 人工修订（编辑痕迹记 data_json.edited_at） */
  app.put('/api/reports/products/detail/:id', auth, async (req, res) => {
    try {
      const { html, gov_html, summary } = req.body || {};
      const cur = await _ctx.query('SELECT data_json FROM report_products WHERE id=$1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ error: '报告不存在' });
      let dj = {};
      try { dj = typeof cur.rows[0].data_json === 'string' ? JSON.parse(cur.rows[0].data_json) : (cur.rows[0].data_json || {}); } catch (e) {}
      dj.edited_at = new Date().toISOString();
      const params1 = [req.params.id];
      const sets = [];
      if (html != null) { params1.push(html); sets.push('html=$' + params1.length); }
      if (gov_html != null) { params1.push(gov_html); sets.push('gov_html=$' + params1.length); }
      if (summary != null) { params1.push(typeof summary === 'string' ? summary : JSON.stringify(summary)); sets.push('summary=$' + params1.length); }
      params1.push(JSON.stringify(dj));
      sets.push('data_json=$' + params1.length);
      await _ctx.query('UPDATE report_products SET ' + sets.join(', ') + ' WHERE id=$1', params1);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

/* ============================================================
 * 十四、init（server.js 唯一挂点入口）
 * ============================================================ */
async function init(ctx) {
  _ctx = ctx;
  /* DDL 自建 */
  await ctx.query(`
    CREATE TABLE IF NOT EXISTS report_products (
      id SERIAL PRIMARY KEY,
      rtype TEXT NOT NULL,
      period TEXT NOT NULL,
      title TEXT,
      html TEXT,
      gov_html TEXT,
      summary JSONB,
      data_json JSONB,
      llm_model TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(rtype, period)
    )`);
  /* 路由自注册 */
  if (ctx.app && ctx.auth) registerRoutes(ctx.app, ctx.auth);
  /* 定时器：每小时检查补生成 + 启动 2 分钟后首查（ctx.schedule===false 时跳过，供离线验证脚本用） */
  if (ctx.schedule !== false && !_schedTimer) {
    _schedTimer = setInterval(scheduleCheck, 3600000);
    if (_schedTimer.unref) _schedTimer.unref();
    const t0 = setTimeout(scheduleCheck, 120000);
    if (t0.unref) t0.unref();
  }
  console.log('[REPORTS] 智库报告产品线引擎就绪：' + REPORT_TYPES.length + ' 类报告（' + REPORT_TYPES.map(d => d.id).join('、') + '）');
}

module.exports = { init };
/* 供离线验证脚本（不经 HTTP）使用的内部出口 */
module.exports._test = { REPORT_TYPES, defOf, generateReport, periodWindowOf, currentTarget, currentPeriodOf, windowOfFreq, freqOfPeriodKey, titleForFreq, govPunctuate, polishGovText, _cnTime, pvKimi, weekKey, _dayKey };
