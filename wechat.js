/* ===== 公众号采集管理面板 WECHAT v1.0（2026-08-21）=====
 * 微信公众号实时采集通道的前端管理界面：
 *   ① 扫码登录（二维码内嵌展示，手机微信扫码即可，无需在电脑前操作）
 *   ② 监测账号清单管理（增删）
 *   ③ 手动触发采集 + 最近一轮统计
 * 后端：server/wechat-login.js（扫码会话） + server/wechat-oa.js（appmsg采集）
 * 链路：公众号文章 → 入口闸门(涉海外利益/体裁/国内过滤) → intel_data(approved) → 预警中心/态势总览
 * 零模拟：面板只展示后端真实状态，会话失效如实提示重新扫码。
 */
var WECHAT = (function () {
  var _pollTimer = null;

  function _api(p) {
    if (typeof APIClient !== 'undefined' && APIClient.baseUrl) return APIClient.baseUrl.replace(/\/api$/, '') + p;
    if (location.protocol === 'file:') return 'http://localhost:3000' + p;
    return p;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _get(p) { return fetch(_api(p)).then(function (r) { return r.json(); }); }
  function _post(p, body) {
    return fetch(_api(p), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  /* ---------- 渲染骨架 ---------- */
  function init() {
    var el = document.getElementById('wechat-content');
    if (!el) return;
    el.innerHTML =
      '<div class="card" style="border:1px solid rgba(91,155,255,0.3)">' +
        '<div class="card-tt"><span class="ic">📮</span>微信公众号实时采集 <span style="font-size:10px;color:var(--text3);font-weight:400"> — 每 15 分钟自动拉取监测账号最新文章，经入口闸门过滤后实时入库并分发预警中心/态势总览。双通道：免登录（搜狗微信检索，开箱即用）/ 扫码登录（公众平台接口，功能更全）</span></div>' +
        '<div id="wx-status"></div>' +
      '</div>' +
      '<div class="grid mt-12" style="grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="card"><div class="card-tt"><span class="ic">🔐</span>扫码登录</div><div id="wx-login"></div></div>' +
        '<div class="card"><div class="card-tt"><span class="ic">📋</span>监测账号清单</div><div id="wx-accounts"></div></div>' +
      '</div>' +
      '<div class="card mt-12"><div class="card-tt"><span class="ic">⚙️</span>采集控制台</div><div id="wx-console"></div></div>';
    refresh();
  }

  function refresh() {
    _get('/api/wechat/status').then(function (j) {
      if (!j || !j.ok) { _renderStatus(null); return; }
      _renderStatus(j.status);
      _renderAccounts(j.status.accounts || []);
      _renderConsole(j.status);
    }).catch(function () { _renderStatus(null); });
    /* 登录卡片初始渲染：未在登录流程中时也展示「发起扫码登录」入口或进行中的二维码 */
    if (!_pollTimer) {
      _get('/api/wechat/login/state').then(function (j) {
        if (j && j.ok) _renderLogin(j.state === 'starting' ? 'idle' : j.state, j.qr, j.message);
      }).catch(function () { _renderLogin('idle', '', ''); });
    }
  }

  /* ---------- 状态区 ---------- */
  function _renderStatus(st) {
    var el = document.getElementById('wx-status');
    if (!el) return;
    if (!st) {
      el.innerHTML = '<div style="padding:14px;color:var(--red);font-size:13px">⚠️ 后端未响应——请确认 server 已启动（localhost:3000）</div>';
      return;
    }
    var ok = st.channel ? true : (st.logged && !st.needLogin);
    var dot = ok ? '<span style="color:var(--green)">●</span>' : '<span style="color:var(--red)">●</span>';
    var lr = st.lastRun || {};
    var s = lr.stats || {};
    el.innerHTML =
      '<div class="flex gap-12 wrap items-center" style="padding:6px 0 2px">' +
        '<span style="font-size:13px">' + dot + ' 采集通道：<b>' + _esc(st.channel || (st.logged ? '公众平台接口' : '未启动')) + '</b></span>' +
        (st.savedAt ? '<span class="text-xs text-muted">会话保存于 ' + _esc(new Date(st.savedAt).toLocaleString('zh-CN')) + '</span>' : '') +
        '<span class="text-xs text-muted">已解析账号 ' + (st.resolved || 0) + '/' + (st.accounts || []).length + '</span>' +
        (st.freqCooldownUntil ? '<span style="font-size:11px;color:var(--orange)">⏸ 接口风控冷却至 ' + _esc(new Date(st.freqCooldownUntil).toLocaleTimeString('zh-CN')) + '</span>' : '') +
      '</div>' +
      (st.message ? '<div class="text-xs" style="color:var(--text2);margin-top:4px">' + _esc(st.message) + '</div>' : '') +
      (lr.at ? '<div class="text-xs text-muted" style="margin-top:6px">最近一轮：' + _esc(new Date(lr.at).toLocaleString('zh-CN')) +
        ' ｜ 账号 ' + (s.accountsOk || 0) + '/' + (s.accounts || 0) +
        ' ｜ 新文章 ' + (s.fresh || 0) + '（正文 ' + (s.bodyOk || 0) + '）' +
        ' ｜ 增量跳过 ' + (s.skippedOld || 0) +
        (s.errors && s.errors.length ? ' ｜ <span style="color:var(--orange)">异常 ' + s.errors.length + ' 条</span>' : '') +
        '</div>' : '<div class="text-xs text-muted" style="margin-top:6px">尚未运行过采集（登录后每 15 分钟自动运行，也可点下方「立即采集」）</div>');
  }

  /* ---------- 扫码登录 ---------- */
  function _renderLogin(state, qr, message) {
    var el = document.getElementById('wx-login');
    if (!el) return;
    var html = '';
    if (state === 'waiting' || state === 'scanned') {
      html =
        (qr ? '<div style="text-align:center;padding:8px"><img src="' + qr + '" style="width:200px;height:200px;border:6px solid #fff;border-radius:8px"></div>'
            : '<div style="padding:20px;text-align:center;color:var(--text2)">二维码加载中…</div>') +
        '<div style="text-align:center;font-size:12px;color:' + (state === 'scanned' ? 'var(--green)' : 'var(--text2)') + '">' + _esc(message || '') + '</div>' +
        '<div class="text-xs text-muted" style="text-align:center;margin-top:6px">打开手机微信 → 扫一扫 → 确认登录（二维码约 2 分钟过期，自动刷新）</div>';
    } else if (state === 'success') {
      html = '<div style="padding:14px;color:var(--green);font-size:13px">✅ ' + _esc(message || '登录成功') + '</div>';
    } else {
      html =
        '<div class="text-xs text-muted" style="margin-bottom:8px">（可选升级）当前免登录通道已可正常采集。如需「全功能接口通道」（按号精准拉取、列表更全），需先用该微信<b>免费注册一个订阅号</b>（mp.weixin.qq.com → 立即注册 → 订阅号 → 个人，约10分钟），再回来扫码。</div>' +
        (message && (state === 'timeout' || state === 'error') ? '<div style="color:var(--orange);font-size:12px;margin-bottom:8px">⚠️ ' + _esc(message) + '</div>' : '') +
        '<button class="btn sm" onclick="WECHAT.startLogin()">📱 发起扫码登录（需已注册公众号的微信）</button>';
    }
    el.innerHTML = html;
  }

  function startLogin() {
    _renderLogin('starting', '', '正在启动登录浏览器…');
    _post('/api/wechat/login').then(function (j) {
      if (!j || !j.ok) { _renderLogin('error', '', (j && j.error) || '发起失败'); return; }
      _pollLogin();
    }).catch(function () { _renderLogin('error', '', '后端无响应'); });
  }

  function _pollLogin() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(function () {
      _get('/api/wechat/login/state').then(function (j) {
        if (!j || !j.ok) return;
        _renderLogin(j.state, j.qr, j.message);
        if (j.state === 'success' || j.state === 'timeout' || j.state === 'error' || j.state === 'idle') {
          clearInterval(_pollTimer); _pollTimer = null;
          if (j.state === 'success') setTimeout(refresh, 1000);
        }
      }).catch(function () {});
    }, 3000);
  }

  /* ---------- 账号清单 ---------- */
  function _renderAccounts(accounts) {
    var el = document.getElementById('wx-accounts');
    if (!el) return;
    el.innerHTML =
      '<div class="flex gap-8 mb-12"><input class="input" id="wx-add-name" placeholder="输入公众号名称，如：刺猬安全出海" style="flex:1">' +
      '<button class="btn primary sm" onclick="WECHAT.addAccount()">➕ 添加</button></div>' +
      '<div style="max-height:260px;overflow-y:auto">' +
      (accounts.length ? accounts.map(function (a) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border)">' +
          '<span style="font-size:13px">📮 ' + _esc(a) + '</span>' +
          '<button class="btn sm" style="margin-left:auto;color:var(--red)" onclick="WECHAT.removeAccount(\'' + _esc(a).replace(/'/g, "\\'") + '\')">删除</button></div>';
      }).join('') : '<div class="text-muted" style="padding:12px">清单为空</div>') +
      '</div>' +
      '<div class="text-xs text-muted" style="margin-top:8px">核心清单 20 个开源情报/安全公众号，每轮采 10 个、轮巡循环。上限 50 个。</div>';
  }

  function addAccount() {
    var inp = document.getElementById('wx-add-name');
    var name = inp ? inp.value.trim() : '';
    if (!name) return;
    _post('/api/wechat/accounts', { name: name }).then(function (j) {
      if (j && j.ok) { if (inp) inp.value = ''; _renderAccounts(j.accounts || []); refresh(); }
      else alert((j && j.error) || '添加失败');
    });
  }
  function removeAccount(name) {
    fetch(_api('/api/wechat/accounts?name=' + encodeURIComponent(name)), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { _renderAccounts(j.accounts || []); refresh(); } });
  }

  /* ---------- 控制台 ---------- */
  function _renderConsole(st) {
    var el = document.getElementById('wx-console');
    if (!el) return;
    el.innerHTML =
      '<div class="flex gap-8 wrap items-center">' +
      '<button class="btn primary sm" onclick="WECHAT.collectNow()">⚡ 立即采集一轮</button>' +
      '<button class="btn sm" onclick="WECHAT.refresh()">🔄 刷新状态</button>' +
      '<span class="text-xs text-muted" id="wx-console-msg"></span></div>' +
      '<div class="text-xs text-muted" style="margin-top:10px;line-height:1.8">' +
      '采集链路：公众号列表接口(appmsg) → aid 增量去重 → 正文抓取(每轮限 8 篇，防风控) → 翻译/关联判定 → 入口闸门（涉海外利益安全校验 + 国内新闻/评论/榜单过滤）→ intel_data 自动审核入库 → 实时分发预警中心/态势总览/首页情报流。<br>' +
      '风控自律：接口间隔 2~5 秒随机、每号每轮限 5 篇、触发「操作频繁」自动冷却 30 分钟。会话有效期约数天，失效后面板会提示重新扫码。</div>';
  }

  function collectNow() {
    var msg = document.getElementById('wx-console-msg');
    if (msg) { msg.textContent = '已触发，采集中（约 30~90 秒）…'; msg.style.color = 'var(--cyan)'; }
    _post('/api/wechat/collect').then(function (j) {
      if (!j || !j.ok) {
        if (msg) { msg.textContent = (j && j.error) || '触发失败'; msg.style.color = 'var(--orange)'; }
        return;
      }
      setTimeout(refresh, 30000);
      setTimeout(refresh, 90000);
    });
  }

  return { init: init, refresh: refresh, startLogin: startLogin, addAccount: addAccount, removeAccount: removeAccount, collectNow: collectNow };
})();
