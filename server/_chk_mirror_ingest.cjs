const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'orps_user', database: 'orps_db' });
  await c.connect();
  const r = await c.query("SELECT id, left(coalesce(data_json->>'title_zh', data_json->>'title',''), 70) t, left(coalesce(data_json->>'source',''), 30) s, data_json->>'severity' sev, data_json->>'_fromSource' fs, collect_time FROM intel_data WHERE collect_time > now() - interval '30 minutes' AND data_json->>'_fromSource' LIKE 'WECHAT_MIRROR%' ORDER BY id DESC LIMIT 6");
  r.rows.forEach(x => console.log(x.id, '|', x.t, '|', x.s, '|', x.sev, '|', x.fs, '|', x.collect_time));
  const r2 = await c.query("SELECT id, left(data_json->>'title','', 70) t, left(coalesce(data_json->>'content',''),150) body FROM intel_data WHERE data_json->>'url' LIKE '%dtaygroup.com/content/?1308%' LIMIT 1");
  r2.rows.forEach(x => { console.log('--- 刚果金案 id=' + x.id); console.log('标题:', x.t); console.log('正文:', x.body); });
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
