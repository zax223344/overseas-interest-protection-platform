/* 一次性清扫：threatroom 通道 GNews 旧闻存量（7天闸 8-31 上线前入库）
 * 判定依据 event_date（真实发布日期，无需解码验真）。删除 + 墓碑。 */
const { Client } = require('pg');
const c = new Client({ host: 'localhost', user: 'orps_user', password: 'orps_dev_pass_2026', database: 'orps_db' });
(async () => {
  await c.connect();
  const q = (s, p) => c.query(s, p);
  const r = await q(
    `SELECT id, data_json->>'url' url, title FROM intel_data
     WHERE data_json->>'url' LIKE '%news.google.com%'
     AND data_json->>'_sourceType' = 'threatroom'
     AND event_date IS NOT NULL AND event_date <> ''
     AND event_date < to_char(NOW() - INTERVAL '7 days','YYYY-MM-DD')
     ORDER BY event_date`
  );
  console.log('[SWEEP] threatroom 旧闻待删 ' + r.rows.length + ' 条');
  let del = 0, tomb = 0;
  for (const row of r.rows) {
    await q('DELETE FROM intel_data WHERE id=$1', [row.id]); del++;
    await q('INSERT INTO intel_tombstones (url, title) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.url, row.title]);
    tomb++;
    console.log('[SWEEP] 剔除 id=' + row.id + ' | ' + String(row.title || '').slice(0, 60));
  }
  /* 复核 */
  const chk = await q(`SELECT COUNT(*)::int n FROM intel_data
    WHERE data_json->>'url' LIKE '%news.google.com%'
    AND data_json->>'_sourceType' = 'threatroom'
    AND event_date IS NOT NULL AND event_date <> ''
    AND event_date < to_char(NOW() - INTERVAL '7 days','YYYY-MM-DD')`);
  console.log('[SWEEP] 完成：删除 ' + del + ' 条，墓碑 ' + tomb + ' 条，复核残留 ' + chk.rows[0].n + ' 条');
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
