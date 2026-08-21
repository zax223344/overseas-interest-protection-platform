/* ===== 微信公众号文章实时采集器（2026-08-21 用户指令：部署为系统数据源）=====
 * 依据用户提供的「微信公众平台扫码登录采集方案」材料实现：
 *   扫码登录(wechat-login.js) → searchbiz 搜号拿 fakeid → cgi-bin/appmsg?action=list_ex 拉文章列表
 *   → 抓文章正文(#js_content) → 按 aid 增量去重 → 规范化条目交给 server.js 入库链路。
 *
 * 零模拟铁律：全部条目来自微信公众平台真实接口；会话失效/风控/无新文章一律返回空并如实记录，
 *             绝不生成任何替代内容。
 * 风控自律：
 *   - 单轮每号最多 PER_ACCOUNT 篇；正文抓取每轮预算 BODY_BUDGET 篇；
 *   - 接口间隔随机 2~5s，正文间隔 1~3s；
 *   - ret=200013(操作频繁) → 全局冷却 30 分钟；会话类错误 → 标记 needLogin，等重新扫码；
 *   - 直连国内站点，不走代理（除非 WECHAT_PROXY 显式指定）。
 *
 * 对外接口：
 *   collect()            → { items:[], stats:{}, session:{logged,needLogin,message} }
 *   status()             → 会话/账号/增量状态快照（供 /api/wechat/status）
 *   listAccounts()       → 监测账号清单（server/wechat-accounts.json）
 *   addAccount(name) / removeAccount(name)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE_DIR = path.join(__dirname, '.cache');
const SESSION_FILE = path.join(CACHE_DIR, 'wechat-session.json');
const INCR_FILE = path.join(CACHE_DIR, 'wechat-oa-state.json');
const ACCOUNTS_FILE = path.join(__dirname, 'wechat-accounts.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PER_ACCOUNT = 5;          // 每轮每号拉取条数（与材料一致：count=5）
const BODY_BUDGET = 8;          // 每轮正文抓取预算（正文页是风控重灾区，省着用）
const FREQ_COOLDOWN_MS = 30 * 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 864e5;   // 会话超过 7 天视为可疑，强制重新扫码

let _freqCoolUntil = 0;         // 模块级风控冷却（微信 200013 / 搜狗 antispider 共用）

/* ---------- 会话与配置 ---------- */
function loadSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!s || !s.token || !s.storageState) return null;
    if (Date.now() - Date.parse(s.savedAt || 0) > SESSION_MAX_AGE_MS) return null;
    return s;
  } catch (e) { return null; }
}
function _cookieHeader(session) {
  const cookies = (session.storageState && session.storageState.cookies) || [];
  return cookies
    .filter(c => /weixin\.qq\.com$|\.qq\.com$/.test(c.domain || ''))
    .map(c => c.name + '=' + c.value)
    .join('; ');
}
function _loadIncr() {
  try { return JSON.parse(fs.readFileSync(INCR_FILE, 'utf8')); } catch (e) { return {}; }
}
function _saveIncr(st) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(INCR_FILE, JSON.stringify(st));
  } catch (e) {}
}

/* ---------- 监测账号清单（server/wechat-accounts.json，可在系统面板里增删）----------
 * 2026-08-22 用户指定：删除原 10 个官方号，换成 20 个开源情报/安全核心号。
 * 顺序即优先级：每轮只采前 BATCH_SIZE 个，下轮从偏移处续采，以此循环轮巡。
 * 只采清单内账号，清单外的一律不采。 */
