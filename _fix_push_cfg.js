const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const clean = JSON.stringify({ enabled: true, pushOnNew: true, pushOnResolve: true });
  const r = await pool.query(
    "UPDATE user_settings SET setting_val=$1 WHERE setting_key='push_config' AND setting_val::text LIKE '%localhost:3000/api/health%'",
    [clean]);
  console.log('cleaned rows: ' + r.rowCount);
  const v = await pool.query("SELECT user_id, setting_val FROM user_settings WHERE setting_key='push_config'");
  v.rows.forEach(x => console.log('user ' + x.user_id + ' -> ' + String(x.setting_val).slice(0, 120)));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
