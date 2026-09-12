/**
 * backfill-titles.js — SOURCEURL 真实标题回捞引擎（任务 #714④，2026-09-08 用户拍板重补方案）
 * ================================================================
 * 背景：#661 归档补采用 CAMEO 模板合成中文标题——审计 245,474 条 100% 机器合成句
 * （78.3% 行为动词签名 + 100%「国名：」结构 + 行为体错配硬伤），下游垃圾闸全部隔离，
 * 情报价值为零。根修：GDELT 2.1 事件记录自带 SOURCEURL（原始新闻文章链接）——
 * 回捞文章页提取真实 <title>/og:title 替代模板合成；死链/取题失败回落模板并打
 * _synthetic 标记（哨兵质量门合成率 ≤5%）。
 *
 * 设计要点：
 * ① backfill_title_cache 表（url 主键）持久缓存——中断重跑不重复回捞（断点续采，
 *    哨兵核心诉求「中断后能接上」的数据层保证）；
 * ② 单 URL 18s 外层硬超时（smartFetch 直连+代理双腿各 2 次重试最坏 ~54s，
 *    不 race 截断会拖死整日节奏）；
 * ③ 10 并发 + 100ms 交错（4 worker × 10 = 系统级 40 并发上限，不挤兑实时采集）；
 * ④ 处理期间每 60s 心跳回写 backfill_progress.started_at——哨兵僵死判据
 *    （running >30min 无心跳）依赖此心跳，否则长日会被误回收；
 * ⑤ 取题清洗：实体解码/标签剥离/长度 12~300/黑名单（404/登录墙/Just a moment 等）；
 * ⑥ 成功条目：source 换真实域名、去 _archiveEvent（脱离 GDELT 归档垃圾闸隔离），
 *    保留 _tplTitle/_archiveSrc/gdeltEventId 全程可溯源。
 */
'use strict';

let D = null;
let _tableReady = false;

const CONCURRENCY = 10;              /* 单历史日回捞并发 */
const STAGGER_MS = 100;              /* 包间交错 */
const PER_URL_TIMEOUT_MS = 18 * 1000;/* 单 URL 外层硬超时 */
const HEARTBEAT_MS = 60 * 1000;      /* 僵死判据心跳周期 */
const DEAD_AFTER_TRIES = 2;          /* 取题失败 2 次判死链（跨日重试累计） */
const HTML_HEAD_LIMIT = 400000;      /* 只扫前 400KB（<head> 必在其中） */

const JUNK_TITLE_RE = /^(404|403|access denied|just a moment|attention required|are you a robot|javascript|loading|untitled|home|login|log in|sign in|subscribe|subscription|payment required|error|forbidden|not found|page not found|server error|gateway timeout)\b/i;
const ENT_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };

async function ensureTable() {
  if (_tableReady) return;
  await D.query(`CREATE TABLE IF NOT EXISTS backfill_title_cache (
    url text PRIMARY KEY, title text, status text NOT NULL DEFAULT 'retry',
    tries int DEFAULT 0, fetched_at timestamptz)`);
  _tableReady = true;
}

function _decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ' '; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, w) => ENT_MAP[String(w).toLowerCase()] || ' ');
}

const TS = require('./title-sanity');   /* #777 P0：站点 chrome / channel 元数据标题识别 */

function _cleanTitle(raw, url) {
  let t = _decodeEntities(String(raw || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\|\-–—·»•\s]+|[\|\-–—·«•\s]+$/g, '')
    .trim();
  if (t.length < 12 || t.length > 300) return '';
  if (JUNK_TITLE_RE.test(t)) return '';
  /* #777 P0：站点 chrome / feed channel 元数据标题（如 terradaily「关于地球的新闻」、
   * africa.com「类别|africa.com」、pcusa「每日灵修|长老会（美国）」）不是文章标题——
   * 返回空串使该条走模板兜底 + _synthetic 标记，不把频道名冒充为情报标题。 */
  if (TS.isSiteChrome(t, url)) return '';
  /* 至少 4 个字母/文字字符（纯符号数字/货币串非标题） */
  if ((t.match(/[a-zA-Z\u4e00-\u9fff\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\uAC00-\uD7AF]/g) || []).length < 4) return '';
  return t;
}

function _extractTitle(html, url) {
  html = String(html || '');
  if (html.length > HTML_HEAD_LIMIT) html = html.slice(0, HTML_HEAD_LIMIT);
  let m = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']{5,400})["']/i.exec(html)
       || /<meta[^>]+content=["']([^"']{5,400})["'][^>]*property=["']og:title["']/i.exec(html);
  if (m) { const t = _cleanTitle(m[1], url); if (t) return t; }
  m = /<title[^>]*>([\s\S]{0,600}?)<\/title>/i.exec(html);
  if (m) { const t = _cleanTitle(m[1], url); if (t) return t; }
  m = /<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']{5,400})["']/i.exec(html);
  if (m) { const t = _cleanTitle(m[1], url); if (t) return t; }
  return '';
}

