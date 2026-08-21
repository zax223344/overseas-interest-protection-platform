(async () => {
  const url = 'https://apnews.com/search?q=' + encodeURIComponent('China sanctions') + '&s=0';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  console.log('status', r.status, 'len', html.length);
  // 查找文章链接
  const links = [...html.matchAll(/apnews\.com\/article\/[a-z0-9-]+/g)];
  console.log('article links found:', links.length);
  links.slice(0, 10).forEach(m => console.log(' ', m[0]));
  // 查找 JSON 数据
  const idx = html.indexOf('__NEXT_DATA__');
  console.log('__NEXT_DATA__ idx:', idx);
  const idx2 = html.indexOf('window.__DATA__');
  console.log('__DATA__ idx:', idx2);
})();
