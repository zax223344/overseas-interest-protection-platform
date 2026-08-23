/**
 * server/action-collect.js — GitHub Actions 免服务器采集器（方案二：关机也采）
 *
 * 运行环境：GitHub Actions ubuntu-latest（美国机房，GDELT/BBC/AlJazeera 等
 * 被 GFW 阻断的源在此直连可达）。每小时一轮（public 仓库 Actions 免费）。
 *
 * 职责边界（铁律：质量逻辑单源化）：
 *   本脚本【只采不译不过闸门】——抓到的原始条目写入 Neon PG 的
 *   action_raw_items 表；本地 server 的 neon-sync 同步时走既有
 *   chinaOverseasGate + 翻译 + _preInsertGate + 入库 + 分发全链路。
 *
 * 环境变量：
 *   NEON_DATABASE_URL  必填，Neon 免费 PG 连接串（repo secret）
 *   OVERSEAS_PROXY     工作流已设 direct（Runner 上无本地代理，必须禁用回落）
 */
'use strict';

/* 必须先于 require('./globalmedia') 设置——netx 在加载时读取该环境变量 */
if (!process.env.OVERSEAS_PROXY) process.env.OVERSEAS_PROXY = 'direct';

const { Pool } = require('pg');
const globalmedia = require('./globalmedia');

const CONN = process.env.NEON_DATABASE_URL;
if (!CONN) { console.error('[ACTION] 缺少 NEON_DATABASE_URL，请在仓库 Secrets 配置'); process.exit(1); }

const pool = new Pool({ connectionString: CONN, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 15000 });

/* 整体硬上限 6 分钟，防止个别慢源拖死 Runner（工作流另有 timeout-minutes 兜底） */
const HARD_CAP = setTimeout(() => { console.error('[ACTION] 超过 6 分钟硬上限，强制退出'); process.exit(2); }, 6 * 60 * 1000);
HARD_CAP.unref();

const HOUR = new Date().getUTCHours();          // 以 UTC 小时做轮巡游标，24 小时自然轮转
const RSS_ROTATE = 30, TT_ROTATE = 10, THEME_ROTATE = 6;

