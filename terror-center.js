/* ===== terror-center.js — 全球恐袭态势监测中心（#672 前端 / #681 改名+分类纠错）=====
 * 设计定位（用户 16:12 口径）：「不要用搜集的设计，用数据库或实时情报流」——
 * 常开雷达（always-on）：打开即全景，零输入零触发，与专项情报作战室彻底差异化。
 * 六区布局：
 *   ① KPI 带（今日研判口径量/近7日环比/红橙/高危国别/涉华关联）
 *   ② 组织活跃度雷达榜（83家威胁实体档案 × 近14天情报流碰撞，指数条+环比箭头+异动置顶）
 *   ③ 态势区（30天日度态势带 + 国别热度TOP12 + 级别金字塔）
 *   ④ 红橙预警面板 + 最新情报流（60s 自刷）
 *   ⑤ 涉华恐袭数据集（#689：2010以来针对驻外机构/中资企业/中国公民的袭击专项库，
 *      年度分布/国别TOP/目标类型/最新事件流 + 手动采集/历史回补）
 *   ⑥ AI 智库研判（《反恐态势通报》全球/组织两级，Kimi+规则回落，红头公文新窗输出）
 * 数据源：GET /api/terror/overview | /orgs | /judge（平台数据库真实聚合，零模拟）。
 * 四步注册：index.html 侧边栏 data-view=terjudge → view-terjudge 容器 →
 *   app.js VIEW_MAP + runViewInit（TERRORCENTER.init()）→ script 标签。 */
