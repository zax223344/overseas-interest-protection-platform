const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT collection, data_json FROM datahub_store WHERE (data_json::text ILIKE '%塔吉克%') ORDER BY updated_at DESC LIMIT 6");
  if (!r.rows.length) { console.log('datahub_store 无塔吉克条目'); await pool.end(); return; }
  r.rows.forEach(x => {
    console.log('=== collection=' + x.collection);
    const v = x.data_json;
    const arr = Array.isArray(v) ? v : [v];
    arr.filter(a => JSON.stringify(a).indexOf('塔吉克') >= 0).slice(0, 4).forEach(a => {
      console.log('  id:', a.id, '| 标题:', String(a.title || '').slice(0, 55));
      console.log('  level:', a.level, '| country:', a.country, '| time:', a.time || a.created_at || a.publishedAt || '(无)');
      console.log('  source:', a.source || '(无source字段)', '| url:', String(a.url || a.link || '(无url)').slice(0, 95));
      console.log('  字段:', Object.keys(a).join(','));
    });
  });
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
