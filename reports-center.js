/**
 * reports-center.js — 智库报告中心（9 类专业分析报告 · 浏览 / 生成 / 修订 / 导出）
 * ================================================================
 * 布局（深空蓝黑 HUD 情报指挥中心风格）：
 *   左侧  报告类型导航（9 张类型卡：名称 / 频率徽标 / 最近一期 / 当期生成状态点）
 *   主区  报告阅读器（工具条 + sandbox iframe：标准版 html / 公文版 gov_html）
 *   右侧  期次历史列表 + 结构化摘要面板
 * API 契约（后端 reports 模块）：
 *   GET  /api/reports/products/types           → {ok, types:[{id,name,freq,desc,lastPeriod,lastAt}]}
 *   POST /api/reports/products/generate        → {ok, id}；进行中重复请求 429
 *   GET  /api/reports/products/list?type=&limit=20 → {ok, list:[{id,rtype,period,title,created_at,summary}]}
 *   GET  /api/reports/products/detail/:id      → {ok, id, rtype, period, title, html, gov_html, summary, llm_model, created_at}
 *   PUT  /api/reports/products/detail/:id     → {html?, gov_html?} 人工修订保存
 * 生成轮询：POST 成功后 15s 起每 15s 查 list，新期出现即加载；LLM 最长 3 分钟，总超时 5 分钟报错。
 * 注册：index.html data-view="reportsc" + #view-reportsc 容器 + 本脚本（app.js 之后、linkgraph.js 之前）
 *       + app.js VIEW_MAP['reportsc'] / runViewInit('reportsc') + role-ui.js VIEW_LABELS。
 * 铁律：API 失败优雅降级（"报告服务初始化中"空态，不白屏不报错）；零模拟数据。
 */
