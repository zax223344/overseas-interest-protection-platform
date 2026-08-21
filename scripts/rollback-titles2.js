/**
 * 回滚第二批被模板化补全的标题：恢复到 title_en
 */
const { query } = require('C:/Users/28737/Desktop/新建文件夹/server/db.js');

async function rollback() {
  const { rows } = await query(
    `SELECT id, title, data_json FROM intel_data WHERE data_json->>'title_zh' ~ $1`,
    ['事件引关注|海外发生']
  );

  console.log(`发现 ${rows.length} 条需要回滚的记录`);
  let restored = 0;

  for (const row of rows) {
    const j = row.data_json || {};
    const original = j.title_en || j.title || row.title;
    if (!original || original === row.title) continue;

    j.title = original;
    j.title_zh = original;

    await query(
      `UPDATE intel_data SET title=$1, data_json=$2::jsonb WHERE id=$3`,
      [original, JSON.stringify(j), row.id]
    );
    restored++;
    console.log(`[RESTORED] id=${row.id}: ${row.title} -> ${original.slice(0, 60)}`);
  }

  console.log(`完成：回滚 ${restored} 条`);
  process.exit(0);
}

rollback().catch(err => {
  console.error('回滚失败:', err);
  process.exit(1);
});
