/* 任务 #515 配套清理：2026-08-31 12:40–13:15 两次「中资#抢劫」关键词作战
 * 在旧版（无相关性闸）下入库的单要素噪声（芝加哥本地抢劫案/中企融资新闻/苏丹内战）。
 * 逻辑与新闸同源：条目须同时命中【涉华要素】AND【主题要素（抢劫）】，缺一即删+立墓碑。 */
const { Pool } = require('pg');
require('dotenv').config();
const CN_ZH = ['中资', '中国', '中方', '华人', '华侨', '中企', '一带一路', '撤侨', '北京'];
const CN_EN = /(chinese|china|beijing|cpec|gwadar|hambantota|piraeus|kyaukpyu|jakarta-?bandung|china-?laos|addis-?djibouti|mombasa-?nairobi|simandou|kamoa|tazara|colombo port city)/i;
const TP_ZH = /(抢劫|打劫|劫持|被抢|遭抢|劫案)/;
const TP_EN = /\brob/i;   /* rob/robbed/robber/robbery/robbing（词首边界，不误伤 problems） */
(async () => {
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const { rows } = await pool.query(
    `SELECT id, title, data_json FROM intel_data
     WHERE data_json->>'_sourceType'='threatroom'
       AND collect_time::date = CURRENT_DATE
       AND to_char(collect_time,'HH24:MI') BETWEEN '12:40' AND '13:15'
     ORDER BY id`);
  console.log('待检条目:', rows.length);
  const kill = [];
  for (const r of rows) {
    const dj = r.data_json || {};
    const text = [r.title, dj.title_zh, dj.title_en, dj.description, dj.content].map(x => String(x || '')).join(' ');
    const cn = CN_ZH.some(w => text.indexOf(w) >= 0) || CN_EN.test(text);
    const tp = TP_ZH.test(text) || TP_EN.test(text);
    if (!(cn && tp)) kill.push(r);
  }
  console.log('不相关待删:', kill.length, '/ 保留:', rows.length - kill.length);
  for (const r of kill) {
    const dj = r.data_json || {};
    const u = String(dj.url || '').trim();
    try {
      if (u) await pool.query(`INSERT INTO intel_tombstones (tkey, url, title) VALUES ($1, $2, $3)`, ['u:' + u.replace(/\/+$/, '').toLowerCase(), u, String(r.title || '').slice(0, 200)]);
      else await pool.query(`INSERT INTO intel_tombstones (tkey, url, title) VALUES ($1, $2, $3)`, ['t:' + String(r.title || '').slice(0, 120), null, String(r.title || '').slice(0, 200)]);
    } catch (e) { console.log('墓碑失败', r.id, e.message); }
    await pool.query('DELETE FROM intel_data WHERE id = $1', [r.id]);
    console.log('已删', r.id, '|', String(dj.title_zh || r.title || '').slice(0, 60));
  }
  /* 预警队列（datahub alerts）同步清理：按 url/标题命中剔除 */
  if (kill.length) {
    const kurls = new Set(kill.map(r => String((r.data_json || {}).url || '').replace(/\/+$/, '').toLowerCase()).filter(Boolean));
    const ktits = new Set(kill.map(r => String((r.data_json || {}).title_zh || r.title || '')));
    try {
      const cur = await pool.query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
      const arr = (cur.rows.length && Array.isArray(cur.rows[0].data_json)) ? cur.rows[0].data_json : [];
      const kept = arr.filter(a => !a || (!kurls.has(String(a.url || '').replace(/\/+$/, '').toLowerCase()) && !ktits.has(String(a.title_zh || a.title || ''))));
      if (kept.length !== arr.length) {
        await pool.query(`INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ('alerts',$1,NOW()) ON CONFLICT (collection) DO UPDATE SET data_json=$1, updated_at=NOW()`, [JSON.stringify(kept)]);
        console.log('预警队列剔除:', arr.length - kept.length, '条');
      } else console.log('预警队列无需清理');
    } catch (e) { console.log('预警队列清理失败:', e.message); }
  }
  await pool.end();
  console.log('DONE');
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
