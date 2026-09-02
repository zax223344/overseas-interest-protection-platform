/* 存量清洗（2026-09-02 国别污染根治二阶段）：
 *  问题：国际桶（country='国际'）292 条混装各国事件——尼日利亚 NNPC/巴基斯坦 FBR/德国/美国国会等，
 *  预警研判官同国背景查询把它们当"同国事件"喂给 AI，产生数据异常告警。
 *  做法：对国际桶每行用 extractCountry 从 title_zh/title/content 重提国别，提出即更新；
 *  提不出的（真国际新闻）保留国际。先全量备份被改行。零模拟：只重定向，不编造。 */
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
  const r = await pool.query("SELECT id, country, title, description, data_json FROM intel_data WHERE country IN ('国际','全球','多国','未知') ORDER BY id");
  console.log('伪国别桶共 ' + r.rows.length + ' 行');
  const bak = path.join(__dirname, '_backup_before_intlfix_' + Date.now() + '.json');
  fs.writeFileSync(bak, JSON.stringify(r.rows));
  console.log('已备份 → ' + path.basename(bak));
  let fixed = 0, kept = 0;
  const samples = [];
  const cnt = {};
  for (const row of r.rows) {
    const j = row.data_json || {};
    const titleZh = String(j.title_zh || '');
    const title = String(j.title || row.title || '');
    const content = String(j.content_zh || j.content || row.description || j.desc || '');
    const ec = scrapers.extractCountry(titleZh) || scrapers.extractCountry(title) || scrapers.extractCountry(content.slice(0, 800)) || '';
    if (ec && ec !== row.country) {
      j.country = ec; j.country_cn = ec;
      await pool.query("UPDATE intel_data SET country=$1, data_json=$2 WHERE id=$3", [ec, JSON.stringify(j), row.id]);
      fixed++;
      cnt[ec] = (cnt[ec] || 0) + 1;
      if (samples.length < 15) samples.push('  ' + row.country + '→' + ec + ' | ' + (titleZh || title).slice(0, 46));
    } else {
      kept++;
    }
  }
  console.log('重定向 ' + fixed + ' 行 | 保留国际 ' + kept + ' 行');
  console.log('--- 重定向国别分布 ---');
  Object.entries(cnt).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log('  ' + c + ' ' + n));
  console.log('--- 样例 ---');
  samples.forEach(s => console.log(s));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
