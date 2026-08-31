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
    await sleep(4000);
    await page.click('.sb-item[data-view="alerts"]');
    await sleep(4000);
    try { await page.click('text=智能联动预警', { timeout: 8000 }); } catch (e) { console.log('TAB_CLICK_FALLBACK:', e.message.slice(0, 80)); }
    await sleep(8000);
    const aa = await page.evaluate(() => {
      const txt = (document.getElementById('view-autoalert') || {}).innerText || '';
      const linkHits = (txt.match(/我在该国有 (\d+) 项登记利益/g) || []);
      const noProj = (txt.match(/该国虽无登记的我方项目/g) || []).length;
      const corr = (txt.match(/走廊沿线共关联我方利益 (\d+) 项/g) || []);
      /* 抓巴基斯坦情景卡关联段 */
      const pkSeg = (txt.split('\n').some(l => l.includes('巴基斯坦'))) ? 'pk-mentioned' : 'pk-absent';
      return {
        linkCount: linkHits.length,
        linkSample: linkHits.slice(0, 6),
        noProjCount: noProj,
        corridorCounts: corr.slice(0, 6),
        pk: pkSeg,
        pkHasProjects: /巴基斯坦[\s\S]{0,800}?我在该国有 \d+ 项登记利益/.test(txt),
        pkProjects: (txt.match(/巴基斯坦[\s\S]{0,800}?(我在该国有 \d+ 项登记利益[：:][^\n]{0,120})/) || [])[1] || '',
        viewLen: txt.length
      };
    });
    console.log('AUTOALERT:', JSON.stringify(aa, null, 1));
    await page.screenshot({ path: '_audit/fix513_1_autoalert.png' });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6) : 'none');
  } catch (e) {
    console.log('FATAL:', e.message);
    await page.screenshot({ path: '_audit/fix513_fatal2.png' }).catch(() => {});
    console.log('ERRORS:', errors.slice(0, 6));
  } finally { await browser.close(); }
})();
