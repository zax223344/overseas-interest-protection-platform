(async () => {
  const url = 'https://apnews.com/search?q=' + encodeURIComponent('China sanctions') + '&s=0';
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    },
    signal: AbortSignal.timeout(15000)
  });
  const html = await r.text();
  console.log('status', r.status, 'len', html.length);
  const links = [...html.matchAll(/apnews\.com\/article\/[a-z0-9-]+/g)];
  console.log('article links:', links.length);
  console.log('first link:', links[0] ? links[0][0] : 'none');
  // print a snippet
  if (links.length) {
    const idx = html.indexOf(links[0][0]);
    console.log(html.slice(Math.max(0, idx - 300), idx + 300));
  }
})();
