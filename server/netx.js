'use strict';
/* ==========================================================================
 * netx.js — 采集链路统一出口层（直连优先，被墙源自动回落本地代理）
 *
 * 背景（2026-08-22 事故）：
 *   GDELT/AlJazeera/BBC 等境外源在国内直连被 GFW 拦（DNS 投毒到 Facebook IP /
 *   TCP 超时），而进程级 HTTP_PROXY 方案是"全家桶"——代理一挂，连国内翻译
 *   API 都全灭，还会污染 PM2 God 导致 DB 超时（见 MEMORY 铁律）。
 *   因此改为按请求决策：默认直连；直连网络失败才对该 host 走代理；
 *   每个 host 的成功通路缓存 30 分钟，避免每轮都白等一次直连超时。
 *
 * 用法：netx.smartFetch(url, { headers, timeout }) —— fetch 兼容子集
 *   仅支持 GET；返回 { ok, status, statusText, headers:{get()}, text(), json() }
 *   调用方原有的 AbortSignal 由内部 timeout 替代（调用方 timeout 透传）。
 * 代理地址：process.env.OVERSEAS_PROXY 或默认 http://127.0.0.1:7897；
 *   代理不可达时熔断 5 分钟（OVERSEAS_PROXY=direct 可整体禁用回落）。
 * ==========================================================================*/
const https = require('https');

const PROXY_URL = process.env.OVERSEAS_PROXY === undefined
  ? 'http://127.0.0.1:7897'
  : process.env.OVERSEAS_PROXY;
const PROXY_ENABLED = !!(PROXY_URL && PROXY_URL !== 'direct');

let _agent = null;
function _proxyAgent() {
  if (!_agent) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    _agent = new HttpsProxyAgent(PROXY_URL);
  }
  return _agent;
}

/* host → { mode:'direct'|'proxy', t } 成功通路缓存 */
const _hostMode = new Map();
const MODE_TTL = 30 * 60 * 1000;
/* 代理不可达熔断：避免每个请求都白等一次代理连接失败 */
let _proxyDownUntil = 0;
const PROXY_DOWN_TTL = 5 * 60 * 1000;

function _cachedMode(host) {
  const m = _hostMode.get(host);
  if (m && Date.now() - m.t < MODE_TTL) return m.mode;
  return null;
}
function _remember(host, mode) {
  _hostMode.set(host, { mode, t: Date.now() });
  if (_hostMode.size > 500) {                       // 防无限增长
    const now = Date.now();
    for (const [k, v] of _hostMode) if (now - v.t >= MODE_TTL) _hostMode.delete(k);
  }
}

/* fetch Headers 兼容子集 */
function _wrapHeaders(raw) {
  return { get: (n) => raw[String(n).toLowerCase()] !== undefined ? raw[String(n).toLowerCase()] : null };
}

/* 直连腿 GET：原生 https.request + family:4（锁 IPv4）+ 手动跟随重定向（最多 5 跳）。
 * 2026-09-01 根因修复：服务进程内 undici fetch 出现系统性 UND_ERR_CONNECT_TIMEOUT
 * （独立进程同调用 238ms 正常、服务进程 100% 连接超时，采集侧原生 https.request 全程
 * 存活）——直连腿改走与代理腿同一套原生栈，彻底绕开 undici。 */
function _directGet(url, headers, timeout, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.request(url, { timeout, family: 4, headers }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && hops < 5) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        settled = true;
        _directGet(next, headers, timeout, hops + 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        resolve({
          ok: code >= 200 && code < 300,
          status: code,
          statusText: res.statusMessage || '',
          headers: _wrapHeaders(res.headers),
          text: async () => buf.toString('utf8'),
          buffer: async () => buf,
          json: async () => JSON.parse(buf.toString('utf8')),
        });
      });
      res.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    });
    req.on('timeout', () => { req.destroy(); if (!settled) { settled = true; reject(new Error('direct timeout')); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.end();
  });
}

/* 直连腿 POST：原生 https.request + family:4（与 _directGet 同批引入，绕开 undici） */
function _directPost(url, headers, body, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.request(url, { timeout, family: 4, headers, method: 'POST' }, (res) => {
      const code = res.statusCode || 0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        resolve({
          ok: code >= 200 && code < 300,
          status: code,
          statusText: res.statusMessage || '',
          headers: _wrapHeaders(res.headers),
          text: async () => buf.toString('utf8'),
          buffer: async () => buf,
          json: async () => JSON.parse(buf.toString('utf8')),
        });
      });
      res.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    });
    req.on('timeout', () => { req.destroy(); if (!settled) { settled = true; reject(new Error('direct timeout')); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.end(body);
  });
}

/* 代理腿：https.request + HttpsProxyAgent，手动跟随重定向（最多 5 跳） */
function _proxyGet(url, headers, timeout, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.request(url, {
      agent: _proxyAgent(), timeout, family: 4, headers,
    }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && hops < 5) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        settled = true;
        _proxyGet(next, headers, timeout, hops + 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        resolve({
          ok: code >= 200 && code < 300,
          status: code,
          statusText: res.statusMessage || '',
          headers: _wrapHeaders(res.headers),
          text: async () => buf.toString('utf8'),
          buffer: async () => buf,
          json: async () => JSON.parse(buf.toString('utf8')),
        });
      });
      res.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    });
    req.on('timeout', () => { req.destroy(); if (!settled) { settled = true; reject(new Error('proxy timeout')); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.end();
  });
}

