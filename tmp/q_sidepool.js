const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const r = await pool.query("SELECT reason, count(*) FROM intel_sidepool WHERE source_tag='WM-FEED' AND blocked_at > NOW() - INTERVAL '2 hours' GROUP BY reason ORDER BY 2 DESC");
  console.log('=== WM-FEED 拦截原因分布 ===');
  r.rows.forEach(x => console.log(x.reason, x.count));
  const s = await pool.query("SELECT reason, title_zh, title, country FROM intel_sidepool WHERE source_tag='WM-FEED' AND blocked_at > NOW() - INTERVAL '2 hours' ORDER BY blocked_at DESC LIMIT 25");
  console.log('=== 样本 ===');
  s.rows.forEach(x => console.log('[' + x.reason + ']', (x.title_zh || x.title || '').slice(0, 60), '|', x.country || ''));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
