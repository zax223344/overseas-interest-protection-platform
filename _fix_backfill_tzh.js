/* Task #465 修复4：存量中文标题 title_zh 回填
 * 审计实测：近7天 200 条无中文标题，主因是中文源（中新网/新华社/公众号镜像）
 * 标题本就是中文，_looksForeign=false 跳过翻译 → title_zh 永远为空。
 * 增量已在 _translateListToZhParallel 收口，本脚本补存量（CJK 主体且非外文主体）。 */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

(async () => {
  /* 判定与 _looksForeign 同口径：CJK>0 且 CJK*4 >= 拉丁字符数（中文主体），且无其他外文脚本 */
  const ZH_DOMINANT = `length(regexp_replace(title, '[^一-龥]', '', 'g')) > 0
    AND length(regexp_replace(title, '[^一-龥]', '', 'g')) * 4 >= length(regexp_replace(title, '[^A-Za-z]', '', 'g'))
    AND title !~ '[ kokak :]'`.replace('[ kokak :]', '[\\u0400-\\u04FF\\u0600-\\u06FF\\u0900-\\u097F\\u0980-\\u09FF\\u0E00-\\u0E7F\\u1200-\\u137F\\u0590-\\u05FF\\u3040-\\u30FF\\uAC00-\\uD7AF]');

  for (const tbl of ['intel_data', 'intel_archive']) {
    const r = await pool.query(
      `UPDATE ${tbl} SET data_json = jsonb_set(COALESCE(data_json, '{}'::jsonb), '{title_zh}', to_jsonb(title))
       WHERE COALESCE(data_json->>'title_zh', '') = '' AND ${ZH_DOMINANT}`);
    console.log(`${tbl}: 回填 ${r.rowCount} 条`);
  }
  /* intel_sidepool 有独立 title_zh 真实列 */
  const sp = await pool.query(`UPDATE intel_sidepool SET title_zh = title
    WHERE COALESCE(title_zh, '') = '' AND ${ZH_DOMINANT}`);
  console.log(`intel_sidepool: 回填 ${sp.rowCount} 条`);

  /* 验证：三表无中文标题剩余量（按同一判定口径） */
  for (const tbl of ['intel_data', 'intel_archive']) {
    const v = await pool.query(`SELECT COUNT(*)::int n FROM ${tbl}
      WHERE COALESCE(data_json->>'title_zh','') = '' AND title ~ '[一-龥]'`);
    console.log(`${tbl} 残余(title_zh空且title含中文): ${v.rows[0].n}`);
  }
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
