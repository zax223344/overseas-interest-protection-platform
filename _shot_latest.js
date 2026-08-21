const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    await page.fill('#li-user', 'admin'); await page.fill('#li-pass', 'admin123');
    await page.click('button[onclick="AUTH.login()"]');
    await sleep(5000);
    await page.click('.sb-item[data-view="situation"]'); await sleep(5000);
    const info = await page.evaluate(() => {
      const el = document.querySelector('#sit-alerts');
      const txt = el ? el.innerText.replace(/\s+/g, ' ') : '(no #sit-alerts)';
      return {
        hasCnToggle: txt.indexOf('涉华优先') >= 0,
        hasLevelFilter: txt.indexOf('🔴红') >= 0,
        hasValueScore: txt.indexOf('◆') >= 0,
        hasCorrTag: txt.indexOf('高危走廊') >= 0,
        first600: txt.slice(0, 600)
      };
    });
    console.log('VERIFY:', JSON.stringify(info, null, 1));
    await page.screenshot({ path: '_audit/latest_alerts_redesign.png' });
    console.log('screenshot saved: _audit/latest_alerts_redesign.png');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
