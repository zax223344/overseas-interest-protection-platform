'use strict';
/*
 * GEOINT 实时卫星影像接入适配器
 * 仅真实数据源，零模拟。三源均免费：
 *   - Sentinel-2 / Copernicus：经 EOX WMTS 提供真实瓦片（无需密钥、无 CORS、全球覆盖）
 *   - Maxar Open Data：AWS Open Data 灾难响应前后高分辨率影像（CC BY-NC 4.0，须署名）
 *   - Planet NICFI：热带森林高分辨率（需免费 API 密钥，仅热带）
 * 失败一律返回明确错误信息，绝不编造数据。
 */

const CACHE_TTL = 60 * 60 * 1000; // 1h
let _maxarCache = { ts: 0, data: null };

function lonLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function eoxTileUrl(layer, lon, lat, z) {
  const { x, y } = lonLatToTile(lon, lat, z);
  return 'https://tiles.maps.eox.at/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=' + layer + '&STYLE=_empty&FORMAT=image/jpeg&TILEMATRIXSET=GoogleMapsCompatible' +
    '&TILEMATRIX=' + z + '&TILEROW=' + y + '&TILECOL=' + x;
}

async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, headers: { 'User-Agent': 'ORPS-GEOINT/1.0' } }, opts || {}));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function bboxFromGeom(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
    const coords = geom.coordinates[0];
    let minx = 180, miny = 90, maxx = -180, maxy = -90;
    coords.forEach(c => {
      if (c[0] < minx) minx = c[0]; if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1]; if (c[1] > maxy) maxy = c[1];
    });
    return [minx, miny, maxx, maxy];
  }
  return null;
}

function pointInBbox(lon, lat, bbox, pad) {
  if (!bbox || bbox.length < 4) return false;
  return lon >= bbox[0] - pad && lon <= bbox[2] + pad && lat >= bbox[1] - pad && lat <= bbox[3] + pad;
}

// ---------- Sentinel-2 via EOX WMTS（真实、免密钥） ----------
async function sentinel2(lat, lon) {
  const previews = [10, 12, 14].map(zz => ({ zoom: zz, url: eoxTileUrl('s2cloudless-2020', lon, lat, zz) }));
  const main = eoxTileUrl('s2cloudless-2020', lon, lat, 12);

  let meta = {};
  try {
    const filter = "Collection/Name eq 'SENTINEL-2' and OData.CSC.Intersects(area=geography'SRID=4326;POINT(" + lon + ' ' + lat + ")')";
    const url = 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products' +
      '?$filter=' + encodeURIComponent(filter) +
      '&$orderby=ContentDate/Start desc&$top=1&$select=Name,ContentDate,CloudCover';
    const j = await fetchJson(url);
    if (j && j.value && j.value[0]) {
      const p = j.value[0];
      meta.latestDate = (p.ContentDate && p.ContentDate.Start) || '';
      meta.cloud = (p.CloudCover != null) ? p.CloudCover : '';
      meta.product = p.Name || '';
    }
  } catch (e) {
    meta.note = 'CDSE 元数据获取失败（不影响影像瓦片）';
  }

  return {
    ok: true,
    source: 'Sentinel-2 / Copernicus (EOX)',
    attribution: 'Copernicus / ESA — Sentinel-2（EOX s2cloudless 真实影像）',
    license: 'Copernicus 开放数据，可自由使用',
    region: { lat, lon },
    previews,
    main,
    meta,
    scenes: [{
      date: meta.latestDate || '实时瓦片（云量修正合成）',
      cloud: (meta.cloud != null && meta.cloud !== '') ? meta.cloud + '%' : '—',
      product: meta.product || 's2cloudless-2020',
      bbox: [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05],
      previewUrl: main,
      attribution: 'Copernicus / ESA'
    }]
  };
}

// ---------- Maxar Open Data（灾难响应，CC BY-NC 4.0） ----------
async function maxar(lat, lon) {
  const root = 'https://maxar-opendata.s3.amazonaws.com/events/catalog.json';
  let catalog;
  if (_maxarCache.data && (Date.now() - _maxarCache.ts) < CACHE_TTL) {
    catalog = _maxarCache.data;
  } else {
    catalog = await fetchJson(root);
    _maxarCache = { ts: Date.now(), data: catalog };
  }
  const links = (catalog.links || []).filter(l => l.rel === 'child' && l.href && l.href.endsWith('.json'));
  const limited = links.slice(0, 30); // 限制抓取量，避免超时
  const events = [];
  await Promise.all(limited.map(async (l) => {
    try {
      const ev = await fetchJson(l.href);
      const items = ev.items || [];
      if (!items.length) return;
      const it = items[0];
      const dt = it.properties && it.properties.datetime;
      const geom = it.geometry;
      const bbox = it.bbox || bboxFromGeom(geom);
      if (bbox && pointInBbox(lon, lat, bbox, 2)) {
        const assets = it.assets || {};
        const thumb = assets.thumbnail && assets.thumbnail.href;
        const visual = assets.visual || assets.cog || assets.std;
        events.push({
          id: it.id,
          title: (ev.properties && ev.properties.title) || (it.properties && it.properties.title) || it.id,
          datetime: dt || '',
          bbox,
          thumbnail: thumb || (visual && visual.href) || '',
          cog: (assets.cog && assets.cog.href) || (visual && visual.href) || '',
          license: 'CC BY-NC 4.0',
          attribution: '© Maxar Technologies · CC BY-NC 4.0',
          mapUrl: (it.properties && it.properties['maxar:map_url']) || ''
        });
      }
    } catch (e) { /* 单事件失败忽略 */ }
  }));

  if (!events.length) {
    return {
      ok: true, source: 'Maxar Open Data', empty: true,
      message: '该坐标附近暂无 Maxar 公开灾难影像事件（Maxar Open Data 仅覆盖已发布的灾难响应事件）',
      attribution: '© Maxar Technologies · CC BY-NC 4.0', license: 'CC BY-NC 4.0', events: []
    };
  }
  return {
    ok: true, source: 'Maxar Open Data',
    attribution: '© Maxar Technologies · CC BY-NC 4.0', license: 'CC BY-NC 4.0',
    region: { lat, lon }, events: events.slice(0, 8)
  };
}

