process.on('unhandledRejection', e => { console.error('UNHANDLED:', e && e.stack || e); process.exit(2); });
(async () => {
  try {
    const crawler = require('./crawler');
    console.log('crawler OK; gdeltSearch=', typeof crawler.gdeltSearch, 'chinaRelated=', typeof crawler.chinaRelated, 'interestRelated=', typeof crawler.interestRelated);
  } catch (e) { console.error('REQUIRE crawler FAIL:', e && e.stack || e); process.exit(3); }

  let gm;
  try {
    gm = require('./globalmedia');
    console.log('globalmedia OK; countries=', gm.GLOBAL_COUNTRIES.length, 'scrapeGlobalMedia=', typeof gm.scrapeGlobalMedia);
  } catch (e) { console.error('REQUIRE globalmedia FAIL:', e && e.stack || e); process.exit(4); }

  try {
    const r = await gm.scrapeGlobalMedia({ countries: [{ iso: 'PAK', cn: '巴基斯坦', dims: ['A','E','F','B'], prio: 1 }], max: 8 });
    console.log('PAK count=', r.count);
    r.items.slice(0, 5).forEach(it => console.log('  [' + (it.dims||[]).join('') + '] ' + it.source + ' | ' + (it.title || '').slice(0, 70)));
  } catch (e) { console.error('SCRAPE FAIL:', e && e.stack || e); process.exit(5); }
  process.exit(0);
})();
