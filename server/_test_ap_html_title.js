(async () => {
  const url = 'https://apnews.com/search?q=' + encodeURIComponent('China sanctions') + '&s=0';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  const idx = html.indexOf('apnews.com/article/china');
  console.log('idx', idx);
  if (idx > 0) {
    const seg = html.slice(Math.max(0, idx - 1000), idx + 2000);
    console.log(seg);
  }
})();
