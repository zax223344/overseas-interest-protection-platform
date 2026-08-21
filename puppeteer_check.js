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
    const ids = ['1786256501324', '1786256497923', '1786256470561-20-230', '1786256407063-47-730'];
    for (const id of ids) {
      const info = await pg.evaluate((id) => {
        const found = (typeof ALERTS !== 'undefined') ? ALERTS.find(x => String(x.id) === String(id)) : null;
        const foundStrict = (typeof ALERTS !== 'undefined') ? ALERTS.find(x => x.id === id) : null;
        return { id, found: !!found, foundStrict: !!foundStrict, type: found ? typeof found.id : null, idsample: found ? String(found.id) : null, title: found ? (found.title || '').slice(0, 40) : null };
      }, id);
      console.log(JSON.stringify(info));
    }
    await b.close();
  } catch (e) { console.error(e); process.exit(1); }
})();
