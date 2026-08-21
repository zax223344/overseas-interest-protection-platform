/* 诊断：侧边栏数据管理分组渲染 + 角色判定 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 150)));
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const u = document.querySelector('input[type=text], #username');
    const p = document.querySelector('input[type=password]');
    if (u) u.value = 'admin';
    if (p) p.value = 'admin123';
    const b = [...document.querySelectorAll('button')].find(x => /登\s*录/.test(x.textContent) && !/紧急/.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(12000);
  const r = await page.evaluate(() => {
    const role = (typeof ROLE_UI !== 'undefined' && ROLE_UI._role) || localStorage.getItem('orps_role') || 'none';
    const groups = [...document.querySelectorAll('.sb-group, .sb-section, [class*="sb-group"]')].map(g => ({
      label: (g.innerText || '').split('\n')[0].slice(0, 12),
      items: g.querySelectorAll('.sb-item').length,
      visibleItems: [...g.querySelectorAll('.sb-item')].filter(x => x.offsetParent !== null).length
    }));
    const dm = [...document.querySelectorAll('.sb-item')].filter(x => /数据中心|数据源库/.test(x.innerText)).map(x => ({ label: x.innerText.trim(), visible: x.offsetParent !== null }));
    return { role, groups, dm };
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('JS ERR:', errs.slice(0, 5));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
