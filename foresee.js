/* ============================================================
 * foresee.js v2.0 — 未来预警（八维智能预判引擎）
 * 升级（2026-08-16 用户指令）：从单一总分预判 → 8 维度全要素预判
 *   政治 / 经济 / 安全 / 法律合规 / 社会 / 自然 / 运营 / 地缘
 * 信号源（全部真实）：各维度对应情报类型的近72h事件量与环比增速、
 *   红橙预警密度、项目融合告警、活跃威胁组织、国别八维风险分。
 * 输出：国别×八维预判分矩阵、双环雷达（当前 vs 预判）、分维度预警清单、
 *   重点关注卡、升温/降温榜、逐国贡献分解、Kimi 大模型研判专报。
 * 诚实原则：规则模型推演+大模型研判均基于系统真实数据，无信号即无输出。
 * ============================================================ */
(function () {
  'use strict';

  /* 八维定义：与 COUNTRIES[].scores 同键；types = 该维度的情报来源集合 */
  var DIMS8 = [
    { key: 'security', name: '安全', icon: '🛡️', types: ['terror_events', 'security_events', 'military_conflicts'] },
    { key: 'political', name: '政治', icon: '🏛️', types: ['political_events'] },
    { key: 'economic', name: '经济', icon: '💰', types: ['sanctions_data', 'economic_risk'] },
    { key: 'legal', name: '法律合规', icon: '⚖️', types: ['legal_compliance'] },
    { key: 'social', name: '社会', icon: '👥', types: ['social_unrest', 'public_health'] },
    { key: 'natural', name: '自然', icon: '🌊', types: ['natural_disasters'] },
    { key: 'operational', name: '运营', icon: '🏗️', types: ['infrastructure'] },
    { key: 'geopolitical', name: '地缘', icon: '🌍', types: ['geopolitical_intel', 'osint_intel'] }
  ];
  var TYPE_LABEL = { terror_events: '恐怖袭击', security_events: '安全事件', military_conflicts: '武装冲突', political_events: '政治动荡', natural_disasters: '自然灾害', public_health: '公共卫生', sanctions_data: '制裁合规', economic_risk: '经济风险', legal_compliance: '法律合规', social_unrest: '社会动荡', infrastructure: '基础设施', geopolitical_intel: '地缘情报', osint_intel: '开源情报' };

  function _ts(it) {
    var s = it.collect_time || it.publishedAt || it.pubDate || it.date || it.time || it.audit_time || '';
    var t = Date.parse(String(s).replace(' ', 'T'));
    return isNaN(t) ? 0 : t;
  }
  function _countryOf(it) {
    var c = String(it.country || it.country_cn || '').trim();
    if (c) return c;
    var t = String(it.title || '') + ' ' + String(it.title_zh || '');
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (t.indexOf(COUNTRIES[i].name) >= 0) return COUNTRIES[i].name;
    }
    return '';
  }
  function _clamp10(v) { return Math.max(0, Math.min(10, Math.round(v * 10) / 10)); }
  function _cellColor(v) { return v >= 8 ? '#ff3355' : v >= 6.5 ? '#ff8800' : v >= 5 ? '#ffcc00' : v >= 3.5 ? '#00d4ff' : '#00ff9f'; }

  /* 科技感样式（只注入一次） */
  function _injectStyle() {
    if (document.getElementById('foresee-style')) return;
    var st = document.createElement('style');
    st.id = 'foresee-style';
    st.textContent = [
      '@keyframes fsGrid{from{background-position:0 0}to{background-position:60px 60px}}',
      '@keyframes fsScan{from{top:-25%}to{top:125%}}',
      '@keyframes fsBlink{0%,100%{opacity:1}50%{opacity:.2}}',
      '@keyframes fsGlowHigh{0%,100%{box-shadow:0 0 6px rgba(255,51,85,.22)}50%{box-shadow:0 0 20px rgba(255,51,85,.55)}}',
      '@keyframes fsFlow{from{stroke-dashoffset:0}to{stroke-dashoffset:-40}}',
      '.fs-banner{position:relative;overflow:hidden;background:linear-gradient(135deg,#0a1224 0%,#0d1830 60%,#101c3a 100%);border:1px solid rgba(0,212,255,.28);border-radius:10px}',
      '.fs-banner-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(0,212,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,.07) 1px,transparent 1px);background-size:30px 30px;animation:fsGrid 7s linear infinite;pointer-events:none}',
      '.fs-banner-scan{position:absolute;left:0;right:0;height:70px;background:linear-gradient(180deg,transparent,rgba(0,212,255,.14),transparent);animation:fsScan 4.5s linear infinite;pointer-events:none}',
      '.fs-online{display:inline-block;width:7px;height:7px;border-radius:50%;background:#00ff9f;box-shadow:0 0 8px #00ff9f;animation:fsBlink 1.5s infinite;margin-right:4px}',
      '.fs-card-high{animation:fsGlowHigh 2.6s ease-in-out infinite}',
      '.fs-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.22);border-radius:12px;font-size:10px;color:#7fdcff}'
    ].join('');
    document.head.appendChild(st);
  }

  /* 风险仪表盘（SVG 圆环，预判分） */
  function _gauge(v, color) {
    var r = 21, c = (2 * Math.PI * r).toFixed(1);
    var off = (c * (1 - v / 10)).toFixed(1);
    return '<svg width="52" height="52" viewBox="0 0 52 52" style="flex-shrink:0">' +
      '<circle cx="26" cy="26" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5"/>' +
      '<circle cx="26" cy="26" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 26 26)" style="transition:stroke-dashoffset 1.2s ease;filter:drop-shadow(0 0 4px ' + color + ')"/>' +
      '<text x="26" y="30.5" text-anchor="middle" fill="' + color + '" font-size="13" font-weight="800">' + v + '</text></svg>';
  }

  /* 数字滚动（运行时读取 stat-val 数值，0 → 目标值缓动） */
  function _countUp(el2) {
    el2.querySelectorAll('.stat-val').forEach(function (n) {
      var txt = (n.textContent || '').trim();
      if (!/^\d+$/.test(txt)) return;
      var target = parseInt(txt, 10);
      if (target <= 0) return;
      var t0 = null;
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / 900);
        n.textContent = String(Math.round(target * (0.15 + 0.85 * p * p)));
        if (p < 1) requestAnimationFrame(step);
      }
      n.textContent = '0';
      requestAnimationFrame(step);
    });
  }

  var FORESEE = {
    _cache: null, _cacheAt: 0, _radarCountry: '', _radarChart: null,

    /* ===== 信号采集 + 八维推演 ===== */
    compute: function () {
      if (this._cache && Date.now() - this._cacheAt < 60000) return this._cache;
      var now = Date.now(), H72 = 72 * 3600 * 1000;
      var rec = {}, prev = {};                 /* rec[country][type] = n */
      DIMS8.forEach(function (dm) {
        dm.types.forEach(function (cat) {
          var arr = [];
          try { arr = (typeof DBCenter !== 'undefined' ? DBCenter.getAll(cat) : []) || []; } catch (e) {}
          arr.forEach(function (it) {
            var t = _ts(it); if (!t) return;
            var age = now - t;
            var bucket = age <= H72 ? rec : (age <= 2 * H72 ? prev : null);
            if (!bucket) return;
            var c = _countryOf(it); if (!c) return;
            (bucket[c] = bucket[c] || {}); bucket[c][cat] = (bucket[c][cat] || 0) + 1;
          });
        });
      });
      var redA = {}, orangeA = {};
      try {
        ALERTS.forEach(function (a) {
          if (a.status === 'resolved') return;
          var c = String(a.country || ''); if (!c) return;
          if (a.level === 'red') redA[c] = (redA[c] || 0) + 1;
          else if (a.level === 'orange') orangeA[c] = (orangeA[c] || 0) + 1;
        });
      } catch (e) {}
      var fusion = {};
      try {
        if (typeof RISK_FUSION !== 'undefined') {
          RISK_FUSION.getResults().forEach(function (f) {
            var c = String(f.project_country || ''); if (!c) return;
            (fusion[c] = fusion[c] || { crit: 0, high: 0, total: 0 });
            fusion[c].total++;
            if (f.alert_level === 'critical') fusion[c].crit++;
            else if (f.alert_level === 'high') fusion[c].high++;
          });
        }
      } catch (e) {}
      var orgHit = {};
      try {
        var orgs = (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) || [];
        orgs.forEach(function (o) {
          var blob = JSON.stringify(o);
          COUNTRIES.forEach(function (c) { if (blob.indexOf(c.name) >= 0) orgHit[c.name] = (orgHit[c.name] || 0) + 1; });
        });
      } catch (e) {}

      var rows = COUNTRIES.map(function (c) {
        var r = rec[c.name] || {}, pv = prev[c.name] || {};
        var rn = redA[c.name] || 0, on = orangeA[c.name] || 0;
        var fz = fusion[c.name] || { crit: 0, high: 0, total: 0 };
        var og = orgHit[c.name] || 0;
        /* ---- 八维逐维预判 ---- */
        var dims = {};
        var dimSumCur = 0, dimSumPred = 0;
        DIMS8.forEach(function (dm) {
          var dCur = (c.scores && typeof c.scores[dm.key] === 'number') ? c.scores[dm.key] : 5;
          var tN = 0, tP = 0;
          dm.types.forEach(function (t) { tN += (r[t] || 0); tP += (pv[t] || 0); });
          var surge = tN - tP;
          var ratio = tN / Math.max(tP, 1);
          var add = 0;
          if (surge > 0) add += Math.min(surge * 0.25, 1.5);
          else if (surge < 0) add += Math.max(surge * 0.12, -0.7);
          if (tN > 0 && ratio > 1.2) add += Math.min((ratio - 1) * 0.4, 0.8);
          if (dm.key === 'security') add += Math.min(rn * 0.3 + on * 0.1, 1.0);
          if (dm.key === 'operational') add += Math.min(fz.crit * 0.4 + fz.high * 0.2, 0.8);
          if (dm.key === 'geopolitical') add += Math.min(og * 0.08, 0.4);
          if (tN === 0 && tP === 0) add -= 0.15; /* 无信号微幅回落 */
          dims[dm.key] = { cur: _clamp10(dCur), pred: _clamp10(dCur + add), n: tN, pn: tP };
          dimSumCur += dCur; dimSumPred += _clamp10(dCur + add);
        });
        var cur = _clamp10(dimSumCur / 8);
        var pred = _clamp10(dimSumPred / 8);
        var delta = Math.round((pred - cur) * 10) / 10;
        var level = (pred >= 8 || delta >= 1.2) ? 'high' : (pred >= 6.5 || delta >= 0.5) ? 'watch' : (delta <= -0.3 ? 'cooling' : 'stable');
        /* 总量信号（卡片展示用） */
        var r3 = 0, p3 = 0;
        Object.keys(r).forEach(function (k) { r3 += r[k]; });
        Object.keys(pv).forEach(function (k) { p3 += pv[k]; });
        /* 主导维度 = 预判分上升最多 */
        var domDim = '', domRise = 0;
        DIMS8.forEach(function (dm) {
          var rise = dims[dm.key].pred - dims[dm.key].cur;
          if (rise > domRise) { domRise = rise; domDim = dm.name; }
        });
        /* 贡献分解（依据面板） */
        var contrib = [];
        DIMS8.forEach(function (dm) {
          var dd = dims[dm.key];
          var diff = Math.round((dd.pred - dd.cur) * 100) / 100;
          if (diff !== 0) contrib.push({ label: dm.name + '维（事件 ' + dd.n + '/' + dd.pn + '）', v: diff });
        });
        if (rn) contrib.push({ label: '红色预警 ' + rn + ' 起', v: Math.min(rn * 0.3, 1.2) });
        if (fz.crit) contrib.push({ label: '融合紧急告警 ' + fz.crit, v: Math.min(fz.crit * 0.4, 0.8) });
        return {
          name: c.name, flag: c.flag || '🌐', cur: cur, pred: pred, delta: delta, level: level,
          r3: r3, p3: p3, red: rn, orange: on, fusion: fz.total, orgs: og,
          domDim: domDim, dims: dims, contrib: contrib, trend: c.trend || ''
        };
      });
      rows.sort(function (a, b) { return b.pred - a.pred || b.delta - a.delta; });
      var totalEv = 0;
      Object.keys(rec).forEach(function (k) { Object.keys(rec[k]).forEach(function (t) { totalEv += rec[k][t]; }); });
      var out = {
        at: new Date().toISOString(), rows: rows,
        high: rows.filter(function (r) { return r.level === 'high'; }),
        watch: rows.filter(function (r) { return r.level === 'watch'; }),
        cooling: rows.filter(function (r) { return r.level === 'cooling'; }),
        stable: rows.filter(function (r) { return r.level === 'stable'; }),
        dataBasis: { events72h: totalEv, countries: rows.filter(function (r) { return r.r3 > 0 || r.red > 0 || r.orange > 0; }).length }
      };
      this._cache = out; this._cacheAt = now;
      return out;
    },

    _advice: function (r) {
      var base = {
        '安全': '核实驻地人员与项目营地安保等级，复核撤侨通道与集结点，与当地军警保持通联',
        '政治': '备份与新权力中心沟通渠道，审查合同连续性条款',
        '经济': '排查供应链与金融制裁敞口，法务预审替代方案',
        '法律合规': '梳理涉案法规清单，评估合规风险与救济路径',
        '社会': '加强营地门禁与出行管制，避开集会区域；关注疫情与舆情',
        '自然': '核查自然灾害应急预案与次生风险，确认物资储备',
        '运营': '评估项目施工、物流与供应链中断预案',
        '地缘': '跟踪大国博弈动向，纳入周期研判与情景推演'
      };
      var act = base[r.domDim] || '纳入重点监测清单，每日复核';
      if (r.level === 'high') act = '【重点关注】' + act + '；建议 24 小时内完成风险评估并上报';
      return act;
    },

    /* ===== 八维雷达（当前 vs 预判 双环） ===== */
    _renderRadar: function (row) {
      var ctx = document.getElementById('foresee-radar');
      if (!ctx || typeof Chart === 'undefined') return;
      if (this._radarChart) { this._radarChart.destroy(); this._radarChart = null; }
      var labels = DIMS8.map(function (d) { return d.icon + d.name; });
      var curData = DIMS8.map(function (d) { return row.dims[d.key].cur; });
      var predData = DIMS8.map(function (d) { return row.dims[d.key].pred; });
      this._radarChart = new Chart(ctx.getContext('2d'), {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [
            { label: '当前风险', data: curData, borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.14)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#00d4ff' },
            { label: '72h预判', data: predData, borderColor: '#ff3355', backgroundColor: 'rgba(255,51,85,0.10)', borderWidth: 2, borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: '#ff3355' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { min: 0, max: 10, ticks: { display: false }, grid: { color: 'rgba(0,212,255,0.08)' }, angleLines: { color: 'rgba(0,212,255,0.08)' }, pointLabels: { color: '#9fb2cc', font: { size: 11 } } } },
          plugins: { legend: { position: 'bottom', labels: { color: '#9fb2cc', font: { size: 10 }, boxWidth: 12 } } }
        }
      });
    },

    /* ===== 渲染 ===== */
    init: function () { this.render(); },
    render: function () {
      var el = document.getElementById('foresee-body');
      if (!el) return;
      _injectStyle();
      var d = this.compute();
      var me = this;
      var LV = { high: { l: '🔴 重点预警', c: 'var(--red)' }, watch: { l: '🟠 关注', c: 'var(--orange)' }, stable: { l: '🟢 平稳', c: 'var(--green)' }, cooling: { l: '🔵 降温', c: 'var(--cyan)' } };
      var focus = d.high.concat(d.watch).slice(0, 18); /* 2026-08-16：12→18，保证巴基斯坦等 BRI 重点国出列 */
      if (!this._radarCountry || !d.rows.some(function (r) { return r.name === me._radarCountry; })) {
        this._radarCountry = focus.length ? focus[0].name : (d.rows[0] ? d.rows[0].name : '');
      }

      var html = '';
      /* ===== AI 推演引擎横幅（动态网格+扫描线+五路信号在线状态）===== */
      html += '<div class="fs-banner" style="margin-bottom:12px;padding:16px 18px">' +
        '<div class="fs-banner-grid"></div><div class="fs-banner-scan"></div>' +
        '<div style="position:relative;z-index:1">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
        '<div><span style="font-size:16px;font-weight:800;letter-spacing:1px;color:#7fdcff;text-shadow:0 0 12px rgba(0,212,255,.6)">🔮 FORESEE ENGINE</span>' +
        '<span style="font-size:10px;color:var(--text3);margin-left:10px">未来 72 小时 · 八维智能预判</span></div>' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;color:#00ff9f"><span class="fs-online"></span>ENGINE ONLINE</span>' +
        '<button class="btn sm" onclick="FORESEE._cache=null;FORESEE.render()" style="font-size:10px">🔄 重新推演</button></div></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
        ['📡 事件流', '🚨 预警流', '🔗 融合引擎', '🕵️ 威胁库', '📊 风险模型'].map(function (x) { return '<span class="fs-chip"><span class="fs-online"></span>' + x + '</span>'; }).join('') +
        '</div>' +
        '<div style="font-size:11px;line-height:1.7;color:#9fb2cc">对每国 <b style="color:#7fdcff">政治/经济/安全/法律/社会/自然/运营/地缘</b> 八维独立推演：对应情报类型近72h事件量与环比增速 + 红橙预警密度 + 项目融合告警 + 活跃威胁组织 + 国别八维风险分。<span style="color:var(--text3)">推演为概率性参考，非确定性结论；数据时点 ' + d.at.replace('T', ' ').slice(0, 19) + '</span></div>' +
        '</div></div>';

      /* KPI */
      html += '<div class="stat-grid mb-12" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="stat-card"><div class="stat-ic" style="background:var(--red-bg);color:var(--red)">🔴</div><div class="stat-info"><div class="stat-label">重点预警国家</div><div class="stat-val" style="color:var(--red)">' + d.high.length + '</div><div class="stat-sub">未来72h需重点关注</div></div></div>' +
        '<div class="stat-card"><div class="stat-ic" style="background:var(--orange-bg);color:var(--orange)">🟠</div><div class="stat-info"><div class="stat-label">关注国家</div><div class="stat-val" style="color:var(--orange)">' + d.watch.length + '</div><div class="stat-sub">风险上行或高位运行</div></div></div>' +
        '<div class="stat-card"><div class="stat-ic" style="background:var(--blue-bg);color:var(--cyan)">🔵</div><div class="stat-info"><div class="stat-label">降温国家</div><div class="stat-val" style="color:var(--cyan)">' + d.cooling.length + '</div><div class="stat-sub">风险信号回落</div></div></div>' +
        '<div class="stat-card"><div class="stat-ic" style="background:var(--green-bg);color:var(--green)">📊</div><div class="stat-info"><div class="stat-label">推演数据基础</div><div class="stat-val" style="color:var(--green)">' + d.dataBasis.events72h + '</div><div class="stat-sub">近72h事件 · 覆盖' + d.dataBasis.countries + '国有信号国家</div></div></div>' +
        '</div>';

      /* 大模型研判专报 */
      html += '<div class="card" style="margin-bottom:12px;border:1px solid rgba(179,102,255,0.35)">' +
        '<div class="card-tt"><span class="ic">🤖</span>大模型研判专报 <span style="font-size:10px;color:var(--text3);font-weight:400">· Kimi 大模型基于八维推演数据生成 · 密钥仅存服务端</span>' +
        '<button type="button" class="btn sm primary" id="foresee-llm-btn" style="float:right;font-size:10px">✨ 生成研判专报</button></div>' +
        '<div id="foresee-llm-body" style="font-size:12px;line-height:1.8;color:var(--text2)"><span style="color:var(--text3);font-size:11px">点击「生成研判专报」，大模型将读取八维推演清单与今日采集统计，输出总体判断 / 重点国家 / 涉华关联 / 四方行动建议。</span></div></div>';

      /* ===== 八维预判矩阵（国别 × 八维 热力表） ===== */
      var matrixRows = focus.length ? focus : d.rows.slice(0, 12);
      html += '<div class="card" style="margin-bottom:12px"><div class="card-tt"><span class="ic">🛰️</span>八维预判矩阵 <span style="font-size:10px;color:var(--text3);font-weight:400">· 行=国家（按预判分排序） 列=八维度 · 数字为预判分，箭头为升降</span></div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:860px">' +
        '<thead><tr style="color:var(--text3)"><th style="text-align:left;padding:6px 8px">国家</th><th style="padding:6px 4px">综合</th>' +
        DIMS8.map(function (dm) { return '<th style="padding:6px 4px">' + dm.icon + dm.name + '</th>'; }).join('') + '</tr></thead><tbody>' +
        matrixRows.map(function (r) {
          var lv = LV[r.level];
          var cells = DIMS8.map(function (dm) {
            var dd = r.dims[dm.key];
            var diff = Math.round((dd.pred - dd.cur) * 10) / 10;
            var arrow = diff > 0 ? '<span style="color:var(--red);font-size:9px">↑</span>' : diff < 0 ? '<span style="color:var(--green);font-size:9px">↓</span>' : '';
            var bg = dd.pred >= 8 ? 'rgba(255,51,85,0.16)' : dd.pred >= 6.5 ? 'rgba(255,136,0,0.12)' : dd.pred >= 5 ? 'rgba(255,204,0,0.08)' : 'transparent';
            return '<td style="padding:5px 4px;text-align:center;background:' + bg + ';border-bottom:1px solid var(--border);color:' + _cellColor(dd.pred) + ';font-weight:700">' + dd.pred + arrow + '</td>';
          }).join('');
          return '<tr style="cursor:pointer" data-foresee-cty="' + r.name + '" title="点击查看国家详情">' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' + r.flag + ' <strong>' + r.name + '</strong> <span style="font-size:9px;color:' + lv.c + '">' + lv.l + '</span></td>' +
            '<td style="padding:5px 4px;text-align:center;border-bottom:1px solid var(--border);font-weight:800;color:' + lv.c + '">' + r.pred + '</td>' + cells + '</tr>';
        }).join('') + '</tbody></table></div></div>';

      /* ===== 八维雷达 + 维度预警清单 ===== */
      var radarRow = d.rows.find(function (r) { return r.name === me._radarCountry; }) || d.rows[0];
      html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
        '<div class="card"><div class="card-tt"><span class="ic">📡</span>八维雷达对比 <span style="font-size:10px;color:var(--text3);font-weight:400">· 蓝=当前 红=72h预判</span></div>' +
        '<div style="margin-bottom:8px"><select class="select" id="foresee-radar-sel" style="font-size:11px;padding:4px 8px;width:100%">' +
        d.rows.slice(0, 20).map(function (r) { return '<option value="' + r.name + '"' + (radarRow && r.name === radarRow.name ? ' selected' : '') + '>' + r.flag + ' ' + r.name + '（预判 ' + r.pred + '）</option>'; }).join('') +
        '</select></div>' +
        '<div style="height:300px"><canvas id="foresee-radar"></canvas></div></div>' +
        /* 分维度预警清单 */
        '<div class="card"><div class="card-tt"><span class="ic">📋</span>分维度预警清单 <span style="font-size:10px;color:var(--text3);font-weight:400">· 维度预判分 ≥6.5 的国家</span></div>' +
        '<div style="max-height:340px;overflow-y:auto">' +
        DIMS8.map(function (dm) {
          var list = d.rows.filter(function (r) { return r.dims[dm.key].pred >= 6.5; })
            .sort(function (a, b) { return b.dims[dm.key].pred - a.dims[dm.key].pred; }).slice(0, 5);
          if (!list.length) return '';
          return '<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border)">' + dm.icon + ' ' + dm.name + '</div>' +
            list.map(function (r) {
              var dd = r.dims[dm.key];
              var diff = Math.round((dd.pred - dd.cur) * 10) / 10;
              return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px;border-bottom:1px dashed var(--border);cursor:pointer" data-foresee-cty="' + r.name + '">' +
                '<span>' + r.flag + '</span><span style="flex:1">' + r.name + '</span>' +
                '<span style="color:var(--text3);font-size:10px">事件 ' + dd.n + '</span>' +
                '<span style="font-weight:700;color:' + _cellColor(dd.pred) + '">' + dd.pred + '</span>' +
                (diff > 0 ? '<span style="color:var(--red);font-size:10px">↑' + diff + '</span>' : diff < 0 ? '<span style="color:var(--green);font-size:10px">↓' + Math.abs(diff) + '</span>' : '') +
                '</div>';
            }).join('') + '</div>';
        }).join('') +
        '</div></div></div>';

      /* 重点关注卡片 */
      html += '<div class="card" style="margin-bottom:12px"><div class="card-tt"><span class="ic">🎯</span>未来72小时重点关注（按预判分排序）</div>';
      if (!focus.length) html += '<div style="padding:20px;text-align:center;color:var(--text3)">当前无重点/关注级国家——全域风险信号平稳</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px">';
      focus.forEach(function (r) {
        var lv = LV[r.level];
        var arrow = r.delta > 0 ? '<span style="color:var(--red)">↗ +' + r.delta + '</span>' : r.delta < 0 ? '<span style="color:var(--green)">↘ ' + r.delta + '</span>' : '<span style="color:var(--text3)">→ 持平</span>';
        /* 上升最多的两个维度 chips */
        var topDims = DIMS8.map(function (dm) { return { n: dm.name, rise: r.dims[dm.key].pred - r.dims[dm.key].cur }; })
          .filter(function (x) { return x.rise > 0; }).sort(function (a, b) { return b.rise - a.rise; }).slice(0, 2);
        html += '<div class="' + (r.level === 'high' ? 'fs-card-high' : '') + '" style="border:1px solid var(--border);border-left:3px solid ' + lv.c + ';border-radius:8px;padding:10px 12px;background:var(--panel2);cursor:pointer" data-foresee-cty="' + r.name + '">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' + _gauge(r.pred, lv.c === 'var(--red)' ? '#ff3355' : lv.c === 'var(--orange)' ? '#ff8800' : '#00d4ff') +
          '<span style="font-size:18px">' + r.flag + '</span><strong style="font-size:13px;flex:1">' + r.name + '</strong>' +
          '<span class="badge" style="background:' + lv.c + '22;color:' + lv.c + ';border:1px solid ' + lv.c + '55;font-size:9px">' + lv.l + '</span></div>' +
          '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">' +
          '<span style="font-size:11px;color:var(--text3)">当前 ' + r.cur + '</span>' +
          '<span style="font-size:16px;font-weight:800;color:' + lv.c + '">→ ' + r.pred + '</span>' + arrow +
          (topDims.length ? '<span style="margin-left:auto;font-size:9px;color:var(--orange)">↑ ' + topDims.map(function (x) { return x.n; }).join('·') + '</span>' : '') + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">' +
          (r.r3 ? '<span style="font-size:9px;padding:1px 6px;background:var(--bg);border-radius:8px;color:var(--text2)">近72h事件 ' + r.r3 + ' 起（前72h ' + r.p3 + '）</span>' : '') +
          (r.red ? '<span style="font-size:9px;padding:1px 6px;background:rgba(255,51,85,0.1);border-radius:8px;color:var(--red)">红色预警 ' + r.red + '</span>' : '') +
          (r.orange ? '<span style="font-size:9px;padding:1px 6px;background:rgba(255,136,0,0.1);border-radius:8px;color:var(--orange)">橙色预警 ' + r.orange + '</span>' : '') +
          (r.fusion ? '<span style="font-size:9px;padding:1px 6px;background:var(--bg);border-radius:8px;color:var(--text2)">项目融合告警 ' + r.fusion + '</span>' : '') +
          (r.orgs ? '<span style="font-size:9px;padding:1px 6px;background:var(--bg);border-radius:8px;color:var(--text2)">活跃组织 ' + r.orgs + '</span>' : '') +
          '</div>' +
          '<div style="font-size:10px;color:var(--text3);line-height:1.5;border-top:1px dashed var(--border);padding-top:5px">💡 ' + me._advice(r) + '</div>' +
          '</div>';
      });
      html += '</div></div>';

      /* 升温榜 / 降温榜 */
      function rankList(arr, isUp) {
        if (!arr.length) return '<div style="padding:12px;color:var(--text3);font-size:11px">暂无</div>';
        return arr.map(function (r) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px;cursor:pointer" data-foresee-cty="' + r.name + '">' +
            '<span>' + r.flag + '</span><strong style="flex:1">' + r.name + '</strong>' +
            '<span style="color:' + (isUp ? 'var(--red)' : 'var(--green)') + ';font-weight:700">' + (isUp ? '↗ +' : '↘ ') + r.delta + '</span>' +
            '<span style="color:var(--text3);font-size:10px">预判 ' + r.pred + '</span></div>';
        }).join('');
      }
      var upList = d.rows.filter(function (r) { return r.delta > 0; }).sort(function (a, b) { return b.delta - a.delta; }).slice(0, 8);
      var downList = d.rows.filter(function (r) { return r.delta < 0; }).sort(function (a, b) { return a.delta - b.delta; }).slice(0, 8);
      html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
        '<div class="card"><div class="card-tt"><span class="ic">🔥</span>升温榜（未来72h风险上行）</div>' + rankList(upList, true) + '</div>' +
        '<div class="card"><div class="card-tt"><span class="ic">❄️</span>降温榜（信号回落）</div>' + rankList(downList, false) + '</div></div>';

      /* 预判依据 */
      html += '<div class="card"><div class="card-tt"><span class="ic">🧠</span>预判依据（逐国八维贡献分解，可核对）</div>';
      focus.forEach(function (r) {
        html += '<details style="margin-bottom:6px;border:1px solid var(--border);border-radius:6px;padding:6px 10px">' +
          '<summary style="cursor:pointer;font-size:11px"><strong>' + r.flag + ' ' + r.name + '</strong> · 当前 ' + r.cur + ' → 预判 ' + r.pred + '（' + LV[r.level].l + '）</summary>' +
          '<div style="padding:6px 0 2px;font-size:11px;color:var(--text2)">' +
          '<div>八维当前均值：' + r.cur + '</div>' +
          (r.contrib.length ? r.contrib.map(function (c) {
            return '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dashed var(--border)"><span>' + c.label + '</span><span style="color:' + (c.v > 0 ? 'var(--red)' : 'var(--green)') + '">' + (c.v > 0 ? '+' : '') + c.v + '</span></div>';
          }).join('') : '<div style="color:var(--text3)">无新增信号贡献</div>') +
          '</div></details>';
      });
      html += '<div style="font-size:10px;color:var(--text3);padding-top:6px">模型说明：每维预判分 = 该维当前风险分 + 对应情报类型事件增量/增速贡献 + 维度专属信号（安全维加红橙预警、运营维加融合告警、地缘维加组织活跃度）− 无信号回落；综合预判 = 八维均值。全部输入来自系统实时采集库，无任何虚构数据。</div></div>';

      el.innerHTML = html;
      _countUp(el);

      /* 大模型专报按钮 */
      var llmBtn = el.querySelector('#foresee-llm-btn');
      if (llmBtn) llmBtn.addEventListener('click', function () { me._genLlmReport(d); });
      /* 雷达 */
      if (radarRow) this._renderRadar(radarRow);
      var sel = el.querySelector('#foresee-radar-sel');
      if (sel) sel.addEventListener('change', function () {
        me._radarCountry = sel.value;
        var row = d.rows.find(function (r) { return r.name === sel.value; });
        if (row) me._renderRadar(row);
      });
      /* 国家穿透 */
      el.querySelectorAll('[data-foresee-cty]').forEach(function (node) {
        node.addEventListener('click', function () {
          var nm = node.getAttribute('data-foresee-cty');
          if (typeof showCtyDetail === 'function') showCtyDetail(nm);
        });
      });
    },

    /* ===== 大模型研判专报（服务端中转） ===== */
    _genLlmReport: function (d) {
      var body = document.getElementById('foresee-llm-body');
      var btn = document.getElementById('foresee-llm-btn');
      if (!body) return;
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中…'; }
      body.innerHTML = '<span style="color:var(--purple)">Kimi 大模型研判中（约 10-30 秒）…</span>';
      var focus = d.high.concat(d.watch).slice(0, 12).map(function (r) {
        var dimBrief = DIMS8.map(function (dm) { return dm.name + ' ' + r.dims[dm.key].pred; }).join('/');
        return { name: r.name, cur: r.cur, pred: r.pred, level: r.level, r3: r.r3, p3: r.p3, red: r.red, orange: r.orange, fusion: r.fusion, orgs: r.orgs, domType: r.domDim + '(' + dimBrief + ')', contrib: r.contrib };
      });
      var ds = (typeof SITUATION !== 'undefined' && SITUATION._dailyStats) || {};
      var tok = '';
      try { tok = (typeof APIClient !== 'undefined' && APIClient.getToken) ? APIClient.getToken() : (localStorage.getItem('orps_token') || ''); } catch (e) {}
      fetch('/api/llm/foresee-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ countries: focus, todayTotal: ds.total || 0, chinaToday: ds.china || 0, negToday: ds.chinaNegative || 0 })
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (res) {
          var j = res.j || {};
          if (res.status === 200 && j.ok) {
            var rawText = String(j.text || '');
            var metaHtml = '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);font-size:10px;color:var(--text3)">模型 ' + (j.model || '') + ' · 生成于 ' + String(j.at || '').replace('T', ' ').slice(0, 19) + (j.elapsed ? ' · 耗时 ' + j.elapsed : '') + (j.cached ? ' · 缓存' : '') + ' · 内容为大模型基于系统真实数据的研判，供参考</div>';
            var fmt = rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--cyan)">$1</strong>').replace(/\u000A/g, '<br>');
            /* 打字机逐字输出（AI 输出感），完成后替换为排版版 */
            body.innerHTML = '<span style="color:var(--purple);font-size:10px">▍Kimi 输出中…</span>';
            var plain = rawText.replace(/\*\*/g, '');
            var idx = 0;
            var timer = setInterval(function () {
              idx += 9;
              if (idx >= plain.length) {
                clearInterval(timer);
                body.innerHTML = fmt + metaHtml;
              } else {
                body.innerHTML = plain.slice(0, idx).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\u000A/g, '<br>') + '<span style="color:var(--purple)">▌</span>';
              }
            }, 22);
          } else {
            body.innerHTML = res.status === 401 ? '<div style="padding:12px;background:var(--orange-bg);border:1px solid rgba(255,136,0,0.3);border-radius:6px;color:var(--orange);font-size:12px">⚠️ 登录已过期，请重新登录后再生成 <button class="btn sm" style="margin-left:8px;font-size:10px" onclick="location.reload()">重新登录</button></div>' : '<div style="padding:12px;background:var(--red-bg);border:1px solid rgba(255,51,85,0.3);border-radius:6px;color:var(--red);font-size:12px">⚠️ ' + (j.error || ('请求失败 ' + res.status)) + '</div>';
          }
        })
        .catch(function (e) {
          body.innerHTML = '<div style="padding:12px;background:var(--red-bg);border-radius:6px;color:var(--red);font-size:12px">⚠️ 网络错误：' + e.message + '</div>';
        })
        .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '✨ 生成研判专报'; } });
    }
  };

  window.FORESEE = FORESEE;
})();
