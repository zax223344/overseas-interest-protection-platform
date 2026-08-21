/* 回滚 _fix_country_v2.js 的国别改动（正则仍不可靠：索马里含"马里"子串误判、"美国制裁北极LNG"主体/事发地难区分）。
 * 从 v2 备份还原 country 与 data_json，保留 data_type（重新分类"民调/分析→地缘"是对的）。 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026'
});
(async () => {
  const bakFile = fs.readdirSync(__dirname).filter(f => f.startsWith('_backup_before_countryfix_v2_')).sort().pop();
  if (!bakFile) { console.error('找不到 v2 备份'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, bakFile), 'utf8'));
  console.log('备份文件:', bakFile, '| 行数', rows.length);
  let n = 0;
  for (const r of rows) {
    await pool.query("UPDATE intel_data SET country=$1, data_json=$2 WHERE id=$3", [r.country, JSON.stringify(r.data_json), r.id]);
    n++;
  }
  console.log('已还原 country/data_json：' + n + ' 行（data_type 重新分类保留）');
  const chk = await pool.query("SELECT COUNT(*) c FROM intel_data WHERE country='马里' AND (title ~ '索马里' OR data_json::text ~ '索马里')");
  console.log('校验：country=马里 但含"索马里"的行数 =', chk.rows[0].c, '（回滚后应回落）');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
