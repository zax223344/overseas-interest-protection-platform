const { query } = require('./db.js');
(async () => {
  // threatroom 近24h 的采集查询词分布
  const r = await query(`SELECT data_json->>'keywords' kw, data_json->>'query' q, country, COUNT(*)::int n
    FROM intel_data WHERE collect_time > NOW() - INTERVAL '24 hours' AND data_json->>'_sourceType'='threatroom'
    GROUP BY 1,2,3 ORDER BY n DESC LIMIT 15`);
  console.log('threatroom 近24h 查询词分布:');
  r.rows.forEach(x => console.log('  [' + (x.country||'空') + '] kw=' + String(x.kw||x.q||'?').slice(0,60) + ' -> ' + x.n + '条'));
  // gap_scheduler 近24h 国别分布
  const g = await query(`SELECT COALESCE(NULLIF(country,''),'(空)') c, COUNT(*)::int n FROM intel_data
    WHERE collect_time > NOW() - INTERVAL '24 hours' AND data_json->>'_sourceType'='gap_scheduler' GROUP BY 1 ORDER BY n DESC LIMIT 15`);
  console.log('\ngap_scheduler 近24h 国别:');
  g.rows.forEach(x => console.log('  ' + x.c + ' ' + x.n));
  // TIER1 覆盖情况：数据库里最近3天有哪些国家有数据
  const t = await query(`SELECT COALESCE(NULLIF(country,''),'(空)') c, COUNT(*)::int n FROM intel_data
    WHERE collect_time > NOW() - INTERVAL '72 hours' GROUP BY 1 ORDER BY n ASC LIMIT 200`);
  const ones = t.rows.filter(x => x.n <= 2).map(x => x.c);
  console.log('\n近72h 条数≤2的国家(' + ones.length + '个):', ones.join('、'));
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
