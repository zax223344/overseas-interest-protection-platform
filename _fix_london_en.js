/* 补伦敦使馆文章英文标题墓碑（跨译文/跨通道变体指纹） */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });

function norm(t) {
  return String(t || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\w一-龥]+/g, '').slice(0, 48);
}
function cek(t) {
  const s = String(t || '').toLowerCase();
  const parts = [];
  const countries = (s.match(/\b(afghanistan|pakistan|china|chinese|iran|iraq|syria|yemen|libya|sudan|nigeria|somalia|mali|ukraine|russia|myanmar|israel|palestine|turkey|britain|france|germany)\b/g) || []);
  const nums = (s.match(/\b\d+\b/g) || []);
  const verbs = (s.match(/\b(attack|blast|bomb|kidnap|killing|killed|hostage|clash|sanction|protest|riot|collapse|绑架|爆炸|袭击|冲突|骚乱|恐袭|死亡|遇难)\b/g) || []);
  parts.push(...countries, ...nums, ...verbs);
  return parts.sort().join('|').slice(0, 120);
}

(async () => {
  const en = "Terror attack on new China mega-embassy in London 'could collapse flats and injure people within 180 metres'";
  const keys = [norm(en), 'c:' + cek(en)];
  for (const k of keys) {
    if (!k || k.length < 6) continue;
    await pool.query('INSERT INTO intel_tombstones (tkey, url, title) VALUES ($1,$2,$3)', [k, '', en.slice(0, 200)]);
    console.log('已补碑: ' + k);
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM intel_tombstones');
  console.log('墓碑总数:', rows[0].n);
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
