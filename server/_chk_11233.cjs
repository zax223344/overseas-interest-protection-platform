require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT||'5432',10), database: process.env.DB_NAME||'orps_db', user: process.env.DB_USER||'orps_user', password: process.env.DB_PASS||'orps_dev_pass_2026' });
(async () => {
  const { rows } = await pool.query(`SELECT data_json FROM intel_data WHERE id = 11233`);
  const j = rows[0].data_json;
  console.log('collect_time:', JSON.stringify(j.collect_time), '| collected_at:', JSON.stringify(j.collected_at), '| time:', JSON.stringify(j.time));
  // 全库统计：data_json 无 collect_time 且无源日期的条目（前端会盖新戳的危险存量）
  const r2 = await pool.query(`SELECT COUNT(*) c FROM intel_data WHERE COALESCE(data_json->>'collect_time','')='' AND COALESCE(data_json->>'collected_at','')='' AND COALESCE(data_json->>'publish_time','')='' AND COALESCE(data_json->>'publishedAt','')='' AND COALESCE(data_json->>'event_date','')='' AND COALESCE(data_json->>'date','')=''`);
  console.log('无源日期且无采集时间的危险存量:', r2.rows[0].c);
  const r3 = await pool.query(`SELECT data_type, COUNT(*) c FROM intel_data WHERE COALESCE(data_json->>'collect_time','')='' AND COALESCE(data_json->>'collected_at','')='' AND COALESCE(data_json->>'publish_time','')='' AND COALESCE(data_json->>'publishedAt','')='' AND COALESCE(data_json->>'event_date','')='' AND COALESCE(data_json->>'date','')='' GROUP BY data_type ORDER BY c DESC LIMIT 6`);
  r3.rows.forEach(r => console.log(' ', r.data_type, r.c));
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
