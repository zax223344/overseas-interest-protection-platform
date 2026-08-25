/* ===== 公众号镜像站直采通道（2026-08-25 用户铁指令：真正实现公众号实时采集） =====
 * 背景（实测）：搜狗微信检索按相关度排序，白名单安全公众号新文永远排不进结果页
 * （刺猬安全出海 baseline 9 条全是 5 个月前旧文，12/22 个账号历史采集为 0）。
 * 已核实多家公众号运营方在公开站点同步发布原文——镜像站=公众号自己的官网/专栏，
 * 内容=公众号原文，时间精确、无反爬、可 15 分钟级直采：
 *   · 鼎泰安元 → 官网新闻中心（ASPCMS，GBK，每日更新，含 8-24 刚果金上加丹加中国公民遇袭案）
 *   · 郑和号   → 观察者网用户号 uid=1199281（JSON 列表 API，含每日海外安全风险日报）
 * 收录条目 _sourceType 沿用 'wechat_oa'（与搜狗/profile_ext 通道同闸门、同面板展示）。
 */
const fs = require('fs');
const path = require('path');
const netx = require('./netx');

const CACHE_DIR = path.join(__dirname, '.cache');
const STATE_FILE = path.join(CACHE_DIR, 'wechat-mirrors.json');
const FRESH_MS = 48 * 3600 * 1000;   /* 镜像只收 48h 内新文（与系统时效铁律一致） */

