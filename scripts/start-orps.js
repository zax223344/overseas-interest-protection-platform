/**
 * scripts/start-orps.js — 登录自启引导（由计划任务 ORPS-ServerBoot-User 调用）
 * 职责：① 拉起便携版 PostgreSQL（已在跑则跳过）② PM2 拉起 orps-server
 * 幂等：重复执行不会产生重复进程。无需管理员权限。
 */
'use strict';
const { execFileSync, spawn } = require('child_process');

const PGCTL = 'C:\\Users\\28737\\pgsql\\bin\\pg_ctl.exe';
const PGDATA = 'C:\\Users\\28737\\pgsql\\data';
const PGLOG = 'C:\\Users\\28737\\pgsql\\pg.log';
const PM2 = 'C:\\Users\\28737\\.workbuddy\\binaries\\node\\workspace\\node_modules\\pm2\\bin\\pm2';
const SERVER_DIR = 'C:\\Users\\28737\\Desktop\\新建文件夹\\server';

function log(m) { try { require('fs').appendFileSync('C:\\Users\\28737\\Desktop\\新建文件夹\\scripts\\start-orps.log', new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} }

/* 1. PostgreSQL */
try {
  execFileSync(PGCTL, ['status', '-D', PGDATA], { stdio: 'ignore' });
  log('PG already running');
} catch (e) {
  try {
    execFileSync(PGCTL, ['start', '-D', PGDATA, '-l', PGLOG, '-w', '-t', '60'], { stdio: 'ignore' });
    log('PG started');
  } catch (e2) { log('PG start failed: ' + e2.message); }
}

/* 2. PM2 + orps-server（清代理环境，防 PM2 God 被污染导致 DB 超时） */
const env = Object.assign({}, process.env);
['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_OPTIONS'].forEach(k => delete env[k]);
env.NODE_PATH = 'C:\\Users\\28737\\.workbuddy\\binaries\\node\\workspace\\node_modules';
try {
  const child = spawn(process.execPath, [PM2, 'start', 'ecosystem.config.js'], { cwd: SERVER_DIR, env, detached: true, stdio: 'ignore' });
  child.unref();
  log('PM2 start dispatched');
} catch (e) { log('PM2 start failed: ' + e.message); }
