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
  var _inited = false, _timer = null, _clock = null, _toolTimer = null;
  var _status = null, _log = [], _maxLogId = 0, _logFilter = 'all';
  var _tools = {};   /* #720 深度工具值班矩阵：各 AI 引擎最近产出（真实端点探测） */

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
      /* ===== #720 AI 深度工具值班矩阵 ===== */
      '.aw-tools .tl{display:grid;grid-template-columns:1fr;gap:6px}' +
      '.aw-tools .tool{position:relative;display:grid;grid-template-columns:26px 1fr auto;grid-template-rows:auto auto;gap:1px 8px;align-items:center;border:1px solid rgba(34,211,238,.12);border-radius:7px;padding:6px 8px;background:rgba(13,28,54,.6);transition:.15s}' +
      '.aw-tools .tool:hover{border-color:rgba(34,211,238,.4);background:rgba(34,211,238,.06)}' +
      '.aw-tools .tool .ic{grid-row:1/3;font-size:15px;text-align:center;filter:drop-shadow(0 0 6px rgba(34,211,238,.5))}' +
      '.aw-tools .tool .nm{font-size:11px;font-weight:700;color:#dff3ff;letter-spacing:.5px}' +
      '.aw-tools .tool .lg{display:flex;align-items:center;gap:5px;font-size:8.5px;color:#7aa5c9;font-family:Consolas,monospace;grid-column:2/4}' +
      '.aw-tools .tool .st{grid-row:1/3;align-self:center;font-size:9px;font-weight:800;border-radius:5px;padding:2px 7px;letter-spacing:1px;flex-shrink:0}' +
      '.aw-tools .tool .st.on{background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.35)}' +
      '.aw-tools .tool .st.idle{background:rgba(255,204,0,.08);color:#ffcc00;border:1px solid rgba(255,204,0,.3)}' +
      '.aw-tools .tool .st.off{background:rgba(255,51,85,.08);color:#ff5577;border:1px solid rgba(255,51,85,.3)}' +
      '.aw-tools .tool .st.run{background:rgba(255,136,0,.1);color:#ffaa33;border:1px solid rgba(255,136,0,.35);animation:aw-pulse 1.4s infinite}' +
      '.aw-tools .eng{display:inline-block;border-radius:4px;padding:0 5px;font-size:8px;font-weight:700;letter-spacing:.5px}' +
      '.aw-tools .eng.kimi{background:rgba(124,58,237,.16);color:#c4b5fd;border:1px solid rgba(124,58,237,.4)}' +
      '.aw-tools .eng.rule{background:rgba(90,122,153,.12);color:#8fa8c0;border:1px solid rgba(90,122,153,.35)}' +
      '.aw-tools .ft{font-size:8.5px;color:#5a7a99;line-height:1.7;margin-top:7px;padding-top:6px;border-top:1px dashed rgba(34,211,238,.12)}' +
      /* ===== #720 AI 研判深度指标 ===== */
      '.aw-dm .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
      '.aw-dm .cell{border:1px solid rgba(124,58,237,.18);border-radius:7px;padding:7px 9px;background:linear-gradient(135deg,rgba(124,58,237,.07),rgba(8,20,42,.5))}' +
      '.aw-dm .cell .v{font-size:17px;font-weight:800;font-family:Consolas,monospace;color:#e2e8f0;text-shadow:0 0 10px rgba(124,58,237,.5);line-height:1.2}' +
      '.aw-dm .cell .v small{font-size:9px;color:#7aa5c9;font-weight:400}' +
      '.aw-dm .cell .l{font-size:9px;color:#8fa8c0;margin-top:3px;letter-spacing:.5px;line-height:1.5}' +
      '.aw-dm .cell.hot{border-color:rgba(255,51,85,.25)}' +
      '.aw-dm .ft{font-size:8.5px;color:#5a7a99;line-height:1.7;margin-top:7px;padding-top:6px;border-top:1px dashed rgba(124,58,237,.15)}' +
      /* ===== #721 结构化风险预测清单 ===== */
      '.aw-fc .row{position:relative;border:1px solid rgba(34,211,238,.12);border-radius:7px;padding:6px 8px;margin-bottom:6px;background:rgba(13,28,54,.6);transition:.15s}' +
      '.aw-fc .row:hover{border-color:rgba(34,211,238,.4);background:rgba(34,211,238,.06)}' +
      '.aw-fc .row.up{border-left:3px solid #ff3355}' +
      '.aw-fc .row.down{border-left:3px solid #00e676}' +
      '.aw-fc .row.flat{border-left:3px solid #22d3ee}' +
      '.aw-fc .r1{display:flex;align-items:center;gap:6px}' +
      '.aw-fc .nm{font-size:11.5px;font-weight:800;color:#e9f6ff;letter-spacing:.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.aw-fc .dir{font-size:11px;font-weight:800;font-family:Consolas,monospace;flex-shrink:0}' +
      '.aw-fc .dir.up{color:#ff3355;text-shadow:0 0 8px rgba(255,51,85,.5)}' +
      '.aw-fc .dir.down{color:#00e676;text-shadow:0 0 8px rgba(0,230,118,.5)}' +
      '.aw-fc .dir.flat{color:#22d3ee}' +
      '.aw-fc .conf{font-size:8.5px;font-weight:800;border-radius:4px;padding:1px 6px;letter-spacing:1px;flex-shrink:0}' +
      '.aw-fc .conf.h{background:rgba(255,51,85,.12);color:#ff5577;border:1px solid rgba(255,51,85,.4)}' +
      '.aw-fc .conf.m{background:rgba(255,136,0,.1);color:#ffaa33;border:1px solid rgba(255,136,0,.35)}' +
      '.aw-fc .conf.l{background:rgba(90,122,153,.12);color:#8fa8c0;border:1px solid rgba(90,122,153,.35)}' +
      '.aw-fc .dom{font-size:9px;color:#c084fc;margin-top:3px;letter-spacing:.5px}' +
      '.aw-fc .basis{font-size:8.5px;color:#7aa5c9;margin-top:2px;font-family:Consolas,monospace;line-height:1.5}' +
      '.aw-fc .bsb{display:inline-block;margin-left:6px;padding:0 6px;border:1px dashed rgba(255,136,0,.55);border-radius:4px;color:#ff9a3c;font-size:8.5px;vertical-align:1px;white-space:nowrap}' +
      '.aw-fc .hb{display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;font-size:8.5px;font-weight:700;vertical-align:1px;white-space:nowrap;cursor:help}' +
      '.aw-fc .hb.g{background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.4)}' +
      '.aw-fc .hb.w{background:rgba(255,136,0,.1);color:#ffaa33;border:1px solid rgba(255,136,0,.35)}' +
      '.aw-fc .trig{font-size:8.5px;color:#5a7a99;margin-top:2px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.aw-fc .trig b{color:#ffaa33;font-weight:700}' +
      '.aw-fc .more{font-size:9px;color:#5a7a99;text-align:center;padding:3px 0;letter-spacing:1px}' +
      '.aw-fc .row{cursor:pointer}' +
      '.aw-fc .chev{font-size:9px;color:#5a7a99;flex-shrink:0;transition:transform .15s}' +
      '.aw-fc .row.open .chev{color:#22d3ee;transform:rotate(90deg)}' +
      '.aw-fc .hint{font-size:8.5px;color:#ffaa33;letter-spacing:.5px;margin-left:auto;flex-shrink:0}' +
      '.aw-fc .exp{margin-top:6px;padding-top:6px;border-top:1px dashed rgba(34,211,238,.2)}' +
      '.aw-fc .seg{display:flex;gap:6px;margin-bottom:5px}' +
      '.aw-fc .seg .sl{flex-shrink:0;font-size:8.5px;font-weight:800;color:#c084fc;border:1px solid rgba(192,132,252,.4);border-radius:4px;padding:1px 6px;height:fit-content;letter-spacing:2px}' +
      '.aw-fc .seg .sv{font-size:9.5px;color:#c3d9ec;line-height:1.75}' +
      '.aw-fc .pend{font-size:9px;color:#8fa8c0;line-height:1.7}' +
      '.aw-fc .evh{font-size:8.5px;color:#5a7a99;letter-spacing:1.5px;margin:7px 0 4px}' +
      '.aw-fc .ev{display:flex;gap:5px;align-items:baseline;font-size:9px;padding:2.5px 0;border-bottom:1px dotted rgba(34,211,238,.08)}' +
      '.aw-fc .ev:last-child{border-bottom:none}' +
      '.aw-fc .ev .ed{color:#5a7a99;font-family:Consolas,monospace;flex-shrink:0}' +
      '.aw-fc .ev .el{flex-shrink:0;font-size:8px;font-weight:700;border-radius:3px;padding:0 4px;letter-spacing:1px}' +
      '.aw-fc .ev .el.r{background:rgba(255,51,85,.12);color:#ff5577;border:1px solid rgba(255,51,85,.3)}' +
      '.aw-fc .ev .el.o{background:rgba(255,136,0,.12);color:#ffaa33;border:1px solid rgba(255,136,0,.3)}' +
      '.aw-fc .ev .el.n{background:rgba(90,122,153,.12);color:#8fa8c0;border:1px solid rgba(90,122,153,.3)}' +
      '.aw-fc .ev .ec{flex-shrink:0;font-size:8px;font-weight:700;color:#ffaa33}' +
      '.aw-fc .ev .et{color:#a9c6dd;line-height:1.55}' +
      '.aw-fc .ft{font-size:8.5px;color:#5a7a99;line-height:1.7;margin-top:4px;padding-top:6px;border-top:1px dashed rgba(34,211,238,.12)}' +
      '.aw-fc .empty{font-size:10px;color:#7aa5c9;line-height:1.8;text-align:center;padding:10px 4px}' +
      /* ===== #740-2 主题前瞻研判（跨事件主题簇 × 14 天 LLM 前瞻） ===== */
      '.aw-th .row{position:relative;border:1px solid rgba(192,132,252,.2);border-radius:7px;padding:7px 9px;margin-bottom:7px;background:rgba(30,18,54,.55);cursor:pointer;transition:.15s}' +
      '.aw-th .row:hover{border-color:rgba(192,132,252,.5);background:rgba(192,132,252,.07)}' +
      '.aw-th .row.up{border-left:3px solid #ff3355}' +
      '.aw-th .row.down{border-left:3px solid #00e676}' +
      '.aw-th .row.flat{border-left:3px solid #c084fc}' +
      '.aw-th .r1{display:flex;align-items:center;gap:6px}' +
      '.aw-th .nm{font-size:11.5px;font-weight:800;color:#e9d5ff;letter-spacing:.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.aw-th .dlt{font-size:10.5px;font-weight:800;font-family:Consolas,monospace;flex-shrink:0}' +
      '.aw-th .meta{font-size:9px;color:#8fa8c0;margin-top:3px;font-family:Consolas,monospace;letter-spacing:.5px}' +
      '.aw-th .chev{font-size:9px;color:#5a7a99;flex-shrink:0;transition:transform .15s}' +
      '.aw-th .row.open .chev{color:#c084fc;transform:rotate(90deg)}' +
      '.aw-th .engb{display:inline-block;border-radius:4px;padding:0 5px;font-size:8px;font-weight:700;letter-spacing:.5px;flex-shrink:0}' +
      '.aw-th .engb.llm{background:rgba(124,58,237,.16);color:#c4b5fd;border:1px solid rgba(124,58,237,.4)}' +
      '.aw-th .engb.rule{background:rgba(90,122,153,.12);color:#8fa8c0;border:1px solid rgba(90,122,153,.35)}' +
      '.aw-th .exp{margin-top:6px;padding-top:6px;border-top:1px dashed rgba(192,132,252,.25)}' +
      '.aw-th .seg{display:flex;gap:6px;margin-bottom:5px}' +
      '.aw-th .seg .sl{flex-shrink:0;font-size:8.5px;font-weight:800;color:#c084fc;border:1px solid rgba(192,132,252,.4);border-radius:4px;padding:1px 6px;height:fit-content;letter-spacing:2px}' +
      '.aw-th .seg .sv{font-size:9.5px;color:#c3d9ec;line-height:1.75}' +
      '.aw-th .evh{font-size:8.5px;color:#5a7a99;letter-spacing:1.5px;margin:7px 0 4px}' +
      '.aw-th .ev{display:flex;gap:5px;align-items:baseline;font-size:9px;padding:2.5px 0;border-bottom:1px dotted rgba(192,132,252,.1)}' +
      '.aw-th .ev:last-child{border-bottom:none}' +
      '.aw-th .ev .ed{color:#5a7a99;font-family:Consolas,monospace;flex-shrink:0}' +
      '.aw-th .ev .el{flex-shrink:0;font-size:8px;font-weight:700;border-radius:3px;padding:0 4px;letter-spacing:1px}' +
      '.aw-th .ev .el.r{background:rgba(255,51,85,.12);color:#ff5577;border:1px solid rgba(255,51,85,.3)}' +
      '.aw-th .ev .el.o{background:rgba(255,136,0,.12);color:#ffaa33;border:1px solid rgba(255,136,0,.3)}' +
      '.aw-th .ev .el.n{background:rgba(90,122,153,.12);color:#8fa8c0;border:1px solid rgba(90,122,153,.3)}' +
      '.aw-th .ev .ec{flex-shrink:0;font-size:8px;font-weight:700;color:#ffaa33}' +
      '.aw-th .ev .et{color:#a9c6dd;line-height:1.55}' +
      '.aw-th .ft{font-size:8.5px;color:#5a7a99;line-height:1.7;margin-top:7px;padding-top:6px;border-top:1px dashed rgba(192,132,252,.15)}' +
      '.aw-th .empty{font-size:10px;color:#7aa5c9;line-height:1.8;text-align:center;padding:10px 4px}' +
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
    var situ = ev.filter(function (e) { return e.kind === 'situation'; }).length;
    var fc = ev.filter(function (e) { return e.kind === 'forecast'; }).length;
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
      row('态势研判 / 风险预测', situ + ' / ' + fc, 'cy-b') +
      row('值班扫描落痕', scans.length + ' 轮', 'cy-b') +
      row('研判重点国别', top, 'org-b') +
      '</div></div>';
  }

  /* ================= #720 AI 深度工具值班矩阵 =================
   * 真实探测各 AI 研判引擎端点（秒级缓存端点为主），展示在岗状态——零模拟。 */
  function _loadTools() {
    function grab(key, url, ms) {
      return _fetch(url, ms || 20000).then(function (d) {
        if (d && d.ok) _tools[key] = { at: Date.now(), d: d, fail: false };
        else _tools[key] = { at: _tools[key] ? _tools[key].at : 0, d: _tools[key] ? _tools[key].d : null, fail: true };
      }).catch(function () { _tools[key] = { at: _tools[key] ? _tools[key].at : 0, d: _tools[key] ? _tools[key].d : null, fail: true }; })
        .finally(function () { _render(); }); /* 各源独立上屏，先到先显示 */
    }
    grab('terror', '/api/terror/judge?scope=global');
    grab('cnTerror', '/api/terror/china-briefing');
    grab('entrisk', '/api/entrisk/overview', 20000);
    grab('leader', '/api/insight/leader-brief', 65000);
  }

  function _toolsHTML(du, st) {
    var now = Date.now();
    /* 事件/态势/预测三引擎直接来自 ai-watch 状态（同源真实数据） */
    var rows = [];
    function row(ic, nm, sub, engCls, engName, lamp, lampTxt) {
      rows.push('<div class="tool"><span class="ic">' + ic + '</span>' +
        '<span class="nm">' + nm + '</span>' +
        '<span class="st ' + lamp + '">' + lampTxt + '</span>' +
        '<span class="lg"><span class="eng ' + engCls + '">' + engName + '</span>' + sub + '</span></div>');
    }
    var evLast = st.lastEventAt || null, sitLast = st.lastSituationAt || null, fcLast = st.lastForecastAt || null;
    function ageOf(iso) { if (!iso) return null; var t = new Date(String(iso).replace(' ', 'T').replace(/Z$/, '') + 'Z').getTime(); return isNaN(t) ? null : (now - t) / 60000; }
    function lampOf(min, busyMs) { if (min == null) return ['idle', '待首产']; if (min <= 25) return ['on', '在岗']; if (min <= 200) return ['on', '在岗']; return ['idle', '待产出']; }
    var evAge = ageOf(evLast), sitAge = ageOf(sitLast), fcAge = ageOf(fcLast);
    var evL = du.busy ? ['run', '研判中'] : lampOf(evAge);
    row('🧠', '事件研判引擎', (st.eventJudgments || 0) + ' 条落档' + (evAge != null ? ' · ' + (evAge < 60 ? Math.round(evAge) + '′前' : Math.round(evAge / 60) + 'h前') : ''), 'kimi', 'Kimi', evL[0], evL[1]);
    var sitL = sitAge != null && sitAge <= 45 ? ['on', '在岗'] : ['idle', '滚动中'];
    row('🧭', '态势研判引擎', (st.situation || 0) + ' 份通报' + (sitAge != null ? ' · ' + (sitAge < 60 ? Math.round(sitAge) + '′前' : Math.round(sitAge / 60) + 'h前') : ''), 'kimi', 'Kimi', sitL[0], sitL[1]);
    var fcDue = fcAge != null && fcAge <= 200;
    row('🔮', '风险预测引擎', (st.forecast || 0) + ' 份前瞻' + (fcAge != null ? ' · ' + (fcAge < 60 ? Math.round(fcAge) + '′前' : Math.round(fcAge / 60) + 'h前') : '') + ' · 3h 周期', 'kimi', 'Kimi', fcDue ? 'on' : 'idle', fcDue ? '在岗' : '滚动中');
    /* 外部 AI 研判工具（真实端点探测） */
    function extRow(key, ic, nm, genAt, llmOk, extra) {
      var t = _tools[key];
      var have = t && t.d;
      var min = null;
      if (genAt) {
        /* 多格式兼容：2026/9/9 15:34:21（toLocaleString）与 2026年9月9日 15:34 */
        var m = /(\d{4})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})日?\s*(?:[上下]午)?\s*(\d{1,2}):(\d{2})/.exec(String(genAt));
        if (m) { var hh = +m[4]; if (/下午/.test(String(genAt)) && hh < 12) hh += 12; min = (now - new Date(+m[1], +m[2] - 1, +m[3], hh, +m[5]).getTime()) / 60000; }
        else { var p = Date.parse(String(genAt).slice(0, 19).replace(' ', 'T')); if (!isNaN(p)) min = (now - p) / 60000; }
      }
      var lamp = t && t.fail && !have ? ['off', '待探测'] : (min != null && min <= 40 ? ['on', '在岗'] : (have ? ['idle', '缓存中'] : ['idle', '探测中']));
      row(ic, nm, (extra || '') + (min != null ? ' · ' + (min < 60 ? Math.round(min) + '′前' : Math.round(min / 60) + 'h前') : ' · 探测中'),
        llmOk === false ? 'rule' : 'kimi', llmOk === false ? '规则' : 'Kimi', lamp[0], lamp[1]);
    }
    var tT = _tools.terror && _tools.terror.d;
    extRow('terror', '🔴', '反恐态势通报', tT && tT.generatedAt, tT && tT.llmOk, '红头公文 ' + ((tT && tT.govHtml || '').length) + ' 字');
    var tC = _tools.cnTerror && _tools.cnTerror.d;
    extRow('cnTerror', '🇨🇳', '涉华恐袭威胁研判', tC && tC.generatedAt, tC && tC.llmOk, (tC && tC.stats ? '覆盖 ' + (tC.stats.countries || 0) + ' 国' : ''));
    var tE = _tools.entrisk && _tools.entrisk.d;
    extRow('entrisk', '🏢', '涉企风险七域研判', tE && tE.generatedAt, null, (tE && tE.kpi ? '72h 预警 ' + (tE.kpi.alerts72 || 0) + ' 条' : ''));
    var tL = _tools.leader && _tools.leader.d;
    extRow('leader', '📜', '领导要报速览', tL && tL.generatedAt, null, (tL && tL.stats ? '24h 窗口 ' + (tL.stats.total || 0) + ' 条' : ''));
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🧰</span><span class="t">AI 深度工具值班矩阵</span><span class="tag">TOOL MATRIX · ' + rows.length + ' 引擎</span></div>' +
      '<div class="aw-pb aw-tools"><div class="tl">' + rows.join('') + '</div>' +
      '<div class="ft">全平台 AI 研判引擎统一列装值班：事件层逐条快评 → 态势层 20min 滚动 → 预测层 3h 前瞻 → 专项通报（反恐/涉华/涉企/要报）红头公文输出。状态灯按各引擎真实产出时间点亮，每 5 分钟自动巡检一次。</div>' +
      '</div></div>';
  }

  /* ================= #721/#721b 结构化风险预测清单（可交互：点击行展开 AI 细化研判+事件明细） =================
   * 数据源：/api/aiwatch/status 的 forecastItems（ai_forecast_items 表，预测层每 3h 装配覆盖 + 逐国/逐域 LLM 细化）。
   * 行=方向（7d vs 前周真实统计）×幅度×置信度；点击展开：LLM 针对性研判（态势/预测/触发）+ 近7日代表性事件明细。 */
  var _fcOpen = {};   /* 展开态：key=kind|name（_render 后保持） */
  function _forecastHTML() {
    var items = (_status && _status.forecastItems) || [];
    var cItems = items.filter(function (i) { return i.kind === 'country'; });
    var dItems = items.filter(function (i) { return i.kind === 'domain'; });
    var fcLast = (_status && _status.stats && _status.stats.lastForecastAt) || null;
    var ageTxt = '';
    if (fcLast) {
      var t = Date.parse(String(fcLast).slice(0, 19).replace(' ', 'T'));
      if (!isNaN(t)) { var mn = (Date.now() - t) / 60000; ageTxt = mn < 60 ? Math.round(mn) + '′前细化' : Math.round(mn / 60) + 'h前细化'; }
    }
    /* #730 累计对账总览（滚动命中率）：满7天回算 hit/near/miss 全量口径 */
    var fv = (_status && _status.forecastVerify) || null;
    var fvTxt = (fv && fv.total) ? ' · 预测对账累计：命中 ' + fv.hit + '/' + fv.total + '（' + (fv.rate != null ? fv.rate + '%' : '—') + '，方向对/幅度不足 ' + fv.near + '，未命中 ' + fv.miss + '；连续3轮未命中自动降置信度）' : '';
    function arrow(it) {
      var d = it.delta == null ? 0 : it.delta;
      if (it.direction === 'up') return ['up', '↑', (d > 0 ? '+' : '') + d + '%'];
      if (it.direction === 'down') return ['down', '↓', d + '%'];
      return ['flat', '→', '±' + Math.abs(d) + '%'];
    }
    function confCls(c) { return c === '高' ? 'h' : (c === '中' ? 'm' : 'l'); }
    /* #730 对账角标：近4轮命中 x/4（绿=命中率≥50%，橙=低于50%；无对账数据不显示） */
    function hitBadge(it) {
      if (!it.hit4) return '';
      var p = String(it.hit4).split('/');
      var rate = it.hitRate != null ? it.hitRate : 0;
      return '<span class="hb ' + (rate >= 50 ? 'g' : 'w') + '" title="预测对账：近 ' + p[1] + ' 轮满7天回算，命中 ' + p[0] + ' 轮（命中率 ' + rate + '%）；上轮判定=' + (it.lastVerdict === 'hit' ? '命中' : (it.lastVerdict === 'near' ? '方向对/幅度不足' : '未命中')) + '">对账 ' + p[0] + '/' + p[1] + '</span>';
    }
    function lvCls(lv) { return lv === 'red' ? 'r' : (lv === 'orange' ? 'o' : 'n'); }
    function expBlock(it) {
      var d = it.detail;
      var h = '<div class="exp">';
      if (d && d.llm) {
        if (d.s) h += '<div class="seg"><span class="sl">态势</span><div class="sv">' + _esc(d.s) + '</div></div>';
        if (d.p) h += '<div class="seg"><span class="sl">预测</span><div class="sv">' + _esc(d.p) + '</div></div>';
        if (d.t) h += '<div class="seg"><span class="sl">触发</span><div class="sv">' + _esc(d.t).replace(/\n/g, '<br>') + '</div></div>';
      } else if (d && d.s) {
        h += '<div class="seg"><span class="sl">研判</span><div class="sv">' + _esc(d.s) + '</div></div>';
      } else {
        h += '<div class="pend">AI 细化研判生成中——预测层每 3 小时逐国滚动细化（红橙/涉华证据喂给大模型逐国研判；失败自动回落模板并在下轮重试）。</div>';
      }
      var ev = (d && d.ev) || [];
      if (ev.length) {
        h += '<div class="evh">近 7 日代表性事件（红橙/涉华优先）</div>';
        ev.forEach(function (e) {
          h += '<div class="ev"><span class="ed">' + _esc(e.d || '') + '</span>' +
            '<span class="el ' + lvCls(e.lv) + '">' + (e.lv === 'red' ? '红' : (e.lv === 'orange' ? '橙' : '记')) + '</span>' +
            (e.cn ? '<span class="ec">涉华</span>' : '') +
            '<span class="et">' + _esc(e.t || '') + '</span></div>';
        });
      }
      h += '</div>';
      return h;
    }
    function fcRow(it) {
      var a = arrow(it);
      var key = it.kind + '|' + it.name;
      var open = !!_fcOpen[key];
      var domLine = it.kind === 'country'
        ? '<div class="dom">主导风险域：' + _esc(it.topDomain || '其他风险域') + (it.red7 ? ' · <span style="color:#ff5577">红级 ' + it.red7 + '</span>' : '') + (it.china7 ? ' · <span style="color:#ffaa33">涉华 ' + it.china7 + '</span>' : '') + '</div>'
        : '<div class="dom">细分主线：' + _esc(it.topDomain || '—') + (it.china7 ? ' · <span style="color:#ffaa33">涉华 ' + it.china7 + '</span>' : '') + '</div>';
      return '<div class="row ' + a[0] + (open ? ' open' : '') + '" data-fk="' + _esc(key) + '" title="点击展开/收起 AI 细化研判与事件明细">' +
        '<div class="r1"><span class="chev">▶</span><span class="nm">' + _esc(it.name) + '</span>' +
        '<span class="dir ' + a[0] + '">' + a[1] + ' ' + a[2] + '</span>' +
        (it.basisShift ? '<span class="bsb" title="' + _esc(it.basis || '') + '">' + (String(it.basis || '').indexOf('冷启动') >= 0 ? '冷启动' : '口径变化') + '</span>' : '') +
        hitBadge(it) +
        '<span class="conf ' + confCls(it.confidence) + '">' + _esc(it.confidence || '低') + '信</span></div>' +
        domLine +
        '<div class="basis">' + _esc(it.basis || '') + '</div>' +
        '<div class="trig"><b>触发：</b>' + _esc(it.trigger || '事件量超周基线 50% 即验证') + '</div>' +
        (open ? expBlock(it) : '') +
        '</div>';
    }
    function panel(ic, title, tag, list, max, moreTxt) {
      var body;
      if (!list.length) {
        body = '<div class="aw-pb aw-fc"><div class="empty">预测层每 3 小时自动装配结构化清单<br>（近 7 天 vs 前周真实入库对比）</div></div>';
      } else {
        var rows = list.slice(0, max).map(fcRow).join('');
        if (list.length > max) rows += '<div class="more">… 其余 ' + (list.length - max) + ' ' + moreTxt + '</div>';
        body = '<div class="aw-pb aw-fc">' + rows +
          '<div class="ft">方向=近7日 vs 前周<b>可比口径</b>（源恒定子集：新上线源冷启动与断流源已自动剔除）；「口径变化」徽章=该条环比基线覆盖不足半数，幅度仅供参考。触发条件由大模型基于该国/该域真实事件逐条细化——<b style="color:#ffaa33">点击任意条目展开 AI 研判详情与代表性事件</b>；「对账 x/y」徽章=近 y 轮满 7 天回算的预测命中数。' + (ageTxt ? ' · ' + ageTxt : '') + fvTxt + '</div></div>';
      }
      return '<div class="aw-panel"><div class="aw-ph"><span class="ic">' + ic + '</span><span class="t">' + title + '</span><span class="hint">点击展开</span><span class="tag">' + tag + (list.length ? ' · ' + list.length + ' 项' : '') + '</span></div>' + body + '</div>';
    }
    return panel('🗺', '国别风险预测', 'COUNTRY · 7D', cItems, 8, '国详见清单') +
      panel('🏭', '行业风险域预测', 'DOMAIN · 7D', dItems, 5, '域详见清单');
  }

  /* ================= #740-2 主题前瞻研判（可交互：点击行展开 AI 前瞻 + 代表事件） =================
   * 数据源：/api/aiwatch/status 的 themeItems（ai_theme_items 表，主题层每 6h 装配覆盖 + LLM 前瞻）。
   * 行=跨事件主题簇（关税重塑/车企出海/关键矿产/红海要道等）近 7 天真实命中 vs 前周环比。 */
  var _thOpen = {};
  function _themeHTML() {
    var items = (_status && _status.themeItems) || [];
    function lvCls(lv) { return lv === 'red' ? 'r' : (lv === 'orange' ? 'o' : 'n'); }
    function row(it) {
      var open = !!_thOpen[it.key];
      var delta = it.p7 ? Math.round((it.n7 - it.p7) / it.p7 * 100) : null;
      var dCls = delta == null ? 'flat' : (delta >= 20 ? 'up' : (delta <= -20 ? 'down' : 'flat'));
      var dTxt = delta == null ? '新主题' : ((delta > 0 ? '+' : '') + delta + '%');
      var h = '<div class="row ' + dCls + (open ? ' open' : '') + '" data-tk="' + _esc(it.key) + '" title="点击展开/收起 AI 前瞻研判与代表事件">' +
        '<div class="r1"><span class="chev">▶</span><span class="nm">' + _esc(it.name) + '</span>' +
        '<span class="dlt" style="color:' + (dCls === 'up' ? '#ff5577' : (dCls === 'down' ? '#00e676' : '#c084fc')) + '">' + dTxt + '</span>' +
        '<span class="engb ' + (it.llmOk ? 'llm' : 'rule') + '">' + (it.llmOk ? 'Kimi' : '规则') + '</span></div>' +
        '<div class="meta">近7天 ' + it.n7 + ' 条 vs 前周 ' + it.p7 + ' 条 · 涉华 ' + it.china7 + ' · 红级 ' + it.red7 +
        (it.countries ? ' · 国别 ' + _esc(String(it.countries).split('、').slice(0, 3).join(' / ')) : '') + '</div>';
      if (open) {
        var d = it.detail || {};
        h += '<div class="exp">';
        if (d.s) h += '<div class="seg"><span class="sl">态势</span><div class="sv">' + _esc(d.s) + '</div></div>';
        if (d.p) h += '<div class="seg"><span class="sl">预测</span><div class="sv">' + _esc(d.p) + '</div></div>';
        if (d.r) h += '<div class="seg"><span class="sl">风险路径</span><div class="sv">' + _esc(d.r) + '</div></div>';
        if (d.t) h += '<div class="seg"><span class="sl">触发</span><div class="sv">' + _esc(String(d.t).replace(/\n+/g, '<br>')) + '</div></div>';
        var ev = it.events || [];
        if (ev.length) {
          h += '<div class="evh">近 7 天代表事件（红橙/涉华优先）</div>';
          ev.forEach(function (e) {
            h += '<div class="ev"><span class="ed">' + _esc(e.d || '') + '</span>' +
              '<span class="el ' + lvCls(e.lv) + '">' + (e.lv === 'red' ? '红' : (e.lv === 'orange' ? '橙' : '记')) + '</span>' +
              (e.cn ? '<span class="ec">涉华</span>' : '') +
              (e.c ? '<span class="ed">' + _esc(e.c) + '</span>' : '') +
              '<span class="et">' + _esc(e.t || '') + '</span></div>';
          });
        }
        h += '</div>';
      }
      return h + '</div>';
    }
    var body;
    if (!items.length) {
      body = '<div class="aw-pb aw-th"><div class="empty">主题层每 6 小时自动装配：关税重塑 / 车企出海 / 关键矿产 / 红海要道 / 班列走廊 / 制裁合规 等跨事件主题簇 14 天前瞻研判<br>（LLM 前瞻 + 触发信号；无命中主题时静默——宁缺毋假）</div></div>';
    } else {
      body = '<div class="aw-pb aw-th">' + items.map(row).join('') +
        '<div class="ft">主题前瞻 = 跨事件主题簇（关键词 × 近 7 天真实库命中）× 大模型 14 天前瞻研判（态势 / 预测 / 风险路径 / 触发信号）——面向中资企业出海的政策与市场反噬风险（如美国关税重塑贸易背景下中国车企墨西哥市场的政策反噬）。<b style="color:#ffaa33">点击条目展开 AI 研判详情</b>；环比=近7天 vs 前7天同主题命中量。</div></div>';
    }
    return '<div class="aw-panel"><div class="aw-ph"><span class="ic">🎯</span><span class="t">主题前瞻研判（14 天）</span><span class="hint" style="cursor:pointer;color:#e879f9" onclick="AIWATCH.runTheme()">▶ 立即装配</span><span class="tag">THEME FORESIGHT' + (items.length ? ' · ' + items.length + ' 主题' : '') + '</span></div>' + body + '</div>';
  }

  /* ================= 渲染：中列（态势区） ================= */
  function _kpisHTML(du, st, ops) {
    var succ = du.successRate != null ? du.successRate + '%' : '—';
    function kpi(color, v, l, d) { return '<div class="aw-kpi" style="color:' + color + '"><div class="v">' + v + '</div><div class="l">' + l + '</div><div class="d">' + d + '</div></div>'; }
    return '<div class="aw-kpis">' +
      kpi('#00e676', (st.eventJudgments || 0), 'AI 事件研判（累计落库）', '红橙级逐条大模型快评') +
      kpi('#c084fc', (st.situation || 0), 'AI 态势研判（累计）', '每 20 分钟全局态势滚动研判') +
      kpi('#38bdf8', (st.forecast || 0), 'AI 风险预测（累计）', '每 3 小时 7 天前瞻滚动') +
      kpi('#e879f9', (st.theme || 0), 'AI 主题前瞻（累计）', '每 6 小时 14 天跨事件主题研判') +
      kpi('#22d3ee', (du.round || 0), '值班轮次', '无人值守自动扫库累计') +
      kpi('#ff8800', (ops.intake24h || 0), '近 24h 实时入库', '含红 ' + (ops.red24h || 0) + ' / 橙 ' + (ops.orange24h || 0) + '（已排除补采）') +
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
      if (e.kind === 'event' || e.kind === 'situation' || e.kind === 'forecast' || e.kind === 'theme') b.ev++; else b.sc++;
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
    var isSit = e.kind === 'situation';
    var isFc = e.kind === 'forecast';
    var isTh = e.kind === 'theme';
    var cts = '';
    if (isEv) {
      cts = '<span class="lv" style="color:' + (LV_COLOR[e.level] || '#ffcc00') + '">● ' + (e.level === 'red' ? '红级' : '橙级') + '</span>' +
        (e.country ? '<span>📍 ' + _esc(e.country) + '</span>' : '') +
        (e.eventId ? '<span class="rno">#' + _esc(e.eventId) + '</span>' : '') +
        '<span class="llmb">Kimi 大模型</span>';
    } else if (isSit) {
      cts = '<span class="rno">round #' + _esc(e.round) + '</span>' +
        '<span class="llmb" style="color:#c084fc;background:rgba(192,132,252,.08);border-color:rgba(192,132,252,.3)">实时口径 · 24h</span>';
    } else if (isTh) {
      cts = '<span class="rno">round #' + _esc(e.round) + '</span>' +
        '<span class="llmb" style="color:#e879f9;background:rgba(232,121,249,.08);border-color:rgba(232,121,249,.35)">14 天前瞻 · 主题簇</span>';
    } else if (isFc) {
      cts = '<span class="rno">round #' + _esc(e.round) + '</span>' +
        '<span class="llmb" style="color:#38bdf8;background:rgba(56,189,248,.08);border-color:rgba(56,189,248,.3)">近7天 vs 前周</span>';
    } else {
      cts = '<span class="rno">round #' + _esc(e.round) + '</span><span class="llmb" style="color:#22d3ee;background:rgba(0,212,255,.08);border-color:rgba(0,212,255,.3)">值班审计</span>';
    }
    var knd = isEv ? { cls: 'judge', ic: '🧠 AI 研判' }
      : isSit ? { cls: 'judge', ic: '🧭 态势研判' }
      : isTh ? { cls: 'judge', ic: '🎯 主题前瞻' }
      : isFc ? { cls: 'judge', ic: '🔮 风险预测' }
      : { cls: 'scan', ic: '🛰 值班扫描' };
    return '<div class="aw-entry ' + (isEv ? 'ev' : '') + (fresh ? ' fresh' : '') + '">' +
      '<div class="hd"><span class="knd ' + knd.cls + '">' + knd.ic + '</span>' +
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
      if (_logFilter === 'situation') return e.kind === 'situation';
      if (_logFilter === 'forecast') return e.kind === 'forecast';
      if (_logFilter === 'theme') return e.kind === 'theme';
      return true;
    });
    var h = '<div class="aw-panel" style="margin-bottom:0"><div class="aw-ph"><span class="ic">📡</span><span class="t">决策日志实时墙</span><span class="tag">LIVE FEED · ' + _log.length + ' 条</span></div>' +
      '<div class="aw-pb aw-wall">' +
      '<div class="filters">' +
      '<button class="fbtn ' + (_logFilter === 'all' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'all\')">全部</button>' +
      '<button class="fbtn ' + (_logFilter === 'event' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'event\')">🧠 大模型研判</button>' +
      '<button class="fbtn ' + (_logFilter === 'situation' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'situation\')">🧭 态势研判</button>' +
      '<button class="fbtn ' + (_logFilter === 'forecast' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'forecast\')">🔮 风险预测</button>' +
      '<button class="fbtn ' + (_logFilter === 'theme' ? 'on' : '') + '" onclick="AIWATCH.setFilter(\'theme\')">🎯 主题前瞻</button>' +
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
      '<div class="aw-col-l">' + _seatHTML(du, st) + _shiftsHTML() + _linksHTML(du, st, ops) + _briefHTML(du) + _toolsHTML(du, st) + _forecastHTML() + '</div>' +
      '<div class="aw-col-c">' + _kpisHTML(du, st, ops) + _themeHTML() + _barsHTML() + _gaugesHTML(ops) + _hotsHTML(ops) + _roundsHTML(du) + '</div>' +
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

  /* #740 主题层手动装配（6h 自动周期之外的即时触发） */
  function runTheme() {
    try { showToast('🎯 主题前瞻装配已触发：扫描近 7 天主题簇并调用大模型研判（约 1-3 分钟）……'); } catch (e) {}
    fetch('/api/aiwatch/theme-run', { method: 'POST', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { refresh(true); try { showToast('🎯 主题前瞻装配完成：' + (d.items || 0) + ' 个主题已落库'); } catch (e) {} }
        else { try { showToast('主题装配失败：' + ((d && d.error) || '服务异常')); } catch (e) {} }
      })
      .catch(function (e) { try { showToast('主题装配失败：' + e.message); } catch (er) {} });
  }

  function init() {
    if (_inited) { refresh(true); return; }
    _inited = true;
    var root = document.getElementById('aiwatch-root');
    /* #721b 预测清单交互：事件委托（root 上绑定一次，innerHTML 重绘不掉）——点击行展开/收起；#740 主题层同模式 */
    if (root && !root.__awFcBind) {
      root.__awFcBind = true;
      root.addEventListener('click', function (e) {
        var el = e.target;
        var row = el && el.closest ? el.closest('.aw-fc .row[data-fk], .aw-th .row[data-tk]') : null;
        if (!row) return;
        var k = row.getAttribute('data-fk') || row.getAttribute('data-tk');
        if (!k) return;
        if (row.hasAttribute('data-tk')) {
          if (_thOpen[k]) delete _thOpen[k]; else _thOpen[k] = 1;
        } else {
          if (_fcOpen[k]) delete _fcOpen[k]; else _fcOpen[k] = 1;
        }
        _render();
      });
    }
    if (root) root.innerHTML = '<div class="aw-loading">⟳ AI 值班大屏状态与决策日志装载中……</div>';
    refresh(false);
    /* #720 深度工具矩阵巡检：进视图 4s 后首巡（错峰），此后每 5 分钟一次 */
    setTimeout(function () { _loadTools(); }, 4000);
    if (_toolTimer) clearInterval(_toolTimer);
    _toolTimer = setInterval(function () { _loadTools(); }, 5 * 60 * 1000);
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

  return { init: init, refresh: refresh, runNow: runNow, setFilter: setFilter, runTheme: runTheme };
})();
