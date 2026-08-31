const { Pool } = require('pg');
require('dotenv').config();
(async () => {
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const r = await pool.query(`SELECT to_char(collect_time,'HH24:MI') m, count(*) n FROM intel_data WHERE data_json->>'_sourceType'='threatroom' AND collect_time > NOW() - interval '10 hours' GROUP BY m ORDER BY m`);
  r.rows.forEach(x => console.log(x.m, x.n));
  await pool.end();
})().catch(e => console.log('ERR', e.message));
