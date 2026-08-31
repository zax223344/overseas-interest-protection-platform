const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT collection, data_json FROM datahub_store WHERE data_json::text ILIKE '%中国要求塔吉克斯坦%' LIMIT 2");
  r.rows.forEach(x => {
    const arr = Array.isArray(x.data_json) ? x.data_json : [x.data_json];
    arr.filter(a => String(a.title||'').indexOf('要求塔吉克') >= 0 || String(a.title_zh||'').indexOf('要求塔吉克') >= 0).forEach(a => {
      console.log('collection=' + x.collection + ' id=' + a.id);
      console.log('  title:', a.title, '| title_zh:', a.title_zh);
      console.log('  time:', a.time, '| source:', JSON.stringify(a.source), '| url:', String(a.url||'').slice(0,80));
      console.log('  desc前120:', String(a.desc||'').slice(0,120));
      console.log('  author:', a.author, '| publishedAt:', a.publishedAt, '| credibility:', a.credibility);
    });
  });
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
