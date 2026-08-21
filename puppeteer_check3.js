const p = require('puppeteer');
(async () => {
  try {
    const b = await p.launch({ headless: 'new' });
    const pg = await b.newPage();
    await pg.setViewport({ width: 1600, height: 900 });
    await pg.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
    await pg.click('#li-pass');
    await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => !document.getElementById('auth-overlay') || document.getElementById('auth-overlay').style.display === 'none', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await pg.evaluate(() => { const el = document.querySelector('.sb-item[data-view="alerts"]'); if (el) el.click(); });
    await new Promise(r => setTimeout(r, 2000));
    await pg.evaluate(() => { const tabs = Array.from(document.querySelectorAll('#alert-tabs .dc-tab')); const t = tabs.find(x => x.textContent.includes('预警指挥台')); if (t) t.click(); });
    await new Promise(r => setTimeout(r, 3000));
    const info = await pg.evaluate(() => {
      const queueItems = Array.from(document.querySelectorAll('.alert-q-item')).map(x => ({ onclick: x.getAttribute('onclick'), text: x.textContent.slice(0, 80) }));
      const ids = new Set((typeof ALERTS !== 'undefined') ? ALERTS.map(x => String(x.id)) : []);
      const missing = queueItems.filter(x => !ids.has(x.onclick.match(/'(.*?)'/)[1]));
      const found = queueItems.filter(x => ids.has(x.onclick.match(/'(.*?)'/)[1]));
      return { totalQueue: queueItems.length, missing: missing.length, missingIds: missing.map(x => x.onclick.match(/'(.*?)'/)[1]).slice(0, 10), sampleMissing: missing.slice(0, 3), sampleFound: found.slice(0, 3) };
    });
    console.log(JSON.stringify(info, null, 2));
    await b.close();
  } catch (e) { console.error(e); process.exit(1); }
})();
