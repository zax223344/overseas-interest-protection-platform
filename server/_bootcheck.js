/* 启动前自检：加载 server.js 的翻译/要素函数并连库验证，不监听端口、不改数据。 */
const path = require('path');
// 仅验证依赖与关键函数存在性（避免完整 require 触发监听）
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const need = ['_fetchBodyForItem', '_extractDateFromText', '_extractLocationFromText', '_extractElements', '_localizeMedia', '_translateListToZhParallel', '_localizeCountryNames'];
let miss = [];
need.forEach(n => { if (src.indexOf('function ' + n) < 0 && src.indexOf(n + ' =') < 0) miss.push(n); });
console.log('定义检查:', miss.length ? '缺失 ' + miss.join(',') : '全部存在');

// 连库验证
const { pool, testConnection } = require('./db');
(async () => {
  const ok = await testConnection();
  if (ok) {
    const r = await pool.query("SELECT COUNT(*) c, COUNT(data_json->>'location') loc, COUNT(data_json->>'date') dt, COUNT(data_json->>'content') ct FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days'");
    const row = r.rows[0];
    console.log('近7天 intel_data 总量=' + row.c + ' 有location=' + row.loc + ' 有date=' + row.dt + ' 有content=' + row.ct);
  }
  await pool.end();
  console.log('BOOTCHECK_DONE');
})().catch(e => { console.error('BOOTCHECK_ERR', e.message); process.exit(1); });
