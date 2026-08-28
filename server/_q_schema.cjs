const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const client = await pool.connect();
  const r = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='datahub_store'");
  console.log('datahub_store columns:', r.rows.map(x=>x.column_name).join(', '));
  const r2 = await client.query("SELECT * FROM datahub_store WHERE data_json->>'title' LIKE '%刚果（金）%' OR data_json->>'country'='刚果（金）' LIMIT 5");
  console.table(r2.rows);
  const r3 = await client.query("SELECT COUNT(*) FROM datahub_store");
  console.log('total rows', r3.rows[0].count);
  client.release(); await pool.end();
})().catch(e=>{console.error(e);process.exit(1);});
