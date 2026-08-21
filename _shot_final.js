const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    await page.fill('#li-user', 'admin'); await page.fill('#li-pass', 'admin123');
    await page.click('button[onclick="AUTH.login()"]');
    await sleep(4500);
    // 1) 预警中心（态势指挥条）
    await page.click('.sb-item[data-view="alerts"]'); await sleep(6000);
    const a = await page.evaluate(() => {
      const pb = document.querySelector('#alert-posture-bar');
      return { posture: pb ? pb.innerText.replace(/\s+/g, ' ').slice(0, 220) : '(none)' };
    });
    console.log('[预警中心指挥条]', a.posture);
    await page.screenshot({ path: '_audit/final_alert_center.png' });
    // 2) 态势总览（高危走廊条）
    await page.click('.sb-item[data-view="situation"]'); await sleep(5000);
    const s = await page.evaluate(() => {
      const el = document.querySelector('#globe-intel-live');
      return { focus: el ? el.innerText.replace(/\s+/g, ' ').slice(0, 260) : '(none)' };
    });
    console.log('[态势总览·全球态势焦点]', s.focus);
    await page.screenshot({ path: '_audit/final_situation.png' });
    console.log('screenshots saved: final_alert_center.png / final_situation.png');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
