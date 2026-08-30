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

  /* ---------- 推理链引擎（2026-08-30 重构：智能联动 = 推理，不是数字面板）----------
   * 设计立场（用户指令）：不靠冷冰冰的动量数字，用户也看不懂。每个情景必须回答领导四问：
   *   发生了什么（事实）→ 与我们何干（我方利益关联）→ 接下来会怎样（推理）→ 现在该怎么办（行动）。
   * 每一环都从真实采集数据（ALERTS 预警 / ENTERPRISES·ASSETS 我方利益 / THREATS 威胁组织 /
   * 风险走廊）推理得出，证据链可点击回溯到原始预警与国家档案。 */
  var _REASON = {
    _esc: function (s) { return String(s || '').replace(/'/g, '').replace(/\\/g, '').replace(/"/g, ''); },
    _cnAssetsIn(country) { return _assetList().filter(function (a) { return a.country === country; }); },
    _corridorOf(country) {
      var hit = _RISK_CORRIDOR.filter(function (r) { return r.countries.indexOf(country) >= 0; });
      return hit.length ? hit[0] : null;
    },
    _corridorAssetCount(corridor) {
      var n = 0;
      try { corridor.countries.forEach(function (c) { n += _REASON._cnAssetsIn(c).length; }); } catch (e) {}
      return n;
    },
    _threatsIn(country) {
      return _threatList().filter(function (t) {
        return (t.countries || t.active_regions || t.areas || []).map(String).indexOf(country) >= 0;
      }).slice(0, 3);
    },
    build(item) {
      var country = item.country || '';
      var rel = [];
      try {
        if (typeof ALERTS !== 'undefined') rel = ALERTS.filter(function (a) {
          return (a.country || '') === country && _ts(a.time || a.publishedAt) > _hoursAgo(72);
        });
      } catch (e) {}
      rel.sort(function (a, b) { return (_LEVEL_ORDER[b.level] || 0) - (_LEVEL_ORDER[a.level] || 0); });
      var redN = rel.filter(function (a) { return a.level === 'red'; }).length;
      var ornN = rel.filter(function (a) { return a.level === 'orange'; }).length;
      var cnN = rel.filter(function (a) { return _hasChina(a.title); }).length;
      var allTxt = rel.map(function (a) { return a.title || ''; }).join(' ');
      var assets = this._cnAssetsIn(country);
      var corridor = this._corridorOf(country);
      var threats = this._threatsIn(country);

      /* ① 事实：只陈述库内真实条目 */
      var top1 = rel[0];
      var fact;
      if (rel.length) {
        fact = '近72小时该方向采集入库 ' + rel.length + ' 条预警（红 ' + redN + ' / 橙 ' + ornN + (cnN ? ' / 涉华 ' + cnN : '') + '）。' +
          '最高等级信号：「' + String(top1.title || '').slice(0, 60) + '」' + (top1.time ? '（' + top1.time + '）' : '') + '。';
      } else {
        fact = '该国近72小时无在库预警，本情景由我方资产暴露 / 威胁关联模型推演产生，属前瞻性预警。';
      }

      /* ② 关联：我方利益落位 */
      var linkParts = [];
      if (assets.length) {
        var names = assets.slice(0, 3).map(function (a) { return a.name; }).join('、');
        var ents = _uniq(assets.map(function (a) { return a.enterprise; })).filter(Boolean).slice(0, 2).join('、');
        linkParts.push('我在该国有 ' + assets.length + ' 项登记利益：' + names + (assets.length > 3 ? ' 等' : '') + (ents ? '（' + ents + '）' : ''));
      } else if (corridor) {
        linkParts.push('该国虽无登记的我方项目，但位于「' + corridor.name + '」，走廊沿线共关联我方利益 ' + this._corridorAssetCount(corridor) + ' 项，通道安全与我直接相关');
      } else {
        linkParts.push('该国暂无登记的我方资产，属区域风险外溢监控对象');
      }
      if (threats.length) linkParts.push('威胁组织「' + threats.map(function (t) { return t.name; }).join('」「') + '」在该国及周边活动');
      var link = linkParts.join('；') + '。';

      /* ③ 推理：事件手法 × 我方暴露 → 后果（规则库，人话输出） */
      var infer = [];
      if (/绑架|劫持|人质|被武装人员带走|被带走|掳走|劫走|abduct|hostage/i.test(allTxt)) infer.push('已出现针对人员的绑架/劫持手法——外派与出差人员正是该类事件的首要目标画像，人员环节暴露度最高');
      if (/爆炸|恐袭|自杀式|袭击|枪击|bomb|militant|gunmen/i.test(allTxt)) infer.push('武装暴力事件密度上行——项目驻地周边、通勤路线与物流环节被波及的概率随之抬升');
      if (/制裁|禁运|实体清单|出口管制|SDN|sanction/i.test(allTxt)) infer.push('制裁工具已实际落地——涉该国的结算、航运与供应链合同面临合规与断链双重风险');
      if (/抗议|骚乱|罢工|戒严|政变|curfew|protest|riot/i.test(allTxt)) infer.push('社会秩序承压——当地治安资源被牵制，项目安保响应与紧急撤离的可用窗口收窄');
      if (/战争|入侵|交火|空袭|炮击|导弹|invasion|airstrike|shelling/i.test(allTxt)) infer.push('军事冲突呈外溢态势——保险战争免责条款、人员撤离与资产保全须提前布局');
      if (assets.length && /绑架|武装|袭击|militant|insurgent/i.test(allTxt)) infer.push('该国既有武装活动、又有我方实体存在，两要素叠加使风险从我方"相关方"升为"当事方"');
      if (cnN) infer.push('预警中已含涉我直接指向信号——按涉我事件标准上报，并加强护企联络');
      if (!infer.length) {
        if (item.factors && (item.factors.severe >= 2 || redN >= 2)) infer.push('高危事件在72小时内反复出现——按事件簇升级规律，同国同类事件短期复发概率显著高于常态');
        else if (corridor) infer.push('该方向风险沿走廊传导——通道上任何节点恶化，都会抬高我方物流与人员通行的综合成本');
        else infer.push('现有信号以区域风险为主，尚未直接命中我方利益，维持加密监控并预设响应门槛');
      }
      var lvTxt = item.level === 'red' ? '升级/波及风险为【高】，属须立即处置级'
        : item.level === 'orange' ? '升级/波及风险为【偏高】，须指派专人在24h内跟进核实'
        : '升级/波及风险为【关注】，纳入例行滚动监控';
      var horizonLine = '综合' + (item.factors ? '（近72h红' + item.factors.red + '/橙' + item.factors.orange + '/严重' + item.factors.severe + (item.factors.cn ? '/涉华' + item.factors.cn : '') + '）' : '') +
        '，判定未来 ' + (item.hours || '72h') + ' ' + lvTxt + '。';

      /* ④ 行动：具体到资产名/预案号，可执行 */
      var acts = [];
      var pb = _SOAR.match(item.title || item.asset || '')[0];
      if (item.type === 'asset_exposure') {
        acts.push('通知 ' + (item.enterprise || '所属企业') + ' 安保负责人，核查「' + (item.asset || '') + '」现场人员与设备清单');
        acts.push('对该资产执行 48h 加强版报送（每12小时一次位置与人员动态）');
        if (pb) acts.push('启动 ' + pb.id + '《' + pb.name + '》');
      } else if (item.type === 'threat_asset') {
        acts.push('比对「' + (item.threat || '') + '」活动区与「' + (item.asset || '') + '」驻地的地理距离，划定避让半径');
        acts.push('向项目下发该组织的识别特征卡与可疑行为报告流程');
      } else {
        if (assets.length) acts.push('核查该国我方 ' + assets.length + ' 项利益的人员在岗与行程报备情况');
        acts.push('核发该国安全提示：非必要不外出，避开人群聚集与政府设施周边');
        if (pb) acts.push('启动 ' + pb.id + '《' + pb.name + '》：' + pb.actions.slice(0, 2).join('、'));
        else acts.push('按 P-00《国别风险通用响应》建立每日报送与联络机制');
      }
      if (item.level === 'red') acts.unshift('【红色级】30分钟内完成值班负责人通报与处置分工');

      /* 列表行一句话（替代"动量 8.5"这种看不懂的数字） */
      var why = '';
      if (item.type === 'country_upgrade' && item.factors) {
        why = '近72h 红' + item.factors.red + '·橙' + item.factors.orange +
          (item.factors.severe ? '·严重' + item.factors.severe : '') +
          (item.factors.cn ? '·涉华' + item.factors.cn : '') +
          (assets.length ? '·我方利益' + assets.length + '项' : '');
      } else if (item.type === 'asset_exposure') {
        why = '我方资产暴露' + (rel.length ? '·近72h同国预警' + rel.length + '条' : '·前瞻推演');
      } else if (item.type === 'threat_asset') {
        why = '威胁组织与我方资产地理重叠' + (rel.length ? '·近72h同国预警' + rel.length + '条' : '');
      }

      return { rel: rel, redN: redN, ornN: ornN, cnN: cnN, fact: fact, link: link, infer: infer, horizonLine: horizonLine, acts: acts, why: why, assets: assets, threats: threats, corridor: corridor, pb: pb };
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
    /* P-00 通用国别风险响应：不参与关键词 match，仅在国别升级情景匹配不到
     * 具体预案时兜底展示（2026-08-30：红色/橙色国家升级情景此前显示"未匹配预案"
     * 等于让领导看空面板）。 */
    generic: { id: 'P-00', name: '国别风险通用响应', actions: ['评估当地我方人员与资产分布', '核发安全提示与出行管制建议', '建立每日报送与联络机制', '研判提升安保等级的触发条件'] },
    match(title) { return this.playbooks.filter(function (p) { return p.trigger.test(String(title || '')); }); }
  };

  /* ---------- 主对象 ---------- */
  window.AUTOALERT = {
    _cfgKey: 'orps_autoalert_v3_cfg',
    _logsKey: 'orps_autoalert_v3_logs',
    _actionsKey: 'orps_autoalert_v3_actions',   /* 情景处置状态：id -> {status:'ack'|'assign'|'dismiss', time} */
    _pbKey: 'orps_autoalert_v3_pb',             /* SOAR 预案 checklist：pbId -> [已勾选步骤下标] */
    _pushedKey: 'orps_autoalert_v3_pushed',     /* 已推送预警中心的情景 id 集合（防重复推送） */
    _cfg: null,
    _logs: [],
    _forecasts: [],
    _selectedId: null,
    _actions: {},
    _pbCheck: {},
    _pushed: {},
    _filter: { lv: 'all', type: 'all' },
    _timer: null,
    _engineOn: true,
    _lastRun: null,
    _chartTrend: null,

    init() {
      this._loadCfg();
      this._loadLogs();
      this._loadActions();
      this._injectCss();
      this._bindDataHub();
      this.run();
      this._startLoop();
    },

    _loadActions() {
      try { this._actions = JSON.parse(localStorage.getItem(this._actionsKey)) || {}; } catch (e) { this._actions = {}; }
      try { this._pbCheck = JSON.parse(localStorage.getItem(this._pbKey)) || {}; } catch (e) { this._pbCheck = {}; }
      try { this._pushed = JSON.parse(localStorage.getItem(this._pushedKey)) || {}; } catch (e) { this._pushed = {}; }
    },
    _saveActions() {
      try { localStorage.setItem(this._actionsKey, JSON.stringify(this._actions)); } catch (e) {}
      try { localStorage.setItem(this._pbKey, JSON.stringify(this._pbCheck)); } catch (e) {}
      try { localStorage.setItem(this._pushedKey, JSON.stringify(this._pushed)); } catch (e) {}
    },

    _loadCfg() { try { this._cfg = JSON.parse(localStorage.getItem(this._cfgKey)) || null; } catch (e) { this._cfg = null; } if (!this._cfg) this._cfg = { engineOn: true, autoSoar: true, showBlue: false }; },
    _saveCfg() { try { localStorage.setItem(this._cfgKey, JSON.stringify(this._cfg)); } catch (e) {} },
    _loadLogs() { try { this._logs = JSON.parse(localStorage.getItem(this._logsKey)) || []; } catch (e) { this._logs = []; } },
    _saveLogs() { try { localStorage.setItem(this._logsKey, JSON.stringify(this._logs.slice(0, 200))); } catch (e) {} },
    _log(action, detail) { this._logs.unshift({ time: _nowFmt(), action: action, detail: detail }); this._saveLogs(); },

    _bindDataHub() {
      /* 2026-08-30 防重挂：runViewInit 每次切到本页签都会调 AUTOALERT.init()，
       * 原实现重复订阅 DataHub/INTELBUS——切 N 次页签后一条数据触发 N 次全量重绘，
       * 叠加 60s 定时器后视图 DOM 每隔几秒被 innerHTML 全量销毁重建，
       * 用户点击落点的元素在按下瞬间被销毁 → "点不了点不开"的真凶。 */
      if (this._dhBound) return;
      this._dhBound = true;
      var self = this;
      try { if (typeof DataHub !== 'undefined' && DataHub.subscribe) { DataHub.subscribe('alerts', function () { self.run(); }); DataHub.subscribe('live', function () { self.run(); }); } } catch (e) {}
      try { if (typeof INTELBUS !== 'undefined' && INTELBUS.subscribe) { INTELBUS.subscribe(function () { self.run(); }); } } catch (e) {}
    },

    _startLoop() { var self = this; if (this._timer) clearInterval(this._timer); this._timer = setInterval(function () { self.run(); }, 60000); },

    run(force) {
      this._lastRun = _nowFmt();
      this._forecasts = _FORECAST.allForecasts();
      this._updateBadge();
      /* 渲染节流（2026-08-30 根治交互被吞）：
       * 1) 数据签名未变 → 绝不动 DOM；
       * 2) 模态框打开中（用户正在读预案/AI简报/勾选步骤）→ 推迟到下一轮再绘；
       * 3) 重绘保留滚动位置。 */
      var sig = this._forecasts.map(function (x) { return x.id + ':' + x.level + ':' + x.score; }).join('|');
      var modalOpen = false;
      try { var m = document.getElementById('modal'); modalOpen = !!(m && m.classList.contains('show')); } catch (e) {}
      if (!force && sig === this._lastSig) return;
      if (!force && modalOpen) { this._pendingRender = true; return; }
      /* 首次/数据变化后默认选中首个红或橙情景——消灭"面板没有内容"空态 */
      var self = this;
      if (!this._selectedId || !this._forecasts.some(function (x) { return x.id === self._selectedId; })) {
        var top = this._forecasts.filter(function (x) { return x.level === 'red'; })[0] ||
                  this._forecasts.filter(function (x) { return x.level === 'orange'; })[0] ||
                  this._forecasts[0];
        this._selectedId = top ? top.id : null;
      }
      this._lastSig = sig;
      this._pendingRender = false;
      var el = document.getElementById('view-autoalert');
      var keepTop = el ? el.scrollTop : 0;
      var oldList = el ? el.querySelector('.aa3-scenarios') : null;
      var keepListTop = oldList ? oldList.scrollTop : 0;
      this.render();
      if (el) el.scrollTop = keepTop;
      var newList = el ? el.querySelector('.aa3-scenarios') : null;
      if (newList) newList.scrollTop = keepListTop;
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
      this._renderConclusion();
      this._renderHorizon();
      this._renderMain();
      this._renderCharts();
      this._renderFooter();
    },

    /* ---------- 本期研判结论：一句话结论 + 风险分级 + 行动建议（2026-08-30 实战化改造） ---------- */
    buildConclusion() {
      var F = this._forecasts;
      var red = F.filter(function (x) { return x.level === 'red'; });
      var orange = F.filter(function (x) { return x.level === 'orange'; });
      var yellow = F.filter(function (x) { return x.level === 'yellow'; });
      var cn = F.filter(function (x) { return _hasChina(x.title || '') || _hasChina(x.asset || ''); });
      var h24 = F.filter(function (x) { return x.hours === '24h' && x.level !== 'blue'; });
      var live = (typeof ALERTS !== 'undefined') ? ALERTS.length : 0;
      var level, levelTxt;
      if (red.length >= 1) { level = 'red'; levelTxt = '红色 · 高危'; }
      else if (orange.length >= 3 || (orange.length >= 1 && cn.length >= 1)) { level = 'orange'; levelTxt = '橙色 · 偏高'; }
      else if (orange.length + yellow.length >= 2) { level = 'yellow'; levelTxt = '黄色 · 关注'; }
      else { level = 'blue'; levelTxt = '蓝色 · 平稳'; }
      /* 一句话结论：只陈述真实计算出的信号，不虚构 */
      var parts = [];
      if (red.length) parts.push(red.length + ' 项红色情景' + (red[0] ? '（' + (red[0].country || '') + (red[0].horizon ? ' · ' + red[0].horizon : '') + '）' : ''));
      if (orange.length) parts.push(orange.length + ' 项橙色');
      if (h24.length) parts.push(h24.length + ' 项预计 24h 内显现');
      if (cn.length) parts.push(cn.length + ' 项涉我利益');
      var sentence = '未来 7 日风险总体' +
        (level === 'red' ? '处于高位，须立即处置' : level === 'orange' ? '偏高，须优先防范' : level === 'yellow' ? '值得关注，保持监控' : '平稳，未见显著升级信号') +
        (parts.length ? '：' + parts.join('、') : '') + '。';
      /* 行动建议：红色 + 涉我橙色情景逐项绑定（可点击定位） */
      var acts = [];
      F.slice(0, 10).forEach(function (f) {
        if (acts.length >= 4) return;
        var isCn = _hasChina(f.title || '') || _hasChina(f.asset || '');
        if (f.level !== 'red' && !(f.level === 'orange' && isCn)) return;
        var pb = _SOAR.match(f.title || f.asset || '')[0];
        var base;
        if (f.type === 'asset_exposure') base = '核查 ' + (f.asset || '') + '（' + (f.country || '') + '）资产与人员安全';
        else if (f.type === 'threat_asset') base = '评估 ' + (f.threat || '') + ' 对 ' + (f.asset || '') + ' 的威胁联动，加强项目防护';
        else base = '对 ' + f.country + (pb ? ' 启动 ' + pb.id + '《' + pb.name + '》' : ' 提升安保等级、限制非必要出行');
        if (pb) base += '：' + pb.actions.slice(0, 2).join('、');
        acts.push({ id: f.id, lv: f.level, txt: base });
      });
      if (!acts.length) {
        if (orange.length) { var o = orange[0]; acts.push({ id: o.id, lv: 'orange', txt: '关注 ' + (o.country || o.asset || '') + ' 橙色信号演变，预置处置预案' }); }
        else acts.push({ id: null, lv: 'yellow', txt: '维持全域例行监控，按 60s 周期跟踪预测引擎滚动更新' });
      }
      return { level: level, levelTxt: levelTxt, sentence: sentence, acts: acts, cnN: cn.length, redN: red.length, orangeN: orange.length, live: live };
    },

    _renderConclusion() {
      var c = this.buildConclusion();
      var col = _LEVEL_COLOR[c.level];
      var html = '<div class="aa3-conclusion" style="border-left:4px solid ' + col.border + '">' +
        '<div class="aa3-concl-left">' +
          '<div class="aa3-concl-lv" style="background:' + col.bg + ';border:1px solid ' + col.border + ';color:' + col.text + '">' + c.levelTxt + '</div>' +
          '<div class="aa3-concl-basis">基于近72h ' + c.live + ' 条真实预警推演 · ' + (this._lastRun || '-') + ' 更新</div>' +
        '</div>' +
        '<div class="aa3-concl-mid">' +
          '<div class="aa3-concl-tt">本期研判结论</div>' +
          '<div class="aa3-concl-sentence">' + c.sentence + '</div>' +
        '</div>' +
        '<div class="aa3-concl-right">' +
          '<div class="aa3-concl-tt">行动建议（点击定位）</div>' +
          c.acts.map(function (a, i) {
            var ac = _LEVEL_COLOR[a.lv];
            return '<div class="aa3-concl-act" onclick="AUTOALERT.jumpTo(\'' + (a.id || '') + '\')">' +
              '<span class="aa3-concl-act-n" style="background:' + ac.bg + ';color:' + ac.text + '">' + (i + 1) + '</span>' +
              '<span>' + a.txt + '</span></div>';
          }).join('') +
        '</div>' +
      '</div>';
      this._root.insertAdjacentHTML('beforeend', html);
    },

    jumpTo(id) {
      if (!id || !this._forecasts.some(function (x) { return x.id === id; })) { showToast('该建议为通用措施，无对应情景'); return; }
      this._selectedId = id;
      this._renderMain();
      this._drawTrendChart();
      var el = document.getElementById('aa3-root');
      if (el && el.scrollIntoView) try { document.getElementById('view-autoalert').scrollTop = 0; } catch (e) {}
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
      /* 2026-08-30 root fix：原实现 insertAdjacentHTML 只追加不清旧——每次 select/筛选/处置
       * 都会再堆一个 .aa3-main 面板（用户实测"点了没反应/乱"的元凶）。先移除旧面板再插入。 */
      var old = this._root.querySelectorAll('.aa3-main');
      for (var i = 0; i < old.length; i++) { old[i].remove(); }
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
      /* 筛选 chips：等级 + 类型（2026-08-30 交互性改造） */
      var lvCnt = { red: 0, orange: 0, yellow: 0, all: visible.length };
      var typeCnt = { country_upgrade: 0, asset_exposure: 0, threat_asset: 0, all: visible.length };
      visible.forEach(function (f) {
        if (lvCnt[f.level] !== undefined) lvCnt[f.level]++;
        if (typeCnt[f.type] !== undefined) typeCnt[f.type]++;
      });
      var typeLabel = { country_upgrade: '国家升级', asset_exposure: '资产暴露', threat_asset: '威胁关联' };
      html += '<div class="aa3-filters">' +
        '<div class="aa3-filter-row">';
      [['red', '红区 ' + lvCnt.red], ['orange', '橙区 ' + lvCnt.orange], ['yellow', '黄区 ' + lvCnt.yellow], ['all', '全部 ' + lvCnt.all]].forEach(function (p) {
        var k = p[0], lb = p[1];
        var on = self._filter.lv === k;
        var fc = _LEVEL_COLOR[k] || _LEVEL_COLOR.blue;
        html += '<span class="aa3-chip' + (on ? ' on' : '') + '" style="' + (on ? 'background:' + fc.bg + ';color:' + fc.text + ';border-color:' + fc.border : '') + '" onclick="AUTOALERT.setFilter(\'lv\',\'' + k + '\')">' + lb + '</span>';
      });
      html += '</div><div class="aa3-filter-row">';
      [['country_upgrade', '国家升级 ' + typeCnt.country_upgrade], ['asset_exposure', '资产暴露 ' + typeCnt.asset_exposure], ['threat_asset', '威胁关联 ' + typeCnt.threat_asset], ['all', '全部类型 ' + typeCnt.all]].forEach(function (p) {
        var k = p[0], lb = p[1];
        var on = self._filter.type === k;
        html += '<span class="aa3-chip' + (on ? ' on' : '') + '" onclick="AUTOALERT.setFilter(\'type\',\'' + k + '\')">' + lb + '</span>';
      });
      html += '</div></div>';
      var shown = visible.filter(function (f) {
        return (self._filter.lv === 'all' || f.level === self._filter.lv) &&
               (self._filter.type === 'all' || f.type === self._filter.type);
      });
      if (!shown.length) return html + '<div class="aa3-empty">该筛选条件下无情景</div>';
      html += '<div class="aa3-list">';
      shown.forEach(function (f) {
        var col = _LEVEL_COLOR[f.level];
        var selected = self._selectedId === f.id ? ' selected' : '';
        var icon = f.type === 'asset_exposure' ? '🏢' : f.type === 'threat_asset' ? '🎯' : '📈';
        var act = self._actions[f.id];
        var actBadge = act
          ? '<span class="aa3-act-badge st-' + act.status + '">' + (act.status === 'ack' ? '已阅' : act.status === 'assign' ? '已交办' : '已忽略') + '</span>'
          : (self._pushed[f.id] ? '<span class="aa3-act-badge st-pushed">已推送</span>' : '');
        html += '<div class="aa3-row' + selected + (act && act.status === 'dismiss' ? ' dismissed' : '') + '" onclick="AUTOALERT.select(\'' + f.id + '\')">' +
          '<div class="aa3-row-lv" style="background:' + col.bg + ';color:' + col.text + ';border:1px solid ' + col.border + '">' + col.label + '</div>' +
          '<div class="aa3-row-body">' +
            '<div class="aa3-row-title">' + icon + ' ' + (f.title || f.asset || '-') + actBadge + '</div>' +
            '<div class="aa3-row-meta">' + (f.country || '全球') + ' · ' + (_REASON.build(f).why || f.horizon || '') + '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      return html;
    },

    setFilter(k, v) {
      this._filter[k] = v;
      this._renderMain();
      this._drawTrendChart();
    },

    _stepHtml(n, label, bodyHtml) {
      return '<div class="aa3-step">' +
        '<div class="aa3-step-head"><span class="aa3-step-n">' + n + '</span><span class="aa3-step-label">' + label + '</span></div>' +
        '<div class="aa3-step-body">' + bodyHtml + '</div>' +
      '</div>';
    },

    _renderDetail() {
      var self = this;
      var item = null;
      this._forecasts.forEach(function (x) { if (x.id === self._selectedId) item = x; });
      if (!item) {
        return '<div class="aa3-empty-card">' +
          '<div class="aa3-empty-title">🔗 联动处置</div>' +
          '<div class="aa3-empty">点击左侧预测情景，查看"事实→关联→推理→建议→证据"推理链与处置入口</div>' +
        '</div>';
      }
      var col = _LEVEL_COLOR[item.level];
      var R = _REASON.build(item);
      var esc = _REASON._esc;
      var playbooks = _SOAR.match(item.title || item.asset || '');
      var html = '<div class="aa3-detail-card">' +
        '<div class="aa3-detail-header" style="border-left:4px solid ' + col.border + '">' +
          '<span class="aa3-detail-lv" style="background:' + col.bg + ';color:' + col.text + '">' + col.label + '</span>' +
          '<span class="aa3-detail-title">' + (item.title || item.asset || '-') + '</span>' +
          '<span class="aa3-detail-hz">' + (item.horizon || '') + '</span>' +
        '</div>' +
        /* ===== 推理链：①事实 → ②关联 → ③推理 → ④建议 → ⑤证据 ===== */
        '<div class="aa3-chain">' +
          this._stepHtml(1, '事实 · 发生了什么', '<div class="aa3-step-text">' + R.fact + '</div>') +
          this._stepHtml(2, '关联 · 与我们何干', '<div class="aa3-step-text">' + R.link + '</div>' +
            (R.assets.length ? '<div class="aa3-step-tags">' + R.assets.slice(0, 5).map(function (a) {
              return '<span class="aa3-tag" style="cursor:pointer" onclick="AUTOALERT.openCountry(\'' + esc(a.country) + '\')" title="点击查看国家态势">' + a.name + '</span>';
            }).join('') + '</div>' : '')) +
          this._stepHtml(3, '推理 · 接下来会怎样', '<ul class="aa3-infer">' + R.infer.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
            '<div class="aa3-step-verdict">' + R.horizonLine + '</div>') +
          this._stepHtml(4, '建议 · 现在该怎么办', '<ul class="aa3-infer">' + R.acts.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>') +
          this._stepHtml(5, '证据 · 可回溯链',
            (R.rel.length
              ? '<div class="aa3-related-list">' + R.rel.slice(0, 5).map(function (r) {
                  var rc = _LEVEL_COLOR[r.level || 'blue'];
                  return '<div class="aa3-related" onclick="AUTOALERT.openAlert(\'' + esc(r.id) + '\')" title="点击查看预警原文">' +
                    '<span style="color:' + rc.text + '">[' + rc.label + ']</span> ' +
                    '<span>' + String(r.title || '').slice(0, 44) + '</span></div>';
                }).join('') + '</div>'
              : '<div class="aa3-empty">近72h无同国在库预警（前瞻推演情景）</div>') +
            '<div class="aa3-ev-meta">' +
              '<span class="aa3-ev-link" onclick="AUTOALERT.openCountry(\'' + esc(item.country) + '\')">📄 ' + (item.country || '全球') + ' 国家态势</span>' +
              (R.threats.length ? '<span class="aa3-ev-link" onclick="AUTOALERT.openThreats()">🎯 ' + R.threats.map(function (t) { return t.name; }).join(' / ') + ' 在该国活动</span>' : '') +
              '<span class="aa3-ev-conf">推演依据：' + R.rel.length + ' 条真实预警 · ' + (this._lastRun || '-') + ' 计算</span>' +
            '</div>') +
        '</div>';
      /* SOAR 预案卡（保留既有 checklist 交互） */
      html += '<div class="aa3-detail-section">' +
        '<div class="aa3-detail-label">SOAR 处置预案（点击执行 checklist）</div>';
      if (!playbooks.length) {
        if (item.type === 'country_upgrade' || R.pb) {
          playbooks = R.pb ? [R.pb] : [_SOAR.generic];
        } else {
          html += '<div class="aa3-empty">未匹配标准预案，按上述建议人工研判</div>';
        }
      }
      if (playbooks.length) {
        playbooks.forEach(function (p) {
          var done = (self._pbCheck[p.id] || []).length;
          html += '<div class="aa3-playbook' + (done >= p.actions.length ? ' done' : '') + '" onclick="AUTOALERT.openPlaybook(\'' + p.id + '\',\'' + item.id + '\')">' +
            '<div class="aa3-playbook-name">' + p.id + ' ' + p.name +
              '<span class="aa3-pb-progress">' + done + '/' + p.actions.length + '</span>' +
              '<span class="aa3-pb-run">▶ 执行</span></div>' +
            '<div class="aa3-playbook-actions">' + p.actions.map(function (a, i) {
              var ck = (self._pbCheck[p.id] || []).indexOf(i) >= 0;
              return '<span class="aa3-tag' + (ck ? ' checked' : '') + '">' + (ck ? '☑' : '☐') + ' ' + a + '</span>';
            }).join('') + '</div>' +
          '</div>';
        });
      }
      html += '</div>';
      var act = this._actions[item.id];
      html += '<div class="aa3-detail-actions">' +
        '<button class="btn" ' + (this._pushed[item.id] ? 'disabled title="已推送，请到预警中心查看"' : '') + ' onclick="AUTOALERT.pushToAlertCenter(\'' + item.id + '\')">' + (this._pushed[item.id] ? '已推送 ✓' : '推送至预警中心') + '</button>' +
        '<button class="btn" onclick="AUTOALERT.createAiReport(\'' + item.id + '\')">🤖 AI 推演简报</button>' +
        '<button class="btn" onclick="AUTOALERT.openCountry(\'' + esc(item.country) + '\')">查看国家态势</button>' +
      '</div>' +
      '<div class="aa3-disposition">' +
        '<span class="aa3-disp-label">处置：</span>' +
        '<button class="btn aa3-disp-btn st-ack' + (act && act.status === 'ack' ? ' cur' : '') + '" onclick="AUTOALERT.setAction(\'' + item.id + '\',\'ack\')">✅ 已阅</button>' +
        '<button class="btn aa3-disp-btn st-assign' + (act && act.status === 'assign' ? ' cur' : '') + '" onclick="AUTOALERT.setAction(\'' + item.id + '\',\'assign\')">📌 交办</button>' +
        '<button class="btn aa3-disp-btn st-dismiss' + (act && act.status === 'dismiss' ? ' cur' : '') + '" onclick="AUTOALERT.setAction(\'' + item.id + '\',\'dismiss\')">✖ 忽略</button>' +
        (act ? '<span class="aa3-disp-time">' + act.time + ' ' + (act.status === 'ack' ? '已阅' : act.status === 'assign' ? '已交办' : '已忽略') + '</span>' : '') +
      '</div>';
      html += '</div>';
      return html;
    },

    /* 处置状态闭环：已阅/交办/忽略，持久化并回写队列徽标 */
    setAction(id, status) {
      var item = this._forecasts.find(function (x) { return x.id === id; });
      if (!item) return;
      if (this._actions[id] && this._actions[id].status === status) { delete this._actions[id]; this._log('撤销处置', item.title || item.asset); }
      else { this._actions[id] = { status: status, time: _nowFmt() }; this._log(status === 'ack' ? '标记已阅' : status === 'assign' ? '交办处置' : '忽略情景', item.title || item.asset); }
      this._saveActions();
      this._renderMain();
      this._drawTrendChart();
    },

    /* SOAR 预案执行 checklist：模态框内逐项勾选，进度持久化 */
    openPlaybook(pbId, forecastId) {
      var pb = _SOAR.playbooks.find(function (p) { return p.id === pbId; }) || _SOAR.generic;
      var checked = this._pbCheck[pbId] || [];
      var fc = this._forecasts.find(function (x) { return x.id === forecastId; });
      var self = this;
      var html = '<div style="font-size:12px;line-height:1.8">' +
        (fc ? '<div style="padding:8px 10px;background:var(--bg2,#141a2a);border-radius:6px;margin-bottom:10px">关联情景：<b>' + (fc.title || fc.asset || '') + '</b> · ' + (fc.country || '全球') + '</div>' : '') +
        '<div id="aa3-pb-list">' + pb.actions.map(function (a, i) {
          var on = checked.indexOf(i) >= 0;
          return '<div class="aa3-pb-item' + (on ? ' on' : '') + '" onclick="AUTOALERT.togglePbStep(\'' + pbId + '\',' + i + ')" style="padding:7px 10px;margin-bottom:5px;border-radius:6px;cursor:pointer;background:' + (on ? 'rgba(34,197,94,0.12)' : 'rgba(22,30,50,0.7)') + ';border:1px solid ' + (on ? 'rgba(34,197,94,0.5)' : 'rgba(0,212,255,0.12)') + '">' +
            (on ? '✅ ' : '☐ ') + a + '</div>';
        }).join('') + '</div>' +
        '<div style="margin-top:8px;font-size:10px;color:#7a8ba3">点击条目勾选/取消，进度 ' + checked.length + '/' + pb.actions.length + '，自动保存。全部勾选即视为该预案已执行。</div></div>';
      this._log('执行预案 ' + pb.id, pb.name);
      try {
        showModal('📋 ' + pb.id + ' ' + pb.name + ' · 执行清单', html);
      } catch (e) { /* showModal 不可用时降级为提示 */ try { showToast('预案 ' + pb.id + '：' + pb.actions.join('；')); } catch (e2) {} }
    },

    togglePbStep(pbId, idx) {
      var arr = this._pbCheck[pbId] || [];
      var i = arr.indexOf(idx);
      if (i >= 0) arr.splice(i, 1); else arr.push(idx);
      this._pbCheck[pbId] = arr;
      this._saveActions();
      /* 刷新模态框内条目 + 队列卡片进度 */
      var pb = _SOAR.playbooks.find(function (p) { return p.id === pbId; }) || _SOAR.generic;
      try {
        var nodes = document.querySelectorAll('#aa3-pb-list .aa3-pb-item');
        nodes.forEach(function (n, k) {
          var on = arr.indexOf(k) >= 0;
          n.classList.toggle('on', on);
          n.style.background = on ? 'rgba(34,197,94,0.12)' : 'rgba(22,30,50,0.7)';
          n.style.border = '1px solid ' + (on ? 'rgba(34,197,94,0.5)' : 'rgba(0,212,255,0.12)');
          n.innerHTML = (on ? '✅ ' : '☐ ') + (pb ? pb.actions[k] : '');
        });
      } catch (e) {}
      this._renderMain();
      this._drawTrendChart();
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
        html += '<div class="aa3-asset-row" onclick="AUTOALERT.selectByAsset(\'' + String(a.asset || '').replace(/'/g, '') + '\')" title="点击定位该资产的风险情景">' +
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
            onClick: function (evt) {
              try {
                var pts = this.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
                if (pts && pts.length) {
                  var f = focus[pts[0].datasetIndex];
                  if (f) AUTOALERT.select(f.id);
                }
              } catch (e) {}
            },
            onHover: function (evt, els) { evt.native.target.style.cursor = (els && els.length) ? 'pointer' : 'default'; },
            plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 11 } } }, tooltip: { callbacks: { afterBody: function (items) { var f = focus[items[0].datasetIndex]; return f ? ['点击查看该国家情景详情'] : []; } } } },
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
    openThreats() {
      try { if (typeof navigateTo === 'function') navigateTo('threatorgs'); } catch (e) {}
    },
    openAlert(id) { try { if (typeof showAlertDetail === 'function' && id) showAlertDetail(id); } catch (e) {} },
    pushToAlertCenter(id) {
      var item = this._forecasts.find(function (x) { return x.id === id; });
      if (!item) return;
      if (this._pushed[id]) { try { showToast('该情景已推送过，请到预警中心查看'); } catch (e) {} return; }
      try {
        if (typeof ALERTS !== 'undefined') {
          var a = { id: id, alert_no: id, level: item.level, type: '安全风险', country: item.country || '全球', title: item.title || item.asset || '未来风险预警', desc: item.reason || item.horizon || '', time: _nowFmt(), status: 'active', source: '自动预警预测', _forecast: true };
          ALERTS.unshift(a);
          if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts');
          if (typeof DataHub !== 'undefined' && DataHub._notify) DataHub._notify('alerts');
        }
        this._pushed[id] = _nowFmt();
        this._saveActions();
        this._log('推送至预警中心', item.title || item.asset);
        if (typeof showToast === 'function') showToast('已推送至预警中心');
        this._renderMain();
        this._drawTrendChart();
      } catch (e) {}
    },
    /* AI 推演简报：真实调用服务端大模型（kind=scenario-path），不再只是跳页 */
    createAiReport(id) {
      var item = this._forecasts.find(function (x) { return x.id === id; });
      if (!item) return;
      var self = this;
      try {
        showModal('🤖 AI 推演简报', '<div style="padding:10px;font-size:12px;color:#7a8ba3">Kimi 正在基于该情景的真实数据推演发展路径（约30-90秒）…<div style="margin-top:8px;font-size:11px">情景：' + (item.title || item.asset || '') + '</div></div>');
      } catch (e) {}
      var tok = '';
      try { tok = (typeof APIClient !== 'undefined' && APIClient.getToken) ? APIClient.getToken() : (localStorage.getItem('orps_token') || ''); } catch (e) {}
      var drivers = [];
      if (item.factors) drivers = ['近72h红区 ' + item.factors.red, '橙区 ' + item.factors.orange, '涉华 ' + item.factors.cn, '严重事件 ' + item.factors.severe, '风险评分 ' + item.factors.score];
      var affected = [];
      if (item.type === 'threat_asset') affected = [item.asset || ''];
      fetch('/api/llm/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({
          kind: 'scenario-path',
          scenario: {
            name: item.title || item.asset || item.country || '预测情景',
            domDim: item.type === 'asset_exposure' ? '资产暴露' : item.type === 'threat_asset' ? '威胁关联' : '风险升级',
            cur: item.type === 'country_upgrade' ? (item.factors ? item.factors.score : item.score) : (item.score || '—'),
            pred: item.score || '—',
            drivers: drivers,
            affected: affected
          }
        })
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (res) {
          var j = res.j || {};
          var body;
          if (res.status === 200 && j.ok) {
            var txt = String(j.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#00d4ff">$1</strong>').replace(/\n/g, '<br>');
            body = '<div style="padding:12px;font-size:12px;line-height:1.8;color:#e2e8f0;max-height:60vh;overflow:auto"><strong style="color:#b366ff">🤖 AI 路径推演（' + (j.model || '') + (j.elapsed ? ' · ' + j.elapsed : '') + '）</strong><br><br>' + txt + '</div>';
            self._log('AI 推演简报生成', item.title || item.asset);
          } else if (res.status === 401) {
            body = '<div style="padding:20px;font-size:12px;color:#f97316">⚠️ 登录已过期，请重新登录后重试</div>';
          } else {
            body = '<div style="padding:20px;font-size:12px;color:#ef4444">⚠️ ' + (j.error || '推演失败') + '</div>';
          }
          try { showModal('🤖 AI 推演简报 · ' + (item.country || ''), body); } catch (e) {}
        })
        .catch(function (e) {
          try { showModal('🤖 AI 推演简报', '<div style="padding:20px;font-size:12px;color:#ef4444">⚠️ 网络错误：' + e.message + '</div>'); } catch (e2) {}
        });
    },
    /* 资产暴露行点击 → 联动选中对应情景 */
    selectByAsset(name) {
      var f = this._forecasts.find(function (x) { return x.asset === name; }) ||
              this._forecasts.find(function (x) { return (x.title || '').indexOf(name) >= 0; });
      if (f) { this.select(f.id); try { showToast('已定位情景：' + (f.title || f.asset)); } catch (e) {} }
      else { try { showToast('该资产暂无关联升级情景'); } catch (e) {} }
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
        '#view-autoalert .aa3-detail{flex:1;background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:12px;max-height:640px;overflow:auto;}' +
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
        /* ---- 本期研判结论卡 ---- */
        '#view-autoalert .aa3-conclusion{display:flex;gap:16px;background:var(--aa3-panel);border:1px solid var(--aa3-border);border-radius:10px;padding:14px 18px;margin-bottom:14px;align-items:stretch;}' +
        '#view-autoalert .aa3-concl-left{display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:120px;}' +
        '#view-autoalert .aa3-concl-lv{font-size:16px;font-weight:800;padding:8px 12px;border-radius:8px;text-align:center;letter-spacing:1px;}' +
        '#view-autoalert .aa3-concl-basis{font-size:9px;color:var(--aa3-text3);text-align:center;line-height:1.5;}' +
        '#view-autoalert .aa3-concl-mid{flex:1.2;display:flex;flex-direction:column;justify-content:center;border-right:1px solid var(--aa3-border);border-left:1px solid var(--aa3-border);padding:0 14px;}' +
        '#view-autoalert .aa3-concl-right{flex:1;display:flex;flex-direction:column;justify-content:center;}' +
        '#view-autoalert .aa3-concl-tt{font-size:11px;font-weight:700;color:var(--aa3-text2);margin-bottom:6px;}' +
        '#view-autoalert .aa3-concl-sentence{font-size:13px;line-height:1.8;color:var(--aa3-text);font-weight:600;}' +
        '#view-autoalert .aa3-concl-act{display:flex;gap:8px;align-items:flex-start;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:11px;line-height:1.6;color:var(--aa3-text);transition:background .15s;}' +
        '#view-autoalert .aa3-concl-act:hover{background:rgba(0,212,255,0.08);}' +
        '#view-autoalert .aa3-concl-act-n{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:10px;font-weight:800;}' +
        /* ---- 筛选 chips ---- */
        '#view-autoalert .aa3-filters{margin-bottom:10px;padding:8px;background:var(--aa3-panel2);border-radius:6px;}' +
        '#view-autoalert .aa3-filter-row{display:flex;gap:6px;flex-wrap:wrap;}' +
        '#view-autoalert .aa3-filter-row + .aa3-filter-row{margin-top:6px;}' +
        '#view-autoalert .aa3-chip{font-size:10px;padding:3px 9px;border-radius:12px;border:1px solid var(--aa3-border);color:var(--aa3-text2);cursor:pointer;background:transparent;transition:all .15s;}' +
        '#view-autoalert .aa3-chip:hover{color:var(--aa3-text);border-color:rgba(0,212,255,0.4);}' +
        '#view-autoalert .aa3-chip.on{font-weight:700;}' +
        /* ---- 处置徽标 / 已忽略行 ---- */
        '#view-autoalert .aa3-act-badge{display:inline-block;font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:1px;}' +
        '#view-autoalert .aa3-act-badge.st-ack{background:rgba(59,130,246,0.15);color:#3b82f6;}' +
        '#view-autoalert .aa3-act-badge.st-assign{background:rgba(179,102,255,0.15);color:#b366ff;}' +
        '#view-autoalert .aa3-act-badge.st-dismiss{background:rgba(122,139,163,0.15);color:#7a8ba3;}' +
        '#view-autoalert .aa3-act-badge.st-pushed{background:rgba(34,197,94,0.12);color:#22c55e;}' +
        '#view-autoalert .aa3-row.dismissed{opacity:.5;}' +
        '#view-autoalert .aa3-row-title .aa3-act-badge{float:right;}' +
        /* ---- SOAR 预案执行 ---- */
        '#view-autoalert .aa3-playbook{cursor:pointer;transition:background .15s;}' +
        '#view-autoalert .aa3-playbook:hover{background:rgba(0,212,255,0.06);}' +
        '#view-autoalert .aa3-playbook.done{border-left:3px solid #22c55e;}' +
        '#view-autoalert .aa3-pb-progress{font-size:9px;color:#22c55e;margin-left:6px;}' +
        '#view-autoalert .aa3-pb-run{font-size:9px;color:#00d4ff;margin-left:8px;border:1px solid rgba(0,212,255,0.3);border-radius:8px;padding:0 6px;}' +
        '#view-autoalert .aa3-tag.checked{color:#22c55e;border-color:rgba(34,197,94,0.4);}' +
        /* ---- 处置按钮组 ---- */
        '#view-autoalert .aa3-disposition{display:flex;gap:8px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed var(--aa3-border);flex-wrap:wrap;}' +
        '#view-autoalert .aa3-disp-label{font-size:11px;color:var(--aa3-text2);font-weight:700;}' +
        '#view-autoalert .aa3-disp-btn{font-size:10px !important;padding:3px 10px !important;}' +
        '#view-autoalert .aa3-disp-btn.st-ack.cur{background:rgba(59,130,246,0.2);border-color:#3b82f6;color:#3b82f6;}' +
        '#view-autoalert .aa3-disp-btn.st-assign.cur{background:rgba(179,102,255,0.2);border-color:#b366ff;color:#b366ff;}' +
        '#view-autoalert .aa3-disp-btn.st-dismiss.cur{background:rgba(122,139,163,0.2);border-color:#7a8ba3;color:#7a8ba3;}' +
        '#view-autoalert .aa3-disp-time{font-size:9px;color:var(--aa3-text3);margin-left:4px;}' +
        /* ---- 推理链五段卡（2026-08-30 智能联动重构：推理而非数字） ---- */
        '#view-autoalert .aa3-chain{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;}' +
        '#view-autoalert .aa3-step{position:relative;padding-bottom:8px;}' +
        '#view-autoalert .aa3-step:not(:last-child)::before{content:"";position:absolute;left:12px;top:28px;bottom:2px;width:2px;background:linear-gradient(rgba(0,212,255,0.4),rgba(0,212,255,0.05));}' +
        '#view-autoalert .aa3-step-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}' +
        '#view-autoalert .aa3-step-n{display:inline-flex;align-items:center;justify-content:center;width:25px;height:25px;border-radius:50%;background:rgba(0,212,255,0.12);border:1px solid rgba(0,212,255,0.45);color:#00d4ff;font-size:12px;font-weight:800;flex-shrink:0;}' +
        '#view-autoalert .aa3-step-label{font-size:12px;font-weight:700;color:var(--aa3-text);letter-spacing:.5px;}' +
        '#view-autoalert .aa3-step-body{margin-left:33px;background:var(--aa3-panel2);border-radius:6px;padding:8px 10px;}' +
        '#view-autoalert .aa3-step-text{font-size:12px;line-height:1.8;color:var(--aa3-text);}' +
        '#view-autoalert .aa3-step-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}' +
        '#view-autoalert .aa3-infer{margin:0;padding-left:16px;font-size:12px;line-height:1.85;color:var(--aa3-text);}' +
        '#view-autoalert .aa3-infer li{margin-bottom:2px;}' +
        '#view-autoalert .aa3-step-verdict{margin-top:6px;padding:6px 8px;border-radius:5px;font-size:11.5px;font-weight:700;color:var(--aa3-text);background:rgba(0,212,255,0.07);border:1px dashed rgba(0,212,255,0.28);}' +
        '#view-autoalert .aa3-ev-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center;}' +
        '#view-autoalert .aa3-ev-link{font-size:10px;color:#00d4ff;cursor:pointer;border:1px solid rgba(0,212,255,0.25);border-radius:10px;padding:2px 8px;transition:background .15s;}' +
        '#view-autoalert .aa3-ev-link:hover{background:rgba(0,212,255,0.1);}' +
        '#view-autoalert .aa3-ev-conf{font-size:9px;color:var(--aa3-text3);}' +
        '#view-autoalert .aa3-detail-hz{font-size:10px;color:var(--aa3-text2);margin-left:auto;flex-shrink:0;}' +
        '#view-autoalert .aa3-tag[style]{font-size:9px;}' +
        '@media(max-width:1100px){#view-autoalert .aa3-hero{flex-direction:column;align-items:flex-start;}#view-autoalert .aa3-main{flex-direction:column;}#view-autoalert .aa3-scenarios{width:auto;}#view-autoalert .aa3-charts{flex-direction:column;}#view-autoalert .aa3-conclusion{flex-direction:column;}#view-autoalert .aa3-concl-mid{border:none;padding:0;}}';
      document.head.appendChild(s);
    }
  };
})();
