const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db' });
(async () => {
  await c.connect();
  const r = await c.query("SELECT reason, count(*) FROM intel_sidepool WHERE source_tag='wm_feed' AND blocked_at > now() - interval '90 minutes' GROUP BY 1 ORDER BY 2 DESC");
  console.log('=== 最近90min wm_feed 拦截原因分布 ===');
  r.rows.forEach(x => console.log(x.reason + ': ' + x.count));
  const s = await c.query("SELECT reason, title_zh, country, data_type FROM intel_sidepool WHERE source_tag='wm_feed' AND blocked_at > now() - interval '90 minutes' ORDER BY id DESC LIMIT 25");
  console.log('');
  console.log('=== 最近25条样本 ===');
  s.rows.forEach(x => console.log('[' + x.reason + '] [' + x.data_type + '] [' + x.country + '] ' + String(x.title_zh || '(无)').slice(0, 70)));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
