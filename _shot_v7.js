const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 140)); });
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2500);
    if (await page.$('#li-user')) {
      await page.fill('#li-user', 'admin');
      await page.fill('#li-pass', 'admin123');
      await page.click('button[onclick*="AUTH.login"]');
      await sleep(3000);
    }
    await sleep(8000);
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(5000);
    const info = await page.evaluate(() => ({
      dimCells: document.querySelectorAll('.aa-dim-cell').length,
      sitCards: document.querySelectorAll('.aa-sit-card').length,
      hasMap: !!document.getElementById('aa-map-host'),
      cyanVar: getComputedStyle(document.getElementById('view-autoalert')).getPropertyValue('--cyan').trim(),
      raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
      alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length,
      workflows: Object.keys(AUTOALERT._workflows).length,
      dims: Array.from(document.querySelectorAll('.aa-dim-cell')).map(el => el.innerText.replace(/\n/g, ' ').slice(0, 22)),
      sample: AUTOALERT._alerts.slice(0, 2).map(a => ({ title: (a.title_zh || a.title || '').slice(0, 30), ruleId: a.ruleId, type: a.type, level: a.level }))
    }));
    console.log('INFO:', JSON.stringify(info));
    await page.screenshot({ path: '_audit/aa_v7_multi.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
