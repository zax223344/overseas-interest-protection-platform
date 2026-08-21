/* ============================================================
 * idb-store.js — IndexedDB 持久层（2026-08-12）
 * 背景：localStorage 配额仅 5-10MB，情报数据回填后写爆（QuotaExceededError）。
 * IndexedDB 配额为数百 MB ~ GB 级，是浏览器端大批量数据的正确存储。
 *
 * 设计：同步外观（sync facade）——启动时把 IndexedDB 全部键值读入内存 Map，
 * 之后 get/set 全部走内存（保持 DBCenter._r/_w 等既有同步调用签名不变），
 * set 同时异步刷写 IndexedDB。IndexedDB 不可用时自动回退 localStorage。
 * ============================================================ */
(function () {
  'use strict';
  var DB_NAME = 'orps_idb', STORE = 'kv';
  var _db = null, _mem = {}, _ready = false, _waiters = [], _starting = false;

  function _open() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('indexedDB unsupported')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) { e.target.result.createObjectStore(STORE); };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { reject(req.error || new Error('open failed')); };
    });
  }

  function _hydrate(db) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(STORE, 'readonly');
        var st = tx.objectStore(STORE);
        var keysReq = st.getAllKeys();
        var valsReq = st.getAll();
        tx.oncomplete = function () {
          var keys = keysReq.result || [], vals = valsReq.result || [];
          for (var i = 0; i < keys.length; i++) _mem[String(keys[i])] = vals[i];
          resolve();
        };
        tx.onerror = function () { resolve(); };
      } catch (e) { resolve(); }
    });
  }

  /* localStorage 存量 orps_* 键一次性迁入（只迁内存层没有的，IDB 优先） */
  function _migrateFromLocalStorage() {
    var migrated = 0;
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('orps_') === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        if (_mem[k] !== undefined) return;
        var v = null;
        try { v = localStorage.getItem(k); } catch (e) {}
        if (v !== null) { _mem[k] = v; migrated++; }
      });
    } catch (e) {}
    return migrated;
  }

  /* 迁移完成后清理 localStorage 里的大 key（>50KB），释放配额给小数据（设置/会话等） */
  function _releaseLocalStorage() {
    var freed = 0;
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('orps_') === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        try {
          var v = localStorage.getItem(k);
          if (v && v.length > 51200 && _mem[k] !== undefined) {
            localStorage.removeItem(k);
            freed += v.length;
          }
        } catch (e) {}
      });
    } catch (e) {}
    if (freed) console.log('[IDBStore] 已释放 localStorage ' + Math.round(freed / 1024) + 'KB（数据已迁 IndexedDB）');
  }

  function _flushKey(k) {
    if (!_db) return;
    try {
      var tx = _db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(_mem[k], k);
    } catch (e) {}
  }

  function _flushAll() {
    if (!_db) return;
    try {
      var tx = _db.transaction(STORE, 'readwrite');
      var st = tx.objectStore(STORE);
      for (var k in _mem) st.put(_mem[k], k);
    } catch (e) {}
  }

  window.IDBStore = {
    ready: function () { return _ready; },
    init: function (cb) {
      if (_ready) { if (cb) cb(); return; }
      if (cb) _waiters.push(cb);
      if (_starting) return;
      _starting = true;
      _open().then(function (db) {
        _db = db;
        return _hydrate(db);
      }).then(function () {
        var n = _migrateFromLocalStorage();
        _ready = true;
        _flushAll();
        if (n) console.log('[IDBStore] 已从 localStorage 迁入 ' + n + ' 个键');
        /* 迁移落库后再释放 localStorage 大 key */
        setTimeout(_releaseLocalStorage, 3000);
        var ws = _waiters.slice(); _waiters = [];
        ws.forEach(function (f) { try { f(); } catch (e) {} });
      }).catch(function (e) {
        console.warn('[IDBStore] IndexedDB 不可用，回退 localStorage:', e && e.message);
        _ready = true; /* 回退模式：get/set 直通 localStorage */
        var ws = _waiters.slice(); _waiters = [];
        ws.forEach(function (f) { try { f(); } catch (e) {} });
      });
    },
    getItem: function (k) {
      if (_db) { var v = _mem[k]; return v === undefined ? null : v; }
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    setItem: function (k, v) {
      if (_db) { _mem[k] = v; _flushKey(k); return; }
      try { localStorage.setItem(k, v); } catch (e) {}
    },
    removeItem: function (k) {
      if (_db) {
        delete _mem[k];
        try { var tx = _db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); } catch (e) {}
        return;
      }
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  /* 立即启动（不等 DOMContentLoaded，IndexedDB 打开通常 <100ms） */
  window.IDBStore.init();
})();
