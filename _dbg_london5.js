/* Task #464 step5: 归档库全量搜目标文章变体 + 预警 id 规则溯源 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

(async () => {
  console.log('########## A. intel_archive 全量搜使馆文章变体 ##########');
  const KWS = ['%使馆%', '%大使馆%', '%embassy%'];
  const { rows } = await pool.query(
    `SELECT id, title, country, data_type, source, collect_time, created_at, updated_at,
            data_json->>'title_zh' AS tzh, data_json->>'url' AS url
     FROM intel_archive WHERE title ILIKE ANY($1) OR (data_json->>'title_zh') ILIKE ANY($1) OR (data_json->>'url') ILIKE ANY($1)
     ORDER BY id DESC`, [KWS]);
  console.log(`intel_archive 使馆命中: ${rows.length} 条`);
  for (const r of rows) {
    const t = r.title || '';
    const isTarget = /伦敦|london|巨型|超级|倒塌|180/i.test(t + (r.tzh || '') + (r.url || ''));
    if (isTarget) console.log(`>>> id=${r.id} | ${t.slice(0, 95)}\n    tzh=${(r.tzh || '').slice(0, 95)}\n    ct=${r.collect_time} | up=${r.updated_at} | src=${(r.source || '').slice(0, 30)}\n    url=${(r.url || '').slice(0, 130)}`);
  }

  console.log('\n########## B. 目标 alert 完整对象 ##########');
  const { rows: arows } = await pool.query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
  const arr = arows[0].data_json;
  const target = arr.filter(a => String(a.title || '').includes('伦敦新中国巨型'));
  for (const t of target) console.log(JSON.stringify(t, null, 1).slice(0, 1500));

  console.log('\n########## C. 队列 id 形态分布 ##########');
  const idShape = {};
  for (const a of arr) {
    const id = String(a.id || '');
    const shape = id.startsWith('SRV-') ? 'SRV-<行id>' : id.startsWith('ANOM-') ? 'ANOM-' : /^\d{13}$/.test(id) ? '时间戳id' : '其他:' + id.slice(0, 12);
    idShape[shape] = (idShape[shape] || 0) + 1;
  }
  console.log(idShape);

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
