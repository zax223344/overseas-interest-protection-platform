/* 临时：24h 入库国别分布 + 预警队列国别分布 */
const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'orps_user', database: 'orps_db' });
(async () => {
  const r1 = await pool.query("SELECT COALESCE(NULLIF(country,''),'未知') c, COUNT(*)::int n FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours' GROUP BY 1 ORDER BY n DESC LIMIT 30");
  console.log('=== 24h 入库国别 TOP30 ===');
  r1.rows.forEach(x => console.log(' ', x.c, x.n));
  const r2 = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  const alerts = (r2.rows[0] && r2.rows[0].data_json) || [];
  const dist = {};
  let old24 = 0, old72 = 0;
  const now = Date.now();
  alerts.forEach(a => {
    const c = (a.country || '未知').trim() || '未知';
    dist[c] = (dist[c] || 0) + 1;
    const t = Date.parse(a.publishedAt || '') || 0;
    /* time 字段是本地格式 'YYYY-MM-DD HH:mm' */
    const t2 = t || Date.parse(String(a.time || '').replace(' ', 'T')) || 0;
    if (t2 && now - t2 > 24 * 3600e3) old24++;
    if (t2 && now - t2 > 72 * 3600e3) old72++;
  });
  console.log('\n=== 预警队列(' + alerts.length + '条) 国别分布 ===');
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(' ', c, n));
  console.log('队列中 >24h 旧条目:', old24, ' >72h:', old72);
  /* 最老的 5 条 */
  const aged = alerts.map(a => ({ c: a.country, t: a.time, title: String(a.title || '').slice(0, 50) })).slice(-8);
  console.log('\n=== 队列最尾部 8 条 ===');
  aged.forEach(a => console.log(' ', a.t, '|', a.c, '|', a.title));
  await pool.end(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
