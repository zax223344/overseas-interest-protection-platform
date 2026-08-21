/* 自动预警 v5（无地图 · 实时自动预警流）渲染复核 */
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
    await sleep(6000); // 让扫描/采集跑一会，产生实时预警
    await page.click('.sb-item[data-view="autoalert"]');
    await sleep(4000); // 等实时流渲染 + 增量定时器 + 轮询

    const info = await page.evaluate(() => {
      const view = document.getElementById('view-autoalert');
      const stream = document.getElementById('aa-livestream');
      const cards = stream ? stream.querySelectorAll('.aa-live-card') : [];
      const leaflet = view ? view.querySelector('.leaflet-container') : null;
      const mapHost = document.getElementById('aa-map-host');
      const filterbar = document.getElementById('aa-filterbar');
      return {
        viewActive: view ? view.classList.contains('active') : false,
        hasMapHost: !!mapHost,         // 应为 false（已彻底移除地图）
        hasLeaflet: !!leaflet,         // 应为 false
        streamChildren: stream ? stream.children.length : -1,
        cardCount: cards.length,
        firstCardTitle: cards[0] ? cards[0].innerText.replace(/\n/g, ' ').slice(0, 46) : null,
        firstIsNew: cards[0] ? cards[0].classList.contains('aa-new') : false,
        firstHasLiveTag: cards[0] ? !!cards[0].querySelector('.aa-newtag') : false,
        filterChips: document.querySelectorAll('.aa-filter-chip').length,
        liveTimer: !!AUTOALERT._liveTimer,
        pollTimer: !!AUTOALERT._pollTimer,
        raw: AUTOALERT._rawAlerts.filter(r => r.status === 'raw').length,
        alerts: AUTOALERT._alerts.filter(a => !a.dismissed).length
      };
    });
    console.log('INFO:', JSON.stringify(info));

    // 模拟一条新实时预警到达：应增量滑入顶部，带 LIVE 新 标记
    const inj = await page.evaluate(() => {
      AUTOALERT._prependNewCards([{
        id: 'TEST-LIVE-1', title_zh: '【实时验证】阿富汗塔利班袭击中资项目',
        country: '阿富汗', level: 'red', confidence: 0.92, status: 'raw',
        time: AUTOALERT._fmtNow(), _live: true, rule: '实时监测'
      }]);
      const stream = document.getElementById('aa-livestream');
      const top = stream ? stream.firstChild : null;
      return {
        topIsNew: !!(top && top.classList.contains('aa-new')),
        topHasLiveTag: !!(top && top.querySelector('.aa-newtag')),
        topText: top ? top.innerText.replace(/\n/g, ' ').slice(0, 30) : null,
        total: stream ? stream.children.length : -1
      };
    });
    console.log('INFO afterLiveInjection:', JSON.stringify(inj));

    // 模拟真实 onLiveItem 通道（7x24采集回调）→ 应增长且不整页重建
    const viaCb = await page.evaluate(() => {
      const before = document.getElementById('aa-livestream').children.length;
      AUTOALERT.onLiveItem({ title_zh: '巴基斯坦瓜达尔港中资车队遇袭', title: '巴基斯坦瓜达尔港中资车队遇袭',
        country: '巴基斯坦', content_zh: '袭击', type: '安全风险' }, 'security_events');
      const after = document.getElementById('aa-livestream').children.length;
      return { before, after, grew: after > before };
    });
    console.log('INFO viaCallback:', JSON.stringify(viaCb));

    await page.screenshot({ path: '_audit/aa_v5_livestream.png', fullPage: false });
    console.log('ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
