/* 国别纠正 v2（2026-08-18）：用"排除中国"的 extractOverseasCountry 修事发国。
 * 只改"标题/正文明确提到他国且与现值不同"的行；涉华事件（中国是主体）因排除中国而保持来源国，不误改。 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
const scrapers = require('./scrapers');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026'
});
(async () => {
  const all = await pool.query("SELECT id, country, title, data_json FROM intel_data");
  const bak = path.join(__dirname, '_backup_before_countryfix_v2_' + Date.now() + '.json');
  fs.writeFileSync(bak, JSON.stringify(all.rows));
  console.log('已备份 ' + all.rows.length + ' 行 → ' + path.basename(bak));
  let cFix = 0, toChina = 0; const samples = [];
  for (const r of all.rows) {
    const j = r.data_json || {};
    const titleZh = String(j.title_zh || '');
    const title = String(j.title || r.title || '');
    const content = String(j.content_zh || j.content || j.desc || '');
    const ec = scrapers.extractOverseasCountry(titleZh + ' ' + title) || scrapers.extractOverseasCountry(content) || '';
    if (ec && ec !== r.country) {
      j.country = ec; j.country_cn = ec;
      await pool.query("UPDATE intel_data SET country=$1, data_json=$2 WHERE id=$3", [ec, JSON.stringify(j), r.id]);
      cFix++;
      if (ec === '中国') toChina++;
      if (samples.length < 15) samples.push('  ' + r.country + '→' + ec + ' | ' + (titleZh || title).slice(0, 52));
    }
  }
  console.log('国别纠正 ' + cFix + ' 条 | 其中改成"中国"的 ' + toChina + ' 条（应为 0）');
  console.log('--- 样例 ---'); samples.forEach(s => console.log(s));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
