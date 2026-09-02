/* 存量未译条目补译：_untranslated=true → POST /api/translate → UPDATE title_zh/title
 * 2026-09-03 扩展（翻译审计正文闭环）：
 *  ① 覆盖 _untranslated_body=true 的条目正文 → 补译 content_zh（此前只管 title_zh，
 *     库里 587 条英文正文漏标漏回填）；
 *  ② 标题补译同时回写 DB title 列（旧版只写 data_json.title_zh，title 列永远英文）；
 *  ③ 依赖 /api/translate 已修复的"原始下标对齐"（2026-09-03 错位根治），成对 [标题,正文]
 *     批量请求按位取值不再串写。 */
const { query } = require('./db.js');
const BASE = 'http://127.0.0.1:3000';
(async () => {
  const _res = await query(
    `SELECT id, title, data_json FROM intel_data
     WHERE data_json->>'_untranslated' = 'true' OR data_json->>'_untranslated_body' = 'true'
     ORDER BY id`);
  const rows = _res.rows;
  console.log('待补译:', rows.length, '条');
  let ok = 0, okBody = 0, fail = 0;
  for (const r of rows) {
    const dj = r.data_json || {};
    const needTitle = dj._untranslated === true && !/[\u4e00-\u9fa5]/.test(String(r.title || ''));
    const cSrc = String(dj.content_en || dj.content || '').slice(0, 6000).trim();
    const needBody = dj._untranslated_body === true && cSrc && !/[\u4e00-\u9fa5]/.test(cSrc.slice(0, 200));
    if (!needTitle && !needBody) {
      /* 无可译字段：清掉残留标记（如标题已被人工改中文但标记未除） */
      await query(`UPDATE intel_data SET data_json = data_json - '_untranslated' - '_untranslated_body' WHERE id = $1`, [r.id]);
      continue;
    }
    try {
      /* 成对请求：[标题, 正文]；服务端已按原始下标对齐返回，空槽返回空串 */
      const texts = [needTitle ? String(r.title || '').trim().slice(0, 500) : '', needBody ? cSrc : ''];
      const res = await fetch(BASE + '/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(45000)
      });
      const j = await res.json();
      const zhTitle = (j && j.results && j.results[0]) || '';
      const zhBody = (j && j.results && j.results[1]) || '';
      let ndj = dj; let wrote = false;
      if (needTitle && zhTitle && /[\u4e00-\u9fa5]/.test(zhTitle) && zhTitle !== String(r.title || '').trim()) {
        ndj = Object.assign({}, ndj, {
          title_en: ndj.title_en || r.title,
          title_zh: zhTitle,
          translated: true
        });
        delete ndj._untranslated;
        await query(
          `UPDATE intel_data SET title = $2, data_json = $3 WHERE id = $1`,
          [r.id, zhTitle, JSON.stringify(ndj)]);
        ok++;
        console.log('  OK #' + r.id + ' title: ' + zhTitle.slice(0, 40));
        wrote = true;
      }
      if (needBody && zhBody && /[\u4e00-\u9fa5]/.test(zhBody) && zhBody !== cSrc) {
        const ndj2 = Object.assign({}, ndj, {
          content_en: ndj.content_en || dj.content,
          content: zhBody,
          content_zh: zhBody,
          translated: true
        });
        delete ndj2._untranslated_body;
        await query(
          `UPDATE intel_data SET data_json = $2 WHERE id = $1`,
          [r.id, JSON.stringify(ndj2)]);
        okBody++;
        console.log('  OK #' + r.id + ' body: ' + zhBody.slice(0, 40));
        wrote = true;
      }
      if (!wrote) { fail++; console.log('  FAIL #' + r.id + ' (' + (j && j.engine) + ')'); }
    } catch (e) { fail++; console.log('  ERR #' + r.id + ': ' + e.message); }
    await new Promise(s => setTimeout(s, 300));
  }
  console.log('完成: 标题成功 ' + ok + ' / 正文成功 ' + okBody + ' / 失败 ' + fail);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
