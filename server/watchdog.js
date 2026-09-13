/* #712 P0-3 外部看门狗：独立于 orps-server 进程，health 连续 5 败（30s×5≈2.5min）即介入。
 * 与 #656 orps-pg-keepalive 分工互补不冲突：pg-keepalive 管 PM2 God/PG 死亡（基建层，
 * 恢复手段=pm2 start ecosystem，God 活着时幂等跳过）；本看门狗管应用层故障——
 * ① 进程活着但事件循环卡死（health 死而 PM2 状态 online，pm2 start 无效，须 pm2.restart）
 * ② Windows 僵尸占 3000 端口导致连环 EADDRINUSE（须先 taskkill 僵尸再 restart）
 * ③ orps-workers 心跳停更（补采进程挂死）。God 死亡时本脚本的 pm2.connect 会失败，
 * 由 pg-keepalive 拉起 God 后本脚本自然恢复接管。
 * 恢复序列（针对 L2 连环 EADDRINUSE 设计）：
 *   ① pm2.restart orps-server → 等 60s 探活
 *   ② 仍死 → netstat 查 3000 端口占用 PID，若非 PM2 托管 pid（Windows 僵尸）→ taskkill /F → 再 restart
 * 冷却 10min 防 restart 风暴；worker 心跳文件 5min 不更新 → restart orps-workers（独立冷却）。
 * 全程写 logs/watchdog.log，事件同时打印 stdout（PM2 收集）。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const pm2 = require('C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules/pm2');
/* #784 任务三（2026-09-13）：Windows 上 pm2.restart 会留孤儿进程占 3000 端口
 * （孤儿照常应答 health=200，PM2 侧却卡 waiting-restart 死循环）。
 * pm2-safe.js = stop→端口守卫→显式 start→dump→复核 的唯一安全入口。 */
const { safeRestart } = require('./pm2-safe');