async function _fetchTitleOnce(url) {
  let resp;
  try {
    resp = await D.netx.smartFetch(url, {
      timeout: 12000,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'accept-language': 'en,zh;q=0.8' }
    });
  } catch (e) { return ''; }
  if (!resp || !resp.ok) return '';
  let html = '';
  try { html = await resp.text(); } catch (e) { return ''; }
  return _extractTitle(html, url);
}

function _applyReal(it, title, via) {
  it.title = title;
  it._realTitle = true;
  it._realVia = via;                       /* cache | fetch（可观测） */
  delete it._zhTitle;                     /* 真实外文标题必须走统一翻译管线 */
  delete it._archiveEvent;                 /* 真实标题不再是归档合成事件（脱离 GDELT 归档垃圾闸） */
  try { it.source = new URL(it.url).hostname.replace(/^www\./, ''); } catch (e) {}
}

function _applySynthetic(it) {
  it._synthetic = true;                    /* 模板合成兜底（哨兵质量门合成率 ≤5%） */
}

/**
 * 批量回捞真实标题（原地修改 items）。
 * @param {Array} items 归档池条目（须带 _tplTitle + url）
 * @param {object} opts { day } —— 有 day 时启用心跳回写
 * @returns {Promise<{pool,need,real,cached,dead,fail}>}
 */
async function recoverTitles(items, opts) {
  opts = opts || {};
  const stat = { pool: items.length, need: 0, real: 0, cached: 0, dead: 0, fail: 0 };
  try { await ensureTable(); } catch (e) { console.warn('[BF-TITLES] 建缓存表异常:', e.message); }
  const targets = items.filter(it => it && it._tplTitle && it.url);
  stat.need = targets.length;
  if (!targets.length) return stat;

  /* 批量预载缓存（500/批，避免逐条查库） */
  const cached = new Map();
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500).map(t => t.url);
    try {
      const { rows } = await D.query(`SELECT url, title, status, tries FROM backfill_title_cache WHERE url = ANY($1)`, [chunk]);
      rows.forEach(r => cached.set(r.url, r));
    } catch (e) {}
  }

  let hbLast = Date.now();
  const heartbeat = async () => {
    if (!opts.day || Date.now() - hbLast < HEARTBEAT_MS) return;
    hbLast = Date.now();
    try { await D.query(`UPDATE backfill_progress SET started_at=NOW() WHERE day=$1 AND status='running'`, [opts.day]); } catch (e) {}
  };

  let idx = 0;
  async function _worker() {
    for (;;) {
      const k = idx++;
      if (k >= targets.length) return;
      const it = targets[k];
      const c = cached.get(it.url);
      if (c && c.status === 'ok' && c.title) {
        _applyReal(it, c.title, 'cache'); stat.real++; stat.cached++;
      } else if (c && c.status === 'dead') {
        _applySynthetic(it); stat.dead++;
      } else {
        let title = '';
        try {
          title = await Promise.race([
            _fetchTitleOnce(it.url),
            new Promise(r => setTimeout(() => r(''), PER_URL_TIMEOUT_MS))
          ]);
        } catch (e) { title = ''; }
        const tries = ((c && c.tries) || 0) + 1;
        if (title) {
          _applyReal(it, title, 'fetch'); stat.real++;
          try { await D.query(`INSERT INTO backfill_title_cache (url,title,status,tries,fetched_at) VALUES ($1,$2,'ok',$3,NOW())
            ON CONFLICT (url) DO UPDATE SET title=$2, status='ok', tries=$3, fetched_at=NOW()`, [it.url, title, tries]); } catch (e) {}
        } else if (tries >= DEAD_AFTER_TRIES) {
          _applySynthetic(it); stat.dead++;
          try { await D.query(`INSERT INTO backfill_title_cache (url,title,status,tries,fetched_at) VALUES ($1,NULL,'dead',$2,NOW())
            ON CONFLICT (url) DO UPDATE SET status='dead', tries=$2, fetched_at=NOW()`, [it.url, tries]); } catch (e) {}
        } else {
          /* 单次失败：记 retry 待下轮重试，本轮按合成兜底计入预算 */
          _applySynthetic(it); stat.fail++;
          try { await D.query(`INSERT INTO backfill_title_cache (url,title,status,tries,fetched_at) VALUES ($1,NULL,'retry',$2,NOW())
            ON CONFLICT (url) DO UPDATE SET status='retry', tries=$2, fetched_at=NOW()`, [it.url, tries]); } catch (e) {}
        }
      }
      await heartbeat();
      await new Promise(r => setTimeout(r, STAGGER_MS));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => _worker()));
  return stat;
}

function init(deps) {
  D = deps;
  ensureTable().catch(e => console.warn('[BF-TITLES] 初始化建表异常:', e.message));
  console.log('[BF-TITLES] SOURCEURL 真实标题回捞引擎已挂载（并发 ' + CONCURRENCY + ' / 单URL ' + (PER_URL_TIMEOUT_MS / 1000) + 's 帽 / 死链 ' + DEAD_AFTER_TRIES + ' 次判死）');
}

module.exports = { init, recoverTitles, ensureTable };