const BATCH_SIZE = 10;          // 每轮采集账号数（用户铁律：先采前10，再采其他，循环）
const DEFAULT_ACCOUNTS = [
  /* —— 第一批（用户指定优先级顺序；Cyber猎人笔记原单重复，按 20 清单顺序补 GMEE）—— */
  'AITD蚂蚁啃骨头', '鼎泰安元安全风险管理专家', '龙兴智策经纬', 'Cyber猎人笔记',
  '反恐态势感知', '刺猬安全出海', '中安华盾订阅号', '全球开源情报共享',
  '哈勃纵横', 'GMEE大中东之眼',
  /* —— 第二批 —— */
  '安库APP', '百灵猫开源情报分析师', '海事无盗', '尼日利亚华人网', '缅甸中文网',
  '华语安全简讯', '国际安保瞭望', '郑和号', '蜜都小天使', '四海巡者'
];
function listAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (Array.isArray(arr)) return arr.filter(x => x && typeof x === 'string');
    }
  } catch (e) {}
  return DEFAULT_ACCOUNTS.slice();
}
function _saveAccounts(arr) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(arr, null, 2));
}
function addAccount(name) {
  name = String(name || '').trim();
  if (!name || name.length > 40) return { ok: false, error: '账号名不能为空且不超过40字' };
  const arr = listAccounts();
  if (arr.includes(name)) return { ok: false, error: '该账号已在监测清单中' };
  if (arr.length >= 50) return { ok: false, error: '监测账号已达上限50个' };
  arr.push(name);
  _saveAccounts(arr);
  return { ok: true, accounts: arr };
}
function removeAccount(name) {
  const arr = listAccounts().filter(x => x !== name);
  _saveAccounts(arr);
  return { ok: true, accounts: arr };
}

/* ---------- HTTP（直连，国内站） ---------- */
let _agent = null;
if (process.env.WECHAT_PROXY) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    _agent = new HttpsProxyAgent(process.env.WECHAT_PROXY);
  } catch (e) { _agent = null; }
}
function _httpGet(url, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let req;
    try {
      const u = new URL(url);
      req = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        timeout: opts.timeout || 15000,
        /* 2026-08-22 实测：本机默认连接路径（Happy Eyeballs）对 sogou/mp.weixin 必超时，
         * 强制 IPv4 后立即 200。dns.lookup 只返回 IPv4 地址，默认路径仍挂起，原因未明，
         * 但 family:4 稳定复现成功——国内站全走 IPv4 无副作用。 */
        family: 4,
        agent: _agent || undefined,
        headers: Object.assign({
          'User-Agent': UA,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Referer': 'https://mp.weixin.qq.com/'
        }, opts.headers || {})
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers || {} }));
      });
      req.on('error', () => resolve({ status: 0, body: '', headers: {} }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', headers: {} }); });
      req.end();
    } catch (e) { resolve({ status: 0, body: '', headers: {} }); }
  });
}
const _sleep = ms => new Promise(r => setTimeout(r, ms));
const _jitter = (a, b) => a + Math.random() * (b - a);

/* ---------- 微信公众平台接口 ---------- */
/* ret 语义：0 正常；200013 操作频繁（风控）；200002/200040 等参数或会话类错误。
 * 返回 {ret, json}，调用方按 ret 决策。 */
async function _apiGet(session, apiPath, params) {
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const url = 'https://mp.weixin.qq.com/cgi-bin/' + apiPath + (qs ? '&' + qs : '');
  const r = await _httpGet(url, { headers: { 'Cookie': _cookieHeader(session), 'X-Requested-With': 'XMLHttpRequest' } });
  if (!r.body) return { ret: -1, json: null };
  try {
    const j = JSON.parse(r.body);
    const ret = j && j.base_resp ? (j.base_resp.ret | 0) : -2;
    return { ret, json: j };
  } catch (e) { return { ret: -2, json: null }; }
}

/* searchbiz：按名称搜公众号 → fakeid。返回 null=未找到 / false=接口异常 */
async function searchAccount(session, name) {
  const r = await _apiGet(session, 'searchbiz?action=search_biz&begin=0&count=5&lang=zh_CN&f=json&ajax=1', {
    token: session.token, query: name
  });
  if (r.ret !== 0 || !r.json) return { error: r.ret };
  const list = r.json.list || [];
  if (!list.length) return null;
  /* 精确昵称优先，其次首个结果 */
  const hit = list.find(x => x.nickname === name) || list[0];
  return { fakeid: hit.fakeid, nickname: hit.nickname, alias: hit.alias || '', signature: hit.signature || '' };
}

