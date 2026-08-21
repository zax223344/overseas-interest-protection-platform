const ft = require('./fulltext');
const fs = require('fs');

(async () => {
  let cache = [];
  try { cache = JSON.parse(fs.readFileSync('./.cache/osint_intel.json', 'utf8')); } catch (e) {}
  const sample = cache.slice(0, 25).map(x => Object.assign({}, x));
  console.log('缓存条目:', cache.length, '| 取样', sample.length, '条做批量补全测试\n');

  const t0 = Date.now();
  const stat = await ft.enrichBatch(sample, { concurrency: 5, timeout: 9000, budgetMs: 70000 });
  console.log('【批量补全结果】', JSON.stringify(stat), '\n');

  let shown = 0;
  sample.forEach(it => {
    if (!it.fullText || shown >= 5) return;
    shown++;
    console.log('==========================================');
    console.log('标题:', String(it.title || '').slice(0, 70));
    console.log('正文来源:', String(it.source_url || '').slice(0, 85));
    console.log('深度:', it.depth, '|', it.charCount, '字 |', it.paraCount, '段 | 站点:', it.siteName, '| 发布:', String(it.publishedAt || '').slice(0, 19));
    console.log('编号:', ft.makeAlertNo(it));
    console.log('--- 正文前 300 字 ---');
    console.log((it.fullText || '').slice(0, 300).replace(/\n/g, ' '));
    if (it.factSheet) {
      console.log('--- 结构化要素 ---');
      it.factSheet.facts.forEach(f => {
        console.log('  ' + f.icon + ' ' + f.label + ': ' + f.value.slice(0, 70));
        if (f.evidence) console.log('      佐证: ' + f.evidence.slice(0, 100));
      });
    }
    console.log('');
  });

  const noFt = sample.filter(x => !x.fullText);
  console.log('未补全条目', noFt.length, '条（社交页无外链 / 抓取失败 / 原内容已充实）:');
  noFt.slice(0, 8).forEach(x => {
    console.log('  -', String(x.title || '').slice(0, 50), '| url:', String(x.url || '').slice(0, 45), '| ext:', String(x.ext_url || x.extUrl || '(无)').slice(0, 40));
  });
  console.log('\n总耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();