/**
 * 智能 GET：直连优先，网络层失败回落本地代理（按 host 记忆成功通路）。
 * @param {string} url
 * @param {object} opts { headers, timeout }（仅 GET；redirect 内部自动跟随）
 * @returns fetch 兼容 Response 子集
 */
async function smartFetch(url, opts) {
  opts = opts || {};
  const headers = opts.headers || {};
  const timeout = opts.timeout || 15000;
  const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();

  const mode = _cachedMode(host);
  const proxyAlive = PROXY_ENABLED && Date.now() >= _proxyDownUntil;
  /* 2026-09-04：proxyFirst 选项——Google 系服务（GCS/News）对大陆直连 IP 返回
   * 404 伪装而非连接失败，"直连优先"会被假 404 骗过不回落；此类 host 须代理优先。 */
  const order = opts.proxyFirst ? ['proxy', 'direct']
    : (mode === 'proxy' && proxyAlive ? ['proxy', 'direct'] : ['direct', 'proxy']);

  let lastErr = null;
  for (const leg of order) {
    if (leg === 'proxy' && (!proxyAlive)) continue;
    /* 每条腿最多 2 次尝试：本地小代理（Clash）在批量并发下常瞬时断流，
     * "socket disconnected" 类错误隔 1.2s 重试一次可救回大半 */
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (leg === 'direct') {
          /* 直连腿走原生 https.request（2026-09-01：绕开服务进程内 undici 连接超时）；
           * 直连腿超时封顶 12s：被墙源的典型症状就是挂满整个 timeout */
          const r = await _directGet(url, headers, Math.min(timeout, 12000), 0);
          _remember(host, 'direct');
          return r;
        }
        const r = await _proxyGet(url, headers, timeout, 0);
        _remember(host, 'proxy');
        return r;
      } catch (e) {
        lastErr = e;
        if (leg === 'proxy' && e && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(String(e.message))) {
          _proxyDownUntil = Date.now() + PROXY_DOWN_TTL;
          break;                                   // 代理本体死了，重试无意义
        }
        if (attempt === 0) await new Promise(s => setTimeout(s, 1200));
      }
    }
  }
  throw lastErr || new Error('smartFetch: all legs failed');
}

/* 代理腿 POST：https.request + HttpsProxyAgent（不跟随重定向，POST 场景无此需求） */
function _proxyPost(url, headers, body, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.request(url, {
      agent: _proxyAgent(), timeout, family: 4, headers, method: 'POST',
    }, (res) => {
      const code = res.statusCode || 0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        resolve({
          ok: code >= 200 && code < 300,
          status: code,
          statusText: res.statusMessage || '',
          headers: _wrapHeaders(res.headers),
          text: async () => buf.toString('utf8'),
          buffer: async () => buf,
          json: async () => JSON.parse(buf.toString('utf8')),
        });
      });
      res.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    });
    req.on('timeout', () => { req.destroy(); if (!settled) { settled = true; reject(new Error('proxy timeout')); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.end(body);
  });
}

/**
 * 智能 POST：直连优先，网络层失败回落本地代理（与 smartFetch 同一套通路记忆）。
 * @param {string} url
 * @param {object} opts { headers, body(string), timeout }
 * 2026-08-30：为 Google News 旧闻验真清扫器（batchexecute 解码接口）新增。
 */
async function smartPost(url, opts) {
  opts = opts || {};
  const headers = opts.headers || {};
  const body = opts.body || '';
  const timeout = opts.timeout || 15000;
  const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
  const mode = _cachedMode(host);
  const proxyAlive = PROXY_ENABLED && Date.now() >= _proxyDownUntil;
  const order = mode === 'proxy' && proxyAlive ? ['proxy', 'direct'] : ['direct', 'proxy'];
  let lastErr = null;
  for (const leg of order) {
    if (leg === 'proxy' && (!proxyAlive)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (leg === 'direct') {
          /* 直连腿走原生 https.request（2026-09-01：绕开服务进程内 undici 连接超时） */
          const r = await _directPost(url, headers, body, Math.min(timeout, 12000));
          _remember(host, 'direct');
          return r;
        }
        const r = await _proxyPost(url, headers, body, timeout);
        _remember(host, 'proxy');
        return r;
      } catch (e) {
        lastErr = e;
        if (leg === 'proxy' && e && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(String(e.message))) {
          _proxyDownUntil = Date.now() + PROXY_DOWN_TTL;
          break;
        }
        if (attempt === 0) await new Promise(s => setTimeout(s, 1200));
      }
    }
  }
  throw lastErr || new Error('smartPost: all legs failed');
}

/* 观测用：当前 host 通路记忆与代理熔断状态 */
function stats() {
  const hosts = {};
  for (const [k, v] of _hostMode) hosts[k] = v.mode;
  return {
    proxy: PROXY_ENABLED ? PROXY_URL : 'disabled',
    proxyDownUntil: _proxyDownUntil ? new Date(_proxyDownUntil).toISOString() : null,
    hosts,
  };
}

module.exports = { smartFetch, smartPost, stats };
