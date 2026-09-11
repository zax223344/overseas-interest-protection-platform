/* ============================================================
 * my-risk.js — #744 P0-2 企业风险订阅画像「我的风险」工作台
 * ================================================================
 * 数据源：GET /api/insight/my-risk（server/intel-insight.js，45s 缓存）
 *   三维过滤（企业/行业/国别，默认全集）→ 项目档案卡 + 近 24h 红橙/涉华预警流 + 定制要报摘要。
 * 选择态持久化 localStorage（orps_myrisk_sel）；零模拟——空选中返回空集。
 * 注册：index.html 容器 view-myrisk + script；app.js VIEW_MAP + init 分支。
 * ============================================================ */
var MYRISK = (function () {
  'use strict';
  var _data = null, _inited = false, _loading = false;
  var _sel = { ent: [], sec: [], ctry: [] };   /* 空=全集 */
  var LS_KEY = 'orps_myrisk_sel';

  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _fetch(url, ms) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 20000) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function _loadSel() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s && typeof s === 'object') _sel = { ent: s.ent || [], sec: s.sec || [], ctry: s.ctry || [] }; } catch (e) { }
  }
  function _saveSel() { try { localStorage.setItem(LS_KEY, JSON.stringify(_sel)); } catch (e) { } }

  /* ---------- 样式 ---------- */
  function _css() {
    if (document.getElementById('myrisk-style')) return;
    var st = document.createElement('style'); st.id = 'myrisk-style';
    st.textContent = [
      '.mr-root{padding:14px 16px;color:var(--text);min-height:100%}',
      '.mr-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}',
      '.mr-head .t{font-size:16px;font-weight:800;color:var(--cyan);letter-spacing:1px}',
      '.mr-head .sub{font-size:11px;color:var(--text2)}',
      '.mr-kpis{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
      '.mr-kpi{border:1px solid var(--border);border-radius:8px;padding:6px 12px;background:var(--panel2);min-width:86px}',
      '.mr-kpi .v{font-size:17px;font-weight:800;font-family:Consolas,monospace}',
      '.mr-kpi .l{font-size:9px;color:var(--text3);letter-spacing:1px;margin-top:1px}',
      '.mr-filter{border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--panel);margin-bottom:10px}',
      '.mr-fr{display:flex;align-items:flex-start;gap:8px;padding:3px 0}',
      '.mr-fl{flex-shrink:0;width:52px;font-size:10px;font-weight:700;color:var(--text3);padding-top:4px;letter-spacing:2px}',
      '.mr-chips{display:flex;flex-wrap:wrap;gap:4px;flex:1}',
      '.mr-chip{font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid var(--border);color:var(--text2);cursor:pointer;user-select:none;transition:.12s;white-space:nowrap}',
      '.mr-chip:hover{border-color:var(--cyan);color:var(--cyan)}',
      '.mr-chip.on{background:rgba(0,212,255,.14);border-color:var(--cyan);color:var(--cyan);font-weight:700}',
      '.mr-ops{display:flex;gap:6px;flex-shrink:0;padding-top:2px}',
      '.mr-op{font-size:9px;padding:2px 8px;border-radius:8px;border:1px dashed var(--border);color:var(--text3);cursor:pointer}',
      '.mr-op:hover{color:var(--cyan);border-color:var(--cyan)}',
      '.mr-grid{display:grid;grid-template-columns:minmax(340px,5fr) minmax(420px,7fr);gap:10px;align-items:start}',
      '.mr-col{border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow:hidden}',
      '.mr-ch{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel2)}',
      '.mr-ch .t{font-size:12px;font-weight:800}',
      '.mr-ch .n{font-size:9px;color:var(--text3);margin-left:auto;font-family:Consolas,monospace}',
      '.mr-cb{max-height:calc(100vh - 320px);overflow-y:auto;padding:8px}',
      '.mr-cb::-webkit-scrollbar{width:5px}.mr-cb::-webkit-scrollbar-thumb{background:rgba(0,212,255,.25);border-radius:3px}',
      '.mr-pc{border:1px solid rgba(0,212,255,.12);border-radius:7px;padding:7px 9px;margin-bottom:6px;background:rgba(13,28,54,.5);transition:.15s;cursor:default}',
      '.mr-pc:hover{border-color:rgba(0,212,255,.4)}',
      '.mr-pc .r1{display:flex;align-items:center;gap:6px}',
      '.mr-pc .nm{font-size:11.5px;font-weight:800;color:#e9f6ff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mr-rl{flex-shrink:0;font-size:8.5px;font-weight:800;border-radius:4px;padding:1px 6px;letter-spacing:1px}',
      '.mr-rl.high{background:rgba(255,51,85,.12);color:#ff5577;border:1px solid rgba(255,51,85,.4)}',
      '.mr-rl.medium{background:rgba(255,136,0,.1);color:#ffaa33;border:1px solid rgba(255,136,0,.35)}',
      '.mr-rl.low{background:rgba(0,230,118,.1);color:#00e676;border:1px solid rgba(0,230,118,.35)}',
      '.mr-rl.unrated{background:rgba(90,122,153,.12);color:#8fa8c0;border:1px solid rgba(90,122,153,.35)}',
      '.mr-pc .meta{font-size:9px;color:#7aa5c9;margin-top:3px;font-family:Consolas,monospace}',
      '.mr-pc .desc{font-size:9px;color:#8fa8c0;margin-top:3px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.mr-pc .lev{font-size:8.5px;color:#5a7a99;margin-top:3px;line-height:1.5;border-top:1px dotted rgba(0,212,255,.1);padding-top:3px}',
      '.mr-al{display:flex;gap:7px;align-items:baseline;padding:5px 4px;border-bottom:1px dotted rgba(0,212,255,.08);cursor:pointer}',
      '.mr-al:hover{background:rgba(0,212,255,.04)}',
      '.mr-al:last-child{border-bottom:none}',
      '.mr-al .tm{flex-shrink:0;font-size:8.5px;color:var(--text3);font-family:Consolas,monospace;width:86px}',
      '.mr-al .lv{flex-shrink:0;font-size:8px;font-weight:800;border-radius:3px;padding:0 5px;letter-spacing:1px}',
      '.mr-al .lv.red{background:rgba(255,51,85,.14);color:#ff5577;border:1px solid rgba(255,51,85,.4)}',
      '.mr-al .lv.orange{background:rgba(255,136,0,.12);color:#ffaa33;border:1px solid rgba(255,136,0,.35)}',
      '.mr-al .lv.yellow{background:rgba(255,204,0,.08);color:#ffcc00;border:1px solid rgba(255,204,0,.3)}',
      '.mr-al .ct{flex-shrink:0;font-size:9px;color:var(--cyan);font-weight:700;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mr-al .cn{flex-shrink:0;font-size:8px;font-weight:800;color:#ffaa33}',
      '.mr-al .tt{font-size:10px;color:#c3d9ec;line-height:1.5;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mr-brief{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:7px 12px;border-bottom:1px solid var(--border);background:rgba(124,58,237,.05);font-size:9.5px;color:var(--text2)}',
      '.mr-brief b{color:var(--cyan)}',
      '.mr-brief .tc{font-size:9px;color:#c084fc;font-family:Consolas,monospace}',
      '.mr-empty{padding:26px 12px;text-align:center;font-size:11px;color:var(--text3);line-height:2}',
      '.mr-note{font-size:9px;color:var(--text3);margin-top:8px;line-height:1.7;padding:0 2px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- 渲染 ---------- */
  function _chipRow(label, key, list) {
    var sel = _sel[key];
    var chips = list.map(function (x) {
      var on = sel.length === 0 || sel.indexOf(x.name) >= 0;
      return '<span class="mr-chip' + (on ? ' on' : '') + '" data-k="' + key + '" data-v="' + _esc(x.name) + '" title="' + _esc(x.name) + ' ' + x.n + ' 项">' + _esc(x.name) + ' <small>' + x.n + '</small></span>';
    }).join('');
    var allOn = sel.length === 0;
    return '<div class="mr-fr"><div class="mr-fl">' + label + '</div><div class="mr-chips">' + chips + '</div>' +
      '<div class="mr-ops"><span class="mr-op" data-op="all" data-k="' + key + '">' + (allOn ? '已全选' : '全选') + '</span><span class="mr-op" data-op="none" data-k="' + key + '">清空</span></div></div>';
  }

  function _projectCard(p) {
    var lev = p.lastEvent
      ? '最近预警 [' + _esc(p.lastEvent.t || '') + '][' + (p.lastEvent.level || '—') + '] ' + _esc(p.lastEvent.evt || '')
      : '近期无关联预警（近 7 天项目风险事件为空）';
    return '<div class="mr-pc">' +
      '<div class="r1"><span class="nm" title="' + _esc(p.project || p.enterprise) + '">' + _esc(p.project || p.enterprise) + '</span>' +
      '<span class="mr-rl ' + _esc(p.riskLevel) + '">' + _esc(p.riskLabel) + '风险</span></div>' +
      '<div class="meta">' + _esc(p.enterprise) + ' · ' + _esc(p.country) + (p.location ? ' · ' + _esc(p.location) : '') + ' · ' + _esc(p.sector) + ' · ' + _esc(p.status) + (p.investment && p.investment !== '—' ? ' · 投资 ' + _esc(p.investment) : '') + '</div>' +
      (p.desc ? '<div class="desc">' + _esc(p.desc) + '</div>' : '') +
      '<div class="lev">' + lev + '</div>' +
      '</div>';
  }

  function _alertRow(a) {
    return '<div class="mr-al" data-id="' + a.id + '" title="' + _esc(a.title) + '">' +
      '<span class="tm">' + _esc(a.time) + '</span>' +
      '<span class="lv ' + _esc(a.level) + '">' + (a.level === 'red' ? '红' : (a.level === 'orange' ? '橙' : '黄')) + '</span>' +
      '<span class="ct">' + _esc(a.country) + '</span>' +
      (a.china ? '<span class="cn">涉华</span>' : '') +
      '<span class="tt">' + _esc(a.type) + ' · ' + _esc(a.title) + '</span>' +
      '</div>';
  }

  function _render() {
    var root = document.getElementById('myrisk-root');
    if (!root) return;
    var d = _data;
    if (!d || !d.ok) { root.innerHTML = '<div class="mr-empty">「我的风险」服务不可达</div>'; return; }
    var b = d.brief || {}, m = d.meta || {};
    var selEnt = _sel.ent.length, selSec = _sel.sec.length, selCtry = _sel.ctry.length;
    var filterTxt = (selEnt + selSec + selCtry) === 0 ? '全集（30 企业 · 16 行业 · 33 国）' : '已选 ' + (selEnt || '全部') + ' 企业 / ' + (selSec || '全部') + ' 行业 / ' + (selCtry || '全部') + ' 国';
    var tc = (b.topCountries || []).map(function (x) { return x.country + '(' + x.n + ')'; }).join('、');
    var h = '<div class="mr-root">';
    h += '<div class="mr-head"><span class="t">🏢 我的风险工作台</span><span class="sub">企业订阅画像 · ' + _esc(filterTxt) + ' · 快照 ' + _esc(d.generatedAt || '') + '</span></div>';
    /* KPI 条 */
    var rd = b.riskDist || {};
    h += '<div class="mr-kpis">' +
      '<div class="mr-kpi"><div class="v" style="color:var(--cyan)">' + (b.projects || 0) + '</div><div class="l">在册项目</div></div>' +
      '<div class="mr-kpi"><div class="v" style="color:#ff5577">' + (b.red24 || 0) + '</div><div class="l">24H 红色</div></div>' +
      '<div class="mr-kpi"><div class="v" style="color:#ffaa33">' + (b.orange24 || 0) + '</div><div class="l">24H 橙色</div></div>' +
      '<div class="mr-kpi"><div class="v" style="color:#ffcc00">' + (b.china24 || 0) + '</div><div class="l">24H 涉华</div></div>' +
      '<div class="mr-kpi"><div class="v" style="color:#ff5577">' + (rd.high || 0) + '</div><div class="l">高风险项目</div></div>' +
      '<div class="mr-kpi"><div class="v" style="color:#ffaa33">' + (rd.medium || 0) + '</div><div class="l">中风险项目</div></div>' +
      '<div class="mr-kpi"><div class="v" style="color:#00e676">' + (rd.low || 0) + '</div><div class="l">低风险项目</div></div>' +
      '</div>';
    /* 三维过滤 */
    h += '<div class="mr-filter">' + _chipRow('企业', 'ent', m.enterprises || []) + _chipRow('行业', 'sec', m.sectors || []) + _chipRow('国别', 'ctry', m.countries || []) + '</div>';
    /* 主体两列 */
    var projs = d.projects || [], alerts = d.alerts24 || [];
    h += '<div class="mr-grid">';
    /* 左：项目档案 */
    h += '<div class="mr-col"><div class="mr-ch"><span class="t">📁 项目风险档案</span><span class="n">' + projs.length + ' 项</span></div><div class="mr-cb">' +
      (projs.length ? projs.map(_projectCard).join('') : '<div class="mr-empty">当前过滤条件下无在册项目<br>（清空选择或切换过滤维度）</div>') + '</div></div>';
    /* 右：预警流 */
    h += '<div class="mr-col"><div class="mr-ch"><span class="t">🚨 企业专属预警流（24H 红橙/涉华）</span><span class="n">' + alerts.length + ' 条</span></div>' +
      '<div class="mr-brief">定制要报摘要：项目所在国 <b>' + (tc || '—') + '</b> 近 24 小时红色 <b>' + (b.red24 || 0) + '</b> 条、橙色 <b>' + (b.orange24 || 0) + '</b> 条、涉华 <b>' + (b.china24 || 0) + '</b> 条' + (b.red24 ? '，建议涉华红项按一小时上报流程处置' : '') + '</div>' +
      '<div class="mr-cb">' + (alerts.length ? alerts.map(_alertRow).join('') : '<div class="mr-empty">项目所在国近 24 小时无红橙/涉华事件<br>（常态监测运行中）</div>') + '</div></div>';
    h += '</div>';
    h += '<div class="mr-note">口径：enterprise_projects 全量在册项目（企业/行业/国别三维过滤）× 近 24h 红橙/涉华事件流（仅命中项目所在国，审核通过 + 排除补采回灌）；风险等级为项目档案当前评级（高/中/低）；选择态本地持久化。零模拟——事件全部来自实时采集库。</div>';
    h += '</div>';
    root.innerHTML = h;
  }

  function _load(silent) {
    if (_loading) return;
    _loading = true;
    var qs = [];
    if (_sel.ent.length) qs.push('enterprises=' + encodeURIComponent(_sel.ent.join(',')));
    if (_sel.sec.length) qs.push('sectors=' + encodeURIComponent(_sel.sec.join(',')));
    if (_sel.ctry.length) qs.push('countries=' + encodeURIComponent(_sel.ctry.join(',')));
    var url = '/api/insight/my-risk' + (qs.length ? '?' + qs.join('&') : '');
    _fetch(url, 25000)
      .then(function (d) { _data = d; _render(); })
      .catch(function (e) {
        if (!silent) { var r = document.getElementById('myrisk-root'); if (r) r.innerHTML = '<div class="mr-empty">服务不可达：' + _esc(e.message) + '</div>'; }
      })
      .finally(function () { _loading = false; });
  }

  /* ---------- 交互（事件委托） ---------- */
  function _bind() {
    var root = document.getElementById('myrisk-root');
    if (!root || root.__mrBind) return;
    root.__mrBind = true;
    root.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.mr-chip') : null;
      var op = e.target.closest ? e.target.closest('.mr-op') : null;
      if (chip) {
        var k = chip.getAttribute('data-k'), v = chip.getAttribute('data-v');
        var arr = _sel[k];
        if (!arr) return;
        /* 全选态（空数组）点任一 chip = 只选它；选中态点它 = 移除；移除到空 = 回全集 */
        if (arr.length === 0) { _sel[k] = [v]; }
        else {
          var i = arr.indexOf(v);
          if (i >= 0) arr.splice(i, 1); else arr.push(v);
        }
        _saveSel(); _render(); _load(true);
      } else if (op) {
        var ok = op.getAttribute('data-k');
        if (op.getAttribute('data-op') === 'all') _sel[ok] = [];
        else _sel[ok] = _sel[ok].length ? [] : ['__none__'];  /* 清空=反选不可用，回到全选 */
        if (_sel[ok][0] === '__none__') _sel[ok] = [];
        _saveSel(); _render(); _load(true);
      }
    });
  }

  function init() {
    if (_inited) { _load(true); return; }
    _inited = true;
    _css(); _loadSel(); _bind();
    var r = document.getElementById('myrisk-root');
    if (r && !_data) r.innerHTML = '<div class="mr-empty">正在加载企业订阅画像（三维过滤 + 项目档案 + 24h 预警流）……</div>';
    _load(false);
  }

  function refresh() { _load(false); }

  return { init: init, refresh: refresh };
})();
