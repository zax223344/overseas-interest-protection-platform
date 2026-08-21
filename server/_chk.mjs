import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync('./.cache/osint_intel.json', 'utf8'));
const kw = ['社会主义', '工人阶级', '革命', '丝绸之路制造业', '全球化', '民族团结', '人为的愤怒'];
a.forEach((x, i) => {
  const t = String(x.title || '');
  if (kw.some(k => t.includes(k))) {
    console.log('=== #' + i + ' ===');
    console.log('title   :', t.slice(0, 50));
    console.log('title_en:', String(x.title_en || '(无)').slice(0, 60));
    console.log('source  :', x.source, '| country:', x.country, '| link:', String(x.link || '').slice(0, 55));
    console.log('interestLinked:', x.interestLinked, '| chinaNegative:', x.chinaNegative);
    console.log('matched :', JSON.stringify(x.matchedKeywords || x._matched || x.keywords || '(无)').slice(0, 120));
    console.log('affected:', x.affectedPeople, '| assets:', x.affectedAssets);
    console.log('');
  }
});
console.log('缓存总数:', a.length);
