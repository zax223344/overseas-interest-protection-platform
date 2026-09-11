/* ================================================================
 * ORPS 海外利益保护情报预警平台 · 系统入口层
 * ① LANDING 科技感着陆页（深空蓝黑底 + 霓虹色 + 扫描线 HUD）
 * ② RULES   推演/使用规则阅读页
 * 风格对齐：军事情报指挥中心 HUD（NSS-WGS / IATP 同族视觉）
 * ================================================================ */
(function () {
  'use strict';

  /* ---------- 样式注入（一次） ---------- */
  var STYLE_ID = 'orps-landing-style';
  if (!document.getElementById(STYLE_ID)) {
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '#view-landing,#view-rules{--hud-cyan:#00d4ff;--hud-cyan-dim:rgba(0,212,255,.35);--hud-line:rgba(0,212,255,.16);--hud-bg:#04070f;--hud-panel:rgba(8,16,30,.72);position:relative;min-height:100%;background:radial-gradient(1200px 700px at 50% -10%,rgba(0,90,160,.28),transparent 60%),radial-gradient(900px 600px at 90% 110%,rgba(0,60,120,.22),transparent 60%),linear-gradient(180deg,#04070f 0%,#050a14 45%,#03060d 100%)}',
      '#view-landing::before,#view-rules::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(0,212,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,.045) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(900px 600px at 45% 20%,#000 20%,transparent 85%)}',
      '#view-landing::after,#view-rules::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgba(0,212,255,.055) 0 1px,transparent 1px 3px);opacity:.6;animation:orpsScan 8s linear infinite}',
      '@keyframes orpsScan{0%{background-position-y:0}100%{background-position-y:120px}}',
      '@keyframes orpsPulse{0%,100%{opacity:.35}50%{opacity:1}}',
      '@keyframes orpsSweep{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}',
      '.hud-wrap{position:relative;z-index:2;padding:18px 22px 30px;font-family:inherit}',
      '.hud-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid var(--hud-line);background:linear-gradient(90deg,rgba(0,212,255,.09),rgba(0,212,255,.02));padding:10px 14px;border-radius:4px;position:relative}',
      '.hud-bar:before,.hud-bar:after{content:"";position:absolute;width:14px;height:14px;border:1px solid var(--hud-cyan);opacity:.7}',
      '.hud-bar:before{left:-1px;top:-1px;border-right:0;border-bottom:0}',
      '.hud-bar:after{right:-1px;bottom:-1px;border-left:0;border-top:0}',
      '.hud-title{font-size:19px;font-weight:800;letter-spacing:4px;color:#dff6ff;text-shadow:0 0 12px rgba(0,212,255,.55)}',
      '.hud-sub{font-size:10.5px;color:rgba(190,220,240,.65);letter-spacing:1.5px}',
      '.hud-chip{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.5px;color:#bfe6f7;border:1px solid var(--hud-line);background:rgba(0,212,255,.06);padding:3px 9px;border-radius:3px}',
      '.hud-dot{width:6px;height:6px;border-radius:50%;background:var(--hud-cyan);box-shadow:0 0 8px var(--hud-cyan);animation:orpsPulse 1.6s ease-in-out infinite}',
      '.hud-kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}',
      '.hud-kpi{border:1px solid var(--hud-line);background:var(--hud-panel);padding:10px 12px;border-radius:4px;position:relative;overflow:hidden}',
      '.hud-kpi:after{content:"";position:absolute;left:0;top:0;height:2px;width:100%;background:linear-gradient(90deg,var(--hud-cyan),transparent)}',
      '.hud-kpi .k{font-size:10px;color:rgba(180,210,230,.6);letter-spacing:1px}',
      '.hud-kpi .v{font-size:22px;font-weight:800;color:var(--hud-cyan);text-shadow:0 0 10px rgba(0,212,255,.45);line-height:1.25}',
      '.hud-kpi .s{font-size:9.5px;color:rgba(180,210,230,.5)}',
      '.hud-sec{display:flex;align-items:center;gap:10px;margin:18px 0 10px}',
      '.hud-sec .t{font-size:12.5px;font-weight:700;letter-spacing:3px;color:#cdefff}',
      '.hud-sec .l{flex:1;height:1px;background:linear-gradient(90deg,var(--hud-cyan-dim),transparent)}',
      '.hud-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:10px}',
      '.hud-card{position:relative;border:1px solid var(--hud-line);background:linear-gradient(160deg,rgba(9,20,36,.92),rgba(5,11,22,.86));padding:12px 13px;border-radius:4px;cursor:pointer;transition:.18s;overflow:hidden}',
      '.hud-card:hover{border-color:var(--hud-cyan);transform:translateY(-2px);box-shadow:0 6px 22px rgba(0,212,255,.16)}',
      '.hud-card:hover .hud-card-glow{opacity:1}',
      '.hud-card-glow{position:absolute;inset:0;opacity:0;transition:.25s;background:radial-gradient(220px 90px at 12% 0%,rgba(0,212,255,.16),transparent 70%)}',
      '.hud-card .ic{font-size:17px}',
      '.hud-card .nm{font-size:13px;font-weight:700;color:#e6f7ff;letter-spacing:1.2px}',
      '.hud-card .ds{font-size:10px;color:rgba(175,205,225,.62);line-height:1.6;margin-top:5px;min-height:32px}',
      '.hud-card .mt{display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:7px;border-top:1px solid rgba(0,212,255,.1)}',
      '.hud-card .mv{font-size:15px;font-weight:800;color:var(--hud-cyan)}',
      '.hud-card .mu{font-size:9.5px;color:rgba(175,205,225,.5)}',
      '.hud-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--hud-cyan-dim);background:rgba(0,212,255,.08);color:#d8f4ff;font-size:11.5px;letter-spacing:1.5px;padding:7px 14px;border-radius:3px;cursor:pointer;transition:.18s}',
      '.hud-btn:hover{background:rgba(0,212,255,.18);border-color:var(--hud-cyan);box-shadow:0 0 16px rgba(0,212,255,.28)}',
      '.hud-rule-sec{border:1px solid var(--hud-line);background:var(--hud-panel);border-radius:4px;padding:14px 16px;margin-bottom:10px}',
      '.hud-rule-sec h4{margin:0 0 8px;font-size:13px;letter-spacing:2px;color:#d8f4ff}',
      '.hud-rule-sec h4 .no{display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;border:1px solid var(--hud-cyan-dim);color:var(--hud-cyan);font-size:11px;margin-right:8px;border-radius:3px}',
      '.hud-rule-sec p,.hud-rule-sec li{font-size:11.5px;line-height:1.85;color:rgba(200,222,238,.86);margin:0 0 4px}',
      '.hud-rule-sec li::marker{color:var(--hud-cyan)}',
      '.hud-radar{width:120px;height:120px;position:relative;flex-shrink:0}',
      '.hud-radar .ring{position:absolute;inset:0;border:1px solid var(--hud-cyan-dim);border-radius:50%}',
      '.hud-radar .ring2{position:absolute;inset:22px;border:1px solid rgba(0,212,255,.2);border-radius:50%}',
      '.hud-radar .sweep{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(0,212,255,.32),transparent 28%);animation:orpsSweep 3.6s linear infinite}'
    ].join('');
    document.head.appendChild(st);
  }

  function g(name, fb) { try { return (typeof window[name] !== 'undefined' && window[name]) ? window[name] : fb; } catch (e) { return fb; } }
  function cnt(v) { try { return (v && v.length) || 0; } catch (e) { return 0; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ================================================================
   * ① LANDING 科技感着陆页
   * ================================================================ */
  window.LANDING = {
    _labels: {
      situation: ['🌐', '全域态势感知', '全球风险指数 · 地球态势 · 焦点预警流', 'situation'],
      workbench: ['🧭', '协同作业中心', '跨部门联合作业台 · 任务工作区', 'workbench'],
      threatroom: ['🎯', '情报作战中心', '专项情报作战室 · 实体专项采集', 'threatroom'],
      command: ['📡', '指挥调度中心', '指挥事件看板 · 分级响应调度', 'command'],
      aiwatch: ['🤖', '智能控制中枢', 'AI 值班分析师 · 无人值守扫库', 'aiwatch'],
      monitor: ['🛰️', '实时风险监测', '风险地图 · 事件追踪 · 应急指南', 'monitor'],
      intel: ['🖼️', '影像情报中心', '影像图库 · 社媒监测 · 地理空间情报', 'intel'],
      alerts: ['🚨', '智能预警中心', '预警队列 · 处置闭环 · 关联分析', 'alerts'],
      terjudge: ['💥', '全球恐袭监测', '恐袭态势 · 涉华恐袭数据集', 'terjudge'],
      evjudge: ['🔬', '事件研判中心', '事件时间流研判 · 境外社媒舆情', 'evjudge'],
      entrisk: ['🛡️', '涉企风险研判', '七域风险 · 高管出境 · 订阅画像', 'entrisk'],
      country: ['📊', '国别风险研判', '风险矩阵 · 预测推演 · COSRI', 'country'],
      impact: ['🔗', '传导应急中心', '事件→资产传导 · 供应链中断 · 撤离预案', 'impact'],
      reports: ['📄', '情报报告中心', '领导要报 · 周期简报 · 专题分析 · AI研判', 'reports'],
      datapool: ['🗄️', '数据治理中枢', '数据源 · 采集库 · 审核库 · 归档', 'datapool'],
      'manual-entry': ['✍️', '情报录入中心', '手工录入 · 重点线索登记', 'manual-entry'],
      thinktank: ['🏛️', '智库知识中心', '智库报告库 · 加密存储', 'thinktank'],
      rules: ['📖', '系统规则阅读', '数据铁律 · 预警分级 · 处置闭环规范', 'rules']
    },
    init() {
      this.render();
      this._clock();
    },
    _clock() {
      var self = this;
      if (self._timer) clearInterval(self._timer);
      var tick = function () {
        var el = document.getElementById('hud-clock');
        if (!el) { return; }
        var d = new Date();
        el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      };
      tick();
      self._timer = setInterval(function () { if (document.getElementById('hud-clock')) { tick(); } else { clearInterval(self._timer); self._timer = null; } }, 1000);
    },
    _kpi() {
      var S = g('SITUATION', null), AL = g('ALERTS', []) || [];
      var red = AL.filter(function (a) { return a.level === 'red' && a.status !== 'resolved'; }).length;
      var active = AL.filter(function (a) { return a.status === 'active' || a.status === 'responding'; }).length;
      var cn = AL.filter(function (a) {
        if (a.chinaRelated === true || a.is_core === true) return true;
        var t = String(a.title || '') + String(a.title_zh || '');
        if (typeof GATE !== 'undefined' && GATE.isChinaRelatedStrict) return GATE.isChinaRelatedStrict(t);
        return /中资|中企|中方|华人|华侨|中国公民|一带一路|涉华/.test(t);
      }).length;
      var ents = cnt(g('ENTERPRISES', []));
      var ctys = cnt(g('COUNTRIES', []));
      var hi = 0; try { hi = (g('COUNTRIES', []) || []).filter(function (c) { return (typeof calcOverall === 'function' ? calcOverall(c.scores) : 0) >= 8; }).length; } catch (e) { }
      var cases = cnt(g('CASE_LIBRARY', []));
      return { red: red, active: active, cn: cn, ents: ents, ctys: ctys, hi: hi, cases: cases, total: AL.length };
    },
    render() {
      var el = document.getElementById('landing-content');
      if (!el) return;
      var k = this._kpi();
      var self = this;
      var groups = [
        { name: '态势感知', keys: ['situation', 'workbench', 'threatroom', 'command', 'aiwatch'] },
        { name: '监测中心', keys: ['monitor', 'intel', 'alerts', 'terjudge'] },
        { name: '分析研判', keys: ['evjudge', 'entrisk', 'country', 'impact', 'reports'] },
        { name: '数据管理', keys: ['datapool', 'manual-entry', 'thinktank'] },
        { name: '系统', keys: ['rules'] }
      ];
      var card = function (key) {
        var L = self._labels[key] || ['▪', key, '', key];
        var metric = '';
        if (key === 'alerts') metric = '<div class="mt"><span class="mu">在库预警</span><span><b class="mv">' + k.total + '</b><span class="mu"> 条</span></span></div>';
        else if (key === 'terjudge' || key === 'evjudge') metric = '<div class="mt"><span class="mu">红色预警</span><span><b class="mv">' + k.red + '</b><span class="mu"> 起</span></span></div>';
        else if (key === 'entrisk' || key === 'country') metric = '<div class="mt"><span class="mu">监测企业</span><span><b class="mv">' + k.ents + '</b><span class="mu"> 家</span></span></div>';
        else if (key === 'monitor' || key === 'situation') metric = '<div class="mt"><span class="mu">覆盖国家</span><span><b class="mv">' + k.ctys + '</b><span class="mu"> 国</span></span></div>';
        else if (key === 'impact') metric = '<div class="mt"><span class="mu">高风险国家</span><span><b class="mv">' + k.hi + '</b><span class="mu"> 个</span></span></div>';
        else if (key === 'workbench' || key === 'reports') metric = '<div class="mt"><span class="mu">活跃处置</span><span><b class="mv">' + k.active + '</b><span class="mu"> 起</span></span></div>';
        else if (key === 'datapool') metric = '<div class="mt"><span class="mu">案例库</span><span><b class="mv">' + k.cases + '</b><span class="mu"> 例</span></span></div>';
        else if (key === 'rules') metric = '<div class="mt"><span class="mu">必读</span><span><b class="mv">8</b><span class="mu"> 章</span></span></div>';
        else metric = '<div class="mt"><span class="mu">涉华情报</span><span><b class="mv">' + k.cn + '</b><span class="mu"> 条</span></span></div>';
        return '<div class="hud-card" onclick="navigateTo(\'' + L[3] + '\')"><div class="hud-card-glow"></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span class="ic">' + L[0] + '</span><span class="nm">' + L[1] + '</span></div>' +
          '<div class="ds">' + L[2] + '</div>' + metric + '</div>';
      };
      var secs = groups.map(function (grp) {
        return '<div class="hud-sec"><span class="t">' + grp.name + '</span><span class="l"></span><span class="mu" style="font-size:10px;color:rgba(175,205,225,.5)">' + grp.keys.length + ' 个功能区</span></div>' +
          '<div class="hud-grid">' + grp.keys.map(card).join('') + '</div>';
      }).join('');

      el.innerHTML = '<div class="hud-wrap">' +
        '<div class="hud-bar">' +
          '<div class="hud-radar"><div class="ring"></div><div class="ring2"></div><div class="sweep"></div></div>' +
          '<div style="flex:1;min-width:260px">' +
            '<div class="hud-title">海外利益保护情报预警平台</div>' +
            '<div class="hud-sub">OVERSEAS INTEREST PROTECTION · INTELLIGENCE EARLY-WARNING PLATFORM</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
              '<span class="hud-chip"><span class="hud-dot"></span>系统在线</span>' +
              '<span class="hud-chip">🕐 <b id="hud-clock">--:--:--</b></span>' +
              '<span class="hud-chip">密级：内部使用</span>' +
              '<span class="hud-chip">数据源：实时采集链路</span>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<span class="hud-btn" onclick="navigateTo(\'situation\')">▶ 进入态势总览</span>' +
            '<span class="hud-btn" onclick="navigateTo(\'rules\')">📖 规则阅读</span>' +
          '</div>' +
        '</div>' +
        '<div class="hud-kpi-row">' +
          '<div class="hud-kpi"><div class="k">在库预警</div><div class="v">' + k.total + '</div><div class="s">含活跃 ' + k.active + ' 条</div></div>' +
          '<div class="hud-kpi"><div class="k">红色预警</div><div class="v" style="color:#ff4d6a;text-shadow:0 0 10px rgba(255,77,106,.45)">' + k.red + '</div><div class="s">需优先处置</div></div>' +
          '<div class="hud-kpi"><div class="k">涉华情报</div><div class="v" style="color:#ffb020;text-shadow:0 0 10px rgba(255,176,32,.4)">' + k.cn + '</div><div class="s">涉我海外利益</div></div>' +
          '<div class="hud-kpi"><div class="k">监测企业 / 国家</div><div class="v">' + k.ents + '<span style="font-size:13px;color:rgba(190,220,240,.7)"> / ' + k.ctys + '</span></div><div class="s">高风险国家 ' + k.hi + ' 个</div></div>' +
          '<div class="hud-kpi"><div class="k">案例库</div><div class="v">' + k.cases + '</div><div class="s">真实事件档案</div></div>' +
        '</div>' +
        secs +
        '<div style="margin-top:20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid rgba(0,212,255,.14);padding-top:12px">' +
          '<span class="hud-sub">首次使用请先阅读《系统规则与数据铁律》，明确定级、时效与处置要求后再开展研判。</span>' +
          '<span class="hud-btn" onclick="navigateTo(\'rules\')">📖 开始规则阅读 →</span>' +
        '</div>' +
      '</div>';
    }
  };

  /* ================================================================
   * ② RULES 规则阅读页
   * ================================================================ */
  window.RULES = {
    _sections: [
      {
        n: '01', t: '系统定位与适用范围',
        body: '<p>本平台面向中国海外利益保护实战需求，服务国家安全、外交、商务、公安及中央企业五类用户，围绕「监测—预警—研判—处置—报告」全链条提供情报支撑。</p>' +
          '<ul><li>覆盖 6 大维度：经济基础、人员机构、安全事件、东道国风险、海上走廊、合规制裁。</li>' +
          '<li>对齐官方学说框架：COSRI 海外安全风险指数、《国家安全法》第三十三条、海外利益安全蓝皮书。</li>' +
          '<li>系统数据与研判结论仅限内部使用，不得对外传播、不得用于商业目的。</li></ul>'
      },
      {
        n: '02', t: '数据来源与真实数据铁律',
        body: '<ul><li><b>零模拟数据</b>：系统内所有情报、预警、案例、报告均来源于真实抓取或人工录入，严禁注入演示/假数据。</li>' +
          '<li>数据源覆盖全球主流媒体、通讯社、政府公告、智库与社交媒体，按五级立场标签（G/I/N/W/C）交叉验证。</li>' +
          '<li>每条情报保留来源与来源网址，单一来源未交叉验证的情报置信度较低，不单独触发红色预警。</li>' +
          '<li>入库统一经「采集 → 审核闸门 → 分发」唯一管线，落库即完成中文翻译与术语归一。</li></ul>'
      },
      {
        n: '03', t: '预警分级与赋分规则',
        body: '<p>预警分四级，分值区间 0—100，按「事件性质 × 涉及对象 × 处置紧迫度」综合判定：</p>' +
          '<ul><li><b>红色</b>（极高）：中方人员遇袭伤亡、被绑架、群体性开枪、撤侨启动、重大资产损毁。</li>' +
          '<li><b>橙色</b>（高）：针对中资项目/机构的袭击威胁、大规模骚乱、战争外溢、重要通道中断。</li>' +
          '<li><b>黄色</b>（中）：区域性安全事件、政策与制裁动向、局部冲突升级。</li>' +
          '<li><b>蓝色</b>（低）：一般性风险动态与背景信息，默认折叠展示。</li></ul>' +
          '<p style="color:#ffb020">红区红线：制裁表态类、评论分析类、无伤亡的治安个案不得直接定为红色。</p>'
      },
      {
        n: '04', t: '时效与筛选规则',
        body: '<ul><li>涉华负面事件时效优先：24 小时内事件优先呈现，超过 72 小时的旧闻不进入预警队列。</li>' +
          '<li>严格涉华判定：须同时命中「中国要素」（中资/中企/中方人员/华人华侨/中国公民/一带一路等）与「风险要素」方可入库。</li>' +
          '<li>防刷屏机制：同事件多源报道按事件指纹归一，同国别预警设有展示上限，红色预警豁免。</li>' +
          '<li>境内事件与中国国内灾害/污染类信息不纳入本平台（属国内业务范围）。</li></ul>'
      },
      {
        n: '05', t: '处置闭环与 SLA',
        body: '<ul><li>预警状态流转：待处理 → 已确认 → 处置中 → 已解除；确认与处置须填写处置说明。</li>' +
          '<li>处置时限（SLA）：红色预警 2 小时内首次响应，橙色 8 小时，黄/蓝 24 小时。</li>' +
          '<li>误报处理：确认为误报的预警标记后归档，保留全量操作痕迹，不物理删除。</li>' +
          '<li>可解释审计：预警生成、升级/降级、处置动作均写入审计日志，可回溯责任链。</li></ul>'
      },
      {
        n: '06', t: '情报产品与公文规范',
        body: '<ul><li>产品线：领导要报速览（一页纸）、每日/每周/每月/每季/半年/年度简报、专题分析报告、AI 情报分析报告。</li>' +
          '<li>公文体例：按《对策建议撰写规范手册》五段式（态势—证据—影响—预测—建议），并标注置信度档位。</li>' +
          '<li>字数指标：日报 ≥3,999 字、月报 ≥2 万字、季报 ≥4 万字，报告须点名具体事件与国别。</li>' +
          '<li>所有报告须可溯源至在库情报，禁止空泛表述与无依据推演。</li></ul>'
      },
      {
        n: '07', t: '权限分级与密级管理',
        body: '<ul><li>角色分级：系统管理员、情报分析员、值班员、决策用户等，按角色开放菜单与操作权限。</li>' +
          '<li>敏感字段加密存储（AES-256-GCM），接口请求带签名校验，防篡改防重放。</li>' +
          '<li>数据导出（PDF/Excel）须留痕，导出内容含密级标识与生成时间。</li>' +
          '<li>试用账号设有有效期与功能范围限制，到期自动失效。</li></ul>'
      },
      {
        n: '08', t: '使用禁忌与责任',
        body: '<ul><li>禁止删改原始采集数据；发现数据质量问题应通过数据治理流程修正并留痕。</li>' +
          '<li>禁止将系统账号转借他人使用；离开工位须锁定终端。</li>' +
          '<li>禁止在非涉密设备上留存系统导出文件；打印件须按密级管理。</li>' +
          '<li>违反上述规则造成失泄密的，按相关保密规定追责。</li></ul>'
      }
    ],
    init() { this.render(); },
    render() {
      var el = document.getElementById('rules-content');
      if (!el) return;
      var secs = this._sections.map(function (s) {
        return '<div class="hud-rule-sec"><h4><span class="no">' + s.n + '</span>' + s.t + '</h4>' + s.body + '</div>';
      }).join('');
      el.innerHTML = '<div class="hud-wrap">' +
        '<div class="hud-bar">' +
          '<div style="flex:1;min-width:240px">' +
            '<div class="hud-title">系统规则与数据铁律</div>' +
            '<div class="hud-sub">RULES &amp; DATA DISCIPLINE · 必读 8 章 · 阅读后进入系统</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<span class="hud-btn" onclick="navigateTo(\'landing\')">← 返回系统入口</span>' +
            '<span class="hud-btn" onclick="RULES.ack()">✔ 已阅读，进入态势总览</span>' +
          '</div>' +
        '</div>' +
        '<div style="margin:14px 0 4px" class="hud-sub">本页为系统强制阅读内容：涉及数据来源、预警定级、时效筛选、处置闭环、公文规范、权限密级与使用责任。请逐章确认后再开展业务操作。</div>' +
        secs +
        '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid rgba(0,212,255,.14);padding-top:12px">' +
          '<span class="hud-sub">确认阅读即表示已理解并承诺遵守上述数据与保密要求。</span>' +
          '<span class="hud-btn" onclick="RULES.ack()">✔ 已阅读全部章节 → 进入态势总览</span>' +
        '</div>' +
      '</div>';
    },
    ack() {
      try { sessionStorage.setItem('orps_rules_ack', String(Date.now())); } catch (e) { }
      if (typeof showToast === 'function') showToast('✅ 已确认阅读规则，进入系统');
      if (typeof navigateTo === 'function') navigateTo('situation');
    }
  };

  /* 首次进入（本次会话）自动落到着陆页：仅当系统已登录且未访问过着陆页 */
  window.LANDING_AUTOSHOW = function () {
    try {
      if (!(typeof AUTH !== 'undefined' && AUTH.user)) return;
      if (sessionStorage.getItem('orps_landing_seen')) return;
      sessionStorage.setItem('orps_landing_seen', '1');
      var cur = (typeof window._currentView !== 'undefined') ? window._currentView : 'situation';
      var rulesAck = sessionStorage.getItem('orps_rules_ack');
      if (!rulesAck) { if (typeof navigateTo === 'function') navigateTo('rules'); }
      else if (cur === 'situation' || !cur) { if (typeof navigateTo === 'function') navigateTo('landing'); }
    } catch (e) { }
  };
})();
