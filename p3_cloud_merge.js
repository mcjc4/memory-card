/* p3_cloud_merge.js —— 记忆卡中枢「☁ 云端入库卡」按钮
 * 作用：把三大模块写入 M 库 cards 表（source_module 非空、status=active）的卡片，
 *       按 subjDef 既有规则合并进本地卡片库（IMPORTED），并写入「浏览时间」使新卡
 *       在「浏览历史」里按浏览时间倒序可见、可按日期筛选。
 * 复用页面全局：sbSelect / cloudCfg / IMPORTED / CUSTOM / SUBJECTS / browseMeta /
 *              browseHistory / afterCardChange / savePerson / SUBJ_COLORS / PALETTE。
 * 注意：本脚本在所有经典 <script> 共享的全局词法作用域里，可直接引用上述 let/const/function。
 */
(function () {
  'use strict';

  function elBtn() { return document.getElementById('cloudMergeBtn'); }
  function toast(msg) { if (window.MC && MC.toast) MC.toast(msg); else console.log('[cloudMerge] ' + msg); }

  // 判断某 card_id 是否已在本地任意科目库（避免重复并入）
  function idExists(id) {
    var names = Object.keys(SUBJECTS).concat(Object.keys(IMPORTED)).concat(Object.keys(CUSTOM));
    for (var i = 0; i < names.length; i++) {
      var def = CUSTOM[names[i]] || IMPORTED[names[i]] || SUBJECTS[names[i]];
      if (def && def.items && def.items.some(function (x) { return x.id === id; })) return true;
    }
    return false;
  }

  // 统计尚未并入的云端卡数量（页面加载时最好努力刷新角标）
  async function countUnmerged() {
    try {
      var rows = await sbSelect('cards', 'source_module=not.is.null&status=eq.active&select=card_id');
      var n = 0;
      (rows || []).forEach(function (r) { if (!idExists(r.card_id)) n++; });
      return n;
    } catch (e) { return -1; }
  }

  async function updateBadge() {
    var b = elBtn(); if (!b) return;
    var n = await countUnmerged();
    b.textContent = (n > 0 ? '☁ 云端入库卡 (' + n + ')' : '☁ 云端入库卡');
  }

  async function doMerge() {
    var b = elBtn(); if (b) { b.disabled = true; b.textContent = '☁ 合并中…'; }
    try {
      var rows = await sbSelect('cards',
        'source_module=not.is.null&status=eq.active' +
        '&select=card_id,subject,chapter,signal,conclusion,src,link,orig,tags,source_module,source_type,source_id,status,created_at' +
        '&limit=5000');
      var toAdd = {};          // subject -> [{rec, ts}]
      var seen = new Set();
      (rows || []).forEach(function (r) {
        if (!r.subject || !r.card_id) return;
        if (idExists(r.card_id) || seen.has(r.card_id)) return;
        seen.add(r.card_id);
        var rec = {
          id: r.card_id,
          t: r.chapter || '未分类',
          s: r.signal || '',
          c: r.conclusion || '',
          src: r.src || '',
          link: r.link || '',
          orig: r.orig || '',
          tags: Array.isArray(r.tags) ? r.tags : [],
          status: 0
        };
        (toAdd[r.subject] = toAdd[r.subject] || []).push({ rec: rec, ts: Date.parse(r.created_at) || Date.now() });
      });

      var added = 0;
      Object.keys(toAdd).forEach(function (subj) {
        var list = toAdd[subj];
        var isBuiltin = !!SUBJECTS[subj];
        var oldDef = CUSTOM[subj] || IMPORTED[subj] || SUBJECTS[subj];
        var box = CUSTOM[subj] ? CUSTOM : IMPORTED;
        // 内置科目 base 取 SUBJECTS.items 避免重复叠加；其余取现有 items
        var baseItems = (!CUSTOM[subj] && !IMPORTED[subj] && isBuiltin)
          ? (SUBJECTS[subj].items || [])
          : (oldDef ? (oldDef.items || []) : []);
        var baseIds = {}; baseItems.forEach(function (x) { baseIds[x.id] = 1; });
        var newItems = list.filter(function (o) { return !baseIds[o.rec.id]; }).map(function (o) { return o.rec; });
        if (!newItems.length) return;

        box[subj] = {
          color: (oldDef && oldDef.color) || (SUBJ_COLORS && SUBJ_COLORS[subj]) || (PALETTE && PALETTE[Object.keys(ALL_SUBJECTS).length % PALETTE.length]) || '#3B6D11',
          display: (oldDef && oldDef.display) || subj,
          items: baseItems.concat(newItems)
        };
        added += newItems.length;

        // 写入浏览时间 + 浏览历史（mode=入库，ts=云端 created_at），使其按浏览时间可见
        var bm = browseMeta[subj] || (browseMeta[subj] = {});
        list.forEach(function (o) {
          var m = bm[o.rec.id] || (bm[o.rec.id] = { browsed: false, lastBrowse: 0 });
          m.lastBrowse = o.ts;
          browseHistory.unshift({ ts: o.ts, id: o.rec.id, mode: '入库', subject: subj, src: o.rec.src || '', t: o.rec.t || '' });
        });
      });
      if (browseHistory.length > 500) browseHistory.length = 500;

      if (added > 0) {
        savePerson();
        afterCardChange();
        toast('已合并 ' + added + ' 张云端入库卡 · 去「浏览历史」按浏览时间查看');
      } else {
        toast('没有新的云端入库卡');
      }
      updateBadge();
    } catch (e) {
      toast('合并失败：' + (e && e.message ? e.message : e));
    } finally {
      if (b) { b.disabled = false; updateBadgeBtnText(); }
    }
  }

  function updateBadgeBtnText() {
    var b = elBtn(); if (!b) return;
    // 不阻塞：异步刷新角标
    countUnmerged().then(function (n) {
      b.textContent = (n > 0 ? '☁ 云端入库卡 (' + n + ')' : '☁ 云端入库卡');
    }).catch(function () {});
  }

  function init() {
    var b = elBtn();
    if (!b) return;
    b.addEventListener('click', doMerge);
    // 首次加载后最好努力刷新角标（失败不报错）
    updateBadgeBtnText();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
