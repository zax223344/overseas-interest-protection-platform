const netx = require('./server/netx');
(async () => {
  const qs = [
    'Kyrgyzstan sourcelang:english',
    'sourcecountry:KG sourcelang:english',
    '"Kyrgyzstan" summit',
    '"Kyrgyzstan" opposition'
  ];
  for (const q of qs) {
    try {
      const r = await netx.smartFetch('https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) + '&mode=artlist&maxrecords=250&format=json&sort=datedesc&timespan=7d', { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 ORPS' } });
      if (!r || !r.ok) { console.log(q, '=> HTTP', r && r.status); }
      else {
        const t = await r.text();
        try { const j = JSON.parse(t); console.log(q, '=>', (j.articles || []).length, 'articles'); }
        catch (e) { console.log(q, '=> non-json:', t.slice(0, 120)); }
      }
    } catch (e) { console.log(q, '=> ERR', e.message); }
    await new Promise(s => setTimeout(s, 7000)); /* GDELT 限流间隔 */
  }
})();
