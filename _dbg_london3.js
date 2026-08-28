/* Task #464 step3: 精确定位"公寓倒塌/180米"文章 + datahub 队列 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

(async () => {
  const KWS = ['%公寓倒塌%', '%倒塌%', '%180米%', '%超级大使馆%', '%megabomb%', '%superbomb%', '%super-embassy%', '%megabasement%', '%新的大型中国大使馆%', '%伦敦标准晚报%'];

  console.log('########## A. 精确关键词四表搜索 ##########');
  for (const tbl of ['intel_data', 'intel_archive', 'intel_sidepool']) {
    try {
      const { rows } = await pool.query(
        `SELECT id, title, country, data_type, source, collect_time, data_json->>'title_zh' AS tzh, data_json->>'url' AS url, data_json->>'link' AS link
         FROM ${tbl} WHERE title ILIKE ANY($1) OR (data_json->>'title_zh') ILIKE ANY($1) OR (data_json->>'url') ILIKE ANY($1) OR (data_json->>'link') ILIKE ANY($1)
         ORDER BY id DESC LIMIT 30`, [KWS]);
      console.log(`\n=== ${tbl}: ${rows.length} rows ===`);
      for (const r of rows) {
        console.log(`id=${r.id} | title=${(r.title || '').slice(0, 90)}`);
        console.log(`    tzh=${(r.tzh || '').slice(0, 90)}`);
        console.log(`    country=${r.country} | type=${r.data_type} | src=${(r.source || '').slice(0, 35)} | ct=${r.collect_time}`);
        console.log(`    url=${(r.url || r.link || '').slice(0, 140)}`);
      }
    } catch (e) { console.log(`=== ${tbl} ERROR: ${e.message} ===`); }
  }

  console.log('\n########## B. datahub_store collections ##########');
  try {
    const { rows } = await pool.query(`SELECT collection, COUNT(*)::int AS n FROM datahub_store GROUP BY collection ORDER BY n DESC`);
    for (const r of rows) console.log(`  ${r.collection}: ${r.n}`);
  } catch (e) { console.log(`ERR: ${e.message}`); }

  console.log('\n########## C. datahub alerts 里的使馆文章 ##########');
  try {
    const { rows } = await pool.query(`SELECT id, collection, data_json::text AS v FROM datahub_store WHERE data_json::text ILIKE ANY($1) LIMIT 20`, [KWS]);
    console.log(`命中 ${rows.length} 条:`);
    for (const r of rows) {
      console.log(`\n[collection=${r.collection} | rowid=${r.id}]`);
      try {
        const j = JSON.parse(r.v);
        console.log(`  id=${j.id} | title=${(j.title || '').slice(0, 90)}`);
        console.log(`  level=${j.level || j.severity} | time=${j.time} | country=${j.country} | type=${j.type}`);
        console.log(`  url=${(j.url || j.link || '').slice(0, 140)}`);
      } catch (e) { console.log('  (parse fail) ' + r.v.slice(0, 200)); }
    }
  } catch (e) { console.log(`ERR: ${e.message}`); }

  console.log('\n########## D. 墓碑键格式审计 ##########');
  try {
    const { rows } = await pool.query(`SELECT tkey, url FROM intel_tombstones`);
    let prefixed = 0, plain = 0, empty = 0;
    for (const r of rows) {
      const k = String(r.tkey || '');
      if (!k) { empty++; continue; }
      if (k.startsWith('t:') || k.startsWith('u:')) prefixed++; else plain++;
    }
    console.log(`总数=${rows.length} | t:/u:前缀=${prefixed} | 无前缀归一化=${plain} | 空=${empty}`);
    const samples = rows.filter(r => String(r.tkey || '').startsWith('t:')).slice(0, 3);
    console.log('t:前缀样本:', samples.map(r => String(r.tkey).slice(0, 50)));
  } catch (e) { console.log(`ERR: ${e.message}`); }

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
