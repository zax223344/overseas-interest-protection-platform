/* ===== 微信公众号 profile_ext 直采通道（2026-08-22，用户提供材料一落地）=====
 * 原理：PC 微信打开公众号「历史消息」页时，客户端调用
 *   mp.weixin.qq.com/mp/profile_ext?action=getmsg&__biz=..&offset=..&count=10&f=json
 * 这是微信自家 JSON 接口，一页 10 条、含标题/摘要/封面/正文链接/精确发布时间，
 * 响应快（单号 1 个请求）、无搜狗式反爬，是 20 个核心号「实时快速抓取」的最优通道。
 *
 * 凭证来源：scripts/wechat-capture.py（mitmproxy 抓包助手）截获真实 getmsg 请求，
 *   把 __biz + Cookie + UA + uin/key/pass_ticket 参数模板写入 .cache/wechat-biz.json。
 *   凭证有时效（数小时~数天），过期后接口返回 ret!=0 —— 本模块把该号标记 stale，
 *   面板提示用户重新点开一次历史消息页即可刷新，绝不编造数据。
 *
 * 与搜狗/appmsg 通道的关系：同轮混跑——有凭证的号走本通道，没凭证的号自动回落搜狗。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const oa = require('./wechat-oa');   /* 复用 _httpGet/_fetchArticleFull/增量状态等内部件 */

const BIZ_FILE = path.join(__dirname, '.cache', 'wechat-biz.json');
const COUNT_PER_ACCOUNT = 10;   /* 每号每轮只拉第 1 页 10 条——"实时最新"足够，也最省请求 */
const BODY_BUDGET = 8;          /* 每轮正文抓取预算（正文页是所有通道共同的风控重灾区） */

let _profCoolUntil = 0;         /* profile 通道自己的风控冷却（与搜狗冷却相互独立） */

function _loadBiz() {
  try { return JSON.parse(fs.readFileSync(BIZ_FILE, 'utf8')); } catch (e) { return {}; }
}
function _saveBiz(db) {
  try { fs.writeFileSync(BIZ_FILE, JSON.stringify(db, null, 1)); } catch (e) {}
}
const _normName = s => String(s || '').replace(/\s+/g, '').toLowerCase();

/* 账号名 → 凭证：精确匹配优先，其次互相包含（抓到的昵称与清单名可能差"订阅号"等后缀） */
function findCred(name, db) {
  db = db || _loadBiz();
  const n = _normName(name);
  let loose = null;
  for (const biz of Object.keys(db)) {
    const e = db[biz];
    if (!e || !e.cookie || !e.getmsg_captured || !e.query) continue;
    const en = _normName(e.name);
    if (!en) continue;
    if (en === n) return e;
    if (!loose && (en.indexOf(n) >= 0 || n.indexOf(en) >= 0)) loose = e;
  }
  return loose;
}

/* 面板用：清单内各号的凭证覆盖/新鲜度快照 */
function statusInfo(accounts) {
  const db = _loadBiz();
  const ok = [], missing = [], stale = [];
  let oldest = 0, newest = 0;
  for (const name of accounts) {
    const c = findCred(name, db);
    if (!c) { missing.push(name); continue; }
    if (c.stale) { stale.push(name + '（' + (c.stale_reason || '凭证失效') + '）'); continue; }
    ok.push(name);
    if (c.captured_at) {
      if (!oldest || c.captured_at < oldest) oldest = c.captured_at;
      if (c.captured_at > newest) newest = c.captured_at;
    }
  }
  return {
    credentialed: ok, missing, stale,
    oldestCapture: oldest ? new Date(oldest * 1000).toISOString() : '',
    newestCapture: newest ? new Date(newest * 1000).toISOString() : '',
    cooldownUntil: _profCoolUntil ? new Date(_profCoolUntil).toISOString() : ''
  };
}

/* getmsg 拉一页图文列表。返回 {list}|{error}|{stale} */
async function _fetchMsgList(cred) {
  const q = Object.assign({}, cred.query, {
    action: 'getmsg', __biz: cred.__biz, f: 'json',
    offset: '0', count: String(COUNT_PER_ACCOUNT)
  });
  delete q._;
  const qs = Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
  const headers = { 'Cookie': cred.cookie, 'X-Requested-With': 'XMLHttpRequest' };
  if (cred.ua) headers['User-Agent'] = cred.ua;
  headers['Referer'] = 'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=' + encodeURIComponent(cred.__biz);
  const r = await oa._internals.httpGet('https://mp.weixin.qq.com/mp/profile_ext?' + qs, { headers, timeout: 12000 });
  if (!r.body) return { error: 'unreachable' };
  let j;
  try { j = JSON.parse(r.body); } catch (e) { return { error: 'bad-json' }; }
  const ret = j.ret !== undefined ? (j.ret | 0) : (j.base_resp ? (j.base_resp.ret | 0) : -2);
  if (ret !== 0) {
    /* 凭证过期/失效：标记 stale，面板提醒用户重开历史页刷新 */
    const db = _loadBiz();
    if (db[cred.__biz]) {
      db[cred.__biz].stale = true;
      db[cred.__biz].stale_reason = 'ret=' + ret + ' ' + String(j.errmsg || (j.base_resp && j.base_resp.errmsg) || '').slice(0, 60);
      _saveBiz(db);
    }
    if (ret === 200013) _profCoolUntil = Date.now() + 30 * 60 * 1000;   /* 操作频繁 */
    return { stale: true, ret };
  }
  let gml = j.general_msg_list;
  if (typeof gml === 'string') { try { gml = JSON.parse(gml); } catch (e) { gml = null; } }
  return { list: (gml && gml.list) || [] };
}

