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
  const kw = '%秦皇岛%';
  const tables = ['datahub_store','intel_data','collected_data','auto_alerts','alert_records','intel_structured'];
  for (const t of tables) {
    const cols = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND data_type IN ('text','character varying','json','jsonb')", [t]);
    for (const c of cols.rows) {
        const col = `"${c.column_name}"`;
        const r = await pool.query(
          `SELECT count(*) c FROM "${t}" WHERE cast(${col} as text) ILIKE $1`, [kw]);
      if (+r.rows[0].c > 0) {
        console.log('HIT', t, c.column_name, r.rows[0].c);
        const s = await pool.query(
          `SELECT * FROM "${t}" WHERE cast(${col} as text) ILIKE $1 LIMIT 2`, [kw]);
        console.log(JSON.stringify(s.rows).slice(0, 800));
      }
    }
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
