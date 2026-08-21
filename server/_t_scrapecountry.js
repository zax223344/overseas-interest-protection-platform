process.on('unhandledRejection', e => { console.error('UNHANDLED:', e && e.stack || e); process.exit(2); });
(async () => {
  const gm = require('./globalmedia');
  console.log('calling scrapeCountry(PAK)...');
  try {
    const arts = await gm.scrapeCountry('PAK', { max: 8 });
    console.log('scrapeCountry returned len=', (arts || []).length);
  } catch (e) { console.error('SCRAPECOUNTRY THREW:', e && e.stack || e); process.exit(5); }
  console.log('done scrapeCountry');
  process.exit(0);
})();
