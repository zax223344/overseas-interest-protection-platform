/* ===== 每日简报（2026-09-01 三大升级版）=====
 * 用户指令：① 日报数据可点开内容、交互和修改；② 公文格式（GB/T 9704-2012 参考版式）报告；
 * ③ PDF / Word 文件导出。全部数据来自服务端 /api/reports/daily（当日 DB 真实数据，零虚构）。
 * 结构：交互版（条目抽屉详情 + 人工编辑：改标题/摘要、删除、调序，PUT 存回 DB 并留修订痕迹）
 *       公文版（服务端渲染红头公文 HTML，红头可开关，导出 PDF=iframe 打印 / 导出 Word=.doc Blob）。 */
/* 12 类情报类型中文名（客户端版；与服务端 _DR_TYPE_NAMES 同步） */
var _DR_TYPE_NAMES_C = {
  terror_events: '恐怖袭击/武装袭击', military_conflicts: '武装冲突', social_unrest: '社会动荡',
  political_events: '政治政局', economic_risk: '经济风险', sanctions_data: '制裁与合规',
  legal_compliance: '法律合规', cyber_security: '网络安全', infrastructure: '基础设施与供应链',
  natural_disasters: '自然灾害', public_health: '公共卫生', security_events: '治安事件',
  geopolitical_intel: '地缘动态', osint_intel: '开源情报综合'
};
var DAILY_REPORT = {
  _list: [],
  _current: '',
  _data: null,      /* GET /api/reports/daily/:date 完整行（items/sections/edited/gov_html/...） */
  _loaded: null,    /* 当前生效结构 {items, sections}（edited 覆盖层优先，否则基准） */
  _view: 'inter',   /* 'inter' 交互版 | 'gov' 公文版 */
  _editMode: false,
  _red: true,       /* 公文红头开关（默认开） */
  _styleDone: false,
  /* 2026-09-01 交互复合化：管理面板 + 采集库抽屉 */
  _mgmtOpen: false,
  _collectOpen: false,
  _collectList: [],
  _collectTotal: 0,
  _collectOffset: 0,
  _collectLimit: 50,
  _collectSel: {},  /* {intelId:true} 选中集合 */
  _collectFilters: { q: '', type: '', country: '', severity: '' },
  _undoStack: [],   /* 最近操作，可一键回滚（add/remove 倒序） */

  init: function () { this.render(); },

  _ensureStyle: function () {
    if (this._styleDone) return;
    this._styleDone = true;
    var st = document.createElement('style');
    st.textContent = ''
      + '#dr-rows [data-dri]{position:relative;}'
      + '#dr-rows [data-dri]:hover{background:rgba(0,150,255,0.10);}'
      + '.dr-editctl{position:absolute;top:6px;right:8px;display:none;gap:4px;}'
      + '#dr-rows.dr-editing .dr-editctl{display:flex;}'
      + '.dr-editctl button{width:24px;height:22px;line-height:22px;text-align:center;padding:0;font-size:11px;border-radius:4px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;}'
      + '.dr-editctl button:hover{border-color:var(--cyan);color:var(--cyan);}'
      + '#dr-rows.dr-editing [data-dri]{outline:1px dashed rgba(0,150,255,0.35);}'
      + '.dr-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;display:none;}'
      + '.dr-backdrop.show{display:block;}'
      + '.dr-drawer{position:fixed;right:0;top:0;bottom:0;width:480px;max-width:94vw;background:var(--panel);border-left:1px solid var(--border);z-index:9999;overflow-y:auto;box-shadow:-8px 0 24px rgba(0,0,0,0.35);transform:translateX(102%);transition:transform 0.22s;}'
      + '.dr-drawer.open{transform:translateX(0);}'
      + '.dr-tag{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:9px;font-size:11px;border:1px solid var(--border);}'
      + '.dr-govwrap{background:#9a9a9a;padding:24px 10px;border-radius:10px;overflow:auto;}'
      + '.dr-viewtab{display:inline-block;padding:6px 16px;border-radius:8px 8px 0 0;border:1px solid var(--border);border-bottom:none;cursor:pointer;font-size:12px;font-weight:600;background:var(--panel2);color:var(--text3);}'
      + '.dr-viewtab.active{color:var(--cyan);border-color:var(--cyan);background:var(--panel);border-bottom:2px solid var(--cyan);margin-bottom:-1px;}'
      /* ===== 2026-09-01 简报交互复合化：深空蓝黑情报指挥中心风格 ===== */
      + '#dr-mgmt{background:linear-gradient(180deg,#0a1226 0%,#050a18 100%);border:1px solid #1a2a4a;border-radius:8px;padding:14px 16px;box-shadow:inset 0 1px 0 rgba(0,200,255,0.08);margin-bottom:14px;}'
      + '.dr-mgmt-card{background:rgba(10,20,50,0.5);border:1px solid #1a3a5a;border-radius:6px;padding:10px 14px;margin-bottom:8px;}'
      + '.dr-mgmt-stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}'
      + '.dr-mgmt-stat{flex:1;min-width:90px;background:rgba(8,16,40,0.6);border:1px solid #122540;border-radius:6px;padding:8px 10px;text-align:center;}'
      + '.dr-mgmt-stat .v{font-size:20px;font-weight:800;color:var(--cyan);line-height:1;margin-bottom:2px;}'
      + '.dr-mgmt-stat .l{font-size:10px;color:var(--text3);}'
      + '.dr-mgmt-row{display:flex;gap:8px;padding:6px 10px;background:rgba(8,16,40,0.4);border:1px solid #122540;border-radius:5px;margin-bottom:3px;font-size:12px;align-items:center;}'
      + '.dr-mgmt-row:hover{border-color:#2a5a8a;background:rgba(0,80,160,0.08);}'
      + '.dr-mgmt-badge{padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600;white-space:nowrap;}'
      + '.dr-mgmt-badge.auto{background:rgba(0,150,200,0.15);color:#4dabff;border:1px solid #1f6a9a;}'
      + '.dr-mgmt-badge.manual{background:rgba(255,140,0,0.18);color:#ff9933;border:1px solid #8a5520;}'
      + '.dr-mgmt-badge.lv-red{background:rgba(255,51,85,0.18);color:#ff3355;border:1px solid #8a2030;}'
      + '.dr-mgmt-badge.lv-orange{background:rgba(255,136,0,0.18);color:#ff8800;border:1px solid #8a5010;}'
      + '.dr-mgmt-badge.lv-yellow{background:rgba(255,204,0,0.18);color:#ffcc00;border:1px solid #8a7000;}'
      + '.dr-mgmt-badge.lv-blue{background:rgba(0,212,255,0.18);color:#00d4ff;border:1px solid #106070;}'
      + '.dr-mgmt-rm{background:transparent;color:#ff5577;border:1px solid #5a2030;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;}'
      + '.dr-mgmt-rm:hover{background:rgba(255,85,119,0.1);border-color:#ff5577;}'
      + '.dr-history{font-size:11px;color:var(--text3);padding:6px 10px;background:rgba(8,16,40,0.3);border-radius:5px;margin-top:6px;}'
      + '.dr-history-row{display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #0a1a30;}'
      + '.dr-history-row:last-child{border-bottom:none;}'
      + '.dr-collect-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10000;display:none;}'
      + '.dr-collect-overlay.show{display:block;}'
      + '.dr-collect-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:92vw;max-width:1020px;height:88vh;max-height:840px;background:linear-gradient(180deg,#050b1e 0%,#0a142a 100%);border:1px solid #1a3a6a;border-radius:10px;box-shadow:0 0 40px rgba(0,150,255,0.18),inset 0 1px 0 rgba(0,200,255,0.1);z-index:10001;display:flex;flex-direction:column;overflow:hidden;}'
      + '.dr-collect-hd{padding:14px 18px;border-bottom:1px solid #1a3a5a;display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,rgba(0,80,160,0.15),transparent);}'
      + '.dr-collect-bd{flex:1;overflow-y:auto;padding:12px 18px;}'
      + '.dr-collect-ft{padding:10px 18px;border-top:1px solid #1a3a5a;display:flex;gap:8px;align-items:center;background:rgba(0,0,0,0.2);}'
      + '.dr-collect-row{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin-bottom:6px;background:rgba(10,22,50,0.4);border:1px solid #122848;border-radius:6px;transition:all 0.15s;}'
      + '.dr-collect-row.selected{border-color:var(--cyan);background:rgba(0,150,255,0.10);box-shadow:0 0 12px rgba(0,200,255,0.18);}'
      + '.dr-collect-row:hover{border-color:#2a5a8a;}'
      + '.dr-collect-row input[type=checkbox]{margin-top:4px;cursor:pointer;}'
      + '.dr-collect-actions{display:flex;gap:6px;align-items:center;margin-left:auto;}'
      + '.dr-collect-meta{font-size:10px;color:var(--text3);margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;}';
    document.head.appendChild(st);
    /* 抽屉 DOM（单例，懒创建） */
    if (!document.getElementById('dr-drawer')) {
      var bd = document.createElement('div'); bd.id = 'dr-backdrop'; bd.className = 'dr-backdrop';
      bd.onclick = function () { DAILY_REPORT.closeDrawer(); };
      document.body.appendChild(bd);
      var dw = document.createElement('div'); dw.id = 'dr-drawer'; dw.className = 'dr-drawer';
      document.body.appendChild(dw);
    }
  },

  render: function () {
    var el = document.getElementById('dailyreport-content');
    if (!el) return;
    var me = this;
    this._ensureStyle();
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">加载中…</div>';
    fetch('/api/reports/daily').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      me._list = list || [];
      if (!me._list.length) {
        el.innerHTML = '<div class="card" style="padding:40px;text-align:center">'
          + '<div style="font-size:32px;margin-bottom:10px">📰</div>'
          + '<div style="font-size:14px;font-weight:600;margin-bottom:6px">尚无简报</div>'
          + '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">系统每天 08:00 自动汇总前一日采集数据生成简报；也可点击下方按钮立即生成昨日简报</div>'
          + '<button class="btn primary" onclick="DAILY_REPORT.generate()">⚙️ 立即生成昨日简报</button></div>';
        return;
      }
      if (!me._current || !me._list.some(function (x) { return x.report_date === me._current; })) {
        me._current = me._list[0].report_date;
      }
      me._renderLayout(el);
      me.load(me._current);
    }).catch(function () {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">服务端不可用，请确认采集服务已启动</div>';
    });
  },

  _renderLayout: function (el) {
    var me = this;
    /* 2026-08-28 日期选择器改造：≤8 期 chips 平铺；>8 期「下拉选择 + 前后翻页」紧凑模式。 */
    var useChips = this._list.length <= 8;
    var idx = this._list.findIndex(function (x) { return x.report_date === me._current; });
    if (idx < 0) idx = 0;
    var prev = this._list[idx + 1], next = this._list[idx - 1]; /* _list 按日期倒序 */
    var cur = this._list[idx] || {};
    var cs = cur.summary || {};
    var dateCtl;
    if (useChips) {
      var chips = this._list.map(function (r) {
        var s = r.summary || {};
        return '<div class="dr-chip' + (r.report_date === me._current ? ' active' : '') + '" data-date="' + r.report_date + '" onclick="DAILY_REPORT.pick(\'' + r.report_date + '\')" '
          + 'style="padding:10px 14px;background:var(--panel2);border:1px solid ' + (r.report_date === me._current ? 'var(--cyan)' : 'var(--border)') + ';border-radius:8px;cursor:pointer;min-width:120px">'
          + '<div style="font-size:13px;font-weight:700;color:' + (r.report_date === me._current ? 'var(--cyan)' : 'var(--text)') + '">' + r.report_date + (r.manual_edit ? ' <span style="color:#ffcc00" title="已人工编辑">✎</span>' : '') + '</div>'
          + '<div style="font-size:10px;color:var(--text3);margin-top:2px">总量 ' + (s.total || 0) + ' · 涉华 ' + (s.china || 0) + ' · 红色 ' + (s.red || 0) + '</div>'
          + '</div>';
      }).join('');
      dateCtl = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' + chips + '</div>';
    } else {
      var opts = this._list.map(function (r) {
        var s = r.summary || {};
        return '<option value="' + r.report_date + '"' + (r.report_date === me._current ? ' selected' : '') + '>'
          + r.report_date + '（总量 ' + (s.total || 0) + ' · 涉华 ' + (s.china || 0) + ' · 红色 ' + (s.red || 0) + (r.manual_edit ? ' · 已人工编辑' : '') + '）</option>';
      }).join('');
      dateCtl =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">'
        + '<button class="btn sm" ' + (prev ? '' : 'disabled style="opacity:.35" ') + 'onclick="DAILY_REPORT.pick(\'' + (prev ? prev.report_date : '') + '\')" title="上一期（更早）">◀ 更早</button>'
        + '<select id="dr-date-sel" onchange="DAILY_REPORT.pick(this.value)" style="padding:6px 10px;background:var(--panel2);border:1px solid var(--cyan);border-radius:8px;color:var(--text);font-size:13px;font-weight:700;min-width:280px">' + opts + '</select>'
        + '<button class="btn sm" ' + (next ? '' : 'disabled style="opacity:.35" ') + 'onclick="DAILY_REPORT.pick(\'' + (next ? next.report_date : '') + '\')" title="下一期（更新）">更新 ▶</button>'
        + '<span style="font-size:11px;color:var(--text3)">共 ' + this._list.length + ' 期简报</span>'
        + '</div>';
    }
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
      + '<div style="font-size:15px;font-weight:700">📰 每日简报</div>'
      + '<span style="font-size:11px;color:var(--text3)">每天 08:00 自动汇总前一日采集数据 · 条目可点开查看与修改 · 一键导出公文版 PDF/Word</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn sm" onclick="DAILY_REPORT.generate()" title="以前一日数据重新生成（人工编辑过的日期需确认覆盖）">⚙️ 重新生成昨日简报</button>'
      + '</div>'
      + dateCtl
      + (useChips ? '' : '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">当前：' + cur.report_date + ' · 总量 ' + (cs.total || 0) + ' · 涉华 ' + (cs.china || 0) + ' · 红色 ' + (cs.red || 0) + '</div>')
      + '<div style="display:flex;gap:4px;margin-bottom:0">'
      + '<div class="dr-viewtab' + (this._view === 'inter' ? ' active' : '') + '" onclick="DAILY_REPORT.switchView(\'inter\')">🖥 交互版</div>'
      + '<div class="dr-viewtab' + (this._view === 'gov' ? ' active' : '') + '" onclick="DAILY_REPORT.switchView(\'gov\')">📜 公文版</div>'
      + '</div>'
      + '<div id="dr-body" class="card" style="padding:20px 24px;max-width:960px;border-top-left-radius:0"><div style="color:var(--text3)">加载中…</div></div>';
  },

  pick: function (date) {
    this._current = date;
    this._editMode = false;
    document.querySelectorAll('.dr-chip').forEach(function (c) {
      var on = c.getAttribute('data-date') === date;
      c.style.borderColor = on ? 'var(--cyan)' : 'var(--border)';
      c.querySelector('div').style.color = on ? 'var(--cyan)' : 'var(--text)';
      c.classList.toggle('active', on);
    });
    this.load(date);
  },

  switchView: function (v) {
    this._view = v;
    this._editMode = false;
    document.querySelectorAll('.dr-viewtab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('onclick').indexOf("'" + v + "'") >= 0);
    });
    this._renderCurrent();
  },

  load: function (date) {
    var me = this;
    var body = document.getElementById('dr-body');
    if (!body) return;
    body.innerHTML = '<div style="color:var(--text3)">加载中…</div>';
    fetch('/api/reports/daily/' + date).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) { body.innerHTML = '<div style="color:var(--text3)">该日简报不存在</div>'; return; }
      me._data = d;
      /* 人工编辑覆盖层优先 */
      me._loaded = (d.edited && d.edited.items && d.edited.sections) ? d.edited : { items: d.items || [], sections: d.sections || [] };
      me._renderCurrent();
    }).catch(function () {
      body.innerHTML = '<div style="color:var(--text3)">加载失败</div>';
    });
  },

  _renderCurrent: function () {
    var body = document.getElementById('dr-body');
    if (!body || !this._data) return;
    if (this._view === 'gov') return this._renderGov(body);
    return this._renderInter(body);
  },

  /* ===================== 交互版 ===================== */
  _renderInter: function (body) {
    var d = this._data;
    var rev = d.revision || [];
    var manual = !!d.manual_edit;
    var lastRev = rev.length ? rev[rev.length - 1] : null;
    var hdr =
      '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;flex-wrap:wrap">'
      + '<div style="font-size:20px;font-weight:800">海外利益安全日报</div>'
      + '<div style="font-size:13px;color:var(--cyan)">' + d.report_date + '</div>'
      + (manual ? '<span class="dr-tag" style="color:#ffcc00;border-color:#ffcc00">✎ 人工修订版</span>' : '')
      + '<span style="flex:1"></span>'
      + '<div style="font-size:10px;color:var(--text3)">生成于 ' + String(d.created_at || '').slice(0, 16).replace('T', ' ') + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">'
      + '<span style="font-size:11px;color:var(--text3)">点击条目可查看完整详情（摘要、来源、原文链接）' + (rev.length ? ' · 修订 ' + rev.length + ' 次' + (lastRev ? '，最近 ' + String(lastRev.at || '').slice(0, 16).replace('T', ' ') + '（' + (lastRev.user || '') + '）' : '') : '') + '</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn sm" onclick="DAILY_REPORT.toggleMgmt()" title="简报条目管理：查看结构总览、自动 vs 手动条目区分、移除/撤销">' + (this._mgmtOpen ? '📊 关闭管理面板' : '📊 管理面板') + '</button>'
      + '<button class="btn sm primary" onclick="DAILY_REPORT.openCollectDrawer()" title="从数据中心采集库搜索条目并加入简报">📦 从采集库添加</button>'
      + (manual ? '<button class="btn sm" onclick="DAILY_REPORT.revertEdits()" title="丢弃人工修改，恢复自动生成版本">↩ 撤销人工修改</button>' : '')
      + (this._editMode
        ? '<button class="btn sm primary" onclick="DAILY_REPORT.saveEdits()">💾 保存修改</button>'
        + '<button class="btn sm" onclick="DAILY_REPORT.cancelEdit()">✖ 放弃修改</button>'
        : '<button class="btn sm" onclick="DAILY_REPORT.startEdit()" title="编辑条目标题/摘要、删除、调整顺序">✏️ 编辑简报</button>')
      + '</div>'
      + (this._mgmtOpen ? this._renderMgmtPanel() : '')
      + '<div id="dr-rows"' + (this._editMode ? ' class="dr-editing"' : '') + '>' + (this._data.html || '') + '</div>';
    body.innerHTML = hdr;
    if (this._editMode) this._applyEditControls();
  },

  /* ===================== 管理面板：结构总览 + 自动 vs 手动条目区分 + 操作历史 + 撤销 ===================== */
  _renderMgmtPanel: function () {
    var d = this._data;
    var items = (d.items || []);
    var autoN = items.filter(function (it) { return !it.manual; }).length;
    var manualN = items.filter(function (it) { return !!it.manual; }).length;
    var stats =
      '<div class="dr-mgmt-stats">'
      + '<div class="dr-mgmt-stat"><div class="v">' + items.length + '</div><div class="l">条目总数</div></div>'
      + '<div class="dr-mgmt-stat"><div class="v" style="color:#4dabff">' + autoN + '</div><div class="l">自动生成</div></div>'
      + '<div class="dr-mgmt-stat"><div class="v" style="color:#ff9933">' + manualN + '</div><div class="l">手动添加</div></div>'
      + '<div class="dr-mgmt-stat"><div class="v" style="color:#ff3355">' + ((d.summary && d.summary.red) || 0) + '</div><div class="l">红色事件</div></div>'
      + '<div class="dr-mgmt-stat"><div class="v" style="color:#ff8800">' + ((d.summary && d.summary.china) || 0) + '</div><div class="l">涉华</div></div>'
      + '<div class="dr-mgmt-stat"><div class="v">' + ((d.summary && d.summary.sources) || 0) + '</div><div class="l">信源</div></div>'
      + '</div>';
    /* 各节条目（按当前 sections 顺序） */
    var me = this;
    var sectionsHtml = '';
    (d.sections || []).forEach(function (sec) {
      var icon = sec.icon || '·';
      var rows = '';
      if (sec.subs && sec.subs.length) {
        sec.subs.forEach(function (sub) {
          var subN = (sub.items || []).length;
          rows += '<div style="font-size:11px;color:var(--text3);padding:4px 10px">↳ ' + (_DR_TYPE_NAMES_C[sub.type] || sub.type) + '（' + subN + '）</div>';
          (sub.items || []).forEach(function (idx) { rows += me._renderMgmtRow(items[idx], idx); });
        });
      } else {
        if (!(sec.items || []).length) rows = '<div style="font-size:11px;color:var(--text3);padding:4px 10px">' + (sec.emptyText || '当日无条目') + '</div>';
        else (sec.items || []).forEach(function (idx) { rows += me._renderMgmtRow(items[idx], idx); });
      }
      sectionsHtml += '<div class="dr-mgmt-card"><div style="font-size:13px;font-weight:700;margin-bottom:6px;color:var(--cyan)">' + icon + ' ' + (sec.title || sec.key) + '</div>' + rows + '</div>';
    });
    /* 操作历史（来自 _undoStack 与 revision 最后 5 条） */
    var rev = (d.revision || []).slice(-5).reverse();
    var undoN = this._undoStack.length;
    var historyHtml = '<div class="dr-history"><div style="font-weight:600;margin-bottom:4px;color:var(--text2)">🕓 操作历史</div>'
      + '<div class="dr-history-row"><span style="color:var(--cyan)">可撤销</span><span>本次会话 ' + undoN + ' 次增/删操作可一键回滚</span></div>';
    if (undoN) historyHtml += '<div class="dr-history-row"><button class="btn sm" onclick="DAILY_REPORT.undoLast()">↶ 撤销最近一次操作</button></div>';
    rev.forEach(function (r) { historyHtml += '<div class="dr-history-row"><span style="color:var(--text3)">' + String(r.at || '').slice(11, 16) + '</span><span>' + (r.note || '') + '</span><span style="color:var(--text3);margin-left:auto">' + (r.user || '') + '</span></div>'; });
    historyHtml += '</div>';
    return '<div id="dr-mgmt">' + stats + sectionsHtml + historyHtml + '</div>';
  },
  _renderMgmtRow: function (it, idx) {
    if (!it) return '';
    var lv = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' }[it.severity] || it.severity || '—';
    var lvCls = 'lv-' + (it.severity || 'blue');
    var src = (it.eventCountry || it.country || '未标注');
    var title = String(it.title || '').slice(0, 80);
    var me = this;
    return '<div class="dr-mgmt-row">'
      + '<span class="dr-mgmt-badge ' + (it.manual ? 'manual' : 'auto') + '">' + (it.manual ? '✋ 手动' : '🖱 自动') + '</span>'
      + '<span class="dr-mgmt-badge ' + lvCls + '">' + lv + '</span>'
      + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + '<span style="font-weight:600">' + title + '</span>'
      + ' <span style="color:var(--text3);font-size:10px">· 📍' + src + (it.source ? ' · ' + it.source : '') + ' · #' + idx + '</span>'
      + '</span>'
      + '<button class="dr-mgmt-rm" onclick="DAILY_REPORT.removeFromReport(' + idx + ')">移除</button>'
      + '</div>';
  },
  toggleMgmt: function () {
    this._mgmtOpen = !this._mgmtOpen;
    this._renderCurrent();
  },
  removeFromReport: function (idx) {
    var it = (this._data && this._data.items || [])[idx];
    if (!it) { showToast('⚠️ 条目不存在'); return; }
    var me = this;
    if (!confirm('确认从简报中移除该条目？\n' + String(it.title || '').slice(0, 60))) return;
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    if (!tok) { showToast('⚠️ 请先登录'); return; }
    fetch('/api/reports/daily/' + this._current + '/items/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ idx: idx })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (d) {
      if (d.ok && d.j.ok) {
        showToast('✅ 已移除（undo 可一键回滚）');
        me._undoStack.push({ type: 'remove', date: me._current, idx: idx, item: it });
        me.load(me._current);
        me.render();
      } else showToast('⚠️ 移除失败：' + ((d.j && d.j.error) || '未知错误'));
    }).catch(function (e) { showToast('⚠️ 移除失败：' + e.message); });
  },
  undoLast: function () {
    var op = this._undoStack.pop();
    if (!op) { showToast('⚠️ 暂无可撤销操作'); return; }
    var me = this;
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    var p = new URLSearchParams();
    if (op.type === 'remove') {
      /* 反向：把刚才移除的条目再加回来（用其完整 id/title） */
      /* 若有 intelId，从 candidates 思路：服务器 add 端需要 intelId；为简化，调用 add 端用 id（其已是 DB id） */
      fetch('/api/reports/daily/' + op.date + '/items/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ intelId: op.item.id })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (d) {
        if (d.ok && d.j.ok) { showToast('↶ 已恢复移除的条目'); me.load(me._current); me.render(); }
        else showToast('⚠️ 撤销失败：' + ((d.j && d.j.error) || '未知'));
      }).catch(function (e) { showToast('⚠️ ' + e.message); });
    } else if (op.type === 'add') {
      /* 反向：移除刚才添加的条目（其 idx 已记下） */
      fetch('/api/reports/daily/' + op.date + '/items/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ idx: op.idx })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (d) {
        if (d.ok && d.j.ok) { showToast('↶ 已撤销添加'); me.load(me._current); me.render(); }
        else showToast('⚠️ 撤销失败：' + ((d.j && d.j.error) || '未知'));
      }).catch(function (e) { showToast('⚠️ ' + e.message); });
    }
  },

  /* ===================== 采集库抽屉：搜索/筛选/批量添加采集条目到简报 ===================== */
  openCollectDrawer: function () {
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    if (!tok) { showToast('⚠️ 请先登录'); return; }
    if (!document.getElementById('dr-collect-overlay')) {
      var ov = document.createElement('div'); ov.id = 'dr-collect-overlay'; ov.className = 'dr-collect-overlay';
      ov.onclick = function (e) { if (e.target === ov) DAILY_REPORT.closeCollectDrawer(); };
      var mo = document.createElement('div'); mo.id = 'dr-collect-modal'; mo.className = 'dr-collect-modal';
      document.body.appendChild(ov); document.body.appendChild(mo);
    }
    this._collectOpen = true;
    document.getElementById('dr-collect-overlay').classList.add('show');
    this._collectOffset = 0; this._collectSel = {};
    this._loadCandidates();
  },
  closeCollectDrawer: function () {
    this._collectOpen = false;
    var ov = document.getElementById('dr-collect-overlay');
    if (ov) ov.classList.remove('show');
  },
  _loadCandidates: function () {
    var me = this;
    var f = this._collectFilters;
    var qs = '?limit=' + this._collectLimit + '&offset=' + this._collectOffset;
    if (f.q) qs += '&q=' + encodeURIComponent(f.q);
    if (f.type) qs += '&type=' + encodeURIComponent(f.type);
    if (f.country) qs += '&country=' + encodeURIComponent(f.country);
    if (f.severity) qs += '&severity=' + encodeURIComponent(f.severity);
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    var modal = document.getElementById('dr-collect-modal');
    if (modal) modal.innerHTML = '<div class="dr-collect-hd" style="color:var(--cyan)">⟳ 加载候选条目…</div>';
    fetch('/api/reports/daily/' + this._current + '/candidates' + qs, { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function (r) { return r.json(); }).then(function (d) {
        me._collectList = (d && d.items) || [];
        me._collectTotal = (d && d.total) || 0;
        me._renderCollectModal();
      }).catch(function (e) {
        if (modal) modal.innerHTML = '<div class="dr-collect-hd" style="color:#ff5577">⚠️ 加载失败：' + e.message + '</div>';
      });
  },
  _renderCollectModal: function () {
    var f = this._collectFilters;
    var me = this;
    var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var lv = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' };
    var selN = Object.keys(this._collectSel).length;
    var start = this._collectOffset + 1;
    var end = Math.min(this._collectOffset + this._collectList.length, this._collectTotal);
    var rows = this._collectList.map(function (c) {
      var lvCls = 'lv-' + (c.severity || 'blue');
      return '<div class="dr-collect-row' + (me._collectSel[c.id] ? ' selected' : '') + '" data-cid="' + c.id + '">'
        + '<input type="checkbox"' + (me._collectSel[c.id] ? ' checked' : '') + ' onchange="DAILY_REPORT._toggleSel(' + c.id + ', this.checked)">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:13px;font-weight:600;line-height:1.5">' + esc(c.title) + '</div>'
        + '<div class="dr-collect-meta">'
        + '<span class="dr-mgmt-badge ' + lvCls + '">' + (lv[c.severity] || c.severity || '—') + '</span>'
        + '<span class="dr-mgmt-badge auto">' + (_DR_TYPE_NAMES_C[c.type] || c.type) + '</span>'
        + (c.china ? '<span class="dr-mgmt-badge auto" style="color:#0a84ff;border-color:#0a84ff">涉华</span>' : '')
        + '<span>📍 ' + esc(c.eventCountry || c.country || '未标注') + '</span>'
        + '<span>· ' + esc(c.source || '—') + '</span>'
        + '<span>· ID ' + c.id + '</span>'
        + '</div>'
        + (c.preview ? '<div style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.5;max-height:38px;overflow:hidden">' + esc(c.preview) + '</div>' : '')
        + '</div>'
        + '<div class="dr-collect-actions"><button class="btn sm primary" onclick="DAILY_REPORT.addCandidate(' + c.id + ')">加入简报</button></div>'
        + '</div>';
    }).join('');
    var modal = document.getElementById('dr-collect-modal');
    if (!modal) return;
    modal.innerHTML =
      '<div class="dr-collect-hd">'
      + '<div style="font-size:15px;font-weight:700;color:var(--cyan)">📦 采集库候选 · ' + this._current + '</div>'
      + '<span style="flex:1"></span>'
      + '<span style="font-size:11px;color:var(--text3)">命中 ' + this._collectTotal + ' 条（不含已入简报）</span>'
      + '<button class="btn sm" onclick="DAILY_REPORT.closeCollectDrawer()">✖ 关闭</button>'
      + '</div>'
      + '<div class="dr-collect-bd" style="background:rgba(0,0,0,0.15)">'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #1a3a5a">'
      + '<input id="dr-coll-q" placeholder="搜索标题/摘要…" value="' + esc(f.q) + '" style="flex:2;min-width:180px;padding:6px 10px;background:#0a142a;border:1px solid #1a3a5a;border-radius:6px;color:var(--text);font-size:12px" oninput="DAILY_REPORT._setFilter(\'q\', this.value)">'
      + '<select id="dr-coll-type" onchange="DAILY_REPORT._setFilter(\'type\', this.value)" style="padding:6px 10px;background:#0a142a;border:1px solid #1a3a5a;border-radius:6px;color:var(--text);font-size:12px">'
      + '<option value="">全部类型</option>'
      + Object.keys(_DR_TYPE_NAMES_C).map(function (k) { return '<option value="' + k + '"' + (f.type === k ? ' selected' : '') + '>' + _DR_TYPE_NAMES_C[k] + '</option>'; }).join('')
      + '</select>'
      + '<select id="dr-coll-sev" onchange="DAILY_REPORT._setFilter(\'severity\', this.value)" style="padding:6px 10px;background:#0a142a;border:1px solid #1a3a5a;border-radius:6px;color:var(--text);font-size:12px">'
      + '<option value="">全部级别</option>'
      + '<option value="red"' + (f.severity === 'red' ? ' selected' : '') + '>红色</option>'
      + '<option value="orange"' + (f.severity === 'orange' ? ' selected' : '') + '>橙色</option>'
      + '<option value="yellow"' + (f.severity === 'yellow' ? ' selected' : '') + '>黄色</option>'
      + '<option value="blue"' + (f.severity === 'blue' ? ' selected' : '') + '>蓝色</option>'
      + '</select>'
      + '<input id="dr-coll-country" placeholder="国别…" value="' + esc(f.country) + '" style="flex:1;min-width:120px;padding:6px 10px;background:#0a142a;border:1px solid #1a3a5a;border-radius:6px;color:var(--text);font-size:12px" oninput="DAILY_REPORT._setFilter(\'country\', this.value)">'
      + '<button class="btn sm" onclick="DAILY_REPORT._collectOffset=0;DAILY_REPORT._loadCandidates()">🔍 搜索</button>'
      + '</div>'
      + (rows ? rows : '<div style="padding:30px;text-align:center;color:var(--text3)">当前筛选条件下无候选条目（可能已全部入简报）</div>')
      + '</div>'
      + '<div class="dr-collect-ft">'
      + '<span style="font-size:11px;color:var(--text3)">' + (this._collectList.length ? start + '–' + end : '0') + ' / ' + this._collectTotal + '</span>'
      + '<button class="btn sm" onclick="DAILY_REPORT._collectOffset=Math.max(0,DAILY_REPORT._collectOffset-DAILY_REPORT._collectLimit);DAILY_REPORT._loadCandidates()"' + (this._collectOffset === 0 ? ' disabled style="opacity:.35"' : '') + '>◀ 上一页</button>'
      + '<button class="btn sm" onclick="DAILY_REPORT._collectOffset+=DAILY_REPORT._collectLimit;DAILY_REPORT._loadCandidates()"' + (end >= this._collectTotal ? ' disabled style="opacity:.35"' : '') + '>下一页 ▶</button>'
      + '<span style="flex:1"></span>'
      + '<span style="font-size:11px;color:var(--text3)">已选 ' + selN + ' 条</span>'
      + '<button class="btn sm primary" onclick="DAILY_REPORT.addBatchCandidates()" ' + (selN ? '' : 'disabled style="opacity:.4"') + '>📥 批量加入简报（' + selN + '）</button>'
      + '</div>';
  },
  _setFilter: function (k, v) {
    this._collectFilters[k] = v;
    /* 输入防抖（仅对文本类） */
    var me = this;
    clearTimeout(this._filterTimer);
    this._filterTimer = setTimeout(function () { me._collectOffset = 0; me._loadCandidates(); }, 350);
  },
  _toggleSel: function (id, on) {
    if (on) this._collectSel[id] = true; else delete this._collectSel[id];
    this._renderCollectModal();
  },
  addCandidate: function (intelId) {
    var me = this;
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    fetch('/api/reports/daily/' + this._current + '/items/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ intelId: intelId })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (d) {
      if (d.ok && d.j.ok) {
        showToast('✅ 已加入：' + (d.j.section || '相应节') + '（采集编号 ' + intelId + '）');
        delete me._collectSel[intelId];
        me._undoStack.push({ type: 'add', date: me._current, idx: d.j.idx, item: { id: intelId } });
        me.load(me._current);
        me.render();
        me._loadCandidates(); /* 候选列表移除已加入条目 */
      } else showToast('⚠️ 加入失败：' + ((d.j && d.j.error) || '未知错误'));
    }).catch(function (e) { showToast('⚠️ ' + e.message); });
  },
  addBatchCandidates: function () {
    var ids = Object.keys(this._collectSel).map(Number).filter(Boolean);
    if (!ids.length) { showToast('⚠️ 未选中任何条目'); return; }
    var me = this;
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    showToast('⏳ 批量加入 ' + ids.length + ' 条…');
    var done = 0, fail = [];
    var next = function () {
      if (!ids.length) {
        if (done) showToast('✅ 批量加入完成（成功 ' + done + (fail.length ? '、失败 ' + fail.length : '') + '）');
        me._collectSel = {};
        me.load(me._current); me.render();
        me._loadCandidates();
        return;
      }
      var id = ids.shift();
      fetch('/api/reports/daily/' + me._current + '/items/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ intelId: id })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (d) {
        if (d.ok && d.j.ok) done++;
        else fail.push(id + (d.j && d.j.error ? ('：' + d.j.error) : ''));
        next();
      }).catch(function (e) { fail.push(id + '：' + e.message); next(); });
    };
    next();
  },

  _applyEditControls: function () {
    var rows = document.querySelectorAll('#dr-rows [data-dri]');
    rows.forEach(function (row) {
      if (row.querySelector('.dr-editctl')) return;
      var idx = row.getAttribute('data-dri');
      var ctl = document.createElement('div');
      ctl.className = 'dr-editctl';
      ctl.innerHTML =
        '<button title="上移" onclick="event.stopPropagation();DAILY_REPORT._moveRow(' + idx + ',-1)">▲</button>'
        + '<button title="下移" onclick="event.stopPropagation();DAILY_REPORT._moveRow(' + idx + ',1)">▼</button>'
        + '<button title="删除" onclick="event.stopPropagation();DAILY_REPORT._removeRow(' + idx + ')">🗑</button>';
      row.appendChild(ctl);
    });
  },

  _rowEl: function (idx) {
    return document.querySelector('#dr-rows [data-dri="' + idx + '"]');
  },
  _moveRow: function (idx, dir) {
    var row = this._rowEl(idx);
    if (!row) return;
    var sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    while (sib && !sib.hasAttribute('data-dri')) sib = dir < 0 ? sib.previousElementSibling : sib.nextElementSibling;
    if (!sib) return;
    if (dir < 0) row.parentNode.insertBefore(row, sib);
    else row.parentNode.insertBefore(sib, row);
  },
  _removeRow: function (idx) {
    var row = this._rowEl(idx);
    var it = this._loaded.items[idx];
    if (!row) return;
    if (!confirm('确认从简报中删除该条目？' + (it ? '\n' + String(it.title || '').slice(0, 60) : ''))) return;
    row.remove();
  },

  startEdit: function () {
    this._editMode = true;
    var rows = document.getElementById('dr-rows');
    if (rows) rows.classList.add('dr-editing');
    this._renderInter(document.getElementById('dr-body'));
    showToast('✏️ 编辑模式：条目可上移/下移/删除；点开条目可修改标题与摘要');
  },
  cancelEdit: function () {
    this._editMode = false;
    this.load(this._current); /* 重新加载，丢弃未保存修改 */
  },

  /* 从 DOM 收集编辑结果：DOM 行顺序即各节条目顺序；未在 DOM 出现的原节条目视为已删除；
   * 从未展示过的条目（超上限被节过滤）保留在 items 数组中不丢失。 */
  _collectEdits: function () {
    var loaded = this._loaded;
    var oldSections = loaded.sections || [];
    var oldIdxSet = new Set();
    oldSections.forEach(function (s) {
      (s.items || []).forEach(function (ix) { oldIdxSet.add(ix); });
      (s.subs || []).forEach(function (sub) { (sub.items || []).forEach(function (ix) { oldIdxSet.add(ix); }); });
    });
    var secDefs = {};
    oldSections.forEach(function (s) { secDefs[s.key] = s; });
    var present = new Set();
    var domSections = [];
    document.querySelectorAll('#dr-rows > [data-drs]').forEach(function (c) {
      var key = c.getAttribute('data-drs');
      var rowIdx = function (container) {
        var out = [];
        Array.prototype.forEach.call(container.children, function (ch) {
          if (ch.hasAttribute && ch.hasAttribute('data-dri')) {
            var v = parseInt(ch.getAttribute('data-dri'), 10);
            out.push(v); present.add(v);
          }
        });
        return out;
      };
      if (key === 'types12') {
        var subs = [];
        c.querySelectorAll('[data-drs^="types12:"]').forEach(function (sc) {
          subs.push({ type: sc.getAttribute('data-drs').slice(8), items: rowIdx(sc) });
        });
        domSections.push({ key: 'types12', subs: subs });
      } else if (secDefs[key]) {
        var def = secDefs[key];
        domSections.push({ key: key, icon: def.icon, title: def.title, emptyText: def.emptyText, items: rowIdx(c) });
      }
    });
    /* 压缩 items：删除已移除条目并重建索引映射 */
    var remap = new Map();
    var newItems = [];
    (loaded.items || []).forEach(function (it, i) {
      if (oldIdxSet.has(i) && !present.has(i)) return; /* 已删除 */
      remap.set(i, newItems.length);
      newItems.push(it);
    });
    domSections.forEach(function (s) {
      if (s.items) s.items = s.items.map(function (ix) { return remap.get(ix); }).filter(function (v) { return v !== undefined; });
      if (s.subs) s.subs.forEach(function (sub) { sub.items = sub.items.map(function (ix) { return remap.get(ix); }).filter(function (v) { return v !== undefined; }); });
    });
    return { items: newItems, sections: domSections };
  },

  saveEdits: function () {
    var me = this;
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || (typeof AUTH !== 'undefined' && AUTH.user && AUTH.user.token) || '';
    if (!tok) { showToast('⚠️ 请先登录后再编辑简报'); return; }
    var payload = this._collectEdits();
    if (!payload.items.length) { showToast('⚠️ 简报不能删除为空'); return; }
    fetch('/api/reports/daily/' + this._current, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ items: payload.items, sections: payload.sections, note: '人工编辑（改序/删除/改标题摘要）' })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (d) {
      if (d.ok && d.j.ok) {
        showToast('✅ 人工修改已保存（服务端已重渲染交互版与公文版，并留修订痕迹）');
        me._editMode = false;
        me.load(me._current);
        me.render();
      } else {
        showToast('⚠️ 保存失败：' + ((d.j && d.j.error) || '未知错误'));
      }
    }).catch(function (e) { showToast('⚠️ 保存失败：' + e.message); });
  },

  revertEdits: function () {
    var me = this;
    var tok = (typeof APIClient !== 'undefined' && APIClient.getToken()) || '';
    if (!tok) { showToast('⚠️ 请先登录'); return; }
    if (!confirm('确认撤销该日简报的全部人工修改，恢复自动生成版本？')) return;
    fetch('/api/reports/daily/' + this._current + '/edits', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { showToast('✅ 已恢复自动生成版本'); me.load(me._current); me.render(); }
        else showToast('⚠️ 撤销失败：' + ((d && d.error) || '未知错误'));
      }).catch(function (e) { showToast('⚠️ 撤销失败：' + e.message); });
  },

  /* ===================== 条目详情抽屉 ===================== */
  openDrawer: function (idx) {
    var it = this._loaded && this._loaded.items[idx];
    var dw = document.getElementById('dr-drawer'), bd = document.getElementById('dr-backdrop');
    if (!it || !dw) return;
    var lvName = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' }[it.severity] || it.severity || '—';
    var lvColor = { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' }[it.severity] || '#888';
    var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var h =
      '<div style="padding:18px 20px">'
      + '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">'
      + '<span class="dr-tag" style="color:' + lvColor + ';border-color:' + lvColor + '">' + lvName + '</span>'
      + (it.china ? '<span class="dr-tag" style="color:#0a84ff;border-color:#0a84ff">涉华</span>' : '')
      + (it.negative ? '<span class="dr-tag" style="color:#ff8800;border-color:#ff8800">涉华负面</span>' : '')
      + '<span style="flex:1"></span>'
      + '<button class="btn sm" onclick="DAILY_REPORT.closeDrawer()">✖ 关闭</button>'
      + '</div>'
      + '<div style="font-size:15px;font-weight:700;line-height:1.6;margin-bottom:12px">' + esc(it.title) + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">'
      + '<span class="dr-tag">类型：' + esc({ terror_events: '恐怖袭击/武装袭击', military_conflicts: '武装冲突', social_unrest: '社会动荡', sanctions_data: '制裁与合规', political_events: '政治政局', natural_disasters: '自然灾害', public_health: '公共卫生', infrastructure: '基础设施与供应链', security_events: '治安事件', geopolitical_intel: '地缘动态', osint_intel: '开源情报综合' }[it.type] || it.type || '—') + '</span>'
      + '<span class="dr-tag">📍 ' + esc(it.eventCountry || it.country || '未标注') + '</span>'
      + (it.time ? '<span class="dr-tag">🕐 ' + esc(String(it.time).slice(0, 16)) + '</span>' : '')
      + (it.cred ? '<span class="dr-tag">信源 ' + esc(it.cred) + ' 级</span>' : '')
      + (it.corr > 1 ? '<span class="dr-tag">🔗 ' + it.corr + ' 方印证</span>' : '')
      + '<span class="dr-tag">来源：' + esc(it.source || '—') + '</span>'
      + '</div>'
      + ((it.assets || []).length ? '<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--text3);margin-bottom:4px">关联中资资产</div>' + it.assets.map(function (a) { return '<span class="dr-tag" style="color:#0a84ff;border-color:#0a84ff">🏗 ' + esc(a) + '</span>'; }).join('') + '</div>' : '')
      + '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">摘要（落库原文摘录）</div>'
      + '<div style="font-size:13px;line-height:1.8;color:var(--text2);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:14px">' + (it.digest ? esc(it.digest) : '<span style="color:var(--text3)">无摘要</span>') + '</div>'
      + (it.url ? '<div style="margin-bottom:14px"><a href="' + esc(it.url) + '" target="_blank" rel="noopener" style="color:var(--cyan);font-size:13px;text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">🔗 查看原文：' + esc(String(it.url).slice(0, 80)) + (String(it.url).length > 80 ? '…' : '') + '</a></div>' : '')
      + '<div style="font-size:10px;color:var(--text3)">数据中心原始记录 ID：' + (it.id || '—') + ' · 可回溯至数据中心</div>';
    if (this._editMode) {
      h += '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">'
        + '<div style="font-size:12px;font-weight:700;margin-bottom:8px">✏️ 修改该条目（仅保存后生效）</div>'
        + '<div style="font-size:11px;color:var(--text3);margin-bottom:4px">标题</div>'
        + '<input id="dr-edit-title" style="width:100%;padding:8px 10px;background:var(--panel2);border:1px solid var(--cyan);border-radius:6px;color:var(--text);font-size:13px;margin-bottom:8px" value="' + esc(it.title) + '">'
        + '<div style="font-size:11px;color:var(--text3);margin-bottom:4px">摘要</div>'
        + '<textarea id="dr-edit-digest" rows="5" style="width:100%;padding:8px 10px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;line-height:1.6;resize:vertical">' + esc(it.digest) + '</textarea>'
        + '<button class="btn sm primary" style="margin-top:10px" onclick="DAILY_REPORT._applyItemEdit(' + idx + ')">💾 保存该条目修改（待「保存修改」整体入库）</button>'
        + '</div>';
    }
    h += '</div>';
    dw.innerHTML = h;
    dw.classList.add('open');
    bd.classList.add('show');
  },
  closeDrawer: function () {
    var dw = document.getElementById('dr-drawer'), bd = document.getElementById('dr-backdrop');
    if (dw) dw.classList.remove('open');
    if (bd) bd.classList.remove('show');
  },
  _applyItemEdit: function (idx) {
    var it = this._loaded && this._loaded.items[idx];
    var ti = document.getElementById('dr-edit-title'), dg = document.getElementById('dr-edit-digest');
    if (!it || !ti) return;
    it.title = ti.value.trim() || it.title;
    it.digest = dg.value.trim();
    /* 同步交互版行内标题 */
    var row = this._rowEl(idx);
    if (row) {
      var t = row.querySelector('div');
      if (t) t.textContent = it.title;
    }
    showToast('✅ 条目已修改（点击顶部「保存修改」写入数据库）');
    this.closeDrawer();
  },

  /* ===================== 公文版 ===================== */
  _renderGov: function (body) {
    var d = this._data;
    if (!d.gov_html) {
      body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">该期简报暂无公文版数据（历史数据将在打开时自动补齐，或重新生成后再试）</div>';
      return;
    }
    var rev = d.revision || [];
    body.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">'
      + '<div style="font-size:15px;font-weight:700">📜 公文版 · GB/T 9704-2012 参考版式</div>'
      + (d.manual_edit ? '<span class="dr-tag" style="color:#ffcc00;border-color:#ffcc00">✎ 含人工修订</span>' : '')
      + '<span style="flex:1"></span>'
      + '<button class="btn sm" onclick="DAILY_REPORT.toggleRed()">' + (this._red ? '🔴 红头：开' : '⚪ 红头：关') + '</button>'
      + '<button class="btn sm primary" onclick="DAILY_REPORT.exportPDF()" title="按公文版式（含页边距）打印/另存为 PDF">🖨️ 导出 PDF</button>'
      + '<button class="btn sm primary" onclick="DAILY_REPORT.exportWord()" title="下载 Word 兼容 .doc 文档（离线自包含）">📄 导出 Word</button>'
      + '</div>'
      + (rev.length ? '<div style="font-size:11px;color:var(--text3);margin-bottom:10px">修订痕迹：' + rev.length + ' 次，最近 ' + String(rev[rev.length - 1].at || '').slice(0, 16).replace('T', ' ') + '（' + (rev[rev.length - 1].user || '') + '，' + (rev[rev.length - 1].note || '') + '）</div>' : '')
      + '<div class="dr-govwrap">' + d.gov_html + '</div>'
      + '<div style="font-size:11px;color:var(--text3);margin-top:10px">导出的 PDF/Word 均为离线自包含文件（SVG 图表内嵌、无外部脚本）；导出 PDF 将调用系统打印对话框，选择「另存为 PDF」即可。</div>';
    /* 应用红头开关状态 */
    var paper = body.querySelector('.drg-paper');
    if (paper) paper.classList.toggle('nored', !this._red);
  },

  toggleRed: function () {
    this._red = !this._red;
    this._renderGov(document.getElementById('dr-body'));
  },

  /* 公文内容（含内嵌样式），红头开关以 .nored 类体现 */
  _govDocHtml: function () {
    var t = document.createElement('div');
    t.innerHTML = this._data.gov_html;
    var paper = t.querySelector('.drg-paper');
    if (paper && !this._red) paper.classList.add('nored');
    return t.innerHTML;
  },

  exportPDF: function () {
    if (!this._data || !this._data.gov_html) { showToast('⚠️ 无公文版内容可导出'); return; }
    var content = this._govDocHtml();
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title></title>'
      + '<style>@page{size:A4;margin:3.7cm 2.6cm 3.5cm 2.8cm;}'
      + 'html,body{margin:0;padding:0;background:#fff;}'
      + '.drg-paper{width:auto !important;max-width:none !important;margin:0 !important;padding:0 !important;box-shadow:none !important;background:#fff !important;}'
      + '</style></head><body>' + content + '</body></html>';
    /* 2026-09-03 公文质量返工：导出前清空 <title>（避免 Chrome 把「海外利益安全日报 2026-09-03」
     * 注入页眉居中位置）；页脚 URL「127.0.0.1:3000/#situation 1/N」来自 Chrome 打印对话框的默认
     * 「页眉和页脚」选项，DOM 无法通过 CSS 隐藏，必须由用户在打印对话框「更多设置」中取消勾选
     * 「页眉和页脚」+「页码」才能彻底消除——已通过 toast 提示。 */
    var oldTitle = document.title;
    document.title = ' ';
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(doc); f.contentDocument.close();
    showToast('🖨️ 已调起打印对话框：目标选「另存为 PDF」；⚠️ 请在「更多设置」中取消勾选「页眉和页脚」+「页码」以消除浏览器自动注入的 URL/日期');
    setTimeout(function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { showToast('⚠️ 打印调起失败：' + e.message); }
      setTimeout(function () { try { document.title = oldTitle; } catch (e) {} f.remove(); }, 6000);
    }, 400);
  },

  exportWord: function () {
    if (!this._data || !this._data.gov_html) { showToast('⚠️ 无公文版内容可导出'); return; }
    var content = this._govDocHtml();
    var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
      + '<head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><meta name="Generator" content="Microsoft Word 15">'
      + '<title>海外利益安全日报 ' + this._current + '</title>'
      + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
      + '<style>@page WordSection1{size:595.3pt 841.9pt;margin:104.9pt 73.7pt 99.2pt 79.4pt;mso-page-orientation:portrait;}'
      + 'div.WordSection1{page:WordSection1;}'
      + 'body{margin:0;background:#fff;}'
      + '.drg-paper{width:auto !important;max-width:none !important;margin:0 !important;padding:0 !important;box-shadow:none !important;background:#fff !important;}'
      + '</style></head><body><div class="WordSection1">' + content + '</div></body></html>';
    var blob = new Blob(['\ufeff' + doc], { type: 'application/msword;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '海外利益安全日报_' + this._current + '.doc';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    showToast('📄 Word 文档已开始下载（.doc，离线自包含，可用 Word/WPS 打开编辑）');
  },

  /* ===================== 生成 ===================== */
  generate: function (force) {
    var me = this;
    showToast('⏳ 正在汇总昨日数据生成简报…');
    fetch('/api/reports/daily/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(force ? { force: true } : {})
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; });
    }).then(function (d) {
      if (d.status === 409 && d.j && d.j.manual_edit) {
        if (confirm(d.j.error + '\n\n是否确认覆盖并重新生成？')) me.generate(true);
        else showToast('已取消：人工编辑版本保持不变');
        return;
      }
      if (d.j && d.j.ok) { showToast('✅ 简报已生成（' + d.j.date + '，' + d.j.total + ' 条数据）'); DAILY_REPORT._current = d.j.date; DAILY_REPORT.render(); }
      else showToast('⚠️ 生成失败：' + ((d.j && d.j.error) || '未知错误'));
    }).catch(function (e) { showToast('⚠️ 生成失败：' + e.message); });
  }
};
