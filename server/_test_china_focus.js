const gm = require('./globalmedia');
const scrapers = require('./scrapers');

(async () => {
  const sources = (gm.CHINA_FOCUS_SOURCES || []).slice(0, 3);
  console.log('sources count:', sources.length);
  const res = await gm.scrapeChinaFocus({ sources, concurrency: 4, timeout: 8000 });
  console.log('total items:', res.count);
  for (const it of (res.items || []).slice(0, 10)) {
    const txt = (it.title || '') + ' ' + (it.content || '');
    const gate = scrapers.chinaOverseasGate(txt);
    console.log('title:', it.title);
    console.log('  url:', it.url, 'focusGate:', gm.chinaFocusGate(txt, gate), 'gate:', gate.pass, gate.reason);
  }
})();
