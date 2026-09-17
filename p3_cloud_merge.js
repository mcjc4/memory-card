/* p3_cloud_merge.js —— 记忆卡中枢「☁ 云端入库卡」按钮
 * 作用：把三大模块写入 M 库 cards 表（source_module 非空、status=active）的卡片，
 *       按 subjDef 既有规则合并进本地卡片库（IMPORTED），并写入「浏览时间」使新卡
 *       在「浏览历史」里按浏览时间倒序可见、可按日期筛选。
 * 复用页面全局：sbSelect / IMPORTED / CUSTOM / SUBJECTS / browseMeta /
 *              browseHistory / afterCardChange / savePerson / SUBJ_COLORS / PALETTE / ALL_SUBJECTS。
 *
 * v2：点击先弹出「预览核对」弹窗，列出每张待合并卡的全部字段（科目·章节 / 信号 / 结论 /
 *     出处 / 链接 / 标签），逐张可勾选 + 全选，确认后才写。取消则不动。
 *     满足「入库前先看到完整内容核对」+「可控可回滚」。
 */
(function () {
  'use strict';

  function elBtn() { return document.getElementById('cloudMergeBtn'); }
  function toast(msg) { if (window.MC && MC.toast) MC.toast(msg); else console.log('[cloudMerge] ' + msg); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  // 判断某 card_id 是否已在本地任意科目库（避免重复并入）
  function idExists(id) {
    var names = Object.keys(SUBJECTS).concat(Object.keys(IMPORTED)).concat(Object.keys(CUSTOM));
    for (var i = 0; i < names.length; i++) {
      var def = CUSTOM[names[i]] || IMPORTED[names[i]] || SUBJECTS[names[i]];
      if (def && def.items && def.items.some(function (x) { return x.id === id; })) return true;
    }
    return false;
  }

  // 统计尚未并入的云端卡数量（页面加载时刷新角标）
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

  // 取待合并候选（去重 + 转成本地 rec，带上 subject）
  async function fetchCandidates() {
    var rows = await sbSelect('cards',
      'source_module=not.is.null&status=eq.active' +
      '&select=card_id,subject,chapter,signal,conclusion,src,link,orig,tags,source_module,source_type,source_id,status,created_at' +
      '&limit=5000');
    var list = [], seen = new Set();
    (rows || []).forEach(function (r) {
      if (!r.subject || !r.card_id) return;
      if (idExists(r.card_id) || seen.has(r.card_id)) return;
      seen.add(r.card_id);
      list.push({
        card_id: r.card_id,
        subject: r.subject,
        ts: Date.parse(r.created_at) || Date.now(),
        rec: {
          id: r.card_id,
          t: r.chapter || '未分类',
          s: r.signal || '',
          c: r.conclusion || '',
          src: r.src || '',
          link: r.link || '',
          orig: r.orig || '',
          tags: Array.isArray(r.tags) ? r.tags : [],
          status: 0
        }
      });
    });
    return list;
  }

  /* ---------- 预览核对弹窗 ---------- */
  var MODAL_CSS =
    '.p3m-mask{position:fixed;inset:0;background:rgba(20,24,31,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:32px 12px;overflow:auto;font-family:inherit}' +
    '.p3m-panel{background:#fff;border-radius:16px;max-width:760px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.28)}' +
    '.p3m-head{padding:16px 20px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px}' +
    '.p3m-head h3{margin:0;font-size:17px;font-weight:700;color:#1f2329;flex:1}' +
    '.p3m-head .cnt{font-size:13px;color:#6b7280}' +
    '.p3m-bar{padding:10px 20px;display:flex;align-items:center;gap:14px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;background:#fafafa}' +
    '.p3m-bar label{cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none}' +
    '.p3m-body{max-height:56vh;overflow:auto;padding:8px 20px 16px}' +
    '.p3m-card{border:1px solid #ececec;border-radius:12px;padding:12px 14px;margin:10px 0;background:#fff}' +
    '.p3m-card.on{border-color:#185FA5;background:#f5f9ff}' +
    '.p3m-card .top{display:flex;align-items:flex-start;gap:10px}' +
    '.p3m-card .chk{margin-top:3px;width:17px;height:17px;flex:none}' +
    '.p3m-card .sub{font-weight:700;color:#185FA5;font-size:14px}' +
    '.p3m-card .ch{color:#6b7280;font-size:12px;margin-left:8px}' +
    '.p3m-card .row{margin-top:6px;font-size:13px;line-height:1.5;color:#1f2329}' +
    '.p3m-card .lbl{display:inline-block;min-width:42px;color:#9aa0a6;font-weight:600}' +
    '.p3m-card .tags{margin-top:6px}' +
    '.p3m-card .tag{display:inline-block;background:#eef2ff;color:#3b4db8;border-radius:6px;padding:1px 7px;font-size:11px;margin:2px 4px 0 0}' +
    '.p3m-card a{color:#185FA5;word-break:break-all}' +
    '.p3m-foot{padding:14px 20px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:10px}' +
    '.p3m-foot button{font-size:14px;padding:9px 18px;border-radius:10px;border:1px solid #d0d5dd;background:#fff;cursor:pointer}' +
    '.p3m-foot .ok{background:#185FA5;border-color:#185FA5;color:#fff;font-weight:600}' +
    '.p3m-foot .ok:disabled{background:#9db4cf;cursor:not-allowed}';

  function ensureCss() {
    if (document.getElementById('p3m-css')) return;
    var st = document.createElement('style'); st.id = 'p3m-css'; st.textContent = MODAL_CSS;
    document.head.appendChild(st);
  }

  function openPreview(list) {
    ensureCss();
    var mask = document.createElement('div'); mask.className = 'p3m-mask';
    mask.innerHTML =
      '<div class="p3m-panel">' +
        '<div class="p3m-head"><h3>☁ 云端入库卡 · 预览核对</h3><span class="cnt" id="p3m-cnt"></span></div>' +
        '<div class="p3m-bar">' +
          '<label><input type="checkbox" id="p3m-all" checked> 全选</label>' +
          '<span>共 <b id="p3m-total">0</b> 张待合并（来自云端 cards 表，未拉回本机）</span>' +
        '</div>' +
        '<div class="p3m-body" id="p3m-body"></div>' +
        '<div class="p3m-foot">' +
          '<button id="p3m-cancel">取消</button>' +
          '<button class="ok" id="p3m-ok">确认合并 0 张</button>' +
        '</div>' +
      '</div>';

    function cardHtml(it) {
      var c = it.rec;
      var tags = (c.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
      return '<div class="p3m-card on" data-id="' + esc(it.card_id) + '">' +
        '<div class="top">' +
          '<input class="chk" type="checkbox" checked>' +
          '<div><span class="sub">' + esc(c.t || '未分类') + '</span>' +
            '<span class="ch">· ' + esc(it.card_id) + '</span></div>' +
        '</div>' +
        '<div class="row"><span class="lbl">信号</span>' + esc(c.s) + '</div>' +
        '<div class="row"><span class="lbl">结论</span>' + esc(c.c) + '</div>' +
        (c.src ? '<div class="row"><span class="lbl">出处</span>' + esc(c.src) + '</div>' : '') +
        (c.link ? '<div class="row"><span class="lbl">链接</span><a href="' + esc(c.link) + '" target="_blank">' + esc(c.link) + '</a></div>' : '') +
        (c.orig ? '<div class="row"><span class="lbl">原题</span>' + esc(c.orig) + '</div>' : '') +
        (tags ? '<div class="tags">' + tags + '</div>' : '') +
      '</div>';
    }

    mask.querySelector('#p3m-body').innerHTML = list.map(cardHtml).join('');
    document.body.appendChild(mask);

    var total = list.length;
    var okBtn = mask.querySelector('#p3m-ok');
    var cntEl = mask.querySelector('#p3m-cnt');
    mask.querySelector('#p3m-total').textContent = total;

    function sync() {
      var cards = mask.querySelectorAll('.p3m-card');
      var n = 0;
      cards.forEach(function (el) {
        var on = el.querySelector('.chk').checked;
        el.classList.toggle('on', on);
        if (on) n++;
      });
      okBtn.textContent = '确认合并 ' + n + ' 张';
      okBtn.disabled = (n === 0);
      cntEl.textContent = '已选 ' + n + ' / ' + total;
    }

    mask.querySelector('#p3m-all').addEventListener('change', function () {
      var v = this.checked;
      mask.querySelectorAll('.p3m-card .chk').forEach(function (cb) { cb.checked = v; });
      sync();
    });
    mask.querySelectorAll('.p3m-card .chk').forEach(function (cb) { cb.addEventListener('change', sync); });
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelector('#p3m-cancel').addEventListener('click', close);
    okBtn.addEventListener('click', function () {
      var sel = [];
      mask.querySelectorAll('.p3m-card').forEach(function (el) {
        if (el.querySelector('.chk').checked) {
          var id = el.getAttribute('data-id');
          var it = list.find(function (x) { return x.card_id === id; });
          if (it) sel.push(it);
        }
      });
      close();
      commit(sel);
    });

    sync();

    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
  }

  /* ---------- 真正的合并（仅合并 sel 列表，按 subject 归并） ---------- */
  async function commit(sel) {
    if (!sel || !sel.length) { toast('未选择任何卡片'); updateBadge(); return; }
    try {
      var bySubj = {};
      sel.forEach(function (o) {
        var subj = o.subject || '未分类';
        (bySubj[subj] = bySubj[subj] || []).push(o);
      });

      var added = 0;
      Object.keys(bySubj).forEach(function (subj) {
        var lst = bySubj[subj];
        var isBuiltin = !!SUBJECTS[subj];
        var oldDef = CUSTOM[subj] || IMPORTED[subj] || SUBJECTS[subj];
        var box = CUSTOM[subj] ? CUSTOM : IMPORTED;
        var baseItems = (!CUSTOM[subj] && !IMPORTED[subj] && isBuiltin)
          ? (SUBJECTS[subj].items || [])
          : (oldDef ? (oldDef.items || []) : []);
        var baseIds = {}; baseItems.forEach(function (x) { baseIds[x.id] = 1; });
        var newItems = lst.filter(function (o) { return !baseIds[o.rec.id]; }).map(function (o) { return o.rec; });
        if (!newItems.length) return;

        box[subj] = {
          color: (oldDef && oldDef.color) || (SUBJ_COLORS && SUBJ_COLORS[subj]) || (PALETTE && PALETTE[Object.keys(ALL_SUBJECTS).length % PALETTE.length]) || '#3B6D11',
          display: (oldDef && oldDef.display) || subj,
          items: baseItems.concat(newItems)
        };
        added += newItems.length;

        var bm = browseMeta[subj] || (browseMeta[subj] = {});
        lst.forEach(function (o) {
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
    } catch (e) {
      toast('合并失败：' + (e && e.message ? e.message : e));
    } finally {
      updateBadge();
    }
  }

  async function doMerge() {
    var b = elBtn(); if (b) { b.disabled = true; b.textContent = '☁ 拉取中…'; }
    try {
      var list = await fetchCandidates();
      if (!list.length) { toast('没有新的云端入库卡'); updateBadge(); return; }
      openPreview(list);
    } catch (e) {
      toast('拉取失败：' + (e && e.message ? e.message : e));
    } finally {
      if (b) { b.disabled = false; }
      updateBadge();
    }
  }

  function init() {
    var b = elBtn();
    if (!b) return;
    b.addEventListener('click', doMerge);
    updateBadgeBtnText();
  }
  function updateBadgeBtnText() {
    var b = elBtn(); if (!b) return;
    countUnmerged().then(function (n) {
      b.textContent = (n > 0 ? '☁ 云端入库卡 (' + n + ')' : '☁ 云端入库卡');
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
