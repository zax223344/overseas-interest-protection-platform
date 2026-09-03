const { Client } = require('pg');
const c = new Client({ host: 'localhost', user: 'orps_user', password: 'orps_dev_pass_2026', database: 'orps_db' });
(async () => {
  await c.connect();
  const r2 = await c.query(`SELECT COALESCE(data_json->>'_sourceType','(空)') st,
    COUNT(*) FILTER (WHERE event_date IS NOT NULL AND event_date <> '')::int has_ev,
    COUNT(*) FILTER (WHERE event_date IS NOT NULL AND event_date <> '' AND event_date < to_char(NOW() - INTERVAL '7 days','YYYY-MM-DD'))::int stale_ev,
    COUNT(*)::int total
    FROM intel_data WHERE data_json->>'url' LIKE '%news.google.com%' GROUP BY 1 ORDER BY 4 DESC`);
  console.log('== event_date 真实性（有日期/超7天旧/总量） ==');
  r2.rows.forEach(r => console.log(r.st + ': ' + r.has_ev + ' / ' + r.stale_ev + ' / ' + r.total));
  /* event_date 样例 */
  const r4 = await c.query(`SELECT id, data_json->>'_sourceType' st, event_date, LEFT(title,50) t
    FROM intel_data WHERE data_json->>'url' LIKE '%news.google.com%' AND event_date IS NOT NULL AND event_date <> '' AND event_date < '2026-08-27' ORDER BY event_date LIMIT 12`);
  console.log('== 超7天样例 ==');
  r4.rows.forEach(r => console.log(r.id + ' | ' + r.st + ' | ' + r.event_date + ' | ' + r.t));
  const r3 = await c.query(`SELECT COUNT(*)::int n FROM intel_data WHERE data_json->>'url' IS NOT NULL AND data_json->>'url' NOT LIKE '%news.google.com%'`);
  console.log('== 非 GNews 带 URL 条目 == ' + r3.rows[0].n);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
