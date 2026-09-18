/* ============================================================================
 * mc_pending.js  —  三模块共享「待审核记忆卡」组件
 * --------------------------------------------------------------------------
 * 适用：courseware（解题库）/ memory-card（卡片中枢）/ knowledge（胶带知识地图）
 * 作用：把「提交待审卡 → 内联编辑/审核/合并/拒绝 → 入库 cards」的能力抽成
 *       一个自包含脚本，三处 <script src> 引用即可，无需各自抄一遍。
 *
 * 设计要点：
 *  1. 完全自包含。内部函数全部 _mc 前缀，只暴露 window.MC，绝不污染调用方全局。
 *  2. 复用记忆卡 M 库（mixuqjognbdrafrrlivc）同一套 Supabase 配置与传输层，
 *     与已上线的 P2 逻辑逐字对齐（card_id 生成规则、指纹、预筛阈值一致），
 *     保证新写的卡能与线上 cards 表稳定去重。
 *  3. 只嵌入 publishable anon key（与 knowledge 页面同款，安全，非服务端密钥）。
 *     LLM 语义判定仍走你本机 hit_analyze.py，不把 key 写进网页。
 *  4. 云写失败 → 本地 outbox 兜底（mc_pending_outbox_v1），不卡 UI。
 *  5. 去掉执行人维度：系统仅陈昕言一人用，写库不带 executor。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 配置（可被 window.MC_SB_URL/KEY 或 MC.init 覆盖）---------- */
  var DEFAULT_CFG = {
    url: 'https://mixuqjognbdrafrrlivc.supabase.co',
    key: 'sb_publishable_D0ha7g4X4LutG-3hxCguSA_pwyQLrVX',
    reviewer: '陈昕言',        // 审核人默认，可 MC.init 改
    prefilterMatch: 0.55,     // 命中阈值（同 P2）
    prefilterPartial: 0.28    // 部分命中阈值（同 P2）
  };
  var CFG = {
    url: global.MC_SB_URL || DEFAULT_CFG.url,
    key: global.MC_SB_KEY || DEFAULT_CFG.key,
    reviewer: DEFAULT_CFG.reviewer,
    prefilterMatch: DEFAULT_CFG.prefilterMatch,
    prefilterPartial: DEFAULT_CFG.prefilterPartial
  };

  /* ---------------- 表名常量 ------------------------------------------------- */
  var CARDS_TABLE = 'cards';
  var PENDING_TABLE = 'cards_pending';
  var MISTAKES_TABLE = 'mistakes';

  /* ---------------- 传输层（逐字对齐 P2）------------------------------------ */
  function _mcSbBase(u) { return (u || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, ''); }
  function _mcSbHeaders(key, contentType) {
    var h = { 'apikey': key };
    if (typeof key === 'string' && key) h['Authorization'] = 'Bearer ' + key;
    if (contentType) h['Content-Type'] = 'application/json';
    return h;
  }
  function _mcFetchTimeout(url, opts, ms) {
    return new Promise(function (resolve, reject) {
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); reject(new Error('timeout')); }, ms || 9000);
      fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal }))
        .then(function (r) { clearTimeout(timer); resolve(r); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* ---------------- 底层 REST（GET/POST/PATCH）----------------------------- */
  async function _mcSbSelect(table, query) {
    var url = _mcSbBase(CFG.url) + '/rest/v1/' + table + '?' + query;
    var res = await _mcFetchTimeout(url, { method: 'GET', headers: _mcSbHeaders(CFG.key) }, 9000);
    if (!res.ok) throw new Error('GET ' + table + ' ' + res.status);
    return res.json();
  }
  async function _mcSbInsert(table, rows) {
    var url = _mcSbBase(CFG.url) + '/rest/v1/' + table;
    var res = await _mcFetchTimeout(url, {
      method: 'POST',
      headers: Object.assign(_mcSbHeaders(CFG.key, true), { 'Prefer': 'return=representation' }),
      body: JSON.stringify(rows)
    }, 12000);
    if (!res.ok) throw new Error('POST ' + table + ' ' + res.status);
    return res.json();
  }
  async function _mcSbUpdate(table, patch, query) {
    var url = _mcSbBase(CFG.url) + '/rest/v1/' + table + '?' + query;
    var res = await _mcFetchTimeout(url, {
      method: 'PATCH',
      headers: Object.assign(_mcSbHeaders(CFG.key, true), { 'Prefer': 'return=representation' }),
      body: JSON.stringify(patch)
    }, 12000);
    if (!res.ok) throw new Error('PATCH ' + table + ' ' + res.status);
    return res.json();
  }

  /* ---------------- 归一化 / 指纹 / card_id（与 P2 完全一致）---------------- */
  function _mcSha1(str) {
    function utf8Bytes(s){var out=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c<0x80)out.push(c);else if(c<0x800)out.push(0xc0|(c>>6),0x80|(c&0x3f));else if(c>=0xd800&&c<=0xdbff){var c2=s.charCodeAt(++i);var cp=0x10000+((c&0x3ff)<<10)+(c2&0x3ff);out.push(0xf0|(cp>>18),0x80|((cp>>12)&0x3f),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));}else out.push(0xe0|(c>>12),0x80|((c>>6)&0x3f),0x80|(c&0x3f));}return out;}
    var msg=utf8Bytes(str);var H=[0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476,0xC3D2E1F0];var rol=(x,n)=>(x<<n)|(x>>>(32-n));var bitLen=msg.length*8;
    msg.push(0x80);while(msg.length%64!==56)msg.push(0);var hi=Math.floor(bitLen/0x100000000),lo=bitLen>>>0;msg.push((hi>>>24)&0xff,(hi>>>16)&0xff,(hi>>>8)&0xff,hi&0xff,(lo>>>24)&0xff,(lo>>>16)&0xff,(lo>>>8)&0xff,lo&0xff);
    for(var off=0;off<msg.length;off+=64){var w=new Array(80);for(var j=0;j<16;j++)w[j]=(((msg[off+j*4]<<24)|(msg[off+j*4+1]<<16)|(msg[off+j*4+2]<<8)|msg[off+j*4+3])>>>0);for(var j=16;j<80;j++)w[j]=(rol(w[j-3]^w[j-8]^w[j-14]^w[j-16],1))>>>0;var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4];for(var j=0;j<80;j++){var f,k;if(j<20){f=(b&c)|(~b&d);k=0x5A827999;}else if(j<40){f=b^c^d;k=0x6ED9EBA1;}else if(j<60){f=(b&c)|(b&d)|(c&d);k=0x8F1BBCDC;}else{f=b^c^d;k=0xCA62C1D6;}var tmp=(rol(a,5)+f+e+k+w[j])>>>0;e=d;d=c;c=rol(b,30);b=a;a=tmp;}H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;H[4]=(H[4]+e)>>>0;}
    return H.map(function(h){return ('00000000'+(h>>>0).toString(16)).slice(-8);}).join('');
  }
  function _mcNormCard(text) {
    if (!text) return '';
    var t = String(text).toLowerCase();
    t = t.replace(/[\s ]+/g, '');
    t = t.replace(/[，。、；：？！,.!?;:'"“”‘’()（）\[\]【】{}<>《》/\-—_=+*%#@^~`|\\]/g, '');
    return t;
  }
  function _mcCardIdOf(subj, s, c) { return subj + '_' + _mcSha1(subj + '|' + _mcNormCard(s) + '|' + _mcNormCard(c)).slice(0, 10); }
  function _mcNormText(s, c) { return _mcNormCard(s) + '|' + _mcNormCard(c); }
  function _mcBigrams(str) {
    var g = new Set(); str = String(str || '');
    for (var i = 0; i < str.length - 1; i++) g.add(str.substr(i, 2));
    return g;
  }
  function _mcJaccard(a, b) {
    var A = _mcBigrams(a), B = _mcBigrams(b);
    if (!A.size || !B.size) return 0;
    var inter = 0; A.forEach(function (x) { if (B.has(x)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  /* ---------------- 本地 outbox（云写失败兜底）----------------------------- */
  var OUTBOX_KEY = 'mc_pending_outbox_v1';
  function _mcOutboxLoad() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; } }
  function _mcOutboxSave(a) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(a)); } catch (e) {} }
  async function _mcCloudWrite(table, row) {
    if (!CFG.url || !CFG.key) { var b = _mcOutboxLoad(); b.push({ table: table, row: row }); _mcOutboxSave(b); return null; }
    try { var ins = await _mcSbInsert(table, [row]); return (ins && ins[0]) ? ins[0] : row; }
    catch (e) { console.warn('[mc_pending] write ' + table + ' failed, queue:', e); var b2 = _mcOutboxLoad(); b2.push({ table: table, row: row }); _mcOutboxSave(b2); return null; }
  }
  async function _mcFlushOutbox() {
    var box = _mcOutboxLoad(); if (!box.length) return;
    var remain = [];
    for (var i = 0; i < box.length; i++) { try { await _mcSbInsert(box[i].table, [box[i].row]); } catch (e) { remain.push(box[i]); } }
    _mcOutboxSave(remain);
    if (box.length - remain.length > 0) MC.toast('已补传 ' + (box.length - remain.length) + ' 条待审数据');
  }

  /* ---------------- 指纹预筛（离线可用，不暴露 key）------------------------ */
  async function preFilterHit(subj, s, c) {
    var cards = [];
    try { cards = await _mcSbSelect(CARDS_TABLE, 'subject=eq.' + encodeURIComponent(subj) + '&select=card_id,signal,conclusion,fingerprint'); }
    catch (e) { cards = []; }
    var txt = _mcNormText(s, c), best = null, bestScore = 0;
    (cards || []).forEach(function (r) {
      var fp = _mcNormText(r.signal, r.conclusion);
      var sc = _mcJaccard(txt, fp);
      if (sc > bestScore) { bestScore = sc; best = r; }
    });
    return { card: best, score: bestScore };
  }

  /* ---------------- 提交待审卡（写 cards_pending）-------------------------- */
  // opts: {subject, chapter, signal, conclusion, sourceModule, sourceType, sourceId, tags, orig, link}
  async function propose(opts) {
    if (!opts || !opts.subject || !opts.signal || !opts.conclusion) throw new Error('propose 缺少 subject/signal/conclusion');
    var hit = await preFilterHit(opts.subject, opts.signal, opts.conclusion);
    var verdict = 'new', hitCardId = '';
    if (hit.score >= CFG.prefilterMatch) { verdict = 'matched'; hitCardId = hit.card.card_id; }
    else if (hit.score >= CFG.prefilterPartial) { verdict = 'partial'; hitCardId = hit.card.card_id; }
    var row = {
      subject: opts.subject,
      chapter: opts.chapter || '',
      signal: opts.signal,
      conclusion: opts.conclusion,
      src: opts.src || '',
      orig: opts.orig || '',
      link: opts.link || '',
      source_module: opts.sourceModule || '',   // courseware / memory-card / knowledge
      source_type: opts.sourceType || 'manual', // lesson / mistake / tape / manual
      source_id: opts.sourceId || '',
      tags: Array.isArray(opts.tags) ? opts.tags : (opts.tags ? [opts.tags] : []),
      fingerprint: _mcNormText(opts.signal, opts.conclusion),
      payload: {
        prefilter_score: hit.score,
        prefilter_card: hit.card ? hit.card.card_id : '',
        prefilter_verdict: verdict
      },
      review_status: 'pending',
      created_at: new Date().toISOString()
    };
    var ins = await _mcCloudWrite(PENDING_TABLE, row);
    // 云写失败（离线 / RLS / 列缺失等）时 _mcCloudWrite 已把数据兜底进 outbox，
    // 但必须显式抛出，否则调用方拿到「没有 id 的本地对象」会静默假成功（编辑保存不下来），
    // 且后续 approvePending 会因 id=undefined 拼出 id=eq.undefined 而 400 失败。
    if (!ins) throw new Error('云端写入未成功（已缓存本地，联网后自动补传）');
    return ins;
  }

  /* ---------------- 审核动作（通过入库 / 合并 / 拒绝 / 编辑）--------------- */
  async function approvePending(p, targetCardId) {
    var cid = targetCardId || _mcCardIdOf(p.subject, p.signal, p.conclusion);
    /* 2026-09-18 修复（用户反馈"报告页显示已入库却搜不到"）：homework 来源的卡审核通过时
       自动打 hw-train 标签——否则卡只落云端、不进训练队列，本地 seed 注入也不会带上它，
       专题练搜索/日期筛选都找不到，必须手动「☁ 云端入库卡」合并。 */
    var tgs = Array.isArray(p.tags) ? p.tags.slice() : [];
    if ((p.source_module || '') === 'homework' && tgs.indexOf('hw-train') < 0) tgs.push('hw-train');
    await _mcCloudWrite(CARDS_TABLE, {
      card_id: cid, subject: p.subject, chapter: p.chapter || '', signal: p.signal, conclusion: p.conclusion,
      src: p.src || '', orig: p.orig || '', link: p.link || '', status: 'active',
      source_module: p.source_module || '', source_type: p.source_type || 'manual', source_id: p.source_id || String(p.id || ''),
      tags: tgs,
      fingerprint: _mcNormText(p.signal, p.conclusion), updated_at: new Date().toISOString()
    });
    if (p.source_type === 'mistake' && p.source_id) {
      try { await _mcSbUpdate(MISTAKES_TABLE, { hit_card_id: cid, hit_verdict: 'matched' }, 'mistake_id=eq.' + encodeURIComponent(p.source_id)); } catch (e) { console.warn('[mc_pending] backfill mistake failed', e); }
    }
    await _mcSbUpdate(PENDING_TABLE, { review_status: 'approved', reviewer: CFG.reviewer, reviewed_at: new Date().toISOString(), card_id: cid }, 'id=eq.' + p.id);
    return cid;
  }
  async function mergePending(p, targetCardId) {
    if (!targetCardId) throw new Error('merge 需要目标 card_id');
    if (p.source_type === 'mistake' && p.source_id) {
      try { await _mcSbUpdate(MISTAKES_TABLE, { hit_card_id: targetCardId, hit_verdict: 'partial' }, 'mistake_id=eq.' + encodeURIComponent(p.source_id)); } catch (e) {}
    }
    await _mcSbUpdate(PENDING_TABLE, { review_status: 'approved', reviewer: CFG.reviewer, reviewed_at: new Date().toISOString(), card_id: targetCardId }, 'id=eq.' + p.id);
  }
  async function rejectPending(p) {
    await _mcSbUpdate(PENDING_TABLE, { review_status: 'rejected', reviewer: CFG.reviewer, reviewed_at: new Date().toISOString() }, 'id=eq.' + p.id);
  }
  async function patchPending(id, patch) {
    if (patch.signal !== undefined || patch.conclusion !== undefined) {
      patch.fingerprint = _mcNormText(patch.signal !== undefined ? patch.signal : '', patch.conclusion !== undefined ? patch.conclusion : '');
    }
    await _mcSbUpdate(PENDING_TABLE, patch, 'id=eq.' + id);
  }
  async function fetchPending(filter) {
    filter = filter || {};
    var q = 'order=created_at.desc';
    if (filter.reviewStatus) q = 'review_status=eq.' + encodeURIComponent(filter.reviewStatus) + '&' + q;
    if (filter.sourceModule) q = 'source_module=eq.' + encodeURIComponent(filter.sourceModule) + '&' + q;
    if (filter.sourceType) q = 'source_type=eq.' + encodeURIComponent(filter.sourceType) + '&' + q;
    if (filter.subject) q = 'subject=eq.' + encodeURIComponent(filter.subject) + '&' + q;
    if (filter.sourceId) q = 'source_id=eq.' + encodeURIComponent(filter.sourceId) + '&' + q;
    if (filter.limit) q += '&limit=' + filter.limit;
    return _mcSbSelect(PENDING_TABLE, q);
  }

  /* ---------------- UI：轻量 toast + 弹窗样式（只注入一次）----------------- */
  var _mcStyleInjected = false;
  function _mcInjectStyle() {
    if (_mcStyleInjected) return; _mcStyleInjected = true;
    var css = '' +
      '.mc-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.25)}' +
      '.mc-pcard{display:flex;align-items:stretch;gap:10px;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:8px 0;background:#fff}' +
      '.mc-pcard-body{flex:1;min-width:0}' +
      '.mc-pcard-signal{font-size:13px;color:#111827;margin-bottom:3px}' +
      '.mc-pcard-signal b{color:#6d28d9}' +
      '.mc-pcard-concl{font-size:13px;color:#374151;margin-bottom:4px}' +
      '.mc-pcard-meta{font-size:11px;color:#9ca3af}' +
      '.mc-pcard-actions{display:flex;flex-direction:column;gap:6px;justify-content:center;flex:0 0 auto}' +
      '.mc-btn{border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}' +
      '.mc-btn-edit{background:#eef2ff;color:#4338ca}' +
      '.mc-btn-review{background:#dcfce7;color:#166534}' +
      '.mc-btn-pass{background:#16a34a;color:#fff}' +
      '.mc-btn-merge{background:#fef3c7;color:#92400e}' +
      '.mc-pcard-actions .mc-sel{flex:1;min-width:0;font-size:12.5px;padding:4px 6px;border:1px solid #d1d5db;border-radius:8px}' +
      '.mc-btn-reject{background:#fee2e2;color:#991b1b}' +
      '.mc-btn-cancel{background:#f3f4f6;color:#374151}' +
      '.mc-hit{display:inline-flex;align-items:center;gap:6px;border:1px solid #d1fae5;background:#ecfdf5;color:#065f46;border-radius:10px;padding:6px 10px;margin:6px 0;font-size:12px}' +
      '.mc-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:99998}' +
      '.mc-modal{background:#fff;border-radius:14px;padding:18px;width:min(520px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.3)}' +
      '.mc-modal h4{margin:0 0 10px;font-size:15px;color:#111827}' +
      '.mc-modal label{display:block;font-size:12px;color:#6b7280;margin:8px 0 4px}' +
      '.mc-modal textarea{width:100%;min-height:64px;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box;resize:vertical}' +
      '.mc-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }
  var _mcToastTimer = null;
  function toast(msg) {
    _mcInjectStyle();
    var el = document.querySelector('.mc-toast');
    if (!el) { el = document.createElement('div'); el.className = 'mc-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    if (_mcToastTimer) clearTimeout(_mcToastTimer);
    _mcToastTimer = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2200);
  }
  function _mcEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  /* ---------------- UI：渲染命中卡（只读，courseware 每题下方用）------------ */
  function renderHitCard(container, card) {
    _mcInjectStyle();
    var div = document.createElement('div');
    div.className = 'mc-hit';
    div.innerHTML = '✅ 命中已有卡 <code>' + _mcEsc(card.card_id) + '</code> · <b>' + _mcEsc(card.signal) + '</b> → ' + _mcEsc(card.conclusion);
    container.appendChild(div);
  }

  /* ---------------- UI：渲染待审候选卡 + 右侧 编辑/审核 --------------------- */
  // row: cards_pending 一行（含 id/subject/signal/conclusion/source_module/source_type/tags/payload）
  // opts: { onDone: fn(), compact: bool }
  function renderReviewCard(container, row, opts) {
    opts = opts || {};
    _mcInjectStyle();
    var card = document.createElement('div');
    card.className = 'mc-pcard';
    var tags = Array.isArray(row.tags) ? row.tags.join(' #') : '';
    var meta = [];
    if (row.source_module) meta.push('模块:' + row.source_module);
    if (row.source_type) meta.push('类型:' + row.source_type);
    var pf = row.payload && row.payload.prefilter_score != null ? (' · 预筛:' + row.payload.prefilter_score.toFixed(2) + (row.payload.prefilter_card ? '→' + row.payload.prefilter_card : '')) : '';
    card.innerHTML =
      '<div class="mc-pcard-body">' +
        '<div class="mc-pcard-signal"><b>信号：</b>' + _mcEsc(row.signal) + '</div>' +
        '<div class="mc-pcard-concl"><b>结论：</b>' + _mcEsc(row.conclusion) + '</div>' +
        '<div class="mc-pcard-meta">' + _mcEsc(meta.join(' · ')) + (tags ? ' · #' + _mcEsc(tags) : '') + _mcEsc(pf) + '</div>' +
      '</div>' +
      '<div class="mc-pcard-actions">' +
        '<button class="mc-btn mc-btn-edit" data-act="edit">编辑</button>' +
        '<button class="mc-btn mc-btn-review" data-act="review">审核</button>' +
      '</div>';
    container.appendChild(card);

    card.querySelector('[data-act="edit"]').addEventListener('click', function () { _mcOpenEditModal(row, opts); });
    card.querySelector('[data-act="review"]').addEventListener('click', function () { _mcShowReviewMenu(card, row, opts); });
    return card;
  }

  function _mcOpenEditModal(row, opts) {
    _mcInjectStyle();
    var mask = document.createElement('div'); mask.className = 'mc-modal-mask';
    mask.innerHTML =
      '<div class="mc-modal">' +
        '<h4>编辑待审卡</h4>' +
        '<label>信号 signal</label><textarea id="mcEditSig">' + _mcEsc(row.signal) + '</textarea>' +
        '<label>结论 conclusion</label><textarea id="mcEditCon">' + _mcEsc(row.conclusion) + '</textarea>' +
        '<div class="mc-modal-actions">' +
          '<button class="mc-btn mc-btn-cancel" data-x="cancel">取消</button>' +
          '<button class="mc-btn mc-btn-pass" data-x="save">保存</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);
    mask.querySelector('[data-x="cancel"]').addEventListener('click', function () { document.body.removeChild(mask); });
    mask.querySelector('[data-x="save"]').addEventListener('click', async function () {
      var sig = mask.querySelector('#mcEditSig').value.trim();
      var con = mask.querySelector('#mcEditCon').value.trim();
      if (!sig || !con) { toast('信号与结论均不能为空'); return; }
      try {
        await patchPending(row.id, { signal: sig, conclusion: con });
        row.signal = sig; row.conclusion = con;
        toast('已保存');
        document.body.removeChild(mask);
        if (opts.onDone) opts.onDone();
      } catch (e) { toast('保存失败：' + e.message); }
    });
  }

  function _mcShowReviewMenu(card, row, opts) {
    var act = card.querySelector('.mc-pcard-actions');
    var sug = opts && Array.isArray(opts.suggestCards) ? opts.suggestCards : null;
    act.innerHTML =
      '<button class="mc-btn mc-btn-pass" data-r="pass">通过入库</button>' +
      (sug && !sug.length ? '' : '<button class="mc-btn mc-btn-merge" data-r="merge">合并</button>') +
      '<button class="mc-btn mc-btn-reject" data-r="reject">拒绝</button>' +
      '<button class="mc-btn mc-btn-cancel" data-r="cancel">取消</button>' +
      (sug && !sug.length ? '<div style="flex-basis:100%;font-size:11.5px;color:#9ca3af;margin-top:4px">本题无库存命中卡，基本不会重复 → 建议「通过入库」</div>' : '');
    act.querySelector('[data-r="cancel"]').addEventListener('click', function () { if (opts.onDone) opts.onDone(); });
    act.querySelector('[data-r="pass"]').addEventListener('click', async function () {
      try { var cid = await approvePending(row); toast('已入库 ' + cid); if (opts.onDone) opts.onDone(); }
      catch (e) { toast('入库失败：' + e.message); }
    });
    act.querySelector('[data-r="reject"]').addEventListener('click', async function () {
      try { await rejectPending(row); toast('已拒绝'); if (opts.onDone) opts.onDone(); }
      catch (e) { toast('拒绝失败：' + e.message); }
    });
    var mergeBtn = act.querySelector('[data-r="merge"]');
    if (mergeBtn) mergeBtn.addEventListener('click', async function () {
      if (sug && sug.length) {
        // 有候选卡（本题契合分析命中卡）：下拉选择，免手输 card_id
        act.innerHTML =
          '<select class="mc-sel" id="mcMergeSel">' +
          sug.map(function (s) { return '<option value="' + _mcEsc(s.card_id) + '">' + _mcEsc(s.label || s.card_id) + '</option>'; }).join('') +
          '</select>' +
          '<button class="mc-btn mc-btn-merge" data-r="domerge">确认合并</button>' +
          '<button class="mc-btn mc-btn-cancel" data-r="cx">取消</button>';
        act.querySelector('[data-r="cx"]').addEventListener('click', function () { if (opts.onDone) opts.onDone(); });
        act.querySelector('[data-r="domerge"]').addEventListener('click', async function () {
          var target = act.querySelector('#mcMergeSel').value;
          try { await mergePending(row, target); toast('已合并到 ' + target); if (opts.onDone) opts.onDone(); }
          catch (e) { toast('合并失败：' + e.message); }
        });
        return;
      }
      var def = (row.payload && row.payload.prefilter_card) ? row.payload.prefilter_card : '';
      var target = window.prompt('合并到已有卡的 card_id（默认预筛命中）：', def);
      if (!target) return;
      try { await mergePending(row, target.trim()); toast('已合并到 ' + target.trim()); if (opts.onDone) opts.onDone(); }
      catch (e) { toast('合并失败：' + e.message); }
    });
  }

  /* ---------------- UI：内联审核面板（按过滤条件拉取并渲染）---------------- */
  // mount(container, filterObj, opts)  —— memory-card 错题页 / knowledge 易错栏目 用
  async function mountPanel(container, filter, opts) {
    opts = opts || {};
    container.innerHTML = '<div style="padding:14px;color:#9ca3af;font-size:13px">加载待审卡…</div>';
    var rows = [];
    try { rows = await fetchPending(filter); } catch (e) { rows = []; }
    if (!rows.length) { container.innerHTML = opts.emptyText ? '<div style="padding:14px;color:#9ca3af;font-size:13px">' + _mcEsc(opts.emptyText) + '</div>' : ''; return; }
    container.innerHTML = '';
    rows.forEach(function (r) { renderReviewCard(container, r, { onDone: opts.onDone || function () { mountPanel(container, filter, opts); } }); });
  }

  /* ---------------- 对外暴露 ------------------------------------------------- */
  var MC = {
    init: function (o) { if (o && o.url) CFG.url = o.url; if (o && o.key) CFG.key = o.key; if (o && o.reviewer) CFG.reviewer = o.reviewer; if (o && o.prefilterMatch) CFG.prefilterMatch = o.prefilterMatch; if (o && o.prefilterPartial) CFG.prefilterPartial = o.prefilterPartial; },
    config: CFG,
    tables: { cards: CARDS_TABLE, pending: PENDING_TABLE, mistakes: MISTAKES_TABLE },
    // 底层（高级用法）
    select: _mcSbSelect, insert: _mcSbInsert, update: _mcSbUpdate,
    cardIdOf: _mcCardIdOf, normCard: _mcNormCard, normText: _mcNormText,
    flushOutbox: _mcFlushOutbox,
    // 业务 API
    preFilterHit: preFilterHit,
    propose: propose,
    approvePending: approvePending,
    mergePending: mergePending,
    rejectPending: rejectPending,
    patchPending: patchPending,
    fetchPending: fetchPending,
    // UI
    toast: toast,
    renderHitCard: renderHitCard,
    renderReviewCard: renderReviewCard,
    mountPanel: mountPanel
  };
  global.MC = MC;

  // 启动即尝试补传 outbox（联网后自动把兜底数据推上云）
  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(_mcFlushOutbox, 1500);
    else window.addEventListener('DOMContentLoaded', function () { setTimeout(_mcFlushOutbox, 1500); });
  }
})(typeof window !== 'undefined' ? window : this);
