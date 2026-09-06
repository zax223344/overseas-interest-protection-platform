/**
 * period-briefs.js — 周期简报中心 · 月/季/半年/全年简报面板（2026-09-06 用户指令二）
 * ================================================================
 * 背景：周期简报中心原仅有「每日简报」，缺 每月/每季/半年/全年 简报面板。
 * 本模块复用服务端 reports-engine 的 situation-brief（综合态势简报）产品：
 *   后端已支持 FREQ_ALL（日/周/月/季/半年/年）+ WORD_TARGETS 字数硬指标 + 公文版渲染，
 *   前端本模块按频率钉死四个面板，各面板独立：期次选择 / 生成 / 标准版·公文版阅读 / PDF·Word 导出。
 * API 契约（与 reports-center.js 同一组，全部需 Bearer token）：
 *   POST /api/reports/products/generate  {type:'situation-brief', freq, period} → {ok,id,period}
 *   GET  /api/reports/products/list?type=situation-brief&limit=100 → {ok,list}
 *   GET  /api/reports/products/detail/:id → {id,period,title,html,gov_html,summary,llm_model,created_at}
 * 期次键格式（本地时区）：monthly=2026-09 / quarterly=2026-Q3 / semiannual=2026-S1 / yearly=2026
 * 注册：index.html 四个 view-pb-* 容器 + app.js VIEW_MERGE_ALIAS/TABS + runViewInit + role-ui.js VIEW_LABELS
 * 铁律：零模拟数据（列表/阅读全部来自 report_products 真实行）；fetch 必带 AbortController 超时；
 *       API 失败优雅降级（空态提示，不白屏）；生成轮询 15s×20（LLM 最长约 3 分钟）。
 */
