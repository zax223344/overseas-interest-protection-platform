/**
 * backfill-archive.js — 窗外历史补采双源（任务 #654/#655，2026-09-06 用户拍板）
 * ================================================================
 * 背景：GDELT DOC API 官方硬限只检索最近 ~3 个月，2026-01-01 → GDELT_MIN_DAY
 * 共 164 天采不到。用户拍板：窗外缺口用 GDELT 2.1 事件归档库补
 * （ReliefWeb 源 2026-09-06 经用户决策整体放弃：v2 强制人工审批 appname，
 *  且人道主义/自然灾害类数据本项目不需要；代码保留休眠见 fetchPool）。
 *
 * 源 1 — GDELT 2.1 Events 归档库（data.gdeltproject.org/gdeltv2，2015 至今全量免费）：
 *   每 15 分钟一个 export.CSV.zip（61 列 TSV）。按日抽样 8 个（每 3 小时 1 个），
 *   过滤 QuadClass≥3（言语冲突+物质冲突）且 ActionGeo/行为体国别命中 57 国清单、
 *   SQLDATE==当日（事件日归属铁律）；同事件签名去重保留 NumMentions 最大者。
 *   归档事件无原始标题 → 模板化中文描述标题（_archiveEvent=true 全程可区分，零虚构：
 *   事件本体/行为体/地点/链接全部来自真实归档记录，标题只是结构化转述）。
 *
 *   ★ #714⑤（2026-09-08 审计根修）：QuadClass=3 言语冲突（root 10-13/16 要求/反对/
 *   拒绝/威胁/降级外交）是 245,474 条垃圾数据的主源头（88% 挤进 geopolitical_intel，
 *   模板句「X 对 Y 提出要求」零情报价值）——前置丢弃，只保留物质冲突（QuadClass=4）
 *   + 抗议（root 14，social_unrest 价值类）。归档模板标题降级为死链兜底
 *   （_tplTitle，回捞成功即被真实标题替换，见 backfill-titles.js）。
 *
 * 源 2 — ReliefWeb API（api.reliefweb.int，免费免 Key，真实标题）：
 *   按日拉取当日报告，补灾害/冲突/人道/公共卫生类（归档库 CAMEO 覆盖不到
 *   nature/society 域的缺口）。标题英文 → 走统一翻译管线。
 *
 * 列索引（2026-09-06 实测 20260115000000.export.CSV.zip 验证，61 列）：
 *   0 GLOBALEVENTID 1 SQLDATE 6 Actor1Name 7 Actor1CountryCode
 *   16 Actor2Name 17 Actor2CountryCode 26 EventCode 28 EventRootCode
 *   29 QuadClass 30 GoldsteinScale 31 NumMentions 33 NumArticles
 *   52 ActionGeo_FullName 53 ActionGeo_CountryCode 59 DATEADDED 60 SOURCEURL
 */
'use strict';

const AdmZip = require('adm-zip');

const ARCHIVE_BASE = 'https://data.gdeltproject.org/gdeltv2/';
/* 2026-09-07 #661 用户指令：7 天 36 万——每日 8 包抽样（≈157 条/日）升级为全天 96 包
 * 全量（00:00~23:45 每 15 分钟 1 包）。实测单包含 QuadClass≥3 行 410~1224，
 * 全天原始池 ~6.7 万行，过 57 国滤+事件签名去重后预计 2~6k 唯一事件/日，足以喂满 1500/日目标。
 * 静态归档站（非 DOC API）无 5s/IP 限流，6 并发 + 120ms 交错起步，实测单包 ~100ms。 */
const FULL_SLICES = [];
for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45])
  FULL_SLICES.push(String(h).padStart(2, '0') + String(m).padStart(2, '0'));
const ZIP_CONCURRENCY = 6;                           /* 并发下载包数 */
const ZIP_STAGGER_MS = 120;                          /* 每 worker 包间交错 */
const RW_LIMIT = 300;                                /* ReliefWeb 单日上限 */

