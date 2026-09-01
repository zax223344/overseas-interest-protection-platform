/* ===== 政要人名残留存量清洗（_backfill_names.js）=====
 * 2026-09-02 用户指令："中国国家主席Xi近平"类人名错译残留全系统根治。
 * 做法：不做重译（省配额），直接用 zh-polish.js NAME_FIX 同一规则词典替换（幂等可重跑）：
 *   ① intel_data 存量行：title / description / data_json 内 title_zh·content_zh·content·title·digest·summary
 *   ② 翻译缓存 .translate_cache.json 的值
 * 用法：
 *   node _backfill_names.js          → 默认 dry-run（只统计+打印样例，不改库）
 *   node _backfill_names.js --apply  → 实际执行 UPDATE + 写回缓存文件
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { query, pool } = require('./db.js');
const zhPolish = require('./zh-polish');
const APPLY = process.argv.includes('--apply');
const RE_XI = '(^|[^A-Za-z])Xi([^A-Za-z]|$)';
const out = [];
const w = (s) => { out.push(s); console.log(s); };

/* data_json 内需要清洗的中文字段（title_en/content_en 等英文原文字段不动——fixNames 本身只作用于含中文文本） */
const JSON_FIELDS = ['title_zh', 'content_zh', 'content', 'title', 'digest', 'summary'];

function fixItem(row) {
  const changed = { title: false, description: false, json: false };
  const newTitle = zhPolish.fixNames(row.title || '');
  if (newTitle !== row.title) changed.title = true;
  const newDesc = zhPolish.fixNames(row.description || '');
  if (newDesc !== row.description) changed.description = true;
  let dj = row.data_json;
  if (dj && typeof dj === 'object' && !Array.isArray(dj)) {
    dj = { ...dj };
    for (const f of JSON_FIELDS) {
      if (typeof dj[f] === 'string') {
        const nv = zhPolish.fixNames(dj[f]);
        if (nv !== dj[f]) { dj[f] = nv; changed.json = true; }
      }
    }
  }
  return { newTitle, newDesc, newJson: dj, changed };
}

