    /* ============================================================
     * 渲染层（2026-08-19 推倒重设 · 海外安全自动预警作战台）
     * 设计：指挥带 → 境外态势带 → 全生命周期作战看板（侦测→预警→处置→闭环）
     *       + 右侧境外态势栏 + 底部复合功能舱（规则/流水线/日志/复盘）
     * 数据引擎（扫描/规则/SOAR/持久化）不变，仅界面全新。
     * ============================================================ */
    render() {
      var el = document.getElementById('autoalert-content');
      if (!el) return;
      this._load();
      if (!this._deckTab) this._deckTab = 'rules';
      if (typeof this._cnFirst === 'undefined') this._cnFirst = true;
      var st = this._calcStats();
      var html = '';
      html += this._renderCommandBand(st);
      html += this._renderSituationBar();
      html += '<div style="display:grid;grid-template-columns:2.4fr 1fr;gap:12px;align-items:start">';
      html += '<div>' + this._renderKanban() + '</div>';
      html += '<div>' + this._renderSidebar() + '</div>';
      html += '</div>';
      html += this._renderDeck();
      el.innerHTML = html;
      var badge = document.getElementById('sb-autoalert-count');
      if (badge) {
        var active = this._alerts.filter(function (a) { return !a.dismissed; }).length;
        badge.textContent = active;
        badge.classList.toggle('zero', active === 0);
      }
    },

    setDeckTab(t) { this._deckTab = t; this.render(); },
    toggleCnFirst() { this._cnFirst = !this._cnFirst; this.render(); },

    /* ===== ① 指挥带：引擎状态 + 全部控制 + 核心指标 ===== */
    _renderCommandBand(st) {
      var lastRunStr = this._lastRun ? this._lastRun.toLocaleString('zh-CN', { hour12: false }) : '—';
      var wfN = Object.keys(this._workflows).length;
      var html = '<div class="card mb-12" style="padding:10px 14px;border:1px solid rgba(0,212,255,0.25);background:linear-gradient(90deg,rgba(0,212,255,0.05),rgba(255,51,85,0.03))">';
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
      /* 引擎状态灯 */
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:22px">' + (this._engineOn ? '🟢' : '⚪') + '</span>';
      html += '<div><div style="font-size:13px;font-weight:800;color:' + (this._engineOn ? 'var(--green)' : 'var(--text3)') + '">' + (this._engineOn ? '无人值守中' : '引擎已暂停') + '</div>';
      html += '<div style="font-size:9px;color:var(--text3)">下次扫描 <span id="aa-countdown" style="font-family:monospace;color:var(--cyan)">--:--</span> · 上次 ' + lastRunStr + '</div></div>';
      html += '</div>';
      /* 控制台 */
      html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;background:var(--panel2);border-radius:8px">';
      html += '<button class="btn sm" style="font-size:10px" onclick="AUTOALERT.toggleEngine()">' + (this._engineOn ? '⏸ 暂停' : '▶ 启动') + '</button>';
      html += '<button class="btn sm primary" style="font-size:10px" onclick="AUTOALERT.run()">🔍 立即扫描</button>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" title="扫描周期" onchange="AUTOALERT.setScanInterval(this.value)">' + [60, 120, 300, 600, 1800].map(function (n) { return '<option value="' + n + '"' + ((AUTOALERT._settings.scanInterval || 300) === n ? ' selected' : '') + '>' + (n < 60 ? n + 's' : n / 60 + 'min') + '</option>'; }).join('') + '</select>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" title="SOAR自动编排" onclick="AUTOALERT.toggleAutoSoar()">SOAR ' + (this._settings.autoSoar ? '✅' : '⏸️') + '</button>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" title="高置信自动晋升" onclick="AUTOALERT.toggleAutoPromote()">自动晋升 ' + (this._settings.autoPromote ? '✅' : '⏸️') + '</button>';
      html += '</div>';
      /* 核心指标 */
      html += '<div style="display:flex;gap:10px;margin-left:auto;flex-wrap:wrap">';
      html += this._aaMetric('📡', '侦测候选', st.rawTotal, 'var(--orange)');
      html += this._aaMetric('🧠', '智能预警', st.total, 'var(--cyan)');
      html += this._aaMetric('🔴', '紧急/高危', (st.red + st.orange), 'var(--red)');
      html += this._aaMetric('🚀', 'SOAR执行', wfN, 'var(--green)');
      html += this._aaMetric('✅', '已闭环', this._resolved.length, 'var(--text3)');
      html += '</div>';
      html += '</div></div>';
      return html;
    },
    _aaMetric(icon, label, val, color) {
      return '<div style="text-align:center;min-width:62px;padding:6px 8px;background:var(--panel2);border-radius:8px">' +
        '<div style="font-size:13px">' + icon + '</div>' +
        '<div style="font-size:18px;font-weight:800;color:' + color + ';line-height:1.1">' + val + '</div>' +
        '<div style="font-size:9px;color:var(--text3)">' + label + '</div></div>';
    },

    /* ===== ② 境外态势带：数据赋能中国海外安全保护 ===== */
    _renderSituationBar() {
      var me = this;
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var all = active.concat(raw);
      var cnN = 0, orgN = 0, killN = 0;
      var corrCount = {};
      all.forEach(function (a) {
        var tags = me._aaTags(a).map(function (t) { return t.t; });
        if (tags.indexOf('涉我海外利益') >= 0 || tags.indexOf('涉华负面') >= 0) cnN++;
        if (tags.indexOf('威胁组织') >= 0) orgN++;
        if (tags.some(function (t) { return t.indexOf('伤亡') >= 0; })) killN++;
        me._aaCorridorNames(a).forEach(function (c) { corrCount[c] = (corrCount[c] || 0) + 1; });
      });
      var corrTop = Object.keys(corrCount).sort(function (x, y) { return corrCount[y] - corrCount[x]; }).slice(0, 4);
      var html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;padding:9px 12px;background:linear-gradient(90deg,rgba(255,51,85,0.07),rgba(0,212,255,0.04));border:1px solid var(--border);border-radius:8px;font-size:10px;align-items:center">';
      html += '<span style="font-weight:800;color:var(--text)">🌐 境外自动预警态势</span>';
      html += '<span style="color:var(--text3)">🇨🇳涉我海外利益 <b style="color:var(--cyan);font-size:13px">' + cnN + '</b></span>';
      html += '<span style="color:var(--text3)">⚔️威胁组织 <b style="color:var(--orange);font-size:13px">' + orgN + '</b></span>';
      html += '<span style="color:var(--text3)">☠️伤亡事件 <b style="color:var(--red);font-size:13px">' + killN + '</b></span>';
      if (corrTop.length) {
        html += '<span style="color:var(--text3);margin-left:6px">🛰️走廊热点:</span>';
        corrTop.forEach(function (c) {
          html += '<span style="padding:1px 8px;border-radius:8px;border:1px solid var(--red);color:var(--red);font-weight:700">' + c + ' ' + corrCount[c] + '</span>';
        });
      }
      html += '<span style="margin-left:auto;color:var(--text3);font-size:9px">规则引擎 7×24 侦测 · 高置信自动晋升 · SOAR 自动编排</span>';
      html += '</div>';
      return html;
    },

    /* ===== ③ 全生命周期作战看板：侦测→预警→处置→闭环 ===== */
    _renderKanban() {
      var me = this;
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var laneAlert = active.filter(function (a) { return !me._workflows[a.id]; });
      var laneSoar = active.filter(function (a) { return !!me._workflows[a.id]; });
      var laneDone = this._resolved.slice(0, 30);
      var lvW = { red: 3000, orange: 2000, yellow: 1000, blue: 500 };
      var sorter = function (a, b) {
        if (me._cnFirst) { var ta = me._aaTier(a), tb = me._aaTier(b); if (ta !== tb) return ta - tb; }
        var sa = (lvW[a.level] || 0) + Math.round((a.confidence || 0) * 100);
        var sb = (lvW[b.level] || 0) + Math.round((b.confidence || 0) * 100);
        return sb - sa;
      };
      raw.sort(sorter); laneAlert.sort(sorter); laneSoar.sort(sorter);
      var html = '<div class="card" style="padding:10px">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
      html += '<span style="font-size:13px;font-weight:800">⚔️ 预警作战看板</span>';
      html += '<span style="font-size:9px;color:var(--text3)">侦测 → 预警 → 处置 → 闭环 全生命周期</span>';
      html += '<button class="btn sm" style="margin-left:auto;font-size:9px;padding:2px 8px;' + (this._cnFirst ? 'border-color:var(--cyan);color:var(--cyan)' : '') + '" onclick="AUTOALERT.toggleCnFirst()">🇨🇳涉华置顶 ' + (this._cnFirst ? '开' : '关') + '</button>';
      html += '</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;align-items:start">';
      html += this._renderLane('📡 侦测候选', raw, 'var(--orange)', 1, '规则命中·待研判晋升');
      html += this._renderLane('🧠 智能预警', laneAlert, 'var(--cyan)', 2, '已研判·涉华优先');
      html += this._renderLane('🚀 处置编排', laneSoar, 'var(--purple,#a06bff)', 3, 'SOAR 自动响应中');
      html += this._renderLane('✅ 已闭环', laneDone, 'var(--green)', 4, '确认/消除/驳回归档');
      html += '</div></div>';
      return html;
    },
    _renderLane(title, list, color, lane, sub) {
      var me = this;
      var html = '<div style="background:var(--panel2);border-radius:8px;padding:8px;min-height:200px;border-top:2px solid ' + color + '">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
      html += '<span style="font-size:11px;font-weight:800;color:' + color + '">' + title + '</span>';
      html += '<span class="badge" style="font-size:9px;background:' + color + '22;color:' + color + '">' + list.length + '</span>';
      html += '</div>';
      html += '<div style="font-size:8px;color:var(--text3);margin:-4px 0 8px">' + sub + '</div>';
      if (!list.length) {
        html += '<div style="text-align:center;padding:22px 4px;color:var(--text3);font-size:10px;opacity:.6">' + (lane === 1 ? '实时数据到达后自动生成候选' : lane === 4 ? '暂无闭环记录' : '暂无') + '</div>';
      } else {
        html += '<div style="display:grid;gap:6px;max-height:560px;overflow-y:auto">';
        list.slice(0, 40).forEach(function (a) { html += me._renderKanbanCard(a, lane); });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    _renderKanbanCard(a, lane) {
      var me = this;
      var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
      var lvDot = a.level === 'red' ? '🔴' : a.level === 'orange' ? '🟠' : a.level === 'yellow' ? '🟡' : '🔵';
      var id = String(a.id || '').replace(/'/g, "\\'");
      var clickFn = lane === 4 ? "AUTOALERT._showResolvedDetail('" + id + "')" : "AUTOALERT._showDetail('" + id + "')";
      var tags = lane === 4 ? [] : this._aaTags(a).slice(0, 3);
      var html = '<div style="padding:8px;background:var(--bg);border-radius:6px;border-left:3px solid ' + lvClr + ';cursor:pointer;transition:.15s" onclick="' + clickFn + '">';
      html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;flex-wrap:wrap">';
      html += '<span style="font-size:9px">' + lvDot + '</span>';
      if (lane === 4) {
        var actClr = a.resolvedAction === 'confirmed' ? 'var(--green)' : a.resolvedAction === 'dismissed' ? 'var(--orange)' : 'var(--text3)';
        var actLabel = a.resolvedAction === 'confirmed' ? '✅已确认' : a.resolvedAction === 'dismissed' ? '❌已消除' : a.resolvedAction === 'rejected' ? '🚫已驳回' : '📦已清空';
        html += '<span style="font-size:8px;font-weight:700;color:' + actClr + '">' + actLabel + '</span>';
      } else {
        html += '<span style="font-size:8px;color:var(--text3)">置信 ' + Math.round((a.confidence || 0) * 100) + '%</span>';
        if (lane === 3) {
          var wf = this._workflows[a.id];
          var stepN = wf && wf.steps ? wf.steps.length : 0;
          html += '<span style="font-size:8px;color:var(--green)">SOAR ' + (wf && wf.status === 'completed' ? '完成' : '运行') + '·' + stepN + '步</span>';
        }
      }
      html += '</div>';
      html += '<div style="font-size:11px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.title_zh || a.title || '') + '</div>';
      if (tags.length) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">' + tags.map(function (tg) { return '<span style="font-size:8px;padding:0 4px;border-radius:5px;border:1px solid ' + tg.c + ';color:' + tg.c + '">' + tg.t + '</span>'; }).join('') + '</div>';
      }
      html += '<div style="display:flex;gap:8px;font-size:8px;color:var(--text3);margin-top:4px;flex-wrap:wrap">';
      html += '<span>🌍 ' + (a.country || '—') + '</span><span>⏱ ' + String(a.time || a.resolvedAt || '').slice(5, 16) + '</span>';
      html += '</div>';
      /* 泳道专属操作 */
      if (lane === 1) {
        html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm primary" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.promoteRaw(\'' + id + '\')">⬆️ 晋升</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.rejectRaw(\'' + id + '\')">✕ 驳回</button>';
        html += '</div>';
      } else if (lane === 2) {
        html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--green)" onclick="AUTOALERT.confirmAlert(\'' + id + '\')">✅</button>';
        html += '<button class="btn sm danger" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.dismissAlert(\'' + id + '\')">✕</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--cyan)" onclick="AUTOALERT.runManualWorkflow(\'' + id + '\')">🚀</button>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    /* ===== ④ 右侧境外态势栏：涉我海外利益分布 / 走廊监控 / 威胁组织榜 / 人工介入 ===== */
    _renderSidebar() {
      var me = this;
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var all = active.concat(raw);
      var html = '';
      /* 涉我海外利益五维命中分布 */
      var dims = [
        { n: '人员与项目', re: /员工|人员|公民|华人|华侨|工程师|工人|项目部|营地|撤侨|Chinese (worker|engineer|national)/i },
        { n: '通道与资产', re: /中资|中企|资产|工厂|矿山|港口|油田|管道|走廊|CPEC|瓜达尔|铁路|大坝/i },
        { n: '制裁与合规', re: /制裁|合规|出口管制|实体清单|关税|sanction/i },
        { n: '涉华舆情', re: /涉华|对华|反华|辱华|中国.*舆论|民调/i },
        { n: '冲突与政局', re: /冲突|政变|选举|政局|动荡|军政府|内战/i }
      ];
      var dimRows = dims.map(function (d) {
        var c = all.filter(function (a) { return d.re.test(String(a.title || '') + String(a.title_zh || '') + String(a.desc || '')); }).length;
        return { n: d.n, c: c };
      });
      var dimMax = Math.max(1, Math.max.apply(null, dimRows.map(function (r) { return r.c; })));
      html += '<div class="card" style="padding:10px;margin-bottom:12px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">🇨🇳 涉我海外利益命中分布</div>';
      dimRows.forEach(function (r) {
        var w = Math.round(r.c / dimMax * 100);
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:10px">';
        html += '<span style="width:64px;color:var(--text2)">' + r.n + '</span>';
        html += '<div style="flex:1;height:8px;background:var(--panel2);border-radius:4px;overflow:hidden"><div style="width:' + w + '%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--red));border-radius:4px"></div></div>';
        html += '<b style="color:var(--cyan);min-width:18px;text-align:right">' + r.c + '</b></div>';
      });
      html += '</div>';
      /* 高危走廊监控 */
      var corrCount = {};
      all.forEach(function (a) { me._aaCorridorNames(a).forEach(function (c) { corrCount[c] = (corrCount[c] || 0) + 1; }); });
      var corrList = Object.keys(corrCount).sort(function (x, y) { return corrCount[y] - corrCount[x]; }).slice(0, 6);
      html += '<div class="card" style="padding:10px;margin-bottom:12px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">🛰️ 高危走廊实时监控</div>';
      if (!corrList.length) html += '<div style="font-size:10px;color:var(--text3);padding:8px 0">当前无走廊命中</div>';
      corrList.forEach(function (c) {
        var hot = corrCount[c] >= 5;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;margin-bottom:4px;background:var(--panel2);border-radius:6px;border-left:2px solid ' + (hot ? 'var(--red)' : 'var(--orange)') + ';font-size:10px">';
        html += '<span style="font-weight:600">' + c + '</span><b style="color:' + (hot ? 'var(--red)' : 'var(--orange)') + '">' + corrCount[c] + '</b></div>';
      });
      html += '</div>';
      /* 威胁组织活跃榜 */
      var orgCount = {};
      all.forEach(function (a) { me._aaOrgNames(a).forEach(function (o) { orgCount[o] = (orgCount[o] || 0) + 1; }); });
      var orgList = Object.keys(orgCount).sort(function (x, y) { return orgCount[y] - orgCount[x]; }).slice(0, 6);
      html += '<div class="card" style="padding:10px;margin-bottom:12px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">⚔️ 威胁组织活跃榜</div>';
      if (!orgList.length) html += '<div style="font-size:10px;color:var(--text3);padding:8px 0">当前无威胁组织命中</div>';
      orgList.forEach(function (o, i) {
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:10px;border-bottom:1px dashed var(--border)">';
        html += '<span style="color:var(--orange);font-weight:800;width:14px">' + (i + 1) + '</span>';
        html += '<span style="flex:1">' + o + '</span><b style="color:var(--red)">' + orgCount[o] + '</b></div>';
      });
      html += '</div>';
      /* 需人工介入 TOP3 */
      var needHuman = active.filter(function (a) { return !a.confirmed; }).concat(raw);
      needHuman.sort(function (a, b) { return (b.severityScore || 0) - (a.severityScore || 0); });
      needHuman = needHuman.slice(0, 3);
      html += '<div class="card" style="padding:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">💡 需人工介入 <span style="font-size:9px;color:var(--text3);font-weight:400">按优先级</span></div>';
      if (!needHuman.length) {
        html += '<div style="font-size:10px;color:var(--green);padding:8px 0">✅ 当前无需人工介入，系统自动处置中</div>';
      } else {
        needHuman.forEach(function (a) {
          var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : 'var(--yellow)';
          var id = String(a.id || '').replace(/'/g, "\\'");
          html += '<div style="padding:6px 8px;margin-bottom:5px;background:var(--panel2);border-radius:6px;border-left:2px solid ' + lvClr + ';cursor:pointer" onclick="AUTOALERT._showDetail(\'' + id + '\')">';
          html += '<div style="font-size:10px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.title_zh || a.title || '') + '</div>';
          html += '<div style="font-size:8px;color:var(--text3);margin-top:2px">' + (a.country || '') + ' · 优先级 ' + (a.severityScore || 0).toFixed(1) + '</div></div>';
        });
      }
      html += '</div>';
      return html;
    },

    /* ===== ⑤ 底部复合功能舱：规则工厂 / 检测流水线 / 机器人日志 / 复盘看板 ===== */
    _renderDeck() {
      var tabs = [
        { k: 'rules', icon: '🏭', n: '规则工厂' },
        { k: 'pipeline', icon: '🔄', n: '检测流水线' },
        { k: 'logs', icon: '📝', n: '机器人日志' },
        { k: 'review', icon: '📈', n: '复盘看板' }
      ];
      var html = '<div style="margin-top:12px">';
      html += '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
      var me = this;
      tabs.forEach(function (t) {
        var on = me._deckTab === t.k;
        html += '<button class="btn sm" style="font-size:10px;padding:4px 14px;' + (on ? 'border-color:var(--cyan);color:var(--cyan);background:rgba(0,212,255,0.08)' : '') + '" onclick="AUTOALERT.setDeckTab(\'' + t.k + '\')">' + t.icon + ' ' + t.n + '</button>';
      });
      html += '</div>';
      if (this._deckTab === 'rules') html += this._renderRuleFactory();
      else if (this._deckTab === 'pipeline') html += this._renderPipeline();
      else if (this._deckTab === 'logs') html += this._renderRobotLogs();
      else html += this._renderReviewPanel();
      html += '</div>';
      return html;
    },

    /* ===== 维度工具：走廊/组织/标签/分层 ===== */
    _aaCorridorNames(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '') + ' ' + String(a.country || '');
      var defs = [
        ['中巴走廊·俾路支', /俾路支|瓜达尔|中巴经济走廊|CPEC|沙盖|奎达/i],
        ['阿富汗', /阿富汗|喀布尔|坎大赫|坎大哈/i],
        ['霍尔木兹海峡', /霍尔木兹|Hormuz/i],
        ['红海·亚丁湾', /红海|亚丁湾|曼德海峡|曼德|胡塞/i],
        ['萨赫勒', /萨赫勒|马里|尼日尔|布基纳法索/i],
        ['中亚', /哈萨克斯坦|乌兹别克|塔吉克|吉尔吉斯|土库曼|中亚/i],
        ['叙利亚', /叙利亚|大马士革/i],
        ['伊拉克', /伊拉克|巴格达|摩苏尔/i],
        ['索马里', /索马里|摩加迪沙/i],
        ['巴基斯坦', /巴基斯坦|伊斯兰堡|白沙瓦|卡拉奇/i],
        ['缅甸', /缅甸|仰光|若开/i],
        ['苏丹', /苏丹|喀土穆/i]
      ];
      var out = [];
      defs.forEach(function (d) { if (d[1].test(t)) out.push(d[0]); });
      return out;
    },
    _aaOrgNames(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
      var defs = [
        ['塔利班', /塔利班|Taliban/i],
        ['伊斯兰国(IS-K)', /伊斯兰国|ISIS|ISIL|IS-K|ISKP|Islamic State/i],
        ['基地组织', /基地组织|Qaeda/i],
        ['胡塞武装', /胡塞|Houthi/i],
        ['真主党', /真主党|Hezbollah/i],
        ['哈马斯', /哈马斯|Hamas/i],
        ['博科圣地', /博科圣地|Boko Haram/i],
        ['青年党', /青年党|Shabaab/i],
        ['俾路支解放军(BLA)', /俾路支解放军|BLA/i],
        ['巴塔(TTP)', /TTP|巴基斯坦塔利班/i]
      ];
      var out = [];
      defs.forEach(function (d) { if (d[1].test(t)) out.push(d[0]); });
      return out;
    },
    _aaTags(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '') + ' ' + String(a.country || '');
      var tags = [];
      if (a.chinaNegative || a._chinaNegative) tags.push({ t: '涉华负面', c: 'var(--orange)' });
      if (/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i.test(t)) tags.push({ t: '涉我海外利益', c: 'var(--cyan)' });
      if (a.asset_tags && a.asset_tags.length) tags.push({ t: '命中中资资产', c: 'var(--red)' });
      if (this._aaOrgNames(a).length) tags.push({ t: '威胁组织', c: 'var(--orange)' });
      if (this._aaCorridorNames(a).length) tags.push({ t: '高危走廊', c: 'var(--red)' });
      var cm = t.match(/(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
      var deaths = cm ? parseInt(cm[1] || cm[2], 10) : 0;
      if (deaths >= 10) tags.push({ t: '重大伤亡 ' + deaths + '死', c: 'var(--red)' });
      else if (deaths > 0) tags.push({ t: '伤亡 ' + deaths + '死', c: 'var(--orange)' });
      return tags;
    },
    _aaTier(a) {
      var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
      if (a.chinaNegative || a._chinaNegative) return 0;
      if (/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i.test(t)) return 1;
      if (this._aaCorridorNames(a).length) return 2;
      return 3;
    },

    /* ===== 功能舱内容（规则工厂/流水线/日志/复盘，供 Tab 调用） ===== */
    _renderRuleFactory() {
      var rs = this._getRuleStats();
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">🏭</span>智能规则工厂 <span style="font-size:10px;color:var(--text3);font-weight:400">— 可配置规则开关、阈值、权重</span></div>';
      html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';
      RULE_DEFINITIONS.forEach(function (r, i) {
        var cfg = AUTOALERT._getRule(r.id);
        var active = cfg.enabled;
        html += '<div style="padding:10px;background:' + (active ? 'var(--panel2)' : 'rgba(128,128,128,0.08)') + ';border-radius:8px;border:1px solid ' + (active ? r.color + '44' : 'var(--border)') + '">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
        html += '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">' + r.icon + '</span><span style="font-size:12px;font-weight:700;color:' + (active ? 'var(--text)' : 'var(--text3)') + '">' + r.name + '</span></div>';
        html += '<label style="position:relative;display:inline-block;width:34px;height:18px;cursor:pointer"><input type="checkbox" ' + (active ? 'checked' : '') + ' onchange="AUTOALERT.toggleRule(\'' + r.id + '\')" style="opacity:0;width:0;height:0"><span style="position:absolute;inset:0;background:' + (active ? r.color : 'var(--border)') + ';border-radius:18px;transition:.2s"></span><span style="position:absolute;top:2px;left:' + (active ? '18px' : '2px') + ';width:14px;height:14px;background:#fff;border-radius:50%;transition:.2s"></span></label>';
        html += '</div>';
        html += '<div style="font-size:9px;color:var(--text3);line-height:1.4;margin-bottom:6px">' + r.desc + '</div>';
        if (r.params) {
          r.params.forEach(function (p) {
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:10px">';
            html += '<span>' + p.label + '</span>';
            html += '<input type="number" value="' + cfg[p.key] + '" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" style="width:70px;font-size:10px;padding:3px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px" onchange="AUTOALERT.setRuleParam(\'' + r.id + '\',\'' + p.key + '\',this.value)">';
            html += '</div>';
          });
        }
        html += '<div style="margin-top:6px"><span class="badge" style="font-size:9px;background:' + r.color + '22;color:' + r.color + '">命中 ' + rs[i] + ' 项</span></div>';
        html += '</div>';
      });
      html += '</div></div>';
      return html;
    },
    _renderPipeline() {
      var steps = [
        { icon: '📡', name: '数据采集', desc: '2286+ 数据源实时采集', active: true },
        { icon: '🧹', name: '清洗归一', desc: '去重/翻译/标签/关联', active: true },
        { icon: '🔍', name: '原始检测', desc: '规则命中生成候选', active: this._rawAlerts.length > 0 || this._hasRun },
        { icon: '🧠', name: '智能研判', desc: '置信度/影响面评估', active: this._alerts.length > 0 },
        { icon: '📋', name: '自动编排', desc: 'SOAR playbook 匹配', active: this._settings.autoSoar },
        { icon: '🚀', name: '自动响应', desc: '通知/取证/升级/归档', active: Object.keys(this._workflows).length > 0 },
        { icon: '📦', name: '复盘归档', desc: '命中率/误报率统计', active: this._scanCount > 0 }
      ];
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">🔄</span>自动检测流水线</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;overflow-x:auto;padding:4px">';
      steps.forEach(function (s, i) {
        html += '<div style="flex:1;min-width:110px;padding:10px 6px;background:' + (s.active ? 'rgba(0,212,255,0.06)' : 'var(--panel2)') + ';border-radius:8px;text-align:center;border:1px solid ' + (s.active ? 'var(--cyan)33' : 'transparent') + '">';
        html += '<div style="font-size:20px;opacity:' + (s.active ? '1' : '0.5') + '">' + s.icon + '</div>';
        html += '<div style="font-size:11px;font-weight:600;margin-top:4px;color:' + (s.active ? 'var(--text)' : 'var(--text3)') + '">' + s.name + '</div>';
        html += '<div style="font-size:9px;color:var(--text3);margin-top:2px;line-height:1.3">' + s.desc + '</div>';
        html += '</div>';
        if (i < steps.length - 1) html += '<div style="color:var(--text3);font-size:14px">→</div>';
      });
      html += '</div></div>';
      return html;
    },
    _renderRobotLogs() {
      var logs = this._robotLogs.slice(0, 20);
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">📝</span>响应机器人日志</div>';
      if (logs.length === 0) {
        html += '<div class="empty"><div class="ic">📝</div><div style="font-size:12px">暂无机器日志</div></div>';
      } else {
        html += '<div style="display:grid;gap:5px;max-height:320px;overflow-y:auto">';
        logs.forEach(function (l) {
          var color = l.level === 'success' ? 'var(--green)' : l.level === 'warn' ? 'var(--orange)' : 'var(--cyan)';
          html += '<div style="padding:8px;background:var(--panel2);border-radius:6px;border-left:2px solid ' + color + '">';
          html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-bottom:2px"><span>' + l.time + '</span><span style="color:' + color + '">●</span></div>';
          html += '<div style="font-size:11px;font-weight:600">' + l.action + '</div>';
          html += '<div style="font-size:10px;color:var(--text2);line-height:1.4">' + l.detail + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    _renderReviewPanel() {
      var rv = this._calcReviewStats();
      var html = '<div class="card">';
      html += '<div class="card-tt"><span class="ic">📈</span>自动复盘看板</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">';
      html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;text-align:center"><div style="font-size:9px;color:var(--text3)">命中率</div><div style="font-size:20px;font-weight:700;color:var(--cyan)">' + rv.hitRate + '%</div></div>';
      html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;text-align:center"><div style="font-size:9px;color:var(--text3)">误报率</div><div style="font-size:20px;font-weight:700;color:var(--orange)">' + rv.falsePositive + '%</div></div>';
      html += '<div style="padding:10px;background:var(--panel2);border-radius:8px;text-align:center"><div style="font-size:9px;color:var(--text3)">自动处置率</div><div style="font-size:20px;font-weight:700;color:var(--green)">' + rv.autoRate + '%</div></div>';
      html += '</div>';
      html += '<div style="display:flex;gap:8px;justify-content:space-between;font-size:10px;color:var(--text2);padding:8px;background:var(--bg);border-radius:6px;flex-wrap:wrap">';
      html += '<span>✅ 已确认 ' + rv.confirmed + '</span><span>❌ 已消除 ' + rv.dismissed + '</span><span>⏳ 待处理 ' + rv.pending + '</span><span>🔄 扫描 ' + rv.scanCount + '</span><span>📡 实时流入 ' + rv.liveIngest + '</span>';
      html += '</div>';
      html += '</div>';
      return html;
    },
