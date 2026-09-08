/* ===== event-insight.js — 事件研判中心 · 自主研判工作台（2026-09-07 #682 重设计 v3）=====
 * 用户原话（2026-09-07 18:43）：「事件研判中心·研判案卷工作台，这个功能不行，又是搜集引擎。
 *   我都说了，不要用搜集引擎，你自主设计，其他功能区需要拓展，复合性。」
 * v2（#669）教训：关键词输入框 + 「🔍 开始研判」按钮 = 搜集引擎观感，被否。
 * v3 设计（与全球恐袭态势监测中心同款「常开」哲学，但按研判队列组织）：
 *   打开即自动装配，零输入零触发：
 *   ① KPI 带：72h 待研判红橙 / 今日入库 / 红橙涉华 / 活跃事件链 / 队列深度
 *   ② 自主研判队列（TOP12）：72h 红橙候选 × 复合研判价值评分（级别×时近 + 涉华 + 信源印证 + 链长），
 *      国别多样性去重，点击即立卷（quick 秒出案卷）
 *   ③ 突发事件链（48h 国别×类别安全类簇）+ 7日类别分布 + 国别×类别热度矩阵（复合态势）
 *   ④ 案卷工作台（沿用 #669 案卷01-05 研判引擎）：队列首条自动立卷；
 *      规则模板秒出 → 「AI 深度研判」一键升级 Kimi 大模型版；红头公文输出
 *   ⑤ 复合联动：案卷/队列跳 国别风险研判 · 全球恐袭态势监测中心 · 智能预警中心（navigateTo 全局）
 * 手工立卷降级为次级入口（队列头小按钮，可折叠），不再作为主交互。
 * 数据源：GET /api/insight/event-docket（自主队列）| /api/insight/event-report（案卷装配，quick 模式秒出）。
 * 四步注册：index.html 侧边栏 data-view → view-evjudge 容器 → app.js VIEW_MAP + runViewInit → role-ui.js。 */
