/**
 * gdelt-events.js — GDELT Events 2.0 文件采集通道（2026-09-04）
 * ============================================================
 * 背景：GDELT DOC API（api.gdeltproject.org）被代理出口 IP 限流 429，
 * 但数据文件端点 data.gdeltproject.org 未受限（301→200 实测可达）。
 * Events 2.0 每 15 分钟更新 export.CSV.zip（~87KB），CAMEO 编码的
 * 结构化事件库：Actor/事件码/Goldstein 烈度/报道数/经纬度/源 URL——
 * 事件级情报，比 DOC API 新闻列表更精准，且流量极小。
 *
 * 铁律合规：只过滤不编造——全部字段来自 GDELT 官方事件记录；
 * SOURCEURL 缺失丢弃（无 url 不入库）；标题为结构化字段的中文格式化，
 * 非模拟数据。事件级去重以 GLOBALEVENTID 为准。
 * ============================================================
 */
'use strict';
const AdmZip = require('adm-zip');
const netx = require('./netx');

/* Geo 国别：GDELT Events 的 ActionGeo/ActorGeo 用 FIPS 10-4 两字母码（唯一取源
 * crawler.GD_COUNTRIES——项目铁律「GDELT FIPS 10-4 唯一取源」），
 * 由 {中文: [FIPS, 英文]} 反查生成 FIPS→中文 表。
 * Actor1/2 CountryCode 是 CAMEO 3 字母（涉华判定用 CHN）。 */
const { GD_COUNTRIES } = require('./crawler');
const FIPS_CN = {};
Object.keys(GD_COUNTRIES).forEach(cn => { const f = GD_COUNTRIES[cn][0]; if (f && !FIPS_CN[f]) FIPS_CN[f] = cn; });
/* CAMEO 根码 → 中文行动词与类别（QuadClass 3/4 冲突类才采） */
const ROOT_ACT = {
  '14': { w: '抗议示威', dt: 'social_unrest', lv: 'yellow' },
  '15': { w: '武力展示', dt: 'military_conflicts', lv: 'yellow' },
  '16': { w: '关系降级', dt: 'geopolitical_intel', lv: 'yellow' },
  '17': { w: '胁迫', dt: 'geopolitical_intel', lv: 'orange' },
  '18': { w: '袭击', dt: 'terror_events', lv: 'orange' },
  '19': { w: '交战', dt: 'military_conflicts', lv: 'orange' },
  '20': { w: '大规模暴力', dt: 'terror_events', lv: 'red' }
};
/* Actor 群体词翻译（GDELT 常给群体名而非组织名） */
const ACTOR_ZH = {
  POLICE: '警方', MILITARY: '军方', GOVERNMENT: '政府', REBEL: '叛军', MILITANT: '武装分子',
  PROTESTER: '抗议者', TERRORIST: '恐怖分子', CHINESE: '中方人员', RUSSIAN: '俄方', UKRAINIAN: '乌方',
  SOLDIER: '士兵', CIVILIAN: '平民', GUNMAN: '枪手', TROOPS: '部队', INSURGENT: '叛乱分子',
  ISIS: '“伊斯兰国”', TALIBAN: '塔利班', STUDENT: '学生', WORKER: '工人', FARMER: '农民',
  JUDGE: '法官', JOURNALIST: '记者', ACTIVIST: '活动人士', SEPARATIST: '分离主义者',
  PRESIDENT: '总统', MINISTER: '部长', ARMY: '陆军', NAVY: '海军', AIR_FORCE: '空军',
  PARAMILITARY: '准军事部队', BORDER_GUARD: '边防部队', INTELLIGENCE: '情报机构',
  HOUTHIS: '胡塞武装', HAMAS: '哈马斯', HEZBOLLAH: '真主党', KURD: '库尔德武装',
  AFRICA: '非洲方面', BUSINESS: '企业界', CORPORATION: '企业', RESIDENTS: '当地居民',
  'GOVERNMENT FORCES': '政府军', 'SECURITY FORCES': '安全部队', 'ARMED FORCES': '武装部队',
  MUSLIM: '穆斯林群体', CHRISTIAN: '基督徒群体', MILITIA: '民兵', CARTEL: '贩毒集团',
  GANG: '帮派', INSURGENTS: '叛乱分子', OPPOSITION: '反对派', OFFICIALS: '官员'
};

const _seen = new Set();   /* GLOBALEVENTID 去重（内存，服务重启自然重置） */
let _lastFile = '';        /* 已处理的文件批次（防重复下载） */

