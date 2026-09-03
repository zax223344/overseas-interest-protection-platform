/* 2026-09-03 一次性清扫：intel_data 中 frontend_post + news.google.com 的存量条目
 * 解码跳转 → URL 日期模式/原文页 meta 验真 → 超 7 天删除 + 墓碑（URL 为主键）。
 * 限流 1.5s/条，51 条约 4 分钟。 */
require('dotenv').config();
const { query } = require('./db');
const netx = require('./netx');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function decode(gurl) {
  try {
    const m = String(gurl).match(/\/(?:articles|read)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const b = m[1];
    const page = await netx.smartFetch('https://news.google.com/rss/articles/' + b, { timeout: 12000, headers: { 'User-Agent': UA } });
    if (!page || !page.ok) return null;
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/), ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sg || !ts) return null;
    const innerStr = '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"' + b + '",' + ts[1] + ',"' + sg[1] + '"]';
    const fReq = JSON.stringify([[["Fbv4je", innerStr]]]);
    const resp = await netx.smartPost('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body: 'f.req=' + encodeURIComponent(fReq),
    });
    if (!resp || !resp.ok) return null;
    const txt = await resp.text();
    const parts = txt.split('\n\n');
    if (parts.length < 2) return null;
    let outer;
    try { outer = JSON.parse(parts[1]); } catch (e) { return null; }
    const inner = outer && outer[0] && outer[0][2];
    if (typeof inner !== 'string') return null;
    try {
      const arr = JSON.parse(inner);
      if (Array.isArray(arr) && typeof arr[1] === 'string' && /^https?:\/\//.test(arr[1])) return arr[1];
    } catch (e) {}
    return null;
  } catch (e) { return null; }
}
function urlPubDate(u) {
  const s = String(u || '');
  let m = s.match(/(?:^|[\/?&._=-])((?:19|20)\d{2})[-\/](\d{1,2})[-\/](\d{1,2})(?:[\/?&._=-]|$)/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 && d.getFullYear() === +m[1]) return d; }
  m = s.match(/(?:^|[\/._-])((?:19|20)\d{2})(\d{2})(\d{2})\d{0,5}(?:[\/._-]|$)/);
  if (m) { if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return new Date(+m[1], +m[2] - 1, +m[3]); }
  m = s.match(/(?:^|[\/._-])((?:19|20)\d{2})(\d{2})(?:[\/._-]|$)/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return new Date(+m[1], +m[2] - 1, 1);
  m = s.match(/\/((?:19|20)\d{2})\/(\d{1,2})\//);
  if (m && +m[2] >= 1 && +m[2] <= 12) return new Date(+m[1], +m[2] - 1, 1);
  return null;
}
async function pagePubDate(u) {
  try {
    const r = await netx.smartFetch(u, { timeout: 10000, headers: { 'User-Agent': UA } });
    if (!r || !r.ok) return null;
    const html = (await r.text()).slice(0, 80000);
    const cands = [];
    let m = html.match(/article:published_time["']?\s+content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]*property=["']article:published_time/i);
    if (m) cands.push(m[1]);
    m = html.match(/<time[^>]+datetime=["']([^"']+)/i);
    if (m) cands.push(m[1]);
    m = html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    if (m) cands.push(m[1]);
    for (const c of cands) {
      const d = new Date(c);
      if (isFinite(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() <= new Date().getFullYear() + 1) return d;
    }
    return null;
  } catch (e) { return null; }
}

(async () => {
  const { rows } = await query("SELECT id, title, data_json->>'url' AS url FROM intel_data WHERE data_json->>'_sourceType'='frontend_post' AND data_json->>'url' LIKE '%news.google.com%' ORDER BY id");
  console.log('[SWEEP] 候选 ' + rows.length + ' 条');
  const now = Date.now();
  let killed = 0, verifiedFresh = 0, unknown = 0;
  for (const r of rows) {
    const orig = await decode(r.url);
    if (!orig) { unknown++; await new Promise(s => setTimeout(s, 1500)); continue; }
    const d = urlPubDate(orig) || await pagePubDate(orig);
    if (d && now - d.getTime() > 7 * 24 * 3600 * 1000) {
      await query("INSERT INTO intel_tombstones (url, title) VALUES ($1,$2) ON CONFLICT DO NOTHING", [r.url, r.title]);
      await query('DELETE FROM intel_data WHERE id=$1', [r.id]);
      killed++;
      console.log('[SWEEP] 旧闻剔除 id=' + r.id + ' | 原文发布 ' + d.toISOString().slice(0, 10) + ' | ' + String(r.title).slice(0, 40));
    } else if (d) { verifiedFresh++; }
    else unknown++;
    await new Promise(s => setTimeout(s, 1500));
  }
  console.log('[SWEEP] 完成：剔除旧闻 ' + killed + ' 条，验真新鲜 ' + verifiedFresh + ' 条，无法验真 ' + unknown + ' 条（保留）');
  process.exit(0);
})().catch(e => { console.error('[SWEEP] ERR', e.message); process.exit(1); });
