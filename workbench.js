/* ============================================================
 * WORKBENCH 联合作业台 v2（2026-08-30 真地图图层版）
 * 中央：Leaflet 真实地图（天地图卫星底图 TDT_BASEMAP，失败回退本地矢量）
 * 图层 = 地图标记层（勾选直接 add/remove L.layerGroup，不是数据过滤）：
 *   L1 预警热区   近24h真实 ALERTS 按国家聚合，半径∝数量、色=最高级别，点击列该国预警
 *   L2 重点项目   ENTERPRISES 真实项目档案（瓜达尔港/比雷埃夫斯/汉班托塔…）落点国家坐标
 *   L3 海上咽喉   CHOKEPOINTS 8 大通道真实地理坐标，色按 risk
 *   L4 高风险国家 COUNTRIES scores.security≥7 警示圈
 *   L5 风险走廊   CORRIDORS 一带一路走廊落点
 * 其余保留 v1：任务工作区联动图层组合 / Explain 三段论 / 海外利益安全指数 / 情报流
 * 数据源：全局 ALERTS / COUNTRIES / ENTERPRISES / CHOKEPOINTS / CORRIDORS + /api/intel/stats
 * ============================================================ */
var WORKBENCH = {
  _ws: 'overall',
  _layers: {},
  _inited: false,
  _map: null,          /* Leaflet 地图实例 */
  _lg: {},             /* {图层键: L.layerGroup} */
  _stats: null,
  _ix: null,

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
    alerts: { s: 'DataHub 真实预警队列（服务端 _serverAlertGen 每 3 分钟生成，经 chinaOverseasGate + nonIntelGenre + 体裁/历史旧案/墓碑多闸门）。按预警 country 字段聚合到 COUNTRIES 国家坐标。', f: '预警生成每 3 分钟；前端 DataHub 实时订阅刷新。仅统计近 24h（值班口径铁律）。', c: '圆色=该国当前最高预警级别；半径∝预警量。点击圆看该国预警明细与原文链接。' },
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

  /* ── 安全指数：近24h真实预警加权 ── */
  computeIndex: function (alerts) {
    var now = Date.now(), win = 24 * 3600 * 1000;
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
      DataHub.subscribe(function (col) { if (col === 'alerts' || !col) WORKBENCH._refreshLayers(); });
    }
    if (!this._inited) {
      this._inited = true;
      var ws0 = this.WORKSPACES[0];
      this.MAP_LAYERS.forEach(function (d) { WORKBENCH._layers[d.key] = ws0.layers.indexOf(d.key) >= 0 || d.def; });
      this._pullStats();
      setInterval(function () { WORKBENCH._pullStats(); }, 5 * 60 * 1000);
    }
    this._render();
  },

  _pullStats: function () {
    var self = this;
    fetch('/api/intel/stats').then(function (r) { return r.json(); }).then(function (d) { self._stats = d; self._renderIndexBar(); }).catch(function () {});
  },

  _render: function () {
    var host = document.getElementById('workbench-content');
    if (!host) return;
    var self = this;
    var ws = this.WORKSPACES.filter(function (w) { return w.key === self._ws; })[0] || this.WORKSPACES[0];
    this._ix = this.computeIndex(this._alerts());

    var html = '';
    /* 指数卡 */
    html += '<div class="card" id="wb-ixcard" style="margin-bottom:12px">' + this._indexHTML() + '</div>';

    /* 工作区 tab */
    html += '<div class="card" style="margin-bottom:12px"><div class="card-tt"><span class="ic">🧭</span>任务工作区 — 场景切换自动联动地图图层</div><div class="dc-tabs" id="wb-ws-tabs" style="margin-bottom:0">';
    this.WORKSPACES.forEach(function (w) {
      html += '<span class="dc-tab' + (w.key === self._ws ? ' active' : '') + '" data-ws="' + w.key + '" style="cursor:pointer">' + w.icon + ' ' + w.label + '</span>';
    });
    html += '</div></div>';

    /* 主体：左图层栏 + 中地图 + 右情报流 */
    html += '<div style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap">';
    /* 左：图层控制 */
    html += '<div class="card" style="flex:0 0 200px;min-width:200px"><div class="card-tt"><span class="ic">🗺</span>地图图层 <span id="wb-lcnt" style="font-weight:400;font-size:11px;color:var(--text3)"></span></div><div id="wb-layers">';
    this.MAP_LAYERS.forEach(function (d) {
      html += '<div class="wb-lrow" data-lk="' + d.key + '"><span style="width:16px;text-align:center">' + d.em + '</span>' +
        '<label style="flex:1;cursor:pointer;display:flex;align-items:center;gap:6px;margin:0">' +
        '<input type="checkbox" data-layer="' + d.key + '"' + (self._layers[d.key] ? ' checked' : '') + ' style="accent-color:var(--cyan)"><span>' + d.name + '</span></label>' +
        '<button class="wb-info" data-exp="' + d.key + '" title="数据来源/时效/置信度">i</button></div>' +
        '<div style="font-size:10px;color:var(--text3);padding:0 0 4px 24px;margin-top:-3px">' + d.desc + '</div>';
    });
    html += '</div><div style="font-size:10.5px;color:var(--text3);margin-top:10px;line-height:1.7">勾选 = 地图标记层显示/隐藏<br>「i」= 图层数据链三段论</div></div>';

    /* 中：真实地图 */
    html += '<div class="card" style="flex:1;min-width:420px;padding:8px"><div id="wb-map" style="height:560px;border-radius:8px;overflow:hidden;background:var(--bg2)"></div>' +
      '<div style="font-size:10.5px;color:var(--text3);margin-top:6px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">' +
      '<span>底图：天地图卫星影像（服务端中转，密钥不出服务端）</span>' +
      '<span>● <span style="color:#ff3355">红</span> / <span style="color:#ff8800">橙</span> / <span style="color:#ffcc00">黄</span> 预警热区</span>' +
      '<span>⚓ 咽喉 ▲ 项目</span><span id="wb-mapstat"></span></div></div>';

    /* 右：情报流 */
    html += '<div class="card" style="flex:0 0 300px;min-width:300px;display:flex;flex-direction:column"><div class="card-tt"><span class="ic">📡</span>实时情报流<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3)">24h · 核心置顶</span></div><div style="flex:1;max-height:560px;overflow-y:auto" id="wb-feed">';
    var list = this._alerts().filter(function (a) {
      var t = Date.parse(String((a && a.time) || '').replace(' ', 'T'));
      return a && (!isNaN(t) ? (Date.now() - t <= 24 * 3600 * 1000) : false);
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
      html += '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">近 24h 无预警数据</div>';
    }
    html += '</div></div></div>';

    var mapExisted = !!this._map;
    host.innerHTML = html;

    /* 地图初始化（首次）或重挂（innerHTML 重建后 DOM 换了，需重建地图） */
    this._initMap();
    this._refreshLayers();
    this._bind();
  },

  /* ============================================================
   * Leaflet 地图
   * ============================================================ */
  _initMap: function () {
    var el = document.getElementById('wb-map');
    if (!el) return;
    if (typeof L === 'undefined') { el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Leaflet 未加载</div>'; return; }
    try {
      this._map = L.map(el, { center: [25, 40], zoom: 2.4, minZoom: 2, maxZoom: 12, worldCopyJump: true, zoomControl: true, attributionControl: false });
      if (typeof TDT_BASEMAP !== 'undefined') {
        TDT_BASEMAP.addTo(this._map, 'sat');
      } else if (typeof LOCAL_BASEMAP !== 'undefined') {
        LOCAL_BASEMAP.addTo(this._map);
      }
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

    /* L1 预警热区 */
    if (this._layers.alerts) {
      var lg = L.layerGroup();
      var now = Date.now();
      var byCty = {};
      this._alerts().forEach(function (a) {
        if (!a || !a.time) return;
        var t = Date.parse(String(a.time).replace(' ', 'T'));
        if (isNaN(t) || now - t > 24 * 3600 * 1000) return;
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
          '<div style="font-size:11px;color:#5a7a9a;margin:3px 0">近24h ' + b.n + ' 条（红' + b.red + ' 橙' + b.orange + ' 黄' + b.yellow + '）' + (b.core ? ' <span style="color:#ff8800">核心区 ' + b.core + '</span>' : '') + '</div>' + rows +
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
    var pct = Math.min(100, ix.idx);
    var html = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<div><div style="font-size:11px;color:var(--text3);letter-spacing:1px">海外利益安全指数 · 近 24h 真实预警加权</div>' +
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
    /* 工作区切换 → 图层组合联动 */
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
        self._refreshLayers();
      };
    });
    /* 图层勾选 → 地图标记层显示/隐藏 */
    Array.prototype.forEach.call(document.querySelectorAll('#wb-layers input[data-layer]'), function (cb) {
      cb.onchange = function () {
        self._layers[cb.getAttribute('data-layer')] = cb.checked;
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
    Array.prototype.forEach.call(document.querySelectorAll('.wb-feed[data-url]'), function (row) {
      var u = row.getAttribute('data-url');
      if (u) row.onclick = function () { window.open(u, '_blank'); };
    });
    this._bindIndex();
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
    var html = '<div class="wb-sec"><div class="wb-sh">当前读数</div><div class="wb-sv">' + ix.grade.t + '（' + ix.idx + '/100）——近 24h 真实预警 ' + ix.n + ' 条加权（核心区 ' + ix.coreN + ' · 涉华 ' + ix.cnN + '）</div></div>';
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
    html += '</div><div class="wb-sec"><div class="wb-sh">计算口径</div><div class="wb-sv">单条权重 = (核心区×5 : 普通×1) × (红3/橙2/黄1) × (涉华×1.5)，近 24h 窗口求和归一化映射五级。全部基于真实预警计算，零模拟成分。</div></div>';
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
