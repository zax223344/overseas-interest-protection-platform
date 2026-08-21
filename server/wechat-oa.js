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

let _freqCoolUntil = 0;         // 模块级风控冷却
let _needLogin = '';            // 非空 = 会话失效原因

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

/* ---------- 监测账号清单（server/wechat-accounts.json，可在系统面板里增删）---------- */
const DEFAULT_ACCOUNTS = [
  '领事直通车', '外交部发言人办公室', '参考消息', '海外网', '环球网',
  '新华网', '人民网', '中国一带一路网', '走出去服务港', '国际商报社'
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
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
      req.end();
    } catch (e) { resolve({ status: 0, body: '' }); }
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

/* ---------- 主采集入口 ---------- */
async function collect(opts) {
  opts = opts || {};
  const stats = { accounts: 0, accountsOk: 0, fetched: 0, fresh: 0, bodyOk: 0, skippedOld: 0, errors: [] };
  const items = [];

  if (Date.now() < _freqCoolUntil) {
    return { items, stats, session: { logged: true, needLogin: false, message: '微信风控冷却中（至 ' + new Date(_freqCoolUntil).toLocaleTimeString('zh-CN') + '）' } };
  }
  const session = loadSession();
  if (!session) {
    _needLogin = _needLogin || '会话不存在或已过期，请先在「公众号采集」面板扫码登录';
    return { items, stats, session: { logged: false, needLogin: true, message: _needLogin } };
  }
  const accounts = (opts.accounts && opts.accounts.length ? opts.accounts : listAccounts());
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
            _needLogin = '会话已失效（ret=' + s.error + '），请重新扫码登录';
            return { items, stats, session: { logged: false, needLogin: true, message: _needLogin } };
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
          _needLogin = '会话已失效（ret=' + lr.error + '），请重新扫码登录';
          _saveIncr(incr);
          return { items, stats, session: { logged: false, needLogin: true, message: _needLogin } };
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
  return { items, stats, session: { logged: true, needLogin: false, message: 'ok' } };
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
    needLogin: !s || !!_needLogin,
    message: _needLogin || (s ? '会话有效（保存于 ' + s.savedAt + '）' : '尚未登录'),
    freqCooldownUntil: _freqCoolUntil ? new Date(_freqCoolUntil).toISOString() : '',
    accounts,
    resolved: accounts.filter(n => incr[n] && incr[n].fakeid).length,
    loginState: loginState.state || 'idle',
    loginMessage: loginState.message || ''
  };
}

module.exports = { collect, status, listAccounts, addAccount, removeAccount };
