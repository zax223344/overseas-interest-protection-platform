/* ============================================================
 * govdoc.js — 五大功能视图公文输出（#569/#575/#574）
 * 风险预测模型 →《风险预测模型专报》(ORPS-MX)
 * 智能协同作业台 →《情报会商纪要》(ORPS-HS)
 * 专项情报作战室 →《威胁通报》(ORPS-XW)
 * 重点目标监测 →《重点目标动态通报》(ORPS-JD)
 * 指挥调度中心 →《指挥调度指令》(ORPS-ZD)
 * 数据流：五视图实时状态 → govPayload() 装配 → POST /api/llm/govdoc
 * （Kimi/Spark 双通道 + 本地降级引擎）→ 红头公文模态框（复制/导出 Word）。
 * ============================================================ */
'use strict';
var GOVDOC = {

  META: {
    models:     { title: '风险预测模型专报',   prefix: 'ORPS-MX', issuer: '海外利益保护情报预警平台风险预测模型中心', ready: '模型中心' },
    workbench:  { title: '情报会商纪要',       prefix: 'ORPS-HS', issuer: '海外利益保护情报预警平台智能协同作业台', ready: '协同作业台' },
    threatroom: { title: '威胁通报',           prefix: 'ORPS-XW', issuer: '海外利益保护情报预警平台专项情报作战室', ready: '作战室' },
    myfocus:    { title: '重点目标动态通报',   prefix: 'ORPS-JD', issuer: '海外利益保护情报预警平台重点目标监测岗', ready: '重点目标监测', emptyMsg: '请先在「重点目标监测」中添加国家 / 项目 / 企业订阅，再输出《重点目标动态通报》' },
    command:    { title: '指挥调度指令',       prefix: 'ORPS-ZD', issuer: '海外利益保护情报预警平台指挥调度中心', ready: '指挥调度中心' }
  },

  _busy: {},   /* view → 生成中 */
  _last: {},   /* view → {payload, text, model, degraded, no} */

  _toast: function (m) { if (typeof showToast === 'function') showToast(m); else alert(m); },

  _esc: function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /* ═══════════ 文号：ORPS-XX〔2026〕N号（localStorage 逐号递增，同一公文重新生成不跳号） ═══════════ */
  _docNo: function (view, reuse) {
    var m = this.META[view];
    if (reuse && this._last[view] && this._last[view].no) return this._last[view].no;
    var y = new Date().getFullYear();
    var key = 'orps_govdoc_seq_' + m.prefix + '_' + y;
    var n = 1;
    try { n = (parseInt(localStorage.getItem(key), 10) || 0) + 1; localStorage.setItem(key, String(n)); } catch (e) {}
    var no = m.prefix + '〔' + y + '〕' + n + '号';
    if (this._last[view]) this._last[view].no = no;
    return no;
  },

  /* ═══════════ 入口：open(view) —— 两步流程：先素材选择，再生成（#583 参考每日简报交互） ═══════════ */
  open: function (view) {
    var me = this;
    var m = this.META[view];
    if (!m) return;
    if (this._busy[view]) { this._toast('公文生成中，请稍候…'); return; }
    var p = null;
    try { p = this._payload(view); } catch (e) { this._toast('数据装配失败：' + e.message); return; }
    if (p && typeof p.then === 'function') {
      /* models 视图：异步拉取底数 */
      p.then(function (pp) {
        if (!pp) { me._toast('模型中心数据暂未就绪，请稍后重试'); return; }
        me._selectItems(view, pp);
      }, function () { me._toast('模型中心数据获取失败，请稍后重试'); });
    } else {
      if (!p) { this._toast(m.emptyMsg || (m.ready + '数据暂未就绪，请稍后重试')); return; }
      this._selectItems(view, p);
    }
  },

  /* ═══════════ #583 素材选择器：参考每日简报 checkbox 机制，用户勾选进公文的事件 ═══════════
   * 各视图清单字段映射：threatroom→topItems、myfocus→matched、command→incidents、
   * models→alerts、workbench→anomalies+watch+threatProjects（多组合一） */
  _SEL_MAP: {
    threatroom: [{ key: 'topItems', label: '代表性事件', lv: true }],
    myfocus: [{ key: 'matched', label: '命中预警', lv: true }],
    command: [{ key: 'incidents', label: '在案事件', lv: false }],
    models: [{ key: 'alerts', label: '模型异动信号', lv: true }],
    workbench: [{ key: 'threatProjects', label: '受威胁项目', lv: false }, { key: 'anomalies', label: '异动国家', lv: false }]
  },

  _selectItems: function (view, payload) {
    var me = this, m = this.META[view];
    var groups = this._SEL_MAP[view] || [];
    /* 收集清单条目（无清单的视图直接生成） */
    var lists = [], total = 0;
    groups.forEach(function (g) {
      var arr = (payload[g.key] || []);
      if (arr.length) { lists.push({ key: g.key, label: g.label, lv: g.lv, items: arr }); total += arr.length; }
    });
    if (!total) { this._launch(view, payload); return; }   /* 纯统计型视图无素材可选，直接生成 */
    /* 模态框 */
    var old = document.getElementById('govdoc-sel');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'govdoc-sel';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);z-index:1190;display:flex;align-items:center;justify-content:center;padding:24px';
    document.body.appendChild(ov);
    var lvTag = function (lv) {
      var c = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', blue: '#3b82f6' }[lv] || '#5a6a80';
      var t = { red: '红', orange: '橙', yellow: '黄', blue: '蓝' }[lv] || (lv || '');
      return '<span style="display:inline-block;min-width:20px;text-align:center;font-size:10px;padding:0 4px;border-radius:3px;border:1px solid ' + c + ';color:' + c + ';margin-right:6px">' + t + '</span>';
    };
    var html = '<div style="background:var(--panel,#0d1420);border:1px solid var(--border2,#1e2a40);border-radius:12px;width:100%;max-width:760px;max-height:88vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border,#16202f)">' +
        '<span style="font-size:14px;font-weight:700;color:var(--cyan,#00d4ff)">📋 选择纳入《' + this._esc(m.title) + '》的素材</span>' +
        '<span style="font-size:11px;color:var(--text3,#5a6a80)" id="gs-count"></span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn sm" id="gs-all" style="font-size:11px;padding:3px 10px">全选</button>' +
        '<button class="btn sm" id="gs-none" style="font-size:11px;padding:3px 10px">清空</button>' +
        '<button class="btn primary sm" id="gs-go" style="font-size:12px;padding:4px 16px">生成公文 →</button>' +
        '<button class="btn sm" id="gs-cancel" style="font-size:11px;padding:3px 10px">取消</button>' +
      '</div>' +
      '<div style="overflow-y:auto;padding:10px 16px;flex:1">';
    lists.forEach(function (L, gi) {
      html += '<div style="font-size:12px;font-weight:700;color:var(--text2,#8fa3bf);margin:10px 0 6px">▸ ' + me._esc(L.label) + '（' + L.items.length + '）</div>';
      L.items.forEach(function (it, ii) {
        var id = 'gs-' + gi + '-' + ii;
        var meta = (it.country ? it.country + ' · ' : '') + String(it.time || '').slice(5, 16);
        html += '<label style="display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;line-height:1.5;color:var(--text,#d7e3f4)" onmouseover="this.style.background=\'rgba(0,212,255,.06)\'" onmouseout="this.style.background=\'\'">' +
          '<input type="checkbox" id="' + id + '" data-g="' + gi + '" data-i="' + ii + '" checked style="margin-top:3px;cursor:pointer">' +
          '<span>' + (L.lv ? lvTag(it.level) : '') + (meta ? '<span style="color:var(--text3,#5a6a80);font-size:10px;margin-right:6px">' + me._esc(meta) + '</span>' : '') + me._esc(String(it.title || it.proj || it.country || '').slice(0, 80)) + '</span>' +
        '</label>';
      });
    });
    html += '</div></div>';
    ov.innerHTML = html;
    var upd = function () {
      var n = ov.querySelectorAll('input[type=checkbox]:checked').length;
      document.getElementById('gs-count').textContent = '已选 ' + n + ' / ' + total + ' 条（未选中的不进入公文）';
    };
    upd();
    ov.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.addEventListener('change', upd); });
    document.getElementById('gs-all').onclick = function () { ov.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = true; }); upd(); };
    document.getElementById('gs-none').onclick = function () { ov.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; }); upd(); };
    document.getElementById('gs-cancel').onclick = function () { ov.remove(); };
    document.getElementById('gs-go').onclick = function () {
      /* 把未选中的条目从 payload 对应清单剔除 */
      ov.querySelectorAll('input[type=checkbox]').forEach(function (c) {
        if (c.checked) return;
        var L = lists[+c.getAttribute('data-g')], it = L.items[+c.getAttribute('data-i')];
        var arr = payload[L.key] || [];
        var ix = arr.indexOf(it);
        if (ix >= 0) arr.splice(ix, 1);
      });
      ov.remove();
      me._launch(view, payload);
    };
  },

  _launch: function (view, payload) {
    this._last[view] = { payload: payload, no: this._docNo(view, false) };
    this._modal(view, null);
    this._gen(view, false);
  },

  /* ═══════════ 生成 / 重新生成 ═══════════ */
  _gen: function (view, refresh) {
    var me = this;
    var st = this._last[view];
    if (!st || !st.payload) return;
    this._busy[view] = true;
    this._modal(view, null);   /* 置 loading 态 */
    /* 认证：Bearer 头 + P1-4 签名头（govdoc 端点挂 authMiddleware + _signCheck，
     * 裸 fetch 只带 Bearer 必 401「请求缺少签名头」——2026-09-04 用户报障根因。
     * 统一走 APIClient._fetch：自动注入 x-sign-ts/x-sign-nonce/x-sign（HMAC 防重放）。 */
    var body = { view: view, payload: st.payload, refresh: !!refresh };
    var useClient = (typeof APIClient !== 'undefined' && APIClient._fetch);
    var req = useClient
      ? APIClient._fetch('POST', '/api/llm/govdoc', body)
      : fetch('/api/llm/govdoc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('orps_api_token') || '') },
          body: JSON.stringify(body)
        }).then(function (r) { return r.json().then(function (j) {
          if (!r.ok) { var er = new Error(j.error || ('HTTP ' + r.status)); er.status = r.status; throw er; }
          return j;
        }); });
    req.then(function (j) {
      me._busy[view] = false;
      if (!j || !j.ok) { me._modal(view, { error: (j && j.error) || '生成失败' }); return; }
      st.text = j.text; st.model = j.model; st.degraded = !!j.degraded;
      me._modal(view, { text: j.text, model: j.model, degraded: !!j.degraded, cached: !!j.cached });
    }).catch(function (e) {
      me._busy[view] = false;
      var msg = e.message || '网络错误';
      /* 签名头缺失 = 会话签名密钥不在本地（旧登录态/密钥未下发），引导重新登录 */
      if (/缺少签名头|签名校验失败|签名时间戳/.test(msg)) msg += '（请退出登录后重新登录，以获取新的会话签名密钥）';
      me._modal(view, { error: msg });
    });
  },

  /* ═══════════ 红头公文模态框 ═══════════ */
  _modal: function (view, r) {
    var me = this, m = this.META[view], st = this._last[view] || {};
    var old = document.getElementById('govdoc-modal');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'govdoc-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(4px);z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.addEventListener('click', function (e) { if (e.target === ov) me.close(); });
    document.body.appendChild(ov);

    var no = st.no || '';
    var loading = !r, failed = r && r.error;
    var html = '<div style="background:var(--panel,#0d1420);border:1px solid var(--border2,#1e2a40);border-radius:12px;width:100%;max-width:820px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 0 60px rgba(0,212,255,.12)">' +
      /* 工具条 */
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border,#16202f)">' +
        '<span style="font-size:13px;font-weight:700;color:var(--cyan,#00d4ff)">📄 ' + this._esc(m.title) + '</span>' +
        '<span style="font-size:10px;color:var(--text3,#5a6a80)">' + this._esc(no) + '</span>' +
        (r && !failed ? (r.degraded
          ? '<span style="font-size:9px;padding:1px 7px;border-radius:8px;border:1px solid var(--yellow,#eab308);color:var(--yellow,#eab308)">本地规则引擎</span>'
          : '<span style="font-size:9px;padding:1px 7px;border-radius:8px;border:1px solid var(--green,#22c55e);color:var(--green,#22c55e)">' + this._esc(r.model || 'AI') + (r.cached ? ' · 缓存' : '') + '</span>') : '') +
        '<span style="flex:1"></span>' +
        (r && !failed ? '<button class="btn sm" style="font-size:11px;padding:3px 10px" id="gd-edit">✏️ 编辑</button>' : '') +
        '<button class="btn sm" style="font-size:11px;padding:3px 10px" id="gd-regen">🔄 ' + (failed ? '重试' : '重新生成') + '</button>' +
        '<button class="btn sm" style="font-size:11px;padding:3px 10px" id="gd-copy"' + (failed ? ' disabled' : '') + '>📋 复制全文</button>' +
        '<button class="btn primary sm" style="font-size:11px;padding:3px 10px" id="gd-word"' + (failed ? ' disabled' : '') + '>📥 Word</button>' +
        '<button class="btn primary sm" style="font-size:11px;padding:3px 10px" id="gd-pdf"' + (failed ? ' disabled' : '') + '>📄 PDF</button>' +
        '<button class="btn sm" style="font-size:11px;padding:3px 10px" id="gd-close">✕ 关闭</button>' +
      '</div>' +
      /* 公文纸面 */
      '<div style="overflow-y:auto;padding:18px;background:var(--bg,#0a0f18)">' +
        (loading
          ? '<div style="background:#fff;border-radius:4px;padding:60px 40px;text-align:center;color:#666;font-size:13px">' +
            '<div style="font-size:28px;margin-bottom:12px">🖋️</div>正在按公文规范撰写' + this._esc(m.title) + '…<br>' +
            '<span style="font-size:11px;color:#999">云端大模型（Kimi/Spark 双通道），失败自动降级本地公文引擎</span></div>'
          : failed
            ? '<div style="background:#fff;border-radius:4px;padding:60px 40px;text-align:center;color:#b91c1c;font-size:13px">' +
              '<div style="font-size:28px;margin-bottom:12px">⚠️</div>生成失败：' + this._esc(r.error) + '<br><span style="font-size:11px;color:#999">可点击「重试」重新生成</span></div>'
            : this._paperHtml(view, r.text)) +
      '</div></div>';
    ov.innerHTML = html;
    document.getElementById('gd-close').onclick = function () { me.close(); };
    document.getElementById('gd-regen').onclick = function () {
      if (me._busy[view]) return;
      me._docNo(view, false);   /* 重新生成出新号 */
      me._gen(view, true);
    };
    var bc = document.getElementById('gd-copy');
    if (bc) bc.onclick = function () { me._copy(st.text || ''); };
    var bw = document.getElementById('gd-word');
    if (bw) bw.onclick = function () { me._word(view, st.text || ''); };
    var bp = document.getElementById('gd-pdf');
    if (bp) bp.onclick = function () { me._pdf(view); };
    /* #583 生成后可编辑（参考每日简报人工编辑）：contenteditable 直改，完成后写回 st.text */
    var be = document.getElementById('gd-edit');
    if (be) be.onclick = function () {
      var paper = document.getElementById('govdoc-paper');
      if (!paper) return;
      if (be.textContent.indexOf('完成') >= 0) {
        paper.contentEditable = 'false';
        paper.style.outline = '';
        /* 编辑后文本回写：取正文段落（版头/落款/脚注之外） */
        var paras = [];
        paper.querySelectorAll('p').forEach(function (p) { var t = p.textContent.trim(); if (t) paras.push(t); });
        if (paras.length) st.text = paras.join('\n');
        be.textContent = '✏️ 编辑';
        me._toast('编辑已保存，可复制或导出 Word');
      } else {
        paper.contentEditable = 'true';
        paper.style.outline = '2px dashed var(--cyan,#00d4ff)';
        paper.focus();
        be.textContent = '✔ 完成';
        me._toast('编辑模式：直接修改公文文字，改完点「完成」');
      }
    };
  },

  close: function () {
    var el = document.getElementById('govdoc-modal');
    if (el) el.remove();
  },

  /* ═══════════ GB/T 9704 公文版式要素 ═══════════
   * 份号 / 发文机关标志（红头）/ 发文字号 / 红色分隔线 / 标题（2号小标宋）/
   * 主送机关 / 正文层次（一、黑体 →（一）楷体 → 1. 仿宋）/ 署名成文日期（阿拉伯数字右空）/ 版记 */
  _RECIPIENT: {
    models: '上级机关',
    workbench: null,   /* 纪要不标主送机关 */
    threatroom: '各驻外机构，各中资项目单位',
    myfocus: '各订阅单位',
    command: '各成员单位'
  },
  _ORG_SHORT: '海外利益保护情报预警平台',
  /* 正文段落 → 层次字体（GB/T 9704：一级黑体、二级楷体、三级仿宋） */
  _fmtPara: function (p, indent) {
    var esc = p.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (/^[一二三四五六七八九十]+、/.test(p)) return '<p style="margin:0 0 2pt;font-family:\'SimHei\',\'黑体\',sans-serif;font-weight:700;text-indent:2em">' + esc + '</p>';
    if (/^（[一二三四五六七八九十]+）/.test(p)) return '<p style="margin:0 0 2pt;font-family:\'KaiTi\',\'楷体\',\'STKaiti\',serif;text-indent:2em">' + esc + '</p>';
    if (/^\d+[.、．]/.test(p)) return '<p style="margin:0 0 2pt;text-indent:2em">' + esc + '</p>';
    return '<p style="margin:0 0 2pt;text-indent:' + (indent === false ? 0 : 2) + 'em">' + esc + '</p>';
  },

  /* ═══════════ 红头公文纸面（GB/T 9704 版式，所见即 Word/PDF 所得） ═══════════ */
  _paperHtml: function (view, text) {
    var m = this.META[view], st = this._last[view] || {};
    var d = new Date();
    var dateCn = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    var paras = String(text || '').split(/\n+/).filter(function (x) { return String(x).trim(); });
    var me = this;
    var body = paras.map(function (p) { return me._fmtPara(p); }).join('');
    var recip = this._RECIPIENT[view];
    return '<div id="govdoc-paper" style="background:#fff;color:#111;border-radius:4px;padding:52px 64px 36px;font-family:\'FangSong\',\'仿宋\',\'STFangsong\',serif;font-size:15.5px;line-height:2;position:relative">' +
      /* 份号（左上，3号黑体 6 位） */
      '<div style="position:absolute;top:14px;left:16px;font-family:\'SimHei\',\'黑体\',sans-serif;font-size:13px;color:#333">000' + String((st.no || '').match(/〕(\d+)号/) ? (st.no.match(/〕(\d+)号/)[1]).padStart(3, '0') : '001') + '</div>' +
      /* 发文机关标志（红头，小标宋） */
      '<div style="text-align:center;font-family:\'SimSun\',\'宋体\',\'STZhongsong\',serif;font-size:29px;font-weight:700;color:#c00000;letter-spacing:3px;margin-top:6px">' + this._esc(this._ORG_SHORT) + '文件</div>' +
      /* 发文字号（3号仿宋居中） */
      '<div style="text-align:center;font-size:15px;color:#111;margin:16px 0 8px">' + this._esc(st.no || '') + '</div>' +
      /* 红色分隔线（武文线，与版心同宽） */
      '<div style="height:3px;background:#c00000;margin:0 0 4px"></div><div style="height:1px;background:#c00000;margin:0 0 20px"></div>' +
      /* 标题（2号小标宋，居中） */
      '<div style="text-align:center;font-family:\'SimSun\',\'宋体\',\'STZhongsong\',serif;font-size:22px;font-weight:700;color:#111;line-height:1.5;margin:6px 0 18px">' + this._esc(m.title) + '</div>' +
      /* 主送机关（顶格 3 号仿宋） */
      (recip ? '<div style="font-size:15.5px;margin-bottom:8px">' + this._esc(recip) + '：</div>' : '') +
      /* 正文（层次字体） */
      '<div style="font-size:15.5px;text-align:justify">' + body + '</div>' +
      /* 发文机关署名（右空）+ 成文日期（阿拉伯数字，右空四字） */
      '<div style="margin-top:26px">' +
        '<div style="text-align:right;font-size:15.5px;padding-right:2em">' + this._esc(m.issuer) + '</div>' +
        '<div style="text-align:right;font-size:15.5px;padding-right:4em;margin-top:2px">' + dateCn + '</div>' +
      '</div>' +
      /* 版记：分隔线 + 抄送 + 印发（4 号仿宋） */
      '<div style="margin-top:30px;border-top:1px solid #999;padding-top:4px;font-size:12px;color:#222">' +
        '<div style="border-bottom:1px solid #999;padding-bottom:4px">抄送：平台各功能中心，值班领导。</div>' +
        '<div style="display:flex;justify-content:space-between;padding-top:4px"><span>' + this._esc(this._ORG_SHORT) + '指挥中心</span><span>' + dateCn + '印发</span></div>' +
      '</div>' +
      '<div style="margin-top:14px;font-size:10px;color:#888;text-align:center">本文由平台基于实时数据自动生成' + (st.degraded ? '（本地公文引擎降级产出）' : '') + '，供决策参考</div>' +
      '</div>';
  },

  /* ═══════════ 复制 / 导出 Word ═══════════ */
  _copy: function (text) {
    var me = this;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { me._toast('公文全文已复制到剪贴板'); }, function () { me._copyFallback(text); });
    } else this._copyFallback(text);
  },
  _copyFallback: function (text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); this._toast('公文全文已复制到剪贴板'); } catch (e) { this._toast('复制失败，请手动选择正文复制'); }
    ta.remove();
  },
  _word: function (view, text) {
    var m = this.META[view], st = this._last[view] || {};
    var d = new Date();
    var dateCn = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    var paras = String(text || '').split(/\n+/).filter(function (x) { return String(x).trim(); });
    var me = this;
    var body = paras.map(function (p) { return me._fmtPara(p); }).join('');
    var recip = this._RECIPIENT[view];
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + m.title + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>@page{size:A4;margin:3.7cm 2.6cm 3.5cm 2.8cm}' +
      'body{font-family:FangSong,仿宋,STFangsong,serif;font-size:16px;line-height:30px;color:#000}' +
      '.fenhong{font-family:SimSun,宋体,STZhongsong,serif;font-size:30px;font-weight:700;color:#c00000;text-align:center;letter-spacing:3px}' +
      '.fenhao{text-align:center;font-size:15px;margin:14pt 0 6pt}' +
      '.hr1{height:2.5px;background:#c00000}.hr2{height:1px;background:#c00000;margin:0 0 16pt}' +
      '.title{font-family:SimSun,宋体,STZhongsong,serif;font-size:22px;font-weight:700;text-align:center;line-height:1.5;margin:4pt 0 14pt}' +
      '.recip{font-size:16px;margin-bottom:6pt}' +
      '.ft-r2{text-align:right;padding-right:2em;font-size:16px;margin-top:20pt}' +
      '.ft-r4{text-align:right;padding-right:4em;font-size:16px;margin-top:2pt}' +
      '.bj{border-top:1px solid #999;margin-top:22pt;padding-top:3pt;font-size:12px}' +
      '.bjr{display:flex;justify-content:space-between;border-top:1px solid #999;padding-top:3pt;font-size:12px}</style></head><body>' +
      '<div class="fenhong">' + this._ORG_SHORT + '文件</div>' +
      '<div class="fenhao">' + (st.no || '') + '</div>' +
      '<div class="hr1"></div><div class="hr2"></div>' +
      '<div class="title">' + m.title + '</div>' +
      (recip ? '<div class="recip">' + recip + '：</div>' : '') +
      body +
      '<div class="ft-r2">' + m.issuer + '</div>' +
      '<div class="ft-r4">' + dateCn + '</div>' +
      '<div class="bj">抄送：平台各功能中心，值班领导。</div>' +
      '<div class="bjr"><span>' + this._ORG_SHORT + '指挥中心</span><span>' + dateCn + '印发</span></div>' +
      '</body></html>';
    var blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (m.title + (st.no ? '(' + st.no + ')' : '') + '.doc').replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    this._toast('已导出 Word 公文');
  },

  /* ═══════════ PDF 导出（html2canvas 渲染纸面 → jsPDF A4 分页） ═══════════ */
  _pdf: function (view) {
    var me = this, m = this.META[view], st = this._last[view] || {};
    var paper = document.getElementById('govdoc-paper');
    if (!paper) { this._toast('请先生成公文'); return; }
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') { this._toast('PDF 组件未加载，请刷新页面'); return; }
    this._toast('正在渲染 PDF…');
    html2canvas(paper, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(function (canvas) {
      var pdf = new window.jspdf.jsPDF('p', 'mm', 'a4');
      var imgW = 190, imgH = canvas.height * imgW / canvas.width;
      var img = canvas.toDataURL('image/jpeg', 0.92);
      var left = 0, pageH = 277;
      while (left < imgH) {
        if (left > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 10, 10 - left, imgW, imgH);
        left += pageH;
      }
      pdf.save((m.title + (st.no ? '(' + st.no + ')' : '') + '.pdf').replace(/[\\/:*?"<>|]/g, '_'));
      me._toast('已导出 PDF 公文');
    }).catch(function (e) { me._toast('PDF 渲染失败：' + e.message); });
  },

  /* ═══════════ #580 清单质量闸：栏目名/陈旧/无要素标题不得进公文素材 ═══════════ */
  _JUNK_COL: /^(?:【[^】]{1,20}】|「[^」]{1,20}」|\[[^\]]{1,20}\])?\s*(?:世界进行时|每日速递|新闻早报|新闻晚报|今日关注|环球视野|一周回顾|要闻回顾|一周要闻|每日播报|早班车|晚间播报|时政要闻|国际要闻|环球播报|看世界|新闻早餐|新闻午餐|视频|图集|图说|直播|回放|精彩回顾)/,
  _cleanT: function (title, maxAgeDays) {
    var t = String(title || '').trim();
    if (!t || t.length < 10) return '';
    if (this._JUNK_COL.test(t)) return '';
    var m = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) {
      var dt = new Date(+m[1], +m[2] - 1, +m[3]);
      if ((Date.now() - dt.getTime()) / 86400000 > (maxAgeDays || 3)) return '';
    }
    return t;
  },

  /* ═════════════════════════ 五视图 payload 装配器 ═════════════════════════ */

  _payload: function (view) {
    if (view === 'models') return this._pModels();
    if (view === 'workbench') return this._pWorkbench();
    if (view === 'threatroom') return this._pThreatroom();
    if (view === 'myfocus') return this._pMyfocus();
    if (view === 'command') return this._pCommand();
    return null;
  },

  /* ── 风险预测模型：/api/models/overview + /alerts + 六专项智能体研判 ── */
  _pModels: function () {
    var me = this;
    return fetch('/api/models/overview').then(function (r) { return r.json(); }).then(function (ov) {
      if (!ov || !ov.ok) return null;
      return fetch('/api/models/alerts').then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (al) {
        var agents = [];
        try {
          var MA = window.MODELS_ANALYSIS;
          ['org', 'terror', 'kidnap', 'geo', 'sanctions', 'minerals'].forEach(function (k) {
            var a = MA && MA._agent && MA._agent[k];
            if (a && a.sections && a.sections.length) {
              agents.push({
                name: a.name || k,
                summary: a.sections.map(function (s) { return s.title + '：' + String(s.body || '').slice(0, 110); }).join('；').slice(0, 500)
              });
            }
          });
        } catch (e) {}
        return {
          window: ov.window || {},
          orgs: (ov.orgs || []).length,
          alerts: (al && al.alerts) || [],
          byType: ov.byType || [],
          countries: ov.countries || [],
          agents: agents
        };
      });
    });
  },

  /* ── 智能协同作业台：v4 五产物（指数/环比/异动/盯防/项目威胁） ── */
  _pWorkbench: function () {
    var W = window.WORKBENCH;
    if (!W || !W._ix) return null;
    return {
      hours: W._hours || 24,
      ix: { idx: W._ix.idx, grade: W._ix.grade || {}, score: W._ix.score, n: W._ix.n, lv: W._ix.lv || {}, cnN: W._ix.cnN, coreN: W._ix.coreN },
      trend: W._trend || {},
      anomalies: (W._anomList || []).map(function (a) { return { country: a.country, n: a.n, ratio: a.ratio, dayAvg: a.dayAvg }; }),
      watch: (W._watch || []).map(function (w) { return { country: w.country, n: w.n, red: w.red, orange: w.orange, cn: w.cn, proj: w.proj, score: w.score }; }),
      threatProjects: (W._threat || []).slice(0, 8).map(function (t) { return { proj: t.proj, country: t.country, ent: t.ent, n: t.n, red: t.red, heat: t.heat, topTitle: t.topTitle }; })
    };
  },

  /* ── 专项情报作战室：当前实体 + 窗口统计 + 等级 + 代表性事件 ── */
  _pThreatroom: function () {
    var T = window.THREATROOM;
    if (!T || !T._entity) return null;
    var st = T._items && T._items.length ? T._stats() : { n: 0, red: 0, orange: 0, yellow: 0, cn: 0, core: 0, byDay: [], byType: {}, byCountry: {}, cnItems: [], recent: 0, prior: 0 };
    var g = T._grade(st);
    var lvW = { red: 0, orange: 1, yellow: 2, blue: 3 };
    var me = this;
    var tops = (T._items || []).slice().sort(function (a, b) {
      var la = lvW[a.level] != null ? lvW[a.level] : 9, lb = lvW[b.level] != null ? lvW[b.level] : 9;
      if (la !== lb) return la - lb;
      return (T._tsOf(b) || 0) - (T._tsOf(a) || 0);
    }).map(function (it) {
      var t = T._tsOf(it) || 0;
      var ttl = me._cleanT(it.title_zh || it.title || '', 3);
      if (!ttl) return null;
      return { time: t ? new Date(t).toISOString().slice(0, 10) : '时间不详', country: it.country || '', title: ttl, level: it.level || '',
               desc: String(it.desc_zh || it.desc || it.description || '').slice(0, 90) };
    }).filter(Boolean).slice(0, 15);   /* #583：10→15 扩选材面（服务端再按每日简报同款闸精选 8 件） */
    return {
      entity: { cn: T._entity.cn, en: T._entity.en, type: T._entity.type, aliases: (T._entity.aliases || []).slice(0, 8) },
      typeLabel: T._typeLabel ? T._typeLabel(T._entity.type) : (T._entity.type || ''),
      days: T._days || 7,
      stats: { n: st.n, red: st.red, orange: st.orange, yellow: st.yellow, cn: st.cn, core: st.core, recent: st.recent, prior: st.prior, byDay: st.byDay, byCountry: st.byCountry, byType: st.byType },
      grade: { t: g.t, score: g.score },
      collect: T._collect ? { collected: T._collect.collected, webHits: T._collect.webHits, inserted: T._collect.inserted, rejected: T._collect.rejected } : null,
      topItems: tops,
      cnItems: (st.cnItems || []).slice(0, 10).map(function (it) {
        var t = T._tsOf(it) || 0;
        return { time: t ? new Date(t).toISOString().slice(0, 10) : '', title: it.title_zh || it.title || '', desc: String(it.desc_zh || it.desc || '').slice(0, 80) };
      })
    };
  },

  /* ── 重点目标监测：订阅范围 + 命中分级清单 ── */
  _pMyfocus: function () {
    var M = window.MYFOCUS;
    if (!M) return null;
    var s = M.loadSubs();
    var hasSub = (s.countries || []).length || (s.projects || []).length || (s.enterprises || []).length;
    if (!hasSub) return null;
    var lvW = { red: 0, orange: 1, yellow: 2, blue: 3 };
    var matched = (M._alerts || []).filter(function (a) { return M._match(a); });
    if (s.redOnly) matched = matched.filter(function (a) { return a.level === 'red' || a.level === 'orange'; });
    else matched = matched.filter(function (a) { return a.level !== 'blue'; });
    matched.sort(function (a, b) {
      var la = lvW[a.level] != null ? lvW[a.level] : 9, lb = lvW[b.level] != null ? lvW[b.level] : 9;
      if (la !== lb) return la - lb;
      return (Date.parse(String(b.time || '').replace(' ', 'T')) || 0) - (Date.parse(String(a.time || '').replace(' ', 'T')) || 0);
    });
    var c = { red: 0, orange: 0, yellow: 0 };
    matched.forEach(function (a) { if (c[a.level] != null) c[a.level]++; });
    /* #580：垃圾标题（栏目名/陈旧/无要素）在装配端即剔除，同时带摘要供服务端研判 */
    var me = this;
    var cleanMatched = matched.map(function (a) {
      var t = me._cleanT(a.title_zh || a.title || '', 3);
      if (!t) return null;
      return { level: a.level, country: a.country || '', time: String(a.time || ''), title: t,
               desc: String(a.desc_zh || a.desc || a.summary || '').slice(0, 90),
               chinaRelated: a.chinaRelated, china: a.china, negative: a.negative };
    }).filter(Boolean);
    return {
      subs: { countries: s.countries, projects: s.projects, enterprises: s.enterprises, redOnly: !!s.redOnly },
      counts: c,
      matched: cleanMatched.slice(0, 60)   /* #583：30→60 扩选材面（服务端每日简报同款闸精选 15） */
    };
  },

  /* ── 指挥调度中心：在案事件 + 工单 + 资源 + 预案/通讯录底数 ── */
  _pCommand: function () {
    var C = window.COMMAND;
    if (!C) return null;
    var DEPTS = { mfa: '外交部', mps: '公安部', mofcom: '商务部', enterprise: '中资企业', health: '卫健委', intel: '情报', cyber: '网信办', transport: '交通部', defense: '国防/军方', bank: '人民银行/外汇', legal: '法务', media: '宣传', civil: '应急管理', energy: '能源', labor: '人社/劳工' };
    var INC = { open: '待处理', processing: '处置中', closed: '已结案' };
    var WO = { pending: '待办', processing: '进行中', done: '已完成' };
    var RST = { available: '在库可用', dispatched: '已派出', standby: '待命' };
    var RT = { medical: '医疗', security: '安保', transport: '运输', comm: '通信', air: '空运' };
    var incs = C._incidents || [];
    var wos = C._workorders || [];
    var c = { total: incs.length, open: 0, processing: 0, closed: 0 };
    incs.forEach(function (i) { if (c[i.status] != null) c[i.status]++; });
    var wc = { total: wos.length, pending: 0, processing: 0, done: 0 };
    wos.forEach(function (w) { if (wc[w.status] != null) wc[w.status]++; });
    /* 最高响应等级优先，同级新的在前 */
    var lvlW = { 1: 0, 2: 1, 3: 2, 4: 3 };
    var incList = incs.slice().sort(function (a, b) {
      var la = lvlW[a.level] != null ? lvlW[a.level] : 9, lb = lvlW[b.level] != null ? lvlW[b.level] : 9;
      if (la !== lb) return la - lb;
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    }).slice(0, 12).map(function (i) {
      return {
        id: i.id, title: i.title, country: i.country || '—', levelName: i.levelName || ('等级' + i.level),
        statusLabel: INC[i.status] || i.status || '',
        depts: (i.assignedDepts || []).map(function (d) { return DEPTS[d] || d; }).join('、') || '—'
      };
    });
    var woList = wos.filter(function (w) { return w.status === 'pending' || w.status === 'processing'; })
      .slice(0, 10).map(function (w) { return { title: w.title, deptLabel: DEPTS[w.dept] || w.dept || '—', statusLabel: WO[w.status] || w.status || '' }; });
    return {
      counts: c,
      incidents: incList,
      woCounts: wc,
      workorders: woList,
      resources: (C._resources || []).slice(0, 8).map(function (r) { return { name: r.name, typeLabel: RT[r.type] || r.type || '', statusLabel: RST[r.status] || r.status || '' }; }),
      playbooks: (C._playbooks || []).length,
      contacts: (C._contacts || []).length
    };
  }
};
window.GOVDOC = GOVDOC;
