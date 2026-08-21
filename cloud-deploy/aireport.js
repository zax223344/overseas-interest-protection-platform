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
    /* 实战模式：已停用预置测试数据 */
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
  seedTestData() { return; /* 实战模式：已停用预置测试数据 */
    var existingReports = null;
    try {
      var saved = localStorage.getItem('orps_ai_reports');
      existingReports = saved ? JSON.parse(saved) : [];
    } catch (e) {
      existingReports = [];
    }
    if (existingReports && existingReports.length > 0) return;

    var now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').substring(0, 16);
    var lastWeek = new Date(Date.now() - 7 * 86400000).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').substring(0, 16);
    var lastMonth = new Date(Date.now() - 30 * 86400000).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-').substring(0, 16);

    var sampleReports = [
      {
        id: 'AIR-100001',
        title: '红海航运安全形势分析及中资企业应对策略',
        country: '也门、红海沿岸',
        threatLevel: 'critical',
        reportType: '安全风险',
        summary: '胡塞武装自2023年11月起持续对红海海域商船发动导弹和无人机袭击，以"支援加沙"为由宣布对以色列关联船只实施封锁，随后将袭击范围扩大至所有经红海航行的商船。全球主要航运公司被迫改道好望角，亚欧航线运价上涨逾两倍。中远海运已于2023年12月暂停红海航线，招商局吉布提港运营受到波及。本报告基于多源情报素材，经交叉验证与综合研判，分析红海安全形势对中国海外利益的威胁，提出分级应对建议。当前红海安全形势处于极高风险区间，短期内难以缓解，须采取果断措施保障中方人员、资产和供应链安全。',
        elements: {
          time: '2023年11月19日至今，持续进行中',
          place: '也门西部、红海海域、曼德海峡',
          person: '胡塞武装（安萨尔阿拉运动）、中远海运、招商局、各国商船船员',
          cause: '巴以冲突升级后，胡塞武装以"支援加沙"为由，宣布对以色列关联船只实施封锁，随后扩大至对所有经红海航行的商船发动袭击',
          process: '2023年11月19日劫持"银河领袖"号货轮，随后使用反舰导弹、无人机和无人艇对红海商船发动持续袭击。2024年1月起美英发动"繁荣卫士行动"进行空袭，但未能完全遏制袭击。全球主要航运公司陆续暂停红海航线',
          result: '亚欧航线运价上涨256%，航行周期延长7-14天。中远海运于2023年12月18日暂停红海航行，招商局吉布提港物流量下降。全球供应链受冲击，保险费率大幅上涨'
        },
        threatAnalysis: '经多源情报融合分析，红海航运安全威胁呈现出长期化、扩大化、复杂化的演变特征。胡塞武装控制的曼德海峡是全球最繁忙的海上咽喉之一，每年约12%的全球海运贸易经此通过。该组织利用反舰弹道导弹、巡航导弹、攻击型无人机和无人艇等多种手段，对红海海域商船实施持续袭扰，已形成较为成熟的非对称海上拒止能力。从袭击模式来看，胡塞武装的战术不断升级，从最初针对以色列关联船只，逐步扩大至对所有经红海航行的商船发动无差别攻击，袭击频率和强度均呈上升趋势。\n\n中国约60%的进出口贸易依赖海运，红海是连接亚欧的关键通道。航线中断直接导致运输成本上升30%至40%，对中国外贸企业形成显著冲击。中远海运、招商局等中资企业在红海至印度洋航线运营受直接影响，运力调度被迫大幅调整。从企业层面的具体影响来看，中远海运于2023年12月18日正式暂停红海航线，旗下多艘集装箱船改道好望角，单船次航行成本增加约百万美元。招商局吉布提港作为中国在非洲之角的重要物流节点，货物吞吐量受到显著影响，港口运营效率下降。\n\n能源安全方面的威胁同样不容忽视。中东原油运输通道安全恶化，直接影响中国能源进口的稳定性。中国从中东进口的原油大部分经海路运输，红海航线中断意味着油轮需绕行好望角，运输周期延长、成本上升，对国内能源供应形成间接压力。与此同时，航行于红海的中国籍船员面临被袭击风险。据不完全统计，在红海海域航行的中国籍商船船员约数百人，其人身安全受到直接威胁。\n\n供应链风险方面，欧洲方向的电子产品、汽车零部件等供应链交期延长，部分企业被迫调整生产计划。从供应链传导效应来看，红海航线中断不仅影响直接经该航线的货物，还引发全球航运运力重新分配，导致其他航线运价连锁上涨。保险费率方面，战争险费率大幅攀升，增加了企业的运营成本。部分中小航运企业面临资金链断裂风险，行业格局可能加速调整。\n\n地缘政治维度上，红海危机折射出中东地区大国博弈的深层矛盾。美英发动的"繁荣卫士行动"未能有效遏制胡塞武装的袭击能力，暴露出传统军事手段应对非对称海上威胁的局限性。与此同时，沙特、阿联酋等地区国家在红海安全事务上的立场分化，使得通过外交途径解决红海危机的前景更加复杂。中资企业和项目可能受到波及，卷入大国博弈漩涡。从更宏观的视角审视，红海危机不仅是一个区域安全问题，更是全球海上通道安全体系脆弱性的集中暴露。\n\n从保险与金融风险的角度审视，红海安全形势恶化导致战争险费率大幅攀升，部分航段的保险费率已达到正常水平的十倍以上。中小航运企业面临保费负担过重、保障范围缩减的双重困境，部分企业不得不选择在无充分保险保障的情况下航行，进一步放大了风险敞口。与此同时，国际再保险市场对红海相关风险的承保意愿下降，可能导致保险供给不足，影响航运企业的正常运营。从金融传导效应来看，航运成本上升正在向下游传导，部分外贸企业面临资金周转压力，信用证结算和贸易融资也受到不同程度的影响。\n\n从区域外交格局来看，红海安全问题已成为国际社会关注的焦点。联合国安理会就红海局势通过多项决议，呼吁保障航行自由。然而，各方在解决路径上存在显著分歧，美英倾向于通过军事手段施压，而中国、俄罗斯等国则主张通过外交途径解决。非洲之角国家在红海安全事务上的立场也不尽一致，吉布提、厄立特里亚、埃塞俄比亚等国各自有着不同的利益考量。这种外交格局的复杂性使得红海问题的解决难以一蹴而就，短期内安全形势难以根本好转。\n\n从海外公民保护的角度审视，红海安全形势恶化对中国在非洲之角和中东地区的侨民安全构成间接威胁。中国在吉布提设有保障基地，在埃塞俄比亚、厄立特里亚等国也有大量工程项目和人员。红海航线的安全问题不仅影响航运，还可能影响中国在非洲之角的整体安全布局。从侨民保护的维度来看，一旦安全形势进一步恶化，可能需要组织大规模撤侨行动，对应急响应能力提出极高要求。建议各级指挥机构充分评估红海安全形势对海外公民的影响，完善撤侨预案，储备应急物资，确保在紧急情况下能够快速响应、有效保护海外公民安全。同时，加强对海外公民的安全提醒，提升自我保护意识和能力。',
        advice: '建议维持红海航线暂停状态，改道好望角航行，同时加强船员安保培训，为途经高风险海域的中资船只购买战争险。从短期应对来看，安全是第一优先事项，各航运企业须严格执行暂停红海航线的决定，确保船员生命安全。加强船员安保培训，提升应急处置能力，确保船员掌握遇险时的通信、避险和撤离程序。为所有途经高风险海域的中资船只购买战争险，降低潜在经济损失。\n\n中期策略方面，建议评估吉布提港替代方案，加强与非洲东海岸港口合作。从物流网络优化的角度，可以考虑在坦桑尼亚、肯尼亚等东非国家寻找替代港口，分散吉布提港的压力。同时，加强与非洲东海岸国家的港口合作，建立多元化的物流节点网络。与当地政府和港口运营商加强协调，确保中资船只的优先靠泊权和补给保障。\n\n长期布局方面，建议推动"一带一路"陆路通道建设，分散海上运输风险。加快中欧班列运力扩容，提升陆路运输在中国外贸物流中的比重。从战略层面来看，过度依赖单一海上通道存在系统性风险，须构建陆海统筹、多元互补的物流网络。推动中缅经济走廊、中巴经济走廊等陆路通道建设，为中国外贸提供更多运输选择。\n\n外交协调方面，建议通过联合国安理会等多边机制推动红海航行自由，与沙特、阿联酋等地区国家加强安全合作。从外交策略来看，中国在红海问题上应坚持独立自主立场，既要维护国际航运安全，又要避免卷入大国军事冲突。与沙特、阿联酋、埃及等地区国家加强沟通协调，推动通过政治途径解决也门问题，从根本上消除红海安全威胁。\n\n应急准备方面，建议建立航运安全预警机制，为途经高风险海域的中资船只提供实时情报支持。将红海航运风险纳入中东地缘风险融合评估体系，动态调整企业风险等级。建立24小时应急响应中心，确保紧急情况下能够快速响应、有效处置。各企业须明确应急责任人、应急联络人，定期组织应急演练，检验预案的可行性和有效性。加强与国际海事组织的协调，推动建立红海航运安全国际保障机制。\n\n风险融合方面，建议将红海航运风险纳入中东地缘风险融合评估体系，动态调整企业风险等级。从风险融合管理的角度，应建立跨部门、跨企业的风险信息共享平台，将航运安全风险与地缘政治风险、能源安全风险、供应链风险等进行融合分析，形成综合性风险评估报告。定期组织多方参与的风险研判会议，统一风险认知、协调应对策略。建立风险预警指标体系，设定关键阈值，一旦指标突破阈值即自动触发预警。各企业须将风险融合评估结果纳入经营决策，动态调整业务策略和风险敞口。',
        materials: [
          { id: 'CART-alert-001', source: '预警中心', title: '胡塞武装扩大红海袭击，中远海运暂停红海航线', country: '也门', date: '2023-12-18 09:00', severity: 'red', desc: '胡塞武装持续袭击红海商船，中远海运暂停红海航线', type: 'alert' },
          { id: 'CART-event-001', source: '事件追踪', title: '胡塞武装开始袭击红海商船', country: '也门', date: '2023-11-19', severity: 'critical', desc: '2023年11月19日胡塞武装劫持"银河领袖"号货轮', type: 'event' },
          { id: 'CART-country-001', source: '国家风险', title: '也门 风险评估', country: '也门', date: '', severity: '极高', desc: '内战持续，胡塞武装控制北部', type: 'country' }
        ],
        createTime: lastWeek,
        author: '系统预置',
        updateTime: now
      },
      {
        id: 'AIR-100002',
        title: '巴基斯坦中巴经济走廊安全威胁综合评估',
        country: '巴基斯坦',
        threatLevel: 'high',
        reportType: '安全风险',
        summary: '巴基斯坦近期发生多起针对中方人员的恐怖袭击事件，从2021年达苏项目9人遇难到2024年达苏项目5人遇难、瓜达尔港附近2人遇难，安全形势持续恶化。俾路支分离主义武装和巴基斯坦塔利班对中巴经济走廊项目构成双重威胁，袭击方式从路边炸弹升级为自杀式袭击，针对性和破坏力显著增强。本报告基于多源情报素材，经交叉验证与综合研判，分析巴基斯坦安全形势对中资企业和人员的威胁，提出分级应对建议。当前巴基斯坦涉华安全形势处于高风险区间，须采取系统措施保障中方人员和项目安全。',
        elements: {
          time: '2021年7月14日 — 2024年10月6日，持续多发',
          place: '巴基斯坦开伯尔-普什图省、俾路支省、卡拉奇市',
          person: '俾路支解放军(BLA)、巴基斯坦塔利班(TTP)、中铁建、中交建、中核集团、中国建筑等中方项目人员',
          cause: '中巴经济走廊(CPEC)建设引发当地分离主义势力不满，认为资源被掠夺。TTP在阿富汗境内有庇护所，巴方反恐能力不足',
          process: '2021年7月14日达苏班车爆炸9人遇难；2022年4月26日卡拉奇孔院自杀袭击3人遇难；2024年3月26日达苏项目再遭自杀式袭击5人遇难；2024年10月6日瓜达尔港附近车队遭袭2人遇难',
          result: '共计19名中方人员遇难，多人受伤。项目多次暂停施工，安保投入大幅增加。巴基斯坦军方加强了对CPEC项目的安保力量部署'
        },
        threatAnalysis: '经多源情报融合分析，巴基斯坦涉华安全威胁呈现出频率上升、烈度增强、范围扩大的演变趋势。巴基斯坦已成为中国公民在海外遇袭最多的国家，针对中方人员的恐怖袭击呈明显上升趋势。从袭击方式的演变来看，已从传统的路边炸弹、远程引爆升级为自杀式袭击、伏击车队等高杀伤性手段，袭击者的组织能力和战术水平显著提升。俾路支解放解放军和巴基斯坦塔利班是主要威胁源，两者虽然动机不同，但在客观上形成了对中巴经济走廊项目的双重夹击态势。\n\n俾路支分离主义武装的活动呈现出鲜明的政治诉求特征。该组织认为中巴经济走廊建设导致当地资源被外力攫取，当地民众未获实质利益，因而将袭击中资项目和人员作为表达政治诉求的手段。从活动区域来看，俾路支省是分离主义武装的核心活动区域，瓜达尔港作为中巴经济走廊的旗舰项目，位于俾路支省南部沿海地区，处于分离主义武装的直接威胁范围之内。袭击者选择在瓜达尔港附近对中方人员车队发动攻击，显示出明确的战术意图和较强的情报搜集能力。\n\n巴基斯坦塔利班的威胁则具有更强的宗教极端主义色彩。该组织在阿富汗境内拥有庇护所，能够跨境实施袭击，巴方反恐力量难以有效打击。从活动轨迹来看，该组织在开伯尔-普什图省活动频繁，达苏水电站项目正位于该省境内，成为袭击的重要目标。2024年3月26日的达苏项目袭击事件造成5名中方工程师遇难，暴露出项目安保体系存在的严重漏洞。袭击者能够在项目通勤路线上实施精确打击，说明其对中方人员的出行规律有充分掌握。\n\n中巴经济走廊投资规模超620亿美元，瓜达尔港、达苏水电站、卡洛特水电站等核心项目均位于高风险区域。从项目安全的角度来看，中资项目在巴基斯坦的分布呈现出"多点分散、偏远纵深"的特征，安保力量覆盖难度大、响应时间长。项目营地多位于偏远地区，周围地形复杂，安保力量难以实现全天候有效覆盖。中方人员通勤路线固定且可预测，容易被袭击者掌握规律、设伏袭击。\n\n中巴经济走廊是中国绕开马六甲海峡的重要陆路能源通道，其安全直接关系能源安全。从战略通道安全的维度来看，中巴经济走廊的油气管道和公路铁路网络一旦中断，将对中国能源进口的多元化战略产生重大影响。当前安全形势下，战略通道的脆弱性进一步凸显，须从战略高度审视通道安全保障问题。同时，中方人员频繁遇袭对中巴"铁杆"友谊的民意基础产生负面影响。部分巴基斯坦民众对中巴经济走廊的质疑声上升，分离主义武装利用社交媒体传播不实信息、制造舆论对立，对中资企业声誉和双边关系构成间接威胁。\n\n从社会舆论与信息战的角度审视，分离主义武装利用社交媒体平台系统性传播反华信息，将中巴经济走廊描绘为"新殖民主义"和"资源掠夺"的工具，试图在巴基斯坦民众中制造对华不满情绪。从信息传播的特征来看，相关虚假信息呈现出多平台分发、多语言传播、有组织运作的特点，在俾路支省的社交媒体空间尤为活跃。部分西方智库和媒体借机炒作中巴经济走廊的"债务陷阱"论调，对中资企业声誉形成叠加冲击。这种舆论环境恶化不仅影响中资企业的社会形象，还可能为恐怖袭击提供"正当性"掩护，增加安保工作的难度。\n\n从经济影响评估的角度来看，频繁的安全事件已对中巴经济走廊的商业可持续性产生实质影响。安保成本在项目总成本中的占比从最初的不到3%上升至8%以上，部分高风险项目的安保成本占比甚至超过15%。保险费率大幅攀升，部分保险公司已拒绝为高风险区域的中资项目提供承保。项目工期因安全事件反复延误，导致建设成本超支、投资回报周期延长。部分中资企业开始重新评估在巴基斯坦的投资策略，个别企业已考虑放缓或暂停新增投资。这种趋势如果持续，将对中巴经济走廊的长期推进产生不利影响。\n\n从"一带一路"整体推进的角度审视，巴基斯坦安全形势恶化对"一带一路"倡议的国际形象产生负面影响。中巴经济走廊作为"一带一路"旗舰项目，其安全状况受到国际社会高度关注。频繁的安全事件可能影响其他国家对"一带一路"合作的信心，增加项目推进的难度。从国际传播的角度来看，部分西方媒体借巴基斯坦安全事件炒作"一带一路"安全风险论调，对中国海外投资战略形成舆论压力。与此同时，部分潜在合作国家可能以此为参考，在谈判中提出更高的安全保障要求，增加项目成本。中国须从战略高度审视巴基斯坦安全问题的外溢效应，既要切实保障在巴人员和项目安全，也要做好国际传播工作，维护"一带一路"倡议的国际形象。',
        advice: '建议建立中方人员出行安保规程，强制配备武装护卫，限制非必要外出。从人员安全防护的具体措施来看，中方人员在巴基斯坦的出行须严格遵守安保规程，所有外出活动必须提前报备、配备武装护卫、规划安全路线。推动巴方建立中巴经济走廊特别安保部队，由军方直接指挥、专职负责中资项目和人员的安全保护。对高风险区域的项目人员，实施非必要不外出政策，确需外出的必须由安保车队护送。\n\n项目保护方面，建议对高风险项目实施分区管理，高风险区项目暂停非必要施工。加强施工现场物理防护，提升围墙、监控、门禁等安防设施标准。从项目安保体系建设的角度，应建立多层级防护体系，包括外围巡逻、围界防护、核心区安保三个层次。对达苏水电站、瓜达尔港等核心项目，建议增派安保力量、部署先进安防设备、建立应急避难场所。\n\n情报监测方面，建议建立与巴三军情报局的情报共享机制，获取预警信息。利用卫星遥感监测项目周边异常活动，提升预警的及时性和准确性。从情报体系建设的角度，应建立专项监测小组，定期形成情报简报，加强与使馆、安保力量、中资企业之间的情报共享和协同分析。对关键信息进行交叉验证、多维度评估，提升情报准确性和可靠性。\n\n外交协调方面，建议推动巴方从根源治理恐怖主义，加强中阿巴三方反恐合作。从外交策略来看，应通过高层互访和外交渠道，推动巴方加大对涉华恐怖袭击的侦破和惩处力度。加强与阿富汗临时政府的沟通，推动其切断巴基斯坦塔利班在阿富汗境内的庇护所。利用上海合作组织等多边机制，推动区域反恐合作。\n\n应急准备方面，建议完善撤离预案，储备应急物资，建立24小时应急响应中心。各企业须明确应急责任人、应急联络人，定期组织应急演练。从应急体系建设的角度，应建立分级响应机制，根据威胁等级启动相应的应急措施。储备充足的应急物资，包括通信设备、医疗用品、食品饮水等，确保在紧急情况下能够维持基本运转。加强人员心理疏导，确保人员情绪稳定，避免因恐慌导致的不理智行为。\n\n风险融合方面，建议将巴基斯坦安全风险与中巴经济走廊项目投资风险评估融合，动态调整投资优先级。从风险融合管理的角度，应建立安全风险与经济风险的联动评估机制，将安全事件对项目投资回报的影响量化评估，为投资决策提供依据。建立跨部门风险研判机制，定期组织安全、商务、财务等部门联合评估，统一风险认知。对高风险项目，应启动投资重组或退出评估，避免持续投入导致更大损失。对中低风险项目，应通过加强安保投入、优化项目结构等方式降低风险敞口。建立风险预警指标体系，对安全事件频率、安保成本占比、保险费率等关键指标进行动态监测。',
        materials: [
          { id: 'CART-alert-002', source: '预警中心', title: '瓜达尔港附近中方人员遭袭击', country: '巴基斯坦', date: '2024-10-06 23:15', severity: 'red', desc: '俾路支分离主义武装袭击中方人员车队', type: 'alert' },
          { id: 'CART-alert-003', source: '预警中心', title: '达苏水电站项目遭恐怖袭击，5名中方人员遇难', country: '巴基斯坦', date: '2024-03-26 13:00', severity: 'red', desc: '自杀式炸弹袭击', type: 'alert' },
          { id: 'CART-event-002', source: '事件追踪', title: '达苏水电站项目中方人员遭自杀式袭击', country: '巴基斯坦', date: '2024-03-26', severity: 'critical', desc: '5名中方工程师遇难', type: 'event' },
          { id: 'CART-country-002', source: '国家风险', title: '巴基斯坦 风险评估', country: '巴基斯坦', date: '', severity: '高', desc: '中巴经济走廊核心区域', type: 'country' },
          { id: 'CART-enterprise-001', source: '企业资产', title: '中国交通建设', country: '巴基斯坦、缅甸、肯尼亚...', date: '', severity: '', desc: '建筑工程 | 总部:北京 | 投资:52亿$', type: 'enterprise' }
        ],
        createTime: lastMonth,
        author: '系统预置',
        updateTime: lastWeek
      },
      {
        id: 'AIR-100003',
        title: '刚果(金)M23武装冲突与中资矿业资产安全评估',
        country: '刚果(金)',
        threatLevel: 'high',
        reportType: '安全风险',
        summary: '2025年2月，M23武装在刚果(金)东部发动近年来最大规模军事进攻，连续攻占北基伍省省会戈马和南基伍省首府布卡武，政府军溃退，联合国维和部队未能有效干预。紫金矿业卡莫阿铜矿位于南部卢阿拉巴省，距战区约1500公里，虽未直接受攻击，但供应链和人员流动受到显著影响。刚果(金)是中国钴铜矿资源的重要来源国，安全形势恶化直接影响全球新能源产业链稳定。本报告基于多源情报素材，分析刚果(金)安全形势对中资矿业资产的威胁，提出分级应对建议。',
        elements: {
          time: '2025年2月起，冲突持续升级中',
          place: '刚果(金)北基伍省（戈马）、南基伍省（布卡武）、卢阿拉巴省（科卢韦齐）',
          person: 'M23武装（"3月23日运动"）、刚果(金)政府军(FARDC)、联合国维和部队(MONUSCO)、紫金矿业、中铝等中资矿企人员',
          cause: 'M23武装与刚果政府长期政治矛盾，叠加卢旺达大屠杀后地区族群冲突外溢，以及钴铜矿产资源争夺',
          process: '2025年1月底M23从北基伍省向南部推进，2月初攻占省会戈马，2月中旬攻占南基伍首府布卡武。政府军溃退，联合国维和部队未有效干预。矿区虽距战区较远但交通线受威胁',
          result: '数千人伤亡，超百万人流离失所。紫金矿业卡莫阿铜矿未直接受攻击但供应链中断、人员撤离成本上升。钴矿价格波动影响全球新能源供应链'
        },
        threatAnalysis: '经多源情报融合分析，刚果(金)东部武装冲突呈现出规模升级、范围扩大、外溢风险上升的演变态势。M23武装在2025年初发动的军事进攻是近年来最大规模的武装冲突，该组织从北基伍省出发，短时间内连续攻占两座省会城市，展现出远超此前的组织能力和军事能力。从战场态势来看，刚果(金)政府军溃退速度超出预期，联合国维和部队未能有效阻止M23的推进，东部安全形势急剧恶化。M23的快速推进得益于其较强的装备水平和战术素养，有情报显示外部势力为其提供了武器和训练支持。\n\n中国企业在刚果(金)矿业投资超100亿美元，其中钴矿占全球储量70%以上。从矿业资产安全的维度来看，中资矿企的主要资产集中在南部卢阿拉巴省和上加丹加省，距当前战区约1500公里，短期内直接受攻击的可能性较低。但从间接影响来看，冲突导致全国安全形势紧张，矿区安保压力显著上升。交通线安全方面，连接东部和南部的公路运输走廊受到威胁，物资运输和人员通勤面临安全风险。供应链中断方面，钴铜矿石的运输和出口可能受到影响，导致项目运营受阻。\n\n供应链风险方面，刚果(金)钴矿供应全球70%的钴原料，冲突导致钴价剧烈波动，直接影响中国新能源汽车产业链。从全球供应链的传导效应来看，钴是锂电池正极材料的关键原料，钴价上涨将推高电池成本，进而影响新能源汽车的终端价格和市场竞争力。部分中国电池企业已开始评估供应链风险，考虑增加战略库存或寻找替代供应源。从长期来看，如果冲突持续，可能导致全球钴供应格局重塑，中国在钴资源领域的优势地位面临挑战。\n\n人员安全风险方面，约500名中方矿业人员在刚果(金)工作，安全撤离和日常运营受到威胁。从人员安全的具体影响来看，东部高风险区域的中方人员须立即撤离，南部矿区人员须保持高度警戒。人员通勤路线可能经过不稳定区域，存在被武装分子拦截或绑架的风险。矿区营地的安保力量面临考验，须提升警戒等级、加强物理防护。\n\n政治风险方面，冲突可能引发政权更迭，新政权对华态度存在不确定性。从政治风险的维度来看，刚果(金)政局稳定性直接影响中资矿企的运营环境。如果冲突持续升级，可能导致中央政府控制力下降，地方势力抬头，矿业法规和投资政策可能发生变化。部分西方势力可能利用冲突削弱中国在刚果(金)的影响力，通过支持特定武装派系或推动国际干预来实现战略目的。国际博弈方面，卢旺达被指控支持M23武装，西方势力在刚果(金)影响力上升。刚果(金)丰富的矿产资源使其成为大国竞争的重要舞台，美国、欧盟近年来加大了对刚果(金)的关注，通过援助、投资和军事合作等方式扩大影响力。\n\n从环境与社会治理风险的角度审视，刚果(金)东部冲突加剧了矿产资源开采的环境和社会问题。国际社会对"冲突矿产"的关注度持续上升，部分国际组织和非政府组织已开始调查冲突地区矿产资源的开采和贸易情况。如果中资矿企被卷入"冲突矿产"争议，将面临国际声誉受损、市场准入受限、供应链审查加强等多重风险。从环境治理的角度来看，冲突导致东部矿区监管真空，非法采矿活动可能蔓延，对中资矿企的合规运营形成压力。部分下游企业开始要求供应商提供矿产来源证明，对供应链透明度提出更高要求。中资矿企须提前布局环境、社会和治理(ESG)体系建设，防范合规风险。\n\n从区域外溢风险的角度来看，刚果(金)东部冲突具有显著的区域扩散效应。M23武装的快速推进可能鼓励刚果(金)东部其他武装组织效仿，导致冲突进一步扩大。卢旺达、布隆迪、坦桑尼亚等邻国的安全形势可能受到波及，区域难民潮加剧人道主义危机。从区域经济影响来看，东非共同体(EAC)内部贸易可能受到干扰，南部非洲发展共同体(SADC)也已介入调解。冲突如果持续升级，可能导致大湖区安全格局重塑，影响中国在非洲大湖区的整体利益。中资企业在该区域的矿业、基建、农业等项目均可能受到连锁影响，须从区域视角审视风险敞口。',
        advice: '建议对东部高风险区域中方人员进行预防性撤离，南部矿区人员保持高度警戒。从人员安全保护的具体措施来看，东部北基伍省和南基伍省的中方人员须立即启动撤离程序，经卢旺达或坦桑尼亚撤离至安全区域。南部卢阿拉巴省和上加丹加省的矿区人员须提升警戒等级，压缩非必要外出活动。建立矿区安全缓冲区，加强营地物理防护和安保巡逻，确保中方人员的人身安全。与当地军方和联合国维和部队建立联络机制，获取安全预警信息。\n\n项目保护方面，建议卡莫阿铜矿等南部矿区维持运营但缩减非必要活动。加强矿区物理防护和安保力量，提升围墙、监控、门禁等安防设施标准。从项目安保体系建设的角度，应建立多层级防护体系，包括外围巡逻队、围界监控系统、核心区安保力量三个层次。对关键设施和核心资产，制定专项保护方案并定期演练。对高价值矿产品和精炼金属，加强仓储安保和运输护卫。\n\n情报监测方面，建议利用卫星遥感监测冲突走向和矿区周边安全态势。建立与刚果(金)军方和联合国维和部队的情报共享机制，获取前线战况和威胁预警。从情报体系建设的角度，应建立专项监测小组，定期形成情报简报。加强与使馆、安保力量、中资企业之间的情报共享和协同分析。对关键信息进行交叉验证、多维度评估，提升情报准确性和可靠性。密切关注M23武装的推进方向和战术变化，及时调整防护策略。\n\n供应链备份方面，建议加快印尼镍钴资源开发，分散供应链风险。储备战略钴库存，确保在供应中断情况下能够维持生产。从供应链战略的角度，应建立多元化供应体系，减少对单一来源的依赖。加快与印尼、菲律宾、澳大利亚等国家的钴矿资源合作，构建多源供应网络。对关键矿物原料建立战略储备制度，确保在突发事件情况下的供应安全。推动废旧电池回收利用技术的研发和应用，构建钴资源的循环利用体系。\n\n外交协调方面，建议通过联合国和非盟平台推动冲突政治解决，支持刚果(金)主权和领土完整。从外交策略来看，中国应在刚果(金)问题上发挥建设性作用，推动通过政治途径解决东部冲突。加强与刚果(金)政府的外交沟通，表达对中方人员和资产安全的关切。利用中国在联合国安理会的影响力，推动加强对刚果(金)东部冲突的国际关注和斡旋努力。与卢旺达等周边国家加强沟通，推动地区和平稳定。\n\n风险融合方面，建议将刚果(金)安全风险与全球钴供应链风险评估融合，建立钴资源供应预警机制。从风险融合管理的角度，应建立安全风险与供应链风险的联动评估机制，将冲突对钴供应的影响量化评估，为供应链决策提供依据。建立全球钴供应链监测平台，对刚果(金)钴矿产量、出口量、价格波动等关键指标进行动态监测。与下游电池企业、新能源汽车企业建立信息共享机制，确保供应链风险信息的及时传递。对关键矿物原料建立战略储备制度，储备量不少于三个月的用量。推动废旧电池回收利用技术的研发和应用，构建钴资源的循环利用体系，降低对原生钴矿的依赖。积极参与国际矿产治理合作，提升中国在全球矿产供应链中的话语权和影响力。',
        materials: [
          { id: 'CART-alert-004', source: '预警中心', title: 'M23武装攻占布卡武，东部安全形势急剧恶化', country: '刚果(金)', date: '2025-02-16 14:30', severity: 'red', desc: 'M23武装攻占南基伍省首府布卡武', type: 'alert' },
          { id: 'CART-event-003', source: '事件追踪', title: 'M23武装攻占布卡武，东部局势急剧恶化', country: '刚果(金)', date: '2025-02-16', severity: 'critical', desc: '近年来最大规模军事进攻', type: 'event' },
          { id: 'CART-enterprise-002', source: '企业资产', title: '紫金矿业', country: '塞尔维亚、刚果(金)、哥伦比亚...', date: '', severity: '', desc: '矿业资源 | 总部:龙岩 | 投资:38亿$', type: 'enterprise' },
          { id: 'CART-country-003', source: '国家风险', title: '刚果(金) 风险评估', country: '刚果(金)', date: '', severity: '高', desc: 'M23武装攻占东部，矿区安全受影响', type: 'country' }
        ],
        createTime: now,
        author: '系统预置',
        updateTime: now
      }
    ];

    try {
      localStorage.setItem('orps_ai_reports', JSON.stringify(sampleReports));
    } catch (e) {}

    var sampleCart = [
      { id: 'CART-seed-alert-1', source: '预警中心', title: 'M23武装攻占布卡武，东部安全形势急剧恶化', country: '刚果(金)', date: '2025-02-16 14:30', severity: 'red', desc: 'M23武装攻占南基伍省首府布卡武，向矿区方向推进', type: 'alert' },
      { id: 'CART-seed-alert-2', source: '预警中心', title: '达苏水电站项目遭恐怖袭击，5名中方人员遇难', country: '巴基斯坦', date: '2024-03-26 13:00', severity: 'red', desc: '自杀式炸弹袭击，5名中方工程师遇难', type: 'alert' },
      { id: 'CART-seed-event-1', source: '事件追踪', title: '胡塞武装开始袭击红海商船', country: '也门', date: '2023-11-19', severity: 'critical', desc: '胡塞武装劫持"银河领袖"号货轮，持续袭击红海商船', type: 'event' },
      { id: 'CART-seed-country-1', source: '国家风险', title: '苏丹 风险评估', country: '苏丹', date: '', severity: '极高', desc: '武装部队与快速支援部队爆发全面冲突', type: 'country' },
      { id: 'CART-seed-enterprise-1', source: '企业资产', title: '中国石油天然气集团', country: '伊拉克、哈萨克斯坦、苏丹...', date: '', severity: '', desc: '能源石化 | 总部:北京 | 投资:850亿$', type: 'enterprise' },
      { id: 'CART-seed-threat-1', source: '威胁组织', title: '胡塞武装（安萨尔阿拉运动）', country: '也门', date: '2004', severity: '高', desc: '也门什叶派武装组织，控制也门北部，持续袭击红海航运', type: 'threat' }
    ];
    try {
      localStorage.setItem('orps_aireport_cart', JSON.stringify(sampleCart));
    } catch (e) {}
  }

};