function _dedupByUrl(arr) {
  const seen = new Set();
  return arr.filter(s => {
    const k = String(s.url || '').replace(/\/+$/, '').toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS action_raw_items (
      id BIGSERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      source TEXT,
      publish_time TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
}

function pickSources() {
  const allRss = globalmedia.DIRECT_RSS || [];
  const srcText = s => ((s.cn || '') + ' ' + (s.name || '') + ' ' + (s.focus || '') + ' ' + (s.region || '')).toLowerCase();
  const chinaBoost = allRss.filter(s => /中国|hong kong|taiwan|macau|chinese|scmp|nikkei asia|cgtn|xinhua|global times|china daily/.test(srcText(s))).slice(0, 15);
  const chinaSet = new Set(chinaBoost.map(s => String(s.url || '').replace(/\/+$/, '').toLowerCase()));
  const asiaBoost = allRss.filter(s => {
    if (chinaSet.has(String(s.url || '').replace(/\/+$/, '').toLowerCase())) return false;
    return /东亚|东南亚|南亚|中亚|东北亚|大洋洲|俄罗斯与独联体|日本|韩国|印度|印尼|新加坡|马来西亚|泰国|越南|菲律宾|缅甸|老挝|柬埔寨|澳大利亚|新西兰|蒙古|亚太|asia|asean|indo-pacific|pacific/.test(srcText(s));
  }).slice(0, 15);
  const rotStart = (HOUR * RSS_ROTATE) % Math.max(1, allRss.length);
  const rotated = allRss.slice(rotStart, rotStart + RSS_ROTATE)
    .concat(allRss.slice(0, Math.max(0, rotStart + RSS_ROTATE - allRss.length)));
  const rssSources = _dedupByUrl(chinaBoost.concat(asiaBoost).concat(rotated));

  const allTt = globalmedia.THINK_TANK_FEEDS || [];
  const chinaTt = allTt.filter(s => /china|chinese|asia|asian|indo-pacific|pacific|merics|asan|lowy|aspi|east asia|siis|ciis|cicir|jiia|nids|kida|iseas|rsis/.test(((s.name || '') + ' ' + (s.focus || '')).toLowerCase())).slice(0, 10);
  const ttStart = (HOUR * TT_ROTATE) % Math.max(1, allTt.length);
  const ttRotated = allTt.slice(ttStart, ttStart + TT_ROTATE)
    .concat(allTt.slice(0, Math.max(0, ttStart + TT_ROTATE - allTt.length)));
  const ttSources = _dedupByUrl(chinaTt.concat(ttRotated));

  const gnAll = globalmedia.GDELT_THEME_QUERIES || [];
  const gnChina = gnAll.slice(0, 4);   // 涉华专项 4 条每小时必查
  const gnRest = gnAll.slice(4);
  const gnStart = gnRest.length ? ((HOUR * THEME_ROTATE) % gnRest.length) : 0;
  const gnQueries = gnChina.concat(
    gnRest.slice(gnStart, gnStart + THEME_ROTATE)
      .concat(gnRest.slice(0, Math.max(0, gnStart + THEME_ROTATE - gnRest.length)))
  );

  return { rssSources, ttSources, gnQueries };
}

/* 轻量卫生过滤：必须有标题+URL；能解析出日期的丢弃 72h 以前旧闻（解析不出的保留，交给本地时效闸） */
function sane(items) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const url = String(it.url || '').trim();
    const title = String(it.title || '').trim();
    if (!url || !title || title.length < 8) continue;
    if (seen.has(url)) continue;
    const t = Date.parse(it.publish_time || it.date || '');
    if (!isNaN(t) && Date.now() - t > 72 * 3600 * 1000) continue;
    seen.add(url);
    out.push(it);
  }
  return out;
}

async function insertBatch(items) {
  let inserted = 0;
  const CHUNK = 50;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const vals = [], params = [];
    chunk.forEach((it, j) => {
      const b = j * 5;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(String(it.url).trim(), String(it.title || '').slice(0, 500), String(it.source || '').slice(0, 200),
        String(it.publish_time || it.date || ''), JSON.stringify(it));
    });
    const r = await pool.query(
      `INSERT INTO action_raw_items (url, title, source, publish_time, payload) VALUES ${vals.join(',')} ON CONFLICT (url) DO NOTHING`,
      params);
    inserted += r.rowCount || 0;
  }
  return inserted;
}

async function main() {
  const t0 = Date.now();
  console.log('[ACTION] 小时=' + HOUR + ' 开始采集（只采不译，Neon 落地）');
  await ensureTable();

  const { rssSources, ttSources, gnQueries } = pickSources();
  console.log('[ACTION] 本轮源: 媒体 ' + rssSources.length + ' / 智库 ' + ttSources.length + ' / GDELT主题 ' + gnQueries.length);

  const [rss, tanks, gnews] = await Promise.all([
    globalmedia.scrapeDirectRss({ sources: rssSources, concurrency: 10, timeout: 12000 }).catch(e => { console.warn('[ACTION] RSS通道异常:', e.message); return { items: [], count: 0 }; }),
    globalmedia.scrapeThinkTanks({ sources: ttSources, concurrency: 10, timeout: 12000 }).catch(e => { console.warn('[ACTION] 智库通道异常:', e.message); return { items: [], count: 0 }; }),
    globalmedia.scrapeGdeltThemes({ queries: gnQueries, maxPerQuery: 25 }).catch(e => { console.warn('[ACTION] GDELT通道异常:', e.message); return { items: [], count: 0 }; })
  ]);

  const all = sane((rss.items || []).concat(tanks.items || []).concat(gnews.items || []));
  console.log('[ACTION] 抓取: 媒体' + (rss.count || 0) + ' / 智库' + (tanks.count || 0) + ' / GDELT' + (gnews.count || 0) + ' → 卫生过滤后 ' + all.length);

  const inserted = await insertBatch(all);
  const pruned = await pool.query(`DELETE FROM action_raw_items WHERE created_at < now() - interval '7 days'`);
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM action_raw_items`);

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('[ACTION] 完成(' + sec + 's): 新入库 ' + inserted + ' / 清理7天前 ' + (pruned.rowCount || 0) + ' / 表存量 ' + rows[0].n);
}

main()
  .then(() => pool.end())
  .then(() => { clearTimeout(HARD_CAP); process.exit(0); })
  .catch(e => { console.error('[ACTION] 失败:', e.message); pool.end().finally(() => process.exit(1)); });
