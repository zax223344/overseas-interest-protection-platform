/* ============================================================
 * impact-chain.js — #746 P0-3 事件→资产影响传导研判
 * ================================================================
 * 数据源（server/intel-insight.js）：
 *   GET /api/insight/impact-chain        近 72h 红级事件 × 中资项目匹配列表（45s 缓存）
 *   GET /api/insight/impact-chain/ai?id=  单事件 AI 三段式（传导路径/影响量级/建议动作，
 *                                         Kimi 150s 硬超时回落规则模板，10min 缓存）
 * 交互：左列红级事件列表（点击选中）→ 右列事件详情 + 暴露项目表 + AI 研判面板（自动拉取）。
 * 注册：index.html 容器 view-impact + script；app.js VIEW_MAP + init 分支。
 * ============================================================ */
var IMPACTCHAIN = (function () {
  'use strict';
  var _list = null, _inited = false, _loading = false;
  var _selId = null;                 /* 当前选中事件 id */
  var _aiMap = {};                   /* id → AI 研判结果（内存缓存） */
  var _aiBusy = {};                  /* id → true 拉取中 */

  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _fetch(url, ms) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 20000) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ---------- 样式 ---------- */
  function _css() {
    if (document.getElementById('impact-style')) return;
    var st = document.createElement('style'); st.id = 'impact-style';
    st.textContent = [
      '.ic-root{padding:14px 16px;color:var(--text);min-height:100%}',
      '.ic-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}',
      '.ic-head .t{font-size:16px;font-weight:800;color:var(--cyan);letter-spacing:1px}',
      '.ic-head .sub{font-size:11px;color:var(--text2)}',
      '.ic-kpis{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
      '.ic-kpi{border:1px solid var(--border);border-radius:8px;padding:6px 12px;background:var(--panel2);min-width:96px}',
      '.ic-kpi .v{font-size:17px;font-weight:800;font-family:Consolas,monospace}',
      '.ic-kpi .l{font-size:9px;color:var(--text3);letter-spacing:1px;margin-top:1px}',
      '.ic-grid{display:grid;grid-template-columns:minmax(330px,4fr) minmax(430px,8fr);gap:10px;align-items:start}',
      '.ic-col{border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:hidden}',
      '.ic-ch{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel2)}',
      '.ic-ch .t{font-size:12px;font-weight:800}',
      '.ic-ch .n{font-size:9px;color:var(--text3);margin-left:auto;font-family:Consolas,monospace}',
      '.ic-cb{max-height:calc(100vh - 300px);overflow-y:auto;padding:8px}',
      '.ic-cb::-webkit-scrollbar{width:5px}.ic-cb::-webkit-scrollbar-thumb{background:rgba(0,212,255,.25);border-radius:3px}',
      '.ic-ev{display:flex;gap:7px;align-items:baseline;padding:6px 6px;border:1px solid transparent;border-bottom:1px dotted rgba(0,212,255,.08);cursor:pointer;border-radius:6px;transition:.12s}',
      '.ic-ev:hover{background:rgba(0,212,255,.05)}',
      '.ic-ev.on{background:rgba(255,51,85,.08);border-color:rgba(255,51,85,.4)}',
      '.ic-ev:last-child{border-bottom:none}',
      '.ic-ev .tm{flex-shrink:0;font-size:8.5px;color:var(--text3);font-family:Consolas,monospace;width:78px}',
      '.ic-ev .lv{flex-shrink:0;font-size:8px;font-weight:800;border-radius:3px;padding:0 5px;letter-spacing:1px;background:rgba(255,51,85,.14);color:#ff5577;border:1px solid rgba(255,51,85,.4)}',
      '.ic-ev .ct{flex-shrink:0;font-size:9px;color:var(--cyan);font-weight:700;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ic-ev .cn{flex-shrink:0;font-size:8px;font-weight:800;color:#ffaa33}',
      '.ic-ev .tt{font-size:10px;color:#c3d9ec;line-height:1.5;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ic-ev .pn{flex-shrink:0;font-size:8.5px;font-weight:800;color:#ff5577;font-family:Consolas,monospace;background:rgba(255,51,85,.1);border:1px solid rgba(255,51,85,.3);border-radius:8px;padding:0 6px}',
      /* 事件详情头 */
      '.ic-dh{padding:9px 12px;border-bottom:1px solid var(--border);background:rgba(255,51,85,.04)}',
      '.ic-dh .tt{font-size:12.5px;font-weight:800;color:#ffd7de;line-height:1.6}',
      '.ic-dh .meta{font-size:9px;color:#7aa5c9;margin-top:4px;font-family:Consolas,monospace;display:flex;gap:10px;flex-wrap:wrap}',
      '.ic-dh .meta a{color:var(--cyan);text-decoration:none}',
      /* AI 三段式面板 */
      '.ic-ai{margin:8px;border:1px solid rgba(124,58,237,.35);border-radius:8px;overflow:hidden;background:rgba(124,58,237,.05)}',
      '.ic-ai .hd{display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(124,58,237,.12);border-bottom:1px solid rgba(124,58,237,.25)}',
      '.ic-ai .hd .t{font-size:11.5px;font-weight:800;color:#c084fc;letter-spacing:1px}',
      '.ic-ai .hd .bd{font-size:8.5px;font-weight:800;border-radius:4px;padding:1px 6px;letter-spacing:1px}',
      '.ic-ai .bd.llm{background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.35)}',
      '.ic-ai .bd.rule{background:rgba(255,136,0,.1);color:#ffaa33;border:1px solid rgba(255,136,0,.35)}',
      '.ic-ai .sec{padding:8px 10px;border-bottom:1px dashed rgba(124,58,237,.18)}',
      '.ic-ai .sec:last-child{border-bottom:none}',
      '.ic-ai .sec .st{font-size:9.5px;font-weight:800;color:#c084fc;letter-spacing:2px;margin-bottom:3px}',
      '.ic-ai .sec .sv{font-size:10.5px;color:#d5c9f0;line-height:1.8;white-space:pre-wrap}',
      '.ic-ai .nt{font-size:8.5px;color:var(--text3);padding:5px 10px;line-height:1.6;border-top:1px dotted rgba(124,58,237,.15)}',
      '.ic-ai .ld{padding:20px 12px;text-align:center;font-size:10.5px;color:#c084fc;line-height:2}',
      /* 项目表 */
      '.ic-pt{margin:8px 8px 8px}',
      '.ic-pt table{width:100%;border-collapse:collapse;font-size:9.5px}',
      '.ic-pt th{font-size:8.5px;color:var(--text3);letter-spacing:1px;text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);font-weight:700;background:var(--panel2)}',
      '.ic-pt td{padding:4px 6px;border-bottom:1px dotted rgba(0,212,255,.08);color:#c3d9ec;vertical-align:top;line-height:1.6}',
      '.ic-pt tr:hover td{background:rgba(0,212,255,.04)}',
      '.ic-pt .nm{font-weight:800;color:#e9f6ff}',
      '.ic-pt .rs{color:#8fa8c0;font-size:8.5px}',
      '.ic-pt .src{font-size:8px;color:var(--text3);border:1px solid var(--border);border-radius:3px;padding:0 4px}',
      '.ic-empty{padding:26px 12px;text-align:center;font-size:11px;color:var(--text3);line-height:2}',
      '.ic-note{font-size:9px;color:var(--text3);margin-top:8px;line-height:1.7;padding:0 2px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- 渲染 ---------- */
  function _evRow(e) {
    return '<div class="ic-ev' + (_selId === e.id ? ' on' : '') + '" data-id="' + e.id + '" title="' + _esc(e.title) + '">' +
      '<span class="tm">' + _esc(e.time) + '</span>' +
      '<span class="lv">红</span>' +
      '<span class="ct">' + _esc(e.country) + '</span>' +
      (e.china ? '<span class="cn">涉华</span>' : '') +
      '<span class="tt">' + _esc(e.typeCn) + ' · ' + _esc(e.title) + '</span>' +
      (e.projCount ? '<span class="pn" title="暴露半径内中资项目">×' + e.projCount + '</span>' : '') +
      '</div>';
  }

  function _projRow(p) {
    return '<tr>' +
      '<td><span class="nm">' + _esc(p.name) + '</span>' + (p.location ? '<br><span class="rs">' + _esc(p.location) + '</span>' : '') + '</td>' +
      '<td>' + _esc(p.enterprise) + '</td>' +
      '<td>' + _esc(p.sector) + '</td>' +
      '<td style="font-family:Consolas,monospace">' + _esc(p.invTxt || '—') + (p.personnel ? '<br>' + p.personnel + ' 人' : '') + '</td>' +
      '<td><span class="rs">' + (p.reasons || []).map(_esc).join('<br>') + '</span></td>' +
      '<td><span class="src" title="' + (p.src === 'db' ? 'enterprise_projects 在册' : '35 企注册表档案') + '">' + (p.src === 'db' ? '在册' : '档案') + '</span></td>' +
      '</tr>';
  }

  function _aiPanel(id) {
    if (_aiBusy[id]) return '<div class="ic-ai"><div class="hd"><span class="t">🧠 AI 影响传导研判（三段式）</span></div><div class="ld">Kimi 参谋级研判生成中……<br>（真实大模型推理约需 1-2 分钟，可稍后回来查看）</div></div>';
    var d = _aiMap[id];
    if (!d) return '';
    var tag = d.llmOk ? '<span class="bd llm">Kimi 参谋级</span>' : '<span class="bd rule">规则模板</span>';
    return '<div class="ic-ai">' +
      '<div class="hd"><span class="t">🧠 AI 影响传导研判（三段式）</span>' + tag + '<span style="margin-left:auto;font-size:8.5px;color:var(--text3);font-family:Consolas,monospace">' + _esc(d.generatedAt || '') + '</span></div>' +
      '<div class="sec"><div class="st">① 传导路径</div><div class="sv">' + _esc(d.path) + '</div></div>' +
      '<div class="sec"><div class="st">② 影响量级</div><div class="sv">' + _esc(d.magnitude) + '</div></div>' +
      '<div class="sec"><div class="st">③ 建议动作（对接处置闭环）</div><div class="sv">' + _esc(d.actions) + '</div></div>' +
      '<div class="nt">' + _esc(d.note || '') + '</div>' +
      '</div>';
  }

  function _detail(list) {
    /* 选中事件：优先 _selId（有效），否则首个有项目的事件，再否则首条 */
    var ev = null;
    if (_selId != null) ev = list.filter(function (e) { return String(e.id) === String(_selId); })[0];
    if (!ev) ev = list.filter(function (e) { return e.projCount > 0; })[0] || list[0] || null;
    if (!ev) return '<div class="ic-empty">近 72 小时无红级事件<br>（影响传导研判引擎待命：红级事件入库即自动关联中资项目）</div>';
    if (_selId == null || String(_selId) !== String(ev.id)) { _selId = ev.id; }
    var ps = ev.projects || [];
    var h = '<div class="ic-dh">' +
      '<div class="tt">' + (ev.china ? '<span style="color:#ffaa33;font-size:9px;border:1px solid rgba(255,170,51,.4);border-radius:3px;padding:0 5px;vertical-align:2px">涉华</span> ' : '') +
      '<span style="color:#ff5577;font-size:9px;border:1px solid rgba(255,51,85,.4);border-radius:3px;padding:0 5px;vertical-align:2px">红级</span> ' + _esc(ev.title) + '</div>' +
      '<div class="meta"><span>' + _esc(ev.country) + '</span><span>' + _esc(ev.typeCn) + '</span><span>' + _esc(ev.time) + '</span><span>源 ' + _esc(ev.source) + '</span>' +
      '<span>关联项目 ' + ev.projCount + ' · 企业 ' + ev.enterprises + ' 家 · 投资 ' + ev.investment + ' 亿美元 · 人员 ' + ev.personnel + ' 人</span>' +
      (ev.url ? '<a href="' + _esc(ev.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') + '</div></div>';
    h += _aiPanel(ev.id);
    if (!ps.length) h += '<div class="ic-empty" style="padding:14px">该事件国别无在册/档案中资项目（第三方国别事件，作态势背景参考）</div>';
    else {
      h += '<div class="ic-pt"><table><thead><tr><th>项目</th><th>企业</th><th>行业</th><th>投资/人员</th><th>匹配依据（三维）</th><th>来源</th></tr></thead><tbody>' + ps.map(_projRow).join('') + '</tbody></table></div>';
    }
    return h;
  }

  function _render() {
    var root = document.getElementById('impact-root');
    if (!root) return;
    var d = _list;
    if (!d || !d.ok) { root.innerHTML = '<div class="ic-empty">影响传导研判服务不可达</div>'; return; }
    var s = d.stats || {}, evs = d.events || [];
    var h = '<div class="ic-root">';
    h += '<div class="ic-head"><span class="t">🔗 影响传导研判</span><span class="sub">红级事件 → 中资资产传导 · AI 三段式（传导路径 / 影响量级 / 建议动作）· 快照 ' + _esc(d.generatedAt || '') + '</span></div>';
    h += '<div class="ic-kpis">' +
      '<div class="ic-kpi"><div class="v" style="color:#ff5577">' + (s.redEvents || 0) + '</div><div class="l">72H 红色事件</div></div>' +
      '<div class="ic-kpi"><div class="v" style="color:var(--cyan)">' + (s.eventsWithProjects || 0) + '</div><div class="l">涉中资资产事件</div></div>' +
      '<div class="ic-kpi"><div class="v" style="color:#ffcc00">' + (s.exposedProjects || 0) + '</div><div class="l">暴露项目</div></div>' +
      '<div class="ic-kpi"><div class="v" style="color:#c084fc">' + (s.enterprises || 0) + '</div><div class="l">涉及企业</div></div>' +
      '</div>';
    h += '<div class="ic-grid">';
    h += '<div class="ic-col"><div class="ic-ch"><span class="t">🚨 红级事件队列（72H）</span><span class="n">' + evs.length + ' 条</span></div><div class="ic-cb">' +
      (evs.length ? evs.map(_evRow).join('') : '<div class="ic-empty">近 72 小时无红级事件<br>（常态监测运行中）</div>') + '</div></div>';
    h += '<div class="ic-col"><div class="ic-ch"><span class="t">🎯 事件 → 资产传导研判</span><span class="n">点击左列事件切换</span></div><div class="ic-cb">' + _detail(evs) + '</div></div>';
    h += '</div>';
    h += '<div class="ic-note">' + _esc(d.note || '') + '</div>';
    h += '</div>';
    root.innerHTML = h;
  }

  function _loadAi(id) {
    if (_aiMap[id] || _aiBusy[id]) return;
    _aiBusy[id] = true;
    _render();                    /* 立即渲染加载态面板 */
    _fetch('/api/insight/impact-chain/ai?id=' + encodeURIComponent(id), 170000)
      .then(function (d) { _aiMap[id] = d.ok ? d : { llmOk: false, path: '（研判暂不可用：' + (d.error || '服务异常') + '）', magnitude: '', actions: '', note: '' }; })
      .catch(function (e) { _aiMap[id] = { llmOk: false, path: '（研判拉取失败：' + e.message + '，可切换事件后重试）', magnitude: '', actions: '', note: '' }; })
      .finally(function () { delete _aiBusy[id]; _render(); });
  }

  function _load(silent) {
    if (_loading) return;
    _loading = true;
    _fetch('/api/insight/impact-chain', 25000)
      .then(function (d) {
        _list = d; _render();
        /* 默认选中事件自动拉 AI（_render 内 _detail 已写入 _selId） */
        if (_selId != null) _loadAi(_selId);
      })
      .catch(function (e) {
        if (!silent) { var r = document.getElementById('impact-root'); if (r) r.innerHTML = '<div class="ic-empty">服务不可达：' + _esc(e.message) + '</div>'; }
      })
      .finally(function () { _loading = false; });
  }

  /* ---------- 交互（事件委托：点事件=选中并拉 AI；AI 面板重试） ---------- */
  function _bind() {
    var root = document.getElementById('impact-root');
    if (!root || root.__icBind) return;
    root.__icBind = true;
    root.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.ic-ev') : null;
      if (row) {
        var id = row.getAttribute('data-id');
        if (id != null && String(id) !== String(_selId)) { _selId = id; _render(); _loadAi(id); }
      }
    });
  }

  function init() {
    if (_inited) { _load(true); return; }
    _inited = true;
    _css(); _bind();
    var r = document.getElementById('impact-root');
    if (r && !_list) r.innerHTML = '<div class="ic-empty">正在加载红级事件 × 中资资产关联（72 小时窗口）……</div>';
    _load(false);
  }

  function refresh() { _load(false); }

  return { init: init, refresh: refresh };
})();
