/* ============================================================
 * aireport.js — AI 情报分析报告独立模块
 * 分析工具 / AI情报分析报告
 *
 * 功能:
 *  1. 独立视图 (view-aireport)，侧边栏"分析工具"下
 *  2. 素材收集篮 — 从预警中心、案例分析、事件追踪等功能区收集素材
 *  3. 报告列表 — 展示已保存的 AI 情报分析报告
 *  4. 权限控制 — 管理员和注册用户均可使用 (PERM.canUpload)
 *  5. 报告结构 — 现状分析(六要素:时间/地点/人物/起因/过程/结果) + 对华威胁 + 对策建议
 *  6. 数据共享 — 与 INTELCENTER._aiReports 共用 localStorage
 * ============================================================ */

var AIREPORT = {
  _cartKey: 'orps_aireport_cart',
  _materialCart: null,

  /* ===== 初始化 ===== */
  init() {
this._loadCart();
    if (typeof INTELCENTER !== 'undefined' && INTELCENTER._aiReportInit) {
      INTELCENTER._aiReportInit();
    }
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

  /* ===== 主渲染 ===== */
  render() {
    var el = document.getElementById('aireport-content');
    if (!el) return;
    this._loadCart();
    if (typeof INTELCENTER !== 'undefined') INTELCENTER._aiReportInit();

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
      { ic: '🔴', c: 'var(--red)', l: '紧急报告', v: stCritical },
      { ic: '🟠', c: 'var(--orange)', l: '高危报告', v: stHigh },
      { ic: '📅', c: 'var(--green)', l: '本月报告', v: stMonth }
    ];
    stats.forEach(function (s) {
      html += '<div class="stat-card"><div class="stat-ic" style="background:rgba(0,212,255,0.08);color:' + s.c + '">' + s.ic + '</div><div class="stat-info"><div class="stat-label">' + s.l + '</div><div class="stat-val" style="color:' + s.c + '">' + s.v + '</div></div></div>';
    });
    html += '</div>';

    /* 报告列表 */
    html += '<div class="card mt-12"><div class="card-tt"><span class="ic">🤖</span>AI情报分析报告';
    html += '<span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:6px">— 支持综合要素/战略/战术/风险评估四种分析模式</span>';
    html += '</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:12px;color:var(--text3)">共 ' + reports.length + ' 份报告 | 管理员和注册用户均可使用</span>';
    html += '<button class="btn primary sm" onclick="INTELCENTER.showAiReportForm()">➕ 新建情报分析报告</button>';
    html += '</div>';

    if (reports.length === 0) {
      html += '<div class="empty"><div class="ic">📝</div>';
      html += '<div style="font-size:13px;margin-bottom:4px">暂无情报分析报告</div>';
      html += '<div style="font-size:11px">点击"新建情报分析报告"，或从预警中心、案例分析等页面收集素材后创建报告</div></div>';
    } else {
      html += '<div style="display:grid;gap:8px;max-height:500px;overflow-y:auto">';
      reports.forEach(function (r) {
        var lvClr = r.threatLevel === 'critical' ? 'var(--red)' :
                    r.threatLevel === 'high' ? 'var(--orange)' :
                    r.threatLevel === 'medium' ? 'var(--yellow)' : 'var(--green)';
        var lvLabel = r.threatLevel === 'critical' ? '🔴 紧急' :
                      r.threatLevel === 'high' ? '🟠 高危' :
                      r.threatLevel === 'medium' ? '🟡 中危' : '🟢 低危';
        var summary = (r.summary || '').substring(0, 120);
        if (r.summary && r.summary.length > 120) summary += '...';

        var modeNames = {'elements':'综合要素','strategic':'战略类','tactical':'战术类','risk':'风险评估'};
        var modeClr = r.reportMode === 'strategic' ? '#a855f7' :
                      r.reportMode === 'tactical' ? 'var(--orange)' :
                      r.reportMode === 'risk' ? 'var(--yellow)' : 'var(--cyan)';
        var modeNm = modeNames[r.reportMode] || '综合要素';

        html += '<div style="padding:12px;background:var(--panel2);border-radius:8px;border-left:3px solid ' + lvClr + ';transition:.2s;cursor:pointer" onclick="INTELCENTER.showAiReportDetail(\'' + r.id + '\')">';
        html += '<div style="display:flex;justify-content:space-between;align-items:start">';
        html += '<div style="flex:1">';
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
        html += '<span style="font-size:10px;font-weight:700;color:' + lvClr + '">' + lvLabel + '</span>';
        html += '<span style="font-size:9px;font-weight:600;color:' + modeClr + ';padding:1px 6px;background:' + modeClr + '15;border-radius:3px">' + modeNm + '</span>';
        html += '<span style="font-size:12px;font-weight:700">[' + r.id + '] ' + r.title + '</span>';
        html += '</div>';
        html += '<div style="font-size:11px;color:var(--text2);margin-bottom:4px">' + summary + '</div>';
        html += '<div style="display:flex;gap:10px;font-size:9px;color:var(--text3);flex-wrap:wrap">';
        html += '<span>📅 ' + (r.createTime || '') + '</span>';
        html += '<span>👤 ' + (r.author || '') + '</span>';
        html += '<span>🎯 ' + (r.country || '') + '</span>';
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

  /* ===== 预填充测试数据 (仅首次加载时执行) ===== */
  seedTestData() {
    // 实战模式：不再预置任何测试/模拟报告或素材篮数据，仅使用用户真实生成的报告
  }

};
