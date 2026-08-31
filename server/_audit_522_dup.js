// #522 排查：24h 内疑似事件签名重复（标题相似度>0.6）
const { pool, query } = require('./db');
(async () => {
  // 1) 简单按国家+核心词聚类——查同国家 24h 内 标题包含"袭击/抢劫/爆炸"等的重复
  const r = await query(`
    WITH recent AS (
      SELECT id, title, country, collect_time, data_json->>'_sourceType' src,
        substring(data_json->>'url' from 1 for 50) url50
      FROM intel_data
      WHERE collect_time > now() - interval '2 day'
        AND country IS NOT NULL AND country <> ''
    )
    SELECT country, count(*) c,
      array_agg(id) ids,
      array_agg(substring(title from 1 for 40)) titles,
      array_agg(src) srcs
    FROM recent
    WHERE title ~* '遇袭|被袭|袭击|抢劫|绑架|恐袭|爆炸|枪击|枪杀|沉船|出轨|翻车|罢工|抗议|骚乱|政变'
    GROUP BY country
    HAVING count(*) >= 3
    ORDER BY c DESC
    LIMIT 15
  `);
  console.log('=== 24h 内各国高事件量样本（≥3条） ===');
  for (const row of r.rows) {
    console.log('\n[' + row.country + '] 共 ' + row.c + ' 条');
    for (let i = 0; i < row.ids.length; i++) {
      console.log('  #' + row.ids[i] + ' | src=' + row.srcs[i] + ' | ' + row.titles[i]);
    }
  }

  // 2) 精确查同 title 前 15 字符的疑似真重复
  const r2 = await query(`
    SELECT substring(title from 1 for 20) AS t20, count(*) c, array_agg(id) ids
    FROM intel_data
    WHERE collect_time > now() - interval '2 day'
    GROUP BY substring(title from 1 for 20)
    HAVING count(*) >= 2
    ORDER BY c DESC
    LIMIT 12
  `);
  console.log('\n=== 24h 内标题前20字完全重复对 ===');
  for (const row of r2.rows) {
    console.log('  [' + row.c + '次] "' + row.t20 + '" ids=' + row.ids.join(','));
  }
  process.exit(0);
})();
