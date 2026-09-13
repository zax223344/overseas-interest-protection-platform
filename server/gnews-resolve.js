/**
 * gnews-resolve.js — Google News 跳转壳解码单一事实源（#786，2026-09-13 用户报告：
 * 智能情报中心点「原文链接」报「试图将您重定向到无效网址」）
 * ================================================================================
 * 根因：Google News RSS 的 /rss/articles/CBMi... 不是文章页，是 Google 重定向壳：
 *   ① 新版 token（AU_yqL 前缀）无法本地 base64 解码，必须走 Google batchexecute 内部接口；
 *   ② news.google.com 在中国内地被 GFW 阻断——内地浏览器连壳都打不开，必然报重定向无效；
 *   ③ 系统入库时把壳 URL 原样存 url 字段（实测 1,887 行，ext_url 全空），前端点原文=点壳。
 *
 * 解法（一处定义三处消费）：
 *   ① decodeGnews(url)  — 抓壳页取 sg/ts → batchexecute(Fbv4je) 解出真实原文 URL；
 *   ② resolveAndPersist — 解码成功即回写 intel_data（url=原文，_gnewsUrl=壳），全站链接即刻变直连；
 *   ③ 定时清扫          — SCHED 每 30 分钟消化未解析存量（限流防 Google 风控）。
 */
'use strict';
const netx = require('./netx');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const _memCache = new Map();              /* 壳URL → 原文URL（进程内缓存） */
const _failUntil = new Map();             /* 失败退避：连续失败/Google 风控时暂停一段时间 */
let _failStreak = 0;

function isGnewsUrl(u) { return /\/\/news\.google\.com\/rss\/(?:articles|read)\//.test(String(u || '')); }

/** Google 反滥用拦截（302 → /sorry/）判定与退避 */
function noteGoogleBlock() {
  /* 实测：600 连发后 batchexecute 302 → google.com/sorry（IP 级反滥用闸，通常数十分钟解除） */
  _failUntil.set('g', Date.now() + 45 * 60 * 1000);
  _failStreak = 0;
}
function blocked() { return Date.now() < (_failUntil.get('g') || 0); }

/** 解码 Google News 跳转壳 → 真实原文 URL（失败返回 ''） */
async function decodeGnews(gurl) {
  const u = String(gurl || '');
  if (!isGnewsUrl(u)) return '';
  if (_memCache.has(u)) return _memCache.get(u);
  const until = _failUntil.get('g') || 0;
  if (Date.now() < until) return '';
  try {
    const m = u.match(/\/(?:articles|read)\/([A-Za-z0-9_-]+)/);
    if (!m) return '';
    const b = m[1];
    const page = await netx.smartFetch('https://news.google.com/rss/articles/' + b, { timeout: 12000, headers: { 'User-Agent': UA } });
    if (!page || !page.ok) throw new Error('shell page ' + (page && page.status));
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/), ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sg || !ts) throw new Error('no sg/ts（壳页结构变化或被风控）');
    const innerStr = '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"' + b + '",' + ts[1] + ',"' + sg[1] + '"]';
    const fReq = JSON.stringify([[['Fbv4je', innerStr]]]);
    const resp = await netx.smartPost('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body: 'f.req=' + encodeURIComponent(fReq),
    });
    if (!resp || !resp.ok) {
      const h = resp && resp.headers;
      const loc = h && (typeof h.get === 'function' ? h.get('location') : h.location);
      if (resp && (resp.status === 302 || resp.status === 429) && String(loc || '').indexOf('/sorry/') >= 0) {
        noteGoogleBlock();
        throw new Error('google /sorry 风控，退避 45 分钟');
      }
      throw new Error('batchexecute ' + (resp && resp.status));
    }
    const txt = await resp.text();
    const parts = txt.split('\n\n');
    if (parts.length < 2) throw new Error('batchexecute 空响应');
    const outer = JSON.parse(parts[1]);
    const inner = outer && outer[0] && outer[0][2];
    const arr = typeof inner === 'string' ? JSON.parse(inner) : inner;
    if (Array.isArray(arr) && typeof arr[1] === 'string' && /^https?:\/\//.test(arr[1])) {
      _memCache.set(u, arr[1]);
      _failStreak = 0;
      return arr[1];
    }
    throw new Error('响应无 URL 字段');
  } catch (e) {
    _failStreak++;
    if (_failStreak >= 5) _failUntil.set('g', Date.now() + 10 * 60 * 1000);   /* 连续 5 败 → 退避 10 分钟 */
    return '';
  }
}

/**
 * 解码并回写 intel_data（按 url=壳 定位行；url 列在 data_json 内）。
 * @returns {Promise<string>} 原文 URL（成功）或 ''（失败）
 */
async function resolveAndPersist(gurl, query) {
  const orig = await decodeGnews(gurl);
  if (!orig) return '';
  try {
    await query(
      `UPDATE intel_data SET data_json = (data_json::jsonb
          || jsonb_build_object('url', $2::text, '_gnewsUrl', $1::text)
          || jsonb_strip_nulls(jsonb_build_object('ext_url', $2::text)))::json
        WHERE data_json->>'url' = $1 AND COALESCE(data_json->>'url','') <> $2`, [String(gurl), orig]);
  } catch (e) { /* 回写失败不影响返回（至少本次点击能打开） */ }
  return orig;
}

/** 定时清扫：消化未解析存量（每轮 limit 条，2.5s 限流；被 translate-retry 同款调度器驱动） */
async function sweepUnresolved(query, limit) {
  const { rows } = await query(
    `SELECT id, data_json->>'url' AS url FROM intel_data
      WHERE data_json->>'url' LIKE '%news.google.com%' AND COALESCE(data_json->>'_gnewsUrl','') = ''
      ORDER BY collect_time DESC LIMIT $1`, [limit || 30]);
  let ok = 0;
  for (const r of rows) {
    if (blocked()) break;                                   /* Google 风控退避中，本轮立即收工 */
    if (await resolveAndPersist(r.url, query)) ok++;
    await new Promise(s => setTimeout(s, 2500));
  }
  return { scanned: rows.length, resolved: ok };
}

module.exports = { isGnewsUrl, decodeGnews, resolveAndPersist, sweepUnresolved };
