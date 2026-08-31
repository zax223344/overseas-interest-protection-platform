/* ============================================================
 * WORKBENCH 联合作业台 v4（2026-08-31 实战化 —— 研判/异动/盯防/项目威胁联动）
 * v3 基座（图层×面板×时间×观测方案四维编排）+ v4 实战研判层：
 *   🧠 态势研判条   综合等级 + 环比趋势（当前窗 vs 前一窗）+ 自动研判文字
 *   ⚠ 异动检测     逐国预警速率 vs 前 7 天基线，超阈标记「⚠异动」
 *   🎯 重点盯防 Top5 量×级别×涉华×项目×异动加权排序 + 盯防理由文字
 *   🏗 受威胁项目   ENTERPRISES 项目档案 × 所在国预警热度联动面板
 * v3 保留：
 *   ⏱ 时间窗   6h / 24h(值班口径) / 48h / 7天，贯穿指数计算/热区聚合/情报流
 *   🧩 面板    指数卡 / 研判 / 工作区 / 情报流 各自可开可关
 *   📐 观测方案 当前组合（工作区+图层+时间窗+面板）存为命名方案，一键切换
 *   ⛶ 满宽地图 隐藏工作区/情报流，地图占满
 * 状态持久化：orps_wb_state（跨会话恢复观测台含地图视野）+ orps_wb_profiles（多方案库）
 * 中央：Leaflet 真实地图（天地图卫星底图 TDT_BASEMAP，失败回退本地矢量）
 * 图层 = 地图标记层（勾选直接 add/remove L.layerGroup，不是数据过滤）：
 *   L1 预警热区   真实 ALERTS 按国家聚合，半径∝数量、色=最高级别，点击列该国预警
 *   L2 重点项目   ENTERPRISES 真实项目档案（瓜达尔港/比雷埃夫斯/汉班托塔…）落点国家坐标
 *   L3 海上咽喉   CHOKEPOINTS 8 大通道真实地理坐标，色按 risk
 *   L4 高风险国家 COUNTRIES scores.security≥7 警示圈
 *   L5 风险走廊   CORRIDORS 一带一路走廊落点
 * 其余：任务工作区联动图层组合 / Explain 三段论 / 海外利益安全指数 / 情报流
 * 数据源：全局 ALERTS / COUNTRIES / ENTERPRISES / CHOKEPOINTS / CORRIDORS + /api/intel/stats
 * ============================================================ */
