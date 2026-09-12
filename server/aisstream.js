'use strict';
/* ============================================================
 * AISStream 全球船位常驻订阅 —— #775
 * 免费 Key（env: AISSTREAM_KEY），Node 22 全局 WebSocket。
 * 订阅 ORPS 关注的战略走廊，维护内存滚动船位表，供
 *   GET /api/ais/all     → 船位数组（前端 FLIGHT_AIS 消费）
 *   GET /api/ais/stats   → 通道状态
 * 坑位（实测）：
 *  1) Node undici 的 WebSocket 把 text 帧交给 onmessage 时可能是 Blob 而非 string
 *     → 必须 async 解码（见 _decode），否则 JSON.parse 静默失败、表现为"0 条"。
 *  2) AISStream 信封结构 = { MessageType, MetaData:{MMSI,ShipName,latitude,longitude,time_utc},
 *     Message:{ PositionReport:{...} | ShipStaticData:{...} } }
 *     位置在 MetaData，详载在 Message.<TypeName> 内层。
 *  3) 首个消息恒为 SubscriptionConfirmation，不是数据。
 * ============================================================ */

const KEY = process.env.AISSTREAM_KEY || '';
const WS_URL = 'wss://stream.aisstream.io/v0/stream';

/* 战略走廊（与 flight-ais.js 的口径一致，额外补南海/几内亚湾/巴拿马/地中海） */
const AREAS = [
  { name: '马六甲海峡', bbox: [[1, 95], [7, 105]] },
  { name: '南海', bbox: [[3, 105], [23, 122]] },
  { name: '红海-曼德海峡', bbox: [[11, 32], [30, 45]] },
  { name: '霍尔木兹海峡', bbox: [[23, 54], [28, 58]] },
  { name: '苏伊士运河', bbox: [[29, 31], [32, 34]] },
  { name: '波斯湾', bbox: [[24, 47], [30, 57]] },
  { name: '几内亚湾', bbox: [[-6, -6], [6, 10]] },
  { name: '直布罗陀', bbox: [[34, -8], [38, -4]] },
  { name: '地中海东部', bbox: [[30, 20], [39, 36]] },
  { name: '巴拿马运河', bbox: [[7, -83], [11, -77]] }
];

const TTL_MS = 45 * 60 * 1000;   /* 45 分钟无更新即淘汰 */
const MAX_VESSELS = 20000;       /* 内存上限保护 */

const pos = new Map();    /* mmsi -> {lat,lon,sog,cog,heading,nav,area,updated} */
const stat = new Map();   /* mmsi -> {name,imo,type,destination,callSign,updated} */

let ws = null;
let started = false;
let connected = false;
let reconnects = 0;
let msgCount = 0;
let posCount = 0;
let staticCount = 0;
let lastMsgAt = 0;
let lastErr = '';
let startedAt = 0;
let retryDelay = 3000;
let pruneTimer = null;

function _areaOf(lat, lon) {
  for (const a of AREAS) {
    const [[la1, lo1], [la2, lo2]] = a.bbox;
    if (lat >= la1 && lat <= la2 && lon >= lo1 && lon <= lo2) return a.name;
  }
  return '';
}

function _num(v) { const n = Number(v); return isFinite(n) ? n : null; }

async function _decode(ev) {
  const d = ev && ev.data;
  if (typeof d === 'string') return d;
  if (d && typeof d.text === 'function') { try { return await d.text(); } catch (e) {} }
  if (typeof ArrayBuffer !== 'undefined') {
    if (d instanceof ArrayBuffer) return Buffer.from(d).toString('utf8');
    if (ArrayBuffer.isView(d)) return Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString('utf8');
  }
  return null;
}

function _touchPos(mmsi, lat, lon, extra) {
  const k = String(mmsi);
  const cur = pos.get(k) || {};
  pos.set(k, Object.assign(cur, extra || {}, { lat: lat, lon: lon, area: _areaOf(lat, lon), updated: Date.now() }));
  if (pos.size > MAX_VESSELS) {
    /* 淘汰最旧 10% */
    const arr = Array.from(pos.entries()).sort((a, b) => a[1].updated - b[1].updated);
    arr.slice(0, Math.floor(arr.length * 0.1)).forEach(function (e) { pos.delete(e[0]); });
  }
}

function _touchStat(mmsi, extra) {
  const k = String(mmsi);
  const cur = stat.get(k) || {};
  stat.set(k, Object.assign(cur, extra || {}, { updated: Date.now() }));
  if (stat.size > MAX_VESSELS) {
    const arr = Array.from(stat.entries()).sort((a, b) => a[1].updated - b[1].updated);
    arr.slice(0, Math.floor(arr.length * 0.1)).forEach(function (e) { stat.delete(e[0]); });
  }
}

