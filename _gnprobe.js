const netx = require('./server/netx');
(async () => {
  const qs = ['Kyrgyzstan when:7d', 'Kyrgyzstan summit when:7d'];
  for (const q of qs) {
    try {
      const r = await netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en',
        { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } });
      if (!r || !r.ok) { console.log(q, '=> HTTP', r && r.status); }
      else {
        const t = await r.text();
        const n = (t.match(/<item>/g) || []).length;
        console.log(q, '=>', n, 'items,', t.length, 'bytes');
      }
    } catch (e) { console.log(q, '=> ERR', e.message); }
    await new Promise(s => setTimeout(s, 6000));
  }
})();
