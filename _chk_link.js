const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const a = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  const arr = a.rows[0].data_json || [];
  const fresh = arr.filter(x => /^SRV-30(1[6-9][0-9])/.test(String(x.id || '')));
  console.log('预警库总数 ' + arr.length + ' | SRV-301xx 新联动: ' + fresh.length);
  fresh.slice(0, 8).forEach(x => console.log('  ' + x.id + ' ' + x.level + ' ' + String(x.title).slice(0, 50)));
  const r = await pool.query("SELECT id, title FROM intel_data WHERE collect_time >= NOW() - INTERVAL '40 minutes'");
  let hit = 0; const misses = [];
  const idSet = new Set(arr.map(y => y.id));
  r.rows.forEach(x => { if (idSet.has('SRV-' + x.id)) hit++; else misses.push(String(x.title).slice(0, 45)); });
  console.log('近40min ' + r.rows.length + ' 条中 ' + hit + ' 条已生成预警');
  console.log('未联动样本（过闸被拒或未到生成轮）:');
  misses.slice(0, 8).forEach(m => console.log('  - ' + m));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
