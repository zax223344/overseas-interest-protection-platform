const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const client = await pool.connect();
  const r1 = await client.query("SELECT id,data_json->>'title' as title,data_json->>'title_zh' as title_zh,country,severity,source,created_at,collect_time,data_json->>'level_norm' as level_norm FROM intel_data WHERE id=22949");
  console.log('id 22949:');
  console.table(r1.rows);
  const r2 = await client.query("SELECT id,data_json->>'title' as title,data_json->>'title_zh' as title_zh,country,severity,source,created_at,data_json->>'level_norm' as level_norm FROM intel_data WHERE country='刚果（金）' OR country='刚果金' OR data_json->>'title' LIKE '%刚果%' ORDER BY id DESC LIMIT 20");
  console.log('刚果相关:');
  console.table(r2.rows);
  const r3 = await client.query("SELECT key,data_json->>'country' as country,data_json->>'title' as title,data_json->>'level_norm' as level_norm,data_json->>'source' as source,updated_at FROM datahub_store WHERE key LIKE 'SRV-%' AND (data_json->>'country'='刚果（金）' OR data_json->>'country'='刚果金' OR data_json->>'title' LIKE '%刚果%') ORDER BY updated_at DESC LIMIT 10");
  console.log('datahub_store SRV 刚果:');
  console.table(r3.rows);
  const r4 = await client.query("SELECT COUNT(*) as total FROM datahub_store WHERE key LIKE 'SRV-%'");
  console.log('datahub_store alerts total:', r4.rows[0].total);
  client.release();
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
