/* mc_knowledge_err.js —— 知识地图（胶带版）易错栏目内联「编辑 / 审核」
 * 职责：扫描每页 .err-item，右侧挂【编辑】【审核】按钮；
 *   - 编辑：弹窗改 signal/conclusion/tags → 写 cards_pending（propose 或 patch）
 *   - 审核：通过入库 / 合并 / 拒绝（propose + approvePending/mergePending/rejectPending）
 * 全部经 window.MC（mc_pending.js）写入同一 M 库，source_module='knowledge' source_type='tape'。
 * 依赖：先于本脚本加载 ../mc_pending.js（MC 命名空间）。
 */
(function () {
  'use strict';
  if (!window.MC) { console.error('[k-err] MC 组件未加载，请先引入 mc_pending.js'); return; }

  // 读 k-meta（subject / chapter / fig）
  var meta = {};
  try { var km = document.getElementById('k-meta'); if (km) meta = JSON.parse(km.textContent); } catch (e) { meta = {}; }
  var SUBJECT = meta.subject || '';
  var CHAPTER = meta.chapter || '';
  var FIG = meta.fig || (location.pathname.split('/').pop().replace(/\.html$/, ''));
  var SRC_MOD = 'knowledge';
  var SRC_TYP = 'tape';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
    });
  }
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

  async function refresh(actions, d) {
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
    var curTags = existingRow && Array.isArray(existingRow.tags) ? existingRow.tags.join(' ') : '#易错';
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
      if (!sig || !con) { MC.toast('信号与结论不能为空'); return; }
      try {
        if (existingRow) {
          await MC.patchPending(existingRow.id, { signal: sig, conclusion: con, tags: tags });
          MC.toast('已更新待审卡');
        } else {
          await MC.propose({ subject: SUBJECT, chapter: CHAPTER, signal: sig, conclusion: con, sourceModule: SRC_MOD, sourceType: SRC_TYP, sourceId: d.sourceId, tags: tags });
          MC.toast('已提交待审');
        }
        document.body.removeChild(mask);
        refresh(actions, d);
      } catch (e) { MC.toast('保存失败：' + e.message); }
    });
  }

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
    var pass = btn('通过入库', '#16a34a', '#fff');
    var merge = btn('合并', '#fef3c7', '#92400e');
    var reject = btn('拒绝', '#fee2e2', '#991b1b');
    var cancel = btn('取消', '#f3f4f6', '#374151');
    act.appendChild(pass); act.appendChild(merge); act.appendChild(reject); act.appendChild(cancel);
    cancel.addEventListener('click', function () { refresh(actions, d); });
    async function ensureRow() {
      if (existingRow) return existingRow;
      return await MC.propose({ subject: SUBJECT, chapter: CHAPTER, signal: d.signal, conclusion: d.conclusion, sourceModule: SRC_MOD, sourceType: SRC_TYP, sourceId: d.sourceId, tags: ['#易错'] });
    }
    pass.addEventListener('click', async function () {
      try { var row = await ensureRow(); await MC.approvePending(row); MC.toast('已入库'); refresh(actions, d); }
      catch (e) { MC.toast('入库失败：' + e.message); }
    });
    merge.addEventListener('click', async function () {
      var def = (existingRow && existingRow.payload && existingRow.payload.prefilter_card) ? existingRow.payload.prefilter_card : '';
      var target = window.prompt('合并到已有卡的 card_id（默认预筛命中）：', def);
      if (!target) return;
      try { var row = await ensureRow(); await MC.mergePending(row, target.trim()); MC.toast('已合并到 ' + target.trim()); refresh(actions, d); }
      catch (e) { MC.toast('合并失败：' + e.message); }
    });
    reject.addEventListener('click', async function () {
      try { var row = await ensureRow(); await MC.rejectPending(row); MC.toast('已拒绝'); refresh(actions, d); }
      catch (e) { MC.toast('拒绝失败：' + e.message); }
    });
  }

  function boot() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.err-item'));
    items.forEach(function (item, i) {
      var p = item.querySelector('p');
      if (!p) return;
      var pc = parseItem(p);
      var d = { subject: SUBJECT, chapter: CHAPTER, signal: pc.signal, conclusion: pc.conclusion, sourceId: FIG + '::' + (i + 1) };
      var actions = document.createElement('div');
      actions.style.cssText = 'margin-left:auto;display:flex;flex-direction:column;gap:6px;flex:0 0 auto;align-items:flex-end;align-self:center';
      item.appendChild(actions);
      refresh(actions, d);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
