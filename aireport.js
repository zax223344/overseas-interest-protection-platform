/* ============================================================
 * aireport.js — AI 情报分析报告独立模块（2026-09-01 深度重设计 v4）
 * 分析工具 / AI情报分析报告
 *
 * 深度分层专业情报分析报告（用户指令：既要有客观事实，也要有主观分析，
 * 既要有数据支撑，也要有案例分析）：
 *  ① BLUF 要点摘要（事实汇编官 LLM 归纳，客观）
 *  ② 态势综述（系统数据装配 + Chart.js 图表，客观）
 *  ③ 重点事件事实层（真实预警按价值排序的时间线 + 五要素，客观）
 *  ④ 分析研判层（资深情报分析师 LLM：趋势/动因/影响/情景推演，主观）
 *  ⑤ 案例分析层（案例研究员 LLM 深度剖析 2-3 个典型事件，主观）
 *  ⑥ 对策建议层（对策参谋 LLM 分对象建议，主观）
 *  ⑦ 数据支撑附录（明细表 + 来源可溯 + 点击下钻，客观）
 *
 * 工程设计：
 *  - 分段多次 LLM 调用（POST /api/llm/report-seg），每段独立 persona system
 *    prompt，任一段失败独立降级本地引擎，不影响其他段；
 *  - 每段标注来源徽标「客观事实 / 分析研判」，人工审阅时可分节通过/驳回重生成；
 *  - 报告详情为全页视图：左侧分节锚点导航 + 内嵌图表 + 分节审阅操作；
 *  - 零模拟数据铁律：所有数据段真实装配，LLM 段数据不足须明说置信度低。
 * ============================================================ */

