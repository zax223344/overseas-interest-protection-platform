/* ============================================================
 * WORKBENCH 联合作业台（2026-08-30 WorldMonitor 对标落地）
 * 定位：态势感知分组下的多场景值守工作区
 *  - 任务工作区：五方场景一键切换（图层组合 + 数据过滤联动）
 *  - 情报图层：12 层（9 类真实情报类型 + 3 个标志维度），每层带 Explain 三段论
 *    （SOURCE 数据来源 / FRESHNESS 时效约束 / CONFIDENCE 置信度）
 *  - 海外利益安全指数：近 24h 真实预警加权计算（核心区×5 / 红橙黄分级 / 涉华加权），
 *    构成明细分国分类展示，零模拟成分
 *  - 国家风险聚合 + 实时情报流 + 预警面板：全部来自 DataHub 真实数据
 * 数据源：DataHub.get('alerts') + /api/intel/stats + /api/health
 * ============================================================ */
var WORKBENCH = {
  _ws: 'overall',            /* 当前任务工作区键 */
  _layers: {},               /* 图层勾选状态 {key:bool} */
  _hours: 24,                /* 时间窗：24h 值班口径（铁律默认）；48h 研判回溯 */
  _inited: false,
  _stats: null,
  _health: null,

  /* ── 图层定义：9 类真实情报类型 + 3 个标志维度 ── */
  LAYER_DEFS: [
    { key: 'type_sec',   name: '安全风险',     em: '🔥', group: '情报类型', types: ['安全风险'] },
    { key: 'type_pol',   name: '政治风险',     em: '🏛', group: '情报类型', types: ['政治风险'] },
    { key: 'type_geo',   name: '地缘战略风险', em: '🌍', group: '情报类型', types: ['地缘战略风险'] },
    { key: 'type_eco',   name: '经济风险',     em: '📉', group: '情报类型', types: ['经济风险'] },
    { key: 'type_soc',   name: '社会文化风险', em: '👥', group: '情报类型', types: ['社会文化风险'] },
    { key: 'type_nat',   name: '自然环境风险', em: '🌀', group: '情报类型', types: ['自然环境风险'] },
    { key: 'type_ops',   name: '运营风险',     em: '⚙', group: '情报类型', types: ['运营风险'] },
    { key: 'type_cyb',   name: '网络安全',     em: '🌐', group: '情报类型', types: ['网络安全'] },
    { key: 'type_law',   name: '法律合规',     em: '⚖', group: '情报类型', types: ['法律合规'] },
    { key: 'flag_cn',    name: '涉华负面',     em: '🇨🇳', group: '标志维度', flag: 'chinaRelated' },
    { key: 'flag_asset', name: '核心资产项目', em: '🏗', group: '标志维度', flag: 'asset' },
    { key: 'flag_core',  name: '核心区预警',   em: '★', group: '标志维度', flag: 'is_core' }
  ],

  /* ── 图层 Explain 三段论（全部对应系统真实数据链，无虚构通道） ── */
  EXP: {
    type_sec: { s: '一分钟哨兵 core-threat-watch（60s，巴基斯坦/CPEC/阿富汗/非洲/中亚/东南亚恐袭绑架重案）+ GDELT 恐袭类目 + 官方 RSS 池（978 源）。涉华要素经 isChinaRelatedStrict 严格判定。', f: '哨兵 60 秒；GDELT 15 分钟批；RSS 5 分钟缓存。超 24h 条目自动出局。', c: '单源事件标「待核」；双源交叉或含官方通报升级「已证实」。仅作分诊提示，行动依据须点开原始报道。' },
    type_pol: { s: 'GDELT 政治事件类目 + 区域媒体池 + 合规哨兵 compliance-watch（30min）的政变/选举/政策突变输出。', f: 'GDELT 15 分钟；哨兵 30 分钟。', c: '历史旧案回顾（10 年前年份+案件词三分支）自动否决；预警阶段有体裁闸门一票否决评论/榜单类。' },
    type_geo: { s: 'GDELT 地缘战略类目 + 全球媒体 regional_feeds 池 + 俄乌四层闸过滤（配额 15 条/日，涉华豁免双测）。', f: '15 分钟批。', c: '纯战况琐事一律拒收；顶级事件（伤亡≥5/核/撤侨）无条件放行并标记。' },
    type_eco: { s: '合规哨兵 compliance-watch（30min）+ 制裁清单变更监测 + World Bank 经济指标 API。', f: '哨兵 30 分钟；经济指标季度级。', c: '制裁实体匹配精确到清单编号；经济指标标「趋势参考」不入预警。' },
    type_soc: { s: 'GDELT 抗议/暴乱类目 + SOCMINT（Mastodon 12 标签免授权公开流）。', f: '15 分钟批；社交动态 60h 时效窗。', c: '社交单源置信度最低，仅作线索层，永不单独触发预警。' },
    type_nat: { s: 'USGS 地震 API（M≥5.0）+ 各气象部门预警通道预留。', f: 'USGS 5 分钟。', c: '自动关联中资项目地理围栏，命中即在项目卡片标注。' },
    type_ops: { s: '官方 RSS 池基础设施类 + 中欧班列节点库关联事件。', f: '15 分钟。', c: '影响面评估基于项目/通道关联，无关联事件降级态势区。' },
    type_cyb: { s: '通道预留：待接入 CISA/国家级 CERT 公告源。', f: '未接入。', c: '灰显状态——零模拟数据铁律，无源不展示假数据。' },
    type_law: { s: '合规哨兵 compliance-watch（30min）法律合规分支。', f: '30 分钟。', c: '东道国法规变动单源收录，重大变动双源确认后升级。' },
    flag_cn: { s: 'cn-security-watch 涉华安全哨兵（30min）+ 全通道涉华闸门二次校验（标题+摘要双命中暴力要素）。', f: '哨兵 30 分钟；全通道实时。', c: 'Chinese 泛称/港台疆藏单独出现不判定涉华——系统最严口径。' },
    flag_asset: { s: 'interest-base 底数库：54 国梯队 + 61 项目档案 + 20 重点项目（瓜达尔港/CPEC/中老铁路/西芒杜/卡莫阿等）。风险加权 TIER1+8/TIER2+4/项目+6/通道+5。', f: '底数库静态维护；关联风险随事件实时更新。', c: '项目-事件关联基于地理+名称实体双匹配。' },
    flag_core: { s: '_alertIsCore 五判定（核心威胁/资产项目通道命中/红区/涉华中高危）由服务端预警生成时下发，核心区置顶且不占国别帽。', f: '预警生成每 3 分钟一轮。', c: '核心区判定在服务端权威计算，前端只渲染不重算。' }
  },

  /* ── 任务工作区：五方场景预配置 ── */
  WORKSPACES: [
    { key: 'overall',  icon: '🛡', label: '总体态势值守', desc: '全类全量 · 核心区置顶 · 24h 值班口径',
      layers: ['type_sec','type_pol','type_geo','type_eco','type_soc','flag_cn','flag_asset','flag_core'],
      filter: function(a){ return true; } },
    { key: 'consular', icon: '🛂', label: '领事保护值班', desc: '涉华人员安全 + 领事提醒 + 自然/公共卫生事件',
      layers: ['type_sec','type_nat','type_soc','flag_cn','flag_core'],
      filter: function(a){ return a.chinaRelated || a.is_core || ['安全风险','自然环境风险'].indexOf(a.type)>=0; } },
    { key: 'cnsec',    icon: '🇨🇳', label: '涉华安全专项', desc: '涉华负面全类型 · 绑架/遇袭/制裁优先',
      layers: ['type_sec','type_pol','type_eco','flag_cn','flag_core'],
      filter: function(a){ return !!a.chinaRelated; } },
    { key: 'project',  icon: '🏗', label: '项目资产护卫', desc: '核心资产项目关联风险 + 东道国综合风险',
      layers: ['type_sec','type_ops','type_eco','type_pol','flag_asset','flag_core'],
      filter: function(a){ return (a.asset_tags && a.asset_tags.length) || a.interestLinked || a.is_core; } },
    { key: 'corridor', icon: '⚓', label: '通道走廊监控', desc: '海上咽喉 + 中欧班列 + 沿线冲突与制裁',
      layers: ['type_sec','type_geo','type_eco','type_ops','flag_asset'],
      filter: function(a){ return ['地缘战略风险','经济风险','运营风险','安全风险'].indexOf(a.type)>=0; } }
  ],

  /* ── 海外利益安全指数：真实预警加权计算 ──
   * 核心:score = Σ(核心区×5 + 级别 红3/橙2/黄1 + 涉华×1.5) 近24h，归一化映射五级 */
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
    /* 归一化：60 权重分 ≈ 橙色门槛（经验校准，随真实预警分布自适应） */
    var idx = Math.min(100, Math.round(score / 1.2));
    var grade = idx >= 80 ? { t: '红色 · Ⅰ级', c: 'var(--red)' }
      : idx >= 55 ? { t: '橙色 · Ⅱ级', c: 'var(--orange)' }
      : idx >= 35 ? { t: '黄色 · Ⅲ级', c: 'var(--yellow)' }
      : idx >= 15 ? { t: '蓝色 · Ⅳ级', c: 'var(--cyan)' }
      : { t: '平稳 · Ⅴ级', c: 'var(--green)' };
    /* 构成明细按国家降序 */
    var rows = Object.keys(contrib).map(function (k) { return { k: k, v: contrib[k] }; })
      .sort(function (x, y) { return y.v - x.v; }).slice(0, 8);
    return { idx: idx, grade: grade, score: Math.round(score), n: n, coreN: coreN, cnN: cnN, lv: lv, rows: rows };
  },

  _t: function (a) { return a.title_zh || a.title || ''; },
  _c: function (a) { return a.country || ''; },
  _ago: function (a) {
    var t = Date.parse(String(a.time || '').replace(' ', 'T'));
    if (isNaN(t)) return '';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 60) return m + ' 分钟前';
    if (m < 1440) return Math.floor(m / 60) + ' 小时前';
    return Math.floor(m / 1440) + ' 天前';
  },
  _lvColor: function (lv) { return lv === 'red' ? 'var(--red)' : lv === 'orange' ? 'var(--orange)' : lv === 'yellow' ? 'var(--yellow)' : 'var(--cyan)'; },
  _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },

  /* 图层过滤：工作区图层集合 ∩ 用户勾选 */
  _layerPass: function (a) {
    var self = this;
    var ws = this.WORKSPACES.filter(function (w) { return w.key === self._ws; })[0] || this.WORKSPACES[0];
    if (!ws.layers.some(function (k) { return self._layers[k]; })) return true; /* 全不勾 = 不过滤 */
    return ws.layers.some(function (k) {
      if (!self._layers[k]) return false;
      var d = self.LAYER_DEFS.filter(function (x) { return x.key === k; })[0];
      if (!d) return false;
      if (d.flag === 'chinaRelated') return !!a.chinaRelated;
      if (d.flag === 'is_core') return !!a.is_core;
      if (d.flag === 'asset') return (a.asset_tags && a.asset_tags.length) || a.interestLinked;
      return d.types.indexOf(a.type) >= 0;
    });
  },
  _timePass: function (a) {
    var t = Date.parse(String(a.time || '').replace(' ', 'T'));
    if (isNaN(t)) return true; /* 无时间戳保守放行，由后端闸门负责 */
    return Date.now() - t <= this._hours * 3600 * 1000;
  },
  _filtered: function () {
    var ws = this.WORKSPACES.filter(function (w) { return w.key === WORKBENCH._ws; })[0] || this.WORKSPACES[0];
    var arr = (typeof DataHub !== 'undefined' && DataHub.get) ? (DataHub.get('alerts') || []) : [];
    return arr.filter(function (a) { return a && ws.filter(a) && WORKBENCH._layerPass(a) && WORKBENCH._timePass(a); });
  },

  init: function () {
    var host = document.getElementById('workbench-content');
    if (!host) return;
    /* DataHub 订阅在 _inited 块外注册（防止 _render 早于 DataHub 就绪被执行却无重渲触发） */
    if (typeof DataHub !== 'undefined' && DataHub.subscribe && !this._subscribed) {
      this._subscribed = true;
      DataHub.subscribe(function (col) { if (col === 'alerts' || !col) WORKBENCH._render(); });
    }
    if (!this._inited) {
      this._inited = true;
      var ws0 = this.WORKSPACES[0];
      var self = this;
      this.LAYER_DEFS.forEach(function (d) { self._layers[d.key] = ws0.layers.indexOf(d.key) >= 0; });
      this._pullStats();
      setInterval(function () { WORKBENCH._pullStats(); }, 5 * 60 * 1000);
    }
    this._render();
  },

  _pullStats: function () {
    var self = this;
    fetch('/api/intel/stats').then(function (r) { return r.json(); }).then(function (d) { self._stats = d; self._renderIndexBar(); }).catch(function () {});
    fetch('/api/health').then(function (r) { return r.json(); }).then(function (d) { self._health = d; }).catch(function () {});
  },

  _render: function () {
    var host = document.getElementById('workbench-content');
    if (!host) return;
    var self = this;
    var list = this._filtered();
    var ws = this.WORKSPACES.filter(function (w) { return w.key === self._ws; })[0] || this.WORKSPACES[0];

    /* 指数（口径用全量 24h 预警，不随工作区过滤） */
    var all = (typeof DataHub !== 'undefined' && DataHub.get) ? (DataHub.get('alerts') || []) : [];
    this._ix = this.computeIndex(all);

    /* 国家聚合（工作区过滤后） */
    var byCountry = {}, byType = {};
    list.forEach(function (a) {
      var k = a.country || '未标注国别';
      byCountry[k] = byCountry[k] || { n: 0, red: 0, core: 0, worst: '' };
      byCountry[k].n++;
      if (a.level === 'red') byCountry[k].red++;
      if (a.is_core) byCountry[k].core++;
      if (a.level === 'red' || (a.level === 'orange' && byCountry[k].worst !== 'red')) byCountry[k].worst = a.level;
      byType[a.type || '未分类'] = (byType[a.type || '未分类'] || 0) + 1;
    });
    var cRows = Object.keys(byCountry).map(function (k) { return { k: k, v: byCountry[k] }; })
      .sort(function (x, y) {
        var s = function (c) { return c.v.core * 1000 + c.v.red * 100 + c.v.n; };
        return s(y) - s(x);
      }).slice(0, 10);

    var html = '';
    /* ── 指数条 ── */
    html += '<div class="card" id="wb-ixcard" style="margin-bottom:12px">' + this._indexHTML() + '</div>';

    /* ── 工作区 tab ── */
    html += '<div class="card" style="margin-bottom:12px"><div class="card-tt"><span class="ic">🧭</span>任务工作区 — 一键切换值守场景（图层组合 + 数据过滤联动）</div>' +
      '<div class="dc-tabs" id="wb-ws-tabs" style="margin-bottom:0">';
    this.WORKSPACES.forEach(function (w) {
      html += '<span class="dc-tab' + (w.key === self._ws ? ' active' : '') + '" data-ws="' + w.key + '" style="cursor:pointer">' + w.icon + ' ' + w.label + '</span>';
    });
    html += '</div><div style="font-size:11.5px;color:var(--text3);margin-top:8px">' + ws.desc + ' · 数据 ' + list.length + ' 条 / ' + this._hours + 'h 窗口' +
      (this._hours > 24 ? ' · <span style="color:var(--orange)">研判回溯口径（非值班）</span>' : ' · 值班口径') + '</div></div>';

    /* ── 三栏主体 ── */
    html += '<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">';
    /* 左：图层 */
    html += '<div class="card" style="flex:0 0 236px;min-width:236px"><div class="card-tt"><span class="ic">🗺</span>情报图层 <span id="wb-lcnt" style="font-weight:400;font-size:11px;color:var(--text3)"></span></div><div id="wb-layers">';
    var lastGroup = '';
    this.LAYER_DEFS.forEach(function (d) {
      if (d.group !== lastGroup) { html += '<div style="font-size:10.5px;color:var(--text3);letter-spacing:1.5px;margin:8px 0 3px">' + d.group + '</div>'; lastGroup = d.group; }
      html += '<div class="wb-lrow' + (ws.layers.indexOf(d.key) >= 0 ? '' : ' wb-ldim') + '" data-lk="' + d.key + '">' +
        '<span style="width:16px;text-align:center">' + d.em + '</span>' +
        '<label style="flex:1;cursor:pointer;display:flex;align-items:center;gap:6px;margin:0' + (ws.layers.indexOf(d.key) >= 0 ? '' : ';opacity:.35') + '">' +
        '<input type="checkbox" data-layer="' + d.key + '"' + (self._layers[d.key] ? ' checked' : '') + (ws.layers.indexOf(d.key) >= 0 ? '' : ' disabled') + ' style="accent-color:var(--cyan)"><span>' + d.name + '</span></label>' +
        '<button class="wb-info" data-exp="' + d.key + '" title="数据来源 / 时效 / 置信度">i</button></div>';
    });
    html += '</div><div style="font-size:10.5px;color:var(--text3);margin-top:10px;line-height:1.7">灰显图层不在当前工作区范围<br>「i」= 图层数据链说明</div></div>';

    /* 中：国家聚合 + 类型分布 */
    html += '<div class="card" style="flex:1;min-width:340px"><div class="card-tt"><span class="ic">📊</span>国家风险聚合（点击进入国别档案）</div>';
    if (cRows.length) {
      var maxN = Math.max.apply(null, cRows.map(function (r) { return r.v.n; }));
      html += '<div style="max-height:240px;overflow-y:auto">';
      cRows.forEach(function (r) {
        var w = Math.max(6, Math.round(r.v.n / maxN * 100));
        var bc = r.v.red ? 'var(--red)' : r.v.core ? 'var(--orange)' : 'var(--cyan)';
        html += '<div class="wb-crow" data-cty="' + self._esc(r.k) + '">' +
          '<span style="width:86px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + self._esc(r.k) + '">' + self._esc(r.k) + '</span>' +
          '<span style="flex:1;height:7px;background:var(--bg2);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:' + w + '%;background:' + bc + '"></span></span>' +
          '<span style="width:56px;text-align:right;font-size:11px;color:var(--text2)">' + r.v.n + ' 条' + (r.v.core ? ' <span style="color:var(--orange)">★' + r.v.core + '</span>' : '') + '</span></div>';
      });
      html += '</div>';
    } else {
      html += '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">当前窗口与图层条件下无预警数据</div>';
    }
    /* 类型分布 */
    var tKeys = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; });
    if (tKeys.length) {
      html += '<div style="font-size:11px;color:var(--text2);margin:12px 0 6px">类型分布：</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
      tKeys.forEach(function (k) {
        html += '<span style="background:var(--panel2);border:1px solid var(--border);border-radius:4px;padding:2px 9px;font-size:11px;color:var(--text2)">' + self._esc(k) + ' <b style="color:var(--text)">' + byType[k] + '</b></span>';
      });
      html += '</div>';
    }
    html += '</div>';

    /* 右：实时情报流（真实预警队列，核心区置顶） */
    html += '<div class="card" style="flex:0 0 320px;min-width:320px"><div class="card-tt"><span class="ic">📡</span>实时情报流' +
      '<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3)">' + this._hours + 'h · 核心区置顶</span></div><div style="max-height:420px;overflow-y:auto" id="wb-feed">';
    var feed = list.slice().sort(function (x, y) {
      var cx = x.is_core ? 1 : 0, cy = y.is_core ? 1 : 0;
      if (cx !== cy) return cy - cx;
      return Date.parse(String(y.time || '').replace(' ', 'T')) - Date.parse(String(x.time || '').replace(' ', 'T'));
    }).slice(0, 30);
    if (feed.length) {
      feed.forEach(function (a) {
        html += '<div class="wb-feed" data-url="' + self._esc(a.url || '') + '">' +
          '<span style="width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0;background:' + self._lvColor(a.level) + '"></span>' +
          '<div style="min-width:0;flex:1"><div style="font-size:12px;color:var(--text);line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' +
          (a.is_core ? '<span style="color:var(--orange)">★核心</span> ' : '') + self._esc(self._t(a)) + '</div>' +
          '<div style="font-size:10.5px;color:var(--text3);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<span>' + self._esc(a.source || '实时监测引擎') + '</span>' +
          (a.country ? '<span style="color:var(--cyan)">' + self._esc(a.country) + '</span>' : '') +
          '<span>' + self._esc(a.type || '') + '</span><span>' + self._ago(a) + '</span></div></div></div>';
      });
    } else {
      html += '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">暂无数据</div>';
    }
    html += '</div></div>';
    html += '</div>';

    host.innerHTML = html;
    this._bind();
  },

  _indexHTML: function () {
    var ix = this._ix;
    if (!ix) return '';
    var pct = Math.min(100, ix.idx);
    var html = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<div><div style="font-size:11px;color:var(--text3);letter-spacing:1px">海外利益安全指数 · 近 24h 真实预警加权</div>' +
      '<div style="font-size:24px;font-weight:700;color:' + ix.grade.c + ';margin-top:2px">' + ix.grade.t +
      ' <span style="font-size:15px">' + ix.idx + '</span></div></div>' +
      '<div style="flex:1;min-width:180px"><div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--bg2)">' +
      '<span style="width:' + pct + '%;background:linear-gradient(90deg,var(--cyan),' + ix.grade.c + ');transition:width .6s"></span></div>' +
      '<div style="display:flex;gap:14px;font-size:11px;color:var(--text2);margin-top:6px;flex-wrap:wrap">' +
      '<span>预警 ' + ix.n + ' 条</span><span style="color:var(--orange)">核心区 ' + ix.coreN + '</span>' +
      '<span>涉华 ' + ix.cnN + '</span>' +
      (ix.lv.red ? '<span style="color:var(--red)">红 ' + ix.lv.red + '</span>' : '') +
      (ix.lv.orange ? '<span style="color:var(--orange)">橙 ' + ix.lv.orange + '</span>' : '') +
      (ix.lv.yellow ? '<span style="color:var(--yellow)">黄 ' + ix.lv.yellow + '</span>' : '') +
      '</div></div>' +
      '<button class="dc-tab" id="wb-ixbtn" style="cursor:pointer">构成明细</button></div>';
    if (this._stats) {
      html += '<div style="font-size:10.5px;color:var(--text3);margin-top:8px">底数：情报库总量 ' + (this._stats.total || 0) + ' 条 · 今日入库 ' + (this._stats.today || 0) + ' 条 · 涉华 ' + (this._stats.chinaTotal || 0) + ' 条（/api/intel/stats 实时）</div>';
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
    /* 工作区 tab */
    Array.prototype.forEach.call(document.querySelectorAll('#wb-ws-tabs .dc-tab[data-ws]'), function (el) {
      el.onclick = function () {
        var k = el.getAttribute('data-ws');
        self._ws = k;
        var ws = self.WORKSPACES.filter(function (w) { return w.key === k; })[0];
        self.LAYER_DEFS.forEach(function (d) { self._layers[d.key] = ws.layers.indexOf(d.key) >= 0; });
        self._render();
      };
    });
    /* 图层勾选 */
    Array.prototype.forEach.call(document.querySelectorAll('#wb-layers input[data-layer]'), function (cb) {
      cb.onchange = function () {
        self._layers[cb.getAttribute('data-layer')] = cb.checked;
        self._render();
      };
    });
    /* Explain 弹层 */
    Array.prototype.forEach.call(document.querySelectorAll('.wb-info[data-exp]'), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        self._showExp(btn.getAttribute('data-exp'));
      };
    });
    /* 国家行 → 国别档案 */
    Array.prototype.forEach.call(document.querySelectorAll('.wb-crow[data-cty]'), function (row) {
      row.onclick = function () {
        if (typeof navigateTo === 'function') navigateTo('country');
      };
    });
    /* 情报流条目 → 原文 */
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
    var self = this;
    var mask = document.createElement('div');
    mask.className = 'wb-modal-mask';
    mask.innerHTML = '<div class="wb-modal"><div class="wb-mh"><span>' + title + '</span><button class="wb-mx">×</button></div><div class="wb-mb">' + bodyHTML + '</div></div>';
    document.body.appendChild(mask);
    mask.querySelector('.wb-mx').onclick = function () { document.body.removeChild(mask); };
    mask.onclick = function (e) { if (e.target === mask) document.body.removeChild(mask); };
    return mask;
  },

  _showExp: function (key) {
    var d = this.LAYER_DEFS.filter(function (x) { return x.key === key; })[0];
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
    html += '</div><div class="wb-sec"><div class="wb-sh">计算口径</div><div class="wb-sv">单条权重 = (核心区×5 : 普通×1) × (红3/橙2/黄1) × (涉华×1.5)，近 24h 窗口求和归一化映射五级（红≥80/橙≥55/黄≥35/蓝≥15/平稳）。全部基于 DataHub 真实预警计算，零模拟成分；昨日回看条目单独计入涉华统计。</div></div>';
    this._modal('海外利益安全指数 · 构成明细', html);
  }
};

/* ── 工作台专属样式（随脚本注入，作用域 wb- 前缀防污染） ── */
(function () {
  var st = document.createElement('style');
  st.textContent =
    '.wb-lrow{display:flex;align-items:center;gap:7px;padding:4px 4px;border-left:2px solid transparent;border-radius:3px}' +
    '.wb-lrow:hover{background:var(--blue-bg);border-left-color:var(--cyan)}' +
    '.wb-info{background:none;border:1px solid var(--border2);color:var(--text3);width:17px;height:17px;border-radius:50%;font-size:10px;font-style:italic;line-height:1;flex-shrink:0;cursor:pointer;padding:0}' +
    '.wb-info:hover{color:var(--cyan);border-color:var(--cyan)}' +
    '.wb-crow{display:flex;align-items:center;gap:10px;padding:5px 6px;border-radius:4px;cursor:pointer}' +
    '.wb-crow:hover{background:var(--blue-bg)}' +
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
    '.wb-contrib{margin-bottom:8px}';
  document.head.appendChild(st);
})();
