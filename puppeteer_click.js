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
    const first = await pg.evaluate(() => {
      const item = document.querySelector('.alert-q-item');
      if (item) { item.click(); return { text: item.textContent.slice(0, 80), id: item.getAttribute('onclick') }; }
      return null;
    });
    await new Promise(r => setTimeout(r, 1000));
    const detail = await pg.evaluate(() => {
      const el = document.getElementById('alert-cmd-detail');
      return el ? { html: el.innerHTML.slice(0, 300), text: el.textContent.slice(0, 200) } : null;
    });
    console.log('clicked', JSON.stringify(first));
    console.log('detail', JSON.stringify(detail));
    await pg.screenshot({ path: 'screenshot_command_click.png', fullPage: false });
    console.log('screenshot ok');
    await b.close();
  } catch (e) { console.error(e); process.exit(1); }
})();
