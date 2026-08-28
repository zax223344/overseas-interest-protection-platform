/* 探针 v3：刚果金本地小源 RSS 可用性 */
const netx = require('./netx.js');
const candidates = [
  'https://magazinelaguardia.com/feed/',
  'https://magazinelaguardia.cd/feed/',
  'https://www.magazinelaguardia.com/feed/',
  'https://actualite.cd/rss.xml',
  'https://actualite.cd/feed',
  'https://7sur7.cd/feed',
  'https://7sur7.cd/rss.xml',
  'https://www.radiookapi.net/feed',
  'https://eventsrdc.com/feed/',
  'https://lacampagne.cd/feed/',
  'https://congoprofond.net/feed/',
  'https://deskeco.com/feed/',
  'https://financialafrik.com/feed/',
  'https://koaci.com/rss',
  'https://news.abidjan.net/rss/',
  'https://www.africanews.com/rss.xml'
];
(async () => {
  for (const u of candidates) {
    try {
      const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 });
      const t = await r.text();
      const isXml = /<rss|<feed|<\?xml/i.test(t.slice(0, 500));
      const items = (t.match(/<item[\s>]/gi) || []).length + (t.match(/<entry[\s>]/gi) || []).length;
      console.log((r.ok && isXml ? 'OK  ' : 'BAD '), r.status, items + ' items', u);
      if (r.ok && isXml && items) {
        const m = t.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        console.log('      site:', m ? m[1].trim().slice(0, 80) : '?');
      }
    } catch (e) { console.log('ERR ', u, e.message.slice(0, 60)); }
  }
  process.exit(0);
})();
