'use strict';
/* ==========================================================================
 * wm-feed.js — WorldMonitor.app 数据接入哨兵（2026-08-31 Task #507 重构）
 * ==========================================================================
 * 背景：WorldMonitor.app 是开源（AGPL-3.0）实时全球情报面板，其免费仪表盘
 * 数据通道可第三方复用（2026-08-31 实测侦察）：
 *   ① POST https://www.worldmonitor.app/api/wm-session（Origin 头必带）
 *      → 匿名 session token（wms_...，12h 有效，免费铸造）
 *   ② GET /api/<domain>/v1/<method> 带 X-WorldMonitor-Key: wms_...
 *   ③ 合规：agents.md 要求描述性 UA；free 层刷新 5-15min（本哨兵 30min 轮询合规）
 *
 * 采集范围（用户指令 2026-08-31：疫情/新闻摘要/断网全砍，只采八大高价值军情端点）：
 *   ① conflict/v1/list-ucdp-events           UCDP 武装冲突事件 → military_conflicts
 *   ② military/v1/get-theater-posture        战区态势（elevated+ 级）→ military_conflicts
 *   ③ military/v1/get-usni-fleet-report      USNI 美海军舰队追踪 → military_conflicts
 *   ④ intelligence/v1/list-security-advisories 领事安全警示（warn+ 级）→ security_events
 *   ⑤ intelligence/v1/list-gps-interference  GPS 干扰热区（电子战信号）→ military_conflicts
 *   ⑥ intelligence/v1/get-china-decision-signals 中国决策信号 → osint_intel
 *   ⑦ supply-chain/v1/get-chokepoint-status  咽喉通道状态（yellow/red）→ infrastructure
 *   ⑧ supply-chain/v1/get-china-corridor-control-towers 中国走廊控制塔（降级）→ infrastructure
 *
 * 状态型数据（战区/舰队/咽喉/走廊）用「实体 + 日期」合成 URL：当日 30min 轮询
 * 重复采集被 url-dup 闸门拦 → 每实体每日一条快照，次日 URL 换新自然放行。
 * 输出走 server.js _ingestLinkedItems 既有闸门（_sourceType='wm_feed'，trustPubDate 白名单）。
 * ========================================================================== */
const netx = require('./netx');

const WM_BASE = 'https://www.worldmonitor.app';
const WM_UA = 'ORPS-OverseasRiskPlatform/1.0 (intelligence collection; contact: ops@orps.local)';

/* ── session token 管理：12h 有效，过期前 30min 自动刷新；单飞防并发铸 token ── */
let _token = null;          /* { token, exp } */
let _tokenFlying = null;    /* 并发去重 */

async function _mintToken() {
  /* POST 必须 Origin 头 + 描述性 UA（agents.md 政策；裸 curl UA 会被 403） */
  const r = await netx.smartPost(WM_BASE + '/api/wm-session', {
    headers: {
      'Origin': WM_BASE,
      'Referer': WM_BASE + '/dashboard',
      'Content-Type': 'application/json',
      'User-Agent': WM_UA,
    },
    body: '{}',
    timeout: 20000,
  });
  if (!r || !r.ok) throw new Error('wm-session HTTP ' + (r && r.status));
  const d = await r.json();
  if (!d || !d.token) throw new Error('wm-session 无 token');
  return { token: d.token, exp: d.exp || (Date.now() + 11 * 3600 * 1000) };
}

async function getToken(force) {
  if (!force && _token && _token.exp - Date.now() > 30 * 60 * 1000) return _token.token;
  if (_tokenFlying) return _tokenFlying;
  _tokenFlying = (async () => {
    try {
      _token = await _mintToken();
      return _token.token;
    } finally { _tokenFlying = null; }
  })();
  return _tokenFlying;
}