const INTERVAL_MS = 30 * 1000;
const FAIL_THRESHOLD = 5;
const RESTART_COOLDOWN_MS = 10 * 60 * 1000;
/* #784：PM2 状态异常而 health 正常（孤儿进程 serving）的判定阈值与冷却 */
const STUCK_THRESHOLD = 6;                       /* 6 检 × 30s = 3min */
const STUCK_COOLDOWN_MS = 15 * 60 * 1000;
const HB_FILE = path.join(__dirname, 'tmp', 'sched-worker.json');
const HB_STALE_MS = 5 * 60 * 1000;
const LOGF = path.join(__dirname, 'logs', 'watchdog.log');

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log('[WATCHDOG] ' + msg);
  try { fs.appendFileSync(LOGF, line + '\n'); } catch (e) {}
}
function checkHealth() {
  return new Promise(resolve => {
    const req = http.get('http://localhost:3000/api/health', { timeout: 15000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(res.statusCode === 200 && JSON.parse(body).status === 'ok'); }
        catch (e) { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
function pm2Exec(fn) {
  return new Promise(resolve => {
    pm2.connect(err => {
      if (err) { log('pm2 connect 失败: ' + err.message); return resolve(null); }
      fn((e, res) => { pm2.disconnect(); resolve(e ? { err: e.message } : res); });
    });
  });
}
function pm2Restart(name) { return pm2Exec(cb => pm2.restart(name, cb)); }
function pm2Status(name) {
  return new Promise(resolve => {
    pm2.connect(err => {
      if (err) return resolve(null);
      pm2.describe(name, (e, procs) => {
        pm2.disconnect();
        resolve(!e && procs && procs[0] && procs[0].pm2_env ? procs[0].pm2_env.status : null);
      });
    });
  });
}
function pm2Pid(name) {
  return new Promise(resolve => {
    pm2.connect(err => {
      if (err) return resolve(null);
      pm2.describe(name, (e, procs) => {
        pm2.disconnect();
        resolve(!e && procs && procs[0] ? procs[0].pid : null);
      });
    });
  });
}
function portOwnerPid(port) {
  return new Promise(resolve => {
    exec('netstat -ano | findstr :' + port + ' | findstr LISTENING', { shell: 'cmd.exe' }, (e, out) => {
      if (e || !out) return resolve(null);
      const pids = new Set();
      for (const ln of String(out).split('\n')) {
        const m = ln.trim().match(/(\d+)\s*$/);
        if (m) pids.add(Number(m[1]));
      }
      resolve(pids.size ? Array.from(pids) : null);
    });
  });
}
function taskKill(pid) {
  return new Promise(resolve => {
    exec('taskkill /F /PID ' + pid, { shell: 'cmd.exe' }, e => resolve(!e));
  });
}

/* ---------- #780 日志轮转兜底（2026-09-12） ----------
 * 事故：ecosystem.config.js 里的 `log_max_size: '10M'` / `log_retain: 5` **不是 PM2 原生参数**
 * （轮转须装 pm2-logrotate 模块），实测形同虚设 → logs/ 下累积 874MB
 * （pm2-combined.log 458MB + pm2-out.log 333MB + …），既压磁盘又抬高 God 内存。
 * pm2-logrotate 已安装为主力；但重启后引导链走的是 `pm2 start ecosystem.config.js`
 * 而非 `pm2 resurrect`，**模块不一定被恢复**，故此处再放一个零依赖的兜底轮转：
 * 超过 ROTATE_MB 即「保留尾部 KEEP_MB 现场 + 截断」，上限 6 文件 × KEEP ≈ 30MB。 */
const ROT_DIR = path.join(__dirname, 'logs');
const ROTATE_MB = 50;
const KEEP_BYTES = 5 * 1024 * 1024;
function rotateLogs() {
  let files;
  try { files = fs.readdirSync(ROT_DIR); } catch (e) { return; }
  for (const f of files) {
    if (!/^pm2-.*\.log$/.test(f)) continue;           /* 只轮转 PM2 输出的通道日志 */
    const p = path.join(ROT_DIR, f);
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.size < ROTATE_MB * 1024 * 1024) continue;
    try {
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(KEEP_BYTES);
      fs.readSync(fd, buf, 0, KEEP_BYTES, st.size - KEEP_BYTES);
      fs.closeSync(fd);
      /* O_APPEND 下先截断再写回尾部：PM2 后续追加无缝衔接 */
      const w = fs.openSync(p, 'w');
      fs.writeSync(w, buf);
      fs.closeSync(w);
      log('★ 日志轮转 ' + f + ' ' + (st.size / 1048576).toFixed(0) + 'MB -> ' + (KEEP_BYTES / 1048576) + 'MB（保留尾部现场）');
    } catch (e) { log('日志轮转失败 ' + f + ': ' + e.message); }
  }
}

(async () => {
  log('看门狗启动：' + INTERVAL_MS / 1000 + 's/检，' + FAIL_THRESHOLD + ' 连败介入，冷却 ' + RESTART_COOLDOWN_MS / 60000 + 'min');
  let fails = 0, lastSrvRestart = 0, lastWrkRestart = 0, stuckCnt = 0, lastStuckFix = 0;
  setInterval(async () => {
    /* --- #780 日志体量兜底轮转（先做，避免日志膨胀本身成为故障源） --- */
    try { rotateLogs(); } catch (e) {}

    /* --- 主服务健康 --- */
    const ok = await checkHealth();
    if (ok) {
      if (fails > 0) log('健康恢复（此前连败 ' + fails + ' 次）');
      fails = 0;
    } else {
      fails++;
      log('health 失败 ' + fails + '/' + FAIL_THRESHOLD);
      if (fails >= FAIL_THRESHOLD && Date.now() - lastSrvRestart > RESTART_COOLDOWN_MS) {
        lastSrvRestart = Date.now();
        log('★ 介入恢复：pm2.restart orps-server');
        await pm2Restart('orps-server');
        await new Promise(s => setTimeout(s, 60 * 1000));
        if (await checkHealth()) { log('恢复成功（一次 restart 即愈）'); return; }
        /* 二段：端口被 Windows 僵尸占住（L2 连环 EADDRINUSE 根因） */
        log('一段恢复无效，排查 3000 端口占用者');
        const owners = await portOwnerPid(3000);
        const pm2pid = await pm2Pid('orps-server');
        log('端口占用 PID=' + JSON.stringify(owners) + ' | PM2 托管 pid=' + pm2pid);
        if (owners && owners.some(p => p !== pm2pid)) {
          for (const p of owners) {
            if (p !== pm2pid && p > 4) {
              const killed = await taskKill(p);
              log('强杀非托管僵尸 PID ' + p + ' -> ' + (killed ? '成功' : '失败'));
            }
          }
          await new Promise(s => setTimeout(s, 3000));
        }
        await pm2Restart('orps-server');
        await new Promise(s => setTimeout(s, 45 * 1000));
        log('二段恢复完成，health=' + (await checkHealth() ? 'OK' : '仍死（等下轮冷却窗口）'));
      }
    }
    /* --- #784 孤儿进程 / waiting-restart 死循环检测（health 正常但 PM2 状态坏） ---
     * 这是 pm2.restart 事故的盲区：旧进程活着应答 health=200，新进程永远起不来。
     * 判据：health OK 且 orps-server 的 PM2 status != 'online' 连续 6 检 → pm2-safe 恢复。 */
    try {
      const st = await pm2Status('orps-server');
      if (ok && st && st !== 'online') {
        stuckCnt++;
        log('PM2 状态异常 ' + st + ' 而 health 正常（' + stuckCnt + '/' + STUCK_THRESHOLD + '，疑孤儿进程占端口）');
        if (stuckCnt >= STUCK_THRESHOLD && Date.now() - lastStuckFix > STUCK_COOLDOWN_MS) {
          lastStuckFix = Date.now();
          log('★ 介入：orps-server 疑似 pm2.restart 孤儿/死循环 → pm2-safe.js 安全重启');
          try { const r = await safeRestart('orps-server'); log('pm2-safe 完成 ok=' + r.ok + ' status=' + r.status + ' pid=' + r.pid); }
          catch (e) { log('pm2-safe 失败: ' + e.message); }
          stuckCnt = 0;
        }
      } else if (st === 'online') {
        stuckCnt = 0;
      }
    } catch (e) { /* PM2 不可达时交给 pg-keepalive */ }

    /* --- worker 心跳 --- */
    try {
      const st = fs.statSync(HB_FILE);
      if (Date.now() - st.mtimeMs > HB_STALE_MS && Date.now() - lastWrkRestart > RESTART_COOLDOWN_MS) {
        lastWrkRestart = Date.now();
        log('★ worker 心跳停更 ' + Math.round((Date.now() - st.mtimeMs) / 60000) + 'min，pm2.restart orps-workers');
        await pm2Restart('orps-workers');
      }
    } catch (e) { /* 心跳文件不存在：worker 未启动或首次未写，忽略 */ }
  }, INTERVAL_MS);
})();