/* ---------- CAMEO → 18 类映射（root 默认 + 子码精确覆盖） ---------- */
const ROOT_CAT = {
  '10': 'geopolitical_intel',   /* 要求 */
  '11': 'geopolitical_intel',   /* 反对 */
  '12': 'geopolitical_intel',   /* 拒绝 */
  '13': 'geopolitical_intel',   /* 威胁 */
  '14': 'social_unrest',        /* 抗议 */
  '15': 'military_conflicts',   /* 军事姿态展示 */
  '16': 'geopolitical_intel',   /* 降低外交关系 */
  '17': 'crime_events',         /* 强制（默认；172/173 制裁、175/176 劫持见子码） */
  '18': 'crime_events',         /* 袭击（默认治安；183/185/186 恐袭见子码） */
  '19': 'military_conflicts',   /* 战斗 */
  '20': 'mass_violence'         /* 非常规大规模暴力 */
};
const CODE_CAT = {
  '144': 'mass_violence', '145': 'mass_violence',           /* 骚乱/暴力示威 */
  '172': 'sanctions_data', '173': 'sanctions_data',         /* 禁运/制裁 */
  '175': 'terror_events', '176': 'terror_events',           /* 劫持/绑架人质 */
  '183': 'terror_events',                                   /* 自杀式爆炸 */
  '185': 'terror_events', '186': 'terror_events',           /* 暗杀未遂/暗杀 */
  '201': 'mass_violence', '202': 'mass_violence',
  '203': 'mass_violence',                                   /* 大规模驱逐/杀戮/清洗 */
  '204': 'terror_events'                                    /* 使用大规模杀伤性武器 */
};
/* 标题动词（模板化中文转述；双行为体用及物式，单行为体用单主体式） */
const VERB_TRANS = {  /* A1 对 A2 ___ */
  '10': '提出要求', '11': '表达反对', '12': '拒绝合作',
  '13': '发出威胁', '14': '发起抗议', '15': '展示军事姿态', '16': '降级外交关系',
  '17': '采取强制行动', '18': '发动袭击', '19': '发生武装冲突', '20': '实施大规模暴力',
  '144': '引发骚乱', '145': '发起暴力示威', '172': '实施禁运制裁', '173': '实施制裁',
  '174': '实施逮捕拘留', '175': '实施劫持绑架', '176': '劫持人质', '182': '发动袭击',
  '183': '发动自杀式爆炸袭击', '185': '企图暗杀', '186': '实施暗杀',
  '190': '发动军事打击', '192': '实施封锁', '193': '实施轰炸', '194': '占领领土',
  '195': '发动空袭', '196': '违反停火', '201': '实施大规模驱逐', '202': '实施大规模杀戮',
  '203': '实施族群清洗', '204': '使用大规模杀伤性武器'
};
const VERB_NOUN = {   /* 无行为体时的名词式 */
  '10': '外交交涉', '11': '反对声明', '12': '拒绝事件',
  '13': '威胁言论事件', '14': '抗议活动', '15': '军事姿态展示', '16': '外交关系降级',
  '17': '强制行动', '18': '袭击事件', '19': '武装冲突', '20': '大规模暴力事件',
  '144': '骚乱', '145': '暴力示威', '172': '禁运制裁', '173': '制裁措施',
  '174': '逮捕拘留行动', '175': '劫持绑架事件', '176': '劫持人质事件', '182': '袭击事件',
  '183': '自杀式爆炸袭击', '185': '暗杀未遂事件', '186': '暗杀事件',
  '190': '军事打击', '192': '封锁行动', '193': '轰炸事件', '194': '领土占领',
  '195': '空袭事件', '196': '停火遭破坏', '201': '大规模驱逐', '202': '大规模杀戮',
  '203': '族群清洗', '204': '大规模杀伤性武器使用'
};

let D = null;
let _FIPS2CN = null;   /* FIPS 10-4 → 中文国名（GD_COUNTRIES 反查，单一取源） */

