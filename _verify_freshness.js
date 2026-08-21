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
    await sleep(5000);
    await page.click('.sb-item[data-view="alerts"]');
    await sleep(15000);
    const info = await page.evaluate(() => {
      const A = (typeof ALERTS !== 'undefined') ? ALERTS : [];
      const now = Date.now();
      const list = A.slice(0, 20).map(a => {
        const pt = a.publish_time || a.publishedAt || a.pubDate || a.event_date || a.date || a.time || '';
        const t = Date.parse(String(pt).trim()) || Date.parse(String(pt).replace(' ', 'T')) || 0;
        const ageH = t ? Math.round((now - t) / 3600000) : -1;
        return { title: (a.title_zh || a.title || '').slice(0, 36), pt: String(pt).slice(0, 24), ageH };
      });
      const stale = A.filter(a => {
        const pt = a.publish_time || a.publishedAt || a.pubDate || a.event_date || a.date || a.time || '';
        const t = Date.parse(String(pt).trim()) || Date.parse(String(pt).replace(' ', 'T')) || 0;
        return t && (now - t) > 24 * 3600000;
      });
      return { total: A.length, staleOver24h: stale.length, sample: list };
    });
    console.log(JSON.stringify(info, null, 1));
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
