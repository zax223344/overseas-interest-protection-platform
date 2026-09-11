/* ============================================================
 * server/ai-watch.js — AI 情报中枢 · 值班分析师（2026-09-08 #703 ②）
 * ================================================================
 * 用户指令 ②：「AI 模型利用率非常高，甚至是 AI 接管系统……电影级情报态势感知」。
 * 设计：AI 值班分析师 7×24 无人值守——每 20 分钟自动扫库（新入库红橙事件），
 *   复合价值评分选 TOP5 逐条即时研判（Kimi 大模型，参谋级快评），全部决策
 *   落 ai_watch_log 决策日志（可审计、可回放）；前端 AI 情报中枢面板实时呈现。
 * 铁律：零模拟——研判仅基于库内真实事件字段；LLM 失败跳过该条不写假日志；
 *   游标（cursor）持久化，重启不重扫。
 * 端点（router 挂 /api/aiwatch）：
 *   GET  /log?limit=50&kind=   决策日志（最新在前）
 *   GET  /status               值班状态（轮次/游标/研判产出/大模型成功率）
 *   POST /run                  手动触发一轮值班（管理动作）
 * 挂载：server.js require + app.use + aiWatch.start({...})。
 * ============================================================ */
'use strict';
const express = require('express');
const reportsEngine = require('./reports-engine');
const { CAMEO_JUNK_RE } = require('./enterprise-risk');   /* #703：GDELT 机翻模板句拒收（与涉企池同一道闸——垃圾情报不进研判线） */
const RL = require('./risk-level'); /* #724 P0-3：定级读取归一单一来源（level_norm 优先/severity 兜底/脏值回落 yellow）——与 terror/涉企/研判中心同源，杜绝功能区口径漂移 */

const ROUND_MS = 20 * 60 * 1000;      /* 值班节奏：20 分钟一轮 */
const TOP_N = 5;                       /* 每轮研判条数上限 */
const FORECAST_EVERY = 9;              /* 预测层：每 9 轮（≈3 小时）一次 7 天风险前瞻 */
const SITUATION_MIN = 3;               /* 态势层：近 24h 实时入库 <3 条时静默（宁缺毋假） */
const THEME_EVERY = 18;                /* #740-2 主题层：每 18 轮（≈6 小时）一次主题前瞻研判 */

/* ---------- #740-2 主题前瞻研判引擎（用户口径 2026-09-09：例如「美国关税重塑贸易背景下，
 * 中国电动汽车品牌在墨西哥取得进展」的政策与市场反噬风险——需要跨事件的主题级前瞻预测，
 * 而非仅国别/风险域维度）。主题簇 = 关键词正则 × 近 7 天真实库命中，命中量+涉华加权选 TOP，
 * 逐主题 LLM 前瞻研判（态势/预测/风险路径/触发），落 ai_theme_items + ai_watch_log。 ---------- */
const THEMES = [
  { key: 'ev', name: '中国车企出海与市场反噬', re: /电动汽车|电动车|比亚迪|奇瑞|吉利|长城汽车|中国车企|中国汽车|汽车工厂|汽车关税|新能源车/i },
  { key: 'tariff', name: '美国关税与贸易规则重塑', re: /关税|贸易战|301调查|232条款|加征|贸易壁垒|对等关税|贸易协定重塑|出口管制新规/i },
  { key: 'minerals', name: '关键矿产资源博弈', re: /锂矿|钴矿|铜矿|稀土|镍矿|铝土矿|锡矿|钨矿|铀矿|采矿权|矿业法|矿产协议|资源国有化/i },
  { key: 'choke', name: '红海航运与海上要道安全', re: /红海|胡塞|曼德海峡|苏伊士|巴拿马运河|霍尔木兹|马六甲|海盗|劫持商船|货轮遇袭|绕行/i },
  { key: 'bri', name: '一带一路走廊与中欧班列', re: /一带一路|中欧班列|经济走廊|CPEC|中巴经济走廊|跨里海|陆路走廊|瓜达尔|皎漂/i },
  { key: 'sanction', name: '制裁与长臂合规风险', re: /实体清单|制裁清单|SDN|金融制裁|二级制裁|长臂管辖|禁运|管制清单/i },
  { key: 'chinaAsset', name: '涉华人员与项目安全', re: /中国工人|中国工程师|中国公民|中国籍|中方人员|中资项目|中企员工|华人商铺|中国使馆|领事馆遇袭|孔子学院/i },
  { key: 'politics', name: '东道国政局与资源民族主义', re: /政变|军政府|政权更迭|罢免|弹劾|宵禁|紧急状态|资源民族主义|国有化|矿业禁令|外资审查/i }
];

/* #718 实时数据铁律（用户原话：「不能用旧数据，用近期的实时数据」）：
 * AI 中枢所有数据口径一律排除补采回灌（_sourceType='backfill'，collect_time=当下
 * 但事件是历史旧闻）与归档件（_archiveEvent）——AI 研判/态势/预测全部基于实时采集。
 * 追加事件时间闸：档案级通道（china_terror/gap_scheduler 等）event_date 为 2022-2025
 * 旧闻但 collect_time 近期，按事件日期 ISO 格式超 45 天即排除；非 ISO 脏值保留。 */
const FRESH = `COALESCE(data_json->>'_sourceType','') <> 'backfill' AND COALESCE(data_json->>'_archiveEvent','') <> 'true' AND (event_date IS NULL OR event_date !~ '^20\\d{2}-\\d{2}-\\d{2}' OR event_date >= to_char(NOW() - INTERVAL '45 days','YYYY-MM-DD'))`;

