/* ============================================================
 * autoalert-v2.js —— 未来安全形势智能预警中心
 * 监测中心 / 自动预警（完全重写，不依赖 v1-v7 任何逻辑）
 *
 * 设计目标
 *  1. 未来预警：基于当前真实态势（ALERTS/EVENTS/COUNTRIES/ASSETS/THREATS）
 *     计算未来 24h/72h/7d 的风险升级、风险走廊、资产暴露、威胁关联。
 *  2. 实战化：情报指挥中心风格，克制、专业、信息密度高，无炫光/霓虹。
 *  3. 全系统联动：与预警中心、态势总览、风险监测、企业资产、威胁组织、
 *     AI 报告、研判简报共享同一数据层，点击即跳转对应功能区。
 *  4. 零模拟：所有预测来自真实数据计算；无数据时灰显“态势平稳”。
 * ============================================================ */

(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  var _LEVEL_ORDER = { red: 4, orange: 3, yellow: 2, blue: 1 };
  var _LEVEL_COLOR = {
    red:   { bg: 'rgba(239,68,68,0.12)', border: '#ef4444', text: '#ef4444', label: '红' },
    orange:{ bg: 'rgba(249,115,22,0.12)', border: '#f97316', text: '#f97316', label: '橙' },
    yellow:{ bg: 'rgba(234,179,8,0.12)',  border: '#eab308', text: '#eab308', label: '黄' },
    blue:  { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', text: '#3b82f6', label: '蓝' }
  };
  var _CN_RE = /中国|中资|中企|中方|华人|华侨|华裔|中国公民|一带一路|瓜达尔|中巴经济走廊|汉班托塔|比雷埃夫斯|皎漂|中老铁路|雅万|蒙内|亚吉|钱凯|科伦坡港口城|中白工业园|吉布提|莱基|坦赞|西芒杜|中欧班列|Chinese|China|CPEC|Beijing/i;
  var _SEVERE_RE = /死亡|伤亡|遇害|遇难|绑架|人质|劫持|恐袭|爆炸|空袭|枪击|战争|政变|屠杀|撤侨|沉船|坠机|重大事故|重大灾害|地震.*伤亡|被武装人员带走|被带走|掳走|劫走|abduct/i;
  var _RISK_CORRIDOR = [
    { name: '南亚-中亚走廊', countries: ['巴基斯坦','阿富汗','印度','孟加拉国','尼泊尔','斯里兰卡','哈萨克斯坦','乌兹别克斯坦','吉尔吉斯斯坦','塔吉克斯坦','土库曼斯坦'] },
    { name: '非洲之角-萨赫勒走廊', countries: ['埃塞俄比亚','肯尼亚','吉布提','索马里','苏丹','南苏丹','尼日利亚','尼日尔','马里','布基纳法索','乍得','喀麦隆','中非'] },
    { name: '中东-波斯湾走廊', countries: ['伊朗','伊拉克','叙利亚','也门','黎巴嫩','约旦','以色列','巴勒斯坦','沙特阿拉伯','阿联酋','卡塔尔','阿曼','科威特','土耳其'] },
    { name: '东南亚-马六甲走廊', countries: ['缅甸','泰国','马来西亚','印度尼西亚','菲律宾','越南','柬埔寨','老挝','新加坡','文莱'] },
    { name: '拉美-加勒比走廊', countries: ['秘鲁','墨西哥','哥伦比亚','智利','阿根廷','委内瑞拉','巴西','厄瓜多尔','玻利维亚','牙买加','古巴'] }
  ];

  /* ---------- 工具函数 ---------- */
  function _hash4(s) {
    var h = 0, str = String(s || '');
    for (var i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36).slice(0, 4).toUpperCase();
  }
  function _stableId(type, key) { return 'AA-' + type + '-' + _hash4(key); }
  function _id() { return 'AA-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function _nowFmt() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function _fmtDate(s) {
    if (!s) return '';
    var d = new Date(s); if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function _hoursAgo(n) { return Date.now() - n * 3600000; }
  function _ts(s) { var d = new Date(s || 0); return isNaN(d.getTime()) ? 0 : d.getTime(); }
  function _hasChina(t) { return _CN_RE.test(String(t || '')); }
  function _isSevere(t) { return _SEVERE_RE.test(String(t || '')); }
  function _countryEvents(name) {
    if (typeof ALERTS === 'undefined') return [];
    return ALERTS.filter(function (a) { return (a.country || '') === name; });
  }
  function _countryByName(name) {
    if (typeof COUNTRIES === 'undefined') return null;
    return COUNTRIES.find(function (c) { return c.name === name; }) || null;
  }
  function _assetList() {
    var out = [];
    try {
      if (typeof ENTERPRISES !== 'undefined') ENTERPRISES.forEach(function (e) { (e.projects || []).forEach(function (p) { out.push({ type: 'project', name: p.name || p.n, country: p.country || p.c, enterprise: e.name, lat: p.lat, lng: p.lng }); }); });
      if (typeof ASSETS !== 'undefined') ASSETS.forEach(function (a) { (a.items || []).forEach(function (it) { out.push({ type: it.type || 'asset', name: it.name, country: it.country || a.country, enterprise: a.enterprise || '', lat: it.lat, lng: it.lng }); }); });
    } catch (e) {}
    return out;
  }
  function _threatList() {
    if (typeof THREATS === 'undefined') return [];
    try { return THREATS.getAll ? THREATS.getAll() : (THREATS.data || THREATS.list || []); } catch (e) { return []; }
  }
  function _uniq(arr, keyFn) {
    var seen = {}, out = [];
    arr.forEach(function (x) { var k = keyFn(x); if (!seen[k]) { seen[k] = 1; out.push(x); } });
    return out;
  }
  function _sortDesc(arr, scoreFn) {
    return arr.slice().sort(function (a, b) { return scoreFn(b) - scoreFn(a); });
  }

  /* ---------- 预测引擎 ---------- */
  var _FORECAST = {
    /* 国家未来 24h/72h/7d 风险升级预测 */
    countryForecast(country) {
      var events = _countryEvents(country.name).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(72); });
      var red = events.filter(function (a) { return a.level === 'red'; }).length;
      var orange = events.filter(function (a) { return a.level === 'orange'; }).length;
      var yellow = events.filter(function (a) { return a.level === 'yellow'; }).length;
      var cn = events.filter(function (a) { return _hasChina(a.title); }).length;
      var severe = events.filter(function (a) { return _isSevere(a.title); }).length;
      var score = country.scores ? (Math.max.apply(null, Object.values(country.scores)) || 0) : 0;
      var trend = country.trend || 'stable';
      var momentum = (red * 4) + (orange * 2) + (yellow * 0.5) + (cn * 2) + (severe * 1.5);
      momentum += (score >= 7 ? 2 : score >= 5 ? 1 : 0);
      if (trend === 'up') momentum += 2;
      var level = 'blue', horizon = '平稳';
      if (momentum >= 8) { level = 'red'; horizon = '24h 内可能升级'; }
      else if (momentum >= 5) { level = 'orange'; horizon = '72h 内需高度关注'; }
      else if (momentum >= 2) { level = 'yellow'; horizon = '7d 内存在风险'; }
      /* 未来红区硬约束：必须已有红区事件或严重暴力事件，不能仅靠制裁/表态类橙区事件堆砌 */
      if (level === 'red' && red === 0 && severe === 0) { level = 'orange'; horizon = '72h 内需高度关注'; }
      return { country: country.name, level: level, horizon: horizon, momentum: momentum.toFixed(1), factors: { red: red, orange: orange, cn: cn, severe: severe, score: score.toFixed(1), trend: trend } };
    },

    /* 风险走廊热度 */
    corridorHeat() {
      return _RISK_CORRIDOR.map(function (corr) {
        var evs = [];
        corr.countries.forEach(function (c) { evs = evs.concat(_countryEvents(c).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(72); })); });
        var red = evs.filter(function (a) { return a.level === 'red'; }).length;
        var orange = evs.filter(function (a) { return a.level === 'orange'; }).length;
        var cn = evs.filter(function (a) { return _hasChina(a.title); }).length;
        var score = red * 5 + orange * 2 + cn * 2;
        var level = score >= 10 ? 'red' : score >= 5 ? 'orange' : score >= 2 ? 'yellow' : 'blue';
        /* 走廊红区硬约束：不能仅靠非严重橙区事件堆砌 */
        if (level === 'red' && red === 0 && !evs.some(function (a) { return _isSevere(a.title); })) level = 'orange';
        return { name: corr.name, countries: corr.countries, events: evs.length, red: red, orange: orange, cn: cn, score: score, level: level };
      }).sort(function (a, b) { return b.score - a.score; });
    },

    /* 重点资产暴露预警 */
    assetExposure() {
      var assets = _assetList();
      var out = [];
      assets.forEach(function (asset) {
        var country = _countryByName(asset.country);
        var events = _countryEvents(asset.country).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(72); });
        if (!events.length && (!country || country.scores === undefined)) return;
        var score = 0, level = 'blue', reason = [];
        events.forEach(function (e) {
          if (e.level === 'red') score += 5;
          else if (e.level === 'orange') score += 2.5;
          else if (e.level === 'yellow') score += 1;
          if (_hasChina(e.title)) score += 2;
        });
        if (country && country.scores) { var ms = Math.max.apply(null, Object.values(country.scores)) || 0; score += ms >= 7 ? 3 : ms >= 5 ? 1.5 : 0; }
        if (score >= 8) { level = 'red'; reason.push('高风险环境+涉我要素'); }
        else if (score >= 5) { level = 'orange'; reason.push('环境风险上升'); }
        else if (score >= 2) { level = 'yellow'; reason.push('存在局部风险'); }
        else return;
        /* 资产红区硬约束：至少存在一起红区或严重暴力事件 */
        if (level === 'red' && !events.some(function (e) { return e.level === 'red' || _isSevere(e.title); })) level = 'orange';
        out.push({ id: _id(), type: 'asset_exposure', level: level, asset: asset.name, country: asset.country, enterprise: asset.enterprise, score: score.toFixed(1), reason: reason.join('，'), time: _nowFmt(), _forecast: true });
      });
      return _uniq(out, function (x) { return x.asset + '|' + x.country; });
    },

    /* 威胁组织-中方资产关联预警 */
    threatAssetLink() {
      var threats = _threatList();
      var assets = _assetList();
      var out = [];
      threats.forEach(function (t) {
        var activeCountries = (t.countries || t.active_regions || t.areas || []).map(function (c) { return String(c).trim(); });
        assets.forEach(function (asset) {
          if (activeCountries.indexOf(asset.country) >= 0) {
            var country = _countryByName(asset.country);
            var recentEvents = _countryEvents(asset.country).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(168) && _isSevere(a.title); }).length;
            var level = recentEvents >= 2 ? 'orange' : recentEvents >= 1 ? 'yellow' : 'blue';
            if (level === 'blue') return;
            out.push({ id: _id(), type: 'threat_asset', level: level, threat: t.name, asset: asset.name, country: asset.country, enterprise: asset.enterprise, recentEvents: recentEvents, time: _nowFmt(), _forecast: true });
          }
        });
      });
      return _uniq(out, function (x) { return x.threat + '|' + x.asset; });
    },

    /* 综合未来预警队列 */
    allForecasts() {
      var list = [];
      /* 国家升级预测（重点关注国） */
      if (typeof COUNTRIES !== 'undefined') {
        var focus = ['巴基斯坦','阿富汗','缅甸','尼日利亚','苏丹','刚果(金)','刚果（金）','伊拉克','也门','马里','尼日尔','索马里','叙利亚','利比亚','乌克兰','伊朗','印度','菲律宾','哥伦比亚','秘鲁','墨西哥','南非','泰国','埃塞俄比亚','肯尼亚','吉布提','埃及','斯里兰卡','孟加拉国','沙特阿拉伯','土耳其','哈萨克斯坦','印度尼西亚','马来西亚','越南','塞尔维亚','匈牙利','希腊','白俄罗斯','阿根廷','智利','委内瑞拉','巴西'];
        COUNTRIES.filter(function (c) { return focus.indexOf(c.name) >= 0; }).forEach(function (c) {
          var f = _FORECAST.countryForecast(c);
          if (f.level !== 'blue') list.push({ id: _id(), type: 'country_upgrade', level: f.level, title: f.country + '：' + f.horizon, country: f.country, score: f.momentum, factors: f.factors, time: _nowFmt(), _forecast: true });
        });
      }
      /* 资产暴露 */
      list = list.concat(_FORECAST.assetExposure());
      /* 威胁关联 */
      list = list.concat(_FORECAST.threatAssetLink());
      return _sortDesc(list, function (x) { return (_LEVEL_ORDER[x.level] || 0) * 100 + parseFloat(x.score || 0); });
    }
  };

  /* ---------- SOAR 预案匹配 ---------- */
  var _SOAR = {
    playbooks: [
      { id: 'P-01', name: '人员遇袭/绑架处置', trigger: /绑架|人质|劫持|被绑|遇害|被武装人员带走|掳走|劫走/, actions: ['通知驻外使领馆', '启动企业应急联系人', '推送安全提醒', '生成事件简报'] },
      { id: 'P-02', name: '项目/设施遇袭处置', trigger: /项目.*遇袭|设施.*爆炸|中企.*袭击|工厂.*火灾|工地.*袭击/, actions: ['通知项目安保', '调取GEOINT影像', '评估财产损失', '升级保险理赔'] },
      { id: 'P-03', name: '重大制裁合规预警', trigger: /制裁|禁运|出口管制|实体清单|SDN/, actions: ['合规筛查', '暂停相关交易', '上报法务/合规部', '生成制裁简报'] },
      { id: 'P-04', name: '社会动荡升级预警', trigger: /政变|大规模抗议|骚乱|冲突升级|戒严/, actions: ['发布旅行安全提示', '启动撤侨预案评估', '通知在华人华侨', '推送外交部门'] },
      { id: 'P-05', name: '网络安全事件响应', trigger: /网络攻击|黑客|数据泄露|勒索软件|APT/, actions: ['隔离受影响系统', '通知网络安全团队', '启动溯源', '上报主管部门'] }
    ],
    match(title) {
      var t = String(title || '');
      return this.playbooks.filter(function (p) { return p.trigger.test(t); });
    }
  };

  /* ---------- 主对象 ---------- */
  window.AUTOALERT = {
    _cfgKey: 'orps_autoalert_v2_cfg',
    _logsKey: 'orps_autoalert_v2_logs',
    _cfg: null,
    _logs: [],
    _forecasts: [],
    _selectedId: null,
    _timer: null,
    _engineOn: true,
    _lastRun: null,

    init() {
      this._loadCfg();
      this._loadLogs();
      this._injectCss();
      this._bindDataHub();
      this.run();
      this._startLoop();
    },

    _loadCfg() {
      try { this._cfg = JSON.parse(localStorage.getItem(this._cfgKey)) || null; } catch (e) { this._cfg = null; }
      if (!this._cfg) this._cfg = { engineOn: true, autoSoar: true, showBlue: false, focus: ['红','橙','黄'] };
    },
    _saveCfg() { try { localStorage.setItem(this._cfgKey, JSON.stringify(this._cfg)); } catch (e) {} },
    _loadLogs() { try { this._logs = JSON.parse(localStorage.getItem(this._logsKey)) || []; } catch (e) { this._logs = []; } },
    _saveLogs() { try { localStorage.setItem(this._logsKey, JSON.stringify(this._logs.slice(0, 200))); } catch (e) {} },
    _log(action, detail) {
      this._logs.unshift({ time: _nowFmt(), action: action, detail: detail });
      this._saveLogs();
    },

    _bindDataHub() {
      var self = this;
      try {
        if (typeof DataHub !== 'undefined' && DataHub.subscribe) {
          DataHub.subscribe('alerts', function () { self.run(); });
          DataHub.subscribe('live', function () { self.run(); });
        }
      } catch (e) {}
      try {
        if (typeof INTELBUS !== 'undefined' && INTELBUS.subscribe) {
          INTELBUS.subscribe(function () { self.run(); });
        }
      } catch (e) {}
    },

    _startLoop() {
      var self = this;
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(function () { self.run(); }, 60000);
    },

    run() {
      this._lastRun = _nowFmt();
      this._forecasts = _FORECAST.allForecasts();
      this.render();
      this._updateBadge();
    },

    _updateBadge() {
      try {
        var cnt = this._forecasts.filter(function (x) { return x.level === 'red' || x.level === 'orange'; }).length;
        var b = document.getElementById('sb-autoalert-count');
        if (b) { b.textContent = cnt; b.classList.toggle('zero', cnt === 0); }
      } catch (e) {}
    },

    /* ---------- 渲染 ---------- */
    render() {
      this._renderCommandBand();
      this._renderLeft();
      this._renderCenter();
      this._renderRight();
      this._renderDeck();
    },

    _renderCommandBand() {
      var el = document.getElementById('aa-commandband'); if (!el) return;
      var red = this._forecasts.filter(function (x) { return x.level === 'red'; }).length;
      var orange = this._forecasts.filter(function (x) { return x.level === 'orange'; }).length;
      var yellow = this._forecasts.filter(function (x) { return x.level === 'yellow'; }).length;
      var liveRed = (typeof ALERTS !== 'undefined') ? ALERTS.filter(function (a) { return a.level === 'red'; }).length : 0;
      el.innerHTML = '<div class="aa-band-left">' +
        '<span class="aa-title">⚡ 未来安全形势智能预警中心</span>' +
        '<span class="aa-pill ' + (this._engineOn ? 'on' : 'off') + '" onclick="AUTOALERT.toggleEngine()">' + (this._engineOn ? '● 引擎运行中' : '● 引擎已暂停') + '</span>' +
        '<span class="aa-meta">最近计算：' + (this._lastRun || '-') + '</span>' +
      '</div>' +
      '<div class="aa-band-stats">' +
        '<span class="aa-stat red"><b>' + red + '</b> 未来红区</span>' +
        '<span class="aa-stat orange"><b>' + orange + '</b> 未来橙区</span>' +
        '<span class="aa-stat yellow"><b>' + yellow + '</b> 未来黄区</span>' +
        '<span class="aa-stat live"><b>' + liveRed + '</b> 当前红区</span>' +
      '</div>';
    },

    _renderLeft() {
      var el = document.getElementById('aa-left'); if (!el) return;
      var corridors = _FORECAST.corridorHeat();
      var html = '<div class="aa-card">' +
        '<div class="aa-card-title">🌐 风险走廊热度</div>' +
        '<div class="aa-list">';
      if (!corridors.length || corridors[0].score === 0) {
        html += '<div class="aa-empty">近 72h 各走廊态势平稳</div>';
      } else {
        corridors.forEach(function (c) {
          var col = _LEVEL_COLOR[c.level];
          html += '<div class="aa-row" style="border-left:3px solid ' + col.border + '">' +
            '<div class="aa-row-head">' +
              '<span class="aa-dot" style="background:' + col.border + '"></span>' +
              '<span class="aa-row-title">' + c.name + '</span>' +
              '<span class="aa-row-lv" style="color:' + col.text + '">' + col.label + '</span>' +
            '</div>' +
            '<div class="aa-row-meta">' + c.events + ' 条事件 · 红 ' + c.red + ' · 橙 ' + c.orange + (c.cn ? ' · 涉华 ' + c.cn : '') + '</div>' +
            '<div class="aa-row-countries">' + c.countries.slice(0, 8).join(' · ') + '</div>' +
          '</div>';
        });
      }
      html += '</div></div>';

      /* 高危国家 TOP */
      var countryForecasts = [];
      if (typeof COUNTRIES !== 'undefined') {
        COUNTRIES.forEach(function (c) {
          var f = _FORECAST.countryForecast(c);
          if (f.level !== 'blue') countryForecasts.push(f);
        });
      }
      countryForecasts = _sortDesc(countryForecasts, function (x) { return (_LEVEL_ORDER[x.level] || 0) * 100 + parseFloat(x.momentum); }).slice(0, 8);
      html += '<div class="aa-card">' +
        '<div class="aa-card-title">📍 高危国家预测</div>' +
        '<div class="aa-list">';
      if (!countryForecasts.length) {
        html += '<div class="aa-empty">暂无显著升级迹象</div>';
      } else {
        countryForecasts.forEach(function (f) {
          var col = _LEVEL_COLOR[f.level];
          html += '<div class="aa-row" style="border-left:3px solid ' + col.border + '" onclick="AUTOALERT.openCountry(\'' + f.country + '\')">' +
            '<div class="aa-row-head">' +
              '<span class="aa-dot" style="background:' + col.border + '"></span>' +
              '<span class="aa-row-title">' + f.country + '</span>' +
              '<span class="aa-row-lv" style="color:' + col.text + '">' + f.horizon + '</span>' +
            '</div>' +
            '<div class="aa-row-meta">动量 ' + f.momentum + ' · 红' + f.factors.red + ' 橙' + f.factors.orange + ' 涉华' + f.factors.cn + ' 严重' + f.factors.severe + '</div>' +
          '</div>';
        });
      }
      html += '</div></div>';
      el.innerHTML = html;
    },

    _renderCenter() {
      var el = document.getElementById('aa-situations'); if (!el) return;
      var self = this;
      var visible = this._forecasts.filter(function (x) {
        if (x.level === 'blue' && !self._cfg.showBlue) return false;
        return true;
      });
      var html = '<div class="aa-filterbar" id="aa-filterbar">' +
        '<span class="aa-filter-title">智能研判队列</span>' +
        '<label><input type="checkbox" ' + (self._cfg.showBlue ? 'checked' : '') + ' onchange="AUTOALERT.toggleBlue()"> 显示蓝区</label>' +
      '</div>';
      if (!visible.length) {
        html += '<div class="aa-empty-big">当前态势平稳，未发现显著未来升级风险</div>';
      } else {
        html += '<div class="aa-queue">';
        visible.forEach(function (f) {
          var col = _LEVEL_COLOR[f.level];
          var selected = self._selectedId === f.id ? ' selected' : '';
          var icon = f.type === 'asset_exposure' ? '🏢' : f.type === 'threat_asset' ? '🎯' : f.type === 'country_upgrade' ? '📈' : '⚡';
          html += '<div class="aa-item' + selected + '" style="border-left:3px solid ' + col.border + '" onclick="AUTOALERT.select(\'' + f.id + '\')">' +
            '<div class="aa-item-head">' +
              '<span class="aa-item-icon">' + icon + '</span>' +
              '<span class="aa-item-lv" style="background:' + col.bg + ';color:' + col.text + ';border:1px solid ' + col.border + '">' + col.label + '</span>' +
              '<span class="aa-item-title" title="' + (f.title || '') + '">' + (f.title || f.asset || '-') + '</span>' +
              '<span class="aa-item-time">' + _fmtDate(f.time) + '</span>' +
            '</div>' +
            '<div class="aa-item-body">' +
              '<span class="aa-item-country">' + (f.country || '全球') + '</span>' +
              '<span class="aa-item-score">动量 ' + (f.score || '-') + '</span>' +
              '<span class="aa-item-reason">' + (f.reason || f.horizon || '') + '</span>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';
      }
      el.innerHTML = html;
    },

    _renderRight() {
      var el = document.getElementById('aa-right'); if (!el) return;
      var item = this._forecasts.find(function (x) { return x.id === this._selectedId; }, this);
      if (!item) {
        el.innerHTML = '<div class="aa-card aa-detail-card">' +
          '<div class="aa-card-title">🔗 联动处置</div>' +
          '<div class="aa-empty">点击左侧预警查看关联情报与处置建议</div>' +
        '</div>';
        return;
      }
      var col = _LEVEL_COLOR[item.level];
      var playbooks = _SOAR.match(item.title || item.asset || '');
      var related = (typeof ALERTS !== 'undefined') ? ALERTS.filter(function (a) {
        return (a.country || '') === (item.country || '') && _ts(a.time || a.publishedAt) > _hoursAgo(72);
      }).slice(0, 5) : [];
      var html = '<div class="aa-card aa-detail-card">' +
        '<div class="aa-detail-header" style="border-left:3px solid ' + col.border + '">' +
          '<span class="aa-detail-lv" style="background:' + col.bg + ';color:' + col.text + '">' + col.label + '</span>' +
          '<span class="aa-detail-title">' + (item.title || item.asset || '-') + '</span>' +
        '</div>' +
        '<div class="aa-detail-section">' +
          '<div class="aa-detail-label">预测依据</div>' +
          '<div class="aa-detail-text">' + (item.reason || item.horizon || '基于近期态势与风险动量计算') + '</div>' +
          (item.factors ? '<div class="aa-detail-factors">红 ' + item.factors.red + ' · 橙 ' + item.factors.orange + ' · 涉华 ' + item.factors.cn + ' · 严重 ' + item.factors.severe + '</div>' : '') +
        '</div>' +
        '<div class="aa-detail-section">' +
          '<div class="aa-detail-label">联动情报</div>';
      if (!related.length) {
        html += '<div class="aa-empty">近 72h 无同国关联预警</div>';
      } else {
        html += '<div class="aa-related-list">';
        related.forEach(function (r) {
          var rc = _LEVEL_COLOR[r.level || 'blue'];
          html += '<div class="aa-related" onclick="AUTOALERT.openAlert(' + (r.id ? '\'' + r.id + '\'' : '') + ')">' +
            '<span class="aa-related-lv" style="color:' + rc.text + '">[' + rc.label + ']</span>' +
            '<span class="aa-related-title">' + (r.title || '').slice(0, 40) + '</span>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      html += '<div class="aa-detail-section">' +
        '<div class="aa-detail-label">SOAR 预案</div>';
      if (!playbooks.length) {
        html += '<div class="aa-empty">未匹配标准预案，建议人工研判</div>';
      } else {
        playbooks.forEach(function (p) {
          html += '<div class="aa-playbook">' +
            '<div class="aa-playbook-name">' + p.id + ' ' + p.name + '</div>' +
            '<div class="aa-playbook-actions">' + p.actions.map(function (a) { return '<span class="aa-tag">' + a + '</span>'; }).join('') + '</div>' +
          '</div>';
        });
      }
      html += '</div>';
      html += '<div class="aa-detail-actions">' +
        '<button class="btn" onclick="AUTOALERT.pushToAlertCenter(\'' + item.id + '\')">推送至预警中心</button>' +
        '<button class="btn" onclick="AUTOALERT.createAiReport(\'' + item.id + '\')">生成 AI 简报</button>' +
        '<button class="btn" onclick="AUTOALERT.openCountry(\'' + (item.country || '') + '\')">查看国家态势</button>' +
      '</div>';
      html += '</div>';
      el.innerHTML = html;
    },

    _renderDeck() {
      var el = document.getElementById('aa-deck-host'); if (!el) return;
      var hours = [24, 72, 168];
      var stats = hours.map(function (h) {
        var evs = (typeof ALERTS !== 'undefined') ? ALERTS.filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(h); }) : [];
        return { h: h, total: evs.length, red: evs.filter(function (a) { return a.level === 'red'; }).length, orange: evs.filter(function (a) { return a.level === 'orange'; }).length, cn: evs.filter(function (a) { return _hasChina(a.title); }).length };
      });
      var html = '<div class="aa-deck">';
      stats.forEach(function (s) {
        html += '<div class="aa-deck-card">' +
          '<div class="aa-deck-title">近 ' + (s.h === 168 ? '7天' : s.h + 'h') + '</div>' +
          '<div class="aa-deck-row"><span>事件</span><b>' + s.total + '</b></div>' +
          '<div class="aa-deck-row red"><span>红区</span><b>' + s.red + '</b></div>' +
          '<div class="aa-deck-row orange"><span>橙区</span><b>' + s.orange + '</b></div>' +
          '<div class="aa-deck-row cyan"><span>涉华</span><b>' + s.cn + '</b></div>' +
        '</div>';
      });
      html += '<div class="aa-deck-card wide">' +
        '<div class="aa-deck-title">命中率与操作日志</div>' +
        '<div class="aa-logs">' + (this._logs.slice(0, 5).map(function (l) {
          return '<div class="aa-log">[' + l.time + '] ' + l.action + (l.detail ? ' · ' + l.detail : '') + '</div>';
        }).join('') || '<div class="aa-empty">暂无操作日志</div>') + '</div>' +
      '</div>';
      html += '</div>';
      el.innerHTML = html;
    },

    /* ---------- 交互 ---------- */
    toggleEngine() {
      this._engineOn = !this._engineOn;
      this._cfg.engineOn = this._engineOn;
      this._saveCfg();
      this._log(this._engineOn ? '启动预测引擎' : '暂停预测引擎');
      this.render();
    },
    toggleBlue() {
      this._cfg.showBlue = !this._cfg.showBlue;
      this._saveCfg();
      this.render();
    },
    select(id) {
      this._selectedId = id;
      this.render();
    },
    openCountry(name) {
      try {
        if (typeof navigateTo === 'function') navigateTo('monitor');
        if (typeof MONITOR !== 'undefined' && MONITOR.focusCountry) MONITOR.focusCountry(name);
      } catch (e) {}
    },
    openAlert(id) {
      try { if (typeof showAlertDetail === 'function' && id) showAlertDetail(id); } catch (e) {}
    },
    pushToAlertCenter(id) {
      var item = this._forecasts.find(function (x) { return x.id === id; });
      if (!item) return;
      try {
        if (typeof ALERTS !== 'undefined') {
          var a = { id: id, alert_no: id, level: item.level, type: '安全风险', country: item.country || '全球', title: item.title || item.asset || '未来风险预警', desc: item.reason || item.horizon || '', time: _nowFmt(), status: 'active', source: '自动预警预测', _forecast: true };
          ALERTS.unshift(a);
          if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts');
          if (typeof DataHub !== 'undefined' && DataHub._notify) DataHub._notify('alerts');
        }
        this._log('推送至预警中心', item.title || item.asset);
        showToast && showToast('已推送至预警中心');
      } catch (e) {}
    },
    createAiReport(id) {
      var item = this._forecasts.find(function (x) { return x.id === id; });
      if (!item) return;
      try {
        if (typeof AIREPORT !== 'undefined' && AIREPORT.newFromAutoAlert) AIREPORT.newFromAutoAlert(item);
        else if (typeof navigateTo === 'function') navigateTo('aireport');
        this._log('生成 AI 简报', item.title || item.asset);
      } catch (e) {}
    },

    /* ---------- 样式 ---------- */
    _injectCss() {
      if (document.getElementById('aa-v2-css')) return;
      var s = document.createElement('style');
      s.id = 'aa-v2-css';
      s.textContent = '' +
        ':root{--aa-bg0:var(--bg);--aa-bg1:var(--panel);--aa-bg2:var(--bg2);--aa-bg3:var(--panel2);}' +
        '#view-autoalert .aa-layout{display:flex;flex-direction:column;height:calc(100vh - 110px);overflow:hidden;}' +
        '#view-autoalert .aa-commandband{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--aa-bg1);border-bottom:1px solid var(--border);}' +
        '#view-autoalert .aa-band-left{display:flex;align-items:center;gap:12px;}' +
        '#view-autoalert .aa-title{font-size:15px;font-weight:800;color:var(--text);}' +
        '#view-autoalert .aa-pill{font-size:11px;padding:3px 10px;border-radius:12px;cursor:pointer;font-weight:700;}' +
        '#view-autoalert .aa-pill.on{background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid #22c55e;}' +
        '#view-autoalert .aa-pill.off{background:rgba(148,163,184,0.15);color:#94a3b8;border:1px solid #64748b;}' +
        '#view-autoalert .aa-meta{font-size:11px;color:var(--text3);}' +
        '#view-autoalert .aa-band-stats{display:flex;gap:10px;}' +
        '#view-autoalert .aa-stat{font-size:11px;color:var(--text2);background:var(--bg2);padding:4px 10px;border-radius:6px;}' +
        '#view-autoalert .aa-stat b{margin-right:4px;font-size:13px;}' +
        '#view-autoalert .aa-stat.red b{color:#ef4444;}' +
        '#view-autoalert .aa-stat.orange b{color:#f97316;}' +
        '#view-autoalert .aa-stat.yellow b{color:#eab308;}' +
        '#view-autoalert .aa-stat.live b{color:#0ea5e9;}' +
        '#view-autoalert .aa-main{display:flex;flex:1;overflow:hidden;gap:10px;padding:10px;}' +
        '#view-autoalert .aa-left{width:280px;display:flex;flex-direction:column;gap:10px;overflow:auto;}' +
        '#view-autoalert .aa-center{flex:1;display:flex;flex-direction:column;overflow:hidden;}' +
        '#view-autoalert .aa-right{width:320px;overflow:auto;}' +
        '#view-autoalert .aa-card{background:var(--aa-bg1);border:1px solid var(--border);border-radius:8px;padding:12px;}' +
        '#view-autoalert .aa-card-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;}' +
        '#view-autoalert .aa-list{display:flex;flex-direction:column;gap:8px;}' +
        '#view-autoalert .aa-row{padding:8px 10px;background:var(--bg2);border-radius:6px;cursor:pointer;transition:background .15s;}' +
        '#view-autoalert .aa-row:hover{background:var(--aa-bg3);}' +
        '#view-autoalert .aa-row-head{display:flex;align-items:center;gap:6px;margin-bottom:4px;}' +
        '#view-autoalert .aa-dot{width:7px;height:7px;border-radius:50%;}' +
        '#view-autoalert .aa-row-title{flex:1;font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '#view-autoalert .aa-row-lv{font-size:10px;font-weight:700;}' +
        '#view-autoalert .aa-row-meta{font-size:10px;color:var(--text3);margin-top:3px;}' +
        '#view-autoalert .aa-row-countries{font-size:9px;color:var(--text3);margin-top:3px;opacity:.8;}' +
        '#view-autoalert .aa-filterbar{display:flex;align-items:center;gap:12px;padding:8px 12px;background:var(--aa-bg1);border-bottom:1px solid var(--border);font-size:12px;}' +
        '#view-autoalert .aa-filter-title{flex:1;font-weight:700;color:var(--text);}' +
        '#view-autoalert .aa-empty{padding:20px;text-align:center;font-size:12px;color:var(--text3);}' +
        '#view-autoalert .aa-empty-big{flex:1;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text3);}' +
        '#view-autoalert .aa-queue{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--aa-bg0);}' +
        '#view-autoalert .aa-item{background:var(--aa-bg1);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer;transition:all .15s;}' +
        '#view-autoalert .aa-item:hover{background:var(--bg2);}' +
        '#view-autoalert .aa-item.selected{background:var(--aa-bg3);box-shadow:0 0 0 1px var(--cyan);}' +
        '#view-autoalert .aa-item-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}' +
        '#view-autoalert .aa-item-icon{font-size:13px;}' +
        '#view-autoalert .aa-item-lv{font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;}' +
        '#view-autoalert .aa-item-title{flex:1;font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '#view-autoalert .aa-item-time{font-size:10px;color:var(--text3);}' +
        '#view-autoalert .aa-item-body{display:flex;gap:10px;font-size:10px;color:var(--text2);flex-wrap:wrap;}' +
        '#view-autoalert .aa-item-score{font-weight:700;color:var(--cyan);}' +
        '#view-autoalert .aa-detail-header{display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:10px;}' +
        '#view-autoalert .aa-detail-lv{font-size:11px;font-weight:800;padding:2px 8px;border-radius:4px;}' +
        '#view-autoalert .aa-detail-title{font-size:13px;font-weight:700;color:var(--text);}' +
        '#view-autoalert .aa-detail-section{margin-bottom:14px;}' +
        '#view-autoalert .aa-detail-label{font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px;}' +
        '#view-autoalert .aa-detail-text{font-size:12px;color:var(--text2);line-height:1.5;}' +
        '#view-autoalert .aa-detail-factors{font-size:10px;color:var(--text3);margin-top:6px;}' +
        '#view-autoalert .aa-related-list{display:flex;flex-direction:column;gap:6px;}' +
        '#view-autoalert .aa-related{padding:6px 8px;background:var(--bg2);border-radius:5px;font-size:11px;cursor:pointer;}' +
        '#view-autoalert .aa-related:hover{background:var(--aa-bg3);}' +
        '#view-autoalert .aa-related-title{color:var(--text);}' +
        '#view-autoalert .aa-playbook{background:var(--bg2);border-radius:6px;padding:8px;margin-bottom:8px;}' +
        '#view-autoalert .aa-playbook-name{font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;}' +
        '#view-autoalert .aa-playbook-actions{display:flex;flex-wrap:wrap;gap:5px;}' +
        '#view-autoalert .aa-tag{font-size:9px;padding:2px 6px;background:var(--aa-bg3);color:var(--text2);border-radius:4px;border:1px solid var(--border);}' +
        '#view-autoalert .aa-detail-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}' +
        '#view-autoalert .aa-detail-actions .btn{font-size:11px;padding:5px 10px;}' +
        '#view-autoalert .aa-deck-host{padding:0 10px 10px;background:var(--aa-bg0);}' +
        '#view-autoalert .aa-deck{display:flex;gap:10px;}' +
        '#view-autoalert .aa-deck-card{flex:1;background:var(--aa-bg1);border:1px solid var(--border);border-radius:8px;padding:10px;}' +
        '#view-autoalert .aa-deck-card.wide{flex:2;}' +
        '#view-autoalert .aa-deck-title{font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;}' +
        '#view-autoalert .aa-deck-row{display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin:4px 0;}' +
        '#view-autoalert .aa-deck-row b{color:var(--text);}' +
        '#view-autoalert .aa-deck-row.red b{color:#ef4444;}' +
        '#view-autoalert .aa-deck-row.orange b{color:#f97316;}' +
        '#view-autoalert .aa-deck-row.cyan b{color:#0ea5e9;}' +
        '#view-autoalert .aa-logs{max-height:90px;overflow:auto;font-size:10px;color:var(--text2);}' +
        '#view-autoalert .aa-log{padding:2px 0;border-bottom:1px dashed var(--border);}' +
        '@media(max-width:1100px){#view-autoalert .aa-main{flex-direction:column;}#view-autoalert .aa-left,#view-autoalert .aa-right{width:auto;}}';
      document.head.appendChild(s);
    }
  };
})();
