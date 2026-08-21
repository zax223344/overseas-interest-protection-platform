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
    const found = await pg.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.alert-q-item'));
      const item = items.find(x => x.textContent.includes('华裔市长'));
      if (item) { item.click(); return { text: item.textContent.slice(0, 80), onclick: item.getAttribute('onclick') }; }
      return null;
    });
    await new Promise(r => setTimeout(r, 800));
    const detail = await pg.evaluate(() => {
      const el = document.getElementById('alert-cmd-detail');
      return el ? el.textContent.slice(0, 200) : null;
    });
    console.log('found', JSON.stringify(found));
    console.log('detail', detail);
    await pg.screenshot({ path: 'screenshot_mayor.png', fullPage: false });
    await b.close();
  } catch (e) { console.error(e); process.exit(1); }
})();
