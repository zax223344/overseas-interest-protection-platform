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
    await sleep(4000);

    /* ── 验证一：智能联动预警（预警中心 → 智能联动预警 tab） ── */
    await page.click('.sb-item[data-view="alerts"]');
    await sleep(4000);
    try { await page.click('text=智能联动预警', { timeout: 8000 }); } catch (e) { console.log('TAB_CLICK_FALLBACK:', e.message.slice(0, 80)); }
    await sleep(6000);
    const aa = await page.evaluate(() => {
      const txt = (document.getElementById('view-autoalert') || {}).innerText || '';
      const linkHits = (txt.match(/我在该国有 (\d+) 项登记利益/g) || []);
      const noProj = (txt.match(/该国虽无登记的我方项目/g) || []).length;
      const corr = (txt.match(/走廊沿线共关联我方利益 (\d+) 项/g) || []);
      return {
        linkCount: linkHits.length,
        linkSample: linkHits.slice(0, 5),
        noProjCount: noProj,
        corridorCounts: corr.slice(0, 5),
        pkHasProjects: /巴基斯坦[\s\S]{0,600}?我在该国有 \d+ 项登记利益/.test(txt),
        assetListRows: document.querySelectorAll('#view-autoalert .aa3-asset-list .aa3-asset-item, #view-autoalert .aa3-asset-list > *').length
      };
    });
    console.log('AUTOALERT:', JSON.stringify(aa, null, 1));
    await page.screenshot({ path: '_audit/fix513_1_autoalert.png', fullPage: false });

    /* ── 验证二：关键词搜索改造（threatroom） ── */
    await page.click('.sb-item[data-view="threatroom"]');
    await sleep(3000);
    await page.fill('#tr-q', '中资#抢劫');
    await sleep(800);
    const live = await page.evaluate(() => {
      const el = document.getElementById('tr-live');
      return {
        shown: !!el && el.style.display === 'flex',
        text: (el ? el.innerText : '').replace(/\n/g, ' ').slice(0, 200),
        hasOldNegative: !!(el && /未命中/.test(el.innerText))
      };
    });
    console.log('LIVE_KEYWORD:', JSON.stringify(live));
    await page.screenshot({ path: '_audit/fix513_2_keyword_live.png' });

    /* ── 验证三：启动作战（中文关键词 → 英文翻译 → 全网碰撞） ── */
    await page.click('#tr-go');
    await sleep(3000);
    const stage1 = await page.evaluate(() => (document.getElementById('tr-stage') || {}).innerText || '');
    console.log('STAGE1:', stage1.slice(0, 150));
    let done = false, lastStage = '';
    for (let i = 0; i < 40; i++) {
      await sleep(10000);
      const st = await page.evaluate(() => ({
        rep: (document.getElementById('tr-rep') || {}).style.display === 'block',
        stage: (document.getElementById('tr-stage') || {}).innerText || ''
      }));
      lastStage = st.stage;
      if (st.rep) { done = true; break; }
      if (i % 4 === 3) console.log('WAIT ' + ((i + 1) * 10) + 's: ' + st.stage.slice(0, 90));
    }
    console.log('DONE:', done, '| LASTSTAGE:', lastStage.slice(0, 110));
    if (done) {
      const info = await page.evaluate(() => {
        const txt = (document.getElementById('tr-rep') || {}).innerText || '';
        return {
          chain: (txt.match(/检索链路：([\s\S]{0,180})/) || [])[1] || '',
          collectKpi: (txt.match(/本轮新采集入库\s*\n\s*(\d+) \/ (\d+) 条/) || [])[0] || '',
          kpiN: (txt.match(/关联数据\s*\n\s*(\d+) 条/) || [])[1] || '',
          items: (document.getElementById('tr-feed') || {}).querySelectorAll('.tr-item').length,
          judge: (txt.match(/值班研判：([\s\S]{0,160})/) || [])[1] || ''
        };
      });
      console.log('REPORT:', JSON.stringify(info, null, 1));
      await page.screenshot({ path: '_audit/fix513_3_report.png' });
    }
    console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  } catch (e) {
    console.log('FATAL:', e.message);
    await page.screenshot({ path: '_audit/fix513_fatal.png' }).catch(() => {});
    console.log('ERRORS:', errors.slice(0, 8));
  } finally { await browser.close(); }
})();
