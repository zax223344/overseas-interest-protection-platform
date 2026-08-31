/* 补充截图：聚焦公文版的图表区域（环形图+条形图）+ 表格区 + 抽屉与编辑后的交互版 */
const PW = require('C:/Users/28737/.workbuddy/binaries/node/versions/.22.22.2.deleting.17900.1788179718614/node_modules/playwright');
const BASE = 'http://localhost:3000';
const OUT = 'C:/Users/28737/Desktop/新建文件夹/logs';
(async () => {
  const b = await PW.chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1560, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof AUTH !== 'undefined' && AUTH._ready, null, { timeout: 30000 });
  await p.fill('#li-user', 'admin');
  await p.fill('#li-pass', 'admin123');
  await p.click('#btn-login');
  await p.waitForFunction(() => typeof AUTH !== 'undefined' && AUTH.user, null, { timeout: 20000 });
  await p.evaluate(() => { navigateTo('analysis'); switchAnalysisTab('daily'); });
  await p.waitForFunction(() => {
    const b = document.getElementById('dr-body');
    return b && b.innerText && b.innerText.indexOf('加载中') < 0;
  }, null, { timeout: 60000 });
  await p.waitForTimeout(1200);

  /* 交互版：恢复基准（撤销）以便干净的截图 */
  const r = await p.evaluate(async () => {
    const tok = APIClient.getToken();
    const list = await fetch('/api/reports/daily').then(r => r.json());
    const date = '2026-08-30';
    const g = await fetch('/api/reports/daily/' + date).then(r => r.json());
    if (g.manual_edit || g.edited) {
      await fetch('/api/reports/daily/' + date + '/edits', { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
    }
    /* force regen for fresh digest strip */
    await fetch('/api/reports/daily/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, force: true }) });
    return true;
  });
  /* 选一个干净无编辑的日期：8月28或8月27（早期），force regen 拿到新 digest */
  await p.evaluate(() => DAILY_REPORT.pick('2026-08-30'));
  await p.waitForTimeout(1500);

  /* 切公文版并滚到图表 */
  await p.evaluate(() => DAILY_REPORT.switchView('gov'));
  await p.waitForTimeout(1000);
  /* 滚到 donut 处 */
  await p.evaluate(() => {
    const w = document.querySelector('#dr-body .dr-govwrap');
    if (!w) return;
    const fig = w.querySelector('.drg-fig');
    if (fig) w.scrollTop = fig.parentElement.scrollTop + (fig.offsetTop - 30);
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/_dailyreport_7_charts.png' });

  /* 滚到国别表 */
  await p.evaluate(() => {
    const w = document.querySelector('#dr-body .dr-govwrap');
    const tbl = w.querySelectorAll('.drg-table')[1];
    if (tbl) w.scrollTop = tbl.parentElement.scrollTop + (tbl.offsetTop - 40);
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/_dailyreport_8_table_country.png' });

  /* 滚到底部：研判+建议+署名+版记 */
  await p.evaluate(() => { const w = document.querySelector('#dr-body .dr-govwrap'); if (w) w.scrollTop = w.scrollHeight; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/_dailyreport_9_gov_judge.png' });

  /* 切交互版，验证 digest 干净 + 抽屉 */
  await p.evaluate(() => DAILY_REPORT.switchView('inter'));
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const row = document.querySelector('#dr-rows [data-dri]');
    if (row) row.click();
  });
  await p.waitForTimeout(400);
  const dig = await p.evaluate(() => {
    const d = document.getElementById('dr-drawer');
    const text = d.innerText;
    return { hasRawTag: text.indexOf('&lt;a') >= 0, sample: text.match(/摘要[\s\S]{1,120}/)[0] };
  });
  console.log('digest 检查 — 含原始标签:', dig.hasRawTag, '样例:', dig.sample.replace(/\n/g, ' ').slice(0, 100));
  await p.screenshot({ path: OUT + '/_dailyreport_10_drawer_clean.png' });

  console.log('截图完成');
  await b.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });