const { query } = require('C:/Users/28737/Desktop/新建文件夹/server/db.js');
const fs = require('fs');
const serverSrc = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/server/server.js', 'utf8');
const blockMatch = serverSrc.match(/const _TITLE_CORE_PLACES =[\s\S]*?function _completeTitle\(it\) \{[\s\S]*?\n\}/);
eval(blockMatch[0]);

async function run() {
  const { rows } = await query('SELECT id, title, data_json FROM intel_data WHERE id IN (21400, 21224, 21161, 21067, 19183, 16116)');
  for (const row of rows) {
    const j = row.data_json || {};
    const oldTitle = String(row.title || '');
    const it = {
      title: oldTitle,
      title_zh: j.title_zh || '',
      content: j.content || j.content_zh || j.description || row.description || ''
    };
    console.log('--- id', row.id, 'incomplete?', _titleLooksIncomplete(oldTitle));
    _completeTitle(it);
    const newTitle = it.title_zh || it.title;
    console.log('OLD:', oldTitle);
    console.log('NEW:', newTitle);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
