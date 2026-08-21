const crawler = require('./crawler');

(async () => {
  const q = '(China OR Chinese) (sanction OR ban)';
  console.log('query:', q);
  const arts = await crawler.gdeltSearch(q, { timespan: '2d', maxrecords: 10 });
  console.log('got', arts.length);
  for (const a of arts.slice(0, 5)) {
    console.log(a.title, '|', a.domain);
  }
})();
