require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT||'5432',10), database: process.env.DB_NAME||'orps_db', user: process.env.DB_USER||'orps_user', password: process.env.DB_PASS||'orps_dev_pass_2026' });
(async () => {
  const { rows } = await pool.query(`SELECT id, collect_time, data_json->>'date' d, data_json->>'publish_time' pt FROM intel_data WHERE data_json->>'url' = 'https://apnews.com/article/congo-attacks-villages-allied-democratic-forces-killings-563bef10f07e476759c2738b820a6091'`);
  rows.forEach(r => console.log('id', r.id, '| collect:', r.collect_time, '| date:', r.d, '| pt:', r.pt));
  // 无日期存量统计（待清理范围）
  const r2 = await pool.query(`SELECT COUNT(*) c FROM intel_data WHERE COALESCE(data_json->>'publish_time','')='' AND COALESCE(data_json->>'publishedAt','')='' AND COALESCE(data_json->>'event_date','')='' AND COALESCE(data_json->>'date','')=''`);
  console.log('全库完全无日期条目:', r2.rows[0].c);
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
