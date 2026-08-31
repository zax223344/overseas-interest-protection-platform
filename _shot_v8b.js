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
    await page.click('.sb-item[data-view="workbench"]');
    await sleep(5000);
    /* 1) 24h 三卡真实渲染文本 */
    const t24 = await page.evaluate(() => ({
      judge: (document.getElementById('wb-judgecard') || {}).innerText || '',
      watch: (document.getElementById('wb-watchcard') || {}).innerText || '',
      threat: (document.getElementById('wb-threatcard') || {}).innerText || ''
    }));
    console.log('=== 24h 盯防卡 ===\n' + t24.watch.split('\n').slice(0, 18).join('\n'));
    console.log('=== 24h 威胁项目卡 ===\n' + t24.threat.split('\n').slice(0, 18).join('\n'));
    console.log('=== 24h 研判(截断) ===\n' + t24.judge.replace(/\n/g, ' ').slice(0, 300));
    /* 2) 切 168h 时间窗 → 全量重算 */
    const sw = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.wb-pbtn,[onclick*="_setHours"],.dc-tab,button')).find(b => /7\s*天|168/.test(b.innerText || ''));
      if (el) { el.click(); return el.innerText.trim(); }
      return null;
    });
    await sleep(2500);
    const t168 = await page.evaluate(() => {
      const W = window.WORKBENCH;
      return {
        hours: W._hours,
        anomN: (W._anomList || []).length,
        anom: (W._anomList || []).map(a => a.country + ' ' + a.ratio + 'x'),
        watch: (document.getElementById('wb-watchcard') || {}).innerText.split('\n').slice(0, 12).join(' | '),
        judgeHasAnom: ((document.getElementById('wb-judgecard') || {}).innerText || '').includes('异动')
      };
    });
    console.log('SWITCH168:', JSON.stringify(sw), '=> ', JSON.stringify(t168, null, 1));
    await page.screenshot({ path: '_audit/wb_v4_168h.png', fullPage: false });
    /* 3) 面板开关：关 judge → 卡片应消失 */
    const tog = await page.evaluate(() => {
      const btn = document.querySelector('.wb-pbtn[data-p="judge"]');
      if (!btn) return 'no-btn';
      btn.click();
      return document.getElementById('wb-judgecard') ? 'FAIL-still-there' : 'OK-gone';
    });
    await sleep(600);
    const tog2 = await page.evaluate(() => {
      const btn = document.querySelector('.wb-pbtn[data-p="judge"]');
      if (!btn) return 'no-btn';
      btn.click();
      return document.getElementById('wb-judgecard') ? 'OK-restored' : 'FAIL-not-restored';
    });
    console.log('TOGGLE:', tog, '/', tog2);
    /* 4) 切回 24h 恢复默认 */
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.wb-pbtn,.dc-tab,button')).find(x => /24\s*小时|24h/.test(x.innerText || '')); if (b) b.click(); });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
