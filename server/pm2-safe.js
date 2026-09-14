/**
 * pm2-safe.js — Windows 上 PM2 生命周期的唯一安全入口（#784 任务三，2026-09-13；#792 全面 CLI 化）
 * ================================================================
 * 根因（本轮三次踩坑实锤）：Windows 上 `pm2.restart <app>` 是**不可靠原语**——
 *   ① 它对旧进程树的 kill 不可靠，旧 node 进程常存活并继续 LISTEN 3000；
 *   ② 新进程拉起后 EADDRINUSE → PM2 进入 `waiting restart pid=0` 死循环；
 *   ③ 孤儿进程**照常应答 /api/health=200** → 看门狗与人都被骗过，
 *      表象是「重启了、也绿了」，实际新代码从未加载、PM2 状态已坏。
 *
 * #792（2026-09-14）弃用进程内 pm2 库：pm2 5.x Client 存在 sock-null 竞态
 *   （disconnect 与下一次 connect 相邻时，axon socket 事件回调同步抛 TypeError，
 *   不在 promise 链上，调用方 try/catch 接不住）。被 watchdog require 后，
 *   13 次「★介入」全部在 pm2.connect 阶段被该异常打断成空转。
 *   正解：所有 PM2 操作一律走 CLI 子进程（pm2 jlist/stop/delete/start/dump），
 *   就算 pm2 客户端崩也崩在子进程里，波及不了调用方。
 *
 * 用法：
 *   node pm2-safe.js orps-server        安全重启指定应用（唯一推荐方式）
 *   node pm2-safe.js --list             打印全部应用状态
 *   node pm2-safe.js orps-server --no-dump   跳过 dump（调试用）
 */
'use strict';
const { execSync } = require('child_process');
const http = require('http');
const ECOSYSTEM_PATH = 'C:/Users/28737/Desktop/新建文件夹/server/ecosystem.config.js';
const ECOSYSTEM = require(ECOSYSTEM_PATH);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(m) { console.log('[PM2-SAFE ' + new Date().toISOString() + '] ' + m); }

/** CLI 子进程执行 pm2 命令（崩溃隔离在子进程）。
 * #792 实锤：cmd.exe 子进程 PATH 里没有 pm2 shim（"不是内部或外部命令"），
 * 且 #790 内存护栏 pm2Monit 因此一直静默失败从未生效——必须显式 node+bin 路径。 */
const NODE_BIN = 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe';
const PM2_BIN = 'C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2';
function pm2cli(args, timeoutMs) {
  return execSync('"' + NODE_BIN + '" "' + PM2_BIN + '" ' + args, { shell: 'cmd.exe', encoding: 'utf8', timeout: timeoutMs || 30000 });
}

/** 全部应用状态（pm2 jlist 解析） */
function jlist() {
  try {
    const raw = String(pm2cli('jlist', 20000)).trim();
    const s = raw.indexOf('[');
    return JSON.parse(s >= 0 ? raw.slice(s) : raw);
  } catch (e) { log('pm2 jlist 失败: ' + (e.message || '').split('\n')[0]); return []; }
}

function describe(name) {
  const p = jlist().find(x => x && x.name === name);
  if (!p || !p.pm2_env) return null;
  return { pm_id: p.pm_id, pid: p.pid, status: p.pm2_env.status, restarts: p.pm2_env.restart_time };
}

/** 端口占用者 PID 列表（LISTENING） */
function portOwners(port) {
  const pids = [];
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 20000 });
    String(out).split(/\r?\n/).forEach(line => {
      if (new RegExp(':' + port + '\\s').test(line) && /LISTENING/i.test(line)) {
        const m = line.trim().match(/(\d+)\s*$/);
        if (m && Number(m[1]) > 4) pids.push(Number(m[1]));
      }
    });
  } catch (e) { log('netstat 失败: ' + e.message); }
  return [...new Set(pids)];
}

function killPid(pid) {
  try { execSync('taskkill /F /PID ' + pid, { encoding: 'utf8', timeout: 15000 }); return true; }
  catch (e) { log('taskkill ' + pid + ' 失败: ' + (e.message || '').split('\n')[0]); return false; }
}

