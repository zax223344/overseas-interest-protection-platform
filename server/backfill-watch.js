/**
 * backfill-watch.js — 补采质量哨兵（任务 #715，2026-09-08 用户指令原话：
 *   「设计一个哨兵，监察采集的数据、标准和质量等，以及中断后，能接上恢复采集，
 *    不要可能接不上，导致系统又乱采」）
 * ================================================================
 * 六项能力（与引擎 backfill.js 同进程 worker 角色运行，路由双角色注册）：
 *
 * ① 僵死日回收：running >30min 无心跳 → 回 pending。引擎在回捞/翻译/入库三个
 *   长阶段每 60s 心跳回写 started_at，判据只杀真僵死（进程被杀/死循环）；
 * ② 重试封棺：attempts ≥5 的 error/partial → dead 终态，绝不无限重试乱采；
 * ③ 单日硬帽监察（24,000/自然日）：引擎前置自查 + 哨兵 5min 兜底双保险；
 *   到帽置 paused+reason='cap'+cap_day，跨零点 00:30 自动恢复（引擎 60s 接管
 *   轮询自动续跑，断点由 backfill_progress 账本 + URL/签名去重闸双保险防重复）；
 * ④ 实时采集让路：当天实时量严重落后（12:00 仍 <800）且补采在大量占库 →
 *   paused+reason='yield' 让路；实时回升 ≥1500 或跨日自动解除——用户约束一
 *   （「每天系统自身的当天采集量要完成」优先于补采）的执行机构；
 * ⑤ 逐日质量门审计（每 10min）：每个 done 日核对——总量 ≥1200（净目标 80%）/
 *   单类 ≤35% / 单国 ≤12% / 中文标题 ≥95% / 合成 ≤5% / 涉华占比。结果落
 *   backfill_audit 表全程可查；事故级空采（<300 条）自动清行重做（attempts 上限
 *   防死循环）；分布性不达标只记不自动重做（重做也救不了源数据分布，交人工
 *   POST /api/backfill/redo 定向处置）；
 * ⑥ 暂停原因分层恢复：user/trial 永不自动恢复（人工唯一出口），cap/yield
 *   按各自条件自动恢复——「中断后能接上」且「不乱采」两个诉求的平衡点。
 *
 * 观测：GET /api/backfill/watch（今日量/帽/暂停原因/审计汇总/哨兵统计）。
 */
'use strict';

const backfill = require('./backfill');   /* 暂停状态机 + INGEST_CAP 单一来源 */

const INGEST_CAP = backfill.INGEST_CAP;
const STALE_MIN = 30;                      /* running >30min 无心跳判僵死 */
const DAY_DEAD_ATTEMPTS = 5;               /* 重试上限（引擎 DAY_RETRY_MAX=3 + 审计重做余量） */
const YIELD_CHECK_HOUR = 12;                /* 实时停滞检测起始时刻 */
const YIELD_FLOOR = 800;                    /* 到 12:00 实时采集 <800 判停滞 */
const YIELD_RESUME_N = 1500;                /* 实时回升到 1500 解除让路 */
const AUDIT_MIN_TOTAL = 300;                /* <300 判事故级空采 → 自动清行重做 */
const TICK_MS = 60 * 1000;

const W = {
  ticks: 0, lastTickAt: null, lastAuditAt: 0, today: null,
  stats: { staleRecovered: 0, deadDays: 0, capPauses: 0, capResumes: 0,
           yieldPauses: 0, yieldResumes: 0, audits: 0, autoRedo: 0 }
};
let D = null;

