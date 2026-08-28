const { chromium } = require('C:\\Users\\28737\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);
  // Create trial user via API
  await page.evaluate(async () => {
    try {
      const r = await fetch('/api/auth/trial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester_' + Date.now(), password: 'test1234', days: 1 }) });
      const j = await r.json();
      localStorage.setItem('orps_api_token', j.token);
      return j.token;
    } catch (e) { return ''; }
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);
  // Navigate and switch to list view with 500/page
  await page.evaluate(() => {
    if (typeof navigateTo === 'function') navigateTo('alerts');
    if (typeof AVIEW !== 'undefined') {
      AVIEW.qView = 'list';
      AVIEW.qPageSize = 500;
      AVIEW.qPage = 1;
    }
  });
  await page.waitForTimeout(8000);
  await page.evaluate(() => { if (typeof AVIEW !== 'undefined') AVIEW.renderQueue(); });
  await page.waitForTimeout(3000);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('Congo in body:', bodyText.includes('刚果'));
  const idx = bodyText.indexOf('刚果（金）上加丹加省发生严重治安事件');
  console.log('Congo kidnapping found:', idx >= 0);
  if (idx >= 0) console.log('Context:', bodyText.slice(Math.max(0, idx - 40), idx + 100));
  const idx2 = bodyText.indexOf('中国公民被武装人员带走');
  console.log('Chinese abducted found:', idx2 >= 0);
  await page.screenshot({ path: 'server/logs/alerts_verify2.png', fullPage: true });
  await browser.close();
})();