function healthOk(port) {
  return new Promise(resolve => {
    const req = http.get('http://localhost:' + port + '/api/health', { timeout: 10000 }, r => {
      let b = ''; r.on('data', c => { b += c; });
      r.on('end', () => { try { resolve(r.statusCode === 200 && JSON.parse(b).status === 'ok'); } catch (e) { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/**
 * 安全重启一个 PM2 应用（全程 CLI 子进程，无进程内 pm2 库）。
 * @param {string} name 应用名（须在 ecosystem.config.js 中有配置）
 * @param {object} [o] {dump:boolean=true, waitMs:number=20000}
 * @returns {Promise<{ok:boolean, steps:string[], status:string, pid:number}>}
 */
async function safeRestart(name, o) {
  o = o || {};
  const steps = [];
  const cfg = (ECOSYSTEM.apps || []).find(a => a.name === name);
  if (!cfg) throw new Error('ecosystem.config.js 中找不到应用 ' + name);
  /* #791：只有显式声明 PORT 的应用才守端口；无 PORT 的应用（watchdog/workers 等）
     守 3000 会把真正的 orps-server 误杀（2026-09-14 实锤）。 */
  const port = (cfg.env && cfg.env.PORT) || null;
  const step = s => { steps.push(s); log(s); };

  const before = describe(name);
  step('[1] 现状 name=' + name + ' status=' + (before && before.status) + ' pid=' + (before && before.pid)
    + ' restarts=' + (before && before.restarts));

  /* 2) 停：waiting-restart 死循环态必须 delete（stop 救不回来）；正常态用 stop */
  if (!before) {
    step('[2] 应用不在 PM2 中 → 直接 start');
  } else if (before.status === 'waiting restart' || before.status === 'stopping' || before.restarts > 40) {
    step('[2] 状态异常（' + before.status + ' / restarts=' + before.restarts + '）→ pm2 delete 清环');
    try { pm2cli('delete ' + name); } catch (e) { step('[2] delete 输出: ' + (e.message || '').split('\n')[0]); }
  } else {
    step('[2] pm2 stop（替代不可靠的 pm2.restart）');
    try { pm2cli('stop ' + name); } catch (e) { step('[2] stop 输出: ' + (e.message || '').split('\n')[0]); }
    await sleep(1500);
    const after = describe(name);
    if (after && after.pid && after.pid > 4) {
      step('[2b] stop 后 pid ' + after.pid + ' 仍存活 → taskkill（Windows 停止不可靠）');
      killPid(after.pid);
      await sleep(1500);
    }
  }

  /* 3) 端口守卫：不释放绝不允许 start（EADDRINUSE 死循环的唯一根因）；无 PORT 声明则跳过 */
  if (!port) {
    step('[3] 应用未声明 PORT → 跳过端口守卫（不杀任何端口占用者）');
  } else {
    for (let i = 0; i < 5; i++) {
      const owners = portOwners(port);
      if (!owners.length) { step('[3] 端口 ' + port + ' 已释放'); break; }
      step('[3] 端口 ' + port + ' 仍被占用 PID=' + owners.join(',') + ' → taskkill');
      owners.forEach(killPid);
      await sleep(2000);
      if (i === 4 && portOwners(port).length) throw new Error('端口 ' + port + ' 无法释放，中止（不启动新进程）');
    }
  }

  /* 4) 显式 start（配置单一取源 ecosystem.config.js，--only 指定应用） */
  let startOut = '';
  try { startOut = String(pm2cli('start "' + ECOSYSTEM_PATH + '" --only ' + name, 40000)); }
  catch (e) { startOut = (e.message || ''); step('[4] start 异常: ' + startOut.split('\n')[0]); }
  const started = /online/.test(startOut) || /\[pm2\] apply/.test(startOut) || startOut.length > 0;
  step('[4] started=' + started);

  /* 5) dump 持久化（防开机 resurrect 回退旧配置） */
  if (o.dump !== false) { try { pm2cli('dump', 30000); step('[5] pm2 dump 已保存'); } catch (e) { step('[5] dump 失败: ' + (e.message || '').split('\n')[0]); } }

  /* 6) 复核：状态 online + 端口确实由新 pid 持有 + health */
  const waitMs = o.waitMs || 20000;
  await sleep(Math.min(waitMs, 8000));
  const fin = describe(name);
  const owners = port ? portOwners(port) : [];
  const owns = port ? (owners.length === 1 && owners[0] === fin.pid) : null;
  step('[6] 终态 status=' + (fin && fin.status) + ' pid=' + (fin && fin.pid)
    + ' | 端口 ' + (port || '-') + ' 占用者=' + (owners.join(',') || '-')
    + ' | 端口由新进程持有=' + owns);
  let hOK = null;
  if (cfg.env && cfg.env.PORT && /server/.test(name)) {
    await sleep(Math.max(0, waitMs - 8000));
    hOK = await healthOk(port);
    step('[6b] /api/health = ' + (hOK ? '200 OK' : '未就绪/失败'));
  }
  const ok = fin && fin.status === 'online' && (hOK === null || hOK === true);
  return { ok: !!ok, steps, status: fin && fin.status, pid: fin && fin.pid };
}

async function listAll() {
  const list = jlist();
  console.log('name'.padEnd(20) + 'status'.padEnd(18) + 'pid'.padEnd(8) + 'restarts  uptime');
  for (const p of list) {
    const up = p.pm2_env && p.pm2_env.pm_uptime ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 60000) + 'min' : '-';
    console.log(String(p.name).padEnd(20) + String(p.pm2_env && p.pm2_env.status).padEnd(18)
      + String(p.pid).padEnd(8) + String(p.pm2_env && p.pm2_env.restart_time) + ''.padEnd(2) + up);
  }
}

/* CLI 入口仅在本文件被直接执行时运行；被 require（如 watchdog.js #790）时绝不执行，
   否则 process.exit(0) 会把调用方进程一并杀死（watchdog 631 次崩溃的根因）。 */
if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    if (!arg || arg === '--help' || arg === '-h') {
      console.log('用法: node pm2-safe.js <appName>      安全重启（Windows 唯一推荐方式，勿用 pm2.restart）\n'
        + '      node pm2-safe.js --list        查看全部应用状态');
      process.exit(0);
    }
    if (arg === '--list') { await listAll(); process.exit(0); }
    const r = await safeRestart(arg);
    console.log('\n结果: ' + (r.ok ? '✓ 成功' : '✗ 失败') + ' status=' + r.status + ' pid=' + r.pid);
    process.exit(r.ok ? 0 : 1);
  })().catch(e => { console.error('[PM2-SAFE] ERR', e && e.message); process.exit(1); });
}

module.exports = { safeRestart, portOwners, listAll, jlist, describe };
