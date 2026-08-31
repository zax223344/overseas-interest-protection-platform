/* 任务 #515/#516 实测：专项作战室双要素闸 + 交互选项框（国别/组织/项目/主题四面板） */
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
    await page.click('.sb-item[data-view="threatroom"]');
    await sleep(5000);

    /* ① 四 tab 存在 */
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tr-tab')).map(t => t.textContent.trim()));
    console.log('TABS:', JSON.stringify(tabs));

    /* ② 主题子题面板：模板 + 组合子题 */
    await page.click('.tr-tab[data-tab="theme"]');
    await sleep(800);
    const themeInfo = await page.evaluate(() => {
      const box = document.getElementById('tr-optbox');
      return {
        shown: box.classList.contains('show'),
        runs: box.querySelectorAll('[data-run]').length,
        adds: box.querySelectorAll('[data-add]').length,
        sampleRun: (box.querySelector('[data-run]') || {}).textContent || ''
      };
    });
    console.log('THEME_PANEL:', JSON.stringify(themeInfo));
    await page.screenshot({ path: '_audit/fix515_1_theme_panel.png' });

    /* ③ 组合子题：点「中资」+「绑架」→ 输入框应为 中资#绑架 + 速览联动 */
    await page.click('.tr-opt[data-add="中资"]');
    await sleep(400);
    await page.click('.tr-opt[data-add="绑架"]');
    await sleep(700);
    const combo = await page.evaluate(() => ({
      input: document.getElementById('tr-q').value,
      live: (document.getElementById('tr-live') || {}).innerText || ''
    }));
    console.log('COMBO_INPUT:', combo.input);
    console.log('COMBO_LIVE:', combo.live.slice(0, 160));

    /* ④ 国别面板：chips 数 + 24h 热度标 */
    await page.click('.tr-tab[data-tab="country"]');
    await sleep(600);
    const countryInfo = await page.evaluate(() => {
      const box = document.getElementById('tr-optbox');
      const hot = Array.from(box.querySelectorAll('.tr-opt b')).slice(0, 5).map(b => b.parentElement.textContent.trim());
      return { chips: box.querySelectorAll('.tr-opt').length, hot: hot };
    });
    console.log('COUNTRY_PANEL:', JSON.stringify(countryInfo));
    await page.screenshot({ path: '_audit/fix515_2_country_panel.png' });

    /* ⑤ 组织 + 项目面板渲染 */
    await page.click('.tr-tab[data-tab="org"]');
    await sleep(500);
    const orgInfo = await page.evaluate(() => document.querySelectorAll('#tr-optbox .tr-opt').length);
    console.log('ORG_CHIPS:', orgInfo);
    await page.click('.tr-tab[data-tab="project"]');
    await sleep(600);
    const projInfo = await page.evaluate(() => {
      const box = document.getElementById('tr-optbox');
      return { chips: box.querySelectorAll('.tr-opt').length, groups: box.querySelectorAll('.tr-optg').length, header: (box.querySelector('.tr-optg') || {}).textContent || '' };
    });
    console.log('PROJECT_PANEL:', JSON.stringify(projInfo));
    await page.screenshot({ path: '_audit/fix515_3_project_panel.png' });

    /* ⑥ 再点同 tab 收起 */
    await page.click('.tr-tab[data-tab="project"]');
    await sleep(400);
    const collapsed = await page.evaluate(() => !document.getElementById('tr-optbox').classList.contains('show'));
    console.log('PANEL_COLLAPSE:', collapsed);

    console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  } catch (e) {
    console.log('FATAL:', e.message);
    await page.screenshot({ path: '_audit/fix515_fatal.png' }).catch(() => {});
    console.log('ERRORS:', errors.slice(0, 8));
  } finally { await browser.close(); }
})();
