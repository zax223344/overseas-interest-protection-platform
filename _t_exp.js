/* 终验：情景推演 v2 + 专家研判 v2 + 柬埔寨旧闻绝迹 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1200 } });
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
  await page.waitForTimeout(14000);
  /* 柬埔寨旧闻检查：首页情报流 + 预警中心 */
  const stale = await page.evaluate(() => {
    const feed = (document.getElementById('globe-intel-live') || {}).innerText || '';
    const inFeed = /柬埔寨士兵|Oddar Meanchey/.test(feed);
    const inAlerts = ALERTS.some(a => /柬埔寨士兵|Oddar Meanchey/.test((a.title || '') + (a.title_zh || '')));
    return { inFeed, inAlerts };
  });
  console.log('STALE CHECK:', JSON.stringify(stale));
  /* 情景推演 v2 */
  await page.evaluate(() => navigateTo('forecast'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => FORECAST.switch('scenario'));
  await page.waitForTimeout(1200);
  const scn = await page.evaluate(() => {
    const t = document.getElementById('fc-content').innerText.replace(/\s+/g, ' ');
    return {
      cards: (t.match(/风险升级情景/g) || []).length,
      hasAIbtn: !!document.querySelector('[onclick*="_scenarioPath"]'),
      sample: t.slice(0, 160),
      noFake: !/红海危机持续升级|萨赫勒地区恐怖主义扩散/.test(t)
    };
  });
  console.log('SCENARIO:', JSON.stringify(scn, null, 1));
  /* 专家研判 v2 */
  await page.evaluate(() => FORECAST.switch('expert'));
  await page.waitForTimeout(1000);
  const exp = await page.evaluate(() => {
    const t = document.getElementById('fc-content').innerText.replace(/\s+/g, ' ');
    return {
      personas: ['安全态势专家', '外交地缘专家', '经贸合规专家', '项目风控专家'].filter(k => t.includes(k)).length,
      noFakeHumans: !/张明远|李建华|王立群|陈学东|刘维和|赵海洋/.test(t),
      aiTag: (t.match(/AI/g) || []).length > 3,
      sample: t.slice(0, 140)
    };
  });
  console.log('EXPERT:', JSON.stringify(exp, null, 1));
  /* AI 会商真实调用（等结果，最长 150s） */
  await page.evaluate(() => FORECAST._expertPanel());
  await page.waitForFunction(() => {
    const b = document.getElementById('expert-ai-安全态势专家');
    return b && !/研判中/.test(b.innerText);
  }, { timeout: 160000 }).catch(() => {});
  const aiRes = await page.evaluate(() => ({
    sec: (document.getElementById('expert-ai-安全态势专家') || {}).innerText?.slice(0, 100),
    dip: (document.getElementById('expert-ai-外交地缘专家') || {}).innerText?.slice(0, 60)
  }));
  console.log('AI PANEL:', JSON.stringify(aiRes, null, 1));
  console.log('JS ERR:', errs.slice(0, 5));
  await page.screenshot({ path: '_audit/expert_v2.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
