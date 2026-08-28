/* 浏览器实测：风险监测 → 项目风险地图 + 应急指南 + 项目详情弹窗 */
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
  /* 进入风险监测视图（monitor），切到地图 tab */
  await page.evaluate(() => {
    if (typeof navigateTo === 'function') navigateTo('monitor');
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    if (typeof MONITOR !== 'undefined') { MONITOR.tab = 'map'; MONITOR.render && MONITOR.render(document.getElementById('view-monitor')); }
  });
  await page.waitForTimeout(5000);
  const diag = await page.evaluate(() => {
    const out = {};
    out.hasEmergencyGuide = typeof EMERGENCY_GUIDE !== 'undefined';
    out.projectCount = (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) ? ENTITY.PROJECTS.length : 0;
    out.geoCount = (typeof EMERGENCY_GUIDE !== 'undefined') ? Object.keys(EMERGENCY_GUIDE.PROJECT_GEO).length : 0;
    out.guideCountries = (typeof EMERGENCY_GUIDE !== 'undefined') ? EMERGENCY_GUIDE.countries().length : 0;
    out.mapExists = !!document.getElementById('mon-map-svg');
    out.guideEl = !!document.getElementById('mon-emg-guide');
    out.guideText = (document.getElementById('mon-emg-guide') || {}).innerText ? document.getElementById('mon-emg-guide').innerText.slice(0, 200) : 'EMPTY';
    /* 项目风险抽样 */
    if (typeof MONITOR !== 'undefined' && typeof ENTITY !== 'undefined') {
      const p = ENTITY.PROJECTS.find(x => x.id === 'GWADAR');
      const pr = MONITOR._projectRiskOf(p);
      out.gwadar = { score: pr.score, zone: pr.zone, direct: pr.direct.length };
    }
    return out;
  });
  console.log(JSON.stringify(diag, null, 1));
  await page.screenshot({ path: 'server/logs/_riskmap_1.png', fullPage: false });
  /* 滚到应急指南 */
  await page.evaluate(() => { const el = document.getElementById('mon-emg-guide'); if (el) el.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'server/logs/_riskmap_2_guide.png', fullPage: false });
  /* 打开项目详情弹窗（瓜达尔港） */
  await page.evaluate(() => { if (typeof MONITOR !== 'undefined') MONITOR.showProjectRisk('GWADAR'); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'server/logs/_riskmap_3_modal.png', fullPage: false });
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
