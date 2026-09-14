/* ============================================================
 * exec-travel.js — 高管出境风险监测（#753）
 * ------------------------------------------------------------
 * 参照《高管出境风险监测系统_详细设计说明书 V2.0》自主设计：
 *   典型场景：孟晚舟事件（2018 过境加拿大被拘押——出口管制 + 第三国引渡）
 *   核心思路：风险管理从「事后救火」前移到「事前预警 + 途中监测」
 *
 * 引擎三层（说明书 4.1）：
 *   ① 硬规则 H01-H04 —— 命中即红，不可绕过，对应孟晚舟式致命点
 *   ② 六维加权评分 0-100 —— 可解释、每一分可下钻到信源
 *   ③ 人工复核 —— 红黄预警必须经复核才对外处置（status 流转）
 *
 * 数据源（零模拟）：
 *   - 制裁名单：data/us_sanctions_latest.json（#745 OpenSanctions 70k 实体缓存，H01/D1/D3）
 *   - 风险事件：intel_data 近 90 天涉目的/过境国红橙事件（H04/D2/D5）
 *   - 人员/行程台账：PG exec_people / exec_trips（用户录入，非模拟）
 *
 * 分级（说明书 4.5）：红 ≥75 或任一硬规则命中 / 黄 55-74 / 绿 <55
 * ============================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');

/* ---------- 规则库（静态可解释配置，非数据模拟） ---------- */

/* #788 P0 纠错：旧版 EXTRADITE_US 二元名单废除。
 * 两大方向性错误：
 *   ① 把「中国香港」「中国台湾」列进对美引渡高风险区——
 *      香港 2020-08 起对美引渡条约已被美方单方面中止（通道关闭），台湾地区无对美引渡条约；
 *   ② 只看"有没有条约"一个维度——缺对华执法立场、缺历史拘押先例（孟晚舟 2018 加拿大 /
 *      华为员工 2019 波兰都是"有条约+愿配合+真干过"三维齐中）。
 * 现改用三维矩阵（对美引渡通道 × 对华执法立场 × 拘押先例），见 country-enforce-matrix.js */
const matrix = require('./country-enforce-matrix');

/* 五眼联盟（D6 信息安全：终端/通信截获风险高发区） */
const FIVE_EYES = new Set(['美国', '英国', '加拿大', '澳大利亚', '新西兰']);

/* 中企品牌中英归一（名单库实体为英文名：「华为」等中文录入须经品牌映射才能比对；
 * 静态归一词典（同 translation-terms 口径），非数据模拟） */
const CN_BRAND_EN = {
  '华为': 'huawei', '中兴': 'zte', '海康威视': 'hikvision', '海康': 'hikvision', '大疆': 'dji',
  '中芯国际': 'smic', '中芯': 'smic', '长江存储': 'ymtc', '科大讯飞': 'iflytek', '讯飞': 'iflytek',
  '商汤': 'sensetime', '旷视': 'megvii', '依图': 'yitu', '云从': 'cloudwalk', '寒武纪': 'cambricon',
  '浪潮': 'inspur', '曙光': 'sugon', '比亚迪': 'byd', '京东方': 'boe', '三一': 'sany',
  '中国航天': 'casc', '中航工业': 'avic', '中国电科': 'cetc', '中国核工业': 'cnnnc', '中国中车': 'crrc',
  '中国铁建': 'crcc', '中国交建': 'cccc', '中石油': 'cnpc', '中石化': 'sinopec', '中海油': 'cnooc',
  '中国移动': 'china mobile', '中国联通': 'china unicom', '中国电信': 'china telecom', '中远海运': 'cosco'
};
const _BRAND_EN_SET = new Set(Object.values(CN_BRAND_EN));
/* 中文名 → 英文品牌词展开（「华为技术有限公司」→ ['huawei']） */
function _brandEnOf(name) {
  const s = String(name || '');
  const out = [];
  for (const [cn, en] of Object.entries(CN_BRAND_EN)) {
    if (s.indexOf(cn) >= 0 && out.indexOf(en) < 0) out.push(en);
  }
  return out;
}

/* 技术方向敏感度（D3：ECCN/实体清单口径的领域风险档位） */
const TECH_SENS = {
  '半导体': 95, '芯片': 95, '集成电路': 95, '光刻': 96, '5G': 92, '通信': 85, '人工智能': 85,
  '量子': 90, '航空航天': 95, '卫星': 92, '核工业': 98, '军工': 98, '无人机': 88,
  '生物': 70, '医药': 65, '新能源': 60, '电池': 62, '汽车': 55, '光伏': 58,
  '金融': 50, '基础设施': 45, '矿业': 50, '农业': 30, '贸易': 30, '商务': 30, '其他': 35
};

/* 职务层级暴露度（D1） */
const TITLE_SCORE = { ceo: 100, cto: 90, cfo: 80, vp: 70, director: 60, other: 40 };
const TITLE_CN = { ceo: 'CEO/董事长', cto: 'CTO/首席技术官', cfo: 'CFO/首席财务官', vp: 'VP/副总裁', director: '总监', other: '其他' };

/* 在途执法/司法关键词（H04/D5：英文标题 + 中文标题双口径）
 * SQL 端版本（~* 大小写不敏感；\m\M 词边界防 'ban' 误命中 'urban'） */
const ENFORCE_RE = /(detain|arrest|indict|extradit|prosecut|subpoena|warrant|sanction|entity list|export control|denied order|\bban\b|restrict|raid|seiz|charged|guilty|plea|investigat|probe)/i;
const ENFORCE_RE_ZH = /(羁押|拘押|逮捕|起诉|引渡|传票|逮捕令|制裁|实体清单|出口管制|禁令|禁运|搜查|扣押|指控|认罪|调查|执法|审判|定罪)/;
const ENFORCE_SQL_EN = 'detain|arrest|indict|extradit|prosecut|subpoena|warrant|sanction|entity list|export control|denied order|\\mban\\M|restrict|raid|seiz|charged|guilty|plea|investigat|probe';
const ENFORCE_SQL_ZH = '羁押|拘押|逮捕|起诉|引渡|传票|逮捕令|制裁|实体清单|出口管制|禁令|禁运|搜查|扣押|指控|认罪|调查|执法|审判|定罪';

/* #788 P0：点名执法动词（T 级判定）——直接指向本方人/企的强制措施动词。
 * 与上面环境词表（含 sanction/investigate/restrict 等环境词）分离：
 *   T 级 = 企业/人名 ∩ 点名强制措施（羁押/逮捕/起诉/引渡/搜查…）→ 硬规则 H04-T
 *   A 级 = 仅环境执法活跃（制裁/调查/管制类）→ 只进 D5，不触发硬规则 */
const TARGET_VERB_RE = /(detain|arrest|indict|extradit|subpoena|warrant|seiz|charg|prosecut|raid|guilty|plea)/i;
const TARGET_VERB_RE_ZH = /(羁押|拘押|逮捕|起诉|引渡|传票|逮捕令|搜查|扣押|指控|认罪|定罪|审判)/;

const DIM_WEIGHTS = [
  { k: 'd1', cn: '人员暴露度', w: 0.22 },
  { k: 'd2', cn: '目的地/过境国', w: 0.20 },
  { k: 'd3', cn: '行业技术敏感度', w: 0.20 },
  { k: 'd4', cn: '行程脆弱点', w: 0.14 },
  { k: 'd5', cn: '司法执法动态', w: 0.14 },
  { k: 'd6', cn: '信息安全', w: 0.10 }
];

