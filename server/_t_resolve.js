/* 临时验证：标题反查原文 URL + 正文回填（真实远程请求，不含任何模拟数据） */
const crawler = require('./crawler');
const ft = require('./fulltext');

const CASES = [
  'Chinese Embassy in Japan says authorities fail to act on threats',
  'UK nationalizes Chinese-owned British Steel to protect nation\'s steelmaking capacity'
];

(async () => {
  for (const t of CASES) {
    process.stdout.write('\n=== ' + t + '\n');
    const t0 = Date.now();
    const u = await crawler.resolveUrl(t, {});
    console.log('resolved:', u || '(未命中)', '| ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    if (!u) continue;
    const art = await ft.fetchArticle(u, { timeout: 15000 });
    if (!art) { console.log('  正文抓取失败'); continue; }
    console.log('  charCount=' + art.charCount, 'paras=' + art.paraCount, 'pub=' + (art.publishedAt || '-'), 'site=' + (art.siteName || '-'));
    console.log('  首段:', String(art.paragraphs[0] || '').slice(0, 160));
    console.log('  要素:', (art.factSheet.facts || []).map(f => f.label + '=' + f.value).join(' | ') || '(无)');
  }
  console.log('\n--- alertNo 样例 ---');
  console.log(ft.makeAlertNo({ title: CASES[0], category: '安全风险', country: '日本', publishedAt: '2026-08-01' }));
})();