'use strict';
(function () {
  if (document.getElementById('tc-style')) return;
  var st = document.createElement('style');
  st.id = 'tc-style';
  st.textContent =
    '#view-terjudge{padding:16px;max-width:1340px;margin:0 auto}' +
    '.tc-head{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px}' +
    '.tc-head .tt{font-size:20px;font-weight:800;color:#ffe4e9;letter-spacing:1px}' +
    '.tc-head .sub{font-size:11px;color:#7aa5c9;margin-top:3px;max-width:760px;line-height:1.6}' +
    '.tc-live{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;color:#00e676;margin-top:4px}' +
    '.tc-live i{width:7px;height:7px;border-radius:50%;background:#00e676;box-shadow:0 0 8px #00e676;animation:tcblink 1.6s infinite}' +
    '@keyframes tcblink{0%,100%{opacity:1}50%{opacity:.25}}' +
    '.tc-head .sp{flex:1}' +
    '.tc-btn{background:linear-gradient(90deg,#b91c1c,#7f1d1d);color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;letter-spacing:.5px}' +
    '.tc-btn:hover{filter:brightness(1.25);box-shadow:0 0 14px rgba(239,68,68,.45)}' +
    '.tc-btn:disabled{opacity:.55;cursor:wait}' +
    '.tc-btn.ghost{background:var(--bg2,#132743);border:1px solid rgba(0,212,255,.3);color:#9fc3e2;font-weight:400}' +
    '.tc-btn.ghost:hover{border-color:#00d4ff;color:#dff3ff;box-shadow:none;filter:none}' +
    /* ① KPI 带 */
    '.tc-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px}' +
    '@media (max-width:1000px){.tc-kpis{grid-template-columns:repeat(2,1fr)}}' +
    '.tc-kpi{background:var(--panel,#0e1f3a);border:1px solid rgba(239,68,68,.16);border-radius:8px;padding:12px 14px;text-align:center}' +
    '.tc-kpi .v{font-size:26px;font-weight:800;line-height:1.15;text-shadow:0 0 12px currentColor}' +
    '.tc-kpi .l{font-size:11px;color:#7aa5c9;margin-top:4px}' +
    '.tc-kpi .d{font-size:10px;margin-top:2px;color:#8fa8c0}' +
    '.tc-up{color:#ff5f6d}.tc-dn{color:#00e676}' +
    '.tc-kpi.china .v{color:#ffcc00}.tc-kpi.red .v{color:#ff3355}.tc-kpi.today .v{color:#22d3ee}.tc-kpi.hot .v{color:#ff8800}' +
    '.tc-main{display:grid;grid-template-columns:1.05fr .95fr;gap:10px}' +
    '@media (max-width:1080px){.tc-main{grid-template-columns:1fr}}' +
    '.tc-panel{background:var(--panel,#0e1f3a);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:12px 14px;margin-bottom:10px}' +
    '.tc-panel.cyber{border-color:rgba(0,212,255,.18)}' +
    '.tc-sec{font-size:13px;font-weight:700;color:#ff7b93;margin-bottom:10px;border-left:3px solid #ef4444;padding-left:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.tc-panel.cyber .tc-sec{color:#22d3ee;border-left-color:#22d3ee}' +
    '.tc-sec .mut{font-size:10px;color:#5a7a99;font-weight:400}' +
    /* ② 组织活跃度雷达榜 */
    '.tc-org{display:flex;align-items:center;gap:9px;padding:7px 6px;border-bottom:1px solid rgba(239,68,68,.08);cursor:pointer;border-radius:6px;transition:.12s}' +
    '.tc-org:hover{background:rgba(239,68,68,.07)}' +
    '.tc-org .rank{width:20px;font-size:11px;font-weight:800;color:#5a7a99;text-align:center;flex-shrink:0}' +
    '.tc-org:nth-child(1) .rank,.tc-org:nth-child(2) .rank,.tc-org:nth-child(3) .rank{color:#ff3355}' +
    '.tc-org .nm{min-width:118px;max-width:150px;font-size:12px;font-weight:700;color:#ffe4e9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}' +
    '.tc-org .barwrap{flex:1;height:14px;border-radius:7px;background:rgba(239,68,68,.08);overflow:hidden;position:relative;min-width:70px}' +
    '.tc-org .bar{height:100%;border-radius:7px;background:linear-gradient(90deg,#ef4444,#f59e0b);box-shadow:0 0 8px rgba(239,68,68,.4)}' +
    '.tc-org .bar i{position:absolute;top:0;left:8px;line-height:14px;font-size:10px;font-style:normal;color:#ffd6de;font-weight:700}' +
    '.tc-org .sc{font-size:12px;font-weight:800;color:#ff7b93;width:34px;text-align:right;flex-shrink:0}' +
    '.tc-org .dl{font-size:10px;width:52px;text-align:right;flex-shrink:0;font-weight:700}' +
    '.tc-org .ev{font-size:9.5px;color:#5a7a99;width:56px;text-align:right;flex-shrink:0}' +
    '.tc-surge{font-size:9px;border-radius:8px;padding:1px 6px;font-weight:700;background:rgba(239,68,68,.14);color:#ff5f6d;border:1px solid rgba(239,68,68,.35);margin-left:2px}' +
    '.tc-quiet{font-size:9px;border-radius:8px;padding:1px 6px;font-weight:700;background:rgba(90,122,153,.12);color:#7a93ab;border:1px solid rgba(90,122,153,.3);margin-left:2px}' +
    /* ③ 态势带 / 国别 / 金字塔 */
    '.tc-trend{display:flex;align-items:flex-end;gap:2px;height:96px;background:var(--bg2,#132743);border-radius:6px;padding:6px 4px 0;overflow-x:auto;margin-bottom:4px}' +
    '.tc-trend .col{flex:1;min-width:9px;display:flex;flex-direction:column-reverse;border-radius:2px 2px 0 0;position:relative;cursor:default}' +
    '.tc-trend .col:hover{outline:1px solid rgba(0,212,255,.6)}' +
    '.tc-trend .col b{display:block}' +
    '.tc-trend .col .r{background:#ff3355}.tc-trend .col .o{background:#ff8800}.tc-trend .col .y{background:#eab308}.tc-trend .col .bl{background:#2563eb}' +
    '.tc-trend .tip{position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:8.5px;color:#c9e2f5;white-space:nowrap}' +
    '.tc-trend-x{display:flex;gap:2px;padding:2px 4px;font-size:8.5px;color:#5a7a99;overflow-x:auto}' +
    '.tc-trend-x b{flex:1;min-width:9px;text-align:center;font-weight:400;overflow:hidden;white-space:nowrap}' +
    '.tc-cbar{display:flex;align-items:center;gap:8px;padding:3.5px 4px;font-size:11px}' +
    '.tc-cbar .cn{width:76px;color:#d7e9f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}' +
    '.tc-cbar .bw{flex:1;height:11px;background:rgba(0,212,255,.08);border-radius:6px;overflow:hidden}' +
    '.tc-cbar .bw i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#f59e0b,#ef4444)}' +
    '.tc-cbar .nv{color:#ff8800;font-weight:800;width:32px;text-align:right;flex-shrink:0}' +
    '.tc-pyr{display:flex;flex-direction:column;align-items:center;gap:4px;margin-top:4px}' +
    '.tc-pyr .lv{display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;border-radius:4px;height:26px}' +
    /* ④ 预警/情报流条目 */
    '.tc-item{display:flex;gap:8px;font-size:11.5px;padding:6px 4px;border-bottom:1px solid rgba(0,212,255,.07);align-items:flex-start}' +
    '.tc-item .tm{color:#5a7a99;white-space:nowrap;min-width:88px;font-family:Consolas,monospace;font-size:10px;padding-top:2px}' +
    '.tc-item .lv{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}' +
    '.tc-item .tx{flex:1;color:#dff3ff;line-height:1.6;word-break:break-all}' +
    '.tc-item .tx em{font-style:normal;font-size:10px;color:#7aa5c9;margin-right:6px}' +
    '.tc-item .cn-tag{font-size:9px;border-radius:8px;padding:1px 6px;font-weight:700;background:rgba(255,204,0,.1);color:#ffcc00;border:1px solid rgba(255,204,0,.3);margin-left:4px;white-space:nowrap}' +
    '.tc-item a{color:#22d3ee;font-size:10px;text-decoration:none;margin-left:4px}' +
    /* ⑤ 研判 + 抽屉 */
    '.tc-judge p{font-size:12.5px;color:#d7e9f9;line-height:1.95;margin:0 0 10px;text-indent:2em}' +
    '.tc-badge{font-size:9.5px;border-radius:8px;padding:2px 8px;font-weight:700}' +
    '.tc-badge.llm{background:rgba(0,230,118,.12);color:#00e676;border:1px solid rgba(0,230,118,.35)}' +
    '.tc-badge.rule{background:rgba(255,204,0,.12);color:#ffcc00;border:1px solid rgba(255,204,0,.3)}' +
    '.tc-note{font-size:10px;color:#5a7a99;line-height:1.7;margin-top:10px;border-top:1px dashed rgba(239,68,68,.18);padding-top:8px}' +
    '.tc-drawer{position:fixed;inset:0;background:rgba(3,10,24,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.tc-dbox{background:var(--panel,#0e1f3a);border:1px solid rgba(239,68,68,.45);border-radius:12px;max-width:920px;width:100%;max-height:88vh;overflow:auto;padding:16px 18px;box-shadow:0 0 40px rgba(239,68,68,.25)}' +
    '.tc-dhead{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px}' +
    '.tc-dhead h3{margin:0;font-size:17px;color:#ffe4e9;flex:1}' +
    '.tc-dclose{background:none;border:1px solid rgba(239,68,68,.4);color:#ff7b93;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px}' +
    '.tc-dclose:hover{background:rgba(239,68,68,.15)}' +
    '.tc-dmeta{display:flex;gap:8px;flex-wrap:wrap;font-size:10.5px;color:#9fc3e2;margin-bottom:10px}' +
    '.tc-dmeta b{color:#dff3ff}' +
    '.tc-alias{font-size:10px;color:#7aa5c9;margin-bottom:8px;line-height:1.7}' +
    '.tc-loading{padding:40px 0;text-align:center;color:#22d3ee;font-size:13px}' +
    '.tc-empty{padding:30px 0;text-align:center;color:#5a7a99;font-size:12px;line-height:2}' +
    '.tc-flex{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}' +
    /* #689 涉华恐袭数据集面板 */
    '.tc-cn{border-color:rgba(255,204,0,.28);margin-top:2px}' +
    '.tc-cn .tc-sec{color:#ffcc00;border-left-color:#ffcc00}' +
    '.tc-cn-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}' +
    '@media (max-width:1000px){.tc-cn-kpis{grid-template-columns:repeat(2,1fr)}}' +
    '.tc-cn-grid{display:grid;grid-template-columns:1fr 1.55fr;gap:10px}' +
    '@media (max-width:1080px){.tc-cn-grid{grid-template-columns:1fr}}' +
    '.tc-yr{display:flex;align-items:flex-end;gap:3px;height:80px;background:var(--bg2,#132743);border-radius:6px;padding:5px 3px 0;overflow-x:auto}' +
    '.tc-yr .col{flex:1;min-width:14px;display:flex;flex-direction:column-reverse;border-radius:2px 2px 0 0;position:relative}' +
    '.tc-yr .col b{display:block;background:linear-gradient(180deg,#ffcc00,#ff8800);border-radius:2px 2px 0 0}' +
    '.tc-yr-x{display:flex;gap:3px;padding:2px 3px;font-size:9px;color:#5a7a99;overflow-x:auto}' +
    '.tc-yr-x b{flex:1;min-width:14px;text-align:center;font-weight:400}' +
    '.tc-tg{display:flex;align-items:center;gap:7px;padding:4px;font-size:11px}' +
    '.tc-tg .cn{width:96px;color:#d7e9f9;flex-shrink:0}' +
    '.tc-tg .bw{flex:1;height:11px;background:rgba(255,204,0,.08);border-radius:6px;overflow:hidden}' +
    '.tc-tg .bw i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#ffcc00,#ef4444)}' +
    '.tc-tg .nv{color:#ffcc00;font-weight:800;width:30px;text-align:right;flex-shrink:0}' +
    '.tc-cn-item .tx em{color:#ffcc00}' +
    '.tc-tgtag{font-size:9px;border-radius:8px;padding:1px 5px;font-weight:700;background:rgba(255,204,0,.12);color:#ffcc00;border:1px solid rgba(255,204,0,.3);margin-left:4px;white-space:nowrap}' +
    '.tc-cn-st{font-size:10.5px;color:#9fc3e2;line-height:1.9;background:rgba(255,204,0,.04);border:1px dashed rgba(255,204,0,.2);border-radius:6px;padding:8px 10px;margin-top:10px}' +
    '.tc-cn-st b{color:#ffe4e9}' +
    /* #692 事件卡流（点击→研判）+ 红橙预警强调 + 30 天预测区 */
    '.tc-evwrap{display:flex;flex-direction:column;gap:8px;max-height:620px;overflow-y:auto;padding-right:4px}' +
    '.tc-evcard{background:rgba(255,204,0,.03);border:1px solid rgba(255,204,0,.16);border-left:3px solid #eab308;border-radius:8px;padding:9px 11px;cursor:pointer;transition:.15s}' +
    '.tc-evcard:hover{background:rgba(255,204,0,.08);border-color:rgba(255,204,0,.45);transform:translateX(2px)}' +
    '.tc-evcard .h{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px}' +
    '.tc-evcard .tm{font-size:10px;color:#7aa5c9;font-family:Consolas,monospace}' +
    '.tc-evcard .cty{font-size:10.5px;color:#ffcc00;font-weight:700}' +
    '.tc-evcard .tt{font-size:12px;color:#dff3ff;line-height:1.65;word-break:break-all}' +
    '.tc-evcard .src{font-size:9.5px;color:#5a7a99;margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.tc-evcard .src a{color:#22d3ee;text-decoration:none}' +
    '.tc-evcard.ro{border-left-color:#ff8800;background:rgba(255,136,0,.05)}' +
    '.tc-evcard.rd{border-left-color:#ff3355;background:rgba(255,51,85,.07);box-shadow:0 0 12px rgba(255,51,85,.18)}' +
    '.tc-evcard.rd:hover{box-shadow:0 0 18px rgba(255,51,85,.35)}' +
    '.tc-evcard.ro:hover{box-shadow:0 0 14px rgba(255,136,0,.3)}' +
    '.tc-warn{font-size:9px;border-radius:8px;padding:1px 6px;font-weight:800;background:rgba(255,51,85,.16);color:#ff5f6d;border:1px solid rgba(255,51,85,.4);white-space:nowrap}' +
    '.tc-fc{margin-top:10px;border:1px dashed rgba(124,58,237,.4);border-radius:8px;padding:10px 12px;background:rgba(124,58,237,.04)}' +
    '.tc-fc .h{font-size:12px;font-weight:700;color:#c4b5fd;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.tc-fc p{font-size:12px;color:#d7e9f9;line-height:1.9;margin:0 0 8px;text-indent:2em}' +
    '.tc-cn-empty{padding:24px 12px;text-align:center;color:#7aa5c9;font-size:11.5px;line-height:2.1;background:rgba(255,204,0,.03);border:1px dashed rgba(255,204,0,.2);border-radius:8px}' +
    /* #698-② 涉华恐袭研判中心：AI 大盘威胁研判 + 国别下钻 */
    '.tc-br{margin-bottom:10px;border:1px solid rgba(255,51,85,.35);border-left:3px solid #ff3355;border-radius:10px;padding:12px 14px;background:linear-gradient(135deg,rgba(255,51,85,.07),rgba(255,204,0,.03))}' +
    '.tc-br .h{font-size:13px;font-weight:800;color:#ffb3c0;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.tc-br .h .badge{font-size:9px;border-radius:8px;padding:2px 8px;font-weight:700;background:rgba(255,51,85,.15);color:#ff8fa3;border:1px solid rgba(255,51,85,.4)}' +
    '.tc-br .h .sp{flex:1}' +
    '.tc-br p{font-size:11.5px;color:#d7e9f9;line-height:1.9;margin:0 0 7px}' +
    '.tc-br .meta{font-size:9.5px;color:#7aa5c9;margin-top:6px}' +
    '.tc-cbar.click{cursor:pointer;border-radius:6px;transition:.13s;padding:2px 3px}' +
    '.tc-cbar.click:hover{background:rgba(255,204,0,.07)}' +
    '.tc-cbar.click.on{background:rgba(124,58,237,.12);outline:1px solid rgba(124,58,237,.35)}' +
    '.tc-cdrill{background:rgba(0,0,0,.24);border:1px solid rgba(255,204,0,.25);border-radius:8px;margin:5px 0 8px;padding:9px 11px}' +
    '.tc-cdrill .dh{font-size:11px;color:#ffcc00;font-weight:800;margin-bottom:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.tc-cdrill .dh .sp{flex:1}' +
    '.tc-cdev{display:flex;gap:7px;align-items:flex-start;font-size:11px;color:#d7e9f9;padding:5px 3px;border-bottom:1px dashed rgba(255,204,0,.12);cursor:pointer;border-radius:5px;line-height:1.5}' +
    '.tc-cdev:hover{background:rgba(255,204,0,.07)}' +
    '.tc-cdev:last-child{border-bottom:none}' +
    '.tc-cdev .lv{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0}' +
    '.tc-cdev .tm{color:#5a7a99;font-size:9.5px;white-space:nowrap;font-family:Consolas,monospace;padding-top:2px;flex-shrink:0}';
  document.head.appendChild(st);
})();

