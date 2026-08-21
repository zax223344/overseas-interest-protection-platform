const gm = require('./globalmedia');
const scrapers = require('./scrapers');

(async () => {
  const sources = gm.CHINA_FOCUS_SOURCES.slice();
  console.log('sources count:', sources.length);
  const res = await gm.scrapeChinaFocus({ sources, concurrency: 8, timeout: 8000 });
  console.log('total items:', res.count);
  for (const it of (res.items || []).slice(0, 15)) {
    const txt = (it.title || '') + ' ' + (it.content || '');
    const gate = scrapers.chinaOverseasGate(txt);
    console.log('title:', it.title);
    console.log('  focusGate:', gm.chinaFocusGate(txt, gate), 'gate:', gate.pass, gate.reason);
  }
})();
