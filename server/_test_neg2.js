const gm = require('./globalmedia');
const scrapers = require('./scrapers');

(async () => {
  console.log('=== scrapeChinaNegative (RSS sources) ===');
  const res = await gm.scrapeChinaNegative({ sources: (gm.CHINA_NEGATIVE_SOURCES || []).slice(0, 5), concurrency: 4, timeout: 8000 });
  console.log('count:', res.count);
  for (const it of (res.items || []).slice(0, 5)) {
    const txt = (it.title || '') + ' ' + (it.content || '');
    const gate = scrapers.chinaOverseasGate(txt);
    console.log('title:', it.title);
    console.log('  gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(txt, gate));
  }
  console.log('=== GDELT negative ===');
  const crawler = require('./crawler');
  const arts = await crawler.gdeltSearch('(China OR Chinese) (sanction OR ban OR restriction OR tariff)', { timespan: '2d', maxrecords: 10 });
  console.log('gdelt count:', arts.length);
  for (const a of arts.slice(0, 5)) {
    const txt = a.title || '';
    const gate = scrapers.chinaOverseasGate(txt);
    console.log('title:', a.title, 'gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(txt, gate));
  }
})();
