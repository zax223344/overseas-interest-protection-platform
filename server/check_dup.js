const { Pool } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((o, l) => { const [k, ...v] = l.split('='); if (k && v.length) o[k.trim()] = v.join('=').trim(); return o; }, {});
const pool = new Pool({ host: env.DB_HOST || 'localhost', port: env.DB_PORT || 5432, user: env.DB_USER || 'postgres', password: env.DB_PASS, database: env.DB_NAME || 'osint_db' });
(async () => {
  const { rows } = await pool.query(`
    SELECT title, country, COUNT(*) as cnt, MIN(id) as min_id, MAX(id) as max_id
    FROM intel_data
    WHERE title IS NOT NULL AND title <> ''
    GROUP BY title, country
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('duplicate groups:', rows.length);
  rows.forEach(r => console.log(r.cnt, r.country, r.title.slice(0, 50), 'ids', r.min_id, r.max_id));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
