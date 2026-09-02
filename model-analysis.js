/* ============================================================
 * model-analysis.js — 「ORPS 大情报分析中枢」前端视图（2026-09-02 重设计）
 * ================================================================
 * 布局：公安大情报工作台三段式
 *   左侧  模型导航树（中枢总览 + 六大专项）
 *   中间  分析画布（该专项算法可视化）
 *   右侧  智能体研判面板 + 证据链
 * 每专项 = 算法引擎（GET /api/models/*）+ 智能体（POST /api/models/agent/:key）
 * 数据：全部服务端真实计算，零模拟；样本不足如实灰显。
 * 注册：index.html data-view="models" + view-models 容器 + app.js VIEW_MAP/runViewInit + role-ui.js VIEW_LABELS。
 * ============================================================ */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fetchJSON(url, opt) { return fetch(url, opt).then(function (r) { return r.json(); }); }
  var LV = { red: { c: '#ff3355', n: '红' }, orange: { c: '#ff8800', n: '橙' }, yellow: { c: '#ffcc00', n: '黄' }, blue: { c: '#00d4ff', n: '蓝' } };

  /* ============ HUD 样式注入（深空蓝黑 · 未来科技感）============ */
  var HUD_CSS = `
    .ma-root{position:relative;min-height:100%;background:
      radial-gradient(1200px 500px at 70% -10%, rgba(0,120,255,0.08), transparent 60%),
      radial-gradient(900px 400px at 10% 110%, rgba(0,212,255,0.05), transparent 60%);}
    .ma-root:before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.35;
      background-image:linear-gradient(rgba(0,212,255,0.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(0,212,255,0.04) 1px,transparent 1px);
      background-size:36px 36px;}
    .ma-scan{position:absolute;left:0;right:0;height:120px;pointer-events:none;z-index:1;
      background:linear-gradient(180deg,transparent,rgba(0,212,255,0.05),transparent);
      animation:ma-scan 7s linear infinite;}
    @keyframes ma-scan{0%{top:-15%}100%{top:110%}}
    .ma-layout{position:relative;z-index:2;display:grid;grid-template-columns:216px minmax(0,1fr) 322px;gap:10px;padding:10px 12px 18px;}
    .ma-hud-card{background:linear-gradient(160deg,rgba(10,22,40,0.92),rgba(6,14,28,0.96));
      border:1px solid rgba(0,212,255,0.16);border-radius:8px;position:relative;overflow:hidden;}
    .ma-hud-card:before{content:'';position:absolute;top:0;left:0;right:0;height:1px;
      background:linear-gradient(90deg,transparent,rgba(0,212,255,0.55),transparent);}
    .ma-tt{font-size:13px;font-weight:700;color:#9fe8ff;letter-spacing:1px;padding:10px 12px 6px;
      display:flex;align-items:center;gap:7px;text-shadow:0 0 12px rgba(0,212,255,0.35);flex-wrap:wrap;}
    .ma-tt .ma-dot{width:7px;height:7px;border-radius:50%;background:#00d4ff;box-shadow:0 0 8px #00d4ff;flex:none;}
    .ma-tt small{font-weight:400;color:var(--text3);font-size:10px;letter-spacing:0;}
    .ma-nav-item{padding:7px 10px;margin:2px 8px;border-radius:6px;cursor:pointer;font-size:12px;
      color:var(--text2);border:1px solid transparent;transition:all .18s;display:flex;align-items:center;gap:7px;}
    .ma-nav-item:hover{color:#9fe8ff;background:rgba(0,212,255,0.06);}
    .ma-nav-item.on{color:#00e5ff;background:linear-gradient(90deg,rgba(0,212,255,0.14),rgba(0,212,255,0.02));
      border-color:rgba(0,212,255,0.35);box-shadow:inset 2px 0 0 #00d4ff,0 0 14px rgba(0,212,255,0.12);}
    .ma-nav-item .ma-ic{width:20px;text-align:center;font-size:13px;flex:none;}
    .ma-nav-item .ma-badge{margin-left:auto;font-size:9px;color:#00e5ff;background:rgba(0,212,255,0.08);
      border:1px solid rgba(0,212,255,0.3);border-radius:8px;padding:1px 6px;flex:none;}
    .ma-nav-group{font-size:10px;color:var(--text3);padding:10px 14px 3px;letter-spacing:2px;}
    .ma-kpi{background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.14);border-radius:6px;padding:8px 10px;min-width:0;}
    .ma-kpi .v{font-size:20px;font-weight:800;color:#00e5ff;text-shadow:0 0 10px rgba(0,212,255,0.4);line-height:1.15;}
    .ma-kpi .l{font-size:10px;color:var(--text3);margin-top:2px;}
    .ma-kpi .s{font-size:9px;color:var(--text2);opacity:.75;margin-top:1px;}
    table.ma-tb{width:100%;border-collapse:collapse;}
    table.ma-tb th{padding:6px 8px;font-size:10px;color:var(--text3);text-align:left;border-bottom:1px solid rgba(0,212,255,0.15);white-space:nowrap;}
    table.ma-tb td{padding:5px 8px;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);}
    table.ma-tb tr.ma-row{cursor:pointer;transition:background .15s;}
    table.ma-tb tr.ma-row:hover{background:rgba(0,212,255,0.05);}
    table.ma-tb tr.ma-row.on{background:rgba(0,212,255,0.10);}
    .ma-chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;}
    .ma-dim{color:var(--text3);font-size:10px;line-height:1.5;}
    .ma-btn{background:linear-gradient(90deg,rgba(0,212,255,0.18),rgba(0,120,255,0.18));border:1px solid rgba(0,212,255,0.45);
      color:#00e5ff;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:700;letter-spacing:1px;
      transition:all .18s;text-shadow:0 0 8px rgba(0,212,255,0.4);display:inline-block;}
    .ma-btn:hover{box-shadow:0 0 16px rgba(0,212,255,0.35);}
    .ma-btn.ghost{background:transparent;border-color:rgba(0,212,255,0.25);color:var(--text2);font-weight:400;}
    .ma-input,.ma-select{background:rgba(0,20,40,0.7);border:1px solid rgba(0,212,255,0.25);border-radius:6px;
      color:var(--text);padding:6px 10px;font-size:12px;outline:none;}
    .ma-input:focus,.ma-select:focus{border-color:rgba(0,212,255,0.6);box-shadow:0 0 10px rgba(0,212,255,0.2);}
    .ma-sec{border-left:2px solid rgba(0,212,255,0.5);padding:8px 10px;margin:8px 10px;background:rgba(0,212,255,0.03);border-radius:0 6px 6px 0;}
    .ma-sec h5{margin:0 0 5px;font-size:11px;color:#9fe8ff;letter-spacing:1px;}
    .ma-sec p{margin:0;font-size:11.5px;color:var(--text);line-height:1.65;white-space:pre-wrap;word-break:break-word;}
    .ma-evi{padding:4px 10px;font-size:10px;color:var(--text2);border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;}
    .ma-evi:hover{background:rgba(0,212,255,0.05);color:#9fe8ff;}
    .ma-empty{padding:26px 12px;text-align:center;color:var(--text3);font-size:12px;}
    .ma-gray{opacity:.55;filter:grayscale(.6);}
    .ma-scroll{scrollbar-width:thin;scrollbar-color:rgba(0,212,255,0.25) transparent;}
    .ma-scroll::-webkit-scrollbar{width:6px;height:6px;}
    .ma-scroll::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.2);border-radius:3px;}
    .ma-pulse{animation:ma-pulse 2.2s ease-in-out infinite;}
    @keyframes ma-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    .ma-modal-mask{position:fixed;inset:0;background:rgba(2,6,16,0.78);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);}
    .ma-modal{width:660px;max-width:92vw;max-height:82vh;overflow-y:auto;background:linear-gradient(160deg,#0a1628,#060e1c);
      border:1px solid rgba(0,212,255,0.35);border-radius:10px;box-shadow:0 0 40px rgba(0,212,255,0.25);padding:16px 18px;}
    .ma-tag{display:inline-block;font-size:9px;padding:1px 6px;border-radius:8px;background:rgba(0,212,255,0.1);
      border:1px solid rgba(0,212,255,0.25);color:#9fe8ff;margin:1px 2px;}
    @media (max-width:1280px){.ma-layout{grid-template-columns:190px minmax(0,1fr) 282px;}}
  `;
  var _cssDone = false;
  function ensureCss() {
    if (_cssDone) return; _cssDone = true;
    var st = document.createElement('style');
    st.textContent = HUD_CSS;
    document.head.appendChild(st);
  }

  /* ============ SVG 构造器（内联，HUD 风格）============ */
  function svgRadar(axes, series, size) {
    size = size || 220;
    var cx = size / 2, cy = size / 2, R = size / 2 - 36;
    var n = axes.length;
    if (!n) return '';
    function pt(i, v) {
      var a = -Math.PI / 2 + (2 * Math.PI * i / n);
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    }
    var out = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    [0.33, 0.66, 1].forEach(function (lv) {
      out += '<polygon points="' + axes.map(function (_, i) { return pt(i, lv).join(','); }).join(' ') + '" fill="none" stroke="rgba(0,212,255,0.15)"/>';
    });
    axes.forEach(function (a, i) {
      var p = pt(i, 1);
      out += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="rgba(0,212,255,0.12)"/>';
      var lp = pt(i, 1.22);
      out += '<text x="' + lp[0] + '" y="' + lp[1] + '" font-size="10" fill="#7fc8e8" text-anchor="middle" dominant-baseline="middle">' + esc(a.n || a.label || a) + '</text>';
    });
    series.forEach(function (s) {
      var pts = axes.map(function (_, i) { return pt(i, Math.max(0, Math.min(1, s.values[i] || 0))).join(','); }).join(' ');
      out += '<polygon points="' + pts + '" fill="' + s.color + '22" stroke="' + s.color + '" stroke-width="1.6" style="filter:drop-shadow(0 0 5px ' + s.color + '55)"/>';
      axes.forEach(function (_, i) {
        var p = pt(i, Math.max(0, Math.min(1, s.values[i] || 0)));
        out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.2" fill="' + s.color + '"/>';
      });
    });
    out += '</svg>';
    return out;
  }

  function svgLine(points, opt) {
    opt = opt || {};
    var w = opt.w || 560, h = opt.h || 150, pad = { l: 34, r: 8, t: 14, b: 22 };
    var color = opt.color || '#00d4ff';
    if (!points.length) return '<div class="ma-empty">无数据</div>';
    var xs = points.map(function (p) { return p.x; }), ys = points.map(function (p) { return p.y; });
    var mnX = Math.min.apply(null, xs), mxX = Math.max.apply(null, xs);
    var mnY = opt.minY != null ? opt.minY : Math.min.apply(null, ys.concat([0]));
    var mxY = Math.max.apply(null, ys.concat([1]));
    if (opt.band && opt.band.length) {
      opt.band.forEach(function (b) { if (b.hi > mxY) mxY = b.hi; if (b.lo < mnY) mnY = b.lo; });
    }
    if (mxY === mnY) mxY = mnY + 1;
    function X(x) { return pad.l + (x - mnX) / ((mxX - mnX) || 1) * (w - pad.l - pad.r); }
    function Y(y) { return pad.t + (1 - (y - mnY) / (mxY - mnY)) * (h - pad.t - pad.b); }
    var out = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="max-width:100%">';
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + g * (h - pad.t - pad.b) / 4;
      var gv = mxY - g * (mxY - mnY) / 4;
      out += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (w - pad.r) + '" y2="' + gy + '" stroke="rgba(0,212,255,0.08)"/>';
      out += '<text x="' + (pad.l - 5) + '" y="' + (gy + 3) + '" font-size="8" fill="#5a7a90" text-anchor="end">' + (Math.round(gv * 10) / 10) + '</text>';
    }
    if (opt.band && opt.band.length) { /* 置信带 [{x,pred,lo,hi}] */
      var bp = opt.band.map(function (b) { return [X(b.x), Y(b.hi), Y(b.lo), Y(b.pred)]; });
      out += '<path d="M' + bp.map(function (b) { return b[0] + ',' + b[1]; }).join('L') + 'L' + bp.slice().reverse().map(function (b) { return b[0] + ',' + b[2]; }).join('L') + 'Z" fill="rgba(255,136,0,0.12)" stroke="rgba(255,136,0,0.35)" stroke-dasharray="3,2"/>';
      bp.forEach(function (b, i) {
        out += '<circle cx="' + b[0] + '" cy="' + b[3] + '" r="2.6" fill="#ff8800"/>';
        out += '<text x="' + b[0] + '" y="' + (b[3] - 6) + '" font-size="8" fill="#ff8800" text-anchor="middle">' + opt.band[i].pred + '</text>';
      });
    }
    if (opt.fill) {
      out += '<path d="M' + X(xs[0]) + ',' + Y(ys[0]) + points.slice(1).map(function (p) { return 'L' + X(p.x) + ',' + Y(p.y); }).join('') + 'L' + X(xs[xs.length - 1]) + ',' + Y(mnY) + 'L' + X(xs[0]) + ',' + Y(mnY) + 'Z" fill="' + opt.fill + '"/>';
    }
    out += '<path d="M' + X(xs[0]) + ',' + Y(ys[0]) + points.slice(1).map(function (p) { return 'L' + X(p.x) + ',' + Y(p.y); }).join('') + '" fill="none" stroke="' + color + '" stroke-width="1.8" style="filter:drop-shadow(0 0 4px ' + color + '66)"/>';
    points.forEach(function (p) {
      out += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="2" fill="' + color + '"/>';
      if (p.label) out += '<text x="' + X(p.x) + '" y="' + (h - 6) + '" font-size="8" fill="#5a7a90" text-anchor="middle">' + esc(String(p.label)) + '</text>';
    });
    if (opt.legend) out += '<text x="' + (w - pad.r - 4) + '" y="' + (pad.t - 3) + '" font-size="9" fill="#7fc8e8" text-anchor="end">' + esc(opt.legend) + '</text>';
    out += '</svg>';
    return out;
  }

  function svgBars(items, opt) {
    opt = opt || {};
    if (!items.length) return '<div class="ma-empty">无数据</div>';
    var max = Math.max.apply(null, items.map(function (x) { return x.value; }).concat([1]));
    var rowH = opt.rowH || 20, w = opt.w || 300, labelW = opt.labelW || 108;
    var h = items.length * rowH + 4;
    var out = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="max-width:100%">';
    items.forEach(function (it, i) {
      var y = i * rowH + 2;
      var bw = (w - labelW - 44) * (it.value / max);
      var color = it.color || '#00d4ff';
      out += '<text x="' + (labelW - 6) + '" y="' + (y + rowH / 2 + 3) + '" font-size="10" fill="' + (it.tc || '#8fb8cc') + '" text-anchor="end">' + esc(String(it.label).slice(0, 12)) + '</text>';
      out += '<rect x="' + labelW + '" y="' + (y + 3) + '" width="' + Math.max(1, bw) + '" height="' + (rowH - 8) + '" rx="2" fill="' + color + '" opacity="0.85" style="filter:drop-shadow(0 0 3px ' + color + '55)"/>';
      out += '<text x="' + (labelW + Math.max(1, bw) + 5) + '" y="' + (y + rowH / 2 + 3) + '" font-size="10" fill="#9fe8ff">' + it.value + (opt.unit || '') + '</text>';
    });
    out += '</svg>';
    return out;
  }

  /* 共现网络：圆环布局零依赖 */
  function svgNetwork(nodes, links, size) {
    size = size || 330;
    var cx = size / 2, cy = size / 2, R = size / 2 - 54;
    var n = nodes.length;
    if (!n) return '<div class="ma-empty">无共现数据</div>';
    var pos = {};
    nodes.forEach(function (nd, i) {
      var a = -Math.PI / 2 + (2 * Math.PI * i / n);
      pos[nd.id] = [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
    });
    var maxW = Math.max.apply(null, links.map(function (l) { return l.weight; }).concat([1]));
    var maxC = Math.max.apply(null, nodes.map(function (x) { return x.count; }).concat([1]));
    var out = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="rgba(0,212,255,0.08)" stroke-dasharray="2,4"/>';
    links.forEach(function (l) {
      var a = pos[l.source], b = pos[l.target];
      if (!a || !b) return;
      var op = 0.10 + (l.weight / maxW) * 0.55;
      out += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="rgba(0,212,255,' + op.toFixed(2) + ')" stroke-width="' + (1 + l.weight / maxW * 2).toFixed(1) + '"/>';
    });
    nodes.forEach(function (nd) {
      var p = pos[nd.id];
      var r = 5 + (nd.count / maxC) * 13;
      var col = nd.sufficient ? '#00d4ff' : '#5a7a90';
      out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + r.toFixed(1) + '" fill="' + col + '22" stroke="' + col + '" stroke-width="1.4" style="filter:drop-shadow(0 0 5px ' + col + '66)"><title>' + esc(nd.name) + ' ' + nd.count + ' 起</title></circle>';
      out += '<text x="' + p[0] + '" y="' + (p[1] + r + 11) + '" font-size="9" fill="#9fe8ff" text-anchor="middle">' + esc(nd.name.slice(0, 6)) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  /* ============ 六大专项注册表 ============ */
  var MODELS = [
    { key: 'overview', name: '中枢总览', icon: '⬡', agent: null, desc: '六专项态势合成' },
    { key: 'org', name: '恐怖组织动态', icon: '🎯', agent: 'org-analyst', agentName: '组织画像师', needs: 'org', desc: '活动指数 · 共现网络 · 能力雷达' },
    { key: 'terror', name: '国别恐袭行为画像', icon: '💥', agent: 'counter-terror', agentName: '反恐分析师', needs: 'country', desc: 'TTP 画像 · Hawkes 预测 · 事件链' },
    { key: 'kidnap', name: '海外绑架行动模式', icon: '⛓️', agent: 'kidnap-analyst', agentName: '绑架模式分析师', needs: 'text', desc: '模式聚类 · 受害画像 · 走廊' },
    { key: 'geo', name: '地缘安全风险', icon: '🌐', agent: 'geo-officer', agentName: '地缘研判官', needs: 'country', desc: '六维 R · CUSUM · 溢出传导 · 30日预测' },
    { key: 'sanctions', name: '对华制裁', icon: '⚖️', agent: 'sanctions-officer', agentName: '制裁合规官', needs: 'enterprise', desc: '实体抽取 · 类型分类 · 项目关联' },
    { key: 'minerals', name: '关键矿产及海关', icon: '⛏️', agent: 'supply-sentinel', agentName: '供应链哨兵', needs: 'mineral', desc: '矿产映射 · 供应链风险 · 通道' }
  ];

  var MA = {
    _view: 'overview',
    _data: {},
    _agent: {},
    _sel: { org: 'taliban', country: '巴基斯坦', geoCountry: '伊朗', text: '绑架 中国公民', enterprise: '华为', mineral: '锂' },
    _busy: false,

    init: function () {
      ensureCss();
      var root = document.getElementById('models-root');
      if (!root) return;
      root.innerHTML =
        '<div class="ma-root">' +
          '<div class="ma-scan"></div>' +
          '<div class="ma-layout">' +
            '<div id="ma-nav" class="ma-hud-card"></div>' +
            '<div id="ma-canvas" class="ma-scroll" style="min-width:0"></div>' +
            '<div id="ma-agent" class="ma-hud-card ma-scroll" style="max-height:calc(100vh - 96px);overflow-y:auto"></div>' +
          '</div>' +
        '</div>';
      this._renderNav();
      this._renderAgentPanel();
      this._show('overview');
    },

    _renderNav: function () {
      var host = document.getElementById('ma-nav');
      var self = this;
      host.innerHTML =
        '<div class="ma-tt"><span class="ma-dot"></span>ORPS 大情报分析中枢</div>' +
        '<div class="ma-nav-group">模型导航树</div>' +
        MODELS.map(function (m) {
          return '<div class="ma-nav-item' + (self._view === m.key ? ' on' : '') + '" data-mv="' + m.key + '" title="' + esc(m.desc) + '">' +
            '<span class="ma-ic">' + m.icon + '</span><span>' + m.name + '</span>' +
            (m.agent ? '<span class="ma-badge">AI</span>' : '') + '</div>';
        }).join('') +
        '<div class="ma-nav-group">数据底数</div>' +
        '<div id="ma-nav-meta" style="padding:2px 14px 10px;font-size:10px;color:var(--text3);line-height:1.7">加载中…</div>';
      host.querySelectorAll('[data-mv]').forEach(function (el) {
        el.addEventListener('click', function () { self._show(el.getAttribute('data-mv')); });
      });
      fetchJSON('/api/models/overview').then(function (d) {
        var m = document.getElementById('ma-nav-meta');
        if (!m || !d.ok) return;
        m.innerHTML = '事件底数 <b style="color:#00e5ff">' + d.window.totalEvents + '</b> 条<br>窗口 <b style="color:#00e5ff">' + d.window.spanDays + '</b> 天<br>' + d.window.from + ' ~ ' + d.window.to + '<br>涉华 <b style="color:#00e5ff">' + d.window.chinaRelated + '</b> 条 · 组织 <b style="color:#00e5ff">' + d.orgs.length + '</b> 个';
      }).catch(function () {});
    },

    _show: function (key) {
      this._view = key;
      var host = document.getElementById('ma-nav');
      if (host) host.querySelectorAll('[data-mv]').forEach(function (el) {
        el.classList.toggle('on', el.getAttribute('data-mv') === key);
      });
      this._renderAgentPanel();
      var fn = { overview: '_vOverview', org: '_vOrg', terror: '_vTerror', kidnap: '_vKidnap', geo: '_vGeo', sanctions: '_vSanctions', minerals: '_vMinerals' }[key];
      if (fn) this[fn]();
    },

    _canvas: function (html) {
      var c = document.getElementById('ma-canvas');
      if (c) c.innerHTML = html;
    },
    _load: function (label) {
      this._canvas('<div class="ma-hud-card"><div class="ma-empty ma-pulse">⟳ ' + esc(label || '算法引擎计算中') + '…</div></div>');
    },

    /* ================= 中枢总览 ================= */
    _vOverview: function () {
      var self = this;
      this._load('中枢总览聚合');
      fetchJSON('/api/models/overview').then(function (ov) {
        fetchJSON('/api/models/alerts').then(function (al) {
          if (self._view !== 'overview') return;
          var byType = (ov.byType || []).slice(0, 6);
          var topC = (ov.countries || []).slice(0, 8);
          var alerts = (al.alerts || []);
          var redN = alerts.filter(function (a) { return a.level === 'red'; }).length;
          self._canvas(
            '<div class="ma-hud-card" style="margin-bottom:10px"><div class="ma-tt"><span class="ma-dot"></span>中枢总览 · 六大专项态势合成<small>' + esc(ov.window.from + ' ~ ' + ov.window.to) + '</small></div>' +
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:4px 12px 12px">' +
              '<div class="ma-kpi"><div class="v">' + ov.window.totalEvents + '</div><div class="l">已审计事件底数</div><div class="s">活跃库+归档库全量</div></div>' +
              '<div class="ma-kpi"><div class="v">' + ov.window.chinaRelated + '</div><div class="l">涉华关联事件</div><div class="s">chinaRelated=true</div></div>' +
              '<div class="ma-kpi"><div class="v">' + ov.orgs.length + '</div><div class="l">归因威胁组织</div><div class="s">threats.js 库匹配</div></div>' +
              '<div class="ma-kpi"><div class="v" style="color:' + (redN ? '#ff3355' : '#00e5ff') + '">' + alerts.length + '</div><div class="l">模型异动信号</div><div class="s">红 ' + redN + ' / 橙 ' + alerts.filter(function (a) { return a.level === 'orange'; }).length + '</div></div>' +
            '</div></div>' +
            '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">' +
              MODELS.filter(function (m) { return m.agent; }).map(function (m) {
                return '<div class="ma-hud-card" style="cursor:pointer" data-jump="' + m.key + '">' +
                  '<div class="ma-tt">' + m.icon + ' ' + m.name + '<small>' + esc(m.desc) + '</small></div>' +
                  '<div style="padding:2px 12px 10px;font-size:11px;color:var(--text2);line-height:1.6">' +
                    '算法引擎就绪 · 智能体 <b style="color:#00e5ff">' + m.agentName + '</b> 在线' +
                    '<div style="margin-top:6px"><span class="ma-btn" style="padding:4px 12px;font-size:11px">进入专项 →</span></div>' +
                  '</div></div>';
              }).join('') +
            '</div>' +
            '<div class="ma-hud-card" style="margin-top:10px"><div class="ma-tt">🚨 模型异动信号<small>第一阶段功能区内呈现，预警中心接入留二期</small></div>' +
              '<div style="display:flex;gap:8px;overflow-x:auto;padding:4px 12px 12px" class="ma-scroll">' +
              (alerts.length ? alerts.slice(0, 8).map(function (a) {
                var lv = LV[a.level] || LV.blue;
                return '<div style="min-width:230px;flex:1;border-left:3px solid ' + lv.c + ';background:rgba(255,255,255,0.02);border-radius:6px;padding:7px 10px">' +
                  '<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">' +
                    '<span class="ma-chip" style="background:' + lv.c + '22;color:' + lv.c + '">' + lv.n + '级</span>' +
                    '<span style="font-size:10px;color:var(--text3)">' + esc(a.model) + '</span></div>' +
                  '<div style="font-size:12px;font-weight:600;line-height:1.4">' + esc(a.title) + '</div>' +
                  '<div style="font-size:10px;color:var(--text3);margin-top:3px;line-height:1.5">' + esc(a.desc) + '</div></div>';
              }).join('') : '<div class="ma-empty">各模型信号均在阈值内</div>') +
              '</div></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
              '<div class="ma-hud-card"><div class="ma-tt">📊 事件类型分布<small>data_type</small></div><div style="padding:6px 12px 12px">' +
                svgBars(byType.map(function (t) { return { label: t[0], value: t[1], color: '#00d4ff' }; }), { w: 440, labelW: 150 }) + '</div></div>' +
              '<div class="ma-hud-card"><div class="ma-tt">🌍 事件国家 Top<small>全类型</small></div><div style="padding:6px 12px 12px">' +
                svgBars(topC.map(function (t) { return { label: t[0], value: t[1], color: '#ff8800' }; }), { w: 440, labelW: 100 }) + '</div></div>' +
            '</div>'
          );
          document.querySelectorAll('[data-jump]').forEach(function (el) {
            el.addEventListener('click', function () { self._show(el.getAttribute('data-jump')); });
          });
        });
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">总览加载失败：' + esc(e.message) + '</div></div>'); });
    },

    /* ================= 专项一：恐怖组织动态 ================= */
    _vOrg: function () {
      var self = this;
      this._load('组织活动指数计算');
      fetchJSON('/api/models/org-index').then(function (d) {
        if (self._view !== 'org') return;
        if (!d.ok) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">' + esc(d.error) + '</div></div>'); return; }
        self._data.orgIndex = d;
        var rows = d.rows.slice(0, 18);
        self._canvas(
          '<div class="ma-hud-card"><div class="ma-tt">🎯 恐怖组织动态专项 · 组织活动指数榜</div>' +
          '<div style="padding:0 12px 6px" class="ma-dim">' + esc(d.formula) + '</div>' +
          '<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:0">' +
            '<div style="padding:4px 6px 10px 12px;max-height:520px;overflow-y:auto" class="ma-scroll">' +
              '<table class="ma-tb"><thead><tr><th>组织</th><th>指数</th><th>事件</th><th>λ/日</th><th>地理</th><th>KL</th></tr></thead><tbody>' +
              rows.map(function (o) {
                var gray = !o.sufficient;
                return '<tr class="ma-row' + (o.id === self._sel.org ? ' on' : '') + (gray ? ' ma-gray' : '') + '" data-org="' + esc(o.id) + '">' +
                  '<td style="font-weight:600">' + esc(o.name) + (gray ? ' <span style="font-size:9px;color:var(--text3)">样本不足</span>' : '') + '</td>' +
                  '<td style="color:#00e5ff;font-weight:800">' + o.activityIndex + '</td>' +
                  '<td>' + o.count + '</td>' +
                  '<td>' + o.lam + '</td>' +
                  '<td>' + o.geoSpread + '国</td>' +
                  '<td>' + (o.tacticKL == null ? '—' : o.tacticKL) + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
            '<div id="ma-org-detail" style="padding:4px 12px 10px 6px"><div class="ma-empty ma-pulse">⟳ 能力雷达装配中…</div></div>' +
          '</div></div>' +
          '<div class="ma-hud-card" style="margin-top:10px"><div class="ma-tt">🕸️ 组织共现网络<small>同事件双组织命中即连边</small></div>' +
            '<div id="ma-org-net" style="padding:6px 12px 12px;display:flex;gap:14px;flex-wrap:wrap"><div class="ma-empty ma-pulse">网络构建中…</div></div></div>'
        );
        document.querySelectorAll('[data-org]').forEach(function (el) {
          el.addEventListener('click', function () {
            self._sel.org = el.getAttribute('data-org');
            document.querySelectorAll('[data-org]').forEach(function (x) { x.classList.toggle('on', x === el); });
            self._renderOrgDetail();
            self._renderAgentPanel();
          });
        });
        self._renderOrgDetail();
        fetchJSON('/api/models/org-network').then(function (net) {
          var host = document.getElementById('ma-org-net');
          if (!host || self._view !== 'org') return;
          if (!net.ok || !net.nodes.length) { host.innerHTML = '<div class="ma-empty">共现样本不足</div>'; return; }
          var topNodes = net.nodes.slice(0, 14);
          var ids = new Set(topNodes.map(function (n) { return n.id; }));
          host.innerHTML = '<div>' + svgNetwork(topNodes, net.links.filter(function (l) { return ids.has(l.source) && ids.has(l.target); }).slice(0, 30), 330) + '</div>' +
            '<div style="flex:1;min-width:220px"><div class="ma-dim" style="margin-bottom:6px">' + esc(net.method) + '<br>' + esc(net.note) + '</div>' +
            net.links.slice(0, 10).map(function (l) {
              var a = net.nodes.find(function (n) { return n.id === l.source; }) || {};
              var b = net.nodes.find(function (n) { return n.id === l.target; }) || {};
              return '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' + esc(a.name || l.source) + ' ↔ ' + esc(b.name || l.target) + ' <b style="color:#00e5ff">' + l.weight + '</b> 次共现</div>';
            }).join('') + '</div>';
        }).catch(function () {});
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">加载失败：' + esc(e.message) + '</div></div>'); });
    },

    _renderOrgDetail: function () {
      var host = document.getElementById('ma-org-detail');
      if (!host) return;
      var d = this._data.orgIndex;
      if (!d) return;
      var self = this;
      var o = d.rows.find(function (x) { return x.id === self._sel.org; }) || d.rows[0];
      if (!o) { host.innerHTML = '<div class="ma-empty">无组织数据</div>'; return; }
      if (!o.sufficient) {
        host.innerHTML = '<div class="ma-empty">' +
          '<div style="font-size:34px;margin-bottom:8px">🚫</div>' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:6px">样本不足</div>' +
          '<div class="ma-dim">' + esc(o.name) + ' 归因事件仅 ' + o.count + ' 起（需 ≥' + d.minEvents + ' 起），能力雷达不生成</div></div>';
        return;
      }
      host.innerHTML = '<div class="ma-empty ma-pulse">⟳ 能力雷达装配中…</div>';
      fetchJSON('/api/models/org-radar?id=' + encodeURIComponent(o.id)).then(function (r) {
        if (self._view !== 'org') return;
        if (!r.ok) { host.innerHTML = '<div class="ma-empty">' + esc(r.error) + '</div>'; return; }
        host.innerHTML =
          '<div style="text-align:center">' + svgRadar(r.axes, [{ name: r.name, color: '#00d4ff', values: r.axes.map(function (a) { return a.v; }) }], 210) + '</div>' +
          '<div style="font-size:11px;line-height:1.8;padding:4px 6px">' +
            '<div style="font-size:13px;font-weight:700;color:#9fe8ff">' + esc(r.name) + ' · 活动指数 <b style="color:#00e5ff">' + r.activityIndex + '</b></div>' +
            '<div class="ma-dim">' + r.axes.map(function (a) { return a.n + ' ' + a.v; }).join(' · ') + '</div>' +
            '<div class="ma-dim">' + esc(r.normNote) + '</div>' +
          '</div>';
      });
    },

    /* ================= 专项二：国别恐袭行为画像 ================= */
    _vTerror: function () {
      var self = this;
      this._load('TTP 行为画像计算');
      fetchJSON('/api/models/behavior?country=' + encodeURIComponent(this._sel.country)).then(function (d) {
        if (self._view !== 'terror') return;
        if (!d.ok) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">' + esc(d.error) + '</div></div>'); return; }
        if (d.insufficient) {
          self._canvas('<div class="ma-hud-card"><div class="ma-empty">🚫 ' + esc(d.note) + '</div>' +
            '<div style="text-align:center;padding-bottom:12px">' + self._countryPickerHtml('terror') + '</div></div>');
          self._bindCountryPicker('terror');
          return;
        }
        var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        var hourTop = d.ttp.hourHist.map(function (v, h) { return { h: h, v: v }; }).sort(function (a, b) { return b.v - a.v; })[0];
        self._canvas(
          '<div class="ma-hud-card"><div class="ma-tt">💥 国别恐袭行为画像 · ' + esc(d.country) + '<small>' + d.count + ' 起 · 窗口 ' + d.spanDays + ' 天</small></div>' +
          '<div style="padding:4px 12px 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + self._countryPickerHtml('terror') +
            '<span class="ma-dim">口径：data_type=terror_events · Hawkes λ(t)=μ+Σα·exp(−β(t−tᵢ)) · μ 近21天自适应</span></div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 12px 12px">' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🕐 时段分布（带时刻 ' + d.ttp.withHour + '/' + d.count + ' · 峰值 ' + hourTop.h + ' 时）</div>' +
              svgBars(d.ttp.hourHist.map(function (v, h) { return { label: h + '时', value: v, color: '#00d4ff' }; }).filter(function (_, i) { return i % 2 === 0; }), { w: 300, labelW: 34, rowH: 14 }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">📅 星期分布</div>' +
              svgBars(d.ttp.weekHist.map(function (v, i) { return { label: days[i], value: v, color: '#ff8800' }; }), { w: 300, labelW: 44, rowH: 16 }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">☠️ 伤亡模式（含数字 ' + d.ttp.casualty.covered + '/' + d.ttp.casualty.total + ' 起）</div>' +
              (d.ttp.casualty.dead ?
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">' +
                  '<div class="ma-kpi"><div class="v" style="color:#ff3355">' + d.ttp.casualty.dead.avg + '</div><div class="l">平均死亡/起</div></div>' +
                  '<div class="ma-kpi"><div class="v" style="color:#ff3355">' + d.ttp.casualty.dead.max + '</div><div class="l">最大单次死亡</div></div>' +
                  '<div class="ma-kpi"><div class="v">' + d.ttp.casualty.dead.p90 + '</div><div class="l">P90 死亡</div></div>' +
                  '<div class="ma-kpi"><div class="v">' + (d.ttp.casualty.injured ? d.ttp.casualty.injured.avg : '—') + '</div><div class="l">平均受伤/起</div></div>' +
                '</div>' : '<div class="ma-empty">事件文本未含可抽取伤亡数字</div>') +
              '<div class="ma-dim" style="margin-top:4px">' + esc(d.ttp.casualty.note) + '</div></div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🧨 手法偏好</div>' + svgBars(d.ttp.methods.slice(0, 7).map(function (m) { return { label: m.n, value: m.c, color: '#00d4ff' }; }), { w: 300, labelW: 96, rowH: 16 }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🎯 目标偏好</div>' + svgBars(d.ttp.targets.slice(0, 7).map(function (m) { return { label: m.n, value: m.c, color: '#ff3355' }; }), { w: 300, labelW: 96, rowH: 16 }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🔮 Hawkes 强度预测</div>' +
              (d.hawkes ?
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">' +
                  '<div class="ma-kpi"><div class="v">' + d.hawkes.ex7 + '</div><div class="l">未来7天期望</div></div>' +
                  '<div class="ma-kpi"><div class="v">' + d.hawkes.ex30 + '</div><div class="l">未来30天期望</div></div>' +
                  '<div class="ma-kpi"><div class="v" style="font-size:15px">' + d.hawkes.lamNow + '</div><div class="l">当前 λ(t)</div></div>' +
                  '<div class="ma-kpi"><div class="v" style="font-size:15px">' + d.hawkes.params.alpha + '/' + d.hawkes.params.beta + '</div><div class="l">α/β</div></div>' +
                '</div><div class="ma-dim" style="margin-top:4px">μ=' + d.hawkes.params.mu + '（近21天自适应基线）· MLE 网格搜索 α/β</div>'
                : '<div class="ma-empty">样本不足 30 起，不生成 Hawkes 预测</div>') +
            '</div>' +
          '</div></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
            '<div class="ma-hud-card"><div class="ma-tt">🔥 热点迁移对比<small>前半窗 vs 后半窗</small></div>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px 12px 12px">' +
                '<div><div class="ma-dim" style="margin-bottom:4px">前半窗</div>' + svgBars(d.hotspotMig.firstHalf.map(function (x) { return { label: x.place, value: x.c, color: '#5a7a90' }; }), { w: 250, labelW: 90, rowH: 16 }) + '</div>' +
                '<div><div class="ma-dim" style="margin-bottom:4px">后半窗</div>' + svgBars(d.hotspotMig.secondHalf.map(function (x) { return { label: x.place, value: x.c, color: '#00e5ff' }; }), { w: 250, labelW: 90, rowH: 16 }) + '</div>' +
              '</div></div>' +
            '<div class="ma-hud-card"><div class="ma-tt">⛓️ 事件链聚类<small>3 日窗口 ≥3 起连续</small></div>' +
              '<div style="padding:6px 12px 12px">' +
                (d.chains.length ? d.chains.map(function (c) {
                  return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                    '<span class="ma-chip" style="background:rgba(255,51,85,0.15);color:#ff3355">' + c.count + ' 起</span>' +
                    '<span style="font-size:11px">' + c.start + ' ~ ' + c.end + '</span>' +
                    '<span class="ma-dim">' + c.days + ' 天连续</span></div>';
                }).join('') : '<div class="ma-empty">窗口内无 3 日 ≥3 起连续事件链</div>') +
              '</div></div>' +
          '</div>' +
          '<div class="ma-hud-card" style="margin-top:10px"><div class="ma-tt">📰 近期恐袭事件<small>点击展开证据详情</small></div>' +
            '<div style="max-height:180px;overflow-y:auto;padding:2px 0 6px" class="ma-scroll">' +
            d.recent.map(function (e) {
              return '<div class="ma-evi" data-evid="' + esc(e.id) + '"><span style="color:var(--text3)">' + e.time + '</span> <span style="color:var(--orange)">' + esc(e.country) + '</span> ' + esc(e.title) + '</div>';
            }).join('') + '</div></div>'
        );
        self._bindCountryPicker('terror');
        self._bindEvidence();
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">加载失败：' + esc(e.message) + '</div></div>'); });
    },

    _countryPickerHtml: function (tag) {
      var countries = ['尼日利亚', '巴基斯坦', '印度', '伊朗', '伊拉克', '阿富汗', '索马里', '马里', '尼日尔', '缅甸', '刚果（金）', '也门', '叙利亚', '苏丹', '肯尼亚', '布基纳法索', '印度尼西亚', '泰国', '菲律宾', '埃塞俄比亚'];
      var cur = tag === 'geo' ? this._sel.geoCountry : this._sel.country;
      return '<select class="ma-select" id="ma-ctry-' + tag + '">' + countries.map(function (c) {
        return '<option value="' + c + '"' + (c === cur ? ' selected' : '') + '>' + c + '</option>';
      }).join('') + '</select>';
    },
    _bindCountryPicker: function (tag) {
      var self = this;
      var el = document.getElementById('ma-ctry-' + tag);
      if (!el) return;
      el.addEventListener('change', function () {
        if (tag === 'geo') { self._sel.geoCountry = el.value; self._vGeo(); }
        else { self._sel.country = el.value; self._vTerror(); }
        self._renderAgentPanel();
      });
    },

    /* ================= 专项三：绑架行动模式 ================= */
    _vKidnap: function () {
      var self = this;
      this._load('绑架模式聚类');
      fetchJSON('/api/models/kidnap-modes').then(function (d) {
        if (self._view !== 'kidnap') return;
        if (!d.ok) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">' + esc(d.error) + '</div></div>'); return; }
        self._canvas(
          '<div class="ma-hud-card"><div class="ma-tt">⛓️ 海外绑架行动模式专项<small>' + d.total + ' 起 · 窗口 ' + d.spanDays + ' 天 · 规则聚类透明</small></div>' +
          '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:4px 12px 12px">' +
            '<div><div class="ma-dim" style="margin-bottom:4px">📈 周度趋势</div>' +
              svgLine(d.weekly.map(function (x, i) { return { x: i + 1, y: x.c, label: 'W' + (i + 1) }; }), { color: '#ff8800', fill: 'rgba(255,136,0,0.08)', h: 130, w: 430, legend: '绑架事件数/周' }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🧩 模式聚类（规则优先级）</div>' +
              d.modes.map(function (m) {
                return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                  '<span class="ma-chip" style="background:rgba(0,212,255,0.12);color:#00e5ff;min-width:90px;text-align:center">' + esc(m.n) + '</span>' +
                  '<b style="color:#00e5ff">' + m.count + '</b><span class="ma-dim">' + m.share + '% · ' + esc(m.desc) + '</span></div>';
              }).join('') + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">👤 受害画像 · 国籍</div>' +
              svgBars(d.victimNat.slice(0, 8).map(function (x) { return { label: x.n, value: x.c, color: '#00d4ff' }; }), { w: 430, labelW: 90, rowH: 16 }) +
              '<div class="ma-dim" style="margin-top:2px">' + esc(d.victimNote) + '</div></div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">💼 受害画像 · 职业</div>' +
              svgBars(d.victimRole.slice(0, 8).map(function (x) { return { label: x.n, value: x.c, color: '#ff8800' }; }), { w: 430, labelW: 100, rowH: 16 }) + '</div>' +
          '</div></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
            '<div class="ma-hud-card"><div class="ma-tt">🗺️ 绑架走廊<small>发生国 → 受害国籍（可识别子集）</small></div>' +
              '<div style="padding:6px 12px 12px">' +
                (d.corridors.length ? d.corridors.map(function (c) {
                  return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                    '<span style="font-size:12px;font-weight:600">' + esc(c.from) + '</span>' +
                    '<span style="color:var(--text3)">→</span>' +
                    '<span class="ma-chip" style="background:rgba(255,136,0,0.12);color:#ff8800">' + esc(c.toLabel) + '</span>' +
                    '<b style="color:#00e5ff;margin-left:auto">' + c.count + '</b><span class="ma-dim">/ 全国 ' + c.total + '</span></div>';
                }).join('') : '<div class="ma-empty">走廊样本不足</div>') +
              '</div></div>' +
            '<div class="ma-hud-card"><div class="ma-tt">🔎 相似案例检索<small>Dice 题名二元组相似度</small></div>' +
              '<div style="padding:8px 12px 12px">' +
                '<div style="display:flex;gap:8px;margin-bottom:8px">' +
                  '<input id="ma-kq" class="ma-input" style="flex:1" placeholder="输入事件描述，如：绑架 中国公民 / 俾路支 工程师" value="' + esc(self._sel.text) + '"/>' +
                  '<button class="ma-btn" id="ma-kq-btn">检索</button></div>' +
                '<div id="ma-kq-res"><div class="ma-empty">输入描述检索历史相似绑架案</div></div>' +
              '</div></div>' +
          '</div>'
        );
        var btn = document.getElementById('ma-kq-btn');
        if (btn) btn.addEventListener('click', function () {
          var q = document.getElementById('ma-kq').value.trim();
          self._sel.text = q;
          var res = document.getElementById('ma-kq-res');
          res.innerHTML = '<div class="ma-empty ma-pulse">⟳ 相似度计算中…</div>';
          fetchJSON('/api/models/kidnap/search?q=' + encodeURIComponent(q)).then(function (r) {
            if (!r.ok || !r.results.length) { res.innerHTML = '<div class="ma-empty">无相似案例</div>'; return; }
            res.innerHTML = r.results.slice(0, 8).map(function (x) {
              return '<div class="ma-evi" data-evid="' + esc(x.id || '') + '">' +
                '<span style="color:#00e5ff;font-weight:700;min-width:40px;display:inline-block">' + x.sim + '</span>' +
                '<span style="color:var(--text3)">' + x.time + '</span> <span style="color:var(--orange)">' + esc(x.country) + '</span> ' + esc(x.title) + '</div>';
            }).join('');
            self._bindEvidence();
          });
        });
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">加载失败：' + esc(e.message) + '</div></div>'); });
    },

    /* ================= 专项四：地缘安全风险 ================= */
    _vGeo: function () {
      var self = this;
      this._load('地缘溢出传导计算');
      var country = this._sel.geoCountry;
      fetchJSON('/api/models/geo-spill?country=' + encodeURIComponent(country)).then(function (sp) {
        if (self._view !== 'geo') return;
        if (!sp.ok) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">' + esc(sp.error) + '</div></div>'); return; }
        fetchJSON('/api/models/geo?country=' + encodeURIComponent(country)).then(function (gd) {
          if (self._view !== 'geo') return;
          var detail = gd && gd.ok && gd.detail ? gd.detail : null;
          var axes = detail ? [
            { n: '政治' }, { n: '经济' }, { n: '社会' }, { n: '安全' }, { n: '外部' }, { n: '涉我' }
          ] : null;
          var curDims = detail && detail.dims && detail.dims.length ? detail.dims[detail.dims.length - 1] : null;
          var series = detail && detail.series ? detail.series : [];
          var cusum = detail && detail.cusum ? detail.cusum : [];
          var cps = detail && detail.changepoints ? detail.changepoints : [];
          var f30pts = (sp.forecast30 || []).map(function (f, i) { return { x: series.length + i, y: f.pred, label: '' }; });
          var band = (sp.forecast30 || []).map(function (f, i) { return { x: series.length + i, pred: f.pred, lo: f.lo, hi: f.hi }; });
          self._canvas(
            '<div class="ma-hud-card"><div class="ma-tt">🌐 地缘安全风险专项 · ' + esc(country) + '<small>六维 R + CUSUM + 溢出传导 + 30日预测</small></div>' +
            '<div style="padding:4px 12px 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + self._countryPickerHtml('geo') +
              (sp.curR != null ? '<span class="ma-chip" style="background:rgba(0,212,255,0.12);color:#00e5ff">当前 R=' + sp.curR + '</span>' : '') +
              (sp.deltaR != null ? '<span class="ma-chip" style="background:' + (sp.deltaR >= 0 ? 'rgba(255,51,85,0.14);color:#ff3355' : 'rgba(0,255,159,0.12);color:#00ff9f') + '">周 ΔR=' + (sp.deltaR >= 0 ? '+' : '') + sp.deltaR + '</span>' : '') +
              '<span class="ma-chip" style="background:rgba(255,136,0,0.12);color:#ff8800">CUSUM 变点 ' + cps.length + ' 处</span></div>' +
            '<div style="display:grid;grid-template-columns:250px minmax(0,1fr);gap:10px;padding:0 12px 12px">' +
              '<div style="text-align:center">' + (axes && curDims ? svgRadar(axes, [{ name: country, color: '#00d4ff', values: [curDims.political.norm, curDims.economic.norm, curDims.social.norm, curDims.security.norm, curDims.external.norm, curDims.china.norm] }], 220) : '<div class="ma-empty">六维样本不足</div>') +
                '<div class="ma-dim">六维当前周归一化（跨国家×周 min-max）</div></div>' +
              '<div><div class="ma-dim" style="margin-bottom:4px">📈 周度 R 走势 + CUSUM 变点 + 30 日预测（虚线置信带）</div>' +
                svgLine(
                  series.map(function (v, i) { return { x: i, y: v, label: 'W' + (i + 1) }; }).concat(f30pts.map(function (p) { return { x: p.x, y: p.y, label: '' }; })),
                  { color: '#00d4ff', fill: 'rgba(0,212,255,0.06)', h: 190, w: 560, band: band, legend: '蓝=历史周R · 橙=线性外推±1.96σ' }) +
                (cps.length ? '<div class="ma-dim" style="margin-top:2px">⚠️ 变点周：' + cps.map(function (i) { return '第' + (i + 1) + '周'; }).join('、') + '（S 超 3σ）</div>' : '<div class="ma-dim" style="margin-top:2px">CUSUM 未检出风险升级变点</div>') +
                '<div class="ma-dim">' + esc(sp.forecastNote || '') + '</div></div>' +
            '</div></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
              '<div class="ma-hud-card"><div class="ma-tt">🌊 邻国溢出传导<small>' + esc(sp.spillNote) + '</small></div>' +
                '<div style="padding:6px 12px 12px">' +
                  (sp.spill.length ? sp.spill.slice(0, 7).map(function (s) {
                    return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                      '<span style="font-size:12px;font-weight:600;min-width:76px">' + esc(s.neighbor) + '</span>' +
                      '<span class="ma-chip" style="background:rgba(0,212,255,0.1);color:#00e5ff">' + s.secTotal + ' 起</span>' +
                      (s.corr != null ? '<span class="ma-dim">相关 ' + s.corr + '</span>' : '<span class="ma-dim">样本不足</span>') +
                      (s.R != null ? '<span class="ma-dim" style="margin-left:auto">R=' + s.R + ' Δ' + (s.deltaR >= 0 ? '+' : '') + s.deltaR + '</span>' : '') +
                    '</div>';
                  }).join('') : '<div class="ma-empty">该国无内置邻国表</div>') +
                '</div></div>' +
              '<div class="ma-hud-card"><div class="ma-tt">🔮 30 日趋势预测<small>周度 R 线性回归外推</small></div>' +
                '<div style="padding:6px 12px 12px">' +
                  (sp.forecast30 ? sp.forecast30.map(function (f) {
                    return '<div style="display:flex;gap:10px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                      '<span style="font-size:11px;min-width:64px">' + esc(f.w) + '</span>' +
                      '<b style="color:#ff8800">' + f.pred + '</b>' +
                      '<span class="ma-dim">置信带 [' + f.lo + ' ~ ' + f.hi + ']</span></div>';
                  }).join('') : '<div class="ma-empty">' + esc(sp.forecastNote || '样本不足') + '</div>') +
                '</div></div>' +
            '</div>'
          );
          self._bindCountryPicker('geo');
        });
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">加载失败：' + esc(e.message) + '</div></div>'); });
    },

    /* ================= 专项五：对华制裁 ================= */
    _vSanctions: function () {
      var self = this;
      this._load('制裁情报抽取');
      fetchJSON('/api/models/sanctions').then(function (d) {
        if (self._view !== 'sanctions') return;
        if (!d.ok) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">' + esc(d.error) + '</div></div>'); return; }
        self._canvas(
          '<div class="ma-hud-card"><div class="ma-tt">⚖️ 对华制裁专项<small>' + d.total + ' 条命中 · ' + esc(d.scope) + '</small></div>' +
          '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:4px 12px 12px">' +
            '<div><div class="ma-dim" style="margin-bottom:4px">📈 制裁情报时间线（周度）</div>' +
              svgLine(d.weekly.map(function (x, i) { return { x: i + 1, y: x.c, label: 'W' + (i + 1) }; }), { color: '#ffcc00', fill: 'rgba(255,204,0,0.07)', h: 130, w: 430, legend: '制裁情报/周' }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🗂️ 制裁类型分布</div>' +
              svgBars(d.types.slice(0, 6).map(function (t) { return { label: t.n, value: t.c, color: '#ffcc00' }; }), { w: 430, labelW: 120, rowH: 17 }) + '</div>' +
          '</div></div>' +
          '<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:10px;margin-top:10px">' +
            '<div class="ma-hud-card"><div class="ma-tt">🏢 被制裁中企/机构实体<small>' + esc(d.entityNote) + '</small></div>' +
              '<div style="max-height:320px;overflow-y:auto;padding:4px 0 8px" class="ma-scroll">' +
              (d.entities.length ? d.entities.map(function (e) {
                return '<div style="padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.05)">' +
                  '<div style="display:flex;gap:8px;align-items:center">' +
                    '<span style="font-size:13px;font-weight:700;color:#ffcc00">' + esc(e.name) + '</span>' +
                    '<span class="ma-chip" style="background:rgba(255,204,0,0.12);color:#ffcc00">' + e.hits + ' 次命中</span>' +
                    '<span class="ma-dim" style="margin-left:auto">' + (e.latest || '') + '</span></div>' +
                  '<div class="ma-dim" style="margin-top:2px">' + esc(e.latestTitle) + '</div></div>';
              }).join('') : '<div class="ma-empty">窗口内未识别到具名中企实体（仅政策/宏观类制裁情报）</div>') +
              '</div></div>' +
            '<div class="ma-hud-card"><div class="ma-tt">🔗 涉我项目关联<small>matchProjects 命中</small></div>' +
              '<div style="padding:6px 12px 12px">' +
                (d.projects.length ? d.projects.map(function (p) {
                  return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                    '<span style="font-size:12px;font-weight:600">' + esc(p.name) + '</span>' +
                    '<span class="ma-dim">' + esc(p.country) + '</span>' +
                    '<b style="color:#ffcc00;margin-left:auto">' + p.hits + '</b></div>';
                }).join('') : '<div class="ma-empty">窗口内无项目级直接命中</div>') +
              '</div></div>' +
          '</div>' +
          '<div class="ma-hud-card" style="margin-top:10px"><div class="ma-tt">📰 近期制裁情报<small>点击展开证据详情</small></div>' +
            '<div style="max-height:200px;overflow-y:auto;padding:2px 0 6px" class="ma-scroll">' +
            d.recent.map(function (e) {
              return '<div class="ma-evi" data-evid="' + esc(e.id) + '"><span class="ma-tag">' + esc(e.stype) + '</span> <span style="color:var(--text3)">' + e.time + '</span> <span style="color:var(--orange)">' + esc(e.country) + '</span> ' + esc(e.title) + '</div>';
            }).join('') + '</div></div>'
        );
        self._bindEvidence();
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">加载失败：' + esc(e.message) + '</div></div>'); });
    },

    /* ================= 专项六：关键矿产及海关 ================= */
    _vMinerals: function () {
      var self = this;
      this._load('矿产供应链监控');
      fetchJSON('/api/models/minerals').then(function (d) {
        if (self._view !== 'minerals') return;
        if (!d.ok) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">' + esc(d.error) + '</div></div>'); return; }
        var topRisk = d.projects.filter(function (p) { return p.hits > 0; }).slice(0, 3);
        self._canvas(
          '<div class="ma-hud-card"><div class="ma-tt">⛏️ 关键矿产及海关监控专项<small>' + d.total + ' 条命中 · ' + esc(d.scope) + '</small></div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:4px 12px 12px">' +
            '<div><div class="ma-dim" style="margin-bottom:4px">⛏️ 矿产品类分布</div>' +
              svgBars(d.mineralCnt.slice(0, 8).map(function (x) { return { label: x.n, value: x.c, color: '#00d4ff' }; }), { w: 280, labelW: 64, rowH: 16 }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">🛃 海关/物流信号</div>' +
              svgBars(d.customsCnt.slice(0, 5).map(function (x) { return { label: x.n, value: x.c, color: '#ff8800' }; }), { w: 280, labelW: 76, rowH: 16 }) + '</div>' +
            '<div><div class="ma-dim" style="margin-bottom:4px">📈 情报流周度</div>' +
              svgLine(d.weekly.map(function (x, i) { return { x: i + 1, y: x.c, label: 'W' + (i + 1) }; }), { color: '#00ff9f', fill: 'rgba(0,255,159,0.06)', h: 120, w: 280, legend: '条/周' }) + '</div>' +
          '</div></div>' +
          '<div class="ma-hud-card" style="margin-top:10px"><div class="ma-tt">🏭 中资矿产项目供应链风险榜<small>' + esc(d.riskFormula) + '</small></div>' +
            '<div style="max-height:300px;overflow-y:auto;padding:4px 0 8px" class="ma-scroll">' +
            '<table class="ma-tb"><thead><tr><th>项目</th><th>国家</th><th>情报</th><th>sev均值</th><th>国别R</th><th>通道</th><th>风险指数</th></tr></thead><tbody>' +
            d.projects.filter(function (p) { return p.hits > 0 || p.supplyRisk > 0; }).slice(0, 15).map(function (p) {
              var hot = p.supplyRisk >= 15;
              return '<tr style="' + (hot ? 'background:rgba(255,51,85,0.06)' : '') + '">' +
                '<td style="font-weight:600;' + (hot ? 'color:#ff3355' : '') + '">' + esc(p.name) + (hot ? ' 🔴' : '') + '</td>' +
                '<td>' + esc(p.country) + '</td>' +
                '<td>' + p.hits + '</td>' +
                '<td>' + p.sevAvg + '</td>' +
                '<td>' + (p.geoR || '—') + '</td>' +
                '<td>' + (p.channels.length ? p.channels.map(function (c) { return '<span class="ma-tag">' + esc(c) + '</span>'; }).join('') : '—') + '</td>' +
                '<td style="font-weight:800;color:' + (hot ? '#ff3355' : '#00e5ff') + '">' + p.supplyRisk + '</td></tr>';
            }).join('') + '</tbody></table>' +
            (topRisk.length ? '<div class="ma-dim" style="padding:6px 12px">🔴 = 风险指数 ≥15 · 榜首 ' + esc(topRisk[0].name) + '（' + topRisk[0].supplyRisk + '）：' + esc(topRisk[0].formula) + '</div>' : '<div class="ma-dim" style="padding:6px 12px">窗口内矿产项目无直接情报命中，风险指数均为 0</div>') +
            '</div></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
            '<div class="ma-hud-card"><div class="ma-tt">🌍 矿产情报热点国家<small>命中数 × 国别 R</small></div>' +
              '<div style="padding:6px 12px 12px">' +
                svgBars(d.countryRisk.slice(0, 10).map(function (x) { return { label: x.country, value: x.hits, color: x.geoR >= 40 ? '#ff3355' : '#00d4ff' }; }), { w: 430, labelW: 100, rowH: 16 }) +
              '</div></div>' +
            '<div class="ma-hud-card"><div class="ma-tt">📰 近期矿产/海关情报<small>点击展开证据详情</small></div>' +
              '<div style="max-height:240px;overflow-y:auto;padding:2px 0 6px" class="ma-scroll">' +
              d.recent.map(function (e) {
                return '<div class="ma-evi" data-evid="' + esc(e.id) + '"><span style="color:var(--text3)">' + e.time + '</span> <span style="color:var(--orange)">' + esc(e.country) + '</span> ' + esc(e.title) + '</div>';
              }).join('') + '</div></div>' +
          '</div>'
        );
        self._bindEvidence();
      }).catch(function (e) { self._canvas('<div class="ma-hud-card"><div class="ma-empty">加载失败：' + esc(e.message) + '</div></div>'); });
    },

    /* ================= 智能体研判面板（右栏）================= */
    _renderAgentPanel: function () {
      var host = document.getElementById('ma-agent');
      if (!host) return;
      var self = this;
      var m = MODELS.find(function (x) { return x.key === self._view; });
      if (!m || !m.agent) {
        host.innerHTML =
          '<div class="ma-tt"><span class="ma-dot"></span>智能体研判面板</div>' +
          '<div style="padding:6px 12px 12px">' +
            '<div class="ma-dim" style="margin-bottom:8px">每专项 = 算法模型 + 智能体。选择左侧专项后，对应智能体在此就绪。</div>' +
            MODELS.filter(function (x) { return x.agent; }).map(function (x) {
              return '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                '<span>' + x.icon + '</span><div style="flex:1"><div style="font-size:12px;color:var(--text)">' + x.name + '</div>' +
                '<div class="ma-dim">智能体：' + x.agentName + '</div></div>' +
                '<span class="ma-chip" style="background:rgba(0,212,255,0.08);color:var(--text3)">待命</span></div>';
            }).join('') +
            '<div class="ma-dim" style="margin-top:10px">研判链路：Kimi 主 → 星火备 → 规则化模板降级（真实数字填充）· 全程零模拟数据</div>' +
          '</div>';
        return;
      }
      var paramHtml = '';
      if (m.needs === 'org') {
        var orgs = (this._data.orgIndex && this._data.orgIndex.rows) || [];
        paramHtml = '<label class="ma-dim">研判对象（组织）</label>' +
          '<select class="ma-select" id="ma-agent-param" style="width:100%;margin-top:4px">' +
          (orgs.length ? orgs.filter(function (o) { return o.count >= 3; }).map(function (o) {
            return '<option value="' + esc(o.id) + '"' + (o.id === self._sel.org ? ' selected' : '') + '>' + esc(o.name) + '（' + o.count + '起）' + '</option>';
          }).join('') : '<option value="' + esc(self._sel.org) + '">' + esc(self._sel.org) + '</option>') + '</select>';
      } else if (m.needs === 'country') {
        var cur = m.key === 'geo' ? this._sel.geoCountry : this._sel.country;
        paramHtml = '<label class="ma-dim">研判对象（国家）</label>' +
          '<select class="ma-select" id="ma-agent-param" style="width:100%;margin-top:4px">' +
          ['尼日利亚', '巴基斯坦', '印度', '伊朗', '伊拉克', '阿富汗', '索马里', '马里', '尼日尔', '缅甸', '刚果（金）', '也门', '叙利亚', '苏丹', '肯尼亚', '布基纳法索', '印度尼西亚', '泰国', '菲律宾', '埃塞俄比亚'].map(function (c) {
            return '<option value="' + c + '"' + (c === cur ? ' selected' : '') + '>' + c + '</option>';
          }).join('') + '</select>';
      } else if (m.needs === 'text') {
        paramHtml = '<label class="ma-dim">事件描述（相似案例匹配输入）</label>' +
          '<input class="ma-input" id="ma-agent-param" style="width:100%;margin-top:4px" value="' + esc(this._sel.text) + '" placeholder="如：绑架 中国公民 尼日利亚"/>';
      } else if (m.needs === 'enterprise') {
        paramHtml = '<label class="ma-dim">企业/机构名（制裁暴露评估）</label>' +
          '<input class="ma-input" id="ma-agent-param" style="width:100%;margin-top:4px" value="' + esc(this._sel.enterprise) + '" placeholder="如：华为 / 中芯国际 / TikTok"/>';
      } else if (m.needs === 'mineral') {
        paramHtml = '<label class="ma-dim">矿产品类（供应链研判）</label>' +
          '<select class="ma-select" id="ma-agent-param" style="width:100%;margin-top:4px">' +
          ['锂', '钴', '铜', '稀土', '镍', '铝土矿', '铁矿', '铀矿', '金矿'].map(function (x) {
            return '<option value="' + x + '"' + (x === self._sel.mineral ? ' selected' : '') + '>' + x + '</option>';
          }).join('') + '</select>';
      }
      var last = this._agent[m.key];
      host.innerHTML =
        '<div class="ma-tt"><span class="ma-dot"></span>' + m.icon + ' ' + m.agentName + '<small>' + m.name + '</small></div>' +
        '<div style="padding:6px 12px 10px">' +
          paramHtml +
          '<button class="ma-btn" id="ma-agent-run" style="width:100%;margin-top:10px"' + (this._busy ? ' disabled' : '') + '>' + (this._busy ? '⟳ 研判中…' : '▶ 开始研判') + '</button>' +
          '<div class="ma-dim" style="margin-top:6px">研判链路：Kimi 主 → 星火备 → 规则化模板降级</div>' +
        '</div>' +
        '<div id="ma-agent-result">' + (last ? this._agentHtml(last) :
          '<div class="ma-empty" style="padding:14px">智能体待命 · 点击「开始研判」生成' + m.agentName + '报告</div>') + '</div>';
      var btn = document.getElementById('ma-agent-run');
      if (btn) btn.addEventListener('click', function () { self._runAgent(m); });
    },

    _runAgent: function (m) {
      var self = this;
      if (this._busy) return;
      var paramEl = document.getElementById('ma-agent-param');
      var param = paramEl ? paramEl.value : '';
      var body = {};
      if (m.needs === 'org') { body.org = param; this._sel.org = param; }
      else if (m.needs === 'country') {
        if (m.key === 'geo') { body.country = param; this._sel.geoCountry = param; }
        else { body.country = param; this._sel.country = param; }
      }
      else if (m.needs === 'text') { body.text = param; this._sel.text = param; }
      else if (m.needs === 'enterprise') { body.enterprise = param; this._sel.enterprise = param; }
      else if (m.needs === 'mineral') { body.mineral = param; this._sel.mineral = param; }
      this._busy = true;
      this._renderAgentPanel();
      var res = document.getElementById('ma-agent-result');
      if (res) res.innerHTML = '<div class="ma-empty ma-pulse">⟳ ' + esc(m.agentName) + '装配数据并研判中（LLM 外呼约 10-30s）…</div>';
      fetchJSON('/api/models/agent/' + m.agent, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (d) {
        self._busy = false;
        if (!d.ok) { self._agent[m.key] = { error: d.error || '研判失败' }; }
        else if (d.agent && d.agent.error) { self._agent[m.key] = { error: d.agent.error }; }
        else {
          self._agent[m.key] = {
            name: d.agent.name, sections: d.agent.sections || [], model: d.agent.model,
            source: d.agent.source, lastErr: d.agent.lastErr || '', elapsed: d.agent.elapsed || '',
            evidenceIds: d.evidenceIds || []
          };
        }
        self._renderAgentPanel();
      }).catch(function (e) {
        self._busy = false;
        self._agent[m.key] = { error: e.message };
        self._renderAgentPanel();
      });
    },

    _agentHtml: function (r) {
      var self = this;
      if (r.error) return '<div class="ma-empty">🚫 ' + esc(r.error) + '</div>';
      var srcChip = r.source === 'llm'
        ? '<span class="ma-chip" style="background:rgba(0,255,159,0.12);color:#00ff9f">LLM · ' + esc(r.model) + '</span>'
        : '<span class="ma-chip" style="background:rgba(255,136,0,0.12);color:#ff8800">' + esc(r.model || '规则化降级') + '</span>';
      var html =
        '<div style="padding:4px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          srcChip +
          '<span class="ma-dim">' + esc(r.elapsed || '') + '</span>' +
          '<span class="ma-btn ghost" id="ma-agent-copy" style="padding:3px 10px;font-size:10px">复制</span>' +
          '<span class="ma-btn ghost" id="ma-agent-export" style="padding:3px 10px;font-size:10px">导出</span>' +
        '</div>' +
        (r.lastErr ? '<div class="ma-dim" style="padding:0 12px 4px">降级原因：' + esc(r.lastErr) + '</div>' : '') +
        '<div id="ma-agent-secs">' +
        r.sections.map(function (s) {
          return '<div class="ma-sec"><h5>▍' + esc(s.title) + '</h5><p>' + esc(s.body) + '</p></div>';
        }).join('') + '</div>' +
        '<div style="padding:8px 12px 4px;font-size:11px;color:#9fe8ff;font-weight:700">🔗 证据链（' + (r.evidenceIds || []).length + ' 条支撑事件，点击展开）</div>' +
        '<div id="ma-agent-evi" style="max-height:190px;overflow-y:auto;padding-bottom:8px" class="ma-scroll">' +
          (r.evidenceIds || []).slice(0, 12).map(function (id, i) {
            return '<div class="ma-evi" data-evid="' + esc(id) + '">[' + (i + 1) + '] 事件 #' + esc(id) + ' <span style="color:var(--text3)">点击加载详情 →</span></div>';
          }).join('') +
        '</div>';
      setTimeout(function () {
        var cp = document.getElementById('ma-agent-copy');
        if (cp) cp.addEventListener('click', function () {
          var txt = r.sections.map(function (s) { return '【' + s.title + '】\n' + s.body; }).join('\n\n');
          (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
            cp.textContent = '已复制';
          }).catch(function () { cp.textContent = '复制失败'; });
        });
        var ex = document.getElementById('ma-agent-export');
        if (ex) ex.addEventListener('click', function () {
          var txt = r.name + ' 研判报告（' + (r.model || '') + '）\n\n' + r.sections.map(function (s) { return '【' + s.title + '】\n' + s.body; }).join('\n\n') + '\n\n证据事件ID：' + (r.evidenceIds || []).join(', ');
          var blob = new Blob(['﻿' + txt], { type: 'text/plain;charset=utf-8' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'ORPS_' + r.name + '_研判_' + new Date().toISOString().slice(0, 10) + '.txt';
          a.click();
          URL.revokeObjectURL(a.href);
        });
        self._bindEvidence();
      }, 0);
      return html;
    },

    /* ================= 证据链：事件详情弹窗 ================= */
    _bindEvidence: function () {
      var self = this;
      document.querySelectorAll('.ma-evi[data-evid]').forEach(function (el) {
        if (el._maBound) return;
        el._maBound = true;
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-evid');
          if (id) self._showEvent(id, el);
        });
      });
    },

    _showEvent: function (id, el) {
      var self = this;
      fetchJSON('/api/models/event/' + encodeURIComponent(id)).then(function (d) {
        if (!d.ok) { if (el) el.innerHTML += ' <span style="color:#ff3355">（' + esc(d.error) + '）</span>'; return; }
        var e = d.event;
        var mask = document.createElement('div');
        mask.className = 'ma-modal-mask';
        mask.innerHTML =
          '<div class="ma-modal ma-scroll">' +
            '<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">' +
              '<div style="flex:1;font-size:14px;font-weight:700;color:#9fe8ff;line-height:1.5">' + esc(e.title) + '</div>' +
              '<span class="ma-btn ghost" id="ma-modal-x" style="padding:3px 10px;flex:none">✕</span></div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
              '<span class="ma-tag">' + esc(e.country) + (e.city ? ' · ' + esc(e.city) : '') + '</span>' +
              '<span class="ma-tag">' + esc(e.time) + '</span>' +
              '<span class="ma-tag">severity: ' + esc(e.severity || '—') + '</span>' +
              '<span class="ma-tag">' + esc(e.type) + '</span>' +
              (e.china ? '<span class="ma-tag" style="background:rgba(255,51,85,0.12);border-color:rgba(255,51,85,0.4);color:#ff8899">涉华</span>' : '') +
              (e.orgTags || []).map(function (t) { return '<span class="ma-tag" style="background:rgba(255,136,0,0.1);color:#ffbb66">' + esc(t) + '</span>'; }).join('') +
            '</div>' +
            '<div style="font-size:12px;color:var(--text);line-height:1.7;background:rgba(0,212,255,0.03);border-radius:6px;padding:10px 12px;max-height:300px;overflow-y:auto" class="ma-scroll">' +
              esc(e.content || '（正文为空）') + '</div>' +
            '<div style="display:flex;gap:10px;margin-top:10px;align-items:center">' +
              (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener" class="ma-btn" style="text-decoration:none;padding:5px 14px;font-size:11px">🔗 原文链接</a>' : '<span class="ma-dim">无原文链接</span>') +
              '<span class="ma-dim">信源：' + esc(e.source || '—') + ' · ID: ' + esc(e.id) + '</span>' +
            '</div>' +
          '</div>';
        document.body.appendChild(mask);
        mask.querySelector('#ma-modal-x').addEventListener('click', function () { mask.remove(); });
        mask.addEventListener('click', function (ev) { if (ev.target === mask) mask.remove(); });
      }).catch(function (err) { console.warn('事件详情加载失败', err); });
    }
  };

  window.MODELS_ANALYSIS = MA;
})();
