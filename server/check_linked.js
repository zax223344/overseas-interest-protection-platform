const { Pool } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((o, l) => { const [k, ...v] = l.split('='); if (k && v.length) o[k.trim()] = v.join('=').trim(); return o; }, {});
const pool = new Pool({ host: env.DB_HOST || 'localhost', port: env.DB_PORT || 5432, user: env.DB_USER || 'postgres', password: env.DB_PASS, database: env.DB_NAME || 'osint_db' });
(async () => {
  const { rows } = await pool.query(`
    SELECT data_json->>'interestLinked' as linked, COUNT(*) as cnt
    FROM intel_data
    WHERE data_type='osint_intel'
    GROUP BY data_json->>'interestLinked'
  `);
  rows.forEach(r => console.log('interestLinked=' + r.linked, r.cnt));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
