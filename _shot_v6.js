/* 自动预警 v6（智能复合联动）渲染复核 */
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
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
    await sleep(6000);
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(4000);

    const info = await page.evaluate(() => {
      const sit = document.getElementById('aa-situations');
      const cards = sit ? sit.querySelectorAll('.aa-sit-card') : [];
      const clusters = AUTOALERT._clusterAlerts();
      return {
        hasLivestreamDiv: !!document.getElementById('aa-livestream'),
        hasLeaflet: !!document.querySelector('.leaflet-container'),
        sitChildren: sit ? sit.children.length : -1,
        cardCount: cards.length,
        clusterCount: clusters.length,
        clusterKeys: clusters.slice(0, 8).map(c => c.title + '(风险' + c.risk + '/' + c.trend + '/n' + c.count + ')'),
        firstHasRisk: cards[0] ? /分/.test(cards[0].innerText) : false,
        firstHasChain: cards[0] ? !!cards[0].querySelector('.aa-sit-chain') : false,
        firstHasNarr: cards[0] ? !!cards[0].querySelector('.aa-sit-narr') : false,
        leftIntel: !!document.querySelector('.aa-card-tt'),
        linkageMonitor: document.querySelectorAll('.aa-lk-row').length,
        liveTimer: !!AUTOALERT._liveTimer,
        pollTimer: !!AUTOALERT._pollTimer
      };
    });
    console.log('INFO:', JSON.stringify(info, null, 0));

    // 展开第一个态势簇 → 检查联动详情（国家风险/走廊/组织/成员）
    const expand = await page.evaluate(() => {
      const c = AUTOALERT._clusterAlerts()[0];
      if (!c) return 'NO CLUSTER';
      AUTOALERT._toggleSituation(c.key);
      const det = document.querySelector('.aa-sit-detail');
      return {
        key: c.key,
        hasDetail: !!det,
        hasCountryRisk: det ? !!det.querySelector('.aa-sit-dsec') : false,
        memberCards: det ? det.querySelectorAll('.aa-live-card').length : 0,
        corridorLinks: det ? det.querySelectorAll('.aa-sit-link').length : 0
      };
    });
    console.log('INFO expand:', JSON.stringify(expand));

    // 走廊跨模块联动
    const corr = await page.evaluate(() => {
      window.__lk = null;
      const o = LINK_GRAPH.openChannel;
      LINK_GRAPH.openChannel = (t, n) => { window.__lk = t + '|' + n; };
      AUTOALERT._openCorridorLink('中巴走廊·俾路支');
      return window.__lk;
    });
    console.log('INFO corridorLink:', JSON.stringify(corr));

    // 实时脉冲：注入一条阿富汗新预警 → 该簇应带 aa-new
    const pulse = await page.evaluate(() => {
      AUTOALERT._prependNewCards([{
        id: 'T6-AF', title_zh: '【实时】阿富汗塔利班再袭中资项目', country: '阿富汗',
        level: 'red', confidence: 0.9, status: 'raw', time: AUTOALERT._fmtNow(), _live: true
      }]);
      const newCards = document.querySelectorAll('.aa-sit-card.aa-new');
      const af = Array.from(document.querySelectorAll('.aa-sit-card')).find(el => /阿富汗/.test(el.innerText));
      return { pulsedCount: newCards.length, afHasNew: !!(af && af.classList.contains('aa-new')), afTitle: af ? af.querySelector('.aa-sit-title').innerText : null };
    });
    console.log('INFO pulse:', JSON.stringify(pulse));

    await page.screenshot({ path: '_audit/aa_v6_compound.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