/* 高频组织名（Actor 实体名 → 中文） */
const ORG_ZH = {
  'BALOCH LIBERATION ARMY': '俾路支解放军', 'BALOCHISTAN LIBERATION ARMY': '俾路支解放军',
  'TEHRIK-E-TALIBAN': '巴基斯坦塔利班', 'TEHRIK-I-TALIBAN': '巴基斯坦塔利班',
  'AL-SHABAAB': '“青年党”', 'AL SHABAAB': '“青年党”', 'BOKO HARAM': '“博科圣地”',
  'ISIS': '“伊斯兰国”', 'ISIL': '“伊斯兰国”', 'ISLAMIC STATE': '“伊斯兰国”',
  'HOUTHIS': '胡塞武装', 'HOUTHI': '胡塞武装', 'HAMAS': '哈马斯', 'HEZBOLLAH': '真主党',
  'TALIBAN': '塔利班', 'RSF': '快速支援部队', 'RAPID SUPPORT FORCES': '快速支援部队',
  'WAGNER': '瓦格纳集团', 'M23': '“M23”武装', 'FARC': '“哥伦比亚革命武装力量”',
  'AL-QAEDA': '“基地”组织', 'AL QAEDA': '“基地”组织', 'ISWAP': '“伊斯兰国”西非省',
  'PKK': '库尔德工人党'
};
const { gdCnFromEn } = require('./crawler');
function _actorZh(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const up = raw.toUpperCase();
  if (ACTOR_ZH[up]) return ACTOR_ZH[up];
  if (ORG_ZH[up]) return ORG_ZH[up];
  const cn = gdCnFromEn(raw);   /* 国家名 Actor（"Pakistan"→巴基斯坦方） */
  if (cn) return cn + '方';
  return raw;   /* 组织/人名原文保留（真实实体名，不编造翻译） */
}

/* 行动句式：A+行动+B 通顺中文组合 */
function _actPhrase(root, a1, a2) {
  const s = a1 || '不明行为体';
  const o = a2 && a2 !== a1 ? a2 : '';
  switch (root) {
    case '14': return s + '举行抗议示威' + (o ? '反对' + o : '');
    case '15': return s + '展示武力' + (o ? '威慑' + o : '');
    case '16': return o ? s + '与' + o + '关系降级' : s + '与多方关系降级';
    case '17': return s + '胁迫' + (o || '相关方');
    case '18': return s + '袭击' + (o || '目标');
    case '19': return o ? s + '与' + o + '交战' : s + '与武装力量交战';
    case '20': return s + '实施大规模暴力' + (o ? '针对' + o : '');
    default: return s + '采取行动' + (o ? '针对' + o : '');
  }
}

function _parseTsv(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const ln of lines) {
    if (!ln || ln.length < 50) continue;
    const c = ln.split('\t');
    /* GDELT Events 2.0 实测 61 列（Geo 块各 8 列含 ADM2）：
     * 0-4 ID/日期, 5-14 Actor1, 15-24 Actor2, 25-34 事件码/烈度/报道量,
     * 35-42 Actor1Geo(8), 43-50 Actor2Geo(8), 51-58 ActionGeo(8), 59 DATEADDED, 60 SOURCEURL */
    if (c.length < 61) continue;
    rows.push({
      id: c[0], sqlDate: c[1],
      a1Name: c[6], a1Ctry: c[7], a2Name: c[16], a2Ctry: c[17],
      isRoot: c[25] === '1', eventCode: c[26], rootCode: c[28],
      quad: c[29], goldstein: parseFloat(c[30]) || 0,
      mentions: parseInt(c[31], 10) || 0, sources: parseInt(c[32], 10) || 0,
      articles: parseInt(c[33], 10) || 0, tone: parseFloat(c[34]) || 0,
      geoName: c[52], geoCtry: c[53], geoLat: c[56], geoLong: c[57],
      dateAdded: c[59], srcUrl: c[60] || ''
    });
  }
  return rows;
}