async function main() {
  w('===== 政要人名存量清洗 ' + (APPLY ? '【APPLY 实模式】' : '【DRY-RUN】') + ' =====');

  /* ---------- ① 翻译缓存 ---------- */
  const CACHE_FILE = path.join(__dirname, '..', '.translate_cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { w('缓存读取失败: ' + e.message); }
  let cacheFixed = 0, cacheXiBefore = 0, cacheXiAfter = 0;
  const cacheSamples = [];
  for (const k of Object.keys(cache)) {
    const v = String(cache[k] || '');
    if (/(^|[^A-Za-z])Xi([^A-Za-z]|$)/.test(v)) cacheXiBefore++;
    const nv = zhPolish.fixNames(v);
    if (nv !== v) {
      cacheFixed++;
      if (cacheSamples.length < 6) cacheSamples.push([k, v, nv]);
      if (APPLY) cache[k] = nv;
    }
    if (/(^|[^A-Za-z])Xi([^A-Za-z]|$)/.test(nv)) cacheXiAfter++;
  }
  w('--- 翻译缓存 .translate_cache.json：共 ' + Object.keys(cache).length + ' 条');
  w('    Xi 残留（修前→修后）: ' + cacheXiBefore + ' → ' + cacheXiAfter + '；词典修正总条数: ' + cacheFixed);
  cacheSamples.forEach(([k, v, nv]) => w('    样例: ' + JSON.stringify(v.slice(0, 55)) + ' → ' + JSON.stringify(nv.slice(0, 55))));
  if (APPLY && cacheFixed) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    w('    已写回缓存文件');
  }

  /* ---------- ② intel_data 存量行 ---------- */
  const sel = await query(`
    SELECT id, title, description, data_json FROM intel_data
    WHERE title ~ $1 OR description ~ $1
       OR data_json->>'title_zh' ~ $1 OR data_json->>'content_zh' ~ $1
       OR data_json->>'content' ~ $1 OR data_json->>'digest' ~ $1 OR data_json->>'summary' ~ $1
    OR data_json->>'title_zh' ~ 'Jinping|Trump|Putin|Modi|Biden|Macron|Zelensky|Zelenskyy|Kim Jong'
    OR title ~ 'Jinping|Trump|Putin|Modi|Biden|Macron|Zelensky|Zelenskyy|Kim Jong'`,
    [RE_XI]);
  const rows = sel.rows;
  /* "思思"谐音错译（Xi 音译残留）一并选中，由词表极窄规则修正 */
  const selSisi = await query(`SELECT id, title, description, data_json FROM intel_data WHERE title ~ '思思' OR description ~ '思思' OR data_json->>'title_zh' ~ '思思' OR data_json->>'content_zh' ~ '思思'`);
  rows.push(...selSisi.rows.filter(r => !rows.some(x => x.id === r.id)));
  w('--- intel_data 命中行: ' + rows.length + ' 条');
  let rowFixed = 0, rowSkip = 0, fieldFixed = 0;
  const fixSamples = [];
  const leftovers = [];
  for (const r of rows) {
    const { newTitle, newDesc, newJson, changed } = fixItem(r);
    if (changed.title || changed.description || changed.json) {
      rowFixed++;
      fieldFixed += (changed.title ? 1 : 0) + (changed.description ? 1 : 0) + (changed.json ? 1 : 0);
      if (fixSamples.length < 10) fixSamples.push('  [' + r.id + '] ' + JSON.stringify(String(r.title).slice(0, 60)) + ' → ' + JSON.stringify(String(newTitle).slice(0, 60)));
      if (APPLY) {
        await query(`UPDATE intel_data SET title=$2, description=$3, data_json=$4, updated_at=now() WHERE id=$1`,
          [r.id, newTitle, newDesc, JSON.stringify(newJson)]);
      }
    } else {
      rowSkip++;
      if (leftovers.length < 15) leftovers.push('  [' + r.id + '] ' + String(r.title).slice(0, 75));
    }
  }
  w('    修正行数: ' + rowFixed + '（字段级修正 ' + fieldFixed + ' 处）；规则未覆盖残留: ' + rowSkip + ' 行');
  w('    修正样例:');
  fixSamples.forEach(s => w(s));
  if (rowSkip) { w('    ⚠ 未覆盖残留行（保守规则不动的，需人工/后续通道处理）:'); leftovers.forEach(s => w(s)); }

  /* ---------- ③ 复查 ---------- */
  const chk = await query(`
    SELECT
      (SELECT count(*) FROM intel_data WHERE title ~ $1) title_xi,
      (SELECT count(*) FROM intel_data WHERE description ~ $1) desc_xi,
      (SELECT count(*) FROM intel_data WHERE data_json->>'title_zh' ~ $1) tj_xi,
      (SELECT count(*) FROM intel_data WHERE data_json->>'content_zh' ~ $1) cj_xi,
      (SELECT count(*) FROM intel_data WHERE title ~ 'Jinping|Trump|Putin|Modi|Biden|Macron|Zelensky|Zelenskyy|Kim Jong' OR data_json->>'title_zh' ~ 'Jinping|Trump|Putin|Modi|Biden|Macron|Zelensky|Zelenskyy|Kim Jong') other_names`,
    [RE_XI]);
  const c2 = chk.rows[0];
  w('--- 复查（' + (APPLY ? '清洗后' : '当前（dry-run 未改）') + '）: title_xi=' + c2.title_xi + ' desc_xi=' + c2.desc_xi
    + ' title_zh_xi=' + c2.tj_xi + ' content_zh_xi=' + c2.cj_xi + ' 其他政要残留=' + c2.other_names);

  fs.writeFileSync(path.join(__dirname, '_backfill_names_out.txt'), out.join('\n'), 'utf8');
  await pool.end();
  process.exit(0);
}
main().catch(async (e) => { w('ERROR: ' + e.message); fs.writeFileSync(path.join(__dirname, '_backfill_names_out.txt'), out.join('\n') + '\nERROR: ' + e.message + '\n' + (e.stack || ''), 'utf8'); try { await pool.end(); } catch (e2) {} process.exit(1); });
