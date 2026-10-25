/**
 * Global event delegation for data-act, data-chg, store forms, and modal surfaces.
 * Feature handlers are resolved lazily so registration is independent of module
 * construction order.
 */
export function registerAppEventDelegation(context) {
  const {
    $, qsa, getStoreUiModule, getTurfModule,
    getActionHandlers, getChangeHandlers, renderUsersMaster,
    permissionForAction, RBAC, toast, updateDoc, doc, db, CONFIG,
    serverTimestamp, exRowHTML, exUpdateTotal, findInventoryByName,
    esc, itemName, fmt, num, previewInward, F, renderFleet,
    calcTot, renderTurfApplications, closeModal, closeDrawer
  } = context;

  document.addEventListener('input', e => { if (e.target?.id === 'usersSearch') { const pos=e.target.selectionStart; getStoreUiModule().setUsersSearchText(e.target.value||''); renderUsersMaster(); const next=$('#usersSearch'); if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch(_){}} } });
  document.addEventListener('change', e => { if (e.target?.id === 'usersRoleFilter') { getStoreUiModule().setUsersRoleFilter(e.target.value||'all'); renderUsersMaster(); } });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) { qsa('.kmenu.open').forEach(x => x.classList.remove('open')); return; }
    if (el.dataset.act !== 'kebab') qsa('.kmenu.open').forEach(x => x.classList.remove('open'));
    const permission = permissionForAction(el.dataset.act, el.dataset);
    if (permission && !RBAC.can(permission)) { toast("Your role does not have permission for this action.", "err"); return; }
    const handlers = getActionHandlers(); const fn = handlers[el.dataset.act]; if (fn) fn(el.dataset, el, e);
  });
  document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && getChangeHandlers()[el.dataset.chg]) C[el.dataset.chg](el.value, el.dataset, el); });
  document.addEventListener('change', async e => { const el=e.target.closest('[data-expense-paid]'); if(!el)return; try{await updateDoc(doc(db,CONFIG.COL.expenses,el.dataset.expensePaid),el.checked?{paidBy:'accounts',spentByMe:true,reclaimedAt:serverTimestamp()}:{paidBy:'me',spentByMe:true,reclaimedAt:null});toast(el.checked?'Reclaimed — marked as paid by accounts':'Marked as pending from office');}catch(err){el.checked=!el.checked;toast(err.message||'Could not update expense','err');} });
  document.addEventListener('click', e => {
    if (e.target.closest('#exAddRow')) { const h=$('#exRows'); h.insertAdjacentHTML('beforeend',exRowHTML()); h.lastElementChild.querySelector('.exi-name').focus(); }
    const d=e.target.closest('.exi-del'); if(d){ const rows=qsa('#exRows .exp-row'); if(rows.length>1){d.closest('.exp-row').remove();} else {rows[0].querySelectorAll('input:not([readonly])').forEach(i=>i.value=i.classList.contains('exi-qty')?'1':'');rows[0].querySelector('.exi-match').innerHTML='';} exUpdateTotal(); }
  });
  document.addEventListener('input', e => {
    const t = e.target; if (!t || !t.classList) return;
    if (t.classList.contains('exi-qty') || t.classList.contains('exi-rate')) exUpdateTotal();
    if (t.classList.contains('exi-name')) {
      const box = t.closest('.exp-row').querySelector('.exi-match'); const n = t.value.trim();
      if (!n) { box.innerHTML = ''; return; }
      const m = findInventoryByName(n);
      box.innerHTML = m ? `<span class="exp-ok">In inventory: ${esc(itemName(m))} · stock ${fmt(num(m.stockQuantity), 2)} ${esc(m.unit || '')}</span><label class="expense-stock-option"><input class="exi-stock" type="checkbox"> Add qty to stock</label>` : '<span>New item — will ask to add to master</span>';
    }
  });
  document.addEventListener('input', e => { const el = e.target.closest('[data-inp]'); if (el && ['inQty','inRate','inCustomGst'].includes(el.id)) { previewInward(); } else if (el && el.dataset.inp === 'fleetq') { F.q = el.value; renderFleet(); } else if (el && el.dataset.inp === 'tp-qty') { calcTot(el.dataset.day); } else if (el && el.dataset.inp === 'turf-log-search') { getTurfModule().setAppSearch(el.value); renderTurfApplications(); } });
  $('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeModal(); });
  $('#drawerOv').addEventListener('mousedown', e => { if (e.target.id === 'drawerOv') closeDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });
}
