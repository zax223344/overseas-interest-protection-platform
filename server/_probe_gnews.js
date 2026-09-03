const { Client } = require('pg');
const c = new Client({ host: 'localhost', user: 'orps_user', password: 'orps_dev_pass_2026', database: 'orps_db' });
(async () => {
  await c.connect();
  /* GNews URL 总量与通道分布 */
  const r1 = await c.query(`SELECT COALESCE(data_json->>'_sourceType','(空)') st, COUNT(*)::int n
    FROM intel_data WHERE data_json->>'url' LIKE '%news.google.com%' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  console.log('== GNews URL 总量与通道 ==');
  r1.rows.forEach(r => console.log(r.st + ': ' + r.n));
  /* event_date 分布（服务端通道是否带真实发布日期） */
  const r2 = await c.query(`SELECT COALESCE(data_json->>'_sourceType','(空)') st,
    COUNT(*) FILTER (WHERE event_date IS NOT NULL)::int has_ev,
    COUNT(*) FILTER (WHERE event_date IS NOT NULL AND event_date < NOW() - INTERVAL '7 days')::int stale_ev,
    COUNT(*)::int total
    FROM intel_data WHERE data_json->>'url' LIKE '%news.google.com%' GROUP BY 1 ORDER BY 4 DESC LIMIT 15`);
  console.log('== event_date 真实性（有日期/其中超7天/总量） ==');
  r2.rows.forEach(r => console.log(r.st + ': ' + r.has_ev + ' / ' + r.stale_ev + ' / ' + r.total));
  /* 非 GNews 的总量对照 */
  const r3 = await c.query(`SELECT COUNT(*)::int total FROM intel_data WHERE data_json->>'url' IS NOT NULL AND data_json->>'url' NOT LIKE '%news.google.com%'`);
  console.log('== 非 GNews 带 URL 条目 == ' + r3.rows[0].total);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