/* appmsg list_ex：拉公众号图文列表（与材料一致 count=5、type=9） */
async function fetchArticleList(session, fakeid, count) {
  const r = await _apiGet(session, 'appmsg?action=list_ex&begin=0&type=9&query=&lang=zh_CN&f=json&ajax=1', {
    token: session.token, count: count || PER_ACCOUNT, fakeid: fakeid
  });
  if (r.ret !== 0 || !r.json) return { error: r.ret };
  return { list: r.json.app_msg_list || [], total: r.json.app_msg_cnt | 0 };
}

/* 文章正文：公开页面，无需登录态；反爬触发时返回空串（降级用摘要，绝不编造） */
function _stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
async function fetchArticleBody(link) {
  const r = await _httpGet(link, { timeout: 12000 });
  if (!r.body) return '';
  if (/环境异常|去验证|访问过于频繁/.test(r.body)) return '';   // 触发反爬：如实放弃，下轮再说
  const m = r.body.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]*(?:id="js_sponsor|class="rich_media_tool))/i)
        || r.body.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return '';
  return _stripHtml(m[1]).slice(0, 8000);
}

/* ===== 免登录通道：搜狗微信检索（2026-08-22）=====
 * 背景：扫码登录 mp.weixin.qq.com 需要微信号注册过公众号（订阅号/服务号），
 *       未注册的微信扫码会提示"没有可登录帐号"。搜狗微信搜索是全公开接口，无需登录。
 * 链路（本机 2026-08-22 实测通过）：
 *   ① GET weixin.sogou.com/ 拿 cookie（SNUID 等，不带 cookie 直接触发 antispider）
 *   ② GET /weixin?type=2&query={账号名}（带 cookie+Referer）→ 结果块：
 *      <h3><a href="/link?url=...">标题</a></h3> / <p class="txt-info">摘要</p>
 *      / <div class="s-p"><span>公众号名</span><span>timeConvert('时间戳')</span>
 *   ③ GET /link?url=...（带 cookie）→ JS 页 `url += '...'` 碎片拼出签名文章 URL
 *   ④ 抓文章页：正文 #js_content + var ct=发布时间 + var biz/mid/idx/sn 拼规范链接
 * 风控：搜狗的 antispider 对高频敏感——账号间 3~6s 随机间隔，触发即冷却 30 分钟。
 * 诚实原则：签名 URL 约 24 小时过期；规范链接(biz+mid+idx+sn)能拼出来就用规范的，
 *           拼不出来用签名链接并标记 _signedUrl:true；跨渠道重复靠系统标题去重闸。 */
