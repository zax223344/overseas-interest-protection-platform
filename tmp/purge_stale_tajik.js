/* 处置旧闻污染：12 条塔吉克旧闻从 alerts/events/terror_events 剔除 + 按真实 URL/标题写墓碑 */
const path = require('path');
const pool = require(path.join(__dirname, '..', 'server', 'db.js')).pool || require(path.join(__dirname, '..', 'server', 'db.js'));
const ID_LIST = [1788081600887, 1788081600959, 1788081633530, 1788081592800, 1788081591743,
  1788081613157, 1788081674894, 1788081624328, 1788081619810, 1788081610967, 1788081616324, 1788081304091];

(async () => {
  // 0. 先取完整记录（剔除前）
  const r0 = await pool.query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  let arr = Array.isArray(r0.rows[0].data_json) ? r0.rows[0].data_json : JSON.parse(r0.rows[0].data_json);
  const victims = arr.filter(a => ID_LIST.includes(Number(a.id)));
  console.log('待剔除:', victims.length, '条');

  // 1. alerts 剔除
  const before = arr.length;
  arr = arr.filter(a => !ID_LIST.includes(Number(a.id)));
  await pool.query("UPDATE datahub_store SET data_json=$1, updated_at=now() WHERE collection='alerts'", [JSON.stringify(arr)]);
  console.log('alerts:', before, '→', arr.length);

  // 2. events / terror_events 派生剔除
  for (const coll of ['events', 'terror_events']) {
    const r2 = await pool.query('SELECT data_json FROM datahub_store WHERE collection=$1', [coll]);
    if (!r2.rows.length) continue;
    let a2 = Array.isArray(r2.rows[0].data_json) ? r2.rows[0].data_json : JSON.parse(r2.rows[0].data_json);
    if (!Array.isArray(a2)) continue;
    const b2 = a2.length;
    a2 = a2.filter(x => !ID_LIST.includes(Number(String(x.id).replace('live-', ''))));
    if (a2.length !== b2) {
      await pool.query('UPDATE datahub_store SET data_json=$1, updated_at=now() WHERE collection=$2', [JSON.stringify(a2), coll]);
      console.log(coll + ':', b2, '→', a2.length);
    }
  }

  // 3. 墓碑（真实完整 URL + 标题归一双键）
  await pool.query(`CREATE TABLE IF NOT EXISTS intel_tombstones (
    key text PRIMARY KEY, reason text, created_at timestamptz DEFAULT now())`);
  let n = 0;
  for (const v of victims) {
    const urlKey = v.url ? 'url:' + v.url : '';
    const tKey = 'title:' + String(v.title_zh || v.title || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    const reason = 'stale-news: google_news 旧闻重推（原文非当日发布，' + (v.time || '') + ' 入库）';
    if (urlKey) { await pool.query('INSERT INTO intel_tombstones (key, reason) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [urlKey, reason]); n++; }
    if (tKey.length > 25) { await pool.query('INSERT INTO intel_tombstones (key, reason) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [tKey, reason]); n++; }
  }
  console.log('墓碑写入:', n, '条（URL+标题双键）');
  console.log('=== 处置完成 ===');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
