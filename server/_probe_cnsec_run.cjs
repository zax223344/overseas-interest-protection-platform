/* 临时：独立验证哨兵一轮采集 */
const w = require('./cn-security-watch.js');
(async () => {
  const r = await w.runCnSecurityWatch();
  console.log('\n=== 样本（前 15 条）===');
  r.items.slice(0, 15).forEach(it => console.log(' ', it._src, '|', (it.date || '').slice(0, 16), '|', it.title.slice(0, 90)));
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
