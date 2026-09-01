/* ============================================================
 * model-analysis.js — 「专题分析模型」结果展示层（2026-09-02 新增功能区）
 * ================================================================
 * 定位：分析型子功能区（只读复用平台已采集数据），四大专题模型：
 *   ① 组织行动模式行为分析（偏好熵 + KL 偏离 + 节律热力 + 组织对比雷达）
 *   ② 国别恐袭行动模型（Hawkes 自激励 + 回测 + 手法矩阵 + 组织贡献）
 *   ③ 绑架行动模型（国家密度/趋势 + 对象风险清单 + 时段热力 + 相似案例）
 *   ④ 国别地缘安全风险（六维加权 R + CUSUM 变点 + 归因瀑布 + 情景推演）
 * 数据：全部来自 /api/models/* 服务端透明计算；零模拟，样本不足灰显。
 * 注册：index.html 侧边栏 data-view="models" + view-models 容器 +
 *       app.js VIEW_MAP/runViewInit + role-ui.js VIEW_LABELS。
 * ================================================================ */
(function () {
  'use strict';

  var LV = {
    red: { c: '#ff3355', n: '红' }, orange: { c: '#ff8800', n: '橙' },
    yellow: { c: '#ffcc00', n: '黄' }, blue: { c: '#00d4ff', n: '蓝' }
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function fetchJSON(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }

  /* ============ SVG 图表构造器（内联，深空蓝黑风格）============ */
  /* 雷达图：axes=[{label}], series=[{name,color,values[0-1]}] */
  function svgRadar(axes, series, size) {
    size = size || 240;
    var cx = size / 2, cy = size / 2, R = size / 2 - 34;
    var n = axes.length;
    if (!n) return '';
    function pt(i, v) {
      var a = -Math.PI / 2 + (2 * Math.PI * i / n);
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    }
    var s = '<svg viewBox="0 0 ' + size + ' ' + size + '" style="width:100%;max-width:' + size + 'px">';
    for (var g = 1; g <= 4; g++) {
      var poly = [];
      for (var i = 0; i < n; i++) { var p = pt(i, g / 4); poly.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      s += '<polygon points="' + poly.join(' ') + '" fill="none" stroke="rgba(0,212,255,0.15)" stroke-width="1"/>';
    }
    for (var i2 = 0; i2 < n; i2++) {
      var p2 = pt(i2, 1), p0 = pt(i2, 0);
      s += '<line x1="' + p0[0].toFixed(1) + '" y1="' + p0[1].toFixed(1) + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '" stroke="rgba(0,212,255,0.15)"/>';
      var lp = pt(i2, 1.22);
      s += '<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" fill="#7a8ba3" font-size="10" text-anchor="middle" dominant-baseline="middle">' + esc(axes[i2].label) + '</text>';
    }
    series.forEach(function (se) {
      var poly = [], dots = '';
      for (var i = 0; i < n; i++) {
        var v = Math.max(0, Math.min(1, se.values[i] || 0));
        var p = pt(i, v);
        poly.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
        dots += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.5" fill="' + se.color + '"/>';
      }
      s += '<polygon points="' + poly.join(' ') + '" fill="' + se.color + '22" stroke="' + se.color + '" stroke-width="1.6"/>' + dots;
    });
    s += '</svg>';
    return s;
  }
  /* 热力图：rows 标签 × cols 标签 × 数值矩阵 */
  function svgHeat(matrix, rowLabels, colLabels, colLabelEvery) {
    var rows = matrix.length, cols = matrix[0] ? matrix[0].length : 0;
    if (!rows || !cols) return '';
    var cw = Math.min(26, 560 / cols), ch = 20, x0 = 52, y0 = 18;
    var max = 0;
    matrix.forEach(function (r) { r.forEach(function (v) { if (v > max) max = v; }); });
    var W = x0 + cols * cw + 8, H = y0 + rows * ch + 20;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    function cellColor(v) {
      if (max <= 0) return 'rgba(0,212,255,0.06)';
      var t = v / max;
      var r = Math.round(0 + t * 255), g = Math.round(60 + (1 - t) * 120), b = Math.round(120 + (1 - t) * 30);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + (0.12 + 0.78 * t) + ')';
    }
    for (var c = 0; c < cols; c++) {
      if (colLabelEvery && c % colLabelEvery !== 0) continue;
      s += '<text x="' + (x0 + c * cw + cw / 2) + '" y="12" fill="#4a5a70" font-size="8" text-anchor="middle">' + esc(colLabels[c] || '') + '</text>';
    }
    for (var ri = 0; ri < rows; ri++) {
      s += '<text x="' + (x0 - 4) + '" y="' + (y0 + ri * ch + ch / 2 + 3) + '" fill="#7a8ba3" font-size="9" text-anchor="end">' + esc(rowLabels[ri] || '') + '</text>';
      for (var ci = 0; ci < cols; ci++) {
        var v = matrix[ri][ci];
        s += '<rect x="' + (x0 + ci * cw + 1) + '" y="' + (y0 + ri * ch + 1) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="2" fill="' + cellColor(v) + '"' + (v > 0 ? '><title>' + esc(rowLabels[ri]) + ' ' + esc(colLabels[ci]) + '：' + v + '</title></rect>' : '/>');
      }
    }
    s += '</svg>';
    return s;
  }
  /* 折线/面积曲线：points=[{x,y,label?}], opts={color, fill, h, yLabel, marks:[{x,label,color}]} */
  function svgLine(points, opts) {
    opts = opts || {};
    if (!points.length) return '';
    var W = 620, H = opts.h || 150, pl = 44, pr = 10, pt = 12, pb = 22;
    var xs = points.map(function (p) { return p.x; }), ys = points.map(function (p) { return p.y; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var ymin = Math.min(0, Math.min.apply(null, ys)), ymax = Math.max.apply(null, ys);
    if (ymax === ymin) ymax = ymin + 1;
    function X(x) { return pl + (xmax === xmin ? 0 : (x - xmin) / (xmax - xmin) * (W - pl - pr)); }
    function Y(y) { return H - pb - (y - ymin) / (ymax - ymin) * (H - pt - pb); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    for (var g = 0; g <= 4; g++) {
      var yv = ymin + (ymax - ymin) * g / 4, yy = Y(yv);
      s += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="rgba(0,212,255,0.08)"/>';
      s += '<text x="' + (pl - 4) + '" y="' + (yy + 3) + '" fill="#4a5a70" font-size="9" text-anchor="end">' + (Math.round(yv * 10) / 10) + '</text>';
    }
    var d = '';
    points.forEach(function (p, i) { d += (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1) + ' '; });
    if (opts.fill) {
      s += '<path d="' + d + 'L' + X(xmax).toFixed(1) + ' ' + Y(ymin) + ' L' + X(xmin).toFixed(1) + ' ' + Y(ymin) + ' Z" fill="' + opts.fill + '"/>';
    }
    s += '<path d="' + d + '" fill="none" stroke="' + (opts.color || '#00d4ff') + '" stroke-width="1.8"/>';
    points.forEach(function (p, i) {
      if (p.label !== undefined && (points.length <= 12 || i % Math.ceil(points.length / 8) === 0)) {
        s += '<text x="' + X(p.x).toFixed(1) + '" y="' + (H - 6) + '" fill="#4a5a70" font-size="8" text-anchor="middle">' + esc(p.label) + '</text>';
      }
    });
    (opts.marks || []).forEach(function (m) {
      s += '<line x1="' + X(m.x).toFixed(1) + '" y1="' + pt + '" x2="' + X(m.x).toFixed(1) + '" y2="' + (H - pb) + '" stroke="' + (m.color || '#ff3355') + '" stroke-dasharray="3,3" stroke-width="1"/>';
      s += '<text x="' + X(m.x).toFixed(1) + '" y="' + (pt + 2) + '" fill="' + (m.color || '#ff3355') + '" font-size="9" text-anchor="middle">' + esc(m.label) + '</text>';
    });
    if (opts.legend) s += '<text x="' + (W - pr) + '" y="' + (pt + 2) + '" fill="#7a8ba3" font-size="9" text-anchor="end">' + esc(opts.legend) + '</text>';
    s += '</svg>';
    return s;
  }
  /* 柱状图：items=[{label,value,color?}], opts={unit} */
  function svgBars(items, opts) {
    opts = opts || {};
    if (!items.length) return '';
    var W = 560, rowH = 20, H = items.length * rowH + 10, x0 = 110;
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })) || 1;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    items.forEach(function (it, i) {
      var y = i * rowH + 5;
      var w = Math.abs(it.value) / max * (W - x0 - 60);
      var neg = it.value < 0;
      var x = neg ? x0 + (W - x0 - 60) / 2 - w : x0 + (W - x0 - 60) / 2;
      if (neg) x = x0 + (W - x0 - 60) / 2 - w;
      else x = x0 + (W - x0 - 60) / 2;
      s += '<text x="' + (x0 - 6) + '" y="' + (y + 12) + '" fill="#7a8ba3" font-size="10" text-anchor="end">' + esc(it.label) + '</text>';
      s += '<rect x="' + (neg ? x : x0 + (W - x0 - 60) / 2) + '" y="' + y + '" width="' + Math.max(1, w) + '" height="14" rx="2" fill="' + (it.color || (neg ? '#ff3355' : '#00d4ff')) + '" opacity="0.85"><title>' + esc(it.label) + '：' + it.value + (opts.unit || '') + '</title></rect>';
      s += '<text x="' + (x0 + (W - x0 - 60) / 2 + (neg ? -w - 4 : w + 4)) + '" y="' + (y + 12) + '" fill="' + (it.tc || '#e2e8f0') + '" font-size="10" text-anchor="' + (neg ? 'end' : 'start') + '">' + it.value + (opts.unit || '') + '</text>';
    });
    s += '</svg>';
    return s;
  }
  /* 瀑布图：items=[{name,delta}] 起始 base */
  function svgWaterfall(base, items) {
    if (!items.length) return '';
    var W = 560, H = 200, x0 = 40, pb = 40, pt = 16;
    var cum = base, vals = [base];
    items.forEach(function (it) { cum += it.delta; vals.push(cum); });
    var min = Math.min.apply(null, vals.concat([0])), max = Math.max.apply(null, vals) || 1;
    if (max === min) max = min + 1;
    var bw = (W - x0 - 10) / (items.length + 1);
    function Y(v) { return H - pb - (v - min) / (max - min) * (H - pt - pb); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    for (var g = 0; g <= 3; g++) {
      var yv = min + (max - min) * g / 3, yy = Y(yv);
      s += '<line x1="' + x0 + '" y1="' + yy + '" x2="' + (W - 4) + '" y2="' + yy + '" stroke="rgba(0,212,255,0.08)"/>';
      s += '<text x="' + (x0 - 4) + '" y="' + (yy + 3) + '" fill="#4a5a70" font-size="9" text-anchor="end">' + (Math.round(yv * 10) / 10) + '</text>';
    }
    var prev = base;
    s += '<rect x="' + x0 + '" y="' + Math.min(Y(base), Y(0)) + '" width="' + (bw * 0.7) + '" height="' + Math.abs(Y(base) - Y(0)) + '" fill="#7a8ba3" opacity="0.8"/>';
    s += '<text x="' + (x0 + bw * 0.35) + '" y="' + (H - pb + 12) + '" fill="#7a8ba3" font-size="9" text-anchor="middle">上期R</text>';
    s += '<text x="' + (x0 + bw * 0.35) + '" y="' + (Y(base) - 4) + '" fill="#e2e8f0" font-size="10" text-anchor="middle" font-weight="700">' + (Math.round(base * 10) / 10) + '</text>';
    items.forEach(function (it, i) {
      var x = x0 + (i + 1) * bw;
      var y1 = Math.min(Y(prev), Y(prev + it.delta)), hh = Math.abs(Y(prev + it.delta) - Y(prev));
      var col = it.delta >= 0 ? '#ff8800' : '#00ff9f';
      s += '<rect x="' + x + '" y="' + y1 + '" width="' + (bw * 0.7) + '" height="' + Math.max(1, hh) + '" fill="' + col + '"><title>' + esc(it.name) + '：' + (it.delta > 0 ? '+' : '') + it.delta + '</title></rect>';
      s += '<text x="' + (x + bw * 0.35) + '" y="' + (H - pb + 12) + '" fill="#7a8ba3" font-size="9" text-anchor="middle">' + esc(it.name) + '</text>';
      s += '<text x="' + (x + bw * 0.35) + '" y="' + (y1 - 3) + '" fill="' + col + '" font-size="9" text-anchor="middle">' + (it.delta > 0 ? '+' : '') + it.delta + '</text>';
      prev += it.delta;
    });
    var fx = x0 + items.length * bw;
    s += '<rect x="' + fx + '" y="' + Math.min(Y(prev), Y(0)) + '" width="' + (bw * 0.7) + '" height="' + Math.abs(Y(prev) - Y(0)) + '" fill="#00d4ff" opacity="0.9"/>';
    s += '<text x="' + (fx + bw * 0.35) + '" y="' + (H - pb + 12) + '" fill="#7a8ba3" font-size="9" text-anchor="middle">当期R</text>';
    s += '<text x="' + (fx + bw * 0.35) + '" y="' + (Y(prev) - 4) + '" fill="#00d4ff" font-size="10" text-anchor="middle" font-weight="700">' + (Math.round(prev * 10) / 10) + '</text>';
    s += '</svg>';
    return s;
  }

  /* ============ 主对象 ============ */
  var MA = {
    _tab: 'orgs',
    _country: '',
    _org: '',
    _cmpSel: [],
    _inited: false,
    _geoWeights: null, /* 用户可调权重 */
    _geoScenario: null, /* 情景推演增量 */

    init: function () {
      var self = this;
      var root = document.getElementById('models-root');
      if (!root) return;
      if (!this._inited) {
        root.innerHTML = this._skeleton();
        this._inited = true;
        Array.prototype.forEach.call(root.querySelectorAll('.dc-tab[data-tab]'), function (b) {
          b.addEventListener('click', function () { self._switchTab(b.getAttribute('data-tab')); });
        });
        root.addEventListener('change', function (e) {
          var t = e.target;
          if (t.id === 'models-country') { self._country = t.value; self._renderTabBody(); }
          if (t.id === 'models-org') { self._org = t.value; self._renderOrgProfile(); }
          if (t.classList && t.classList.contains('geo-weight')) { self._onWeightChange(); }
        });
        root.addEventListener('click', function (e) {
          var t = e.target.closest ? e.target.closest('[data-org]') : null;
          if (t) { self._org = t.getAttribute('data-org'); self._renderOrgProfile(); }
        });
      }
      this._loadAlerts();
      this._renderTabBody();
    },

    _skeleton: function () {
      return '<div class="card" style="padding:14px">' +
        '<div class="card-tt"><span class="ic">🧮</span>专题分析模型 · 大数据分析与预警' +
          '<span id="models-meta" style="margin-left:10px;font-size:10px;color:var(--text3);font-weight:400"></span></div>' +
        '<div id="models-alerts" style="margin-bottom:10px"></div>' +
        '<div class="dc-tabs" id="models-tabs">' +
          '<span class="dc-tab active" data-tab="orgs">🎯 ① 组织行动模式</span>' +
          '<span class="dc-tab" data-tab="hawkes">💥 ② 国别恐袭</span>' +
          '<span class="dc-tab" data-tab="kidnap">⛓️ ③ 绑架</span>' +
          '<span class="dc-tab" data-tab="geo">🌐 ④ 地缘风险</span>' +
        '</div>' +
        '<div id="models-filters" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px"></div>' +
        '<div id="models-body"><div class="empty">加载中…</div></div>' +
        '</div>';
    },

    _switchTab: function (t) {
      this._tab = t;
      var self = this;
      Array.prototype.forEach.call(document.querySelectorAll('#models-tabs .dc-tab'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === t);
      });
      self._renderTabBody();
    },

    _filters: function (html) {
      document.getElementById('models-filters').innerHTML = html;
    },

    /* ============ 告警卡（第一阶段：功能区内展示）============ */
    _loadAlerts: function () {
      var self = this;
      fetchJSON('/api/models/alerts').then(function (d) {
        if (!d.ok || !d.alerts || !d.alerts.length) {
          var host = document.getElementById('models-alerts');
          if (host) host.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:4px 0">模型异动信号：暂无（各模型信号均在阈值内）</div>';
          return;
        }
        var host2 = document.getElementById('models-alerts');
        if (!host2) return;
        host2.innerHTML =
          '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">🚨 模型异动信号（' + d.alerts.length + ' 条 · 第一阶段功能区内呈现，预警中心接入留二期）</div>' +
          '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' + d.alerts.slice(0, 8).map(function (a) {
            var lv = LV[a.level] || LV.blue;
            return '<div style="min-width:240px;flex:1;border-left:3px solid ' + lv.c + ';background:var(--panel2);border-radius:6px;padding:8px 10px">' +
              '<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">' +
                '<span class="badge" style="background:' + lv.c + '22;color:' + lv.c + ';font-size:9px">' + lv.n + '级</span>' +
                '<span style="font-size:10px;color:var(--text3)">' + esc(a.model) + '</span></div>' +
              '<div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.4">' + esc(a.title) + '</div>' +
              '<div style="font-size:10px;color:var(--text3);margin-top:3px;line-height:1.4">' + esc(a.desc) + '</div></div>';
          }).join('') + '</div>';
      }).catch(function () {});
    },

    /* ============ Tab 分发 ============ */
    _renderTabBody: function () {
      if (this._tab === 'orgs') this._loadOrgs();
      else if (this._tab === 'hawkes') this._loadHawkes();
      else if (this._tab === 'kidnap') this._loadKidnap();
      else if (this._tab === 'geo') this._loadGeo();
    },

    /* ============ ① 组织行动模式 ============ */
    _loadOrgs: function () {
      var self = this;
      var body = document.getElementById('models-body');
      this._filters('<span style="font-size:11px;color:var(--text3)">数据源：threats.js 组织库 name+aliases 关键词归因（题名+正文前500字，不区分大小写）</span>');
      body.innerHTML = '<div class="empty">加载组织归因…</div>';
      fetchJSON('/api/models/orgs').then(function (d) {
        if (self._tab !== 'orgs') return;
        if (!d.ok) { body.innerHTML = '<div class="empty">' + esc(d.error || '加载失败') + '</div>'; return; }
        self._orgsData = d;
        if (!self._org || !d.orgs.some(function (o) { return o.id === self._org; })) {
          self._org = (d.orgs.find(function (o) { return o.sufficient; }) || d.orgs[0] || {}).id || '';
        }
        self._renderOrgs();
        self._renderOrgProfile();
      }).catch(function (e) { body.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; });
    },

    _renderOrgs: function () {
      var d = this._orgsData, self = this;
      var body = document.getElementById('models-body');
      var rows = d.orgs.slice(0, 20).map(function (o) {
        var dim = o.sufficient ? 'var(--text2)' : 'var(--text3)';
        var bg = o.id === self._org ? 'rgba(0,212,255,0.08)' : '';
        return '<tr data-org="' + esc(o.id) + '" style="cursor:pointer;background:' + bg + ';border-bottom:1px solid var(--border)">' +
          '<td style="padding:5px 8px;font-size:12px;color:var(--text)">' + esc(o.name) + (o.sufficient ? '' : ' <span style="font-size:9px;color:var(--text3)">（样本不足）</span>') + '</td>' +
          '<td style="padding:5px 8px;font-size:12px;color:' + (o.sufficient ? 'var(--cyan)' : dim) + ';font-weight:700">' + o.count + '</td></tr>';
      }).join('');
      body.innerHTML =
        '<div style="display:grid;grid-template-columns:260px 1fr;gap:14px" class="models-org-grid">' +
          '<div><div class="card-tt"><span class="ic">📋</span>组织事件量（归因映射）</div>' +
            '<div class="table-wrap" style="max-height:560px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg2)">' +
              '<th style="padding:6px 8px;font-size:11px">组织</th><th style="padding:6px 8px;font-size:11px">事件数</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<div style="font-size:10px;color:var(--text3);margin-top:6px">样本门槛 ≥' + d.minEvents + ' 起（不足灰显）· 共 ' + d.orgs.length + ' 个组织命中</div></div>' +
          '<div id="models-org-profile"><div class="empty">加载画像…</div></div>' +
        '</div>' +
        '<div id="models-org-compare" style="margin-top:14px"></div>';
    },

    _renderOrgProfile: function () {
      var self = this, host = document.getElementById('models-org-profile');
      if (!host) return;
      if (!this._org) { host.innerHTML = '<div class="empty">未选择组织</div>'; return; }
      host.innerHTML = '<div class="empty">加载 ' + esc(this._org) + ' 画像…</div>';
      fetchJSON('/api/models/orgs/profile?id=' + encodeURIComponent(this._org)).then(function (p) {
        if (!p.ok) { host.innerHTML = '<div class="empty">' + esc(p.error) + '</div>'; return; }
        /* 灰显路径：样本不足 */
        if (p.insufficient) {
          host.innerHTML = '<div class="card" style="opacity:0.55;text-align:center;padding:40px 20px">' +
            '<div style="font-size:32px;margin-bottom:8px">🚫</div>' +
            '<div style="font-size:15px;color:var(--text2);font-weight:700">样本不足</div>' +
            '<div style="font-size:12px;color:var(--text3);margin-top:6px">' + esc(p.org.name) + ' 历史归因事件仅 ' + p.count + ' 起（需 ≥' + p.minEvents + ' 起），不生成行为画像</div></div>';
          return;
        }
        function bars(dist, color) {
          var total = p.count;
          return dist.map(function (x) {
            return { label: x.n, value: Math.round(x.c / total * 1000) / 10, color: color, tc: 'var(--text2)' };
          });
        }
        var klBlock;
        if (p.kl) {
          klBlock = '<div class="card" style="background:var(--bg2);border-radius:8px;padding:10px">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">📉 行为偏离度 D(g)=KL(P_now‖P_base) <span style="font-size:10px;font-weight:400;color:var(--text3)">（观测窗 ' + p.obsDays + ' 天 ' + p.obsCount + ' 起 vs 基线 ' + p.baseCount + ' 起）</span></div>' +
            '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px">' +
              '<span>手法 <b style="color:' + (p.kl.method > p.klAlertThreshold ? 'var(--red)' : 'var(--cyan)') + '">' + p.kl.method + '</b></span>' +
              '<span>目标 <b style="color:' + (p.kl.target > p.klAlertThreshold ? 'var(--red)' : 'var(--cyan)') + '">' + p.kl.target + '</b></span>' +
              '<span>地域 <b style="color:' + (p.kl.region > p.klAlertThreshold ? 'var(--red)' : 'var(--cyan)') + '">' + p.kl.region + '</b></span>' +
              '<span>综合 <b style="color:' + (p.kl.overall > p.klAlertThreshold ? 'var(--red)' : 'var(--cyan)') + '">' + p.kl.overall + ' bit</b></span></div>' +
            (p.klAlert ? '<div style="margin-top:8px;padding:6px 10px;border-left:3px solid var(--red);background:rgba(255,51,85,0.08);border-radius:0 6px 6px 0;font-size:12px;color:var(--red);font-weight:700">⚠ 模式异动：KL 超过阈值 ' + p.klAlertThreshold + ' bit</div>' : '<div style="margin-top:6px;font-size:10px;color:var(--text3)">阈值 ' + p.klAlertThreshold + ' bit 内，无模式异动</div>') +
            (p.dSeries && p.dSeries.length ? '<div style="margin-top:8px">' + svgBars(p.dSeries.map(function (x) { return { label: x.label, value: x.d, color: x.d > p.klAlertThreshold ? '#ff3355' : '#00d4ff' }; }), { unit: '' }) + '<div style="font-size:9px;color:var(--text3)">近周 KL 滚动序列（手法维）</div></div>' : '') +
            '</div>';
        } else {
          klBlock = '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px;color:var(--text3)">KL 偏离度降级：观测窗/基线样本不足（观测 ' + p.obsCount + ' 起 / 基线 ' + p.baseCount + ' 起）</div>';
        }
        var heat = svgHeat(p.rhythm.heat, p.rhythm.weekLabels, ['日', '一', '二', '三', '四', '五', '六']);
        host.innerHTML =
          '<div class="card-tt"><span class="ic">🎯</span>' + esc(p.org.name) + ' 行为画像 <span style="font-size:10px;color:var(--text3);font-weight:400">' + p.count + ' 起归因事件 · ' + esc(p.org.status || '') + '</span>' +
            (p.klAlert ? '<span class="badge b-red" style="font-size:9px;margin-left:8px">模式异动</span>' : '') + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="models-p2">' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:4px">💥 手法偏好分布 <span style="color:var(--text3)">（熵 H=' + p.entropy.method + ' bit，越低越专一）</span></div>' + svgBars(bars(p.methodDist, '#00d4ff'), { unit: '%' }) + '</div>' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:4px">🎯 目标类型分布 <span style="color:var(--text3)">（熵 H=' + p.entropy.target + ' bit）</span></div>' + svgBars(bars(p.targetDist, '#ff8800'), { unit: '%' }) + '</div>' +
          '</div>' +
          '<div style="margin-top:10px"><div style="font-size:11px;color:var(--text2);margin-bottom:4px">🌍 地域分布 <span style="color:var(--text3)">（熵 H=' + p.entropy.region + ' bit）</span></div>' + svgBars(p.regionDist.slice(0, 8).map(function (x) { return { label: x.n, value: x.c, color: '#b366ff' }; }), {}) + '</div>' +
          '<div style="margin-top:10px">' + klBlock + '</div>' +
          '<div style="margin-top:10px"><div style="font-size:11px;color:var(--text2);margin-bottom:4px">📅 行动节律热力（星期 × 数据周）</div>' + heat + '</div>' +
          '<div style="margin-top:10px"><div style="font-size:11px;color:var(--text2);margin-bottom:4px">📰 近期归因事件</div>' +
            p.recent.map(function (e) {
              return '<div style="padding:5px 8px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">' +
                '<span style="font-size:10px;color:var(--text3);min-width:80px">' + esc(e.time) + '</span>' +
                '<span style="font-size:11px;flex:1">' + esc(e.title) + '</span></div>';
            }).join('') + '</div>';
        /* 对比区 */
        self._renderOrgCompare();
      }).catch(function (e) { host.innerHTML = '<div class="empty">画像加载失败：' + esc(e.message) + '</div>'; });
    },

    _renderOrgCompare: function () {
      var self = this, host = document.getElementById('models-org-compare');
      if (!host || !this._orgsData) return;
      var cand = this._orgsData.orgs.filter(function (o) { return o.sufficient; }).slice(0, 4);
      var sel = this._cmpSel.filter(function (id) { return cand.some(function (c) { return c.id === id; }); });
      if (!sel.length) sel = cand.slice(0, 2).map(function (c) { return c.id; });
      this._cmpSel = sel;
      host.innerHTML = '<div class="card-tt" style="margin-top:4px"><span class="ic">⚖️</span>组织行为对比（勾选 2-4 个样本充足组织）</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' + cand.map(function (c) {
          var on = sel.indexOf(c.id) >= 0;
          return '<span class="chip" data-cmp="' + esc(c.id) + '" style="' + (on ? 'border-color:var(--cyan);color:var(--cyan)' : '') + '">' + esc(c.name) + '</span>';
        }).join('') + '</div><div id="models-cmp-body"><div class="empty">加载对比…</div></div>';
      Array.prototype.forEach.call(host.querySelectorAll('[data-cmp]'), function (ch) {
        ch.addEventListener('click', function () {
          var id = this.getAttribute('data-cmp');
          var i = self._cmpSel.indexOf(id);
          if (i >= 0) { if (self._cmpSel.length > 1) self._cmpSel.splice(i, 1); }
          else if (self._cmpSel.length < 4) self._cmpSel.push(id);
          self._renderOrgCompare();
        });
      });
      fetchJSON('/api/models/orgs/compare?ids=' + encodeURIComponent(this._cmpSel.join(','))).then(function (d) {
        var body = document.getElementById('models-cmp-body');
        if (!body) return;
        if (!d.ok) { body.innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
        var colors = ['#00d4ff', '#ff8800', '#00ff9f', '#ff3355'];
        var insuff = d.orgs.filter(function (o) { return o.insufficient; });
        var good = d.orgs.filter(function (o) { return !o.insufficient; });
        if (!good.length) { body.innerHTML = '<div class="empty">所选组织样本均不足（需 ≥20 起）</div>'; return; }
        var axes = good[0].method.map(function (m) { return { label: m.n }; });
        var series = good.map(function (o, i) {
          return { name: o.name, color: colors[i % colors.length], values: o.method.map(function (m) { return m.p / 100; }) };
        });
        body.innerHTML =
          '<div style="display:grid;grid-template-columns:300px 1fr;gap:14px" class="models-cmp-grid">' +
            '<div>' + svgRadar(axes, series, 260) +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;font-size:11px">' + series.map(function (s) {
                return '<span style="color:' + s.color + '">● ' + esc(s.name) + '</span>';
              }).join('') + '</div></div>' +
            '<div><div class="table-wrap"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg2)">' +
              '<th style="padding:6px 8px;font-size:11px">组织</th><th style="padding:6px 8px;font-size:11px">事件数</th><th style="padding:6px 8px;font-size:11px">手法熵</th><th style="padding:6px 8px;font-size:11px">目标熵</th><th style="padding:6px 8px;font-size:11px">主导目标</th></tr></thead><tbody>' +
              good.map(function (o, i) {
                return '<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 8px;font-size:12px;color:' + colors[i % colors.length] + ';font-weight:700">' + esc(o.name) + '</td>' +
                  '<td style="padding:6px 8px;font-size:12px">' + o.count + '</td>' +
                  '<td style="padding:6px 8px;font-size:12px">' + o.entropy.method + '</td>' +
                  '<td style="padding:6px 8px;font-size:12px">' + o.entropy.target + '</td>' +
                  '<td style="padding:6px 8px;font-size:11px;color:var(--text2)">' + (o.targets[0] ? esc(o.targets[0].n) + ' ' + Math.round(o.targets[0].c / o.count * 100) + '%' : '—') + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
              (insuff.length ? '<div style="font-size:10px;color:var(--text3);margin-top:6px">样本不足未入对比：' + insuff.map(function (o) { return esc(o.name) + '(' + o.count + '起)'; }).join('、') + '</div>' : '') +
              '<div style="font-size:10px;color:var(--text3);margin-top:6px">熵单位 bit（log₂）；熵越低手法/目标越固定。雷达轴为手法分布占比。</div>' +
            '</div>' +
          '</div>';
      }).catch(function (e) {
        var b = document.getElementById('models-cmp-body');
        if (b) b.innerHTML = '<div class="empty">对比加载失败：' + esc(e.message) + '</div>';
      });
    },

    /* ============ ② 国别恐袭 Hawkes ============ */
    _loadHawkes: function () {
      var self = this, body = document.getElementById('models-body');
      this._filters('<span style="font-size:11px;color:var(--text3)">数据口径：data_type=terror_events · λ(t)=μ+Σα·exp(−β(t−tᵢ)) · μ=近21天自适应基线 · 分级=预测7天期望 vs 历史7天滚动分位</span>');
      body.innerHTML = '<div class="empty">加载国别恐袭模型…</div>';
      Promise.all([
        fetchJSON('/api/models/hawkes/overview'),
        fetchJSON('/api/models/hawkes/matrix')
      ]).then(function (rs) {
        if (self._tab !== 'hawkes') return;
        var d = rs[0], mx = rs[1];
        if (!d.ok) { body.innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
        self._hawkesOv = d;
        if (!self._country || !d.countries.some(function (c) { return c.country === self._country; })) {
          self._country = (d.countries[0] || {}).country || '';
        }
        self._filters(
          '<label style="font-size:11px;color:var(--text2)">国家：</label>' +
          '<select id="models-country" class="select" style="min-width:160px">' + d.countries.map(function (c) {
            return '<option value="' + esc(c.country) + '"' + (c.country === self._country ? ' selected' : '') + '>' + esc(c.country) + '（' + c.count + '起）</option>';
          }).join('') + '</select>' +
          '<span style="font-size:11px;color:var(--text3)">数据窗口 ' + d.spanDays + ' 天 · 拟合门槛 ≥' + d.minEvents + ' 起</span>');
        self._renderHawkes(mx);
      }).catch(function (e) { body.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; });
    },

    _renderHawkes: function (mx) {
      var self = this, d = this._hawkesOv, body = document.getElementById('models-body');
      var rows = d.countries.map(function (c) {
        var lv = LV[c.level] || LV.blue;
        return '<tr data-hc="' + esc(c.country) + '" style="cursor:pointer;border-bottom:1px solid var(--border);' + (c.country === self._country ? 'background:rgba(0,212,255,0.08)' : '') + '">' +
          '<td style="padding:5px 8px;font-size:12px">' + esc(c.country) + '</td>' +
          '<td style="padding:5px 8px;font-size:12px;color:var(--text2)">' + c.count + '</td>' +
          '<td style="padding:5px 8px;font-size:12px"><b style="color:' + lv.c + '">' + c.ex7 + '</b></td>' +
          '<td style="padding:5px 8px;font-size:12px;color:var(--text2)">' + c.ex30 + '</td>' +
          '<td style="padding:5px 8px"><span class="badge" style="background:' + lv.c + '22;color:' + lv.c + ';font-size:9px">' + lv.n + '</span></td>' +
          '<td style="padding:5px 8px;font-size:10px;color:var(--text3)">' + esc(c.paramsSource) + '</td></tr>';
      }).join('');
      body.innerHTML =
        '<div class="card-tt"><span class="ic">📊</span>国别恐袭风险分级（未来 7/30 天预测强度）</div>' +
        '<div class="table-wrap" style="max-height:260px;overflow-y:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg2)">' +
          '<th style="padding:6px 8px;font-size:11px">国家</th><th style="padding:6px 8px;font-size:11px">事件数</th><th style="padding:6px 8px;font-size:11px">未来7天期望</th><th style="padding:6px 8px;font-size:11px">未来30天期望</th><th style="padding:6px 8px;font-size:11px">分级</th><th style="padding:6px 8px;font-size:11px">参数来源</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div id="models-hawkes-detail"><div class="empty">加载 ' + esc(this._country) + ' 模型详情…</div></div>' +
        '<div id="models-hawkes-matrix" style="margin-top:12px"></div>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-hc]'), function (tr) {
        tr.addEventListener('click', function () { self._country = this.getAttribute('data-hc'); self._loadHawkes(); });
      });
      if (mx && mx.ok) {
        var mn = mx.methodNames, rws = mx.rows;
        var heatM = rws.map(function (r) { return mn.map(function (m) { return r.methods[m] || 0; }); });
        document.getElementById('models-hawkes-matrix').innerHTML =
          '<div class="card-tt"><span class="ic">🧩</span>手法偏好矩阵（国家 × 手法概率%，仅列示 ≥20 起国家）</div>' + svgHeat(heatM, rws.map(function (r) { return r.country + ' ' + r.count; }), mn);
      }
      this._renderHawkesDetail();
    },

    _renderHawkesDetail: function () {
      var self = this, host = document.getElementById('models-hawkes-detail');
      if (!host || !this._country) return;
      host.innerHTML = '<div class="empty">加载 ' + esc(this._country) + ' 模型详情…</div>';
      fetchJSON('/api/models/hawkes?country=' + encodeURIComponent(this._country)).then(function (p) {
        if (self._tab !== 'hawkes' || self._country !== p.country) return;
        if (!p.ok) { host.innerHTML = '<div class="empty">' + esc(p.error) + '</div>'; return; }
        var lv = LV[p.level] || LV.blue;
        var replayPts = p.replay.map(function (x) { return { x: new Date(x.date).getTime(), y: x.lam, label: x.date.slice(5) }; });
        var fcPts = p.forecast.map(function (x) { return { x: x.h, y: x.lam, label: 'D' + x.h }; });
        var exCurve = p.forecast.map(function (x) { return { x: x.h, y: x.ex, label: 'D' + x.h }; });
        var bt = p.backtest;
        host.innerHTML =
          '<div class="card" style="border:1px solid ' + lv.c + '55">' +
          '<div class="card-tt"><span class="ic">💥</span>' + esc(p.country) + ' Hawkes 自激励模型 <span class="badge" style="background:' + lv.c + '22;color:' + lv.c + ';font-size:10px;margin-left:8px">' + lv.n + '级</span>' +
            '<span style="margin-left:auto;font-size:10px;color:var(--text3)">' + p.count + ' 起 · 窗口 ' + p.spanDays + ' 天</span></div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">' +
            '<div style="padding:8px;background:var(--bg2);border-radius:6px;text-align:center"><div style="font-size:10px;color:var(--text3)">μ 基线率</div><div style="font-size:16px;font-weight:800;color:var(--cyan)">' + p.params.mu + '<span style="font-size:9px">起/天</span></div></div>' +
            '<div style="padding:8px;background:var(--bg2);border-radius:6px;text-align:center"><div style="font-size:10px;color:var(--text3)">α 激励幅度</div><div style="font-size:16px;font-weight:800">' + p.params.alpha + '</div></div>' +
            '<div style="padding:8px;background:var(--bg2);border-radius:6px;text-align:center"><div style="font-size:10px;color:var(--text3)">β 时间衰减</div><div style="font-size:16px;font-weight:800">' + p.params.beta + '<span style="font-size:9px">/天</span></div></div>' +
            '<div style="padding:8px;background:var(--bg2);border-radius:6px;text-align:center"><div style="font-size:10px;color:var(--text3)">未来7天期望</div><div style="font-size:16px;font-weight:800;color:' + lv.c + '">' + p.ex7 + ' 起</div></div>' +
            '<div style="padding:8px;background:var(--bg2);border-radius:6px;text-align:center"><div style="font-size:10px;color:var(--text3)">未来30天期望</div><div style="font-size:16px;font-weight:800;color:' + lv.c + '">' + p.ex30 + ' 起</div></div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--text3);margin-bottom:10px">公式 ' + esc(p.params.formula) + ' · 参数：' + esc(p.params.source) + ' · 分级阈值：7天滚动 q75=' + p.thresholds.q75 + ' / q90=' + p.thresholds.q90 + ' / q95=' + p.thresholds.q95 + '（红≥q95 橙≥q90 黄≥q75）</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="models-p2">' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">📈 历史强度回放（逐日 λ）</div>' + svgLine(replayPts, { color: '#00d4ff', fill: 'rgba(0,212,255,0.08)', h: 140, legend: 'λ(t)' }) + '</div>' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">🔮 未来 30 天强度衰减（λ）与累计期望</div>' + svgLine(fcPts, { color: '#ff8800', h: 140, legend: 'λ 预测' }) + svgLine(exCurve, { color: '#00ff9f', h: 110, legend: '累计期望 E[N(t)]' }) + '</div>' +
          '</div>' +
          (bt ? '<div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:8px">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">🧪 回测面板（留出后段逐日滚动验证）</div>' +
            '<div style="font-size:10px;color:var(--text3);margin-bottom:6px">' + esc(bt.evalWindow) + ' · 留出事件 ' + bt.holdoutEvents + ' 起</div>' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px">' +
              '<span>预测高风险日 <b style="color:var(--orange)">' + bt.highPredDays + '</b> 天</span>' +
              '<span>高风险日命中率 <b style="color:' + (bt.hitRate === null ? 'var(--text3)' : bt.hitRate >= 60 ? 'var(--green)' : 'var(--orange)') + '">' + (bt.hitRate === null ? '—（无高风险预测日）' : bt.hitRate + '%') + '</b></span>' +
              '<span>实际高发日 <b>' + bt.actualHighDays + '</b> 天</span>' +
              '<span>漏报率 <b style="color:' + (bt.missRate >= 50 ? 'var(--red)' : 'var(--green)') + '">' + (bt.missRate === null ? '—' : bt.missRate + '%') + '</b></span>' +
            '</div>' +
            (bt.samples && bt.samples.length ? '<div style="margin-top:6px;font-size:10px;color:var(--text3)">高风险预测日样例：' + bt.samples.map(function (x) { return '第' + x.day + '天 预测' + x.ex7 + '起/实际' + x.actual7 + '起'; }).join('；') + '</div>' : '') +
            '<div style="margin-top:4px;font-size:9px;color:var(--text3)">回测为真实留出数据计算，命中率/漏报率如实展示，不作美化。</div></div>' : '<div style="margin-top:10px;font-size:11px;color:var(--text3)">样本不足 15 起，不生成回测面板</div>') +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px" class="models-p2">' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">🧩 该国手法偏好</div>' + svgBars(p.methodProfile.filter(function (m) { return m.p >= 0.5; }).map(function (m) { return { label: m.n, value: m.p, color: '#00d4ff' }; }), { unit: '%' }) + '</div>' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">🎯 组织贡献占比（专题一归因复用）</div>' + (p.orgContribution.length ? svgBars(p.orgContribution.map(function (o) { return { label: o.name, value: o.p, color: '#b366ff' }; }), { unit: '%' }) : '<div style="font-size:11px;color:var(--text3)">该国事件未命中组织库</div>') + '</div>' +
          '</div>' +
          '<div style="margin-top:8px"><div style="font-size:11px;color:var(--text2);margin-bottom:2px">📰 近期事件</div>' + p.recent.map(function (e) {
            return '<div style="padding:4px 8px;border-bottom:1px solid var(--border);display:flex;gap:8px"><span style="font-size:10px;color:var(--text3);min-width:80px">' + esc(e.time) + '</span><span style="font-size:11px;flex:1">' + esc(e.title) + '</span></div>';
          }).join('') + '</div>' +
          '</div>';
      }).catch(function (e) { host.innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + '</div>'; });
    },

    /* ============ ③ 绑架 ============ */
    _loadKidnap: function () {
      var self = this, body = document.getElementById('models-body');
      this._filters(
        '<span style="font-size:11px;color:var(--text3)">事件口径：题名+正文关键词 绑架|劫持|人质|勒索赎金|kidnap|abduct|hostage（中英双语）</span>');
      body.innerHTML = '<div class="empty">加载绑架模型…</div>';
      fetchJSON('/api/models/kidnap').then(function (d) {
        if (self._tab !== 'kidnap') return;
        if (!d.ok) { body.innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
        var weekly = svgLine(d.weekly.map(function (x, i) { return { x: i + 1, y: x.c, label: x.w }; }), { color: '#ff8800', fill: 'rgba(255,136,0,0.1)', h: 130, legend: '绑架事件数/周' });
        var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        var hours = [];
        for (var h = 0; h < 24; h++) hours.push(String(h).padStart(2, '0'));
        body.innerHTML =
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="models-p2">' +
            '<div class="card"><div class="card-tt"><span class="ic">📈</span>绑架事件周度趋势 <span style="font-size:10px;color:var(--text3);font-weight:400">' + esc(d.windowNote) + '</span></div>' + weekly + '</div>' +
            '<div class="card"><div class="card-tt"><span class="ic">🕐</span>高风险时段热力（星期 × 小时）</div>' + svgHeat(d.rhythm.heat, days, hours, 3) +
              '<div style="font-size:9px;color:var(--text3)">' + esc(d.rhythm.note) + '</div></div>' +
          '</div>' +
          '<div class="card" style="margin-top:12px"><div class="card-tt"><span class="ic">🎯</span>对象风险清单（我方重点项目，前 ' + d.objects.length + '）</div>' +
            '<div style="font-size:10px;color:var(--text3);margin-bottom:8px">' + esc(d.formulaDesc) + '</div>' +
            '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg2)">' +
              '<th style="padding:5px 8px;font-size:11px">项目</th><th style="padding:5px 8px;font-size:11px">国家</th><th style="padding:5px 8px;font-size:11px">该国绑架数</th><th style="padding:5px 8px;font-size:11px">severity均值</th><th style="padding:5px 8px;font-size:11px">暴露系数</th><th style="padding:5px 8px;font-size:11px">风险分</th></tr></thead><tbody>' +
            d.objects.map(function (o) {
              return '<tr style="border-bottom:1px solid var(--border)' + (o.red ? ';background:rgba(255,51,85,0.06)' : '') + '">' +
                '<td style="padding:5px 8px;font-size:12px;font-weight:600;' + (o.red ? 'color:var(--red)' : '') + '">' + esc(o.name) + (o.red ? ' 🔴' : '') + '</td>' +
                '<td style="padding:5px 8px;font-size:12px">' + esc(o.country) + '</td>' +
                '<td style="padding:5px 8px;font-size:12px">' + o.kidnapCount + '</td>' +
                '<td style="padding:5px 8px;font-size:12px">' + o.sevAvg + '</td>' +
                '<td style="padding:5px 8px;font-size:12px">' + o.exposure + '</td>' +
                '<td style="padding:5px 8px;font-size:12px;font-weight:800;' + (o.red ? 'color:var(--red)' : 'color:var(--cyan)') + '">' + o.score + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<div style="font-size:9px;color:var(--text3);margin-top:6px">🔴 = 风险分≥榜首50%分位 · ' + esc(d.survivalNote) + '</div></div>' +
          '<div class="card" style="margin-top:12px"><div class="card-tt"><span class="ic">🌍</span>国家绑架密度（severity 加权）</div>' +
            svgBars(d.density.slice(0, 12).map(function (x) { return { label: x.country, value: x.count, color: '#ff3355', tc: 'var(--text2)' }; }), {}) + '</div>' +
          '<div class="card" style="margin-top:12px"><div class="card-tt"><span class="ic">🔎</span>相似案例检索（Dice 题名相似度）</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:8px"><input id="models-kidnap-q" class="input" style="flex:1" placeholder="输入国家/手法关键词，如：绑架 中国公民 / 俾路支 绑架" /><button class="btn sm" onclick="MODELS_ANALYSIS.kidnapSearch()">检索</button></div>' +
            '<div id="models-kidnap-results"><div class="empty">输入关键词检索历史相似绑架案</div></div></div>' +
          '<div class="card" style="margin-top:12px"><div class="card-tt"><span class="ic">📰</span>近期绑架事件（共 ' + d.total + ' 起）</div>' + d.recent.map(function (e) {
            return '<div style="padding:4px 8px;border-bottom:1px solid var(--border);display:flex;gap:8px"><span style="font-size:10px;color:var(--text3);min-width:80px">' + esc(e.time) + '</span><span style="font-size:10px;color:var(--orange);min-width:50px">' + esc(e.country) + '</span><span style="font-size:11px;flex:1">' + esc(e.title) + '</span></div>';
          }).join('') + '</div>';
      }).catch(function (e) { body.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; });
    },

    kidnapSearch: function () {
      var q = (document.getElementById('models-kidnap-q') || {}).value || '';
      var host = document.getElementById('models-kidnap-results');
      if (!q.trim()) { host.innerHTML = '<div class="empty">请输入关键词</div>'; return; }
      host.innerHTML = '<div class="empty">检索中…</div>';
      fetchJSON('/api/models/kidnap/search?q=' + encodeURIComponent(q.trim())).then(function (d) {
        if (!d.ok || !d.results.length) { host.innerHTML = '<div class="empty">无相似案例</div>'; return; }
        host.innerHTML = d.results.map(function (r) {
          return '<div style="padding:6px 8px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">' +
            '<span style="font-size:10px;color:var(--cyan);min-width:44px;font-weight:700">' + r.sim + '</span>' +
            '<span style="font-size:10px;color:var(--text3);min-width:80px">' + esc(r.time) + '</span>' +
            '<span style="font-size:10px;color:var(--orange);min-width:50px">' + esc(r.country) + '</span>' +
            '<span style="font-size:11px;flex:1">' + esc(r.title) + '</span></div>';
        }).join('');
      }).catch(function (e) { host.innerHTML = '<div class="empty">检索失败：' + esc(e.message) + '</div>'; });
    },

    /* ============ ④ 地缘风险 ============ */
    _loadGeo: function () {
      var self = this, body = document.getElementById('models-body');
      this._filters('<span style="font-size:11px;color:var(--text3)">六维映射：政治=p political_events · 经济=economic_risk · 社会=social_unrest · 安全=terror+military · 外部=sanctions · 涉我=chinaRelated</span>');
      body.innerHTML = '<div class="empty">加载地缘风险模型…</div>';
      fetchJSON('/api/models/geo').then(function (d) {
        if (self._tab !== 'geo') return;
        if (!d.ok) { body.innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
        self._geoData = d;
        if (!self._geoWeights) self._geoWeights = {};
        d.weights.forEach(function (w) { if (self._geoWeights[w.k] === undefined) self._geoWeights[w.k] = w.w; });
        self._renderGeo();
      }).catch(function (e) { body.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; });
    },

    _geoR: function (lastDims) {
      var w = this._geoWeights, sum = 0;
      Object.keys(w).forEach(function (k) { sum += w[k] * ((lastDims[k] || {}).norm || 0); });
      return Math.round(sum * 1000) / 10;
    },

    _onWeightChange: function () {
      var self = this;
      var sum = 0;
      document.querySelectorAll('.geo-weight').forEach(function (inp) { sum += parseFloat(inp.value) || 0; });
      var hint = document.getElementById('geo-wsum');
      if (hint) { hint.textContent = 'Σ权重=' + (Math.round(sum * 100) / 100) + (Math.abs(sum - 1) < 0.001 ? '（合规）' : '（≠1，将按比例归一）'); }
      document.querySelectorAll('.geo-weight').forEach(function (inp) {
        self._geoWeights[inp.getAttribute('data-k')] = parseFloat(inp.value) || 0;
      });
      this._renderGeoRanking();
      this._renderGeoDetail();
    },

    _renderGeo: function () {
      var d = this._geoData;
      document.getElementById('models-body').innerHTML =
        '<div class="card"><div class="card-tt"><span class="ic">🎛️</span>六维权重（可解释可调 · 界面明示）' +
          '<span id="geo-wsum" style="margin-left:10px;font-size:10px;color:var(--text3);font-weight:400"></span></div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap">' + d.weights.map(function (w) {
            return '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)">' + w.n +
              ' <input class="input geo-weight" data-k="' + w.k + '" type="number" step="0.05" min="0" max="1" value="' + this._geoWeights[w.k] + '" style="width:64px;padding:3px 6px" /></label>';
          }, this).join('') + '</div>' +
          '<div style="font-size:10px;color:var(--text3);margin-top:6px">' + esc(d.note) + ' · 建模国家 ' + d.ranking.length + ' 个（总量≥20 起六维事件）</div></div>' +
        '<div id="models-geo-ranking" style="margin-top:12px"></div>' +
        '<div id="models-geo-detail" style="margin-top:12px"></div>';
      this._renderGeoRanking();
      this._renderGeoDetail();
    },

    _renderGeoRanking: function () {
      var self = this, d = this._geoData, host = document.getElementById('models-geo-ranking');
      if (!host) return;
      var ranked = d.ranking.map(function (x) { return { x: x, r: self._geoR(x.lastDims) }; })
        .sort(function (a, b) { return b.r - a.r; });
      host.innerHTML = '<div class="card"><div class="card-tt"><span class="ic">🌐</span>国别综合风险 R(c,t) 排名（当前周 · 权重调整后实时重算）</div>' +
        '<div class="table-wrap" style="max-height:320px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg2)">' +
        '<th style="padding:5px 8px;font-size:11px">#</th><th style="padding:5px 8px;font-size:11px">国家</th><th style="padding:5px 8px;font-size:11px">R 值</th><th style="padding:5px 8px;font-size:11px">周ΔR</th><th style="padding:5px 8px;font-size:11px">风险升级</th><th style="padding:5px 8px;font-size:11px">主要驱动</th><th style="padding:5px 8px;font-size:11px">六维事件量</th></tr></thead><tbody>' +
        ranked.map(function (o, i) {
          var x = o.x;
          return '<tr data-geo="' + esc(x.country) + '" style="cursor:pointer;border-bottom:1px solid var(--border)">' +
            '<td style="padding:5px 8px;font-size:11px;color:var(--text3)">' + (i + 1) + '</td>' +
            '<td style="padding:5px 8px;font-size:12px;font-weight:600">' + esc(x.country) + '</td>' +
            '<td style="padding:5px 8px;font-size:12px;font-weight:800;color:' + (o.r >= 40 ? 'var(--red)' : o.r >= 25 ? 'var(--orange)' : o.r >= 12 ? 'var(--yellow)' : 'var(--cyan)') + '">' + o.r + '</td>' +
            '<td style="padding:5px 8px;font-size:12px;color:' + (x.deltaR > 0 ? 'var(--red)' : 'var(--green)') + '">' + (x.deltaR > 0 ? '+' : '') + x.deltaR + '</td>' +
            '<td style="padding:5px 8px;font-size:11px">' + (x.upgraded ? '<span class="badge b-red" style="font-size:9px">CUSUM 变点</span>' : '<span style="color:var(--text3)">—</span>') + '</td>' +
            '<td style="padding:5px 8px;font-size:10px;color:var(--text2)">' + x.attribution.slice(0, 2).map(function (a) { return a.name + (a.contrib > 0 ? '+' : '') + a.contrib; }).join('、') + '</td>' +
            '<td style="padding:5px 8px;font-size:11px;color:var(--text3)">' + x.totalEvents + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div style="font-size:9px;color:var(--text3);margin-top:6px">R(c,t)=Σγⱼ·Iⱼ(c,t)（各维 min-max 归一后加权，0-100）· ΔR 为最近一周变化 · 点击行查看单国详情</div></div>';
      Array.prototype.forEach.call(host.querySelectorAll('[data-geo]'), function (tr) {
        tr.addEventListener('click', function () {
          Array.prototype.forEach.call(host.querySelectorAll('[data-geo]'), function (r2) { r2.style.background = ''; });
          this.style.background = 'rgba(0,212,255,0.08)';
          self._geoCountry = this.getAttribute('data-geo');
          self._renderGeoDetail();
        });
      });
    },

    _renderGeoDetail: function () {
      var self = this, host = document.getElementById('models-geo-detail');
      if (!host) return;
      var c = this._geoCountry || (this._geoData.ranking[0] || {}).country;
      if (!c) { host.innerHTML = ''; return; }
      host.innerHTML = '<div class="empty">加载 ' + esc(c) + ' 地缘详情…</div>';
      fetchJSON('/api/models/geo?country=' + encodeURIComponent(c)).then(function (d) {
        if (!d.ok || !d.detail) { host.innerHTML = '<div class="empty">' + esc(d.error || '该国六维样本不足') + '</div>'; return; }
        var x = d.detail;
        var dimNames = { political: '政治', economic: '经济', social: '社会', security: '安全', external: '外部干预', china: '涉我' };
        var axes = Object.keys(dimNames).map(function (k) { return { label: dimNames[k] }; });
        /* 用当前权重重算雷达与 R 序列 */
        var w = self._geoWeights;
        function rOf(dims) { var s = 0; Object.keys(w).forEach(function (k) { s += w[k] * ((dims[k] || {}).norm || 0); }); return Math.round(s * 1000) / 10; }
        var curDims = x.dims[x.dims.length - 1];
        var radarVals = Object.keys(dimNames).map(function (k) { return (curDims[k] || {}).norm || 0; });
        var seriesPts = x.series.map(function (v, i) { return { x: i + 1, y: v, label: 'W' + (i + 1) }; });
        var marks = x.changepoints.map(function (wIdx) { return { x: wIdx + 1, label: '变点', color: '#ff3355' }; });
        var lastEventWeek = x.series.length;
        var waterfallItems = x.attribution.map(function (a) { return { name: a.name, delta: a.contrib }; });
        /* COSRI 对照 */
        var cosri = d.cosri || {};
        var cosriBlock = cosri.scores
          ? '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:6px">' + ['political', 'economic', 'social', 'security'].map(function (k) {
              return '<span style="padding:4px 8px;background:var(--bg2);border-radius:6px">COSRI·' + { political: '政治', economic: '经济', social: '社会', security: '安全' }[k] + ' <b style="color:var(--cyan)">' + cosri.scores[k] + '</b>/10</span>';
            }).join('') + '<span style="font-size:9px;color:var(--text3);align-self:center">（' + esc(cosri.asOf || '') + ' 研究底数对照）</span></div>'
          : '<div style="font-size:10px;color:var(--text3)">' + esc(cosri.note || 'COSRI 未收录该国') + '</div>';
        /* 情景推演（纯前端） */
        var scenInputs = Object.keys(dimNames).map(function (k) {
          return '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text2)">' + dimNames[k] +
            '<input class="input geo-scen" data-k="' + k + '" type="number" step="0.05" min="-1" max="1" value="0" style="width:56px;padding:2px 4px;font-size:10px" /></label>';
        }).join('');
        host.innerHTML =
          '<div class="card"><div class="card-tt"><span class="ic">🎯</span>' + esc(x.country) + ' 地缘安全风险画像' +
            '<span style="margin-left:auto;font-size:10px;color:var(--text3)">当前 R=' + rOf(curDims) + ' · 周ΔR=' + (rOf(curDims) - rOf(x.dims[Math.max(0, x.dims.length - 2)])) + ' · CUSUM 变点 ' + x.changepoints.length + ' 处</span></div>' +
          '<div style="display:grid;grid-template-columns:300px 1fr;gap:14px" class="models-cmp-grid">' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">🕸️ 六维雷达（归一化）</div>' + svgRadar(axes, [{ name: x.country, color: '#00d4ff', values: radarVals }], 250) + cosriBlock + '</div>' +
            '<div><div style="font-size:11px;color:var(--text2);margin-bottom:2px">📈 周度 R 走势与 CUSUM 变点</div>' + svgLine(seriesPts, { color: '#00ff9f', fill: 'rgba(0,255,159,0.08)', h: 160, marks: marks, legend: 'R(c,t)' }) + '</div>' +
          '</div>' +
          '<div style="margin-top:10px"><div style="font-size:11px;color:var(--text2);margin-bottom:2px">💧 当周 ΔR 六维归因瀑布（' + (x.deltaR > 0 ? '风险上升' : '风险下降') + ' ' + Math.abs(x.deltaR) + '）</div>' + svgWaterfall(x.prevR, waterfallItems) + '</div>' +
          '<div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:8px">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">🧪 情景推演（调任一维假设增量，前端实时重算 R 区间）</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' + scenInputs + '</div>' +
            '<div id="models-geo-scen" style="font-size:12px"></div>' +
          '</div>' +
          '<div style="font-size:9px;color:var(--text3);margin-top:8px">口径：' + esc(d.note) + ' · 归一化取全体建模国家×周 min-max · CUSUM 阈值 3σ（前半序列均值/方差）</div>' +
          '</div>';
        Array.prototype.forEach.call(host.querySelectorAll('.geo-scen'), function (inp) {
          inp.addEventListener('input', function () {
            var r0 = rOf(curDims), r1 = 0;
            Object.keys(dimNames).forEach(function (k) {
              var base = (curDims[k] || {}).norm || 0;
              var inc = parseFloat((host.querySelector('.geo-scen[data-k="' + k + '"]') || {}).value) || 0;
              var v = Math.max(0, Math.min(1, base + inc));
              r1 += (w[k] || 0) * v;
            });
            r1 = Math.round(r1 * 1000) / 10;
            var el = document.getElementById('models-geo-scen');
            if (el) el.innerHTML = '推演 R = <b style="color:' + (r1 > r0 ? 'var(--red)' : r1 < r0 ? 'var(--green)' : 'var(--cyan)') + ';font-size:15px">' + r1 + '</b>（当前 ' + r0 + '，Δ=' + (r1 > r0 ? '+' : '') + (Math.round((r1 - r0) * 10) / 10) + '）<span style="font-size:10px;color:var(--text3)"> · 假设增量作用于归一化维度后截断至[0,1]加权合成</span>';
          });
        });
      }).catch(function (e) { host.innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + '</div>'; });
    }
  };

  window.MODELS_ANALYSIS = MA;
})();
