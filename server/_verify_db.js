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
const PAT = ['%afghan%','%阿富汗%','%taliban%','%塔利班%','%iskp%','%isis-k%','%kabul%','%喀布尔%','%俾路支%','%afghanistan%'];
(async () => {
  const r = await pool.query(
    "SELECT data_type, COUNT(*) c, SUM(CASE WHEN (data_json->>'interestLinked')::text = 'true' THEN 1 ELSE 0 END) AS linked FROM intel_data WHERE (title ILIKE ANY($1) OR data_json::text ILIKE ANY($1)) GROUP BY data_type ORDER BY c DESC",
    [PAT]
  );
  console.log('===== 阿富汗/塔利班/ISKP/俾路支 相关情报（全库）按类型 =====');
  if (!r.rows.length) console.log('  （库内无任何匹配）');
  r.rows.forEach(x => console.log('  ' + x.data_type + ' : 总 ' + x.c + ' 条 | interestLinked=true ' + x.linked));
  const s = await pool.query(
    "SELECT title, data_type, (data_json->>'interestLinked')::text AS il, country, collect_time FROM intel_data WHERE (title ILIKE ANY($1) OR data_json::text ILIKE ANY($1)) ORDER BY collect_time DESC LIMIT 18",
    [PAT]
  );
  console.log('\n===== 样例（最新 18 条）=====');
  s.rows.forEach(x => console.log('  [' + (x.data_type || '?') + '] il=' + x.il + ' cty=' + (x.country || '?') + ' | ' + (x.title || '').slice(0, 66)));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