(function () {
  'use strict';

  /* ===== 四周期配置 ===== */
  var FREQS = {
    monthly: {
      n: '每月简报', adj: '月度', ic: '🗓️', color: '#ffcc00',
      re: /^\d{4}-\d{2}$/,
      desc: '按自然月归集全库综合态势：红橙预警 / 涉华要情 / 国别热点 / 伤亡事件，公文版字数硬指标 2 万字档'
    },
    quarterly: {
      n: '每季简报', adj: '季度', ic: '📆', color: '#ff8800',
      re: /^\d{4}-Q[1-4]$/,
      desc: '按自然季归集全库综合态势，季度走势研判与对策建议，公文版字数硬指标 4 万字档'
    },
    semiannual: {
      n: '半年简报', adj: '半年度', ic: '📅', color: '#ff5f9e',
      re: /^\d{4}-S[12]$/,
      desc: '上半年 / 下半年全库综合态势归集，半年度趋势研判，公文版字数硬指标 4.5 万字档'
    },
    yearly: {
      n: '全年简报', adj: '年度', ic: '📕', color: '#b366ff',
      re: /^\d{4}$/,
      desc: '全年全库综合态势归集，年度总体研判与对策建议，公文版字数硬指标 4.5 万字档'
    }
  };
  var TYPE = 'situation-brief';

  /* ===== 状态（每频率独立） ===== */
  var S = { cssInited: false };
  function st(freq) {
    if (!S[freq]) S[freq] = {
      rendered: false,        /* 骨架已渲染 */
      list: [], listLoading: false,
      detail: null, detailLoading: false,
      ver: 'gov',             /* 默认公文版（用户核心诉求） */
      period: '',             /* 期次选择器当前值 */
      generating: false, pollTimer: null, pollCount: 0
    };
    return S[freq];
  }

  /* ===== 工具 ===== */
  function $(id) { return document.getElementById(id); }
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(msg) { try { showToast(msg); } catch (e) { console.log('[PERIOD-BRIEFS]', msg); } }
  function _token() { try { return (typeof APIClient !== 'undefined' && APIClient.getToken()) || ''; } catch (e) { return ''; } }
  function fmtTs(t) { try { return String(t || '').replace('T', ' ').slice(0, 16); } catch (e) { return ''; } }

  /* API 封装（仿 reports-center.js：需原始状态码；常规 30s / 生成 300s AbortController 兜底） */
  function api(method, path, body, timeoutMs) {
    var headers = { 'Content-Type': 'application/json' };
    var tk = _token(); if (tk) headers['Authorization'] = 'Bearer ' + tk;
    var opts = { method: method, headers: headers };
    if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body);
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (ctl) {
      opts.signal = ctl.signal;
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, timeoutMs || 30000);
    }
    return fetch('/api/reports/products' + path, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; })
        .catch(function () { return { ok: r.ok, status: r.status, data: {} }; });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      return { ok: false, status: 0, data: { error: '网络异常: ' + e.message } };
    });
  }

  /* ===== 期次键计算（本地时区，禁 toISOString） ===== */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function periodOptions(freq) {
    var out = [];
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth(); /* m: 0-11 */
    var i, yy, mm;
    if (freq === 'monthly') {
      for (i = 0; i < 12; i++) {
        yy = y; mm = m - i;
        while (mm < 0) { mm += 12; yy--; }
        out.push(yy + '-' + pad2(mm + 1));
      }
    } else if (freq === 'quarterly') {
      var q = Math.floor(m / 3) + 1;
      for (i = 0; i < 8; i++) {
        yy = y; var qq = q - i;
        while (qq < 1) { qq += 4; yy--; }
        out.push(yy + '-Q' + qq);
      }
    } else if (freq === 'semiannual') {
      var s = m < 6 ? 1 : 2;
      for (i = 0; i < 4; i++) {
        yy = y; var ss = s - i;
        while (ss < 1) { ss += 2; yy--; }
        out.push(yy + '-S' + ss);
      }
    } else if (freq === 'yearly') {
      for (i = 0; i < 2; i++) out.push(String(y - i));
    }
    return out;
  }
  function periodCn(key) {
    var m;
    if ((m = /^(\d{4})-(\d{2})$/.exec(key))) return m[1] + '年' + parseInt(m[2], 10) + '月';
    if ((m = /^(\d{4})-Q([1-4])$/.exec(key))) return m[1] + '年第' + '一二三四'[parseInt(m[2], 10) - 1] + '季度';
    if ((m = /^(\d{4})-S([12])$/.exec(key))) return m[1] + '年' + (m[2] === '1' ? '上半年' : '下半年');
    if ((m = /^(\d{4})$/.exec(key))) return m[1] + '年度';
    return key;
  }

  window.PERIOD_BRIEFS = {
    FREQS: FREQS,
    _st: st, _api: api, _esc: esc, _toast: toast, _fmtTs: fmtTs,
    _periodOptions: periodOptions, _periodCn: periodCn,
    _ensureCss: null, _wrapDoc: null
  };
})();

/* ============================================================
 * 第二部分：CSS + 面板骨架 + 期次列表
 * ============================================================ */
