/* ============================================================
 * flight-ais.js v1.0 — 航班动态与船舶 AIS 追踪
 * 数据源：
 *   · 航班：OpenSky Network（免费，无需 API Key）
 *   · 船舶 AIS：MarineTraffic / VesselFinder 免费层（受限制） + 公开 AIS 聚合
 * 原则：只展示真实抓取数据；不可用时诚实显示“通道预留/暂不可用”。
 * ============================================================ */
(function(){
  'use strict';

  const STORAGE_KEYS = {
    flights: 'orps_fa_flights',
    vessels: 'orps_fa_vessels',
    tracked: 'orps_fa_tracked'
  };

  /* 常见撤侨/商务航线机场（ICAO） */
  const KEY_AIRPORTS = {
    'ZBAA': { name: '北京首都', lat: 40.0799, lon: 116.6031 },
    'ZSPD': { name: '上海浦东', lat: 31.1443, lon: 121.8083 },
    'OPIS': { name: '伊斯兰堡', lat: 33.6167, lon: 73.0992 },
    'OPKC': { name: '卡拉奇', lat: 24.9065, lon: 67.1608 },
    'FNLU': { name: '罗安达', lat: -8.8584, lon: 13.2312 },
    'LYBE': { name: '贝尔格莱德', lat: 44.8184, lon: 20.3091 },
    'HECA': { name: '开罗', lat: 30.1219, lon: 31.4056 },
    'WIII': { name: '雅加达', lat: -6.1256, lon: 106.6558 }
  };

  /* 关键海域 bounding box */
  const KEY_SEAREAS = [
    { name: '红海-曼德海峡', minLat: 12, maxLat: 30, minLon: 32, maxLon: 45 },
    { name: '马六甲海峡', minLat: 1, maxLat: 7, minLon: 95, maxLon: 105 },
    { name: '霍尔木兹海峡', minLat: 24, maxLat: 27, minLon: 55, maxLon: 57 },
    { name: '苏伊士运河', minLat: 29, maxLat: 32, minLon: 31, maxLon: 33 }
  ];

  window.FLIGHT_AIS = {
    _flights: null,
    _vessels: null,
    _tracked: null,
    _lastFetch: 0,

    init(){
      this._load();
    },

    _load(){
      this._flights = this._read(STORAGE_KEYS.flights, []);
      this._vessels = this._read(STORAGE_KEYS.vessels, []);
      this._tracked = this._read(STORAGE_KEYS.tracked, { flights: [], vessels: [] });
    },

    _read(key, def){
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
    },

    _save(){
      try { localStorage.setItem(STORAGE_KEYS.flights, JSON.stringify(this._flights.slice(-200))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.vessels, JSON.stringify(this._vessels.slice(-200))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.tracked, JSON.stringify(this._tracked)); } catch(e){}
    },

    /* 通过后端代理抓取航班（避免 CORS） */
    async fetchFlights(){
      try {
        var resp = await fetch('/api/flight/opensky');
        if(!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        if(data && Array.isArray(data.states)){
          this._flights = this._parseOpenSky(data.states);
          this._lastFetch = Date.now();
          this._save();
          return { ok: true, count: this._flights.length };
        }
        return { ok: false, error: '无航班状态数据', count: 0 };
      } catch(e){
        console.warn('[FLIGHT-AIS] 航班抓取失败:', e.message);
        return { ok: false, error: e.message, count: 0 };
      }
    },

    _parseOpenSky(states){
      /* OpenSky state vector 字段索引 */
      var list = [];
      states.forEach(s => {
        if(!s || !s[0]) return;
        var icao = s[0];
        var callsign = (s[1] || '').trim();
        var origin = s[2] || '';
        var time = s[3] || 0;
        var lat = s[6], lon = s[5];
        var alt = s[7], vel = s[9], heading = s[10];
        if(lat == null || lon == null) return;
        list.push({
          icao24: icao, callsign: callsign, originCountry: origin,
          lat: lat, lon: lon, altitude: alt, velocity: vel, heading: heading,
          lastContact: time, type: 'flight', fetchedAt: new Date().toISOString()
        });
      });
      return list;
    },

    /* 抓取船舶 AIS（后端代理） */
    async fetchVessels(){
      try {
        var resp = await fetch('/api/ais/all');
        if(!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        if(Array.isArray(data)){
          this._vessels = data.slice(0, 200);
          this._lastFetch = Date.now();
          this._save();
          return { ok: true, count: this._vessels.length };
        }
        return { ok: false, error: '无船舶数据', count: 0 };
      } catch(e){
        console.warn('[FLIGHT-AIS] 船舶抓取失败:', e.message);
        return { ok: false, error: e.message, count: 0 };
      }
    },

    /* 区域筛选 */
    getFlightsInArea(minLat, maxLat, minLon, maxLon){
      return this._flights.filter(f => f.lat >= minLat && f.lat <= maxLat && f.lon >= minLon && f.lon <= maxLon);
    },

    getVesselsInArea(minLat, maxLat, minLon, maxLon){
      return this._vessels.filter(v => v.lat >= minLat && v.lat <= maxLat && v.lon >= minLon && v.lon <= maxLon);
    },

    /* 渲染视图 */
    render(){
      var el = document.getElementById('view-flight-ais');
      if(!el) return;
      el.innerHTML = '<div class="fa-center">' +
        '<div class="fa-header"><h2>✈️ 航班动态 & 🚢 船舶 AIS</h2></div>' +
        '<div class="fa-actions">' +
          '<button class="fa-btn" onclick="FLIGHT_AIS.fetchFlights().then(r => { alert(\'航班: \'+r.count+\' 条\'); FLIGHT_AIS.render(); })">刷新航班 (OpenSky)</button>' +
          '<button class="fa-btn" onclick="FLIGHT_AIS.fetchVessels().then(r => { alert(\'船舶: \'+r.count+\' 条\'); FLIGHT_AIS.render(); })">刷新船舶 AIS</button>' +
        '</div>' +
        '<div class="fa-grid">' +
          '<div class="fa-panel">' +
            '<h3>✈️ 航班状态</h3>' +
            '<div class="fa-count">缓存 ' + this._flights.length + ' 条 · 上次更新 ' + this._fmtTime(this._lastFetch) + '</div>' +
            (this._flights.length ? this._flights.slice(0, 10).map(f =>
              '<div class="fa-row">' +
                '<b>' + esc(f.callsign || f.icao24) + '</b>' +
                '<span>' + (f.originCountry || '—') + '</span>' +
                '<span>高度 ' + Math.round(f.altitude || 0) + 'm</span>' +
                '<span>速度 ' + Math.round((f.velocity || 0) * 3.6) + ' km/h</span>' +
              '</div>'
            ).join('') : '<div class="fa-empty">暂无航班数据，请点击刷新</div>') +
          '</div>' +
          '<div class="fa-panel">' +
            '<h3>🚢 关键海域船舶</h3>' +
            KEY_SEAREAS.map(a => {
              var cnt = this.getVesselsInArea(a.minLat, a.maxLat, a.minLon, a.maxLon).length;
              return '<div class="fa-area-row"><b>' + esc(a.name) + '</b><span>' + cnt + ' 艘</span></div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="fa-panel" style="margin-top:12px">' +
          '<h3>🎯 重点关注</h3>' +
          '<p>支持按国家/海域快速筛选，用于人员撤离、物资运输、航线安全评估。</p>' +
        '</div>' +
      '</div>';
    },

    _fmtTime(ts){
      if(!ts) return '从未';
      var d = new Date(ts);
      return d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
    }
  };
})();