/* 事件 → 平台条目（真实字段格式化，非模拟） */
function _toItem(ev) {
  const root = ROOT_ACT[ev.rootCode];
  if (!root) return null;                              /* 只采 14-20 冲突根码 */
  if (ev.quad !== '3' && ev.quad !== '4') return null; /* 只采冲突象限 */
  const cn = FIPS_CN[ev.geoCtry];
  if (!cn) return null;                                /* 非平台覆盖国 */
  if (!ev.srcUrl) return null;                         /* 无源 URL 不入库（铁律） */
  const a1 = _actorZh(ev.a1Name), a2 = _actorZh(ev.a2Name);
  const isCn = ev.a1Ctry === 'CHN' || ev.a2Ctry === 'CHN' || /CHINESE|CHINA/i.test((ev.a1Name || '') + ' ' + (ev.a2Name || ''));
  /* 标题：国名+地点+行动句式+报道量（结构化字段中文格式化，行动句式见 _actPhrase） */
  const phrase = _actPhrase(ev.rootCode, a1, a2);
  /* 地点：geoName 第一段（"Balochistan, Balochistan, Pakistan"→Balochistan），与国名重复则不显示 */
  const locEn = String(ev.geoName || '').split(',')[0].trim();
  const loc = locEn && locEn.toLowerCase() !== String(ev.geoCtry || '').toLowerCase() && !gdCnFromEn(locEn) ? '（' + locEn + '）' : '';
  let title = cn + loc + '：' + phrase;
  if (ev.articles >= 3) title += '（' + ev.articles + ' 篇报道）';
  /* 级别：根码基线 + 高报道量/强负烈度/涉华上调 */
  let lv = root.lv;
  if (ev.articles >= 20 || ev.goldstein <= -8) lv = 'red';
  else if (lv === 'yellow' && (ev.articles >= 8 || ev.goldstein <= -5)) lv = 'orange';
  if (isCn && lv === 'yellow') lv = 'orange';
  const dt = ev.sqlDate && /^\d{8}$/.test(ev.sqlDate) ? ev.sqlDate.slice(0, 4) + '-' + ev.sqlDate.slice(4, 6) + '-' + ev.sqlDate.slice(6, 8) : '';
  /* 2026-09-04 用户报障根修：GDELT Events 批次含旧事件重报（SQLDATE 是事件原始日期，
   * 可溯至数年前）——「马里中资金矿袭击旧案当新采」即此路径。事件日期超 48h 一律不采
   * （24h 时效铁律，本通道正确姿态）；同时字段名对齐平台 INSERT/时效闸读取惯例
   * （it.date/it.publishedAt——原 event_date 字段不被读取导致时效闸失效、库内日期为空） */
  if (dt) {
    const ageMs = Date.now() - new Date(dt + 'T00:00:00Z').getTime();
    if (ageMs > 48 * 3600 * 1000) return null;
  }
  return {
    title: title, title_zh: title,
    url: ev.srcUrl,
    country: cn, country_cn: cn,
    location: ev.geoName || '',
    date: dt,                        /* 平台 INSERT/时效闸读取字段（铁律对齐） */
    publishedAt: dt,
    event_date: dt,
    publish_time: dt,
    level: lv, severity: lv,
    data_type: root.dt, category: root.w,
    source: 'GDELT Events',
    desc: 'GDELT 事件库：' + phrase + '；Goldstein 烈度 ' + ev.goldstein +
      '；' + ev.articles + ' 篇文章/' + ev.sources + ' 个信源/' + ev.mentions + ' 次提及。',
    chinaRelated: isCn || undefined,
    interestLinked: true,
    _sourceType: 'gdelt_events', _fromSource: 'GDELT-EVENTS', _gdeltEventId: ev.id,
    _gdSources: ev.sources, _gdMentions: ev.mentions, _gdArticles: ev.articles,
    _forceDataType: true
  };
}

/* 拉取最新批次并转条目 */
async function fetchGdeltEvents() {
  /* 1. lastupdate.txt → 最新 export.CSV.zip URL */
  const lu = await netx.smartFetch('https://data.gdeltproject.org/gdeltv2/lastupdate.txt', { timeout: 15000, proxyFirst: true });
  if (!lu.ok) { console.warn('[GDELT-EVENTS] lastupdate 拉取失败 HTTP ' + lu.status); return []; }
  const luText = await lu.text();
  const m = luText.match(/(\d+)\s+\S+\s+(http:\/\/data\.gdeltproject\.org\/gdeltv2\/(\d{14})\.export\.CSV\.zip)/);
  if (!m) { console.warn('[GDELT-EVENTS] lastupdate 解析失败'); return []; }
  const fileUrl = m[2].replace(/^http:\/\//, 'https://'), batch = m[3];
  if (batch === _lastFile) return { items: [], batch, skipped: true };   /* 本批已处理 */
  /* 2. 下载 zip（~87KB） */
  const zr = await netx.smartFetch(fileUrl, { timeout: 30000, proxyFirst: true });
  if (!zr.ok) { console.warn('[GDELT-EVENTS] export 下载失败 HTTP ' + zr.status); return []; }
  const buf = Buffer.from(await zr.buffer());
  let csvText = '';
  try {
    const zip = new AdmZip(buf);
    const ent = zip.getEntries()[0];
    csvText = ent.getData().toString('utf8');
  } catch (e) { console.warn('[GDELT-EVENTS] 解压失败:', e.message); return []; }
  /* 3. 解析 + 过滤 + 格式化 */
  const rows = _parseTsv(csvText);
  const items = [];
  for (const ev of rows) {
    if (_seen.has(ev.id)) continue;
    const it = _toItem(ev);
    if (!it) continue;
    _seen.add(ev.id);
    items.push(it);
  }
  if (_seen.size > 50000) { const arr = [..._seen]; arr.slice(0, 25000).forEach(k => _seen.delete(k)); } /* 防内存膨胀 */
  _lastFile = batch;
  return { items, batch, rows: rows.length };
}

module.exports = { fetchGdeltEvents };
