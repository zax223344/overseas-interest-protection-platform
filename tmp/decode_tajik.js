const path = require('path');
const { execFile } = require('child_process');
const pool = require(path.join(__dirname, '..', 'server', 'db.js')).pool || require(path.join(__dirname, '..', 'server', 'db.js'));
const PY = 'C:/Users/28737/.workbuddy/binaries/python/envs/osint/Scripts/python.exe';
const DEC = path.join(__dirname, '..', 'server', 'decode-gnews.py');

function decode(url) {
  return new Promise(res => {
    execFile(PY, [DEC, url], { timeout: 40000 }, (err, stdout) => {
      try { const j = JSON.parse(stdout); res(j.ok ? j.url : null); } catch (e) { res(null); }
    });
  });
}

(async () => {
  const r = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  const arr = Array.isArray(r.rows[0].data_json) ? r.rows[0].data_json : JSON.parse(r.rows[0].data_json);
  const hits = arr.filter(a => JSON.stringify(a).indexOf('塔吉克') >= 0);
  for (const a of hits) {
    const orig = await decode(a.url);
    console.log(a.id, '|', (a.title_zh || a.title || '').slice(0, 40), '\n   原文 →', orig || '(解码失败)');
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
