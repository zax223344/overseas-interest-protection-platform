// Full registry health scan: all feeds through netx, concurrency 8
const fs = require('fs');
const netx = require('./netx');
const mediaFeeds = require('./media_feeds');

const seen = new Map();
const push = (f) => { if (f && f.url && !seen.has(f.url)) seen.set(f.url, f.name || f.url); };
const walk = (o) => {
  if (!o) return;
  if (Array.isArray(o)) return o.forEach(walk);
  if (typeof o === 'object') { if (o.url) push(o); else Object.values(o).forEach(walk); }
};
walk(mediaFeeds);
const all = [...seen.entries()];
const out = [];
let idx = 0, done = 0;

async function worker() {
  while (idx < all.length) {
    const i = idx++;
    const [url, name] = all[i];
    const t0 = Date.now();
    let rec;
    try {
      const r = await netx.smartFetch(url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
      });
      const body = r.status === 200 ? await r.text() : '';
      const items = (body.match(/<(item|entry)[\s>]/gi) || []).length;
      const mode = (netx.stats().hosts[new URL(url).hostname]) || '?';
      rec = { url, name, status: r.status, items, ms: Date.now() - t0, mode };
    } catch (e) {
      rec = { url, name, status: 0, items: 0, ms: Date.now() - t0, err: String(e.message).slice(0, 60) };
    }
    out.push(rec);
    done++;
    if (done % 40 === 0) console.log(`progress ${done}/${all.length}`);
  }
}

(async () => {
  console.log('scanning', all.length, 'feeds...');
  await Promise.all(Array.from({ length: 8 }, worker));
  out.sort((a, b) => (a.status - b.status) || (a.items - b.items));
  fs.writeFileSync('.cache/feed-scan.json', JSON.stringify({ t: new Date().toISOString(), results: out }, null, 1));
  const ok = out.filter(r => r.status === 200 && r.items > 0);
  const dead = out.filter(r => r.status === 404 || r.status === 410);
  const netfail = out.filter(r => r.status === 0);
  const other = out.filter(r => !ok.includes(r) && !dead.includes(r) && !netfail.includes(r));
  console.log(`DONE total=${out.length} ok=${ok.length} (direct=${ok.filter(r => r.mode === 'direct').length} proxy=${ok.filter(r => r.mode === 'proxy').length}) dead404=${dead.length} netfail=${netfail.length} other=${other.length}`);
  process.exit(0);
})();
