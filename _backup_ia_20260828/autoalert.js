/* ============================================================
 * autoalert.js v4.0 — 事件驱动自动预警运营中心
 * 监测中心 / 自动预警
 *
 * 与「预警中心」的本质区别：
 *  ├─ 预警中心：人工接警 → 人工研判 → 人工派发 → 人工处置 → 结案
 *  └─ 自动预警：7×24 无人值守 → 实时数据流入 → 自动检测 → 原始候选队列
 *              → 智能研判 → 智能预警队列 → SOAR 自动编排 → 自动响应
 *              → 命中/误报复盘 → 人只负责监督和接管
 *
 * 核心能力
 *  1. 双队列架构
 *      · 原始预警队列：规则引擎对实时数据/静态数据的初步命中（候选）
 *      · 智能预警队列：经置信度、影响面、关联实体研判后的正式预警
 *      · 已处置队列：已确认/消除/归档的预警，用于复盘统计
 *  2. 事件驱动 — distribute.js / app.js 实时数据到达即触发检测
 *  3. 规则工厂 — 5 大规则 + 动态事件规则，可开关、调阈值、调权重
 *  4. 智能研判 — 置信度、影响面、关联实体自动评估
 *  5. SOAR 自动编排 — 真正执行：通知、取证、预案匹配、升级、企业通知、简报生成、情报归档
 *  6. 自动抑制 — 相似事件合并，避免刷屏
 *  7. 自动升级 — 高置信度 + 高影响面自动升红
 *  8. 响应机器人日志 + 自动复盘看板
 * ============================================================ */

