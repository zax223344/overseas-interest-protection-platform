const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT id, title, COALESCE(NULLIF(data_json->>'title_zh',''), title) AS tzh, source, country, severity, data_type, collect_time, data_json->>'url' AS url, data_json->>'_sourceType' AS stype, data_json->>'source' AS jsource, data_json->>'publish_time' AS pub, data_json->>'source_url' AS surl FROM intel_data WHERE (title ILIKE '%塔吉克%' OR data_json->>'title_zh' ILIKE '%塔吉克%') ORDER BY id DESC LIMIT 10");
  if (!r.rows.length) { console.log('无塔吉克相关条目'); }
  r.rows.forEach(x => {
    console.log('--- id=' + x.id);
    console.log('  标题:', (x.tzh || x.title || '').slice(0, 60));
    console.log('  原文标题:', String(x.title || '').slice(0, 60));
    console.log('  source列:', x.source, '| _sourceType:', x.stype, '| data_json.source:', x.jsource);
    console.log('  url:', String(x.url || x.surl || '(无)').slice(0, 80));
    console.log('  国家:', x.country, '| 严重度:', x.severity, '| 类别:', x.data_type);
    console.log('  collect_time:', String(x.collect_time).slice(0, 19), '| publish_time:', x.pub);
  });
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