var WORKBENCH = {
  _ws: 'overall',
  _layers: {},
  _hours: 24,          /* 时间窗：WorldMonitor 时间维度（24h=值班铁律默认） */
  _panels: { ix: true, judge: true, watch: true, ws: true, feed: true },  /* 面板开关节点（v4 增研判/盯防） */
  _mapFocus: false,    /* 地图满宽模式 */
  _inited: false,
  _map: null,          /* Leaflet 地图实例 */
  _lg: {},             /* {图层键: L.layerGroup} */
  _stats: null,
  _ix: null,

  /* ── 状态持久化：orps_wb_ 前缀（图层/时间/面板/方案，跨会话保留用户拼好的观测台） ── */
  _saveState: function () {
    try {
      var st = {
        ws: this._ws, layers: this._layers, hours: this._hours,
        panels: this._panels, mapFocus: this._mapFocus,
        center: this._map ? this._map.getCenter() : null,
        zoom: this._map ? this._map.getZoom() : null
      };
      this._savedView = st;  /* 内存同步：_render 重建地图后按此恢复视野 */
      localStorage.setItem('orps_wb_state', JSON.stringify(st));
    } catch (e) {}
  },
  _loadState: function () {
    try {
      var s = JSON.parse(localStorage.getItem('orps_wb_state') || 'null');
      if (s) {
        if (s.ws) this._ws = s.ws;
        if (s.layers) this._layers = s.layers;
        if (s.hours) this._hours = s.hours;
        if (s.panels) {
          /* v4 兼容：旧状态无 judge/watch 键 → 默认开（升级即得新面板，不因旧状态被关） */
          this._panels = { judge: true, watch: true, ws: true, feed: true, ix: true };
          Object.keys(s.panels).forEach(function (k) { WORKBENCH._panels[k] = s.panels[k]; });
        }
        this._mapFocus = !!s.mapFocus;
        this._savedView = s;
      }
    } catch (e) {}
  },
  /* 观测方案：保存/读取用户自定义组合（WorldMonitor 多标签页思想） */
  _profiles: function () {
    try { return JSON.parse(localStorage.getItem('orps_wb_profiles') || '{}'); } catch (e) { return {}; }
  },
  _saveProfile: function (name) {
    var p = this._profiles();
    p[name] = { ws: this._ws, layers: JSON.parse(JSON.stringify(this._layers)), hours: this._hours, panels: JSON.parse(JSON.stringify(this._panels)) };
    try { localStorage.setItem('orps_wb_profiles', JSON.stringify(p)); } catch (e) {}
  },
  _applyProfile: function (name) {
    var p = this._profiles()[name];
    if (!p) return;
    this._ws = p.ws; this._layers = p.layers; this._hours = p.hours; this._panels = p.panels;
    this._render();
  },
  _delProfile: function (name) {
    var p = this._profiles();
    delete p[name];
    try { localStorage.setItem('orps_wb_profiles', JSON.stringify(p)); } catch (e) {}
  },

  /* ── 地图图层定义（勾选=地图标记显示/隐藏） ── */
  MAP_LAYERS: [
    { key: 'alerts',  name: '预警热区',     em: '🔥', def: true,  desc: '近24h真实预警按国家聚合' },
    { key: 'project', name: '重点项目',     em: '🏗', def: true,  desc: '35企真实项目档案落点' },
    { key: 'strait',  name: '海上咽喉',     em: '⚓', def: true,  desc: '8大通道真实地理坐标' },
    { key: 'risk',    name: '高风险国家',   em: '⚠', def: false, desc: '公共安全评分≥7警示圈' },
    { key: 'corridor',name: '风险走廊',     em: '🚂', def: false, desc: '一带一路走廊' }
  ],

  /* 8 大咽喉真实地理坐标（公开航海常识，非模拟数据） */
  STRAIT_POS: {
    '红海-曼德海峡': [12.6, 43.3], '苏伊士运河': [30.5, 32.35], '马六甲海峡': [2.5, 101.5],
    '霍尔木兹海峡': [26.6, 56.25], '巴拿马运河': [9.1, -79.7], '北极航道': [78, 140]
  },

  /* ── Explain 三段论（SOURCE/FRESHNESS/CONFIDENCE，对应真实数据链） ── */
  EXP: {
    alerts: { s: 'DataHub 真实预警队列（服务端 _serverAlertGen 每 3 分钟生成，经 chinaOverseasGate + nonIntelGenre + 体裁/历史旧案/墓碑多闸门）。按预警 country 字段聚合到 COUNTRIES 国家坐标。', f: '预警生成每 3 分钟；前端 DataHub 实时订阅刷新。时间窗顶栏可切 6h/24h/48h/7天，默认 24h（值班口径铁律）。', c: '圆色=该国当前最高预警级别；半径∝预警量。点击圆看该国预警明细与原文链接。' },
    project: { s: 'ENTERPRISES 35 企真实项目档案（瓜达尔港/比雷埃夫斯港/汉班托塔港/皎漂港/蒙内铁路/西芒杜/卡莫阿/中老铁路等），项目落点为其东道国 COUNTRIES 坐标。', f: '项目档案为底数库静态维护；关联风险随事件实时更新（_tagAssets 自动锚定）。', c: '项目-事件关联基于地理+名称实体双匹配（interest-base matchProjects）。' },
    strait: { s: 'CHOKEPOINTS 海上咽喉档案 + interest-base STRAIT_CHANNELS 通道清单；坐标为公开航海地理坐标。channel-watch 通道哨兵（30min）监测通道事件。', f: '哨兵 30 分钟；通道风险分随事件更新。', c: '通道状态分级：正常/关注/高风险/中断；曼德海峡等当前为极高。' },
    risk: { s: 'COUNTRIES 国别风险档案 scores.security（公共安全维度评分，蓝皮书口径底数）。', f: '国别档案静态底数 + 预警联动更新。', c: '评分≥7 显示警示圈；分值为研判参考，实时事件看预警热区层。' },
    corridor: { s: 'CORRIDORS 一带一路走廊档案（中巴经济走廊/中蒙俄/新亚欧大陆桥等），落点为走廊关键国家坐标。', f: '静态底数；关联事件实时。', c: '走廊状态（畅通/部分受阻/受阻）由关联国家预警驱动。' }
  },

  /* ── 任务工作区：场景 → 图层组合联动 ── */
  WORKSPACES: [
    { key: 'overall',  icon: '🛡', label: '总体态势值守', layers: ['alerts', 'project', 'strait'] },
    { key: 'consular', icon: '🛂', label: '领事保护值班', layers: ['alerts', 'risk', 'corridor'] },
    { key: 'cnsec',    icon: '🇨🇳', label: '涉华安全专项', layers: ['alerts', 'risk'] },
    { key: 'project',  icon: '🏗', label: '项目资产护卫', layers: ['project', 'alerts', 'strait'] },
    { key: 'corridor', icon: '⚓', label: '通道走廊监控', layers: ['strait', 'corridor', 'alerts'] }
  ],

  /* ── 安全指数：真实预警加权（时间窗跟随顶栏选择） ── */
  computeIndex: function (alerts, hours) {
    var now = Date.now(), win = (hours || 24) * 3600 * 1000;
    var score = 0, contrib = {}, lv = { red: 0, orange: 0, yellow: 0 }, coreN = 0, cnN = 0, n = 0;
    (alerts || []).forEach(function (a) {
      if (!a || !a.time) return;
      var t = Date.parse(String(a.time).replace(' ', 'T'));
      if (isNaN(t) || now - t > win) return;
      n++;
      var w = (a.is_core ? 5 : 1) * ({ red: 3, orange: 2, yellow: 1 }[a.level] || 1) * (a.chinaRelated ? 1.5 : 1);
      score += w;
      if (a.is_core) coreN++;
      if (a.chinaRelated) cnN++;
      if (a.level) lv[a.level] = (lv[a.level] || 0) + 1;
      var k = a.country || '未标注国别';
      contrib[k] = (contrib[k] || 0) + w;
    });
    var idx = Math.min(100, Math.round(score / 1.2));
    var grade = idx >= 80 ? { t: '红色 · Ⅰ级', c: 'var(--red)' }
      : idx >= 55 ? { t: '橙色 · Ⅱ级', c: 'var(--orange)' }
      : idx >= 35 ? { t: '黄色 · Ⅲ级', c: 'var(--yellow)' }
      : idx >= 15 ? { t: '蓝色 · Ⅳ级', c: 'var(--cyan)' }
      : { t: '平稳 · Ⅴ级', c: 'var(--green)' };
    var rows = Object.keys(contrib).map(function (k) { return { k: k, v: contrib[k] }; })
      .sort(function (x, y) { return y.v - x.v; }).slice(0, 8);
    return { idx: idx, grade: grade, score: Math.round(score), n: n, coreN: coreN, cnN: cnN, lv: lv, rows: rows };
  },

  /* ============================================================
   * v4 实战研判层：环比 / 异动 / 盯防 / 项目威胁（全部真实 ALERTS 计算）
   * ============================================================ */
  _tsOf: function (a) { var t = Date.parse(String((a && a.time) || '').replace(' ', 'T')); return isNaN(t) ? 0 : t; },

  /* ── 环比趋势：当前窗 vs 前一窗（等长窗口对照） ── */
  computeTrend: function (alerts, hours) {
    var now = Date.now(), win = (hours || 24) * 3600 * 1000;
    var cur = { n: 0, red: 0, orange: 0, yellow: 0, score: 0, core: 0, cn: 0 };
    var prev = { n: 0, red: 0, orange: 0, yellow: 0, score: 0, core: 0, cn: 0 };
    (alerts || []).forEach(function (a) {
      var t = WORKBENCH._tsOf(a);
      if (!t) return;
      var w = (a.is_core ? 5 : 1) * ({ red: 3, orange: 2, yellow: 1 }[a.level] || 1) * (a.chinaRelated ? 1.5 : 1);
      var o;
      if (now - t <= win) o = cur;
      else if (now - t <= win * 2) o = prev;
      else return;
      o.n++; o.score += w;
      if (a.level && o[a.level] != null) o[a.level]++;
      if (a.is_core) o.core++;
      if (a.chinaRelated) o.cn++;
    });
    /* 变化率：量与加权分各算，取加权分为主口径（量受噪音影响大） */
    var dPct = prev.score ? Math.round((cur.score - prev.score) / prev.score * 100)
      : (cur.score > 0 ? 100 : 0);
    return { cur: cur, prev: prev, dPct: dPct };
  },

  /* ── 异动检测：逐国当前窗速率 vs 前 7 天基线（自适应数据可得窗口） ──
   * 基线 = ALERTS 中 [8 天前, 当前窗起点] 区间该国的日均量（数据不足 3 天按可得天数归一）。
   * 判异动：当前窗量 ≥3 且 ≥ 基线×2（基线 0 时需 ≥5 条，避免低频国误报）。 */
  computeAnomalies: function (alerts, hours) {
    var now = Date.now(), win = (hours || 24) * 3600 * 1000;
    var winStart = now - win, baseStart = now - 8 * 24 * 3600 * 1000;
    var cur = {}, base = {}, spanDays = 0, i;
    /* 实际可得跨度（ALERTS 覆盖不足 7 天时按可得窗口归一，避免基线虚低导致全员异动） */
    var minT = Infinity, maxT = 0;
    (alerts || []).forEach(function (a) { var t = WORKBENCH._tsOf(a); if (t) { if (t < minT) minT = t; if (t > maxT) maxT = t; } });
    var span = Math.max(0, Math.min(maxT, winStart) - Math.max(minT, baseStart));
    spanDays = span > 0 ? span / (24 * 3600 * 1000) : 0;
    (alerts || []).forEach(function (a) {
      var t = WORKBENCH._tsOf(a);
      if (!t) return;
      var k = a.country || '';
      if (!k) return;
      if (t > winStart) { cur[k] = (cur[k] || 0) + 1; }
      else if (t > baseStart) { base[k] = (base[k] || 0) + 1; }
    });
    if (spanDays < 1.5) return [];  /* 基线窗口不足：异动判定不可信，不标 */
    var out = [];
    Object.keys(cur).forEach(function (k) {
      var n = cur[k];
      if (n < 3) return;
      var dayAvg = (base[k] || 0) / spanDays;
      var curPerDay = n / (win / (24 * 3600 * 1000));
      var ratio = dayAvg > 0 ? curPerDay / dayAvg : 0;
      var isAnom = dayAvg > 0 ? ratio >= 2 : n >= 5;  /* 基线 0 的低频国：≥5 条才算突发 */
      if (!isAnom) return;
      out.push({ country: k, n: n, dayAvg: Math.round(dayAvg * 10) / 10, ratio: Math.round(Math.max(ratio, 5) * 10) / 10 });
    });
    out.sort(function (x, y) { return y.ratio - x.ratio; });
    return out.slice(0, 6);
  },

  /* ── 重点盯防 Top5：量×级别×涉华×项目×异动加权 + 盯防理由 ── */
  computeWatchlist: function (alerts, hours) {
    var now = Date.now(), win = (hours || 24) * 3600 * 1000;
    var anom = {}; this._anomList = this._anomList || [];
    (this._anomList || []).forEach(function (x) { anom[x.country] = x; });
    /* 项目国映射（ENTERPRISES 真实档案 → 东道国项目数） */
    var projC = {};
    this._enterprises().forEach(function (ent) {
      (ent.projects || []).forEach(function (p) {
        var k = String(p.c || '').trim();
        if (k) projC[k] = (projC[k] || 0) + 1;
      });
    });
    var by = {};
    (alerts || []).forEach(function (a) {
      var t = WORKBENCH._tsOf(a);
      if (!t || now - t > win) return;
      var k = a.country || '';
      if (!k) return;
      by[k] = by[k] || { n: 0, red: 0, orange: 0, yellow: 0, core: 0, cn: 0, lsum: 0 };
      var b = by[k];
      b.n++;
      var lw = { red: 3, orange: 2, yellow: 1 }[a.level] || 0.5;
      b.lsum += lw;
      if (a.level && b[a.level] != null) b[a.level]++;
      if (a.is_core) b.core++;
      if (a.chinaRelated) b.cn++;
    });
    var self = this;
    var rows = Object.keys(by).map(function (k) {
      var b = by[k];
      var pN = self._findCountry(k) ? (projC[k] || 0) : 0;  /* 国名归一后查项目数 */
      if (!pN) { /* 归一兜底：模糊匹配项目国 */ var c = self._findCountry(k); if (c) pN = projC[c.name] || 0; }
      var a = anom[k];
      /* 加权：级别和 × (1+涉华×0.6) × (1+项目×0.35) × (1+异动比×0.5) ——项目/异动是实战指挥官的优先级锚 */
      var score = b.lsum * (1 + b.cn * 0.6) * (1 + pN * 0.35) * (1 + (a ? a.ratio * 0.5 : 0));
      return { country: k, n: b.n, red: b.red, orange: b.orange, yellow: b.yellow, core: b.core, cn: b.cn, proj: pN, anom: a || null, score: Math.round(score * 10) / 10 };
    }).filter(function (r) { return r.score >= 2; })
      .sort(function (x, y) { return y.score - x.score; })
      .slice(0, 5);
    return rows;
  },

  /* ── 受威胁项目联动：项目档案 × 所在国预警热度（v4 指挥官视图核心） ── */
  computeThreatProjects: function (alerts, hours) {
    var now = Date.now(), win = (hours || 24) * 3600 * 1000;
    var byC = {};
    (alerts || []).forEach(function (a) {
      var t = WORKBENCH._tsOf(a);
      if (!t || now - t > win) return;
      var k = a.country || '';
      if (!k) return;
      byC[k] = byC[k] || { n: 0, red: 0, orange: 0, top: null, core: false };
      var b = byC[k];
      b.n++;
      if (a.level === 'red') b.red++;
      else if (a.level === 'orange') b.orange++;
      if (a.is_core) b.core = true;
      /* 国别头条：核心优先，其次最新 */
      if (!b.top || (a.is_core && !b.top.is_core) || (WORKBENCH._tsOf(a) > WORKBENCH._tsOf(b.top) && !(b.top.is_core && !a.is_core))) {
        if (!(b.top && b.top.is_core && !a.is_core)) b.top = a;
      }
    });
    var self = this;
    var rows = [];
    this._enterprises().forEach(function (ent) {
      (ent.projects || []).forEach(function (p) {
        var c = self._findCountry(p.c);
        if (!c) return;
        var h = byC[c.name];
        if (!h) return;
        var heat = h.n * (1 + h.red * 1.5 + h.orange * 0.8) * (h.core ? 1.6 : 1);
        rows.push({
          proj: p.n, country: c.name, ent: ent.short || ent.name || '',
          inv: p.inv || '', pers: p.p || '-',
          n: h.n, red: h.red, orange: h.orange, core: h.core,
          heat: Math.round(heat), topTitle: h.top ? (h.top.title_zh || h.top.title || '') : ''
        });
      });
    });
    rows.sort(function (x, y) { return y.heat - x.heat; });
    return rows.slice(0, 8);
  },

  /* ── 自动研判文字：等级+环比+异动+涉华+项目 → 一句实战研判 ── */
  judgeText: function (ix, trend, anomalies, watch) {
    if (!ix || !ix.n) return '当前时间窗无预警数据，全球态势平稳，维持常规值守。';
    var parts = [];
    /* ① 总量与环比 */
    var d = trend.dPct;
    var dTxt = (d > 15 ? '环比上升 ' + d + '%' : d < -15 ? '环比回落 ' + Math.abs(d) + '%' : '环比基本持平');
    parts.push('近 ' + this._hours + 'h 预警 ' + ix.n + ' 条（' + dTxt + '），综合等级 ' + ix.grade.t);
    /* ② 异动国家 */
    if (anomalies.length) {
      var aTxt = anomalies.slice(0, 3).map(function (a) { return a.country + '（速率超基线 ' + a.ratio + '×）'; }).join('、');
      parts.push('异动：' + aTxt);
    }
    /* ③ 涉华与核心 */
    if (ix.cnN) parts.push('涉华预警 ' + ix.cnN + ' 条' + (ix.coreN ? '，核心区 ' + ix.coreN + ' 条' : ''));
    /* ④ 盯防建议（Top1 国家 + 项目威胁） */
    if (watch.length) {
      var w = watch[0];
      var reason = [];
      if (w.cn) reason.push('涉华 ' + w.cn + ' 条');
      if (w.proj) reason.push('关联项目 ' + w.proj + ' 个');
      if (w.anom) reason.push('速率超基线');
      parts.push('建议重点盯防 ' + w.country + (reason.length ? '（' + reason.join('·') + '）' : ''));
    }
    return parts.join('；') + '。';
  },

  _alerts: function () { return (typeof ALERTS !== 'undefined' && Array.isArray(ALERTS)) ? ALERTS : []; },
  _countries: function () { return (typeof COUNTRIES !== 'undefined' && Array.isArray(COUNTRIES)) ? COUNTRIES : []; },
  _enterprises: function () { return (typeof ENTERPRISES !== 'undefined' && Array.isArray(ENTERPRISES)) ? ENTERPRISES : []; },
  _chokepoints: function () { return (typeof CHOKEPOINTS !== 'undefined' && Array.isArray(CHOKEPOINTS)) ? CHOKEPOINTS : []; },
  _corridors: function () { return (typeof CORRIDORS !== 'undefined' && Array.isArray(CORRIDORS)) ? CORRIDORS : []; },

  /* 国名归一（处理全/半角括号等差异） */
  _norm: function (s) { return String(s || '').replace(/（/g, '(').replace(/）/g, ')').replace(/\s/g, ''); },
  _findCountry: function (name) {
    if (!name) return null;
    var target = this._norm(name);
    var list = this._countries();
    for (var i = 0; i < list.length; i++) {
      if (this._norm(list[i].name) === target) return list[i];
    }
    /* 模糊：包含匹配（"刚果(金)东部"→刚果(金)） */
    for (var j = 0; j < list.length; j++) {
      if (target.indexOf(this._norm(list[j].name)) >= 0 || this._norm(list[j].name).indexOf(target) >= 0) return list[j];
    }
    return null;
  },
  _ago: function (a) {
    var t = Date.parse(String(a.time || '').replace(' ', 'T'));
    if (isNaN(t)) return '';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 60) return m + ' 分钟前';
    if (m < 1440) return Math.floor(m / 60) + ' 小时前';
    return Math.floor(m / 1440) + ' 天前';
  },
  _lvColor: function (lv) { return lv === 'red' ? 'var(--red)' : lv === 'orange' ? 'var(--orange)' : lv === 'yellow' ? 'var(--yellow)' : 'var(--cyan)'; },
  _lvHex: function (lv) { return lv === 'red' ? '#ff3355' : lv === 'orange' ? '#ff8800' : lv === 'yellow' ? '#ffcc00' : '#00d4ff'; },
  _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },

  /* ============================================================
   * 初始化
   * ============================================================ */
  init: function () {
    var host = document.getElementById('workbench-content');
    if (!host) return;
    if (typeof DataHub !== 'undefined' && DataHub.subscribe && !this._subscribed) {
      this._subscribed = true;
      DataHub.subscribe(function (col) { if (col === 'alerts' || !col) WORKBENCH._onAlerts(); });
    }
    if (!this._inited) {
      this._inited = true;
      this._loadState();  /* 恢复上次观测台（图层/时间窗/面板/满宽/地图视野） */
      var hasLayers = Object.keys(this._layers).length > 0;
      var ws0 = this.WORKSPACES[0];
      this.MAP_LAYERS.forEach(function (d) {
        if (!hasLayers) WORKBENCH._layers[d.key] = ws0.layers.indexOf(d.key) >= 0 || d.def;
      });
      this._pullStats();
      setInterval(function () { WORKBENCH._pullStats(); }, 5 * 60 * 1000);
    }
    this._render();
  },

  _pullStats: function () {
    var self = this;
    fetch('/api/intel/stats').then(function (r) { return r.json(); }).then(function (d) { self._stats = d; self._renderIndexBar(); }).catch(function () {});
  },

  /* 预警数据推送 → 指数卡/研判/盯防/威胁/情报流/地图热区六处同步刷新（150ms 防抖合并批量推送） */
  _onAlerts: function () {
    var self = this;
    if (this._onAlertsT) return;
    this._onAlertsT = setTimeout(function () {
      self._onAlertsT = null;
      if (!self._inited) return;
      self._computeV4();
      self._renderIndexBar();
      self._renderJudge();
      self._renderWatch();
      self._renderThreat();
      self._renderFeed();
      self._refreshLayers();
    }, 150);
  },

  _render: function () {
    var host = document.getElementById('workbench-content');
    if (!host) return;
    var self = this;
    var ws = this.WORKSPACES.filter(function (w) { return w.key === self._ws; })[0] || this.WORKSPACES[0];
    this._computeV4();
    var hN = this._hours === 168 ? '7 天' : this._hours + ' 小时';
    var mapH = this._mapFocus ? 680 : 560;

    var html = '';
    /* 编排工具条：时间窗 × 面板 × 观测方案 × 满宽（WorldMonitor 信息编排自由） */
    html += '<div class="card" style="margin-bottom:12px">' + this._toolbarHTML() + '</div>';

    /* 指数卡（面板可关） */
    if (this._panels.ix) html += '<div class="card" id="wb-ixcard" style="margin-bottom:12px">' + this._indexHTML() + '</div>';

    /* v4 态势研判条（等级+环比+自动研判+异动行；面板可关） */
    if (this._panels.judge) html += '<div class="card" id="wb-judgecard" style="margin-bottom:12px">' + this._judgeHTML() + '</div>';

    /* v4 盯防 Top5 + 受威胁项目联动（左右双栏；满宽模式隐藏） */
    if (this._panels.watch && !this._mapFocus) {
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch;margin-bottom:12px">' +
        '<div class="card" id="wb-watchcard" style="flex:1;min-width:300px"></div>' +
        '<div class="card" id="wb-threatcard" style="flex:1;min-width:300px"></div></div>';
    }

    /* 工作区 tab（面板可关；满宽模式隐藏） */
    if (this._panels.ws && !this._mapFocus) {
      html += '<div class="card" style="margin-bottom:12px"><div class="card-tt"><span class="ic">🧭</span>任务工作区 — 场景切换自动联动地图图层</div><div class="dc-tabs" id="wb-ws-tabs" style="margin-bottom:0">';
      this.WORKSPACES.forEach(function (w) {
        html += '<span class="dc-tab' + (w.key === self._ws ? ' active' : '') + '" data-ws="' + w.key + '" style="cursor:pointer">' + w.icon + ' ' + w.label + '</span>';
      });
      html += '</div></div>';
    }

    /* 主体：左图层栏 + 中地图 + 右情报流 */
    html += '<div style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap">';
    /* 左：图层控制（满宽模式保留——图层勾选是地图观测核心） */
    html += '<div class="card" style="flex:0 0 200px;min-width:200px' + (this._mapFocus ? ';align-self:flex-start' : '') + '"><div class="card-tt"><span class="ic">🗺</span>地图图层 <span id="wb-lcnt" style="font-weight:400;font-size:11px;color:var(--text3)"></span></div><div id="wb-layers">';
    this.MAP_LAYERS.forEach(function (d) {
      html += '<div class="wb-lrow" data-lk="' + d.key + '"><span style="width:16px;text-align:center">' + d.em + '</span>' +
        '<label style="flex:1;cursor:pointer;display:flex;align-items:center;gap:6px;margin:0">' +
        '<input type="checkbox" data-layer="' + d.key + '"' + (self._layers[d.key] ? ' checked' : '') + ' style="accent-color:var(--cyan)"><span>' + d.name + '</span></label>' +
        '<button class="wb-info" data-exp="' + d.key + '" title="数据来源/时效/置信度">i</button></div>' +
        '<div style="font-size:10px;color:var(--text3);padding:0 0 4px 24px;margin-top:-3px">' + d.desc + '</div>';
    });
    html += '</div><div style="font-size:10.5px;color:var(--text3);margin-top:10px;line-height:1.7">勾选 = 地图标记层显示/隐藏<br>「i」= 图层数据链三段论</div></div>';

    /* 中：真实地图（满宽模式独占横向空间） */
    html += '<div class="card" style="flex:1;min-width:' + (this._mapFocus ? 520 : 420) + 'px;padding:8px"><div id="wb-map" style="height:' + mapH + 'px;border-radius:8px;overflow:hidden;background:var(--bg2)"></div>' +
      '<div style="font-size:10.5px;color:var(--text3);margin-top:6px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">' +
      '<span>底图：天地图卫星影像（服务端中转，密钥不出服务端）</span>' +
      '<span>● <span style="color:#ff3355">红</span> / <span style="color:#ff8800">橙</span> / <span style="color:#ffcc00">黄</span> 预警热区</span>' +
      '<span>⚓ 咽喉 ▲ 项目</span><span>时间窗 ' + hN + '</span><span id="wb-mapstat"></span></div></div>';

    /* 右：情报流（面板可关；满宽模式隐藏） */
    if (this._panels.feed && !this._mapFocus) {
      html += '<div class="card" style="flex:0 0 300px;min-width:300px;display:flex;flex-direction:column">' + this._feedHTML() + '</div>';
    }
    html += '</div>';

    host.innerHTML = html;

    /* v4 盯防/项目威胁卡片内容（容器已建，填充内容+绑点击联动） */
    this._renderWatch();
    this._renderThreat();
    this._bindAnom();
    /* 地图初始化（首次）或重挂（innerHTML 重建后 DOM 换了，需重建地图） */
    this._initMap();
    this._refreshLayers();
    this._bind();
  },

  /* 情报流 HTML（_render 与订阅推送刷新共用，保证 DataHub 更新后 feed 不陈旧） */
  _feedHTML: function () {
    var self = this;
    var hN = this._hours === 168 ? '7 天' : this._hours + ' 小时';
    var html = '<div class="card-tt"><span class="ic">📡</span>实时情报流<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3)">' + hN + ' · 核心置顶</span></div><div style="flex:1;max-height:560px;overflow-y:auto" id="wb-feed">';
    var winMs = this._hours * 3600 * 1000;
    var list = this._alerts().filter(function (a) {
      var t = Date.parse(String((a && a.time) || '').replace(' ', 'T'));
      return a && (!isNaN(t) ? (Date.now() - t <= winMs) : false);
    });
    var feed = list.slice().sort(function (x, y) {
      var cx = x.is_core ? 1 : 0, cy = y.is_core ? 1 : 0;
      if (cx !== cy) return cy - cx;
      return Date.parse(String(y.time || '').replace(' ', 'T')) - Date.parse(String(x.time || '').replace(' ', 'T'));
    }).slice(0, 40);
    if (feed.length) {
      feed.forEach(function (a) {
        html += '<div class="wb-feed" data-url="' + self._esc(a.url || '') + '">' +
          '<span style="width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0;background:' + self._lvHex(a.level) + '"></span>' +
          '<div style="min-width:0;flex:1"><div style="font-size:12px;color:var(--text);line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' +
          (a.is_core ? '<span style="color:var(--orange)">★核心</span> ' : '') + self._esc(a.title_zh || a.title || '') + '</div>' +
          '<div style="font-size:10.5px;color:var(--text3);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<span>' + self._esc(a.source || '实时监测引擎') + '</span>' +
          (a.country ? '<span style="color:var(--cyan)">' + self._esc(a.country) + '</span>' : '') + '<span>' + self._ago(a) + '</span></div></div></div>';
      });
    } else {
      html += '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">近 ' + hN + ' 无预警数据</div>';
    }
    html += '</div>';
    return html;
  },

  /* 订阅推送刷新情报流（feed 容器不存在=面板关闭/满宽，安全跳过） */
  _renderFeed: function () {
    var host = document.getElementById('wb-feed');
    if (!host) return;
    var outer = host.closest('.card');
    if (!outer) return;
    outer.innerHTML = this._feedHTML();
    this._bindFeed();
  },

  /* ── 编排工具条：时间窗 / 面板开关 / 观测方案 / 满宽地图 ── */
  _toolbarHTML: function () {
    var self = this;
    var hs = [6, 24, 48, 168];
    var hNames = { 6: '6小时', 24: '24小时·值班口径', 48: '48小时', 168: '7天' };
    var html = '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:2px 0">';
    /* 时间窗 */
    html += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text3)">⏱ 时间窗</span>';
    hs.forEach(function (h) {
      html += '<span class="dc-tab wb-tbtn' + (self._hours === h ? ' active' : '') + '" data-h="' + h + '" style="cursor:pointer;font-size:11px">' + hNames[h] + '</span>';
    });
    html += '</div>';
    /* 面板开关（点击即开/关：指数卡/研判/盯防/工作区/情报流） */
    var pn = { ix: '📈 指数卡', judge: '🧠 研判', watch: '🎯 盯防+项目', ws: '🧭 工作区', feed: '📡 情报流' };
    html += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text3)">🧩 面板</span>';
    Object.keys(pn).forEach(function (k) {
      html += '<span class="dc-tab wb-pbtn' + (self._panels[k] ? ' active' : '') + '" data-p="' + k + '" style="cursor:pointer;font-size:11px;opacity:' + (self._panels[k] ? 1 : .45) + '" title="点击开/关该面板">' + pn[k] + '</span>';
    });
    html += '</div>';
    /* 观测方案：保存/应用/删除自定义组合 */
    var profiles = this._profiles(), pnames = Object.keys(profiles);
    html += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text3)">📐 观测方案</span>' +
      '<select id="wb-prof" style="background:var(--bg2);color:var(--text);border:1px solid var(--border2);border-radius:4px;font-size:11px;padding:2px 5px;max-width:130px"><option value="">— 选择 —</option>';
    pnames.forEach(function (n) { html += '<option value="' + self._esc(n) + '">' + self._esc(n) + '</option>'; });
    html += '</select>' +
      '<button class="dc-tab" id="wb-prof-save" style="cursor:pointer;font-size:11px" title="把当前 时间窗+图层+面板 组合存为方案">💾 保存当前</button>' +
      '<button class="dc-tab" id="wb-prof-del" style="cursor:pointer;font-size:11px;opacity:' + (pnames.length ? 1 : .4) + '">🗑 删除</button></div>';
    /* 满宽地图 */
    html += '<span class="dc-tab wb-mfocus' + (this._mapFocus ? ' active' : '') + '" style="cursor:pointer;font-size:11px;margin-left:auto" title="隐藏工作区/情报流，地图占满">⛶ 满宽地图</span>';
    html += '</div>';
    return html;
  },

  /* ============================================================
   * v4 面板渲染：态势研判条 / 盯防+异动 / 受威胁项目
   * ============================================================ */
  _judgeHTML: function () {
    var ix = this._ix;
    if (!ix || !this._trend) return '';
    var trend = this._trend;
    var anom = this._anomList || [];
    var watch = this._watch || [];
    var up = trend.dPct > 15, down = trend.dPct < -15;
    var arrow = up ? '▲' : down ? '▼' : '▬';
    var aCol = up ? 'var(--red)' : down ? 'var(--green)' : 'var(--text2)';
    var html = '<div class="card-tt"><span class="ic">🧠</span>态势研判<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3)">等级·环比·异动·盯防建议 · 全真实预警计算</span></div>';
    /* 研判主行：等级 + 环比箭头 + 一句话研判 */
    html += '<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:2px 0 6px">';
    html += '<div style="flex-shrink:0;text-align:center;padding:6px 14px;border:1px solid ' + ix.grade.c + '33;border-radius:8px;background:' + ix.grade.c + '0d">' +
      '<div style="font-size:10px;color:var(--text3);letter-spacing:2px">综合等级</div>' +
      '<div style="font-size:19px;font-weight:700;color:' + ix.grade.c + '">' + ix.grade.t + '</div></div>';
    html += '<div style="flex-shrink:0;text-align:center;padding:6px 14px;border:1px solid var(--border2);border-radius:8px">' +
      '<div style="font-size:10px;color:var(--text3);letter-spacing:2px">环比（加权分）</div>' +
      '<div style="font-size:19px;font-weight:700;color:' + aCol + '">' + arrow + ' ' + (this._trend.dPct >= 0 ? '+' : '') + this._trend.dPct + '%</div>' +
      '<div style="font-size:10px;color:var(--text3)">前窗 ' + trend.prev.n + ' → 今窗 ' + trend.cur.n + ' 条</div></div>';
    /* 自动研判文字 */
    var jt = this.judgeText(ix, this._trend, anom, watch);
    html += '<div style="flex:1;min-width:260px;font-size:12.5px;color:var(--text);line-height:1.8;padding:4px 2px">' +
      '<span style="color:var(--cyan);font-weight:700">值班研判：</span>' + this._esc(jt) + '</div>';
    html += '</div>';
    /* 异动行（无则省略） */
    if (anom.length) {
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
        '<span style="font-size:11px;color:var(--text3);align-self:center">⚠ 异动检测</span>';
      var self = this;
      anom.forEach(function (a) {
        html += '<span class="wb-anom" data-anom="' + self._esc(a.country) + '" style="font-size:11px;padding:3px 9px;border:1px solid var(--orange)55;border-radius:4px;background:var(--orange)0d;color:var(--text);cursor:pointer" title="当前' + a.n + '条 vs 基线日均' + a.dayAvg + '条">' +
          '⚠ ' + self._esc(a.country) + ' <b style="color:var(--orange)">' + a.ratio + '×</b></span>';
      });
      html += '<span style="font-size:10px;color:var(--text3);align-self:center">速率=当前窗日均÷前7天基线，≥2× 标异动</span></div>';
    }
    return html;
  },

  _renderJudge: function () {
    var host = document.getElementById('wb-judgecard');
    if (!host) return;
    host.innerHTML = this._judgeHTML();
    this._bindAnom();
  },

  _watchHTML: function () {
    var rows = this._watch || [];
    var anom = this._anomList || [];
    var hN = this._hours === 168 ? '7 天' : this._hours + ' 小时';
    var html = '<div class="card-tt"><span class="ic">🎯</span>重点盯防 Top5<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3)">量×级别×涉华×项目×异动 · ' + hN + '</span></div>';
    if (!rows.length) { return html + '<div style="padding:14px;color:var(--text3);font-size:12px">当前窗口无高威胁国家</div>'; }
    var self = this;
    rows.forEach(function (r, i) {
      var col = i === 0 ? 'var(--red)' : i < 3 ? 'var(--orange)' : 'var(--yellow)';
      /* 盯防理由：数据构成拼接 */
      var rs = [];
      if (r.red) rs.push('红' + r.red); if (r.orange) rs.push('橙' + r.orange); if (r.yellow) rs.push('黄' + r.yellow);
      if (!rs.length) rs.push('预警' + r.n + '条');
      if (r.cn) rs.push('涉华' + r.cn);
      if (r.core) rs.push('核心' + r.core);
      if (r.proj) rs.push('项目' + r.proj + '个');
      if (r.anom) rs.push('超基线' + r.anom.ratio + '×');
      html += '<div class="wb-watch" data-wc="' + self._esc(r.country) + '">' +
        '<span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;border:1.5px solid ' + col + ';color:' + col + ';font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">' + (i + 1) + '</span>' +
        '<div style="min-width:0;flex:1"><div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:13.5px;font-weight:700;color:var(--text)">' + self._esc(r.country) + '</span>' +
        '<span style="font-size:10.5px;color:var(--text2)">' + rs.join(' · ') + '</span>' +
        (r.anom ? '<span style="font-size:10.5px;color:var(--orange);font-weight:700">⚠异动</span>' : '') + '</div>' +
        '<div style="height:4px;background:var(--bg2);border-radius:2px;margin-top:4px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(6, Math.min(100, r.score / (rows[0].score || 1) * 100)) + '%;background:' + col + '"></span></div></div>' +
        '<span style="flex-shrink:0;font-size:12px;color:' + col + ';font-weight:700;min-width:38px;text-align:right">' + r.score + '</span></div>';
    });
    return html;
  },

  _renderWatch: function () {
    var host = document.getElementById('wb-watchcard');
    if (!host) return;
    host.innerHTML = this._watchHTML();
    this._bindWatch();
  },

  _threatHTML: function () {
    var rows = this._threat || [];
    var hN = this._hours === 168 ? '7 天' : this._hours + ' 小时';
    var html = '<div class="card-tt"><span class="ic">🏗</span>受威胁项目联动<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3)">项目档案×所在国预警 · ' + hN + '</span></div>';
    if (!rows.length) { return html + '<div style="padding:14px;color:var(--text3);font-size:12px">当前窗口项目所在国无预警（安全窗口）</div>'; }
    var self = this;
    rows.forEach(function (r) {
      var col = r.red ? 'var(--red)' : r.orange ? 'var(--orange)' : 'var(--yellow)';
      html += '<div class="wb-threat" data-wc="' + self._esc(r.country) + '">' +
        '<span style="flex-shrink:0;width:10px;height:10px;border-radius:2px;background:var(--cyan);transform:rotate(45deg);margin-top:5px;box-shadow:0 0 6px rgba(0,212,255,.5)"></span>' +
        '<div style="min-width:0;flex:1"><div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:13px;font-weight:700;color:var(--text)">' + self._esc(r.proj) + '</span>' +
        '<span style="font-size:10.5px;color:var(--text2)">' + self._esc(r.country) + ' · ' + self._esc(r.ent) + (r.inv ? ' · 投资' + self._esc(r.inv) + '亿' : '') + '</span>' +
        (r.core ? '<span style="font-size:10px;color:var(--orange);font-weight:700">★核心</span>' : '') + '</div>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical">' + self._esc(String(r.topTitle).slice(0, 60)) + '</div></div>' +
        '<span style="flex-shrink:0;font-size:11px;color:' + col + ';font-weight:700;min-width:56px;text-align:right">预警' + r.n + (r.red ? '·红' + r.red : '') + '</span></div>';
    });
    return html;
  },

  _renderThreat: function () {
    var host = document.getElementById('wb-threatcard');
    if (!host) return;
    host.innerHTML = this._threatHTML();
    this._bindWatch();
  },

  /* v4 数据重算（渲染/订阅推送共用） */
  _computeV4: function () {
    var alerts = this._alerts();
    this._ix = this.computeIndex(alerts, this._hours);
    this._trend = this.computeTrend(alerts, this._hours);
    this._anomList = this.computeAnomalies(alerts, this._hours);
    this._watch = this.computeWatchlist(alerts, this._hours);
    this._threat = this.computeThreatProjects(alerts, this._hours);
  },

  /* 异动/盯防/项目行点击 → 拉地图到该国（联动） */
  _bindAnom: function () {
    var self = this;
    Array.prototype.forEach.call(document.querySelectorAll('.wb-anom[data-anom]'), function (el) {
      el.onclick = function () { self._flyToCountry(el.getAttribute('data-anom')); };
    });
  },
  _bindWatch: function () {
    var self = this;
    Array.prototype.forEach.call(document.querySelectorAll('.wb-watch[data-wc],.wb-threat[data-wc]'), function (el) {
      el.onclick = function () { self._flyToCountry(el.getAttribute('data-wc')); };
    });
  },
  _flyToCountry: function (name) {
    if (!this._map || !name) return;
    var c = this._findCountry(name);
    if (!c || c.lat == null) return;
    this._map.flyTo([c.lat, c.lon], 5, { duration: 1.2 });
  },
  _initMap: function () {
    var el = document.getElementById('wb-map');
    if (!el) return;
    if (typeof L === 'undefined') { el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Leaflet 未加载</div>'; return; }
    try {
      /* 视野恢复：上次保存的 center/zoom（无则默认全球视图） */
      var center = [25, 40], zoom = 2.4;
      if (this._savedView && this._savedView.center && this._savedView.center.lat != null) {
        center = [this._savedView.center.lat, this._savedView.center.lng];
        zoom = this._savedView.zoom || 2.4;
      }
      this._map = L.map(el, { center: center, zoom: zoom, minZoom: 2, maxZoom: 12, worldCopyJump: true, zoomControl: true, attributionControl: false });
      if (typeof TDT_BASEMAP !== 'undefined') {
        TDT_BASEMAP.addTo(this._map, 'sat');
      } else if (typeof LOCAL_BASEMAP !== 'undefined') {
        LOCAL_BASEMAP.addTo(this._map);
      }
      /* 视野变化即存（moveend 在拖拽/缩放结束后触发一次，不刷屏） */
      this._map.on('moveend', function () { WORKBENCH._saveState(); });
      setTimeout(function () { if (WORKBENCH._map) WORKBENCH._map.invalidateSize(); }, 300);
    } catch (e) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--orange)">地图初始化失败：' + this._esc(e.message) + '</div>';
    }
  },

  /* 重建全部标记层（按勾选状态） */
  _refreshLayers: function () {
    var self = this;
    if (!this._map) return;
    /* 清旧 */
    Object.keys(this._lg).forEach(function (k) { try { self._map.removeLayer(self._lg[k]); } catch (e) {} });
    this._lg = {};
    var counts = {};

    /* L1 预警热区（时间窗跟随顶栏选择） */
    if (this._layers.alerts) {
      var lg = L.layerGroup();
      var now = Date.now();
      var winMs = this._hours * 3600 * 1000;
      var byCty = {};
      this._alerts().forEach(function (a) {
        if (!a || !a.time) return;
        var t = Date.parse(String(a.time).replace(' ', 'T'));
        if (isNaN(t) || now - t > winMs) return;
        var k = a.country || '';
        if (!k) return;
        byCty[k] = byCty[k] || { n: 0, red: 0, orange: 0, yellow: 0, core: 0, items: [] };
        var b = byCty[k];
        b.n++;
        if (a.level === 'red') b.red++;
        else if (a.level === 'orange') b.orange++;
        else if (a.level === 'yellow') b.yellow++;
        if (a.is_core) b.core++;
        b.items.push(a);
      });
      var ctyN = 0;
      Object.keys(byCty).forEach(function (k) {
        var c = self._findCountry(k);
        if (!c || c.lon == null || c.lat == null) return;
        ctyN++;
        var b = byCty[k];
        var topLv = b.red ? 'red' : (b.orange ? 'orange' : (b.yellow ? 'yellow' : 'blue'));
        var hex = self._lvHex(topLv === 'blue' ? null : topLv);
        var radius = Math.min(46, 10 + Math.sqrt(b.n) * 5);
        var rows = b.items.slice().sort(function (x, y) {
          var cx = x.is_core ? 1 : 0, cy = y.is_core ? 1 : 0;
          if (cx !== cy) return cy - cx;
          return Date.parse(String(y.time || '').replace(' ', 'T')) - Date.parse(String(x.time || '').replace(' ', 'T'));
        }).slice(0, 5).map(function (a) {
          return '<div style="font-size:11px;color:#c9d4e0;padding:2px 0;border-bottom:1px solid #1e2a3a">' +
            (a.is_core ? '<b style="color:#ff8800">★</b> ' : '') + self._esc(String(a.title_zh || a.title || '').slice(0, 46)) +
            '<span style="color:#5a7a9a"> · ' + self._ago(a) + '</span></div>';
        }).join('');
        L.circleMarker([c.lat, c.lon], {
          radius: radius, color: hex, weight: 2, fillColor: hex, fillOpacity: 0.25
        }).bindPopup(
          '<div style="max-width:260px"><b style="font-size:13px">' + self._esc(k) + ' · 预警热区</b>' +
          '<div style="font-size:11px;color:#5a7a9a;margin:3px 0">近' + self._hours + 'h ' + b.n + ' 条（红' + b.red + ' 橙' + b.orange + ' 黄' + b.yellow + '）' + (b.core ? ' <span style="color:#ff8800">核心区 ' + b.core + '</span>' : '') + '</div>' + rows +
          '<div style="font-size:10px;color:#4a5a70;margin-top:4px">数据：DataHub 真实预警</div></div>'
        ).addTo(lg);
      });
      this._lg.alerts = lg; lg.addTo(this._map);
      counts.alerts = ctyN + ' 国热区';
    }

    /* L2 重点项目 */
    if (this._layers.project) {
      var lg2 = L.layerGroup();
      var seen = {}, pn = 0;
      this._enterprises().forEach(function (ent) {
        (ent.projects || []).forEach(function (p) {
          var key = self._norm(p.n);
          if (seen[key]) return; seen[key] = 1;
          var c = self._findCountry(p.c);
          if (!c || c.lon == null) return;
          pn++;
          var jitter = (pn % 3 - 1) * 2.2; /* 同国多项目微偏移防重叠 */
          L.marker([c.lat + jitter * 0.8, c.lon + jitter], {
            icon: L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#00d4ff;border:2px solid #0a7ab8;border-radius:3px;transform:rotate(45deg);box-shadow:0 0 6px rgba(0,212,255,.5)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
          }).bindPopup(
            '<div style="max-width:240px"><b style="font-size:13px">🏗 ' + self._esc(p.n) + '</b>' +
            '<div style="font-size:11px;color:#5a7a9a;margin:3px 0">' + self._esc(p.c) + ' · ' + self._esc(ent.short || ent.name || '') + '</div>' +
            (p.inv ? '<div style="font-size:11px">投资 ' + self._esc(p.inv) + ' 亿美元 · 常驻 ' + self._esc(p.p || '-') + ' 人</div>' : '') +
            '<div style="font-size:10px;color:#4a5a70;margin-top:4px">数据：企业项目档案</div></div>'
          ).addTo(lg2);
        });
      });
      this._lg.project = lg2; lg2.addTo(this._map);
      counts.project = pn + ' 个项目';
    }

    /* L3 海上咽喉 */
    if (this._layers.strait) {
      var lg3 = L.layerGroup();
      var sn = 0;
      this._chokepoints().forEach(function (s) {
        var pos = self.STRAIT_POS[s.name];
        if (!pos) return;
        sn++;
        var col = s.risk >= 9 ? '#ff3355' : s.risk >= 7 ? '#ff8800' : s.risk >= 5 ? '#ffcc00' : '#00d4ff';
        L.circleMarker(pos, {
          radius: 13, color: col, weight: 3, fillColor: col, fillOpacity: 0.4
        }).bindPopup(
          '<div style="max-width:260px"><b style="font-size:13px">⚓ ' + self._esc(s.name) + ' · 风险 ' + self._esc(s.risk) + '（' + self._esc(s.level) + '）</b>' +
          '<div style="font-size:11px;color:#c9d4e0;margin:4px 0;line-height:1.6">' + self._esc(s.desc) + '</div>' +
          '<div style="font-size:11px;color:#ff8800">影响：' + self._esc(s.impact) + '</div>' +
          (s.ents ? '<div style="font-size:10px;color:#5a7a9a;margin-top:3px">关联企业：' + self._esc(s.ents.join('、')) + '</div>' : '') + '</div>'
        ).addTo(lg3);
        L.marker(pos, {
          icon: L.divIcon({ className: '', html: '<div style="font-size:12px;text-shadow:0 0 3px #000,0 0 3px #000">⚓</div>', iconSize: [14, 14], iconAnchor: [7, -10] }),
          interactive: false
        }).addTo(lg3);
      });
      this._lg.strait = lg3; lg3.addTo(this._map);
      counts.strait = sn + ' 个咽喉';
    }

    /* L4 高风险国家 */
    if (this._layers.risk) {
      var lg4 = L.layerGroup();
      var rn = 0;
      this._countries().forEach(function (c) {
        var sec = c.scores && c.scores.security;
        if (sec == null || sec < 7 || c.lon == null) return;
        rn++;
        L.circleMarker([c.lat, c.lon], {
          radius: 22, color: '#ff3355', weight: 1.5, fillColor: '#ff3355', fillOpacity: 0.06, dashArray: '4 4'
        }).bindPopup(
          '<div style="max-width:240px"><b style="font-size:13px">⚠ ' + self._esc(c.name) + ' · 公共安全 ' + sec + '/10</b>' +
          '<div style="font-size:11px;color:#5a7a9a;margin:3px 0">主要风险：' + self._esc(c.mainRisk || '-') + '</div>' +
          '<div style="font-size:10px;color:#4a5a70">数据：国别风险档案（蓝皮书口径）</div></div>'
        ).addTo(lg4);
      });
      this._lg.risk = lg4; lg4.addTo(this._map);
      counts.risk = rn + ' 个高风险国';
    }

    /* L5 风险走廊 */
    if (this._layers.corridor) {
      var lg5 = L.layerGroup();
      var cn = 0;
      this._corridors().forEach(function (cor) {
        var parts = String(cor.countries || '').split(/[、,，]/);
        var pts = [];
        parts.forEach(function (p) {
          var c = self._findCountry(String(p).trim());
          if (c && c.lon != null) pts.push([c.lat, c.lon]);
        });
        if (!pts.length) return;
        cn++;
        var col = cor.status === '受阻' ? '#ff3355' : cor.status === '部分受阻' ? '#ff8800' : '#00ff9f';
        if (pts.length > 1) {
          L.polyline(pts, { color: col, weight: 2.5, opacity: 0.65, dashArray: '8 6' }).addTo(lg5);
        }
        L.marker(pts[0], {
          icon: L.divIcon({ className: '', html: '<div style="font-size:11px;color:' + col + ';text-shadow:0 0 3px #000,0 0 3px #000;white-space:nowrap">' + self._esc(String(cor.name).slice(0, 10)) + '</div>', iconSize: [10, 10], iconAnchor: [5, 15] }),
          interactive: false
        }).addTo(lg5);
      });
      this._lg.corridor = lg5; lg5.addTo(this._map);
      counts.corridor = cn + ' 条走廊';
    }

    /* 图层计数与统计 */
    var on = 0, all = 0;
    this.MAP_LAYERS.forEach(function (d) { all++; if (self._layers[d.key]) on++; });
    var lc = document.getElementById('wb-lcnt');
    if (lc) lc.textContent = on + '/' + all;
    var ms = document.getElementById('wb-mapstat');
    if (ms) ms.textContent = Object.keys(counts).map(function (k) { return counts[k]; }).join(' · ');
  },

  /* ============================================================
   * 指数卡 / 弹层 / 绑定
   * ============================================================ */
  _indexHTML: function () {
    var ix = this._ix;
    if (!ix) return '';
    var hN = this._hours === 168 ? '7 天' : this._hours + ' 小时';
    var pct = Math.min(100, ix.idx);
    var html = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<div><div style="font-size:11px;color:var(--text3);letter-spacing:1px">海外利益安全指数 · 近 ' + hN + ' 真实预警加权</div>' +
      '<div style="font-size:24px;font-weight:700;color:' + ix.grade.c + ';margin-top:2px">' + ix.grade.t + ' <span style="font-size:15px">' + ix.idx + '</span></div></div>' +
      '<div style="flex:1;min-width:180px"><div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--bg2)">' +
      '<span style="width:' + pct + '%;background:linear-gradient(90deg,var(--cyan),' + ix.grade.c + ');transition:width .6s"></span></div>' +
      '<div style="display:flex;gap:14px;font-size:11px;color:var(--text2);margin-top:6px;flex-wrap:wrap">' +
      '<span>预警 ' + ix.n + ' 条</span><span style="color:var(--orange)">核心区 ' + ix.coreN + '</span><span>涉华 ' + ix.cnN + '</span>' +
      (ix.lv.red ? '<span style="color:var(--red)">红 ' + ix.lv.red + '</span>' : '') +
      (ix.lv.orange ? '<span style="color:var(--orange)">橙 ' + ix.lv.orange + '</span>' : '') +
      (ix.lv.yellow ? '<span style="color:var(--yellow)">黄 ' + ix.lv.yellow + '</span>' : '') +
      '</div></div><button class="dc-tab" id="wb-ixbtn" style="cursor:pointer">构成明细</button></div>';
    if (this._stats) {
      html += '<div style="font-size:10.5px;color:var(--text3);margin-top:8px">底数：情报库总量 ' + (this._stats.total || 0) + ' 条 · 今日入库 ' + (this._stats.today || 0) + ' 条 · 涉华 ' + (this._stats.chinaTotal || 0) + ' 条</div>';
    }
    return html;
  },

  _renderIndexBar: function () {
    var card = document.getElementById('wb-ixcard');
    if (!card || !this._ix) return;
    card.innerHTML = this._indexHTML();
    this._bindIndex();
  },

  _bind: function () {
    var self = this;
    /* ── 编排工具条：时间窗切换（贯穿指数/热区/情报流） ── */
    Array.prototype.forEach.call(document.querySelectorAll('.wb-tbtn[data-h]'), function (el) {
      el.onclick = function () {
        self._hours = parseInt(el.getAttribute('data-h'), 10);
        self._saveState();
        self._render();  /* 指数卡/热区/情报流全量重算 */
      };
    });
    /* ── 面板开/关（指数卡/工作区/情报流） ── */
    Array.prototype.forEach.call(document.querySelectorAll('.wb-pbtn[data-p]'), function (el) {
      el.onclick = function () {
        var k = el.getAttribute('data-p');
        self._panels[k] = !self._panels[k];
        self._saveState();
        self._render();
      };
    });
    /* ── 满宽地图 ── */
    var mf = document.querySelector('.wb-mfocus');
    if (mf) mf.onclick = function () {
      self._mapFocus = !self._mapFocus;
      self._saveState();
      self._render();
    };
    /* ── 观测方案：应用/保存/删除 ── */
    var sel = document.getElementById('wb-prof');
    if (sel) sel.onchange = function () {
      if (sel.value) { self._applyProfile(sel.value); self._saveState(); }
    };
    var sb = document.getElementById('wb-prof-save');
    if (sb) sb.onclick = function () {
      var n = (prompt('观测方案名称（保存当前 时间窗+图层+工作区+面板 组合）：') || '').trim();
      if (n) { self._saveProfile(n); self._render(); }
    };
    var db = document.getElementById('wb-prof-del');
    if (db) db.onclick = function () {
      var s = document.getElementById('wb-prof');
      if (s && s.value && confirm('删除方案「' + s.value + '」？')) { self._delProfile(s.value); self._render(); }
    };
    /* ── 工作区切换 → 图层组合联动 ── */
    Array.prototype.forEach.call(document.querySelectorAll('#wb-ws-tabs .dc-tab[data-ws]'), function (el) {
      el.onclick = function () {
        var k = el.getAttribute('data-ws');
        self._ws = k;
        var ws = self.WORKSPACES.filter(function (w) { return w.key === k; })[0];
        self.MAP_LAYERS.forEach(function (d) { self._layers[d.key] = ws.layers.indexOf(d.key) >= 0; });
        /* 更新勾选框 + 重渲 tab active */
        Array.prototype.forEach.call(document.querySelectorAll('#wb-ws-tabs .dc-tab[data-ws]'), function (t) {
          t.classList.toggle('active', t.getAttribute('data-ws') === k);
        });
        Array.prototype.forEach.call(document.querySelectorAll('#wb-layers input[data-layer]'), function (cb) {
          cb.checked = !!self._layers[cb.getAttribute('data-layer')];
        });
        self._saveState();
        self._refreshLayers();
      };
    });
    /* ── 图层勾选 → 地图标记层显示/隐藏 ── */
    Array.prototype.forEach.call(document.querySelectorAll('#wb-layers input[data-layer]'), function (cb) {
      cb.onchange = function () {
        self._layers[cb.getAttribute('data-layer')] = cb.checked;
        self._saveState();
        self._refreshLayers();
      };
    });
    /* Explain 弹层 */
    Array.prototype.forEach.call(document.querySelectorAll('.wb-info[data-exp]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        self._showExp(btn.getAttribute('data-exp'));
      };
    });
    /* 情报流 → 原文 */
    this._bindFeed();
    this._bindIndex();
  },

  _bindFeed: function () {
    Array.prototype.forEach.call(document.querySelectorAll('.wb-feed[data-url]'), function (row) {
      var u = row.getAttribute('data-url');
      if (u) row.onclick = function () { window.open(u, '_blank'); };
    });
  },

  _bindIndex: function () {
    var btn = document.getElementById('wb-ixbtn');
    if (btn) btn.onclick = this._showIx.bind(this);
  },

  _modal: function (title, bodyHTML) {
    var mask = document.createElement('div');
    mask.className = 'wb-modal-mask';
    mask.innerHTML = '<div class="wb-modal"><div class="wb-mh"><span>' + title + '</span><button class="wb-mx">×</button></div><div class="wb-mb">' + bodyHTML + '</div></div>';
    document.body.appendChild(mask);
    mask.querySelector('.wb-mx').onclick = function () { document.body.removeChild(mask); };
    mask.onclick = function (e) { if (e.target === mask) document.body.removeChild(mask); };
    return mask;
  },

  _showExp: function (key) {
    var d = this.MAP_LAYERS.filter(function (x) { return x.key === key; })[0];
    var e = this.EXP[key];
    if (!d || !e) return;
    this._modal('图层说明 · ' + d.name,
      '<div class="wb-sec"><div class="wb-sh">SOURCE · 数据来源</div><div class="wb-sv">' + e.s + '</div></div>' +
      '<div class="wb-sec"><div class="wb-sh">FRESHNESS · 时效约束</div><div class="wb-sv">' + e.f + '</div></div>' +
      '<div class="wb-sec"><div class="wb-sh">CONFIDENCE · 置信度</div><div class="wb-sv">' + e.c + '</div></div>');
  },

  _showIx: function () {
    var ix = this._ix;
    if (!ix) return;
    var hN = this._hours === 168 ? '7 天' : this._hours + ' 小时';
    var html = '<div class="wb-sec"><div class="wb-sh">当前读数</div><div class="wb-sv">' + ix.grade.t + '（' + ix.idx + '/100）——近 ' + hN + ' 真实预警 ' + ix.n + ' 条加权（核心区 ' + ix.coreN + ' · 涉华 ' + ix.cnN + '）</div></div>';
    html += '<div class="wb-sec"><div class="wb-sh">加权构成（分国家贡献，降序）</div>';
    if (ix.rows.length) {
      var max = ix.rows[0].v;
      ix.rows.forEach(function (r) {
        html += '<div class="wb-contrib"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>' + WORKBENCH._esc(r.k) + '</span><span style="color:var(--text2)">' + r.v + ' 分</span></div>' +
          '<div style="height:5px;background:var(--bg2);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(5, Math.round(r.v / max * 100)) + '%;background:var(--cyan)"></span></div></div>';
      });
    } else {
      html += '<div class="wb-sv">近 24h 无预警数据</div>';
    }
    html += '</div><div class="wb-sec"><div class="wb-sh">计算口径</div><div class="wb-sv">单条权重 = (核心区×5 : 普通×1) × (红3/橙2/黄1) × (涉华×1.5)，近 ' + hN + ' 窗口求和归一化映射五级。全部基于真实预警计算，零模拟成分。</div></div>';
    this._modal('海外利益安全指数 · 构成明细', html);
  }
};