function _loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; } }
function _saveState(st) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(st));
  } catch (e) {}
}
function _strip(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&ldquo;|&rdquo;/g, '"').replace(/&middot;/g, '·')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
async function _getText(url, enc, timeout) {
  const r = await netx.smartFetch(url, { signal: AbortSignal.timeout(timeout || 15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const buf = Buffer.from(await r.arrayBuffer());
  try { return new TextDecoder(enc || 'utf-8').decode(buf); } catch (e) { return buf.toString('utf8'); }
}

/* ---- 鼎泰安元官网：/list/?1_1.html 列表（GBK，<li> 内含 /content/?id.html + 日期） ---- */
async function _collectDtay(log) {
  const items = [];
  const html = await _getText('http://www.dtaygroup.com/list/?1_1.html', 'gbk');
  const lis = html.match(/<li[\s>][\s\S]*?<\/li>/gi) || [];
  const rows = [];
  for (const li of lis) {
    const am = li.match(/href="(\/?content\/\?(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    const dm = li.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/);
    rows.push({ id: am[2], url: 'http://www.dtaygroup.com/content/?' + am[2] + '.html', title: _strip(am[3]), date: dm ? dm[0].replace(/\//g, '-') : '' });
  }
  /* 兜底：列表 <li> 结构变化时，退化为全页链接+全页日期按序配对 */
  if (!rows.length) {
    const links = [...html.matchAll(/href="\/?content\/\?(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi)];
    const dates = [...html.matchAll(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/g)].map(d => d[0]);
    links.forEach((m, i) => rows.push({ id: m[1], url: 'http://www.dtaygroup.com/content/?' + m[1] + '.html', title: _strip(m[2]), date: (dates[i] || '').replace(/\//g, '-') }));
  }
  for (const r0 of rows) {
    if (!r0.title) continue;
    const ts = r0.date ? new Date(r0.date + 'T00:00:00+08:00').getTime() : 0;
    /* 列表日期精确到日：当天/昨天/前天的才抓正文（列表倒序，遇到超窗即停） */
    if (ts && Date.now() - ts > FRESH_MS) break;
    let body = '';
    try {
      const ah = await _getText(r0.url, 'gbk');
      const cm = ah.match(/<div class="nr_text"[^>]*>([\s\S]*?)<\/div>/i);
      body = _strip(cm ? cm[1] : '').slice(0, 6000);
    } catch (e) { log && log('dtay 正文抓取失败 ' + r0.id + ': ' + e.message); }
    items.push({
      title: r0.title, url: r0.url, content: body, digest: body.slice(0, 200),
      source: '公众号·鼎泰安元（官网镜像）',
      date: ts ? new Date(ts).toISOString() : '', publishedAt: ts ? new Date(ts).toISOString() : '',
      data_type: 'osint_intel', category: '公众号监测', language: 'zh', severity: '中',
      interestLinked: true, _real: true, _fromSource: 'WECHAT_MIRROR:DTAY', _sourceType: 'wechat_oa',
      _mirror: 'dtaygroup', _mirrorId: r0.id, _wechatAccount: '鼎泰安元安全风险管理专家'
    });
  }
  return items;
}

/* ---- 观察者网用户号（郑和号 uid=1199281）：JSON 列表 API ---- */
function _parseRelativeTime(s) {
  const now = Date.now();
  s = String(s || '').trim();
  const m1 = s.match(/(\d+)\s*分钟前/); if (m1) return now - parseInt(m1[1], 10) * 60000;
  const m2 = s.match(/(\d+)\s*小时前/); if (m2) return now - parseInt(m2[1], 10) * 3600000;
  const m3 = s.match(/(\d+)\s*天前/); if (m3) return now - parseInt(m3[1], 10) * 86400000;
  /* "昨天 10:36" / "前天 10:36"（观察者网用户号格式） */
  const my = s.match(/^(昨天|前天)\s*(\d{1,2}):(\d{2})/);
  if (my) {
    const d = new Date();
    d.setDate(d.getDate() - (my[1] === '前天' ? 2 : 1));
    d.setHours(parseInt(my[2], 10), parseInt(my[3], 10), 0, 0);
    return d.getTime();
  }
  /* "08-21 11:27"（当年） */
  const md = s.match(/^(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (md) return new Date(new Date().getFullYear() + '-' + md[1] + '-' + md[2] + 'T' + md[3].padStart(2, '0') + ':' + md[4] + ':00+08:00').getTime();
  const m4 = s.match(/(20\d{2})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (m4) return new Date(m4[1] + '-' + m4[2] + '-' + m4[3] + 'T' + (m4[4] || '00') + ':' + (m4[5] || '00') + ':00+08:00').getTime();
  return 0;
}
async function _collectGuancha(log) {
  const items = [];
  const r = await netx.smartFetch('https://user.guancha.cn/user/get-published-list?uid=1199281&page=1&size=15', {
    signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
  });
  const j = JSON.parse(await r.text());
  const list = (j && j.data && j.data.items) || [];
  let bodyBudget = 6;   /* 正文抓取预算：日报全文 3000+ 字，只给 48h 内新文 */
  for (const a of list) {
    const ts = _parseRelativeTime(a.created_at);
    if (ts && Date.now() - ts > FRESH_MS) continue;
    let body = String(a.summary || '').trim();
    if (bodyBudget > 0) {
      bodyBudget--;
      try {
        const ah = await _getText('https://user.guancha.cn/main/content?id=' + a.id, 'utf-8');
        const cm = ah.match(/<div class="article-txt[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="article-share|<\/article|<section)/i)
          || ah.match(/<div class="article-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const full = _strip(cm ? cm[1] : '');
        if (full.length > body.length) body = full.slice(0, 8000);
      } catch (e) { log && log('guancha 正文抓取失败 ' + a.id + ': ' + e.message); }
    }
    items.push({
      title: String(a.title || '').trim(), url: 'https://user.guancha.cn/main/content?id=' + a.id,
      content: body, digest: body.slice(0, 200),
      source: '公众号·郑和号（观察者网镜像）',
      date: ts ? new Date(ts).toISOString() : '', publishedAt: ts ? new Date(ts).toISOString() : '',
      data_type: 'osint_intel', category: '公众号监测', language: 'zh', severity: '中',
      interestLinked: true, _real: true, _fromSource: 'WECHAT_MIRROR:GUANCHA', _sourceType: 'wechat_oa',
      _mirror: 'guancha', _mirrorId: String(a.id), _wechatAccount: '郑和号'
    });
  }
  return items;
}

const MIRROR_COLLECTORS = [
  { key: 'dtay', name: '鼎泰安元(官网)', fn: _collectDtay },
  { key: 'guancha_zhenghe', name: '郑和号(观察者网)', fn: _collectGuancha }
];

async function collect(opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const st = _loadState();
  const items = [];
  const stats = { mirrors: 0, mirrorsOk: 0, fetched: 0, fresh: 0, errors: [] };
  for (const m of MIRROR_COLLECTORS) {
    stats.mirrors++;
    try {
      const got = await m.fn(log);
      stats.mirrorsOk++;
      stats.fetched += got.length;
      const seen = st[m.key] || [];
      const news = got.filter(it => it._mirrorId && !seen.includes(it._mirrorId));
      stats.fresh += news.length;
      news.forEach(it => items.push(it));
      /* 状态推进：见过的镜像文章 ID 记录（每镜像留 200 个） */
      st[m.key] = seen.concat(news.map(it => it._mirrorId)).slice(-200);
    } catch (e) {
      stats.errors.push(m.name + ': ' + e.message);
      log('镜像采集失败 ' + m.name + ': ' + e.message);
    }
  }
  _saveState(st);
  return { items, stats };
}

module.exports = { collect, MIRROR_COLLECTORS };
