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

  // 判断某卡是否已在本地任意科目库（避免重复并入）
  function idExists(id) {
    var names = Object.keys(SUBJECTS).concat(Object.keys(IMPORTED)).concat(Object.keys(CUSTOM));
    for (var i = 0; i < names.length; i++) {
      var def = CUSTOM[names[i]] || IMPORTED[names[i]] || SUBJECTS[names[i]];
      if (def && def.items && def.items.some(function (x) { return x.id === id; })) return true;
    }
    return false;
  }

  /* 本地卡 id 全集 —— 一次构建，供批量判重
   * ⚠️ 为什么不能只比云端 card_id：本地卡 id 会在每次页面加载时被 index.html 的
   *    applyStableIds() 统一改写成「稳定指纹 id」（cardIdOf = 科目_sha1(科目|信号|结论)[0:10]），
   *    而知识页入库写入的云端 card_id 是入库时另算的（形如 化学_090073ae56）。
   *    合并后下一次刷新 id 就变了 → 只比云端 id 会「永远认为没并入过」。
   *    故这里同时收录「当前 id」，判重时再按指纹 id 兜底（见 isLocal）。 */
  function localIdSet() {
    var set = new Set();
    var names = Object.keys(SUBJECTS).concat(Object.keys(IMPORTED)).concat(Object.keys(CUSTOM));
    names.forEach(function (n) {
      var def = CUSTOM[n] || IMPORTED[n] || SUBJECTS[n];
      if (!def || !def.items) return;
      def.items.forEach(function (x) { if (x && x.id) set.add(x.id); });
    });
    return set;
  }
  /* 调页面同款算法算稳定指纹 id（拿不到就返回 null，退化为只比云端 id） */
  function fingerprintOf(subj, s, c) {
    try { return (typeof cardIdOf === 'function') ? cardIdOf(subj || '', s || '', c || '') : null; }
    catch (e) { return null; }
  }
  /* 是否已在本机：先比云端 id，再比指纹 id */
  function isLocal(set, id, subj, s, c) {
    if (set.has(id)) return true;
    var fp = fingerprintOf(subj, s, c);
    return !!(fp && set.has(fp));
  }

  /* 来源白名单：只认三大模块「真正产出」的新卡
   *   knowledge  = 胶带知识地图（易错点审核入库）
   *   courseware = 解题库（批改作业 / 难题）
   *
   * ⚠️ 曾经的坑（2026-09-17 修复）：原条件写的是 `source_module=not.is.null`，但
   *    本地库镜像到 cards 表的卡（memory-card 自身，见 index.html mirrorCardsToCloud）
   *    写入时没给 source_module 赋值 → 数据库存成【空字符串 ''】而非 NULL。
   *    PostgREST 的 `not.is.null` 只排除真正的 NULL，排不掉空串 →
   *    整个 6000+ 行镜像库全被当成"待入库卡"，
   *    又撞上 PostgREST 默认 max-rows=1000 截断 → 角标恒定显示 (1000)。
   *    改为来源白名单后，语义精确，角标 = 真实待合并数（当时为 4）。
   *
   * v3（2026-09-17）：
   *   ① 角标修了、但「预览核对」弹窗仍列 1000 张 —— 因为 fetchCandidates() 那一处
   *      漏改，还在用旧的 not.is.null。本次两处统一走 P3_SRC_FILTER。
   *   ② 判重加「指纹 id」兜底：合并后本地卡 id 会被改写成指纹 id，只比云端 id 会导致
   *      同一批卡每次刷新都重新冒出来。
   */
  // 来源白名单：knowledge / courseware / homework 三大模块写入 M 库 cards 表的卡都纳入「云端入库卡」计数与合并。
  // ⚠️ 2026-09-18 修复：原先只含 (knowledge,courseware)，把作业批改「通过入库」写入的 homework 卡整体排除，
  //    导致作业报告里加的卡在记忆卡 App 角标/合并里看不见（角标只显示其他模块的待合并数）。补入 homework。
  var P3_SRC_FILTER = 'source_module=in.(knowledge,courseware,homework)';

  // 统计尚未并入的云端卡数量（页面加载时刷新角标）
  async function countUnmerged() {
    try {
      var rows = await sbSelect('cards', P3_SRC_FILTER + '&status=eq.active&select=card_id,subject,signal,conclusion&limit=5000');
      var set = localIdSet(), n = 0;
      (rows || []).forEach(function (r) { if (!isLocal(set, r.card_id, r.subject, r.signal, r.conclusion)) n++; });
      return n;
    } catch (e) { return -1; }
  }

  function setMergeLabel(b, n) {
    if (!b) return;
    b.textContent = (n > 0 ? '☁ 云端入库卡 (' + n + ')' : '☁ 云端入库卡');
  }
  async function updateBadge() {
    var n = await countUnmerged();
    setMergeLabel(elBtn(), n);
    setMergeLabel(document.getElementById('dashCloudMergeBtn'), n); /* 首页看板按钮同步角标 */
  }

  /* 云端行 → 本地候选列表（去重 + 转成本地 rec，带上 subject）
   * 并入时把本地 id 直接定为「指纹 id」（见 commit），与 applyStableIds 保持一致。 */
  function rowsToList(rows, hasNote) {
    var list = [], seen = new Set(), set = localIdSet();
    (rows || []).forEach(function (r) {
      if (!r.subject || !r.card_id) return;
      if (isLocal(set, r.card_id, r.subject, r.signal, r.conclusion) || seen.has(r.card_id)) return;
      seen.add(r.card_id);
      var localId = fingerprintOf(r.subject, r.signal, r.conclusion) || r.card_id;
      list.push({
        card_id: r.card_id,
        local_id: localId,
        subject: r.subject,
        ts: Date.parse(r.created_at) || Date.now(),
        rec: {
          id: localId,
          t: r.chapter || '未分类',
          s: r.signal || '',
          c: r.conclusion || '',
          src: r.src || '',
          link: r.link || '',
          orig: r.orig || '',
          no: hasNote ? (r.no || '') : '',
          note: hasNote ? (r.note || '') : '',
          tags: Array.isArray(r.tags) ? r.tags : [],
          status: 0
        }
      });
    });
    return list;
  }

  /* 取待合并候选（手动「☁ 云端入库卡」用，弹预览核对） */
  async function fetchCandidates() {
    /* no/note 两列是后补的（add_cards_no_note.sql），执行前选择投影里不能含它们，否则整条查询 400。
     * 故先探测列是否存在，再决定 select 是否追加 no,note（与 index.html 的 cardsHasNoteCols 同源）。 */
    var hasNote = false;
    try { hasNote = !!(typeof cardsHasNoteCols === 'function' && (await cardsHasNoteCols())); } catch (e) { hasNote = false; }
    var sel = 'card_id,subject,chapter,signal,conclusion,src,link,orig,tags,source_module,source_type,source_id,status,created_at' + (hasNote ? ',no,note' : '');
    var rows = await sbSelect('cards',
      P3_SRC_FILTER + '&status=eq.active' +
      '&select=' + encodeURIComponent(sel) +
      '&limit=5000');
    return rowsToList(rows, hasNote);
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
        (c.no ? '<div class="row"><span class="lbl">编号</span>' + esc(c.no) + '</div>' : '') +
        (c.note ? '<div class="row"><span class="lbl">备注</span>' + esc(c.note) + '</div>' : '') +
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
  // opts.silent=true：自动同步调用，跳过「未选择/没有新的」提示，仅在真正并入时轻提示
  async function commit(sel, opts) {
    opts = opts || {};
    if (!sel || !sel.length) { if (!opts.silent) toast('未选择任何卡片'); updateBadge(); return; }
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
          /* 2026-09-18 修复：浏览时间改为「合并时刻」而非云端 created_at——
             与用户指定机制一致（入库/加入=最近浏览时间=当下），否则按今天筛日期永远漏掉刚合并的卡 */
          m.lastBrowse = Date.now();
          browseHistory.unshift({ ts: Date.now(), id: o.rec.id, mode: '入库', subject: subj, src: o.rec.src || '', t: o.rec.t || '' });
        });
      });
      if (browseHistory.length > 500) browseHistory.length = 500;

      if (added > 0) {
        /* 2026-09-18 修复：savePerson 抛异常（典型为 localStorage 5MB 配额满）时，
            原实现整体进 catch → toast 一闪而过、数据实际没保存 → 表现为「确认合并了但回头还在」。
            现在单独兜底：主保存失败 → 退级只写两张卡库键 → 再失败才报错并明示「未保存」。 */
        var savedOk = true, saveErr = null;
        try { savePerson(); }
        catch (e1) {
          savedOk = false;
          try {
            saveJ(CARDS_IMPORTED_KEY, IMPORTED);
            saveJ(CARDS_CUSTOM_KEY, CUSTOM);
            savedOk = true;   /* 卡库已保住（进度/浏览历史本轮未存，下次打卡会再存） */
          } catch (e2) { saveErr = e2; }
        }
        afterCardChange();
        if (savedOk) {
          if (opts.silent) toast('🔄 自动并入 ' + added + ' 张新卡（来自其他设备/模块）');
          else toast('已合并 ' + added + ' 张云端入库卡 · 浏览时间=此刻（今天日期可直接筛出）');
        } else {
          toast('⚠️ 合并 ' + added + ' 张完成，但本地保存失败（存储空间不足），刷新后会丢——请先清理备份快照再试');
          console.error('[cloudMerge] 本地保存失败：', saveErr);
        }
      } else {
        if (!opts.silent) toast('没有新的云端入库卡');
      }
    } catch (e) {
      if (!opts.silent) toast('合并失败：' + (e && e.message ? e.message : e));
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

  /* ---------- Phase 4：自动同步（代替手动 p3 合并，跨设备/模块实时顺畅） ----------
   * 思路：云端 cards 表为唯一真源；本机用「水印」增量拉取新卡并自动并入本地 + 写浏览时间，
   *       不再依赖人工点「☁ 云端入库卡」。首次启用水印=此刻（不回填历史全库，避免一次性灌入），
   *       之后只拉 created_at>水印 的新卡；离线期间 A 生成的卡，B 上线后也会自动补齐。
   * 这是「pull 模型」的自动版：每台设备定时自取，B 无需任何动作即能看到 A 的卡。
   * （相比 supabase Realtime，delta 轮询更稳、egress 远低于现状 60s 全表轮询，且不依赖 WebSocket。） */
  var WM_KEY = 'p3_autosync_watermark';
  var AUTO_MS = 30000;

  async function autoSyncOnce() {
    var wm = parseInt(localStorage.getItem(WM_KEY) || '0', 10);
    if (!wm) { wm = Date.now(); localStorage.setItem(WM_KEY, String(wm)); } // 首次：从此刻起，不回填历史
    var since = new Date(wm - 2000).toISOString();
    try {
      var hasNote = !!(typeof cardsHasNoteCols === 'function' && (await cardsHasNoteCols()));
      var sel = 'card_id,subject,chapter,signal,conclusion,src,link,orig,tags,source_module,source_type,source_id,status,created_at' + (hasNote ? ',no,note' : '');
      var rows = await sbSelect('cards',
        P3_SRC_FILTER + '&status=eq.active&created_at=gte.' + encodeURIComponent(since) +
        '&select=' + encodeURIComponent(sel) + '&order=created_at.asc&limit=5000');
      var list = rowsToList(rows, hasNote);
      if (list.length) { await commit(list, { silent: true }); }
    } catch (e) {
      /* 静默：自动同步失败不影响手动合并与常规使用 */
    }
    localStorage.setItem(WM_KEY, String(Date.now()));
  }

  function init() {
    var b = elBtn();
    if (b) { b.addEventListener('click', doMerge); }
    updateBadgeBtnText();
    /* 启动自动同步：首次延迟 3s（等本地库加载完），之后每 30s 增量拉取 */
    setTimeout(autoSyncOnce, 3000);
    setInterval(autoSyncOnce, AUTO_MS);
  }
  function updateBadgeBtnText() {
    updateBadge();
  }

  /* 对外暴露（供 phase4_links_reviews.js / 其他模块复用） */
  window.P3Merge = { commit: commit, fetchCandidates: fetchCandidates, autoSyncOnce: autoSyncOnce, rowsToList: rowsToList };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
