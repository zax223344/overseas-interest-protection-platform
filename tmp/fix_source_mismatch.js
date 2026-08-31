/* 来源错配数据清洗：REGISTRY 名 + news.google.com URL 的条目 → 从 desc 提取真实媒体名 */
const path = require('path');
const fs = require('fs');
const pool = require(path.join(__dirname, '..', 'server', 'db.js')).pool || require(path.join(__dirname, '..', 'server', 'db.js'));

// 从 datasources.js 提取全部 REGISTRY 源名（运行时构建，避免手写清单漂移）
const dsSrc = fs.readFileSync(path.join(__dirname, '..', 'datasources.js'), 'utf8');
const regNames = new Set();
for (const m of dsSrc.matchAll(/name:\s*'([^']+)'/g)) regNames.add(m[1]);
console.log('REGISTRY 源名数:', regNames.size);

function decodeEntities(s) {
  return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
// 真实媒体名提取链：desc 的 <font color="#6f6f6f">媒体</font> → 标题尾缀"-媒体" → Google News
function realSource(a) {
  const d = decodeEntities(a.desc || a.description || '');
  let m = d.match(/<font[^>]*>\s*([^<]{2,30})\s*<\/font>/);
  if (m) return m[1].trim();
  m = String(a.title_zh || a.title || '').match(/[-–]\s*([^\-–]{2,20})\s*$/);
  if (m && !/^[0-9]/.test(m[1])) return m[1].trim();
  return 'Google News';
}

(async () => {
  let fixed = 0;
  for (const coll of ['alerts', 'events', 'terror_events', 'china_security']) {
    const r = await pool.query('SELECT id, data_json FROM datahub_store WHERE collection=$1', [coll]);
    if (!r.rows.length) continue;
    const row = r.rows[0];
    let arr = row.data_json;
    if (!Array.isArray(arr)) { try { arr = JSON.parse(arr); } catch (e) { continue; } }
    if (!Array.isArray(arr)) continue;
    let n = 0;
    for (const a of arr) {
      if (a && a.source && regNames.has(a.source) && String(a.url || '').indexOf('news.google.com') >= 0) {
        const old = a.source;
        a.source = realSource(a);
        n++;
        if (coll === 'alerts') console.log('  [' + coll + ']', old, '→', a.source, '|', (a.title_zh || a.title || '').slice(0, 45));
      }
    }
    if (n) {
      await pool.query('UPDATE datahub_store SET data_json=$1, updated_at=now() WHERE collection=$2', [JSON.stringify(arr), coll]);
      console.log('[' + coll + '] 清洗 ' + n + ' 条');
      fixed += n;
    }
  }
  // intel_data：Shodan 等错标条目按 URL 域名纠正
  const domainMap = { 'japantimes.co.jp': 'The Japan Times', 'euromaidanpress.com': 'Euromaidan Press' };
  const bad2 = await pool.query("SELECT id, source, (data_json->>'url') AS url FROM intel_data WHERE source = ANY($1) AND data_json->>'url' IS NOT NULL", [[...regNames]]);
  let n2 = 0;
  for (const row of bad2.rows) {
    let match = null;
    for (const [dom, name] of Object.entries(domainMap)) if (String(row.url).indexOf(dom) >= 0) match = name;
    if (!match) {
      try { match = new URL(row.url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
    }
    if (match && match !== row.source) {
      await pool.query('UPDATE intel_data SET source=$1 WHERE id=$2', [match, row.id]);
      console.log('[intel_data]', row.id, '|', row.source, '→', match);
      n2++;
    }
  }
  console.log('=== 完成：datahub 清洗', fixed, '条 | intel_data 纠正', n2, '条 ===');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
