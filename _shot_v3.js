/* 自动预警 v3（自动化实况，无地图）渲染复核 */
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
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
    await sleep(15000);
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(3000);
    const info = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        noMap: !document.querySelector('#aa-warmap'),
        automationFeed: txt.includes('自动化实况'),
        ticker: txt.includes('实时情报流'),
        filterBar: !!document.querySelector('.aa-filter-chip'),
        queueTabs: (txt.match(/📡侦测|🧠预警|🚀处置|✅闭环/g) || []).length,
        raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
        alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length,
        workflows: Object.keys(AUTOALERT._workflows).length
      };
    });
    console.log('INFO:', JSON.stringify(info));
    await page.screenshot({ path: '_audit/aa_v3_automation.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
