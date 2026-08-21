/* 数据流全链路验证：服务端同步 → DBCenter → 回填 → 预警中心/自动预警 */
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => { const t = m.text(); if (t.includes('[SYNC]') || t.includes('[BACKFILL]') || t.includes('[INGEST-GATE] 超过')) console.log('LOG:', t.slice(0, 130)); if (m.type() === 'error') errors.push('CONSOLE: ' + t.slice(0, 120)); });
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2500);
    if (await page.$('#li-user')) {
      await page.fill('#li-user', 'admin');
      await page.fill('#li-pass', 'admin123');
      await page.click('button[onclick*="AUTH.login"]');
      await sleep(3000);
    }
    console.log('--- 等待同步+回填（45s）---');
    await sleep(45000);
    const info = await page.evaluate(() => {
      const stores = ['terror_events', 'security_events', 'military_conflicts', 'geopolitical_intel'];
      const db = {};
      stores.forEach(s => { try { db[s] = (DBCenter.getAll(s) || []).length; } catch (e) { db[s] = 'ERR'; } });
      const cut = Date.now() - 24 * 3600 * 1000;
      let fresh = 0;
      (typeof ALERTS !== 'undefined' ? ALERTS : []).forEach(a => {
        let t = 0; try { t = new Date(String(a.time || '').replace(' ', 'T')).getTime(); } catch (e) {}
        if (t >= cut) fresh++;
      });
      const aa = (typeof AUTOALERT !== 'undefined') ? {
        raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
        alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length,
        soar: Object.keys(AUTOALERT._workflows).length
      } : {};
      return { dbCenter: db, alertsTotal: (typeof ALERTS !== 'undefined' ? ALERTS.length : -1), alertsFresh24h: fresh, autoalert: aa };
    });
    console.log('INFO:', JSON.stringify(info, null, 1));
    /* 预警中心截图 */
    await page.click('.sb-item[data-view="alerts"]');
    await sleep(3500);
    const alertBadge = await page.evaluate(() => { const b = document.querySelector('#sb-alert-count'); return b ? b.textContent : 'n/a'; });
    console.log('预警中心 badge:', alertBadge);
    await page.screenshot({ path: '_audit/flow_alert_center.png', fullPage: false });
    /* 自动预警截图 */
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(3000);
    await page.evaluate(() => { if (typeof AUTOALERT !== 'undefined') AUTOALERT.run(true); });
    await sleep(3000);
    const aa2 = await page.evaluate(() => ({
      raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
      alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length,
      ticker: (document.body.innerText || '').includes('实时情报流')
    }));
    console.log('自动预警(扫描后):', JSON.stringify(aa2));
    await page.screenshot({ path: '_audit/flow_autoalert.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