(function () {
  'use strict';
  var PB = window.PERIOD_BRIEFS;
  var esc = PB._esc, toast = PB._toast, fmtTs = PB._fmtTs;
  function $(id) { return document.getElementById(id); }

  /* ===== HUD 样式（深空蓝黑，pb- 前缀，一次性注入） ===== */
  var CSS = [
    '.pb-wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:10px;padding:10px 12px 16px;height:calc(100vh - 96px);box-sizing:border-box;position:relative;z-index:2;',
    ' background:radial-gradient(1100px 480px at 72% -12%,rgba(0,120,255,0.07),transparent 60%),radial-gradient(800px 380px at 8% 112%,rgba(0,212,255,0.05),transparent 60%);}',
    '.pb-card{background:linear-gradient(160deg,rgba(10,22,40,0.92),rgba(6,14,28,0.96));border:1px solid rgba(0,212,255,0.16);border-radius:8px;position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:0;}',
    '.pb-card:before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.55),transparent);pointer-events:none;}',
    '.pb-main{min-width:0;}',
    '.pb-toolbar{padding:10px 14px 9px;border-bottom:1px solid rgba(0,212,255,0.12);flex:none;}',
    '.pb-tb-row1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
    '.pb-tb-title{font-size:15px;font-weight:800;color:#cfe9ff;letter-spacing:.5px;}',
    '.pb-tb-desc{font-size:10.5px;color:var(--text3);flex:1;min-width:200px;line-height:1.5;}',
    '.pb-badge{font-size:10px;padding:2px 9px;border-radius:9px;border:1px solid rgba(0,212,255,0.3);background:rgba(0,212,255,0.07);color:#00e5ff;flex:none;letter-spacing:1px;}',
    '.pb-badge.llm{border-color:rgba(179,102,255,0.45);background:rgba(179,102,255,0.1);color:#d0a5ff;}',
    '.pb-badge.warn{border-color:rgba(255,204,0,0.4);background:rgba(255,204,0,0.08);color:var(--yellow);}',
    '.pb-tb-row2{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;}',
    '.pb-sel{font-size:11.5px;padding:6px 10px;border-radius:6px;border:1px solid rgba(0,212,255,0.3);background:rgba(6,14,28,0.9);color:var(--text);outline:none;}',
    '.pb-btn{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid rgba(0,212,255,0.35);color:#00e5ff;background:rgba(0,212,255,0.08);transition:all .18s;letter-spacing:1px;white-space:nowrap;}',
    '.pb-btn:hover{background:rgba(0,212,255,0.18);box-shadow:0 0 10px rgba(0,212,255,0.25);}',
    '.pb-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}',
    '.pb-btn.primary{background:linear-gradient(135deg,rgba(0,212,255,0.25),rgba(0,102,255,0.18));border-color:rgba(0,212,255,0.55);font-weight:700;}',
    '.pb-btn.warn{border-color:rgba(255,136,0,0.45);background:rgba(255,136,0,0.1);color:#ffbb66;}',
    '.pb-btn.busy{pointer-events:none;color:var(--yellow);border-color:rgba(255,204,0,0.4);background:rgba(255,204,0,0.07);}',
    '.pb-spin{width:12px;height:12px;border:2px solid rgba(255,204,0,0.25);border-top-color:#ffcc00;border-radius:50%;animation:pb-rot .8s linear infinite;flex:none;}',
    '@keyframes pb-rot{to{transform:rotate(360deg)}}',
    '.pb-seg{display:inline-flex;border:1px solid rgba(0,212,255,0.25);border-radius:6px;overflow:hidden;flex:none;}',
    '.pb-seg button{font-size:11px;padding:6px 13px;background:transparent;border:none;color:var(--text2);cursor:pointer;letter-spacing:1px;transition:all .15s;}',
    '.pb-seg button.on{background:rgba(0,212,255,0.16);color:#00e5ff;font-weight:700;}',
    '.pb-reader{flex:1;min-height:0;position:relative;background:rgba(4,10,22,0.55);}',
    '.pb-frame{width:100%;height:100%;border:none;background:#fff;display:block;}',
    '.pb-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:30px;text-align:center;}',
    '.pb-state .big{font-size:15px;color:var(--text2);line-height:1.8;max-width:560px;}',
    '.pb-state .ic{font-size:44px;filter:drop-shadow(0 0 18px rgba(0,212,255,0.4));}',
    '.pb-state .dim{font-size:11px;color:var(--text3);line-height:1.7;max-width:520px;}',
    '.pb-side{display:flex;flex-direction:column;min-height:0;}',
    '.pb-ptt{font-size:13px;font-weight:700;color:#9fe8ff;letter-spacing:1px;padding:10px 12px 6px;display:flex;align-items:center;gap:7px;flex:none;text-shadow:0 0 12px rgba(0,212,255,0.35);}',
    '.pb-ptt .dot{width:7px;height:7px;border-radius:50%;background:#00d4ff;box-shadow:0 0 8px #00d4ff;flex:none;}',
    '.pb-hlist{overflow-y:auto;padding:2px 8px 10px;flex:1;min-height:0;}',
    '.pb-hitem{padding:8px 10px;margin:4px 2px;border-radius:6px;cursor:pointer;border:1px solid rgba(0,212,255,0.08);background:rgba(0,212,255,0.02);transition:all .15s;}',
    '.pb-hitem:hover{border-color:rgba(0,212,255,0.35);}',
    '.pb-hitem.on{border-color:rgba(0,212,255,0.5);background:rgba(0,212,255,0.1);box-shadow:inset 2px 0 0 #00d4ff;}',
    '.pb-h-per{font-size:11px;font-weight:800;color:#00e5ff;letter-spacing:1px;}',
    '.pb-h-tt{font-size:11.5px;color:var(--text);margin-top:3px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    '.pb-h-meta{font-size:9.5px;color:var(--text3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;}',
    '.pb-h-gc{font-size:9.5px;color:var(--yellow);}',
    '.pb-note{margin:6px 10px 8px;padding:8px 10px;border:1px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.04);border-radius:6px;font-size:10.5px;color:var(--text2);line-height:1.6;flex:none;}'
  ].join('\n');

  PB._ensureCss = function () {
    if ($('pb-style')) return;
    var el = document.createElement('style');
    el.id = 'pb-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  };

  /* ===== 面板骨架（每频率一次） ===== */
  function renderShell(freq) {
    var F = PB.FREQS[freq];
    var root = $('pb-root-' + freq);
    if (!root) return false;
    var opts = PB._periodOptions(freq);
    var s = PB._st(freq);
    if (!s.period) s.period = opts[0];
    root.innerHTML =
      '<div class="pb-wrap">' +
        '<div class="pb-card pb-main">' +
          '<div class="pb-toolbar">' +
            '<div class="pb-tb-row1">' +
              '<span class="pb-tb-title">' + F.ic + ' ' + F.n + '</span>' +
              '<span class="pb-badge" style="border-color:' + F.color + '55;color:' + F.color + '">' + F.adj + '</span>' +
              '<span id="pb-badges-' + freq + '"></span>' +
              '<span class="pb-tb-desc">' + esc(F.desc) + '</span>' +
            '</div>' +
            '<div class="pb-tb-row2">' +
              '<select class="pb-sel" id="pb-sel-' + freq + '" title="选择期次">' +
                opts.map(function (k) { return '<option value="' + k + '"' + (k === s.period ? ' selected' : '') + '>' + esc(PB._periodCn(k)) + '（' + k + '）</option>'; }).join('') +
              '</select>' +
              '<button class="pb-btn primary" id="pb-gen-' + freq + '">⚡ 生成' + F.n + '（含公文版）</button>' +
              '<span class="pb-seg" id="pb-seg-' + freq + '">' +
                '<button data-ver="std">📄 标准版</button>' +
                '<button data-ver="gov" class="on">📜 公文版</button>' +
              '</span>' +
              '<button class="pb-btn" id="pb-pdf-' + freq + '" title="按公文版式打印/另存为 PDF">🖨️ 导出 PDF</button>' +
              '<button class="pb-btn" id="pb-doc-' + freq + '" title="导出 Word（.doc，可编辑）">📄 导出 Word</button>' +
            '</div>' +
          '</div>' +
          '<div class="pb-reader" id="pb-reader-' + freq + '"></div>' +
        '</div>' +
        '<div class="pb-card pb-side">' +
          '<div class="pb-ptt"><span class="dot"></span>期次历史 · ' + F.n + '</div>' +
          '<div class="pb-note">数据源：服务端 report_products 真实行（situation-brief 类型 · ' + F.adj + '周期）。生成耗时约 1-3 分钟（真实数据装配 + LLM 研判 + 公文渲染），期间可切换其他功能。</div>' +
          '<div class="pb-hlist" id="pb-hlist-' + freq + '"></div>' +
        '</div>' +
      '</div>';

    /* 事件绑定 */
    $('pb-sel-' + freq).onchange = function () { PB._st(freq).period = this.value; };
    $('pb-gen-' + freq).onclick = function () { PB.generate(freq); };
    $('pb-pdf-' + freq).onclick = function () { PB.exportPDF(freq); };
    $('pb-doc-' + freq).onclick = function () { PB.exportWord(freq); };
    var seg = $('pb-seg-' + freq);
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        PB._st(freq).ver = b.getAttribute('data-ver');
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
        PB._renderReader(freq);
      };
    });
    return true;
  }

  /* ===== 期次列表（按频率正则过滤 situation-brief 行） ===== */
  function renderList(freq) {
    var F = PB.FREQS[freq];
    var s = PB._st(freq);
    var el = $('pb-hlist-' + freq);
    if (!el) return;
    if (s.listLoading) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:11px">期次列表加载中…</div>';
      return;
    }
    var rows = s.list.filter(function (r) { return F.re.test(String(r.period || '')); });
    if (!rows.length) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:11px;line-height:1.8">暂无' + esc(F.n) + '期次<br>选择期次后点击「生成」按钮</div>';
      return;
    }
    el.innerHTML = rows.map(function (r) {
      var sm = r.summary || {};
      var gc = sm.govChars ? '<span class="pb-h-gc">📜 ' + sm.govChars + ' 字</span>' : '';
      var on = s.detail && s.detail.id === r.id ? ' on' : '';
      return '<div class="pb-hitem' + on + '" data-id="' + r.id + '">' +
        '<div class="pb-h-per">' + esc(PB._periodCn(String(r.period || '—'))) + '</div>' +
        '<div class="pb-h-tt">' + esc(r.title || '—') + '</div>' +
        '<div class="pb-h-meta"><span>' + esc(fmtTs(r.created_at)) + '</span>' + gc + '</div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.pb-hitem'), function (it) {
      it.onclick = function () { PB.loadDetail(freq, parseInt(it.getAttribute('data-id'), 10)); };
    });
  }

  PB._renderShell = renderShell;
  PB._renderList = renderList;
})();