'use strict';
(function () {
  if (document.getElementById('ej-style')) return;
  var st = document.createElement('style');
  st.id = 'ej-style';
  st.textContent =
    '#view-evjudge{padding:16px;max-width:1320px;margin:0 auto}' +
    '.ej-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}' +
    '.ej-tt{font-size:20px;font-weight:800;color:#dff3ff;letter-spacing:1px}' +
    '.ej-sub{font-size:11px;color:#7aa5c9;margin-top:3px}' +
    '.ej-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px}' +
    '@media (max-width:1000px){.ej-kpis{grid-template-columns:repeat(2,1fr)}}' +
    '.ej-kpi{background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.15);border-radius:8px;padding:12px 14px;text-align:center}' +
    '.ej-kpi .v{font-size:26px;font-weight:800;line-height:1.15;text-shadow:0 0 12px currentColor}' +
    '.ej-kpi .l{font-size:11px;color:#7aa5c9;margin-top:4px}' +
    '.ej-kpi .d{font-size:10px;margin-top:2px;color:#8fa8c0}' +
    '.ej-main{display:grid;grid-template-columns:1.05fr .95fr;gap:10px}' +
    '@media (max-width:1080px){.ej-main{grid-template-columns:1fr}}' +
    '.ej-panel{background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.18);border-radius:10px;padding:12px 14px;margin-bottom:10px}' +
    '.ej-panel.warm{border-color:rgba(239,68,68,.18)}' +
    '.ej-sec{font-size:13px;font-weight:700;color:#22d3ee;margin-bottom:10px;border-left:3px solid #22d3ee;padding-left:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.ej-panel.warm .ej-sec{color:#ff7b93;border-left-color:#ef4444}' +
    '.ej-sec .mut{font-size:10px;color:#5a7a99;font-weight:400}' +
    '.ej-note{font-size:10px;color:#5a7a99;line-height:1.7;margin-top:10px;border-top:1px dashed rgba(0,212,255,.15);padding-top:8px}' +
    '.ej-empty{padding:36px 0;text-align:center;color:#5a7a99;font-size:12.5px;line-height:2}' +
    '.ej-loading{padding:40px 0;text-align:center;color:#22d3ee;font-size:13px}' +
    /* ② 研判队列卡 */
    '.ej-qcard{display:flex;gap:9px;align-items:flex-start;background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.14);border-radius:8px;padding:9px 11px;margin-bottom:8px;cursor:pointer;transition:.14s;position:relative}' +
    '.ej-qcard:hover{border-color:#22d3ee;background:rgba(34,211,238,.07)}' +
    '.ej-qcard.on{border-color:#7c3aed;box-shadow:0 0 12px rgba(124,58,237,.28);background:rgba(124,58,237,.09)}' +
    '.ej-qcard .rk{width:22px;font-size:12px;font-weight:800;color:#5a7a99;text-align:center;padding-top:3px;flex-shrink:0}' +
    '.ej-qcard:nth-child(1) .rk,.ej-qcard:nth-child(2) .rk,.ej-qcard:nth-child(3) .rk{color:#ff3355}' +
    '.ej-qcard .dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0}' +
    '.ej-qcard .bd{flex:1;min-width:0}' +
    '.ej-qcard .tt{font-size:12px;color:#dff3ff;line-height:1.55;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.ej-qcard .mt{display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:#7aa5c9;margin-top:4px;align-items:center}' +
    '.ej-tag{font-size:9px;border-radius:8px;padding:1px 6px;font-weight:700;flex-shrink:0}' +
    '.ej-tag.cn{background:rgba(255,204,0,.12);color:#ffcc00;border:1px solid rgba(255,204,0,.3)}' +
    '.ej-tag.ty{background:rgba(0,212,255,.1);color:#22d3ee;border:1px solid rgba(0,212,255,.25)}' +
    /* #686B 次级元数据行：类型/涉及国/项目档案关联 */
    '.ej-qcard .mt2{display:flex;gap:7px;flex-wrap:wrap;font-size:9.5px;color:#62809e;margin-top:4px;align-items:center;padding-top:4px;border-top:1px dashed rgba(0,212,255,.1)}' +
    '.ej-tag.pj{background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.3);cursor:pointer}' +
    '.ej-tag.pj:hover{background:rgba(0,230,118,.22)}' +
    '.ej-tag.nj{background:rgba(90,122,153,.08);color:#5a7a99;border:1px dashed rgba(90,122,153,.3)}' +
    '.ej-scorebar{height:4px;border-radius:2px;background:rgba(124,58,237,.12);margin-top:6px;overflow:hidden}' +
    '.ej-scorebar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#7c3aed,#22d3ee)}' +
    '.ej-qact{font-size:9.5px;color:#c4b5fd;font-weight:700;flex-shrink:0;padding-top:4px;white-space:nowrap}' +
    /* ③ 突发链 / 类别分布 */
    '.ej-chain{display:flex;align-items:center;gap:8px;font-size:11.5px;padding:5px 4px;border-bottom:1px solid rgba(239,68,68,.08);cursor:pointer;border-radius:6px}' +
    '.ej-chain:hover{background:rgba(239,68,68,.07)}' +
    /* #700 内联国别研判展开盒 */
    '.ej-chainwrap{border-bottom:1px solid rgba(239,68,68,.08)}' +
    '.ej-chainbox{background:rgba(0,0,0,.22);border:1px solid rgba(239,68,68,.18);border-radius:8px;margin:4px 0 8px;padding:8px 10px}' +
    '.ej-chdr{font-size:10.5px;color:#ff8fa3;font-weight:700;margin-bottom:6px}' +
    '.ej-cev{display:flex;gap:7px;align-items:flex-start;font-size:11px;color:#d7e9f9;padding:5px 4px;border-bottom:1px dashed rgba(0,212,255,.08);cursor:pointer;border-radius:5px;line-height:1.5}' +
    '.ej-cev:hover{background:rgba(124,58,237,.12)}' +
    '.ej-cev .lv2{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}' +
    '.ej-cev .tm2{color:#5a7a99;font-size:9.5px;white-space:nowrap;font-family:Consolas,monospace;padding-top:2px}' +
    '.ej-cev .tagcn2{font-size:8.5px;border-radius:6px;padding:1px 5px;background:rgba(255,204,0,.12);color:#ffcc00;border:1px solid rgba(255,204,0,.3);flex-shrink:0;margin-top:1px}' +
    '.ej-chain .cn2{width:82px;color:#d7e9f9;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}' +
    '.ej-chain .bw{flex:1;height:11px;background:rgba(239,68,68,.08);border-radius:6px;overflow:hidden}' +
    '.ej-chain .bw i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#f59e0b,#ef4444)}' +
    '.ej-chain .nv{color:#ff8800;font-weight:800;width:30px;text-align:right;flex-shrink:0}' +
    '.ej-chain .ty2{font-size:9.5px;color:#7aa5c9;width:66px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex-shrink:0}' +
    '.ej-tdist{display:flex;align-items:center;gap:8px;font-size:11px;padding:4px}' +
    '.ej-tdist .cn2{width:82px;color:#d7e9f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}' +
    '.ej-tdist .bw{flex:1;height:11px;background:rgba(0,212,255,.08);border-radius:6px;overflow:hidden}' +
    '.ej-tdist .bw i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#0e5a7a,#22d3ee)}' +
    '.ej-tdist .nv{color:#22d3ee;font-weight:800;width:44px;text-align:right;flex-shrink:0;font-family:Consolas,monospace}' +
    /* ③ 热度矩阵 */
    '.ej-mx{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}' +
    '.ej-mx th{color:#7aa5c9;font-weight:400;padding:3px 2px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
    '.ej-mx th.rw{text-align:left;padding-left:4px;color:#d7e9f9;font-weight:700}' +
    '.ej-mx td{text-align:center;padding:4px 2px;border-radius:3px;color:#dff3ff;font-family:Consolas,monospace;cursor:default}' +
    '.ej-mx td.zero{color:#3a4d66}' +
    /* ⑤ 案卷语言（沿用 #669）*/
    '.ej-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '@media (max-width:1000px){.ej-grid{grid-template-columns:1fr}}' +
    '.ej-anchor{background:var(--bg2,#132743);border:1px solid rgba(255,51,85,.3);border-radius:8px;padding:10px 12px;margin-bottom:10px}' +
    '.ej-anchor-tt{font-size:13.5px;font-weight:700;color:#ffe9ee;line-height:1.6}' +
    '.ej-anchor-meta{font-size:10.5px;color:#7aa5c9;margin-top:4px}' +
    '.ej-stages{display:flex;gap:0;margin:6px 0 12px;overflow-x:auto}' +
    '.ej-stage{flex:1;min-width:104px;text-align:center;position:relative;padding-top:14px}' +
    '.ej-stage::before{content:"";position:absolute;top:5px;left:0;right:0;height:2px;background:rgba(0,212,255,.2)}' +
    '.ej-stage:first-child::before{left:50%}.ej-stage:last-child::before{right:50%}' +
    '.ej-stage .dot2{position:absolute;top:0;left:50%;transform:translateX(-50%);width:11px;height:11px;border-radius:50%;background:#5a7a99}' +
    '.ej-stage.done .dot2{background:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,.7)}' +
    '.ej-stage .sn{font-size:11px;font-weight:700;color:#9fc3e2}' +
    '.ej-stage.done .sn{color:#22d3ee}' +
    '.ej-stage .stm{font-size:9.5px;color:#5a7a99;margin-top:2px}' +
    '.ej-bars{display:flex;align-items:flex-end;gap:2px;height:90px;padding:6px 4px 0;background:var(--bg2,#132743);border-radius:6px;margin-bottom:4px;overflow-x:auto}' +
    '.ej-bar{flex:1;min-width:10px;background:linear-gradient(180deg,#22d3ee,#0e5a7a);border-radius:2px 2px 0 0;position:relative;cursor:default}' +
    '.ej-bar:hover{background:linear-gradient(180deg,#ff5f9e,#7a0e3a)}' +
    '.ej-bar span{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:9px;color:#9fc3e2}' +
    '.ej-bar-x{display:flex;gap:2px;padding:2px 4px;font-size:9px;color:#5a7a99;overflow-x:auto}' +
    '.ej-bar-x i{flex:1;min-width:10px;text-align:center;font-style:normal;overflow:hidden;white-space:nowrap}' +
    '.ej-item{display:flex;gap:8px;font-size:11.5px;padding:6px 4px;border-bottom:1px solid rgba(0,212,255,.07);align-items:flex-start}' +
    '.ej-item .tm{color:#5a7a99;white-space:nowrap;min-width:96px;font-family:Consolas,monospace;font-size:10px;padding-top:2px}' +
    '.ej-item .lv{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}' +
    '.ej-item .tx{flex:1;color:#dff3ff;line-height:1.6;word-break:break-all}' +
    '.ej-item a{color:#22d3ee;font-size:10px;text-decoration:none;margin-left:4px}' +
    '.ej-judge p{font-size:12.5px;color:#d7e9f9;line-height:1.95;margin:0 0 10px;text-indent:2em}' +
    '.ej-badge{font-size:9.5px;border-radius:8px;padding:2px 8px;font-weight:700}' +
    '.ej-badge.llm{background:rgba(0,230,118,.12);color:#00e676;border:1px solid rgba(0,230,118,.35)}' +
    '.ej-badge.rule{background:rgba(255,204,0,.12);color:#ffcc00;border:1px solid rgba(255,204,0,.3)}' +
    '.ej-govbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}' +
    '.ej-btn{background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;transition:.15s}' +
    '.ej-btn:hover{filter:brightness(1.15)}' +
    '.ej-btn.ghost{background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.3);color:#9fc3e2;font-weight:400}' +
    '.ej-btn.ghost:hover{border-color:#00d4ff;color:#dff3ff}' +
    '.ej-btn:disabled{opacity:.55;cursor:wait}' +
    '.ej-xlink{background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.22);color:#9fc3e2;border-radius:6px;padding:4px 12px;font-size:11px;cursor:pointer;transition:.15s;font-weight:400}' +
    '.ej-xlink:hover{border-color:#22d3ee;color:#dff3ff;box-shadow:0 0 8px rgba(34,211,238,.25)}' +
    '.ej-manual{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,212,255,.14)}' +
    '.ej-in{background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.25);color:#dff3ff;border-radius:6px;padding:6px 10px;font-size:12px;outline:none}' +
    '.ej-in:focus{border-color:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,.3)}' +
    '.ej-case{position:relative;background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.18);border-radius:10px;padding:12px 14px 12px 17px;margin-bottom:10px}' +
    '.ej-case::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:linear-gradient(180deg,#7c3aed,#22d3ee)}' +
    '.ej-caseno{display:inline-flex;align-items:center;min-width:70px;justify-content:center;padding:3px 10px;border-radius:8px;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;font-size:11px;font-weight:800;letter-spacing:1px;box-shadow:0 0 10px rgba(124,58,237,.35)}' +
    '.ej-rhythm{display:flex;align-items:flex-end;gap:2px;height:74px;background:var(--bg2,#132743);border-radius:6px;padding:6px 4px 0;overflow-x:auto;margin-bottom:2px}' +
    '.ej-rhythm i{flex:1;min-width:13px;background:linear-gradient(180deg,#a78bfa,#5b21b6);border-radius:2px 2px 0 0;position:relative;cursor:default;font-style:normal}' +
    '.ej-rhythm i.hot{background:linear-gradient(180deg,#ff3355,#7a0e2a);box-shadow:0 0 8px rgba(255,51,85,.45)}' +
    '.ej-rhythm i span{position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:8.5px;color:#c9e2f5;white-space:nowrap}' +
    '.ej-rhythm-x{display:flex;gap:2px;padding:2px 4px;font-size:8.5px;color:#5a7a99;overflow-x:auto}' +
    '.ej-rhythm-x b{flex:1;min-width:13px;text-align:center;font-weight:400;overflow:hidden;white-space:nowrap}' +
    '.ej-mxr{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:700;margin-top:10px}' +
    '.ej-mxr.ax1{color:#22d3ee}.ej-mxr.ax2{color:#c084fc}' +
    '.ej-mxr em{flex:1;height:1px;font-style:normal;background:currentColor;opacity:.25}' +
    '.ej-mxg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}' +
    '@media (max-width:1000px){.ej-mxg{grid-template-columns:repeat(2,1fr)}}' +
    '.ej-mxc{background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.12);border-radius:8px;padding:8px 10px}' +
    '.ej-mxc .k{font-size:9.5px;color:#7aa5c9}' +
    '.ej-mxc .v{font-size:19px;font-weight:800;margin:3px 0 2px;line-height:1.1;text-shadow:0 0 10px currentColor}' +
    '.ej-mxc .d{font-size:9.5px;color:#8fa8c0;line-height:1.55}' +
    '.ej-sim{background:var(--bg2,#132743);border:1px solid rgba(34,211,238,.15);border-radius:8px;padding:9px 11px;margin-bottom:8px}' +
    '.ej-sim-tt{font-size:12px;color:#dff3ff;line-height:1.6;font-weight:600;word-break:break-all}' +
    '.ej-sim-meta{display:flex;gap:8px;align-items:center;font-size:10px;color:#7aa5c9;margin-top:4px;flex-wrap:wrap}' +
    '.ej-simbar{height:5px;border-radius:3px;background:rgba(0,212,255,.1);margin-top:7px;overflow:hidden;position:relative}' +
    '.ej-simbar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#22d3ee,#7c3aed)}' +
    '.ej-vsbtn{background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.4);color:#c4b5fd;border-radius:6px;padding:2px 9px;font-size:10px;cursor:pointer;font-weight:700}' +
    '.ej-vsbtn:hover{background:rgba(124,58,237,.3);color:#fff}' +
    '.ej-vs{position:fixed;inset:0;background:rgba(3,10,24,.74);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.ej-vsbox{background:var(--panel,#0e1f3a);border:1px solid rgba(124,58,237,.45);border-radius:12px;max-width:880px;width:100%;max-height:86vh;overflow:auto;padding:16px 18px;box-shadow:0 0 40px rgba(124,58,237,.3)}' +
    '.ej-vsgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}' +
    '@media (max-width:700px){.ej-vsgrid{grid-template-columns:1fr}}' +
    '.ej-vscell{background:var(--bg2,#132743);border-radius:8px;padding:10px 12px;border:1px solid rgba(0,212,255,.12)}' +
    '.ej-vscell h4{margin:0 0 6px;font-size:11px;color:#22d3ee}' +
    '.ej-vscell p{margin:0;font-size:11.5px;color:#d7e9f9;line-height:1.75;word-break:break-all}' +
    '.ej-vscon{background:rgba(255,51,85,.07);border:1px solid rgba(255,51,85,.25);border-radius:8px;padding:10px 12px;margin-top:8px}' +
    '.ej-vscon h4{margin:0 0 6px;font-size:11px;color:#ff5f9e}' +
    '.ej-vscon p{margin:0 0 6px;font-size:11.5px;color:#ffd6de;line-height:1.85}' +
    '.ej-tl{position:relative;padding-left:22px;margin-top:4px}' +
    '.ej-tl::before{content:"";position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:linear-gradient(180deg,#7c3aed,#22d3ee)}' +
    '.ej-tl .ej-item{position:relative;border-bottom:none;padding:4px 0 11px}' +
    '.ej-tl .ej-item::before{content:"";position:absolute;left:-20px;top:9px;width:9px;height:9px;border-radius:50%;background:#132743;border:2px solid #22d3ee;box-shadow:0 0 6px rgba(34,211,238,.5)}';
  document.head.appendChild(st);
})();