/* 一条 comm_msg_info + app_msg_ext_info → 0~N 个标准条目（一稿多文拆开） */
function _extractArticles(entry, accountName) {
  const out = [];
  const comm = entry.comm_msg_info || {};
  const ext = entry.app_msg_ext_info;
  if (!ext || (comm.type | 0) !== 49) return out;   /* 49=图文，其他类型（文字/视频/分享）跳过 */
  const ts = (comm.datetime | 0) * 1000;
  const msgId = String(comm.id || '');
  const mkUrl = u => {
    u = String(u || '').replace(/&amp;/g, '&');
    if (!u) return '';
    return u.startsWith('http') ? u : 'https://mp.weixin.qq.com' + u;
  };
  const push = (node, subIdx) => {
    const title = String(node.title || '').trim();
    if (!title) return;
    out.push({
      _msgId: msgId + (subIdx ? '#' + subIdx : ''),
      title,
      digest: String(node.digest || '').trim(),
      url: mkUrl(node.content_url),
      cover: mkUrl(node.cover),
      ts,
      account: accountName
    });
  };
  push(ext, 0);
  const multi = Array.isArray(ext.multi_app_msg_item_list) ? ext.multi_app_msg_item_list : [];
  multi.forEach((m, i) => push(m, i + 1));
  return out;
}

/* 主入口：有凭证的号走 profile_ext 直采。输出与搜狗通道同构的 {items, stats} */
async function collectViaProfile(accounts, opts) {
  opts = opts || {};
  const stats = { channel: 'profile-ext', accounts: 0, accountsOk: 0, fetched: 0, fresh: 0, bodyOk: 0, skippedOld: 0, errors: [] };
  const items = [];
  const db = _loadBiz();
  const incr = oa._internals.loadIncr();
  const tk = oa._internals.titleKey;
  let bodyBudget = opts.bodyBudget || BODY_BUDGET;

  for (const name of accounts) {
    stats.accounts++;
    if (Date.now() < _profCoolUntil) { stats.errors.push('profile 通道风控冷却中'); break; }
    const cred = findCred(name, db);
    if (!cred) { stats.errors.push(name + ': 无凭证（请用抓包助手点开该号历史消息页）'); continue; }
    try {
      const lr = await _fetchMsgList(cred);
      if (lr.stale) { stats.errors.push(name + ': 凭证失效(ret=' + lr.ret + ')，请重新点开历史消息页刷新'); continue; }
      if (lr.error) { stats.errors.push(name + ': ' + lr.error); continue; }
      stats.accountsOk++;
      stats.fetched += lr.list.length;

      /* 解出全部图文（含一稿多文），45 天新鲜度预过滤 + 标题增量去重（与搜狗通道共用 seenTitles） */
      const arts = [];
      for (const e of lr.list) arts.push.apply(arts, _extractArticles(e, cred.name || name));
      incr[name] = incr[name] || {};
      const seenT = incr[name].seenTitles || [];
      const fresh = arts.filter(a =>
        (!a.ts || (Date.now() - a.ts) <= 45 * 864e5) &&
        tk(a.title) && !seenT.includes(tk(a.title)));
      stats.skippedOld += arts.length - fresh.length;
      fresh.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      stats.fresh += fresh.length;

      for (const a of fresh) {
        /* 正文 + 规范链接（预算内抓文章页；预算外用摘要+getmsg 链接，均为真实数据） */
        let body = '', ct = 0, canonical = '';
        if (bodyBudget > 0 && a.url) {
          await oa._internals.sleep(oa._internals.jitter(1000, 2500));
          const full = await oa._internals.fetchArticleFull(a.url);
          bodyBudget--;
          if (!full.blocked) {
            body = full.body || '';
            ct = full.ct || 0;
            canonical = full.canonical || '';
            if (body) stats.bodyOk++;
          }
        }
        const ts = ct || a.ts || 0;
        items.push({
          title: a.title,
          url: canonical || a.url,
          content: body || a.digest,
          digest: a.digest,
          source: '公众号·' + (cred.name || name),
          date: ts ? new Date(ts).toISOString() : '',
          publishedAt: ts ? new Date(ts).toISOString() : '',
          data_type: 'osint_intel',
          category: '公众号监测',
          language: 'zh',
          severity: '中',
          interestLinked: true,
          _real: true,
          _fromSource: 'WECHAT_OA:PROFILE',
          _sourceType: 'wechat_oa',
          _viaProfile: true,
          _wechatMsgId: a._msgId,
          _wechatAccount: cred.name || name
        });
        seenT.push(tk(a.title));
      }
      incr[name].seenTitles = seenT.slice(-200);
      incr[name].lastTime = Date.now();
      oa._internals.saveIncr(incr);
      await oa._internals.sleep(oa._internals.jitter(2000, 3000));   /* 号间 2~3s：20 号一轮约 1 分钟 */
    } catch (e) {
      stats.errors.push(name + ': ' + (e && e.message || e));
    }
  }
  oa._internals.saveIncr(incr);
  return { items, stats };
}

module.exports = { collectViaProfile, statusInfo, findCred };
