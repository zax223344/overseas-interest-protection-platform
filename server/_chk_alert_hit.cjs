/* 查预警队列 datahub_store 是否已含刚果金案 */
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'orps_user', database: 'orps_db' });
  await c.connect();
  const r = await c.query("SELECT data_json FROM datahub_store WHERE collection='alerts' LIMIT 1");
  if (!r.rows.length) { console.log('alerts store empty'); await c.end(); return; }
  const raw = r.rows[0].data_json;
  const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
  console.log('alerts total:', arr.length);
  const hit = arr.filter(a => String(a.title || '').includes('上加丹加') || String(a.title || '').includes('刚果'));
  hit.forEach(a => console.log('HIT id=' + a.id, '|', String(a.title).slice(0, 60), '|', a.level || a.level_norm || '', '|', a.country || ''));
  if (!hit.length) console.log('刚果金案未在预警队列（在数据中心，预警评分闸未过或待下轮）');
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
