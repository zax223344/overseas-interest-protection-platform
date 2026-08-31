const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
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
    await sleep(5000);
    /* ── 阶段一：进作战室，验证 v2 首页动态面板 ── */
    await page.click('.sb-item[data-view="threatroom"]');
    await sleep(3000);
    const deck = await page.evaluate(() => {
      const d = document.getElementById('tr-deck');
      return {
        deckShown: !!d && d.style.display !== 'none',
        histCards: document.querySelectorAll('.tr-hcard').length,
        hotRows: document.querySelectorAll('.tr-hotrow').length,
        coreItems: document.querySelectorAll('.tr-coreit').length,
        hotTop: Array.from(document.querySelectorAll('.tr-hotrow span:first-child')).slice(0, 3).map(x => x.textContent)
      };
    });
    console.log('DECK:', JSON.stringify(deck));
    await page.screenshot({ path: '_audit/trv2_1_deck.png' });
    /* ── 阶段二：实体速览实时识别 ── */
    await page.fill('#tr-q', '吉尔吉斯斯坦');
    await sleep(700);
    const live = await page.evaluate(() => {
      const el = document.getElementById('tr-live');
      return { shown: !!el && el.style.display === 'flex', text: (el ? el.innerText : '').slice(0, 120) };
    });
    console.log('LIVE:', JSON.stringify(live));
    await page.screenshot({ path: '_audit/trv2_2_live.png' });
    /* ── 阶段三：启动作战（完整链路，v2 矩阵 16+ 路，轮询最长 11 分钟） ── */
    await page.click('#tr-go');
    await sleep(3000);
    const stage1 = await page.evaluate(() => (document.getElementById('tr-stage') || {}).innerText || '');
    console.log('STAGE1:', stage1.slice(0, 150));
    let done = false, lastStage = '';
    for (let i = 0; i < 66; i++) {
      await sleep(10000);
      const st = await page.evaluate(() => ({
        rep: (document.getElementById('tr-rep') || {}).style.display === 'block',
        stage: (document.getElementById('tr-stage') || {}).innerText || ''
      }));
      lastStage = st.stage;
      if (st.rep) { done = true; break; }
      if (i % 6 === 5) console.log('WAIT ' + ((i + 1) * 10) + 's: ' + st.stage.slice(0, 90));
    }
    console.log('DONE:', done, '| LASTSTAGE:', lastStage.slice(0, 110));
    if (done) {
      const info = await page.evaluate(() => {
        const rep = document.getElementById('tr-rep');
        const txt = rep ? rep.innerText : '';
        const feed = document.getElementById('tr-feed');
        return {
          kpiN: (txt.match(/关联数据\s*\n\s*(\d+) 条/) || [])[1] || '',
          gradeScore: (txt.match(/综合威胁等级\s*\n\s*(.+)\n\s*(\d+) 分/) || [])[2] || '',
          gradeT: (txt.match(/综合威胁等级\s*\n\s*(.+)/) || [])[1] || '',
          cnKpi: (txt.match(/涉华关联\s*\n\s*(\d+) 条/) || [])[1] || '',
          collectKpi: (txt.match(/本轮新采集入库\s*\n\s*(\d+) \/ (\d+) 条/) || [])[0] || '',
          srcRows: document.querySelectorAll('.tr-srcrow').length,
          relChips: document.querySelectorAll('.tr-rel').length,
          srcTop: (document.querySelector('.tr-srcrow span') || {}).textContent || '',
          items: feed ? feed.querySelectorAll('.tr-item').length : 0,
          marks: document.querySelectorAll('.tr-mark').length,
          summitHits: (feed ? feed.innerText : '').split('\n').filter(l => /上合|峰会|summit|SCO|比什凯克|Bishkek/i.test(l)).length,
          judge: (txt.match(/值班研判：([\s\S]{0,200})/) || [])[1] || ''
        };
      });
      console.log('REPORT:', JSON.stringify(info, null, 1));
      await page.screenshot({ path: '_audit/trv2_3_report.png', fullPage: false });
      /* 多源覆盖+关联实体推荐区域截图 */
      await page.evaluate(() => {
        const rows = document.querySelectorAll('#tr-rep .card');
        for (const r of rows) { if (r.innerText.indexOf('多源覆盖') >= 0) { r.scrollIntoView({ block: 'center' }); break; } }
      });
      await sleep(600);
      await page.screenshot({ path: '_audit/trv2_4_srccov.png' });
      /* 情报流滚屏 */
      await page.evaluate(() => { var f = document.getElementById('tr-feed'); if (f) f.scrollTop = 300; });
      await sleep(800);
      await page.screenshot({ path: '_audit/trv2_5_feed.png' });
      /* 详情弹窗 */
      const modal = await page.evaluate(() => {
        const el = document.querySelector('.tr-item[data-i]');
        if (!el) return 'no-item';
        el.click();
        return !!document.getElementById('tr-modal');
      });
      await sleep(1000);
      console.log('MODAL:', modal);
      await page.screenshot({ path: '_audit/trv2_6_modal.png' });
    }
    console.log('ERRORS:', errors.length ? errors.slice(0, 8).join(' | ') : 'none');
  } catch (e) { console.log('FATAL:', e.message); }
  await browser.close();
})();
