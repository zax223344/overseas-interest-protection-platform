/* 任务 #517 实测：关键词作战全网实时直出——fresh 优先渲染 + 🌐 徽标 + KPI */
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
    await page.click('.sb-item[data-view="threatroom"]');
    await sleep(5000);

    /* ① 发起「中资#抢劫」关键词作战 */
    await page.fill('#tr-q', '中资#抢劫');
    await page.click('#tr-go, .tr-go, button[onclick*="THREATROOM.run"]');
    console.log('作战已发起，等待采集+报告（最长 10 分钟）…');

    /* ② 等报告出现（进度条消失 + 报告卡渲染） */
    const t0 = Date.now();
    let repReady = false;
    while (Date.now() - t0 < 600000) {
      await sleep(15000);
      const st = await page.evaluate(() => {
        const stage = document.getElementById('tr-stage');
        const rep = document.getElementById('tr-rep');
        return {
          stageVisible: stage && stage.style.display !== 'none',
          repVisible: rep && rep.style.display !== 'none' && rep.innerHTML.length > 500
        };
      });
      if (st.repVisible) { repReady = true; break; }
      if (!st.stageVisible) { await sleep(5000); }
      const st2 = await page.evaluate(() => {
        const rep = document.getElementById('tr-rep');
        return rep && rep.style.display !== 'none' && rep.innerHTML.length > 500;
      });
      if (st2) { repReady = true; break; }
    }
    console.log('REPORT_READY:', repReady, ((Date.now() - t0) / 1000).toFixed(0) + 's');

    /* ③ 头卡 KPI：本轮全网命中 */
    const kpi = await page.evaluate(() => {
      const rep = document.getElementById('tr-rep');
      const txt = rep ? rep.innerText : '';
      const m = txt.match(/本轮全网命中\s*\n\s*(\d+)\s*条/);
      return { hasKpi: !!m, webN: m ? m[1] : null, head: (txt.match(/全网实时命中\s*(\d+)\s*条\s*\+\s*库内联动补充\s*(\d+)\s*条/) || []).slice(1) };
    });
    console.log('KPI_WEB:', JSON.stringify(kpi));

    /* ④ 情报流：🌐 徽标条数 + 首屏顺序（fresh 应在前） */
    const feed = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('#tr-feed .tr-item'));
      const web = badges.filter(el => el.textContent.indexOf('本次全网') >= 0);
      return {
        total: badges.length,
        webN: web.length,
        firstThree: badges.slice(0, 3).map(el => (el.querySelector('.t') || {}).textContent.slice(0, 60)),
        firstThreeWeb: badges.slice(0, 3).map(el => el.textContent.indexOf('本次全网') >= 0),
        feedTitle: (document.querySelector('#tr-rep .card-tt span:last-child') || {}).textContent || ''
      };
    });
    console.log('FEED:', JSON.stringify(feed));

    /* ⑤ 详情弹窗可开（fresh 条目点击） */
    const canClick = await page.evaluate(() => document.querySelectorAll('#tr-feed .tr-item').length > 0);
    if (canClick) {
      await page.click('#tr-feed .tr-item');
      await sleep(1200);
      const modal = await page.evaluate(() => !!document.getElementById('tr-modal'));
      console.log('DETAIL_MODAL:', modal);
      await page.screenshot({ path: '_audit/fix517_2_detail.png' });
      await page.keyboard.press('Escape');
      await page.evaluate(() => THREATROOM._closeDetail && THREATROOM._closeDetail());
    }

    await page.screenshot({ path: '_audit/fix517_1_report.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  } catch (e) {
    console.log('FATAL:', e.message);
    await page.screenshot({ path: '_audit/fix517_fatal.png' }).catch(() => {});
    console.log('ERRORS:', errors.slice(0, 8));
  } finally { await browser.close(); }
})();