var AIREPORT = {
  _cartKey: 'orps_aireport_cart',
  _materialCart: null,
  _charts: {},          /* 详情页 Chart.js 实例登记（销毁防泄漏） */
  _currentDetailId: '', /* 当前打开的详情报告 id（重生成后局部刷新用） */

  /* ===== 深度报告段定义（与服务端 _DEEP_SEGS 对齐）===== */
  _segDefs: [
    { key: 'fact',     nm: 'BLUF 要点摘要', pers: '事实汇编官' },
    { key: 'trend',    nm: '趋势研判',     pers: '资深情报分析师' },
    { key: 'drivers',  nm: '动因分析',     pers: '资深情报分析师' },
    { key: 'impact',   nm: '影响评估',     pers: '资深情报分析师' },
    { key: 'scenario', nm: '情景推演',     pers: '资深情报分析师' },
    { key: 'case',     nm: '案例分析',     pers: '案例研究员' },
    { key: 'advice',   nm: '对策建议',     pers: '对策参谋' }
  ],

  /* ===== 初始化 ===== */
  init() {
    this._loadCart();
    if (typeof INTELCENTER !== 'undefined' && INTELCENTER._aiReportInit) {
      INTELCENTER._aiReportInit();
    }
    this._styleInit();
    this.render();
  },

  /* ===== 素材收集篮持久化 ===== */
  _loadCart() {
    if (this._materialCart === null) {
      try {
        var saved = localStorage.getItem(this._cartKey);
        this._materialCart = saved ? JSON.parse(saved) : [];
      } catch (e) {
        this._materialCart = [];
      }
    }
  },

  _saveCart() {
    try {
      localStorage.setItem(this._cartKey, JSON.stringify(this._materialCart));
    } catch (e) {}
    this._updateBadge();
  },

  _updateBadge() {
    var badge = document.getElementById('sb-aireport-count');
    if (badge) {
      var n = this._materialCart ? this._materialCart.length : 0;
      badge.textContent = n;
      badge.classList.toggle('zero', n === 0);
    }
  },

  /* ===== 全局入口: 从任意页面添加素材 ===== */
  addMaterial(type, data) {
    this._loadCart();
    var sourceLabels = {
      alert: '预警中心',
      event: '事件追踪',
      case: '典型案例',
      country: '国家风险',
      enterprise: '企业资产',
      threat: '威胁组织',
      osint: '开源情报',
      fusion: '风险融合',
      collected: '采集库'
    };
    var material = {
      id: 'CART-' + type + '-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      source: sourceLabels[type] || '其他',
      title: (data.title || data.name || data.t || '').toString(),
      country: (data.country || data.cty || '').toString(),
      date: (data.date || data.time || data.yr || '').toString(),
      severity: (data.severity || data.level || data.l || '').toString(),
      desc: (data.desc || data.d || data.description || data.detail || data.background || '').toString(),
      type: type
    };
    /* 去重: 同来源+同标题 */
    var exists = this._materialCart.some(function (m) {
      return m.title === material.title && m.source === material.source;
    });
    if (exists) {
      showToast('该素材已在收集篮中');
      return;
    }
    this._materialCart.push(material);
    this._saveCart();
    showToast('已加入情报分析素材收集篮（共 ' + this._materialCart.length + ' 个素材）');
  },

  /* ===== 便捷方法: 通过 ID 添加 ===== */
  addAlertMaterial(id) {
    if (typeof ALERTS === 'undefined') return;
    var a = ALERTS.find(function (x) { return x.id === id; });
    if (!a) return;
    this.addMaterial('alert', {
      title: a.title, country: a.country, date: a.time,
      severity: a.level, desc: a.desc
    });
  },

  addEventMaterial(id) {
    if (typeof EVENTS === 'undefined') return;
    var e = EVENTS.find(function (x) { return x.id === id; });
    if (!e) return;
    this.addMaterial('event', {
      title: e.title, country: e.country, date: e.date,
      severity: e.sev, desc: e.desc
    });
  },

  addCaseMaterial(idx) {
    if (typeof MATRIX === 'undefined' || !MATRIX._cases || !MATRIX._cases[idx]) return;
    var c = MATRIX._cases[idx];
    this.addMaterial('case', {
      title: c.t, country: c.cty, date: c.yr,
      severity: c.l, desc: c.d
    });
  },

  addAlertCaseMaterial(idx) {
    if (typeof AVIEW === 'undefined' || !AVIEW._alertCases || !AVIEW._alertCases[idx]) return;
    var c = AVIEW._alertCases[idx];
    this.addMaterial('case', {
      title: c.t, country: c.cty, date: c.yr,
      severity: c.level, desc: c.bg
    });
  },

  addCountryMaterial(name) {
    if (typeof COUNTRIES === 'undefined') return;
    var c = COUNTRIES.find(function (x) { return x.name === name; });
    if (!c) return;
    var ov = typeof calcOverall === 'function' ? calcOverall(c.scores) : 0;
    this.addMaterial('country', {
      title: c.name + ' 风险评估', country: c.name, date: '',
      severity: ov >= 8 ? '极高' : ov >= 6 ? '高' : ov >= 4 ? '中高' : '低',
      desc: c.notes || ''
    });
  },

  addEnterpriseMaterial(id) {
    if (typeof ENTERPRISES === 'undefined') return;
    var e = typeof id === 'number' ?
      ENTERPRISES.find(function (x) { return x.id === id; }) :
      ENTERPRISES.find(function (x) { return x.name === id || x.short === id; });
    if (!e) return;
    this.addMaterial('enterprise', {
      title: e.name, country: (e.countries || []).join('、'), date: '',
      severity: '', desc: e.industry + ' | 总部:' + e.hq + ' | 投资:' + e.investment + '亿$'
    });
  },

  addThreatMaterial(orgId) {
    if (typeof THREAT_DATA !== 'undefined' && THREAT_DATA.organizations) {
      var o = THREAT_DATA.organizations.find(function (x) { return x.id === orgId; });
      if (o) {
        this.addMaterial('threat', {
          title: o.name, country: (o.operatingRegions || []).join('、'), date: o.founded || '',
          severity: o.threatLevel ? (o.threatLevel >= 8 ? '极高' : o.threatLevel >= 6 ? '高' : '中') : '',
          desc: o.description || ''
        });
      }
    }
  },

  /* ===== 移除/清空 ===== */
  removeMaterial(idx) {
    this._loadCart();
    this._materialCart.splice(idx, 1);
    this._saveCart();
    this.render();
  },

  clearCart() {
    this._materialCart = [];
    this._saveCart();
    this.render();
    showToast('素材收集篮已清空');
  },

  /* ===== 基于收集篮创建报告 ===== */
  createFromCart() {
    this._loadCart();
    if (this._materialCart.length === 0) {
      showToast('收集篮为空，请先从系统中收集素材');
      return;
    }
    if (!PERM.canUpload()) {
      showToast('请先登录');
      return;
    }
    INTELCENTER._selectedMaterials = this._materialCart.map(function (m) {
      return {
        id: m.id, source: m.source, title: m.title, country: m.country,
        date: m.date, severity: m.severity, desc: m.desc
      };
    });
    INTELCENTER._allMaterials = INTELCENTER._gatherMaterials();
    INTELCENTER.showAiReportForm(null, true);
  },

  /* ===== 主渲染（报告列表页）===== */
  render() {
    var el = document.getElementById('aireport-content');
    if (!el) return;
    this._loadCart();
    if (typeof INTELCENTER !== 'undefined') INTELCENTER._aiReportInit();
    this._currentDetailId = '';
    this._destroyCharts();

    if (!PERM.canUpload()) {
      el.innerHTML = '<div class="empty"><div class="ic">🔒</div><div>请先登录后使用AI情报分析报告功能</div></div>';
      return;
    }

    var reports = (typeof INTELCENTER !== 'undefined' && INTELCENTER._aiReports) ? INTELCENTER._aiReports : [];
    var cart = this._materialCart;
    var html = '';

    /* 素材收集篮 */
    html += '<div class="card mb-12" style="border:1px solid rgba(0,212,255,0.25)">';
    html += '<div class="card-tt"><span class="ic">🛒</span>情报分析素材收集篮';
    html += '<span class="badge b-blue" style="margin-left:8px">' + cart.length + '</span>';
    html += '<span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:8px">— 在预警中心、案例分析等页面点击"🤖 加入情报分析"按钮收集素材</span>';
    html += '</div>';

    if (cart.length > 0) {
      html += '<div style="display:grid;gap:4px;margin-bottom:10px;max-height:220px;overflow-y:auto">';
      cart.forEach(function (m, i) {
        var sevText = m.severity || '';
        var sevClr = (sevText.indexOf('极高') >= 0 || sevText === 'critical' || sevText === 'red') ? 'var(--red)' :
                     (sevText.indexOf('高') >= 0 || sevText === 'high' || sevText === 'orange') ? 'var(--orange)' :
                     (sevText.indexOf('中') >= 0 || sevText === 'medium' || sevText === 'yellow') ? 'var(--yellow)' :
                     'var(--text3)';
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--panel2);border-radius:6px;font-size:11px">';
        html += '<span class="badge b-blue" style="font-size:9px;min-width:60px;text-align:center">' + m.source + '</span>';
        html += '<div style="flex:1;min-width:0">';
        html += '<div style="font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (m.title || '').substring(0, 60) + '</div>';
        html += '<div style="font-size:9px;color:var(--text3)">' + (m.country || '') + (m.date ? ' | ' + m.date : '') + (sevText ? ' | <span style="color:' + sevClr + ';font-weight:600">' + sevText + '</span>' : '') + '</div>';
        html += '</div>';
        html += '<button class="btn sm danger" style="font-size:9px;padding:1px 6px;min-width:auto" onclick="AIREPORT.removeMaterial(' + i + ')">✕</button>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div style="display:flex;gap:8px">';
      html += '<button class="btn primary sm" onclick="AIREPORT.createFromCart()">🤖 基于收集素材创建报告</button>';
      html += '<button class="btn sm" onclick="AIREPORT.clearCart()">🗑️ 清空收集篮</button>';
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px">';
      html += '收集篮为空。请在预警中心、案例分析、事件追踪等页面点击"🤖 加入情报分析"按钮收集素材，';
      html += '也可直接点击下方"新建情报分析报告"在表单中选择素材。';
      html += '</div>';
    }
    html += '</div>';

    /* 统计概览 */
    var stDeep = reports.filter(function (r) { return r.deep; }).length;
    var stCritical = reports.filter(function (r) { return r.threatLevel === 'critical'; }).length;
    var stHigh = reports.filter(function (r) { return r.threatLevel === 'high'; }).length;
    var now = new Date();
    var stMonth = reports.filter(function (r) {
      var d = new Date(r.createTime);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    html += '<div class="stat-grid">';
    var stats = [
      { ic: '📋', c: 'var(--cyan)', l: '报告总数', v: reports.length },
      { ic: '🧠', c: 'var(--purple)', l: '深度分层报告', v: stDeep },
      { ic: '🔴', c: 'var(--red)', l: '紧急报告', v: stCritical },
      { ic: '📅', c: 'var(--green)', l: '本月报告', v: stMonth }
    ];
    stats.forEach(function (s) {
      html += '<div class="stat-card"><div class="stat-ic" style="background:rgba(0,212,255,0.08);color:' + s.c + '">' + s.ic + '</div><div class="stat-info"><div class="stat-label">' + s.l + '</div><div class="stat-val" style="color:' + s.c + '">' + s.v + '</div></div></div>';
    });
    html += '</div>';

    /* 报告列表 */
    html += '<div class="card mt-12"><div class="card-tt"><span class="ic">🤖</span>AI情报分析报告';
    html += '<span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:6px">— 深度分层研判：客观事实+主观分析+数据支撑+案例分析，四分析师七段生成</span>';
    html += '</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:12px;color:var(--text3)">共 ' + reports.length + ' 份报告 | 管理员和注册用户均可使用</span>';
    html += '<button class="btn primary sm" onclick="INTELCENTER.showAiReportForm()">➕ 新建情报分析报告</button>';
    html += '</div>';

    if (reports.length === 0) {
      html += '<div class="empty"><div class="ic">📝</div>';
      html += '<div style="font-size:13px;margin-bottom:4px">暂无情报分析报告</div>';
      html += '<div style="font-size:11px">点击"新建情报分析报告"，选国家+窗口装配真实数据后，AI 将生成 BLUF/态势综述/事实层/研判层/案例分析/对策建议的分层深度报告</div></div>';
    } else {
      html += '<div style="display:grid;gap:8px;max-height:500px;overflow-y:auto">';
      reports.forEach(function (r) {
        var lvClr = r.threatLevel === 'critical' ? 'var(--red)' :
                    r.threatLevel === 'high' ? 'var(--orange)' :
                    r.threatLevel === 'medium' ? 'var(--yellow)' : 'var(--green)';
        var lvLabel = r.threatLevel === 'critical' ? '🔴 紧急' :
                      r.threatLevel === 'high' ? '🟠 高危' :
                      r.threatLevel === 'medium' ? '🟡 中危' : '🟢 低危';
        var summary = '';
        if (r.deep && r.deep.bluf && r.deep.bluf.items && r.deep.bluf.items.length) {
          summary = r.deep.bluf.items[0] || '';
        } else {
          summary = r.summary || '';
        }
        summary = String(summary).substring(0, 120);
        if (summary.length >= 120) summary += '...';

        var deepBadge = r.deep ? '<span style="font-size:9px;font-weight:600;color:#c084fc;padding:1px 6px;background:rgba(168,85,247,0.12);border-radius:3px">🧠 深度分层</span>' : '';
        var rvBadge = r.deep ? (r.reviewStatus === 'approved'
          ? '<span style="font-size:9px;font-weight:600;color:var(--green);padding:1px 6px;background:rgba(0,255,159,0.1);border-radius:3px">✅ 已审定</span>'
          : '<span style="font-size:9px;font-weight:600;color:var(--yellow);padding:1px 6px;background:rgba(234,179,8,0.1);border-radius:3px">⏳ 待审阅</span>') : '';

        html += '<div style="padding:12px;background:var(--panel2);border-radius:8px;border-left:3px solid ' + lvClr + ';transition:.2s;cursor:pointer" onclick="INTELCENTER.showAiReportDetail(\'' + r.id + '\')">';
        html += '<div style="display:flex;justify-content:space-between;align-items:start">';
        html += '<div style="flex:1">';
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">';
        html += '<span style="font-size:10px;font-weight:700;color:' + lvClr + '">' + lvLabel + '</span>';
        html += deepBadge + rvBadge;
        html += '<span style="font-size:12px;font-weight:700">[' + r.id + '] ' + r.title + '</span>';
        html += '</div>';
        html += '<div style="font-size:11px;color:var(--text2);margin-bottom:4px">' + summary + '</div>';
        html += '<div style="display:flex;gap:10px;font-size:9px;color:var(--text3);flex-wrap:wrap">';
        html += '<span>📅 ' + (r.createTime || '') + '</span>';
        html += '<span>👤 ' + (r.author || '') + '</span>';
        html += '<span>🎯 ' + (r.country || '') + (r.window ? '（近' + r.window + '）' : '') + '</span>';
        html += '<span>📌 ' + (r.materials ? r.materials.length : 0) + '个素材</span>';
        html += '<span>🏷️ ' + (r.reportType || '') + '</span>';
        html += '</div></div>';
        html += '<div style="display:flex;flex-direction:column;gap:4px;margin-left:8px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm" style="font-size:9px;padding:2px 8px;min-width:auto" onclick="INTELCENTER.exportAiReport(\'' + r.id + '\')">📥</button>';
        html += '<button class="btn sm" style="font-size:9px;padding:2px 8px;min-width:auto;color:var(--cyan)" onclick="INTELCENTER.showAiReportForm(\'' + r.id + '\')">✏️</button>';
        html += '<button class="btn sm danger" style="font-size:9px;padding:2px 8px;min-width:auto" onclick="AIREPORT.deleteReport(\'' + r.id + '\')">🗑️</button>';
        html += '</div></div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    el.innerHTML = html;
    this._updateBadge();
  },

  /* ===== 删除报告 ===== */
  deleteReport(id) {
    if (!PERM.canUpload()) { showToast('权限不足'); return; }
    showConfirm('确定删除该情报分析报告？', function () {
      if (typeof INTELCENTER !== 'undefined') {
        INTELCENTER._aiReports = INTELCENTER._aiReports.filter(function (r) { return r.id !== id; });
        INTELCENTER._aiReportSave();
      }
      AIREPORT.render();
      showToast('已删除报告');
    });
  },

  /* ============================================================
   * ============ 深度分层报告引擎（2026-09-01 重设计）============
   * ============================================================ */

  _findReport(id) {
    if (typeof INTELCENTER === 'undefined' || !INTELCENTER._aiReports) return null;
    return INTELCENTER._aiReports.find(function (r) { return r.id === id; }) || null;
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _escId(x) {
    return String(x == null ? '' : x).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  },

  /* 样式注入（一次） */
  _styleInit() {
    if (document.getElementById('air-deep-style')) return;
    var s = document.createElement('style');
    s.id = 'air-deep-style';
    s.textContent = [
      '.air-report{padding:14px}',
      '.air-report a{cursor:pointer}',
      '.air-toc{width:170px;flex-shrink:0;position:sticky;top:60px;align-self:flex-start;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 8px;display:flex;flex-direction:column;gap:2px}',
      '.air-toc-tt{font-size:10px;font-weight:700;color:var(--text3);padding:0 6px 6px;border-bottom:1px solid var(--border);margin-bottom:4px;letter-spacing:1px}',
      '.air-toc-a{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:5px;font-size:11px;color:var(--text2);text-decoration:none;transition:.15s}',
      '.air-toc-a:hover{background:rgba(0,212,255,0.08);color:var(--cyan)}',
      '.air-toc-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}',
      '.air-sec{margin-bottom:14px;scroll-margin-top:64px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px}',
      '.air-sec-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--border)}',
      '.air-sec-tt{font-size:13px;font-weight:700;color:var(--text)}',
      '.air-badge{font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap}',
      '.air-bdg-fact{color:#00d4ff;background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.3)}',
      '.air-bdg-ana{color:#ffaa00;background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.3)}',
      '.air-bdg-src{font-size:9px;color:var(--text3);padding:2px 6px;background:var(--bg2);border-radius:8px;white-space:nowrap}',
      '.air-text{font-size:12px;line-height:1.8;color:var(--text2);white-space:pre-wrap}',
      '.air-bluf{margin:0;padding-left:20px}',
      '.air-bluf li{font-size:12.5px;line-height:1.9;color:var(--text2);margin-bottom:4px}',
      '.air-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--text2);margin:0 6px 6px 0}',
      '.air-chip b{font-size:14px}',
      '.air-ev{padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;border-left:3px solid var(--cyan)}',
      '.air-ev-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
      '.air-ev5{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px}',
      '.air-ev5 div{font-size:11px;color:var(--text2);line-height:1.6}',
      '.air-ev5 i{font-style:normal;font-size:9px;color:var(--cyan);font-weight:700;background:rgba(0,212,255,0.08);padding:1px 6px;border-radius:3px;margin-right:6px}',
      '.air-ev-ft{margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:9px;color:var(--text3);display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.air-tbl{width:100%;border-collapse:collapse;font-size:10px}',
      '.air-tbl th{text-align:left;padding:6px 8px;color:var(--cyan);border-bottom:1px solid var(--border);font-weight:700;white-space:nowrap}',
      '.air-tbl td{padding:6px 8px;color:var(--text2);border-bottom:1px solid var(--border)}',
      '.air-tbl tr:hover td{background:rgba(0,212,255,0.05)}',
      '.air-review-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.25);border-radius:8px}',
      '.air-rv-btns{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}'
    ].join('\n');
    document.head.appendChild(s);
  },

  /* ---------- 分段 LLM 调用 ---------- */
  _getToken() {
    try {
      return (typeof APIClient !== 'undefined' && APIClient.getToken) ? APIClient.getToken() : (localStorage.getItem('orps_token') || '');
    } catch (e) { return ''; }
  },

  _callSeg(seg, payload) {
    return fetch('/api/llm/report-seg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this._getToken() },
      body: JSON.stringify({ segment: seg, payload: payload })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.j && res.j.ok) {
          return { ok: true, text: String(res.j.text || ''), model: res.j.model || '', degraded: !!res.j.degraded, error: '' };
        }
        return { ok: false, text: '', model: '', degraded: false, error: String((res.j && res.j.error) || ('HTTP ' + res.status)).slice(0, 80) };
      })
      .catch(function (e) {
        return { ok: false, text: '', model: '', degraded: false, error: (e && e.message) || '网络错误' };
      });
  },

  /* 段结果写入 deep 结构 */
  _applySeg(deep, seg, res) {
    if (!res || !res.ok) return;
    var src = res.degraded ? 'local' : 'llm';
    var model = res.model || '';
    deep.models = deep.models || {};
    deep.degraded = deep.degraded || {};
    deep.models[seg] = model;
    deep.degraded[seg] = !!res.degraded;
    var text = String(res.text || '');
    if (seg === 'fact') {
      var items = [];
      try {
        var m = text.match(/\{[\s\S]*\}/);
        var v = m ? JSON.parse(m[0]) : null;
        if (v && Array.isArray(v.bluf)) items = v.bluf.map(function (x) { return String(x); }).slice(0, 5);
      } catch (e) {}
      if (!items.length) items = ['（BLUF 解析异常，请点击"驳回重生成"）'];
      deep.bluf.items = items; deep.bluf.src = src; deep.bluf.model = model;
    } else if (seg === 'case') {
      deep.cases.text = text; deep.cases.src = src; deep.cases.model = model;
    } else if (seg === 'advice') {
      deep.advice.text = text; deep.advice.src = src; deep.advice.model = model;
    } else if (deep.sections[seg]) {
      deep.sections[seg].text = text; deep.sections[seg].src = src; deep.sections[seg].model = model;
    }
  },

  _applySegError(deep, seg, err) {
    var t = '（本段生成失败：' + String(err || '未知错误') + '。请点击"驳回重生成"重试）';
    if (seg === 'fact') { deep.bluf.items = [t]; deep.bluf.src = 'error'; }
    else if (seg === 'case') { deep.cases.text = t; deep.cases.src = 'error'; }
    else if (seg === 'advice') { deep.advice.text = t; deep.advice.src = 'error'; }
    else if (deep.sections[seg]) { deep.sections[seg].text = t; deep.sections[seg].src = 'error'; }
  },

  _getSec(deep, key) {
    if (!deep) return null;
    if (key === 'fact') return deep.bluf;
    if (key === 'case') return deep.cases;
    if (key === 'advice') return deep.advice;
    return (deep.sections || {})[key] || null;
  },

  /* ---------- 客观数据段构建（零模拟数据：全部来自真实装配） ---------- */

  /* 图表统计：severity 环形 / 类型条形 / 趋势线 / 国别分布 */
  _buildCharts(asm) {
    var WIN_H = { '24h': 24, '72h': 72, '7d': 168 };
    var win = String(asm.win || '72h');
    var cutoff = Date.now() - (WIN_H[win] || 72) * 3600000;
    var countries = asm.countries || [];
    var _t = function (s) { var t = new Date(String(s || '').replace(/-/g, '/')).getTime(); return isNaN(t) ? 0 : t; };
    var pool = (typeof ALERTS !== 'undefined' ? ALERTS : []).filter(function (a) {
      return a && a.time && _t(a.time) >= cutoff && countries.indexOf(String(a.country || '')) >= 0;
    });
    var severity = { red: 0, orange: 0, yellow: 0, blue: 0 };
    var byType = {}, byCountry = {};
    pool.forEach(function (a) {
      if (a.level === 'red') severity.red++;
      else if (a.level === 'orange') severity.orange++;
      else if (a.level === 'yellow') severity.yellow++;
      else severity.blue++;
      var t = a.type || '其他'; byType[t] = (byType[t] || 0) + 1;
      var c = a.country || '其他'; byCountry[c] = (byCountry[c] || 0) + 1;
    });
    /* 趋势分桶：24h→8×3h；72h→12×6h；7d→7×1d */
    var nb = win === '24h' ? 8 : (win === '7d' ? 7 : 12);
    var bh = (WIN_H[win] || 72) / nb;
    var now = Date.now();
    var buckets = [], labels = [];
    for (var i = nb - 1; i >= 0; i--) {
      buckets.push(0);
      var d = new Date(now - (i + 1) * bh * 3600000);
      labels.push((d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + '时');
    }
    pool.forEach(function (a) {
      var t = _t(a.time); if (!t) return;
      var ageH = (now - t) / 3600000; if (ageH < 0) ageH = 0;
      var idx = nb - 1 - Math.floor(ageH / bh);
      if (idx < 0) idx = 0; if (idx >= nb) idx = nb - 1;
      buckets[idx]++;
    });
    var types = Object.keys(byType).map(function (k) { return { name: k, count: byType[k] }; })
      .sort(function (x, y) { return y.count - x.count; }).slice(0, 8);
    var countryDist = Object.keys(byCountry).map(function (k) { return { name: k, count: byCountry[k] }; })
      .sort(function (x, y) { return y.count - x.count; }).slice(0, 6);
    var fs = asm.foresee || {};
    return {
      severity: severity, types: types, countryDist: countryDist,
      trend: { labels: labels, data: buckets },
      cmp: { r3: (fs.r3 != null ? fs.r3 : null), p3: (fs.p3 != null ? fs.p3 : null) }
    };
  },

  /* 重点事件事实层：TOP 事件时间线 + 五要素（从真实事件文本归纳，未明示则如实标注） */
  _buildTimeline(asm) {
    var P_RX = /(塔利班|青年党|博科圣地|伊斯兰国|基地组织|胡塞武装|真主党|哈马斯|俾路支|分离武装|武装分子|政府军|警方|反对派|军方|安全部队|叛军|警察|军方部队)/;
    var self = this;
    return (asm.events || []).slice(0, 8).map(function (e) {
      var a = null;
      try { a = (typeof _findAlertAny === 'function') ? _findAlertAny(e.id) : null; } catch (err) {}
      if (!a && typeof ALERTS !== 'undefined') {
        a = ALERTS.find(function (x) { return String(x.id) === String(e.id); }) || null;
      }
      var txt = String((a && (a.desc || a.detail)) || e.title || '');
      var who = (txt.match(P_RX) || [])[0] || '事件文本未明示';
      var pm = txt.match(/(?:在|于)([^，。；;,.]{2,10}?(?:省|州|市|港|机场|车站|铁路|矿区|营地|边境|首都|海域|海峡))/);
      var where = pm ? pm[1] : '具体点位未明示';
      var rm = txt.match(/(?:造成|致|导致)([^。；;]{2,26})/);
      var outcome = rm ? rm[1].slice(0, 24) : '后果未明示（文本无伤亡/损失表述）';
      return {
        id: e.id, time: e.time || '时间不详', level: e.level || '—', type: e.type || '—',
        score: e.score, source: e.source || '—', extra: !!e.extra,
        what: String(e.title || '').replace(/[\r\n]+/g, ' ').slice(0, 90),
        who: who, where: where, outcome: outcome
      };
    });
  },

  /* ---------- 深度生成主入口（接管 INTELCENTER._aiGenerate） ---------- */
  deepGenerate() {
    var self = this;
    if (!PERM.canUpload()) { showToast('⚠️ 请先登录'); return; }
    var countryEl = document.getElementById('aireport-country');
    var winEl = document.getElementById('aireport-win');
    var country = countryEl ? String(countryEl.value || '').trim() : '';
    var win = winEl ? String(winEl.value || '72h') : '72h';
    if (!country) { showToast('⚠️ 请先选择关注国家'); return; }
    var asm = INTELCENTER._aiAssembly;
    if (!asm || String(asm.country) !== country || String(asm.win) !== String(win)) {
      showToast('🔍 正在装配系统数据，完成后自动发起分层研判…');
      INTELCENTER._aiAssemble(function (ok) {
        if (ok) self.deepGenerate();
        else showToast('⚠️ 数据装配失败，请确认已选择国家');
      });
      return;
    }
    /* 组装分段 payload（事件附带真实摘要供案例分析使用） */
    var evRich = (asm.events || []).slice(0, 8).map(function (e) {
      var a = null;
      try { a = (typeof _findAlertAny === 'function') ? _findAlertAny(e.id) : null; } catch (err) {}
      var desc = '';
      if (a) desc = String(a.desc || a.detail || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
      return { id: e.id, title: e.title, time: e.time, level: e.level, type: e.type, source: e.source, country: e.country, score: e.score, desc: desc };
    });
    var typeEl = document.getElementById('aireport-type');
    var payload = {
      country: asm.country, win: asm.win, reportType: typeEl ? typeEl.value : '',
      stats: asm.stats, events: evRich, foresee: asm.foresee,
      cosri: asm.cosri ? { overall: asm.cosri.overall, scores: asm.cosri.scores, projects: asm.cosri.projects, guide: asm.cosri.guide } : null,
      clusters: asm.clusters,
      assets: (asm.assets || []).map(function (a) { return a.name; }),
      orgs: asm.orgs
    };
    /* 进度 UI */
    var btn = document.getElementById('aireport-gen-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '🤖 分层研判中…'; }
    var prog = this._progPanel();
    var state = {};
    var batches = [['fact', 'trend', 'drivers'], ['impact', 'scenario', 'case'], ['advice']];
    var runB = function (bi) {
      if (bi >= batches.length) { self._finishDeep(payload, state); return; }
      batches[bi].forEach(function (sg) { state[sg] = { status: 'run' }; });
      self._progUpdate(prog, state);
      Promise.all(batches[bi].map(function (sg) {
        return self._callSeg(sg, payload).then(function (res) {
          state[sg] = res.ok ? { status: 'ok', res: res } : { status: 'fail', err: res.error };
          self._progUpdate(prog, state);
          return res;
        });
      })).then(function () { runB(bi + 1); });
    };
    runB(0);
  },

  _progPanel() {
    var el = document.getElementById('aireport-deep-prog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aireport-deep-prog';
      var anchor = document.getElementById('aireport-gen-model');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
      else {
        var view = document.getElementById('aireport-assemble-view');
        if (view && view.parentNode) view.parentNode.appendChild(el);
      }
    }
    el.innerHTML = '<div style="padding:8px 10px;border:1px dashed rgba(168,85,247,0.4);border-radius:6px;font-size:10px;color:#c084fc;margin-bottom:8px">🧠 深度分层研判中（四分析师 · 七段生成，每段独立降级）…</div>';
    return el;
  },

  _progUpdate(el, state) {
    if (!el) return;
    var self = this;
    var rows = this._segDefs.map(function (d) {
      var st = state[d.key];
      var mark = !st ? '⏳' :
        st.status === 'run' ? '<span style="color:var(--cyan)">⟳ 生成中</span>' :
        st.status === 'ok' ? (st.res.degraded ? '<span style="color:var(--yellow)">⚠️ 本地降级</span>' : '<span style="color:var(--green)">✅ ' + self._esc(st.res.model || '') + '</span>') :
        '<span style="color:var(--red)">❌ ' + self._esc(st.err || '') + '</span>';
      return '<div style="display:flex;gap:8px;padding:2px 0"><span style="min-width:90px;color:var(--text2)">' + d.nm + '</span><span style="min-width:80px;color:var(--text3)">' + d.pers + '</span><span>' + mark + '</span></div>';
    }).join('');
    el.innerHTML = '<div style="padding:10px;border:1px solid rgba(168,85,247,0.35);border-radius:6px;background:rgba(168,85,247,0.05);margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:700;color:#c084fc;margin-bottom:6px">🧠 深度分层研判中（四分析师 · 七段生成）</div>' + rows + '</div>';
  },

  _finishDeep(payload, state) {
    var self = this;
    var asm = INTELCENTER._aiAssembly;
    var deep = {
      v: 1,
      genAt: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').substring(0, 16),
      models: {}, degraded: {},
      bluf: { nm: 'BLUF 要点摘要', items: [], src: 'local', model: '', status: 'pending' },
      charts: this._buildCharts(asm),
      timeline: this._buildTimeline(asm),
      sections: {
        trend: { nm: '趋势研判', text: '', src: 'local', model: '', status: 'pending' },
        drivers: { nm: '动因分析', text: '', src: 'local', model: '', status: 'pending' },
        impact: { nm: '影响评估', text: '', src: 'local', model: '', status: 'pending' },
        scenario: { nm: '情景推演', text: '', src: 'local', model: '', status: 'pending' }
      },
      cases: { nm: '案例分析', text: '', src: 'local', model: '', status: 'pending' },
      advice: { nm: '对策建议', text: '', src: 'local', model: '', status: 'pending' },
      payload: payload
    };
    var okN = 0, failN = 0, degN = 0;
    Object.keys(state).forEach(function (sg) {
      var st = state[sg];
      if (st.status === 'ok') { okN++; self._applySeg(deep, sg, st.res); if (st.res.degraded) degN++; }
      else if (st.status === 'fail') { failN++; self._applySegError(deep, sg, st.err); }
    });
    /* 回填传统表单字段（兼容保存/导出/旧视图） */
    var set = function (id, v) { var el = document.getElementById(id); if (el && v != null) el.value = String(v); };
    set('aireport-summary', (deep.bluf.items || []).join('\n'));
    set('aireport-threat', [deep.sections.trend.text, deep.sections.drivers.text].filter(Boolean).join('\n\n'));
    set('aireport-impact', [deep.sections.impact.text, deep.sections.scenario.text].filter(Boolean).join('\n\n'));
    set('aireport-advice', deep.advice.text || '');
    var titleEl = document.getElementById('aireport-title');
    if (titleEl && !titleEl.value.trim()) {
      titleEl.value = payload.country + '安全态势深度研判报告（近' + payload.win + '）';
    }
    /* 引擎摘要 */
    var llmN = okN - degN;
    deep.engine = (llmN > 0 ? '云端LLM×' + llmN + '段' : '') + (degN > 0 ? (llmN > 0 ? ' + ' : '') + '本地降级×' + degN + '段' : '') + (failN > 0 ? ' + 失败×' + failN + '段' : '') || '—';
    /* 保存（复用原保存逻辑：读取表单+装配，创建报告） */
    var btn = document.getElementById('aireport-gen-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '🤖 LLM 智能研判'; }
    INTELCENTER.saveAiReport(null);
    var r = INTELCENTER._aiReports[0];
    if (!r || r.deep) { showToast('⚠️ 报告保存异常，请重试'); return; }
    r.deep = deep;
    r.reportMode = 'deep';
    r.summary = (deep.bluf.items || []).join('\n');
    r.threatAnalysis = [deep.sections.trend.text, deep.sections.drivers.text].filter(Boolean).join('\n\n');
    r.impactAnalysis = [deep.sections.impact.text, deep.sections.scenario.text].filter(Boolean).join('\n\n');
    r.advice = deep.advice.text || '';
    r.genModel = deep.engine;
    r.reviewStatus = 'pending';
    INTELCENTER._lastGenModel = deep.engine;
    this._persist(r);
    showToast('✅ 深度研判完成：' + okN + '段成功' + (degN ? '（' + degN + '段本地降级）' : '') + (failN ? '，' + failN + '段失败可重生成' : ''));
    this.openDetail(r.id);
  },

  /* ---------- 报告详情全页视图（接管 INTELCENTER.showAiReportDetail） ---------- */
  openDetail(id) {
    var r = this._findReport(id);
    if (!r) { showToast('⚠️ 报告不存在'); return; }
    if (!r.deep) { /* 旧版报告：回落旧弹窗详情 */
      if (this._origDetail) { this._origDetail(id); return; }
    }
    var el = document.getElementById('aireport-content');
    if (!el) { if (this._origDetail) { this._origDetail(id); return; } return; }
    this._currentDetailId = id;
    this._destroyCharts();
    var d = r.deep;
    var self = this;
    var st = (r.dataSupport && r.dataSupport.stats) || (d.payload && d.payload.stats) || {};
    var win = r.window || (d.payload && d.payload.win) || '72h';

    var lvClr = r.threatLevel === 'critical' ? 'var(--red)' : r.threatLevel === 'high' ? 'var(--orange)' : r.threatLevel === 'medium' ? 'var(--yellow)' : 'var(--green)';
    var lvLabel = r.threatLevel === 'critical' ? '🔴 紧急' : r.threatLevel === 'high' ? '🟠 高危' : r.threatLevel === 'medium' ? '🟡 中危' : '🟢 低危';

    /* 审阅统计 */
    var rvKeys = ['fact', 'trend', 'drivers', 'impact', 'scenario', 'case', 'advice'];
    var approvedN = 0, totalN = rvKeys.length;
    rvKeys.forEach(function (k) { var s = self._getSec(d, k); if (s && s.status === 'approved') approvedN++; });
    var rvPassed = r.reviewStatus === 'approved';

    var html = '<div class="card air-report" id="air-report-page">';

    /* 头部 */
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">';
    html += '<button class="btn sm" onclick="AIREPORT.render()">← 返回列表</button>';
    html += '<span style="font-size:10px;font-weight:700;color:' + lvClr + ';padding:2px 8px;background:' + lvClr + '15;border-radius:4px">' + lvLabel + '</span>';
    html += '<span style="font-size:15px;font-weight:700">' + this._esc(r.title) + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:12px;font-size:10px;color:var(--text3);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
      '<span>📅 ' + this._esc(r.createTime || '') + '</span>' +
      '<span>👤 ' + this._esc(r.author || '') + '</span>' +
      '<span>🎯 ' + this._esc(r.country || '') + '（近' + this._esc(win) + '）</span>' +
      '<span>📋 ' + this._esc(r.reportType || '') + '</span>' +
      '<span style="color:#c084fc">🧠 深度分层报告 · ' + this._esc(d.engine || '') + '</span>' +
      '<span style="color:var(--text3)">生成于 ' + this._esc(d.genAt || '') + '</span>' +
      '</div>';

    /* 审阅操作栏 */
    html += '<div class="air-review-bar">' +
      '<span style="font-size:12px;color:var(--text2)">人工审阅：<b style="color:' + (rvPassed ? 'var(--green)' : 'var(--yellow)') + '">' + (rvPassed ? '✅ 已审定' : '⏳ 待审阅') + '</b>（' + approvedN + '/' + totalN + ' 节已通过）</span>' +
      '<div class="air-rv-btns">' +
      '<button class="btn sm primary" onclick="AIREPORT._approveAll(\'' + this._escId(id) + '\')">✅ 整体审阅通过</button>' +
      '<button class="btn sm" style="color:var(--cyan)" onclick="AIREPORT._regenAll(\'' + this._escId(id) + '\')">↻ 全部重新生成</button>' +
      '<button class="btn sm" onclick="INTELCENTER.exportAiReport(\'' + this._escId(id) + '\')">📥 导出</button>' +
      '<button class="btn sm" onclick="INTELCENTER.showAiReportForm(\'' + this._escId(id) + '\')">✏️ 编辑</button>' +
      '</div></div>';

    /* 主体：左目录 + 右内容 */
    html += '<div style="display:flex;gap:12px;align-items:flex-start">';
    html += '<div class="air-toc"><div class="air-toc-tt">报告目录</div>';
    var TOC = [
      { key: 'bluf', nm: '① BLUF 要点摘要', rv: 'fact' },
      { key: 'overview', nm: '② 态势综述', rv: null },
      { key: 'events', nm: '③ 重点事件事实层', rv: null },
      { key: 'analysis', nm: '④ 分析研判层', rv: null },
      { key: 'cases', nm: '⑤ 案例分析层', rv: 'case' },
      { key: 'advice', nm: '⑥ 对策建议层', rv: 'advice' },
      { key: 'appendix', nm: '⑦ 数据支撑附录', rv: null }
    ];
    TOC.forEach(function (t) {
      var dot = '';
      if (t.rv) {
        var s = self._getSec(d, t.rv);
        var c = !s ? 'var(--text3)' : s.status === 'approved' ? 'var(--green)' : s.status === 'generating' ? 'var(--cyan)' : s.status === 'error' ? 'var(--red)' : 'var(--yellow)';
        dot = '<span class="air-toc-dot" style="background:' + c + '"></span>';
      }
      html += '<a class="air-toc-a" onclick="document.getElementById(\'air-sec-' + t.key + '\').scrollIntoView({behavior:\'smooth\',block:\'start\'})">' + dot + t.nm + '</a>';
    });
    html += '</div>';

    html += '<div style="flex:1;min-width:0">';

    /* ① BLUF */
    var bluf = d.bluf || {};
    html += '<div class="air-sec" id="air-sec-bluf">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">① BLUF 要点摘要</span>' +
      '<span class="air-badge air-bdg-fact">客观事实 · 事实汇编官归纳</span>' + this._srcTag(bluf) + this._rvBtns(id, 'fact', bluf) + '</div>';
    html += '<ol class="air-bluf">';
    (bluf.items || []).forEach(function (b) {
      html += '<li>' + self._esc(b) + '</li>';
    });
    html += '</ol>';
    html += '<div style="font-size:9px;color:var(--text3);margin-top:6px">— Bottom Line Up Front：决策者 30 秒了解全局的核心要点</div>';
    html += '</div>';

    /* ② 态势综述 */
    var ch = d.charts || {};
    var sev = ch.severity || { red: 0, orange: 0, yellow: 0, blue: 0 };
    var fs = (d.payload && d.payload.foresee) || {};
    html += '<div class="air-sec" id="air-sec-overview">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">② 态势综述</span><span class="air-badge air-bdg-fact">客观事实 · 系统数据装配</span></div>';
    html += '<div style="margin-bottom:8px">';
    html += '<span class="air-chip">窗口预警总量 <b style="color:var(--cyan)">' + (st.total || 0) + '</b></span>';
    html += '<span class="air-chip"><b style="color:var(--red)">' + (sev.red || 0) + '</b> 红</span>';
    html += '<span class="air-chip"><b style="color:var(--orange)">' + (sev.orange || 0) + '</b> 橙</span>';
    html += '<span class="air-chip"><b style="color:#eab308">' + (sev.yellow || 0) + '</b> 黄</span>';
    html += '<span class="air-chip"><b style="color:var(--cyan)">' + (st.china || 0) + '</b> 涉华命中</span>';
    html += '<span class="air-chip"><b style="color:var(--red)">' + (st.assetHit || 0) + '</b> 资产命中</span>';
    if (fs.cur != null) {
      html += '<span class="air-chip">八维风险 <b style="color:' + (Number(fs.delta) >= 0 ? 'var(--red)' : 'var(--green)') + '">' + fs.cur + '→' + fs.pred + '</b>（' + (Number(fs.delta) >= 0 ? '+' : '') + fs.delta + '）</span>';
    }
    if (ch.cmp && ch.cmp.r3 != null && ch.cmp.p3 != null) {
      html += '<span class="air-chip">近72h事件 <b>' + ch.cmp.r3 + '</b> 起 / 前72h <b>' + ch.cmp.p3 + '</b> 起</span>';
    }
    html += '</div>';
    if ((ch.countryDist || []).length > 1) {
      html += '<div style="font-size:10px;color:var(--text2);margin-bottom:6px">国别分布：' + ch.countryDist.map(function (c) { return self._esc(c.name) + ' ' + c.count + ' 条'; }).join(' · ') + '</div>';
    }
    if (typeof Chart !== 'undefined' && (st.total || 0) > 0) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
      html += '<div style="height:190px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px"><div style="font-size:9px;color:var(--text3);padding:2px 4px">预警等级结构（环形）</div><canvas id="air-chart-sev"></canvas></div>';
      html += '<div style="height:190px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px"><div style="font-size:9px;color:var(--text3);padding:2px 4px">事件类型分布（条形）</div><canvas id="air-chart-type"></canvas></div>';
      html += '<div style="grid-column:1/3;height:200px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px"><div style="font-size:9px;color:var(--text3);padding:2px 4px">窗口期预警趋势（时间分桶）</div><canvas id="air-chart-trend"></canvas></div>';
      html += '</div>';
    } else {
      html += '<div style="padding:12px;text-align:center;color:var(--text3);font-size:11px">窗口内无预警数据，图表从略（零模拟数据铁律）</div>';
    }
    html += '</div>';

    /* ③ 重点事件事实层 */
    html += '<div class="air-sec" id="air-sec-events">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">③ 重点事件事实层</span><span class="air-badge air-bdg-fact">客观事实 · 真实预警时间线</span><span class="air-bdg-src">按预警价值分+涉华加权排序 TOP' + ((d.timeline || []).length) + '</span></div>';
    if ((d.timeline || []).length) {
      d.timeline.forEach(function (e) {
        var c = e.level === 'red' ? 'var(--red)' : e.level === 'orange' ? 'var(--orange)' : e.level === 'yellow' ? '#eab308' : 'var(--cyan)';
        html += '<div class="air-ev" style="border-left-color:' + c + '">';
        html += '<div class="air-ev-hd"><span style="font-size:9px;font-weight:700;color:' + c + ';padding:1px 6px;background:' + c + '15;border-radius:3px">' + self._esc(String(e.level).toUpperCase()) + '</span><b style="font-size:12px;color:var(--text)">' + self._esc(e.what) + '</b><span style="font-size:9px;color:var(--text3)">' + self._esc(e.time) + '</span><span style="font-size:9px;color:var(--cyan)">' + (e.score != null ? e.score + '分' : '') + '</span>' + (e.extra ? '<span style="font-size:9px;color:var(--purple)">[推送素材]</span>' : '') + '</div>';
        html += '<div class="air-ev5">';
        html += '<div><i>何人</i>' + self._esc(e.who) + '</div>';
        html += '<div><i>何事</i>' + self._esc(e.type) + '类安全事件</div>';
        html += '<div><i>何时</i>' + self._esc(e.time) + '</div>';
        html += '<div><i>何地</i>' + self._esc(r.country || '') + '·' + self._esc(e.where) + '</div>';
        html += '<div><i>何果</i>' + self._esc(e.outcome) + '</div>';
        html += '</div>';
        html += '<div class="air-ev-ft"><span>📡 来源：' + self._esc(e.source) + '</span><a style="color:var(--cyan);cursor:pointer" onclick="document.getElementById(\'modal\').classList.remove(\'show\');showAlertDetail(\'' + self._escId(e.id) + '\')">⤓ 下钻预警详情</a></div>';
        html += '</div>';
      });
    } else {
      html += '<div style="padding:12px;text-align:center;color:var(--text3);font-size:11px">窗口内无预警事件</div>';
    }
    html += '</div>';

    /* ④ 分析研判层（四段，主观） */
    html += '<div class="air-sec" id="air-sec-analysis">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">④ 分析研判层</span><span class="air-badge air-bdg-ana">分析研判 · 资深情报分析师（主观）</span><span style="font-size:9px;color:var(--text3)">趋势 · 动因 · 影响 · 情景四维研判，须与客观事实区分阅读</span></div>';
    ['trend', 'drivers', 'impact', 'scenario'].forEach(function (k) {
      var s = d.sections[k] || {};
      html += '<div style="margin-bottom:10px;padding:10px;background:rgba(255,170,0,0.04);border:1px solid rgba(255,170,0,0.18);border-radius:6px">';
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<b style="font-size:12px;color:var(--orange)">' + self._esc(s.nm || k) + '</b>' + self._srcTag(s) + self._rvBtns(id, k, s) + '</div>';
      html += '<div class="air-text">' + self._esc(s.text || '') + '</div>';
      html += '</div>';
    });
    html += '</div>';

    /* ⑤ 案例分析层 */
    var cases = d.cases || {};
    html += '<div class="air-sec" id="air-sec-cases">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">⑤ 案例分析层</span><span class="air-badge air-bdg-ana">分析研判 · 案例研究员（主观）</span>' + this._srcTag(cases) + this._rvBtns(id, 'case', cases) + '</div>';
    html += '<div class="air-text">' + this._esc(cases.text || '') + '</div>';
    html += '</div>';

    /* ⑥ 对策建议层 */
    var adv = d.advice || {};
    html += '<div class="air-sec" id="air-sec-advice">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">⑥ 对策建议层</span><span class="air-badge air-bdg-ana">分析研判 · 对策参谋（主观）</span>' + this._srcTag(adv) + this._rvBtns(id, 'advice', adv) + '</div>';
    html += '<div class="air-text">' + this._esc(adv.text || '') + '</div>';
    html += '</div>';

    /* ⑦ 数据支撑附录 */
    var dsEvents = (r.dataSupport && r.dataSupport.events) || (d.payload && d.payload.events) || [];
    var asmAt = (r.dataSupport && r.dataSupport.assembledAt) || d.genAt || '';
    html += '<div class="air-sec" id="air-sec-appendix">';
    html += '<div class="air-sec-hd"><span class="air-sec-tt">⑦ 数据支撑附录</span><span class="air-badge air-bdg-fact">客观事实 · 明细可核对</span><span class="air-bdg-src">装配于 ' + this._esc(asmAt) + '</span></div>';
    html += '<div style="font-size:10px;color:var(--text2);margin-bottom:8px">研判引用数据链路：预警中心（真实采集）· 八维推演 · 关联簇 · 项目档案（' + ((d.payload && d.payload.assets) || []).length + ' 个中资项目）· COSRI 国别画像。下表所有事件可点击下钻核对原始预警。</div>';
    if (dsEvents.length) {
      html += '<div style="max-height:300px;overflow-y:auto"><table class="air-tbl"><thead><tr><th>级别</th><th>类型</th><th>时间</th><th>标题</th><th>来源</th><th>价值分</th></tr></thead><tbody>';
      dsEvents.forEach(function (e) {
        var c = e.level === 'red' ? 'var(--red)' : e.level === 'orange' ? 'var(--orange)' : e.level === 'yellow' ? '#eab308' : 'var(--cyan)';
        html += '<tr style="cursor:pointer" onclick="document.getElementById(\'modal\').classList.remove(\'show\');showAlertDetail(\'' + self._escId(e.id) + '\')">' +
          '<td style="color:' + c + ';font-weight:700">' + self._esc(e.level || '—') + '</td>' +
          '<td>' + self._esc(e.type || '—') + '</td>' +
          '<td style="white-space:nowrap">' + self._esc(e.time || '—') + '</td>' +
          '<td>' + self._esc(String(e.title || '').slice(0, 50)) + '</td>' +
          '<td>' + self._esc(String(e.source || '—').slice(0, 18)) + '</td>' +
          '<td style="color:var(--cyan)">' + (e.score != null ? e.score : '—') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div style="padding:10px;text-align:center;color:var(--text3);font-size:11px">无引用事件明细</div>';
    }
    html += '</div>';

    html += '</div>'; /* 右内容 */
    html += '</div>'; /* 主体 */
    html += '</div>'; /* card */

    el.innerHTML = html;
    this._renderDetailCharts(r);

    /* AI报告 ↔ 全功能区：反查真实情报，让研判结论可溯源可穿透 */
    if (typeof LINK_GRAPH !== 'undefined') {
      try {
        LINK_GRAPH.inject({
          country: r.country, enterprise: r.enterprise,
          text: [r.title, r.summary, r.threatAnalysis, (d.bluf.items || []).join(' ')].filter(Boolean).join(' '),
          self: { module: 'aireport', key: String(r.id || '') }
        });
      } catch (e) {}
    }
  },

  /* 来源标签：引擎与降级透明可辨 */
  _srcTag(sec) {
    if (!sec) return '';
    var t = '';
    if (sec.src === 'llm') t = '🤖 ' + String(sec.model || 'LLM');
    else if (sec.src === 'local') t = '⚙️ 本地研判引擎（降级）';
    else if (sec.src === 'error') t = '❌ 生成失败';
    else t = '⚙️ ' + String(sec.model || '');
    return '<span class="air-bdg-src">' + this._esc(t) + '</span>';
  },

  /* 分节审阅按钮 */
  _rvBtns(id, seg, sec) {
    if (!sec) return '';
    var st = sec.status || 'pending';
    var stHtml = '';
    var btns = '';
    if (st === 'generating') {
      stHtml = '<span style="font-size:9px;color:var(--cyan);font-weight:600">⟳ 重生成中…</span>';
    } else if (st === 'approved') {
      stHtml = '<span style="font-size:9px;color:var(--green);font-weight:600">✅ 已通过</span>';
      btns = '<button class="btn sm" style="font-size:9px;padding:1px 8px;min-width:auto;color:var(--cyan)" onclick="AIREPORT._secAction(\'' + this._escId(id) + '\',\'' + seg + '\',\'regen\')">↻ 驳回重生成</button>';
    } else if (st === 'error') {
      stHtml = '<span style="font-size:9px;color:var(--red);font-weight:600">❌ 失败</span>';
      btns = '<button class="btn sm primary" style="font-size:9px;padding:1px 8px;min-width:auto" onclick="AIREPORT._secAction(\'' + this._escId(id) + '\',\'' + seg + '\',\'regen\')">↻ 重试生成</button>';
    } else {
      stHtml = '<span style="font-size:9px;color:var(--yellow);font-weight:600">⏳ 待审阅</span>';
      btns = '<button class="btn sm" style="font-size:9px;padding:1px 8px;min-width:auto;color:var(--green)" onclick="AIREPORT._secAction(\'' + this._escId(id) + '\',\'' + seg + '\',\'approve\')">✓ 通过</button>' +
        '<button class="btn sm danger" style="font-size:9px;padding:1px 8px;min-width:auto" onclick="AIREPORT._secAction(\'' + this._escId(id) + '\',\'' + seg + '\',\'regen\')">↻ 驳回重生成</button>';
    }
    return stHtml + btns;
  },

  _destroyCharts() {
    var self = this;
    Object.keys(this._charts || {}).forEach(function (k) {
      try { if (self._charts[k]) self._charts[k].destroy(); } catch (e) {}
      self._charts[k] = null;
    });
  },

  _renderDetailCharts(r) {
    if (typeof Chart === 'undefined') return;
    var ch = r.deep && r.deep.charts;
    if (!ch) return;
    var self = this;
    try { Chart.defaults.color = '#8fa3b8'; } catch (e) {}
    var gridClr = 'rgba(255,255,255,0.07)';
    var c1 = document.getElementById('air-chart-sev');
    if (c1) {
      this._charts.sev = new Chart(c1, {
        type: 'doughnut',
        data: {
          labels: ['红色', '橙色', '黄色', '蓝色'],
          datasets: [{ data: [ch.severity.red, ch.severity.orange, ch.severity.yellow, ch.severity.blue], backgroundColor: ['#ff3355', '#ffaa00', '#eab308', '#00d4ff'], borderWidth: 2, borderColor: 'rgba(8,15,28,0.9)' }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
      });
    }
    var c2 = document.getElementById('air-chart-type');
    if (c2 && (ch.types || []).length) {
      this._charts.type = new Chart(c2, {
        type: 'bar',
        data: {
          labels: ch.types.map(function (t) { return t.name; }),
          datasets: [{ data: ch.types.map(function (t) { return t.count; }), backgroundColor: 'rgba(0,212,255,0.45)', borderColor: '#00d4ff', borderWidth: 1, borderRadius: 3 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridClr }, ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 0 } }, y: { grid: { color: gridClr }, ticks: { precision: 0, font: { size: 9 } }, beginAtZero: true } } }
      });
    }
    var c3 = document.getElementById('air-chart-trend');
    if (c3 && ch.trend) {
      this._charts.trend = new Chart(c3, {
        type: 'line',
        data: {
          labels: ch.trend.labels,
          datasets: [{ label: '预警数量', data: ch.trend.data, borderColor: '#00ff9f', backgroundColor: 'rgba(0,255,159,0.12)', fill: true, tension: 0.35, pointRadius: 2.5, pointBackgroundColor: '#00ff9f', borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridClr }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkipPadding: 12 } }, y: { grid: { color: gridClr }, ticks: { precision: 0, font: { size: 9 } }, beginAtZero: true } } }
      });
    }
  },

  /* ---------- 分节审阅 ---------- */
  _secAction(id, seg, act) {
    var r = this._findReport(id);
    if (!r || !r.deep) return;
    var sec = this._getSec(r.deep, seg);
    if (!sec) return;
    var self = this;
    if (act === 'approve') {
      sec.status = 'approved';
      this._updateReviewStatus(r);
      this._persist(r);
      this.openDetail(id);
      showToast('✅ 已通过「' + sec.nm + '」');
      return;
    }
    /* 驳回重生成（独立重调该段） */
    sec.status = 'generating';
    this.openDetail(id);
    this._callSeg(seg, r.deep.payload).then(function (res) {
      if (res.ok) {
        self._applySeg(r.deep, seg, res);
        sec.status = 'pending';
        showToast('↻ 「' + sec.nm + '」已重新生成（' + (res.degraded ? '本地降级' : res.model) + '），请重新审阅');
      } else {
        self._applySegError(r.deep, seg, res.error);
        sec.status = 'error';
        showToast('⚠️ 「' + sec.nm + '」重生成失败：' + res.error);
      }
      self._updateReviewStatus(r);
      self._persist(r);
      if (self._currentDetailId === id) self.openDetail(id);
    });
  },

  _approveAll(id) {
    var r = this._findReport(id);
    if (!r || !r.deep) return;
    var self = this;
    ['fact', 'trend', 'drivers', 'impact', 'scenario', 'case', 'advice'].forEach(function (k) {
      var s = self._getSec(r.deep, k);
      if (s && s.status !== 'error') s.status = 'approved';
    });
    r.reviewStatus = 'approved';
    this._persist(r);
    this.openDetail(id);
    showToast('✅ 整体审阅通过，报告已审定');
  },

  _regenAll(id) {
    var r = this._findReport(id);
    if (!r || !r.deep) return;
    var self = this;
    var deep = r.deep;
    showConfirm('确定驳回全部 AI 段落并重新生成？（客观事实/数据装配节不受影响）', function () {
      ['fact', 'trend', 'drivers', 'impact', 'scenario', 'case', 'advice'].forEach(function (k) {
        var s = self._getSec(deep, k);
        if (s) s.status = 'generating';
      });
      r.reviewStatus = 'pending';
      self.openDetail(id);
      var batches = [['fact', 'trend', 'drivers'], ['impact', 'scenario', 'case'], ['advice']];
      var runB = function (bi) {
        if (bi >= batches.length) {
          deep.genAt = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').substring(0, 16);
          self._updateReviewStatus(r);
          self._persist(r);
          if (self._currentDetailId === id) self.openDetail(id);
          showToast('↻ 全部段落已重新生成，请重新审阅');
          return;
        }
        Promise.all(batches[bi].map(function (sg) {
          return self._callSeg(sg, deep.payload).then(function (res) {
            var s = self._getSec(deep, sg);
            if (res.ok) { self._applySeg(deep, sg, res); if (s) s.status = 'pending'; }
            else { self._applySegError(deep, sg, res.error); if (s) s.status = 'error'; }
            return res;
          });
        })).then(function () { runB(bi + 1); });
      };
      runB(0);
    });
  },

  _updateReviewStatus(r) {
    if (!r || !r.deep) return;
    var self = this;
    var all = ['fact', 'trend', 'drivers', 'impact', 'scenario', 'case', 'advice'].every(function (k) {
      var s = self._getSec(r.deep, k);
      return s && s.status === 'approved';
    });
    r.reviewStatus = all ? 'approved' : 'pending';
  },

  /* ---------- 持久化（localStorage + API 同步 deep 结构） ---------- */
  _persist(r) {
    try { INTELCENTER._aiReportSave(); } catch (e) {}
    if (typeof APIClient !== 'undefined' && APIClient.isOnline && APIClient.isOnline()) {
      APIClient.updateReport(r.id, {
        id: r.id, title: r.title, mode: r.reportMode || 'elements', country: r.country,
        level: r.threatLevel, reportType: r.reportType,
        materials: JSON.stringify(r.materials || []),
        threatAnalysis: r.threatAnalysis || '', impactAnalysis: r.impactAnalysis || '',
        advice: r.advice || '', summary: r.summary || '', elements: r.elements || {},
        window: r.window || '72h', dataSupport: r.dataSupport || null,
        genModel: r.genModel || '', deep: r.deep || null,
        reviewStatus: r.reviewStatus || '', createTime: r.createTime || '', author: r.author || ''
      }).catch(function (err) { console.warn('[AIREPORT] API同步失败:', err.message); });
    }
  },

  /* ===== 预填充测试数据 (仅首次加载时执行) ===== */
  seedTestData() {
    // 实战模式：不再预置任何测试/模拟报告或素材篮数据，仅使用用户真实生成的报告
  }

};

/* ============================================================
 * 运行时接管 INTELCENTER 的 AI 报告入口（aireport.js 在 app.js 之后加载）：
 *  - _aiGenerate      → 深度分层生成（七段·四分析师）
 *  - showAiReportDetail → 全页分层报告详情（旧版无 deep 结构的报告回落旧弹窗）
 * ============================================================ */
if (typeof INTELCENTER !== 'undefined') {
  AIREPORT._origDetail = INTELCENTER.showAiReportDetail;
  AIREPORT._origGenerate = INTELCENTER._aiGenerate;
  INTELCENTER.showAiReportDetail = function (id) { AIREPORT.openDetail(id); };
  INTELCENTER._aiGenerate = function () { AIREPORT.deepGenerate(); };
}
