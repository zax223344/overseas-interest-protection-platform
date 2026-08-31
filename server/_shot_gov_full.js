/* 公文版完整长截图（高视口 + fullPage）—— 一次性呈现 红头/标题/图表/表格/研判/建议/署名/版记 */
const PW = require('C:/Users/28737/.workbuddy/binaries/node/versions/.22.22.2.deleting.17900.1788179718614/node_modules/playwright');
const OUT = 'C:/Users/28737/Desktop/新建文件夹/logs';
(async () => {
  const b = await PW.chromium.launch({ headless: true });
  /* 宽视口 + 高视口让纸面一页呈现 */
  const ctx = await b.newContext({ viewport: { width: 1560, height: 2400 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof AUTH !== 'undefined' && AUTH._ready, null, { timeout: 30000 });
  await p.fill('#li-user', 'admin'); await p.fill('#li-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForFunction(() => typeof AUTH !== 'undefined' && AUTH.user, null, { timeout: 20000 });
  await p.evaluate(() => { navigateTo('analysis'); switchAnalysisTab('daily'); });
  await p.waitForFunction(() => document.getElementById('dr-body') && document.getElementById('dr-body').innerText.indexOf('加载中') < 0, null, { timeout: 60000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => DAILY_REPORT.switchView('gov'));
  await p.waitForTimeout(1000);
  /* 移除 .dr-govwrap 的 overflow 使长内容直接铺开 */
  await p.evaluate(() => {
    const w = document.querySelector('#dr-body .dr-govwrap');
    if (w) w.style.overflow = 'visible';
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/_dailyreport_11_gov_full.png', fullPage: true });
  console.log('公文版全页截图完成');
  await b.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });