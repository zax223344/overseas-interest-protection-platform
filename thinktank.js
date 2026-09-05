/* ============================================================
 * thinktank.js — 智库报告库（前端主逻辑）v1
 * 2026-09-04
 *
 * · 复合化布局：统计条（馆藏/分类/月增/下载）+ 密级分布 + 六分类速览
 *   + 五维检索（关键词/分类/密级/维度/国别）+ 报告卡片网格 + 分页
 * · 保密设计：密级四级（公开/内部/秘密/机密），秘密/机密仅管理员可见；
 *   上传/删除仅管理员；下载走服务端密级校验+审计；PDF 服务端 AES-256-GCM
 *   加密落盘（server/thinktank.js + ttvault/）
 * · 上传：FileReader → base64 JSON（≤20MB，PDF 魔数服务端校验，sha256 去重）
 * ============================================================ */
(function () {
  'use strict';

  var CATEGORIES = [
    { key: '战略研究', ic: '🎯', desc: '宏观战略与顶层研判' },
    { key: '区域国别', ic: '🌐', desc: '重点区域与国别专题' },
    { key: '专题分析', ic: '🔍', desc: '单一议题深度剖析' },
    { key: '风险评估', ic: '⚠️', desc: '风险量化与等级评定' },
    { key: '政策法规', ic: '📜', desc: '东道国政策与法规追踪' },
    { key: '合规制裁', ic: '🚫', desc: '制裁合规与出口管制' }
  ];
  var CLASS_META = {
    '公开': { color: '#2bd67b', bg: 'rgba(43,214,123,.12)' },
    '内部': { color: '#00d4ff', bg: 'rgba(0,212,255,.12)' },
    '秘密': { color: '#ffb020', bg: 'rgba(255,176,32,.14)' },
    '机密': { color: '#ff3355', bg: 'rgba(255,51,85,.14)' }
  };
  var DIMENSIONS = ['经济基础', '人员机构', '安全事件', '东道国风险', '海上走廊', '合规制裁'];

  var S = {
    inited: false, loading: false,
    stats: null, list: [], total: 0, page: 1, PAGE: 12,
    q: '', cat: '', cls: '', dim: '', country: '',
    isAdmin: false,
    up: null            /* 上传弹窗暂存 {file, buf} */
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) {
    n = +n || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function toast(m) { if (typeof showToast === 'function') showToast(m); }

  /* ================= CSS 注入 ================= */
  function injectCSS() {
    if ($('tt-css')) return;
    var st = document.createElement('style');
    st.id = 'tt-css';
    st.textContent = [
      '.tt-wrap{padding:16px;display:flex;flex-direction:column;gap:14px;height:100%;overflow-y:auto;box-sizing:border-box}',
      '.tt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
      '.tt-stat{background:linear-gradient(135deg,rgba(0,212,255,.08),rgba(16,22,38,.9));border:1px solid rgba(0,212,255,.22);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
      '.tt-stat .v{font-size:26px;font-weight:800;color:#9fe6ff;font-family:Consolas,monospace;line-height:1.1}',
      '.tt-stat .l{font-size:11px;color:var(--text2);margin-top:4px;letter-spacing:1px}',
      '.tt-stat .ic{position:absolute;right:10px;top:10px;font-size:20px;opacity:.5}',
      '.tt-mid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.tt-panel{background:rgba(16,22,38,.85);border:1px solid rgba(0,212,255,.16);border-radius:10px;padding:12px 14px}',
      '.tt-panel h4{margin:0 0 10px;font-size:12px;color:var(--cyan);letter-spacing:2px;font-weight:700}',
      '.tt-cls-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:11px}',
      '.tt-cls-row .nm{width:34px;color:var(--text2)}',
      '.tt-cls-row .bar{flex:1;height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden}',
      '.tt-cls-row .fill{height:100%;border-radius:4px}',
      '.tt-cls-row .n{width:30px;text-align:right;color:var(--text2);font-family:Consolas,monospace}',
      '.tt-cats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.tt-cat{border:1px solid rgba(0,212,255,.18);border-radius:8px;padding:8px 10px;cursor:pointer;transition:.15s;background:rgba(10,21,37,.5)}',
      '.tt-cat:hover{border-color:rgba(0,212,255,.45);background:rgba(0,212,255,.08)}',
      '.tt-cat.on{border-color:var(--cyan);background:rgba(0,212,255,.14);box-shadow:0 0 10px rgba(0,212,255,.15)}',
      '.tt-cat .t{font-size:12px;font-weight:700;color:var(--text)}',
      '.tt-cat .d{font-size:10px;color:var(--text3);margin-top:2px}',
      '.tt-cat .n{font-size:10px;color:var(--cyan);font-family:Consolas,monospace;margin-top:3px}',
      '.tt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:rgba(16,22,38,.85);border:1px solid rgba(0,212,255,.16);border-radius:10px;padding:10px 12px}',
      '.tt-bar input,.tt-bar select{background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;padding:6px 10px;outline:none}',
      '.tt-bar input:focus,.tt-bar select:focus{border-color:var(--cyan)}',
      '.tt-bar input.kw{flex:1;min-width:160px}',
      '.tt-btn{background:linear-gradient(135deg,var(--cyan),var(--cyan-d));border:none;border-radius:6px;color:#000;font-weight:700;font-size:12px;padding:7px 14px;cursor:pointer;letter-spacing:1px}',
      '.tt-btn:hover{box-shadow:0 0 14px rgba(0,212,255,.35)}',
      '.tt-btn.sec{background:var(--bg2);border:1px solid var(--border2);color:var(--text2);font-weight:400}',
      '.tt-btn.sec:hover{border-color:var(--cyan);color:var(--cyan)}',
      '.tt-btn.danger{background:linear-gradient(135deg,#ff3355,#c01030);color:#fff}',
      '.tt-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.tt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}',
      '.tt-card{background:rgba(16,22,38,.9);border:1px solid rgba(0,212,255,.16);border-radius:10px;padding:13px 14px;display:flex;flex-direction:column;gap:8px;transition:.15s;position:relative}',
      '.tt-card:hover{border-color:rgba(0,212,255,.4);box-shadow:0 4px 18px rgba(0,0,0,.3)}',
      '.tt-card .hd{display:flex;align-items:flex-start;gap:8px}',
      '.tt-card .ttl{flex:1;font-size:13px;font-weight:700;color:var(--text);line-height:1.45}',
      '.tt-cls{flex-shrink:0;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;letter-spacing:1px;border:1px solid}',
      '.tt-card .meta{display:flex;flex-wrap:wrap;gap:5px 12px;font-size:10px;color:var(--text3)}',
      '.tt-card .meta b{color:var(--text2);font-weight:400}',
      '.tt-card .sum{font-size:11px;color:var(--text2);line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.tt-card .tags{display:flex;flex-wrap:wrap;gap:4px}',
      '.tt-tag{font-size:10px;padding:1px 7px;border-radius:3px;background:rgba(0,212,255,.1);color:var(--cyan)}',
      '.tt-tag.dim{background:rgba(179,102,255,.12);color:#c99aff}',
      '.tt-card .ft{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:8px;border-top:1px dashed rgba(255,255,255,.08)}',
      '.tt-card .ft .sz{font-size:10px;color:var(--text3);font-family:Consolas,monospace;margin-right:auto}',
      '.tt-mini-btn{font-size:11px;padding:4px 10px;border-radius:5px;cursor:pointer;border:1px solid rgba(0,212,255,.3);background:rgba(0,212,255,.08);color:var(--cyan)}',
      '.tt-mini-btn:hover{background:rgba(0,212,255,.18)}',
      '.tt-mini-btn.del{border-color:rgba(255,51,85,.35);background:rgba(255,51,85,.08);color:#ff8095}',
      '.tt-mini-btn.del:hover{background:rgba(255,51,85,.18)}',
      '.tt-empty{padding:48px;text-align:center;color:var(--text3);font-size:13px;border:1px dashed rgba(0,212,255,.2);border-radius:10px}',
      '.tt-pager{display:flex;justify-content:center;align-items:center;gap:12px;font-size:12px;color:var(--text2)}',
      '.tt-pager button{background:var(--bg2);border:1px solid var(--border);color:var(--text2);border-radius:5px;padding:4px 12px;cursor:pointer}',
      '.tt-pager button:disabled{opacity:.4;cursor:not-allowed}',
      /* 上传弹窗 */
      '.tt-mask{position:fixed;inset:0;background:rgba(2,7,15,.72);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center}',
      '.tt-modal{width:640px;max-width:94vw;max-height:88vh;overflow-y:auto;background:#0d1526;border:1px solid rgba(0,212,255,.3);border-radius:12px;padding:18px 20px;box-shadow:0 12px 48px rgba(0,0,0,.6)}',
      '.tt-modal h3{margin:0 0 4px;font-size:15px;color:var(--cyan);letter-spacing:1px}',
      '.tt-modal .sub{font-size:11px;color:var(--text3);margin-bottom:14px}',
      '.tt-f{margin-bottom:10px}',
      '.tt-f label{display:block;font-size:11px;color:var(--text2);margin-bottom:4px}',
      '.tt-f label .req{color:var(--red)}',
      '.tt-f input,.tt-f select,.tt-f textarea{width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;padding:7px 10px;outline:none;font-family:inherit}',
      '.tt-f input:focus,.tt-f select:focus,.tt-f textarea:focus{border-color:var(--cyan)}',
      '.tt-f textarea{resize:vertical;min-height:64px}',
      '.tt-2col{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.tt-dims{display:flex;flex-wrap:wrap;gap:6px}',
      '.tt-dim{padding:3px 10px;border-radius:12px;border:1px solid var(--border2);font-size:11px;color:var(--text2);cursor:pointer;user-select:none}',
      '.tt-dim.on{border-color:var(--purple);color:#c99aff;background:rgba(179,102,255,.12)}',
      '.tt-file{border:1px dashed rgba(0,212,255,.35);border-radius:8px;padding:14px;text-align:center;font-size:12px;color:var(--text2);cursor:pointer;transition:.15s}',
      '.tt-file:hover{border-color:var(--cyan);background:rgba(0,212,255,.05)}',
      '.tt-file.ok{border-color:#2bd67b;color:#7de3ae}',
      '.tt-mft{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}',
      '.tt-notice{font-size:10px;color:var(--text3);background:rgba(255,176,32,.06);border:1px solid rgba(255,176,32,.2);border-radius:6px;padding:7px 10px;margin-top:10px;line-height:1.6}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ================= 数据 ================= */
  function loadStats() {
    return APIClient._fetch('GET', '/api/thinktank/stats').then(function (d) {
      S.stats = d; renderStats(); renderMid();
    }).catch(function (e) { console.warn('[TT] stats', e); });
  }
  function loadList() {
    if (S.loading) return Promise.resolve();
    S.loading = true; renderGrid();
    var qs = '?page=' + S.page + '&pageSize=' + S.PAGE
      + '&q=' + encodeURIComponent(S.q)
      + '&category=' + encodeURIComponent(S.cat)
      + '&classification=' + encodeURIComponent(S.cls)
      + '&dimension=' + encodeURIComponent(S.dim)
      + '&country=' + encodeURIComponent(S.country);
    return APIClient._fetch('GET', '/api/thinktank/list' + qs).then(function (d) {
      S.loading = false;
      S.list = d.rows || []; S.total = d.total || 0;
      S.isAdmin = !!d.isAdmin;
      renderBar(); renderGrid(); renderPager();
    }).catch(function (e) {
      S.loading = false;
      toast('⚠️ 智库报告库加载失败：' + e.message);
      renderGrid();
    });
  }

  /* ================= 渲染 ================= */
  function render() {
    var root = $('thinktank-root');
    if (!root) return;
    root.innerHTML =
      '<div class="tt-wrap">' +
      '  <div class="tt-stats" id="tt-stats"></div>' +
      '  <div class="tt-mid">' +
      '    <div class="tt-panel"><h4>密级分布 · CLASSIFICATION</h4><div id="tt-cls-dist"></div></div>' +
      '    <div class="tt-panel"><h4>馆藏分类 · 点击直达筛选</h4><div class="tt-cats" id="tt-cats"></div></div>' +
      '  </div>' +
      '  <div class="tt-bar" id="tt-bar"></div>' +
      '  <div class="tt-grid" id="tt-grid"></div>' +
      '  <div class="tt-pager" id="tt-pager"></div>' +
      '</div>';
    renderStats(); renderMid(); renderBar(); renderGrid(); renderPager();
  }

  function renderStats() {
    var el = $('tt-stats'); if (!el) return;
    var b = (S.stats && S.stats.base) || { total: 0, categories: 0, month_new: 0, downloads: 0 };
    el.innerHTML =
      _stat('📚', b.total, '馆藏总量（份）') +
      _stat('🗂️', b.categories, '分类覆盖（/ 6）') +
      _stat('🆕', b.month_new, '本月新增') +
      _stat('⬇️', b.downloads, '累计下载');
  }
  function _stat(ic, v, l) {
    return '<div class="tt-stat"><div class="ic">' + ic + '</div><div class="v">' + (v == null ? 0 : v) + '</div><div class="l">' + l + '</div></div>';
  }

  function renderMid() {
    var dist = $('tt-cls-dist');
    if (dist) {
      var rows = (S.stats && S.stats.byClassification) || [];
      var order = ['机密', '秘密', '内部', '公开'];
      var map = {}; rows.forEach(function (r) { map[r.classification] = r.n; });
      var max = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.n; })));
      dist.innerHTML = order.map(function (c) {
        var m = CLASS_META[c], n = map[c] || 0;
        return '<div class="tt-cls-row"><span class="nm" style="color:' + m.color + '">' + c + '</span>' +
          '<div class="bar"><div class="fill" style="width:' + Math.round(n / max * 100) + '%;background:' + m.color + '"></div></div>' +
          '<span class="n">' + n + '</span></div>';
      }).join('');
    }
    var cats = $('tt-cats');
    if (cats) {
      var byCat = {}; ((S.stats && S.stats.byCategory) || []).forEach(function (r) { byCat[r.category] = r.n; });
      cats.innerHTML = CATEGORIES.map(function (c) {
        return '<div class="tt-cat' + (S.cat === c.key ? ' on' : '') + '" onclick="THINKTANK.pickCat(\'' + c.key + '\')">' +
          '<div class="t">' + c.ic + ' ' + c.key + '</div><div class="d">' + c.desc + '</div>' +
          '<div class="n">' + (byCat[c.key] || 0) + ' 份</div></div>';
      }).join('');
    }
  }

  function renderBar() {
    var el = $('tt-bar'); if (!el) return;
    el.innerHTML =
      '<input class="kw" id="tt-q" placeholder="🔍 检索标题 / 作者 / 摘要 / 关键词 / 出品机构…" value="' + esc(S.q) + '">' +
      '<select id="tt-f-cls"><option value="">全部密级</option>' +
      ['公开', '内部', '秘密', '机密'].map(function (c) { return '<option' + (S.cls === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
      '<select id="tt-f-dim"><option value="">全部维度</option>' +
      DIMENSIONS.map(function (d) { return '<option' + (S.dim === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select>' +
      '<input id="tt-f-country" placeholder="国别" style="width:90px" value="' + esc(S.country) + '">' +
      '<button class="tt-btn" onclick="THINKTANK.search()">检 索</button>' +
      '<button class="tt-btn sec" onclick="THINKTANK.reset()">重 置</button>' +
      (S.isAdmin ? '<button class="tt-btn" style="margin-left:auto" onclick="THINKTANK.openUpload()">⬆ 上传报告</button>' : '');
    var q = $('tt-q');
    if (q) q.addEventListener('keydown', function (e) { if (e.key === 'Enter') THINKTANK.search(); });
  }

  function renderGrid() {
    var el = $('tt-grid'); if (!el) return;
    if (S.loading) { el.innerHTML = '<div class="tt-empty">⏳ 馆藏检索中…</div>'; return; }
    if (!S.list.length) {
      el.innerHTML = '<div class="tt-empty">📭 馆藏暂无匹配报告' + (S.isAdmin ? '，点击右上角「上传报告」收录首份智库成果' : '') + '</div>';
      return;
    }
    el.innerHTML = S.list.map(function (r) {
      var cm = CLASS_META[r.classification] || CLASS_META['内部'];
      var kws = String(r.keywords || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 4);
      var dims = String(r.dimensions || '').split(/[,，]/).filter(Boolean);
      return '<div class="tt-card">' +
        '<div class="hd"><div class="ttl">' + esc(r.title) + '</div>' +
        '<span class="tt-cls" style="color:' + cm.color + ';border-color:' + cm.color + ';background:' + cm.bg + '">' + esc(r.classification) + '</span></div>' +
        '<div class="meta">' +
        (r.source_org ? '<span>🏛️ <b>' + esc(r.source_org) + '</b></span>' : '') +
        (r.authors ? '<span>✍️ <b>' + esc(r.authors) + '</b></span>' : '') +
        (r.report_date ? '<span>📅 <b>' + esc(r.report_date) + '</b></span>' : '') +
        (r.countries ? '<span>🌐 <b>' + esc(r.countries) + '</b></span>' : '') +
        '<span>⬇️ <b>' + (r.downloads || 0) + '</b></span>' +
        '</div>' +
        (r.summary ? '<div class="sum">' + esc(r.summary) + '</div>' : '') +
        '<div class="tags"><span class="tt-tag">' + esc(r.category) + '</span>' +
        dims.map(function (d) { return '<span class="tt-tag dim">' + esc(d) + '</span>'; }).join('') +
        kws.map(function (k) { return '<span class="tt-tag">' + esc(k) + '</span>'; }).join('') + '</div>' +
        '<div class="ft"><span class="sz">PDF · ' + fmtSize(r.file_size) + ' · #' + r.id + '</span>' +
        '<button class="tt-mini-btn" onclick="THINKTANK.download(' + r.id + ',\'' + esc(r.file_name).replace(/'/g, "\\'") + '\')">⬇ 下载</button>' +
        (S.isAdmin ? '<button class="tt-mini-btn del" onclick="THINKTANK.del(' + r.id + ',\'' + esc(r.title).replace(/'/g, "\\'").slice(0, 30) + '\')">🗑 删除</button>' : '') +
        '</div></div>';
    }).join('');
  }

  function renderPager() {
    var el = $('tt-pager'); if (!el) return;
    var pages = Math.max(1, Math.ceil(S.total / S.PAGE));
    if (pages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<button ' + (S.page <= 1 ? 'disabled' : '') + ' onclick="THINKTANK.goPage(' + (S.page - 1) + ')">‹ 上一页</button>' +
      '<span>第 ' + S.page + ' / ' + pages + ' 页 · 共 ' + S.total + ' 份</span>' +
      '<button ' + (S.page >= pages ? 'disabled' : '') + ' onclick="THINKTANK.goPage(' + (S.page + 1) + ')">下一页 ›</button>';
  }

  /* ================= 上传弹窗 ================= */
  function openUpload() {
    if ($('tt-mask')) return;
    S.up = { file: null, buf: null, dims: [] };
    var div = document.createElement('div');
    div.className = 'tt-mask'; div.id = 'tt-mask';
    div.innerHTML =
      '<div class="tt-modal">' +
      '<h3>⬆ 上传智库报告</h3>' +
      '<div class="sub">PDF 格式 · ≤ 20MB · 服务端 AES-256-GCM 加密落盘 · 全程审计</div>' +
      '<div class="tt-f"><label>报告标题 <span class="req">*</span></label><input id="tt-up-title" maxlength="120" placeholder="例：××地区中资项目安全风险评估（2026）"></div>' +
      '<div class="tt-2col">' +
      '<div class="tt-f"><label>分类</label><select id="tt-up-cat">' + CATEGORIES.map(function (c) { return '<option>' + c.key + '</option>'; }).join('') + '</select></div>' +
      '<div class="tt-f"><label>密级</label><select id="tt-up-cls"><option>公开</option><option selected>内部</option><option>秘密</option><option>机密</option></select></div>' +
      '</div>' +
      '<div class="tt-2col">' +
      '<div class="tt-f"><label>出品机构</label><input id="tt-up-org" maxlength="120" placeholder="例：××研究院"></div>' +
      '<div class="tt-f"><label>作者</label><input id="tt-up-authors" maxlength="120" placeholder="多人用顿号分隔"></div>' +
      '</div>' +
      '<div class="tt-2col">' +
      '<div class="tt-f"><label>报告日期</label><input id="tt-up-date" type="date"></div>' +
      '<div class="tt-f"><label>涉及国别</label><input id="tt-up-countries" maxlength="300" placeholder="例：巴基斯坦、哈萨克斯坦"></div>' +
      '</div>' +
      '<div class="tt-f"><label>关联维度（多选）</label><div class="tt-dims" id="tt-up-dims">' +
      DIMENSIONS.map(function (d) { return '<span class="tt-dim" data-d="' + d + '">' + d + '</span>'; }).join('') + '</div></div>' +
      '<div class="tt-f"><label>关键词</label><input id="tt-up-kw" maxlength="300" placeholder="逗号分隔，例：瓜达尔港, 安保, 俾路支"></div>' +
      '<div class="tt-f"><label>摘要</label><textarea id="tt-up-sum" maxlength="2000" placeholder="200 字以内核心观点摘录（可选）"></textarea></div>' +
      '<div class="tt-f"><label>PDF 文件 <span class="req">*</span></label>' +
      '<div class="tt-file" id="tt-up-file">📄 点击选择 PDF 文件（≤ 20MB）</div>' +
      '<input type="file" id="tt-up-file-in" accept="application/pdf,.pdf" style="display:none"></div>' +
      '<div class="tt-notice">🔐 保密提示：上传内容按所选密级控制可见范围——「秘密 / 机密」仅管理员可见可下载；「公开 / 内部」全体登录用户可见。文件在服务端以 AES-256-GCM 加密存储，任何下载行为均记录审计日志（操作人 + IP + 时间）。</div>' +
      '<div class="tt-mft"><button class="tt-btn sec" onclick="THINKTANK.closeUpload()">取 消</button>' +
      '<button class="tt-btn" id="tt-up-go" onclick="THINKTANK.doUpload()">确认上传</button></div>' +
      '</div>';
    div.addEventListener('click', function (e) { if (e.target === div) THINKTANK.closeUpload(); });
    document.body.appendChild(div);
    /* 维度多选 */
    $('tt-up-dims').addEventListener('click', function (e) {
      var t = e.target; if (!t.classList.contains('tt-dim')) return;
      t.classList.toggle('on');
      var d = t.getAttribute('data-d');
      var i = S.up.dims.indexOf(d);
      if (i >= 0) S.up.dims.splice(i, 1); else S.up.dims.push(d);
    });
    /* 文件选择 */
    var drop = $('tt-up-file'), fin = $('tt-up-file-in');
    drop.addEventListener('click', function () { fin.click(); });
    fin.addEventListener('change', function () {
      var f = fin.files && fin.files[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { toast('⚠️ 文件超过 20MB 上限'); fin.value = ''; return; }
      S.up.file = f;
      var rd = new FileReader();
      rd.onload = function () {
        var b64 = String(rd.result || '');
        S.up.buf = b64.slice(b64.indexOf(',') + 1);
        drop.classList.add('ok');
        drop.textContent = '✅ ' + f.name + '（' + fmtSize(f.size) + '）';
      };
      rd.readAsDataURL(f);
    });
  }
  function closeUpload() { var m = $('tt-mask'); if (m) m.remove(); S.up = null; }

  function doUpload() {
    var title = ($('tt-up-title').value || '').trim();
    if (!title) { toast('⚠️ 请填写报告标题'); return; }
    if (!S.up || !S.up.buf) { toast('⚠️ 请选择 PDF 文件'); return; }
    var btn = $('tt-up-go'); btn.disabled = true; btn.textContent = '加密上传中…';
    APIClient._fetch('POST', '/api/thinktank/upload', {
      title: title,
      category: $('tt-up-cat').value,
      classification: $('tt-up-cls').value,
      source_org: $('tt-up-org').value.trim(),
      authors: $('tt-up-authors').value.trim(),
      report_date: $('tt-up-date').value,
      countries: $('tt-up-countries').value.trim(),
      dimensions: S.up.dims.join(','),
      keywords: $('tt-up-kw').value.trim(),
      summary: $('tt-up-sum').value.trim(),
      file_name: S.up.file.name,
      file_data: S.up.buf
    }).then(function (d) {
      toast('✅ 报告已加密入馆（#' + d.id + '）');
      closeUpload();
      loadStats(); loadList();
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '确认上传';
      toast('⚠️ 上传失败：' + e.message);
    });
  }

  /* ================= 下载 / 删除 ================= */
  function download(id, name) {
    toast('⏳ 解密传输中…');
    fetch((APIClient._baseUrl || '') + '/api/thinktank/download/' + id, {
      headers: { 'Authorization': 'Bearer ' + (APIClient.getToken() || '') }
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || ('HTTP ' + r.status)); });
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name || ('report-' + id + '.pdf');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('✅ 下载完成');
      loadStats();
    }).catch(function (e) { toast('⚠️ 下载失败：' + e.message); });
  }

  function del(id, title) {
    if (!confirm('确认删除馆藏报告《' + title + '》？\n（软删除 + 加密文件物理销毁 + 审计留痕）')) return;
    APIClient._fetch('DELETE', '/api/thinktank/delete/' + id).then(function () {
      toast('✅ 已删除');
      loadStats(); loadList();
    }).catch(function (e) { toast('⚠️ 删除失败：' + e.message); });
  }

  /* ================= 对外接口 ================= */
  window.THINKTANK = {
    init: function () {
      injectCSS();
      render();
      S.isAdmin = (typeof AUTH !== 'undefined' && AUTH.user && AUTH.user.role === 'admin');
      loadStats(); loadList();
      S.inited = true;
    },
    pickCat: function (c) { S.cat = (S.cat === c ? '' : c); S.page = 1; renderMid(); loadList(); },
    search: function () {
      S.q = ($('tt-q').value || '').trim();
      S.cls = $('tt-f-cls').value;
      S.dim = $('tt-f-dim').value;
      S.country = ($('tt-f-country').value || '').trim();
      S.page = 1; loadList();
    },
    reset: function () {
      S.q = S.cls = S.dim = S.country = S.cat = ''; S.page = 1;
      renderBar(); renderMid(); loadList();
    },
    goPage: function (p) { S.page = p; loadList(); },
    openUpload: openUpload,
    closeUpload: closeUpload,
    doUpload: doUpload,
    download: download,
    del: del
  };
})();
