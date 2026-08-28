/* Task #464: 伦敦使馆旧闻跨库排查 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

(async () => {
  const KW = ['%使馆%', '%大使馆%', '%embassy%', '%伦敦%', '%london%', '%180米%'];
  console.log('########## 1. intel_data / intel_archive / intel_sidepool ##########');
  for (const tbl of ['intel_data', 'intel_archive', 'intel_sidepool']) {
    try {
      const where = KW.map(() => "title ILIKE $1 OR (data_json->>'title_zh') ILIKE $1").join(' OR ');
      const { rows } = await pool.query(
        `SELECT id, title, country, source, data_type, collect_time,
                data_json->>'url' AS url, data_json->>'title_zh' AS tzh
         FROM ${tbl} WHERE ${where} ORDER BY id DESC LIMIT 30`, KW);
      console.log(`\n=== ${tbl}: ${rows.length} rows ===`);
      for (const r of rows) {
        console.log(`id=${r.id} | zh=${(r.tzh || '').slice(0, 70)}`);
        console.log(`    en=${(r.title || '').slice(0, 70)}`);
        console.log(`    country=${r.country} | src=${(r.source || '').slice(0, 40)} | type=${r.data_type} | ct=${r.collect_time}`);
        console.log(`    url=${(r.url || '').slice(0, 120)}`);
      }
    } catch (e) { console.log(`=== ${tbl} ERROR: ${e.message} ===`); }
  }

  console.log('\n########## 2. datahub_store alerts ##########');
  try {
    const { rows } = await pool.query(`SELECT key, value_json::text AS v FROM datahub_store WHERE key ILIKE '%alert%' LIMIT 3000`);
    let hits = 0;
    for (const r of rows) {
      const v = r.v || '';
      if (v.includes('使馆') || /embassy/i.test(v) || v.includes('伦敦') || /london/i.test(v) || v.includes('180')) {
        hits++;
        console.log(`KEY=${r.key}\n    ${v.slice(0, 400)}\n`);
      }
    }
    console.log(`datahub alert 命中 ${hits} 条`);
  } catch (e) { console.log(`datahub ERROR: ${e.message}`); }

  console.log('\n########## 3. intel_tombstones ##########');
  try {
    const { rows } = await pool.query(
      `SELECT id, tkey, url, title, created_at FROM intel_tombstones
       WHERE title ILIKE ANY($1) OR tkey ILIKE ANY($1) ORDER BY id DESC LIMIT 20`,
      [['%使馆%', '%embassy%', '%伦敦%', '%london%']]);
    console.log(`使馆相关墓碑: ${rows.length} 条`);
    for (const r of rows) {
      console.log(`id=${r.id} | tkey=${r.tkey} | at=${r.created_at}`);
      console.log(`    title=${(r.title || '').slice(0, 100)}`);
      console.log(`    url=${(r.url || '').slice(0, 120)}`);
    }
    const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM intel_tombstones');
    console.log(`墓碑总数: ${cnt[0].n}`);
  } catch (e) { console.log(`tombstone ERROR: ${e.message}`); }

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