function aiWatch(ctx) {
  const q = ctx.query;
  const llmCall = (ctx.llm && ctx.llm.callMsg) || null;
  const router = express.Router();
  const S = {
    started: false, round: 0, cursor: 0,
    lastScanAt: null, lastError: null, busy: false,
    judged: 0, llmOk: 0, llmFail: 0, startedAt: new Date().toISOString(),
    situOk: 0, situFail: 0, fcOk: 0, fcFail: 0, lastEventAt: null, lastSituationAt: null, lastForecastAt: null,
    recentRounds: []   /* 最近若干轮摘要（内存态，状态页用） */
  };
  /* LLM 文本清洗（markdown 残留三连，与 reports-engine 同款） */
  const _clean = s => String(s).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();

  /* ---------- 建表 ---------- */
  async function ensureTables() {
    await q(`CREATE TABLE IF NOT EXISTS ai_watch_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      round INTEGER,
      kind VARCHAR(24),
      target TEXT,
      country VARCHAR(64),
      level VARCHAR(10),
      event_id BIGINT,
      content TEXT,
      llm_ok BOOLEAN DEFAULT FALSE
    )`, []);
    await q(`CREATE TABLE IF NOT EXISTS ai_watch_state (
      k VARCHAR(40) PRIMARY KEY, v TEXT
    )`, []);
    /* #721 结构化预测清单（每轮预测全量覆盖） */
    await q(`CREATE TABLE IF NOT EXISTS ai_forecast_items (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      round INTEGER,
      kind VARCHAR(12),
      name VARCHAR(64),
      direction VARCHAR(8),
      delta INTEGER,
      n7 INTEGER,
      p7 INTEGER,
      red7 INTEGER,
      china7 INTEGER,
      top_domain VARCHAR(48),
      confidence VARCHAR(4),
      horizon VARCHAR(8),
      trigger_txt TEXT,
      basis TEXT
    )`, []);
    try {
      await q(`CREATE INDEX IF NOT EXISTS idx_aifi_round ON ai_forecast_items (round)`, []);
    } catch (e) { /* 老库索引已存在等场景静默 */ }
    /* #721b LLM 细化研判（针对性态势/预测/触发 + 代表性事件 JSON） */
    try {
      await q(`ALTER TABLE ai_forecast_items ADD COLUMN IF NOT EXISTS detail TEXT`, []);
    } catch (e) { /* 静默 */ }
    /* #722 P0-2 预测基线改革：口径变化/冷启动徽章（环比基线不完整时前端亮牌示警） */
    try {
      await q(`ALTER TABLE ai_forecast_items ADD COLUMN IF NOT EXISTS basis_shift BOOLEAN DEFAULT FALSE`, []);
    } catch (e) { /* 静默 */ }
    /* #730 P1-3 预测对账：历史归档表。ai_forecast_items 每轮 DELETE 全量覆盖，
     * 历史轮次必须归档留底才能满 7 天回算对账（verify 三列：判定/实际值/对账时间）。 */
    await q(`CREATE TABLE IF NOT EXISTS ai_forecast_history (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      round INTEGER,
      kind VARCHAR(12),
      name VARCHAR(64),
      direction VARCHAR(8),
      delta INTEGER,
      n7 INTEGER,
      p7 INTEGER,
      red7 INTEGER,
      china7 INTEGER,
      top_domain VARCHAR(48),
      confidence VARCHAR(4),
      horizon VARCHAR(8),
      trigger_txt TEXT,
      basis TEXT,
      detail TEXT,
      basis_shift BOOLEAN DEFAULT FALSE,
      verify_status VARCHAR(12),
      verify_actual JSONB,
      verified_at TIMESTAMPTZ
    )`, []);
    try {
      await q(`CREATE INDEX IF NOT EXISTS idx_aifh_kn ON ai_forecast_history (kind, name, ts DESC)`, []);
      await q(`CREATE INDEX IF NOT EXISTS idx_aifh_verify ON ai_forecast_history (verify_status, ts)`, []);
    } catch (e) { /* 老库静默 */ }
    /* #740-2 主题前瞻研判清单（每轮主题层全量覆盖，与 forecast_items 同模式） */
    await q(`CREATE TABLE IF NOT EXISTS ai_theme_items (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      round INTEGER,
      tkey VARCHAR(32),
      name VARCHAR(64),
      n7 INTEGER, p7 INTEGER, china7 INTEGER, red7 INTEGER,
      countries TEXT,
      events TEXT,
      detail TEXT,
      llm_ok BOOLEAN DEFAULT FALSE
    )`, []);
  }
  async function loadState() {
    try {
      const { rows } = await q(`SELECT k, v FROM ai_watch_state WHERE k IN ('round','cursor')`, []);
      rows.forEach(r => {
        if (r.k === 'round') S.round = parseInt(r.v, 10) || 0;
        if (r.k === 'cursor') S.cursor = parseInt(r.v, 10) || 0;
      });
    } catch (e) { /* 表未建时静默，ensureTables 后再试 */ }
  }
  async function saveState(k, v) {
    await q(`INSERT INTO ai_watch_state (k, v) VALUES ($1, $2)
             ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [k, String(v)]);
  }
  async function insertLog(row) {
    await q(`INSERT INTO ai_watch_log (round, kind, target, country, level, event_id, content, llm_ok)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.round, row.kind, row.target, row.country || '', row.level || '', row.event_id || null, row.content, !!row.llm_ok]);
  }

  /* ---------- #711 ops 态势聚合（3 分钟缓存 + 8s 单查询超时兜底） ---------- */
  let _opsCache = { at: 0, data: null };
  let _opsRefreshing = false;
  function _t8(p) {
    return Promise.race([p, new Promise(r => setTimeout(() => r(null), 8000))]);
  }
  async function _computeOps() {
    const ops = { intake24h: 0, red24h: 0, orange24h: 0, china24h: 0, totalIntel: 0, alerts: 0, topCountries: [] };
    try {
      const r1 = await _t8(q(`SELECT COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE COALESCE(data_json->>'level_norm', lower(COALESCE(severity,''))) = 'red')::int AS red,
          COUNT(*) FILTER (WHERE COALESCE(data_json->>'level_norm', lower(COALESCE(severity,''))) = 'orange')::int AS orange,
          COUNT(*) FILTER (WHERE COALESCE(data_json->>'chinaRelated','') = 'true')::int AS china
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours' AND ${FRESH}`, []));
      if (r1 && r1.rows[0]) {
        ops.intake24h = r1.rows[0].n; ops.red24h = r1.rows[0].red;
        ops.orange24h = r1.rows[0].orange; ops.china24h = r1.rows[0].china;
      }
    } catch (e) { /* 静默 */ }
    try {
      const r2 = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry, COUNT(*)::int AS n
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '48 hours'
          AND COALESCE(audit_status,'approved') = 'approved' AND ${FRESH}
        GROUP BY 1 ORDER BY n DESC LIMIT 8`, []));
      if (r2) ops.topCountries = r2.rows.map(r => ({ country: r.ctry, n: r.n }));
    } catch (e) { /* 静默 */ }
    try {
      const r3 = await _t8(q(`SELECT
          (SELECT COUNT(*)::int FROM intel_data) AS total,
          (SELECT COALESCE(jsonb_array_length(data_json),0)::int FROM datahub_store WHERE collection = 'alerts') AS alerts`, []));
      if (r3 && r3.rows[0]) { ops.totalIntel = r3.rows[0].total; ops.alerts = r3.rows[0].alerts; }
    } catch (e) { /* 静默 */ }
    return ops;
  }

  /* ---------- #718 态势层：全局态势 AI 研判（每轮 1 次，实时口径聚合） ---------- */
  async function _situationAgg() {
    const a = { total24: 0, prev24: 0, red24: 0, orange24: 0, china24: 0, neg24: 0,
      topCountries: [], topTypes: [], evidence: [] };
    try {
      const r = await _t8(q(`SELECT
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours')::int AS t24,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '48 hours' AND collect_time < NOW() - INTERVAL '24 hours')::int AS p24,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours' AND COALESCE(data_json->>'level_norm', lower(COALESCE(severity,''))) = 'red')::int AS red,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours' AND COALESCE(data_json->>'level_norm', lower(COALESCE(severity,''))) = 'orange')::int AS orange,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours' AND data_json->>'chinaRelated' = 'true')::int AS cn,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours' AND data_json->>'_chinaNegative' = 'true')::int AS neg
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '48 hours' AND COALESCE(audit_status,'approved')='approved' AND ${FRESH}`, []));
      if (r && r.rows[0]) Object.assign(a, { total24: r.rows[0].t24, prev24: r.rows[0].p24, red24: r.rows[0].red, orange24: r.rows[0].orange, china24: r.rows[0].cn, neg24: r.rows[0].neg });
    } catch (e) { /* 静默 */ }
    try {
      const r = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry, COUNT(*)::int AS n
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
        GROUP BY 1 ORDER BY n DESC LIMIT 6`, []));
      if (r) a.topCountries = r.rows.map(x => x.ctry + '(' + x.n + ')');
    } catch (e) { /* 静默 */ }
    try {
      const r = await _t8(q(`SELECT data_type AS ct, COUNT(*)::int AS n
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours'
          AND COALESCE(audit_status,'approved')='approved' AND ${FRESH}
        GROUP BY 1 ORDER BY n DESC LIMIT 5`, []));
      if (r) a.topTypes = r.rows.map(x => x.ct + '(' + x.n + ')');
    } catch (e) { /* 静默 */ }
    try {
      const r = await _t8(q(`SELECT id, COALESCE(NULLIF(data_json->>'title_zh',''), title) AS t, country, severity, data_json
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
          AND (COALESCE(data_json->>'level_norm','') IN ('red','orange') OR lower(COALESCE(severity,'')) IN ('red','orange'))
        ORDER BY collect_time DESC LIMIT 6`, []));
      if (r) a.evidence = r.rows.map((x, i) => (i + 1) + '.[' + RL.assessLevel(x.data_json, x.severity) + '·' + (x.country || '') + '] ' + String(x.t || '').slice(0, 70));
    } catch (e) { /* 静默 */ }
    return a;
  }
  async function _situationRound(round) {
    if (!llmCall) return;
    try {
      const a = await _situationAgg();
      if (a.total24 < SITUATION_MIN) return;   /* 数据不足静默，宁缺毋假 */
      const pv = reportsEngine._test.pvKimi();
      const sys = '你是海外利益保护情报预警平台的 AI 值班参谋，每 20 分钟对全局情报态势做一次滚动研判（态势感知层）。输出四段，段首用「一、」「二、」「三、」「四、」：「一、态势判断与置信度」给一句总结论+置信度档位（高/中/低）及定档依据；「二、关键动向」点出 2-3 个最值得关注的动向（国别/类别异动，引用给定证据）；「三、涉华风险提示」单独评估涉华海外利益风险面变化；「四、建议关注」给出下一班（20 分钟）应盯住的方向。全文 200-350 字；所有数字必须来自给定统计，禁止编造；对比昨日同时段（前 24h 数据）判断升降。';
      const usr = '【实时口径统计（已排除历史补采回灌）】\n近24h入库：' + a.total24 + ' 条（前24h：' + a.prev24 + ' 条，环比 ' + (a.prev24 ? (a.total24 >= a.prev24 ? '+' : '') + Math.round((a.total24 - a.prev24) / a.prev24 * 100) + '%' : '—') + '）\n红级 ' + a.red24 + ' / 橙级 ' + a.orange24 + ' / 涉华 ' + a.china24 + ' / 涉华负面 ' + a.neg24 + '\n近24h国别TOP：' + (a.topCountries.join('、') || '—') + '\n近24h类别TOP：' + (a.topTypes.join('、') || '—') + '\n近24h红橙证据事件：\n' + (a.evidence.join('\n') || '（无红橙级事件）');
      const r2 = await llmCall(pv, sys, usr);
      if (r2 && r2.text && r2.text.length > 120) {
        await insertLog({ round, kind: 'situation', target: '全局态势研判', content: _clean(r2.text), llm_ok: true });
        S.situOk++; S.lastSituationAt = new Date().toISOString();
      }
    } catch (e) { S.situFail++; S.lastError = e.message; }
  }

  /* ---------- #718 预测层：7 天风险前瞻（每 FORECAST_EVERY 轮≈3h 一次） ---------- */
  async function _forecastAgg() {
    const a = { d7: 0, prev7: 0, topC: [], topT: [], chinaC: [], trend: [], ctry: [], doms: [], evByC: {}, evAll: [] };
    /* ---------- #722 P0-2 预测基线改革：源恒定子集（可比口径） ----------
     * 环比失真根因：新源上线/旧源断流（GDELT 限流、通道切换）会直接制造假 delta。
     * 修法：28 天窗内盘点逐源产出（fs=28天内首条，n7/p7 仍按 7 天对比窗 FILTER）——
     *   · 可比源 = 两窗口都有产出 且 对比窗开始(14天前)之前即已在产（前周基线完整）
     *   · 冷启动源 = 对比窗内中途上线（前周样本残缺/缺失）→ 不参与环比
     *   · 退出源 = 前周有产、本周断流 → 双向剔除（历史量不进基线）
     * 国别/风险域环比一律按可比源子集计算；全量数字仅作展示。 */
    try {
      const r = await _t8(q(`SELECT COALESCE(NULLIF(source,''),'未知源') AS src,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS n7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND collect_time < NOW() - INTERVAL '7 days')::int AS p7,
          MIN(collect_time) AS fs
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '28 days'
          AND COALESCE(audit_status,'approved')='approved' AND ${FRESH}
        GROUP BY 1`, []));
      if (r) {
        const CUT = Date.now() - 14 * 86400000;
        const src = { comparable: [], cold: [], gone: [], d7c: 0, p7c: 0 };
        r.rows.forEach(x => {
          const fsT = x.fs ? new Date(x.fs).getTime() : 0;
          const stable = fsT > 0 && fsT <= CUT;   /* 对比窗开始前即已在产 → 前周基线完整 */
          if (x.n7 > 0 && x.p7 > 0 && stable) { src.comparable.push(x.src); src.d7c += x.n7; src.p7c += x.p7; }
          else if (x.n7 > 0) src.cold.push(x.src);
          else if (x.p7 > 0) src.gone.push(x.src);
        });
        a.src = src;
      }
    } catch (e) { /* 源盘点失败回落全量口径 */ }
    try {
      const r = await _t8(q(`SELECT
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS d7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND collect_time < NOW() - INTERVAL '7 days')::int AS p7
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days' AND COALESCE(audit_status,'approved')='approved' AND ${FRESH}`, []));
      if (r && r.rows[0]) { a.d7 = r.rows[0].d7; a.prev7 = r.rows[0].p7; }
    } catch (e) { /* 静默 */ }
    /* 可比源子集的 国别×类别 产出（环比基线）；无可比源时跳过（全冷启动，环比全挂口径牌） */
    if (a.src && a.src.comparable.length) {
      try {
        const r = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry,
            COALESCE(data_json->>'category', data_type, '未分类') AS cat,
            COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS n7c,
            COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND collect_time < NOW() - INTERVAL '7 days')::int AS p7c
          FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days'
            AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
            AND COALESCE(NULLIF(source,''),'未知源') = ANY($1)
          GROUP BY 1,2`, [a.src.comparable]));
        if (r) {
          const byC = {}, byCat = {};
          r.rows.forEach(x => {
            const t = byC[x.ctry] = byC[x.ctry] || { n7c: 0, p7c: 0 };
            t.n7c += x.n7c; t.p7c += x.p7c;
            const u = byCat[x.cat] = byCat[x.cat] || { n7c: 0, p7c: 0 };
            u.n7c += x.n7c; u.p7c += x.p7c;
          });
          a.compCtry = byC; a.compCat = byCat;
        }
      } catch (e) { /* 静默 */ }
    }
    try {
      /* #721 国别结构化预测：红级/涉华/主导域一并发（清单装配的数据底座） */
      const r = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS n7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND collect_time < NOW() - INTERVAL '7 days')::int AS p7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days' AND COALESCE(data_json->>'level_norm','') = 'red')::int AS red7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days' AND data_json->>'chinaRelated' = 'true')::int AS china7
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
        GROUP BY 1 ORDER BY n7 DESC LIMIT 10`, []));
      if (r) {
        a.topC = r.rows.map(x => x.ctry + '(' + x.n7 + (x.p7 ? '，前周' + x.p7 : '') + ')');
        a.trend = r.rows.map(x => {
          const cp = (a.compCtry && a.compCtry[x.ctry]) || null;
          const n7c = cp ? cp.n7c : x.n7, p7c = cp ? cp.p7c : 0;   /* 无可比基线=零基线（冷启动），不回退残缺全量 */
          return { c: x.ctry, n7: x.n7, p7: x.p7, n7c, p7c, delta: p7c ? n7c - p7c : (x.p7 ? 0 : x.n7) };
        });
        a.ctry = r.rows.map(x => {
          const cp = (a.compCtry && a.compCtry[x.ctry]) || null;
          return { c: x.ctry, n7: x.n7, p7: x.p7, n7c: cp ? cp.n7c : null, p7c: cp ? cp.p7c : null, red7: x.red7, china7: x.china7 };
        });
      }
    } catch (e) { /* 静默 */ }
    try {
      /* #721 各国别主导风险域（近 7 天，用于触发条件模板） */
      const r = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry, COALESCE(data_json->>'category', data_type, '未分类') AS cat, COUNT(*)::int AS n
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
        GROUP BY 1,2 ORDER BY n DESC LIMIT 200`, []));
      if (r) {
        const byC = {};
        r.rows.forEach(x => { (byC[x.ctry] = byC[x.ctry] || []).push({ cat: x.cat, n: x.n }); });
        Object.keys(byC).forEach(c => byC[c].sort((x, y) => y.n - x.n));
        a.catByC = byC;
      }
    } catch (e) { /* 静默 */ }
    try {
      /* #721 风险域（行业口径）结构化：category 归并七域，7d vs prev7d */
      const r = await _t8(q(`SELECT COALESCE(data_json->>'category', data_type, '未分类') AS cat,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS n7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND collect_time < NOW() - INTERVAL '7 days')::int AS p7,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days' AND data_json->>'chinaRelated' = 'true')::int AS china7
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
        GROUP BY 1 ORDER BY n7 DESC LIMIT 40`, []));
      if (r) {
        const agg = {};
        r.rows.forEach(x => {
          const dom = _domOf(x.cat);
          const t = agg[dom] = agg[dom] || { dom, n7: 0, p7: 0, china7: 0, cats: {} };
          t.n7 += x.n7; t.p7 += x.p7; t.china7 += x.china7;
          t.cats[x.cat] = (t.cats[x.cat] || 0) + x.n7;
          const cc = (a.compCat && a.compCat[x.cat]) || null;   /* #722 可比口径并轨 */
          if (cc) { t.n7c = (t.n7c || 0) + cc.n7c; t.p7c = (t.p7c || 0) + cc.p7c; }
        });
        a.doms = Object.values(agg).map(t => {
          const cats = Object.keys(t.cats).sort((x, y) => t.cats[y] - t.cats[x]);
          return { dom: t.dom, n7: t.n7, p7: t.p7, n7c: t.n7c || null, p7c: t.p7c || null, china7: t.china7, topCat: cats[0] || '',
            catsStr: cats.slice(0, 4).map(c => c + '(' + t.cats[c] + ')').join('、') };
        }).sort((x, y) => y.n7 - x.n7);
      }
    } catch (e) { /* 静默 */ }
    try {
      const r = await _t8(q(`SELECT data_type AS ct,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS n7
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days'
          AND COALESCE(audit_status,'approved')='approved' AND ${FRESH}
        GROUP BY 1 ORDER BY n7 DESC LIMIT 6`, []));
      if (r) a.topT = r.rows.map(x => x.ct + '(' + x.n7 + ')');
    } catch (e) { /* 静默 */ }
    try {
      const r = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry, COUNT(*)::int AS n
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days'
          AND COALESCE(audit_status,'approved')='approved' AND data_json->>'chinaRelated' = 'true'
          AND COALESCE(country,'') <> '中国' AND ${FRESH}
        GROUP BY 1 ORDER BY n DESC LIMIT 6`, []));
      if (r) a.chinaC = r.rows.map(x => x.ctry + '(' + x.n + ')');
    } catch (e) { /* 静默 */ }
    /* #721b 各国代表性事件（红橙/涉华优先，近7天真实采集；LLM 细化的证据底座 + 前端展开明细） */
    try {
      const r = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry,
          COALESCE(NULLIF(data_json->>'title_zh',''), title) AS t,
          COALESCE(data_json->>'category', data_type, '未分类') AS cat,
          LOWER(COALESCE(data_json->>'level_norm', COALESCE(severity,''))) AS lv,
          COALESCE(data_json->>'chinaRelated','') AS cn,
          TO_CHAR(collect_time, 'MM-DD') AS d
        FROM intel_data
        WHERE collect_time >= NOW() - INTERVAL '7 days'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国'
          AND ${FRESH}
          AND (COALESCE(data_json->>'level_norm','') IN ('red','orange')
               OR LOWER(COALESCE(severity,'')) IN ('red','orange')
               OR data_json->>'chinaRelated' = 'true')
        ORDER BY CASE WHEN LOWER(COALESCE(data_json->>'level_norm', COALESCE(severity,'')))='red' THEN 0
                      WHEN LOWER(COALESCE(data_json->>'level_norm', COALESCE(severity,'')))='orange' THEN 1 ELSE 2 END,
                 collect_time DESC
        LIMIT 400`, []));
      if (r) {
        a.evAll = r.rows.map(x => ({ c: x.ctry, t: String(x.t || '').slice(0, 110), cat: x.cat, lv: x.lv, cn: x.cn, d: x.d }));
        a.evAll.forEach(e => {
          (a.evByC[e.c] = a.evByC[e.c] || []).push(e);
          if (a.evByC[e.c].length > 6) a.evByC[e.c].length = 6;   /* 每国 6 条封顶 */
        });
      }
    } catch (e) { /* 静默 */ }
    return a;
  }

  /* #721 结构化预测清单装配（真实数字可解释，零 LLM 依赖）：
   * 国别/风险域各一条——方向（7d vs prev7d）、置信度（样本量）、触发条件（主导域模板）。 */
  const TRIG_TPL = {
    '恐怖主义与治安': '该国恐袭/治安事件持续或升级，或出现针对外籍人员与项目驻地的定向动向',
    '武装冲突与军事': '交火/空袭频次维持高位，战线或冲突区向中资项目所在区域逼近',
    '制裁合规与出口管制': '制裁清单扩容、出口管制新规落地或执法行动加码',
    '政治与社会稳定': '抗议/罢工升级，或选举、换届等政局节点出现异动',
    '经济金融风险': '汇率急贬、通胀恶化或外资管制措施加码',
    '设施安全与自然灾害': '基础设施中断事件多发，或进入灾害高发季',
    '网络与间谍活动': '针对中资机构网络攻击/间谍案曝光频次上升',
    '其他风险域': '事件量超周基线 50% 即视为预测验证'
  };
  /* #721 七域归并映射（模块级共享：风险域聚合 + 国别主导域归并同一套口径） */
  const DOM_MAP = [
    [/恐|治安|绑架|袭击/, '恐怖主义与治安'],
    [/武装冲突|军事|空袭|交火|drone|无人机|导弹|战争/, '武装冲突与军事'],
    [/制裁|合规|管制|清单|出口/, '制裁合规与出口管制'],
    [/政权|选举|动荡|暴乱|抗议|政变|政策|地缘|外交|国际关系/, '政治与社会稳定'],
    [/经济|金融|汇率|通胀|市场|债务/, '经济金融风险'],
    [/基础设施|停电|断网|事故|灾害|地震|洪水|环境/, '设施安全与自然灾害'],
    [/网络|数据|间谍|情报|渗透/, '网络与间谍活动']
  ];
  function _domOf(cat) {
    cat = String(cat || '');
    for (const iv of DOM_MAP) { if (iv[0].test(cat)) return iv[1]; }
    return '其他风险域';
  }
  /* #722 P0-2 可比口径环比：delta/direction 一律用源恒定子集（n7c/p7c）；
   * 无可比基线（源中途上线/断流、或全库冷启动）时 pb=0——绝不拿残缺全量基线当真：
   * 前周有量但可比源零覆盖 → 冷启动（方向不判定）；可比基线覆盖前周不足半数 → 口径变化徽章+置信度降档。 */
  function _fcBasis(n7, p7, n7c, p7c) {
    const hasCmp = n7c != null;        /* 该国/域有可比源基线数据 */
    const nb = hasCmp ? n7c : n7;      /* 可比近7（无可比源时展示全量） */
    const pb = hasCmp ? p7c : 0;       /* 可比前周（无可比源 → 零基线，不回退残缺全量） */
    const cold = p7 > 0 && pb === 0;                       /* 前周有量但无可比源 → 冷启动 */
    const cov = p7 > 0 && hasCmp ? pb / p7 : 1;            /* 可比基线对前周全量的覆盖率 */
    const shift = hasCmp && p7 >= 5 && cov < 0.5 && !cold; /* 覆盖不足半数 → 口径变化 */
    let delta;
    if (pb > 0) delta = Math.round((nb - pb) / pb * 100);
    else if (cold) delta = 0;          /* 无基线不判向 */
    else delta = n7 >= 5 ? 100 : 0;    /* 前周真无样本 → 新兴势头 */
    const dir = (delta >= 30 && pb > 0 && !cold) ? 'up' : (delta <= -30 && pb >= 5 && !cold) ? 'down' : 'flat';
    return { nb, pb, cold, shift, cov, delta, dir };
  }
  function _fcItems(a, miss3) {
    const items = [];
    (a.ctry || []).forEach(x => {
      const b = _fcBasis(x.n7, x.p7, x.n7c, x.p7c);
      const topDom = (a.catByC && a.catByC[x.c] && a.catByC[x.c][0]) ? a.catByC[x.c][0].cat : '';
      const domName = _domOf(topDom);   /* 直接对国别主导类别做七域归并 */
      if (x.n7 < 3 && x.red7 === 0) return;   /* 样本过小不上榜 */
      let conf = (x.n7 + x.red7 * 5) >= 40 ? '高' : (x.n7 >= 10 ? '中' : '低');
      if ((b.cold || b.shift) && conf !== '低') conf = conf === '高' ? '中' : '低';   /* 基线不可靠降一档 */
      const m3 = miss3 && miss3.has('country:' + x.c);   /* #730 连续 3 轮对账 miss 降档 */
      if (m3 && conf !== '低') conf = conf === '高' ? '中' : '低';
      let basis = '近7日 ' + x.n7 + ' 条' + (x.p7 ? ' vs 前周 ' + x.p7 + ' 条' : '（前周无样本）') + (x.red7 ? ' · 红级 ' + x.red7 : '') + (x.china7 ? ' · 涉华 ' + x.china7 : '');
      if (b.cold) basis += ' · 冷启动（前周无可比源基线，方向暂不判定）';
      else if (b.shift) basis += ' · 口径变化（可比基线覆盖前周 ' + Math.round(b.cov * 100) + '%）';
      else if (x.n7c != null && (x.n7c !== x.n7 || x.p7c !== x.p7)) basis += ' · 环比已剔除新上线/断流源';
      if (m3) basis += ' · 近3轮对账连续未命中，置信度降档';
      items.push({
        kind: 'country', name: x.c, direction: b.dir, delta: b.delta,
        n7: x.n7, p7: x.p7, red7: x.red7, china7: x.china7,
        topDomain: domName,
        confidence: conf,
        horizon: '7天',
        trigger: TRIG_TPL[domName] || TRIG_TPL['其他风险域'],
        basis: basis,
        basisShift: !!(b.cold || b.shift)
      });
    });
    (a.doms || []).slice(0, 7).forEach(d => {
      const b = _fcBasis(d.n7, d.p7, d.n7c, d.p7c);
      let conf = d.n7 >= 60 ? '高' : (d.n7 >= 15 ? '中' : '低');
      if ((b.cold || b.shift) && conf !== '低') conf = conf === '高' ? '中' : '低';
      const m3 = miss3 && miss3.has('domain:' + d.dom);   /* #730 连续 3 轮对账 miss 降档 */
      if (m3 && conf !== '低') conf = conf === '高' ? '中' : '低';
      let basis = '近7日 ' + d.n7 + ' 条' + (d.p7 ? ' vs 前周 ' + d.p7 + ' 条' : '（前周无样本）') + (d.china7 ? ' · 涉华 ' + d.china7 : '');
      if (b.cold) basis += ' · 冷启动（前周无可比源基线，方向暂不判定）';
      else if (b.shift) basis += ' · 口径变化（可比基线覆盖前周 ' + Math.round(b.cov * 100) + '%）';
      else if (d.n7c != null && (d.n7c !== d.n7 || d.p7c !== d.p7)) basis += ' · 环比已剔除新上线/断流源';
      if (m3) basis += ' · 近3轮对账连续未命中，置信度降档';
      items.push({
        kind: 'domain', name: d.dom, direction: b.dir, delta: b.delta,
        n7: d.n7, p7: d.p7, red7: 0, china7: d.china7,
        topDomain: d.topCat,
        confidence: conf,
        horizon: '7天',
        trigger: TRIG_TPL[d.dom] || TRIG_TPL['其他风险域'],
        basis: basis,
        basisShift: !!(b.cold || b.shift)
      });
    });
    return items;
  }
  /* ---------- #730 P1-3 预测对账：归档留底 + 满 7 天回算实际入库，方向命中判 hit/near/miss ---------- */
  /* 每轮装配前把旧 items 归档进 history（round+kind+name 去重防手动连击重复归档；留底 60 天滚动清理） */
  async function _fcArchive() {
    try {
      await q(`INSERT INTO ai_forecast_history (ts, round, kind, name, direction, delta, n7, p7, red7, china7, top_domain, confidence, horizon, trigger_txt, basis, detail, basis_shift)
        SELECT fi.ts, fi.round, fi.kind, fi.name, fi.direction, fi.delta, fi.n7, fi.p7, fi.red7, fi.china7, fi.top_domain, fi.confidence, fi.horizon, fi.trigger_txt, fi.basis, fi.detail, fi.basis_shift
        FROM ai_forecast_items fi
        WHERE NOT EXISTS (SELECT 1 FROM ai_forecast_history fh WHERE fh.round = fi.round AND fh.kind = fi.kind AND fh.name = fi.name)`, []);
      await q(`DELETE FROM ai_forecast_history WHERE ts < NOW() - INTERVAL '60 days'`, []);
    } catch (e) { /* 归档失败不阻断当轮装配 */ }
  }
  /* 连续 3 轮对账 miss 的 kind+name 集合（新轮装配置信度降一档） */
  async function _fcMissStreaks() {
    const set = new Set();
    try {
      const { rows } = await q(`SELECT kind, name, verify_status FROM (
          SELECT kind, name, verify_status, ROW_NUMBER() OVER (PARTITION BY kind, name ORDER BY ts DESC) AS rn
          FROM ai_forecast_history WHERE verify_status IS NOT NULL
        ) t WHERE rn <= 3`, []);
      const by = {};
      rows.forEach(r => { (by[r.kind + ':' + r.name] = by[r.kind + ':' + r.name] || []).push(r.verify_status); });
      Object.keys(by).forEach(k => {
        const v = by[k];
        if (v.length >= 3 && v.every(x => x === 'miss')) set.add(k);
      });
    } catch (e) { /* 空表静默 */ }
    return set;
  }
  /* 实际入库回算：预测窗 [ts, ts+7d]，与装配层同口径（approved + 非中国 + FRESH 排除补采/归档回灌） */
  async function _fcActualCount(kind, name, from, to) {
    if (kind === 'country') {
      const { rows } = await q(`SELECT COUNT(*)::int AS n FROM intel_data
        WHERE collect_time >= $1 AND collect_time < $2
          AND COALESCE(NULLIF(country,''),'国际') = $3
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}`,
        [from, to, name]);
      return rows[0] ? rows[0].n : 0;
    }
    const { rows } = await q(`SELECT COALESCE(data_json->>'category', data_type, '未分类') AS cat, COUNT(*)::int AS n
      FROM intel_data
      WHERE collect_time >= $1 AND collect_time < $2
        AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
      GROUP BY 1`, [from, to]);
    let n = 0;
    rows.forEach(r => { if (_domOf(r.cat) === name) n += r.n; });
    return n;
  }
  /* 对账任务：扫满 7 天未对账的历史行，逐条回算写回判定。
   * 判定口径与装配阈值对齐（±30%）：up→实际环比≥+30% hit / ≥+5% near / 其余 miss；
   * down 对称；flat→|环比|<30% hit（涨跌都没兑现=平稳预测正确）。 */
  let _fcVerifyBusy = false;
  async function _fcVerifySweep() {
    if (_fcVerifyBusy) return { ok: false, error: '上一轮对账尚未结束' };
    _fcVerifyBusy = true;
    let checked = 0, hits = 0, nears = 0, misses = 0;
    try {
      await ensureTables();
      const { rows } = await q(`SELECT id, ts, kind, name, direction, delta, n7 FROM ai_forecast_history
        WHERE verify_status IS NULL AND ts <= NOW() - INTERVAL '7 days' ORDER BY ts ASC LIMIT 120`, []);
      for (const r of rows) {
        try {
          const to = new Date(new Date(r.ts).getTime() + 7 * 86400000);
          const actual = await _fcActualCount(r.kind, r.name, r.ts, to);
          const base = Number(r.n7) || 0;
          const ad = base > 0 ? Math.round((actual - base) / base * 100) : (actual > 0 ? 100 : 0);
          let verdict;
          if (r.direction === 'up') verdict = ad >= 30 ? 'hit' : (ad >= 5 ? 'near' : 'miss');
          else if (r.direction === 'down') verdict = ad <= -30 ? 'hit' : (ad <= -5 ? 'near' : 'miss');
          else verdict = Math.abs(ad) < 30 ? 'hit' : 'miss';
          await q(`UPDATE ai_forecast_history SET verify_status = $2, verify_actual = $3, verified_at = NOW() WHERE id = $1`,
            [r.id, verdict, JSON.stringify({ a7: actual, n7_base: base, actual_delta: ad, direction: r.direction })]);
          checked++;
          if (verdict === 'hit') hits++; else if (verdict === 'near') nears++; else misses++;
        } catch (e) { /* 单条失败留空下轮再试 */ }
        if (checked > 0 && checked % 20 === 0) await new Promise(rs => setTimeout(rs, 300));
      }
      return { ok: true, checked, hits, nears, misses };
    } finally { _fcVerifyBusy = false; }
  }
  /* 每 kind+name 最近 4 条已对账判定 → 「近4轮命中 x/4」（前端角标数据源） */
  async function _fcHitStats() {
    const out = {};
    try {
      const { rows } = await q(`SELECT kind, name, verify_status FROM (
          SELECT kind, name, verify_status, ROW_NUMBER() OVER (PARTITION BY kind, name ORDER BY ts DESC) AS rn
          FROM ai_forecast_history WHERE verify_status IS NOT NULL
        ) t WHERE rn <= 4`, []);
      const by = {};
      rows.forEach(r => { (by[r.kind + ':' + r.name] = by[r.kind + ':' + r.name] || []).push(r.verify_status); });
      Object.keys(by).forEach(k => {
        const v = by[k];
        const h = v.filter(x => x === 'hit').length;
        out[k] = { hits: h, total: v.length, rate: Math.round(h / v.length * 100), last: v[0] };
      });
    } catch (e) { /* 空表静默 */ }
    return out;
  }
  /* ---------- #721b 逐国/逐域 LLM 细化：针对性态势/预测/触发条件（并发 3、单次 60s 超时、失败回落模板） ---------- */
  function _llm60(p) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_60s')), 60000))]);
  }
  async function _mapLimit(arr, n, fn) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) {
      out.push(...await Promise.all(arr.slice(i, i + n).map(fn)));
    }
    return out;
  }
  const FC_SYS_C = '你是海外利益保护情报预警平台的国别风险预测分析师，对指定国别做未来 7 天风险预测。基于给定的该国近 7 天真实事件统计与代表性事件，输出三段，段首分别用【态势】【预测】【触发】：【态势】该国当前具体局势与风险面，必须引用给定事件的具体细节（事件内容、指向对象、地点、时间），2-3 句；【预测】未来 7 天最可能的发展方向与具体风险点，点明风险类型与可能受影响的中资海外利益场景（项目/人员/供应链），2-3 句；【触发】2-3 条具体可观测的升级/验证信号，每条单独一行以「·」开头，必须紧扣该国真实事件脉络与其当前现实情况（如具体组织、地区、人物、行业），禁止适用于任何国家的通用套话。全文 220-350 字；只基于给定信息外推，样本不够处写「样本不足」；禁止编造事件、组织与数字。';
  const FC_SYS_D = '你是海外利益保护情报预警平台的行业/风险域预测分析师，对指定风险域做未来 7 天风险预测。基于给定该域近 7 天真实统计、细分主线与代表性事件，输出三段，段首分别用【态势】【预测】【触发】：【态势】该风险域当前态势与近 7 天异动（引用具体事件细节与国别分布），2-3 句；【预测】未来 7 天该域最可能的演化方向与具体风险点（点明高危国别×行业组合），2-3 句；【触发】2-3 条具体可观测的升级/验证信号，每条单独一行以「·」开头，必须引用该域真实事件脉络（具体制裁措施/冲突战线/组织动向等），禁止通用套话。全文 220-350 字；只基于给定信息外推，样本不够处写「样本不足」；禁止编造。';
  async function _fcDetail(a, items, pv) {
    const ctryItems = items.filter(x => x.kind === 'country').slice(0, 8);
    const domItems = items.filter(x => x.kind === 'domain').slice(0, 5);
    const evByC = a.evByC || {}, evAll = a.evAll || [];
    async function enrich(it) {
      try {
        let sys, usr, ev;
        const evStr = list => list.map((e, i) => (i + 1) + '. [' + e.d + '][' + (e.lv || '—') + ']' + (e.cn === 'true' ? '[涉华]' : '') + ' ' + e.t).join('\n');
        if (it.kind === 'country') {
          ev = (evByC[it.name] || []).slice(0, 5);
          sys = FC_SYS_C;
          usr = '国别：' + it.name + '\n近7天入库 ' + it.n7 + ' 条（前周 ' + it.p7 + ' 条，环比 ' + (it.delta >= 0 ? '+' : '') + it.delta + '%），红级 ' + it.red7 + ' 条，涉华 ' + it.china7 + ' 条\n主导风险域：' + it.topDomain + (it.basisShift ? '\n口径提示：该条环比基线不完整（新源冷启动/可比源覆盖不足），预测时弱化环比幅度、侧重绝对量与事件证据' : '') + '\n代表性事件（近7天真实采集，按风险度排序）：\n' + (evStr(ev) || '（无红橙/涉华级样本，仅常规采集）') + '\n请输出该国的针对性预测。';
        } else {
          ev = evAll.filter(e => _domOf(e.cat) === it.name).slice(0, 5);
          sys = FC_SYS_D;
          const byC = {}; ev.forEach(e => { byC[e.c] = (byC[e.c] || 0) + 1; });
          const cStr = Object.keys(byC).sort((x, y) => byC[y] - byC[x]).map(c => c + '(' + byC[c] + ')').join('、');
          usr = '风险域：' + it.name + '\n近7天 ' + it.n7 + ' 条（前周 ' + it.p7 + ' 条，环比 ' + (it.delta >= 0 ? '+' : '') + it.delta + '%），涉华 ' + it.china7 + ' 条\n细分主线：' + (it.catsStr || it.topDomain || '—') + (it.basisShift ? '\n口径提示：该条环比基线不完整（新源冷启动/可比源覆盖不足），预测时弱化环比幅度、侧重绝对量与事件证据' : '') + '\n代表性事件国别分布：' + (cStr || '—') + '\n代表性事件（近7天真实采集）：\n' + (evStr(ev) || '（无红橙/涉华级样本）') + '\n请输出该风险域的针对性预测。';
        }
        const r = await _llm60(llmCall(pv, sys, usr));
        if (!r || !r.text || r.text.length < 80) return;
        const txt = _clean(r.text);
        const m = txt.match(/【态势】([\s\S]*?)【预测】([\s\S]*?)【触发】([\s\S]*)/);
        const det = m ? { s: m[1].trim(), p: m[2].trim(), t: m[3].trim() } : { s: txt };
        det.llm = true;
        det.ev = ev.map(e => ({ d: e.d, lv: e.lv, cn: e.cn === 'true', t: e.t }));
        /* 触发条件升级为该国/该域针对性版本（替换通用模板） */
        const trig = (det.t || '').split(/\n+/).map(x => x.replace(/^[·\-—•\s]+/, '').trim()).filter(Boolean).join('；');
        await q(`UPDATE ai_forecast_items SET detail = $3, trigger_txt = $4 WHERE kind = $1 AND name = $2`,
          [it.kind, it.name, JSON.stringify(det), trig || it.trigger]);
      } catch (e) { /* 单条失败回落模板触发条件，detail 留空，下轮 3h 自动重试 */ }
    }
    await _mapLimit(ctryItems.concat(domItems), 3, enrich);
  }
  async function _forecastRound(round) {
    try {
      const a = await _forecastAgg();
      if (a.d7 < 10) return;   /* 数据不足静默 */
      /* #721 结构化预测清单落库（国别+风险域，规则装配真实数字，零 LLM 依赖——
       * 必须先于 llmCall 检查：LLM 不可达时清单照常产出，只有文字研判宁缺毋假）。
       * #730：装配前①拉连败集合（近3轮对账全 miss → 置信度降档）②旧轮归档 history 留底对账。 */
      const miss3 = await _fcMissStreaks();
      const items = _fcItems(a, miss3);
      if (items.length) {
        await _fcArchive();
        await q('DELETE FROM ai_forecast_items', []);
        for (const it of items.slice(0, 20)) {
          await q(`INSERT INTO ai_forecast_items(round, kind, name, direction, delta, n7, p7, red7, china7, top_domain, confidence, horizon, trigger_txt, basis, basis_shift)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [round, it.kind, it.name, it.direction, it.delta, it.n7, it.p7, it.red7, it.china7, it.topDomain, it.confidence, it.horizon, it.trigger, it.basis, !!it.basisShift]);
        }
      }
      if (!llmCall) return;
      const pv = reportsEngine._test.pvKimi();
      /* #721b 逐国/逐域 LLM 细化：针对性态势/预测/触发条件 + 代表性事件 → detail 列
       * （国别前 8 + 域前 5，并发 3；失败回落模板，下轮重试） */
      try {
        await _fcDetail(a, items, pv);
        S.lastForecastAt = new Date().toISOString();
      } catch (e) { S.fcFail++; S.lastError = e.message; }
      const sys = '你是海外利益保护情报预警平台的 AI 首席预测参谋，基于近 7 天与上一 7 天的真实采集统计对比，输出《未来 7 天海外利益风险预测》。输出三段，段首用「一、」「二、」「三、」：「一、趋势判断」按国别压力与类别异动给总体风险走向（上升/平稳/回落）及依据；「二、重点风险预测」必须对给定升温国别逐国给出未来 7 天预测（国别×主导风险域×方向），每条给「触发条件」（什么样的信号出现即为验证）；「三、建议关注」给监测侧的盯防重点（国别+风险域组合）。全文 250-450 字；只基于给定真实统计外推，不确定处写「样本不足」；禁止编造事件。';
      const ups = a.trend.filter(x => x.delta > 0 && x.n7 >= 5).sort((x, y) => y.delta - x.delta).slice(0, 5).map(x => x.c + '(+' + x.delta + ')').join('、');
      const downs = a.trend.filter(x => x.delta < 0 && x.p7 >= 5).sort((x, y) => x.delta - y.delta).slice(0, 3).map(x => x.c + '(' + x.delta + ')').join('、');
      const domStr = (a.doms || []).slice(0, 5).map(d => d.dom + '(' + d.n7 + (d.p7 ? '，前周' + d.p7 : '') + ')').join('、');
      /* #722 可比口径先行：环比判断一律以源恒定子集为准，新上线/退出源单独点名 */
      const srcNote = a.src ? ('可比口径（源恒定子集，已剔除新上线/退出源）：近7天 ' + a.src.d7c + ' 条 vs 前周 ' + a.src.p7c + ' 条；可比源 ' + a.src.comparable.length + ' 个'
        + (a.src.cold.length ? '，冷启动源 ' + a.src.cold.length + ' 个（' + a.src.cold.slice(0, 4).join('、') + '）' : '')
        + (a.src.gone.length ? '，退出源 ' + a.src.gone.length + ' 个（' + a.src.gone.slice(0, 4).join('、') + '）' : '') + '\n') : '';
      const usr = '【实时口径统计（已排除历史补采回灌）】\n' + srcNote + '全量口径：近7天总量 ' + a.d7 + ' 条（前7天 ' + a.prev7 + ' 条）\n近7天国别压力TOP10（含前周对比）：' + (a.topC.join('、') || '—') + '\n升温国别（按可比口径）：' + (ups || '—') + '\n降温国别（按可比口径）：' + (downs || '—') + '\n风险域分布（近7天 vs 前周）：' + (domStr || '—') + '\n近7天涉华事件国别分布：' + (a.chinaC.join('、') || '—');
      const r2 = await llmCall(pv, sys, usr);
      if (r2 && r2.text && r2.text.length > 150) {
        await insertLog({ round, kind: 'forecast', target: '未来7天风险预测', content: _clean(r2.text), llm_ok: true });
        S.fcOk++; S.lastForecastAt = new Date().toISOString();
      }
    } catch (e) { S.fcFail++; S.lastError = e.message; }
  }

  /* ---------- #740-2 主题层：主题前瞻研判（近 7 天真实库命中 → TOP 主题 → LLM 前瞻） ----------
   * 聚合口径与预测层一致（approved + FRESH 排除补采回灌；近 7 天 vs 前 7 天环比），
   * 主题命中按中文译题/原始标题正则匹配；代表事件红橙/涉华优先。 */
  async function _themeAgg() {
    const out = {};
    try {
      const { rows } = await q(`SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title) AS t,
          COALESCE(NULLIF(country,''),'国际') AS ctry,
          LOWER(COALESCE(data_json->>'level_norm', COALESCE(severity,''))) AS lv,
          COALESCE(data_json->>'chinaRelated','') AS cn,
          (collect_time >= NOW() - INTERVAL '7 days') AS is7,
          TO_CHAR(collect_time, 'MM-DD') AS d
        FROM intel_data
        WHERE collect_time >= NOW() - INTERVAL '14 days'
          AND COALESCE(audit_status,'approved')='approved' AND COALESCE(country,'') <> '中国' AND ${FRESH}
        ORDER BY id DESC LIMIT 6000`, []);
      for (const th of THEMES) {
        out[th.key] = { key: th.key, name: th.name, n7: 0, p7: 0, china7: 0, red7: 0, countries: {}, ev: [] };
      }
      rows.forEach(r => {
        const t = String(r.t || '');
        if (!t) return;
        for (const th of THEMES) {
          if (!th.re.test(t)) continue;
          const x = out[th.key];
          if (r.is7) x.n7++; else x.p7++;
          if (r.cn === 'true') x.china7++;
          if (r.lv === 'red') x.red7++;
          if (r.is7) {
            x.countries[r.ctry] = (x.countries[r.ctry] || 0) + 1;
            /* 代表事件：红橙/涉华优先，每主题最多 6 条 */
            if (x.ev.length < 6 && (r.lv === 'red' || r.lv === 'orange' || r.cn === 'true')) {
              x.ev.push({ d: r.d, lv: r.lv || '', cn: r.cn === 'true', c: r.ctry, t: t.slice(0, 110) });
            }
          }
        }
      });
      /* 主题排序权重：涉华加权 + 红级 + 量（跨主题选 TOP4 深研） */
      Object.values(out).forEach(x => {
        x.w = x.china7 * 2 + x.red7 * 2 + x.n7;
        x.topCountries = Object.entries(x.countries).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0] + '(' + e[1] + ')');
      });
    } catch (e) { /* 静默 */ }
    return out;
  }
  const THEME_SYS = '你是海外利益保护情报预警平台的主题前瞻分析师，对指定主题做未来 14 天前瞻研判（面向中资企业出海的安全与运营风险）。输出四段，段首分别用【态势】【预测】【风险路径】【触发】：【态势】该主题当前态势与近 7 天库内动向，必须引用给定真实事件的具体细节（国别、对象、时间）；【预测】未来 14 天该主题最可能的演化方向，点明对中资企业的政策与市场含义（如反噬、准入收紧、供应链扰动）；【风险路径】该主题风险向中资企业传导的具体路径（项目/人员/供应链/市场准入/合规），1-2 句；【触发】2-3 条可观测的验证或升级信号，每条单独一行以「·」开头，必须紧扣给定事件脉络，禁止通用套话。全文 250-400 字；只基于给定信息外推，样本不足处写「样本不足」；禁止编造事件、组织与数字。';
  async function _themeRound(round) {
    try {
      const agg = await _themeAgg();
      const hot = Object.values(agg).filter(x => x.n7 >= 4).sort((a, b) => b.w - a.w).slice(0, 4);
      if (!hot.length) return;   /* 无主题命中静默（宁缺毋假） */
      if (!llmCall) return;
      const pv = reportsEngine._test.pvKimi();
      const evStr = list => list.map((e, i) => (i + 1) + '. [' + e.d + '][' + (e.lv || '—') + ']' + (e.cn ? '[涉华]' : '') + '[' + e.c + '] ' + e.t).join('\n');
      async function enrich(th) {
        const item = { round, key: th.key, name: th.name, n7: th.n7, p7: th.p7, china7: th.china7, red7: th.red7, countries: th.topCountries.join('、'), events: th.ev, detail: null, llm_ok: false };
        try {
          const usr = '主题：' + th.name + '\n近7天库内命中 ' + th.n7 + ' 条（前周 ' + th.p7 + ' 条，环比 ' + (th.p7 ? ((th.n7 >= th.p7 ? '+' : '') + Math.round((th.n7 - th.p7) / th.p7 * 100) + '%') : '（前周无样本）') + '），涉华 ' + th.china7 + ' 条，红级 ' + th.red7 + ' 条\n命中国别TOP：' + (th.topCountries.join('、') || '—') + '\n代表性真实事件（近7天采集）：\n' + (evStr(th.ev) || '（无红橙/涉华级样本，仅常规命中）') + '\n请输出该主题的 14 天前瞻研判。';
          const r = await _llm60(llmCall(pv, THEME_SYS, usr));
          if (r && r.text && r.text.length > 120) {
            const txt = _clean(r.text);
            const m = txt.match(/【态势】([\s\S]*?)【预测】([\s\S]*?)【风险路径】([\s\S]*?)【触发】([\s\S]*)/);
            item.detail = m ? { s: m[1].trim(), p: m[2].trim(), r: m[3].trim(), t: m[4].trim() } : { s: txt };
            item.detail.llm = true;
            item.llm_ok = true;
          }
        } catch (e) { /* 单主题失败回落规则摘要，下轮重试 */ }
        if (!item.detail) {
          item.detail = {
            s: '近7天库内命中 ' + th.n7 + ' 条（前周 ' + th.p7 + ' 条）' + (th.china7 ? '，涉华 ' + th.china7 + ' 条' : '') + '，命中国别TOP：' + (th.topCountries.join('、') || '—') + '。（大模型暂不可达，规则摘要；链路恢复后下轮自动升级 AI 前瞻研判）',
            p: '该主题近 7 天持续有真实事件入库' + (th.p7 && th.n7 > th.p7 ? '且较前周升温（+' + Math.round((th.n7 - th.p7) / th.p7 * 100) + '%）' : '') + '，建议纳入下周监测重点。',
            r: '风险传导路径待大模型细化研判。',
            t: '该主题 24h 命中量再增 50% 或出现红级涉华事件'
          };
        }
        /* 决策日志落档（值班大屏实时墙可筛「主题前瞻」） */
        const d = item.detail;
        await insertLog({ round, kind: 'theme', target: th.name + '（近7天 ' + th.n7 + ' 条）', country: (th.topCountries[0] || '').replace(/\(.*\)/, ''), level: th.red7 ? 'red' : '', content: (String(d.s || '').replace(/^\s*【态势】/, '') ? '【态势】' + String(d.s).replace(/^\s*【态势】/, '') : '') + '\n【预测】' + d.p + '\n【风险路径】' + d.r + '\n【触发】' + String(d.t || '').trim(), llm_ok: item.llm_ok });
        return item;
      }
      const items = await _mapLimit(hot, 2, enrich);
      await q('DELETE FROM ai_theme_items', []);
      for (const it of items) {
        await q(`INSERT INTO ai_theme_items(round, tkey, name, n7, p7, china7, red7, countries, events, detail, llm_ok)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [it.round, it.key, it.name, it.n7, it.p7, it.china7, it.red7, it.countries, JSON.stringify(it.events), JSON.stringify(it.detail), it.llm_ok]);
      }
      S.themeOk = (S.themeOk || 0) + 1; S.lastThemeAt = new Date().toISOString();
    } catch (e) { S.themeFail = (S.themeFail || 0) + 1; S.lastError = e.message; }
  }

  /* ---------- 一轮值班（#718 三层：①事件层 TOP5 逐条研判 ②态势层全局研判 ③预测层 7 天前瞻） ---------- */
  async function runRound(manual) {
    if (S.busy) return { ok: false, error: '本轮值班仍在进行' };
    S.busy = true;
    try {
      await ensureTables();
      if (!S.started) { await loadState(); S.started = true; }
      const round = S.round + 1;
      const cursor = S.cursor;
      /* ① 扫库：游标之后新入库的红橙（48h 采集窗 + 涉华海外优先）。
       * 质量闸（#703 实证 2026-09-08）：source='GDELT事件归档'（backfill CAMEO 机翻模板，
       * 如「尼泊尔：尼泊尔方 实施制裁」）与 _archiveEvent 归档件一律不进研判线——
       * AI 中枢只研判真实新闻源红橙事件，宁缺毋滥。
       * #718 铁律：_sourceType='backfill'（补采主战役 24k 条/日回灌，collect_time=当下
       * 但事件为 1-8 月旧闻）整体排除——AI 值班只研判实时采集的新事件。 */
      const { rows } = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE id > $1
           AND collect_time >= NOW() - INTERVAL '48 hours'
           AND audit_status = 'approved'
           AND COALESCE(country,'') <> '中国'
           AND COALESCE(source,'') <> 'GDELT事件归档'
           AND ${FRESH}
           AND (COALESCE(data_json->>'level_norm','') IN ('red','orange')
                OR lower(COALESCE(severity,'')) IN ('red','orange'))
         ORDER BY id ASC LIMIT 300`, [cursor]
      );
      const now = Date.now();
      const cands = rows.map(r => {
        const j = r.data_json || {};
        const t = r.title_cn || r.title || '';
        const lv = RL.assessLevel(j, r.severity); /* #724 P0-3：定级单一来源（原 j.level_norm||severity||'yellow' 本地副本收敛） */
        const ts = new Date(r.collect_time).getTime() || 0;
        const hours = Math.max(0, (now - ts) / 3600000);
        const china = /中国|中方|华人|华侨|涉华|对华|中企|中资|chinese|china/i.test(t + ' ' + (r.title || '')) || j.chinaRelated === 'true';
        const score = (lv === 'red' ? 46 : 30)
          + (china ? 34 : 0)
          + Math.round(Math.max(0, 1 - hours / 48) * 20);
        return { id: r.id, title: String(t).slice(0, 110), country: r.country || '', type: r.data_type || '', level: lv, ts, china, score, source: r.source || '', sig: j._eventSig || '' };
      }).filter(c => (c.level === 'red' || c.level === 'orange') && !CAMEO_JUNK_RE.test(c.title));
      /* ② 复合价值 TOP_N（涉华加权 + 时近衰减 + 级别权重；同签名去重防同事件多源刷屏） */
      cands.sort((a, b) => b.score - a.score);
      const picked = [], sigSeen = new Set();
      for (const c of cands) {
        if (picked.length >= TOP_N) break;
        if (c.sig && sigSeen.has(c.sig)) continue;
        if (c.sig) sigSeen.add(c.sig);
        picked.push(c);
      }
      /* ③ 逐条 LLM 研判（失败跳过，不写假日志） */
      let okN = 0, skipN = 0;
      for (const c of picked) {
        let judged = false;
        if (llmCall) {
          try {
            const pv = reportsEngine._test.pvKimi();
            const sys = '你是海外利益保护情报预警平台的 AI 值班分析师，对刚入库的红橙级事件情报做快评研判。输出三段，段首用「1.」「2.」「3.」：1.事件性质与风险定性（判断事件类型、针对性与烈度，一句话）；2.影响评估（涉华海外利益/中资企业与人员/升级演化方向，一到两句）；3.处置建议（一个立即可执行动作+时限，一句话）。全文150-250字，直击要害；仅基于给定信息，禁止编造细节与数字；不确定处写"待印证"。';
            const usr = '事件：「' + c.title + '」\n国别：' + c.country + '（非中国境内）\n类别：' + c.type + '；级别：' + c.level + '\n采集时间：' + new Date(c.ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC；信源：' + c.source + '\n涉华关联：' + (c.china ? '命中涉华口径' : '未命中涉华词（仍属海外利益风险面）');
            const r2 = await llmCall(pv, sys, usr);
            if (r2 && r2.text && r2.text.length > 60) {
              const txt = String(r2.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
              await insertLog({ round, kind: 'event', target: c.title, country: c.country, level: c.level, event_id: c.id, content: txt, llm_ok: true });
              okN++; S.llmOk++; S.lastEventAt = new Date().toISOString(); judged = true;
            }
          } catch (e) { S.llmFail++; S.lastError = e.message; }
        }
        if (!judged) skipN++;
        S.judged++;
      }
      /* ③b 态势层：全局态势 AI 研判（每轮 1 次，实时口径） */
      await _situationRound(round);
      /* ③c 预测层：7 天风险前瞻（每 FORECAST_EVERY 轮一次，≈3 小时） */
      if (round % FORECAST_EVERY === 0) await _forecastRound(round);
      /* ③d #740-2 主题层：主题前瞻研判（每 THEME_EVERY 轮一次，≈6 小时；关税/车企出海/矿产/要道等跨事件主题级前瞻） */
      if (round % THEME_EVERY === 0) await _themeRound(round);
      /* ④ 本轮扫描落痕（值班审计） */
      const scanNote = picked.length
        ? '本轮扫描新增红橙候选 ' + cands.length + ' 条，AI 研判 ' + okN + ' 条' + (skipN ? '，跳过 ' + skipN + ' 条（大模型未就绪，宁缺毋假）' : '') + '；研判对象：' + picked.slice(0, 3).map(c => c.country + '·' + c.level).join('、') + (picked.length > 3 ? ' 等' : '')
        : (cands.length ? '本轮新增红橙 ' + cands.length + ' 条，经价值评分未达研判线（低价值/重复源），已记账不研判' : '本轮扫描无新增红橙事件，雷达静默待命');
      await insertLog({ round, kind: 'scan', target: '值班扫描 #' + round, content: scanNote, llm_ok: true });
      /* ⑤ 游标与轮次持久化（推进到本轮见过的最大 id，含未研判条目，不重扫） */
      const maxId = rows.length ? rows[rows.length - 1].id : cursor;
      S.round = round; S.cursor = maxId; S.lastScanAt = new Date().toISOString();
      await saveState('round', round); await saveState('cursor', maxId);
      S.recentRounds.unshift({ round, at: S.lastScanAt, cands: cands.length, judged: okN, skipped: skipN });
      if (S.recentRounds.length > 20) S.recentRounds.length = 20;
      return { ok: true, round, cands: cands.length, judged: okN, skipped: skipN, manual: !!manual };
    } catch (e) {
      S.lastError = e.message;
      return { ok: false, error: e.message };
    } finally { S.busy = false; }
  }

  /* ---------- 端点 ---------- */
  router.get('/log', async (req, res) => {
    try {
      await ensureTables();
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const kind = String(req.query.kind || '').trim();
      const { rows } = await q(
        `SELECT id, ts, round, kind, target, country, level, event_id, content, llm_ok
         FROM ai_watch_log ${kind ? 'WHERE kind = $2' : ''}
         ORDER BY id DESC LIMIT ${kind ? '$1' : limit}`,
        kind ? [limit, kind] : []
      );
      res.json({
        ok: true, log: rows.map(r => ({
          id: r.id, ts: new Date(r.ts).toISOString().replace('T', ' ').slice(0, 16) + 'Z',
          round: r.round, kind: r.kind, target: r.target, country: r.country,
          level: r.level, eventId: r.event_id, content: r.content, llmOk: r.llm_ok
        })),
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: 'AI 值班决策日志：kind=event 事件层大模型逐条研判 / kind=situation 态势层全局研判 / kind=forecast 预测层 7 天前瞻 / kind=theme 主题层 14 天前瞻 / kind=scan 值班扫描落痕。零模拟——LLM 失败的条目不落日志（宁缺毋假）；数据口径铁律：实时采集（排除历史补采回灌）。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get('/status', async (req, res) => {
    try {
      await ensureTables();
      await loadState();
      let total = 0, events = 0, llmOkN = 0, lastTs = null;
      try {
        const { rows } = await q(`SELECT COUNT(*)::int AS total,
            SUM(CASE WHEN kind='event' THEN 1 ELSE 0 END)::int AS events,
            SUM(CASE WHEN llm_ok THEN 1 ELSE 0 END)::int AS okn,
            MAX(ts) AS last FROM ai_watch_log`, []);
        total = rows[0].total; events = rows[0].events; llmOkN = rows[0].okn;
        lastTs = rows[0].last ? new Date(rows[0].last).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : null;
      } catch (e) { /* 空表 */ }
      /* #711 值班大屏态势数据（全部库内真实数据，SQL 聚合，零模拟）：
       * ops.intake24h 近24h入库 / red24h·orange24h 红橙分布 / china24h 涉华
       * ops.topCountries 近48h 国别热区 TOP8 / ops.totalIntel 库存总量 / ops.alerts 预警水位
       * 性能闸（#711 实证 2026-09-08）：DB 常态高负载（慢查询 5~10s），大屏 60s 一刷
       * 会反复捶打聚合查询 → 3 分钟内存缓存 + 每查询 8s 超时兜底，超时回退缓存/零值。 */
      let ops = _opsCache.data;
      if (!ops) {
        ops = await _computeOps();
        _opsCache = { at: Date.now(), data: ops };
      } else if (Date.now() - _opsCache.at > 180000 && !_opsRefreshing) {
        /* 过期回旧值 + 后台静默刷新，绝不阻塞请求 */
        _opsRefreshing = true;
        _computeOps().then(d => { _opsCache = { at: Date.now(), data: d }; })
          .catch(() => {}).finally(() => { _opsRefreshing = false; });
      }
      /* #721 结构化预测清单（上一轮预测落库结果；预测层未到 3h 周期时前端仍可取上次清单）
       * #730 P1-3：每条附「近4轮命中 x/4」对账角标数据；另发累计对账总览（滚动命中率看板） */
      let forecastItems = [];
      let fcHits = {}, fcVerify = null;
      try {
        fcHits = await _fcHitStats();
        const { rows: vr } = await q(`SELECT verify_status, COUNT(*)::int AS n, MAX(verified_at) AS last_at
          FROM ai_forecast_history WHERE verify_status IS NOT NULL GROUP BY 1`, []);
        if (vr.length) {
          let t = 0, h = 0, nr = 0, m = 0, lastAt = null;
          vr.forEach(x => {
            t += x.n;
            if (x.verify_status === 'hit') h = x.n;
            else if (x.verify_status === 'near') nr = x.n;
            else m = x.n;
            const lt = x.last_at ? new Date(x.last_at).getTime() : 0;
            if (lt && (!lastAt || lt > lastAt)) lastAt = lt;
          });
          fcVerify = { total: t, hit: h, near: nr, miss: m, rate: t ? Math.round(h / t * 100) : null, lastAt: lastAt ? new Date(lastAt).toISOString() : null };
        }
      } catch (e) { /* 空表/建表中 */ }
      try {
        const fr = await q(`SELECT kind, name, direction, delta, n7, p7, red7, china7, top_domain, confidence, horizon, trigger_txt, basis, detail, basis_shift
          FROM ai_forecast_items ORDER BY kind ASC, delta DESC`, []);
        forecastItems = fr.rows.map(r => {
          let detail = null;
          if (r.detail) { try { detail = JSON.parse(r.detail); } catch (e) { detail = { s: r.detail }; } }
          const hk = r.kind + ':' + r.name;
          return {
            kind: r.kind, name: r.name, direction: r.direction, delta: r.delta === null ? null : Number(r.delta),
            n7: Number(r.n7), p7: Number(r.p7), red7: Number(r.red7), china7: Number(r.china7),
            topDomain: r.top_domain, confidence: r.confidence, horizon: r.horizon,
            trigger: r.trigger_txt, basis: r.basis, detail: detail, basisShift: !!r.basis_shift,
            hit4: fcHits[hk] ? fcHits[hk].hits + '/' + fcHits[hk].total : null,
            hitRate: fcHits[hk] ? fcHits[hk].rate : null,
            lastVerdict: fcHits[hk] ? fcHits[hk].last : null
          };
        });
      } catch (e) { /* 空表/建表中 */ }
      /* #740-2 主题前瞻研判清单（主题层落库结果；未到 6h 周期时取上次清单） */
      let themeItems = [];
      try {
        const tr = await q(`SELECT tkey, name, n7, p7, china7, red7, countries, events, detail, llm_ok FROM ai_theme_items ORDER BY (china7 * 2 + red7 * 2 + n7) DESC`, []);
        themeItems = tr.rows.map(r => {
          let detail = null, events = [];
          if (r.detail) { try { detail = JSON.parse(r.detail); } catch (e) { detail = { s: r.detail }; } }
          if (r.events) { try { events = JSON.parse(r.events) || []; } catch (e) { events = []; } }
          return {
            key: r.tkey, name: r.name, n7: Number(r.n7), p7: Number(r.p7), china7: Number(r.china7), red7: Number(r.red7),
            countries: r.countries || '', events: events, detail: detail, llmOk: !!r.llm_ok
          };
        });
      } catch (e) { /* 空表/建表中 */ }
      res.json({
        ok: true, duty: {
          active: true, intervalMin: Math.round(ROUND_MS / 60000),
          round: S.round, cursor: S.cursor,
          lastScanAt: S.lastScanAt, lastLogAt: lastTs,
          startedAt: S.startedAt, busy: S.busy, lastError: S.lastError,
          llmOk: S.llmOk, llmFail: S.llmFail,
          successRate: (S.llmOk + S.llmFail) ? Math.round(S.llmOk / (S.llmOk + S.llmFail) * 100) : null,
          recentRounds: S.recentRounds
        },
        stats: { totalLogs: total, eventJudgments: events, llmOkLogs: llmOkN,
          situation: S.situOk, forecast: S.fcOk,
          theme: S.themeOk || 0, lastThemeAt: S.lastThemeAt || null,
          lastEventAt: S.lastEventAt, lastSituationAt: S.lastSituationAt, lastForecastAt: S.lastForecastAt },
        ops: ops,
        forecastItems: forecastItems,
        forecastVerify: fcVerify,
        themeItems: themeItems,
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: 'AI 值班分析师（三层）：①事件层——' + Math.round(ROUND_MS / 60000) + ' 分钟/轮自动扫库，复合价值评分 TOP' + TOP_N + ' 逐条大模型研判；②态势层——每轮全局态势研判（置信度+关键动向+涉华风险）；③预测层——每 ' + Math.round(FORECAST_EVERY * ROUND_MS / 3600000) + ' 小时 7 天风险前瞻。数据口径铁律：全部基于实时采集（排除历史补采回灌与归档件）；研判仅基于库内真实事件；LLM 不可达时宁缺毋假。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #743 P0-1 预测核验命中率公示牌（聚合端点：45s 缓存；overall + 分维度 + 分条目累计榜 + 最近核验明细） ---------- */
  let _accCache = null, _accCacheAt = 0;
  router.get('/accuracy', async (req, res) => {
    try {
      await ensureTables();
      if (_accCache && Date.now() - _accCacheAt < 45000) return res.json(_accCache);
      const out = { ok: true, generatedAt: new Date().toLocaleString('zh-CN') };
      /* 总体 + 待核验透明度（pending=滚动留底未到期；nextDueAt=最早一批满 7 天时间） */
      const { rows: ov } = await q(`SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE verify_status IS NOT NULL)::int AS verified,
          COUNT(*) FILTER (WHERE verify_status='hit')::int AS hit,
          COUNT(*) FILTER (WHERE verify_status='near')::int AS near,
          COUNT(*) FILTER (WHERE verify_status='miss')::int AS miss,
          COUNT(*) FILTER (WHERE verify_status IS NULL)::int AS pending,
          MIN(ts)::text AS first_at,
          (MIN(ts) FILTER (WHERE verify_status IS NULL) + INTERVAL '7 days')::text AS next_due,
          MAX(verified_at)::text AS last_verified
        FROM ai_forecast_history`, []);
      const o = ov[0] || {};
      const vd = o.verified || 0;
      out.overall = {
        total: o.total || 0, verified: vd, hit: o.hit || 0, near: o.near || 0, miss: o.miss || 0,
        rate: vd ? Math.round((o.hit || 0) / vd * 100) : null,
        nearInclusive: vd ? Math.round(((o.hit || 0) + (o.near || 0)) / vd * 100) : null,
        pending: o.pending || 0, firstAt: o.first_at || null, nextDueAt: o.next_due || null, lastVerifiedAt: o.last_verified || null
      };
      /* 分维度（国别/风险域） */
      const { rows: bk } = await q(`SELECT kind,
          COUNT(*) FILTER (WHERE verify_status IS NOT NULL)::int AS verified,
          COUNT(*) FILTER (WHERE verify_status='hit')::int AS hit,
          COUNT(*) FILTER (WHERE verify_status='near')::int AS near,
          COUNT(*) FILTER (WHERE verify_status='miss')::int AS miss
        FROM ai_forecast_history GROUP BY 1`, []);
      out.byKind = {};
      bk.forEach(r => {
        out.byKind[r.kind] = { verified: r.verified, hit: r.hit, near: r.near, miss: r.miss, rate: r.verified ? Math.round(r.hit / r.verified * 100) : null };
      });
      /* 分条目累计榜（kind+name 聚合，命中+半分near 排序） */
      const { rows: bi } = await q(`SELECT kind, name,
          COUNT(*) FILTER (WHERE verify_status IS NOT NULL)::int AS verified,
          COUNT(*) FILTER (WHERE verify_status='hit')::int AS hit,
          COUNT(*) FILTER (WHERE verify_status='near')::int AS near,
          COUNT(*) FILTER (WHERE verify_status='miss')::int AS miss,
          (ARRAY_agg(verify_status ORDER BY ts DESC) FILTER (WHERE verify_status IS NOT NULL))[1] AS last
        FROM ai_forecast_history GROUP BY 1,2`, []);
      out.items = bi.map(r => ({ kind: r.kind, name: r.name, verified: r.verified, hit: r.hit, near: r.near, miss: r.miss, rate: r.verified ? Math.round(r.hit / r.verified * 100) : null, last: r.last || null }))
        .sort((a, b) => ((b.hit || 0) + (b.near || 0) * 0.5) - ((a.hit || 0) + (a.near || 0) * 0.5));
      /* 最近核验明细（15 条） */
      const { rows: rc } = await q(`SELECT kind, name, direction, verify_status, verify_actual, verified_at::text AS vat
        FROM ai_forecast_history WHERE verify_status IS NOT NULL ORDER BY verified_at DESC LIMIT 15`, []);
      out.recent = rc.map(r => {
        let ad = null;
        try { ad = r.verify_actual ? JSON.parse(r.verify_actual) : null; } catch (e) { ad = null; }
        return { kind: r.kind, name: r.name, direction: r.direction, verdict: r.verify_status, actualDelta: ad ? ad.actual_delta : null, a7: ad ? ad.a7 : null, n7: ad ? ad.n7_base : null, verifiedAt: r.vat };
      });
      out.note = '预测核验闭环公示牌（#743）：每条 7 天方向预测满期后按预测窗实际入库回算，判 hit / near（方向对幅度不足）/ miss 三档；连续 3 轮 miss 的条目自动降置信度并在装配层生效。零模拟——机制上线（' + String(out.overall.firstAt || '').slice(0, 10) + '）之前的预测未留底、不回溯构造。';
      _accCache = out; _accCacheAt = Date.now();
      res.json(out);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/run', async (req, res) => {
    const r = await runRound(true);
    res.json(Object.assign({ note: '手动触发一轮 AI 值班扫描研判（常规节奏 ' + Math.round(ROUND_MS / 60000) + ' 分钟/轮自动执行）' }, r));
  });

  /* #721 手动触发一轮预测层装配（结构化国别/风险域清单，无需等 3h 周期） */
  router.post('/forecast-run', async (req, res) => {
    try {
      await ensureTables();
      if (!S.started) { await loadState(); S.started = true; }
      await _forecastRound(S.round || 1);
      const { rows } = await q('SELECT COUNT(*)::int AS n FROM ai_forecast_items', []);
      res.json({ ok: true, items: rows[0] ? rows[0].n : 0, round: S.round,
        note: '手动触发一轮预测层装配：国别+风险域结构化预测清单（7d vs 前周真实统计）；常规节奏每 ' + Math.round(FORECAST_EVERY * ROUND_MS / 3600000) + ' 小时自动执行' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* #740-2 手动触发一轮主题前瞻研判（无需等 6h 周期） */
  router.post('/theme-run', async (req, res) => {
    try {
      await ensureTables();
      if (!S.started) { await loadState(); S.started = true; }
      await _themeRound(S.round || 1);
      const { rows } = await q('SELECT COUNT(*)::int AS n FROM ai_theme_items', []);
      res.json({ ok: true, items: rows[0] ? rows[0].n : 0, round: S.round,
        note: '手动触发一轮主题前瞻研判：关税重塑/车企出海/关键矿产/红海要道等跨事件主题 14 天前瞻（近 7 天真实库命中 × LLM 研判）；常规节奏每 ' + Math.round(THEME_EVERY * ROUND_MS / 3600000) + ' 小时自动执行' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* #730 手动触发一轮预测对账（满 7 天的历史预测按实际入库回算，无需等整点调度） */
  router.post('/forecast-verify', async (req, res) => {
    try {
      const r = await _fcVerifySweep();
      res.json(Object.assign({ note: '预测对账：满 7 天的历史预测条目按预测窗实际入库回算，方向命中判 hit/near/miss（滚动写入，hourly 自动执行）' }, r));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return {
    router,
    runVerify: _fcVerifySweep,   /* #730 调度收编：对账任务开放给 SCHED 托管（server.js 注册 watch 类） */
    /* #712 调度收编：runRound 开放给 SCHED 托管（server.js 注册 ai 类任务，
     * 原内部 setInterval/setTimeout 退役；start() 保留兼容但不再被调用） */
    runRound,
    /* 启动值班循环（server.js 调用；防热重载双跑） */
    start() {
      if (global.__AI_WATCH_TIMER__) return;
      global.__AI_WATCH_TIMER__ = true;
      setTimeout(() => { runRound(false).catch(e => { S.lastError = e.message; }); }, 30 * 1000);
      setInterval(() => { runRound(false).catch(e => { S.lastError = e.message; }); }, ROUND_MS);
      console.log('[AI-WATCH] AI 值班分析师已上岗：' + Math.round(ROUND_MS / 60000) + ' 分钟/轮自动扫库研判');
    }
  };
}

module.exports = aiWatch;