/* PG date 列 → 本地日期键（禁 toISOString：+8 时区回退一天） */
function _dk(d) {
  if (d instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return String(d).slice(0, 10);
}
function _todayKey() { return _dk(new Date()); }
/* 跨零点恢复时刻：00:30（避开零点采集洪峰 + 日统计切割） */
function _pastHalfPastMidnight() { const d = new Date(); return d.getHours() > 0 || d.getMinutes() >= 30; }

async function _ensureTables() {
  await D.query(`CREATE TABLE IF NOT EXISTS backfill_audit (
    day date PRIMARY KEY, passed boolean, total int, metrics jsonb,
    audited_at timestamptz DEFAULT NOW())`);
  /* 表达式/部分索引（怪兽查询治理同款范式）：审计按 _backfillDay 直查、
   * 硬帽计数走部分索引，避免 60s 轮询全表扫 */
  await D.query(`CREATE INDEX IF NOT EXISTS idx_intel_bfday ON intel_data ((data_json->>'_backfillDay'))`);
  await D.query(`CREATE INDEX IF NOT EXISTS idx_intel_backfill_today ON intel_data (collect_time)
    WHERE COALESCE(data_json->>'_sourceType','') = 'backfill'`);
}

/* ---------- ③ 硬帽 + ④ 让路（5min 节流） ---------- */
async function _capAndYield() {
  const today = _todayKey();
  let backfillN = 0, totalN = 0;
  try {
    const a = await D.query(`SELECT count(*) n FROM intel_data
      WHERE collect_time >= CURRENT_DATE AND COALESCE(data_json->>'_sourceType','')='backfill'`);
    backfillN = (a.rows[0] || {}).n || 0;
    const b = await D.query(`SELECT count(*) n FROM intel_data WHERE collect_time >= CURRENT_DATE`);
    totalN = (b.rows[0] || {}).n || 0;
  } catch (e) { return; }
  const realtimeN = Math.max(0, totalN - backfillN);
  W.today = { day: today, backfillN, realtimeN, totalN, cap: INGEST_CAP };
  const paused = await backfill._isPaused();
  const reason = await backfill._getState('pause_reason');
  const now = new Date();
  /* ③a 到帽自暂停（引擎前置自查之外的兜底：多 worker 并发越过时哨兵兜住） */
  if (!paused && backfillN >= INGEST_CAP) {
    await backfill._setPaused(true, 'cap');
    await backfill._setState('cap_day', today);
    W.stats.capPauses++;
    console.warn('[BF-WATCH] 单日硬帽触达 ' + backfillN + '/' + INGEST_CAP + '，哨兵暂停补采（cap），明日 00:30 自动恢复');
    return;
  }
  /* ③b 硬帽跨零点自动恢复（user/trial 原因绝不经此路径） */
  if (paused && reason === 'cap') {
    const capDay = await backfill._getState('cap_day');
    if (capDay !== today && _pastHalfPastMidnight()) {
      await backfill._setPaused(false);
      W.stats.capResumes++;
      console.log('[BF-WATCH] 硬帽跨零点自动恢复：昨日 ' + capDay + ' 已到帽，今日 ' + today + ' 00:30 解除，引擎 60s 内续跑');
    }
  }
  /* ④a 实时采集停滞让路 */
  if (!paused && now.getHours() >= YIELD_CHECK_HOUR && backfillN > 2000 && realtimeN < YIELD_FLOOR) {
    await backfill._setPaused(true, 'yield');
    await backfill._setState('yield_day', today);
    W.stats.yieldPauses++;
    console.warn('[BF-WATCH] 实时采集停滞（今日实时 ' + realtimeN + ' < ' + YIELD_FLOOR + '），补采让路暂停（yield）');
    return;
  }
  /* ④b 让路解除：实时量回升或跨日 */
  if (paused && reason === 'yield') {
    const yd = await backfill._getState('yield_day');
    if (realtimeN >= YIELD_RESUME_N || (yd !== today && _pastHalfPastMidnight())) {
      await backfill._setPaused(false);
      W.stats.yieldResumes++;
      console.log('[BF-WATCH] 实时采集恢复（' + realtimeN + '），解除让路，引擎 60s 内续跑');
    }
  }
}

/* ---------- ⑤ 逐日质量门审计 ---------- */
async function _auditDay(day, attempts) {
  const q = async (sql, p) => (await D.query(sql, p)).rows;
  const base = await q(`SELECT count(*) total,
      count(*) FILTER (WHERE COALESCE(data_json->>'title_zh','')='') no_zh,
      count(*) FILTER (WHERE data_json->>'_synthetic'='true' OR data_json->>'_archiveEvent'='true') synthetic,
      count(*) FILTER (WHERE data_json->>'chinaRelated'='true') china
    FROM intel_data WHERE data_json->>'_backfillDay'=$1`, [day]);
  const m = base[0] || {};
  m.total = +m.total || 0; m.no_zh = +m.no_zh || 0; m.synthetic = +m.synthetic || 0; m.china = +m.china || 0;
  const catTop = await q(`SELECT data_type, count(*) n FROM intel_data
    WHERE data_json->>'_backfillDay'=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [day]);
  const ctryTop = await q(`SELECT COALESCE(NULLIF(country,''),'未知') c, count(*) n FROM intel_data
    WHERE data_json->>'_backfillDay'=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [day]);
  m.topCat = catTop[0] ? catTop[0].data_type : '';
  m.topCatN = catTop[0] ? +catTop[0].n : 0;
  m.topCatShare = m.total ? +(m.topCatN / m.total).toFixed(3) : 0;
  m.topCountry = ctryTop[0] ? ctryTop[0].c : '';
  m.topCountryN = ctryTop[0] ? +ctryTop[0].n : 0;
  m.topCountryShare = m.total ? +(m.topCountryN / m.total).toFixed(3) : 0;
  m.zhShare = m.total ? +((m.total - m.no_zh) / m.total).toFixed(3) : 0;
  m.syntheticShare = m.total ? +(m.synthetic / m.total).toFixed(3) : 0;
  m.chinaShare = m.total ? +(m.china / m.total).toFixed(3) : 0;
  /* 质量门（2026-09-08 甲方案·试跑 6 日实测校准）：总量≥800 / 单类≤55% / 单国≤20%
   * / 中文标题≥95% / 合成≤8%。原口径（1200/35%/12%/5%）按双源管线实测净转化
   * （召回~2700 → 40% 死链 + 入库闸拒收）不可达，用户拍板按实测调门，质量基线不变。 */
  const passed = m.total >= 800 && m.topCatShare <= 0.55 && m.topCountryShare <= 0.20
    && m.zhShare >= 0.95 && m.syntheticShare <= 0.08;
  await D.query(`INSERT INTO backfill_audit (day, passed, total, metrics) VALUES ($1,$2,$3,$4)
    ON CONFLICT (day) DO UPDATE SET passed=$2, total=$3, metrics=$4, audited_at=NOW()`,
    [day, passed, m.total, JSON.stringify(m)]);
  const line = '[BF-WATCH] ' + day + (passed ? ' 质量门通过' : ' 质量门未过') + ': total=' + m.total
    + ' topCat=' + m.topCat + '(' + m.topCatShare + ') topCountry=' + m.topCountry + '(' + m.topCountryShare + ')'
    + ' zh=' + m.zhShare + ' syn=' + m.syntheticShare + ' china=' + m.chinaShare;
  if (passed) console.log(line); else console.warn(line);
  /* 事故级空采（<300 条）自动清行重做：直接 SQL 删（不走 API 删除——API 会立墓碑
   * 把同 URL 拦死，重做就永远采不回来）；attempts 上限防死循环乱采 */
  if (m.total < AUDIT_MIN_TOTAL && attempts < DAY_DEAD_ATTEMPTS) {
    const del = await D.query(`DELETE FROM intel_data WHERE data_json->>'_backfillDay'=$1`, [day]);
    await D.query(`UPDATE backfill_progress SET status='pending', note='audit-empty-redo'
      WHERE day=$1 AND attempts < $2`, [day, DAY_DEAD_ATTEMPTS]);
    W.stats.autoRedo++;
    console.warn('[BF-WATCH] ' + day + ' 入库仅 ' + m.total + ' 条（事故级空采），已清 ' + del.rowCount + ' 行并回 pending 重做');
  }
}
async function _auditPending() {
  let days;
  try {
    const r = await D.query(`SELECT p.day, p.attempts FROM backfill_progress p
      LEFT JOIN backfill_audit a ON a.day = p.day
      WHERE p.status='done' AND a.day IS NULL ORDER BY p.day LIMIT 3`);
    days = r.rows;
  } catch (e) { return; }
  for (const row of days) {
    try { await _auditDay(_dk(row.day), row.attempts || 0); W.stats.audits++; }
    catch (e) { console.warn('[BF-WATCH] ' + _dk(row.day) + ' 审计异常:', e.message); }
  }
}

/* ---------- 哨兵主循环 ---------- */
async function _tick() {
  W.ticks++; W.lastTickAt = new Date().toISOString();
  try {
    /* ① 僵死日回收：running >30min 无心跳 → pending（领日原子性保证不双跑） */
    const st = await D.query(`UPDATE backfill_progress SET status='pending',
      note=COALESCE(note,'') || ' |stale-rec'
      WHERE status='running' AND started_at < NOW() - INTERVAL '${STALE_MIN} minutes' RETURNING day`);
    if (st.rows.length) {
      W.stats.staleRecovered += st.rows.length;
      console.warn('[BF-WATCH] 僵死日回收 ' + st.rows.length + ' 个: ' + st.rows.map(r => _dk(r.day)).join(','));
    }
    /* ② 重试封棺：attempts≥5 的 error/partial → dead（终态，不再重试） */
    const dd = await D.query(`UPDATE backfill_progress SET status='dead',
      note=COALESCE(note,'') || ' |dead-attempts'
      WHERE status IN ('error','partial') AND attempts >= $1 RETURNING day`, [DAY_DEAD_ATTEMPTS]);
    if (dd.rows.length) {
      W.stats.deadDays += dd.rows.length;
      console.warn('[BF-WATCH] 重试上限封棺 ' + dd.rows.length + ' 日 → dead: ' + dd.rows.map(r => _dk(r.day)).join(','));
    }
    /* ③④ 硬帽监察 + 实时让路（5min 节流） */
    if (W.ticks % 5 === 1) await _capAndYield();
    /* ⑤ 质量门审计（10min 节流） */
    if (Date.now() - W.lastAuditAt > 10 * 60 * 1000) {
      W.lastAuditAt = Date.now();
      await _auditPending();
    }
  } catch (e) { console.warn('[BF-WATCH] tick 异常:', e.message); }
}

function init(deps) {
  D = deps;
  const app = D.app, auth = D.auth;
  _ensureTables().catch(e => console.warn('[BF-WATCH] 建表/建索引异常:', e.message));

  /* 观测端点（双角色注册；server 进程可查，worker 进程路由不监听） */
  app.get('/api/backfill/watch', auth, async (req, res) => {
    try {
      const paused = await backfill._isPaused();
      const reason = await backfill._getState('pause_reason');
      const audit = (await D.query(`SELECT day, passed, total, metrics, audited_at FROM backfill_audit ORDER BY day DESC LIMIT 30`)).rows;
      const prog = (await D.query(`SELECT status, count(*) n FROM backfill_progress GROUP BY 1 ORDER BY 1`)).rows;
      res.json({
        ok: true, ingestCap: INGEST_CAP, today: W.today,
        paused, pauseReason: reason,
        capDay: await backfill._getState('cap_day'),
        trialLeft: parseInt(await backfill._getState('trial'), 10) || 0,
        progress: prog, audit, stats: W.stats,
        lastTickAt: W.lastTickAt,
        thresholds: { staleMin: STALE_MIN, deadAtAttempts: DAY_DEAD_ATTEMPTS,
          yieldCheckHour: YIELD_CHECK_HOUR, yieldFloor: YIELD_FLOOR, yieldResumeN: YIELD_RESUME_N,
          auditMinTotal: AUDIT_MIN_TOTAL,
          qualityGate: { minTotal: 1200, topCatShare: 0.35, topCountryShare: 0.12, zhShare: 0.95, syntheticShare: 0.05 } }
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* 定向重做（人工处置口）：清当日行（直接 SQL，不立墓碑）+ 回 pending 重选 */
  app.post('/api/backfill/redo', auth, async (req, res) => {
    try {
      const day = String((req.body || {}).day || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'day 须为 YYYY-MM-DD' });
      const del = await D.query(`DELETE FROM intel_data WHERE data_json->>'_backfillDay'=$1`, [day]);
      await D.query(`UPDATE backfill_progress SET status='pending', note='manual-redo', attempts=0 WHERE day=$1`, [day]);
      await D.query(`DELETE FROM backfill_audit WHERE day=$1`, [day]);
      res.json({ ok: true, day, deleted: del.rowCount, note: '已清行并重置账本，引擎将自动重做该日' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* 哨兵看门狗只在 worker 进程跑（与补采引擎同进程；server 进程只暴露观测 API）。
   * 90s 延迟首跳：让引擎 60s 开机自检先走，避免启动期误判。 */
  if (process.env.ORPS_ROLE === 'worker') {
    setTimeout(_tick, 90 * 1000);
    setInterval(_tick, TICK_MS);
    console.log('[BF-WATCH] 补采质量哨兵已上岗（' + (TICK_MS / 1000) + 's/轮：僵死回收/封棺/硬帽/让路/质量门）');
  } else {
    console.log('[BF-WATCH] 补采质量哨兵观测 API 已挂载（看门狗在 worker 进程运行）');
  }
}

module.exports = { init };
