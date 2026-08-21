/* 自动预警作战台（推倒重设版）渲染复核 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 140)); });
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);
    if (await page.$('#li-user')) {
      await page.fill('#li-user', 'admin');
      await page.fill('#li-pass', 'admin123');
      await page.click('button[onclick*="AUTH.login"]');
      await page.waitForTimeout(3000);
    }
    await page.click('.sb-item[data-view="autoalert"]');
    await page.waitForTimeout(4000);
    const info = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const q = s => !!document.querySelector(s);
      return {
        kanban: txt.includes('预警作战看板'),
        lanes: ['侦测候选', '智能预警', '处置编排', '已闭环'].filter(x => txt.includes(x)),
        commandBand: txt.includes('无人值守中') || txt.includes('引擎已暂停'),
        situationBar: txt.includes('境外自动预警态势'),
        sidebarDims: txt.includes('涉我海外利益命中分布'),
        sidebarCorr: txt.includes('高危走廊实时监控'),
        sidebarOrg: txt.includes('威胁组织活跃榜'),
        sidebarHuman: txt.includes('需人工介入'),
        deckTabs: ['规则工厂', '检测流水线', '机器人日志', '复盘看板'].filter(x => txt.includes(x)),
        cnFirst: txt.includes('涉华置顶'),
        oldGone: !txt.includes('智能无人值守总控台') && !txt.includes('智能推荐：需人工介入'),
        alertCount: (typeof AUTOALERT !== 'undefined') ? AUTOALERT._alerts.filter(a => !a.dismissed).length : -1,
        rawCount: (typeof AUTOALERT !== 'undefined') ? AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length : -1
      };
    });
    console.log('INFO:', JSON.stringify(info, null, 1));
    await page.screenshot({ path: '_audit/autoalert_warroom.png', fullPage: false });
    /* 切一个功能舱 Tab 验证交互 */
    await page.evaluate(() => { if (typeof AUTOALERT !== 'undefined') AUTOALERT.setDeckTab('review'); });
    await page.waitForTimeout(800);
    const tabOk = await page.evaluate(() => (document.body.innerText || '').includes('自动复盘看板') && (document.body.innerText || '').includes('命中率'));
    console.log('Tab切换到复盘:', tabOk ? 'OK' : 'FAIL');
    await page.screenshot({ path: '_audit/autoalert_warroom_deck.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) {
    console.log('FATAL:', e.message);
    await page.screenshot({ path: '_audit/autoalert_warroom_err.png' }).catch(() => {});
  }
  await browser.close();
})();
