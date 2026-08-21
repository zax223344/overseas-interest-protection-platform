/* 诊断：数据中心视图内容与报错 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
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
  await page.waitForTimeout(16000);
  await page.evaluate(() => navigateTo('datacenter'));
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const stats = (document.getElementById('dc-stats') || {}).innerText || '';
    const rows = document.querySelectorAll('#dc-tbody tr').length;
    const tabs = [...document.querySelectorAll('#dc-tabs .dc-tab')].map(t => t.innerText.trim()).slice(0, 6);
    let dbErr = '';
    try { const c = DBCenter.getAll('osint_intel'); dbErr = 'osint rows: ' + c.length; } catch (e) { dbErr = 'ERR: ' + e.message; }
    return { stats: stats.replace(/\s+/g, ' ').slice(0, 150), rows, tabs, dbErr };
  });
  console.log('DC:', JSON.stringify(r, null, 1));
  console.log('JS ERR:', errs.slice(0, 6));
  await page.screenshot({ path: '_audit/datacenter_diag.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
