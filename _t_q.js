/* 终验：预警队列可见量 + 实时流 + 共享库 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const u = document.querySelector('input[type=text], #username');
    const p = document.querySelector('input[type=password]');
    if (u) u.value = 'admin';
    if (p) p.value = 'admin123';
    const b = [...document.querySelectorAll('button')].find(x => /登\s*录/.test(x.textContent) && !/紧急/.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(22000);
  await page.evaluate(() => navigateTo('alerts'));
  await page.waitForTimeout(2500);
  const q = await page.evaluate(() => ({
    alertsTotal: ALERTS.length,
    visibleRows: document.querySelectorAll('#alert-cmd-queue .alert-q-item').length,
    foldNotes: document.querySelectorAll('#alert-cmd-queue .alert-q-item').length > 0 ? (document.getElementById('alert-cmd-queue').innerText.match(/同质化折叠/g) || []).length : 0
  }));
  console.log('QUEUE:', JSON.stringify(q));
  /* 实时情报流 */
  await page.evaluate(() => navigateTo('situation'));
  await page.waitForTimeout(3000);
  const feed = await page.evaluate(() => {
    const el = document.getElementById('globe-intel-live');
    const items = el ? el.querySelectorAll('.live-title, [class*="live-title"]').length : 0;
    return { feedItems: items };
  });
  console.log('FEED:', JSON.stringify(feed));
  console.log('JS ERR:', errs.slice(0, 3));
  await page.screenshot({ path: '_audit/queue_full.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
