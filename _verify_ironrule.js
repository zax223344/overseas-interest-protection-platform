const http = require('http');
function get(path) {
  return new Promise((res, rej) => {
    http.get('http://127.0.0.1:3000' + path, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res({ _raw: d.slice(0, 200) }); } });
    }).on('error', rej);
  });
}
const RE = /afghan|阿富汗|taliban|塔利班|iskp|isis-k|islamic state|kabul|喀布尔|俾路支|afghanistan/i;
(async () => {
  try {
    const stats = await get('/api/intel/stats');
    console.log('===== /api/intel/stats =====');
    console.log(JSON.stringify(stats, null, 1).slice(0, 900));
  } catch (e) { console.log('stats ERR', e.message); }
  for (const t of ['terror_events', 'geopolitical_intel', 'security_events']) {
    try {
      const arr = await get('/api/intel/public/' + t + '?limit=300');
      const list = Array.isArray(arr) ? arr : (arr && arr.data ? arr.data : (Array.isArray(arr && arr.rows) ? arr.rows : []));
      const hits = list.filter(x => RE.test((x.title || '') + ' ' + (x.title_zh || '') + ' ' + (x.content || '')));
      console.log('\n===== ' + t + ' : 总量 ' + list.length + ' | 阿富汗/塔利班相关 ' + hits.length + ' =====');
      hits.slice(0, 6).forEach(h => console.log('  - [' + (h.level || h.severity || '?') + '] ' + (h.title_zh || h.title || '').slice(0, 72)));
    } catch (e) { console.log(t + ' ERR', e.message); }
  }
})();
