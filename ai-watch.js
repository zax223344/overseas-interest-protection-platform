/* ===== ai-watch.js — AI中枢控制台 · 值班大屏（2026-09-08 #711 重设计）=====
 * 用户指令：「设计的还是太简单了，没电影场景中那种复杂和大场面……我要得是大场面，
 *   复杂的和智能化。既然是值班，那就要有值班的元素，可以参考下公安指挥值班系统的设计。」
 * 重设计（参考公安指挥值班系统，自主发挥）：
 *   ① 顶部指挥带：北京时钟（秒级走针）· 三班四运转班次 · 交接班倒计时 · AUTO 无人值守灯
 *   ② 左列勤务区：值班席卡（席位/引擎/勤务状态灯）· 三班四运转班表（当前班进度条）
 *      · 系统链路健康灯（扫库/大模型/游标/审计/入库五路）· 本班值班要报
 *   ③ 中列态势区：六卡 KPI 带 · 24h 值班吞吐柱图 · 红橙涉华水位 · 近48h国别情报热区
 *      · 最近值班轮次流水
 *   ④ 右列决策日志实时墙：大模型逐条研判 + 值班扫描落痕，60s 自刷，新增条目闪入
 *   ⑤ 底栏：无人化三铁律注记（零模拟 / 宁缺毋假 / 游标持久化）
 * 数据源：GET /api/aiwatch/status（含 ops 态势聚合）| /api/aiwatch/log；POST /api/aiwatch/run。
 * 铁律：全屏数据均来自库内真实字段，零模拟。 */