/* ── 样式（wb- 前缀隔离） ── */
(function () {
  var st = document.createElement('style');
  st.textContent =
    '.wb-lrow{display:flex;align-items:center;gap:7px;padding:4px 4px;border-left:2px solid transparent;border-radius:3px}' +
    '.wb-lrow:hover{background:var(--blue-bg);border-left-color:var(--cyan)}' +
    '.wb-info{background:none;border:1px solid var(--border2);color:var(--text3);width:17px;height:17px;border-radius:50%;font-size:10px;font-style:italic;line-height:1;flex-shrink:0;cursor:pointer;padding:0}' +
    '.wb-info:hover{color:var(--cyan);border-color:var(--cyan)}' +
    '.wb-feed{display:flex;gap:9px;padding:7px 4px;border-bottom:1px solid var(--border);cursor:pointer}' +
    '.wb-feed:hover{background:var(--blue-bg)}' +
    '.wb-watch{display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid var(--border);cursor:pointer;border-left:2px solid transparent;border-radius:3px}' +
    '.wb-watch:hover{background:var(--blue-bg);border-left-color:var(--orange)}' +
    '.wb-threat{display:flex;align-items:flex-start;gap:9px;padding:7px 6px;border-bottom:1px solid var(--border);cursor:pointer;border-left:2px solid transparent;border-radius:3px}' +
    '.wb-threat:hover{background:var(--blue-bg);border-left-color:var(--cyan)}' +
    '.wb-anom{transition:transform .15s}' +
    '.wb-anom:hover{transform:translateY(-1px)}' +
    '.wb-modal-mask{position:fixed;inset:0;background:rgba(4,8,14,.65);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.wb-modal{width:520px;max-width:92vw;max-height:80vh;overflow-y:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.6)}' +
    '.wb-mh{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid var(--border);font-size:14px;font-weight:700;color:var(--text)}' +
    '.wb-mx{background:none;border:none;color:var(--text2);font-size:17px;cursor:pointer;line-height:1}' +
    '.wb-mb{padding:16px 18px}' +
    '.wb-sec{margin-bottom:14px}' +
    '.wb-sh{font-size:11px;letter-spacing:2px;color:var(--cyan);margin-bottom:4px;font-weight:700}' +
    '.wb-sv{font-size:12.5px;color:var(--text2);line-height:1.75}' +
    '.wb-contrib{margin-bottom:8px}' +
    '.wb-modal-mask .leaflet-popup-content-wrapper{background:#0e141d;color:#e2e8f0;border:1px solid #2a3a50;border-radius:8px}' +
    '.wb-modal-mask .leaflet-popup-tip{background:#0e141d}';
  document.head.appendChild(st);
})();
