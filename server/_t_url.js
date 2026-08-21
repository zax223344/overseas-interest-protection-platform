const fs = require('fs');
const cache = JSON.parse(fs.readFileSync('./.cache/osint_intel.json', 'utf8'));
const noUrl = cache.filter(x => !x.url);
const hasUrl = cache.filter(x => x.url);
console.log('总计', cache.length, '| 有URL', hasUrl.length, '| 无URL', noUrl.length, '\n');

const bySrc = {};
noUrl.forEach(x => {
  const s = (x.source || '(无source)') + ' / ' + (x.platform || '') + ' / ' + (x.category || x.data_type || '');
  bySrc[s] = (bySrc[s] || 0) + 1;
});
console.log('=== 无URL条目按来源分布 ===');
Object.keys(bySrc).sort((a, b) => bySrc[b] - bySrc[a]).forEach(k => console.log('  ' + bySrc[k] + ' 条 | ' + k));

console.log('\n=== 无URL样本完整字段 ===');
noUrl.slice(0, 2).forEach(x => {
  console.log('---');
  Object.keys(x).forEach(k => {
    let v = x[k];
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v == null ? '' : v);
    console.log('  ' + k + ': ' + (v.length > 90 ? v.slice(0, 90) + '…' : v));
  });
});
