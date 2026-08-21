/* GEOINT 实时卫星影像接入面板（前端）
 * 接入 Sentinel-2 / Maxar / Planet NICFI 真实数据源，将结果存入 INTELCENTER 地理空间情报图层。
 * 仅真实数据；失败时显示明确提示，绝不编造。 */
(function () {
  'use strict';

  var GEOINTLIVE = {
    _sources: [
      { id: 'sentinel2', name: 'Sentinel-2 / Copernicus', free: '全免费·无限制' },
      { id: 'maxar', name: 'Maxar Open Data', free: '免费·CC BY-NC·灾难' },
      { id: 'planet', name: 'Planet NICFI', free: '免费·需密钥·热带' }
    ],
    _presets: [
      { name: '瓜达尔港', lat: 25.11, lon: 62.35, country: '巴基斯坦' },
      { name: '中巴经济走廊', lat: 30.0, lon: 67.0, country: '巴基斯坦' },
      { name: '吉布提保障基地', lat: 11.6, lon: 43.1, country: '吉布提' },
      { name: '比雷埃夫斯港', lat: 37.94, lon: 23.64, country: '希腊' },
      { name: '汉班托塔港', lat: 6.12, lon: 81.12, country: '斯里兰卡' },
      { name: '皎漂港', lat: 19.43, lon: 93.55, country: '缅甸' },
      { name: '科卢韦齐(刚果金)', lat: -10.71, lon: 25.48, country: '刚果(金)' }
    ],
    _last: null, _lastLat: 0, _lastLon: 0, _lastRegion: '', _lastChange: null, _diff: null,

    panelHtml: function () {
      var srcOpts = this._sources.map(function (s) {
        return '<option value="' + s.id + '">' + s.name + ' · ' + s.free + '</option>';
      }).join('');
      var presets = this._presets.map(function (p) {
        return '<span class="chip" style="cursor:pointer;font-size:10px;padding:3px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;margin:2px" onclick="GEOINTLIVE.fillPreset(' + p.lat + ',' + p.lon + ',\'' + p.name + '\')">' + p.name + '</span>';
      }).join(' ');
      return '<div class="card" style="border:1px solid rgba(0,212,255,0.25)">' +
        '<div class="card-tt"><span class="ic">🛰️</span>实时卫星影像接入 <span style="font-size:10px;color:var(--text3);font-weight:400">— Sentinel-2 / Maxar / Planet NICFI 真实数据源（全免费）</span></div>' +
        '<div id="gl-map" style="height:300px;border-radius:8px;margin-bottom:10px;background:#0b1524;border:1px solid rgba(0,212,255,0.2)"></div>' +
        '<div style="font-size:10px;color:var(--text3);margin-bottom:6px">🗺️ 点击地图定位（卫星底图 + Sentinel-2 叠加），或直接输入经纬度</div>' +
        '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px">' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">数据源</label><select class="select" id="gl-source" style="font-size:12px;width:100%">' + srcOpts + '</select></div>' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">纬度 Lat</label><input class="input" id="gl-lat" placeholder="如 25.11" style="font-size:12px;width:100%"></div>' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">经度 Lon</label><input class="input" id="gl-lon" placeholder="如 62.35" style="font-size:12px;width:100%"></div>' +
        '<button class="btn primary sm" onclick="GEOINTLIVE.fetchIngest()" style="white-space:nowrap">⚡ 拉取实时影像</button>' +
        '</div>' +
        '<div style="margin-bottom:6px"><span class="text-xs text-muted">快速定位：</span> ' + presets + '</div>' +
        '<div id="gl-results"></div>' +
        '</div>' +
        this._changeCardHtml();
    },

    _changeCardHtml: function () {
      var selOpts = this._presets.map(function (p, i) {
        return '<option value="' + i + '">' + p.name + '（' + (p.country || '') + '）</option>';
      }).join('');
      return '<div class="card" style="border:1px solid rgba(179,102,255,0.25);margin-top:12px">' +
        '<div class="card-tt"><span class="ic">🔁</span>变化检测 · 重点区域监测 <span style="font-size:10px;color:var(--text3);font-weight:400">— Sentinel-2 历史影像前后对比（真实像素比对）</span></div>' +
        '<div style="display:grid;grid-template-columns:1.2fr 1fr auto auto;gap:8px;align-items:end;margin-bottom:8px">' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">监测区域</label><select class="select" id="gl-cd-region" style="font-size:12px;width:100%">' + selOpts + '</select></div>' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">时相窗口</label><select class="select" id="gl-cd-range" style="font-size:12px;width:100%"><option value="7|30">近7天 vs 前30天</option><option value="30|30" selected>近30天 vs 前30天</option><option value="30|90">近30天 vs 前90天</option></select></div>' +
        '<button class="btn primary sm" onclick="GEOINTLIVE.changeDetect()" style="white-space:nowrap">🔍 对比时相</button>' +
        '<button class="btn sm" style="white-space:nowrap;border-color:var(--orange);color:var(--orange)" onclick="GEOINTLIVE.checkChange()">⚠️ 检查变化→预警</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">' +
        '<button class="btn sm" onclick="GEOINTLIVE.saveBaseline()">💾 存为基线</button>' +
        '<button class="btn sm" onclick="GEOINTLIVE.monitorAll()">⚡ 监测全部重点区域</button>' +
        '<span style="font-size:10px;color:var(--text3)">基线存本地；触发变化将写入数据中心待审核（人工审核后进预警中心）</span>' +
        '</div>' +
        '<div id="gl-change"></div>' +
        '</div>';
    },

    fillPreset: function (lat, lon, name) {
      var le = document.getElementById('gl-lat'); var lo = document.getElementById('gl-lon');
      if (le) le.value = lat; if (lo) lo.value = lon;
      this._lastRegion = name || '';
      this._showMonitoringPointDetail(lat, lon, name);
    },

    /* 显示监测点详情面板（交互式） */
    _showMonitoringPointDetail: function(lat, lon, name) {
      var self = this;
      var country = '';
      var preset = this._presets.find(function(p){ return p.name === name; });
      if (preset) country = preset.country || '';

      /* 查找该区域相关的情报数据 */
      var relatedIntel = [];
      var relatedAlerts = [];
      try {
        var stores = ['terror_events','security_events','military_conflicts','political_events','geopolitical_intel','osint_intel'];
        stores.forEach(function(s){
          (DBCenter.getAll(s)||[]).forEach(function(it){
            if (!it) return;
            var text = (it.title||'') + ' ' + (it.content||'') + ' ' + (it.country||'') + ' ' + (it.location||'');
            if (text.indexOf(name) >= 0 || (country && text.indexOf(country) >= 0)) {
              relatedIntel.push(it);
            }
          });
        });
        /* 从预警中心查找相关预警 */
        if (typeof ALERTS !== 'undefined') {
          ALERTS.forEach(function(a){
            if (!a) return;
            var text = (a.title||'') + ' ' + (a.desc||'') + ' ' + (a.country||'');
            if (text.indexOf(name) >= 0 || (country && text.indexOf(country) >= 0)) {
              relatedAlerts.push(a);
            }
          });
        }
      } catch(e) {}

      /* 去重 */
      var seen = {};
      relatedIntel = relatedIntel.filter(function(it){
        var k = (it.title||'') + '|' + (it.source||'');
        if (seen[k]) return false;
        seen[k] = 1;
        return true;
      }).slice(0, 5);

      /* 构建详情面板 */
      var html = '<div style="padding:16px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
      html += '<div style="font-size:16px;font-weight:700;color:var(--cyan)">📍 ' + name + '</div>';
      html += '<button class="btn sm" onclick="GEOINTLIVE._closeMonitoringDetail()" style="font-size:10px">✕ 关闭</button>';
      html += '</div>';

      /* 基本信息卡片 */
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
      html += '<div style="background:var(--bg2);padding:10px;border-radius:8px;border-left:3px solid var(--cyan)"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">所属国家</div><div style="font-size:13px;font-weight:600;color:var(--text1)">' + (country || '未知') + '</div></div>';
      html += '<div style="background:var(--bg2);padding:10px;border-radius:8px;border-left:3px solid var(--blue)"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">地理坐标</div><div style="font-size:12px;font-weight:600;color:var(--text1);font-family:monospace">' + lat.toFixed(4) + ', ' + lon.toFixed(4) + '</div></div>';
      html += '</div>';

      /* 相关情报统计 */
      html += '<div style="display:flex;gap:8px;margin-bottom:12px">';
      html += '<div style="flex:1;background:rgba(0,212,255,0.08);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--cyan)">' + relatedIntel.length + '</div><div style="font-size:10px;color:var(--text3)">相关情报</div></div>';
      html += '<div style="flex:1;background:rgba(255,136,0,0.08);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--orange)">' + relatedAlerts.length + '</div><div style="font-size:10px;color:var(--text3)">相关预警</div></div>';
      html += '</div>';

      /* 快捷操作 */
      html += '<div style="display:flex;gap:8px;margin-bottom:12px">';
      html += '<button class="btn primary sm" style="flex:1" onclick="GEOINTLIVE._viewOnMap(' + lat + ',' + lon + ',\'' + name + '\')">🗺️ 地图定位</button>';
      html += '<button class="btn sm" style="flex:1" onclick="GEOINTLIVE._fetchSatelliteImagery(' + lat + ',' + lon + ',\'' + name + '\')">🛰️ 拉取卫星影像</button>';
      html += '</div>';

      /* 相关情报列表 */
      if (relatedIntel.length > 0) {
        html += '<div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:6px">📋 相关情报</div>';
        html += '<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">';
        relatedIntel.forEach(function(it){
          var ts = it.publishedAt || it.pubDate || it.collect_time || '';
          if (ts) ts = String(ts).substring(0, 10);
          html += '<div style="background:var(--bg2);padding:8px;border-radius:6px;border-left:2px solid var(--cyan)">';
          html += '<div style="font-size:11px;font-weight:600;color:var(--text1);margin-bottom:2px">' + (it.title_zh || it.title || '无标题') + '</div>';
          html += '<div style="font-size:9px;color:var(--text3)">' + (it.country || '') + (it.source ? ' · ' + it.source : '') + (ts ? ' · ' + ts : '') + '</div>';
          html += '</div>';
        });
        html += '</div>';
      } else {
        html += '<div style="padding:12px;text-align:center;color:var(--text3);font-size:11px;background:var(--bg2);border-radius:6px">暂无相关情报数据</div>';
      }

      /* 相关预警列表 */
      if (relatedAlerts.length > 0) {
        html += '<div style="font-size:12px;font-weight:700;color:var(--orange);margin:12px 0 6px">⚠️ 相关预警</div>';
        html += '<div style="display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto">';
        relatedAlerts.slice(0, 3).forEach(function(a){
          var lvColor = a.level === 'red' ? 'var(--red)' : a.level === 'orange' ? 'var(--orange)' : a.level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
          html += '<div style="background:var(--bg2);padding:8px;border-radius:6px;border-left:3px solid ' + lvColor + '">';
          html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px"><span class="badge" style="font-size:8px;padding:1px 4px;background:' + lvColor + '22;color:' + lvColor + '">' + a.level + '</span><span style="font-size:10px;color:var(--text3)">' + (a.country || '') + '</span></div>';
          html += '<div style="font-size:11px;font-weight:600;color:var(--text1)">' + (a.title || '无标题') + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div>';

      /* 显示模态框 */
      var modal = document.getElementById('monitoring-point-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'monitoring-point-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px)';
        document.body.appendChild(modal);
      }
      modal.innerHTML = '<div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.5)">' + html + '</div>';
      modal.style.display = 'flex';
    },

    _closeMonitoringDetail: function() {
      var modal = document.getElementById('monitoring-point-modal');
      if (modal) modal.style.display = 'none';
    },

    _viewOnMap: function(lat, lon, name) {
      this._closeMonitoringDetail();
      showToast('🗺️ 已定位到：' + name);
      /* 触发地图定位 */
      if (typeof INTELCENTER !== 'undefined' && INTELCENTER._geointMap) {
        INTELCENTER._geointMap.setView([lat, lon], 10);
      }
    },

    _fetchSatelliteImagery: function(lat, lon, name) {
      this._closeMonitoringDetail();
      /* 检查输入框是否存在，不存在则直接调用fetchIngest */
      var le = document.getElementById('gl-lat');
      var lo = document.getElementById('gl-lon');
      if (le && lo) {
        le.value = lat;
        lo.value = lon;
      }
      this._lastRegion = name || '';
      /* 如果输入框不存在（不在GEOINT面板），直接显示提示 */
      if (!le || !lo) {
        showToast('🛰️ 请前往情报影像中心拉取卫星影像');
        return;
      }
      this.fetchIngest();
    },

    fetchIngest: function () {
      var srcEl = document.getElementById('gl-source');
      var latEl = document.getElementById('gl-lat');
      var lonEl = document.getElementById('gl-lon');
      var box = document.getElementById('gl-results');
      if (!srcEl || !latEl || !lonEl) {
        showToast('⚠️ 请前往情报影像中心面板操作');
        return;
      }
      var src = srcEl.value;
      var lat = parseFloat(latEl.value);
      var lon = parseFloat(lonEl.value);
      if (isNaN(lat) || isNaN(lon)) { showToast('⚠️ 请输入有效经纬度'); return; }
      if (this._map) { this._map.setView([lat, lon], Math.max(this._map.getZoom(), 10)); }
      this._placeMarker({ lat: lat, lng: lon });
      if (box) box.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:12px">⏳ 正在从 ' + src + ' 拉取真实卫星影像…</div>';
      var self = this;
      fetch('/api/geoint/search?source=' + encodeURIComponent(src) + '&lat=' + lat + '&lon=' + lon)
        .then(function (r) { return r.json(); })
        .then(function (d) { self.renderResults(d, lat, lon); })
        .catch(function (e) {
          box.innerHTML = '<div style="padding:14px;color:var(--red);font-size:12px">⚠️ 无法连接卫星数据源（' + (e.message || e) + '）。请确认服务器可访问外网。</div>';
        });
    },

    renderResults: function (d, lat, lon) {
      var box = document.getElementById('gl-results');
      this._last = d; this._lastLat = lat; this._lastLon = lon;
      if (d.needKey) {
        box.innerHTML = '<div style="padding:12px;background:rgba(255,204,0,0.06);border:1px solid rgba(255,204,0,0.2);border-radius:8px;font-size:11px;color:var(--yellow);line-height:1.6">🔑 ' + d.message + '</div>';
        return;
      }
      if (d.empty) {
        box.innerHTML = '<div style="padding:12px;background:var(--bg2);border-radius:8px;font-size:11px;color:var(--text2);line-height:1.6">🛰️ ' + d.message + '</div>';
        return;
      }
      if (!d.ok) {
        box.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">⚠️ ' + (d.error || d.message || '获取失败') + '</div>';
        return;
      }
      // 收集影像
      var imgs = [];
      if (d.previews) d.previews.forEach(function (p) { imgs.push({ url: p.url, label: 'Zoom ' + p.zoom, attr: d.attribution || '' }); });
      if (d.scenes) d.scenes.forEach(function (s) { imgs.push({ url: s.previewUrl, label: s.date + (s.cloud ? (' · 云量' + s.cloud) : ''), attr: s.attribution || '' }); });
      if (d.events) d.events.forEach(function (e) { imgs.push({ url: e.thumbnail, label: e.title + (e.datetime ? (' · ' + e.datetime) : ''), attr: e.attribution || '' }); });
      if (!imgs.length) {
        box.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px">未返回影像数据。</div>';
        return;
      }
      var gal = imgs.map(function (im) {
        return '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#000">' +
          '<img src="' + im.url + '" style="width:100%;height:160px;object-fit:cover;display:block" onerror="this.style.opacity=0.25;this.alt=\'影像加载失败\'">' +
          '<div style="padding:6px;font-size:10px;color:var(--text3);line-height:1.4">' + (im.label || '') + '</div></div>';
      }).join('');
      var html = '<div style="padding:12px;background:var(--bg2);border-radius:8px">' +
        '<div style="font-size:12px;color:var(--cyan);font-weight:700;margin-bottom:8px">✅ ' + d.source + ' · 真实卫星影像</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px">' + gal + '</div>' +
        '<div style="font-size:10px;color:var(--text3);margin-top:8px">' + (d.attribution || '') + (d.license ? (' · 许可：' + d.license) : '') + '</div>' +
        '<div style="margin-top:10px"><button class="btn primary sm" onclick="GEOINTLIVE.ingestLayer()">💾 存入地理空间情报图层</button></div>' +
        '</div>';
      box.innerHTML = html;
    },

    initMap: function () {
      var el = document.getElementById('gl-map');
      if (!el) return;
      if (typeof L === 'undefined') {
        el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text3)">🗺️ 地图库加载失败（Leaflet CDN 不可达），请使用上方坐标输入。</div>';
        return;
      }
      // 保存视图位置，避免 render 后重置
      if (this._map) {
        try { this._center = this._map.getCenter(); this._zoom = this._map.getZoom(); this._map.remove(); } catch (e) {}
        this._map = null; this._marker = null; this._circle = null;
      }
      var map = L.map(el, { zoomControl: true, attributionControl: true }).setView([25.11, 62.35], 6);
      this._map = map;
      /* 天地图卫星影像底图（2026-08-14 用户密钥，合规白名单内）；失败自动回退本地矢量底图 */
      el.style.background = '#070d18';
      if (typeof TDT_BASEMAP !== 'undefined') { TDT_BASEMAP.addTo(map, 'sat'); }
      else if (typeof LOCAL_BASEMAP !== 'undefined') { LOCAL_BASEMAP.addTo(map); }
      var self = this;
      map.on('click', function (e) {
        var le = document.getElementById('gl-lat'), lo = document.getElementById('gl-lon');
        if (le) le.value = e.latlng.lat.toFixed(5);
        if (lo) lo.value = e.latlng.lng.toFixed(5);
        self._lastRegion = '';
        self.fetchIngest();
      });
      if (this._center) { map.setView(this._center, this._zoom); }
      var lat = parseFloat((document.getElementById('gl-lat') || {}).value);
      var lon = parseFloat((document.getElementById('gl-lon') || {}).value);
      if (!isNaN(lat) && !isNaN(lon)) { map.setView([lat, lon], 10); this._placeMarker({ lat: lat, lng: lon }); }
      if(this._glSizeTimer){clearTimeout(this._glSizeTimer);this._glSizeTimer=null;}
      this._glSizeTimer=setTimeout(function () {
        self._glSizeTimer=null;
        if(self._map && el && el.parentNode){ try{ self._map.invalidateSize(); }catch(e){} }
      }, 120);
    },
    _placeMarker: function (p) {
      if (!this._map || !p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng)) return;
      if (this._marker) { this._marker.setLatLng(p); }
      else { this._marker = L.marker(p).addTo(this._map); }
      if (this._circle) { this._circle.setLatLng(p); }
      else { this._circle = L.circle(p, { radius: 5000, color: '#00d4ff', fillColor: '#00d4ff', fillOpacity: 0.07, weight: 1 }).addTo(this._map); }
    },
    _cdRegion: function () {
      var sel = document.getElementById('gl-cd-region');
      var i = sel ? parseInt(sel.value, 10) : 0;
      return this._presets[i] || this._presets[0];
    },

    changeDetect: function () {
      var p = this._cdRegion();
      var range = ((document.getElementById('gl-cd-range') || {}).value) || '30|30';
      var parts = range.split('|');
      var box = document.getElementById('gl-change');
      if (!box) return;
      box.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px">⏳ 检索 ' + p.name + ' 近' + parts[0] + '天 vs 前' + parts[1] + '天 Sentinel-2 历史影像…</div>';
      var self = this;
      fetch('/api/geoint/change?lat=' + p.lat + '&lon=' + p.lon + '&recentDays=' + parts[0] + '&baselineDays=' + parts[1])
        .then(function (r) { return r.json(); })
        .then(function (d) { self._lastChange = d; self._renderChange(d, p); })
        .catch(function (e) { box.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">⚠️ 变化检测失败：' + (e.message || e) + '</div>'; });
    },

    _renderChange: function (d, p) {
      var box = document.getElementById('gl-change');
      if (!box) return;
      if (d.empty || !d.after) {
        box.innerHTML = '<div style="padding:12px;background:var(--bg2);border-radius:8px;font-size:11px;color:var(--text2);line-height:1.6">🔭 ' + (d.message || '未检索到对比影像') + '</div>';
        return;
      }
      var a = d.after, b = d.before;
      box.innerHTML =
        '<div style="padding:12px;background:var(--bg2);border-radius:8px">' +
        '<div style="font-size:12px;color:var(--purple);font-weight:700;margin-bottom:8px">🛰️ ' + p.name + ' · 前后时相对比（真实影像）</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">' +
        '<div><div style="font-size:10px;color:var(--text3);margin-bottom:4px">基线时相（' + (b ? b.date : '无') + (b && b.cloud != null ? ' · 云量' + b.cloud + '%' : '') + '）</div><img src="' + (b ? b.preview : '') + '" style="width:100%;height:170px;object-fit:cover;border-radius:6px;background:#000" onerror="this.style.opacity=0.25"></div>' +
        '<div><div style="font-size:10px;color:var(--text3);margin-bottom:4px">近期时相（' + a.date + (a.cloud != null ? ' · 云量' + a.cloud + '%' : '') + '）</div><img src="' + a.preview + '" style="width:100%;height:170px;object-fit:cover;border-radius:6px;background:#000" onerror="this.style.opacity=0.25"></div>' +
        '</div>' +
        '<div id="gl-diff" style="font-size:11px;color:var(--text2)">计算像素差异指数…</div>' +
        '<div style="font-size:9px;color:var(--text3);margin-top:4px">' + (d.attribution || '') + '</div>' +
        '</div>';
      var self = this;
      this._computeDiff(b, a).then(function (diff) {
        self._diff = diff;
        var el = document.getElementById('gl-diff');
        if (!el) return;
        if (diff == null) el.innerHTML = '像素差异指数：跨域受限无法自动计算，请人工判读两时相影像';
        else el.innerHTML = '像素差异指数：<b style="color:' + (diff >= 8 ? 'var(--red)' : diff >= 3 ? 'var(--yellow)' : 'var(--green)') + '">' + diff.toFixed(1) + '%</b>（真实像素比对，同区域两时相）';
      });
    },

    _loadImg: function (url) {
      return new Promise(function (res, rej) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { res(im); };
        im.onerror = function () { rej(new Error('img load fail')); };
        im.src = url;
      });
    },

    _imgDiff: function (im1, im2, cb) {
      try {
        var w = 64, h = 64;
        var c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
        c1.width = c2.width = w; c1.height = c2.height = h;
        var x1 = c1.getContext('2d'); x1.drawImage(im1, 0, 0, w, h);
        var x2 = c2.getContext('2d'); x2.drawImage(im2, 0, 0, w, h);
        var d1 = x1.getImageData(0, 0, w, h).data;
        var d2 = x2.getImageData(0, 0, w, h).data;
        var tot = 0, n = d1.length;
        for (var i = 0; i < n; i += 4) {
          tot += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]);
        }
        cb(Math.round((tot / (n / 4) / (3 * 255)) * 1000) / 10);
      } catch (e) { cb(null); }
    },

    _computeDiff: function (b, a) {
      var self = this;
      if (!b || !b.preview || !a || !a.preview) return Promise.resolve(null);
      return Promise.all([this._loadImg(b.preview), this._loadImg(a.preview)])
        .then(function (ims) { return new Promise(function (res) { self._imgDiff(ims[0], ims[1], function (d) { res(d); }); }); })
        .catch(function () { return null; });
    },

    saveBaseline: function () {
      var p = this._cdRegion();
      if (!this._lastChange || !this._lastChange.after) { showToast('⚠️ 请先执行「🔍 对比时相」获取近期影像'); return; }
      var base = { name: p.name, lat: p.lat, lon: p.lon, date: this._lastChange.after.date, preview: this._lastChange.after.preview, savedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') };
      localStorage.setItem('gl_baseline_' + p.name, JSON.stringify(base));
      showToast('💾 已保存基线：' + p.name + ' @ ' + base.date);
    },

    _daysBetween: function (d1, d2) { return Math.round((new Date(d2) - new Date(d1)) / 86400000); },

    checkChange: function () {
      var p = this._cdRegion();
      var self = this;
      fetch('/api/geoint/change?lat=' + p.lat + '&lon=' + p.lon + '&recentDays=30&baselineDays=30')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.empty || !d.after) { showToast('🔭 ' + (d.message || '未检索到影像')); return; }
          self._lastChange = d;
          self._renderChange(d, p);
          return self._computeDiff(d.before, d.after).then(function (diff) {
            self._diff = diff;
            var key = 'gl_baseline_' + p.name;
            var raw = localStorage.getItem(key);
            if (!raw) { showToast('ℹ️ ' + p.name + ' 尚未保存基线，请先「💾 存为基线」'); return; }
            var base = JSON.parse(raw);
            if (base.date >= d.after.date) { showToast('✅ ' + p.name + '：无新时相（基线 ' + base.date + '，最新 ' + d.after.date + '），不触发预警'); return; }
            var triggered = (diff != null && diff >= 3) || (diff == null && self._daysBetween(base.date, d.after.date) >= 7);
            if (!triggered) { showToast('ℹ️ ' + p.name + '：影像更新但差异' + (diff != null ? diff + '%' : '未知') + '，未达预警阈值'); return; }
            self._pushChangeAlert(p, base, d, diff);
          });
        })
        .catch(function (e) { showToast('⚠️ 检查变化失败：' + (e.message || e)); });
    },

    _pushChangeAlert: function (p, base, d, diff) {
      var now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      var a = d.after || {};
      var level = (diff != null && diff >= 8) ? 'orange' : 'yellow';
      var title = '【GEOINT】' + p.name + ' 卫星影像变化：' + base.date + ' → ' + (a.date || '最新');
      var desc = 'Sentinel-2 前后时相对比：基线 ' + base.date + '，最新 ' + (a.date || '') + (diff != null ? '，像素差异指数 ' + diff + '%' : '，像素差异跨域受限需人工判读') + '。坐标 (' + p.lat + ', ' + p.lon + ')';
      try {
        DBCenter.add('geopolitical_intel', {
          _intelId: 'geoint_' + p.name + '_' + now.replace(/[^0-9]/g, ''),
          _geoint: true,
          date: now, country: p.country || '未知', intel_type: 'GEOINT卫星影像变化',
          title: title, risk_level: level, desc: desc,
          source: 'Sentinel-2 / Copernicus (GEOINT 自动监测)', verified: false
        });
        DBCenter.addLog('🛰️ GEOINT 变化监测触发：' + p.name + '（' + base.date + '→' + (a.date || '') + '），已入数据中心待审核');
        showToast('🛰️ 已写入数据中心待审核：' + p.name + ' 影像变化');
      } catch (e) { showToast('⚠️ 写入数据中心失败：' + (e.message || e)); }
    },

    monitorAll: function () {
      var self = this;
      var idx = 0, triggers = 0;
      function next() {
        if (idx >= self._presets.length) {
          showToast('⚡ 监测完成：' + self._presets.length + ' 个区域，触发 ' + triggers + ' 个变化预警（均已入数据中心待审核）');
          return;
        }
        var p = self._presets[idx++];
        fetch('/api/geoint/change?lat=' + p.lat + '&lon=' + p.lon + '&recentDays=30&baselineDays=30')
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.empty || !d.after) { next(); return; }
            self._lastChange = d;
            return self._computeDiff(d.before, d.after).then(function (diff) {
              var key = 'gl_baseline_' + p.name;
              var raw = localStorage.getItem(key);
              if (!raw) { next(); return; }
              var base = JSON.parse(raw);
              if (base.date >= d.after.date) { next(); return; }
              var trig = (diff != null && diff >= 3) || (diff == null && self._daysBetween(base.date, d.after.date) >= 7);
              if (trig) { triggers++; self._pushChangeAlert(p, base, d, diff); }
              next();
            });
          })
          .catch(function () { next(); });
      }
      next();
    },

    renderSitCard: function () {
      var el = document.getElementById('sit-geoint');
      if (!el) return;
      var layers = (typeof INTELCENTER !== 'undefined' && INTELCENTER._geointLayers) ? INTELCENTER._geointLayers : [];
      var active = layers.filter(function (l) { return l.status === 'active'; });
      var records = 0;
      layers.forEach(function (l) { records += (l.records || []).length; });
      var last = layers.slice().sort(function (a, b) { return (b.updated || '').localeCompare(a.updated || ''); })[0];

      // 从数据中心提取 GEOINT 变化检测事件（近30天）
      var geointEvents = [];
      try {
        if (typeof DBCenter !== 'undefined') {
          DBCenter.getAll('geopolitical_intel').forEach(function (r) {
            if (r.intel_type === 'GEOINT卫星影像变化' || r._geoint) {
              geointEvents.push(r);
            }
          });
        }
      } catch (e) { }
      geointEvents.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var recentEvents = geointEvents.slice(0, 5);

      var html = '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:6px;margin-bottom:8px">' +
        '<div style="padding:8px;background:var(--bg2);border-radius:8px;cursor:pointer" onclick="INTELCENTER.switch(\'geoint\')" title="查看全部图层"><div class="text-xs text-muted">图层总数</div><div style="font-size:15px;font-weight:800;color:var(--purple)">' + layers.length + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:8px;cursor:pointer" onclick="INTELCENTER.switch(\'geoint\')" title="查看启用图层"><div class="text-xs text-muted">已启用</div><div style="font-size:15px;font-weight:800;color:var(--cyan)">' + active.length + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:8px;cursor:pointer" onclick="INTELCENTER.switch(\'geoint\')" title="查看影像记录"><div class="text-xs text-muted">卫星影像记录</div><div style="font-size:15px;font-weight:800;color:var(--green)">' + records + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:8px;cursor:pointer" onclick="INTELCENTER.switch(\'geoint\')" title="查看变化事件"><div class="text-xs text-muted">变化事件</div><div style="font-size:15px;font-weight:800;color:var(--orange)">' + geointEvents.length + '</div></div>' +
        '</div>';

      // 最新影像缩略图（带详情入口）
      var withPrev = layers.filter(function (l) { return l.previews && l.previews.length; }).slice(0, 3);
      if (withPrev.length) {
        html += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px">🛰️ 最新卫星影像</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px">';
        withPrev.forEach(function (l, i) {
          html += '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#000;cursor:pointer" onclick="GEOINTLIVE.showLayerDetail(' + i + ')" title="点击查看详情：' + (l.name || '') + '">' +
            '<img src="' + l.previews[0] + '" style="width:100%;height:80px;object-fit:cover;display:block" onerror="this.style.opacity=0.25">' +
            '<div style="padding:4px 6px;font-size:9px;color:var(--text3);background:var(--bg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (l.name || '') + '</div></div>';
        });
        html += '</div>';
      }

      // 重点监测区域快速入口
      html += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px">📍 重点监测区域</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">';
      this._presets.slice(0, 6).forEach(function (p, i) {
        html += '<span class="chip" style="cursor:pointer;font-size:10px;padding:3px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;color:var(--text2)" onclick="GEOINTLIVE.fillPreset(' + p.lat + ',' + p.lon + ',\'' + p.name + '\')">' + p.name + '</span>';
      });
      html += '<span class="chip" style="cursor:pointer;font-size:10px;padding:3px 8px;background:rgba(0,212,255,0.08);border:1px solid var(--cyan);border-radius:12px;color:var(--cyan)" onclick="INTELCENTER.switch(\'geoint\')">⚡ 进入 GEOINT 中心 →</span>';
      html += '</div>';

      // 最新变化检测事件
      if (recentEvents.length) {
        html += '<div style="font-size:11px;font-weight:700;color:var(--orange);margin-bottom:6px">🔔 最新变化事件</div>';
        html += '<div style="display:flex;flex-direction:column;gap:5px">';
        recentEvents.forEach(function (r) {
          var level = (r.risk_level || '').toLowerCase();
          var color = level === 'red' ? 'var(--red)' : level === 'orange' ? 'var(--orange)' : level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
          html += '<div style="padding:6px 8px;background:var(--bg2);border-radius:6px;border-left:3px solid ' + color + ';cursor:pointer;font-size:10px" onclick="GEOINTLIVE.showGeointEventDetail(\'' + String(r._intelId || r.id || '').replace(/'/g, "\\'") + '\')" onmouseover="this.style.background=\'rgba(0,212,255,0.06)\'" onmouseout="this.style.background=\'var(--bg2)\'">' +
            '<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:var(--text1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">' + (r.title || 'GEOINT 变化事件') + '</span><span style="color:var(--text3);font-size:9px;margin-left:6px">' + (r.date ? r.date.slice(5, 16) : '') + '</span></div>' +
            '<div style="color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (r.country || '') + (r.desc ? ' · ' + r.desc.slice(0, 40) + (r.desc.length > 40 ? '…' : '') : '') + '</div>' +
            '</div>';
        });
        html += '</div>';
      } else if (!withPrev.length) {
        html += '<div style="padding:8px;font-size:10px;color:var(--text3);background:var(--bg2);border-radius:6px">暂无实时影像图层。点击上方「⚡ 进入 GEOINT 中心」拉取 Sentinel-2 / Maxar 真实卫星影像。</div>';
      }

      if (last && last.updated) html += '<div style="font-size:9px;color:var(--text3);margin-top:8px">最近更新：' + last.updated + ' · ' + (last.source || '') + '</div>';
      el.innerHTML = html;
    },

    showLayerDetail: function (idx) {
      var layers = (typeof INTELCENTER !== 'undefined' && INTELCENTER._geointLayers) ? INTELCENTER._geointLayers : [];
      var withPrev = layers.filter(function (l) { return l.previews && l.previews.length; });
      var l = withPrev[idx]; if (!l) return;
      var html = '<div style="margin-bottom:10px"><span class="badge b-purple">GEOINT 图层</span> <span style="font-size:12px;color:var(--text2)">' + (l.name || '') + '</span></div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">状态</div><div style="color:' + (l.status === 'active' ? 'var(--green)' : 'var(--text3)') + '">' + (l.status || '—') + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">记录数</div><div>' + (l.records || []).length + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">覆盖区域</div><div>' + (l.coverage || '—') + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">更新时间</div><div>' + (l.updated || '—') + '</div></div>' +
        '</div>';
      if (l.previews && l.previews.length) {
        html += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px">影像预览</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">';
        l.previews.forEach(function (url) {
          html += '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#000"><img src="' + url + '" style="width:100%;height:130px;object-fit:cover;display:block" onerror="this.style.opacity=0.25"></div>';
        });
        html += '</div>';
      }
      if (l.records && l.records.length) {
        html += '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-top:10px;margin-bottom:6px">元数据记录</div>';
        html += '<div style="max-height:200px;overflow-y:auto;display:grid;gap:4px">';
        l.records.slice(0, 10).forEach(function (r) {
          html += '<div style="padding:6px;background:var(--bg2);border-radius:4px;font-size:10px;color:var(--text2)">' + JSON.stringify(r).slice(0, 160) + '</div>';
        });
        html += '</div>';
      }
      html += '<div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
        '<button class="btn primary sm" onclick="document.getElementById(\'modal\').classList.remove(\'show\');INTELCENTER.switch(\'geoint\')">进入 GEOINT 中心</button>' +
        '<button class="btn sm" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">关闭</button>' +
        '</div>';
      document.getElementById('modal-tt').textContent = '🛰️ ' + (l.name || 'GEOINT 图层');
      document.getElementById('modal-bd').innerHTML = html;
      document.getElementById('modal').classList.add('show');
    },

    showGeointEventDetail: function (id) {
      var r = null;
      try {
        if (typeof DBCenter !== 'undefined') {
          r = DBCenter.getAll('geopolitical_intel').find(function (x) { return String(x._intelId || x.id) === String(id); });
        }
      } catch (e) { }
      if (!r) { showToast('未找到该 GEOINT 事件'); return; }
      var level = (r.risk_level || '').toLowerCase();
      var color = level === 'red' ? 'var(--red)' : level === 'orange' ? 'var(--orange)' : level === 'yellow' ? 'var(--yellow)' : 'var(--cyan)';
      var html = '<div style="margin-bottom:10px"><span class="badge" style="background:' + color + ';color:#000">' + (r.risk_level || '提示') + '</span> <span style="font-size:12px;color:var(--text2)">' + (r.country || '') + '</span></div>';
      html += '<div style="padding:12px;background:var(--bg2);border-radius:8px;margin-bottom:10px;font-size:12px;line-height:1.7">' +
        '<div style="font-weight:700;color:var(--text1);margin-bottom:6px">' + (r.title || 'GEOINT 变化事件') + '</div>' +
        '<div style="color:var(--text3)">' + (r.desc || '') + '</div>' +
        '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">情报类型</div><div>' + (r.intel_type || '—') + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">来源</div><div>' + (r.source || '—') + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">时间</div><div>' + (r.date || '—') + '</div></div>' +
        '<div style="padding:8px;background:var(--bg2);border-radius:6px;font-size:11px"><div class="text-xs text-muted">国家</div><div>' + (r.country || '—') + '</div></div>' +
        '</div>';
      html += '<div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
        '<button class="btn primary sm" onclick="document.getElementById(\'modal\').classList.remove(\'show\');navigateTo(\'datacenter\')">进入数据中心</button>' +
        '<button class="btn sm" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">关闭</button>' +
        '</div>';
      document.getElementById('modal-tt').textContent = '🔔 GEOINT 变化事件';
      document.getElementById('modal-bd').innerHTML = html;
      document.getElementById('modal').classList.add('show');
    },

    ingestLayer: function () {
      var d = this._last; if (!d) return;
      var lat = this._lastLat, lon = this._lastLon;
      var records = []; var previews = [];
      if (d.scenes) d.scenes.forEach(function (s) {
        records.push({ date: s.date, cloud: s.cloud || '-', product: s.product || '-', bbox: s.bbox ? ('[' + s.bbox.join(',') + ']') : '-', attribution: s.attribution || '-' });
        if (s.previewUrl) previews.push(s.previewUrl);
      });
      if (d.events) d.events.forEach(function (e) {
        records.push({ event: e.title, datetime: e.datetime || '-', bbox: e.bbox ? ('[' + e.bbox.join(',') + ']') : '-', cog: (e.cog || '-'), license: e.license || '-' });
        if (e.thumbnail) previews.push(e.thumbnail);
      });
      if (d.previews) d.previews.forEach(function (p) { previews.push(p.url); });
      var region = this._lastRegion || (lat.toFixed(2) + ',' + lon.toFixed(2));
      var layerName = (d.source || 'GEOINT').split(' ')[0] + ' · ' + region;
      var existing = INTELCENTER._geointLayers.find(function (x) { return x.name === layerName; });
      var meta = (d.attribution || '') + (d.license ? (' | ' + d.license) : '');
      if (existing) {
        existing.records = (existing.records || []).concat(records);
        existing.previews = (existing.previews || []).concat(previews);
        existing.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
        existing.status = 'active';
        existing.source = d.source;
        existing.meta = meta;
      } else {
        INTELCENTER._geointLayers.push({
          name: layerName, ic: '🛰️', desc: '实时卫星影像 · ' + (d.source || '') + ' @ ' + region,
          status: 'active', color: 'var(--purple)', count: String(records.length),
          data: '真实卫星影像接入', source: d.source, coverage: region + ' 周边',
          meta: meta, analysis: '', updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
          records: records, previews: previews
        });
      }
      INTELCENTER._saveGeoint();
      showToast('✅ 已存入地理空间情报图层：' + layerName);
      INTELCENTER.render();
    }
  };

  if (typeof window !== 'undefined') window.GEOINTLIVE = GEOINTLIVE;
  if (typeof module !== 'undefined' && module.exports) module.exports = GEOINTLIVE;
})();
