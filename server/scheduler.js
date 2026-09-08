'use strict';
/**
 * scheduler.js — 统一调度注册表（任务 #712，2026-09-08）
 * ================================================================
 * 背景（L3 哨兵互搏根因）：49 个 setInterval 散落在 14,250 行 server.js 里，
 * 没有统一调度，"全部暂停"天然做不到一处生效；演示模式只能靠每处手写
 * demo-mode.flag 判断，漏一处哨兵就互搏复发。
 *
 * 设计：
 * ① register(name, fn, {interval, klass, firstRunMs}) —— klass ∈
 *    api / collect / report / watch / ai / backfill；
 * ② 暂停三级粒度：全局 / 类级 / 任务级，持久化 tmp/sched-state.json，
 *    重启保持（manual 暂停跨重启存活）；server 与 worker 两进程共享同一份状态文件；
 * ③ 角色亲和（ORPS_ROLE env）：'server' 进程只挂 api/collect/report/watch/ai，
 *    'worker' 进程只挂 backfill（#713 补采/归档独立进程）——同一代码库两种角色，
 *    worker 里的任务在本进程不挂表、由对端进程执行；
 * ④ 单飞：上一轮未结束跳过本轮（防重入堆积）；
 *    运行统计（runs/errors/lastRunAt/lastDurMs/lastError/skips）；
 * ⑤ demo 旗自动换算为类级暂停（by:'demo'）：flag 存在 → collect/report/watch/ai/backfill
 *    五类标 demo 暂停；flag 删除 → by:'demo' 的暂停自动解除（manual 不动）——
 *    "停演示模式"从 N 处 if 变成删一个文件 + 重启；
 * ⑥ 管理端点（server 进程）：GET /api/sched/list、POST /api/sched/pause、
 *    POST /api/sched/resume、POST /api/sched/run（worker 任务经 60s 心跳文件可见/可暂停）；
 * ⑦ 哨兵接入：klassPaused(klass) 供实时性/巡检/调速器等哨兵判断
 *    "采集被主动暂停时零入库是预期，不判故障不自愈"（L3 根修）。
 *
 * 铁律：调度器只负责"何时跑/是否跑"，绝不修改任务业务逻辑。
 */
const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, 'tmp');
const STATE_FILE = path.join(TMP_DIR, 'sched-state.json');
const DEMO_FLAG = path.join(TMP_DIR, 'demo-mode.flag');
const WORKER_HB = path.join(TMP_DIR, 'sched-worker.json');   /* worker 心跳（#713） */

const ROLE = process.env.ORPS_ROLE || 'server';              /* 'server' | 'worker' */
/* 类 → 归属进程：backfill 类只在 worker 进程跑，其余只在 server 进程跑 */
const CLASS_ROLE = {
  api: 'server', collect: 'server', report: 'server',
  watch: 'server', ai: 'server', backfill: 'worker'
};
const DEMO_PAUSE_CLASSES = ['collect', 'report', 'watch', 'ai', 'backfill'];

/* ---------- 状态持久化（mtime 缓存 + 原子写） ---------- */
let _stateCache = null, _stateMtime = -1;
function _defaultState() { return { globalPaused: false, classPaused: {}, taskPaused: {} }; }
function _loadState(force) {
  try {
    const st = fs.statSync(STATE_FILE);
    if (!force && _stateCache && st.mtimeMs === _stateMtime) return _stateCache;
    _stateMtime = st.mtimeMs;
    _stateCache = Object.assign(_defaultState(), JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    if (!_stateCache.classPaused) _stateCache.classPaused = {};
    if (!_stateCache.taskPaused) _stateCache.taskPaused = {};
  } catch (e) {
    if (!_stateCache) _stateCache = _defaultState();
  }
  return _stateCache;
}
function _saveState() {
  try {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_stateCache, null, 1));
    fs.renameSync(tmp, STATE_FILE);
    _stateMtime = fs.statSync(STATE_FILE).mtimeMs;
  } catch (e) { console.warn('[SCHED] 状态写入失败:', e.message); }
}

