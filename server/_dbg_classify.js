const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026'
});
(async () => {
  // 1) 误判：军事冲突/恐袭里混进的"民调/选举/支持率"类纯政治垃圾
  console.log('===== A. military_conflicts/terror_events 里的民调/选举类垃圾 =====');
  const a = await pool.query(
    "SELECT data_type, country, title, collect_time FROM intel_data WHERE (data_type IN ('military_conflicts','terror_events','security_events')) AND (title ~ '民调|支持率|选举|投票|approval|approval rating|poll|opinion poll') ORDER BY collect_time DESC LIMIT 15",
  );
  a.rows.forEach(r => console.log('  [' + r.data_type + '] cty=' + r.country + ' ' + String(r.collect_time).slice(0, 16) + ' | ' + (r.title || '').slice(0, 66)));
  if (!a.rows.length) console.log('  (无)');

  // 2) 错标国别：country=阿富汗 但标题明显是他国（伊拉克/伊朗等）
  console.log('\n===== B. country 错标（country 字段 vs 标题事发国）=====');
  const b = await pool.query(
    "SELECT country, data_type, title, collect_time FROM intel_data WHERE (country='阿富汗' AND (title ~ '伊拉克|苏莱曼尼亚|巴格达|Iraq|Baghdad')) OR (country='阿富汗' AND (title ~ '伊朗|德黑兰|Iran|Tehran')) ORDER BY collect_time DESC LIMIT 12",
  );
  b.rows.forEach(r => console.log('  cty=' + r.country + ' [' + r.data_type + '] ' + String(r.collect_time).slice(0, 16) + ' | ' + (r.title || '').slice(0, 66)));
  if (!b.rows.length) console.log('  (无)');

  // 3) 各类型里 country 为来源国 vs 空 的占比粗查（近24h）
  console.log('\n===== C. 今日各类型数量 & 含明确涉华占比 =====');
  const c = await pool.query(
    "SELECT data_type, COUNT(*) c FROM intel_data WHERE collect_time >= date_trunc('day', now()) GROUP BY data_type ORDER BY c DESC"
  );
  c.rows.forEach(r => console.log('  ' + r.data_type + ': ' + r.c));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
