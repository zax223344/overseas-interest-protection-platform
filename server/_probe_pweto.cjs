/* 现场验证：跑一次哨兵并逐层打印产出；另用精确法文查询直打 GDELT 验证该案能否被检索到 */
const w = require('./cn-security-watch.js');
const netx = require('./netx');

(async () => {
  console.log('=== 1) GDELT 精确法文查询验证 ===');
  const q = '"chinois" (enlevé OR enlevés OR tué OR attaque) sourcelang:fra';
  try {
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) + '&mode=artlist&maxrecords=25&format=json&timespan=3d';
    const r = await netx.smartFetch(url, { signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    const arts = j.articles || [];
    console.log('GDELT hits:', arts.length);
    arts.slice(0, 10).forEach(a => console.log(' -', (a.seendate || ''), '|', (a.title || '').slice(0, 90), '|', (a.domain || '')));
  } catch (e) { console.log('GDELT ERR:', e.message); }

  console.log('=== 2) 哨兵全量跑一轮 ===');
  const t0 = Date.now();
  try {
    const res = await w.runCnSecurityWatch({ log: (...a) => console.log('[W]', ...a) });
    const items = res && res.items ? res.items : (Array.isArray(res) ? res : []);
    console.log('candidates:', items.length, 'in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
    items.forEach(it => console.log(' *', (it.date || '').slice(0, 16), '|', (it.title || '').slice(0, 90)));
  } catch (e) { console.log('WATCH ERR:', e.message); }
  process.exit(0);
})();
