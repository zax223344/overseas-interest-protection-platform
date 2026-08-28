// Gentle rescan of previously-failed feeds: concurrency 2, timeout 15s, 2 attempts
// 支持断点续扫：.cache/feed-rescan.partial.json 存在时跳过已完成 URL
const fs = require('fs');
const netx = require('./netx');

const prev = JSON.parse(fs.readFileSync('.cache/feed-scan.json', 'utf8')).results;
const todo0 = prev.filter(r => !(r.status === 200 && r.items > 0)); // all non-healthy

const out = [];
if (fs.existsSync('.cache/feed-rescan.partial.json')) {
  try {
    const p = JSON.parse(fs.readFileSync('.cache/feed-rescan.partial.json', 'utf8'));
    (p.results || []).forEach(r => out.push(r));
    console.log('resuming: skip', out.length, 'already done');
  } catch (e) {}
}
const doneUrls = new Set(out.map(r => r.url));
const todo = todo0.filter(r => !doneUrls.has(r.url));
let idx = 0, done = 0;

async function attempt(url) {
  return netx.smartFetch(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none'
    }
  });
}

function flush(final) {
  fs.writeFileSync(final ? '.cache/feed-rescan.json' : '.cache/feed-rescan.partial.json',
    JSON.stringify({ t: new Date().toISOString(), done: out.length, total: todo0.length, results: out }, null, 1));
}

async function worker() {
  while (idx < todo.length) {
    const it = todo[idx++];
    let rec = null;
    for (let a = 0; a < 2 && !rec; a++) {
      try {
        const r = await attempt(it.url);
        const body = r.status === 200 ? await r.text() : '';
        const items = (body.match(/<(item|entry)[\s>]/gi) || []).length;
        const mode = netx.stats().hosts[new URL(it.url).hostname] || '?';
        rec = { url: it.url, name: it.name, status: r.status, items, mode };
        if (!(r.status === 200 && items > 0) && a === 0) { rec = null; await new Promise(s => setTimeout(s, 1500)); }
      } catch (e) {
        if (a === 1) rec = { url: it.url, name: it.name, status: 0, items: 0, err: String(e.message).slice(0, 50) };
        else await new Promise(s => setTimeout(s, 1500));
      }
    }
    out.push(rec);
    done++;
    if (done % 25 === 0) {
      const okNow = out.filter(x => x.status === 200 && x.items > 0).length;
      console.log(`progress ${out.length}/${todo0.length} recovered-so-far=${okNow}`);
      flush(false);
    }
  }
}

(async () => {
  console.log('rescanning', todo.length, 'remaining of', todo0.length, 'failed feeds gently...');
  await Promise.all([worker(), worker(), worker(), worker()]);
  flush(true);
  const ok = out.filter(x => x.status === 200 && x.items > 0);
  const stillNet = out.filter(x => x.status === 0);
  const http = out.filter(x => x.status !== 0 && !(x.status === 200 && x.items > 0));
  console.log(`RESCAN DONE: total=${out.length} recovered=${ok.length} (proxy=${ok.filter(x => x.mode === 'proxy').length}) stillNetfail=${stillNet.length} httpErr=${http.length}`);
  process.exit(0);
})();
