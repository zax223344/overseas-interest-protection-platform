/* ============================================================
 * autoalert.js v2.0 — 自动预警引擎独立模块
 * 监测中心 / 自动预警
 *
 * 五大规则引擎:
 *  1. 国家风险阈值 — COUNTRIES中综合风险≥7.0的国家
 *  2. 事件聚集检测 — 同一国家≥2起严重事件
 *  3. 威胁组织活动 — THREAT_DATA中2023年后有事件的威胁组织
 *  4. 企业暴露风险 — ENTERPRISES在高风险国家运营的企业
 *  5. 威胁-企业关联 — 威胁组织活动区域与中资企业运营国家重叠
 *
 * v2.0: 规则卡片可交互，点击展示详细检测数据
 * ============================================================ */

var AUTOALERT = {
  _key: 'orps_auto_alerts',
  _alerts: null,
  _stats: null,
  _hasRun: false,

  init() {
    this._load();
    /* 尝试从后端 API 加载数据 */
    this._loadFromAPI();
    /* 首次访问时自动执行扫描，确保有内容显示 */
    if (this._alerts.length === 0 && !this._hasRun) {
      this.run();
    } else {
      this.render();
    }
  },

  _load() {
    if (this._alerts === null) {
      try {
        var saved = localStorage.getItem(this._key);
        this._alerts = saved ? JSON.parse(saved) : [];
      } catch (e) {
        this._alerts = [];
      }
    }
  },

  /* 从 API 异步加载（在线时覆盖本地数据） */
  _loadFromAPI() {
    var self = this;
    if (typeof APIClient === 'undefined' || !APIClient.isOnline()) return;
    APIClient.getAutoAlerts().then(function(data) {
      if (data && data.alerts && Array.isArray(data.alerts)) {
        self._alerts = data.alerts;
        try { localStorage.setItem(self._key, JSON.stringify(self._alerts)); } catch(e) {}
        self.render();
      }
    }).catch(function() {});
  },

  _save() {
    try {
      localStorage.setItem(this._key, JSON.stringify(this._alerts));
    } catch (e) {}
    /* 异步同步到 PostgreSQL 后端 */
    if (typeof APIClient !== 'undefined' && APIClient.isOnline()) {
      APIClient.saveAutoAlerts(this._alerts).catch(function() {});
    }
  },

  _calcStats() {
    var st = this._stats = { total: this._alerts.length, red: 0, orange: 0, yellow: 0, confirmed: 0, dismissed: 0 };
    this._alerts.forEach(function (a) {
      if (a.level === 'red') st.red++;
      else if (a.level === 'orange') st.orange++;
      else if (a.level === 'yellow') st.yellow++;
      if (a.confirmed) st.confirmed++;
      if (a.dismissed) st.dismissed++;
    });
    return st;
  },

  /* ===== 实时计算各规则检测到的数据量 ===== */
  _getRuleStats() {
    var s = [0, 0, 0, 0, 0];

    /* 规则1: 国家风险≥7.0 */
    if (typeof COUNTRIES !== 'undefined') {
      COUNTRIES.forEach(function (c) {
        var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
        if (ov >= 7.0) s[0]++;
      });
    }

    /* 规则2: 同国≥2起严重事件 */
    if (typeof EVENTS !== 'undefined') {
      var byCountry = {};
      EVENTS.forEach(function (e) {
        if (!byCountry[e.country]) byCountry[e.country] = 0;
        if (e.sev === 'critical' || e.sev === 'high') byCountry[e.country]++;
      });
      Object.keys(byCountry).forEach(function (k) { if (byCountry[k] >= 2) s[1]++; });
    }

    /* 规则3: 威胁组织2023年后有事件 */
    if (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) {
      THREAT_DATA.organizations.forEach(function (org) {
        var recent = (org.events || []).filter(function (e) {
          var yr = parseInt((e.date || '').substring(0, 4));
          return yr >= 2023;
        });
        if (recent.length > 0) s[2]++;
      });
    }

    /* 规则4: 企业在高风险国运营 */
    if (typeof ENTERPRISES !== 'undefined' && typeof COUNTRIES !== 'undefined') {
      ENTERPRISES.forEach(function (ent) {
        ent.countries.forEach(function (ctry) {
          var c = COUNTRIES.find(function (x) { return x.name === ctry; });
          if (c) {
            var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
            if (ov >= 7.5) { s[3]++; return; }
          }
        });
      });
    }

    /* 规则5: 威胁-企业关联 */
    if (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations && typeof ENTERPRISES !== 'undefined') {
      THREAT_DATA.organizations.forEach(function (org) {
        (org.operatingRegions || []).forEach(function (region) {
          var exposed = ENTERPRISES.filter(function (ent) { return ent.countries.indexOf(region) >= 0; });
          if (exposed.length > 0) s[4]++;
        });
      });
    }

    return s;
  },

  /* ===== 执行扫描 ===== */
  run() {
    this._load();
    this._alerts = [];
    var now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').substring(0, 16);

    this._ruleCountryRisk(now);
    this._ruleEventClustering(now);
    this._ruleThreatOrgActivity(now);
    this._ruleEnterpriseExposure(now);
    this._ruleThreatCountryLink(now);

    this._save();
    this._hasRun = true;
    this.render();
    showToast('扫描完成，共生成 ' + this._alerts.length + ' 条预警');
  },

  _ruleCountryRisk(now) {
    if (typeof COUNTRIES === 'undefined') return;
    var self = this;
    COUNTRIES.forEach(function (c) {
      var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
      if (ov >= 7.0) {
        self._alerts.push({
          id: 'AA-CR-' + c.name,
          rule: '国家风险阈值',
          level: ov >= 8.5 ? 'red' : ov >= 7.5 ? 'orange' : 'yellow',
          title: c.flag + ' ' + c.name + ' 综合风险指数 ' + ov.toFixed(1) + '，超出安全阈值',
          desc: c.name + '综合风险评分' + ov.toFixed(1) + '/10，主要风险类型: ' + (c.mainRisk || '综合风险') + '。' + (c.notes || '').substring(0, 150),
          country: c.name,
          relatedEntities: [],
          actions: ['密切关注该国政治安全动态', '评估在涉事国中资企业风险', '准备应急撤离预案'],
          time: now,
          confirmed: false,
          dismissed: false,
          auto: true
        });
      }
    });
  },

  _ruleEventClustering(now) {
    if (typeof EVENTS === 'undefined') return;
    var self = this;
    var byCountry = {};
    EVENTS.forEach(function (e) {
      if (!byCountry[e.country]) byCountry[e.country] = [];
      byCountry[e.country].push(e);
    });
    Object.keys(byCountry).forEach(function (ctry) {
      var events = byCountry[ctry];
      var severe = events.filter(function (e) { return e.sev === 'critical' || e.sev === 'high'; });
      if (severe.length >= 2) {
        self._alerts.push({
          id: 'AA-EC-' + ctry,
          rule: '事件聚集检测',
          level: severe.length >= 3 ? 'red' : 'orange',
          title: ctry + ' 发生 ' + severe.length + ' 起严重安全事件，存在风险聚集',
          desc: ctry + '近期记录' + severe.length + '起严重事件: ' + severe.map(function (e) { return e.title; }).join('；').substring(0, 200),
          country: ctry,
          relatedEntities: severe.map(function (e) { return (e.enterprises || []).join(','); }).filter(Boolean),
          actions: ['启动国别风险专项评估', '通知在该国所有中资企业加强安保', '考虑发布旅行警告'],
          time: now,
          confirmed: false,
          dismissed: false,
          auto: true
        });
      }
    });
  },

  _ruleThreatOrgActivity(now) {
    if (typeof THREAT_DATA === 'undefined' || !THREAT_DATA.organizations) return;
    var self = this;
    THREAT_DATA.organizations.forEach(function (org) {
      /* FIX: 用 e.date 解析年份，原来错误地用了 e.year */
      var recentEvents = (org.events || []).filter(function (e) {
        var yr = parseInt((e.date || '').substring(0, 4));
        return yr >= 2023;
      });
      if (recentEvents.length > 0) {
        var regions = org.operatingRegions || [];
        self._alerts.push({
          id: 'AA-TO-' + org.id,
          rule: '威胁组织活动',
          level: org.threatLevel >= 8 ? 'red' : org.threatLevel >= 6 ? 'orange' : 'yellow',
          title: '威胁组织 "' + org.name + '" 近期活动频繁（' + recentEvents.length + '起事件）',
          desc: org.name + '在2023年后发生' + recentEvents.length + '起事件。活动区域: ' + regions.join('、') + '。' + (org.description || '').substring(0, 150),
          country: regions.join('、'),
          relatedEntities: [],
          actions: ['评估威胁组织活动区域内的中资企业风险', '加强情报收集和分析', '与相关国家安全部门协调'],
          time: now,
          confirmed: false,
          dismissed: false,
          auto: true
        });
      }
    });
  },

  _ruleEnterpriseExposure(now) {
    if (typeof ENTERPRISES === 'undefined' || typeof COUNTRIES === 'undefined') return;
    var self = this;
    ENTERPRISES.forEach(function (ent) {
      ent.countries.forEach(function (ctry) {
        var c = COUNTRIES.find(function (x) { return x.name === ctry; });
        if (c) {
          var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
          if (ov >= 7.5) {
            self._alerts.push({
              id: 'AA-EE-' + ent.id + '-' + ctry,
              rule: '企业暴露风险',
              level: ov >= 8.5 ? 'red' : 'orange',
              title: ent.short + ' 在高风险国家 ' + ctry + ' 运营（风险指数 ' + ov.toFixed(1) + '）',
              desc: ent.name + '在' + ctry + '运营，该国综合风险' + ov.toFixed(1) + '/10。企业投资' + ent.investment + '亿$，人员' + ent.personnel + '人。建议评估资产和人员安全。',
              country: ctry,
              relatedEntities: [ent.short],
              actions: ['评估企业在涉事国的资产和人员安全', '准备应急撤离和资产保全方案', '与驻外使领馆保持沟通'],
              time: now,
              confirmed: false,
              dismissed: false,
              auto: true
            });
          }
        }
      });
    });
  },

  _ruleThreatCountryLink(now) {
    if (typeof THREAT_DATA === 'undefined' || !THREAT_DATA.organizations || typeof ENTERPRISES === 'undefined') return;
    var self = this;
    THREAT_DATA.organizations.forEach(function (org) {
      var regions = org.operatingRegions || [];
      regions.forEach(function (region) {
        var exposedEnts = ENTERPRISES.filter(function (ent) {
          return ent.countries.indexOf(region) >= 0;
        });
        if (exposedEnts.length > 0) {
          var entNames = exposedEnts.map(function (e) { return e.short; }).join('、');
          self._alerts.push({
            id: 'AA-TC-' + org.id + '-' + region,
            rule: '威胁-企业关联',
            level: org.threatLevel >= 8 ? 'red' : 'orange',
            title: '威胁组织 "' + org.name + '" 活动区域 ' + region + ' 涉及 ' + exposedEnts.length + ' 家中资企业',
            desc: org.name + '在' + region + '活动，该国有中资企业: ' + entNames + '。威胁组织威胁等级: ' + org.threatLevel + '/10。建议立即评估企业安全状况。',
            country: region,
            relatedEntities: exposedEnts.map(function (e) { return e.short; }),
            actions: ['立即通知涉事企业加强安保', '评估威胁组织对企业项目的潜在威胁', '启动企安联动机制'],
            time: now,
            confirmed: false,
            dismissed: false,
            auto: true
          });
        }
      });
    });
  },

  /* ===== 操作 ===== */
  confirmAlert(id) {
    this._load();
    var a = this._alerts.find(function (x) { return x.id === id; });
    if (a) { a.confirmed = true; this._save(); this.render(); showToast('预警已确认'); }
  },

  dismissAlert(id) {
    this._load();
    var a = this._alerts.find(function (x) { return x.id === id; });
    if (a) { a.dismissed = true; this._save(); this.render(); showToast('预警已消除'); }
  },

  clearAll() {
    this._alerts = [];
    this._save();
    this._hasRun = false;
    this.render();
    showToast('已清空所有预警');
  },

  /* ===== 转为情报分析素材 ===== */
  _toReport(id) {
    this._load();
    var a = this._alerts.find(function (x) { return x.id === id; });
    if (a && typeof AIREPORT !== 'undefined') {
      AIREPORT.addMaterial('alert', {
        title: a.title, country: a.country, date: a.time,
        severity: a.level, desc: a.desc
      });
    }
  },

  /* ===== 预警详情弹窗 ===== */
  _showDetail(id) {
    this._load();
    var a = this._alerts.find(function (x) { return x.id === id; });
    if (!a) return;
    var lvMap = {
      red: { label: '🔴 紧急', color: 'var(--red)' },
      orange: { label: '🟠 高危', color: 'var(--orange)' },
      yellow: { label: '🟡 中危', color: 'var(--yellow)' }
    };
    var lv = lvMap[a.level] || lvMap.yellow;
    var html = '<div style="padding:12px;max-height:70vh;overflow-y:auto">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
    html += '<span style="font-size:10px;font-weight:700;color:' + lv.color + ';padding:2px 8px;background:' + lv.color + '15;border-radius:4px">' + lv.label + '</span>';
    html += '<span style="font-size:13px;font-weight:700">' + a.title + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:12px;font-size:10px;color:var(--text3);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">';
    html += '<span>📅 ' + (a.time || '') + '</span>';
    html += '<span>🔧 规则: ' + (a.rule || '') + '</span>';
    html += '<span>🌍 ' + (a.country || '') + '</span>';
    html += '<span>' + (a.confirmed ? '✅ 已确认' : a.dismissed ? '❌ 已消除' : '⏳ 待处理') + '</span>';
    html += '</div>';
    html += '<div style="padding:10px;background:var(--bg2);border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--text2);line-height:1.7">' + a.desc + '</div>';
    if (a.relatedEntities && a.relatedEntities.length > 0) {
      html += '<div style="margin-bottom:12px"><b style="color:var(--orange);font-size:11px">关联实体</b><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">';
      a.relatedEntities.forEach(function (e) {
        html += '<span class="badge b-blue" style="font-size:10px">' + e + '</span>';
      });
      html += '</div></div>';
    }
    if (a.actions && a.actions.length > 0) {
      html += '<div style="margin-bottom:12px"><b style="color:var(--cyan);font-size:11px">建议措施</b><div style="display:grid;gap:4px;margin-top:6px">';
      a.actions.forEach(function (act, i) {
        html += '<div style="padding:6px 8px;background:var(--panel2);border-radius:4px;font-size:11px;color:var(--text2)">' + (i + 1) + '. ' + act + '</div>';
      });
      html += '</div></div>';
    }
    html += '<div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">';
    if (!a.confirmed && !a.dismissed) {
      html += '<button class="btn primary sm" onclick="AUTOALERT.confirmAlert(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">✅ 确认预警</button>';
      html += '<button class="btn sm" onclick="AUTOALERT.dismissAlert(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">❌ 消除预警</button>';
    }
    html += '<button class="btn sm" style="background:rgba(0,212,255,0.1);border-color:var(--cyan);color:var(--cyan)" onclick="AUTOALERT._toReport(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">🤖 加入情报分析</button>';
    html += '</div></div>';
    document.getElementById('modal-tt').textContent = '自动预警详情';
    document.getElementById('modal-bd').innerHTML = html;
    document.getElementById('modal').classList.add('show');
  },

  /* ===== 规则详情弹窗（点击规则卡片） ===== */
  _showRuleDetail(idx) {
    var titles = ['国家风险阈值', '事件聚集检测', '威胁组织活动', '企业暴露风险', '威胁-企业关联'];
    var descs = [
      '扫描全部国家的综合风险评分，当综合风险≥7.0时触发预警。综合风险由政治、经济、安全、法律、社会、自然、运营、地缘战略8个维度加权计算。',
      '扫描全部安全事件，按国家分组统计严重事件（critical/high）数量，当同一国家≥2起严重事件时触发预警。',
      '扫描全部威胁组织的事件记录，筛选2023年后发生的重大事件，存在近期活动的组织触发预警。',
      '扫描全部中资企业的运营国家，当企业所在国家的综合风险≥7.5时触发预警，提示企业暴露风险。',
      '交叉分析威胁组织活动区域与中资企业运营国家，当两者重叠时触发预警，提示潜在关联威胁。'
    ];
    var icons = ['🌍', '📡', '🎯', '🏢', '🔗'];
    var html = '<div style="padding:12px;max-height:75vh;overflow-y:auto">';

    /* 规则说明 */
    html += '<div style="background:var(--bg2);border-radius:8px;padding:12px 14px;margin-bottom:14px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:20px">' + icons[idx] + '</span><span style="font-size:14px;font-weight:700;color:var(--cyan)">' + titles[idx] + '</span></div>';
    html += '<div style="font-size:11px;color:var(--text2);line-height:1.6">' + descs[idx] + '</div>';
    html += '</div>';

    /* 各规则详细数据 */
    if (idx === 0) html += this._detailCountryRisk();
    else if (idx === 1) html += this._detailEventClustering();
    else if (idx === 2) html += this._detailThreatOrgActivity();
    else if (idx === 3) html += this._detailEnterpriseExposure();
    else if (idx === 4) html += this._detailThreatCountryLink();

    html += '</div>';

    document.getElementById('modal-tt').innerHTML = icons[idx] + ' ' + titles[idx] + ' — 规则详情';
    document.getElementById('modal-bd').innerHTML = html;
    document.getElementById('modal').classList.add('show');
    var box = document.querySelector('#modal .modal-box');
    if (box) box.style.maxWidth = '860px';
  },

  /* 规则1详情: 国家风险阈值 */
  _detailCountryRisk() {
    if (typeof COUNTRIES === 'undefined') return '<div class="empty">数据未加载</div>';
    var list = COUNTRIES.map(function (c) {
      var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
      return { name: c.name, flag: c.flag, ov: ov, mainRisk: c.mainRisk, trend: c.trend, region: c.region };
    }).sort(function (a, b) { return b.ov - a.ov; });

    var triggered = list.filter(function (c) { return c.ov >= 7.0; });
    var html = '<div style="margin-bottom:10px;font-size:12px;color:var(--text2)">共扫描 ' + list.length + ' 个国家，其中 <span style="color:var(--red);font-weight:700">' + triggered.length + '</span> 个国家综合风险≥7.0触发预警</div>';

    html += '<div style="display:grid;gap:6px">';
    list.forEach(function (c) {
      var isTriggered = c.ov >= 7.0;
      var barColor = c.ov >= 8.5 ? 'var(--red)' : c.ov >= 7.5 ? 'var(--orange)' : c.ov >= 6 ? 'var(--yellow)' : 'var(--green)';
      var trendIcon = c.trend === 'up' ? '📈上升' : c.trend === 'down' ? '📉下降' : '➡️稳定';
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:' + (isTriggered ? 'rgba(255,51,85,0.06)' : 'var(--panel2)') + ';border-radius:6px;border-left:3px solid ' + barColor + '">';
      html += '<span style="font-size:16px">' + c.flag + '</span>';
      html += '<div style="flex:1">';
      html += '<div style="font-size:12px;font-weight:600;color:var(--text)">' + c.name + ' <span style="font-size:9px;color:var(--text3);font-weight:400">' + c.region + '</span></div>';
      html += '<div style="font-size:10px;color:var(--text3)">' + (c.mainRisk || '') + ' · ' + trendIcon + '</div>';
      html += '</div>';
      html += '<div style="width:120px"><div class="risk-bar" style="width:100%;background:var(--bg)"><div class="risk-bar-fill" style="width:' + (c.ov * 10) + '%;background:' + barColor + '"></div></div></div>';
      html += '<span style="font-size:14px;font-weight:700;color:' + barColor + ';min-width:32px;text-align:right">' + c.ov.toFixed(1) + '</span>';
      if (isTriggered) html += '<span class="badge b-red" style="font-size:8px">触发</span>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  },

  /* 规则2详情: 事件聚集检测 */
  _detailEventClustering() {
    if (typeof EVENTS === 'undefined') return '<div class="empty">数据未加载</div>';
    var byCountry = {};
    EVENTS.forEach(function (e) {
      if (!byCountry[e.country]) byCountry[e.country] = [];
      byCountry[e.country].push(e);
    });

    var countries = Object.keys(byCountry).map(function (ctry) {
      var events = byCountry[ctry];
      var severe = events.filter(function (e) { return e.sev === 'critical' || e.sev === 'high'; });
      return { country: ctry, total: events.length, severe: severe.length, events: events, severeEvents: severe };
    }).sort(function (a, b) { return b.severe - a.severe; });

    var triggered = countries.filter(function (c) { return c.severe >= 2; });
    var html = '<div style="margin-bottom:10px;font-size:12px;color:var(--text2)">共扫描 ' + countries.length + ' 个国家的事件，其中 <span style="color:var(--red);font-weight:700">' + triggered.length + '</span> 个国家存在≥2起严重事件聚集</div>';

    html += '<div style="display:grid;gap:10px">';
    countries.forEach(function (c) {
      var isTriggered = c.severe >= 2;
      var sevColor = c.severe >= 3 ? 'var(--red)' : c.severe >= 2 ? 'var(--orange)' : 'var(--green)';
      html += '<div style="padding:10px;background:' + (isTriggered ? 'rgba(255,136,0,0.06)' : 'var(--panel2)') + ';border-radius:8px;border-left:3px solid ' + sevColor + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      html += '<div style="font-size:13px;font-weight:700">🌍 ' + c.country + '</div>';
      html += '<div style="display:flex;gap:6px">';
      html += '<span class="badge b-blue" style="font-size:9px">全部 ' + c.total + '</span>';
      html += '<span class="badge" style="font-size:9px;background:' + sevColor + '22;color:' + sevColor + '">严重 ' + c.severe + '</span>';
      if (isTriggered) html += '<span class="badge b-red" style="font-size:8px">触发预警</span>';
      html += '</div></div>';
      html += '<div style="display:grid;gap:4px">';
      c.events.forEach(function (e) {
        var eColor = e.sev === 'critical' ? 'var(--red)' : e.sev === 'high' ? 'var(--orange)' : 'var(--yellow)';
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg);border-radius:4px">';
        html += '<span style="width:6px;height:6px;border-radius:50%;background:' + eColor + ';flex-shrink:0"></span>';
        html += '<span style="font-size:9px;color:var(--text3);font-family:monospace;min-width:70px">' + e.date + '</span>';
        html += '<span style="font-size:11px;color:var(--text2);flex:1">' + e.title + '</span>';
        html += '<span class="badge" style="font-size:8px;background:' + eColor + '22;color:' + eColor + '">' + e.sev + '</span>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  },

  /* 规则3详情: 威胁组织活动 */
  _detailThreatOrgActivity() {
    if (typeof THREAT_DATA === 'undefined' || !THREAT_DATA.organizations) return '<div class="empty">数据未加载</div>';
    var orgs = THREAT_DATA.organizations.map(function (org) {
      var recent = (org.events || []).filter(function (e) {
        var yr = parseInt((e.date || '').substring(0, 4));
        return yr >= 2023;
      });
      return { org: org, recent: recent };
    }).sort(function (a, b) { return b.recent.length - a.recent.length; });

    var triggered = orgs.filter(function (o) { return o.recent.length > 0; });
    var html = '<div style="margin-bottom:10px;font-size:12px;color:var(--text2)">共扫描 ' + orgs.length + ' 个威胁组织，其中 <span style="color:var(--red);font-weight:700">' + triggered.length + '</span> 个组织在2023年后有活动</div>';

    html += '<div style="display:grid;gap:10px">';
    orgs.forEach(function (item) {
      var org = item.org;
      var isTriggered = item.recent.length > 0;
      var tl = org.threatLevel || 5;
      var tlColor = tl >= 9 ? 'var(--red)' : tl >= 7.5 ? 'var(--orange)' : tl >= 6 ? 'var(--yellow)' : 'var(--green)';
      html += '<div style="padding:10px;background:' + (isTriggered ? 'rgba(255,51,85,0.06)' : 'var(--panel2)') + ';border-radius:8px;border-left:3px solid ' + tlColor + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      html += '<div><span style="font-size:13px;font-weight:700">' + org.name + '</span>';
      html += '<span style="font-size:10px;color:var(--text3);margin-left:6px">' + org.type + ' · ' + org.category + '</span></div>';
      html += '<div style="display:flex;gap:6px">';
      html += '<span class="badge" style="font-size:9px;background:' + tlColor + '22;color:' + tlColor + '">威胁 ' + tl + '</span>';
      if (isTriggered) html += '<span class="badge b-red" style="font-size:8px">触发 (' + item.recent.length + '起)</span>';
      else html += '<span class="badge" style="font-size:8px;background:var(--bg);color:var(--text3)">无近期活动</span>';
      html += '</div></div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-bottom:6px">📍 活动区域: ' + (org.operatingRegions || []).join('、') + '</div>';
      if (item.recent.length > 0) {
        html += '<div style="display:grid;gap:3px">';
        item.recent.forEach(function (e) {
          html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:var(--bg);border-radius:4px">';
          html += '<span style="font-size:9px;color:var(--text3);font-family:monospace;min-width:70px">' + e.date + '</span>';
          html += '<span style="font-size:11px;color:var(--text2);flex:1">' + e.title + '</span>';
          if (e.impact) html += '<span class="badge" style="font-size:8px;background:var(--red)22;color:var(--red)">' + e.impact + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  },

  /* 规则4详情: 企业暴露风险 */
  _detailEnterpriseExposure() {
    if (typeof ENTERPRISES === 'undefined' || typeof COUNTRIES === 'undefined') return '<div class="empty">数据未加载</div>';
    var data = ENTERPRISES.map(function (ent) {
      var exposed = [];
      ent.countries.forEach(function (ctry) {
        var c = COUNTRIES.find(function (x) { return x.name === ctry; });
        if (c) {
          var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
          exposed.push({ country: ctry, flag: c.flag, ov: ov, mainRisk: c.mainRisk, triggered: ov >= 7.5 });
        }
      });
      exposed.sort(function (a, b) { return b.ov - a.ov; });
      return { ent: ent, exposed: exposed, triggerCount: exposed.filter(function (e) { return e.triggered; }).length };
    }).filter(function (d) { return d.exposed.length > 0; }).sort(function (a, b) { return b.triggerCount - a.triggerCount; });

    var totalTriggered = data.reduce(function (s, d) { return s + d.triggerCount; }, 0);
    var html = '<div style="margin-bottom:10px;font-size:12px;color:var(--text2)">共扫描 ' + ENTERPRISES.length + ' 家中资企业，其中 <span style="color:var(--red);font-weight:700">' + totalTriggered + '</span> 个企业-国家组合触发预警（风险≥7.5）</div>';

    html += '<div style="display:grid;gap:10px">';
    data.forEach(function (d) {
      var ent = d.ent;
      var hasTrigger = d.triggerCount > 0;
      html += '<div style="padding:10px;background:' + (hasTrigger ? 'rgba(255,136,0,0.06)' : 'var(--panel2)') + ';border-radius:8px;border-left:3px solid ' + (hasTrigger ? 'var(--orange)' : 'var(--green)') + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      html += '<div><span style="font-size:13px;font-weight:700">' + ent.short + '</span>';
      html += '<span style="font-size:10px;color:var(--text3);margin-left:6px">' + ent.industry + ' · 投资' + ent.investment + '亿$ · ' + ent.personnel + '人</span></div>';
      html += '<div style="display:flex;gap:6px">';
      html += '<span class="badge b-blue" style="font-size:9px">' + ent.countries.length + '国</span>';
      if (hasTrigger) html += '<span class="badge b-red" style="font-size:8px">' + d.triggerCount + '个高风险</span>';
      html += '</div></div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      d.exposed.forEach(function (e) {
        var eColor = e.ov >= 8.5 ? 'var(--red)' : e.ov >= 7.5 ? 'var(--orange)' : e.ov >= 6 ? 'var(--yellow)' : 'var(--green)';
        html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:2px solid ' + eColor + ';min-width:120px">';
        html += '<div style="font-size:11px;font-weight:600">' + e.flag + ' ' + e.country + ' <span style="font-size:10px;color:' + eColor + ';font-weight:700">' + e.ov.toFixed(1) + '</span>';
        if (e.triggered) html += ' <span style="font-size:8px;color:var(--red)">⚠触发</span>';
        html += '</div>';
        html += '<div style="font-size:9px;color:var(--text3)">' + (e.mainRisk || '') + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  },

  /* 规则5详情: 威胁-企业关联 */
  _detailThreatCountryLink() {
    if (typeof THREAT_DATA === 'undefined' || !THREAT_DATA.organizations || typeof ENTERPRISES === 'undefined') return '<div class="empty">数据未加载</div>';
    var links = [];
    THREAT_DATA.organizations.forEach(function (org) {
      (org.operatingRegions || []).forEach(function (region) {
        var exposedEnts = ENTERPRISES.filter(function (ent) { return ent.countries.indexOf(region) >= 0; });
        if (exposedEnts.length > 0) {
          links.push({ org: org, region: region, ents: exposedEnts });
        }
      });
    });

    var html = '<div style="margin-bottom:10px;font-size:12px;color:var(--text2)">交叉分析 ' + THREAT_DATA.organizations.length + ' 个威胁组织的活动区域与 ' + ENTERPRISES.length + ' 家中资企业运营国家，发现 <span style="color:var(--red);font-weight:700">' + links.length + '</span> 个关联重叠</div>';

    /* 按威胁组织分组 */
    var byOrg = {};
    links.forEach(function (l) {
      if (!byOrg[l.org.id]) byOrg[l.org.id] = { org: l.org, links: [] };
      byOrg[l.org.id].links.push(l);
    });

    html += '<div style="display:grid;gap:10px">';
    Object.keys(byOrg).forEach(function (orgId) {
      var group = byOrg[orgId];
      var org = group.org;
      var tl = org.threatLevel || 5;
      var tlColor = tl >= 9 ? 'var(--red)' : tl >= 7.5 ? 'var(--orange)' : tl >= 6 ? 'var(--yellow)' : 'var(--green)';
      var totalEnts = group.links.reduce(function (s, l) { return s + l.ents.length; }, 0);

      html += '<div style="padding:10px;background:rgba(255,51,85,0.06);border-radius:8px;border-left:3px solid ' + tlColor + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<div><span style="font-size:13px;font-weight:700">🎯 ' + org.name + '</span>';
      html += '<span style="font-size:10px;color:var(--text3);margin-left:6px">威胁 ' + tl + '/10</span></div>';
      html += '<span class="badge b-red" style="font-size:9px">' + group.links.length + '个区域 · ' + totalEnts + '家企业</span>';
      html += '</div>';

      group.links.forEach(function (l) {
        html += '<div style="padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px">';
        html += '<div style="font-size:11px;font-weight:600;color:var(--cyan);margin-bottom:4px">📍 ' + l.region + '</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
        l.ents.forEach(function (e) {
          html += '<div style="padding:3px 8px;background:var(--panel2);border-radius:4px;border:1px solid var(--border)">';
          html += '<div style="font-size:11px;font-weight:600">' + e.short + '</div>';
          html += '<div style="font-size:9px;color:var(--text3)">' + e.industry + ' · ' + e.investment + '亿$</div>';
          html += '</div>';
        });
        html += '</div></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  },

  /* ===== 主渲染 ===== */
  render() {
    var el = document.getElementById('autoalert-content');
    if (!el) return;
    this._load();
    var st = this._calcStats();
    var rs = this._getRuleStats();
    var html = '';

    /* 操作栏 */
    html += '<div class="card mb-12">';
    html += '<div class="card-tt"><span class="ic">⚡</span>自动预警引擎';
    html += '<span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:6px">— 五大规则引擎自动扫描系统数据并生成预警</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">';
    html += '<button class="btn primary sm" onclick="AUTOALERT.run()">🔍 立即扫描</button>';
    if (this._alerts.length > 0) {
      html += '<button class="btn sm danger" onclick="showConfirm(\'确定清空所有预警？\',function(){AUTOALERT.clearAll()})">🗑️ 清空预警</button>';
    }
    html += '<span style="font-size:11px;color:var(--text3);margin-left:auto">' + (this._hasRun ? '上次扫描: ' + new Date().toLocaleString('zh-CN', { hour12: false }) : '尚未扫描') + '</span>';
    html += '</div>';

    /* 五大规则卡片 — 可交互 */
    var rules = [
      { ic: '🌍', n: '国家风险阈值', d: '综合风险≥7.0', count: rs[0], color: 'var(--red)' },
      { ic: '📡', n: '事件聚集检测', d: '同国≥2起严重事件', count: rs[1], color: 'var(--orange)' },
      { ic: '🎯', n: '威胁组织活动', d: '2023年后有事件', count: rs[2], color: 'var(--purple)' },
      { ic: '🏢', n: '企业暴露风险', d: '高风险国运营', count: rs[3], color: 'var(--yellow)' },
      { ic: '🔗', n: '威胁-企业关联', d: '活动区涉及中企', count: rs[4], color: 'var(--cyan)' }
    ];
    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:8px">';
    rules.forEach(function (r, i) {
      var hasData = r.count > 0;
      html += '<div onclick="AUTOALERT._showRuleDetail(' + i + ')" style="padding:10px 8px;background:var(--panel2);border-radius:8px;text-align:center;cursor:pointer;transition:.2s;border:1px solid ' + (hasData ? r.color + '44' : 'transparent') + ';position:relative" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 12px ' + r.color + '33\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">';
      html += '<div style="font-size:20px">' + r.ic + '</div>';
      html += '<div style="font-size:10px;font-weight:600;margin-top:3px;color:var(--text)">' + r.n + '</div>';
      html += '<div style="font-size:9px;color:var(--text3);margin-top:1px">' + r.d + '</div>';
      if (hasData) {
        html += '<div style="margin-top:6px"><span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;background:' + r.color + '22;color:' + r.color + '">' + r.count + ' 项</span></div>';
      } else {
        html += '<div style="margin-top:6px"><span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;color:var(--text3)">无数据</span></div>';
      }
      html += '<div style="font-size:8px;color:var(--text3);margin-top:4px;opacity:.6">点击查看详情 →</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    /* 统计 */
    html += '<div class="stat-grid">';
    var stats = [
      { ic: '📊', c: 'var(--cyan)', l: '预警总数', v: st.total },
      { ic: '🔴', c: 'var(--red)', l: '紧急预警', v: st.red },
      { ic: '🟠', c: 'var(--orange)', l: '高危预警', v: st.orange },
      { ic: '✅', c: 'var(--green)', l: '已确认', v: st.confirmed }
    ];
    stats.forEach(function (s) {
      html += '<div class="stat-card"><div class="stat-ic" style="background:rgba(0,212,255,0.08);color:' + s.c + '">' + s.ic + '</div><div class="stat-info"><div class="stat-label">' + s.l + '</div><div class="stat-val" style="color:' + s.c + '">' + s.v + '</div></div></div>';
    });
    html += '</div>';

    /* 预警列表 */
    var active = this._alerts.filter(function (a) { return !a.dismissed; });
    html += '<div class="card mt-12"><div class="card-tt"><span class="ic">🚨</span>预警列表';
    html += '<span class="badge b-blue" style="margin-left:8px">' + active.length + '</span>';
    html += '</div>';

    if (active.length === 0) {
      html += '<div class="empty"><div class="ic">⚡</div>';
      html += '<div style="font-size:13px;margin-bottom:4px">' + (this._hasRun ? '当前无活跃预警' : '尚未执行扫描') + '</div>';
      html += '<div style="font-size:11px">点击"立即扫描"启动五大规则引擎，自动检测系统数据中的风险信号</div></div>';
    } else {
      html += '<div style="display:grid;gap:8px;max-height:500px;overflow-y:auto">';
      active.forEach(function (a) {
        var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : 'var(--yellow)';
        var lvLabel = a.level === 'red' ? '🔴 紧急' : a.level === 'orange' ? '🟠 高危' : '🟡 中危';
        html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;border-left:3px solid ' + lvClr + ';cursor:pointer;transition:.2s" onclick="AUTOALERT._showDetail(\'' + a.id + '\')">';
        html += '<div style="display:flex;justify-content:space-between;align-items:start">';
        html += '<div style="flex:1">';
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
        html += '<span style="font-size:9px;font-weight:700;color:' + lvClr + '">' + lvLabel + '</span>';
        html += '<span class="badge b-purple" style="font-size:8px">' + a.rule + '</span>';
        html += '</div>';
        html += '<div style="font-size:12px;font-weight:600;margin-bottom:2px">' + a.title + '</div>';
        html += '<div style="font-size:10px;color:var(--text3)">' + (a.country || '') + ' | ' + (a.time || '') + '</div>';
        html += '</div>';
        if (!a.confirmed) {
          html += '<div style="display:flex;gap:4px;margin-left:8px" onclick="event.stopPropagation()">';
          html += '<button class="btn sm" style="font-size:8px;padding:1px 6px;min-width:auto;color:var(--green)" onclick="AUTOALERT.confirmAlert(\'' + a.id + '\')">✅</button>';
          html += '<button class="btn sm danger" style="font-size:8px;padding:1px 6px;min-width:auto" onclick="AUTOALERT.dismissAlert(\'' + a.id + '\')">✕</button>';
          html += '</div>';
        } else {
          html += '<span style="font-size:9px;color:var(--green);margin-left:8px">✅ 已确认</span>';
        }
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    el.innerHTML = html;

    /* 更新侧边栏badge */
    var badge = document.getElementById('sb-autoalert-count');
    if (badge) {
      badge.textContent = active.length;
      badge.classList.toggle('zero', active.length === 0);
    }
  }
};
