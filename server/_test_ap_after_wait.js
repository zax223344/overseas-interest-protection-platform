const crawler = require('./crawler');
const gm = require('./globalmedia');
const scrapers = require('./scrapers');

(async () => {
  await new Promise(r => setTimeout(r, 5000));
  console.log('=== AP search test after wait ===');
  const queries = ['China sanctions', 'China export control', 'China trade war'];
  for (const q of queries) {
    const arts = await crawler.apSearch(q, { maxrecords: 8, pages: 1 });
    console.log(`[${q}] got ${arts.length}`);
    for (const a of arts.slice(0, 3)) {
      const txt = (a.title || '') + ' ' + (a.description || '');
      const gate = scrapers.chinaOverseasGate(txt);
      console.log('  title:', a.title, 'gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(txt, gate));
    }
    await new Promise(r => setTimeout(r, 3000));
  }
})();
