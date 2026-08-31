const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT title, data_json->>'url' url, data_json->>'source' src, collect_time FROM intel_data WHERE data_json->>'_sourceType'='google_news' ORDER BY id DESC LIMIT 6");
  r.rows.forEach(x => console.log('-', x.title.slice(0,50), '|', String(x.url||'').slice(0,60), '|', x.src, '|', String(x.collect_time).slice(0,16)));
  const c = await pool.query("SELECT to_char(collect_time AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:00') h, count(*) c FROM intel_data WHERE data_json->>'_sourceType'='google_news' AND collect_time >= '2026-08-28' GROUP BY 1 ORDER BY 1");
  console.log('=== google_news 时间分布 ==='); c.rows.forEach(x=>console.log(x.h, x.c));
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
