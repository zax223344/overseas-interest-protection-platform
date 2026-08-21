/* 实测：态势总览实时情报流面板的俄乌占比（全新浏览器） */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
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
  await page.waitForTimeout(18000);
  await page.evaluate(() => navigateTo('situation'));
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const el = document.getElementById('globe-intel-live');
    if (!el) return { fail: 'panel missing' };
    const rows = [...el.querySelectorAll('[class*="item"], [class*="row"], div')].filter(x => {
      const t = x.innerText || '';
      return t.length > 20 && t.length < 300 && x.children.length < 12;
    });
    const texts = [...new Set(rows.map(r => (r.innerText || '').trim()))];
    const ruRe = /乌克兰|俄罗斯|Ukraine|Russia|Kyiv|Moscow|Zelensky|Putin|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯/i;
    return { total: texts.length, ruUa: texts.filter(t => ruRe.test(t)).length, samples: texts.slice(0, 6).map(t => t.slice(0, 50)) };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
