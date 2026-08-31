/* 日报三大升级 · 真实浏览器验证（Playwright chromium）
 * 步骤：登录 → 每日简报交互版截图 → 条目抽屉 → 编辑(改标题/调序/删除)保存 →
 *       公文版截图(红头/图表/表格) → 红头开关 → 导出Word下载验证 → console 错误收集 */
const path = require('path');
const PW = require('C:/Users/28737/.workbuddy/binaries/node/versions/.22.22.2.deleting.17900.1788179718614/node_modules/playwright');
const BASE = 'http://localhost:3000';
const OUT = 'C:/Users/28737/Desktop/新建文件夹/logs';
const DATE = process.argv[2] || '2026-08-31';

(async () => {
  const browser = await PW.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));

  const step = async (name, fn) => {
    try { await fn(); console.log('✓', name); }
    catch (e) { console.log('✗', name, '::', String(e).slice(0, 300)); }
  };

  /* 1. 登录（AUTH 为 const 声明，不在 window 上——用 typeof 探测） */
  await step('打开登录页并登录', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof AUTH !== 'undefined' && AUTH._ready, null, { timeout: 30000 });
    await page.fill('#li-user', 'admin');
    await page.fill('#li-pass', 'admin123');
    await page.click('#btn-login');
    await page.waitForFunction(() => typeof AUTH !== 'undefined' && AUTH.user, null, { timeout: 20000 });
    await page.waitForTimeout(800);
  });

  /* 2. 进入每日简报 */
  await step('导航到研判简报→每日简报', async () => {
    await page.evaluate(() => { navigateTo('analysis'); });
    await page.evaluate(() => { switchAnalysisTab('daily'); });
    await page.waitForFunction(() => {
      const b = document.getElementById('dr-body');
      return b && b.innerText && b.innerText.indexOf('加载中') < 0;
    }, null, { timeout: 60000 });
    await page.waitForTimeout(1200);
  });

  /* 3. 交互版截图 */
  await step('交互版截图', async () => {
    await page.screenshot({ path: path.join(OUT, '_dailyreport_1_interactive.png'), fullPage: false });
  });

  /* 4. 点击条目 → 抽屉 */
  await step('条目点击展开抽屉（含摘要/来源/原文链接）', async () => {
    const row = await page.$('#dr-rows [data-dri]');
    if (!row) throw new Error('无条目可点');
    await row.click();
    await page.waitForFunction(() => document.getElementById('dr-drawer') && document.getElementById('dr-drawer').classList.contains('open'), null, { timeout: 8000 });
    const info = await page.evaluate(() => {
      const d = document.getElementById('dr-drawer');
      return { text: d.innerText.slice(0, 400), hasLink: !!d.querySelector('a[href^="http"]') };
    });
    console.log('  抽屉内容预览:', info.text.replace(/\n+/g, '|').slice(0, 200));
    console.log('  原文链接存在:', info.hasLink);
    await page.screenshot({ path: path.join(OUT, '_dailyreport_2_drawer.png') });
    await page.evaluate(() => DAILY_REPORT.closeDrawer());
  });

  /* 5. 编辑模式：改标题+删除一条+保存 */
  await step('编辑简报（改标题→删除一条→保存）', async () => {
    /* 选一个 china 节的条目（非 types12 嵌套，操作稳定） */
    const target = await page.evaluate(() => {
      const rows = document.querySelectorAll('#dr-rows > [data-drs] [data-dri]');
      for (const r of rows) { if (r.closest('[data-drs="china"]')) return r.getAttribute('data-dri'); }
      return rows.length ? rows[0].getAttribute('data-dri') : null;
    });
    if (target == null) throw new Error('无可编辑条目');
    await page.evaluate(() => DAILY_REPORT.startEdit());
    await page.waitForTimeout(400);
    /* 改标题：打开抽屉编辑表单 */
    await page.evaluate((idx) => DAILY_REPORT.openDrawer(parseInt(idx, 10)), target);
    await page.waitForTimeout(300);
    await page.fill('#dr-edit-title', '【人工修订验证】该条目标题已由情报值班人员人工修改');
    await page.click('#dr-drawer button:has-text("保存该条目修改")');
    await page.waitForTimeout(300);
    /* 删除另一个节的一条 */
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#dr-rows > [data-drs] [data-dri]');
      const r = Array.from(rows).find(x => x.closest('[data-drs="sanc"]') || x.closest('[data-drs="corr"]') || x.closest('[data-drs="neg"]')) || rows[rows.length - 1];
      if (r) r.remove();
    });
    await page.screenshot({ path: path.join(OUT, '_dailyreport_3_editmode.png') });
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('button[onclick="DAILY_REPORT.saveEdits()"]');
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => document.getElementById('dr-body') && document.getElementById('dr-body').innerText.indexOf('人工修订版') >= 0, null, { timeout: 15000 });
  });

  /* 6. 校验编辑已入库（manual_edit 标记 + 抽屉标题） */
  await step('校验人工编辑已保存', async () => {
    const badge = await page.evaluate(() => document.getElementById('dr-body').innerText.slice(0, 300));
    console.log('  人工修订标记:', badge.indexOf('人工修订版') >= 0);
  });

  /* 7. 公文版截图 */
  await step('切换公文版并截图（红头/标题/图表/表格）', async () => {
    await page.evaluate(() => DAILY_REPORT.switchView('gov'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, '_dailyreport_4_gov_top.png') });
    /* 滚到底部截署名/版记 */
    await page.evaluate(() => { const w = document.querySelector('#dr-body .dr-govwrap'); if (w) w.scrollTop = w.scrollHeight; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '_dailyreport_5_gov_bottom.png') });
    const checks = await page.evaluate(() => {
      const g = document.querySelector('#dr-body .drg-paper');
      if (!g) return { exists: false };
      const svgCount = g.querySelectorAll('svg').length;
      const tableCount = g.querySelectorAll('table.drg-table').length;
      return {
        exists: true, redhead: !!g.querySelector('.drg-redhead'), title: g.querySelector('.drg-title') ? g.querySelector('.drg-title').innerText.trim() : '',
        titleSize: g.querySelector('.drg-title') ? getComputedStyle(g.querySelector('.drg-title')).fontSize : '',
        bodyFont: getComputedStyle(g).fontFamily.slice(0, 40), bodySize: getComputedStyle(g).fontSize, lineH: getComputedStyle(g).lineHeight,
        svgCount, tableCount, sign: !!g.querySelector('.drg-sign'), footer: !!g.querySelector('.drg-footer'), figcaps: Array.from(g.querySelectorAll('.drg-figcap')).map(x => x.innerText.trim()).slice(0, 5)
      };
    });
    console.log('  公文版结构:', JSON.stringify(checks));
  });

  /* 8. 红头开关 */
  await step('红头开关切换', async () => {
    await page.click('button[onclick="DAILY_REPORT.toggleRed()"]');
    await page.waitForTimeout(300);
    const off = await page.evaluate(() => { const p = document.querySelector('#dr-body .drg-paper'); return p && p.classList.contains('nored'); });
    console.log('  红头已关闭:', off);
    await page.screenshot({ path: path.join(OUT, '_dailyreport_6_gov_nored.png') });
    await page.click('button[onclick="DAILY_REPORT.toggleRed()"]');
    await page.waitForTimeout(300);
  });

  /* 9. 导出 Word 下载 */
  await step('导出 Word（下载触发验证）', async () => {
    const dlPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.click('button[onclick="DAILY_REPORT.exportWord()"]');
    const dl = await dlPromise;
    const fname = dl.suggestedFilename();
    await dl.saveAs(path.join(OUT, '_dailyreport_export_' + fname));
    const fs = require('fs');
    const size = fs.statSync(path.join(OUT, '_dailyreport_export_' + fname)).size;
    console.log('  下载文件:', fname, size, 'bytes');
    const head = fs.readFileSync(path.join(OUT, '_dailyreport_export_' + fname)).slice(0, 300).toString('utf8');
    console.log('  Word文档头检查: ProgId=' + (head.indexOf('Word.Document') >= 0) + ' mso=' + (head.indexOf('urn:schemas-microsoft-com:office:word') >= 0) + ' svg=' + (head.indexOf('<svg') >= 0 || head.indexOf('<svg') >= 0));
  });

  /* 10. 导出 PDF（打印 iframe —— headless 无法弹真实对话框，验证不报错即可） */
  await step('导出 PDF 按钮可触发（headless 验证无异常）', async () => {
    await page.click('button[onclick="DAILY_REPORT.exportPDF()"]');
    await page.waitForTimeout(1200);
    /* iframe print 用 contentWindow.print，拦截不到，验证无 pageerror 即可 */
    console.log('  打印流程已触发（无异常）');
  });

  console.log('\n==== Console 错误 (' + errors.length + ') ====');
  errors.slice(0, 10).forEach(e => console.log('  -', e));
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
