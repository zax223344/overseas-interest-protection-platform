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
    await sleep(6000);
    /* 进联合作业台 */
    await page.click('.sb-item[data-view="workbench"]');
    await sleep(5000);
    const info = await page.evaluate(() => {
      const W = window.WORKBENCH;
      const jc = document.getElementById('wb-judgecard');
      const wc = document.getElementById('wb-watchcard');
      const tc = document.getElementById('wb-threatcard');
      return {
        hasWB: !!W,
        panels: W ? W._panels : null,
        hours: W ? W._hours : null,
        ix: W && W._ix ? { level: W._ix.level, score: Math.round(W._ix.score || 0), n: W._ix.n } : null,
        trend: W && W._trend ? { dPct: W._trend.dPct, cur: W._trend.curScore != null ? Math.round(W._trend.curScore) : null } : null,
        anomN: W && W._anomList ? W._anomList.length : -1,
        anomSample: W && W._anomList ? W._anomList.slice(0, 3).map(a => a.country + '(' + (a.ratio != null ? a.ratio.toFixed(1) : '?') + 'x)') : [],
        watchN: W && W._watch ? W._watch.length : -1,
        watchSample: W && W._watch ? W._watch.slice(0, 3).map(w => w.country + ':' + Math.round(w.score) + '(' + (w.reason || '').slice(0, 18) + ')') : [],
        threatN: W && W._threat ? W._threat.length : -1,
        threatSample: W && W._threat ? W._threat.slice(0, 3).map(t => (t.project || t.name || '?').slice(0, 16) + '@' + t.country + ':' + Math.round(t.score)) : [],
        judgeCard: !!jc, judgeLen: jc ? jc.innerText.length : 0,
        judgeHead: jc ? jc.innerText.replace(/\n/g, ' ').slice(0, 120) : '',
        watchCard: !!wc, watchRows: document.querySelectorAll('.wb-watch[data-wc]').length,
        threatCard: !!tc, threatRows: document.querySelectorAll('.wb-threat[data-wc]').length,
        anomChips: document.querySelectorAll('.wb-anom[data-anom]').length
      };
    });
    console.log('INFO:', JSON.stringify(info, null, 1));
    await page.screenshot({ path: '_audit/wb_v4_full.png', fullPage: false });
    /* 点击联动测试：第一个异动 chip 或盯防行 → 地图中心变化 */
    const before = await page.evaluate(() => WORKBENCH._map ? WORKBENCH._map.getCenter() : null);
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('.wb-anom[data-anom]') || document.querySelector('.wb-watch[data-wc]');
      if (el) { el.click(); return el.className + ':' + (el.getAttribute('data-anom') || el.getAttribute('data-wc')); }
      return null;
    });
    await sleep(2200);
    const after = await page.evaluate(() => WORKBENCH._map ? WORKBENCH._map.getCenter() : null);
    console.log('FLYTO:', JSON.stringify({ clicked, before: before ? [Math.round(before.lat), Math.round(before.lng)] : null, after: after ? [Math.round(after.lat), Math.round(after.lng)] : null }));
    await page.screenshot({ path: '_audit/wb_v4_flyto.png', fullPage: false });
    /* 面板开关测试：关 judge → 卡片消失 */
    const toggleGone = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, .wb-tbtn, [onclick*="judge"]')).find(b => /研判/.test(b.innerText || ''));
      if (!btn) return 'no-btn';
      btn.click();
      return document.getElementById('wb-judgecard') ? 'still-there' : 'gone';
    });
    console.log('TOGGLE:', toggleGone);
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
