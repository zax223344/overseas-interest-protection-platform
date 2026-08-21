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
      const queueOnclicks = Array.from(document.querySelectorAll('.alert-q-item')).map(x => x.getAttribute('onclick'));
      const alertIds = (typeof ALERTS !== 'undefined') ? ALERTS.slice(0, 30).map(x => ({ id: String(x.id), title: (x.title || '').slice(0, 40) })) : [];
      return { queueOnclicks: queueOnclicks.slice(0, 10), alertIds };
    });
    console.log(JSON.stringify(info, null, 2));
    await b.close();
  } catch (e) { console.error(e); process.exit(1); }
})();
