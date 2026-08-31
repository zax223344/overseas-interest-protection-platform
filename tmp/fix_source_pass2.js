/* 清洗二遍修正：①alerts 中的标题碎片型伪媒体名 → Google News；②intel_data 裸域名 → 规范中文媒体名 */
const path = require('path');
const pool = require(path.join(__dirname, '..', 'server', 'db.js')).pool || require(path.join(__dirname, '..', 'server', 'db.js'));

// 标题碎片黑名单特征：含动词/方位词的长串，或地缘组合残留
const GARBAGE = /袭击|伤亡|路线|边境|附近|增加|死亡|冲突|危机|罢工|爆炸|绑架|制裁|抗议|示威|撤离|救援|谈判|调查|保护|要求|敦促|警惕|预警|风险|局势|政变|洪灾|冰川|搜救/;
// 域名 → 规范媒体名
const DOMAIN_NAME = {
  'aljazeera.com': '半岛电视台', 'cnn.com': 'CNN', 'nytimes.com': '纽约时报', 'chinanews.com.cn': '中新网',
  'japantimes.co.jp': 'The Japan Times', 'euromaidanpress.com': 'Euromaidan Press',
  'moderndiplomacy.eu': 'Modern Diplomacy', 'naturalnews.com': 'Natural News',
  'reuters.com': '路透社', 'bbc.com': 'BBC', 'bbc.co.uk': 'BBC', 'theguardian.com': '卫报',
  'apnews.com': '美联社', 'afp.com': '法新社', 'globaltimes.cn': '环球网', 'xinhuanet.com': '新华网'
};

(async () => {
  // ① alerts 集合：碎片型伪媒体名 → Google News
  const r = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  let arr = Array.isArray(r.rows[0].data_json) ? r.rows[0].data_json : JSON.parse(r.rows[0].data_json);
  let n1 = 0;
  for (const a of arr) {
    if (a && a.source && GARBAGE.test(a.source)) {
      console.log('  [alerts 修正]', a.source, '→ Google News');
      a.source = 'Google News'; n1++;
    }
  }
  if (n1) await pool.query("UPDATE datahub_store SET data_json=$1, updated_at=now() WHERE collection='alerts'", [JSON.stringify(arr)]);
  console.log('[alerts] 碎片修正', n1, '条');

  // ② intel_data：裸域名 → 规范媒体名
  const r2 = await pool.query("SELECT id, source, (data_json->>'url') AS url FROM intel_data WHERE source LIKE '%.com' OR source LIKE '%.cn' OR source LIKE '%.eu' OR source LIKE '%.org' OR source LIKE '%.net'");
  let n2 = 0;
  for (const row of r2.rows) {
    let name = null;
    for (const [dom, cn] of Object.entries(DOMAIN_NAME)) if (String(row.url || '').indexOf(dom) >= 0) { name = cn; break; }
    if (name && name !== row.source) {
      await pool.query('UPDATE intel_data SET source=$1 WHERE id=$2', [name, row.id]);
      console.log('[intel_data 修正]', row.id, '|', row.source, '→', name);
      n2++;
    }
  }
  console.log('=== 二遍修正完成：alerts', n1, '条 | intel_data', n2, '条 ===');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
