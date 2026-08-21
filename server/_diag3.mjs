import { query } from './db.js';

const dayStart = new Date(); dayStart.setHours(0,0,0,0);
const r = await query(
  `SELECT id, country, data_type, title, description, location, event_date, severity, source, data_json
   FROM intel_data WHERE collect_time >= $1 ORDER BY collect_time DESC LIMIT 12`,
  [dayStart]
);
console.log('抽样条数:', r.rows.length, '\n');
r.rows.forEach(row => {
  const j = row.data_json || {};
  console.log('==== id ' + row.id + ' | 国:' + row.country + ' | 类:' + row.data_type + ' | 源:' + row.source);
  console.log('列标题 :', row.title);
  console.log('译标题 :', j.title_zh || '(空)');
  console.log('原正文 :', String(row.description || '').slice(0, 140));
  console.log('译正文 :', String(j.content_zh || '').slice(0, 140) || '(空)');
  console.log('地点   :', j.location || row.location || '(空)', '| 时间:', j.event_date || row.event_date || '(空)', '| 要素asset:', JSON.stringify(j.asset_tags || j.assets || ''));
  console.log('');
});
process.exit(0);
