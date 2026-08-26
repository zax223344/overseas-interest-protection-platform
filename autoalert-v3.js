/* ============================================================
 * autoalert-v3.js —— 未来安全形势预测中心
 * 完全重写 v2，不再使用任何被删除的旧态势面板结构。
 *
 * 设计原则
 *  1. 未来导向：以 24h/72h/7d 时间轴为核心，呈现风险升级预测。
 *  2. 实战指挥：顶部关键指标 → 预测情景 → 趋势图表 → 资产暴露 → 处置建议。
 *  3. 全系统联动：与预警中心、态势总览、风险监测、企业资产、威胁组织、
 *     AI 报告共享同一数据层，点击即跳转对应功能区。
 *  4. 零模拟：所有预测来自真实 ALERTS/EVENTS/COUNTRIES/ASSETS/THREATS。
 * ============================================================ */

(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  var _LEVEL_ORDER = { red: 4, orange: 3, yellow: 2, blue: 1 };
  var _LEVEL_COLOR = {
    red:   { bg: 'rgba(239,68,68,0.14)', border: '#ef4444', text: '#ef4444', label: '红区' },
    orange:{ bg: 'rgba(249,115,22,0.14)', border: '#f97316', text: '#f97316', label: '橙区' },
    yellow:{ bg: 'rgba(234,179,8,0.14)',  border: '#eab308', text: '#eab308', label: '黄区' },
    blue:  { bg: 'rgba(59,130,246,0.14)', border: '#3b82f6', text: '#3b82f6', label: '平稳' }
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
  var _FOCUS_COUNTRIES = ['巴基斯坦','阿富汗','缅甸','尼日利亚','苏丹','刚果(金)','刚果（金）','伊拉克','也门','马里','尼日尔','索马里','叙利亚','利比亚','乌克兰','伊朗','印度','菲律宾','哥伦比亚','秘鲁','墨西哥','南非','泰国','埃塞俄比亚','肯尼亚','吉布提','埃及','斯里兰卡','孟加拉国','沙特阿拉伯','土耳其','哈萨克斯坦','印度尼西亚','马来西亚','越南','塞尔维亚','匈牙利','希腊','白俄罗斯','阿根廷','智利','委内瑞拉','巴西'];

  /* ---------- 工具函数 ---------- */
  function _id() { return 'AA-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function _hash4(s) { var h = 0, str = String(s || ''); for (var i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36).slice(0, 4).toUpperCase(); }
  function _stableId(type, key) { return 'AA-' + type + '-' + _hash4(key); }
  function _nowFmt() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function _fmtDate(s) { if (!s) return ''; var d = new Date(s); if (isNaN(d.getTime())) return ''; var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function _hoursAgo(n) { return Date.now() - n * 3600000; }
  function _ts(s) { var d = new Date(s || 0); return isNaN(d.getTime()) ? 0 : d.getTime(); }
  function _hasChina(t) { return _CN_RE.test(String(t || '')); }
  function _isSevere(t) { return _SEVERE_RE.test(String(t || '')); }
  function _countryEvents(name) { if (typeof ALERTS === 'undefined') return []; return ALERTS.filter(function (a) { return (a.country || '') === name; }); }
  function _countryByName(name) { if (typeof COUNTRIES === 'undefined') return null; return COUNTRIES.find(function (c) { return c.name === name; }) || null; }
  function _assetList() { var out = []; try { if (typeof ENTERPRISES !== 'undefined') ENTERPRISES.forEach(function (e) { (e.projects || []).forEach(function (p) { out.push({ type: 'project', name: p.name, country: p.country, enterprise: e.name, lat: p.lat, lng: p.lng }); }); }); if (typeof ASSETS !== 'undefined') ASSETS.forEach(function (a) { (a.items || []).forEach(function (it) { out.push({ type: it.type || 'asset', name: it.name, country: it.country || a.country, enterprise: a.enterprise || '', lat: it.lat, lng: it.lng }); }); }); } catch (e) {} return out; }
  function _threatList() { if (typeof THREATS === 'undefined') return []; try { return THREATS.getAll ? THREATS.getAll() : (THREATS.data || THREATS.list || []); } catch (e) { return []; } }
  function _uniq(arr, keyFn) { var seen = {}, out = []; arr.forEach(function (x) { var k = keyFn(x); if (!seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
  function _sortDesc(arr, scoreFn) { return arr.slice().sort(function (a, b) { return scoreFn(b) - scoreFn(a); }); }

  /* ---------- 预测引擎 ---------- */
  var _FORECAST = {
    _countryMomentum(country, hours) {
      var events = _countryEvents(country.name).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(hours); });
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
      return { red: red, orange: orange, yellow: yellow, cn: cn, severe: severe, score: score, trend: trend, momentum: momentum };
    },
    _levelFromMomentum(momentum, red, severe) {
      var level = 'blue', horizon = '平稳', hours = '7d';
      if (momentum >= 8) { level = 'red'; horizon = '24h 内可能升级'; hours = '24h'; }
      else if (momentum >= 5) { level = 'orange'; horizon = '72h 内需高度关注'; hours = '72h'; }
      else if (momentum >= 2) { level = 'yellow'; horizon = '7d 内存在风险'; hours = '7d'; }
      /* 未来红区硬约束：必须已有红区事件或严重暴力事件 */
      if (level === 'red' && red === 0 && severe === 0) { level = 'orange'; horizon = '72h 内需高度关注'; hours = '72h'; }
      return { level: level, horizon: horizon, hours: hours };
    },
    countryForecast(country) {
      var m24 = this._countryMomentum(country, 24);
      var m72 = this._countryMomentum(country, 72);
      var m168 = this._countryMomentum(country, 168);
      var cur = this._levelFromMomentum(m72.momentum, m72.red, m72.severe);
      return {
        country: country.name,
        level: cur.level,
        horizon: cur.horizon,
        hours: cur.hours,
        momentum: m72.momentum.toFixed(1),
        windows: {
          '24h': { momentum: m24.momentum.toFixed(1), level: this._levelFromMomentum(m24.momentum, m24.red, m24.severe).level, red: m24.red, orange: m24.orange, severe: m24.severe },
          '72h': { momentum: m72.momentum.toFixed(1), level: this._levelFromMomentum(m72.momentum, m72.red, m72.severe).level, red: m72.red, orange: m72.orange, severe: m72.severe },
          '7d':  { momentum: m168.momentum.toFixed(1), level: this._levelFromMomentum(m168.momentum, m168.red, m168.severe).level, red: m168.red, orange: m168.orange, severe: m168.severe }
        },
        factors: { red: m72.red, orange: m72.orange, yellow: m72.yellow, cn: m72.cn, severe: m72.severe, score: m72.score.toFixed(1), trend: m72.trend }
      };
    },
    corridorHeat() {
      return _RISK_CORRIDOR.map(function (corr) {
        var evs = [];
        corr.countries.forEach(function (c) { evs = evs.concat(_countryEvents(c).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(72); })); });
        var red = evs.filter(function (a) { return a.level === 'red'; }).length;
        var orange = evs.filter(function (a) { return a.level === 'orange'; }).length;
        var cn = evs.filter(function (a) { return _hasChina(a.title); }).length;
        var score = red * 5 + orange * 2 + cn * 2;
        var level = score >= 10 ? 'red' : score >= 5 ? 'orange' : score >= 2 ? 'yellow' : 'blue';
        if (level === 'red' && red === 0 && !evs.some(function (a) { return _isSevere(a.title); })) level = 'orange';
        return { name: corr.name, countries: corr.countries, events: evs.length, red: red, orange: orange, cn: cn, score: score, level: level };
      }).sort(function (a, b) { return b.score - a.score; });
    },
    assetExposure() {
      var assets = _assetList();
      var out = [];
      assets.forEach(function (asset) {
        var country = _countryByName(asset.country);
        var events = _countryEvents(asset.country).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(72); });
        if (!events.length && (!country || country.scores === undefined)) return;
        var score = 0;
        events.forEach(function (e) { if (e.level === 'red') score += 5; else if (e.level === 'orange') score += 2.5; else if (e.level === 'yellow') score += 1; if (_hasChina(e.title)) score += 2; });
        if (country && country.scores) { var ms = Math.max.apply(null, Object.values(country.scores)) || 0; score += ms >= 7 ? 3 : ms >= 5 ? 1.5 : 0; }
        var level = 'blue', reason = [];
        if (score >= 8) { level = 'red'; reason.push('高风险环境+涉我要素'); }
        else if (score >= 5) { level = 'orange'; reason.push('环境风险上升'); }
        else if (score >= 2) { level = 'yellow'; reason.push('存在局部风险'); }
        else return;
        if (level === 'red' && !events.some(function (e) { return e.level === 'red' || _isSevere(e.title); })) level = 'orange';
        out.push({ id: _id(), type: 'asset_exposure', level: level, title: asset.name + '：' + reason.join('，'), asset: asset.name, country: asset.country, enterprise: asset.enterprise, score: score.toFixed(1), reason: reason.join('，'), horizon: '未来 72h 资产暴露', time: _nowFmt(), _forecast: true });
      });
      return _uniq(out, function (x) { return x.asset + '|' + x.country; });
    },
    threatAssetLink() {
      var threats = _threatList();
      var assets = _assetList();
      var out = [];
      threats.forEach(function (t) {
        var activeCountries = (t.countries || t.active_regions || t.areas || []).map(function (c) { return String(c).trim(); });
        assets.forEach(function (asset) {
          if (activeCountries.indexOf(asset.country) >= 0) {
            var recentEvents = _countryEvents(asset.country).filter(function (a) { return _ts(a.time || a.publishedAt) > _hoursAgo(168) && _isSevere(a.title); }).length;
            var level = recentEvents >= 2 ? 'orange' : recentEvents >= 1 ? 'yellow' : 'blue';
            if (level === 'blue') return;
            out.push({ id: _id(), type: 'threat_asset', level: level, title: t.name + ' / ' + asset.name, threat: t.name, asset: asset.name, country: asset.country, enterprise: asset.enterprise, recentEvents: recentEvents, horizon: '未来 7 天威胁关联', time: _nowFmt(), _forecast: true });
          }
        });
      });
      return _uniq(out, function (x) { return x.threat + '|' + x.asset; });
    },
    allForecasts() {
      var list = [];
      if (typeof COUNTRIES !== 'undefined') {
        COUNTRIES.filter(function (c) { return _FOCUS_COUNTRIES.indexOf(c.name) >= 0; }).forEach(function (c) {
          var f = _FORECAST.countryForecast(c);
          if (f.level !== 'blue') list.push({ id: _stableId('cf', f.country), type: 'country_upgrade', level: f.level, title: f.country + '：' + f.horizon, country: f.country, score: f.momentum, hours: f.hours, horizon: f.horizon, windows: f.windows, factors: f.factors, time: _nowFmt(), _forecast: true });
        });
      }
      list = list.concat(_FORECAST.assetExposure());
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
    match(title) { return this.playbooks.filter(function (p) { return p.trigger.test(String(title || '')); }); }
  };

  /* ---------- 主对象 ---------- */
  window.AUTOALERT = {
    _cfgKey: 'orps_autoalert_v3_cfg',
    _logsKey: 'orps_autoalert_v3_logs',
    _cfg: null,
    _logs: [],
    _forecasts: [],
    _selectedId: null,
    _timer: null,
    _engineOn: true,
    _lastRun: null,
    _chartTrend: null,

    init() {
      this._loadCfg();
      this._loadLogs();
      this._injectCss();
      this._bindDataHub();
      this.run();
      this._startLoop();
    },

    _loadCfg() { try { this._cfg = JSON.parse(localStorage.getItem(this._cfgKey)) || null; } catch (e) { this._cfg = null; } if (!this._cfg) this._cfg = { engineOn: true, autoSoar: true, showBlue: false }; },
    _saveCfg() { try { localStorage.setItem(this._cfgKey, JSON.stringify(this._cfg)); } catch (e) {} },
    _loadLogs() { try { this._logs = JSON.parse(localStorage.getItem(this._logsKey)) || []; } catch (e) { this._logs = []; } },
    _saveLogs() { try { localStorage.setItem(this._logsKey, JSON.stringify(this._logs.slice(0, 200))); } catch (e) {} },
    _log(action, detail) { this._logs.unshift({ time: _nowFmt(), action: action, detail: detail }); this._saveLogs(); },

    _bindDataHub() {
      var self = this;
      try { if (typeof DataHub !== 'undefined' && DataHub.subscribe) { DataHub.subscribe('alerts', function () { self.run(); }); DataHub.subscribe('live', function () { self.run(); }); } } catch (e) {}
      try { if (typeof INTELBUS !== 'undefined' && INTELBUS.subscribe) { INTELBUS.subscribe(function () { self.run(); }); } } catch (e) {}
    },

    _startLoop() { var self = this; if (this._timer) clearInterval(this._timer); this._timer = setInterval(function () { self.run(); }, 60000); },

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
      var el = document.getElementById('view-autoalert');
      if (!el) return;
      el.innerHTML = '<div id="aa3-root"></div>';
      this._root = document.getElementById('aa3-root');
      this._renderHero();
      this._renderHorizon();
      this._renderMain();
      this._renderCharts();
      this._renderFooter();
    },

    _renderHero() {
      var red = this._forecasts.filter(function (x) { return x.level === 'red'; }).length;
      var orange = this._forecasts.filter(function (x) { return x.level === 'orange'; }).length;
      var yellow = this._forecasts.filter(function (x) { return x.level === 'yellow'; }).length;
      var liveRed = (typeof ALERTS !== 'undefined') ? ALERTS.filter(function (a) { return a.level === 'red'; }).length : 0;
      var html = '<div class="aa3-hero">' +
        '<div class="aa3-hero-left">' +
          '<div class="aa3-hero-title">🔮 未来安全形势预测中心</div>' +
          '<div class="aa3-hero-sub">基于真实态势推演未来 24h / 72h / 7d 风险升级路径</div>' +
          '<span class="aa3-pill ' + (this._engineOn ? 'on' : 'off') + '" onclick="AUTOALERT.toggleEngine()">' + (this._engineOn ? '● 预测引擎运行中' : '● 已暂停') + '</span>' +
          '<span class="aa3-meta">最近计算：' + (this._lastRun || '-') + '</span>' +
        '</div>' +
        '<div class="aa3-hero-stats">' +
          '<div class="aa3-stat red"><div class="aa3-stat-n">' + red + '</div><div class="aa3-stat-l">未来红区</div></div>' +
          '<div class="aa3-stat orange"><div class="aa3-stat-n">' + orange + '</div><div class="aa3-stat-l">未来橙区</div></div>' +
          '<div class="aa3-stat yellow"><div class="aa3-stat-n">' + yellow + '</div><div class="aa3-stat-l">未来黄区</div></div>' +
          '<div class="aa3-stat live"><div class="aa3-stat-n">' + liveRed + '</div><div class="aa3-stat-l">当前红区</div></div>' +
        '</div>' +
      '</div>';
      this._root.insertAdjacentHTML('beforeend', html);
    },

    _renderHorizon() {
      var buckets = { '24h': [], '72h': [], '7d': [] };
      this._forecasts.forEach(function (f) {
        if (f.type !== 'country_upgrade') return;
        var h = f.hours || '7d';
        if (buckets[h]) buckets[h].push(f);
      });
      var html = '<div class="aa3-horizon">' +
        '<div class="aa3-horizon-title">⏱️ 预测时间轴 · 风险升级分布</div>' +
        '<div class="aa3-horizon-row">';
      ['24h','72h','7d'].forEach(function (h) {
        var label = h === '24h' ? '24小时' : h === '72h' ? '72小时' : '7天';
        html += '<div class="aa3-horizon-col">' +
          '<div class="aa3-horizon-h">' + label + '</div>' +
          '<div class="aa3-horizon-items">';
        if (!buckets[h].length) {
          html += '<span class="aa3-horizon-empty">暂无显著升级预测</span>';
        } else {
          buckets[h].slice(0, 5).forEach(function (f) {
            var col = _LEVEL_COLOR[f.level];
            html += '<span class="aa3-horizon-chip" style="background:' + col.bg + ';color:' + col.text + ';border:1px solid ' + col.border + '" onclick="AUTOALERT.select(\'' + f.id + '\')">' + f.country + '</span>';
          });
        }
        html += '</div></div>';
      });
      html += '</div></div>';
      this._root.insertAdjacentHTML('beforeend', html);
    },

    _renderMain() {
      var html = '<div class="aa3-main">';
      html += '<div class="aa3-scenarios">' + this._renderScenarioList() + '</div>';
      html += '<div class="aa3-detail">' + this._renderDetail() + '</div>';
      html += '</div>';
      this._root.insertAdjacentHTML('beforeend', html);
    },

    _renderScenarioList() {
      var self = this;
      var visible = this._forecasts.filter(function (x) { return x.level !== 'blue' || self._cfg.showBlue; });
      var html = '<div class="aa3-section-title">📋 预测情景队列</div>';
      if (!visible.length) return html + '<div class="aa3-empty">当前态势平稳，未发现显著未来升级风险</div>';
      html += '<div class="aa3-list">';
      visible.forEach(function (f) {
        var col = _LEVEL_COLOR[f.level];
        var selected = self._selectedId === f.id ? ' selected' : '';
        var icon = f.type === 'asset_exposure' ? '🏢' : f.type === 'threat_asset' ? '🎯' : '📈';
        html += '<div class="aa3-row' + selected + '" onclick="AUTOALERT.select(\'' + f.id + '\')">' +
          '<div class="aa3-row-lv" style="background:' + col.bg + ';color:' + col.text + ';border:1px solid ' + col.border + '">' + col.label + '</div>' +
          '<div class="aa3-row-body">' +
            '<div class="aa3-row-title">' + icon + ' ' + (f.title || f.asset || '-') + '</div>' +
            '<div class="aa3-row-meta">' + (f.country || '全球') + ' · 动量 ' + (f.score || '-') + ' · ' + (f.horizon || '') + '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      return html;
    },

    _renderDetail() {
      var item = this._forecasts.find(function (x) { return x.id === this._selectedId; }, this);
      if (!item) {
        return '<div class="aa3-empty-card">' +
          '<div class="aa3-empty-title">🔗 联动处置</div>' +
          '<div class="aa3-empty">点击左侧预测情景查看风险推演、关联情报与处置建议</div>' +
        '</div>';
      }
      var col = _LEVEL_COLOR[item.level];
      var playbooks = _SOAR.match(item.title || item.asset || '');
      var related = (typeof ALERTS !== 'undefined') ? ALERTS.filter(function (a) {
        return (a.country || '') === (item.country || '') && _ts(a.time || a.publishedAt) > _hoursAgo(72);
      }).slice(0, 5) : [];
      var html = '<div class="aa3-detail-card">' +
        '<div class="aa3-detail-header" style="border-left:4px solid ' + col.border + '">' +
          '<span class="aa3-detail-lv" style="background:' + col.bg + ';color:' + col.text + '">' + col.label + '</span>' +
          '<span class="aa3-detail-title">' + (item.title || item.asset || '-') + '</span>' +
        '</div>' +
        '<div class="aa3-detail-grid">' +
          '<div class="aa3-detail-box">' +
            '<div class="aa3-detail-label">预测时间窗口</div>' +
            '<div class="aa3-detail-text">' + (item.horizon || '-') + '</div>' +
          '</div>' +
          '<div class="aa3-detail-box">' +
            '<div class="aa3-detail-label">风险动量</div>' +
            '<div class="aa3-detail-text" style="color:' + col.text + ';font-weight:800">' + (item.score || '-') + '</div>' +
          '</div>' +
          '<div class="aa3-detail-box">' +
            '<div class="aa3-detail-label">推演依据</div>' +
            '<div class="aa3-detail-text">' + (item.reason || (item.type === 'country_upgrade' && item.factors ? ('近72h红区' + item.factors.red + '、橙区' + item.factors.orange + '、涉华' + item.factors.cn) : '近期态势与风险动量')) + '</div>' +
          '</div>' +
        '</div>';
      if (item.factors) {
        html += '<div class="aa3-detail-factors">' +
          '<span>红区 ' + item.factors.red + '</span>' +
          '<span>橙区 ' + item.factors.orange + '</span>' +
          '<span>涉华 ' + item.factors.cn + '</span>' +
          '<span>严重 ' + item.factors.severe + '</span>' +
        '</div>';
      }
      html += '<div class="aa3-detail-section">' +
        '<div class="aa3-detail-label">关联情报（近 72h）</div>';
      if (!related.length) {
        html += '<div class="aa3-empty">无同国关联预警</div>';
      } else {
        html += '<div class="aa3-related-list">';
        related.forEach(function (r) {
          var rc = _LEVEL_COLOR[r.level || 'blue'];
          html += '<div class="aa3-related" onclick="AUTOALERT.openAlert(\'' + String(r.id || '').replace(/'/g, '') + '\')">' +
            '<span style="color:' + rc.text + '">[' + rc.label + ']</span> ' +
            '<span>' + (r.title || '').slice(0, 40) + '</span>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      html += '<div class="aa3-detail-section">' +
        '<div class="aa3-detail-label">SOAR 预案</div>';
      if (!playbooks.length) {
        html += '<div class="aa3-empty">未匹配标准预案，建议人工研判</div>';
      } else {
        playbooks.forEach(function (p) {
          html += '<div class="aa3-playbook">' +
            '<div class="aa3-playbook-name">' + p.id + ' ' + p.name + '</div>' +
            '<div class="aa3-playbook-actions">' + p.actions.map(function (a) { return '<span class="aa3-tag">' + a + '</span>'; }).join('') + '</div>' +
          '</div>';
        });
      }
      html += '</div>';
      html += '<div class="aa3-detail-actions">' +
        '<button class="btn" onclick="AUTOALERT.pushToAlertCenter(\'' + item.id + '\')">推送至预警中心</button>' +
        '<button class="btn" onclick="AUTOALERT.createAiReport(\'' + item.id + '\')">生成 AI 简报</button>' +
        '<button class="btn" onclick="AUTOALERT.openCountry(\'' + (item.country || '') + '\')">查看国家态势</button>' +
      '</div>';
      html += '</div>';
      return html;
    },

    _renderCharts() {
      var html = '<div class="aa3-charts">' +
        '<div class="aa3-chart-panel">' +
          '<div class="aa3-section-title">📊 重点国家 7 日风险推演</div>' +
          '<div class="aa3-chart-canvas"><canvas id="aa3-trend-chart"></canvas></div>' +
        '</div>' +
        '<div class="aa3-chart-panel">' +
          '<div class="aa3-section-title">🏢 重点资产暴露（未来 72h）</div>' +
          '<div class="aa3-asset-list">' + this._renderAssetList() + '</div>' +
        '</div>' +
      '</div>';
      this._root.insertAdjacentHTML('beforeend', html);
      this._drawTrendChart();
    },

    _renderAssetList() {
      var assets = _FORECAST.assetExposure().slice(0, 8);
      if (!assets.length) return '<div class="aa3-empty">重点资产暂无显著暴露</div>';
      var html = '';
      assets.forEach(function (a) {
        var col = _LEVEL_COLOR[a.level];
        html += '<div class="aa3-asset-row">' +
          '<span class="aa3-asset-lv" style="background:' + col.bg + ';color:' + col.text + '">' + col.label + '</span>' +
          '<span class="aa3-asset-name">' + a.asset + '</span>' +
          '<span class="aa3-asset-country">' + a.country + '</span>' +
          '<span class="aa3-asset-ent">' + a.enterprise + '</span>' +
        '</div>';
      });
      return html;
    },

    _drawTrendChart() {
      try {
        if (typeof Chart === 'undefined') return;
        var canvas = document.getElementById('aa3-trend-chart');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (this._chartTrend) { this._chartTrend.destroy(); this._chartTrend = null; }
        var focus = this._forecasts.filter(function (x) { return x.type === 'country_upgrade' && x.level !== 'blue'; }).slice(0, 5);
        if (!focus.length) { canvas.parentNode.innerHTML = '<div class="aa3-empty">暂无足够数据绘制趋势</div>'; return; }
        var datasets = focus.map(function (f) {
          var col = _LEVEL_COLOR[f.level];
          return {
            label: f.country,
            data: [parseFloat(f.windows['24h'].momentum), parseFloat(f.windows['72h'].momentum), parseFloat(f.windows['7d'].momentum)],
            borderColor: col.border,
            backgroundColor: col.bg,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            fill: false
          };
        });
        this._chartTrend = new Chart(ctx, {
          type: 'line',
          data: { labels: ['24h', '72h', '7d'], datasets: datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 11 } } } },
            scales: {
              y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#7a8ba3' } },
              x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#7a8ba3' } }
            }
          }
        });
      } catch (e) { console.warn('[AUTOALERT v3] trend chart error', e); }
    },

    _renderFooter() {
      var html = '<div class="aa3-footer">' +
        '<div class="aa3-logs">' +
          '<div class="aa3-section-title">📝 运行日志</div>' +
          (this._logs.slice(0, 5).map(function (l) {
            return '<div class="aa3-log">[' + l.time + '] ' + l.action + (l.detail ? ' · ' + l.detail : '') + '</div>';
          }).join('') || '<div class="aa3-empty">暂无操作日志</div>') +
        '</div>' +
      '</div>';
      this._root.insertAdjacentHTML('beforeend', html);
    },

    /* ---------- 交互 ---------- */
    toggleEngine() {
      this._engineOn = !this._engineOn;
      this._cfg.engineOn = this._engineOn;
      this._saveCfg();
      this._log(this._engineOn ? '启动预测引擎' : '暂停预测引擎');
      this.render();
    },
    select(id) {
      this._selectedId = id;
      this._renderMain();
      this._drawTrendChart();
    },
    openCountry(name) {
      try { if (typeof navigateTo === 'function') navigateTo('monitor'); if (typeof MONITOR !== 'undefined' && MONITOR.focusCountry) MONITOR.focusCountry(name); } catch (e) {}
    },
    openAlert(id) { try { if (typeof showAlertDetail === 'function' && id) showAlertDetail(id); } catch (e) {} },
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
        if (typeof showToast === 'function') showToast('已推送至预警中心');
      } catch (e) {}
    },
    createAiReport(id) {
      var item = this._forecasts.find(function (x) { return x.id === id; });
      if (!item) return;
      try { if (typeof navigateTo === 'function') navigateTo('aireport'); this._log('生成 AI 简报', item.title || item.asset); } catch (e) {}
    },

    /* ---------- 样式 ---------- */
    _injectCss() {
      if (document.getElementById('aa3-css')) return;
      var s = document.createElement('style');
      s.id = 'aa3-css';
      s.textContent = '' +
        ':root{--aa3-bg:#070b14;--aa3-panel:rgba(16,22,38,0.9);--aa3-panel2:rgba(22,30,50,0.7);--aa3-border:rgba(0,212,255,0.12);--aa3-text:#e2e8f0;--aa3-text2:#7a8ba3;--aa3-text3:#4a5a70;--aa3-cyan:#00d4ff;}' +
        '#view-autoalert{background:var(--aa3-bg);color:var(--aa3-text);height:calc(100vh - 48px);overflow:auto;padding:14px;box-sizing:border-box;}' +
        '#view-autoalert .aa3-hero{display:flex;justify-content:space-between;align-items:center;background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:14px 18px;margin-bottom:14px;}' +
        '#view-autoalert .aa3-hero-title{font-size:18px;font-weight:800;letter-spacing:1px;}' +
        '#view-autoalert .aa3-hero-sub{font-size:11px;color:var(--aa3-text2);margin:4px 0 8px;}' +
        '#view-autoalert .aa3-pill{font-size:11px;padding:3px 10px;border-radius:12px;cursor:pointer;font-weight:700;margin-right:10px;}' +
        '#view-autoalert .aa3-pill.on{background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid #22c55e;}' +
        '#view-autoalert .aa3-pill.off{background:rgba(148,163,184,0.15);color:#94a3b8;border:1px solid #64748b;}' +
        '#view-autoalert .aa3-meta{font-size:11px;color:var(--aa3-text3);}' +
        '#view-autoalert .aa3-hero-stats{display:flex;gap:14px;}' +
        '#view-autoalert .aa3-stat{min-width:72px;text-align:center;padding:10px 12px;background:var(--aa3-panel2);border-radius:8px;border:1px solid var(--aa3-border);}' +
        '#view-autoalert .aa3-stat-n{font-size:22px;font-weight:800;line-height:1;}' +
        '#view-autoalert .aa3-stat-l{font-size:10px;color:var(--aa3-text2);margin-top:4px;}' +
        '#view-autoalert .aa3-stat.red .aa3-stat-n{color:#ef4444;}' +
        '#view-autoalert .aa3-stat.orange .aa3-stat-n{color:#f97316;}' +
        '#view-autoalert .aa3-stat.yellow .aa3-stat-n{color:#eab308;}' +
        '#view-autoalert .aa3-stat.live .aa3-stat-n{color:#0ea5e9;}' +
        '#view-autoalert .aa3-horizon{background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:14px 18px;margin-bottom:14px;}' +
        '#view-autoalert .aa3-horizon-title{font-size:13px;font-weight:700;margin-bottom:10px;}' +
        '#view-autoalert .aa3-horizon-row{display:flex;gap:14px;}' +
        '#view-autoalert .aa3-horizon-col{flex:1;background:var(--aa3-panel2);border-radius:8px;padding:10px;}' +
        '#view-autoalert .aa3-horizon-h{font-size:11px;color:var(--aa3-text2);margin-bottom:8px;font-weight:700;}' +
        '#view-autoalert .aa3-horizon-items{display:flex;flex-wrap:wrap;gap:6px;}' +
        '#view-autoalert .aa3-horizon-chip{font-size:11px;padding:3px 8px;border-radius:12px;cursor:pointer;}' +
        '#view-autoalert .aa3-horizon-empty{font-size:11px;color:var(--aa3-text3);}' +
        '#view-autoalert .aa3-main{display:flex;gap:14px;margin-bottom:14px;}' +
        '#view-autoalert .aa3-scenarios{width:360px;background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:12px;max-height:520px;overflow:auto;}' +
        '#view-autoalert .aa3-detail{flex:1;background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:12px;max-height:520px;overflow:auto;}' +
        '#view-autoalert .aa3-section-title{font-size:12px;font-weight:700;color:var(--aa3-text);margin-bottom:10px;}' +
        '#view-autoalert .aa3-list{display:flex;flex-direction:column;gap:6px;}' +
        '#view-autoalert .aa3-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--aa3-panel2);border-radius:6px;cursor:pointer;transition:background .15s;}' +
        '#view-autoalert .aa3-row:hover{background:rgba(0,212,255,0.08);}' +
        '#view-autoalert .aa3-row.selected{background:rgba(0,212,255,0.14);}' +
        '#view-autoalert .aa3-row-lv{font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;white-space:nowrap;}' +
        '#view-autoalert .aa3-row-body{flex:1;min-width:0;}' +
        '#view-autoalert .aa3-row-title{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '#view-autoalert .aa3-row-meta{font-size:9px;color:var(--aa3-text2);}' +
        '#view-autoalert .aa3-empty{padding:20px;text-align:center;font-size:12px;color:var(--aa3-text3);}' +
        '#view-autoalert .aa3-empty-card{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;}' +
        '#view-autoalert .aa3-empty-title{font-size:14px;font-weight:700;margin-bottom:8px;}' +
        '#view-autoalert .aa3-detail-card{height:100%;}' +
        '#view-autoalert .aa3-detail-header{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--aa3-border);margin-bottom:12px;}' +
        '#view-autoalert .aa3-detail-lv{font-size:11px;font-weight:800;padding:2px 8px;border-radius:4px;}' +
        '#view-autoalert .aa3-detail-title{font-size:14px;font-weight:700;}' +
        '#view-autoalert .aa3-detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}' +
        '#view-autoalert .aa3-detail-box{background:var(--aa3-panel2);border-radius:6px;padding:8px 10px;}' +
        '#view-autoalert .aa3-detail-label{font-size:10px;color:var(--aa3-text3);margin-bottom:4px;}' +
        '#view-autoalert .aa3-detail-text{font-size:12px;color:var(--aa3-text);}' +
        '#view-autoalert .aa3-detail-factors{display:flex;gap:10px;font-size:10px;color:var(--aa3-text2);margin-bottom:12px;padding:6px 10px;background:var(--aa3-panel2);border-radius:6px;}' +
        '#view-autoalert .aa3-detail-section{margin-bottom:12px;}' +
        '#view-autoalert .aa3-related-list{display:flex;flex-direction:column;gap:5px;}' +
        '#view-autoalert .aa3-related{padding:5px 8px;background:var(--aa3-panel2);border-radius:5px;font-size:11px;cursor:pointer;}' +
        '#view-autoalert .aa3-related:hover{background:rgba(0,212,255,0.08);}' +
        '#view-autoalert .aa3-playbook{background:var(--aa3-panel2);border-radius:6px;padding:8px;margin-bottom:6px;}' +
        '#view-autoalert .aa3-playbook-name{font-size:11px;font-weight:700;}' +
        '#view-autoalert .aa3-playbook-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}' +
        '#view-autoalert .aa3-tag{font-size:9px;padding:2px 5px;background:var(--aa3-panel);color:var(--aa3-text2);border-radius:4px;border:1px solid var(--aa3-border);}' +
        '#view-autoalert .aa3-detail-actions{display:flex;gap:8px;margin-top:12px;}' +
        '#view-autoalert .aa3-detail-actions .btn{font-size:11px;padding:5px 10px;}' +
        '#view-autoalert .aa3-charts{display:flex;gap:14px;margin-bottom:14px;}' +
        '#view-autoalert .aa3-chart-panel{flex:1;background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:12px;min-height:260px;}' +
        '#view-autoalert .aa3-chart-canvas{height:220px;}' +
        '#view-autoalert .aa3-asset-list{display:flex;flex-direction:column;gap:5px;}' +
        '#view-autoalert .aa3-asset-row{display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--aa3-panel2);border-radius:5px;font-size:11px;}' +
        '#view-autoalert .aa3-asset-lv{font-size:9px;padding:1px 5px;border-radius:4px;}' +
        '#view-autoalert .aa3-asset-name{flex:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '#view-autoalert .aa3-asset-country{color:var(--aa3-text2);}' +
        '#view-autoalert .aa3-asset-ent{font-size:9px;color:var(--aa3-text3);}' +
        '#view-autoalert .aa3-footer{background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:12px;}' +
        '#view-autoalert .aa3-logs{font-size:10px;color:var(--aa3-text2);}' +
        '#view-autoalert .aa3-log{padding:2px 0;border-bottom:1px dashed var(--aa3-border);}' +
        '@media(max-width:1100px){#view-autoalert .aa3-hero{flex-direction:column;align-items:flex-start;}#view-autoalert .aa3-main{flex-direction:column;}#view-autoalert .aa3-scenarios{width:auto;}#view-autoalert .aa3-charts{flex-direction:column;}}';
      document.head.appendChild(s);
    }
  };
})();