/* ── GET 封装：token 头 + 401 自动刷新重试一次 + 45s 竞速兜底（代理抖动防护） ── */
async function _wmGet(path, tries) {
  tries = tries || 0;
  const token = await getToken();
  const url = WM_BASE + path;
  const _once = () => Promise.race([
    netx.smartFetch(url, {
      timeout: 40000,
      headers: {
        'X-WorldMonitor-Key': token,
        'Origin': WM_BASE,
        'Referer': WM_BASE + '/dashboard',
        'Accept': 'application/json',
        'User-Agent': WM_UA,
      },
    }).then(r => (r && r.ok) ? r.json() : Promise.reject(new Error('HTTP ' + (r && r.status)))),
    new Promise((_, rej) => setTimeout(() => rej(new Error('wm timeout')), 45000)),
  ]);
  try {
    return await _once();
  } catch (e) {
    /* 401 = token 过期：强制重铸后重试一次 */
    if (/HTTP 401/.test(String(e.message)) && tries < 1) {
      await getToken(true);
      return _wmGet(path, tries + 1);
    }
    throw e;
  }
}

/* ── 本地时区日期键（YYYY-MM-DD）：状态型数据「每日一条」的 URL 去重锚 ── */
function _dayKey() {
  return new Date().toLocaleDateString('sv-SE');
}

/* ── ISO2 → 英文国名（警示端点只给 countryCode；ORPS 既有通道 country 均英文国名） ── */
const ISO2_NAME = {
  AF: 'Afghanistan', AL: 'Albania', DZ: 'Algeria', AO: 'Angola', AR: 'Argentina', AM: 'Armenia',
  AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan', BD: 'Bangladesh', BY: 'Belarus', BE: 'Belgium',
  BO: 'Bolivia', BA: 'Bosnia and Herzegovina', BW: 'Botswana', BR: 'Brazil', BG: 'Bulgaria',
  BF: 'Burkina Faso', BI: 'Burundi', KH: 'Cambodia', CM: 'Cameroon', CA: 'Canada',
  CF: 'Central African Republic', TD: 'Chad', CL: 'Chile', CN: 'China', CO: 'Colombia',
  CD: 'DR Congo', CG: 'Congo', CR: 'Costa Rica', CI: 'Cote d\'Ivoire', HR: 'Croatia', CU: 'Cuba',
  CY: 'Cyprus', CZ: 'Czech Republic', DK: 'Denmark', DO: 'Dominican Republic', EC: 'Ecuador',
  EG: 'Egypt', SV: 'El Salvador', EE: 'Estonia', ET: 'Ethiopia', FI: 'Finland', FR: 'France',
  GA: 'Gabon', GM: 'Gambia', GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GR: 'Greece',
  GT: 'Guatemala', GN: 'Guinea', GW: 'Guinea-Bissau', GY: 'Guyana', HT: 'Haiti',
  HN: 'Honduras', HU: 'Hungary', IS: 'Iceland', IN: 'India', ID: 'Indonesia', IR: 'Iran',
  IQ: 'Iraq', IE: 'Ireland', IL: 'Israel', IT: 'Italy', JM: 'Jamaica', JP: 'Japan',
  JO: 'Jordan', KZ: 'Kazakhstan', KE: 'Kenya', KW: 'Kuwait', KG: 'Kyrgyzstan', LA: 'Laos',
  LV: 'Latvia', LB: 'Lebanon', LY: 'Libya', LT: 'Lithuania', MG: 'Madagascar', MW: 'Malawi',
  MY: 'Malaysia', ML: 'Mali', MR: 'Mauritania', MX: 'Mexico', MD: 'Moldova', MN: 'Mongolia',
  ME: 'Montenegro', MA: 'Morocco', MZ: 'Mozambique', MM: 'Myanmar', NA: 'Namibia', NP: 'Nepal',
  NL: 'Netherlands', NZ: 'New Zealand', NI: 'Nicaragua', NE: 'Niger', NG: 'Nigeria',
  MK: 'North Macedonia', NO: 'Norway', OM: 'Oman', PK: 'Pakistan', PA: 'Panama',
  PG: 'Papua New Guinea', PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PL: 'Poland',
  PT: 'Portugal', QA: 'Qatar', RO: 'Romania', RU: 'Russia', RW: 'Rwanda', SA: 'Saudi Arabia',
  SN: 'Senegal', RS: 'Serbia', SL: 'Sierra Leone', SG: 'Singapore', SK: 'Slovakia',
  SI: 'Slovenia', SO: 'Somalia', ZA: 'South Africa', KR: 'South Korea', SS: 'South Sudan',
  ES: 'Spain', LK: 'Sri Lanka', SD: 'Sudan', SE: 'Sweden', CH: 'Switzerland', SY: 'Syria',
  TW: 'Taiwan', TJ: 'Tajikistan', TZ: 'Tanzania', TH: 'Thailand', TG: 'Togo', TN: 'Tunisia',
  TR: 'Turkey', TM: 'Turkmenistan', UG: 'Uganda', UA: 'Ukraine', AE: 'UAE', GB: 'United Kingdom',
  US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan', VE: 'Venezuela', VN: 'Vietnam',
  YE: 'Yemen', ZM: 'Zambia', ZW: 'Zimbabwe',
};
const _iso2name = (c) => ISO2_NAME[String(c || '').toUpperCase()] || '';