const LEVELS = {
  red: { cn: '红色', min: 75, color: '#ef4444', action: '董事会级：强制改签评估、法务+安全联席、应急包待命、领事保护预沟通' },
  yellow: { cn: '黄色', min: 55, color: '#f59e0b', action: '公司级：法务审核、预案下发、加密通信、每日复盘' },
  green: { cn: '绿色', min: 0, color: '#22c55e', action: '部门级：常规差旅提示、行前告知书' }
};

/* ---------- 工具 ---------- */
const _clamp = (v) => Math.max(0, Math.min(100, Math.round(v || 0)));
const _norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s,.\-·]/g, '');

function _titleLevelOf(title, given) {
  if (given && TITLE_SCORE[given] != null) return given;
  const t = String(title || '');
  if (/CEO|首席执行官|总裁|董事长|chairman/i.test(t)) return 'ceo';
  if (/CTO|首席技术|技术总监/i.test(t)) return 'cto';
  if (/CFO|首席财务/i.test(t)) return 'cfo';
  if (/VP|副总裁|副总|vice/i.test(t)) return 'vp';
  if (/总监|director/i.test(t)) return 'director';
  return 'other';
}

function _techSens(f) {
  if (!f) return 0;
  let best = 0, hit = null;
  for (const [k, v] of Object.entries(TECH_SENS)) {
    if (String(f).indexOf(k) >= 0 && v > best) { best = v; hit = k; }
  }
  return { score: best || TECH_SENS['其他'], field: hit || '其他' };
}

/* ---------- 制裁名单（复用 #745 OpenSanctions 缓存，懒加载只读） ---------- */
const SANC_FILE = path.join(__dirname, '..', 'data', 'us_sanctions_latest.json');
let _sanc = { at: 0, nameIdx: new Map(), count: 0, lastUpdated: null };

function _loadSanctions() {
  try {
    const st = fs.statSync(SANC_FILE);
    if (_sanc.count && st.mtimeMs < _sanc.at) return;   /* 名单文件未变则不重载 */
    const j = JSON.parse(fs.readFileSync(SANC_FILE, 'utf8'));
    const idx = new Map();
    for (const e of (j.ents || [])) {
      for (const n of [e.name].concat(e.aliases || [])) {
        const k = _norm(n);
        /* 索引门槛：拉丁串 ≥4 字符；中文 ≥2 字符（「华为」「中兴」型短名必须可命中） */
        const cjk = /[\u4e00-\u9fff]/.test(k);
        if (!k || (!cjk && k.length < 4) || (cjk && k.length < 2)) continue;
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(e);
      }
    }
    _sanc = { at: Date.now(), nameIdx: idx, count: (j.ents || []).length, lastUpdated: j.lastUpdated || null };
  } catch (e) { /* 名单缺失时静默降级（H01 不可用将体现在 detail） */ }
}

/* 制裁命中查询：人员名/拼音/企业名/别名 → 命中实体列表（精确索引 + 中英包含） */
function _sancMatch(queries) {
  _loadSanctions();
  const out = [];
  for (const qRaw of queries) {
    const q = String(qRaw || '').trim();
    if (!q || q.length < 2) continue;
    const qn = _norm(q);
    const cjk = /[\u4e00-\u9fff]/.test(qn);
    const exact = _sanc.nameIdx.get(qn);
    if (exact) { exact.forEach(e => { if (!out.find(o => o.entity.id === e.id)) out.push({ entity: e, mode: '精确命中', q }); }); continue; }
    /* 包含匹配（防「华为技术有限公司」命中「华为」型写法差异）：仅扫长度相近的候选，跳过高频词；
     * 品牌映射词（huawei/zte…）辨识度高，放开「key 包含词」方向的长度守卫——
     * 否则 'huaweitechinvestmentco'(22) vs 'huawei'(6) 差 16 会被 ≤14 守卫挡掉 */
    if ((!cjk && qn.length >= 4) || (cjk && qn.length >= 2)) {
      const isBrand = _BRAND_EN_SET.has(qn);
      for (const [k, ents] of _sanc.nameIdx) {
        if (ents.length > 20) continue;               /* 高频词跳过防误伤 */
        const keyHasQ = k.indexOf(qn) >= 0;
        if ((keyHasQ && (isBrand || Math.abs(k.length - qn.length) <= 14)) ||
            (qn.indexOf(k) >= 0 && Math.abs(k.length - qn.length) <= 14)) {
          ents.forEach(e => { if (!out.find(o => o.entity.id === e.id)) out.push({ entity: e, mode: isBrand ? '品牌映射（中文名→英文实体）' : '名称包含', q }); });
          if (out.length > 5) break;
        }
      }
    }
    if (out.length > 5) break;
  }
  return out.slice(0, 5);
}