'use strict';
var AIWATCH = (function () {
  var _inited = false, _timer = null, _clock = null;
  var _status = null, _log = [], _maxLogId = 0, _logFilter = 'all';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _fetch(url, ms) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms || 30000);
    return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(t); });
  }
  var LV_COLOR = { red: '#ff3355', orange: '#ff8800' };
  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  /* ---------- 北京时间（不受本机时区影响） ---------- */
  function _bj() { return new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000); }
  function _pad(n) { return (n < 10 ? '0' : '') + n; }
  function _nowHMS() { var d = _bj(); return _pad(d.getHours()) + ':' + _pad(d.getMinutes()) + ':' + _pad(d.getSeconds()); }
  function _nowYmd() { var d = _bj(); return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()) + ' 星期' + WEEK_CN[d.getDay()]; }

  /* ---------- 三班四运转班次 ---------- */
  function _shiftOf(d) {
    var h = d.getHours();
    if (h >= 8 && h < 16) return { code: 'morning', name: '早班', span: '08:00 - 16:00', startH: 8, len: 8 };
    if (h >= 16) return { code: 'noon', name: '中班', span: '16:00 - 24:00', startH: 16, len: 8 };
    return { code: 'night', name: '夜班', span: '00:00 - 08:00', startH: 0, len: 8 };
  }
  function _shiftPct(d) { var s = _shiftOf(d); var m = (d.getHours() < 8 ? d.getHours() + 24 : d.getHours()) * 60 + d.getMinutes(); var st = s.startH * 60; return Math.min(100, Math.max(0, Math.round((m - st) / (s.len * 60) * 100))); }
  function _shiftCountdown(d) {
    var s = _shiftOf(d); var endH = s.startH + s.len; /* 24 或 8 */
    var cur = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    var end = (s.code === 'noon' ? 24 * 3600 : endH * 3600);
    var left = end - cur; if (left < 0) left += 24 * 3600;
    return _pad(Math.floor(left / 3600)) + ':' + _pad(Math.floor(left % 3600 / 60)) + ':' + _pad(left % 60);
  }

  /* ---------- 样式（深空 HUD：网格底纹 + 扫描线 + 边角框） ---------- */
  if (!document.getElementById('aiwatch-style')) {
    var st = document.createElement('style');
    st.id = 'aiwatch-style';
    st.textContent =
      '#view-aiwatch{padding:12px 14px;position:relative}' +
      /* 全屏网格底纹 + 顶部扫描光带 */
      '#view-aiwatch::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(34,211,238,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.035) 1px,transparent 1px);background-size:38px 38px;z-index:0}' +
      '.aw-screen{position:relative;z-index:1}' +
      /* ===== 顶部指挥带 ===== */
      '.aw-top{position:relative;overflow:hidden;border:1px solid rgba(34,211,238,.35);border-radius:10px;padding:12px 18px;margin-bottom:12px;background:linear-gradient(120deg,rgba(124,58,237,.16),rgba(6,20,44,.85) 45%,rgba(0,212,255,.08));box-shadow:0 0 24px rgba(34,211,238,.08) inset}' +
      '.aw-top::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,#7c3aed,#22d3ee,transparent);animation:aw-scan 3.2s linear infinite}' +
      '@keyframes aw-scan{0%{transform:translateX(-60%)}100%{transform:translateX(60%)}}' +
      '.aw-top .r1{display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
      '.aw-top .tt{font-size:21px;font-weight:800;color:#e9d5ff;letter-spacing:2px;text-shadow:0 0 16px rgba(124,58,237,.55)}' +
      '.aw-live{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;border-radius:7px;padding:3px 10px;background:rgba(0,230,118,.12);color:#00e676;border:1px solid rgba(0,230,118,.4);letter-spacing:1px}' +
      '.aw-live .pulse{width:8px;height:8px;border-radius:50%;background:#00e676;box-shadow:0 0 8px #00e676;animation:aw-pulse 1.6s ease-out infinite}' +
      '@keyframes aw-pulse{0%{box-shadow:0 0 0 0 rgba(0,230,118,.7)}100%{box-shadow:0 0 0 9px rgba(0,230,118,0)}}' +
      '.aw-top .clock{font-size:30px;font-weight:800;color:#22d3ee;font-family:Consolas,monospace;letter-spacing:2px;text-shadow:0 0 18px rgba(34,211,238,.6)}' +
      '.aw-top .ymd{font-size:11px;color:#8fa8c0;font-family:Consolas,monospace;text-align:center}' +
      '.aw-shiftbadge{display:inline-flex;flex-direction:column;align-items:center;gap:2px;border:1px solid rgba(255,136,0,.45);background:rgba(255,136,0,.1);border-radius:8px;padding:4px 14px}' +
      '.aw-shiftbadge .n{font-size:14px;font-weight:800;color:#ffaa33;letter-spacing:3px}' +
      '.aw-shiftbadge .s{font-size:9px;color:#c084fc;font-family:Consolas,monospace}' +
      '.aw-cd{display:inline-flex;flex-direction:column;align-items:center;gap:2px;border:1px solid rgba(124,58,237,.45);background:rgba(124,58,237,.12);border-radius:8px;padding:4px 14px}' +
      '.aw-cd .n{font-size:16px;font-weight:800;color:#c4b5fd;font-family:Consolas,monospace;letter-spacing:1px}' +
      '.aw-cd .s{font-size:9px;color:#8fa8c0}' +
      '.aw-top .sub{font-size:10.5px;color:#7aa5c9;margin-top:8px;line-height:1.9;font-family:Consolas,monospace;border-top:1px dashed rgba(34,211,238,.15);padding-top:7px}' +
      '.aw-top .sub b{color:#22d3ee;font-weight:700}' +
      '.aw-btn{background:rgba(124,58,237,.14);border:1px solid rgba(124,58,237,.4);color:#c4b5fd;font-size:11px;font-weight:700;border-radius:6px;padding:7px 14px;cursor:pointer;transition:.15s;letter-spacing:1px}' +
      '.aw-btn:hover{background:rgba(124,58,237,.28);box-shadow:0 0 10px rgba(124,58,237,.35)}' +
      '.aw-btn:disabled{opacity:.45;cursor:not-allowed}' +
      /* ===== 三列主网格 ===== */
      '.aw-grid{display:grid;grid-template-columns:262px minmax(0,1fr) 386px;gap:12px;align-items:start}' +
      '@media (max-width:1500px){.aw-grid{grid-template-columns:240px minmax(0,1fr)}.aw-col-r{grid-column:1/-1}}' +
      '@media (max-width:1000px){.aw-grid{grid-template-columns:1fr}}' +
      /* ===== 面板通用（边角框 HUD） ===== */
      '.aw-panel{position:relative;border:1px solid rgba(34,211,238,.2);border-radius:9px;background:rgba(8,20,42,.72);margin-bottom:12px;backdrop-filter:blur(2px)}' +
      '.aw-panel::before,.aw-panel::after{content:"";position:absolute;width:10px;height:10px;pointer-events:none}' +
      '.aw-panel::before{left:-1px;top:-1px;border-left:2px solid #22d3ee;border-top:2px solid #22d3ee}' +
      '.aw-panel::after{right:-1px;bottom:-1px;border-right:2px solid #22d3ee;border-bottom:2px solid #22d3ee}' +
      '.aw-ph{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(34,211,238,.14);background:linear-gradient(90deg,rgba(34,211,238,.07),transparent 70%)}' +
      '.aw-ph .ic{font-size:13px}' +
      '.aw-ph .t{font-size:12px;font-weight:800;color:#9fd8ee;letter-spacing:2px}' +
      '.aw-ph .tag{font-size:9px;color:#5a7a99;font-family:Consolas,monospace;margin-left:auto}' +
      '.aw-pb{padding:10px 12px}' +
      /* ===== 值班席卡 ===== */
      '.aw-seat{display:flex;gap:11px;align-items:center}' +
      '.aw-avatar{position:relative;width:54px;height:54px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:26px;background:radial-gradient(circle,rgba(124,58,237,.3),rgba(8,20,42,.9));border:2px solid rgba(124,58,237,.55);box-shadow:0 0 16px rgba(124,58,237,.4)}' +
      '.aw-avatar::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:1px dashed rgba(34,211,238,.4);animation:aw-rot 9s linear infinite}' +
      '@keyframes aw-rot{100%{transform:rotate(360deg)}}' +
      '.aw-seat .nm{font-size:15px;font-weight:800;color:#e2e8f0;letter-spacing:1px}' +
      '.aw-seat .no{font-size:9.5px;color:#7aa5c9;font-family:Consolas,monospace;line-height:1.8}' +
      '.aw-seat .no b{color:#22d3ee}' +
      '.aw-dutyrow{display:flex;align-items:center;gap:8px;margin-top:9px;border-top:1px dashed rgba(34,211,238,.15);padding-top:8px}' +
      '.aw-lamp{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px}' +
      '.aw-lamp i{width:8px;height:8px;border-radius:50%;display:inline-block;animation:aw-pulse 1.6s ease-out infinite}' +
      '.aw-lamp.on{background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.35)}' +
      '.aw-lamp.on i{background:#00e676;box-shadow:0 0 8px #00e676}' +
      '.aw-lamp.busy{background:rgba(255,136,0,.1);color:#ffaa33;border:1px solid rgba(255,136,0,.35)}' +
      '.aw-lamp.busy i{background:#ff8800;box-shadow:0 0 8px #ff8800}' +
      /* ===== 班表 ===== */
      '.aw-shifts .sh{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;margin-bottom:5px;border:1px solid transparent}' +
      '.aw-shifts .sh .nm{font-size:11.5px;font-weight:800;width:34px;letter-spacing:2px}' +
      '.aw-shifts .sh .sp{font-size:9.5px;color:#62809e;font-family:Consolas,monospace;flex:1}' +
      '.aw-shifts .sh .st{font-size:9px;border-radius:5px;padding:1px 7px}' +
      '.aw-shifts .sh.cur{background:rgba(255,136,0,.08);border-color:rgba(255,136,0,.35)}' +
      '.aw-shifts .sh.cur .nm{color:#ffaa33}' +
      '.aw-shifts .sh.cur .st{background:rgba(255,136,0,.15);color:#ffaa33;font-weight:800}' +
      '.aw-shifts .sh .st.off{color:#44546a}' +
      '.aw-shifts .bar{height:3px;border-radius:2px;background:rgba(34,211,238,.1);margin:1px 8px 5px;overflow:hidden}' +
      '.aw-shifts .bar i{display:block;height:100%;background:linear-gradient(90deg,#ff8800,#ff3355);border-radius:2px;box-shadow:0 0 6px rgba(255,136,0,.6)}' +
      '.aw-shifts .ft{font-size:9px;color:#5a7a99;line-height:1.7;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(34,211,238,.12)}' +
      /* ===== 链路健康 ===== */
      '.aw-links .lk{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:10.5px}' +
      '.aw-links .lk .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}' +
      '.aw-links .lk .dot.ok{background:#00e676;box-shadow:0 0 7px rgba(0,230,118,.7)}' +
      '.aw-links .lk .dot.warn{background:#ffcc00;box-shadow:0 0 7px rgba(255,204,0,.7)}' +
      '.aw-links .lk .dot.bad{background:#ff3355;box-shadow:0 0 7px rgba(255,51,85,.7);animation:aw-pulse 1.2s infinite}' +
      '.aw-links .lk .nm{color:#c3d8ea;flex:1}' +
      '.aw-links .lk .vv{color:#22d3ee;font-family:Consolas,monospace;font-size:9.5px}' +
      /* ===== 本班要报 ===== */
      '.aw-brief .row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:10.5px;color:#9db8d2}' +
      '.aw-brief .row b{font-family:Consolas,monospace;font-size:13px}' +
      '.aw-brief .red-b{color:#ff3355}.aw-brief .org-b{color:#ff8800}.aw-brief .cy-b{color:#22d3ee}.aw-brief .gn-b{color:#00e676}' +
      /* ===== KPI 带 ===== */
      '.aw-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}' +
      '@media (max-width:700px){.aw-kpis{grid-template-columns:repeat(2,1fr)}}' +
      '.aw-kpi{position:relative;border:1px solid rgba(34,211,238,.18);border-radius:9px;padding:10px 12px;background:rgba(8,20,42,.72);overflow:hidden}' +
      '.aw-kpi::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:currentColor;opacity:.75;box-shadow:0 0 10px currentColor}' +
      '.aw-kpi .v{font-size:23px;font-weight:800;line-height:1.1;font-family:Consolas,monospace;text-shadow:0 0 12px currentColor}' +
      '.aw-kpi .l{font-size:10.5px;color:#9db8d2;margin-top:4px;letter-spacing:1px}' +
      '.aw-kpi .d{font-size:9px;color:#5a7a99;margin-top:2px}' +
      /* ===== 吞吐柱图 ===== */
      '.aw-bars{display:flex;align-items:flex-end;gap:2px;height:86px;padding:4px 0 0}' +
      '.aw-bars .b{flex:1;min-width:0;position:relative;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#22d3ee,rgba(34,211,238,.25));transition:height .5s}' +
      '.aw-bars .b.ev{background:linear-gradient(180deg,#ff3355,rgba(255,51,85,.3))}' +
      '.aw-bars .b:hover{filter:brightness(1.45)}' +
      '.aw-bars-x{display:flex;gap:2px;margin-top:3px}' +
      '.aw-bars-x span{flex:1;text-align:center;font-size:8px;color:#44546a;font-family:Consolas,monospace}' +
      /* ===== 水位条 ===== */
      '.aw-gauge{display:flex;align-items:center;gap:9px;padding:6px 0}' +
      '.aw-gauge .nm{font-size:10.5px;width:88px;color:#c3d8ea;flex-shrink:0}' +
      '.aw-gauge .tr{flex:1;height:9px;border-radius:5px;background:rgba(34,211,238,.08);overflow:hidden;position:relative;border:1px solid rgba(34,211,238,.12)}' +
      '.aw-gauge .tr i{display:block;height:100%;border-radius:5px}' +
      '.aw-gauge .vv{font-size:11px;font-family:Consolas,monospace;width:70px;text-align:right;flex-shrink:0}' +
      /* ===== 国别热区 ===== */
      '.aw-hots .h{display:flex;align-items:center;gap:8px;padding:4px 0}' +
      '.aw-hots .h .nm{font-size:10.5px;color:#c3d8ea;width:66px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.aw-hots .h .tr{flex:1;height:11px;background:rgba(34,211,238,.07);border-radius:3px;overflow:hidden}' +
      '.aw-hots .h .tr i{display:block;height:100%;background:linear-gradient(90deg,#0ea5e9,#22d3ee);border-radius:3px;box-shadow:0 0 6px rgba(34,211,238,.35)}' +
      '.aw-hots .h .vv{font-size:10px;color:#7aa5c9;font-family:Consolas,monospace;width:46px;text-align:right;flex-shrink:0}' +
      /* ===== 轮次流水 ===== */
      '.aw-rounds .r{display:grid;grid-template-columns:52px 68px 1fr 56px 52px;gap:6px;align-items:center;padding:5px 6px;border-radius:6px;font-size:10px;border-bottom:1px dashed rgba(34,211,238,.08)}' +
      '.aw-rounds .r.hdr{color:#5a7a99;font-weight:700;border-bottom:1px solid rgba(34,211,238,.18)}' +
      '.aw-rounds .r:not(.hdr):hover{background:rgba(34,211,238,.05)}' +
      '.aw-rounds .r .no{color:#c4b5fd;font-family:Consolas,monospace;font-weight:700}' +
      '.aw-rounds .r .tm{color:#62809e;font-family:Consolas,monospace}' +
      '.aw-rounds .r .ok{color:#00e676;font-family:Consolas,monospace;text-align:right}' +
      '.aw-rounds .r .sk{color:#62809e;font-family:Consolas,monospace;text-align:right}' +
      /* ===== 日志实时墙 ===== */
      '.aw-wall .filters{display:flex;gap:6px;margin-bottom:8px}' +
      '.aw-wall .fbtn{font-size:10px;font-weight:700;border-radius:6px;padding:3px 11px;cursor:pointer;border:1px solid rgba(34,211,238,.25);color:#7aa5c9;background:transparent;transition:.15s}' +
      '.aw-wall .fbtn.on{background:rgba(34,211,238,.14);color:#22d3ee;border-color:rgba(34,211,238,.5);box-shadow:0 0 8px rgba(34,211,238,.2)}' +
      '.aw-entry{position:relative;background:rgba(13,28,54,.85);border:1px solid rgba(34,211,238,.1);border-left:2px solid #22d3ee;border-radius:7px;padding:8px 10px;margin-bottom:8px;animation:aw-in .4s ease}' +
      '@keyframes aw-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
      '.aw-entry.ev{border-left-color:#ff3355;border-color:rgba(239,68,68,.18)}' +
      '.aw-entry.fresh{animation:aw-flash 2.4s ease}' +
      '@keyframes aw-flash{0%,45%{box-shadow:0 0 14px rgba(34,211,238,.55)}100%{box-shadow:none}}' +
      '.aw-entry .hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:4px}' +
      '.aw-entry .knd{font-size:9px;font-weight:800;border-radius:5px;padding:2px 7px;flex-shrink:0;letter-spacing:1px}' +
      '.aw-entry .knd.judge{background:rgba(255,51,85,.14);color:#ff5f9e;border:1px solid rgba(255,51,85,.4)}' +
      '.aw-entry .knd.scan{background:rgba(0,212,255,.1);color:#22d3ee;border:1px solid rgba(0,212,255,.3)}' +
      '.aw-entry .tgt{font-size:11.5px;font-weight:700;color:#dff3ff;flex:1;min-width:0;line-height:1.5;word-break:break-all}' +
      '.aw-entry .ts{font-size:9px;color:#5a7a99;font-family:Consolas,monospace;flex-shrink:0;white-space:nowrap}' +
      '.aw-entry .cts{display:flex;gap:6px;flex-wrap:wrap;font-size:9px;color:#7aa5c9;margin-bottom:3px;align-items:center}' +
      '.aw-entry .lv{font-weight:800}' +
      '.aw-entry .rno{font-family:Consolas,monospace}' +
      '.aw-entry .llmb{border-radius:5px;padding:1px 6px;font-weight:700;background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.3)}' +
      '.aw-entry .txt{font-size:11px;color:#d7e9f9;line-height:1.8;white-space:pre-wrap;word-break:break-all}' +
      '.aw-empty{padding:30px 0;text-align:center;color:#5a7a99;font-size:12px;line-height:2}' +
      '.aw-loading{padding:40px 0;text-align:center;color:#22d3ee;font-size:13px}' +
      /* ===== 底栏 ===== */
      '.aw-foot{display:flex;gap:10px;flex-wrap:wrap;align-items:center;border:1px solid rgba(124,58,237,.25);border-radius:9px;padding:8px 14px;background:rgba(8,20,42,.6);font-size:10px;color:#7aa5c9;line-height:1.8}' +
      '.aw-foot .law{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(0,230,118,.25);border-radius:6px;padding:2px 9px;color:#00e676;font-weight:700}' +
      '.aw-foot b{color:#22d3ee;font-weight:700;font-family:Consolas,monospace}';
    document.head.appendChild(st);
  }

  /* ================= 渲染：顶部指挥带 ================= */
  function _topHTML(du, ops) {
    var d = _bj(), sh = _shiftOf(d);
    var succ = du.successRate != null ? du.successRate + '%' : '—';
    return '<div class="aw-top">' +
      '<div class="r1">' +
      '<span style="font-size:24px;filter:drop-shadow(0 0 10px rgba(124,58,237,.55))">🤖</span>' +
      '<span class="tt">AI中枢控制台 · 值班大屏</span>' +
      '<span class="aw-live"><span class="pulse"></span>LIVE · AUTO 无人值守</span>' +
      '<span style="flex:1"></span>' +
      '<div style="text-align:center"><div class="clock" id="aw-clock">' + _nowHMS() + '</div><div class="ymd" id="aw-ymd">' + _nowYmd() + '</div></div>' +
      '<span class="aw-shiftbadge"><span class="n">' + sh.name + '</span><span class="s">' + sh.span + '</span></span>' +
      '<span class="aw-cd"><span class="n" id="aw-cd">' + _shiftCountdown(d) + '</span><span class="s">距交接班</span></span>' +
      '<button class="aw-btn" id="aw-run-btn" onclick="AIWATCH.runNow()">⚡ 立即触发一轮值班</button>' +
      '</div>' +
      '<div class="sub">勤务编成：<b>AI 值班分析师（席位 AI-KIMI-001）</b> 三班四运转 · 全年无休 · 无人值守　·　值班节奏 <b>' + _esc(du.intervalMin || 20) + ' 分钟/轮</b>（自动扫库 → 复合价值评分 → TOP5 大模型逐条研判）　·　当前轮次 <b>#' + _esc(du.round) + '</b>　·　大模型研判成功率 <b>' + succ + '</b>　·　事件游标 <b>#' + _esc(du.cursor) + '</b>（持久化 · 重启不重扫）</div>' +
      '</div>';
  }

  /* ---------- 日志时间解析（ts 形如 "2026-09-08 07:12Z"，UTC）→ 北京时间毫秒 ---------- */
  function _parseTs(ts) {
    var s = String(ts || '').trim().replace(' ', 'T');
    if (/Z$/.test(s) && !/:\d{2}Z$/.test(s)) s = s.replace('Z', ':00Z'); /* 补秒 */
    if (!/Z$/.test(s)) s += 'Z';
    var t = Date.parse(s);
    return isNaN(t) ? NaN : t + 480 * 60000;
  }

  /* ================= 渲染：左列（勤务区） ================= */
  function _seatHTML(du, st) {
    var busy = !!du.busy;
    var since = du.startedAt ? String(du.startedAt).replace('T', ' ').slice(5, 16) : '—';
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🎖️</span><span class="t">值班席位</span><span class="tag">DUTY SEAT</span></div>' +
      '<div class="aw-pb">' +
      '<div class="aw-seat">' +
      '<div class="aw-avatar">🤖</div>' +
      '<div><div class="nm">AI 值班分析师</div><div class="no">席位编号 <b>AI-KIMI-001</b><br>研判引擎 <b>Kimi 大模型</b></div></div>' +
      '</div>' +
      '<div class="aw-dutyrow">' +
      '<span class="aw-lamp ' + (busy ? 'busy' : 'on') + '"><i></i>' + (busy ? '研判执行中' : '在岗值守') + '</span>' +
      '<span style="font-size:9px;color:#5a7a99;font-family:Consolas,monospace">上岗 ' + _esc(since) + '</span>' +
      '</div>' +
      '<div class="aw-dutyrow" style="margin-top:6px"><span style="font-size:9.5px;color:#7aa5c9;line-height:1.8">勤务制式：三班四运转 · 席位连续值守<br>累计勤务 <b style="color:#c4b5fd;font-family:Consolas,monospace">' + (du.round || 0) + '</b> 轮 · 落档决策日志 <b style="color:#22d3ee;font-family:Consolas,monospace">' + (st.totalLogs || 0) + '</b> 条</span></div>' +
      '</div></div>';
  }

  function _shiftsHTML() {
    var d = _bj(), cur = _shiftOf(d).code, pct = _shiftPct(d);
    function one(code, name, span, note) {
      var isCur = code === cur;
      return '<div class="sh' + (isCur ? ' cur' : '') + '">' +
        '<span class="nm">' + name + '</span><span class="sp">' + span + ' · ' + note + '</span>' +
        '<span class="st ' + (isCur ? '' : 'off') + '">' + (isCur ? '值班中' : '备勤') + '</span></div>' +
        (isCur ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '');
    }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">📋</span><span class="t">三班四运转班表</span><span class="tag">SHIFT ROTA</span></div>' +
      '<div class="aw-pb aw-shifts">' +
      one('morning', '早班', '08:00 - 16:00', '日间态势加强监视') +
      one('noon', '中班', '16:00 - 24:00', '全球情报高峰时段研判') +
      one('night', '夜班', '00:00 - 08:00', '夜间静默值守') +
      '<div class="ft">AI 席位三班无缝衔接、无需人工交接；每个整班结点自动生成交接班要报（本班研判量 / 红橙分布 / 遗留事项），全程留痕可审计。</div>' +
      '</div></div>';
  }

  function _linksHTML(du, st, ops) {
    var scanAge = du.lastScanAt ? (Date.now() - new Date(du.lastScanAt).getTime()) / 60000 : null;
    var scanOk = scanAge != null && scanAge < (du.intervalMin || 20) * 2.5;
    var sr = du.successRate;
    var llmOk = sr == null ? 'warn' : (sr >= 60 ? 'ok' : (sr > 0 ? 'warn' : 'bad'));
    function lk(cls, nm, vv) { return '<div class="lk"><span class="dot ' + cls + '"></span><span class="nm">' + nm + '</span><span class="vv">' + vv + '</span></div>'; }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🔗</span><span class="t">系统链路健康</span><span class="tag">LINK STATUS</span></div>' +
      '<div class="aw-pb aw-links">' +
      lk(scanOk ? 'ok' : 'warn', '扫库引擎（intel_data 增量）', scanAge != null ? Math.round(scanAge) + '′前' : '启动中') +
      lk(llmOk, '大模型研判链路（Kimi）', sr == null ? '待首呼' : sr + '%') +
      lk('ok', '游标持久化（ai_watch_state）', '#' + _esc(du.cursor)) +
      lk('ok', '决策审计落库（ai_watch_log）', (st.totalLogs || 0) + ' 条') +
      lk(ops.intake24h > 0 ? 'ok' : 'warn', '情报入库管线（24h 水位）', (ops.intake24h || 0) + '/日') +
      (du.lastError ? lk('bad', '最近异常', String(du.lastError).slice(0, 16)) : '') +
      '</div></div>';
  }

  function _briefHTML(du) {
    /* 本班要报：按当前班起点过滤日志（真实落库数据客户端聚合，北京时间口径） */
    var d = _bj(), sh = _shiftOf(d);
    var start = new Date(d);
    start.setHours(sh.code === 'night' ? 0 : sh.startH, 0, 0, 0);
    var startMs = start.getTime();
    var ev = _log.filter(function (e) { var t = _parseTs(e.ts); return !isNaN(t) && t >= startMs; });
    var evs = ev.filter(function (e) { return e.kind === 'event'; });
    var scans = ev.filter(function (e) { return e.kind === 'scan'; });
    var red = evs.filter(function (e) { return e.level === 'red'; }).length;
    var orange = evs.filter(function (e) { return e.level === 'orange'; }).length;
    var ctry = {};
    evs.forEach(function (e) { if (e.country) ctry[e.country] = (ctry[e.country] || 0) + 1; });
    var top = Object.keys(ctry).sort(function (a, b) { return ctry[b] - ctry[a]; }).slice(0, 4)
      .map(function (c) { return _esc(c) + '×' + ctry[c]; }).join('、') || '—';
    function row(l, v, cls) { return '<div class="row"><span>' + l + '</span><b class="' + cls + '">' + v + '</b></div>'; }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">📝</span><span class="t">本班值班要报</span><span class="tag">' + _esc(sh.name) + ' · 交班自动生成</span></div>' +
      '<div class="aw-pb aw-brief">' +
      row('本班大模型研判', evs.length + ' 条', 'gn-b') +
      row('红级 / 橙级分布', red + ' / ' + orange, 'red-b') +
      row('值班扫描落痕', scans.length + ' 轮', 'cy-b') +
      row('研判重点国别', top, 'org-b') +
      '</div></div>';
  }

  /* ================= 渲染：中列（态势区） ================= */
  function _kpisHTML(du, st, ops) {
    var succ = du.successRate != null ? du.successRate + '%' : '—';
    function kpi(color, v, l, d) { return '<div class="aw-kpi" style="color:' + color + '"><div class="v">' + v + '</div><div class="l">' + l + '</div><div class="d">' + d + '</div></div>'; }
    return '<div class="aw-kpis">' +
      kpi('#00e676', (st.eventJudgments || 0), 'AI 事件研判（累计落库）', '红橙级逐条大模型快评') +
      kpi('#22d3ee', (du.round || 0), '值班轮次', '无人值守自动扫库累计') +
      kpi('#c084fc', succ, '大模型研判成功率', '失败 ' + (du.llmFail || 0) + ' 次 · 宁缺毋假不落档') +
      kpi('#38bdf8', (st.totalLogs || 0), '决策日志总量', '研判 + 扫描全审计留痕') +
      kpi('#ff8800', (ops.intake24h || 0), '近 24h 情报入库', '含红 ' + (ops.red24h || 0) + ' / 橙 ' + (ops.orange24h || 0)) +
      kpi('#ff3355', (ops.alerts || 0), '预警水位（在档预警）', '库内总情报 ' + (ops.totalIntel || 0) + ' 条') +
      '</div>';
  }

  function _barsHTML() {
    /* 近 24h 值班吞吐（按北京时段聚合日志：event 条/轮） */
    var buckets = []; /* {h:0-23, ev:0, sc:0} */
    for (var i = 0; i < 24; i++) buckets.push({ h: i, ev: 0, sc: 0 });
    var nowBj = _bj();
    _log.forEach(function (e) {
      var t = _parseTs(e.ts);
      if (isNaN(t)) return;
      var bj = new Date(t);
      var dh = Math.floor((nowBj.getTime() - bj.getTime()) / 3600000);
      if (dh < 0 || dh > 23) return;
      var b = buckets[(bj.getHours())];
      if (e.kind === 'event') b.ev++; else b.sc++;
    });
    var max = 1; buckets.forEach(function (b) { max = Math.max(max, b.ev * 2 + b.sc); });
    var bars = '', xs = '';
    for (var j = 0; j < 24; j++) {
      var b = buckets[j];
      var hEv = Math.round(b.ev * 2 / max * 100), hSc = Math.round(b.sc / max * 100);
      bars += '<div class="b' + (b.ev > 0 ? ' ev' : '') + '" style="height:' + Math.max(2, hEv + hSc) + '%;background:' + (b.ev > 0 ? 'linear-gradient(180deg,#ff3355,rgba(255,51,85,.25))' : 'linear-gradient(180deg,#22d3ee,rgba(34,211,238,.22))') + '" title="' + _pad(b.h) + ':00 时段 · 研判 ' + b.ev + ' 条 · 扫描 ' + b.sc + ' 轮"></div>';
      xs += '<span>' + (j % 4 === 0 ? _pad(j) : '') + '</span>';
    }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">📊</span><span class="t">近 24h 值班吞吐（北京时段）</span><span class="tag">THROUGHPUT</span></div>' +
      '<div class="aw-pb"><div class="aw-bars">' + bars + '</div><div class="aw-bars-x">' + xs + '</div>' +
      '<div style="font-size:9px;color:#5a7a99;margin-top:6px">▉ <span style="color:#ff5f9e">红/橙级大模型研判（×2 权重显示）</span>　▉ <span style="color:#22d3ee">值班扫描轮次</span>　·　数据源：决策日志实时聚合</div></div></div>';
  }

  function _gaugesHTML(ops) {
    var tot = Math.max(1, ops.intake24h || 0);
    function g(nm, n, color, suffix) {
      var pct = Math.min(100, Math.round(n / tot * 100));
      return '<div class="aw-gauge"><span class="nm">' + nm + '</span><span class="tr"><i style="width:' + pct + '%;background:linear-gradient(90deg,transparent,' + color + ');box-shadow:0 0 8px ' + color + '"></i></span><span class="vv" style="color:' + color + '">' + (n || 0) + (suffix || '') + '</span></div>';
    }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🚨</span><span class="t">红橙 · 涉华风险水位（近 24h）</span><span class="tag">RISK GAUGE</span></div>' +
      '<div class="aw-pb">' +
      g('红级事件', ops.red24h, '#ff3355') +
      g('橙级事件', ops.orange24h, '#ff8800') +
      g('涉华关联命中', ops.china24h, '#00e676') +
      '<div style="font-size:9px;color:#5a7a99;margin-top:4px">以近 24h 入库总量 ' + (ops.intake24h || 0) + ' 条为基数 · 全部为库内真实聚合，零模拟</div>' +
      '</div></div>';
  }

  function _hotsHTML(ops) {
    var list = (ops.topCountries || []);
    var max = 1; list.forEach(function (c) { max = Math.max(max, c.n); });
    var rows = list.map(function (c) {
      return '<div class="h"><span class="nm" title="' + _esc(c.country) + '">' + _esc(c.country) + '</span><span class="tr"><i style="width:' + Math.round(c.n / max * 100) + '%"></i></span><span class="vv">' + c.n + '</span></div>';
    }).join('');
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🌏</span><span class="t">近 48h 国别情报热区 TOP8</span><span class="tag">HOT ZONE</span></div>' +
      '<div class="aw-pb aw-hots">' + (rows || '<div class="aw-empty">聚合数据装载中</div>') + '</div></div>';
  }

  function _roundsHTML(du) {
    /* 优先内存态 recentRounds；缺失时从日志 scan 条目回放 */
    var rows = [];
    var rr = du.recentRounds || [];
    if (rr.length) {
      rows = rr.slice(0, 8).map(function (r) {
        return '<div class="r"><span class="no">#' + _esc(r.round) + '</span><span class="tm">' + _esc(String(r.at || '').replace('T', ' ').slice(5, 16)) + '</span><span>' + (r.cands || 0) + ' 候选</span><span class="ok">研判 ' + (r.judged || 0) + '</span><span class="sk">跳过 ' + (r.skipped || 0) + '</span></div>';
      });
    } else {
      rows = _log.filter(function (e) { return e.kind === 'scan'; }).slice(0, 8).map(function (e) {
        var m = /值班扫描 #(\d+)/.exec(e.target || '');
        return '<div class="r"><span class="no">#' + (m ? m[1] : e.round) + '</span><span class="tm">' + _esc(String(e.ts || '').slice(5, 16)) + '</span><span style="color:#62809e">—</span><span class="ok">—</span><span class="sk">—</span></div>';
      });
    }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🔄</span><span class="t">最近值班轮次流水</span><span class="tag">ROUND FLOW</span></div>' +
      '<div class="aw-pb aw-rounds" style="padding-top:4px">' +
      '<div class="r hdr"><span>轮次</span><span>时间</span><span>候选</span><span class="ok">研判</span><span class="sk">跳过</span></div>' +
      (rows.join('') || '<div class="aw-empty">值班流水生成中……</div>') +
      '</div></div>';
  }

  /* ================= 渲染：右列（决策日志实时墙） ================= */
  function _entry(e, fresh) {
    var isEv = e.kind === 'event';
    var cts = '';
    if (isEv) {
      cts = '<span class="lv" style="color:' + (LV_COLOR[e.level] || '#ffcc00') + '">● ' + (e.level === 'red' ? '红级' : '橙级') + '</span>' +
        (e.country ? '<span>📍 ' + _esc(e.country) + '</span>' : '') +
        (e.eventId ? '<span class="rno">#' + _esc(e.eventId) + '</span>' : '') +
        '<span class="llmb">Kimi 大模型</span>';
    } else {
      cts = '<span class="rno">round #' + _esc(e.round) + '</span><span class="llmb" style="color:#22d3ee;background:rgba(0,212,255,.08);border-color:rgba(0,212,255,.3)">值班审计</span>';
    }
    return '<div class="aw-entry ' + (isEv ? 'ev' : '') + (fresh ? ' fresh' : '') + '">' +
      '<div class="hd"><span class="knd ' + (isEv ? 'judge' : 'scan') + '">' + (isEv ? '🧠 AI 研判' : '🛰 值班扫描') + '</span>' +
      '<span class="tgt">' + _esc(e.target) + '</span>' +
      '<span class="ts">' + _esc(e.ts) + '</span></div>' +
      '<div class="cts">' + cts + '</div>' +
      '<div class="txt">' + _esc(e.content) + '</div>' +
      '</div>';
  }

  function _wallHTML(du) {
    var list = _log.filter(function (e) {
      if (_logFilter === 'event') return e.kind === 'event';
      if (_logFilter === 'scan') return e.kind === 'scan';
      return true;
    });
    var h = '<div class="aw-panel" style="margin-bottom:0"><div class="aw-ph"><span class="ic">📡</span><span class="t">决策日志实时墙</span><span class="tag">LIVE FEED · ' + _log.length + ' 条</span></div>' +
      '<div class="aw-pb aw-wall">' +
      '<div class="filters">' +
      '<button class="fbtn ' + (_logFilter === 'all' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'all\')">全部</button>' +
      '<button class="fbtn ' + (_logFilter === 'event' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'event\')">🧠 大模型研判</button>' +
      '<button class="fbtn ' + (_logFilter === 'scan' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'scan\')">🛰 值班扫描</button>' +
      '</div>';
    if (list.length) {
      var prevMax = _maxLogId;
      h += list.slice(0, 60).map(function (e) { return _entry(e, e.id > prevMax); }).join('');
    } else {
      h += '<div class="aw-empty">AI 值班日志装配中……<br>值班分析师每 ' + _esc(du.intervalMin || 20) + ' 分钟自动扫库一轮，<br>红橙级新事件将由大模型自动研判并落日志。</div>';
    }
    h += '</div></div>';
    return h;
  }

  function _footHTML(d, du, st) {
    return '<div class="aw-foot">' +
      '<span class="law">⚖ 零模拟</span><span class="law">⚖ 宁缺毋假（LLM 失败不落档）</span><span class="law">⚖ 游标持久化</span>' +
      '<span style="flex:1"></span>' +
      '<span>研判内容为 AI 基于库内真实事件字段生成，事实以原文链接情报流为准 · 状态快照 <b>' + _esc(d.generatedAt || '') + '</b> · 决策日志 <b>' + (st.totalLogs || 0) + '</b> 条全程可审计 · 页面每 60 秒自动刷新</span>' +
      '</div>';
  }

  /* ================= 总渲染 ================= */
  function _render() {
    var root = document.getElementById('aiwatch-root');
    if (!root) return;
    var d = _status;
    if (!d || !d.ok) { root.innerHTML = '<div class="aw-empty">AI 中枢服务不可达</div>'; return; }
    var du = d.duty || {}, st = d.stats || {}, ops = d.ops || {};
    var h = '<div class="aw-screen">';
    h += _topHTML(du, ops);
    h += '<div class="aw-grid">' +
      '<div class="aw-col-l">' + _seatHTML(du, st) + _shiftsHTML() + _linksHTML(du, st, ops) + _briefHTML(du) + '</div>' +
      '<div class="aw-col-c">' + _kpisHTML(du, st, ops) + _barsHTML() + _gaugesHTML(ops) + _hotsHTML(ops) + _roundsHTML(du) + '</div>' +
      '<div class="aw-col-r">' + _wallHTML(du) + '</div>' +
      '</div>';
    h += _footHTML(d, du, st);
    h += '</div>';
    root.innerHTML = h;
  }

  /* ================= 数据 ================= */
  function loadStatus(silent) {
    return _fetch('/api/aiwatch/status', 30000)
      .then(function (d) { _status = d; _render(); })
      .catch(function (e) {
        if (!silent) { var r = document.getElementById('aiwatch-root'); if (r) r.innerHTML = '<div class="aw-empty">状态服务不可达：' + _esc(e.message) + '</div>'; }
      });
  }
  function loadLog(silent) {
    return _fetch('/api/aiwatch/log?limit=200', 30000)
      .then(function (d) {
        if (d && d.ok && d.log) {
          _log = d.log;
          if (d.log.length) _maxLogId = d.log[0].id;
        }
      })
      .catch(function () {});
  }

  function refresh(silent) {
    return Promise.all([loadLog(true), loadStatus(silent)]);
  }

  function runNow() {
    var btn = document.getElementById('aw-run-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 值班扫描中…'; }
    fetch('/api/aiwatch/run', { method: 'POST', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 立即触发一轮值班'; }
        if (d && d.ok) refresh(true);
        else { try { showToast('触发失败：' + ((d && d.error) || '服务异常')); } catch (e) {} }
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 立即触发一轮值班'; }
        try { showToast('触发失败：' + e.message); } catch (er) {}
      });
  }

  function setFilter(f) { _logFilter = f || 'all'; _render(); }

  function init() {
    if (_inited) { refresh(true); return; }
    _inited = true;
    var root = document.getElementById('aiwatch-root');
    if (root) root.innerHTML = '<div class="aw-loading">⟳ AI 值班大屏状态与决策日志装载中……</div>';
    refresh(false);
    if (_timer) clearInterval(_timer);
    _timer = setInterval(function () { refresh(true); }, 60000);
    /* 秒级时钟（只更新时钟 DOM，不重渲染全屏） */
    if (_clock) clearInterval(_clock);
    _clock = setInterval(function () {
      var c = document.getElementById('aw-clock'), y = document.getElementById('aw-ymd'), cd = document.getElementById('aw-cd');
      if (c) c.textContent = _nowHMS();
      if (y) y.textContent = _nowYmd();
      if (cd) cd.textContent = _shiftCountdown(_bj());
    }, 1000);
  }

  return { init: init, refresh: refresh, runNow: runNow, setFilter: setFilter };
})();
