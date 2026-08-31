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
    await sleep(5000);
    /* 进专项情报作战室 */
    await page.click('.sb-item[data-view="threatroom"]');
    await sleep(2500);
    const shell = await page.evaluate(() => ({
      hasInput: !!document.getElementById('tr-q'),
      hasGo: !!document.getElementById('tr-go'),
      chips: document.querySelectorAll('.tr-chip').length,
      title: (document.getElementById('pageTitle') || {}).textContent || ''
    }));
    console.log('SHELL:', JSON.stringify(shell));
    await page.screenshot({ path: '_audit/tr_1_shell.png' });
    /* 输入吉尔吉斯斯坦 → 启动作战（走完整链路） */
    await page.fill('#tr-q', '吉尔吉斯斯坦');
    await page.click('#tr-go');
    await sleep(3000);
    const stage1 = await page.evaluate(() => (document.getElementById('tr-stage') || {}).innerText || '');
    console.log('STAGE1:', stage1.slice(0, 120));
    /* 轮询等待报告出现（最长 7 分钟：GDELT+翻译） */
    let done = false;
    for (let i = 0; i < 42; i++) {
      await sleep(10000);
      const st = await page.evaluate(() => ({
        rep: (document.getElementById('tr-rep') || {}).style.display === 'block',
        stage: (document.getElementById('tr-stage') || {}).innerText || ''
      }));
      if (st.rep) { done = true; break; }
      if (i % 6 === 5) console.log('WAIT ' + ((i + 1) * 10) + 's: ' + st.stage.slice(0, 80));
    }
    console.log('DONE:', done);
    if (done) {
      const info = await page.evaluate(() => {
        const rep = document.getElementById('tr-rep');
        const txt = rep ? rep.innerText : '';
        return {
          grade: (txt.match(/综合威胁等级\s*\n\s*(\S+ ?· ?Ⅰ+级|平稳 · 无预警)/) || [])[1] || '',
          kpiN: (txt.match(/关联数据\s*\n\s*(\d+) 条/) || [])[1] || '',
          judge: (txt.match(/值班研判：([\s\S]{0,180})/) || [])[1] || '',
          hasMap: !!document.querySelector('#tr-map .leaflet-container') || !!document.getElementById('tr-map'),
          items: document.querySelectorAll('.tr-item').length,
          projs: document.querySelectorAll('.tr-proj').length,
          marks: document.querySelectorAll('.tr-mark').length
        };
      });
      console.log('REPORT:', JSON.stringify(info, null, 1));
      await page.screenshot({ path: '_audit/tr_2_report.png', fullPage: false });
      /* 滚到情报流看卡片 */
      await page.evaluate(() => { var f = document.getElementById('tr-feed'); if (f) f.scrollTop = 200; });
      await sleep(800);
      await page.screenshot({ path: '_audit/tr_3_feed.png' });
      /* 点第一张卡片看详情弹窗 */
      const modal = await page.evaluate(() => {
        const el = document.querySelector('.tr-item[data-i]');
        if (!el) return 'no-item';
        el.click();
        return !!document.getElementById('tr-modal');
      });
      await sleep(1000);
      console.log('MODAL:', modal);
      await page.screenshot({ path: '_audit/tr_4_modal.png' });
    }
    console.log('ERRORS:', errors.length ? errors.slice(0, 8).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