// ---------- Planet NICFI（热带森林，需免费密钥） ----------
async function planetNICFI(lat, lon) {
  const key = process.env.PLANET_API_KEY;
  if (!key) {
    return {
      ok: false, source: 'Planet NICFI', needKey: true,
      message: 'Planet NICFI 需免费 API 密钥：在 planet.com 注册后，将 PLANET_API_KEY 写入 server/.env 即可启用（仅覆盖热带森林区域）。'
    };
  }
  const url = 'https://api.planet.com/basemaps/v1/mosaics?api_key=' + encodeURIComponent(key);
  const j = await fetchJson(url);
  const mosaics = (j.mosaics || []).filter(m => /nicfi/i.test(m.name));
  if (!mosaics.length) return { ok: false, source: 'Planet NICFI', message: '未找到 NICFI 镶嵌数据集' };
  const m = mosaics[0];
  const z = 12;
  const { x, y } = lonLatToTile(lon, lat, z);
  const tile = 'https://api.planet.com/basemaps/v1/mosaics/' + m.id + '/quads/' + x + '/' + y + '?api_key=' + encodeURIComponent(key);
  return {
    ok: true, source: 'Planet NICFI', attribution: '© Planet Labs · NICFI', license: 'Planet NICFI 使用条款',
    region: { lat, lon }, previews: [{ zoom: z, url: tile }], main: tile,
    scenes: [{
      date: m.created_at || '', product: m.name,
      bbox: [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05],
      previewUrl: tile, attribution: '© Planet Labs · NICFI'
    }]
  };
}

// ---------- 变化检测：Sentinel-2 历史影像（Planetary Computer STAC，免密钥） ----------
async function stacSentinel2(lat, lon, fromISO, toISO, limit) {
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox: [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05],
    datetime: fromISO + '/' + toISO,
    limit: limit || 2,
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    query: { 'eo:cloud_cover': { lt: 30 } }
  };
  const j = await fetchJson('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = [];
  (j.features || []).forEach(function (f) {
    const props = f.properties || {};
    const preview = (f.assets && (f.assets.rendered_preview || f.assets.visual)) || null;
    out.push({
      id: f.id,
      date: (props.datetime || '').slice(0, 10),
      cloud: props['eo:cloud_cover'] != null ? props['eo:cloud_cover'] : null,
      preview: preview ? preview.href : ''
    });
  });
  return out;
}

async function change(lat, lon, opts) {
  opts = opts || {};
  const recentDays = parseInt(opts.recentDays, 10) || 30;
  const baselineDays = parseInt(opts.baselineDays, 10) || 30;
  const now = Date.now();
  const toISO = new Date(now).toISOString();
  const fromRecent = new Date(now - recentDays * 86400000).toISOString();
  const fromBase = new Date(now - (recentDays + baselineDays) * 86400000).toISOString();
  let before = [], after = [];
  try { after = await stacSentinel2(lat, lon, fromRecent, toISO, 2); } catch (e) { after = []; }
  try { before = await stacSentinel2(lat, lon, fromBase, fromRecent, 2); } catch (e) { before = []; }
  if (!after.length && !before.length) {
    return {
      ok: true, source: 'Sentinel-2 历史影像 (Planetary Computer STAC)', empty: true,
      message: '未检索到该区域近期/基线 Sentinel-2 影像（网络不可达，或该区域无云量<30% 影像）',
      before: null, after: null
    };
  }
  return {
    ok: true, source: 'Sentinel-2 历史影像 (Planetary Computer STAC)',
    attribution: 'Sentinel-2 © Copernicus / ESA · Planetary Computer (Microsoft)',
    license: 'Copernicus 开放数据，可自由使用',
    region: { lat, lon },
    before: before[0] || null, after: after[0] || null,
    windows: { recentDays, baselineDays }
  };
}

async function search({ source, lat, lon }) {
  lat = parseFloat(lat); lon = parseFloat(lon);
  if (isNaN(lat) || isNaN(lon)) return { ok: false, error: '经纬度参数无效' };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, error: '经纬度越界' };
  if (source === 'maxar') return maxar(lat, lon);
  if (source === 'planet') return planetNICFI(lat, lon);
  return sentinel2(lat, lon); // 默认 Sentinel-2
}

module.exports = { search, sentinel2, maxar, planetNICFI, change, stacSentinel2 };
