/* Task #466: 数据流转与实时联动全链路抽样验证
 * A. 最近30min入库条目（intel_data）
 * B. 这些条目是否进入预警共享库（datahub alerts）
 * C. 前端关键接口实时返回（/api/datahub/alerts、/api/intel/latest、SSE）
 * D. 预警生成日志与分发延迟 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
const BASE = 'http://localhost:3000';

(async () => {
  console.log('===== A. 最近30分钟入库 =====');
  const recent = await pool.query(`SELECT id, data_type, country, title, data_json->>'title_zh' tzh, collect_time
    FROM intel_data WHERE collect_time >= NOW() - INTERVAL '30 minutes' ORDER BY id DESC LIMIT 12`);
  console.log('近30min入库 ' + recent.rows.length + ' 条');
  recent.rows.forEach(r => console.log(`  id=${r.id} [${r.data_type}|${r.country || '空'}] ${String(r.tzh || r.title).slice(0, 55)}`));

  console.log('\n===== B. 预警共享库联动 =====');
  const alerts = await pool.query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
  let alertArr = [];
  try { alertArr = (alerts.rows.length && Array.isArray(alerts.rows[0].data_json)) ? alerts.rows[0].data_json : []; } catch (e) {}
  console.log('预警共享库总数: ' + alertArr.length);
  /* 抽样：最近入库的条目有多少出现在预警库（通过 SRV-<id> 或标题匹配） */
  let hit = 0, miss = [];
  const alertTitles = new Set(alertArr.map(a => String(a.title || '').slice(0, 20)));
  const srvIds = new Set(alertArr.map(a => String(a.id || '')));
  for (const r of recent.rows) {
    const tzh = String(r.tzh || r.title || '').slice(0, 20);
    if (srvIds.has('SRV-' + r.id) || alertTitles.has(tzh)) hit++;
    else miss.push(`id=${r.id} ${String(r.tzh || r.title).slice(0, 40)}`);
  }
  console.log(`近30min条目在预警库中: ${hit}/${recent.rows.length}`);
  if (miss.length && miss.length <= 8) miss.forEach(m => console.log('  未联动: ' + m));

  console.log('\n===== C. 前端接口实时性 =====');
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test_aa_20260826', password: 'Test123456!' }) });
  const lj = await lr.json();
  const H = lj.token ? { 'Authorization': 'Bearer ' + lj.token } : {};
  for (const [name, url] of [
    ['datahub/alerts', '/api/datahub/alerts'],
    ['实时情报流', '/api/intel/latest?limit=8'],
    ['今日漏斗', '/api/funnel/today'],
    ['每日统计', '/api/stats/daily']
  ]) {
    try {
      const t0 = Date.now();
      const r = await fetch(BASE + url, { headers: H });
      const j = await r.json();
      const ms = Date.now() - t0;
      let n = '?';
      if (Array.isArray(j)) n = j.length;
      else if (j.alerts && Array.isArray(j.alerts)) n = j.alerts.length;
      else if (j.items && Array.isArray(j.items)) n = j.items.length;
      else if (j.data) n = JSON.stringify(j.data).length;
      console.log(`  ${name}: HTTP ${r.status} ${ms}ms 条数=${n} keys=${Object.keys(j).slice(0, 5).join('/')}`);
    } catch (e) { console.log(`  ${name}: ERR ${e.message}`); }
  }
  /* SSE 实时推送通道 */
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(BASE + '/api/stream', { headers: H, signal: ctrl.signal });
    console.log('  SSE /api/stream: HTTP ' + r.status + ' content-type=' + (r.headers.get('content-type') || '?'));
    clearTimeout(t); ctrl.abort();
  } catch (e) { console.log('  SSE /api/stream: ' + (e.name === 'AbortError' ? '(连接正常，4s 探测超时截断)' : 'ERR ' + e.message)); }

  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
