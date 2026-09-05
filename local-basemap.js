/* ===== 本地矢量底图（2026-08-14）=====
 * 免密钥、纯本地、离线可用的地图底图方案。
 * 用项目自带的 countries-110m.json（真实大陆轮廓）通过 Leaflet GeoJSON 渲染，
 * 替代不合规的 OSM/Esri 海外直连瓦片，也不需要天地图密钥。
 * 底图为统一深色陆块填充，无国名标注、无政治边界强调。 */
var LOCAL_BASEMAP = {
  _promise: null,
  /* 加载并缓存世界轮廓数据（TopoJSON → GeoJSON） */
  load: function () {
    if (!this._promise) {
      this._promise = fetch('countries-110m.json')
        .then(function (r) { return r.json(); })
        .then(function (world) { return topojson.feature(world, world.objects.countries); })
        .catch(function (e) { console.warn('[LOCAL_BASEMAP] 轮廓数据加载失败:', e); return null; });
    }
    return this._promise;
  },
  /* 把矢量底图加到 Leaflet 地图上。opts: {fill, fillOpacity, stroke} */
  addTo: function (map, opts) {
    opts = opts || {};
    return this.load().then(function (fc) {
      if (!fc || !map || !map._container || !document.contains(map._container)) return null;
      return L.geoJSON(fc, {
        style: {
          color: opts.stroke || '#1d3050',
          weight: 0.5,
          fillColor: opts.fill || '#142035',
          fillOpacity: opts.fillOpacity == null ? 0.9 : opts.fillOpacity
        },
        interactive: false /* 底图不拦截标记点击 */
      }).addTo(map);
    });
  }
};

/* ===== 天地图底图（2026-08-14，用户提供密钥，合规白名单内）=====
 * 卫星影像 img_w + 中文标注 cia_w；街道 vec_w + 标注 cva_w。
 * 所有 Leaflet 地图统一走 TDT_BASEMAP.addTo(map,'sat'|'street')。
 * 天地图瓦片加载失败时自动回退本地矢量底图，保证任何情况下地图不空白。 */
var TDT_BASEMAP = {
  _failed: false,
  /* 2026-08-14：瓦片走服务端中转 /api/tdt（浏览器经代理直连天地图会被 ORB 拦截成白图）。
   * 同源请求不受 ORB/CORS 影响；密钥只留在服务端，不下发。 */
  _layer: function (t) {
    return L.tileLayer('/api/tdt/' + t + '/{z}/{x}/{y}', {
      maxZoom: 18,
      attribution: '天地图'
    });
  },
  /* type: 'sat' 卫星影像+标注 | 'street' 街道矢量+标注 */
  addTo: function (map, type) {
    if (!map) return;
    if (this._failed) { LOCAL_BASEMAP.addTo(map); return; }
    var base = this._layer(type === 'street' ? 'vec_w' : 'img_w');
    var label = this._layer(type === 'street' ? 'cva_w' : 'cia_w');
    var self = this, errCount = 0, okCount = 0;
    /* 有一张瓦片成功就不再判失败（地图销毁时中止的请求会误触发 tileerror） */
    base.on('tileload', function () { okCount++; });
    base.on('tileerror', function () {
      if (okCount > 0) return; /* 已能加载，零星错误忽略 */
      if (!map._container || !document.contains(map._container)) return; /* 地图已销毁的中止请求 */
      errCount++;
      if (errCount >= 12 && !self._failed) {
        self._failed = true;
        try { map.removeLayer(base); map.removeLayer(label); } catch (e) {}
        LOCAL_BASEMAP.addTo(map);
        console.warn('[TDT] 天地图瓦片加载失败，已回退本地矢量底图');
      }
    });
    base.addTo(map);
    label.addTo(map);
  }
};
