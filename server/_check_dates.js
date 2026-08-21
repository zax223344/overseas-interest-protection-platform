const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db', user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026'
});
(async () => {
  const anyDate = "(COALESCE(NULLIF(event_date,''),'')<>'' OR COALESCE(data_json->>'date','')<>'' OR COALESCE(data_json->>'publishedAt','')<>'' OR COALESCE(data_json->>'pubDate','')<>'' OR COALESCE(data_json->>'seendate','')<>'' OR COALESCE(data_json->>'publish_time','')<>'')";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const r = await pool.query(`SELECT COUNT(*) total, SUM(CASE WHEN ${anyDate} THEN 1 ELSE 0 END) hasdate FROM intel_data WHERE collect_time >= $1`, [today]);
  console.log('今天采集:', r.rows[0].total, '| 有任一日期(含publish_time):', r.rows[0].hasdate);
  const r2 = await pool.query(`SELECT COUNT(*) total, SUM(CASE WHEN ${anyDate} THEN 1 ELSE 0 END) hasdate FROM intel_data`);
  console.log('全库:', r2.rows[0].total, '| 有任一日期(含publish_time):', r2.rows[0].hasdate);
  // publish_time 单独覆盖
  const r3 = await pool.query("SELECT COUNT(*) c FROM intel_data WHERE COALESCE(data_json->>'publish_time','')<>'' ");
  console.log('有 publish_time 的条目:', r3.rows[0].c);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
