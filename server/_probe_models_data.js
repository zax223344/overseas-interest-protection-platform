/* 模型数据特征探查：手法/目标/绑架/恐袭/六维分类计数 */
const { query } = require('./db');
(async () => {
  try {
    const U = `(SELECT id, data_type, title, country, severity, event_date, collect_time, data_json, audit_status FROM intel_data UNION ALL SELECT id+1000000, data_type, title, country, severity, event_date, collect_time, data_json, audit_status FROM intel_archive)`;
    // 1. 时间字段可靠性
    const t = await query(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE event_date ~ '^\\d{4}-\\d{2}-\\d{2}') valid_ed,
      COUNT(*) FILTER (WHERE event_date IS NULL OR event_date='' OR event_date !~ '^\\d{4}-\\d{2}-\\d{2}') bad_ed
      FROM ${U} WHERE audit_status='approved'`);
    console.log('== event_date 可靠性 ==', JSON.stringify(t.rows[0]));
    const edrange = await query(`SELECT MIN(event_date) mn, MAX(event_date) mx FROM ${U} WHERE audit_status='approved' AND event_date ~ '^\\d{4}-\\d{2}-\\d{2}'`);
    console.log('== event_date 范围 ==', JSON.stringify(edrange.rows[0]));

    // 2. 绑架关键词命中
    const kid = await query(`SELECT COUNT(*)::int c FROM ${U} WHERE audit_status='approved' AND (title ILIKE '%绑架%' OR title ILIKE '%劫持%' OR title ILIKE '%人质%' OR title ILIKE '%勒索赎金%' OR title ILIKE '%kidnap%' OR title ILIKE '%abduct%' OR title ILIKE '%hostage%' OR data_json->>'title_zh' ILIKE '%绑架%' OR data_json->>'title_zh' ILIKE '%劫持人质%' OR data_json->>'title_zh' ILIKE '%人质%')`);
    console.log('== 绑架类事件 ==', JSON.stringify(kid.rows[0]));
    const kidC = await query(`SELECT COALESCE(NULLIF(country,''),'(空)') k, COUNT(*)::int c FROM ${U} WHERE audit_status='approved' AND (title ILIKE '%绑架%' OR title ILIKE '%劫持%' OR title ILIKE '%人质%' OR title ILIKE '%kidnap%' OR title ILIKE '%abduct%' OR title ILIKE '%hostage%') GROUP BY 1 ORDER BY c DESC LIMIT 15`);
    console.log('== 绑架 top 国家 ==', JSON.stringify(kidC.rows));

    // 3. 恐袭类按国家
    const ter = await query(`SELECT COALESCE(NULLIF(country,''),'(空)') k, COUNT(*)::int c FROM ${U} WHERE audit_status='approved' AND data_type='terror_events' GROUP BY 1 ORDER BY c DESC LIMIT 15`);
    console.log('== 恐袭 top 国家 ==', JSON.stringify(ter.rows));

    // 4. 手法关键词分布（在恐袭类内）
    const mth = [
      ['爆炸', ['爆炸','自杀式','炸弹','bomb','blast','explosion','vbied','ied']],
      ['枪击', ['枪击','开枪','射杀','枪手','shooting','gunmen','shot']],
      ['自杀式', ['自杀式','suicide']],
      ['劫持/绑架', ['绑架','劫持','人质','kidnap','abduct','hostage']],
      ['伏击', ['伏击','埋伏','ambush']],
      ['无人机/导弹/火箭弹', ['无人机','导弹','火箭弹','drone','missile','rocket']],
      ['袭击(其他)', ['袭击','attack']]
    ];
    for (const [name, kws] of mth) {
      const w = kws.map(k => "title ILIKE '%" + k + "%' OR data_json->>'title_zh' ILIKE '%" + k + "%'").join(' OR ');
      const r = await query(`SELECT COUNT(*)::int c FROM ${U} WHERE audit_status='approved' AND data_type='terror_events' AND (${w})`);
      console.log('手法', name, '=', r.rows[0].c);
    }

    // 5. chinaRelated 分布
    const cr = await query(`SELECT data_json->>'chinaRelated' v, COUNT(*)::int c FROM ${U} WHERE audit_status='approved' GROUP BY 1`);
    console.log('== chinaRelated ==', JSON.stringify(cr.rows));

    // 6. 六维分类数据量
    const six = await query(`SELECT data_type, COUNT(*)::int c FROM ${U} WHERE audit_status='approved' AND data_type IN ('terror_events','military_conflicts','sanctions_data','social_unrest','political_events','economic_risk','geopolitical_intel') GROUP BY 1 ORDER BY c DESC`);
    console.log('== 六维可用分类 ==', JSON.stringify(six.rows));

    // 7. title_zh 覆盖率
    const tz = await query(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE COALESCE(data_json->>'title_zh','')<>'') has_tz FROM ${U} WHERE audit_status='approved'`);
    console.log('== title_zh 覆盖 ==', JSON.stringify(tz.rows[0]));

    // 8. digest/content 字段
    const dg = await query(`SELECT COUNT(*)::int has_content FROM ${U} WHERE audit_status='approved' AND COALESCE(data_json->>'content','')<>''`);
    console.log('== content 覆盖 ==', JSON.stringify(dg.rows[0]));
  } catch (e) { console.error('ERR:', e.message); }
  process.exit(0);
})();
