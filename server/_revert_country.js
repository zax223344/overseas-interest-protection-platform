/* 回滚 _fix_messy.js 的国别改动（它把"涉华事件"的事发国错改成"中国"，矫枉过正）。
 * 从备份还原 country 与 data_json，但保留 data_type（重新分类"民调/分析→地缘"是对的，保留）。 */
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
  const bakFile = fs.readdirSync(__dirname).filter(f => f.startsWith('_backup_before_messyfix_')).sort().pop();
  if (!bakFile) { console.error('找不到备份'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, bakFile), 'utf8'));
  console.log('备份文件:', bakFile, '| 行数', rows.length);
  let n = 0;
  for (const r of rows) {
    // 只还原 country 与 data_json；不动 data_type（保留重新分类）
    await pool.query("UPDATE intel_data SET country=$1, data_json=$2 WHERE id=$3",
      [r.country, JSON.stringify(r.data_json), r.id]);
    n++;
  }
  console.log('已还原 country/data_json：' + n + ' 行（data_type 重新分类保留）');
  // 校验：涉华事件不应再被标成"中国"
  const chk = await pool.query("SELECT COUNT(*) c FROM intel_data WHERE country='中国' AND (title ~ '中资|中企|中国公民|华人|华侨|中方' OR data_json::text ~ '中资|中企|中国公民')");
  console.log('校验：country=中国 且涉华的行数 =', chk.rows[0].c, '（回滚后应恢复到来源国，接近 0）');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