function init(deps) {
  D = deps;
  _FIPS2CN = {};
  Object.keys(D.crawler.GD_COUNTRIES).forEach(cn => {
    const code = D.crawler.GD_COUNTRIES[cn][0];
    if (code && !_FIPS2CN[code]) _FIPS2CN[code] = cn;
  });
  console.log('[BACKFILL-ARCHIVE] FIPS 反查表 ' + Object.keys(_FIPS2CN).length + ' 国');
}

/* 行为体名翻译（2026-09-06 #657）：gdelt-actors.js 单一事实源——群体词/机构词/
 * 高频组织/国家名/州名一律入库即中文；词表外真实实体名保留原文（不编造），
 * 全大写原文回退为首字母大写化（"SOMALI" → "Somali"）提升可读性。 */
const { actorZh } = require('./gdelt-actors');
/* #777 P0（2026-09-12）：标题可信度单一事实源（行为体合法性 + 模板句可信度 + chrome 标题） */
const TS = require('./title-sanity');
function _actorName(s) {
  s = String(s || '').trim();
  if (!s) return '';
  const zh = actorZh(s);
  if (/[一-龥]/.test(zh)) return TS.normActor(zh);   /* 中文行为体：碎片词（副/极/代表）作废 */
  const en = zh.toLowerCase().replace(/(^|\s|-|\/)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  return TS.normActor(en);
}
/* #777 P0 可信度：军事/暴力动词须行为体具备武力投射能力，否则判 GDELT 误码 */
function _conf(ev, root, a1, a2) {
  return TS.archiveTplConf(_actorName(a1), _actorName(a2), ev, root);
}
function _title(cn, a1, a2, evCode, root, numMentions, lowConf) {
  const A1 = _actorName(a1), A2 = _actorName(a2);
  const vt = VERB_TRANS[evCode] || VERB_TRANS[root] || '发生对抗';
  const vn = VERB_NOUN[evCode] || VERB_NOUN[root] || '对抗事件';
  /* #777 P0：低可信条目降级为中性事件转述（不虚构主语，仍入库、量不减） */
  if (lowConf) return cn + '：' + vn + '（' + numMentions + ' 篇报道）';
  if (A1 && A2 && A1 !== A2) return cn + '：' + A1 + ' 对 ' + A2 + ' ' + vt;
  if (A1) return cn + '：' + A1 + ' ' + vt;
  if (A2) return cn + '：' + A2 + ' 涉' + vn;
  return cn + '：' + vn + '（' + numMentions + ' 篇报道）';
}

/* ---------- 源 1：GDELT 2.1 事件归档 ---------- */
async function _zipRows(day, hhmm) {
  const stamp = day.replace(/-/g, '') + hhmm + '00';
  const url = ARCHIVE_BASE + stamp + '.export.CSV.zip';
  let resp;
  try {
    resp = await D.netx.smartFetch(url, { timeout: 60000 });
  } catch (e) { return { rows: 0, err: e.message }; }
  if (!resp.ok) return { rows: 0, err: 'http-' + resp.status };
  let lines;
  try {
    const zip = new AdmZip(await resp.buffer());
    const ent = zip.getEntries()[0];
    if (!ent) return { rows: 0, err: 'empty-zip' };
    lines = zip.readAsText(ent).split('\n');
  } catch (e) { return { rows: 0, err: 'unzip:' + e.message }; }
  const dayCompact = day.replace(/-/g, '');
  const out = [];
  for (const ln of lines) {
    if (!ln) continue;
    const f = ln.split('\t');
    if (f.length < 61) continue;
    if (f[1] !== dayCompact) continue;              /* SQLDATE 必须==当日（事件日归属铁律） */
    const qc = parseInt(f[29], 10) || 0;
    /* #714⑤ 言语码前置丢弃：只留物质冲突（QuadClass=4）+ 抗议（root 14）。
     * 旧版 qc>=3 收言语冲突，是 24.5 万条模板垃圾的主源头。 */
    if (qc !== 4 && f[28] !== '14') continue;
    /* 国别：ActionGeo 优先，行为体国码兜底；必须命中 57 国 FIPS 反查表 */
    const cn = _FIPS2CN[f[53]] || _FIPS2CN[f[7]] || _FIPS2CN[f[17]] || '';
    if (!cn) continue;
    const url2 = String(f[60] || '').trim();
    if (!/^https?:\/\//i.test(url2)) continue;
    out.push({
      _gid: f[0], _a1: f[6], _a2: f[16], _ev: f[26], _root: f[28],
      _nm: parseInt(f[31], 10) || 1, _na: parseInt(f[33], 10) || 1,
      _geo: f[52], _cn: cn, _url: url2
    });
  }
  return { rows: out.length, items: out };
}

/* 小并发映射池：96 包 6 路并发，worker 内包间 120ms 交错（归档站礼貌） */
async function _mapPool(arr, n, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const k = i++;
      if (k >= arr.length) return;
      out[k] = await fn(arr[k]);
      await new Promise(res => setTimeout(res, ZIP_STAGGER_MS));
    }
  }));
  return out;
}

