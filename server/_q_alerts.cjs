const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
(async () => {
  const client = await pool.connect();
  const r = await client.query("SELECT collection, data_json, updated_at FROM datahub_store WHERE collection='alerts'");
  if (!r.rows.length) { console.log('no alerts collection'); client.release(); await pool.end(); return; }
  const arr = r.rows[0].data_json;
  console.log('alerts total:', arr.length, 'updated_at', r.rows[0].updated_at);
  const congo = arr.filter(a => /刚果|Congo|DRC|Katanga|Pweto/.test((a.country||'')+(a.title||a.title_zh||'')));
  console.log('Congo alerts:', congo.length);
  congo.forEach(a => console.log(' -', a.id, a.country, a.level, (a.title||a.title_zh||'').slice(0, 60), '| time=', a.time, '| date=', a.date, '| pubDate=', a.pubDate, '| publishedAt=', a.publishedAt));
  const ids = arr.filter(a => a.id && String(a.id).match(/22949|22950/));
  console.log('id match:', ids.length);
  ids.forEach(a => console.log(' -', a.id, a.country, a.level, (a.title||a.title_zh||'').slice(0,60), '| time=', a.time));
  const found = arr.find(a => a.id === 'SRV-22949');
  if (found) console.log('FULL SRV-22949:', JSON.stringify(found, null, 2));
  else console.log('SRV-22949 not in array');
  client.release(); await pool.end();
})().catch(e=>{console.error(e);process.exit(1);});
