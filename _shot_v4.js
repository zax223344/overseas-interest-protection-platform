/* 自动预警 v4（系统地图复用 + 实时刷新 + 新配色）渲染复核 */
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
    await sleep(12000); // 让自动采集/扫描跑一会，产生实时预警
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(5000); // 等地图挂载 + 叠加层 + 实时定时器
    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('view-autoalert'));
      const mapEl = document.getElementById('aa-leaflet');
      let layerPts = 0;
      try { layerPts = AUTOALERT._aaLayer ? AUTOALERT._aaLayer.getLayers().length : 0; } catch (e) {}
      return {
        mapMounted: !!mapEl,
        leafleTtiles: mapEl ? mapEl.querySelectorAll('img').length : 0,
        overlayPoints: layerPts,
        liveTimer: !!AUTOALERT._liveTimer,
        automationFeed: (document.body.innerText || '').includes('自动化实况'),
        ticker: (document.body.innerText || '').includes('实时情报流'),
        filterChips: document.querySelectorAll('.aa-filter-chip').length,
        cyanVar: cs.getPropertyValue('--cyan').trim(),
        raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
        alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length,
        workflows: Object.keys(AUTOALERT._workflows).length,
        mapCap: !!document.querySelector('.aa-map-cap')
      };
    });
    console.log('INFO:', JSON.stringify(info));
    await page.screenshot({ path: '_audit/aa_v4_map.png', fullPage: false });
    // 第二张：中栏地图放大局部（确认落点）
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