/* ── ① UCDP 武装冲突事件（近 72h 活跃 + 有伤亡才值得预警流） ── */
async function _collectUcdp(out) {
  let d;
  try { d = await _wmGet('/api/conflict/v1/list-ucdp-events'); } catch (e) { console.warn('[WM-FEED] UCDP 拉取失败:', e.message); return; }
  const evs = (d && d.events) || [];
  const now = Date.now();
  const WIN = 72 * 3600 * 1000;
  let hit = 0;
  for (const ev of evs) {
    const t = ev.dateStart || ev.dateEnd;
    if (!t || now - t > WIN) continue;
    const deaths = ev.deathsBest || ev.deathsA || ev.deathsB || ev.deathsCivilians || 0;
    if (deaths < 1) continue;
    const country = String(ev.country || '').replace(/\s*\(.*?\)\s*/g, '').trim();
    const title = 'Armed violence in ' + (country || 'conflict zone') + ': ' +
      String(ev.sideA || 'armed group') + ' vs ' + String(ev.sideB || 'opponents') +
      ', ' + deaths + ' killed (UCDP)';
    hit++;
    out.push({
      title,
      content: 'UCDP organized violence event #' + ev.id + ' in ' + (ev.country || '') + '. ' +
        'Side A: ' + (ev.sideA || '-') + '; Side B: ' + (ev.sideB || '-') + '. ' +
        'Best estimate deaths: ' + deaths + (ev.dateEnd ? '. Event window: ' + new Date(ev.dateStart || ev.dateEnd).toISOString().slice(0, 10) + ' ~ ' + new Date(ev.dateEnd).toISOString().slice(0, 10) : '') + '.',
      url: 'https://ucdp.uu.se/#/event/' + ev.id,
      publish_time: new Date(ev.dateEnd || ev.dateStart).toISOString(),
      source: 'UCDP (via WorldMonitor)',
      country,
      location: (ev.location && ev.location.latitude != null) ? (ev.location.latitude + ',' + ev.location.longitude) : '',
      data_type: 'military_conflicts',
      category: '武装冲突',
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] UCDP 事件近72h有伤亡命中: ' + hit + '/' + evs.length);
}

/* ── ② 战区态势（postureLevel elevated 及以上才条目化；normal 是常态噪音） ── */
const WM_THEATER_COUNTRY = {
  'iran-theater': 'Iran', 'taiwan-theater': 'Taiwan', 'baltic-theater': 'Russia',
  'blacksea-theater': 'Ukraine', 'korea-theater': 'South Korea', 'south-china-sea': 'China',
  'east-med-theater': 'Israel', 'israel-gaza-theater': 'Israel', 'yemen-redsea-theater': 'Yemen',
};
async function _collectTheater(out) {
  let d;
  try { d = await _wmGet('/api/military/v1/get-theater-posture'); } catch (e) { console.warn('[WM-FEED] 战区态势拉取失败:', e.message); return; }
  const ths = (d && d.theaters) || [];
  let hit = 0;
  for (const t of ths) {
    const lv = String(t.postureLevel || '').toLowerCase();
    if (!lv || lv === 'normal') continue;   /* 常态不采 */
    const country = WM_THEATER_COUNTRY[t.theater] || '';
    const name = String(t.theater || '').replace(/-/g, ' ');
    hit++;
    out.push({
      title: 'Theater posture ' + lv.toUpperCase() + ' — ' + name + ': ' +
        (t.activeFlights || 0) + ' military aircraft tracked, ' +
        (t.trackedVessels || 0) + ' vessels monitored' +
        ((t.activeOperations || []).length ? ', active operations: ' + t.activeOperations.join('; ') : ''),
      content: 'WorldMonitor theater posture assessment for ' + name + ' is ' + lv.toUpperCase() +
        ' (above normal). ' + (t.activeFlights || 0) + ' military flights and ' +
        (t.trackedVessels || 0) + ' tracked vessels currently monitored in theater. ' +
        ((t.activeOperations || []).length ? 'Active operations: ' + t.activeOperations.join('; ') + '. ' : '') +
        'Assessed at ' + (t.assessedAt ? new Date(t.assessedAt).toISOString() : 'unknown') + '.',
      url: 'https://worldmonitor.app/wm-snapshot/theater/' + (t.theater || 'x') + '/' + _dayKey(),
      publish_time: t.assessedAt ? new Date(t.assessedAt).toISOString() : new Date().toISOString(),
      source: 'WorldMonitor theater posture',
      country,
      data_type: 'military_conflicts',
      category: '战区态势',
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] 战区态势 elevated+ 命中: ' + hit + '/' + ths.length);
}

/* ── ③ USNI 美海军舰队追踪（每日一条全球快照：打击群 + 航母/两栖部署） ── */
async function _collectFleet(out) {
  let d;
  try { d = await _wmGet('/api/military/v1/get-usni-fleet-report'); } catch (e) { console.warn('[WM-FEED] 舰队拉取失败:', e.message); return; }
  const rep = d && d.report;
  if (!rep || !Array.isArray(rep.vessels)) { console.log('[WM-FEED] 舰队报告无 vessels 数据'); return; }
  /* 航母/两栖攻击舰是力量投送信号，逐舰汇总进一条快照（不逐舰刷屏） */
  const bigDecks = rep.vessels.filter(v => /carrier|amphib/i.test(v.vesselType || ''));
  const bfs = rep.battleForceSummary || {};
  const sg = (rep.strikeGroups || []).map(s => (s.name || String(s)).replace(/^Carrier Strike Group/, 'CSG')).join(', ');
  const deckLines = bigDecks.slice(0, 12).map(v =>
    v.name + ' (' + (v.vesselType || '?') + ', ' + (v.deploymentStatus || '?') + ', ' + (v.region || '?') + ')');
  const title = 'US Navy global posture: ' + (bfs.deployed || 0) + ' of ' + (bfs.totalShips || 0) +
    ' ships deployed, ' + (bfs.underway || 0) + ' underway — strike groups: ' + (sg || 'none');
  out.push({
    title,
    content: 'USNI fleet tracker daily snapshot. Battle force: ' + (bfs.totalShips || '?') +
      ' total, ' + (bfs.deployed || '?') + ' deployed, ' + (bfs.underway || '?') + ' underway. ' +
      'Carrier strike groups: ' + (sg || 'none') + '. ' +
      'Capital ships (carrier/amphibious): ' + deckLines.join('; ') + '. ' +
      'Source article: ' + (rep.articleTitle || '') + ' (' + (rep.articleDate || '') + ').',
    url: 'https://worldmonitor.app/wm-snapshot/fleet/' + _dayKey(),
    /* 快照条目发布时间=快照生成时刻（USNI 报告 timestamp 常滞后 1-3 天，会触发 24h 时效闸） */
    publish_time: new Date().toISOString(),
    source: 'USNI News fleet tracker (via WorldMonitor)',
    country: 'United States',
    data_type: 'military_conflicts',
    category: '军事动态',
    _sourceType: 'wm_feed',
  });
  console.log('[WM-FEED] 舰队快照 1 条（' + bigDecks.length + ' 艘大甲板舰，' + (rep.strikeGroups || []).length + ' 打击群）');
}

/* ── ④ 领事安全警示（UK FCDO 等；只采 warn 及以上，info 级常规咨询是噪音） ── */
async function _collectAdvisories(out) {
  let d;
  try { d = await _wmGet('/api/intelligence/v1/list-security-advisories'); } catch (e) { console.warn('[WM-FEED] 警示拉取失败:', e.message); return; }
  const advs = (d && d.advisories) || [];
  const ranked = advs.slice().sort((a, b) => {
    const lv = { critical: 0, severe: 1, warning: 2, alert: 2, info: 3 };
    return (lv[String(a.level).toLowerCase()] || 9) - (lv[String(b.level).toLowerCase()] || 9);
  });
  /* 2026-08-31 收紧：info 级常规国别咨询（FCDO 每国一条）是纯噪音且与同国普通新闻
   * 撞退化签名 → 只采 warn 及以上（avoid/do-not-travel 级才有预警价值），无高级别本轮就空采。 */
  const hot = ranked.filter(a => String(a.level).toLowerCase() !== 'info').slice(0, 25);
  for (const a of hot) {
    const country = _iso2name(a.country) || a.country || '';
    out.push({
      title: (a.source || 'Official') + ' travel advisory: ' + (a.title || country) +
        ' (level: ' + (a.level || 'info') + ')',
      content: (a.source || '') + (a.sourceCountry ? ' (' + a.sourceCountry + ')' : '') +
        ' issued/updated a security advisory for ' + (country || a.title || 'the country') + '. ' +
        'Advisory level: ' + (a.level || 'info') + '. Source: ' + (a.link || ''),
      url: a.link || '',
      publish_time: a.pubDate || '',
      source: a.source || 'Official advisory (via WorldMonitor)',
      country,
      data_type: 'security_events',
      category: '领事保护',
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] 领事警示 warn+ 命中: ' + hot.length + '/' + advs.length);
}

/* ── ⑤ GPS 干扰热区（H3 网格聚合到战区 bbox；high 网格 ≥15 才条目化） ──
 * GPS 干扰 = 电子战活跃信号（干扰欺骗导航常伴随军事行动/区域管制）。
 * gpsInterference 全量 1600+ 网格，按已知冲突区 bbox 聚类成区域条目。 */
const WM_GPS_ZONES = [
  { key: 'ukraine', name: 'Ukraine and Black Sea region', country: 'Ukraine', latMin: 43, latMax: 53, lonMin: 22, lonMax: 41 },
  { key: 'levant', name: 'Eastern Mediterranean / Levant', country: 'Israel', latMin: 29, latMax: 37, lonMin: 33, lonMax: 37 },
  { key: 'persian-gulf', name: 'Persian Gulf and Strait of Hormuz', country: 'Iran', latMin: 22, latMax: 30, lonMin: 47, lonMax: 60 },
  { key: 'red-sea', name: 'Red Sea and Bab el-Mandeb', country: 'Yemen', latMin: 11, latMax: 22, lonMin: 36, lonMax: 45 },
  { key: 'south-asia', name: 'South Asia (Pakistan/Afghanistan borderlands)', country: 'Pakistan', latMin: 24, latMax: 38, lonMin: 60, lonMax: 78 },
  { key: 'east-asia', name: 'East Asia (Korea Strait/Taiwan vicinity)', country: 'Taiwan', latMin: 20, latMax: 40, lonMin: 118, lonMax: 130 },
];
async function _collectGps(out) {
  let d;
  try { d = await _wmGet('/api/intelligence/v1/list-gps-interference'); } catch (e) { console.warn('[WM-FEED] GPS 干扰拉取失败:', e.message); return; }
  const hexes = (d && d.hexes) || [];
  if (!hexes.length) return;
  const zones = WM_GPS_ZONES.map(z => Object.assign({}, z, { high: 0, med: 0 }));
  let other = 0;
  for (const h of hexes) {
    const isHigh = /HIGH|EXTREME/i.test(h.level || '');
    const isMed = /MEDIUM/i.test(h.level || '');
    if (!isHigh && !isMed) continue;
    let hit = false;
    for (const z of zones) {
      if (h.lat >= z.latMin && h.lat <= z.latMax && h.lon >= z.lonMin && h.lon <= z.lonMax) {
        if (isHigh) z.high++; else z.med++;
        hit = true; break;
      }
    }
    if (!hit && isHigh) other++;
  }
  let hit2 = 0;
  for (const z of zones) {
    if (z.high < 15) continue;   /* high 网格不足 15 个：背景噪音不采 */
    hit2++;
    out.push({
      title: 'GPS interference hotspot over ' + z.name + ': ' + z.high +
        ' high-intensity grid cells detected (electronic warfare signature)',
      content: 'WorldMonitor GPS interference monitoring (source: ' + ((d && d.source) || 'aircraft ADS-B reports') +
        ') detected ' + z.high + ' high-int interference cells and ' + z.med +
        ' medium cells over ' + z.name + '. Sustained GNSS interference in this band indicates ' +
        'electronic warfare activity or deliberate navigation disruption affecting civil aviation and shipping. ' +
        'Total global high cells this cycle: ' + ((d && d.stats && d.stats.highCount) || z.high) + '.',
      url: 'https://worldmonitor.app/wm-snapshot/gps/' + z.key + '/' + _dayKey(),
      publish_time: (d && d.fetchedAt) ? new Date(d.fetchedAt).toISOString() : new Date().toISOString(),
      source: 'WorldMonitor GPS interference (ADS-B)',
      country: z.country,
      data_type: 'military_conflicts',
      category: '电子战信号',
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] GPS 干扰热区命中: ' + hit2 + ' 个区域（high 网格 ' + ((d && d.stats && d.stats.highCount) || '?') + '，未匹配 ' + other + '）');
}

/* ── ⑥ 中国决策信号（官方信源聚合；每组每日一条快照，涉华情报） ── */
async function _collectChinaSignals(out) {
  let d;
  try { d = await _wmGet('/api/intelligence/v1/get-china-decision-signals'); } catch (e) { console.warn('[WM-FEED] 决策信号拉取失败:', e.message); return; }
  let payload = null;
  try { payload = d && d.payloadJson ? JSON.parse(d.payloadJson) : d; } catch (e) { payload = d; }
  const groups = (payload && payload.groups) || [];
  let hit = 0;
  for (const g of groups) {
    const items = (g.items || []).filter(i => !i.stale).slice(0, 4);
    if (!items.length) continue;
    const state = String(g.state || '');
    if (state === 'unavailable') continue;
    const gname = String(g.id || 'signals').replace(/-/g, ' ');
    const lines = items.map(i => (i.label || '') + ' [' + (i.summary || '') + ']');
    /* 台海组（最高价值）翻译通道处理不了结构化标签 → 内置中文标题生成（2026-08-31 空标题教训） */
    let zhTitle = '';
    if (g.id === 'cross-strait-activity') {
      const first = items[0] && String(items[0].summary || '');
      const num = (k) => { const m = first.match(new RegExp(k + ':\\s*(\\d+)')); return m ? +m[1] : null; };
      const air = num('plaAircraftSorties'), nav = num('planShips'), off = num('officialShips'), mid = num('medianLineCrossings');
      const parts = [];
      if (air != null) parts.push('解放军军机' + air + '架次');
      if (nav != null) parts.push('海军舰艇' + nav + '艘');
      if (off != null) parts.push('台军舰艇' + off + '艘');
      if (mid != null) parts.push('中线越线' + mid + '次');
      if (parts.length) zhTitle = '台海动态：' + parts.join('·') + '（台湾防务部门通报）';
    }
    hit++;
    out.push({
      title: 'China decision signals — ' + gname + ': ' + lines.slice(0, 2).join('; '),
      title_zh: zhTitle || undefined,
      content: 'WorldMonitor China decision-signals watch group "' + gname + '" (state: ' + state + '). ' +
        'Latest official signals: ' + lines.join(' | ') + '. ' +
        'Signals sourced from official releases (NBS, MOFCOM, SAFE, etc.); provenance-checked by upstream pipeline.',
      url: 'https://worldmonitor.app/wm-snapshot/china-signals/' + (g.id || 'x') + '/' + _dayKey(),
      publish_time: new Date().toISOString(),
      source: 'WorldMonitor China decision signals',
      country: 'China',
      data_type: 'osint_intel',
      category: '中国决策信号',
      chinaRelated: true,
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] 中国决策信号组命中: ' + hit + '/' + groups.length);
}

/* ── ⑦ 咽喉通道状态（yellow/red 才条目化；green 正态不采） ── */
const WM_CHOKE_COUNTRY = {
  suez: 'Egypt', malacca_strait: 'Malaysia', hormuz_strait: 'Iran', bab_el_mandeb: 'Yemen',
  panama: 'Panama', taiwan_strait: 'Taiwan', cape_of_good_hope: 'South Africa',
  gibraltar: 'Spain', bosphorus: 'Turkey', korea_strait: 'South Korea',
  dover_strait: 'United Kingdom', kerch_strait: 'Ukraine', lombok_strait: 'Indonesia',
};
async function _collectChokepoints(out) {
  let d;
  try { d = await _wmGet('/api/supply-chain/v1/get-chokepoint-status'); } catch (e) { console.warn('[WM-FEED] 咽喉拉取失败:', e.message); return; }
  const cps = (d && d.chokepoints) || [];
  let hit = 0;
  for (const c of cps) {
    const st = String(c.status || '').toLowerCase();
    if (st !== 'yellow' && st !== 'red') continue;   /* green 正态不采 */
    const country = WM_CHOKE_COUNTRY[c.id] || '';
    const ts = c.transitSummary || {};
    const lvl = st === 'red' ? 'ALERT' : 'WATCH';
    hit++;
    out.push({
      title: 'Maritime chokepoint ' + lvl + ' — ' + (c.name || c.id) + ': status ' +
        st.toUpperCase() + ', disruption score ' + (c.disruptionScore || 0) + '/100',
      content: (c.name || c.id) + ' chokepoint status ' + st.toUpperCase() +
        ' (disruption score ' + (c.disruptionScore || 0) + '/100). ' +
        (c.description || '') + ' ' +
        (ts.riskSummary ? 'Risk: ' + ts.riskSummary + ' ' : '') +
        (ts.incidentCount7d ? 'Incidents in 7 days: ' + ts.incidentCount7d + '. Disruption: ' + (ts.disruptionPct || 0) + '%. ' : '') +
        ((c.affectedRoutes || []).length ? 'Affected routes: ' + c.affectedRoutes.join(', ') + '. ' : '') +
        'Congestion level: ' + (c.congestionLevel || 'unknown') + '.',
      url: 'https://worldmonitor.app/wm-snapshot/chokepoint/' + (c.id || 'x') + '/' + _dayKey(),
      publish_time: d.fetchedAt ? new Date(d.fetchedAt).toISOString() : new Date().toISOString(),
      source: 'WorldMonitor chokepoint monitor',
      country,
      location: (c.lat != null && c.lon != null) ? (c.lat + ',' + c.lon) : '',
      data_type: 'infrastructure',
      category: '海上咽喉',
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] 咽喉通道 yellow/red 命中: ' + hit + '/' + cps.length);
}

/* ── ⑧ 中国走廊控制塔（长三角/大湾区/渤海/西部陆海新通道；降级才条目化） ── */
const WM_CORRIDOR_NAME = {
  'china-yangtze-river-delta': 'Yangtze River Delta corridor',
  'china-greater-bay-area': 'Greater Bay Area corridor',
  'china-bohai-rim': 'Bohai Rim corridor',
  'china-western-land-sea-corridor': 'Western Land-Sea corridor',
};
async function _collectCorridors(out) {
  let d;
  try { d = await _wmGet('/api/supply-chain/v1/get-china-corridor-control-towers'); } catch (e) { console.warn('[WM-FEED] 走廊拉取失败:', e.message); return; }
  let payload = null;
  try { payload = d && d.payloadJson ? JSON.parse(d.payloadJson) : d; } catch (e) { payload = d; }
  const cors = (payload && payload.corridors) || [];
  let hit = 0;
  for (const c of cors) {
    const avail = String(c.availability || '').toLowerCase();
    if (!avail || avail === 'available' || avail === 'normal') continue;   /* 正态不采 */
    const conds = (c.conditions || []).map(k =>
      (k.family || '?') + ': ' + (k.availability || '?') + (k.reason ? ' (' + k.reason + ')' : ''));
    const cname = WM_CORRIDOR_NAME[c.id] || c.name || c.id;
    hit++;
    out.push({
      title: 'China logistics corridor degraded — ' + cname + ': availability ' + avail +
        (conds.length ? ' (' + conds[0] + ')' : ''),
      content: cname + ' control tower reports availability level "' + avail + '" (not fully available). ' +
        (c.description || '') + ' ' +
        (conds.length ? 'Node conditions: ' + conds.join('; ') + '. ' : '') +
        'Monitored nodes: ' + ((c.nodes || []).length) + ' (ports, airports, rail hubs).',
      url: 'https://worldmonitor.app/wm-snapshot/corridor/' + (c.id || 'x') + '/' + _dayKey(),
      publish_time: (payload && payload.generatedAt) ? new Date(payload.generatedAt).toISOString() : new Date().toISOString(),
      source: 'WorldMonitor China corridor control towers',
      country: 'China',
      data_type: 'infrastructure',
      category: '物流走廊',
      chinaRelated: true,
      _sourceType: 'wm_feed',
    });
  }
  console.log('[WM-FEED] 中国走廊降级命中: ' + hit + '/' + cors.length);
}

/**
 * 主入口：一轮采集。串行 + 每通道间隔 1.5s（礼貌限速，符合其 free 层节奏）。
 * @returns { items, count }
 */
async function runWmFeed(opts) {
  opts = opts || {};
  const out = [];
  const steps = [
    _collectUcdp,
    _collectTheater,
    _collectFleet,
    _collectAdvisories,
    _collectGps,
    _collectChinaSignals,
    _collectChokepoints,
    _collectCorridors,
  ];
  for (const fn of steps) {
    try { await fn(out); } catch (e) { console.warn('[WM-FEED] 通道异常:', e.message); }
    await new Promise(s => setTimeout(s, 1500));
  }
  /* 标记 + 去重兜底 */
  const seen = new Set();
  const uniq = out.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.forEach(it => {
    it.interestLinked = true;
    if (it.data_type) it._forceDataType = true;  /* 权威指定不被通用分类器覆盖 */
  });
  return { items: uniq, count: uniq.length };
}

module.exports = { runWmFeed, getToken };