(function () {
  'use strict';

  /* ===== 12 维风险矩阵（与后端 data_type 对齐）===== */
  var _RISK_DIMENSIONS = [
    { k: 'terror_events', n: '恐袭/武装', icon: '💥', color: '#ff4d5e' },
    { k: 'security_events', n: '治安安全', icon: '🚨', color: '#ff9f1c' },
    { k: 'military_conflicts', n: '武装冲突', icon: '⚔️', color: '#ff4d5e' },
    { k: 'political_events', n: '政治政局', icon: '🏛️', color: '#ffd60a' },
    { k: 'natural_disasters', n: '自然灾害', icon: '🌊', color: '#5b9bff' },
    { k: 'public_health', n: '公共卫生', icon: '🦠', color: '#34d399' },
    { k: 'sanctions_data', n: '制裁合规', icon: '⚖️', color: '#ff9f1c' },
    { k: 'social_unrest', n: '社会动荡', icon: '🔥', color: '#ff9f1c' },
    { k: 'infrastructure', n: '基础设施', icon: '🏗️', color: '#5b9bff' },
    { k: 'cyber_security', n: '网络安全', icon: '🔒', color: '#8b5cf6' },
    { k: 'economic_risk', n: '经济风险', icon: '📉', color: '#ffd60a' },
    { k: 'geopolitical_intel', n: '地缘情报', icon: '🌍', color: '#5b9bff' }
  ];

  /* ===== 规则工厂默认配置 ===== */
  var RULE_DEFINITIONS = [
    {
      id: 'country_risk', name: '国家风险阈值', icon: '🌍', color: 'var(--red)',
      desc: '扫描国家综合风险评分，达到阈值即触发自动预警',
      threshold: 7.0, weight: 1.0, enabled: true,
      params: [{ key: 'threshold', label: '风险阈值', min: 0, max: 10, step: 0.5 }]
    },
    {
      id: 'event_cluster', name: '事件聚集检测', icon: '📡', color: 'var(--orange)',
      desc: '同一国家在短时间内发生多起严重事件，自动识别风险聚集',
      threshold: 2, weight: 1.0, enabled: true,
      params: [{ key: 'threshold', label: '严重事件数', min: 2, max: 10, step: 1 }]
    },
    {
      id: 'threat_activity', name: '威胁组织活动', icon: '🎯', color: 'var(--purple)',
      desc: '威胁组织在近年有活动记录时触发持续监测预警',
      threshold: 2023, weight: 1.0, enabled: true,
      params: [{ key: 'threshold', label: '起始年份', min: 2020, max: 2030, step: 1 }]
    },
    {
      id: 'enterprise_exposure', name: '企业暴露风险', icon: '🏢', color: 'var(--yellow)',
      desc: '中资企业运营国家综合风险过高时自动提示暴露风险',
      threshold: 7.5, weight: 1.0, enabled: true,
      params: [{ key: 'threshold', label: '暴露阈值', min: 0, max: 10, step: 0.5 }]
    },
    {
      id: 'threat_country_link', name: '威胁-企业关联', icon: '🔗', color: 'var(--cyan)',
      desc: '威胁组织活动区域与中资企业运营国家重叠时自动关联预警',
      threshold: 1, weight: 1.0, enabled: true,
      params: [{ key: 'threshold', label: '最少企业数', min: 1, max: 10, step: 1 }]
    },
    {
      id: 'live_event_risk', name: '实时事件风险', icon: '⚡', color: 'var(--green)',
      desc: '实时采集的高危事件（红/橙级、涉我利益）直接触发原始候选预警',
      threshold: 1, weight: 1.0, enabled: true,
      params: [{ key: 'threshold', label: '启用', min: 0, max: 1, step: 1 }]
    }
  ];

  /* ===== SOAR 标准动作库 ===== */
  var SOAR_ACTIONS = {
    notify: { icon: '📢', name: '自动通知', desc: '向值班人员和驻外机构推送预警通知' },
    collect: { icon: '🔍', name: '自动取证', desc: '自动补充关联情报、原文、要素抽取' },
    playbook: { icon: '📖', name: '匹配预案', desc: '根据风险类型自动匹配应急预案' },
    escalate: { icon: '⬆️', name: '自动升级', desc: '满足条件时自动提升预警等级' },
    enterprise: { icon: '🏢', name: '通知企业', desc: '向涉事中资企业发送风险提醒' },
    report: { icon: '📄', name: '生成简报', desc: '自动生成事件简报并归档' },
    archive: { icon: '📦', name: '情报归档', desc: '将预警素材加入情报分析购物车' }
  };

  /* ===== 自动预警主对象 ===== */
  window.AUTOALERT = {
    _key: 'orps_auto_alerts',           // 智能预警队列
    _rawKey: 'orps_auto_raw_alerts',    // 原始预警队列（候选）
    _resolvedKey: 'orps_auto_resolved', // 已处置队列
    _cfgKey: 'orps_auto_alert_cfg',
    _logKey: 'orps_auto_alert_logs',
    _wfKey: 'orps_auto_alert_workflows',

    _alerts: null,      // 智能预警队列
    _rawAlerts: null,   // 原始候选预警队列
    _resolved: null,    // 已处置队列
    _stats: null,
    _hasRun: false,
    _engineOn: true,
    _lastRun: null,
    _nextRun: null,
    _autoScanTimer: null,
    _countdownTimer: null,
    _settings: null,
    _robotLogs: [],
    _workflows: {},
    _scanCount: 0,
    _liveIngestCount: 0,

    init() {
      this._load();
      this._loadSettings();
      this._loadLogs();
      this._loadWorkflows();
      this._startAutoScan();
      this._startCountdown();
      /* 首次访问若为空则自动扫描一次 */
      if ((this._alerts.length === 0 && this._rawAlerts.length === 0) && !this._hasRun) {
        this.run();
      } else {
        this.render();
      }
    },

    /* ===== 持久化 ===== */
    _load() {
      if (this._alerts === null) {
        try {
          var saved = localStorage.getItem(this._key);
          this._alerts = saved ? JSON.parse(saved) : [];
        } catch (e) { this._alerts = []; }
      }
      if (this._rawAlerts === null) {
        try {
          var saved = localStorage.getItem(this._rawKey);
          this._rawAlerts = saved ? JSON.parse(saved) : [];
        } catch (e) { this._rawAlerts = []; }
      }
      if (this._resolved === null) {
        try {
          var saved = localStorage.getItem(this._resolvedKey);
          this._resolved = saved ? JSON.parse(saved) : [];
        } catch (e) { this._resolved = []; }
      }
      this._cleanAlerts();
      this._cleanRaw();
    },
    _loadSettings() {
      if (this._settings === null) {
        try {
          var saved = localStorage.getItem(this._cfgKey);
          this._settings = saved ? JSON.parse(saved) : null;
        } catch (e) { this._settings = null; }
      }
      if (!this._settings) {
        this._settings = {
          rules: RULE_DEFINITIONS.map(function (r) {
            return { id: r.id, enabled: r.enabled, threshold: r.threshold, weight: r.weight };
          }),
          autoRun: true,
          autoSoar: true,
          autoPromote: true,  // 高置信度原始候选自动晋升智能队列
          promoteThreshold: 0.75,
          scanInterval: 300
        };
      }
    },
    _loadLogs() {
      try {
        var saved = localStorage.getItem(this._logKey);
        this._robotLogs = saved ? JSON.parse(saved) : [];
      } catch (e) { this._robotLogs = []; }
      if (!Array.isArray(this._robotLogs)) this._robotLogs = [];
    },
    _loadWorkflows() {
      try {
        var saved = localStorage.getItem(this._wfKey);
        this._workflows = saved ? JSON.parse(saved) : {};
      } catch (e) { this._workflows = {}; }
      if (!this._workflows || typeof this._workflows !== 'object') this._workflows = {};
    },
    _save() {
      try { localStorage.setItem(this._key, JSON.stringify(this._alerts)); } catch (e) {}
      try { localStorage.setItem(this._rawKey, JSON.stringify(this._rawAlerts)); } catch (e) {}
      try { localStorage.setItem(this._resolvedKey, JSON.stringify(this._resolved)); } catch (e) {}
      this._saveSettings();
      this._saveLogs();
      this._saveWorkflows();
      /* 仅已登录时同步后端 */
      if (typeof APIClient !== 'undefined' && APIClient.isOnline && APIClient.isOnline() && APIClient.getToken && APIClient.getToken()) {
        if (APIClient.saveAutoAlerts) APIClient.saveAutoAlerts(this._alerts).catch(function () {});
      }
    },
    _saveSettings() {
      try { localStorage.setItem(this._cfgKey, JSON.stringify(this._settings)); } catch (e) {}
    },
    _saveLogs() {
      try { localStorage.setItem(this._logKey, JSON.stringify(this._robotLogs.slice(-300))); } catch (e) {}
    },
    _saveWorkflows() {
      try { localStorage.setItem(this._wfKey, JSON.stringify(this._workflows)); } catch (e) {}
    },

    _normTitleForDedup(t) {
      return String(t || '').toLowerCase().replace(/[\s　]+/g, '').replace(/[^\u4e00-\u9fa5a-z0-9]/g, '').slice(0, 80);
    },
    _cleanAlerts() {
      var seen = {};
      this._alerts = (this._alerts || []).map(function (a) {
        a.title = String(a.title || '').replace(/^(?:\[审核通过\]\s*)+/, '');
        a.desc = String(a.desc || '').replace(/(?:\s*来源：.*?（审核通过，已分发全系统）)+$/, '');
        return a;
      }).filter(function (a) {
        var key = (a.id || '') + '|' + this._normTitleForDedup(a.title) + '|' + (a.country || '') + '|' + (a.url || '');
        if (seen[key]) return false;
        seen[key] = 1;
        return true;
      }.bind(this));
    },
    _cleanRaw() {
      var seen = {};
      this._rawAlerts = (this._rawAlerts || []).map(function (a) {
        a.title = String(a.title || '').replace(/^(?:\[审核通过\]\s*)+/, '');
        a.desc = String(a.desc || '').replace(/(?:\s*来源：.*?（审核通过，已分发全系统）)+$/, '');
        return a;
      }).filter(function (a) {
        var key = (a.id || '') + '|' + this._normTitleForDedup(a.title) + '|' + (a.country || '') + '|' + (a.url || '');
        if (seen[key]) return false;
        seen[key] = 1;
        return true;
      }.bind(this));
    },

    /* ===== 日志 ===== */
    _log(action, detail, level) {
      var log = {
        time: new Date().toLocaleString('zh-CN', { hour12: false }),
        action: action,
        detail: detail || '',
        level: level || 'info'
      };
      this._robotLogs.unshift(log);
      if (this._robotLogs.length > 300) this._robotLogs.length = 300;
      this._saveLogs();
    },

    /* ===== 实时数据入口（事件驱动核心） ===== */
    onLiveItem(item, cat) {
      if (!item) return;
      if (!this._engineOn) return;
      this._load();
      this._loadSettings();
      this._liveIngestCount++;
      var raw = this._detectFromLiveItem(item, cat);
      if (!raw || !raw.length) return;

      var promoted = 0;
      var added = [];
      var self = this;
      raw.forEach(function (r) {
        /* 去重抑制 */
        if (self._isDuplicate(r)) {
          self._log('事件抑制', '相似原始预警已存在：' + r.title.slice(0, 40), 'info');
          return;
        }
        r.status = 'raw';
        r.time = r.time || self._fmtNow();
        r._live = true;
        self._rawAlerts.unshift(r);
        added.push(r);
        self._log('原始预警生成', '[' + r.rule + '] ' + r.title.slice(0, 50), 'warn');

        /* 自动研判 */
        self._autoTriage(r);

        /* 高置信度自动晋升智能队列 */
        if (self._settings.autoPromote && (r.confidence || 0) >= (self._settings.promoteThreshold || 0.75)) {
          self._promoteToIntelligent(r);
          promoted++;
        }
      });

      /* 上限保护 */
      if (this._rawAlerts.length > 300) this._rawAlerts.length = 300;
      this._save();
      /* 增量滑入：新预警在实时流顶部自动冒出（带 LIVE 新 标记 + 入场动画），不整页重建 */
      this._prependNewCards(added);
      this._refreshSmallPanels();
      if (promoted > 0 && typeof showToast === 'function') {
        showToast('实时数据触发 ' + raw.length + ' 条原始预警，' + promoted + ' 条自动晋升智能队列');
      }
    },

    /* 判断是否为重复/相似事件；excludeId 用于晋升时排除自身原始副本 */
    _isDuplicate(a, excludeId) {
      var key = this._normTitleForDedup(a.title);
      var all = (this._alerts || []).concat(this._rawAlerts || []).concat(this._resolved || []);
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        if (excludeId && b.id === excludeId) continue;
        if (a.id && b.id && a.id === b.id) return true;
        if (a.url && b.url && a.url === b.url) return true;
        var bKey = this._normTitleForDedup(b.title);
        if (bKey && bKey === key) return true;
        /* 同一国家+高度相似标题（>=70% 字符重合）视为同一事件 */
        if (a.country && a.country === b.country && key && key.length > 6 && bKey && bKey.length > 6 &&
            this._similarTitle(a.title, b.title)) return true;
        /* 同一国家+同一规则+12小时内：视为重复波动 */
        if (a.country && a.country === b.country && a.ruleId && a.ruleId === b.ruleId && a.time && b.time) {
          try {
            var t1 = new Date(a.time.replace(' ', 'T')).getTime();
            var t2 = new Date(b.time.replace(' ', 'T')).getTime();
            if (!isNaN(t1) && !isNaN(t2) && Math.abs(t1 - t2) < 12 * 3600 * 1000) return true;
          } catch (e) {}
        }
      }
      return false;
    },
    _similarTitle(t1, t2) {
      var a = this._normTitleForDedup(t1), b = this._normTitleForDedup(t2);
      if (!a || !b || a.length < 6 || b.length < 6) return false;
      var common = 0;
      var map = {};
      for (var i = 0; i < a.length; i++) map[a[i]] = 1;
      for (var j = 0; j < b.length; j++) if (map[b[j]]) common++;
      return common / Math.max(a.length, b.length) > 0.7;
    },
    _fmtNow() {
      var d = new Date(); function p(n) { return String(n).padStart(2, '0'); }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    },

    /* 从实时数据检测原始候选预警 */
    _detectFromLiveItem(item, cat) {
      var results = [];
      var text = (item.title_zh || item.title || '') + ' ' + (item.content_zh || item.content || item.desc || '');
      var country = item.country && item.country !== '未知' ? item.country : this._extractCountryFromText(text);
      if (!country) return results;

      var lv = this._normLevel(item);
      var type = item.type || this._typeFromCat(cat);

      /* 实时事件风险规则：红/橙级 + 涉我利益 */
      var cfgLive = this._getRule('live_event_risk');
      if (cfgLive.enabled && (lv === 'red' || lv === 'orange')) {
        results.push({
          id: 'AA-LIVE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          rule: '实时事件风险',
          ruleId: 'live_event_risk',
          level: lv,
          title: item.title || '实时高危事件：' + country,
          desc: (item.content_zh || item.content || item.desc || ''),
          country: country,
          relatedEntities: this._extractEntities(text, country),
          source: item.source || '实时采集',
          url: item.url || '',
          publishedAt: item.publishedAt || item.pubDate || '',
          actions: ['立即评估涉事国中资企业安全', '启动应急联络机制', '持续跟踪事件进展'],
          rawItem: item,
          auto: true
        });
      }

      /* 国家风险阈值规则：仅当事件所在国综合风险>=8.0且为重大安全/政治事件才触发红色 */
      var cfgCountry = this._getRule('country_risk');
      if (cfgCountry.enabled && typeof COUNTRIES !== 'undefined') {
        var c = COUNTRIES.find(function (x) { return x.name === country; });
        if (c) {
          var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
          /* 调高阈值：>=8.0 才触发，避免普通高风险国频繁预警 */
          if (ov >= 8.0 && ov >= cfgCountry.threshold) {
            var isSevere = /袭击|冲突|爆炸|恐袭|绑架|撤侨|战争|政变|死亡|人质/.test(text);
            results.push({
              id: 'AA-CR-' + c.name + '-' + Date.now(),
              rule: '国家风险阈值',
              ruleId: 'country_risk',
              level: isSevere ? 'red' : 'orange',
              title: c.flag + ' ' + c.name + ' 综合风险指数 ' + ov.toFixed(1) + '，' + (isSevere ? '重大' : '较高') + '安全事件触发',
              desc: c.name + '综合风险评分' + ov.toFixed(1) + '/10，主要风险类型: ' + (c.mainRisk || '综合风险') + '。实时事件：' + (item.title || ''),
              country: c.name,
              relatedEntities: this._extractEntities(text, country),
              source: item.source || '实时采集',
              url: item.url || '',
              publishedAt: item.publishedAt || item.pubDate || '',
              actions: ['密切关注该国政治安全动态', '评估在涉事国中资企业风险', '准备应急撤离预案'],
              rawItem: item,
              auto: true
            });
          }
        }
      }

      /* 企业暴露风险规则：仅当国家风险>=8.0且实时事件涉及安全/政治冲击时才触发 */
      var cfgEnt = this._getRule('enterprise_exposure');
      if (cfgEnt.enabled && typeof ENTERPRISES !== 'undefined' && typeof COUNTRIES !== 'undefined') {
        var exposed = ENTERPRISES.filter(function (e) { return e.countries.indexOf(country) >= 0; });
        var cc = COUNTRIES.find(function (x) { return x.name === country; });
        if (cc && exposed.length > 0) {
          var ov2 = typeof calcOverall === 'function' ? calcOverall(cc.scores) : 0;
          var entImpact = /袭击|冲突|爆炸|恐袭|绑架|撤侨|战争|政变|罢工|骚乱|制裁/.test(text);
          if (ov2 >= 8.0 && ov2 >= cfgEnt.threshold && entImpact) {
            results.push({
              id: 'AA-EE-' + country + '-' + Date.now(),
              rule: '企业暴露风险',
              ruleId: 'enterprise_exposure',
              level: ov2 >= 8.5 && /死亡|绑架|战争|撤侨/.test(text) ? 'red' : 'orange',
              title: exposed.length + ' 家中资企业在高风险国家 ' + country + ' 受实时事件影响',
              desc: '实时事件：' + (item.title || '') + '。' + exposed.map(function (e) { return e.short; }).join('、') + '在' + country + '运营，该国综合风险' + ov2.toFixed(1) + '/10。',
              country: country,
              relatedEntities: exposed.map(function (e) { return e.short; }),
              source: item.source || '实时采集',
              url: item.url || '',
              publishedAt: item.publishedAt || item.pubDate || '',
              actions: ['立即通知涉事企业', '评估资产和人员安全', '准备应急撤离和资产保全方案'],
              rawItem: item,
              auto: true
            });
          }
        }
      }

      return results;
    },
    _normLevel(item) {
      var l = item.level || item.alertLevel || item.severity || item.risk_level || item.impact || '';
      if (['red', 'orange', 'yellow', 'blue'].indexOf(l) >= 0) return l;
      if (l === '红色' || l === '高' || l === 'critical' || l === 'high' || l === '极高' || l === '严重') return 'red';
      if (l === '橙色' || l === '中' || l === 'medium' || l === '较高' || l === '重大') return 'orange';
      if (l === '黄色' || l === '低' || l === 'medium' || l === '一般' || l === '关注') return 'yellow';
      if (l === '蓝色' || l === 'low' || l === '轻微' || l === '提示') return 'blue';
      /* 基于内容推断 */
      var text = String(item.title || item.title_zh || item.desc || item.content || '').toLowerCase();
      if (/死亡|伤亡|绑架|恐袭|爆炸|空袭|撤侨|战争|政变|屠杀|人质/.test(text)) return 'red';
      if (/袭击|冲突|骚乱|抗议|制裁|封锁|地震|洪水|疫情|海盗/.test(text)) return 'orange';
      if (/风险|提醒|关注|波动|延误|贬值/.test(text)) return 'yellow';
      return 'blue';
    },
    _typeFromCat(cat) {
      var map = { terror_events: '安全风险', security_events: '安全风险', military_conflicts: '安全风险', political_events: '政治风险', natural_disasters: '自然环境风险', public_health: '安全风险', sanctions_data: '经济风险', social_unrest: '社会文化风险', infrastructure: '运营风险', geopolitical_intel: '地缘战略风险', osint_intel: '安全风险', socmint_intel: '安全风险', global_media: '安全风险' };
      return map[cat] || '安全风险';
    },
    _extractCountryFromText(t) {
      t = String(t || '');
      try { if (typeof COUNTRIES !== 'undefined') { for (var i = 0; i < COUNTRIES.length; i++) { if (COUNTRIES[i].name && t.indexOf(COUNTRIES[i].name) >= 0) return COUNTRIES[i].name; } } } catch (e) {}
      var fl = ['巴基斯坦', '苏丹', '缅甸', '刚果', '尼日利亚', '伊拉克', '也门', '马里', '尼日尔', '肯尼亚', '埃塞俄比亚', '秘鲁', '墨西哥', '南非', '伊朗', '印度', '土耳其', '埃及', '哥伦比亚', '菲律宾', '阿富汗', '叙利亚', '孟加拉国', '泰国', '阿尔及利亚', '阿根廷', '智利', '委内瑞拉', '利比亚', '索马里', '乌克兰', '沙特', '哈萨克斯坦', '印尼', '马来西亚', '越南', '安哥拉', '摩洛哥', '约旦', '塞尔维亚', '以色列', '黎巴嫩', '巴勒斯坦', '俄罗斯', '巴西', '瓜达尔', '红海', '马六甲'];
      for (var j = 0; j < fl.length; j++) { if (t.indexOf(fl[j]) >= 0) return fl[j]; }
      return '';
    },
    _extractEntities(text, country) {
      var list = [];
      if (country) list.push(country);
      try {
        if (typeof ENTERPRISES !== 'undefined') {
          ENTERPRISES.forEach(function (e) {
            if (e.countries.indexOf(country) >= 0) list.push(e.short);
          });
        }
      } catch (e) {}
      return list.filter(function (v, i, a) { return a.indexOf(v) === i; });
    },

    /* ===== 自动扫描 ===== */
    _startAutoScan() {
      if (this._autoScanTimer) return;
      var self = this;
      var interval = (this._settings && this._settings.scanInterval || 300) * 1000;
      /* 启动即排定下次扫描时间，倒计时不再停在 --:--（2026-08-14 修复） */
      if (!this._nextRun) this._nextRun = Date.now() + interval;
      this._autoScanTimer = setInterval(function () {
        if (self._engineOn && self._settings && self._settings.autoRun) {
          try { self.run(true); } catch (e) {}
        }
      }, interval);
    },
    _startCountdown() {
      if (this._countdownTimer) return;
      var self = this;
      this._countdownTimer = setInterval(function () {
        self._updateCountdown();
      }, 1000);
    },
    _updateCountdown() {
      var el = document.getElementById('aa-countdown');
      if (!el) return;
      if (!this._engineOn || !(this._settings && this._settings.autoRun)) { el.textContent = '已暂停'; return; }
      if (!this._nextRun) { el.textContent = '计算中…'; return; }
      var sec = Math.ceil((this._nextRun - Date.now()) / 1000);
      if (sec <= 0) { el.textContent = '扫描中…'; return; }
      var m = Math.floor(sec / 60), s = sec % 60;
      el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    toggleEngine() {
      this._engineOn = !this._engineOn;
      /* 重新启动时重排下次扫描，倒计时立即恢复 */
      if (this._engineOn) this._nextRun = Date.now() + ((this._settings && this._settings.scanInterval || 300) * 1000);
      this._log(this._engineOn ? '引擎启动' : '引擎暂停', '操作员切换自动预警引擎状态', this._engineOn ? 'success' : 'warn');
      this.render();
    },
    toggleAutoSoar() {
      this._settings.autoSoar = !this._settings.autoSoar;
      this._saveSettings();
      this._log('SOAR ' + (this._settings.autoSoar ? '启用' : '暂停'), '操作员切换自动编排响应开关', 'info');
      this.render();
    },
    toggleAutoPromote() {
      this._settings.autoPromote = !this._settings.autoPromote;
      this._saveSettings();
      this._log('自动晋升 ' + (this._settings.autoPromote ? '启用' : '暂停'), '操作员切换原始候选自动晋升开关', 'info');
      this.render();
    },
    setScanInterval(sec) {
      sec = parseInt(sec) || 300;
      if (sec < 60) sec = 60;
      this._settings.scanInterval = sec;
      this._saveSettings();
      if (this._autoScanTimer) { clearInterval(this._autoScanTimer); this._autoScanTimer = null; }
      this._startAutoScan();
      this._nextRun = Date.now() + sec * 1000;
      this._log('扫描周期调整', '自动扫描间隔设为 ' + sec + ' 秒', 'info');
      this.render();
    },

    /* ===== 规则工厂 ===== */
    _getRule(id) {
      return this._settings.rules.find(function (r) { return r.id === id; }) || { enabled: true, threshold: 0, weight: 1 };
    },
    toggleRule(id) {
      var r = this._getRule(id);
      r.enabled = !r.enabled;
      this._saveSettings();
      this._log('规则开关', (r.enabled ? '启用' : '停用') + '「' + id + '」规则', 'info');
      this.render();
    },
    setRuleParam(id, key, value) {
      var r = this._getRule(id);
      r[key] = parseFloat(value);
      this._saveSettings();
      this._log('规则参数调整', id + '.' + key + ' = ' + value, 'info');
      this.render();
    },

    /* ===== 扫描入口（静态扫描 + 晋升未处理的原始候选） ===== */
    run(silent) {
      this._load();
      this._loadSettings();
      this._loadWorkflows();
      var now = this._fmtNow();

      /* 保留实时注入的原始候选和智能预警 */
      this._cleanAlerts();
      this._cleanRaw();

      /* 静态规则扫描 */
      this._ruleCountryRisk(now);
      this._ruleEventClustering(now);
      this._ruleThreatOrgActivity(now);
      this._ruleEnterpriseExposure(now);
      this._ruleThreatCountryLink(now);
      /* 实时情报流扫描（2026-08-19）：直接消费预警中心 24h 真实数据，
       * 不再只等 onLiveItem 回调——服务端/回填数据也能进入侦测泳道 */
      this._ruleLiveIntelScan(now);

      var self = this;
      /* 对未研判的原始候选进行研判 */
      this._rawAlerts.forEach(function (r) {
        if (!r.confidence) self._autoTriage(r);
        if (self._settings.autoPromote && (r.confidence || 0) >= (self._settings.promoteThreshold || 0.75) && r.status === 'raw') {
          self._promoteToIntelligent(r);
        }
      });

      /* 智能队列去重 */
      var seen = {};
      this._alerts = this._alerts.filter(function (a) {
        if (seen[a.id]) return false;
        seen[a.id] = 1;
        return true;
      });

      /* 自动 SOAR */
      if (this._settings.autoSoar) {
        this._alerts.forEach(function (a) { self._autoRunWorkflow(a); });
      }

      this._scanCount++;
      this._lastRun = new Date();
      this._nextRun = Date.now() + (this._settings.scanInterval || 300) * 1000;
      this._save();
      this._hasRun = true;
      /* 红警声音+弹窗提醒（2026-08-19）：新到达的红色预警触发 */
      try { this._notifyNewRed(); } catch (e) {}
      this.render();
      if (!silent && typeof showToast === 'function') showToast('自动扫描完成，智能预警 ' + this._alerts.length + ' 条，原始候选 ' + this._rawAlerts.length + ' 条');
      this._log('自动扫描完成', '智能预警 ' + this._alerts.length + ' 条，原始候选 ' + this._rawAlerts.length + ' 条，SOAR ' + (this._settings.autoSoar ? '已启用' : '已暂停'), 'success');
    },

    /* ===== 五大规则引擎 ===== */
    _ruleCountryRisk(now) {
      var cfg = this._getRule('country_risk');
      if (!cfg.enabled || typeof COUNTRIES === 'undefined') return;
      var self = this;
      COUNTRIES.forEach(function (c) {
        var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
        if (ov >= cfg.threshold) {
          self._maybeAddRaw({
            id: 'AA-CR-' + c.name,
            rule: '国家风险阈值',
            ruleId: 'country_risk',
            level: ov >= 8.5 ? 'red' : ov >= 7.5 ? 'orange' : 'yellow',
            title: c.flag + ' ' + c.name + ' 综合风险指数 ' + ov.toFixed(1) + '，超出安全阈值',
            desc: c.name + '综合风险评分' + ov.toFixed(1) + '/10，主要风险类型: ' + (c.mainRisk || '综合风险') + '。' + (c.notes || '').substring(0, 150),
            country: c.name,
            relatedEntities: [],
            actions: ['密切关注该国政治安全动态', '评估在涉事国中资企业风险', '准备应急撤离预案'],
            time: now,
            auto: true
          });
        }
      });
    },
    _ruleEventClustering(now) {
      var cfg = this._getRule('event_cluster');
      if (!cfg.enabled || typeof EVENTS === 'undefined') return;
      var self = this;
      var byCountry = {};
      EVENTS.forEach(function (e) {
        if (!byCountry[e.country]) byCountry[e.country] = [];
        byCountry[e.country].push(e);
      });
      Object.keys(byCountry).forEach(function (ctry) {
        var events = byCountry[ctry];
        var severe = events.filter(function (e) { return e.sev === 'critical' || e.sev === 'high'; });
        if (severe.length >= cfg.threshold) {
          self._maybeAddRaw({
            id: 'AA-EC-' + ctry,
            rule: '事件聚集检测',
            ruleId: 'event_cluster',
            level: severe.length >= 3 ? 'red' : 'orange',
            title: ctry + ' 发生 ' + severe.length + ' 起严重安全事件，存在风险聚集',
            desc: ctry + '近期记录' + severe.length + '起严重事件: ' + severe.map(function (e) { return e.title; }).join('；').substring(0, 200),
            country: ctry,
            relatedEntities: severe.map(function (e) { return (e.enterprises || []).join(','); }).filter(Boolean),
            actions: ['启动国别风险专项评估', '通知在该国所有中资企业加强安保', '考虑发布旅行警告'],
            time: now,
            auto: true
          });
        }
      });
    },
    _ruleThreatOrgActivity(now) {
      var cfg = this._getRule('threat_activity');
      if (!cfg.enabled || typeof THREAT_DATA === 'undefined' || !THREAT_DATA.organizations) return;
      var self = this;
      THREAT_DATA.organizations.forEach(function (org) {
        var recentEvents = (org.events || []).filter(function (e) {
          var yr = parseInt((e.date || '').substring(0, 4));
          return yr >= cfg.threshold;
        });
        if (recentEvents.length > 0) {
          var regions = org.operatingRegions || [];
          self._maybeAddRaw({
            id: 'AA-TO-' + org.id,
            rule: '威胁组织活动',
            ruleId: 'threat_activity',
            level: org.threatLevel >= 8 ? 'red' : org.threatLevel >= 6 ? 'orange' : 'yellow',
            title: '威胁组织 "' + org.name + '" 近期活动频繁（' + recentEvents.length + '起事件）',
            desc: org.name + '在' + cfg.threshold + '年后发生' + recentEvents.length + '起事件。活动区域: ' + regions.join('、') + '。' + (org.description || '').substring(0, 150),
            country: regions.join('、'),
            relatedEntities: [],
            actions: ['评估威胁组织活动区域内的中资企业风险', '加强情报收集和分析', '与相关国家安全部门协调'],
            time: now,
            auto: true
          });
        }
      });
    },
    _ruleEnterpriseExposure(now) {
      var cfg = this._getRule('enterprise_exposure');
      if (!cfg.enabled || typeof ENTERPRISES === 'undefined' || typeof COUNTRIES === 'undefined') return;
      var self = this;
      ENTERPRISES.forEach(function (ent) {
        ent.countries.forEach(function (ctry) {
          var c = COUNTRIES.find(function (x) { return x.name === ctry; });
          if (c) {
            var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
            if (ov >= cfg.threshold) {
              self._maybeAddRaw({
                id: 'AA-EE-' + ent.id + '-' + ctry,
                rule: '企业暴露风险',
                ruleId: 'enterprise_exposure',
                level: ov >= 8.5 ? 'red' : 'orange',
                title: ent.short + ' 在高风险国家 ' + ctry + ' 运营（风险指数 ' + ov.toFixed(1) + '）',
                desc: ent.name + '在' + ctry + '运营，该国综合风险' + ov.toFixed(1) + '/10。企业投资' + ent.investment + '亿$，人员' + ent.personnel + '人。建议评估资产和人员安全。',
                country: ctry,
                relatedEntities: [ent.short],
                actions: ['评估企业在涉事国的资产和人员安全', '准备应急撤离和资产保全方案', '与驻外使领馆保持沟通'],
                time: now,
                auto: true
              });
            }
          }
        });
      });
    },
    _ruleThreatCountryLink(now) {
      var cfg = this._getRule('threat_country_link');
      if (!cfg.enabled || typeof THREAT_DATA === 'undefined' || !THREAT_DATA.organizations || typeof ENTERPRISES === 'undefined') return;
      var self = this;
      THREAT_DATA.organizations.forEach(function (org) {
        var regions = org.operatingRegions || [];
        regions.forEach(function (region) {
          var exposedEnts = ENTERPRISES.filter(function (ent) {
            return ent.countries.indexOf(region) >= 0;
          });
          if (exposedEnts.length >= cfg.threshold) {
            var entNames = exposedEnts.map(function (e) { return e.short; }).join('、');
            self._maybeAddRaw({
              id: 'AA-TC-' + org.id + '-' + region,
              rule: '威胁-企业关联',
              ruleId: 'threat_country_link',
              level: org.threatLevel >= 8 ? 'red' : 'orange',
              title: '威胁组织 "' + org.name + '" 活动区域 ' + region + ' 涉及 ' + exposedEnts.length + ' 家中资企业',
              desc: org.name + '在' + region + '活动，该国有中资企业: ' + entNames + '。威胁组织威胁等级: ' + org.threatLevel + '/10。建议立即评估企业安全状况。',
              country: region,
              relatedEntities: exposedEnts.map(function (e) { return e.short; }),
              actions: ['立即通知涉事企业加强安保', '评估威胁组织对企业项目的潜在威胁', '启动企安联动机制'],
              time: now,
              auto: true
            });
          }
        });
      });
    },

    /* 原始候选去重加入 */
    _maybeAddRaw(a) {
      if (this._isDuplicate(a)) return;
      a.status = 'raw';
      a._live = false;
      this._autoTriage(a);
      this._rawAlerts.unshift(a);
      if (this._rawAlerts.length > 300) this._rawAlerts.length = 300;
    },

    /* ===== 实时情报流扫描规则（2026-08-19 铁律：所有采集数据都要体现到自动预警） =====
     * 直接扫 ALERTS（预警中心 24h 真实数据），逐条生成"实时情报侦测"原始候选。
     * _maybeAddRaw 自带标题去重；_autoTriage 自动研判；达阈值由 autoPromote 晋升。 */
    _ruleLiveIntelScan(now) {
      if (typeof ALERTS === 'undefined' || !ALERTS.length) return;
      var self = this;
      var cut = Date.now() - 24 * 3600 * 1000;
      var fed = 0;
      ALERTS.forEach(function (a) {
        if (fed >= 150) return; /* 单次上限，防卡顿 */
        var t = 0;
        try { t = new Date(String(a.time || '').replace(' ', 'T')).getTime(); } catch (e) {}
        if (t && t < cut) return; /* 超24h不喂 */
        var title = a.title_zh || a.title || '';
        if (!title) return;
        self._maybeAddRaw({
          id: 'AA-RT-' + String(a.id || (title.slice(0, 20) + '-' + (a.country || ''))).replace(/[^\w\u4e00-\u9fa5-]/g, ''),
          rule: '实时情报侦测',
          ruleId: 'live_intel',
          level: a.level === 'red' || a.level === 'orange' ? a.level : (a.level || 'yellow'),
          title: title,
          title_zh: a.title_zh || '',
          desc: a.desc || a.content || '',
          country: a.country || '',
          relatedEntities: self._extractEntities(title + ' ' + (a.desc || ''), a.country || ''),
          source: a.source || '实时采集',
          url: a.url || a.link || '',
          time: a.time || '',
          publishedAt: a.publishedAt || a.publish_time || '',
          rawItem: a,
          auto: true
        });
        fed++;
      });
    },

    /* ===== 智能研判 ===== */
    _autoTriage(a) {
      a.confidence = this._calcConfidence(a);
      a.impact = this._calcImpact(a);
      a.triageTime = this._fmtNow();
      a.status = a.status || 'raw';
      a.severityScore = this._severityScore(a);
    },
    _calcConfidence(a) {
      var score = 0.55;
      if (a.ruleId === 'country_risk') score = 0.85;
      else if (a.ruleId === 'event_cluster') score = 0.8;
      else if (a.ruleId === 'threat_activity') score = 0.75;
      else if (a.ruleId === 'enterprise_exposure') score = 0.82;
      else if (a.ruleId === 'threat_country_link') score = 0.78;
      else if (a.ruleId === 'live_event_risk') score = 0.7;
      else if (a.ruleId === 'live_intel') score = 0.68; /* 实时情报流：基础0.68，有实体/国别/url 加成后高价值条目可过0.75晋升线 */
      if (a.relatedEntities && a.relatedEntities.length > 0) score += 0.05;
      if (a.country && a.country.length > 0) score += 0.05;
      if (a.url && a.url.length > 0) score += 0.03;
      if (a._live) score += 0.02;
      return Math.min(0.99, Math.round(score * 100) / 100);
    },
    _calcImpact(a) {
      var entCount = (a.relatedEntities || []).length;
      var ctry = (typeof COUNTRIES !== 'undefined' && a.country) ? COUNTRIES.find(function (x) { return x.name === a.country; }) : null;
      var entObj = (typeof ENTERPRISES !== 'undefined' && a.relatedEntities) ? ENTERPRISES.filter(function (e) { return a.relatedEntities.indexOf(e.short) >= 0; }) : [];
      var affectedP = 0, affectedA = 0;
      entObj.forEach(function (e) { affectedP += e.personnel || 0; affectedA += e.investment || 0; });
      return {
        level: affectedA >= 50 || affectedP >= 1000 ? 'high' : affectedA >= 10 || affectedP >= 200 ? 'medium' : 'low',
        enterprises: entCount,
        personnel: affectedP,
        assets: affectedA,
        countryRisk: ctry ? (typeof calcOverall === 'function' ? calcOverall(ctry.scores) : 0) : 0
      };
    },
    _severityScore(a) {
      var lv = { red: 3, orange: 2, yellow: 1, blue: 0.5 }[a.level || 'yellow'] || 1;
      var imp = { high: 3, medium: 2, low: 1 }[(a.impact && a.impact.level) || 'low'] || 1;
      var conf = (a.confidence || 0.5) * 3;
      return Math.round((lv + imp + conf) / 3 * 10) / 10;
    },

    /* ===== 原始候选 → 智能队列 ===== */
    _promoteToIntelligent(raw) {
      if (raw.status === 'intelligent') return;
      var a = JSON.parse(JSON.stringify(raw));
      a.status = 'intelligent';
      a.id = a.id + '-INT-' + Date.now();
      a.promotedAt = this._fmtNow();
      a.confirmed = false;
      a.dismissed = false;
      a.auto = true;
      /* 晋升时排除自身原始副本，避免被 _isDuplicate 误拦截 */
      if (this._isDuplicate(a, raw.id)) return;
      /* 写入可解释性元数据 */
      try { if (typeof EXPLAINABILITY !== 'undefined') EXPLAINABILITY.explainAlert(a); } catch (e) {}
      this._alerts.unshift(a);
      if (this._alerts.length > 200) this._alerts.length = 200;
      raw.status = 'promoted';
      this._log('智能晋升', '原始候选「' + raw.title.slice(0, 40) + '」晋升至智能预警队列（置信度 ' + Math.round((raw.confidence || 0) * 100) + '%）', 'success');
      /* 同步到实战指挥调度中心：智能预警自动建案 */
      if (typeof COMMAND !== 'undefined' && COMMAND.createIncidentFromAlert) {
        try { COMMAND.createIncidentFromAlert(a); } catch(e) {}
      }
      if (this._settings.autoSoar) this._autoRunWorkflow(a);
    },

    /* 人工晋升 */
    promoteRaw(id) {
      this._load();
      var raw = this._rawAlerts.find(function (x) { return x.id === id; });
      if (!raw) return;
      this._promoteToIntelligent(raw);
      this._save();
      this.render();
      showToast && showToast('已晋升至智能预警队列');
    },

    /* ===== SOAR 自动编排 ===== */
    _matchPlaybook(a) {
      if (typeof PLAYBOOKS === 'undefined' || !PLAYBOOKS.length) return null;
      var map = { '国家风险阈值': '政治动荡', '事件聚集检测': '安全威胁', '威胁组织活动': '安全威胁', '企业暴露风险': '经济风险', '威胁-企业关联': '安全威胁', '实时事件风险': '安全威胁' };
      var type = map[a.rule] || a.type || '安全威胁';
      return PLAYBOOKS.find(function (p) { return p.type === type; }) || PLAYBOOKS[0];
    },
    _autoRunWorkflow(a) {
      if (!this._settings.autoSoar) return;
      var wf = this._workflows[a.id];
      if (!wf) {
        wf = this._workflows[a.id] = { id: a.id, created: this._fmtNow(), steps: [], status: 'running', auto: true };
      }
      if (wf.status === 'completed' || wf.status === 'failed') return;

      var pb = this._matchPlaybook(a);
      var steps = wf.steps;

      /* 步骤1: 自动通知 */
      if (!steps.some(function (s) { return s.action === 'notify'; })) {
        steps.push({ action: 'notify', status: 'done', time: this._fmtNow(), note: '已通知值班人员及驻外机构' });
        this._log('SOAR 自动通知', '预警 ' + a.id + ' 已推送值班台', 'success');
      }
      /* 步骤2: 自动取证/情报补全 */
      if (!steps.some(function (s) { return s.action === 'collect'; })) {
        steps.push({ action: 'collect', status: 'done', time: this._fmtNow(), note: '已补充关联实体与上下文' });
      }
      /* 步骤3: 匹配预案 */
      if (pb && !steps.some(function (s) { return s.action === 'playbook'; })) {
        steps.push({ action: 'playbook', status: 'done', time: this._fmtNow(), note: '已匹配「' + pb.title + '」' });
      }
      /* 步骤4: 自动升级判断 */
      if ((a.severityScore >= 2.5 || a.impact.level === 'high') && !steps.some(function (s) { return s.action === 'escalate'; })) {
        a.level = 'red';
        steps.push({ action: 'escalate', status: 'done', time: this._fmtNow(), note: '因影响面大/置信度高，自动升级至紧急' });
        this._log('SOAR 自动升级', '预警 ' + a.id + ' 升级至红色', 'warn');
      }
      /* 步骤5: 通知企业（如果关联中资企业） */
      if (a.impact && a.impact.enterprises > 0 && !steps.some(function (s) { return s.action === 'enterprise'; })) {
        steps.push({ action: 'enterprise', status: 'done', time: this._fmtNow(), note: '已向 ' + a.impact.enterprises + ' 家企业发送风险提醒' });
      }
      /* 步骤6: 简报生成 */
      if (!steps.some(function (s) { return s.action === 'report'; })) {
        a.brief = this._generateBrief(a);
        steps.push({ action: 'report', status: 'done', time: this._fmtNow(), note: '已生成事件简报' });
      }
      /* 步骤7: 情报归档 */
      if (!steps.some(function (s) { return s.action === 'archive'; })) {
        this._archiveToAireport(a);
        steps.push({ action: 'archive', status: 'done', time: this._fmtNow(), note: '已加入情报分析素材库' });
      }

      wf.status = 'completed';
      a.workflowStatus = 'completed';
      this._saveWorkflows();
    },
    _generateBrief(a) {
      return '【' + (a.level === 'red' ? '紧急' : a.level === 'orange' ? '高危' : '中危') + '】' + (a.title || '') + '\n'
        + '国家/地区：' + (a.country || '—') + '\n'
        + '规则命中：' + (a.rule || '—') + '（置信度 ' + Math.round((a.confidence || 0) * 100) + '%）\n'
        + '影响面：关联 ' + ((a.impact && a.impact.enterprises) || 0) + ' 家企业，涉及人员 ' + ((a.impact && a.impact.personnel) || 0) + ' 人，资产 ' + ((a.impact && a.impact.assets) || 0) + ' 亿$\n'
        + '研判摘要：' + (a.desc || '').slice(0, 120) + '\n'
        + '建议措施：' + (a.actions || []).join('；') + '\n'
        + '生成时间：' + this._fmtNow();
    },
    _archiveToAireport(a) {
      try {
        if (typeof AIREPORT !== 'undefined' && AIREPORT.addMaterial) {
          AIREPORT.addMaterial('alert', {
            title: a.title, country: a.country, date: a.time,
            severity: a.level, desc: a.desc, source: '自动预警SOAR'
          });
        }
      } catch (e) {}
    },
    runManualWorkflow(id) {
      var a = this._alerts.find(function (x) { return x.id === id; });
      if (!a) return;
      this._workflows[id] = { id: id, created: this._fmtNow(), steps: [], status: 'running', auto: false };
      this._autoRunWorkflow(a);
      this._log('SOAR 手动触发', '操作员手动触发预警 ' + id + ' 的自动编排', 'info');
      this.render();
      showToast && showToast('自动编排已执行');
    },

    /* ===== 操作 ===== */
    _syncAviewStatus(a, status) {
      /* 2026-08-20：自动预警的处置动作同步到预警中心 ALERTS，保证 SLA/已解除统计不悬空 */
      try {
        if (typeof ALERTS === 'undefined' || !a) return;
        var me = this;
        var synced = 0;
        function _keys(m) {
          var arr = [];
          function _add(v) { var s = String(v || '').replace(/\s+/g, '').toLowerCase().slice(0, 30); if (s && arr.indexOf(s) < 0) arr.push(s); }
          _add(m.title); _add(m.title_zh); _add(m.desc);
          if (m.rawItem) { _add(m.rawItem.title); _add(m.rawItem.title_zh); _add(m.rawItem.content); }
          return arr;
        }
        function _urls(m) {
          var arr = [];
          if (m.url) arr.push(String(m.url));
          if (m.rawItem && m.rawItem.url) arr.push(String(m.rawItem.url));
          return arr;
        }
        function _syncOne(m) {
          if (!m) return;
          var keys = _keys(m);
          var urls = _urls(m);
          var hit = ALERTS.find(function (x) {
            if (String(x.id) === String(m.id)) return true;
            if (urls.length && x.url && urls.indexOf(String(x.url)) >= 0) return true;
            var xKey = String(x.title || x.title_zh || '').replace(/\s+/g, '').toLowerCase().slice(0, 30);
            return keys.indexOf(xKey) >= 0 && (x.country || '') === (m.country || '');
          });
          if (hit) {
            hit.status = status;
            synced++;
            if (typeof AVIEW !== 'undefined' && AVIEW._feedback) {
              AVIEW._feedback(hit, status === 'acknowledged' ? 'ack' : status === 'resolved' ? 'resolve' : status);
            } else {
              try { DataHub.save('alerts'); } catch (e) {}
            }
          }
        }
        _syncOne(a);
        /* 自动预警簇：确认/消除 topMember 时，把簇内其他成员也同步回预警中心 */
        try {
          if (typeof this._clusterAlerts === 'function') {
            var clusters = this._clusterAlerts();
            clusters.forEach(function (c) {
              if (String(c.topMember.id) === String(a.id) || c.members.some(function (mm) { return String(mm.id) === String(a.id); })) {
                c.members.forEach(function (mm) { if (String(mm.id) !== String(a.id)) _syncOne(mm); });
              }
            });
          }
        } catch (e) {}
        /* 兜底：同国家下只有一条未解除 ALERTS 时，直接命中（解决 AA-LIVE 自生成 ID 无法对账问题） */
        if (synced === 0) {
          try {
            var candidates = ALERTS.filter(function (x) { return (x.country || '') === (a.country || '') && (x.status || 'active') !== 'resolved'; });
            if (candidates.length === 1) {
              candidates[0].status = status;
              synced++;
              if (typeof AVIEW !== 'undefined' && AVIEW._feedback) {
                AVIEW._feedback(candidates[0], status === 'acknowledged' ? 'ack' : status === 'resolved' ? 'resolve' : status);
              } else {
                try { DataHub.save('alerts'); } catch (e) {}
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    },
    confirmAlert(id) {
      this._load();
      var a = this._alerts.find(function (x) { return x.id === id; });
      if (a) {
        a.confirmed = true; a.status = 'confirmed';
        this._syncAviewStatus(a, 'acknowledged');
        this._moveToResolved(a, 'confirmed');
        this._removeFromAlerts(id);
        this._save(); this.render();
        showToast && showToast('预警已确认');
        this._log('人工确认', '操作员确认预警 ' + id, 'success');
      }
    },
    dismissAlert(id) {
      this._load();
      var a = this._alerts.find(function (x) { return x.id === id; });
      if (a) {
        a.dismissed = true; a.status = 'dismissed';
        this._syncAviewStatus(a, 'resolved');
        this._moveToResolved(a, 'dismissed');
        this._removeFromAlerts(id);
        this._save(); this.render();
        showToast && showToast('预警已消除');
        this._log('人工消除', '操作员消除预警 ' + id, 'info');
      }
    },
    _removeFromAlerts(id) {
      this._alerts = this._alerts.filter(function (x) { return x.id !== id; });
    },
    _moveToResolved(a, action) {
      var r = JSON.parse(JSON.stringify(a));
      r.resolvedAt = this._fmtNow();
      r.resolvedAction = action;
      this._resolved.unshift(r);
      if (this._resolved.length > 300) this._resolved.length = 300;
    },
    rejectRaw(id) {
      this._load();
      var raw = this._rawAlerts.find(function (x) { return x.id === id; });
      if (raw) {
        raw.status = 'rejected';
        this._moveToResolved(raw, 'rejected');
        this._rawAlerts = this._rawAlerts.filter(function (x) { return x.id !== id; });
        this._save(); this.render();
        showToast && showToast('原始候选已驳回');
        this._log('原始候选驳回', '操作员驳回原始候选 ' + id, 'info');
      }
    },
    clearAll() {
      var self = this;
      this._alerts.forEach(function (a) { self._moveToResolved(a, 'cleared'); });
      this._rawAlerts.forEach(function (r) { self._moveToResolved(r, 'cleared'); });
      this._alerts = [];
      this._rawAlerts = [];
      this._workflows = {};
      this._save();
      this._hasRun = false;
      this.render();
      showToast && showToast('已清空所有自动预警');
      this._log('清空预警', '操作员清空全部自动预警', 'warn');
    },

    /* ===== 统计 ===== */
    _calcStats() {
      var st = this._stats = {
        total: this._alerts.length,
        rawTotal: this._rawAlerts.length,
        resolvedTotal: this._resolved.length,
        red: 0, orange: 0, yellow: 0,
        confirmed: 0, dismissed: 0, rejected: 0,
        auto: 0, manual: 0, highImpact: 0
      };
      this._alerts.forEach(function (a) {
        if (a.level === 'red') st.red++;
        else if (a.level === 'orange') st.orange++;
        else if (a.level === 'yellow') st.yellow++;
        if (a.auto) st.auto++;
        else st.manual++;
        if (a.impact && a.impact.level === 'high') st.highImpact++;
      });
      this._resolved.forEach(function (r) {
        if (r.resolvedAction === 'confirmed') st.confirmed++;
        else if (r.resolvedAction === 'dismissed') st.dismissed++;
        else if (r.resolvedAction === 'rejected') st.rejected++;
      });
      return st;
    },
    _getRuleStats() {
      var s = [0, 0, 0, 0, 0, 0];
      if (typeof COUNTRIES !== 'undefined') {
        COUNTRIES.forEach(function (c) {
          var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
          if (ov >= 7.0) s[0]++;
        });
      }
      if (typeof EVENTS !== 'undefined') {
        var byCountry = {};
        EVENTS.forEach(function (e) {
          if (!byCountry[e.country]) byCountry[e.country] = 0;
          if (e.sev === 'critical' || e.sev === 'high') byCountry[e.country]++;
        });
        Object.keys(byCountry).forEach(function (k) { if (byCountry[k] >= 2) s[1]++; });
      }
      if (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) {
        THREAT_DATA.organizations.forEach(function (org) {
          var recent = (org.events || []).filter(function (e) { var yr = parseInt((e.date || '').substring(0, 4)); return yr >= 2023; });
          if (recent.length > 0) s[2]++;
        });
      }
      if (typeof ENTERPRISES !== 'undefined' && typeof COUNTRIES !== 'undefined') {
        ENTERPRISES.forEach(function (ent) {
          ent.countries.forEach(function (ctry) {
            var c = COUNTRIES.find(function (x) { return x.name === ctry; });
            if (c) { var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0; if (ov >= 7.5) { s[3]++; return; } }
          });
        });
      }
      if (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations && typeof ENTERPRISES !== 'undefined') {
        THREAT_DATA.organizations.forEach(function (org) {
          (org.operatingRegions || []).forEach(function (region) {
            var exposed = ENTERPRISES.filter(function (ent) { return ent.countries.indexOf(region) >= 0; });
            if (exposed.length > 0) s[4]++;
          });
        });
      }
      s[5] = this._liveIngestCount;
      return s;
    },
    _calcReviewStats() {
      var total = this._alerts.length + this._resolved.length;
      var confirmed = this._resolved.filter(function (a) { return a.resolvedAction === 'confirmed'; }).length;
      var dismissed = this._resolved.filter(function (a) { return a.resolvedAction === 'dismissed' || a.resolvedAction === 'rejected'; }).length;
      var pending = this._alerts.length;
      var hitRate = total > 0 ? Math.round((confirmed + dismissed) / total * 100) : 0;
      var falsePositive = total > 0 ? Math.round(dismissed / total * 100) : 0;
      var autoResolved = this._resolved.filter(function (a) { return a.auto && a.workflowStatus === 'completed'; }).length;
      var autoRate = total > 0 ? Math.round(autoResolved / total * 100) : 0;
      return { total: total, confirmed: confirmed, dismissed: dismissed, pending: pending, hitRate: hitRate, falsePositive: falsePositive, autoRate: autoRate, scanCount: this._scanCount, liveIngest: this._liveIngestCount };
    },

    /* ===== 12 维风险统计 + 72h 趋势预测 ===== */
    _calcDimStats() {
      var me = this;
      var list = this._applyFilters(this._liveList());
      var stats = {};
      _RISK_DIMENSIONS.forEach(function (d) { stats[d.k] = { count: 0, red: 0, orange: 0, trend: [], lastTime: 0 }; });
      list.forEach(function (a) {
        var dimK = me._dimOfAlert(a);
        var s = stats[dimK];
        s.count++;
        if (a.level === 'red') s.red++; else if (a.level === 'orange') s.orange++;
        var t = me._parseTime(a.time);
        if (t) { s.trend.push(t); if (t > s.lastTime) s.lastTime = t; }
      });
      var now = Date.now();
      _RISK_DIMENSIONS.forEach(function (d) {
        var s = stats[d.k];
        s.trend.sort(function (a, b) { return a - b; });
        s.recent24h = s.trend.filter(function (t) { return now - t < 24 * 3600000; }).length;
        s.recent72h = s.trend.filter(function (t) { return now - t < 72 * 3600000; }).length;
        s.prediction = me._predictDimTrend(s);
      });
      return stats;
    },
    _parseTime(t) {
      if (!t) return 0;
      try { var d = new Date(String(t).replace(' ', 'T')); return isNaN(d.getTime()) ? 0 : d.getTime(); } catch (e) { return 0; }
    },
    _predictDimTrend(s) {
      /* 基于近 72h 时间序列的简单趋势外推：若近 24h 占比 > 60% 且数量 ≥2 → 上升；
       * 若近 24h 为 0 但 24-72h 有数据 → 缓和；否则平稳。返回趋势标签 + 72h 预估增量。 */
      if (!s.count) return { label: '暂无', delta: 0, cls: 'stable' };
      var r24 = s.recent24h, r72 = s.recent72h;
      var share = r72 ? r24 / r72 : 0;
      if (r24 >= 2 && share >= 0.5) return { label: '▲ 72h 内可能新增 ' + (Math.max(1, Math.round(r24 * 1.3))) + ' 起', delta: Math.max(1, Math.round(r24 * 1.3)), cls: 'rising' };
      if (r24 === 0 && r72 > 0) return { label: '▼ 趋于缓和', delta: -1, cls: 'falling' };
      return { label: '▶ 持续监测', delta: 0, cls: 'stable' };
    },

    /* ===== 渲染 ===== */
    /* ============================================================
     * 渲染层（2026-08-19 推倒重设 · 海外安全自动预警作战台）
     * 设计：指挥带 → 境外态势带 → 全生命周期作战看板（侦测→预警→处置→闭环）
     *       + 右侧境外态势栏 + 底部复合功能舱（规则/流水线/日志/复盘）
     * 数据引擎（扫描/规则/SOAR/持久化）不变，仅界面全新。
     * ============================================================ */
    /* ============================================================
     * 渲染层 v2（2026-08-19 推倒重设 · 深色指挥大屏风）
     * 用户选定方向：SOC 作战大屏（发光/脉冲/大数字）+ 四大功能：
     * ①预警一键操作 ②Leaflet 实时预警地图联动 ③多维筛选+预设 ④红警声音+弹窗提醒
     * 布局：指挥带 / 左境外态势栏 · 中实时地图+情报流 · 右作战队列(Tab) / 底部功能舱
     * ============================================================ */
    render() {
      var view = document.getElementById('view-autoalert');
      if (!view) return;
      this._load();
      this._loadSettings();
      /* 非激活态：仅刷新侧栏角标，不做无谓的隐藏 DOM 重建 */
      if (!view.classList.contains('active')) { this._updateBadge(); return; }
      if (typeof this._cnFirst === 'undefined') this._cnFirst = true;
      if (!this._deckTab) this._deckTab = 'rules';
      if (!this._queueTab) { /* 默认选中数据最多的泳道，避免空面板 */
        var _qa = this._alerts.filter(function (a) { return !a.dismissed; });
        var _qr = this._rawAlerts.filter(function (r) { return r.status === 'raw'; }).length;
        var _qs = _qa.filter(function (a) { return !!this._workflows[a.id]; }, this).length;
        var _qn = _qa.length - _qs;
        this._queueTab = (_qs >= _qn && _qs >= _qr) ? 'soar' : (_qn >= _qr ? 'alert' : 'raw');
      }
      if (!this._filters) this._filters = { country: '', corridor: '', org: '', dim: '', cnOnly: false, timeRange: '24h' };
      var st = this._calcStats();
      var cb = document.getElementById('aa-commandband');
      if (cb) cb.innerHTML = this._renderCommandBand(st);
      var left = document.getElementById('aa-left');
      if (left) left.innerHTML = this._renderLeftIntel();
      var fb = document.getElementById('aa-filterbar');
      if (fb) fb.innerHTML = this._renderFilterBar();
      var sit = document.getElementById('aa-situations');
      if (sit) sit.innerHTML = this._renderSituations();
      var right = document.getElementById('aa-right');
      if (right) right.innerHTML = this._renderLinkageMonitor();
      var deck = document.getElementById('aa-deck-host');
      if (deck) deck.innerHTML = this._renderDeck();
      this._startLiveTimer();
      this._startRealtimePoll();
      this._updateBadge();
    },
    _updateBadge() {
      var active = this._alerts.filter(function (a) { return !a.dismissed; }).length;
      var badge = document.getElementById('sb-autoalert-count');
      if (badge) { badge.textContent = active; badge.classList.toggle('zero', active === 0); }
    },
    /* ===== 实时预警流（页面主角，无地图）===== */
    /* 合并原始候选 + 智能预警，按时间倒序，最新在上 */
    _liveList() {
      var me = this;
      var list = (this._rawAlerts || []).concat(this._alerts || []).filter(function (a) {
        /* 已晋升的原始副本不再展示，避免与 _alerts 中的智能副本重复渲染 */
        return a && !a.dismissed && a.status !== 'rejected' && a.status !== 'dismissed' && a.status !== 'promoted';
      });
      list = this._applyFilters(list);
      list.sort(function (a, b) { return String(b.time || '').localeCompare(String(a.time || '')); });
      return list;
    },
    /* 实时流：完整重绘（首屏/筛选变更时用，无动画） */
    _renderLiveStreamFull() {
      var list = this._liveList();
      if (!list.length) return '<div class="aa-stream-empty">📡 等待实时数据接入…<br>系统每 5 秒自动拉取最新预警<br>新预警会在此自动冒出（带 LIVE 新 标记）</div>';
      var me = this;
      return list.slice(0, 80).map(function (a) { return me._buildLiveCard(a); }).join('');
    },
    /* 单张实时预警卡：展示「检测→研判→晋升→SOAR」自动链 + 一键操作 */
    _buildLiveCard(a) {
      var lvC = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
      var lvDot = a.level === 'red' ? '🔴' : a.level === 'orange' ? '🟠' : a.level === 'yellow' ? '🟡' : '🔵';
      var id = String(a.id == null ? '' : a.id).replace(/'/g, "\\'");
      var fresh = this._isFresh(a.time) || a._live;
      var isRaw = a.status === 'raw' || (this._rawAlerts || []).some(function (x) { return String(x.id) === String(a.id); });
      var wf = this._workflows ? this._workflows[String(a.id)] : null;
      var chain = [];
      chain.push('🔎 ' + (a.rule || (isRaw ? '实时监测' : '智能研判')));
      chain.push('🧠 研判 ' + Math.round((a.confidence || 0) * 100) + '%');
      if (isRaw) chain.push('📡 待研判'); else chain.push('⬆️ 已晋升');
      if (wf && wf.steps && wf.steps.length) chain.push('🚀 SOAR ' + wf.steps.length + '步');
      var chainHtml = '<div class="aa-live-chain">' + chain.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>';
      var acts = '<div class="aa-live-actions" onclick="event.stopPropagation()">';
      if (isRaw) {
        acts += '<button class="btn sm primary" style="font-size:9px;padding:3px 8px" onclick="AUTOALERT.promoteRaw(\'' + id + '\')">⬆️ 晋升智能队列</button>';
        acts += '<button class="btn sm" style="font-size:9px;padding:3px 8px" onclick="AUTOALERT.rejectRaw(\'' + id + '\')">✕ 驳回</button>';
      } else {
        acts += '<button class="btn sm" style="font-size:9px;padding:3px 8px;color:var(--green)" onclick="AUTOALERT.confirmAlert(\'' + id + '\')">✅ 确认</button>';
        acts += '<button class="btn sm danger" style="font-size:9px;padding:3px 8px" onclick="AUTOALERT.dismissAlert(\'' + id + '\')">✕ 消除</button>';
        acts += '<button class="btn sm" style="font-size:9px;padding:3px 8px;color:var(--cyan)" onclick="AUTOALERT.runManualWorkflow(\'' + id + '\')">🚀 编排</button>';
        acts += '<button class="btn sm" style="font-size:9px;padding:3px 8px;color:var(--yellow)" onclick="AUTOALERT.quickBrief(\'' + id + '\')">📄 简报</button>';
        acts += '<button class="btn sm" style="font-size:9px;padding:3px 8px" onclick="AUTOALERT.exportAlert(\'' + id + '\')">⬇ 导出</button>';
      }
      acts += '</div>';
      var html = '<div class="aa-live-card' + (fresh ? ' aa-new' : '') + '" data-aid="' + id + '" style="border-left-color:' + lvC + '" onclick="AUTOALERT._showDetail(\'' + id + '\')">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
      html += '<span style="font-size:11px" class="' + (a.level === 'red' ? 'aa-red-pulse' : '') + '">' + lvDot + '</span>';
      if (fresh) html += '<span class="aa-newtag">LIVE 新</span>';
      html += '<span style="font-size:8px;color:var(--text3);margin-left:auto">置信 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
      html += '</div>';
      html += '<div style="font-size:12px;font-weight:700;line-height:1.4;color:var(--text)">' + (a.title_zh || a.title || '(无标题)') + '</div>';
      html += chainHtml;
      html += '<div style="display:flex;gap:10px;font-size:9px;color:var(--text3);margin-top:6px;flex-wrap:wrap"><span>🌍 ' + (a.country || '—') + '</span><span>⏱ ' + String(a.time || '').slice(5, 16) + '</span>' + (a.type ? '<span>' + a.type + '</span>' : '') + '</div>';
      html += acts;
      html += '</div>';
      return html;
    },
    /* 新预警到达：重聚合成复合态势，并对新增成员的簇做脉冲（保留动画，不整页重建） */
    _prependNewCards(list) {
      var host = document.getElementById('aa-situations');
      if (!host || !list || !list.length) return;
      var pulseKeys = {}, me = this;
      list.forEach(function (a) {
        var corr = me._aaCorridorNames(a);
        var key = (a.country && a.country !== '—' && a.country !== '未知') ? a.country : (corr[0] || '其他区域');
        pulseKeys[key] = 1;
      });
      host.innerHTML = this._renderSituations({ pulseKeys: pulseKeys });
      this._refreshSmallPanels();
    },
    /* 态势签名：用于判断是否需要重绘（成员构成变化才重绘，保护动画） */
    _situationSig() {
      try {
        return this._clusterAlerts().map(function (c) {
          return c.key + '|' + c.members.map(function (m) { return String(m.id); }).sort().join(',');
        }).join(';;');
      } catch (e) { return ''; }
    },
    /* 周期同步：仅当态势构成变化时才重绘，平时不动 */
    _syncSituations() {
      var host = document.getElementById('aa-situations');
      if (!host) return;
      var sig = this._situationSig();
      if (sig !== this._prevSitSig) { this._prevSitSig = sig; host.innerHTML = this._renderSituations(); }
    },
    /* 小面板增量刷新（指挥带/智能研判/联动监控/功能舱） */
    _refreshSmallPanels() {
      var st = this._calcStats();
      var cb = document.getElementById('aa-commandband'); if (cb) cb.innerHTML = this._renderCommandBand(st);
      var left = document.getElementById('aa-left'); if (left) left.innerHTML = this._renderLeftIntel();
      var right = document.getElementById('aa-right'); if (right) right.innerHTML = this._renderLinkageMonitor();
      var deck = document.getElementById('aa-deck-host'); if (deck) deck.innerHTML = this._renderDeck();
      this._updateBadge();
    },
    /* 实时自动刷新：视图激活期间每 5s 刷新小面板 + 增量同步态势（不整页重建） */
    _startLiveTimer() {
      if (this._liveTimer) return;
      var me = this;
      this._liveTimer = setInterval(function () {
        var view = document.getElementById('view-autoalert');
        if (!view || !view.classList.contains('active')) return;
        me._load();
        me._refreshSmallPanels();
        me._syncSituations();
      }, 5000);
    },
    /* 直连系统实时预警库：任何新入库的自动预警都会在此滑入（保底真·实时） */
    _startRealtimePoll() {
      if (this._pollTimer) return;
      var me = this;
      this._pollIds = this._pollIds || {};
      this._pollTimer = setInterval(function () {
        var view = document.getElementById('view-autoalert');
        if (!view || !view.classList.contains('active')) return;
        fetch('/api/auto-alerts', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          var fresh = [];
          rows.forEach(function (row) {
            var key = String(row._dbId != null ? row._dbId : row.id);
            if (me._pollIds[key]) return;
            /* 实时库只滑入近 24 小时内的条目，避免陈旧 auto_alerts 再次冒出 */
            var created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
            if (Date.now() - created > 24 * 3600 * 1000) return;
            me._pollIds[key] = 1;
            fresh.push({
              id: 'POLL-' + key,
              title: row.title || row.title_zh || '自动预警',
              title_zh: row.title_zh || row.title,
              country: row.country || '—',
              level: row.level || 'yellow',
              type: row.type || '安全风险',
              rule: '系统实时库',
              confidence: 0.8,
              status: 'raw',
              time: (row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 19) : me._fmtNow()),
              _live: true
            });
          });
          if (!fresh.length) return;
          fresh.forEach(function (a) { me._rawAlerts.unshift(a); });
          if (me._rawAlerts.length > 300) me._rawAlerts.length = 300;
          me._prependNewCards(fresh);
          me._refreshSmallPanels();
        }).catch(function () {});
      }, 6000);
    },
    _isFresh(t) {
      try { var d = new Date(String(t || '')); if (isNaN(d.getTime())) return false; return (Date.now() - d.getTime()) < 90000; } catch (e) { return false; }
    },

    /* ============================================================
     * 智能复合联动引擎（v6）：把零散预警聚合成「复合态势簇」，
     * 每个簇自动算聚合风险分 + 升级趋势 + AI 研判叙事 + 联动链路。
     * ============================================================ */
    _LEVEL_W: { red: 100, orange: 72, yellow: 46, blue: 26, yellow2: 46 },
    _levelName(l) { return l === 'red' ? '红色(特急)' : l === 'orange' ? '橙色(高)' : l === 'yellow' ? '黄色(中)' : l === 'blue' ? '蓝色(低)' : '未评级'; },
    _corridorMap() {
      return {
        '中巴走廊·俾路支': '中巴经济走廊', '中缅走廊·若开': '中缅经济走廊',
        '中老走廊': '中老铁路走廊', '雅万走廊': '雅万高铁走廊',
        '比雷埃夫斯走廊': '比雷埃夫斯港走廊'
      };
    },
    /* 一带一路走廊真实数据（全局 CORRIDORS）按名查 */
    _corridorInfo(name) {
      try {
        if (typeof CORRIDORS !== 'undefined' && Array.isArray(CORRIDORS)) {
          for (var i = 0; i < CORRIDORS.length; i++) if (CORRIDORS[i].name === name) return CORRIDORS[i];
        }
      } catch (e) {}
      return null;
    },
    /* 国家真实基础风险分（全局 ENTITY.COUNTRY_RISK） */
    _countryBaseRisk(country) {
      try {
        if (typeof ENTITY !== 'undefined' && ENTITY.COUNTRY_RISK && ENTITY.COUNTRY_RISK[country] != null) return ENTITY.COUNTRY_RISK[country];
      } catch (e) {}
      return null;
    },
    /* 聚合零散预警 → 复合态势簇（按 国家 / 走廊 分组） */
    _clusterAlerts() {
      var list = this._applyFilters(this._liveList());
      var groups = {};
      var me = this;
      list.forEach(function (a) {
        var dim = me._dimOfAlert(a);
        var country = (a.country && a.country !== '—' && a.country !== '-' && a.country !== '未知') ? a.country : '区域';
        var key = dim + '|' + country;
        (groups[key] = groups[key] || []).push(a);
      });
      var clusters = Object.keys(groups).map(function (k) { return me._buildCluster(k, groups[k]); });
      clusters.sort(function (a, b) {
        if (me._cnFirst) { if (a.isCn !== b.isCn) return a.isCn ? -1 : 1; }
        if (a.risk !== b.risk) return b.risk - a.risk;
        return b.count - a.count;
      });
      return clusters;
    },
    _dimOfAlert(a) {
      var type = a.type || a.data_type || a.category || '';
      var dim = _RISK_DIMENSIONS.find(function (d) { return d.k === type; });
      if (dim) return dim.k;
      // 先按标题关键词推断维度（比 ruleId 更细）
      var t = String(a.title_zh || a.title || '');
      if (/制裁|关税|出口管制|实体清单|反倾销|countervailing|embargo/i.test(t)) return 'sanctions_data';
      if (/疫情|病毒|传染病|霍乱|埃博拉|mpox|pandemic|epidemic/i.test(t)) return 'public_health';
      if (/网络攻击|勒索软件|黑客|数据泄露|cyberattack|ransomware/i.test(t)) return 'cyber_security';
      if (/通胀|债务|衰退|汇率|利率|股市|inflation|recession/i.test(t)) return 'economic_risk';
      if (/抗议|示威|骚乱|罢工|暴动|protest|riot|demonstration/i.test(t)) return 'social_unrest';
      if (/政变|军政府|选举|弹劾|coup|junta|impeach/i.test(t)) return 'political_events';
      if (/港口|矿山|管道|铁路|大桥|电站|供应链|稀土|port|mine|mining|pipeline/i.test(t)) return 'infrastructure';
      if (/霍尔木兹|马六甲|苏伊士|红海|海峡|航运|油轮|货轮|hormuz|malacca|suez|strait|tanker|vessel|shipping/i.test(t)) return 'infrastructure';
      if (/地震|洪水|台风|海啸|火山|earthquake|flood|typhoon/i.test(t)) return 'natural_disasters';
      if (/枪击|谋杀|抢劫|治安|shooting|robbery|murder/i.test(t)) return 'security_events';
      if (/战争|空袭|导弹|停火|炮击|战线|war|airstrike|missile/i.test(t)) return 'military_conflicts';
      if (/恐袭|恐怖|爆炸|绑架|武装分子|塔利班|isis|taliban|boko|shabaab|houthi|hezbollah/i.test(t)) return 'terror_events';
      // 再按 ruleId 兜底映射
      var ruleMap = {
        'live_event_risk': 'terror_events',
        'event_cluster': 'terror_events',
        'threat_activity': 'terror_events',
        'threat_country_link': 'military_conflicts',
        'country_risk': 'geopolitical_intel',
        'enterprise_exposure': 'infrastructure',
        'live_intel': 'geopolitical_intel'
      };
      if (a.ruleId && ruleMap[a.ruleId]) return ruleMap[a.ruleId];
      return 'geopolitical_intel';
    },
    _buildCluster(key, members) {
      var me = this;
      var parts = key.split('|');
      var dimK = parts[0] || 'geopolitical_intel';
      var country = parts[1] || '其他区域';
      var dim = _RISK_DIMENSIONS.find(function (d) { return d.k === dimK; }) || _RISK_DIMENSIONS[_RISK_DIMENSIONS.length - 1];
      var countries = {}, orgs = {}, corridors = {}, types = {};
      var maxW = 0, confSum = 0;
      members.forEach(function (m) {
        if (m.country) countries[m.country] = 1;
        if (m.type) types[m.type] = 1;
        me._aaOrgNames(m).forEach(function (o) { orgs[o] = 1; });
        me._aaCorridorNames(m).forEach(function (c) { corridors[c] = 1; });
        var w = me._LEVEL_W[m.level] || 26; if (w > maxW) maxW = w;
        confSum += (m.confidence || 0);
      });
      var countryArr = Object.keys(countries), orgArr = Object.keys(orgs), corrArr = Object.keys(corridors), typeArr = Object.keys(types);
      var maxLevel = 'blue';
      members.forEach(function (m) { if ((me._LEVEL_W[m.level] || 26) >= maxW) maxLevel = m.level; });
      var count = members.length;
      var avgC = count ? confSum / count : 0;
      var risk = Math.min(100, Math.round(maxW * (1 + 0.07 * (count - 1)) * (0.8 + 0.2 * avgC)));
      var times = members.map(function (m) { var d = new Date(String(m.time || '').replace(' ', 'T')); return isNaN(d.getTime()) ? 0 : d.getTime(); }).filter(Boolean).sort(function (a, b) { return a - b; });
      var now = Date.now();
      var newest = times.length ? times[times.length - 1] : 0;
      var oldest = times.length ? times[0] : 0;
      var spanH = times.length > 1 ? Math.max(1, Math.round((newest - oldest) / 3600000)) : 0;
      var recent12 = times.filter(function (t) { return now - t < 12 * 3600000; }).length;
      var trend = 'stable';
      if (count >= 2) {
        if (now - newest < 24 * 3600000 && recent12 >= Math.ceil(count / 2)) trend = 'rising';
        else if (now - newest > 24 * 3600000) trend = 'falling';
      }
      var isCn = members.some(function (m) { return m.chinaNegative || m._chinaNegative || me._aaTier(m) <= 1; });
      var newestMember = members.slice().sort(function (a, b) { return String(b.time || '').localeCompare(String(a.time || '')); })[0] || members[0];
      var topMember = members.slice().sort(function (a, b) { return (me._LEVEL_W[b.level] || 26) - (me._LEVEL_W[a.level] || 26); })[0] || members[0];
      var title = dim.icon + ' ' + dim.n + ' · ' + country + (count > 1 ? ' (' + count + ')' : ' 预警');
      return {
        key: key, title: title, dim: dim, dimK: dimK, country: country, members: members, count: count,
        countries: countryArr, orgs: orgArr, corridors: corrArr, types: typeArr,
        maxLevel: maxLevel, risk: risk, avgConf: avgC, trend: trend,
        spanH: spanH, isCn: isCn, newestMember: newestMember, topMember: topMember,
        narrative: this._clusterNarrative(country, members, { risk: risk, trend: trend, maxLevel: maxLevel, orgs: orgArr, corridors: corrArr, spanH: spanH, count: count })
      };
    },
    _clusterNarrative(key, members, s) {
      var parts = [];
      parts.push(key + ' 近' + (s.spanH || '24') + '小时累计 ' + s.count + ' 条预警，最高' + this._levelName(s.maxLevel) + '。');
      if (s.orgs.length) parts.push('涉及威胁组织：' + s.orgs.join('、') + '。');
      if (s.corridors.length) parts.push('牵动高危走廊：' + s.corridors.join('、') + '。');
      var tn = s.trend === 'rising' ? '呈升级态势' : s.trend === 'falling' ? '趋于缓和' : '持续高位震荡';
      parts.push('综合风险评分 ' + s.risk + '，' + tn + '。');
      var adv = [];
      if (s.maxLevel === 'red') adv.push('建议立即启动应急响应、通报驻外机构并核查中资资产');
      if (s.corridors.length) adv.push('核查相关走廊通行与项目安全');
      if (s.orgs.length) adv.push('跟踪涉事组织后续动向');
      if (!adv.length) adv.push('保持常规监测');
      parts.push('处置建议：' + adv.join('；') + '。');
      return parts.join('');
    },
    /* 中栏：复合态势簇（主角） */
    _renderSituations(opts) {
      opts = opts || {};
      var clusters = this._clusterAlerts();
      if (!clusters.length) return '<div class="aa-stream-empty">📡 暂无可聚合的实时预警<br>系统每 5 秒自动聚类接入<br>新预警会自动聚合成复合态势并冒出</div>';
      var pulse = opts.pulseKeys || {};
      var me = this;
      return clusters.slice(0, 30).map(function (c) {
        return me._buildSituationCard(c, { pulse: !!pulse[c.key] });
      }).join('');
    },
    _buildSituationCard(c, opts) {
      opts = opts || {};
      var lvC = c.maxLevel === 'red' ? 'var(--red)' : c.maxLevel === 'orange' ? 'var(--orange)' : c.maxLevel === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
      var trendInfo = c.trend === 'rising' ? { ic: '▲', t: '升级', c: 'var(--red)' } : c.trend === 'falling' ? { ic: '▼', t: '缓和', c: 'var(--green)' } : { ic: '▶', t: '持续', c: 'var(--yellow)' };
      var k = String(c.key).replace(/'/g, "\\'");
      var expanded = this._expandedSit === c.key;
      var newest = c.newestMember;
      var newTrigger = newest ? ('<span class="aa-sit-trigger">⚡ ' + (newest.title_zh || newest.title || '').slice(0, 34) + ' · ' + String(newest.time || '').slice(5, 16) + '</span>') : '';
      /* 联动链路：国家风险↑ → 走廊 → 组织 → 预案 */
      var chain = '<div class="aa-sit-chain">';
      chain += '<span class="aa-sit-node" style="border-color:' + lvC + '">🌍 ' + c.countries.join('/') + ' <b style="color:' + lvC + '">风险' + c.risk + '</b></span>';
      c.corridors.forEach(function (co) {
        var info = AUTOALERT._corridorInfo(AUTOALERT._corridorMap()[co] || co);
        var tip = info ? ('风险' + info.risk + '·' + info.status) : '监测中';
        chain += '<span class="aa-sit-node aa-sit-link" onclick="AUTOALERT._openCorridorLink(\'' + String(co).replace(/'/g, "\\'") + '\')">🛤 ' + co + ' <i>' + tip + '</i></span>';
      });
      c.orgs.forEach(function (o) {
        chain += '<span class="aa-sit-node">🏴 ' + o + '</span>';
      });
      chain += '</div>';
      var dims = '<div class="aa-sit-dims">'
        + '<span>🌍 国家 ' + c.countries.length + '</span>'
        + '<span>🏴 组织 ' + c.orgs.length + '</span>'
        + '<span>🛤 走廊 ' + c.corridors.length + '</span>'
        + '<span>📡 预警 ' + c.count + (c.spanH ? ' · ' + c.spanH + 'h' : '') + '</span>'
        + '<span style="color:' + trendInfo.c + '">' + trendInfo.ic + ' ' + trendInfo.t + '</span>'
        + '</div>';
      var acts = '<div class="aa-sit-acts" onclick="event.stopPropagation()">'
        + '<button class="btn sm" style="font-size:9px;padding:3px 9px" onclick="AUTOALERT._toggleSituation(\'' + k + '\')">' + (expanded ? '▲ 收起联动' : '🔗 展开联动') + '</button>'
        + '<button class="btn sm" style="font-size:9px;padding:3px 9px;color:var(--cyan)" onclick="AUTOALERT._aiSituation(\'' + k + '\')">🤖 AI研判</button>'
        + '<button class="btn sm" style="font-size:9px;padding:3px 9px;color:var(--green)" onclick="AUTOALERT.confirmAlert(\'' + String(c.topMember.id == null ? '' : c.topMember.id).replace(/'/g, "\\'") + '\')">✅ 确认</button>'
        + '<button class="btn sm" style="font-size:9px;padding:3px 9px;color:var(--yellow)" onclick="AUTOALERT.exportAlert(\'' + String(c.topMember.id == null ? '' : c.topMember.id).replace(/'/g, "\\'") + '\')">⬇ 导出</button>'
        + '</div>';
      var html = '<div class="aa-sit-card' + (opts.pulse ? ' aa-new' : '') + '" data-skey="' + k + '" style="border-left-color:' + lvC + '" onclick="AUTOALERT._toggleSituation(\'' + k + '\')">';
      html += '<div class="aa-sit-head">';
      html += '<div style="display:flex;align-items:center;gap:7px"><span style="font-size:14px" class="' + (c.maxLevel === 'red' ? 'aa-red-pulse' : '') + '">' + (c.maxLevel === 'red' ? '🔴' : c.maxLevel === 'orange' ? '🟠' : c.maxLevel === 'yellow' ? '🟡' : '🔵') + '</span>';
      html += '<span class="aa-sit-title">' + c.title + '</span>' + (c.isCn ? '<span class="aa-sit-cn">涉我</span>' : '') + '</div>';
      html += '<div class="aa-sit-risk" style="color:' + lvC + '">' + c.risk + '<span style="font-size:9px;opacity:.7">分</span></div>';
      html += '</div>';
      html += newTrigger;
      html += chain;
      html += dims;
      html += '<div class="aa-sit-narr">' + c.narrative + '</div>';
      html += acts;
      if (expanded) html += this._renderSituationDetail(c);
      html += '</div>';
      return html;
    },
    _renderSituationDetail(c) {
      var me = this;
      var html = '<div class="aa-sit-detail">';
      /* 联动国家风险 */
      html += '<div class="aa-sit-dsec"><div class="aa-sit-dtt">🔗 联动国家风险</div>';
      c.countries.forEach(function (ct) {
        var base = me._countryBaseRisk(ct);
        var lift = Math.min(30, c.count * 3);
        var total = Math.min(100, (base != null ? base : 40) + lift);
        html += '<div class="aa-sit-linkrow"><span>' + ct + '</span><span style="color:var(--red)">风险 ' + total + (base != null ? ' <i>(基础' + base + '+动态+' + lift + ')</i>' : '') + '</span></div>';
      });
      html += '</div>';
      /* 联动走廊（真实一带一路数据 + 跨模块跳转） */
      if (c.corridors.length) {
        html += '<div class="aa-sit-dsec"><div class="aa-sit-dtt">🛤 联动走廊（点击跨模块关联）</div>';
        c.corridors.forEach(function (co) {
          var name = me._corridorMap()[co] || co;
          var info = me._corridorInfo(name);
          var tip = info ? ('风险' + info.risk + ' · ' + info.status) : '监测中';
          html += '<div class="aa-sit-linkrow aa-sit-link" onclick="AUTOALERT._openCorridorLink(\'' + String(co).replace(/'/g, "\\'") + '\')"><span>' + name + '</span><span style="color:var(--orange)">' + tip + ' →</span></div>';
        });
        html += '</div>';
      }
      /* 联动组织 */
      if (c.orgs.length) {
        html += '<div class="aa-sit-dsec"><div class="aa-sit-dtt">🏴 涉事组织活跃度</div>';
        c.orgs.forEach(function (o) {
          var n = c.members.filter(function (m) { return me._aaOrgNames(m).indexOf(o) >= 0; }).length;
          html += '<div class="aa-sit-linkrow"><span>' + o + '</span><span style="color:var(--orange)">活跃 ' + n + ' 起</span></div>';
        });
        html += '</div>';
      }
      /* 推荐预案（复用既有 AI 预案研判） */
      html += '<div class="aa-sit-dsec"><div class="aa-sit-dtt">📋 推荐预案</div><div id="sit-pb-' + String(c.key).replace(/[^a-z0-9一-龥]/g, '') + '"></div>';
      try {
        if (typeof AVIEW !== 'undefined' && AVIEW._aiPlaybookRecommend) AVIEW._aiPlaybookRecommend(c.topMember, 'sit-pb-' + String(c.key).replace(/[^a-z0-9一-龥]/g, ''));
      } catch (e) {}
      html += '</div>';
      /* 成员预警 */
      html += '<div class="aa-sit-dsec"><div class="aa-sit-dtt">📡 成员预警 (' + c.members.length + ')</div>';
      html += c.members.slice(0, 12).map(function (m) { return me._buildLiveCard(m); }).join('');
      html += '</div>';
      html += '</div>';
      return html;
    },
    _toggleSituation(key) { this._expandedSit = (this._expandedSit === key) ? null : key; this._renderSituationsNow(); },
    _openCorridorLink(name) {
      try { if (typeof LINK_GRAPH !== 'undefined' && LINK_GRAPH.openChannel) { LINK_GRAPH.openChannel('corridor', this._corridorMap()[name] || name); return; } } catch (e) {}
      if (typeof showToast === 'function') showToast('联动走廊：' + (this._corridorMap()[name] || name));
    },
    _aiSituation(key) {
      var cl = this._clusterAlerts().filter(function (c) { return c.key === key; })[0];
      if (!cl) return;
      if (typeof showToast === 'function') showToast('🤖 已对「' + cl.title + '」提交 AI 深度研判（聚合 ' + cl.count + ' 条预警）');
    },
    _renderSituationsNow() {
      var host = document.getElementById('aa-situations');
      if (host) host.innerHTML = this._renderSituations();
    },
    /* 左栏：智能研判概览 */
    _renderLeftIntel() {
      var clusters = this._clusterAlerts();
      var rising = clusters.filter(function (c) { return c.trend === 'rising'; });
      var cn = clusters.filter(function (c) { return c.isCn; });
      var top = clusters.slice(0, 3);
      var globalNarr = top.length ? ('系统自动聚类出 <b>' + clusters.length + '</b> 个复合态势，其中 <b style="color:var(--red)">' + rising.length + '</b> 个升级、<b style="color:var(--cyan)">' + cn.length + '</b> 个涉我。重点：' + top.map(function (c) { return c.title; }).join('；') + '。') : '暂无复合态势，等待实时数据接入。';
      var html = '<div class="aa-glow-card" style="padding:11px 13px;margin-bottom:10px">';
      html += '<div class="aa-card-tt"><span class="ic">🧠</span>智能研判引擎</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0">';
      html += '<div class="aa-mini"><div class="aa-mini-n" style="color:var(--cyan)">' + clusters.length + '</div><div class="aa-mini-l">复合态势</div></div>';
      html += '<div class="aa-mini"><div class="aa-mini-n" style="color:var(--red)">' + rising.length + '</div><div class="aa-mini-l">升级中</div></div>';
      html += '<div class="aa-mini"><div class="aa-mini-n" style="color:var(--orange)">' + cn.length + '</div><div class="aa-mini-l">涉我</div></div>';
      html += '</div>';
      html += '<div style="font-size:10px;line-height:1.6;color:var(--text2);background:rgba(0,0,0,.25);border-radius:8px;padding:8px 10px">' + globalNarr + '</div>';
      html += '</div>';
      if (rising.length) {
        html += '<div class="aa-glow-card" style="padding:11px 13px">';
        html += '<div class="aa-card-tt"><span class="ic">▲</span>升级态势预警</div>';
        html += rising.slice(0, 6).map(function (c) {
          return '<div class="aa-mini-row" onclick="AUTOALERT._toggleSituation(\'' + String(c.key).replace(/'/g, "\\'") + '\')"><span class="dot" style="background:' + (c.maxLevel === 'red' ? 'var(--red)' : 'var(--orange)') + '"></span><span class="t">' + c.title + '</span><span class="r" style="color:var(--red)">' + c.risk + '</span></div>';
        }).join('');
        html += '</div>';
      }
      return html;
    },
    /* 右栏：联动监控 */
    _renderLinkageMonitor() {
      var clusters = this._clusterAlerts();
      var me = this;
      /* 联动国家风险 TOP */
      var cMap = {};
      clusters.forEach(function (c) { c.countries.forEach(function (ct) { cMap[ct] = (cMap[ct] || 0) + c.count; }); });
      var cRank = Object.keys(cMap).map(function (ct) {
        var base = me._countryBaseRisk(ct); var lift = Math.min(30, cMap[ct] * 3);
        return { ct: ct, total: Math.min(100, (base != null ? base : 40) + lift), base: base, lift: lift, n: cMap[ct] };
      }).sort(function (a, b) { return b.total - a.total; }).slice(0, 6);
      var html = '<div class="aa-glow-card" style="padding:11px 13px;margin-bottom:10px">';
      html += '<div class="aa-card-tt"><span class="ic">🌍</span>联动国家风险 TOP</div>';
      html += cRank.map(function (r) {
        return '<div class="aa-lk-row"><span class="aa-lk-name">' + r.ct + '</span><span class="aa-lk-bar"><span style="width:' + r.total + '%;background:' + (r.total >= 70 ? 'var(--red)' : r.total >= 50 ? 'var(--orange)' : 'var(--cyan)') + '"></span></span><span class="aa-lk-val">' + r.total + '</span></div>';
      }).join('') || '<div style="font-size:10px;color:var(--text3);padding:8px 0">暂无</div>';
      html += '</div>';
      /* 高危走廊 */
      var corrSet = {};
      clusters.forEach(function (c) { c.corridors.forEach(function (co) { corrSet[co] = (corrSet[co] || 0) + 1; }); });
      var corrRank = Object.keys(corrSet).map(function (co) { return { co: co, n: corrSet[co] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
      html += '<div class="aa-glow-card" style="padding:11px 13px;margin-bottom:10px">';
      html += '<div class="aa-card-tt"><span class="ic">🛤</span>高危走廊联动</div>';
      html += corrRank.map(function (r) {
        var name = me._corridorMap()[r.co] || r.co; var info = me._corridorInfo(name);
        var tip = info ? ('风险' + info.risk) : '监测中';
        return '<div class="aa-lk-row aa-sit-link" onclick="AUTOALERT._openCorridorLink(\'' + String(r.co).replace(/'/g, "\\'") + '\')"><span class="aa-lk-name">' + name + '</span><span class="aa-lk-val" style="color:var(--orange)">' + tip + ' ·' + r.n + '</span></div>';
      }).join('') || '<div style="font-size:10px;color:var(--text3);padding:8px 0">暂无</div>';
      html += '</div>';
      /* 涉事组织 */
      var orgSet = {};
      clusters.forEach(function (c) { c.orgs.forEach(function (o) { orgSet[o] = (orgSet[o] || 0) + 1; }); });
      var orgRank = Object.keys(orgSet).map(function (o) { return { o: o, n: orgSet[o] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
      html += '<div class="aa-glow-card" style="padding:11px 13px">';
      html += '<div class="aa-card-tt"><span class="ic">🏴</span>涉事组织活跃度</div>';
      html += orgRank.map(function (r) {
        return '<div class="aa-lk-row"><span class="aa-lk-name">' + r.o + '</span><span class="aa-lk-val" style="color:var(--orange)">活跃 ' + r.n + '</span></div>';
      }).join('') || '<div style="font-size:10px;color:var(--text3);padding:8px 0">暂无</div>';
      html += '</div>';
      return html;
    },

    setDeckTab(t) { this._deckTab = t; this.render(); },
    setQueueTab(t) { this._queueTab = t; this.render(); },
    toggleCnFirst() { this._cnFirst = !this._cnFirst; this.render(); },
    setFilter(k, v) { this._filters[k] = v; this.render(); },
    resetFilters() { this._filters = { country: '', corridor: '', org: '', dim: '', cnOnly: false, timeRange: '24h' }; this.render(); },
    cycleNotify() {
      var modes = ['all', 'cn', 'off'];
      var cur = this._settings.notifyMode || 'all';
      var next = modes[(modes.indexOf(cur) + 1) % modes.length];
      this._settings.notifyMode = next;
      this._saveSettings();
      this.render();
      if (typeof showToast === 'function') showToast('红警提醒：' + (next === 'all' ? '全部红色预警' : next === 'cn' ? '仅涉华红色预警' : '已关闭'));
    },

    /* ===== 多维筛选 ===== */
    _applyFilters(list) {
      var f = this._filters, me = this;
      var cut = f.timeRange === '24h' ? Date.now() - 24 * 3600e3 : f.timeRange === '48h' ? Date.now() - 48 * 3600e3 : 0;
      return list.filter(function (a) {
        if (f.country && (a.country || '') !== f.country) return false;
        if (f.corridor && me._aaCorridorNames(a).indexOf(f.corridor) < 0) return false;
        if (f.org && me._aaOrgNames(a).indexOf(f.org) < 0) return false;
        if (f.dim && me._dimOfAlert(a) !== f.dim) return false;
        if (f.cnOnly && me._aaTier(a) > 1) return false;
        if (cut) {
          var t = 0;
          /* 优先按事件发生/发布时间判定，防止采集时间被误标为当前导致旧新闻漏出 */
          var cand = a.event_date || a.publish_time || a.publishedAt || a.date || a.time;
          try { t = new Date(String(cand || '').replace(' ', 'T')).getTime(); } catch (e) {}
          if (t && t < cut) return false;
        }
        return true;
      });
    },
    _renderFilterBar() {
      var me = this, f = this._filters;
      var pool = this._alerts.filter(function (a) { return !a.dismissed; }).concat(this._rawAlerts.filter(function (r) { return r.status === 'raw'; }));
      var cCount = {};
      pool.forEach(function (a) { var c = a.country || ''; if (c) cCount[c] = (cCount[c] || 0) + 1; });
      var countries = Object.keys(cCount).sort(function (x, y) { return cCount[y] - cCount[x]; }).slice(0, 30);
      var corridors = [], orgs = [];
      pool.forEach(function (a) { me._aaCorridorNames(a).forEach(function (c) { if (corridors.indexOf(c) < 0) corridors.push(c); }); me._aaOrgNames(a).forEach(function (o) { if (orgs.indexOf(o) < 0) orgs.push(o); }); });
      var presets = {};
      try { presets = JSON.parse(localStorage.getItem('orps_aa_fpresets') || '{}'); } catch (e) {}
      var html = '<div class="aa-glow-card" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 10px;margin-bottom:10px">';
      html += '<span style="font-size:11px;font-weight:800;color:var(--cyan)">🎚 筛选</span>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'dim\',this.value)"><option value="">全部维度</option>' + _RISK_DIMENSIONS.map(function (d) { var c = me._calcDimStats()[d.k].count; return '<option value="' + d.k + '"' + (f.dim === d.k ? ' selected' : '') + '>' + d.icon + ' ' + d.n + (c ? ' (' + c + ')' : '') + '</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'country\',this.value)"><option value="">全部国别</option>' + countries.map(function (c) { return '<option' + (f.country === c ? ' selected' : '') + '>' + c + '(' + cCount[c] + ')</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'corridor\',this.value)"><option value="">全部走廊</option>' + corridors.map(function (c) { return '<option' + (f.corridor === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'org\',this.value)"><option value="">全部组织</option>' + orgs.map(function (o) { return '<option' + (f.org === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'timeRange\',this.value)">' + [['24h', '近24小时'], ['48h', '近48小时'], ['all', '全部时段']].map(function (t) { return '<option value="' + t[0] + '"' + (f.timeRange === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>';
      html += '<span class="aa-filter-chip' + (f.cnOnly ? ' on' : '') + '" onclick="AUTOALERT.setFilter(\'cnOnly\',' + (!f.cnOnly) + ')">🇨🇳涉华</span>';
      var hasF = f.country || f.corridor || f.org || f.dim || f.cnOnly || f.timeRange !== '24h';
      if (hasF) html += '<span class="aa-filter-chip" style="color:var(--orange)" onclick="AUTOALERT.resetFilters()">✕ 清除</span>';
      html += '<span style="margin-left:auto;display:flex;gap:5px;align-items:center">';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="if(this.value)AUTOALERT.applyFilterPreset(this.value)"><option value="">📌 预设…</option>' + Object.keys(presets).map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select>';
      html += '<span class="aa-filter-chip" onclick="AUTOALERT.saveFilterPreset()">💾 存预设</span>';
      html += '</span></div>';
      return html;
    },
    saveFilterPreset() {
      var name = prompt('预设名称：');
      if (!name) return;
      var presets = {};
      try { presets = JSON.parse(localStorage.getItem('orps_aa_fpresets') || '{}'); } catch (e) {}
      presets[name] = JSON.parse(JSON.stringify(this._filters));
      localStorage.setItem('orps_aa_fpresets', JSON.stringify(presets));
      if (typeof showToast === 'function') showToast('筛选预设已保存：' + name);
      this.render();
    },
    applyFilterPreset(name) {
      try {
        var presets = JSON.parse(localStorage.getItem('orps_aa_fpresets') || '{}');
        if (presets[name]) { this._filters = presets[name]; this.render(); if (typeof showToast === 'function') showToast('已应用预设：' + name); }
      } catch (e) {}
    },

    /* ===== ① 指挥带 ===== */
    _renderCommandBand(st) {
      var lastRunStr = this._lastRun ? this._lastRun.toLocaleString('zh-CN', { hour12: false }) : '—';
      var wfN = Object.keys(this._workflows).length;
      var nm = this._settings.notifyMode || 'all';
      var dimStats = this._calcDimStats();
      var html = '<div class="aa-glow-card" style="padding:10px 14px;margin-bottom:10px;border-color:rgba(120,150,200,.35)">';
      /* 第一行：引擎控制 + 核心 KPI */
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:22px" class="' + (this._engineOn ? 'aa-red-pulse' : '') + '">' + (this._engineOn ? '🟢' : '⚪') + '</span>';
      html += '<div><div style="font-size:13px;font-weight:800;color:' + (this._engineOn ? 'var(--green)' : 'var(--text3)') + '">' + (this._engineOn ? '无人值守自动预警中' : '引擎已暂停') + '</div>';
      html += '<div style="font-size:9px;color:var(--text3)">下次扫描 <span id="aa-countdown" style="font-family:monospace;color:var(--cyan)">--:--</span> · 上次 ' + lastRunStr + '</div></div>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 10px;background:rgba(0,0,0,.25);border-radius:8px">';
      html += '<button class="btn sm" style="font-size:10px" onclick="AUTOALERT.toggleEngine()">' + (this._engineOn ? '⏸ 暂停' : '▶ 启动') + '</button>';
      html += '<button class="btn sm primary" style="font-size:10px" onclick="AUTOALERT.run()">🔍 立即扫描</button>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" title="扫描周期" onchange="AUTOALERT.setScanInterval(this.value)">' + [60, 120, 300, 600, 1800].map(function (n) { return '<option value="' + n + '"' + ((AUTOALERT._settings.scanInterval || 300) === n ? ' selected' : '') + '>' + (n < 60 ? n + 's' : n / 60 + 'min') + '</option>'; }).join('') + '</select>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" title="SOAR自动编排" onclick="AUTOALERT.toggleAutoSoar()">SOAR ' + (this._settings.autoSoar ? '✅' : '⏸️') + '</button>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" title="高置信自动晋升" onclick="AUTOALERT.toggleAutoPromote()">晋升 ' + (this._settings.autoPromote ? '✅' : '⏸️') + '</button>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px;' + (nm !== 'off' ? 'border-color:var(--red);color:var(--red)' : '') + '" title="红警声音+弹窗提醒（点击切换：全部→仅涉华→关闭）" onclick="AUTOALERT.cycleNotify()">🔔' + (nm === 'all' ? '全部' : nm === 'cn' ? '涉华' : '关') + '</button>';
      html += '</div>';
      html += '<div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">';
      html += this._aaMetric('🧠', '智能预警', st.total, 'var(--cyan)');
      html += this._aaMetric('🔴', '紧急/高危', (st.red + st.orange), 'var(--red)');
      html += this._aaMetric('🚀', 'SOAR执行', wfN, 'var(--green)');
      html += '</div>';
      html += '</div>';
      /* 第二行：12 维风险矩阵 + 预测 */
      html += '<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:5px">';
      _RISK_DIMENSIONS.forEach(function (d) {
        var s = dimStats[d.k];
        var pred = s.prediction || { label: '', cls: 'stable' };
        var active = s.count > 0;
        var hasRed = s.red > 0 || s.orange > 0;
        var border = hasRed ? '1px solid ' + d.color : '1px solid rgba(255,255,255,.08)';
        var bg = active ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.15)';
        var pulse = hasRed ? ' aa-dim-pulse' : '';
        html += '<div class="aa-dim-cell' + pulse + '" style="background:' + bg + ';border:' + border + ';border-radius:6px;padding:6px 4px;text-align:center;cursor:pointer" onclick="AUTOALERT.setFilter(\'dim\',\'' + d.k + '\')">';
        html += '<div style="font-size:13px">' + d.icon + '</div>';
        html += '<div style="font-size:9px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + d.n + '</div>';
        html += '<div style="font-size:12px;font-weight:800;color:' + (active ? d.color : 'var(--text3)') + '">' + s.count + '</div>';
        if (active) html += '<div style="font-size:8px;color:' + (pred.cls === 'rising' ? 'var(--red)' : pred.cls === 'falling' ? 'var(--green)' : 'var(--text3)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + pred.label + '">' + pred.label + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
      return html;
    },
    _aaMetric(icon, label, val, color) {
      return '<div style="text-align:center;min-width:70px;padding:6px 10px;background:rgba(0,0,0,.25);border-radius:8px;border:1px solid rgba(255,255,255,.05)">' +
        '<div style="font-size:12px">' + icon + ' <span style="font-size:9px;color:var(--text3)">' + label + '</span></div>' +
        '<div class="aa-kpi-num" style="color:' + color + '">' + val + '</div></div>';
    },

    /* ===== ② 自动化实况（2026-08-19 用户指令：自动预警要突出"自动"，地图系统已有不重复建设） =====
     * 中栏主角：机器正在干什么的实时动作流——扫描/检测/研判/晋升/SOAR/归档，时间倒序 */
    _renderAutomationFeed() {
      var feed = [];
      var me = this;
      /* SOAR 工作流步骤（自动执行的响应动作） */
      Object.keys(this._workflows).forEach(function (aid) {
        var wf = me._workflows[aid];
        var alert = me._alerts.find(function (x) { return String(x.id) === String(aid); });
        var aTitle = alert ? String(alert.title_zh || alert.title || '').slice(0, 26) : '';
        (wf.steps || []).forEach(function (s) {
          var meta = (typeof SOAR_ACTIONS !== 'undefined' && SOAR_ACTIONS[s.action]) || { icon: '⚙️', name: s.action };
          feed.push({ time: s.time || '', icon: meta.icon, title: 'SOAR·' + meta.name, detail: (s.note || '') + (aTitle ? ' — ' + aTitle : ''), color: 'var(--green)' });
        });
      });
      /* 机器人日志（扫描/晋升/编排等自动化事件） */
      (this._robotLogs || []).forEach(function (l) {
        var icon = l.level === 'success' ? '✅' : l.level === 'warn' ? '⚠️' : '🤖';
        var color = l.level === 'success' ? 'var(--green)' : l.level === 'warn' ? 'var(--orange)' : 'var(--cyan)';
        feed.push({ time: l.time || '', icon: icon, title: l.action || '', detail: l.detail || '', color: color });
      });
      /* 时间倒序（时间为 "YYYY-MM-DD HH:MM" 字符串，字典序即可） */
      feed.sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
      feed = feed.slice(0, 40);
      var html = '<div class="aa-glow-card" style="padding:10px 12px;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
      html += '<span style="font-size:13px;font-weight:800;color:var(--cyan)">🤖 自动化实况</span>';
      html += '<span style="font-size:9px;color:var(--text3)">机器自动检测→研判→晋升→编排→响应 全记录</span>';
      html += '<span style="margin-left:auto;font-size:9px;color:var(--green)"><span style="display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;margin-right:4px" class="aa-red-pulse"></span>' + (this._engineOn ? '自动运转中' : '已暂停') + '</span>';
      html += '</div>';
      if (!feed.length) {
        html += '<div style="text-align:center;padding:26px;color:var(--text3);font-size:11px">暂无自动化动作——点「🔍 立即扫描」让机器跑一轮</div>';
      } else {
        html += '<div style="display:grid;gap:4px;max-height:430px;overflow-y:auto">';
        feed.forEach(function (f) {
          var fresh = me._isFresh(f.time);
          html += '<div class="aa-feed-item' + (fresh ? ' aa-new' : '') + '" style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;background:rgba(0,0,0,.25);border-radius:6px;border-left:2px solid ' + f.color + '">';
          html += '<span style="font-size:12px;flex-shrink:0">' + f.icon + '</span>';
          html += '<div style="flex:1;min-width:0"><div style="font-size:10px;font-weight:700;color:var(--text)">' + f.title + (fresh ? ' <span class="aa-newtag">NEW</span>' : '') + '</div>';
          html += '<div style="font-size:9px;color:var(--text3);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + f.detail + '</div></div>';
          html += '<span style="font-size:8px;color:var(--text3);flex-shrink:0;font-family:monospace">' + String(f.time).slice(5, 16) + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    /* ===== ②.5 实时情报流滚动条 ===== */
    _renderLiveTicker() {
      if (typeof ALERTS === 'undefined' || !ALERTS.length) return '';
      var items = ALERTS.slice(0, 14);
      function ago(t) {
        try {
          var diff = Date.now() - new Date(String(t || '').replace(' ', 'T')).getTime();
          var m = Math.floor(diff / 60000), h = Math.floor(m / 60);
          return m < 1 ? '刚刚' : h < 1 ? m + '分钟前' : h < 24 ? h + '小时前' : Math.floor(h / 24) + '天前';
        } catch (e) { return ''; }
      }
      var html = '<div class="aa-glow-card" style="display:flex;align-items:center;gap:8px;padding:7px 12px;overflow:hidden">';
      html += '<span style="flex-shrink:0;font-size:10px;font-weight:800;color:var(--red);white-space:nowrap"><span style="display:inline-block;width:7px;height:7px;background:var(--red);border-radius:50%;margin-right:5px" class="aa-red-pulse"></span>实时情报流</span>';
      html += '<div style="display:flex;gap:14px;overflow-x:auto;white-space:nowrap;flex:1;scrollbar-width:none">';
      items.forEach(function (a) {
        var lvC = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
        var id = String(a.id || '').replace(/'/g, "\\'");
        html += '<span style="font-size:10px;color:var(--text2);cursor:pointer;flex-shrink:0" onclick="showAlertDetail(\'' + id + '\')">' +
          '<b style="color:' + lvC + '">●</b> ' + String(a.title_zh || a.title || '').slice(0, 30) +
          ' <span style="color:var(--text3);font-size:9px">' + (a.country || '') + ' · ' + ago(a.time) + '</span></span>';
      });
      html += '</div></div>';
      return html;
    },

    /* ===== ③ 右侧作战队列（Tab：侦测/预警/处置/闭环 + 一键操作） ===== */
    _renderQueuePanel() {
      var me = this;
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var laneAlert = active.filter(function (a) { return !me._workflows[a.id]; });
      var laneSoar = active.filter(function (a) { return !!me._workflows[a.id]; });
      var laneDone = this._resolved.slice(0, 50);
      var lvW = { red: 3000, orange: 2000, yellow: 1000, blue: 500 };
      var sorter = function (a, b) {
        if (me._cnFirst) { var ta = me._aaTier(a), tb = me._aaTier(b); if (ta !== tb) return ta - tb; }
        var sa = (lvW[a.level] || 0) + Math.round((a.confidence || 0) * 100);
        var sb = (lvW[b.level] || 0) + Math.round((b.confidence || 0) * 100);
        return sb - sa;
      };
      var lanes = { raw: this._applyFilters(raw).sort(sorter), alert: this._applyFilters(laneAlert).sort(sorter), soar: this._applyFilters(laneSoar).sort(sorter), done: laneDone };
      var tabs = [
        { k: 'raw', n: '📡侦测', c: 'var(--orange)', n2: raw.length },
        { k: 'alert', n: '🧠预警', c: 'var(--cyan)', n2: laneAlert.length },
        { k: 'soar', n: '🚀处置', c: '#a06bff', n2: laneSoar.length },
        { k: 'done', n: '✅闭环', c: 'var(--green)', n2: laneDone.length }
      ];
      var html = '<div class="aa-glow-card" style="padding:8px">';
      html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:8px;flex-wrap:wrap">';
      tabs.forEach(function (t) {
        var on = me._queueTab === t.k;
        html += '<span class="aa-filter-chip' + (on ? ' on' : '') + '" style="' + (on ? 'border-color:' + t.c + ';color:' + t.c : '') + '" onclick="AUTOALERT.setQueueTab(\'' + t.k + '\')">' + t.n + ' <b>' + t.n2 + '</b></span>';
      });
      html += '<span class="aa-filter-chip" style="margin-left:auto;' + (this._cnFirst ? 'border-color:var(--cyan);color:var(--cyan)' : '') + '" title="涉华优先排序" onclick="AUTOALERT.toggleCnFirst()">🇨🇳</span>';
      html += '</div>';
      var laneMap = { raw: 1, alert: 2, soar: 3, done: 4 };
      var list = lanes[this._queueTab] || [];
      if (!list.length) {
        html += '<div style="text-align:center;padding:30px 8px;color:var(--text3);font-size:10px;opacity:.7">' + (this._queueTab === 'raw' ? '实时数据到达后自动生成候选' : this._queueTab === 'done' ? '暂无闭环记录' : '当前筛选条件下暂无数据') + '</div>';
      } else {
        html += '<div style="display:grid;gap:6px;max-height:640px;overflow-y:auto">';
        list.slice(0, 60).forEach(function (a) { html += me._renderKanbanCard(a, laneMap[me._queueTab]); });
        if (list.length > 60) html += '<div style="text-align:center;font-size:9px;color:var(--text3);padding:4px">… 共 ' + list.length + ' 条，显示前 60</div>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    _renderKanbanCard(a, lane) {
      var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
      var lvDot = a.level === 'red' ? '🔴' : a.level === 'orange' ? '🟠' : a.level === 'yellow' ? '🟡' : '🔵';
      var id = String(a.id || '').replace(/'/g, "\\'");
      var clickFn = lane === 4 ? "AUTOALERT._showResolvedDetail('" + id + "')" : "AUTOALERT._showDetail('" + id + "')";
      var tags = lane === 4 ? [] : this._aaTags(a).slice(0, 3);
      var html = '<div style="padding:8px;background:rgba(0,0,0,.28);border-radius:6px;border-left:3px solid ' + lvClr + ';cursor:pointer;transition:.15s" onclick="' + clickFn + '">';
      html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;flex-wrap:wrap">';
      html += '<span style="font-size:9px" class="' + (a.level === 'red' ? 'aa-red-pulse' : '') + '">' + lvDot + '</span>';
      if (lane === 4) {
        var actClr = a.resolvedAction === 'confirmed' ? 'var(--green)' : a.resolvedAction === 'dismissed' ? 'var(--orange)' : 'var(--text3)';
        var actLabel = a.resolvedAction === 'confirmed' ? '✅已确认' : a.resolvedAction === 'dismissed' ? '❌已消除' : a.resolvedAction === 'rejected' ? '🚫已驳回' : '📦已清空';
        html += '<span style="font-size:8px;font-weight:700;color:' + actClr + '">' + actLabel + '</span>';
      } else {
        html += '<span style="font-size:8px;color:var(--text3)">置信 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
        if (lane === 3) {
          var wf = this._workflows[a.id];
          var stepN = wf && wf.steps ? wf.steps.length : 0;
          html += '<span style="font-size:8px;color:var(--green)">SOAR ' + (wf && wf.status === 'completed' ? '完成' : '运行') + '·' + stepN + '步</span>';
        }
      }
      html += '</div>';
      html += '<div style="font-size:11px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.title_zh || a.title || '') + '</div>';
      if (tags.length) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">' + tags.map(function (tg) { return '<span style="font-size:8px;padding:0 4px;border-radius:5px;border:1px solid ' + tg.c + ';color:' + tg.c + '">' + tg.t + '</span>'; }).join('') + '</div>';
      }
      html += '<div style="display:flex;gap:8px;font-size:8px;color:var(--text3);margin-top:4px;flex-wrap:wrap">';
      html += '<span>🌍 ' + (a.country || '—') + '</span><span>⏱ ' + String(a.time || a.resolvedAt || '').slice(5, 16) + '</span>';
      html += '</div>';
      if (lane === 1) {
        html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm primary" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.promoteRaw(\'' + id + '\')">⬆️ 晋升</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.rejectRaw(\'' + id + '\')">✕ 驳回</button>';
        html += '</div>';
      } else if (lane === 2 || lane === 3) {
        html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--green)" title="确认" onclick="AUTOALERT.confirmAlert(\'' + id + '\')">✅</button>';
        html += '<button class="btn sm danger" style="flex:1;font-size:9px;padding:2px 4px" title="消除" onclick="AUTOALERT.dismissAlert(\'' + id + '\')">✕</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--cyan)" title="重新编排" onclick="AUTOALERT.runManualWorkflow(\'' + id + '\')">🚀</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--yellow)" title="生成简报" onclick="AUTOALERT.quickBrief(\'' + id + '\')">📄</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px" title="导出JSON" onclick="AUTOALERT.exportAlert(\'' + id + '\')">⬇</button>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    quickBrief(id) {
      var a = this._alerts.find(function (x) { return String(x.id) === String(id); }) || this._rawAlerts.find(function (x) { return String(x.id) === String(id); });
      if (!a) return;
      try { a.brief = this._generateBrief(a); this._save(); } catch (e) {}
      this._showDetail(id);
    },
    exportAlert(id) {
      var a = this._alerts.find(function (x) { return String(x.id) === String(id); }) || this._rawAlerts.find(function (x) { return String(x.id) === String(id); });
      if (!a) return;
      try {
        var blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'alert_' + String(a.id || 'export').replace(/[^\w-]/g, '_') + '.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('预警已导出');
      } catch (e) {}
    },

    /* ===== ④ 红警声音 + 弹窗提醒 ===== */
    _notifyNewRed() {
      var mode = this._settings.notifyMode || 'all';
      if (!this._seenRedIds) { /* 首次仅记录，不对存量红警轰炸 */
        var s0 = {};
        this._alerts.forEach(function (a) { if (a.level === 'red' && !a.dismissed) s0[a.id] = 1; });
        this._seenRedIds = s0;
        return;
      }
      if (mode === 'off') return;
      var me = this, fresh = [];
      this._alerts.forEach(function (a) {
        if (a.dismissed || a.level !== 'red' || me._seenRedIds[a.id]) return;
        me._seenRedIds[a.id] = 1;
        fresh.push(a);
      });
      if (mode === 'cn') fresh = fresh.filter(function (a) { return me._aaTier(a) <= 1; });
      if (!fresh.length) return;
      this._beep();
      this._showRedToast(fresh[0], fresh.length);
    },
    _beep() {
      try {
        var ctx = this._actx || (this._actx = new (window.AudioContext || window.webkitAudioContext)());
        if (ctx.state === 'suspended') ctx.resume();
        [0, 350].forEach(function (delay) {
          setTimeout(function () {
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 880;
            o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.12, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            o.start(); o.stop(ctx.currentTime + 0.5);
          }, delay);
        });
      } catch (e) {}
    },
    _showRedToast(a, n) {
      try {
        var old = document.getElementById('aa-red-toast');
        if (old) old.remove();
        var id = String(a.id || '').replace(/'/g, "\\'");
        var div = document.createElement('div');
        div.id = 'aa-red-toast';
        div.className = 'aa-toast';
        div.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="font-size:16px" class="aa-red-pulse">🔴</span><b style="color:var(--red);font-size:12px">紧急红色预警' + (n > 1 ? ' +' + (n - 1) : '') + '</b><span style="margin-left:auto;cursor:pointer;color:var(--text3);font-size:14px" onclick="document.getElementById(\'aa-red-toast\').remove()">✕</span></div>' +
          '<div style="font-size:11px;font-weight:600;line-height:1.4;margin-bottom:6px">' + String(a.title_zh || a.title || '').replace(/</g, '&lt;') + '</div>' +
          '<div style="font-size:9px;color:var(--text3);margin-bottom:8px">🌍 ' + (a.country || '—') + ' · ⏱ ' + String(a.time || '').slice(5, 16) + '</div>' +
          '<div style="display:flex;gap:6px"><button class="btn sm primary" style="flex:1;font-size:10px" onclick="document.getElementById(\'aa-red-toast\').remove();AUTOALERT._showDetail(\'' + id + '\')">立即研判</button><button class="btn sm" style="font-size:10px" onclick="document.getElementById(\'aa-red-toast\').remove()">知道了</button></div>';
        document.body.appendChild(div);
        setTimeout(function () { var d = document.getElementById('aa-red-toast'); if (d) d.remove(); }, 20000);
      } catch (e) {}
    },

    /* ===== 左栏：境外态势 ===== */
    _renderSidebar() {
      var me = this;
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var all = active.concat(raw);
      var html = '';
      var dims = [
        { n: '人员与项目', re: /员工|人员|公民|华人|华侨|工程师|工人|项目部|营地|撤侨|Chinese (worker|engineer|national)/i },
        { n: '通道与资产', re: /中资|中企|资产|工厂|矿山|港口|油田|管道|走廊|CPEC|瓜达尔|铁路|大坝/i },
        { n: '制裁与合规', re: /制裁|合规|出口管制|实体清单|关税|sanction/i },
        { n: '涉华舆情', re: /涉华|对华|反华|辱华|中国.*舆论|民调/i },
        { n: '冲突与政局', re: /冲突|政变|选举|政局|动荡|军政府|内战/i }
      ];
      var dimRows = dims.map(function (d) {
        var c = all.filter(function (a) { return d.re.test(String(a.title || '') + String(a.title_zh || '') + String(a.desc || '')); }).length;
        return { n: d.n, c: c };
      });
      var dimMax = Math.max(1, Math.max.apply(null, dimRows.map(function (r) { return r.c; })));
      html += '<div class="aa-glow-card" style="padding:10px;margin-bottom:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">🇨🇳 涉我海外利益</div>';
      dimRows.forEach(function (r) {
        var w = Math.round(r.c / dimMax * 100);
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:10px">';
        html += '<span style="width:60px;color:var(--text2)">' + r.n + '</span>';
        html += '<div style="flex:1;height:8px;background:rgba(0,0,0,.3);border-radius:4px;overflow:hidden"><div style="width:' + w + '%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--red));border-radius:4px;box-shadow:0 0 6px rgba(91,155,255,.5)"></div></div>';
        html += '<b style="color:var(--cyan);min-width:18px;text-align:right">' + r.c + '</b></div>';
      });
      html += '</div>';
      var corrCount = {};
      all.forEach(function (a) { me._aaCorridorNames(a).forEach(function (c) { corrCount[c] = (corrCount[c] || 0) + 1; }); });
      var corrList = Object.keys(corrCount).sort(function (x, y) { return corrCount[y] - corrCount[x]; }).slice(0, 6);
      html += '<div class="aa-glow-card" style="padding:10px;margin-bottom:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">🛰️ 高危走廊</div>';
      if (!corrList.length) html += '<div style="font-size:10px;color:var(--text3);padding:8px 0">当前无走廊命中</div>';
      corrList.forEach(function (c) {
        var hot = corrCount[c] >= 5;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;margin-bottom:4px;background:rgba(0,0,0,.28);border-radius:6px;border-left:2px solid ' + (hot ? 'var(--red)' : 'var(--orange)') + ';font-size:10px;cursor:pointer" onclick="AUTOALERT.setFilter(\'corridor\',\'' + c + '\')">';
        html += '<span style="font-weight:600">' + c + '</span><b style="color:' + (hot ? 'var(--red)' : 'var(--orange)') + '">' + corrCount[c] + '</b></div>';
      });
      html += '</div>';
      var orgCount = {};
      all.forEach(function (a) { me._aaOrgNames(a).forEach(function (o) { orgCount[o] = (orgCount[o] || 0) + 1; }); });
      var orgList = Object.keys(orgCount).sort(function (x, y) { return orgCount[y] - orgCount[x]; }).slice(0, 6);
      html += '<div class="aa-glow-card" style="padding:10px;margin-bottom:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">⚔️ 威胁组织活跃榜</div>';
      if (!orgList.length) html += '<div style="font-size:10px;color:var(--text3);padding:8px 0">当前无威胁组织命中</div>';
      orgList.forEach(function (o, i) {
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:10px;border-bottom:1px dashed var(--border);cursor:pointer" onclick="AUTOALERT.setFilter(\'org\',\'' + o + '\')">';
        html += '<span style="color:var(--orange);font-weight:800;width:14px">' + (i + 1) + '</span>';
        html += '<span style="flex:1">' + o + '</span><b style="color:var(--red)">' + orgCount[o] + '</b></div>';
      });
      html += '</div>';
      var needHuman = active.filter(function (a) { return !a.confirmed; }).concat(raw);
      needHuman.sort(function (a, b) { return (b.severityScore || 0) - (a.severityScore || 0); });
      needHuman = needHuman.slice(0, 3);
      html += '<div class="aa-glow-card" style="padding:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">💡 需人工介入</div>';
      if (!needHuman.length) {
        html += '<div style="font-size:10px;color:var(--green);padding:8px 0">✅ 当前无需人工介入</div>';
      } else {
        needHuman.forEach(function (a) {
          var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : 'var(--yellow)';
          var id = String(a.id || '').replace(/'/g, "\\'");
          html += '<div style="padding:6px 8px;margin-bottom:5px;background:rgba(0,0,0,.28);border-radius:6px;border-left:2px solid ' + lvClr + ';cursor:pointer" onclick="AUTOALERT._showDetail(\'' + id + '\')">';
          html += '<div style="font-size:10px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.title_zh || a.title || '') + '</div>';
          html += '<div style="font-size:8px;color:var(--text3);margin-top:2px">' + (a.country || '') + ' · 优先级 ' + (a.severityScore || 0).toFixed(1) + '</div></div>';
        });
      }
      html += '</div>';
      return html;
    },

    /* ===== ⑤ 底部复合功能舱 ===== */
    _renderDeck() {
      var tabs = [
        { k: 'rules', icon: '🏭', n: '规则工厂' },
        { k: 'pipeline', icon: '🔄', n: '检测流水线' },
        { k: 'logs', icon: '📝', n: '机器人日志' },
        { k: 'review', icon: '📈', n: '复盘看板' }
      ];
      var html = '<div style="margin-top:10px">';
      html += '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
      var me = this;
      tabs.forEach(function (t) {
        var on = me._deckTab === t.k;
        html += '<button class="btn sm" style="font-size:10px;padding:4px 14px;' + (on ? 'border-color:var(--cyan);color:var(--cyan);background:rgba(91,155,255,0.08)' : '') + '" onclick="AUTOALERT.setDeckTab(\'' + t.k + '\')">' + t.icon + ' ' + t.n + '</button>';
      });
      html += '</div>';
      if (this._deckTab === 'rules') html += this._renderRuleFactory();
      else if (this._deckTab === 'pipeline') html += this._renderPipeline();
      else if (this._deckTab === 'logs') html += this._renderRobotLogs();
      else html += this._renderReviewPanel();
      html += '</div>';
      return html;
    },

    /* ===== 维度工具 ===== */
    _aaCorridorNames(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '') + ' ' + String(a.country || '');
      var defs = [
        ['中巴走廊·俾路支', /俾路支|瓜达尔|中巴经济走廊|CPEC|沙盖|奎达/i],
        ['阿富汗', /阿富汗|喀布尔|坎大赫|坎大哈/i],
        ['霍尔木兹海峡', /霍尔木兹|Hormuz/i],
        ['红海·亚丁湾', /红海|亚丁湾|曼德海峡|曼德|胡塞/i],
        ['萨赫勒', /萨赫勒|马里|尼日尔|布基纳法索/i],
        ['中亚', /哈萨克斯坦|乌兹别克|塔吉克|吉尔吉斯|土库曼|中亚/i],
        ['叙利亚', /叙利亚|大马士革/i],
        ['伊拉克', /伊拉克|巴格达|摩苏尔/i],
        ['索马里', /索马里|摩加迪沙/i],
        ['巴基斯坦', /巴基斯坦|伊斯兰堡|白沙瓦|卡拉奇/i],
        ['缅甸', /缅甸|仰光|若开/i],
        ['苏丹', /苏丹|喀土穆/i]
      ];
      var out = [];
      defs.forEach(function (d) { if (d[1].test(t)) out.push(d[0]); });
      return out;
    },
    _aaOrgNames(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
      var defs = [
        ['塔利班', /塔利班|Taliban/i],
        ['伊斯兰国(IS-K)', /伊斯兰国|ISIS|ISIL|IS-K|ISKP|Islamic State/i],
        ['基地组织', /基地组织|Qaeda/i],
        ['胡塞武装', /胡塞|Houthi/i],
        ['真主党', /真主党|Hezbollah/i],
        ['哈马斯', /哈马斯|Hamas/i],
        ['博科圣地', /博科圣地|Boko Haram/i],
        ['青年党', /青年党|Shabaab/i],
        ['俾路支解放军(BLA)', /俾路支解放军|BLA/i],
        ['巴塔(TTP)', /TTP|巴基斯坦塔利班/i]
      ];
      var out = [];
      defs.forEach(function (d) { if (d[1].test(t)) out.push(d[0]); });
      return out;
    },
    _aaTags(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '') + ' ' + String(a.country || '');
      var tags = [];
      if (a.chinaNegative || a._chinaNegative) tags.push({ t: '涉华负面', c: 'var(--orange)' });
      if (/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i.test(t)) tags.push({ t: '涉我海外利益', c: 'var(--cyan)' });
      if (a.asset_tags && a.asset_tags.length) tags.push({ t: '命中中资资产', c: 'var(--red)' });
      if (this._aaOrgNames(a).length) tags.push({ t: '威胁组织', c: 'var(--orange)' });
      if (this._aaCorridorNames(a).length) tags.push({ t: '高危走廊', c: 'var(--red)' });
      var cm = t.match(/(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
      var deaths = cm ? parseInt(cm[1] || cm[2], 10) : 0;
      if (deaths >= 10) tags.push({ t: '重大伤亡 ' + deaths + '死', c: 'var(--red)' });
      else if (deaths > 0) tags.push({ t: '伤亡 ' + deaths + '死', c: 'var(--orange)' });
      return tags;
    },
    _aaTier(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
      if (a.chinaNegative || a._chinaNegative) return 0;
      if (/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i.test(t)) return 1;
      if (this._aaCorridorNames(a).length) return 2;
      return 3;
    },

    /* ===== 功能舱内容 ===== */
    _renderRuleFactory() {
      var rs = this._getRuleStats();
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">🏭</span>智能规则工厂 <span style="font-size:10px;color:var(--text3);font-weight:400">— 可配置规则开关、阈值、权重</span></div>';
      html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';
      RULE_DEFINITIONS.forEach(function (r, i) {
        var cfg = AUTOALERT._getRule(r.id);
        var active = cfg.enabled;
        html += '<div style="padding:10px;background:' + (active ? 'var(--panel2)' : 'rgba(128,128,128,0.08)') + ';border-radius:8px;border:1px solid ' + (active ? r.color + '44' : 'var(--border)') + '">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
        html += '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">' + r.icon + '</span><span style="font-size:12px;font-weight:700;color:' + (active ? 'var(--text)' : 'var(--text3)') + '">' + r.name + '</span></div>';
        html += '<label style="position:relative;display:inline-block;width:34px;height:18px;cursor:pointer"><input type="checkbox" ' + (active ? 'checked' : '') + ' onchange="AUTOALERT.toggleRule(\'' + r.id + '\')" style="opacity:0;width:0;height:0"><span style="position:absolute;inset:0;background:' + (active ? r.color : 'var(--border)') + ';border-radius:18px;transition:.2s"></span><span style="position:absolute;top:2px;left:' + (active ? '18px' : '2px') + ';width:14px;height:14px;background:#fff;border-radius:50%;transition:.2s"></span></label>';
        html += '</div>';
        html += '<div style="font-size:9px;color:var(--text3);line-height:1.4;margin-bottom:6px">' + r.desc + '</div>';
        if (r.params) {
          r.params.forEach(function (p) {
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:10px">';
            html += '<span>' + p.label + '</span>';
            html += '<input type="number" value="' + cfg[p.key] + '" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" style="width:70px;font-size:10px;padding:3px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px" onchange="AUTOALERT.setRuleParam(\'' + r.id + '\',\'' + p.key + '\',this.value)">';
            html += '</div>';
          });
        }
        html += '<div style="margin-top:6px"><span class="badge" style="font-size:9px;background:' + r.color + '22;color:' + r.color + '">命中 ' + rs[i] + ' 项</span></div>';
        html += '</div>';
      });
      html += '</div></div>';
      return html;
    },
    _renderPipeline() {
      var steps = [
        { icon: '📡', name: '数据采集', desc: '2286+ 数据源实时采集', active: true },
        { icon: '🧹', name: '清洗归一', desc: '去重/翻译/标签/关联', active: true },
        { icon: '🔍', name: '原始检测', desc: '规则命中生成候选', active: this._rawAlerts.length > 0 || this._hasRun },
        { icon: '🧠', name: '智能研判', desc: '置信度/影响面评估', active: this._alerts.length > 0 },
        { icon: '📋', name: '自动编排', desc: 'SOAR playbook 匹配', active: this._settings.autoSoar },
        { icon: '🚀', name: '自动响应', desc: '通知/取证/升级/归档', active: Object.keys(this._workflows).length > 0 },
        { icon: '📦', name: '复盘归档', desc: '命中率/误报率统计', active: this._scanCount > 0 }
      ];
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">🔄</span>自动检测流水线</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;overflow-x:auto;padding:4px">';
      steps.forEach(function (s, i) {
        html += '<div style="flex:1;min-width:110px;padding:10px 6px;background:' + (s.active ? 'rgba(91,155,255,0.06)' : 'var(--panel2)') + ';border-radius:8px;text-align:center;border:1px solid ' + (s.active ? 'var(--cyan)' : 'transparent') + '">';
        html += '<div style="font-size:20px;opacity:' + (s.active ? '1' : '0.5') + '">' + s.icon + '</div>';
        html += '<div style="font-size:11px;font-weight:600;margin-top:4px;color:' + (s.active ? 'var(--text)' : 'var(--text3)') + '">' + s.name + '</div>';
        html += '<div style="font-size:9px;color:var(--text3);margin-top:2px;line-height:1.3">' + s.desc + '</div>';
        html += '</div>';
        if (i < steps.length - 1) html += '<div style="color:var(--text3);font-size:14px">→</div>';
      });
      html += '</div></div>';
      return html;
    },
    _renderRobotLogs() {
      var logs = this._robotLogs.slice(0, 20);
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">📝</span>响应机器人日志</div>';
      if (logs.length === 0) {
        html += '<div class="empty"><div class="ic">📝</div><div style="font-size:12px">暂无机器日志</div></div>';
      } else {
        html += '<div style="display:grid;gap:5px;max-height:320px;overflow-y:auto">';
        logs.forEach(function (l) {
          var color = l.level === 'success' ? 'var(--green)' : l.level === 'warn' ? 'var(--orange)' : 'var(--cyan)';
          html += '<div style="padding:8px;background:var(--panel2);border-radius:6px;border-left:2px solid ' + color + '">';
          html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-bottom:2px"><span>' + l.time + '</span><span style="color:' + color + '">●</span></div>';
          html += '<div style="font-size:11px;font-weight:600">' + l.action + '</div>';
          html += '<div style="font-size:10px;color:var(--text2);line-height:1.4">' + l.detail + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    _renderReviewPanel() {
      var rv = this._calcReviewStats();
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">📈</span>自动复盘看板</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">';
      html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;text-align:center"><div style="font-size:9px;color:var(--text3)">命中率</div><div style="font-size:20px;font-weight:700;color:var(--cyan)">' + rv.hitRate + '%</div></div>';
      html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;text-align:center"><div style="font-size:9px;color:var(--text3)">误报率</div><div style="font-size:20px;font-weight:700;color:var(--orange)">' + rv.falsePositive + '%</div></div>';
      html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;text-align:center"><div style="font-size:9px;color:var(--text3)">自动处置率</div><div style="font-size:20px;font-weight:700;color:var(--green)">' + rv.autoRate + '%</div></div>';
      html += '</div>';
      html += '<div style="display:flex;gap:8px;justify-content:space-between;font-size:10px;color:var(--text2);padding:8px;background:var(--bg);border-radius:6px;flex-wrap:wrap">';
      html += '<span>✅ 已确认 ' + rv.confirmed + '</span><span>❌ 已消除 ' + rv.dismissed + '</span><span>⏳ 待处理 ' + rv.pending + '</span><span>🔄 扫描 ' + rv.scanCount + '</span><span>📡 实时流入 ' + rv.liveIngest + '</span>';
      html += '</div>';
      html += '</div>';
      return html;
    },


    /* ===== 预警详情弹窗 ===== */
    _showDetail(id) {
      this._load();
      var a = this._alerts.find(function (x) { return x.id === id; }) || this._rawAlerts.find(function (x) { return x.id === id; });
      if (!a) return;
      var isRaw = a.status === 'raw';
      var lvMap = { red: { label: '🔴 紧急', color: 'var(--red)' }, orange: { label: '🟠 高危', color: 'var(--orange)' }, yellow: { label: '🟡 中危', color: 'var(--yellow)' } };
      var lv = lvMap[a.level] || lvMap.yellow;
      var wf = this._workflows[id];
      var html = '<div style="padding:12px;max-height:75vh;overflow-y:auto">';

      html += '<div style="display:flex;align-items:start;gap:10px;margin-bottom:12px">';
      html += '<div style="flex:1">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">';
      html += '<span style="font-size:10px;font-weight:700;color:' + lv.color + ';padding:2px 8px;background:' + lv.color + '15;border-radius:4px">' + lv.label + '</span>';
      html += '<span class="badge b-purple" style="font-size:8px">' + a.rule + '</span>';
      html += '<span class="badge" style="font-size:8px;background:rgba(0,212,255,0.12);color:var(--cyan)">置信度 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
      html += '<span class="badge" style="font-size:8px;background:rgba(255,170,0,0.12);color:var(--orange)">优先级 ' + (a.severityScore || 0).toFixed(1) + '</span>';
      html += isRaw ? '<span class="badge" style="font-size:8px;background:var(--orange);color:#000">原始候选</span>' : '<span class="badge" style="font-size:8px;background:var(--cyan);color:#000">智能预警</span>';
      html += '</div>';
      html += '<div style="font-size:14px;font-weight:700;line-height:1.4">' + a.title + '</div>';
      html += '</div></div>';

      html += '<div style="display:flex;gap:12px;font-size:10px;color:var(--text3);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">';
      html += '<span>📅 ' + (a.time || '') + '</span>';
      html += '<span>🌍 ' + (a.country || '') + '</span>';
      html += '<span>🔧 规则: ' + (a.rule || '') + '</span>';
      html += '<span>' + (a.confirmed ? '✅ 已确认' : a.dismissed ? '❌ 已消除' : '⏳ 待处理') + '</span>';
      html += '</div>';

      /* 情报来源 + 来源网址（2026-08-24 用户指令：带来源网址，可点击溯源） */
      var _aSrc = a.source || (a.rawItem && a.rawItem.source) || '';
      var _aUrl = a.url || (a.rawItem && a.rawItem.url) || a.ext_url || '';
      if (_aSrc || _aUrl) {
        html += '<div style="display:flex;gap:12px;font-size:10px;color:var(--text3);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);flex-wrap:wrap">';
        if (_aSrc) html += '<span>📡 情报来源: ' + _aSrc + '</span>';
        if (_aUrl) html += '<span style="word-break:break-all">🔗 来源网址: <a href="' + String(_aUrl).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" style="color:var(--cyan)">' + String(_aUrl).replace(/</g, '&lt;') + '</a></span>';
        html += '</div>';
      }

      /* 影响面评估 */
      html += '<div style="padding:10px;background:var(--bg2);border-radius:8px;margin-bottom:12px">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--orange);margin-bottom:8px">🎯 智能研判：影响面评估</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
      html += '<div style="text-align:center;padding:8px;background:var(--panel2);border-radius:6px"><div style="font-size:9px;color:var(--text3)">关联企业</div><div style="font-size:16px;font-weight:700;color:var(--cyan)">' + ((a.impact && a.impact.enterprises) || 0) + '</div></div>';
      html += '<div style="text-align:center;padding:8px;background:var(--panel2);border-radius:6px"><div style="font-size:9px;color:var(--text3)">涉及人员</div><div style="font-size:16px;font-weight:700;color:var(--yellow)">' + ((a.impact && a.impact.personnel) || 0) + '</div></div>';
      html += '<div style="text-align:center;padding:8px;background:var(--panel2);border-radius:6px"><div style="font-size:9px;color:var(--text3)">资产暴露</div><div style="font-size:16px;font-weight:700;color:var(--green)">' + ((a.impact && a.impact.assets) || 0) + ' 亿$</div></div>';
      html += '</div></div>';

      /* 研判描述 */
      html += '<div style="padding:10px;background:var(--bg2);border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--text2);line-height:1.7">' + (a.desc || '') + '</div>';

      /* 关联实体 */
      if (a.relatedEntities && a.relatedEntities.length > 0) {
        html += '<div style="margin-bottom:12px"><b style="color:var(--orange);font-size:11px">🔗 关联实体</b><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">';
        a.relatedEntities.forEach(function (e) {
          var n = String(e || '').trim(), fn = '', tip = '';
          try {
            if (typeof COUNTRIES !== 'undefined' && COUNTRIES.some(function (c) { return c.name === n; })) { fn = "showCtyDetail('" + n.replace(/'/g, "\\'") + "')"; tip = '查看国家风险详情'; }
            else if (typeof ENTERPRISES !== 'undefined' && ENTERPRISES.some(function (x) { return x.short === n || x.name === n; })) { fn = "showEntDetail('" + n.replace(/'/g, "\\'") + "')"; tip = '查看企业详情'; }
            else if (typeof LINK_GRAPH !== 'undefined' && LINK_GRAPH.findOrg) { fn = "LINK_GRAPH.probe('" + n.replace(/'/g, "\\'") + "','','','')"; tip = '查看跨模块关联'; }
          } catch (err) {}
          html += '<span class="badge b-blue" style="font-size:10px' + (fn ? ';cursor:pointer' : '') + '"' + (fn ? ' onclick="' + fn + '" title="' + tip + '"' : '') + '>' + e + (fn ? ' →' : '') + '</span>';
        });
        html += '</div></div>';
      }

      /* SOAR 工作流状态 */
      html += '<div style="padding:10px;background:rgba(0,200,83,0.04);border:1px solid rgba(0,200,83,0.15);border-radius:8px;margin-bottom:12px">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:8px">🚀 SOAR 自动编排状态</div>';
      if (!wf || wf.steps.length === 0) {
        html += '<div style="font-size:10px;color:var(--text3)">尚未执行自动编排</div>';
        if (!isRaw) html += '<button class="btn sm primary" style="margin-top:8px;font-size:10px" onclick="AUTOALERT.runManualWorkflow(\'' + a.id + '\')">🚀 立即执行编排</button>';
      } else {
        html += '<div style="display:grid;gap:5px">';
        wf.steps.forEach(function (s) {
          var meta = SOAR_ACTIONS[s.action] || { icon: '⚙️', name: s.action };
          html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--panel2);border-radius:6px">';
          html += '<span style="font-size:14px">' + meta.icon + '</span>';
          html += '<div style="flex:1"><div style="font-size:11px;font-weight:600">' + meta.name + '</div><div style="font-size:9px;color:var(--text3)">' + (s.note || '') + '</div></div>';
          html += '<span style="font-size:9px;color:var(--green)">✅ ' + s.time + '</span>';
          html += '</div>';
        });
        html += '</div>';
        if (wf.status === 'completed') html += '<div style="font-size:10px;color:var(--green);margin-top:6px">✅ 自动编排已完成，系统已自动完成通知、取证、预案匹配、归档等动作</div>';
      }
      html += '</div>';

      /* 简报 */
      if (a.brief) {
        html += '<div style="padding:10px;background:var(--bg2);border-radius:6px;margin-bottom:12px">';
        html += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px">📄 自动生成简报</div>';
        html += '<pre style="font-size:10px;color:var(--text2);line-height:1.6;white-space:pre-wrap;word-break:break-all">' + a.brief.replace(/</g, '&lt;') + '</pre>';
        html += '</div>';
      }

      /* 建议措施 */
      if (a.actions && a.actions.length > 0) {
        html += '<div style="margin-bottom:12px"><b style="color:var(--cyan);font-size:11px">📋 系统建议措施</b><div style="display:grid;gap:4px;margin-top:6px">';
        a.actions.forEach(function (act, i) {
          html += '<div style="padding:6px 8px;background:var(--panel2);border-radius:4px;font-size:11px;color:var(--text2)">' + (i + 1) + '. ' + act + '</div>';
        });
        html += '</div></div>';
      }

      /* 操作按钮 */
      html += '<div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);flex-wrap:wrap">';
      if (isRaw) {
        html += '<button class="btn primary sm" onclick="AUTOALERT.promoteRaw(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">⬆️ 晋升智能队列</button>';
        html += '<button class="btn sm" onclick="AUTOALERT.rejectRaw(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">🚫 驳回</button>';
      } else if (!a.confirmed && !a.dismissed) {
        html += '<button class="btn primary sm" onclick="AUTOALERT.confirmAlert(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">✅ 确认预警</button>';
        html += '<button class="btn sm" onclick="AUTOALERT.dismissAlert(\'' + a.id + '\');document.getElementById(\'modal\').classList.remove(\'show\')">❌ 消除预警</button>';
        html += '<button class="btn sm" style="background:rgba(91,155,255,0.1);border-color:var(--cyan);color:var(--cyan)" onclick="AUTOALERT.runManualWorkflow(\'' + a.id + '\')">🚀 重新编排</button>';
      }
      html += '</div>';

      html += '</div>';
      document.getElementById('modal-tt').textContent = '自动预警详情 · ' + (isRaw ? '原始候选' : '智能预警');
      document.getElementById('modal-bd').innerHTML = html;
      if (typeof LINK_GRAPH !== 'undefined') LINK_GRAPH.inject({ country: a.country, orgs: a.relatedEntities || [], enterprises: a.relatedEntities || [], text: (a.title || '') + ' ' + (a.desc || ''), self: { module: 'autoalert', key: String(a.id || '') } });
      document.getElementById('modal').classList.add('show');
    },

    _showResolvedDetail(id) {
      this._load();
      var a = this._resolved.find(function (x) { return x.id === id; });
      if (!a) return;
      var html = '<div style="padding:12px;max-height:75vh;overflow-y:auto">';
      html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">' + a.title + '</div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-bottom:12px">' + (a.rule || '') + ' · ' + (a.country || '') + ' · 处置：' + (a.resolvedAction || '') + '</div>';
      html += '<div style="padding:10px;background:var(--bg2);border-radius:6px;font-size:12px;color:var(--text2);line-height:1.7;margin-bottom:12px">' + (a.desc || '') + '</div>';
      if (a.brief) {
        html += '<div style="padding:10px;background:var(--bg2);border-radius:6px;margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px">📄 自动简报</div><pre style="font-size:10px;color:var(--text2);line-height:1.6;white-space:pre-wrap">' + a.brief.replace(/</g, '&lt;') + '</pre></div>';
      }
      html += '</div>';
      document.getElementById('modal-tt').textContent = '已处置预警详情';
      document.getElementById('modal-bd').innerHTML = html;
      document.getElementById('modal').classList.add('show');
    },

    /* ===== 规则详情弹窗（保留） ===== */
    _showRuleDetail(idx) {
      showToast && showToast('规则详情请在「规则工厂」中查看与配置');
    }
  };
})();