module.exports = function execTravel(ctx) {
  const router = express.Router();
  const q = ctx.query;
  const log = (...a) => { try { console.log('[exec-travel]', ...a); } catch (_) {} };

  /* ---------- PG 表（首用即建） ---------- */
  let _schemaP = null;
  function _schema() {
    if (!_schemaP) {
      _schemaP = (async () => {
        await q(`CREATE TABLE IF NOT EXISTS exec_people (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          pinyin TEXT,
          title TEXT,
          title_level TEXT,
          org TEXT,
          tech_field TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        await q(`CREATE TABLE IF NOT EXISTS exec_trips (
          id SERIAL PRIMARY KEY,
          person_id INT NOT NULL,
          dest_country TEXT NOT NULL,
          dest_city TEXT,
          transit_country TEXT,
          transit_hours INT DEFAULT 0,
          dep_date TEXT,
          ret_date TEXT,
          direct_flight BOOLEAN DEFAULT FALSE,
          night_flight BOOLEAN DEFAULT FALSE,
          meeting_level TEXT DEFAULT 'internal',
          status TEXT DEFAULT 'submitted',
          risk_score INT,
          risk_level TEXT,
          risk_detail JSONB,
          scan_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        /* #788 P1/P2 增量列（幂等） */
        await q(`ALTER TABLE exec_people ADD COLUMN IF NOT EXISTS passports TEXT,
                 ADD COLUMN IF NOT EXISTS exposure_level TEXT,
                 ADD COLUMN IF NOT EXISTS device_policy TEXT,
                 ADD COLUMN IF NOT EXISTS visa_incidents TEXT,
                 ADD COLUMN IF NOT EXISTS inspection_history TEXT`);
        await q(`ALTER TABLE exec_trips ADD COLUMN IF NOT EXISTS transit_entry TEXT,
                 ADD COLUMN IF NOT EXISTS realert BOOLEAN DEFAULT FALSE,
                 ADD COLUMN IF NOT EXISTS debrief_outcome TEXT,
                 ADD COLUMN IF NOT EXISTS debrief_notes TEXT`);
      })().catch(e => { _schemaP = null; log('schema fail:', e.message); throw e; });
    }
    return _schemaP;
  }

  /* ---------- intel_data 近 90 天风险环境（H04/D2/D5 唯一事件信源）
   * v2（#753 实测修正）：美加 90 天 11327 条，原「LIMIT 400 按 collect_time DESC 拉行」
   * 只覆盖几小时，两天前采集的华为涉美执法案件全部被挤出窗口 → H04 漏报。
   * 改为两路 SQL：
   * ① 聚合路（D2/D5 密度）：COUNT + FILTER 一次算红橙数/执法数，不拉行；
   * ② 案件路（H04/D1）：关键词（企业/人员/技术方向）× 执法词 在 SQL 内定向匹配。 */
  const _envCache = new Map();   /* key → {at, data}，10min */
  async function _environ(countries, keywords) {
    const ck = countries.slice().sort().join('|') + '||' + (keywords || []).filter(Boolean).sort().join('|');
    const hit = _envCache.get(ck);
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit.data;
    const data = { byCountry: {}, cases: [], total: 0, enforceTotal: 0, roTotal: 0 };
    try {
      /* ① 聚合：每国总量/红橙/执法数 */
      const { rows: agg } = await q(
        `SELECT country,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE severity IN ('red','orange'))::int AS ro,
                COUNT(*) FILTER (WHERE title ~* $2 OR COALESCE(NULLIF(data_json->>'title_zh',''),'') ~ $3)::int AS enforce
         FROM intel_data
         WHERE audit_status='approved' AND country = ANY($1::text[])
           AND collect_time >= NOW() - INTERVAL '90 days'
         GROUP BY country`, [countries, ENFORCE_SQL_EN, ENFORCE_SQL_ZH]);
      for (const r of agg) {
        data.byCountry[r.country] = { total: Number(r.total), ro: Number(r.ro), enforce: Number(r.enforce) };
        data.total += Number(r.total); data.roTotal += Number(r.ro); data.enforceTotal += Number(r.enforce);
      }
      /* ② 案件：关键词 × 执法词定向 */
      const kws = (keywords || []).map(s => String(s).trim()).filter(s => s.length >= 2).slice(0, 6);
      if (kws.length) {
        const kwOr = kws.map((_, i) => `title ILIKE $${i + 2} OR COALESCE(NULLIF(data_json->>'title_zh',''),title) LIKE $${i + 2}`).join(' OR ');
        const params = [countries].concat(kws.map(k => '%' + k + '%'));
        const { rows: cases } = await q(
          `SELECT id, country, COALESCE(NULLIF(data_json->>'title_zh',''), title) AS t
           FROM intel_data
           WHERE audit_status='approved' AND country = ANY($1::text[])
             AND collect_time >= NOW() - INTERVAL '90 days'
             AND (title ~* $${kws.length + 2} OR COALESCE(NULLIF(data_json->>'title_zh',''),'') ~ $${kws.length + 3})
             AND (${kwOr})
           ORDER BY collect_time DESC LIMIT 20`, params.concat([ENFORCE_SQL_EN, ENFORCE_SQL_ZH]));
        data.cases = cases.map(r => ({ id: r.id, country: r.country, t: String(r.t || '').slice(0, 110) }));
      }
    } catch (e) { log('environ query fail:', e.message); }
    _envCache.set(ck, { at: Date.now(), data });
    if (_envCache.size > 200) _envCache.delete(_envCache.keys().next().value);
    return data;
  }

  /* ---------- 风险扫描引擎（核心：硬规则 + 六维，全部可解释） ---------- */
  async function _scan(person, trip) {
    const detail = { hardRules: [], dims: {}, sancReady: _sanc.count > 0 };
    const countries = Array.from(new Set([trip.dest_country, trip.transit_country].filter(Boolean)));
    const org = String(person.org || '').trim();
    const keywords = [org, person.name, person.pinyin, person.tech_field].filter(Boolean);
    const env = await _environ(countries, keywords);

    /* ===== 硬规则（命中即红） ===== */
    /* #788 P0：矩阵探针 + 过境管辖接触方式（在硬规则前计算，D2/D4/D6 复用） */
    const dest = trip.dest_country || '';
    const transitProbe = trip.transit_country ? matrix.probe(trip.transit_country) : null;
    const destProbe = matrix.probe(dest);
    /* 过境管辖接触方式（H03 口径）：空侧中转不入境 = 不构成管辖接触；
     * 缺省时按停留时长保守推断（≥4h 视为落地入境，<4h 视为空侧） */
    const entryMode = ['airside', 'landside', 'overnight'].includes(trip.transit_entry)
      ? trip.transit_entry
      : (!trip.direct_flight && trip.transit_country && Number(trip.transit_hours || 0) >= 4 ? 'landside' : 'airside');
    const ENTRY_CN = { airside: '空侧中转·不入境（无管辖接触）', landside: '落地入境·不宿夜', overnight: '入境过夜（深度管辖接触）' };

    /* H01 制裁/实体清单命中：人员本名/拼音 + 所属企业对 OpenSanctions 比对 */
    const personHits = _sancMatch([person.name, person.pinyin]);
    const orgHits = org ? _sancMatch([org].concat(_brandEnOf(org))) : [];
    if (personHits.length) {
      detail.hardRules.push({ id: 'H01', name: '制裁/实体清单命中（人员）', hit: true,
        detail: `「${person.name}」命中 OpenSanctions ${_sanc.count} 实体库：${personHits[0].entity.name}（${personHits[0].mode}）——红色预警，人工复核`,
        action: '红色预警，立即人工复核（同名消歧：核对出生日期/职务/国籍）' });
    }
    /* H02 过境国执法引渡风险 × 技术敏感（三维矩阵：通道×立场×先例，取代旧二元名单） */
    const tech = _techSens(person.tech_field);
    if (transitProbe && transitProbe.tier === 'high' && tech.score >= 60) {
      detail.hardRules.push({ id: 'H02', name: '过境国执法引渡风险 × 技术敏感', hit: true,
        detail: `过境「${trip.transit_country}」执法矩阵 ${transitProbe.score} 分（${transitProbe.usCN}；${transitProbe.relCN}${transitProbe.precCN ? '；先例：' + transitProbe.precCN : ''}）× 技术方向「${tech.field}」（敏感度 ${tech.score} ≥ 60）`,
        action: '红色预警，强制改签评估（建议直飞或更换中/低档过境点）' });
    }
    /* H03 过境管辖接触（#788 P0 重构）：高风险法域 × 落地/过夜才构成硬规则；
     * 空侧中转不入境不触发（旧版"停留≥4h 即红"把孟晚舟案的致命点抽象成了纯时长，
     * 既误伤温哥华机场空侧直转，也漏掉低风险法域的长时间中转）。停留时长降为 D4 加权项 */
    if (transitProbe && trip.transit_country && !trip.direct_flight && transitProbe.tier === 'high' && entryMode !== 'airside') {
      detail.hardRules.push({ id: 'H03', name: '过境管辖接触（高风险法域 × 落地/过夜）', hit: true,
        detail: `过境「${trip.transit_country}」（矩阵 ${transitProbe.score} 分·${matrix.TIER_CN[transitProbe.tier]}档）× ${ENTRY_CN[entryMode]}${Number(trip.transit_hours || 0) ? `（停留 ${trip.transit_hours}h，时长为加权项非触发项）` : ''}——离开空侧即落入过境国管辖`,
        action: '红色预警：改空侧中转或直飞；确需入境的按红线预案（法务+安保随行+领事预沟通）' });
    }
    /* H04 拆两级（#788 P0）：
     *   T 级（点名执法）＝ 企业/人名 ∩ 强制措施动词（羁押/逮捕/起诉/引渡…）→ 硬规则；
     *   A 级（环境执法）＝ 仅制裁/调查/管制类环境事件 → 不触发硬规则，只进 D5 */
    const caseHits = env.cases || [];
    const tHits = caseHits.filter(c => TARGET_VERB_RE.test(c.t) || TARGET_VERB_RE_ZH.test(c.t));
    const aHits = caseHits.filter(c => !tHits.includes(c));
    if (tHits.length) {
      detail.hardRules.push({ id: 'H04', name: '在途点名执法案件（T 级·强制措施）', hit: true,
        detail: `近 90 天目的/过境国命中 ${tHits.length} 条涉「${org || person.name || person.tech_field}」点名强制措施（如：${tHits[0].t.slice(0, 60)}）`,
        action: '红色预警，预案待命（法务联络清单 + 领事保护预沟通）' });
    }
    const hrNames = ['H01', 'H02', 'H03', 'H04'];
    for (const id of hrNames) if (!detail.hardRules.find(h => h.id === id)) {
      const def = { H01: '制裁/实体清单命中（人员）', H02: '过境国执法引渡风险 × 技术敏感', H03: '过境管辖接触（高风险法域 × 落地/过夜）', H04: '在途点名执法案件（T 级·强制措施）' }[id];
      detail.hardRules.push({ id, name: def, hit: false, detail: '未命中', action: null });
    }

    /* ===== D1 人员暴露度 22%（#788 P1：接入公开曝光层级 + 既往摩擦记录） ===== */
    const tl = _titleLevelOf(person.title, person.title_level);
    const EXPO_CN = { core: '核心级（峰会/签约唯一代表）', high: '高（涉密岗/名单关注对象）', normal: '常规' };
    const expo = ['core', 'high', 'normal'].includes(person.exposure_level) ? person.exposure_level : 'normal';
    const expoPts = { core: 90, high: 70, normal: 40 }[expo];
    const fricPts = _clamp((String(person.visa_incidents || '').trim() ? 60 : 0) + (String(person.inspection_history || '').trim() ? 40 : 0));
    const d1Items = [
      { label: `职务层级 ${TITLE_CN[tl]}`, pts: TITLE_SCORE[tl], src: '台账录入（说明书 4.4 职务层级分）' }
    ];
    let orgRiskPts = 30, orgRiskLabel = '无公开名单关联';
    if (orgHits.length) { orgRiskPts = 100; orgRiskLabel = `所属企业「${org}」命中制裁名单（${orgHits[0].entity.name}）`; }
    else if (tHits.length) { orgRiskPts = 60; orgRiskLabel = `所属企业近 90 天有点名执法事件（${tHits.length} 条）`; }
    d1Items.push({ label: orgRiskLabel, pts: orgRiskPts, src: orgHits.length ? 'OpenSanctions 名单库' : 'intel_data 90 天池' });
    d1Items.push({ label: `公开曝光层级（${EXPO_CN[expo]}）`, pts: expoPts, src: '台账录入' });
    if (fricPts > 0) d1Items.push({ label: '既往摩擦记录（签证受限/口岸盘查史）', pts: fricPts, src: '台账录入' });
    const d1 = _clamp(TITLE_SCORE[tl] * 0.45 + orgRiskPts * 0.3 + expoPts * 0.15 + fricPts * 0.1);
    detail.dims.d1 = { cn: '人员暴露度', weight: 0.22, score: d1, items: d1Items };

    /* ===== D2 目的地/过境国 20%（#788 P0：矩阵三维口径，取代二元名单） ===== */
    const destStat = env.byCountry[dest] || { total: 0, ro: 0, enforce: 0 };
    const alertPts = _clamp(destStat.ro * 12);
    const enforceBias = FIVE_EYES.has(dest) ? 90 : (destProbe.tier === 'high' ? 70 : destProbe.tier === 'mid' ? 50 : 30);
    const transitActive = trip.transit_country && !trip.direct_flight;
    const treatyPts = transitActive ? _clamp(Math.max(transitProbe.score, transitProbe.tier === 'high' ? 80 : 0)) : (destProbe.tier === 'high' ? 75 : 30);
    const d2 = _clamp(alertPts * 0.4 + enforceBias * 0.35 + treatyPts * 0.25);
    detail.dims.d2 = { cn: '目的地/过境国', weight: 0.20, score: d2, items: [
      { label: `目的地近 90 天红橙事件 ${destStat.ro} 条（池 ${destStat.total} 条）`, pts: alertPts, src: 'intel_data 实时池' },
      { label: `涉华执法倾向（${FIVE_EYES.has(dest) ? '五眼区' : '执法矩阵·' + matrix.TIER_CN[destProbe.tier] + '档'}）`, pts: enforceBias, src: 'country-enforce-matrix（通道×立场×先例）' },
      { label: transitActive ? `过境「${trip.transit_country}」矩阵 ${transitProbe.score} 分（${matrix.TIER_CN[transitProbe.tier]}档）` : '无过境（直飞）', pts: treatyPts, src: 'country-enforce-matrix' }
    ] };

    /* ===== D3 行业技术敏感度 20%（#788 P0：dirSensPts 由头衔强绑改为技术方向驱动——
     * 旧版 CFO 也按 40 分"非核心敏感岗"计、CTO 无论研究什么都按 80 计，归因错位） ===== */
    const entListPts = orgHits.length ? 100 : 30;
    const dirSensPts = tech.score >= 80 ? 90 : tech.score >= 60 ? 70 : tech.score >= 40 ? 45 : 25;
    const d3 = _clamp(tech.score * 0.5 + entListPts * 0.3 + dirSensPts * 0.2);
    detail.dims.d3 = { cn: '行业技术敏感度', weight: 0.20, score: d3, items: [
      { label: `技术方向「${tech.field}」敏感度`, pts: tech.score, src: '规则库（ECCN/实体清单领域口径）' },
      { label: orgHits.length ? `企业命中实体清单（${orgHits[0].entity.name}）` : '企业未命中名单', pts: entListPts, src: 'OpenSanctions 名单库' },
      { label: `${TITLE_CN[tl]}·${tech.score >= 60 ? '直接接触敏感技术方向' : '非核心敏感技术方向'}`, pts: dirSensPts, src: '技术方向驱动（取代旧版头衔强绑）' }
    ] };

    /* ===== D4 行程脆弱点 14%（#788 P0：过境方式为主因子，停留时长降为纯加权） ===== */
    let d4Items = [], d4;
    if (trip.direct_flight || !trip.transit_country) {
      d4 = 30;
      d4Items = [
        { label: '直飞（无第三国过境）', pts: 30, src: '台账录入' },
        { label: '直飞本维置 30（说明书 4.4 口径）', pts: 30, src: '规则库' }
      ];
    } else {
      const th = Number(trip.transit_hours || 0);
      const entryPts = { airside: 25, landside: 65, overnight: 95 }[entryMode];
      const stayPts = th >= 8 ? 90 : th >= 4 ? 70 : th >= 2 ? 50 : 30;
      const visaPts = transitProbe.tier === 'high' ? 85 : transitProbe.tier === 'mid' ? 55 : 35;
      const nightPts = trip.night_flight ? 80 : 40;
      d4 = _clamp(entryPts * 0.4 + stayPts * 0.25 + visaPts * 0.2 + nightPts * 0.15);
      d4Items = [
        { label: `过境方式（${ENTRY_CN[entryMode]}）`, pts: entryPts, src: '台账录入' },
        { label: `过境停留 ${th}h（加权项，不再单独触发硬规则）`, pts: stayPts, src: '台账录入' },
        { label: `过境签/管制风险（${trip.transit_country}）`, pts: visaPts, src: 'country-enforce-matrix' },
        { label: trip.night_flight ? '夜间航班（处置窗口受限）' : '日间航班', pts: nightPts, src: '台账录入' }
      ];
    }
    detail.dims.d4 = { cn: '行程脆弱点', weight: 0.14, score: d4, items: d4Items };

    /* ===== D5 司法执法动态 14%（#788 P0：actPts 对数归一——
     * 旧版 enforceTotal×10 线性在美加 1.1 万条池下恒饱和 100 分，分位数失效；
     * 对数刻度 log10(1+n)×33：n=10→33，n=100→66，n=1000→99，剂量响应可辨） ===== */
    const casePts = tHits.length ? 100 : aHits.length ? 65 : 30;
    const actPts = _clamp(Math.round(Math.log10(1 + (env.enforceTotal || 0)) * 33));
    const corrPts = orgHits.length || tHits.length ? 100 : aHits.length ? 65 : 30;
    const d5 = _clamp(casePts * 0.5 + actPts * 0.35 + corrPts * 0.15);
    detail.dims.d5 = { cn: '司法执法动态', weight: 0.14, score: d5, items: [
      { label: tHits.length ? `点名强制措施 ${tHits.length} 条（如：${tHits[0].t.slice(0, 40)}…）` : aHits.length ? `环境执法事件 ${aHits.length} 条（非点名，不计硬规则）` : '在途案件无直接命中', pts: casePts, src: 'intel_data 90 天池' },
      { label: `目的/过境国近 90 天执法活跃 ${env.enforceTotal} 条（对数归一）`, pts: actPts, src: 'intel_data 90 天池' },
      { label: corrPts >= 100 ? '与本方企业/技术高相关' : corrPts >= 65 ? '与本方企业弱相关（环境级）' : '相关性一般', pts: corrPts, src: '综合比对' }
    ] };

    /* ===== D6 信息安全 10%（#788 P0：废除 cloudPts=50 常量——
     * 改为「通信环境 × 会议级别 × 设备策略」三因子可解释合成；
     * #788 P1：接入人员设备策略 device_policy） ===== */
    const meetPts = { core: 90, internal: 60, public: 30 }[trip.meeting_level || 'internal'] || 60;
    const commPts = FIVE_EYES.has(dest) ? 90 : (trip.transit_country && FIVE_EYES.has(trip.transit_country)) ? 70 : 40;
    const dp = ['clean', 'standard', 'unmanaged'].includes(person.device_policy) ? person.device_policy : 'standard';
    const DP_CN = { clean: '专用差旅清洁机', standard: '常规公司设备', unmanaged: '无管控（个人机/未登记）' };
    const cloudPts = _clamp((FIVE_EYES.has(dest) || FIVE_EYES.has(trip.transit_country) ? 70 : 30)
      + (trip.meeting_level === 'core' ? 20 : 10)
      + { clean: -10, standard: 0, unmanaged: 15 }[dp]);
    const d6 = _clamp(meetPts * 0.5 + commPts * 0.35 + cloudPts * 0.15);
    detail.dims.d6 = { cn: '信息安全', weight: 0.10, score: d6, items: [
      { label: `会议敏感级别（${{ core: '核心机密', internal: '内部', public: '公开' }[trip.meeting_level || 'internal']}）`, pts: meetPts, src: '台账录入' },
      { label: FIVE_EYES.has(dest) ? '目的地属五眼区（通信截获高发）' : '常规通信环境', pts: commPts, src: '规则库' },
      { label: `云/数据暴露（${DP_CN[dp]} × ${{ core: '核心机密', internal: '内部', public: '公开' }[trip.meeting_level || 'internal']}会议）`, pts: cloudPts, src: '三因子合成（取代旧版 50 分常量）' }
    ] };

    /* ===== 综合 ===== */
    let score = 0;
    for (const d of DIM_WEIGHTS) score += d.w * detail.dims[d.k].score;
    score = Math.round(score);
    const hardHit = detail.hardRules.some(h => h.hit);
    const level = hardHit || score >= 75 ? 'red' : score >= 55 ? 'yellow' : 'green';

    /* ===== #788 P1：后果分层（风险若兑现，最可能的后果谱——领导要的不是分数，是"会出什么事"） ===== */
    const outcomes = [];
    if (transitProbe && transitProbe.tier === 'high' && tech.score >= 60)
      outcomes.push({ cn: '第三国拘押/引渡程序', likelihood: '高', basis: 'H02：高档过境点 × 技术敏感（孟晚舟式）' });
    if (tHits.length)
      outcomes.push({ cn: '本地刑事程序（传唤/起诉/搜查/羁押）', likelihood: '高', basis: `H04-T：${tHits.length} 条点名强制措施事件` });
    if (orgHits.length)
      outcomes.push({ cn: '制裁连带（银行冻结/交易拒绝/合作方切割）', likelihood: '高', basis: 'H01/D1：企业命中名单' });
    if (personHits.length)
      outcomes.push({ cn: '入境拒绝/原机遣返', likelihood: '中', basis: 'D1：人员名单命中' });
    if (FIVE_EYES.has(dest) || (trip.transit_country && FIVE_EYES.has(trip.transit_country)))
      outcomes.push({ cn: '电子设备盘查/数据提取', likelihood: '中', basis: 'D6：五眼法域边境搜查惯例' });
    const transitStat = env.byCountry[trip.transit_country || ''] || { ro: 0 };
    if (destStat.ro > 0 || transitStat.ro > 0)
      outcomes.push({ cn: '行程中断（突发治安/武装/骚乱事件）', likelihood: (destStat.ro + transitStat.ro) >= 5 ? '中' : '低', basis: `D2：90 天池红橙事件 ${destStat.ro + transitStat.ro} 条` });
    if (!outcomes.length)
      outcomes.push({ cn: '常规差旅（无特殊后果预期）', likelihood: '低', basis: '各维无高危命中' });

    return {
      score, level, hardHit,
      levelAction: LEVELS[level].action,
      dims: detail.dims, hardRules: detail.hardRules, outcomes,
      matrix: {
        dest: destProbe ? { country: destProbe.country, tier: destProbe.tier, score: destProbe.score, known: destProbe.known } : null,
        transit: transitProbe ? { country: transitProbe.country, tier: transitProbe.tier, score: transitProbe.score, known: transitProbe.known, note: transitProbe.note || null } : null,
        entryMode, entryModeCN: ENTRY_CN[entryMode]
      },
      sancEntities: _sanc.count, sancUpdated: _sanc.lastUpdated,
      scannedAt: new Date().toISOString()
    };
  }

  /* ---------- GET /rules：规则库文档（前端规则说明面板直出） ---------- */
  router.get('/rules', (req, res) => {
    _loadSanctions();   /* 懒加载触发：否则 count 恒 0 */
    res.json({
      ok: true,
      version: 'v3-20260913 (#788 整改)',
      hardRules: [
        { id: 'H01', name: '制裁/实体清单命中（人员）', cond: '人员姓名/拼音对 OpenSanctions 匹配', action: '红色·人工复核（防同名误伤：核对生日/职务/国籍）' },
        { id: 'H02', name: '过境国执法引渡风险 × 技术敏感', cond: '过境国 ∈ 执法矩阵高档（对美引渡通道 × 对华执法立场 × 拘押先例三维）∩ 技术敏感度 ≥ 60', action: '红色·强制改签评估' },
        { id: 'H03', name: '过境管辖接触（高风险法域 × 落地/过夜）', cond: '过境国 ∈ 矩阵高档 ∩ 过境方式为落地入境/入境过夜（空侧中转不入境不触发）；停留时长为加权项非触发项', action: '红色·改空侧中转或直飞；确需入境按红线预案' },
        { id: 'H04', name: '在途点名执法案件（T 级·强制措施）', cond: '近 90 天目的/过境国命中涉本企业/人员的点名强制措施（羁押/逮捕/起诉/引渡/搜查）；环境类（制裁/调查/管制）为 A 级只进 D5 不触发硬规则', action: '红色·预案待命' }
      ],
      dims: DIM_WEIGHTS,
      levels: Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, { cn: v.cn, min: v.min, action: v.action }])),
      matrix: { meta: matrix.meta, highRisk: matrix.listByTier('high'), midRisk: matrix.listByTier('mid') },
      iso31030: {
        standard: 'ISO 31030:2020 旅行风险管理（Risk management — Guidance for organizations with traveling workforce）',
        mapping: [
          { clause: '6.2 政策与治理', ours: '分级处置动作（LEVELS.action：董事会级/公司级/部门级三层）' },
          { clause: '6.3.2 旅行风险评估', ours: '六维加权评分（D1-D6，每一分可下钻信源）' },
          { clause: '6.3.3 目的地风险评估', ours: 'D2 目的地/过境国（intel_data 90 天池 + country-enforce-matrix）' },
          { clause: '6.4 风险处置', ours: '硬规则 H01-H04 命中即红 + 强制改签评估/预案待命' },
          { clause: '6.5 沟通与咨询', ours: '红色预警四级响应 SOP（T+0 命中 → T+15min 复核 → T+30min 上报 → T+2h 处置）' },
          { clause: '7.1 监测与审查', ours: '未完成行程每日自动重扫（Δscore≥15 重预警）' },
          { clause: '8 事后评审', ours: '行程复盘回填（debrief）+ /backtest 案例回测' }
        ]
      },
      techSens: TECH_SENS, fiveEyes: Array.from(FIVE_EYES),
      mengNote: '孟晚舟式致命点 = H02 ∩ H03（高档过境点落地中转 + 技术敏感）：2018 温哥华落地过境即被拘押——「消除第三国过境」或「改空侧直转」是最快降险杠杆（说明书 5.3 敏感度分析）',
      sanc: { entities: _sanc.count, lastUpdated: _sanc.lastUpdated }
    });
  });

  /* ---------- 人员台账 CRUD ---------- */
  router.get('/people', async (req, res) => {
    try {
      await _schema();
      const { rows } = await q(`SELECT * FROM exec_people ORDER BY id DESC LIMIT 500`);
      res.json({ ok: true, items: rows.map(r => ({ ...r, title_level: r.title_level || _titleLevelOf(r.title) })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/people', async (req, res) => {
    try {
      await _schema();
      const b = req.body || {};
      if (!b.name || !b.name.trim()) return res.status(400).json({ ok: false, error: '姓名必填' });
      const tl = _titleLevelOf(b.title, b.title_level);
      const { rows } = await q(
        `INSERT INTO exec_people (name, pinyin, title, title_level, org, tech_field, passports, exposure_level, device_policy, visa_incidents, inspection_history, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [b.name.trim(), (b.pinyin || '').trim() || null, (b.title || '').trim() || null, tl,
         (b.org || '').trim() || null, (b.tech_field || '').trim() || null,
         (b.passports || '').trim() || null,
         ['core', 'high', 'normal'].includes(b.exposure_level) ? b.exposure_level : 'normal',
         ['clean', 'standard', 'unmanaged'].includes(b.device_policy) ? b.device_policy : 'standard',
         (b.visa_incidents || '').trim() || null, (b.inspection_history || '').trim() || null,
         (b.notes || '').trim() || null]);
      res.json({ ok: true, item: rows[0] });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.put('/people/:id', async (req, res) => {
    try {
      await _schema();
      const b = req.body || {};
      const { rows } = await q(
        `UPDATE exec_people SET name=COALESCE($2,name), pinyin=COALESCE($3,pinyin), title=COALESCE($4,title),
           title_level=COALESCE($5,title_level), org=COALESCE($6,org), tech_field=COALESCE($7,tech_field),
           passports=COALESCE($8,passports), exposure_level=COALESCE($9,exposure_level), device_policy=COALESCE($10,device_policy),
           visa_incidents=COALESCE($11,visa_incidents), inspection_history=COALESCE($12,inspection_history), notes=COALESCE($13,notes)
         WHERE id=$1 RETURNING *`,
        [Number(req.params.id), (b.name || '').trim() || null, (b.pinyin || '').trim() || null, (b.title || '').trim() || null,
         b.title_level ? _titleLevelOf(b.title, b.title_level) : null, (b.org || '').trim() || null,
         (b.tech_field || '').trim() || null,
         (b.passports || '').trim() || null,
         ['core', 'high', 'normal'].includes(b.exposure_level) ? b.exposure_level : null,
         ['clean', 'standard', 'unmanaged'].includes(b.device_policy) ? b.device_policy : null,
         (b.visa_incidents || '').trim() || null, (b.inspection_history || '').trim() || null,
         (b.notes || '').trim() || null]);
      if (!rows.length) return res.status(404).json({ ok: false, error: '人员不存在' });
      res.json({ ok: true, item: rows[0] });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.delete('/people/:id', async (req, res) => {
    try {
      await _schema();
      await q(`DELETE FROM exec_trips WHERE person_id=$1`, [Number(req.params.id)]);
      await q(`DELETE FROM exec_people WHERE id=$1`, [Number(req.params.id)]);
      res.json({ ok: true });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- 行程台账（提交即扫描） ---------- */
  const _dashCache = { at: 0, data: null };
  const _dashDirty = () => { _dashCache.at = 0; _dashCache.data = null; };   /* 写后失效：防 20s 内读到旧 KPI */

  router.get('/trips', async (req, res) => {
    try {
      await _schema();
      const { rows } = await q(
        `SELECT t.*, p.name AS person_name, p.title AS person_title, p.org AS person_org, p.tech_field AS person_tech
         FROM exec_trips t LEFT JOIN exec_people p ON p.id = t.person_id
         ORDER BY t.created_at DESC LIMIT 300`);
      res.json({ ok: true, items: rows.map(r => ({ ...r, risk: r.risk_detail || null })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/trips', async (req, res) => {
    try {
      await _schema();
      const b = req.body || {};
      if (!b.person_id) return res.status(400).json({ ok: false, error: '请选择出差人员' });
      if (!b.dest_country || !String(b.dest_country).trim()) return res.status(400).json({ ok: false, error: '目的地国家必填' });
      const { rows: pRows } = await q(`SELECT * FROM exec_people WHERE id=$1`, [Number(b.person_id)]);
      if (!pRows.length) return res.status(404).json({ ok: false, error: '人员不存在' });
      const trip = {
        dest_country: String(b.dest_country).trim(),
        transit_country: (b.transit_country || '').trim() || null,
        transit_hours: Number(b.transit_hours || 0),
        transit_entry: ['airside', 'landside', 'overnight'].includes(b.transit_entry) ? b.transit_entry : null,
        direct_flight: !!b.direct_flight,
        night_flight: !!b.night_flight,
        meeting_level: ['core', 'internal', 'public'].includes(b.meeting_level) ? b.meeting_level : 'internal'
      };
      const risk = await _scan(pRows[0], trip);
      const { rows } = await q(
        `INSERT INTO exec_trips (person_id, dest_country, dest_city, transit_country, transit_hours, transit_entry, dep_date, ret_date,
           direct_flight, night_flight, meeting_level, status, risk_score, risk_level, risk_detail, scan_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'submitted',$12,$13,$14,NOW()) RETURNING *`,
        [Number(b.person_id), trip.dest_country, (b.dest_city || '').trim() || null, trip.transit_country, trip.transit_hours, trip.transit_entry,
         (b.dep_date || '').trim() || null, (b.ret_date || '').trim() || null, trip.direct_flight, trip.night_flight,
         trip.meeting_level, risk.score, risk.level, JSON.stringify(risk)]);
      res.json({ ok: true, item: { ...rows[0], person_name: pRows[0].name, risk } });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/trips/:id/scan', async (req, res) => {
    try {
      await _schema();
      const { rows } = await q(
        `SELECT t.*, p.name, p.title, p.title_level, p.org, p.tech_field, p.pinyin,
                p.exposure_level, p.device_policy, p.visa_incidents, p.inspection_history
         FROM exec_trips t JOIN exec_people p ON p.id=t.person_id WHERE t.id=$1`, [Number(req.params.id)]);
      if (!rows.length) return res.status(404).json({ ok: false, error: '行程不存在' });
      const t = rows[0];
      const risk = await _scan(t, t);
      await q(`UPDATE exec_trips SET risk_score=$2, risk_level=$3, risk_detail=$4, scan_at=NOW() WHERE id=$1`,
        [t.id, risk.score, risk.level, JSON.stringify(risk)]);
      res.json({ ok: true, risk });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.put('/trips/:id', async (req, res) => {
    try {
      await _schema();
      const b = req.body || {};
      const allowed = ['submitted', 'confirmed', 'completed', 'cancelled'];
      if (b.status && !allowed.includes(b.status)) return res.status(400).json({ ok: false, error: '非法状态' });
      const { rows } = await q(
        `UPDATE exec_trips SET status=COALESCE($2,status), dep_date=COALESCE($3,dep_date), ret_date=COALESCE($4,ret_date)
         WHERE id=$1 RETURNING *`, [Number(req.params.id), b.status || null, (b.dep_date || '').trim() || null, (b.ret_date || '').trim() || null]);
      if (!rows.length) return res.status(404).json({ ok: false, error: '行程不存在' });
      res.json({ ok: true, item: rows[0] });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.delete('/trips/:id', async (req, res) => {
    try {
      await _schema();
      await q(`DELETE FROM exec_trips WHERE id=$1`, [Number(req.params.id)]);
      res.json({ ok: true });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #788 P2：行程复盘回填（闭环关键：预测 → 实际兑现 → 回测校准） ---------- */
  const DEBRIEF_CN = { smooth: '顺利无异常', questioned: '盘查/问询', incident: '安全事件', detained: '拘押/羁押', denied: '入境拒绝/遣返' };
  const DEBRIEF_ADVERSE = new Set(['questioned', 'incident', 'detained', 'denied']);
  router.put('/trips/:id/debrief', async (req, res) => {
    try {
      await _schema();
      const b = req.body || {};
      if (b.debrief_outcome && !DEBRIEF_CN[b.debrief_outcome]) return res.status(400).json({ ok: false, error: '非法复盘结果' });
      const { rows } = await q(
        `UPDATE exec_trips SET debrief_outcome=COALESCE($2,debrief_outcome), debrief_notes=COALESCE($3,debrief_notes),
           status=CASE WHEN debrief_outcome IS NOT NULL AND status NOT IN ('completed','cancelled') THEN 'completed' ELSE status END
         WHERE id=$1 RETURNING *`,
        [Number(req.params.id), b.debrief_outcome || null, (b.debrief_notes || '').trim() || null]);
      if (!rows.length) return res.status(404).json({ ok: false, error: '行程不存在' });
      res.json({ ok: true, item: rows[0] });
      _dashDirty();
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #788 P2：回测（规则引擎自检：静态基准案例 + 复盘台账命中率） ---------- */
  router.get('/backtest', async (req, res) => {
    try {
      await _schema();
      /* ① 静态基准案例校验（公开判例锚点，验证矩阵方向正确性——非模拟数据） */
      const bench = [];
      const hk = matrix.probe('中国香港'), tw = matrix.probe('中国台湾'), ca = matrix.probe('加拿大'), pl = matrix.probe('波兰');
      bench.push({ case: '香港 2020 后不得再判对美引渡高风险', expect: '非高档', actual: matrix.TIER_CN[hk.tier], pass: hk.tier !== 'high', note: hk.note || '' });
      bench.push({ case: '台湾地区无对美引渡条约', expect: '非高档', actual: matrix.TIER_CN[tw.tier], pass: tw.tier !== 'high', note: tw.note || '' });
      bench.push({ case: '加拿大（孟晚舟 2018）应判高档', expect: '高档', actual: matrix.TIER_CN[ca.tier], pass: ca.tier === 'high', note: ca.precCN || '' });
      bench.push({ case: '波兰（华为员工 2019）应判高档', expect: '高档', actual: matrix.TIER_CN[pl.tier], pass: pl.tier === 'high', note: pl.precCN || '' });

      /* ② 复盘台账命中率（真实运行数据） */
      const { rows } = await q(
        `SELECT risk_level, debrief_outcome, COUNT(*)::int AS n
         FROM exec_trips WHERE debrief_outcome IS NOT NULL GROUP BY risk_level, debrief_outcome`);
      const st = { tp: 0, fn: 0, over: 0, total: 0 };
      for (const r of rows) {
        const n = Number(r.n);
        st.total += n;
        if (DEBRIEF_ADVERSE.has(r.debrief_outcome)) {
          if (r.risk_level === 'red') st.tp += n;          /* 预警红 + 实际 adverse = 命中 */
          else if (r.risk_level === 'yellow') st.tp += Math.ceil(n / 2);  /* 黄色半命中 */
          else st.fn += n;                                  /* 绿色 + adverse = 漏报 */
        } else if (r.risk_level === 'red') st.over += n;    /* 预警红 + 顺利 = 过度预警 */
      }
      const hitRate = (st.tp + st.fn) ? Math.round(st.tp / (st.tp + st.fn) * 100) : null;
      res.json({
        ok: true,
        benchmark: bench, benchmarkPass: bench.filter(b => b.pass).length + '/' + bench.length,
        debrief: { ...st, hitRate: hitRate == null ? null : hitRate + '%',
          note: st.total === 0 ? '暂无复盘样本——行程归档时回填复盘结果后此处自动累计（ISO 31030 §8 事后评审）' : '基于真实复盘台账' }
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- 场景测算（不入台账：孟晚舟式规则引擎自检，默认参数前端可改） ---------- */
  router.post('/scenario', async (req, res) => {
    try {
      const b = req.body || {};
      const person = {
        name: b.name || '测算对象', pinyin: b.pinyin || '',
        title: b.title || '首席执行官', title_level: _titleLevelOf(b.title || '首席执行官'),
        org: b.org || '华为', tech_field: b.tech_field || '5G'
      };
      const trip = {
        dest_country: b.dest_country || '美国', transit_country: b.transit_country === undefined ? '加拿大' : (b.transit_country || null),
        transit_hours: Number(b.transit_hours == null ? 5 : b.transit_hours),
        direct_flight: !!b.direct_flight, night_flight: !!b.night_flight,
        meeting_level: b.meeting_level || 'internal'
      };
      const risk = await _scan(person, trip);
      res.json({ ok: true, scenario: { person, trip }, risk, note: '场景测算（规则引擎自检·孟晚舟式参数默认）——不入台账，非真实行程' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #788 P1：未完成行程每日自动重扫（ISO 31030 §7.1 监测与审查）
   * 规则：submitted/confirmed 状态且距上次扫描 ≥24h 的行程每 30 分钟窗口补扫一批；
   * Δ|score| ≥ 15 或等级翻转 → realert=true（前端红色重预警角标）+ 日志 */
  let _rescanTimer = null;
  function _startRescanLoop() {
    if (_rescanTimer) return;
    _rescanTimer = setInterval(async () => {
      try {
        await _schema();
        const { rows: due } = await q(
          `SELECT t.*, p.name, p.title, p.title_level, p.org, p.tech_field, p.pinyin,
                  p.exposure_level, p.device_policy, p.visa_incidents, p.inspection_history
           FROM exec_trips t JOIN exec_people p ON p.id = t.person_id
           WHERE t.status IN ('submitted','confirmed')
             AND (t.scan_at IS NULL OR t.scan_at < NOW() - INTERVAL '24 hours')
           ORDER BY t.scan_at NULLS FIRST LIMIT 20`);
        for (const t of due) {
          try {
            const prevScore = t.risk_score, prevLevel = t.risk_level;
            const risk = await _scan(t, t);
            const dScore = Math.abs(risk.score - (Number(prevScore) || 0));
            const flip = prevLevel && prevLevel !== risk.level;
            await q(`UPDATE exec_trips SET risk_score=$2, risk_level=$3, risk_detail=$4, scan_at=NOW(), realert=$5 WHERE id=$1`,
              [t.id, risk.score, risk.level, JSON.stringify(risk), !!(flip || dScore >= 15)]);
            if (flip || dScore >= 15)
              log(`重预警：行程 #${t.id}（${t.name}→${t.dest_country}）${prevLevel || '—'}${prevScore ?? ''} → ${risk.level}${risk.score}（Δ${risk.score - (Number(prevScore) || 0)}）`);
          } catch (e) { log('rescan trip #' + t.id + ' fail:', e.message); }
        }
        if (due.length) _dashDirty();
      } catch (e) { log('rescan loop fail:', e.message); }
    }, 30 * 60e3).unref?.();
    log('每日重扫调度已启动（30min 窗口补扫，24h 未扫行程优先，Δ≥15 重预警）');
  }

  /* ---------- 仪表盘 ---------- */
  router.get('/dashboard', async (req, res) => {
    try {
      await _schema();
      if (_dashCache.data && Date.now() - _dashCache.at < 20e3) return res.json(_dashCache.data);
      const { rows: people } = await q(`SELECT COUNT(*)::int AS n FROM exec_people`);
      const { rows: trips } = await q(
        `SELECT status, risk_level, COUNT(*)::int AS n FROM exec_trips GROUP BY status, risk_level`);
      const { rows: recent } = await q(
        `SELECT t.id, t.dest_country, t.transit_country, t.risk_level, t.risk_score, t.dep_date, t.status,
                p.name AS person_name, p.org AS person_org
         FROM exec_trips t LEFT JOIN exec_people p ON p.id=t.person_id
         WHERE t.risk_level='red' AND t.status NOT IN ('cancelled','completed')
         ORDER BY t.created_at DESC LIMIT 20`);
      const byLevel = { red: 0, yellow: 0, green: 0 };
      const byStatus = {};
      let total = 0;
      for (const r of trips) {
        total += Number(r.n);
        if (r.risk_level && byLevel[r.risk_level] != null) byLevel[r.risk_level] += Number(r.n);
        byStatus[r.status] = (byStatus[r.status] || 0) + Number(r.n);
      }
      /* #788 P1：组合风险（key-person concentration / 同期同向）
       * ① 同企业 ≥2 人同期（重叠日期）同向出行 → 共机/同时被拦风险；② 同企业打开中红色 ≥2 */
      let combos = [];
      try {
        const { rows: co } = await q(
          `SELECT p.org, t.dest_country,
                  COUNT(*)::int AS n,
                  STRING_AGG(DISTINCT p.name, '、') AS persons,
                  STRING_AGG(DISTINCT t.dep_date, '/') AS dates,
                  COUNT(*) FILTER (WHERE t.risk_level IN ('red','yellow'))::int AS hot
           FROM exec_trips t JOIN exec_people p ON p.id = t.person_id
           WHERE t.status IN ('submitted','confirmed') AND p.org IS NOT NULL AND p.org <> ''
           GROUP BY p.org, t.dest_country HAVING COUNT(*) >= 2
           ORDER BY hot DESC, n DESC LIMIT 8`);
        combos = co.map(r => ({
          org: r.org, dest: r.dest_country, n: Number(r.n), hot: Number(r.hot),
          persons: String(r.persons || '').slice(0, 80), dates: String(r.dates || '').slice(0, 40),
          kind: Number(r.n) >= 2 && Number(r.hot) >= 2 ? '高危' : '关注',
          note: Number(r.hot) >= 2
            ? `同企业 ${r.n} 人同期同向「${r.dest_country}」且 ${r.hot} 人红/黄预警——key-person concentration：建议错峰出行、评估同乘一架航班的人员集中度（单一事件或同时被拦将重创业务连续性）`
            : `同企业 ${r.n} 人同期同向「${r.dest_country}」——建议评估错峰与共机风险`
        }));
      } catch (e) { log('combos fail:', e.message); }
      const data = {
        ok: true, kpi: { people: Number(people[0].n), trips: total, byLevel, byStatus, redOpen: recent.length },
        redAlerts: recent, combos,
        mengNote: '孟晚舟事件（2018·温哥华）：过境第三国被拘押 × 出口管制 × 引渡请求——本系统 H02∩H03 硬规则的直接映射。事前预警可把「事后救火」前移为「改签评估」。',
        generatedAt: new Date().toLocaleString('zh-CN')
      };
      _dashCache.at = Date.now(); _dashCache.data = data;
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  _startRescanLoop();
  return router;
};
