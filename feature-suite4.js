/* ============================================================
 * feature-suite4.js — 四合一功能区套件（2026-09-11）
 * ================================================================
 *   #747 SUPPLY     供应链中断传导预测（/api/insight/supply-chain + AI 传导链）
 *   #748 BARRIER    国别准入壁垒日历（/api/insight/barrier-calendar）
 *   #749 EVACPLAN   撤离与应急方案自动生成（/api/insight/evac-plan，五段式 LLM 预案
 *                   + EMERGENCY_GUIDE 真实国别应急指南：机场/港口/使领馆/领保热线）
 *   #750 SOCPULSE   境外社媒舆情监测（/api/insight/social-pulse）
 * 铁律：零模拟——所有数字来自真实库端点；通道无数据即如实展示为 0。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 公共 ---------- */
  function _tok() { try { return (typeof APIClient !== 'undefined' && APIClient.getToken) ? APIClient.getToken() : (localStorage.getItem('orps_api_token') || ''); } catch (e) { return ''; } }
  function _api(method, path, body) {
    return fetch('/api/insight' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _tok() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var LV = {
    red: { t: '红', c: '#ff5577', bg: 'rgba(239,68,68,.16)', bd: 'rgba(239,68,68,.45)' },
    orange: { t: '橙', c: '#ff9944', bg: 'rgba(249,115,22,.14)', bd: 'rgba(249,115,22,.4)' },
    yellow: { t: '黄', c: '#fbbf24', bg: 'rgba(245,158,11,.14)', bd: 'rgba(245,158,11,.4)' },
    blue: { t: '蓝', c: '#67e8f9', bg: 'rgba(0,212,255,.12)', bd: 'rgba(0,212,255,.35)' }
  };
  function _lvTag(l) { var v = LV[l] || LV.blue; return '<span style="font-size:10px;font-weight:800;padding:1px 7px;border-radius:4px;color:' + v.c + ';background:' + v.bg + ';border:1px solid ' + v.bd + '">' + v.t + '</span>'; }
  function _chinaTag(on) { return on ? '<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px;color:#c084fc;background:rgba(124,58,237,.14);border:1px solid rgba(124,58,237,.4)">涉华</span>' : ''; }
  function _trendTag(t) {
    var m = { up: ['↑ 升温', '#ff5577'], down: ['↓ 回落', '#4ade80'], flat: ['→ 持平', '#5a7a99'] }[t] || ['—', '#5a7a99'];
    return '<span style="font-size:10px;font-weight:700;color:' + m[1] + '">' + m[0] + '</span>';
  }
  function _bar(n, max, color) {
    if (!max) return '';
    var w = Math.max(2, Math.round(n / max * 100));
    return '<div style="height:5px;border-radius:3px;background:rgba(0,212,255,.08);margin-top:4px;overflow:hidden"><div style="height:100%;width:' + w + '%;background:' + (color || '#00d4ff') + ';border-radius:3px"></div></div>';
  }
  function _head(icon, title, sub, accent) {
    return '<div class="fs-head" style="--fs-accent:' + (accent || '#00d4ff') + '">' +
      '<span class="fs-ic">' + icon + '</span><div><div class="fs-tt">' + title + '</div><div class="fs-sub">' + sub + '</div></div></div>';
  }
  function _sec(t, extra) { return '<div class="fs-sec">' + t + (extra || '') + '</div>'; }
  function _panel(inner, violet) { return '<div class="fs-panel' + (violet ? ' violet' : '') + '">' + inner + '</div>'; }

  /* ---------- 样式 ---------- */
  if (!document.getElementById('feature-suite4-style')) {
    var st = document.createElement('style');
    st.id = 'feature-suite4-style';
    st.textContent =
      '.fs-root{padding:14px 16px;color:#c9d8e8;font-size:12px}' +
      '.fs-head{display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(90deg,rgba(0,212,255,.10),rgba(124,58,237,.05));border:1px solid rgba(0,212,255,.3);border-radius:10px;margin-bottom:12px}' +
      '.fs-head .fs-ic{font-size:26px}' +
      '.fs-tt{font-size:17px;font-weight:800;color:#e8f0fb;letter-spacing:1px}' +
      '.fs-sub{font-size:10px;color:#5a7a99;margin-top:2px}' +
      '.fs-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:12px}' +
      '.fs-kpi{background:rgba(15,23,42,.65);border:1px solid rgba(0,212,255,.16);border-radius:8px;padding:9px 10px}' +
      '.fs-kpi .v{font-size:20px;font-weight:800;font-family:Consolas,monospace;color:#e8f0fb}' +
      '.fs-kpi .v.red{color:#ff5577}.fs-kpi .v.violet{color:#c084fc}' +
      '.fs-kpi .l{font-size:10px;color:#5a7a99;margin-top:2px}' +
      '.fs-panel{background:rgba(15,23,42,.65);border:1px solid rgba(0,212,255,.14);border-radius:10px;padding:12px;margin-bottom:12px}' +
      '.fs-panel.violet{border-color:rgba(124,58,237,.32)}' +
      '.fs-sec{font-size:13px;font-weight:700;color:#a5f3fc;border-left:3px solid #00d4ff;padding-left:8px;margin-bottom:10px}' +
      '.fs-panel.violet .fs-sec{color:#c4b5fd;border-left-color:#7c3aed}' +
      '.fs-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}' +
      '.fs-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
      '@media(max-width:1100px){.fs-grid2,.fs-grid3{grid-template-columns:1fr}}' +
      '.fs-card{border:1px solid rgba(0,212,255,.14);border-radius:8px;padding:9px 10px;margin-bottom:8px;background:rgba(0,0,0,.22);cursor:pointer;transition:.15s}' +
      '.fs-card:hover{border-color:rgba(0,212,255,.4)}' +
      '.fs-card.hot{border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.05)}' +
      '.fs-card .r1{display:flex;align-items:center;gap:8px;margin-bottom:4px}' +
      '.fs-card .nm{font-weight:700;color:#e2e8f0;font-size:13px;flex:1}' +
      '.fs-mini{font-size:10px;color:#5a7a99;line-height:1.6}' +
      '.fs-mini b{color:#8fb3d9}' +
      '.fs-tbl{width:100%;border-collapse:collapse;font-size:11px}' +
      '.fs-tbl th{text-align:left;color:#5a7a99;font-weight:600;padding:5px 7px;border-bottom:1px solid rgba(0,212,255,.15);white-space:nowrap}' +
      '.fs-tbl td{padding:5px 7px;border-bottom:1px solid rgba(0,212,255,.06);color:#c9d8e8;vertical-align:top}' +
      '.fs-tbl tr:hover td{background:rgba(0,212,255,.04)}' +
      '.fs-ev{padding:7px 9px;border:1px solid rgba(0,212,255,.1);border-radius:6px;margin-bottom:6px;background:rgba(0,0,0,.18)}' +
      '.fs-ev .t{color:#dbe7f3;line-height:1.5;margin-bottom:3px}' +
      '.fs-ev .m{font-size:10px;color:#5a7a99;display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.fs-ev a{color:#67e8f9;text-decoration:none}' +
      '.fs-btn{background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.35);color:#67e8f9;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:inherit;font-weight:700}' +
      '.fs-btn:hover{background:rgba(0,212,255,.22)}' +
      '.fs-btn.violet{background:rgba(124,58,237,.14);border-color:rgba(124,58,237,.45);color:#c4b5fd}' +
      '.fs-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.fs-inp,.fs-sel{background:rgba(0,0,0,.35);border:1px solid rgba(0,212,255,.2);border-radius:6px;color:#c9d8e8;padding:6px 10px;font-size:12px;outline:none;font-family:inherit}' +
      '.fs-inp:focus,.fs-sel:focus{border-color:#00d4ff}' +
      '.fs-ai{border:1px solid rgba(124,58,237,.35);border-radius:10px;padding:12px;background:rgba(124,58,237,.05);margin-top:10px}' +
      '.fs-ai .seg{margin-bottom:10px;line-height:1.75;color:#d5e2f0;font-size:12px;white-space:pre-wrap}' +
      '.fs-ai .seg b{color:#c4b5fd}' +
      '.fs-ai .badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:6px}' +
      '.fs-note{font-size:10px;color:#5a7a99;line-height:1.7;padding:6px 8px;background:rgba(255,204,0,.05);border:1px dashed rgba(255,204,0,.22);border-radius:6px;margin-top:8px}' +
      '.fs-note b{color:#ffcc00}' +
      '.fs-cal{display:flex;gap:2px;flex-wrap:wrap;margin-bottom:4px}' +
      '.fs-cal .cell{width:14px;height:14px;border-radius:3px;background:rgba(0,212,255,.06);position:relative}' +
      '.fs-load{padding:26px;text-align:center;color:#5a7a99;font-size:12px}' +
      '.fs-empty{padding:18px;text-align:center;color:#5a7a99;font-size:11px;border:1px dashed rgba(0,212,255,.15);border-radius:8px}' +
      '.evac-tab-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:#5a7a99;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s}' +
      '.evac-tab-btn:hover{color:#8fb3d9}' +
      '.evac-tab-btn.on{color:#ff9944;border-bottom-color:#ff9944}';
    document.head.appendChild(st);
  }

  /* ============================================================
   * #747 供应链中断传导预测
   * ============================================================ */
  var SUPPLY = {
    _d: null, _aiBusy: false,
    init: function () {
      var root = document.getElementById('supply-root');
      if (!root) return;
      root.className = 'fs-root';
      root.innerHTML = '<div class="fs-load">⟳ 正在加载供应链中断传导数据（真实库 30 天窗口聚合）…</div>';
      var me = this;
      _api('GET', '/supply-chain').then(function (j) {
        me._d = j && j.ok ? j : null;
        me.render();
      }).catch(function (e) { root.innerHTML = '<div class="fs-empty">加载失败：' + _esc(e.message) + '</div>'; });
    },
    render: function () {
      var d = this._d; var root = document.getElementById('supply-root');
      if (!root) return;
      if (!d) { root.innerHTML = '<div class="fs-empty">暂无数据</div>'; return; }
      var s = d.stats;
      var h = _head('🚢', '供应链中断传导预测', '物流/港口/运河/罢工/地缘中断事件 → 六大咽喉点 × 六大走廊 → 中资项目暴露 → 传导链研判（真实库 30 天窗口）');
      h += '<div class="fs-kpis">' +
        '<div class="fs-kpi"><div class="v">' + s.total30d + '</div><div class="l">中断类事件 30d</div></div>' +
        '<div class="fs-kpi"><div class="v">' + s.total7d + '</div><div class="l">近 7 天新增</div></div>' +
        '<div class="fs-kpi"><div class="v red">' + s.red30d + '</div><div class="l">红级事件 30d</div></div>' +
        '<div class="fs-kpi"><div class="v violet">' + s.china30d + '</div><div class="l">涉华关联</div></div>' +
        '<div class="fs-kpi"><div class="v' + (s.hotChokes ? ' red' : '') + '">' + s.hotChokes + '/6</div><div class="l">活跃咽喉点</div></div>' +
        '<div class="fs-kpi"><div class="v' + (s.hotCorridors ? ' red' : '') + '">' + s.hotCorridors + '/6</div><div class="l">活跃走廊</div></div></div>';
      /* 咽喉点 */
      h += _panel(_sec('⚓ 六大海上咽喉点', '<span style="font-size:10px;color:#5a7a99;font-weight:400;margin-left:8px">点击卡片 → AI 传导链研判（中断概率 / 三级传导 / 建议动作）</span>') +
        '<div class="fs-grid3">' + d.chokes.map(function (c) {
          return '<div class="fs-card' + (c.hot ? ' hot' : '') + '" onclick="SUPPLY.ai(' + JSON.stringify(JSON.stringify(c.name)) + ')">' +
            '<div class="r1"><span class="nm">' + _esc(c.name) + '</span>' + _trendTag(c.trend) + (c.hot ? _lvTag('red') : '') + '</div>' +
            '<div class="fs-mini">档案风险 <b>' + c.risk + '</b> · 30d 事件 <b>' + c.events30d + '</b> · 7d <b>' + c.events7d + '</b>（红 ' + c.red7d + ' / 涉华 ' + c.china7d + '）<br>关联企业：' + _esc(c.ents.join('、')) + '<br>' + _esc(c.impact) + '</div></div>';
        }).join('') + '</div>');
      /* 走廊 */
      h += _panel(_sec('🛤️ 六大经济走廊') +
        '<div class="fs-grid3">' + d.corridors.map(function (c) {
          return '<div class="fs-card' + (c.hot ? ' hot' : '') + '" onclick="SUPPLY.ai(' + JSON.stringify(JSON.stringify(c.name)) + ')">' +
            '<div class="r1"><span class="nm">' + _esc(c.name) + '</span>' + (c.hot ? _lvTag('red') : '') + '</div>' +
            '<div class="fs-mini">沿线：' + _esc(c.countries) + ' · 参与企业 <b>' + c.ents + '</b> 家 · 投资 <b>' + c.inv + '</b> 亿美元<br>30d 事件 <b>' + c.events30d + '</b> · 7d <b>' + c.events7d + '</b>（红 ' + c.red7d + ' / 涉华 ' + c.china7d + '）</div></div>';
        }).join('') + '</div>', true);
      /* 项目暴露 + 事件流 */
      var exH = d.exposedProjects.length
        ? '<table class="fs-tbl"><tr><th>项目</th><th>企业</th><th>国别</th><th>行业</th><th>投资</th><th>人员</th></tr>' +
          d.exposedProjects.map(function (p) { return '<tr><td>' + _esc(p.name) + '</td><td>' + _esc(p.enterprise) + '</td><td>' + _esc(p.country) + '</td><td>' + _esc(p.sector) + '</td><td>' + _esc(p.invTxt) + '</td><td>' + (p.personnel || '—') + '</td></tr>'; }).join('') + '</table>'
        : '<div class="fs-empty">当前无活跃通道命中的在册项目暴露</div>';
      var evH = d.events.length
        ? d.events.map(function (e) {
          return '<div class="fs-ev"><div class="t">' + _lvTag(e.level) + ' ' + _chinaTag(e.china) + ' ' + _esc(e.title) + '</div><div class="m"><span>' + _esc(e.country) + '</span><span>' + _esc(e.time) + '</span><span>' + _esc(e.source) + '</span>' + (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
        }).join('')
        : '<div class="fs-empty">30 天窗口内无红级/涉华中断类事件</div>';
      h += '<div class="fs-grid2">' + _panel(_sec('🏭 活跃通道暴露中资项目（同国别匹配）', '<span style="font-size:10px;color:#5a7a99;font-weight:400;margin-left:8px">' + d.exposedProjects.length + ' 个</span>') + exH) +
        _panel(_sec('📋 红级/涉华中断事件流', '<span style="font-size:10px;color:#5a7a99;font-weight:400;margin-left:8px">' + d.events.length + ' 条</span>') + evH) + '</div>';
      h += '<div id="supply-ai-slot"></div>';
      h += '<div class="fs-note"><b>数据口径：</b>事件为真实采集库 30 天窗口内命中运输中断关键词（港口/运河/海峡/罢工/封锁/改道/滞留等中英文词表）的全部事件；咽喉点/走廊档案风险值为静态档案口径，动态热度=近 7 天事件命中；传导链研判由 AI 生成（规则模板兜底），事实以事件原文链接为准。生成时间：' + _esc(d.generatedAt) + '</div>';
      root.innerHTML = h;
    },
    ai: function (name) {
      if (this._aiBusy) return;
      var slot = document.getElementById('supply-ai-slot');
      if (!slot) return;
      this._aiBusy = true;
      slot.innerHTML = '<div class="fs-ai"><div class="fs-load">⟳ 正在生成「' + _esc(name) + '」AI 传导链研判（Kimi 参谋级，约 60-150 秒）…</div></div>';
      slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var me = this;
      _api('POST', '/supply-chain/ai', { name: name }).then(function (j) {
        me._aiBusy = false;
        if (!j || !j.ok) { slot.innerHTML = '<div class="fs-ai"><div class="fs-empty">研判失败：' + _esc(j && j.error || '网络错误') + '</div><div style="text-align:center;margin-top:8px"><button class="fs-btn" onclick="SUPPLY.ai(' + JSON.stringify(JSON.stringify(name)) + ')">重试</button></div></div>'; return; }
        slot.innerHTML = '<div class="fs-ai">' +
          '<div style="margin-bottom:8px"><span class="badge" style="background:rgba(124,58,237,.16);color:#c4b5fd;border:1px solid rgba(124,58,237,.4)">' + (j.llmOk ? '🤖 Kimi 参谋级研判' : '⚙️ 规则模板引擎') + '</span><span class="badge" style="background:rgba(0,212,255,.1);color:#67e8f9;border:1px solid rgba(0,212,255,.3)">' + _esc(name) + '</span><span class="badge" style="background:rgba(255,204,0,.08);color:#ffcc00;border:1px solid rgba(255,204,0,.25)">' + _esc(j.generatedAt) + '</span></div>' +
          '<div class="seg"><b>【传导链】</b>\n' + _esc(j.chain) + '</div>' +
          '<div class="seg"><b>【中断概率】</b>\n' + _esc(j.prediction) + '</div>' +
          '<div class="seg"><b>【建议动作】</b>\n' + _esc(j.actions) + '</div>' +
          '<div class="fs-note">' + _esc(j.note) + '</div></div>';
      }).catch(function (e) {
        me._aiBusy = false;
        slot.innerHTML = '<div class="fs-ai"><div class="fs-empty">网络失败：' + _esc(e.message) + '</div></div>';
      });
    }
  };

  /* ============================================================
   * #748 国别准入壁垒日历
   * ============================================================ */
  var BARRIER = {
    _d: null, _cat: '',
    init: function () {
      var root = document.getElementById('barrier-root');
      if (!root) return;
      root.className = 'fs-root';
      root.innerHTML = '<div class="fs-load">⟳ 正在加载国别准入壁垒日历（真实库 60 天窗口）…</div>';
      var me = this;
      _api('GET', '/barrier-calendar').then(function (j) {
        me._d = j && j.ok ? j : null;
        me.render();
      }).catch(function (e) { root.innerHTML = '<div class="fs-empty">加载失败：' + _esc(e.message) + '</div>'; });
    },
    render: function () {
      var d = this._d; var root = document.getElementById('barrier-root');
      if (!root) return;
      if (!d) { root.innerHTML = '<div class="fs-empty">暂无数据</div>'; return; }
      var s = d.stats, me = this;
      var h = _head('🗓️', '国别准入壁垒日历', '贸易救济（反倾销/关税）× 出口管制 × 投资审查 × 制裁清单 —— 按国别×日历聚合，涉华壁垒优先预警（真实库 60 天窗口）', '#fbbf24');
      h += '<div class="fs-kpis">' +
        '<div class="fs-kpi"><div class="v">' + s.total + '</div><div class="l">壁垒事件 60d</div></div>' +
        '<div class="fs-kpi"><div class="v violet">' + s.china + '</div><div class="l">涉华壁垒</div></div>' +
        '<div class="fs-kpi"><div class="v red">' + s.red + '</div><div class="l">红级事件</div></div>' +
        '<div class="fs-kpi"><div class="v">' + s.countries + '</div><div class="l">涉及国别</div></div>' +
        s.byCat.map(function (c) { return '<div class="fs-kpi"><div class="v">' + c.n + '</div><div class="l">' + c.name + '</div></div>'; }).join('') + '</div>';
      /* 日历热力条（60 天） */
      var cal = d.calendar, maxN = Math.max.apply(null, cal.map(function (x) { return x.n; }).concat([1]));
      var maxD = cal.length ? cal[0].date : '', minD = cal.length ? cal[cal.length - 1].date : '';
      h += _panel(_sec('📅 壁垒事件日历热力（' + minD + ' ~ ' + maxD + '）', '<span style="font-size:10px;color:#5a7a99;font-weight:400;margin-left:8px">颜色=当日事件量 · 悬停看明细</span>') +
        '<div class="fs-cal">' + cal.map(function (x) {
          var inten = x.n / maxN;
          var bg = x.red ? 'rgba(239,68,68,' + (0.25 + inten * 0.65) + ')' : x.china ? 'rgba(124,58,237,' + (0.25 + inten * 0.65) + ')' : 'rgba(0,212,255,' + (0.08 + inten * 0.55) + ')';
          return '<div class="cell" style="background:' + bg + '" title="' + x.date + '：' + x.n + ' 条（涉华 ' + x.china + '，红级 ' + x.red + '）"></div>';
        }).join('') + '</div>' +
        '<div class="fs-mini"><span style="color:#ff5577">■</span> 当日有红级　<span style="color:#c084fc">■</span> 当日涉华　<span style="color:#00d4ff">■</span> 常规壁垒</div>');
      /* 国别×类别矩阵 */
      var mtx = d.matrix;
      /* #766 P2-①：制裁清单类别挂「碰撞筛查」交叉链接 → sanctions（制裁名单碰撞，实体级 OpenSanctions 12 源） */
      h += _panel(_sec('🗺️ 国别 × 壁垒类别矩阵（TOP 20 国别）', '<span style="font-size:10px;color:#00d4ff;cursor:pointer;margin-left:8px;font-weight:400" title="跳转制裁名单碰撞：中资 35 企/项目 + 供应商 OpenSanctions 实体级筛查" onclick="navigateTo(\'sanctions\')">制裁清单 · 实体碰撞筛查 →</span>') +
        '<table class="fs-tbl"><tr><th>国别</th><th>贸易救济</th><th>出口管制</th><th>投资审查</th><th>制裁清单</th><th>合计</th><th>涉华</th><th>红级</th></tr>' +
        mtx.map(function (m) {
          return '<tr><td><b>' + _esc(m.country) + '</b></td><td>' + m.trade_remedy + '</td><td>' + m.export_control + '</td><td>' + m.investment_screen + '</td><td>' + m.sanctions + '</td><td><b>' + m.total + '</b></td><td>' + (m.china ? '<span style="color:#c084fc;font-weight:700">' + m.china + '</span>' : '0') + '</td><td>' + (m.red ? '<span style="color:#ff5577;font-weight:700">' + m.red + '</span>' : '0') + '</td></tr>';
        }).join('') + '</table>');
      /* 涉华壁垒 + 近期流 */
      var cnH = d.chinaList.length
        ? d.chinaList.map(function (e) {
          return '<div class="fs-ev"><div class="t">' + _lvTag(e.level) + '<span style="font-size:10px;font-weight:700;color:#c084fc;margin:0 4px">' + _esc(e.cat) + '</span>' + _esc(e.title) + '</div><div class="m"><span>' + _esc(e.country) + '</span><span>' + _esc(e.time) + '</span><span>' + _esc(e.source) + '</span>' + (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
        }).join('')
        : '<div class="fs-empty">60 天窗口内无涉华壁垒事件</div>';
      var rcH = d.recent.map(function (e) {
        return '<div class="fs-ev"><div class="t">' + _lvTag(e.level) + ' ' + _chinaTag(e.china) + '<span style="font-size:10px;color:#8fb3d9;margin:0 4px">' + _esc(e.cat) + '</span>' + _esc(e.title) + '</div><div class="m"><span>' + _esc(e.country) + '</span><span>' + _esc(e.time) + '</span>' + (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
      }).join('');
      h += '<div class="fs-grid2">' + _panel(_sec('🇨🇳 涉华壁垒清单', '<span style="font-size:10px;color:#c084fc;font-weight:400;margin-left:8px">' + d.chinaList.length + ' 条 · 对华准入/管制/制裁动作</span><span style="font-size:10px;color:#00d4ff;cursor:pointer;margin-left:8px;font-weight:400" onclick="navigateTo(\'sanctions\')">碰撞筛查 →</span>') + cnH, true) +
        _panel(_sec('📋 近期壁垒事件流（全量最新 40 条）') + rcH) + '</div>';
      h += '<div class="fs-note"><b>数据口径：</b>全部为真实采集库 60 天窗口内命中壁垒词表（反倾销/关税/出口管制/投资审查/制裁/实体清单等中英文）的事件；分类按标题词表匹配；「涉华」为严格涉华检测命中。前瞻提示：壁垒事件通常有立案→初裁→终裁→生效长周期，本日历按采集时间排序，用于跟踪各国对华/对第三国准入政策的动态节奏。生成时间：' + _esc(d.generatedAt) + '</div>';
      root.innerHTML = h;
    }
  };

  /* ============================================================
   * #749/#761 统一应急中心（EVACPLAN 双 tab）
   *   tab1 结构化基线预案：收编 EMERGENCY_CENTER（国别指挥带/项目风险矩阵/
   *       场景化撤离路线/使领馆热线/空港海港/避难所/实时预警，真实档案）
   *   tab2 AI 深度预案：/api/insight/evac-plan 五段式 LLM 参谋级预案
   * ============================================================ */
  var EVACPLAN = {
    _busy: false, _tab: 'base', _hot: ['巴基斯坦', '缅甸', '阿富汗', '伊朗', '尼日利亚', '苏丹', '马里', '刚果（金）', '埃塞俄比亚', '乌克兰', '以色列', '俄罗斯', '印度尼西亚', '老挝', '哈萨克斯坦'],
    init: function () {
      var root = document.getElementById('evac-root');
      if (!root) return;
      root.className = 'fs-root';
      var me = this;
      root.innerHTML = _head('🚁', '统一应急中心 · 撤离与应急方案', '双轨应急：结构化基线预案（真实国别应急档案：撤离路线/使领馆/空港海港/避难所）+ AI 深度预案（真实项目档案与近 14 天红级事件 → Kimi 参谋级五段式）', '#ff9944') +
        '<div style="display:flex;gap:0;margin-bottom:12px;border-bottom:1px solid rgba(0,212,255,.18)">' +
          '<button class="evac-tab-btn' + (this._tab === 'base' ? ' on' : '') + '" id="evac-tab-btn-base" onclick="EVACPLAN.switchTab(\'base\')">📗 结构化基线预案<span style="font-weight:400;font-size:10px;margin-left:6px">国别应急档案 · 即时渲染</span></button>' +
          '<button class="evac-tab-btn' + (this._tab === 'ai' ? ' on' : '') + '" id="evac-tab-btn-ai" onclick="EVACPLAN.switchTab(\'ai\')">🤖 AI 深度预案<span style="font-weight:400;font-size:10px;margin-left:6px">参谋级五段式 · 60-150 秒</span></button>' +
        '</div>' +
        '<div id="evac-tab-base" style="display:' + (this._tab === 'base' ? '' : 'none') + '">' +
          '<div id="evac-baseline"></div>' +
        '</div>' +
        '<div id="evac-tab-ai" style="display:' + (this._tab === 'ai' ? '' : 'none') + '">' +
          _panel('<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<select id="evac-country" class="fs-sel" style="min-width:180px">' + this._hot.map(function (c) { return '<option value="' + _esc(c) + '">' + _esc(c) + '</option>'; }).join('') + '<option value="__other">✎ 其他国别（手输）</option></select>' +
            '<input id="evac-country-x" class="fs-inp" placeholder="输入国别中文名" style="display:none;min-width:180px">' +
            '<button class="fs-btn" id="evac-gen" onclick="EVACPLAN.gen()">⚡ 生成撤离应急预案</button>' +
            '<span style="font-size:10px;color:#5a7a99">生成约 60-150 秒（Kimi 参谋级）；按国别 10 分钟缓存</span></div>') +
          '<div id="evac-out"></div>' +
        '</div>';
      var sel = document.getElementById('evac-country'), inp = document.getElementById('evac-country-x');
      if (sel) sel.addEventListener('change', function () { inp.style.display = sel.value === '__other' ? '' : 'none'; });
      if (this._tab === 'base') this.renderBase();
    },
    switchTab: function (t) {
      this._tab = t;
      var b = document.getElementById('evac-tab-base'), a = document.getElementById('evac-tab-ai');
      var bb = document.getElementById('evac-tab-btn-base'), ab = document.getElementById('evac-tab-btn-ai');
      if (b) b.style.display = t === 'base' ? '' : 'none';
      if (a) a.style.display = t === 'ai' ? '' : 'none';
      if (bb) bb.className = 'evac-tab-btn' + (t === 'base' ? ' on' : '');
      if (ab) ab.className = 'evac-tab-btn' + (t === 'ai' ? ' on' : '');
      if (t === 'base') this.renderBase();
    },
    /* tab1：结构化基线预案（EMERGENCY_CENTER 收编渲染） */
    renderBase: function (country) {
      if (typeof EMERGENCY_CENTER === 'undefined') {
        var el = document.getElementById('evac-baseline');
        if (el) el.innerHTML = '<div class="fs-empty">应急基线档案引擎未加载</div>';
        return;
      }
      EMERGENCY_CENTER.renderTo('evac-baseline', country || undefined);
    },
    /* 外部跳转预选国别（国别抽屉/监测中心联动） */
    preselectCountry: function (country) {
      if (!country) return;
      /* AI tab 选择器同步 */
      var sel = document.getElementById('evac-country'), inp = document.getElementById('evac-country-x');
      if (sel) {
        var has = Array.prototype.some.call(sel.options, function (o) { return o.value === country; });
        if (has) { sel.value = country; if (inp) inp.style.display = 'none'; }
        else { sel.value = '__other'; if (inp) { inp.value = country; inp.style.display = ''; } }
      }
      /* 基线 tab 直接渲染该国 */
      if (typeof EMERGENCY_CENTER !== 'undefined') EMERGENCY_CENTER.currentCountry = country;
      if (this._tab === 'base') this.renderBase(country);
    },
    gen: function () {
      if (this._busy) return;
      var sel = document.getElementById('evac-country'), inp = document.getElementById('evac-country-x');
      if (!sel) return;
      var country = sel.value === '__other' ? (inp.value || '').trim() : sel.value;
      if (!country) { alert('请输入国别'); return; }
      var out = document.getElementById('evac-out');
      this._busy = true;
      var btn = document.getElementById('evac-gen'); if (btn) btn.disabled = true;
      out.innerHTML = '<div class="fs-load">⟳ 正在生成「' + _esc(country) + '」撤离应急预案（装配真实项目档案 + 近 14 天红级事件 → Kimi 参谋级五段式）…</div>';
      var me = this;
      _api('POST', '/evac-plan', { country: country }).then(function (j) {
        me._busy = false; if (btn) btn.disabled = false;
        if (!j || !j.ok) { out.innerHTML = '<div class="fs-empty">生成失败：' + _esc(j && j.error || '网络错误') + '</div>'; return; }
        me.render(j);
      }).catch(function (e) {
        me._busy = false; if (btn) btn.disabled = false;
        out.innerHTML = '<div class="fs-empty">网络失败：' + _esc(e.message) + '</div>';
      });
    },
    render: function (j) {
      var out = document.getElementById('evac-out');
      if (!out) return;
      var c = j.ctxStats || {};
      var h = '<div class="fs-kpis">' +
        '<div class="fs-kpi"><div class="v">' + c.projCount + '</div><div class="l">在册项目</div></div>' +
        '<div class="fs-kpi"><div class="v">' + (c.investment || 0) + '</div><div class="l">账面投资（亿美元）</div></div>' +
        '<div class="fs-kpi"><div class="v">' + (c.personnel || 0) + '</div><div class="l">驻外人员（注册表口径）</div></div>' +
        '<div class="fs-kpi"><div class="v red">' + c.red14d + '</div><div class="l">近 14 天红级事件</div></div>' +
        '<div class="fs-kpi"><div class="v">' + c.total30d + '</div><div class="l">近 30 天事件总量</div></div></div>';
      h += '<div class="fs-ai">' +
        '<div style="margin-bottom:8px"><span class="badge" style="background:rgba(124,58,237,.16);color:#c4b5fd;border:1px solid rgba(124,58,237,.4)">' + (j.llmOk ? '🤖 Kimi 参谋级预案' : '⚙️ 规则模板引擎') + '</span><span class="badge" style="background:rgba(249,115,22,.12);color:#ff9944;border:1px solid rgba(249,115,22,.4)">' + _esc(j.country) + '</span><span class="badge" style="background:rgba(255,204,0,.08);color:#ffcc00;border:1px solid rgba(255,204,0,.25)">' + _esc(j.generatedAt) + '</span></div>' +
        (j.situ ? '<div class="seg"><b>【形势研判】</b>\n' + _esc(j.situ) + '</div>' : '') +
        (j.level ? '<div class="seg"><b>【撤离分级】</b>\n' + _esc(j.level) + '</div>' : '') +
        (j.route ? '<div class="seg"><b>【撤离路线与交通】</b>\n' + _esc(j.route) + '</div>' : '') +
        (j.stay ? '<div class="seg"><b>【驻留与保障】</b>\n' + _esc(j.stay) + '</div>' : '') +
        (j.comm ? '<div class="seg"><b>【联络与应急机制】</b>\n' + _esc(j.comm) + '</div>' : '') +
        '<div class="fs-note">' + _esc(j.note) + '</div></div>';
      var projs = j.projects || [];
      var reds = j.redEvents || [];
      var projH = projs.length
        ? '<table class="fs-tbl"><tr><th>项目</th><th>企业</th><th>位置</th><th>行业</th><th>投资</th><th>人员</th></tr>' +
          projs.map(function (p) { return '<tr><td>' + _esc(p.name) + '</td><td>' + _esc(p.enterprise) + '</td><td>' + _esc(p.location || p.country || '') + '</td><td>' + _esc(p.sector) + '</td><td>' + _esc(p.invTxt || '—') + '</td><td>' + (p.personnel || '—') + '</td></tr>'; }).join('') + '</table>'
        : '<div class="fs-empty">该国无在册中资项目档案（预案按人员安全口径生成）</div>';
      var redH = reds.length
        ? reds.map(function (e) {
          return '<div class="fs-ev"><div class="t">' + _lvTag(e.level) + ' ' + _esc(e.title) + '</div><div class="m"><span>' + _esc(e.time) + '</span>' + (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
        }).join('')
        : '<div class="fs-empty">近 14 天无红/橙级事件</div>';
      /* 国别应急指南（EMERGENCY_GUIDE 真实档案） */
      var guide = (typeof EMERGENCY_GUIDE !== 'undefined' && EMERGENCY_GUIDE.byCountry) ? EMERGENCY_GUIDE.byCountry(j.country) : null;
      var guideH = '';
      if (guide) {
        guideH = _panel(_sec('📗 国别应急指南（真实档案）') +
          (guide.airports && guide.airports.length ? '<div class="fs-mini" style="margin-bottom:6px"><b>✈️ 主要空港：</b>' + guide.airports.map(function (a) { return _esc(a.name) + '（' + _esc(a.iata || '') + '·' + _esc(a.city || '') + '）'; }).join('；') + '</div>' : '') +
          (guide.seaports && guide.seaports.length ? '<div class="fs-mini" style="margin-bottom:6px"><b>⚓ 主要海港：</b>' + guide.seaports.map(function (s) { return _esc(s); }).join('；') + '</div>' : '') +
          (guide.embassies && guide.embassies.length ? '<div class="fs-mini" style="margin-bottom:6px"><b>🏛️ 使领馆：</b>' + guide.embassies.map(function (e) { return _esc(e.name || e) + (e.phone ? '（' + _esc(e.phone) + '）' : ''); }).join('；') + '</div>' : '') +
          (guide.shelters && guide.shelters.length ? '<div class="fs-mini" style="margin-bottom:6px"><b>🛡️ 推定避难所：</b>' + guide.shelters.map(function (s) { return _esc(typeof s === 'string' ? s : s.name); }).join('；') + '</div>' : '') +
          '<div class="fs-mini" style="margin-bottom:6px"><b>📞 领保兜底热线：</b>外交部全球领事保护与服务应急热线 +86-10-12308（24 小时）</div>', true);
      }
      h += '<div class="fs-grid2">' + _panel(_sec('🏭 在册中资项目档案（真实库）', '<span style="font-size:10px;color:#5a7a99;font-weight:400;margin-left:8px">' + projs.length + ' 个</span>') + projH) +
        _panel(_sec('🚨 近 14 天红/橙级事件（真实采集）') + redH) + '</div>';
      h += guideH;
      out.innerHTML = h;
    }
  };

  /* ============================================================
   * #750 境外社媒舆情监测
   * ============================================================ */
  var SOCPULSE = {
    _d: null,
    init: function () {
      var root = document.getElementById('socpulse-root');
      if (!root) return;
      root.className = 'fs-root';
      root.innerHTML = '<div class="fs-load">⟳ 正在加载境外社媒舆情（真实库 7 天窗口：TG/Reddit 采集 + 社媒哨兵）…</div>';
      var me = this;
      _api('GET', '/social-pulse').then(function (j) {
        me._d = j && j.ok ? j : null;
        me.render();
      }).catch(function (e) { root.innerHTML = '<div class="fs-empty">加载失败：' + _esc(e.message) + '</div>'; });
    },
    render: function () {
      var d = this._d; var root = document.getElementById('socpulse-root');
      if (!root) return;
      if (!d) { root.innerHTML = '<div class="fs-empty">暂无数据</div>'; return; }
      var s = d.stats;
      var PLAT = { telegram: 'Telegram', reddit: 'Reddit', mastodon: 'Mastodon（社媒哨兵）' };
      var h = _head('📡', '境外社媒舆情监测', 'Telegram 公开频道 / Reddit / Mastodon 哨兵 → 相关性闸门 → 实体关联 → 入库聚合（真实库 7 天窗口；社媒为未证实开源线索 D 级）', '#c084fc');
      h += '<div class="fs-kpis">' +
        '<div class="fs-kpi"><div class="v">' + s.total + '</div><div class="l">社媒情报 7d</div></div>' +
        '<div class="fs-kpi"><div class="v violet">' + s.china + '</div><div class="l">涉华舆情</div></div>' +
        '<div class="fs-kpi"><div class="v">' + s.chinaPct + '%</div><div class="l">涉华占比</div></div>' +
        '<div class="fs-kpi"><div class="v red">' + s.red + '</div><div class="l">红级</div></div>' +
        '<div class="fs-kpi"><div class="v" style="color:#ff9944">' + s.orange + '</div><div class="l">橙级</div></div>' +
        '<div class="fs-kpi"><div class="v">' + s.channels + '</div><div class="l">活跃频道</div></div></div>';
      /* 日趋势 */
      var days = d.byDay, maxD = Math.max.apply(null, days.map(function (x) { return x.n; }).concat([1]));
      h += _panel(_sec('📈 入库日趋势（7 天）') +
        '<div style="display:flex;gap:6px;align-items:flex-end;height:90px">' + days.map(function (x) {
          var hpx = Math.max(4, Math.round(x.n / maxD * 80));
          return '<div style="flex:1;text-align:center" title="' + x.date + '：' + x.n + ' 条（涉华 ' + x.china + '，红级 ' + x.red + '）">' +
            '<div style="height:' + hpx + 'px;border-radius:4px 4px 0 0;background:' + (x.red ? 'rgba(239,68,68,.55)' : x.china ? 'rgba(124,58,237,.5)' : 'rgba(0,212,255,.4)') + '"></div>' +
            '<div class="fs-mini" style="margin-top:3px">' + x.n + '</div><div class="fs-mini">' + x.date.slice(5) + '</div></div>';
        }).join('') + '</div>');
      /* 平台/频道/国别 */
      var maxCh = Math.max.apply(null, d.byChannel.map(function (x) { return x.n; }).concat([1]));
      var maxCo = Math.max.apply(null, d.byCountry.map(function (x) { return x.n; }).concat([1]));
      h += '<div class="fs-grid3">' +
        _panel(_sec('📱 平台分布') + d.byPlatform.map(function (x) { return '<div class="fs-mini"><b>' + (PLAT[x.platform] || x.platform) + '</b>：' + x.n + ' 条' + _bar(x.n, s.total, '#c084fc') + '</div>'; }).join('')) +
        _panel(_sec('📻 频道/来源 TOP 20') + d.byChannel.map(function (x) { return '<div class="fs-mini">' + _esc(x.channel) + ' <b>' + x.n + '</b>' + _bar(x.n, maxCh) + '</div>'; }).join('')) +
        _panel(_sec('🌍 国别分布 TOP 12') + d.byCountry.map(function (x) { return '<div class="fs-mini">' + _esc(x.country) + ' <b>' + x.n + '</b>' + _bar(x.n, maxCo, '#c084fc') + '</div>'; }).join('')) +
        '</div>';
      /* 涉华舆情流 + 全量流 */
      var cnH = d.chinaFeed.length
        ? d.chinaFeed.map(function (e) {
          return '<div class="fs-ev"><div class="t">' + _lvTag(e.level) + '<span style="font-size:10px;font-weight:700;color:#c084fc;margin:0 4px">' + (PLAT[e.platform] || e.platform) + '</span>' + _esc(e.title) + '</div><div class="m"><span>' + _esc(e.country) + '</span><span>' + _esc(e.time) + '</span><span>' + _esc(e.source) + '</span>' + (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
        }).join('')
        : '<div class="fs-empty">7 天窗口内无涉华社媒舆情命中</div>';
      var fdH = d.feed.map(function (e) {
        return '<div class="fs-ev"><div class="t">' + _lvTag(e.level) + ' ' + _chinaTag(e.china) + '<span style="font-size:10px;color:#8fb3d9;margin:0 4px">' + (PLAT[e.platform] || e.platform) + '</span>' + _esc(e.title) + '</div><div class="m"><span>' + _esc(e.country) + '</span><span>' + _esc(e.time) + '</span>' + (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
      }).join('');
      h += '<div class="fs-grid2">' + _panel(_sec('🇨🇳 涉华舆情流', '<span style="font-size:10px;color:#c084fc;font-weight:400;margin-left:8px">' + d.chinaFeed.length + ' 条 · 境外社媒涉华讨论</span>') + cnH, true) +
        _panel(_sec('📋 全量舆情流（最新 40 条）') + fdH) + '</div>';
      h += '<div class="fs-note"><b>数据口径：</b>全部为库内真实入库的社媒通道情报（Telegram t.me 公开频道预览页 + Reddit 官方 RSS + Mastodon 哨兵），经过 24-60h 时效闸、软性垃圾闸与涉华闸门后入库；社媒属未证实开源线索（默认 D 级可信度），涉华标记为库内严格检测命中。通道不可达时段计数如实为 0，绝不填充。生成时间：' + _esc(d.generatedAt) + '</div>';
      root.innerHTML = h;
    }
  };

  window.SUPPLY = SUPPLY;
  window.BARRIER = BARRIER;
  window.EVACPLAN = EVACPLAN;
  window.SOCPULSE = SOCPULSE;
})();
