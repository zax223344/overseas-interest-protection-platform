/* 修正刚果金案分级：intel_data + datahub alerts 同步提级 red */
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'orps_user', database: 'orps_db' });
  await c.connect();
  const r1 = await c.query("UPDATE intel_data SET severity='red', data_json = jsonb_set(jsonb_set(data_json, '{level_norm}', '\"red\"'), '{severity}', '\"red\"') WHERE id=22949 RETURNING id");
  console.log('intel_data updated:', r1.rowCount);
  const r2 = await c.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  const raw = r2.rows[0].data_json;
  const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let fixed = 0;
  arr.forEach(a => { if (String(a.id) === 'SRV-22949') { a.level = 'red'; if (a.level_norm) a.level_norm = 'red'; fixed++; } });
  if (fixed) await c.query('UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2', [JSON.stringify(arr), 'alerts']);
  console.log('alerts fixed:', fixed);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
