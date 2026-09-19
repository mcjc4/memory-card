/* phase4_links_reviews.js —— Phase 4 前端：互链 + 重练标注 UI
 * 依赖：mc_pending.js（window.MC）、p3_cloud_merge.js（window.P3Merge）、index.html 全局 openCardModal / topicQuery
 * 能力：
 *   ① 卡片详情弹窗内注入「🔗 互链」区块（读取 card_links，双向展示；可添加/删除关联）
 *   ② 卡片详情弹窗内注入「🔁 重练」区块（读取 card_reviews；可一键标重练/取消）
 * 说明：云端表需先在 Supabase Dashboard 执行 phase4_links_reviews.sql 后方可读写；否则区块提示「未启用」。
 */
(function () {
  'use strict';

  var P4 = { currentCardId: null, _wrapped: false };

  function sbBase() {
    var u = (window.MC && MC.config && MC.config.url) || 'https://mixuqjognbdrafrrlivc.supabase.co';
    return u.replace(/\/rest\/v1\/?$/, '') + '/rest/v1';
  }
  function sbKey() {
    return (window.MC && MC.config && MC.config.key) || 'sb_publishable_D0ha7g4X4LutG-3hxCguSA_pwyQLrVX';
  }
  async function sbReq(path, method, body, extra) {
    var h = { 'apikey': sbKey(), 'Authorization': 'Bearer ' + sbKey(), 'Content-Type': 'application/json' };
    if (extra) Object.assign(h, extra);
    var r = await fetch(sbBase() + '/' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status);
    var t = await r.text(); return t ? JSON.parse(t) : null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m) { if (window.MC && MC.toast) MC.toast(m); else console.log('[P4] ' + m); }

  var KIND_LABEL = { wrong_question: '错题', courseware: '课件/解题', knowledge_node: '知识节点', card: '记忆卡' };

  /* ---------------- ① 包裹 openCardModal，注入互链 + 重练区块 ---------------- */
  function ensureWrapped() {
    if (P4._wrapped) return;
    if (typeof window.openCardModal !== 'function') return;
    var _orig = window.openCardModal;
    window.openCardModal = function (editId) {
      var r = _orig.apply(this, arguments);
      P4.currentCardId = editId || null;
      if (editId) setTimeout(function () { renderCardExtra(editId); }, 40);
      return r;
    };
    P4._wrapped = true;
  }

  async function renderCardExtra(cardId) {
    var modal = document.getElementById('cardModal');
    if (!modal) return;
    var old = document.getElementById('p4extra'); if (old) old.parentNode.removeChild(old);
    if (!cardId) return;

    var sec = document.createElement('section');
    sec.id = 'p4extra';
    sec.style.cssText = 'margin-top:12px;border-top:1px dashed #d6deea;padding-top:10px;font-size:13px';
    sec.innerHTML = '<div style="color:#6b7280;margin-bottom:6px">🔗 互链 / 🔁 重练 读取中…</div>';
    modal.appendChild(sec);

    var links = [], rev = null, incoming = [];
    try {
      links = await MC.select('card_links', 'card_id=eq.' + encodeURIComponent(cardId) + '&select=id,target_kind,target_id,relation');
    } catch (e) { links = null; }
    try {
      var rv = await MC.select('card_reviews', 'card_id=eq.' + encodeURIComponent(cardId) + '&select=needs_repractice,reason,level,updated_at');
      rev = (rv && rv[0]) || null;
    } catch (e) { rev = 'ERR'; }
    try {
      incoming = await MC.select('card_links', 'target_kind=eq.card&target_id=eq.' + encodeURIComponent(cardId) + '&select=id,card_id,relation');
    } catch (e) { incoming = []; }

    var html = '';
    /* 重练区块 */
    if (rev === 'ERR') {
      html += '<div style="color:#b45309;margin-bottom:8px">🔁 重练：功能未启用（需在 Supabase Dashboard 执行 phase4_links_reviews.sql）</div>';
    } else {
      var need = rev && rev.needs_repractice;
      html += '<div style="margin-bottom:8px"><b>🔁 重练：</b>' +
        (need ? '<span style="background:#fee2e2;color:#991b1b;padding:1px 8px;border-radius:6px">待重练</span>' : '<span style="color:#9ca3af">—</span>');
      if (need && rev.reason) html += ' <span style="color:#92400e">原因：' + esc(rev.reason) + '</span>';
      html += ' <button id="p4rpr" class="mc-btn ' + (need ? 'mc-btn-cancel' : 'mc-btn-pass') + '" style="margin-left:6px;padding:3px 8px;font-size:12px">' +
        (need ? '取消重练' : '标为重练') + '</button></div>';
    }
    /* 互链区块 */
    if (links === null) {
      html += '<div style="color:#b45309;margin-bottom:8px">🔗 互链：功能未启用（需执行 phase4_links_reviews.sql）</div>';
    } else {
      html += '<div style="margin-bottom:4px"><b>🔗 互链</b>（' + (links.length + incoming.length) + '）' +
        ' <button id="p4addlink" class="mc-btn mc-btn-edit" style="padding:3px 8px;font-size:12px">+ 添加关联</button></div>';
      html += '<div id="p4links">';
      if (!links.length && !incoming.length) {
        html += '<div style="color:#9ca3af;font-size:12px">暂无关联</div>';
      }
      links.forEach(function (l) {
        html += linkRow(l.id, KIND_LABEL[l.target_kind] || l.target_kind, l.target_id, l.relation, false);
      });
      incoming.forEach(function (l) {
        html += linkRow(l.id, '记忆卡（被关联）', l.card_id, l.relation, true);
      });
      html += '</div>';
    }
    sec.innerHTML = html;

    var rpr = sec.querySelector('#p4rpr');
    if (rpr) rpr.addEventListener('click', function () { toggleRepractice(cardId, !!(rev && rev.needs_repractice), rev); });
    var add = sec.querySelector('#p4addlink');
    if (add) add.addEventListener('click', function () { addLink(cardId); });
    sec.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { delLink(b.getAttribute('data-del'), cardId); });
    });
  }

  function linkRow(id, label, target, relation, incoming) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f1f5f9;font-size:12px">' +
      '<span style="background:#eef2ff;color:#3b4db8;padding:1px 7px;border-radius:6px">' + esc(label) + '</span>' +
      '<code style="color:#185FA5">' + esc(target) + '</code>' +
      (relation ? '<span style="color:#6b7280">' + esc(relation) + '</span>' : '') +
      ' <button data-del="' + esc(id) + '" class="mc-btn mc-btn-reject" style="margin-left:auto;padding:2px 7px;font-size:11px">删除</button></div>';
  }

  async function toggleRepractice(cardId, currentlyNeed, rev) {
    try {
      var doMark = !currentlyNeed;
      var reason = '';
      if (doMark) {
        reason = window.prompt('标为重练的原因（如：关联错题 2026-09-17 #3 答错）：', '') || '手动标记';
      }
      var now = new Date().toISOString();
      var patch = {
        card_id: cardId, level: rev ? (rev.level || 0) : 0, last_result: rev ? (rev.level || 0) : 0,
        review_count: rev ? ((rev.review_count || 0) + 1) : 1,
        needs_repractice: doMark, reason: doMark ? reason : '', last_reviewed_at: now, updated_at: now
      };
      await sbReq('card_reviews', 'POST', [patch], { 'Prefer': 'resolution=merge-duplicates' });
      toast(doMark ? '已标为重练' : '已取消重练');
      renderCardExtra(cardId);
    } catch (e) { toast('操作失败：' + e.message); }
  }

  async function addLink(cardId) {
    var kind = window.prompt('关联类型（wrong_question / courseware / knowledge_node / card）：', 'card');
    if (!kind) return;
    var tid = window.prompt('关联对象 ID（错题ID / 课件ID / 知识节点ID / 记忆卡ID）：', '');
    if (!tid) return;
    tid = tid.trim(); kind = kind.trim();
    var relation = window.prompt('关系说明（可选）：', '') || '';
    try {
      var now = new Date().toISOString();
      await sbReq('card_links', 'POST', [{ card_id: cardId, target_kind: kind, target_id: tid, relation: relation, created_at: now }]);
      /* 卡↔卡 存双向，保证两卡互查都能看到 */
      if (kind === 'card') {
        await sbReq('card_links', 'POST', [{ card_id: tid, target_kind: 'card', target_id: cardId, relation: relation, created_at: now }]);
      }
      toast('已添加关联');
      renderCardExtra(cardId);
    } catch (e) { toast('添加失败：' + e.message); }
  }

  async function delLink(linkId, cardId) {
    try { await sbReq('card_links?id=eq.' + encodeURIComponent(linkId), 'DELETE'); toast('已删除关联'); renderCardExtra(cardId); }
    catch (e) { toast('删除失败：' + e.message); }
  }


  function init() {
    ensureWrapped();
    /* 防 openCardModal 在脚本加载后才定义：轮询兜底包裹 */
    var tries = 0;
    var t = setInterval(function () {
      tries++; ensureWrapped();
      if (P4._wrapped && document.getElementById('tqCount')) { clearInterval(t); }
      if (tries > 40) clearInterval(t);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
