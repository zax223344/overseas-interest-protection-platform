/**
 * 专项情报作战室 - threatroom.js v2.0（2026-08-31，任务 #511/#512）
 * ============================================================
 * 输入任意实体（国家 / 威胁组织 / 中资项目 / 自由关键词）→
 *   ① 实体自动识别（COUNTRIES / THREAT_DATA / ENTERPRISES 三库匹配）+ 实时速览反馈
 *   ② 专项全网采集（POST /api/threatroom/collect：GDELT 检索矩阵[实体名 250+12 主题变体+
 *      全语言兜底] + Google News + AP 三引擎，走标准入库闸门）
 *   ③ 库内数据联动（GET /api/threatroom/data：近 N 天实体六路匹配，含既有数据）
 *   ④ 态势预警分析报告：综合威胁等级 + 自动研判 + 趋势 + 类别分布 + 涉华焦点
 *      + 多源覆盖（信源分布）+ 关联实体推荐（标题碰撞）+ 预警图
 *   ⑤ 预警图（Leaflet）：国别事件热度圈 + 中资项目资产点位 + 实体中心脉冲
 *   ⑥ 情报卡片流（点击详情）+ 报告一键复制导出 + 实体词全文高亮
 *   ⑦ v2 首页动态面板：最近作战 / 全球热点实体榜（24h 聚合）/ 今日核心焦点
 *   ⑧ v5 交互选项框（任务 #516）：国别/威胁组织/中资项目/主题子题四面板，
 *      主题模板直接作战 + 主体×事件子题「#」自主组合
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
      var restored = false;
      try {
        var last = JSON.parse(localStorage.getItem('orps_threatroom_last') || 'null');
        if (last && last.entity && last.items && last.items.length) {
          this._entity = last.entity; this._items = last.items;
          this._collect = last.collect || null; this._days = last.days || 7;
          this._renderReport();
          restored = true;
        }
      } catch (e) {}
      /* v2：无报告时渲染首页动态面板（消灭搜索框下方留白） */
      if (!restored) this._renderDeck();
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
    /* v5 交互选项框（任务 #516）：国别/组织/项目/主题四面板 */
    s += '.tr-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}';
    s += '.tr-tab{font-size:11.5px;padding:4px 13px;border:1px solid var(--border2,#1e2a40);border-radius:6px;cursor:pointer;color:var(--text2,#aab8d0);background:transparent;user-select:none}';
    s += '.tr-tab:hover{border-color:var(--cyan,#00d4ff);color:var(--cyan,#00d4ff)}';
    s += '.tr-tab.on{border-color:var(--cyan,#00d4ff);color:var(--cyan,#00d4ff);background:#00d4ff12;font-weight:700}';
    s += '.tr-optbox{display:none;border:1px dashed var(--border2,#1e2a40);border-radius:8px;padding:10px 10px 6px;margin-bottom:10px;background:var(--bg2,#0b1322)}';
    s += '.tr-optbox.show{display:block}';
    s += '.tr-optwrap{display:flex;gap:6px;flex-wrap:wrap;max-height:190px;overflow-y:auto;align-items:flex-start;align-content:flex-start}';
    s += '.tr-opt{font-size:11.5px;padding:3px 10px;border:1px solid var(--border2,#1e2a40);border-radius:12px;cursor:pointer;color:var(--text2,#aab8d0);white-space:nowrap}';
    s += '.tr-opt:hover{border-color:var(--cyan,#00d4ff);color:var(--cyan,#00d4ff)}';
    s += '.tr-opt.run{border-color:var(--orange,#f59e0b)66;color:var(--orange,#f59e0b)}';
    s += '.tr-optg{font-size:10px;color:var(--text3,#7a8aa3);width:100%;margin:6px 0 2px;letter-spacing:1px}';
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
    /* ── v2 首页动态面板（消灭搜索框下方留白） ── */
    s += '.tr-live{display:none;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--text2,#aab8d0)}';
    s += '.tr-hcard{flex-shrink:0;min-width:150px;max-width:210px;border:1px solid var(--border2,#1e2a40);border-radius:8px;padding:9px 12px;cursor:pointer;background:var(--bg2,#0d1524)}';
    s += '.tr-hcard:hover{border-color:var(--cyan,#00d4ff)}';
    s += '.tr-hotrow{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;cursor:pointer;border-radius:4px;padding:2px 4px}';
    s += '.tr-hotrow:hover{background:#00d4ff0d}';
    s += '.tr-hotbar{height:9px;border-radius:2px;background:linear-gradient(90deg,#00d4ff,#0066ff88);min-width:2px}';
    s += '.tr-coreit{border-left:3px solid var(--red,#ef4444);border-radius:6px;padding:7px 10px;margin-bottom:7px;cursor:pointer;background:var(--bg2,#0d1524);font-size:12px;color:var(--text,#e8eefc);line-height:1.5}';
    s += '.tr-coreit:hover{background:#ef444408}';
    s += '.tr-srcrow{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:11.5px}';
    s += '.tr-srcbar{height:9px;border-radius:2px;background:linear-gradient(90deg,#22c55e,#00d4ff88);min-width:2px;opacity:.85}';
    s += '.tr-rel{font-size:11.5px;padding:4px 12px;border:1px solid var(--border2,#1e2a40);border-radius:13px;cursor:pointer;color:var(--text2,#aab8d0);display:inline-flex;gap:6px;align-items:center;margin:0 6px 7px 0}';
    s += '.tr-rel:hover{border-color:var(--cyan,#00d4ff);color:var(--cyan,#00d4ff)}';
    s += '.tr-rel b{color:var(--orange,#f59e0b)}';
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
    /* v5 交互选项框（任务 #516）：四面板——国别/组织/项目/主题（可点开选择，主题支持子题组合） */
    s += '<div class="tr-tabs" id="tr-tabs">';
    s += '<span class="tr-tab" data-tab="country">🗺️ 国别</span>';
    s += '<span class="tr-tab" data-tab="org">🎯 威胁组织</span>';
    s += '<span class="tr-tab" data-tab="project">🏗️ 中资项目</span>';
    s += '<span class="tr-tab" data-tab="theme">💡 主题子题</span>';
    s += '</div>';
    s += '<div class="tr-optbox" id="tr-optbox"></div>';
    s += '<div class="tr-live" id="tr-live"></div>';
    s += '</div>';
    /* 进度条 */
    s += '<div class="tr-stage" id="tr-stage"></div>';
    /* v2 首页动态面板（无报告时展示：最近作战 / 热点实体榜 / 今日核心焦点） */
    s += '<div id="tr-deck"></div>';
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
    if (q) {
      q.onkeydown = function (e) { if (e.key === 'Enter') self.run(q.value); };
      /* v2 实体速览：多事件兜底（input/IME/keyup/手动触发）防 headless + 中文 IME
       * 边界场景；200ms 防抖；初始有值时也跑一次（chip 点击后等场景） */
      var deb = null;
      var fire = function () {
        if (deb) clearTimeout(deb);
        deb = setTimeout(function () { self._liveDetect(q.value); }, 200);
      };
      q.oninput = fire;
      q.onkeyup = fire;
      q.oncompositionend = fire;
      if (q.value && String(q.value).trim()) fire();
    }
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
    /* v5 交互选项框（任务 #516）：tab 切换 + 面板点击委托 */
    var tabs = document.getElementById('tr-tabs');
    if (tabs) tabs.onclick = function (e) {
      var t = e.target.closest ? e.target.closest('.tr-tab') : null;
      if (!t) return;
      var tab = t.getAttribute('data-tab');
      var box = document.getElementById('tr-optbox');
      Array.prototype.forEach.call(tabs.querySelectorAll('.tr-tab'), function (x) { x.classList.remove('on'); });
      if (box && box.classList.contains('show') && box.getAttribute('data-cur') === tab) {
        box.classList.remove('show'); box.setAttribute('data-cur', ''); return;   /* 再点同 tab 收起 */
      }
      t.classList.add('on');
      self._renderOptPanel(tab);
    };
    var optbox = document.getElementById('tr-optbox');
    if (optbox) optbox.onclick = function (e) {
      var t = e.target.closest ? e.target.closest('.tr-opt') : null;
      if (!t) return;
      var run = t.getAttribute('data-run');
      if (run) {   /* 直接发起作战 */
        var inp = document.getElementById('tr-q');
        if (inp) inp.value = run;
        self.run(run);
        return;
      }
      var add = t.getAttribute('data-add');
      if (add) {   /* 子题追加：「中资」+点「绑架」→ 中资#绑架 */
        var inp2 = document.getElementById('tr-q');
        if (!inp2) return;
        var cur = String(inp2.value || '').trim();
        if (!cur) inp2.value = add;
        else {
          var parts = cur.split(/[#＃]+/).map(function (x) { return x.trim(); }).filter(Boolean);
          if (parts.indexOf(add) < 0) parts.push(add);
          inp2.value = parts.join('#');
        }
        inp2.focus();
        self._liveDetect(inp2.value);
      }
    };
  },

  /* ═══════════ v5 交互选项框渲染（任务 #516） ═══════════ */
  _renderOptPanel: function (tab) {
    var box = document.getElementById('tr-optbox');
    if (!box) return;
    var self = this, html = '';
    if (tab === 'country') {
      html += '<div class="tr-optg">全部国家（红字 = 库内 24h 预警数，点击发起国别作战）</div>';
      html += '<div class="tr-optwrap">';
      (typeof COUNTRIES !== 'undefined' ? COUNTRIES : []).forEach(function (c) {
        var hot = self._country24h(c.name);
        html += '<span class="tr-opt" data-run="' + self._esc(c.name) + '">' + self._esc(c.name) +
          (hot ? ' <b style="color:var(--red,#ef4444)">' + hot + '</b>' : '') + '</span>';
      });
      html += '</div>';
    } else if (tab === 'org') {
      html += '<div class="tr-optg">威胁组织库（点击发起组织专项作战）</div>';
      html += '<div class="tr-optwrap">';
      var orgs = (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) ? THREAT_DATA.organizations : [];
      orgs.forEach(function (o) {
        var reg = (o.operatingRegions || []).slice(0, 2).join('、');
        html += '<span class="tr-opt" data-run="' + self._esc(o.name) + '" title="' + self._esc(reg) + '">' + self._esc(o.name) + '</span>';
      });
      html += '</div>';
    } else if (tab === 'project') {
      /* 项目按东道国分组（ENTERPRISES p.n/p.c 缩写字段 + ENTITY.PROJECTS 官方框架库，名称去重） */
      var byC = {}, seenP = {}, order = [];
      (typeof ENTERPRISES !== 'undefined' ? ENTERPRISES : []).forEach(function (ent) {
        (ent.projects || []).forEach(function (p) {
          var nm = p.name || p.n || '', cy = p.country || p.c || '';
          if (!nm || !cy) return;
          var k = nm + '@' + cy; if (seenP[k]) return; seenP[k] = 1;
          if (!byC[cy]) { byC[cy] = []; order.push(cy); }
          byC[cy].push(nm);
        });
      });
      try {
        if (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) ENTITY.PROJECTS.forEach(function (p) {
          var nm = p.name || '', cy = p.country || '';
          if (typeof ENTITY.normalizeCountry === 'function') { try { cy = ENTITY.normalizeCountry(cy); } catch (e) {} }
          if (!nm || !cy) return;
          var k = nm + '@' + cy; if (seenP[k]) return; seenP[k] = 1;
          if (!byC[cy]) { byC[cy] = []; order.push(cy); }
          byC[cy].push(nm);
        });
      } catch (e) {}
      order.sort(function (a, b) { return byC[b].length - byC[a].length; });
      html += '<div class="tr-optg">中资海外项目库 ' + Object.keys(seenP).length + ' 个（按东道国分组，点击发起项目专项作战）</div>';
      html += '<div class="tr-optwrap">';
      order.forEach(function (cy) {
        html += '<span class="tr-optg" style="margin-top:6px">📍 ' + self._esc(cy) + '（' + byC[cy].length + '）</span>';
        byC[cy].forEach(function (nm) {
          html += '<span class="tr-opt" data-run="' + self._esc(nm) + '" title="' + self._esc(cy) + '">' + self._esc(nm) + '</span>';
        });
      });
      html += '</div>';
    } else if (tab === 'theme') {
      html += '<div class="tr-optg">① 作战模板（点击直接发起，多子题按【涉华 × 事件】双要素相关性过滤）</div>';
      html += '<div class="tr-optwrap">';
      [['中资#抢劫', '中资企业/人员被抢劫'], ['中资#绑架', '中资人员遭绑架'], ['中资#袭击', '中资目标遇袭'],
       ['中国公民#安全', '中国公民海外安全事件'], ['华人#袭击', '华人华侨遇袭'], ['中企#抗议', '中资企业遭抗议'],
       ['中企#制裁', '中企被制裁/合规风险'], ['一带一路#恐袭', 'BRI 沿线恐袭'], ['中资项目#冲突', '项目所在地冲突'],
       ['中国工人#遇险', '中方工人遇险'], ['中国船员#海盗', '船员海盗劫持']].forEach(function (t) {
        html += '<span class="tr-opt run" data-run="' + self._esc(t[0]) + '" title="' + self._esc(t[1]) + '">' + self._esc(t[0]) + '</span>';
      });
      html += '</div>';
      html += '<div class="tr-optg">② 自主组合子题（先点主体要素，再点事件要素，自动用「#」拼接后启动作战）</div>';
      html += '<div class="tr-optwrap">';
      ['中资', '中国公民', '华人', '中企', '中资项目', '一带一路', '中国工人', '中国船员', '孔子学院'].forEach(function (w) {
        html += '<span class="tr-opt" data-add="' + self._esc(w) + '">' + self._esc(w) + '</span>';
      });
      ['抢劫', '绑架', '袭击', '恐袭', '抗议', '制裁', '骚乱', '冲突', '敲诈', '勒索', '撤离', '安全事件'].forEach(function (w) {
        html += '<span class="tr-opt" data-add="' + self._esc(w) + '" style="border-color:var(--orange,#f59e0b)44">' + self._esc(w) + '</span>';
      });
      html += '</div>';
    }
    box.innerHTML = html;
    box.classList.add('show');
    box.setAttribute('data-cur', tab);
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

  /* ═══════════ v2 实体速览（输入实时识别反馈） ═══════════ */
  _liveDetect: function (v) {
    var el = document.getElementById('tr-live');
    if (!el) return;
    var q = String(v || '').trim();
    if (!q) { el.style.display = 'none'; el.innerHTML = ''; return; }
    var e = this._detectEntity(q);
    var html = '';
    if (e && e.type !== 'keyword') {
      html += '<span class="tr-badge" style="color:var(--cyan,#00d4ff);border-color:var(--cyan,#00d4ff)44">已识别' + this._typeLabel(e.type) + '</span>';
      html += '<span style="color:var(--text,#e8eefc);font-weight:700">' + this._esc(e.cn) + '</span>';
      if (e.type === 'country') {
        var hot = this._country24h(e.cn);
        var projs = this._projCount(e.cn);
        html += '<span style="color:var(--text3,#7a8aa3)">库内 24h 预警 ' + hot + ' 条 · 关联中资项目 ' + projs + ' 个</span>';
      } else if (e.type === 'org') {
        html += '<span style="color:var(--text3,#7a8aa3)">别名 ' + (e.aliases || []).slice(0, 2).join(' / ') + (e.regions && e.regions.length ? ' · 活动区域 ' + e.regions.slice(0, 2).join('、') : '') + '</span>';
      } else if (e.type === 'project') {
        html += '<span style="color:var(--text3,#7a8aa3)">' + this._esc(e.ent || '') + (e.country ? ' · 东道国 ' + this._esc(e.country) : '') + (e.inv ? ' · 投资 ' + e.inv + ' 亿' : '') + (e.pers ? ' · 人员 ' + e.pers + ' 人' : '') + '</span>';
      }
      html += '<span style="color:var(--green,#22c55e)">✓ 按实体专项采集（多维检索矩阵）</span>';
    } else {
      html += '<span class="tr-badge" style="color:var(--cyan,#00d4ff);border-color:var(--cyan,#00d4ff)44">关键词作战</span>';
      html += '<span style="color:var(--text,#e8eefc);font-weight:700">' + this._esc(q) + '</span>';
      html += '<span style="color:var(--text3,#7a8aa3)">主题自动译为多路外文关键字全网碰撞 GDELT · Google News · AP；「#」拆分子题后按【双要素】过滤——涉华主题须同时命中涉华要素+事件要素</span>';
      html += '<span style="color:var(--green,#22c55e)">✓ 任意主题可搜，实体库仅作增强</span>';
    }
    el.innerHTML = html;
    el.style.display = 'flex';
  },

  /* 国别 24h 预警量（ALERTS 聚合，全真实数据） */
  _country24h: function (name) {
    var n = 0, cut = Date.now() - 24 * 3600 * 1000;
    (typeof ALERTS !== 'undefined' ? ALERTS : []).forEach(function (a) {
      if (String(a.country || '') === name) {
        var t = Date.parse(String(a.time || '').replace(' ', 'T'));
        if (!isNaN(t) && t >= cut) n++;
      }
    });
    return n;
  },

  _projCount: function (country) {
    /* 2026-08-31 修正：与后端 _assetList 同口径——ENTERPRISES 项目（p.c 缩写字段）
     * + ENTITY.PROJECTS 官方框架 61 项目库，按名去重。旧版只数 ENTERPRISES 漏了一半。 */
    var n = 0, seen = {};
    (typeof ENTERPRISES !== 'undefined' ? ENTERPRISES : []).forEach(function (ent) {
      (ent.projects || []).forEach(function (p) {
        if (p.c === country && p.n) { var k = p.n + '@' + country; if (!seen[k]) { seen[k] = 1; n++; } }
      });
    });
    try {
      if (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) ENTITY.PROJECTS.forEach(function (p) {
        var cy = p.country || '';
        if (typeof ENTITY.normalizeCountry === 'function') { try { cy = ENTITY.normalizeCountry(cy); } catch (e) {} }
        if (cy === country && p.name) { var k = p.name + '@' + country; if (!seen[k]) { seen[k] = 1; n++; } }
      });
    } catch (e) {}
    return n;
  },

  /* ═══════════ v2 首页动态面板 ═══════════ */
  _renderDeck: function () {
    var deck = document.getElementById('tr-deck');
    if (!deck) return;
    var self = this;
    var html = '';

    /* ① 最近作战（横滑卡） */
    var hist = this._histGet();
    html += '<div class="card" style="margin-bottom:12px;padding:14px">';
    html += '<div class="card-tt"><span class="ic">🕘</span>最近作战<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">' + (hist.length ? '点击恢复 · 最近 ' + hist.length + ' 次' : '尚无记录') + '</span></div>';
    if (hist.length) {
      html += '<div style="display:flex;gap:8px;margin-top:10px;overflow-x:auto;padding-bottom:4px">';
      hist.forEach(function (h) {
        var gc = h.lv === 'red' ? 'var(--red,#ef4444)' : h.lv === 'orange' ? 'var(--orange,#f59e0b)' : h.lv === 'yellow' ? 'var(--yellow,#eab308)' : h.lv === 'blue' ? '#38bdf8' : 'var(--green,#22c55e)';
        html += '<div class="tr-hcard" data-q="' + self._esc(h.cn) + '">' +
          '<div style="display:flex;align-items:center;gap:6px"><span style="font-weight:700;color:var(--text,#e8eefc);font-size:13px">' + self._esc(h.cn) + '</span>' +
          '<span style="font-size:10px;color:var(--text3,#7a8aa3)">' + self._typeLabel(h.type) + '</span></div>' +
          '<div style="display:flex;gap:10px;margin-top:5px;font-size:10.5px;color:var(--text3,#7a8aa3)">' +
          '<span style="color:' + gc + ';font-weight:700">' + self._esc(h.gt || '—') + '</span>' +
          '<span>' + (h.n || 0) + ' 条</span><span>' + self._ago(h.t) + '</span></div></div>';
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">尚无作战记录——输入任意实体（国家 / 恐怖组织 / 中资项目 / 关键词）发起第一次专项全网作战</div>';
    }
    html += '</div>';

    /* ② 双栏：全球热点实体榜（24h）+ 今日核心焦点 */
    var hot = this._hotEntities();
    var core = this._todayCore();
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">';
    html += '<div class="card" style="flex:1.15;min-width:330px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">🔥</span>全球热点实体榜<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">近 24h 预警国别聚合 · 点击发起作战</span></div>';
    if (hot.length) {
      var maxH = hot[0][1];
      html += '<div style="margin-top:8px">';
      hot.forEach(function (h) {
        var w = Math.round(h[1] / maxH * 100);
        html += '<div class="tr-hotrow" data-q="' + self._esc(h[0]) + '">' +
          '<span style="width:88px;flex-shrink:0;color:var(--text,#e8eefc);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + self._esc(h[0]) + '">' + self._esc(h[0]) + '</span>' +
          '<div style="flex:1"><div class="tr-hotbar" style="width:' + Math.max(2, w) + '%"></div></div>' +
          '<span style="width:30px;text-align:right;color:' + (h[1] >= maxH * 0.66 ? 'var(--red,#ef4444)' : h[1] >= maxH * 0.33 ? 'var(--orange,#f59e0b)' : 'var(--text3,#7a8aa3)') + ';font-weight:700">' + h[1] + '</span></div>';
      });
      html += '</div>';
    } else html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">通道预留：24h 内暂无预警数据</div>';
    html += '</div>';
    html += '<div class="card" style="flex:1;min-width:300px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">⚡</span>今日核心焦点<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">★核心 / 红色预警 · 点击跟踪</span></div>';
    if (core.length) {
      html += '<div style="margin-top:8px">';
      core.forEach(function (a) {
        html += '<div class="tr-coreit" data-q="' + self._esc(a.country || '') + '">' +
          '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + self._esc(String(a.title_zh || a.title || '')) + '</div>' +
          '<div style="font-size:10px;color:var(--text3,#7a8aa3);margin-top:3px">📍' + self._esc(a.country || '—') + ' · ' + self._esc(a.source || '—') + ' · ' + String(a.time || '').slice(5, 16) + '</div></div>';
      });
      html += '</div>';
    } else html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">通道预留：今日暂无核心预警</div>';
    html += '</div></div>';

    deck.innerHTML = html;
    deck.style.display = 'block';
    /* 绑定点击：全部 → 填入搜索框并发起作战 */
    Array.prototype.forEach.call(deck.querySelectorAll('[data-q]'), function (el) {
      el.onclick = function () {
        var qv = el.getAttribute('data-q');
        if (!qv) return;
        var inp = document.getElementById('tr-q');
        if (inp) inp.value = qv;
        self.run(qv);
      };
    });
  },

  _ago: function (t) {
    var d = Date.now() - (t || 0);
    if (d < 3600 * 1000) return Math.max(1, Math.round(d / 60000)) + ' 分钟前';
    if (d < 24 * 3600 * 1000) return Math.round(d / 3600000) + ' 小时前';
    return Math.round(d / 86400000) + ' 天前';
  },

  /* 近 24h 预警国别聚合 Top12（ALERTS 全局数组，全真实数据） */
  _hotEntities: function () {
    var by = {}, cut = Date.now() - 24 * 3600 * 1000;
    (typeof ALERTS !== 'undefined' ? ALERTS : []).forEach(function (a) {
      var c = String(a.country || '').trim();
      if (!c || c === '国际') return;
      var t = Date.parse(String(a.time || '').replace(' ', 'T'));
      if (isNaN(t) || t < cut) return;
      by[c] = (by[c] || 0) + 1;
    });
    return Object.keys(by).map(function (k) { return [k, by[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
  },

  /* 今日核心/红色预警 Top6 */
  _todayCore: function () {
    var cut = Date.now() - 24 * 3600 * 1000;
    return (typeof ALERTS !== 'undefined' ? ALERTS : []).filter(function (a) {
      if (!a.is_core && a.level !== 'red') return false;
      var t = Date.parse(String(a.time || '').replace(' ', 'T'));
      return !isNaN(t) && t >= cut;
    }).slice(0, 6);
  },

  /* 作战历史（localStorage，最近 8 次） */
  _histGet: function () {
    try { return JSON.parse(localStorage.getItem('orps_threatroom_hist') || '[]'); } catch (e) { return []; }
  },
  _histPush: function () {
    if (!this._entity || !this._items.length) return;
    try {
      var st = this._stats(), grade = this._grade(st);
      var h = this._histGet().filter(function (x) { return x.cn !== THREATROOM._entity.cn; });
      h.unshift({ cn: this._entity.cn, type: this._entity.type, n: st.n, gt: grade.t, lv: grade.lv, t: Date.now() });
      localStorage.setItem('orps_threatroom_hist', JSON.stringify(h.slice(0, 8)));
    } catch (e) {}
  },

  /* ═══════════ 主流程 ═══════════ */
  run: function (raw) {
    if (this._busy) return;
    var e = this._detectEntity(raw);
    if (!e) { this._toast('请输入实体名称（国家 / 组织 / 项目 / 关键词）'); return; }
    this._busy = true;
    this._entity = e; this._items = []; this._collect = null; this._fresh = [];
    var self = this;
    var rep = document.getElementById('tr-rep');
    if (rep) { rep.style.display = 'none'; rep.innerHTML = ''; }
    var deck = document.getElementById('tr-deck');
    if (deck) deck.style.display = 'none';

    /* 阶段一：实体识别（即时） */
    this._stage('实体识别 <b class="ok">✓</b>「' + this._esc(e.cn) + '」（' + this._typeLabel(e.type) + '）→ 全网采集中：GDELT 检索矩阵 + Google News + HN Algolia + Yahoo News + AP 多引擎碰撞（任一引擎限流自动降级备胎）…');

    var base = this._apiBase();
    var t0 = Date.now();
    fetch(base + '/api/threatroom/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: e.type, cn: e.cn, en: e.en || '', aliases: e.aliases || [] }),
      signal: AbortSignal.timeout(600000)   /* v2 矩阵 16+ 路 + 翻译 80 条，实测 5-8 分钟 */
    }).then(function (r) { return r.ok ? r.json() : { ok: false, error: 'HTTP ' + r.status }; })
      .then(function (j) {
        self._collect = j;
        self._fresh = (j && j.ok && Array.isArray(j.fresh)) ? j.fresh : [];
        /* 服务端权威实体类型同步（gdCode 自动升级：前端 COUNTRIES 未收录的国家，服务端已按国家采集） */
        if (j && j.ok && j.type && j.type !== self._entity.type) { self._entity.type = j.type; }
        /* v8 引擎命中明细（GDELT 限流透明化：如实展示哪路通哪路断） */
        var _EN = { gdelt: 'GDELT', gnews: 'GNews', bing: 'Bing', yahoo: 'Yahoo', hn: 'HN', ap: 'AP' };
        var engS = '';
        if (j && j.ok && j.engines) {
          engS = '【引擎命中：' + Object.keys(j.engines).map(function (k) { return _EN[k] + ' ' + (j.engines[k] || 0); }).join(' / ') + (j.gdeltCooling ? '；GDELT 熔断已自动跳过' : '') + '】';
        }
        /* 阶段二完成 → 阶段三：库内联动 */
        var cTxt = j && j.ok
          ? ('全网采集完成：检索 ' + (j.collected || 0) + ' 条 / 库内已有 ' + (j.webHits || 0) + ' 条 / 新入库 ' + (j.inserted || 0) + ' 条 / 前置拒 ' + (j.rejected || 0) + ' 条（' + ((j.ms || 0) / 1000).toFixed(1) + 's）' + engS + '→ 正在拉取库内 ' + self._days + ' 天联动数据…')
          : ('全网采集未新增（' + self._esc(String((j && j.error) || j.note || '无返回')) + '）→ 正在拉取库内 ' + self._days + ' 天联动数据…');
        self._stage(cTxt);
        var qs = '?type=' + encodeURIComponent(e.type) + '&cn=' + encodeURIComponent(e.cn) +
          '&en=' + encodeURIComponent(e.en || '') + '&aliases=' + encodeURIComponent((e.aliases || []).join(',')) +
          '&days=' + self._days;
        return fetch(base + '/api/threatroom/data' + qs, { signal: AbortSignal.timeout(30000) });
      })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        var dbItems = Array.isArray(items) ? items : [];
        /* v6（任务 #517）：本轮全网实时结果优先——collect 直出的 fresh 条目（已过双要素闸
         * +翻译+富化）排最前带「🌐 本次全网」徽标，库内条目按 URL/标题去重后作补充 */
        self._items = self._mergeFresh(dbItems);
        var webN = (self._fresh || []).length, dbN = self._items.length - webN;
        /* 阶段四：生成报告 */
        self._stage('全网实时命中 ' + webN + ' 条 + 库内联动补充 ' + dbN + ' 条 → 生成态势预警分析报告…');
        setTimeout(function () {
          self._renderReport();
          self._stage(null); /* 完成隐藏进度条 */
          self._busy = false;
          try {
            localStorage.setItem('orps_threatroom_last', JSON.stringify({
              entity: self._entity, items: self._items.slice(0, 200), collect: self._collect, days: self._days, t: Date.now()
            }));
          } catch (ex) {}
          /* v2 作战历史存档（首页「最近作战」面板数据源） */
          self._histPush();
        }, 350);
      })
      .catch(function (err) {
        self._stage(null);
        self._busy = false;
        self._toast('采集失败：' + self._esc(err.message || String(err)) + '（引擎网络波动，稍后重试；也可直接查库内数据）');
      });
  },

  /* fresh（本轮全网检索直出）与库内条目合并：fresh 在前，URL/标题去重防重复卡 */
  _mergeFresh: function (dbItems) {
    var fresh = (this._fresh || []).filter(function (x) { return x && (x.title || x.url); });
    if (!fresh.length) return dbItems;
    var seen = {}, out = [];
    fresh.forEach(function (it) {
      var k = it.url || ('t:' + String(it.title || ''));
      if (seen[k]) return; seen[k] = 1;
      it._web = true; out.push(it);
    });
    dbItems.forEach(function (it) {
      var k = it.url || ('t:' + String(it.title || ''));
      if (seen[k]) return; seen[k] = 1; out.push(it);
    });
    return out;
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
    /* v2：采集深度提升后 n 可达数百——体量分封顶 50，等级由预警密度主导而非条数刷高 */
    var score = Math.min(st.n, 50) + st.red * 8 + st.orange * 4 + st.cn * 3 + st.core * 2;
    var g = score >= 80 ? { t: '红色 · Ⅰ级', c: 'var(--red,#ef4444)', lv: 'red' }
      : score >= 45 ? { t: '橙色 · Ⅱ级', c: 'var(--orange,#f59e0b)', lv: 'orange' }
      : score >= 20 ? { t: '黄色 · Ⅲ级', c: 'var(--yellow,#eab308)', lv: 'yellow' }
      : score > 0 ? { t: '蓝色 · Ⅳ级', c: '#38bdf8', lv: 'blue' }
      : { t: '平稳 · 无预警', c: 'var(--green,#22c55e)', lv: 'green' };
    g.score = score;
    return g;
  },

  _judgeText: function (e, st, grade, collect) {
    /* #519（2026-08-31 引擎语义根治）：根据 collect 响应把「全网命中」与「库内命中」分别呈现——
     * 即便库内 st.n=0，只要本轮全网有 fresh 命中，研判结论就改为「全网命中 N 条」，
     * 不再说「监测盲区或信息真空」误导用户（用户原话：刚果（金）不可能没有数据）。 */
    var webN = (collect && Array.isArray(collect.fresh)) ? collect.fresh.length : (this._fresh ? this._fresh.length : 0);
    if (!st.n && !webN) return '「' + e.cn + '」库内近 ' + this._days + ' 天与本轮全网检索均无有效命中；可能关键词过窄或源覆盖较弱，建议放宽检索词或更换主题词重试。';
    if (!st.n && webN) return '「' + e.cn + '」库内近 ' + this._days + ' 天无相关数据；本轮全网命中 ' + webN + ' 条（GDELT/GNews/AP 三引擎实时检索）——库内尚未沉淀，请持续关注或加入我的关注。';
    var parts = [];
    parts.push('「' + e.cn + '」（' + this._typeLabel(e.type) + '）近 ' + this._days + ' 天库内关联数据 ' + st.n + ' 条，综合威胁等级 ' + grade.t + '（' + grade.score + ' 分）');
    if (webN) parts.push('本轮全网命中 ' + webN + ' 条已纳入研判');
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
    var webN = this._items.filter(function (x) { return x._web; }).length;
    if (this._fresh && this._fresh.length) html += this._kpi('本轮全网命中', this._fresh.length + ' 条', 'var(--green,#22c55e)');
    if (this._collect && this._collect.ok) html += this._kpi('本轮新采集入库', this._collect.inserted + ' / ' + this._collect.collected + ' 条', 'var(--cyan,#00d4ff)');
    html += '</div>';
    /* v4：主题→外文关键字链路（用户铁律：引擎是中转点，把主题译成外文全网碰撞） */
    if (this._collect && this._collect.ok && this._collect.keywords && this._collect.keywords.length) {
      html += '<div style="margin-top:10px;font-size:11.5px;color:var(--text2,#aab8d0)">' +
        '<span style="color:var(--cyan,#00d4ff);font-weight:700">🌐 检索链路：</span>' +
        '<span style="color:var(--text,#e8eefc);font-weight:600">' + this._esc(e.cn) + '</span>' +
        ' <span style="color:var(--text3,#7a8aa3)">→</span> ' +
        this._collect.keywords.map(function (k) {
          return '<span class="tr-badge" style="color:var(--orange,#f59e0b);border-color:var(--orange,#f59e0b)44">' + THREATROOM._esc(k) + '</span>';
        }).join(' ') +
        /* v8 引擎命中明细（哪路通哪路断一目了然，命中绿色/空转灰色） */
        (function () {
          var c = THREATROOM._collect, EN = { gdelt: 'GDELT', gnews: 'Google News', bing: 'Bing News', yahoo: 'Yahoo News', hn: 'HN Algolia', ap: 'AP' };
          if (!c || !c.engines) return ' <span style="color:var(--text3,#7a8aa3)">→ GDELT · Google News · Bing · Yahoo · AP 全网碰撞</span>';
          return ' <span style="color:var(--text3,#7a8aa3)">→</span> ' + Object.keys(EN).map(function (k) {
            var n = c.engines[k] || 0;
            return '<span style="' + (n ? 'color:var(--green,#22c55e);font-weight:700' : 'color:var(--text3,#7a8aa3)') + '">' + EN[k] + ' ' + n + '</span>';
          }).join(' / ') + (c.gdeltCooling ? ' <span style="color:var(--orange,#f59e0b)">（GDELT 限流熔断已跳过）</span>' : '');
        })() + '</div>';
    }
    /* 研判文字 */
    html += '<div style="margin-top:10px;font-size:12.5px;line-height:1.85;color:var(--text,#e8eefc)">' +
      '<span style="color:var(--cyan,#00d4ff);font-weight:700">🧠 值班研判：</span>' + this._esc(this._judgeText(e, st, grade, this._collect)) + '</div>';
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

    /* ── v2 多源覆盖 + 关联实体推荐 双栏 ── */
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">';
    var srcs = this._srcStats();
    html += '<div class="card" style="flex:1;min-width:320px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">🛰️</span>多源覆盖<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">' + srcs.total + ' 条 · ' + srcs.list.length + ' 个独立信源</span></div>';
    if (srcs.list.length) {
      var maxS = srcs.list[0][1];
      html += '<div style="margin-top:8px">';
      srcs.list.forEach(function (s) {
        var w = Math.round(s[1] / maxS * 100);
        html += '<div class="tr-srcrow"><span style="width:140px;flex-shrink:0;color:var(--text2,#aab8d0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + THREATROOM._esc(s[0]) + '">' + THREATROOM._esc(s[0]) + '</span>' +
          '<div style="flex:1"><div class="tr-srcbar" style="width:' + Math.max(2, w) + '%"></div></div>' +
          '<span style="width:30px;text-align:right;color:var(--text3,#7a8aa3)">' + s[1] + '</span></div>';
      });
      html += '</div>';
    } else html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">通道预留：无信源数据</div>';
    html += '</div>';
    /* 关联实体推荐（情报流标题中碰撞出的组织/项目名） */
    var rels = this._relatedChips();
    html += '<div class="card" style="flex:1;min-width:320px;padding:12px">';
    html += '<div class="card-tt"><span class="ic">🔗</span>关联实体推荐<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">情报流碰撞 · 点击发起专项作战</span></div>';
    if (rels.length) {
      html += '<div style="margin-top:10px">';
      rels.forEach(function (r) {
        html += '<span class="tr-rel" data-rq="' + THREATROOM._esc(r[0]) + '">' + THREATROOM._esc(r[0]) + '<b>' + r[1] + '</b></span>';
      });
      html += '</div>';
      html += '<div style="font-size:10.5px;color:var(--text3,#7a8aa3);margin-top:4px">从 ' + this._items.length + ' 条情报标题中自动碰撞出的高频关联实体（组织 / 中资项目）</div>';
    } else html += '<div style="font-size:11.5px;color:var(--text3,#7a8aa3);padding:8px 0">窗口内情报未碰撞出已知组织/项目实体</div>';
    html += '</div></div>';

    /* ── 情报卡片流 ── */
    html += '<div class="card" style="padding:12px">';
    html += '<div class="card-tt"><span class="ic">📡</span>专项情报流<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text3,#7a8aa3)">' + st.n + ' 条（🌐 本次全网 ' + webN + ' · 库内联动 ' + (st.n - webN) + '）· 点击查看详情 · 实体词已高亮</span></div>';
    var feed = this._items.slice(0, 80);
    if (feed.length) {
      html += '<div style="margin-top:8px;max-height:520px;overflow-y:auto" id="tr-feed">';
      feed.forEach(function (it) {
        var lc = THREATROOM._lvColor(it.level || '');
        html += '<div class="tr-item" style="border-left-color:' + (it._web ? 'var(--green,#22c55e)' : lc) + '" data-i="' + THREATROOM._idx(it) + '">' +
          '<div class="t">' + THREATROOM._hl(THREATROOM._title(it), e) + '</div>' +
          '<div class="m"><span>' + THREATROOM._esc(it.source || '—') + '</span><span>' + THREATROOM._when(it) + '</span>' +
          '<span>' + (THREATROOM.DT_CN[it.data_type] || it.data_type || '开源情报') + '</span>' +
          (it.country ? '<span>📍' + THREATROOM._esc(it.country) + '</span>' : '') +
          (it._web ? '<span class="tr-badge" style="color:var(--green,#22c55e);border-color:var(--green,#22c55e)55">🌐 本次全网</span>' : '') +
          (it.chinaRelated === true ? '<span class="tr-badge" style="color:var(--orange,#f59e0b);border-color:var(--orange,#f59e0b)55">涉华</span>' : '') +
          (it.is_core ? '<span class="tr-badge" style="color:var(--red,#ef4444);border-color:var(--red,#ef4444)55">★核心</span>' : '') +
          (it.level ? '<span class="tr-badge" style="color:' + lc + ';border-color:' + lc + '55">' + THREATROOM._lvCN(it.level) + '</span>' : '') + '</div></div>';
      });
      html += '</div>';
    } else html += '<div style="font-size:12px;color:var(--text3,#7a8aa3);padding:14px 0">通道预留：本轮全网与库内均无该主题数据。点击「重新采集」或在顶部换关键词重试。</div>';
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
    Array.prototype.forEach.call(rep.querySelectorAll('.tr-rel[data-rq]'), function (el) {
      el.onclick = function () {
        var rq = el.getAttribute('data-rq');
        var inp = document.getElementById('tr-q');
        if (inp) inp.value = rq;
        self.run(rq);
      };
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

  /* v2 多源覆盖：按 URL 域名聚合信源分布（source 字段多为聚合器名不可用，域名才真实） */
  _srcStats: function () {
    var by = {}, total = 0;
    this._items.forEach(function (it) {
      total++;
      var h = '';
      try { h = new URL(String(it.url || '')).hostname.replace(/^www\./, ''); } catch (e) {
        h = String(it.source || '未知信源').replace(/^专项作战室·.*$/, '专项采集');
      }
      if (!h) h = '未知信源';
      by[h] = (by[h] || 0) + 1;
    });
    var list = Object.keys(by).map(function (k) { return [k, by[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    return { list: list, total: total };
  },

  /* v2 关联实体推荐：情报流标题碰撞 THREAT_DATA 组织名 + ENTERPRISES 项目名（当前实体除外） */
  _relatedChips: function () {
    var e = this._entity, self = this;
    var by = {};
    var texts = this._items.slice(0, 120).map(function (it) { return String(it.title_zh || '') + ' ' + String(it.title || ''); });
    (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations ? THREAT_DATA.organizations : []).forEach(function (o) {
      var nm = String(o.name || '');
      if (!nm || nm === e.cn) return;
      var c = 0;
      texts.forEach(function (t) { if (t.indexOf(nm) >= 0) c++; });
      if (c > 0) by[nm] = { n: c, type: 'org' };
    });
    (typeof ENTERPRISES !== 'undefined' ? ENTERPRISES : []).forEach(function (ent) {
      (ent.projects || []).forEach(function (p) {
        var nm = String(p.n || '');
        if (!nm || nm === e.cn || nm.length < 3) return;
        var c = 0;
        texts.forEach(function (t) { if (t.indexOf(nm) >= 0) c++; });
        if (c > 0) by[nm] = { n: c, type: 'project' };
      });
    });
    return Object.keys(by).map(function (k) { return [k, by[k].n, by[k].type]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
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
    /* #524 用户指令八：作战室采集结果一键推送预警中心（TR- 前缀防重复） */
    html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">';
    if (it.url) html += '<a href="' + this._esc(it.url) + '" target="_blank" rel="noopener" style="color:var(--cyan,#00d4ff);font-size:12px">🔗 查看原文 →</a>';
    html += '<span style="flex:1"></span>';
    html += '<button onclick="THREATROOM._pushAlert(' + i + ')" style="background:rgba(0,212,255,0.12);border:1px solid var(--cyan,#00d4ff);color:var(--cyan,#00d4ff);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:700">📤 推送预警中心</button>';
    html += '</div>';
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

  /* ═══════════ 推送预警中心（#524 用户指令八） ═══════════
   * 采集流详情里发现合适情报，一键转入预警中心参与态势/研判/处置流程。
   * 双重防重复：① TR- 前缀 id 记录源条目 _trSrcId；② 标题归一键（去空格小写前20字符包含匹配）查同题。 */
  _pushAlert: function (i) {
    var it = this._items[i];
    if (!it) return;
    if (typeof DataHub === 'undefined' || typeof ALERTS === 'undefined') { this._toast('预警中心数据层未就绪'); return; }
    var title = this._title(it);
    var tkey = String(title || '').replace(/\s+/g, '').toLowerCase();
    var dup = null;
    for (var k = 0; k < ALERTS.length; k++) {
      var a = ALERTS[k];
      if (String(a.id || '').indexOf('TR-') === 0 && String(a._trSrcId || '') === String(it.id || '') && String(it.id || '') !== '') { dup = a; break; }
      var kk = String(a.title || a.title_zh || '').replace(/\s+/g, '').toLowerCase();
      if (tkey && kk && kk.length > 15 && tkey.length > 15 && (kk.indexOf(tkey.slice(0, 15)) >= 0 || tkey.indexOf(kk.slice(0, 15)) >= 0)) { dup = a; break; }
    }
    if (dup) { this._toast('该情报已在预警中心（同题条目存在），未重复推送'); return; }
    var now = new Date();
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    var desc = String(it.description || it.content || it.desc || it.summary || '').replace(/<[^>]+>/g, '').slice(0, 600);
    var obj = {
      id: 'TR-' + String(it.id || (Date.now() + '-' + i)),
      _trSrcId: String(it.id || ''),
      title: title,
      title_zh: it.title_zh || title,
      desc: desc,
      level: it.level || 'blue',
      type: it.data_type || 'osint_intel',
      country: it.country || '国际',
      time: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      publishedAt: it.publishedAt || it.time || '',
      source: it.source || '专项情报作战室',
      url: it.url || '',
      status: 'active',
      chinaRelated: it.chinaRelated === true,
      is_core: it.is_core === true,
      _sourceType: 'threatroom_push'
    };
    DataHub.add('alerts', obj);
    this._toast('已推送预警中心：' + String(title).slice(0, 32) + (String(title).length > 32 ? '…' : ''));
  },

  /* ═══════════ 报告导出 ═══════════ */
  _copyReport: function () {
    var e = this._entity, st = this._stats(), grade = this._grade(st);
    var L1 = [];
    L1.push('【专项态势预警分析报告】' + e.cn + '（' + this._typeLabel(e.type) + '）');
    L1.push('报告时间：' + new Date().toLocaleString('sv-SE') + '　窗口：近 ' + this._days + ' 天');
    L1.push('综合威胁等级：' + grade.t + '（' + grade.score + ' 分）');
    L1.push('关联数据 ' + st.n + ' 条｜红 ' + st.red + '｜橙 ' + st.orange + '｜黄 ' + st.yellow + '｜涉华 ' + st.cn + '｜核心 ' + st.core);
    if (this._collect && this._collect.ok) {
      var _wN = (this._collect.webHits || 0) + (this._collect.inserted || 0);
      L1.push('本轮专项采集：检索 ' + this._collect.collected + ' 条 / 库内已有 ' + (this._collect.webHits || 0) + ' 条 / 新入库 ' + (this._collect.inserted || 0) + ' 条 / 全网命中合计 ' + _wN + ' 条');
    }
    if (this._collect && this._collect.ok && this._collect.keywords && this._collect.keywords.length) L1.push('主题→外文检索词：' + this._collect.keywords.join(' / '));
    L1.push('');
    L1.push('【值班研判】' + this._judgeText(e, st, grade, this._collect));
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
