/* Task #464 step4: datahub alerts 队列结构 + 使馆文章定位 + 墓碑时间线 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

(async () => {
  console.log('########## A. alerts collection 结构 ##########');
  const { rows } = await pool.query(`SELECT id, collection, updated_at, length(data_json::text) AS len FROM datahub_store WHERE collection='alerts'`);
  for (const r of rows) console.log(`rowid=${r.id} | updated=${r.updated_at} | len=${r.len}`);
  const { rows: arows } = await pool.query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
  const j = arows[0].data_json;
  console.log('顶层类型:', Array.isArray(j) ? `array(${j.length})` : typeof j, '| 顶层键:', Array.isArray(j) ? '-' : Object.keys(j).join(','));
  const arr = Array.isArray(j) ? j : (j.items || j.data || j.alerts || []);
  console.log('队列长度:', arr.length);
  console.log('首条样本键:', arr[0] ? Object.keys(arr[0]).join(',') : 'EMPTY');

  console.log('\n########## B. 队列内使馆/伦敦文章 ##########');
  const KWS = ['公寓倒塌', '伦敦标准晚报', '180米', '使馆', 'embassy', '伦敦', '倒塌'];
  const hits = arr.filter(a => {
    const s = JSON.stringify(a);
    return KWS.some(k => s.includes(k));
  });
  for (const h of hits) {
    console.log(`\nid=${h.id} | title=${(h.title || '').slice(0, 95)}`);
    console.log(`  level=${h.level || h.severity} | time=${h.time} | country=${h.country} | type=${h.type} | _riskVersion=${h._riskVersion}`);
    console.log(`  url=${(h.url || h.link || '').slice(0, 140)}`);
    console.log(`  desc=${(h.desc || h.description || '').slice(0, 120)}`);
  }
  console.log(`\n命中 ${hits.length} / ${arr.length} 条`);

  console.log('\n########## C. 墓碑 created_at 时间线 ##########');
  const { rows: tr } = await pool.query(
    `SELECT date_trunc('hour', created_at) AS h, COUNT(*)::int AS n,
            SUM(CASE WHEN tkey LIKE 't:%' OR tkey LIKE 'u:%' THEN 1 ELSE 0 END)::int AS prefixed,
            SUM(CASE WHEN tkey NOT LIKE 't:%' AND tkey NOT LIKE 'u:%' THEN 1 ELSE 0 END)::int AS plain
     FROM intel_tombstones GROUP BY h ORDER BY h`);
  for (const r of tr) console.log(`${r.h} | n=${r.n} | prefixed=${r.prefixed} | plain=${r.plain}`);

  console.log('\n########## D. 4 条无前缀墓碑 ##########');
  const { rows: pr } = await pool.query(`SELECT id, tkey, url, title, created_at FROM intel_tombstones WHERE tkey NOT LIKE 't:%' AND tkey NOT LIKE 'u:%'`);
  for (const r of pr) console.log(`id=${r.id} | tkey=${String(r.tkey).slice(0, 60)} | at=${r.created_at}`);

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
