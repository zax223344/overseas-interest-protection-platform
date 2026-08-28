/* 探针 v4：magazinelaguardia http 变体 + 7sur7 路径 */
const netx = require('./netx.js');
const candidates = [
  'http://magazinelaguardia.com/feed/',
  'http://magazinelaguardia.cd/feed/',
  'http://www.magazinelaguardia.com/feed/',
  'https://7sur7.cd/index.php/feed/',
  'https://7sur7.cd/feed/',
  'http://7sur7.cd/feed/'
];
(async () => {
  for (const u of candidates) {
    try {
      const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000, redirect: 'follow' });
      const t = await r.text();
      const isXml = /<rss|<feed|<\?xml/i.test(t.slice(0, 500));
      const items = (t.match(/<item[\s>]/gi) || []).length;
      console.log((r.ok && isXml ? 'OK  ' : 'BAD '), r.status, items + ' items', u, '->', r.url || '');
      if (r.ok && items) {
        const titles = [...t.matchAll(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/gi)].slice(0, 6);
        titles.forEach(m => console.log('      -', m[1].trim().slice(0, 100)));
      }
    } catch (e) { console.log('ERR ', u, e.message.slice(0, 70)); }
  }
  process.exit(0);
})();
