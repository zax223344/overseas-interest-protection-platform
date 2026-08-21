/* ===== 每日简报（2026-08-14）=====
 * 数据源：服务端 /api/reports/daily（每天 08:00 自动汇总前一日真实入库数据，零虚构）。
 * 本模块只做读取展示与手动触发生成，不在前端编造任何内容。 */
var DAILY_REPORT = {
  _list: [],
  _current: '',

  init: function () { this.render(); },

  render: function () {
    var el = document.getElementById('dailyreport-content');
    if (!el) return;
    var me = this;
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
    var chips = this._list.map(function (r) {
      var s = r.summary || {};
      return '<div class="dr-chip' + (r.report_date === me._current ? ' active' : '') + '" data-date="' + r.report_date + '" onclick="DAILY_REPORT.pick(\'' + r.report_date + '\')" '
        + 'style="padding:10px 14px;background:var(--panel2);border:1px solid ' + (r.report_date === me._current ? 'var(--cyan)' : 'var(--border)') + ';border-radius:8px;cursor:pointer;min-width:120px">'
        + '<div style="font-size:13px;font-weight:700;color:' + (r.report_date === me._current ? 'var(--cyan)' : 'var(--text)') + '">' + r.report_date + '</div>'
        + '<div style="font-size:10px;color:var(--text3);margin-top:2px">总量 ' + (s.total || 0) + ' · 涉华 ' + (s.china || 0) + ' · 红色 ' + (s.red || 0) + '</div>'
        + '</div>';
    }).join('');
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
      + '<div style="font-size:15px;font-weight:700">📰 每日简报</div>'
      + '<span style="font-size:11px;color:var(--text3)">每天 08:00 自动汇总前一日采集数据 · 全部内容可回溯数据中心原始记录</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn sm" onclick="DAILY_REPORT.generate()" title="以前一日数据重新生成">⚙️ 重新生成昨日简报</button>'
      + '<button class="btn sm" onclick="DAILY_REPORT.print()" title="打印/导出当前简报">🖨️ 打印</button>'
      + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' + chips + '</div>'
      + '<div id="dr-body" class="card" style="padding:20px 24px;max-width:960px"><div style="color:var(--text3)">加载中…</div></div>';
  },

  pick: function (date) {
    this._current = date;
    document.querySelectorAll('.dr-chip').forEach(function (c) {
      var on = c.getAttribute('data-date') === date;
      c.style.borderColor = on ? 'var(--cyan)' : 'var(--border)';
      c.querySelector('div').style.color = on ? 'var(--cyan)' : 'var(--text)';
      c.classList.toggle('active', on);
    });
    this.load(date);
  },

  load: function (date) {
    var body = document.getElementById('dr-body');
    if (!body) return;
    body.innerHTML = '<div style="color:var(--text3)">加载中…</div>';
    fetch('/api/reports/daily/' + date).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) { body.innerHTML = '<div style="color:var(--text3)">该日简报不存在</div>'; return; }
      body.innerHTML =
        '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">'
        + '<div style="font-size:20px;font-weight:800">海外利益安全日报</div>'
        + '<div style="font-size:13px;color:var(--cyan)">' + d.report_date + '</div>'
        + '<span style="flex:1"></span>'
        + '<div style="font-size:10px;color:var(--text3)">生成于 ' + String(d.created_at || '').slice(0, 16).replace('T', ' ') + '</div>'
        + '</div>'
        + d.html;
    }).catch(function () {
      body.innerHTML = '<div style="color:var(--text3)">加载失败</div>';
    });
  },

  generate: function () {
    showToast('⏳ 正在汇总昨日数据生成简报…');
    fetch('/api/reports/daily/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { showToast('✅ 简报已生成（' + d.date + '，' + d.total + ' 条数据）'); DAILY_REPORT._current = d.date; DAILY_REPORT.render(); }
        else showToast('⚠️ 生成失败：' + ((d && d.error) || '未知错误'));
      })
      .catch(function (e) { showToast('⚠️ 生成失败：' + e.message); });
  },

  print: function () {
    var body = document.getElementById('dr-body');
    if (!body) return;
    var w = window.open('', '_blank');
    w.document.write('<html><head><meta charset="utf-8"><title>海外利益安全日报 ' + this._current + '</title>'
      + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:32px;color:#111;max-width:900px;margin:0 auto}</style></head><body>'
      + body.innerHTML + '</body></html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 400);
  }
};
