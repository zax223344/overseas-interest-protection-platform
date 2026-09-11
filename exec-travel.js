/* ============================================================
 * exec-travel.js — 高管出境风险监测（#753 前端）
 * 孟晚舟式三层闭环：事前预警（提交即扫描红黄绿分级）
 *   × 事中监测（执法动态事件流加权）× 事后复盘（台账归档）
 * 引擎：硬规则 H01-H04（命中即红）+ 六维加权评分（每一分可下钻信源）
 * 数据：/api/exec-travel（人员/行程台账 PG + OpenSanctions 名单 + intel_data 90 天池）
 * ============================================================ */
var EXECTRAVEL = (function () {
  'use strict';

  var _people = [], _trips = [], _rules = null, _dash = null, _scenario = null, _scenarioDirect = null, _sel = null;
  var _inited = false;

  /* ---------- 样式 ---------- */
  if (!document.getElementById('exec-travel-style')) {
    var st = document.createElement('style');
    st.id = 'exec-travel-style';
    st.textContent =
      '#exec-travel-root{padding:14px 16px;color:#c9d8e8;font-size:12px}' +
      '.xt-head{display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(90deg,rgba(124,58,237,.12),rgba(0,212,255,.06));border:1px solid rgba(124,58,237,.3);border-radius:10px;margin-bottom:12px}' +
      '.xt-tt{font-size:17px;font-weight:800;color:#e8f0fb;letter-spacing:1px}' +
      '.xt-sub{font-size:10px;color:#5a7a99}' +
      '.xt-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px}' +
      '.xt-kpi{background:rgba(15,23,42,.65);border:1px solid rgba(0,212,255,.16);border-radius:8px;padding:9px 10px;cursor:pointer}' +
      '.xt-kpi.on{border-color:#7c3aed;box-shadow:0 0 8px rgba(124,58,237,.25)}' +
      '.xt-kpi .v{font-size:20px;font-weight:800;font-family:Consolas,monospace}' +
      '.xt-kpi .l{font-size:10px;color:#5a7a99;margin-top:2px}' +
      '.xt-grid{display:grid;grid-template-columns:340px 1fr 360px;gap:12px;align-items:start}' +
      '.xt-panel{background:rgba(15,23,42,.65);border:1px solid rgba(0,212,255,.14);border-radius:10px;padding:12px;margin-bottom:12px}' +
      '.xt-panel.violet{border-color:rgba(124,58,237,.3)}' +
      '.xt-sec{font-size:13px;font-weight:700;color:#a5f3fc;border-left:3px solid #00d4ff;padding-left:8px;margin-bottom:10px}' +
      '.xt-panel.violet .xt-sec{color:#c4b5fd;border-left-color:#7c3aed}' +
      '.xt-note{font-size:10px;color:#5a7a99;line-height:1.7;padding:6px 8px;background:rgba(255,204,0,.05);border:1px dashed rgba(255,204,0,.22);border-radius:6px;margin-top:8px}' +
      '.xt-note b{color:#ffcc00}' +
      '.xt-person{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(0,212,255,.1);border-radius:6px;margin-bottom:5px;background:rgba(0,0,0,.2)}' +
      '.xt-person .nm{font-weight:700;color:#e2e8f0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.xt-person .ds{font-size:10px;color:#5a7a99}' +
      '.xt-x{color:#ff5577;cursor:pointer;font-weight:700;padding:0 3px}' +
      '.xt-x:hover{color:#ff8899}' +
      '.xt-form{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
      '.xt-form .full{grid-column:1/-1}' +
      '.xt-inp{background:rgba(0,0,0,.35);border:1px solid rgba(0,212,255,.2);border-radius:6px;color:#c9d8e8;padding:6px 8px;font-size:11px;width:100%;box-sizing:border-box;font-family:inherit}' +
      '.xt-inp:focus{outline:none;border-color:#00d4ff}' +
      '.xt-lb{font-size:10px;color:#5a7a99;margin-bottom:2px;display:block}' +
      '.xt-btn{background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.35);color:#67e8f9;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:inherit;font-weight:700}' +
      '.xt-btn:hover{background:rgba(0,212,255,.22)}' +
      '.xt-btn.violet{background:rgba(124,58,237,.14);border-color:rgba(124,58,237,.45);color:#c4b5fd}' +
      '.xt-btn.warn{background:rgba(255,204,0,.1);border-color:rgba(255,204,0,.4);color:#ffcc00}' +
      '.xt-btn.danger{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.45);color:#ff8899}' +
      '.xt-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.xt-trip{border:1px solid rgba(0,212,255,.12);border-radius:8px;padding:9px 10px;margin-bottom:8px;background:rgba(0,0,0,.22);cursor:pointer}' +
      '.xt-trip:hover{border-color:rgba(0,212,255,.35)}' +
      '.xt-trip.open{border-color:#7c3aed}' +
      '.xt-trip .row1{display:flex;align-items:center;gap:8px}' +
      '.xt-trip .nm{font-weight:700;color:#e2e8f0;font-size:13px}' +
      '.xt-trip .rt{font-size:10px;color:#5a7a99}' +
      '.xt-lv{font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px;letter-spacing:1px}' +
      '.xt-lv.red{background:rgba(239,68,68,.16);color:#ff5577;border:1px solid rgba(239,68,68,.45)}' +
      '.xt-lv.yellow{background:rgba(245,158,11,.14);color:#fbbf24;border:1px solid rgba(245,158,11,.4)}' +
      '.xt-lv.green{background:rgba(34,197,94,.13);color:#4ade80;border:1px solid rgba(34,197,94,.4)}' +
      '.xt-sc{font-family:Consolas,monospace;font-weight:800}' +
      '.xt-hr{display:inline-block;font-size:9px;padding:1px 6px;border-radius:3px;margin-right:4px;font-weight:700}' +
      '.xt-hr.hit{background:rgba(239,68,68,.2);color:#ff5577;border:1px solid rgba(239,68,68,.5)}' +
      '.xt-hr.miss{background:rgba(34,197,94,.08);color:#3d5a4a;border:1px solid rgba(34,197,94,.2)}' +
      '.xt-dim{display:flex;align-items:center;gap:6px;margin-bottom:4px}' +
      '.xt-dim .dn{width:110px;font-size:10px;color:#7aa5c9;flex:none}' +
      '.xt-dim .bar{flex:1;height:8px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden}' +
      '.xt-dim .fill{height:100%;border-radius:4px;transition:width .4s}' +
      '.xt-dim .dv{width:56px;text-align:right;font-family:Consolas,monospace;font-size:11px;font-weight:700;flex:none}' +
      '.xt-detail{margin-top:8px;padding:8px;border-top:1px dashed rgba(0,212,255,.15);font-size:11px;line-height:1.8}' +
      '.xt-detail .dsec{font-weight:700;color:#a5f3fc;margin:6px 0 3px}' +
      '.xt-item{display:flex;justify-content:space-between;gap:8px;color:#7aa5c9;padding:1px 4px}' +
      '.xt-item .pts{font-family:Consolas,monospace;color:#ffcc00;flex:none}' +
      '.xt-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}' +
      '.xt-empty{color:#5a7a99;padding:16px 4px;text-align:center;line-height:1.9}' +
      '.xt-sop{font-size:10px;line-height:2;color:#94a8c0}' +
      '.xt-sop b{color:#ffcc00}' +
      '.xt-loading{color:#5a7a99;padding:20px;text-align:center}' +
      '@media(max-width:1280px){.xt-grid{grid-template-columns:1fr}.xt-kpis{grid-template-columns:repeat(3,1fr)}}';
    document.head.appendChild(st);
  }

  /* ---------- 工具 ---------- */
  function _tok() { try { return (typeof APIClient !== 'undefined' && APIClient.getToken) ? APIClient.getToken() : (localStorage.getItem('orps_api_token') || ''); } catch (e) { return ''; } }
  function _api(method, path, body) {
    return fetch('/api/exec-travel' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _tok() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var LV_CN = { red: '红色预警', yellow: '黄色预警', green: '绿色放行' };
  var LV_COLOR = { red: '#ff5577', yellow: '#fbbf24', green: '#4ade80' };
  var TITLE_CN = { ceo: 'CEO/董事长', cto: 'CTO/首席技术官', cfo: 'CFO/首席财务官', vp: 'VP/副总裁', director: '总监', other: '其他' };
  var MEET_CN = { core: '核心机密', internal: '内部', public: '公开' };
  var HR_NAME = { H01: 'H01 制裁名单（人员）', H02: 'H02 过境国引渡×技术敏感', H03: 'H03 过境停留≥4h', H04: 'H04 在途执法案件' };

  /* ---------- 行程卡 ---------- */
  function _tripCard(t) {
    var risk = t.risk || (t.risk_detail ? (typeof t.risk_detail === 'string' ? JSON.parse(t.risk_detail) : t.risk_detail) : null) || {};
    var lv = risk.level || t.risk_level || 'green';
    var open = _sel === t.id;
    var hr = (risk.hardRules || []).map(function (h) {
      return '<span class="xt-hr ' + (h.hit ? 'hit' : 'miss') + '">' + _esc(HR_NAME[h.id] || h.id) + (h.hit ? ' ✕命中' : '') + '</span>';
    }).join('');
    var h =
      '<div class="xt-trip' + (open ? ' open' : '') + '" onclick="EXECTRAVEL.sel(' + t.id + ')">' +
      '<div class="row1">' +
      '<span class="nm">' + _esc(t.person_name || ('#' + t.person_id)) + '</span>' +
      '<span class="rt">→ ' + _esc(t.dest_country) + (t.transit_country && !t.direct_flight ? '（经' + _esc(t.transit_country) + (t.transit_hours ? ' ' + t.transit_hours + 'h' : '') + '）' : '·直飞') + '</span>' +
      '<span class="xt-lv ' + lv + '">' + (LV_CN[lv] || lv) + '</span>' +
      '<span class="xt-sc" style="color:' + (LV_COLOR[lv] || '#4ade80') + '">' + (risk.score != null ? risk.score : (t.risk_score != null ? t.risk_score : '—')) + '分</span>' +
      '<span style="flex:1"></span>' +
      '<span class="rt">' + _esc(String(t.dep_date || '').slice(0, 10) || '') + '</span>' +
      '</div>' +
      '<div style="margin-top:5px">' + hr + '<span class="rt">· ' + _esc(t.person_org || '') + ' · ' + _esc(TITLE_CN[risk.dims && risk.dims.d3 ? '' : ''] || '') + _esc(t.person_org ? '' : '') + '</span></div>';
    if (open && risk.dims) {
      h += '<div class="xt-detail">' +
        '<div class="dsec">六维加权评分（每一分可下钻信源）</div>';
      for (var k = 1; k <= 6; k++) {
        var d = risk.dims['d' + k];
        if (!d) continue;
        var w = Math.round(d.weight * 100);
        var col = d.score >= 75 ? '#ff5577' : d.score >= 55 ? '#fbbf24' : '#4ade80';
        h += '<div class="xt-dim"><span class="dn">' + _esc(d.cn) + ' <span style="color:#5a7a99">' + w + '%</span></span>' +
          '<div class="bar"><div class="fill" style="width:' + d.score + '%;background:' + col + '"></div></div>' +
          '<span class="dv" style="color:' + col + '">' + d.score + '</span></div>';
      }
      h += '<div class="dsec">评分明细（信源下钻）</div>';
      for (var k2 = 1; k2 <= 6; k2++) {
        var dd = risk.dims['d' + k2];
        if (!dd || !dd.items) continue;
        dd.items.forEach(function (it) {
          h += '<div class="xt-item"><span>D' + k2 + '·' + _esc(it.label) + '<span style="color:#3d5570">（' + _esc(it.src) + '）</span></span><span class="pts">+' + it.pts + '</span></div>';
        });
      }
      if (risk.hardRules) {
        h += '<div class="dsec">硬规则判定</div>';
        risk.hardRules.forEach(function (hh) {
          h += '<div style="color:' + (hh.hit ? '#ff8899' : '#5a7a99') + '">' + (hh.hit ? '⛔' : '✔') + ' <b>' + _esc(HR_NAME[hh.id] || hh.id) + '</b>：' + _esc(hh.detail) + (hh.action ? '<br><span style="color:#ffcc00">→ ' + _esc(hh.action) + '</span>' : '') + '</div>';
        });
      }
      if (risk.levelAction) h += '<div class="xt-note"><b>处置动作：</b>' + _esc(risk.levelAction) + '</div>';
      h += '<div class="xt-actions">' +
        '<button class="xt-btn violet" onclick="event.stopPropagation();EXECTRAVEL.rescan(' + t.id + ')">🔄 重新扫描</button>' +
        (t.status === 'submitted' ? '<button class="xt-btn" onclick="event.stopPropagation();EXECTRAVEL.setStatus(' + t.id + ',\'confirmed\')">✅ 复核确认</button>' +
          '<button class="xt-btn danger" onclick="event.stopPropagation();EXECTRAVEL.setStatus(' + t.id + ',\'cancelled\')">🚫 驳回/取消</button>' : '') +
        (t.status !== 'completed' ? '<button class="xt-btn warn" onclick="event.stopPropagation();EXECTRAVEL.setStatus(' + t.id + ',\'completed\')">📦 归档复盘</button>' : '') +
        '<button class="xt-btn danger" onclick="event.stopPropagation();EXECTRAVEL.delTrip(' + t.id + ')">🗑</button>' +
        '</div></div>';
    }
    return h + '</div>';
  }

  /* ---------- 渲染 ---------- */
  function _render() {
    var root = document.getElementById('exec-travel-root');
    if (!root) return;
    if (!_dash && !_rules) { root.innerHTML = '<div class="xt-loading">高管出境风险监测装载中……</div>'; return; }

    var k = _dash ? _dash.kpi : { people: 0, trips: 0, byLevel: {}, byStatus: {}, redOpen: 0 };
    var peopleOpts = _people.map(function (p) { return '<option value="' + p.id + '">' + _esc(p.name) + '（' + _esc(p.org || '未设企业') + '）</option>'; }).join('');

    var h =
      '<div class="xt-head"><div><div class="xt-tt">🛫 高管出境风险监测</div>' +
      '<div class="xt-sub">孟晚舟式三层闭环：事前预警（提交即扫描红黄绿）× 事中监测（执法动态加权）× 事后复盘（台账归档）· 硬规则 H01-H04 命中即红 · 六维评分每一分可下钻信源</div></div>' +
      '<span style="flex:1"></span><button class="xt-btn violet" onclick="EXECTRAVEL.runScenario(false)">📐 孟晚舟式场景测算</button></div>' +

      '<div class="xt-kpis">' +
      '<div class="xt-kpi"><div class="v" style="color:#67e8f9">' + k.people + '</div><div class="l">人员台账</div></div>' +
      '<div class="xt-kpi"><div class="v" style="color:#c4b5fd">' + k.trips + '</div><div class="l">行程总数</div></div>' +
      '<div class="xt-kpi"><div class="v" style="color:#ff5577">' + ((k.byLevel || {}).red || 0) + '</div><div class="l">🔴 红色预警</div></div>' +
      '<div class="xt-kpi"><div class="v" style="color:#fbbf24">' + ((k.byLevel || {}).yellow || 0) + '</div><div class="l">🟡 黄色预警</div></div>' +
      '<div class="xt-kpi"><div class="v" style="color:#4ade80">' + ((k.byLevel || {}).green || 0) + '</div><div class="l">🟢 绿色放行</div></div>' +
      '<div class="xt-kpi"><div class="v" style="color:#ff8899">' + (k.redOpen || 0) + '</div><div class="l">红色待处置</div></div>' +
      '</div>' +

      '<div class="xt-grid"><div>' +
      /* 左列：人员台账 */
      '<div class="xt-panel"><div class="xt-sec">👤 关键人员台账</div>' +
      '<div class="xt-form" style="margin-bottom:10px">' +
      '<div><label class="xt-lb">姓名 *</label><input class="xt-inp" id="xt-p-name" placeholder="如：张伟"></div>' +
      '<div><label class="xt-lb">拼音（名单比对用）</label><input class="xt-inp" id="xt-p-pinyin" placeholder="Zhang Wei"></div>' +
      '<div><label class="xt-lb">职务</label><input class="xt-inp" id="xt-p-title" placeholder="如：首席技术官"></div>' +
      '<div><label class="xt-lb">所属企业（35 企）</label><input class="xt-inp" id="xt-p-org" placeholder="如：华为"></div>' +
      '<div class="full"><label class="xt-lb">技术方向（敏感度评分口径）</label><input class="xt-inp" id="xt-p-tech" placeholder="如：5G / 半导体 / 人工智能"></div>' +
      '<div class="full"><button class="xt-btn" onclick="EXECTRAVEL.addPerson()">＋ 新增关键人员</button></div>' +
      '</div>' +
      (_people.length ? _people.map(function (p) {
        return '<div class="xt-person"><span class="nm">' + _esc(p.name) + '</span>' +
          '<span class="ds">' + _esc(TITLE_CN[p.title_level] || p.title || '') + ' · ' + _esc(p.org || '—') + ' · ' + _esc(p.tech_field || '—') + '</span>' +
          '<span class="xt-x" onclick="EXECTRAVEL.delPerson(' + p.id + ')">✕</span></div>';
      }).join('') : '<div class="xt-empty">暂无关键人员——先录入人员再提交行程</div>') +
      '</div>' +
      /* 左列：规则库 */
      (_rules ?
        '<div class="xt-panel violet"><div class="xt-sec">🧭 预警规则引擎（说明书 4.x 口径）</div>' +
        '<div class="dsec" style="color:#ff8899;font-size:11px;font-weight:700;margin-bottom:4px">硬规则（命中即红·不可绕过）</div>' +
        _rules.hardRules.map(function (r) {
          return '<div style="font-size:10px;color:#94a8c0;line-height:1.8"><b style="color:#ff5577">' + _esc(r.id) + '</b> ' + _esc(r.name) + '<br><span style="color:#5a7a99">触发：' + _esc(r.cond) + '</span><br><span style="color:#ffcc00">→ ' + _esc(r.action) + '</span></div>';
        }).join('') +
        '<div class="dsec" style="color:#a5f3fc;font-size:11px;font-weight:700;margin:8px 0 4px">六维加权</div>' +
        '<div style="font-size:10px;color:#94a8c0;line-height:1.9">' + _rules.dims.map(function (d) {
          return 'D' + (d.k.slice(1)) + ' ' + _esc(d.cn) + ' <b style="color:#c4b5fd">' + Math.round(d.w * 100) + '%</b>';
        }).join(' · ') + '</div>' +
        '<div style="font-size:10px;color:#94a8c0;line-height:1.9;margin-top:6px">分级：<span style="color:#ff5577">红 ≥75 或硬规则命中</span> / <span style="color:#fbbf24">黄 55-74</span> / <span style="color:#4ade80">绿 <55</span></div>' +
        '<div class="xt-note">' + _esc(_rules.mengNote) + '</div>' +
        '<div style="font-size:9px;color:#3d5570;margin-top:6px">制裁名单库：' + (_rules.sanc && _rules.sanc.entities ? _rules.sanc.entities.toLocaleString() + ' 实体（OpenSanctions）' : '加载中') + '</div>' +
        '</div>' : '') +
      '</div><div>' +
      /* 中列：行程提交 + 台账 */
      '<div class="xt-panel"><div class="xt-sec">📝 行程提交（提交即扫描）</div>' +
      '<div class="xt-form">' +
      '<div><label class="xt-lb">出差人员 *</label><select class="xt-inp" id="xt-t-person">' + (peopleOpts || '<option value="">请先录入人员</option>') + '</select></div>' +
      '<div><label class="xt-lb">目的地国家 *</label><input class="xt-inp" id="xt-t-dest" placeholder="如：美国"></div>' +
      '<div><label class="xt-lb">过境国（第三国）</label><input class="xt-inp" id="xt-t-transit" placeholder="如：加拿大（直飞留空）"></div>' +
      '<div><label class="xt-lb">过境停留（小时）</label><input class="xt-inp" id="xt-t-hours" type="number" min="0" max="48" placeholder="5"></div>' +
      '<div><label class="xt-lb">出发日期</label><input class="xt-inp" id="xt-t-dep" type="date"></div>' +
      '<div><label class="xt-lb">返回日期</label><input class="xt-inp" id="xt-t-ret" type="date"></div>' +
      '<div><label class="xt-lb">会议敏感级别</label><select class="xt-inp" id="xt-t-meet"><option value="internal">内部</option><option value="core">核心机密</option><option value="public">公开</option></select></div>' +
      '<div style="display:flex;align-items:center;gap:12px;padding-top:16px"><label style="font-size:11px;cursor:pointer"><input type="checkbox" id="xt-t-direct"> 直飞（免过境）</label><label style="font-size:11px;cursor:pointer"><input type="checkbox" id="xt-t-night"> 夜间航班</label></div>' +
      '<div class="full"><button class="xt-btn violet" onclick="EXECTRAVEL.addTrip()" ' + (_people.length ? '' : 'disabled') + '>🚀 提交行程并扫描风险</button></div>' +
      '</div></div>' +
      '<div class="xt-panel"><div class="xt-sec">🗂 行程风险台账 <span style="font-size:10px;color:#5a7a99;font-weight:400">点击卡片展开六维明细 + 信源下钻 + 复核操作</span></div>' +
      (_trips.length ? _trips.map(_tripCard).join('') : '<div class="xt-empty">暂无行程——提交行程即触发硬规则 + 六维扫描</div>') +
      '</div></div><div>' +
      /* 右列：红色聚焦 + SOP + 场景测算 */
      '<div class="xt-panel" style="border-color:rgba(239,68,68,.35)"><div class="xt-sec" style="color:#ff8899;border-left-color:#ef4444">🔴 红色预警聚焦（事中监测）</div>' +
      ((_dash && _dash.redAlerts && _dash.redAlerts.length) ? _dash.redAlerts.map(function (r) {
        return '<div class="xt-trip" style="border-color:rgba(239,68,68,.3)"><div class="row1">' +
          '<span class="nm">' + _esc(r.person_name || '') + '</span><span class="rt">→ ' + _esc(r.dest_country) + (r.transit_country ? '（经' + _esc(r.transit_country) + '）' : '') + '</span>' +
          '<span class="xt-lv red">红色</span><span class="xt-sc" style="color:#ff5577">' + (r.risk_score != null ? r.risk_score : '—') + '分</span></div>' +
          '<div class="rt" style="margin-top:4px">' + _esc(r.person_org || '') + ' · ' + _esc(r.dep_date || '') + ' · ' + _esc(r.status || '') + '</div></div>';
      }).join('') : '<div class="xt-empty">当前无红色待处置行程</div>') +
      '<div class="xt-sop" style="margin-top:8px"><b>红色预警四级响应 SOP：</b><br>T+0 系统命中 → T+15min 安全值班复核（名单消歧：生日/职务/国籍） → T+30min 上报（董事会级） → T+2h 处置（强制改签评估 / 领事保护预沟通 / 应急包下发 / 预案激活）</div>' +
      (_dash ? '<div class="xt-note" style="margin-top:8px"><b>典型场景：</b>' + _esc(_dash.mengNote) + '</div>' : '') +
      '</div>' +
      /* 右列：场景测算 */
      '<div class="xt-panel violet"><div class="xt-sec">📐 孟晚舟式场景测算 <span style="font-size:9px;color:#5a7a99;font-weight:400">规则引擎自检·不入台账</span></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px"><button class="xt-btn violet" onclick="EXECTRAVEL.runScenario(false)">默认场景（经加转机 5h）</button><button class="xt-btn" onclick="EXECTRAVEL.runScenario(true)">对照：改直飞</button></div>' +
      (_scenario ? _scenHtml(_scenario, _scenarioDirect) : '<div class="xt-empty">点击上方按钮测算：CEO · 华为 · 5G 方向 · 赴美<br>默认经加拿大转机停留 5 小时（孟晚舟式致命点 = H02∩H03）</div>') +
      '</div>' +
      '</div></div>';
    root.innerHTML = h;
  }

  function _scenHtml(s, sd) {
    var risk = s.risk || {};
    var lv = risk.level || 'green';
    var hr = (risk.hardRules || []).map(function (h) { return '<span class="xt-hr ' + (h.hit ? 'hit' : 'miss') + '">' + h.id + (h.hit ? '✕' : '') + '</span>'; }).join('');
    var out = '<div class="xt-trip" style="cursor:default"><div class="row1"><span class="nm">' + _esc(s.scenario.person.name) + '</span>' +
      '<span class="xt-lv ' + lv + '">' + (LV_CN[lv] || lv) + '</span><span class="xt-sc" style="color:' + LV_COLOR[lv] + '">' + (risk.score != null ? risk.score : '—') + '分</span></div>' +
      '<div class="rt" style="margin-top:4px">' + _esc(s.scenario.person.org) + ' · ' + _esc(s.scenario.person.tech_field) + ' · ' + _esc(s.scenario.trip.dest_country) + (s.scenario.trip.transit_country ? '（经' + _esc(s.scenario.trip.transit_country) + ' ' + s.scenario.trip.transit_hours + 'h）' : '（直飞）') + '</div>' +
      '<div style="margin-top:5px">' + hr + '</div>';
    if (risk.dims) {
      for (var k = 1; k <= 6; k++) {
        var d = risk.dims['d' + k];
        if (!d) continue;
        var col = d.score >= 75 ? '#ff5577' : d.score >= 55 ? '#fbbf24' : '#4ade80';
        out += '<div class="xt-dim"><span class="dn">D' + k + ' ' + _esc(d.cn) + '</span><div class="bar"><div class="fill" style="width:' + d.score + '%;background:' + col + '"></div></div><span class="dv" style="color:' + col + '">' + d.score + '</span></div>';
      }
    }
    out += '</div>';
    if (sd && sd.risk) {
      var lv2 = sd.risk.level, sc2 = sd.risk.score;
      out += '<div class="xt-note"><b>降险杠杆验证（说明书 5.3）：</b>改直飞后综合分 ' +
        '<b style="color:' + LV_COLOR[lv] + '">' + (risk.score != null ? risk.score : '—') + '</b> → <b style="color:' + LV_COLOR[lv2] + '">' + sc2 + '</b>（' + (LV_CN[lv2] || lv2) + '）。' +
        '行程脆弱点 D4 从 ' + (risk.dims && risk.dims.d4 ? risk.dims.d4.score : '—') + ' 降至 ' + (sd.risk.dims && sd.risk.dims.d4 ? sd.risk.dims.d4.score : '—') +
        '——「消除第三国过境」是最快降险杠杆。</div>';
    }
    return out;
  }

  /* ---------- 数据操作 ---------- */
  function loadAll() {
    _api('GET', '/rules').then(function (d) { if (d && d.ok) { _rules = d; _render(); } }).catch(function () {});
    _api('GET', '/dashboard').then(function (d) { if (d && d.ok) { _dash = d; _render(); } }).catch(function () {});
    _api('GET', '/people').then(function (d) { if (d && d.ok) { _people = d.items || []; _render(); } }).catch(function () {});
    _api('GET', '/trips').then(function (d) { if (d && d.ok) { _trips = d.items || []; _render(); } }).catch(function () {});
  }

  function addPerson() {
    var name = document.getElementById('xt-p-name').value.trim();
    if (!name) { alert('姓名必填'); return; }
    _api('POST', '/people', {
      name: name,
      pinyin: document.getElementById('xt-p-pinyin').value.trim(),
      title: document.getElementById('xt-p-title').value.trim(),
      org: document.getElementById('xt-p-org').value.trim(),
      tech_field: document.getElementById('xt-p-tech').value.trim()
    }).then(function (d) {
      if (d.ok) { ['xt-p-name', 'xt-p-pinyin', 'xt-p-title', 'xt-p-tech'].forEach(function (id) { document.getElementById(id).value = ''; }); loadAll(); }
      else alert('新增失败：' + d.error);
    }).catch(function (e) { alert('请求失败：' + e.message); });
  }

  function delPerson(id) {
    if (!confirm('删除该人员及其全部行程？')) return;
    _api('DELETE', '/people/' + id).then(function (d) { if (d.ok) loadAll(); }).catch(function (e) { alert(e.message); });
  }

  function addTrip() {
    var pid = document.getElementById('xt-t-person').value;
    if (!pid) { alert('请选择出差人员'); return; }
    var dest = document.getElementById('xt-t-dest').value.trim();
    if (!dest) { alert('目的地国家必填'); return; }
    var direct = document.getElementById('xt-t-direct').checked;
    _api('POST', '/trips', {
      person_id: Number(pid), dest_country: dest,
      dest_city: '', transit_country: direct ? '' : document.getElementById('xt-t-transit').value.trim(),
      transit_hours: Number(document.getElementById('xt-t-hours').value || 0),
      dep_date: document.getElementById('xt-t-dep').value, ret_date: document.getElementById('xt-t-ret').value,
      direct_flight: direct, night_flight: document.getElementById('xt-t-night').checked,
      meeting_level: document.getElementById('xt-t-meet').value
    }).then(function (d) {
      if (d.ok) { ['xt-t-dest', 'xt-t-transit', 'xt-t-hours', 'xt-t-dep', 'xt-t-ret'].forEach(function (id) { document.getElementById(id).value = ''; }); _sel = d.item.id; loadAll(); }
      else alert('提交失败：' + d.error);
    }).catch(function (e) { alert('请求失败：' + e.message); });
  }

  function setStatus(id, status) {
    _api('PUT', '/trips/' + id, { status: status }).then(function (d) { if (d.ok) loadAll(); else alert(d.error); }).catch(function (e) { alert(e.message); });
  }

  function rescan(id) {
    _api('POST', '/trips/' + id + '/scan').then(function (d) { if (d.ok) loadAll(); else alert(d.error); }).catch(function (e) { alert(e.message); });
  }

  function delTrip(id) {
    if (!confirm('删除该行程？')) return;
    _api('DELETE', '/trips/' + id).then(function (d) { if (d.ok) { if (_sel === id) _sel = null; loadAll(); } }).catch(function (e) { alert(e.message); });
  }

  function runScenario(direct) {
    _api('POST', '/scenario', direct ? { direct_flight: true, transit_country: '', transit_hours: 0 } : {})
      .then(function (d) {
        if (!d || !d.ok) return;
        if (direct) { _scenarioDirect = d; }
        else {
          _scenario = d; _scenarioDirect = null;
          /* 联动对照：自动补一次直飞测算 */
          _api('POST', '/scenario', { direct_flight: true, transit_country: '', transit_hours: 0 })
            .then(function (d2) { if (d2 && d2.ok) { _scenarioDirect = d2; _render(); } }).catch(function () {});
        }
        _render();
      }).catch(function (e) { alert('测算失败：' + e.message); });
  }

  function sel(id) { _sel = (_sel === id ? null : id); _render(); }

  function init() {
    var root = document.getElementById('exec-travel-root');
    if (!root) return;
    if (_inited && _dash) { _render(); return; }
    _inited = true;
    root.innerHTML = '<div class="xt-loading">高管出境风险监测装载中（制裁名单 70k 实体 + 90 天事件池）……</div>';
    loadAll();
  }

  return {
    init: init, addPerson: addPerson, delPerson: delPerson, addTrip: addTrip,
    setStatus: setStatus, rescan: rescan, delTrip: delTrip, runScenario: runScenario, sel: sel, loadAll: loadAll
  };
})();
