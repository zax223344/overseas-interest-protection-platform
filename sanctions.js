/* ============================================================
 * sanctions.js — #745 P1-4 制裁/管制名单碰撞筛查
 * ================================================================
 * 数据源（server/sanctions-watch.js）：
 *   GET /api/sanctions/stats             名单统计 + 上次更新
 *   GET /api/sanctions/scan?target=X     X=enterprises 撞中资 35 企 + 64 国项目
 *                                        X=events      撞 intel_data 标题/描述
 *                                        X=suppliers   撞 intel_data suppliers
 *   GET /api/sanctions/search?q=X        自由文本搜索
 *   POST /api/sanctions/refresh          手动触发重拉
 *
 * 视图：KPI 顶栏（实体数/严重度/来源分布/最后更新）
 *       三模式切换器（撞企业 / 撞事件 / 自由搜索）
 *       命中列表（按严重度 + 命中分数排序）
 *       命中行：左=被撞对象（中资企业/项目/事件）右=制裁实体（致命/高/中 徽章 + 来源 dataset + program + aliases 折叠）
 * 注册：index.html 容器 view-sanctions + script；app.js VIEW_MAP + init 分支。
 * ============================================================ */
var SANCTIONS = (function () {
  'use strict';
  var _stats = null, _inited = false, _loading = false, _mode = 'enterprises', _q = '', _scanData = null;

  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _fetch(url, ms) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 20000) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function _post(url, ms) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 30000) : null;
    return fetch(url, { method: 'POST', signal: ctrl ? ctrl.signal : undefined, headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ---------- 样式 ---------- */
  function _css() {
    if (document.getElementById('sanctions-style')) return;
    var st = document.createElement('style'); st.id = 'sanctions-style';
    st.textContent = [
      '.sa-root{padding:14px 16px;color:var(--text);min-height:100%}',
      '.sa-head{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}',
      '.sa-head .t{font-size:16px;font-weight:800;color:var(--cyan);letter-spacing:1px}',
      '.sa-head .sub{font-size:11px;color:var(--text2)}',
      '.sa-head .rf{margin-left:auto;font-size:10px;padding:4px 10px;border:1px solid var(--border);border-radius:4px;background:var(--panel2);cursor:pointer;color:var(--text2)}',
      '.sa-head .rf:hover{background:rgba(0,212,255,.08);color:var(--cyan)}',
      '.sa-kpis{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
      '.sa-kpi{border:1px solid var(--border);border-radius:8px;padding:6px 12px;background:var(--panel2);min-width:96px}',
      '.sa-kpi .v{font-size:17px;font-weight:800;font-family:Consolas,monospace}',
      '.sa-kpi .l{font-size:9px;color:var(--text3);letter-spacing:1px;margin-top:1px}',
      '.sa-modes{display:flex;gap:6px;margin-bottom:10px;align-items:center;flex-wrap:wrap}',
      '.sa-mb{padding:5px 12px;border:1px solid var(--border);border-radius:14px;background:var(--panel2);cursor:pointer;font-size:10.5px;color:var(--text2);transition:.12s}',
      '.sa-mb.on{background:rgba(0,212,255,.12);border-color:var(--cyan);color:var(--cyan);font-weight:800}',
      '.sa-mb:hover{background:rgba(0,212,255,.06)}',
      '.sa-qbox{margin-left:auto;display:flex;gap:4px;align-items:center}',
      '.sa-qbox input{background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:11px;width:200px;outline:none}',
      '.sa-qbox input:focus{border-color:var(--cyan)}',
      '.sa-qbox button{padding:4px 10px;border:1px solid var(--border);border-radius:4px;background:var(--panel2);color:var(--text2);cursor:pointer;font-size:10.5px}',
      '.sa-grid{border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:hidden}',
      '.sa-gh{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel2)}',
      '.sa-gh .t{font-size:12px;font-weight:800}',
      '.sa-gh .n{font-size:9px;color:var(--text3);margin-left:auto;font-family:Consolas,monospace}',
      '.sa-list{max-height:calc(100vh - 320px);overflow-y:auto;padding:6px}',
      '.sa-list::-webkit-scrollbar{width:5px}.sa-list::-webkit-scrollbar-thumb{background:rgba(0,212,255,.25);border-radius:3px}',
      '.sa-hit{border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;background:rgba(0,212,255,.02);transition:.12s}',
      '.sa-hit:hover{background:rgba(0,212,255,.05)}',
      '.sa-hit.fatal{border-color:rgba(255,51,85,.5);background:rgba(255,51,85,.05)}',
      '.sa-hit.high{border-color:rgba(255,170,51,.4);background:rgba(255,170,51,.04)}',
      '.sa-hit.medium{border-color:rgba(0,212,255,.3)}',
      '.sa-hit-top{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}',
      '.sa-sev{flex-shrink:0;font-size:8.5px;font-weight:800;border-radius:3px;padding:1px 6px;letter-spacing:1px}',
      '.sa-sev.fatal{background:rgba(255,51,85,.14);color:#ff5577;border:1px solid rgba(255,51,85,.4)}',
      '.sa-sev.high{background:rgba(255,170,51,.14);color:#ffaa33;border:1px solid rgba(255,170,51,.4)}',
      '.sa-sev.medium{background:rgba(0,212,255,.12);color:var(--cyan);border:1px solid rgba(0,212,255,.3)}',
      '.sa-q{flex-shrink:0;font-size:9.5px;font-weight:800;color:#c084fc;font-family:Consolas,monospace;background:rgba(192,132,252,.08);border:1px solid rgba(192,132,252,.25);border-radius:3px;padding:1px 5px}',
      '.sa-arr{color:var(--text3);font-size:10px}',
      '.sa-en{font-size:12px;font-weight:800;color:#ffd7de;line-height:1.4;flex:1}',
      '.sa-hit-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px;margin-top:4px;font-size:9.5px;color:#8fa8c0;font-family:Consolas,monospace;line-height:1.6}',
      '.sa-hit-meta .lbl{color:var(--text3);font-size:8.5px;letter-spacing:1px;margin-right:3px}',
      '.sa-aliases{font-size:9.5px;color:#a8c0d8;margin-top:4px;line-height:1.6;font-style:italic}',
      '.sa-empty{padding:36px 16px;text-align:center;font-size:11.5px;color:var(--text3);line-height:2}',
      '.sa-note{font-size:9px;color:var(--text3);margin-top:8px;line-height:1.7;padding:0 4px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- KPI 渲染 ---------- */
  function _kpis() {
    var s = _stats || {};
    var sev = s.severity || {};
    var ds = (s.datasets || []).slice(0, 4);
    var dsText = ds.map(function (d) { return d.name.replace(/^US /, '').slice(0, 18) + '·' + d.count; }).join(' · ');
    var last = s.lastUpdated ? new Date(s.lastUpdated).toLocaleString('zh-CN', { hour12: false }) : '—';
    return '<div class="sa-kpis">' +
      '<div class="sa-kpi"><div class="v" style="color:var(--cyan)">' + (s.entities || 0) + '</div><div class="l">实体总数（12源）</div></div>' +
      '<div class="sa-kpi"><div class="v" style="color:#ff5577">' + (sev.fatal || 0) + '</div><div class="l">致命级（SDN）</div></div>' +
      '<div class="sa-kpi"><div class="v" style="color:#ffaa33">' + (sev.high || 0) + '</div><div class="l">高危（EL/DPL）</div></div>' +
      '<div class="sa-kpi"><div class="v" style="color:#c084fc">' + (s.error ? '异常' : '已就绪') + '</div><div class="l">' + last + '</div></div>' +
      '</div>' +
      '<div class="sa-note">数据源：' + _esc(dsText || '加载中') + ' · 命中越严格越好，本系统采用「精确等值 + 停用词过滤 + 频率上界」三道闸，去除常见词噪声</div>';
  }

  /* ---------- 命中行 ---------- */
  function _hitRow(h, idx) {
    var e = h.entity || {};
    var sev = e.severity || 'medium';
    var mode = (h.hit && h.hit.mode) || '—';
    var score = (h.hit && h.hit.score) || 0;
    var left = '';
    if (h.ref) {
      if (h.ref.type === 'enterprise') left = '🏢 ' + _esc(h.ref.label || '');
      else if (h.ref.type === 'project') left = '📍 ' + _esc(h.ref.label || '') + ' · ' + _esc(h.ref.country || '') + ' · ' + _esc(h.ref.enterprise || '');
      else if (h.ref.type === 'supplier') left = '🛒 供应商 [事件 ' + _esc(h.ref.id) + ']';
      else if (h.ref.type === 'event') left = '📰 事件 #' + _esc(h.ref.id) + ' · ' + _esc(h.ref.label || '').slice(0, 40);
    }
    var aliases = (e.aliases || []).slice(0, 3).map(_esc).join(' · ');
    return '<div class="sa-hit ' + sev + '">' +
      '<div class="sa-hit-top">' +
      '<span class="sa-sev ' + sev + '">' + sev.toUpperCase() + '</span>' +
      '<span class="sa-q">' + _esc(h.query) + '</span>' +
      '<span class="sa-arr">→</span>' +
      '<span class="sa-en">' + _esc(e.name || '') + '</span>' +
      '</div>' +
      '<div class="sa-hit-meta">' +
      '<span><span class="lbl">命中方式</span>' + _esc(mode) + ' · ' + score + ' 分</span>' +
      '<span><span class="lbl">国别</span>' + (e.countries || []).slice(0, 5).map(_esc).join(' ') + '</span>' +
      '<span><span class="lbl">清单</span>' + _esc((e.dataset || '').replace(/;US /g, ' · ')) + '</span>' +
      '<span><span class="lbl">项目</span>' + _esc((e.program || '').replace(/;/g, ' · ')) + '</span>' +
      '</div>' +
      (left ? '<div class="sa-hit-meta"><span><span class="lbl">被撞对象</span>' + left + '</span></div>' : '') +
      (aliases ? '<div class="sa-aliases">别名：' + aliases + '</div>' : '') +
      '</div>';
  }

  function _render() {
    var root = document.getElementById('sanctions-root');
    if (!root) return;
    var s = _stats;
    if (!s || s.error && !s.entities) { root.innerHTML = '<div class="sa-empty">制裁名单服务不可达：' + _esc(s && s.error || '未启动') + '</div>'; return; }
    var hits = (_scanData && _scanData.hits) || [];
    var modeLabel = { enterprises: '撞中资企业/项目', events: '撞 intel_data 事件', suppliers: '撞 intel_data 供应商', search: '自由搜索「' + (_q || '') + '」' }[_mode] || _mode;
    var h = '<div class="sa-root">';
    h += '<div class="sa-head"><span class="t">🛡️ 制裁名单碰撞筛查</span><span class="sub">OpenSanctions us_sanctions 合并源 · 12 美国制裁源（OFAC SDN / BIS EL/DPL / CSL / DoD 等） · 撞中资底数 + 库内事件 + 自由搜索</span><button class="rf" id="sa-rf">手动重拉</button></div>';
    h += _kpis();
    h += '<div class="sa-modes">';
    h += '<div class="sa-mb' + (_mode === 'enterprises' ? ' on' : '') + '" data-mode="enterprises">撞中资企业/项目</div>';
    h += '<div class="sa-mb' + (_mode === 'events' ? ' on' : '') + '" data-mode="events">撞库内事件</div>';
    h += '<div class="sa-mb' + (_mode === 'suppliers' ? ' on' : '') + '" data-mode="suppliers">撞库内供应商</div>';
    h += '<div class="sa-qbox"><input id="sa-q" placeholder="自由搜索实体名（中英）…" value="' + _esc(_q) + '"/><button id="sa-qg">搜索</button></div>';
    h += '</div>';
    h += '<div class="sa-grid"><div class="sa-gh"><span class="t">🔍 命中列表（' + _esc(modeLabel) + '）</span><span class="n">' + hits.length + ' 条 · ' + ((_scanData && _scanData.tookMs) || 0) + 'ms</span></div><div class="sa-list">';
    if (!hits.length) h += '<div class="sa-empty">' + (_loading ? '扫描中…' : '当前模式下无命中 · 可尝试切换模式或自由搜索') + '</div>';
    else h += hits.map(_hitRow).join('');
    h += '</div></div>';
    h += '<div class="sa-note">注：「撞中资企业/项目」对中文注册表名 vs 英文制裁名单（精确/反向+停用词），常见 0 命中（中文企业名与英文 sanctions name 不字面对应）；「撞库内事件/供应商」从 intel_data 标题/描述中抽取英文 token 反查制裁名单，命中即提示「该事件中提及某制裁实体」。</div>';
    h += '</div>';
    root.innerHTML = h;
  }

  /* ---------- 加载 ---------- */
  function _loadStats() {
    return _fetch('/api/sanctions/stats', 10000).then(function (d) { _stats = d; }).catch(function (e) { _stats = { error: e.message }; });
  }
  function _loadScan() {
    if (_loading) return;
    _loading = true; _render();
    var url;
    if (_mode === 'search') url = '/api/sanctions/search?q=' + encodeURIComponent(_q) + '&limit=200';
    else url = '/api/sanctions/scan?target=' + _mode;
    _fetch(url, 30000)
      .then(function (d) {
        if (_mode === 'search') _scanData = { hits: (d.results || []).map(function (r) { return { query: _q, hit: { mode: r.hitMode, score: r.score }, entity: { id: r.id, name: r.name, aliases: r.aliases, countries: r.countries, dataset: r.dataset, program: r.program, severity: r.severity }, ref: null }; }), tookMs: 0 };
        else _scanData = d;
      })
      .catch(function (e) { _scanData = { hits: [], error: e.message, tookMs: 0 }; })
      .finally(function () { _loading = false; _render(); });
  }
  function _loadAll() { return Promise.all([_loadStats(), _loadScan()]).then(function () { _render(); }); }

  function _bind() {
    var root = document.getElementById('sanctions-root');
    if (!root || root.__saBind) return;
    root.__saBind = true;
    root.addEventListener('click', function (e) {
      var mb = e.target.closest ? e.target.closest('.sa-mb') : null;
      if (mb) { _mode = mb.getAttribute('data-mode'); _loadScan(); return; }
      if (e.target.id === 'sa-qg') { _q = (document.getElementById('sa-q') || {}).value || ''; if (_q.length >= 2) { _mode = 'search'; _loadScan(); } return; }
      if (e.target.id === 'sa-rf') { _post('/api/sanctions/refresh', 60000).then(function (r) { _loadAll(); if (window.toast) window.toast(r.ok ? '名单已刷新（' + r.count + ' 实体）' : '刷新失败：' + r.error); }); return; }
    });
    root.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'sa-q' && e.key === 'Enter') { _q = e.target.value || ''; if (_q.length >= 2) { _mode = 'search'; _loadScan(); } }
    });
  }

  function init() {
    if (_inited) { _loadAll(); return; }
    _inited = true;
    _css(); _bind();
    var r = document.getElementById('sanctions-root');
    if (r) r.innerHTML = '<div class="sa-empty">正在加载制裁名单服务（OpenSanctions 12 源合一 · ~12MB）…</div>';
    _loadAll();
  }

  function refresh() { _loadAll(); }
  return { init: init, refresh: refresh };
})();
