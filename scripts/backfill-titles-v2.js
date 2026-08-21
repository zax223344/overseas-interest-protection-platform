/**
 * 原地补全历史残缺标题 v2（严格版）
 * 只处理明确残缺的标题：纯地名、来自X称...是截断、末尾是/为/系截断、长度<12。
 * 同时修复 title_zh 被截断但与 title 不同步的损坏记录（保留 title，重写 title_zh）。
 */
const { query } = require('C:/Users/28737/Desktop/新建文件夹/server/db.js');
const path = require('path');
const fs = require('fs');

const serverPath = path.join(__dirname, '../server/server.js');
const serverSrc = fs.readFileSync(serverPath, 'utf8');

/* 从 server.js 稳健提取 _completeTitle 及其依赖（常量 + _titleLooksIncomplete）
 * 策略：从 _TITLE_CORE_PLACES 常量开始，到 _isTitleQualityOk 函数定义之前结束。 */
function extractCompletionBlock(src) {
  const start = src.indexOf('const _TITLE_CORE_PLACES');
  if (start < 0) throw new Error('找不到 _TITLE_CORE_PLACES');
  const end = src.indexOf('function _isTitleQualityOk', start);
  if (end < 0) throw new Error('找不到 _isTitleQualityOk 边界');
  return src.substring(start, end).trimEnd();
}

eval(extractCompletionBlock(serverSrc));

const DRY_RUN = process.argv.includes('--dry-run');
const SINCE_DAYS = parseInt(process.argv.find(a => /^--days=\d+$/.test(a))?.split('=')[1] || '7', 10);

/* 常见以“是/为/系”结尾的完整词，避免把完整标题误判为截断。 */
const _COMPLETE_ENDINGS = /(?:行为|作为|认为|成为|尤为|因为|为什么|难为|为了|为止|为生|为期|为首|为数|为时|为准|关系|联系|体系|系统|系列|维系|星系|水系|谱系|语系|世系|嫡系|派系|旁系|直系|姻系)$/i;

function needsComplete(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (t.length < 12) return true;
  if (/[是为，；:：]$/i.test(t) && !_COMPLETE_ENDINGS.test(t)) return true;
  if (/系$/i.test(t) && !_COMPLETE_ENDINGS.test(t)) return true;
  if (/^(?:来自|据|由)[^，。]+(?:称|表示|说|claim|said|says|told|announced)/i.test(t)) return true;
  return false;
}

/* 判断 title 是否属于“可补全的残缺”：
 * 末尾是/为（且不是完整词的一部分）/来自...称结构/长度过短。
 * 末尾仅为逗号/分号/冒号的，虽然也算不完整，但补全函数目前无法可靠重构，本次先跳过。
 * “系”单独作为截断极为罕见且极易把“关系/联系/体系”误判，因此不单独作为标志。 */
function isReconstructableIncomplete(title) {
  const t = String(title || '').trim();
  if (t.length < 12) return true;
  if (/^(?:来自|据|由)[^，。]+(?:称|表示|说|claim|said|says|told|announced)/i.test(t)) return true;
  if (/(?:是|为)$/i.test(t) && !_COMPLETE_ENDINGS.test(t)) return true;
  return false;
}

function isChineseDominant(s) {
  const t = String(s || '');
  const cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  return cn >= 6 && cn * 2 >= t.length;
}

async function backfill() {
  const since = new Date();
  since.setDate(since.getDate() - SINCE_DAYS);
  since.setHours(0, 0, 0, 0);

  const { rows } = await query(
    `SELECT id, title, data_json
     FROM intel_data
     WHERE collect_time >= $1 AND audit_status='approved'
       AND (length(title) < 12
            OR title ~* '^来自.*称|^据.*称'
            OR title ~* '[是为，；:：]$'
            OR (data_json->>'title_zh') IS NOT NULL
                AND (length(data_json->>'title_zh') < 12
                     OR (data_json->>'title_zh') ~* '[是为，；:：]$'
                     OR (data_json->>'title_zh') <> title)
           )
     ORDER BY id DESC`,
    [since.toISOString()]
  );

  console.log(`扫描到 ${rows.length} 条候选记录，范围近 ${SINCE_DAYS} 天，${DRY_RUN ? '试运行不修改' : '开始更新'}`);
  let updated = 0;
  const oldToNew = [];

  for (const row of rows) {
    const j = row.data_json || {};
    const title = String(row.title || '');
    const titleZh = String(j.title_zh || '');
    const content = String(j.content || j.content_zh || j.description || row.description || '');

    const tInc = needsComplete(title);
    const tzInc = needsComplete(titleZh);
    const tReconstructable = isReconstructableIncomplete(title);
    const tzReconstructable = isReconstructableIncomplete(titleZh);
    const tzIsPrefixOfTitle = titleZh && title.startsWith(titleZh);
    const titleIsChinese = isChineseDominant(title);

    let willUpdate = false;
    let updateTitle = title;
    let updateTitleZh = titleZh;
    let newTitle = '';

    if (!tInc && tzInc && titleZh) {
      /* title 完好，title_zh 残缺：把 title_zh 同步为 title */
      updateTitleZh = title;
      willUpdate = true;
      newTitle = title;
    } else if (tReconstructable && !tzInc && titleZh && !tzIsPrefixOfTitle) {
      /* title 属于可补全残缺，title_zh 完好，且 title_zh 不是 title 的简单截断：把 title 同步为 title_zh */
      updateTitle = titleZh;
      willUpdate = true;
      newTitle = titleZh;
    } else if (!tInc && titleZh && titleZh !== title && titleZh.length < title.length && titleIsChinese) {
      /* title 是完整中文，title_zh 更短且不一致：本系统 title/title_zh 通常为同一中文文本，
       * 若 title_zh 被截断/损坏，则同步修复。 */
      updateTitleZh = title;
      willUpdate = true;
      newTitle = title;
    } else if (tReconstructable && tzReconstructable) {
      /* 两者都可补全残缺：选较长者作为源，调用 _completeTitle 补全；
       * 若补全函数也提不出更好结果，则宁可不动，避免把两个坏标题互相污染。 */
      const source = titleZh.length > title.length ? titleZh : title;
      const it = { title: source, title_zh: '', content };
      _completeTitle(it);
      newTitle = it.title_zh || it.title;
      if (newTitle && newTitle !== source) {
        updateTitle = newTitle;
        updateTitleZh = newTitle;
        willUpdate = true;
      }
    }

    if (!willUpdate) continue;

    updated++;
    oldToNew.push({ id: row.id, old: title, new: updateTitle });
    console.log(`[${DRY_RUN ? 'DRY' : 'UPDATED'}] id=${row.id}`);
    console.log(`  OLD title: ${title}`);
    if (titleZh) console.log(`  OLD zh  : ${titleZh}`);
    console.log(`  NEW title: ${updateTitle}`);
    if (titleZh) console.log(`  NEW zh   : ${updateTitleZh}`);

    if (!DRY_RUN) {
      j.title = updateTitle;
      j.title_zh = updateTitleZh;
      await query(
        `UPDATE intel_data SET title=$1, data_json=$2::jsonb WHERE id=$3`,
        [updateTitle, JSON.stringify(j), row.id]
      );
    }
  }

  console.log(`\n${DRY_RUN ? '试运行' : '完成'}：${updated} 条`);

  if (!DRY_RUN && updated > 0) {
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
  process.exit(0);
}

backfill().catch(err => {
  console.error('脚本失败:', err);
  process.exit(1);
});
