/* ===== brief-center.js — 领导要报速览 + 事件洞察弹窗（2026-09-05 用户指令三）=====
 * 此前 5 项功能审查建议只停在建议清单，未落代码（用户反馈"我怎么看不见"）。
 * 本模块把其中三项做成真实可见功能（零模拟，全部走 /api/insight 真实库计算）：
 *   ① LEADERBRIEF：领导要报速览视图（30 秒一页纸）
 *      BLUF 结构：红橙大数字 → TOP5 事件卡 → 涉华要点 → 一句话决策建议 → 待办风险；
 *      一键打印/导出 PDF（公文白底版式）。
 *   ② INSIGHT.openLifecycle(id)：事件全生命周期时间线弹窗
 *      首次采集 → 多源印证 → 预警入列 → 审核入库 → 处置跟踪 → 归档复盘。
 *   ③ INSIGHT.openSimilar(id)：相似历史事件匹配弹窗
 *      同类历史事件数、级别分布、热点国别、匹配列表。
 * showAlertDetail 预警详情弹窗已挂「时间线」「相似事件」入口按钮（app.js）。
 * 四步注册：侧边栏 data-view → view-brief 容器 → app.js VIEW_MAP → role-ui.js。 */
'use strict';
/* 视图样式（一次性注入：深空 HUD，色板与平台 CSS 变量对齐） */
(function () {
  if (document.getElementById('lb-style')) return;
  var st = document.createElement('style');
  st.id = 'lb-style';
  st.textContent =
    '#view-brief{padding:16px;max-width:1280px;margin:0 auto}' +
    '.lb-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}' +
    '.lb-tt{font-size:20px;font-weight:800;color:#dff3ff;letter-spacing:1px}' +
    '.lb-sub{font-size:11px;color:#7aa5c9;margin-top:3px}' +
    '.lb-actions{margin-left:auto;display:flex;gap:8px}' +
    '.lb-btn{background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.3);color:#9fc3e2;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;transition:.15s}' +
    '.lb-btn:hover{border-color:var(--cyan,#00d4ff);color:#dff3ff}' +
    '.lb-btn.primary{background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;border:none;font-weight:700}' +
    '.lb-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}' +
    '.lb-kpi{background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.15);border-radius:8px;padding:12px 14px;text-align:center}' +
    '.lb-kpi .v{font-size:30px;font-weight:800;line-height:1.1;text-shadow:0 0 12px currentColor}' +
    '.lb-kpi .l{font-size:11px;color:#7aa5c9;margin-top:4px}' +
    '.lb-grid{display:grid;grid-template-columns:3fr 2fr;gap:10px}' +
    '@media (max-width:960px){.lb-grid{grid-template-columns:1fr}.lb-kpis{grid-template-columns:repeat(2,1fr)}}' +
    '.lb-panel{background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.18);border-radius:10px;padding:12px 14px}' +
    '.lb-sec-tt{font-size:13px;font-weight:700;color:#22d3ee;margin-bottom:8px;border-left:3px solid #22d3ee;padding-left:8px}' +
    '.lb-ev{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg2,#132743);border-radius:6px;margin-bottom:6px;border-left:2px solid rgba(0,212,255,.25)}' +
    '.lb-ev.lv-red{border-left-color:#ff3355}.lb-ev.lv-orange{border-left-color:#ff8800}.lb-ev.lv-yellow{border-left-color:#ffcc00}.lb-ev.lv-blue{border-left-color:#00d4ff}' +
    '.lb-ev-lv{font-size:11px;font-weight:800;white-space:nowrap;min-width:34px}' +
    '.lb-ev-main{flex:1;min-width:0}' +
    '.lb-ev-tt{font-size:12.5px;color:#dff3ff;line-height:1.5;word-break:break-all}' +
    '.lb-ev-meta{font-size:10px;color:#7aa5c9;margin-top:3px}' +
    '.lb-ev-btns{display:flex;gap:6px;flex-shrink:0}' +
    '.lb-mini{font-size:10px;color:#22d3ee;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.25);border-radius:10px;padding:2px 9px;cursor:pointer;white-space:nowrap;transition:.15s}' +
    '.lb-mini:hover{background:rgba(0,212,255,.2)}' +
    '.lb-tag{font-size:9px;border-radius:8px;padding:1px 6px;font-weight:700}' +
    '.lb-tag.cn{background:rgba(255,51,85,.15);color:#ff5f9e;border:1px solid rgba(255,51,85,.35)}' +
    '.lb-tag.corr{background:rgba(0,212,255,.12);color:#22d3ee;border:1px solid rgba(0,212,255,.3)}' +
    '.lb-pend{font-size:11.5px;color:#c9e2f5;padding:5px 8px;background:var(--bg2,#132743);border-radius:5px;margin-bottom:4px}' +
    '.lb-adv{font-size:12px;color:#dff3ff;line-height:1.8;padding:4px 0}' +
    '.lb-foot{font-size:10px;color:#5a7a99;margin-top:10px;border-top:1px dashed rgba(0,212,255,.2);padding-top:8px}' +
    '.lb-empty{font-size:11.5px;color:#5a7a99;padding:10px 4px}' +
    '.lb-loading{padding:40px 0;text-align:center;color:#22d3ee;font-size:13px}';
  document.head.appendChild(st);
})();
var LEADERBRIEF = {
  _data: null, _loading: false,

  init: function () {
    var host = document.getElementById('brief-root');
    if (!host) return;
    this.render();
    this.load();
  },

  load: function () {
    var self = this;
    if (this._loading) return;
    this._loading = true;
    this._renderBody('<div class="lb-loading">⟳ 领导要报装配中（真实库 24h 聚合）…</div>');
    fetch('/api/insight/leader-brief').then(function (r) { return r.json(); }).then(function (d) {
      self._loading = false;
      self._data = (d && d.ok) ? d : null;
      self._renderBody(null);
    }).catch(function () {
      self._loading = false;
      self._renderBody('<div class="lb-empty">⚠️ 情报洞察服务不可达，请确认后端运行后刷新</div>');
    });
  },

  render: function () {
    var host = document.getElementById('brief-root');
    if (!host) return;
    host.innerHTML =
      '<div class="lb-head">' +
        '<span style="font-size:22px;filter:drop-shadow(0 0 10px rgba(255,60,80,.4))">🔴</span>' +
        '<div><div class="lb-tt">领导要报速览</div><div class="lb-sub">30 秒一页纸 · 近 24 小时真实采集库聚合 · 红橙置顶 · 涉华优先</div></div>' +
        '<div class="lb-actions">' +
          '<button class="lb-btn" onclick="LEADERBRIEF.load()">🔄 刷新</button>' +
          '<button class="lb-btn" onclick="INSIGHT.openSources()">📡 信源分级</button>' +
          '<button class="lb-btn primary" onclick="LEADERBRIEF.printPage()">🖨️ 导出一页纸（PDF）</button>' +
        '</div>' +
      '</div>' +
      '<div id="lb-body"></div>';
  },

  _renderBody: function (loadingHtml) {
    var el = document.getElementById('lb-body');
    if (!el) return;
    if (loadingHtml) { el.innerHTML = loadingHtml; return; }
    var d = this._data;
    if (!d) { el.innerHTML = '<div class="lb-empty">暂无数据</div>'; return; }
    var s = d.stats || {};
    var lvC = { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' };
    var lvN = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' };
    function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function card(i, idx) {
      return '<div class="lb-ev lv-' + i.level + '">' +
        '<div class="lb-ev-lv" style="color:' + (lvC[i.level] || '#8fa') + '">' + (lvN[i.level] || i.level) + '</div>' +
        '<div class="lb-ev-main"><div class="lb-ev-tt">' + esc(idx ? idx + '. ' : '') + esc(i.title || '—') +
          (i.china ? ' <span class="lb-tag cn">涉华</span>' : '') + (i.corr > 1 ? ' <span class="lb-tag corr">' + i.corr + ' 源印证</span>' : '') + '</div>' +
          '<div class="lb-ev-meta">' + esc(i.country || '未标注') + ' · ' + esc(i.type || '') + ' · ' + esc(String(i.time || '').replace('T', ' ').slice(0, 16)) + '</div></div>' +
        '<div class="lb-ev-btns">' +
          '<span class="lb-mini" onclick="INSIGHT.openLifecycle(' + esc(i.id) + ')" title="查看该事件全生命周期时间线">⏱ 时间线</span>' +
          '<span class="lb-mini" onclick="INSIGHT.openSimilar(' + esc(i.id) + ')" title="匹配库内同类历史事件">🔍 相似事件</span>' +
        '</div></div>';
    }
    var stat = [
      ['今日总量', s.total || 0, '#00d4ff'],
      ['红色预警', s.red || 0, '#ff3355'],
      ['橙色预警', s.orange || 0, '#ff8800'],
      ['涉华情报', s.china || 0, '#ff5f9e']
    ].map(function (x) {
      return '<div class="lb-kpi"><div class="v" style="color:' + x[2] + '">' + x[1] + '</div><div class="l">' + x[0] + '</div></div>';
    }).join('');
    var html =
      '<div class="lb-grid">' +
        '<div class="lb-panel">' +
          '<div class="lb-sec-tt">⚑ 红橙要情 TOP5（涉华加权置顶）</div>' +
          ((d.top || []).length ? d.top.map(function (i, n) { return card(i, n + 1); }).join('') : '<div class="lb-empty">近 24h 无红橙事件</div>') +
        '</div>' +
        '<div class="lb-panel">' +
          '<div class="lb-sec-tt">🇨🇳 涉华要点</div>' +
          ((d.chinaTop || []).length ? d.chinaTop.map(function (i) { return card(i); }).join('') : '<div class="lb-empty">近 24h 无涉华关联情报</div>') +
          '<div class="lb-sec-tt" style="margin-top:12px">📋 待办风险（涉华黄橙 · 需加密跟踪）</div>' +
          ((d.pending || []).length ? d.pending.map(function (i) {
            return '<div class="lb-pend lv-' + i.level + '"><span style="color:' + (lvC[i.level] || '#8fa') + '">●</span> ' + esc(i.title || '—') +
              ' <span class="lb-ev-meta">（' + esc(i.country || '') + ' · ' + (i.corr || 0) + ' 源印证）</span></div>';
          }).join('') : '<div class="lb-empty">无待办风险项</div>') +
        '</div>' +
      '</div>' +
      '<div class="lb-panel" style="margin-top:10px">' +
        '<div class="lb-sec-tt">💬 一句话决策建议（自动装配 · 引用真实数字）</div>' +
        (d.advice || []).map(function (a, n) { return '<div class="lb-adv">▸ ' + esc(a) + '</div>'; }).join('') +
        '<div class="lb-foot">数据窗口：近 24 小时 · 装配时间：' + esc(d.generatedAt || '') + ' · 全部来自平台真实采集库聚合（零模拟）</div>' +
      '</div>';
    el.innerHTML = stat ? '<div class="lb-kpis">' + stat + '</div>' + html : html;
  },

  /* 导出一页纸：打开打印窗口（公文白底版式） */
  printPage: function () {
    var d = this._data;
    if (!d) { try { showToast('暂无可导出的要报数据'); } catch (e) {} return; }
    var s = d.stats || {};
    var w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) { try { showToast('浏览器拦截了打印窗口，请允许弹出'); } catch (e) {} return; }
    function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    var rows = (d.top || []).map(function (i, n) {
      return '<tr><td>' + (n + 1) + '</td><td>' + esc(i.title) + '</td><td>' + esc(i.country || '—') + '</td><td>' + esc(i.type || '') + '</td></tr>';
    }).join('');
    var chinaRows = (d.chinaTop || []).map(function (i, n) {
      return '<tr><td>' + (n + 1) + '</td><td>' + esc(i.title) + '</td><td>' + esc(i.country || '—') + '</td></tr>';
    }).join('');
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>领导要报速览</title><style>' +
      'body{font-family:"FangSong","仿宋",serif;margin:46px;color:#000;background:#fff}' +
      'h1{text-align:center;font-size:22px;font-family:"SimHei","黑体";margin:0 0 4px;letter-spacing:6px}' +
      '.meta{text-align:center;font-size:12px;color:#555;margin-bottom:18px}' +
      'h2{font-size:15px;font-family:"SimHei","黑体";border-left:4px solid #a00;padding-left:8px;margin:18px 0 8px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px 8px;text-align:left}th{background:#f2f2f2;font-family:"SimHei","黑体"}' +
      '.adv{font-size:13px;line-height:2;text-indent:2em}.foot{margin-top:24px;text-align:right;font-size:12px}' +
      '</style></head><body>' +
      '<h1>领导要报速览</h1>' +
      '<div class="meta">' + esc(d.generatedAt || '') + ' · 数据窗口近 24 小时 · 海外利益保护情报预警平台</div>' +
      '<h2>一、总体态势</h2>' +
      '<p style="font-size:13px;line-height:2">近24小时共监测独立情报事件 ' + (s.total || 0) + ' 条，其中红色 ' + (s.red || 0) + ' 条、橙色 ' + (s.orange || 0) + ' 条、涉华关联 ' + (s.china || 0) + ' 条。以上数据均来自平台真实采集库聚合。</p>' +
      '<h2>二、红橙要情 TOP5</h2>' +
      (rows ? '<table><tr><th>#</th><th>事件</th><th>国别</th><th>类别</th></tr>' + rows + '</table>' : '<p style="font-size:13px">近24小时无红橙事件。</p>') +
      '<h2>三、涉华要点</h2>' +
      (chinaRows ? '<table><tr><th>#</th><th>事件</th><th>国别</th></tr>' + chinaRows + '</table>' : '<p style="font-size:13px">近24小时无涉华关联情报。</p>') +
      '<h2>四、决策建议</h2>' +
      (d.advice || []).map(function (a) { return '<p class="adv">' + esc(a) + '。</p>'; }).join('') +
      '<div class="foot">海外利益保护情报预警平台<br>' + esc(String(d.generatedAt || '').split(' ')[0] || '') + '</div>' +
      '</body></html>');
    w.document.close();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
  }
};

