/* Task #464 一次性清理：① 墓碑死键迁移到现行格式 ② 五库清除墓碑命中残留（含伦敦使馆旧闻）
 * 幂等可重复执行。运行前提：server.js 已含新 _getTombstones/_tombMatchSync 语义（此处独立重实现同款逻辑）。 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
const CACHE_DIR = path.join(__dirname, '.cache');

function _normTitleKey(t) {
  return String(t || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w一-龥]+/g, '')
    .slice(0, 48);
}
function _coreEntityKey(t) {
  const s = String(t || '').toLowerCase();
  const parts = [];
  const countries = (s.match(/\b(afghanistan|pakistan|china|chinese|kabul|gwadar|balochistan|iran|iraq|syria|yemen|libya|sudan|nigeria|kenya|somalia|mali|niger|chad|ukraine|russia|myanmar|israel|palestine|turkey|saudi|uae|egypt|ethiopia|tanzania|congo|bangladesh|sri lanka|nepal|kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan|laos|cambodia|vietnam|thailand|malaysia|indonesia|philippines|brazil|argentina|chile|peru|mexico|australia|serbia|hungary|poland|germany|france|britain|italy|japan|korea|mongolia)\b/g) || []);
  const orgs = (s.match(/\b(isis|isil|is[- ]?khorasan|taliban|ttp|boko haram|al[- ]?shabaab|houthi|hezbollah|hamas|bla|blf|al[- ]?qaeda|qaida|islamic state)\b/g) || []);
  const nums = (s.match(/\b\d+\b/g) || []);
  const verbs = (s.match(/\b(attack|blast|bomb|explosion|kidnap|killing|killed|dead|death|shooting|hostage|clash|raid|ambush|sanction|protest|riot|coup|crash|collapse|fire|绑架|爆炸|袭击|枪击|冲突|骚乱|抗议|示威|罢工|政变|制裁|封锁|禁运|海盗|劫持|叛乱|武装|极端组织|恐袭|死亡|遇难|身亡|伤亡|事故|灾难|撤离|疏散)\b/g) || []);
  parts.push(...countries, ...orgs, ...nums, ...verbs);
  return parts.sort().join('|').slice(0, 120);
}

(async () => {
  /* ── ① 墓碑死键迁移 ── */
  const { rows: tombs } = await pool.query('SELECT id, tkey, url, title FROM intel_tombstones');
  let migrated = 0, deadRows = [];
  const tkeys = new Set(), urls = new Set();
  for (const r of tombs) {
    const raw = String(r.url || '').trim();
    if (raw) urls.add(raw.replace(/\/+$/, '').toLowerCase());
    const k = String(r.tkey || '');
    if (!k) continue;
    if (k.startsWith('u:')) {
      const u = k.slice(2).trim();
      if (u) urls.add(u.replace(/\/+$/, '').toLowerCase());
      deadRows.push({ id: r.id, newUrl: u, newKey: null, old: k });
    } else if (k.startsWith('t:')) {
      const nk = _normTitleKey(k.slice(2));
      if (nk.length >= 6) tkeys.add(nk);
      deadRows.push({ id: r.id, newUrl: null, newKey: nk, old: k });
    } else {
      tkeys.add(k);
    }
  }
  for (const d of deadRows) {
    if (d.newUrl) {
      await pool.query('UPDATE intel_tombstones SET url=$1 WHERE id=$2 AND (url IS NULL OR url=\'\')', [d.newUrl, d.id]);
      await pool.query('UPDATE intel_tombstones SET tkey=NULL WHERE id=$1', [d.id]);
    } else if (d.newKey && d.newKey.length >= 6) {
      await pool.query('UPDATE intel_tombstones SET tkey=$1 WHERE id=$2', [d.newKey, d.id]);
    } else {
      await pool.query('DELETE FROM intel_tombstones WHERE id=$1', [d.id]);
    }
    migrated++;
  }
  console.log(`① 墓碑迁移: 总${tombs.length}条，死键修复 ${migrated} 条 → 现行 tkeys=${tkeys.size} urls=${urls.size}`);

  const _hit = it => {
    const t = it || {};
    const u = String(t.url || t.link || '').replace(/\/+$/, '').toLowerCase();
    if (u && urls.has(u)) return true;
    const k1 = _normTitleKey(t.title), k2 = _normTitleKey(t.title_zh);
    if (k1.length >= 6 && tkeys.has(k1)) return true;
    if (k2.length >= 6 && tkeys.has(k2)) return true;
    return false;
  };

  /* ── ② intel_data 清残留 ── */
  {
    const { rows } = await pool.query('SELECT id, title, data_json FROM intel_data');
    const ids = rows.filter(r => _hit({ title: r.title, title_zh: (r.data_json || {}).title_zh, url: (r.data_json || {}).url })).map(r => r.id);
    if (ids.length) await pool.query('DELETE FROM intel_data WHERE id = ANY($1)', [ids]);
    console.log(`② intel_data 清除 ${ids.length} 行${ids.length ? ' → ids=' + ids.slice(0, 20).join(',') : ''}`);
  }
  /* ── ③ intel_archive 清残留 ── */
  {
    const { rows } = await pool.query('SELECT id, title, data_json FROM intel_archive');
    const hits = rows.filter(r => _hit({ title: r.title, title_zh: (r.data_json || {}).title_zh, url: (r.data_json || {}).url }));
    const ids = hits.map(r => r.id);
    if (ids.length) await pool.query('DELETE FROM intel_archive WHERE id = ANY($1)', [ids]);
    console.log(`③ intel_archive 清除 ${ids.length} 行${hits.length ? ' | ' + hits.slice(0, 8).map(h => (h.title || '').slice(0, 40)).join(' / ') : ''}`);
  }
  /* ── ④ intel_sidepool 清残留 ── */
  {
    const { rows } = await pool.query('SELECT id, title, title_zh, url FROM intel_sidepool');
    const ids = rows.filter(r => _hit({ title: r.title, title_zh: r.title_zh, url: r.url })).map(r => r.id);
    if (ids.length) await pool.query('DELETE FROM intel_sidepool WHERE id = ANY($1)', [ids]);
    console.log(`④ intel_sidepool 清除 ${ids.length} 行`);
  }
  /* ── ⑤ 预警队列清残留（重点：伦敦使馆旧闻 id=1787933319728） ── */
  {
    const { rows } = await pool.query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
    const arr = (rows.length && Array.isArray(rows[0].data_json)) ? rows[0].data_json : [];
    const hits = arr.filter(a => a && _hit(a));
    const kept = arr.filter(a => a && !_hit(a));
    if (hits.length) {
      await pool.query(`INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ('alerts',$1,NOW()) ON CONFLICT (collection) DO UPDATE SET data_json=$1, updated_at=NOW()`, [JSON.stringify(kept)]);
      console.log(`⑤ 预警队列清除 ${hits.length} 条:`);
      for (const h of hits) console.log(`   id=${h.id} | ${(h.title || '').slice(0, 70)}`);
    } else console.log('⑤ 预警队列无墓碑命中');
  }
  /* ── ⑥ 公开缓存清残留 ── */
  {
    let n = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const fp = path.join(CACHE_DIR, f);
      try {
        const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!Array.isArray(arr) || !arr.length) continue;
        const kept = arr.filter(it => it && !_hit(it));
        if (kept.length !== arr.length) { fs.writeFileSync(fp, JSON.stringify(kept), 'utf8'); n += arr.length - kept.length; }
      } catch (e) {}
    }
    console.log(`⑥ 公开缓存清除 ${n} 条`);
  }
  await pool.end();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
