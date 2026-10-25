/** Store, inventory registry, workforce directory and inward/maintenance views. */
export function createStoreUiModule(deps) {
  const { $, CONFIG, COST, F, LOADED, RBAC, S, STORE_CATS, app, autoReorderDetails, collection, dLong, db, deleteDoc, doc, effectiveReorderLevel, esc, fld, fmt, getDocs, mName, money, normDate, num, openForm, openModal, qsa, renderLedger, renderLocalExpenseLedger, runTransaction, serverTimestamp, setHTML, timeOf, toast, today, tsMs, writeBatch } = deps;
function normMobile(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, ''); const plus = d.startsWith('+'); d = d.replace(/\+/g, '');
  if (!plus && d.length === 10) return '+91' + d; if (!plus && d.length === 12 && d.startsWith('91')) return '+' + d; if (!plus && d.length === 11 && d.startsWith('0')) return '+91' + d.slice(1);
  return (plus ? '+' : '') + d;
}
let usersSearchText = '', usersRoleFilter = 'all';
function renderUsersMaster() {
  const q = usersSearchText.trim().toLowerCase();
  const all = [...(S.users || [])].sort((a, b) => (a.fullName || a.username || '').localeCompare(b.fullName || b.username || ''));
  const rows = all.filter(u => (!q || [u.fullName,u.username,u.mobileNumber,u.role].some(v => String(v||'').toLowerCase().includes(q))) && (usersRoleFilter === 'all' || String(u.role||'') === usersRoleFilter));
  const roles = [...new Set(all.map(u=>String(u.role||'').trim()).filter(Boolean))].sort();
  setHTML($('#usersTbl'), `<div class="user-tools"><label class="user-search"><span class="material-symbols-rounded">search</span><input id="usersSearch" value="${esc(usersSearchText)}" placeholder="Search name, mobile or role" aria-label="Search users"></label><label class="user-role-filter">Role<select id="usersRoleFilter"><option value="all">All roles</option>${roles.map(r=>`<option value="${esc(r)}" ${usersRoleFilter===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label><span class="muted sm user-count">${rows.length} of ${all.length} users</span>${RBAC.can('access.manage') ? '<button class="btn btn-sm" data-act="open-role-admin">Manage app access</button>' : ''}</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Record ID</th><th class="right">Actions</th></tr></thead><tbody>${!LOADED.users ? '<tr><td colspan="5"><div class="skeleton" style="height:80px"></div></td></tr>' : rows.length ? rows.map(u => `<tr><td><b>${esc(u.fullName || u.username || 'Staff')}</b><div class="muted sm">${u.username && u.username!==u.fullName ? esc(u.username) : 'Workforce profile'}</div></td><td>${esc(u.mobileNumber || '—')}</td><td><span class="badge ${u.role === 'incharge' ? 'gold' : String(u.role||'').startsWith('storekeeper') ? 'warn' : 'ok'}">${esc(u.role || '—')}</span></td><td><code>${esc(u.id)}</code></td><td class="right" style="white-space:nowrap"><button class="btn btn-sm" data-act="edit-user" data-id="${esc(u.id)}">Edit</button> <button class="btn btn-danger btn-sm" data-act="del" data-col="users" data-id="${esc(u.id)}" data-label="${esc(u.fullName || 'this user')}"><span class="material-symbols-rounded">delete</span></button></td></tr>`).join('') : `<tr><td colspan="5" class="empty">${all.length?'No users match these filters.':'No users yet. Add a workforce member to begin.'}</td></tr>`}</tbody></table></div>`);
  const search = $('#usersSearch'); if (search && document.activeElement?.id === 'usersSearch') { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}
const itemName = i => i.partName || i.itemName || 'Unnamed item';
const inventoryCategoryOpen = new Set();
function inventoryRowsMarkup(items) {
  return `<div class="table-wrap inv-category-table"><table><thead><tr><th>Item name</th><th>Unit</th><th class="num">On hand</th><th class="num">Auto reorder at</th><th class="num">Last unit rate</th><th class="num">Stock value</th><th>Status</th><th></th></tr></thead><tbody>${items.length ? items.map(i=>{
    const qty=num(i.stockQuantity), reorder=effectiveReorderLevel(i), policy=autoReorderDetails(i), low=qty<=reorder;
    return `<tr><td><b>${esc(itemName(i))}</b></td><td>${esc(i.unit||'Unit not set')}</td><td class="num"><b>${fmt(qty,3)}</b></td><td class="num"><b>${fmt(reorder,3)}</b><div class="muted sm">${policy.reliable?'Trend-based':'Provisional floor'}</div></td><td class="num">${num(i.unitCost)?money(i.unitCost,2):'—'}</td><td class="num">${money(qty*num(i.unitCost),2)}</td><td><span class="badge ${low?'warn':'ok'}">${low?'Reorder':'In stock'}</span></td><td><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}">Edit</button></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="empty">No items in this category.</td></tr>'}</tbody></table></div>`;
}
function renderRegistry() {
  const items=S.inventory.slice();
  const low=items.filter(i=>num(i.stockQuantity)<=effectiveReorderLevel(i)).length;
  const total=items.reduce((v,i)=>v+Math.max(0,num(i.stockQuantity))*Math.max(0,num(i.unitCost)),0);
  setHTML($('#storeKpis'), `<div class="kpi"><div class="kpi-label">SKUs</div><div class="kpi-value">${items.length}</div></div><div class="kpi"><div class="kpi-label">Low stock</div><div class="kpi-value">${low}</div></div><div class="kpi"><div class="kpi-label">Stock value (recorded rates)</div><div class="kpi-value">${money(total)}</div></div><div class="kpi"><div class="kpi-label">Goods receipts</div><div class="kpi-value">${S.inwards.length}</div></div>`);

  if (!LOADED.inventory) {
    setHTML($('#invTbl'), '<div class="card empty">Loading inventory…</div>');
  } else if (!items.length) {
    setHTML($('#invTbl'), '<div class="card empty">No inventory items yet. Use <b>New item master</b> to create your first SKU.</div>');
  } else {
    const groups = new Map();
    items.forEach(i => { const cat=String(i.category||'Other').trim()||'Other'; if(!groups.has(cat)) groups.set(cat,[]); groups.get(cat).push(i); });
    groups.forEach(rows=>rows.sort((a,b)=>itemName(a).localeCompare(itemName(b))));
    const rank = new Map(STORE_CATS.map((c,i)=>[c.toLowerCase(),i]));
    const cats = [...groups.keys()].sort((a,b)=>{
      const ra=rank.has(a.toLowerCase())?rank.get(a.toLowerCase()):999;
      const rb=rank.has(b.toLowerCase())?rank.get(b.toLowerCase()):999;
      return ra-rb || a.localeCompare(b);
    });
    const markup = cats.map(cat=>{
      const rows=groups.get(cat), lowRows=rows.filter(i=>num(i.stockQuantity)<=effectiveReorderLevel(i));
      const value=rows.reduce((v,i)=>v+Math.max(0,num(i.stockQuantity))*Math.max(0,num(i.unitCost)),0);
      const isOpen=inventoryCategoryOpen.has(cat);
      return `<details class="inv-category" data-inv-category="${esc(cat)}" ${isOpen?'open':''}><summary><span class="inv-cat-icon material-symbols-rounded">${cat==='Fuel'?'local_gas_station':cat==='Fertilizers'?'spa':cat==='Pesticides'?'pest_control':cat==='Turf Enhancements'?'eco':cat==='Spare Parts'?'build':cat==='Tools'?'handyman':'inventory_2'}</span><span class="inv-cat-main"><b>${esc(cat)}</b><small>${rows.length} item${rows.length===1?'':'s'} · ${money(value)} recorded stock value</small></span><span class="inv-cat-alert ${lowRows.length?'warn':''}">${lowRows.length?`${lowRows.length} reorder`:'Stock OK'}</span><span class="inv-cat-chevron material-symbols-rounded">expand_more</span></summary><div class="inv-category-body">${isOpen?inventoryRowsMarkup(rows):'<div class="inv-category-placeholder">Expand to view items in this category</div>'}</div></details>`;
    }).join('');
    setHTML($('#invTbl'), `<div class="inv-category-list">${markup}</div>`);
  }

  const receipts=[...S.inwards].sort((a,b)=>tsMs(b.createdAt)-tsMs(a.createdAt));
  setHTML($('#inwardTbl'), `<table><thead><tr><th>Date / Reference</th><th>Category / Item</th><th>Supplier</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Total</th></tr></thead><tbody>${!LOADED.inwards?'<tr><td colspan="7">Loading receipts…</td></tr>':receipts.length?receipts.slice(0,100).map(r=>`<tr><td>${esc(r.receiptDate||'—')}<div class="muted sm">${esc(r.invoiceNumber||r.id)}</div></td><td><span class="muted sm">${esc(r.category||'')}</span><div><b>${esc(r.itemName||'')}</b></div></td><td>${esc(r.supplier||'—')}</td><td class="num">${fmt(r.quantity,3)} ${esc(r.unit||'')}</td><td class="num">${money(r.rate,2)}</td><td class="num">${fmt(r.gstPercent,2)}%</td><td class="num"><b>${money(r.total,2)}</b></td></tr>`).join(''):'<tr><td colspan="7" class="empty">No goods receipts recorded.</td></tr>'}</tbody></table>`);
  renderLocalExpenseLedger();
}
// Collapse content when a category closes so large inventory masters do not leave hundreds of rows in the DOM.
document.addEventListener('toggle', e => {
  const details=e.target;
  if (!(details instanceof HTMLDetailsElement) || !details.matches('#invTbl details.inv-category[data-inv-category]')) return;
  const category=details.dataset.invCategory || '';
  const body=details.querySelector('.inv-category-body');
  if (!body) return;
  if (details.open) {
    inventoryCategoryOpen.add(category);
    const rows=S.inventory.filter(i=>(String(i.category||'Other').trim()||'Other')===category).sort((a,b)=>itemName(a).localeCompare(itemName(b)));
    setHTML(body, inventoryRowsMarkup(rows));
  } else {
    inventoryCategoryOpen.delete(category);
    setHTML(body, '<div class="inv-category-placeholder">Expand to view items in this category</div>');
  }
}, true);

let storeRecordsTab = 'items';
function openStoreRecordsEditor() {
  storeRecordsTab = 'items';
  renderStoreRecordsEditor();
}
const RESET_GROUPS = [
  {key:'users', label:'Users & access', col:'users', note:'User profiles and role records'},
  {key:'machines', label:'Machines / fleet', col:'machines', note:'Machine master records'},
  {key:'plans', label:'Turf plans & issues', col:'plans', note:'Planned tasks and recorded issue/application lines'},
  {key:'inventory', label:'Inventory master & stock', col:'inventory', note:'Item masters and current stock balances'},
  {key:'inwards', label:'Goods receipts', col:'inwards', note:'GRN / inward receipt records'},
  {key:'fuel', label:'Fuel issues', col:'fuel', note:'Fuel issue logs'},
  {key:'shifts', label:'Shifts & attendance', col:'shifts', note:'Shift records'},
  {key:'maintenance', label:'Maintenance records', col:'maintenance', note:'Service and repair history'},
  {key:'assignments', label:'Assignments', col:'assignments', note:'Operator / machine assignment history'},
  {key:'logs', label:'Operational logs', col:'logs', note:'General operational and issue logs'},
  {key:'zones', label:'Course zones', col:'zones', note:'Geofence / area configuration'},
  {key:'live', label:'Live telemetry', col:'live', note:'Latest live machine telemetry'},
];
function openDataReset() {
  const choices = RESET_GROUPS.map(g=>`<label class="reset-data-option"><input type="checkbox" name="resetGroup" value="${g.key}"><span><b>${esc(g.label)}</b><small>${esc(g.note)}</small></span></label>`).join('');
  openForm({title:'Reset selected data',submit:'Permanently reset selected',danger:true,html:`<div class="alert-box" style="margin-bottom:12px"><b>Destructive action.</b> Selected records will be permanently deleted from Firebase. This cannot be undone. Export or back up data first.</div><div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><button type="button" class="btn btn-sm" id="resetSelectAll">Select all</button><button type="button" class="btn btn-sm" id="resetSelectNone">Clear selection</button></div><div class="reset-data-list">${choices}</div><div class="field" style="margin-top:14px"><label class="f">Type RESET to confirm</label><input id="resetConfirmText" autocomplete="off" placeholder="Type RESET"></div><p class="muted sm">Inventory and goods receipts are separate selections. Resetting one does not automatically reset the other. Turf plans & issues share the turf_plans collection.</p>`,onSubmit:async()=>{
    const selected=qsa('#mBody input[name="resetGroup"]:checked').map(el=>RESET_GROUPS.find(g=>g.key===el.value)).filter(Boolean);
    if(!selected.length){toast('Select at least one data group','err');return false;}
    if($('#resetConfirmText')?.value.trim()!=='RESET'){toast('Type RESET exactly to confirm','err');return false;}
    const summary=[];
    for(const group of selected){
      const snap=await getDocs(collection(db,CONFIG.COL[group.col]));
      let deleted=0; const docs=snap.docs;
      for(let i=0;i<docs.length;i+=400){const batch=writeBatch(db);docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));await batch.commit();deleted+=Math.min(400,docs.length-i);}
      summary.push(`${group.label}: ${deleted}`);
    }
    toast(`Reset complete · ${summary.join(' · ')}`);
    scheduleRender();
  }});
  $('#resetSelectAll')?.addEventListener('click',()=>qsa('#mBody input[name="resetGroup"]').forEach(el=>el.checked=true));
  $('#resetSelectNone')?.addEventListener('click',()=>qsa('#mBody input[name="resetGroup"]').forEach(el=>el.checked=false));
}
function renderStoreRecordsEditor() {
  const tabButtons = `<div class="turf-view-tabs" style="margin-bottom:14px"><button class="turf-view-tab ${storeRecordsTab==='items'?'active':''}" data-act="store-records-tab" data-tab="items">Item master <span class="turf-count-pill">${S.inventory.length}</span></button><button class="turf-view-tab ${storeRecordsTab==='inwards'?'active':''}" data-act="store-records-tab" data-tab="inwards">Goods receipts <span class="turf-count-pill">${S.inwards.length}</span></button></div>`;
  let body = '';
  if (storeRecordsTab === 'items') {
    const rows = [...S.inventory].sort((a,b)=>itemName(a).localeCompare(itemName(b)));
    body = `<div class="muted sm" style="margin-bottom:10px">Edit item details from the Store tab. Deleting an item removes its master record; review linked history before deleting.</div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="num">Stock</th><th>Unit</th><th></th></tr></thead><tbody>${rows.length?rows.map(i=>`<tr><td><b>${esc(itemName(i))}</b><div class="muted sm">ID: ${esc(i.id)}</div></td><td>${esc(i.category||'Other')}</td><td class="num">${fmt(i.stockQuantity,3)}</td><td>${esc(i.unit||'—')}</td><td class="right" style="white-space:nowrap"><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}">Edit</button> <button class="btn btn-danger btn-sm" data-act="store-delete-item" data-id="${esc(i.id)}">Delete</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No item master records.</td></tr>'}</tbody></table></div>`;
  } else {
    const rows = [...S.inwards].sort((a,b)=>String(b.receiptDate||'').localeCompare(String(a.receiptDate||'')));
    body = `<div class="muted sm" style="margin-bottom:10px">Deleting a receipt also reverses its quantity from the linked item's current stock. If the current balance is lower than the receipt quantity, deletion is blocked to prevent a negative stock balance.</div><div class="table-wrap"><table><thead><tr><th>Date / GRN</th><th>Item</th><th>Supplier</th><th class="num">Qty</th><th class="num">Total</th><th></th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${esc(r.receiptDate||'—')}<div class="muted sm">${esc(r.invoiceNumber||r.id)}</div></td><td><b>${esc(r.itemName||'—')}</b><div class="muted sm">${esc(r.category||'')}</div></td><td>${esc(r.supplier||'—')}</td><td class="num">${fmt(r.quantity,3)} ${esc(r.unit||'')}</td><td class="num">${money(r.total,2)}</td><td class="right"><button class="btn btn-danger btn-sm" data-act="store-delete-inward" data-id="${esc(r.id)}">Delete</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">No goods receipt records.</td></tr>'}</tbody></table></div>`;
  }
  openModal({title:'Store records editor',sub:'Review, edit or permanently delete store records',size:'lg',body:tabButtons+body,footer:'<button class="btn" data-act="close-modal">Close</button>'});
}
function deleteStoreItemFromEditor(id) {
  const item=S.inventory.find(x=>x.id===id); if(!item)return;
  openForm({title:'Delete item master',submit:'Delete item',danger:true,html:`<p style="margin:0 0 10px">Permanently delete <b>${esc(itemName(item))}</b>?</p><p class="muted sm">Current stock: ${fmt(item.stockQuantity,3)} ${esc(item.unit||'units')}. This does not delete historical receipts or issue/application records linked to the item.</p>`,onSubmit:async()=>{await deleteDoc(doc(db,CONFIG.COL.inventory,id));toast('Item master deleted');}});
}
function deleteStoreInwardFromEditor(id) {
  const receipt=S.inwards.find(x=>x.id===id); if(!receipt)return;
  if(receipt.transactionType === "FNB_RECEIPT"){toast("This receipt is linked to F&B order history. Manage it through F&B to avoid a stock mismatch.","err");return;}
  openForm({title:'Delete goods receipt',submit:'Delete receipt & reverse stock',danger:true,html:`<p style="margin:0 0 10px">Delete GRN <b>${esc(receipt.invoiceNumber||receipt.id)}</b> for <b>${esc(receipt.itemName||'item')}</b>?</p><p class="muted sm">This will subtract ${fmt(receipt.quantity,3)} ${esc(receipt.unit||'units')} from the linked item's current stock. This cannot be undone.</p>`,onSubmit:async()=>{
    await runTransaction(db,async tx=>{
      const receiptRef=doc(db,CONFIG.COL.inwards,id), receiptSnap=await tx.get(receiptRef);
      if(!receiptSnap.exists())throw new Error('Receipt no longer exists. Refresh and retry.');
      const r=receiptSnap.data(), itemId=r.itemId;
      if(itemId){
        const itemRef=doc(db,CONFIG.COL.inventory,itemId), itemSnap=await tx.get(itemRef);
        if(itemSnap.exists()){
          const current=Math.max(0,num(itemSnap.data().stockQuantity)), qty=Math.max(0,num(r.quantity));
          if(current+1e-9<qty)throw new Error(`Cannot reverse receipt: current stock (${fmt(current,3)}) is below receipt quantity (${fmt(qty,3)}). Correct stock first.`);
          tx.update(itemRef,{stockQuantity:+(current-qty).toFixed(4),updatedAt:serverTimestamp()});
        }
      }
      tx.delete(receiptRef);
    });
    toast('Receipt deleted and stock reversed');
  }});
}

function openInward() {
  const cats=STORE_CATS.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  openForm({title:'Goods inward / Stock receipt',submit:'Post inward',html:
    `<div class="row2">${fld('Category',`<select id="inCat" data-chg="inward-category"><option value="">Select category</option>${cats}</select>`)}${fld('Item name',`<select id="inItem"><option value="">Select category first</option></select>`)}</div>`+
    `<div class="row2">${fld('Receipt date',`<input id="inDate" type="date" value="${today()}">`)}${fld('Supplier',`<input id="inSupplier" placeholder="Supplier name">`)}</div>`+
    fld('Invoice / GRN reference',`<input id="inInvoice" placeholder="Invoice or delivery challan no.">`)+
    `<div class="row2">${fld('Quantity',`<input id="inQty" type="number" min="0.001" step="any" placeholder="0">`)}${fld('Rate per unit (₹, before GST)',`<input id="inRate" type="number" min="0" step="0.01" placeholder="0">`)}</div>`+
    `<div class="row2">${fld('GST applicable',`<select id="inGst" data-chg="inward-gst"><option value="0">No / 0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select>`)}${fld('Custom GST %',`<input id="inCustomGst" type="number" min="0" max="100" step="0.01" placeholder="Optional">`)}</div>`+
    `<div id="inPreview" class="muted sm">Enter quantity and rate to calculate taxable amount and GST.</div>`+
    fld('Notes',`<input id="inNotes" placeholder="Optional receiving notes">`),
    onSubmit:async()=>{
      const itemId=$('#inItem').value, item=S.inventory.find(i=>i.id===itemId),qty=Number($('#inQty').value),rate=Number($('#inRate').value),gst=($('#inCustomGst').value.trim()!==''?Number($('#inCustomGst').value):Number($('#inGst').value));
      if(!item||$('#inCat').value!==item.category){toast('Select a valid item for the category','err');return false;}
      if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(rate)||rate<0||!Number.isFinite(gst)||gst<0||gst>100){toast('Check quantity, rate and GST','err');return false;}
      const ref=$('#inInvoice').value.trim(),supplier=$('#inSupplier').value.trim(),receiptDate=$('#inDate').value;
      if(!receiptDate||!supplier||!ref){toast('Date, supplier and invoice / GRN are required','err');return false;}
      const taxable=+(qty*rate).toFixed(2),tax=+(taxable*gst/100).toFixed(2),total=+(taxable+tax).toFixed(2);
      const receiptRef=doc(collection(db,CONFIG.COL.inwards));
      await runTransaction(db,async tx=>{
        const itemRef=doc(db,CONFIG.COL.inventory,itemId),snap=await tx.get(itemRef);
        if(!snap.exists())throw new Error('Item no longer exists');
        const current=snap.data();if(current.category!==item.category)throw new Error('Item category changed. Refresh and retry');
        const oldQty=Math.max(0,num(current.stockQuantity)),newQty=oldQty+qty;
        tx.update(itemRef,{stockQuantity:newQty,unitCost:rate,lastInwardId:receiptRef.id,updatedAt:serverTimestamp()});
        tx.set(receiptRef,{itemId,itemName:itemName(item),category:item.category,unit:item.unit||'Nos',quantity:qty,rate,gstPercent:gst,taxableAmount:taxable,gstAmount:tax,total,supplier,invoiceNumber:ref,receiptDate,notes:$('#inNotes').value.trim(),createdAt:serverTimestamp(),transactionType:'INWARD'});
      });toast('Goods inward posted and stock updated');
    }
  });
  updateInwardItems();
}
function updateInwardItems(){const c=$('#inCat')?.value,el=$('#inItem');if(!el)return;el.innerHTML='<option value="">Select item</option>'+S.inventory.filter(i=>i.category===c).sort((a,b)=>itemName(a).localeCompare(itemName(b))).map(i=>`<option value="${esc(i.id)}">${esc(itemName(i))} (${esc(i.unit||'Nos')})</option>`).join('');}
function previewInward(){const el=$('#inPreview');if(!el)return;const q=Math.max(0,num($('#inQty')?.value)),r=Math.max(0,num($('#inRate')?.value)),g=$('#inCustomGst')?.value.trim()!==''?num($('#inCustomGst').value):num($('#inGst')?.value);el.textContent=`Taxable ${money(q*r,2)} · GST ${money(q*r*g/100,2)} · Invoice total ${money(q*r*(1+g/100),2)}`;}
function renderIncidents() {
  if (!LOADED.logs) { setHTML($('#incList'), '<div class="skeleton" style="height:90px"></div>'); return; }
  const rows = [...S.logs].sort((a, b) => ((a.repairStatus === 'Resolved') - (b.repairStatus === 'Resolved')) || tsMs(b.createdAt) - tsMs(a.createdAt));
  setHTML($('#incList'), rows.length ? rows.map(l => { const done = l.repairStatus === 'Resolved'; return `<div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap"><div style="min-width:240px;flex:1"><div class="muted sm"><b>${esc(l.machineId || 'General')}</b> · ${esc(l.logType || 'Issue')}${l.reportedDate ? ' · ' + dLong(l.reportedDate) : ''}</div><div style="font-weight:600;margin-top:2px">${esc(l.issueDescription || '')}</div><div class="record-meta">${num(l.estimatedDowntimeHours)>0?`Estimated downtime ${fmt(l.estimatedDowntimeHours,1)} h · ${COST.downtimePerHour>0?money(num(l.estimatedDowntimeHours)*COST.downtimePerHour)+' estimated exposure':'set hourly exposure rate in Cost model'}`:'Downtime estimate not recorded'}</div></div><div style="display:flex;gap:8px;align-items:center"><span class="badge ${done ? 'ok' : 'bad'}">${done ? 'Resolved' : esc(l.repairStatus || 'Pending')}</span><button class="btn btn-sm" data-act="inc-toggle" data-id="${esc(l.id)}">${done ? 'Reopen' : 'Mark resolved'}</button><button class="btn btn-danger btn-sm" data-act="del" data-col="logs" data-id="${esc(l.id)}" data-label="this incident"><span class="material-symbols-rounded">delete</span></button></div></div>`; }).join('') : '<div class="card empty">No incident tickets. ??</div>');
}


/* ================= RECORDS (maintenance + assignments) ================= */
let recordsTab = 'maintenance';
function renderRecords() {
  const card = $('#recordsCard');
  if (!card) return;
  qsa('#recordsChips .chip').forEach(c => c.classList.toggle('on', c.dataset.tab === recordsTab));
  if (recordsTab === 'maintenance') {
    const rows = [...(S.maintenance || [])].sort((a, b) => tsMs(b.timestamp) - tsMs(a.timestamp) || (b.date || '').localeCompare(a.date || ''));
    if (!LOADED.maintenance) { setHTML(card, '<div class="skeleton" style="height:240px"></div>'); return; }
    setHTML(card, `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Machine</th><th class="num">Hours at event</th><th>Parts</th><th>By</th><th>Notes</th><th></th></tr></thead><tbody>${rows.length ? rows.map(r => {
      const parts = Array.isArray(r.partsUsed) ? r.partsUsed.map(p => `${p.partName || p.partId || 'part'}×${p.qty || 1}`).join(', ') : '';
      return `<tr><td>${dLong(r.date || normDate(null, r.timestamp))}</td><td><span class="badge ${r.type === 'Service' ? 'ok' : r.type === 'Repair' ? 'warn' : 'gold'}">${esc(r.type || '—')}</span>${r.stockWarning ? ' <span class="badge bad">Stock</span>' : ''}</td><td><b>${esc(r.machineName || mName(r.machineId))}</b></td><td class="num">${r.hoursAtEvent != null ? fmt(num(r.hoursAtEvent)) : '—'}</td><td class="muted">${esc(parts || '—')}</td><td>${esc(r.performedBy || '—')}</td><td class="muted">${esc(r.notes || '')}</td><td></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No maintenance logs yet. Incharge can log Service / Backlapping / Repair from the app.</td></tr>'}</tbody></table></div>`);
  } else if (recordsTab === 'assignments') {
    const rows = [...(S.assignments || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!LOADED.assignments) { setHTML(card, '<div class="skeleton" style="height:240px"></div>'); return; }
    setHTML(card, `<div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Machine</th><th>Operator</th><th>By</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td>${r.at ? dLong(normDate(null, r.at)) + ' · ' + timeOf(r.at) : '—'}</td><td><span class="badge ${r.action === 'ASSIGN' ? 'ok' : 'mute'}">${esc(r.action || '—')}</span></td><td><b>${esc(r.machineName || mName(r.machineId))}</b></td><td>${esc(r.operatorName || '—')}<div class="record-meta">${esc(r.operatorMobile || '')}</div></td><td>${esc(r.by || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No assignment history yet.</td></tr>'}</tbody></table></div>`);
  } else {
    // fuel history reuse
    renderLedger(true);
    const ledger = $('#ledgerCard');
    if (ledger) setHTML(card, ledger.innerHTML);
  }
}


function setUsersSearchText(value) { usersSearchText = value || ''; }
function setUsersRoleFilter(value) { usersRoleFilter = value || 'all'; }
function setStoreRecordsTab(value) { storeRecordsTab = value || 'items'; }
function getRecordsTab() { return recordsTab; }
function setRecordsTab(value) { recordsTab = value || 'maintenance'; }

  return { normMobile, itemName, renderUsersMaster, inventoryRowsMarkup, renderRegistry, openStoreRecordsEditor, openDataReset, renderStoreRecordsEditor, deleteStoreItemFromEditor, deleteStoreInwardFromEditor, openInward, updateInwardItems, previewInward, renderIncidents, renderRecords, setUsersSearchText, setUsersRoleFilter, setStoreRecordsTab, getRecordsTab, setRecordsTab };
}