const SOGOU_HOME = 'https://weixin.sogou.com/';
let _sogou = { cookies: '', at: 0 };
async function _sogouEnsureCookies(force) {
  if (!force && _sogou.cookies && Date.now() - _sogou.at < 30 * 60 * 1000) return _sogou.cookies;
  /* 本机 DNS 偶发抖动（2026-08-22 实测），失败重试一次 */
  for (let i = 0; i < 2; i++) {
    const r = await _httpGet(SOGOU_HOME, { timeout: 10000, headers: { 'Referer': 'https://www.sogou.com/' } });
    const setC = r.headers['set-cookie'] || [];
    const pairs = setC.map(c => String(c).split(';')[0]).filter(s => s.includes('='));
    if (pairs.length) {
      _sogou = { cookies: pairs.join('; '), at: Date.now() };
      return _sogou.cookies;
    }
    await _sleep(1500);
  }
  return '';
}
function _sogouParseList(html) {
  const out = [];
  const blocks = html.match(/<div class="txt-box">[\s\S]*?<\/li>/g) || [];
  for (const b of blocks) {
    const m = b.match(/<h3>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const href = m[1].replace(/&amp;/g, '&');
    const title = _stripHtml(m[2].replace(/<!--red_beg-->|<!--red_end-->/g, ''));
    const dg = b.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/);
    const digest = dg ? _stripHtml(dg[1].replace(/<!--red_beg-->|<!--red_end-->/g, '')) : '';
    const sp = b.match(/<div class="s-p">([\s\S]*?)<\/div>/);
    let account = '', ts = 0;
    if (sp) {
      const am = sp[1].match(/<span[^>]*>([\s\S]*?)<\/span>/);
      if (am) account = _stripHtml(am[1]);
      const tm = sp[1].match(/timeConvert\('?(\d{10})'?\)/) || sp[1].match(/t="(\d{10})"/);
      if (tm) ts = parseInt(tm[1], 10) * 1000;
    }
    if (title && href) out.push({ title, href, digest, account, ts });
  }
  return out;
}
async function _sogouSearch(name) {
  const cookies = await _sogouEnsureCookies();
  if (!cookies) return { error: 'sogou-cookie-fail' };
  /* 注意（2026-08-22 实测）：tsn 时间过滤参数会 302 回首页（需浏览器 JS 种 cookie），不可用；
   * 基线检索按相关度排序会混入旧文——靠逐条 ts 时间戳 + 45 天新鲜度预过滤 + 标题增量去重控制。 */
  const url = 'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name);
  const r = await _httpGet(url, { timeout: 12000, headers: { 'Cookie': cookies, 'Referer': SOGOU_HOME } });
  if (!r.body) return { error: 'sogou-unreachable' };
  if (/antispider|请输入验证码|用户您好，我们的系统检测到您网络中存在异常访问请求/.test(r.body)) return { antispider: true };
  return { list: _sogouParseList(r.body) };
}
async function _sogouResolve(href) {
  const url = href.startsWith('http') ? href : 'https://weixin.sogou.com' + href;
  const r = await _httpGet(url, { timeout: 12000, headers: { 'Cookie': _sogou.cookies, 'Referer': SOGOU_HOME } });
  if (!r.body) return { error: 'resolve-fail' };
  if (/antispider|请输入验证码/.test(r.body)) return { antispider: true };
  const parts = [];
  const re = /url \+= '([^']*)'/g;
  let m;
  while ((m = re.exec(r.body))) parts.push(m[1]);
  const real = parts.join('').replace(/@/g, '');
  if (!real.startsWith('http')) return { error: 'resolve-empty' };
  return { url: real };
}
/* 文章页全量提取：正文 + 发布时间(ct) + 规范链接参数(biz/mid/idx/sn) + 公众号昵称 */
async function _fetchArticleFull(url) {
  const r = await _httpGet(url, { timeout: 12000 });
  if (!r.body) return {};
  if (/环境异常|去验证|访问过于频繁/.test(r.body)) return { blocked: true };
  const g = (re) => { const m = r.body.match(re); return m ? m[1] : ''; };
  const bodyM = r.body.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]*(?:id="js_sponsor|class="rich_media_tool))/i)
            || r.body.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>/i);
  const biz = g(/var biz = "([^"]*)"/), mid = g(/var mid = "([^"]*)"/),
        idx = g(/var idx = "([^"]*)"/), sn = g(/var sn = "([^"]*)"/);
  const ct = g(/var ct = "(\d+)"/);
  const nickname = g(/var nickname = "([^"]*)"/);
  let canonical = '';
  if (biz && mid) canonical = 'https://mp.weixin.qq.com/s?__biz=' + encodeURIComponent(biz) + '&mid=' + mid + '&idx=' + (idx || '1') + '&sn=' + encodeURIComponent(sn || '');
  return {
    body: bodyM ? _stripHtml(bodyM[1]).slice(0, 8000) : '',
    ct: ct ? parseInt(ct, 10) * 1000 : 0,
    nickname,
    canonical: sn ? canonical : ''   /* sn 缺失时规范链接打不开，宁可用签名链接 */
  };
}
const _titleKey = t => String(t || '').replace(/\s+/g, '').slice(0, 50);

