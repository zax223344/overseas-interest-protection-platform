/**
 * 海外利益保护情报预警平台 - Express.js 后端服务器
 * PostgreSQL + JWT 认证 + RESTful API
 */
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const https = require('https');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const { query, testConnection } = require('./db');
const netx = require('./netx'); /* 出网出口层统一 smartFetch（2026-08-29 补引入：原代码 6297 行已使用却未 require，隐性 ReferenceError） */
const scrapers = require('./scrapers');
const crawler = require('./crawler');
const zhPolish = require('./zh-polish'); /* L1 中文译文抛光（2026-08-29 翻译质量改造：尾部媒体/URL/作者残留剥离+缩写全称+标点硬伤） */
const zhRewrite = require('./title-rewrite'); /* L2 标题句式重写（2026-08-29 翻译质量改造：欧化语序/插入语/框架句重组，病句检测命中才动手） */
const agentkey = require('./agentkey');
const geoint = require('./geoint');
const social = require('./social');
const fulltext = require('./fulltext');
const ENTITY = require('../entities.js');
const globalmedia = require('./globalmedia');
const socialmedia = require('./socialmedia');
const cnsecWatch = require('./cn-security-watch'); /* 涉华人员安全专项哨兵（2026-08-25 用户铁指令：中国#袭击/中国#绑架/中国公民#绑架，30分钟一轮） */
const negtool = require('./negtool'); /* 社交媒体采集通道（TG+Reddit，2026-08-13 并入） */
const wechatoa = require('./wechat-oa'); /* 微信公众号实时采集通道（2026-08-21 用户指令：扫码登录+appmsg列表+正文+增量入库） */
const wechatMirrors = require('./wechat-mirrors'); /* 公众号镜像站直采（2026-08-25：搜狗检索拿不到新文的根治方案——鼎泰安元官网/郑和号观察者网号等运营方自有公开站点同步原文） */
const wechatNeg = require('./wechat-negative'); /* 公众号涉华负面专项采集（2026-08-26：组合词改排序+双信号过滤，专治涉华负面新文被埋） */
const wechatLeads = require('./wechat-leads'); /* 公众号线索→全球搜索→抓取入库 四步管线（2026-08-26 用户指令：公众号只查询线索，不再从公众号抓数据入库） */
const coreThreatWatch = require('./core-threat-watch'); /* 海外核心安全威胁一分钟哨兵（2026-08-27 用户铁指令：巴基斯坦/CPEC、阿富汗、非洲、中亚、东南亚 恐袭/袭击/绑架/刑案，1 分钟一轮） */
const INTEREST_BASE = require('./interest-base'); /* 海外利益底数库（2026-08-28 官方框架：国家梯队+六大类项目+通道+经济底数+人员底数+东道国风险指标） */
const channelWatch = require('./channel-watch'); /* 海上战略通道哨兵（维度⑤：八大咽喉点通航/海盗/航运事件，30分钟一轮） */
const complianceWatch = require('./compliance-watch'); /* 制裁合规哨兵（维度⑥：OFAC/实体清单/出口管制/外资审查，30分钟一轮） */
const consularWatch = require('./consular-watch'); /* 领事保护哨兵（维度②：外交部安全提醒/撤侨/领保案件，30分钟一轮） */
const coreThreatSentinel = require('./core-threat-sentinel'); /* 核心威胁专项哨兵（2026-08-28：涉华受害/政变/外资审查等弱类补强，10分钟一轮） */
const sourcesCollector = require('./sources-collector'); /* 94源工程包采集器（2026-08-28：11活源直采+死源GNews site:复活，stance立场标签供证据链交叉验证） */
const projectWatch = require('./project-watch'); /* 重点项目与TIER1弱国哨兵（2026-08-29 审计：BRI命中仅0.1%/沙特印尼哈萨克不足/TIER2八国零覆盖，30分钟一轮） */
const wmFeed = require('./wm-feed'); /* WorldMonitor.app 数据接入哨兵（2026-08-31：UCDP冲突/FCDO领事警示/断网/疫情/新闻摘要，30分钟一轮） */
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'orps_jwt_secret_key_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
/* MyMemory 免费注册 key（可选）：匿名 5000 字符/日 → 注册 key 50000 字符/日，仍免费、非百度 */
const MYMEMORY_KEY = process.env.MYMEMORY_KEY || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

/* ===== 服务端文件缓存（无 PostgreSQL 时的降级存储）=====
 * 仅缓存「公开态势通道」所需的 osint_intel / collect_logs 真实爬取数据，
 * 数据来自 /api/crawl 与 /api/scrape 的真实抓取，绝不编造。 */
const CACHE_DIR = path.join(__dirname, '.cache');
/* 新鲜度闸门：公开缓存只保留近 MAX_AGE_DAYS 天内的真实情报。
 * 无时间戳的条目无法判定新旧，予以保留（避免误删近期社交情报）。
 * 解决"系统里一堆非实时数据"问题——陈旧条目（含 2024 年的）不再滞留与反复展示。 */
const MAX_AGE_DAYS = 45;
function _itemTs(it) {
  const t = it && (it.publishedAt || it.pubDate || it.date || it.collect_time || it.audit_time);
  if (!t) return 0;
  const ms = Date.parse(String(t).replace(/\//g, '-'));
  return isNaN(ms) ? 0 : ms;
}
function _isFresh(it) {
  const ts = _itemTs(it);
  if (!ts) return true;                 // 无时间戳 → 保留
  return (Date.now() - ts) <= MAX_AGE_DAYS * 864e5;
}
function _readCacheRaw(type) {
  try {
    const f = path.join(CACHE_DIR, type + '.json');
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function _readPublicCache(type) {
  try {
    const arr = _readCacheRaw(type);
    /* 铁律①：只返回与我海外利益安全直接关联的数据，旧缓存中无关外讯自动过滤 */
    /* 铁律②：新鲜度闸门——剔除超过 MAX_AGE_DAYS 天的陈旧情报 */
    /* 铁律③：体裁闸门——意识形态评论/学术论述（_commentary）与商业榜单/经济统计
     *（_ranking，如"中国企业500强""《财富》世界500强"）一票否决，绝不入库。
     *  _genreNoise 为二者合集（新版 enrich 统一打标），旧数据可能只有单项标记，故三者并列判定。 */
    return arr.filter(function(it) {
      return it && it.interestLinked === true
        && !it._commentary && !it._ranking && !it._genreNoise
        && _isFresh(it);
    });
  } catch (e) { return []; }
}
function _writePublicCache(type, items) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const arr = Array.isArray(items) ? items : [];
    fs.writeFileSync(path.join(CACHE_DIR, type + '.json'), JSON.stringify(arr.slice(0, 200)), 'utf8');
  } catch (e) { /* 缓存写入失败不影响主流程 */ }
}
/* 增量合并入库（唯一入库口径）。
 * 严重 bug 修复：手动采集端点 /api/scrape、/api/crawl、/api/social 原先直接
 * _writePublicCache(type, 本批items) —— 整体覆盖缓存，导致每次手动采集都把历史
 * 已译中文情报全部抹掉（实测 27 条被一批 14 条覆盖）。改为「旧数据优先保留 + 新数据去重追加」。
 * 说明：_dedupKey / _isNavNoise 在本文件后段定义，函数声明提升保证此处可调用。 */
function _mergePublicCache(type, incoming) {
  var list = Array.isArray(incoming) ? incoming : [];
  var existing = [];
  try { existing = _readPublicCache(type); } catch (e) {}
  var seen = {}, merged = [];
  existing.forEach(function(it) {
    var k = _dedupKey(it);
    if (!k || seen[k]) return;
    seen[k] = 1; merged.push(it);
  });
  var added = 0;
  list.forEach(function(it) {
    if (!it || typeof it !== 'object') return;
    if (it.interestLinked !== true) return;      // 铁律：只入关联我海外利益的数据
    if (!_isFresh(it)) return;                    // 新鲜度闸门
    if (_isNavNoise(it)) return;                  // 导航噪声闸门
    if (_isGenreNoise(it)) return;                // 体裁闸门：评论/论述、商业榜单/经济统计
    var k = _dedupKey(it);
    if (!k || seen[k]) return;
    seen[k] = 1; merged.push(it); added++;
  });
  _writePublicCache(type, merged);
  console.log('[MERGE] ' + type + ' 新增 ' + added + ' 条（本批 ' + list.length + '），缓存现 ' + merged.length + ' 条');
  return { added: added, total: merged.length };
}

/* ===== 中间件 ===== */
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..'), {
  setHeaders: function (res, filePath) {
    // 前端代码强制不缓存：避免浏览器/代理缓存旧版 gate.js/app.js，导致国内噪声清不掉
    if (/\.(html?|js|css|mjs|json)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || req.method !== 'GET') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

/* ===== JWT 认证 ===== */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  try {
    req.user = jwt.verify(header.substring(7), JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录令牌无效或已过期' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员权限' });
  }
  next();
}

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/* ===== 实时情报流 SSE 推送 ===== */
const sseClients = new Set();
function broadcastIntel(payload) {
  const data = 'data: ' + JSON.stringify(payload) + '\n\n';
  sseClients.forEach(client => { try { client.write(data); } catch (e) {} });
}
function verifyTokenQuery(req) {
  const t = req.query.token || '';
  try { return jwt.verify(t, JWT_SECRET); } catch (e) { return null; }
}

/* ===== 常量 ===== */
const INTEL_TYPES = ['terror_events','security_events','military_conflicts','political_events','natural_disasters','public_health','sanctions_data','social_unrest','infrastructure','geopolitical_intel','osint_intel','collect_logs'];
const DH_COLLECTIONS = ['countries','enterprises','alerts','events','warning_rules','chokepoints','corridors','predictions','terror_events','china_security','playbooks','_pending_reviews'];

/* ===== 健康检查 ===== */
app.get('/api/health', async (req, res) => {
  const dbOk = await testConnection();
  res.json({ status: 'ok', version: '2.0.0', database: dbOk ? 'connected' : 'disconnected', time: new Date().toISOString() });
});

/* ===== 认证 API ===== */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
    const result = await query('SELECT * FROM users WHERE username = $1 AND is_active = true', [username]);
    if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: '密码错误' });
    if (user.status !== 'approved') return res.status(403).json({ error: '账号尚未审核通过，请联系管理员' });
    if (user.trial && user.expire_time && new Date(user.expire_time) < new Date()) {
      return res.status(403).json({ error: '试用账号已过期，请联系管理员续期' });
    }
    const token = generateToken(user);
    res.json({ token, user: { name: user.username, role: user.role, status: user.status, trial: user.trial, expireTime: user.expire_time } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(409).json({ error: '用户名已存在' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await query('INSERT INTO users (username, password, role, status) VALUES ($1, $2, $3, $4) RETURNING id, username, role, status', [username, hashed, 'user', 'pending']);
    res.json({ success: true, message: '注册成功，请等待管理员审核', user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/trial', async (req, res) => {
  try {
    const { username, password, days } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(409).json({ error: '用户名已存在' });
    const hashed = await bcrypt.hash(password, 10);
    const expire = new Date();
    expire.setDate(expire.getDate() + parseInt(days || 7, 10));
    const result = await query('INSERT INTO users (username, password, role, status, trial, expire_time) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [username, hashed, 'user', 'approved', true, expire.toISOString()]);
    const user = result.rows[0];
    const token = generateToken(user);
    res.json({ token, user: { name: user.username, role: user.role, status: user.status, trial: user.trial, expireTime: user.expire_time } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/renew-trial', authMiddleware, async (req, res) => {
  try {
    const { username, days } = req.body;
    if (!username || !days) return res.status(400).json({ error: '缺少参数' });
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    const user = result.rows[0];
    let newExpire = (user.expire_time && new Date(user.expire_time) > new Date()) ? new Date(user.expire_time) : new Date();
    newExpire.setDate(newExpire.getDate() + parseInt(days, 10));
    await query('UPDATE users SET expire_time = $1 WHERE username = $2', [newExpire.toISOString(), username]);
    res.json({ success: true, expireTime: newExpire.toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/check', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT id, username, role, status, trial, expire_time FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    const u = result.rows[0];
    res.json({ name: u.username, role: u.role, status: u.status, trial: u.trial, expireTime: u.expire_time });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 用户管理 API ===== */
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await query('SELECT id, username, role, status, reg_time, expire_time, trial, is_default, is_active FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:username/approve', authMiddleware, adminOnly, async (req, res) => {
  try { await query("UPDATE users SET status = 'approved' WHERE username = $1", [req.params.username]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:username/reject', authMiddleware, adminOnly, async (req, res) => {
  try { await query("UPDATE users SET status = 'rejected' WHERE username = $1", [req.params.username]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:username/role', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin','user'].includes(role)) return res.status(400).json({ error: '无效角色' });
    await query('UPDATE users SET role = $1 WHERE username = $2', [role, req.params.username]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:username', authMiddleware, adminOnly, async (req, res) => {
  try {
    if (req.params.username === 'admin') return res.status(400).json({ error: '不能删除默认管理员账号' });
    await query('UPDATE users SET is_active = false WHERE username = $1', [req.params.username]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:username/password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    const hashed = await bcrypt.hash(password, 10);
    await query('UPDATE users SET password = $1 WHERE username = $2', [hashed, req.params.username]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 情报数据 API (DBCenter 11类) ===== */
/* 实时情报流 SSE 端点 */
app.get('/api/stream', (req, res) => {
  // 实时情报流为公开态势驾驶舱数据：允许匿名连接；有token则记录用户(用于审计)
  const user = verifyTokenQuery(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  res.write(': connected\n\n'); // 立即占用连接，避免被中间缓冲判定为空闲而重置
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

/* 公开情报读取：态势驾驶舱只读数据，无需登录。仅限已审核的公开类型，避免暴露敏感内容 */
const PUBLIC_INTEL_TYPES = ['osint_intel','collect_logs'];
/* 涉华情报全量接口（2026-08-13）：直查数据库，不按时间截断 200 条缓存环——
 * 前端"涉华情报列表"原读公开缓存环（仅最新 200 条，涉华只剩十几条），
 * 改为本接口按标题要素（中国/中资/华人/China/Chinese/一带一路等，含 title_zh）全量返回。 */
app.get('/api/intel/china', async (req, res) => {
  try {
    const r = await query(`
      SELECT * FROM intel_data
      WHERE audit_status='approved' AND (
        title ILIKE '%中国%' OR title ILIKE '%中资%' OR title ILIKE '%中企%' OR title ILIKE '%中方%'
        OR title ILIKE '%华人%' OR title ILIKE '%华侨%' OR title ILIKE '%华裔%' OR title ILIKE '%涉华%'
        OR title ILIKE '%对华%' OR title ILIKE '%一带一路%' OR title ILIKE '%驻华%' OR title ILIKE '%访华%'
        OR title ILIKE '%China%' OR title ILIKE '%Chinese%' OR title ILIKE '%Beijing%'
        OR title ILIKE '%Belt and Road%' OR title ILIKE '%CPEC%'
        OR data_json->>'title_zh' ILIKE '%中国%' OR data_json->>'title_zh' ILIKE '%中资%'
        OR data_json->>'title_zh' ILIKE '%中企%' OR data_json->>'title_zh' ILIKE '%华人%'
        OR data_json->>'title_zh' ILIKE '%一带一路%'
      )
      ORDER BY collect_time DESC LIMIT 500`);
    const _seen = {};
    const list = [];
    for (const row of r.rows) {
      const j = row.data_json || {};
      /* 国内新闻硬拦截（2026-08-13 用户指令：只要境外涉华+海外利益安全） */
      if (globalmedia._isDomesticChina && globalmedia._isDomesticChina((row.title || '') + ' ' + (j.title_zh || ''))) continue;
      const k = _normTitleKey(j.title_zh || row.title) || _normTitleKey(row.title);
      if (k && _seen[k]) continue;
      if (k) _seen[k] = 1;
      list.push(Object.assign({}, j, {
        id: row.id,
        title: j.title_zh || row.title || '',
        title_zh: j.title_zh || '',
        title_en: j.title || row.title || '',
        content: j.content_zh || j.content || row.description || '',
        source: row.source || j.source || '',
        country: row.country || j.country_cn || j.country || '',
        time: j.publish_time || row.event_date || row.collect_time,
        collect_time: row.collect_time,
        audit_status: row.audit_status,
        data_type: row.data_type,
        chinaRelated: true,
        _chinaNegative: j._chinaNegative === true || j._chinaNegative === 'true'
      }));
    }
    res.json(list);
  } catch (e) {
    console.warn('[CHINA LIST] 查询失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* 前后端权威同步对账（2026-08-13 体检 P0-3）：返回服务端全部已审核条目 ID，
 * 前端启动时对账——本地有而服务端没有的服务器来源条目（数字ID）一律移除，
 * 解决"服务端已删除、浏览器本地副本仍在"的复发问题。 */
/* ===== 每日简报自动生成（2026-08-14 用户指令）=====
 * 每天 08:00（本地时区）自动汇总前一日已入库审核数据，零虚构：
 * 全部内容来自 PostgreSQL 真实条目的统计与摘录，不调用任何生成式模型。 */
function _escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const _DR_TYPE_NAMES = {
  terror_events: '恐怖袭击/武装袭击', military_conflicts: '武装冲突', social_unrest: '社会动荡',
  sanctions_data: '制裁与合规', political_events: '政治政局', natural_disasters: '自然灾害',
  public_health: '公共卫生', infrastructure: '基础设施与供应链', security_events: '治安事件',
  geopolitical_intel: '地缘动态', osint_intel: '开源情报综合'
};
/* 前一日 key（本地时区，供简报环比） */
function _prevDayKey(dateKey) {
  const parts = String(dateKey).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2] - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function _generateDailyReport(dateKey) {
  const parts = dateKey.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const { rows } = await query(
    "SELECT id, data_type, title, country, severity, source, event_date, collect_time, data_json FROM intel_data WHERE collect_time >= $1 AND collect_time < $2 AND audit_status='approved' ORDER BY collect_time DESC",
    [start, end]
  );
  /* 2026-08-28 涉华口径与全系统统一：用 isChinaRelatedStrict（Chinese 泛称/港台疆藏不再误标） */
  const items = rows.map(r => {
    const j = r.data_json || {};
    return {
      id: r.id, type: r.data_type, title: j.title_zh || r.title || '', country: r.country || j.country_cn || '',
      severity: j.level_norm || r.severity || 'yellow', source: r.source || j.source || '',
      time: j.publish_time || r.event_date || '',
      china: scrapers.isChinaRelatedStrict((r.title || '') + ' ' + (j.title_zh || '')),
      assets: j.asset_tags || [], cred: j.credibility || '', corr: j.corroboration || 0,
      negative: j._chinaNegative === true || j._chinaNegative === 'true',
      _sig: j._eventSig || ''
    };
  });
  /* ===== 事件级去重（2026-08-28 用户指令：简报去重）=====
   * 同一事件多来源/多进展只保留一条：优先事件签名，其次归一化中文标题键。
   * 保留规则：级别更高 > 印证源更多 > 更新。 */
  const _sigOf = i => i._sig && String(i._sig).indexOf('|') >= 0 ? i._sig : 't:' + _normTitleKey(i.title);
  const _lvW = { red: 4, orange: 3, yellow: 2, blue: 1 };
  /* 2026-08-28 简报质量三过滤（用户实测反馈）：
   * ① 体育/娱乐噪声（NBA 阵容混入恐袭类）；② 未翻译外文标题（芬兰语等拉丁小语种，
   *    非拉丁拦截拦不住——展示侧兜底：标题无中文一律不上简报）；③ 泛提及噪声。 */
  const _NOISE_RE = /\bNBA\b|lineup|Premier League|cricket|板球|联赛|锦标赛|世界杯|奥运会|box office|票房/i;
  const itemsClean = items.filter(i => {
    if (_NOISE_RE.test(String(i.title || ''))) return false;
    if (!/[\u4e00-\u9fa5]/.test(String(i.title || ''))) return false; /* 落库即中文铁律：外文标题不上简报 */
    return true;
  });
  const seen = new Map();
  itemsClean.forEach(i => {
    const k = _sigOf(i);
    if (!k || k === 't:') return;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, i); return; }
    const better = (_lvW[i.severity] || 0) * 100 + (i.corr || 0) * 10 > (_lvW[prev.severity] || 0) * 100 + (prev.corr || 0) * 10;
    if (better) seen.set(k, i);
  });
  const uniq = Array.from(seen.values());
  const total = uniq.length;
  const rawTotal = items.length;
  const chinaItems = uniq.filter(i => i.china && !i.negative);
  const negItems = uniq.filter(i => i.negative);
  const reds = uniq.filter(i => i.severity === 'red' && (i.china || i.negative)); /* 2026-09-01 根治：涉华严重事件节必须涉华（用户实测：英国火车站刺杀/印度拘留/尼日利亚土匪等非涉华红色全涌入本节）——isChinaRelatedStrict 与 negative 同口径，非涉华红色留在十二类全景/多源印证节 */
  const byType = {}; uniq.forEach(i => { byType[i.type] = (byType[i.type] || 0) + 1; });
  const byCountry = {}; uniq.forEach(i => { const c = _reportEventCountry(i) || '未标注'; byCountry[c] = (byCountry[c] || 0) + 1; });
  const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const assetHits = uniq.filter(i => i.assets && i.assets.length);
  const corroborated = uniq.filter(i => i.corr >= 2).sort((a, b) => b.corr - a.corr);
  const sanctions = uniq.filter(i => i.type === 'sanctions_data');
  const sources = {}; items.forEach(i => { sources[i.source] = 1; });
  /* 核心威胁（巴基斯坦/CPEC、阿富汗、非洲、中亚、东南亚）单列研判素材 */
  const _CORE_RE = /巴基斯坦|俾路支|瓜达尔|CPEC|中巴经济走廊|阿富汗|喀布尔|尼日利亚|索马里|马里|尼日尔|布基纳法索|刚果|苏丹|埃塞俄比亚|肯尼亚|哈萨克斯坦|乌兹别克|吉尔吉斯|塔吉克|缅甸|泰国|马来西亚|印度尼西亚|菲律宾|Vietnam|Pakistan|Afghanistan/i;
  const coreThreats = uniq.filter(i => _CORE_RE.test(_reportEventCountry(i) + String(i.title || '')) && /terror_events|military_conflicts|security_events/.test(i.type));

  /* ===== 跨节互斥（2026-08-28 用户实测反馈：同一事件在红色节+涉华动态+制裁节重复出现）=====
   * 节优先级：红色 > 资产警报 > 涉华负面 > 涉华动态 > 制裁合规 > 多源印证 > 十二类全景。
   * 已在高位节显示的事件签名，低位节不再重复。 */
  const _shown = new Set();
  function take(list, n) {
    const out = [];
    for (const i of list) {
      const k = _sigOf(i);
      if (k && _shown.has(k)) continue;
      if (k) _shown.add(k);
      out.push(i);
      if (out.length >= n) break;
    }
    return out;
  }
  /* 事件国纠正（用户实测：尼泊尔洪水标📍乌克兰、涉华贸易标📍玻利维亚——DB country
   * 是采集通道国/来源国污染。简报展示一律从标题提取事发国，提不到才用 DB 值）。 */
  function _reportEventCountry(i) {
    const t = String(i.title || '');
    const c = _SIG_COUNTRIES.find(x => t.indexOf(x) >= 0) || _regionToCountry(t);
    return c || String(i.country || '');
  }

  function row(i, extra) {
    const lvName = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' }[i.severity] || i.severity;
    const lvColor = { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' }[i.severity] || '#888';
    const cty = _reportEventCountry(i);
    return '<div style="padding:8px 10px;border-left:3px solid ' + lvColor + ';background:rgba(128,128,128,0.06);border-radius:6px;margin-bottom:6px">'
      + '<div style="font-size:13px;font-weight:600">' + _escapeHtml(i.title) + '</div>'
      + '<div style="font-size:11px;opacity:0.65;margin-top:2px">'
      + '<span style="color:' + lvColor + '">' + lvName + '</span>'
      + (cty ? ' · 📍' + _escapeHtml(cty) : '')
      + (i.time ? ' · 🕐' + _escapeHtml(String(i.time).slice(0, 16)) : '')
      + ' · ' + _escapeHtml(i.source)
      + (i.cred ? ' · 信源' + i.cred + '级' : '')
      + (i.corr > 1 ? ' · 🔗×' + i.corr + ' 印证' : '')
      + (extra || '')
      + '</div></div>';
  }
  function section(title, icon, innerHtml, emptyText) {
    return '<div style="margin:18px 0"><div style="font-size:15px;font-weight:700;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(128,128,128,0.25)">' + icon + ' ' + title + '</div>'
      + (innerHtml || '<div style="opacity:0.5;font-size:12px">' + (emptyText || '当日无相关条目') + '</div>') + '</div>';
  }

  let html = '';
  html += '<div style="opacity:0.7;font-size:12px;margin-bottom:12px">本报告由系统基于当日实际采集入库数据自动汇总生成，未使用任何生成式模型，所有条目均可回溯至数据中心原始记录。</div>';
  const typeRows = Object.entries(byType).sort((a, b) => b[1] - a[1])
    .map(e => '<span style="display:inline-block;margin:2px 6px 2px 0;padding:3px 10px;background:rgba(0,150,255,0.08);border-radius:10px;font-size:12px">' + (_DR_TYPE_NAMES[e[0]] || e[0]) + ' <b>' + e[1] + '</b></span>').join('');
  html += section('采集总览', '📊',
    '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:8px">'
    + '<span>入库总量 <b style="font-size:18px">' + total + '</b></span>'
    + '<span>涉华 <b style="font-size:18px;color:#0a84ff">' + chinaItems.length + '</b></span>'
    + '<span>境外涉华负面 <b style="font-size:18px;color:#ff8800">' + negItems.length + '</b></span>'
    + '<span>红色（涉华严重） <b style="font-size:18px;color:#ff3355">' + reds.length + '</b></span>'
    + '<span>信源 <b style="font-size:18px">' + Object.keys(sources).length + '</b> 家</span></div>'
    + '<div>' + typeRows + '</div>');
  html += section('涉华严重事件（红色）', '🔴', take(reds, 20).map(i => row(i)).join(''), '当日无涉华严重事件');
  html += section('中资海外资产关联警报', '🏗️', take(assetHits, 15).map(i => row(i, ' · 资产：' + _escapeHtml(i.assets.join('、')))).join(''), '当日无资产关联警报');
  /* 涉华动态按级别降序（用户实测：红橙条目沉底、蓝色"学者访谈"置顶——观感差） */
  const chinaSorted = chinaItems.slice().sort((a, b) => (_lvW[b.severity] || 0) - (_lvW[a.severity] || 0) || (b.corr || 0) - (a.corr || 0));
  html += section('涉华动态', '🇨🇳', take(chinaSorted, 15).map(i => row(i)).join(''), '当日无涉华条目');
  html += section('境外涉华负面舆情', '⚠️', take(negItems, 10).map(i => row(i)).join(''), '当日无涉华负面条目');
  html += section('制裁、出口管制与合规动态', '⚖️', take(sanctions, 12).map(i => row(i)).join(''), '当日无制裁合规类条目');
  html += section('多源印证事件（≥2 方独立信源）', '🔗', take(corroborated, 12).map(i => row(i)).join(''), '当日无多源印证事件');
  /* ===== 十二类全景（2026-08-28 用户指令：简报全覆盖，不能只盯着恐袭）=====
   * 每类列当日 TOP2 代表事件；空类如实标注"当日无条目"。 */
  {
    const ALL_TYPES = ['terror_events', 'military_conflicts', 'security_events', 'social_unrest', 'political_events',
      'economic_risk', 'sanctions_data', 'legal_compliance', 'cyber_security', 'infrastructure', 'natural_disasters', 'public_health'];
    let inner = '';
    ALL_TYPES.forEach(t => {
      const list = take(uniq.filter(i => i.type === t), 2);
      const n = byType[t] || 0;
      inner += '<div style="margin:10px 0"><div style="font-size:13px;font-weight:700;color:#0a84ff">' + (_DR_TYPE_NAMES[t] || t)
        + ' <span style="opacity:0.6;font-weight:400">（当日 ' + n + ' 条）</span></div>'
        + (list.length ? list.map(i => row(i)).join('') : '<div style="opacity:0.45;font-size:11px;padding:2px 10px">当日无条目</div>') + '</div>';
    });
    html += section('十二类情报全景', '🗂️', inner);
  }
  html += section('重点国别分布', '🌍',
    topCountries.map(e => {
      const pct = total ? Math.round(e[1] / total * 100) : 0;
      return '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px">'
        + '<span style="min-width:90px">' + _escapeHtml(e[0]) + '</span>'
        + '<div style="flex:1;height:8px;background:rgba(128,128,128,0.15);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:#0a84ff"></div></div>'
        + '<span style="min-width:60px;text-align:right;opacity:0.7">' + e[1] + ' 条</span></div>';
    }).join(''));
  /* ===== 预警研判（2026-08-28 用户指令：简报要增加预警研判）=====
   * 全部结论由当日与前一日真实数据推导：总量环比、红橙态势、核心威胁区聚焦、
   * 升温国别（较前日增量 TOP3）、明日关注建议。零虚构。 */
  {
    let prev = null;
    try {
      const pr = await query('SELECT summary FROM daily_reports WHERE report_date = $1', [_prevDayKey(dateKey)]);
      if (pr && pr.rows && pr.rows[0]) prev = pr.rows[0].summary;
    } catch (e) {}
    const lines = [];
    /* 1. 总量与结构环比 */
    if (prev && typeof prev.total === 'number') {
      const d = total - prev.total;
      const dp = prev.total ? Math.round(d / prev.total * 100) : 0;
      lines.push('<div style="font-size:13px;margin:6px 0">📊 <b>采集环比</b>：昨日事件 ' + prev.total + ' → 今日 ' + total + '（'
        + (d >= 0 ? '+' : '') + d + ' / ' + (dp >= 0 ? '+' : '') + dp + '%），去重后原始条目 ' + rawTotal + ' 条收敛为 ' + total + ' 个独立事件。</div>');
      /* 2. 升温国别 */
      const prevC = (prev.topCountries || []);
      const rises = [];
      topCountries.forEach(([c, n]) => {
        const p = prevC.find(x => x[0] === c);
        const pd = p ? n - p[1] : n;
        if (pd > 0) rises.push([c, pd, n]);
      });
      rises.sort((a, b) => b[1] - a[1]);
      if (rises.length) {
        lines.push('<div style="font-size:13px;margin:6px 0">📈 <b>升温国别</b>：' + rises.slice(0, 3).map(r => _escapeHtml(r[0]) + '（+' + r[1] + '，共' + r[2] + '条）').join('、') + '，建议关注事件升级与外溢风险。</div>');
      }
    } else {
      lines.push('<div style="font-size:13px;margin:6px 0">📊 当日独立事件 ' + total + ' 个（原始 ' + rawTotal + ' 条，已做事件级去重）。</div>');
    }
    /* 3. 红橙态势 */
    const oranges = uniq.filter(i => i.severity === 'orange').length;
    lines.push('<div style="font-size:13px;margin:6px 0">🚨 <b>预警分级态势</b>：红 ' + reds.length + ' / 橙 ' + oranges + '，红色事件' + (reds.length ? '须当日核实处置闭环' : '为零（按红区铁律仅中国公民被袭/被绑/撤侨/群体枪击事件可赋红）') + '。</div>');
    /* 4. 核心威胁区聚焦 */
    const coreByC = {};
    coreThreats.forEach(i => { const c = _reportEventCountry(i) || '未标注'; coreByC[c] = (coreByC[c] || 0) + 1; });
    const coreTop = Object.entries(coreByC).sort((a, b) => b[1] - a[1]).slice(0, 5);
    lines.push('<div style="font-size:13px;margin:6px 0">🎯 <b>核心威胁区</b>（巴基斯坦/CPEC、阿富汗、非洲、中亚、东南亚）：当日恐袭/冲突/治安事件 ' + coreThreats.length + ' 条'
      + (coreTop.length ? '，集中于 ' + coreTop.map(e => _escapeHtml(e[0]) + ' ' + e[1] + ' 条').join('、') : '') + '。</div>');
    /* 5. 明日关注建议（由数据推导，不虚构） */
    const focus = [];
    if (reds.length) focus.push('红色事件处置闭环核查');
    if (assetHits.length) focus.push('中资资产关联警报跟踪');
    if (coreThreats.length >= 5) focus.push('核心威胁区态势持续监测');
    if (chinaItems.length + negItems.length >= 10) focus.push('涉华情报专项复核');
    if (prev && topCountries[0]) focus.push(_escapeHtml(topCountries[0][0]) + '升温动态跟踪');
    lines.push('<div style="font-size:13px;margin:6px 0">📋 <b>明日关注建议</b>：' + (focus.length ? focus.join('；') : '常规监测') + '。</div>');
    html += section('预警研判', '🧭', lines.join(''));
  }

  const summary = { total, china: chinaItems.length, negative: negItems.length, red: reds.length, sources: Object.keys(sources).length, byType, topCountries };
  await query(`CREATE TABLE IF NOT EXISTS daily_reports (report_date TEXT PRIMARY KEY, html TEXT, summary JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await query(`INSERT INTO daily_reports (report_date, html, summary, created_at) VALUES ($1, $2, $3, NOW())
               ON CONFLICT (report_date) DO UPDATE SET html=$2, summary=$3, created_at=NOW()`,
    [dateKey, html, JSON.stringify(summary)]);
  return { date: dateKey, total, html, summary };
}

/* ===== 非预警数据池（2026-08-28 用户指令：所有采集数据必须可见）=====
 * 采集到的数据被任何闸门拦截（旧闻/重复/国内/低质/单源未印证…）不再静默消失，
 * 一律写入 intel_sidepool，前端「非预警数据池」功能区可视化 + 支持人工提升入库。
 * 表启动即建。 */
let _sidepoolReady = false;
async function _ensureSidepool() {
  if (_sidepoolReady) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS intel_sidepool (
      id BIGSERIAL PRIMARY KEY,
      reason TEXT, source_tag TEXT, data_type TEXT,
      title TEXT, title_zh TEXT, url TEXT, country TEXT,
      data_json JSONB, blocked_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sidepool_blocked ON intel_sidepool(blocked_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sidepool_url ON intel_sidepool(url)`);
    _sidepoolReady = true;
  } catch (e) { console.warn('[SIDEPOOL] 建表失败:', e.message); }
}
const _sidepoolSeen = new Set();
async function _sidepool(it, reason, tag) {
  try {
    const u = String(it.url || '').trim();
    if (u) { const k = u.toLowerCase().replace(/[?#].*$/, '');
      if (_sidepoolSeen.has(k)) return; _sidepoolSeen.add(k);
      if (_sidepoolSeen.size > 5000) _sidepoolSeen.clear(); }
    await _ensureSidepool();
    await query(
      `INSERT INTO intel_sidepool (reason, source_tag, data_type, title, title_zh, url, country, data_json)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM intel_sidepool WHERE url=$6 AND blocked_at >= NOW() - INTERVAL '3 days')`,
      [reason, tag || '', it.data_type || '', String(it.title || '').slice(0, 300), String(it.title_zh || '').slice(0, 300), u || '', String(it.country || it.country_cn || '').slice(0, 60), JSON.stringify({ ...(it || {}), _blockReason: reason })]
    );
  } catch (e) { /* 池写失败不阻塞主链路 */ }
}

/* ===== 数据完整性巡检哨兵（2026-08-14 用户指令：要面对实战单位，杜绝灌水/复活复发）=====
 * 每 30 分钟自动巡检当日数据，发现问题自动清洗并日志告警：
 *  1. 标题重复率 > 3%（前端灌水/通道异常的早期信号）→ 自动去重（同题留最早）
 *  2. 删除名单条目复活（用户明令删除的数据）→ 立即删除
 *  3. 国内新闻混入（标题级判定）→ 删除
 * 一切动作写日志，可在 pm2 logs 中审计。 */
async function _integrityWatchdog() {
  try {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const { rows } = await query(
      "SELECT id, title, data_json->>'title_zh' AS tzh, data_json->>'_fromSource' AS fs, data_json->>'_sourceType' AS st, data_json->>'chinaRelated' AS cr FROM intel_data WHERE collect_time >= $1 ORDER BY id ASC",
      [d0]
    );
    if (!rows.length) return;
    const seen = {}, delDup = [], delBlocked = [], delDomestic = [];
    for (const r of rows) {
      const t = String(r.title || '');
      /* 删除名单 */
      if (_POST_BLOCK_RE.test(t + ' ' + String(r.tzh || ''))) { delBlocked.push(r.id); continue; }
      /* 国内新闻
       * 2026-08-31 豁免对齐（WM 走廊条目被误删根因）：入库闸 _preInsertGate 已给
       * wm_feed+chinaRelated 条目加了国内豁免，但 watchdog 复扫没同步 → 中国走廊控制塔
       * 4 条入库 30min 内被巡检当"国内混入"删除。两处判定必须同源豁免。 */
      const _wmChina = r.st === 'wm_feed' && r.cr === 'true';
      const _trChina = r.st === 'threatroom' && r.cr === 'true'; /* 2026-08-31：专项作战室同源豁免（防中资项目检索条目被复扫误删） */
      if (!_wmChina && !_trChina && globalmedia._isDomesticChina && globalmedia._isDomesticChina(t + ' ' + String(r.tzh || ''))) { delDomestic.push(r.id); continue; }
      /* 标题重复 */
      const k1 = _normTitleKey(t), k2 = _normTitleKey(r.tzh);
      if ((k1.length >= 10 && seen[k1]) || (k2.length >= 10 && seen[k2])) { delDup.push(r.id); continue; }
      if (k1.length >= 10) seen[k1] = 1;
      if (k2.length >= 10) seen[k2] = 1;
    }
    const del = delBlocked.concat(delDomestic, delDup);
    if (del.length) {
      let done = 0;
      for (let i = 0; i < del.length; i += 400) {
        const b = del.slice(i, i + 400);
        const ph = b.map((_, j) => '$' + (j + 1)).join(',');
        const d = await query('DELETE FROM intel_data WHERE id IN (' + ph + ')', b);
        done += d.rowCount;
      }
      console.warn('[WATCHDOG] ⚠️ 自动清洗 ' + done + ' 条（重复 ' + delDup.length + ' / 删除名单复活 ' + delBlocked.length + ' / 国内混入 ' + delDomestic.length + '），当日总量 ' + rows.length + ' → ' + (rows.length - done));
    }
    const dupRate = rows.length ? (delDup.length / rows.length * 100).toFixed(1) : '0';
    if (parseFloat(dupRate) > 3) console.warn('[WATCHDOG] 当日重复率 ' + dupRate + '% 偏高，请关注前端同步引擎或通道异常');
    /* 社媒通道采集量 + 重点数据触达检查（2026-08-14 用户指令） */
    try {
      const d1 = new Date(); d1.setHours(0, 0, 0, 0);
      const sm = await query("SELECT COUNT(*) c FROM intel_data WHERE collect_time >= $1 AND data_json->>'_sourceType'='social_media'", [d1]);
      const sev = await query("SELECT severity, COUNT(*) c FROM intel_data WHERE collect_time >= $1 AND severity IN ('red','orange') GROUP BY 1", [d1]);
      const sevMap = {}; sev.rows.forEach(x => { sevMap[x.severity] = x.c; });
      console.log('[WATCHDOG] 当日社媒采集 ' + sm.rows[0].c + ' 条；重点数据（红' + (sevMap.red || 0) + '/橙' + (sevMap.orange || 0) + '）已随 Feed 分层置顶推送预警中心');
      if (parseInt(sm.rows[0].c, 10) === 0) console.warn('[WATCHDOG] ⚠️ 社媒通道今日零产出——检查本机 7897 代理是否在运行');
    } catch (e) {}
  } catch (e) { console.warn('[WATCHDOG] 巡检异常:', e.message); }
}
/* ===== 涉华负面专项巡检哨兵（2026-08-14 用户指令：每30分钟巡检，让每日涉华负面更多更好）=====
 * 巡检内容：当日负面产量 vs 时间加权目标（50/天）→ 落后即清零 AP 冷却并立即加跑一轮；
 * 产出速率/全天预估/分类分布写日志；近 20 条抽样质检（强化负面判定复核）。 */
async function _negSentinel() {
  try {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const r = await query(
      "SELECT COUNT(*) c FROM intel_data WHERE collect_time >= $1 AND (data_json->>'_chinaNegative'='true' OR data_json->>'_chinaNegative'='true')",
      [d0]
    );
    const cnt = parseInt(r.rows[0].c, 10) || 0;
    const now = new Date();
    const dayRatio = Math.max(0.01, (now - d0) / (24 * 3600 * 1000));
    const expected = Math.round(50 * dayRatio * 0.85);
    const hoursElapsed = Math.max(0.5, (now - d0) / 3600000);
    const rate = (cnt / hoursElapsed).toFixed(1);
    const projection = Math.round(cnt / hoursElapsed * 24);
    /* 分类分布 */
    const cats = await query(
      "SELECT data_json->>'_negCat' cat, COUNT(*) c FROM intel_data WHERE collect_time >= $1 AND data_json->>'_negCat' IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 5",
      [d0]
    );
    const catStr = cats.rows.map(x => x.cat + ':' + x.c).join(' ') || '（专用工具暂无产出）';
    console.log('[NEG-SENTINEL] 今日涉华负面 ' + cnt + '/50（时点期望 ' + expected + '）| 速率 ' + rate + ' 条/h | 全天预估 ' + projection + ' 条 | 分类 ' + catStr);
    if (cnt < expected) {
      console.warn('[NEG-SENTINEL] ⚠️ 负面采集落后 ' + (expected - cnt) + ' 条，清零冷却并立即加跑一轮');
      _chinaNegativeLastApAt = 0;
      setTimeout(() => { _runChinaNegative(); }, 3000);
    }
    /* 抽样质检：近 20 条负面是否真负面 */
    const sample = await query(
      "SELECT title, data_json->>'title_zh' tzh FROM intel_data WHERE collect_time >= $1 AND data_json->>'_chinaNegative'='true' ORDER BY collect_time DESC LIMIT 20",
      [d0]
    );
    let bad = 0;
    sample.rows.forEach(x => { if (!negtool._isChinaNegativeStrong((x.title || '') + ' ' + (x.tzh || ''))) bad++; });
    if (bad > 0) console.warn('[NEG-SENTINEL] 质检：近20条中 ' + bad + ' 条负面特征不足，请关注闸门');
  } catch (e) { console.warn('[NEG-SENTINEL] 巡检异常:', e.message); }
}
/* ===== 实时性巡检哨兵（2026-08-14 用户指令：所有数据/统计必须实时更新，不实时就修）=====
 * 每 30 分钟检查"数据活水"：最近30分钟入库数、各通道今日产出、最新条目年龄。
 * 发现停滞（30分钟零入库）自动重启全部采集通道并告警——不等人工发现。 */
async function _freshnessSentinel() {
  try {
    const r = await query("SELECT COUNT(*) c, MAX(collect_time) latest FROM intel_data WHERE collect_time >= NOW() - INTERVAL '30 minutes'");
    const recent = parseInt(r.rows[0].c, 10) || 0;
    const latest = r.rows[0].latest;
    const ageMin = latest ? Math.round((Date.now() - new Date(latest).getTime()) / 60000) : -1;
    /* 通道产出 */
    const ch = await query("SELECT data_json->>'_sourceType' st, COUNT(*) c FROM intel_data WHERE collect_time >= CURRENT_DATE GROUP BY 1 ORDER BY c DESC");
    const chStr = ch.rows.map(x => (x.st || '未知') + ':' + x.c).join(' | ');
    console.log('[FRESH-SENTINEL] 近30分钟入库 ' + recent + ' 条 | 最新条目 ' + ageMin + ' 分钟前 | 今日通道分布: ' + chStr);
    if (recent === 0) {
      console.warn('[FRESH-SENTINEL] ⚠️ 30分钟零入库，采集心跳停止——自动重启全部采集通道');
      _globalMediaBusyUntil = 0; _chinaFocusBusyUntil = 0; _chinaNegativeBusyUntil = 0; _terrorBusyUntil = 0;
      setTimeout(() => { _runGlobalMedia(); }, 2000);
      setTimeout(() => { _runChinaFocus(); }, 8000);
      setTimeout(() => { _runChinaNegative(); }, 15000);
      setTimeout(() => { _runTerrorAttacks(); }, 22000);
    }
    /* 通道级停滞检测：某通道 2 小时零产出告警 */
    const stall = await query("SELECT data_json->>'_sourceType' st, MAX(collect_time) latest FROM intel_data WHERE collect_time >= NOW() - INTERVAL '6 hours' GROUP BY 1");
    const stallMap = {};
    stall.rows.forEach(x => { stallMap[x.st] = Math.round((Date.now() - new Date(x.latest).getTime()) / 60000); });
    ['social_media', 'gdelt_theme', 'channel_watch', 'china_negative'].forEach(k => {
      const age = stallMap[k];
      if (age === undefined || age > 120) console.warn('[FRESH-SENTINEL] ⚠️ 通道 ' + k + ' ' + (age === undefined ? '近6小时零产出' : '已停滞 ' + age + ' 分钟'));
    });
  } catch (e) { console.warn('[FRESH-SENTINEL] 巡检异常:', e.message); }
}
setInterval(_freshnessSentinel, 30 * 60 * 1000);
setTimeout(_freshnessSentinel, 3 * 60 * 1000);

setInterval(_negSentinel, 30 * 60 * 1000);
setTimeout(_negSentinel, 2 * 60 * 1000); /* 启动 2 分钟后首跑 */

/* ===== 交付质量哨兵（2026-08-15 用户指令：同一问题不能反复出现，部署交付后系统自愈）=====
 * 把历次用户投诉固化为铁律自检项，每30分钟巡查、发现即自动修，不靠人工发现：
 *  ① 共享预警库只留 24h 滚动窗内数据（2026-08-31 零点清零根治：跨满 24h 的旧预警/无时间无编号条目自动清除，零点不再悬崖式清零）；
 *  ② 历史静态种子黑名单裸条目（无原文链接）无论藏在哪个库一律清除；
 *  ③ 今日入库统计口径（全库）抽查可见；
 * 巡检结果经 GET /api/quality 对外透明，前端系统设置页可视化。 */
let _qualityReport = { at: null, ok: true, checks: [], actions: [] };
async function _qualityGuardian() {
  const checks = [], actions = [];
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    /* 2026-08-31 零点清零根治（用户铁律：预警中心数据不能一到零点就全部清零）：
     * 「今日零点」日历日切割 → 24h 滚动窗。与 _serverAlertGen 24h 回看、PUT 写入闸、
     * GET 下发闸、前端 _purgeAlertsNotToday 五窗合一：
     * ① 零点不再有悬崖式清零——条目发布满 24h 才平滑退出；
     * ② 生成器(3min·24h回看)与巡检(30min·原当日化)不再互搏，数字 3↔8 震荡根除。 */
    const ds = Date.now() - 24 * 3600 * 1000;
    const tkSet = new Set([new Date(), new Date(ds)].map(d =>
      String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')));
    /* ① 共享预警库滚动窗清洗 + 黑名单 */
    try {
      const r = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
      if (r.rows.length && Array.isArray(r.rows[0].data_json)) {
        const arr = r.rows[0].data_json;
        const kept = arr.filter(a => {
          const txt = String(a.title || '') + String(a.title_zh || '');
          if (!a.url && _POST_BLOCK_RE.test(txt)) return false;
          const t = new Date(a.time || a.date || a.publishedAt || a.collect_time || '').getTime();
          if (t) return t >= ds;   /* 24h 滚动窗 */
          const m = String(a.alert_no || '').match(/(20\d{6})/);
          return m ? tkSet.has(m[1]) : false;
        });
        if (kept.length !== arr.length) {
          await query('UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2', [JSON.stringify(kept), 'alerts']);
          actions.push('共享预警库剔除超24h/黑名单 ' + (arr.length - kept.length) + ' 条');
        }
        checks.push({ name: '共享预警库24h滚动窗', ok: true, detail: kept.length + ' 条（24h 窗内）' });
      }
    } catch (e) { checks.push({ name: '共享预警库24h滚动窗', ok: false, detail: e.message }); }
    /* ② 黑名单裸条目扫描（全库任何日期，无原文链接的静态种子） */
    try {
      const r2 = await query("SELECT id, title, data_json->>'title_zh' tzh FROM intel_data WHERE data_json->>'url' IS NULL OR data_json->>'url'=''");
      const bad = r2.rows.filter(x => _POST_BLOCK_RE.test((x.title || '') + ' ' + (x.tzh || '')));
      if (bad.length) {
        const ids = bad.map(x => x.id);
        const marks = ids.map((_, i) => '$' + (i + 1)).join(',');
        await query('DELETE FROM intel_data WHERE id IN (' + marks + ')', ids);
        actions.push('情报库清除黑名单裸条目 ' + bad.length + ' 条');
      }
      checks.push({ name: '黑名单裸条目', ok: true, detail: bad.length ? '已清除 ' + bad.length + ' 条' : '0 命中' });
    } catch (e) { checks.push({ name: '黑名单裸条目', ok: false, detail: e.message }); }
    /* ③ 今日入库（全库口径，顶栏与采集指标共用此数） */
    try {
      const r3 = await query("SELECT COUNT(*) c FROM intel_data WHERE audit_status='approved' AND collect_time >= $1", [dayStart]);
      checks.push({ name: '今日入库(全库口径)', ok: true, detail: r3.rows[0].c + ' 条' });
      /* 利益关联哨兵结果并入 */
      if (typeof _valueSentinelState !== 'undefined' && _valueSentinelState.at) {
        checks.push({ name: '预警利益关联', ok: true, detail: '在队 ' + _valueSentinelState.kept + ' 条 · 本轮移出无关联 ' + _valueSentinelState.demoted + ' 条 · 平均关联分 ' + _valueSentinelState.avgScore });
      }
    } catch (e) { checks.push({ name: '今日入库统计', ok: false, detail: e.message }); }
  } catch (e) { actions.push('巡检异常: ' + e.message); }
  const ok = checks.every(c => c.ok);
  _qualityReport = { at: new Date().toISOString(), ok, checks, actions };
  console.log('[QUALITY] 巡检：' + (ok ? '全部达标' : '存在异常') + (actions.length ? ' | 自愈动作: ' + actions.join('；') : ' | 无需动作'));
}
/* ===== 预警利益关联哨兵（2026-08-16 用户铁律：预警中心是核心中的核心）=====
 * 实战标准：每条预警必须体现对中国海外利益（人员/项目/资产/通道/声誉）的影响。
 * 每30分钟巡查共享预警库：五维利益关联评分——
 *   涉华要素(30) + 中资资产命中(30) + 威胁组织关联(10) + 伤亡烈度(20/8) + BRI沿线国(10)
 * 红/橙级一律保留（高烈度事件本身构成环境风险）；
 * 黄/蓝级且关联分<20 的为"与我无关的泛新闻"，移出预警中心（数据中心仍可查）。
 * 巡检结果并入 /api/quality 报告。 */
const _INTEREST_CN_RE = /中国|中资|中企|中方|华人|华侨|华裔|一带一路|涉华|对华|驻[^，。]{0,4}使馆|孔子|撤侨|Chinese|China|Beijing|CPEC|Belt and Road/i;
const _INTEREST_ASSET_RE = /瓜达尔|中巴经济走廊|汉班托塔|比雷埃夫斯|皎漂|中老铁路|雅万|蒙内|亚吉|钱凯|科伦坡港口城|中白工业园|吉布提|莱基|坦赞|西芒杜|中欧班列|China Railway Express/i;
const _INTEREST_ORG_RE = /塔利班|青年党|博科圣地|伊斯兰国|基地组织|胡塞|真主党|哈马斯|俾路支|Taliban|Shabaab|Boko|ISIS|Qaeda|Houthi|BLA|TTP/i;
const _BRI_COUNTRIES = ['巴基斯坦', '哈萨克斯坦', '乌兹别克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '土库曼斯坦', '老挝', '柬埔寨', '缅甸', '印度尼西亚', '马来西亚', '泰国', '越南', '塞尔维亚', '匈牙利', '希腊', '埃塞俄比亚', '肯尼亚', '吉布提', '埃及', '斯里兰卡', '孟加拉国', '尼泊尔', '沙特阿拉伯', '阿联酋', '土耳其', '白俄罗斯', '波兰'];
/* 重点关注国全集（2026-08-17：BRI 沿线 + 中资企业高风险所在国——这些国家的安全事件
 * 本身就构成中方人员/项目的环境风险，利益关联 +20；俄乌/欧美本土日常不在此列） */
const _FOCUS_COUNTRIES = [...new Set(_BRI_COUNTRIES.concat(['苏丹', '刚果(金)', '刚果（金）', '尼日利亚', '伊拉克', '也门', '马里', '尼日尔', '索马里', '阿富汗', '叙利亚', '利比亚', '中非', '莫桑比克', '坦桑尼亚', '赞比亚', '津巴布韦', '安哥拉', '摩洛哥', '突尼斯', '阿尔及利亚', '约旦', '黎巴嫩', '伊朗', '印度', '菲律宾', '哥伦比亚', '秘鲁', '墨西哥', '南非', '阿根廷', '智利', '委内瑞拉', '蒙古', '喀麦隆', '乍得', '南苏丹']))];
const _RUUA_TOPIC_RE = /乌克兰|俄罗斯|Ukraine|Ukrainian|Russia|Russian|Kyiv|Moscow|Zelensky|Putin|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯/i;
function _isRuUaNoLink(it) {
  const txt = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.desc || it.content || '');
  if (!_RUUA_TOPIC_RE.test(txt)) return false;
  return !(_INTEREST_CN_RE.test(txt) || _INTEREST_ASSET_RE.test(txt));
}
/* 模板空壳判定（2026-08-17）：「国A-国B冲突」式九字标题 + 无链接 = 旧客户端模板生成物，非情报 */
function _isShellAlert(it) {
  const t = String((it && (it.title || '')) || '').trim();
  const tz = String((it && (it.title_zh || '')) || '');
  if (/美国-委内瑞拉冲突/.test(t + tz)) return true;
  if (/^[^-—\s]{2,12}[-—][^-—\s]{2,12}冲突$/.test(t) && !(it && it.url)) return true;
  const c = String((it && (it.content || it.desc || '')) || '').trim();
  if (!t) return true;
  if (!(it && it.url) && c.length < 30) return true; /* 无链接且正文不足30字 = 空壳 */
  return false;
}

/* ===== 拦截审计（2026-08-17 用户指令：闸门拦了什么必须可见可审计）===== */
const _GATE_AUDIT = { since: new Date().toISOString(), total: 0, by: {}, samples: {} };
function _gateAudit(gate, reason, title) {
  try {
    _GATE_AUDIT.total++;
    const k = gate + '|' + reason;
    const n = (_GATE_AUDIT.by[k] = (_GATE_AUDIT.by[k] || 0) + 1);
    const arr = _GATE_AUDIT.samples[k] || (_GATE_AUDIT.samples[k] = []);
    arr.unshift({ t: new Date().toTimeString().slice(0, 5), title: String(title || '').slice(0, 70) });
    if (arr.length > 5) arr.length = 5;
    /* 关键闸门（单源旧闻）必须显式落在日志里，便于用户验证多源印证生效 */
    if (reason === 'stale-single-source' && (n <= 3 || n % 10 === 0)) {
      console.log('[GATE] stale-single-source #' + n + ': ' + String(title || '').slice(0, 80));
    }
    /* 2026-08-30 语义查重拦截：低频落日志（用户点名的重复采集一类问题，需可观测） */
    if (reason === 'event-sig-dup-sem' && (n <= 5 || n % 20 === 0)) {
      console.log('[GATE] event-sig-dup-sem #' + n + ': ' + String(title || '').slice(0, 80));
    }
    /* 2026-08-30 无国别锚拒收：低频落日志（空 country 一类问题治理效果可观测） */
    if (reason === 'no-country' && (n <= 5 || n % 50 === 0)) {
      console.log('[GATE] no-country #' + n + ': ' + String(title || '').slice(0, 80));
    }
  } catch (e) {}
}
app.get('/api/quality/gates', authMiddleware, (req, res) => {
  const rows = Object.keys(_GATE_AUDIT.by).map(k => {
    const [gate, reason] = k.split('|');
    return { gate, reason, count: _GATE_AUDIT.by[k], samples: _GATE_AUDIT.samples[k] || [] };
  }).sort((a, b) => b.count - a.count);
  res.json({ since: _GATE_AUDIT.since, total: _GATE_AUDIT.total, rows });
});

function _alertInterestScore(a) {
  const txt = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
  let sc = 0;
  const hits = [];
  if (_INTEREST_CN_RE.test(txt)) { sc += 30; hits.push('涉华'); }
  if (_INTEREST_ASSET_RE.test(txt) || (a.asset_tags && a.asset_tags.length)) { sc += 30; hits.push('资产'); }
  if (_INTEREST_ORG_RE.test(txt)) { sc += 10; hits.push('威胁组织'); }
  const dm = txt.match(/(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
  const deaths = dm ? parseInt(dm[1] || dm[2], 10) : 0;
  if (deaths >= 10) { sc += 20; hits.push('重大伤亡'); } else if (deaths > 0) { sc += 8; hits.push('伤亡'); }
  if (_FOCUS_COUNTRIES.indexOf(String(a.country || '')) >= 0) { sc += 20; hits.push('重点关注国'); }
  if (a.corroboration > 1) sc += 5;
  return { score: sc, hits: hits };
}
/* ===== 服务端预警生成器（2026-08-17 用户指令：预警中心数据太少）=====
 * 旧架构：预警在浏览器端生成——没人开页面就没有新预警，这是"数据太少"的根因。
 * 现改为服务端生成：采集入库后 3 分钟内评估，达利益关联阈值即生成预警写入共享库，
 * 任何客户端打开即见。规则与前端 distribute 同源：利益关联分≥20（含重点国+20）。 */
const _FOCUS_COUNTRIES_SRV = ['巴基斯坦', '苏丹', '缅甸', '刚果', '尼日利亚', '伊拉克', '也门', '马里', '尼日尔', '肯尼亚', '埃塞俄比亚', '秘鲁', '墨西哥', '南非', '伊朗', '印度', '土耳其', '埃及', '哥伦比亚', '菲律宾', '阿富汗', '叙利亚', '孟加拉国', '泰国', '阿尔及利亚', '阿根廷', '智利', '委内瑞拉', '利比亚', '索马里', '中非', '莫桑比克', '坦桑尼亚', '赞比亚', '津巴布韦', '乌克兰', '阿联酋', '沙特', '哈萨克斯坦', '蒙古', '老挝', '柬埔寨', '印度尼西亚', '马来西亚', '越南', '安哥拉', '摩洛哥', '突尼斯', '约旦', '塞尔维亚', '黎巴嫩', '以色列', '巴勒斯坦', '南苏丹', '斯里兰卡', '尼泊尔', '日本', '韩国', '朝鲜', '新加坡', '乌兹别克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '土库曼斯坦', '巴西', '厄瓜多尔', '玻利维亚', '法国', '德国', '英国', '意大利', '西班牙', '波兰'];
function _srvAlertScore(it) {
  const txt = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.desc || '');
  let sc = 0;
  if (_INTEREST_CN_RE.test(txt)) sc += 30;
  if (_INTEREST_ASSET_RE.test(txt)) sc += 30;
  if (_INTEREST_ORG_RE.test(txt)) sc += 10;
  const dm = txt.match(/(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
  const dn = dm ? parseInt(dm[1] || dm[2], 10) : 0;
  if (dn >= 10) sc += 20; else if (dn > 0) sc += 8;
  const ctry = String(it.country || it.country_cn || '');
  if (_BRI_COUNTRIES.indexOf(ctry) >= 0) sc += 10;
  if (_FOCUS_COUNTRIES_SRV.some(c => ctry.indexOf(c) >= 0)) sc += 20;
  return sc;
}
/* 预警队列国别均衡帽（2026-08-25 用户指令：预警指挥台不能全是美/伊/叙，国别必须有多样性）：
 * 列表为最新在前，每国最多保留 12 条最新，超出丢弃；同时清 >72h 陈条目（旧闻双保险）。 */
const ALERT_QUEUE_COUNTRY_CAP = 20; /* 2026-08-31 用户指令"量要大"：12→20，核心区条目本就不占帽 */
function _capAlertQueue(list) {
  const now = Date.now();
  const seen = {};
  const out = [];
  for (const a of list) {
    if (!a) continue;
    const t = Date.parse(a.publishedAt || '') || Date.parse(String(a.time || '').replace(' ', 'T')) || 0;
    if (t && now - t > 72 * 3600 * 1000) continue;
    /* 2026-08-25 赋分改革根因修复：红区预警（涉华人员伤亡/绑架，≥61 分）豁免国别帽。
     * 均衡帽本为压制美/伊/叙刷屏，绝不该把"启动应急预案"级的红区预警挤掉。
     * 2026-08-29 两区渲染（用户指令：预警中心有重点和核心）：核心区条目（is_core：
     * 核心威胁/资产项目通道命中/红区/涉华中高危，详见 _alertIsCore）同样豁免国别帽。 */
    const isRed = a.risk_zone === 'red' || (a.risk_score != null && a.risk_score >= 61) || a.level === 'red';
    const isCore = isRed || a.is_core === true || !!a.core_threat_name;
    if (!isCore) {
      const c = String(a.country || '未知').trim() || '未知';
      seen[c] = (seen[c] || 0) + 1;
      if (seen[c] > ALERT_QUEUE_COUNTRY_CAP) continue;
    }
    out.push(a);
  }
  return out;
}
/* 预警两区渲染核心判定（2026-08-29 用户指令：预警中心有重点和核心）：
 * 核心区 = ①十大核心威胁命中（涉华受害/恐袭/海盗/冲突/政变/制裁…）②命中中资资产/重点项目/海上通道
 * ③红区（≥61 分）④橙区起（≥46 分）⑤涉华且带伤亡/绑架/撤侨等严重事件要素。
 * 核心条目置顶展示且不占国别帽；其余按国别帽均衡铺底（态势区）。 */
function _alertIsCore(x) {
  try {
    if (!x) return false;
    if (x.is_core === true) return true;
    if (x.risk_score != null && x.risk_score >= 46) return true;
    if ((x.core_threat_tags && x.core_threat_tags.length) || (x.core_threat_name)) return true;
    if ((x.asset_tags && x.asset_tags.length) || (x.interest_projects && x.interest_projects.length) || (x.channel_tags && x.channel_tags.length)) return true;
    const t = String(x.title || '') + ' ' + String(x.title_zh || '');
    if ((x.chinaRelated || x.chinaNegative) && /绑架|劫持|撤侨|遇袭|遭袭|被袭|身亡|遇难|遇害|被杀|失踪|枪击|爆炸|kidnap|abduct|evacuat|killed|bomb|blast/i.test(t)) return true;
    for (const p of ASSET_PROFILES) { if (p.re.test(t)) return true; }
    return false;
  } catch (e) { return false; }
}
/* 两区渲染：核心区置顶（时间倒序）+ 态势区铺底（时间倒序） */
function _partitionCore(list) {
  const core = [], rest = [];
  for (const a of list) { if (a && a.is_core === true) core.push(a); else rest.push(a); }
  const byTimeDesc = (x, y) => String(y.time || y.publishedAt || '').localeCompare(String(x.time || x.publishedAt || ''));
  core.sort(byTimeDesc); rest.sort(byTimeDesc);
  return core.concat(rest);
}
/* ===== 国别内容校验（2026-08-31 问题五：国别均衡化）=====
 * 审计实测（近7天 3000 样本）：terror_attack/frontend_post 等通道把大量美伊战争、
 * 美俄动态新闻贴上巴基斯坦/叙利亚/阿富汗等国标签——挂某国标签的数据内容却不是该国的事。
 * 规则：标记国别的关键词在标题+译题+摘要中零命中，且存在另一国别命中≥2个独立关键词 →
 * 改标为内容主导国别（原标签存 country_orig 保留审计痕迹）。
 * 标记国别命中任一关键词、或无法判定主导国别（含多国并列/零命中）→ 保持原样。 */
const _CTRY_PATTERNS = [
  ['中国', ['中国', '中资', '中企', '华人', '华商', '北京', 'Chinese', 'China']],
  ['美国', ['美国', '美军', '白宫', '五角大楼', '特朗普', '华盛顿', 'United States', 'American', 'Washington', 'Trump']],
  ['俄罗斯', ['俄罗斯', '俄军', '莫斯科', '克里姆林宫', 'Russia', 'Russian', 'Moscow']],
  ['伊朗', ['伊朗', '德黑兰', '革命卫队', 'Iran', 'Iranian', 'Tehran', 'IRGC']],
  ['乌克兰', ['乌克兰', '基辅', 'Ukraine', 'Ukrainian', 'Kyiv', '泽连斯基']],
  ['以色列', ['以色列', '特拉维夫', 'Israel', 'Israeli', 'IDF']],
  ['巴基斯坦', ['巴基斯坦', '伊斯兰堡', 'Pakistan', 'Pakistani', 'Islamabad', '俾路支', '开伯尔']],
  ['阿富汗', ['阿富汗', '喀布尔', 'Afghanistan', 'Afghan', 'Kabul', '塔利班', 'Taliban']],
  ['印度', ['印度', '新德里', 'India', 'Indian', 'Delhi']],
  ['菲律宾', ['菲律宾', '马尼拉', 'Philippine', 'Manila']],
  ['越南', ['越南', '河内', 'Vietnam', 'Vietnamese', 'Hanoi']],
  ['缅甸', ['缅甸', '仰光', 'Myanmar', 'Burma', 'Yangon', '军政府']],
  ['泰国', ['泰国', '曼谷', 'Thailand', 'Bangkok']],
  ['印度尼西亚', ['印度尼西亚', '印尼', '雅加达', 'Indonesia', 'Indonesian', 'Jakarta']],
  ['马来西亚', ['马来西亚', 'Malaysia', 'Malaysian', '吉隆坡']],
  ['哈萨克斯坦', ['哈萨克', 'Kazakhstan', 'Kazakh', '阿斯塔纳', '阿特劳']],
  ['乌兹别克斯坦', ['乌兹别克', 'Uzbekistan', 'Uzbek', '塔什干']],
  ['沙特阿拉伯', ['沙特', 'Saudi', '利雅得', 'Riyadh']],
  ['阿联酋', ['阿联酋', 'UAE', '迪拜', 'Dubai', 'Abu Dhabi', '阿布扎比']],
  ['卡塔尔', ['卡塔尔', 'Qatar', '多哈', 'Doha']],
  ['土耳其', ['土耳其', 'Turkish', 'Turkey', 'Turkiye', '安卡拉', '埃尔多安', 'Erdogan']],
  ['埃及', ['埃及', 'Egypt', 'Egyptian', '开罗', 'Cairo']],
  ['苏丹', ['苏丹', 'Sudan', '喀土穆', 'Khartoum', 'RSF', '快速支援部队']],
  ['南苏丹', ['南苏丹', 'South Sudan', '朱巴']],
  ['埃塞俄比亚', ['埃塞俄比亚', 'Ethiopia', 'Addis Ababa', '亚的斯亚贝巴']],
  ['肯尼亚', ['肯尼亚', 'Kenya', 'Kenyan', '内罗毕', 'Nairobi']],
  ['尼日利亚', ['尼日利亚', 'Nigeria', 'Nigerian', '拉各斯', 'Lagos', '阿布贾', 'Abuja']],
  ['尼日尔', ['尼日尔', 'Niamey', '尼亚美']],
  ['马里', ['马里', 'Mali', 'Bamako', '巴马科']],
  ['布基纳法索', ['布基纳法索', 'Burkina Faso', 'Ouagadougou']],
  ['乍得', ['乍得', "N'Djamena", '恩贾梅纳']],
  ['刚果（金）', ['刚果', 'Congo', 'Kinshasa', '金沙萨', 'M23', '基伍']],
  ['莫桑比克', ['莫桑比克', 'Mozambique', 'Maputo', '德尔加杜角']],
  ['南非', ['南非', 'South Africa', '约翰内斯堡', '开普敦', 'Pretoria']],
  ['索马里', ['索马里', 'Somalia', 'Mogadishu', '摩加迪沙', '青年党', 'Shabaab']],
  ['利比亚', ['利比亚', 'Libya', 'Tripoli', '的黎波里']],
  ['阿尔及利亚', ['阿尔及利亚', 'Algeria', 'Algiers', '阿尔及尔']],
  ['墨西哥', ['墨西哥', 'Mexico', 'Mexican']],
  ['哥伦比亚', ['哥伦比亚', 'Colombia', 'Bogota', '波哥大']],
  ['委内瑞拉', ['委内瑞拉', 'Venezuela', 'Caracas', '加拉加斯', '马杜罗', 'Maduro']],
  ['巴西', ['巴西', 'Brazil', 'Brazilian', '巴西利亚']],
  ['阿根廷', ['阿根廷', 'Argentina', 'Buenos Aires', '布宜诺斯艾利斯']],
  ['秘鲁', ['秘鲁', 'Peru', 'Peruvian', 'Lima', '利马']],
  ['智利', ['智利', 'Chile', 'Chilean', 'Santiago']],
  ['叙利亚', ['叙利亚', 'Syria', 'Syrian', 'Damascus', '大马士革', '阿萨德']],
  ['伊拉克', ['伊拉克', 'Iraq', 'Iraqi', 'Baghdad', '巴格达']],
  ['也门', ['也门', 'Yemen', 'Houthi', '胡塞', 'Sanaa', '萨那']],
  ['黎巴嫩', ['黎巴嫩', 'Lebanon', 'Beirut', '贝鲁特', '真主党', 'Hezbollah']],
  ['约旦', ['约旦', 'Jordan', 'Amman', '安曼']],
  ['日本', ['日本', 'Japan', 'Japanese', '东京', 'Tokyo']],
  ['韩国', ['韩国', 'South Korea', 'Seoul', '首尔', '朝鲜半岛']],
  ['吉尔吉斯斯坦', ['吉尔吉斯', 'Kyrgyz', '比什凯克']],
  ['塔吉克斯坦', ['塔吉克', 'Tajik', 'Dushanbe']],
  ['尼泊尔', ['尼泊尔', 'Nepal', 'Kathmandu', '加德满都']],
  ['斯里兰卡', ['斯里兰卡', 'Sri Lanka', 'Colombo', '科伦坡']],
  ['孟加拉国', ['孟加拉', 'Bangladesh', 'Dhaka', '达卡']],
  ['英国', ['英国', 'United Kingdom', 'British', 'London', '伦敦']],
  ['法国', ['法国', 'France', 'French', 'Paris', '巴黎']],
  ['德国', ['德国', 'Germany', 'German', 'Berlin', '柏林']],
  ['意大利', ['意大利', 'Italy', 'Italian', 'Rome', '罗马']],
  ['西班牙', ['西班牙', 'Spain', 'Spanish', 'Madrid', '马德里']],
  ['澳大利亚', ['澳大利亚', 'Australia', 'Australian', 'Sydney']],
  ['加拿大', ['加拿大', 'Canada', 'Canadian', 'Ottawa']],
  ['墨西哥湾', ['墨西哥湾', 'Gulf of Mexico']]
];
function _contentCountryFix(it) {
  try {
    if (!it) return false;
    const labeled = String(it.country || it.country_cn || '').trim();
    if (!labeled || labeled === '国际' || labeled === '泛非') return false;
    const txt = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.desc || it.content || '').slice(0, 400);
    if (txt.replace(/\s+/g, '').length < 12) return false;
    /* 标记国别关键词命中 → 标签可信，保持 */
    const lblPat = _CTRY_PATTERNS.find(p => labeled.indexOf(p[0]) >= 0 || p[0].indexOf(labeled) >= 0);
    if (lblPat && lblPat[1].some(k => txt.includes(k))) return false;
    /* 找内容主导国别：命中≥2个独立关键词才算（1个可能是顺带提及） */
    let best = null, bestN = 0;
    for (const p of _CTRY_PATTERNS) {
      if (p === lblPat) continue;
      const n = p[1].filter(k => txt.includes(k)).length;
      if (n > bestN) { bestN = n; best = p[0]; }
    }
    if (best && bestN >= 2 && best !== labeled) {
      it.country_orig = labeled;
      it.country = best;
      if (it.country_cn) it.country_cn = best;
      return true;
    }
    return false;
  } catch (e) { return false; }
}
/* 2026-08-31 标题跨形态去重 helper（用户铁证根因）：写入侧重复组增量不断累积——
 * 原版只在 _serverAlertGen 跑一次，但 PUT /api/datahub/:collection 合并路径客户端
 * DataHub 回灌的 ALERTS 不经过生成器，每次覆盖都会再写入同题双条。
 * 统一走本 helper：保留优先级 SRV- > 裸数字 id > 其他形态（TR-/ANOM-/时间戳 id），
 * 空字段互补后丢弃多余条目。日志前缀区分调用方。 */
function _dedupAlertsByTitle(arr, logTag) {
  const _idRank = (a) => { const id = String((a && a.id) || ''); if (id.indexOf('SRV-') === 0) return 0; if (/^\d+$/.test(id)) return 1; return 2; };
  const byTkey = new Map();
  const keptT = [];
  let count = 0;
  try {
    for (const a of (arr || [])) {
      if (!a) continue;
      const k = String(a.title || a.title_zh || '').replace(/\s+/g, '').toLowerCase().slice(0, 40);
      if (!k) { keptT.push(a); continue; }
      const prev = byTkey.get(k);
      if (!prev) { byTkey.set(k, a); keptT.push(a); continue; }
      const keep = _idRank(a) < _idRank(prev) ? a : prev;
      const drop = (keep === a) ? prev : a;
      /* 字段互补：被丢弃条目的非空字段转移到保留条 */
      for (const f of ['desc', 'title_zh', 'url', 'country', 'publishedAt', 'risk_score', 'risk_zone', 'asset_tags', 'core_threat_name', 'channel_tags']) {
        if ((keep[f] == null || keep[f] === '') && drop[f] != null && drop[f] !== '') keep[f] = drop[f];
      }
      if (keep.is_core !== true && drop.is_core === true) keep.is_core = true;
      /* 保证 keptT 恰有一份 keep（之前若 keep=a 但 a 未入表 → push；keep=prev 已在表中 → 不重 push） */
      const ki = keptT.indexOf(keep);
      if (ki < 0) keptT.push(keep);
      /* 移除 drop（drop 在 keptT 仅当它就是 prev 且被更优的 a 顶替） */
      if (drop !== keep) { const di = keptT.indexOf(drop); if (di >= 0) keptT.splice(di, 1); }
      byTkey.set(k, keep);
      count++;
    }
    if (count && logTag) console.log(logTag + ' 标题跨形态去重 ' + count + ' 组');
  } catch (e) { console.warn(logTag + ' 标题去重异常:', e.message); return { kept: arr || [], count: 0 }; }
  return { kept: keptT, count };
}
async function _serverAlertGen() {
  try {
    /* 2026-08-26 修复：15 分钟窗口过窄，入库与生成器错车（或重启/风控延迟）导致高价值条目
     * 漏生成预警。放宽到 24 小时。是否已生成以 datahub_store 中是否真实存在该预警 ID 为准，
     * 不再依赖内存 _alertGenSeen——否则跨天被“今日化”清理后，内存记录会阻止重新生成。 */
    /* 2026-08-31 入库率修复（问题一）：LIMIT 300 是结构性瓶颈——日采集 800+ 条时，
     * 只有最新 300 条被评估预警资格，60%+ 的合格条目从未进过闸门就被遗忘。
     * 提高到 1000 覆盖 24h 全量视野（已生成条目靠 haveIds 秒跳，增量成本极低）。 */
    const { rows } = await query(
      "SELECT id, data_type, title, country, severity, collect_time, data_json FROM intel_data WHERE collect_time >= NOW() - INTERVAL '24 hours' AND audit_status='approved' ORDER BY collect_time DESC LIMIT 1000"
    );
    if (!rows.length) return;
    const dh = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
    let alerts = dh.rows.length && Array.isArray(dh.rows[0].data_json) ? dh.rows[0].data_json : [];
    /* #522 存量双形态合并：SRV-<id>（本生成器产物）与 <id>（前端 SSE 分发后 PUT 上传）是
     * 同一 intel_data 的双形态，历史上因 id/country 键错开造成同事件双条并存。
     * 合并保留 SRV-（信息更全），country 用非空方修正，_live 与实时字段转移；
     * 合并结果随函数末尾写回 datahub_store 持久化，逐轮自动出清存量双条。 */
    let _dualMerged = 0;
    try {
      const byBase = new Map(); const kept = [];
      for (const a of alerts) {
        const base = String((a && a.id) || '').replace(/^SRV-/, '');
        if (!base || !/^\d+$/.test(base)) { kept.push(a); continue; }
        const prev = byBase.get(base);
        if (!prev) { byBase.set(base, a); kept.push(a); continue; }
        const prevIsSrv = String(prev.id || '').indexOf('SRV-') === 0;
        const curIsSrv = String(a.id || '').indexOf('SRV-') === 0;
        const keep = (curIsSrv && !prevIsSrv) ? a : prev;
        const drop = (keep === a) ? prev : a;
        if ((!keep.country || !String(keep.country).trim()) && drop.country) keep.country = drop.country;
        /* _live 条目 country 由前端正文提取（更可信），修正 SRV- 生成时的错标国别 */
        if (drop._live && drop.country && String(drop.country).trim() && drop.country !== keep.country) keep.country = drop.country;
        if (drop._live && !keep._live) keep._live = true;
        for (const k of ['desc', 'content_zh', 'title_zh', 'publishedAt', 'url', 'ext_url', 'corroboration', 'asset_tags', 'channel_tags', '_eventSig', 'enterprise']) {
          if (!keep[k] && drop[k]) keep[k] = drop[k];
        }
        const ki = kept.indexOf(drop); if (ki >= 0) kept.splice(ki, 1);
        const kj = kept.indexOf(prev); if (kj >= 0) kept[kj] = keep; else kept.push(keep);
        byBase.set(base, keep);
        _dualMerged++;
      }
      if (_dualMerged) { alerts = kept; console.log('[ALERT-GEN] #522 双形态合并 ' + _dualMerged + ' 组（SRV-/裸 id 同条去重）'); }
    } catch (e) { console.warn('[ALERT-GEN] 双形态合并异常:', e.message); }
    /* 2026-08-31 标题级跨形态去重（用户铁证：预警中心实测 27 组标题重复对）——
     * 双形态合并只处理 SRV-/裸数字 id 对；前端分发路径的 1788xxx 时间戳 id、
     * ANOM- 异动形态与生成器产物因 id 键不同永远错开，造成同题双条刷屏。
     * 按归一化标题键去重：保留优先级 SRV- > 裸数字 id（可溯源 intel_data）> 其他形态；
     * 空字段互补后丢弃多余条目（统一走 _dedupAlertsByTitle helper）。 */
    const _tdRes = _dedupAlertsByTitle(alerts, '[ALERT-GEN]');
    if (_tdRes.count) { alerts = _tdRes.kept; _titleDedup = _tdRes.count; }
    /* 2026-08-29 存量清扫：预警队列里的历史旧案回顾（1988 泛美103审判类）逐轮剔除，
     * 与新生成否决同源判定——用户删不干净的这类旧案报道由生成器自动出清。 */
    let _histSwept = 0;
    if (alerts.some(a => a && _isHistoricalRetrospect(a))) {
      alerts = alerts.filter(a => { if (a && _isHistoricalRetrospect(a)) { _histSwept++; return false; } return true; });
    }
    /* 2026-08-26 赋分改革回填：版本化重算，确保红区硬约束修正后存量预警同步降级 */
    let backfilled = 0;
    for (const a of alerts) {
      if (!a) continue;
      if (a._riskVersion === 3) continue;
      try {
        const s = _scoreRiskItem({ title: a.title || '', title_zh: a.title_zh || '', content: a.desc || '', country: a.country || '', source: a.source || '', publishedAt: a.publishedAt || a.time || '' });
        a.risk_score = s.score; a.risk_zone = s.zone; a.risk_rationale = s.rationale; a.zone_action = s.action;
        a.level = s.level; /* 分数权威性最高：旧"涉华+严重即红"的等级一律以新分数为准 */
        a._riskVersion = 3;
        backfilled++;
      } catch (e) {}
    }
    if (backfilled) console.log('[ALERT-GEN] 赋分改革回填 ' + backfilled + ' 条存量预警');
    /* 2026-08-29 两区渲染回填：存量预警补 is_core 核心区标记（置顶 + 国别帽豁免依据） */
    let coreBackfilled = 0;
    for (const a of alerts) {
      if (!a || a.is_core !== undefined) continue;
      if (_alertIsCore(a)) { a.is_core = true; coreBackfilled++; }
      else a.is_core = false;
    }
    const have = new Set(alerts.map(a => String(a.title || '').replace(/\s+/g, '').toLowerCase().slice(0, 40)));
    const haveIds = new Set(alerts.map(a => String(a.id || '')));
    /* #522 同基础 id 防重：前端实时分发会把 intel_data 存为裸 id 形态（无 SRV- 前缀），
     * 若 datahub 已有裸 <id> 条目（SSE 分发后 PUT 上传），此处再生成 SRV-<id> 会造成
     * 同一事件双条并存（塞内加尔中资矿企遇袭案）。基础值相同即跳过生成。 */
    const haveBaseIds = new Set(alerts.map(a => String(a.id || '').replace(/^SRV-/, '')));
    const added = [];
    for (const r of rows) {
      const genId = 'SRV-' + r.id;
      if (haveIds.has(genId)) continue; /* 预警中心已存在该条目，不重复生成 */
      if (haveBaseIds.has(String(r.id))) continue; /* #522：已有裸 id 实时形态，不再生成 SRV- 双形态 */
      const it = r.data_json || {};
      it.title = it.title || r.title || '';
      it.country = it.country || r.country || '';
      /* 2026-08-31 国别内容校验：存量错标条目（标签国与内容国不符）在生成预警时改标 */
      _contentCountryFix(it);
      /* 2026-08-26 赋分改革：预警等级一律由 0-100 分数驱动；老数据无分数现场补算 */
      if (it.risk_score == null || !it.risk_zone) {
        try {
          const s = _scoreRiskItem(it);
          it.risk_score = s.score; it.risk_zone = s.zone; it.risk_rationale = s.rationale; it.zone_action = s.action;
        } catch (e) {}
      }
      const lv = (it.risk_zone ? (it.risk_score >= 61 ? 'red' : it.risk_score >= 46 ? 'orange' : it.risk_score >= 31 ? 'yellow' : 'blue') : null)
        || it.level_norm || r.severity || 'yellow';
      if (it.interestLinked === false) { _gateAudit('预警生成', 'not-linked', it.title); continue; }
      /* 2026-08-17 用户指令日产≥200：蓝色提示级凡利益关联分≥10 一并入队（队列内显示为提示级，不与高优预警混淆） */
      if (_isShellAlert(it)) { _gateAudit('预警生成', 'shell', it.title); continue; }
      if (_isRuUaNoLink(it)) { _gateAudit('预警生成', 'ruua-nolink', it.title); continue; }
      /* 2026-08-20 铁律：服务端生成预警必须过 chinaOverseasGate，防止秦皇岛火灾等纯国内事件入库
       * 2026-08-31 入库率修复：闸门文本此前只拼 title+content，title_zh 与 country 全部缺席。
       * "伊朗袭击美国在约旦的基地"（重放样本）等条目 content 短、title 已译但英文源字段为空时，
       * 闸门看不到任何国名/事件锚 → indirect-no-china-link / foreign-irrelevant 误杀。
       * 补拼 title_zh + country 后此类条目正常过闸。纯国内拦截本体不变。 */
      const _gtxt = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.country || '') + ' ' + String(it.content || it.desc || '');
      if (typeof scrapers !== 'undefined' && scrapers.chinaOverseasGate && !scrapers.chinaOverseasGate(_gtxt).pass) {
        _gateAudit('预警生成', 'domestic', it.title); continue;
      }
      /* 历史旧案回顾否决（2026-08-29）：1988 泛美103审判推迟类旧案回顾报道不进预警中心 */
      if (_isHistoricalRetrospect(it)) { _gateAudit('预警生成', 'historical', it.title); continue; }
      if (_srvAlertScore(it) < 10) { _gateAudit('预警生成', 'low-interest', it.title); continue; } /* 2026-08-17 用户指令：日产≥200 条预警，阈值 20→10 */
      const tkey = String(it.title || '').replace(/\s+/g, '').toLowerCase().slice(0, 40);
      if (!tkey || have.has(tkey)) continue;
      const now = new Date();
      const p = n => String(n).padStart(2, '0');
      /* 2026-08-30 修复（用户铁证：逃跑条 08-29 20:17 入库，预警显示 08-30 00:21）：
       * time 此前用生成时刻——24h 回看窗口内重新生成（或延迟生成）的预警会被盖上
       * "当下"时间戳，昨天的情报看起来像今天新采集。一律用条目自身采集时间。 */
      const ct = r.collect_time ? new Date(r.collect_time) : now;
      const ts = ct.getFullYear() + '-' + p(ct.getMonth() + 1) + '-' + p(ct.getDate()) + ' ' + p(ct.getHours()) + ':' + p(ct.getMinutes());
      const typeMap = { terror_events: '安全风险', security_events: '安全风险', military_conflicts: '安全风险', political_events: '政治风险', natural_disasters: '自然环境风险', public_health: '安全风险', sanctions_data: '经济风险', social_unrest: '社会文化风险', infrastructure: '运营风险', geopolitical_intel: '地缘战略风险', economic_risk: '经济风险', legal_compliance: '法律合规', cyber_security: '网络安全' };
      const alert = {
        id: 'SRV-' + r.id,
        alert_no: 'CN-SEC-' + (now.getFullYear() + '' + p(now.getMonth() + 1) + '' + p(now.getDate())) + '-' + String(r.id).slice(-4).padStart(4, '0'),
        title: it.title_zh || it.title,
        title_zh: it.title_zh || '',
        desc: String(it.content || it.desc || it.title || '').slice(0, 300),
        time: ts, level: lv, type: typeMap[r.data_type] || '安全风险',
        country: it.country || '', source: it.source || '实时监测引擎',
        url: it.url || '', status: 'active',
        interestLinked: it.interestLinked === true, chinaRelated: !!it.chinaRelated,
        publishedAt: it.publishedAt || it.pubDate || '',
        /* 赋分改革：分值/分区/依据/处置要求随预警下发，前端直接展示 */
        risk_score: it.risk_score != null ? it.risk_score : null,
        risk_zone: it.risk_zone || '',
        risk_rationale: it.risk_rationale || '',
        zone_action: it.zone_action || (it.risk_zone ? ZONE_ACTIONS[it.risk_zone] : '') || '',
        /* 两区渲染（2026-08-29）：核心威胁字段下发 + 核心区标记（置顶 + 不占国别帽） */
        core_threat: it.core_threat || '',
        core_threat_name: it.core_threat_name || '',
        core_threat_tags: it.core_threat_tags || [],
        asset_tags: it.asset_tags || [],
        interest_tier: it.interest_tier || '',
        is_core: _alertIsCore(it),
        _riskVersion: 2
      };
      added.unshift(alert);
      have.add(tkey);
      haveIds.add(genId);
    }
    /* 2026-08-31 根因修复（重复问题）：_dualMerged/_titleDedup 此前不在写回条件里——
     * 合并结果只在内存里算完就丢，只有 added/backfilled 等其他标志触发时才被顺带持久化，
     * 导致 27 组重复对长期滞留。现在合并自身即触发写回。 */
    if (added.length || backfilled || _histSwept || coreBackfilled || _dualMerged || _titleDedup) {
      const merged = _partitionCore(_capAlertQueue(added.concat(alerts))).slice(0, 500); /* 2026-08-31 入库率修复：预警中心硬上限 300→500（用户指令量要大） */
      await query('INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (collection) DO UPDATE SET data_json=$2, updated_at=NOW()', ['alerts', JSON.stringify(merged)]);
      console.log('[ALERT-GEN] 服务端生成预警 ' + added.length + ' 条（核心区 ' + added.filter(a => a.is_core).length + '），共享库现有 ' + merged.length + ' 条'
        + (_histSwept ? '，剔除历史旧案回顾 ' + _histSwept + ' 条' : '')
        + (coreBackfilled ? '，核心区回填 ' + coreBackfilled + ' 条' : ''));
      /* 真实预警触发时自动调用推送通道 */
      added.forEach(function (a) { _dispatchAlertPushes(a, 'new').catch(function (e) { console.warn('[PUSH] new alert dispatch error:', e.message); }); });
    }
  } catch (e) { console.warn('[ALERT-GEN] 异常:', e.message); }
}
setInterval(_serverAlertGen, 3 * 60 * 1000);
setTimeout(_serverAlertGen, 30 * 1000);

/* ===== 异动信号引擎（2026-08-28 服务端三件之一）=====
 * 口径：类别×国家日计数基线（近 7 天，活跃库 intel_data + 归档库 intel_archive 合并全覆盖），
 * 与今日计数对比，超阈值生成"风险升温信号"：
 *   · 有效基线（近 7 天总量 ≥ 3）：今日 ≥ 4 条且 ≥ 日均 1.8 倍 → 升温
 *   · 无基线：今日 ≥ 6 条 → 突发簇
 * 分级：倍数≥4.5 且今日≥10 且 TIER1/COSRI公共安全≥8 → 红；倍数≥3 且今日≥8 → 橙；其余黄。
 * 优质信号（利益关联分≥10，与预警中心同源规则）写入预警中心共享库（ANOM- 前缀，当日幂等）。
 * GET /api/anomaly/signals → 最近一次检测结果（>10min 自动重测）
 * GET /api/anomaly/detect  → 强制立即检测并返回结果 */
const _ANOM_CAT_LABELS = {
  terror_events: '恐怖事件', security_events: '安全事件', military_conflicts: '武装冲突',
  political_events: '政治事件', natural_disasters: '自然灾害', public_health: '公共卫生',
  sanctions_data: '制裁措施', social_unrest: '社会动荡', infrastructure: '基础设施',
  geopolitical_intel: '地缘情报', economic_risk: '经济风险', legal_compliance: '法律合规',
  cyber_security: '网络安全', osint_intel: '开源情报' /* 2026-08-29：此前漏映射，异动列表显示裸码 */
};
/* 预警队列 type 字段沿用 _serverAlertGen 同一映射，保证前端等级/类型过滤器兼容 */
const _ANOM_ALERT_TYPE = {
  terror_events: '安全风险', security_events: '安全风险', military_conflicts: '安全风险',
  political_events: '政治风险', natural_disasters: '自然环境风险', public_health: '安全风险',
  sanctions_data: '经济风险', social_unrest: '社会文化风险', infrastructure: '运营风险',
  geopolitical_intel: '地缘战略风险', economic_risk: '经济风险', legal_compliance: '法律合规',
  cyber_security: '网络安全'
};
let _anomalyState = { at: null, signals: [], scanned: 0, pushed: 0 };
/* 2026-08-29 国别码归一化（根因修复：sources_pack 通道落 ISO 两位码，"CN·地缘情报"混进异动监测
 * + getTier('PK') 查不到梯队 + 前端显示裸码 PK/BR）。与 sources-collector.js 同源映射。 */
const _ANOM_ISO2CN = {
  CN:'中国', US:'美国', GB:'英国', FR:'法国', HK:'中国香港', MO:'中国澳门', TW:'中国台湾',
  PK:'巴基斯坦', LK:'斯里兰卡', BD:'孟加拉国', ID:'印尼', VN:'越南', MY:'马来西亚', TH:'泰国',
  MM:'缅甸', KH:'柬埔寨', LA:'老挝', KZ:'哈萨克斯坦', UZ:'乌兹别克斯坦', TJ:'塔吉克斯坦',
  KG:'吉尔吉斯斯坦', RU:'俄罗斯', SA:'沙特', AE:'阿联酋', QA:'卡塔尔', IR:'伊朗', IQ:'伊拉克',
  EG:'埃及', DZ:'阿尔及利亚', NG:'尼日利亚', ZA:'南非', CD:'刚果（金）', GN:'几内亚',
  ET:'埃塞俄比亚', KE:'肯尼亚', MZ:'莫桑比克', AO:'安哥拉', DJ:'吉布提', BR:'巴西', PE:'秘鲁',
  AR:'阿根廷', CL:'智利', MX:'墨西哥', BO:'玻利维亚', EC:'厄瓜多尔', DE:'德国', RS:'塞尔维亚',
  HU:'匈牙利', GR:'希腊', CA:'加拿大', AU:'澳大利亚', PG:'巴布亚新几内亚', SB:'所罗门群岛',
  JP:'日本', KR:'韩国', KP:'朝鲜', IN:'印度', TR:'土耳其', UA:'乌克兰', IL:'以色列', PS:'巴勒斯坦',
  SD:'苏丹', LY:'利比亚', SO:'索马里', ML:'马里', NE:'尼日尔', TD:'乍得', SY:'叙利亚',
  YE:'也门', LB:'黎巴嫩', JO:'约旦', MA:'摩洛哥', TN:'突尼斯', TZ:'坦桑尼亚', UG:'乌干达',
  ZM:'赞比亚', ZW:'津巴布韦', MW:'马拉维', BW:'博茨瓦纳', NA:'纳米比亚', SN:'塞内加尔',
  BF:'布基纳法索', CM:'喀麦隆', CI:'科特迪瓦', SG:'新加坡', PH:'菲律宾', MN:'蒙古',
  PL:'波兰', BY:'白俄罗斯', RO:'罗马尼亚', CZ:'捷克', SK:'斯洛伐克', BG:'保加利亚',
  FI:'芬兰', SE:'瑞典', NO:'挪威', DK:'丹麦', NL:'荷兰', BE:'比利时', CH:'瑞士',
  AT:'奥地利', IT:'意大利', ES:'西班牙', PT:'葡萄牙', IE:'爱尔兰', NZ:'新西兰'
};
function _anomIso2cn(c) {
  const s = String(c || '').trim();
  if (!s) return '';
  if (/[\u4e00-\u9fa5]/.test(s)) return s; /* 已是中文 */
  return _ANOM_ISO2CN[s.toUpperCase()] || s; /* 未收录码原样返回（不丢方向） */
}
async function _runAnomalyWatch() {
  try {
    /* 本地自然日 0 点作边界（禁用 CURRENT_DATE——PG 会话时区可能非中国时区） */
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(dayStart.getTime() - 7 * 86400000);
    /* 基线：近 7 天（不含今日）类别×国家计数（活跃库+归档库合并） */
    const hist = await query(`
      SELECT data_type t, country c, COUNT(*)::int n FROM (
        SELECT data_type, country, collect_time, audit_status FROM intel_data
        UNION ALL
        SELECT data_type, country, collect_time, audit_status FROM intel_archive
      ) u
      WHERE collect_time >= $1 AND collect_time < $2 AND audit_status='approved'
      GROUP BY 1,2`, [weekAgo, dayStart]);
    const base = {};
    for (const r of hist.rows) {
      const cn0 = _anomIso2cn(r.c); /* 基线键同样归一化（码/中文统一，避免基线落空） */
      const k = r.t + '|' + cn0;
      base[k] = (base[k] || 0) + r.n;
    }
    /* 今日计数 */
    const tod = await query(
      `SELECT data_type t, country c, COUNT(*)::int n FROM intel_data WHERE collect_time >= $1 AND audit_status='approved' GROUP BY 1,2`,
      [dayStart]
    );
    /* 今日样例标题（供信号详情展示，真实入库数据） */
    const tit = await query(
      `SELECT data_type t, country c, COALESCE(NULLIF(data_json->>'title_zh',''),title) AS title_zh FROM intel_data WHERE collect_time >= $1 AND audit_status='approved' ORDER BY collect_time DESC LIMIT 600`,
      [dayStart]
    );
    const sampleMap = {};
    for (const r of tit.rows) {
      const k = r.t + '|' + _anomIso2cn(r.c);
      if (!sampleMap[k]) sampleMap[k] = [];
      if (sampleMap[k].length < 5) sampleMap[k].push(r.title_zh || r.title);
    }
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const tk = now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate());
    const ts = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + ' ' + p(now.getHours()) + ':' + p(now.getMinutes());
    const signals = [];
    let scanned = 0;
    for (const r of tod.rows) {
      const cn = _anomIso2cn(r.c); /* ISO 码→中文（修复 getTier/COSRI 查不到 + 前端显示裸码） */
      /* 2026-08-29 铁律：本平台监测海外异动，中国是行为主体永不是异动国——
       * 中文"中国"与残留码 CN/CHN 全形式排除（此前码形态逃过过滤混进异动列表）。 */
      if (!cn || cn === '中国' || cn === 'CN' || cn === 'CHN' || cn === '未知' || cn === '全球') continue;
      scanned++;
      const k = r.t + '|' + cn;
      const total7 = base[k] || 0;
      const avg = total7 / 7;
      const today = r.n;
      let ratio = 0, kind = '';
      if (total7 >= 3) {
        ratio = today / avg;
        if (today >= 4 && ratio >= 1.8) kind = '升温';
      } else if (today >= 6) {
        kind = '突发';
      }
      if (!kind) continue;
      const tier = INTEREST_BASE.getTier ? INTEREST_BASE.getTier(cn) : null;
      const cosriS = INTEREST_BASE.COUNTRY_RISK_INDICATORS ? INTEREST_BASE.COUNTRY_RISK_INDICATORS.scores[cn] : null;
      let level = 'yellow';
      if (ratio >= 4.5 && today >= 10 && (tier === 'TIER1' || (cosriS && cosriS.security >= 8))) level = 'red';
      else if (ratio >= 3 && today >= 8) level = 'orange';
      const score = level === 'red' ? Math.min(85, 61 + Math.round(ratio))
        : Math.min(60, Math.round(26 + ratio * 9 + Math.min(12, today)));
      const zone = score >= 61 ? 'red' : score >= 46 ? 'orange' : 'yellow';
      const catLabel = _ANOM_CAT_LABELS[r.t] || r.t;
      const samples = (sampleMap[k] || []).slice(0, 5).map(s => String(s).slice(0, 60));
      const ratioTxt = kind === '突发' ? '无基线' : (Math.round(ratio * 10) / 10) + '倍';
      const title = '【风险' + kind + '】' + cn + '·' + catLabel + '情报量异动：7日均 ' + (Math.round(avg * 10) / 10) + ' → 今日 ' + today + ' 条' + (kind === '升温' ? '（' + ratioTxt + '）' : '');
      const desc = ('近 7 天该方向日均值 ' + (Math.round(avg * 10) / 10) + ' 条，今日已入库 ' + today + ' 条' +
        (kind === '升温' ? '，环比 ' + ratioTxt + '，超出异动阈值（1.8 倍）' : '，近 7 天无基线记录，属突发聚集') +
        '。样例：' + samples.join('；')).slice(0, 300);
      const ckey = (cn + String(r.t)).replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '').slice(0, 24);
      const alert = {
        id: 'ANOM-' + tk + '-' + ckey,
        alert_no: 'CN-SEC-' + tk + '-A' + String(signals.length + 1).padStart(4, '0'),
        title, title_zh: title,
        desc,
        time: ts, level, type: _ANOM_ALERT_TYPE[r.t] || '安全风险',
        country: cn, source: '异动信号引擎', url: '',
        status: 'active', interestLinked: true,
        chinaRelated: /中国|华人|中资|中企|中方|涉华|CPEC|一带一路/i.test(title + desc),
        publishedAt: now.toISOString(),
        risk_score: score, risk_zone: zone,
        risk_rationale: '基于近 7 天类别×国家入库基线的统计异动（' + kind + '，今日 ' + today + ' vs 日均 ' + (Math.round(avg * 10) / 10) + '）',
        zone_action: level === 'red' ? '立即核查该国项目/人员暴露，启动应急联络'
          : level === 'orange' ? '加密监测频次，通知该国项目组加强防范'
            : '保持关注，核实是否单源聚集导致',
        _riskVersion: 3, _anomaly: true,
        anomaly: { kind, today, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10, samples }
      };
      signals.push({
        country: cn, type: r.t, typeLabel: catLabel, tier, kind,
        today, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10,
        level, risk_score: score, samples, alert
      });
    }
    signals.sort((a, b) => (b.ratio || 99) - (a.ratio || 99) || b.today - a.today);
    const top = signals.slice(0, 15);
    /* 优质信号进预警中心共享库（与 _serverAlertGen 同源合并 + 幂等去重 + 利益关联哨兵同规则） */
    let pushed = 0;
    try {
      if (top.length) {
        const dh = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
        const alerts = dh.rows.length && Array.isArray(dh.rows[0].data_json) ? dh.rows[0].data_json : [];
        const haveIds = new Set(alerts.map(a => String((a && a.id) || '')));
        const added = [];
        for (const s of top) {
          const sc = _alertInterestScore(s.alert);
          s.interestScore = sc.score; s.interestHits = sc.hits;
          s.alert._interestScore = sc.score; s.alert._interestHits = sc.hits;
          if (haveIds.has(s.alert.id)) { s.inAlert = true; continue; }
          if (sc.score >= 10) { added.unshift(s.alert); haveIds.add(s.alert.id); s.inAlert = true; pushed++; }
        }
        if (added.length) {
          const merged = _capAlertQueue(added.concat(alerts)).slice(0, 500); /* 2026-08-31 与 _serverAlertGen 同上限：300→500 */
          await query('INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (collection) DO UPDATE SET data_json=$2, updated_at=NOW()', ['alerts', JSON.stringify(merged)]);
          console.log('[ANOMALY] 风险异动信号写入预警中心 ' + added.length + ' 条 / 共检出 ' + signals.length + ' 项（扫描 ' + scanned + ' 个方向）');
        }
      }
    } catch (e) { console.warn('[ANOMALY] 预警写入失败:', e.message); }
    _anomalyState = { at: new Date().toISOString(), signals: top, total: signals.length, scanned, pushed };
  } catch (e) { console.warn('[ANOMALY] 异动检测异常:', e.message); }
}
setInterval(_runAnomalyWatch, 30 * 60 * 1000);
setTimeout(_runAnomalyWatch, 4 * 60 * 1000);
app.get('/api/anomaly/signals', async (req, res) => {
  try {
    const stale = !_anomalyState.at || (Date.now() - new Date(_anomalyState.at).getTime() > 10 * 60 * 1000);
    if (stale) await _runAnomalyWatch();
    res.json(_anomalyState);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/anomaly/detect', async (req, res) => {
  try { await _runAnomalyWatch(); res.json(_anomalyState); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

async function _alertValueSentinel() {
  try {
    const r = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
    if (!r.rows.length || !Array.isArray(r.rows[0].data_json)) return;
    const alerts = r.rows[0].data_json;
    const kept = [], demoted = [];
    for (const a of alerts) {
      if (!a) continue;
      /* 2026-08-17 用户指令：红/橙不再无条件保留——无利益关联的俄乌战况红橙同样移出。
       * 重大伤亡(≥10死)+20 分自然达标，重大国际事件不受影响 */
      if (_isShellAlert(a)) { demoted.push(a); continue; } /* 模板空壳一律移出 */
      if (_isRuUaNoLink(a)) { demoted.push(a); continue; } /* 俄乌无涉华关联一律移出预警中心 */
      const v = _alertInterestScore(a);
      a._interestScore = v.score; a._interestHits = v.hits;
      if (v.score >= 10) kept.push(a); /* 阈值 20→10 */
      else demoted.push(a);
    }
    /* 2026-08-25 国别均衡帽+72h 陈条目清理：即使无降级也执行，保证队列国别多样性持续生效 */
    const capped = _capAlertQueue(kept);
    if (demoted.length || capped.length !== kept.length) {
      demoted.forEach(a => _gateAudit('哨兵', 'demote', a.title));
      await query('UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2', [JSON.stringify(capped), 'alerts']);
      console.log('[VALUE-SENTINEL] 移出无利益关联低烈度预警 ' + demoted.length + ' 条，国别帽/陈条目裁 ' + (kept.length - capped.length) + ' 条，保留 ' + capped.length + ' 条');
    }
    /* 给保留条目回写利益关联标注（前端可直接展示"影响"标签） */
    const avg = capped.length ? Math.round(capped.reduce((s2, a) => s2 + (a._interestScore || 0), 0) / capped.length) : 0;
    _valueSentinelState = { at: new Date().toISOString(), total: alerts.length, kept: capped.length, demoted: demoted.length, avgScore: avg };
  } catch (e) { console.warn('[VALUE-SENTINEL] 巡检异常:', e.message); }
}
let _valueSentinelState = { at: null, total: 0, kept: 0, demoted: 0, avgScore: 0 };
setInterval(_alertValueSentinel, 30 * 60 * 1000);
setTimeout(_alertValueSentinel, 90 * 1000);

setInterval(_qualityGuardian, 30 * 60 * 1000);
setTimeout(_qualityGuardian, 60 * 1000); /* 启动 1 分钟后首巡 */

app.get('/api/quality', (req, res) => { res.json(_qualityReport); });

/* ===== 预警处置闭环 API（2026-08-20：状态机 + SLA 持久化）===== */
app.post('/api/alerts/:id/disposition', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { action, notes, assigned_to } = req.body || {};
    const valid = ['ack', 'acknowledged', 'respond', 'responding', 'resolve', 'resolved', 'reopen', 'active', 'dismiss', 'dismissed'];
    if (!valid.includes(action)) return res.status(400).json({ error: '无效处置动作' });
    const statusMap = { ack: 'acknowledged', acknowledged: 'acknowledged', respond: 'responding', responding: 'responding', resolve: 'resolved', resolved: 'resolved', reopen: 'active', active: 'active', dismiss: 'resolved', dismissed: 'resolved' };
    const status = statusMap[action];
    const now = new Date();
    const updates = { status };
    if (status === 'acknowledged') updates.acknowledged_at = now;
    if (status === 'resolved') { if (!updates.acknowledged_at) updates.acknowledged_at = now; updates.resolved_at = now; }
    if (status === 'active') { updates.acknowledged_at = null; updates.resolved_at = null; }
    if (assigned_to) updates.assigned_to = assigned_to;
    if (notes) updates.notes = notes;
    // upsert by alert_no or id
    let existing = null;
    if (id.startsWith('SRV-')) {
      const intelId = parseInt(id.replace('SRV-', ''), 10);
      const r = await query('SELECT * FROM alert_records WHERE alert_no = $1 OR intel_id = $2 LIMIT 1', [id, isNaN(intelId) ? null : intelId]);
      existing = r.rows[0];
    } else {
      const r = await query('SELECT * FROM alert_records WHERE alert_no = $1 LIMIT 1', [id]);
      existing = r.rows[0];
    }
    if (existing) {
      const setKeys = Object.keys(updates);
      const setSql = setKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      await query('UPDATE alert_records SET ' + setSql + ' WHERE id = $' + (setKeys.length + 1), [...setKeys.map(k => updates[k]), existing.id]);
    } else {
      // Try to find title/country/level from datahub_store alerts if available
      let title = '', country = '', level = 'yellow';
      try {
        const dh = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
        const arr = (dh.rows[0] && Array.isArray(dh.rows[0].data_json)) ? dh.rows[0].data_json : [];
        const hit = arr.find(a => String(a.id) === id || String(a.alert_no) === id);
        if (hit) { title = hit.title || hit.title_zh || ''; country = hit.country || ''; level = hit.level || 'yellow'; }
      } catch (e) {}
      await query('INSERT INTO alert_records (alert_no, title, country, level, status, triggered_at, acknowledged_at, resolved_at, assigned_to, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [id, title, country, level, status, now, updates.acknowledged_at || null, updates.resolved_at || null, assigned_to || null, notes || null]);
    }
    res.json({ success: true, status });
    /* 处置状态变更时自动调用推送通道 */
    (function () {
      try {
        let eventType = null;
        if (status === 'acknowledged') eventType = 'ack';
        else if (status === 'responding') eventType = 'respond';
        else if (status === 'resolved') eventType = 'resolve';
        if (!eventType) return;
        query("SELECT data_json FROM datahub_store WHERE collection='alerts'").then(function (dh) {
          const arr = (dh.rows[0] && Array.isArray(dh.rows[0].data_json)) ? dh.rows[0].data_json : [];
          const hit = arr.find(a => String(a.id) === id || String(a.alert_no) === id);
          if (hit) _dispatchAlertPushes(hit, eventType).catch(function (e) { console.warn('[PUSH] disposition dispatch error:', e.message); });
        }).catch(function () {});
      } catch (e) {}
    })();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/alerts/disposition/stats', authMiddleware, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const totalR = await query('SELECT COUNT(*) c FROM alert_records WHERE triggered_at >= $1', [today]);
    const activeR = await query("SELECT COUNT(*) c FROM alert_records WHERE status='active' AND triggered_at >= $1", [today]);
    const ackR = await query("SELECT COUNT(*) c FROM alert_records WHERE status='acknowledged' AND triggered_at >= $1", [today]);
    const respR = await query("SELECT COUNT(*) c FROM alert_records WHERE status='responding' AND triggered_at >= $1", [today]);
    const resolvedR = await query("SELECT COUNT(*) c FROM alert_records WHERE status='resolved' AND triggered_at >= $1", [today]);
    const slaR = await query("SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - triggered_at))/60) avg_min FROM alert_records WHERE status='resolved' AND triggered_at >= $1", [today]);
    const slaGoodR = await query("SELECT COUNT(*) c FROM alert_records WHERE status='resolved' AND triggered_at >= $1 AND resolved_at - triggered_at <= INTERVAL '4 hours'", [today]);
    const total = parseInt(totalR.rows[0].c, 10);
    const resolved = parseInt(resolvedR.rows[0].c, 10);
    const slaAvg = slaR.rows[0].avg_min ? Math.round(slaR.rows[0].avg_min) : 0;
    const slaGood = parseInt(slaGoodR.rows[0].c, 10);
    const slaPct = resolved > 0 ? Math.round(slaGood / resolved * 100) : 0;
    res.json({ total, active: parseInt(activeR.rows[0].c, 10), acknowledged: parseInt(ackR.rows[0].c, 10), responding: parseInt(respR.rows[0].c, 10), resolved, slaPct, slaAvgMin: slaAvg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 数据导出 API（2026-08-20：日报/周报/月报 Excel/PDF/CSV）===== */
function _rangeDates(range) {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'weekly') start.setDate(start.getDate() - 6);
  else if (range === 'monthly') start.setDate(start.getDate() - 29);
  return { start, end };
}
async function _exportAlertsData(range) {
  const { start, end } = _rangeDates(range);
  const dh = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
  let alerts = (dh.rows[0] && Array.isArray(dh.rows[0].data_json)) ? dh.rows[0].data_json : [];
  alerts = alerts.filter(a => {
    const t = new Date(a.time || a.date || a.publishedAt || 0).getTime();
    return t && t >= start.getTime() && t <= end.getTime();
  });
  const rows = alerts.map(a => ({
    编号: a.alert_no || a.id, 时间: a.time || '', 级别: a.level || '', 状态: a.status || 'active',
    国家: a.country || '', 类型: a.type || '', 标题: a.title_zh || a.title || '',
    来源: a.source || '', 链接: a.url || '', 处置人: a.assigned_to || ''
  }));
  const countryStats = {};
  alerts.forEach(a => { const c = a.country || '其他'; if (!countryStats[c]) countryStats[c] = { 国家: c, 红: 0, 橙: 0, 黄: 0, 蓝: 0, 总计: 0 }; countryStats[c][{ red: '红', orange: '橙', yellow: '黄', blue: '蓝' }[a.level] || '其他']++; countryStats[c].总计++; });
  return { start, end, alerts: rows, countryStats: Object.values(countryStats) };
}
app.get('/api/export/alerts', authMiddleware, async (req, res) => {
  try {
    const { format = 'xlsx', range = 'daily' } = req.query;
    const data = await _exportAlertsData(range);
    if (format === 'csv') {
      const headers = Object.keys(data.alerts[0] || {});
      const csv = [headers.join(','), ...data.alerts.map(r => headers.map(h => '"' + String(r[h] || '').replace(/"/g, '""') + '"').join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="alerts_${range}_${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send('\uFEFF' + csv);
    }
    if (format === 'xlsx') {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(data.alerts);
      const ws2 = XLSX.utils.json_to_sheet(data.countryStats);
      XLSX.utils.book_append_sheet(wb, ws1, '预警列表');
      XLSX.utils.book_append_sheet(wb, ws2, '国家统计');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="alerts_${range}_${new Date().toISOString().slice(0,10)}.xlsx"`);
      return res.send(buf);
    }
    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 40 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => {
        const buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="alerts_${range}_${new Date().toISOString().slice(0,10)}.pdf"`);
        res.send(buf);
      });
      const fontPath = 'C:/Windows/Fonts/simhei.ttf';
      try { if (require('fs').existsSync(fontPath)) doc.registerFont('zh', fontPath); else doc.registerFont('zh', 'Helvetica'); } catch (e) { doc.registerFont('zh', 'Helvetica'); }
      doc.font('zh').fontSize(16).text(`海外利益保护情报预警平台 - ${range === 'daily' ? '日报' : range === 'weekly' ? '周报' : '月报'}`, 40, 40);
      doc.fontSize(10).text(`统计周期：${data.start.toLocaleString('zh-CN')} ~ ${data.end.toLocaleString('zh-CN')}`, 40, 70);
      doc.moveDown();
      doc.fontSize(12).text('预警列表', { underline: true });
      doc.moveDown(0.5);
      data.alerts.forEach((r, i) => {
        doc.fontSize(9).text(`${i + 1}. [${r.级别}] ${r.标题} (${r.国家}) ${r.时间}`);
        if (r.链接) doc.fontSize(8).fillColor('#666').text(`   来源：${r.来源} | ${r.链接}`).fillColor('black');
      });
      doc.addPage();
      doc.fontSize(12).text('国家分布统计', { underline: true });
      doc.moveDown(0.5);
      data.countryStats.forEach(r => {
        doc.fontSize(10).text(`${r.国家}: 总计${r.总计} (红${r.红} 橙${r.橙} 黄${r.黄})`);
      });
      doc.end();
      return;
    }
    res.status(400).json({ error: '不支持的格式' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 多渠道预警推送配置与发送（2026-08-20：邮件/钉钉/企业微信）===== */
async function _getPushConfig(userId) {
  const r = await query("SELECT setting_val FROM user_settings WHERE user_id=$1 AND setting_key='push_config'", [userId]);
  return r.rows.length ? r.rows[0].setting_val : {};
}
async function _setPushConfig(userId, cfg) {
  await query('INSERT INTO user_settings (user_id, setting_key, setting_val, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (user_id, setting_key) DO UPDATE SET setting_val=$3, updated_at=NOW()', [userId, 'push_config', JSON.stringify(cfg)]);
}
app.get('/api/settings/push', authMiddleware, async (req, res) => {
  try { res.json({ config: await _getPushConfig(req.user.id) }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/settings/push', authMiddleware, async (req, res) => {
  try {
    const cfg = req.body || {};
    await _setPushConfig(req.user.id, cfg);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
async function _sendDingTalk(webhook, secret, text) {
  const crypto = require('crypto');
  const timestamp = Date.now();
  const sign = crypto.createHmac('sha256', secret || '').update(timestamp + '\n' + (secret || '')).digest('base64');
  const url = webhook + (webhook.indexOf('?') >= 0 ? '&' : '?') + 'timestamp=' + timestamp + '&sign=' + encodeURIComponent(sign);
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: text } }) });
  return { ok: r.ok, status: r.status };
}
async function _sendWeCom(webhook, text) {
  const r = await fetch(webhook, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: text } }) });
  return { ok: r.ok, status: r.status };
}
async function _sendEmail(cfg, subject, text) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ host: cfg.smtpHost, port: parseInt(cfg.smtpPort || '587', 10), secure: cfg.smtpSecure === true, auth: { user: cfg.smtpUser, pass: cfg.smtpPass } });
  await transporter.sendMail({ from: cfg.smtpFrom || cfg.smtpUser, to: cfg.emailTo, subject, text });
  return { ok: true };
}

/* ===== 真实预警触发时自动调用推送通道 ===== */
async function _getAllPushConfigs() {
  try {
    const r = await query("SELECT user_id, setting_val FROM user_settings WHERE setting_key='push_config'");
    return r.rows.map(function (row) {
      try {
        const cfg = (typeof row.setting_val === 'string') ? JSON.parse(row.setting_val) : row.setting_val;
        if (!cfg || typeof cfg !== 'object') return null;
        return { userId: row.user_id, cfg: cfg };
      } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
}
function _isPushEnabled(cfg) {
  if (cfg.enabled === false) return false;
  if (cfg.enabled === true) return true;
  /* 旧配置兼容：只要配了任意通道且未显式关闭，视为启用 */
  return !!(cfg.smtpHost && cfg.emailTo) || !!cfg.dingWebhook || !!cfg.wecomWebhook;
}
function _eventAllowed(cfg, eventType) {
  const map = { new: 'pushOnNew', ack: 'pushOnAck', respond: 'pushOnRespond', resolve: 'pushOnResolve', escalate: 'pushOnEscalate' };
  const key = map[eventType];
  if (!key) return false;
  if (cfg[key] === true) return true;
  if (cfg[key] === false) return false;
  /* 默认：新预警和解除时推送 */
  return eventType === 'new' || eventType === 'resolve';
}
async function _dispatchAlertPushes(alert, eventType) {
  try {
    if (!alert) return;
    const users = await _getAllPushConfigs();
    if (!users.length) return;
    const levelLabel = { red: '🔴红色', orange: '🟠橙色', yellow: '🟡黄色', blue: '🔵蓝色' }[alert.level] || alert.level;
    const title = alert.title_zh || alert.title || '';
    const country = alert.country || '';
    const alertNo = alert.alert_no || alert.id || '';
    const url = alert.url || '';
    const statusLabel = { new: '新预警', ack: '已确认', respond: '处置中', resolve: '已解除', escalate: '已升级' }[eventType] || eventType;
    const text = '【ORPS ' + statusLabel + '】\n等级：' + levelLabel + '\n标题：' + title + (country ? '\n国家/地区：' + country : '') + (alertNo ? '\n编号：' + alertNo : '') + (url ? '\n链接：' + url : '') + '\n时间：' + new Date().toLocaleString('zh-CN');
    const subject = 'ORPS ' + statusLabel + ' ' + levelLabel + ' ' + title.slice(0, 40);
    const levelOrder = { blue: 1, yellow: 2, orange: 3, red: 4 };
    for (const u of users) {
      const cfg = u.cfg;
      if (!_isPushEnabled(cfg)) continue;
      if (!_eventAllowed(cfg, eventType)) continue;
      if (eventType === 'new' && cfg.pushMinLevel) {
        if ((levelOrder[alert.level] || 0) < (levelOrder[cfg.pushMinLevel] || 0)) continue;
      }
      const tasks = [];
      if (cfg.smtpHost && cfg.smtpUser && cfg.emailTo) tasks.push(_sendEmail(cfg, subject, text).catch(function (e) { return { ok: false, error: e.message }; }));
      if (cfg.dingWebhook) tasks.push(_sendDingTalk(cfg.dingWebhook, cfg.dingSecret, text).catch(function (e) { return { ok: false, error: e.message }; }));
      if (cfg.wecomWebhook) tasks.push(_sendWeCom(cfg.wecomWebhook, text).catch(function (e) { return { ok: false, error: e.message }; }));
      if (tasks.length) {
        Promise.all(tasks).then(function (results) {
          console.log('[PUSH] user=' + u.userId + ' event=' + eventType + ' results=' + JSON.stringify(results));
        }).catch(function (e) { console.warn('[PUSH] user=' + u.userId + ' event=' + eventType + ' error:', e.message); });
      }
    }
  } catch (e) { console.warn('[PUSH] dispatch error:', e.message); }
}

app.post('/api/push/test', authMiddleware, async (req, res) => {
  try {
    const { channel } = req.body || {};
    const cfg = await _getPushConfig(req.user.id);
    const text = '【ORPS 测试】海外利益保护情报预警平台推送通道测试成功\n时间：' + new Date().toLocaleString('zh-CN');
    let result;
    if (channel === 'dingtalk') result = await _sendDingTalk(cfg.dingWebhook, cfg.dingSecret, text);
    else if (channel === 'wecom') result = await _sendWeCom(cfg.wecomWebhook, text);
    else if (channel === 'email') result = await _sendEmail(cfg, 'ORPS 邮件推送测试', text);
    else return res.status(400).json({ error: '无效通道' });
    res.json({ success: result.ok, detail: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 大模型研判中转（2026-08-16：未来预警接入 Kimi）=====
 * 密钥仅存服务端 .env（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL），浏览器永远接触不到。
 * 前端提交系统真实推演摘要 → 服务端组 prompt → 调大模型 → 返回研判专报。
 * 成功结果缓存 10 分钟；账户欠费等失败如实透传，绝不编造内容。 */
/* OpenAI 兼容协议通用调用（Kimi/星火/其他兼容服务通用） */
function _callOpenAiCompat(pv, prompt) {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const body = JSON.stringify({ model: pv.model, messages: [{ role: 'user', content: prompt }], max_tokens: pv.maxTokens });
      const u = new URL(pv.base + '/chat/completions');
      const rq = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: pv.timeout, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pv.key, 'Content-Length': Buffer.byteLength(body) }       }, (llmRes) => {
        const chunks = [];
        llmRes.on('data', c => chunks.push(c));
        llmRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let j = {};
          try { j = JSON.parse(raw); } catch (e) { return resolve({ text: '', error: '返回解析失败(HTTP ' + llmRes.statusCode + '): ' + raw.slice(0, 160) }); }
          if (j.error || (j.code && j.code !== 0)) {
            const m = (j.error && j.error.message) || j.message || ('code ' + j.code);
            return resolve({ text: '', error: 'HTTP ' + llmRes.statusCode + ' ' + m });
          }
          const ch = (j.choices && j.choices[0]) || {};
          const msg = ch.message || {};
          if (!msg.content) {
            /* 推理模型 thinking 烧尽 max_tokens 时 content 为空（2026-09-01 排障发现） */
            const fin = ch.finish_reason || '—';
            const rlen = (msg.reasoning_content || '').length;
            return resolve({ text: '', error: rlen ? '空内容(推理' + rlen + '字, finish=' + fin + ')' : '空内容(finish=' + fin + ')' });
          }
          resolve({ text: msg.content, error: '' });
        });
      });
      rq.on('error', e => resolve({ text: '', error: e.message }));
      rq.on('timeout', () => { rq.destroy(); resolve({ text: '', error: '调用超时' }); });
      rq.end(body);
    } catch (e) { resolve({ text: '', error: e.message }); }
  });
}

let _llmCache = { at: 0, key: '', text: '', model: '' };
app.post('/api/llm/foresee-report', authMiddleware, async (req, res) => {
  try {
    const KEY = process.env.LLM_API_KEY || '';
    const BASE = (process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
    const MODEL = process.env.LLM_MODEL || 'kimi-k2.6';
    if (!KEY) return res.status(503).json({ ok: false, error: '服务端未配置 LLM_API_KEY' });
    const p = req.body || {};
    const sig = JSON.stringify((p.countries || []).slice(0, 12).map(c => [c.name, c.cur, c.pred, c.r3]));
    if (_llmCache.text && _llmCache.key === sig && Date.now() - _llmCache.at < 10 * 60 * 1000) {
      return res.json({ ok: true, text: _llmCache.text, model: _llmCache.model, cached: true, at: new Date(_llmCache.at).toISOString() });
    }
    const lines = (p.countries || []).slice(0, 12).map((c, i) =>
      (i + 1) + '. ' + c.name + '：当前风险 ' + c.cur + ' → 预判 ' + c.pred + '（' + c.level + '）；近72h事件 ' + c.r3 + ' 起（前72h ' + c.p3 + ' 起）；红色预警 ' + c.red + ' 起，橙色 ' + c.orange + ' 起；项目融合告警 ' + c.fusion + ' 条；活跃威胁组织关联 ' + c.orgs + ' 个；主导类型 ' + (c.domType || '—') + '；驱动因素：' + ((c.contrib || []).map(x => x.label + '(' + (x.v > 0 ? '+' : '') + x.v + ')').join('、') || '无新增信号')
    ).join('\n');
    const prompt = '你是中国海外利益保护情报预警平台的资深研判专家。以下是系统基于今日实时采集数据（事件增速、红橙预警、项目融合告警、威胁组织活跃度、国别风险分）推演出的未来72小时国别风险清单：\n\n' + lines + '\n\n今日系统全库新入库情报 ' + (p.todayTotal || '—') + ' 条，涉华 ' + (p.chinaToday || '—') + ' 条，境外涉华负面 ' + (p.negToday || '—') + ' 条。\n\n请输出一份《未来72小时海外利益风险研判专报》，要求：\n1. 【总体判断】一段话概括全球态势主线与未来72小时最需警惕的方向；\n2. 【重点国家】对清单前5国逐一给出：风险走向判断、最可能的触发场景、对中资人员/项目/通道的具体威胁；\n3. 【涉华关联】单独分析清单中涉及中国海外利益的信号链（项目、人员、通道、舆情）；\n4. 【行动建议】按外交部/安全部/商务部/央企四方分别给出1-2条可执行建议；\n5. 全程只基于给定数据研判，不虚构事实；判断要有分寸，区分"确定信号"与"推测"。\n中文输出，总长度控制在900字内，小标题加粗。';
    const t0 = Date.now();
    /* 主备双通道（2026-08-16）：Kimi 主、讯飞星火备——任一可用即出稿 */
    const providers = [
      { name: 'Kimi', base: BASE, key: KEY, model: MODEL, maxTokens: 6000, timeout: 150000 },
      { name: 'Spark', base: (process.env.LLM2_BASE_URL || 'https://spark-api-open.xf-yun.com/v1').replace(/\/+$/, ''), key: process.env.LLM2_API_KEY || '', model: process.env.LLM2_MODEL || '4.0Ultra', maxTokens: 3000, timeout: 90000 }
    ].filter(x => x.key);
    let text = '', usedModel = '', usedBy = '', lastErr = '';
    for (const pv of providers) {
      try {
        const r2 = await _callOpenAiCompat(pv, prompt);
        if (r2.text) { text = r2.text; usedModel = pv.model; usedBy = pv.name; break; }
        lastErr = pv.name + ': ' + (r2.error || '空内容');
      } catch (e) { lastErr = pv.name + ': ' + e.message; }
      console.warn('[LLM] ' + pv.name + ' 失败，切换下一通道:', lastErr);
    }
    if (!text) {
      const friendly = /insufficient balance|exceeded_current_quota/i.test(lastErr) ? '大模型账户欠费停机，充值后立即可用'
        : /HMAC|does not match|Unauthorized|401/i.test(lastErr) ? '大模型密钥鉴权失败（请核对控制台完整密钥）'
        : (lastErr || '大模型调用失败');
      return res.status(502).json({ ok: false, error: friendly, raw: lastErr });
    }
    _llmCache = { at: Date.now(), key: sig, text: text, model: usedModel };
    res.json({ ok: true, text: text, model: usedModel + (usedBy === 'Spark' ? '（星火备援）' : ''), elapsed: ((Date.now() - t0) / 1000).toFixed(1) + 's', at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ===== 通用大模型研判（2026-08-16：专家团会商 / 情景路径推演）=====
 * kind=expert-panel：AI 专家团四方会商（安全/外交/经贸/风控），严格使用给定真实数据；
 * kind=scenario-path：对指定情景生成 恶化/僵持/缓和 三分支路径推演。
 * 结果按 kind+数据签名缓存 10 分钟。 */
/* ===== 本地研判引擎降级（2026-08-30 用户：Kimi 欠费用不了，要求系统自动生成）=====
 * 所有云端大模型失败（欠费/限流/断网）时，基于请求内真实数据（stats/countries/scenario/alert）
 * 用规则引擎生成结构化研判文本——与 LLM 输出同构（四段专家会商/三分支路径/JSON 预案），
 * 前端零改动即可渲染。model 字段标记"本地研判引擎（免费降级）"做到透明可辨。
 * 铁律：只引用传入的真实数字，不编造数据；概率由 (pred-cur) 等真实差值推导。 */
function _localExpertPanel(p) {
  const stats = p.stats || {};
  const top = (p.countries || []).slice(0, 3);
  const names = top.map(c => c.name).join('、') || '无显著热点';
  const t0 = top[0], t1 = top[1] || top[0], t2 = top[2] || top[0];
  const out = [];
  out.push('【安全态势专家】今日全库采集 ' + (stats.total || '—') + ' 条、涉华 ' + (stats.china || '—') + ' 条。' +
    (t0 ? '首要风险方向为' + t0.name + '（当前 ' + t0.cur + ' → 预判 ' + t0.pred + '，近72h事件 ' + t0.r3 + ' 起，红/橙预警 ' + t0.red + '/' + t0.orange + '，主导维度 ' + (t0.domType || '综合') + '），' +
      (Number(t0.pred) >= 7.5 ? '态势处于高位，对我在当地人员与项目构成现实威胁。建议：立即核查当地人员与项目点位，提升安保等级。' : '建议：保持常态监控，重点跟踪红区事件演变。') : '当前无重点国家信号。建议：维持全域例行监控。'));
  out.push('【外交地缘专家】境外涉华负面情报 ' + (stats.neg || 0) + ' 条。' +
    (t1 ? '重点关注' + t1.name + '局势对双边关系与我驻外机构安全的影响。' : '') +
    '建议：预置领事保护联络渠道，评估撤侨与集结预案的触发条件。');
  out.push('【经贸合规专家】建议对高风险国别业务开展合规敞口排查，重点核查制裁、出口管制与资金汇出通道。' +
    (t2 ? t2.name + '风险预判 ' + t2.pred + '，涉该国在执行合同须评估中断与不可抗力条款。' : '') +
    '建议：法务预审替代供应与结算路径。');
  out.push('【项目风控专家】重点国家：' + names + '。建议：核对上述国家中资项目资产与人员台账，确认保险覆盖与应急联络机制；风险预判 ≥7 的国别项目执行每日安全报告制度。');
  return out.join('\n\n');
}
function _localScenarioPath(p) {
  const sc = p.scenario || {};
  const cur = Number(sc.cur) || 5, pred = Number(sc.pred) || cur;
  const delta = pred - cur;
  const pBad = Math.max(20, Math.min(60, Math.round(40 + delta * 8)));
  const pHold = Math.round((100 - pBad) * 0.55);
  const pGood = 100 - pBad - pHold;
  const drivers = (sc.drivers || []).join('、') || '近72h事件聚集';
  const aff = (sc.affected || []).join('、');
  const dim = sc.domDim || '综合';
  return '【恶化路径】（概率' + pBad + '%）：' + drivers + ' 持续发酵，风险分预计突破 ' + (pred + 0.5).toFixed(1) + '。' +
    '关键触发点：' + dim + '类事件 24-72h 内再现或升级；连锁影响：' + (aff ? aff + '面临直接冲击、' : '') + '当地运营环境收紧。预警信号：红区事件新增≥2 或出现人员伤亡。' +
    '\n\n【僵持路径】（概率' + pHold + '%）：当前信号强度维持，风险在 ' + cur + '~' + pred + ' 区间震荡，暂无进一步升级证据。关键触发点：各方对峙常态化。预警信号：橙区事件持续但红区清零。' +
    '\n\n【缓和路径】（概率' + pGood + '%）：72h 内无新增' + dim + '类红区事件，信号自然衰减，风险回落至 ' + Math.max(0, cur - 0.4).toFixed(1) + '。关键触发点：局势出现降温信号。预警信号：连续 72h 无红色情报入库。';
}
function _localPlaybookRecommend(p) {
  const al = p.alert || {};
  const t = String(al.title || '') + ' ' + String(al.desc || '');
  const rules = [[/绑架|人质|劫持|被绑|掳走/, 'P-01'], [/制裁|禁运|实体清单|SDN|出口管制/, 'P-03'], [/政变|抗议|骚乱|戒严|冲突升级/, 'P-04'], [/网络攻击|黑客|勒索|数据泄露/, 'P-05']];
  for (const r of rules) if (r[0].test(t)) return JSON.stringify({ id: r[1], reason: '本地规则匹配：标题含明确紧急事件特征' });
  return JSON.stringify({ id: 'none', reason: '本地规则未见紧急事件特征，建议人工复核' });
}
/* ===== 本地研判引擎降级：AI情报分析报告（intel-report）=====
 * 云端大模型全失败时，基于前端装配的真实系统数据（预警统计/高价值事件/八维推演/
 * 关联簇/项目暴露/COSRI 画像）用规则引擎生成结构化研判 JSON——与 LLM 输出同构，
 * 前端零改动可解析。铁律：只引用传入的真实数字与事件标题，不编造数据。 */
function _localIntelReport(p) {
  const st = p.stats || {};
  const fs = p.foresee || {};
  const co = p.cosri || {};
  const ev = (p.events || []).slice(0, 8);
  const winName = ({ '24h': '24小时', '72h': '72小时', '7d': '7天' })[String(p.win || '72h')] || '72小时';
  const cName = String(p.country || '目标国');
  const top = ev[0] || null;
  const redN = st.red || 0, orN = st.orange || 0, ylN = st.yellow || 0;
  const total = st.total || 0, cnN = st.china || 0, asN = st.assetHit || 0;
  const et = t => String(t || '').replace(/[\r\n]+/g, ' ').slice(0, 50);
  const times = ev.map(e => String(e.time || '')).filter(Boolean).sort();
  /* 涉事方：从真实事件文本正则归纳，没有就如实说没有 */
  const P_RX = /(塔利班|青年党|博科圣地|伊斯兰国|基地组织|胡塞武装|真主党|哈马斯|俾路支|分离武装|武装分子|政府军|警方|反对派|军方)/;
  let person = '';
  for (const e of ev) { const m = String(e.title || '').match(P_RX); if (m && person.indexOf(m[1]) < 0) person = person ? person + '、' + m[1] : m[1]; }
  const ast = (p.assets || []).map(a => typeof a === 'string' ? a : ((a.name || '') + (a.ent ? '（' + a.ent + '）' : ''))).filter(Boolean);
  const elements = {
    time: times.length ? (times[0] + ' 至 ' + times[times.length - 1]) : '窗口内无带时间戳事件',
    place: cName + '（具体点位见引用预警明细）',
    person: person || '事件文本中未识别到明确涉事组织',
    cause: top ? ('由「' + et(top.title) + '」等窗口内高价值信号构成') : '窗口内无预警事件，无起因数据',
    process: ev.length ? ('窗口内代表性事件依次为：' + ev.slice(0, 3).map((e, i) => (i + 1) + '.' + et(e.title)).join('；')) : '窗口内无预警事件',
    result: redN || orN ? ('已触发红色预警 ' + redN + ' 条、橙色 ' + orN + ' 条') : '窗口内未触发红/橙级预警'
  };
  let summary = '近' + winName + '，' + cName + '共监测预警 ' + total + ' 条（红 ' + redN + '、橙 ' + orN + '、黄 ' + ylN + '），涉华命中 ' + cnN + ' 条、中资资产命中 ' + asN + ' 条';
  if (fs.cur != null) summary += '；八维风险推演 ' + fs.cur + ' → ' + fs.pred + '（' + (Number(fs.delta) >= 0 ? '+' : '') + fs.delta + '）';
  summary += '。' + (top ? '首要信号为「' + et(top.title) + '」。' : '窗口内无显著信号。') + ((p.clusters || []).length ? '发现事件关联簇 ' + p.clusters.length + ' 个。' : '');
  const tp = [];
  tp.push('【窗口态势】近' + winName + '该国预警总量 ' + total + ' 条，其中红色 ' + redN + ' 条、橙色 ' + orN + ' 条；涉华命中 ' + cnN + ' 条，命中中资资产标签 ' + asN + ' 条。');
  if (ev.length) tp.push('【重点事件】（按预警价值排序）\n' + ev.slice(0, 5).map((e, i) => (i + 1) + '. [' + (e.level || '—') + '][' + (e.type || '—') + '] ' + et(e.title) + '（' + (e.time || '时间不详') + '）').join('\n'));
  if (fs.cur != null) tp.push('【八维推演】当前综合风险 ' + fs.cur + '、未来 72 小时预判 ' + fs.pred + '（' + (Number(fs.delta) >= 0 ? '+' : '') + fs.delta + '，' + (fs.level || '—') + '）' +
    (fs.domDim ? '；主导维度：' + fs.domDim : '') +
    ((fs.contrib || []).length ? '；驱动因素：' + fs.contrib.slice(0, 5).map(x => x.label + (Number(x.v) >= 0 ? '+' : '') + x.v).join('、') : '；无显著新增驱动'));
  if ((p.clusters || []).length) tp.push('【关联簇】' + p.clusters.slice(0, 4).map(c => (c.title || '') + '——' + (c.detail || ('窗口内聚集 ' + (c.n || 0) + ' 起'))).join('；'));
  if ((p.orgs || []).length) tp.push('【威胁组织】关联活跃威胁组织 ' + p.orgs.length + ' 个：' + p.orgs.slice(0, 6).join('、') + '，须评估其针对中资目标的袭击能力。');
  const threatAnalysis = tp.join('\n\n');
  const ip = [];
  ip.push(ast.length ? '【项目暴露】该国在册中资项目 ' + ast.length + ' 个：' + ast.slice(0, 6).join('、') + '，须逐一核实现场人员与安保等级。' : '【项目暴露】系统内暂无该国中资项目记录，以人员与机构安全为主要关注面。');
  if (cnN) ip.push('涉华命中 ' + cnN + ' 条，建议立即核查我在当地人员、企业与使领馆机构安全状况。');
  if (asN) ip.push('有 ' + asN + ' 条预警命中中资资产标签，相关资产所在区域风险抬头，建议联动资产档案复核撤离预案。');
  if (fs.pred != null && Number(fs.pred) >= 6.5) ip.push('八维风险预判 ' + fs.pred + ' 处于高位区间，人员安全、业务连续性与供应链稳定性压力上升，建议压缩非必要外事活动。');
  else if (fs.pred != null) ip.push('八维风险预判 ' + fs.pred + '，维持常态监测，关注红/橙预警增量的边际变化。');
  if (redN) ip.push('红色预警 ' + redN + ' 条在库，若 72 小时内同类型再现，建议升级响应并启动应急通信核查。');
  const impactAnalysis = ip.join('\n');
  let advice;
  if (co.guide && co.guide.length) {
    advice = '依据系统 COSRI 国别行动指引：\n' + co.guide.slice(0, 8).map((g, i) => (i + 1) + '. ' + g).join('\n');
  } else {
    const adv = [];
    if (redN || orN) adv.push('红/橙预警在库，立即核实在事人员安全并提升安保等级，压缩非必要外出');
    if (cnN || asN) adv.push('涉华/资产信号命中，核查我在当地项目、人员与机构暴露面，建立每日安全报告制度');
    if (ast.length) adv.push('对在册中资项目逐一复核安保等级、保险覆盖与应急联络机制');
    adv.push('保持 72 小时情报窗口滚动监测，红色预警新增≥2 或出现人员伤亡即升级响应');
    advice = adv.map((g, i) => (i + 1) + '. ' + g).join('\n');
  }
  return JSON.stringify({ summary: summary, elements: elements, threatAnalysis: threatAnalysis, impactAnalysis: impactAnalysis, advice: advice });
}
const _llmRunCache = {};
app.post('/api/llm/run', authMiddleware, async (req, res) => {
  try {
    const KEY = process.env.LLM_API_KEY || '';
    const BASE = (process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
    const MODEL = process.env.LLM_MODEL || 'kimi-k2.6';
    const p = req.body || {};
    const kind = String(p.kind || '');
    const sig = kind + '|' + JSON.stringify(p).slice(0, 400);
    const ck = _llmRunCache[sig];
    if (ck && Date.now() - ck.at < 10 * 60 * 1000) return res.json({ ok: true, text: ck.text, model: ck.model, cached: true, at: new Date(ck.at).toISOString() });
    let prompt = '';
    if (kind === 'expert-panel') {
      const stats = p.stats || {};
      const clist = (p.countries || []).slice(0, 10).map((c, i) => (i + 1) + '. ' + c.name + '：当前 ' + c.cur + ' → 预判 ' + c.pred + '；近72h事件 ' + c.r3 + ' 起；红/橙预警 ' + c.red + '/' + c.orange + '；主导维度 ' + (c.domType || '—')).join('\n');
      prompt = '你是中国海外利益保护平台的AI专家团。基于以下系统实时数据，以四位专家身份分别输出研判（每位120字内）：\n' +
        '【安全态势专家】聚焦人员与项目安全威胁；【外交地缘专家】聚焦大国博弈与外交窗口；【经贸合规专家】聚焦制裁/关税/合规风险；【项目风控专家】聚焦中资项目资产敞口与保险安排。\n\n' +
        '今日全库新入库 ' + (stats.total || '—') + ' 条，涉华 ' + (stats.china || '—') + ' 条，境外涉华负面 ' + (stats.neg || '—') + ' 条。\n重点国家清单：\n' + clist + '\n\n' +
        '输出格式严格为四段，每段以【安全态势专家】等标记开头；只基于给定数据，不虚构；每段末尾给一句可执行建议（以"建议："起头）。中文。';
    } else if (kind === 'scenario-path') {
      const sc = p.scenario || {};
      prompt = '你是海外利益风险推演专家。基于以下真实数据情景，推演未来1-3个月的发展路径：\n' +
        '情景：' + (sc.name || '') + '\n主导维度：' + (sc.domDim || '—') + '；当前风险 ' + (sc.cur || '—') + ' → 预判 ' + (sc.pred || '—') + '\n' +
        '驱动因素：' + ((sc.drivers || []).join('、') || '—') + '\n波及资产：' + ((sc.affected || []).join('、') || '—') + '\n\n' +
        '输出三分支：【恶化路径】（概率X%、关键触发点、连锁影响、预警信号）；【僵持路径】（同上结构）；【缓和路径】（同上结构）。概率合计100%，每分支120字内。只基于给定数据，不虚构。中文。';
    } else if (kind === 'playbook-recommend') {
      /* 预案智能匹配（2026-08-19 用户指令：推荐预案必须 AI 语义研判，不许关键词瞎匹配） */
      const al = p.alert || {};
      const pbs = (p.playbooks || []).slice(0, 60).map(b => b.id + '《' + b.title + '》(' + (b.type || '') + '/' + (b.level || '') + ')').join('\n');
      prompt = '你是中国海外利益保护情报预警平台的应急预案匹配专家。给你一条预警和应急预案清单，请先判断这条预警是否真的需要启动应急预案，再从清单中选出语义上最匹配的一份。\n\n' +
        '预警标题：' + (al.title || '') + '\n预警摘要：' + String(al.desc || '').slice(0, 300) + '\n事发国：' + (al.country || '—') + '；级别：' + (al.level || '—') + '；类型：' + (al.type || '—') + '\n\n' +
        '应急预案清单：\n' + pbs + '\n\n' +
        '研判规则：\n1. 先判断事件本质：若并非真实紧急事件（历史纪念、文化探访、一般新闻评论、财经资讯，且无现实安全威胁），不需要启动预案，id 输出 "none"；\n2. 若确需预案，按事件本质选最匹配的一份，不要被个别词语误导（标题含"铁路"不等于交通事故，含"爆炸"需区分恐袭与工业事故）；\n3. 只输出一行 JSON，不要输出任何其他内容：{"id":"预案id或none","reason":"中文一句话理由，30字内"}。';
    } else if (kind === 'intel-report') {
      /* 智能情报分析报告（2026-09-01 用户指令：报告必须数据驱动，六要素从真实事件归纳） */
      const st = p.stats || {};
      const fs = p.foresee || {};
      const co = p.cosri || {};
      const ev = (p.events || []).slice(0, 8);
      const winName = ({ '24h': '24小时', '72h': '72小时', '7d': '7天' })[String(p.win || '72h')] || '72小时';
      const evLines = ev.map((e, i) => (i + 1) + '. [' + (e.level || '—') + '][' + (e.type || '—') + '] ' + String(e.title || '').replace(/[\r\n]+/g, ' ').slice(0, 80) + '（' + (e.time || '时间不详') + (e.source ? '，来源：' + String(e.source).slice(0, 30) : '') + '）').join('\n');
      const clLines = (p.clusters || []).slice(0, 6).map((c, i) => (i + 1) + '. 【' + (c.kind || '簇') + '】' + (c.title || '') + '：' + (c.detail || ('窗口内聚集 ' + (c.n || 0) + ' 起'))).join('\n');
      const ast = (p.assets || []).map(a => typeof a === 'string' ? a : ((a.name || '') + (a.ent ? '（' + a.ent + '）' : ''))).filter(Boolean);
      prompt = '你是中国海外利益保护情报预警平台的资深情报研判专家。以下是系统基于实时采集数据装配的国别情报数据，请据此生成一份AI情报分析报告。\n\n' +
        '【国家】' + (p.country || '—') + '　【窗口】近' + winName + '　【报告类型】' + (p.reportType || '综合情报') + '\n' +
        '【预警统计】窗口内预警共 ' + (st.total || 0) + ' 条：红色 ' + (st.red || 0) + '、橙色 ' + (st.orange || 0) + '、黄色 ' + (st.yellow || 0) + '、蓝色 ' + (st.blue || 0) + '；涉华命中 ' + (st.china || 0) + ' 条；命中中资资产标签 ' + (st.assetHit || 0) + ' 条。\n\n' +
        '【高价值事件 TOP' + ev.length + '】（按预警价值评分排序）\n' + (evLines || '窗口内无预警事件。') + '\n\n' +
        '【八维风险推演】' + (fs.cur != null
          ? '当前综合 ' + fs.cur + ' → 未来72小时预判 ' + fs.pred + '（' + (Number(fs.delta) >= 0 ? '+' : '') + fs.delta + '，' + (fs.level || '—') + '）' + (fs.domDim ? '；主导维度：' + fs.domDim : '') + '；驱动因素：' + (((fs.contrib || []).slice(0, 5).map(x => x.label + (Number(x.v) >= 0 ? '+' : '') + x.v).join('、')) || '无显著新增信号')
          : '系统无该国八维推演数据') + '\n\n' +
        '【关联簇】\n' + (clLines || '窗口内未发现事件关联簇。') + '\n\n' +
        '【项目暴露】' + (ast.length ? '该国中资项目 ' + ast.length + ' 个：' + ast.slice(0, 10).join('、') : '系统内暂无该国中资项目记录') + '\n\n' +
        '【威胁组织】' + ((p.orgs || []).length ? '关联活跃威胁组织 ' + p.orgs.length + ' 个：' + p.orgs.slice(0, 8).join('、') : '窗口内无关联威胁组织') + '\n\n' +
        '【COSRI国别画像】' + (co.overall != null
          ? '综合 ' + co.overall + '（政治 ' + ((co.scores || {}).political || '—') + '/经济 ' + ((co.scores || {}).economic || '—') + '/社会 ' + ((co.scores || {}).social || '—') + '/公共安全 ' + ((co.scores || {}).security || '—') + '）；在册中资项目 ' + (co.projects != null ? co.projects : '—') + ' 个；行动指引：' + ((co.guide || []).join('；') || '无')
          : 'COSRI 库未覆盖该国') + '\n\n' +
        '请严格只基于上述数据输出 JSON（不得输出任何其他文字、不得使用markdown代码块）：\n' +
        '{"summary":"报告摘要，120字内，概括窗口内态势主线与核心判断","elements":{"time":"时间（事件时间范围）","place":"地点（国家+事件涉及点位）","person":"涉事方（从事件文本归纳的组织/人员）","cause":"起因（从事件归纳）","process":"过程（TOP事件串联概述）","result":"结果（已造成的后果/当前状态）"},"threatAnalysis":"威胁分析，必须引用具体事件标题与统计数字（如：72小时内红色预警N条、八维风险分升至X），400字内","impactAnalysis":"影响预测，结合项目暴露与八维走势，评估对中资人员/项目/通道的具体影响，300字内","advice":"对策建议，结合COSRI行动指引与预警态势，分条给出可执行措施，300字内"}\n' +
        '铁律：全部中文；六要素只能从给定事件文本归纳，事件中不存在的信息如实写"数据未覆盖"；禁止编造任何数字、组织与事实；threatAnalysis 中至少引用 2 条具体事件标题和 3 个统计数字。';
    } else {
      return res.status(400).json({ ok: false, error: '未知 kind' });
    }
    const providers = [
      { name: 'Kimi', base: BASE, key: KEY, model: MODEL, maxTokens: 6000, timeout: 150000 },
      { name: 'Spark', base: (process.env.LLM2_BASE_URL || 'https://spark-api-open.xf-yun.com/v1').replace(/\/+$/, ''), key: process.env.LLM2_API_KEY || '', model: process.env.LLM2_MODEL || '4.0Ultra', maxTokens: 3000, timeout: 90000 }
    ].filter(x => x.key);
    const t0 = Date.now();
    let text = '', usedModel = '', lastErr = '';
    for (const pv of providers) {
      const r2 = await _callOpenAiCompat(pv, prompt);
      if (r2.text) { text = r2.text; usedModel = pv.model; break; }
      lastErr = pv.name + ': ' + (r2.error || '空内容');
      console.warn('[LLM] ' + kind + ' 通道失败 ' + pv.name + '(' + pv.model + '): ' + (r2.error || '空内容'));
    }
    if (!text) {
      /* 本地研判引擎降级（2026-08-30）：云端大模型全失败时系统自动生成，永远有输出 */
      try {
        if (kind === 'expert-panel') text = _localExpertPanel(p);
        else if (kind === 'scenario-path') text = _localScenarioPath(p);
        else if (kind === 'playbook-recommend') text = _localPlaybookRecommend(p);
        else if (kind === 'intel-report') text = _localIntelReport(p);
        if (text) usedModel = '本地研判引擎（免费降级）';
      } catch (e) { console.warn('[LLM] 本地降级失败:', e.message); }
    }
    if (!text) return res.status(502).json({ ok: false, error: lastErr || '大模型调用失败' });
    _llmRunCache[sig] = { at: Date.now(), text: text, model: usedModel };
    res.json({ ok: true, text: text, model: usedModel, elapsed: ((Date.now() - t0) / 1000).toFixed(1) + 's', at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ===== 活跃库滚动归档（2026-08-28 用户痛点：伦敦使馆旧闻 5 天了一直存在，删了删不掉）=====
 * 预警系统活跃库只保留近 7 天数据；更早的移入 intel_archive 归档表（可查不丢）。
 * 旧数据滞留活跃库的三大害：①数据中心/情报中心翻页看到全是旧闻；
 * ②同步链路每 5 分钟把旧数据灌回前端；③查询面变大性能劣化。 */
async function _runRollingArchive() {
  try {
    await query(`CREATE TABLE IF NOT EXISTS intel_archive (LIKE intel_data INCLUDING ALL)`);
    const r = await query(
      `INSERT INTO intel_archive (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status, collect_time)
       SELECT data_type, title, country, location, event_date, severity, description, source, data_json, audit_status, collect_time
       FROM intel_data WHERE collect_time < NOW() - INTERVAL '7 days'`
    );
    const n = r.rowCount || 0;
    if (n > 0) {
      await query(`DELETE FROM intel_data WHERE collect_time < NOW() - INTERVAL '7 days'`);
      console.log('[ARCHIVE] 滚动归档：' + n + ' 条超7天数据移入 intel_archive');
    }
  } catch (e) { console.warn('[ARCHIVE] 归档失败:', e.message); }
}
setInterval(_runRollingArchive, 6 * 60 * 60 * 1000);
setTimeout(_runRollingArchive, 60 * 1000); /* 启动 60s 后先跑一次 */

setInterval(_integrityWatchdog, 30 * 60 * 1000);setInterval(_integrityWatchdog, 30 * 60 * 1000);
setTimeout(_integrityWatchdog, 90 * 1000); /* 启动 90s 后先跑一次 */

/* 每天 08:00 生成前一日简报；启动时若已过时点且昨日简报缺失则补生成 */
let _dailyReportLastTry = '';
async function _maybeGenerateDailyReport() {
  const now = new Date();
  if (now.getHours() < 8) return;
  const y = new Date(now.getTime() - 24 * 3600 * 1000);
  const key = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  if (_dailyReportLastTry === key) return;
  _dailyReportLastTry = key;
  try {
    await query(`CREATE TABLE IF NOT EXISTS daily_reports (report_date TEXT PRIMARY KEY, html TEXT, summary JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    const r = await query(`SELECT report_date FROM daily_reports WHERE report_date=$1`, [key]);
    if (!r.rows.length) {
      const rep = await _generateDailyReport(key);
      console.log('[DAILY REPORT] 已生成 ' + key + ' 简报：' + rep.total + ' 条数据');
    }
  } catch (e) { console.warn('[DAILY REPORT] 生成失败:', e.message); }
}
setInterval(_maybeGenerateDailyReport, 60 * 1000);

app.get('/api/reports/daily', async (req, res) => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS daily_reports (report_date TEXT PRIMARY KEY, html TEXT, summary JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    const r = await query(`SELECT report_date, summary, created_at FROM daily_reports ORDER BY report_date DESC LIMIT 60`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/reports/daily/:date', async (req, res) => {
  try {
    const r = await query(`SELECT report_date, html, summary, created_at FROM daily_reports WHERE report_date=$1`, [req.params.date]);
    if (!r.rows.length) return res.status(404).json({ error: '该日简报不存在' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/reports/daily/generate', express.json(), async (req, res) => {
  try {
    let key = req.body && req.body.date;
    if (!key) {
      const y = new Date(Date.now() - 24 * 3600 * 1000);
      key = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
    const rep = await _generateDailyReport(key);
    res.json({ ok: true, date: rep.date, total: rep.total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* 权威统计接口（2026-08-14 用户指令：所有统计对话框实时统一数据源）：
 * 数据中心统计卡、态势总览"数据库:N条" 全部以本接口为准（PostgreSQL 实数） */
app.get('/api/intel/stats', async (req, res) => {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const r = await query(`SELECT data_type, COUNT(*) c, COUNT(*) FILTER (WHERE collect_time >= $1) today FROM intel_data WHERE audit_status='approved' GROUP BY 1`, [dayStart]);
    const byType = {};
    let total = 0, today = 0;
    r.rows.forEach(x => { byType[x.data_type] = parseInt(x.c, 10); total += parseInt(x.c, 10); today += parseInt(x.today, 10); });
    /* 涉华总量（标题要素口径，与涉华列表一致） */
    const cn = await query(`SELECT COUNT(*) c FROM intel_data WHERE audit_status='approved' AND (
      title ILIKE '%中国%' OR title ILIKE '%中资%' OR title ILIKE '%中企%' OR title ILIKE '%中方%' OR title ILIKE '%华人%'
      OR title ILIKE '%华侨%' OR title ILIKE '%一带一路%' OR title ILIKE '%China%' OR title ILIKE '%Chinese%' OR title ILIKE '%Beijing%'
      OR data_json->>'title_zh' ILIKE '%中国%' OR data_json->>'title_zh' ILIKE '%中资%' OR data_json->>'title_zh' ILIKE '%华人%'
      OR data_json->>'title_zh' ILIKE '%一带一路%')`);
    res.json({ total, today, byType, chinaTotal: parseInt(cn.rows[0].c, 10), updatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== 天地图瓦片中转（2026-08-14）=====
 * 背景：用户浏览器经代理访问天地图时图片跨域被 ORB 拦截（ERR_BLOCKED_BY_ORB），
 * 瓦片全部白图。改为服务端中转：浏览器只请求 localhost，本机直连天地图取图。
 * 密钥仅存在于服务端，不下发前端。 */
const TDT_TK = process.env.TDT_TK || 'e02e9033f07bd03176ab869ab1c61064';
const _tdtCache = new Map(); /* url → {buf, ct, at} 简单内存缓存，上限 2000 张 */
app.get('/api/tdt/:layer/:z/:x/:y', async (req, res) => {
  try {
    const { layer, z, x, y } = req.params;
    if (!/^(img_w|cia_w|vec_w|cva_w|ter_w|cta_w)$/.test(layer)) return res.status(400).end();
    if (!/^\d{1,2}$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) return res.status(400).end();
    const key = layer + '/' + z + '/' + x + '/' + y;
    const hit = _tdtCache.get(key);
    if (hit && (Date.now() - hit.at) < 6 * 3600 * 1000) {
      res.set('Content-Type', hit.ct); res.set('Cache-Control', 'public, max-age=21600');
      return res.end(hit.buf);
    }
    const sub = '01234567'[Math.abs((+x) + (+y)) % 8];
    const url = 'https://t' + sub + '.tianditu.gov.cn/DataServer?T=' + layer + '&x=' + x + '&y=' + y + '&l=' + z + '&tk=' + TDT_TK;
    const https = require('https');
    const r = await new Promise((resolve, reject) => {
      /* 天地图反爬：浏览器 UA 一律 403 白图，必须不带 User-Agent（2026-08-14 实测） */
      const rq = https.get(url, { timeout: 12000 }, resolve);
      rq.on('error', reject); rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
    });
    if (r.statusCode !== 200) { r.resume(); return res.status(502).end(); }
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = r.headers['content-type'] || 'image/jpeg';
      if (buf.length > 500) { /* 太小的多半是错误图，不缓存 */
        _tdtCache.set(key, { buf, ct, at: Date.now() });
        if (_tdtCache.size > 2000) { const k0 = _tdtCache.keys().next().value; _tdtCache.delete(k0); }
      }
      res.set('Content-Type', ct); res.set('Cache-Control', 'public, max-age=21600');
      res.end(buf);
    });
  } catch (e) { res.status(502).end(); }
});

app.get('/api/intel/ids', async (req, res) => {
  try {
    const r = await query("SELECT id FROM intel_data WHERE audit_status='approved'");
    res.json({ count: r.rows.length, ids: r.rows.map(x => x.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* COSRI 国别风险画像（2026-08-28 中海安对标 + 国别档案落地）
 * 口径：interest-base.js 中 50 国 × 4 维（政治/经济/社会/公共安全）研究底数
 * GET /api/cosri              → 全部 50 国 + 4 维 + 元数据
 * GET /api/cosri/:country     → 单国画像（4 维 + 近 30 天事件 + 命中项目 + 命中人员 + 行动指引）
 * GET /api/cosri/top?dim=...  → 某维 top 排名（默认 security）
 */
app.get('/api/cosri', async (req, res) => {
  try {
    const ind = INTEREST_BASE.COUNTRY_RISK_INDICATORS;
    const list = Object.keys(ind.scores).map(cn => {
      const s = ind.scores[cn];
      const overall = Math.round(((s.political + s.economic + s.social + s.security) / 4) * 10) / 10;
      const tier = INTEREST_BASE.getTier ? INTEREST_BASE.getTier(cn) : null;
      const projects = INTEREST_BASE.KEY_PROJECTS ? INTEREST_BASE.KEY_PROJECTS.filter(p => p.country === cn) : [];
      return { country: cn, ...s, overall, tier, projectCount: projects.length };
    });
    res.json({ asOf: ind.asOf, dims: ind.dims, dimNames: ind.dimNames, total: list.length, countries: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cosri/top', async (req, res) => {
  try {
    const dim = String(req.query.dim || 'security');
    if (!['political','economic','social','security'].includes(dim)) return res.status(400).json({ error: 'dim 仅支持 political/economic/social/security' });
    const ind = INTEREST_BASE.COUNTRY_RISK_INDICATORS;
    const list = Object.keys(ind.scores).map(cn => ({ country: cn, value: ind.scores[cn][dim] })).sort((a,b)=>b.value-a.value);
    res.json({ dim, name: ind.dimNames[dim], top: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cosri/:country', async (req, res) => {
  try {
    /* Express 默认对 path 段做 URL 解码，req.params.country 即原始 UTF-8 国家名 */
    const cn = String(req.params.country || '').trim();
    const ind = INTEREST_BASE.COUNTRY_RISK_INDICATORS;
    const s = ind.scores[cn];
    if (!s) return res.status(404).json({ error: '国家不在 COSRI 库（覆盖 50 国）', got: cn });
    const overall = Math.round(((s.political + s.economic + s.social + s.security) / 4) * 10) / 10;
    const tier = INTEREST_BASE.getTier ? INTEREST_BASE.getTier(cn) : null;
    const projects = INTEREST_BASE.KEY_PROJECTS ? INTEREST_BASE.KEY_PROJECTS.filter(p => p.country === cn) : [];
    /* 近 30 天真实事件（intel_data 中 country 命中 + audit=approved） */
    let recent = [];
    try {
      const r = await query(
        `SELECT id, title, COALESCE(NULLIF(data_json->>'title_zh',''),title) AS title_zh,
                data_type, collect_time, severity AS event_severity
         FROM intel_data
         WHERE audit_status='approved' AND country=$1
           AND collect_time >= NOW() - INTERVAL '30 days'
         ORDER BY collect_time DESC LIMIT 200`,
        [cn]
      );
      recent = r.rows.map(x => ({
        id: x.id, title: x.title_zh || x.title, type: x.data_type,
        time: x.collect_time, severity: x.event_severity
      }));
    } catch (e) { /* DB 不可用降级为空 */ }
    /* 行动指引：根据四维分自动生成 */
    const guide = _buildCountryGuide(cn, s, recent, projects);
    res.json({
      asOf: ind.asOf, country: cn, dims: ind.dims, dimNames: ind.dimNames,
      scores: s, overall, tier,
      projects, recentEvents: recent, recentCount: recent.length, guide
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function _buildCountryGuide(cn, s, recent, projects) {
  const tips = [];
  if (s.security >= 8) tips.push('公共安全高风险（≥8）：避免非必要出行，外出须 2 人同行、保持通讯畅通、登记行程');
  if (s.political >= 8) tips.push('政治高风险：避免集会与敏感地区；与使领馆保持联系；预备护照+备用身份证');
  if (s.economic >= 8) tips.push('经济高风险：关注汇率/制裁/项目合规；保留资金出境备案；保险条款覆盖政治险');
  if (s.social >= 8) tips.push('社会高风险：尊重本地风俗；夜间避免外出；预设应急撤离路线');
  if (s.security >= 9 || s.political >= 9) tips.push('红色等级：评估撤人/停项目可行性；启动 24h 定点联络+保险升级');
  if (recent.length >= 10) tips.push(`近 30 天有 ${recent.length} 条事件记录，建议研判升级/保持预警推送`);
  if (projects.length === 0) tips.push('暂无中资项目暴露；属一般关注');
  else tips.push(`有 ${projects.length} 个中资项目（${projects.map(p=>p.name).slice(0,3).join('、')}），需重点盯防`);
  if (tips.length === 0) tips.push('低风险：常规关注，无需特别响应');
  return tips;
}

/* ===== 采集漏斗统计（2026-08-28 服务端三件之二）=====
 * 全链路真实口径（零模拟）：拦截（数据池今日·持久化 + 入库闸审计·重启以来内存）→
 * 成功入库（intel_data 今日）→ 生成预警（datahub_store 队列今日）。
 * 每级附明细（原因分布/类别分布/通道分布/等级分布 + 样例标题），前端可点开。
 * GET /api/funnel/today */
app.get('/api/funnel/today', async (req, res) => {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const p = n => String(n).padStart(2, '0');
    const dayKey = dayStart.getFullYear() + '-' + p(dayStart.getMonth() + 1) + '-' + p(dayStart.getDate());
    /* 入库级 */
    const stored = await query(`SELECT COUNT(*)::int c FROM intel_data WHERE collect_time >= $1`, [dayStart]);
    const byType = await query(`SELECT data_type k, COUNT(*)::int c FROM intel_data WHERE collect_time >= $1 GROUP BY 1 ORDER BY c DESC`, [dayStart]);
    const byChannel = await query(`SELECT COALESCE(NULLIF(data_json->>'_sourceType',''),'未标注') k, COUNT(*)::int c FROM intel_data WHERE collect_time >= $1 GROUP BY 1 ORDER BY c DESC`, [dayStart]);
    const storedN = stored.rows[0].c;
    /* 拦截级：数据池今日（持久化真实数据） */
    const sidepool = await query(`SELECT reason k, COUNT(*)::int c FROM intel_sidepool WHERE blocked_at >= $1 GROUP BY 1 ORDER BY c DESC`, [dayStart]);
    const sideSamples = await query(`SELECT reason k, COALESCE(NULLIF(title_zh,''),title) t FROM intel_sidepool WHERE blocked_at >= $1 ORDER BY blocked_at DESC LIMIT 60`, [dayStart]);
    const poolDetail = {};
    sidepool.rows.forEach(r => { poolDetail[r.k] = r.c; });
    const poolSamples = {};
    sideSamples.rows.forEach(r => {
      (poolSamples[r.k] = poolSamples[r.k] || []).push(r.t);
    });
    Object.keys(poolSamples).forEach(k => { if (poolSamples[k].length > 4) poolSamples[k].length = 4; });
    const poolN = sidepool.rows.reduce((s, r) => s + r.c, 0);
    /* 拦截级：入库闸审计（内存，重启以来；预警生成阶段的拒绝归预警级，不算入库前拦截） */
    const gateDetail = {}, genReject = {};
    Object.keys(_GATE_AUDIT.by).forEach(k => {
      if (k.indexOf('预警生成') === 0) genReject[k] = _GATE_AUDIT.by[k];
      else gateDetail[k] = _GATE_AUDIT.by[k];
    });
    const gateSamples = _GATE_AUDIT.samples;
    const gateN = Object.keys(gateDetail).reduce((s, k) => s + gateDetail[k], 0);
    /* 预警级 */
    let alertToday = 0, anomToday = 0; const byLevel = {};
    try {
      const dh = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
      const arr = dh.rows.length && Array.isArray(dh.rows[0].data_json) ? dh.rows[0].data_json : [];
      arr.forEach(a => {
        if (!a) return;
        if (String(a.time || '').slice(0, 10) === dayKey) {
          alertToday++;
          byLevel[a.level] = (byLevel[a.level] || 0) + 1;
          if (a._anomaly) anomToday++;
        }
      });
    } catch (e) { /* 预警库不可用时降级为 0 */ }
    res.json({
      date: dayKey, generatedAt: new Date().toISOString(),
      stages: [
        {
          key: 'blocked', name: '闸门拦截', count: poolN + gateN,
          poolToday: poolN, gateSinceRestart: gateN,
          detail: poolDetail, gateDetail, samples: poolSamples, gateSamples,
          source: 'intel_sidepool 今日（持久化） + 入库闸审计（重启以来·内存）'
        },
        {
          key: 'stored', name: '成功入库', count: storedN,
          byType: byType.rows, byChannel: byChannel.rows,
          source: 'intel_data 今日（audit 含 approved）'
        },
        {
          key: 'alerts', name: '生成预警', count: alertToday,
          byLevel, anomaly: anomToday, gateRejections: genReject,
          source: 'datahub_store 预警队列 · time 为今日'
        }
      ],
      gateAuditSince: _GATE_AUDIT.since
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== 归档库检索（2026-08-28 服务端三件之三）=====
 * intel_archive 滚动归档（活跃库仅留 7 天，更早数据可查不丢）。
 * GET /api/archive/search?country=&type=&q=&since=&until=&page=&limit=
 * 明细：标题命中的中文标题优先（归档行 title_zh 为空时回落 data_json->>'title_zh'） */
app.get('/api/archive/search', async (req, res) => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS intel_archive (LIKE intel_data INCLUDING ALL)`);
    const { country, type, q, since, until } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit || '20', 10) || 20));
    const where = [], args = [];
    if (country) { args.push(String(country)); where.push('country = $' + args.length); }
    if (type) { args.push(String(type)); where.push('data_type = $' + args.length); }
    if (since) { args.push(since + ' 00:00:00'); where.push('collect_time >= $' + args.length + '::timestamptz'); }
    if (until) { args.push(until + ' 23:59:59'); where.push('collect_time <= $' + args.length + '::timestamptz'); }
    if (q) { args.push('%' + String(q) + '%'); where.push('(title ILIKE $' + args.length + ' OR COALESCE(NULLIF(data_json->>\'title_zh\',\'\'),\'\') ILIKE $' + args.length + ')'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = await query('SELECT COUNT(*)::int c FROM intel_archive ' + w, args);
    const rows = await query(
      `SELECT id, data_type, title, country, source, collect_time,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS display_title,
              data_json->>'url' AS url
       FROM intel_archive ${w}
       ORDER BY collect_time DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, args);
    /* 同口径统计（含全库总量/时间跨度，供面板头部展示） */
    const [stType, stCountry, stAll] = await Promise.all([
      query('SELECT data_type k, COUNT(*)::int c FROM intel_archive ' + w + ' GROUP BY 1 ORDER BY c DESC LIMIT 20', args),
      query(`SELECT COALESCE(NULLIF(country,''),'未知') k, COUNT(*)::int c FROM intel_archive ${w} GROUP BY 1 ORDER BY c DESC LIMIT 12`, args),
      query('SELECT COUNT(*)::int c, MIN(collect_time) mn, MAX(collect_time) mx FROM intel_archive', [])
    ]);
    res.json({
      date: new Date().toISOString(), page, limit,
      total: total.rows[0].c,
      rows: rows.rows.map(r => ({
        id: r.id, type: r.data_type, title: r.display_title || r.title,
        country: r.country, source: r.source, time: r.collect_time, url: r.url || ''
      })),
      stats: {
        byType: stType.rows, byCountry: stCountry.rows,
        totalAll: stAll.rows[0].c, minTime: stAll.rows[0].mn, maxTime: stAll.rows[0].mx
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


/* 指挥调度闭环状态（2026-08-13 体检 P1-4）：事件/工单/复盘服务端持久化，
 * 单文档状态存储，前端全量读写，本地 IndexedDB 作离线兜底 */
app.get('/api/command/state', async (req, res) => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS command_state (id INT PRIMARY KEY, state JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    const r = await query(`SELECT state, updated_at FROM command_state WHERE id=1`);
    res.json(r.rows[0] ? r.rows[0] : { state: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/command/state', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS command_state (id INT PRIMARY KEY, state JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    const st = JSON.stringify(req.body && req.body.state ? req.body.state : {});
    await query(`INSERT INTO command_state (id, state, updated_at) VALUES (1, $1::jsonb, NOW())
                 ON CONFLICT (id) DO UPDATE SET state=$1::jsonb, updated_at=NOW()`, [st]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intel/public/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!PUBLIC_INTEL_TYPES.includes(type)) return res.status(403).json({ error: '该情报类型不对外公开' });
    /* 优先读取 PostgreSQL 中已审核情报；数据库不可用时降级为服务端文件缓存（真实爬取数据） */
    try {
      /* 2026-08-13 均衡分发（用户指令：不能全是俄乌/伊朗，类别要均衡）：
       * 1. 只取近 24 小时（时效铁律）；
       * 2. 涉华条目（标题要素）全部放行，不受国别限额；
       * 3. 同一国家/地区最多 12 条，防止单一方向刷屏；
       * 4. 总量 300 条，按时间倒序。 */
      const dayAgo = new Date(); dayAgo.setHours(0,0,0,0); /* 2026-08-17 铁律：实时流只流今日采集（原 24h 窗口会让昨日条目跨天残留） */
      const result = await query(
        "SELECT * FROM intel_data WHERE (data_type = $1 OR data_type = 'geopolitical_intel') AND audit_status = 'approved' AND collect_time >= $2 ORDER BY collect_time DESC LIMIT 1500",
        [type, dayAgo]
      );
      const _seen = {};
      const _cnRe = /中国|中资|中企|中方|华人|华侨|华裔|涉华|对华|一带一路|驻华|访华|Chinese|China|Beijing|Belt and Road|CPEC/i;
      const _ctyCnt = {};
      const PER_COUNTRY_CAP = 12, TOTAL_CAP = 300, CHINA_RESERVE = 80;
      const filtered = [];
      /* 第一趟：涉华保底（2026-08-14 用户指令：实时流里涉华太少）——窗口内涉华条目全量进（上限80），
       * 不参与国别限额，保证涉华情报始终可见 */
      for (const r of result.rows) {
        if (filtered.length >= CHINA_RESERVE) break;
        const txt = (r.title || '') + ' ' + (r.data_json?.content || r.data_json?.desc || '');
        if (!scrapers.chinaOverseasGate(txt).pass) continue;
        if (!_cnRe.test((r.title || '') + ' ' + (r.data_json?.title_zh || ''))) continue;
        const k = _dedupKey(r.data_json);
        if (!k || _seen[k]) continue;
        _seen[k] = 1;
        filtered.push(r);
      }
      /* 俄乌话题硬限额（2026-08-17 用户铁律：这是海外利益预警平台，不是俄乌数据采集器）：
       * 非涉华的俄乌话题每次响应最多 5 条，任何版本客户端拿到的都是限流后的数据 */
      const _ruRe = /乌克兰|俄罗斯|Ukraine|Ukrainian|Russia|Russian|Kyiv|Moscow|Zelensky|Putin|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯/i;
      let _ruN = 0;
      /* 第二趟：其他条目按国别限额补齐 */
      for (const r of result.rows) {
        const txt = (r.title || '') + ' ' + (r.data_json?.content || r.data_json?.desc || '');
        if (!scrapers.chinaOverseasGate(txt).pass) continue;
        const k = _dedupKey(r.data_json);
        if (!k || _seen[k]) continue;
        const isCn = _cnRe.test((r.title || '') + ' ' + (r.data_json?.title_zh || ''));
        if (isCn) continue; /* 涉华已在第一趟处理 */
        if (_ruRe.test((r.title || '') + ' ' + (r.data_json?.title_zh || ''))) { _ruN++; if (_ruN > 5) continue; }
        _seen[k] = 1;
        const cty = r.country || r.data_json?.country_cn || '未知';
        _ctyCnt[cty] = (_ctyCnt[cty] || 0) + 1;
        if (_ctyCnt[cty] > PER_COUNTRY_CAP) continue;
        filtered.push(r);
        if (filtered.length >= TOTAL_CAP) break;
      }
      /* 2026-08-14 用户指令：涉华负面优先——Feed 输出按优先级分层排序
       * （第1层 境外涉华负面；第2层 涉华；第3层 红/橙严重事件；第4层 其他，层内按时间倒序），
       * 且红/橙级强制 interestLinked=true，保证重点数据必达预警中心，不躺在库里。 */
      const _tier = (it) => {
        const neg = it._chinaNegative === true || it._chinaNegative === 'true';
        const cn = _cnRe.test((it.title || '') + ' ' + (it.title_zh || ''));
        const lv = it.level_norm || it.severity || '';
        if (neg) return 0;
        if (cn) return 1;
        if (lv === 'red' || lv === 'orange') return 2;
        return 3;
      };
      const mapped = filtered.map(r => {
        const it = { ...r.data_json, id: r.id, audit_status: r.audit_status, audit_time: r.audit_time, collect_time: r.collect_time };
        if (!it.title && r.title) it.title = r.title;
        /* 补跑 enrich：旧数据/直接入库数据可能未打 interestLinked，前端铁律要求该标记才分发预警 */
        if (it.interestLinked === undefined || it.interestLinked === null) {
          try { ENTITY.enrich(it); } catch (e) {}
        }
        const lv = it.level_norm || r.severity || '';
        if (lv === 'red' || lv === 'orange') it.interestLinked = true;
        return it;
      });
      mapped.sort((a, b) => {
        const ta = _tier(a), tb = _tier(b);
        if (ta !== tb) return ta - tb;
        return new Date(String(b.publish_time || b.publishedAt || 0).replace('T', ' ')) - new Date(String(a.publish_time || a.publishedAt || 0).replace('T', ' '));
      });
      return res.json(mapped);
    } catch (dbErr) {
      console.warn('[PUBLIC] PostgreSQL 不可用，降级读取文件缓存:', dbErr.message);
      /* 实战系统要求：公开流只呈现已译中文条目；未译外文暂留缓存待翻译，绝不以英文暴露。
       * 同时兜底剔除导航噪声，并按稳定键去重（防同一情报因译文措辞不同而重复呈现）。 */
      const _seen = {};
      const items = _readPublicCache(type)
        .filter(function(r) { return !_looksForeign(r.title) || r.title_zh; })
        .filter(function(r) { return !_isNavNoise(r); })
        .filter(function(r) { const k = _dedupKey(r); if (!k || _seen[k]) return false; _seen[k] = 1; return true; })
        .filter(function(r) { const txt = (r.title || '') + ' ' + (r.content || ''); return scrapers.chinaOverseasGate(txt).pass; })
        .map(r => ({ ...r, audit_status: 'approved', dbOffline: true }));
      return res.json(items);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 真实情报抓取（同源、无 CORS、公开） =====
 *  ?url=xxx             -> 白名单代理抓取原始文本（供前端复用既有解析器）
 *  ?source=usgs         -> 抓取指定源并返回归一化条目
 *  ?category=security_events -> 抓取该分类全部源
 *  ?all=1               -> 抓取全部分类
 *  无参数                -> 返回可用 source key 列表
 */
/* 源健康快照：真实统计（在线/预留/离线、成功失败次数、条目数、冷却剩余）
 * 无任何模拟：未抓取过的源 status=idle，items=0，不虚构历史量。 */
app.get('/api/sources', (req, res) => {
  try {
    const list = scrapers.sourceHealth();
    const stat = { total: list.length, online: 0, reserved: 0, offline: 0, idle: 0, items: 0 };
    list.forEach(s => { stat[s.status] = (stat[s.status] || 0) + 1; stat.items += (s.items || 0); });
    res.json({ ok: true, stat, sources: list });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

app.get('/api/scrape', async (req, res) => {
  try {
    const { url, source, category, all } = req.query;
    if (url) {
      const text = await scrapers.proxyFetchText(url);
      return res.json({ ok: !!text, url, text: text || '' });
    }
    /* 铁律三「落库即中文」：单源/单分类通道同样必须译。
     * 踩坑记录(2026-08-05)：此前只有 ?all=1 接了翻译，而前端自动采集引擎
     * datasources._refreshReal() 的主力入库路径恰恰是 ?category=，导致
     * 自动采集入库的全是英文原文（实测 osint_intel 31 条中 18 条纯外文）。 */
    if (source) {
      const items = await scrapers.scrapeSource(source);
      try { await _translateListToZhParallel(items || [], 6); } catch (e) { console.warn('[SCRAPE:source] 翻译异常(保留原文):', e.message); }
      /* 2026-08-29 墓碑出口闸（伦敦使馆旧闻复活根因③）：已删除的旧闻绝不再回流前端采集池 */
      const _kept = [];
      for (const it of (items || [])) { if (await _isTombstoned(it)) _gateAudit('出口闸', 'tombstoned', it.title); else _kept.push(it); }
      return res.json({ source, items: _kept });
    }
    if (category) {
      const items = await scrapers.scrapeCategory(category);
      /* 关联判定：给前端自动采集引擎提供 interestLinked 标记，避免入池数据无关联标志 */
      (items || []).forEach(function(it) { try { ENTITY.enrich(it); } catch (e) {} });
      try { await _translateListToZhParallel(items || [], 6); } catch (e) { console.warn('[SCRAPE:category] 翻译异常(保留原文):', e.message); }
      /* 2026-08-29 墓碑出口闸：删除过的旧文直接滤除，不进前端 realPool */
      const _kept2 = [];
      for (const it of (items || [])) { if (await _isTombstoned(it)) _gateAudit('出口闸', 'tombstoned', it.title); else _kept2.push(it); }
      return res.json({ category, items: _kept2 });
    }
    if (all) {
      const data = await scrapers.scrapeAll();
      /* ── 按内容重分类 + 去重（用户要求：一键采集数据按12要素分类）──
       * 中新网多个分类别名指向同一国际feed，原始分类是"贴标签"；此处用
       * crawler.classify 按标题+内容真实归类：灾害/卫生/恐袭/军事/制裁/
       * 动荡/政治/基建/地缘 各归其位，无法判定的保留原分类。 */
      const seen = new Set();
      const out = {};
      Object.keys(data).forEach(cat => {
        (data[cat] || []).forEach(it => {
          const key = (it.title || '').slice(0, 60);
          if (!key || seen.has(key)) return;
          seen.add(key);
          const text = (it.title || '') + ' ' + (it.content || it.desc || '');
          let c = crawler.classify(text, crawler.chinaRelated(text), crawler.chinaNegative(text));
          /* USGS/GDACS 等本身就是精确分类源：classify 判不出时保留原分类 */
          if (c === 'osint_intel' && cat !== 'osint_intel') c = cat;
          it.data_type = c;
          (out[c] = out[c] || []).push(it);
        });
      });
      /* 全分类关联判定：给所有返回条目打上 interestLinked，前端才能按铁律分发 */
      Object.keys(out).forEach(function(c) {
        (out[c] || []).forEach(function(it) { try { ENTITY.enrich(it); } catch (e) {} });
      });
      /* 降级存储：scrape 全量时把 osint_intel 分类的真实数据写入文件缓存（供无 PostgreSQL 时的公开态势通道）
       * 铁律：入库前必须经过 ENTITY.enrich 关联判定，只保留 interestLinked=true 的数据 */
      try {
        if (out && out['osint_intel'] && out['osint_intel'].length) {
          var linkedOnly = out['osint_intel'].filter(function(it) { return it.interestLinked === true; });
          if (linkedOnly.length) { await _translateListToZh(linkedOnly); _mergePublicCache('osint_intel', linkedOnly); }
        }
      } catch (e) {}
      /* 落库即中文（铁律三）：对全部分类并行翻译外文条目后再返回前端，
       * 修复"全量采集数据是外文原文"。TranSmart/有道免密钥 + 持久缓存 + 并发6，全量约十几秒。
       * 单条翻译失败保留原文，绝不丢数据。 */
      try {
        var _allItems = [];
        Object.keys(out).forEach(function (c) { (out[c] || []).forEach(function (it) { _allItems.push(it); }); });
        await _translateListToZhParallel(_allItems, 6);
      } catch (e) { console.warn('[SCRAPE] 全量翻译异常(保留原文):', e.message); }
      /* 2026-08-29 墓碑出口闸：全量结果滤除已删除旧文（前端 realPool 主要补给源之一） */
      try {
        const _tb = await _getTombstones();
        let _blocked = 0;
        Object.keys(out).forEach(function (c) {
          out[c] = (out[c] || []).filter(function (it) {
            if (_tombMatchSync(_tb, it)) { _blocked++; _gateAudit('出口闸', 'tombstoned', it.title); return false; }
            return true;
          });
        });
        if (_blocked) console.log('[SCRAPE] 墓碑出口闸拦截 ' + _blocked + ' 条已删除旧文');
      } catch (e) {}
      return res.json({ ok: true, data: out });
    }
    return res.json({ ok: true, sources: Object.keys(scrapers.SCRAPE_SOURCES) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 微信公众号采集通道 API（2026-08-21）=====
 *  /api/wechat/status        会话/账号/最近一轮状态
 *  /api/wechat/login         POST 发起扫码登录（spawn 独立进程，二维码经 state 文件回传）
 *  /api/wechat/login/state   登录进度轮询（含二维码 dataURL）
 *  /api/wechat/accounts      GET/POST/DELETE 监测账号清单管理
 *  /api/wechat/collect       POST 手动触发一轮采集（异步执行）
 */
app.get('/api/wechat/status', (req, res) => {
  try {
    const st = wechatoa.status();
    st.lastRun = _wechatLastRun;
    st.negLastRun = _wechatNegLastRun;
    /* 2026-08-26：公众号直采已退役，面板主状态改为四步管线 */
    st.pipeline = 'wechat-leads';
    st.leadsLastRun = _wechatLeadsLastRun;
    st.pipelineNote = '公众号仅作线索查询；入库数据来自全球媒体原文（GDELT/GNews/Bing→全文抓取）';
    res.json({ ok: true, status: st });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});
app.post('/api/wechat/login', (req, res) => {
  try {
    const stateFile = path.join(CACHE_DIR, 'wechat-login-state.json');
    /* 防并发：已有进行中的登录流程（6分钟内有心跳）则直接复用 */
    try {
      const cur = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (['starting', 'waiting', 'scanned'].includes(cur.state) && Date.now() - Date.parse(cur.updated || 0) < 6 * 60 * 1000) {
        return res.json({ ok: true, reused: true, state: cur.state });
      }
    } catch (e) {}
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'starting', qr: '', message: '正在启动登录浏览器…', updated: new Date().toISOString() }));
    const child = spawn(process.execPath, [path.join(__dirname, 'wechat-login.js')], {
      cwd: __dirname, detached: true, stdio: 'ignore',
      env: Object.assign({}, process.env, { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '', NODE_OPTIONS: '' })
    });
    child.unref();
    res.json({ ok: true, reused: false });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});
app.get('/api/wechat/login/state', (req, res) => {
  try {
    const f = path.join(CACHE_DIR, 'wechat-login-state.json');
    if (!fs.existsSync(f)) return res.json({ ok: true, state: 'idle', qr: '', message: '尚未发起登录' });
    const cur = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.json({ ok: true, state: cur.state || 'idle', qr: cur.qr || '', message: cur.message || '', updated: cur.updated || '' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});
app.get('/api/wechat/accounts', (req, res) => {
  res.json({ ok: true, accounts: wechatoa.listAccounts() });
});
app.post('/api/wechat/accounts', express.json(), (req, res) => {
  const r = wechatoa.addAccount(req.body && req.body.name);
  res.status(r.ok ? 200 : 400).json(r);
});
app.delete('/api/wechat/accounts', (req, res) => {
  res.json(wechatoa.removeAccount(String(req.query.name || '')));
});
app.post('/api/wechat/collect', (req, res) => {
  /* 手动触发：异步跑，前端轮询 /api/wechat/status 看 lastRun */
  if (Date.now() < _wechatBusyUntil) return res.json({ ok: false, error: '上一轮采集尚未结束，请稍候' });
  setTimeout(() => { _runWechatOA(); }, 50);
  res.json({ ok: true });
});
app.post('/api/wechat/negative-sweep', (req, res) => {
  /* 手动触发公众号涉华负面专项（2026-08-26）：异步跑，前端轮询 /api/wechat/status 看 negLastRun */
  if (Date.now() < _wxNegBusyUntil) return res.json({ ok: false, error: '上一轮涉华负面专项尚未结束，请稍候' });
  setTimeout(() => { _runWechatNegative(); }, 50);
  res.json({ ok: true });
});
app.post('/api/wechat/leads-sweep', (req, res) => {
  /* 手动触发公众号线索四步管线（2026-08-26）：异步跑，前端轮询 /api/wechat/status 看 leadsLastRun */
  if (Date.now() < _wxLeadsBusyUntil) return res.json({ ok: false, error: '上一轮线索管线尚未结束，请稍候' });
  setTimeout(() => { _runWechatLeads(); }, 50);
  res.json({ ok: true });
});

/* ===== 缺口调度器手动触发端点（2026-08-29：全球均衡化/全类别化调优，PM2 日志看 [GAP-SCHED]） ===== */
app.post('/api/gap-scheduler/run', (req, res) => {
  if (Date.now() < _gapSchedBusyUntil) return res.json({ ok: false, error: '上一轮缺口调度尚未结束，请稍候' });
  setTimeout(() => { _runGapScheduler(); }, 50);
  res.json({ ok: true });
});

/* ===== WorldMonitor 数据接入哨兵手动触发端点（2026-08-31 Task #506） ===== */
app.post('/api/wm-feed/run', async (req, res) => {
  try {
    if (Date.now() < _wmFeedBusyUntil) return res.json({ ok: false, error: '上一轮 WorldMonitor 采集尚未结束，请稍候' });
    const r = await wmFeed.runWmFeed({});
    const items = r.items || [];
    let inserted = 0;
    if (items.length) {
      try { await _translateListToZhParallel(items, 4); } catch (e) {}
      items.forEach(it => {
        try { ENTITY.enrich(it); it.interestLinked = true; } catch (e) {}
        if (!it._sourceType) it._sourceType = 'wm_feed';
      });
      const res2 = await _ingestLinkedItems(items, 'WM-FEED', '（手动触发）');
      inserted = (res2 && res2.inserted) || 0;
    }
    res.json({ ok: true, collected: items.length, inserted });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

/* ============================================================
 * 专项情报作战室（2026-08-31，任务 #508）
 * 用户指定实体（国家 / 威胁组织 / 中资项目 / 自由关键词）→ 专项全网采集（7 天窗）
 * + 库内数据联动 + 前端态势预警分析报告与预警图。
 * 端点一：POST /api/threatroom/collect —— 专项采集（GDELT 7d × AP 补充）
 * 端点二：GET  /api/threatroom/data    —— 库内实体匹配数据（供报告渲染）
 * 铁律：全部走 _ingestLinkedItems 标准管线；_sourceType='threatroom' 必须在
 * _isFreshEnough 之前设置（与 gap_scheduler 同源排雷）。 */
let _threatroomBusyUntil = 0;
/* Google News RSS 检索（威胁作战室专用；与 channel-watch._gnewsRss 同模式：
 * 串行+间歇重试，只支持英文查询——中文参数返回空）。
 * 2026-08-31 v2：GDELT 之外的第二引擎（用户铁律"全网采集"），when:7d 对齐作战室窗口。 */
async function _trGnews(q, max) {
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:7d') + '&hl=en-US&gl=US&ceid=US:en',
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  try {
    let text = await _once();
    if (!text) { await new Promise(s => setTimeout(s, 2000)); text = await _once(); }
    if (!text) return [];
    return (scrapers.parseRss(text) || []).slice(0, max || 20).map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Google News', country: ''
    }));
  } catch (e) { return []; }
}

/* ── 第三/第四引擎（2026-08-31 v8 GDELT 限流根治·用户铁律：专项检索不能每次都空手而归）──
 * 实测该网络环境（127.0.0.1:7897 代理）：Bing News RSS(format=RSS) 实测返回必应 HTML
 * 搜索页（302→HTML 0 item，已死）、Yahoo News RSS 实测 15s 超时（封禁/不可达）、
 * Reddit search RSS 实测 20s 超时（全网封锁）——三个传统免 key 关键字新闻源全军覆没。
 * 最终落地：HN Algolia（JSON，200/1.5s/14KB，唯一实测可达的免 key 关键字新闻补充源，
 * 偏科技/突发但覆盖重大世界新闻）+ Bing/Yahoo 降级为"快速失败探针"（5s 单次，
 * 不重试——endpoint 死了就明着报 0，不浪费 58s/轮）。 */
async function _trBingNews(q, max) {
  try {
    const r = await Promise.race([
      netx.smartFetch('https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&format=RSS&setmkt=en-US&setlang=en',
        { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
        .then(rs => (rs && rs.ok) ? rs.text() : null).catch(() => null),
      new Promise(res => setTimeout(() => res(null), 6000))
    ]);
    if (!r || !/<item[\s>]/i.test(r)) return [];   /* 多数情况：302 跳到必应 HTML，无 item 即放弃 */
    return (scrapers.parseRss(r) || []).slice(0, max || 20).map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Bing News', country: ''
    }));
  } catch (e) { return []; }
}
async function _trYahooNews(q, max) {
  try {
    const r = await Promise.race([
      netx.smartFetch('https://news.search.yahoo.com/rss?p=' + encodeURIComponent(q),
        { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
        .then(rs => (rs && rs.ok) ? rs.text() : null).catch(() => null),
      new Promise(res => setTimeout(() => res(null), 6000))
    ]);
    if (!r || !/<item[\s>]/i.test(r)) return [];
    return (scrapers.parseRss(r) || []).slice(0, max || 20).map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Yahoo News', country: ''
    }));
  } catch (e) { return []; }
}
/* HN Algolia：免 key JSON 关键字搜索（实测可达 200/1.5s）—— 偏科技/突发新闻，
 * 重大世界事件通常有 HackerNews 讨论帖，可作 GNews 之外的独立命中面。 */
async function _trHnAlgolia(q, max) {
  try {
    const r = await Promise.race([
      netx.smartFetch('https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) + '&tags=story&hitsPerPage=' + Math.min(30, max || 20),
        { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
        .then(rs => (rs && rs.ok) ? rs.text() : null).catch(() => null),
      new Promise(res => setTimeout(() => res(null), 10000))
    ]);
    if (!r) return [];
    let j; try { j = JSON.parse(r); } catch (e) { return []; }
    const hits = (j && Array.isArray(j.hits)) ? j.hits : [];
    return hits.slice(0, max || 20).map(h => ({
      title: h.title || h.story_title || '',
      content: h.url || h.story_text || '',
      url: h.url || ('https://news.ycombinator.com/item?id=' + (h.objectID || '')),
      publish_time: h.created_at ? new Date(h.created_at).toISOString() : '',
      source: 'HN Algolia', country: ''
    })).filter(it => it.title);
  } catch (e) { return []; }
}

/* ── 关键词作战相关性双要素闸（2026-08-31 任务 #515）──────────────────
 * 用户铁律：搜「中资#抢劫」就必须是"中资企业/中国公民在海外被抢劫"——
 * 芝加哥本地抢劫案 / 中国融资新闻 / 苏丹内战这类单要素噪声一律拦在入库前。
 * 规则：「#」拆分的每个子题构成一个要素组；涉华子题（中资/中国/华人…）展开为
 * 标准涉华模式集（含海外旗舰项目名——Gwadar 报道常不写 China），其余子题译英
 * 取词干（robbery→rob，匹配 robbed/robber/robbing）。入库条目须【所有组同时命中】；
 * 单子题查询退化为单组匹配。 */
const _KW_CN_ZH_RE = /中资|中国|中方|华人|华侨|中企|一带一路|撤侨|北京|人民币/i;
const _KW_CN_ZH_WORDS = ['中资', '中国', '中方', '华人', '华侨', '中企', '一带一路', '撤侨', '北京'];
const _KW_CN_EN_WORDS = ['chinese', 'china', 'beijing'];
const _KW_CN_ASSETS = ['CPEC', 'Gwadar', 'Hambantota', 'Piraeus', 'Kyaukpyu', 'Jakarta-Bandung', 'China-Laos', 'Addis-Djibouti', 'Mombasa-Nairobi', 'Simandou', 'Kamoa', 'Tazara', 'Colombo Port City'];
/* 主题要素提取丢弃的泛化英文词（company/funded 级——留着"中企 IPO 融资新闻"就能凭词混进主题组） */
const _KW_GENERIC_EN = new Set(['company', 'companies', 'firm', 'firms', 'funded', 'funding', 'funds', 'fund', 'investor', 'investors', 'investment', 'investments', 'overseas', 'abroad', 'foreign', 'national', 'nationals', 'citizen', 'citizens', 'worker', 'workers', 'people', 'person', 'persons', 'enterprise', 'enterprises', 'business', 'businesses', 'staff', 'employee', 'employees', 'project', 'projects', 'news', 'report', 'reports', 'said', 'amid', 'after', 'their', 'they', 'have', 'has', 'were', 'will', 'would', 'could', 'into', 'over', 'more', 'most', 'new', 'first', 'two', 'three']);
/* 轻量词干（robbery→rob / kidnapping→kidnap / sanctions→sanction / evacuation→evacuat） */
function _kwStem(w) {
  let s = String(w || '').toLowerCase().replace(/[^a-z]/g, '');
  if (s.length < 3) return '';
  let changed = true;
  while (changed && s.length > 3) {
    changed = false;
    for (const suf of ['ing', 'ery', 'ers', 'ies']) {
      if (s.endsWith(suf) && s.length - suf.length >= 3) { s = s.slice(0, -suf.length); changed = true; break; }
    }
    if (!changed) for (const suf of ['ed', 'es', 'er', 'ion']) {
      if (s.endsWith(suf) && s.length - suf.length >= 4) { s = s.slice(0, -suf.length); changed = true; break; }
    }
    if (!changed && s.endsWith('s') && s.length > 3) { s = s.slice(0, -1); changed = true; }
  }
  return s.replace(/([a-z])\1$/, '$1');
}
/* 子题 → 要素组：涉华子题展开标准涉华集；其余子题 = 原词 + 英译 + 英译词干。
 * enOf：外部已译好的英文（collect 端复用翻译结果，避免二次调用翻译 API） */
function _kwGroup(sub, enOf) {
  if (_KW_CN_ZH_RE.test(sub) || (!/[\u4e00-\u9fff]/.test(sub) && /chinese|china|beijing/i.test(sub))) {
    return { cn: true, pats: _KW_CN_ZH_WORDS.concat(_KW_CN_EN_WORDS, _KW_CN_ASSETS) };
  }
  const g = [sub];
  const en = String(enOf || '').trim();
  if (en && !/[\u4e00-\u9fff]/.test(en)) {
    if (g.indexOf(en) < 0) g.push(en);
    en.split(/[^A-Za-z]+/).forEach(w => {
      const wl = w.toLowerCase(), st = _kwStem(w);
      if (st.length >= 3 && !_KW_GENERIC_EN.has(wl) && g.indexOf(st) < 0) g.push(st);
    });
  } else if (!/[\u4e00-\u9fff]/.test(sub)) {
    sub.split(/[^A-Za-z]+/).forEach(w => {
      const wl = w.toLowerCase(), st = _kwStem(w);
      if (st.length >= 3 && !_KW_GENERIC_EN.has(wl) && g.indexOf(st) < 0) g.push(st);
    });
  }
  return { cn: false, pats: g };
}
/* 条目文本对要素组的命中判定：中文 pat → indexOf；英文 pat → 词首+词尾形态学边界正则。
 * 排雷（实测 XPeng「机器人」新闻凭 \brob 前缀命中 robot 漏过）：模式 = 词首 \b + 词干 +
 * 可选叠尾字母（rob→robbed/kidnap→kidnapped）+ 可屈折后缀 + 词尾 \b——
 * \brob(b)?(ed|ing|er|ery|…)?\b 命中 rob/robbed/robber/robbery/robberies，不命中 robot/problems */
function _kwGroupHit(g, text, zhText) {
  for (const p of (g.pats || [])) {
    if (!p) continue;
    if (/[\u4e00-\u9fff]/.test(p)) {
      if ((text || '').indexOf(p) >= 0 || (zhText || '').indexOf(p) >= 0) return true;
    } else {
      const raw = String(p);
      const e = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const L = /[A-Za-z]$/.test(raw) ? raw.slice(-1).toLowerCase() : '';
      const re = new RegExp('\\b' + e + (L ? ('(?:' + L + ')?') : '') + '(?:es|s|ed|ing|er|ers|ery|eries|ies|ion|ions)?\\b', 'i');
      if (re.test(text || '') || re.test(zhText || '')) return true;
    }
  }
  return false;
}
app.post('/api/threatroom/collect', async (req, res) => {
  try {
    if (Date.now() < _threatroomBusyUntil) return res.json({ ok: false, error: '上一轮专项采集尚未结束，请稍候' });
    _threatroomBusyUntil = Date.now() + 10 * 60 * 1000;   /* v2 矩阵 16+ 路，锁窗扩到 10 分钟 */
    const t0 = Date.now();
    try {
      const body = req.body || {};
      let type = String(body.type || 'keyword');
      const q = String(body.cn || body.q || '').trim();
      if (!q) { _threatroomBusyUntil = 0; return res.json({ ok: false, error: '缺少实体名' }); }
      /* 国别自动升级（2026-08-31 实测排雷：用户搜"吉尔吉斯斯坦"被前端判成 keyword——
       * COUNTRIES 89 国清单不含该国。gdCode()（GD_COUNTRIES 唯一取源）命中即按国家采集，
       * 前端识别只是提示，服务端才是权威） */
      if (type !== 'country' && crawler.gdCode(q)) type = 'country';
      /* 英文名服务端自解析：国别实体 gdEn() 唯一取源（GD_COUNTRIES），前端无需维护英文映射 */
      const enName = String(body.en || '').trim() || (type === 'country' ? crawler.gdEn(q) : '');
      let enKws = [];   /* v4：关键词作战的英文检索词（回传前端展示"主题→外文关键字"链路） */
      if (type !== 'keyword' && enName) enKws.push(enName);
      const als = Array.isArray(body.aliases) ? body.aliases.filter(a => a && String(a).trim()) : [];
      const arts = [];
      const seen = new Set();
      let kwGroups = null;  /* v5：双要素相关性组（任务 #515，见 _kwGroup 注释） */
      const push = (list) => (list || []).forEach(a => {
        const u = String(a.url || a.title || '');
        if (u && !seen.has(u)) { seen.add(u); arts.push(a); }
      });
      /* GDELT 检索包装（2026-08-31 铁律排雷：复杂查询（OR/括号）会挂起——一律纯 AND 语义
       * 检索式 + 40s Promise.race 兜底，绝不无限等待）
       * 2026-08-31 v8 本轮软熔断：GDELT 429 雪崩期每路查询要烧 3 次递增退避（6s+10s+14s）
       * ×6.5s 节流，8 路查询能把前端 600s 超时烧穿——连续 2 路空返回即跳过本轮剩余
       * GDELT 查询，火力全交 GNews/Bing/Yahoo 备胎矩阵。仅本轮内生效（10min 锁窗），
       * 不动 crawler 内全局 10min 硬熔断。 */
      let _gdEmptyRun = 0, _gdSkipRound = false;
      const _gdr = async (gq, opts) => {
        if (_gdSkipRound) return [];
        let r = [];
        try {
          r = await Promise.race([
            crawler.gdeltSearch(gq, opts).catch(() => []),
            new Promise(r2 => setTimeout(() => r2([]), 40000))
          ]);
        } catch (e) { r = []; }
        if (!r || !r.length) { if (++_gdEmptyRun >= 2) _gdSkipRound = true; }
        else _gdEmptyRun = 0;
        return r || [];
      };
      /* ── 分实体类型组织检索式（全部纯 AND：空格连接词项） ──
       * 2026-08-31 v3 实测排雷（用户铁律"采集量不够"）：
       *   v2 用 14 条 GDELT 主题变体，但当日全量采集打满共享代理 IP 后 GDELT 持续 429，
       *   实测检索量被限流腰斩（Kyrgyzstan 检索 36/入库 28——入库率优秀但总量不足）。
       *   修法：GDELT 只保留 2 条最高价值主力查询（限流时仍能抢到），
       *   主题变体全切 Google News RSS（channel-watch 每 30 分钟稳定使用，未见硬限流），
       *   全语言兜底仅在 GDELT 未触发冷却时跑（防雪上加霜）。
       *   + 批次内标题去重：同一事件被 GNews 和 GDELT 同时捞到时只入一次（精确标题指纹）。
       *   目标：单轮入库从 28 提到 80+。 */
      if (type === 'country') {
        const fips = crawler.gdCode(q);
        /* ① GDELT 主力两条（限流抢答高价值） */
        if (fips) {
          push(await _gdr('sourcecountry:' + fips + ' sourcelang:english', { timespan: '7d', maxrecords: 250 }));
        }
        if (enName) {
          push(await _gdr('"' + enName + '" sourcelang:english', { timespan: '7d', maxrecords: 250 }));
        }
        /* ② Google News 主题矩阵（无 GDELT 限流；when:7d 对齐窗口）——v3 主力扩量来源 */
        if (enName) {
          push(await _trGnews(enName, 30));
          const gThemes = ['summit', 'opposition', 'protest', 'election', 'attack', 'China', 'security', 'sanction'];
          for (const gt of gThemes) {
            push(await _trGnews(enName + ' ' + gt, 18));
          }
          /* v8 第三/四引擎：Bing News + Yahoo News RSS（GDELT 限流时的独立命中面） */
          push(await _trHnAlgolia(enName, 25));
          push(await _trYahooNews(enName, 20));
          /* ③ 全语言兜底（俄语源）——限量 60+ 后续西里尔质量闸 */
          if (fips) push(await _gdr('sourcecountry:' + fips, { timespan: '7d', maxrecords: 60 }));
          /* ④ AP 补充 */
          try { push(await crawler.apSearch(enName, { maxrecords: 15, pages: 1 })); } catch (e) {}
        }
      } else if (type === 'org') {
        const names = [enName].concat(als).filter(Boolean).slice(0, 3);
        for (const nm of names) {
          push(await _gdr('"' + nm + '" sourcelang:english', { timespan: '7d', maxrecords: 250 }));
          push(await _gdr('"' + nm + '" attack', { timespan: '7d', maxrecords: 50 }));
        }
        if (enName) {
          /* ① GNews 主题矩阵 */
          push(await _trGnews(enName, 30));
          const gThemes = ['China', 'attack', 'sanction', 'leader'];
          for (const gt of gThemes) {
            push(await _trGnews(enName + ' ' + gt, 18));
          }
          /* v8 第三/四引擎备胎 */
          push(await _trHnAlgolia(enName, 20));
          push(await _trYahooNews(enName, 15));
          /* ② AP */
          try { push(await crawler.apSearch(enName, { maxrecords: 15, pages: 1 })); } catch (e) {}
        }
      } else if (type === 'project') {
        const names = [enName].concat(als).filter(Boolean).slice(0, 3);
        for (const nm of names) {
          push(await _gdr('"' + nm + '"', { timespan: '7d', maxrecords: 150 }));
        }
        if (enName) {
          push(await _trGnews(enName, 30));
          const gThemes = ['attack', 'protest', 'security', 'China'];
          for (const gt of gThemes) {
            push(await _trGnews(enName + ' ' + gt, 18));
          }
          /* v8 第三/四引擎备胎 */
          push(await _trHnAlgolia(enName, 20));
          push(await _trYahooNews(enName + ' China', 15));
          try { push(await crawler.apSearch(enName + ' China', { maxrecords: 15, pages: 1 })); } catch (e) {}
        }
      } else {
        /* 2026-08-31 v4 关键词作战模式（用户铁律：引擎≠实体库门槛——任何主题都要能搜）：
         * 引擎职责是中转点：把用户主题（中文）翻译成英文关键字，再去 GDELT/GNews/AP 全网碰撞。
         * 主查询=整句中→英（TranSmart zh→en，有道兜底）；「#」拆分的子题各译一遍作变体；
         * 中文原文保留做 GDELT 全语言兜底（中文源/俄语源仍能命中）。 */
        const enQuery = String(body.en || '').trim();
        const kws = [];
        const subEns = {};   /* v5：子题 → 英译（双要素组复用，避免二次调翻译 API） */
        const addKw = (k) => { k = String(k || '').replace(/[""]/g, '').trim(); if (k && kws.indexOf(k) < 0 && kws.length < 4) kws.push(k); };
        if (enQuery) addKw(enQuery);
        const mainZh = q.replace(/[#＃]/g, ' ').replace(/\s+/g, ' ').trim();
        if (enQuery) {
          /* 前端已传英文：直接用 */
        } else if (/[\u4e00-\u9fff]/.test(mainZh)) {
          let en = '';
          try { en = await _tryTranSmart(mainZh, 'zh', 'en'); } catch (e) {}
          if (!en || /[\u4e00-\u9fff]/.test(en)) {
            try { const y = await _tryYoudao(mainZh); if (y && /[a-zA-Z]/.test(y) && !/[\u4e00-\u9fff]/.test(y)) en = y; } catch (e) {}
          }
          if (en) addKw(en);
          /* # 子题变体：「中资#抢劫」→ "Chinese companies" + "robbery" 分别碰撞，覆盖分主题报道 */
          const subs = q.split(/[#＃,，、;；]+/).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 3);
          for (let si = 0; si < subs.length; si++) {
            const s = subs[si];
            if (!/[\u4e00-\u9fff]/.test(s)) { addKw(s); subEns[si] = s; continue; }
            let e2 = '';
            try { e2 = await _tryTranSmart(s, 'zh', 'en'); } catch (e) {}
            if (!e2 || /[\u4e00-\u9fff]/.test(e2)) { try { const y2 = await _tryYoudao(s); if (y2 && /[a-zA-Z]/.test(y2) && !/[\u4e00-\u9fff]/.test(y2)) e2 = y2; } catch (e) {} }
            if (e2 && !/[\u4e00-\u9fff]/.test(e2)) { addKw(e2); subEns[si] = e2; }
          }
        } else addKw(q);
        enKws = kws.slice();
        /* v5 双要素组（任务 #515）：每个子题一组——「中资#抢劫」= [涉华集] AND [抢劫词干集] */
        const kwSubs = q.split(/[#＃,，、;；]+/).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 3);
        kwGroups = kwSubs.map((s, i) => _kwGroup(s, subEns[i])).filter(g => g.pats && g.pats.length);
        console.log('[THREATROOM] 关键词翻译: ' + q + ' → [' + kws.join(' | ') + ']');
        /* 每个英文关键字独立全网碰撞（v8：GDELT+GNews+Bing 三引擎并联） */
        for (const kw of kws) {
          push(await _gdr('"' + kw + '" sourcelang:english', { timespan: '7d', maxrecords: 200 }));
          push(await _trGnews(kw, 30));
          push(await _trHnAlgolia(kw, 20));
        }
        /* 主题×事件维度交叉（主力词 + 攻击/抗议/制裁等英文事件面） */
        const main = kws[0] || q;
        for (const gt of ['China', 'attack', 'protest', 'sanction', 'security']) {
          push(await _trGnews(main + ' ' + gt, 18));
        }
        push(await _gdr(main + ' attack', { timespan: '7d', maxrecords: 50 }));
        push(await _gdr(main + ' protest', { timespan: '7d', maxrecords: 40 }));
        /* v8 第三/四引擎：主题主查 + 事件面交叉 */
        push(await _trYahooNews(main, 20));
        push(await _trHnAlgolia(main + ' attack', 15));
        /* 中文原文全语言兜底（中文/俄语源直接命中） */
        push(await _gdr(q.replace(/[#＃]/g, ' '), { timespan: '7d', maxrecords: 60 }));
        try { push(await crawler.apSearch(main, { maxrecords: 15, pages: 1 })); } catch (e) {}
      }
      /* v8 引擎命中透明化（GDELT 限流根治配套）：响应回传各引擎命中明细 + 熔断状态，
       * 前端如实展示哪路通哪路断，不再笼统"可能限流" */
      const _gdStat = (typeof crawler.gdeltStatus === 'function') ? crawler.gdeltStatus() : { cooling: false };
      const _engN = f => arts.filter(f).length;
      const engines = {
        gdelt: _engN(a => a._src === 'gdelt'),
        gnews: _engN(a => a.source === 'Google News'),
        bing: _engN(a => a.source === 'Bing News'),
        yahoo: _engN(a => a.source === 'Yahoo News'),
        hn: _engN(a => a.source === 'HN Algolia'),
        ap: _engN(a => a._src === 'apnews')
      };
      if (!arts.length) {
        const gdNote = (_gdSkipRound || _gdStat.cooling)
          ? 'GDELT 本轮限流熔断（已自动跳过，不烧超时），GNews/HN/Yahoo 备胎本轮也未命中'
          : '多引擎（GDELT/GNews/HN/Yahoo/AP）本轮均未命中';
        return res.json({ ok: true, collected: 0, filtered: 0, inserted: 0, rejected: 0, ms: Date.now() - t0, gdeltCooling: !!_gdStat.cooling, engines, note: gdNote + '——建议关键词换更宽的表述（如「巴基斯坦 恐袭」），或稍后重试，也可直接查看库内联动数据' });
      }
      /* ── 后处理：seendate→发布时间 / 标记（翻译与富化在过滤后做——2026-08-31 实测排雷：
       * 全量翻译 150+ 条需 5-10 分钟导致用户端超时；只译入库批次 ≤60 条） ── */
      arts.forEach(it => {
        if (!it.publish_time && !it.publishedAt && !it.date && it.seendate) {
          const iso = String(it.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
          if (iso !== it.seendate) { it.publish_time = iso; it.publishedAt = iso; it.date = iso; }
        }
        it._sourceType = 'threatroom'; /* 必须在 _isFreshEnough 之前（铁律） */
        it.interestLinked = true;
        if (type === 'country' && !it.country && !it.country_cn) it.country = q; /* 国别检索归因 */
        if (!it.source) it.source = '专项作战室·' + q;
      });
      /* 轻量前置过滤（噪声/无标识/同标题），全量闸门仍在 _ingestLinkedItems 内 */
      const titleKeys = await _getRecentTitleKeys();
      const batch = [];
      /* #519（2026-08-31）：引擎语义根治——fresh 须含所有「本轮全网命中」条目，
       * 而不仅是过 DB 标题去重后入候选库的 batch。已在库条目仍是真实全网命中（用户用「中资#抢劫」
       * /「刚果（金）」反复检索时，被 _isDupTitle 拒掉的才是「本轮最有价值」的结果——
       * 之前直接丢弃导致 fresh 空 + judgeText 显示「监测盲区或信息真空」，违背引擎=中转点设计理念）。
       * 修法：把被 _isDupTitle 拒掉的也收集进 webHits（不入库，只入引擎结果） */
      const webHits = [];
      let rejected = 0;
      /* v3 批次内标题去重：GNews+GDELT 同一事件两边捞到时（不同 URL 同标题）只入一次——
       * 精确标题指纹哈希，与 DB titleKeys 互补：前者防批内冗余，后者防与库内重复 */
      const batchTitleSeen = new Set();
      for (const it of arts) {
        const ctext = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.description || '');
        if (_BAL_NOISE.test(ctext)) { rejected++; continue; }
        /* v5 双要素相关性闸（任务 #515）：所有子题组同时命中才放行——
         * 「中资#抢劫」须同时含涉华要素（中资/China/Gwadar…）AND 主题要素（rob 词干/抢劫），
         * 芝加哥本地抢劫案（缺涉华）/中企融资新闻（缺抢劫）在此拦截 */
        if (kwGroups && kwGroups.length) {
          const txt = String(it.title || '') + ' ' + String(it.content || it.description || '');
          const zht = String(it.title_zh || '') + ' ' + txt;
          if (!kwGroups.every(g => _kwGroupHit(g, txt, zht))) { rejected++; continue; }
        }
        if (!it.url && !it.title) { rejected++; continue; }
        /* #519：被 _isDupTitle 拒掉的条目进 webHits，库内已有 ≠ 本轮无命中 */
        if (_isDupTitle(titleKeys, it)) { rejected++; webHits.push(it); continue; }
        const bk = _normTitleKey(it.title);
        if (bk.length >= 10 && batchTitleSeen.has(bk)) { rejected++; webHits.push(it); continue; }
        if (bk.length >= 10) batchTitleSeen.add(bk);
        batch.push(it);
        if (batch.length >= 80) break;   /* 翻译批次帽 v2（80 条·并发 4 ≈ 2-3 分钟；v1 40 条砍掉一半采集量） */
      }
      /* 翻译 + 实体富化只做入库批次（v2：并发 4） */
      if (batch.length) {
        try { await _translateListToZhParallel(batch, 4); } catch (e) {}
        /* 西里尔质量闸（v2 全语言兜底配套）：俄语原文翻译失败/产出无中文/译文仍大量西里尔
         * 残留的条目拒收——"公斤新闻今天"级垃圾的根治闸 */
        let cyrRej = 0;
        const batch2 = batch.filter(it => {
          const orig = String(it.title || '');
          if (!/[а-яё]/i.test(orig)) return true;   /* 非西里尔源不适用 */
          const zh = String(it.title_zh || '');
          if (!/[\u4e00-\u9fff]/.test(zh)) { cyrRej++; return false; }
          if (((zh.match(/[а-яё]/gi) || []).length / Math.max(1, zh.length)) > 0.3) { cyrRej++; return false; }
          return true;
        });
        rejected += cyrRej;
        batch.length = 0;
        batch.push(...batch2);
        batch.forEach(it => { try { ENTITY.enrich(it); } catch (e) {} });
      }
      let inserted = 0;
      if (batch.length) {
        const r2 = await _ingestLinkedItems(batch, 'THREATROOM', '（专项·' + q + '）');
        inserted = (r2 && r2.inserted) || 0;
      }
      console.log('[THREATROOM] 专项采集 ' + q + '（' + type + '）：检索 ' + arts.length + ' / 过滤后 ' + batch.length + ' / 入库 ' + inserted + ' / 前置拒 ' + rejected + '，耗时 ' + (Date.now() - t0) + 'ms');
      /* v6（任务 #517 用户指令「要全网的数据，不是数据库的数据」）：把本次通过双要素闸的全网
       * 实时结果随响应直出——无论 URL 是否已在库（已入库条目仍是本轮全网检索命中的活数据），
       * 前端优先渲染 fresh，库内 GET data 仅作补充分区 */
      /* v7（任务 #519 引擎语义根治）：fresh 须含「本轮全网命中」全量——
       * webHits（被 DB/批内标题去重拒掉的） + batch（过闸且新入候选库）合并，按 URL 去重，
       * 已入库条目（webHits）排前，新条目（batch）排后——保证重复检索同一主题时仍能看到本轮真实命中 */
      const webSeen = new Set();
      const freshAll = [];
      for (const it of webHits) {
        const k = it.url || ('t:' + _normTitleKey(it.title));
        if (webSeen.has(k)) continue;
        webSeen.add(k); freshAll.push(it);
        if (freshAll.length >= 80) break;
      }
      for (const it of batch) {
        const k = it.url || ('t:' + _normTitleKey(it.title));
        if (webSeen.has(k)) continue;
        webSeen.add(k); freshAll.push(it);
        if (freshAll.length >= 80) break;
      }
      const fresh = freshAll.slice(0, 60).map(it => ({
        title: it.title || '', title_zh: it.title_zh || '', url: it.url || '',
        source: it.source || '', country: it.country || '', country_cn: it.country_cn || '',
        description: String(it.description || it.content || '').slice(0, 600),
        publish_time: it.publish_time || it.publishedAt || it.date || '',
        data_type: it.data_type || '', chinaRelated: it.chinaRelated === true,
        level: it.level || '', _web: true,
        _alreadyIngested: webHits.indexOf(it) >= 0   /* 前端可标记「库内已有」灰底 */
      }));
      res.json({ ok: true, type: type, keywords: enKws, collected: arts.length, filtered: batch.length, inserted, rejected, webHits: webHits.length, ms: Date.now() - t0, gdeltCooling: !!_gdStat.cooling, engines, fresh });
    } finally {
      _threatroomBusyUntil = 0; /* 采集结束即解锁（异常也解锁，防止 5min 假锁） */
    }
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

/* 库内实体匹配数据：country → 国别列+标题双匹配；org/project/keyword → 标题/译文/正文关键词匹配 */
app.get('/api/threatroom/data', async (req, res) => {
  try {
    let type = String(req.query.type || 'keyword');
    const q = String(req.query.cn || req.query.q || '').trim();
    const days = Math.max(1, Math.min(14, parseInt(req.query.days, 10) || 7));
    if (!q) return res.status(400).json({ error: '缺少实体名' });
    /* 国别自动升级（与 collect 端点同源：gdCode 命中即国家） */
    if (type !== 'country' && crawler.gdCode(q)) type = 'country';
    const enName = String(req.query.en || '').trim() || (type === 'country' ? crawler.gdEn(q) : '');
    const pats = [];
    if (q.length >= 2) pats.push('%' + q + '%');
    if (enName.length >= 3) pats.push('%' + enName + '%');
    String(req.query.aliases || '').split(',').forEach(a => { a = a.trim(); if (a.length >= 3) pats.push('%' + a + '%'); });
    let rows = [];
    if (type === 'country') {
      /* 国别六路匹配（v2：v1 只查 country 中文+标题英文，漏掉英文国名 country 字段、
       * 中文标题提及、正文提及——上合峰会报道标题常无国名，country 字段也可能是
       * 'Kyrgyzstan' 英文写法，六路全开才捞得全） */
      const r = await query(
        `SELECT * FROM intel_data WHERE collect_time >= NOW() - ($1 || ' days')::interval
          AND ( country ILIKE $2
             OR data_json->>'country_cn' ILIKE $2
             OR (CASE WHEN $3 <> '' THEN country ILIKE $3 ELSE FALSE END)
             OR (CASE WHEN $3 <> '' THEN title ILIKE $3 ELSE FALSE END)
             OR (CASE WHEN $3 <> '' THEN data_json->>'title_zh' ILIKE $3 ELSE FALSE END)
             OR (CASE WHEN $3 <> '' THEN description ILIKE $3 ELSE FALSE END)
             OR (CASE WHEN $3 <> '' THEN data_json->>'content' ILIKE $3 ELSE FALSE END)
             OR data_json->>'title_zh' ILIKE $2 )
          ORDER BY collect_time DESC LIMIT 400`,
        [String(days), '%' + q + '%', enName ? '%' + enName + '%' : '']);
      rows = r.rows;
    } else if (pats.length) {
      /* v5（2026-08-31 任务 #515）：双要素 AND 匹配——#拆分子题各成一组（组内 OR、组间 AND）。
       * 「中资#抢劫」= 涉华组 AND 抢劫词干组——单要素噪声（全球抢劫案/中企融资新闻）不再混入；
       * 单子题 / org / project 保持 v4 宽 OR 老路。 */
      const kwSubs = q.split(/[#＃,，、;；]+/).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 3);
      let done = false;
      if (type === 'keyword' && kwSubs.length >= 2) {
        const groups = [];
        for (const s of kwSubs) {
          let en = '';
          if (/[\u4e00-\u9fff]/.test(s)) {
            try { en = await _tryTranSmart(s, 'zh', 'en'); } catch (e) {}
            if (!en || /[\u4e00-\u9fff]/.test(en)) {
              try { const y = await _tryYoudao(s); if (y && /[a-zA-Z]/.test(y) && !/[\u4e00-\u9fff]/.test(y)) en = y; } catch (e) {}
            }
          }
          groups.push(_kwGroup(s, en));
        }
        const fGroups = groups.filter(g => g.pats && g.pats.length);
        if (fGroups.length >= 2) {
          /* 英文词干 → PG 正则（\m 词首/\M 词尾 + 叠尾字母+屈折后缀，与 _kwGroupHit
           * 同形态学边界——防 XPeng「robot」凭 %rob% 漏进抢劫主题）；中文词原样子串匹配 */
          const arrs = fGroups.map(g => g.pats.slice(0, 25).map(p => {
            const raw = String(p);
            if (/[\u4e00-\u9fff]/.test(raw)) return raw.replace(/[\\^$.|?*+()[{]/g, '\\$&');
            const e = raw.replace(/[\\^$.|?*+()[{]/g, '\\$&');
            const L = /[A-Za-z]$/.test(raw) ? raw.slice(-1).toLowerCase() : '';
            return '\\m' + e + (L ? ('(?:' + L + ')?') : '') + '(?:es|s|ed|ing|er|ers|ery|eries|ies|ion|ions)?\\M';
          }));
          const whereCls = arrs.map((_, i) =>
            `( title ~* ANY($${i + 2}) OR data_json->>'title_zh' ~* ANY($${i + 2}) OR description ~* ANY($${i + 2}) OR data_json->>'content' ~* ANY($${i + 2}) )`
          ).join(' AND ');
          const r = await query(
            `SELECT * FROM intel_data WHERE collect_time >= NOW() - ($1 || ' days')::interval AND ${whereCls} ORDER BY collect_time DESC LIMIT 400`,
            [String(days)].concat(arrs));
          rows = r.rows;
          done = true;
        }
      }
      if (!done) {
        /* v4（2026-08-31 用户指令：引擎≠实体库门槛）：中文关键词译成英文参与库内匹配——
         * 英文原文标题（title 字段）用英文词命中率远高于中文词；title_zh 仍由中文 q 覆盖 */
        if (/[\u4e00-\u9fff]/.test(q) && pats.length < 8) {
          let en = '';
          try { en = await _tryTranSmart(q.replace(/[#＃]/g, ' ').replace(/\s+/g, ' '), 'zh', 'en'); } catch (e) {}
          if (!en || /[\u4e00-\u9fff]/.test(en)) {
            try { const y = await _tryYoudao(q); if (y && /[a-zA-Z]/.test(y) && !/[\u4e00-\u9fff]/.test(y)) en = y; } catch (e) {}
          }
          if (en) {
            /* 整句 + 实词级（"Chinese companies robbery" 单词拆开各自命中，容错标题语序差异） */
            pats.push('%' + en + '%');
            en.split(/[^A-Za-z0-9]+/).filter(w => w.length >= 4)
              .forEach(w => { if (pats.length < 10) pats.push('%' + w + '%'); });
          }
        }
        const arr = pats.slice(0, 10);
        const ph = arr.map((_, i) => '$' + (i + 2)).join(',');
        const r = await query(
          `SELECT * FROM intel_data WHERE collect_time >= NOW() - ($1 || ' days')::interval
            AND ( title ILIKE ANY($2)
               OR data_json->>'title_zh' ILIKE ANY($2)
               OR (description ILIKE ANY($2))
               OR (data_json->>'content' ILIKE ANY($2)) )
            ORDER BY collect_time DESC LIMIT 400`,
          [String(days), arr]);
        rows = r.rows;
      }
    }
    res.json(rows.map(r => ({ ...r.data_json, id: r.id, audit_status: r.audit_status, collect_time: r.collect_time })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 海外核心安全威胁一分钟哨兵手动触发端点（2026-08-27） ===== */
app.post('/api/core-threat/sweep', async (req, res) => {
  try {
    if (Date.now() < _coreThreatBusyUntil) return res.json({ ok: false, error: '上一轮核心威胁哨兵尚未结束，请稍候' });
    const r = await coreThreatWatch.runCoreThreatWatch({ maxPerQuery: 15 });
    const items = r.items || [];
    if (items.length) {
      try { await _translateListToZhParallel(items, 4); } catch (e) {}
      items.forEach(it => { try { ENTITY.enrich(it); } catch (e) {} });
      const res2 = await _ingestLinkedItems(items, 'CORE-THREAT-MANUAL', '');
      return res.json({ ok: true, count: items.length, inserted: (res2 && res2.inserted) || 0, stats: r.stats });
    }
    res.json({ ok: true, count: 0, inserted: 0, stats: r.stats });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { _coreThreatBusyUntil = 0; }
});

/* ===== 重点项目与TIER1弱国哨兵手动触发端点（2026-08-29） ===== */
app.post('/api/project-watch/sweep', async (req, res) => {
  try {
    if (Date.now() < _projectWatchBusyUntil) return res.json({ ok: false, error: '上一轮重点项目哨兵尚未结束，请稍候' });
    const r = await projectWatch.runProjectWatch({ maxPerQuery: 15 });
    const items = r.items || [];
    if (items.length) {
      try { await _translateListToZhParallel(items, 4); } catch (e) {}
      items.forEach(it => {
        try { ENTITY.enrich(it); it.interestLinked = true; } catch (e) {}
        const t = String(it.title || '') + ' ' + String(it.title_zh || '');
        if (/绑架|劫持|kidnap|hostage|abduct|袭击|遇袭|attacked|bomb|爆炸|枪击/i.test(t)) it.data_type = 'security_events';
        else if (/制裁|实体清单|sanction|entity list|出口管制|export control/i.test(t)) it.data_type = 'sanctions_data';
        else if (/债务|违约|debt|default|退出|withdraw|暂停|suspend|审查|review/i.test(t)) it.data_type = 'economic_risk';
        else it.data_type = 'infrastructure';
        it._forceDataType = true; it._sourceType = 'project_watch';
        if (!it.category) it.category = '重点项目监控';
      });
      const res2 = await _ingestLinkedItems(items, 'PROJECT-WATCH-MANUAL', '');
      return res.json({ ok: true, count: items.length, inserted: (res2 && res2.inserted) || 0 });
    }
    res.json({ ok: true, count: 0, inserted: 0 });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  finally { _projectWatchBusyUntil = 0; }
});

/* ===== 特种兵爬虫（一键全网深抓：涉华负面 + 各国媒体 + 社交平台） =====
 *  ?all=1        -> 执行预设任务（全部关键词 × 搜索引擎/社交 + 各国媒体 feed）
 *  ?q=keyword    -> 自定义关键词精准深抓
 *  无参数         -> 返回可用目标列表
 *  仅接受"关键词"，绝不接受"任意URL"（SSRF 防护在 crawler.js 内部复用 scrapers 白名单）
 */
app.get('/api/crawl', async (req, res) => {
  try {
    const { q, all } = req.query;
    if (all) {
      const items = await crawler.crawlAll();
      const cn = items.filter(it => it.chinaNegative).length;
      /* 降级存储：将真实爬取的公开 OSINT 数据写入服务端文件缓存，供无 PostgreSQL 时的公开态势通道使用 */
      await _translateListToZh(items); _mergePublicCache('osint_intel', items);
      /* 2026-08-29 墓碑出口闸：已删除旧文不回流前端（伦敦使馆旧闻复活根因③） */
      const _kept = [];
      for (const it of items) { if (await _isTombstoned(it)) _gateAudit('出口闸', 'tombstoned', it.title); else _kept.push(it); }
      return res.json({ ok: true, mode: 'all', count: _kept.length, chinaNegative: cn, items: _kept });
    }
    if (q) {
      const items = await crawler.crawlQuery(q);
      const cn = items.filter(it => it.chinaNegative).length;
      return res.json({ ok: true, mode: 'query', query: q, count: items.length, chinaNegative: cn, items });
    }
    const sources = crawler.SEARCH_ENGINES.concat(crawler.SOCIAL_TARGETS, crawler.MEDIA_FEEDS)
      .map(s => ({ id: s.id, name: s.name, country: s.country || '' }));
    return res.json({ ok: true, sources });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ==================== 全球多国媒体真实情报端点 ====================
 * 主数据 = 实测可达的直连 RSS（server/globalmedia.js 的 DIRECT_RSS，覆盖全球多国）。
 * 增强 = GDELT 全球媒体库（按国家批量拉取，环境允许时自动补充；当前运行环境
 *        若限流/超时则自动跳过，绝不伪造）。
 * 铁律一：只返回真实抓取到的公开信息；通道不可用时如实返回 0 条。 */
let _mediaCache = { items: [], byCountry: {}, updatedAt: 0, status: {} };
const MEDIA_CACHE_FILE = path.join(CACHE_DIR, 'media_cache.json');
/* 我方资产坐标（供后续资产邻近判定使用）。后续可从企业项目库
 * 动态抽取 lat/lng；当前先置空，避免缺少坐标时报错。 */
const _intelAssets = [];

function _writeMediaCache(items, byCountry, extra) {
  // 内存紧张：只保留最近 200 条，避免缓存无限增长
  const recent = (items || []).slice(-200);
  _mediaCache = {
    items: recent, byCountry: byCountry || {},
    updatedAt: Date.now(),
    status: Object.assign({ countries: Object.keys(byCountry || {}).length, total: recent.length }, extra || {})
  };
  try { fs.writeFileSync(MEDIA_CACHE_FILE, JSON.stringify(_mediaCache)); } catch (e) {}
}
function _mergeMedia(extraItems, extraByCountry, extra) {
  const base = (_mediaCache.items || []).slice();
  const seen = new Set(base.map(it => it.url || it.title));
  let added = 0;
  (extraItems || []).forEach(it => { const k = it.url || it.title; if (k && !seen.has(k)) { seen.add(k); base.push(it); added++; } });
  const byC = Object.assign({}, _mediaCache.byCountry || {}, extraByCountry || {});
  _writeMediaCache(base, byC, Object.assign({}, _mediaCache.status || {}, extra || {}, { total: base.length }));
  console.log('[GLOBALMEDIA] 合并 +' + added + ' 条，现 ' + base.length);
}
/* busy 锁全部改为"时间戳锁 + 10分钟硬超时自动释放"：
 * 2026-08-12 事故：某轮采集 Promise 挂死（finally 永远等不到），_chinaFocusBusy 卡死 true，
 * 涉华专项停摆 7 小时。时间戳锁保证挂死最多只停摆 10 分钟。 */
let _globalMediaBusyUntil = 0;
let _chinaFocusBusyUntil = 0;
let _chinaNegativeBusyUntil = 0;
let _terrorBusyUntil = 0;
const BUSY_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
let _chinaNegativeLastApAt = 0;
let CHINA_NEGATIVE_AP_INTERVAL_MS = 5 * 60 * 1000; // AP 搜索默认每 5 分钟一次（调速器可动态下调）
let _rssRoundIndex = 0;
let RSS_ROTATE_COUNT = 30;     // 普通源轮询窗口（调速器可动态扩大）
const RSS_PRIORITY_COUNT = 40;   // 重点源池：涉华源+亚太源每轮优先抓（降低以缓解内存）
const TT_PRIORITY_COUNT = 15;    // 中国/亚太专项智库每轮必抓
let TT_ROTATE_COUNT = 20;      // 每轮轮询智库源数量（调速器可动态扩大）
let CHINA_FOCUS_COUNT = 40;    // 涉华专项源每轮必抓（调速器可动态扩大）
let THEME_ROTATE_COUNT = 4;    // GDELT/AP 主题词每轮轮换数（调速器可动态扩大）
const RSS_CONCURRENCY = 6;       // RSS 并发请求数（系统内存 96%，必须降低并发）
const RSS_TIMEOUT_MS = 7000;     // 单个 RSS 超时 7 秒
const GLOBAL_MEDIA_INTERVAL_MS = 60 * 1000; // 每 60 秒运行一轮，降低内存/GC 压力

/* ===== 每日采集指标统计（用户硬性指标：总量≥500条/天，涉华80-100条/天）===== */
function _todayKey() {
  /* 本地自然日（服务器在中国时区 GMT+8），不能用 toISOString() 的 UTC 日期——
   * UTC 比本地晚 8 小时，凌晨 0~8 点 UTC 仍是昨天，导致日指标跨天不重置。 */
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const DAILY_STATS_FILE = path.join(CACHE_DIR, 'daily_stats.json');

/* ===== 标题归一化去重（2026-08-19 修）=====
 * 背景：同一通稿被多家媒体转载，URL 不同导致 URL 级去重失效；更隐蔽的是同一事件 2-3 天后换个标题
 *（如"IS 声称喀布尔中国餐馆爆炸"）再次入库，用户"昨天处理过今天又出现"。
 * 方案：
 *  1. 标题指纹窗口 24h → 7 天，catch 短期换标题转载/旧闻重发。
 *  2. 引入事件签名去重（_eventSignature：国家+事件类型词+日期），同一事件不同来源/标题只留一条主报。
 *  3. 新增"核心实体指纹"：提取标题中的人名/组织名/地名/数字，避免仅改几个字的洗稿重复。
 * 注意：窗口变长会饿死热点后续进展，因此标题指纹仅 catch 高度相似转载；事件签名 7 天窗口用于
 * 拦截旧闻复活，新进展（如"死亡人数升至 X"）因日期或数字不同会生成新签名，不被误杀。 */
function _normTitleKey(t) {
  return String(t || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w一-龥]+/g, '')
    .slice(0, 48);
}

/* ===== 删除墓碑（2026-08-22 用户铁律：删掉的数据永远不再进来）=====
 * 病灶：用户前端删预警只是切了前端数组——服务器行还在（同步复活）、采集器还会再抓
 * 同一旧闻（重新入库复活），旧的 _POST_BLOCK_RE 硬编码黑名单只能打地鼠。
 * 机制：任何删除动作都把 标题指纹+译文指纹+URL 写进 intel_tombstones，
 * 所有入库闸（定时采集 _preInsertGate / 前端 POST _postGate）先查墓碑，命中即拒。 */
let _tombReady = false;
async function _ensureTombstoneTable() {
  if (_tombReady) return;
  _tombReady = true;
  try {
    await query(`CREATE TABLE IF NOT EXISTS intel_tombstones (
      id SERIAL PRIMARY KEY, tkey TEXT, url TEXT, title TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tomb_tkey ON intel_tombstones(tkey)`);
  } catch (e) { _tombReady = false; console.warn('[TOMBSTONE] 建表失败:', e.message); }
}
let _tombCache = { t: 0, tkeys: new Set(), urls: new Set() };
async function _getTombstones() {
  if (Date.now() - _tombCache.t < 60 * 1000 && (_tombCache.tkeys.size || _tombCache.urls.size)) return _tombCache;
  await _ensureTombstoneTable();
  try {
    const { rows } = await query(`SELECT tkey, url FROM intel_tombstones`);
    /* 2026-08-29 死键修复：库里 332 条墓碑中 328 条是历史写入方留下的
     * t:<原始标题>/u:<原始URL> 前缀键——带标点、带前缀，与 _isTombstoned 的
     * 归一化比对永不相等 → 全部是死键，删除形同虚设（伦敦使馆旧闻复活根因①）。
     * 读取时统一归一化：u: → urls 集；t: → 归一化标题键；c: → 核心实体键原样。 */
    const tkeys = new Set(), urls = new Set();
    for (const r of rows) {
      const raw = String(r.url || '').trim();
      if (raw) urls.add(raw.replace(/\/+$/, '').toLowerCase());
      const k = String(r.tkey || '');
      if (!k) continue;
      if (k.startsWith('u:')) {
        const u = k.slice(2).trim();
        if (u) urls.add(u.replace(/\/+$/, '').toLowerCase());
      } else if (k.startsWith('t:')) {
        const nk = _normTitleKey(k.slice(2));
        if (nk.length >= 6) tkeys.add(nk);
      } else {
        tkeys.add(k); /* 无前缀归一化键（现行格式）与 c: 核心实体键（2026-08-29 起） */
      }
    }
    _tombCache = { t: Date.now(), tkeys, urls };
  } catch (e) {}
  return _tombCache;
}
async function _addTombstone(title, titleZh, url) {
  await _ensureTombstoneTable();
  const keys = [];
  const k1 = _normTitleKey(title), k2 = _normTitleKey(titleZh);
  if (k1.length >= 6) keys.push(k1);
  if (k2.length >= 6 && k2 !== k1) keys.push(k2);
  /* 2026-08-29 变体级墓碑（伦敦使馆旧闻复活根因②）：同一文章经不同翻译通道
   * 措辞漂移（"对伦敦新的中国大型大使馆"vs"伦敦新中国巨型大使馆"），
   * 归一化标题键对不上 → 复活。补核心实体键（国家+组织+数字+事件动词），
   * 同文变体稳定命中；宁误杀不放过（用户铁律：删掉的数据永远不再进来）。 */
  const c1 = _coreEntityKey(title), c2 = _coreEntityKey(titleZh);
  if (c1 && c1.length >= 6) keys.push('c:' + c1);
  if (c2 && c2.length >= 6 && c2 !== c1) keys.push('c:' + c2);
  if (!keys.length && !url) return;
  try {
    const rowsToInsert = keys.length ? keys : [''];
    for (const k of rowsToInsert) {
      await query(`INSERT INTO intel_tombstones (tkey, url, title) VALUES ($1, $2, $3)`,
        [k || null, url || null, String(title || titleZh || '').slice(0, 200)]);
    }
    _tombCache.t = 0; /* 立即失效缓存，删除马上生效 */
    console.log('[TOMBSTONE] 已立墓碑: ' + String(title || titleZh || url || '').slice(0, 60));
  } catch (e) { console.warn('[TOMBSTONE] 写入失败:', e.message); }
}
/* 墓碑命中（同步版）：PUT 写入闸等同步过滤场景先 await _getTombstones() 拿缓存再调用 */
function _tombMatchSync(tb, it) {
  if (!tb || (!tb.tkeys.size && !tb.urls.size)) return false;
  const t = it || {};
  const u = String(t.url || t.link || '').replace(/\/+$/, '').toLowerCase();
  if (u && tb.urls.has(u)) return true;
  const k1 = _normTitleKey(t.title), k2 = _normTitleKey(t.title_zh);
  if (k1.length >= 6 && tb.tkeys.has(k1)) return true;
  if (k2.length >= 6 && tb.tkeys.has(k2)) return true;
  const c1 = _coreEntityKey(t.title), c2 = _coreEntityKey(t.title_zh);
  if (c1 && c1.length >= 6 && tb.tkeys.has('c:' + c1)) return true;
  if (c2 && c2.length >= 6 && tb.tkeys.has('c:' + c2)) return true;
  return false;
}
async function _isTombstoned(it) {
  return _tombMatchSync(await _getTombstones(), it);
}

/* ==========================================================================
 * Google News 旧闻验真清扫器（2026-08-30 根治塔吉克旧闻污染）
 *
 * 事故：Google News RSS 的 pubDate 是"收录时间"非"发布时间"——旧闻被重新
 * 收录推送时 24h 时效闸判其为新（今日入库的塔吉克事件簇 12 条实为
 * 2005~2026-08-15 的旧闻，用户当场识破）。
 * 机制：每 15min 扫近 2h 入库的 news.google.com 预警（≤15 条/轮防限流），
 * 解码出原始媒体 URL → 从 URL 提取发布日期 → 早于 30 天的剔除
 * + 墓碑（谷歌链接/标题/核心实体三键）防重入。
 * 安全边界：URL 无日期信息的一律不动（宁漏勿杀）；解码失败跳过。
 * 解码协议（googlenewsdecoder 同款）：GET 文章页取 data-n-a-sg/签名时间戳
 * → POST batchexecute 换取原始出版商 URL。
 * ========================================================================== */
const _GNS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
async function _gnewsDecodeUrl(gurl) {
  try {
    const m = String(gurl).match(/\/(?:articles|read)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const b = m[1];
    const page = await netx.smartFetch('https://news.google.com/rss/articles/' + b, { timeout: 12000, headers: { 'User-Agent': _GNS_UA } });
    if (!page || !page.ok) return null;
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/), ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sg || !ts) return null;
    /* 实测（2026-08-30）：f.req 需三层包裹 [[["Fbv4je", inner]]] 才返回 200，两层返回 400 */
    const innerStr = '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"' + b + '",' + ts[1] + ',"' + sg[1] + '"]';
    const fReq = JSON.stringify([[["Fbv4je", innerStr]]]);
    const resp = await netx.smartPost('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': _GNS_UA },
      body: 'f.req=' + encodeURIComponent(fReq),
    });
    if (!resp || !resp.ok) return null;
    const txt = await resp.text();
    /* 应答格式：)]}'\n\n[["Fbv4je","[\"garturlres\",\"https://…\",…]",…]] */
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
/* 从原始 URL 提取发布日期（带月/日合法性校验，防把文章 ID 误当日期） */
function _urlPubDate(u) {
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
/* 原文页面发布日期提取（URL 无日期时的增强验真）：article:published_time / <time datetime> / JSON-LD datePublished */
async function _pagePubDate(u) {
  try {
    const r = await netx.smartFetch(u, { timeout: 10000, headers: { 'User-Agent': _GNS_UA } });
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
let _gnewsSweepBusy = false;
async function _runGnewsTruthSweep() {
  if (_gnewsSweepBusy) return;
  _gnewsSweepBusy = true;
  try {
    const { rows } = await query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
    if (!rows.length) return;
    let arr = Array.isArray(rows[0].data_json) ? rows[0].data_json : JSON.parse(rows[0].data_json);
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    const cand = arr.filter(a => {
      if (!a || String(a.url || '').indexOf('news.google.com') < 0 || !a.time) return false;
      const t = new Date(String(a.time).replace(' ', 'T')).getTime();
      return isFinite(t) && t > 0 && now - t < 2 * 3600 * 1000;
    }).slice(0, 15);
    if (!cand.length) return;
    console.log('[GNEWS-TRUTH] 本轮候选 ' + cand.length + ' 条（近2h google news），开始解码验真...');
    const removed = [];
    for (const a of cand) {
      const orig = await _gnewsDecodeUrl(a.url);
      if (!orig) { await new Promise(s => setTimeout(s, 1200)); continue; }
      /* 两级验真：URL 日期模式 → 原文页面 meta 发布时间 */
      const d = _urlPubDate(orig) || await _pagePubDate(orig);
      if (d && now - d.getTime() > 30 * 24 * 3600 * 1000) {
        removed.push({ a, orig, d });
        console.log('[GNEWS-TRUTH] 验出旧闻: ' + (a.title_zh || a.title || '').slice(0, 50) + ' | 原文发布 ' + d.toISOString().slice(0, 10) + ' | ' + orig.slice(0, 70));
      }
      await new Promise(s => setTimeout(s, 1500)); /* 防限流 */
    }
    if (!removed.length) return;
    const killIds = new Set(removed.map(x => String(x.a.id)));
    arr = arr.filter(a => !killIds.has(String(a.id)));
    await query(`UPDATE datahub_store SET data_json=$1, updated_at=NOW() WHERE collection='alerts'`, [JSON.stringify(arr)]);
    for (const coll of ['events', 'terror_events']) {
      try {
        const r2 = await query(`SELECT data_json FROM datahub_store WHERE collection=$1`, [coll]);
        if (!r2.rows.length) continue;
        let a2 = Array.isArray(r2.rows[0].data_json) ? r2.rows[0].data_json : JSON.parse(r2.rows[0].data_json);
        if (!Array.isArray(a2)) continue;
        const b = a2.length;
        a2 = a2.filter(x => !killIds.has(String(String(x.id).replace('live-', ''))));
        if (a2.length !== b) await query(`UPDATE datahub_store SET data_json=$1, updated_at=NOW() WHERE collection=$2`, [JSON.stringify(a2), coll]);
      } catch (e) {}
    }
    for (const x of removed) {
      await _addTombstone(x.a.title, x.a.title_zh, x.a.url);   /* 谷歌链接为重入主键 */
    }
    console.log('[GNEWS-TRUTH] 本轮剔除旧闻 ' + removed.length + ' 条并立墓碑');
  } catch (e) {
    console.warn('[GNEWS-TRUTH] 清扫异常:', e.message);
  } finally {
    _gnewsSweepBusy = false;
  }
}
function _coreEntityKey(t) {
  /* 提取标题中的国家、组织、数字、核心名词，用于识别"洗稿式重复" */
  const s = String(t || '').toLowerCase();
  const parts = [];
  const countries = (s.match(/\b(afghanistan|pakistan|china|chinese|kabul|gwadar|balochistan|iran|iraq|syria|yemen|libya|sudan|nigeria|kenya|somalia|mali|niger|chad|ukraine|russia|myanmar|israel|palestine|turkey|saudi|uae|egypt|ethiopia|tanzania|congo|bangladesh|sri lanka|nepal|kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan|laos|cambodia|vietnam|thailand|malaysia|indonesia|philippines|brazil|argentina|chile|peru|mexico|australia|serbia|hungary|poland|germany|france|britain|italy|japan|korea|mongolia)\b/g) || []);
  const orgs = (s.match(/\b(isis|isil|is[- ]?khorasan|taliban|ttp|boko haram|al[- ]?shabaab|houthi|hezbollah|hamas|bla|blf|al[- ]?qaeda|qaida|islamic state)\b/g) || []);
  const nums = (s.match(/\b\d+\b/g) || []);
  const verbs = (s.match(/\b(attack|blast|bomb|explosion|kidnap|killing|killed|dead|death|shooting|hostage|clash|raid|ambush|sanction|protest|riot|coup|crash|collapse|fire|explosion|绑架|爆炸|袭击|枪击|冲突|骚乱|抗议|示威|罢工|政变|制裁|封锁|禁运|海盗|劫持|叛乱|武装|极端组织|恐袭|死亡|遇难|身亡|伤亡|事故|灾难|撤离|疏散)\b/g) || []);
  parts.push(...countries, ...orgs, ...nums, ...verbs);
  return parts.sort().join('|').slice(0, 120);
}
let _titleKeyCache = { t: 0, set: new Set() };
async function _getRecentTitleKeys() {
  if (Date.now() - _titleKeyCache.t < 5 * 60 * 1000 && _titleKeyCache.set.size) return _titleKeyCache.set;
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const { rows } = await query(`SELECT title, data_json->>'title_zh' AS tzh FROM intel_data WHERE collect_time >= $1`, [since]);
    const set = new Set();
    rows.forEach(r => {
      const k1 = _normTitleKey(r.title); if (k1.length >= 10) set.add(k1);
      const k2 = _normTitleKey(r.tzh); if (k2.length >= 10) set.add(k2);
    });
    _titleKeyCache = { t: Date.now(), set };
    _recentTitleKeysCache = set;   /* 同步只读视图刷新（当天铁律用） */
  } catch (e) { console.warn('[TITLE-DEDUP] 指纹缓存构建失败:', e.message); }
  return _titleKeyCache.set;
}
/* 单条检查（循环内用）：命中任一指纹即视为同事件转载 */
function _isDupTitle(titleKeys, it) {
  const k1 = _normTitleKey(it.title);
  if (k1.length >= 10 && titleKeys.has(k1)) return true;
  const k2 = _normTitleKey(it.title_zh);
  if (k2.length >= 10 && titleKeys.has(k2)) return true;
  return false;
}
function _addTitleKey(titleKeys, it) {
  const k1 = _normTitleKey(it.title); if (k1.length >= 10) titleKeys.add(k1);
  const k2 = _normTitleKey(it.title_zh); if (k2.length >= 10) titleKeys.add(k2);
}
/* 事件签名去重：近 7 天同国家+同事件类型+同日期的条目视为同一事件，只保留最早/信源最高者。
 * 用于拦截"IS 声称喀布尔中国餐馆爆炸"这类旧闻 2-3 天后换标题重发。 */
let _eventSigCache = { t: 0, set: new Set() };
/* 当天铁律用的同步只读视图（2026-08-28）：_isFreshEnough 是同步函数无法 await，
 * 由 _getRecentEventSigs/_getRecentTitleKeys 刷新时同步更新此二引用 */
var _recentEventSigsCache = new Set();
var _recentTitleKeysCache = new Set();
async function _getRecentEventSigs() {
  if (Date.now() - _eventSigCache.t < 5 * 60 * 1000 && _eventSigCache.set.size) return _eventSigCache.set;
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const { rows } = await query(`SELECT data_json->>'_eventSig' AS sig FROM intel_data WHERE collect_time >= $1 AND data_json->>'_eventSig' IS NOT NULL`, [since]);
    const set = new Set();
    rows.forEach(r => { if (r.sig) set.add(r.sig); });
    _eventSigCache = { t: Date.now(), set };
    _recentEventSigsCache = set;   /* 同步只读视图刷新 */
    return set;
  } catch (e) { return _eventSigCache.set || new Set(); }
}
/* 标题自动补全（2026-08-20 用户指令：要素不全要补全，不是拦截）
 * 识别纯地名/半截引用/末尾截断，从 content 提取地点、事件类型、伤亡数、行为主体，
 * 重构成"[地点]发生[事件]（[主体]），致X人伤亡"式完整主谓宾标题。 */
const _TITLE_CORE_PLACES = /瓜达尔|哈达监狱|俾路支|奎达|白沙瓦|喀布尔|摩加迪沙|巴格达|大马士革|基辅|莫斯科|比雷埃夫斯|汉班托塔|皎漂|钱凯|科伦坡港口城|中白工业园|吉布提|苏伊士|马六甲|霍尔木兹|亚丁湾|红海|马尼拉|雅加达|河内|曼谷|吉隆坡|新加坡|达累斯萨拉姆|内罗毕|约翰内斯堡|开罗|拉各斯|阿布贾|金沙萨|卡拉奇|伊斯兰堡|喀土穆|朱巴|摩加迪沙|的黎波里|阿尔及尔|拉巴特|突尼斯|德黑兰|利雅得|阿布扎比|多哈|伊斯坦布尔|特拉维夫|贝鲁特|安曼|巴库|第比利斯|埃里温|伊斯兰堡|新德里|达卡|加德满都|科伦坡|廷布|曼谷|万象|金边|吉隆坡|雅加达|马尼拉|斯里巴加湾市|河内|达沃|宿务|棉兰|泗水|万隆|胡志明市|仰光|曼德勒|内比都|阿斯塔纳|塔什干|比什凯克|杜尚别|阿什哈巴德|乌兰巴托|平壤|首尔|东京|德黑兰|巴格达|大马士革|利雅得|阿布扎比|多哈|科威特城|麦纳麦|马斯喀特|安曼|贝鲁特|耶路撒冷|拉姆安拉|萨那|亚丁|摩加迪沙|哈尔格萨|摩加迪沙|喀土穆|朱巴|的黎波里|班加西|阿尔及尔|拉巴特|突尼斯|卡萨布兰卡|达喀尔|阿比让|拉各斯|阿布贾|哈科特港|卡诺|金沙萨|卢本巴希|布拉柴维尔|罗安达|马普托|哈拉雷|卢萨卡|内罗毕|蒙巴萨|达累斯萨拉姆|阿鲁沙|亚的斯亚贝巴|开罗|亚历山大|约翰内斯堡|开普敦|德班|比勒陀利亚|莫斯科|圣彼得堡|基辅|明斯克|华沙|贝尔格莱德|布达佩斯|雅典|柏林|巴黎|伦敦|罗马|马德里|里斯本|阿姆斯特丹|布鲁塞尔|伯尔尼|斯德哥尔摩|奥斯陆|赫尔辛基|哥本哈根|维也纳|华盛顿|纽约|洛杉矶|旧金山|西雅图|芝加哥|多伦多|温哥华|渥太华|悉尼|墨尔本|堪培拉|惠灵顿|堪培拉|巴西利亚|圣保罗|里约热内卢|布宜诺斯艾利斯|利马|圣地亚哥|波哥大|加拉加斯|基多|拉巴斯|哈瓦那|墨西哥城|瓜达拉哈拉|中美洲|加勒比/i;
const _TITLE_EVENT_RE = /(爆炸|袭击|绑架|劫持|冲突|枪击|恐袭|自杀式|汽车炸弹|导弹|空袭|炮击|交火|抗议|示威|骚乱|罢工|政变|越狱|暴动|武装冲突|游行|集会|冲突|战争|恐袭|枪战|屠杀|处决|斩首|伏击|自杀式袭击|路边炸弹|简易爆炸装置|attack|bomb|explosion|kidnap|hostage|shooting|clash|protest|riot|coup|earthquake|flood|typhoon|hurricane|tsunami|volcano|landslide|mudslide|wildfire|cyclone|storm surge|pandemic|epidemic|outbreak)/i;
const _TITLE_CASUALTY_RE = /(\d{1,4})\s*(?:人|名|个)?\s*(?:死亡|身亡|遇难|丧生|受伤|伤亡|被杀|丧命|罹难|killed|dead|deaths|injured|wounded|casualties)/i;
const _TITLE_ACTOR_RE = /(塔利班|基地组织|博科圣地|青年党|胡塞|真主党|哈马斯|俾路支解放军|BLA|TTP|ISIS|伊斯兰国|库尔德|政府军|反对派|武装分子|恐怖分子|叛乱分子|民兵|黑帮|贩毒集团|民族解放军|M23|博科|索马里青年党|沙巴布|阿布沙耶夫|东突|HTS|叙利亚反对派|自由军|库尔德武装|塔利班武装|塔利班政权|俾路支|Taliban|Al-Qaeda|Boko Haram|Al-Shabaab|Houthi|Hezbollah|Hamas|ISIL|Daesh|PKK|YPG|FSA|militants|insurgents|rebels|cartel|gang)/i;
function _titleLooksIncomplete(t) {
  const u = String(t || '').trim();
  if (u.length < 12) return true;
  if (/[是为系，；:：]$/i.test(u)) return true;
  if (/^(?:来自|据|由)[^，。]+(?:称|表示|说|claim|said|says|told|announced)/i.test(u)) return true;
  // 仅地点/项目名称（不含事件谓语）
  if (_TITLE_CORE_PLACES.test(u) && !_TITLE_EVENT_RE.test(u)) return true;
  return false;
}
function _completeTitle(it) {
  const t = String(it.title || '').trim();
  const tzh = String(it.title_zh || '').trim();
  const c = String(it.content || it.description || it.summary || '').trim();
  const usable = tzh || t;
  const content = c || usable;
  if (!_titleLooksIncomplete(usable)) return it;

  /* 极保守补全：只在能明确还原标题要素时才改写，绝不从标题/正文中"猜测"地点事件。
   * 处理 3 种情况：
   * 1) 标题是纯地名（如"瓜达尔"）且 content 明确出现同一地点+事件；
   * 2) 标题是"来自...的...称...，地点+事件+是"且 core 去掉前后零碎后包含"地点+事件"；
   * 3) 标题末尾被截断为"是/为/系"，去掉后 core 包含"地点+事件"。
   * 其余一律不动。 */

  const _hasEvent = s => /(?:爆炸|袭击|绑架|劫持|冲突|枪击|恐袭|自杀式|导弹|空袭|炮击|交火|抗议|示威|骚乱|罢工|政变|越狱|暴动|武装冲突|战争|屠杀|处决|斩首|伏击|attack|bomb|explosion|kidnap|hostage|shooting|clash|protest|riot|coup)/i.test(s);

  let newTitle = '';

  /* 1. 纯地名/地点词（标题整体就是一个地点） */
  if (!newTitle && usable.length <= 10 && _TITLE_CORE_PLACES.test(usable)) {
    const placeM = usable.match(_TITLE_CORE_PLACES);
    const place = placeM ? placeM[0] : '';
    if (place && place === usable && content.indexOf(place) >= 0) {
      const evtM = content.match(_TITLE_EVENT_RE);
      if (evtM) newTitle = place + '发生' + evtM[1];
    }
  }

  /* 2. "来自/据...称...是/为/系" 截断引用 */
  const isQuoteBreak = /^(?:来自|据|由)[^，。]+(?:称|表示|说|claim|said|says|told|announced).*[是为系]$/i.test(usable);
  if (!newTitle && isQuoteBreak) {
    let core = usable
      .replace(/^.*?的[^，。]{2,60}(?:称|表示|说|claim|said|says|told|announced)[：:；,，\s]*/i, '')
      .replace(/^来自[^，。]{2,60}(?:称|表示|说|claim|said|says|told|announced)[：:；,，\s]*/i, '')
      .replace(/^据[^，。]{2,60}(?:称|表示|说|claim|said|says|told|announced)[：:；,，\s]*/i, '')
      .replace(/[是为系]$/i, '')
      .trim();
    /* 去掉开头的人名插语，如 "Sorab，瓜达尔爆炸事件" */
    core = core.replace(/^[^，。\s]{1,20}[，,\s]+(?=.*(?:瓜达尔|哈达|俾路支|奎达|白沙瓦|喀布尔|霍尔木兹|爆炸|袭击|绑架|冲突|枪击|恐袭))/i, '');
    if (core.length >= 6 && _hasEvent(core) && _TITLE_CORE_PLACES.test(core)) {
      newTitle = core;
    }
  }

  /* 3. 末尾以 "是/为/系" 截断：去掉尾词后 core 末尾必须是完整事件词，且同时含地点+事件。
   * 注意："关系/联系/体系" 等词中的 "系" 不属于截断，不处理。 */
  const isEndBreak = /(?:是|为|(?<![关联体统])系)$/i.test(usable);
  if (!newTitle && isEndBreak) {
    let core = usable.replace(/(?:是|为|(?<![关联体统])系)$/i, '').trim();
    if (core.length >= 12 && _hasEvent(core) && _TITLE_CORE_PLACES.test(core) && /(?:爆炸|袭击|绑架|劫持|冲突|枪击|恐袭|自杀式|导弹|空袭|炮击|交火|抗议|示威|骚乱|罢工|政变|越狱|暴动|武装冲突|战争|屠杀|处决|斩首|伏击|attack|bomb|explosion|kidnap|hostage|shooting|clash|protest|riot|coup)$/i.test(core)) {
      newTitle = core;
    }
  }

  if (newTitle) {
    const actorM = content.match(_TITLE_ACTOR_RE) || usable.match(_TITLE_ACTOR_RE);
    if (actorM && newTitle.indexOf(actorM[1]) < 0) newTitle += '（' + actorM[1] + '）';
    const casM = content.match(_TITLE_CASUALTY_RE);
    if (casM && !/\d+\s*(?:人|名|个)?(?:死亡|身亡|遇难|受伤|伤亡)/.test(newTitle)) newTitle += '，致' + casM[1] + '人伤亡';
  }

  if (newTitle && newTitle !== usable) {
    if (tzh) it.title_zh = newTitle;
    else it.title = newTitle;
  }
  return it;
}
function _isTitleQualityOk(it) {
  const t = String(it.title || '').trim();
  const tzh = String(it.title_zh || '').trim();
  const usable = tzh || t;
  if (usable.length < 12) return false;
  /* 2026-08-28 翻译残留类根治（用户指令：解决一类问题而非个案）：
   * 小语种（阿尔巴尼亚语等拉丁字母语言）机翻只翻一半，产出「27人死亡11 Shtatorit」
   * 式烂标题——数字后紧跟外文实义词是典型残留信号（正常中文写"9月11日"不写"11 Shtatorit"）。
   * 专名/缩写白名单放行（人名地名保留在中文标题属正常操作）。 */
  if (/[\u4e00-\u9fa5]/.test(usable)) {
    const m = usable.match(/\d{1,4}\s+[A-Za-z][A-Za-z]{3,}/g) || [];
    const WL = /^(?:CPEC|ISIS|ISIL|Taliban|COVID|IMF|WTO|NATO|UNHCR|TTP|BLA|ISWAP|Houthi|Houthis|Hezbollah|Hamas|RSF|ELN|FARC|UNICEF|OPEC|SWIFT|killed|injured|dead)s?$/i;
    for (const frag of m) {
      const w = String(frag).trim().split(/\s+/)[1];
      if (w && !WL.test(w)) return false;   /* 数字+外文实义词残留 → 拦截 */
    }
    /* 中文标题内连续 2+ 个非白名单外文词（非首字母专名模式）→ 机翻半成品 */
    const words = usable.match(/[a-z]{4,}/g) || [];   /* 全小写词 = 非专名，实义词残留 */
    const WL2 = /^(?:killed|injured|dead|attack|attackers|missing|wounded|hostage|kidnapped)$/i;
    const lowerWords = words.filter(w => !WL2.test(w));
    if (lowerWords.length >= 2) return false;
  }
  /* 拦截明显缺主语/缺事件要素的标题：地名+人称+动词 but 无对象 */
  if (/^来自.*的.*称|^来自.*称| claimed by |claims that|^来自.*的.*表示|^据.*报道|^.*称.*是$/i.test(usable)) {
    /* 若同时含具体事件要素则放行 */
    if (!/爆炸|袭击|绑架|冲突|抗议|制裁|封锁|死亡|遇难|身亡|blast|attack|kidnap|clash|protest|sanction|blockade|killed|dead/i.test(usable)) return false;
  }
  /* 拦截"来自某组织的某人称/表示"式残缺标题：即使有安全词，若标题只是"某人声称某事是..."且没有给出
   * 完整事件结论（末尾为"是/为/系"、逗号悬停、或主体是人名+称而无明确动宾），仍视为信息要素不全。
   * 例："来自哈达监狱的Beerbal Baloch称Sorab，瓜达尔爆炸事件是" */
  if (/来自.*(?:监狱|组织|团体|人士|机构|武装).*的.*(?:称|表示|说|claim|said|says)/i.test(usable) &&
      /[是为，；:]$/i.test(usable)) return false;
  /* 标题末尾以"称...是/为/系"结束 → 事件结论被截断，信息不全 */
  if (/称[^，。！；："']*[是为系]$/i.test(usable)) return false;
  /* 拦截纯人名+回家/回忆录式特写："老鹰费利克斯...回到了塞尔维亚的家中"
   * 即便文中提到"曾遭遇绑架"，核心叙事是"回家/与亲人团聚/回忆录"，不是当前可处置的安全事件。
   * 但"获释/被救/回国/遣返"类政府/官方行动仍放行。 */
  if ((/回到.*家中|回到了.*家|回到.*家人|回到.*故乡|回到.*老家|与家人团聚|久别重逢|回忆录|.*的故事|自述|专访|特写|profile|human interest|first.person/i.test(usable)) &&
      !/获释|被救|释放|遣返|回国|返回.*(中国|北京|上海|祖国)| rescued | released .* from /i.test(usable)) return false;
  /* 2026-08-30 拦截律所投资诉讼招揽广告（铁证样本 30262："MVST Deadline: MVST Investors
   * with Losses in Excess of $100K"）——"投资者损失/截止日期/加入诉讼/索赔"模式是律所
   * 新闻稿广告，不是安全事件情报。 */
  if (/investors? with losses|deadline.{0,30}(investor|lawsuit|file|claim)|join (the )?(lawsuit|class action|investigation)|to file (a )?(claim|lawsuit)|class action.{0,30}deadline|no cost.{0,30}(you|investor)|投资者损失.{0,20}(截止|索赔|诉讼)/i.test(usable)) return false;
  return true;
}
/* 统一入库前置闸（2026-08-19）：所有 INSERT 通道必须调用，集中处理：
 * ① 国内硬拦截 ② 标题质量 ③ 核心实体去重 ④ 事件签名去重 */
/* 2026-08-25 铁律：入库字段去 HTML 标签——翻译链会把原文的 <p>/<a href> 带进 desc/content_zh，
 * 且前端 substring 常截成未闭合标签（<a href="x 无闭合引号），注入 innerHTML 后吞掉后续 DOM：
 * 预警队列标题变默认蓝色链接+点不开、态势总览布局被冲乱（用户两次报障同源）。
 * 完整标签与末尾残标都清；p/br/li 先转为换行保段落。 */
function _stripHtmlFields(item) {
  if (!item) return item;
  ['title', 'title_zh', 'desc', 'content', 'content_zh', 'content_en', 'excerpt'].forEach(k => {
    const v = item[k];
    if (typeof v === 'string' && v.indexOf('<') >= 0) {
      item[k] = v
        .replace(/<\/(p|li|div|h[1-6])\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/<[^>]*$/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  });
  return item;
}
/* ===== 历史旧案回顾否决（2026-08-29 根因修复）=====
 * 起因：1988 泛美103空难"审判推迟"报道（美联社/ EuroneWS）以 terror_events 橙色混进预警中心。
 * 三层误判叠加：① 全球安全态势通道"爆炸案+利比亚重点国"放行（与中国无关联也进）；
 * ② 时效闸只认新闻发布时间（报道是新的），看不到文中那个 1988；
 * ③ R-A01 民航资产规则见"航班"就关联（泛美是美国航班）。
 * 修复：标题含久远年份（≥10 年前）+ 案件/审判/纪念类词 → 判定为旧案回顾报道，非当前安全事件，
 * 一票否决（入库闸 + 前端 POST 闸 + 预警生成闸三处生效，并对存量预警队列持续清扫）。
 * 只看标题：正文常引用历史背景（"自 2001 年以来"），按正文判会大面积误杀当前事件。 */
const _HIST_CASE_RE = /案|空难|坠机|爆炸案|恐袭案|审判|裁决|判决|定罪|无罪|翻案|追诉|引渡|悬案|解密|档案|周年|纪念|悼念|遇难者|幸存者|回顾|真相|tribunal|trial|verdict|convict|acquitt|retrial|indict|anniversary|memorial|commemorat|declassified|archives?|retrospect|cold case|bombing of|crash of|downing of|massacre of|flight \d+/i;
/* 著名历史旧案专名表（无年份指代，标题不含年份也须否决）：
 * 实测 2026-08-29 洛克比案 7 条变体（"洛克比爆炸案审判因新证据推迟"等）标题无年份漏网。
 * 均为纯历史旧案专名，当前事件不会重名。 */
const _HIST_FAMOUS_RE = /洛克比|lockerbie|泛美(?:航空)? ?103|pan am (?:flight )?103|修道院门|修道院大门|abbey gate|9·11事件|9\.11事件|911事件|september 11 attack|慕尼黑惨案|munich massacre|别斯兰|beslan|MH370|马航370|马航MH370|俄克拉荷马城爆炸|oklahoma city bombing|东京地铁沙林|aum shinrikyo|沙林毒气/i;
/* 相对时间回顾标记（2026-08-29 二次根因：修道院门爆炸案 5 周年系列报道，标题是"周年纪念日/
 * 袭击后5年"式相对表述，无绝对年份，年份规则判不中） */
const _HIST_RELATIVE_RE = /(?:\d+|一|二|两|三|四|五|六|七|八|九|十)\s*年(?:之)?[后後]|周年|后\s*(?:\d+|一|二|两|三|四|五|六|七|八|九|十)\s*年|years? (?:after|on|since|later)|anniversary|\d+\s*years? later/i;
const _HIST_EVENT_RE = /案|空难|坠机|爆炸|恐袭|袭击|屠杀|惨案|遇难|attack|bombing|blast|massacre|crash|killing|strike/i;
function _isHistoricalRetrospect(it) {
  const t = String((it && it.title) || '') + ' ' + String((it && it.title_zh) || '');
  if (t.trim().length < 8) return false;
  if (_HIST_FAMOUS_RE.test(t)) return true; /* 历史旧案专名一票否决（无需年份） */
  if (_HIST_RELATIVE_RE.test(t) && _HIST_EVENT_RE.test(t)) return true; /* "N年后/周年"+袭击爆炸 → 周年回顾报道 */
  const years = t.match(/(?:19|20)\d{2}/g);
  if (!years) return false;
  const curYear = new Date().getFullYear();
  const hasOld = years.some(y => { const n = parseInt(y, 10); return n >= 1900 && n <= curYear - 10; });
  if (!hasOld) return false;
  return _HIST_CASE_RE.test(t);
}

async function _preInsertGate(it, existing, titleKeys, eventSigs) {
  const code = [];
  if (!it) return { ok: false, code: ['no-item'] };
  _stripHtmlFields(it); /* 2026-08-25：入库前去标签（见上） */
  /* chinaRelated 补判（2026-08-29 三部委审查 P2-3）：sources_pack/部分哨兵采集侧未设
   * chinaRelated → 7 天 475 条 NULL(21%)，涉华统计口径漏算近四分之一。
   * 入库闸统一补判（唯一权威点），任何通道漏设不再产生 NULL。判定与采集侧同源：crawler.chinaRelated。 */
  if (it.chinaRelated === undefined || it.chinaRelated === null) {
    const _crTxt = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.desc || it.content || '');
    it.chinaRelated = !!(crawler.chinaRelated && crawler.chinaRelated(_crTxt));
  }
  /* 2026-08-30 country 空值兜底：google_news 通道 46+ 条空国别（目标矩阵统计失真源）。
   * 标题能提取到国名时填充（首个匹配国；多国标题取先命中者——宁可信标题不信空值）。
   * 2026-08-30 二次修复：标题只含地区名（俾路支/伦敦/内罗毕）时走 _REGION_COUNTRY 地区映射。
   * 2026-08-30 三次修复（采集端 root fix）：国名/地区/查询词兜底全失败 → 涉华或国际组织条归"国际"，
   * 其余直接拒收（no-country）——空 country 条目对国别矩阵/预警两区渲染是负资产，不再积累。 */
  if (!String(it.country || '').trim()) {
    const _t = String(it.title || '') + ' ' + String(it.title_zh || '');
    const _sc = _SIG_COUNTRIES.find(x => _t.indexOf(x) >= 0) || _regionToCountry(_t);
    if (_sc) it.country = _sc;
  }
  if (!String(it.country || '').trim()) {
    const _t2 = String(it.title || '') + ' ' + String(it.title_zh || '');
    if (it.chinaRelated === true || /联合国|北约|欧盟|东盟|安理会|上合|金砖|红海|亚丁湾|霍尔木兹|马六甲|UN|NATO|European Union|ASEAN|BRICS|G7|G20/i.test(_t2)) it.country = '国际';
    else { _gateAudit('入库闸', 'no-country', it.title); return { ok: false, code: ['no-country'] }; }
  }
  const u = it.url || it.title;
  if (!u) return { ok: false, code: ['no-url-title'] };
  if (existing.has(u)) return { ok: false, code: ['url-dup'] };
  /* 删除墓碑：用户删过的数据永不再入（2026-08-22 铁律） */
  if (await _isTombstoned(it)) { _gateAudit('入库闸', 'tombstoned', it.title); return { ok: false, code: ['tombstoned'] }; }
  /* 历史旧案回顾一票否决（2026-08-29）：旧案审判/周年/解密回顾不是当前安全事件 */
  if (_isHistoricalRetrospect(it)) { _gateAudit('入库闸', 'historical', it.title); return { ok: false, code: ['historical-retrospect'] }; }
  /* 国内硬拦截：必须在所有通道生效
   * 2026-08-28 豁免修正：cnsec 哨兵条目定义上即"海外涉华人员安全事件"（interestLinked+chinaRelated 双标），
   * 中文媒体报道的海外受害新闻（如"中国公民在尼日利亚被绑架"）此前被误判国内新闻拦杀——
   * CNSEC 9 候选 3 条被此闸误杀、涉华人员条目 7 天仅 22 条的根因。 */
  const _cnsecExempt = it._cnsecWatch === true || it._sourceType === 'cnsec_watch'
    || (it._sourceType === 'wm_feed' && it.chinaRelated === true) /* 2026-08-31：WM 中国决策信号/
    走廊控制塔是涉华情报监测（chinaRelated 双标），非国内新闻；不加豁免会被国内闸误杀 4 条/日 */
    || (it._sourceType === 'threatroom' && it.chinaRelated === true); /* 2026-08-31：专项作战室检索
    中资项目/涉华实体时，涉华条目正是检索目标（如搜"华为/中老铁路"），不能当国内新闻拦杀 */
  if (!_cnsecExempt && globalmedia._isDomesticChina && globalmedia._isDomesticChina((it.title || '') + ' ' + (it.title_zh || '') + ' ' + (it.content || ''))) {
    return { ok: false, code: ['domestic-china'] };
  }
  /* 标题自动补全：残缺标题先补全，而不是直接拦截 */
  _completeTitle(it);
  /* 标题质量 */
  if (!_isTitleQualityOk(it)) return { ok: false, code: ['bad-title'] };
  /* 标题指纹 */
  const k1 = _normTitleKey(it.title);
  if (k1.length >= 10 && titleKeys.has(k1)) return { ok: false, code: ['title-dup'] };
  const k2 = _normTitleKey(it.title_zh);
  if (k2.length >= 10 && titleKeys.has(k2)) return { ok: false, code: ['title-zh-dup'] };
  /* 核心实体指纹：catch 洗稿式重复 */
  const cek = _coreEntityKey(it.title || it.title_zh);
  if (cek.length >= 15 && titleKeys.has('_cek:' + cek)) return { ok: false, code: ['entity-dup'] };
  /* 事件签名
   * 2026-08-31 快照豁免（WM-FEED 0 入库根因二）：战区/舰队/咽喉/走廊/决策信号是
   * 状态型快照（每实体每日一条，合成 URL `worldmonitor.app/wm-snapshot/<entity>/<日期>` 幂等去重），
   * 与新闻流共用事件签名空间必然互撞（US|strike|日 撞美空袭新闻 / Egypt|disruption|日 撞
   * 苏伊士新闻）。快照 URL 自带日维度幂等，跳过 sig/语义两层查重；UCDP/警示等真实事件
   * 条目（真实源 URL）照常全链查重。 */
  const _wmSnapshot = it._sourceType === 'wm_feed' && /worldmonitor\.app\/wm-snapshot\//.test(String(it.url || ''));
  /* 2026-08-31 专项作战室同源豁免：sig/语义/簇帽三层查重对研究通道全部让路——
   * 多源多版本正是专项报告素材（上合峰会 20 家媒体报道=20 条情报）；查重仍保留
   * url/title/entity 三层精确指纹（同一篇文章绝不重复入库） */
  const _trExempt = it._sourceType === 'threatroom';
  const sig = (_wmSnapshot || _trExempt) ? null : _eventSignature(it);
  if (sig && sig.indexOf('|') >= 0 && eventSigs.has(sig)) return { ok: false, code: ['event-sig-dup'] };
  /* 语义级事件查重（2026-08-30 root-cause：跨措辞/跨通道/跨日变体绕过精确查重——
   * 海地屠杀 47 死 5 天 20+ 版本 / 斯里兰卡中国公民谋杀案三版本分签的同类问题根治。
   * 同事件已有 ≥2 独立源后全拒（保留前两源供多源印证），详见 _semanticEventDup 注释。 */
  if (!_wmSnapshot && !_trExempt && await _semanticEventDup(it)) return { ok: false, code: ['event-sig-dup'] };
  /* 事件簇产量帽（2026-08-29）：同国+同类事件当日变体超 12 条拒收（防单一事件刷屏） */
  if (!_eventClusterOk(it)) { _gateAudit('入库闸', 'event-flood', it.title); return { ok: false, code: ['event-flood'] }; }
  /* 类别结构帽（2026-08-29）：安全类当日占比>45%时，非涉华非重大安全类降池（让位弱类补缺） */
  if (!(await _catStructureOk(it))) { _gateAudit('入库闸', 'cat-structure', it.title); return { ok: false, code: ['cat-structure'] }; }

  /* 多源印证：事件发生超过 6 小时后仍未被其他独立信源报道，视为不可信旧闻/单一信源噪音，暂不入库
   * 2026-08-25 豁免：白名单公众号（wechat_oa，含搜狗/profile_ext/镜像站三通道）是用户亲选的专业安全信源，
   * 独家首发内容永远等不到"多源印证"——刚果金上加丹加案 24h 内全网仅 2 家报道。保留 24h 时效闸（_isFreshEnough 另处执行）。
   * 2026-08-28 体检修正：①核心重点类目（恐袭/绑架/涉华受害/骚乱）全豁免——用户明示这些是采集核心，
   *   6h 单源窗口恰恰杀掉的就是这类"事发当天少源报道"的高价值情报（CORE-THREAT 47候选0入库真凶）；
   *  ②被拦条目写 _gate_audit 流水，不再静默消失（"采到的数据看不见"根因之一）。 */
  const _corePriority = it._cnsecWatch === true || it._sourceType === 'cnsec_watch'
    || it._sourceType === 'core_threat_watch' || it._sourceType === 'consular_watch'
    || it._sourceType === 'socmint_watch' /* 2026-08-29：社交媒体监测单源弱信号——早期预警价值恰在"无人印证"，
      6h 印证窗口对社交帖系统性误杀；用户指令要求社交数据能进预警中心 */
    || it._sourceType === 'project_watch' /* 2026-08-29：重点项目动态是采集核心（审计维度③），
      项目新闻多为小众单源（CPEC 工作组会议全网 1-2 家），6h 印证窗口恰恰杀掉的就是这类高价值项目情报 */
    || _wmSnapshot /* 2026-08-31：WM 状态快照（战区/舰队/咽喉/走廊）是 WorldMonitor 独家聚合，
      天然等不到"其他独立源印证"；时效由 trustPubDate 白名单+URL 日幂等保证 */
    || it._sourceType === 'threatroom' /* 2026-08-31：专项作战室是 7 天回顾性研究——窗口内大量
      条目发布已超 6h，小国/新组织事件常全网仅 1-2 源，印证窗口会系统性误杀专项素材 */
    || _isCorePriorityText(it);
  if (!_corePriority && it._sourceType !== 'wechat_oa' && it._sourceType !== 'wechat_lead') {
    const age = _getEventAgeMs(it);
    if (age > CORROBORATION_WINDOW_MS) {
      const corroborated = await _hasCorroboration(sig, 48);
      if (!corroborated) {
        _gateAudit('入库闸', 'stale-single-source', it.title);
        return { ok: false, code: ['stale-single-source'] };
      }
    }
  }

  return { ok: true, code, sig, cek };
}
/* 核心重点类目判定（2026-08-28 用户指令：恐袭/恐组动态/绑架/骚乱群体性事件/涉华负面/涉华矿业 为采集核心） */
function _isCorePriorityText(it) {
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.desc || '').slice(0, 300);
  return /绑架|劫持|人质|赎金|恐袭|恐怖袭击|恐怖组织|武装袭击|自杀式|爆炸装置|骚乱|群体性事件|暴乱|打砸| riot|kidnap|hostage|ransom|terror attack|suicide bomb|mass abduct/i.test(t)
    || (/中国公民|中方人员|中国工人|中国工程师|中国留学生|华人|华侨|中资|中企|Chinese (?:citizen|worker|engineer|nationals?)/i.test(t) && /被袭|遇袭|遭袭|遇害|身亡|遇难|被杀|死亡|失踪|被拘|被捕|扣押|袭击|绑架|抢劫|遇难|抗议|示威|驱逐|制裁|审查|关停|冲突|纠纷|罢工|绑架案/i.test(t))
    || /矿业|矿场|矿区|金矿|铜矿|锂矿|铁矿|钴矿|镍矿|中资矿|mine|mining (?:company|site|licence|concession)/i.test(t) && /中国|中资|中企|Chinese|China/i.test(t);
}
function _preInsertCommit(it, existing, titleKeys, eventSigs, gateResult) {
  const u = it.url || it.title;
  if (u) existing.add(u);
  _addTitleKey(titleKeys, it);
  if (gateResult && gateResult.cek && gateResult.cek.length >= 15) titleKeys.add('_cek:' + gateResult.cek);
  if (gateResult && gateResult.sig && gateResult.sig.indexOf('|') >= 0) eventSigs.add(gateResult.sig);
  it._eventSig = (gateResult && gateResult.sig) || it._eventSig || '';
}
/* ===== 时效硬闸门（2026-08-13 用户铁律：预警系统只采近 48 小时的数据）=====
 * 旧闻（如 4 月的中粮巴西建厂、6 天前的联合国新闻）没有预警价值。
 * 能解析出发布日期且超过 48 小时 → 拦截；解析不出日期 → 放行（不误杀无日期源）。 */
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
/* 2026-08-29 用户指令：社交媒体监测（socmint_watch）采集的库里没有的数据，时限放宽到 60 小时。
 * 社交平台话题热度周期长于新闻（持续讨论 2-3 天常态），24h 闸对社交帖系统性误杀
 * （实测单轮 165 条关联数据 147 条被"超时旧闻"拦掉，其中大量为 24-60h 活跃讨论）。
 * URL/标题/事件签名去重闸仍在——库中已有的条目不会因窗口放宽重复入库。 */
const SOCMINT_FRESH_WINDOW_MS = 60 * 60 * 60 * 1000;
function _freshWindowFor(it) {
  return (it && it._sourceType === 'socmint_watch') ? SOCMINT_FRESH_WINDOW_MS : FRESH_WINDOW_MS;
}
const CORROBORATION_WINDOW_MS = 6 * 60 * 60 * 1000; /* 6小时内单源可放行；超过6小时需多源印证

/* ===== 俄乌冲突配额（2026-08-15 建；2026-08-29 三部委审查 P1-2 收紧）=====
 * 旧版：配额 30 条/日内无条件放行 → 实测 7 天入库 145 条(5.2%)，日均仅 ~20 条，
 *       配额从未压满，闸形同虚设；大半是前线战报/歼敌战果/领导人日常会见类纯战况。
 * 新版四层：
 *  ① 涉华/中资关联 → 无条件放行（旧版只测 title，title_zh 涉华词漏判已修）；
 *  ② 顶级事件（伤亡≥5人/核/撤侨/大规模）→ 无条件放行；
 *  ③ 重要事件（伤亡/平民设施/能源设施/粮食走廊/制裁/和谈）→ 消耗 15 条/日配额；
 *  ④ 纯战况琐事（战报更新/歼敌数/日常会见/宇航员等）→ 一律拒收，不看配额。 */
let _ruUaCount = 0, _ruUaDate = '';
let _ruUaDb = { date: '', n: 0, t: 0 };
const RUUA_DAILY_CAP = 15;
const _RUUA_RE = /乌克兰|俄罗斯|Ukraine|Ukrainian|Russia|Russian|Kyiv|Kiev|Moscow|Zelensky|Putin|Donetsk|Donbas|Kharkiv|Belgorod|Kherson|Zaporizhzhia|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯|顿涅茨克|赫尔松|TASS|Euromaidan/i;
const _RUUA_CN_RE = /中国|中资|中企|中方|华人|华侨|北京|Beijing|Chinese|China/i;
/* 重要事件：有情报价值才消耗配额——伤亡/平民设施/能源炼油/粮食走廊/制裁和谈 */
const _RUUA_IMPORTANT_RE = /死亡|遇难|身亡|丧生|伤亡|受伤|伤员|killed|dead|deaths|injur|casualt|平民|civilian|学校|医院|儿童|核|nuclear|粮食|谷物|港口|能源|石油|天然气|炼油|制裁|谈判|停火|和谈|和平|峰会|grain|port|refiner|oil|gas|energy|sanction|talks|ceasefire|peace|summit/i;
function _isRuUaTopic(it) {
  return _RUUA_RE.test(String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.source || ''));
}
async function _ruUaRefreshDbCount() {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { rows } = await query(`SELECT COUNT(*) c FROM intel_data WHERE collect_time >= $1 AND (
      title ~* '乌克兰|俄罗斯|Ukraine|Ukrainian|Russia|Russian|Kyiv|Moscow|Zelensky|Putin|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯'
      OR data_json->>'title_zh' ~* '乌克兰|俄罗斯|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯')`, [dayStart]);
    _ruUaDb = { date: _todayKey(), n: parseInt(rows[0].c, 10) || 0, t: Date.now() };
  } catch (e) {}
}
/* ===== 内容分类 + 级别归一 + 中资资产标签（2026-08-13 体检 P0 整改）=====
 * P0-1：入库时按内容分到 12 类 data_type（此前 95% 堆在 osint_intel，分类视图全空）
 * P0-2：severity 归一为 red/orange/yellow/blue 四级（此前"中/low/high/red"五套值混用）
 * P1-5：命中中资资产档案打 asset_tags；资产+严重事件 = 红色（视同直接涉华） */
/* 分类器 v2（2026-08-17 用户指令：什么数据放什么类别，别乱放）：
 * ① 标题优先——标题能定类就用标题，正文只作兜底（正文提及≠事件本体）；
 * ② 综述/评论/分析体裁前置——非事件类内容归地缘情报，不占事件类席位；
 * ③ 去掉 ied 裸匹配——ied 是 denied/studied/allied 的子串，曾经把一切含 denied 的文章误判成恐袭。 */
const _CLS_RULES = [
  ['terror_events', /恐袭|恐怖|爆炸|绑架|劫持|人质|自杀式|枪手|武装分子|伏击|塔利班|基地组织|博科|青年党|terror|bomb|blast|explosion|kidnap|hostage|gunmen|militant|suicide bomb|vbied|car bomb|ambush|isis|isil|taliban|qaeda|al-shabaab|boko haram/i],
  ['sanctions_data', /制裁|关税|出口管制|实体清单|黑名单|反倾销|反补贴|禁运|安全审查|sanction|tariff|export control|entity list|blacklist|anti-dumping|countervailing|embargo|cfius|uflpa/i],
  ['public_health', /疫情|病毒|传染病|霍乱|埃博拉|outbreak|epidemic|pandemic|virus|cholera|ebola|mpox/i],
  ['cyber_security', /网络攻击|数据泄露|勒索软件|黑客|漏洞利用|cyberattack|cyber attack|data breach|ransomware|malware|phishing|cve-|ddos/i],
  ['legal_compliance', /诉讼|仲裁|罚款|处罚|合规审查|监管|lawsuit|litigation|arbitration|penalty|compliance|regulatory|antitrust/i],
  ['economic_risk', /债务危机|通胀|汇率|金融|衰退|股市|央行|利率|debt crisis|inflation|recession|default|currency|central bank|interest rate|stock market/i],
  ['social_unrest', /抗议|示威|骚乱|暴动|罢工|宵禁|protest|riot|unrest|strike action|curfew|demonstration/i],
  ['political_events', /政变|军政府|选举|弹劾|政权更迭|coup|junta|election|impeach|president-elect|parliament/i],
  ['military_conflicts', /战争|空袭|导弹|交火|停火|炮击|无人机|军事行动|战线|war|airstrike|missile|ceasefire|shelling|artillery|drone strike|offensive|frontline/i],
  ['natural_disasters', /地震|洪水|台风|飓风|暴雨|海啸|火山|山火|earthquake|flood|typhoon|hurricane|tsunami|volcano|wildfire|cyclone/i],
  ['infrastructure', /港口|矿山|管道|铁路|大桥|电站|供应链|关键矿产|稀土|port|mine|mining|pipeline|railway|bridge|power plant|supply chain|critical mineral|rare earth|lithium|cobalt/i],
  ['security_events', /枪击|抢劫|谋杀|治安|被捕|shooting|robbery|murder|arrest/i],
  ['geopolitical_intel', /外交|会晤|协议|争端|紧张|沙文主义|diplomat|summit|treaty|dispute|tension|chauvinism/i]
];
const _CLS_GENRE_RE = /综述|社评|专栏|观察家|深度分析|盘点|回顾|展望|解读|民调|民意调查|支持率|批准率|批判性考察|opinion|editorial|analysis|review of|commentary|explained|chauvinism|opinion poll|approval rating|survey/i;
function _classifyIntelType(it) {
  const title = (String(it.title || '') + ' ' + String(it.title_zh || '')).toLowerCase();
  const all = title + ' ' + String(it.content || '').toLowerCase();
  if (_CLS_GENRE_RE.test(title) && !/爆炸|袭击|枪击|绑架|劫持|恐袭|地震|blast|attack|shooting|kidnap|hostage|killed/i.test(title)) {
    return 'geopolitical_intel';
  }
  for (const [type, re] of _CLS_RULES) { if (re.test(title)) return type; }
  for (const [type, re] of _CLS_RULES) { if (re.test(all)) return type; }
  return 'geopolitical_intel'; /* 2026-08-17 用户指令：取消开源情报泛类——无明确类别信号的全球动态归地缘情报 */
}
function _classifyIntelType_legacy(it) {
  const t = (String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || '')).toLowerCase();
  if (/恐袭|恐怖|爆炸|绑架|劫持|人质|自杀式|枪手|武装分子|伏击|塔利班|基地组织|博科|青年党|terror|bomb|blast|explosion|kidnap|hostage|gunmen|militant|suicide|vbied|ied|ambush|isis|isil|taliban|qaeda|al-shabaab|boko haram/i.test(t)) return 'terror_events';
  if (/制裁|关税|出口管制|实体清单|黑名单|反倾销|反补贴|禁运|合规|安全审查|sanction|tariff|export control|entity list|blacklist|anti-dumping|countervailing|embargo|cfius|compliance|wro|uflpa/i.test(t)) return 'sanctions_data';
  if (/疫情|病毒|传染病|霍乱|埃博拉|outbreak|epidemic|pandemic|virus|cholera|ebola|mpox/i.test(t)) return 'public_health';
  if (/网络攻击|数据泄露|勒索软件|黑客|漏洞利用|cyberattack|cyber attack|data breach|ransomware|malware|phishing|cve-|ddos/i.test(t)) return 'cyber_security';
  if (/诉讼|仲裁|罚款|处罚|合规审查|监管|lawsuit|litigation|arbitration|fine[ds]?|penalty|compliance|regulatory|antitrust/i.test(t)) return 'legal_compliance';
  if (/债务危机|通胀|汇率|金融|衰退|股市|央行|利率|debt crisis|inflation|recession|default|currency|central bank|interest rate|stock market/i.test(t)) return 'economic_risk';
  if (/抗议|示威|骚乱|暴动|罢工|宵禁|protest|riot|unrest|strike action|curfew|demonstration/i.test(t)) return 'social_unrest';
  if (/政变|军政府|选举|弹劾|政权更迭|coup|junta|election|impeach|president-elect|parliament/i.test(t)) return 'political_events';
  if (/战争|空袭|导弹|交火|停火|炮击|无人机|军事行动|战线|war|airstrike|missile|ceasefire|shelling|artillery|drone strike|offensive|frontline/i.test(t)) return 'military_conflicts';
  if (/地震|洪水|台风|飓风|暴雨|海啸|火山|山火|earthquake|flood|typhoon|hurricane|tsunami|volcano|wildfire|cyclone/i.test(t)) return 'natural_disasters';
  if (/港口|矿山|管道|铁路|大桥|电站|供应链|关键矿产|稀土|port|mine|mining|pipeline|railway|bridge|power plant|supply chain|critical mineral|rare earth|lithium|cobalt/i.test(t)) return 'infrastructure';
  if (/枪击|抢劫|谋杀|治安|被捕|shooting|robbery|murder|arrest/i.test(t)) return 'security_events';
  if (/外交|会晤|协议|争端|紧张|diplomat|summit|treaty|dispute|tension/i.test(t)) return 'geopolitical_intel';
  return 'osint_intel';
}

/* 中资海外资产档案（涉华安全预警的锚点，持续扩充） */
const ASSET_PROFILES = [
  { name: '瓜达尔港', re: /瓜达尔|gwadar/i },
  { name: '中巴经济走廊', re: /中巴经济走廊|cpec|china-pakistan economic corridor/i },
  { name: '汉班托塔港', re: /汉班托塔|hambantota/i },
  { name: '比雷埃夫斯港', re: /比雷埃夫斯|piraeus/i },
  { name: '皎漂港', re: /皎漂|kyaukpyu/i },
  { name: '中老铁路', re: /中老铁路|china-laos railway/i },
  { name: '雅万高铁', re: /雅万|jakarta-bandung|whoosh/i },
  { name: '蒙内铁路', re: /蒙内铁路|mombasa-nairobi|sgr/i },
  { name: '亚吉铁路', re: /亚吉铁路|addis ababa-djibouti/i },
  { name: '钱凯港', re: /钱凯|chancay/i },
  { name: '科伦坡港口城', re: /科伦坡港口城|colombo port city/i },
  { name: '中白工业园', re: /中白工业园|great stone/i },
  { name: '吉布提保障基地', re: /吉布提.*基地|djibouti.*base/i },
  { name: '莱基深水港', re: /莱基|lekki/i },
  { name: '坦赞铁路', re: /坦赞铁路|tazara/i },
  { name: '马来东海岸铁路', re: /马来.*东铁|东海岸铁路|ecrl|east coast rail/i },
  { name: '西芒杜铁矿', re: /西芒杜|simandou/i },
  { name: '卡莫阿铜矿', re: /卡莫阿|kamoa/i },
  { name: '拉姆镍矿', re: /拉姆镍|ramu/i },
  { name: '苏伊士经贸合作区', re: /苏伊士.*经贸|teda/i }
];
/* ===== 核心威胁标记引擎（2026-08-28 用户指令：预警中心重点体现十大核心威胁）=====
 * 涉华人员机构袭击/绑架/劫持、海盗、恐袭、局部冲突、政变、航运安全、
 * 外资审查、出口管制、制裁清单——命中即打 core_threat 标签（预警中心置顶专区依据）。 */
const CORE_THREAT_RULES = [
  { k: 'cn_victim', n: '涉华人员/机构受害', re: /(中国(?:公民|工人|工程师|留学生|游客|女子|船员|矿工)|中方人员|华人|华侨|中资企业|中企|中国公司|Chinese (?:citizen|worker|engineer|national|company)|China[- ]owned)[^。；]{0,30}(被袭|遇袭|遭袭|被绑|绑架|劫持|身亡|遇难|被杀|遇害|失踪|被扣|被拘|袭击|抢劫|killed|kidnapped|abducted|attacked|detained)|(?:袭击|绑架|劫持|杀害|抢劫|扣押)[^。；]{0,30}(中国(?:公民|工人|工程师)|中方人员|华人|华侨|中资企业)/i },
  { k: 'piracy', n: '海盗事件', re: /海盗|piracy|pirates|劫船|seajack/i },
  { k: 'terror', n: '恐怖袭击', re: /恐袭|恐怖袭击|自杀式爆炸|汽车炸弹|枪击事件|自杀式|bomb (?:blast|attack|explodes)|suicide bomb|terror attack|ISIS|Taliban|Boko Haram|Al[- ]?Shabaab|博科圣地|塔利班|伊斯兰国|极端组织武装/i },
  { k: 'conflict', n: '局部冲突', re: /武装冲突|交火|炮击|空袭|战事|clashes? (?:erupt|between|kill)|armed conflict|shelling|airstrike|militants? (?:attack|kill)|叛军|反政府武装/i },
  { k: 'coup', n: '政变/政局突变', re: /政变|兵变|coup|军人接管|军政府|戒严|martial law|总统被废|解散议会|emergency decree/i },
  { k: 'maritime', n: '航运安全事件', re: /油轮|货轮|商船|集装箱船|航运中断|航线暂停|海峡封锁|沉船|船只遇险|tanker (?:attack|hit|seized)|vessel (?:attacked|hijacked|sank)|strait (?:closed|blockade)|shipping (?:disrupted|halted)|苏伊士|霍尔木兹|马六甲|红海航运|曼德海峡/i },
  { k: 'investment_screening', n: '东道国外资审查', re: /外资审查|投资审查|投资安全审查|CFIUS|foreign investment (?:screening|review|restriction)|investment screening|国家安全审查|外资准入|外资限制/i },
  { k: 'export_control', n: '出口管制', re: /出口管制|export (?:control|restriction|ban)|技术管制|两用物项|dual[- ]use|半导体禁令|chip (?:ban|export control)|实体清单管制/i },
  { k: 'sanctions', n: '制裁清单', re: /实体清单|SDN|黑名单|制裁清单|OFAC|新增制裁|列入制裁|designated sanctions|unreliable entity|不可靠实体/i },
  { k: 'kidnap_any', n: '绑架/劫持事件', re: /绑架|劫持人质|绑匪|赎金|kidnapp|abduction|hostage|ransom demand/i }
];
function _tagCoreThreat(it) {
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.desc || it.description || '').slice(0, 400);
  const hits = [];
  for (const r of CORE_THREAT_RULES) { if (r.re.test(t)) hits.push(r.k); }
  if (hits.length) {
    it.core_threat = hits[0];            /* 主类 */
    it.core_threat_tags = hits;          /* 全部命中 */
    it.core_threat_name = CORE_THREAT_RULES.find(r => r.k === hits[0]).n;
  }
  return hits;
}

function _tagAssets(it) {
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || '');
  const hits = [];
  for (const a of ASSET_PROFILES) { if (a.re.test(t)) hits.push(a.name); }
  if (hits.length) it.asset_tags = hits;
  /* 核心威胁标记（2026-08-28）：十大核心威胁命中即打标签——预警中心置顶专区依据 */
  try { _tagCoreThreat(it); } catch (e) {}
  /* ===== 2026-08-28 海外利益底数标签（官方框架五维全挂）=====
   * 每条情报自动锚定：重点项目（六大类）/海上通道/国家梯队/经济暴露/人员足迹/东道国风险指标。
   * 这是"事件→利益受损研判"的底数锚点：命中越多，利益暴露越重。 */
  try {
    const ib = INTEREST_BASE;
    const projects = ib.matchProjects(t);
    if (projects.length) it.interest_projects = projects.map(p => p.name);
    const channels = ib.matchChannels(t);
    if (channels.length) it.channel_tags = channels.map(c => c.name);
    const ctry = String(it.country || it.country_cn || '');
    if (ctry) {
      const tier = ib.getTier(ctry);
      if (tier) {
        it.interest_tier = tier;
        const prof = (ib.COUNTRY_TIERS[tier] || []).find(x => ctry.indexOf(x.cn) >= 0 || x.cn.indexOf(ctry) >= 0);
        if (prof) {
          it.interest_anchor = prof.interests;          /* 该国核心利益锚点 */
          it.risk_profile = prof.risks;                 /* 该国主要威胁 */
        }
      }
      const expo = ib.ECONOMIC_BASE.countryExposure(ctry);
      if (expo) it.econ_exposure = expo.name + ' ODI' + expo.share;   /* 经济利益暴露 */
      const foot = ib.PERSONNEL_BASE.footprintOf(ctry);
      if (foot) it.personnel_footprint = foot;          /* 人员机构足迹 */
      const risk = ib.COUNTRY_RISK_INDICATORS.riskOf(ctry);
      if (risk) it.country_risk_indicators = risk;      /* 四维风险指标 */
    }
  } catch (e) {}
  /* 2026-08-25 要素补全（用户指令：数据要素不全——实测近3天入库条目 factSheet 缺失率 100%）。
   * extractFacts 纯正则零网络，在 中文标题+中文正文+原文 上抽取伤亡/行为体/事件性质/中方主体/
   * 金额/时间/处置并附原句佐证，写入 factSheet 供前端详情卡片、detailed 判定与风险分级使用。 */
  try {
    if (!it.factSheet && fulltext && typeof fulltext.extractFacts === 'function') {
      const corpus = String(it.title_zh || '') + '。' + String(it.content_zh || '') + '。'
                   + String(it.title || '') + '。' + String(it.content || it.description || it.desc || '');
      const fs_ = fulltext.extractFacts(corpus);
      if (fs_ && fs_.facts && fs_.facts.length) {
        it.factSheet = fs_;
        it.hasCasualty = fs_.hasCasualty;
        if (fs_.incidentTypes && fs_.incidentTypes.length && !it.incidentTypes) it.incidentTypes = fs_.incidentTypes;
        if (fs_.actors && fs_.actors.length && !it.threatActors) it.threatActors = fs_.actors;
      }
    }
  } catch (e) {}
  /* 2026-08-18 注：曾尝试用正则从事发标题自动纠正 country（来源国→事发国），但正则无法可靠区分
   * 行为主体国与事发地（如"美国制裁北极LNG"事发在俄而非美；且"索马里"含"马里"子串误判）。
   * 故不在入库时改 country（保留来源国），事发国由前端 distribute._extractCountryFromText 在显示时提取。 */
  return hits;
}

/* ===== 0-100 赋分分级预警（2026-08-26 用户指令：赋分改革，绿/黄/红三区，杜绝动辄红色）=====
 * 模型：entities.js assessRisk 多因子引擎（威胁类型×资产权重×中资主体×项目层级×国别基线×时效×信源×涉华负面）
 * 分区：绿区 0-30（正常运营）/ 黄区 31-60（加强安保）/ 红区 61-100（应急预案+考虑撤离）。
 * 红区硬约束 R-Z01：61+ 必须直接命中中资主体/项目/核心资产，或中方人员伤亡/绑架（R-T01/R-T02），
 * 或涉华重大伤亡（≥5死）；非涉华重大伤亡（≥10死）仅提级黄区上沿（态势关注），永不入红。
 * 旧逻辑"涉华+严重词即红"已废弃——那是"动辄红色"的根因。 */
const ZONE_ACTIONS = {
  green: '绿区（0-30分）：正常运营，无需特殊防护，保持常态关注。',
  yellow: '黄区（31-60分）：加强安保巡逻，限制人员外出，密切关注事态发展，做好应急准备。',
  red: '红区（61-100分）：立即启动应急预案，视情考虑人员撤离，与驻外使领馆保持24小时通联。'
};
function _scoreRiskItem(it) {
  const r = ENTITY.assessRisk({
    title: String(it.title || '') + ' ' + String(it.title_zh || ''),
    content: String(it.content_zh || '') + ' ' + String(it.content || it.desc || it.description || ''),
    country: it.country || it.country_cn || '',
    source: it.source || '', platform: it.platform || '',
    publishedAt: it.publishedAt || it.pubDate || it.collect_time || '',
    chinaNegative: it._chinaNegative === true || it.chinaNegative === true
  });
  let score = r.riskScore;
  const hits = (r.ruleHits || []).slice();
  const hitIds = hits.map(h => h.rule);
  const ent = r.entities || { enterprises: [], projects: [], assets: [] };
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.desc || '').slice(0, 300);
  const chinaSig = /中国|中资|中企|中方|华人|华侨|华裔|中国公民|留学生|一带一路|中国使领馆|中国驻|撤侨|Chinese|China|CPEC/i.test(t)
    || ent.enterprises.length > 0 || ent.projects.length > 0 || (it.asset_tags && it.asset_tags.length > 0);
  const cm = t.match(/(\d{1,4})\s*(?:名|人|个)?\s*(?:死亡|身亡|遇难|丧生|被打死|被击毙)/) ||
             t.match(/(\d{1,4})\s*(?:people\s+)?(?:killed|dead|deaths)/i) ||
             t.match(/(?:death toll|kills)\s*(\d{1,4})/i);
  const deaths = cm ? parseInt(cm[1], 10) : 0;
  /* 2026-08-27 红区铁律：仅以下四类可入红区，其余一律不准红色。
   * 1) 中国公民/中方人员/华人华侨被袭击；2) 中国公民/中方人员/华人华侨被绑架；
   * 3) 撤侨/撤离中国公民；4) 群体开枪/大规模枪击且涉中方人员。
   * 其他情形（普通重大伤亡、工厂火灾、自然灾害、制裁表态等）最高橙区。 */
  /* 2026-08-28 体检复盘扩充主体词：中国游客/中国女子/中国妇女/中国工程师/中国学生/中资企业员工；
   * 扩充受害谓词：被武装人员带走/被带走（绑架变体）、遇害/被杀害/被杀/被枪杀（暴力致死）、
   * 被逮捕换位宾语结构。误杀案例：刚果金中国公民被武装带走、泰国中国游客被绑架、韩留学生遇害。 */
  /* 2026-08-29 三部委审查根因修复：实测 9 个真实案例仅 1 命中——外文标题 6/6 全漏
   * （正则无英文分支），中文死亡谓词缺失（"6名中国公民死亡"MISS）。
   * 补：①中文谓词加 死亡|身亡|遇难|丧生|下落不明；②英文双向分支 Chinese+nationals/workers/
   * citizens/engineers/tourists/students × kidnapped/abducted/killed/attacked/shot/evacuated。 */
  const RED_ELIGIBLE_RE = /(?:中国公民|中方人员|中国工人|中国工程师|中国留学生|中国学生|中国游客|中国女子|中国妇女|中资企业员工|华人|华侨|华裔)[^，。；;]{0,25}(?:被袭|遭袭|受袭|遇袭|被袭击|被绑|遭绑架|被绑架|遭劫持|被劫持|被武装人员带走|被带走|被枪杀|被击毙|被杀害|遇害|被杀|遭杀害|遇刺|枪击|死亡|身亡|遇难|丧生|绑架|劫持|谋杀)|(?:遭绑架|被绑架|绑架|劫持|袭击|袭击造成|杀害|枪杀|绑架了|死亡|身亡|遇难)[^，。；;]{0,30}(?:中国公民|中方人员|中国工人|中国工程师|中国留学生|中国学生|中国游客|中国女子|中国妇女|中资企业员工|华人|华侨|华裔)|撤侨|撤离[^，。；;]{0,20}中国公民|遣返[^，。；;]{0,20}中国公民|群体开枪|大规模枪击|(?:chinese|china'?s?)[^,.!?;]{0,50}(?:nationals?|citizens?|workers?|engineers?|tourists?|students?|nationals|woman|man|people)[^,.!?;]{0,60}(?:kidnapp|abduct|attack|kill|shot|shoot|murder|dead|died|death|evacuat|injur)|(?:kidnapp|abduct|attack|kill|shot|shoot|murder|evacuat)[^,.!?;]{0,60}(?:chinese|china'?s?)[^,.!?;]{0,50}(?:nationals?|citizens?|workers?|engineers?|tourists?|students?|woman|man|people)|china[^,.!?;]{0,30}evacuat|evacuat[^,.!?;]{0,40}(?:chinese|china)/i;
  const redEligible = RED_ELIGIBLE_RE.test(t);
  if (score >= 61 && !redEligible) {
    hits.push({ rule: 'R-Z05', name: '红区硬约束：仅中国公民被袭击/绑架/撤侨/群体开枪可入红，压至橙区上沿', add: 60 - score });
    score = 60;
  }
  if (redEligible && score < 61) {
    hits.push({ rule: 'R-Z06', name: '红区触发：命中中国公民被袭击/绑架/撤侨/群体开枪', add: 61 - score });
    score = 61;
  }
  /* 制裁/出口管制(R-T09)一律不准入红 */
  const topThreat = (hits[0] && hits[0].rule) || '';
  if (topThreat === 'R-T09' && score >= 61 && !redEligible) {
    hits.push({ rule: 'R-Z04', name: '制裁类硬约束：一律不准入红', add: 55 - score });
    score = 55;
  }
  /* 非涉华重大伤亡（≥10死）：态势关注，提至黄区上沿，但永不入红 */
  if (!chinaSig && deaths >= 10 && score < 46) {
    hits.push({ rule: 'R-Z02', name: '非涉华重大伤亡（' + deaths + '死），提级黄区态势关注', add: 46 - score });
    score = 46;
  }
  /* 涉华实质非暴力威胁（征收/制裁/法律/用工）：未命中具体企业库时被弱关联约束压到蓝区，
   * 但此类威胁对中资经营有实际影响，提至黄区下沿（40分）确保可见 */
  const SUBSTANTIVE_NONVIOLENT = ['R-T08', 'R-T09', 'R-T15', 'R-T19'];
  if (chinaSig && hitIds.some(id => SUBSTANTIVE_NONVIOLENT.indexOf(id) >= 0) && score < 40) {
    hits.push({ rule: 'R-Z03', name: '涉华实质威胁（征收/制裁/法律/用工），提级黄区下沿', add: 40 - score });
    score = 40;
  }
  /* ===== 2026-08-28 海外利益暴露加权（官方框架底数锚点）=====
   * 事件落在利益底数上的权重：第一梯队国 +8、第二梯队 +4；命中重点项目 +6；
   * 命中海上战略通道 +5；东道国公共安全指标≥8 +3。加权不突破红区铁律（R-Z05 仍最后执行）。 */
  try {
    const _bump = v => { if (score < 61) score = Math.min(60, score + v); };  /* 只加不降：红区条目不受影响 */
    if (it.interest_tier === 'TIER1') { _bump(8); hits.push({ rule: 'R-IB1', name: '第一梯队利益国（利益极重+风险极高）', add: 8 }); }
    else if (it.interest_tier === 'TIER2') { _bump(4); hits.push({ rule: 'R-IB2', name: '第二梯队利益国', add: 4 }); }
    if (it.interest_projects && it.interest_projects.length) { _bump(6); hits.push({ rule: 'R-IB3', name: '命中重点项目：' + it.interest_projects.join('、'), add: 6 }); }
    if (it.channel_tags && it.channel_tags.length) { _bump(5); hits.push({ rule: 'R-IB4', name: '涉及海上战略通道：' + it.channel_tags.join('、'), add: 5 }); }
    if (it.country_risk_indicators && (it.country_risk_indicators.security >= 8 || it.country_risk_indicators.political >= 8)) { _bump(3); hits.push({ rule: 'R-IB5', name: '东道国风险指标高危（政治/公共安全≥8）', add: 3 }); }
  } catch (e) {}
  /* 核心威胁加权（2026-08-28 用户指令：十大核心威胁是预警中心重点）：
   * 涉华受害 +10（最高优先）；恐袭/绑架/海盗/冲突/政变/航运/制裁类 +5。
   * 只加不降，红区铁律仍最后执行。 */
  try {
    const _bump2 = v => { if (score < 61) score = Math.min(60, score + v); };
    const tags = it.core_threat_tags || [];
    if (tags.includes('cn_victim')) { _bump2(10); hits.push({ rule: 'R-CT1', name: '核心威胁：涉华人员/机构受害', add: 10 }); }
    else if (tags.length) { _bump2(5); hits.push({ rule: 'R-CT2', name: '核心威胁：' + (it.core_threat_name || tags.join('/')), add: 5 }); }
  } catch (e) {}
  const zone = score >= 61 ? 'red' : score >= 31 ? 'yellow' : 'green';
  const level = score >= 61 ? 'red' : score >= 46 ? 'orange' : score >= 31 ? 'yellow' : 'blue';
  return { score: score, zone: zone, level: level,
    rationale: hits.map(h => h.name + '(' + (h.add > 0 ? '+' : '') + h.add + ')').join('；'),
    action: ZONE_ACTIONS[zone] };
}
function _normLevelForStore(it) {
  try {
    const s = _scoreRiskItem(it);
    it.risk_score = s.score; it.risk_zone = s.zone; it.risk_rationale = s.rationale; it.zone_action = s.action;
    return s.level;
  } catch (e) {
    /* 兜底：评分引擎异常时走保守默认，同样不再"涉华+严重即红" */
    const t = String(it.title || '') + ' ' + String(it.title_zh || '');
    const severe = /死亡|伤亡|遇害|遇难|绑架|人质|劫持|带走|掳走|劫走|恐袭|爆炸|空袭|枪击|战争|政变|屠杀|撤侨|killed|deadly|bombing|blast|hostage|kidnap|airstrike|massacre|\bcoup\b/i.test(t);
    if (severe) return 'orange';
    if (/袭击|冲突|骚乱|抗议|制裁|封锁|限制|风险|威胁|紧张|摩擦|争端|审查|调查|批评|attack|clash|protest|sanction|risk|threat|tension|probe|review/i.test(t)) return 'yellow';
    return 'blue';
  }
}

function _ruUaQuotaOk(it) {
  const d = _todayKey();
  if (_ruUaDate !== d) { _ruUaDate = d; _ruUaCount = 0; }
  if (!_isRuUaTopic(it)) return true;
  const txt = String(it.title || '') + ' ' + String(it.title_zh || '');
  /* ① 涉华/中资关联：无条件放行（title+title_zh 双测，旧版漏 title_zh） */
  if (_RUUA_CN_RE.test(txt)) { _ruUaCount++; return true; }
  /* DB 计数 5 分钟异步刷新（服务重启内存清零也不失控） */
  if (_ruUaDb.date !== d || Date.now() - _ruUaDb.t > 5 * 60 * 1000) { _ruUaDb.t = Date.now(); _ruUaRefreshDbCount(); }
  /* ② 顶级事件：伤亡≥5人 / 核 / 撤侨 / 大规模 → 不受配额限制 */
  const dm = txt.match(/(\d+)\s*(?:人|名)?\s*(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
  if ((dm && parseInt(dm[1] || dm[2], 10) >= 5) || /撤侨|evacuat|核|nuclear|重大|大规模|mass /i.test(txt)) { _ruUaCount++; return true; }
  /* ④ 纯战况琐事：无伤亡/无涉华/无战略要素 → 一律拒收（即使配额未满） */
  if (!_RUUA_IMPORTANT_RE.test(txt)) return false;
  /* ③ 重要事件：消耗 15 条/日配额 */
  const todayTotal = (_ruUaDb.date === d ? _ruUaDb.n : 0) + _ruUaCount;
  if (todayTotal < RUUA_DAILY_CAP) { _ruUaCount++; return true; }
  return false;
}
/* ===== 高发国家日配额（2026-08-17 用户指令：采集全球均衡）=====
 * 伊朗/美国/巴基斯坦等高产国：非涉华条目达日配额即停收（涉华/重大伤亡豁免）。
 * 与俄乌配额同思路：保证拉美/非洲/中亚/欧洲在库里有位置。 */
/* ===== 高发国家日配额（2026-08-17 用户指令：采集全球均衡；2026-08-28 复盘加帽）=====
 * 伊朗/美国/巴基斯坦等高产国：非涉华条目达日配额即停收（涉华/重大伤亡豁免）。
 * 与俄乌配额同思路：保证拉美/非洲/中亚/欧洲在库里有位置。
 * 2026-08-28 实测 24h 分布（尼泊尔50/尼日利亚47/巴基斯坦40/伊朗38/印度35）后：
 * 新增 尼泊尔/尼日利亚/印度 三国帽，伊朗 45→35。 */
const DOMINANT_DAILY_CAP = { '伊朗': 35, '美国': 45, '巴基斯坦': 55, '阿富汗': 45, '巴勒斯坦': 30, '以色列': 25, '尼泊尔': 40, '尼日利亚': 40, '印度': 40 };
const _domCounts = { date: '', by: {}, t: 0 };
function _dominantQuotaOk(it) {
  const ctry = String(it.country || it.country_cn || '');
  const cap = Object.keys(DOMINANT_DAILY_CAP).find(c => ctry.indexOf(c) >= 0);
  if (!cap) return true;
  const d = _todayKey();
  if (_domCounts.date !== d) { _domCounts.date = d; _domCounts.by = {}; }
  /* 涉华/重大伤亡豁免 */
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || '');
  if (/中国|中资|中企|中方|华人|一带一路|涉华|Chinese|China|CPEC/i.test(t)) return true;
  const dm = t.match(/(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
  if (dm && parseInt(dm[1] || dm[2], 10) >= 5) return true;
  _domCounts.by[cap] = (_domCounts.by[cap] || 0) + 1;
  return _domCounts.by[cap] <= DOMINANT_DAILY_CAP[cap];
}

/* ===== 类别结构帽 → 已退役为观察器（2026-08-30 用户铁律：采集不设上限，只设下限）=====
 * 7 天实测：安全类（恐袭/军事/地缘/社会动荡/治安）占 ~72%，新兴类（网络/卫生/基建/灾害）仅 ~11%。
 * 旧机制：安全类占比>45% 时"砍"安全类新条目（降 sidepool）——本质是用拒绝做均衡 = 变相上限。
 * 2026-08-30 用户铁律「采集的数据不设上限，设下限，500 目标是下限」：
 *   ① 拒绝式结构帽永久停用（任何条目不再因结构占比被拒）；
 *   ② 结构均衡改由缺口调度器"补弱"实现——弱类主动检索补齐，安全类照常入库不设限；
 *   ③ 重点优先铁律不变：涉华/重大事件本来就不受帽限制，现在所有真实安全情报也全额入库。
 * _catStructRefresh/_catStructDb 保留：供 GAP-SCHED 观察安全类占比（占比高 → 加大弱类补采力度）。 */
const _SEC_STRUCT_TYPES = ['terror_events', 'military_conflicts', 'geopolitical_intel', 'social_unrest', 'security_events'];
const SEC_STRUCT_SHARE_MAX = 0.45;
const SEC_STRUCT_MIN_TOTAL = 300;
let _catStructDb = { date: '', total: 0, sec: 0, t: 0 };
async function _catStructRefresh() {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { rows } = await query(
      'SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE data_type = ANY($1))::int sec FROM intel_data WHERE collect_time >= $2',
      [_SEC_STRUCT_TYPES, dayStart]
    );
    if (rows && rows[0]) _catStructDb = { date: _todayKey(), total: rows[0].total || 0, sec: rows[0].sec || 0, t: Date.now() };
  } catch (e) { /* DB 异常时不拦数据 */ }
}
async function _catStructureOk(it) {
  /* 2026-08-30 退役：永远放行。结构均衡由 GAP-SCHED 补弱实现，绝不砍强。 */
  return true;
}

/* ===== 事件时间提取（2026-08-20 用户指令：不要只看标题生成时间，要从正文/标题提取事件发生时间）=====
 * 返回 Date 或 null；若文本中出现明确旧年（如 2024/去年/五年前），返回一个远超 24h 的旧日期，
 * 供 _isFreshEnough 拦截。 */
function _extractEventDate(text, refDate) {
  const t = String(text || '');
  const base = refDate ? new Date(refDate) : new Date();
  if (isNaN(base.getTime())) base.setTime(Date.now());
  const nowYear = new Date().getFullYear();

  /* 1. 绝对旧年标记：出现 2024 及更早年份 → 直接判旧 */
  const oldYearRe = /\b(20[0-2]\d)\b/g;
  let m;
  while ((m = oldYearRe.exec(t)) !== null) {
    const y = parseInt(m[1], 10);
    if (y < nowYear - 1) return new Date(y, 0, 1, 0, 0, 0);
  }

  /* 2. 相对旧闻词 */
  if (/(?:去年|前年|大前年|数年前|几年前|多年前|十年前|五年前|三年前|两年前|一年前|数月前|数周前|上月|上周|上星期|last year|years ago|months ago|weeks ago)(?!\s*\d{4})/i.test(t)) {
    return new Date(base.getTime() - 365 * 24 * 3600 * 1000);
  }

  const dates = [];

  /* 3. 中文/数字绝对日期：2026年8月19日 / 2026-08-19 / 2026/08/19 */
  const re1 = /(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})[日T]?\b/g;
  while ((m = re1.exec(t)) !== null) {
    dates.push(new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0));
  }

  /* 4. 缺年绝对日期：8月19日 / 8月19日下午 → 按 refDate 所属年份试算，若离 base 超过 6 个月则反推上一年/下一年 */
  const re2 = /(\d{1,2})月(\d{1,2})日(?![\d年月日])/g;
  while ((m = re2.exec(t)) !== null) {
    let d = new Date(base.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10), 12, 0, 0);
    const diff = d.getTime() - base.getTime();
    if (diff > 180 * 24 * 3600 * 1000) d = new Date(base.getFullYear() - 1, parseInt(m[1], 10) - 1, parseInt(m[2], 10), 12, 0, 0);
    else if (diff < -180 * 24 * 3600 * 1000) d = new Date(base.getFullYear() + 1, parseInt(m[1], 10) - 1, parseInt(m[2], 10), 12, 0, 0);
    dates.push(d);
  }

  /* 5. 英文绝对日期：August 19, 2026 / 19 August 2026 */
  const monthNames = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const re3 = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/gi;
  while ((m = re3.exec(t)) !== null) {
    const mon = monthNames[m[1].toLowerCase().slice(0, 3)];
    if (mon != null) dates.push(new Date(parseInt(m[3], 10), mon, parseInt(m[2], 10), 12, 0, 0));
  }
  const re4 = /(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/gi;
  while ((m = re4.exec(t)) !== null) {
    const mon = monthNames[m[2].toLowerCase().slice(0, 3)];
    if (mon != null) dates.push(new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10), 12, 0, 0));
  }

  /* 6. ISO / RSS 日期 */
  const re5 = /(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?))/g;
  while ((m = re5.exec(t)) !== null) {
    const d = new Date(m[1]);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  /* 7. 相对日期（无绝对日期时才用，且只取最近 48 小时内的） */
  if (dates.length === 0) {
    if (/\b(昨天|yesterday)\b/i.test(t)) dates.push(new Date(base.getTime() - 24 * 3600 * 1000));
    else if (/\b(前天|day before yesterday)\b/i.test(t)) dates.push(new Date(base.getTime() - 2 * 24 * 3600 * 1000));
    else {
      const mm = t.match(/(\d{1,3})\s*(?:天|days?)\s*(?:前|ago)/i);
      if (mm) dates.push(new Date(base.getTime() - parseInt(mm[1], 10) * 24 * 3600 * 1000));
      else {
        const mm2 = t.match(/(\d{1,3})\s*(?:小时|小时前|hours?)\s*(?:前|ago)/i);
        if (mm2) dates.push(new Date(base.getTime() - parseInt(mm2[1], 10) * 3600 * 1000));
      }
    }
  }

  const valid = dates.filter(function (d) { return !isNaN(d.getTime()); });
  if (!valid.length) return null;

  /* 取离 base 最近、且不在未来 12 小时之后的日期 */
  const futureCut = base.getTime() + 12 * 3600 * 1000;
  const candidates = valid.filter(function (d) { return d.getTime() <= futureCut; });
  const pool = candidates.length ? candidates : valid;
  return pool.reduce(function (a, b) {
    return Math.abs(a.getTime() - base.getTime()) < Math.abs(b.getTime() - base.getTime()) ? a : b;
  });
}

const _SIG_COUNTRIES = ['尼泊尔','巴基斯坦','阿富汗','伊朗','伊拉克','叙利亚','也门','沙特','以色列','巴勒斯坦','乌克兰','俄罗斯','缅甸','泰国','越南','老挝','柬埔寨','马来西亚','印度尼西亚','菲律宾','新加坡','孟加拉国','斯里兰卡','印度','哈萨克斯坦','乌兹别克斯坦','塔吉克斯坦','吉尔吉斯斯坦','土库曼斯坦','蒙古','韩国','日本','朝鲜','埃及','利比亚','阿尔及利亚','突尼斯','摩洛哥','苏丹','南苏丹','埃塞俄比亚','索马里','肯尼亚','坦桑尼亚','乌干达','卢旺达','刚果','尼日利亚','加纳','马里','尼日尔','乍得','喀麦隆','布基纳法索','赞比亚','津巴布韦','安哥拉','莫桑比克','南非','几内亚','墨西哥','巴西','阿根廷','智利','秘鲁','哥伦比亚','委内瑞拉','玻利维亚','厄瓜多尔','古巴','海地','巴拿马','美国','加拿大','英国','法国','德国','意大利','西班牙','葡萄牙','荷兰','比利时','瑞士','瑞典','挪威','芬兰','丹麦','奥地利','希腊','波兰','塞尔维亚','匈牙利','罗马尼亚','捷克','保加利亚','澳大利亚','新西兰','Nepal','Pakistan','Afghanistan','Iran','Iraq','Syria','Yemen','Saudi','Israel','Ukraine','Russia','Myanmar','Thailand','Vietnam','Laos','Cambodia','Malaysia','Indonesia','Philippines','Bangladesh','Sri Lanka','India','Kazakhstan','Uzbekistan','Ethiopia','Somalia','Kenya','Nigeria','Ghana','Mali','Niger','Chad','Cameroon','South Africa','Mexico','Brazil','Argentina','Chile','Peru','Colombia','Venezuela','Ecuador','Bolivia','Haiti','Panama'];
const _SIG_EVENT_RE = /死亡|遇难|身亡|伤亡|洪水|地震|袭击|爆炸|绑架|劫持|恐袭|枪击|冲突|政变|抗议|示威|制裁|坠机|沉船|山火|台风|飓风|killed|dead|flood|earthquake|attack|bomb|kidnap|clash|protest|sanction|coup|crash/i;
/* ===== 地区/城市→国别映射（2026-08-30 采集端修复：google_news 通道空 country 32+条/日 =====
 * 根因：Google News RSS 条目无 country 字段，标题常只含地区名（俾路支省/伦敦/内罗毕）不含国名，
 * 国名表兜底匹配不到 → 空 country 条目破坏目标矩阵统计与预警两区渲染。
 * 高频地区词（中英双语）映射到 _SIG_COUNTRIES 国名。宁可信地区锚不信空值。 */
const _REGION_COUNTRY = [
  [['俾路支','卡拉奇','拉合尔','伊斯兰堡','白沙瓦','奎达','信德','Balochistan','Karachi','Lahore','Islamabad','Peshawar','Quetta','Sindh'],'巴基斯坦'],
  [['伦敦','曼彻斯特','英格兰','苏格兰','贝尔法斯特','London','Manchester','England','Scotland'],'英国'],
  [['内罗毕','蒙巴萨','Nairobi','Mombasa'],'肯尼亚'],
  [['拉各斯','阿布贾','卡诺','Lagos','Abuja','Kano'],'尼日利亚'],
  [['开罗','亚历山大','Cairo','Alexandria','Sinai','西奈'],'埃及'],
  [['孟买','新德里','克什米尔','Mumbai','Delhi','Kashmir','印控克什米尔'],'印度'],
  [['喀布尔','坎大哈','赫拉特','Kabul','Kandahar','Herat'],'阿富汗'],
  [['达卡','Dhaka'],'孟加拉国'],
  [['仰光','曼德勒','若开','Yangon','Mandalay','Rakhine'],'缅甸'],
  [['萨那','荷台达','胡塞','Sanaa','Hodeidah','Houthi','Houthis'],'也门'],
  [['加沙','约旦河西岸','Gaza','West Bank'],'巴勒斯坦'],
  [['喀土穆','达尔富尔','Khartoum','Darfur'],'苏丹'],
  [['廷巴克图','巴马科','加奥','Timbuktu','Bamako','Gao'],'马里'],
  [['摩加迪沙','索马里兰','Mogadishu','Somaliland'],'索马里'],
  [['亚的斯亚贝巴','Addis Ababa'],'埃塞俄比亚'],
  [['金沙萨','卢本巴希','Kinshasa','Lubumbashi'],'刚果'],
  [['基辅','敖德萨','哈尔科夫','Kyiv','Odesa','Kharkiv'],'乌克兰'],
  [['莫斯科','车臣','达吉斯坦','Moscow','Chechnya','Dagestan'],'俄罗斯'],
  [['突尼斯市','Tunis'],'突尼斯'],
  [['卡萨布兰卡','拉巴特','Casablanca','Rabat'],'摩洛哥'],
  [['德尔加杜角','Cabo Delgado','德尔加杜角省'],'莫桑比克'],
  [['德黑兰','Tehran','伊斯法罕'],'伊朗'],
  [['利伯维尔','利雅得','吉达','Riyadh','Jeddah','利雅得省'],'沙特'],
  [['德克萨斯','得州','得克萨斯','佛罗里达','加利福尼亚','纽约','芝加哥','华盛顿州','Texas','Florida','California','New York','Chicago','San Francisco','Houston','Dallas'],'美国'],
  [['圣保罗','里约热内卢','Sao Paulo','Rio de Janeiro','Brasilia'],'巴西'],
  [['墨西哥城','锡那罗亚','Mexico City','Sinaloa','华雷斯'],'墨西哥'],
  [['加拉加斯','Caracas'],'委内瑞拉'],
  [['波哥大','Bogota','麦德林','Medellin'],'哥伦比亚'],
  [['太子港','Port-au-Prince'],'海地'],
  [['雅加达','泗水','Jakarta','Surabaya'],'印度尼西亚'],
  [['马尼拉','达沃','Manila','Davao','宿务'],'菲律宾'],
  [['科伦坡','Colombo','汉班托塔'],'斯里兰卡'],
  [['阿拉木图','阿斯塔纳','Almaty','Astana'],'哈萨克斯坦'],
  [['塔什干','Tashkent','撒马尔罕'],'乌兹别克斯坦'],
  [['杜尚别','Dushanbe'],'塔吉克斯坦'],
  [['比什凯克','Bishkek'],'吉尔吉斯斯坦'],
  [['阿克拉','Accra'],'加纳'],
  [['达累斯萨拉姆','Dar es Salaam','多多马'],'坦桑尼亚'],
  [['坎帕拉','Kampala'],'乌干达'],
  [['基加利','Kigali'],'卢旺达'],
  [['利伯维尔','Libreville'],'几内亚'],
  [['亚松森','Asunción','Asuncion'],'巴拉圭'],
  [['基多','Quito'],'厄瓜多尔'],
  [['拉巴斯','La Paz'],'玻利维亚'],
  [['的黎波里','Tripoli','班加西','Benghazi'],'利比亚'],
  [['阿尔及尔','Algiers'],'阿尔及利亚'],
  [['鹿特丹','阿姆斯特丹','Rotterdam','Amsterdam'],'荷兰']
];
function _regionToCountry(t) {
  const s = String(t || '');
  for (const pair of _REGION_COUNTRY) { if (pair[0].some(k => s.indexOf(k) >= 0)) return pair[1]; }
  return null;
}
/* ===== 多源印证（2026-08-13 用户指令；2026-08-28 重构）=====
 * 事件签名 v3 = 事发国（标题提取，非来源国）+ 事件词集合 + 日期 + 主语锚点词。
 * v2 缺陷（面板重复/误合并的根因）：
 *  ① 国别取来源国（it.country）——同一事件跨国来源分签（尼泊尔洪水→RU/PE/TH 三签），
 *    前端 _mergeEvents 合不了 → 面板重复；
 *  ② 只有国+日期时（无事件词）粒度过粗——巴基斯坦同日 16 条不同事件共用一签，
 *    前端误合并不同事件 → "同一事件多条变体"观感。
 * v3：事件国优先从标题提取；加主语锚点（设施/组织/数字伤亡）提升同事件聚合度。 */
function _eventSignature(it) {
  const t = String(it.title || '') + ' ' + String(it.title_zh || '');
  const tl = t.toLowerCase();
  /* 2026-08-31 领域词补充（WM-FEED 0 入库根因）：疫情/断网/领事咨询类条目天然无
   * 原 evRe 事件词 → 签名退化为「国||日期」，与库内同国同日普通新闻跨通道误撞全灭。
   * 补 outbreak/epidemic/outage/disruption/advisory 及中文对应词：
   *  - 签名带事件类型后不再与「国||日期」退化签名撞（误杀消除）
   *  - 同类事件不同来源仍含同样领域词 → 互撞去重精度不变（疫情多源变体仍只留首发） */
  const evRe = /attack|blast|bomb|explosion|killed|kidnap|hostage|shoot|strike|clash|raid|ambush|crash|collapse|sanction|tariff|protest|riot|coup|fire|flood|earthquake|murder|arrest|massacre|outbreak|epidemic|pandemic|outage|disruption|advisory|袭击|爆炸|死亡|遇难|绑架|枪击|制裁|抗议|冲突|炮击|撤离|火灾|洪水|地震|恐袭|劫持|政变|谋杀|逮捕|被捕|屠杀|坠机|沉船|判决|释放|疫情|爆发|传染病|断网|中断|预警/g;
  const evSet = new Set();
  let mm; while ((mm = evRe.exec(tl)) !== null) evSet.add(mm[0]);
  const ev = Array.from(evSet).sort().join('+') || '';
  /* 事发国：标题优先（跨源一致），标题无国名才退化用条目国别（含地区映射：俾路支→巴基斯坦等） */
  const ctry = _SIG_COUNTRIES.find(x => t.indexOf(x) >= 0) || _regionToCountry(t) || String(it.country_cn || it.country || '');
  /* 主语锚点：伤亡数字 / 威胁组织 / 关键设施——同事件不同措辞的共同锚
   * 2026-08-29 P1-3 数量级桶修正：同一事件死亡人数随救援进展持续更新（469→475→626），
   * 精确数字当锚点会让每次更新都换签名绕过 event-sig-dup——中尼洪灾 7 天 141 条变体的根因。
   * 改按数量级分桶（十位 n2/百位 n3/千位 n4），死亡人数爬升不再换签名。 */
  const numRaw = (t.match(/(\d{2,4})\s*(?:人|名)?\s*(?:死亡|遇难|身亡|失踪|受伤|killed|missing|injured|dead)/i) || [])[1] || '';
  const num = numRaw ? (numRaw.length >= 4 ? 'n4' : numRaw.length === 3 ? 'n3' : 'n2') : '';
  const org = (t.match(/塔利班|胡塞|博科|青年党|BLA|TTP|ISIS|伊斯兰国|基地组织|Taliban|Houthi|Hamas|Hezbollah/i) || [])[0] || '';
  const fac = (t.match(/瓜达尔|霍尔木兹|红海|苏伊士|中巴经济走廊|CPEC|大使馆|使馆|清真寺|学校|医院|机场|港口|Gwadar|Hormuz|embassy/i) || [])[0] || '';
  const anchor = [num, org, fac].filter(Boolean).join('/');
  const text = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.description || it.desc || '');
  const evtDate = _extractEventDate(text, it.publish_time || it.publishedAt || it.pubDate || new Date());
  const day = evtDate ? evtDate.toISOString().slice(0, 10) : String(it.publish_time || it.publishedAt || '').slice(0, 10);
  return ctry + '|' + ev + '|' + (anchor || day);   /* 有锚点用锚点（同事件强聚合），无锚点退日期 */
}
/* ===== 事件簇产量帽（2026-08-29 三部委审查 P1-3 根因修复）=====
 * 起因：中尼边境洪灾单一事件 7 天 141 条变体入库。根因链：
 *  ① 事件签名锚点含具体伤亡数字——死亡人数 469→626 每次更新都换签名，绕过 event-sig-dup；
 *  ② 伤亡≥5 豁免国家日配额——洪灾类重大伤亡条目全部免检；
 *  ③ 单源帽治不了（最大源仅 6 条）——变体来自全球几十家媒体。
 * 修法：按"事发国+事件词"建簇，当日变体超 12 条即拒收（首发及早期报道不受影响）。
 * 事件仍在库中有充分覆盖（12 条/日），但不许单一事件把国家分布刷成一家独大。 */
const EVENT_CLUSTER_DAILY_CAP = 12;
const _evCluster = { date: '', by: {} };
function _eventClusterOk(it) {
  /* 2026-08-31 专项作战室豁免：研究通道要的就是多源密度（用户铁律"上合峰会才采 2 条，
   * 核心中的核心"）——同国同事件多版本入库供报告整合，不适用防刷屏簇帽 */
  if (it._sourceType === 'threatroom') return true;
  const t = String(it.title || '') + ' ' + String(it.title_zh || '');
  if (t.trim().length < 8) return true;
  const ctry = _SIG_COUNTRIES.find(x => t.indexOf(x) >= 0) || _regionToCountry(t) || String(it.country_cn || it.country || '');
  if (!ctry) return true;
  const ev = t.match(/洪水|地震|死亡|遇难|身亡|失踪|伤亡|袭击|爆炸|绑架|劫持|恐袭|枪击|冲突|政变|坠机|沉船|flood|earthquake|attack|bomb|kidnap|clash|coup|crash/i);
  if (!ev) return true; /* 无事件词的常规报道不适用簇帽 */
  const d = _todayKey();
  if (_evCluster.date !== d) { _evCluster.date = d; _evCluster.by = {}; }
  const key = ctry + '|' + ev[0].toLowerCase();
  _evCluster.by[key] = (_evCluster.by[key] || 0) + 1;
  return _evCluster.by[key] <= EVENT_CLUSTER_DAILY_CAP;
}
/* ===== 语义级事件查重（2026-08-30 root-cause：跨措辞/跨通道/跨日变体绕过精确查重）=====
 * 用户抓到的一类问题（非个案，两个铁证样本）：
 * ① 海地帮派屠杀 47 死（08-26 事发）→ 08-26~08-30 被采 20+ 版本入库。各通道按检索国/
 *    来源国生成签名（KR|绑架 / UZ|绑架 / USA|绑架 / AFG|死亡+绑架+袭击 / GHA|...），
 *    签名等值查重永不命中；标题指纹对跨措辞变体失效；簇帽日重置对跨日翻炒无效。
 * ② 斯里兰卡中国公民港口谋杀案 → 三版本签名分别是 |绑架|港口 / ||港口 / 伊朗||港口
 *    （谋杀/逮捕不在事件词表 + country 污染成检索国 + google_news 空国别）。
 * 修法：签名等值不中时，拉近 3 天「标题含同国名」候选行（语义层统一以标题提取国名为锚，
 * 不信 it.country——检索国/来源国污染），JS 判定同事件：
 *   事件词交集 ≥1 且（伤亡数字精确一致 或 实体锚交集 ≥2）→ 同事件
 *   同事件且库内已有 ≥2 独立来源（按 URL 域名聚合，source 字段是聚合器名不可用）→ 拦截
 * 设计边界：
 *  - 保留前两源入库（多源印证机制依赖重复入库累计 corroboration，第三源起全拒）；
 *  - 伤亡数字爬升（47→52）精确不一致 → 放行（有信息增量）；
 *  - 首发当日多源变体不受影响（已有源数 <2）；
 *  - 标题无国名：无锚不做语义查重（误伤风险大于收益）。 */
const _semCandCache = new Map(); /* 国名 → {t, rows} 候选缓存 120s（轮内同国查询合并） */
const _semInflight = new Map(); /* 国名 → {t, hosts: Map<域名, 条数>} 轮内已放行同事件源（补候选缓存盲区） */
const _SEM_EV_RE = /attack|blast|bomb|explosion|killed|kidnap|hostage|shoot|strike|clash|raid|ambush|crash|collapse|sanction|tariff|protest|riot|coup|fire|flood|earthquake|murder|arrest|massacre|袭击|爆炸|死亡|遇难|绑架|枪击|制裁|抗议|冲突|炮击|撤离|火灾|洪水|地震|恐袭|劫持|政变|谋杀|逮捕|被捕|屠杀|坠机|沉船|判决|释放/gi;
const _SEM_FAC_RE = /瓜达尔|霍尔木兹|红海|苏伊士|中巴经济走廊|CPEC|大使馆|使馆|清真寺|学校|医院|机场|港口|大学|教堂|市场|银行|联合国|中国公民|华人|中资|中国籍|中国工人|Gwadar|Hormuz|embassy|United Nations/gi;
const _SEM_NUM_RE = /(\d{2,4})\s*(?:人|名)?\s*(?:死亡|遇难|身亡|失踪|受伤|killed|missing|injured|dead)/i;
async function _semanticEventDup(it) {
  try {
    /* 2026-08-31 专项作战室豁免：语义查重"第三源起全拒"逻辑对研究通道反向优化——
     * 多源多版本正是专项报告的素材（上合峰会 20 家媒体报道=20 条情报），全放行 */
    if (it._sourceType === 'threatroom') return false;
    const t = String(it.title || '') + ' ' + String(it.title_zh || '');
    if (t.trim().length < 12) return false;
    const evSet = new Set(); let mm;
    while ((mm = _SEM_EV_RE.exec(t)) !== null) evSet.add(mm[0].toLowerCase());
    const num = (t.match(_SEM_NUM_RE) || [])[1] || '';
    if (!evSet.size && !num) return false;
    const facSet = new Set();
    while ((mm = _SEM_FAC_RE.exec(t)) !== null) facSet.add(mm[0].toLowerCase());
    /* 2026-08-30 补洞（用户铁证：斯里兰卡港口城案三版本标题均无"斯里兰卡"字样，
     * 原路径直接 return false 跳过查重）：标题无国名但含涉华实体锚（中国公民/华人/中资等）
     * ——涉华实体本身即强锚（chinaOverseasGate 已前置把关，误伤风险低），
     * 用实体词做候选查询键，语义判定照常执行。 */
    let ctry = _SIG_COUNTRIES.find(x => t.indexOf(x) >= 0) || _regionToCountry(t);
    const ckey = ctry || Array.from(facSet).find(w => /中国公民|华人|中资|中国籍|中国工人/.test(w)) || '';
    if (!ckey) return false;
    /* 候选缓存：轮内同键连续查重只打一次 DB（国名或涉华实体词） */
    let cand = _semCandCache.get(ckey);
    if (!cand || Date.now() - cand.t > 120 * 1000) {
      const { rows } = await query(
        `SELECT title, COALESCE(NULLIF(data_json->>'title_zh',''), title) tzh, source, url FROM intel_data
         WHERE collect_time > NOW() - INTERVAL '3 days' AND (title LIKE $1 OR data_json->>'title_zh' LIKE $1) LIMIT 300`,
        ['%' + ckey + '%']);
      cand = { t: Date.now(), rows: rows || [] };
      _semCandCache.set(ckey, cand);
      if (_semCandCache.size > 40) _semCandCache.clear(); /* 键数有限，防御性清理 */
    }
    /* 轮内已放行同事件源（缓存盲区补偿：候选缓存 120s 不含刚入库的批内条目） */
    let inflight = _semInflight.get(ckey);
    if (!inflight || Date.now() - inflight.t > 120 * 1000) { inflight = { t: Date.now(), hosts: new Map() }; _semInflight.set(ckey, inflight); }
    if (!cand.rows.length && !inflight.hosts.size) return false;
    const evArr = Array.from(evSet), facArr = Array.from(facSet);
    const _numBucket = n => (!n ? '' : (String(n).length >= 4 ? 'n4' : String(n).length === 3 ? 'n3' : 'n2'));
    let sameEvent = 0; const domains = new Set();
    /* 2026-08-30 聚合器域名治理：Google News/Bing 等聚合器 URL 掩盖真实出版方，
     * 同事件 N 条聚合器变体只算 1 个"域名"，永不触发 ≥2 独立源拒收——重复采集刷屏的
     * 又一根因。聚合器域名标记 AGG: 前缀，不参与独立源计数。 */
    const _AGG_HOST_RE = /news\.google\.|google\.com\/rss|bing\.com|news\.yahoo\.|feedburner/i;
    const _hostOf = (u, s) => {
      try { const h = new URL(String(u || '')).hostname.replace(/^www\./, ''); return _AGG_HOST_RE.test(h) ? 'AGG:' + h : h; }
      catch (e2) { const sv = String(s || ''); return _AGG_HOST_RE.test(sv) ? 'AGG:' + sv.slice(0, 30) : sv; }
    };
    for (const r of cand.rows) {
      const rt = String(r.title || '') + ' ' + String(r.tzh || '');
      const rNum = (rt.match(_SEM_NUM_RE) || [])[1] || '';
      const evHit = evArr.some(w => rt.toLowerCase().indexOf(w) >= 0);
      const facHits = facArr.filter(w => rt.toLowerCase().indexOf(w) >= 0).length;
      /* 判定同事件（2026-08-30 收紧：中尼洪灾死亡爬升 623→626→633 一天 15+ 条变体刷屏的教训——
       * "数字精确一致"放行爬升变体。三判据：
       * ① 数字精确一致+事件词交集；
       * ② 数字同数量级桶（n2/n3/n4）+事件词交集+≥1 实体锚——死亡/失踪数爬升属同事件信息更新非新事件；
       * ③ 无数字场景：事件词交集+实体锚交集≥2（涉华案件类）。 */
      const same = (num && rNum === num && evHit)
        || (num && rNum && _numBucket(num) === _numBucket(rNum) && evHit && facHits >= 1)
        || (evHit && facHits >= 2 && (!num || !rNum || num === rNum));
      if (same) { sameEvent++; const h = _hostOf(r.url, r.source); if (h) domains.add(h); }
    }
    /* 并入轮内已放行源，合并判定（AGG: 聚合器域名不算独立源，从独立源集合中剔除） */
    let inflightSame = 0;
    inflight.hosts.forEach((n, h) => { inflightSame += n; if (h && h.indexOf('AGG:') !== 0) domains.add(h); });
    const _myHost = _hostOf(it.url, it.source);
    const _indieDomains = new Set(Array.from(domains).filter(h => h.indexOf('AGG:') !== 0));
    if (sameEvent + inflightSame >= 2) {
      /* 拒收判据（两源印证只认真实出版方域名）：
       * ① 已有 ≥2 独立真实源 → 全拒；
       * ② 本条是聚合器变体（聚合器转载无独立源价值）→ 拒；
       * ③ 本条真实域名与已入库独立源重复（同源再报道）→ 拒。
       * 放行剩余唯一情形：本条带来新的真实域名且独立源数 <2（首/次独立源印证）。 */
      const _myAgg = String(_myHost).indexOf('AGG:') === 0;
      if (_indieDomains.size >= 2 || _myAgg || _indieDomains.has(_myHost)) {
        _gateAudit('入库闸', 'event-sig-dup-sem', it.title);
        return true;
      }
    }
    /* 放行且库内/轮内已有同事件 → 本条计入 inflight（它是既存同事件源之一） */
    if (sameEvent + inflightSame >= 1 && _myHost) {
      inflight.hosts.set(_myHost, (inflight.hosts.get(_myHost) || 0) + 1);
    }
    return false;
  } catch (e) { return false; }
}
/* 入库后计算印证数（近2天同签名独立来源数+1），写回本条 data_json */
async function _markCorroboration(id, it) {
  try {
    const sig = it._eventSig;
    if (!sig || sig.indexOf('|') < 0) return;
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const { rows } = await query(
      `SELECT COUNT(DISTINCT source) c FROM intel_data WHERE collect_time >= $1 AND data_json->>'_eventSig' = $2`,
      [since, sig]
    );
    const n = Math.max(1, parseInt(rows[0].c || '1', 10));
    if (n > 1) {
      await query(`UPDATE intel_data SET data_json = jsonb_set(data_json, '{corroboration}', $1::jsonb) WHERE id = $2`, [String(n), id]);
    }
    /* 2026-08-28 立场证据链（94源工程包核心思想）：
     * 同事件被 ≥2 个不同 stance（G政府/I独立/N非营利/W西方/C中国官方）的源报道
     * → stance_verified=true（多立场交叉验证，防单一叙事源带偏，高告警通道门槛）。
     * 签名 v3 落地后直接用 _eventSig（事发国+事件词+锚点）精确配对；
     * 兼容 v2 存量：标题含同国+同事件词的条目也纳入（JS 侧事件词交集判定）。 */
    try {
      const sig = String(it._eventSig || '');
      const ctry = sig.split('|')[0] || '';
      const evWords = (sig.split('|')[1] || '').split('+').filter(Boolean);
      if (!ctry || !evWords.length) return;
      const { rows: cand } = await query(
        `SELECT data_json->>'stance' st, data_json->>'_eventSig' sig2, title FROM intel_data
         WHERE collect_time >= $1 AND data_json->>'stance' IS NOT NULL AND title LIKE '%' || $2 || '%'`,
        [since, ctry]
      );
      const stances = new Set();
      cand.forEach(r => {
        const sameSig = r.sig2 === sig;
        const t = String(r.title || '');
        const evHit = evWords.some(w => t.toLowerCase().indexOf(w) >= 0 || t.indexOf(w) >= 0);
        if ((sameSig || evHit) && r.st) stances.add(r.st);
      });
      if (stances.size >= 2) {
        await query(`UPDATE intel_data SET data_json = jsonb_set(jsonb_set(data_json, '{stance_set}', $1::jsonb), '{stance_verified}', 'true') WHERE id = $2`,
          [JSON.stringify(Array.from(stances)), id]);
      }
    } catch (e2) {}
  } catch (e) {}
}

/* 2026-08-25 时效铁律补丁：从 URL 路径提取发布日期（/2026/08/23/、/2026-8-23_ 等，
 * 半岛/BBC/路透/WP 站普遍内嵌）。返回 Date 或 null。 */
function _urlDate(u) {
  const m = String(u || '').match(/\/(20\d{2})[\/\-_](0?[1-9]|1[0-2])[\/\-_](0?[1-9]|[12]\d|3[01])(?=[\/\-_]|$)/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

function _isFreshEnough(it) {
  const text = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.description || it.desc || '');
  let dated = false;   /* 2026-08-25 铁律：新闻必须能验证 24h 时效，三种途径都拿不到日期 → 拦截 */

  /* 2026-08-31 专项作战室（threatroom）：用户指定实体（国家/组织/项目）的专项回顾采集，
   * 窗口是近 7 天而非 24h——24h 时效闸/当天数据铁律/正文旧日期提取对回顾性分析全部不适用。
   * 以发布时间为准绳：7 天内一律放行（GDELT timespan:7d 已硬限制检索窗）；
   * 无日期条目按采集时刻计。注意：预警中心前端本就有 72h 过期剔除，2-7 天条目不会
   * 污染实时预警流，只进数据中心/专项作战室报告。 */
  if (it._sourceType === 'threatroom') {
    const _tv = it.publish_time || it.publishedAt || it.pubDate || it.event_date || it.date || '';
    const _td = new Date(_tv);
    if (!isNaN(_td.getTime())) {
      const _age = Date.now() - _td.getTime();
      if (_age > 7 * 24 * 3600 * 1000 || _age < -12 * 3600 * 1000) return false;
      if (!it.event_date) { it.event_date = _td.toISOString(); if (!it.date) it.date = it.event_date; }
      return true;
    }
    it.publish_time = it.publish_time || new Date().toISOString();
    it.event_date = it.event_date || it.publish_time;
    if (!it.date) it.date = it.event_date;
    return true;
  }

  /* 2026-08-25 白名单公众号豁免：wechat_oa 通道（搜狗/profile_ext/镜像站）是用户亲选的专业安全信源，
   * 正文常引用 24~48h 前的事件（如刚果金上加丹加案 8-24 事发、8-25 报道），正文事件日期提取会把
   * 刚发布的报道误判为旧闻全杀（实测镜像首跑 5/5 误杀）。对这类信源以发布日期为时效准绳。
   * 2026-08-30 增补 gap_scheduler：缺口调度器补的是国别/类别覆盖缺口，经济/制裁/政局类正文高频
   * 回溯引用 1-2 天前的事件日期（"周三美联储宣布…"），事件日期提取把刚发布的报道全判旧闻——
   * 实测 15 轮全 0 入库（超时拒主导，含发布仅 3h 的新鲜条目被正文旧日期误杀）。以发布时间为准绳。 */
  const trustPubDate = it._sourceType === 'wechat_oa' || it._sourceType === 'gap_scheduler' || it._sourceType === 'wm_feed';
  /* 2026-08-31 增补 wm_feed：WorldMonitor 接入哨兵。UCDP 冲突事件的 dateStart 是事件
   * 发生日（常比数据更新晚 1-3 天），新闻摘要 publishedAt 为可靠发布时间——以发布时间为准绳。 */

  /* 优先从标题+正文提取事件发生时间 */
  const evtDate = trustPubDate ? null : _extractEventDate(text, it.publish_time || it.publishedAt || it.pubDate || it.event_date || it.date || new Date());
  if (evtDate && !isNaN(evtDate.getTime())) {
    dated = true;
    it._extractedEventDate = evtDate.toISOString();
    it.event_date = it._extractedEventDate;           /* 入库时以事件发生时间为准 */
    if (!it.date) it.date = it._extractedEventDate;
    const age = Date.now() - evtDate.getTime();
    if (age > _freshWindowFor(it)) return false;    /* 事件超时效窗（社交60h/其余24h）→ 旧闻 */
    if (age < -12 * 60 * 60 * 1000) return false;     /* 未来事件（大于 12h） */
  }

  /* 兜底：metadata 发布时间 */
  const v = it.publish_time || it.publishedAt || it.pubDate || it.event_date || it.date || '';
  if (v) {
    /* 2026-08-24 修复：禁止 .replace('Z','') —— 带 Z 的 ISO-UTC 被剥 Z 后会按本地时区解析，
     * 直接多出 8 小时年龄，新鲜单源数据被 stale-single-source/时效闸误杀（云采集管道全是 Z 时间戳） */
    const d = new Date(v);
    const t = isNaN(d.getTime()) ? new Date(String(v).replace('T', ' ')) : d;
    if (!isNaN(t.getTime())) {
      dated = true;
      const age = Date.now() - t.getTime();
      if (age > _freshWindowFor(it)) return false;
      if (age < -12 * 60 * 60 * 1000) return false;
      /* 2026-08-25 要素补全：metadata 日期也可靠时回填 event_date（此前 94% 条目 event_date 为空） */
      if (!it.event_date) { it.event_date = t.toISOString(); if (!it.date) it.date = it.event_date; }
    }
  }

  /* 2026-08-25：再兜底 URL 内嵌日期（云管道/全文抓取常丢 metadata 日期，但 URL 自带） */
  if (!dated) {
    const ud = _urlDate(it.url || it.link || '');
    if (ud) {
      dated = true;
      const age = Date.now() - ud.getTime();
      if (age > _freshWindowFor(it)) return false;
      if (age < -12 * 60 * 60 * 1000) return false;
      it.publish_time = it.publish_time || ud.toISOString();   /* 补回日期，下游展示/统计可用 */
      if (!it.event_date) { it.event_date = ud.toISOString(); if (!it.date) it.date = it.event_date; }
    }
  }

  /* 铁律收尾：三种途径都拿不到日期的新闻，时效不可验证 → 一律拦截（原"放行"是旧闻漏网主通道，
   * 2026-08-25 实测近 3 天 43% 入库条目无任何日期字段）
   * 2026-08-30 例外修复：gap_scheduler 检索通道全部自带 when:1d 硬限制（AP/GNews 只返回一天内新闻），
   * 时间戳解析失败的当日新闻被当旧闻全杀（实测白天 15+ 轮全 0 入库，超时拒主导，铁证：
   * "特朗普将沙特民用核协议提交国会审查"/"沙特处决5人"当日 AP 新闻因无时间戳被拒）。
   * 时间戳缺失 → 信任检索窗口，按采集时刻计。 */
  if (!dated && it._sourceType === 'gap_scheduler') {
    it.publish_time = it.publish_time || new Date().toISOString();
    it.event_date = it.event_date || it.publish_time;
    dated = true;
  }
  if (!dated) return false;

  /* ===== 当天数据铁律（2026-08-28 用户指令：当天只采当天数据，除非非常重要且库内无此条）=====
   * 实测各通道当天率仅 14-41%（昨天的新闻跨零点后仍满足 24h 窗口）。
   * 收紧：事件时间非今天的 → 必须同时满足：
   * ① "重要类"：核心威胁十类 / 红橙级 / 白名单公众号
   * ② "库内无此条"：事件签名+标题指纹双查重——库里已有该事件的任何版本都不再采
   *    （旧事件的多源跟进报道只更新印证数，不新增条目）
   * 其余旧数据一律拦截（进非预警数据池可复核）。
   * 注意：本函数被同步调用（部分路径），库内查重做成异步安全——返回 Promise 时由调用方 await；
   * 这里用内存缓存近似：近 3 天事件签名集合已由 _getRecentEventSigs 维护，直接复用标题指纹缓存。 */
  try {
    const _evStr = String(it._extractedEventDate || it.event_date || it.publish_time || it.publishedAt || it.pubDate || it.date || '');
    if (_evStr) {
      const _ev = new Date(_evStr);
      if (!isNaN(_ev.getTime())) {
        const _today = new Date(); _today.setHours(0, 0, 0, 0);
        const _isToday = _ev.getTime() >= _today.getTime();
        if (!_isToday) {
          const _important = _tagCoreThreat(it).length > 0
            || it.level === 'red' || it.level === 'orange'
            || it._sourceType === 'wechat_oa' || it._sourceType === 'wechat_lead'
            || it._sourceType === 'gap_scheduler'; /* 2026-08-30：缺口类别（制裁/经济/政局）事件多为前日，
              目标矩阵要求 ≥30条/日；发布 24h 时效闸+库内查重双闸已保底，此处放行 */;
          if (!_important) return false;
          /* 库内已有该条判定：事件签名或标题指纹已见于库 → 拒收（同步近似用内存缓存，
           * 精确 DB 查重在 _preInsertGate 的 event-sig-dup/title-dup 双保险已执行） */
          const _sig = _eventSignature(it);
          const _tk = _normTitleKey(it.title_zh || it.title);
          if (_recentEventSigsCache.has(_sig) || (_tk.length >= 10 && _recentTitleKeysCache.has(_tk))) {
            return false; /* 重要旧事件已有库内版本：多源跟进不新增条目 */
          }
          it._staleButImportant = true;   /* 标记：重要旧闻（库内首见），展示时注明事件日期 */
        }
      }
    }
  } catch (e) {}
  return true;
}

/* 事件发生时间距今毫秒数（从正文/标题提取优先）；无法提取返回 -1 */
function _getEventAgeMs(it) {
  const text = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.description || it.desc || '');
  const evtDate = _extractEventDate(text, it.publish_time || it.publishedAt || it.pubDate || it.event_date || it.date || new Date());
  if (evtDate && !isNaN(evtDate.getTime())) return Date.now() - evtDate.getTime();
  const v = it.publish_time || it.publishedAt || it.pubDate || it.event_date || it.date || '';
  if (v) {
    /* 2026-08-24 修复：禁止 .replace('Z','') —— 带 Z 的 ISO-UTC 剥 Z 后按本地时区解析多出 8 小时，
     * 新鲜单源数据被 stale-single-source 误杀（云采集管道全是 Z 时间戳） */
    const d = new Date(v);
    const t = isNaN(d.getTime()) ? new Date(String(v).replace('T', ' ')) : d;
    if (!isNaN(t.getTime())) return Date.now() - t.getTime();
  }
  return -1;
}

/* 查询近 N 小时内是否有同事件签名的其他独立来源已入库 */
async function _hasCorroboration(sig, hours) {
  try {
    if (!sig || sig.indexOf('|') < 0) return false;
    const since = new Date(Date.now() - (hours || 48) * 3600 * 1000);
    const { rows } = await query(
      `SELECT COUNT(DISTINCT source) c FROM intel_data WHERE collect_time >= $1 AND data_json->>'_eventSig' = $2`,
      [since, sig]
    );
    return parseInt(rows[0].c || '0', 10) >= 1;
  } catch (e) { return false; }
}
function _loadDailyStats() {
  try {
    if (!fs.existsSync(DAILY_STATS_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(DAILY_STATS_FILE, 'utf8'));
    if (raw && raw.date === _todayKey()) return raw;
  } catch (e) {}
  return null;
}
function _saveDailyStats() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(DAILY_STATS_FILE, JSON.stringify(_dailyStats), 'utf8');
  } catch (e) {}
}
let _dailyStats = _loadDailyStats() || { date: _todayKey(), total: 0, linked: 0, china: 0, chinaNegative: 0, rounds: 0, lastRound: null };

/* ===== 闸门拒收漏斗累加器（2026-08-31 任务 #521）=====
 * 用户原话：「今天采集了近600条数据，为什么只有100多条进入了预警中心」——
 * 实际是各闸门合理去重（事件签名重复/URL重复是正常防刷屏），但拒收明细只打 console 不暴露，
 * 用户看不到每类闸门拒了多少条 → 误以为「系统漏了 500 条」。
 * 改造：在 _ingestLinkedItems 内部把 11 类拒收累加到 _rejectsSession，/api/media/daily-stats 暴露给前端可视化。 */
let _rejectsSession = _loadRejectsSession() || {
  date: _todayKey(),
  collected: 0, linked: 0,            /* 原始抓取数 / 过兴趣关联闸门数（用户看到的"采集 600"实际是 linked） */
  inserted: 0,                         /* 真正入库数 */
  dupUrl: 0,                           /* 库内已有 URL */
  dupTitle: 0,                         /* 标题/实体重复 */
  dupEvent: 0,                         /* 事件签名重复（同事件多源/多进展） */
  domestic: 0,                         /* 国内数据被 chinaOverseasGate 拦 */
  badTitle: 0,                         /* 烂标题（翻译质量/外文主体） */
  historical: 0,                       /* 历史旧案回顾否决 */
  stale: 0,                            /* 超 24h 旧闻 */
  ruUa: 0,                             /* 俄乌超配额 */
  catStruct: 0,                        /* 类别结构帽让位 */
  noUrl: 0,                            /* 无 url/标题 */
  insertErr: 0,                        /* 插入失败 */
  bySource: {}                         /* 各 sourceType 分桶拒收 */
};
function _loadRejectsSession() { try { const p = require('path').join(__dirname, 'rejects_session.json'); if (require('fs').existsSync(p)) { return JSON.parse(require('fs').readFileSync(p, 'utf8')); } } catch (e) {} return null; }
function _saveRejectsSession() { try { const p = require('path').join(__dirname, 'rejects_session.json'); require('fs').writeFileSync(p, JSON.stringify(_rejectsSession)); } catch (e) {} }
if (_dailyStats.date !== _todayKey()) {
  _dailyStats = { date: _todayKey(), total: 0, linked: 0, china: 0, chinaNegative: 0, rounds: 0, lastRound: null };
}
/* 启动时/跨天从数据库同步当日实际入库量，避免服务重启导致统计归零或漏计 */
async function _syncDailyStatsFromDB() {
  try {
    /* 本地自然日 0 点作为边界（不能用 CURRENT_DATE——它取决于 PG 会话时区，可能不是中国时区） */
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE collect_time >= $1) AS total_today,
        COUNT(*) FILTER (WHERE collect_time >= $1 AND (
          title ILIKE '%中国%' OR title ILIKE '%Chinese%' OR title ILIKE '%China%' OR title ILIKE '%中资%'
          OR title ILIKE '%华人%' OR title ILIKE '%华侨%' OR title ILIKE '%中方%' OR title ILIKE '%中企%'
          OR title ILIKE '%一带一路%' OR title ILIKE '%BRI%' OR title ILIKE '%Belt and Road%'
          OR title ILIKE '%Beijing%' OR title ILIKE '%CPEC%' OR title ILIKE '%涉华%' OR title ILIKE '%对华%'
          OR data_json->>'title_zh' ILIKE '%中国%' OR data_json->>'title_zh' ILIKE '%中资%'
          OR data_json->>'title_zh' ILIKE '%华人%' OR data_json->>'title_zh' ILIKE '%一带一路%'
        )) AS china_today
      FROM intel_data
    `, [dayStart]);
    const dbTotal = parseInt(rows[0].total_today || '0', 10);
    const dbChinaRaw = parseInt(rows[0].china_today || '0', 10);
    const { rows: negRows } = await query(`
      SELECT title, data_json->>'_chinaNegative' AS neg
      FROM intel_data
      WHERE collect_time >= $1 AND (
        title ILIKE '%中国%' OR title ILIKE '%Chinese%' OR title ILIKE '%China%' OR title ILIKE '%中资%'
        OR title ILIKE '%华人%' OR title ILIKE '%华侨%' OR title ILIKE '%中方%' OR title ILIKE '%中企%'
        OR title ILIKE '%一带一路%' OR title ILIKE '%BRI%' OR title ILIKE '%Belt and Road%'
      )
    `, [dayStart]);
    let dbChinaNeg = 0;
    negRows.forEach(r => { if (_isChinaNegative({ title: r.title, _chinaNegative: r.neg === 'true' })) dbChinaNeg++; });
    const dbChina = Math.max(0, dbChinaRaw - dbChinaNeg);
    const d = _todayKey();
    if (_dailyStats.date !== d) _dailyStats = { date: d, total: 0, linked: 0, china: 0, chinaNegative: 0, rounds: 0, lastRound: null };
    const oldTotal = _dailyStats.total, oldChina = _dailyStats.china, oldNeg = _dailyStats.chinaNegative;
    /* 2026-08-14：总量同样直接采用 DB 实数（清库/去重后内存虚值会回落，指标必须诚实） */
    _dailyStats.total = Math.max(dbTotal, 0);
    /* 2026-08-13：涉华/负面以数据库标题口径为准（直接采用，不再 Math.max）——
     * 内存计数曾按"来源是中国媒体即涉华"虚增（85 vs 实际 30 余条），此处会自动纠偏回落 */
    _dailyStats.china = Math.max(dbChina, 0);
    _dailyStats.chinaNegative = Math.max(dbChinaNeg, 0);
    if (_dailyStats.total !== oldTotal || _dailyStats.china !== oldChina || _dailyStats.chinaNegative !== oldNeg) {
      console.log('[DAILY STATS] 已从数据库同步：总量 ' + _dailyStats.total + ' / 涉华 ' + _dailyStats.china + ' / 境外涉华负面 ' + _dailyStats.chinaNegative + '（文件旧值 ' + oldTotal + '/' + oldChina + '/' + oldNeg + '）');
      _saveDailyStats();
      _logDailyStats();
    }
  } catch (e) { console.warn('[DAILY STATS] 数据库同步失败:', e.message); }
}
/* 涉华/负面专项轮询索引：避免每轮都抓前 N 个源导致重复 URL 爆炸 */
let _chinaFocusRoundIndex = 0;
let _chinaNegativeRoundIndex = 0;
function _isChinaLinked(it) {
  if (!it) return false;
  // 境外涉华负面数据独立计数，不占常规涉华指标
  if (it._chinaNegative === true) return false;
  if (it.interestLinked !== true && it.interestLinked !== 'true') return false;
  /* 2026-08-27 用户铁律：涉华必须真实命中中国主体/利益，禁止港台疆藏单独出现、
   * 禁止 Chinese 泛称（Chinese rivals/officials）即标涉华。统一使用 scrapers.isChinaRelatedStrict。 */
  if (it._chinaFocus === true) return true;
  // dims A/B 在采集时基于标题计算（A=中国要素，B=一带一路项目），等同标题级判定
  if (it.dims && (it.dims.indexOf('A') >= 0 || it.dims.indexOf('B') >= 0)) return true;
  const t = String(it.title || '') + ' ' + String(it.title_zh || '');
  return scrapers.isChinaRelatedStrict(t);
}
function _isChinaNegative(it) {
  if (!it) return false;
  if (it._chinaNegative === true) return true;
  // 2026-08-27 收紧：必须先真实命中中国主体，再命中负面关键词；港台疆藏单独出现不再触发。
  const txt = String(it.title || '') + ' ' + String(it.content || '');
  if (!scrapers.isChinaRelatedStrict(txt)) return false;
  const negRe = globalmedia._CHINA_NEGATIVE_KW_RE;
  return negRe ? negRe.test(txt) : false;
}
function _bumpDailyStats(inserted, linked, china, chinaNegative) {
  const d = _todayKey();
  if (_dailyStats.date !== d) {
    console.log('[DAILY STATS] 日期切换 ' + _dailyStats.date + ' -> ' + d + '，昨日总量 ' + _dailyStats.total + ' / 涉华 ' + _dailyStats.china + ' / 境外涉华负面 ' + _dailyStats.chinaNegative);
    _dailyStats = { date: d, total: 0, linked: 0, china: 0, chinaNegative: 0, rounds: 0, lastRound: null };
  }
  _dailyStats.total += (inserted || 0);
  _dailyStats.linked += (linked || 0);
  _dailyStats.china += (china || 0);
  _dailyStats.chinaNegative += (chinaNegative || 0);
  _dailyStats.rounds += 1;
  _dailyStats.lastRound = new Date().toISOString();
  _saveDailyStats();
}
function _logDailyStats() {
  const s = _dailyStats;
  const totalGap = Math.max(0, 500 - s.total);
  const chinaGap = Math.max(0, 80 - s.china);
  const chinaCap = Math.max(0, s.china - 100);
  const negGap = Math.max(0, 50 - s.chinaNegative);
  console.log('[DAILY STATS] 今日 ' + s.date + ' | 总量 ' + s.total + '（下限500，还差' + totalGap + '，不设上限）| 涉华 ' + s.china + '（目标80-100，差' + chinaGap + '，超' + chinaCap + '）| 境外涉华负面 ' + s.chinaNegative + '（目标≥50，差' + negGap + '）| 已跑' + s.rounds + '轮');
}
function _dedupByUrl(arr) {
  const seen = new Set();
  return (arr || []).filter(o => {
    const k = String(o.url || '').replace(/\/+$/, '').toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
/* 通用 linked 入库通道（2026-08-25 抽取）：GLOBALMEDIA 主循环与涉华安全哨兵共用
 * 同一套 URL去重/标题去重/事件签名/时效/配额/入库/统计链路，任何通道进来的数据过同样的闸。 */
async function _ingestLinkedItems(items, tag, note) {
  tag = tag || 'GLOBALMEDIA'; note = note || '';
  try {
    const linked = items.filter(it => it.interestLinked === true);
    /* _sourceType 溯源铁律（2026-08-29 三部委审查 P2-4）：7 天 600 条(21%)无 _sourceType，
     * 通道分布排查不可溯源。此处统一兜底——通道漏设时按采集器 tag 推导，不再产生空值。 */
    const _TAG_TYPE = {
      'GLOBALMEDIA': 'media', 'SOURCES-PACK': 'sources_pack', 'CORE-THREAT': 'core_threat_watch',
      'CORE-THREAT-MANUAL': 'core_threat_watch', 'CHANNEL-WATCH': 'channel_watch', 'COMPLIANCE-WATCH': 'compliance_watch',
      'CONSULAR-WATCH': 'consular_watch', 'CT-SENTINEL': 'core_threat_sentinel', 'PROJECT-WATCH': 'project_watch',
      'PROJECT-WATCH-MANUAL': 'project_watch', 'CNSEC': 'cnsec_watch', 'WECHAT-MIRROR': 'wechat_oa',
      'WECHAT-LEAD': 'wechat_lead', 'TERROR': 'terror_attack', 'CAT-BAL': 'category_balance', 'REGION-BAL': 'region_balance', 'GAP-SCHED': 'gap_scheduler',
      'WM-FEED': 'wm_feed', 'THREATROOM': 'threatroom'
    };
    linked.forEach(it => { if (!it._sourceType) it._sourceType = _TAG_TYPE[tag] || ('channel_' + String(tag).toLowerCase()); });
    console.log('[' + tag + '] 待入库 linked: ' + linked.length + ' 条');
    if (!linked.length) return { inserted: 0 };
    const urls = linked.map(it => it.url).filter(Boolean);
    const existing = new Set();
    if (urls.length) {
      const batch = urls.map((_, i) => `$${i + 1}`).join(',');
      const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
      dup.rows.forEach(r => { if (r.url) existing.add(r.url); });
    }
    console.log('[' + tag + '] urls=' + urls.length + ' existing=' + existing.size);
    /* 拒收漏斗累加（2026-08-31 任务 #521）：在闸门判定的同时把分类数累加到 _rejectsSession */
    const _rj = _rejectsSession; const _d = _todayKey();
    if (_rj.date !== _d) { _rj.date = _d; _rj.collected = 0; _rj.linked = 0; _rj.inserted = 0; _rj.dupUrl = 0; _rj.dupTitle = 0; _rj.dupEvent = 0; _rj.domestic = 0; _rj.badTitle = 0; _rj.historical = 0; _rj.stale = 0; _rj.ruUa = 0; _rj.catStruct = 0; _rj.noUrl = 0; _rj.insertErr = 0; _rj.bySource = {}; }
    _rj.linked += linked.length;
    _rj.collected += items.length;     /* 原始抓取数 = 调用方传入的 items 数组长度（含被 gate 过滤掉的） */
    if (!_rj.bySource[tag]) _rj.bySource[tag] = { collected: 0, linked: 0, inserted: 0, rejected: 0 };
    _rj.bySource[tag].linked += linked.length;
    _rj.bySource[tag].collected += items.length;
    const _bumpRej = (code) => { _rj.bySource[tag].rejected++; if (code === 'dup-url') _rj.dupUrl++; else if (code === 'dup-title' || code === 'dup-title-zh' || code === 'dup-entity') _rj.dupTitle++; else if (code === 'dup-event' || code === 'event-flood') _rj.dupEvent++; else if (code === 'domestic') _rj.domestic++; else if (code === 'bad-title') _rj.badTitle++; else if (code === 'historical') _rj.historical++; else if (code === 'stale') _rj.stale++; else if (code === 'ruua-quota' || code === 'dominant-quota') _rj.ruUa++; else if (code === 'cat-struct') _rj.catStruct++; else if (code === 'no-url') _rj.noUrl++; else if (code === 'insert-err') _rj.insertErr++; };
    let inserted = 0, skippedDup = 0, skippedNoUrl = 0, insertErr = 0, skippedDupTitle = 0, skippedStale = 0, skippedRuUa = 0, skippedDomestic = 0, skippedBadTitle = 0, skippedEventSig = 0, skippedHistorical = 0, skippedCatStruct = 0;
    let chinaInserted = 0, chinaNegativeInserted = 0;
    const titleKeys = await _getRecentTitleKeys();
    const eventSigs = await _getRecentEventSigs();
    for (const it of linked) {
      const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
      if (!gate.ok) {
        gate.code.forEach(c => {
          if (c === 'no-url-title') { skippedNoUrl++; _bumpRej('no-url'); }
          else if (c === 'url-dup') { skippedDup++; _bumpRej('dup-url'); }
          else if (c === 'title-dup' || c === 'title-zh-dup' || c === 'entity-dup') { skippedDupTitle++; _bumpRej('dup-title'); }
          else if (c === 'event-sig-dup') { skippedEventSig++; _bumpRej('dup-event'); }
          else if (c === 'event-flood') { skippedEventSig++; _bumpRej('event-flood'); } /* 事件簇变体刷屏（计数并入签名重复便于观察） */
          else if (c === 'cat-structure') { skippedCatStruct++; _bumpRej('cat-struct'); } /* 类别结构帽：安全类超占比让位弱类 */
          else if (c === 'domestic-china') { skippedDomestic++; _bumpRej('domestic'); }
          else if (c === 'bad-title') { skippedBadTitle++; _bumpRej('bad-title'); }
          else if (c === 'historical-retrospect') { skippedHistorical++; _bumpRej('historical'); }
        });
        /* 2026-08-28：被拦条目入非预警数据池（url/标题重复除外——同条已有库内版本，入池即刷屏） */
        if (!gate.code.includes('url-dup') && !gate.code.includes('title-dup') && !gate.code.includes('title-zh-dup') && !gate.code.includes('entity-dup')) {
          _sidepool(it, gate.code.join(','), tag);
        }
        continue;
      }
      if (!_isFreshEnough(it)) { skippedStale++; _bumpRej('stale'); _sidepool(it, 'stale-over24h', tag); continue; }
      if (!_ruUaQuotaOk(it)) { skippedRuUa++; _bumpRej('ruua-quota'); _sidepool(it, 'ruua-quota', tag); continue; }
      if (!_dominantQuotaOk(it)) { _gateAudit('入库闸', 'dominant-quota', it.title); skippedRuUa++; _bumpRej('dominant-quota'); _sidepool(it, 'dominant-quota', tag); continue; }
      try {
        _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
        /* 中文阅读习惯终抛光（#483/#484/#485 咽喉位：覆盖全部采集通道，含绕过 _localizeTitleTail 的链路）
         * L1 尾部媒体/URL/标点 + L2 句式重写 + L4 质量分落 data_json.zhq */
        if (/[\u4e00-\u9fa5]/.test(String(it.title || ''))) {
          const _zhc = String(it.title || '');
          const _zhp = zhPolish.polishTitle(_zhc);
          const _zhr = zhRewrite.rewrite(_zhp, { country: it.country_cn || it.country });
          if (_zhr && _zhr !== _zhc && _zhr.length >= 6) {
            if (!it.title_en) it.title_en = _zhc;
            it.title = _zhr; it.title_zh = _zhr;
          }
          it.zhq = zhRewrite.quality(it.title);
          if (it.zhq < 60 && _ZHQ_LOG_N < 12) { _ZHQ_LOG_N++; console.log('[ZHQ] 低分样本(' + it.zhq + '): ' + String(it.title).slice(0, 60)); }
        }
        _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv;
        /* 专项采集器（如 core-threat-watch）已明确 data_type，不再被通用分类器覆盖 */
        let _dt = (it._forceDataType && it.data_type) ? it.data_type : _classifyIntelType(it);
        /* 涉华安全类必须真实命中中国要素，否则降级为开源情报 */
        if (_dt === 'security_events' && !_isChinaLinked(it)) { _dt = 'osint_intel'; }
        it.data_type = _dt;
        const _ins = await query(
          `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || '', _lv, it.content || '', it.source || '全球海量媒体监测', JSON.stringify(it), 'approved']
        );
        if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
        inserted++;
        _rj.inserted++; _rj.bySource[tag].inserted++;
        if (_isChinaNegative(it)) chinaNegativeInserted++;
        else if (_isChinaLinked(it)) chinaInserted++;
      } catch (e) { insertErr++; _bumpRej('insert-err'); console.warn('[' + tag + '] INSERT ERR:', e.message); }
    }
    _bumpDailyStats(inserted, linked.length, chinaInserted, chinaNegativeInserted);
    _logDailyStats();
    _saveRejectsSession();
    console.log('[' + tag + '] 实时入库 osint_intel: ' + inserted + ' 条（涉华' + chinaInserted + ' / 境外涉华负面' + chinaNegativeInserted + '），跳过URL重复 ' + skippedDup + '，标题/实体重复 ' + skippedDupTitle + '，事件签名重复 ' + skippedEventSig + '，国内数据 ' + skippedDomestic + '，低质标题 ' + skippedBadTitle + '，历史旧案 ' + skippedHistorical + '，超时旧闻 ' + skippedStale + '，俄乌超配额 ' + skippedRuUa + '，类别结构帽 ' + skippedCatStruct + '，无url ' + skippedNoUrl + '，插入失败 ' + insertErr + note);
    return { inserted };
  } catch (e) {
    console.warn('[' + tag + '] PostgreSQL 入库异常（可能未启动），降级写入 osint_intel 文件缓存:', e.message);
    try {
      const linked = items.filter(it => it.interestLinked === true);
      let cacheChina = 0;
      linked.forEach(it => { if (_isChinaLinked(it)) cacheChina++; });
      if (linked.length) {
        _mergePublicCache('osint_intel', linked);
        _bumpDailyStats(linked.length, linked.length, cacheChina, 0);
        _logDailyStats();
      }
    } catch (e2) {}
    return { inserted: 0 };
  }
}

async function _runGlobalMedia() {
  if (Date.now() < _globalMediaBusyUntil) return;
  _globalMediaBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  console.log('[GLOBALMEDIA] 开始本轮采集...');
  const t0 = Date.now();
  try {
    /* 新闻媒体 RSS：涉华/中国源优先 + 亚太源加权 + 重点源必抓 + 普通源轮询 */
    const allRss = globalmedia.DIRECT_RSS || [];
    const _sourceText = s => ((s.cn || '') + ' ' + (s.name || '') + ' ' + (s.focus || '') + ' ' + (s.region || '')).toLowerCase();
    const chinaBoost = allRss.filter(s => /中国|hong kong|taiwan|macau|chinese|scmp|nikkei asia|cgtn|xinhua|global times|china daily/.test(_sourceText(s))).slice(0, 15);
    const chinaUrlSet = new Set(chinaBoost.map(s => String(s.url || '').replace(/\/+$/, '').toLowerCase()));
    const asiaBoost = allRss.filter(s => {
      if (chinaUrlSet.has(String(s.url || '').replace(/\/+$/, '').toLowerCase())) return false;
      return /东亚|东南亚|南亚|中亚|东北亚|大洋洲|俄罗斯与独联体|日本|韩国|印度|印尼|新加坡|马来西亚|泰国|越南|菲律宾|缅甸|老挝|柬埔寨|文莱|澳大利亚|新西兰|蒙古|亚太|asia|asean|indo-pacific|pacific/.test(_sourceText(s));
    }).slice(0, 15);
    const priority = _dedupByUrl(chinaBoost.concat(asiaBoost).concat(allRss.slice(0, Math.max(0, RSS_PRIORITY_COUNT - chinaBoost.length - asiaBoost.length))));
    const normalStart = RSS_PRIORITY_COUNT + ((_rssRoundIndex * RSS_ROTATE_COUNT) % Math.max(1, allRss.length - RSS_PRIORITY_COUNT));
    const rotated = allRss.slice(normalStart, normalStart + RSS_ROTATE_COUNT);
    const rssSources = _dedupByUrl(priority.concat(rotated));
    _rssRoundIndex++;

    /* 智库 RSS：中国/亚太专项智库每轮必抓 + 普通智库轮询 */
    const allTt = globalmedia.THINK_TANK_FEEDS || [];
    const chinaTtBoost = allTt.filter(s => /china|chinese|asia|asian|indo-pacific|pacific|merics|asan|lowy|aspi|east asia|siis|ciis|cicir|jiia|nids|kida|iseas|rsis|pangoal|cf40|cass|think tank china/.test(((s.name || '') + ' ' + (s.focus || '')).toLowerCase())).slice(0, TT_PRIORITY_COUNT);
    const ttStart = ((_rssRoundIndex * TT_ROTATE_COUNT) % Math.max(1, allTt.length));
    const ttRotated = allTt.slice(ttStart, ttStart + TT_ROTATE_COUNT);
    const ttSources = _dedupByUrl(chinaTtBoost.concat(ttRotated));

    console.log('[GLOBALMEDIA] 本轮源: 媒体 ' + rssSources.length + '（重点' + priority.length + '+轮询' + rotated.length + '）/ 智库 ' + ttSources.length);

    /* 并行抓取：新闻媒体 RSS + 智库/研究机构 RSS + GDELT 主题检索通道（增量新URL来源） */
    const gnAll = globalmedia.GDELT_THEME_QUERIES || [];
    /* 涉华专项 4 条 + 涉华负面 8 条每轮必抓（2026-08-25 用户指令：涉华负面采集量太少）；
     * 其余每轮轮换 THEME_ROTATE_COUNT 条（调速器动态调整） */
    const gnChina = gnAll.slice(0, 4).concat(gnAll.filter(s => /涉华项目抗议|债务陷阱|中资项目受阻|排华|渗透指控|科技封堵|涉疆|南海台海/.test(s.focus || '')));
    const gnRest = gnAll.filter(s => gnChina.indexOf(s) < 0);
    const gnStart = gnRest.length ? ((_rssRoundIndex * THEME_ROTATE_COUNT) % gnRest.length) : 0;
    const gnRotated = gnRest.slice(gnStart, gnStart + THEME_ROTATE_COUNT).concat(gnRest.slice(0, Math.max(0, gnStart + THEME_ROTATE_COUNT - gnRest.length)));
    const [rss, tanks, gnews, social, channel] = await Promise.all([
      globalmedia.scrapeDirectRss({ sources: rssSources, concurrency: RSS_CONCURRENCY, timeout: RSS_TIMEOUT_MS }),
      globalmedia.scrapeThinkTanks({ sources: ttSources, concurrency: RSS_CONCURRENCY, timeout: RSS_TIMEOUT_MS }),
      globalmedia.scrapeGdeltThemes({ queries: gnChina.concat(gnRotated), maxPerQuery: 20 }).catch(e => { console.warn('[GLOBALMEDIA] GDELT主题通道异常:', e.message); return { count: 0, items: [] }; }),
      /* 社交媒体通道（Telegram 公开频道网页预览 + Reddit RSS，2026-08-13 并入主循环；模块内部5分钟节流） */
      socialmedia.scrapeSocialMedia().catch(e => { console.warn('[GLOBALMEDIA] 社媒通道异常:', e.message); return { count: 0, items: [] }; }),
      /* 航道与走廊安全专项通道（2026-08-14：海盗/航运要道/中欧班列，11个专业源） */
      globalmedia.scrapeChannelWatch({ concurrency: 5, timeout: 9000 }).catch(e => { console.warn('[GLOBALMEDIA] 航道通道异常:', e.message); return { count: 0, items: [] }; })
    ]);

    /* 涉华抓取重点说明：
     * 1. media_feeds.js 已登记大量国际主流媒体、中国及亚太媒体、智库研究机构；
     * 2. globalmedia.gateRelevant / scoreDimensions 中的 A/B 维度专门捕获涉华/一带一路/中资内容；
     * 3. 直连 RSS 中的 SCMP、Nikkei Asia、中国日报、环球时报、新华社、CGTN 等是涉华高密度源；
     * 4. 智库源中的 CSIS China Power、Brookings China、MERICS、Asan Institute 等专门研究中国。
     * 因此无需在每轮都调用慢速 GDELT 涉华搜索，避免阻塞 30-60 秒。 */
    let items = (rss.items || []).concat(tanks.items || []).concat(gnews.items || []).concat(social.items || []).concat(channel.items || []);
    console.log('[GLOBALMEDIA] 主题检索通道(AP主/GDELT兜底)本轮: ' + (gnews.count || 0) + ' 条（涉华+涉华负面' + gnChina.length + '词+轮换' + gnRotated.length + '词）');
    if (!social.throttled) console.log('[GLOBALMEDIA] 社媒通道(TG+Reddit)本轮: ' + (social.count || 0) + ' 条');
    console.log('[GLOBALMEDIA] 航道走廊专项本轮: ' + (channel.count || 0) + ' 条');
    let byCountry = Object.assign({}, rss.byCountry || {});
    Object.keys(tanks.byCountry || {}).forEach(k => { byCountry[k] = (byCountry[k] || []).concat(tanks.byCountry[k]); });

    try { await _translateListToZhParallel(items, 6); } catch (e) { console.warn('[GLOBALMEDIA] 翻译异常:', e.message); }

    _writeMediaCache(items, byCountry, { rss: rss.count, thinkTanks: tanks.count });

    /* 入库前统一跑实体关联 enrich：获取 riskScore/alertLevel/关联实体等字段；
     * 但 GLOBALMEDIA 的 RSS 条目已经过 chinaOverseasGate 权威闸门判定为与我海外利益安全相关，
     * 因此即使 enrich 未命中具体企业/项目（如关税争端、台海航运、海外华企遇袭等新闻性标题），
     * 仍应入库并标记 interestLinked=true，避免大量相关情报被 entities.js 的硬关联门槛误拦。 */
    let _beforeTrue = 0, _afterTrue = 0;
    const negRe = globalmedia._CHINA_NEGATIVE_KW_RE;
    const chinaRe = /中国|Chinese|China|Beijing|Shanghai|中资|中企|中方|华人|华侨|华裔|一带一路|Hong Kong|Taiwan|Macau|RMB|Yuan|Huawei|ZTE|TikTok|WeChat|BRI|Belt and Road/i;
    items.forEach(it => {
      try {
        const before = it.interestLinked;
        if (before === true) _beforeTrue++;
        ENTITY.enrich(it);
        /* 强制保留 gate 已放行的海外利益安全情报 */
        if (before === true) it.interestLinked = true;
        if (it.interestLinked === true) _afterTrue++;
        /* 境外涉华负面信号标记：已放行涉华条目若同时命中负面关键词，单独计数（不占常规涉华指标） */
        if (negRe && it.interestLinked === true && chinaRe.test((it.title || '') + ' ' + (it.content || '')) && negRe.test((it.title || '') + ' ' + (it.content || ''))) {
          it._chinaNegative = true;
          it.sentiment = 'negative';
          it.category = '境外涉华负面情报';
        }
      } catch (e) {}
    });
    console.log('[GLOBALMEDIA] enrich 前后 interestLinked=true: ' + _beforeTrue + ' -> ' + _afterTrue + ' / 总 ' + items.length);

    /* 实时入库：按 url 去重后直入 PostgreSQL 数据库系统（2026-08-25 抽取为通用通道，哨兵共用）。 */
    await _ingestLinkedItems(items, 'GLOBALMEDIA', '（媒体' + (rss.count || 0) + ' / 智库' + (tanks.count || 0) + '）');

    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[GLOBALMEDIA] 采集完成(' + sec + 's): 媒体' + (rss.count || 0) + '条 / 智库' + (tanks.count || 0) + '条，覆盖 ' + Object.keys(byCountry).length + ' 国/地区');
  } catch (e) { console.warn('[GLOBALMEDIA] 采集失败:', e.message); }
  finally { _globalMediaBusyUntil = 0; }
}

/* ===== Neon 云采集同步（2026-08-24 方案二：GitHub Actions 关机也采） =====
 * Actions 每小时在美国机房采集原始条目写入 Neon action_raw_items（只采不译不过闸）；
 * 本地每 10 分钟拉取游标之后的新行，走与 _runGlobalMedia 完全同一套
 * enrich + _preInsertGate + 翻译 + 入库链路（质量逻辑单源化）。
 * 处理完即从 Neon 删除并推进游标，保住免费层 0.5GB 额度。 */
const NEON_CURSOR_FILE = path.join(CACHE_DIR, 'neon-sync.json');
let _neonPool = null;
let _neonBusyUntil = 0;
function _readNeonCursor() { try { return parseInt(JSON.parse(fs.readFileSync(NEON_CURSOR_FILE, 'utf8')).lastId, 10) || 0; } catch (e) { return 0; } }
function _writeNeonCursor(id) { try { fs.writeFileSync(NEON_CURSOR_FILE, JSON.stringify({ lastId: parseInt(id, 10) || 0, at: new Date().toISOString() })); } catch (e) {} }

async function _runNeonSync() {
  if (!process.env.NEON_DATABASE_URL) return;   // 未配置云采集连接串：静默跳过，不影响本地采集
  if (Date.now() < _neonBusyUntil) return;
  _neonBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    if (!_neonPool) {
      _neonPool = new (require('pg').Pool)({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2, connectionTimeoutMillis: 15000 });
      _neonPool.on('error', () => {});
    }
    const cursor = _readNeonCursor();
    const { rows } = await _neonPool.query('SELECT id, payload FROM action_raw_items WHERE id > $1 ORDER BY id ASC LIMIT 500', [cursor]);
    if (!rows.length) return;
    const items = [];
    let maxId = cursor;
    rows.forEach(r => {
      const rid = parseInt(r.id, 10) || 0;   /* int8 经 pg 返回字符串，必须数值化否则字符串比较卡死游标（"100">"99"=false，2026-08-25 实测） */
      if (rid > maxId) maxId = rid;
      const it = r.payload || {};
      if (!it.url || !it.title) return;
      it._neonId = r.id;
      items.push(it);
    });
    console.log('[NEON] 拉到云采集原始条目 ' + items.length + ' 条（游标 ' + cursor + ' → ' + maxId + '）');

    try { await _translateListToZhParallel(items, 6); } catch (e) { console.warn('[NEON] 翻译异常:', e.message); }

    /* enrich + 保留采集期闸门判定（与 _runGlobalMedia 同一套逻辑） */
    items.forEach(it => {
      try {
        const before = it.interestLinked;
        ENTITY.enrich(it);
        if (before === true) it.interestLinked = true;
      } catch (e) {}
    });
    const linked = items.filter(it => it.interestLinked === true);

    /* 2026-08-25：云管道 AP 主题条目大面积缺日期（实测 66/194，Runner 上 AP 检索页日期抽取失灵），
     * 且 apnews URL 是 hash 无内嵌日期，时效闸三途径都救不了 → 好情报被误杀。
     * 入库闸前对无日期条目限量回抓文章页 meta 发布时间（AP 页有 article:published_time），
     * 抓不到的交给时效闸如实拦截。 */
    const undated = linked.filter(it => !it.publish_time && !it.publishedAt && !it.pubDate && !it.event_date && !it.date && it.url).slice(0, 12);
    if (undated.length) {
      let rescued = 0;
      await Promise.all(undated.map(async it => {
        try {
          const html = await crawler.fetchPublic(String(it.url), 8000);
          if (!html) return;
          const m = html.match(/article:published_time[^>]*content=["']([^"']+)["']/i) ||
                    html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
          if (m) { const d = new Date(m[1]); if (!isNaN(d.getTime())) { it.publish_time = d.toISOString(); rescued++; } }
        } catch (e) {}
      }));
      if (rescued) console.log('[NEON] 无日期条目回抓发布时间：救回 ' + rescued + '/' + undated.length + ' 条');
    }

    let inserted = 0, skipped = 0;
    if (linked.length) {
      const urls = linked.map(it => it.url).filter(Boolean);
      const existing = new Set();
      if (urls.length) {
        const batch = urls.map((_, i) => '$' + (i + 1)).join(',');
        const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
        dup.rows.forEach(r => { if (r.url) existing.add(r.url); });
      }
      const titleKeys = await _getRecentTitleKeys();
      const eventSigs = await _getRecentEventSigs();
      for (const it of linked) {
        const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
        if (!gate.ok) { skipped++; if (skipped <= 5) console.log('[NEON] 闸门拦截(' + gate.code.join(',') + '): ' + String(it.title || '').slice(0, 70)); continue; }
        if (!_isFreshEnough(it)) { skipped++; if (skipped <= 5) console.log('[NEON] 时效拦截: ' + String(it.title || '').slice(0, 70)); continue; }
        if (!_ruUaQuotaOk(it)) { skipped++; continue; }
        if (!_dominantQuotaOk(it)) { skipped++; continue; }
        try {
          _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
          _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
          it.source = it.source || '云端采集';
          const _ins = await query(
            `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || '', _lv, it.content || '', it.source, JSON.stringify(it), 'approved']
          );
          if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
          inserted++;
        } catch (e) { skipped++; console.warn('[NEON] INSERT ERR:', e.message); }
      }
    }

    /* 推进游标 + 从 Neon 删除已处理行（免费层额度保护） */
    _writeNeonCursor(maxId);
    await _neonPool.query('DELETE FROM action_raw_items WHERE id <= $1', [maxId]).catch(e => console.warn('[NEON] 云端清理失败:', e.message));

    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[NEON] 同步完成(' + sec + 's): 入库 ' + inserted + ' / 闸门跳过 ' + skipped + ' / 云端已清理至 ' + maxId);
  } catch (e) {
    console.warn('[NEON] 同步失败:', e.message);
    if (_neonPool) { try { await _neonPool.end(); } catch (_) {} _neonPool = null; }
  } finally { _neonBusyUntil = 0; }
}

/* ===== Neon 云端容灾备份：本地 intel_data 增量上行（2026-08-25 用户铁指令"一次性解决数据库"） =====
   定位：本地 PG 仍是主库（低延迟读写），云端 Neon 持有完整副本。
   本地宕机/数据损坏时云端留存全部档案；GitHub Actions 云采集不依赖本机，关机也照采。
   三层防线：① 开机自启链自动拉起 PG ② pg-keepalive 60s 看门狗 ③ 本云端副本兜底。 */
const NEON_BACKUP_CURSOR_FILE = path.join(CACHE_DIR, 'neon-backup.json');
let _neonBkPool = null;
let _neonBackupBusyUntil = 0;
function _readBackupCursor() { try { return parseInt(JSON.parse(fs.readFileSync(NEON_BACKUP_CURSOR_FILE, 'utf8')).lastId, 10) || 0; } catch (e) { return 0; } }
function _writeBackupCursor(id) { try { fs.writeFileSync(NEON_BACKUP_CURSOR_FILE, JSON.stringify({ lastId: parseInt(id, 10) || 0, at: new Date().toISOString() })); } catch (e) {} }
async function _runNeonBackup() {
  if (!process.env.NEON_DATABASE_URL) return;   // 未配置云端连接串：静默跳过
  if (Date.now() < _neonBackupBusyUntil) return;
  _neonBackupBusyUntil = Date.now() + 10 * 60 * 1000;
  try {
    if (!_neonBkPool) {
      _neonBkPool = new (require('pg').Pool)({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2, connectionTimeoutMillis: 15000 });
      _neonBkPool.on('error', () => {});
    }
    await _neonBkPool.query('CREATE TABLE IF NOT EXISTS intel_backup (id BIGINT PRIMARY KEY, data_json JSONB, backed_at TIMESTAMPTZ DEFAULT now())');
    const cursor = _readBackupCursor();
    const { rows } = await query('SELECT id, data_json, collect_time FROM intel_data WHERE id > $1 ORDER BY id ASC LIMIT 1000', [cursor]);
    if (!rows.length) return;
    let ok = 0, maxId = cursor;
    /* 50 行一批多值 INSERT：1000 行仅 20 个往返，免费层友好；失败断点保留下轮重试 */
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const vals = [], params = [];
      chunk.forEach((r, j) => {
        vals.push('($' + (j * 2 + 1) + ', $' + (j * 2 + 2) + ')');
        params.push(r.id, JSON.stringify(Object.assign({}, r.data_json || {}, { collect_time: r.collect_time })));
      });
      try {
        await _neonBkPool.query('INSERT INTO intel_backup (id, data_json) VALUES ' + vals.join(',') + ' ON CONFLICT (id) DO NOTHING', params);
        ok += chunk.length;
        const lastId = parseInt(chunk[chunk.length - 1].id, 10);
        if (lastId > maxId) { maxId = lastId; _writeBackupCursor(maxId); }
      } catch (e) { console.warn('[NEON-BACKUP] 批量写入失败（断点 ' + maxId + ' 下轮续传）:', e.message); break; }
    }
    if (ok) console.log('[NEON-BACKUP] 云端容灾备份 +' + ok + ' 条（游标 ' + cursor + ' → ' + maxId + '）');
  } catch (e) {
    console.warn('[NEON-BACKUP] 备份失败:', e.message);
    if (_neonBkPool) { try { await _neonBkPool.end(); } catch (_) {} _neonBkPool = null; }
  } finally { _neonBackupBusyUntil = 0; }
}

/* ===== 涉华专项采集：每轮单独抓取高命中中文媒体/涉华外媒，确保日涉华80-100条 ===== */
async function _runChinaFocus() {
  if (Date.now() < _chinaFocusBusyUntil) return;
  _chinaFocusBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  console.log('[CHINA FOCUS] 开始涉华专项采集...');
  const t0 = Date.now();
  try {
    const sources = (globalmedia.CHINA_FOCUS_SOURCES || []).slice();
    // 若当日涉华已达标，减少专项源数量避免过度采集；若不足则全量抓
    const s = _dailyStats;
    const needChina = Math.max(0, 90 - s.china);
    const batchSize = needChina <= 0 ? Math.min(10, sources.length) : Math.min(CHINA_FOCUS_COUNT, sources.length);
    // 关键修复：轮询源，避免每轮都抓前 N 个源导致大量重复 URL
    const start = (_chinaFocusRoundIndex * batchSize) % Math.max(1, sources.length);
    let rotated = sources.slice(start, start + batchSize);
    if (rotated.length < batchSize) {
      rotated = rotated.concat(sources.slice(0, batchSize - rotated.length));
    }
    _chinaFocusRoundIndex++;
    if (!rotated.length) { console.log('[CHINA FOCUS] 无涉华专项源'); return; }
    const rss = await globalmedia.scrapeChinaFocus({ sources: rotated, concurrency: RSS_CONCURRENCY, timeout: RSS_TIMEOUT_MS });
    let items = rss.items || [];
    const seenUrl = new Set(items.map(it => it.url).filter(Boolean));

    /* 补充1：GDELT 全球新闻检索涉华外交/经贸/BRI/基础设施信号，扩大新 URL 发现面 */
    try {
      const gdeltQueries = [
        '(China OR Chinese OR Beijing) (diplomat OR embassy OR trade OR investment OR BRI)',
        '(China OR Chinese) (Belt and Road OR infrastructure OR railway OR port OR corridor)',
        '(China OR Chinese OR Beijing) (ASEAN OR Africa OR Latin America OR Middle East)'
      ];
      const gdeltRes = await Promise.all(gdeltQueries.map(q =>
        Promise.race([
          crawler.gdeltSearch(q, { timespan: '2d', maxrecords: 15 }),
          new Promise(resolve => setTimeout(() => resolve([]), 15000))
        ]).catch(() => [])
      ));
      for (const arts of gdeltRes) {
        for (const a of arts || []) {
          if (!a.url || seenUrl.has(a.url)) continue;
          const txt = (a.title || '');
          if (globalmedia._isSoftJunk && globalmedia._isSoftJunk(txt)) continue;
          if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(txt)) continue;
          if (!globalmedia.gateRelevant(txt)) continue;
          const gate = scrapers.chinaOverseasGate(txt);
          if (!globalmedia.chinaFocusGate(txt, gate)) continue;
          seenUrl.add(a.url);
          const cn = globalmedia._isoToCn(a.sourcecountry || '');
          const countryDims = globalmedia._resolveDims({ iso: a.sourcecountry || 'INT', region: '' });
          const sc = globalmedia.scoreDimensions(txt, countryDims);
          items.push({
            title: a.title, content: '', url: a.url,
            country: a.country || cn || '国际', country_cn: cn || '国际', country_iso: a.sourcecountry || 'INT',
            city: '', location: '',
            dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
            source: a.domain || 'GDELT', credibility: globalmedia._sourceCredibility(a.domain || ''), category: '涉华专项情报', data_type: 'osint_intel',
            interestLinked: true, chinaRelated: true, _chinaFocus: true,
            language: a.language || 'en', date: a.seendate || '', publishedAt: a.seendate || '',
            severity: '中',
            _real: true, _fromSource: 'CHINA_FOCUS:GDELT:' + (a.sourcecountry || 'INT'),
            _sourceType: 'china_focus'
          });
        }
      }
    } catch (e) { console.warn('[CHINA FOCUS] GDELT 补充失败:', e.message); }

    /* 补充2：从全部直连 RSS+智库源中扫描涉华信号；与专项源去重，避免重复抓取 */
    try {
      const scanSources = (globalmedia.DIRECT_RSS || []).concat(globalmedia.THINK_TANK_FEEDS || []).filter(s => s && s.url);
      const scan = await globalmedia.scrapeChinaFocus({ sources: scanSources.slice(0, 80), concurrency: RSS_CONCURRENCY, timeout: RSS_TIMEOUT_MS });
      for (const it of scan.items || []) {
        if (!it.url || seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        it._chinaFocus = true;
        it._fromSource = (it._fromSource || '').replace('CHINA_FOCUS:', 'CHINA_FOCUS:SCAN:') || 'CHINA_FOCUS:SCAN';
        items.push(it);
      }
    } catch (e) { console.warn('[CHINA FOCUS] RSS 扫描补充失败:', e.message); }

    try { await _translateListToZhParallel(items, 6); } catch (e) { console.warn('[CHINA FOCUS] 翻译异常:', e.message); }
    /* scrapeChinaFocus 已按海外利益安全闸门 + 中国源放宽规则过滤 */
    items.forEach(it => { if (it._chinaFocus !== true) it._chinaFocus = true; });
    _writeMediaCache(items, rss.byCountry || {}, { chinaFocus: rss.count });
    let inserted = 0, chinaInserted = 0, skippedDup = 0, skippedNoUrl = 0, insertErr = 0, skippedStale = 0, skippedRuUa = 0, skippedDomestic = 0, skippedBadTitle = 0, skippedEventSig = 0;
    const urls = items.map(it => it.url).filter(Boolean);
    const existing = new Set();
    if (urls.length) {
      const batch = urls.map((_, i) => `$${i + 1}`).join(',');
      const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
      dup.rows.forEach(r => { if (r.url) existing.add(r.url); });
    }
    // 详细日志：按源统计命中/入库/重复
    const bySource = {};
    const titleKeys = await _getRecentTitleKeys();
    const eventSigs = await _getRecentEventSigs();
    let skippedDupTitle = 0;
    for (const it of items) {
      const src = it.source || 'unknown';
      bySource[src] = bySource[src] || { hit: 0, dup: 0, inserted: 0 };
      bySource[src].hit++;
      const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
      if (!gate.ok) {
        gate.code.forEach(c => {
          bySource[src].dup++;
          if (c === 'no-url-title') skippedNoUrl++;
          else if (c === 'url-dup') skippedDup++;
          else if (c === 'title-dup' || c === 'title-zh-dup' || c === 'entity-dup') skippedDupTitle++;
          else if (c === 'event-sig-dup') skippedEventSig++;
          else if (c === 'event-flood') skippedEventSig++; /* 事件簇变体刷屏（计数并入签名重复便于观察） */
          else if (c === 'domestic-china') skippedDomestic++;
          else if (c === 'bad-title') skippedBadTitle++;
        });
        continue;
      }
      if (!_isFreshEnough(it)) { skippedStale++; bySource[src].dup++; continue; }
      if (!_ruUaQuotaOk(it)) { skippedRuUa++; bySource[src].dup++; continue; }
      if (!_dominantQuotaOk(it)) { _gateAudit('入库闸', 'dominant-quota', it.title); skippedRuUa++; bySource[src].dup++; continue; }
      try {
        _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
        /* 中文阅读习惯终抛光（#483/#484/#485 咽喉位：覆盖全部采集通道，含绕过 _localizeTitleTail 的链路）
         * L1 尾部媒体/URL/标点 + L2 句式重写 + L4 质量分落 data_json.zhq */
        if (/[\u4e00-\u9fa5]/.test(String(it.title || ''))) {
          const _zhc = String(it.title || '');
          const _zhp = zhPolish.polishTitle(_zhc);
          const _zhr = zhRewrite.rewrite(_zhp, { country: it.country_cn || it.country });
          if (_zhr && _zhr !== _zhc && _zhr.length >= 6) {
            if (!it.title_en) it.title_en = _zhc;
            it.title = _zhr; it.title_zh = _zhr;
          }
          it.zhq = zhRewrite.quality(it.title);
          if (it.zhq < 60 && _ZHQ_LOG_N < 12) { _ZHQ_LOG_N++; console.log('[ZHQ] 低分样本(' + it.zhq + '): ' + String(it.title).slice(0, 60)); }
        }
        _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
        const _ins = await query(
          `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || '', _lv, it.content || '', it.source || '涉华专项监测', JSON.stringify(it), 'approved']
        );
        if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
        inserted++;
        chinaInserted++;
        bySource[src].inserted++;
      } catch (e) { insertErr++; console.warn('[CHINA FOCUS] INSERT ERR:', e.message); }
    }
    // 打印前 5 个源明细，方便定位哪些源在贡献/在重复
    const sourceDetails = Object.entries(bySource)
      .sort((a, b) => b[1].hit - a[1].hit)
      .slice(0, 5)
      .map(([k, v]) => k + ': hit=' + v.hit + '/dup=' + v.dup + '/in=' + v.inserted)
      .join(' | ');
    _bumpDailyStats(inserted, items.length, chinaInserted, 0);
    _logDailyStats();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[CHINA FOCUS] 完成(' + sec + 's): 源' + rotated.length + ' / 命中' + (rss.count || 0) + ' / 入库' + inserted + '（涉华' + chinaInserted + '）URL重复' + skippedDup + ' 标题/实体重复' + skippedDupTitle + ' 事件签名重复' + skippedEventSig + ' 国内数据' + skippedDomestic + ' 低质标题' + skippedBadTitle + ' 旧闻' + skippedStale + ' 俄乌配额' + skippedRuUa + ' 无url' + skippedNoUrl + ' | TOP: ' + sourceDetails);
  } catch (e) { console.warn('[CHINA FOCUS] 采集失败:', e.message); }
  finally { _chinaFocusBusyUntil = 0; }
}

/* ===== 境外涉华负面专项采集：独立通道，每日目标≥50条，不计入常规涉华80-100指标 =====
 * 核心策略：以 AP 开放检索（crawler.apSearch）为主，主动搜索涉华负面关键词；
 * RSS 负面源为兜底补充。AP 检索在当前环境实测可达、命中率高，可稳定补充日采集量。 */
const _CHINA_NEGATIVE_AP_QUERIES = [
  'China sanctions', 'China ban restriction', 'China trade war tariffs',
  'Chinese company raid investigation', 'China protest demonstration',
  'Chinese workers attack kidnapped', 'China espionage spy',
  'South China Sea tensions', 'Taiwan Strait tensions',
  'BRI backlash protest', 'Huawei ban restriction', 'TikTok ban WeChat ban'
];
/* 负面专线断粮哨兵计数器（P0-3） */
let _negDryRounds = 0;
async function _runChinaNegative() {
  if (Date.now() < _chinaNegativeBusyUntil) return;
  _chinaNegativeBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  console.log('[CHINA NEGATIVE] 开始境外涉华负面专项采集...');
  const t0 = Date.now();
  try {
    let items = [];
    const seenUrl = new Set();

    /* 1) RSS 负面源：每轮必跑，作为主要稳定来源 */
    try {
      const sources = (globalmedia.CHINA_NEGATIVE_SOURCES || []).slice();
      // 关键修复：轮询负面源，避免每轮都抓前 20 个导致重复；扩大窗口提高发现率
      const rssBatchSize = Math.min(50, sources.length);
      const start = (_chinaNegativeRoundIndex * rssBatchSize) % Math.max(1, sources.length);
      let rssBatch = sources.slice(start, start + rssBatchSize);
      if (rssBatch.length < rssBatchSize) {
        rssBatch = rssBatch.concat(sources.slice(0, rssBatchSize - rssBatch.length));
      }
      _chinaNegativeRoundIndex++;
      const rss = await Promise.race([
        globalmedia.scrapeChinaNegative({ sources: rssBatch, concurrency: 8, timeout: 8000, debug: true }),
        new Promise(resolve => setTimeout(() => resolve({ items: [], count: 0 }), 30000))
      ]);
      console.log('[CHINA NEGATIVE] RSS源 ' + rssBatch.length + ' / 命中 ' + (rss.count || 0));
      for (const it of rss.items || []) {
        if (!it.url || seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        items.push(it);
      }
    } catch (e) { console.warn('[CHINA NEGATIVE] RSS 失败:', e.message); }

    /* 2) GDELT 补充：全球新闻大数据检索涉华负面信号 */
    try {
      const gdeltQueries = [
        '(China OR Chinese OR Beijing) (sanction OR boycott OR ban OR restriction OR tariff OR export control)',
        '(China OR Chinese) (attack OR protest OR raid OR violence OR kidnapped OR killed OR explosion)',
        '(BRI OR "Belt and Road") (backlash OR protest OR debt OR risk OR delay OR dispute)'
      ];
      const gdeltRes = await Promise.all(gdeltQueries.map(q =>
        Promise.race([
          crawler.gdeltSearch(q, { timespan: '2d', maxrecords: 20 }),
          new Promise(resolve => setTimeout(() => resolve([]), 18000))
        ]).catch(() => [])
      ));
      for (const arts of gdeltRes) {
        for (const a of arts || []) {
          if (!a.url || seenUrl.has(a.url)) continue;
          const txt = (a.title || '');
          if (globalmedia._isSoftJunk && globalmedia._isSoftJunk(txt)) continue;
          if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(txt)) continue;
          if (!globalmedia.gateRelevant(txt)) continue;
          const gate = scrapers.chinaOverseasGate(txt);
          if (!globalmedia.chinaNegativeGate(txt, gate)) continue;
          seenUrl.add(a.url);
          const sc = globalmedia.scoreDimensions(txt, []);
          items.push({
            title: a.title, content: '', url: a.url,
            country: a.country || '国际', country_cn: a.country || '国际', country_iso: a.countryIso || 'INT',
            city: '', location: '',
            dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
            source: a.domain || 'GDELT', credibility: globalmedia._sourceCredibility(a.domain || ''), category: '境外涉华负面情报', data_type: 'osint_intel',
            interestLinked: true, chinaRelated: false, sentiment: 'negative', _chinaNegative: true,
            language: a.language || 'en', date: a.seendate || '', publishedAt: a.seendate || '',
            severity: '中',
            _real: true, _fromSource: 'CHINA_NEGATIVE:GDELT',
            _sourceType: 'china_negative'
          });
        }
      }
    } catch (e) { console.warn('[CHINA NEGATIVE] GDELT 失败:', e.message); }

    /* 2.5) 涉华负面专用采集器（2026-08-14 用户指令：专门工具，8大类词库轮动，负面双闸） */
    try {
      const neg = await Promise.race([
        negtool.collect({ perRound: 6 }),
        new Promise(resolve => setTimeout(() => resolve({ items: [], count: 0 }), 90000))
      ]);
      let negAdded = 0;
      for (const it of neg.items || []) {
        if (!it.url || seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        items.push(it);
        negAdded++;
      }
      console.log('[CHINA NEGATIVE] 专用工具本轮: ' + negAdded + ' 条');
    } catch (e) { console.warn('[CHINA NEGATIVE] 专用工具异常:', e.message); }

    /* 3) AP 开放检索：低频次补充，每 5 分钟才跑一次，避免触发 429 */
    if (Date.now() - _chinaNegativeLastApAt >= CHINA_NEGATIVE_AP_INTERVAL_MS) {
      _chinaNegativeLastApAt = Date.now();
      const _apItem = (a) => {
        if (!a.url || seenUrl.has(a.url)) return null;
        const txt = (a.title || '') + ' ' + (a.description || '');
        if (!globalmedia.gateRelevant(txt)) return null;
        const gate = scrapers.chinaOverseasGate(txt);
        if (!globalmedia.chinaNegativeGate(txt, gate)) return null;
        seenUrl.add(a.url);
        const sc = globalmedia.scoreDimensions(txt, []);
        return {
          title: a.title, content: a.description || '', url: a.url,
          country: a.country || '国际', country_cn: a.country || '国际', country_iso: a.countryIso || 'INT',
          city: a.city || '', location: a.city || '',
          dims: sc.dims, maxScore: sc.maxScore, dimScores: sc.scores,
          source: a.source || 'AP News', category: '境外涉华负面情报', data_type: 'osint_intel',
          interestLinked: true, chinaRelated: false, sentiment: 'negative', _chinaNegative: true,
          language: a.language || 'en', date: a.publishedAt || '', publishedAt: a.publishedAt || '',
          severity: '中',
          _real: true, _fromSource: 'CHINA_NEGATIVE:AP',
          _sourceType: 'china_negative'
        };
      };
      // 每次只跑 3 个查询，降低对 AP 的压力
      const qs = _CHINA_NEGATIVE_AP_QUERIES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
      for (const q of qs) {
        try {
          const arts = await Promise.race([
            crawler.apSearch(q, { maxrecords: 20, pages: 1 }),
            new Promise(resolve => setTimeout(() => resolve([]), 20000))
          ]);
          for (const a of arts || []) {
            const it = _apItem(a);
            if (it) items.push(it);
          }
        } catch (e) { console.warn('[CHINA NEGATIVE] AP 查询失败:', e.message); }
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    /* 3) 翻译 + 入库 */
    try { await _translateListToZhParallel(items, 6); } catch (e) { console.warn('[CHINA NEGATIVE] 翻译异常:', e.message); }
    let inserted = 0, negativeInserted = 0, skippedDup = 0, skippedNoUrl = 0, insertErr = 0, skippedStale = 0, skippedRuUa = 0, skippedDomestic = 0, skippedBadTitle = 0, skippedEventSig = 0;
    const urls = items.map(it => it.url).filter(Boolean);
    const existing = new Set();
    if (urls.length) {
      const batch = urls.map((_, i) => `$${i + 1}`).join(',');
      const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
      dup.rows.forEach(r => { if (r.url) existing.add(r.url); });
    }
    // 详细日志：按源统计命中/入库/重复
    const bySource = {};
    const titleKeys = await _getRecentTitleKeys();
    const eventSigs = await _getRecentEventSigs();
    let skippedDupTitle = 0;
    for (const it of items) {
      const src = it.source || 'unknown';
      bySource[src] = bySource[src] || { hit: 0, dup: 0, inserted: 0 };
      bySource[src].hit++;
      const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
      if (!gate.ok) {
        gate.code.forEach(c => {
          bySource[src].dup++;
          if (c === 'no-url-title') skippedNoUrl++;
          else if (c === 'url-dup') skippedDup++;
          else if (c === 'title-dup' || c === 'title-zh-dup' || c === 'entity-dup') skippedDupTitle++;
          else if (c === 'event-sig-dup') skippedEventSig++;
          else if (c === 'event-flood') skippedEventSig++; /* 事件簇变体刷屏（计数并入签名重复便于观察） */
          else if (c === 'domestic-china') skippedDomestic++;
          else if (c === 'bad-title') skippedBadTitle++;
        });
        continue;
      }
      if (!_isFreshEnough(it)) { skippedStale++; bySource[src].dup++; continue; }
      if (!_ruUaQuotaOk(it)) { skippedRuUa++; bySource[src].dup++; continue; }
      if (!_dominantQuotaOk(it)) { _gateAudit('入库闸', 'dominant-quota', it.title); skippedRuUa++; bySource[src].dup++; continue; }
      try {
        _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
        /* 中文阅读习惯终抛光（#483/#484/#485 咽喉位：覆盖全部采集通道，含绕过 _localizeTitleTail 的链路）
         * L1 尾部媒体/URL/标点 + L2 句式重写 + L4 质量分落 data_json.zhq */
        if (/[\u4e00-\u9fa5]/.test(String(it.title || ''))) {
          const _zhc = String(it.title || '');
          const _zhp = zhPolish.polishTitle(_zhc);
          const _zhr = zhRewrite.rewrite(_zhp, { country: it.country_cn || it.country });
          if (_zhr && _zhr !== _zhc && _zhr.length >= 6) {
            if (!it.title_en) it.title_en = _zhc;
            it.title = _zhr; it.title_zh = _zhr;
          }
          it.zhq = zhRewrite.quality(it.title);
          if (it.zhq < 60 && _ZHQ_LOG_N < 12) { _ZHQ_LOG_N++; console.log('[ZHQ] 低分样本(' + it.zhq + '): ' + String(it.title).slice(0, 60)); }
        }
        _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
        const _ins = await query(
          `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || '', _lv, it.content || '', it.source || '境外涉华负面监测', JSON.stringify(it), 'approved']
        );
        if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
        inserted++;
        negativeInserted++;
        bySource[src].inserted++;
      } catch (e) { insertErr++; console.warn('[CHINA NEGATIVE] INSERT ERR:', e.message); }
    }
    const sourceDetails = Object.entries(bySource)
      .sort((a, b) => b[1].hit - a[1].hit)
      .slice(0, 5)
      .map(([k, v]) => k + ': hit=' + v.hit + '/dup=' + v.dup + '/in=' + v.inserted)
      .join(' | ');
    _bumpDailyStats(inserted, items.length, 0, negativeInserted);
    _logDailyStats();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[CHINA NEGATIVE] 完成(' + sec + 's): 命中' + items.length + ' / 入库' + inserted + '（境外涉华负面' + negativeInserted + '）URL重复' + skippedDup + ' 标题/实体重复' + skippedDupTitle + ' 事件签名重复' + skippedEventSig + ' 国内数据' + skippedDomestic + ' 低质标题' + skippedBadTitle + ' 旧闻' + skippedStale + ' 俄乌配额' + skippedRuUa + ' 无url' + skippedNoUrl + ' | TOP: ' + sourceDetails);
    /* ===== 2026-08-29 三部委审查 P0-3：负面专线断粮哨兵 =====
     * 涉华负面信号 100% 依赖本通道（crawler 路径 chinaNegative() 是死判定），
     * 专线静默失效 = 负面情报归零且无人知晓。连续 8 轮（约 8 分钟）零入库即告警+
     * 重建去重指纹缓存（常见根因：缓存漂移误杀）；连续 20 轮（约 20 分钟）升级报错。 */
    _negDryRounds = (negativeInserted > 0) ? 0 : (_negDryRounds + 1);
    if (_negDryRounds === 8) {
      console.warn('[CHINA NEGATIVE] ⚠️ 断粮哨兵：连续8轮零入库，重建去重指纹缓存（疑缓存漂移误杀）');
      _titleKeyCache = { t: 0, set: new Set() };
    } else if (_negDryRounds === 20) {
      console.error('[CHINA NEGATIVE] 🚨 断粮告警：连续20轮（约20分钟）零涉华负面入库——专线疑似失效，须人工核查 RSS 源与闸门');
    }
  } catch (e) { console.warn('[CHINA NEGATIVE] 采集失败:', e.message); }
  finally { _chinaNegativeBusyUntil = 0; }
}
/* ===== 采集自动驾驶调速器（2026-08-12 用户指令：系统自动达标，不靠人催）=====
 * 每 10 分钟自检一次日指标进度（按当日已过去时间加权），落后即自动升档加码，
 * 达标后自动降档回常态。全程无人值守。 */
let _governorLevel = 0; /* 0=常态 1=加速 2=全力 */
const GOVERNOR_LEVELS = [
  { name: '常态', rssRotate: 30, ttRotate: 20, themeRotate: 4, negApMs: 5 * 60 * 1000 },
  { name: '加速', rssRotate: 50, ttRotate: 30, themeRotate: 6, negApMs: 3 * 60 * 1000 },
  { name: '全力', rssRotate: 80, ttRotate: 40, themeRotate: 9, negApMs: 2 * 60 * 1000 }
];
function _governorApply(level) {
  const L = GOVERNOR_LEVELS[level];
  RSS_ROTATE_COUNT = L.rssRotate;
  TT_ROTATE_COUNT = L.ttRotate;
  THEME_ROTATE_COUNT = L.themeRotate;
  CHINA_NEGATIVE_AP_INTERVAL_MS = L.negApMs;
  console.log('[GOVERNOR] 档位切换 → ' + L.name + '（RSS轮询' + L.rssRotate + ' / 智库' + L.ttRotate + ' / 主题词' + L.themeRotate + ' / 负面AP间隔' + (L.negApMs / 60000) + 'min）');
}
function _governorCheck() {
  try {
    const now = new Date();
    const elapsedMin = now.getHours() * 60 + now.getMinutes();
    if (elapsedMin < 30) return; /* 凌晨前30分钟不评估，避免误加码 */
    const dayRatio = elapsedMin / 1440;
    const s = _dailyStats;
    /* 期望值 = 目标 × 时间进度 × 0.8 容差 */
    const expTotal = 500 * dayRatio * 0.8;
    const expChina = 80 * dayRatio * 0.8;
    const expNeg = 50 * dayRatio * 0.8;
    const behind = (s.total < expTotal ? 1 : 0) + (s.china < expChina ? 1 : 0) + (s.chinaNegative < expNeg ? 1 : 0);
    let target = _governorLevel;
    if (behind >= 2) target = 2;
    else if (behind === 1) target = Math.max(1, target - 0) || 1;
    else target = Math.max(0, _governorLevel - 1); /* 全部达标：降一档 */
    if (behind === 0) target = 0;
    if (target !== _governorLevel) {
      _governorLevel = target;
      _governorApply(target);
      /* 升档时立即追加一轮采集，不等下个周期 */
      if (target > 0) {
        setTimeout(() => { _runGlobalMedia(); }, 2000);
        if (s.chinaNegative < expNeg) { _chinaNegativeLastApAt = 0; setTimeout(() => { _runChinaNegative(); }, 8000); }
        if (s.china < expChina) setTimeout(() => { _runChinaFocus(); }, 15000);
      }
    }
    console.log('[GOVERNOR] 自检：进度' + Math.round(dayRatio * 100) + '% | 总量' + s.total + '/' + Math.round(expTotal) + ' 涉华' + s.china + '/' + Math.round(expChina) + ' 负面' + s.chinaNegative + '/' + Math.round(expNeg) + ' | 落后项=' + behind + ' | 当前档位=' + GOVERNOR_LEVELS[_governorLevel].name);
  } catch (e) { console.warn('[GOVERNOR] 自检异常:', e.message); }
}

/* ===== 采集巡检哨兵（2026-08-15 用户指令：30分钟巡查一遍，采集少了自动加速）=====
 * 与 10 分钟调速器互补：调速器管"档位"，哨兵管"断粮/空转/卡死"。
 * 每 30 分钟：1) 以 PostgreSQL 全库当日实数核对进度（时间加权期望）；
 * 2) 总量落后 → 强行升档 + 立即补跑主通道与涉华专项；
 * 3) 空转检测（相邻两次巡检入库增量 <5 条）→ 重建标题指纹缓存 + 补跑负面/恐袭专项；
 * 4) 巡检状态通过 /api/media/daily-stats 的 patrol 字段对前端透明。 */
let _patrolState = { lastCheck: null, lastDbTotal: 0, lastGain: 0, actions: [], gear: '常态' };
async function _patrolSentinel() {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { rows } = await query(`SELECT COUNT(*) c FROM intel_data WHERE audit_status='approved' AND collect_time >= $1`, [dayStart]);
    const dbToday = parseInt(rows[0].c || '0', 10);
    const now = new Date();
    const elapsedMin = now.getHours() * 60 + now.getMinutes();
    if (elapsedMin < 20) { _patrolState.lastDbTotal = dbToday; _patrolState.lastCheck = now.toISOString(); return; } /* 凌晨前20分钟只记基线 */
    const dayRatio = elapsedMin / 1440;
    const expected = 500 * dayRatio * 0.8;
    const gain = _patrolState.lastDbTotal > 0 ? (dbToday - _patrolState.lastDbTotal) : -1; /* -1=首次巡检无基线 */
    const acts = [];
    /* 1) 总量落后 → 升档 + 立即补跑 */
    if (dbToday < expected) {
      if (_governorLevel < GOVERNOR_LEVELS.length - 1) {
        _governorLevel++;
        _governorApply(_governorLevel);
        acts.push('升档至「' + GOVERNOR_LEVELS[_governorLevel].name + '」');
      }
      acts.push('补跑主采集通道');
      setTimeout(() => { try { _runGlobalMedia(); } catch (e) {} }, 2000);
      if (_dailyStats.china < 80 * dayRatio * 0.8) { acts.push('补跑涉华专项'); setTimeout(() => { try { _runChinaFocus(); } catch (e) {} }, 12000); }
    }
    /* 2) 空转检测：30 分钟几乎无入库 → 重建去重指纹缓存 + 补跑专项 */
    if (gain >= 0 && gain < 5) {
      _titleKeyCache = { t: 0, set: new Set() };
      acts.push('空转修复（指纹缓存重建）');
      setTimeout(() => { try { _runChinaNegative(); } catch (e) {} }, 22000);
      setTimeout(() => { try { _runTerrorAttacks(); } catch (e) {} }, 35000);
    }
    /* BRI 专项进度巡检（日100/巴40 时间加权，落后补跑） */
    if (_briStats.total < 100 * dayRatio * 0.8 || _briStats.pakistan < 40 * dayRatio * 0.8) {
      acts.push('补跑BRI专项');
      setTimeout(() => { try { _runBriFocus(); } catch (e) {} }, 45000);
    }
    _patrolState = { lastCheck: now.toISOString(), lastDbTotal: dbToday, lastGain: gain, actions: acts, gear: GOVERNOR_LEVELS[_governorLevel].name };
    console.log('[PATROL] 巡检：今日入库 ' + dbToday + ' / 期望 ' + Math.round(expected) + '（进度 ' + Math.round(dayRatio * 100) + '%）| 30min增量 ' + (gain < 0 ? '基线' : gain) + ' | 档位 ' + GOVERNOR_LEVELS[_governorLevel].name + (acts.length ? ' | 动作: ' + acts.join('、') : ' | 正常'));
  } catch (e) { console.warn('[PATROL] 巡检异常:', e.message); }
}

/* ===== BRI 专项采集器（2026-08-16 用户指令）=====
 * 一带一路国家 / 中巴经济走廊 / 中欧班列沿线 专项采集。
 * 硬性指标：BRI 总量 ≥100 条/日，其中巴基斯坦 ≥40 条/日。
 * 复用 AP/GDELT 主题检索通道；独立统计、独立调度、巡检哨兵联动补跑。 */
const BRI_PK_QUERIES = [
  { q: 'Pakistan (CPEC OR "China-Pakistan Economic Corridor" OR Gwadar) (project OR security OR attack OR progress)', cn: '巴基斯坦', iso: 'PK', focus: '中巴经济走廊' },
  { q: 'Pakistan (TTP OR "Tehrik-e-Taliban" OR BLA OR Balochistan) (attack OR blast OR killed OR clash)', cn: '巴基斯坦', iso: 'PK', focus: '巴安全局势' },
  { q: '(Karachi OR Lahore OR Islamabad OR Quetta OR Peshawar OR Gwadar) (attack OR blast OR explosion OR gunmen OR protest)', cn: '巴基斯坦', iso: 'PK', focus: '巴城市安全' },
  { q: 'Pakistan (China OR Chinese) (workers OR engineers OR nationals OR investment OR project)', cn: '巴基斯坦', iso: 'PK', focus: '在巴中方人员项目' },
  { q: 'Pakistan (IMF OR debt OR inflation OR rupee OR economy OR default)', cn: '巴基斯坦', iso: 'PK', focus: '巴经济风险' },
  { q: '(Lashkar OR Jaish OR LeT OR JeM OR Hizbul) (Pakistan OR Kashmir OR attack OR arrested)', cn: '巴基斯坦', iso: 'PK', focus: '巴恐怖组织' },
  { q: 'Pakistan (army OR "security forces" OR police) (operation OR raid OR killed OR arrested) (militant OR terrorist)', cn: '巴基斯坦', iso: 'PK', focus: '巴反恐行动' },
  { q: 'Pakistan (flood OR earthquake OR epidemic OR polio OR dengue OR monsoon)', cn: '巴基斯坦', iso: 'PK', focus: '巴灾害卫生' },
  { q: 'Pakistan (border OR "border crossing" OR Torkham OR Chaman OR Wagah) (Afghanistan OR India OR clash OR trade)', cn: '巴基斯坦', iso: 'PK', focus: '巴边境动态' },
  { q: 'Pakistan (sectarian OR Shia OR Sunni OR mosque OR procession) (attack OR blast OR tension)', cn: '巴基斯坦', iso: 'PK', focus: '巴教派冲突' },
  { q: '(Gwadar OR "port of Gwadar") (protest OR security OR development OR "free zone" OR airport)', cn: '巴基斯坦', iso: 'PK', focus: '瓜达尔专项' },
  { q: 'Pakistan (military OR ISPR OR army) (statement OR operation OR "cross-border" OR Afghanistan)', cn: '巴基斯坦', iso: 'PK', focus: '巴军方动态' }
];
const BRI_CORRIDOR_QUERIES = [
  { q: '(Kazakhstan OR Uzbekistan OR Kyrgyzstan OR Tajikistan OR Turkmenistan) (China OR Chinese) (pipeline OR railway OR investment OR security)', cn: '哈萨克斯坦', iso: 'KZ', focus: '中亚走廊' },
  { q: '(Laos OR Cambodia OR "China-Laos railway" OR Boten) (China OR railway OR investment OR security)', cn: '老挝', iso: 'LA', focus: '中老走廊' },
  { q: '(Myanmar OR "China-Myanmar") (pipeline OR "economic corridor" OR Kyaukpyu OR conflict)', cn: '缅甸', iso: 'MM', focus: '中缅走廊' },
  { q: '(Indonesia OR "Jakarta-Bandung" OR Whoosh) (China OR railway OR investment OR protest)', cn: '印度尼西亚', iso: 'ID', focus: '印尼走廊' },
  { q: '(Malaysia OR Thailand OR Vietnam OR Philippines) (China OR "Belt and Road" OR railway OR port) (investment OR dispute OR security)', cn: '马来西亚', iso: 'MY', focus: '东盟走廊' },
  { q: '(Serbia OR Hungary OR Greece OR Piraeus) (China OR Chinese OR "Belt and Road") (railway OR port OR investment)', cn: '塞尔维亚', iso: 'RS', focus: '欧洲走廊' },
  { q: '(Ethiopia OR Kenya OR Djibouti OR Egypt) (China OR Chinese) (railway OR port OR debt OR project)', cn: '埃塞俄比亚', iso: 'ET', focus: '非洲走廊' },
  { q: '(Sri Lanka OR Hambantota OR Colombo) (China OR Chinese OR port OR debt)', cn: '斯里兰卡', iso: 'LK', focus: '斯里兰卡走廊' },
  { q: '(Saudi OR UAE OR Iran OR Turkey) (China OR Chinese) ("Belt and Road" OR investment OR railway OR energy)', cn: '沙特阿拉伯', iso: 'SA', focus: '中东走廊' },
  { q: '(Bangladesh OR Nepal OR Maldives) (China OR Chinese) (project OR loan OR port OR bridge)', cn: '孟加拉国', iso: 'BD', focus: '南亚走廊' }
];
const BRI_RAIL_QUERIES = [
  { q: '("China Railway Express" OR "China-Europe Railway" OR "China-Europe freight train")', cn: '国际', iso: 'UN', focus: '中欧班列' },
  { q: '(Belarus OR Poland OR Malaszewicze OR Brest) (railway OR freight OR border) (China OR container)', cn: '白俄罗斯', iso: 'BY', focus: '班列东欧段' },
  { q: '("China-Europe" OR "China freight") (train OR railway) (Germany OR Duisburg OR Hamburg OR Poland)', cn: '德国', iso: 'DE', focus: '班列西欧段' },
  { q: '("middle corridor" OR "Trans-Caspian") (China OR freight OR railway)', cn: '哈萨克斯坦', iso: 'KZ', focus: '跨里海通道' }
];
/* BRI 沿线国家本地媒体直连 RSS（2026-08-16：主题检索与主通道同后端导致全重复 0 入库，
 * 本地媒体 RSS 的 URL 与 AP/GDELT 不重叠，是巴基斯坦日 40 条的增量来源） */
const BRI_RSS = [
  /* 巴基斯坦（重点，每轮必抓） */
  { name: 'Dawn', url: 'https://www.dawn.com/feeds/home', cn: '巴基斯坦', iso: 'PK' },
  { name: 'Dawn National', url: 'https://www.dawn.com/feeds/national', cn: '巴基斯坦', iso: 'PK' },
  { name: 'Express Tribune', url: 'https://tribune.com.pk/feed/', cn: '巴基斯坦', iso: 'PK' },
  { name: 'The News', url: 'https://www.thenews.com.pk/rss/', cn: '巴基斯坦', iso: 'PK' },
  { name: 'ARY News', url: 'https://arynews.tv/feed/', cn: '巴基斯坦', iso: 'PK' },
  { name: 'Pakistan Today', url: 'https://www.pakistantoday.com.pk/feed/', cn: '巴基斯坦', iso: 'PK' },
  { name: 'Daily Times PK', url: 'https://dailytimes.com.pk/feed/', cn: '巴基斯坦', iso: 'PK' },
  { name: 'The Nation PK', url: 'https://nation.com.pk/rss.xml', cn: '巴基斯坦', iso: 'PK' },
  { name: 'Business Recorder', url: 'https://www.brecorder.com/feeds/rss', cn: '巴基斯坦', iso: 'PK' },
  /* 走廊国家（轮换） */
  { name: 'Astana Times', url: 'https://astanatimes.com/feed/', cn: '哈萨克斯坦', iso: 'KZ' },
  { name: 'Phnom Penh Post', url: 'https://www.phnompenhpost.com/rss', cn: '柬埔寨', iso: 'KH' },
  { name: 'Jakarta Post', url: 'https://www.thejakartapost.com/rss', cn: '印度尼西亚', iso: 'ID' },
  { name: 'Daily Star BD', url: 'https://www.thedailystar.net/rss', cn: '孟加拉国', iso: 'BD' },
  { name: 'Dhaka Tribune', url: 'https://www.dhakatribune.com/feed/', cn: '孟加拉国', iso: 'BD' },
  { name: 'Daily Mirror LK', url: 'https://www.dailymirror.lk/rss/breaking-news.xml', cn: '斯里兰卡', iso: 'LK' },
  { name: 'Kathmandu Post', url: 'https://kathmandupost.com/rss', cn: '尼泊尔', iso: 'NP' },
  { name: 'N1 Serbia EN', url: 'https://rs.n1info.com/english/feed/', cn: '塞尔维亚', iso: 'RS' },
  { name: 'Hungary Today', url: 'https://hungarytoday.hu/feed/', cn: '匈牙利', iso: 'HU' },
  { name: 'eKathimerini', url: 'https://www.ekathimerini.com/rss', cn: '希腊', iso: 'GR' },
  { name: 'Daily Sabah', url: 'https://www.dailysabah.com/rss', cn: '土耳其', iso: 'TR' },
  { name: 'Egypt Today', url: 'https://www.egypttoday.com/RSS', cn: '埃及', iso: 'EG' },
  { name: 'Nation Kenya', url: 'https://nation.africa/kenya/rss', cn: '肯尼亚', iso: 'KE' },
  { name: 'Addis Fortune', url: 'https://addisfortune.news/feed/', cn: '埃塞俄比亚', iso: 'ET' },
  { name: 'Myanmar Now EN', url: 'https://myanmar-now.org/en/feed/', cn: '缅甸', iso: 'MM' },
  { name: 'Vientiane Times', url: 'https://www.vientianetimes.org.la/rss.xml', cn: '老挝', iso: 'LA' }
];
const BRI_STATS_FILE = path.join(CACHE_DIR, 'bri_stats.json');
function _loadBriStats() { try { const j = JSON.parse(require('fs').readFileSync(BRI_STATS_FILE, 'utf8')); return j; } catch (e) { return null; } }
function _saveBriStats() { try { require('fs').writeFileSync(BRI_STATS_FILE, JSON.stringify(_briStats)); } catch (e) {} }
let _briStats = _loadBriStats() || { date: _todayKey(), total: 0, pakistan: 0, rounds: 0, lastRun: null };
if (_briStats.date !== _todayKey()) _briStats = { date: _todayKey(), total: 0, pakistan: 0, rounds: 0, lastRun: null };
let _briRoundIndex = 0;
let _briBusyUntil = 0;
const _PAK_RE = /巴基斯坦|Pakistan|Pakistani|Gwadar|Karachi|CPEC|Balochistan|Lahore|Islamabad|Quetta|Peshawar|TTP/i;
async function _syncBriStatsFromDB() {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { rows } = await query(`SELECT COUNT(*) c, COUNT(*) FILTER (WHERE title ~* '巴基斯坦|Pakistan|Pakistani|Gwadar|Karachi|CPEC|Balochistan' OR data_json->>'title_zh' ~* '巴基斯坦|瓜达尔|卡拉奇|俾路支' OR country='巴基斯坦') pk FROM intel_data WHERE data_json->>'_briFocus' = 'true' AND collect_time >= $1`, [dayStart]);
    _briStats.total = parseInt(rows[0].c, 10) || 0;
    _briStats.pakistan = parseInt(rows[0].pk, 10) || 0;
  } catch (e) {}
}
async function _runBriFocus() {
  if (Date.now() < _briBusyUntil) return;
  _briBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    const d = _todayKey();
    if (_briStats.date !== d) { _briStats = { date: d, total: 0, pakistan: 0, rounds: 0, lastRun: null }; await _syncBriStatsFromDB(); }
    /* 每轮：巴基斯坦 2 词 + 走廊国 3 词 + 班列 1 词，轮询全覆盖 */
    const pkS = (_briRoundIndex * 3) % BRI_PK_QUERIES.length;
    const pkQ = [0, 1, 2].map(i => BRI_PK_QUERIES[(pkS + i) % BRI_PK_QUERIES.length]);
    const coS = (_briRoundIndex * 4) % BRI_CORRIDOR_QUERIES.length;
    const coQ = [0, 1, 2, 3].map(i => BRI_CORRIDOR_QUERIES[(coS + i) % BRI_CORRIDOR_QUERIES.length]);
    const railQ = [BRI_RAIL_QUERIES[_briRoundIndex % BRI_RAIL_QUERIES.length]];
    _briRoundIndex++;
    /* RSS 轮换：巴基斯坦源每轮必抓，走廊国轮换 6 个 */
    const pkRss = BRI_RSS.filter(x => x.iso === 'PK');
    const coRssAll = BRI_RSS.filter(x => x.iso !== 'PK');
    const rssS = (_briRoundIndex * 6) % Math.max(1, coRssAll.length);
    const coRss = [0, 1, 2, 3, 4, 5].map(i => coRssAll[(rssS + i) % coRssAll.length]).filter(Boolean);
    const [r, rssR] = await Promise.all([
      globalmedia.scrapeGdeltThemes({ queries: pkQ.concat(coQ, railQ), maxPerQuery: 30 })
        .catch(e => { console.warn('[BRI] 主题通道异常:', e.message); return { count: 0, items: [] }; }),
      globalmedia.scrapeDirectRss({ sources: pkRss.concat(coRss), concurrency: 6, timeout: 9000 })
        .catch(e => { console.warn('[BRI] RSS通道异常:', e.message); return { count: 0, items: [] }; })
    ]);
    const items = (r.items || []).concat(rssR.items || []);
    items.forEach(it => { it._sourceType = 'bri_focus'; it._briFocus = true; });
    try { await _translateListToZhParallel(items, 6); } catch (e) {}
    items.forEach(it => {
      try {
        const before = it.interestLinked;
        ENTITY.enrich(it);
        if (before === true) it.interestLinked = true;
      } catch (e) {}
    });
    const linked = items.filter(it => it.interestLinked === true);
    let inserted = 0, pkInserted = 0, skippedDup = 0, skippedDupTitle = 0, skippedStale = 0, skippedRuUa = 0, skippedNoUrl = 0, insertErr = 0, skippedDomestic = 0, skippedBadTitle = 0, skippedEventSig = 0;
    if (linked.length) {
      const urls = linked.map(it => it.url).filter(Boolean);
      const existing = new Set();
      if (urls.length) {
        const batch = urls.map((_, i) => '$' + (i + 1)).join(',');
        const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
        dup.rows.forEach(x => { if (x.url) existing.add(x.url); });
      }
      const titleKeys = await _getRecentTitleKeys();
      const eventSigs = await _getRecentEventSigs();
      for (const it of linked) {
        const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
        if (!gate.ok) {
          gate.code.forEach(c => {
            if (c === 'no-url-title') skippedNoUrl++;
            else if (c === 'url-dup') skippedDup++;
            else if (c === 'title-dup' || c === 'title-zh-dup' || c === 'entity-dup') skippedDupTitle++;
            else if (c === 'event-sig-dup') skippedEventSig++;
            else if (c === 'event-flood') skippedEventSig++; /* 事件簇变体刷屏 */
            else if (c === 'domestic-china') skippedDomestic++;
            else if (c === 'bad-title') skippedBadTitle++;
          });
          continue;
        }
        if (!_isFreshEnough(it)) { skippedStale++; continue; }
        if (!_ruUaQuotaOk(it)) { skippedRuUa++; continue; }
        try {
          _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
          _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
          const _ins = await query(
            `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || it.publish_time || '', _lv, it.content || '', it.source || 'BRI专项采集', JSON.stringify(it), 'approved']
          );
          if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
          inserted++;
          if (_PAK_RE.test((it.title || '') + ' ' + (it.title_zh || '') + ' ' + (it.country_cn || it.country || ''))) pkInserted++;
        } catch (e) { insertErr++; }
      }
    }
    _briStats.total += inserted; _briStats.pakistan += pkInserted; _briStats.rounds++; _briStats.lastRun = new Date().toISOString();
    _saveBriStats();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[BRI] 本轮(' + sec + 's): 抓取 主题' + (r.count || 0) + '+RSS' + (rssR.count || 0) + ' / 入库 ' + inserted + '（巴基斯坦 ' + pkInserted + '）| 今日 BRI ' + _briStats.total + '/100 · 巴 ' + _briStats.pakistan + '/40 | URL重复' + skippedDup + ' 标题/实体重复' + skippedDupTitle + ' 事件签名重复' + skippedEventSig + ' 国内数据' + skippedDomestic + ' 低质标题' + skippedBadTitle + ' 旧闻' + skippedStale);
  } catch (e) { console.warn('[BRI] 采集失败:', e.message); }
  finally { _briBusyUntil = 0; }
}

/* ===== 中文媒体采集通道（2026-08-17 用户实战检验：阿富汗中资矿山遇袭中国系统零捕捉）=====
 * 涉华人员伤亡/项目遇袭的首报信源几乎全在国内中文媒体（中新网/环球等），
 * 英文通道（AP/GDELT）对这类事件覆盖慢甚至不覆盖。此通道专抓中文国际新闻 RSS，
 * 过相关性闸门后走标准入库管道（URL 去重/标题去重/鲜度/分类/自动审核分发）。 */
const CN_MEDIA_SOURCES = [
  { name: '中新网国际', url: 'https://www.chinanews.com.cn/rss/world.xml', cn: '国际', iso: 'UN' },
  { name: '中新网即时', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', cn: '国际', iso: 'UN' },
  { name: '环球网国际', url: 'https://www.globaltimes.cn/rss/world.xml', cn: '国际', iso: 'UN' },
  { name: '环球时报英文', url: 'https://www.globaltimes.cn/rss/opinion.xml', cn: '国际', iso: 'UN' },
  { name: '中国日报世界', url: 'https://www.chinadaily.com.cn/rss/world/rss_world.xml', cn: '国际', iso: 'UN' },
  { name: '中国日报中国', url: 'https://www.chinadaily.com.cn/rss/china/rss_china.xml', cn: '国际', iso: 'UN' },
  { name: 'CGTN世界', url: 'https://www.cgtn.com/rss/opinions/rss.xml', cn: '国际', iso: 'UN' },
  { name: 'CGTN中国', url: 'https://www.cgtn.com/rss/china/rss.xml', cn: '国际', iso: 'UN' },
  { name: '新华网国际', url: 'http://www.xinhuanet.com/rss/world.xml', cn: '国际', iso: 'UN' }
];
let _cnMediaBusyUntil = 0;
async function _runCnMedia() {
  if (Date.now() < _cnMediaBusyUntil) return;
  _cnMediaBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    const r = await globalmedia.scrapeDirectRss({ sources: CN_MEDIA_SOURCES, concurrency: 2, timeout: 10000 })
      .catch(e => { console.warn('[CNMEDIA] 通道异常:', e.message); return { count: 0, items: [] }; });
    /* 中文源含大量国内民生/文娱内容（中新网即时频道），境内内容硬过滤（2026-08-17 体检发现"深圳青少年朋友圈"入库） */
    const items = (r.items || []).filter(it => {
      const t = String(it.title || '') + ' ' + String(it.content || '');
      if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(t)) return false;
      return true;
    });
    items.forEach(it => { it._sourceType = 'cn_media'; });
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      try {
        const before = it.interestLinked;
        ENTITY.enrich(it);
        if (before === true) it.interestLinked = true;
      } catch (e) {}
    });
    const linked = items.filter(it => it.interestLinked === true);
    let inserted = 0, skippedDup = 0, skippedDupTitle = 0, skippedStale = 0, skippedNoUrl = 0, skippedDomestic = 0, skippedBadTitle = 0, skippedEventSig = 0;
    if (linked.length) {
      const urls = linked.map(it => it.url).filter(Boolean);
      const existing = new Set();
      if (urls.length) {
        const batch = urls.map((_, i) => '$' + (i + 1)).join(',');
        const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
        dup.rows.forEach(x => { if (x.url) existing.add(x.url); });
      }
      const titleKeys = await _getRecentTitleKeys();
      const eventSigs = await _getRecentEventSigs();
      for (const it of linked) {
        const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
        if (!gate.ok) {
          gate.code.forEach(c => {
            if (c === 'no-url-title') skippedNoUrl++;
            else if (c === 'url-dup') skippedDup++;
            else if (c === 'title-dup' || c === 'title-zh-dup' || c === 'entity-dup') skippedDupTitle++;
            else if (c === 'event-sig-dup') skippedEventSig++;
            else if (c === 'event-flood') skippedEventSig++; /* 事件簇变体刷屏 */
            else if (c === 'domestic-china') skippedDomestic++;
            else if (c === 'bad-title') skippedBadTitle++;
          });
          continue;
        }
        if (!_isFreshEnough(it)) { skippedStale++; continue; }
        try {
          _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
          _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
          const _ins = await query(
            `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || it.publish_time || '', _lv, it.content || '', it.source || '中文媒体监测', JSON.stringify(it), 'approved']
          );
          if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
          inserted++;
        } catch (e) { /* URL 唯一索引冲突等 */ }
      }
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[CNMEDIA] 本轮(' + sec + 's): 抓取 ' + (r.count || 0) + ' / 入库 ' + inserted + ' | URL重复' + skippedDup + ' 标题/实体重复' + skippedDupTitle + ' 事件签名重复' + skippedEventSig + ' 国内数据' + skippedDomestic + ' 低质标题' + skippedBadTitle + ' 旧闻' + skippedStale);
  } catch (e) { console.warn('[CNMEDIA] 采集失败:', e.message); }
  finally { _cnMediaBusyUntil = 0; }
}

/* ===== 微信公众号采集通道（2026-08-21 用户指令：作为数据源部署进系统）=====
 * 双通道：有扫码会话走公众平台接口(searchbiz+appmsg)；无会话自动降级搜狗微信检索（免登录）。
 * 链路：wechatoa.collect() → onItems 回调 → enrich(关联判定) → 与 CNMEDIA 相同的入库闸链
 *   (URL/标题/事件签名去重+国内过滤+新鲜度) → intel_data(approved) → 预警中心/态势总览实时分发。
 * 零模拟：会话失效/风控冷却/无新文章一律如实记日志并返回，绝不造假。
 * 节奏：每 15 分钟一轮（公众号文章非秒级时效，低频既够用又不触风控）。
 * onItems 设计：整轮可能超过 HTTP 友好的等待时长（礼貌间隔+网络抖动），
 * 采集完成时由回调入库——即使 _runWechatOA 的等待竞速已超时返回，真实数据也不丢。 */
let _wechatBusyUntil = 0;
let _wechatLastRun = null;   // 状态面板展示用
let _wechatLastIngest = null;
async function _wechatIngest(items) {
  if (!items || !items.length) return 0;
  /* 中文内容为主，翻译管线自动跳过中文；保留调用以兜底个别外文号 */
  try { await _translateListToZhParallel(items, 4); } catch (e) {}
  items.forEach(it => {
    try {
      const before = it.interestLinked;
      ENTITY.enrich(it);
      if (before === true) it.interestLinked = true;
      /* 2026-08-26：涉华负面双信号打标（统计独立计数+前端可展示"涉华负面"标签） */
      if (wechatNeg.isChinaNegative(String(it.title || '') + ' ' + String(it.content || ''))) {
        it._chinaNegative = true;
        it.chinaRelated = true;
      }
    } catch (e) {}
  });
  const linked = items.filter(it => it.interestLinked === true);
  let inserted = 0, skippedDup = 0, skippedDupTitle = 0, skippedStale = 0, skippedNoUrl = 0, skippedDomestic = 0, skippedBadTitle = 0, skippedEventSig = 0;
  let chinaInserted = 0, chinaNegativeInserted = 0;
  if (linked.length) {
    const urls = linked.map(it => it.url).filter(Boolean);
    const existing = new Set();
    if (urls.length) {
      const batch = urls.map((_, i) => '$' + (i + 1)).join(',');
      const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_json->>'url' IN (${batch})`, urls);
      dup.rows.forEach(x => { if (x.url) existing.add(x.url); });
    }
    const titleKeys = await _getRecentTitleKeys();
    const eventSigs = await _getRecentEventSigs();
    for (const it of linked) {
      const gate = await _preInsertGate(it, existing, titleKeys, eventSigs);
      if (!gate.ok) {
        gate.code.forEach(c => {
          if (c === 'no-url-title') skippedNoUrl++;
          else if (c === 'url-dup') skippedDup++;
          else if (c === 'title-dup' || c === 'title-zh-dup' || c === 'entity-dup') skippedDupTitle++;
          else if (c === 'event-sig-dup') skippedEventSig++;
          else if (c === 'event-flood') skippedEventSig++; /* 事件簇变体刷屏（计数并入签名重复便于观察） */
          else if (c === 'domestic-china') skippedDomestic++;
          else if (c === 'bad-title') skippedBadTitle++;
        });
        if ((skippedNoUrl + skippedDup + skippedDupTitle + skippedEventSig + skippedDomestic + skippedBadTitle) <= 5)
          console.log('[WECHAT] 闸门拦截(' + gate.code.join(',') + '): ' + String(it.title || '').slice(0, 50));
        continue;
      }
      if (!_isFreshEnough(it)) { skippedStale++; if (skippedStale <= 3) console.log('[WECHAT] 时效拦截: ' + String(it.title || '').slice(0, 50)); continue; }
      try {
        _preInsertCommit(it, existing, titleKeys, eventSigs, gate);
        /* 中文阅读习惯终抛光（#483/#484/#485 咽喉位：覆盖全部采集通道，含绕过 _localizeTitleTail 的链路）
         * L1 尾部媒体/URL/标点 + L2 句式重写 + L4 质量分落 data_json.zhq */
        if (/[\u4e00-\u9fa5]/.test(String(it.title || ''))) {
          const _zhc = String(it.title || '');
          const _zhp = zhPolish.polishTitle(_zhc);
          const _zhr = zhRewrite.rewrite(_zhp, { country: it.country_cn || it.country });
          if (_zhr && _zhr !== _zhc && _zhr.length >= 6) {
            if (!it.title_en) it.title_en = _zhc;
            it.title = _zhr; it.title_zh = _zhr;
          }
          it.zhq = zhRewrite.quality(it.title);
          if (it.zhq < 60 && _ZHQ_LOG_N < 12) { _ZHQ_LOG_N++; console.log('[ZHQ] 低分样本(' + it.zhq + '): ' + String(it.title).slice(0, 60)); }
        }
        _contentCountryFix(it); _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
        const _ins = await query(
          `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || '', _lv, it.content || '', it.source || '公众号监测', JSON.stringify(it), 'approved']
        );
        if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
        inserted++;
        if (_isChinaNegative(it)) chinaNegativeInserted++;
        else if (_isChinaLinked(it)) chinaInserted++;
      } catch (e) { console.warn('[WECHAT] INSERT 失败: ' + e.message + ' | ' + String(it.title || '').slice(0, 40)); }
    }
  }
  if (inserted) { _bumpDailyStats(inserted, linked.length, chinaInserted, chinaNegativeInserted); }
  _wechatLastIngest = { at: new Date().toISOString(), items: items.length, inserted, china: chinaInserted, chinaNegative: chinaNegativeInserted };
  console.log('[WECHAT] 入库完成: 候选' + items.length + ' 关联' + linked.length + ' 入库' + inserted + '（涉华' + chinaInserted + '/负面' + chinaNegativeInserted + '） | URL重复' + skippedDup + ' 标题/实体重复' + skippedDupTitle + ' 事件签名重复' + skippedEventSig + ' 国内数据' + skippedDomestic + ' 低质标题' + skippedBadTitle + ' 旧闻' + skippedStale);
  return inserted;
}
async function _runWechatOA() {
  if (Date.now() < _wechatBusyUntil) return;
  _wechatBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      wechatoa.collect({ onItems: (items) => _wechatIngest(items).catch(e => console.warn('[WECHAT] 入库异常:', e.message)) }),
      /* 整轮正常 60~120s；超时仅放弃等待，采集器在后台继续，完成时经 onItems 入库。 */
      new Promise(resolve => setTimeout(() => resolve({ items: [], stats: {}, session: { logged: false, needLogin: false, message: '本轮等待超时(240s)，采集器仍在后台运行' } }), 240000))
    ]);
    _wechatLastRun = { at: new Date().toISOString(), stats: r.stats || {}, session: r.session || {} };
    const st = r.stats || {};
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[WECHAT] 本轮(' + sec + 's): 账号' + (st.accountsOk || 0) + '/' + (st.accounts || 0) + ' 新文章' + (st.fresh || 0) + ' 正文' + (st.bodyOk || 0) + ' 旧文跳过' + (st.skippedOld || 0) + (st.errors && st.errors.length ? ' | 异常: ' + st.errors.slice(0, 3).join('; ') : '') + (r.session && r.session.message && r.session.message !== 'ok' ? ' | ' + r.session.message : ''));
  } catch (e) { console.warn('[WECHAT] 采集失败:', e.message); }
  finally { _wechatBusyUntil = 0; }
}

/* ===== 区域均衡采集器（2026-08-17 用户指令：采集不能全是美/伊/俄乌，要全球均衡+高质量）=====
 * 每 30 分钟：统计今日各区域入库量，挑最薄弱的 2 个区域，用 GDELT sourcecountry 定向采集
 * （拉美/非洲/中亚/中东非伊以/欧洲五区轮换）。葡语/西语/俄语内容由 pivot 翻译管线处理。 */
const REGION_PACKS = {
  southasia: {
    name: '南亚',
    countries: ['印度', '巴基斯坦', '孟加拉国', '斯里兰卡', '尼泊尔', '阿富汗', '不丹', '马尔代夫'],
    queries: [
      'sourcecountry:IN (attack OR killed OR terrorism OR protest OR China)',
      'sourcecountry:PK (attack OR killed OR Taliban OR China OR CPEC)',
      'sourcecountry:AF (Taliban OR attack OR killed OR explosion)',
      'sourcecountry:LK (attack OR protest OR crisis OR China)',
      'sourcecountry:BD (attack OR killed OR protest OR political)'
    ],
    catQueries: [
      'sourcecountry:IN (flood OR earthquake OR cyclone OR landslide)',
      'sourcecountry:PK (dam OR pipeline OR CPEC OR railway OR port)',
      'sourcecountry:BD (election OR protest OR political crisis)',
      'sourcecountry:LK (debt OR economic OR default OR crisis)'
    ]
  },
  latam: {
    name: '拉美',
    countries: ['墨西哥', '巴西', '哥伦比亚', '秘鲁', '智利', '阿根廷', '委内瑞拉', '厄瓜多尔', '玻利维亚'],
    queries: [
      'sourcecountry:MX (kidnapping OR cartel OR attack OR killed OR security)',
      'sourcecountry:BR (attack OR killed OR police OR security OR mining)',
      'sourcecountry:CO (attack OR armed OR ELN OR killed OR cocaine)',
      'sourcecountry:PE (protest OR mining OR security OR attack)',
      'sourcecountry:VE (sanctions OR oil OR crisis OR protest)',
      'sourcecountry:EC (cartel OR attack OR killed OR security)'
    ],
    catQueries: [
      'sourcecountry:AR (debt OR default OR inflation OR strike OR crisis)',
      'sourcecountry:BR (dam OR mining OR disaster OR flood)',
      'sourcecountry:CL (earthquake OR wildfire OR flood OR port)',
      'sourcecountry:BO (protest OR political OR election OR crisis)'
    ]
  },
  africa: {
    name: '非洲',
    countries: ['尼日利亚', '肯尼亚', '埃塞俄比亚', '苏丹', '马里', '尼日尔', '刚果', '索马里', '布基纳法索', '喀麦隆', '南非', '埃及', '利比亚', '中非', '莫桑比克', '坦桑尼亚'],
    queries: [
      'sourcecountry:NG (Boko OR bandits OR kidnapped OR attack OR killed)',
      'sourcecountry:KE (attack OR al-Shabaab OR security OR killed)',
      'sourcecountry:ET (conflict OR Amhara OR Oromo OR killed)',
      'sourcecountry:SD (RSF OR fighting OR killed OR attack)',
      'sourcecountry:SO (al-Shabaab OR attack OR Mogadishu)',
      'sourcecountry:ML (attack OR jihadist OR kidnapping OR killed)',
      'sourcecountry:CD (rebel OR attack OR killed OR mining)',
      'sourcecountry:ZA (protest OR strike OR load-shedding OR crisis)'
    ],
    catQueries: [
      'sourcecountry:NG (flood OR earthquake OR oil OR pipeline)',
      'sourcecountry:ET (flood OR drought OR disaster)',
      'sourcecountry:ZA (economy OR debt OR power OR port)',
      'sourcecountry:EG (economy OR Suez OR default OR inflation)'
    ]
  },
  centralasia: {
    name: '中亚',
    countries: ['哈萨克斯坦', '乌兹别克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '土库曼斯坦', '蒙古'],
    queries: [
      '(Kazakhstan OR Uzbekistan OR Kyrgyzstan OR Tajikistan) (China OR security OR border OR protest)',
      '(Kazakhstan OR Central Asia) (railway OR pipeline OR China OR investment)',
      'sourcecountry:KZ (China OR security OR government OR attack)',
      'sourcecountry:UZ (China OR border OR security OR protest)',
      'sourcecountry:MN (China OR mining OR protest OR economy)'
    ],
    catQueries: [
      'sourcecountry:KZ (pipeline OR railway OR mining OR China)',
      'sourcecountry:UZ (protest OR election OR political)',
      'sourcecountry:KG (border OR conflict OR China OR mining)'
    ]
  },
  mideast: {
    name: '中东（非伊以）',
    countries: ['沙特阿拉伯', '阿联酋', '埃及', '卡塔尔', '约旦', '伊拉克', '也门', '阿曼', '科威特', '巴林', '摩洛哥', '突尼斯', '阿尔及利亚', '黎巴嫩'],
    queries: [
      'sourcecountry:SA (Houthi OR oil OR security OR China OR attack)',
      'sourcecountry:EG (security OR Sinai OR economy OR Suez OR attack)',
      'sourcecountry:IQ (attack OR militia OR security OR killed)',
      'sourcecountry:JO (security OR border OR economy OR protest)',
      'sourcecountry:YE (Houthi OR attack OR killed OR airstrike)',
      'sourcecountry:LB (attack OR Hezbollah OR security OR crisis)'
    ],
    catQueries: [
      'sourcecountry:SA (pipeline OR oil OR investment OR China)',
      'sourcecountry:QA (investment OR China OR port OR economy)',
      'sourcecountry:DZ (economy OR protest OR election OR crisis)',
      'sourcecountry:MA (earthquake OR flood OR disaster)'
    ]
  },
  europe: {
    name: '欧洲',
    countries: ['法国', '德国', '英国', '波兰', '意大利', '西班牙', '荷兰', '比利时', '瑞典', '挪威', '罗马尼亚', '捷克', '塞尔维亚', '匈牙利', '希腊'],
    queries: [
      'sourcecountry:FR (attack OR security OR terrorism OR protest OR China)',
      'sourcecountry:DE (security OR China OR sanctions OR economy OR attack)',
      'sourcecountry:GB (security OR defense OR China OR sanctions OR attack)',
      'sourcecountry:PL (border OR security OR Belarus OR migration)',
      'sourcecountry:RS (protest OR political OR election OR crisis)'
    ],
    catQueries: [
      'sourcecountry:FR (election OR protest OR political OR strike)',
      'sourcecountry:DE (economy OR energy OR pipeline OR inflation)',
      'sourcecountry:IT (earthquake OR flood OR disaster OR migration)',
      'sourcecountry:GR (migration OR border OR economy OR crisis)'
    ]
  },
  /* 2026-08-25 用户指令补包：东南亚/东北亚原不在 REGION_PACKS，均衡器对这些国家不可见，
   * 导致预警队列东南亚/日本/韩国长期为零 */
  sea: {
    name: '东南亚',
    countries: ['越南', '泰国', '印度尼西亚', '马来西亚', '菲律宾', '缅甸', '柬埔寨', '老挝', '新加坡'],
    queries: [
      'sourcecountry:VN (attack OR security OR protest OR China OR flood)',
      'sourcecountry:TH (attack OR bomb OR security OR border OR protest)',
      'sourcecountry:ID (attack OR terror OR earthquake OR flood OR China)',
      'sourcecountry:MY (security OR China OR flood OR protest)',
      'sourcecountry:PH (attack OR Abu Sayyaf OR typhoon OR China OR kidnapping)',
      'sourcecountry:MM (conflict OR attack OR junta OR killed OR China)'
    ],
    catQueries: [
      'sourcecountry:KH (China OR casino OR scam OR security)',
      'sourcecountry:LA (railway OR China OR flood OR economy)',
      'sourcecountry:SG (security OR China OR economy OR cyber)'
    ]
  },
  neasia: {
    name: '东北亚',
    countries: ['日本', '韩国', '朝鲜'],
    queries: [
      'sourcecountry:JP (China OR security OR earthquake OR typhoon OR defense)',
      'sourcecountry:KR (China OR security OR North Korea OR cyber OR protest)',
      'sourcecountry:JP (attack OR stabbing OR disaster OR flood)',
      'sourcecountry:KR (attack OR fire OR disaster OR military)'
    ],
    catQueries: [
      'sourcecountry:JP (economy OR chip OR export OR energy)',
      'sourcecountry:KR (economy OR chip OR shipbuilding OR election)'
    ]
  }
};
/* 2026-08-29：区域均衡器（_runRegionBalance）已由缺口调度器（_runGapScheduler）合并取代——
 * 单一目标矩阵（国家梯队×类别）统一算缺口，不再按区域包盲补。REGION_PACKS 词库保留供检索复用。 */
const _BAL_NOISE = /(football|soccer|cricket|NBA|tennis|olympic|world cup|champions league|celebrity|movie|album|concert|wedding|recipe|netflix|box office|球赛|足球|篮球|娱乐|明星|演唱会|综艺|美食|旅游攻略|旅游推荐)/i;

/* ===== 类别均衡采集器（2026-08-28 用户指令：12 类全方位采集，不能只盯着恐袭）=====
 * 背景：实测 24h 类别分布 terror 142 / geopolitical 120 / 灾害 49 / 军事 46 一边倒，
 * economic 7 / cyber 4 / political 3 / health 3 / legal 2 / infrastructure 5 几近为零。
 * 每 30 分钟：统计今日各类别入库量，挑最薄弱 3 类，用 GDELT 定向查询补齐。
 * 查询词锚定"海外利益关联国 + 类别事件"（中资所在国经济危机/网络攻击/政局变动等），
 * 过既有闸门（时效/去重/配额）入库，不降低任何质量标准。 */
const CATEGORY_PACKS = {
  economic_risk: {
    name: '经济风险',
    queries: [
      '(Pakistan OR Sri Lanka OR Egypt OR Nigeria OR Argentina OR Turkey) (debt crisis OR default OR inflation OR currency collapse OR recession)',
      '(Kazakhstan OR Uzbekistan OR Kenya OR Ethiopia OR Bangladesh) (economic crisis OR IMF OR inflation OR currency)',
      '(China OR Chinese) overseas (investment OR loan OR debt OR economy) (risk OR crisis OR default OR loss)'
    ]
  },
  cyber_security: {
    name: '网络安全',
    queries: [
      '(Pakistan OR India OR Vietnam OR Philippines OR Nigeria OR Kenya) (cyberattack OR ransomware OR data breach OR hacking)',
      '(Kazakhstan OR Uzbekistan OR Indonesia OR Malaysia OR Egypt) (cyber attack OR ransomware OR hacker OR data leak)',
      'Chinese (company OR embassy OR bank) (cyberattack OR hack OR data breach OR ransomware)'
    ]
  },
  political_events: {
    name: '政局变动',
    queries: [
      '(Pakistan OR Bangladesh OR Myanmar OR Thailand OR Tunisia) (protest OR coup OR political crisis OR resignation OR election)',
      '(Niger OR Mali OR Burkina Faso OR Sudan OR Chad) (junta OR coup OR political transition OR protest)',
      '(Sri Lanka OR Nepal OR Kyrgyzstan OR Moldova OR Georgia) (political crisis OR protest OR parliament OR election)'
    ]
  },
  public_health: {
    name: '公共卫生',
    queries: [
      '(cholera OR dengue OR mpox OR measles) outbreak (Sudan OR Nigeria OR Congo OR Ethiopia OR Kenya OR Afghanistan)',
      '(Pakistan OR Afghanistan OR Yemen OR Syria) (polio OR cholera OR epidemic OR health crisis OR hospital attack)'
    ]
  },
  legal_compliance: {
    name: '法律合规',
    queries: [
      '(lawsuit OR litigation OR fine OR penalty OR court ruling) (Chinese company OR China firm OR Chinese worker)',
      '(Pakistan OR Indonesia OR Kazakhstan OR Nigeria OR Vietnam) (court OR lawsuit OR arbitration OR fine) (China OR Chinese OR mining OR investment)'
    ]
  },
  infrastructure: {
    name: '基础设施',
    queries: [
      '(Kazakhstan OR Uzbekistan OR Pakistan OR Laos OR Ethiopia OR Kenya) (railway OR pipeline OR port OR power plant OR dam) (attack OR damage OR halt OR protest OR China)',
      '(CPEC OR "Belt and Road" OR Chinese-built) (port OR railway OR highway OR pipeline OR power) (attack OR disruption OR damage OR delay)'
    ]
  },
  social_unrest: {
    name: '社会动荡',
    queries: [
      '(strike OR demonstration OR curfew OR riot) (Bangladesh OR Kenya OR Nigeria OR Haiti OR Ecuador OR Bolivia OR Kazakhstan)',
      '(factory OR mine OR construction) (China OR Chinese) (strike OR protest OR riot OR labor dispute)'
    ]
  },
  sanctions_data: {
    name: '制裁管制',
    queries: [
      'sanctions OR tariff OR "export control" (China OR Chinese) (impose OR new OR expand OR entity list)',
      '(Iran OR Russia OR Myanmar OR Venezuela OR Sudan) sanctions (China OR Chinese OR oil OR shipping)'
    ]
  },
  military_conflicts: {
    name: '武装冲突',
    queries: [
      '(shelling OR airstrike OR ceasefire OR offensive OR clash) (Sudan OR Myanmar OR Ukraine OR Yemen OR Syria OR Congo)',
      '(border OR frontier) (clash OR shelling OR firing OR tension) (India OR Pakistan OR Afghanistan OR Tajikistan OR Kyrgyzstan)'
    ]
  },
  natural_disasters: {
    name: '自然灾害',
    queries: [
      '(earthquake OR flood OR typhoon OR landslide OR volcano OR cyclone) (China OR Chinese) (citizen OR rescue OR evacuation OR aid)',
      '(earthquake OR flood OR typhoon OR drought OR famine) (Afghanistan OR Pakistan OR Nepal OR Bangladesh OR Philippines OR Indonesia OR Horn of Africa)'
    ]
  }
};
/* 类别均衡 GNews 原子查询包（2026-08-29 Task #465 审计修复：PM2 日志实测类别均衡器
 * 连续多轮「抓取 0 入库 0」——GDELT 复杂查询大量挂起（30s 竞速空转），弱类永远补不上。
 * GNews 原子查询已验证稳定（英文+原子词铁律），改为第一通道，GDELT/AP 降为兜底。 */
const CAT_GNEWS_PACKS = {
  economic_risk: ['Pakistan economy crisis', 'Sri Lanka default', 'Nigeria inflation', 'Egypt currency', 'Argentina recession'],
  cyber_security: ['ransomware attack', 'cyberattack Africa', 'Nigeria cybercrime', 'Pakistan hacking', 'data breach bank'],
  political_events: ['Bangladesh protest', 'Sudan coup', 'Myanmar protest', 'Kenya protest', 'Thailand political crisis'],
  public_health: ['cholera outbreak', 'dengue outbreak', 'Sudan famine', 'Afghanistan polio', 'measles outbreak Africa'],
  legal_compliance: ['Chinese company lawsuit', 'Chinese firm fined', 'Chinese workers court', 'mining license revoked'],
  infrastructure: ['pipeline explosion', 'railway accident', 'port shutdown', 'power plant failure', 'bridge collapse'],
  social_unrest: ['factory strike', 'mining protest', 'Bangladesh riot', 'fuel protest', 'transport strike']
};
/* GNews RSS 原子查询（串行+重试×2，并发即限流——与哨兵同款铁律）
 * 2026-08-30 采集端修复：country 不再硬编码空串（google_news 通道 32+条/日空国别的根因）——
 * 标题/描述国名提取 → 地区映射（俾路支→巴基斯坦等）→ 查询词自带国名兜底（CAT_GNEWS_PACKS
 * 查询多为 'Pakistan economy crisis' 类，查询意图即国别）。 */
async function _catGnewsRss(q, max) {
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:1d') + '&hl=en-US&gl=US&ceid=US:en',
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  try {
    let text = await _once();
    for (let r = 0; !text && r < 2; r++) { await new Promise(s => setTimeout(s, 2000)); text = await _once(); }
    if (!text) return [];
    const _qCountry = _SIG_COUNTRIES.find(x => String(q).toLowerCase().indexOf(String(x).toLowerCase()) >= 0) || '';
    return (scrapers.parseRss(text) || []).slice(0, max || 12).map(it => {
      const _t = String(it.title || '') + ' ' + String(it.description || '');
      return {
        title: it.title || '', content: it.description || '', url: it.link || '',
        publish_time: it.pubDate || '', source: 'Google News',
        country: _SIG_COUNTRIES.find(x => _t.indexOf(x) >= 0) || _regionToCountry(_t) || _qCountry
      };
    });
  } catch (e) { return []; }
}
/* 类别均衡质量闸（2026-08-28 用户指令：数据质量整治）：
 * ① 事件要素词表——泛新闻/体育赛况/路况播报（"Gilas Pilipinas lineup""Motiva tapa buracos"类）
 *   无任何可感事件信号，不产生情报价值，不入库；
 * ② 非拉丁外文未翻译——孟加拉/乌克兰/罗马尼亚语等翻译链成功率低，翻译失败即拒绝
 *   （落库即中文铁律：不可读外文标题对中文预警平台是垃圾数据）。 */
const _CAT_EVENT_RE = /死亡|遇难|身亡|伤亡|失踪|受伤|袭击|攻击|爆炸|枪击|交火|冲突|炮击|空袭|绑架|劫持|扣押|逮捕|拘留|制裁|管制|封禁|禁令|反倾销|政变|抗议|示威|骚乱|罢工|洪水|地震|海啸|台风|飓风|山火|干旱|塌方|溃坝|坠机|失事|沉船|火灾|疫情|撤离|撤侨|断供|停产|停运|封锁|中断|危机|紧张|对峙|通胀|贬值|违约|债务|破产|衰退|汇率|暴跌|暴涨|断网|宕机|漏洞|黑客|勒索|数据泄露|间谍|泄密|贿赂|腐败|丑闻|审判|判决|调查|指控|宵禁|边界|争端|选举|killed|dead|death|casualt|attack|bomb|blast|shoot|clash|conflict|kidnap|hostage|seiz|detain|arrest|sanction|embargo|tariff|coup|protest|riot|strike|unrest|flood|earthquake|typhoon|hurricane|wildfire|landslide|collapse|crash|outbreak|evacuat|crisis|inflation|devalu|default|bankrupt|recession|hacked|breach|ransom|spy|corrupt|scandal|investigat|indict|curfew|dispute|elect|仲裁|诉讼|起诉|上诉|裁决|庭审|开庭|罚款|罚金|没收|查封|冻结|充公|引渡|通缉|越狱|走私|贩运|洗钱|诈骗|抢劫|谋杀|凶杀|暗杀|刺杀|戒严|军管|停电|限电|断电|停摆|停工|铁路|高铁|港口|管道|油田|矿井|大坝|电网|基础设施|网络攻击|网络防御|网络威胁|威胁|军演|演习|试射|导弹|无人机|部署|进驻|巡逻|军舰|军机|战机|防空|峰会|会谈|谈判|对话|条约|断交|驱逐|遣返|难民|饥荒|霍乱|瘟疫|疫苗|中毒|辐射|泄漏|污染|短缺|涨价|失业|崩盘|抛售|挤兑|lawsuit|litigat|tribunal|verdict|arbitrat|sued|extradit|smuggl|traffick|launder|fraud|robber|murder|homicide|assassin|blackout|outage|pipeline|railway|railroad|refinery|grid|cyber|malware|phishing|threat|missile|drone|deploy|troop|warship|shelling|offensiv|summit|talks|negotiat|treaty|expel|deport|refugee|famine|cholera|epidemic|vaccine|radiation|leak|spill|shortage|layoff|unemploy|freez|frozen|confiscat|expropriat|nationaliz|\b(?:fined|port|dam|trial)\b/i;
/* 2026-09-01 #526 自锁解环：原词表暴力/灾害主导，而缺口调度器补采的恰是法律合规/经济风险/网络安全/基础设施类——
 * 「中国法院冻结Nexperia资产」「印度巴基斯坦水资源仲裁」「巴拿马网络防御」等合格事件全被「无事件词」误杀，
 * 8-31 晚间实测抓 24-39 条入库 0-1 条。扩充词与 GAP_CAT_KEYWORDS 十三类抓取词一一对应（中英双语）；
 * port/dam/trial/fined 用 \b 防误配（airport/damage/industrial/refined）。本闸仅缺口调度器单点使用，不影响主管线。 */
const _NONLATIN_RE = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F\u1200-\u137F\u0590-\u05FF\u10A0-\u10FF]/; /* 西里尔/阿拉伯/梵文系(含孟加拉)/泰文/埃塞/希伯来/格鲁吉亚 */

/* ===== 缺口调度器（2026-08-29 用户指令：全球均衡化、全类别化，采集有重点、预警中心有核心）=====
 * 合并取代区域/类别两个均衡器，统一为「目标矩阵 × 差额调度」闭环：
 * ① 目标矩阵：国家梯队（TIER1 ≥12 条/国/日、TIER2 ≥6 条/国/日——54 国底数库利益密度分层）
 *   × 12 大类别（每类 ≥30 条/日；地缘兜底类不设目标——未命中信号全归它，量永远最大）；
 * ② 每轮统计当日入库矩阵，算缺口率（(目标-实际)/目标），优先补最空的格子（自限防过采）；
 *   2026-08-30 地板驱动：总量未达 500 下限时自动加力（补国/补类翻倍、单轮回填放宽），
 *   矩阵全绿但地板未达时转地板补采模式——采集只设下限，不设上限；
 * ③ 国别缺口：GDELT sourcecountry:<FIPS 码> × 当前最缺类别事件词矩阵 定向采集（FIPS→英文国名双试 + AP 兜底）；
 *   类别缺口：GNews 原子查询（CAT_GNEWS_PACKS，已验证稳定）→ GDELT → AP 三级兜底；
 * ④ 全部走 _ingestLinkedItems 标准管线（_sourceType='gap_scheduler'，全套闸门生效），
 *   涉华/重大事件由闸门豁免，绝不因结构调优误伤核心情报。 */
const GAP_COUNTRY_TARGET = { TIER1: 12, TIER2: 6 };
const GAP_CAT_TARGET = 30;
const GAP_CAT_KEYWORDS = {
  terror_events: '(attack OR bombing OR kidnapping OR militant)',
  military_conflicts: '(airstrike OR shelling OR clashes OR offensive)',
  geopolitical_intel: '(summit OR dispute OR tension OR diplomatic)',
  sanctions_data: '(sanctions OR tariff OR embargo)',
  political_events: '(protest OR coup OR election OR crisis)',
  economic_risk: '(inflation OR debt OR default OR currency)',
  social_unrest: '(riot OR strike OR demonstration OR curfew)',
  security_events: '(shooting OR kidnapping OR crime OR murder)',
  public_health: '(outbreak OR cholera OR epidemic OR famine)',
  cyber_security: '(cyberattack OR ransomware OR hacking OR breach)',
  legal_compliance: '(lawsuit OR arbitration OR fined OR court)',
  natural_disasters: '(earthquake OR flood OR typhoon OR landslide)',
  infrastructure: '(pipeline OR railway OR port OR blackout)'
};
/* GDELT sourcecountry 码制排雷（2026-08-29 实测定案）：GDELT DOC API 只认 FIPS 10-4 两字码或英文国名，
 * ISO 两字码（VN）/三字码（VNM/PAK）一律返回 "Invalid/Unsupported Country." 召回 0。
 * 国别码统一取 crawler.GD_COUNTRIES 权威表（与 core-threat-watch/globalmedia 同源），此处不再维护副本。 */
/* 梯队国英文国名（AP 站内检索兜底用） */
const GAP_COUNTRY_EN = {
  '巴基斯坦': 'Pakistan', '俄罗斯': 'Russia', '哈萨克斯坦': 'Kazakhstan', '沙特阿拉伯': 'Saudi Arabia', '印度尼西亚': 'Indonesia',
  '印度': 'India', '阿富汗': 'Afghanistan', '尼日利亚': 'Nigeria', '刚果（金）': 'DR Congo', '伊朗': 'Iran', '伊拉克': 'Iraq',
  '越南': 'Vietnam', '泰国': 'Thailand', '马来西亚': 'Malaysia', '缅甸': 'Myanmar', '斯里兰卡': 'Sri Lanka', '吉布提': 'Djibouti',
  '埃及': 'Egypt', '埃塞俄比亚': 'Ethiopia', '肯尼亚': 'Kenya', '几内亚': 'Guinea', '秘鲁': 'Peru', '巴西': 'Brazil',
  '阿根廷': 'Argentina', '老挝': 'Laos', '柬埔寨': 'Cambodia', '孟加拉国': 'Bangladesh', '阿尔及利亚': 'Algeria',
  '阿联酋': 'United Arab Emirates', '希腊': 'Greece', '巴拿马': 'Panama', '乌兹别克斯坦': 'Uzbekistan', '塔吉克斯坦': 'Tajikistan'
};
let _gapSchedBusyUntil = 0;
async function _runGapScheduler() {
  if (Date.now() < _gapSchedBusyUntil) return;
  _gapSchedBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    /* ① 当日 国别×类别 矩阵 */
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const cnt = await query('SELECT country, data_type, COUNT(*) n FROM intel_data WHERE collect_time >= $1 GROUP BY 1,2', [dayStart]);
    /* 2026-09-01 #526：缩写归一——双向子串对「印尼」≠「印度尼西亚」失明，印尼计数被低估（8-31 实测 2+8 分裂） */
    const _GAP_CN_ALIAS = { '印尼': '印度尼西亚', '南韩': '韩国', '南朝鲜': '韩国' };
    const countryN = {}, catN = {};
    cnt.rows.forEach(r => {
      const c0 = String(r.country || '').trim(), ct = String(r.data_type || '');
      const c = _GAP_CN_ALIAS[c0] || c0;
      const n = parseInt(r.n, 10) || 0;
      if (c) countryN[c] = (countryN[c] || 0) + n;
      if (ct) catN[ct] = (catN[ct] || 0) + n;
    });
    /* ② 国别缺口（双向子串聚合，兼容"刚果/刚果（金）"写法差异） */
    const countryGaps = [];
    for (const tier of ['TIER1', 'TIER2']) {
      const target = GAP_COUNTRY_TARGET[tier];
      for (const x of INTEREST_BASE.COUNTRY_TIERS[tier]) {
        const n = Object.keys(countryN).reduce((s, k) => (k === x.cn || k.indexOf(x.cn) >= 0 || x.cn.indexOf(k) >= 0 ? s + countryN[k] : s), 0);
        if (n < target) countryGaps.push({ cn: x.cn, iso: x.iso, tier, n, target, rate: (target - n) / target });
      }
    }
    countryGaps.sort((a, b) => b.rate - a.rate || a.n - b.n);
    /* ③ 类别缺口（缺口率排序） */
    const catGaps = [];
    for (const ct of Object.keys(GAP_CAT_KEYWORDS)) {
      if (ct === 'geopolitical_intel') continue;
      const n = catN[ct] || 0;
      if (n < GAP_CAT_TARGET) catGaps.push({ ct, n, target: GAP_CAT_TARGET, rate: (GAP_CAT_TARGET - n) / GAP_CAT_TARGET });
    }
    catGaps.sort((a, b) => b.rate - a.rate || a.n - b.n);
    /* 2026-08-30 用户铁律「采集的数据不设上限，设下限，500 目标是下限」：
     * ① 总量未达 500 地板 → 调度器自动加力：补国 3→6、补类 3→6、单轮回填 8→14；
     * ② 安全类占比 > 45% → 弱类再多补 2 格稀释结构（纯补弱，绝不砍强）；
     * ③ 矩阵全绿但地板未达 → 不空闲，转"地板补采"模式（最空类别 × 最少 TIER1 国继续采）。 */
    const dayTotal = Object.keys(catN).reduce((s, k) => s + catN[k], 0);
    const secN = _SEC_STRUCT_TYPES.reduce((s, ct) => s + (catN[ct] || 0), 0);
    const secShare = dayTotal ? secN / dayTotal : 0;
    const shortOfFloor = Math.max(0, 500 - dayTotal);
    const nCountry = shortOfFloor > 0 ? 6 : 3;
    const nCat = (shortOfFloor > 0 ? 6 : 3) + (secShare > SEC_STRUCT_SHARE_MAX ? 2 : 0);
    const roundCap = shortOfFloor > 0 ? 14 : 8;
    let pickCountries = countryGaps.slice(0, nCountry);
    let pickCats = catGaps.slice(0, nCat);
    if (!pickCountries.length && !pickCats.length) {
      if (dayTotal >= 500) { console.log('[GAP-SCHED] 目标矩阵全达标且已达下限500，本轮空闲'); return; }
      /* 地板补采模式 */
      pickCats = Object.keys(GAP_CAT_KEYWORDS).filter(ct => ct !== 'geopolitical_intel')
        .sort((a, b) => (catN[a] || 0) - (catN[b] || 0)).slice(0, 3)
        .map(ct => ({ ct, n: catN[ct] || 0, target: GAP_CAT_TARGET, rate: 0 }));
      pickCountries = INTEREST_BASE.COUNTRY_TIERS.TIER1.slice(0, 20)
        .map(x => ({ cn: x.cn, iso: x.iso, tier: 'TIER1', n: Object.keys(countryN).reduce((s, k) => (k === x.cn || k.indexOf(x.cn) >= 0 || x.cn.indexOf(k) >= 0 ? s + countryN[k] : s), 0), target: GAP_COUNTRY_TARGET.TIER1, rate: 0 }))
        .sort((a, b) => a.n - b.n).slice(0, 3);
      console.log('[GAP-SCHED] 矩阵全绿但总量 ' + dayTotal + ' < 下限500，启动地板补采模式');
    }
    const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
    let fetched = 0, inserted = 0, rejected = 0;
    const titleKeysPre = await _getRecentTitleKeys();
    /* GDELT seendate → 标准日期 + 翻译 + 实体富化（与两代均衡器同源） */
    const _postFetch = async (arts) => {
      arts.forEach(it => {
        if (!it.publish_time && !it.publishedAt && !it.date && it.seendate) {
          const iso = String(it.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
          if (iso !== it.seendate) { it.publish_time = iso; it.publishedAt = iso; it.date = iso; }
        }
      });
      if (arts.length) { try { await _translateListToZhParallel(arts, 4); } catch (e) {} arts.forEach(it => { try { ENTITY.enrich(it); } catch (e) {} }); }
    };
    /* 通道前置过滤（轻量；全量闸门在 _ingestLinkedItems 内）——拒因分解入库率可观测 */
    const rejBy = { noise: 0, noUrl: 0, dupTitle: 0, stale: 0, noEvent: 0, nonLatin: 0 };
    const _filterBatch = (arts, assign) => {
      const batch = [];
      let cap = 0;
      for (const it of arts) {
        it._sourceType = 'gap_scheduler'; /* 2026-08-30：必须在 _isFreshEnough 之前设置——
          行内闸判 trustPubDate（发布时间为时效准绳）依赖此标记，晚设置导致 15 轮全 0 入库 */
        /* 事件词测「原标题 + 翻译后中文标题 + 摘要」：小语种（越南语/泰语）标题翻译成中文后
         * 中文事件词才能命中——此前只测原文，非英语国家的真实事件全被误杀（noEvent 误拒）。 */
        const ctext = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.description || '');
        if (_BAL_NOISE.test(ctext)) { rejected++; rejBy.noise++; continue; }
        const u = it.url || it.title; if (!u) { rejected++; rejBy.noUrl++; continue; }
        if (_isDupTitle(titleKeysPre, it)) { rejected++; rejBy.dupTitle++; continue; }
        if (!_isFreshEnough(it)) { rejected++; rejBy.stale++; if (rejBy.stale <= 2) console.log('[GAP-SCHED] 超时拒: ' + String(it.title || '').slice(0, 80) + ' | ' + String(it.publish_time || it.seendate || '')); continue; }
        if (!_CAT_EVENT_RE.test(ctext)) { rejected++; rejBy.noEvent++; if (rejBy.noEvent <= 3) console.log('[GAP-SCHED] 无事件词拒: ' + String(it.title || '').slice(0, 80) + (it.title_zh ? ' | 译:' + String(it.title_zh).slice(0, 40) : ' | 未译')); continue; }
        if ((String(it.title_zh || '').match(/[\u4e00-\u9fa5]/g) || []).length < 2 && _NONLATIN_RE.test(String(it.title || ''))) { rejected++; rejBy.nonLatin++; continue; }
        assign(it);
        it.interestLinked = true;
        batch.push(it);
        cap++;
        if (cap >= roundCap) break;   /* 单缺口单轮回填上限（地板未达500时自动放宽到14），均衡铺开 */
      }
      return batch;
    };
    /* ④ 国别缺口回填：GDELT sourcecountry × 最缺类别事件词（FIPS→英文国名→AP 三级） */
    for (const g of pickCountries) {
      const kwCt = catGaps.length ? catGaps[cyc % catGaps.length].ct : 'terror_events';
      const kw = GAP_CAT_KEYWORDS[kwCt];
      let arts = [];
      /* GDELT 试码链：FIPS 码 → 英文国名，各带「全语言 / 仅英文源」两试。
       * 2026-08-29 实测排雷：sourcecountry 抓回的多为当地语言标题（越南语/泰语），
       * 后置事件词闸（中英文正则）无法命中——sourcelang:english 让英文媒体报该国事件，
       * 标题即英文可过闸；英文源召回 0（小语种国家英文覆盖薄）再回落全语言。 */
      const isoTry = [];
      const _fips = crawler.gdCode(g.cn); if (_fips) isoTry.push(_fips);
      const _en = GAP_COUNTRY_EN[g.cn]; if (_en) isoTry.push('"' + _en + '"');
      for (const iso of isoTry) {
        try { arts = await crawler.gdeltSearch('sourcecountry:' + iso + ' sourcelang:english ' + kw, { timespan: '1d', maxrecords: 12 }); } catch (e) {}
        if (arts.length) break;
        try { arts = await crawler.gdeltSearch('sourcecountry:' + iso + ' ' + kw, { timespan: '1d', maxrecords: 12 }); } catch (e) {}
        if (arts.length) break;
      }
      if (!arts.length) {
        const en = GAP_COUNTRY_EN[g.cn];
        if (en) { try { arts = await crawler.apSearch(en + ' ' + kw.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(), { maxrecords: 10, pages: 1 }); } catch (e) {} }
      }
      fetched += arts.length;
      await _postFetch(arts);
      const batch = _filterBatch(arts, it => {
        if (!it.country && !it.country_cn) it.country = g.cn;   /* 缺口归因：无国别字段按目标国记账 */
        if (!it.source) it.source = '缺口调度·' + g.cn;
      });
      if (batch.length) { const res = await _ingestLinkedItems(batch, 'GAP-SCHED', '（' + g.cn + '·' + g.tier + '）'); inserted += (res && res.inserted) || 0; }
    }
    /* ⑤ 类别缺口回填：GNews 原子 → GDELT → AP 三级兜底 */
    for (const g of pickCats) {
      let arts = [];
      const gpk = CAT_GNEWS_PACKS[g.ct];
      if (gpk && gpk.length) {
        for (const gq of [gpk[cyc % gpk.length], gpk[(cyc + 2) % gpk.length]]) {
          try { const a1 = await _catGnewsRss(gq, 12); if (a1.length) arts = arts.concat(a1); } catch (e) {}
        }
      }
      const pack = CATEGORY_PACKS[g.ct];
      if (!arts.length && pack) {
        try { arts = await crawler.gdeltSearch(pack.queries[cyc % pack.queries.length], { timespan: '1d', maxrecords: 15 }); } catch (e) {}
      }
      if (!arts.length && pack) {
        try { const apq = pack.queries[cyc % pack.queries.length].replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim();
          arts = await crawler.apSearch(apq, { maxrecords: 10, pages: 1 }); } catch (e) {}
      }
      fetched += arts.length;
      await _postFetch(arts);
      const batch = _filterBatch(arts, it => {
        it._forceDataType = true; it.data_type = g.ct;   /* 类别权威指定 */
        if (!it.source) it.source = '缺口调度·' + (pack ? pack.name : g.ct);
      });
      if (batch.length) { const res = await _ingestLinkedItems(batch, 'GAP-SCHED', '（' + (pack ? pack.name : g.ct) + '）'); inserted += (res && res.inserted) || 0; }
    }
    console.log('[GAP-SCHED] 缺口调度(' + ((Date.now() - t0) / 1000).toFixed(1) + 's): 总量 ' + dayTotal + (shortOfFloor > 0 ? '（差' + shortOfFloor + ' 至下限500，加力）' : '（已达下限）') + ' | 安全面 ' + (secShare * 100).toFixed(0) + '%' + ' | 国别补 ' + (pickCountries.map(g => g.cn + '(' + g.n + '/' + g.target + ')').join('+') || '无') + ' | 类别补 ' + (pickCats.map(g => (CATEGORY_PACKS[g.ct] ? CATEGORY_PACKS[g.ct].name : g.ct) + '(' + g.n + '/' + g.target + ')').join('+') || '无') + ' | 抓取 ' + fetched + ' 入库 ' + inserted + ' 排除 ' + rejected + '（重复' + rejBy.dupTitle + '/超时' + rejBy.stale + '/无事件词' + rejBy.noEvent + '/噪声' + rejBy.noise + '/无链接' + rejBy.noUrl + '/未译' + rejBy.nonLatin + '）');
  } catch (e) { console.warn('[GAP-SCHED] 采集失败:', e.message); }
  finally { _gapSchedBusyUntil = 0; }
}

/* ===== 海外核心安全威胁一分钟哨兵调度（2026-08-27 用户铁指令）=====
 * 7×24 每 60 秒一轮：core-threat-watch 四层采集（GDELT 区域×事件矩阵 +
 * GNews/Bing RSS 原子查询 + 高危本地 RSS 直采），覆盖巴基斯坦/CPEC、阿富汗、
 * 非洲、中亚、东南亚 的恐怖袭击/海外袭击/绑架/重大刑事案件。 */
let _coreThreatBusyUntil = 0;
async function _runCoreThreatWatch() {
  if (Date.now() < _coreThreatBusyUntil) return;
  _coreThreatBusyUntil = Date.now() + 90000; /* 单轮 90 秒锁，避免 GDELT 慢响应重叠 */
  try {
    const r = await coreThreatWatch.runCoreThreatWatch({ maxPerQuery: 12 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) { console.warn('[CORE-THREAT] 翻译异常:', e.message); }
    items.forEach(it => {
      try {
        ENTITY.enrich(it);
        if (!it.category) it.category = '安全事件';
      } catch (e) {}
    });
    const res = await _ingestLinkedItems(items, 'CORE-THREAT', '');
    if (res && res.inserted) console.log('[CORE-THREAT] ✅ 新入库核心威胁事件 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[CORE-THREAT] 采集失败:', e.message); }
  finally { _coreThreatBusyUntil = 0; }
}

/* ===== 海上战略通道哨兵调度（维度⑤，2026-08-28 官方框架六维补全）=====
 * 每 30 分钟：八大咽喉点（马六甲/霍尔木兹/红海/苏伊士/巴拿马/台海/几内亚湾/亚丁湾）
 * 通航·封锁·海盗·袭击油轮事件 + 海运专业源。 */
let _channelWatchBusyUntil = 0;
async function _runChannelWatch() {
  if (Date.now() < _channelWatchBusyUntil) return;
  _channelWatchBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await channelWatch.runChannelWatch({ maxPerQuery: 12 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      it.interestLinked = true;
      it._forceDataType = true;
      it.data_type = 'infrastructure';       /* 通道安全归基础设施与供应链类 */
      if (!it.category) it.category = '海上通道安全';
      try { ENTITY.enrich(it); } catch (e) {}
    });
    const res = await _ingestLinkedItems(items, 'CHANNEL-WATCH', '');
    if (res && res.inserted) console.log('[CHANNEL-WATCH] ✅ 新入库海上通道事件 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[CHANNEL-WATCH] 采集失败:', e.message); }
  finally { _channelWatchBusyUntil = 0; }
}

/* ===== 制裁合规哨兵调度（维度⑥，2026-08-28 官方框架六维补全）=====
 * 每 30 分钟：OFAC 制裁/实体清单/CFIUS 审查/出口管制 + 涉华经贸壁垒动态。 */
let _complianceWatchBusyUntil = 0;
async function _runComplianceWatch() {
  if (Date.now() < _complianceWatchBusyUntil) return;
  _complianceWatchBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await complianceWatch.runComplianceWatch({ maxPerQuery: 12 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      it.interestLinked = true;
      it._forceDataType = true;
      it.data_type = 'sanctions_data';
      if (!it.category) it.category = '制裁合规';
      try { ENTITY.enrich(it); } catch (e) {}
    });
    const res = await _ingestLinkedItems(items, 'COMPLIANCE-WATCH', '');
    if (res && res.inserted) console.log('[COMPLIANCE-WATCH] ✅ 新入库制裁合规情报 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[COMPLIANCE-WATCH] 采集失败:', e.message); }
  finally { _complianceWatchBusyUntil = 0; }
}

/* ===== 领事保护哨兵调度（维度②，2026-08-28 官方框架六维补全）=====
 * 每 30 分钟：外交部领事直击安全提醒直采 + 撤侨/领保案件/使领馆动态全球检索。 */
let _consularWatchBusyUntil = 0;
async function _runConsularWatch() {
  if (Date.now() < _consularWatchBusyUntil) return;
  _consularWatchBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await consularWatch.runConsularWatch({ maxPerQuery: 12 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      it.interestLinked = true;
      it._forceDataType = true;
      it.data_type = 'security_events';       /* 领保/撤侨归涉华安全类（命中红区铁律自动红） */
      if (!it.category) it.category = '领事保护';
      try { ENTITY.enrich(it); } catch (e) {}
    });
    const res = await _ingestLinkedItems(items, 'CONSULAR-WATCH', '');
    if (res && res.inserted) console.log('[CONSULAR-WATCH] ✅ 新入库领事保护情报 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[CONSULAR-WATCH] 采集失败:', e.message); }
  finally { _consularWatchBusyUntil = 0; }
}

/* ===== WorldMonitor.app 数据接入哨兵调度（2026-08-31 Task #506）=====
 * 每 30 分钟：UCDP 武装冲突 + FCDO 领事警示 + 国别断网 + 疫情 + 新闻摘要，
 * 匿名 session token（12h 自动刷新）+ 描述性 UA + 串行礼貌限速（其 free 层节奏 5-15min）。 */
let _wmFeedBusyUntil = 0;
async function _runWmFeed() {
  if (Date.now() < _wmFeedBusyUntil) return;
  _wmFeedBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await wmFeed.runWmFeed({});
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      try { ENTITY.enrich(it); it.interestLinked = true; } catch (e) {}
      if (!it._sourceType) it._sourceType = 'wm_feed';
      /* data_type 已在 wm-feed.js 权威指定（military_conflicts/security_events/
       * infrastructure/osint_intel + _forceDataType），新闻摘要类留给通用分类器 */
    });
    const res = await _ingestLinkedItems(items, 'WM-FEED', '');
    if (res && res.inserted) console.log('[WM-FEED] ✅ 新入库 WorldMonitor 情报 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[WM-FEED] 采集失败:', e.message); }
  finally { _wmFeedBusyUntil = 0; }
}

/* ===== 核心威胁专项哨兵调度（2026-08-28 用户指令：十大核心威胁重点采集）=====
 * 体检实测四类零产出（涉华袭击/涉华绑架/政变/外资审查），本哨兵专用查询矩阵补强。
 * 每 10 分钟一轮；条目强制 data_type 按内容分类（恐袭→terror_events/制裁→sanctions_data/
 * 涉华受害→security_events/政变→political_events/航运→infrastructure）。 */
let _ctSentinelBusyUntil = 0;
async function _runCoreThreatSentinel() {
  if (Date.now() < _ctSentinelBusyUntil) return;
  _ctSentinelBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await coreThreatSentinel.runCoreThreatWatch({ maxPerQuery: 12 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      try { ENTITY.enrich(it); it.interestLinked = true; } catch (e) {}
      /* 强制 data_type：按核心威胁主类映射 */
      const t = String(it.title || '') + ' ' + String(it.title_zh || '');
      if (/绑架|劫持|kidnap|hostage|abduct/i.test(t) && /中国|中方|华人|华侨|Chinese/i.test(t)) it.data_type = 'security_events';
      else if (/政变|coup|军政府|junta/i.test(t)) it.data_type = 'political_events';
      else if (/制裁|实体清单|sanction|entity list|出口管制|export control|外资审查|CFIUS|投资审查/i.test(t)) it.data_type = 'sanctions_data';
      else if (/海盗|piracy|油轮|tanker|航运|shipping|strait|海峡/i.test(t)) it.data_type = 'infrastructure';
      else if (/恐袭|恐怖袭击|爆炸|bomb|suicide|枪击/i.test(t)) it.data_type = 'terror_events';
      else it.data_type = 'osint_intel';
      it._forceDataType = true; /* 权威指定不被通用分类器覆盖 */
      it._sourceType = 'core_threat_sentinel';
    });
    const res = await _ingestLinkedItems(items, 'CT-SENTINEL', '');
    if (res && res.inserted) console.log('[CT-SENTINEL] ✅ 新入库核心威胁情报 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[CT-SENTINEL] 采集失败:', e.message); }
  finally { _ctSentinelBusyUntil = 0; }
}

/* ===== 重点项目与 TIER1 弱国哨兵调度（2026-08-29 Task #465 采集质量审计）=====
 * 审计实测：BRI/重点项目命中 2 条/7d(0.1%)，沙特/印尼/哈萨克 TIER1 十余条，
 * 刚果(金)/吉布提/秘鲁/老挝/阿尔及利亚/阿联酋/希腊/巴拿马 8 个 TIER2 重点国零覆盖。
 * 每 30 分钟一轮：项目关键词矩阵 + 项目→国别权威映射，条目强制 data_type 按内容分类。 */
let _projectWatchBusyUntil = 0;
async function _runProjectWatch() {
  if (Date.now() < _projectWatchBusyUntil) return;
  _projectWatchBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await projectWatch.runProjectWatch({ maxPerQuery: 10 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      try { ENTITY.enrich(it); it.interestLinked = true; } catch (e) {}
      const t = String(it.title || '') + ' ' + String(it.title_zh || '');
      /* 强制 data_type：项目安全事件优先 */
      if (/绑架|劫持|kidnap|hostage|abduct|袭击|遇袭|attacked|bomb|爆炸|枪击/i.test(t)) it.data_type = 'security_events';
      else if (/制裁|实体清单|sanction|entity list|出口管制|export control/i.test(t)) it.data_type = 'sanctions_data';
      else if (/债务|违约|debt|default|退出|withdraw|暂停|suspend|审查|review/i.test(t)) it.data_type = 'economic_risk';
      else if (/中断|停运|停产|halt|disrupt|damage|破坏|坍塌|事故|accident/i.test(t)) it.data_type = 'infrastructure';
      else it.data_type = 'infrastructure'; /* 项目动态默认基础设施类（港口/铁路/矿山运营） */
      it._forceDataType = true;
      it._sourceType = 'project_watch';
      if (!it.category) it.category = '重点项目监控';
    });
    const res = await _ingestLinkedItems(items, 'PROJECT-WATCH', '');
    if (res && res.inserted) console.log('[PROJECT-WATCH] ✅ 新入库重点项目情报 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[PROJECT-WATCH] 采集失败:', e.message); }
  finally { _projectWatchBusyUntil = 0; }
}

/* ===== 94源工程包采集器调度（2026-08-28 用户提供 WORKBUDDY-INSTRUCTION 工程包）=====
 * 每 30 分钟：11 个实测活源直采（中国新闻网/巴联社/塔斯社/尼日利亚双源/巴西双源/秘鲁安第斯通讯社/
 * BBC/BangkokPost/半岛）+ 死源 GNews site: 复活轮换（Reuters/AP/SCMP/Dawn/Kazinform 等）。
 * 条目带 stance 立场标签（G/I/N/W/C），入库后 _markCorroboration 做 ≥2 立场交叉验证。 */
let _sourcesPackBusyUntil = 0;
async function _runSourcesCollector() {
  if (Date.now() < _sourcesPackBusyUntil) return;
  _sourcesPackBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await sourcesCollector.runSourcesCollector({ maxPerFeed: 10, maxPerQuery: 10 });
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 4); } catch (e) {}
    items.forEach(it => {
      it.interestLinked = true;
      try { ENTITY.enrich(it); } catch (e) {}
    });
    const res = await _ingestLinkedItems(items, 'SOURCES-PACK', '（活源' + r.liveCount + '+复活' + r.revivedCount + '）');
    if (res && res.inserted) console.log('[SOURCES-PACK] ✅ 新入库多立场源情报 ' + res.inserted + ' 条（活源' + r.liveCount + '/site:复活' + r.revivedCount + '）');
  } catch (e) { console.warn('[SOURCES-PACK] 采集失败:', e.message); }
  finally { _sourcesPackBusyUntil = 0; }
}

/* ===== 涉华人员安全专项哨兵调度（2026-08-25 用户铁指令）=====
 * 7×24 每 30 分钟一轮：cn-security-watch 三层采集（GDELT/GNews/Bing 多语种关键词组合
 * + 高危国别本地小源直采 RSS + 老旧 TLS curl 兜底），入库走与 GLOBALMEDIA 同一套
 * 闸门/翻译/去重/统计链路。背景：8-24 刚果金上加丹加中国公民遇袭绑架案系统零采集。 */
let _cnsecBusyUntil = 0;
async function _runCnSecurityWatch() {
  if (Date.now() < _cnsecBusyUntil) return;
  _cnsecBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await cnsecWatch.runCnSecurityWatch();
    const items = r.items || [];
    if (!items.length) return;
    try { await _translateListToZhParallel(items, 6); } catch (e) { console.warn('[CNSEC] 翻译异常:', e.message); }
    items.forEach(it => {
      try {
        ENTITY.enrich(it);
        it.interestLinked = true; /* 哨兵条目定义上即涉华人员安全事件 */
        if (!it.category) it.category = '涉华人员安全事件';
      } catch (e) {}
    });
    const res = await _ingestLinkedItems(items, 'CNSEC', '');
    if (res && res.inserted) console.log('[CNSEC] ✅ 新入库涉华人员安全事件 ' + res.inserted + ' 条');
  } catch (e) { console.warn('[CNSEC] 采集失败:', e.message); }
  finally { _cnsecBusyUntil = 0; }
}

/* ===== 公众号镜像站直采调度（2026-08-25 用户铁指令：真正实现公众号实时采集） ===== */
let _wxMirrorBusyUntil = 0;
async function _runWechatMirrors() {
  if (Date.now() < _wxMirrorBusyUntil) return;
  _wxMirrorBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await wechatMirrors.collect({});
    const items = r.items || [];
    if (items.length) {
      items.forEach(it => { try { ENTITY.enrich(it); } catch (e) {} });
      const res = await _ingestLinkedItems(items, 'WECHAT-MIRROR', '');
      console.log('[WECHAT-MIRROR] 一轮: 镜像' + r.stats.mirrorsOk + '/' + r.stats.mirrors + ' 新文' + r.stats.fresh + ' 入库' + ((res && res.inserted) || 0) + (r.stats.errors.length ? ' 异常:' + r.stats.errors.join(';') : ''));
    }
  } catch (e) { console.warn('[WECHAT-MIRROR] 采集失败:', e.message); }
  finally { _wxMirrorBusyUntil = 0; }
}

/* ===== 公众号涉华负面专项调度（2026-08-26）：组合词检索把涉华负面新文顶到结果页前部 ===== */
let _wxNegBusyUntil = 0;
let _wechatNegLastRun = null;
async function _runWechatNegative() {
  if (Date.now() < _wxNegBusyUntil) return;
  _wxNegBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await wechatNeg.collectNegative({});
    _wechatNegLastRun = { at: new Date().toISOString(), stats: r.stats || {} };
    const items = r.items || [];
    if (items.length) {
      const inserted = await _wechatIngest(items);
      console.log('[WECHAT-NEG] 一轮: 账号' + (r.stats.accountsOk || 0) + '/' + (r.stats.accounts || 0) + ' 查询' + (r.stats.queries || 0) + ' 新文' + (r.stats.fresh || 0) + ' 入库' + (inserted || 0) + (r.stats.errors && r.stats.errors.length ? ' 异常:' + r.stats.errors.slice(0, 3).join(';') : ''));
    } else if (r.stats && r.stats.errors && r.stats.errors.length) {
      console.log('[WECHAT-NEG] 一轮无新文 | ' + r.stats.errors.slice(0, 3).join(';'));
    }
  } catch (e) { console.warn('[WECHAT-NEG] 采集失败:', e.message); }
  finally { _wxNegBusyUntil = 0; }
}

/* ===== 公众号线索→全球搜索→抓取入库 四步管线调度（2026-08-26 用户指令）=====
 * 新路径取代"从公众号抓取数据入库"：公众号只做线索雷达（搜狗检索），
 * 入库数据全部来自全球媒体原文（GDELT/GNews/Bing 检索 → fulltext 抓全文 → 既有闸门入库）。 */
let _wxLeadsBusyUntil = 0;
let _wechatLeadsLastRun = null;
async function _runWechatLeads() {
  if (Date.now() < _wxLeadsBusyUntil) return;
  _wxLeadsBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  try {
    const r = await wechatLeads.collect({ log: m => console.log('[WECHAT-LEAD] ' + m) });
    _wechatLeadsLastRun = { at: new Date().toISOString(), stats: r.stats || {} };
    const items = r.items || [];
    const st = r.stats || {};
    if (items.length) {
      try { await _translateListToZhParallel(items, 6); } catch (e) { console.warn('[WECHAT-LEAD] 翻译异常:', e.message); }
      items.forEach(it => { try { ENTITY.enrich(it); it.interestLinked = true; } catch (e) {} });
      const res = await _ingestLinkedItems(items, 'WECHAT-LEAD', '');
      console.log('[WECHAT-LEAD] 一轮: 账号' + (st.accountsOk || 0) + '/' + (st.accounts || 0) + ' 查询' + (st.queries || 0) + ' 线索' + (st.leadsNew || 0) + '/' + (st.leads || 0) + ' 跟进' + (st.followed || 0) + ' 全球命中(gdelt ' + (st.gdelt || 0) + '/gnews ' + (st.gnews || 0) + '/bing ' + (st.bing || 0) + ') GNews解析(成功' + (st.gnewsResolved || 0) + '/失败' + (st.gnewsResolveFailed || 0) + ') 抓文' + (st.fetched || 0) + ' 相关过滤' + (st.droppedIrrelevant || 0) + ' 入库' + ((res && res.inserted) || 0));
    } else {
      console.log('[WECHAT-LEAD] 一轮无入库: 账号' + (st.accountsOk || 0) + '/' + (st.accounts || 0) + ' 查询' + (st.queries || 0) + ' 线索' + (st.leadsNew || 0) + '/' + (st.leads || 0) + ' 跟进' + (st.followed || 0) + ' 全球命中(gdelt ' + (st.gdelt || 0) + '/gnews ' + (st.gnews || 0) + '/bing ' + (st.bing || 0) + ') GNews解析(成功' + (st.gnewsResolved || 0) + '/失败' + (st.gnewsResolveFailed || 0) + ') 抓文' + (st.fetched || 0) + ' 相关过滤' + (st.droppedIrrelevant || 0) + (st.errors && st.errors.length ? ' | ' + st.errors.slice(0, 3).join(';') : ''));
    }
  } catch (e) { console.warn('[WECHAT-LEAD] 采集失败:', e.message); }
  finally { _wxLeadsBusyUntil = 0; }
}

function startGlobalMediaCron() {
  setTimeout(() => { _syncDailyStatsFromDB().then(() => { _runGlobalMedia(); _runChinaFocus(); _runChinaNegative(); _runTerrorAttacks(); _runCoreThreatWatch(); }); }, 5000);  // 启动后5s先同步统计再首跑
  setInterval(_runGlobalMedia, GLOBAL_MEDIA_INTERVAL_MS); // 每60秒刷新一轮
  setInterval(_runChinaFocus, GLOBAL_MEDIA_INTERVAL_MS);  // 涉华专项同步运行
  setInterval(_runChinaNegative, 60 * 1000);  // 境外涉华负面专项每60秒运行一次（AP检索耗时较长，避免阻塞主循环）
  setInterval(_runTerrorAttacks, 90 * 1000);  // 恐怖袭击/武装袭击专项每90秒运行一次（高危国家重点监控）
  setInterval(_runCoreThreatWatch, 60 * 1000);  // 海外核心安全威胁一分钟哨兵（巴基斯坦/CPEC、阿富汗、非洲、中亚、东南亚），用户 2026-08-27 铁指令
  // ===== 官方框架五维哨兵（2026-08-28 用户指令：六大维度不留空白）=====
  setTimeout(_runChannelWatch, 200000);       // 海上战略通道哨兵（维度⑤），启动200s后首跑
  setInterval(_runChannelWatch, 10 * 60 * 1000); /* 2026-08-28 时效提速：30min→10min（海上通道事件波及航运分秒必争） */
  setTimeout(_runComplianceWatch, 260000);    // 制裁合规哨兵（维度⑥），启动260s后首跑
  setInterval(_runComplianceWatch, 15 * 60 * 1000); /* 2026-08-28 时效提速：30min→15min */
  setTimeout(_runConsularWatch, 320000);      // 领事保护哨兵（维度②：MFA安全提醒/撤侨/领保），启动320s后首跑
  setInterval(_runConsularWatch, 10 * 60 * 1000); /* 2026-08-28 涉华受害专项提速：30min→10min（用户指令：涉华受害是采集核心） */
  setTimeout(_runCoreThreatSentinel, 350000);  // 核心威胁专项哨兵（弱类补强），启动350s后首跑
  setInterval(_runCoreThreatSentinel, 10 * 60 * 1000);
  setTimeout(_runTranslateRetry, 180000);      // 未翻译重试队列，启动180s后首跑
  setInterval(_runTranslateRetry, 15 * 60 * 1000);
  // 94源工程包采集器（2026-08-28：多立场源证据链），启动380s后首跑
  setTimeout(_runSourcesCollector, 380000);
  setInterval(_runSourcesCollector, 15 * 60 * 1000); /* 2026-08-28 时效提速：30min→15min */
  // 重点项目与TIER1弱国哨兵（2026-08-29 审计补强：BRI/项目命中+零覆盖重点国），启动8分钟后首跑
  setTimeout(_runProjectWatch, 8 * 60 * 1000);
  setInterval(_runProjectWatch, 30 * 60 * 1000);
  // WorldMonitor.app 数据接入哨兵（2026-08-31：UCDP冲突/FCDO警示/断网/疫情/新闻摘要），启动9分钟后首跑
  setTimeout(_runWmFeed, 9 * 60 * 1000);
  setInterval(_runWmFeed, 30 * 60 * 1000);
  // 涉华人员安全专项哨兵：每30分钟一轮（2026-08-25 用户铁指令），启动3分钟后首跑
  setTimeout(_runCnSecurityWatch, 3 * 60 * 1000);
  setInterval(_runCnSecurityWatch, 10 * 60 * 1000); /* 2026-08-28 涉华受害专项提速：30min→10min */
  // 公众号镜像站直采：每15分钟一轮（2026-08-25；与搜狗/profile_ext 通道并行互补）
  setTimeout(_runWechatMirrors, 150 * 1000);
  setInterval(_runWechatMirrors, 15 * 60 * 1000);
  // 公众号线索四步管线：每30分钟一轮（2026-08-26 用户指令：公众号只查询线索，全球搜索抓数据入库；
  // 取代原 _runWechatOA/_runWechatNegative 直采入库——公众号文章本身不再入库）
  setTimeout(_runWechatLeads, 5 * 60 * 1000);
  setInterval(_runWechatLeads, 30 * 60 * 1000);
  // 每5分钟再同步一次数据库，防止统计漂移
  setInterval(_syncDailyStatsFromDB, 5 * 60 * 1000);
  // 采集自动驾驶调速器：每10分钟自检，落后自动加码，达标自动降档
  setInterval(_governorCheck, 10 * 60 * 1000);
  setTimeout(_governorCheck, 30 * 1000); // 启动30s后首次自检
  // 采集巡检哨兵：每30分钟巡查，断粮/空转自动修复加速（2026-08-15 用户指令）
  setInterval(_patrolSentinel, 30 * 60 * 1000);
  setTimeout(_patrolSentinel, 2 * 60 * 1000); // 启动2分钟后首巡建立基线
  // BRI 专项采集器：每5分钟一轮，日≥100条/巴基斯坦≥40条（2026-08-16 用户指令）
  setTimeout(() => { _syncBriStatsFromDB().then(() => { _runBriFocus(); }); }, 25000);
  setInterval(_runBriFocus, 5 * 60 * 1000);
  // Google News 旧闻验真清扫器：每15分钟解码原始URL验发布日期，旧闻剔除+墓碑
  // （2026-08-30 根治塔吉克旧闻污染——Google News pubDate 是收录时间非发布时间）
  setTimeout(_runGnewsTruthSweep, 3 * 60 * 1000);
  setInterval(_runGnewsTruthSweep, 15 * 60 * 1000);
  // 中文媒体通道：每10分钟一轮——涉华突发（人员伤亡/项目遇袭）国内信源首报最快（2026-08-17）
  setTimeout(_runCnMedia, 40000);
  setInterval(_runCnMedia, 10 * 60 * 1000);
  /* 缺口调度器（2026-08-29 用户指令：全球均衡+全类别，采集有重点）：
   * 合并取代区域均衡(_runRegionBalance)/类别均衡(_runCategoryBalance)两个调度入口——
   * 统一按「国家梯队×12类别目标矩阵」算缺口定向补，每 30 分钟一轮。 */
  setTimeout(_runGapScheduler, 2 * 60 * 1000);
  setInterval(_runGapScheduler, 30 * 60 * 1000);
  // 原微信公众号直采 cron 已于 2026-08-26 退役（用户指令：不再从公众号抓取数据入库，
  // 由 _runWechatLeads 四步管线取代；wechatoa/wechatNeg 模块保留供手动诊断端点使用）。
  // Neon 云采集同步：每10分钟拉取 GitHub Actions 采集的原始条目（2026-08-24 方案二；未配置 NEON_DATABASE_URL 时静默跳过）
  setTimeout(_runNeonSync, 90000);
  setInterval(_runNeonSync, 10 * 60 * 1000);
  // Neon 云端容灾备份：每30分钟把本地新入库数据增量上行到云端副本（2026-08-25 用户铁指令"一次性解决数据库"）
  setTimeout(_runNeonBackup, 4 * 60 * 1000);
  setInterval(_runNeonBackup, 30 * 60 * 1000);
}

/* ===== 全球恐怖袭击/武装袭击专项采集 ===== */
/* _terrorBusy 已改为 _terrorBusyUntil 时间戳锁 */
async function _runTerrorAttacks() {
  if (Date.now() < _terrorBusyUntil) return;
  _terrorBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  console.log('[TERROR] 开始恐怖袭击/武装袭击专项采集...');
  const t0 = Date.now();
  try {
    const res = await globalmedia.scrapeTerrorAttacks({ concurrency: 6, timeout: 10000 });
    let items = res.items || [];
    const seenUrl = new Set(items.map(it => it.url).filter(Boolean));

    /* 翻译 */
    try { await _translateListToZhParallel(items, 3); } catch (e) { console.warn('[TERROR] 翻译异常:', e.message); }

    /* 入库 */
    let inserted = 0, redCount = 0, orangeCount = 0, skippedDup = 0, skippedDupTitle = 0, skippedStale = 0, skippedRuUa = 0;
    const urls = items.map(it => it.url).filter(Boolean);
    const existing = new Set();
    if (urls.length) {
      const batch = urls.map((_, i) => `$${i + 1}`).join(',');
      const dup = await query(`SELECT data_json->>'url' as url FROM intel_data WHERE data_type='terror_events' AND data_json->>'url' IN (${batch})`, urls);
      dup.rows.forEach(r => { if (r.url) existing.add(r.url); });
    }
    const titleKeys = await _getRecentTitleKeys();
    for (const it of items) {
      const u = it.url || it.title;
      if (!u) continue;
      if (existing.has(u)) { skippedDup++; continue; }
      if (_isDupTitle(titleKeys, it)) { skippedDupTitle++; continue; }
      if (!_isFreshEnough(it)) { skippedStale++; _sidepool(it, 'stale-over24h', 'TERROR'); continue; }
      if (!_ruUaQuotaOk(it)) { skippedRuUa++; _sidepool(it, 'ruua-quota', 'TERROR'); continue; }
      try {
        it._eventSig = _eventSignature(it);
        _tagAssets(it); it.level_norm = it.level || 'yellow';
        const _ins = await query(
          `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          ['terror_events', it.title, it.country_cn || '', '', it.publish_time || '', it.level || 'yellow', it.content || '', it.source || '', JSON.stringify(it), 'approved']
        );
        _addTitleKey(titleKeys, it);
        if (_ins && _ins.rows && _ins.rows[0]) _markCorroboration(_ins.rows[0].id, it);
        inserted++;
        if (it.level === 'red') redCount++;
        else if (it.level === 'orange') orangeCount++;
      } catch (e) { console.warn('[TERROR] 入库失败:', e.message); }
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[TERROR] 完成(' + sec + 's): 命中' + items.length + ' / 入库' + inserted + '（红色' + redCount + ' 橙色' + orangeCount + '）跳过URL重复' + skippedDup + ' 标题同事件' + skippedDupTitle + ' 超时旧闻' + skippedStale + ' 俄乌超配额' + skippedRuUa);
  } catch (e) { console.warn('[TERROR] 采集失败:', e.message); }
  finally { _terrorBusyUntil = 0; }
}
app.get('/api/media', async (req, res) => {
  try {
    const { country, all, status, limit, refresh } = req.query;
    if (refresh === 'gdelt') {
      /* 手动触发 GDELT 全球媒体补充（环境允许时）。带超时保护：不可达则异步放弃，不伪造。 */
      Promise.race([
        globalmedia.scrapeGlobalMedia({ max: 15, timespan: '7d' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('gdelt-timeout')), 120000))
      ]).then(async g => {
        if (g && g.items && g.items.length) {
          try { await _translateListToZhParallel(g.items, 6); } catch (e) {}
          _mergeMedia(g.items, g.byCountry, { gdelt: g.count });
        }
      }).catch(e => console.warn('[GLOBALMEDIA] GDELT 补充本轮回避:', e.message));
      return res.json({ ok: true, note: 'GDELT 全球媒体补充任务已触发（环境允许时异步入库），稍后刷新查看' });
    }
    if (status !== undefined) {
      const itemSet = new Set((_mediaCache.items || []).map(it => it.country_cn).filter(Boolean));
      return res.json({
        ok: true, status: _mediaCache.status || {},
        countries: globalmedia.GLOBAL_COUNTRIES.length,
        sources: (globalmedia.DIRECT_RSS || []).length,
        thinkTanks: (globalmedia.THINK_TANK_FEEDS || []).length,
        distinctCountries: itemSet.size,
        total: (_mediaCache.items || []).length,
        itemCountries: Array.from(itemSet).sort(),
        updatedAt: _mediaCache.updatedAt || 0
      });
    }
    let items = (_mediaCache.items || []).slice();
    if (country) items = items.filter(it => it.country_cn === country || it.country_iso === country);
    /* 2026-08-29 墓碑出口闸：全球媒体通道同样滤除已删除旧文 */
    try {
      const _tb = await _getTombstones();
      items = items.filter(it => { if (_tombMatchSync(_tb, it)) { _gateAudit('出口闸', 'tombstoned', it.title); return false; } return true; });
    } catch (e) {}
    const lim = Math.min(500, parseInt(limit || '200', 10) || 200);
    return res.json({ ok: true, count: items.length, items: items.slice(0, lim) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* 每日采集指标：总量≥500条/天，涉华80-100条/天，境外涉华负面≥50条/天 */
app.get('/api/media/daily-stats', async (req, res) => {
  try {
    /* 本地自然日 0 点边界（不能用 CURRENT_DATE——取决于 PG 会话时区，跨天可能不切换） */
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { rows: dbStats } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE collect_time >= $1) AS total_today,
        COUNT(*) FILTER (WHERE collect_time >= $1 AND (
          title ILIKE '%中国%' OR title ILIKE '%Chinese%' OR title ILIKE '%China%' OR title ILIKE '%中资%'
          OR title ILIKE '%华人%' OR title ILIKE '%华侨%' OR title ILIKE '%中方%' OR title ILIKE '%中企%'
          OR title ILIKE '%一带一路%' OR title ILIKE '%BRI%' OR title ILIKE '%Belt and Road%'
        )) AS china_today
      FROM intel_data
    `, [dayStart]);
    // 境外涉华负面计数：兼容历史数据，标题命中涉华+负面关键词即计入
    const { rows: chinaRows } = await query(`
      SELECT title, data_json->>'_chinaNegative' AS neg
      FROM intel_data
      WHERE collect_time >= $1 AND (
        title ILIKE '%中国%' OR title ILIKE '%Chinese%' OR title ILIKE '%China%' OR title ILIKE '%中资%'
        OR title ILIKE '%华人%' OR title ILIKE '%华侨%' OR title ILIKE '%中方%' OR title ILIKE '%中企%'
        OR title ILIKE '%一带一路%' OR title ILIKE '%BRI%' OR title ILIKE '%Belt and Road%'
      )
    `, [dayStart]);
    let dbChinaNeg = 0;
    chinaRows.forEach(r => {
      if (_isChinaNegative({ title: r.title, _chinaNegative: r.neg === 'true' })) dbChinaNeg++;
    });
    const s = _dailyStats;
    const dbTotal = parseInt(dbStats[0].total_today || '0', 10);
    const dbChinaRaw = parseInt(dbStats[0].china_today || '0', 10);
    // 常规涉华计数排除境外涉华负面，保持二者独立
    const dbChina = Math.max(0, dbChinaRaw - dbChinaNeg);
    res.json({
      ok: true,
      runtime: { date: s.date, total: s.total, linked: s.linked, china: s.china, chinaNegative: s.chinaNegative, rounds: s.rounds, lastRound: s.lastRound },
      database: { total: dbTotal, china: dbChina, chinaNegative: dbChinaNeg },
      targets: { totalMin: 500, chinaMin: 80, chinaMax: 100, chinaNegativeMin: 50 },
      gaps: { total: Math.max(0, 500 - Math.max(s.total, dbTotal)), china: Math.max(0, 80 - Math.max(s.china, dbChina)), chinaNegative: Math.max(0, 50 - Math.max(s.chinaNegative, dbChinaNeg)) },
      patrol: _patrolState, /* 巡检哨兵状态（2026-08-15）：档位/最近动作对前端可见 */
      bri: { total: _briStats.total, pakistan: _briStats.pakistan, rounds: _briStats.rounds, lastRun: _briStats.lastRun, targetTotal: 100, targetPakistan: 40 },
      /* 闸门拒收漏斗（2026-08-31 任务 #521）：用户问"600 采集 100 入库"——
       * 实际是各闸门合理去重（事件签名重复/URL 重复是正常防刷屏），现在暴露给前端可视化 */
      funnel: {
        date: _rejectsSession.date,
        collected: _rejectsSession.collected,        /* 原始抓取数（用户看到的"采集 X"） */
        linked: _rejectsSession.linked,              /* 过兴趣关联闸后 */
        inserted: _rejectsSession.inserted,          /* 真正入库数 */
        rejected: _rejectsSession.collected - _rejectsSession.inserted,
        /* 拒收分桶 */
        dupUrl: _rejectsSession.dupUrl,              /* 库内已有 URL */
        dupTitle: _rejectsSession.dupTitle,          /* 标题/实体重复 */
        dupEvent: _rejectsSession.dupEvent,          /* 事件签名重复（防刷屏，正常的同事件多源去重） */
        domestic: _rejectsSession.domestic,          /* 国内数据被 chinaOverseasGate 拦 */
        badTitle: _rejectsSession.badTitle,          /* 烂标题（翻译质量/外文主体） */
        historical: _rejectsSession.historical,      /* 历史旧案回顾否决 */
        stale: _rejectsSession.stale,                /* 超 24h 旧闻 */
        ruUa: _rejectsSession.ruUa,                  /* 俄乌超配额 */
        catStruct: _rejectsSession.catStruct,        /* 类别结构帽让位 */
        noUrl: _rejectsSession.noUrl,
        insertErr: _rejectsSession.insertErr,
        bySource: _rejectsSession.bySource
      },
      nextRoundSec: GLOBAL_MEDIA_INTERVAL_MS / 1000
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ==================== 开放网络深度检索端点 ====================
 * 真正的开放网络检索：任意关键词 → 远程真实检索（AP 通讯社站内检索 + GDELT 全球检索）
 *                    → 跟进命中的真实文章 URL → 抓取真实正文 → 相关性闸门
 *                    → 实体关联引擎（中资主体/海外项目/国别/资产/风险分/预警等级）
 * 铁律：只返回真实检索到的公开信息；通道不可用时如实返回 0 条并给出通道台账，绝不伪造。
 */
app.get('/api/deepsearch', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ ok: true, channels: crawler.WEB_CHANNELS, count: 0, items: [], note: '缺少 q 参数（检索关键词）' });
    const max = Math.min(30, parseInt(req.query.max || '12', 10) || 12);
    const items = await crawler.crawlWeb(q, {
      max: max,
      maxPages: Math.min(max, parseInt(req.query.pages || '8', 10) || 8),
      lang: req.query.lang || 'en',
      timespan: req.query.timespan || '7d',
      country: req.query.country || ''
    });
    /* 正文深度补全：对只抓到标题/摘要的条目回源抓全文 + 抽结构化要素，抓不到就原样保留 */
    let ftStat = null;
    try {
      ftStat = await fulltext.enrichBatch(items, {
        resolveUrl: crawler.resolveUrl, concurrency: 5, budgetMs: 45000, minLen: 400
      });
    } catch (e) { /* 补全失败不影响检索结果返回 */ }
    items.forEach(function(it) { if (!it.alert_no) { try { it.alert_no = fulltext.makeAlertNo(it); } catch (e) {} } });
    const linked = items.filter(it => it.interestLinked).length;
    res.json({
      ok: true, query: q, count: items.length, interestLinked: linked,
      fulltext: ftStat, channels: crawler.WEB_CHANNELS, items: items
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

/* 开放网络检索通道健康台账（如实反映各通道实测状态） */
app.get('/api/deepsearch/channels', (req, res) => {
  res.json({ ok: true, channels: crawler.WEB_CHANNELS });
});

/* ==================== 境外社交媒体情报采集端点 ====================
 * SOCMINT：Telegram 公开频道 + Hacker News 全文检索（均为真实公开数据）
 * 采集结果一律标记 verified:false，须经人工审核后方可进入预警中心。
 */
app.get('/api/social', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(60, parseInt(req.query.limit || '25', 10) || 25);
    const r = q
      ? await social.searchSocial(q, { limit: limit })
      : await social.collectSocial({ limit: limit, perChannel: parseInt(req.query.perChannel || '20', 10) || 20 });
    /* 降级存储：写入服务端文件缓存，供无 PostgreSQL 时的公开通道使用 */
    if (r && r.items && r.items.length) { await _translateListToZh(r.items); _mergePublicCache('socmint_intel', r.items); }
    res.json(Object.assign({ ok: true }, r));
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

/* 社交媒体通道健康台账（真实可达性，不可达通道如实标注） */
app.get('/api/social/channels', (req, res) => {
  try { res.json({ ok: true, channels: social.socialHealth() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

/* ==================== 实体关联与预警规则引擎端点 ====================
 * 供前端"企业安全/项目关联/预警定级"复用同一套规则，保证前后端判定完全一致。
 */
app.get('/api/entities/registry', (req, res) => {
  try {
    res.json({
      ok: true,
      enterprises: ENTITY.ENTERPRISES.map(e => ({ id: e.id, name: e.name, type: e.type, sector: e.sector })),
      projects: ENTITY.PROJECTS.map(p => ({ id: p.id, name: p.name, country: p.country, tier: p.tier, corp: p.corp })),
      corridors: ENTITY.CORRIDORS,
      assetTypes: ENTITY.ASSET_TYPES.map(a => ({ id: a.id, name: a.name, weight: a.weight })),
      threatRules: ENTITY.THREAT_RULES.map(r => ({ id: r.id, name: r.name, score: r.score })),
      countries: Object.keys(ENTITY.COUNTRY_RISK).length
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

/* 对任意文本做实体识别 + 风险定级（人工研判/审核辅助） */
app.post('/api/entities/assess', (req, res) => {
  try {
    const b = req.body || {};
    const text = String(b.text || ((b.title || '') + ' ' + (b.content || ''))).trim();
    if (!text) return res.status(400).json({ ok: false, error: '缺少 text' });
    const r = ENTITY.assessRisk({ title: b.title || '', content: b.content || text, country: b.country || '', source: b.source || '', pubDate: b.pubDate || '' });
    res.json({ ok: true, result: r });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

/* ==================== AgentKey 连接器端点 ====================
 * 部署 AgentKey 为系统实战数据源：搜索 + 全文抓取 → 详细情报（标题+正文+来源+URL+国家+分类）
 * 实战模式：仅真实数据。无密钥时 /collect 回退种子文件，保证开箱即有详细内容。
 */
/* ==================== GEOINT 实时卫星影像接入端点 ====================
 * 仅真实数据源（Sentinel-2 / Maxar Open Data / Planet NICFI），全免费。
 * 公开端点（与 /api/scrape、/api/crawl 一致，非鉴权），由前端 GEOINTLIVE 面板调用。
 */
app.get('/api/geoint/search', async (req, res) => {
  try {
    const { source, lat, lon } = req.query;
    const r = await geoint.search({ source: source || 'sentinel2', lat, lon });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

app.get('/api/geoint/change', async (req, res) => {
  try {
    const { lat, lon, recentDays, baselineDays } = req.query;
    const r = await geoint.change({ lat, lon, recentDays, baselineDays });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

app.get('/api/agentkey/status', (req, res) => {
  try { res.json({ ok: true, status: agentkey.status() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/agentkey/collect', async (req, res) => {
  try {
    const raw = req.query.queries || req.query.q || '';
    const queries = String(raw).split('|').map(s => s.trim()).filter(Boolean);
    if (!queries.length) return res.json({ ok: false, error: '缺少 queries 参数（用 | 分隔多个关键词）' });
    const limitPer = parseInt(req.query.limitPer || '8', 10) || 8;
    const scrapeTop = parseInt(req.query.scrapeTop || '3', 10) || 3;
    const st = agentkey.status();
    if (!st.search.length || !st.scrape.length) {
      /* 未配置上游密钥：回退种子文件（真实详细数据），并提示如何启用实时采集 */
      const seed = agentkey.loadSeed();
      return res.json({
        ok: true, mode: 'seed-fallback', live: false,
        count: seed.length, items: seed,
        hint: '未配置 AgentKey 上游密钥（server/.env 的 AGENTKEY_*_KEY）。当前返回已落盘的真实详细种子数据；配置密钥后将自动实时搜索+全文抓取。',
        status: st
      });
    }
    const items = await agentkey.collect(queries, { limitPer, scrapeTop });
    res.json({ ok: true, mode: 'live', live: true, count: items.length, items, status: st });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ==================== 翻译接口（外文情报→中文）====================
 * 通道优先级（2026-07-31 重构，修复"翻译工具没用"）：
 *   1) 可选密钥翻译服务：环境变量 BAIDU_TRANSLATE_APPID / BAIDU_TRANSLATE_KEY
 *      —— 百度翻译开放平台免费版 200 万字符/月，国内稳定可达，无需 Beta 审核
 *   2) MyMemory 免费翻译（匿名 5000 字符/天，国内可达，无需密钥）
 *      —— 带【持久化翻译缓存】，同一文本只翻一次、跨会话复用，大幅突破配额瓶颈
 *   3) Edge 微软翻译（本机网络常不可达）→ 电路熔断 + 4s 快速失败，仅在偶发可用时兜底
 *   4) 全部失败/配额耗尽 → 返回 ok:false，前端自动降级为内置安全词典
 * 关键修复：
 *   - Edge 从"每次白等 10s"改为熔断器 + 4s 超时（不可达即熔断 10 分钟，恢复自动重试）
 *   - 新增 .translate_cache.json 持久化缓存：单分类首次翻译后永久免费，translatePage 不再一次烧光配额
 */
const crypto = require('crypto');
const _TRANS_CACHE_FILE = path.join(__dirname, '..', '.translate_cache.json');
let _transCache = {};
try {
  const _tc = JSON.parse(fs.readFileSync(_TRANS_CACHE_FILE, 'utf8') || '{}');
  if (_tc && typeof _tc === 'object') _transCache = _tc;
} catch (e) {}
let _transCacheDirty = false;
/* 启动清扫：批量剔除历史污染条目（[object Promise] 等），不等 _cacheGet 懒命中逐条自愈 */
(function _transCachePurge() {
  let purged = 0;
  Object.keys(_transCache).forEach(k => { if (_isGarbage(_transCache[k])) { delete _transCache[k]; purged++; } });
  if (purged) { console.log('[TRANS-CACHE] 启动清扫污染条目: ' + purged + ' 条'); _transCacheDirty = true; }
})();
function _transCacheSave() {
  if (!_transCacheDirty) return;
  try { fs.writeFileSync(_TRANS_CACHE_FILE, JSON.stringify(_transCache)); _transCacheDirty = false; } catch (e) {}
}
setInterval(_transCacheSave, 15000);
function _tkey(text) { return String(text || '').slice(0, 600); }
function _isGarbage(v) {
  if (!v) return true;
  if (/不清楚/.test(v)) return true;
  if (/^\?+$/.test(String(v).trim())) return true;
  if (/NOT TRANSLATED/i.test(v)) return true;
  /* 2026-08-30 实锤排雷：缓存曾混入 "[object Promise]" 值（未 await 的翻译结果被 String 化），
   * 命中后直接当译文入库——id=30872 标题/正文全变 [object Promise]。读自愈+写拦截双向防御。 */
  if (/\[object [A-Za-z]/i.test(String(v).slice(0, 30))) return true;
  /* 乱码特征：不含中文，却含阿拉伯/叙利亚/科普特/希伯来组合符等本不应出现在中译文的区段（多为 UTF-8→latin1 双重误编码） */
  const hasCJK = /[一-鿿]/.test(v);
  if (!hasCJK && /[؀-ۿ֐-׿͢-ͯⴢ-⴯Ⲁ-⳿]/.test(v)) return true;
  return false;
}
function _cacheGet(text) {
  const k = _tkey(text);
  const v = _transCache[k];
  if (!v) return undefined;
  /* 自愈：缓存中可能残留占位符/编码损坏，检出即剔除并视为未命中（重新翻译且不回写垃圾） */
  if (_isGarbage(v)) { delete _transCache[k]; _transCacheDirty = true; return undefined; }
  return v;
}
function _cacheSet(text, val) { if (val && !_isGarbage(val)) { _transCache[_tkey(text)] = val; _transCacheDirty = true; } }

/* 长文分块：按句子/空格边界切分为 <=size 的片段，使详细长文（数千字）可分块翻译后拼接，
   避免 MyMemory 500 字/次 与 5000 字/天 配额下"只翻前 500 字 / 返回空"的失效现象 */
function _chunkText(text, size) {
  text = String(text || '');
  if (text.length <= size) return [text];
  const out = [];
  let cur = '';
  const seps = /(?<=[.!?。！？\n])\s+/;
  const parts = text.split(seps);
  for (const p of parts) {
    if (cur.length && cur.length + p.length > size) { out.push(cur.trim()); cur = ''; }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
    } else {
      cur += (cur ? ' ' : '') + p;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(c => c.trim());
}

/* 通道3: Edge 微软翻译（电路熔断，快速失败） */
let _edgeJwt = null, _edgeJwtTime = 0;
let _edgeOk = true, _edgeBlockedUntil = 0;
async function _getEdgeJwt() {
  if (_edgeJwt && Date.now() - _edgeJwtTime < 8 * 60 * 1000) return _edgeJwt;
  let lastErr = null;
  // 沙箱内 edge.microsoft.com/translate/auth 偶发 ECONNRESET，重试 3 次避免瞬时抽风打死整段翻译
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://edge.microsoft.com/translate/auth', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      if (!r.ok) throw new Error('edge auth ' + r.status);
      _edgeJwt = (await r.text()).trim();
      _edgeJwtTime = Date.now();
      return _edgeJwt;
    } catch (e) { lastErr = e; if (attempt < 2) await new Promise(rs => setTimeout(rs, 500)); }
  }
  throw lastErr || new Error('edge auth failed');
}
async function _tryEdge(texts) {
  if (!_edgeOk && Date.now() < _edgeBlockedUntil) return null; // 熔断中，直接跳过
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const jwt2 = await _getEdgeJwt();
      const r = await fetch('https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt2, 'Content-Type': 'application/json' },
        body: JSON.stringify(texts.map(t => ({ Text: t }))),
        signal: AbortSignal.timeout(4000)
      });
      if (!r.ok) throw new Error('translate ' + r.status);
      /* 强制 UTF-8 解码，避免微软接口按 latin1 误解码产生乱码 */
      const buf = await r.arrayBuffer();
      const j = JSON.parse(new TextDecoder('utf-8').decode(buf));
      _edgeOk = true;
      /* 过滤乱码/占位符结果（Edge 对非拉丁语向常返回双重误编码乱码），避免污染译文与缓存 */
      return (j || []).map(x => {
        const t = (x && x.translations && x.translations[0] && x.translations[0].text) || '';
        return _isGarbage(t) ? '' : t;
      });
    } catch (err) {
      if (attempt < 1) { _edgeJwt = null; continue; } // 重试时强制换新 token，规避偶发失效 JWT
      _edgeOk = false; _edgeBlockedUntil = Date.now() + 30 * 60 * 1000; // edge.microsoft.com 国内被 GFW 阻断属常态（2026-08-24 实测 fetch failed）：长熔断 30 分钟，避免每条翻译白等 3×4s 超时
      console.warn('[TRANSLATE] Edge通道不可达(GFW)，熔断30分钟:', err.message);
      return null;
    }
  }
  return null;
}
/* 通道2: MyMemory 免费翻译API（国内可达，无需密钥，单条<=500字符，匿名 5000 字符/天） */
function _guessLang(t) {
  if (/[\u0600-\u06FF]/.test(t)) return 'ar';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru';
  if (/[\u3040-\u30FF]/.test(t)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko';
  return 'en';
}
async function _myMemoryOne(t, key) {
  const q = String(t || '').slice(0, 500);
  if (!q.trim()) return '';
  let url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=' + _guessLang(q) + '|zh-CN';
  if (key) url += '&key=' + encodeURIComponent(key); // 注册 key 提升免费配额至 50000 字符/日
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('mymemory ' + r.status);
  /* 强制 UTF-8 解码，规避 MyMemory 偶发 charset 声明错误导致的乱码/问号 */
  const buf = await r.arrayBuffer();
  const j = JSON.parse(new TextDecoder('utf-8').decode(buf));
  const tr = (j && j.responseData && j.responseData.translatedText) || '';
  if (/YOU USED ALL AVAILABLE FREE/.test(tr)) return '__QUOTA__'; // 配额耗尽
  if (/MYMEMORY WARNING/.test(tr)) return '';
  if (/\*不清楚\*|\*未翻译\*|\* NOT TRANSLATED \*/.test(tr)) return ''; // 占位符（MyMemory 不支持该语向）
  if (/^\?+$/.test(tr.trim())) return ''; // 编码损坏（纯问号）
  if (!tr || !tr.trim()) return '';
  if (tr.trim().toLowerCase() === q.trim().toLowerCase()) return ''; // 原样返回=未翻译（配额/限频时 MyMemory 回显原文）
  return tr;
}
/* MyMemory 通道（带持久化缓存，先查缓存避免重复消耗配额；长文分块翻译）。
 * 注意：单块失败（配额/限频/回显原文）绝不回退为原文——整条标记失败交由 Edge 兜底，
 * 否则会出现"英文原文被当译文写回 title_zh"的致命错误。 */
async function _translateViaMyMemory(texts) {
  const out = new Array(texts.length);
  const need = [];
  texts.forEach((t, i) => {
    const c = _cacheGet(t);
    if (c) out[i] = c; else need.push(i);
  });
  let quota = false;
  if (need.length) {
    const res = await Promise.all(need.map(async (i) => {
      const t = texts[i];
      if (!t.trim()) return { ok: true, text: '' };
      const chunks = _chunkText(t, 480); // MyMemory 单条 <=500 字符
      const translated = [];
      for (const ch of chunks) {
        const tr = await _myMemoryOne(ch, MYMEMORY_KEY).catch(() => '');
        if (tr === '__QUOTA__') { quota = true; return { ok: false, text: '' }; }
        if (!tr) return { ok: false, text: '' }; // 块失败→整条失败，交由 Edge 兜底
        translated.push(tr);
      }
      return { ok: true, text: translated.join(' ') };
    }));
    need.forEach((i, k) => {
      const r = res[k];
      if (r.ok && r.text) { out[i] = r.text; _cacheSet(texts[i], r.text); }
      else { out[i] = ''; } // 失败（空），交给 Edge
    });
  }
  return { out, quota };
}
/* 通道2.5: LibreTranslate 免费公共 API（开源翻译引擎，多公共实例轮询，无需密钥） */
const _LIBRE_ENDPOINTS = [
  'https://libretranslate.de',
  'https://translate.argosopentech.com',
  'https://libretranslate.pussthecat.org'
];
let _libreIdx = 0;
async function _tryLibreTranslate(texts) {
  const src = _guessLang(texts[0] || '');
  const body = JSON.stringify({ q: texts, source: src, target: 'zh', format: 'text' });
  const startIdx = _libreIdx;
  for (let attempt = 0; attempt < _LIBRE_ENDPOINTS.length; attempt++) {
    const ep = _LIBRE_ENDPOINTS[(_libreIdx + attempt) % _LIBRE_ENDPOINTS.length];
    try {
      const r = await fetch(ep + '/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) continue;
      const j = await r.json();
      const out = (j && j.translatedText) ? (Array.isArray(j.translatedText) ? j.translatedText : [j.translatedText]) : [];
      if (out.length && out.some(t => t && /[\u4e00-\u9fff]/.test(t))) {
        _libreIdx = (_libreIdx + attempt + 1) % _LIBRE_ENDPOINTS.length;
        return out.map(t => _isGarbage(t) ? '' : t);
      }
    } catch (e) { /* 换下一个实例 */ }
  }
  return null;
}
/* 通道1: 百度翻译开放平台（可选，需环境变量配置；免费 200 万字符/月，国内稳定） */
function _baiduSign(q, appid, key, salt) {
  return crypto.createHash('md5').update(appid + q + salt + key).digest('hex');
}
async function _translateViaBaidu(texts, appid, key) {
  /* 2026-08-24 修复 54003：Promise.all 并行撞百度免费版 1 QPS 上限。
   * 改为逐条串行 + 全局节流（_baiduThrottle 串行队列 + ≥1150ms 间隔）。 */
  const results = [];
  for (let t of texts) {
    await _baiduThrottle();
    t = String(t || '');
    if (!t.trim()) { results.push(''); continue; }
    /* 长文分块（百度单条上限 6000 字符，分块后拼接可翻译任意长度详细正文） */
    const chunks = _chunkText(t, 5000);
    const parts = [];
    for (const ch of chunks) {
      if (parts.length) await _baiduThrottle(); // 多块之间同样守 1 QPS
      const q = ch;
      const salt = Date.now() + '' + Math.floor(Math.random() * 10000);
      const sign = _baiduSign(q, appid, key, salt);
      const body = 'q=' + encodeURIComponent(q) + '&from=auto&to=zh&appid=' + encodeURIComponent(appid) + '&salt=' + salt + '&sign=' + sign;
      const r = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error('baidu ' + r.status);
      const j = await r.json();
      if (j && Array.isArray(j.trans_result) && j.trans_result.length) {
        parts.push(j.trans_result.map(x => x.dst).join('\n'));
      } else if (j && j.error_code) {
        throw new Error('baidu err ' + j.error_code);
      } else {
        parts.push(ch); // 单块失败回退原文
      }
    }
    const tr = parts.join('\n');
    _cacheSet(t, tr);
    results.push(tr);
  }
  return results;
}
app.post('/api/translate', async (req, res) => {
  let texts = req.body && req.body.texts;
  if (!texts && req.body && req.body.text) texts = [req.body.text];
  if (!Array.isArray(texts) || !texts.length) return res.json({ ok: false, error: 'no text' });
  // 截断单条长度 + 去重（保留原始顺序映射，去重进一步省配额；长文由通道内部分块翻译）
  const norm = texts.map(t => String(t || '').slice(0, 6000).trim()).filter(t => t);
  if (!norm.length) return res.json({ ok: false, error: 'empty' });
  const uniq = [...new Set(norm)];
  let engine = 'mymemory';
  let resUniq = null;

  const baiduId = process.env.BAIDU_TRANSLATE_APPID;
  const baiduKey = process.env.BAIDU_TRANSLATE_KEY;
  /* 0) 腾讯 TranSmart / 有道 —— 首选：国内直连、免密钥、无日配额（实测 ~300ms/条）。
   * 二者任一成功即返回，避免百度免费额度耗尽(54004)导致整体翻译停摆。 */
  try {
    const out = [];
    let okAll = true;
    for (const t of uniq) {
      const cached = _cacheGet(t);
      if (cached) { out.push(cached); continue; }
      const r = await _translateAny(t);
      if (r && r.trim() && r.trim() !== t.trim()) { out.push(r.trim()); _cacheSet(t, r.trim()); }
      else { out.push(''); okAll = false; }
      await new Promise(r2 => setTimeout(r2, 200));
    }
    if (out.some(x => x)) { resUniq = out; engine = 'transmart'; }
    if (!okAll) console.warn('[TRANSLATE] 部分条目首选通道未译，交由后续通道补翻');
  } catch (e) { console.warn('[TRANSLATE] 首选通道异常，降级:', e.message); resUniq = null; }

  // 1) 可选百度密钥（仅在首选通道整体失败时启用）
  if (!resUniq && baiduId && baiduKey) {
    try { resUniq = await _translateViaBaidu(uniq, baiduId, baiduKey); engine = 'baidu'; }
    catch (e) { console.warn('[TRANSLATE] Baidu通道失败，降级MyMemory:', e.message); resUniq = null; }
  }
  // 2) MyMemory（带缓存）
  let quotaExhausted = false;
  if (!resUniq) {
    const mm = await _translateViaMyMemory(uniq);
    resUniq = mm.out;
    engine = 'mymemory';
    quotaExhausted = mm.quota;
    // 3) LibreTranslate 公共实例兜底（对 MyMemory 未译/非中文条目逐条补翻）
    const needLibre = [];
    uniq.forEach((t, i) => {
      const r = resUniq[i] || '';
      if (!r.trim() || r.trim() === t.trim() || !/[\u4e00-\u9fff]/.test(r)) needLibre.push(i);
    });
    if (needLibre.length) {
      const libreRes = await _tryLibreTranslate(needLibre.map(i => uniq[i]));
      if (libreRes) {
        needLibre.forEach((origIdx, k) => {
          const lr = libreRes[k] || '';
          if (lr.trim() && lr.trim() !== uniq[origIdx].trim()) {
            resUniq[origIdx] = lr;
            _cacheSet(uniq[origIdx], lr);
            if (engine === 'mymemory') engine = 'libretranslate';
          }
        });
      }
    }
    // 4) Edge 兜底（免费、无密钥）：对前面所有通道仍未译/原样返回/非中文的条目逐条补翻
    const needEdge = [];
    uniq.forEach((t, i) => {
      const r = resUniq[i] || '';
      if (!r.trim() || r.trim() === t.trim() || !/[\u4e00-\u9fff]/.test(r)) needEdge.push(i);
    });
    if (needEdge.length) {
      const edgeRes = await _tryEdge(needEdge.map(i => uniq[i]));
      if (edgeRes) {
        needEdge.forEach((origIdx, k) => {
          const er = edgeRes[k] || '';
          if (er.trim() && er.trim() !== uniq[origIdx].trim()) {
            resUniq[origIdx] = er;
            _cacheSet(uniq[origIdx], er);
            if (engine === 'mymemory' || engine === 'libretranslate') engine = 'microsoft-edge';
          }
        });
      }
    }
  }
  _transCacheSave();
  // 映射回原始顺序
  const map = {};
  uniq.forEach((t, i) => { map[t] = resUniq[i] || ''; });
  const results = norm.map(t => map[t] || '');
  const okCount = results.filter(x => x).length;
  const baiduConfigured = !!(baiduId && baiduKey);
  if (okCount) return res.json({ ok: true, results, engine, cacheEnabled: true, quotaExhausted: quotaExhausted && okCount < results.length, baiduConfigured });
  return res.json({ ok: false, error: 'all channels failed / quota exhausted', results: results.map(() => ''), quotaExhausted: quotaExhausted, baiduConfigured });
});
/* ===== 存量外文情报回填翻译（服务端持久化）=====
 * 问题背景：公开缓存里存量英文情报一直没被翻成中文——前端自动翻译调度器依赖 /api/translate，
 * 但本受限网络下 MyMemory(429限频)/LibreTranslate(实例全挂)/Edge(中国不可达) 全部失败，仅 Baidu 可达。
 * 该端点：当 Baidu 免费密钥已配置时，把缓存里所有"缺 title_zh 且标题含外文"的条目用 Baidu 翻译，
 * 并回写 title_zh/content_zh 到 .cache/*.json，使公开 API 直接返回中文。
 * 触发方式：POST /api/intel/translate-backfill （无需登录；Baidu 未配置时返回明确提示，不报错）。 */
function _looksForeign(s) {
  if (!s) return false;
  /* 标题/正文判定为"需要翻译"。
   * 2026-08-05 修复：旧实现是"含任意一个中文字符就判定为无需翻译"，
   * 于是采集端加的中文标签前缀（如「[HDX 数据集] Afghanistan - Socio-economic
   * assessment of ...」「参考消息：Hezbollah rejects ...」）只要出现，
   * 整条外文标题就永久逃过翻译。改为：先剥离标签前缀，再按中英字符占比判定。 */
  const body = String(s)
    .replace(/^\s*[\[【][^\]】]{0,24}[\]】]\s*/, '')      // [HDX 数据集] / 【GEOINT】
    .replace(/^[^:：]{0,12}[:：]\s*/, '');                 // 参考消息： / RT：
  /* 外文脚本判定（2026-08-05 补：旧版只认拉丁字母，
   * 西里尔/希腊/阿拉伯/谚文/假名等非拉丁外文标题（如俄语报道）永久逃过翻译）。
   * 2026-08-28 再补：孟加拉文/缅甸文/高棉文/老挝文/僧伽罗文/泰米尔文/希伯来文/亚美尼亚文/
   * 格鲁吉亚文——类别均衡器实测孟加拉语标题（বাংলাদেশ）逃过翻译直接入库。
   * 任意连续 4+ 字符为外文脚本 → 判定为外文主体。 */
  const FOREIGN_RUN = /([a-zA-Z]|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Arabic}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}|\p{Script=Thai}|\p{Script=Bengali}|\p{Script=Myanmar}|\p{Script=Khmer}|\p{Script=Lao}|\p{Script=Sinhala}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Hebrew}|\p{Script=Armenian}|\p{Script=Georgian}){4,}/u;
  if (!FOREIGN_RUN.test(body)) return false;
  const zh = (body.match(/[一-龥]/g) || []).length;
  const foreign = (body.match(/[a-zA-Z]/g) || []).length
                + (body.match(/\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Arabic}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}|\p{Script=Thai}|\p{Script=Bengali}|\p{Script=Myanmar}|\p{Script=Khmer}|\p{Script=Lao}|\p{Script=Sinhala}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Hebrew}|\p{Script=Armenian}|\p{Script=Georgian}/gu) || []).length;
  /* 中文字符不足外文主体字符的 1/4 —— 主体仍是外文，需要翻译 */
  return zh === 0 || zh * 4 < foreign;
}
/* 稳定去重键：翻译后中文标题会因通道不同而措辞不一（"对等制裁"/"相互制裁"），
 * 若以译文为键会导致同一条情报重复入库、污染态势热度研判。
 * 故按稳定性优先取：原文链接 > 英文原标题 > 当前标题，并归一化去除标点空白。 */
function _dedupKey(it) {
  if (!it) return '';
  var raw = String(it.link || it.url || '').trim();
  if (raw) return 'u:' + raw.toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '');
  var t = String(it.title_en || it.title || '');
  return 't:' + t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '').slice(0, 60);
}
/* 网站导航/栏目页噪声识别：爬虫命中官网首页时会把"下载中心""个人客户""欢迎访问XX网站"
 * 等导航标题当成情报入库（实测混入建行官网 6 条）。这些不含事件语义，实战系统必须剔除。 */
var _NAV_NOISE_RE = /^(欢迎访问|welcome to)|[-—|｜]\s*(网上银行|个人客户|企业客户|下载中心|首页|登录|注册|客服中心|关于我们|联系我们|网站地图|信息披露|电子银行|手机银行|信用卡|个人网上银行|企业电子银行首页)\s*$|^(首页|登录|注册|下载中心|网站地图|关于我们|联系我们|更多|详情|返回顶部|home|login|sign in|download|sitemap|about us|contact us)$/i;
function _isNavNoise(it) {
  var t = String((it && (it.title_zh || it.title)) || '').trim();
  if (!t) return true;
  if (_NAV_NOISE_RE.test(t)) return true;
  /* 同一域名下标题形如「机构名-栏目名」且栏目名极短，视为导航页 */
  if (/^[^\s]{2,12}[-—]{1}[^\s]{2,8}$/.test(t) && !/[，。、；：？！]/.test(t) && t.length <= 16) {
    if (/银行|集团|公司|大学|政府|部|局|中心|网/.test(t)) return true;
  }
  return false;
}
/* 体裁噪声统一判定（评论/学术论述 + 商业榜单/经济统计）。
 * 背景：「2025中国企业500强」「《财富》世界500强营收总和41.7万亿美元」这类商业榜单
 * 必然罗列中国石油/国家电网等中资巨头 → 在 enrich 里命中企业主体 hardLink=true →
 * 绕过全部风险分门槛直入实时情报流。体裁噪声必须压过 hardLink，一票否决。
 * 优先调实体层权威判定 ENTITY.nonIntelGenre（与前端同源），失败则退回既有标记。 */
function _isGenreNoise(it) {
  if (!it || typeof it !== 'object') return true;
  if (it._commentary || it._ranking || it._genreNoise) return true;
  try {
    if (ENTITY && typeof ENTITY.nonIntelGenre === 'function') return !!ENTITY.nonIntelGenre(it);
    if (ENTITY && typeof ENTITY.isCommentaryPiece === 'function') return !!ENTITY.isCommentaryPiece(it);
  } catch (e) {}
  return false;
}
/* 百度翻译单条 + 54003 频率限制退避重试（免费版 QPS 严格，靠退避逐条推进，绝不批量拼接以免错位误译） */
/* 百度全局串行节流（2026-08-24 修复 54003）：免费版限 1 QPS，而采集/回填/前端多路并发调用
 * 会同时打百度 → 必然撞 54003。此处串行队列 + 每次调用间隔 ≥1150ms，全进程生效。 */
let _baiduChain = Promise.resolve(), _baiduLastCall = 0, _baiduDisabledUntil = 0, _baiduFuseSetAt = 0, _baiduProbeInFlight = false;
function _baiduThrottle() {
  const run = _baiduChain.then(async () => {
    if (Date.now() < _baiduDisabledUntil) {
      /* 熔断自愈探针（2026-08-25）：账户充值/切标准版后不等次日——熔断超过 30 分钟放一单试探，
       * 试探成功即解除熔断（见 _baiduTranslateRetry 成功分支） */
      if (!_baiduProbeInFlight && Date.now() - _baiduFuseSetAt > 30 * 60 * 1000) {
        _baiduProbeInFlight = true;
      } else {
        throw new Error('baidu err 54004(余额耗尽，当日熔断)');
      }
    }
    const wait = 1150 - (Date.now() - _baiduLastCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _baiduLastCall = Date.now();
  });
  _baiduChain = run.catch(() => {});
  return run;
}
async function _baiduTranslateRetry(text, id, key, attempt) {
  attempt = attempt || 0;
  try {
    await _baiduThrottle();
    const r = await _translateViaBaidu([String(text || '')], id, key);
    if (_baiduProbeInFlight) {   /* 试探单成功：账户已恢复，解除熔断 */
      _baiduProbeInFlight = false; _baiduDisabledUntil = 0;
      console.warn('[TRANSLATE] 百度熔断自愈：试探成功，通道恢复');
    }
    return (r && r[0]) ? r[0] : '';
  } catch (e) {
    _baiduProbeInFlight = false;
    /* 54004 = 账户余额/月配额耗尽：退避重试无意义，熔断至次日 0 点（2026-08-24 实测） */
    if (/54004/.test(e.message)) {
      const tmr = new Date(); tmr.setHours(24, 0, 5, 0);
      if (_baiduDisabledUntil < tmr.getTime()) {
        _baiduDisabledUntil = tmr.getTime();
        _baiduFuseSetAt = Date.now();
        console.warn('[TRANSLATE] 百度余额耗尽(54004)，熔断至次日0点，走免密钥通道');
      }
      throw e;
    }
    if (/54003/.test(e.message) && attempt < 5) {
      const wait = 1500 * Math.pow(2, attempt); // 1.5s,3s,6s,12s,24s
      console.warn('[BACKFILL] 54003 限速，退避 ' + wait + 'ms 后重试 (attempt ' + (attempt + 1) + ')');
      await new Promise(r => setTimeout(r, wait));
      return _baiduTranslateRetry(text, id, key, attempt + 1);
    }
    throw e;
  }
}
/* 腾讯 TranSmart 交互翻译：国内直连、免密钥、无日配额，术语质量优于通用机翻。
 * 实测 ~300ms/条，作为实战系统首选翻译通道。 */
const _TRANS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
async function _tryTranSmart(text, from, to) {
  const src = String(text || '').slice(0, 2000);
  if (!src.trim()) return '';
  from = from || 'auto'; to = to || 'zh';
  const res = await fetch('https://transmart.qq.com/api/imt', {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': _TRANS_UA,
      'Referer': 'https://transmart.qq.com/zh-CN/index'
    },
    body: JSON.stringify({
      header: { fn: 'auto_translation', client_key: 'browser-chrome-120.0.0-Windows 10-' + Date.now() },
      type: 'plain',
      model_category: 'normal',
      source: { lang: from, text_list: ['', src, ''] },
      target: { lang: to }
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('TranSmart HTTP ' + res.status);
  const j = await res.json();
  return (j.auto_translation || []).filter(Boolean).join('').trim();
}
/* 有道公开演示接口：国内直连、免密钥，作为 TranSmart 的同级备份通道。 */
async function _tryYoudao(text) {
  const src = String(text || '').slice(0, 2000);
  if (!src.trim()) return '';
  const res = await fetch('https://aidemo.youdao.com/trans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': _TRANS_UA },
    body: 'q=' + encodeURIComponent(src) + '&from=Auto&to=Auto',
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('Youdao HTTP ' + res.status);
  const j = await res.json();
  return (j.translation || []).join('').trim();
}
/* 统一翻译通道（多通道兜底，按国内可用性与质量排序）：
 * TranSmart(免密钥/无配额) → 有道(免密钥) → Baidu(配置时) → MyMemory → LibreTranslate → Edge。
 * 任一通道不可用/限频/余额耗尽即自动切换下一通道，保证实战系统翻译不中断。 */
/* 翻译质量校验（2026-08-17 用户指令：译文必须是合格中文，不是原文复读/乱码）：
 * ① 非空且≠原文 ② 含足量中文（CJK 占比≥15%）③ 长度比合理（0.2x~4x）④ 无大面积未译外文 */
function _translationOk(src, dst) {
  const a = String(src || '').trim(), b = String(dst || '').trim();
  if (!a || !b) return false;
  if (b === a) return false;
  const cjk = (b.match(/[一-龥]/g) || []).length;
  if (cjk < 2) return false;
  if (cjk / b.length < 0.15) return false;
  const ratio = b.length / Math.max(1, a.length);
  if (ratio < 0.2 || ratio > 4) return false;
  /* 2026-08-27 铁律：拒绝半中半英翻译。若译文中仍含大量英文短语（如 US designates、UK-based、
     Action as foreign terrorist group 这类明显未翻译的完整英文片段），判定为不合格，
     宁可保留原文打 _untranslated 标记，也不入库混排标题。 */
  const enWords = b.match(/[A-Za-z]{3,}/g) || [];
  const longEnPhrases = enWords.filter(function(w) { return w.length >= 4; }).length;
  if (longEnPhrases >= 3 && cjk / b.length < 0.5) return false;
  /* 常见未翻译英文短语黑名单 */
  const untranslatedPhrases = /US designates|UK-based|Action as foreign|terrorist group|as foreign|designates.*as|said in a statement|according to.*said/i;
  if (untranslatedPhrases.test(b) && cjk / b.length < 0.6) return false;
  return true;
}

/* ===== 2026-08-29 三部委审查 P1-4：轻度混排标题修复（专名级二次翻译）=====
 * 实测 7 天 591 条(21%) 混排：「Pezeshkian说，尽管战争和制裁」——引擎对人名/机构
 * 专名原样返回。_translationOk 只拦重度混排（≥3 英文词），轻度混排（1-2 个专名）放行。
 * 修复：译文出口对英文片段单独二次翻译（片段级词典命中率高：Pezeshkian→佩泽什基安），
 * 译不出则保留原样（专名保英文好于整句不译）。片段内存缓存，重复专名零外部调用。 */
const _mixedFragCache = new Map(); /* 片段→译文，上限 5000 */
function _isMixedZh(s) {
  return /[\u4e00-\u9fa5]/.test(s) && /[A-Za-z]{3,}/.test(s);
}
async function _fixMixedZh(zh) {
  if (!zh || !_isMixedZh(zh)) return zh;
  try {
    const frags = zh.match(/[A-Za-z][A-Za-z@.'-]*(?:\s+[A-Za-z][A-Za-z@.'-]*)?/g) || [];
    let out = zh, fixed = 0;
    for (const f of frags) {
      const key = f.trim();
      if (key.length < 3) continue; /* 缩写/短词不动（CPEC/UN 等专名缩写保留英文更专业） */
      if (/^[A-Z0-9@.'-]{2,}$/.test(key.replace(/\s/g, ''))) continue; /* 全大写缩写不翻（COP17/ICE→"警察17/冰"误译） */
      let t = _mixedFragCache.get(key);
      if (t === undefined) {
        t = '';
        try {
          const r = await _tryTranSmart(key);
          if (r && /[\u4e00-\u9fa5]/.test(r) && !_isMixedZh(r)) t = r.trim();
        } catch (e) {}
        if (_mixedFragCache.size > 5000) _mixedFragCache.clear();
        _mixedFragCache.set(key, t);
      }
      if (t) { out = out.split(f).join(t); fixed++; }
    }
    if (fixed) console.log('[TRANSLATE] 混排修复 ' + fixed + ' 片段: ' + String(zh).slice(0, 40) + ' → ' + String(out).slice(0, 40));
    return out;
  } catch (e) { return zh; }
}
async function _translateAny(text) {
  const zh = await _translateAnyRaw(text);
  /* 2026-08-30 排雷：_fixMixedZh 是 async 函数，漏 await 会把 Promise 传给 polish →
   * String(Promise) = "[object Promise]" 被当译文入库+污染缓存（624 条）。必须 await。 */
  return zhPolish.polish(await _fixMixedZh(zh));
}
async function _translateAnyRaw(text) {
  const baiduId = process.env.BAIDU_TRANSLATE_APPID;
  const baiduKey = process.env.BAIDU_TRANSLATE_KEY;
  const src = String(text || '');
  if (!src.trim()) return '';
  /* 1) 腾讯 TranSmart（auto 源语言，2026-08-17 修：原来写死 en→小语种必出乱码；
   *    2026-08-24 修：瞬时 429/网络抖动不再一次打死，800ms 退避重试一次） */
  for (let att = 0; att < 2; att++) {
    try {
      const r = await _tryTranSmart(src);
      if (_translationOk(src, r)) return r;
      break; /* 返回了但质量不合格 → 换通道，不重试 */
    } catch (e) {
      if (att === 0) { await new Promise(rs => setTimeout(rs, 800)); continue; }
      console.warn('[TRANSLATE] TranSmart 失败，试有道:', e.message);
    }
  }
  /* 2) 有道（from=Auto 本就支持自动识别；2026-08-24 修：411 频率限制 1.5s 退避重试一次） */
  for (let att = 0; att < 2; att++) {
    try {
      const r = await _tryYoudao(src);
      if (_translationOk(src, r)) return r;
      break;
    } catch (e) {
      if (att === 0) { await new Promise(rs => setTimeout(rs, 1500)); continue; }
      console.warn('[TRANSLATE] 有道失败，试 Baidu:', e.message);
    }
  }
  /* 3) Baidu */
  if (baiduId && baiduKey) {
    try {
      const r = await _baiduTranslateRetry(src, baiduId, baiduKey);
      if (_translationOk(src, r)) return r.trim();
    } catch (e) { console.warn('[TRANSLATE] Baidu 失败，试 MyMemory:', e.message); }
  }
  /* 4) MyMemory */
  try {
    const tr = await _myMemoryOne(src.slice(0, 500), MYMEMORY_KEY);
    if (_translationOk(src, tr)) return tr.trim();
  } catch (e) {}
  /* 5) LibreTranslate */
  try {
    const lr = await _tryLibreTranslate([src.slice(0, 500)]);
    if (lr && lr[0] && _translationOk(src, lr[0])) return lr[0].trim();
  } catch (e) {}
  /* 6) 小语种 pivot（2026-08-17 用户指令：小语种先译英文再译中文）：
   * 直译全部不合格时，先 auto→en（TranSmart 英译覆盖好），en 再→zh 走主链 */
  try {
    const en = await _tryTranSmart(src, 'auto', 'en');
    if (en && en.trim() && en.trim() !== src.trim() && /[a-zA-Z]{4}/.test(en)) {
      const zh = await _tryTranSmart(en, 'en', 'zh').catch(() => '');
      if (_translationOk(en, zh)) { console.log('[TRANSLATE] pivot(en) 成功:', src.slice(0, 24)); return zh.trim(); }
      const zh2 = await _tryYoudao(en).catch(() => '');
      if (_translationOk(en, zh2)) { console.log('[TRANSLATE] pivot(en) 成功(有道):', src.slice(0, 24)); return zh2.trim(); }
    }
  } catch (e) {}
  /* 7) Edge 微软翻译 */
  try {
    const er = await _tryEdge([src.slice(0, 500)]);
    if (er && er[0] && _translationOk(src, er[0])) return er[0].trim();
  } catch (e) {}
  /* 8) Google 翻译网页接口兜底（2026-08-28 翻译三问题整治实测：
   * TranSmart 返回空/Baidu 54004 当日熔断/MyMemory 当日免费额度耗尽/Edge auth 404
   * 全链失败时 NYSC 类条目未翻译入库的根因。translate.googleapis.com 免费无 Key，
   * netx 代理可达，实测质量好："据报道，15名NYSC成员在从营地返回时在科吉被绑架"） */
  try {
    const gr = await _tryGoogleWebTranslate(src.slice(0, 450));
    if (gr && _translationOk(src, gr)) return gr.trim();
  } catch (e) {}
  return ''; /* 全部不合格 → 返回空，调用方保留原文并打 _untranslated 标记，绝不入库乱码 */
}
/* Google 翻译网页接口（translate_a/single，免费无 Key，走 netx 代理回退） */
async function _tryGoogleWebTranslate(text) {
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' };
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(String(text || ''));
  const resp = await netx.smartFetch(u, { timeout: 8000, headers: UA });
  if (!resp || !resp.ok) return '';
  const j = await resp.json();
  const t = (j && j[0] && Array.isArray(j[0]) && j[0].map(x => (x && x[0]) || '').join('')) || '';
  return t;
}

/* ===== 未翻译重试队列（2026-08-28 用户指令：翻译三问题整治）=====
 * 翻译链高峰期全断（Baidu 54004 熔断/MyMemory 额度耗尽）时，条目带 _untranslated 入库。
 * 本队列每 15 分钟扫描近 3 天未翻译条目重译——额度恢复/新兜底通道（Google web）可用即补齐。
 * 同时治理"半翻译"：title_zh 混外文实义词的条目用 title_en 原文重译。 */
let _retryTranslateBusyUntil = 0;
async function _runTranslateRetry() {
  if (Date.now() < _retryTranslateBusyUntil) return;
  _retryTranslateBusyUntil = Date.now() + 10 * 60 * 1000;
  try {
    /* ① 完全未翻译：标题无中文且无 title_zh */
    const untr = await query(
      `SELECT id, title, data_json FROM intel_data WHERE collect_time >= NOW() - INTERVAL '3 days'
       AND (data_json->>'title_zh' IS NULL OR data_json->>'title_zh' = '')
       AND title !~ '[一-龥]' ORDER BY collect_time DESC LIMIT 30`);
    let fixed = 0;
    for (const r of untr.rows) {
      const dj = r.data_json || {};
      const zh = await _translateAnyCached(String(r.title || '').slice(0, 450));
      if (zh && _translationOk(String(r.title || ''), zh)) {
        dj.title_en = dj.title_en || r.title;
        dj.title = zh.trim(); dj.title_zh = zh.trim();
        dj.translated = true; delete dj._untranslated;
        await query('UPDATE intel_data SET title=$1, data_json=$2 WHERE id=$3', [zh.trim(), JSON.stringify(dj), r.id]);
        fixed++;
      }
    }
    /* ② 半翻译：title_zh 有中文但含数字+外文实义词模式（机翻半成品） */
    const half = await query(
      `SELECT id, title, data_json FROM intel_data WHERE collect_time >= NOW() - INTERVAL '3 days'
       AND data_json->>'title_zh' ~ '[一-龥]' AND data_json->>'title_zh' ~ '\\d+\\s+[A-Za-z]{4,}'
       AND data_json->>'title_en' IS NOT NULL AND data_json->>'title_en' <> ''
       ORDER BY collect_time DESC LIMIT 20`);
    let refixed = 0;
    for (const r of half.rows) {
      const dj = r.data_json || {};
      const raw = String(dj.title_en || '');
      const zh = await _translateAnyCached(raw.slice(0, 450));
      if (zh && _translationOk(raw, zh) && !/\\d+\\s+[A-Za-z]{4,}/.test(zh)) {
        dj.title = zh.trim(); dj.title_zh = zh.trim();
        await query('UPDATE intel_data SET title=$1, data_json=$2 WHERE id=$3', [zh.trim(), JSON.stringify(dj), r.id]);
        refixed++;
      }
    }
    if (fixed || refixed) console.log('[TRANSLATE-RETRY] 补译完成：未翻译 ' + fixed + ' 条 + 半翻译修复 ' + refixed + ' 条');
  } catch (e) { console.warn('[TRANSLATE-RETRY] 失败:', e.message); }
  finally { _retryTranslateBusyUntil = 0; }
}
/* 采集即译：把一批情报的标题+正文翻译成中文，落库即中文（原文留 title_en/content_en 溯源）。
 * 实战系统要求：入库数据全中文。仅对含外文(连续≥4字母且无中文)的字段翻译；已中文的跳过。
 * 翻译失败则保留原文并标记，绝不丢数据；54003 频率限制由 _baiduTranslateRetry 退避重试。 */
async function _translateListToZh(list) {
  /* 首选通道 TranSmart/有道 均免密钥，无需任何配置即可翻译；百度仅作为第三备份 */
  let done = 0, failed = 0;
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    try {
      const titleForeign = _looksForeign(it.title);
      const contentForeign = _looksForeign(it.content) && String(it.content || '').length > 20;
      let tZh = it.title, cZh = it.content;
      if (titleForeign) {
        const tr = await _translateAny(it.title);
        if (tr && tr.trim() && tr.trim() !== String(it.title || '').trim()) tZh = tr.trim();
      }
      if (contentForeign) {
        const tr = await _translateAny(it.content);
        if (tr && tr.trim() && tr.trim() !== String(it.content || '').trim().slice(0, 6000)) cZh = tr.trim();
      }
      if (titleForeign && tZh && tZh !== String(it.title || '').trim()) {
        it.title_en = it.title; it.title = tZh; it.title_zh = tZh; it.translated = true;
        done++;
      } else if (titleForeign) { failed++; }
      if (contentForeign && cZh && cZh !== String(it.content || '').trim()) {
        it.content_en = it.content; it.content = cZh; it.content_zh = cZh; it.translated = true;
      }
    } catch (e) {
      failed++;
      console.warn('[TRANSLATE] 采集翻译单条失败:', (it.title || '').slice(0, 30), e.message);
    }
    await new Promise(r => setTimeout(r, 250)); // TranSmart 无日配额，250ms 轻节流即可
  }
  if (done || failed) console.log('[TRANSLATE] 采集即译完成：成功 ' + done + ' 条，失败 ' + failed + ' 条');
  /* 收尾：国名/媒体专名本地化 + 要素抽取（外文主体不再拼接半成品，详见 _localizeTitleTail） */
  list.forEach(function (it) { _localizeTitleTail(it); });
}

/* ===== 并行采集即译（2026-08-05 新增，修复"全量采集数据是外文原文"） =====
 * 背景：/api/scrape?all=1 一次抓取约 270 条、85% 是外文需翻译；串行 _translateListToZh
 *       每条 250ms 节流 → 全量约 2 分钟，会拖垮/超时采集接口。此处并行化 + 持久缓存。
 * 与串行版区别：① _translateAnyCached 先查持久缓存（重复文本零外部调用，且保证同文本译文一致→利于前端去重）
 *              ② 并发池并行翻译（默认 6，TranSmart/有道免密钥无日配额，可承受）
 *              ③ 只译外文（_looksForeign 判定，已中文跳过）。
 * 落库即中文：原文留 title_en/content_en 溯源；单条失败保留原文，绝不丢数据。 */
/* ── USGS 地震标题模板化（2026-08-05）──
 * USGS 的标题是结构化格式「M 4.6 - 112 km WSW of Puerto Madero, Mexico」，
 * 通用机翻处理不了：实测要么原样返回，要么只把 Russia 译成"俄罗斯"、
 * 方位缩写和距离照旧（"M 4.9 - 204 km SE of Severo-Kuril'sk，俄罗斯"），
 * 这类半吊子译文正是用户看到的"翻译没起作用"。
 * 结构化数据用模板转换：零延迟、零配额、结果稳定，地名保留原文利于溯源。 */
const _QUAKE_DIR = {
  N: '以北', S: '以南', E: '以东', W: '以西',
  NE: '东北方', NW: '西北方', SE: '东南方', SW: '西南方',
  NNE: '北偏东', ENE: '东偏北', ESE: '东偏南', SSE: '南偏东',
  SSW: '南偏西', WSW: '西偏南', WNW: '西偏北', NNW: '北偏西'
};
function _formatQuakeTitle(s) {
  const m = /^\s*M\s*([\d.]+)\s*[-–—]\s*(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+?)\s*[,，]\s*(.+?)\s*$/i.exec(String(s || ''));
  if (!m) return '';
  const dir = _QUAKE_DIR[m[3].toUpperCase()];
  if (!dir) return '';
  let country = m[5].trim();
  try { const c = ENTITY.normalizeCountry(country); if (c) country = c; } catch (e) {}
  return country + ' ' + m[4].trim() + dir + ' ' + m[2] + ' 公里发生 M' + m[1] + ' 地震';
}
async function _translateAnyCached(text) {
  const src = String(text || '').trim();
  if (!src) return '';
  /* 结构化标题优先走模板，避免机翻返回半中半英 */
  const quake = _formatQuakeTitle(src);
  if (quake) return quake;
  const cached = _cacheGet(src);
  if (cached) return cached;
  const r = await _translateAny(src);
  if (r && r.trim() && r.trim() !== src) _cacheSet(src, r.trim());
  return r;
}
/* ── 英文国家名本地化（2026-08-05）──
 * 结构化标题如「[UNHCR 2024] Afghanistan 收容 流离失所人口 3,220,946」中文占比够高，
 * 不会被 _looksForeign 判为外文，于是国家名永远停留在英文。
 * 用 ENTITY.COUNTRY_ALIAS（123 条英文映射）本地替换：零延迟、零配额、不依赖外部通道。
 * 按长度倒序匹配，避免 "South Sudan" 被 "Sudan" 抢先替换。 */
let _CTY_EN_PAIRS = null;
function _countryPairs() {
  if (_CTY_EN_PAIRS) return _CTY_EN_PAIRS;
  const out = [];
  try {
    const A = ENTITY.COUNTRY_ALIAS || {};
    Object.keys(A).forEach(k => {
      if (/^[A-Za-z][A-Za-z .'\-]*$/.test(k) && k.length >= 4 && A[k]) out.push([k, A[k]]);
    });
    out.sort((a, b) => b[0].length - a[0].length);
  } catch (e) {}
  _CTY_EN_PAIRS = out;
  return out;
}
function _localizeCountryNames(s) {
  let t = String(s || '');
  if (!t || !/[A-Za-z]{4,}/.test(t)) return t;
  _countryPairs().forEach(([en, zh]) => {
    /* 整词匹配，避免 China 命中 Chinatown、Chad 命中 Chadwick */
    const re = new RegExp('(?<![A-Za-z])' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'g');
    t = t.replace(re, zh);
  });
  return t;
}
/* ===== 正文补抓 + 要素抽取（2026-08-18 修复"要素不全/看不懂"） =====
 * 背景：apSearch/GDELT 仅返回标题（无正文），导致入库情报正文长期为空、用户"看不懂"；
 *       且 enrich 不抽 location/event_date，预警卡片要素大量留空。此处在统一翻译环节后补救：
 *   ① 对 content 为空且有 url 的条目，跟进抓取真实正文并翻译（落库即中文）；
 *   ② 从标题+正文抽取 location / event_date 写入 it.location / it.date（即 DB 入库口径）；
 *   ③ 媒体专名本地化（在国名本地化之上补充常见国际媒体名）。
 * 仅做"尽力补全"：已有值不覆盖、抽不到留空，绝不臆造。 */

/* 跟进抓取单条正文（带 SSRF 防护，复用 crawler 既有能力） */
async function _fetchBodyForItem(it) {
  const url = it.url || it.link;
  if (!url || typeof url !== 'string') return false;
  if (it.content && String(it.content).trim().length >= 80) return false;
  if (!crawler || typeof crawler.fetchPublic !== 'function') return false;
  try {
    const html = await crawler.fetchPublic(String(url), 12000);
    if (!html) return false;
    let body = crawler.extractArticle(html);
    if (!body || body.length < 60) return false;
    if (_looksForeign(body)) {
      const zh = await _translateAnyCached(body.slice(0, 6000));
      if (zh && zh.trim() && zh.trim() !== body.trim()) { it.content_en = body; it.content = zh.trim(); it.content_zh = zh.trim(); }
      else { it.content = body; }
    } else { it.content = body; }
    it.translated = it.translated || !!it.content_zh;
    return true;
  } catch (e) { return false; }
}

/* 日期归一化 YYYY-MM-DD */
const _MONTHS_EN = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function _fmtDate(y, mo, d) {
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, mo - 1, d);
  if (isNaN(dt.getTime())) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function _extractDateFromText(s) {
  if (!s) return '';
  let m;
  if ((m = s.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/))) return _fmtDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return _fmtDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/))) return _fmtDate(new Date().getFullYear(), +m[1], +m[2]);
  if ((m = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})/i))) { const mo = _MONTHS_EN[m[1].toLowerCase()]; if (mo) return _fmtDate(+m[3], mo, +m[2]); }
  if ((m = s.match(/(20\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})/i))) { const mo = _MONTHS_EN[m[2].toLowerCase()]; if (mo) return _fmtDate(+m[1], mo, +m[3]); }
  return '';
}

/* 中文国名集合（用于从标题反推地点），按长度倒序匹配避免"中国"误吞"中非" */
let _CN_COUNTRY_SET = null;
function _cnCountrySet() {
  if (_CN_COUNTRY_SET) return _CN_COUNTRY_SET;
  const s = new Set();
  try { Object.values(ENTITY.COUNTRY_ALIAS || {}).forEach(function (c) { if (/^[一-龥]/.test(String(c))) s.add(c); }); } catch (e) {}
  _CN_COUNTRY_SET = s; return s;
}
function _extractLocationFromText(text) {
  const t = String(text || '');
  if (!t) return '';
  let hit = '';
  const names = Array.from(_cnCountrySet()).sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < names.length; i++) { if (t.indexOf(names[i]) >= 0) { hit = names[i]; break; } }
  return hit;
}

/* ===== 重点城市词典（2026-08-18 新增）：让 location 落到具体城市而非停留在国家 =====
 * 键为英文城市名，值为中文。覆盖中东/南亚/中亚/非洲/拉美/东南亚/欧洲/CIS 等重点区域。 */
const _CITY_ALIAS = {
  'Kabul':'喀布尔','Tehran':'德黑兰','Isfahan':'伊斯法罕','Baghdad':'巴格达','Basra':'巴士拉','Mosul':'摩苏尔',
  'Damascus':'大马士革','Aleppo':'阿勒颇','Beirut':'贝鲁特','Amman':'安曼','Jerusalem':'耶路撒冷','Tel Aviv':'特拉维夫',
  'Riyadh':'利雅得','Jeddah':'吉达','Doha':'多哈','Abu Dhabi':'阿布扎比','Dubai':'迪拜','Kuwait City':'科威特城',
  'Muscat':'马斯喀特','Sanaa':'萨那','Aden':'亚丁','Manama':'麦纳麦','Ankara':'安卡拉','Istanbul':'伊斯坦布尔',
  'Cairo':'开罗','Alexandria':'亚历山大','Tripoli':'的黎波里','Benghazi':'班加西','Tunis':'突尼斯','Algiers':'阿尔及尔',
  'Rabat':'拉巴特','Casablanca':'卡萨布兰卡','Khartoum':'喀土穆','Addis Ababa':'亚的斯亚贝巴','Nairobi':'内罗毕',
  'Mombasa':'蒙巴萨','Lagos':'拉各斯','Abuja':'阿布贾','Accra':'阿克拉','Dakar':'达喀尔','Bamako':'巴马科',
  'Johannesburg':'约翰内斯堡','Cape Town':'开普敦','Pretoria':'比勒陀利亚','Kinshasa':'金沙萨','Luanda':'罗安达',
  'Dar es Salaam':'达累斯萨拉姆','Dodoma':'多多马','Kampala':'坎帕拉','Kigali':'基加利','Lusaka':'卢萨卡','Harare':'哈拉雷',
  'Maputo':'马普托','New Delhi':'新德里','Mumbai':'孟买','Kolkata':'加尔各答','Chennai':'金奈','Bangalore':'班加罗尔',
  'Karachi':'卡拉奇','Lahore':'拉合尔','Islamabad':'伊斯兰堡','Peshawar':'白沙瓦','Quetta':'奎达',
  'Dhaka':'达卡','Chittagong':'吉大港','Colombo':'科伦坡','Kathmandu':'加德满都','Thimphu':'廷布','Male':'马累',
  'Moscow':'莫斯科','St Petersburg':'圣彼得堡','Kyiv':'基辅','Kharkiv':'哈尔科夫','Odessa':'敖德萨','Minsk':'明斯克',
  'Tbilisi':'第比利斯','Yerevan':'埃里温','Baku':'巴库','Almaty':'阿拉木图','Nur-Sultan':'努尔苏丹','Astana':'阿斯塔纳',
  'Tashkent':'塔什干','Samarkand':'撒马尔罕','Bishkek':'比什凯克','Dushanbe':'杜尚别','Ashgabat':'阿什哈巴德',
  'Ulaanbaatar':'乌兰巴托','Bangkok':'曼谷','Chiang Mai':'清迈','Jakarta':'雅加达','Surabaya':'泗水',
  'Manila':'马尼拉','Hanoi':'河内','Ho Chi Minh':'胡志明市','Da Nang':'岘港','Kuala Lumpur':'吉隆坡',
  'Singapore':'新加坡','Yangon':'仰光','Naypyidaw':'内比都','Phnom Penh':'金边','Vientiane':'万象','Bandar Seri Begawan':'斯里巴加湾市',
  'Brasilia':'巴西利亚','Sao Paulo':'圣保罗','Rio de Janeiro':'里约热内卢','Buenos Aires':'布宜诺斯艾利斯',
  'Santiago':'圣地亚哥','Lima':'利马','Bogota':'波哥大','Medellin':'麦德林','Caracas':'加拉加斯','Quito':'基多',
  'La Paz':'拉巴斯','Asuncion':'亚松森','Montevideo':'蒙得维的亚','Mexico City':'墨西哥城','Havana':'哈瓦那',
  'Panama City':'巴拿马城','London':'伦敦','Paris':'巴黎','Berlin':'柏林','Munich':'慕尼黑','Rome':'罗马','Milan':'米兰',
  'Madrid':'马德里','Barcelona':'巴塞罗那','Brussels':'布鲁塞尔','Amsterdam':'阿姆斯特丹','Vienna':'维也纳',
  'Warsaw':'华沙','Budapest':'布达佩斯','Prague':'布拉格','Athens':'雅典','Lisbon':'里斯本','Stockholm':'斯德哥尔摩',
  'Oslo':'奥斯陆','Copenhagen':'哥本哈根','Helsinki':'赫尔辛基','Zurich':'苏黎世','Geneva':'日内瓦',
  'Washington':'华盛顿','New York':'纽约','Los Angeles':'洛杉矶','Chicago':'芝加哥','Ottawa':'渥太华','Toronto':'多伦多',
  'Canberra':'堪培拉','Sydney':'悉尼','Tokyo':'东京','Osaka':'大阪','Seoul':'首尔','Busan':'釜山',
  /* 战略水道/热点海域（非城市，但常是事件真实地点，归入 location 更准） */
  'Strait of Hormuz':'霍尔木兹海峡','Hormuz':'霍尔木兹海峡','Suez Canal':'苏伊士运河','Suez':'苏伊士运河',
  'Bab el-Mandeb':'曼德海峡','Strait of Malacca':'马六甲海峡','Malacca':'马六甲海峡','Panama Canal':'巴拿马运河',
  'Gibraltar':'直布罗陀海峡','Bosphorus':'博斯普鲁斯海峡','Red Sea':'红海','Persian Gulf':'波斯湾',
  'Gulf of Aden':'亚丁湾','South China Sea':'南海','East China Sea':'东海','Black Sea':'黑海','Mediterranean':'地中海'
};
let _CITY_PAIRS = null;
function _cityPairs() {
  if (_CITY_PAIRS) return _CITY_PAIRS;
  const out = Object.keys(_CITY_ALIAS).map(function (k) { return [k, _CITY_ALIAS[k]]; });
  out.sort(function (a, b) { return b[0].length - a[0].length; });
  _CITY_PAIRS = out; return out;
}
let _CN_CITY_SET = null;
function _cnCitySet() {
  if (_CN_CITY_SET) return _CN_CITY_SET;
  const s = new Set();
  Object.keys(_CITY_ALIAS).forEach(function (k) { s.add(_CITY_ALIAS[k]); });
  _CN_CITY_SET = s; return s;
}
/* 从文本抽具体城市：先中文城市名，再英文城市名（返回中文）。找不到返回 '' */
function _extractCityFromText(text) {
  const t = String(text || '');
  if (!t) return '';
  const cnNames = Array.from(_cnCitySet()).sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < cnNames.length; i++) { if (t.indexOf(cnNames[i]) >= 0) return cnNames[i]; }
  const en = _cityPairs();
  for (let i = 0; i < en.length; i++) {
    const re = new RegExp('(?<![A-Za-z])' + en[i][0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])');
    if (re.test(t)) return en[i][1];
  }
  return '';
}
/* 标题里残留的英文城市名换中文（须在国家/媒体本地化之后调用，避免长词被切碎） */
function _localizeCities(s) {
  let t = String(s || '');
  if (!t || !/[A-Za-z]{4,}/.test(t)) return t;
  _cityPairs().forEach(function (p) {
    const re = new RegExp('(?<![A-Za-z])' + p[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'g');
    t = t.replace(re, p[1]);
  });
  return t;
}

/* 要素抽取：补全 location / event_date（DB 入库字段为 it.location||it.city 与 it.date||it.publishedAt） */
function _extractElements(it) {
  if (!it || typeof it !== 'object') return it;
  if (!it.date) {
    let d = '';
    if (it.publishedAt && /^\d{4}/.test(String(it.publishedAt))) {
      const pd = new Date(String(it.publishedAt));
      if (!isNaN(pd.getTime())) d = _fmtDate(pd.getFullYear(), pd.getMonth() + 1, pd.getDate());
    }
    if (!d) d = _extractDateFromText(String(it.title || '') + ' ' + String(it.content || it.content_zh || ''));
    if (d) it.date = d;
  }
  if (!it.location && !it.city) {
    const titleTxt = String(it.title || '');
    const bodyTxt = String(it.content || it.content_zh || '');
    const text = titleTxt + ' ' + bodyTxt;
    /* 1) 具体城市优先（标题先匹配，命中不了再看正文，降低"顺带提及"误判） */
    let cityHit = _extractCityFromText(titleTxt);
    if (!cityHit) cityHit = _extractCityFromText(bodyTxt);
    let loc = cityHit;
    if (cityHit && !it.city) it.city = cityHit;
    /* 2) 中文地名后缀补强（省/市/州/地区/镇/港/岛），仅取首个 */
    if (!loc) {
      const lm = String(it.title || '').match(/([一-龥]{2,6}?)(省|市|州|地区|特区|首都|边境|镇|岛|港|湾)/);
      if (lm) { loc = lm[1] + lm[2]; if (!it.city && /市|镇|首都/.test(lm[2])) it.city = loc; }
    }
    /* 3) 文本里的国名 */
    if (!loc) loc = _extractLocationFromText(text);
    /* 4) 最后才退回国家字段（country 归一化） */
    if (!loc) {
      const cn = it.country_cn || (it.country && ENTITY && ENTITY.normalizeCountry ? ENTITY.normalizeCountry(it.country) : '');
      if (cn && /^[一-龥]/.test(cn)) loc = cn;
    }
    if (loc) it.location = loc;
  }
  return it;
}

/* 媒体专名本地化（在国名本地化之上补充，仅作用于标题，避免污染正文） */
let _ZHQ_LOG_N = 0; /* L4 低分样本日志计数（防刷屏，每进程最多 12 条） */
const _MEDIA_ALIAS = {
  'La Repubblica': '共和报', 'Le Monde': '世界报', 'Le Figaro': '费加罗报',
  'Der Spiegel': '明镜周刊', 'Die Zeit': '时代周报', 'The Guardian': '卫报',
  'The Washington Post': '华盛顿邮报', 'The New York Times': '纽约时报',
  'Al Jazeera': '半岛电视台', 'Al-Arabiya': '阿拉伯电视台', 'Al Mayadeen': '迈亚丁电视台',
  'Associated Press': '美联社', 'Reuters': '路透社', 'AFP': '法新社', 'Xinhua': '新华社'
};
let _MEDIA_PAIRS = null;
function _mediaPairs() {
  if (_MEDIA_PAIRS) return _MEDIA_PAIRS;
  const out = [];
  Object.keys(_MEDIA_ALIAS).forEach(function (k) { if (k.length >= 4) out.push([k, _MEDIA_ALIAS[k]]); });
  out.sort(function (a, b) { return b[0].length - a[0].length; });
  _MEDIA_PAIRS = out; return out;
}
function _localizeMedia(s) {
  let t = String(s || '');
  if (!t || !/[A-Za-z]{4,}/.test(t)) return t;
  _mediaPairs().forEach(function (p) {
    const re = new RegExp('(?<![A-Za-z])' + p[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'g');
    t = t.replace(re, p[1]);
  });
  return t;
}
/* 采集收尾：标题本地化 + 要素抽取（2026-08-24 修复"半中半英标题"，串行/并行两条即译链路共用）。
 * 背景：翻译通道失败的条目仍是外文主体，旧收尾无条件拼接国名/城市/媒体本地化，
 *      产出 "巴基斯坦 power crisis: 卡拉奇 residents riot..." 这类半吊子标题（用户投诉），
 *      且把半成品写进 title_zh，后续闸门误判"已有译文"永不重译。
 * 规则：外文主体 → 保留原文 + 打 _untranslated 标记（等回填重译），
 *      location/city/date 抽取改用本地化探针副本，不污染 title/title_zh；
 *      已是中文主体 → 维持原本地化行为（结构化 HDX 标题等场景需要）。 */
function _localizeTitleTail(it) {
  if (!it || typeof it !== 'object') return { loc: 0, media: 0, city: 0 };
  if (_looksForeign(it.title)) {
    /* 2026-08-27 根治半中半英：翻译失败的外文标题一律保持原样 + 打 _untranslated 标记，
     * 等回填重译。不再做部分国名/媒体/城市本地化——那正是
     * 「US designates UK-based 巴勒斯坦 Action as foreign」混排的制造源。 */
    it._untranslated = true;
    const probe = { title: it.title, content: it.content, content_zh: it.content_zh };
    _extractElements(probe);
    if (!it.location && probe.location) it.location = probe.location;
    if (!it.city && probe.city) it.city = probe.city;
    if (!it.date && probe.date) it.date = probe.date;
    return { loc: 0, media: 0, city: 0 };
  }
  const r = { loc: 0, media: 0, city: 0 };
  const t1 = _localizeCountryNames(it.title);
  if (t1 !== it.title) { if (!it.title_en) it.title_en = it.title; it.title = t1; it.title_zh = t1; r.loc = 1; }
  const t2 = _localizeMedia(it.title);
  if (t2 !== it.title) { if (!it.title_en) it.title_en = it.title; it.title = t2; it.title_zh = t2; r.media = 1; }
  const t3 = _localizeCities(it.title);
  if (t3 !== it.title) { if (!it.title_en) it.title_en = it.title; it.title = t3; it.title_zh = t3; r.city = 1; }
  /* L1 标题抛光（#483）：中文源标题不经 _translateAny，也需剥尾部媒体/URL/emoji+标点硬伤 */
  const t4 = zhPolish.polishTitle(it.title);
  if (t4 && t4 !== it.title && t4.length >= 6) {
    if (!it.title_en) it.title_en = it.title;
    it.title = t4; it.title_zh = t4;
  }
  /* L2 句式重写（#484）：机翻欧化语序/插入语/框架句重组为中文自然语序（病句检测命中才动手） */
  const _cnForRw = it.country_cn || (ENTITY && ENTITY.normalizeCountry ? ENTITY.normalizeCountry(it.country) : '') || '';
  const t5 = zhRewrite.rewrite(it.title, { country: _cnForRw });
  if (t5 && t5 !== it.title && t5.length >= 8) {
    if (!it.title_en) it.title_en = it.title;
    it.title = t5; it.title_zh = t5;
  }
  /* L4 可读性评分（#485）：度量入 data_json.zhq，低分采样日志（观察期不做硬阻塞） */
  it.zhq = zhRewrite.quality(it.title);
  if (it.zhq < 60 && _ZHQ_LOG_N < 12) {
    _ZHQ_LOG_N++;
    console.log('[ZHQ] 低分样本(' + it.zhq + '): ' + String(it.title).slice(0, 60));
  }
  /* 正文同样本地化英文国家名，减少"中外文融合" */
  if (it.content && /[A-Za-z]{4,}/.test(it.content)) {
    const c1 = _localizeCountryNames(it.content);
    if (c1 !== it.content) { if (!it.content_en) it.content_en = it.content; it.content = c1; it.content_zh = c1; }
  }
  _extractElements(it);
  return r;
}
async function _translateListToZhParallel(list, concurrency) {
  concurrency = concurrency || 3;
  if (concurrency > 3) concurrency = 3; // 限制翻译并发，缓解系统内存压力
  const tasks = [];
  list.forEach(function (it) {
    if (!it || typeof it !== 'object') return;
    /* 2026-08-29 审计修复：中文源标题（中新网/新华社/公众号镜像）本来就无需翻译，
       _looksForeign=false 使其跳过全部翻译逻辑 → title_zh 永远为空（近7天 200 条无中文标题主因，
       前端 COALESCE 回退虽可显示，但涉华判定/去重键/导出全链路依赖 title_zh 字段）。直接回填。 */
    const _t = String(it.title || '').trim();
    if (_t && !it.title_zh && !_looksForeign(_t)) it.title_zh = _t;
    if (_looksForeign(it.title)) tasks.push({ it: it, field: 'title' });
    if (_looksForeign(it.content) && String(it.content || '').length > 20) tasks.push({ it: it, field: 'content' });
  });
  if (!tasks.length) console.log('[TRANSLATE] 本批无需翻译，继续正文补抓与要素抽取');
  let idx = 0, done = 0;
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        /* 优先用干净原文重译：若条目已有 title_en 却仍被判定为外文，
           说明上一轮译文不合格（半中半英），拿原文重来比拿污染文本再译更准。 */
        const raw = t.field === 'title' ? (t.it.title_en || t.it.title)
                                        : String(t.it.content_en || t.it.content || '').slice(0, 6000);
        /* 采集端加的来源标签「[HDX 数据集]」若一起送去机翻，会被揉进译文导致
           括号不闭合（实测「[HDX阿富汗--2017年对…」）。先摘下、译完再拼回。 */
        let tag = '', src = raw;
        if (t.field === 'title') {
          const tm = /^\s*([\[【][^\]】]{0,24}[\]】])\s*/.exec(String(raw));
          if (tm) { tag = tm[1] + ' '; src = String(raw).slice(tm[0].length); }
        }
        const zh0 = await _translateAnyCached(src);
        const zh = zh0 && zh0.trim() ? (tag + zh0.trim()) : zh0;
        if (zh && zh.trim() && zh.trim() !== String(raw).trim()) {
          /* 溯源原文只在首次翻译时写入。重译场景下 title 已是上一轮译文，
             若无条件覆盖 title_en 会把译文冒充成原文，永久丢失真正的外文出处。 */
          if (t.field === 'title') {
            if (!t.it.title_en) t.it.title_en = t.it.title;
            t.it.title = zh.trim(); t.it.title_zh = zh.trim();
          } else {
            if (!t.it.content_en) t.it.content_en = t.it.content;
            t.it.content = zh.trim(); t.it.content_zh = zh.trim();
          }
          t.it.translated = true; done++;
        }
      } catch (e) { /* 单条失败保留原文，不中断整批 */ }
    }
  }
  if (tasks.length) await Promise.all(Array.from({ length: concurrency }, worker));
  /* 正文补抓（增量）：apSearch/GDELT 仅返回标题，导致正文长期为空、用户看不懂。
   * 对 content 为空且有 url 的条目跟进抓正文并翻译；按列表规模自适应限流，避免大批量采集超时。 */
  const needBody = [];
  list.forEach(function (it) {
    if (!it || typeof it !== 'object') return;
    const url = it.url || it.link;
    const have = it.content && String(it.content).trim().length >= 80;
    if (url && !have) needBody.push(it);
  });
  let bodyCap = 10;
  if (list.length <= 40) bodyCap = needBody.length;        // 小批量（专项/区域均衡）→ 全抓
  else if (list.length <= 90) bodyCap = 25;
  const bodyQueue = needBody.slice(0, bodyCap);
  if (bodyQueue.length) {
    let bDone = 0, bIdx = 0;
    async function bworker() {
      while (bIdx < bodyQueue.length) {
        const it = bodyQueue[bIdx++];
        try { if (await _fetchBodyForItem(it)) bDone++; } catch (e) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, bodyQueue.length) }, bworker));
    if (bDone) console.log('[TRANSLATE] 正文补抓：' + bDone + '/' + bodyQueue.length + ' 条获得正文');
  }
  /* 收尾：① 国名本地化 ② 媒体专名本地化 ③ 城市本地化 ④ 要素抽取（location/event_date）
   * 顺序保证长词优先：媒体 > 城市，避免 "The Washington Post" 被城市表先切成 "The 华盛顿 Post"。
   * 外文主体（翻译失败）条目不拼接半成品，由 _localizeTitleTail 打 _untranslated 标记待回填。 */
  let locN = 0, mediaN = 0, cityN = 0;
  list.forEach(function (it) {
    const r = _localizeTitleTail(it);
    locN += r.loc; mediaN += r.media; cityN += r.city;
  });
  console.log('[TRANSLATE] 并行采集即译：' + done + '/' + tasks.length + ' 个字段译成中文'
    + (locN ? '，本地化国家名 ' + locN + ' 条' : '')
    + (mediaN ? '，媒体专名 ' + mediaN + ' 条' : '')
    + (cityN ? '，城市名 ' + cityN + ' 条' : '')
    + (needBody.length ? '，正文待补 ' + needBody.length + ' 条（已抓 ' + bodyQueue.length + '）' : ''));
  return done;
}
app.post('/api/intel/translate-backfill', async (req, res) => {
  /* 首选通道 TranSmart/有道 免密钥、无日配额，无需任何配置即可回填 */
  const types = ['osint_intel', 'socmint_intel'];
  const stats = { osint_intel: { scanned: 0, translated: 0, skipped: 0 }, socmint_intel: { scanned: 0, translated: 0, skipped: 0 } };
  let errMsg = '';
  let remaining = 0;
  for (const type of types) {
    let arr = [];
    try { arr = require(path.join(CACHE_DIR, type + '.json')); } catch (e) { continue; }
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      /* 实战系统：落库即中文。当前 title/content 是否仍含外文（已中文的跳过） */
      const titleForeign = _looksForeign(it.title);
      const contentForeign = _looksForeign(it.content) && String(it.content || '').length > 20;
      if (!titleForeign && !contentForeign) { stats[type].skipped++; continue; }
      stats[type].scanned++;
      let did = false;
      try {
        if (titleForeign) {
          /* 已有译文则直接提升为主字段（免重复调用）；否则走多通道翻译 */
          let zh = it.title_zh;
          if (!zh || zh.trim() === String(it.title || '').trim()) {
            zh = await _translateAny(it.title);
          }
          if (zh && zh.trim() && zh.trim() !== String(it.title || '').trim()) {
            it.title_en = it.title; it.title = zh.trim(); it.title_zh = zh.trim(); did = true;
          }
        }
        if (contentForeign) {
          let zh = it.content_zh;
          if (!zh || zh.trim() === String(it.content || '').trim().slice(0, 6000)) {
            zh = await _translateAny(String(it.content || '').slice(0, 6000));
          }
          if (zh && zh.trim() && zh.trim() !== String(it.content || '').trim().slice(0, 6000)) {
            it.content_en = it.content; it.content = zh.trim(); it.content_zh = zh.trim(); did = true;
          }
        }
        if (did) stats[type].translated++; else remaining++;
      } catch (e) {
        errMsg = e.message;
        remaining++;
        console.warn('[BACKFILL] 翻译单条失败', type, (it.title || '').slice(0, 30), e.message);
      }
      await new Promise(r => setTimeout(r, 250)); // TranSmart 无日配额，轻节流
    }
    _writePublicCache(type, arr);
    console.log('[BACKFILL]', type, '扫描', stats[type].scanned, '翻译', stats[type].translated, '跳过', stats[type].skipped, '残留', remaining);
  }
  const allDone = remaining === 0;
  return res.json({ ok: allDone, configured: true, engine: 'transmart+youdao+baidu', stats, remaining, note: errMsg || (allDone ? 'done' : '部分条目仍受限，可再次调用本端点续翻') });
});
/* 免费注册 MyMemory key 生成（镜像 Dart 客户端 MyMemoryTranslator.generateKey）。
 * 注册用户凭用户名/密码可获取专属 key，翻译配额从匿名 5000 字符/日升至 50000 字符/日，
 * 仍完全免费、非百度。获取后写入 server/.env 的 MYMEMORY_KEY 并重启即生效。 */
async function _mymemoryGetKey(user, pass) {
  for (const ep of ['gettranslationkey', 'createtranslationkey']) {
    try {
      const r = await fetch('https://api.mymemory.translated.net/accounts/' + ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'user=' + encodeURIComponent(user) + '&pass=' + encodeURIComponent(pass),
        signal: AbortSignal.timeout(10000)
      });
      const j = await r.json().catch(() => ({}));
      const key = (j && j.key) || (j && j.responseData && j.responseData.key) || '';
      if (key) return key;
    } catch (e) { /* 尝试下一个端点 */ }
  }
  return '';
}
app.post('/api/translate/mymemory-key', async (req, res) => {
  const user = (req.body && (req.body.user || req.body.username)) || '';
  const pass = (req.body && req.body.pass) || '';
  if (!user || !pass) return res.json({ ok: false, error: '需要 user 与 pass（MyMemory 注册账号的用户名/邮箱与密码）' });
  try {
    const key = await _mymemoryGetKey(user, pass);
    if (!key) return res.json({ ok: false, error: '未能生成 key（账号不存在或凭据错误）' });
    return res.json({ ok: true, key, note: '将此 key 写入 server/.env 的 MYMEMORY_KEY 并重启服务即可把免费配额从 5000 提升至 50000 字符/日' });
  } catch (e) {
    return res.json({ ok: false, error: '请求 MyMemory 失败: ' + e.message });
  }
});

/* 存量正文回填端点必须注册在 /api/intel/:type 通配路由之前，
 * 否则 POST /api/intel/enrich 会被匹配成 type='enrich' 并被 authMiddleware 拦截。
 * 实现见文件末尾的 _handleIntelEnrich（函数声明，已提升）。 */
app.post('/api/intel/enrich', (req, res) => _handleIntelEnrich(req, res));

/* 公开读取：态势情报为公开 OSINT，无需登录即可读取；写入/审核/删除仍受 JWT 保护 */
/* ===== 非预警数据池 API（2026-08-28）===== */
app.get('/api/intel/sidepool', async (req, res) => {
  try {
    await _ensureSidepool();
    const days = Math.min(7, parseInt(req.query.days || '1', 10) || 1);
    const reason = String(req.query.reason || '').trim();
    const limit = Math.min(300, parseInt(req.query.limit || '100', 10) || 100);
    const since = `blocked_at >= NOW() - INTERVAL '${days} days'`;
    const stats = await query(`
      SELECT reason, COUNT(*) n FROM intel_sidepool WHERE ${since} GROUP BY 1 ORDER BY n DESC`);
    const byTag = await query(`
      SELECT source_tag, COUNT(*) n FROM intel_sidepool WHERE ${since} GROUP BY 1 ORDER BY n DESC LIMIT 15`);
    let rows = [];
    if (reason !== '__stats_only__') {
      const r = await query(`
        SELECT id, reason, source_tag, data_type, title, title_zh, url, country, blocked_at
        FROM intel_sidepool WHERE ${since} ${reason ? 'AND reason = $1' : ''}
        ORDER BY blocked_at DESC LIMIT ${limit}`, reason ? [reason] : []);
      rows = r.rows;
    }
    const totalRow = await query(`SELECT COUNT(*) n FROM intel_sidepool WHERE ${since}`);
    res.json({ ok: true, days, total: totalRow.rows[0].n, byReason: stats.rows, byTag: byTag.rows, items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* 人工提升：把被拦条目移入正式库（分析师复核后认为有价值的） */
app.post('/api/intel/sidepool/promote', async (req, res) => {
  try {
    await _ensureSidepool();
    const id = parseInt((req.body || {}).id, 10);
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const { rows } = await query(`SELECT * FROM intel_sidepool WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: '条目不存在' });
    const sp = rows[0];
    let it = sp.data_json || {};
    it.title = sp.title || it.title; it.title_zh = sp.title_zh || it.title_zh;
    it.url = sp.url || it.url; it.country = sp.country || it.country;
    it._promoted = true; it._promotedFrom = sp.reason;
    if (!it._sourceType) it._sourceType = 'sidepool_promote'; /* 2026-08-29 溯源铁律 */
    it._eventSig = _eventSignature(it); _tagAssets(it);
    const _lv = _normLevelForStore(it); it.level_norm = _lv;
    const _dt = (it._forceDataType && it.data_type) ? it.data_type : (_classifyIntelType(it) || 'osint_intel');
    await query(
      `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved')`,
      [_dt, it.title || '', it.country || '', it.location || '', it.event_date || it.date || '', _lv, it.content || '', it.source || '非预警池提升', JSON.stringify(it)]
    );
    await query(`DELETE FROM intel_sidepool WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/intel/sidepool/:id', async (req, res) => {
  try {
    await query(`DELETE FROM intel_sidepool WHERE id=$1`, [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/intel/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!INTEL_TYPES.includes(type)) return res.status(400).json({ error: '无效的情报类型' });
    const result = await query('SELECT * FROM intel_data WHERE data_type = $1 ORDER BY collect_time DESC', [type]);
    /* 2026-08-25 铁律修复：必须回传真实入库时间 collect_time——此前只铺 data_json，
     * 历史条目 data_json 无时间字段时前端只能用 Date.now() 兜底，导致 5 月旧闻盖今日新戳
     * 混入最新预警（id 11233 事件）。DB 列置后覆盖，防止 data_json 内同名字段造假。 */
    res.json(result.rows.map(r => ({ ...r.data_json, id: r.id, audit_status: r.audit_status, audit_time: r.audit_time, collect_time: r.collect_time })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});


/* 前端同步入口闸门（2026-08-14 重大修复）：前端 datasources 引擎曾把同一条情报
 * 按数据源轮换署名反复 POST（同一标题最多 15 份副本，含已被用户删除的旧闻复活）。
 * 三个 POST 入库口统一加装：标题去重 + 24h 时效 + 国内新闻拦截 + 删除名单 + 分类/级别归一。 */
const _POST_BLOCK_RE = /阿富汗承诺在跨境袭击中合作.*塔吉克斯坦|3名中国工人在塔吉克斯坦死亡|暗网论坛出现针对中资矿业公司的雇佣兵招募信息|卡拉奇港中资码头出现可疑车辆|马里北部发生武装袭击，金矿区安全形势恶化|苏丹武装冲突升级，多国发布撤侨警告/i;
/* URL 级去重缓存（2026-08-16：POST 通道此前无 URL 去重，同一 URL 被反复灌库 349 次） */
let _urlCache = { t: 0, set: new Set() };
async function _getKnownUrls() {
  if (Date.now() - _urlCache.t < 10 * 60 * 1000 && _urlCache.set.size) return _urlCache.set;
  try {
    const { rows } = await query("SELECT DISTINCT data_json->>'url' u FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days' AND data_json->>'url' IS NOT NULL AND data_json->>'url' <> ''");
    _urlCache = { t: Date.now(), set: new Set(rows.map(r => r.u)) };
  } catch (e) {}
  return _urlCache.set;
}
async function _postGate(item) {
  /* 手工建案（无 URL、无任何日期字段）：事件时间默认当下，不受 24h 新闻时效闸约束 */
  if (!item.url && !item.publish_time && !item.publishedAt && !item.pubDate && !item.event_date && !item.date) {
    item.event_date = new Date().toISOString();
  }
  _stripHtmlFields(item); /* 2026-08-25：入库前去标签（同 _preInsertGate） */
  if (!item || !item.title) { _gateAudit('入库闸', 'empty', ''); return 'empty'; }
  /* 空壳条目一票否决（2026-08-17：旧版前端模板生成器产出的"美国-委内瑞拉冲突"式无正文垃圾）：
   * 无链接 且 正文与标题几乎相同/为空（真正的情报必有正文或链接佐证） */
  {
    const _c = String(item.content || item.desc || '').trim();
    const _t0 = String(item.title || '').trim();
    const _meaningful = _c.length > 30 && _c.replace(/[|\s]/g, '').length > _t0.replace(/[|\s]/g, '').length + 10;
    if (!item.url && !_meaningful) return 'shell';
  }
  if (_POST_BLOCK_RE.test(String(item.title || '') + ' ' + String(item.title_zh || ''))) { _gateAudit('入库闸', 'blocked-blacklist', item.title); return 'blocked'; }
  /* 删除墓碑：用户删过的数据永不再入（2026-08-22 铁律） */
  if (await _isTombstoned(item)) { _gateAudit('入库闸', 'tombstoned', item.title); return 'tombstoned'; }
  /* 历史旧案回顾一票否决（2026-08-29）：与 _preInsertGate 同源判定 */
  if (_isHistoricalRetrospect(item)) { _gateAudit('入库闸', 'historical', item.title); return 'historical'; }
  /* 精确标题去重（2026-08-16 用户铁律）：30 天内同标题（含译文标题）一律拒收——
   * 24h 窗口对"每天回灌一次"的旧缓存失效，精确同标题重发永远不可能是新事件 */
  try {
    const _t = String(item.title || '').trim();
    const _tz = String(item.title_zh || '').trim();
    if (_t.length >= 8 || _tz.length >= 8) { /* 阈值 10→8：9 字壳标题（美国-委内瑞拉冲突）曾漏网 */
      const { rows } = await query(
        `SELECT 1 FROM intel_data WHERE collect_time >= NOW() - INTERVAL '30 days' AND (title = $1 OR ($2 <> '' AND data_json->>'title_zh' = $2) OR ($2 <> '' AND title = $2)) LIMIT 1`,
        [_t, _tz]
      );
      if (rows.length) { _gateAudit('入库闸', 'dup-exact-title', item.title); return 'dup-exact-title'; }
    }
  } catch (e) {}
  if (item.url) { const urls = await _getKnownUrls(); if (urls.has(String(item.url).replace(/\/+$/, '').toLowerCase()) || urls.has(String(item.url))) return 'dup-url'; }
  if (!_isFreshEnough(item)) { _gateAudit('入库闸', 'stale', item.title); return 'stale'; }
  if (globalmedia._isDomesticChina && globalmedia._isDomesticChina(String(item.title || '') + ' ' + String(item.title_zh || ''))) return 'domestic';
  const _pt = String(item.title || '') + ' ' + String(item.content || item.desc || '');
  if (globalmedia._isSoftJunk && globalmedia._isSoftJunk(_pt)) return 'softjunk';
  if (globalmedia.gateRelevant && !globalmedia.gateRelevant(_pt)) return 'irrelevant';
  const titleKeys = await _getRecentTitleKeys();
  if (_isDupTitle(titleKeys, item)) return 'dup';
  return '';
}

app.post('/api/intel/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    if (!INTEL_TYPES.includes(type)) return res.status(400).json({ error: '无效的情报类型' });
    const item = req.body;
    if (!item._sourceType) item._sourceType = 'frontend_post'; /* 2026-08-29 溯源铁律 */
    const blocked = await _postGate(item);
    if (blocked) return res.json({ skipped: blocked });
    _tagAssets(item); const _lv = _normLevelForStore(item); item.level_norm = _lv;
    const _dt = type === 'osint_intel' ? _classifyIntelType(item) : type;
    item.data_type = _dt;
    const result = await query(
      'INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [_dt, item.title||'', item.country||'', item.location||'', item.date||'', _lv, item.desc||'', item.source||'', JSON.stringify(item), item.audit_status||'approved']
    );
    res.json({ id: result.rows[0].id, ...item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/intel/:type/batch', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    if (!INTEL_TYPES.includes(type)) return res.status(400).json({ error: '无效的情报类型' });
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: '请提供数组' });
    let count = 0, skipped = 0;
    for (const item of items) {
      if (!item._sourceType) item._sourceType = 'frontend_post'; /* 2026-08-29 溯源铁律 */
      const blocked = await _postGate(item);
      if (blocked) { skipped++; continue; }
      _tagAssets(item); const _lv = _normLevelForStore(item); item.level_norm = _lv;
      const _dt = type === 'osint_intel' ? _classifyIntelType(item) : type;
      item.data_type = _dt;
      await query('INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [_dt, item.title||'', item.country||'', item.location||'', item.date||'', _lv, item.desc||'', item.source||'', JSON.stringify(item), item.audit_status||'approved']);
      count++;
    }
    res.json({ success: true, count, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/intel/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = req.body;
    await query('UPDATE intel_data SET title=$1, country=$2, data_json=$3, audit_status=$4 WHERE id=$5', [item.title||'', item.country||'', JSON.stringify(item), item.audit_status||'approved', id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/intel/:id/audit', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['approved','rejected','pending'].includes(status)) return res.status(400).json({ error: '无效审核状态' });
    await query('UPDATE intel_data SET audit_status=$1, audit_time=$2 WHERE id=$3', [status, new Date().toISOString(), id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/intel/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    /* 删除即墓碑（2026-08-22 铁律）：先立碑再删行，采集器再抓到同标题/同链接一律拒收 */
    try {
      const { rows } = await query('SELECT title, data_json FROM intel_data WHERE id = $1', [id]);
      if (rows.length) {
        const dj = rows[0].data_json || {};
        await _addTombstone(rows[0].title, dj.title_zh || '', dj.url || '');
      }
    } catch (e) { console.warn('[TOMBSTONE] 删除前立碑失败:', e.message); }
    await query('DELETE FROM intel_data WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* 前端删除落碑接口（2026-08-22）：前端预警的 id 未必是服务器行 id，
 * 前端删除时把 标题+译文标题+链接 POST 过来——立碑 + 全库清除命中行。
 * 2026-08-29 终局删除升级（伦敦使馆旧闻"删都删不掉"根因⑤）：
 *  旧版只 DELETE intel_data 精确匹配行——译文措辞漂移即漏删，且
 *  归档库/拦截池/预警队列/文件缓存全不清，旧文从任一残留处复活。
 *  现按墓碑键（归一化标题+URL+核心实体键）JS 侧模糊匹配，五库全清。 */
app.post('/api/intel-tombstone', authMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    const t = String(b.title || '').trim(), tz = String(b.title_zh || '').trim(), u = String(b.url || '').trim();
    if (!t && !tz && !u) return res.status(400).json({ error: 'title/title_zh/url 至少给一个' });
    /* 2026-08-29 英文原标题同碑：采集器先见英文原文后译中文，译文措辞漂移会让
     * 中文标题键失效；英文原标题是同一文章跨通道/跨译文的最稳指纹。
     * 从活跃库+归档库现存同文行收割 title_en 一并立碑。 */
    try {
      const { rows: enRows } = await query(
        `SELECT DISTINCT data_json->>'title_en' AS ten FROM intel_data
         WHERE (($1 <> '' AND title = $1) OR ($2 <> '' AND data_json->>'title_zh' = $2) OR ($3 <> '' AND data_json->>'url' = $3)) AND NULLIF(data_json->>'title_en','') IS NOT NULL
         UNION
         SELECT DISTINCT data_json->>'title_en' AS ten FROM intel_archive
         WHERE (($1 <> '' AND title = $1) OR ($2 <> '' AND data_json->>'title_zh' = $2) OR ($3 <> '' AND data_json->>'url' = $3)) AND NULLIF(data_json->>'title_en','') IS NOT NULL`,
        [t, tz, u]);
      for (const r of enRows) { if (r.ten) await _addTombstone(r.ten, '', ''); }
    } catch (e) { console.warn('[TOMBSTONE] 英文标题收割失败:', e.message); }
    await _addTombstone(t, tz, u);
    const tb = await _getTombstones();
    const removed = { intel_data: 0, intel_archive: 0, intel_sidepool: 0, alerts: 0, cache: 0 };
    const _hit = it => _tombMatchSync(tb, it) || (u && String((it && (it.url || it.link)) || '') === u);
    /* ① 活跃库 intel_data（含译文变体模糊匹配） */
    try {
      const { rows } = await query(`SELECT id, title, data_json FROM intel_data`);
      const ids = rows.filter(r => _hit({ title: r.title, title_zh: (r.data_json || {}).title_zh, url: (r.data_json || {}).url })).map(r => r.id);
      if (ids.length) { const d = await query(`DELETE FROM intel_data WHERE id = ANY($1)`, [ids]); removed.intel_data = d.rowCount || 0; }
    } catch (e) { console.warn('[TOMBSTONE] 清 intel_data 失败:', e.message); }
    /* ② 归档库 intel_archive（滚动归档会把已删行搬进归档，旧版从不清理） */
    try {
      const { rows } = await query(`SELECT id, title, data_json FROM intel_archive`);
      const ids = rows.filter(r => _hit({ title: r.title, title_zh: (r.data_json || {}).title_zh, url: (r.data_json || {}).url })).map(r => r.id);
      if (ids.length) { const d = await query(`DELETE FROM intel_archive WHERE id = ANY($1)`, [ids]); removed.intel_archive = d.rowCount || 0; }
    } catch (e) { console.warn('[TOMBSTONE] 清 intel_archive 失败:', e.message); }
    /* ③ 拦截池 intel_sidepool */
    try {
      const { rows } = await query(`SELECT id, title, title_zh, url FROM intel_sidepool`);
      const ids = rows.filter(r => _hit({ title: r.title, title_zh: r.title_zh, url: r.url })).map(r => r.id);
      if (ids.length) { const d = await query(`DELETE FROM intel_sidepool WHERE id = ANY($1)`, [ids]); removed.intel_sidepool = d.rowCount || 0; }
    } catch (e) { console.warn('[TOMBSTONE] 清 intel_sidepool 失败:', e.message); }
    /* ④ 预警队列 datahub alerts（权威合并会保留 72h，不清则前端每次重载复活） */
    try {
      const cur = await query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
      const arr = (cur.rows.length && Array.isArray(cur.rows[0].data_json)) ? cur.rows[0].data_json : [];
      const kept = arr.filter(a => a && !_hit(a));
      if (kept.length !== arr.length) {
        await query(`INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ('alerts',$1,NOW()) ON CONFLICT (collection) DO UPDATE SET data_json=$1, updated_at=NOW()`, [JSON.stringify(kept)]);
        removed.alerts = arr.length - kept.length;
      }
    } catch (e) { console.warn('[TOMBSTONE] 清预警队列失败:', e.message); }
    /* ⑤ 公开文件缓存（.cache/*.json，无 PG 时前端公开通道的数据源） */
    try {
      const files = (fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : []).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      for (const f of files) {
        const fp = path.join(CACHE_DIR, f);
        try {
          const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
          if (!Array.isArray(arr) || !arr.length) continue;
          const kept = arr.filter(it => it && !_hit(it));
          if (kept.length !== arr.length) { fs.writeFileSync(fp, JSON.stringify(kept), 'utf8'); removed.cache += arr.length - kept.length; }
        } catch (e2) {}
      }
    } catch (e) { console.warn('[TOMBSTONE] 清缓存失败:', e.message); }
    console.log('[TOMBSTONE] 终局删除: ' + JSON.stringify(removed) + ' | ' + String(t || tz || u).slice(0, 50));
    res.json({ ok: true, removed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/intel/:type/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { type } = req.params;
    if (!INTEL_TYPES.includes(type)) return res.status(400).json({ error: '无效的情报类型' });
    await query('DELETE FROM intel_data WHERE data_type = $1', [type]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== DataHub 数据集 API ===== */
app.get('/api/datahub/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    if (!DH_COLLECTIONS.includes(collection)) return res.status(400).json({ error: '无效的集合名' });
    const result = await query('SELECT data_json FROM datahub_store WHERE collection = $1', [collection]);
    let arr = result.rows.length > 0 ? result.rows[0].data_json : [];
    /* 预警集合下发窗口（2026-08-31 零点清零根治）：「今日零点」日历日切割 → 24h 滚动窗，
     * 与 PUT 写入闸 / _qualityGuardian / _serverAlertGen 24h 回看 / 前端本地滚动窗同口径。
     * 零点后昨日深夜预警仍在窗内正常下发，条目发布满 24h 才平滑退出。 */
    if (collection === 'alerts' && Array.isArray(arr)) {
      const ds = Date.now() - 24 * 3600 * 1000;
      arr = arr.filter(a => {
        if (!a) return false;
        const t = new Date(a.time || a.date || a.publishedAt || a.collect_time || '').getTime();
        if (!(t && t >= ds)) return false;
        /* 2026-08-20 铁律：服务端下发再次过 chinaOverseasGate，防止任何持久化脏数据漏到前端 */
        const _gtxt = String(a.title || a.title_zh || '') + ' ' + String(a.desc || a.content || '');
        if (typeof scrapers !== 'undefined' && scrapers.chinaOverseasGate && !scrapers.chinaOverseasGate(_gtxt).pass) return false;
        return true;
      });
    }
    res.json(arr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/datahub/:collection', authMiddleware, async (req, res) => {
  try {
    const { collection } = req.params;
    if (!DH_COLLECTIONS.includes(collection)) return res.status(400).json({ error: '无效的集合名' });
    let data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: '数据必须是数组' });
    /* 防误清（2026-08-17）：现有库存较大时，拒绝用极小数组全量覆盖（空库客户端启动保存会把共享库清零） */
    try {
      const cur = await query('SELECT data_json FROM datahub_store WHERE collection = $1', [collection]);
      const curN = (cur.rows.length && Array.isArray(cur.rows[0].data_json)) ? cur.rows[0].data_json.length : 0;
      if (curN >= 10 && data.length < curN * 0.2) {
        console.log('[DATAHUB] 拒绝小数组覆盖: ' + collection + ' 现有' + curN + ' →  incoming' + data.length);
        return res.json({ success: true, skipped: 'wipe-guard', kept: curN });
      }
    } catch (e) {}
    /* 服务端权威过滤（2026-08-16 用户铁律：旧闻绝不盖新戳）——
     * 旧版客户端会把历史条目盖新时间戳回灌共享预警库。写入咽喉统一拦截：
     * ① 黑名单无链接条目；② 数字 id 条目以 PG collect_time 为准，早于今日拒收；
     * ③ 前端时间字段非今日拒收；④ 无时间用 alert_no 内嵌日期兜底，全无则拒收。 */
    if (collection === 'alerts') {
      /* 2026-08-31 零点清零根治：写入闸 cutoff 从「今日零点」改 24h 滚动窗——
       * 下方四处 >= ds 与 alert_no 日期兜底随 cutoff 自动切换口径。
       * 「旧闻绝不盖新戳」原则不变：早于 24h 窗的盖戳回灌仍一律拒收。 */
      const ds = Date.now() - 24 * 3600 * 1000;
      const tkSet = new Set([new Date(), new Date(ds)].map(d =>
        String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')));
      const numIds = data.map(a => a && a.id).filter(id => /^\d+$/.test(String(id)));
      const pgTime = {};
      if (numIds.length) {
        try {
          const { rows } = await query('SELECT id, collect_time FROM intel_data WHERE id = ANY($1)', [numIds]);
          rows.forEach(r => { pgTime[String(r.id)] = new Date(r.collect_time).getTime(); });
        } catch (e) {}
      }
      /* URL/标题 权威对照（2026-08-16 深夜加固：旧客户端换前端新 id 绕过 id 校验——
       * 只要 URL 或标题在 PG 有早于今日的记录，即为盖戳回灌，一律拒收） */
      const urlTime = {}, titleTime = {};
      try {
        const urls = data.map(a => a && a.url).filter(Boolean).slice(0, 400);
        if (urls.length) {
          const marks = urls.map((_, i) => '$' + (i + 1)).join(',');
          const { rows } = await query(`SELECT data_json->>'url' u, MAX(collect_time) mx FROM intel_data WHERE data_json->>'url' IN (${marks}) GROUP BY 1`, urls);
          rows.forEach(r => { if (r.u) urlTime[r.u] = new Date(r.mx).getTime(); });
        }
        const titles = [...new Set(data.map(a => String((a && (a.title || a.title_zh)) || '').trim()).filter(t => t.length >= 10))].slice(0, 300);
        if (titles.length) {
          const marks = titles.map((_, i) => '$' + (i + 1)).join(',');
          const { rows } = await query(`SELECT title, MAX(collect_time) mx FROM intel_data WHERE title IN (${marks}) GROUP BY 1`, titles);
          rows.forEach(r => { if (r.title) titleTime[r.title] = new Date(r.mx).getTime(); });
        }
      } catch (e) {}
      const before = data.length;
      /* 2026-08-29 墓碑写入闸（伦敦使馆旧闻复活根因④）：上面的"旧闻不盖新戳"对照
       * 依赖 intel_data 存留行——而删除恰恰把对照证据删光，导致已删旧文盖新戳长驱直入。
       * 墓碑表才是删除的持久证据，任何客户端写入一律先查墓碑。 */
      let _tbPut = null;
      try { _tbPut = await _getTombstones(); } catch (e) {}
      data = data.filter(a => {
        if (!a) return false;
        if (_tbPut && _tombMatchSync(_tbPut, a)) { _gateAudit('写入闸', 'tombstoned', a.title); return false; }
        const txt = String(a.title || '') + String(a.title_zh || '');
        if (!a.url && _POST_BLOCK_RE.test(txt)) { _gateAudit('写入闸', 'blacklist', a.title); return false; }
        const pt = pgTime[String(a.id)];
        if (pt !== undefined) return pt >= ds; /* PG id 有案：以 PG 采集时间为准 */
        if (a.url && urlTime[a.url] !== undefined) return urlTime[a.url] >= ds; /* URL 有案：以 PG 为准 */
        const tt = String(a.title || '').trim();
        if (tt.length >= 10 && titleTime[tt] !== undefined) return titleTime[tt] >= ds; /* 标题有案：以 PG 为准 */
        /* 利益关联闸（2026-08-16 用户指令永久化：黄/蓝级无海外利益关联 = 非预警，任何客户端写入一律拒收） */
        if (_isShellAlert(a)) { _gateAudit('写入闸', 'shell', a.title); return false; } /* 模板空壳一律拒收 */
        if (_isRuUaNoLink(a)) { _gateAudit('写入闸', 'ruua-nolink', a.title); return false; }
        /* 2026-08-20 铁律：客户端回写共享预警库必须过 chinaOverseasGate */
        const _gtxt2 = String(a.title || a.title_zh || '') + ' ' + String(a.desc || a.content || '');
        if (typeof scrapers !== 'undefined' && scrapers.chinaOverseasGate && !scrapers.chinaOverseasGate(_gtxt2).pass) {
          _gateAudit('写入闸', 'domestic', a.title); return false;
        }
        if (_alertInterestScore(a).score < 10) { _gateAudit('写入闸', 'no-interest', a.title); return false; } /* 阈值 20→10（日产≥200 条目标） */
        const t = new Date(a.time || a.date || a.publishedAt || a.collect_time || '').getTime();
        if (t) return t >= ds;
        const m = String(a.alert_no || '').match(/(20\d{6})/);
        return m ? tkSet.has(m[1]) : false;
      });
      if (data.length !== before) console.log('[DATAHUB] alerts 写入过滤: ' + before + ' → ' + data.length + '（剔除超24h/盖戳回灌）');
      /* 2026-08-25 赋分改革根因修复：客户端全量覆盖会把服务端权威红区预警冲掉
       * （旧客户端 IndexedDB 里既没有新生成的红区条目、也没有 risk_zone 字段，一存全没）。
       * 改为权威合并：客户端条目按 id 覆盖/新增；服务端现有但客户端未包含的条目，
       * 72h 时效内一律保留（红区预警的存续不依赖任何客户端在线）；缺分区现场补算。 */
      try {
        const cur2 = await query('SELECT data_json FROM datahub_store WHERE collection = $1', [collection]);
        const curArr = (cur2.rows.length && Array.isArray(cur2.rows[0].data_json)) ? cur2.rows[0].data_json : [];
        const clientIds = new Set(data.map(a => String((a && a.id) || '')));
        const now2 = Date.now();
        const preserved = curArr.filter(a => {
          if (!a) return false;
          if (clientIds.has(String(a.id || ''))) return false; /* 客户端已带同 id 新副本 */
          const t = Date.parse(a.publishedAt || '') || Date.parse(String(a.time || '').replace(' ', 'T')) || 0;
          if (t && now2 - t > 72 * 3600 * 1000) return false; /* 超 72h 不保留 */
          /* 2026-08-29 删除保留豁免（根因④）：客户端删除后本地列表不含该条，
           * 权威合并却把它当"服务端独有、72h 内"保留——删除的预警 72h 内反复回灌复活。
           * 墓碑命中的一律不保留。 */
          if (_tbPut && _tombMatchSync(_tbPut, a)) { _gateAudit('写入闸', 'tomb-keep', a.title); return false; }
          return true;
        });
        for (const a of preserved.concat(data)) {
          if (!a) continue;
          /* 两区渲染（2026-08-29）：客户端副本补核心区标记（缺失时服务端权威判定） */
          if (a.is_core === undefined) a.is_core = _alertIsCore(a);
          if (a.risk_zone) continue;
          try {
            const s = _scoreRiskItem({ title: a.title || '', title_zh: a.title_zh || '', content: a.desc || a.content || '', country: a.country || '', source: a.source || '', publishedAt: a.publishedAt || a.time || '' });
            a.risk_score = s.score; a.risk_zone = s.zone; a.risk_rationale = s.rationale; a.zone_action = s.action;
            a.level = s.level;
          } catch (e) {}
        }
        const clientKept = data.length;
        /* 2026-08-31 标题跨形态去重（根因 #524：原版只在 _serverAlertGen 跑，PUT 合并路径客户端回灌
         * 不经过生成器，每次合并都会再写同题双条；预警中心重复组从 23 涨到 30 即为此因）。
         * 在权威合并完成后、写库前统一去重，保证落库 + 下发到下一轮 PUT 前都是干净态。 */
        const _tdPut = _dedupAlertsByTitle(data.concat(preserved), '[DATAHUB]');
        if (_tdPut.count) {
          /* 去重合并按 id 归属拆分回 client/preserved（保留条目 id 未变，仅字段互补） */
          data = _tdPut.kept.filter(a => clientIds.has(String(a.id || '')));
          preserved.length = 0;
          preserved.push(..._tdPut.kept.filter(a => !clientIds.has(String(a.id || ''))));
        }
        data = _partitionCore(_capAlertQueue(data.concat(preserved))).slice(0, 500); /* 2026-08-31 与 _serverAlertGen 同上限：300→500 */
        console.log('[DATAHUB] alerts 权威合并: 客户端 ' + clientKept + ' 条 + 服务端保留 ' + preserved.length + ' 条 → ' + data.length + ' 条');
      } catch (e) { console.warn('[DATAHUB] alerts 合并异常（回退全量覆盖）:', e.message); }
    } else if (INTEL_TYPES.includes(collection) && collection !== 'collect_logs') {
      /* 2026-08-30 情报集合写入去重（用户铁证：逃跑条在 terror_events 有 3 份拷贝，
       * id 分别是真实 intel id 与两个 Date.now() 时间戳 id——客户端分发路径换 id 重复入集，
       * 本地副本全量 PUT 回灌）。按标题指纹去重：真实 intel id 优先于时间戳 id。 */
      try {
        const _norm = s => String(s || '').replace(/\s+/g, '').toLowerCase().slice(0, 40);
        const seen = new Map(); const out = [];
        for (const x of data) {
          if (!x) continue;
          const k = _norm(x.title_zh || x.title);
          if (!k) { out.push(x); continue; }
          const myTs = /^1[78]\d{11}$/.test(String(x.id || ''));
          if (!seen.has(k)) { seen.set(k, myTs); out.push(x); continue; }
          const prevTs = seen.get(k);
          if (myTs && !prevTs) continue; /* 本条时间戳 id，已有真实 id → 丢 */
          if (!myTs && prevTs) { /* 本条真实 id，替换已收的时间戳 id 副本 */
            seen.set(k, false);
            const idx = out.findIndex(y => _norm(y.title_zh || y.title) === k);
            if (idx >= 0) out.splice(idx, 1);
            out.push(x); continue;
          }
          continue; /* 同类重复 → 丢 */
        }
        if (out.length !== data.length) console.log('[DATAHUB] ' + collection + ' 写入去重: ' + data.length + ' → ' + out.length + '（标题指纹）');
        data = out;
      } catch (e) {}
    }
    await query('INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (collection) DO UPDATE SET data_json = $2, updated_at = NOW()', [collection, JSON.stringify(data)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== AI 报告 API ===== */
app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM ai_reports ORDER BY created_at DESC');
    res.json(result.rows.map(r => ({ id: r.report_id||r.id, title: r.title, mode: r.mode, country: r.country, level: r.level, reportType: r.report_type, materials: r.materials, threatAnalysis: r.threat_analysis, impactAnalysis: r.impact_analysis, advice: r.advice, author: r.author, createdAt: r.created_at })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    /* 2026-09-01 根治：报告 id 为 'AIR-xxxxxx' 字符串（report_id 列已迁 varchar），parseInt 强转恒 NaN */
    const raw = String(req.params.id || '');
    const num = parseInt(raw, 10);
    const result = await query('SELECT * FROM ai_reports WHERE report_id = $1 OR ($2::int IS NOT NULL AND id = $2::int)', [raw, Number.isFinite(num) ? num : null]);
    if (result.rows.length === 0) return res.status(404).json({ error: '报告不存在' });
    const r = result.rows[0];
    res.json({ id: r.report_id||r.id, title: r.title, mode: r.mode, country: r.country, level: r.level, reportType: r.report_type, materials: r.materials, threatAnalysis: r.threat_analysis, impactAnalysis: r.impact_analysis, advice: r.advice, author: r.author, createdAt: r.created_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reports', authMiddleware, async (req, res) => {
  try {
    const r = req.body;
    const reportId = String(r.id || (Date.now() + Math.floor(Math.random() * 100000)));
    const result = await query(
      'INSERT INTO ai_reports (report_id, title, mode, country, level, report_type, materials, threat_analysis, impact_analysis, advice, content_json, author) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
      [reportId, r.title||'', r.mode||'elements', r.country||'', r.level||'', r.reportType||r.report_type||'', r.materials||'', r.threatAnalysis||r.threat_analysis||'', r.impactAnalysis||r.impact_analysis||'', r.advice||'', JSON.stringify(r), req.user.username]
    );
    res.json({ id: reportId, dbId: result.rows[0].id, ...r });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    const raw = String(req.params.id || '');
    const num = parseInt(raw, 10);
    const r = req.body;
    await query('UPDATE ai_reports SET title=$1, mode=$2, country=$3, level=$4, report_type=$5, materials=$6, threat_analysis=$7, impact_analysis=$8, advice=$9, content_json=$10 WHERE report_id=$11 OR ($12::int IS NOT NULL AND id=$12::int)',
      [r.title||'', r.mode||'elements', r.country||'', r.level||'', r.reportType||r.report_type||'', r.materials||'', r.threatAnalysis||r.threat_analysis||'', r.impactAnalysis||r.impact_analysis||'', r.advice||'', JSON.stringify(r), raw, Number.isFinite(num) ? num : null]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/reports/:id', authMiddleware, async (req, res) => {
  try { const raw = String(req.params.id || ''); const num = parseInt(raw, 10); await query('DELETE FROM ai_reports WHERE report_id = $1 OR ($2::int IS NOT NULL AND id = $2::int)', [raw, Number.isFinite(num) ? num : null]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 威胁组织 API ===== */
app.get('/api/threat-orgs', async (req, res) => {
  try {
    const result = await query('SELECT * FROM threat_orgs ORDER BY updated_at DESC');
    res.json(result.rows.map(r => ({ ...r.data_json, id: r.org_id||r.id, _dbId: r.id })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/threat-orgs', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: '数据必须是数组' });
    await query('DELETE FROM threat_orgs');
    /* 同 auto-alerts/risk-fusion 修复：去重 + 单行容错，缺 id 用名称兜底 */
    const seen = new Set();
    let inserted = 0, skipped = 0;
    for (const org of data) {
      const oid = String(org.id || org.name || Date.now());
      if (seen.has(oid)) { skipped++; continue; }
      seen.add(oid);
      try {
        await query('INSERT INTO threat_orgs (org_id, name, type, country, level, "desc", data_json) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (org_id) DO NOTHING',
          [oid, org.name||'', org.type||'', org.country||'', org.level||'', org.desc||'', JSON.stringify(org)]);
        inserted++;
      } catch (e) { skipped++; }
    }
    res.json({ success: true, count: inserted, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 企业项目 API ===== */
app.get('/api/enterprise-projects', async (req, res) => {
  try {
    const result = await query('SELECT * FROM enterprise_projects ORDER BY updated_at DESC');
    res.json(result.rows.map(r => ({ ...r.data_json, _dbId: r.id })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/enterprise-projects', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: '数据必须是数组' });
    await query('DELETE FROM enterprise_projects');
    for (const proj of data) {
      await query('INSERT INTO enterprise_projects (enterprise, project, country, location, status, data_json) VALUES ($1,$2,$3,$4,$5,$6)',
        [proj.enterprise||'', proj.project||'', proj.country||'', proj.location||'', proj.status||'', JSON.stringify(proj)]);
    }
    res.json({ success: true, count: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 风险融合 API ===== */
app.get('/api/risk-fusion', async (req, res) => {
  try {
    const result = await query('SELECT * FROM risk_fusion ORDER BY fusion_time DESC');
    res.json(result.rows.map(r => ({ ...r.data_json, _dbId: r.id, fusionTime: r.fusion_time })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/risk-fusion', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: '数据必须是数组' });
    await query('DELETE FROM risk_fusion');
    /* 2026-08-14 修复：融合结果对象无 id 字段，原代码用 Date.now() 兜底，
     * 同毫秒批量插入产生重复 fusion_id 触发 UNIQUE 冲突 → 整表回写 500。
     * 改用 事件×项目 复合键 + 去重 + 单行容错。 */
    const seen = new Set();
    let inserted = 0, skipped = 0;
    for (const fusion of data) {
      const fid = String(fusion.id || ((fusion.event_id || 'e') + '-' + (fusion.project_id || 'p') + '-' + (fusion.match_score || 0)));
      if (seen.has(fid)) { skipped++; continue; }
      seen.add(fid);
      try {
        await query('INSERT INTO risk_fusion (fusion_id, title, country, level, sources, data_json) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (fusion_id) DO NOTHING',
          [fid, fusion.event_title || fusion.title || '', fusion.project_country || fusion.country || '', fusion.alert_level || fusion.level || '', fusion.match_reasons || fusion.sources || '', JSON.stringify(fusion)]);
        inserted++;
      } catch (e) { skipped++; }
    }
    res.json({ success: true, count: inserted, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 自动预警 API ===== */
app.get('/api/auto-alerts', async (req, res) => {
  try {
    const result = await query('SELECT * FROM auto_alerts ORDER BY created_at DESC');
    res.json(result.rows.map(r => ({ ...r.data_json, _dbId: r.id })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/auto-alerts', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: '数据必须是数组' });
    await query('DELETE FROM auto_alerts');
    /* 2026-08-14 修复：前端整表回写时若数组内含重复 alert_id，
     * UNIQUE(alert_id) 约束会让整个 PUT 500，自动预警持久化长期失败。
     * 按 alert_id 去重 + 单行容错 + ON CONFLICT 兜底。 */
    const seen = new Set();
    let inserted = 0, skipped = 0;
    for (const alert of data) {
      const aid = String(alert.id || Date.now());
      if (seen.has(aid)) { skipped++; continue; }
      seen.add(aid);
      try {
        await query('INSERT INTO auto_alerts (alert_id, title, country, level, type, "desc", status, data_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (alert_id) DO NOTHING',
          [aid, alert.title||'', alert.country||'', alert.level||'', alert.type||'', alert.desc||'', alert.status||'active', JSON.stringify(alert)]);
        inserted++;
      } catch (e) { skipped++; }
    }
    res.json({ success: true, count: inserted, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 审计日志 API ===== */
app.get('/api/audit-logs', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const result = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json(result.rows.map(r => ({ ...r.data_json, _dbId: r.id, time: r.created_at })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/audit-logs', authMiddleware, async (req, res) => {
  try {
    const { action, target, detail } = req.body;
    await query('INSERT INTO audit_logs (action, operator, target, detail, data_json) VALUES ($1,$2,$3,$4,$5)',
      [action||'', req.user.username, target||'', detail||'', JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 航班与 AIS 数据代理 ===== */
function _httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

app.get('/api/flight/opensky', async (req, res) => {
  try {
    /* OpenSky Network 免费 API：全球航班状态向量 */
    const url = 'https://opensky-network.org/api/states/all';
    const data = await _httpsGetJson(url);
    res.json(data);
  } catch (err) {
    console.warn('[API /flight/opensky] 失败:', err.message);
    res.status(503).json({ ok: false, error: 'OpenSky 服务暂不可用', states: [] });
  }
});

app.get('/api/ais/all', async (req, res) => {
  try {
    /* 公开 AIS 数据源受访问限制，先尝试 VesselFinder 免费层（无稳定开放接口）
     * 此处作为通道预留：真实环境可接入 AISHub/MarineTraffic API key */
    const vessels = [];
    /* 若有 MARINETRAFFIC_KEY 则调用；否则返回空并提示 */
    const key = process.env.MARINETRAFFIC_KEY || '';
    if (key) {
      const url = 'https://services.marinetraffic.com/api/exportvessels/v:8/protocol:json/' + encodeURIComponent(key) + '/timespan:10';
      try {
        const data = await _httpsGetJson(url);
        if (Array.isArray(data)) {
          data.slice(0, 200).forEach(v => {
            vessels.push({
              mmsi: v.MMSI, name: v.SHIPNAME, lat: parseFloat(v.LAT), lon: parseFloat(v.LON),
              speed: v.SPEED, heading: v.HEADING, type: v.TYPE, status: v.STATUS,
              fetchedAt: new Date().toISOString()
            });
          });
        }
      } catch (e) { console.warn('[API /ais/all] MarineTraffic 失败:', e.message); }
    }
    res.json(vessels);
  } catch (err) {
    console.warn('[API /ais/all] 失败:', err.message);
    res.status(503).json([]);
  }
});

/* ===== 威胁评估 API ===== */
app.get('/api/threat-assessments/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['assess','custom'].includes(type)) return res.status(400).json({ error: '无效类型' });
    const result = await query('SELECT data_json FROM threat_assessments WHERE assess_type = $1', [type]);
    res.json(result.rows.length > 0 ? result.rows[0].data_json : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/threat-assessments/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    if (!['assess','custom'].includes(type)) return res.status(400).json({ error: '无效类型' });
    await query('INSERT INTO threat_assessments (assess_type, data_json) VALUES ($1, $2) ON CONFLICT (assess_type) DO UPDATE SET data_json = $2', [type, JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 采集数据 API ===== */
app.get('/api/collected/:sourceType', async (req, res) => {
  try {
    const result = await query('SELECT * FROM collected_data WHERE source_type = $1 ORDER BY collect_time DESC', [req.params.sourceType]);
    res.json(result.rows.map(r => ({ ...r.data_json, _dbId: r.id })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/collected/:sourceType', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: '数据必须是数组' });
    await query('DELETE FROM collected_data WHERE source_type = $1', [req.params.sourceType]);
    for (const item of data) {
      await query('INSERT INTO collected_data (source_type, title, url, content, country, data_json) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.sourceType, item.title||'', item.url||'', item.content||'', item.country||'', JSON.stringify(item)]);
    }
    res.json({ success: true, count: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 用户设置 API ===== */
app.get('/api/settings/:key', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT setting_val FROM user_settings WHERE user_id = $1 AND setting_key = $2', [req.user.id, req.params.key]);
    res.json(result.rows.length > 0 ? result.rows[0].setting_val : null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings/:key', authMiddleware, async (req, res) => {
  try {
    await query('INSERT INTO user_settings (user_id, setting_key, setting_val) VALUES ($1, $2, $3) ON CONFLICT (user_id, setting_key) DO UPDATE SET setting_val = $3',
      [req.user.id, req.params.key, JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ===== 自动采集引擎（7×24 持续运转：深度检索 + 社交媒体） =====
 * 定时自动执行特种兵采集，结果统一合并写入 osint_intel 公开缓存，
 * 供首页实时情报流 /api/intel/public/osint_intel 自动消费。
 * 铁律：只采集真实数据；采集结果自动 approved 并写入公开缓存。
 * 调度：深度检索每 1 分钟 / 社交通道每 1 分钟，确保数据实时流转。
 */
const AUTO_ENGINE = {
  _running: false,
  _lastRun: null,
  _lastResult: null,
  _stats: { crawlRuns: 0, socialRuns: 0, totalFetched: 0, totalLinked: 0, errors: 0 },
  _timers: [],
  _crawlBusy: false,
  _socialBusy: false,

  async _runCrawl() {
    if (this._crawlBusy) return;
    this._crawlBusy = true;
    const tag = '[AUTO-ENGINE crawlAll]';
    try {
      console.log(tag, 'starting...');
      const t0 = Date.now();
      const items = await crawler.crawlAll();
      /* 补充实体关联（crawlAll 内部 normalizeItem 但不 enrich） */
      items.forEach(function(it) {
        try { ENTITY.enrich(it); } catch (e) {}
        it.audit_status = 'approved'; /* 自动审核：系统采集即通过 */
        it.verified = false;
        it._auto = true;
      });
      /* 正文深度补全：只对与我海外利益关联的条目回源抓全文（省时且不做无用功） */
      const ftTargets = items.filter(function(it) { return it.interestLinked; });
      let ftStat = null;
      try {
        ftStat = await fulltext.enrichBatch(ftTargets, {
          resolveUrl: crawler.resolveUrl, concurrency: 5, budgetMs: 120000, minLen: 200
        });
        console.log(tag, 'fulltext:', JSON.stringify(ftStat));
      } catch (e) { console.warn(tag, 'fulltext failed:', e && e.message); }
      const linked = ftTargets.length;
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(tag, 'done in', sec + 's | fetched=' + items.length + ' linked=' + linked);
      await this._mergeToCache(items, 'crawlAll');
      this._stats.crawlRuns++;
      this._stats.totalFetched += items.length;
      this._stats.totalLinked += linked;
      this._lastRun = new Date().toISOString();
      this._lastResult = { type: 'crawlAll', count: items.length, linked: linked, sec: sec, fulltext: ftStat };
    } catch (e) {
      console.error(tag, 'ERROR:', e && e.message);
      this._stats.errors++;
    } finally {
      this._crawlBusy = false;
    }
  },

  async _runSocial() {
    if (this._socialBusy) return;
    this._socialBusy = true;
    const tag = '[AUTO-ENGINE collectSocial]';
    try {
      console.log(tag, 'starting...');
      const t0 = Date.now();
      const r = await social.collectSocial({ limit: 20, perChannel: 20 });
      const items = (r && r.items) || [];
      /* SOCMINT 结果统一格式化为 osint_intel 兼容结构 */
      const normalized = items.map(function(it) {
        return {
          title: it.title || it.rawTitle || '(无标题)',
          content: it.content || '',
          country: it.country || '',
          source: it.source || '社交媒体情报',
          severity: it.severity || '中',
          url: it.url || '',
          /* 时间字段必须透传：social.collectSocial 归一化后带 publishedAt/pubDate，
           * 漏掉会导致 FORECAST 预测引擎把社交情报当"时间未知"退化为45天前，
           * 系统性压低动量、造出"全体降温"假象。 */
          publishedAt: it.publishedAt || it.pubDate || '',
          pubDate: it.pubDate || it.publishedAt || '',
          /* 社交帖子正文多为转述/评论，原文外链才是细节所在，透传给正文引擎 */
          ext_url: it.extUrl || it.ext_url || '',
          category: it.category || 'osint_intel',
          data_type: it.data_type || 'osint_intel',
          platform: '社交媒体情报',
          chinaNegative: !!it.chinaNegative,
          chinaRelated: !!it.chinaRelated,
          rel_enterprises: it.rel_enterprises || [],
          rel_projects: it.rel_projects || [],
          rel_assets: it.rel_assets || [],
          riskScore: it.riskScore || 0,
          alertLevel: it.alertLevel || '蓝色',
          ruleHits: it.ruleHits || [],
          riskRationale: it.riskRationale || '',
          interestLinked: !!it.interestLinked,
          audit_status: 'approved', /* 自动审核：系统采集即通过 */
          verified: false,
          _auto: true,
          _social: true,
          _sourceType: 'socmint_watch' /* 2026-08-29：社交单源弱信号，纳入核心优先豁免（6h 印证窗口对单源社交帖过严） */
        };
      });
      /* 正文深度补全：社交条目优先抓 ext_url 原文外链，无外链的直接跳过（不抓评论区） */
      const ftTargets = normalized.filter(function(it) { return it.interestLinked; });
      let ftStat = null;
      try {
        ftStat = await fulltext.enrichBatch(ftTargets, {
          resolveUrl: crawler.resolveUrl, concurrency: 4, budgetMs: 90000, minLen: 200
        });
        console.log(tag, 'fulltext:', JSON.stringify(ftStat));
      } catch (e) { console.warn(tag, 'fulltext failed:', e && e.message); }
      const linked = ftTargets.length;
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(tag, 'done in', sec + 's | fetched=' + normalized.length + ' linked=' + linked);
      await this._mergeToCache(normalized, 'collectSocial');
      /* 2026-08-29 用户指令：社交媒体监测数据大量入库并进预警中心。
       * 根因：此前每轮 ~100 条只写文件缓存（_mergePublicCache），
       * PostgreSQL intel_data 里没有，预警生成器（_serverAlertGen 读 DB）永远看不到。
       * 现在走 _ingestLinkedItems 既有闸门入库（24h 时效 / URL / 标题 / 事件签名
       * 去重 / 国内噪声拦截全部生效），入库后 SRV- 预警自动生成。 */
      try {
        const r2 = await _ingestLinkedItems(normalized, 'SOCMINT-WATCH', '（社交媒体监测 ' + normalized.length + ' 条）');
        console.log(tag, 'ingest:', JSON.stringify(r2));
      } catch (e) { console.warn(tag, 'ingest failed:', e && e.message); }
      this._stats.socialRuns++;
      this._stats.totalFetched += normalized.length;
      this._stats.totalLinked += linked;
      this._lastRun = new Date().toISOString();
      this._lastResult = { type: 'collectSocial', count: normalized.length, linked: linked, sec: sec, fulltext: ftStat };
    } catch (e) {
      console.error(tag, 'ERROR:', e && e.message);
      this._stats.errors++;
    } finally {
      this._socialBusy = false;
    }
  },

  async _mergeToCache(items, sourceTag) {
    if (!items || !items.length) return;
    /* 铁律：只保留与我海外利益安全直接关联的数据写入公开缓存，
     * 杜绝无关外国新闻（如美国油轮遇袭、意大利地震等）污染首页实时情报流 */
    var linkedOnly = items.filter(function(it) { return it.interestLinked; });
    /* 新鲜度闸门：陈旧条目（> MAX_AGE_DAYS 天，有时间戳可判定者）不入库，避免非实时数据反复滞留 */
    var before = linkedOnly.length;
    linkedOnly = linkedOnly.filter(function(it) { return _isFresh(it); });
    if (linkedOnly.length < before) console.log('[AUTO-ENGINE] 新鲜度闸门剔除', before - linkedOnly.length, '条陈旧情报 from', sourceTag);
    /* 导航噪声闸门：剔除爬虫命中官网首页产生的"下载中心/个人客户"等非情报条目 */
    var beforeNav = linkedOnly.length;
    linkedOnly = linkedOnly.filter(function(it) { return !_isNavNoise(it); });
    if (linkedOnly.length < beforeNav) console.log('[AUTO-ENGINE] 导航噪声闸门剔除', beforeNav - linkedOnly.length, '条非情报页 from', sourceTag);
    /* 实战系统要求：采集入库即译为中文，落库数据全中文（原文留 title_en/content_en 溯源） */
    await _translateListToZh(linkedOnly);
    if (!linkedOnly.length) {
      console.log('[AUTO-ENGINE] skipped', items.length, 'from', sourceTag, '(zero interestLinked)');
      return;
    }
    /* 规范预警编号：CN-{类型码}-{YYYYMMDD}-{4位哈希}，替代无意义的标题 slug */
    linkedOnly.forEach(function(it) {
      if (!it.alert_no) { try { it.alert_no = fulltext.makeAlertNo(it); } catch (e) {} }
    });
    /* 统一走增量合并入库口径（旧数据优先保留，新数据去重追加），与手动采集端点完全一致 */
    var r = _mergePublicCache('osint_intel', linkedOnly);
    console.log('[AUTO-ENGINE] merged', r.added, '/' + items.length, 'from', sourceTag, '→ cache now', r.total);
  },

  status() {
    return {
      running: this._running,
      lastRun: this._lastRun,
      lastResult: this._lastResult,
      stats: this._stats,
      nextCrawlIn: this._running ? '~1 min' : 'stopped',
      nextSocialIn: this._running ? '~1 min' : 'stopped'
    };
  },

  start() {
    if (this._running) return;
    this._running = true;
    console.log('[AUTO-ENGINE] 自动采集引擎启动 | 深度检索每1分钟 / 社交通道每1分钟');
    /* 启动后 10 秒开始第一次采集，快速进数据 */
    setTimeout(() => { this._runCrawl(); }, 10000);
    setTimeout(() => { this._runSocial(); }, 20000);
    /* 定时循环 */
    this._timers.push(setInterval(() => { this._runCrawl(); }, 60 * 1000));
    this._timers.push(setInterval(() => { this._runSocial(); }, 60 * 1000));
  },

  stop() {
    this._running = false;
    this._timers.forEach(function(t) { clearInterval(t); });
    this._timers = [];
    console.log('[AUTO-ENGINE] 自动采集引擎已停止');
  }
};

/* 自动采集引擎状态端点 */
app.get('/api/engine/status', (req, res) => {
  try { res.json({ ok: true, engine: AUTO_ENGINE.status() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});
/* 手动触发采集（管理员） */
app.post('/api/engine/trigger', async (req, res) => {
  try {
    const type = String(req.body && req.body.type || 'crawl');
    if (type === 'social') { await AUTO_ENGINE._runSocial(); }
    else { await AUTO_ENGINE._runCrawl(); }
    res.json({ ok: true, engine: AUTO_ENGINE.status() });
  } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
});

/* ===== 存量情报正文回填 =====
 * 对已在公开缓存中、但只有一句话概述的历史条目，回源抓取原文正文 +
 * 抽取结构化要素 + 补发规范预警编号。
 * 抓不到就原样保留（保留原摘要），绝不编造任何内容。
 */
let _enrichBusy = false;
async function _handleIntelEnrich(req, res) {
  if (_enrichBusy) return res.status(429).json({ ok: false, error: '回填任务进行中，请稍候' });
  _enrichBusy = true;
  const t0 = Date.now();
  try {
    const type = String((req.body && req.body.type) || 'osint_intel');
    const limit = Math.min(200, Math.max(1, parseInt((req.body && req.body.limit) || 60, 10)));
    const all = _readPublicCache(type);
    if (!all.length) { _enrichBusy = false; return res.json({ ok: true, total: 0, note: '缓存为空' }); }
    /* 只挑「内容过短 / 内容等于标题 / 尚无 factSheet」的条目回填 */
    const targets = all.filter(function(it) {
      const c = String(it.content || '');
      return !it.factSheet && (c.length < 400 || c === it.title || !!it._ftPending);
    }).slice(0, limit);
    const stat = await fulltext.enrichBatch(targets, {
      resolveUrl: crawler.resolveUrl, concurrency: 5, budgetMs: 150000, minLen: 400
    });
    /* 统一补发规范预警编号 */
    let noStamped = 0;
    all.forEach(function(it) {
      if (!it.alert_no) { try { it.alert_no = fulltext.makeAlertNo(it); noStamped++; } catch (e) {} }
    });
    _writePublicCache(type, all);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('[ENRICH] type=' + type + ' scanned=' + all.length + ' targets=' + targets.length +
                ' ' + JSON.stringify(stat) + ' alertNo+' + noStamped + ' in ' + sec + 's');
    res.json({ ok: true, total: all.length, targets: targets.length, alertNoStamped: noStamped, stat: stat, sec: sec });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  } finally { _enrichBusy = false; }
}

/* ===== 进程自愈：单条未捕获异常/拒绝绝不让进程退出（避免整站被打不开） ===== */
process.on('uncaughtException', (err) => { console.error('[GUARD] uncaughtException:', err && err.message); });
process.on('unhandledRejection', (reason) => { console.error('[GUARD] unhandledRejection:', reason && (reason.message || reason)); });

/* ===== 启动服务器 ===== */
/* 启动自净：对存量缓存做「导航噪声剔除 + 稳定键去重」。
 * 背景：早期去重以译文标题为键，同一条外媒情报经不同翻译通道得到不同措辞
 *（如"对等制裁"/"相互制裁"）会重复入库，污染态势热度；另有爬虫命中机构官网
 * 首页把"下载中心/个人客户"等导航页当情报收录。二者对实战研判均为噪声。 */
function _selfCleanCache() {
  ['osint_intel', 'socmint_intel'].forEach(function(type) {
    var arr = _readCacheRaw(type);   // 读原始文件，才能把评论/论述类脏数据真正从磁盘剔除
    if (!Array.isArray(arr) || !arr.length) return;
    var seen = {}, kept = [], dupN = 0, navN = 0, ctyN = 0, oldN = 0, rankN = 0, unlinkN = 0;
    arr.forEach(function(it) {
      if (!it || typeof it !== 'object') { navN++; return; }
      if (_isNavNoise(it)) { navN++; return; }
      /* 铁律③：体裁闸门——存量缓存里可能未打体裁标记（旧版入库时闸门尚未上线），
       * 逐条重新判定：意识形态评论/学术论述 + 商业榜单/经济统计，一票否决绝不入库。
       * 商业榜单尤其危险：因罗列中资巨头而 hardLink=true，会绕过风险分门槛，必须在此拦下。 */
      var genre = '';
      if (it._ranking) genre = 'ranking-list';
      else if (it._commentary) genre = 'commentary-piece';
      if (!genre && typeof ENTITY !== 'undefined') {
        try {
          if (typeof ENTITY.nonIntelGenre === 'function') genre = ENTITY.nonIntelGenre(it) || '';
          else if (typeof ENTITY.isCommentaryPiece === 'function' && ENTITY.isCommentaryPiece(it)) genre = 'commentary-piece';
        } catch (e) {}
      }
      if (genre) {
        it._genreNoise = true;
        if (genre === 'ranking-list') { it._ranking = true; rankN++; }
        else { it._commentary = true; ctyN++; }
        return;
      }
      if (!it.interestLinked) { unlinkN++; return; }  // 非关联我海外利益的数据剔除
      if (!_isFresh(it)) { oldN++; return; }          // 陈旧情报剔除
      var k = _dedupKey(it);
      if (!k || seen[k]) { dupN++; return; }
      seen[k] = 1;
      kept.push(it);
    });
    if (dupN || navN || ctyN || oldN || rankN || unlinkN) {
      _writePublicCache(type, kept);
      console.log('[SELF-CLEAN] ' + type + ' 剔除重复 ' + dupN + '、导航噪声 ' + navN
        + '、评论/论述 ' + ctyN + '、商业榜单 ' + rankN + '、未关联 ' + unlinkN
        + '、陈旧 ' + oldN + ' 条，保留 ' + kept.length + ' 条');
    } else {
      console.log('[SELF-CLEAN] ' + type + ' 无需清理，' + kept.length + ' 条');
    }
  });
}

const _server = app.listen(PORT, async () => {
  console.log('========================================');
  console.log('  海外利益保护情报预警平台 - 后端服务');
  console.log('  版本: 2.0.0 (PostgreSQL)');
  console.log('  端口: ' + PORT);
  console.log('  环境: ' + (process.env.NODE_ENV || 'development'));
  console.log('========================================');
  await testConnection();
  /* 存量缓存自净（去重 + 去导航噪声） */
  try { _selfCleanCache(); } catch (e) { console.warn('[SELF-CLEAN] 失败:', e.message); }
  /* 启动自动采集引擎（30秒后首次执行） */
  AUTO_ENGINE.start();
  /* 启动全球多国媒体真实情报采集（20秒后首跑；直连 RSS 真实数据快速进缓存） */
  startGlobalMediaCron();
});
/* 端口被占用时必须立刻退出：
 * 上面的 uncaughtException 守卫会吞掉 EADDRINUSE，导致每次重启都残留一个
 * "起不来又不退出"的僵尸进程（实测曾堆积 6 个）。这里显式处理并退出。 */
_server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('[FATAL] 端口 ' + PORT + ' 已被占用，本实例退出（请先停止旧进程）。');
    process.exit(1);
  }
  console.error('[FATAL] 服务器监听失败:', err && err.message);
  process.exit(1);
});

/* ===== 实时情报生成器（已停用 · 实战模式零模拟数据） =====
 * 原实现以模板国家/事件/企业 + Math.random() 每30秒合成 [实时] 假预警并写入
 * 数据库(approved)、经 SSE 广播。该行为违反"实战模式：系统只跑真实抓取管线"
 * 铁律，已于 2026-07-30 整体禁用。真实预警唯一来源：数据中心审核分发链路
 * （/api/crawl、/api/scrape 真实抓取 → 数据中心 pending → 审核通过 → 分发）。
 * broadcastIntel 仅保留为合法通道，待真实审核通过的情报经 SSE 推送时调用。 */
function generateLiveIntel() { /* 实战模式：不再生成任何模拟预警 */ }
/* 原 setTimeout(generateLiveIntel, 3000) / setInterval(generateLiveIntel, 30000) 已移除 */
