/* ===== enterprise-risk.js — 涉企风险预警研判 · 企业安全风险指挥台（2026-09-08 #702 v3）=====
 * 用户原话（2026-09-08 04:19）：「跟事件研判中心太接近了……要有功能区有差异……发挥你的
 *   想象力，要多利用AI大模型……既然是涉企风险预警研判，所有风险预警都要包含」
 *   「数据要摘录最核心最重点的，不能是国内的，跟中国海外利益安全相关」
 *
 * v3 差异化（#702 ①：与事件研判中心彻底拉开——事件中心=单事件案卷；本区=企业资产实体维度）：
 *   ① AI 大盘研判横幅：打开即自动装配《全球涉企安全风险研判》（Kimi 大模型，
 *      参谋级五段式，真实统计+72h 红橙装配，30min 服务端缓存）——先给结论，再给数据
 *   ② KPI 带：在险企业 / 在险项目 / 72h 红橙预警 / 七域风险事件 / 最高风险企业
 *   ③ 🏢 企业风险矩阵（本区王牌·独有）：35 企资产 × 布局国风险 join → AI 风险评分环
 *      （暴露广度/烈度/域覆盖/活跃度/加速度 五构成可解释），点击企业卡 → 就地展开
 *      该企业参谋级 AI 深度研判（分国证据 + 涉险项目 + 30 天预测 + 步骤化建议）
 *   ④ 🚨 72h 红橙预警流 + 🛡 七域雷达 + 国别压力榜（下钻单国研判）+ 逐月趋势
 *   ⑤ 🔮 未来30天前瞻（AI 前瞻，30min 缓存）
 * 数据口径：仅涉华海外利益相关（国别≠中国，境内事件零收录），零模拟、零臆测。
 * 数据源：GET /api/entrisk/overview | /assets | /asset-judge | /briefing | /country-judge | /forecast。
 * 四步注册：index.html 侧边栏 data-view → view-entrisk 容器 → app.js VIEW_MAP + runViewInit → role-ui.js。 */
