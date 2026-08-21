const gm = require('./globalmedia');
const scrapers = require('./scrapers');

(async () => {
  const res = await gm.scrapeChinaNegative({ sources: (gm.CHINA_NEGATIVE_SOURCES || []).slice(0, 5), concurrency: 4, timeout: 8000 });
  console.log('count:', res.count);
  for (const it of (res.items || []).slice(0, 5)) {
    const txt = (it.title || '') + ' ' + (it.content || '');
    const gate = scrapers.chinaOverseasGate(txt);
    console.log('---');
    console.log('title:', it.title);
    console.log('content:', (it.content || '').slice(0, 200));
    console.log('txt:', txt);
    console.log('gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(txt, gate));
  }
})();
