const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    // 登录
    try {
      await page.fill('#li-user', 'admin');
      await page.fill('#li-pass', 'admin123');
      await page.click('button[onclick="AUTH.login()"]');
    } catch (e) { console.log('login err:', e.message); }
    await sleep(4000);
    // 导航到预警中心
    try { await page.click('.sb-item[data-view="alerts"]'); } catch (e) { console.log('nav alerts err:', e.message); }
    await sleep(6000); // 等 backfill + 渲染
    const info = await page.evaluate(() => {
      const badge = document.querySelector('#sb-alert-count');
      const alerts = (typeof ALERTS !== 'undefined') ? ALERTS : null;
      const pb = document.querySelector('#alert-posture-bar');
      return {
        alertBadge: badge ? badge.textContent : 'n/a',
        alertsLen: alerts ? alerts.length : 'ALERTS undefined',
        postureBarRendered: pb ? (pb.innerHTML.length > 50) : false,
        postureBarText: pb ? pb.innerText.replace(/\s+/g, ' ').slice(0, 200) : '(no #alert-posture-bar)'
      };
    });
    console.log('INFO:', JSON.stringify(info, null, 1));
    await page.screenshot({ path: '_audit/alerts_posture.png', fullPage: false });
    // 点一下"通道与资产"维度 chip 验证下钻过滤
    try { await page.click('#alert-posture-bar span[onclick*="channel"]'); await sleep(1500); await page.screenshot({ path: '_audit/alerts_posture_channel.png' }); console.log('channel filter screenshot saved'); } catch (e) { console.log('chip click err:', e.message); }
    console.log('screenshot saved: _audit/alerts_after_fix.png');
  } catch (e) {
    console.log('FATAL:', e.message);
  }
  await browser.close();
})();
