/* 存量未译条目补译：查 _untranslated=true → POST /api/translate → UPDATE title_zh */
const { query } = require('./db.js');
const BASE = 'http://127.0.0.1:3000';
(async () => {
  const _res = await query(`SELECT id, title AS title FROM intel_data WHERE data_json->>'_untranslated' = 'true' ORDER BY id`); const rows = _res.rows;
  console.log('待补译:', rows.length, '条');
  let ok = 0, fail = 0;
  for (const r of rows) {
    const t = String(r.title || '').trim();
    if (!t || /[\u4e00-\u9fa5]/.test(t)) { // 已含中文的跳过
      await query(`UPDATE intel_data SET data_json = data_json - '_untranslated' WHERE id = $1`, [r.id]);
      continue;
    }
    try {
      const res = await fetch(BASE + '/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t.slice(0, 500) }),
        signal: AbortSignal.timeout(45000)
      });
      const j = await res.json();
      const zh = (j && j.results && j.results[0]) || '';
      if (zh && /[\u4e00-\u9fa5]/.test(zh) && zh !== t) {
        await query(`UPDATE intel_data
          SET data_json = jsonb_set(data_json - '_untranslated', '{title_zh}', to_jsonb($2::text))
          WHERE id = $1`, [r.id, zh]);
        ok++;
        console.log('  OK #' + r.id + ': ' + zh.slice(0, 40));
      } else { fail++; console.log('  FAIL #' + r.id + ' (' + (j && j.engine) + ')'); }
    } catch (e) { fail++; console.log('  ERR #' + r.id + ': ' + e.message); }
    await new Promise(s => setTimeout(s, 300));
  }
  console.log('完成: 成功 ' + ok + ' / 失败 ' + fail);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
