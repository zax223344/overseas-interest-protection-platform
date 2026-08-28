/* Task #464 step2: 表结构 + 伦敦使馆文章定位 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

(async () => {
  console.log('########## 0. 表结构 ##########');
  for (const tbl of ['datahub_store', 'intel_sidepool', 'intel_archive', 'intel_data']) {
    const { rows } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [tbl]);
    console.log(`\n=== ${tbl} ===`);
    console.log(rows.map(r => `${r.column_name}(${r.data_type.split(' ')[0]})`).join(', '));
  }

  console.log('\n########## 1. 三表搜使馆/伦敦 ##########');
  const KWS = ['%使馆%', '%大使馆%', '%embassy%', '%伦敦%', '%london%', '%180%'];
  for (const tbl of ['intel_data', 'intel_archive', 'intel_sidepool']) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM ${tbl} WHERE title ILIKE ANY($1) OR (data_json->>'title_zh') ILIKE ANY($1) OR (data_json->>'url') ILIKE ANY($1) ORDER BY id DESC LIMIT 30`, [KWS]);
      console.log(`\n=== ${tbl}: ${rows.length} rows ===`);
      for (const r of rows) {
        const dj = r.data_json || {};
        console.log(`id=${r.id} | title=${(r.title || '').slice(0, 80)}`);
        console.log(`    tzh=${(dj.title_zh || '').slice(0, 80)} | url=${(dj.url || '').slice(0, 130)}`);
        console.log(`    country=${r.country} | type=${r.data_type || r.type} | src=${(r.source || dj.source || '').slice(0, 30)} | ct=${r.collect_time || r.created_at}`);
      }
    } catch (e) { console.log(`=== ${tbl} ERROR: ${e.message} ===`); }
  }

  console.log('\n########## 2. datahub_store 全键样本 + 使馆命中 ##########');
  try {
    const { rows } = await pool.query(`SELECT * FROM datahub_store LIMIT 3`);
    if (rows.length) console.log('样例行键:', Object.keys(rows[0]).join(', '));
  } catch (e) { console.log(`ERR: ${e.message}`); }

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