/* ---------- demo 旗 → 类级暂停 换算（幂等，server/worker 都可执行） ---------- */
function _demoBootstrap() {
  let s = _loadState(true), dirty = false;
  const demoOn = (() => { try { return fs.existsSync(DEMO_FLAG); } catch (e) { return false; } })();
  for (const cls of DEMO_PAUSE_CLASSES) {
    const cur = s.classPaused[cls];
    if (demoOn && !(cur && cur.on)) {
      s.classPaused[cls] = { on: true, by: 'demo', at: new Date().toISOString() }; dirty = true;
    } else if (!demoOn && cur && cur.on && cur.by === 'demo') {
      delete s.classPaused[cls]; dirty = true;
    }
  }
  if (dirty) _saveState();
  return demoOn;
}

/* ---------- 任务注册表 ---------- */
const tasks = new Map();

function register(name, fn, opts) {
  opts = opts || {};
  if (tasks.has(name)) { console.warn('[SCHED] 重复注册被拒:', name); return tasks.get(name); }
  const t = {
    name, fn,
    interval: opts.interval || 0,
    klass: opts.klass || 'collect',
    firstRunMs: (opts.firstRunMs === undefined || opts.firstRunMs === null) ? null : opts.firstRunMs,
    owner: CLASS_ROLE[opts.klass || 'collect'] || 'server',
    timer: null, firstTimer: null, running: false,
    runs: 0, errors: 0, skips: 0, lastRunAt: null, lastDurMs: null, lastError: null
  };
  tasks.set(name, t);
  _arm(t);
  return t;
}

/* 只在归属进程挂表（角色不符：注册进登记册但不跑，由对端进程执行） */
function _arm(t) {
  if (!t.interval) return;
  if (CLASS_ROLE[t.klass] !== ROLE) return;
  if (t.firstRunMs !== null && t.firstRunMs >= 0) {
    t.firstTimer = setTimeout(() => { _tick(t); }, t.firstRunMs);
    if (t.firstTimer.unref) t.firstTimer.unref();
  }
  t.timer = setInterval(() => { _tick(t); }, t.interval);
}

async function _tick(t, ignorePause) {
  if (t.running) return;                       /* 单飞：上轮未完跳过本轮 */
  if (!ignorePause && effectivePaused(t.name, t.klass)) { t.skips++; return; }
  t.running = true; t.lastRunAt = Date.now();
  try { await t.fn(); t.runs++; }
  catch (e) { t.errors++; t.lastError = String(e && e.message || e); }
  finally { t.lastDurMs = Date.now() - t.lastRunAt; t.running = false; }
}

/* ---------- 暂停判定（哨兵/任务共用） ---------- */
function effectivePaused(taskName, klass) {
  const s = _loadState();
  if (s.globalPaused) return true;
  const c = klass && s.classPaused[klass];
  if (c && c.on) return true;
  const t = taskName && s.taskPaused[taskName];
  return !!(t && t.on);
}
/* 哨兵接口：某类是否被主动暂停（全局暂停同样算暂停） */
function klassPaused(klass) { return effectivePaused(null, klass); }
/* 启动期接口：本进程是否应挂某类任务（角色亲和） */
function roleAllows(klass) { return (CLASS_ROLE[klass] || 'server') === ROLE; }

/* ---------- 暂停/恢复（三级 scope） ---------- */
function _parseScope(scope, name) {
  scope = String(scope || '');
  if (scope === 'global') return { ok: true };
  if ((scope === 'class' || scope === 'task') && name) return { ok: true, name };
  return { ok: false, error: "scope 须为 global|class|task（class/task 须带 name）" };
}
function pause(scope, name, by) {
  const p = _parseScope(scope, name);
  if (!p.ok) return p;
  const s = _loadState(true);
  const at = new Date().toISOString();
  if (scope === 'global') s.globalPaused = true;
  else if (scope === 'class') s.classPaused[p.name] = { on: true, by: by || 'manual', at };
  else s.taskPaused[p.name] = { on: true, by: by || 'manual', at };
  _saveState();
  console.log('[SCHED] 暂停 ' + scope + (p.name ? ':' + p.name : '') + '（by ' + (by || 'manual') + '）');
  return { ok: true };
}
function resume(scope, name) {
  const p = _parseScope(scope, name);
  if (!p.ok) return p;
  const s = _loadState(true);
  if (scope === 'global') s.globalPaused = false;
  else if (scope === 'class') delete s.classPaused[p.name];
  else delete s.taskPaused[p.name];
  _saveState();
  console.log('[SCHED] 恢复 ' + scope + (p.name ? ':' + p.name : ''));
  return { ok: true };
}

