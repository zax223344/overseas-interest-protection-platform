/* 临时：验证哨兵入库条目 + 队列国别分布 */
const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'orps_user', database: 'orps_db' });
(async () => {
  const r1 = await pool.query("SELECT id, title, country, severity, collect_time FROM intel_data WHERE data_json->>'_cnsecWatch' = 'true' ORDER BY id DESC LIMIT 10");
  console.log('=== 哨兵入库条目 ===');
  r1.rows.forEach(x => console.log(' ', x.id, '|', x.country, '|', x.severity, '|', String(x.collect_time).slice(0, 19), '|', (x.title_zh || x.title || '').slice(0, 70)));
  const r2 = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  const alerts = (r2.rows[0] && r2.rows[0].data_json) || [];
  const dist = {};
  alerts.forEach(a => { const c = (a.country || '未知').trim() || '未知'; dist[c] = (dist[c] || 0) + 1; });
  console.log('\n=== 预警队列(' + alerts.length + '条) 国别分布（国别帽后）===');
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(' ', c, n));
  await pool.end(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
