const { Pool } = require('pg');
require('dotenv').config();
(async () => {
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const r = await pool.query(`SELECT id, country, title FROM intel_data WHERE data_json->>'_sourceType'='threatroom' AND collect_time > NOW() - interval '4 hours' ORDER BY id DESC LIMIT 50`);
  console.log('TOTAL:', r.rows.length);
  r.rows.forEach(x => console.log((x.country||'∅').slice(0,16).padEnd(16), '|', String(x.title).slice(0,85)));
  await pool.end();
})().catch(e => console.log('ERR', e.message));