/* ---------- 状态输出（server 端点用；合并 worker 心跳） ---------- */
function _taskStatus(t) {
  return {
    name: t.name, klass: t.klass, owner: t.owner,
    intervalMs: t.interval, firstRunMs: t.firstRunMs,
    inThisProcess: CLASS_ROLE[t.klass] === ROLE,
    running: t.running, runs: t.runs, errors: t.errors, skips: t.skips,
    lastRunAt: t.lastRunAt, lastDurMs: t.lastDurMs, lastError: t.lastError,
    paused: effectivePaused(t.name, t.klass)
  };
}
function _workerHeartbeat() {
  try {
    const hb = JSON.parse(fs.readFileSync(WORKER_HB, 'utf8'));
    if (hb && hb.at && Date.now() - new Date(hb.at).getTime() < 5 * 60 * 1000) return hb;
    return hb ? Object.assign({}, hb, { stale: true }) : null;
  } catch (e) { return null; }
}
function status() {
  const s = _loadState();
  const out = [];
  tasks.forEach(t => out.push(_taskStatus(t)));
  const hb = _workerHeartbeat();
  if (hb && hb.tasks) {
    for (const [n, st] of Object.entries(hb.tasks)) {
      const local = tasks.get(n);
      /* 本进程登记（若有）先入，worker 心跳真实统计后入覆盖 */
      out.push(Object.assign(
        local ? _taskStatus(local) : { name: n, klass: 'backfill', owner: 'worker' },
        st, { heartbeat: true, paused: effectivePaused(n, 'backfill') }
      ));
    }
  }
  return {
    role: ROLE,
    globalPaused: s.globalPaused,
    classPaused: s.classPaused,
    taskPaused: s.taskPaused,
    workerHeartbeat: hb,
    tasks: out
  };
}

/* worker 进程心跳：每 60s 落盘本进程 backfill 类任务统计（供 /api/sched/list 合并展示） */
function _startWorkerHeartbeat() {
  if (ROLE !== 'worker') return;
  const write = () => {
    try {
      const t = {};
      tasks.forEach(x => { if (x.klass === 'backfill') t[x.name] = _taskStatus(x); });
      fs.writeFileSync(WORKER_HB, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, tasks: t }));
    } catch (e) {}
  };
  write();
  setInterval(write, 60 * 1000);
  process.on('exit', () => { try { fs.unlinkSync(WORKER_HB); } catch (e) {} });
}

/* ---------- 管理端点（仅 server 进程有 HTTP，attach 由 server.js 调用） ---------- */
function attach(app, auth) {
  app.get('/api/sched/list', (req, res) => {
    try { res.json(Object.assign({ ok: true }, status())); }
    catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
  });
  app.post('/api/sched/pause', auth, (req, res) => {
    const r = pause(req.body && req.body.scope, req.body && req.body.name, 'api');
    res.status(r.ok ? 200 : 400).json(Object.assign({ ok: r.ok }, r.ok ? status() : { error: r.error }));
  });
  app.post('/api/sched/resume', auth, (req, res) => {
    const r = resume(req.body && req.body.scope, req.body && req.body.name);
    res.status(r.ok ? 200 : 400).json(Object.assign({ ok: r.ok }, r.ok ? status() : { error: r.error }));
  });
  /* 立即手动跑一次（仅本进程任务；worker 任务请在 worker 侧等下一 tick） */
  app.post('/api/sched/run', auth, async (req, res) => {
    const name = req.body && req.body.name;
    const t = tasks.get(name);
    if (!t) return res.status(404).json({ ok: false, error: '未知任务: ' + name });
    if (CLASS_ROLE[t.klass] !== ROLE) return res.status(400).json({ ok: false, error: '任务属 ' + CLASS_ROLE[t.klass] + ' 进程，本端点不可触发' });
    if (t.running) return res.json({ ok: false, error: '上一轮尚未结束' });
    res.json({ ok: true, started: name });
    _tick(t, true); /* 手动触发绕过类暂停（诊断/补跑场景） */
  });
}

/* ---------- 启动 ---------- */
const demoOn = _demoBootstrap();
_startWorkerHeartbeat();
if (demoOn) console.log('[SCHED] 检测到 demo-mode.flag：collect/report/watch/ai/backfill 五类已标 demo 暂停（删旗重启自动解除）');
console.log('[SCHED] 统一调度注册表就绪（role=' + ROLE + '，注册表随任务注册填充）');

module.exports = { register, pause, resume, status, attach, klassPaused, effectivePaused, roleAllows, ROLE };
