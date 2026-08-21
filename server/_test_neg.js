const crawler = require('./crawler');
const gm = require('./globalmedia');
const scrapers = require('./scrapers');

(async () => {
  console.log('=== AP search test ===');
  const queries = ['China sanctions', 'China ban restriction', 'China trade war tariffs'];
  for (const q of queries) {
    const arts = await crawler.apSearch(q, { maxrecords: 10, pages: 1 });
    console.log(`[${q}] got ${arts.length}`);
    for (const a of arts.slice(0, 3)) {
      const txt = (a.title || '') + ' ' + (a.description || '');
      const gate = scrapers.chinaOverseasGate(txt);
      const ng = gm.chinaNegativeGate(txt, gate);
      console.log('  url:', a.url);
      console.log('  title:', a.title);
      console.log('  gate:', gate.pass, gate.reason, 'negGate:', ng);
    }
  }
})();
