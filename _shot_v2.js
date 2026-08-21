/* 自动预警 v2 深色指挥大屏 渲染复核 */
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
    /* 等数据同步 */
    await sleep(20000);
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(2500);
    await page.evaluate(() => { if (typeof AUTOALERT !== 'undefined') AUTOALERT.run(true); });
    await sleep(4000);
    const info = await page.evaluate(() => {
      const q = s => !!document.querySelector(s);
      const markers = document.querySelectorAll('#aa-warmap .leaflet-interactive').length;
      const tiles = document.querySelectorAll('#aa-warmap path').length;
      return {
        map: q('#aa-warmap .leaflet-container'),
        mapMarkers: markers,
        mapPaths: tiles,
        filterBar: q('.aa-filter-chip'),
        queueTabs: (document.body.innerText.match(/📡侦测|🧠预警|🚀处置|✅闭环/g) || []).length,
        glowCards: document.querySelectorAll('.aa-glow-card').length,
        kpiNums: document.querySelectorAll('.aa-kpi-num').length,
        ticker: (document.body.innerText || '').includes('实时情报流'),
        notifyBtn: (document.body.innerText || '').includes('🔔'),
        raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
        alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length
      };
    });
    console.log('INFO:', JSON.stringify(info, null, 1));
    await page.screenshot({ path: '_audit/aa_v2_bigscreen.png', fullPage: false });
    /* 测筛选交互：点一个走廊 */
    await page.evaluate(() => { AUTOALERT.setFilter('corridor', '阿富汗'); });
    await sleep(1200);
    const fInfo = await page.evaluate(() => ({ corridor: AUTOALERT._filters.corridor, chip: (document.body.innerText || '').includes('清除') }));
    console.log('筛选交互:', JSON.stringify(fInfo));
    await page.screenshot({ path: '_audit/aa_v2_filtered.png', fullPage: false });
    await page.evaluate(() => { AUTOALERT.resetFilters(); });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) {
    console.log('FATAL:', e.message);
    await page.screenshot({ path: '_audit/aa_v2_err.png' }).catch(() => {});
  }
  await browser.close();
})();
