// Sample-test real media feeds through netx, same UA as production
const netx = require('./netx');
const mediaFeeds = require('./media_feeds');
(async () => {
  // flatten feed list
  const seen = new Map();
  const push = (f) => { if (f && f.url && !seen.has(f.url)) seen.set(f.url, f.name || f.url); };
  const walk = (o) => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o === 'object') { if (o.url) push(o); else Object.values(o).forEach(walk); }
  };
  walk(mediaFeeds);
  const all = [...seen.entries()];
  console.log('total feeds in registry:', all.length);
  // sample: first 12 + every 9th
  const sample = all.filter((_, i) => i < 12 || i % 9 === 0);
  let ok = 0, fail = 0, proxied = 0;
  for (const [url, name] of sample) {
    const t0 = Date.now();
    try {
      const r = await netx.smartFetch(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
      });
      const body = r.status === 200 ? await r.text() : '';
      const items = (body.match(/<(item|entry)[\s>]/gi) || []).length;
      const mode = netx.stats().hosts[new URL(url).hostname] || '?';
      if (mode === 'proxy') proxied++;
      console.log(`${r.status} items=${items} ${Date.now() - t0}ms [${mode}] ${String(name).slice(0, 28)}`);
      if (r.status === 200 && items > 0) ok++; else fail++;
    } catch (e) {
      console.log(`ERR ${String(e.message).slice(0, 40)} ${Date.now() - t0}ms ${String(name).slice(0, 28)}`);
      fail++;
    }
  }
  console.log(`\nSAMPLE RESULT: ok=${ok} fail=${fail} (via proxy=${proxied})`);
  process.exit(0);
})();
