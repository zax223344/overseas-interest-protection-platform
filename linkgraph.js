/* ============================================================================
 * LINK_GRAPH — 全平台跨模块关联中枢（Cross-Module Link Graph）
 * ----------------------------------------------------------------------------
 * 解决的问题：
 *   13 个左侧功能区（态势总览/风险监测/威胁组织/情报影像中心/企业资产/预警中心/
 *   自动预警/风险矩阵/预测分析/AI报告/数据源库/数据中心/系统设置）各自持有数据，
 *   详情弹窗把"已经算出来的关联实体"渲染成死文本，模块之间无法互相跳转 —— 数据割裂。
 *
 * 设计要点：
 *   1) 统一实体口径：国名经 ENTITY.normalizeCountry 归一（中英文/别名互通）；
 *      威胁组织把 THREAT_DATA（静态档案）与 THREAT_ORGS_DB（真实采集）按 名称+别名
 *      交集合并为同一实体，彻底消除"两套威胁组织表互不认识"的根因。
 *   2) 统一反查：给定任意 ctx（国家/企业/组织/文本），一次性反查全部模块数据，
 *      产出可点击的关联卡片。
 *   3) 统一注入：所有详情弹窗末尾追加同一个「🔗 跨模块关联」面板，任意一处都能穿透。
 *
 * 零模拟数据铁律：本模块不生产任何数据，只做既有真实数据之间的检索与连接。
 * ========================================================================== */
