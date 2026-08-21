const { Pool } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((o, l) => { const [k, ...v] = l.split('='); if (k && v.length) o[k.trim()] = v.join('=').trim(); return o; }, {});
const pool = new Pool({ host: env.DB_HOST || 'localhost', port: env.DB_PORT || 5432, user: env.DB_USER || 'postgres', password: env.DB_PASS, database: env.DB_NAME || 'osint_db' });
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT title, country, COUNT(*) as cnt
      FROM intel_data
      WHERE title IS NOT NULL AND title <> ''
      GROUP BY title, country
      HAVING COUNT(*) > 1
    `);
    let totalRemoved = 0;
    for (const r of rows) {
      const { rows: toDelete } = await client.query(`
        DELETE FROM intel_data
        WHERE id IN (
          SELECT id FROM intel_data
          WHERE title = $1 AND (country = $2 OR (country IS NULL AND $2 IS NULL))
          ORDER BY collect_time DESC NULLS LAST
          OFFSET 1
        )
        RETURNING id
      `, [r.title, r.country]);
      totalRemoved += toDelete.length;
      console.log('dedup:', r.title.slice(0, 40), r.country, '- removed', toDelete.length);
    }
    await client.query('COMMIT');
    console.log('[DEDUP] total removed:', totalRemoved);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
