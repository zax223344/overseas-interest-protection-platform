/* 实测：应急指南区块滚动 + 红色预警详情赋分面板 */
const { chromium } = require('C:\\Users\\28737\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(async () => {
    try {
      const r = await fetch('/api/auth/trial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester_' + Date.now(), password: 'test1234', days: 1 }) });
      const j = await r.json();
      localStorage.setItem('orps_api_token', j.token);
    } catch (e) {}
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { if (typeof navigateTo === 'function') navigateTo('monitor'); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { if (typeof MONITOR !== 'undefined') { MONITOR.tab = 'map'; MONITOR.render && MONITOR.render(document.getElementById('view-monitor')); } });
  await page.waitForTimeout(5000);
  /* 应急指南切到巴基斯坦，并滚动内部容器 */
  await page.evaluate(() => {
    if (typeof MONITOR !== 'undefined') MONITOR.renderEmergencyGuide('巴基斯坦');
    const el = document.getElementById('mon-emg-guide');
    if (!el) return;
    let node = el;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 50) { node.scrollTop = el.offsetTop - 60; break; }
      node = node.parentElement;
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'server/logs/_riskmap_4_guide2.png' });
  /* 红色预警详情赋分面板 */
  await page.evaluate(() => {
    const red = (typeof ALERTS !== 'undefined' ? ALERTS : []).find(a => a.risk_zone === 'red');
    if (red) showAlertDetail(red.id);
    window._redFound = red ? red.title : null;
  });
  const redTitle = await page.evaluate(() => window._redFound);
  console.log('RED ALERT:', redTitle);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'server/logs/_riskmap_5_alertdetail.png' });
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