async function _archivePool(day, stat) {
  /* 同事件签名去重（a1|a2|ev|cn），保留 NumMentions 最大 */
  const byKey = {};
  const results = await _mapPool(FULL_SLICES, ZIP_CONCURRENCY, s => _zipRows(day, s));
  results.forEach(r => {
    if (!r || r.err) { stat.zipErr++; return; }
    stat.zipOk++;
    (r.items || []).forEach(it => {
      const k = it._a1 + '|' + it._a2 + '|' + it._ev + '|' + it._cn;
      if (!byKey[k] || byKey[k]._nm < it._nm) byKey[k] = it;
    });
  });
  const items = Object.keys(byKey).map(k => byKey[k]);
  items.sort((a, b) => b._nm - a._nm);              /* 高报道量优先（选择阶段自上而下） */
  return items.map(it => {
    const cat = CODE_CAT[it._ev] || ROOT_CAT[it._root] || 'geopolitical_intel';
    /* #777 P0：可信度判定——军事/暴力码但行为体不具备武力能力 = GDELT 误码，
     * 降级为中性转述（不虚构主语）。条目照常入库（用户铁律：采集量不能少），
     * 仅以 _tplLowConf 标记，供前端/接口层过滤。 */
    const conf = _conf(it._ev, it._root, it._a1, it._a2);
    const tpl = _title(it._cn, it._a1, it._a2, it._ev, it._root, it._nm, conf === 'low');
    const row = {
      title: tpl,                            /* 模板标题（回捞成功即被真实标题替换） */
      _tplTitle: tpl,                        /* #714④ 模板留档：backfill-titles 回捞目标标识 */
      _zhTitle: true,                        /* 已是中文，跳过翻译管线（仅死链兜底路径生效） */
      _ev: it._ev, _root: it._root,          /* CAMEO 码透传：真实标题分类时精确子码优先 */
      url: it._url,
      source: 'GDELT事件归档',
      country: it._cn,
      publish_time: day + 'T12:00:00Z',
      publishedAt: day + 'T12:00:00Z',
      event_date: day + 'T12:00:00Z',
      date: day + 'T12:00:00Z',
      _cat: cat,
      _sourceType: 'backfill',
      _archiveEvent: true,                   /* 仅死链兜底条目保留（真实标题条目会被剥离） */
      _archiveSrc: 'gdelt-events',
      gdeltEventId: it._gid,
      mentions: it._nm,
      interestLinked: true
    };
    if (conf === 'low') row._tplLowConf = true;
    return row;
  });
}

/* #714④：CAMEO 精确子码分类（恐袭 175/176/183/185/186、制裁 172/173 高置信，
 * 真实标题关键词分类（GAP_KEYWORDS）之前优先取用） */
function preciseCat(item) {
  return CODE_CAT[item && item._ev] || '';
}

/* ---------- 源 2：ReliefWeb（真实标题，补 nature/society 域） ----------
 * 2026-09-06 实测：v1 API 已退役（全端点 410 Gone）；v2 自 2025-11-01 起强制
 * 预审批 appname（未审批 403）。免费注册：https://apidoc.reliefweb.int/parameters#appname
 * 审批后把 appname 写入环境变量 RW_APPNAME 即自动启用；未配置/被拒时优雅跳过。 */
