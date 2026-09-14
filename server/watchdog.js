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
/* #792：pm2-safe.js 已全面 CLI 化（jlist/describe 等走 pm2 jlist 子进程），
 * watchdog 一并弃用进程内 pm2 库——sock-null 竞态曾把 13 次「介入」打断成空转。 */
const { safeRestart, describe: pm2DescribeCli } = require('./pm2-safe');
const { execSync } = require('child_process');

/* #791（2026-09-14）：pm2 库 5.x 竞态 bug——connect 回调里 self.client.sock 为 null
 * 时在 socket 事件回调同步抛 TypeError，try/catch 接不住 → uncaughtException 杀进程
 * （watchdog 两小时崩 631 次的根因之一）。看门狗自身绝不允许被依赖库拖死：
 * 拦截后记日志继续跑。 */
process.on('uncaughtException', e => {
  try { log('uncaughtException 已拦截（看门狗不退出）: ' + ((e && e.stack) || e)); } catch (_) {}
});
process.on('unhandledRejection', e => {
  try { log('unhandledRejection 已拦截（看门狗不退出）: ' + ((e && e.stack) || e)); } catch (_) {}
});

const INTERVAL_MS = 30 * 1000;
const FAIL_THRESHOLD = 5;
const RESTART_COOLDOWN_MS = 10 * 60 * 1000;
/* #784：PM2 状态异常而 health 正常（孤儿进程 serving）的判定阈值与冷却 */
const STUCK_THRESHOLD = 6;                       /* 6 检 × 30s = 3min */
const STUCK_COOLDOWN_MS = 5 * 60 * 1000;
/* #790：内存膨胀护栏（rss 持续超限 → pm2-safe 重启） */
const MEM_THRESHOLD_MB = 3000;
const MEM_HARD_MB = 3200;                        /* #792 硬顶：超过即立即熔断，不等 5 连检 */
const MEM_CHECKS = 5;                            /* 5 检 × 30s = 2.5min 持续超限才动手 */
const MEM_COOLDOWN_MS = 30 * 60 * 1000;
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
/* #792：以下三个函数全部改走 CLI 子进程，不再触碰 pm2 lib（sock-null 竞态源）。
 * 路径必须显式 node+bin——cmd 子进程 PATH 无 pm2 shim（#792 实锤）。 */
const NODE_BIN = 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe';
const PM2_BIN = 'C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2';
function pm2Restart(name) {
  return new Promise(resolve => {
    try {
      execSync('"' + NODE_BIN + '" "' + PM2_BIN + '" restart ' + name, { shell: 'cmd.exe', encoding: 'utf8', timeout: 30000 });
      resolve({ ok: true });
    } catch (e) { resolve({ err: (e.message || '').split('\n')[0] }); }
  });
}
function pm2Status(name) {
  return new Promise(resolve => {
    const d = pm2DescribeCli(name);
    resolve(d ? d.status : null);
  });
}
function pm2Pid(name) {
  return new Promise(resolve => {
    const d = pm2DescribeCli(name);
    resolve(d ? d.pid : null);
  });
}
/* #790：读进程实时状态+内存。#791 改走 `pm2 jlist` CLI 子进程——
 * pm2 库 connect 有竞态 bug（sock null 直接崩进程），CLI 隔离在子进程里，崩也不波及看门狗。 */
function pm2Monit(name) {
  return new Promise(resolve => {
    exec('"' + NODE_BIN + '" "' + PM2_BIN + '" jlist', { shell: 'cmd.exe', encoding: 'utf8', timeout: 15000 }, (e, out) => {
      if (e || !out) return resolve(null);
      try {
        const raw = String(out).trim();
        const list = JSON.parse(raw.slice(raw.indexOf('[') >= 0 ? raw.indexOf('[') : 0));
        const p = (list || []).find(x => x && x.name === name);
        if (!p || !p.pm2_env) return resolve(null);
        resolve({ status: p.pm2_env.status, rss: Math.round((p.monit && p.monit.memory || 0) / 1048576) });
      } catch (_) { resolve(null); }
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
  let memCnt = 0, lastMemFix = 0;   /* #790 内存护栏 */
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

    /* --- #790 内存膨胀护栏（2026-09-14 事故）---
     * orps-server rss 涨到 4784MB → 系统仅剩 530MB → DB 连接全超时 + 事件循环 4s，
     * 进程被压入 waiting-restart 死循环；期间 health=200（孤儿应答），既有三道防线全哑。
     * 补位：rss 持续超 3000MB（5 检×30s=2.5min）→ pm2-safe 安全重启（唯一安全入口）。 */
    try {
      const m = await pm2Monit('orps-server');
      if (m && m.rss > MEM_THRESHOLD_MB) {
        /* #792 硬顶熔断：冷启动缓存风暴实测 0→3.83GB 只需 3min（2026-09-14 11:30 实锤），
         * PM2 max_memory_restart=3500M 的 Windows restart 必留孤儿 → EADDRINUSE 死循环。
         * rss 破 3200MB 立即 pm2-safe 重启，抢在 PM2 杀手前面从源头消灭孤儿循环。 */
        if (m.rss > MEM_HARD_MB && Date.now() - lastMemFix > MEM_COOLDOWN_MS) {
          lastMemFix = Date.now(); memCnt = 0;
          log('★ 硬顶熔断：rss ' + m.rss + 'MB > ' + MEM_HARD_MB + 'MB（PM2 上限 3500M）→ 立即 pm2-safe 安全重启');
          try { const r = await safeRestart('orps-server'); log('硬顶熔断 pm2-safe 完成 ok=' + r.ok + ' status=' + r.status + ' pid=' + r.pid); }
          catch (e) { log('硬顶熔断 pm2-safe 失败: ' + e.message); }
        } else {
          memCnt++;
          log('内存膨胀 ' + m.rss + 'MB > ' + MEM_THRESHOLD_MB + 'MB（' + memCnt + '/' + MEM_CHECKS + '）');
          if (memCnt >= MEM_CHECKS && Date.now() - lastMemFix > MEM_COOLDOWN_MS) {
            lastMemFix = Date.now();
            log('★ 介入：orps-server 内存超阈值持续 ' + MEM_CHECKS + ' 检 → pm2-safe 安全重启');
            try { const r = await safeRestart('orps-server'); log('内存护栏 pm2-safe 完成 ok=' + r.ok + ' status=' + r.status + ' pid=' + r.pid); }
            catch (e) { log('内存护栏 pm2-safe 失败: ' + e.message); }
            memCnt = 0;
          }
        }
      } else if (m) { memCnt = 0; }
    } catch (e) { /* monit 不可达忽略 */ }

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
