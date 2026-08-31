const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT collection, data_json FROM datahub_store WHERE (data_json::text ILIKE '%保护中国公民%' OR data_json::text ILIKE '%要求塔吉克%') LIMIT 3");
  r.rows.forEach(x => {
    console.log('=== collection=' + x.collection);
    const arr = Array.isArray(x.data_json) ? x.data_json : [x.data_json];
    arr.filter(a => JSON.stringify(a).indexOf('塔吉克') >= 0 || JSON.stringify(a).indexOf('保护中国公民') >= 0).slice(0, 3).forEach(a => {
      console.log('  标题:', String(a.title || '').slice(0, 60));
      console.log('  level:', a.level, '| country:', a.country, '| time:', a.time, '| source:', a.source);
      console.log('  url:', String(a.url || '(无)').slice(0, 100));
      console.log('  desc:', String(a.desc || '').slice(0, 120));
      console.log('  publishedAt:', a.publishedAt, '| type:', a.type, '| credibility:', a.credibility);
    });
  });
  if (!r.rows.length) console.log('未找到精确标题，查最近的涉塔预警时间分布');
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
