/**
 * 专项情报作战室 - threatroom.js v1.0（2026-08-31，任务 #508）
 * ============================================================
 * 输入任意实体（国家 / 威胁组织 / 中资项目 / 自由关键词）→
 *   ① 实体自动识别（COUNTRIES / THREAT_DATA / ENTERPRISES 三库匹配）
 *   ② 专项全网采集（POST /api/threatroom/collect：GDELT 7d + AP，走标准入库闸门）
 *   ③ 库内数据联动（GET /api/threatroom/data：近 7 天实体匹配，含既有数据）
 *   ④ 态势预警分析报告：综合威胁等级 + 自动研判 + 7 天趋势 + 类别分布 + 涉华焦点
 *   ⑤ 预警图（Leaflet）：国别事件热度圈 + 中资项目资产点位 + 实体中心脉冲
 *   ⑥ 情报卡片流（点击详情）+ 报告一键复制导出 + 实体词全文高亮
 * 铁律：零模拟数据；所有数字来自真实采集/库内数据；空数据显示通道预留。
 */
var THREATROOM = {
  _inited: false,
  _busy: false,
  _entity: null,      /* {type,cn,en,aliases,country?,projects?} */
  _items: [],
  _collect: null,
  _days: 7,
  _map: null,
  _mapEl: null,

  /* 旗舰项目英文名映射（GDELT/AP 英文检索用；通用名如"数据中心"不收录避免歧义） */
  PROJ_EN: {
    '瓜达尔港': 'Gwadar port', '汉班托塔港': 'Hambantota port', '比雷埃夫斯港': 'Piraeus port',
    '皎漂深水港': 'Kyaukpyu port', '皎漂天然气': 'Kyaukpyu pipeline', '中老铁路': 'China-Laos railway',
    '雅万高铁': 'Jakarta Bandung high-speed rail', '蒙内铁路': 'Mombasa Nairobi railway',
    '卡沙甘油田': 'Kashagan oilfield', '南帕尔斯气田': 'South Pars gas field',
    '密松水电站': 'Myitsone dam', '艾娜克铜矿': 'Mes Aynak copper', '卢安夏铜矿': 'Luanshya copper',
    '博法铝土矿': 'Boffa bauxite', '拉斯邦巴斯铜矿': 'Las Bambas copper', '特罗莫克铜矿': 'Toromocho copper',
    '卡拉奇核电站': 'Karachi nuclear power plant', '阿斯塔纳轻轨': 'Astana light rail',
    '美丽山特高压': 'Belo Monte transmission', '瑞丽江电站': 'Shweli dam',
    '吉布提国际自贸区': 'Djibouti free trade zone', '拉合尔橙线': 'Lahore Orange Line',
    '延布炼厂': 'Yanbu refinery', '亚马尔LNG': 'Yamal LNG', '匈塞铁路': 'Hungary Serbia railway',
    'E763高速公路': 'E763 highway Serbia', '卡西姆港燃煤电站': 'Qasim power plant',
    '新行政首都': 'Egypt new capital', '6区油田': 'Sudan block 6 oilfield',
    '17区油田': 'Angola block 17', 'Junin4区块': 'Junin 4 Venezuela'
  },

  DT_CN: {
    'terror_events': '恐袭事件', 'security_events': '涉华安全', 'military_conflicts': '武装冲突',
    'political_events': '政治风险', 'geopolitical_intel': '地缘情报', 'natural_disasters': '自然灾害',
    'public_health': '公共卫生', 'sanctions_data': '制裁合规', 'social_unrest': '社会动荡',
    'infrastructure': '基础设施', 'osint_intel': '开源情报', 'collect_logs': '采集日志'
  },

  /* ═══════════ 初始化 ═══════════ */
  init: function () {
    var host = document.getElementById('threatroom-content');
    if (!host) return;
    if (!this._inited) {
      host.innerHTML = this._shellHTML();
      this._bindShell();
      this._inited = true;
      /* 恢复上次报告 */
      try {
        var last = JSON.parse(localStorage.getItem('orps_threatroom_last') || 'null');
        if (last && last.entity && last.items && last.items.length) {
          this._entity = last.entity; this._items = last.items;
          this._collect = last.collect || null; this._days = last.days || 7;
          this._renderReport();
        }
      } catch (e) {}
    }
  },

  _apiBase: function () {
    if (typeof APIClient !== 'undefined' && APIClient._baseUrl && /^https?:/.test(APIClient._baseUrl)) return APIClient._baseUrl;
    if (typeof window !== 'undefined' && window.location && /^https?:/.test(window.location.origin || '')) return window.location.origin;
    return 'http://localhost:3000';
  },

  /* ═══════════ 外壳 ═══════════ */
  _shellHTML: function () {
    var s = '';
    s += '<style>';
    s += '.tr-shell{padding:14px}';
    s += '.tr-search{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}';
    s += '.tr-input{flex:1;min-width:280px;background:var(--bg2,#111a2b);border:1px solid var(--border2,#1e2a40);border-radius:8px;color:var(--text,#e8eefc);font-size:15px;padding:11px 14px;outline:none}';
    s += '.tr-input:focus{border-color:var(--cyan,#00d4ff)}';
    s += '.tr-go{background:linear-gradient(135deg,#00d4ff33,#0066ff33);border:1px solid var(--cyan,#00d4ff);color:var(--cyan,#00d4ff);font-weight:700;font-size:14px;padding:11px 26px;border-radius:8px;cursor:pointer;letter-spacing:1px}';
    s += '.tr-go:hover{background:var(--cyan,#00d4ff);color:#04101e}';
    s += '.tr-days{display:flex;gap:4px;align-items:center;font-size:11px;color:var(--text3,#7a8aa3)}';
    s += '.tr-day{padding:5px 10px;border:1px solid var(--border2,#1e2a40);border-radius:5px;cursor:pointer;color:var(--text2,#aab8d0)}';
    s += '.tr-day.on{border-color:var(--cyan,#00d4ff);color:var(--cyan,#00d4ff);background:#00d4ff10}';
    s += '.tr-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}';
    s += '.tr-chip{font-size:11px;padding:3px 10px;border:1px solid var(--border2,#1e2a40);border-radius:12px;cursor:pointer;color:var(--text2,#aab8d0)}';
    s += '.tr-chip:hover{border-color:var(--cyan,#00d4ff);color:var(--cyan,#00d4ff)}';
    s += '.tr-chiplab{font-size:10px;color:var(--text3,#7a8aa3)}';
    s += '.tr-stage{display:none;align-items:center;gap:8px;padding:10px 14px;border:1px solid var(--border2,#1e2a40);border-radius:8px;margin-bottom:12px;background:var(--bg2,#0d1524);font-size:12.5px;color:var(--text2,#aab8d0)}';
    s += '.tr-spin{width:14px;height:14px;border:2px solid var(--border2,#1e2a40);border-top-color:var(--cyan,#00d4ff);border-radius:50%;animation:trrot 0.8s linear infinite;flex-shrink:0}';
    s += '@keyframes trrot{to{transform:rotate(360deg)}}';
    s += '.tr-stage .ok{color:var(--green,#22c55e);font-weight:700}';
    s += '.tr-rep{display:none}';
    s += '.tr-headcard{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}';
    s += '.tr-grade{flex-shrink:0;text-align:center;padding:10px 20px;border-radius:10px;border:1px solid}';
    s += '.tr-bar{height:4px;border-radius:2px;background:var(--bg2,#111a2b);overflow:hidden;margin-top:4px}';
    s += '.tr-daycol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;height:64px;cursor:default}';
    s += '.tr-daybar{width:60%;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#00d4ff,#0066ff66);min-height:2px;transition:height .5s}';
    s += '.tr-catrow{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:11.5px}';
    s += '.tr-catbar{height:10px;border-radius:2px;background:var(--cyan,#00d4ff);min-width:2px;opacity:.85}';
    s += '.tr-item{border:1px solid var(--border2,#1e2a40);border-left:3px solid var(--text3,#5a6a83);border-radius:6px;padding:9px 12px;margin-bottom:8px;cursor:pointer;background:var(--bg2,#0d1524)}';
    s += '.tr-item:hover{border-color:var(--cyan,#00d4ff);background:#00d4ff08}';
    s += '.tr-item .t{font-size:13px;color:var(--text,#e8eefc);line-height:1.55}';
    s += '.tr-item .m{display:flex;gap:8px;align-items:center;margin-top:5px;font-size:10.5px;color:var(--text3,#7a8aa3);flex-wrap:wrap}';
    s += '.tr-badge{font-size:10px;padding:1px 7px;border-radius:3px;border:1px solid}';
    s += '.tr-mark{background:#00d4ff26;color:var(--cyan,#00d4ff);border-radius:2px;padding:0 2px;font-weight:600}';
    s += '.tr-proj{display:flex;gap:8px;align-items:center;padding:7px 10px;border:1px solid var(--border2,#1e2a40);border-radius:6px;margin-bottom:6px;font-size:12px;cursor:pointer}';
    s += '.tr-proj:hover{border-color:var(--cyan,#00d4ff)}';
    s += '.tr-modal{position:fixed;inset:0;background:#040a14ee;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px}';
    s += '.tr-modalbox{background:var(--bg,#0a1220);border:1px solid var(--border2,#1e2a40);border-radius:10px;max-width:760px;width:100%;max-height:82vh;overflow-y:auto;padding:20px 22px}';
    s += '</style>';
    s += '<div class="tr-shell">';
    /* 搜索区 */
    s += '<div class="card" style="margin-bottom:12px;padding:14px">';
    s += '<div class="card-tt"><span class="ic">🎯</span>专项全网搜集引擎<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">国家 · 威胁组织 · 中资项目 · 自由关键词 → 专项采集 + 态势预警分析报告 + 预警图</span></div>';
    s += '<div class="tr-search" style="margin-top:10px">';
    s += '<input class="tr-input" id="tr-q" placeholder="输入实体：如 吉尔吉斯斯坦 / 塔利班 / 瓜达尔港 / 任意关键词…" autocomplete="off">';
    s += '<div class="tr-days" id="tr-days">';
    s += '<span class="tr-chiplab">时间窗</span>';
    s += '<span class="tr-day" data-d="2">48h</span><span class="tr-day on" data-d="7">7 天</span><span class="tr-day" data-d="14">14 天</span>';
    s += '</div>';
    s += '<button class="tr-go" id="tr-go">🚀 启动作战</button>';
    s += '</div>';
    s += '<div class="tr-chips" id="tr-chips"></div>';
    s += '</div>';
    /* 进度条 */
    s += '<div class="tr-stage" id="tr-stage"></div>';
    /* 报告区 */
    s += '<div class="tr-rep" id="tr-rep"></div>';
    s += '</div>';
    return s;
  },

  _bindShell: function () {
    var self = this;
    var go = document.getElementById('tr-go');
    var q = document.getElementById('tr-q');
    if (go) go.onclick = function () { self.run(q.value); };
    if (q) q.onkeydown = function (e) { if (e.key === 'Enter') self.run(q.value); };
    var days = document.getElementById('tr-days');
    if (days) days.onclick = function (e) {
      var t = e.target.closest ? e.target.closest('.tr-day') : null;
      if (!t) return;
      Array.prototype.forEach.call(days.querySelectorAll('.tr-day'), function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      self._days = parseInt(t.getAttribute('data-d'), 10) || 7;
    };
    /* 快捷实体 */
    var chips = document.getElementById('tr-chips');
    if (chips) {
      var hot = [
        ['吉尔吉斯斯坦', '国家'], ['巴基斯坦', '国家'], ['缅甸', '国家'], ['尼日利亚', '国家'], ['刚果(金)', '国家'],
        ['塔利班', '组织'], ['伊斯兰国', '组织'], ['青年党', '组织'],
        ['瓜达尔港', '项目'], ['中老铁路', '项目'], ['汉班托塔港', '项目']
      ];
      var html = '';
      var lastType = '';
      hot.forEach(function (h) {
        if (h[1] !== lastType) { html += '<span class="tr-chiplab">' + h[1] + '</span>'; lastType = h[1]; }
        html += '<span class="tr-chip" data-q="' + h[0] + '">' + h[0] + '</span>';
      });
      chips.innerHTML = html;
      chips.onclick = function (e) {
        var t = e.target.closest ? e.target.closest('.tr-chip') : null;
        if (!t) return;
        document.getElementById('tr-q').value = t.getAttribute('data-q');
        self.run(t.getAttribute('data-q'));
      };
    }
  },

  /* ═══════════ 实体识别 ═══════════ */
  _detectEntity: function (raw) {
    var q = String(raw || '').trim();
    if (!q) return null;
    /* ① 国家：COUNTRIES 精确 → 双向包含 */
    var i, c = null, cl = (typeof COUNTRIES !== 'undefined') ? COUNTRIES : [];
    for (i = 0; i < cl.length; i++) { if (cl[i].name === q) { c = cl[i]; break; } }
    if (!c && q.length >= 2) {
      for (i = 0; i < cl.length; i++) {
        if (cl[i].name.length >= 2 && (q.indexOf(cl[i].name) >= 0 || cl[i].name.indexOf(q) >= 0)) { c = cl[i]; break; }
      }
    }
    if (c) return { type: 'country', cn: c.name };
    /* ② 威胁组织：THREAT_DATA name/aliases */
    var orgs = (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) ? THREAT_DATA.organizations : [];
    for (i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      var names = [o.name].concat(o.aliases || []);
      var hit = false;
      for (var j = 0; j < names.length; j++) {
        if (names[j] && (names[j] === q || (q.length >= 3 && names[j].length >= 3 && (names[j].toLowerCase().indexOf(q.toLowerCase()) >= 0 || q.toLowerCase().indexOf(names[j].toLowerCase()) >= 0)))) { hit = true; break; }
      }
      if (hit) {
        var en = '';
        (o.aliases || []).concat([o.name]).forEach(function (a) { if (!en && a && /^[\x00-\x7F\s]+$/.test(a)) en = a; });
        return { type: 'org', cn: o.name, en: en, aliases: (o.aliases || []).filter(function (a) { return a && /^[\x00-\x7F\s]+$/.test(a); }).slice(0, 3), regions: o.operatingRegions || [] };
      }
    }
    /* ③ 中资项目 / 企业：ENTERPRISES 项目名 → 企业名 */
    var ents = (typeof ENTERPRISES !== 'undefined') ? ENTERPRISES : [];
    for (i = 0; i < ents.length; i++) {
      var ent = ents[i];
      /* 项目名命中：单项目实体 */
      var projs = ent.projects || [];
      for (var k = 0; k < projs.length; k++) {
        if (projs[k].n && (projs[k].n === q || (q.length >= 3 && projs[k].n.indexOf(q) >= 0))) {
          return {
            type: 'project', cn: projs[k].n, en: this.PROJ_EN[projs[k].n] || '',
            aliases: [ent.code].concat(this.PROJ_EN[projs[k].n] ? [] : []),
            country: projs[k].c, ent: ent.short || ent.name, inv: projs[k].inv, pers: projs[k].p
          };
        }
      }
      /* 企业名命中：企业级实体（旗下全部项目） */
      if (ent.name === q || ent.short === q || String(ent.code || '').toLowerCase() === q.toLowerCase() ||
        (q.length >= 2 && (ent.short.indexOf(q) >= 0 || ent.name.indexOf(q) >= 0))) {
        return { type: 'project', cn: ent.short || ent.name, en: ent.code, aliases: [ent.code], country: '', ent: ent.short || ent.name, projects: projs };
      }
    }
    /* ④ 自由关键词 */
    return { type: 'keyword', cn: q };
  },

  _typeLabel: function (t) {
    var m = { country: '国家', org: '威胁组织', project: '中资项目', keyword: '关键词' };
    return m[t] || '关键词';
  },

  /* ═══════════ 主流程 ═══════════ */
  run: function (raw) {
    if (this._busy) return;
    var e = this._detectEntity(raw);
    if (!e) { this._toast('请输入实体名称（国家 / 组织 / 项目 / 关键词）'); return; }
    this._busy = true;
    this._entity = e; this._items = []; this._collect = null;
    var self = this;
    var rep = document.getElementById('tr-rep');
    if (rep) { rep.style.display = 'none'; rep.innerHTML = ''; }

    /* 阶段一：实体识别（即时） */
    this._stage('实体识别 <b class="ok">✓</b>「' + this._esc(e.cn) + '」（' + this._typeLabel(e.type) + '）→ 全网采集中：GDELT 7d 检索 + AP 补充…');

    var base = this._apiBase();
    var t0 = Date.now();
    fetch(base + '/api/threatroom/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: e.type, cn: e.cn, en: e.en || '', aliases: e.aliases || [] }),
      signal: AbortSignal.timeout(360000)   /* 采集含 GDELT 限流退避+翻译，实测 4-6 分钟 */
    }).then(function (r) { return r.ok ? r.json() : { ok: false, error: 'HTTP ' + r.status }; })
      .then(function (j) {
        self._collect = j;
        /* 服务端权威实体类型同步（gdCode 自动升级：前端 COUNTRIES 未收录的国家，服务端已按国家采集） */
        if (j && j.ok && j.type && j.type !== self._entity.type) { self._entity.type = j.type; }
        /* 阶段二完成 → 阶段三：库内联动 */
        var cTxt = j && j.ok
          ? ('全网采集完成：检索 ' + (j.collected || 0) + ' 条 / 新入库 ' + (j.inserted || 0) + ' 条 / 前置拒 ' + (j.rejected || 0) + ' 条（' + ((j.ms || 0) / 1000).toFixed(1) + 's）→ 正在拉取库内 ' + self._days + ' 天联动数据…')
          : ('全网采集未新增（' + self._esc(String((j && j.error) || j.note || '无返回')) + '）→ 正在拉取库内 ' + self._days + ' 天联动数据…');
        self._stage(cTxt);
        var qs = '?type=' + encodeURIComponent(e.type) + '&cn=' + encodeURIComponent(e.cn) +
          '&en=' + encodeURIComponent(e.en || '') + '&aliases=' + encodeURIComponent((e.aliases || []).join(',')) +
          '&days=' + self._days;
        return fetch(base + '/api/threatroom/data' + qs, { signal: AbortSignal.timeout(30000) });
      })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        self._items = Array.isArray(items) ? items : [];
        /* 阶段四：生成报告 */
        self._stage('库内联动 ' + self._items.length + ' 条 → 生成态势预警分析报告…');
        setTimeout(function () {
          self._renderReport();
          self._stage(null); /* 完成隐藏进度条 */
          self._busy = false;
          try {
            localStorage.setItem('orps_threatroom_last', JSON.stringify({
              entity: self._entity, items: self._items.slice(0, 200), collect: self._collect, days: self._days, t: Date.now()
            }));
          } catch (ex) {}
        }, 350);
      })
      .catch(function (err) {
        self._stage(null);
        self._busy = false;
        self._toast('采集失败：' + self._esc(err.message || String(err)) + '（GDELT 可能限流，稍后重试；也可直接查库内数据）');
      });
  },

  _stage: function (html) {
    var el = document.getElementById('tr-stage');
    if (!el) return;
    if (!html) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = '<span class="tr-spin"></span><span>' + html + '</span>';
  },

  _toast: function (msg) {
    try { alert(msg); } catch (e) {}
  },

  /* ═══════════ 报告渲染 ═══════════ */
  _tsOf: function (it) {
    var v = it.event_date || it.publish_time || it.publishedAt || it.pubDate || it.date || it.collect_time || '';
    var t = Date.parse(String(v).replace(' ', 'T'));
    return isNaN(t) ? (it.collect_time ? Date.parse(String(it.collect_time).replace(' ', 'T')) : 0) : t;
  },

  _stats: function () {
    var items = this._items;
    var st = { n: items.length, red: 0, orange: 0, yellow: 0, cn: 0, core: 0, byDay: [], byType: {}, byCountry: {}, cnItems: [], recent: 0, prior: 0 };
    var now = Date.now(), days = this._days;
    var half = now - days * 24 * 3600 * 1000 / 2;
    /* 逐日桶 */
    var buckets = {};
    for (var d = days - 1; d >= 0; d--) {
      var dt = new Date(now - d * 24 * 3600 * 1000);
      buckets[dt.toISOString().slice(0, 10)] = 0;
    }
    items.forEach(function (it) {
      var lv = it.level || it.level_norm || '';
      if (lv === 'red') st.red++; else if (lv === 'orange') st.orange++; else if (lv === 'yellow') st.yellow++;
      if (it.chinaRelated === true) { st.cn++; st.cnItems.push(it); }
      if (it.is_core) st.core++;
      var dt = it.data_type || 'osint_intel';
      st.byType[dt] = (st.byType[dt] || 0) + 1;
      var ctry = String(it.country || '').trim();
      if (ctry) st.byCountry[ctry] = (st.byCountry[ctry] || 0) + 1;
      var t = THREATROOM._tsOf(it);
      if (t) {
        var iso = new Date(t).toISOString().slice(0, 10);
        if (buckets[iso] != null) buckets[iso]++;
        if (t >= half) st.recent++; else st.prior++;
      }
    });
    Object.keys(buckets).sort().forEach(function (k) { st.byDay.push({ day: k, n: buckets[k] }); });
    return st;
  },

  _grade: function (st) {
    var score = st.n + st.red * 8 + st.orange * 4 + st.cn * 3 + st.core * 2;
    var g = score >= 80 ? { t: '红色 · Ⅰ级', c: 'var(--red,#ef4444)', lv: 'red' }
      : score >= 45 ? { t: '橙色 · Ⅱ级', c: 'var(--orange,#f59e0b)', lv: 'orange' }
      : score >= 20 ? { t: '黄色 · Ⅲ级', c: 'var(--yellow,#eab308)', lv: 'yellow' }
      : score > 0 ? { t: '蓝色 · Ⅳ级', c: '#38bdf8', lv: 'blue' }
      : { t: '平稳 · 无预警', c: 'var(--green,#22c55e)', lv: 'green' };
    g.score = score;
    return g;
  },

  _judgeText: function (e, st, grade) {
    if (!st.n) return '库内近 ' + this._days + ' 天无「' + e.cn + '」相关数据；全网采集本轮未新增——该实体当前处于监测盲区或信息真空，建议更换关键词重试或稍后再查。';
    var parts = [];
    parts.push('「' + e.cn + '」（' + this._typeLabel(e.type) + '）近 ' + this._days + ' 天库内关联数据 ' + st.n + ' 条，综合威胁等级 ' + grade.t + '（' + grade.score + ' 分）');
    if (st.red || st.orange) parts.push('其中红色预警 ' + st.red + ' 条、橙色 ' + st.orange + ' 条');
    var dPct = st.prior ? Math.round((st.recent - st.prior) / st.prior * 100) : (st.recent ? 100 : 0);
    parts.push(dPct > 15 ? '后半窗环比上升 ' + dPct + '%，事态呈升温态势' : dPct < -15 ? '后半窗环比回落 ' + Math.abs(dPct) + '%，事态趋于缓和' : '环比基本持平');
    if (st.cn) parts.push('涉华关联 ' + st.cn + ' 条' + (st.core ? '（核心区 ' + st.core + ' 条）' : '') + '，建议涉外机构与项目单位重点关注');
    var topT = Object.keys(st.byType).sort(function (a, b) { return st.byType[b] - st.byType[a]; })[0];
    if (topT) parts.push('主导风险类型为「' + (this.DT_CN[topT] || topT) + '」(' + st.byType[topT] + ' 条)');
    var topC = Object.keys(st.byCountry).sort(function (a, b) { return st.byCountry[b] - st.byCountry[a]; })[0];
    if (topC && e.type !== 'country') parts.push('事件集中地：' + topC + '(' + st.byCountry[topC] + ' 条)');
    if (grade.lv === 'red') parts.push('建议：立即启动专项值守，核查在当地的机构人员安全，必要时启动撤离预案');
    else if (grade.lv === 'orange') parts.push('建议：提高巡检频次，向驻外机构推送专项提示，做好应急联络准备');
    else if (grade.lv === 'yellow') parts.push('建议：保持常态监测，关注事态演化');
    return parts.join('；') + '。';
  },

  _renderReport: function () {
    var rep = document.getElementById('tr-rep');
    if (!rep || !this._entity) return;
    var e = this._entity, st = this._stats(), grade = this._grade(st);
    var html = '';

    /* ── 研判头卡 ── */
    html += '<div class="card" style="margin-bottom:12px;padding:14px">';
    html += '<div class="tr-headcard">';
    html += '<div class="tr-grade" style="border-color:' + grade.c + '44;background:' + grade.c + '0f">' +
      '<div style="font-size:10px;color:var(--text3,#7a8aa3);letter-spacing:2px">综合威胁等级</div>' +
      '<div style="font-size:20px;font-weight:800;color:' + grade.c + '">' + grade.t + '</div>' +
      '<div style="font-size:10px;color:var(--text3,#7a8aa3)">' + grade.score + ' 分</div></div>';
    html += '<div style="flex:1;min-width:300px">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:19px;font-weight:800;color:var(--text,#e8eefc)">' + this._esc(e.cn) + '</span>' +
      '<span class="tr-badge" style="color:var(--cyan,#00d4ff);border-color:var(--cyan,#00d4ff)44">' + this._typeLabel(e.type) + '</span>' +
      (e.ent ? '<span class="tr-badge" style="color:var(--text2,#aab8d0);border-color:var(--border2,#1e2a40)">' + this._esc(e.ent) + '</span>' : '') +
      (e.country ? '<span class="tr-badge" style="color:var(--text2,#aab8d0);border-color:var(--border2,#1e2a40)">东道国·' + this._esc(e.country) + '</span>' : '') +
      '<span style="margin-left:auto;font-size:10.5px;color:var(--text3,#7a8aa3)">报告时间 ' + new Date().toLocaleString('sv-SE').slice(0, 16) + ' · 窗口 ' + this._days + ' 天</span></div>';
    /* 指标行 */
    html += '<div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:10px;font-size:12px">';
    html += this._kpi('关联数据', st.n + ' 条', 'var(--cyan,#00d4ff)');
    html += this._kpi('红色预警', st.red + ' 条', 'var(--red,#ef4444)');
    html += this._kpi('橙色预警', st.orange + ' 条', 'var(--orange,#f59e0b)');
    html += this._kpi('涉华关联', st.cn + ' 条', 'var(--orange,#f59e0b)');
    html += this._kpi('核心威胁', st.core + ' 条', 'var(--red,#ef4444)');
    if (this._collect && this._collect.ok) html += this._kpi('本轮新采集入库', this._collect.inserted + ' / ' + this._collect.collected + ' 条', 'var(--green,#22c55e)');
    html += '</div>';
    /* 研判文字 */
    html += '<div style="margin-top:10px;font-size:12.5px;line-height:1.85;color:var(--text,#e8eefc)">' +
      '<span style="color:var(--cyan,#00d4ff);font-weight:700">🧠 值班研判：</span>' + this._esc(this._judgeText(e, st, grade)) + '</div>';
    html += '</div></div>';
    /* 操作条 */
    html += '<div style="display:flex;gap:8px;margin:-4px 0 12px 2px">' +
      '<button class="tr-go" style="padding:6px 16px;font-size:12px" onclick="THREATROOM._copyReport()">📋 复制报告全文</button>' +
      '<button class="tr-go" style="padding:6px 16px;font-size:12px" onclick="THREATROOM.run(document.getElementById(\'tr-q\').value)">🔄 重新采集</button></div>';
    html += '</div>';

    /* ── 预警图 + 7 天趋势 双栏 ── */
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">';
    html += '<div class="card" style="flex:1.4;min-width:380px;padding:10px">' +
      '<div class="card-tt"><span class="ic">🗺️</span>预警图<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">圈=事件热度 · ◆=中资项目资产</span></div>' +
      '<div id="tr-map" style="height:340px;border-radius:8px;margin-top:8px;overflow:hidden"></div></div>';
    /* 趋势 + 类别 */
    html += '<div class="card" style="flex:1;min-width:300px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">📈</span>近 ' + this._days + ' 天趋势</div>';
    var maxN = Math.max.apply(null, st.byDay.map(function (d) { return d.n; }).concat([1]));
    html += '<div style="display:flex;gap:3px;align-items:flex-end;height:80px;margin-top:12px">';
    st.byDay.forEach(function (d) {
      var h = Math.round(d.n / maxN * 60);
      html += '<div class="tr-daycol" title="' + d.day + '：' + d.n + ' 条"><div style="font-size:9px;color:var(--text2,#aab8d0)">' + (d.n || '') + '</div>' +
        '<div class="tr-daybar" style="height:' + Math.max(2, h) + 'px;opacity:' + (d.n ? 1 : 0.18) + '"></div></div>';
    });
    html += '</div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3,#7a8aa3);margin-top:2px"><span>' + st.byDay[0].day.slice(5) + '</span><span>今天</span></div>';
    html += '<div class="card-tt" style="margin-top:14px"><span class="ic">🗂️</span>类别分布</div><div style="margin-top:8px">';
    var types = Object.keys(st.byType).sort(function (a, b) { return st.byType[b] - st.byType[a]; }).slice(0, 8);
    var maxT = types.length ? st.byType[types[0]] : 1;
    types.forEach(function (t) {
      var w = Math.round(st.byType[t] / maxT * 100);
      html += '<div class="tr-catrow"><span style="width:86px;flex-shrink:0;color:var(--text2,#aab8d0)">' + (THREATROOM.DT_CN[t] || t) + '</span>' +
        '<div style="flex:1"><div class="tr-catbar" style="width:' + Math.max(2, w) + '%"></div></div>' +
        '<span style="width:34px;text-align:right;color:var(--text3,#7a8aa3)">' + st.byType[t] + '</span></div>';
    });
    if (!types.length) html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">通道预留：库内无该实体分类数据</div>';
    html += '</div></div></div>';

    /* ── 涉华焦点 + 关联项目 双栏 ── */
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">';
    html += '<div class="card" style="flex:1;min-width:320px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">🇨🇳</span>涉华焦点<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">' + st.cn + ' 条</span></div>';
    if (st.cnItems.length) {
      st.cnItems.slice(0, 6).forEach(function (it, idx) {
        html += '<div class="tr-item" style="margin-top:8px;border-left-color:var(--orange,#f59e0b)" data-i="' + THREATROOM._idx(it) + '">' +
          '<div class="t">' + THREATROOM._hl(THREATROOM._title(it), e) + '</div>' +
          '<div class="m"><span>' + (it.source || '—') + '</span><span>' + THREATROOM._when(it) + '</span>' +
          (it.level ? '<span class="tr-badge" style="color:' + THREATROOM._lvColor(it.level) + ';border-color:' + THREATROOM._lvColor(it.level) + '55">' + THREATROOM._lvCN(it.level) + '</span>' : '') + '</div></div>';
      });
    } else html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">窗口内无涉华关联条目</div>';
    html += '</div>';
    /* 关联项目资产 */
    html += '<div class="card" style="flex:1;min-width:320px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">🏗️</span>关联中资项目资产<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">ENTERPRISES 档案联动</span></div>';
    var projs = this._linkProjects();
    if (projs.length) {
      projs.slice(0, 8).forEach(function (p) {
        var heat = st.byCountry[p.c] || 0;
        html += '<div class="tr-proj" data-wc="' + THREATROOM._esc(p.c) + '">' +
          '<span style="width:9px;height:9px;background:var(--cyan,#00d4ff);transform:rotate(45deg);flex-shrink:0;box-shadow:0 0 6px #00d4ff88"></span>' +
          '<span style="font-weight:700;color:var(--text,#e8eefc)">' + THREATROOM._esc(p.n) + '</span>' +
          '<span style="color:var(--text3,#7a8aa3);font-size:11px">' + THREATROOM._esc(p.ent) + ' · ' + THREATROOM._esc(p.c) + (p.inv ? ' · ' + p.inv + '亿' : '') + (p.p ? ' · ' + p.p + '人' : '') + '</span>' +
          '<span style="margin-left:auto;font-size:11px;font-weight:700;color:' + (heat >= 5 ? 'var(--red,#ef4444)' : heat ? 'var(--orange,#f59e0b)' : 'var(--green,#22c55e)') + '">' + (heat ? '所在国预警 ' + heat : '无预警') + '</span></div>';
      });
    } else html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">窗口内无关联项目（该实体不涉及已建档中资项目所在国）</div>';
    html += '</div></div>';

    /* ── 情报卡片流 ── */
    html += '<div class="card" style="padding:12px">';
    html += '<div class="card-tt"><span class="ic">📡</span>专项情报流<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">' + st.n + ' 条 · 点击查看详情 · 实体词已高亮</span></div>';
    var feed = this._items.slice(0, 60);
    if (feed.length) {
      html += '<div style="margin-top:8px;max-height:520px;overflow-y:auto" id="tr-feed">';
      feed.forEach(function (it) {
        var lc = THREATROOM._lvColor(it.level || '');
        html += '<div class="tr-item" style="border-left-color:' + lc + '" data-i="' + THREATROOM._idx(it) + '">' +
          '<div class="t">' + THREATROOM._hl(THREATROOM._title(it), e) + '</div>' +
          '<div class="m"><span>' + THREATROOM._esc(it.source || '—') + '</span><span>' + THREATROOM._when(it) + '</span>' +
          '<span>' + (THREATROOM.DT_CN[it.data_type] || it.data_type || '开源情报') + '</span>' +
          (it.country ? '<span>📍' + THREATROOM._esc(it.country) + '</span>' : '') +
          (it.chinaRelated === true ? '<span class="tr-badge" style="color:var(--orange,#f59e0b);border-color:var(--orange,#f59e0b)55">涉华</span>' : '') +
          (it.is_core ? '<span class="tr-badge" style="color:var(--red,#ef4444);border-color:var(--red,#ef4444)55">★核心</span>' : '') +
          (it.level ? '<span class="tr-badge" style="color:' + lc + ';border-color:' + lc + '55">' + THREATROOM._lvCN(it.level) + '</span>' : '') + '</div></div>';
      });
      html += '</div>';
    } else html += '<div style="font-size:12px;color:var(--text3,#7a8aa3);padding:14px 0">通道预留：库内暂无该实体数据。点击「重新采集」或在顶部换关键词重试。</div>';
    html += '</div>';

    rep.innerHTML = html;
    rep.style.display = 'block';
    /* 绑定卡片点击（详情）+ 项目点击（地图联动） */
    var self = this;
    Array.prototype.forEach.call(rep.querySelectorAll('.tr-item[data-i]'), function (el) {
      el.onclick = function () { self._detail(parseInt(el.getAttribute('data-i'), 10)); };
    });
    Array.prototype.forEach.call(rep.querySelectorAll('.tr-proj[data-wc]'), function (el) {
      el.onclick = function () { self._flyTo(el.getAttribute('data-wc')); };
    });
    this._renderMap(st, grade);
  },

  _kpi: function (label, val, color) {
    return '<div style="text-align:center"><div style="font-size:10px;color:var(--text3,#7a8aa3)">' + label + '</div>' +
      '<div style="font-size:16px;font-weight:800;color:' + color + '">' + val + '</div></div>';
  },

  /* 库内条目 → 报告可定位索引（用 url+title 哈希，避免大对象存索引） */
  _idx: function (it) {
    if (it._tri == null) { it._tri = this._items.indexOf(it); }
    return it._tri;
  },

  _title: function (it) { return String(it.title_zh || it.title || '（无标题）'); },

  _when: function (it) {
    var t = this._tsOf(it);
    return t ? new Date(t).toLocaleString('sv-SE').slice(0, 16) : '—';
  },

  _lvColor: function (lv) {
    return lv === 'red' ? 'var(--red,#ef4444)' : lv === 'orange' ? 'var(--orange,#f59e0b)' : lv === 'yellow' ? 'var(--yellow,#eab308)' : 'var(--text3,#5a6a83)';
  },
  _lvCN: function (lv) { return lv === 'red' ? '红' : lv === 'orange' ? '橙' : lv === 'yellow' ? '黄' : lv; },

  _hl: function (text, e) {
    var words = [e.cn];
    if (e.en) words.push(e.en);
    (e.aliases || []).forEach(function (a) { words.push(a); });
    var t = this._esc(text);
    words.filter(Boolean).forEach(function (w) {
      if (!w || w.length < 2) return;
      try { t = t.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<span class="tr-mark">$1</span>'); } catch (ex) {}
    });
    return t;
  },

  _esc: function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /* 与该实体相关的中资项目（国家→该国项目；组织/关键词→事件国项目；项目→自身+同国项目） */
  _linkProjects: function () {
    var e = this._entity;
    var out = [];
    var seen = {};
    var st = this._stats();
    var addAll = function (country) {
      (typeof ENTERPRISES !== 'undefined' ? ENTERPRISES : []).forEach(function (ent) {
        (ent.projects || []).forEach(function (p) {
          if (p.c === country && !seen[p.n]) { seen[p.n] = 1; out.push({ n: p.n, c: p.c, ent: ent.short || ent.name, inv: p.inv, p: p.p }); }
        });
      });
    };
    if (e.type === 'country') addAll(e.cn);
    else if (e.type === 'project' && e.country) addAll(e.country);
    else {
      Object.keys(st.byCountry).sort(function (a, b) { return st.byCountry[b] - st.byCountry[a]; }).slice(0, 5).forEach(addAll);
    }
    return out.slice(0, 10);
  },

  /* ═══════════ 预警图 ═══════════ */
  _findCountry: function (name) {
    if (!name) return null;
    var cl = (typeof COUNTRIES !== 'undefined') ? COUNTRIES : [];
    for (var i = 0; i < cl.length; i++) {
      if (cl[i].name === name) return cl[i];
    }
    /* 模糊双向 */
    for (var j = 0; j < cl.length; j++) {
      if (cl[j].name.length >= 2 && (name.indexOf(cl[j].name) >= 0 || cl[j].name.indexOf(name) >= 0)) return cl[j];
    }
    return null;
  },

  _renderMap: function (st, grade) {
    var self = this;
    var el = document.getElementById('tr-map');
    if (!el) return;
    if (typeof L === 'undefined') { el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3,#7a8aa3)">Leaflet 未加载</div>'; return; }
    try {
      if (this._map) { try { this._map.remove(); } catch (e) {} this._map = null; }
      /* 视野中心：实体国 / 事件集中国 / 全球 */
      var center = [25, 40], zoom = 2.4;
      var focus = null;
      if (this._entity.type === 'country') focus = this._findCountry(this._entity.cn);
      else if (this._entity.type === 'project' && this._entity.country) focus = this._findCountry(this._entity.country);
      else {
        var topC = Object.keys(st.byCountry).sort(function (a, b) { return st.byCountry[b] - st.byCountry[a]; })[0];
        if (topC) focus = this._findCountry(topC);
      }
      if (focus && focus.lat != null) { center = [focus.lat, focus.lon]; zoom = 5; }
      this._map = L.map(el, { center: center, zoom: zoom, minZoom: 2, maxZoom: 12, worldCopyJump: true, attributionControl: false });
      if (typeof TDT_BASEMAP !== 'undefined') TDT_BASEMAP.addTo(this._map, 'sat');
      else if (typeof LOCAL_BASEMAP !== 'undefined') LOCAL_BASEMAP.addTo(this._map);
      setTimeout(function () { if (self._map) self._map.invalidateSize(); }, 300);

      /* ① 事件热度圈：逐国 */
      var maxC = Math.max.apply(null, Object.keys(st.byCountry).map(function (k) { return st.byCountry[k]; }).concat([1]));
      Object.keys(st.byCountry).forEach(function (k) {
        var c = self._findCountry(k);
        if (!c || c.lat == null) return;
        var n = st.byCountry[k];
        var col = n >= maxC * 0.66 ? '#ef4444' : n >= maxC * 0.33 ? '#f59e0b' : '#eab308';
        var rad = 180000 + Math.sqrt(n) * 220000;
        L.circleMarker([c.lat, c.lon], {
          radius: 8 + Math.sqrt(n) * 3.2, color: col, weight: 2, fillColor: col, fillOpacity: 0.28
        }).addTo(self._map).bindPopup('<b style="color:' + col + '">' + self._esc(k) + '</b><br>近 ' + self._days + ' 天事件 <b>' + n + '</b> 条');
        L.circle([c.lat, c.lon], { radius: rad, color: col, weight: 1, fillColor: col, fillOpacity: 0.08 }).addTo(self._map);
      });
      /* ② 实体中心脉冲（国家/项目类） */
      if (focus && focus.lat != null) {
        var g = grade.lv === 'red' || grade.lv === 'orange' ? '#ef4444' : grade.lv === 'yellow' ? '#f59e0b' : '#00d4ff';
        L.circleMarker([focus.lat, focus.lon], { radius: 16, color: g, weight: 3, fillColor: g, fillOpacity: 0.12 })
          .addTo(this._map).bindPopup('<b>' + this._esc(this._entity.cn) + '</b><br>综合威胁 ' + grade.t);
      }
      /* ③ 中资项目资产 ◆ */
      this._linkProjects().forEach(function (p) {
        var c = self._findCountry(p.c);
        if (!c || c.lat == null) return;
        var heat = st.byCountry[p.c] || 0;
        L.marker([c.lat + (Math.random() - 0.5) * 3, c.lon + (Math.random() - 0.5) * 3], {
          icon: L.divIcon({ className: '', html: '<div style="width:12px;height:12px;background:#00d4ff;transform:rotate(45deg);box-shadow:0 0 8px #00d4ff99;border:1px solid #fff3"></div>', iconSize: [12, 12] })
        }).addTo(self._map).bindPopup('<b style="color:#00d4ff">◆ ' + self._esc(p.n) + '</b><br>' + self._esc(p.ent) + ' · ' + self._esc(p.c) + (p.inv ? '<br>投资 ' + p.inv + ' 亿' : '') + (p.p ? ' · 人员 ' + p.p : '') + '<br>所在国近 ' + self._days + ' 天预警 <b style="color:' + (heat ? '#f59e0b' : '#22c55e') + '">' + heat + '</b> 条');
      });
    } catch (e2) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--orange,#f59e0b)">地图渲染失败：' + this._esc(e2.message) + '</div>';
    }
  },

  _flyTo: function (country) {
    if (!this._map) return;
    var c = this._findCountry(country);
    if (!c || c.lat == null) return;
    this._map.flyTo([c.lat, c.lon], 5, { duration: 1.2 });
  },

  /* ═══════════ 详情弹窗 ═══════════ */
  _detail: function (i) {
    var it = this._items[i];
    if (!it) return;
    var e = this._entity;
    var lc = this._lvColor(it.level || '');
    var html = '<div class="tr-modal" id="tr-modal" onclick="if(event.target===this)THREATROOM._closeDetail()"><div class="tr-modalbox">';
    html += '<div style="display:flex;align-items:flex-start;gap:10px">';
    html += '<div style="flex:1;font-size:15px;font-weight:700;color:var(--text,#e8eefc);line-height:1.6">' + this._hl(this._title(it), e) + '</div>';
    html += '<button onclick="THREATROOM._closeDetail()" style="background:none;border:1px solid var(--border2,#1e2a40);color:var(--text2,#aab8d0);border-radius:6px;padding:4px 12px;cursor:pointer">✕ 关闭</button></div>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:var(--text3,#7a8aa3)">' +
      '<span>' + this._esc(it.source || '—') + '</span><span>' + this._when(it) + '</span>' +
      '<span>' + (this.DT_CN[it.data_type] || it.data_type || '') + '</span>' +
      (it.country ? '<span>📍' + this._esc(it.country) + '</span>' : '') +
      (it.level ? '<span class="tr-badge" style="color:' + lc + ';border-color:' + lc + '55">' + this._lvCN(it.level) + '级</span>' : '') +
      (it.chinaRelated === true ? '<span class="tr-badge" style="color:var(--orange,#f59e0b);border-color:var(--orange,#f59e0b)55">涉华</span>' : '') + '</div>';
    var desc = String(it.description || it.content || it.desc || it.summary || '').trim();
    if (desc) {
      /* 去标签 + 截断展示 */
      desc = desc.replace(/<[^>]+>/g, '').slice(0, 3000);
      html += '<div style="margin-top:12px;font-size:12.5px;line-height:1.9;color:var(--text2,#aab8d0);white-space:pre-wrap;max-height:340px;overflow-y:auto">' + this._hl(desc, e) + '</div>';
    } else html += '<div style="margin-top:12px;font-size:11.5px;color:var(--text3,#7a8aa3)">（正文未入库：检索通道仅返回标题，可点原文链接查看）</div>';
    if (it.url) html += '<div style="margin-top:14px"><a href="' + this._esc(it.url) + '" target="_blank" rel="noopener" style="color:var(--cyan,#00d4ff);font-size:12px">🔗 查看原文 →</a></div>';
    html += '</div></div>';
    var old = document.getElementById('tr-modal');
    if (old) old.remove();
    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstChild);
  },
  _closeDetail: function () {
    var m = document.getElementById('tr-modal');
    if (m) m.remove();
  },

  /* ═══════════ 报告导出 ═══════════ */
  _copyReport: function () {
    var e = this._entity, st = this._stats(), grade = this._grade(st);
    var L1 = [];
    L1.push('【专项态势预警分析报告】' + e.cn + '（' + this._typeLabel(e.type) + '）');
    L1.push('报告时间：' + new Date().toLocaleString('sv-SE') + '　窗口：近 ' + this._days + ' 天');
    L1.push('综合威胁等级：' + grade.t + '（' + grade.score + ' 分）');
    L1.push('关联数据 ' + st.n + ' 条｜红 ' + st.red + '｜橙 ' + st.orange + '｜黄 ' + st.yellow + '｜涉华 ' + st.cn + '｜核心 ' + st.core);
    if (this._collect && this._collect.ok) L1.push('本轮专项采集：检索 ' + this._collect.collected + ' 条，新入库 ' + this._collect.inserted + ' 条');
    L1.push('');
    L1.push('【值班研判】' + this._judgeText(e, st, grade));
    L1.push('');
    L1.push('【类别分布】' + Object.keys(st.byType).sort(function (a, b) { return st.byType[b] - st.byType[a]; }).map(function (t) { return (THREATROOM.DT_CN[t] || t) + ' ' + st.byType[t]; }).join('、'));
    L1.push('【国别分布】' + Object.keys(st.byCountry).sort(function (a, b) { return st.byCountry[b] - st.byCountry[a]; }).slice(0, 8).map(function (k) { return k + ' ' + st.byCountry[k]; }).join('、'));
    var projs = this._linkProjects();
    if (projs.length) L1.push('【关联项目】' + projs.slice(0, 6).map(function (p) { return p.n + '（' + p.ent + '·' + p.c + '）'; }).join('、'));
    L1.push('');
    L1.push('【重点情报（前 10 条）】');
    this._items.slice(0, 10).forEach(function (it, i) {
      L1.push((i + 1) + '. [' + (it.level ? THREATROOM._lvCN(it.level) + '级' : '—') + '] ' + THREATROOM._title(it) + '（' + (it.source || '—') + ' ' + THREATROOM._when(it) + (it.url ? ' ' + it.url : '') + '）');
    });
    L1.push('');
    L1.push('—— 海外利益保护情报预警平台 · 专项情报作战室自动生成（全真实采集数据）');
    var text = L1.join('\n');
    var self = this;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { self._toast('报告全文已复制到剪贴板（' + text.length + ' 字）'); }, function () { self._fallbackCopy(text); });
    } else this._fallbackCopy(text);
  },
  _fallbackCopy: function (text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      this._toast('报告全文已复制到剪贴板（' + text.length + ' 字）');
    } catch (e) { this._toast('复制失败，请手动选取报告内容'); }
  }
};