'use strict';
var ENTRISK = (function () {
  var _inited = false, _ov = null, _abort = null, _brAbort = null, _fcAbort = null, _asAbort = null;
  var _openCountry = null, _judgeCache = {}, _judgeAbort = {};
  var _brData = null, _fcData = null, _asData = null, _showAllEnts = false;
  var _openEnt = null, _entCache = {}, _entAbort = {};
  var _domFilter = null;   /* 七域过滤（null=全部） */

  function _fetch(url, ms, extCtrl) {
    var ctrl = extCtrl || new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms || 30000);
    return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(t); });
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _cq(s) { return _esc(s).replace(/'/g, "\\'"); }   /* onclick 内联转义 */
  var LV_COLOR = { red: '#ef4444', orange: '#f59e0b', yellow: '#facc15', blue: '#38bdf8' };
  var LV_CN = { red: '红级', orange: '橙级', yellow: '黄级', blue: '蓝级' };
  var DOM_ICONS = { '管控与制裁': '🛡️', '武装冲突波及': '⚔️', '恐袭与遇袭': '💥', '社会动荡与治安': '📢', '政局与政策': '🏛️', '经济与金融': '💹', '灾害与设施': '🌊' };

  /* ---------- 样式 ---------- */
  if (!document.getElementById('entrisk-style')) {
    var st = document.createElement('style');
    st.id = 'entrisk-style';
    st.textContent =
      '#view-entrisk{padding:16px;max-width:1340px;margin:0 auto}' +
      '.er-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}' +
      '.er-tt{font-size:20px;font-weight:800;color:#dff3ff;letter-spacing:1px}' +
      '.er-sub{font-size:11px;color:#7aa5c9;margin-top:3px;line-height:1.6}' +
      '.er-head .sp{flex:1}' +
      '.er-btn{background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.35);color:#22d3ee;font-size:11px;font-weight:700;border-radius:6px;padding:6px 14px;cursor:pointer;transition:.15s}' +
      '.er-btn:hover{background:rgba(0,212,255,.24)}' +
      '.er-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.er-btn.ai{background:rgba(124,58,237,.14);border-color:rgba(124,58,237,.4);color:#c4b5fd}' +
      '.er-btn.ai:hover{background:rgba(124,58,237,.28)}' +
      /* ① AI 大盘研判横幅（指挥台主视觉） */
      '.er-brief{background:linear-gradient(135deg,rgba(124,58,237,.13),rgba(0,212,255,.06));border:1px solid rgba(124,58,237,.4);border-radius:12px;padding:14px 16px;margin-bottom:12px;position:relative;overflow:hidden}' +
      '.er-brief::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#7c3aed,#22d3ee)}' +
      '.er-brief .h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:9px}' +
      '.er-brief .h .t{font-size:14px;font-weight:800;color:#e9d5ff;letter-spacing:1px}' +
      '.er-brief .h .badge{font-size:9px;border-radius:8px;padding:2px 8px;font-weight:700;background:rgba(124,58,237,.2);color:#c4b5fd;border:1px solid rgba(124,58,237,.4)}' +
      '.er-brief .h .sp{flex:1}' +
      '.er-brief .txt{font-size:12px;color:#d7e9f9;line-height:1.95;white-space:pre-wrap;word-break:break-all}' +
      '.er-brief .meta{font-size:10px;color:#7aa5c9;margin-top:8px}' +
      /* ② KPI 带 */
      '.er-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px}' +
      '@media (max-width:1000px){.er-kpis{grid-template-columns:repeat(2,1fr)}}' +
      '.er-kpi{background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.15);border-radius:8px;padding:12px 14px;text-align:center}' +
      '.er-kpi .v{font-size:24px;font-weight:800;line-height:1.15;text-shadow:0 0 12px currentColor}' +
      '.er-kpi .l{font-size:11px;color:#7aa5c9;margin-top:4px}' +
      '.er-kpi .d{font-size:10px;margin-top:2px;color:#8fa8c0}' +
      /* ③ 企业风险矩阵（v3 王牌） */
      '.er-ents{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}' +
      '@media (max-width:1100px){.er-ents{grid-template-columns:repeat(2,1fr)}}' +
      '@media (max-width:700px){.er-ents{grid-template-columns:1fr}}' +
      '.er-ent{background:var(--bg2,#132743);border:1px solid rgba(124,58,237,.22);border-radius:9px;padding:10px 12px;cursor:pointer;transition:.14s;position:relative;overflow:hidden}' +
      '.er-ent:hover{border-color:#7c3aed;background:rgba(124,58,237,.07)}' +
      '.er-ent.on{outline:1px solid rgba(124,58,237,.5);background:rgba(124,58,237,.1)}' +
      '.er-ent .r1{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
      '.er-ent .lg{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0}' +
      '.er-ent .nm{font-size:12.5px;font-weight:700;color:#dff3ff;line-height:1.3;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.er-ent .ind{font-size:9px;color:#62809e;flex-shrink:0}' +
      '.er-ent .r2{display:flex;align-items:center;gap:9px}' +
      '.er-ring{width:44px;height:44px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;position:relative;font-size:12.5px;font-weight:800}' +
      '.er-ent .facts{flex:1;min-width:0;font-size:10px;color:#8fa8c0;line-height:1.75}' +
      '.er-ent .facts b{color:#d7e9f9;font-weight:700}' +
      '.er-ent .r3{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(124,58,237,.2)}' +
      '.er-ctag{font-size:8.5px;border-radius:6px;padding:1px 6px;background:rgba(239,68,68,.08);color:#ffb3c0;border:1px solid rgba(239,68,68,.22);font-weight:700;white-space:nowrap}' +
      '.er-ptag{font-size:8.5px;border-radius:6px;padding:1px 6px;background:rgba(0,230,118,.08);color:#6ee7a0;border:1px solid rgba(0,230,118,.25);font-weight:700;white-space:nowrap}' +
      '.er-ent .act{font-size:9px;color:#c4b5fd;font-weight:700;flex-shrink:0}' +
      /* 资产研判展开盒 */
      '.er-jbox2{background:rgba(0,0,0,.24);border:1px solid rgba(124,58,237,.35);border-radius:10px;margin:6px 0 12px;padding:12px 14px;grid-column:1/-1}' +
      '.er-jhdr2{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:8px}' +
      '.er-jhdr2 .cnm{font-size:14px;font-weight:800;color:#e9d5ff}' +
      '.er-jhdr2 .st{font-size:10px;color:#7aa5c9}' +
      '.er-ring2{width:54px;height:54px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;font-weight:800;line-height:1.05}' +
      '.er-ring2 .sv{font-size:16px}' +
      '.er-ring2 .sl{font-size:7.5px;font-weight:400;letter-spacing:.5px}' +
      '.er-sparts{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 8px}' +
      '.er-spart{font-size:9px;border-radius:6px;padding:2px 7px;background:rgba(0,212,255,.08);color:#9fc3e2;border:1px solid rgba(0,212,255,.2);font-weight:700}' +
      '.er-csplit{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}' +
      '.er-csp{font-size:9.5px;border-radius:7px;padding:2px 8px;background:rgba(239,68,68,.06);color:#ffb3c0;border:1px solid rgba(239,68,68,.18);font-weight:700}' +
      '.er-aev{display:flex;gap:7px;align-items:flex-start;font-size:11px;color:#d7e9f9;padding:5px 4px;border-bottom:1px dashed rgba(0,212,255,.08);line-height:1.5}' +
      '.er-aev:last-child{border-bottom:none}' +
      '.er-aev .lv{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}' +
      '.er-aev .tm{color:#5a7a99;font-size:9.5px;white-space:nowrap;font-family:Consolas,monospace;padding-top:2px;flex-shrink:0}' +
      '.er-aev .dm{font-size:9px;color:#8fa8c0;border:1px solid rgba(143,168,192,.25);border-radius:6px;padding:0 5px;flex-shrink:0;margin-top:1px;white-space:nowrap}' +
      /* ④ 主体栅格 */
      '.er-main{display:grid;grid-template-columns:1.08fr .92fr;gap:10px}' +
      '@media (max-width:1080px){.er-main{grid-template-columns:1fr}}' +
      '.er-panel{background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.18);border-radius:10px;padding:12px 14px;margin-bottom:10px}' +
      '.er-panel.warm{border-color:rgba(239,68,68,.22)}' +
      '.er-panel.violet{border-color:rgba(124,58,237,.28)}' +
      '.er-sec{font-size:13px;font-weight:700;color:#22d3ee;margin-bottom:10px;border-left:3px solid #22d3ee;padding-left:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.er-panel.warm .er-sec{color:#ff7b93;border-left-color:#ef4444}' +
      '.er-panel.violet .er-sec{color:#c4b5fd;border-left-color:#7c3aed}' +
      '.er-sec .mut{font-size:10px;color:#5a7a99;font-weight:400}' +
      '.er-sec .sp{flex:1}' +
      '.er-note{font-size:10px;color:#5a7a99;line-height:1.7;margin-top:10px;border-top:1px dashed rgba(0,212,255,.15);padding-top:8px}' +
      '.er-empty{padding:30px 0;text-align:center;color:#5a7a99;font-size:12.5px;line-height:2}' +
      '.er-loading{padding:36px 0;text-align:center;color:#22d3ee;font-size:13px}' +
      /* ④ 七域雷达 */
      '.er-dom{display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:7px;font-size:11.5px;cursor:pointer;transition:.13s;border:1px solid transparent;margin-bottom:3px}' +
      '.er-dom:hover{background:rgba(0,212,255,.07)}' +
      '.er-dom.on{background:rgba(124,58,237,.13);border-color:rgba(124,58,237,.4)}' +
      '.er-dom .ic{width:20px;text-align:center;flex-shrink:0}' +
      '.er-dom .nm{width:104px;color:#d7e9f9;flex-shrink:0;font-weight:700}' +
      '.er-dom .bw{flex:1;height:10px;background:rgba(34,211,238,.08);border-radius:5px;overflow:hidden}' +
      '.er-dom .bw i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#0891b2,#22d3ee)}' +
      '.er-dom .nv{width:36px;text-align:right;color:#22d3ee;font-weight:800;flex-shrink:0}' +
      '.er-dom .ar{font-size:9px;color:#62809e;flex-shrink:0}' +
      /* ③ 预警卡 */
      '.er-alert{background:var(--bg2,#132743);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:8px 11px;margin-bottom:7px;cursor:pointer;transition:.14s;position:relative}' +
      '.er-alert:hover{border-color:#ef4444;background:rgba(239,68,68,.05)}' +
      '.er-alert.rd{border-left:3px solid #ef4444}' +
      '.er-alert.ro{border-left:3px solid #f59e0b}' +
      '.er-alert .tt{font-size:11.5px;color:#dff3ff;line-height:1.55;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.er-alert .mt{display:flex;gap:7px;flex-wrap:wrap;font-size:9.5px;color:#7aa5c9;margin-top:5px;align-items:center}' +
      '.er-alert .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}' +
      '.er-ltag{font-size:8.5px;border-radius:6px;padding:1px 5px;font-weight:700;flex-shrink:0}' +
      '.er-domtag{font-size:8.5px;border-radius:6px;padding:1px 5px;background:rgba(0,212,255,.1);color:#22d3ee;border:1px solid rgba(0,212,255,.25);font-weight:700;flex-shrink:0}' +
      '.er-cnflag{font-size:8.5px;border-radius:6px;padding:1px 5px;background:rgba(255,204,0,.12);color:#ffcc00;border:1px solid rgba(255,204,0,.3);font-weight:700;flex-shrink:0}' +
      /* ⑤ 国别压力榜 */
      '.er-crow{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid rgba(0,212,255,.08);cursor:pointer;border-radius:6px;transition:.13s}' +
      '.er-crow:hover{background:rgba(0,212,255,.07)}' +
      '.er-crow.on{background:rgba(124,58,237,.1);outline:1px solid rgba(124,58,237,.3)}' +
      '.er-crow .rk{width:20px;font-size:11px;font-weight:800;color:#5a7a99;text-align:center;flex-shrink:0}' +
      '.er-crow:nth-child(1) .rk,.er-crow:nth-child(2) .rk,.er-crow:nth-child(3) .rk{color:#ff3355}' +
      '.er-crow .cn{width:82px;color:#d7e9f9;font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}' +
      '.er-crow .bw{flex:1;height:11px;background:rgba(239,68,68,.08);border-radius:6px;overflow:hidden}' +
      '.er-crow .bw i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#f59e0b,#ef4444)}' +
      '.er-crow .nv{color:#ff8800;font-weight:800;width:34px;text-align:right;flex-shrink:0;font-size:12px}' +
      '.er-crow .hint{font-size:9px;color:#62809e;flex-shrink:0}' +
      /* 单国研判展开盒 */
      '.er-jbox{background:rgba(0,0,0,.24);border:1px solid rgba(124,58,237,.3);border-radius:8px;margin:6px 0 10px;padding:10px 12px}' +
      '.er-jhdr{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
      '.er-jhdr .cnm{font-size:13px;font-weight:800;color:#e9d5ff}' +
      '.er-jhdr .st{font-size:10px;color:#7aa5c9}' +
      '.er-jhdr .sp{flex:1}' +
      '.er-doms{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}' +
      '.er-dtag{font-size:9.5px;border-radius:8px;padding:2px 8px;background:rgba(0,212,255,.1);color:#22d3ee;border:1px solid rgba(0,212,255,.25);font-weight:700}' +
      '.er-jtext{font-size:11.5px;color:#d7e9f9;line-height:1.85;white-space:pre-wrap;word-break:break-all}' +
      '.er-jev{display:flex;gap:7px;align-items:flex-start;font-size:11px;color:#d7e9f9;padding:5px 4px;border-bottom:1px dashed rgba(0,212,255,.08);line-height:1.5}' +
      '.er-jev:last-child{border-bottom:none}' +
      '.er-jev .lv{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}' +
      '.er-jev .tm{color:#5a7a99;font-size:9.5px;white-space:nowrap;font-family:Consolas,monospace;padding-top:2px;flex-shrink:0}' +
      '.er-jev .dm{font-size:9px;color:#8fa8c0;border:1px solid rgba(143,168,192,.25);border-radius:6px;padding:0 5px;flex-shrink:0;margin-top:1px;white-space:nowrap}' +
      /* 逐月柱 */
      '.er-months{display:flex;align-items:flex-end;gap:4px;height:70px;padding:4px 2px 0}' +
      '.er-months .mb{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}' +
      '.er-months .mb i{width:100%;max-width:26px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#f59e0b,#7c2d12);transition:.3s}' +
      '.er-months .mb:hover i{background:linear-gradient(180deg,#fbbf24,#ef4444)}' +
      '.er-months .mb .mt{font-size:8px;color:#5a7a99;margin-top:3px;font-family:Consolas,monospace}' +
      '.er-months .mb .mv{font-size:9px;color:#ffcc00;font-weight:700;margin-bottom:2px}' +
      /* 前瞻 */
      '.er-fc{font-size:12px;color:#d7e9f9;line-height:1.9;white-space:pre-wrap;word-break:break-all}' +
      '.er-fc-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:#7aa5c9;margin-bottom:8px}' +
      '.er-fc-meta b{color:#ffcc00}';
    document.head.appendChild(st);
  }

  /* ---------- 渲染 ---------- */
  function _evCard(e) {
    return '<div class="er-alert ' + (e.level === 'red' ? 'rd' : 'ro') + '" onclick="ENTRISK.judge(\'' + _cq(e.country) + '\')">' +
      '<div class="tt">' + _esc(e.title) + '</div>' +
      '<div class="mt"><span class="dot" style="background:' + (LV_COLOR[e.level] || '#facc15') + '"></span>' +
      '<span class="er-ltag" style="color:' + (LV_COLOR[e.level] || '#facc15') + ';border:1px solid ' + (LV_COLOR[e.level] || '#facc15') + '55">' + (LV_CN[e.level] || e.level) + '</span>' +
      '<span>📍' + _esc(e.country) + '</span>' +
      (e.dim && e.dim !== e.domain ? '<span class="er-domtag">' + _esc(e.dim) + '</span>' : '<span class="er-domtag">' + (DOM_ICONS[e.domain] || '') + ' ' + _esc(e.domain || '') + '</span>') +
      '<span class="er-cnflag">涉华</span><span class="tm">🕐' + _esc(String(e.time).slice(5, 16)) + '</span>' +
      (e.url ? '<a href="' + _esc(e.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#22d3ee">原文↗</a>' : '') +
      '</div></div>';
  }

  function _render() {
    var root = document.getElementById('entrisk-root');
    if (!root) return;
    if (!_ov) { root.innerHTML = '<div class="er-loading">涉企风险数据装载中……</div>'; return; }
    var d = _ov;
    if (!d.ok) { root.innerHTML = '<div class="er-empty">接口异常：' + _esc(d.error) + '</div>'; return; }
    if (!d.kpi || !d.kpi.total) {
      root.innerHTML =
        '<div class="er-head"><div><div class="er-tt">🛡️ 涉企风险预警研判</div><div class="er-sub">全风险域 · 企业视角 · AI 研判 · 仅涉华海外利益相关</div></div></div>' +
        '<div class="er-panel"><div class="er-empty">涉企风险七域池暂无入库记录。<br>随制裁合规/安全事件采集通道与涉企专项实采持续入库，本区将自动装配。<br>（零模拟原则：无数据不生成研判）</div></div>';
      return;
    }
    var domMax = Math.max.apply(null, (d.domains || []).map(function (x) { return x.n; }).concat([1]));
    var cMax = (d.byCountry && d.byCountry.length) ? d.byCountry[0].n : 1;
    var mMax = 1; (d.byMonth || []).forEach(function (m) { if (m.n > mMax) mMax = m.n; });
    var alerts = (d.alerts72 || []).filter(function (e) { return !_domFilter || e.domain === _domFilter; });
    var latest = (d.latest || []).filter(function (e) { return !_domFilter || e.domain === _domFilter; });

    var h = '';
    h += '<div class="er-head">' +
      '<div><div class="er-tt">🛡️ 涉企风险预警研判 · 企业安全风险指挥台</div>' +
      '<div class="er-sub">七域全风险：管控与制裁 · 武装冲突波及 · 恐袭与遇袭 · 社会动荡与治安 · 政局与政策 · 经济与金融 · 灾害与设施　<span style="color:#5a7a99">仅涉华海外利益相关（境内事件零收录）· 装配 ' + _esc(d.generatedAt) + '</span></div></div>' +
      '<div class="sp"></div><button class="er-btn" onclick="ENTRISK.refresh()">↻ 刷新全景</button></div>';

    /* ① AI 大盘研判横幅 */
    h += '<div class="er-brief"><div class="h"><span class="t">🤖 AI 全球涉企安全风险研判</span>' +
      '<span class="badge">Kimi 大模型 · 真实统计装配</span><span class="sp"></span>' +
      '<button class="er-btn ai" id="er-br-btn" onclick="ENTRISK.briefing(true)">⚡ 重新研判</button></div>' +
      '<div id="er-br-body">' + (_brData ? _brHtml(_brData) : '<div class="er-loading" style="padding:18px 0">AI 大盘研判装配中（真实统计 + 72h 红橙预警上下文，约 20-40 秒）……</div>') + '</div></div>';

    /* ② KPI 带（v3：资产维度优先） */
    var ak = (_asData && _asData.ok && _asData.kpi) ? _asData.kpi : null;
    h += '<div class="er-kpis">' +
      '<div class="er-kpi"><div class="v" style="color:' + (ak && ak.atRiskEnts > 0 ? '#ff3355' : '#22d3ee') + '">' + (ak ? ak.atRiskEnts : '—') + '</div><div class="l">在险企业（35 企档案）</div><div class="d">布局国命中风险事件</div></div>' +
      '<div class="er-kpi"><div class="v" style="color:#ff8800">' + (ak ? ak.atRiskProjects : '—') + '</div><div class="l">在险海外项目</div><div class="d">所在国红橙/多发风险</div></div>' +
      '<div class="er-kpi"><div class="v" style="color:' + (d.kpi.alerts72 > 0 ? '#ef4444' : '#facc15') + '">' + d.kpi.alerts72 + '</div><div class="l">72h 红橙预警</div><div class="d">当前活跃涉企预警</div></div>' +
      '<div class="er-kpi"><div class="v" style="color:#22d3ee">' + d.kpi.total + '</div><div class="l">七域风险事件（累计）</div><div class="d">涉华海外涉企全口径</div></div>' +
      '<div class="er-kpi"><div class="v" style="color:#ef4444;font-size:18px">' + (ak ? ak.topRiskEnt : _esc(d.kpi.topPressure)) + '</div><div class="l">' + (ak ? '最高风险企业' : '最高压力国') + '</div><div class="d">AI 风险评分第一</div></div></div>';

    /* ③ 企业风险矩阵（v3 王牌：企业资产维度，事件研判中心没有的能力） */
    if (ak) {
      var ents = _asData.assets || [];
      var entShow = _showAllEnts ? ents : ents.slice(0, 12);
      h += '<div class="er-panel violet"><div class="er-sec">🏢 企业风险矩阵 <span class="mut">35 企资产 × 布局国七域风险 join · AI 风险评分（暴露广度35+烈度30+域覆盖15+活跃度15+加速度5）· 点击企业卡展开参谋级 AI 深度研判</span></div>' +
        '<div class="er-ents">';
      entShow.forEach(function (a) {
        h += '<div class="er-ent' + (_openEnt === a.short ? ' on' : '') + '" onclick="ENTRISK.entJudge(\'' + _cq(a.short) + '\')">' +
          '<div class="r1"><span class="lg" style="background:linear-gradient(135deg,#7c3aed,#2563eb)">' + _esc(a.short.slice(0, 1)) + '</span>' +
          '<span class="nm" title="' + _esc(a.name) + '">' + _esc(a.short) + '</span><span class="ind">' + _esc(a.industry) + '</span></div>' +
          '<div class="r2">' + _ring(a.score) +
          '<div class="facts">暴露国 <b>' + a.exposedCountries + '/' + a.layoutCountries + '</b> · 事件 <b>' + a.total + '</b>（红<b style="color:#ff3355">' + a.red + '</b> 橙<b style="color:#ff8800">' + a.orange + '</b>）<br>近30天 <b>+' + a.recent30 + '</b>' + (a.recent30 > a.prior30 ? ' <span style="color:#ff3355;font-weight:700">↗提速</span>' : '') + ' · 涉险项目 <b>' + a.projectsAtRisk.length + '</b></div></div>' +
          '<div class="r3">' +
          (a.topExposed || []).slice(0, 3).map(function (c) {
            return '<span class="er-ctag">' + _esc(c.country) + (c.red ? ' 红' + c.red : ' ' + c.n) + '</span>';
          }).join('') +
          (a.projectsAtRisk.length ? '<span class="er-ptag">📁 ' + _esc(a.projectsAtRisk[0].n) + (a.projectsAtRisk.length > 1 ? ' +' + (a.projectsAtRisk.length - 1) : '') + '</span>' : '') +
          '<span class="act">▾资产研判</span></div>' +
          '</div>';
        if (_openEnt === a.short) h += '<div id="er-ajbox"></div>';
      });
      h += '</div>';
      if (ents.length > 12) {
        h += '<div style="margin-top:8px;text-align:center"><button class="er-btn" onclick="ENTRISK.toggleAllEnts()">' + (_showAllEnts ? '▲ 只看 TOP12' : '▼ 展开全部 ' + ents.length + ' 家企业') + '</button></div>';
      }
      h += '</div>';
    }

    h += '<div class="er-main">';
    /* 左列：72h 红橙预警流（核心重点） + 最新事件 */
    h += '<div>' +
      '<div class="er-panel warm"><div class="er-sec">🚨 72h 涉企红橙预警 <span class="mut">当前最需关注 · 点击卡片 → 该国 AI 研判' + (_domFilter ? ' · 已过滤：' + _esc(_domFilter) : '') + '</span><span class="sp"></span>' +
      (_domFilter ? '<button class="er-btn" onclick="ENTRISK.domFilter(null)">✕ 清除域过滤</button>' : '') + '</div>' +
      (alerts.length ? alerts.slice(0, 10).map(_evCard).join('') : '<div class="er-empty" style="padding:20px 0">' + (_domFilter ? '该域近72小时无红橙预警' : '近72小时无红橙级涉企预警——风险以黄级常规监控为主') + '</div>') +
      '</div>' +
      '<div class="er-panel"><div class="er-sec">🆕 最新涉企风险事件 <span class="mut">点击卡片 → 该国 AI 研判</span></div>' +
      (latest.length ? latest.slice(0, 8).map(_evCard).join('') : '<div class="er-empty" style="padding:16px 0">暂无</div>') + '</div></div>';

    /* 右列：七域雷达 + 国别压力榜 + 逐月趋势 */
    h += '<div>' +
      '<div class="er-panel violet"><div class="er-sec">🛡 七域风险雷达 <span class="mut">全量池 · 点击域过滤预警流</span></div>';
    (d.domains || []).forEach(function (x) {
      h += '<div class="er-dom' + (_domFilter === x.cn ? ' on' : '') + '" onclick="ENTRISK.domFilter(\'' + _cq(x.cn) + '\')">' +
        '<span class="ic">' + (DOM_ICONS[x.cn] || '◆') + '</span><span class="nm">' + _esc(x.cn) + '</span>' +
        '<span class="bw"><i style="width:' + Math.max(5, Math.round(x.n / domMax * 100)) + '%"></i></span>' +
        '<span class="nv">' + x.n + '</span><span class="ar">' + (_domFilter === x.cn ? '已选' : '▾') + '</span></div>';
    });
    h += '</div>';

    h += '<div class="er-panel warm"><div class="er-sec">⚑ 国别风险压力榜 <span class="mut">近90天 · 点击国别就地展开 AI 研判</span></div>';
    (d.byCountry || []).forEach(function (c, i) {
      h += '<div class="er-crow' + (_openCountry === c.country ? ' on' : '') + '" onclick="ENTRISK.judge(\'' + _cq(c.country) + '\')">' +
        '<span class="rk">' + (i + 1) + '</span><span class="cn" title="' + _esc(c.country) + '">' + _esc(c.country) + '</span>' +
        '<span class="bw"><i style="width:' + Math.max(6, Math.round(c.n / cMax * 100)) + '%"></i></span>' +
        '<span class="nv">' + c.n + '</span><span class="hint">▾研判</span></div>';
      if (_openCountry === c.country) h += '<div id="er-jbox"></div>';
    });
    h += '<div class="er-note">' + _esc(d.note) + '</div></div>';

    if ((d.byMonth || []).length) {
      h += '<div class="er-panel"><div class="er-sec">📈 涉企风险逐月趋势 <span class="mut">近14月（悬停查看）</span></div><div class="er-months">';
      d.byMonth.forEach(function (m) {
        h += '<div class="mb" title="' + m.m + '：' + m.n + ' 条"><span class="mv">' + (m.n || '') + '</span><i style="height:' + Math.max(4, Math.round(m.n / mMax * 48)) + 'px"></i><span class="mt">' + m.m.slice(2) + '</span></div>';
      });
      h += '</div></div>';
    }
    h += '</div></div>'; /* 右列+main 完 */

    /* ⑦ 30天前瞻（整宽） */
    h += '<div class="er-panel violet"><div class="er-sec">🔭 未来30天涉企风险前瞻 <span class="mut">真实统计装配 · AI 前瞻研判（回落规则模板）</span>' +
      '<span class="sp"></span><button class="er-btn ai" id="er-fc-btn" onclick="ENTRISK.forecast(true)">⚡ ' + (_fcData ? '重新研判' : '生成前瞻研判') + '</button></div>' +
      '<div id="er-fc-body">' + (_fcData ? _fcHtml(_fcData) : '<div class="er-empty" style="padding:20px 0">尚未生成。点击右上「生成前瞻研判」——基于七域池真实统计研判未来30天态势。</div>') + '</div></div>';

    root.innerHTML = h;
    /* 展开盒重放 */
    if (_openCountry && _judgeCache[_openCountry]) _fillJbox(_judgeCache[_openCountry]);
    if (_openEnt && _entCache[_openEnt]) _fillAjbox(_entCache[_openEnt]);
  }

  /* ---------- ③ 评分环（conic-gradient，五构成可解释） ---------- */
  function _ring(score) {
    var v = Math.max(0, Math.min(100, Number(score) || 0));
    var color = v >= 70 ? '#ff3355' : v >= 45 ? '#ff8800' : v >= 25 ? '#facc15' : '#22d3ee';
    return '<span class="er-ring" style="background:conic-gradient(' + color + ' ' + Math.round(v * 3.6) + 'deg,rgba(124,58,237,.14) 0deg)">' +
      '<span style="width:34px;height:34px;border-radius:50%;background:var(--bg2,#132743);display:flex;align-items:center;justify-content:center;color:' + color + '">' + v + '</span></span>';
  }

  function toggleAllEnts() {
    _showAllEnts = !_showAllEnts;
    _render();
  }

  /* ---------- ③ 单企业资产 AI 研判（就地展开） ---------- */
  function entJudge(short) {
    if (_openEnt === short) { _openEnt = null; _render(); return; }
    _openEnt = short;
    _render();
    var box = document.getElementById('er-ajbox');
    if (!box) return;
    if (_entAbort[_openEnt]) { try { _entAbort[_openEnt].abort(); } catch (e) {} }
    var ctrl = new AbortController(); _entAbort[short] = ctrl;
    var s2 = short;
    if (_entCache[short]) { _fillAjbox(_entCache[short]); return; }
    box.innerHTML = '<div class="er-loading" style="padding:18px 0">「' + _esc(short) + '」企业资产 AI 研判装配中（企业档案 × 布局国风险 × 在险项目，参谋级五段式）……</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    _fetch('/api/entrisk/asset-judge?ent=' + encodeURIComponent(short), 120000, ctrl)
      .then(function (d) {
        if (_entAbort[s2] !== ctrl || _openEnt !== s2) return;
        _entCache[s2] = d;
        if (document.getElementById('er-ajbox')) _fillAjbox(d);
      })
      .catch(function (e) {
        if (String(e && e.name) === 'AbortError') return;
        var b = document.getElementById('er-ajbox');
        if (b && _openEnt === s2) b.innerHTML = '<div class="er-empty" style="padding:14px 0">资产研判请求失败：' + _esc(e && e.message) + '</div>';
      });
  }

  function _fillAjbox(d) {
    var box = document.getElementById('er-ajbox');
    if (!box) return;
    if (!d.ok) { box.innerHTML = '<div class="er-empty" style="padding:14px 0">接口异常：' + _esc(d.error) + '</div>'; return; }
    if (d.empty) { box.innerHTML = '<div class="er-empty" style="padding:14px 0">' + _esc(d.note) + '</div>'; return; }
    var sc = d.score || { value: 0, parts: {} };
    var v = sc.value, color = v >= 70 ? '#ff3355' : v >= 45 ? '#ff8800' : v >= 25 ? '#facc15' : '#22d3ee';
    var h = '<div class="er-jbox2">' +
      '<div class="er-jhdr2">' +
      '<span class="er-ring2" style="background:conic-gradient(' + color + ' ' + Math.round(v * 3.6) + 'deg,rgba(124,58,237,.14) 0deg)">' +
      '<span style="width:44px;height:44px;border-radius:50%;background:var(--bg2,#132743);display:flex;flex-direction:column;align-items:center;justify-content:center"><span class="sv" style="color:' + color + '">' + v + '</span><span class="sl" style="color:#8fa8c0">风险分</span></span></span>' +
      '<span class="cnm">🏢 ' + _esc(d.ent.name) + ' · 企业资产风险研判</span>' +
      '<span class="st">' + _esc(d.ent.industry) + ' · 海外人员 ' + _esc(d.ent.personnel) + ' 人 · 投资 ' + _esc(d.ent.investment) + ' 亿美元 · 布局 ' + _esc(d.ent.countries) + ' 国 · ' + (d.llmOk ? 'Kimi 大模型 · 参谋级五段式' : '规则模板（引用真实库数字）') + '</span>' +
      '<span style="flex:1"></span>' +
      (d.llmOk ? '' : '<button class="er-btn ai" onclick="ENTRISK.aiEntJudge(\'' + _cq(d.ent.short) + '\')">⚡ AI 深度研判</button>') +
      '</div>' +
      '<div class="er-sparts">' +
      '<span class="er-spart">暴露广度 ' + Math.round(sc.parts.breadth || 0) + '/35</span>' +
      '<span class="er-spart">烈度 ' + Math.round(sc.parts.severity || 0) + '/30</span>' +
      '<span class="er-spart">域覆盖 ' + Math.round(sc.parts.domains || 0) + '/15</span>' +
      '<span class="er-spart">活跃度 ' + Math.round(sc.parts.activity || 0) + '/15</span>' +
      '<span class="er-spart">加速度 ' + (sc.parts.accel || 0) + '/5</span>' +
      '</div>';
    if ((d.countries || []).length) {
      h += '<div class="er-csplit">' + d.countries.slice(0, 8).map(function (c) {
        return '<span class="er-csp">' + _esc(c.country) + ' ' + c.n + '条' + (c.red ? '（红' + c.red + '）' : '') + '</span>';
      }).join('') + '</div>';
    }
    if ((d.projectsAtRisk || []).length) {
      h += '<div class="er-csplit">' + d.projectsAtRisk.map(function (p) {
        return '<span class="er-ptag" style="font-size:9.5px;border-radius:7px;padding:2px 8px">📁 ' + _esc(p.n) + '（' + _esc(p.c) + '）</span>';
      }).join('') + '</div>';
    }
    h += '<div class="er-jtext">' + _esc(d.judgment) + '</div>';
    if ((d.events || []).length) {
      h += '<div style="margin-top:9px;border-top:1px dashed rgba(124,58,237,.25);padding-top:7px"><div style="font-size:10.5px;color:#c4b5fd;font-weight:700;margin-bottom:4px">支撑事件（布局国最新 ' + d.events.length + ' 条 · 逐条可溯源）</div>';
      d.events.forEach(function (e) {
        h += '<div class="er-aev"><span class="lv" style="background:' + (LV_COLOR[e.level] || '#facc15') + '"></span>' +
          '<span style="flex:1;min-width:0">' + _esc(e.title) + '</span>' +
          '<span class="dm">' + _esc(e.country) + '·' + _esc(e.domain) + '</span><span class="tm">' + _esc(String(e.time).slice(0, 10)) + '</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="er-note">' + _esc(d.note || '') + '</div></div>';
    box.innerHTML = h;
  }

  /* AI 升级（清缓存重取） */
  function aiEntJudge(short) {
    delete _entCache[short];
    _openEnt = null;
    entJudge(short);
  }

  function _brHtml(b) {
    if (b.empty) return '<div class="er-empty" style="padding:14px 0">' + _esc(b.note) + '</div>';
    var s = '';
    if (b.stats) s += '<div class="er-fc-meta" style="margin-bottom:6px"><span>池内 <b>' + b.stats.total + '</b> 条</span><span>覆盖 <b>' + b.stats.countries + '</b> 国</span><span>72h红橙 <b>' + b.stats.alerts72 + '</b> 条</span><span>近30天 <b>' + b.stats.fresh30 + '</b> 条</span></div>';
    s += '<div class="txt">' + _esc(b.briefing) + '</div>';
    if (b.note) s += '<div class="meta">' + _esc(b.note) + (b.generatedAt ? ' · 生成 ' + _esc(b.generatedAt) : '') + (b.llmOk ? ' · Kimi 大模型' : ' · 规则模板') + (b.cached ? ' · 30min缓存' : '') + '</div>';
    return s;
  }
  function _fcHtml(d) {
    if (d.empty) return '<div class="er-empty">库内暂无涉企风险记录——拒绝在空池上生成预测（零臆测原则）。</div>';
    var s = '';
    if (d.stats) {
      s += '<div class="er-fc-meta"><span>池内累计 <b>' + d.stats.total + '</b> 条</span><span>覆盖 <b>' + d.stats.countries + '</b> 国</span><span>近30天 <b>' + d.stats.fresh30 + '</b> 条</span><span>近12月月均 <b>' + d.stats.monthlyAvg + '</b> 条</span><span>72h红橙 <b>' + (d.stats.alerts72 || 0) + '</b> 条</span><span>生成：' + _esc(d.generatedAt) + (d.llmOk ? ' · Kimi 大模型' : ' · 规则模板') + (d.cached ? ' · 30min缓存' : '') + '</span></div>';
    }
    s += '<div class="er-fc">' + _esc(d.forecast) + '</div>';
    if (d.note) s += '<div class="er-note">' + _esc(d.note) + '</div>';
    return s;
  }

  /* ---------- ④ 七域过滤 ---------- */
  function domFilter(cn) {
    _domFilter = (_domFilter === cn) ? null : (cn || null);
    _render();
  }

  /* ---------- ⑤ 国别就地研判 ---------- */
  function judge(country) {
    if (_openCountry === country) { _openCountry = null; _render(); return; }
    _openCountry = country;
    _render();
    var box = document.getElementById('er-jbox');
    if (!box) return;
    if (_judgeAbort[_openCountry]) { try { _judgeAbort[_openCountry].abort(); } catch (e) {} }
    var ctrl = new AbortController(); _judgeAbort[country] = ctrl;
    var c2 = country;
    if (_judgeCache[country]) { _fillJbox(_judgeCache[country]); return; }
    box.innerHTML = '<div class="er-loading" style="padding:18px 0">「' + _esc(country) + '」涉企风险研判装配中……</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    _fetch('/api/entrisk/country-judge?country=' + encodeURIComponent(country), 60000, ctrl)
      .then(function (d) {
        if (_judgeAbort[c2] !== ctrl || _openCountry !== c2) return;
        _judgeCache[c2] = d;
        if (document.getElementById('er-jbox')) _fillJbox(d);
      })
      .catch(function (e) {
        if (String(e && e.name) === 'AbortError') return;
        var b = document.getElementById('er-jbox');
        if (b && _openCountry === c2) b.innerHTML = '<div class="er-empty" style="padding:14px 0">研判请求失败：' + _esc(e && e.message) + '</div>';
      });
  }

  function _fillJbox(d) {
    var box = document.getElementById('er-jbox');
    if (!box) return;
    if (!d.ok) { box.innerHTML = '<div class="er-empty" style="padding:14px 0">接口异常：' + _esc(d.error) + '</div>'; return; }
    if (d.empty) { box.innerHTML = '<div class="er-empty" style="padding:14px 0">' + _esc(d.note) + '</div>'; return; }
    var h = '<div class="er-jbox">' +
      '<div class="er-jhdr"><span class="cnm">🛡️ ' + _esc(d.country) + ' · 涉企风险研判（全风险域）</span>' +
      '<span class="st">累计 ' + d.total + ' 条 · 近90天 ' + d.recent90 + ' 条 · ' + (d.llmOk ? 'Kimi 大模型' : '规则模板（真实库数字）') + '</span>' +
      '<span class="sp"></span>' +
      (d.llmOk ? '' : '<button class="er-btn ai" onclick="ENTRISK.aiJudge(\'' + _cq(d.country) + '\')">⚡ AI 深度研判</button>') +
      '</div><div class="er-doms">';
    (d.domains || []).forEach(function (x) { h += '<span class="er-dtag">' + _esc(x.domain) + ' ' + x.n + '</span>'; });
    h += '</div><div class="er-jtext">' + _esc(d.judgment) + '</div>';
    if (d.events && d.events.length) {
      h += '<div style="margin-top:9px;border-top:1px dashed rgba(124,58,237,.25);padding-top:7px"><div style="font-size:10.5px;color:#c4b5fd;font-weight:700;margin-bottom:4px">支撑事件（最新 ' + d.events.length + ' 条 · 逐条可溯源）</div>';
      d.events.forEach(function (e) {
        h += '<div class="er-jev"><span class="lv" style="background:' + (LV_COLOR[e.level] || '#facc15') + '"></span>' +
          '<span style="flex:1;min-width:0">' + _esc(e.title) + '</span>' +
          '<span class="dm">' + _esc(e.domain) + '</span><span class="tm">' + _esc(String(e.time).slice(0, 10)) + '</span></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    box.innerHTML = h;
  }

  /* AI 升级（清缓存重取） */
  function aiJudge(country) {
    delete _judgeCache[country];
    _openCountry = null;
    judge(country);
  }

  /* ---------- ① AI 大盘研判 ---------- */
  function briefing(force) {
    var btn = document.getElementById('er-br-btn');
    var body = document.getElementById('er-br-body');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 研判中…'; }
    if (_brAbort) { try { _brAbort.abort(); } catch (e) {} }
    var ctrl = new AbortController(); _brAbort = ctrl;
    if (body) body.innerHTML = '<div class="er-loading" style="padding:18px 0">AI 大盘研判装配中（真实统计 + 72h 红橙预警上下文，约 20-40 秒）……</div>';
    _fetch('/api/entrisk/briefing' + (force ? '?refresh=1' : ''), 120000, ctrl)
      .then(function (d) {
        _brData = d;
        if (body) body.innerHTML = _brHtml(d);
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 重新研判'; }
      })
      .catch(function (e) {
        if (String(e && e.name) === 'AbortError') return;
        if (body) body.innerHTML = '<div class="er-empty" style="padding:14px 0">研判请求失败：' + _esc(e && e.message) + '</div>';
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 重新研判'; }
      });
  }

  /* ---------- ⑦ 前瞻 ---------- */
  function forecast(force) {
    var btn = document.getElementById('er-fc-btn');
    var body = document.getElementById('er-fc-body');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ AI 前瞻研判中…'; }
    if (_fcAbort) { try { _fcAbort.abort(); } catch (e) {} }
    var ctrl = new AbortController(); _fcAbort = ctrl;
    if (body) body.innerHTML = '<div class="er-loading">基于七域池真实统计装配前瞻上下文，Kimi 大模型研判中……</div>';
    _fetch('/api/entrisk/forecast' + (force ? '?refresh=1' : ''), 120000, ctrl)
      .then(function (d) {
        _fcData = d;
        if (body) body.innerHTML = _fcHtml(d);
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 重新研判'; }
      })
      .catch(function (e) {
        if (String(e && e.name) === 'AbortError') return;
        if (body) body.innerHTML = '<div class="er-empty" style="padding:16px 0">前瞻请求失败：' + _esc(e && e.message) + '</div>';
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 重新研判'; }
      });
  }

  /* ---------- 装配 ---------- */
  function refresh() {
    if (_abort) { try { _abort.abort(); } catch (e) {} }
    var ctrl = new AbortController(); _abort = ctrl;
    if (_asAbort) { try { _asAbort.abort(); } catch (e) {} }
    var aCtrl = new AbortController(); _asAbort = aCtrl;
    var root = document.getElementById('entrisk-root');
    if (root && _ov) root.innerHTML = '<div class="er-loading">涉企风险数据刷新中……</div>';
    _fetch('/api/entrisk/overview', 30000, ctrl)
      .then(function (d) { _ov = d; _render(); })
      .catch(function (e) {
        if (String(e && e.name) === 'AbortError') return;
        if (root) root.innerHTML = '<div class="er-empty">加载失败：' + _esc(e && e.message) + '　<button class="er-btn" onclick="ENTRISK.refresh()">重试</button></div>';
      });
    /* v3：企业资产矩阵并行装配 */
    _fetch('/api/entrisk/assets', 45000, aCtrl)
      .then(function (d) { if (d && d.ok) { _asData = d; _render(); } })
      .catch(function () {});
  }

  function init() {
    if (_inited && _ov) { _render(); return; }
    _inited = true;
    refresh();
    if (!_brData) briefing(false);   /* 打开即自动装配 AI 大盘研判 */
    if (!_fcData) forecast(false);   /* 前瞻自动装配（服务端 30min 缓存，命中秒回） */
  }

  return { init: init, refresh: refresh, judge: judge, aiJudge: aiJudge, domFilter: domFilter, briefing: briefing, forecast: forecast, entJudge: entJudge, aiEntJudge: aiEntJudge, toggleAllEnts: toggleAllEnts };
})();
