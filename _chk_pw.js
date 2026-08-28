const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const { rows } = await pool.query(`SELECT title, title_zh, url, source_tag, reason, blocked_at
    FROM intel_sidepool WHERE source_tag LIKE 'PROJECT-WATCH%' ORDER BY id DESC LIMIT 12`);
  rows.forEach(r => console.log('[' + r.reason + '] ' + String(r.title).slice(0, 70) + ' | tzh=' + String(r.title_zh || '').slice(0, 50) + ' | ' + (r.url ? String(r.url).slice(0, 60) : '')));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
