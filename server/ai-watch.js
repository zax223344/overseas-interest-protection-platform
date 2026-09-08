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

const ROUND_MS = 20 * 60 * 1000;      /* 值班节奏：20 分钟一轮 */
const TOP_N = 5;                       /* 每轮研判条数上限 */

function aiWatch(ctx) {
  const q = ctx.query;
  const llmCall = (ctx.llm && ctx.llm.callMsg) || null;
  const router = express.Router();
  const S = {
    started: false, round: 0, cursor: 0,
    lastScanAt: null, lastError: null, busy: false,
    judged: 0, llmOk: 0, llmFail: 0, startedAt: new Date().toISOString(),
    recentRounds: []   /* 最近若干轮摘要（内存态，状态页用） */
  };

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
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours'`, []));
      if (r1 && r1.rows[0]) {
        ops.intake24h = r1.rows[0].n; ops.red24h = r1.rows[0].red;
        ops.orange24h = r1.rows[0].orange; ops.china24h = r1.rows[0].china;
      }
    } catch (e) { /* 静默 */ }
    try {
      const r2 = await _t8(q(`SELECT COALESCE(NULLIF(country,''),'国际') AS ctry, COUNT(*)::int AS n
        FROM intel_data WHERE collect_time >= NOW() - INTERVAL '48 hours'
          AND COALESCE(audit_status,'approved') = 'approved'
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

  /* ---------- 一轮值班 ---------- */
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
       * AI 中枢只研判真实新闻源红橙事件，宁缺毋滥。 */
      const { rows } = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE id > $1
           AND collect_time >= NOW() - INTERVAL '48 hours'
           AND audit_status = 'approved'
           AND COALESCE(country,'') <> '中国'
           AND COALESCE(source,'') <> 'GDELT事件归档'
           AND COALESCE(data_json->>'_archiveEvent','') <> 'true'
           AND (COALESCE(data_json->>'level_norm','') IN ('red','orange')
                OR lower(COALESCE(severity,'')) IN ('red','orange'))
         ORDER BY id ASC LIMIT 300`, [cursor]
      );
      const now = Date.now();
      const cands = rows.map(r => {
        const j = r.data_json || {};
        const t = r.title_cn || r.title || '';
        const lv = (String(j.level_norm || r.severity || 'yellow').toLowerCase());
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
              okN++; S.llmOk++; judged = true;
            }
          } catch (e) { S.llmFail++; S.lastError = e.message; }
        }
        if (!judged) skipN++;
        S.judged++;
      }
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
        note: 'AI 值班决策日志：kind=event 大模型逐条研判 / kind=scan 值班扫描落痕。零模拟——LLM 失败的条目不落日志（宁缺毋假）。'
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
        stats: { totalLogs: total, eventJudgments: events, llmOkLogs: llmOkN },
        ops: ops,
        generatedAt: new Date().toLocaleString('zh-CN'),
        note: 'AI 值班分析师：无人值守自动扫库（' + Math.round(ROUND_MS / 60000) + ' 分钟/轮）→ 复合价值评分 TOP' + TOP_N + ' 逐条大模型研判 → 决策日志落库。研判仅基于库内真实事件；LLM 不可达时宁缺毋假。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/run', async (req, res) => {
    const r = await runRound(true);
    res.json(Object.assign({ note: '手动触发一轮 AI 值班扫描研判（常规节奏 ' + Math.round(ROUND_MS / 60000) + ' 分钟/轮自动执行）' }, r));
  });

  return {
    router,
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
