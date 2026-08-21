    /* ============================================================
     * 渲染层 v2（2026-08-19 推倒重设 · 深色指挥大屏风）
     * 用户选定方向：SOC 作战大屏（发光/脉冲/大数字）+ 四大功能：
     * ①预警一键操作 ②Leaflet 实时预警地图联动 ③多维筛选+预设 ④红警声音+弹窗提醒
     * 布局：指挥带 / 左境外态势栏 · 中实时地图+情报流 · 右作战队列(Tab) / 底部功能舱
     * ============================================================ */
    render() {
      var el = document.getElementById('autoalert-content');
      if (!el) return;
      this._load();
      if (!this._deckTab) this._deckTab = 'rules';
      if (!this._queueTab) this._queueTab = 'alert';
      if (typeof this._cnFirst === 'undefined') this._cnFirst = true;
      if (!this._filters) this._filters = { country: '', corridor: '', org: '', cnOnly: false, timeRange: '24h' };
      var st = this._calcStats();
      var html = '<div class="aa-scanline" style="padding:2px">';
      html += this._renderCommandBand(st);
      html += '<div style="display:grid;grid-template-columns:252px minmax(0,1fr) 432px;gap:10px;align-items:start">';
      /* 左栏：境外态势 */
      html += '<div>' + this._renderSidebar() + '</div>';
      /* 中栏：筛选条 + 实时地图 + 情报流 */
      html += '<div style="min-width:0">' + this._renderFilterBar() + this._renderWarMap() + this._renderLiveTicker() + '</div>';
      /* 右栏：作战队列 */
      html += '<div>' + this._renderQueuePanel() + '</div>';
      html += '</div>';
      html += this._renderDeck();
      html += '</div>';
      el.innerHTML = html;
      this._initWarMap();
      var badge = document.getElementById('sb-autoalert-count');
      if (badge) {
        var active = this._alerts.filter(function (a) { return !a.dismissed; }).length;
        badge.textContent = active;
        badge.classList.toggle('zero', active === 0);
      }
    },

    setDeckTab(t) { this._deckTab = t; this.render(); },
    setQueueTab(t) { this._queueTab = t; this.render(); },
    toggleCnFirst() { this._cnFirst = !this._cnFirst; this.render(); },
    setFilter(k, v) { this._filters[k] = v; this.render(); },
    resetFilters() { this._filters = { country: '', corridor: '', org: '', cnOnly: false, timeRange: '24h' }; this.render(); },
    cycleNotify() {
      var modes = ['all', 'cn', 'off'];
      var cur = this._settings.notifyMode || 'all';
      var next = modes[(modes.indexOf(cur) + 1) % modes.length];
      this._settings.notifyMode = next;
      this._saveSettings();
      this.render();
      if (typeof showToast === 'function') showToast('红警提醒：' + (next === 'all' ? '全部红色预警' : next === 'cn' ? '仅涉华红色预警' : '已关闭'));
    },

    /* ===== 多维筛选 ===== */
    _applyFilters(list) {
      var f = this._filters, me = this;
      var cut = f.timeRange === '24h' ? Date.now() - 24 * 3600e3 : f.timeRange === '48h' ? Date.now() - 48 * 3600e3 : 0;
      return list.filter(function (a) {
        if (f.country && (a.country || '') !== f.country) return false;
        if (f.corridor && me._aaCorridorNames(a).indexOf(f.corridor) < 0) return false;
        if (f.org && me._aaOrgNames(a).indexOf(f.org) < 0) return false;
        if (f.cnOnly && me._aaTier(a) > 1) return false;
        if (cut) {
          var t = 0;
          try { t = new Date(String(a.time || '').replace(' ', 'T')).getTime(); } catch (e) {}
          if (t && t < cut) return false;
        }
        return true;
      });
    },
    _renderFilterBar() {
      var me = this, f = this._filters;
      var pool = this._alerts.filter(function (a) { return !a.dismissed; }).concat(this._rawAlerts.filter(function (r) { return r.status === 'raw'; }));
      var cCount = {};
      pool.forEach(function (a) { var c = a.country || ''; if (c) cCount[c] = (cCount[c] || 0) + 1; });
      var countries = Object.keys(cCount).sort(function (x, y) { return cCount[y] - cCount[x]; }).slice(0, 30);
      var corridors = [], orgs = [];
      pool.forEach(function (a) { me._aaCorridorNames(a).forEach(function (c) { if (corridors.indexOf(c) < 0) corridors.push(c); }); me._aaOrgNames(a).forEach(function (o) { if (orgs.indexOf(o) < 0) orgs.push(o); }); });
      var presets = {};
      try { presets = JSON.parse(localStorage.getItem('orps_aa_fpresets') || '{}'); } catch (e) {}
      var html = '<div class="aa-glow-card" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 10px;margin-bottom:10px">';
      html += '<span style="font-size:11px;font-weight:800;color:var(--cyan)">🎚 筛选</span>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'country\',this.value)"><option value="">全部国别</option>' + countries.map(function (c) { return '<option' + (f.country === c ? ' selected' : '') + '>' + c + '(' + cCount[c] + ')</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'corridor\',this.value)"><option value="">全部走廊</option>' + corridors.map(function (c) { return '<option' + (f.corridor === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'org\',this.value)"><option value="">全部组织</option>' + orgs.map(function (o) { return '<option' + (f.org === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="AUTOALERT.setFilter(\'timeRange\',this.value)">' + [['24h', '近24小时'], ['48h', '近48小时'], ['all', '全部时段']].map(function (t) { return '<option value="' + t[0] + '"' + (f.timeRange === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>';
      html += '<span class="aa-filter-chip' + (f.cnOnly ? ' on' : '') + '" onclick="AUTOALERT.setFilter(\'cnOnly\',' + (!f.cnOnly) + ')">🇨🇳涉华</span>';
      var hasF = f.country || f.corridor || f.org || f.cnOnly || f.timeRange !== '24h';
      if (hasF) html += '<span class="aa-filter-chip" style="color:var(--orange)" onclick="AUTOALERT.resetFilters()">✕ 清除</span>';
      html += '<span style="margin-left:auto;display:flex;gap:5px;align-items:center">';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" onchange="if(this.value)AUTOALERT.applyFilterPreset(this.value)"><option value="">📌 预设…</option>' + Object.keys(presets).map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select>';
      html += '<span class="aa-filter-chip" onclick="AUTOALERT.saveFilterPreset()">💾 存预设</span>';
      html += '</span></div>';
      return html;
    },
    saveFilterPreset() {
      var name = prompt('预设名称：');
      if (!name) return;
      var presets = {};
      try { presets = JSON.parse(localStorage.getItem('orps_aa_fpresets') || '{}'); } catch (e) {}
      presets[name] = JSON.parse(JSON.stringify(this._filters));
      localStorage.setItem('orps_aa_fpresets', JSON.stringify(presets));
      if (typeof showToast === 'function') showToast('筛选预设已保存：' + name);
      this.render();
    },
    applyFilterPreset(name) {
      try {
        var presets = JSON.parse(localStorage.getItem('orps_aa_fpresets') || '{}');
        if (presets[name]) { this._filters = presets[name]; this.render(); if (typeof showToast === 'function') showToast('已应用预设：' + name); }
      } catch (e) {}
    },

    /* ===== ① 指挥带 ===== */
    _renderCommandBand(st) {
      var lastRunStr = this._lastRun ? this._lastRun.toLocaleString('zh-CN', { hour12: false }) : '—';
      var wfN = Object.keys(this._workflows).length;
      var nm = this._settings.notifyMode || 'all';
      var html = '<div class="aa-glow-card" style="padding:10px 14px;margin-bottom:10px;border-color:rgba(0,212,255,.35)">';
      html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:24px" class="' + (this._engineOn ? 'aa-red-pulse' : '') + '">' + (this._engineOn ? '🟢' : '⚪') + '</span>';
      html += '<div><div style="font-size:14px;font-weight:800;color:' + (this._engineOn ? 'var(--green)' : 'var(--text3)') + '">' + (this._engineOn ? '无人值守中' : '引擎已暂停') + '</div>';
      html += '<div style="font-size:9px;color:var(--text3)">下次扫描 <span id="aa-countdown" style="font-family:monospace;color:var(--cyan)">--:--</span> · 上次 ' + lastRunStr + '</div></div>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;background:rgba(0,0,0,.25);border-radius:8px">';
      html += '<button class="btn sm" style="font-size:10px" onclick="AUTOALERT.toggleEngine()">' + (this._engineOn ? '⏸ 暂停' : '▶ 启动') + '</button>';
      html += '<button class="btn sm primary" style="font-size:10px" onclick="AUTOALERT.run()">🔍 立即扫描</button>';
      html += '<select class="select" style="font-size:10px;padding:2px 6px" title="扫描周期" onchange="AUTOALERT.setScanInterval(this.value)">' + [60, 120, 300, 600, 1800].map(function (n) { return '<option value="' + n + '"' + ((AUTOALERT._settings.scanInterval || 300) === n ? ' selected' : '') + '>' + (n < 60 ? n + 's' : n / 60 + 'min') + '</option>'; }).join('') + '</select>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" title="SOAR自动编排" onclick="AUTOALERT.toggleAutoSoar()">SOAR ' + (this._settings.autoSoar ? '✅' : '⏸️') + '</button>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px" title="高置信自动晋升" onclick="AUTOALERT.toggleAutoPromote()">晋升 ' + (this._settings.autoPromote ? '✅' : '⏸️') + '</button>';
      html += '<button class="btn sm" style="font-size:9px;padding:2px 8px;' + (nm !== 'off' ? 'border-color:var(--red);color:var(--red)' : '') + '" title="红警声音+弹窗提醒（点击切换：全部→仅涉华→关闭）" onclick="AUTOALERT.cycleNotify()">🔔' + (nm === 'all' ? '全部' : nm === 'cn' ? '涉华' : '关') + '</button>';
      html += '</div>';
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
      return '<div style="text-align:center;min-width:70px;padding:6px 10px;background:rgba(0,0,0,.25);border-radius:8px;border:1px solid rgba(255,255,255,.05)">' +
        '<div style="font-size:12px">' + icon + ' <span style="font-size:9px;color:var(--text3)">' + label + '</span></div>' +
        '<div class="aa-kpi-num" style="color:' + color + '">' + val + '</div></div>';
    },

    /* ===== ② 实时预警地图（Leaflet + 本地矢量底图 + 走廊线 + 点击过滤） ===== */
    _renderWarMap() {
      var html = '<div class="aa-map-wrap" style="margin-bottom:10px">';
      html += '<div id="aa-warmap" style="height:350px;background:#070b14"></div>';
      html += '<div style="position:absolute;top:8px;left:8px;z-index:500;padding:4px 10px;background:rgba(7,11,20,.85);border:1px solid rgba(0,212,255,.3);border-radius:6px;font-size:10px;color:var(--cyan);font-weight:700;pointer-events:none">🗺 实时预警地图 <span style="color:var(--text3);font-weight:400">· 点国家落点可过滤</span></div>';
      html += '<div style="position:absolute;bottom:8px;right:8px;z-index:500;padding:3px 8px;background:rgba(7,11,20,.85);border-radius:6px;font-size:9px;color:var(--text3);pointer-events:none">🔴红 🟠橙 🟡黄 · <span style="color:#ffaa00">--- 走廊</span></div>';
      html += '</div>';
      return html;
    },
    _initWarMap() {
      var el = document.getElementById('aa-warmap');
      if (!el || typeof L === 'undefined') return;
      if (this._map) { try { this._map.remove(); } catch (e) {} this._map = null; }
      var map;
      try {
        map = L.map(el, { zoomControl: true, attributionControl: false, worldCopyJump: true, minZoom: 2 }).setView([26, 40], 2);
      } catch (e) { return; }
      this._map = map;
      if (window.LOCAL_BASEMAP && LOCAL_BASEMAP.addTo) { try { LOCAL_BASEMAP.addTo(map); } catch (e) {} }
      /* 走廊线 */
      try {
        if (window.WORLDMAP && WORLDMAP.corridors) {
          WORLDMAP.corridors.forEach(function (co) {
            var pts = (co.points || []).map(function (p) { return [p[0], p[1]]; });
            if (pts.length > 1) L.polyline(pts, { color: '#ffaa00', weight: 1.5, opacity: 0.45, dashArray: '6,6' }).addTo(map);
          });
        }
      } catch (e) {}
      /* 预警落点（按国聚合，等级取最高） */
      var me = this;
      var pool = this._alerts.filter(function (a) { return !a.dismissed; }).concat(this._rawAlerts.filter(function (r) { return r.status === 'raw'; }));
      pool = this._applyFilters(pool);
      var byC = {};
      pool.forEach(function (a) { var c = a.country || ''; if (!c) return; (byC[c] = byC[c] || []).push(a); });
      var lvW = { red: 3, orange: 2, yellow: 1, blue: 0 };
      Object.keys(byC).forEach(function (c) {
        var cd = (typeof COUNTRIES !== 'undefined') ? COUNTRIES.find(function (x) { return x.name === c; }) : null;
        if (!cd || typeof cd.lat !== 'number') return;
        var list = byC[c];
        list.sort(function (a, b) { return (lvW[b.level] || 0) - (lvW[a.level] || 0); });
        var topLv = list[0].level || 'yellow';
        var clr = topLv === 'red' ? '#ff3355' : topLv === 'orange' ? '#ffaa00' : topLv === 'yellow' ? '#ffe600' : '#00d4ff';
        var radius = Math.min(7 + list.length * 1.5, 20);
        var m = L.circleMarker([cd.lat, cd.lon], { radius: radius, color: clr, weight: 2, fillColor: clr, fillOpacity: 0.35 });
        m.bindTooltip((cd.flag || '') + ' ' + c + ' · ' + list.length + ' 条预警', { direction: 'top' });
        m.on('click', function () { me.setFilter('country', c); });
        m.addTo(map);
      });
      setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 300);
    },

    /* ===== ②.5 实时情报流滚动条 ===== */
    _renderLiveTicker() {
      if (typeof ALERTS === 'undefined' || !ALERTS.length) return '';
      var items = ALERTS.slice(0, 14);
      function ago(t) {
        try {
          var diff = Date.now() - new Date(String(t || '').replace(' ', 'T')).getTime();
          var m = Math.floor(diff / 60000), h = Math.floor(m / 60);
          return m < 1 ? '刚刚' : h < 1 ? m + '分钟前' : h < 24 ? h + '小时前' : Math.floor(h / 24) + '天前';
        } catch (e) { return ''; }
      }
      var html = '<div class="aa-glow-card" style="display:flex;align-items:center;gap:8px;padding:7px 12px;overflow:hidden">';
      html += '<span style="flex-shrink:0;font-size:10px;font-weight:800;color:var(--red);white-space:nowrap"><span style="display:inline-block;width:7px;height:7px;background:var(--red);border-radius:50%;margin-right:5px" class="aa-red-pulse"></span>实时情报流</span>';
      html += '<div style="display:flex;gap:14px;overflow-x:auto;white-space:nowrap;flex:1;scrollbar-width:none">';
      items.forEach(function (a) {
        var lvC = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
        var id = String(a.id || '').replace(/'/g, "\\'");
        html += '<span style="font-size:10px;color:var(--text2);cursor:pointer;flex-shrink:0" onclick="showAlertDetail(\'' + id + '\')">' +
          '<b style="color:' + lvC + '">●</b> ' + String(a.title_zh || a.title || '').slice(0, 30) +
          ' <span style="color:var(--text3);font-size:9px">' + (a.country || '') + ' · ' + ago(a.time) + '</span></span>';
      });
      html += '</div></div>';
      return html;
    },

    /* ===== ③ 右侧作战队列（Tab：侦测/预警/处置/闭环 + 一键操作） ===== */
    _renderQueuePanel() {
      var me = this;
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var laneAlert = active.filter(function (a) { return !me._workflows[a.id]; });
      var laneSoar = active.filter(function (a) { return !!me._workflows[a.id]; });
      var laneDone = this._resolved.slice(0, 50);
      var lvW = { red: 3000, orange: 2000, yellow: 1000, blue: 500 };
      var sorter = function (a, b) {
        if (me._cnFirst) { var ta = me._aaTier(a), tb = me._aaTier(b); if (ta !== tb) return ta - tb; }
        var sa = (lvW[a.level] || 0) + Math.round((a.confidence || 0) * 100);
        var sb = (lvW[b.level] || 0) + Math.round((b.confidence || 0) * 100);
        return sb - sa;
      };
      var lanes = { raw: this._applyFilters(raw).sort(sorter), alert: this._applyFilters(laneAlert).sort(sorter), soar: this._applyFilters(laneSoar).sort(sorter), done: laneDone };
      var tabs = [
        { k: 'raw', n: '📡侦测', c: 'var(--orange)', n2: raw.length },
        { k: 'alert', n: '🧠预警', c: 'var(--cyan)', n2: laneAlert.length },
        { k: 'soar', n: '🚀处置', c: '#a06bff', n2: laneSoar.length },
        { k: 'done', n: '✅闭环', c: 'var(--green)', n2: laneDone.length }
      ];
      var html = '<div class="aa-glow-card" style="padding:8px">';
      html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:8px;flex-wrap:wrap">';
      tabs.forEach(function (t) {
        var on = me._queueTab === t.k;
        html += '<span class="aa-filter-chip' + (on ? ' on' : '') + '" style="' + (on ? 'border-color:' + t.c + ';color:' + t.c : '') + '" onclick="AUTOALERT.setQueueTab(\'' + t.k + '\')">' + t.n + ' <b>' + t.n2 + '</b></span>';
      });
      html += '<span class="aa-filter-chip" style="margin-left:auto;' + (this._cnFirst ? 'border-color:var(--cyan);color:var(--cyan)' : '') + '" title="涉华优先排序" onclick="AUTOALERT.toggleCnFirst()">🇨🇳</span>';
      html += '</div>';
      var laneMap = { raw: 1, alert: 2, soar: 3, done: 4 };
      var list = lanes[this._queueTab] || [];
      if (!list.length) {
        html += '<div style="text-align:center;padding:30px 8px;color:var(--text3);font-size:10px;opacity:.7">' + (this._queueTab === 'raw' ? '实时数据到达后自动生成候选' : this._queueTab === 'done' ? '暂无闭环记录' : '当前筛选条件下暂无数据') + '</div>';
      } else {
        html += '<div style="display:grid;gap:6px;max-height:640px;overflow-y:auto">';
        list.slice(0, 60).forEach(function (a) { html += me._renderKanbanCard(a, laneMap[me._queueTab]); });
        if (list.length > 60) html += '<div style="text-align:center;font-size:9px;color:var(--text3);padding:4px">… 共 ' + list.length + ' 条，显示前 60</div>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    _renderKanbanCard(a, lane) {
      var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
      var lvDot = a.level === 'red' ? '🔴' : a.level === 'orange' ? '🟠' : a.level === 'yellow' ? '🟡' : '🔵';
      var id = String(a.id || '').replace(/'/g, "\\'");
      var clickFn = lane === 4 ? "AUTOALERT._showResolvedDetail('" + id + "')" : "AUTOALERT._showDetail('" + id + "')";
      var tags = lane === 4 ? [] : this._aaTags(a).slice(0, 3);
      var html = '<div style="padding:8px;background:rgba(0,0,0,.28);border-radius:6px;border-left:3px solid ' + lvClr + ';cursor:pointer;transition:.15s" onclick="' + clickFn + '">';
      html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;flex-wrap:wrap">';
      html += '<span style="font-size:9px" class="' + (a.level === 'red' ? 'aa-red-pulse' : '') + '">' + lvDot + '</span>';
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
      if (lane === 1) {
        html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm primary" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.promoteRaw(\'' + id + '\')">⬆️ 晋升</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px" onclick="AUTOALERT.rejectRaw(\'' + id + '\')">✕ 驳回</button>';
        html += '</div>';
      } else if (lane === 2 || lane === 3) {
        html += '<div style="display:flex;gap:4px;margin-top:6px" onclick="event.stopPropagation()">';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--green)" title="确认" onclick="AUTOALERT.confirmAlert(\'' + id + '\')">✅</button>';
        html += '<button class="btn sm danger" style="flex:1;font-size:9px;padding:2px 4px" title="消除" onclick="AUTOALERT.dismissAlert(\'' + id + '\')">✕</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--cyan)" title="重新编排" onclick="AUTOALERT.runManualWorkflow(\'' + id + '\')">🚀</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px;color:var(--yellow)" title="生成简报" onclick="AUTOALERT.quickBrief(\'' + id + '\')">📄</button>';
        html += '<button class="btn sm" style="flex:1;font-size:9px;padding:2px 4px" title="导出JSON" onclick="AUTOALERT.exportAlert(\'' + id + '\')">⬇</button>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    },
    quickBrief(id) {
      var a = this._alerts.find(function (x) { return String(x.id) === String(id); }) || this._rawAlerts.find(function (x) { return String(x.id) === String(id); });
      if (!a) return;
      try { a.brief = this._generateBrief(a); this._save(); } catch (e) {}
      this._showDetail(id);
    },
    exportAlert(id) {
      var a = this._alerts.find(function (x) { return String(x.id) === String(id); }) || this._rawAlerts.find(function (x) { return String(x.id) === String(id); });
      if (!a) return;
      try {
        var blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'alert_' + String(a.id || 'export').replace(/[^\w-]/g, '_') + '.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('预警已导出');
      } catch (e) {}
    },

    /* ===== ④ 红警声音 + 弹窗提醒 ===== */
    _notifyNewRed() {
      var mode = this._settings.notifyMode || 'all';
      if (!this._seenRedIds) { /* 首次仅记录，不对存量红警轰炸 */
        var s0 = {};
        this._alerts.forEach(function (a) { if (a.level === 'red' && !a.dismissed) s0[a.id] = 1; });
        this._seenRedIds = s0;
        return;
      }
      if (mode === 'off') return;
      var me = this, fresh = [];
      this._alerts.forEach(function (a) {
        if (a.dismissed || a.level !== 'red' || me._seenRedIds[a.id]) return;
        me._seenRedIds[a.id] = 1;
        fresh.push(a);
      });
      if (mode === 'cn') fresh = fresh.filter(function (a) { return me._aaTier(a) <= 1; });
      if (!fresh.length) return;
      this._beep();
      this._showRedToast(fresh[0], fresh.length);
    },
    _beep() {
      try {
        var ctx = this._actx || (this._actx = new (window.AudioContext || window.webkitAudioContext)());
        if (ctx.state === 'suspended') ctx.resume();
        [0, 350].forEach(function (delay) {
          setTimeout(function () {
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 880;
            o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.12, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            o.start(); o.stop(ctx.currentTime + 0.5);
          }, delay);
        });
      } catch (e) {}
    },
    _showRedToast(a, n) {
      try {
        var old = document.getElementById('aa-red-toast');
        if (old) old.remove();
        var id = String(a.id || '').replace(/'/g, "\\'");
        var div = document.createElement('div');
        div.id = 'aa-red-toast';
        div.className = 'aa-toast';
        div.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="font-size:16px" class="aa-red-pulse">🔴</span><b style="color:var(--red);font-size:12px">紧急红色预警' + (n > 1 ? ' +' + (n - 1) : '') + '</b><span style="margin-left:auto;cursor:pointer;color:var(--text3);font-size:14px" onclick="document.getElementById(\'aa-red-toast\').remove()">✕</span></div>' +
          '<div style="font-size:11px;font-weight:600;line-height:1.4;margin-bottom:6px">' + String(a.title_zh || a.title || '').replace(/</g, '&lt;') + '</div>' +
          '<div style="font-size:9px;color:var(--text3);margin-bottom:8px">🌍 ' + (a.country || '—') + ' · ⏱ ' + String(a.time || '').slice(5, 16) + '</div>' +
          '<div style="display:flex;gap:6px"><button class="btn sm primary" style="flex:1;font-size:10px" onclick="document.getElementById(\'aa-red-toast\').remove();AUTOALERT._showDetail(\'' + id + '\')">立即研判</button><button class="btn sm" style="font-size:10px" onclick="document.getElementById(\'aa-red-toast\').remove()">知道了</button></div>';
        document.body.appendChild(div);
        setTimeout(function () { var d = document.getElementById('aa-red-toast'); if (d) d.remove(); }, 20000);
      } catch (e) {}
    },

    /* ===== 左栏：境外态势 ===== */
    _renderSidebar() {
      var me = this;
      var active = this._alerts.filter(function (a) { return !a.dismissed; });
      var raw = this._rawAlerts.filter(function (r) { return r.status === 'raw'; });
      var all = active.concat(raw);
      var html = '';
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
      html += '<div class="aa-glow-card" style="padding:10px;margin-bottom:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">🇨🇳 涉我海外利益</div>';
      dimRows.forEach(function (r) {
        var w = Math.round(r.c / dimMax * 100);
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:10px">';
        html += '<span style="width:60px;color:var(--text2)">' + r.n + '</span>';
        html += '<div style="flex:1;height:8px;background:rgba(0,0,0,.3);border-radius:4px;overflow:hidden"><div style="width:' + w + '%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--red));border-radius:4px;box-shadow:0 0 6px rgba(0,212,255,.5)"></div></div>';
        html += '<b style="color:var(--cyan);min-width:18px;text-align:right">' + r.c + '</b></div>';
      });
      html += '</div>';
      var corrCount = {};
      all.forEach(function (a) { me._aaCorridorNames(a).forEach(function (c) { corrCount[c] = (corrCount[c] || 0) + 1; }); });
      var corrList = Object.keys(corrCount).sort(function (x, y) { return corrCount[y] - corrCount[x]; }).slice(0, 6);
      html += '<div class="aa-glow-card" style="padding:10px;margin-bottom:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">🛰️ 高危走廊</div>';
      if (!corrList.length) html += '<div style="font-size:10px;color:var(--text3);padding:8px 0">当前无走廊命中</div>';
      corrList.forEach(function (c) {
        var hot = corrCount[c] >= 5;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;margin-bottom:4px;background:rgba(0,0,0,.28);border-radius:6px;border-left:2px solid ' + (hot ? 'var(--red)' : 'var(--orange)') + ';font-size:10px;cursor:pointer" onclick="AUTOALERT.setFilter(\'corridor\',\'' + c + '\')">';
        html += '<span style="font-weight:600">' + c + '</span><b style="color:' + (hot ? 'var(--red)' : 'var(--orange)') + '">' + corrCount[c] + '</b></div>';
      });
      html += '</div>';
      var orgCount = {};
      all.forEach(function (a) { me._aaOrgNames(a).forEach(function (o) { orgCount[o] = (orgCount[o] || 0) + 1; }); });
      var orgList = Object.keys(orgCount).sort(function (x, y) { return orgCount[y] - orgCount[x]; }).slice(0, 6);
      html += '<div class="aa-glow-card" style="padding:10px;margin-bottom:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">⚔️ 威胁组织活跃榜</div>';
      if (!orgList.length) html += '<div style="font-size:10px;color:var(--text3);padding:8px 0">当前无威胁组织命中</div>';
      orgList.forEach(function (o, i) {
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:10px;border-bottom:1px dashed var(--border);cursor:pointer" onclick="AUTOALERT.setFilter(\'org\',\'' + o + '\')">';
        html += '<span style="color:var(--orange);font-weight:800;width:14px">' + (i + 1) + '</span>';
        html += '<span style="flex:1">' + o + '</span><b style="color:var(--red)">' + orgCount[o] + '</b></div>';
      });
      html += '</div>';
      var needHuman = active.filter(function (a) { return !a.confirmed; }).concat(raw);
      needHuman.sort(function (a, b) { return (b.severityScore || 0) - (a.severityScore || 0); });
      needHuman = needHuman.slice(0, 3);
      html += '<div class="aa-glow-card" style="padding:10px">';
      html += '<div style="font-size:12px;font-weight:800;margin-bottom:8px">💡 需人工介入</div>';
      if (!needHuman.length) {
        html += '<div style="font-size:10px;color:var(--green);padding:8px 0">✅ 当前无需人工介入</div>';
      } else {
        needHuman.forEach(function (a) {
          var lvClr = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : 'var(--yellow)';
          var id = String(a.id || '').replace(/'/g, "\\'");
          html += '<div style="padding:6px 8px;margin-bottom:5px;background:rgba(0,0,0,.28);border-radius:6px;border-left:2px solid ' + lvClr + ';cursor:pointer" onclick="AUTOALERT._showDetail(\'' + id + '\')">';
          html += '<div style="font-size:10px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (a.title_zh || a.title || '') + '</div>';
          html += '<div style="font-size:8px;color:var(--text3);margin-top:2px">' + (a.country || '') + ' · 优先级 ' + (a.severityScore || 0).toFixed(1) + '</div></div>';
        });
      }
      html += '</div>';
      return html;
    },

    /* ===== ⑤ 底部复合功能舱 ===== */
    _renderDeck() {
      var tabs = [
        { k: 'rules', icon: '🏭', n: '规则工厂' },
        { k: 'pipeline', icon: '🔄', n: '检测流水线' },
        { k: 'logs', icon: '📝', n: '机器人日志' },
        { k: 'review', icon: '📈', n: '复盘看板' }
      ];
      var html = '<div style="margin-top:10px">';
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

    /* ===== 维度工具 ===== */
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

    /* ===== 功能舱内容 ===== */
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
