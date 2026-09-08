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

const INTERVAL_MS = 30 * 1000;
const FAIL_THRESHOLD = 5;
const RESTART_COOLDOWN_MS = 10 * 60 * 1000;
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
    const req = http.get('http://localhost:3000/api/health', { timeout: 8000 }, res => {
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

(async () => {
  log('看门狗启动：' + INTERVAL_MS / 1000 + 's/检，' + FAIL_THRESHOLD + ' 连败介入，冷却 ' + RESTART_COOLDOWN_MS / 60000 + 'min');
  let fails = 0, lastSrvRestart = 0, lastWrkRestart = 0;
  setInterval(async () => {
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