/* ============================================================
 * 第三部分：阅读器 + 数据加载 + 生成轮询
 * ============================================================ */
(function () {
  'use strict';
  var PB = window.PERIOD_BRIEFS;
  var esc = PB._esc, toast = PB._toast, fmtTs = PB._fmtTs;
  function $(id) { return document.getElementById(id); }

  /* 标准版深色阅读衬底 / 公文版白底（与 reports-center wrapDoc 同思路） */
  function wrapDoc(bodyHtml, dark) {
    var css = dark
      ? 'body{margin:0;padding:26px 30px;background:#0a1220;color:#c9d6e8;font:14px/1.9 "Microsoft YaHei",sans-serif;}'
        + 'h1,h2,h3{color:#9fe8ff;} table{border-collapse:collapse;width:100%;} td,th{border:1px solid #234;padding:6px 8px;}'
      : 'body{margin:0;padding:26px 30px;background:#fff;color:#111;font:15px/2 "FangSong","仿宋",serif;}';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + bodyHtml + '</body></html>';
  }
  function docHTML(detail, ver) {
    var raw = ver === 'gov' ? detail.gov_html : detail.html;
    if (!raw || !String(raw).trim()) {
      return wrapDoc('<p style="text-align:center;color:#888">该期' + (ver === 'gov' ? '公文版' : '标准版') + '暂无内容。</p>', ver !== 'gov');
    }
    var s = String(raw);
    /* 2026-09-06 去沙箱脚本噪声：iframe sandbox='allow-same-origin' 禁脚本，gov_html 内嵌
     * <script>（如 KaTeX / 图表）会被浏览器拦截并报「Blocked script execution」控制台错。
     * 内容已是静态 HTML，剥离 script 标签后不影响渲染，又净化控制台 */
    s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    if (/<html[\s>]/i.test(s)) return s; /* 已是完整文档则原样呈现 */
    return wrapDoc(s, ver !== 'gov');
  }

  function stateHTML(ic, big, dim) {
    return '<div class="pb-state"><div class="ic">' + ic + '</div><div class="big">' + big + '</div>' +
      (dim ? '<div class="dim">' + dim + '</div>' : '') + '</div>';
  }

  /* 徽标行（期次 / 字数指标 / LLM） */
  function renderBadges(freq) {
    var s = PB._st(freq);
    var el = $('pb-badges-' + freq);
    if (!el) return;
    var d = s.detail;
    if (!d) { el.innerHTML = ''; return; }
    var sm = d.summary || {};
    var out = '<span class="pb-badge">📅 ' + esc(PB._periodCn(String(d.period || '—'))) + '</span>';
    if (sm.govChars) {
      var wt = sm.wordTarget ? ' / 指标 ' + sm.wordTarget : '';
      out += '<span class="pb-badge warn">📜 公文 ' + sm.govChars + ' 字' + esc(wt) + '</span>';
      /* 字数硬指标自算 ⚠️：服务端 RS.wordCountIssue 仅打日志未落 summary，前端按
       * wordTarget="20000~45555" 拆下限比对，弹药不足如实标注「真实数据量所限」 */
      if (sm.wordTarget) {
        var wm = /^(\d+)\s*~\s*\d+$/.exec(String(sm.wordTarget));
        if (wm && parseInt(wm[1], 10) > Number(sm.govChars)) {
          out += '<span class="pb-badge warn" title="真实数据量所限，已如实成文（未达硬指标下限）">⚠️ 字数未达标</span>';
        }
      }
    }
    if (d.llm_model) out += '<span class="pb-badge llm">🤖 ' + esc(d.llm_model) + '</span>';
    if (sm.wordIssue) out += '<span class="pb-badge warn" title="' + esc(sm.wordIssue) + '">⚠️ 字数未达标</span>';
    el.innerHTML = out;
  }

  function renderReader(freq) {
    var F = PB.FREQS[freq];
    var s = PB._st(freq);
    var el = $('pb-reader-' + freq);
    if (!el) return;
    renderBadges(freq);
    if (s.detailLoading) {
      el.innerHTML = stateHTML('⏳', '报告加载中…', '');
      return;
    }
    if (!s.detail) {
      el.innerHTML = stateHTML(F.ic, '从右侧期次历史选择一期' + esc(F.n) + '，或点击「生成」产出新一期',
        '标准版 = 深色阅读视图；公文版 = GB/T 9704-2012 参考版式红头公文，可导出 PDF / Word');
      return;
    }
    el.innerHTML = '';
    var f = document.createElement('iframe');
    f.className = 'pb-frame';
    f.setAttribute('sandbox', 'allow-same-origin');
    el.appendChild(f);
    f.srcdoc = docHTML(s.detail, s.ver);
  }

  /* ===== 数据加载 ===== */
  function loadList(freq, done) {
    var s = PB._st(freq);
    s.listLoading = true;
    PB._renderList(freq);
    PB._api('GET', '/list?type=' + PB._type + '&limit=100').then(function (r) {
      s.listLoading = false;
      if (r.ok && r.data && r.data.ok) {
        s.list = r.data.list || [];
      } else if (r.status === 401 || r.status === 403) {
        toast('⚠️ 登录态失效，请重新登录后查看期次列表');
      }
      PB._renderList(freq);
      if (done) done();
    });
  }

  function loadDetail(freq, id) {
    var s = PB._st(freq);
    s.detailLoading = true;
    renderReader(freq);
    PB._api('GET', '/detail/' + id).then(function (r) {
      s.detailLoading = false;
      if (r.ok && r.data && r.data.id) {
        s.detail = r.data;
        /* 详情落位后同步期次选择器（重新生成同 period 用） */
        var per = String(r.data.period || '');
        if (PB.FREQS[freq].re.test(per)) {
          s.period = per;
          var sel = $('pb-sel-' + freq);
          if (sel && sel.querySelector('option[value="' + per + '"]')) sel.value = per;
        }
      } else {
        toast('⚠️ 报告详情加载失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
      }
      renderReader(freq);
      PB._renderList(freq); /* 刷新选中高亮 */
    });
  }

  /* ===== 生成（POST + 15s 轮询，最长 5 分钟） ===== */
  function setGenUI(freq, on, label) {
    var b = $('pb-gen-' + freq);
    if (!b) return;
    var F = PB.FREQS[freq];
    if (on) {
      b.classList.add('busy');
      b.innerHTML = '<span class="pb-spin"></span>' + esc(label || '生成中…');
    } else {
      b.classList.remove('busy');
      b.innerHTML = '⚡ 生成' + F.n + '（含公文版）';
    }
  }

  function generate(freq) {
    var F = PB.FREQS[freq];
    var s = PB._st(freq);
    if (s.generating) { toast('⏳ 正在生成中，请稍候…'); return; }
    var period = s.period || PB._periodOptions(freq)[0];
    s.generating = true;
    s.pollCount = 0;
    /* 轮询基线：同期次已存在行时记录其 id+created_at（重生成 ON CONFLICT 更新 id 不变、created_at 变） */
    s._genBase = null;
    s.list.forEach(function (x) {
      if (String(x.period) === period && (!s._genBase || x.id > s._genBase.id)) s._genBase = { id: x.id, created_at: String(x.created_at || '') };
    });
    setGenUI(freq, true, '装配数据中…');
    toast('⏳ 开始生成 ' + PB._periodCn(period) + F.n + '（真实数据装配 + LLM 研判 + 公文渲染，约 1-3 分钟）');
    PB._api('POST', '/generate', { type: PB._type, freq: freq, period: period }, 300000).then(function (r) {
      if (r.ok && r.data && r.data.ok) {
        finishGen(freq, true, '✅ ' + PB._periodCn(period) + F.n + '已生成（含公文版）');
        loadList(freq, function () {
          var row = null;
          s.list.forEach(function (x) { if (String(x.period) === period && (!row || x.id > row.id)) row = x; });
          if (row) loadDetail(freq, row.id);
        });
      } else if (r.status === 429) {
        /* 服务端已有同类型生成进行中 → 轮询等待其产出 */
        toast('⏳ 服务端已有生成任务进行中，转为轮询等待…');
        pollForPeriod(freq, period);
      } else {
        finishGen(freq, false, '⚠️ 生成失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
      }
    });
  }

  function pollForPeriod(freq, period) {
    var s = PB._st(freq);
    if (s.pollTimer) { clearTimeout(s.pollTimer); s.pollTimer = null; }
    s.pollCount++;
    if (s.pollCount > 20) { /* 20×15s=5min */
      finishGen(freq, false, '⚠️ 生成超时（5 分钟），请稍后刷新期次列表查看');
      return;
    }
    setGenUI(freq, true, '生成中…（' + (s.pollCount * 15) + 's）');
    s.pollTimer = setTimeout(function () {
      PB._api('GET', '/list?type=' + PB._type + '&limit=100').then(function (r) {
        if (r.ok && r.data && r.data.ok) {
          var found = null;
          (r.data.list || []).forEach(function (x) {
            if (String(x.period) === period && PB.FREQS[freq].re.test(String(x.period))) {
              if (!found || x.id > found.id) found = x;
            }
          });
          if (found && (!s._genBase || found.id > s._genBase.id || String(found.created_at || '') !== s._genBase.created_at)) {
            s.list = r.data.list || [];
            PB._renderList(freq);
            finishGen(freq, true, '✅ ' + PB._periodCn(period) + PB.FREQS[freq].n + '已生成');
            loadDetail(freq, found.id);
            return;
          }
        }
        pollForPeriod(freq, period);
      });
    }, 15000);
  }

  function finishGen(freq, ok, msg) {
    var s = PB._st(freq);
    s.generating = false;
    if (s.pollTimer) { clearTimeout(s.pollTimer); s.pollTimer = null; }
    setGenUI(freq, false);
    toast(msg);
  }

  PB._renderReader = renderReader;
  PB._docHTML = docHTML;
  PB._loadList = loadList;
  PB.loadDetail = loadDetail;
  PB.generate = generate;
})();

/* ============================================================
 * 第四部分：导出（PDF=iframe 打印 / Word=.doc Blob）+ 入口 render(freq)
 * ============================================================ */
(function () {
  'use strict';
  var PB = window.PERIOD_BRIEFS;
  var toast = PB._toast;
  PB._type = 'situation-brief';

  function govContent(freq) {
    var s = PB._st(freq);
    if (!s.detail || !s.detail.gov_html) return null;
    var raw = String(s.detail.gov_html);
    /* gov_html 完整文档时抽出 body 内容（导出统一套 @page 版式） */
    var m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw);
    return m ? m[1] : raw;
  }
  function fileName(freq) {
    var s = PB._st(freq);
    var t = (s.detail && s.detail.title) ? s.detail.title : ('海外利益安全' + PB.FREQS[freq].n);
    var p = (s.detail && s.detail.period) ? s.detail.period : '';
    return String(t).replace(/[\\/:*?"<>|]/g, '') + '_' + p;
  }

  PB.exportPDF = function (freq) {
    var content = govContent(freq);
    if (!content) { toast('⚠️ 无公文版内容可导出（请先生成或选择一期）'); return; }
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title></title>'
      + '<style>@page{size:A4;margin:3.7cm 2.6cm 3.5cm 2.8cm;}'
      + 'html,body{margin:0;padding:0;background:#fff;}'
      + '.rgp-paper,.drg-paper{width:auto !important;max-width:none !important;margin:0 !important;padding:0 !important;box-shadow:none !important;background:#fff !important;}'
      + '</style></head><body>' + content + '</body></html>';
    var oldTitle = document.title;
    document.title = ' ';
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden;';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(doc); f.contentDocument.close();
    toast('🖨️ 已调起打印对话框：目标选「另存为 PDF」；⚠️ 请在「更多设置」中取消勾选「页眉和页脚」+「页码」以消除浏览器自动注入的 URL/日期');
    setTimeout(function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('⚠️ 打印调起失败：' + e.message); }
      setTimeout(function () { try { document.title = oldTitle; } catch (e) {} f.remove(); }, 6000);
    }, 400);
  };

  PB.exportWord = function (freq) {
    var content = govContent(freq);
    if (!content) { toast('⚠️ 无公文版内容可导出（请先生成或选择一期）'); return; }
    var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
      + '<head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><meta name="Generator" content="Microsoft Word 15">'
      + '<title>' + fileName(freq) + '</title>'
      + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
      + '<style>@page WordSection1{size:595.3pt 841.9pt;margin:104.9pt 73.7pt 99.2pt 79.4pt;mso-page-orientation:portrait;}'
      + 'div.WordSection1{page:WordSection1;}'
      + 'body{margin:0;background:#fff;}'
      + '.rgp-paper,.drg-paper{width:auto !important;max-width:none !important;margin:0 !important;padding:0 !important;box-shadow:none !important;background:#fff !important;}'
      + '</style></head><body><div class="WordSection1">' + content + '</div></body></html>';
    var blob = new Blob(['﻿' + doc], { type: 'application/msword;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName(freq) + '.doc';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    toast('📄 Word 文档已开始下载（.doc，离线自包含，可用 Word/WPS 打开编辑）');
  };

  /* ===== 入口：runViewInit 调用（幂等） ===== */
  PB.render = function (freq) {
    if (!PB.FREQS[freq]) return;
    PB._ensureCss();
    var s = PB._st(freq);
    if (!s.rendered) {
      if (!PB._renderShell(freq)) return;
      s.rendered = true;
    }
    PB._renderReader(freq);
    PB._loadList(freq, function () {
      /* 默认打开最新一期（若有） */
      var F = PB.FREQS[freq];
      if (!s.detail) {
        var rows = s.list.filter(function (r) { return F.re.test(String(r.period || '')); });
        if (rows.length) PB.loadDetail(freq, rows[0].id);
      }
    });
  };
})();
