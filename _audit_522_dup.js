// #522 排查脚本：查 DB 里塞内加尔/圭亚那事件是否真重复
const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'orps', password: 'orps', database: 'orps' });
(async () => {
  await c.connect();
  for (const q of [
    { name: '塞内加尔中资矿企遇袭', sql: `SELECT id, title, country, collect_time, data_json->>'_sourceType' src, substring(data_json->>'url' from 1 for 60) url60 FROM intel_data WHERE title ILIKE '%塞内加尔%' OR (title ILIKE '%矿企%' AND title ILIKE '%遇袭%') OR data_json->>'url' ILIKE '%senegal%' ORDER BY collect_time DESC LIMIT 12` },
    { name: '圭亚那华人店铺遭抢劫', sql: `SELECT id, title, country, collect_time, data_json->>'_sourceType' src, substring(data_json->>'url' from 1 for 60) url60 FROM intel_data WHERE title ILIKE '%圭亚那%' OR (title ILIKE '%华人%' AND title ILIKE '%抢劫%') ORDER BY collect_time DESC LIMIT 12` },
    { name: '全量同事件签名重复样本(抽查)', sql: `SELECT count(*) FROM intel_data WHERE collect_time > now() - interval '1 day'` }
  ]) {
    console.log('=== ' + q.name + ' ===');
    try {
      const r = await c.query(q.sql);
      if (q.name.includes('全量')) { console.log('24h总行数: ' + r.rows[0].count); continue; }
      for (const x of r.rows) {
        console.log('#' + x.id + ' | ' + x.collect_time.toISOString().substring(0,16) + ' | src=' + x.src + ' | ' + x.title.substring(0, 50) + ' | ' + x.url60);
      }
      if (r.rows.length === 0) console.log('  (无匹配)');
    } catch (e) { console.log('  ERR: ' + e.message); }
  }
  await c.end();
})();
