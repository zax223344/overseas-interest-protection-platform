/* ============================================================
 * 应急指挥中心 Emergency Response Center (2026-08-27)
 * ------------------------------------------------------------
 * 用途：风险监测中心底部「应急指南」实战化重设计
 * 设计原则：
 *   - 以国家为轴心，实时风险驱动；
 *   - 以项目为锚点，给出可操作的撤离/避险/联络方案；
 *   - 以场景为卡片，红/橙/黄分级匹配不同威胁；
 *   - 所有数据来自 EMERGENCY_GUIDE + ALERTS/EVENTS/COUNTRIES，禁止模拟。
 * ============================================================ */
(function (root) {
  'use strict';

  /* ===== 动态注入应急中心专用样式 ===== */
  (function injectStyles() {
    if (document.getElementById('emergency-center-css')) return;
    var s = document.createElement('style');
    s.id = 'emergency-center-css';
    s.textContent = '' +
      '.emg-loading{padding:18px;font-size:12px;color:var(--text3)}' +
      '.emg-root{color:var(--text);font-size:12px;line-height:1.5}' +
      '.emg-commandband{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;padding:14px;background:var(--bg2);border-radius:10px;border:1px solid rgba(0,212,255,0.12)}' +
      '.emg-country-selector{display:flex;flex-direction:column;gap:4px}' +
      '.emg-country-selector label{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px}' +
      '.emg-select{background:var(--bg1);color:var(--text);border:1px solid rgba(0,212,255,0.25);border-radius:6px;padding:6px 10px;font-size:13px;min-width:160px;outline:none}' +
      '.emg-select:focus{border-color:var(--cyan)}' +
      '.emg-risk-gauge{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:10px;border-left:4px solid}' +
      '.emg-risk-score{font-size:30px;font-weight:800;line-height:1}' +
      '.emg-risk-score span{font-size:12px;font-weight:400;color:var(--text3);margin-left:3px}' +
      '.emg-risk-label{font-size:13px;font-weight:700;margin-bottom:2px}' +
      '.emg-risk-desc{font-size:10px;color:var(--text3)}' +
      '.emg-actions{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}' +
      '.emg-btn{background:rgba(0,212,255,0.08);color:var(--cyan);border:1px solid rgba(0,212,255,0.25);border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;transition:all .2s}' +
      '.emg-btn:hover{background:rgba(0,212,255,0.18)}' +
      '.emg-btn.primary{background:var(--cyan);color:#000;font-weight:700;border-color:var(--cyan)}' +
      '.emg-btn.primary:hover{background:#33ddff}' +
      '.emg-section{margin-bottom:14px}' +
      '.emg-section-title{font-size:13px;font-weight:700;color:var(--text1);margin-bottom:10px;display:flex;align-items:center;gap:6px}' +
      '.emg-project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}' +
      '.emg-project-card{background:var(--bg2);border-radius:8px;padding:12px;border-left:4px solid var(--green);cursor:pointer;transition:all .2s}' +
      '.emg-project-card:hover{background:rgba(0,212,255,0.06);transform:translateY(-1px)}' +
      '.emg-project-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}' +
      '.emg-project-name{font-weight:700;color:var(--text1);font-size:12px}' +
      '.emg-project-score{color:#000;font-weight:800;font-size:11px;padding:2px 8px;border-radius:10px}' +
      '.emg-project-loc{font-size:10px;color:var(--text3);margin-bottom:6px}' +
      '.emg-project-links{display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--cyan);margin-bottom:6px}' +
      '.emg-project-alert{font-size:10px;color:var(--text3)}' +
      '.emg-main{display:grid;grid-template-columns:1.5fr 1fr;gap:14px}' +
      '@media(max-width:1100px){.emg-main{grid-template-columns:1fr}}' +
      '.emg-scene-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}' +
      '.emg-scene-card{background:var(--bg2);border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.04)}' +
      '.emg-scene-header{display:flex;justify-content:space-between;align-items:center;padding:12px;border-left:4px solid;border-bottom:1px solid rgba(255,255,255,0.04)}' +
      '.emg-scene-title{font-weight:700;color:var(--text1);font-size:12px;flex:1;padding-right:8px}' +
      '.emg-scene-level{font-size:11px;font-weight:800;white-space:nowrap}' +
      '.emg-route-flow{padding:12px;display:flex;flex-direction:column;gap:8px}' +
      '.emg-route-step{display:flex;align-items:flex-start;gap:10px;position:relative}' +
      '.emg-step-num{flex:0 0 22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#000;font-size:10px;font-weight:800}' +
      '.emg-step-text{flex:1;padding-top:3px;color:var(--text1);font-size:11px}' +
      '.emg-step-arrow{color:var(--text3);font-size:12px;margin-left:32px;margin-top:-4px}' +
      '.emg-scene-meta{padding:10px 12px;background:rgba(0,0,0,0.15);font-size:11px;color:var(--text3);border-top:1px solid rgba(255,255,255,0.04)}' +
      '.emg-scene-meta b{color:var(--orange)}' +
      '.emg-scene-note{margin-top:6px;color:var(--yellow);font-size:10px}' +
      '.emg-contact-col{background:var(--bg2);border-radius:10px;padding:14px;border:1px solid rgba(255,255,255,0.04);height:fit-content}' +
      '.emg-contact-card{background:rgba(0,0,0,0.2);border-radius:8px;padding:10px;margin-bottom:8px}' +
      '.emg-contact-type{font-size:9px;color:var(--cyan);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}' +
      '.emg-contact-name{font-weight:700;color:var(--text1);font-size:12px;margin-bottom:2px}' +
      '.emg-contact-city{font-size:10px;color:var(--text3);margin-bottom:6px}' +
      '.emg-phone{display:inline-flex;align-items:center;gap:4px;color:var(--cyan);font-weight:700;font-size:12px;text-decoration:none;padding:4px 8px;background:rgba(0,212,255,0.08);border-radius:6px}' +
      '.emg-phone:hover{background:rgba(0,212,255,0.18)}' +
      '.emg-hotline{background:linear-gradient(135deg,rgba(255,51,85,0.12),rgba(255,136,0,0.08));border:1px solid rgba(255,51,85,0.25);border-radius:10px;padding:12px;margin-top:10px;text-align:center}' +
      '.emg-hotline-name{font-size:10px;color:var(--text3);margin-bottom:4px}' +
      '.emg-hotline-num{font-size:18px;font-weight:800;color:var(--red);text-decoration:none}' +
      '.emg-hotline-alt{font-size:10px;color:var(--text3);margin-top:4px}' +
      '.emg-port-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
      '.emg-port{background:rgba(0,0,0,0.2);border-radius:6px;padding:6px 8px;font-size:11px;color:var(--text1);display:flex;align-items:center;gap:5px}' +
      '.emg-port code{margin-left:auto;background:rgba(0,212,255,0.12);color:var(--cyan);padding:1px 5px;border-radius:4px;font-size:9px}' +
      '.emg-shelter-list{display:flex;flex-direction:column;gap:6px}' +
      '.emg-shelter{background:rgba(0,0,0,0.2);border-radius:6px;padding:8px 10px;border-left:3px solid var(--green)}' +
      '.emg-shelter-name{font-size:11px;font-weight:700;color:var(--text1)}' +
      '.emg-shelter-note{font-size:10px;color:var(--text3);margin-top:2px}' +
      '.emg-transit-list{display:flex;flex-wrap:wrap;gap:6px}' +
      '.emg-transit-chip{background:rgba(0,212,255,0.08);color:var(--cyan);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:3px 10px;font-size:10px}' +
      '.emg-country-note{margin-top:10px;padding:10px;border-radius:8px;background:rgba(255,204,0,0.08);border:1px solid rgba(255,204,0,0.2);color:var(--yellow);font-size:11px}' +
      '.emg-alert-list{display:flex;flex-direction:column;gap:6px}' +
      '.emg-alert-item{display:flex;align-items:center;gap:10px;background:var(--bg2);border-radius:6px;padding:8px 10px;cursor:pointer;transition:all .2s}' +
      '.emg-alert-item:hover{background:rgba(0,212,255,0.06)}' +
      '.emg-alert-score{flex:0 0 34px;text-align:center;color:#000;font-weight:800;font-size:10px;padding:2px 0;border-radius:4px}' +
      '.emg-alert-title{flex:1;font-size:11px;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.emg-alert-time{flex:0 0 50px;font-size:10px;color:var(--text3);text-align:right}' +
      '.emg-empty{padding:20px;text-align:center;color:var(--text3);font-size:12px;background:var(--bg2);border-radius:8px}' +
      '.emg-all-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;max-height:60vh;overflow-y:auto;padding:4px}' +
      '.emg-all-item{background:var(--bg2);border-radius:8px;padding:10px;border-left:4px solid var(--green);cursor:pointer;transition:all .2s}' +
      '.emg-all-item:hover{background:rgba(0,212,255,0.08)}' +
      '.emg-all-name{font-weight:700;font-size:12px;color:var(--text1)}' +
      '.emg-all-score{font-size:14px;font-weight:800;margin-top:4px}' +
      '.emg-all-score span{font-size:10px;font-weight:400;color:var(--text3)}' +
      '.emg-all-count{font-size:10px;color:var(--text3);margin-top:2px}';
    document.head.appendChild(s);
  })();

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _id(s) { return 'emg-' + String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-'); }
  function _phoneHref(t) {
    var n = String(t).replace(/[^\d+]/g, '');
    return n ? 'tel:' + n : '#';
  }
  function _zone(score) {
    if (score >= 61) return { key: 'red', label: '红区', color: '#ff3355', bg: 'rgba(255,51,85,0.12)' };
    if (score >= 31) return { key: 'orange', label: '橙区', color: '#ff8800', bg: 'rgba(255,136,0,0.12)' };
    if (score >= 1) return { key: 'yellow', label: '黄区', color: '#ffcc00', bg: 'rgba(255,204,0,0.12)' };
    return { key: 'green', label: '绿区', color: '#00ff9f', bg: 'rgba(0,255,159,0.10)' };
  }
  function _projectRiskOf(p) {
    var geo = (typeof EMERGENCY_GUIDE !== 'undefined') ? EMERGENCY_GUIDE.geoOf(p.id) : null;
    var aliases = [p.name, p.en].concat(p.alias || []).filter(Boolean).map(function (x) { return String(x).toLowerCase(); });
    var direct = [], countryN = 0, cMax = 0;
    (typeof ALERTS !== 'undefined' ? ALERTS : []).forEach(function (a) {
      if (!a || a.status === 'resolved') return;
      var t = (String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '')).toLowerCase();
      var hit = aliases.some(function (al) { return al && t.indexOf(al) >= 0; });
      if (hit) { direct.push(a); return; }
      var cty = a.country || '';
      if (cty === p.country || (p.country === '欧洲' && /欧洲|德国|波兰/.test(cty))) { countryN++; cMax = Math.max(cMax, a.risk_score || 0); }
    });
    var dMax = direct.reduce(function (m, a) { return Math.max(m, a.risk_score || 0); }, 0);
    var score = Math.max(dMax, Math.round(cMax * 0.7));
    var z = _zone(score);
    return { score: score, zone: z, direct: direct, countryN: countryN, countryMax: cMax, geo: geo };
  }
  function _countryAlerts(country) {
    return (typeof ALERTS !== 'undefined' ? ALERTS : []).filter(function (a) {
      return a && a.status !== 'resolved' && (a.country === country || (country === '德国' && a.country === '欧洲'));
    }).sort(function (a, b) { return (b.risk_score || 0) - (a.risk_score || 0); });
  }
  function _countryEvents(country) {
    return (typeof EVENTS !== 'undefined' ? EVENTS : []).filter(function (e) {
      return e && e.country === country;
    }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }

  var EMERGENCY_CENTER = {
    currentCountry: null,

    init: function () { this.render(); },

    /* 主渲染入口 */
    render: function (country) {
      var el = document.getElementById('mon-emg-guide');
      if (!el) return;
      if (typeof EMERGENCY_GUIDE === 'undefined') {
        el.innerHTML = '<div class="emg-loading">应急指南数据未加载</div>'; return;
      }
      var cs = EMERGENCY_GUIDE.countries();
      if (!country) {
        country = this.currentCountry || this._pickHighestRiskCountry(cs);
      }
      this.currentCountry = country;
      var guide = EMERGENCY_GUIDE.guideOf(country);
      var alerts = _countryAlerts(country);
      var events = _countryEvents(country);
      var projs = (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) ?
        ENTITY.PROJECTS.filter(function (p) { return p.country === country || (country === '德国' && p.country === '欧洲'); }) : [];
      var cMax = alerts.reduce(function (m, a) { return Math.max(m, a.risk_score || 0); }, 0);
      var z = _zone(cMax);

      var html = '<div class="emg-root">';
      /* ===== 顶部指挥带 ===== */
      html += '<div class="emg-commandband">';
      html += '<div class="emg-country-selector">' +
        '<label>应急国别</label>' +
        '<select class="emg-select" onchange="EMERGENCY_CENTER.render(this.value)">' +
        cs.map(function (c) { return '<option value="' + _esc(c) + '"' + (c === country ? ' selected' : '') + '>' + _esc(c) + '</option>'; }).join('') +
        '</select></div>';
      html += '<div class="emg-risk-gauge" style="background:' + z.bg + ';border-color:' + z.color + '">' +
        '<div class="emg-risk-score" style="color:' + z.color + '">' + cMax + '<span>/100</span></div>' +
        '<div class="emg-risk-meta">' +
        '<div class="emg-risk-label" style="color:' + z.color + '">' + z.label + '</div>' +
        '<div class="emg-risk-desc">活跃预警 ' + alerts.length + ' 条 · 项目 ' + projs.length + ' 个 · 事件 ' + events.length + ' 起</div>' +
        '</div></div>';
      html += '<div class="emg-actions">' +
        '<button class="emg-btn primary" onclick="EMERGENCY_CENTER.exportPlan()">📋 导出预案</button>' +
        '<button class="emg-btn" onclick="EMERGENCY_CENTER.runDrill()">🚨 桌面推演</button>' +
        '<button class="emg-btn" onclick="EMERGENCY_CENTER.showAllCountries()">🌐 全部国别</button>' +
        '</div>';
      html += '</div>';

      /* ===== 项目风险矩阵 ===== */
      html += '<div class="emg-section">' +
        '<div class="emg-section-title">🏗️ 中资项目风险矩阵（' + projs.length + '）</div>' +
        '<div class="emg-project-grid">' + projs.map(function (p) {
          var pr = _projectRiskOf(p);
          var geo = pr.geo || {};
          return '<div class="emg-project-card" style="border-left-color:' + pr.zone.color + '" onclick="EMERGENCY_CENTER.focusProject(\'' + _esc(p.id) + '\')">' +
            '<div class="emg-project-head">' +
            '<span class="emg-project-name">' + _esc(p.name) + '</span>' +
            '<span class="emg-project-score" style="background:' + pr.zone.color + '">' + pr.score + '</span>' +
            '</div>' +
            '<div class="emg-project-loc">' + _esc(p.country) + (geo.province ? ' · ' + _esc(geo.province) : '') + '</div>' +
            '<div class="emg-project-links">' +
            (geo.airport ? '<span title="空港">✈️ ' + _esc(geo.airport.iata || geo.airport.name) + '</span>' : '') +
            (geo.seaport ? '<span title="海港">⚓ ' + _esc(geo.seaport) + '</span>' : '') +
            '</div>' +
            '<div class="emg-project-alert">' + (pr.direct.length ? '直接命中 ' + pr.direct.length + ' 条' : '国别环境折算') + '</div>' +
            '</div>';
        }).join('') + '</div></div>';

      /* ===== 中部：场景卡片 + 固定联络栏 ===== */
      html += '<div class="emg-main">';
      html += '<div class="emg-scene-col">';
      html += '<div class="emg-section-title">🚨 场景化应急方案</div>';
      if (!guide || !guide.routes || !guide.routes.length) {
        html += '<div class="emg-empty">该国应急指南待补充</div>';
      } else {
        html += '<div class="emg-scene-grid">';
        guide.routes.forEach(function (r, idx) {
          var sceneScore = cMax >= 61 ? 61 : cMax >= 31 ? 45 : cMax >= 1 ? 25 : 0;
          var sz = _zone(sceneScore);
          html += '<div class="emg-scene-card" id="' + _id(country + '-' + idx) + '">';
          html += '<div class="emg-scene-header" style="border-left-color:' + sz.color + '">' +
            '<div class="emg-scene-title">' + _esc(r.scene) + '</div>' +
            '<div class="emg-scene-level" style="color:' + sz.color + '">' + sz.label + '</div>' +
            '</div>';
          /* 撤离路线步骤流程 */
          html += '<div class="emg-route-flow">';
          (r.steps || []).forEach(function (step, i) {
            html += '<div class="emg-route-step">' +
              '<div class="emg-step-num" style="background:' + sz.color + '">' + (i + 1) + '</div>' +
              '<div class="emg-step-text">' + _esc(step) + '</div>';
            if (i < (r.steps || []).length - 1) {
              html += '<div class="emg-step-arrow">→</div>';
            }
            html += '</div>';
          });
          html += '</div>';
          html += '<div class="emg-scene-meta">' +
            '<div><b>第三国中转：</b>' + _esc(r.third || '—') + '</div>' +
            (r.note ? '<div class="emg-scene-note">⚠️ ' + _esc(r.note) + '</div>' : '') +
            '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>'; /* scene-col */

      /* ===== 右侧联络与资源 ===== */
      html += '<div class="emg-contact-col">';
      html += '<div class="emg-section-title">📞 使领馆与热线</div>';
      if (guide && guide.embassy) {
        html += '<div class="emg-contact-card emg-embassy">' +
          '<div class="emg-contact-type">大使馆</div>' +
          '<div class="emg-contact-name">' + _esc(guide.embassy.name) + '</div>' +
          '<div class="emg-contact-city">' + _esc(guide.embassy.city) + (guide.embassy.addr ? ' · ' + _esc(guide.embassy.addr) : '') + '</div>' +
          '<a class="emg-phone" href="' + _phoneHref(guide.embassy.phone) + '">📞 ' + _esc(guide.embassy.phone) + '</a>' +
          '</div>';
      }
      (guide ? guide.consulates : []).forEach(function (c) {
        html += '<div class="emg-contact-card">' +
          '<div class="emg-contact-type">总领馆</div>' +
          '<div class="emg-contact-name">' + _esc(c.name) + '</div>' +
          '<div class="emg-contact-city">' + _esc(c.city) + '</div>' +
          '<a class="emg-phone" href="' + _phoneHref(c.phone) + '">📞 ' + _esc(c.phone) + '</a>' +
          '</div>';
      });
      html += '<div class="emg-hotline">' +
        '<div class="emg-hotline-name">' + EMERGENCY_GUIDE.HOTLINE.name + '</div>' +
        '<a class="emg-hotline-num" href="tel:861012308">' + EMERGENCY_GUIDE.HOTLINE.phone + '</a>' +
        '<div class="emg-hotline-alt">备用 ' + EMERGENCY_GUIDE.HOTLINE.alt + ' · ' + EMERGENCY_GUIDE.HOTLINE.hours + '</div>' +
        '</div>';

      html += '<div class="emg-section-title" style="margin-top:14px">🛫 空港 / ⚓ 海港</div>';
      html += '<div class="emg-port-grid">';
      (guide ? guide.airports : []).forEach(function (a) {
        html += '<div class="emg-port"><span>✈️</span>' + _esc(a.name) + (a.iata ? '<code>' + _esc(a.iata) + '</code>' : '') + '</div>';
      });
      (guide ? guide.seaports : []).forEach(function (s) {
        html += '<div class="emg-port"><span>⚓</span>' + _esc(s.name) + '</div>';
      });
      html += '</div>';

      html += '<div class="emg-section-title" style="margin-top:14px">🛡️ 避难所</div>';
      html += '<div class="emg-shelter-list">';
      (guide ? guide.shelters : []).forEach(function (s) {
        html += '<div class="emg-shelter">' +
          '<div class="emg-shelter-name">' + _esc(s.name) + '</div>' +
          (s.note ? '<div class="emg-shelter-note">' + _esc(s.note) + '</div>' : '') +
          '</div>';
      });
      html += '</div>';

      html += '<div class="emg-section-title" style="margin-top:14px">🌐 第三国中转</div>';
      html += '<div class="emg-transit-list">';
      (guide ? guide.transit : []).forEach(function (t) {
        html += '<span class="emg-transit-chip">' + _esc(t) + '</span>';
      });
      html += '</div>';

      if (guide && guide.note) {
        html += '<div class="emg-country-note">' + _esc(guide.note) + '</div>';
      }
      html += '</div>'; /* contact-col */
      html += '</div>'; /* emg-main */

      /* ===== 底部：实时预警摘要 ===== */
      if (alerts.length) {
        html += '<div class="emg-section" style="margin-top:12px">' +
          '<div class="emg-section-title">⚡ 该国实时预警（' + alerts.length + '）</div>' +
          '<div class="emg-alert-list">' + alerts.slice(0, 5).map(function (a) {
            var az = _zone(a.risk_score || 0);
            return '<div class="emg-alert-item" onclick="EMERGENCY_CENTER.openAlert(\'' + _esc(a.id) + '\')">' +
              '<span class="emg-alert-score" style="background:' + az.color + '">' + (a.risk_score || 0) + '</span>' +
              '<span class="emg-alert-title">' + _esc(a.title_zh || a.title) + '</span>' +
              '<span class="emg-alert-time">' + (a.time || '').substring(5, 16) + '</span>' +
              '</div>';
          }).join('') + '</div></div>';
      }

      html += '</div>'; /* emg-root */
      el.innerHTML = html;
    },

    _pickHighestRiskCountry: function (cs) {
      var best = '', bestS = -1;
      (typeof ALERTS !== 'undefined' ? ALERTS : []).forEach(function (a) {
        if (!a || a.status === 'resolved') return;
        if (cs.indexOf(a.country) >= 0 && (a.risk_score || 0) > bestS) { bestS = a.risk_score || 0; best = a.country; }
      });
      return best || cs[0];
    },

    /* 聚焦到某个项目的应急方案 */
    focusProject: function (pid) {
      if (typeof ENTITY === 'undefined' || !ENTITY.PROJECTS) return;
      var p = ENTITY.PROJECTS.find(function (x) { return x.id === pid; });
      if (!p) return;
      var pname = p.name;
      this.render(p.country);
      var el = document.getElementById('mon-emg-guide');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      /* 高亮项目卡片 */
      setTimeout(function () {
        var cards = document.querySelectorAll('.emg-project-card');
        cards.forEach(function (c) { c.style.boxShadow = ''; });
        var target = Array.from(cards).find(function (c) { return c.textContent.indexOf(pname) >= 0; });
        if (target) {
          target.style.boxShadow = '0 0 0 2px var(--cyan)';
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    },

    /* 打开预警详情 */
    openAlert: function (id) {
      if (typeof showAlertDetail === 'function') showAlertDetail(id);
    },

    /* 导出当前国别应急方案（文本 + 打印） */
    exportPlan: function () {
      var country = this.currentCountry;
      var guide = EMERGENCY_GUIDE.guideOf(country);
      var alerts = _countryAlerts(country);
      var projs = (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) ?
        ENTITY.PROJECTS.filter(function (p) { return p.country === country; }) : [];
      var text = '海外利益保护应急方案 — ' + country + '\n' +
        '生成时间：' + new Date().toLocaleString('zh-CN') + '\n' +
        '当前最高风险分：' + (alerts[0] ? alerts[0].risk_score : 0) + '\n' +
        '活跃预警：' + alerts.length + ' 条\n' +
        '中资项目：' + projs.length + ' 个\n\n';
      text += '【使领馆联系方式】\n';
      if (guide && guide.embassy) text += guide.embassy.name + '（' + guide.embassy.city + '）' + guide.embassy.phone + '\n';
      (guide ? guide.consulates : []).forEach(function (c) { text += c.name + '（' + c.city + '）' + c.phone + '\n'; });
      text += '外交部全球领事保护热线：' + EMERGENCY_GUIDE.HOTLINE.phone + '\n\n';
      text += '【场景化撤离路线】\n';
      (guide ? guide.routes : []).forEach(function (r, i) {
        text += (i + 1) + '. ' + r.scene + '\n';
        text += '   步骤：' + (r.steps || []).join(' → ') + '\n';
        text += '   第三国：' + (r.third || '—') + (r.note ? ' | 备注：' + r.note : '') + '\n\n';
      });
      text += '【避难所】\n';
      (guide ? guide.shelters : []).forEach(function (s) { text += '• ' + s.name + (s.note ? '（' + s.note + '）' : '') + '\n'; });

      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '应急方案_' + country + '_' + new Date().toISOString().slice(0, 10) + '.txt';
      a.click();
    },

    /* 桌面推演：用当前国别 + 最高风险场景做沙盒推演 */
    runDrill: function () {
      var country = this.currentCountry;
      var guide = EMERGENCY_GUIDE.guideOf(country);
      var alerts = _countryAlerts(country);
      var top = alerts[0];
      var scene = (guide && guide.routes && guide.routes[0]) ? guide.routes[0].scene : '突发安全事件';
      if (typeof showToast === 'function') showToast('启动「' + country + ' · ' + scene + '」桌面推演');
      if (typeof navigateTo === 'function') navigateTo('autoalert');
    },

    /* 全部国别概览弹窗 */
    showAllCountries: function () {
      var cs = EMERGENCY_GUIDE.countries();
      var html = '<div class="emg-all-grid">' + cs.map(function (c) {
        var alerts = _countryAlerts(c);
        var max = alerts.reduce(function (m, a) { return Math.max(m, a.risk_score || 0); }, 0);
        var z = _zone(max);
        return '<div class="emg-all-item" style="border-left-color:' + z.color + '" onclick="EMERGENCY_CENTER.render(\'' + _esc(c) + '\');try{document.getElementById(\'modal\').classList.remove(\'show\');}catch(e){}">' +
          '<div class="emg-all-name">' + _esc(c) + '</div>' +
          '<div class="emg-all-score" style="color:' + z.color + '">' + max + ' <span>' + z.label + '</span></div>' +
          '<div class="emg-all-count">预警 ' + alerts.length + '</div>' +
          '</div>';
      }).join('') + '</div>';
      if (typeof showModal === 'function') showModal('🌐 全部中资项目所在国应急指南', html);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = EMERGENCY_CENTER;
  if (root) root.EMERGENCY_CENTER = EMERGENCY_CENTER;
})(typeof window !== 'undefined' ? window : null);
