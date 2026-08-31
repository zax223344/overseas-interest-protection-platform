const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT * FROM datahub_store WHERE (value::text ILIKE '%塔吉克%') ORDER BY updated_at DESC LIMIT 8");
  if (!r.rows.length) { console.log('datahub_store 无塔吉克条目'); await pool.end(); return; }
  r.rows.forEach(x => {
    console.log('--- key=' + x.key + ' | updated=' + String(x.updated_at).slice(0, 19));
    try {
      const v = typeof x.value === 'string' ? JSON.parse(x.value) : x.value;
      const arr = Array.isArray(v) ? v : [v];
      arr.filter(a => JSON.stringify(a).indexOf('塔吉克') >= 0).slice(0, 3).forEach(a => {
        console.log('  id:', a.id, '| 标题:', String(a.title || '').slice(0, 50));
        console.log('  level:', a.level, '| country:', a.country, '| time:', a.time || a.created_at || a.publishedAt);
        console.log('  source:', a.source, '| url:', String(a.url || a.link || '(无)').slice(0, 90));
        const keys = Object.keys(a).join(',');
        console.log('  字段:', keys);
      });
    } catch (e) { console.log('  解析失败:', e.message); }
  });
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