var EVENTINSIGHT = {
  _docket: null, _report: null, _loading: false, _currentId: null, _timer: null,

  init: function () {
    var host = document.getElementById('evjudge-root');
    if (!host) return;
    /* #686 防抖：navigateTo/视图恢复双路径短时重复触发时不重复初始化（双 loadDocket 竞态会 wipe 案卷） */
    var now = Date.now();
    if (this._lastInit && now - this._lastInit < 2000) return;
    this._lastInit = now;
    this.renderShell();
    this.loadDocket();
    /* 常开队列：120s 自刷研判队列与态势（已打开的案卷不自动刷新） */
    if (this._timer) clearInterval(this._timer);
    var self = this;
    this._timer = setInterval(function () { self.loadDocket(true); }, 120000);
  },

  _fetch: function (url, timeout, extCtrl) {
    var ctrl = extCtrl || new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout || 30000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  },

  _esc: function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  _lvColor: function (lv) { return { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' }[lv] || '#8fa8c0'; },

  renderShell: function () {
    var host = document.getElementById('evjudge-root');
    host.innerHTML =
      '<div class="ej-head">' +
        '<span style="font-size:22px;filter:drop-shadow(0 0 10px rgba(124,58,237,.5))">🔬</span>' +
        '<div><div class="ej-tt">事件研判中心 · 自主研判工作台</div>' +
        '<div class="ej-sub">常开研判队列 · 零输入零触发 —— 72h 红橙候选 × 事件近7日时效闸（主面板只放近期真实威胁，旧数据走历史复盘）· 点击立卷（案卷引擎：时间流 × 全库历史相似性 × 复合研判 × 公文输出）—— 平台数据库真实数据 · 零模拟</div></div>' +
      '</div>' +
      '<div id="ej-docket"><div class="ej-loading">⟳ 自主研判队列装配中：72h 红橙候选评分 + 突发链检测 + 热度矩阵…</div></div>' +
      '<div id="ej-dossier"></div>';
  },

  /* ============ ①-③ 常开研判队列 + 复合态势 ============ */
  loadDocket: function (silent) {
    var self = this;
    this._fetch('/api/insight/event-docket', 45000).then(function (d) {
      if (!d || !d.ok) { if (!silent) { var el = document.getElementById('ej-docket'); if (el) el.innerHTML = '<div class="ej-empty">⚠️ 队列装配失败：' + self._esc(d && d.error || '服务异常') + '</div>'; } return; }
      self._docket = d;
      self._renderDocket();
      /* 自主立卷：首次装配完成即自动打开队列首条（quick 秒出案卷） */
      if (!self._currentId && d.queue && d.queue.length) self.openDossier(d.queue[0].id, true);
    }).catch(function (e) {
      if (!silent) { var el = document.getElementById('ej-docket'); if (el) el.innerHTML = '<div class="ej-empty">⚠️ 队列服务不可达：' + self._esc(e.message) + '</div>'; }
    });
  },

  _renderDocket: function () {
    var host = document.getElementById('ej-docket');
    var d = this._docket;
    if (!host || !d) return;
    /* #686 立卷装配进行中不重建 docket DOM（防竞态 wipe 案卷） */
    if (this._loading) return;
    /* #686 先持有已打开案卷的节点引用（innerHTML 覆盖后 getElementById 取不到 detach 节点） */
    var keepDossier = document.getElementById('ej-dossier-body');
    var k = d.kpi || {};
    var lvC = { red: '#ff3355', orange: '#ff8800' };

    /* ① KPI 带（#712：待研判口径=72h 采集窗 × 事件发生于近7日，旧数据不进主面板） */
    var kpis =
      '<div class="ej-kpi"><div class="v" style="color:#ff3355">' + (k.pending72 || 0) + '</div><div class="l">待研判红橙（72h）</div><div class="d">事件发生于近7日（时效闸）</div></div>' +
      '<div class="ej-kpi"><div class="v" style="color:#22d3ee">' + (k.todayNew || 0) + '</div><div class="l">今日入库</div><div class="d">含历史补采回填</div></div>' +
      '<div class="ej-kpi"><div class="v" style="color:#ffcc00">' + (k.chinaRedOrange || 0) + '</div><div class="l">红橙涉华（72h）</div><div class="d">isChinaRelatedStrict 判定</div></div>' +
      '<div class="ej-kpi"><div class="v" style="color:#ff8800">' + (k.activeChains || 0) + '</div><div class="l">活跃事件链（7d）</div><div class="d">签名链 ≥3 条</div></div>' +
      '<div class="ej-kpi"><div class="v" style="color:#c084fc">' + ((d.queue || []).length) + '</div><div class="l">研判队列深度</div><div class="d">复合价值评分 TOP</div></div>';

    /* ② 研判队列卡 */
    var self = this;
    var q = d.queue || [];
    var maxScore = Math.max.apply(null, q.map(function (x) { return x.score; }).concat([1]));
    var queueHtml = q.map(function (x, i) {
      var pct = Math.max(6, Math.round(x.score / maxScore * 100));
      /* #686B 次级元数据：类型 / 涉及国 / 项目档案关联（ENTERPRISES 前端 join，命中可跳资产视图） */
      var pj = self._projHit(x.country);
      var mt2 =
        '<div class="mt2">' +
          '<span title="事件类型">🏷 ' + self._esc(x.type || '未分类') + '</span>' +
          '<span title="涉及国别">🌐 涉及 ' + self._esc(x.country || '未标注') + '</span>' +
          (pj && pj.prj
            ? '<span class="ej-tag pj" onclick="event.stopPropagation();EVENTINSIGHT.xnav(\'assets\')" title="' + self._esc(pj.ent + ' · ' + pj.prj + ' —— 点击打开企业资产档案') + '">📁 ' + self._esc(pj.ent) + ' · ' + self._esc(pj.prj) + '</span>'
            : pj
              ? '<span class="ej-tag pj" onclick="event.stopPropagation();EVENTINSIGHT.xnav(\'assets\')" title="' + self._esc(pj.ent + ' 布局该方向 —— 点击打开企业资产档案') + '">📁 ' + self._esc(pj.ent) + ' 布局国</span>'
              : '<span class="ej-tag nj" title="该方向暂无中资项目档案关联">📁 无关联项目</span>') +
        '</div>';
      return '<div class="ej-qcard' + (x.id === self._currentId ? ' on' : '') + '" onclick="EVENTINSIGHT.openDossier(' + x.id + ',true)" title="复合研判价值评分 ' + x.score + '（级别×时近 + 涉华 + 信源印证 + 链条长度）">' +
        '<div class="rk" style="' + (i < 3 ? 'color:#ff3355' : '') + '">' + (i + 1) + '</div>' +
        '<div class="dot" style="background:' + (lvC[x.level] || '#8fa8c0') + ';box-shadow:0 0 6px ' + (lvC[x.level] || '#8fa8c0') + '"></div>' +
        '<div class="bd">' +
          '<div class="tt">' + self._esc(x.title) + '</div>' +
          '<div class="mt">' +
            '<span>' + self._esc(x.country || '未标注') + '</span>' +
            '<span class="ej-tag ty">' + self._esc(x.type || '') + '</span>' +
            (x.china ? '<span class="ej-tag cn">涉华</span>' : '') +
            '<span>信源 ' + (x.srcs || 1) + '</span><span>链 ' + (x.chain || 1) + '</span>' +
            (x.evDate ? '<span title="事件发生日期（#712 时效闸：主面板仅收近7日发生事件）">🗓 ' + self._esc(x.evDate) + '</span>' : '') +
            '<span style="font-family:Consolas,monospace" title="采集入库时间">⇥ ' + self._esc(String(x.time || '').slice(5, 16)) + '</span>' +
          '</div>' +
          mt2 +
          '<div class="ej-scorebar"><i style="width:' + pct + '%"></i></div>' +
        '</div>' +
        '<div class="ej-qact">立卷研判 →</div>' +
      '</div>';
    }).join('');

    /* ③ 突发事件链（#700：点击国别就地展开内联研判——该国48h红橙明细+逐条立卷入口，不再跳转其他功能区） */
    var ch = d.chains || [];
    var chMax = ch.length ? ch[0].n : 1;
    var chainHtml = ch.length ? ch.map(function (c, i) {
      var evs = (c.events || []);
      return '<div class="ej-chainwrap">' +
        '<div class="ej-chain" onclick="EVENTINSIGHT.chainDrill(' + i + ')" title="' + self._esc(c.country) + ' 48h ' + self._esc(c.type) + '红橙 ' + c.n + ' 条（红 ' + c.red + '）— 点击就地展开研判明细">' +
        '<div class="cn2">' + self._esc(c.country) + '</div>' +
        '<div class="ty2">' + self._esc(c.type) + '</div>' +
        '<div class="bw"><i style="width:' + Math.max(6, Math.round(c.n / chMax * 100)) + '%"></i></div>' +
        '<div class="nv">' + c.n + '</div>' +
        '<div style="font-size:9px;color:#c4b5fd;flex-shrink:0">' + (evs.length ? '▼ 展开研判' : '—') + '</div>' +
      '</div>' +
      '<div class="ej-chainbox" id="ej-chainbox-' + i + '" style="display:none"></div>' +
      '</div>';
    }).join('') : '<div class="ej-empty" style="padding:14px 0">48h 无安全类突发簇</div>';

    /* ③ 7日类别分布 */
    var td = d.typeDist7 || [];
    var tdMax = td.length ? td[0].n : 1;
    var tdHtml = td.slice(0, 8).map(function (t) {
      return '<div class="ej-tdist"><div class="cn2">' + self._esc(t.type) + '</div>' +
        '<div class="bw"><i style="width:' + Math.max(4, Math.round(t.n / tdMax * 100)) + '%"></i></div>' +
        '<div class="nv">' + t.n + '</div></div>';
    }).join('');

    /* ③ 国别×类别热度矩阵 */
    var mx = d.matrix || { countries: [], types: [], typeKeys: [], cell: {} };
    var mMax = 1;
    Object.keys(mx.cell || {}).forEach(function (kk) { if (mx.cell[kk] > mMax) mMax = mx.cell[kk]; });
    var mxHtml = '<table class="ej-mx"><tr><th class="rw" style="width:64px">国别 ╲ 类别</th>' +
      mx.types.map(function (t) { return '<th>' + self._esc(t) + '</th>'; }).join('') + '</tr>';
    mx.countries.forEach(function (c) {
      mxHtml += '<tr><th class="rw">' + self._esc(c) + '</th>' + mx.typeKeys.map(function (tk) {
        var n = (mx.cell[c + '|' + tk]) || 0;
        if (!n) return '<td class="zero">·</td>';
        var alpha = (0.12 + 0.55 * (n / mMax)).toFixed(2);
        return '<td style="background:rgba(239,68,68,' + alpha + ')" title="' + self._esc(c) + ' × ' + self._esc(tk) + '：' + n + ' 条（近7日）">' + (n >= 10000 ? Math.round(n / 1000) + 'k' : n) + '</td>';
      }).join('') + '</tr>';
    });
    mxHtml += '</table>';

    host.innerHTML =
      '<div class="ej-kpis">' + kpis + '</div>' +
      '<div class="ej-main">' +
        '<div>' +
          '<div class="ej-panel warm">' +
            '<div class="ej-sec">🎯 自主研判队列 <span class="mut">72h 红橙候选 × 复合价值评分（级别×时近+涉华+信源印证+链长）· 事件发生于近7日（#712 时效闸，旧数据走历史复盘）· 点击立卷</span></div>' +
            (queueHtml || '<div class="ej-empty">近 72h 无红橙候选，雷达待命</div>') +
            '<div class="ej-manual" id="ej-manual">' +
              '<button class="ej-btn ghost" style="font-size:11px;padding:5px 12px" onclick="EVENTINSIGHT.toggleManual()">＋ 手工立卷（事件ID/关键词，次级入口）</button>' +
              '<span id="ej-manual-in" style="display:none;flex:1;min-width:260px">' +
                '<input class="ej-in" id="ej-kw" style="width:52%" placeholder="事件ID 或 标题关键词（如：刚果金 袭击）" onkeydown="if(event.key===\'Enter\')EVENTINSIGHT.runManual()">' +
                '<input class="ej-in" id="ej-country" style="width:22%;margin-left:6px" placeholder="国别(可选)">' +
                '<button class="ej-btn" style="font-size:11px;padding:6px 14px;margin-left:6px" onclick="EVENTINSIGHT.runManual()">立卷</button>' +
              '</span>' +
            '</div>' +
          '</div>' +
          /* 案卷工作台插槽：跟随队列（左列下方、独占宽） */
          '<div id="ej-dossier-slot"></div>' +
        '</div>' +
        '<div>' +
          '<div class="ej-panel warm">' +
            '<div class="ej-sec">⚡ 突发事件链 <span class="mut">48h 国别×类别安全类簇（红橙≥4条）· 点击国别就地展开研判明细</span></div>' +
            chainHtml +
          '</div>' +
          '<div class="ej-panel">' +
            '<div class="ej-sec">📊 类别分布 <span class="mut">近7日入库量</span></div>' +
            tdHtml +
          '</div>' +
          '<div class="ej-panel">' +
            '<div class="ej-sec">🔥 国别×类别热度矩阵 <span class="mut">近7日 · 数值为事件条数</span></div>' +
            '<div style="overflow-x:auto">' + mxHtml + '</div>' +
          '</div>' +
          '<div class="ej-note">' + this._esc(d.note || '') + (d.generatedAt ? ' 队列装配时间：' + this._esc(d.generatedAt) + ' · 120s 自刷。' : '') + '</div>' +
        '</div>' +
      '</div>';

    /* #686 已打开的案卷重挂到新插槽：innerHTML 覆盖前先持有节点引用（getElementById 查不到 detach 节点，原逻辑恒失效） */
    var ds = document.getElementById('ej-dossier-slot');
    if (ds && keepDossier) { try { ds.appendChild(keepDossier); } catch (e) {} }
    this._markActive();
  },

  toggleManual: function () {
    var el = document.getElementById('ej-manual-in');
    if (el) el.style.display = (el.style.display === 'none') ? 'inline' : 'none';
  },

  /* 复合联动：跨功能区跳转（navigateTo 为 app.js 顶层函数，全局可用） */
  xnav: function (v) { try { if (typeof navigateTo === 'function') navigateTo(v); } catch (e) {} },

  /* #700 突发链国别就地研判：点击国别展开 48h 红橙明细（后端 chains.events），逐条可立卷，不跳转 */
  chainDrill: function (i) {
    var box = document.getElementById('ej-chainbox-' + i);
    if (!box) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    var c = ((this._docket && this._docket.chains) || [])[i] || {};
    var evs = c.events || [];
    var lvC = { red: '#ff3355', orange: '#ff8800' };
    box.innerHTML = evs.length
      ? '<div class="ej-chdr">🧭 ' + this._esc(c.country) + ' · ' + this._esc(c.type) + ' —— 48h 红橙明细 ' + c.n + ' 条（红 ' + c.red + '）· 点击条目立卷研判</div>' +
        evs.map(function (e) {
          return '<div class="ej-cev" onclick="EVENTINSIGHT.openDossier(' + e.id + ',true)" title="立卷研判：时间流 × 全库相似 × 复合研判">' +
            '<span class="lv2" style="background:' + (lvC[e.level] || '#8fa8c0') + ';box-shadow:0 0 5px ' + (lvC[e.level] || '#8fa8c0') + '"></span>' +
            '<span style="flex:1">' + this._esc(e.title) + (e.china ? ' <span class="tagcn2">涉华</span>' : '') + '</span>' +
            '<span class="tm2">' + this._esc(String(e.time || '').slice(5, 16)) + '</span>' +
          '</div>';
        }, this).join('')
      : '<div class="ej-empty" style="padding:10px 0">该簇 48h 明细暂缺（数据自刷中）</div>';
    box.style.display = 'block';
  },

  _markActive: function () {
    var self = this;
    var cards = document.querySelectorAll('.ej-qcard');
    Array.prototype.forEach.call(cards, function (c) {
      c.classList.remove('on');
    });
    if (this._currentId == null) return;
    Array.prototype.forEach.call(cards, function (c) {
      var m = /openDossier\((\d+)/.exec(c.getAttribute('onclick') || '');
      if (m && Number(m[1]) === Number(self._currentId)) c.classList.add('on');
    });
  },

  /* ============ ④ 案卷工作台：点击队列条目 → quick 秒出 / AI 升级全量 ============
   * #700 修复「点击无反应」：此前自动立卷把 _loading 锁住，300s 内用户点任何卡被
   * if(this._loading) return 静默吞掉；现改为新立卷抢占式 abort 旧请求 + 立即滚动定位案卷。 */
  openDossier: function (id, quick) {
    var self = this;
    if (this._loading && this._abort) { try { this._abort.abort(); } catch (e) {} }   /* 抢占：取消旧立卷 */
    this._loading = false;
    this._currentId = id;
    this._markActive();
    var slot = this._slot();
    if (!slot) return;
    slot.innerHTML = '<div class="ej-panel" id="ej-dossier-body"><div class="ej-loading">⟳ 立卷装配中：事件锚定 + 全库时间流召回 + 相似事件匹配 + 历史规律 + ' + (quick ? '规则研判（秒出，可再升级 AI 深度研判）' : 'AI 深度研判（约 10-120 秒）') + '…</div></div>';
    try { slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    var ctrl = new AbortController();
    this._abort = ctrl;
    this._loading = true;
    this._fetch('/api/insight/event-report?id=' + encodeURIComponent(id) + (quick ? '&quick=1' : ''), 300000, ctrl)
      .then(function (d) {
        if (self._abort !== ctrl) return;   /* 已被更新立卷抢占，弃置 */
        self._loading = false;
        var s2 = self._slot() || slot;   /* #686 渲染前实时取槽：防 docket 自刷重建 DOM 后写入孤儿节点 */
        if (!d || !d.ok) { s2.innerHTML = '<div class="ej-panel" id="ej-dossier-body"><div class="ej-empty">⚠️ 立卷失败：' + self._esc(d && d.error || '服务异常') + '</div></div>'; return; }
        self._report = d;
        self._renderReport(s2);
      })
      .catch(function (e) {
        if (self._abort !== ctrl || e.name === 'AbortError') return;   /* 抢占产生的 abort 不算失败 */
        self._loading = false;
        var s3 = self._slot() || slot;
        s3.innerHTML = '<div class="ej-panel" id="ej-dossier-body"><div class="ej-empty">⚠️ 研判服务不可达：' + self._esc(e.name === 'AbortError' ? '请求超时（300s）' : e.message) + '</div></div>';
      });
  },

  /* #686 案卷槽：docket 自刷会整体重建 #ej-docket DOM，必须实时查询 */
  _slot: function () {
    return document.getElementById('ej-dossier-slot') || document.getElementById('ej-dossier');
  },

  /* #686B 项目档案关联：事件国别 × ENTERPRISES（35企/20+项目档案）前端 join，命中返回 {ent, prj} */
  _projHit: function (country) {
    if (!country) return null;
    try {
      var ents = (typeof ENTERPRISES !== 'undefined') ? ENTERPRISES : [];
      for (var i = 0; i < ents.length; i++) {
        var e = ents[i];
        var ps = (e.projects || []).filter(function (p) { return p && p.c === country; });
        if (ps.length) return { ent: e.short || e.name, prj: ps.map(function (p) { return p.n; }).slice(0, 2).join('、') };
        if ((e.countries || []).indexOf(country) >= 0) return { ent: e.short || e.name, prj: '' };
      }
    } catch (err) {}
    return null;
  },

  /* 手工立卷（次级入口）：关键词/事件ID → 同一案卷引擎 */
  runManual: function () {
    var self = this;
    var kwEl = document.getElementById('ej-kw'), ctEl = document.getElementById('ej-country');
    var kw = (kwEl && kwEl.value || '').trim(), ct = (ctEl && ctEl.value || '').trim();
    if (!kw) { try { showToast('请输入事件ID或标题关键词'); } catch (e) {} return; }
    var qs = (/^\d{1,9}$/.test(kw)) ? 'id=' + kw : 'q=' + encodeURIComponent(kw.slice(0, 40));
    if (ct) qs += '&country=' + encodeURIComponent(ct);
    var slot = this._slot();
    if (!slot) return;
    this._currentId = null; this._markActive();
    slot.innerHTML = '<div class="ej-panel" id="ej-dossier-body"><div class="ej-loading">⟳ 手工立卷装配中（全库时间流 + 相似事件 + 历史规律 + 规则研判）…</div></div>';
    this._fetch('/api/insight/event-report?' + qs + '&quick=1', 300000)
      .then(function (d) {
        var s2 = self._slot() || slot;
        if (!d || !d.ok) { s2.innerHTML = '<div class="ej-panel" id="ej-dossier-body"><div class="ej-empty">⚠️ ' + self._esc(d && d.error || '检索失败') + '</div></div>'; return; }
        self._report = d;
        self._currentId = d.anchor && d.anchor.id;
        self._renderReport(s2);
      })
      .catch(function (e) {
        var s3 = self._slot() || slot;
        s3.innerHTML = '<div class="ej-panel" id="ej-dossier-body"><div class="ej-empty">⚠️ 研判服务不可达：' + self._esc(e.message) + '</div></div>';
      });
  },

  /* AI 深度研判升级：对当前案卷重跑完整 LLM + 公文 */
  upgradeAI: function () {
    if (this._currentId == null) return;
    this.openDossier(this._currentId, false);
  },

  /* ============ ⑤ 案卷 01-05 渲染（#669 引擎沿用 + 复合联动/AI升级） ============ */
  _renderReport: function (slot) {
    var d = this._report;
    if (!d || !slot) return;
    var self = this;
    function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    var a = d.anchor || {}, st = d.stats || {};
    var lvC = { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' };

    var kpis = [
      ['全库同类事件', st.typeTotal || 0, '#c084fc'],
      ['时间流条目', (d.related || []).length, '#00d4ff'],
      ['相似事件（全库）', st.simCount || 0, '#22d3ee'],
      ['同国复发', st.sameCountry || 0, '#ff5f9e'],
      ['复发间隔中位', st.recurMedian != null ? st.recurMedian + ' 天' : '—', '#ffcc00']
    ].map(function (x) { return '<div class="ej-kpi"><div class="v" style="color:' + x[2] + '">' + x[1] + '</div><div class="l">' + x[0] + '</div></div>'; }).join('');

    var stages = (d.stages || []).map(function (s) {
      return '<div class="ej-stage' + (s.done ? ' done' : '') + '" title="' + esc(s.detail || '') + '">' +
        '<span class="dot2"></span><div class="sn">' + esc(s.name) + '</div>' +
        '<div class="stm">' + esc(s.time ? String(s.time).slice(5, 16) : (s.done ? '' : '未到达')) + '</div></div>';
    }).join('');

    var daily = d.daily || [];
    var maxN = Math.max.apply(null, daily.map(function (x) { return x.n; }).concat([1]));
    var bars = daily.map(function (x) {
      var h = Math.max(3, Math.round(x.n / maxN * 82));
      return '<div class="ej-bar" style="height:' + h + 'px" title="' + esc(x.date) + '：' + x.n + ' 条"><span>' + (x.n > 1 ? x.n : '') + '</span></div>';
    }).join('');
    var barX = daily.map(function (x, i) {
      return '<i>' + (i % Math.ceil(daily.length / 8) === 0 || i === daily.length - 1 ? esc(String(x.date).slice(5)) : '') + '</i>';
    }).join('');

    var relRows = (d.related || []).map(function (i) {
      return '<div class="ej-item"><span class="tm">' + esc(String(i.time).slice(0, 16)) + '</span>' +
        '<span class="lv" style="background:' + (lvC[i.level] || '#8fa') + '"></span>' +
        '<span class="tx">' + esc(i.title) +
          (i.source ? ' <span style="color:#5a7a99;font-size:9.5px">[' + esc(i.source) + ']</span>' : '') +
          (i.url ? ' <a href="' + esc(i.url) + '" target="_blank" rel="noopener">原文</a>' : '') + '</span></div>';
    }).join('');

    var tm = d.typeMonthly || [];
    var tmMax = Math.max.apply(null, tm.map(function (x) { return x.n; }).concat([1]));
    var tmHotLine = tmMax * 0.7;
    var rhythm = tm.map(function (x) {
      var hot = x.n >= tmHotLine && x.n > 1;
      var h = Math.max(3, Math.round(x.n / tmMax * 62));
      return '<i class="' + (hot ? 'hot' : '') + '" style="height:' + h + 'px" title="' + esc(x.m) + '：' + x.n + ' 条' + (hot ? '（高峰月）' : '') + '"><span>' + (hot ? x.n : '') + '</span></i>';
    }).join('');
    var rhythmStep = Math.max(1, Math.ceil(tm.length / 10));
    var rhythmX = tm.map(function (x, i) {
      return '<b>' + (i % rhythmStep === 0 || i === tm.length - 1 ? esc(x.m) : '') + '</b>';
    }).join('');
    var peak = tm.slice().sort(function (p, q) { return q.n - p.n; })[0];

    var relN = (d.related || []).length;
    var relRO = (d.related || []).filter(function (i) { return i.level === 'red' || i.level === 'orange'; }).length;
    var chinaN = st.chinaCount || 0;
    var lvN = { red: '红', orange: '橙', yellow: '黄', blue: '蓝' };
    function cell(k, v, c, dsc) {
      return '<div class="ej-mxc"><div class="k">' + k + '</div><div class="v" style="color:' + c + '">' + v + '</div><div class="d">' + dsc + '</div></div>';
    }
    var mx1 =
      cell('时间链条目', relN, '#00d4ff', relN >= 8 ? '事件链持续演进，处于活跃发展窗口' : relN >= 3 ? '多节点演进，链条仍在延伸' : '链条收敛或报道单一') +
      cell('独立信源印证', st.srcCount || 1, '#22d3ee', (st.srcCount || 1) > 1 ? '库内多源交叉印证，置信度高' : '单一信源，待后续印证') +
      cell('链内红橙事件', relRO, relRO ? '#ff3355' : '#00e676', relRO ? '链条含红橙 ' + relRO + ' 条，烈度偏高' : '链条烈度可控') +
      cell('涉华关联条目', chinaN, chinaN ? '#ff8800' : '#00e676', chinaN ? '含涉华关联，建议领保条线专项过筛' : '未检出涉华关联');
    var mx2 =
      cell('全库同类总量', st.typeTotal || 0, '#c084fc', (st.typeTotal || 0) >= 500 ? '历史基线充足，规律可信' : (st.typeTotal || 0) >= 50 ? '历史基线中等，判读稳健' : '历史样本有限，判读宜谨慎') +
      cell('同国相似事件', st.sameCountry || 0, '#ff5f9e', (st.sameCountry || 0) >= 3 ? '同国密集复发，建议前置防范' : (st.sameCountry || 0) >= 1 ? '同国有复发先例' : '尚无同国相似记录') +
      cell('复发间隔中位', st.recurMedian != null ? st.recurMedian + ' 天' : '—', '#ffcc00', st.recurMedian != null ? '可按复发周期加密跟踪节奏' : '样本不足以测定复发周期') +
      cell('历史高峰月', peak ? peak.m : '—', '#ff3355', peak ? peak.n + ' 条，历史高发窗口，警惕同期复发' : '暂无月度数据');

    var simsArr = d.sims || [];
    var scMax = Math.max.apply(null, simsArr.map(function (s) { return s.overlap * 2 + (s.sameCountry ? 3 : 0); }).concat([1]));
    var simCards = simsArr.slice(0, 20).map(function (i) {
      var score = i.overlap * 2 + (i.sameCountry ? 3 : 0);
      var pct = Math.max(8, Math.round(score / scMax * 100));
      return '<div class="ej-sim">' +
        '<div class="ej-sim-tt">' + esc(i.title) + '</div>' +
        '<div class="ej-sim-meta">' +
          '<span style="color:' + (lvC[i.level] || '#8fa') + ';font-weight:700">● ' + (lvN[i.level] || '黄') + '</span>' +
          '<span>' + esc(String(i.time).slice(0, 10)) + '</span>' +
          '<span>' + esc(i.country || '未标注') + '</span>' +
          (i.sameCountry ? '<span class="ej-tag cn">同国复发</span>' : '') +
          '<span style="margin-left:auto;display:flex;gap:8px;align-items:center">' +
            (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener" style="color:#22d3ee;text-decoration:none;font-size:10px">原文</a>' : '') +
            '<button class="ej-vsbtn" onclick="EVENTINSIGHT.compare(' + i.id + ')">⇄ 对比研判</button>' +
          '</span>' +
        '</div>' +
        '<div class="ej-simbar" title="匹配度 ' + pct + '%（词元重合 ' + i.overlap + ' 项' + (i.sameCountry ? '＋同国加成' : '') + '）"><i style="width:' + pct + '%"></i></div>' +
      '</div>';
    }).join('');

    var paras = String(d.judgment || '').split(/\n+/).filter(Boolean).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');

    /* 复合联动条：案卷 ↔ 其他功能区 */
    var xlinks = (typeof navigateTo === 'function')
      ? '<div class="ej-govbar" style="margin:2px 0 8px">' +
          '<button class="ej-xlink" onclick="EVENTINSIGHT.xnav(\'country\')">🌐 国别风险研判 →</button>' +
          '<button class="ej-xlink" onclick="EVENTINSIGHT.xnav(\'terjudge\')">🛰️ 全球恐袭态势监测中心 →</button>' +
          '<button class="ej-xlink" onclick="EVENTINSIGHT.xnav(\'alerts\')">🚨 智能预警中心 →</button>' +
          '<button class="ej-xlink" onclick="EVENTINSIGHT.xnav(\'monitor\')">🗺️ 实时风险监测 →</button>' +
        '</div>'
      : '';

    slot.innerHTML =
      '<div class="ej-panel" id="ej-dossier-body" style="border-color:rgba(124,58,237,.35)">' +
        '<div class="ej-sec">🧾 案卷工作台 <span class="mut">当前立卷 · ' + esc(d.generatedAt || '') + ' 装配</span>' +
          '<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="ej-btn ghost" style="font-size:11px;padding:5px 12px" onclick="EVENTINSIGHT.upgradeAI()"' + (d.llmOk ? ' disabled' : '') + '>🧠 ' + (d.llmOk ? 'AI 深度研判已完成' : 'AI 深度研判升级（Kimi）') + '</button>' +
            '<button class="ej-btn ghost" style="font-size:11px;padding:5px 12px" onclick="EVENTINSIGHT.govdoc()"' + (d.govHtml ? '' : ' disabled') + '>📄 公文输出</button>' +
          '</span>' +
        '</div>' +
        xlinks +
        '<div class="ej-kpis">' + kpis + '</div>' +

        '<div class="ej-case">' +
          '<div class="ej-sec"><span class="ej-caseno">案卷 01</span> 🎯 事件锚定 <span style="font-size:10px;color:#5a7a99;font-weight:400">锚点事件与生命周期（真实库字段装配）</span></div>' +
          '<div class="ej-anchor"><div class="ej-anchor-tt">' + (a.historic ? '<span class="ej-tag" style="background:rgba(124,58,237,.25);color:#c4b5fd;border:1px solid rgba(124,58,237,.5);margin-right:6px;font-size:10px;padding:1px 7px;border-radius:3px;vertical-align:2px" title="本事件发生于 ' + esc(a.evDate || '—') + '（距今 ' + (a.evAgeDays || 0) + ' 天），本卷为历史复盘研判，非近期实时威胁">#712 历史复盘 · ' + esc(a.evDate || '') + '</span>' : '') + esc(a.title || '') + '</div>' +
          '<div class="ej-anchor-meta">' + esc(a.country || '未标注') + ' · ' + esc(a.type || '') + ' · 级别 ' + esc(a.level || '—') + (a.evDate ? ' · 事件发生 ' + esc(a.evDate) : '') + ' · 装配时间 ' + esc(d.generatedAt || '') + '</div></div>' +
          '<div class="ej-stages">' + stages + '</div>' +
          (daily.length >= 2 ? '<div class="ej-sec" style="margin-top:8px;font-size:11.5px">📊 事件链条逐日演进（条）</div><div class="ej-bars">' + bars + '</div><div class="ej-bar-x">' + barX + '</div>' : '') +
        '</div>' +

        '<div class="ej-case">' +
          '<div class="ej-sec"><span class="ej-caseno">案卷 02</span> 📈 全库历史规律 <span style="font-size:10px;color:#5a7a99;font-weight:400">该类别建库以来逐月事件量 · 时间不受限</span></div>' +
          (tm.length >= 2 ? '<div class="ej-rhythm">' + rhythm + '</div><div class="ej-rhythm-x">' + rhythmX + '</div>' : '<div class="ej-empty" style="padding:10px 0">月度数据不足，无法形成规律带</div>') +
          '<div class="ej-mxr ax1">事件链维度<em></em></div><div class="ej-mxg">' + mx1 + '</div>' +
          '<div class="ej-mxr ax2">历史规律维度<em></em></div><div class="ej-mxg">' + mx2 + '</div>' +
        '</div>' +

        '<div class="ej-case">' +
          '<div class="ej-sec"><span class="ej-caseno">案卷 03</span> 🔍 相似历史事件簇 <span style="font-size:10px;color:#5a7a99;font-weight:400">全库同类别词元加权 ' + simsArr.length + ' 起 · 点击「⇄ 对比研判」逐案对照</span></div>' +
          (simCards || '<div class="ej-empty">全库内无词元重合的同类历史事件（时间不限）</div>') +
        '</div>' +

        '<div class="ej-case">' +
          '<div class="ej-sec"><span class="ej-caseno">案卷 04</span> 🌊 事件时间流 <span style="font-size:10px;color:#5a7a99;font-weight:400">全库不限时召回 ' + relN + ' 条 · 按时间正序演进</span></div>' +
          '<div class="ej-tl">' + (relRows || '<div class="ej-empty">库内无其他时间流条目</div>') + '</div>' +
        '</div>' +

        '<div class="ej-case ej-judge">' +
          '<div class="ej-sec"><span class="ej-caseno">案卷 05</span> 🧠 综合研判 <span class="ej-badge ' + (d.llmOk ? 'llm' : 'rule') + '">' + (d.llmOk ? 'Kimi 大模型' : '规则模板 · 引用真实数字') + '</span></div>' +
          paras +
          '<div class="ej-govbar">' +
            (d.govHtml ? '<button class="ej-btn" onclick="EVENTINSIGHT.govdoc()">📄 打开公文版（红头版式 · 图表复合分析）</button>' : '') +
            (!d.llmOk ? '<button class="ej-btn ghost" onclick="EVENTINSIGHT.upgradeAI()">🧠 升级 AI 深度研判（Kimi 大模型重写研判段）</button>' : '') +
          '</div>' +
          '<div class="ej-note">' + esc(d.note || '') + '</div>' +
        '</div>' +
      '</div>';
  },

  /* 案卷03 · ⇄ 对比研判（#669 原样沿用：复发间隔 / 国别泛化 / 烈度演变自动结论） */
  compare: function (id) {
    var d = this._report;
    if (!d) return;
    var sim = (d.sims || []).filter(function (s) { return s.id === id; })[0];
    if (!sim) return;
    function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    var a = d.anchor || {}, st = d.stats || {};
    var lvC = { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' };
    var lvN = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' };
    var lvRank = { red: 4, orange: 3, yellow: 2, blue: 1 };
    var rel = d.related || [];
    var aItem = rel.filter(function (r) { return r.id === a.id; })[0] || rel[rel.length - 1] || {};
    var aTime = String(aItem.time || '').slice(0, 10);
    var sTime = String(sim.time || '').slice(0, 10);
    var score = (sim.overlap || 0) * 2 + (sim.sameCountry ? 3 : 0);
    var cons = [];
    if (aTime && sTime) {
      var gap = Math.round((new Date(aTime) - new Date(sTime)) / 86400000);
      if (gap >= 0) {
        cons.push('时间跨度：该历史事件早于锚点 ' + gap + ' 天。' + (st.recurMedian != null ? '全库相似事件复发间隔中位数约 ' + st.recurMedian + ' 天，' + (gap >= st.recurMedian * 0.8 ? '本次复发处于周期预测窗口内，周期规律应验。' : '本次复发明显早于周期中位，提示风险节奏加快，需加密监测。') : ''));
      } else {
        cons.push('时间跨度：该事件晚于锚点 ' + (-gap) + ' 天（时序标注异常，仅供参照）。');
      }
    }
    cons.push(sim.sameCountry
      ? '国别维度：同国别复发（' + esc(a.country || '未标注') + '）。该方向存在可重复触发的同类风险机制，建议对照历史处置案例前置部署防范。'
      : '国别维度：风险跨国别泛化（' + esc(a.country || '未标注') + ' ↔ ' + esc(sim.country || '未标注') + '）。同类风险不依赖单一国别条件，区域联防不可缺位。');
    var aL = a.level || 'yellow', sL = sim.level || 'yellow';
    var dr = (lvRank[aL] || 2) - (lvRank[sL] || 2);
    cons.push('烈度演变：历史事件为' + (lvN[sL] || '黄色') + '，锚点事件为' + (lvN[aL] || '黄色') + '——' +
      (dr > 0 ? '烈度升级，同类风险正在抬升，建议响应等级上调。' : dr < 0 ? '烈度回落，当前事件影响面低于历史先例，可按常规流程跟踪。' : '烈度持平，参照历史处置口径执行即可。'));
    cons.push('词元重合 ' + (sim.overlap || 0) + ' 项（匹配得分 ' + score + '）：两事件在' +
      ((sim.overlap || 0) >= 3 ? '主体、手段、地点等多个维度高度同构' : '部分维度同构') + '，历史事件的演进路径与处置方式具备直接参考价值。');
    var box = document.createElement('div');
    box.className = 'ej-vs';
    box.innerHTML =
      '<div class="ej-vsbox">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<div style="font-size:14px;font-weight:800;color:#dff3ff">⇄ 对比研判 · 锚点事件 × 相似历史事件</div>' +
          '<button class="ej-btn ghost" onclick="this.closest(\'.ej-vs\').remove()">关闭</button>' +
        '</div>' +
        '<div class="ej-vsgrid">' +
          '<div class="ej-vscell"><h4>锚点事件</h4><p>' + esc(a.title) + '</p>' +
            '<p style="color:#7aa5c9;font-size:10.5px;margin-top:6px">' + esc(a.country || '未标注') + ' · ' + esc(a.type || '') + ' · <span style="color:' + (lvC[aL] || '#8fa') + ';font-weight:700">' + (lvN[aL] || '黄色') + '</span> · ' + esc(aTime || '时间不详') + '</p></div>' +
          '<div class="ej-vscell"><h4>相似历史事件</h4><p>' + esc(sim.title) + '</p>' +
            '<p style="color:#7aa5c9;font-size:10.5px;margin-top:6px">' + esc(sim.country || '未标注') + ' · <span style="color:' + (lvC[sL] || '#8fa') + ';font-weight:700">' + (lvN[sL] || '黄色') + '</span> · ' + esc(sTime || '时间不详') + (sim.url ? ' · <a href="' + esc(sim.url) + '" target="_blank" rel="noopener" style="color:#22d3ee">原文</a>' : '') + '</p></div>' +
        '</div>' +
        '<div class="ej-vscon"><h4>自动研判结论（基于真实库字段计算）</h4>' +
          cons.map(function (c) { return '<p>' + c + '</p>'; }).join('') +
        '</div>' +
      '</div>';
    box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
    document.body.appendChild(box);
  },

  /* 公文输出：后端 renderGovHtml 已渲染红头公文（含图表复合分析），开新窗可打印/存 PDF */
  govdoc: function () {
    var d = this._report;
    if (!d || !d.govHtml) { try { showToast('请先完成一次立卷研判'); } catch (e) {} return; }
    var w = window.open('', '_blank', 'width=980,height=1300');
    if (!w) { try { showToast('浏览器拦截了弹出窗口，请允许弹出后重试'); } catch (e) {} return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>事件研判专报</title></head><body style="margin:0;background:#fff">' + d.govHtml + '</body></html>');
    w.document.close();
  }
};
window.EVENTINSIGHT = EVENTINSIGHT;
