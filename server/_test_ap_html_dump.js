(async () => {
  const url = 'https://apnews.com/search?q=' + encodeURIComponent('China sanctions') + '&s=0';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  console.log('status', r.status, 'url', r.url);
  console.log('---HTML START---');
  console.log(html.slice(0, 3000));
  console.log('---HTML END---');
})();
