const path = require('path');
const pool = require(path.join(__dirname, '..', 'server', 'db.js')).pool || require(path.join(__dirname, '..', 'server', 'db.js'));
(async () => {
  const r = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  const arr = Array.isArray(r.rows[0].data_json) ? r.rows[0].data_json : JSON.parse(r.rows[0].data_json);
  const dist = {};
  arr.forEach(a => { dist[a.source || '(空)'] = (dist[a.source || '(空)'] || 0) + 1; });
  console.log('=== alerts 最终 source 分布（共 ' + arr.length + ' 条） ===');
  Object.entries(dist).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => console.log(String(v).padStart(3), '|', k));
  // 目标条目复查
  const t = arr.find(a => String(a.id) === '1788081591743');
  if (t) console.log('\n目标条目 1788081591743 →', JSON.stringify({ source: t.source, url: (t.url || '').slice(0, 80), time: t.time, level: t.level, title: t.title }));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
