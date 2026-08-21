(async () => {
  const url = 'https://apnews.com/search?q=' + encodeURIComponent('China sanctions') + '&s=0';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  console.log('length', html.length);
  // Print a snippet around first article link
  const idx = html.indexOf('apnews.com/article/');
  console.log('idx', idx);
  if (idx > 0) console.log(html.slice(Math.max(0, idx - 500), idx + 1500));
})();
