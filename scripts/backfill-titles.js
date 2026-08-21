/**
 * 原地补全历史残缺标题（保留状态、只重写标题）
 * 扫描近 N 天内标题要素不全的 intel_data 记录，调用 server.js 同源的 _completeTitle 补全后写回。
 */
const path = require('path');
const fs = require('fs');
const { query } = require(path.join(__dirname, '../server/db.js'));

// 从 server.js 提取 _completeTitle 及依赖
const serverPath = path.join(__dirname, '../server/server.js');
const serverSrc = fs.readFileSync(serverPath, 'utf8');
const blockMatch = serverSrc.match(/const _TITLE_CORE_PLACES =[\s\S]*?function _completeTitle\(it\) \{[\s\S]*?\n\}/);
if (!blockMatch) {
  console.error('无法从 server.js 提取标题补全函数');
  process.exit(1);
}
const qmMatch = serverSrc.match(/function _isTitleQualityOk\(it\) \{[\s\S]*?\n\}/);
const evalBlock = blockMatch[0] + (qmMatch ? '\n' + qmMatch[0] : '');
eval(evalBlock);

// 判断是否需要补全：长度不足、来自...称、末尾截断、纯地名
function needsComplete(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (t.length < 12) return true;
  if (/[是为系，；:：]$/i.test(t)) return true;
  if (/^(?:来自|据|由)[^，。]+(?:称|表示|说|claim|said|says|told|announced)/i.test(t)) return true;
  return false;
}

async function backfill() {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  since.setHours(0, 0, 0, 0);

  const { rows } = await query(
    `SELECT id, title, data_json 
     FROM intel_data 
     WHERE collect_time >= $1 
       AND (length(title) < 12 
            OR title ~* '^来自.*称'
            OR title ~* '.*[是为系，；:：]$'
            OR title ~* '^瓜达尔|^哈达监狱|^俾路支|^奎达|^白沙瓦|^喀布尔'
           )
     ORDER BY id DESC`,
    [since.toISOString()]
  );

  console.log(`扫描到 ${rows.length} 条候选记录`);
  let updated = 0;
  const changedIds = [];
  const oldToNew = [];

  for (const row of rows) {
    const j = row.data_json || {};
    const oldTitle = String(row.title || '');
    const it = {
      title: oldTitle,
      title_zh: j.title_zh || '',
      content: j.content || j.content_zh || j.description || row.description || ''
    };

    if (!needsComplete(oldTitle)) continue;

    _completeTitle(it);
    const newTitle = it.title_zh || it.title;

    if (!newTitle || newTitle === oldTitle) continue;

    // 质量闸二次校验
    if (!_isTitleQualityOk({ title: newTitle, title_zh: it.title_zh })) {
      console.log(`[SKIP] id=${row.id} 补全后仍不合格: ${newTitle}`);
      continue;
    }

    j.title = it.title;
    j.title_zh = it.title_zh;
    if (it.title_en && !j.title_en) j.title_en = it.title_en;

    await query(
      `UPDATE intel_data SET title=$1, data_json=$2::jsonb WHERE id=$3`,
      [it.title, JSON.stringify(j), row.id]
    );

    updated++;
    changedIds.push(row.id);
    oldToNew.push({ id: row.id, old: oldTitle, new: newTitle });
    console.log(`[UPDATED] id=${row.id}`);
    console.log(`  OLD: ${oldTitle}`);
    console.log(`  NEW: ${newTitle}`);
  }

  // 同步 datahub_store alerts
  if (updated > 0) {
    const dh = await query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
    if (dh.rows.length && Array.isArray(dh.rows[0].data_json)) {
      const alerts = dh.rows[0].data_json;
      let syncN = 0;
      for (const a of alerts) {
        const aid = String(a.id || '');
        const match = oldToNew.find(x => aid.endsWith(String(x.id)) || aid === String(x.id));
        if (match && (a.title === match.old || a.title_zh === match.old)) {
          a.title = match.new;
          a.title_zh = match.new;
          syncN++;
        }
      }
      if (syncN > 0) {
        await query(
          `UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2`,
          [JSON.stringify(alerts), 'alerts']
        );
        console.log(`同步 alerts 缓存 ${syncN} 条`);
      }
    }
  }

  console.log(`完成：共更新 ${updated} 条`);
  process.exit(0);
}

backfill().catch(err => {
  console.error('脚本失败:', err);
  process.exit(1);
});
