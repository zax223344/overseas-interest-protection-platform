require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'orps',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS
});
(async () => {
  const kw = /秦皇岛/i;
  // datahub_store
  const dh = await pool.query("SELECT * FROM datahub_store");
  for (const row of dh.rows) {
    if (!row.data_json) continue;
    const arr = Array.isArray(row.data_json) ? row.data_json : [row.data_json];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      const txt = JSON.stringify(it);
      if (kw.test(txt)) {
        console.log('DH', row.collection, 'idx', i, 'id', it.id || it.alert_id || it.alert_no);
        console.log(txt.slice(0, 600));
      }
    }
  }
  // other tables by JSON column
  for (const [t, col] of [
    ['collected_data','data_json'],
    ['intel_data','data_json'],
    ['auto_alerts','data_json'],
    ['alert_records','data_json'],
    ['intel_structured','data_json']
  ]) {
    const r = await pool.query(`SELECT * FROM "${t}"`);
    for (const row of r.rows) {
      if (!row[col]) continue;
      const txt = JSON.stringify(row[col]);
      if (kw.test(txt)) {
        console.log('HIT', t, 'row', row.id, txt.slice(0, 600));
      }
    }
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
