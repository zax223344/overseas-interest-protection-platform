const { Client } = require('pg');
const c = new Client({ host: 'localhost', user: 'orps_user', password: 'orps_dev_pass_2026', database: 'orps_db' });
(async () => {
  await c.connect();
  /* 8-25 铁律前入库的其他通道 GNews 条目（潜在旧闻冒充） */
  const r5 = await c.query(`SELECT COALESCE(data_json->>'_sourceType','(空)') st, COUNT(*)::int n
    FROM intel_data WHERE data_json->>'url' LIKE '%news.google.com%'
    AND data_json->>'_sourceType' <> 'threatroom'
    AND created_at < '2026-08-25' GROUP BY 1 ORDER BY 2 DESC`);
  console.log('== 8-25 前入库的非 threatroom GNews 条目 ==');
  if (!r5.rows.length) console.log('(无)');
  r5.rows.forEach(r => console.log(r.st + ': ' + r.n));
  /* threatroom 超7天待删明细统计 */
  const r6 = await c.query(`SELECT COUNT(*)::int n FROM intel_data
    WHERE data_json->>'url' LIKE '%news.google.com%'
    AND data_json->>'_sourceType' = 'threatroom'
    AND event_date IS NOT NULL AND event_date <> '' AND event_date < to_char(NOW() - INTERVAL '7 days','YYYY-MM-DD')`);
  console.log('== threatroom 超7天待删 == ' + r6.rows[0].n);
  /* 已在墓碑中的数量 */
  const r7 = await c.query(`SELECT COUNT(*)::int n FROM intel_tombstones`);
  console.log('== 现有墓碑总数 == ' + r7.rows[0].n);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
