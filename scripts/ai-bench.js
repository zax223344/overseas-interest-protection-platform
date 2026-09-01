#!/usr/bin/env node
/* AI 报告并发实测（perf-scale-dev）：5 路报告 × 3 段 = 15 个并发 /api/llm/report-seg
 * 验证：并发闸下排队不丢任务、无超时、全部返回文本（真 LLM 调用）。 */
const http = require('http');
function req(method, path, body, headers) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port: 3000, method, path, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, body: Buffer.concat(c).toString() }));
    });
    r.on('error', e => resolve({ status: 0, ms: Date.now() - t0, body: '', err: e.message }));
    r.setTimeout(300000, () => { r.destroy(); resolve({ status: 0, ms: Date.now() - t0, body: '', err: 'client-timeout' }); });
    if (body) r.write(body);
    r.end();
  });
}
async function main() {
  const login = await req('POST', '/api/auth/login', JSON.stringify({ username: 'admin', password: 'admin123' }));
  const token = JSON.parse(login.body).token;
  const auth = { Authorization: 'Bearer ' + token };
  /* 5 份不同国别报告（不同 payload → 不同 sig，不会被同签名合并）× 首批 3 段 */
  const countries = ['印度尼西亚', '埃塞俄比亚', '吉尔吉斯斯坦', '莫桑比克', '马里'];
  const segs = ['fact', 'trend', 'drivers'];
  const tasks = [];
  const t0 = Date.now();
  for (const c of countries) {
    for (const s of segs) {
      const payload = {
        country: c, win: '72h', reportType: '综合情报',
        stats: { total: 12, red: 2, orange: 3, yellow: 5, blue: 2, china: 4, assetHit: 2 },
        events: [{ title: c + '某中资项目驻地周边安全事件', time: '2026-09-01', level: 'red', type: '安全' }],
        clusters: [], assets: [c + '铜矿项目'], orgs: []
      };
      tasks.push({ c, s, p: req('POST', '/api/llm/report-seg', JSON.stringify({ segment: s, payload }), auth) });
    }
  }
  console.log('[AI-BENCH] 发起 ' + tasks.length + ' 个并发分段请求（5 报告 × 3 段）…');
  const results = await Promise.all(tasks.map(async t => ({ ...t, r: await t.p })));
  let ok = 0, degraded = 0, fail = 0;
  console.log('国家 | 段 | HTTP | 耗时 | model | 状态');
  results.forEach(t => {
    let j = {}; try { j = JSON.parse(t.r.body); } catch (e) {}
    const model = j.model || '';
    if (t.r.status === 200 && j.ok && j.text) { if (j.degraded) degraded++; else ok++; }
    else fail++;
    console.log(`${t.c} | ${t.s} | ${t.r.status}${t.r.err ? '(' + t.r.err + ')' : ''} | ${(t.r.ms / 1000).toFixed(1)}s | ${model.slice(0, 24)} | ${j.ok ? (j.degraded ? '本地降级' : 'LLM成功') : '失败:' + String(j.error || '').slice(0, 60)}`);
  });
  console.log(`\n[AI-BENCH] 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s | LLM成功 ${ok} | 本地降级 ${degraded} | 失败 ${fail} | 丢任务 ${tasks.length - results.filter(t => t.r.status === 200).length}`);
}
main();
