(async () => {
  const q = '(China OR Chinese) (sanction OR ban)';
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) + '&mode=artlist&maxrecords=10&format=json&sort=datedesc&timespan=2d';
  console.log('url:', url);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    console.log('status', r.status);
    const txt = await r.text();
    console.log('len', txt.length);
    console.log(txt.slice(0, 500));
  } catch (e) {
    console.log('err', e.message);
  }
})();
