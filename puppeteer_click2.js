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
    const items = await pg.evaluate(() => Array.from(document.querySelectorAll('.alert-q-item')).map((x, i) => ({ i, text: x.textContent.slice(0, 80), onclick: x.getAttribute('onclick') })));
    console.log('queue items', JSON.stringify(items.slice(0, 30), null, 2));
    // 尝试点击包含“中国”“直飞”“税收”“垃圾”“市长”“外长会晤”等关键词的条目
    const targets = ['直飞', '税收', '垃圾', '市长', '外长', '健康的中国', '国航', '布里斯班'];
    for (const kw of targets) {
      const found = await pg.evaluate((kw) => {
        const items = Array.from(document.querySelectorAll('.alert-q-item'));
        const item = items.find(x => x.textContent.includes(kw));
        if (item) { item.click(); return { text: item.textContent.slice(0, 80), onclick: item.getAttribute('onclick') }; }
        return null;
      }, kw);
      await new Promise(r => setTimeout(r, 500));
      const detail = await pg.evaluate(() => {
        const el = document.getElementById('alert-cmd-detail');
        return el ? el.textContent.slice(0, 120) : null;
      });
      console.log('kw', kw, 'found', JSON.stringify(found), 'detail', detail);
    }
    await pg.screenshot({ path: 'screenshot_command_click2.png', fullPage: false });
    console.log('screenshot ok');
    await b.close();
  } catch (e) { console.error(e); process.exit(1); }
})();
