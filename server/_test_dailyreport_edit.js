/* 编辑流程接口测试：PUT 保存 → 冲突 409 → force 重生成 → DELETE 撤销 */
const fs = require('fs');
const BASE = 'http://localhost:3000';
const TOK = fs.readFileSync(__dirname + '/_tok.txt', 'utf8').trim();
const DATE = process.argv[2] || '2026-08-30';

async function j(method, path, body, auth) {
  const r = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth ? { Authorization: 'Bearer ' + TOK } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let d = null;
  try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

(async () => {
  /* 1. 获取基准 */
  let g = await j('GET', '/api/reports/daily/' + DATE);
  if (g.status !== 200) { console.log('FAIL get:', g.status, g.d); process.exit(1); }
  const items = g.d.items, sections = g.d.sections;
  console.log('1 base: items=' + items.length + ' red节=' + sections[0].items.length);

  /* 2. 无 token PUT 应 401 */
  let r = await j('PUT', '/api/reports/daily/' + DATE, { items, sections });
  console.log('2 no-auth PUT status=' + r.status + ' (expect 401)');

  /* 3. PUT 编辑：删掉红色节最后一条 + 改第一条标题 + 调换前两条顺序 */
  const red = sections[0];
  const editedItems = items.map(x => Object.assign({}, x));
  const firstIdx = red.items[0];
  editedItems[firstIdx].title = '【人工修订】' + editedItems[firstIdx].title;
  const newRed = red.items.slice(0, -1);
  if (newRed.length >= 2) { const tmp = newRed[0]; newRed[0] = newRed[1]; newRed[1] = tmp; }
  const editedSections = sections.map(s => Object.assign({}, s, s.key === 'red' ? { items: newRed } : {}));
  r = await j('PUT', '/api/reports/daily/' + DATE, { items: editedItems, sections: editedSections, note: '接口测试编辑' }, true);
  console.log('3 PUT status=' + r.status, JSON.stringify(r.d));

  /* 4. GET 校验 manual_edit/edited/html 重渲染 */
  g = await j('GET', '/api/reports/daily/' + DATE);
  console.log('4 manual_edit=' + g.d.manual_edit + ' edited.items=' + g.d.edited.items.length + ' revision=' + g.d.revision.length + ' html含人工修订=' + (g.d.html.indexOf('【人工修订】') >= 0) + ' gov含人工修订=' + (g.d.gov_html.indexOf('【人工修订】') >= 0));

  /* 5. 重生成应 409 */
  r = await j('POST', '/api/reports/daily/generate', { date: DATE });
  console.log('5 regen-no-force status=' + r.status + ' (expect 409) msg=' + (r.d && r.d.error || '').slice(0, 30));

  /* 6. DELETE 撤销 → 恢复基准 */
  r = await j('DELETE', '/api/reports/daily/' + DATE + '/edits', null, true);
  console.log('6 revert status=' + r.status, JSON.stringify(r.d));
  g = await j('GET', '/api/reports/daily/' + DATE);
  console.log('  after revert: manual_edit=' + g.d.manual_edit + ' edited=' + !!g.d.edited + ' revision=' + g.d.revision.length + ' html含人工修订=' + (g.d.html.indexOf('【人工修订】') >= 0));

  /* 7. force 重生成路径（先 PUT 制造 manual_edit） */
  r = await j('PUT', '/api/reports/daily/' + DATE, { items: editedItems, sections: editedSections, note: 'force 测试' }, true);
  r = await j('POST', '/api/reports/daily/generate', { date: DATE, force: true });
  console.log('7 force regen status=' + r.status, JSON.stringify(r.d));
  g = await j('GET', '/api/reports/daily/' + DATE);
  console.log('  after force: manual_edit=' + g.d.manual_edit + ' edited=' + !!g.d.edited + ' revision=' + g.d.revision.length + ' items=' + g.d.items.length);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
