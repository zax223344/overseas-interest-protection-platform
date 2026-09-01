#!/usr/bin/env node
/* ORPS 性能压测脚本（perf-scale-dev，2026-09-02）
 * 原生 http，无外部依赖。模拟 50 个虚拟用户闭循环访问真实 API 场景：
 *   登录 → 轮询类 GET（实时流/统计/预警/漏斗）→ 简报查看 → 归档搜索 → 静态资源
 * 输出：每端点 p50/p95/p99/max、吞吐、错误数、传输字节数。
 * 用法：node scripts/perf-bench.js [并发数] [持续秒数] [标签]
 */
const http = require('http');

const HOST = '127.0.0.1', PORT = 3000;
const VUS = parseInt(process.argv[2] || '50', 10);
const DUR = parseInt(process.argv[3] || '60', 10) * 1000;
const TAG = process.argv[4] || 'run';

function req(method, path, body, headers) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ host: HOST, port: PORT, method, path, headers: Object.assign({ 'Accept-Encoding': 'gzip' }, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ms: Number(process.hrtime.bigint() - t0) / 1e6,
          bytes: buf.length,
          enc: res.headers['content-encoding'] || '',
          etag: res.headers['etag'] || '',
          cc: res.headers['cache-control'] || '',
          body: buf
        });
      });
    });
    r.on('error', (e) => resolve({ status: 0, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes: 0, err: e.message }));
    if (body) r.write(body);
    r.end();
  });
}

/* ---- 场景端点（真实前端轮询/查看行为） ---- */
async function login() {
  const r = await req('POST', '/api/auth/login', JSON.stringify({ username: 'admin', password: 'admin123' }), { 'Content-Type': 'application/json' });
  if (r.status !== 200) throw new Error('登录失败: HTTP ' + r.status);
  return JSON.parse(r.body.toString()).token;
}

function buildScenario(token) {
  const auth = { Authorization: 'Bearer ' + token };
  return [
    { name: 'GET /api/intel/public/osint_intel', fn: () => req('GET', '/api/intel/public/osint_intel', null, auth) },
    { name: 'GET /api/intel/stats', fn: () => req('GET', '/api/intel/stats', null, auth) },
    { name: 'GET /api/datahub/alerts', fn: () => req('GET', '/api/datahub/alerts', null, auth) },
    { name: 'GET /api/media/daily-stats', fn: () => req('GET', '/api/media/daily-stats?t=' + Date.now(), null, auth) },
    { name: 'GET /api/funnel/today', fn: () => req('GET', '/api/funnel/today', null, auth) },
    { name: 'GET /api/reports/daily/2026-09-01', fn: () => req('GET', '/api/reports/daily/2026-09-01', null, auth) },
    { name: 'GET /api/archive/search?q=安全', fn: () => req('GET', '/api/archive/search?q=' + encodeURIComponent('安全') + '&limit=20', null, auth) },
    { name: 'GET /app.js (静态1.7MB)', fn: () => req('GET', '/app.js?v=bench', null, auth) }
  ];
}

const stats = {}; /* name → {n, errs, ms[], bytes} */
function rec(name, r) {
  const s = stats[name] || (stats[name] = { n: 0, errs: 0, ms: [], bytes: 0, enc: {}, cc: new Set() });
  s.n++;
  if (r.status !== 200) s.errs++;
  else { s.ms.push(r.ms); s.bytes += r.bytes; }
  if (r.enc) s.enc[r.enc] = (s.enc[r.enc] || 0) + 1;
  if (r.cc) s.cc.add(r.cc);
}

function pct(arr, p) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; }

async function main() {
  console.log(`[BENCH] ${TAG} VUS=${VUS} DUR=${DUR / 1000}s start=${new Date().toISOString()}`);
  /* 预热登录：每 VU 独立 token（模拟 50 个不同账号；用同一 admin 凭据验证吞吐口径一致） */
  const t0 = Date.now();
  const tokens = [];
  for (let i = 0; i < VUS; i++) {
    try { tokens.push(await login()); } catch (e) { console.error('[BENCH] 登录失败:', e.message); process.exit(1); }
  }
  console.log(`[BENCH] ${VUS} 个虚拟用户登录完成，耗时 ${Date.now() - t0}ms`);

  const endAt = Date.now() + DUR;
  let totalReq = 0;
  await Promise.all(tokens.map(async (token, vi) => {
    const sc = buildScenario(token);
    let i = Math.floor(Math.random() * sc.length);
    while (Date.now() < endAt) {
      const ep = sc[i % sc.length];
      const r = await ep.fn();
      rec(ep.name, r);
      totalReq++;
      i++;
      /* 轻微思考间隔 100ms，模拟人看页面（仍为高压力闭循环） */
      await new Promise(rs => setTimeout(rs, 100));
    }
  }));

  const wall = DUR / 1000;
  console.log(`\n===== [BENCH] ${TAG} 结果 =====`);
  console.log(`总请求: ${totalReq}  吞吐: ${(totalReq / wall).toFixed(1)} req/s  期间: ${DUR / 1000}s`);
  console.log('端点 | n | err | p50 | p95 | p99 | max | KB/s | gzip | cache-control');
  let bytesSum = 0;
  Object.keys(stats).forEach(k => {
    const s = stats[k];
    bytesSum += s.bytes;
    const kb = (s.bytes / 1024 / wall).toFixed(0);
    const enc = Object.keys(s.enc).join(',') || '-';
    console.log(`${k} | ${s.n} | ${s.errs} | ${pct(s.ms, 0.5).toFixed(0)}ms | ${pct(s.ms, 0.95).toFixed(0)}ms | ${pct(s.ms, 0.99).toFixed(0)}ms | ${Math.max(0, ...s.ms).toFixed(0)}ms | ${kb} | ${enc} | ${[...s.cc].join(' or ').slice(0, 40)}`);
  });
  console.log(`总传输: ${(bytesSum / 1024 / 1024).toFixed(1)} MB（${(bytesSum / 1024 / wall / 1024).toFixed(2)} MB/s）`);
  const allMs = Object.values(stats).flatMap(s => s.ms);
  console.log(`全端点汇总: p50=${pct(allMs, 0.5).toFixed(0)}ms p95=${pct(allMs, 0.95).toFixed(0)}ms p99=${pct(allMs, 0.99).toFixed(0)}ms`);
}
main();
