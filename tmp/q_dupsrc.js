const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db' });
(async () => {
  await c.connect();
  const urls = [
    'foreign-travel-advice/indonesia',
    'uk-meningitis',
    'defensenews.com/global/asia-pacific/2026/08/28',
    'foreign-travel-advice/niger',
    'chokepoint', '_e3fb6'
  ];
  for (const u of urls) {
    const r = await c.query(
      "SELECT id, data_json->>'title_zh' AS tz, source, data_json->>'_sourceType' AS st FROM intel_data WHERE data_json->>'url' LIKE $1 LIMIT 2",
      ['%' + u + '%']
    );
    console.log('--- 撞库: ' + u + ' -> ' + r.rows.length + ' 条');
    r.rows.forEach(x => console.log('  #' + x.id + ' [' + x.st + '] ' + String(x.tz || '').slice(0, 55)));
  }
  // FCDO 咨询是否曾被任何源采过（按标题模式查）
  const r2 = await c.query(
    "SELECT id, data_json->>'_sourceType' AS st, count(*) FROM intel_data WHERE title LIKE '%FCDO%' OR title LIKE '%旅游咨询%' OR title LIKE '%旅游建议%' GROUP BY 1, 2"
  );
  console.log('--- FCDO/旅行咨询历史入库分布:');
  r2.rows.forEach(x => console.log('  [' + x.st + '] ' + x.count));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
