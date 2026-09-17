/* p3_idb_store.js —— 卡库 IndexedDB 大容量存储层
 * 目的：解除 localStorage 单源 ~5MB 上限。仅用于 IMPORTED / CUSTOM 两个大键，
 *       其余小键（state/goal/streak…）仍走 localStorage，互不干扰。
 * 设计：
 *   - 启动阶段优先从 IndexedDB 读取卡库；若 IDB 不可用或为空，自动回退 localStorage（零回归）。
 *   - 每次 savePerson 在写 localStorage 的同时「写穿」IndexedDB（异步、不阻塞）。
 *     即使 localStorage 因 5MB 配额写入失败被静默丢弃，IndexedDB 仍持有完整数据，下次启动可恢复。
 *   - 首次启动若 IDB 为空但 localStorage 有数据，自动把 localStorage 迁入 IDB（一次性）。
 * 失败安全：任何 IDB 异常都不影响主流程，自动降级到 localStorage。
 */
(function () {
  'use strict';
  var DB_NAME = 'memory-card-idb';
  var STORE = 'kv';
  var VERSION = 1;
  var dbp = null;
  var available = false;
  var bootDone = false;

  function open() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') { available = false; bootDone = true; resolve(null); return; }
      try {
        var req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function (e) { dbp = e.target.result; available = true; bootDone = true; resolve(dbp); };
        req.onerror = function () { available = false; bootDone = true; resolve(null); };
        req.onblocked = function () { available = false; bootDone = true; resolve(null); };
      } catch (e) { available = false; bootDone = true; resolve(null); }
    });
  }

  function _get(db, key) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = function () { resolve(rq.result !== undefined ? rq.result : null); };
        rq.onerror = function () { reject(rq.error); };
      } catch (e) { reject(e); }
    });
  }

  function get(key) {
    return new Promise(function (resolve, reject) {
      if (dbp) { _get(dbp, key).then(resolve, reject); return; }
      open().then(function (db) { if (!db) return resolve(null); _get(db, key).then(resolve, reject); }, function () { resolve(null); });
    });
  }

  function set(key, value) {
    return new Promise(function (resolve, reject) {
      function doIt(db) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      }
      if (dbp) { doIt(dbp); return; }
      open().then(function (db) { if (!db) return reject(new Error('idb unavailable')); doIt(db); }, function () { reject(new Error('idb unavailable')); });
    });
  }

  function loadCardLibs() {
    return Promise.all([get('wulun_cards_imported'), get('wulun_cards_custom')])
      .then(function (r) { return { imported: r[0], custom: r[1] }; });
  }

  // 立即尝试打开（异步；available 会在回调后变 true/false）
  try { open(); } catch (e) { available = false; bootDone = true; }

  window.IDB = {
    get available() { return available; },
    get ready() { return bootDone; },
    open: open,
    get: get,
    set: set,
    loadCardLibs: loadCardLibs
  };
})();