(function () {
  'use strict';

  /* ===== 9 类报告静态配置（类型卡降级展示 + 徽标渲染辅助，与服务端 types 对齐） ===== */
  var TYPES = [
    { id: 'situation-brief', name: '综合态势简报', freq: 'daily', ic: '📋', desc: '全库综合态势：红橙预警/涉华要情/国别热点/伤亡事件归集。可选 每日/每周/每月/年度 生成，均支持公文版导出。' },
    { id: 'cn-negative-weekly', name: '涉华负面情报', freq: 'weekly', ic: '🇨🇳', desc: '聚合全球涉华负面情报动态（安全事件、舆情发酵、经贸摩擦），按所选周期汇总涉华负面信号并给出等级研判与建议。' },
    { id: 'country-risk-monthly', name: '国别风险评估', freq: 'monthly', ic: '🌏', desc: '重点国家 / 地区政治、安全、社会、经济四维风险综合评估，含风险值变化、趋势研判与周期展望。' },
    { id: 'project-exposure-quarterly', name: '中资项目安全暴露分析', freq: 'quarterly', ic: '🏗️', desc: '海外中资重点项目安全暴露面、所在国威胁态势、安保薄弱环节与防护建议分析。' },
    { id: 'threat-org-quarterly', name: '威胁组织活动评估', freq: 'quarterly', ic: '🎯', desc: '重点威胁组织活动能力、袭击偏好、势力演变与对中资目标威胁评估。' },
    { id: 'chokepoint-monthly', name: '海上咽喉要道评估', freq: 'monthly', ic: '⚓', desc: '霍尔木兹 / 曼德 / 马六甲等海上咽喉要道安全态势、航运风险与绕行方案分析。' },
    { id: 'sanction-compliance-monthly', name: '制裁合规动态分析', freq: 'monthly', ic: '⚖️', desc: '国际制裁措施动态、涉华合规风险点与中资企业应对建议的月度分析。' },
    { id: 'anomaly-daily', name: '风险异动信号日报', freq: 'daily', ic: '📊', desc: '当日全库风险异动信号聚合、分级研判与重点关注提示。' },
    { id: 'conflict-spillover-weekly', name: '热点冲突外溢专报', freq: 'weekly', ic: '💥', desc: '热点冲突外溢效应、周边次生风险与中资利益影响评估专报。' },
    { id: 'model-export', name: '专题分析模型报告', freq: 'manual', ic: '🧮', desc: '专题分析模型成果报告（组织行为 / 恐袭预测 / 绑架风险 / 地缘风险），仅手动生成。' }
  ];

  /* 频率徽标：中文 + 主色 + 「当期」判定窗口（天）——2026-09-03 #528：六频全周期体系（与后端 FREQ_ALL 对齐） */
  var FREQ = {
    daily:      { n: '每日', c: '#00ff9f', win: 1 },
    weekly:     { n: '每周', c: '#00d4ff', win: 7 },
    monthly:    { n: '每月', c: '#ffcc00', win: 31 },
    quarterly:  { n: '每季', c: '#ff8800', win: 92 },
    semiannual: { n: '每半年', c: '#ff5f9e', win: 183 },
    yearly:     { n: '每年', c: '#b366ff', win: 366 },
    manual:     { n: '手动', c: '#b366ff', win: 0 }
  };

  /* ===== 状态 ===== */
  var S = {
    inited: false, cssInited: false,
    svcDown: false,          /* 报告服务不可用（types 拉取失败） */
    types: [],               /* 合并后的类型列表 */
    cur: null,               /* 当前选中类型 id */
    list: [],                /* 当前类型的期次列表 */
    listLoading: false,
    detail: null,            /* 当前阅读的报告详情 */
    detailLoading: false,
    ver: 'std',              /* std=标准版 html / gov=公文版 gov_html */
    generating: false,       /* 生成中（本地状态机） */
    genType: null, genId: null,
    genFreq: null,           /* #528：本次生成所选周期（null=按类型默认） */
    pollTimer: null, tickTimer: null,
    pollStart: 0, pollBase: null
  };

  /* ===== 工具 ===== */
  function $(id) { return document.getElementById(id); }
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(msg) { try { showToast(msg); } catch (e) { console.log('[REPORTS]', msg); } }
  function _token() { try { return (typeof APIClient !== 'undefined' && APIClient.getToken()) || ''; } catch (e) { return ''; } }
  function fmtTs(t) { try { return String(t || '').replace('T', ' ').slice(0, 16); } catch (e) { return ''; } }
  function enc(x) { return encodeURIComponent(x); }
  function typeOf(id) { for (var i = 0; i < S.types.length; i++) if (S.types[i].id === id) return S.types[i]; return null; }
  function freqOf(t) { return FREQ[(t && t.freq) || 'manual'] || FREQ.manual; }

  /* API 封装（仿 manual-entry.js：需拿 429 等原始状态码，不走 APIClient._fetch）
   * 2026-09-05 挂起防护：fetch 无超时曾致 /list 在服务端繁忙时挂起 200+s，
   * S.listLoading 永不清除 → 阅读区卡死"期次列表加载中…"（实测复现）。AbortController
   * 兜底：常规 30s / 生成类同步长任务由调用方传 300s；超时按网络异常结算，UI 状态必然回落。 */
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

  /* ===== HUD 样式注入（深空蓝黑 · 一次性） ===== */
  var CSS = [
    '.rc-wrap{display:grid;grid-template-columns:236px minmax(0,1fr) 300px;gap:10px;padding:10px 12px 16px;height:calc(100vh - 56px);box-sizing:border-box;position:relative;z-index:2;',
    ' background:radial-gradient(1100px 480px at 72% -12%,rgba(0,120,255,0.07),transparent 60%),radial-gradient(800px 380px at 8% 112%,rgba(0,212,255,0.05),transparent 60%);}',
    '.rc-card{background:linear-gradient(160deg,rgba(10,22,40,0.92),rgba(6,14,28,0.96));border:1px solid rgba(0,212,255,0.16);border-radius:8px;position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:0;}',
    '.rc-card:before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,0.55),transparent);pointer-events:none;}',
    '.rc-ptt{font-size:13px;font-weight:700;color:#9fe8ff;letter-spacing:1px;padding:10px 12px 6px;display:flex;align-items:center;gap:7px;flex:none;text-shadow:0 0 12px rgba(0,212,255,0.35);}',
    '.rc-ptt .rc-dot{width:7px;height:7px;border-radius:50%;background:#00d4ff;box-shadow:0 0 8px #00d4ff;flex:none;}',
    /* —— 左侧类型导航 —— */
    '.rc-nav{overflow-y:auto;padding:4px 0 10px;}',
    '.rc-svc-banner{margin:6px 10px 8px;padding:8px 10px;border:1px solid rgba(255,204,0,0.35);background:rgba(255,204,0,0.06);border-radius:6px;font-size:11px;color:var(--yellow);line-height:1.6;}',
    '.rc-tcard{margin:3px 10px;padding:9px 11px;border-radius:7px;cursor:pointer;border:1px solid rgba(0,212,255,0.10);background:rgba(0,212,255,0.02);transition:all .18s;}',
    '.rc-tcard:hover{border-color:rgba(0,212,255,0.4);background:rgba(0,212,255,0.06);}',
    '.rc-tcard.on{border-color:rgba(0,212,255,0.45);background:linear-gradient(90deg,rgba(0,212,255,0.13),rgba(0,212,255,0.02));box-shadow:inset 2px 0 0 #00d4ff,0 0 14px rgba(0,212,255,0.12);}',
    '.rc-trow{display:flex;align-items:center;gap:7px;}',
    '.rc-trow .nm{font-size:12.5px;font-weight:700;color:var(--text);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.rc-tcard.on .rc-trow .nm{color:#00e5ff;}',
    '.rc-fb{font-size:9px;padding:1px 7px;border-radius:8px;border:1px solid currentColor;flex:none;letter-spacing:1px;}',
    '.rc-tmeta{margin-top:6px;display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text3);min-height:14px;}',
    '.rc-stdot{width:7px;height:7px;border-radius:50%;flex:none;background:#3a4a62;box-shadow:0 0 0 rgba(0,0,0,0);}',
    '.rc-stdot.on{background:#00ff9f;box-shadow:0 0 7px rgba(0,255,159,0.75);}',
    '.rc-stdot.gen{background:#ffcc00;box-shadow:0 0 7px rgba(255,204,0,0.8);animation:rc-blink 1s ease-in-out infinite;}',
    '@keyframes rc-blink{50%{opacity:.25}}',
    /* —— 主区阅读器 —— */
    '.rc-main{min-width:0;}',
    '.rc-toolbar{padding:10px 14px 9px;border-bottom:1px solid rgba(0,212,255,0.12);flex:none;}',
    '.rc-tb-row1{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
    '.rc-tb-title{font-size:15px;font-weight:800;color:#cfe9ff;letter-spacing:.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
    '.rc-badge{font-size:10px;padding:2px 9px;border-radius:9px;border:1px solid rgba(0,212,255,0.3);background:rgba(0,212,255,0.07);color:#00e5ff;flex:none;letter-spacing:1px;}',
    '.rc-badge.llm{border-color:rgba(179,102,255,0.45);background:rgba(179,102,255,0.1);color:#d0a5ff;}',
    '.rc-badge.time{border-color:rgba(122,139,163,0.35);background:rgba(122,139,163,0.08);color:var(--text2);letter-spacing:0;}',
    '.rc-tb-row2{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;}',
    '.rc-btn{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid rgba(0,212,255,0.35);color:#00e5ff;background:rgba(0,212,255,0.08);transition:all .18s;letter-spacing:1px;white-space:nowrap;}',
    '.rc-btn:hover{background:rgba(0,212,255,0.18);box-shadow:0 0 10px rgba(0,212,255,0.25);}',
    '.rc-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}',
    '.rc-btn.primary{background:linear-gradient(135deg,rgba(0,212,255,0.25),rgba(0,102,255,0.18));border-color:rgba(0,212,255,0.55);font-weight:700;}',
    '.rc-btn.warn{border-color:rgba(255,136,0,0.45);background:rgba(255,136,0,0.1);color:#ffbb66;}',
    '.rc-btn.ghost{border-color:rgba(122,139,163,0.3);background:transparent;color:var(--text2);}',
    '.rc-btn.busy{pointer-events:none;color:var(--yellow);border-color:rgba(255,204,0,0.4);background:rgba(255,204,0,0.07);}',
    '.rc-spin{width:12px;height:12px;border:2px solid rgba(255,204,0,0.25);border-top-color:#ffcc00;border-radius:50%;animation:rc-rot .8s linear infinite;flex:none;}',
    '@keyframes rc-rot{to{transform:rotate(360deg)}}',
    '.rc-seg{display:inline-flex;border:1px solid rgba(0,212,255,0.25);border-radius:6px;overflow:hidden;flex:none;}',
    '.rc-seg button{font-size:11px;padding:6px 13px;background:transparent;border:none;color:var(--text2);cursor:pointer;letter-spacing:1px;transition:all .15s;}',
    '.rc-seg button.on{background:rgba(0,212,255,0.16);color:#00e5ff;font-weight:700;}',
    '.rc-seg button:disabled{opacity:.35;cursor:not-allowed;}',
    '.rc-genstate{font-size:10.5px;color:var(--yellow);letter-spacing:0;}',
    /* —— 阅读区 —— */
    '.rc-reader{flex:1;min-height:0;position:relative;background:rgba(4,10,22,0.55);}',
    '.rc-frame{width:100%;height:100%;border:none;background:#fff;display:block;}',
    '.rc-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:30px;text-align:center;}',
    '.rc-state .big{font-size:15px;color:var(--text2);line-height:1.8;max-width:560px;}',
    '.rc-state .ic{font-size:44px;filter:drop-shadow(0 0 18px rgba(0,212,255,0.4));}',
    '.rc-go{font-size:13px;font-weight:700;letter-spacing:2px;padding:12px 34px;border-radius:8px;cursor:pointer;border:1px solid rgba(0,212,255,0.55);color:#00131f;background:linear-gradient(135deg,#00d4ff,#0090ff);box-shadow:0 0 22px rgba(0,212,255,0.35);transition:all .2s;}',
    '.rc-go:hover{transform:translateY(-1px);box-shadow:0 0 30px rgba(0,212,255,0.55);}',
    '.rc-dim{font-size:11px;color:var(--text3);line-height:1.7;}',
    /* —— 右侧栏 —— */
    '.rc-side{display:flex;flex-direction:column;gap:10px;min-height:0;}',
    '.rc-hlist{overflow-y:auto;padding:2px 8px 10px;flex:1;min-height:120px;}',
    '.rc-hitem{padding:8px 10px;margin:4px 2px;border-radius:6px;cursor:pointer;border:1px solid rgba(0,212,255,0.08);background:rgba(0,212,255,0.02);transition:all .15s;}',
    '.rc-hitem:hover{border-color:rgba(0,212,255,0.35);}',
    '.rc-hitem.on{border-color:rgba(0,212,255,0.5);background:rgba(0,212,255,0.1);box-shadow:inset 2px 0 0 #00d4ff;}',
    '.rc-h-per{font-size:11px;font-weight:800;color:#00e5ff;letter-spacing:1px;}',
    '.rc-h-tt{font-size:11.5px;color:var(--text);margin-top:3px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    '.rc-h-time{font-size:9.5px;color:var(--text3);margin-top:3px;}',
    '.rc-summary{overflow-y:auto;padding:2px 12px 12px;flex:1;min-height:100px;}',
    '.rc-kpi{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;}',
    '.rc-kv{background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.14);border-radius:6px;padding:7px 9px;min-width:0;}',
    '.rc-kv .v{font-size:17px;font-weight:800;line-height:1.2;}',
    '.rc-kv .k{font-size:9.5px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.rc-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(0,212,255,0.08);font-size:11.5px;}',
    '.rc-row .k{color:var(--text2);white-space:nowrap;}',
    '.rc-row .v{color:var(--text);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;}',
    '.rc-sm-grp{font-size:10.5px;font-weight:700;color:#9fe8ff;letter-spacing:1px;margin:9px 0 4px;padding-left:7px;border-left:2px solid rgba(0,212,255,0.45);}',
    '.rc-sm-txt{font-size:11.5px;color:var(--text2);line-height:1.8;}',
    /* —— 修订弹层 —— */
    '.rc-mask{position:fixed;inset:0;background:rgba(2,6,14,0.78);backdrop-filter:blur(4px);z-index:9998;display:none;align-items:center;justify-content:center;}',
    '.rc-mask.show{display:flex;}',
    '.rc-editbox{width:min(880px,92vw);max-height:86vh;display:flex;flex-direction:column;background:linear-gradient(160deg,rgba(10,22,40,0.97),rgba(6,14,28,0.98));border:1px solid rgba(0,212,255,0.3);border-radius:10px;overflow:hidden;}',
    '.rc-editbox .hd{padding:12px 16px;border-bottom:1px solid rgba(0,212,255,0.15);font-size:13px;font-weight:700;color:#9fe8ff;display:flex;align-items:center;gap:8px;}',
    '.rc-editbox .bd{padding:12px 16px;overflow-y:auto;flex:1;min-height:0;}',
    '.rc-ta{width:100%;height:46vh;background:#08101e;border:1px solid rgba(0,212,255,0.25);border-radius:8px;color:#cfe0f5;font:12px/1.6 Consolas,monospace;padding:12px;box-sizing:border-box;outline:none;resize:vertical;}',
    '.rc-ta:focus{border-color:var(--cyan);}',
    '.rc-editbox .ft{padding:10px 16px;border-top:1px solid rgba(0,212,255,0.15);display:flex;gap:10px;align-items:center;}',
    /* —— 周期选择器（#528 六频） —— */
    '.rc-sel{background:rgba(8,16,32,0.9);border:1px solid rgba(0,212,255,0.35);border-radius:6px;color:#00e5ff;font-size:11.5px;padding:6px 10px;cursor:pointer;outline:none;letter-spacing:1px;}',
    '.rc-sel option{background:#0a1628;color:#cfe0f5;}',
    /* —— 专题选题弹窗（#533 交互选题矩阵） —— */
    '.rc-optbox{width:min(720px,94vw);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(160deg,rgba(10,22,40,0.97),rgba(6,14,28,0.98));border:1px solid rgba(0,212,255,0.3);border-radius:10px;overflow:hidden;}',
    '.rc-optbox .bd{padding:14px 18px;overflow-y:auto;flex:1;min-height:0;}',
    '.rc-optbox .ft{padding:10px 18px;border-top:1px solid rgba(0,212,255,0.15);display:flex;gap:10px;align-items:center;}',
    '.rc-ogrp{font-size:12px;font-weight:700;color:#9fe8ff;letter-spacing:1px;margin:12px 0 6px;padding-left:7px;border-left:2px solid rgba(0,212,255,0.45);}',
    '.rc-ogrp:first-child{margin-top:0;}',
    '.rc-ogrp small{color:var(--text3);font-weight:400;letter-spacing:0;margin-left:6px;}',
    '.rc-ckgrid{display:flex;flex-wrap:wrap;gap:6px;}',
    '.rc-ck{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text);padding:5px 11px;border-radius:6px;border:1px solid rgba(0,212,255,0.18);background:rgba(0,212,255,0.03);cursor:pointer;transition:all .15s;user-select:none;}',
    '.rc-ck:hover{border-color:rgba(0,212,255,0.45);}',
    '.rc-ck.on{border-color:rgba(0,212,255,0.6);background:rgba(0,212,255,0.14);color:#00e5ff;box-shadow:0 0 8px rgba(0,212,255,0.18);}',
    '.rc-ck .bx{font-size:11px;color:var(--text3);}',
    '.rc-ck.on .bx{color:#00ff9f;}',
    '.rc-cksmall{font-size:10.5px;padding:4px 9px;}',
    '.rc-cgwrap{max-height:168px;overflow-y:auto;border:1px solid rgba(0,212,255,0.14);border-radius:7px;padding:8px;background:rgba(0,212,255,0.02);}',
    '.rc-cgwrap .rc-ckgrid{gap:5px;}',
    '.rc-tin{width:100%;box-sizing:border-box;background:#08101e;border:1px solid rgba(0,212,255,0.25);border-radius:7px;color:#cfe0f5;font:12px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;padding:8px 11px;outline:none;}',
    '.rc-tin:focus{border-color:var(--cyan);}',
    '.rc-opt-tip{font-size:10.5px;color:var(--text3);line-height:1.7;margin-top:10px;border-top:1px dashed rgba(0,212,255,0.14);padding-top:8px;}',
    /* —— 响应式 —— */
    '@media(max-width:1200px){.rc-wrap{grid-template-columns:200px minmax(0,1fr) 260px;}}',
    '@media(max-width:1000px){.rc-wrap{grid-template-columns:1fr;height:auto;}.rc-nav{max-height:220px;}.rc-side{flex-direction:row;}.rc-side .rc-card{flex:1;}.rc-hlist,.rc-summary{max-height:200px;}.rc-reader{min-height:520px;}}',
    /* —— 打印（兜底路径；主路径为 iframe contentWindow.print） —— */
    '@media print{.rc-no-print{display:none!important}.rc-wrap{height:auto!important}.rc-reader{position:static!important;min-height:0!important}.rc-frame{height:auto!important;min-height:60vh}}'
  ].join('\n');

  /* ===== 入口 ===== */
  function render() {
    var host = $('reportsc-root');
    if (!host) return;
    if (!S.cssInited) {
      var st = document.createElement('style');
      st.id = 'rc-style';
      st.textContent = CSS;
      document.head.appendChild(st);
      S.cssInited = true;
    }
    if (!S.inited) {
      host.innerHTML =
        '<div class="rc-wrap">' +
          '<aside class="rc-card rc-nav" id="rc-nav"></aside>' +
          '<section class="rc-card rc-main">' +
            '<div class="rc-toolbar" id="rc-toolbar"></div>' +
            '<div class="rc-reader" id="rc-reader"></div>' +
          '</section>' +
          '<aside class="rc-side">' +
            '<div class="rc-card" style="flex:1.15"><div class="rc-ptt"><span class="rc-dot"></span>📚 期次历史</div><div class="rc-hlist" id="rc-history"></div></div>' +
            '<div class="rc-card" style="flex:1"><div class="rc-ptt"><span class="rc-dot"></span>🧠 结构化摘要</div><div class="rc-summary" id="rc-summary"></div></div>' +
          '</aside>' +
        '</div>' +
        '<div class="rc-mask" id="rc-edit-mask">' +
          '<div class="rc-editbox">' +
            '<div class="hd">✏️ 人工修订 · <span id="rc-edit-tt"></span><span style="margin-left:auto;cursor:pointer;color:var(--text3);font-weight:400" data-act="edit-close">✕ 关闭</span></div>' +
            '<div class="bd"><div class="rc-dim" style="margin-bottom:8px">直接修订当前版本的 HTML 源码（标准版保存至 html 字段 / 公文版保存至 gov_html 字段），保存后立即生效。</div>' +
            '<textarea class="rc-ta" id="rc-edit-ta" spellcheck="false"></textarea></div>' +
            '<div class="ft"><button class="rc-btn primary" data-act="edit-save">💾 保存修订</button><span class="rc-dim" id="rc-edit-tip"></span></div>' +
          '</div>' +
        '</div>' +
        /* #533 专题分析模型报告 · 交互选题弹窗 */
        '<div class="rc-mask" id="rc-topic-mask">' +
          '<div class="rc-optbox">' +
            '<div class="hd">🧮 专题分析模型报告 · 交互选题<button class="rc-btn ghost rc-no-print" data-act="topic-close" style="margin-left:auto;padding:4px 12px">✕ 关闭</button></div>' +
            '<div class="bd" id="rc-topic-body"></div>' +
            '<div class="ft"><button class="rc-btn primary" data-act="topic-go">⚡ 按选题生成深度报告</button><span class="rc-dim" id="rc-topic-tip">生成约 2–4 分钟（900–1400 字深度分析 · 七维模型矩阵）</span></div>' +
          '</div>' +
        '</div>';
      bindShell();
      S.inited = true;
      renderNav();
      renderToolbar();
      renderReader();
      renderHistory();
      renderSummary();
      loadTypes();
    } else {
      renderNav(); renderToolbar(); renderReader(); renderHistory(); renderSummary();
    }
  }

  /* ===== 外壳事件（委托绑定一次） ===== */
  function bindShell() {
    var nav = $('rc-nav');
    if (nav) nav.addEventListener('click', function (ev) {
      var card = ev.target && ev.target.closest ? ev.target.closest('.rc-tcard') : null;
      if (card) { selectType(card.getAttribute('data-t')); return; }
      if (ev.target && ev.target.closest && ev.target.closest('[data-act="retry-types"]')) loadTypes(true);
    });
    var tb = $('rc-toolbar');
    if (tb) tb.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'gen') generate(false);
      else if (act === 'regen') generate(true);
      else if (act === 'print') printReport();
      else if (act === 'edit') openEdit();
      else if (act === 'ver-std') setVer('std');
      else if (act === 'ver-gov') setVer('gov');
    });
    var hist = $('rc-history');
    if (hist) hist.addEventListener('click', function (ev) {
      var it = ev.target && ev.target.closest ? ev.target.closest('.rc-hitem') : null;
      if (it) loadDetail(it.getAttribute('data-id'));
    });
    var reader = $('rc-reader');
    if (reader) reader.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (b && b.getAttribute('data-act') === 'gen-empty') generate(false);
      else if (b && b.getAttribute('data-act') === 'retry-list') loadList();
    });
    var mask = $('rc-edit-mask');
    if (mask) {
      mask.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (b && b.getAttribute('data-act') === 'edit-close') closeEdit();
        if (b && b.getAttribute('data-act') === 'edit-save') saveEdit();
        if (ev.target === mask) closeEdit();
      });
    }
    /* #528：周期选择器 change 事件（委托到工具条容器） */
    tb.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'rc-freq') {
        S.genFreq = ev.target.value || null;
      }
    });
    /* #533：专题选题弹窗（按钮 + 选项卡切换委托） */
    var tmask = $('rc-topic-mask');
    if (tmask) {
      tmask.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'topic-close') closeTopic();
        else if (act === 'topic-go') submitTopic();
        else if (act === 'ck') { b.classList.toggle('on'); }
        else if (act === 'ck-all') {
          var wrap = b.closest('.rc-cgwrap');
          if (wrap) {
            var cks = wrap.querySelectorAll('.rc-ck[data-act="ck"]');
            var allOn = true;
            for (var i = 0; i < cks.length; i++) if (!cks[i].classList.contains('on')) { allOn = false; break; }
            for (var j = 0; j < cks.length; j++) cks[j].classList.toggle('on', !allOn);
          }
        }
        if (ev.target === tmask) closeTopic();
      });
    }
  }

  /* ===== 类型加载 ===== */
  function loadTypes(retry) {
    if (!retry) renderNavLoading();
    api('GET', '/types').then(function (r) {
      var server = (r.ok && r.data && r.data.types) ? r.data.types : null;
      if (!server) {
        S.svcDown = true;
        S.types = TYPES.map(function (t) { return Object.assign({}, t, { lastPeriod: null, lastAt: null }); });
        if (!S.cur && S.types.length) S.cur = S.types[0].id;
        renderNav(); renderToolbar(); renderReader(); renderHistory(); renderSummary();
        loadList(); /* list 也会失败 → 阅读区显示服务初始化中空态 */
        return;
      }
      S.svcDown = false;
      var byId = {};
      server.forEach(function (t) { if (t && t.id) byId[t.id] = t; });
      /* 静态顺序为骨架，服务端字段覆盖；服务端新增类型追加到末尾 */
      S.types = TYPES.map(function (t) {
        var sv = byId[t.id] || {};
        delete byId[t.id];
        return {
          id: t.id, ic: t.ic, freq: sv.freq || t.freq,
          name: sv.name || t.name, desc: sv.desc || t.desc,
          lastPeriod: sv.lastPeriod || null, lastAt: sv.lastAt || null
        };
      });
      Object.keys(byId).forEach(function (k) {
        var sv = byId[k];
        S.types.push({ id: k, ic: '📄', freq: sv.freq || 'manual', name: sv.name || k, desc: sv.desc || '', lastPeriod: sv.lastPeriod || null, lastAt: sv.lastAt || null });
      });
      if (!S.cur && S.types.length) S.cur = S.types[0].id;
      renderNav(); renderToolbar(); renderReader();
      loadList();
    });
  }

  /* ===== 类型导航 ===== */
  function renderNavLoading() {
    var el = $('rc-nav');
    if (el) el.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text3);font-size:11px">报告类型加载中…</div>';
  }

  function curPeriodDone(t) {
    if (!t || !t.lastAt) return false;
    if (t.freq === 'manual') return true;
    var win = freqOf(t).win || 31;
    var d = new Date(String(t.lastAt).replace(' ', 'T'));
    if (isNaN(d.getTime())) return !!t.lastAt;
    return (Date.now() - d.getTime()) < win * 86400000;
  }

  function renderNav() {
    var el = $('rc-nav');
    if (!el) return;
    var html = '';
    if (S.svcDown) {
      html += '<div class="rc-svc-banner">⚠️ 报告服务初始化中——后端报告接口暂不可用，当前展示 9 类报告类型预览。生成与读取将在服务就绪后自动可用。<span data-act="retry-types" style="color:var(--cyan);cursor:pointer;text-decoration:underline">重试</span></div>';
    }
    html += '<div class="rc-ptt" style="padding-left:12px"><span class="rc-dot"></span>报告产品线</div>';
    if (!S.types.length) {
      html += '<div style="padding:14px;color:var(--text3);font-size:11px">暂无报告类型。</div>';
    }
    S.types.forEach(function (t) {
      var dot = S.generating && S.genType === t.id ? 'gen' : (curPeriodDone(t) ? 'on' : '');
      var dotTitle = dot === 'gen' ? '生成中' : dot === 'on' ? '当期已生成' : '当期未生成';
      var meta = t.lastAt
        ? '<span class="rc-stdot ' + dot + '" title="' + dotTitle + '"></span><span>最近：' + esc(t.lastPeriod || '—') + ' · ' + esc(fmtTs(t.lastAt)) + '</span>'
        : '<span class="rc-stdot ' + dot + '" title="' + dotTitle + '"></span><span>尚未生成</span>';
      html += '<div class="rc-tcard' + (S.cur === t.id ? ' on' : '') + '" data-t="' + esc(t.id) + '" title="' + esc(t.desc || t.name) + '">' +
        '<div class="rc-trow"><span>' + (t.ic || '📄') + '</span><span class="nm">' + esc(t.name) + '</span></div>' +
        '<div class="rc-tmeta">' + meta + '</div>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function selectType(id) {
    if (!id || S.cur === id) return;
    S.cur = id; S.detail = null; S.list = []; S.ver = 'std'; S.genFreq = null;
    renderNav(); renderToolbar(); renderHistory(); renderSummary();
    loadList();
  }

  /* ===== 期次列表 ===== */
  function loadList() {
    if (!S.cur) return;
    S.listLoading = true;
    renderReader(); renderHistory();
    api('GET', '/list?type=' + enc(S.cur) + '&limit=20').then(function (r) {
      S.listLoading = false;
      if (r.ok && r.data && r.data.list) {
        S.list = r.data.list;
        renderHistory();
        /* 自动打开最新一期（当前无详情或详情不属于此类型时） */
        if (S.list.length && (!S.detail || S.detail.rtype !== S.cur)) loadDetail(S.list[0].id, true);
        else if (!S.list.length) renderReader();
      } else {
        S.list = [];
        renderHistory(); renderReader();
      }
    });
  }

  function renderHistory() {
    var el = $('rc-history');
    if (!el) return;
    if (S.listLoading) { el.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:11px">期次加载中…</div>'; return; }
    if (!S.cur) { el.innerHTML = '<div style="padding:12px" class="rc-dim">请选择报告类型。</div>'; return; }
    if (!S.list.length) { el.innerHTML = '<div style="padding:12px" class="rc-dim">暂无历史期次。</div>'; return; }
    el.innerHTML = S.list.map(function (it) {
      return '<div class="rc-hitem' + (S.detail && S.detail.id === it.id ? ' on' : '') + '" data-id="' + esc(it.id) + '">' +
        '<div class="rc-h-per">' + esc(it.period || '—') + '</div>' +
        '<div class="rc-h-tt">' + esc(it.title || '') + '</div>' +
        '<div class="rc-h-time">' + esc(fmtTs(it.created_at)) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ===== 详情加载 ===== */
  function loadDetail(id, silent) {
    if (!id) return;
    S.detailLoading = true; S.detail = null;
    renderReader(); renderHistory();
    api('GET', '/detail/' + enc(id)).then(function (r) {
      S.detailLoading = false;
      if (r.ok && r.data && r.data.id) {
        S.detail = r.data;
        /* 默认版本：优先标准版；无标准版则公文版 */
        S.ver = (S.detail.html && String(S.detail.html).trim()) ? 'std' : 'gov';
      } else if (!silent) {
        toast('报告详情加载失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
      }
      renderToolbar(); renderReader(); renderHistory(); renderSummary();
    });
  }

  /* ===== 工具条 ===== */
  function genBusy() { return S.generating && S.genType === S.cur; }

  function renderToolbar() {
    var el = $('rc-toolbar');
    if (!el) return;
    var t = typeOf(S.cur);
    if (!t) {
      el.innerHTML = '<div class="rc-dim">尚未选择报告类型——请从左侧报告产品线中选择。</div>';
      return;
    }
    var f = freqOf(t);
    var d = S.detail;
    var busy = genBusy();
    var genLabel = t.freq === 'manual' ? '⚙️ 配置选题并生成' : '⚡ 生成当期';
    var regenLabel = '🔄 重新生成';
    /* #528：全周期选择器——任意报告类型可按 日/周/月/季/半年/年 六频生成（manual 类型除外） */
    var freqSel = '';
    if (t.freq !== 'manual' && !S.svcDown) {
      var fopts = ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'];
      freqSel = '<span class="rc-sel-wrap" style="display:inline-flex;align-items:center;gap:5px">' +
        '<span class="rc-dim" style="font-size:10.5px">生成周期</span>' +
        '<select class="rc-sel" id="rc-freq" title="选择本次生成的统计周期（默认按产品线频率）">' +
        '<option value="">按类型默认（' + f.n + '）</option>' +
        fopts.map(function (fk) {
          return '<option value="' + fk + '"' + (S.genFreq === fk ? ' selected' : '') + '>' + FREQ[fk].n + '</option>';
        }).join('') +
        '</select></span>';
    }
    var genBtn = busy
      ? '<button class="rc-btn busy" disabled><span class="rc-spin"></span>' + (t.freq === 'manual' ? '生成中' : '当期生成中') + '</button>'
      : '<button class="rc-btn primary" data-act="gen"' + (S.svcDown ? ' disabled' : '') + '>' + genLabel + '</button>';
    var regenBtn = (busy || !d)
      ? '<button class="rc-btn" data-act="regen" disabled>' + regenLabel + '</button>'
      : '<button class="rc-btn warn" data-act="regen" title="按当前期次 ' + esc(d.period || '') + ' 重新生成">' + regenLabel + '</button>';
    var hasStd = !!(d && d.html && String(d.html).trim());
    var hasGov = !!(d && d.gov_html && String(d.gov_html).trim());
    var seg = '<span class="rc-seg">' +
      '<button data-act="ver-std"' + (S.ver === 'std' ? ' class="on"' : '') + (hasStd ? '' : ' disabled title="该期无标准版"') + '>标准版</button>' +
      '<button data-act="ver-gov"' + (S.ver === 'gov' ? ' class="on"' : '') + (hasGov ? '' : ' disabled title="该期无公文版"') + '>公文版</button>' +
      '</span>';
    var editBtn = d ? '<button class="rc-btn ghost" data-act="edit" title="人工修订当前版本 HTML 源码">✏️ 修订</button>' : '';
    var printBtn = d ? '<button class="rc-btn ghost" data-act="print" title="打印 / 导出（走浏览器打印，公文版自动白底）">🖨️ 打印 / 导出</button>' : '';
    var state = busy ? '<span class="rc-genstate" id="rc-genstate">LLM 撰写中（kimi-k2.7）· 已等待 <span id="rc-elapsed">0</span>s · 最长 5 分钟</span>' : '';
    el.innerHTML =
      '<div class="rc-tb-row1">' +
        '<span style="font-size:16px">' + (t.ic || '📄') + '</span>' +
        '<span class="rc-tb-title">' + esc(d ? (d.title || t.name) : t.name) + '</span>' +
        (d ? '<span class="rc-badge">📅 ' + esc(d.period || '—') + '</span>' : '') +
        (d ? '<span class="rc-badge time">🕐 ' + esc(fmtTs(d.created_at)) + '</span>' : '') +
        '<span class="rc-badge llm" title="本报告由 LLM 生成">🤖 ' + esc((d && d.llm_model) || 'kimi-k2.7') + '</span>' +
      '</div>' +
      '<div class="rc-tb-row2">' +
        freqSel + genBtn + regenBtn + printBtn + editBtn + seg + state +
      '</div>';
  }

  /* ===== 阅读区 ===== */
  function wrapDoc(inner, dark) {
    if (dark) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>body{background:#0d1730;color:#dce6f5;font:14px/1.9 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;padding:26px 32px;margin:0;box-sizing:border-box}' +
        'h1,h2,h3,h4{color:#9fe8ff;line-height:1.4}h1{font-size:21px;border-bottom:1px solid rgba(0,212,255,.25);padding-bottom:10px}' +
        'a{color:#00d4ff}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid rgba(0,212,255,.25);padding:5px 10px;font-size:13px}' +
        'blockquote{border-left:3px solid #00d4ff;padding-left:12px;color:#aab8d0;margin:8px 0}img{max-width:100%}' +
        'hr{border:none;border-top:1px solid rgba(0,212,255,.2)}</style></head><body>' + inner + '</body></html>';
    }
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{background:#fff;color:#1a2333;font:15px/2 "SimSun","Songti SC",serif;padding:40px 56px;margin:0;box-sizing:border-box}' +
      'h1,h2,h3{color:#111;line-height:1.5}table{border-collapse:collapse}td,th{border:1px solid #999;padding:5px 10px}img{max-width:100%}</style></head><body>' + inner + '</body></html>';
  }

  function docHTML(detail, ver) {
    var raw = ver === 'gov' ? detail.gov_html : detail.html;
    if (!raw || !String(raw).trim()) return ver === 'gov' ? wrapDoc('<p style="text-align:center;color:#888">该期无公文版内容。</p>', false) : wrapDoc('<p style="text-align:center;color:#667">该期无标准版内容。</p>', true);
    var s = String(raw);
    if (/<html[\s>]/i.test(s)) return s; /* 已是完整文档则原样呈现 */
    return wrapDoc(s, ver !== 'gov'); /* 标准版深色阅读 / 公文版白底仿宋 */
  }

  function renderReader() {
    var el = $('rc-reader');
    if (!el) return;
    if (!S.cur) {
      el.innerHTML = stateHTML('🗂️', '从左侧选择一类报告产品', '9 类专业分析报告 · 支持周期自动生成 / 人工修订 / 公文版导出');
      return;
    }
    if (S.detailLoading) {
      el.innerHTML = '<div class="rc-state"><span class="rc-spin" style="width:22px;height:22px;border-width:3px"></span><span class="rc-dim">报告内容加载中…</span></div>';
      return;
    }
    /* 2026-09-05：仅无详情可展示时才让"期次加载中"占位——已有报告在后台刷新期次列表
     * 期间必须保持可见（此前列表请求挂起会把已加载报告顶成永久转圈） */
    if (S.listLoading && !S.detail) {
      el.innerHTML = '<div class="rc-state"><span class="rc-spin" style="width:22px;height:22px;border-width:3px"></span><span class="rc-dim">期次列表加载中…</span></div>';
      return;
    }
    if (S.svcDown) {
      el.innerHTML = stateHTML('🛠️', '报告服务初始化中', '后端报告接口暂未就绪。当前为类型预览模式，服务就绪后即可浏览 / 生成 / 导出报告。', '<button class="rc-btn" data-act="retry-list">🔄 重试连接</button>');
      return;
    }
    if (!S.list.length) {
      var t = typeOf(S.cur);
      el.innerHTML = '<div class="rc-state">' +
        '<span class="ic">' + (t && t.ic || '📄') + '</span>' +
        '<div class="big"><b style="color:#9fe8ff">' + esc(t ? t.name : '') + '</b><br>' + esc(t ? (t.desc || '') : '') + '</div>' +
        '<button class="rc-go" data-act="gen-empty">⚡ 生成本期报告</button>' +
        '<span class="rc-dim">支持日报/周报/月报/季报/半年报/年报六频生成 · 尚未生成任何期次 · 生成由 kimi-k2.7 撰写，约 1–3 分钟</span>' +
        '</div>';
      return;
    }
    if (!S.detail) {
      el.innerHTML = stateHTML('📄', '请从右侧期次历史中选择一期', '共 ' + S.list.length + ' 期可浏览');
      return;
    }
    /* iframe 渲染（sandbox 禁脚本；srcdoc 属性赋值避免转义问题） */
    el.innerHTML = '';
    var f = document.createElement('iframe');
    f.className = 'rc-frame';
    f.setAttribute('sandbox', 'allow-same-origin');
    f.setAttribute('title', '报告正文');
    f.srcdoc = docHTML(S.detail, S.ver);
    el.appendChild(f);
    /* 2026-09-05 报告事件行交互：sandbox 禁 iframe 内联脚本，但 allow-same-origin 下父页面可达 DOM——
       由父页面 addEventListener 绑定（父上下文执行，不受 sandbox 限制） */
    f.addEventListener('load', function(){
      try{
        var doc = f.contentDocument; if(!doc) return;
        doc.querySelectorAll('.rp-row[data-tt]').forEach(function(tr){
          tr.addEventListener('click', function(){ RP_showItem(tr); });
        });
      }catch(e){}
    });
  }

  /* ===== 报告事件研判详情弹窗（2026-09-05 复合交互：iframe 内事件行的点击落点，父页面上下文） ===== */
  function RP_showItem(tr){
    var it = { level: tr.getAttribute('data-lv') || '', country: tr.getAttribute('data-ct') || '', title: tr.getAttribute('data-tt') || '', time: tr.getAttribute('data-tm') || '', url: tr.getAttribute('data-url') || '' };
    var old = document.getElementById('rp-item-overlay'); if(old) old.remove();
    var LVN = { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' };
    var lvColor = it.level === 'red' ? 'var(--red)' : it.level === 'orange' ? 'var(--orange)' : it.level === 'blue' ? 'var(--cyan)' : 'var(--yellow)';
    var lvName = LVN[it.level] || it.level || '—';
    var advice = {
      red: '红色信号：建议 2 小时内完成初核并直报值班领导；核对涉华人员与项目资产暴露面，必要时启动应急响应。',
      orange: '橙色信号：建议当日内完成核实，纳入重点盯防清单；比对同国别近 7 日同类事件，评估趋势性风险。',
      yellow: '黄色信号：建议持续跟踪 48-72 小时，关注是否发酵升级；纳入周期简报跟踪口径。',
      blue: '蓝色信号：常规归档观察，作为国别/类别态势背景数据留存。'
    }[it.level] || '按常规流程跟踪处置。';
    /* 库内模糊匹配（标题前 12 字去空格互含） */
    var hits = [];
    if(window.ALERTS && it.title){
      var key = it.title.replace(/\s+/g, '').slice(0, 12);
      if(key.length >= 6){
        hits = ALERTS.filter(function(a){
          var at = String(a.title_zh || a.title || '').replace(/\s+/g, '');
          return at && (at.indexOf(key) >= 0 || key.indexOf(at.slice(0, 12)) >= 0);
        }).slice(0, 3);
      }
    }
    var ov = document.createElement('div');
    ov.className = 'cmd-modal-overlay'; ov.id = 'rp-item-overlay';
    ov.innerHTML = '<div class="cmd-modal" style="max-width:620px">' +
      '<div class="cmd-modal-hd"><h3>📑 报告事件研判</h3><button class="cmd-modal-close" id="rp-it-x">×</button></div>' +
      '<div class="cmd-modal-bd">' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">' +
          '<div class="cmd-info-item"><div class="lb">级别</div><div class="vl"><span style="color:' + lvColor + ';font-weight:700">● ' + esc(lvName) + '</span></div></div>' +
          '<div class="cmd-info-item"><div class="lb">国别</div><div class="vl">' + esc(it.country || '未标注') + '</div></div>' +
          '<div class="cmd-info-item"><div class="lb">时间</div><div class="vl" style="font-size:11.5px">' + esc(it.time || '—') + '</div></div>' +
        '</div>' +
        '<div class="cmd-info-item" style="margin-bottom:12px"><div class="lb">事件标题</div><div class="vl" style="line-height:1.65">' + esc(it.title) + '</div></div>' +
        '<div class="cmd-desc" style="margin-top:0"><div class="cmd-desc-lead" style="font-size:12px">🧭 ' + esc(advice) + '</div></div>' +
        (hits.length ? '<div style="margin-top:12px"><div style="font-size:11px;color:var(--cyan);margin-bottom:6px">🗄️ 库内匹配预警（' + hits.length + '）</div>' +
          hits.map(function(h){
            return '<div class="rp-hit" data-aid="' + esc(h.id || '') + '" style="padding:7px 9px;border:1px solid var(--border);border-radius:7px;margin-bottom:6px;cursor:pointer;background:var(--bg2)">' +
              '<div style="font-size:9.5px;color:var(--text3);margin-bottom:2px">' + esc(h.country || '') + ' · ' + esc(String(h.source || '')) + '</div>' +
              '<div style="font-size:11.5px;color:var(--text);line-height:1.5">' + esc(String(h.title_zh || h.title || '').slice(0, 56)) + '</div></div>';
          }).join('') + '</div>' : '') +
        '<div class="cmd-actions-row">' +
          (it.url ? '<button class="btn primary sm" id="rp-it-url">🔗 阅读原文</button>' : '') +
          '<button class="btn sm" id="rp-it-cmd">🎖 转指挥事件</button>' +
          '<button class="btn sm" id="rp-it-copy">📋 复制摘要</button>' +
        '</div>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#rp-it-x').onclick = function(){ ov.remove(); };
    ov.querySelectorAll('.rp-hit[data-aid]').forEach(function(el){
      el.onclick = function(){ var aid = el.getAttribute('data-aid'); if(aid && window.showAlertDetail) showAlertDetail(aid); };
    });
    var urlBtn = ov.querySelector('#rp-it-url');
    if(urlBtn) urlBtn.onclick = function(){ window.open(it.url, '_blank', 'noopener'); };
    var cmdBtn = ov.querySelector('#rp-it-cmd');
    if(cmdBtn) cmdBtn.onclick = function(){
      if(window.COMMAND && COMMAND.createIncidentFromAlert){
        COMMAND.createIncidentFromAlert({ title: it.title, level: it.level || 'yellow', country: it.country || '', desc: '专题报告事件转入：' + it.title + (it.url ? '\n原文：' + it.url : ''), source: '专题分析中心', id: 'RP-' + Date.now() });
        cmdBtn.textContent = '✅ 已转指挥'; cmdBtn.disabled = true;
      } else { cmdBtn.textContent = '指挥模块未加载'; }
    };
    var cpBtn = ov.querySelector('#rp-it-copy');
    if(cpBtn) cpBtn.onclick = function(){
      var txt = '【报告事件】' + it.title + '\n级别：' + lvName + '　国别：' + (it.country || '未标注') + '　时间：' + (it.time || '—') + (it.url ? '\n原文：' + it.url : '');
      if(navigator.clipboard) navigator.clipboard.writeText(txt);
      cpBtn.textContent = '✅ 已复制'; setTimeout(function(){ cpBtn.textContent = '📋 复制摘要'; }, 1200);
    };
  }

  function stateHTML(ic, big, small, extra) {
    return '<div class="rc-state"><span class="ic">' + ic + '</span><div class="big">' + big + '</div><div class="rc-dim">' + small + '</div>' + (extra || '') + '</div>';
  }

  /* ===== 摘要面板（summary JSONB 结构化展示） ===== */
  function smLabel(k) {
    var CN = { sections: '报告章节', red: '红色信号', orange: '橙色信号', yellow: '黄色信号', events: '事件条数', countries: '涉及国家', orgs: '威胁组织', projects: '涉及项目', sources: '信源数', highlights: '核心要点', recommendations: '行动建议', period: '期次', model: '模型', govChars: '公文版字数', wordTarget: '字数指标', llmOk: '研判生成' };
    return CN[k] || k;
  }
  function smColor(k) {
    if (/红|red/i.test(k)) return 'var(--red)';
    if (/橙|orange/i.test(k)) return 'var(--orange)';
    if (/黄|yellow/i.test(k)) return 'var(--yellow)';
    return '#00e5ff';
  }

  function smRows(o, depth) {
    var out = '', kpiHtml = '';
    Object.keys(o || {}).forEach(function (k) {
      var v = o[k];
      if (v === null || v === undefined || v === '') return;
      var kn = esc(smLabel(k));
      if (typeof v === 'number' || typeof v === 'boolean') {
        kpiHtml += '<div class="rc-kv"><div class="v" style="color:' + smColor(k) + '">' + esc(String(v)) + '</div><div class="k">' + kn + '</div></div>';
      } else if (typeof v === 'string') {
        out += v.length > 80
          ? '<div style="padding:5px 0;border-bottom:1px dashed rgba(0,212,255,.08);font-size:11px;line-height:1.6"><b style="color:#9fe8ff">' + kn + '</b><div style="color:var(--text2);margin-top:3px">' + esc(v.slice(0, 200)) + (v.length > 200 ? '…' : '') + '</div></div>'
          : '<div class="rc-row"><span class="k">' + kn + '</span><span class="v" title="' + esc(v) + '">' + esc(v) + '</span></div>';
      } else if (Array.isArray(v)) {
        out += '<div class="rc-row"><span class="k">' + kn + '</span><span class="v">' + v.length + ' 条</span></div>';
      } else if (typeof v === 'object') {
        if (depth >= 1) { out += '<div class="rc-row"><span class="k">' + kn + '</span><span class="v">' + Object.keys(v).length + ' 项</span></div>'; }
        else { out += '<div class="rc-sm-grp">' + kn + '</div>' + smRows(v, depth + 1); }
      }
    });
    return (kpiHtml ? '<div class="rc-kpi">' + kpiHtml + '</div>' : '') + out;
  }

  function renderSummary() {
    var el = $('rc-summary');
    if (!el) return;
    if (!S.detail) { el.innerHTML = '<div class="rc-dim">加载报告后展示结构化摘要（各节条数 / 红橙信号数等）。</div>'; return; }
    var sm = S.detail.summary;
    if (!sm) { el.innerHTML = '<div class="rc-dim">该期报告无结构化摘要。</div>'; return; }
    if (typeof sm === 'string') { el.innerHTML = '<div class="rc-sm-txt">' + esc(sm) + '</div>'; return; }
    var html = smRows(sm, 0);
    el.innerHTML = html || '<div class="rc-dim">该期报告无结构化摘要。</div>';
  }

  /* ===== 版本切换 ===== */
  function setVer(v) {
    if (!S.detail || S.ver === v) return;
    var has = v === 'gov' ? !!(S.detail.gov_html && String(S.detail.gov_html).trim()) : !!(S.detail.html && String(S.detail.html).trim());
    if (!has) { toast(v === 'gov' ? '该期无公文版内容' : '该期无标准版内容'); return; }
    S.ver = v;
    renderToolbar(); renderReader();
  }

  /* ===== 生成（含 429 / 轮询状态机） ===== */
  function generate(regen) {
    if (!S.cur || genBusy()) return;
    var t = typeOf(S.cur);
    if (!t) return;
    /* #533：专题分析模型报告——先弹交互选题矩阵（维度/国家/组织/时间窗），再生成 */
    if (!regen && S.cur === 'model-export') { openTopic(); return; }
    var body = { type: S.cur };
    /* #528：携带用户所选周期（重新生成按当前期次窗口，不带 freq） */
    if (!regen && S.genFreq) body.freq = S.genFreq;
    if (regen && S.detail && S.detail.period) body.period = S.detail.period;
    api('POST', '/generate', body, 300000).then(function (r) { /* 同步 LLM 长任务：5 分钟超时（对齐前端最长等待） */
      if (r.ok) {
        S.generating = true; S.genType = S.cur;
        S.genId = (r.data && r.data.id) || null;
        toast('已提交生成任务：' + (t.name || '') + (S.genFreq ? '（' + FREQ[S.genFreq].n + '）' : '') + ' · LLM 撰写中（约 1–3 分钟）');
        startPoll();
      } else if (r.status === 429) {
        /* 另一生成任务进行中（本会话或他端）：同样进入轮询等待其完成 */
        S.generating = true; S.genType = S.cur; S.genId = null;
        toast('该报告正在生成中，请稍候——已自动进入等待');
        startPoll();
      } else {
        toast('生成失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
      }
    });
  }

  function topListId() { return S.list && S.list.length ? String(S.list[0].id) : null; }

  function startPoll() {
    stopPoll(false);
    S.pollBase = topListId();
    S.pollStart = Date.now();
    renderNav(); renderToolbar();
    S.pollTimer = setTimeout(pollOnce, 15000); /* 15s 起轮询 */
    S.tickTimer = setInterval(function () {
      var el = $('rc-elapsed');
      if (el) el.textContent = String(Math.floor((Date.now() - S.pollStart) / 1000));
    }, 1000);
  }

  function pollOnce() {
    api('GET', '/list?type=' + enc(S.genType || '') + '&limit=5').then(function (r) {
      if (!S.generating) return;
      var arr = (r.ok && r.data && r.data.list) ? r.data.list : null;
      if (arr && arr.length) {
        var top = arr[0];
        if (S.genId ? String(top.id) === String(S.genId) : (String(top.id) !== String(S.pollBase))) {
          finishPoll(true);
          return;
        }
      }
      if (Date.now() - S.pollStart > (S.genType === 'model-export' ? 9 : 5) * 60 * 1000) {
        finishPoll(false);
        toast('生成超时（超过 ' + (S.genType === 'model-export' ? 9 : 5) + ' 分钟）：请稍后刷新期次历史查看结果');
        return;
      }
      S.pollTimer = setTimeout(pollOnce, 15000);
    });
  }

  function finishPoll(done) {
    stopPoll(false);
    var genType = S.genType;
    S.generating = false; S.genType = null; S.genId = null;
    if (done) {
      toast('✅ 新一期报告已生成');
      loadTypes();               /* 刷新类型卡最近一期/状态点 */
      if (S.cur === genType) loadList();
    } else {
      renderNav(); renderToolbar();
      if (S.cur === genType) loadList();
    }
  }

  function stopPoll(keepFlag) {
    if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; }
    if (S.tickTimer) { clearInterval(S.tickTimer); S.tickTimer = null; }
    if (!keepFlag) { /* 外部调用保留状态 */ }
  }

  /* ===== 打印 / 导出（主路径：iframe contentWindow.print，公文版白底） ===== */
  function printReport() {
    var host = $('rc-reader');
    var f = host ? host.querySelector('.rc-frame') : null;
    try {
      if (f && f.contentWindow) { f.contentWindow.focus(); f.contentWindow.print(); return; }
    } catch (e) { /* 跨域兜底：走 window.print */ }
    window.print();
  }

  /* ===== 人工修订（PUT detail） ===== */
  function openEdit() {
    if (!S.detail) return;
    var mask = $('rc-edit-mask'), ta = $('rc-edit-ta'), tt = $('rc-edit-tt'), tip = $('rc-edit-tip');
    if (!mask || !ta) return;
    var cur = S.ver === 'gov' ? S.detail.gov_html : S.detail.html;
    ta.value = String(cur || '');
    tt.textContent = (S.detail.title || '') + '（' + (S.ver === 'gov' ? '公文版 gov_html' : '标准版 html') + '）';
    if (tip) tip.textContent = '';
    mask.classList.add('show');
  }

  function closeEdit() {
    var mask = $('rc-edit-mask');
    if (mask) mask.classList.remove('show');
  }

  function saveEdit() {
    if (!S.detail) return;
    var ta = $('rc-edit-ta'), tip = $('rc-edit-tip');
    if (!ta) return;
    var body = {};
    if (S.ver === 'gov') body.gov_html = ta.value; else body.html = ta.value;
    if (tip) tip.textContent = '保存中…';
    api('PUT', '/detail/' + enc(S.detail.id), body).then(function (r) {
      if (r.ok) {
        toast('✅ 修订已保存');
        closeEdit();
        loadDetail(S.detail.id, true);
      } else {
        if (tip) tip.textContent = '保存失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status));
        toast('修订保存失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
      }
    });
  }

  /* ===== #533 专题分析模型报告 · 交互选题矩阵 ===== */
  var TOPIC_DIMS = [
    { k: 'org', n: '组织行为模式' },
    { k: 'trend', n: '趋势拐点研判' },
    { k: 'country', n: '国别风险聚焦' },
    { k: 'china', n: '涉华信号专项' },
    { k: 'project', n: '中资项目暴露' },
    { k: 'chokepoint', n: '海上咽喉要道' },
    { k: 'sanction', n: '制裁合规影响' }
  ];
  var TOPIC_WINS = [
    { v: 7, n: '近 7 天' }, { v: 14, n: '近 14 天' }, { v: 30, n: '近 30 天' },
    { v: 60, n: '近 60 天' }, { v: 90, n: '近 90 天' }, { v: 180, n: '近半年' }, { v: 365, n: '近一年' }
  ];
  function countryList() {
    try {
      var arr = (typeof COUNTRIES !== 'undefined' && COUNTRIES) || [];
      return arr.map(function (c) { return { name: c.name || '', flag: c.flag || '' }; }).filter(function (c) { return c.name; });
    } catch (e) { return []; }
  }
  function _ck(v, n) {
    return '<span class="rc-ck" data-act="ck" data-k="' + esc(v) + '"><span class="bx">☑</span>' + esc(n) + '</span>';
  }
  function openTopic() {
    var mask = $('rc-topic-mask'), body = $('rc-topic-body');
    if (!mask || !body) return;
    var cls = countryList();
    body.innerHTML =
      '<div class="rc-ogrp">① 专题名称<small>（选填——不填则按所选维度自动拟定）</small></div>' +
      '<input class="rc-tin" id="rc-tp-topic" maxlength="60" placeholder="例：俾路支省中资项目安全暴露与 BLA 组织行为深度分析">' +
      '<div class="rc-ogrp">② 分析维度<small>（七维模型矩阵，多选——不选则七维全开）</small></div>' +
      '<div class="rc-ckgrid" id="rc-tp-dims">' + TOPIC_DIMS.map(function (d) { return _ck(d.k, d.n); }).join('') + '</div>' +
      '<div class="rc-ogrp">③ 国别聚焦<small>（多选——不选则全球视野）</small></div>' +
      '<div class="rc-cgwrap"><div style="margin-bottom:6px"><span class="rc-ck rc-cksmall" data-act="ck-all">全选 / 全不选</span></div>' +
      '<div class="rc-ckgrid" id="rc-tp-countries">' + cls.map(function (c) { return _ck(c.name, (c.flag ? c.flag + ' ' : '') + c.name); }).join('') + '</div></div>' +
      '<div class="rc-ogrp">④ 威胁组织聚焦<small>（选填，逗号分隔，至多 8 个）</small></div>' +
      '<input class="rc-tin" id="rc-tp-orgs" placeholder="例：Balochistan Liberation Army, TTP, 胡塞武装">' +
      '<div class="rc-ogrp">⑤ 统计时间窗<small>（数据聚合范围）</small></div>' +
      '<select class="rc-sel" id="rc-tp-win">' + TOPIC_WINS.map(function (w) {
        return '<option value="' + w.v + '"' + (w.v === 30 ? ' selected' : '') + '>' + w.n + '</option>';
      }).join('') + '</select>' +
      '<div class="rc-opt-tip">深度分析要求（后端模型化差异化）：组织行为模式归纳 / 趋势拐点识别 / 风险传导链（事件→通道→项目→人员）/ 影响量化评估 / 三级确定性表述（已证实 · 研判认为 · 需持续关注）。自定义选题生成独立期次存档（互不覆盖），可在期次历史中长期查阅。</div>';
    mask.classList.add('show');
  }
  function closeTopic() {
    var m = $('rc-topic-mask');
    if (m) m.classList.remove('show');
  }
  function submitTopic() {
    if (genBusy()) { toast('当前已有报告在生成中，请稍候'); return; }
    var dims = [], countries = [];
    var dm = $('rc-tp-dims'), cm = $('rc-tp-countries');
    if (dm) Array.prototype.forEach.call(dm.querySelectorAll('.rc-ck.on'), function (el) { dims.push(el.getAttribute('data-k')); });
    if (cm) Array.prototype.forEach.call(cm.querySelectorAll('.rc-ck.on'), function (el) { countries.push(el.getAttribute('data-k')); });
    var topic = ($('rc-tp-topic') && $('rc-tp-topic').value.trim()) || '';
    var orgsRaw = ($('rc-tp-orgs') && $('rc-tp-orgs').value.trim()) || '';
    var orgs = orgsRaw ? orgsRaw.split(/[,，;；]+/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8) : [];
    var win = parseInt(($('rc-tp-win') && $('rc-tp-win').value) || '30', 10) || 30;
    var options = { windowDays: win };
    if (topic) options.topic = topic;
    if (dims.length) options.dims = dims;
    if (countries.length) options.countries = countries;
    if (orgs.length) options.orgs = orgs;
    var label = topic || (countries.length ? countries.slice(0, 3).join('、') + (countries.length > 3 ? ' 等' + countries.length + ' 国' : '') : '七维全矩阵');
    closeTopic();
    api('POST', '/generate', { type: 'model-export', options: options }).then(function (r) {
      if (r.ok || r.status === 429) {
        S.generating = true; S.genType = 'model-export';
        S.genId = (r.ok && r.data && r.data.id) || null;
        toast('已提交专题生成：' + label + ' · 深度分析撰写中（约 2–4 分钟）');
        startPoll();
      } else {
        toast('生成失败：' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
      }
    });
  }

  /* ===== 导出（window.REPORTS） ===== */
  var RC = {
    render: render,
    init: render,                      /* 兼容 runViewInit 两种钩子习惯 */
    selectType: selectType,
    generate: generate,
    setVer: setVer,
    printReport: printReport,
    openEdit: openEdit,
    openTopic: openTopic,              /* #533 专题交互选题 */
    state: S
  };

  window.REPORTS = RC;
})();