/* 免登录采集：搜狗微信检索通道 */
async function collectViaSearch(accounts, opts) {
  opts = opts || {};
  const stats = { channel: 'sogou-search', accounts: 0, accountsOk: 0, fetched: 0, fresh: 0, bodyOk: 0, skippedOld: 0, errors: [] };
  const items = [];
  const incr = _loadIncr();
  let bodyBudget = opts.bodyBudget || BODY_BUDGET;
  let resolveBudget = 5;   /* 跳转解析最敏感：限 5 次/轮、4~8s 间隔（2026-08-22 实测 10 次/轮会触发 antispider） */
  for (const name of accounts) {
    stats.accounts++;
    if (Date.now() < _freqCoolUntil) { stats.errors.push('搜狗风控冷却中'); break; }
    if (resolveBudget <= 0) { stats.errors.push('本轮解析预算已用完，剩余账号下轮再采'); break; }
    try {
      const sr = await _sogouSearch(name);
      if (sr.antispider) {
        _freqCoolUntil = Date.now() + FREQ_COOLDOWN_MS;
        _sogou.cookies = '';   /* 旧 cookie 已被盯上，下轮换新 */
        stats.errors.push('搜狗反爬触发，冷却30分钟');
        break;
      }
      if (sr.error) { stats.errors.push(name + ': ' + sr.error); continue; }
      stats.accountsOk++;
      stats.fetched += sr.list.length;
      /* 45 天新鲜度预过滤（与系统 MAX_AGE_DAYS 一致），省下跳转/正文请求 */
      const freshList = sr.list.filter(x => !x.ts || (Date.now() - x.ts) <= 45 * 864e5);
      stats.skippedOld += sr.list.length - freshList.length;
      incr[name] = incr[name] || {};
      const seenT = incr[name].seenTitles || [];
      const news = freshList.filter(x => { const k = _titleKey(x.title); return k && !seenT.includes(k); });
      /* 最新优先：跳转解析是风控敏感步，有限的预算先给最新的文章 */
      news.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      stats.fresh += news.length;
      for (const it of news) {
        if (resolveBudget <= 0) break;
        await _sleep(_jitter(4000, 8000));   /* 跳转解析是搜狗风控重灾区，放慢 */
        const rv = await _sogouResolve(it.href);
        resolveBudget--;
        if (rv.antispider) {
          _freqCoolUntil = Date.now() + FREQ_COOLDOWN_MS;
          _sogou.cookies = '';
          stats.errors.push('搜狗反爬触发(跳转)，冷却30分钟');
          break;
        }
        if (rv.error) continue;
        /* 正文 + 规范链接（预算内才抓页面；预算外用搜狗摘要+签名链接，均为真实数据） */
        let body = '', ct = 0, nickname = '', canonical = '';
        if (bodyBudget > 0) {
          await _sleep(_jitter(1000, 3000));
          const full = await _fetchArticleFull(rv.url);
          bodyBudget--;
          if (!full.blocked) {
            body = full.body || '';
            ct = full.ct || 0;
            nickname = full.nickname || '';
            canonical = full.canonical || '';
            if (body) stats.bodyOk++;
          }
        }
        const ts = ct || it.ts || 0;
        items.push({
          title: it.title,
          url: canonical || rv.url,
          content: body || it.digest,
          digest: it.digest,
          source: '公众号·' + (nickname || it.account || name),
          date: ts ? new Date(ts).toISOString() : '',
          publishedAt: ts ? new Date(ts).toISOString() : '',
          data_type: 'osint_intel',
          category: '公众号监测',
          language: 'zh',
          severity: '中',
          interestLinked: true,
          _real: true,
          _fromSource: 'WECHAT_OA:SOGOU',
          _sourceType: 'wechat_oa',
          _viaSearch: true,
          _signedUrl: !canonical,
          _wechatAccount: nickname || it.account || name
        });
        seenT.push(_titleKey(it.title));
      }
      incr[name].seenTitles = seenT.slice(-200);
      incr[name].lastTime = Date.now();
      _saveIncr(incr);
      await _sleep(_jitter(3000, 6000));
    } catch (e) {
      stats.errors.push(name + ': ' + (e && e.message || e));
    }
  }
  _saveIncr(incr);
  return { items, stats };
}