var TERRORCENTER = {
  _ov: null, _orgs: null, _timer: null, _busy: false, _judgeHtml: '',

  init: function () {
    var host = document.getElementById('terjudge-root');
    if (!host) return;
    /* #684 防抖：runViewInit 短时间重复触发（点击+hashchange 双路径）时不再重复拉数据 */
    var now = Date.now();
    if (this._lastInit && now - this._lastInit < 2000) return;
    this._lastInit = now;
    this.renderShell();
    this.load();
    this.loadChina();
    /* 常开雷达：60s 自刷最新情报流与预警面板 */
    if (this._timer) clearInterval(this._timer);
    if (this._retryTimer) clearTimeout(this._retryTimer);
    var self = this;
    this._timer = setInterval(function () { self.load(true); self.loadChina(true); }, 60000);
  },

  _fetch: function (url, timeout) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout || 30000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  },

  load: function (silent) {
    var self = this;
    this._busy = true;
    if (!silent) { var el = document.getElementById('tc-body'); if (el) el.innerHTML = '<div class="tc-loading">常开雷达启动中——正在聚合全球恐怖情报流…</div>'; }
    Promise.all([this._fetch('/api/terror/overview'), this._fetch('/api/terror/orgs')])
      .then(function (rs) {
        if (rs[0] && rs[0].ok) self._ov = rs[0];
        if (rs[1] && rs[1].ok) self._orgs = rs[1];
        self._retryTimer && clearTimeout(self._retryTimer); self._retryTimer = null;
        self.renderBody();
      })
      .catch(function (e) {
        /* #684 根治：超时/网络瞬断不清屏——已有数据保留并提示；无数据才显示错误面板；均 15s 快重试 */
        var msg = (e && (e.name === 'AbortError' || /aborted/i.test(e && e.message || ''))) ? '请求超时' : ((e && e.message) || '网络异常');
        if (self._ov) {
          self.renderBody();
          var bar = document.getElementById('tc-stalebar');
          if (bar) bar.remove();
          var host = document.getElementById('tc-body');
          if (host) {
            var b = document.createElement('div');
            b.id = 'tc-stalebar';
            b.style.cssText = 'margin:6px 10px;padding:6px 10px;border-radius:6px;font-size:11px;color:#ffb84d;background:#ffb84d1a;border:1px solid #ffb84d55';
            b.textContent = '⚠ 刷新失败（' + msg + '）——已保留 ' + (self._lastStamp || '上次') + ' 数据，15 秒后自动重试';
            host.insertBefore(b, host.firstChild);
          }
        } else {
          var el2 = document.getElementById('tc-body');
          if (el2) el2.innerHTML = '<div class="tc-empty">数据加载失败（' + msg + '）<br>雷达将在 15 秒后自动重试</div>';
        }
        if (self._retryTimer) clearTimeout(self._retryTimer);
        self._retryTimer = setTimeout(function () { self.load(true); }, 15000);
      })
      .finally(function () { self._busy = false; });
  },

  renderShell: function () {
    var host = document.getElementById('terjudge-root');
    host.innerHTML =
      '<div class="tc-head">' +
        '<div><div class="tt">🛰️ 全球恐袭态势监测中心</div>' +
        '<div class="sub">常开雷达（always-on）：83 家威胁实体档案（恐怖组织/极端组织/武装力量/政治力量/犯罪组织；阿富汗塔利班等执政当局与国家武装力量已出榜）× 情报流自动碰撞 · 活跃度异动 · 红橙预警 · 涉华恐袭数据集（2010 年以来） · AI 智库研判 · 红头公文输出——数据 100% 来自平台数据库真实聚合，零采集触发、零模拟</div>' +
        '<div class="tc-live"><i></i><span id="tc-livestamp">雷达在线 · 待载入</span></div></div>' +
        '<div class="sp"></div>' +
        '<button class="tc-btn" id="tc-govbtn" onclick="TERRORCENTER.judge(\'global\')">🔴 生成《反恐态势通报》</button>' +
        '<button class="tc-btn ghost" onclick="TERRORCENTER.load()">手动刷新</button>' +
      '</div>' +
      '<div id="tc-body"></div>';
  },

  _lvColor: function (lv) {
    return lv === 'red' ? '#ff3355' : lv === 'orange' ? '#ff8800' : lv === 'yellow' ? '#eab308' : '#2563eb';
  },
  /* #681 组织分类徽章：恐怖组织/武装力量/执政当局/政治力量/犯罪组织 分色可视化 */
  _typeTag: function (t) {
    if (!t) return '';
    var c = { '恐怖组织': '#ff5f6d', '武装力量': '#ff8800', '执政当局': '#22d3ee', '政治力量': '#00e676', '犯罪组织': '#c084fc', '国家武装力量': '#3b82f6', '极端组织': '#ffcc00' }[t] || '#7a93ab';
    return '<span style="font-size:8.5px;border-radius:8px;padding:1px 5px;font-weight:700;flex-shrink:0;background:' + c + '1f;color:' + c + ';border:1px solid ' + c + '66" title="实体分类：' + this._esc(t) + '">' + this._esc(t) + '</span>';
  },
  _esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },

  renderBody: function () {
    var host = document.getElementById('tc-body');
    var ov = this._ov, og = this._orgs;
    if (!host) return;
    if (!ov) { host.innerHTML = '<div class="tc-empty">暂无数据</div>'; return; }
    var k = ov.kpi || {};
    var stamp = document.getElementById('tc-livestamp');
    if (stamp) stamp.textContent = '雷达在线 · 最近更新 ' + (ov.generatedAt || '') + ' · 60s 自刷';
    this._lastStamp = ov.generatedAt || '上次';
    host.innerHTML =
      /* ① KPI 带 */
      '<div class="tc-kpis">' +
        '<div class="tc-kpi today"><div class="v">' + (k.todayCount || 0) + '</div><div class="l">今日研判口径事件</div><div class="d">恐怖词元过滤后</div></div>' +
        '<div class="tc-kpi"><div class="v" style="color:#c9e2f5">' + (k.last7 || 0) + '</div><div class="l">近7日研判口径量</div><div class="d">环比 <b class="' + (k.wow > 0 ? 'tc-up' : 'tc-dn') + '">' + (k.wow > 0 ? '▲+' : '▼') + (k.wow || 0) + '%</b>（前7日 ' + (k.prev7 || 0) + '）</div></div>' +
        '<div class="tc-kpi red"><div class="v">' + (k.redOrange7 || 0) + '</div><div class="l">红橙级（7日）</div><div class="d">红 ' + (k.red7 || 0) + ' · 橙 ' + (k.orange7 || 0) + '</div></div>' +
        '<div class="tc-kpi hot"><div class="v">' + (k.topCountry ? this._esc(k.topCountry.country) : '—') + '</div><div class="l">高危国别（7日）</div><div class="d">' + (k.topCountry ? k.topCountry.n + ' 条居首' : '暂无') + '</div></div>' +
        '<div class="tc-kpi china"><div class="v">' + (k.chinaCount7 || 0) + '</div><div class="l">涉华关联（7日）</div><div class="d">isChinaRelatedStrict 严格判定</div></div>' +
      '</div>' +
      '<div class="tc-main">' +
        '<div>' +
          /* ② 组织活跃度雷达榜 */
          '<div class="tc-panel">' +
            '<div class="tc-sec">🎯 威胁实体活跃度雷达榜 <span class="mut">83家档案（执政当局/国家武装力量已出榜）× 近14天情报流碰撞 · 点击进组织档案研判</span></div>' +
            '<div id="tc-orglist">' + this._renderOrgList() + '</div>' +
          '</div>' +
          /* ④ 红橙预警面板 */
          '<div class="tc-panel">' +
            '<div class="tc-sec">🚨 红橙预警（近24小时） <span class="mut">' + (ov.alerts24 || []).length + ' 条</span></div>' +
            this._renderItems(ov.alerts24 || [], true) +
          '</div>' +
        '</div>' +
        '<div>' +
          /* ③ 态势区 */
          '<div class="tc-panel cyber">' +
            '<div class="tc-sec">📈 30 天日度态势带 <span class="mut">按级别堆叠 · 研判口径</span></div>' +
            this._renderTrend(ov.daily30 || []) +
          '</div>' +
          '<div class="tc-panel cyber">' +
            '<div class="tc-sec">🗺️ 国别热度 TOP12 <span class="mut">近7日研判口径</span></div>' +
            this._renderCountries(ov.countryTop || []) +
          '</div>' +
          '<div class="tc-panel cyber">' +
            '<div class="tc-sec">🔺 级别金字塔 <span class="mut">近7日研判口径构成</span></div>' +
            this._renderPyramid(ov.pyramid || {}) +
          '</div>' +
          /* ④ 最新情报流 */
          '<div class="tc-panel cyber">' +
            '<div class="tc-sec">📡 最新恐怖情报流 <span class="mut">研判口径 · 60s 自刷</span></div>' +
            this._renderItems(ov.latest || [], false) +
          '</div>' +
        '</div>' +
      '</div>' +
      /* #689 涉华恐袭数据集（独立插槽：loadChina 异步填充，主渲染先出） */
      '<div id="tc-china-slot">' + (this._chinaHtml || '<div class="tc-loading">涉华恐袭数据集聚合中——正在扫描 2010 年以来针对中国驻外机构·中资企业·中国公民的袭击记录…</div>') + '</div>' +
      /* ⑤ AI 智库研判（全球，随通报按钮生成后展示在此锚点） */
      '<div id="tc-judge-slot">' + this._judgeHtml + '</div>' +
      '<div class="tc-note">' + this._esc(ov.note || '') + (og && og.note ? ' ' + this._esc(og.note) : '') + '</div>';
  },

  /* ② 组织雷达榜：活跃置顶，静默组织折叠在后 */
  _renderOrgList: function () {
    var og = this._orgs;
    if (!og || !og.orgs) return '<div class="tc-loading">组织档案碰撞中…</div>';
    var orgs = og.orgs;
    var active = orgs.filter(function (o) { return o.events14 > 0; });
    var maxScore = active.length ? Math.max.apply(null, active.map(function (o) { return o.score7; }).concat([1])) : 1;
    var self = this, html = '';
    html += '<div style="display:flex;gap:10px;font-size:10.5px;color:#7aa5c9;margin-bottom:8px;flex-wrap:wrap">' +
      '<span>组织档案 <b style="color:#dff3ff">' + og.total + '</b> 家</span>' +
      '<span>近14日命中 <b style="color:#ff7b93">' + og.activeCount + '</b> 家</span>' +
      '<span>异动上升 <b style="color:#ff3355">' + og.surging + '</b> 家</span>' +
      '<span style="margin-left:auto;color:#5a7a99">活跃度指数=Σ级别权重（红4/橙3/黄2/蓝1）</span></div>';
    active.slice(0, 15).forEach(function (o, i) {
      var pct = Math.max(4, Math.round(o.score7 / maxScore * 100));
      var surge = o.score7 > 0 && o.deltaPct >= 50;
      var dl = o.scorePrev7 ? (o.deltaPct > 0 ? '<span class="tc-up">▲' + o.deltaPct + '%</span>' : o.deltaPct < 0 ? '<span class="tc-dn">▼' + Math.abs(o.deltaPct) + '%</span>' : '<span style="color:#5a7a99">—0%</span>')
             : (o.score7 ? '<span class="tc-up">新发</span>' : '<span style="color:#5a7a99">—</span>');
      html += '<div class="tc-org" onclick="TERRORCENTER.openOrg(\'' + self._esc(o.id) + '\')" title="' + self._esc(o.type || '威胁实体') + ' · 威胁等级 ' + o.threatLevel + '/10 · 档案趋势 ' + self._esc(o.threatTrend) + '">' +
        '<div class="rank">' + (i + 1) + '</div>' +
        '<div class="nm">' + self._esc(o.name) + (surge ? '<span class="tc-surge">异动</span>' : '') + '</div>' +
        self._typeTag(o.type) +
        '<div class="barwrap"><div class="bar" style="width:' + pct + '%"><i>' + o.score7 + '</i></div></div>' +
        '<div class="sc">' + o.score7 + '</div>' +
        '<div class="dl">' + dl + '</div>' +
        '<div class="ev">' + o.events7 + '/' + o.events14 + '条</div>' +
      '</div>';
    });
    if (!active.length) html += '<div class="tc-empty">近14日情报流与组织档案无碰撞命中<br>公开报道焦点为无署名零散袭击事件</div>';
    return html;
  },

  /* ③ 态势带（级别堆叠柱） */
  _renderTrend: function (daily) {
    var self = this;
    var max = Math.max.apply(null, daily.map(function (d) { return d.total; }).concat([1]));
    var html = '<div class="tc-trend">';
    daily.forEach(function (d) {
      var h = d.total ? Math.max(3, Math.round(d.total / max * 88)) : 2;
      var rh = d.total ? Math.round(d.red / d.total * h) : 0, oh = d.total ? Math.round(d.orange / d.total * h) : 0,
          yh = d.total ? Math.round(d.yellow / d.total * h) : 0, bh = Math.max(0, h - rh - oh - yh);
      html += '<div class="col" style="height:' + Math.max(h, 2) + 'px" title="' + d.day + '：' + d.total + ' 条（红' + d.red + ' 橙' + d.orange + ' 黄' + d.yellow + ' 蓝' + d.blue + '）">' +
        (rh ? '<b class="r" style="height:' + rh + 'px"></b>' : '') +
        (oh ? '<b class="o" style="height:' + oh + 'px"></b>' : '') +
        (yh ? '<b class="y" style="height:' + yh + 'px"></b>' : '') +
        (bh ? '<b class="bl" style="height:' + bh + 'px"></b>' : '') +
        (d.total >= max * 0.8 ? '<span class="tip">' + d.total + '</span>' : '') +
      '</div>';
    });
    html += '</div><div class="tc-trend-x">';
    daily.forEach(function (d, i) { if (i % 3 === 0 || i === daily.length - 1) html += '<b>' + d.day.slice(5) + '</b>'; else html += '<b></b>'; });
    return html + '</div>';
  },

  /* ③ 国别热度 */
  _renderCountries: function (tops) {
    if (!tops.length) return '<div class="tc-empty">近7日暂无国别统计</div>';
    var max = tops[0].n || 1, self = this, html = '';
    tops.forEach(function (c) {
      html += '<div class="tc-cbar"><div class="cn">' + self._esc(c.country) + '</div>' +
        '<div class="bw"><i style="width:' + Math.max(3, Math.round(c.n / max * 100)) + '%"></i></div>' +
        '<div class="nv">' + c.n + '</div></div>';
    });
    return html;
  },

  /* ③ 级别金字塔 */
  _renderPyramid: function (py) {
    var total = (py.red || 0) + (py.orange || 0) + (py.yellow || 0) + (py.blue || 0) || 1;
    var rows = [
      { k: 'red', n: py.red || 0, c: '#ff3355', l: '红级' },
      { k: 'orange', n: py.orange || 0, c: '#ff8800', l: '橙级' },
      { k: 'yellow', n: py.yellow || 0, c: '#eab308', l: '黄级' },
      { k: 'blue', n: py.blue || 0, c: '#2563eb', l: '蓝级' }
    ];
    var html = '<div class="tc-pyr">';
    rows.forEach(function (r, i) {
      var w = Math.max(14, Math.round(r.n / total * 100));
      html += '<div class="lv" style="width:' + Math.max(w, 18 + i * 12) + '%;background:' + r.c + '" title="' + r.l + ' ' + r.n + ' 条">' + r.l + ' ' + r.n + '</div>';
    });
    return html + '</div>';
  },

  /* ④ 事件条目列表 */
  _renderItems: function (items, showChinaOnly) {
    var self = this;
    if (!items.length) return '<div class="tc-empty">' + (showChinaOnly ? '近24小时无红橙级预警事件' : '暂无情报') + '</div>';
    return items.map(function (r) {
      return '<div class="tc-item">' +
        '<span class="tm">' + self._esc(String(r.time || '').slice(5, 16)) + '</span>' +
        '<span class="lv" style="background:' + self._lvColor(r.level) + '"></span>' +
        '<span class="tx"><em>' + self._esc(r.country || '未标注') + '</em>' + self._esc(r.title) +
          (r.china ? '<span class="cn-tag">涉华</span>' : '') +
          (r.url ? '<a href="' + self._esc(r.url) + '" target="_blank" rel="noopener">原文↗</a>' : '') +
        '</span>' +
      '</div>';
    }).join('');
  },

  /* ===== #689 涉华恐袭数据集 ===== */
  _post: function (url, body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  },

  loadChina: function (silent) {
    var self = this;
    this._fetch('/api/terror/china-dataset', 60000)
      .then(function (d) {
        if (d && d.ok) {
          self._cn = d;
          self._chinaHtml = self._renderChinaDS();
          var slot = document.getElementById('tc-china-slot');
          if (slot) slot.innerHTML = self._chinaHtml;
          /* #692：数据集有量后自动拉一次 30 天预测（服务端 30min 缓存，命中即秒回） */
          if (d.kpi && d.kpi.total > 0) {
            self.cnForecastAuto();
            self.cnBriefingAuto();   /* #698-② AI 大盘威胁研判自动装配 */
            /* 展开盒重放（60s 自刷不丢展开态） */
            if (self._drillCountry && d.countryEvents && d.countryEvents[self._drillCountry]) self._fillDrill(d.countryEvents[self._drillCountry]);
          }
        }
      })
      .catch(function () { /* 静默：主面板不受影响，60s 后随自刷重试 */ });
  },

  _renderChinaDS: function () {
    var cn = this._cn, self = this;
    if (!cn) return '<div class="tc-loading">涉华恐袭研判中心聚合中…</div>';
    var k = cn.kpi || {};
    var yrs = cn.byYear || [];
    var yrMax = Math.max.apply(null, yrs.map(function (y) { return y.n; }).concat([1]));
    var yrHtml = '<div class="tc-yr">';
    yrs.forEach(function (y) {
      var h = y.n ? Math.max(3, Math.round(y.n / yrMax * 72)) : 2;
      yrHtml += '<div class="col" style="height:' + h + 'px" title="' + y.year + ' 年：' + y.n + ' 条"><b style="height:' + h + 'px"></b></div>';
    });
    yrHtml += '</div><div class="tc-yr-x">';
    yrs.forEach(function (y) { yrHtml += '<b>' + String(y.year).slice(2) + '</b>'; });
    yrHtml += '</div>';
    var ctMax = (cn.byCountry && cn.byCountry.length) ? cn.byCountry[0].n : 1;
    var bf = (cn.collector && cn.collector.backfill) || {};
    var lr = (cn.collector && cn.collector.lastRun) || null;
    /* #692 预警强调：红 > 橙 > 其余，同级按时间倒序——预警置顶 + 卡片发光 */
    var evs = (cn.latest || []).slice().sort(function (a, b) {
      var w = function (x) { return x.level === 'red' ? 2 : x.level === 'orange' ? 1 : 0; };
      return (w(b) - w(a)) || String(b.time || '').localeCompare(String(a.time || ''));
    });
    var lvZh = { red: '红级', orange: '橙级', yellow: '黄级', blue: '蓝级' };
    var evHtml = evs.length ? '<div class="tc-evwrap">' + evs.map(function (e) {
      var cls = e.level === 'red' ? 'rd' : (e.level === 'orange' ? 'ro' : '');
      return '<div class="tc-evcard ' + cls + '" onclick="TERRORCENTER.openEvent(\'' + self._esc(e.id) + '\')" title="' + (lvZh[e.level] || e.level) + ' · 点击打开 AI 事件研判">' +
        '<div class="h"><span class="tm">' + self._esc(String(e.time || '').slice(5, 16)) + '</span>' +
          '<span class="cty">' + self._esc(e.country || '国际') + '</span>' +
          (e.level === 'red' || e.level === 'orange' ? '<span class="tc-warn">⚠ 预警</span>' : '') +
          '<span class="tc-tgtag">' + self._esc(e.target || '涉华目标') + '</span></div>' +
        '<div class="tt">' + self._esc(e.title) + '</div>' +
        '<div class="src"><span>来源 ' + self._esc(e.source || '—') + '</span>' +
          (e.url ? '<a href="' + self._esc(e.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">原文↗</a>' : '') +
          '<span style="margin-left:auto;color:#7aa5c9">点击 → AI 研判</span></div>' +
      '</div>';
    }).join('') + '</div>'
      : '<div class="tc-cn-empty">暂无合规涉华遇袭记录——实时雷达每 10 分钟一轮、历史回补自动推进中<br>#691 方向闸已上线：仅收录中国公民/中资/机构处于受袭侧的真实事件，零机翻垃圾、零模拟</div>';
    /* #698-② AI 大盘威胁研判区（_brHtml 缓存优先） */
    var brHtml = this._brHtml || '<div class="tc-br"><div class="h">🤖 AI 涉华恐袭威胁研判 <span class="badge">Kimi 大模型 · 真实统计装配</span><span class="sp"></span><button class="tc-btn ghost" onclick="TERRORCENTER.cnBriefing(this)">⚡ 生成威胁研判</button></div><div class="meta" style="margin-top:4px">打开即自动装配（服务端 30 分钟缓存）——威胁态势 / 目标手法 / 研判结论 / 防范建议四段公文研判。</div></div>';
    /* #692 AI 30 天预测区（_fcHtml 缓存优先，60s 自刷不丢内容） */
    var fcHtml = this._fcHtml || (((k.total || 0) > 0)
      ? '<div class="h">🔮 AI 未来 30 天态势预测 <span class="tc-badge rule">待生成</span></div>' +
        '<div style="font-size:11px;color:#9fc3e2;line-height:1.8;margin-bottom:8px">基于数据集真实统计（年度基线/国别分布/目标构成）+ Kimi 大模型前瞻研判；服务端 30 分钟缓存免重复生成。</div>' +
        '<div class="tc-flex"><button class="tc-btn ghost" onclick="TERRORCENTER.cnForecast(this)">🔮 生成未来 30 天态势预测</button></div>'
      : '<div class="h">🔮 AI 未来 30 天态势预测</div>' +
        '<div style="font-size:11px;color:#7a93ab;line-height:1.8">数据集回补完成前不生成预测（拒绝空库臆测）——待真实事件流入后即可生成。</div>');
    return '<div class="tc-panel tc-cn">' +
      '<div class="tc-sec">🇨🇳 涉华恐袭研判中心 <span class="mut">全球针对中国驻外机构 · 中资企业与项目 · 中国公民的遇袭威胁——AI 威胁研判 · 国别下钻 · 事件研判 · 30 天预测 · #691 方向闸：中方必须处于受袭侧 · 零模拟</span></div>' +
      /* #698-② AI 大盘威胁研判（研判中心开路卡） */
      '<div id="tc-br-box">' + brHtml + '</div>' +
      '<div class="tc-cn-kpis">' +
        '<div class="tc-kpi china"><div class="v">' + (k.total || 0) + '</div><div class="l">遇袭事件总量（条）</div><div class="d">库内涉华遇袭 ∪ 专项通道</div></div>' +
        '<div class="tc-kpi"><div class="v" style="color:#c9e2f5">' + (k.countries || 0) + '</div><div class="l">威胁国别</div><div class="d">重点：巴/阿/刚果金/尼日利亚/尼日尔</div></div>' +
        '<div class="tc-kpi today"><div class="v">' + (k.fresh30 || 0) + '</div><div class="l">近30日新增</div><div class="d">实时雷达 10 分钟一轮</div></div>' +
        '<div class="tc-kpi red"><div class="v">' + (k.redOrange72 || 0) + '</div><div class="l">72小时红橙</div><div class="d">重大涉华遇袭预警</div></div>' +
        '<div class="tc-kpi"><div class="v" style="color:#ff8800">' + (k.earliestYear && k.earliestYear < 2030 ? k.earliestYear : '—') + '</div><div class="l">最早记录年份</div><div class="d">全文库回扫补齐中</div></div>' +
      '</div>' +
      '<div class="tc-cn-grid">' +
        '<div>' +
          '<div style="font-size:11px;color:#7aa5c9;margin-bottom:6px">📅 年度分布（袭击次数）</div>' + yrHtml +
          '<div style="font-size:11px;color:#7aa5c9;margin:10px 0 6px">🗺️ 威胁国别 TOP10 <span style="color:#5a7a99">点击国别 → 就地展开该国遇袭明细</span></div>' +
          ((cn.byCountry || []).map(function (c) {
            return '<div class="tc-cbar click' + (self._drillCountry === c.country ? ' on' : '') + '" onclick="TERRORCENTER.cnCountryDrill(\'' + self._esc(c.country).replace(/'/g, "\\'") + '\')">' +
              '<div class="cn">' + self._esc(c.country) + '</div>' +
              '<div class="bw"><i style="width:' + Math.max(3, Math.round(c.n / ctMax * 100)) + '%"></i></div>' +
              '<div class="nv">' + c.n + '</div></div>';
          }).join('') || '<div class="tc-empty">暂无国别统计</div>') +
          '<div id="tc-cdrill"></div>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:#7aa5c9;margin-bottom:6px">🚨 最新涉华遇袭预警 <span style="color:#5a7a99">红橙预警置顶 · 点击事件卡 → AI 研判</span></div>' + evHtml +
        '</div>' +
      '</div>' +
      '<div class="tc-fc" id="tc-fc-box">' + fcHtml + '</div>' +
      '<div class="tc-cn-st">' +
        '<b>采集状态</b>（一句话）：实时雷达 10 分钟/轮（GDELT + GNews 定向双通道）' +
        (lr ? '；最近一轮入库 ' + (lr.inserted || 0) + ' 条' : '') + (bf.running ? '；历史回补进行中（游标 ' + self._esc(bf.cursor || '—') + '，已入库 ' + (bf.inserted || 0) + ' 条）' : '；历史回补未运行') +
        '。' +
        '<div class="tc-flex">' +
          '<button class="tc-btn ghost" onclick="TERRORCENTER.cnSweep(this)">▶ 手动采集一轮</button>' +
          '<button class="tc-btn ghost" onclick="TERRORCENTER.cnBackfillToggle(this)">' + (bf.running ? '⏸ 停止历史回补' : '⏩ 启动历史回补（2017 起）') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="tc-note">' + self._esc(cn.note || '') + '</div>' +
    '</div>';
  },

  /* ===== #698-② 国别下钻：点击威胁国别 → 就地展开该国遇袭明细 ===== */
  cnCountryDrill: function (country) {
    var cn = this._cn;
    if (this._drillCountry === country) { this._drillCountry = null; }
    else { this._drillCountry = country; }
    /* 重渲染（缓存 _cn 直接重画，不打接口） */
    this._chinaHtml = this._renderChinaDS();
    var slot = document.getElementById('tc-china-slot');
    if (slot) slot.innerHTML = this._chinaHtml;
    if (this._drillCountry && cn && cn.countryEvents) this._fillDrill(cn.countryEvents[this._drillCountry]);
  },
  _fillDrill: function (evs) {
    var box = document.getElementById('tc-cdrill');
    if (!box || !evs || !evs.length) return;
    var self = this;
    var lvColor = { red: '#ef4444', orange: '#f59e0b', yellow: '#facc15', blue: '#38bdf8' };
    var h = '<div class="tc-cdrill"><div class="dh">🞄 ' + this._esc(this._drillCountry) + ' · 遇袭明细（最新 ' + evs.length + ' 条 · 点击单条 → AI 事件研判）<span class="sp"></span></div>';
    evs.forEach(function (e) {
      h += '<div class="tc-cdev" onclick="TERRORCENTER.openEvent(\'' + self._esc(e.id) + '\')">' +
        '<span class="lv" style="background:' + (lvColor[e.level] || '#facc15') + '"></span>' +
        '<span style="flex:1;min-width:0">' + self._esc(e.title) + '</span>' +
        '<span class="tm">' + self._esc(String(e.time || '').slice(0, 10)) + '</span></div>';
    });
    h += '</div>';
    box.innerHTML = h;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  /* ===== #698-② AI 涉华恐袭威胁大盘研判 ===== */
  cnBriefing: function (btn) {
    var self = this;
    var box = document.getElementById('tc-br-box');
    if (btn) {
      btn.disabled = true; btn.textContent = '⏳ 研判中…';
    }
    if (box) box.innerHTML = '<div class="tc-br"><div class="h">🤖 AI 涉华恐袭威胁研判 <span class="badge">Kimi 大模型</span></div><div style="font-size:11.5px;color:#9fc3e2;line-height:1.9">威胁研判生成中（真实统计装配，约 20-40 秒）…</div></div>';
    this._fetch('/api/terror/china-briefing' + (btn ? '?refresh=1' : ''), 300000)
      .then(function (d) {
        var html = self._brRender(d);
        self._brHtml = html;
        var b2 = document.getElementById('tc-br-box') || box;
        if (b2) b2.innerHTML = html;
      })
      .catch(function (e) {
        var b2 = document.getElementById('tc-br-box') || box;
        if (b2) b2.innerHTML = '<div class="tc-br"><div class="h">🤖 AI 涉华恐袭威胁研判</div><div style="font-size:11px;color:#ff8fa3">研判请求失败（' + self._esc(e && e.message || '网络异常') + '），请重试</div></div>';
      });
  },
  _brRender: function (d) {
    var self = this;
    if (!d || !d.ok) return '<div class="tc-br"><div class="h">🤖 AI 涉华恐袭威胁研判</div><div style="font-size:11px;color:#ff8fa3">研判失败：' + this._esc((d && d.error) || '未知错误') + '</div></div>';
    if (d.empty) return '<div class="tc-br"><div class="h">🤖 AI 涉华恐袭威胁研判</div><div style="font-size:11px;color:#7a93ab;line-height:1.9">' + this._esc(d.note || '') + '</div></div>';
    var paras = String(d.briefing || '').split('\n').filter(function (p) { return p.trim(); });
    var st = d.stats || {};
    return '<div class="tc-br">' +
      '<div class="h">🤖 AI 涉华恐袭威胁研判 <span class="tc-badge ' + (d.llmOk ? 'llm">Kimi 大模型' : 'rule">规则模板') + '</span>' +
      '<span style="font-size:10px;color:#7aa5c9;font-weight:400">生成于 ' + this._esc(d.generatedAt || '') + (d.cached ? ' · 30min缓存' : '') + '</span><span class="sp"></span>' +
      '<button class="tc-btn ghost" onclick="TERRORCENTER.cnBriefing(this)">⚡ 重新研判</button></div>' +
      '<div style="font-size:10.5px;color:#7aa5c9;margin-bottom:7px">基线：遇袭事件 <b style="color:#ffe4e9">' + (st.total || 0) + '</b> 条 · 威胁国别 <b style="color:#ffe4e9">' + (st.countries || 0) + '</b> 国 · 近30日 <b style="color:#ffe4e9">' + (st.fresh30 || 0) + '</b> 条 · 72h红橙 <b style="color:#ff5f6d">' + (st.alerts72 || 0) + '</b> 条</div>' +
      paras.map(function (p) { return '<p>' + self._esc(p) + '</p>'; }).join('') +
      '<div class="meta">' + this._esc(d.note || '') + '</div>' +
      '</div>';
  },
  cnBriefingAuto: function () {
    if (this._brTried) return;
    this._brTried = true;
    this.cnBriefing(null);
  },

  /* ===== #692 事件卡交互：点击 → 事件抽屉 + AI 研判 ===== */
  openEvent: function (id) {
    var cn = this._cn, ev = null;
    (cn && cn.latest ? cn.latest : []).forEach(function (e) { if (String(e.id) === String(id)) ev = e; });
    if (!ev) return;
    var self = this;
    var old = document.getElementById('tc-drawer'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'tc-drawer'; d.className = 'tc-drawer';
    var lvZh = { red: '红（重大）', orange: '橙（严重）', yellow: '黄（关注）', blue: '蓝（一般）' }[ev.level] || ev.level;
    d.innerHTML = '<div class="tc-dbox">' +
      '<div class="tc-dhead"><h3>涉华遇袭事件 · AI 研判</h3><button class="tc-dclose" onclick="TERRORCENTER.closeDrawer()">关闭 ✕</button></div>' +
      '<div class="tc-dmeta">' +
        '<span>国别 <b>' + this._esc(ev.country || '未标注') + '</b></span>' +
        '<span>级别 <b style="color:' + this._lvColor(ev.level) + '">' + lvZh + '</b></span>' +
        '<span>目标类型 <b>' + this._esc(ev.target || '涉华目标') + '</b></span>' +
        '<span>时间 <b>' + this._esc(String(ev.time || '').slice(0, 16)) + '</b></span>' +
        '<span>来源 <b>' + this._esc(ev.source || '—') + '</b></span>' +
      '</div>' +
      '<div class="tc-alias" style="font-size:12px;color:#dff3ff;line-height:1.8">' + this._esc(ev.title) +
        (ev.url ? ' &nbsp;<a href="' + this._esc(ev.url) + '" target="_blank" rel="noopener" style="color:#22d3ee;font-size:11px">原文↗</a>' : '') + '</div>' +
      '<div class="tc-flex"><button class="tc-btn" onclick="TERRORCENTER.cnJudgeEvent(this,' + Number(ev.id) + ')">🤖 AI 事件研判（Kimi 大模型）</button></div>' +
      '<div id="tc-evjudge"></div>' +
      '<div class="tc-note">口径：事件出自涉华恐袭数据集（#691 方向闸校验——中国公民/中资/机构处于受袭侧）；研判上下文=事件原文+同国别近90日真实库情报，零模拟。</div>' +
    '</div>';
    d.addEventListener('click', function (e) { if (e.target === d) self.closeDrawer(); });
    document.body.appendChild(d);
  },

  cnJudgeEvent: function (btn, id) {
    var self = this, slot = document.getElementById('tc-evjudge');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 研判生成中…'; }
    if (slot) slot.innerHTML = '<div class="tc-loading">AI 事件研判生成中（Kimi 大模型 + 真实库数据装配，约 20-40 秒）…</div>';
    this._fetch('/api/terror/china-judge?id=' + encodeURIComponent(id), 300000)
      .then(function (d) {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 重新生成 AI 事件研判'; }
        if (!d || !d.ok) { if (slot) slot.innerHTML = '<div class="tc-empty">研判失败：' + self._esc((d && d.error) || '未知错误') + '</div>'; return; }
        var paras = String(d.judgment || '').split('\n').filter(function (p) { return p.trim(); });
        var cty = (d.event && d.event.country) || '';
        var rel = (d.related || []).slice(0, 6).map(function (x) {
          return '<div class="tc-item"><span class="lv" style="background:' + self._lvColor(x.level) + '"></span>' +
            '<span class="tx"><em>' + self._esc(cty) + '</em>' + self._esc(x.title) + '</span></div>';
        }).join('');
        slot = document.getElementById('tc-evjudge') || slot;
        if (slot) slot.innerHTML =
          '<div class="tc-sec" style="margin-top:10px">🤖 AI 事件研判 <span class="tc-badge ' + (d.llmOk ? 'llm">Kimi 大模型' : 'rule">规则模板') + '</span>' +
            '<span class="mut">生成于 ' + self._esc(d.generatedAt || '') + '</span></div>' +
          '<div class="tc-judge">' + paras.map(function (p) { return '<p>' + self._esc(p) + '</p>'; }).join('') + '</div>' +
          (rel ? '<div class="tc-sec" style="margin-top:8px">🧾 同国别近90日关联情报</div>' + rel : '') +
          '<div class="tc-note">' + self._esc(d.note || '') + '</div>';
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 重新生成 AI 事件研判'; }
        var s2 = document.getElementById('tc-evjudge') || slot;
        if (s2) s2.innerHTML = '<div class="tc-empty">研判请求失败（' + self._esc(e && e.message || '网络异常') + '），请重试</div>';
      });
  },

  /* ===== #692 AI 未来 30 天态势预测 ===== */
  _fcRender: function (d) {
    var self = this;
    if (!d || !d.ok) return '<div class="tc-empty">预测生成失败：' + this._esc((d && d.error) || '未知错误') + '</div>';
    if (d.empty) return '<div class="h">🔮 AI 未来 30 天态势预测</div><div style="font-size:11px;color:#7a93ab;line-height:1.9">' + this._esc(d.note || '') + '</div>';
    var paras = String(d.forecast || '').split('\n').filter(function (p) { return p.trim(); });
    var st = d.stats || {};
    return '<div class="h">🔮 AI 未来 30 天态势预测 <span class="tc-badge ' + (d.llmOk ? 'llm">Kimi 大模型' : 'rule">规则模板') + '</span>' +
      '<span class="mut" style="font-size:10px;color:#7a93ab">生成于 ' + this._esc(d.generatedAt || '') + (d.cached ? ' · 缓存' : '') + '</span></div>' +
      '<div style="font-size:10.5px;color:#7aa5c9;margin-bottom:8px">基线：累计 <b style="color:#ffe4e9">' + (st.total || 0) + '</b> 条 · 覆盖 <b style="color:#ffe4e9">' + (st.countries || 0) + '</b> 国 · 近30日 <b style="color:#ffe4e9">' + (st.fresh30 || 0) + '</b> 条 · 月均基线 <b style="color:#ffe4e9">' + (st.monthlyAvg || 0) + '</b> 条/月</div>' +
      '<div class="tc-judge">' + paras.map(function (p) { return '<p>' + self._esc(p) + '</p>'; }).join('') + '</div>' +
      '<div class="tc-flex"><button class="tc-btn ghost" onclick="TERRORCENTER.cnForecast(this)">♻ 强制重新生成</button></div>' +
      '<div class="tc-note">' + this._esc(d.note || '') + '</div>';
  },

  cnForecast: function (btn) {
    var self = this;
    var box = document.getElementById('tc-fc-box');
    if (btn) {
      btn.disabled = true; btn.textContent = '⏳ 预测生成中…';
      if (box) box.innerHTML = '<div class="tc-loading">🔮 AI 未来 30 天态势预测生成中（Kimi 大模型 + 数据集真实统计装配，约 20-40 秒）…</div>';
    }
    this._fetch('/api/terror/china-forecast' + (btn ? '?refresh=1' : ''), 300000)
      .then(function (d) {
        var html = self._fcRender(d);
        self._fcHtml = html;
        var b2 = document.getElementById('tc-fc-box') || box;
        if (b2) b2.innerHTML = html;
      })
      .catch(function (e) {
        var b2 = document.getElementById('tc-fc-box') || box;
        if (b2) b2.innerHTML = '<div class="tc-empty">预测请求失败（' + self._esc(e && e.message || '网络异常') + '），请重试</div>';
      });
  },

  cnForecastAuto: function () {
    if (this._fcTried) return;
    this._fcTried = true;   /* 每次会话只自动拉一次（服务端 30min 缓存命中即秒回） */
    this.cnForecast(null);
  },

  cnSweep: function (btn) {
    var self = this;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 采集中…'; }
    this._post('/api/terror/china-sweep', {})
      .then(function (d) {
        if (!d || !d.ok) { alert((d && d.error) || '触发失败'); if (btn) { btn.disabled = false; btn.textContent = '▶ 手动采集一轮'; } return; }
        /* 后台跑 2-4 分钟，2 分钟后自动刷新数据集 */
        setTimeout(function () { self.loadChina(true); }, 120000);
        setTimeout(function () { self.loadChina(true); }, 240000);
        if (btn) { btn.disabled = false; btn.textContent = '✅ 已触发，2 分钟后自动刷新'; setTimeout(function () { if (btn) { btn.textContent = '▶ 手动采集一轮'; } }, 6000); }
      })
      .catch(function (e) { alert('请求失败：' + (e && e.message || e)); if (btn) { btn.disabled = false; btn.textContent = '▶ 手动采集一轮'; } });
  },

  cnBackfillToggle: function (btn) {
    var self = this, cn = this._cn || {};
    var running = cn.collector && cn.collector.backfill && cn.collector.backfill.running;
    var body = running ? { action: 'stop' } : { start: '20170101' };
    if (btn) { btn.disabled = true; }
    this._post('/api/terror/china-backfill', body)
      .then(function (d) {
        if (!d || !d.ok) { alert((d && d.error) || '操作失败'); if (btn) btn.disabled = false; return; }
        self.loadChina(true);
        setTimeout(function () { self.loadChina(true); }, 20000);
      })
      .catch(function (e) { alert('请求失败：' + (e && e.message || e)); if (btn) btn.disabled = false; });
  },

  /* ② 组织档案抽屉：画像 + 碰撞事件 + 专项研判入口 */
  openOrg: function (id) {
    var og = this._orgs;
    if (!og || !og.orgs) return;
    var o = og.orgs.find(function (x) { return x.id === id; });
    if (!o) return;
    var self = this;
    var old = document.getElementById('tc-drawer'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'tc-drawer'; d.className = 'tc-drawer';
    var evHtml = (o.sample && o.sample.length)
      ? o.sample.map(function (s) {
          return '<div class="tc-item">' +
            '<span class="tm">' + self._esc(String(s.time || '').slice(5, 16)) + '</span>' +
            '<span class="lv" style="background:' + self._lvColor(s.level) + '"></span>' +
            '<span class="tx"><em>' + self._esc(s.country || '未标注') + '</em>' + self._esc(s.title) +
              (s.url ? '<a href="' + self._esc(s.url) + '" target="_blank" rel="noopener">原文↗</a>' : '') +
            '</span></div>';
        }).join('')
      : '<div class="tc-empty">近14日研判口径情报流无碰撞命中（组织处于静默期）</div>';
    d.innerHTML = '<div class="tc-dbox">' +
      '<div class="tc-dhead"><h3>' + this._esc(o.name) + ' · 组织档案研判</h3>' +
        '<button class="tc-dclose" onclick="TERRORCENTER.closeDrawer()">关闭 ✕</button></div>' +
      '<div class="tc-dmeta">' +
        '<span>类型 <b>' + this._esc(o.type || '—') + '</b></span>' +
        '<span>类别 <b>' + this._esc(o.category || '—') + '</b></span>' +
        '<span>威胁等级 <b style="color:#ff3355">' + (o.threatLevel != null ? o.threatLevel : '—') + '/10</b></span>' +
        '<span>档案趋势 <b>' + this._esc(o.threatTrend || '—') + '</b></span>' +
        '<span>头目 <b>' + this._esc(o.leader || '不详') + '</b></span>' +
      '</div>' +
      '<div class="tc-alias">别名：' + this._esc((o.aliases || []).join(' / ') || '—') + '<br>档案活动区域：' + this._esc((o.operatingRegions || []).join('、') || '不详') + '<br>近期活动地域（库内命中）：' + this._esc((o.activeCountries || []).join('、') || '无命中') + (o.confirmedRegions && o.confirmedRegions.length ? '（其中 ' + this._esc(o.confirmedRegions.join('、')) + ' 获事件印证）' : '') + '</div>' +
      '<div class="tc-sec">近期活跃度 <span class="mut">近7日指数 ' + o.score7 + ' · 前7日 ' + o.scorePrev7 + ' · 环比 ' + (o.deltaPct > 0 ? '+' : '') + o.deltaPct + '% · 近14日命中 ' + o.events14 + ' 条（红橙 ' + o.redOrange7 + '）</span></div>' +
      '<div class="tc-sec" style="margin-top:8px">🧾 碰撞事件代表（近14日）</div>' + evHtml +
      '<div class="tc-flex">' +
        '<button class="tc-btn" onclick="TERRORCENTER.judge(\'org\',\'' + this._esc(o.id) + '\')">🔴 生成《' + this._esc(o.name) + '研判专报》</button>' +
      '</div>' +
      '<div id="tc-drawer-judge"></div>' +
      '<div class="tc-note">口径：组织名称与别名 × 近14天研判口径情报流标题自动碰撞；地域印证=命中事件国别与档案活动区域比对。平台数据库真实数据，零模拟。</div>' +
    '</div>';
    d.addEventListener('click', function (e) { if (e.target === d) self.closeDrawer(); });
    document.body.appendChild(d);
  },
  closeDrawer: function () {
    var d = document.getElementById('tc-drawer'); if (d) d.remove();
  },

  /* ⑤ AI 智库研判：scope=global|org；成功后内联展示研判段 + 新窗红头公文 */
  judge: function (scope, orgId) {
    if (this._busy) return;
    this._busy = true;
    var self = this;
    var slotId = scope === 'org' ? 'tc-drawer-judge' : 'tc-judge-slot';
    var slot = document.getElementById(slotId);
    var btns = document.querySelectorAll('.tc-btn');
    btns.forEach && btns.forEach(function (b) { b.disabled = true; });
    if (slot) slot.innerHTML = '<div class="tc-loading">AI 智库研判生成中（Kimi 大模型 + 真实库统计装配）…</div>';
    /* 点击手势内同步打开新窗（异步回调里 window.open 会被弹窗拦截），先给占位页 */
    var govWin = null;
    try {
      govWin = window.open('', '_blank', 'width=980,height=1300');
      if (govWin && govWin.document) {
        govWin.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>公文生成中</title></head><body style="font-family:SimSun,serif;padding:60px;color:#333">《' + (scope === 'org' ? '组织动态研判专报' : '反恐态势通报') + '》生成中，请稍候…（AI 研判 + 红头版式装配约 20-40 秒）</body></html>');
        govWin.document.close();
      }
    } catch (e) { govWin = null; }
    this._fetch('/api/terror/judge?scope=' + encodeURIComponent(scope) + (orgId ? '&id=' + encodeURIComponent(orgId) : ''), 300000)
      .then(function (d) {
        self._busy = false;
        btns.forEach && btns.forEach(function (b) { b.disabled = false; });
        if (!d || !d.ok) { if (slot) slot.innerHTML = '<div class="tc-empty">研判失败：' + self._esc(d && d.error || '未知错误') + '</div>'; return; }
        var paras = String(d.judgment || '').split('\n').filter(function (p) { return p.trim(); });
        var html = '<div class="tc-panel" style="border-color:rgba(124,58,237,.4);margin-top:10px">' +
          '<div class="tc-sec">🤖 AI 智库研判 <span class="tc-badge ' + (d.llmOk ? 'llm">Kimi 大模型' : 'rule">规则模板') + '</span>' +
          '<span class="mut">生成于 ' + self._esc(d.generatedAt || '') + '</span></div>' +
          '<div class="tc-judge">' + paras.map(function (p) { return '<p>' + self._esc(p) + '</p>'; }).join('') + '</div>' +
          '<div class="tc-flex"><button class="tc-btn" onclick="TERRORCENTER.openGov()">📄 打开红头公文</button></div>' +
          '<div class="tc-note">' + self._esc(d.note || '') + '</div></div>';
        self._govHtml = d.govHtml || '';
        self._govTitle = scope === 'org' ? '组织动态研判专报' : '反恐态势通报';
        if (scope === 'global') self._judgeHtml = html;
        /* 落笔前重查插槽（60s 自刷会重渲染插槽，旧引用已脱离 DOM） */
        slot = document.getElementById(slotId) || slot;
        if (slot) slot.innerHTML = html;
        if (self._govHtml) self.openGov(govWin);
      })
      .catch(function (e) {
        self._busy = false;
        btns.forEach && btns.forEach(function (b) { b.disabled = false; });
        if (slot) slot.innerHTML = '<div class="tc-empty">研判请求失败（' + self._esc(e && e.message || '网络异常') + '），请重试</div>';
      });
  },

  /* 红头公文新窗输出（优先复用点击时已开的窗口；govHtml 内嵌 script 由前端剥离） */
  openGov: function (w) {
    if (!this._govHtml) { alert('请先生成研判通报'); return; }
    var win = w || window.open('', '_blank', 'width=980,height=1300');
    if (!win) { alert('浏览器拦截了新窗口，请允许弹窗后点击"打开红头公文"重试'); return; }
    var html = String(this._govHtml).replace(/<script[\s\S]*?<\/script>/gi, '');
    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + this._govTitle + '</title></head><body style="margin:0;background:#fff">' + html + '</body></html>');
    win.document.close();
  }
};
