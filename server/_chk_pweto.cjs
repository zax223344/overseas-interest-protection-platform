const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'orps_user', database: 'orps_db' });
  await c.connect();
  const kw = ['%Pweto%', '%pweto%', '%上加丹加%', '%Haut-Katanga%', '%chinois enlev%', '%chinois%enlev%', '%laguardia%'];
  for (const k of kw) {
    const r = await c.query("SELECT id, left(coalesce(data_json->>'title_zh', data_json->>'title',''), 80) t, collect_time FROM intel_data WHERE (data_json->>'title' ILIKE $1 OR data_json->>'title_zh' ILIKE $1 OR data_json->>'url' ILIKE $1) ORDER BY id DESC LIMIT 3", [k]);
    console.log(k, '=>', r.rows.length, r.rows.map(x => x.id + ' | ' + x.t + ' | ' + x.collect_time));
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
