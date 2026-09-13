/**
 * pm2-safe.js — Windows 上 PM2 生命周期的唯一安全入口（#784 任务三，2026-09-13）
 * ================================================================
 * 根因（本轮两次踩坑实锤）：Windows 上 `pm2.restart <app>` 是**不可靠原语**——
 *   ① 它对旧进程树的 kill 不可靠，旧 node 进程常存活并继续 LISTEN 3000；
 *   ② 新进程拉起后 EADDRINUSE → PM2 进入 `waiting restart pid=0` 死循环；
 *   ③ 孤儿进程**照常应答 /api/health=200** → 看门狗与人都被骗过，
 *      表象是「重启了、也绿了」，实际新代码从未加载、PM2 状态已坏。
 *
 * 正解（本脚本固化）：stop/delete → **验证端口真的释放**（不释放就 taskkill）→
 * 显式参数 start（配置单一取源 ecosystem.config.js）→ dump 持久化 → 复核。
 *
 * 用法：
 *   node pm2-safe.js orps-server        安全重启指定应用（唯一推荐方式）
 *   node pm2-safe.js --list             打印 7 应用状态
 *   node pm2-safe.js orps-server --no-dump   跳过 dump（调试用）
 */
'use strict';
const pm2 = require('C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules/pm2');
const { execSync } = require('child_process');
const http = require('http');
const ECOSYSTEM = require('C:/Users/28737/Desktop/新建文件夹/server/ecosystem.config.js');

const PM2_API = ['restart', 'reload', 'stop', 'delete', 'start', 'resurrect'];   /* 文档用 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(m) { console.log('[PM2-SAFE ' + new Date().toISOString() + '] ' + m); }

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

function connect() {
  return new Promise((res, rej) => pm2.connect(e => (e ? rej(e) : res())));
}
function describe(name) {
  return new Promise(res => pm2.describe(name, (e, ps) => {
    if (e || !ps || !ps.length) return res(null);
    const p = ps[0];
    res({ pm_id: p.pm_id, pid: p.pid, status: p.pm2_env && p.pm2_env.status, restarts: p.pm2_env && p.pm2_env.restart_time });
  }));
}
const pStart = cfg => new Promise((res, rej) => pm2.start(cfg, (e, a) => (e ? rej(e) : res(a))));
const pDelete = n => new Promise(res => pm2.delete(n, () => res()));
const pStop = n => new Promise(res => pm2.stop(n, () => res()));
const pDump = () => new Promise(res => pm2.dump(() => res()));

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
 * 安全重启一个 PM2 应用。
 * @param {string} name 应用名（须在 ecosystem.config.js 中有配置）
 * @param {object} [o] {dump:boolean=true, waitMs:number=20000}
 * @returns {Promise<{ok:boolean, steps:string[], status:string, pid:number}>}
 */
async function safeRestart(name, o) {
  o = o || {};
  const steps = [];
  const cfg = (ECOSYSTEM.apps || []).find(a => a.name === name);
  if (!cfg) throw new Error('ecosystem.config.js 中找不到应用 ' + name);
  const port = (cfg.env && cfg.env.PORT) || 3000;
  const step = s => { steps.push(s); log(s); };

  await connect();
  try {
    const before = await describe(name);
    step('[1] 现状 name=' + name + ' status=' + (before && before.status) + ' pid=' + (before && before.pid)
      + ' restarts=' + (before && before.restarts));

    /* 2) 停：waiting-restart 死循环态必须 delete（stop 救不回来）；正常态用 stop */
    if (!before) {
      step('[2] 应用不在 PM2 中 → 直接 start');
    } else if (before.status === 'waiting restart' || before.status === 'stopping' || before.restarts > 40) {
      step('[2] 状态异常（' + before.status + ' / restarts=' + before.restarts + '）→ pm2.delete 清环');
      await pDelete(name);
    } else {
      step('[2] pm2.stop（替代不可靠的 pm2.restart）');
      await pStop(name);
      await sleep(1500);
      const after = await describe(name);
      if (after && after.pid && after.pid > 4) {
        step('[2b] stop 后 pid ' + after.pid + ' 仍存活 → taskkill（Windows 停止不可靠）');
        killPid(after.pid);
        await sleep(1500);
      }
    }

    /* 3) 端口守卫：不释放绝不允许 start（EADDRINUSE 死循环的唯一根因） */
    for (let i = 0; i < 5; i++) {
      const owners = portOwners(port);
      if (!owners.length) { step('[3] 端口 ' + port + ' 已释放'); break; }
      step('[3] 端口 ' + port + ' 仍被占用 PID=' + owners.join(',') + ' → taskkill');
      owners.forEach(killPid);
      await sleep(2000);
      if (i === 4 && portOwners(port).length) throw new Error('端口 ' + port + ' 无法释放，中止（不启动新进程）');
    }

    /* 4) 显式参数 start（配置单一取源 ecosystem.config.js） */
    const app = await pStart(cfg);
    step('[4] started pm_id=' + app[0].pm_id + ' status=' + app[0].pm2_env.status);

    /* 5) dump 持久化（防开机 resurrect 回退旧配置） */
    if (o.dump !== false) { await pDump(); step('[5] pm2.dump 已保存'); }

    /* 6) 复核：状态 online + 端口确实由新 pid 持有 + health */
    const waitMs = o.waitMs || 20000;
    await sleep(Math.min(waitMs, 8000));
    const fin = await describe(name);
    const owners = portOwners(port);
    const owns = owners.length === 1 && owners[0] === fin.pid;
    step('[6] 终态 status=' + (fin && fin.status) + ' pid=' + (fin && fin.pid)
      + ' | 端口 ' + port + ' 占用者=' + owners.join(',') || '-'
      + ' | 端口由新进程持有=' + owns);
    let hOK = null;
    if (cfg.env && cfg.env.PORT && /server/.test(name)) {
      await sleep(Math.max(0, waitMs - 8000));
      hOK = await healthOk(port);
      step('[6b] /api/health = ' + (hOK ? '200 OK' : '未就绪/失败'));
    }
    const ok = fin && fin.status === 'online' && (hOK === null || hOK === true);
    return { ok: !!ok, steps, status: fin && fin.status, pid: fin && fin.pid };
  } finally {
    pm2.disconnect();
  }
}

async function listAll() {
  await connect();
  const list = await new Promise((res, rej) => pm2.list((e, l) => (e ? rej(e) : res(l))));
  console.log('name'.padEnd(20) + 'status'.padEnd(18) + 'pid'.padEnd(8) + 'restarts  uptime');
  for (const p of list) {
    const up = p.pm2_env && p.pm2_env.pm_uptime ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 60000) + 'min' : '-';
    console.log(String(p.name).padEnd(20) + String(p.pm2_env && p.pm2_env.status).padEnd(18)
      + String(p.pid).padEnd(8) + String(p.pm2_env && p.pm2_env.restart_time) + ''.padEnd(2) + up);
  }
  pm2.disconnect();
}

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

module.exports = { safeRestart, portOwners, listAll };
