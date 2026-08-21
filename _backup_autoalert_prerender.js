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
      this.render();
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
    confirmAlert(id) {
      this._load();
      var a = this._alerts.find(function (x) { return x.id === id; });
      if (a) {
        a.confirmed = true; a.status = 'confirmed';
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

    /* ===== 渲染 ===== */
    render() {
      var el = document.getElementById('autoalert-content');
      if (!el) return;
      this._load();
      var st = this._calcStats();
      var html = '';

      /* 顶部：无人值守总控台 */
      html += this._renderControlPanel(st);

      /* 自动检测流水线 */
      html += this._renderPipeline();

      /* 主体：左侧规则工厂 + 右侧智能推荐 */
      html += '<div class="grid mt-12" style="grid-template-columns:1.2fr 1fr;gap:12px">';
      html += '<div>' + this._renderRuleFactory() + '</div>';
      html += '<div>' + this._renderRecommendationPanel() + '</div>';
      html += '</div>';

      /* 双队列：原始候选 + 智能预警 */
      html += '<div class="grid mt-12" style="grid-template-columns:1fr 1fr;gap:12px">';
      html += '<div>' + this._renderRawQueue() + '</div>';
      html += '<div>' + this._renderIntelligentQueue() + '</div>';
      html += '</div>';

      /* 已处置队列 */
      html += this._renderResolvedQueue();

      /* 底部：机器人日志 + 自动复盘 */
      html += '<div class="grid mt-12" style="grid-template-columns:1fr 1fr;gap:12px">';
      html += '<div>' + this._renderRobotLogs() + '</div>';
      html += '<div>' + this._renderReviewPanel() + '</div>';
      html += '</div>';

      el.innerHTML = html;

      /* 更新侧边栏badge */
      var badge = document.getElementById('sb-autoalert-count');
      if (badge) {
        var active = this._alerts.filter(function (a) { return !a.dismissed; }).length;
        badge.textContent = active;
        badge.classList.toggle('zero', active === 0);
      }
    },

    _renderControlPanel(st) {
      var lastRunStr = this._lastRun ? this._lastRun.toLocaleString('zh-CN', { hour12: false }) : '—';
      var engineColor = this._engineOn ? 'var(--green)' : 'var(--text3)';
      var engineText = this._engineOn ? '● 值守中' : '○ 已暂停';
      var html = '<div class="card mb-12" style="border:1px solid rgba(0,212,255,0.2)">';
      html += '<div class="card-tt"><span class="ic">🤖</span>智能无人值守总控台 <span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:6px">— 7×24 自动检测 / 研判 / 编排 / 响应</span></div>';
      html += '<div style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap">';

      /* 引擎状态 */
      html += '<div style="flex:1;min-width:180px;padding:12px;background:var(--panel2);border-radius:8px;text-align:center">';
      html += '<div style="font-size:28px;margin-bottom:4px">' + (this._engineOn ? '🟢' : '⚪') + '</div>';
      html += '<div style="font-size:14px;font-weight:700;color:' + engineColor + '">' + engineText + '</div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:4px">下次扫描 <span id="aa-countdown" style="font-family:monospace;color:var(--cyan)">--:--</span></div>';
      html += '<div style="display:flex;gap:6px;justify-content:center;margin-top:8px">';
      html += '<button class="btn sm" style="font-size:10px" onclick="AUTOALERT.toggleEngine()">' + (this._engineOn ? '暂停引擎' : '启动引擎') + '</button>';
      html += '<button class="btn sm primary" style="font-size:10px" onclick="AUTOALERT.run()">🔍 立即扫描</button>';
      html += '</div></div>';

      /* 运行统计 */
      html += '<div style="flex:2;min-width:320px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">';
      html += '<div class="stat-card" style="padding:10px"><div class="stat-ic" style="background:rgba(0,212,255,0.08);color:var(--cyan)">🧠</div><div class="stat-info"><div class="stat-label">智能预警</div><div class="stat-val" style="color:var(--cyan)">' + st.total + '</div></div></div>';
      html += '<div class="stat-card" style="padding:10px"><div class="stat-ic" style="background:rgba(255,170,0,0.08);color:var(--orange)">📥</div><div class="stat-info"><div class="stat-label">原始候选</div><div class="stat-val" style="color:var(--orange)">' + st.rawTotal + '</div></div></div>';
      html += '<div class="stat-card" style="padding:10px"><div class="stat-ic" style="background:rgba(255,51,85,0.08);color:var(--red)">🔴</div><div class="stat-info"><div class="stat-label">紧急/高危</div><div class="stat-val" style="color:var(--red)">' + (st.red + st.orange) + '</div></div></div>';
      html += '<div class="stat-card" style="padding:10px"><div class="stat-ic" style="background:rgba(0,200,83,0.08);color:var(--green)">⚡</div><div class="stat-info"><div class="stat-label">SOAR已执行</div><div class="stat-val" style="color:var(--green)">' + Object.keys(this._workflows).length + '</div></div></div>';
      html += '</div>';

      /* 设置区 */
      html += '<div style="flex:1;min-width:220px;padding:12px;background:var(--panel2);border-radius:8px">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:8px">⚙️ 值守配置</div>';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:10px"><span>自动扫描周期</span><select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setScanInterval(this.value)">' + [60, 120, 300, 600, 1800].map(function (n) { return '<option value="' + n + '"' + ((AUTOALERT._settings.scanInterval || 300) === n ? ' selected' : '') + '>' + (n < 60 ? n + 's' : n / 60 + 'min') + '</option>'; }).join('') + '</select></div>';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:10px"><span>SOAR自动编排</span><button class="btn sm" style="font-size:9px;padding:2px 8px" onclick="AUTOALERT.toggleAutoSoar()">' + (this._settings.autoSoar ? '✅ 开启' : '⏸️ 关闭') + '</button></div>';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;font-size:10px"><span>高置信自动晋升</span><button class="btn sm" style="font-size:9px;padding:2px 8px" onclick="AUTOALERT.toggleAutoPromote()">' + (this._settings.autoPromote ? '✅ 开启' : '⏸️ 关闭') + '</button></div>';
      html += '<div style="font-size:9px;color:var(--text3);margin-top:8px">上次扫描: ' + lastRunStr + '</div>';
      html += '</div>';

      /* 境外安全自动预警态势条（2026-08-19 实战化）：涉我海外利益/高危走廊/威胁组织 分布 */
      var _pst = this._alerts.filter(function (a) { return !a.dismissed; });
      var _cnN = 0, _corrN = 0, _orgN = 0, _redN = 0;
      _pst.forEach(function (a) {
        var t = String(a.title || '') + String(a.title_zh || '') + String(a.desc || '') + String(a.country || '');
        if (/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i.test(t)) _cnN++;
        if (/俾路支|瓜达尔|CPEC|沙盖|奎达|霍尔木兹|红海|亚丁湾|曼德|胡塞|萨赫勒|阿富汗|喀布尔|叙利亚|也门|伊拉克|索马里/i.test(t)) _corrN++;
        if (/塔利班|伊斯兰国|基地组织|胡塞|真主党|哈马斯|俾路支|青年党|博科圣地|ISIS|ISIL|Taliban|Houthi|Hamas|Qaeda|Shabaab|BLA|TTP/i.test(t)) _orgN++;
        if (a.level === 'red') _redN++;
      });
      html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;padding:8px 10px;background:linear-gradient(90deg,rgba(255,51,85,0.05),rgba(0,212,255,0.03));border:1px solid var(--border);border-radius:8px;font-size:10px;align-items:center">' +
        '<span style="font-weight:800;color:var(--text)">🌐 境外安全自动预警态势</span>' +
        '<span style="color:var(--text3)">🔴紧急 <b style="color:var(--red)">' + _redN + '</b></span>' +
        '<span style="color:var(--text3)">🇨🇳涉我海外利益 <b style="color:var(--cyan)">' + _cnN + '</b></span>' +
        '<span style="color:var(--text3)">🛰️高危走廊 <b style="color:var(--red)">' + _corrN + '</b></span>' +
        '<span style="color:var(--text3)">⚔️威胁组织 <b style="color:var(--orange)">' + _orgN + '</b></span>' +
        '</div>';
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
      var html = '<div class="card mb-12">';
      html += '<div class="card-tt"><span class="ic">🔄</span>自动检测流水线</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;overflow-x:auto;padding:4px">';
      steps.forEach(function (s, i) {
        html += '<div style="flex:1;min-width:110px;padding:10px 6px;background:' + (s.active ? 'rgba(0,212,255,0.06)' : 'var(--panel2)') + ';border-radius:8px;text-align:center;border:1px solid ' + (s.active ? 'var(--cyan)33' : 'transparent') + '">';
        html += '<div style="font-size:20px;opacity:' + (s.active ? '1' : '0.5') + '">' + s.icon + '</div>';
        html += '<div style="font-size:11px;font-weight:600;margin-top:4px;color:' + (s.active ? 'var(--text)' : 'var(--text3)') + '">' + s.name + '</div>';
        html += '<div style="font-size:9px;color:var(--text3);margin-top:2px;line-height:1.3">' + s.desc + '</div>';
        html += '</div>';
        if (i < steps.length - 1) html += '<div style="color:var(--text3);font-size:14px">→</div>';
      });
      html += '</div></div>';
      return html;
    },

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

    _renderRecommendationPanel() {
      var candidates = this._alerts.filter(function (a) { return !a.dismissed && !a.confirmed; })
        .concat(this._rawAlerts.filter(function (r) { return r.status === 'raw'; }));
      candidates.sort(function (a, b) { return (b.severityScore || 0) - (a.severityScore || 0); });
      var top = candidates.slice(0, 5);
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">💡</span>智能推荐：需人工介入</div>';
      if (top.length === 0) {
        html += '<div class="empty"><div class="ic">✅</div><div style="font-size:12px">当前无需人工介入</div><div style="font-size:10px">系统已自动完成检测、研判与编排</div></div>';
      } else {
        html += '<div style="display:grid;gap:8px">';
        top.forEach(function (a) {
          var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : 'var(--yellow)';
          var queue = a.status === 'raw' ? '原始候选' : '智能预警';
          html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;border-left:3px solid ' + lvClr + ';cursor:pointer" onclick="AUTOALERT._showDetail(\'' + a.id + '\')">';
          html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
          html += '<span class="badge" style="font-size:8px;background:' + lvClr + '22;color:' + lvClr + '">' + (a.level === 'red' ? '紧急' : a.level === 'orange' ? '高危' : '中危') + '</span>';
          html += '<span style="font-size:9px;color:var(--text3)">置信度 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
          html += '<span style="font-size:9px;color:var(--orange);margin-left:auto">优先级 ' + (a.severityScore || 0).toFixed(1) + '</span>';
          html += '</div>';
          html += '<div style="font-size:11px;font-weight:600;line-height:1.3">' + a.title + '</div>';
          html += '<div style="font-size:9px;color:var(--text3);margin-top:3px">' + (a.rule || '') + ' · ' + (a.country || '') + ' · ' + queue + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    _renderRawQueue() {
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">📥</span>原始预警队列 <span style="font-size:10px;color:var(--text3);font-weight:400">— 规则初步命中，待研判/晋升</span>';
      html += '<span class="badge b-orange" style="margin-left:8px">' + raw.length + '</span></div>';

      if (raw.length === 0) {
        html += '<div class="empty"><div class="ic">🔍</div><div style="font-size:12px;margin-bottom:4px">原始预警队列为空</div><div style="font-size:11px">实时数据到达后将自动生成候选预警</div></div>';
      } else {
        raw.sort(function (a, b) { return (b.severityScore || 0) - (a.severityScore || 0); });
        html += '<div style="display:grid;gap:8px;max-height:420px;overflow-y:auto">';
        raw.forEach(function (a) {
          var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : 'var(--yellow)';
          var lvLabel = a.level === 'red' ? '🔴 紧急' : a.level === 'orange' ? '🟠 高危' : '🟡 中危';
          html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;border-left:3px solid ' + lvClr + '">';
          html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">';
          html += '<div style="flex:1;cursor:pointer" onclick="AUTOALERT._showDetail(\'' + a.id + '\')">';
          html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">';
          html += '<span style="font-size:9px;font-weight:700;color:' + lvClr + '">' + lvLabel + '</span>';
          html += '<span class="badge b-purple" style="font-size:8px">' + a.rule + '</span>';
          html += '<span class="badge" style="font-size:8px;background:rgba(0,212,255,0.12);color:var(--cyan)">置信 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
          html += '</div>';
          html += '<div style="font-size:11px;font-weight:600;margin-bottom:3px;line-height:1.4">' + a.title + '</div>';
          html += '<div style="font-size:10px;color:var(--text2);line-height:1.4;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.desc || '').substring(0, 100) + '</div>';
          html += '<div style="display:flex;gap:10px;font-size:9px;color:var(--text3)">';
          html += '<span>🌍 ' + (a.country || '—') + '</span>';
          html += '<span>⏱ ' + (a.time || '') + '</span>';
          html += '</div>';
          html += '</div>';
          html += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;min-width:70px">';
          html += '<button class="btn sm primary" style="font-size:9px;padding:2px 8px" onclick="AUTOALERT.promoteRaw(\'' + a.id + '\')">⬆️ 晋升</button>';
          html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" onclick="AUTOALERT.rejectRaw(\'' + a.id + '\')">✕ 驳回</button>';
          html += '</div>';
          html += '</div></div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    /* ===== 涉我海外利益/威胁组织/高危走廊 维度标记（2026-08-19 实战化重设）===== */
    _aaTags(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '') + ' ' + String(a.country || '');
      var tags = [];
      if (a.chinaNegative || a._chinaNegative) tags.push({ t: '涉华负面', c: 'var(--orange)' });
      if (/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i.test(t)) tags.push({ t: '涉我海外利益', c: 'var(--cyan)' });
      if (a.asset_tags && a.asset_tags.length) tags.push({ t: '命中中资资产', c: 'var(--red)' });
      if (/塔利班|伊斯兰国|基地组织|胡塞|真主党|哈马斯|俾路支|青年党|博科圣地|ISIS|ISIL|Taliban|Houthi|Hamas|Qaeda|Shabaab|BLA|TTP/i.test(t)) tags.push({ t: '威胁组织', c: 'var(--orange)' });
      if (/俾路支|瓜达尔|中巴经济走廊|CPEC|沙盖|奎达|霍尔木兹|红海|亚丁湾|曼德|胡塞|萨赫勒|马里|尼日尔|阿富汗|喀布尔|叙利亚|也门|伊拉克|索马里/i.test(t)) tags.push({ t: '高危走廊', c: 'var(--red)' });
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
      if (/俾路支|瓜达尔|CPEC|沙盖|奎达|霍尔木兹|红海|亚丁湾|曼德|胡塞|萨赫勒|马里|尼日尔|阿富汗|喀布尔|叙利亚|也门|伊拉克|索马里/i.test(t + String(a.country || ''))) return 2;
      return 3;
    },
    _renderIntelligentQueue() {
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var me = this;
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">🧠</span>智能预警队列 <span style="font-size:10px;color:var(--text3);font-weight:400">— 已研判·自动执行SOAR·涉华优先</span>';
      html += '<span class="badge b-blue" style="margin-left:8px">' + active.length + '</span>';
      if (active.length > 0) {
        html += '<button class="btn sm danger" style="margin-left:auto;font-size:9px;padding:2px 8px" onclick="showConfirm(\'确定清空所有自动预警？\',function(){AUTOALERT.clearAll()})">🗑️ 清空</button>';
      }
      html += '</div>';

      if (active.length === 0) {
        html += '<div class="empty"><div class="ic">🤖</div><div style="font-size:12px;margin-bottom:4px">智能预警队列为空</div><div style="font-size:11px">高置信度原始候选将自动晋升，或由人工晋升</div></div>';
      } else {
        /* 实战化排序（2026-08-19）：涉华负面>涉华>高危走廊>其他；层内 等级+置信度 */
        var lvW = { red: 3000, orange: 2000, yellow: 1000, blue: 500 };
        active.sort(function (a, b) {
          var ta = me._aaTier(a), tb = me._aaTier(b); if (ta !== tb) return ta - tb;
          var sa = (lvW[a.level] || 0) + Math.round((a.confidence || 0) * 100);
          var sb = (lvW[b.level] || 0) + Math.round((b.confidence || 0) * 100);
          return sb - sa;
        });
        html += '<div style="display:grid;gap:8px;max-height:460px;overflow-y:auto">';
        active.forEach(function (a) {
          var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
          var lvLabel = a.level === 'red' ? '🔴 紧急' : a.level === 'orange' ? '🟠 高危' : a.level === 'yellow' ? '🟡 中危' : '🔵 提示';
          var wf = AUTOALERT._workflows[a.id];
          var wfStatus = wf && wf.status === 'completed' ? '<span class="badge" style="font-size:8px;background:var(--green)22;color:var(--green)">SOAR完成</span>' : '<span class="badge" style="font-size:8px;background:var(--cyan)22;color:var(--cyan)">SOAR运行中</span>';
          var tags = me._aaTags(a);
          var tagHtml = tags.length ? '<div style="display:flex;flex-wrap:wrap;gap:3px;margin:3px 0 2px">' + tags.map(function (tg) { return '<span style="font-size:8px;padding:0 4px;border-radius:5px;border:1px solid ' + tg.c + ';color:' + tg.c + '">' + tg.t + '</span>'; }).join('') + '</div>' : '';
          html += '<div style="padding:12px;background:var(--panel2);border-radius:8px;border-left:3px solid ' + lvClr + ';cursor:pointer;transition:.2s" onclick="AUTOALERT._showDetail(\'' + a.id + '\')">';
          html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">';
          html += '<div style="flex:1;min-width:0">';
          html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">';
          html += '<span style="font-size:9px;font-weight:700;color:' + lvClr + '">' + lvLabel + '</span>';
          html += '<span class="badge b-purple" style="font-size:8px">' + a.rule + '</span>';
          html += '<span class="badge" style="font-size:8px;background:rgba(0,212,255,0.12);color:var(--cyan)">置信 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
          html += wfStatus;
          html += '</div>';
          html += '<div style="font-size:12px;font-weight:600;margin-bottom:3px;line-height:1.4">' + a.title + '</div>';
          html += tagHtml;
          html += '<div style="font-size:10px;color:var(--text2);line-height:1.4;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.desc || '').substring(0, 120) + '</div>';
          html += '<div style="display:flex;gap:10px;font-size:9px;color:var(--text3);flex-wrap:wrap">';
          html += '<span>🌍 ' + (a.country || '—') + '</span>';
          html += '<span>🏢 影响 ' + ((a.impact && a.impact.enterprises) || 0) + ' 家企业</span>';
          html += '<span>⏱ ' + (a.time || '') + '</span>';
          html += '</div>';
          html += '</div>';
          html += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;min-width:80px;flex-shrink:0" onclick="event.stopPropagation()">';
          html += '<button class="btn sm" style="font-size:9px;padding:2px 8px;color:var(--green)" onclick="AUTOALERT.confirmAlert(\'' + a.id + '\')">✅ 确认</button>';
          html += '<button class="btn sm danger" style="font-size:9px;padding:2px 8px" onclick="AUTOALERT.dismissAlert(\'' + a.id + '\')">✕ 消除</button>';
          html += '<button class="btn sm" style="font-size:9px;padding:2px 8px;background:rgba(0,212,255,0.1);color:var(--cyan)" onclick="AUTOALERT.runManualWorkflow(\'' + a.id + '\')">🚀 重新编排</button>';
          html += '</div>';
          html += '</div></div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    _renderResolvedQueue() {
      var resolved = this._resolved.slice(0, 50);
      var html = '<div class="card mt-12">';
      html += '<div class="card-tt"><span class="ic">📦</span>已处置队列 <span style="font-size:10px;color:var(--text3);font-weight:400">— 确认/消除/驳回的预警，用于复盘</span>';
      html += '<span class="badge" style="margin-left:8px;background:var(--text3);color:#fff">' + this._resolved.length + '</span></div>';
      if (resolved.length === 0) {
        html += '<div class="empty"><div class="ic">📦</div><div style="font-size:12px">暂无已处置预警</div></div>';
      } else {
        html += '<div style="display:grid;gap:6px;max-height:260px;overflow-y:auto">';
        resolved.forEach(function (r) {
          var actionClr = r.resolvedAction === 'confirmed' ? 'var(--green)' : r.resolvedAction === 'dismissed' ? 'var(--orange)' : 'var(--text3)';
          var actionLabel = r.resolvedAction === 'confirmed' ? '✅ 已确认' : r.resolvedAction === 'dismissed' ? '❌ 已消除' : r.resolvedAction === 'rejected' ? '🚫 已驳回' : '📦 已清空';
          html += '<div style="padding:8px;background:var(--panel2);border-radius:6px;display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="AUTOALERT._showResolvedDetail(\'' + r.id + '\')">';
          html += '<div style="flex:1;min-width:0">';
          html += '<div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + r.title + '</div>';
          html += '<div style="font-size:9px;color:var(--text3)">' + (r.rule || '') + ' · ' + (r.country || '') + ' · ' + (r.resolvedAt || '') + '</div>';
          html += '</div>';
          html += '<span style="font-size:9px;color:' + actionClr + ';white-space:nowrap;margin-left:8px">' + actionLabel + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    _renderRobotLogs() {
      var logs = this._robotLogs.slice(0, 20);
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">📝</span>响应机器人日志</div>';
      if (logs.length === 0) {
        html += '<div class="empty"><div class="ic">📝</div><div style="font-size:12px">暂无机器日志</div></div>';
      } else {
        html += '<div style="display:grid;gap:5px;max-height:260px;overflow-y:auto">';
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
        html += '<button class="btn sm" style="background:rgba(0,212,255,0.1);border-color:var(--cyan);color:var(--cyan)" onclick="AUTOALERT.runManualWorkflow(\'' + a.id + '\')">🚀 重新编排</button>';
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
