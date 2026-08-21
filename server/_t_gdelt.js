process.on('unhandledRejection', e => { console.error('UNHANDLED:', e && e.stack || e); process.exit(2); });
(async () => {
  const crawler = require('./crawler');
  console.log('calling gdeltSearch...');
  try {
    const r = await crawler.gdeltSearch('sourcecountry:PAK', { timespan: '7d', maxrecords: 8 });
    console.log('gdeltSearch returned, len=', (r || []).length);
    (r || []).slice(0, 3).forEach(a => console.log('  ', a.sourcecountry, a.domain, (a.title || '').slice(0, 60)));
  } catch (e) { console.error('GDELT THREW:', e && e.stack || e); process.exit(5); }
  console.log('done');
  process.exit(0);
})();