/* ---------- 主采集入口 ---------- */
let _collecting = false;   /* 防重叠：server 端 90s 竞速超时后旧轮仍在跑，下轮直接跳过 */
async function collect(opts) {
  opts = opts || {};
  const stats = { accounts: 0, accountsOk: 0, fetched: 0, fresh: 0, bodyOk: 0, skippedOld: 0, errors: [] };
  const items = [];

  if (_collecting) {
    return { items, stats, session: { logged: !!loadSession(), needLogin: false, message: '上一轮仍在进行中，本轮跳过' } };
  }
  if (Date.now() < _freqCoolUntil) {
    return { items, stats, session: { logged: !!loadSession(), needLogin: false, message: '接口风控冷却中（至 ' + new Date(_freqCoolUntil).toLocaleTimeString('zh-CN') + '）' } };
  }
  _collecting = true;
  try {
    const r = await _collectInner(opts, items, stats);
    /* 入库回调：采集到真实条目即回调（即使调用方已超时放弃等待，数据也不丢） */
    if (r && r.items && r.items.length && typeof opts.onItems === 'function') {
      try { await opts.onItems(r.items, r.stats); } catch (e) { console.warn('[WECHAT-OA] onItems 回调异常:', e && e.message || e); }
    }
    return r;
  } finally {
    _collecting = false;
  }
}
async function _collectInner(opts, items, stats) {
  const session = loadSession();
  let accounts;
  if (opts.accounts && opts.accounts.length) {
    accounts = opts.accounts;   // 手动指定账号（调试用），不占用轮巡偏移
  } else {
    /* 轮巡分批（2026-08-22 用户铁律）：每轮只采 BATCH_SIZE 个账号，
     * 偏移存在增量状态文件里，下轮续采下一批，循环往复。 */
    const full = listAccounts();
    if (full.length <= BATCH_SIZE) {
      accounts = full;
    } else {
      const st0 = _loadIncr();
      const off = (st0._rotOffset | 0) % full.length;
      accounts = [];
      for (let i = 0; i < BATCH_SIZE; i++) accounts.push(full[(off + i) % full.length]);
      st0._rotOffset = (off + BATCH_SIZE) % full.length;
      _saveIncr(st0);
      stats.batch = '第' + (off + 1) + '-' + (off + accounts.length) + '号/共' + full.length + '号';
    }
  }
  if (!session) {
    /* 免登录降级通道（2026-08-22）：微信号未注册公众号时扫码登录不可用，
     * 自动改走搜狗微信公开检索——真实文章、真实时间、真实正文，一样入库。 */
    const r = await collectViaSearch(accounts, opts);
    r.session = { logged: false, needLogin: false, channel: 'sogou-search',
      message: '免登录通道（搜狗微信检索）。注册订阅号并扫码登录后可切换为全功能接口通道。' };
    return r;
  }
  const incr = _loadIncr();
  let bodyBudget = opts.bodyBudget || BODY_BUDGET;

  for (const name of accounts) {
    stats.accounts++;
    try {
      /* 1) 搜号（fakeid 带缓存，命中即跳过，省一次请求） */
      let acc = null;
      if (incr[name] && incr[name].fakeid) {
        acc = { fakeid: incr[name].fakeid, nickname: incr[name].nickname || name };
      } else {
        const s = await searchAccount(session, name);
        if (s && s.error !== undefined) {
          if (s.error === 200013) { _freqCoolUntil = Date.now() + FREQ_COOLDOWN_MS; stats.errors.push('风控:操作频繁,冷却30分钟'); break; }
          if (s.error === -2 || s.error === 200002 || s.error === 200014) {
            /* 会话失效 → 本轮降级到免登录通道，不中断采集 */
            const fb = await collectViaSearch(accounts.slice(stats.accounts - 1), opts);
            fb.session = { logged: false, needLogin: false, channel: 'sogou-search',
              message: '登录会话已失效（ret=' + s.error + '），本轮已降级为免登录通道；重新扫码可恢复全功能通道' };
            return fb;
          }
          stats.errors.push(name + ': searchbiz ret=' + s.error);
          continue;
        }
        if (!s) { stats.errors.push(name + ': 未搜到该公众号'); continue; }
        acc = s;
      }
      incr[name] = incr[name] || {};
      incr[name].fakeid = acc.fakeid;
      incr[name].nickname = acc.nickname;
      await _sleep(_jitter(2000, 5000));

      /* 2) 拉文章列表 */
      const lr = await fetchArticleList(session, acc.fakeid, PER_ACCOUNT);
      if (lr.error !== undefined) {
        if (lr.error === 200013) { _freqCoolUntil = Date.now() + FREQ_COOLDOWN_MS; stats.errors.push('风控:操作频繁,冷却30分钟'); break; }
        if (lr.error === -2 || lr.error === 200002 || lr.error === 200014) {
          const fb = await collectViaSearch(accounts.slice(stats.accounts - 1), opts);
          fb.session = { logged: false, needLogin: false, channel: 'sogou-search',
            message: '登录会话已失效（ret=' + lr.error + '），本轮已降级为免登录通道；重新扫码可恢复全功能通道' };
          return fb;
        }
        stats.errors.push(acc.nickname + ': list_ex ret=' + lr.error);
        continue;
      }
      stats.accountsOk++;
      stats.fetched += lr.list.length;

      /* 3) 增量过滤：aid 去重（材料方案：按已见 aid 集合过滤，而非日期前缀文件） */
      const seen = incr[name].seenAids || [];
      const fresh = lr.list.filter(a => a && a.aid && !seen.includes(String(a.aid)));
      stats.fresh += fresh.length;
      stats.skippedOld += lr.list.length - fresh.length;

      for (const a of fresh) {
        /* 4) 抓正文（预算控制；抓不到就用摘要——摘要也是真实数据） */
        let body = '';
        if (bodyBudget > 0 && a.link) {
          await _sleep(_jitter(1000, 3000));
          body = await fetchArticleBody(a.link);
          bodyBudget--;
          if (body) stats.bodyOk++;
        }
        const ts = (a.create_time || a.update_time || 0) * 1000;
        items.push({
          title: String(a.title || '').trim(),
          url: a.link || '',
          content: body || String(a.digest || '').trim(),
          digest: String(a.digest || '').trim(),
          source: '公众号·' + acc.nickname,
          date: ts ? new Date(ts).toISOString() : '',
          publishedAt: ts ? new Date(ts).toISOString() : '',
          data_type: 'osint_intel',
          category: '公众号监测',
          language: 'zh',
          severity: '中',
          interestLinked: true,
          _real: true,
          _fromSource: 'WECHAT_OA',
          _sourceType: 'wechat_oa',
          _wechatAid: String(a.aid),
          _wechatAccount: acc.nickname,
          _original: (a.copyright_type | 0) === 0   /* 材料方案：copyright_type==0 为原创，标记供参考 */
        });
      }
      /* 5) 更新增量游标（无论正文是否抓到，列表项已处理即标记，避免反复请求风控区） */
      const newSeen = seen.concat(fresh.map(a => String(a.aid)));
      incr[name].seenAids = newSeen.slice(-200);
      incr[name].lastTime = Date.now();
      _saveIncr(incr);
      await _sleep(_jitter(2000, 5000));
    } catch (e) {
      stats.errors.push(name + ': ' + (e && e.message || e));
    }
  }
  _saveIncr(incr);
  return { items, stats, session: { logged: true, needLogin: false, channel: 'appmsg', message: 'ok' } };
}

/* ---------- 状态快照（供 /api/wechat/status） ---------- */
function status() {
  const s = loadSession();
  let loginState = {};
  try { loginState = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'wechat-login-state.json'), 'utf8')); } catch (e) {}
  const incr = _loadIncr();
  const accounts = listAccounts();
  return {
    logged: !!s,
    savedAt: s ? s.savedAt : '',
    needLogin: false,   /* 免登录通道兜底：未扫码也能采集，不再视为阻塞态 */
    channel: s ? 'appmsg（公众平台接口·全功能）' : 'sogou-search（搜狗微信检索·免登录）',
    message: s
      ? '会话有效（保存于 ' + s.savedAt + '），走公众平台接口通道'
      : '未扫码登录：自动走免登录通道（搜狗微信检索）。注册订阅号并扫码后可升级为全功能接口通道',
    freqCooldownUntil: _freqCoolUntil ? new Date(_freqCoolUntil).toISOString() : '',
    accounts,
    resolved: accounts.filter(n => incr[n] && (incr[n].fakeid || (incr[n].seenTitles || []).length)).length,
    loginState: loginState.state || 'idle',
    loginMessage: loginState.message || ''
  };
}

module.exports = { collect, status, listAccounts, addAccount, removeAccount };
