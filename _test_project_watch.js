/* Task #465 验证：项目哨兵手动触发 + 类别均衡首轮日志检查 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
const BASE = 'http://localhost:3000';

(async () => {
  /* 登录 */
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_aa_20260826', password: 'Test123456!' })
  });
  const lj = await lr.json();
  if (!lj.token) { console.log('登录失败(尝试无鉴权直连):', JSON.stringify(lj).slice(0, 120)); }
  const H = lj.token ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lj.token } : { 'Content-Type': 'application/json' };

  console.log('===== A. 触发项目哨兵 =====');
  try {
    const r = await fetch(BASE + '/api/project-watch/sweep', { method: 'POST', headers: H });
    const j = await r.json();
    console.log('HTTP', r.status, JSON.stringify(j).slice(0, 300));
  } catch (e) { console.log('ERR', e.message); }

  /* 等翻译+入库完成 */
  await new Promise(s => setTimeout(s, 60000));

  console.log('\n===== B. 库内验证：project_watch 来源 =====');
  const { rows } = await pool.query(`SELECT data_type, country, title, data_json->>'title_zh' AS tzh, source, collect_time
    FROM intel_data WHERE data_json->>'_sourceType' = 'project_watch' OR source LIKE 'PROJECT-WATCH%' ORDER BY id DESC LIMIT 20`);
  console.log('入库 ' + rows.length + ' 条');
  rows.forEach(r => console.log(`[${r.data_type}|${r.country || '(空)'}] ${(r.tzh || r.title || '').slice(0, 70)}`));

  console.log('\n===== C. 翻译质量复测（近1小时入库） =====');
  const q = await pool.query(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE COALESCE(data_json->>'title_zh','') = '')::int nozh
    FROM intel_data WHERE collect_time >= NOW() - INTERVAL '1 hour'`);
  const s = q.rows[0];
  console.log(`近1小时: ${s.total} 条, 无中文 ${s.nozh} 条`);

  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
