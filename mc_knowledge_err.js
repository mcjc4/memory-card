/* mc_knowledge_err.js —— 知识地图（胶带版）易错栏目内联「编辑 / 审核」
 * 职责：扫描每页 .err-item，右侧挂【编辑】【审核】按钮；
 *   - 编辑：弹窗改 signal/conclusion/tags → 新卡直写 cards（autoIngest），旧待审行仍 patch
 *   - 审核：直接入库（autoIngest 进 cards，去 cards_pending 闸门，决策#3：受信模块全自动入库）
 * 全部经 window.MC（mc_pending.js）写入同一 M 库，source_module='knowledge' source_type='tape'。
 * 依赖：先于本脚本加载 ../mc_pending.js（MC 命名空间）。
 *
 * 字段填充（P3-5 补强）：
 *   - src 出处   = '胶带知识地图 · {subject} · {chapter}（{page}）'
 *   - link       = 当前页 URL（点「原题链接」可回看知识页），orig = 该易错点原文
 *   - tags 标签  = k-meta.methods ∪ {#易错}，并继承 k-meta.tags 中的知识点标签
 *   - source_id  = fig::idx（恒为真实来源标识，不再写成 pending 行 id）
 */
(function () {
  'use strict';
  if (!window.MC) { console.error('[k-err] MC 组件未加载，请先引入 mc_pending.js'); return; }

  // 读 k-meta（subject / chapter / fig / page / points / methods / tags / date）
  var meta = {};
  try { var km = document.getElementById('k-meta'); if (km) meta = JSON.parse(km.textContent); } catch (e) { meta = {}; }
  var SUBJECT = meta.subject || '';
  var CHAPTER = meta.chapter || '';
  var FIG = meta.fig || (location.pathname.split('/').pop().replace(/\.html$/, ''));
  var PAGE = meta.page || '';
  var METHODS = Array.isArray(meta.methods) ? meta.methods : [];
  var KM_TAGS = Array.isArray(meta.tags) ? meta.tags : [];
  var SRC_MOD = 'knowledge';
  var SRC_TYP = 'tape';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
    });
  }
  function dedupe(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (x) { var k = String(x).trim(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }
  // 该页统一出处（每页只算一次，随 idx 拼锚点用不到，link 用页面 URL）
  var SRC = '胶带知识地图 · ' + SUBJECT + ' · ' + CHAPTER + (PAGE ? '（' + PAGE + '）' : '');
  var BASE_URL = (location.href.split('#')[0]);

  function parseItem(p) {
    var b = p.querySelector('b');
    var signal = b ? b.textContent.trim().replace(/[：:]\s*$/, '') : (p.textContent.trim().split(/[：:]/)[0] || '');
    var conclusion = p.textContent.trim();
    return { signal: signal, conclusion: conclusion };
  }
  function statusOf(rows) {
    if (!rows || !rows.length) return { state: 'none', row: null };
    var approved = rows.filter(function (r) { return r.review_status === 'approved'; })[0];
    if (approved) return { state: 'approved', row: approved };
    return { state: 'pending', row: rows[0] };
  }

  // 构造一条易错点的 propose 元数据（src/link/orig/tags 一并带上）
  function metaFor(d) {
    return {
      src: SRC,
      link: BASE_URL,
      orig: d.orig || '',
      tags: dedupe(METHODS.concat(KM_TAGS).concat(['#易错']))
    };
  }

  // 决策#3：知识地图为受信模块 → 卡直写 cards（去 cards_pending 闸门）。用 source_id 查 cards 判「已入库」
  async function cardRow(d) {
    try { var rows = await MC.select('cards', 'source_id=eq.' + encodeURIComponent(d.sourceId) + '&select=card_id&limit=1'); return (rows && rows[0]) || null; }
    catch (e) { return null; }
  }
  async function refresh(actions, d) {
    var card = await cardRow(d);
    if (card) {
      var b0 = document.createElement('span');
      b0.style.cssText = 'font-size:12px;color:#166534;background:#dcfce7;border:1px solid #bbf7d0;border-radius:8px;padding:4px 8px;white-space:nowrap';
      b0.textContent = '✅ 已入库 ' + (card.card_id || '');
      actions.innerHTML = ''; actions.appendChild(b0);
      return;
    }
    var rows = [];
    try { rows = await MC.fetchPending({ sourceId: d.sourceId }); } catch (e) { rows = []; }
    var st = statusOf(rows);
    actions.innerHTML = '';
    if (st.state === 'approved') {
      var badge = document.createElement('span');
      badge.style.cssText = 'font-size:12px;color:#166534;background:#dcfce7;border:1px solid #bbf7d0;border-radius:8px;padding:4px 8px;white-space:nowrap';
      badge.textContent = '✅ 已入库 ' + (st.row.card_id || '');
      actions.appendChild(badge);
      return;
    }
    var editBtn = document.createElement('button');
    editBtn.textContent = '编辑';
    editBtn.style.cssText = 'border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:#eef2ff;color:#4338ca';
    var revBtn = document.createElement('button');
    revBtn.textContent = '审核';
    revBtn.style.cssText = 'border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:#dcfce7;color:#166534';
    actions.appendChild(editBtn); actions.appendChild(revBtn);
    editBtn.addEventListener('click', function () { openEdit(actions, d, st.row); });
    revBtn.addEventListener('click', function () { openReview(actions, d, st.row); });
  }

  function openEdit(actions, d, existingRow) {
    var curSig = existingRow ? existingRow.signal : d.signal;
    var curCon = existingRow ? existingRow.conclusion : d.conclusion;
    var curTags = existingRow && Array.isArray(existingRow.tags) ? existingRow.tags.join(' ') : metaFor(d).tags.join(' ');
    var curSrc = existingRow && existingRow.src ? existingRow.src : metaFor(d).src;
    var curLink = existingRow && existingRow.link ? existingRow.link : metaFor(d).link;
    var curOrig = existingRow && existingRow.orig ? existingRow.orig : (d.orig || '');
    var mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:99998';
    mask.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:18px;width:min(520px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
        '<h4 style="margin:0 0 10px;font-size:15px">编辑待加记忆卡</h4>' +
        '<label style="display:block;font-size:12px;color:#6b7280;margin:8px 0 4px">信号 signal</label>' +
        '<textarea id="keSig" style="width:100%;min-height:60px;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box;resize:vertical">' + esc(curSig) + '</textarea>' +
        '<label style="display:block;font-size:12px;color:#6b7280;margin:8px 0 4px">结论 conclusion</label>' +
        '<textarea id="keCon" style="width:100%;min-height:60px;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box;resize:vertical">' + esc(curCon) + '</textarea>' +
        '<label style="display:block;font-size:12px;color:#6b7280;margin:8px 0 4px">标签 tags（空格分隔，如：易错 高频）</label>' +
        '<input id="keTags" value="' + esc(curTags) + '" style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box">' +
        '<label style="display:block;font-size:12px;color:#6b7280;margin:8px 0 4px">出处 src（自动生成，可改）</label>' +
        '<input id="keSrc" value="' + esc(curSrc) + '" style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box">' +
        '<label style="display:block;font-size:12px;color:#6b7280;margin:8px 0 4px">原题 orig（自动抓取，可改）</label>' +
        '<textarea id="keOrig" style="width:100%;min-height:48px;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box;resize:vertical">' + esc(curOrig) + '</textarea>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button id="keCancel" style="border:none;border-radius:8px;padding:6px 12px;font-size:12px;background:#f3f4f6;color:#374151;cursor:pointer">取消</button>' +
          '<button id="keSave" style="border:none;border-radius:8px;padding:6px 12px;font-size:12px;background:#16a34a;color:#fff;cursor:pointer">保存</button>' +
        '</div></div>';
    document.body.appendChild(mask);
    mask.querySelector('#keCancel').addEventListener('click', function () { document.body.removeChild(mask); });
    mask.querySelector('#keSave').addEventListener('click', async function () {
      var sig = mask.querySelector('#keSig').value.trim();
      var con = mask.querySelector('#keCon').value.trim();
      var tags = mask.querySelector('#keTags').value.trim().split(/\s+/).filter(Boolean);
      var src = mask.querySelector('#keSrc').value.trim();
      var link = curLink;
      var orig = mask.querySelector('#keOrig').value.trim();
      if (!sig || !con) { MC.toast('信号与结论不能为空'); return; }
      try {
        if (existingRow) {
          await MC.patchPending(existingRow.id, { signal: sig, conclusion: con, tags: tags, src: src, link: link, orig: orig });
          MC.toast('已更新待审卡');
        } else {
          await MC.autoIngest({ subject: SUBJECT, chapter: CHAPTER, signal: sig, conclusion: con, sourceModule: SRC_MOD, sourceType: SRC_TYP, sourceId: d.sourceId, tags: tags, src: src, link: link, orig: orig });
          MC.toast('已入库（去待审闸门）');
        }
        document.body.removeChild(mask);
        refresh(actions, d);
      } catch (e) { MC.toast('保存失败：' + e.message); }
    });
  }

  // 决策#3：受信模块(知识地图) → 直接 autoIngest 进 cards，去掉「待审/通过」闸门（合并/拒绝不再需要）
  function openReview(actions, d, existingRow) {
    actions.innerHTML = '';
    var act = document.createElement('div');
    act.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:flex-end';
    actions.appendChild(act);
    function btn(label, bg, color) {
      var b = document.createElement('button'); b.textContent = label;
      b.style.cssText = 'border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:' + bg + ';color:' + color;
      return b;
    }
    var pass = btn('直接入库（去待审闸门）', '#16a34a', '#fff');
    var cancel = btn('取消', '#f3f4f6', '#374151');
    act.appendChild(pass); act.appendChild(cancel);
    cancel.addEventListener('click', function () { refresh(actions, d); });
    pass.addEventListener('click', async function () {
      try {
        var m = metaFor(d);
        await MC.autoIngest({ subject: SUBJECT, chapter: CHAPTER, signal: d.signal, conclusion: d.conclusion, sourceModule: SRC_MOD, sourceType: SRC_TYP, sourceId: d.sourceId, tags: m.tags, src: m.src, link: m.link, orig: d.orig });
        MC.toast('已入库（去待审闸门）'); refresh(actions, d);
      } catch (e) { MC.toast('入库失败：' + e.message); }
    });
  }

  function boot() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.err-item'));
    items.forEach(function (item, i) {
      var p = item.querySelector('p');
      if (!p) return;
      var pc = parseItem(p);
      var idx = i + 1;
      var d = {
        subject: SUBJECT, chapter: CHAPTER, signal: pc.signal, conclusion: pc.conclusion,
        orig: p.textContent.trim(),
        sourceId: FIG + '::' + idx
      };
      var actions = document.createElement('div');
      actions.style.cssText = 'margin-left:auto;display:flex;flex-direction:column;gap:6px;flex:0 0 auto;align-items:flex-end;align-self:center';
      item.appendChild(actions);
      refresh(actions, d);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
