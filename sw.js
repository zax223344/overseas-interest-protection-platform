/* ORPS PWA Service Worker v1
 * 设计原则：本系统是强实时情报系统（SSE/轮询），业务数据与 HTML/JS/CSS 一律直连网络，
 * 不缓存（server 端也已对代码类资源 no-store，Cache API 无法存储 no-store 响应，
 * 强行 precache 会导致 SW 安装失败）。
 * 仅对 /icons/ 下 PWA 图标做 cache-first（png 不受 no-store 影响，可安全缓存）。
 * fetch handler 的存在本身即满足浏览器"可安装到桌面"的判定条件。
 */
var ICON_CACHE = 'orps-icons-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== ICON_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  /* API / SSE / 业务静态资源：不干预，直连网络，保证实时性 */
  if (url.pathname.indexOf('/icons/') === 0) {
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (resp) {
          if (resp && resp.ok) {
            var clone = resp.clone();
            caches.open(ICON_CACHE).then(function (c) { c.put(e.request, clone); }).catch(function () {});
          }
          return resp;
        });
      })
    );
  }
});
