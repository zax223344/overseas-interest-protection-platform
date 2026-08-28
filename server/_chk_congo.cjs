require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT||'5432',10), database: process.env.DB_NAME||'orps_db', user: process.env.DB_USER||'orps_user', password: process.env.DB_PASS||'orps_dev_pass_2026' });
(async () => {
  const { rows } = await pool.query(`SELECT id, source, collect_time, data_json FROM intel_data WHERE title LIKE '%刚果%' AND title LIKE '%40%' ORDER BY collect_time DESC LIMIT 3`);
  rows.forEach(r => {
    const j = r.data_json;
    console.log('=== id', r.id, '| source:', r.source, '| collect_time:', r.collect_time);
    console.log('title:', String(j.title||'').slice(0,90));
    console.log('url:', j.url);
    console.log('publish_time:', j.publish_time, '| publishedAt:', j.publishedAt, '| pubDate:', j.pubDate);
    console.log('event_date:', j.event_date, '| date:', j.date, '| _extractedEventDate:', j._extractedEventDate);
    console.log('_fromSource:', j._fromSource, '| _sourceType:', j._sourceType);
    console.log('content head:', String(j.content||'').slice(0,200));
  });
  if (!rows.length) {
    const r2 = await pool.query(`SELECT id, source, collect_time, title FROM intel_data WHERE title LIKE '%乌干达%' ORDER BY collect_time DESC LIMIT 5`);
    r2.rows.forEach(r => console.log(r.id, '|', r.source, '|', r.collect_time, '|', String(r.title).slice(0,80)));
  }
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
