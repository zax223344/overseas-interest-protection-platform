/* ============================================================
 * server/collect-commander.js — 采集总指挥哨兵（#717，2026-09-09 用户指令原话：
 *   「设计一个哨兵，自主跑，按采集要求采集数据，不用我在 workbuddy 中再下指令了，
 *    电脑关机或断网，联网后也继续执行任务，不用我再下指令」）
 * ================================================================
 * 定位：总指挥（commander），不重复既有执行机构的活——
 *   governor（10min 档位调速）/ patrol-sentinel（30min 断粮空转）/ gap-scheduler
 *   （30min 国别×类别缺口矩阵）/ backfill-watch（补采质量门）都管"平时"；
 *   commander 管"非常时刻"与"跨日自愈"，全部决策留痕可审计：
 *
 * ① 外网探活状态机（5min/轮）：双探针——国内腿（百度）+ 境外腿（GDELT API）。
 *   国内腿 2 连败 → 判断整机断网 → 状态落库（offlineSince）+ 日志；
 *   国内腿恢复 → 断网时长落账 + 立即触发追采四通道（主采集/涉华专项/
 *   负面专项/缺口矩阵）。断网期间既有采集任务的失败由各通道自身退避，
 *   恢复追采由 commander 一键点燃，全程零人工指令；
 * ② 关机场景：进程不在 → 无探活；开机 → PM2 拉起 → 首轮探活（90s 后）。
 *   若 DB 状态里残留 offlineSince（关机前正处断网）→ 按"恢复"路径处理；
 *   关机整天 → 由 ③ 昨日落账发现未达标 → 次日自动加力；
 * ③ 昨日落账（每日 ≥09:00 首轮）：核对昨日采集要求达成度——
 *   实时总量 ≥2000 地板（目标 4000）/ 涉华 ≥150 / 涉华负面 ≥100 /
 *   补采账本推进（≥27 历史日/天）。未达标落账 + 当日立即补一轮追采；
 * ④ 开机自检（boot）：DB 连通 / 补采账本健康（pending>0 且 running=0 会
 *   预警——引擎自身 60s 接管轮询会续跑）/ 采集类是否被人为暂停。
 *   全部落 collect_commander_log，开机干了什么一查便知；
 * ⑤ 决策留痕：collect_commander_log（kind ∈ boot / outage_start /
 *   outage_recovered / net_degraded / round_behind / daily_settle / catchup），
 *   状态持久化 collect_commander_state（重启不丢断网窗口）。
 *
 * 端点（挂 /api/commander，authMiddleware）：
 *   GET  /status   总指挥实时状态（探活/状态机/统计/最近决策日志）
 *   GET  /log      决策日志（?limit=&kind=）
 *   POST /run      手动触发一轮（管理动作）
 * 挂载：server.js require + init + SCHED.register（watch 类，server 进程，
 *   5min/轮——demo 模式下 watch 类暂停，总指挥不越权）。
 * 铁律：零模拟——只基于真实探活与 DB 实数决策；追采只调用既有采集函数，
 *   绝不新造采集通道；探针失败不算故障（外网劣化是常态，netx 自动回落代理）。
 * ============================================================ */
'use strict';
const express = require('express');

const ROUND_MS = 5 * 60 * 1000;
const OFFLINE_FAILS = 2;          /* 国内腿连败 2 轮（~10min）判断网 */
const DEGRADED_STREAK_LOG = 3;    /* 境外腿连劣 3 轮（~15min）才落一条日志防刷屏 */

/* 采集要求单一来源（与 governor/patrol 用户口径一致：2026-09-04 指令） */
const REQ = {
  totalTarget: 4000, totalFloor: 2000, china: 150, negative: 100,
  backfillDaysPerDay: 27 /* INGEST_CAP 24000 ÷ 历史日均值 ~880 条折算 */
};