/* ===== INSIGHT：事件洞察弹窗（生命周期时间线 / 相似历史事件匹配）===== */
var INSIGHT = {
  _modal: function (title, bodyHtml) {
    var old = document.getElementById('insight-modal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'insight-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,8,20,.72);display:flex;align-items:center;justify-content:center';
    m.innerHTML =
      '<div style="background:var(--panel,#0e1f3a);border:1px solid rgba(0,212,255,.25);border-radius:10px;max-width:860px;width:92%;max-height:86vh;overflow-y:auto;box-shadow:0 0 40px rgba(0,212,255,.15)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(0,212,255,.15);position:sticky;top:0;background:var(--panel,#0e1f3a);z-index:2">' +
          '<div style="font-size:14px;font-weight:700;color:#dff3ff">' + title + '</div>' +
          '<span style="cursor:pointer;color:#8fb6d9;font-size:18px;padding:0 6px" onclick="INSIGHT.close()">✕</span>' +
        '</div>' +
        '<div style="padding:14px 16px" id="insight-modal-body">' + bodyHtml + '</div>' +
      '</div>';
    document.body.appendChild(m);
  },
  close: function () { var m = document.getElementById('insight-modal'); if (m) m.remove(); },
  _load: function (url, title, render) {
    var self = this;
    this._modal(title, '<div style="padding:20px;color:#8fb6d9;font-size:12px">⟳ 真实库检索中…</div>');
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) { self._modal(title, '<div style="padding:16px;color:#ff8800;font-size:12px">⚠️ ' + ((d && d.error) || '查询失败') + '</div>'); return; }
      render(d);
    }).catch(function (e) {
      self._modal(title, '<div style="padding:16px;color:#ff3355;font-size:12px">⚠️ 情报洞察服务不可达：' + e.message + '</div>');
    });
  },

  /* 参数适配：数字/SRV-<数字> 直连 intel_data 主键；预警对象（含时间戳 id）回落标题关键词检索 */
  _qsFor: function (x) {
    if (x && typeof x === 'object') {
      var id = String(x.id || '');
      var m = id.match(/^(?:SRV-)?(\d{1,9})$/);
      if (m) return 'id=' + encodeURIComponent(m[1]);
      var kw = String(x.title || '').trim().slice(0, 40);
      return 'q=' + encodeURIComponent(kw) + (x.country ? '&country=' + encodeURIComponent(x.country) : '');
    }
    return 'id=' + encodeURIComponent(x);
  },

  /* 事件全生命周期时间线 */
  openLifecycle: function (id) {
    var self = this;
    this._load('/api/insight/lifecycle?' + this._qsFor(id), '⏱ 事件全生命周期时间线', function (d) {
      function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      var a = d.anchor || {};
      var stages = (d.stages || []).map(function (st, i) {
        var col = st.done ? '#00d4ff' : '#5a7a99';
        return '<div style="display:flex;gap:12px">' +
          '<div style="display:flex;flex-direction:column;align-items:center;width:18px">' +
            '<span style="width:10px;height:10px;border-radius:50%;background:' + col + ';box-shadow:0 0 8px ' + col + ';flex-shrink:0"></span>' +
            (i < d.stages.length - 1 ? '<span style="flex:1;width:2px;background:' + (st.done ? 'rgba(0,212,255,.4)' : 'rgba(90,122,153,.4)') + '"></span>' : '') +
          '</div>' +
          '<div style="padding-bottom:16px;min-width:0">' +
            '<div style="font-size:13px;font-weight:700;color:' + col + '">' + esc(st.name) +
              (st.done ? '' : ' <span style="font-size:10px;color:#5a7a99;font-weight:400">（未到达）</span>') +
              (st.time ? ' <span style="font-size:10px;color:#7aa5c9;font-weight:400">' + esc(String(st.time).replace('T', ' ')) + '</span>' : '') + '</div>' +
            '<div style="font-size:11px;color:#9fc3e2;line-height:1.7;margin-top:3px">' + esc(st.detail || '') + '</div>' +
          '</div></div>';
      }).join('');
      var rel = (d.related || []).slice(0, 10).map(function (r) {
        return '<div style="display:flex;gap:8px;font-size:11px;color:#9fc3e2;padding:4px 0;border-bottom:1px solid rgba(0,212,255,.08)">' +
          '<span style="color:#5a7a99;white-space:nowrap;min-width:104px">' + esc(String(r.time).replace('T', ' ')) + '</span>' +
          '<span style="flex:1">' + esc(r.title) + '</span>' +
          '<span style="color:#5a7a99;white-space:nowrap">' + esc(r.source) + '</span></div>';
      }).join('');
      self._modal('⏱ 事件全生命周期时间线',
        '<div style="font-size:12px;color:#dff3ff;font-weight:700;margin-bottom:4px">' + esc(a.title || '') + '</div>' +
        '<div style="font-size:10px;color:#7aa5c9;margin-bottom:14px">' + esc(a.country || '未标注') + ' · ' + esc(a.type || '') + ' · 级别 ' + esc(a.level || '—') + '</div>' +
        '<div style="padding:2px 0 4px">' + stages + '</div>' +
        '<div style="font-size:12px;font-weight:700;color:#22d3ee;margin:10px 0 6px;border-left:3px solid #22d3ee;padding-left:8px">库内相关条目流（' + (d.related || []).length + ' 条 · 按时间正序）</div>' +
        (rel || '<div style="color:#5a7a99;font-size:11px">暂无其他相关条目</div>'));
    });
  },

  /* 信源可信度分级（真实入库行为聚合） */
  openSources: function () {
    var self = this;
    this._load('/api/insight/source-cred', '📡 信源可信度分级（近 30 天真实库聚合）', function (d) {
      function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      var gC = { A: '#00e676', B: '#00d4ff', C: '#ffcc00', D: '#ff8800' };
      var gN = { A: 'A · 权威通讯社/主流大报', B: 'B · 高频持续采集源', C: 'C · 中频采集源', D: 'D · 低频待观察' };
      var rows = (d.rows || []).map(function (r) {
        return '<div style="display:flex;gap:10px;font-size:11.5px;padding:6px 4px;border-bottom:1px solid rgba(0,212,255,.08);align-items:center">' +
          '<span style="width:20px;height:20px;border-radius:50%;background:' + (gC[r.grade] || '#8fa') + ';color:#04121f;font-weight:800;font-size:11px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + esc(r.grade) + '</span>' +
          '<span style="flex:1;color:#dff3ff;word-break:break-all">' + esc(r.source) + '</span>' +
          '<span style="color:#7aa5c9;white-space:nowrap">30天 ' + r.volume30d + ' 条 · 7天 ' + r.active7d + ' 条</span>' +
          '<span style="color:#ff5f9e;white-space:nowrap">涉华 ' + r.chinaRate + '%</span>' +
          '<span style="color:#5a7a99;white-space:nowrap;min-width:88px;text-align:right">' + esc(r.lastSeen || '—') + '</span></div>';
      }).join('');
      var dist = d.dist || {};
      self._modal('📡 信源可信度分级（近 30 天真实库聚合）',
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
          Object.keys(gN).map(function (g) {
            return '<div style="background:rgba(0,212,255,.07);border:1px solid ' + gC[g] + '55;border-radius:6px;padding:6px 12px;font-size:11px;color:#dff3ff"><b style="color:' + gC[g] + '">' + dist[g] + '</b> 个 ' + gN[g] + '</div>';
          }).join('') + '</div>' +
        (rows || '<div style="color:#5a7a99;font-size:11px">暂无数据</div>') +
        '<div style="font-size:10px;color:#5a7a99;margin-top:12px;line-height:1.7">' + esc(d.note || '') + '</div>');
    });
  },

  /* 相似历史事件匹配 */
  openSimilar: function (id) {
    var self = this;
    this._load('/api/insight/similar?' + this._qsFor(id), '🔍 相似历史事件匹配', function (d) {
      function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
      var a = d.anchor || {}, st = d.stats || {};
      var lvC = { red: '#ff3355', orange: '#ff8800', yellow: '#ffcc00', blue: '#00d4ff' };
      var hot = (st.hotCountries || []).map(function (c) { return esc(c.country) + ' ' + c.n + ' 起'; }).join(' · ');
      var rows = (d.matches || []).map(function (m, n) {
        return '<div style="display:flex;gap:8px;font-size:11px;padding:6px 4px;border-bottom:1px solid rgba(0,212,255,.08);align-items:flex-start">' +
          '<span style="color:#5a7a99;min-width:16px">' + (n + 1) + '</span>' +
          '<span style="width:6px;height:6px;border-radius:50%;background:' + (lvC[m.level] || '#8fa') + ';margin-top:4px;flex-shrink:0"></span>' +
          '<span style="flex:1;color:#dff3ff">' + esc(m.title) +
            (m.sameCountry ? ' <span style="color:#ff5f9e;font-size:9px">同国</span>' : '') +
            (m.url ? ' <a href="' + esc(m.url) + '" target="_blank" rel="noopener" style="color:#22d3ee;font-size:9px" onclick="event.stopPropagation()">原文</a>' : '') + '</span>' +
          '<span style="color:#7aa5c9;white-space:nowrap">' + esc(m.time) + ' · ' + esc(m.country || '—') + '</span></div>';
      }).join('');
      self._modal('🔍 相似历史事件匹配',
        '<div style="font-size:12px;color:#dff3ff;font-weight:700;margin-bottom:4px">' + esc(a.title || '') + '</div>' +
        '<div style="font-size:10px;color:#7aa5c9;margin-bottom:12px">类别 ' + esc(a.type || '—') + ' · ' + esc(a.country || '未标注') + ' · 匹配口径：同类别 + 标题实质词元重合（同国加成）· 近 90 天</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
          '<div style="background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.25);border-radius:6px;padding:6px 12px;font-size:11px;color:#dff3ff">相似事件 <b style="color:#22d3ee">' + (d.matchCount || 0) + '</b> 起</div>' +
          '<div style="background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.25);border-radius:6px;padding:6px 12px;font-size:11px;color:#dff3ff">同类总量(90天) <b style="color:#22d3ee">' + (st.total90d || 0) + '</b> 条</div>' +
          '<div style="background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.25);border-radius:6px;padding:6px 12px;font-size:11px;color:#dff3ff">红 <b style="color:#ff3355">' + ((st.lvDist || {}).red || 0) + '</b> / 橙 <b style="color:#ff8800">' + ((st.lvDist || {}).orange || 0) + '</b></div>' +
        '</div>' +
        (hot ? '<div style="font-size:11px;color:#9fc3e2;margin-bottom:10px">📈 同类事件热点国别：' + hot + '</div>' : '') +
        (rows || '<div style="color:#5a7a99;font-size:11px;padding:10px 0">近 90 天库内无词元重合的同类历史事件（该事件可能是同类首例）</div>'));
    });
  }
};
window.LEADERBRIEF = LEADERBRIEF;
window.INSIGHT = INSIGHT;