var LINK_GRAPH = (function () {
  'use strict';

  var MAX_PER_GROUP = 6;   /* 每组最多展示条数 */
  var SCAN_LIMIT = 4000;   /* 数据中心单次扫描上限，防止大库卡顿 */

  /* ---------------- 基础工具 ---------------- */
  function _s(v) { return String(v == null ? '' : v); }
  function _esc(s) {
    return _s(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* 用于内联 onclick 的单引号字符串参数转义 */
  function _q(s) { return _s(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  function normCty(n) {
    n = _s(n).trim();
    if (!n) return '';
    try {
      if (typeof ENTITY !== 'undefined' && ENTITY.normalizeCountry) {
        var r = ENTITY.normalizeCountry(n);
        if (r) return r;
      }
    } catch (e) { }
    return n;
  }
  function isVagueCty(n) {
    return !n || n === '全球' || n === '未知' || n === '多国' || n === '国际' || n === '—';
  }
  /* 宽松国名比对：兼容"刚果(金)"/"刚果民主共和国" 之类的包含关系 */
  function ctyHit(list, v) {
    v = normCty(v);
    if (!v) return false;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a === v) return true;
      if (a.length >= 2 && v.length >= 2 && (a.indexOf(v) >= 0 || v.indexOf(a) >= 0)) return true;
    }
    return false;
  }
  function entHit(list, v) {
    v = _s(v).trim();
    if (!v) return false;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a) continue;
      if (a === v) return true;
      if (a.length >= 2 && v.indexOf(a) >= 0) return true;
      if (v.length >= 2 && a.indexOf(v) >= 0) return true;
    }
    return false;
  }

  /* ---------------- 统一威胁组织索引（打通两套数据源）---------------- */
  var _orgCache = null, _orgCacheAt = 0;
  function orgIndex() {
    var now = Date.now();
    if (_orgCache && (now - _orgCacheAt) < 20000) return _orgCache;
    var list = [];
    function findSame(names) {
      for (var i = 0; i < list.length; i++) {
        var ex = list[i];
        for (var j = 0; j < names.length; j++) {
          var n = _s(names[j]).trim();
          if (n.length < 2) continue;
          if (ex.names.indexOf(n) >= 0) return ex;
        }
      }
      return null;
    }
    function put(rec) {
      rec.names = (rec.names || []).map(function (x) { return _s(x).trim(); })
        .filter(function (x) { return x.length >= 2; });
      if (!rec.name || !rec.names.length) return;
      var ex = findSame(rec.names);
      if (ex) { /* 同一组织的两种表示 —— 合并 */
        rec.names.forEach(function (n) { if (ex.names.indexOf(n) < 0) ex.names.push(n); });
        (rec.regions || []).forEach(function (r) { if (r && ex.regions.indexOf(r) < 0) ex.regions.push(r); });
        if (rec.dbId && !ex.dbId) ex.dbId = rec.dbId;
        if (rec.tdId && !ex.tdId) ex.tdId = rec.tdId;
        if (rec.cat && !ex.cat) ex.cat = rec.cat;
        if (rec.level && !ex.level) ex.level = rec.level;
        ex.merged = !!(ex.dbId && ex.tdId);
        return;
      }
      list.push(rec);
    }
    try {
      if (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) {
        THREAT_DATA.organizations.forEach(function (o) {
          put({
            name: o.name, tdId: o.id, dbId: '',
            names: [o.name].concat(o.alias || o.aliases || []).filter(Boolean),
            regions: (o.operatingRegions || []).map(normCty).filter(Boolean),
            cat: o.category || '', level: o.threatLevel || '', merged: false
          });
        });
      }
    } catch (e) { }
    try {
      if (typeof THREAT_ORGS_DB !== 'undefined' && THREAT_ORGS_DB.getAll) {
        THREAT_ORGS_DB.getAll().forEach(function (o) {
          put({
            name: o.name, tdId: '', dbId: o.id,
            names: [o.name].concat(o.aliases || o.alias || []).filter(Boolean),
            regions: (o.active_regions || []).map(normCty).filter(Boolean),
            cat: o.category || '', level: o.threat_level || '', merged: false
          });
        });
      }
    } catch (e) { }
    _orgCache = list; _orgCacheAt = now;
    return list;
  }
  function invalidateOrgCache() { _orgCache = null; }

  function findOrg(name) {
    name = _s(name).trim();
    if (!name) return null;
    var all = orgIndex();
    for (var i = 0; i < all.length; i++) {
      if (all[i].names.indexOf(name) >= 0) return all[i];
    }
    for (var k = 0; k < all.length; k++) {
      for (var j = 0; j < all[k].names.length; j++) {
        var n = all[k].names[j];
        if (n.length >= 3 && name.indexOf(n) >= 0) return all[k];
      }
    }
    return null;
  }

  /* 统一打开威胁组织详情：优先真实采集库（信息更全），回退静态档案库 */
  function openOrg(name) {
    var rec = findOrg(name);
    if (!rec) { _toast('未找到该组织的档案：' + name); return; }
    try {
      if (rec.dbId && typeof MONITOR !== 'undefined' && MONITOR.showThreatOrgDetail) {
        MONITOR.showThreatOrgDetail(rec.dbId); return;
      }
    } catch (e) { }
    try {
      if (rec.tdId && typeof THREATS !== 'undefined' && THREATS.showDetail) {
        THREATS.showDetail(rec.tdId); return;
      }
    } catch (e) { }
    _toast('该组织暂无可展开的详情');
  }

  function _toast(m) { try { if (typeof showToast === 'function') showToast(m); else console.log(m); } catch (e) { } }

  /* ---------------- ctx 解析：把任意上下文归一为 实体三元组 ---------------- */
  function resolve(ctx) {
    ctx = ctx || {};
    var C = {}, E = {}, O = {};
    function addC(v) { v = normCty(v); if (v && !isVagueCty(v)) C[v] = 1; }
    function addE(v) { v = _s(v).trim(); if (v && v !== '—' && v !== '无') E[v] = 1; }
    function addO(v) { v = _s(v).trim(); if (v && v.length >= 2 && v !== '—') O[v] = 1; }

    addC(ctx.country); (ctx.countries || []).forEach(addC);
    addE(ctx.enterprise); (ctx.enterprises || []).forEach(addE);
    addO(ctx.org); (ctx.orgs || []).forEach(addO); (ctx.actors || []).forEach(addO);

    var text = _s(ctx.text);

    /* 从正文里补抽组织（打通"事件描述里提到 BLA，但字段里没有"的割裂） */
    if (text) {
      orgIndex().forEach(function (o) {
        for (var i = 0; i < o.names.length; i++) {
          var n = o.names[i];
          if (n.length >= 2 && text.indexOf(n) >= 0) { addO(o.name); break; }
        }
      });
    }
    /* 组织 → 活动区域，反哺国家维度（用户举例的"恐怖组织↔袭击事件"正是这条链） */
    Object.keys(O).forEach(function (on) {
      var rec = findOrg(on);
      if (rec) (rec.regions || []).forEach(addC);
    });
    /* 文本兜底抽国家 */
    if (text && !Object.keys(C).length) {
      try {
        (window.COUNTRIES || []).forEach(function (c) { if (c && c.name && text.indexOf(c.name) >= 0) addC(c.name); });
      } catch (e) { }
    }
    return {
      C: Object.keys(C), E: Object.keys(E), O: Object.keys(O),
      text: text, self: ctx.self || {}, excludeId: ctx.excludeId || ''
    };
  }

  /* ---------------- 各模块反向检索 ---------------- */
  function collect(r) {
    var g = [];
    var hasC = r.C.length, hasE = r.E.length, hasO = r.O.length;
    if (!hasC && !hasE && !hasO) return g;
    var selfMod = (r.self && r.self.module) || '';
    var selfKey = _s(r.self && r.self.key);

    function grp(icon, title, view, items) {
      items = (items || []).filter(Boolean);
      if (!items.length) return;
      g.push({ icon: icon, title: title, view: view, total: items.length, items: items.slice(0, MAX_PER_GROUP) });
    }

    /* 1) 风险监测 — 国家 */
    try {
      var ctys = (window.COUNTRIES || []).filter(function (c) { return c && ctyHit(r.C, c.name); });
      grp('🌍', '关联国家', 'monitor', ctys.map(function (c) {
        var ov = (typeof calcOverall === 'function') ? calcOverall(c.scores) : 0;
        var lv = (typeof getLevel === 'function') ? getLevel(ov) : { color: 'var(--cyan)', label: '' };
        return { t: (c.flag || '') + ' ' + c.name, s: '风险 ' + ov.toFixed(1) + ' · ' + lv.label, c: lv.color, fn: "showCtyDetail('" + _q(c.name) + "')" };
      }));
    } catch (e) { }

    /* 2) 企业资产 — 中资企业 */
    try {
      var ents = (window.ENTERPRISES || []).filter(function (x) {
        if (!x) return false;
        if (hasE && (entHit(r.E, x.short) || entHit(r.E, x.name))) return true;
        if (hasC && (x.countries || []).some(function (cn) { return ctyHit(r.C, cn); })) return true;
        return false;
      });
      grp('🏢', '关联中资企业', 'assets', ents.map(function (x) {
        var rk = (typeof getEntRisk === 'function') ? getEntRisk(x) : 0;
        var lv = (typeof getLevel === 'function') ? getLevel(rk) : { color: 'var(--cyan)', label: '' };
        return { t: x.short || x.name, s: (x.industry || '') + ' · 风险 ' + rk.toFixed(1), c: lv.color, fn: 'showEntDetail(' + x.id + ')' };
      }));
    } catch (e) { }

    /* 3) 企业资产 — 海外项目 */
    try {
      if (typeof ENTERPRISE_DB !== 'undefined' && ENTERPRISE_DB.getAll) {
        var projs = ENTERPRISE_DB.getAll().filter(function (p) {
          if (!p) return false;
          if (hasC && ctyHit(r.C, p.country)) return true;
          if (hasE && entHit(r.E, p.enterprise)) return true;
          return false;
        });
        var rlColor = { critical: 'var(--red)', high: 'var(--orange)', medium: 'var(--yellow)', low: 'var(--green)' };
        grp('📦', '关联海外项目', 'assets', projs.map(function (p) {
          return {
            t: p.project_name || p.name || '(未命名项目)',
            s: (p.country || '') + ' · ' + (p.sector || '') + (p.investment ? ' · ' + p.investment : ''),
            c: rlColor[p.risk_level] || 'var(--cyan)',
            fn: "LINK_GRAPH.openProject('" + _q(p.id) + "')"
          };
        }));
      }
    } catch (e) { }

    /* 4) 威胁组织 — 统一索引（THREAT_DATA ∪ THREAT_ORGS_DB） */
    try {
      var orgs = orgIndex().filter(function (o) {
        if (selfMod === 'threatorgs' && (o.dbId === selfKey || o.tdId === selfKey)) return false;
        if (hasO) { for (var i = 0; i < o.names.length; i++) { if (r.O.indexOf(o.names[i]) >= 0) return true; } }
        if (hasC && (o.regions || []).some(function (rg) { return ctyHit(r.C, rg); })) return true;
        return false;
      });
      var lvColor = { critical: 'var(--red)', high: 'var(--orange)', medium: 'var(--yellow)', low: 'var(--green)' };
      var catCn = { terrorist: '恐怖组织', criminal: '犯罪组织', anti_china_ngo: '反华NGO' };
      grp('🎯', '关联威胁组织', 'threatorgs', orgs.map(function (o) {
        var lc = lvColor[o.level] || (typeof o.level === 'number' ? (o.level >= 9 ? 'var(--red)' : o.level >= 7 ? 'var(--orange)' : 'var(--yellow)') : 'var(--pink)');
        var sub = (catCn[o.cat] || o.cat || '威胁实体');
        if (o.regions && o.regions.length) sub += ' · ' + o.regions.slice(0, 3).join('/');
        return { t: o.name, s: sub, c: lc, fn: "LINK_GRAPH.openOrg('" + _q(o.name) + "')", tag: o.merged ? '双源' : '' };
      }));
    } catch (e) { }

    /* 5) 预警中心 */
    try {
      var als = (window.ALERTS || []).filter(function (a) {
        if (!a) return false;
        if (selfMod === 'alert' && _s(a.id) === selfKey) return false;
        if (hasC && ctyHit(r.C, a.country)) return true;
        if (hasE && entHit(r.E, a.enterprise)) return true;
        if (hasO) { var t = _s(a.title_zh || a.title) + ' ' + _s(a.desc); for (var i = 0; i < r.O.length; i++) { if (t.indexOf(r.O[i]) >= 0) return true; } }
        return false;
      });
      var alColor = { red: 'var(--red)', orange: 'var(--orange)', yellow: 'var(--yellow)', blue: 'var(--cyan)' };
      grp('🚨', '关联预警', 'alerts', als.map(function (a) {
        return {
          t: _s(a.title_zh || a.title).slice(0, 34),
          s: (a.country || '') + ' · ' + (a.time || ''),
          c: alColor[a.level] || 'var(--cyan)',
          fn: "showAlertDetail('" + _q(a.id) + "')"
        };
      }));
    } catch (e) { }

    /* 6) 态势总览 — 事件（用户举例的"恐怖组织↔袭击事件"落点） */
    try {
      var evs = (window.EVENTS || []).filter(function (ev) {
        if (!ev) return false;
        if (selfMod === 'event' && _s(ev.id) === selfKey) return false;
        if (hasC && ctyHit(r.C, ev.country)) return true;
        if (hasE && (ev.enterprises || []).some(function (en) { return entHit(r.E, en); })) return true;
        if (hasO) {
          var t = _s(ev.title) + ' ' + _s(ev.desc || ev.detail) + ' ' + _s(ev.actor || ev.group || ev.org);
          for (var i = 0; i < r.O.length; i++) { if (t.indexOf(r.O[i]) >= 0) return true; }
        }
        return false;
      });
      var sevColor = { critical: 'var(--red)', high: 'var(--orange)', medium: 'var(--yellow)', low: 'var(--cyan)' };
      grp('💥', '关联事件', 'situation', evs.map(function (ev) {
        return {
          t: _s(ev.title).slice(0, 34),
          s: (ev.country || '') + ' · ' + (ev.date || ev.time || ''),
          c: sevColor[ev.sev] || 'var(--cyan)',
          fn: "showEventDetail('" + _q(ev.id) + "')"
        };
      }));
    } catch (e) { }

    /* 7) 风险矩阵 — 历史案例 */
    try {
      if (typeof MATRIX !== 'undefined' && MATRIX._cases) {
        var cases = [];
        MATRIX._cases.forEach(function (c, i) {
          if (!c) return;
          if (selfMod === 'matrix' && _s(i) === selfKey) return;
          var ok = (hasC && ctyHit(r.C, c.cty)) || (hasE && entHit(r.E, c.ent));
          if (!ok && hasO) { var t = _s(c.t) + ' ' + _s(c.d); for (var k = 0; k < r.O.length; k++) { if (t.indexOf(r.O[k]) >= 0) { ok = true; break; } } }
          if (ok) cases.push({ t: _s(c.t).slice(0, 34), s: (c.cty || '') + ' · ' + (c.ent || '') + ' · ' + (c.yr || ''), c: 'var(--purple)', fn: 'LINK_GRAPH.openCase(' + i + ')' });
        });
        grp('🧊', '关联风险案例', 'matrix', cases);
      }
    } catch (e) { }

    /* 8) 预测分析 */
    try {
      var preds = (window.PREDICTIONS || []).filter(function (p) {
        if (!p) return false;
        var pc = p.country || p.cty || p.region || '';
        if (hasC && ctyHit(r.C, pc)) return true;
        if (hasE && entHit(r.E, p.enterprise || p.ent)) return true;
        return false;
      });
      grp('📈', '关联预测研判', 'forecast', preds.map(function (p, i) {
        return {
          t: _s(p.title || p.t || p.name || p.event || '预测项').slice(0, 34),
          s: _s(p.country || p.cty || '') + (p.prob != null ? ' · 概率 ' + p.prob + '%' : (p.probability != null ? ' · 概率 ' + p.probability + '%' : '')),
          c: 'var(--cyan)', fn: "LINK_GRAPH.openForecast('" + _q(p.id != null ? p.id : i) + "')"
        };
      }));
    } catch (e) { }

    /* 9) 战略通道 / 一带一路走廊 */
    try {
      var chan = [];
      (window.CHOKEPOINTS || []).forEach(function (cp) {
        if (!cp) return;
        var ok = hasE && (cp.ents || []).some(function (en) { return entHit(r.E, en); });
        if (!ok && hasC) ok = r.C.some(function (cn) { return _s(cp.desc).indexOf(cn) >= 0 || _s(cp.name).indexOf(cn) >= 0; });
        if (ok) chan.push({ t: '🌊 ' + cp.name, s: '咽喉要道 · 风险 ' + cp.risk, c: cp.risk >= 8 ? 'var(--red)' : cp.risk >= 6 ? 'var(--orange)' : 'var(--yellow)', fn: "LINK_GRAPH.openChannel('choke','" + _q(cp.name) + "')" });
      });
      (window.CORRIDORS || []).forEach(function (co) {
        if (!co) return;
        var ok = hasC && r.C.some(function (cn) { return _s(co.countries).indexOf(cn) >= 0; });
        if (!ok && hasE) ok = r.E.some(function (en) { return _s(co.detail).indexOf(en) >= 0; });
        if (ok) chan.push({ t: '🛣️ ' + co.name, s: (co.countries || '') + ' · ' + (co.status || ''), c: co.risk >= 7 ? 'var(--red)' : co.risk >= 5 ? 'var(--orange)' : 'var(--green)', fn: "LINK_GRAPH.openChannel('corridor','" + _q(co.name) + "')" });
      });
      grp('🛣️', '关联战略通道', 'situation', chan);
    } catch (e) { }

    /* 10) 数据中心 — 原始情报条目（全平台数据总汇） */
    try {
      if (typeof DBCenter !== 'undefined' && DBCenter.getAll) {
        var cats = (typeof COLLECTED_DB !== 'undefined' && COLLECTED_DB.CATEGORIES) ? COLLECTED_DB.CATEGORIES :
          ['terror_events', 'security_events', 'military_conflicts', 'political_events', 'natural_disasters',
            'public_health', 'sanctions_data', 'social_unrest', 'infrastructure', 'geopolitical_intel', 'osint_intel'];
        var rows = [], scanned = 0;
        for (var ci = 0; ci < cats.length && scanned < SCAN_LIMIT && rows.length < 40; ci++) {
          var cat = cats[ci], arr = [];
          try { arr = DBCenter.getAll(cat) || []; } catch (e2) { arr = []; }
          for (var ri = 0; ri < arr.length && scanned < SCAN_LIMIT; ri++) {
            scanned++;
            var row = arr[ri]; if (!row) continue;
            if (selfMod === 'dc' && _s(row.id) === selfKey) continue;
            var hit = false;
            if (hasC && ctyHit(r.C, row.country)) hit = true;
            if (!hit && hasE && entHit(r.E, row.enterprise)) hit = true;
            if (!hit && hasO) {
              var tt = _s(row.title) + ' ' + _s(row.group || row.parties) + ' ' + _s(row.content || row.desc);
              for (var oi = 0; oi < r.O.length; oi++) { if (tt.indexOf(r.O[oi]) >= 0) { hit = true; break; } }
            }
            if (hit) rows.push({ row: row, cat: cat });
            if (rows.length >= 40) break;
          }
        }
        grp('🗂️', '数据中心原始条目', 'datacenter', rows.map(function (x) {
          var lbl = _catLabel(x.cat);
          return {
            t: _s(x.row.title || x.row.desc || '(无标题)').slice(0, 34),
            s: lbl + ' · ' + _s(x.row.country || '') + ' · ' + _s(x.row.date || x.row.time || '').slice(0, 10),
            c: 'var(--text3)',
            fn: "LINK_GRAPH.openDCRow('" + _q(x.cat) + "','" + _q(x.row.id) + "')"
          };
        }));
      }
    } catch (e) { }

    /* 11) 数据源库 — 供给这些情报的上游源 */
    try {
      if (typeof DATASOURCES !== 'undefined' && DATASOURCES.REGISTRY) {
        var srcNames = {};
        if (r.self && r.self.source) srcNames[_s(r.self.source)] = 1;
        var ds = DATASOURCES.REGISTRY.filter(function (s) {
          if (!s) return false;
          if (srcNames[s.name]) return true;
          if (hasC && (s.coverage || []).some(function (cv) { return cv === '全球' ? false : r.C.some(function (cn) { return cn.indexOf(cv) >= 0 || cv.indexOf(cn) >= 0; }); })) return true;
          return false;
        });
        grp('📡', '关联数据源', 'datasources', ds.map(function (s) {
          return { t: (s.icon || '📡') + ' ' + s.name, s: (s.desc || '').slice(0, 28) + ' · ' + (s.rel || ''), c: 'var(--green)', fn: "LINK_GRAPH.openSource('" + _q(s.id) + "')" };
        }));
      }
    } catch (e) { }

    /* 12) 情报枢纽实时索引 */
    try {
      if (typeof INTELINDEX !== 'undefined' && INTELINDEX.related) {
        var rel = [];
        var seen = {};
        var seenTitle = {};
        function pushIntel(e) {
          if (!e || !e.id || seen[e.id]) return;
          var fp = (e.country || '') + '|' + String(e.title || '').toLowerCase().replace(/[\s　]+/g, '').replace(/[^一-龥a-z0-9]/g, '').slice(0, 80);
          if (seenTitle[fp]) return;
          seen[e.id] = 1; seenTitle[fp] = 1; rel.push(e);
        }
        r.C.forEach(function (cn) { INTELINDEX.related({ country: cn, excludeId: r.excludeId }).forEach(pushIntel); });
        r.E.forEach(function (en) { INTELINDEX.related({ enterprise: en, excludeId: r.excludeId }).forEach(pushIntel); });
        if (r.O.length) INTELINDEX.related({ actors: r.O, excludeId: r.excludeId }).forEach(pushIntel);
        rel.sort(function (a, b) { var ta = new Date(a.ts || 0).getTime(), tb = new Date(b.ts || 0).getTime(); return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta); });
        var ilColor = { red: 'var(--red)', orange: 'var(--orange)', yellow: 'var(--yellow)' };
        grp('🔗', '情报枢纽实时索引', 'intel', rel.map(function (e) {
          return { t: _s(e.title).slice(0, 34), s: (e.country || '') + ' · ' + (e.source || '') + ' · ' + (e.ts || ''), c: ilColor[e.level] || 'var(--cyan)', fn: "showRelatedIntel('" + _q(e.id) + "')" };
        }));
      }
    } catch (e) { }

    return g;
  }

  function _catLabel(cat) {
    if (typeof CATV2 !== 'undefined' && CATV2.labelOf && CATV2.labelOf[cat]) return CATV2.iconOf[cat] + ' ' + CATV2.labelOf[cat];
    var M = {
      terror_events: '💥 恐袭', security_events: '🛡️ 涉华安全', military_conflicts: '⚔️ 冲突',
      political_events: '🏛️ 政治', natural_disasters: '🌊 灾害', public_health: '🧧 卫生',
      sanctions_data: '🚫 制裁', social_unrest: '💬 动荡', infrastructure: '🚧 基建',
      geopolitical_intel: '🌐 地缘', osint_intel: '🔍 开源'
    };
    return M[cat] || cat;
  }

  /* ---------------- 面板渲染 ---------------- */
  function buildPanel(ctx) {
    var r = resolve(ctx);
    var groups = collect(r);
    if (!groups.length) return '';
    var total = groups.reduce(function (s, g) { return s + g.total; }, 0);

    var chips = [];
    if (r.C.length) chips.push('<span style="font-size:9px;padding:1px 7px;border-radius:8px;background:rgba(0,212,255,.12);color:var(--cyan)">🌍 ' + _esc(r.C.slice(0, 3).join('、')) + (r.C.length > 3 ? '+' + (r.C.length - 3) : '') + '</span>');
    if (r.E.length) chips.push('<span style="font-size:9px;padding:1px 7px;border-radius:8px;background:rgba(0,200,83,.12);color:var(--green)">🏢 ' + _esc(r.E.slice(0, 3).join('、')) + (r.E.length > 3 ? '+' + (r.E.length - 3) : '') + '</span>');
    if (r.O.length) chips.push('<span style="font-size:9px;padding:1px 7px;border-radius:8px;background:rgba(255,61,127,.12);color:var(--pink)">🎯 ' + _esc(r.O.slice(0, 3).join('、')) + (r.O.length > 3 ? '+' + (r.O.length - 3) : '') + '</span>');

    var h = '<div data-lg-panel="1" style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)">';
    h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      '<span style="font-size:12px;font-weight:800;color:var(--cyan)">🔗 跨模块关联</span>' +
      '<span style="font-size:10px;color:var(--text3)">命中 ' + total + ' 项 · ' + groups.length + ' 个功能区</span>' +
      chips.join('') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    groups.forEach(function (g) {
      h += '<div style="padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px">';
      h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
        '<span style="font-size:10px;font-weight:700;color:var(--text2)">' + g.icon + ' ' + g.title + '</span>' +
        '<span style="font-size:9px;color:var(--text3)">' + g.total + (g.total > g.items.length ? '（显示 ' + g.items.length + '）' : '') + '</span></div>';
      g.items.forEach(function (it) {
        h += '<div onclick="' + it.fn + '" title="点击穿透查看" ' +
          'style="display:flex;align-items:center;gap:6px;padding:5px 7px;margin-bottom:3px;background:var(--panel);border-left:2px solid ' + it.c + ';border-radius:0 5px 5px 0;cursor:pointer;transition:.12s" ' +
          'onmouseover="this.style.background=\'rgba(0,212,255,.07)\';this.style.transform=\'translateX(2px)\'" ' +
          'onmouseout="this.style.background=\'var(--panel)\';this.style.transform=\'\'">' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-size:10.5px;color:var(--text);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(it.t) + (it.tag ? '<span style="font-size:8px;margin-left:4px;padding:0 4px;border-radius:6px;background:rgba(124,58,237,.18);color:#c084fc">' + _esc(it.tag) + '</span>' : '') + '</div>' +
          '<div style="font-size:9px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(it.s) + '</div>' +
          '</div><span style="font-size:9px;color:var(--text3)">›</span></div>';
      });
      if (g.total > g.items.length && g.view) {
        h += '<div onclick="LINK_GRAPH.goView(\'' + g.view + '\')" style="font-size:9px;color:var(--cyan);cursor:pointer;padding:2px 7px">查看全部 ' + g.total + ' 项 →</div>';
      }
      h += '</div>';
    });
    h += '</div></div>';
    return h;
  }

  function inject(ctx) {
    try {
      var bd = document.getElementById('modal-bd');
      if (!bd) return;
      var old = bd.querySelector('[data-lg-panel]');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var html = buildPanel(ctx);
      if (html) bd.insertAdjacentHTML('beforeend', html);
    } catch (e) { console.warn('[LINK_GRAPH.inject]', e); }
  }

  /* ---------------- 穿透打开器（补齐原本没有详情页的模块）---------------- */
  function _openModal(title, html) {
    try {
      document.getElementById('modal-tt').textContent = title;
      document.getElementById('modal-bd').innerHTML = html;
      document.getElementById('modal').classList.add('show');
    } catch (e) { }
  }
  function _kv(list) {
    var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px">';
    list.forEach(function (x) {
      if (x[1] == null || x[1] === '') return;
      h += '<div style="padding:7px 10px;background:var(--bg2);border-radius:6px;border-left:2px solid ' + (x[2] || 'var(--cyan)') + '">' +
        '<div style="font-size:9px;color:var(--text3);font-weight:600">' + _esc(x[0]) + '</div>' +
        '<div style="font-size:11.5px;color:var(--text);margin-top:2px;word-break:break-all">' + _esc(x[1]) + '</div></div>';
    });
    return h + '</div>';
  }

  function openProject(id) {
    try {
      var p = null;
      if (typeof ENTERPRISE_DB !== 'undefined' && ENTERPRISE_DB.getAll) {
        var all = ENTERPRISE_DB.getAll();
        p = all.find(function (x) { return _s(x.id) === _s(id); });
      }
      if (!p) { _toast('未找到该项目'); return; }
      var rlCn = { critical: '极高风险', high: '高风险', medium: '中等风险', low: '低风险' };
      var h = _kv([
        ['🌍 所在国', p.country], ['📍 城市/地点', p.city], ['🏢 承建企业', p.enterprise],
        ['🏗️ 行业板块', p.sector], ['💰 投资额', p.investment], ['📆 开工时间', p.start_date],
        ['📊 运行状态', p.status], ['⚠️ 风险等级', rlCn[p.risk_level] || p.risk_level, p.risk_level === 'high' || p.risk_level === 'critical' ? 'var(--red)' : 'var(--yellow)']
      ]);
      if (p.desc) h += '<div style="padding:10px;background:var(--bg2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--text2)">' + _esc(p.desc) + '</div>';
      if (p.risk_events && p.risk_events.length) {
        h += '<div style="font-size:11px;font-weight:700;color:var(--orange);margin:12px 0 6px">⚡ 风险事件流（情报总线推送）</div>';
        p.risk_events.slice(0, 8).forEach(function (re) {
          h += '<div style="padding:6px 9px;background:var(--panel2);border-left:2px solid var(--orange);border-radius:0 5px 5px 0;margin-bottom:4px;font-size:10.5px"><span style="color:var(--text3)">' + _esc(re.t) + '</span> ' + _esc(re.evt) + '</div>';
        });
      }
      _openModal('📦 ' + (p.project_name || '海外项目') + ' — 项目详情', h);
      inject({ country: p.country, enterprise: p.enterprise, text: _s(p.project_name) + ' ' + _s(p.desc), self: { module: 'project', key: _s(p.id) } });
    } catch (e) { console.warn(e); }
  }

  function openCase(i) {
    try {
      if (typeof MATRIX !== 'undefined' && MATRIX.showCase) {
        MATRIX.showCase(i);
        var c = MATRIX._cases && MATRIX._cases[i];
        if (c) inject({ country: c.cty, enterprise: c.ent, text: _s(c.t) + ' ' + _s(c.d), self: { module: 'matrix', key: _s(i) } });
      }
    } catch (e) { }
  }

  function openForecast(key) {
    try {
      var list = window.PREDICTIONS || [];
      var p = list.find(function (x, i) { return _s(x.id) === _s(key) || _s(i) === _s(key); });
      if (!p) { _toast('未找到该预测项'); return; }
      var h = _kv([
        ['🌍 国家/地区', p.country || p.cty || p.region], ['📋 类型', p.type || p.cat],
        ['📈 发生概率', (p.prob != null ? p.prob : p.probability) != null ? ((p.prob != null ? p.prob : p.probability) + '%') : ''],
        ['⏱️ 时间窗口', p.window || p.horizon || p.period], ['⚠️ 影响等级', p.impact || p.level],
        ['🔬 模型/方法', p.model || p.method]
      ]);
      var body = p.desc || p.detail || p.basis || p.reason || '';
      if (body) h += '<div style="padding:10px;background:var(--bg2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--text2)">' + _esc(body) + '</div>';
      _openModal('📈 ' + _s(p.title || p.t || p.name || '预测研判') + ' — 预测详情', h);
      inject({ country: p.country || p.cty, enterprise: p.enterprise || p.ent, text: _s(p.title || p.t) + ' ' + _s(body), self: { module: 'forecast', key: _s(key) } });
    } catch (e) { }
  }

  function openChannel(kind, name) {
    try {
      var o = null, h = '';
      if (kind === 'choke') {
        o = (window.CHOKEPOINTS || []).find(function (x) { return x.name === name; });
        if (!o) { _toast('未找到该通道'); return; }
        h = _kv([['⚠️ 风险指数', String(o.risk)], ['📊 风险等级', o.level], ['🏢 涉及企业', (o.ents || []).join('、')]]);
        h += '<div style="padding:10px;background:var(--bg2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--text2)">' + _esc(o.desc) + '</div>';
        if (o.impact) h += '<div style="margin-top:8px;padding:10px;background:rgba(255,170,0,.06);border-left:3px solid var(--orange);border-radius:0 8px 8px 0;font-size:11.5px;line-height:1.7">🎯 影响：' + _esc(o.impact) + '</div>';
        _openModal('🌊 ' + o.name + ' — 战略咽喉要道', h);
        inject({ enterprises: o.ents || [], text: _s(o.name) + ' ' + _s(o.desc), self: { module: 'channel', key: o.name } });
      } else {
        o = (window.CORRIDORS || []).find(function (x) { return x.name === name; });
        if (!o) { _toast('未找到该走廊'); return; }
        h = _kv([['🌍 沿线国家', o.countries], ['⚠️ 风险指数', String(o.risk)], ['💰 投资规模', o.inv + ' 亿美元'], ['📊 运行状态', o.status], ['🏢 参与企业数', String(o.ents)]]);
        h += '<div style="padding:10px;background:var(--bg2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--text2)">' + _esc(o.desc) + '</div>';
        if (o.detail) h += '<div style="margin-top:8px;font-size:11px;color:var(--text3)">🏢 ' + _esc(o.detail) + '</div>';
        _openModal('🛣️ ' + o.name + ' — 经济走廊', h);
        var ctys = _s(o.countries).split(/[\/、,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
        inject({ countries: ctys, text: _s(o.name) + ' ' + _s(o.desc) + ' ' + _s(o.detail), self: { module: 'channel', key: o.name } });
      }
    } catch (e) { }
  }

  function openDCRow(cat, id) {
    try {
      if (typeof DBCenter === 'undefined' || !DBCenter.getAll) { _toast('数据中心不可用'); return; }
      var arr = DBCenter.getAll(cat) || [];
      var row = arr.find(function (x) { return _s(x.id) === _s(id); });
      if (!row) { _toast('该条目已不在库中'); return; }
      var sev = row.severity || row.impact || row.intensity || '';
      var h = '<div style="padding:12px;background:var(--bg2);border-radius:10px;margin-bottom:12px;border:1px solid rgba(0,212,255,.15)">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
        '<span style="font-size:10px;padding:2px 9px;border-radius:9px;background:rgba(0,212,255,.1);color:var(--cyan);font-weight:700">' + _esc(_catLabel(cat)) + '</span>' +
        (row._real || row._crawler ? '<span style="font-size:9px;padding:1px 8px;border-radius:8px;background:rgba(0,200,83,.12);color:var(--green)">🌐 真实采集</span>' : '') +
        '</div>' +
        '<div style="font-size:13.5px;font-weight:700;line-height:1.5">' + _esc(row.title || row.desc || '(无标题)') + '</div>' +
        (row.title_zh ? '<div style="font-size:12px;color:var(--cyan);margin-top:5px">译文：' + _esc(row.title_zh) + '</div>' : '') + '</div>';
      h += _kv([
        ['📅 事件时间', row.date || row.time || row.event_date], ['🌍 国家', row.country],
        ['📍 地点', row.location || row.city], ['📋 事件类型', row.type || row.event_type || row.category],
        ['⚡ 严重程度', sev], ['👥 涉事组织', row.group || row.parties],
        ['🏢 涉及企业', row.enterprise], ['📡 情报来源', row.source]
      ]);
      var content = row.content || row.desc || row.detail || row.summary || '';
      if (content) h += '<div style="padding:10px;background:var(--bg2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--text2);word-break:break-all">' + _esc(content) + '</div>';
      if (row.url) h += '<div style="margin-top:8px;font-size:10.5px">🔗 <a href="' + _esc(row.url) + '" target="_blank" rel="noopener" style="color:var(--cyan);word-break:break-all">' + _esc(row.url) + '</a></div>';
      _openModal('🗂️ 数据中心 — 情报条目', h);
      inject({
        country: row.country, enterprise: row.enterprise,
        orgs: [row.group, row.parties, row.actor].filter(Boolean),
        text: _s(row.title) + ' ' + _s(content),
        self: { module: 'dc', key: _s(row.id), source: row.source }
      });
    } catch (e) { console.warn(e); }
  }

  function openSource(id) {
    try {
      if (typeof DATASOURCES === 'undefined' || !DATASOURCES.REGISTRY) { _toast('数据源库未加载'); return; }
      var s = DATASOURCES.REGISTRY.find(function (x) { return x.id === id || x.name === id; });
      if (!s) { _toast('未找到该数据源'); return; }
      var catCn = { official: '🏛️ 官方权威', intl: '🌐 国际组织', osint: '📡 开源情报', media: '📰 新闻媒体', think: '🎓 智库研究', social: '💬 社交媒体', geoint: '🛰️ 地理空间' };
      var st = null;
      try { st = DATASOURCES._state && DATASOURCES._state[s.id]; } catch (e) { }
      var h = _kv([
        ['📂 源类别', catCn[s.cat] || s.cat], ['⭐ 可靠性评级', s.rel],
        ['🌍 覆盖范围', (s.coverage || []).join('、')], ['🔄 采集周期', s.cycle ? (s.cycle + ' 秒') : ''],
        ['🆔 源编号', s.id], ['📶 运行状态', st ? (st.status || st.health || '在线') : '通道预留']
      ]);
      h += '<div style="padding:10px;background:var(--bg2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--text2)">' + _esc(s.desc || '') + '</div>';
      if (s.feeds && s.feeds.length) {
        h += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin:12px 0 6px">🔀 该源供给的下游功能区</div><div style="display:flex;gap:6px;flex-wrap:wrap">';
        var VMAP = { '智能预警中心': 'alerts', '全域态势感知': 'situation', '企业资产': 'assets', '实时风险监测': 'monitor', '威胁组织图谱': 'threatorgs', '预测分析': 'forecast', '影像情报中心': 'intel', '风险矩阵': 'matrix', '数据中心': 'datacenter' };
        s.feeds.forEach(function (f) {
          var v = VMAP[f];
          h += '<span onclick="' + (v ? "LINK_GRAPH.goView('" + _q(v) + "')" : '') + '" style="font-size:10px;padding:3px 10px;border-radius:10px;background:rgba(0,212,255,.1);color:var(--cyan);' + (v ? 'cursor:pointer' : '') + '">' + _esc(f) + (v ? ' →' : '') + '</span>';
        });
        h += '</div>';
      }
      _openModal('📡 ' + s.name + ' — 数据源档案', h);
      inject({ countries: (s.coverage || []).filter(function (x) { return x !== '全球'; }), self: { module: 'datasource', key: s.id, source: s.name } });
    } catch (e) { }
  }

  function goView(v) {
    try {
      var m = document.getElementById('modal');
      if (m) m.classList.remove('show');
      if (typeof navigateTo === 'function') navigateTo(v);
    } catch (e) { }
  }

  /* 安全打开国家风险页：库内命中 → showCtyDetail；未收录 → 降级为关联透视，杜绝"点了没反应" */
  function openCountry(name) {
    var n = _s(name); if (!n) return;
    try {
      var norm = normCty(n) || n;
      if (typeof COUNTRIES !== 'undefined' && Array.isArray(COUNTRIES)) {
        var hit = null;
        for (var i = 0; i < COUNTRIES.length; i++) {
          var cn = _s(COUNTRIES[i].name);
          if (cn === n || cn === norm || normCty(cn) === norm) { hit = COUNTRIES[i]; break; }
        }
        if (hit && typeof showCtyDetail === 'function') { showCtyDetail(hit.name); return; }
      } else if (typeof showCtyDetail === 'function') { showCtyDetail(norm); return; }
    } catch (e) { }
    probe(norm || n, norm || n, '', '');
  }

  /* 安全打开企业档案：支持传 id / 名称 / 简称；未收录 → 降级为关联透视 */
  function openEnterprise(key) {
    var k = _s(key); if (!k) return;
    try {
      if (typeof ENTERPRISES !== 'undefined' && Array.isArray(ENTERPRISES)) {
        var hit = null;
        for (var i = 0; i < ENTERPRISES.length; i++) {
          var x = ENTERPRISES[i];
          if (String(x.id) === k || _s(x.name) === k || _s(x.short) === k) { hit = x; break; }
        }
        if (!hit) {
          for (var j = 0; j < ENTERPRISES.length; j++) {
            var y = ENTERPRISES[j];
            if (entHit([_s(y.name), _s(y.short)], k)) { hit = y; break; }
          }
        }
        if (hit && typeof showEntDetail === 'function') { showEntDetail(hit.id); return; }
      }
    } catch (e) { }
    probe(k, '', '', k);
  }

  /* 关联透视：给"子条目"（一条袭击记录/一段言论/一个样本/一个关联实体徽章）用的轻量穿透。
   * 这些子条目本身没有独立详情页，probe 会以它为上下文打开跨模块关联视图。 */
  function probe(title, country, org, extraText) {
    try {
      var c = normCty(country);
      var h = '<div style="padding:12px;background:var(--bg2);border-radius:10px;margin-bottom:4px;border-left:3px solid var(--cyan)">' +
        '<div style="font-size:9px;color:var(--text3);font-weight:700;margin-bottom:4px">关联透视对象</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.5">' + _esc(title || '(未命名条目)') + '</div>';
      var meta = [];
      if (c) meta.push('🌍 ' + _esc(c));
      if (org) meta.push('🎯 ' + _esc(org));
      if (meta.length) h += '<div style="font-size:10.5px;color:var(--text3);margin-top:5px">' + meta.join(' &nbsp;·&nbsp; ') + '</div>';
      h += '</div>';
      _openModal('🔗 关联透视', h);
      var ctx = { country: c, org: org, text: _s(title) + ' ' + _s(extraText) };
      var panel = buildPanel(ctx);
      var bd = document.getElementById('modal-bd');
      if (bd) {
        if (panel) bd.insertAdjacentHTML('beforeend', panel);
        else bd.insertAdjacentHTML('beforeend', '<div style="padding:14px;text-align:center;font-size:11px;color:var(--text3)">该条目暂无跨模块关联命中（可能对应国家/组织尚未入库）</div>');
      }
    } catch (e) { console.warn('[LINK_GRAPH.probe]', e); }
  }

  return {
    normCty: normCty, orgIndex: orgIndex, findOrg: findOrg, invalidateOrgCache: invalidateOrgCache,
    resolve: resolve, collect: collect, buildPanel: buildPanel, inject: inject,
    openOrg: openOrg, openProject: openProject, openCase: openCase, openForecast: openForecast,
    openChannel: openChannel, openDCRow: openDCRow, openSource: openSource, goView: goView,
    openCountry: openCountry, openEnterprise: openEnterprise,
    probe: probe, q: _q
  };
})();
if (typeof window !== 'undefined') window.LINK_GRAPH = LINK_GRAPH;
