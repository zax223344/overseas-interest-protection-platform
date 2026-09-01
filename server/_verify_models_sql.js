/* 模型验证 v2：API 数字 vs 真实 SQL 直查（口径与 server/models-analysis.js 完全一致）
 * 模型口径：
 *   - 两库 UNION，audit_status='approved'
 *   - title = COALESCE(NULLIF(data_json->>'title_zh',''), title)
 *   - content = LEFT(data_json->>'content', 500)
 *   - KIDNAP_RE = /绑架|劫持|人质|勒索赎金|kidnap|abduct|hostage/i （title OR content）
 */
const { query } = require('./db');
const RE = '(绑架|劫持|人质|勒索赎金|kidnap|abduct|hostage)';

(async () => {
  try {
    // 1. approved 总数（模型 loadEvents 输入量；API totalEvents 再剔 t<=0）
    const tot = await query(`SELECT COUNT(*)::int c FROM (
      SELECT audit_status FROM intel_data WHERE audit_status='approved'
      UNION ALL SELECT audit_status FROM intel_archive WHERE audit_status='approved') t`);
    console.log('[SQL] approved 总量 =', tot.rows[0].c, '| API overview.totalEvents = 10853（差值 = collect_time 无效被 t>0 剔除）');

    // 2. 绑架总数（题名或正文前 500 字符，正则同 KIDNAP_RE）
    const kn = await query(`SELECT COUNT(*)::int c FROM (
      SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title,
             LEFT(COALESCE(data_json->>'content',''), 500) AS content
      FROM intel_data WHERE audit_status='approved'
      UNION ALL
      SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title),
             LEFT(COALESCE(data_json->>'content',''), 500)
      FROM intel_archive WHERE audit_status='approved') t
      WHERE title ~* '${RE}' OR content ~* '${RE}'`);
    console.log('[SQL] 绑架命中（模型同口径） =', kn.rows[0].c, '| API kidnap.total = 508');

    // 3. 绑架·尼日利亚
    const knNg = await query(`SELECT COUNT(*)::int c FROM (
      SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title, country,
             LEFT(COALESCE(data_json->>'content',''), 500) AS content
      FROM intel_data WHERE audit_status='approved'
      UNION ALL
      SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title), country,
             LEFT(COALESCE(data_json->>'content',''), 500)
      FROM intel_archive WHERE audit_status='approved') t
      WHERE country='尼日利亚' AND (title ~* '${RE}' OR content ~* '${RE}')`);
    console.log('[SQL] 尼日利亚绑架（模型同口径） =', knNg.rows[0].c, '| API density 尼日利亚 = 295');

    // 4. 巴基斯坦 terror_events（approved）
    const pk = await query(`SELECT COUNT(*)::int c FROM (
      SELECT data_type, country, collect_time, event_date FROM intel_data WHERE audit_status='approved'
      UNION ALL SELECT data_type, country, collect_time, event_date FROM intel_archive WHERE audit_status='approved') t
      WHERE data_type='terror_events' AND country='巴基斯坦'`);
    console.log('[SQL] 巴基斯坦 terror_events（approved） =', pk.rows[0].c, '| API hawkes count = 409（差值 = 无效时间剔除）');

    // 5. chinaRelated（approved + 'true'）
    const cr = await query(`SELECT COUNT(*)::int c FROM (
      SELECT data_json FROM intel_data WHERE audit_status='approved'
      UNION ALL SELECT data_json FROM intel_archive WHERE audit_status='approved') t
      WHERE data_json->>'chinaRelated' = 'true'`);
    console.log('[SQL] chinaRelated=true（approved） =', cr.rows[0].c, '| API overview.chinaRelated = 1096');

    // 6. 塔利班：题名或正文前 500 字符含 塔利班/taliban（不区分大小写）
    const tb = await query(`SELECT COUNT(*)::int c FROM (
      SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title,
             LEFT(COALESCE(data_json->>'content',''), 500) AS content
      FROM intel_data WHERE audit_status='approved'
      UNION ALL
      SELECT COALESCE(NULLIF(data_json->>'title_zh',''), title),
             LEFT(COALESCE(data_json->>'content',''), 500)
      FROM intel_archive WHERE audit_status='approved') t
      WHERE title ~* '(塔利班|taliban)' OR content ~* '(塔利班|taliban)'`);
    console.log('[SQL] 塔利班命中（模型同口径） =', tb.rows[0].c, '| API orgs 塔利班 = 166');

    // 7. geo 六维·巴基斯坦（approved）
    const geoPk = await query(`SELECT
      COUNT(*) FILTER (WHERE data_type='political_events')::int pol,
      COUNT(*) FILTER (WHERE data_type='economic_risk')::int econ,
      COUNT(*) FILTER (WHERE data_type='social_unrest')::int soc,
      COUNT(*) FILTER (WHERE data_type IN ('terror_events','military_conflicts'))::int sec,
      COUNT(*) FILTER (WHERE data_type='sanctions_data')::int sanc,
      COUNT(*) FILTER (WHERE data_json->>'chinaRelated'='true')::int cn
      FROM (
        SELECT data_type, data_json, country FROM intel_data WHERE audit_status='approved'
        UNION ALL SELECT data_type, data_json, country FROM intel_archive WHERE audit_status='approved') t
      WHERE country='巴基斯坦'`);
    console.log('[SQL] 巴基斯坦六维原始计数 =', JSON.stringify(geoPk.rows[0]));
    process.exit(0);
  } catch (e) {
    console.error('VERIFY_FAIL:', e.message);
    process.exit(1);
  }
})();