async function _reliefwebPool(day, stat) {
  const appname = process.env.RW_APPNAME || '';
  if (!appname) { stat.rwErr = 'no-appname'; return []; }
  const qs = 'appname=' + encodeURIComponent(appname) + '&profile=list&limit=' + RW_LIMIT +
    '&filter[field]=date.created' +
    '&filter[value][from]=' + encodeURIComponent(day + 'T00:00:00+00:00') +
    '&filter[value][to]=' + encodeURIComponent(day + 'T23:59:59+00:00') +
    '&fields[include][]=title&fields[include][]=url' +
    '&fields[include][]=country.name&fields[include][]=date.created&fields[include][]=source.name';
  let resp;
  try {
    resp = await D.netx.smartFetch('https://api.reliefweb.int/v2/reports?' + qs, { timeout: 30000 });
  } catch (e) { stat.rwErr = e.message; return []; }
  if (!resp.ok) { stat.rwErr = 'http-' + resp.status; return []; }
  let j;
  try { j = await resp.json(); } catch (e) { stat.rwErr = 'json'; return []; }
  const out = [];
  (j.data || []).forEach(r => {
    const fd = r.fields || {};
    const title = String(fd.title || '').trim();
    const url = String(fd.url || '').trim();
    if (!title || !/^https?:\/\//i.test(url)) return;
    const countries = (fd.country || []).map(c => String(c.name || '')).filter(Boolean);
    let cn = '';
    for (const en of countries) {
      cn = (D.crawler.gdCnFromEn && D.crawler.gdCnFromEn(en)) || '';
      if (cn) break;
    }
    /* 国别不在 57 国清单的丢弃（与归档源同口径；中国涉华条目由标题判定另行放行） */
    if (!cn) {
      try { if (!D.isChinaRelated(title)) return; } catch (e) { return; }
    }
    const iso = String((fd.date || {}).created || (day + 'T12:00:00+00:00')).replace('+00:00', 'Z');
    out.push({
      title, url,
      source: 'ReliefWeb/' + String(((fd.source || [])[0] || {}).name || 'unknown').slice(0, 40),
      country: cn,
      publish_time: iso, publishedAt: iso, event_date: iso, date: iso,
      _sourceType: 'backfill',
      _archiveSrc: 'reliefweb',
      interestLinked: true
    });
  });
  stat.rwN = out.length;
  return out;
}

/* ---------- 窗外日总入口（backfill.js processDay 调用） ---------- */
async function fetchPool(day) {
  const stat = { zipOk: 0, zipErr: 0, rwN: 0, rwErr: '' };
  const t0 = Date.now();
  const arc = await _archivePool(day, stat);
  /* 2026-09-06 用户决策：ReliefWeb 源整体放弃（v2 强制人工审批 appname，
   * 且人道主义/自然灾害类数据本项目不需要）。_reliefwebPool 保留休眠，
   * 未来如需重新启用，解除下行注释即可。 */
  const rw = []; // await _reliefwebPool(day, stat);
  const seen = new Set();
  const pool = [];
  arc.concat(rw).forEach(it => {
    if (seen.has(it.url)) return;
    seen.add(it.url);
    pool.push(it);
  });
  console.log('[BACKFILL-ARCHIVE] ' + day + ' 归档 ' + arc.length + '（zip 成功 ' + stat.zipOk + '/' + FULL_SLICES.length + '，失败 ' + stat.zipErr + '） → 池 ' + pool.length + ' / ' + Math.round((Date.now() - t0) / 1000) + 's');
  return pool;
}

/* 归档站探活：下一小包试通。归档站(data.gdeltproject.org)与 DOC API 是两套独立服务，
 * DOC API 的 429 熔断不代表归档站不可用（2026-09-07 事故：DOC 熔断把补采全员卡死，
 * 而归档站实测无限流）。补采护栏必须探归档站本身。 */
async function probeArchive(day) {
  const r = await _zipRows(day, '0000');
  return { ok: !r.err, err: r.err || null, rows: r.rows || 0 };
}

module.exports = { init, fetchPool, probeArchive, preciseCat };