function _handle(d) {
  const t = d.MessageType;
  if (!t || t === 'SubscriptionConfirmation') return;
  const meta = d.MetaData || {};
  const mmsi = meta.MMSI || meta.UserID;
  if (!mmsi) return;
  const M = d.Message || {};

  if (t === 'PositionReport' || t === 'StandardClassBPositionReport' || t === 'ExtendedClassBPositionReport' || t === 'LongRangeAisBroadcastMessage') {
    const p = M.PositionReport || M.StandardClassBPositionReport || M.ExtendedClassBPositionReport || M.LongRangeAisBroadcastMessage || {};
    const lat = _num(meta.latitude) != null ? _num(meta.latitude) : _num(p.Latitude);
    const lon = _num(meta.longitude) != null ? _num(meta.longitude) : _num(p.Longitude);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    posCount++;
    _touchPos(mmsi, lat, lon, { sog: _num(p.Sog), cog: _num(p.Cog), heading: _num(p.TrueHeading), nav: p.NavigationalStatus });
    return;
  }

  if (t === 'ShipStaticData' || t === 'StaticDataReport') {
    const s = M.ShipStaticData || M.StaticDataReport || {};
    staticCount++;
    _touchStat(mmsi, { name: (s.Name || meta.ShipName || '').toString().trim(), imo: s.ImoNumber, type: s.Type, destination: (s.Destination || '').toString().trim(), callSign: (s.CallSign || '').toString().trim() });
    return;
  }
}

function _connect() {
  if (!KEY) { lastErr = '未配置 AISSTREAM_KEY（server/.env）'; return; }
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    lastErr = 'WebSocket 创建失败: ' + e.message;
    return _scheduleReconnect();
  }

  ws.onopen = function () {
    connected = true; retryDelay = 3000; lastErr = '';
    if (!startedAt) startedAt = Date.now();
    try {
      ws.send(JSON.stringify({ APIKey: KEY, BoundingBoxes: AREAS.map(function (a) { return a.bbox; }), FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
      console.log('[AISSTREAM] 已连接并订阅 ' + AREAS.length + ' 个战略走廊');
    } catch (e) { lastErr = '订阅发送失败: ' + e.message; }
  };

  ws.onmessage = function (ev) {
    _decode(ev).then(function (s) {
      if (!s) return;
      let d; try { d = JSON.parse(s); } catch (e) { return; }
      if (d && d.error) { lastErr = String(d.error).slice(0, 160); return; }
      msgCount++; lastMsgAt = Date.now();
      try { _handle(d); } catch (e) { /* 单帧异常不影响通道 */ }
    }).catch(function () { });
  };

  ws.onerror = function (e) { lastErr = 'WS 错误: ' + ((e && e.message) || 'unknown'); };

  ws.onclose = function (ev) {
    connected = false;
    if (ev && ev.code !== 1000) lastErr = 'WS 关闭 code=' + (ev && ev.code) + ' ' + ((ev && ev.reason) || '');
    _scheduleReconnect();
  };
}

function _scheduleReconnect() {
  connected = false;
  reconnects++;
  const d = retryDelay;
  retryDelay = Math.min(60000, Math.round(retryDelay * 1.7));
  setTimeout(function () { _connect(); }, d);
}

function _prune() {
  const cut = Date.now() - TTL_MS;
  pos.forEach(function (v, k) { if (v.updated < cut) pos.delete(k); });
  stat.forEach(function (v, k) { if (v.updated < cut) stat.delete(k); });
}

function start() {
  if (started) return stats();
  started = true;
  if (!KEY) { console.warn('[AISSTREAM] 未配置 AISSTREAM_KEY，通道未启动'); return stats(); }
  _connect();
  if (!pruneTimer) pruneTimer = setInterval(_prune, 5 * 60 * 1000);
  if (pruneTimer.unref) pruneTimer.unref();
  return stats();
}

/* 合并位置 + 静态信息；按更新时间倒序 */
function getVessels(opts) {
  opts = opts || {};
  const limit = Math.min(2000, Math.max(1, parseInt(opts.limit, 10) || 500));
  const area = opts.area ? String(opts.area) : '';
  const out = [];
  pos.forEach(function (p, mmsi) {
    if (area && p.area !== area) return;
    const s = stat.get(mmsi) || {};
    out.push({
      mmsi: mmsi, name: s.name || '', imo: s.imo || null, type: s.type != null ? s.type : null,
      destination: s.destination || '', callSign: s.callSign || '',
      lat: p.lat, lon: p.lon, sog: p.sog, speed: p.sog, cog: p.cog, heading: p.heading,
      navStatus: p.nav, area: p.area,
      updated: p.updated, updatedAt: new Date(p.updated).toISOString(),
      fetchedAt: new Date(p.updated).toISOString()
    });
  });
  out.sort(function (a, b) { return b.updated - a.updated; });
  return out.slice(0, limit);
}

function stats() {
  const byArea = {};
  AREAS.forEach(function (a) { byArea[a.name] = 0; });
  let unknown = 0;
  pos.forEach(function (p) { if (p.area) byArea[p.area] = (byArea[p.area] || 0) + 1; else unknown++; });
  const mins = startedAt ? Math.max(1, (Date.now() - startedAt) / 60000) : 0;
  return {
    ok: !!KEY, enabled: !!KEY, started: started, connected: connected,
    vessels: pos.size, withDetail: stat.size,
    messages: msgCount, positions: posCount, staticMsgs: staticCount,
    msgPerMin: mins ? Math.round(posCount / mins) : 0,
    lastMsgAt: lastMsgAt ? new Date(lastMsgAt).toISOString() : null,
    lastMsgAgoSec: lastMsgAt ? Math.round((Date.now() - lastMsgAt) / 1000) : null,
    reconnects: reconnects, lastErr: lastErr,
    areas: AREAS.map(function (a) { return { name: a.name, bbox: a.bbox, count: byArea[a.name] || 0 }; }),
    unknownArea: unknown
  };
}

module.exports = { start, getVessels, stats, AREAS };
