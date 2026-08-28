const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const { rows } = await pool.query(`
    SELECT id, title_zh, title, country, level, risk_score, time, source_type
    FROM intel_data
    WHERE (title_zh ILIKE '%俄罗斯%' OR title ILIKE '%Russia%' OR title_zh ILIKE '%尼泊尔%' OR title ILIKE '%Nepal%')
      AND time > NOW() - INTERVAL '7 days'
    ORDER BY time DESC
    LIMIT 80
  `);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
