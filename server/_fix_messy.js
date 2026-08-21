/* 存量数据清洗（2026-08-18 用户"乱杂"修复）：
 *  1) 事发国纠正：country 曾用来源国(sourcecountry)，把伊拉克/伊朗等错标成阿富汗 → 用 extractCountry 从事发标题/正文重提。
 *  2) 分类纠正：把"民调/支持率/分析"类从 军事冲突/恐袭/治安 挪回 地缘情报（它们是对冲突的评述，不是事件本身）。
 *  先全量备份 intel_data 再改，只更新确实变化的行。 */
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
const META_RE = /民调|民意调查|支持率|批准率|批判性考察|opinion poll|approval rating|survey/i;
const EVENT_RE = /爆炸|袭击|枪击|绑架|劫持|恐袭|地震|死亡|遇难|丧生|blast|attack|shooting|kidnap|hostage|killed/i;
const EVENT_CATS = ['military_conflicts', 'terror_events', 'security_events'];
(async () => {
  const all = await pool.query("SELECT id, data_type, country, title, data_json FROM intel_data");
  // 全量备份
  const bak = path.join(__dirname, '_backup_before_messyfix_' + Date.now() + '.json');
  fs.writeFileSync(bak, JSON.stringify(all.rows));
  console.log('已备份 ' + all.rows.length + ' 行 → ' + path.basename(bak));
  let cFix = 0, tFix = 0, scanned = 0;
  const ctySamples = [], typeSamples = [];
  for (const r of all.rows) {
    scanned++;
    const j = r.data_json || {};
    const titleZh = String(j.title_zh || '');
    const title = String(j.title || r.title || '');
    const content = String(j.content_zh || j.content || j.desc || '');
    // 1) 事发国重提
    const ec = scrapers.extractCountry(titleZh) || scrapers.extractCountry(title) || scrapers.extractCountry(content) || '';
    let newCountry = r.country;
    if (ec && ec !== r.country) newCountry = ec;
    // 2) 元文章（民调/分析，无硬事件词）从事件类挪回地缘
    const titleLow = (titleZh + ' ' + title);
    let newType = r.data_type;
    if (EVENT_CATS.includes(r.data_type) && META_RE.test(titleLow) && !EVENT_RE.test(titleLow)) {
      newType = 'geopolitical_intel';
    }
    if (newCountry !== r.country || newType !== r.data_type) {
      j.country = newCountry; j.country_cn = newCountry;
      await pool.query("UPDATE intel_data SET country=$1, data_type=$2, data_json=$3 WHERE id=$4",
        [newCountry, newType, JSON.stringify(j), r.id]);
      if (newCountry !== r.country) { cFix++; if (ctySamples.length < 12) ctySamples.push('  ' + r.country + '→' + newCountry + ' | ' + (titleZh || title).slice(0, 50)); }
      if (newType !== r.data_type) { tFix++; if (typeSamples.length < 12) typeSamples.push('  ' + r.data_type + '→' + newType + ' | ' + (titleZh || title).slice(0, 50)); }
    }
  }
  console.log('扫描 ' + scanned + ' 行 | 国别纠正 ' + cFix + ' | 重新分类 ' + tFix);
  console.log('\n--- 国别纠正样例 ---'); ctySamples.forEach(s => console.log(s));
  console.log('\n--- 重新分类样例 ---'); typeSamples.forEach(s => console.log(s));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
