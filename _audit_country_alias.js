const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const { rows } = await pool.query(`SELECT country, COUNT(*)::int n FROM intel_data
    WHERE collect_time >= NOW() - INTERVAL '7 days' AND (country ILIKE '%刚果%' OR country ILIKE '%秘鲁%' OR country ILIKE '%老挝%'
      OR country ILIKE '%吉布提%' OR country ILIKE '%阿尔及利亚%' OR country ILIKE '%阿联酋%' OR country ILIKE '%希腊%' OR country ILIKE '%巴拿马%'
      OR country ILIKE '%沙特%' OR country ILIKE '%印尼%' OR country ILIKE '%印度尼西亚%' OR country ILIKE '%哈萨克%')
    GROUP BY 1 ORDER BY 2 DESC`);
  rows.forEach(r => console.log(r.country + ': ' + r.n));
  const src = await pool.query(`SELECT source, country, COUNT(*)::int n FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days' AND source LIKE 'GoogleNews%' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`);
  console.log('--- GoogleNews sources by country ---');
  src.rows.forEach(r => console.log(r.source + ' -> ' + (r.country || '(空)') + ': ' + r.n));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
