/* 模型功能区开发前侦察：intel_data / intel_archive 真实结构摸底 */
const { query } = require('./db');
(async () => {
  try {
    // 1. schema
    const cols = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='intel_data' ORDER BY ordinal_position`);
    console.log('== intel_data columns ==');
    cols.rows.forEach(r => console.log(r.column_name, '|', r.data_type));

    // 2. counts
    const c1 = await query(`SELECT COUNT(*)::int c, MIN(collect_time) mn, MAX(collect_time) mx FROM intel_data`);
    const c2 = await query(`SELECT COUNT(*)::int c, MIN(collect_time) mn, MAX(collect_time) mx FROM intel_archive`);
    console.log('== intel_data count ==', JSON.stringify(c1.rows[0]));
    console.log('== intel_archive count ==', JSON.stringify(c2.rows[0]));

    // 3. data_type distribution (both tables)
    const dt = await query(`SELECT data_type, COUNT(*)::int c FROM (
      SELECT data_type FROM intel_data UNION ALL SELECT data_type FROM intel_archive) t GROUP BY 1 ORDER BY c DESC`);
    console.log('== data_type distribution (union) ==');
    dt.rows.forEach(r => console.log(r.data_type, r.c));

    // 4. severity + country distribution
    const sev = await query(`SELECT severity, COUNT(*)::int c FROM (SELECT severity FROM intel_data UNION ALL SELECT severity FROM intel_archive) t GROUP BY 1 ORDER BY c DESC`);
    console.log('== severity ==', JSON.stringify(sev.rows));
    const ct = await query(`SELECT COALESCE(NULLIF(country,''),'(空)') k, COUNT(*)::int c FROM (SELECT country FROM intel_data UNION ALL SELECT country FROM intel_archive) t GROUP BY 1 ORDER BY c DESC LIMIT 30`);
    console.log('== country top30 ==');
    ct.rows.forEach(r => console.log(r.k, r.c));

    // 5. event_date availability
    const ed = await query(`SELECT COUNT(*)::int total, COUNT(event_date) has_ed, COUNT(*) FILTER (WHERE event_date IS NOT NULL AND event_date > '2000-01-01') valid_ed FROM (SELECT event_date FROM intel_data UNION ALL SELECT event_date FROM intel_archive) t`);
    console.log('== event_date ==', JSON.stringify(ed.rows[0]));

    // 6. sample data_json
    const s = await query(`SELECT id, data_type, title, country, severity, event_date, collect_time, LEFT(data_json::text, 900) j FROM intel_data ORDER BY id DESC LIMIT 6`);
    console.log('== sample data_json ==');
    s.rows.forEach(r => console.log('---', JSON.stringify(r)));

    // 7. audit_status
    const au = await query(`SELECT audit_status, COUNT(*)::int c FROM (SELECT audit_status FROM intel_data UNION ALL SELECT audit_status FROM intel_archive) t GROUP BY 1`);
    console.log('== audit_status ==', JSON.stringify(au.rows));
  } catch (e) {
    console.error('ERR:', e.message);
  }
  process.exit(0);
})();