function collectCommander(ctx) {
  const q = ctx.query;
  const netx = ctx.netx;
  const sched = ctx.sched;
  const T = (ctx.triggers || {});
  const router = express.Router();

  /* 探针 URL 可注入（测试用假 URL 演练断网状态机） */
  const PROBE_DOM = (ctx.probeUrls && ctx.probeUrls.dom) || 'https://www.baidu.com';
  const PROBE_INTL = (ctx.probeUrls && ctx.probeUrls.intl) || 'https://www.gdeltproject.org/'; /* 实测 2026-09-09：GDELT DOC API 被采集通道打到 429，探针用首页不占配额 */

  const S = {
    startedAt: new Date().toISOString(),
    bootAudited: false, settleDay: null,
    rounds: 0, lastRoundAt: null, lastError: null, busy: false,
    net: { domOk: null, intlOk: null, fails: 0, degradedStreak: 0, offlineSince: null, lastProbeAt: null },
    stats: { outages: 0, outageTotalMin: 0, catchups: 0, settles: 0, degradedLogs: 0 }
  };

  /* ---------- 建表 + 状态持久化 ---------- */
  let _tablesReady = false;
  async function _ensureTables() {
    if (_tablesReady) return;
    await q(`CREATE TABLE IF NOT EXISTS collect_commander_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMP DEFAULT NOW(),
      kind VARCHAR(32) NOT NULL,
      detail TEXT
    )`, []);
    await q(`CREATE TABLE IF NOT EXISTS collect_commander_state (
      k VARCHAR(40) PRIMARY KEY, v TEXT
    )`, []);
    _tablesReady = true;
  }
  async function _loadState() {
    try {
      const { rows } = await q(`SELECT k, v FROM collect_commander_state WHERE k='offlineSince'`, []);
      if (rows[0] && rows[0].v) S.net.offlineSince = rows[0].v;
    } catch (e) { /* 表未建静默 */ }
  }
  async function _saveState(k, v) {
    await q(`INSERT INTO collect_commander_state (k, v) VALUES ($1, $2)
             ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [k, v === null ? '' : String(v)]);
  }
  async function _log(kind, detail) {
    try {
      await q(`INSERT INTO collect_commander_log (kind, detail) VALUES ($1, $2)`,
        [kind, typeof detail === 'string' ? detail : JSON.stringify(detail)]);
    } catch (e) { console.warn('[COMMANDER] 日志落库失败:', e.message); }
    console.log('[COMMANDER] ' + kind + (detail ? ' | ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }

  /* ---------- 探活：国内腿 + 境外腿 ---------- */
  async function _probe(url, timeout) {
    try {
      const r = await netx.smartFetch(url, { timeout });
      return !!(r && r.ok);
    } catch (e) { return false; }
  }
  async function _probeNet() {
    const [dom, intl] = await Promise.all([
      _probe(PROBE_DOM, 6000),
      _probe(PROBE_INTL, 9000)
    ]);
    S.net.domOk = dom; S.net.intlOk = intl; S.net.lastProbeAt = new Date().toISOString();
    return { dom, intl };
  }

  /* ---------- 追采点火：只调既有通道，绝不新造采集 ---------- */
  function _collectPaused() { return !!(sched && sched.klassPaused && sched.klassPaused('collect')); }
  function _fireCatchup(reason) {
    if (_collectPaused()) { _log('catchup_skip', '采集类处于暂停（manual/demo），跳过追采：' + reason); return; }
    const chans = [
      ['主采集', T.globalMedia], ['涉华专项', T.chinaFocus],
      ['负面专项', T.chinaNegative], ['缺口矩阵', T.gapScheduler]
    ].filter(x => typeof x[1] === 'function');
    if (!chans.length) return;
    chans.forEach(([nm, fn], i) => setTimeout(() => {
      try { fn(); } catch (e) { console.warn('[COMMANDER] 追采通道「' + nm + '」触发失败:', e.message); }
    }, i * 8000));   /* 错峰 8s，避免四通道同时砸采集源 */
    S.stats.catchups++;
    _log('catchup', '原因=' + reason + '，点燃通道=' + chans.map(c => c[0]).join('/'));
  }

  /* ---------- 状态机 ---------- */
  async function _handleNet(p) {
    const now = new Date().toISOString();
    if (p.dom) {
      /* 国内通：若此前判过断网（含关机前落库的 offlineSince）→ 恢复 */
      if (S.net.fails > 0 || S.net.offlineSince) {
        const since = S.net.offlineSince || now;
        const mins = Math.max(1, Math.round((Date.now() - new Date(since).getTime()) / 60000));
        S.net.fails = 0; S.net.offlineSince = null; S.stats.outages++; S.stats.outageTotalMin += mins;
        await _saveState('offlineSince', null);
        await _log('outage_recovered', { offlineSince: since, offlineMinutes: mins, intlOk: p.intl });
        _fireCatchup('断网' + mins + '分钟恢复');
      } else {
        S.net.fails = 0;
        /* 境外腿劣化（国内通、GDELT 不通）：netx 自动回落代理，常态不算故障 */
        if (!p.intl) {
          S.net.degradedStreak++;
          if (S.net.degradedStreak === DEGRADED_STREAK_LOG) {
            S.stats.degradedLogs++;
            _log('net_degraded', '境外探针连续 ' + S.net.degradedStreak + ' 轮不通（国内正常），netx 已自动回落代理，采集通道自行决策');
          }
        } else S.net.degradedStreak = 0;
      }
    } else {
      /* 国内腿失败：可能是整机断网，也可能是探针抖动 → 连败计数 */
      S.net.fails++;
      if (S.net.fails >= OFFLINE_FAILS && !S.net.offlineSince) {
        S.net.offlineSince = now;
        await _saveState('offlineSince', now);
        await _log('outage_start', { probeAt: now, dom: false, intl: p.intl });
      }
    }
  }

  /* ---------- 开机自检 ---------- */
  async function _bootAudit() {
    const info = { bootAt: S.startedAt, db: 'ok', collectPaused: false };
    try { await q('SELECT 1', []); } catch (e) { info.db = 'FAIL:' + e.message; }
    info.collectPaused = _collectPaused();
    try {
      const { rows } = await q(`SELECT status, COUNT(*)::int n FROM backfill_progress GROUP BY 1`, []);
      const led = {}; rows.forEach(r => led[r.status] = r.n);
      info.backfillLedger = led;
      const pending = led.pending || 0, running = led.running || 0;
      if (pending > 0 && running === 0 && !_collectPaused()) {
        /* 引擎自身 60s 接管轮询会自动领日续跑——此处只预警留痕，绝不代启（防双跑） */
        info.backfillNote = 'pending=' + pending + ' 且 running=0，引擎 60s 轮询应自动接管，若 10min 后仍为 0 须人工核查';
      }
    } catch (e) { info.backfillLedger = 'ERR:' + e.message; }
    await _log('boot', info);
    /* 关机期间可能整窗漏采：开机即核对昨日落账，未达标自动追 */
  }

  /* ---------- 昨日落账（每日 ≥09:00 首轮，一遍） ---------- */
  async function _dailySettle() {
    const now = new Date();
    if (now.getHours() < 9) return;
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yStart = new Date(y); yStart.setHours(0, 0, 0, 0);
    const yEnd = new Date(y); yEnd.setHours(24, 0, 0, 0);
    const dk = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dayKey = dk(y);
    if (S.settleDay === dayKey) return;
    S.settleDay = dayKey; S.stats.settles++;
    const NOT_BF = `COALESCE(data_json->>'_sourceType','') <> 'backfill'`;
    const rep = { day: dayKey, items: [], ok: true };
    try {
      const { rows } = await q(
        `SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE data_json->>'chinaRelated'='true')::int china,
          COUNT(*) FILTER (WHERE data_json->>'_chinaNegative'='true')::int neg
        FROM intel_data WHERE collect_time >= $1 AND collect_time < $2 AND COALESCE(audit_status,'approved')='approved' AND ${NOT_BF}`,
        [yStart, yEnd]);
      const r = rows[0] || { total: 0, china: 0, neg: 0 };
      const push = (name, n, floor, target) => {
        const okFloor = n >= floor, okTarget = n >= target;
        rep.items.push({ name, n, floor, target, okFloor, okTarget });
        if (!okFloor) rep.ok = false;
      };
      push('实时总量', r.total, REQ.totalFloor, REQ.totalTarget);
      push('涉华', r.china, Math.round(REQ.china * 0.6), REQ.china);
      push('涉华负面', r.neg, Math.round(REQ.negative * 0.5), REQ.negative);
      /* 补采账本：昨日完成的历史日数（时区铁律：AT TIME ZONE 'Asia/Shanghai'） */
      try {
        const bf = await q(
          `SELECT COUNT(*)::int done, COALESCE(SUM(inserted),0)::int inserted FROM backfill_progress
           WHERE status='done' AND (day AT TIME ZONE 'Asia/Shanghai')::date = $1::date`, [dayKey]);
        const d = bf.rows[0] || { done: 0, inserted: 0 };
        rep.items.push({ name: '补采完成历史日', n: d.done, floor: 0, target: REQ.backfillDaysPerDay, okFloor: true, okTarget: d.done >= REQ.backfillDaysPerDay });
        rep.backfillInserted = d.inserted;
      } catch (e) { rep.backfillErr = e.message; }
      await _log('daily_settle', rep);
      /* 地板未达标 → 当日立即加一轮追采（governor 档位另管常态调速） */
      if (!rep.ok && !_collectPaused()) _fireCatchup('昨日落账未达地板（' + rep.items.filter(i => !i.okFloor).map(i => i.name + '=' + i.n).join('/') + '）');
    } catch (e) {
      S.settleDay = null;   /* 失败不占坑，下轮重试 */
      throw e;
    }
  }

  /* ---------- 主轮 ---------- */
  async function runRound(force) {
    if (S.busy) return { ok: false, reason: 'busy' };
    S.busy = true;
    try {
      await _ensureTables();
      if (!S.net.offlineSince && !sched) { /* 无调度器注入（独立测试态） */ }
      await _loadStateOnce();
      const p = await _probeNet();
      await _handleNet(p);
      if (!S.bootAudited) { S.bootAudited = true; await _bootAudit(); }
      await _dailySettle();
      S.rounds++; S.lastRoundAt = new Date().toISOString();
      return { ok: true, probe: p, net: S.net };
    } catch (e) {
      S.lastError = e.message;
      console.warn('[COMMANDER] 轮次异常:', e.message);
      return { ok: false, error: e.message };
    } finally { S.busy = false; }
  }
  let _stateLoaded = false;
  async function _loadStateOnce() {
    if (_stateLoaded) return; _stateLoaded = true;
    await _loadState();
  }

  /* ---------- 端点 ---------- */
  router.get('/status', async (req, res) => {
    let recent = [];
    try {
      const { rows } = await q(`SELECT ts, kind, detail FROM collect_commander_log ORDER BY id DESC LIMIT 20`, []);
      recent = rows;
    } catch (e) {}
    res.json({ startedAt: S.startedAt, rounds: S.rounds, lastRoundAt: S.lastRoundAt,
      lastError: S.lastError, net: S.net, stats: S.stats, req: REQ, bootAudited: S.bootAudited,
      collectPaused: _collectPaused(), recentLogs: recent });
  });
  router.get('/log', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const kind = req.query.kind || null;
    try {
      const { rows } = await q(
        kind ? `SELECT ts, kind, detail FROM collect_commander_log WHERE kind=$1 ORDER BY id DESC LIMIT $2`
             : `SELECT ts, kind, detail FROM collect_commander_log ORDER BY id DESC LIMIT $1`,
        kind ? [kind, limit] : [limit]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/run', async (req, res) => { res.json(await runRound(true)); });

  return { router, runRound, state: S };
}

module.exports = collectCommander;
