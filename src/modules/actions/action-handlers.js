/** Delegated user actions and form-change handlers. */
export function createActionHandlersModule(deps) {
  const { CONFIG, F, R, RER, S, addDays, addDoc, app, applyTurfCostPreset, autoReorderDetails, calcTot, closeDrawer, closeModal, collection, confirmDelete, cur, db, deleteDoc, deleteStoreInwardFromEditor, deleteStoreItemFromEditor, doc, downloadCSV, drawerFuel, drawerRoute, editInventoryCost, effectiveReorderLevel, enableRainNotifications, esc, exRowHTML, expenseModule, exportDayCostLedger, exportROIReport, exportTurfCostRange, exportTurfVariance, findInventoryByName, fld, fmt, fnbModule, fuelIn, fuelLogCost, fuelTypeFromRecord, getSunday, increment, isTurfCategory, itemName, ledgerRows, mName, machineForm, machineOptions, money, mx, normMobile, normName, num, openAddSprayTaskForm, openCostModel, openDataReset, openDayCostLedger, openForm, openFuelModal, openInward, openNavGroup, openRoleAdmin, openRunModal, openStoreRecordsEditor, openTurfCostAnalytics, openTurfPlanner, openTurfVarianceModal, previewInward, qsa, rateForFuelLog, renderAll, renderFleet, renderLocalExpenseLedger, renderRecords, renderStoreRecordsEditor, renderTp, renderTurfApplications, renderTurfCare, renderTurfCostAnalytics, renderTurfVariance, renderUsersMaster, runData, runNewItemQueue, runTransaction, saveTurfBatch, serverTimestamp, setPreset, setTurfSection, shiftRows, showShiftPathMap, sortFuel, storeUiModule, svc, switchView, toast, today, toggleDock, tpState, tsMs, turfModule, turfPlanCategory, turfProductUnit, turfRecordDate, turfRecordProductName, turfRecordQuantity, turfRecordStatus, updateDoc, updateInwardItems, where, writeBatch, ymd } = deps;
const H = {
  'cost-model': () => openCostModel(),
  'open-day-cost': d => d.domain === 'turf' ? openTurfCostAnalytics() : openDayCostLedger(d.domain),
  'export-day-cost': d => exportDayCostLedger(d.domain),
  'turf-cost-apply': () => renderTurfCostAnalytics($('#turfCostFrom')?.value, $('#turfCostTo')?.value),
  'turf-cost-preset': d => applyTurfCostPreset(d.range),
  'export-turf-cost-range': () => exportTurfCostRange(),
  'export-roi': () => exportROIReport(),
  'edit-part': d => editInventoryCost(d.id),
  'open-store-records': () => openStoreRecordsEditor(),
  'fnb-tab': d => { fnbModule.setTab(d.tab); renderAll(); },
  'fnb-save-order': () => fnbModule.saveOrder(),
  'fnb-receive': d => fnbModule.receive(d.id),
  'fnb-import-orders': () => fnbModule.importOrders(),
  'fnb-clear-import': () => fnbModule.clearImport(),
  'open-role-admin': () => openRoleAdmin(),
  'open-data-reset': () => openDataReset(),
  'store-records-tab': d => { storeUiModule.setStoreRecordsTab(d.tab || 'items'); renderStoreRecordsEditor(); },
  'store-delete-item': d => deleteStoreItemFromEditor(d.id),
  'store-delete-inward': d => deleteStoreInwardFromEditor(d.id),
  'nav-turfcare': () => { setTurfSection('workboard'); switchView('turfcare'); },
  'nav-inventory-master': () => switchView('registry'),
  'turf-tab': d => setTurfSection(d.tab),
  'turf-category-products': d => { turfModule.setProductCategory(d.category || 'All categories'); setTurfSection('products'); },
  'export-turf-applications': () => { const rows=[...S.plans].filter(p=>isTurfCategory(turfPlanCategory(p))).sort((a,b)=>turfRecordDate(a).localeCompare(turfRecordDate(b))); downloadCSV('turf-application-records.csv', [['Date','Category','Product','Quantity','Unit','Treated area','Status','Notes','Created at'], ...rows.map(p=>[turfRecordDate(p),turfPlanCategory(p),turfRecordProductName(p),turfRecordQuantity(p),p.unit||p.stockUnit||p.uom||'',p.targetArea||p.area||p.location||'',turfRecordStatus(p),p.notes||p.reason||'',p.createdAt ? new Date(tsMs(p.createdAt)).toISOString() : ''])]); },
  'rec-tab': d => { storeUiModule.setRecordsTab(d.tab); renderRecords(); },
  'export-records': () => {
    if (storeUiModule.getRecordsTab() === 'maintenance') downloadCSV('maintenance.csv', [['Date','Type','Machine','Hours','Parts','By','Notes'], ...(S.maintenance||[]).map(r => [r.date, r.type, r.machineName||r.machineId, r.hoursAtEvent, JSON.stringify(r.partsUsed||[]), r.performedBy, r.notes])]);
    else if (storeUiModule.getRecordsTab() === 'assignments') downloadCSV('assignments.csv', [['At','Action','Machine','Operator','Mobile','By'], ...(S.assignments||[]).map(r => [r.at, r.action, r.machineName, r.operatorName, r.operatorMobile, r.by])]);
    else H['export-ledger']();
  },
  dock: () => toggleDock(),
  'open-fuel': openFuelModal, 'open-run': openRunModal,
  'kpi-live': () => switchView('radar'), 'kpi-svc': () => { F.sort = 'service'; switchView('fleet'); }, 'kpi-inc': () => switchView('fleet'), 'kpi-stock': () => switchView('registry'),
  rpreset: d => { if (d.p === 'custom') R[d.k].preset = 'custom'; else setPreset(R[d.k], d.p); RER[d.k](); },
  'close-modal': closeModal, 'close-drawer': closeDrawer,
  fcat: d => { F.cat = d.v; renderFleet(); }, ffuel: d => { F.fuel = d.v; renderFleet(); },
  'add-machine': () => machineForm(null), 'edit-machine': d => machineForm(mx().get(d.id)),
  'svc-done': d => { const m = mx().get(d.id); openForm({ title: 'Mark as serviced', submit: 'Confirm service', html: `<p style="margin:0">Record that <b>${esc(m.assetName)}</b> was serviced at <b>${fmt(num(m.currentHours))} hrs</b>? The ${CONFIG.SERVICE_INTERVAL}-hr cycle restarts from here.</p>`, onSubmit: async () => { await updateDoc(doc(db, CONFIG.COL.machines, m.id), { lastServiceHours: num(m.currentHours), lastServiceDate: today() }); toast('Service recorded'); } }); },
  del: d => confirmDelete(d.col, d.id, d.label),
  kebab: (d, el, e) => { e.stopPropagation(); const menu = el.nextElementSibling, open = menu.classList.contains('open'); qsa('.kmenu.open').forEach(x => x.classList.remove('open')); if (!open) menu.classList.add('open'); },
  'add-spray': d => openAddSprayTaskForm(d.day, d.date),
  'save-turf-batch': () => saveTurfBatch(),
  'open-turf-variance': () => openTurfVarianceModal(),
  'apply-turf-variance': () => { const a=$('#turfVarianceFrom')?.value||today(),b=$('#turfVarianceTo')?.value||today(); if(a>b){toast('From date must be on or before To date.','err');return;} renderTurfVariance(a,b); },
  'export-turf-variance': () => exportTurfVariance(), 
  "open-planner": () => openTurfPlanner(),
  "tp-add-app": d => { tpState.activeDay = parseInt(d.day); renderTp(); },
  "tp-cancel": () => { tpState.activeDay = -1; renderTp(); },
  "tp-del-app": d => { tpState.days[d.day].splice(parseInt(d.app), 1); renderTp(); },
  "tp-save-app": d => {
    const dIdx = parseInt(d.day);
    const productId = document.getElementById("tpProd_" + dIdx)?.value;
    const product = S.inventory.find(i => i.id === productId && isTurfCategory(i.category));
    const scope = document.getElementById("tpScope_" + dIdx)?.value || "overall";
    const qty = num(document.getElementById("tpQty_" + dIdx)?.value);
    if (!product) { toast("Select a valid turf product from Inventory Master", "err"); return; }
    if (!turfProductUnit(product)) { toast("Set this product’s stock unit in Inventory Master first", "err"); return; }
    if (!(qty > 0)) { toast("Enter a quantity greater than zero", "err"); return; }
    const totQty = scope === "per_area" ? qty * 18 : qty;
    const stockUnit = turfProductUnit(product);
    if (totQty > num(product.stockQuantity)) toast(`Planned quantity exceeds available stock for ${itemName(product)}. Check replenishment.`, "warn");
    tpState.days[dIdx].push({ pId: product.id, area: document.getElementById("tpArea_" + dIdx).value, scope, qty, unit: stockUnit, totQty });
    tpState.activeDay = -1;
    renderTp();
  },
  "save-turf-plan": async () => {
    const btn = document.querySelector("[data-act='save-turf-plan']");
    if(btn) btn.disabled = true;
    let hasData = false;
    tpState.days.forEach(d => { if(d.length > 0) hasData = true; });
    if(!hasData) { toast("Cannot save an empty plan", "err"); if(btn) btn.disabled = false; return; }
    const invalidLine = tpState.days.flat().find(app => {
      const product = S.inventory.find(i => i.id === app.pId);
      return !product || !isTurfCategory(product.category) || !turfProductUnit(product) || !(num(app.totQty) > 0) || app.unit !== turfProductUnit(product);
    });
    if (invalidLine) { toast("A planned product is missing or its stock unit changed. Recheck the plan.", "err"); if(btn) btn.disabled = false; return; }

    try {
      const b = writeBatch(db);
      const baseDate = new Date(tpState.start + "T00:00:00");

      for (let w = 0; w < tpState.weeks; w++) {
        const weekStartStr = ymd(new Date(baseDate.getTime() + w * 7 * 86400000));

        tpState.days.forEach((apps, dIdx) => {
          const targetDateStr = addDays(weekStartStr, dIdx);
          apps.forEach(app => {
            const prod = S.inventory.find(i => i.id === app.pId);
            const docRef = doc(collection(db, CONFIG.COL.plans));
            b.set(docRef, {
              weekStart: weekStartStr,
              date: targetDateStr,
              dayIndex: dIdx,
              productId: app.pId,
              productName: prod ? prod.partName : "Unknown",
              category: prod ? prod.category : "Fertilizers",
              targetQty: app.totQty,
              unit: app.unit,
              targetArea: app.area,
              scope: app.scope,
              notes: "Planned via Weekly Planner",
              status: "Planned",
              createdAt: Date.now()
            });
          });
        });
      }
      await b.commit();
      toast("Weekly plan saved successfully!");
      closeModal();
      turfModule.setCurrentWeek(tpState.start);
      renderTurfCare();
    } catch(e) {
      console.error(e);
      toast("Failed to save plan", "err");
    }
    if(btn) btn.disabled = false;
  },
  'home-insights': () => { switchView('overview'); toggleDock(false); },
  'weather-outlook': () => { if(cur!=='overview') switchView('overview'); $('#wxOutlookCard')?.scrollIntoView({behavior:'smooth',block:'start'}); },
  'enable-rain-notifications': () => enableRainNotifications(),
  'nav-group': d => { if (d.group === 'turfops') setTurfSection('workboard'); openNavGroup(d.group); },
  'group-tab': d => switchView(d.v),
  'map-mode': d => switchView(d.mode),
  'drawer-route': d => drawerRoute(d.id), 'view-path': d => showShiftPathMap(d.sid, d.mname), 'drawer-fuel': d => drawerFuel(d.id),
  'export-fuel': () => { const st = R.fuel; downloadCSV(`fuel_${st.from}_to_${st.to}.csv`, [['Date', 'Machine', 'Fuel type', 'Litres', 'Rate / L', 'Modeled cost', 'Pricing source', 'Notes'], ...fuelIn(st.from, st.to).sort(sortFuel).map(f => [f._d, mName(f.machineId), fuelTypeFromRecord(f), num(f.litres), rateForFuelLog(f)||'', rateForFuelLog(f)>0?fuelLogCost(f):'', num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre)>0?'Transaction rate':rateForFuelLog(f)>0?'Inventory Master rate':'Unpriced', f.notes || ''])]); },
  'export-ledger': () => { const st = R.ledger; downloadCSV(`fuel_ledger_${st.from}_to_${st.to}.csv`, [['Date', 'Machine', 'Fuel type', 'Litres', 'Rate / L', 'Modeled cost', 'Pricing source', 'Notes'], ...ledgerRows().map(f => [f._d, mName(f.machineId), fuelTypeFromRecord(f), num(f.litres), rateForFuelLog(f)||'', rateForFuelLog(f)>0?fuelLogCost(f):'', num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre)>0?'Transaction rate':rateForFuelLog(f)>0?'Inventory Master rate':'Unpriced', f.notes || ''])]); },
  'export-shifts': () => { const st = R.shifts; downloadCSV(`shifts_${st.from}_to_${st.to}.csv`, [['Date', 'Operator', 'Machine', 'Distance km', 'Engine hours'], ...shiftRows().map(s => [s._d, s.operatorName || '', mName(s.machineId), num(s.distanceKm), num(s.engineHoursLogged)])]); },
  'export-run': () => { const { st, rows } = runData(); downloadCSV(`running_hours_${st.from}_to_${st.to}.csv`, [['Machine', 'Category', 'Operators', 'Shifts', 'Run hours', 'Distance km', 'Fuel L', 'L/hr'], ...rows.map(r => [r.name, r.cat, [...r.ops].join('; '), r.n, +r.H.toFixed(2), +r.km.toFixed(2), +r.L.toFixed(2), r.H && r.L ? +(r.L / r.H).toFixed(2) : ''])]); },
  'add-inward': () => openInward(),
  'export-stock': () => downloadCSV('inventory_stock.csv',[['Category','Item','Unit','Stock','Auto reorder at','Rate basis','Unit rate'],...S.inventory.map(i=>[i.category,itemName(i),i.unit||'Nos',i.stockQuantity,effectiveReorderLevel(i),autoReorderDetails(i).method,i.unitCost])]),
  'export-inwards': () => downloadCSV('goods_inwards.csv',[['Date','Invoice','Supplier','Category','Item','Unit','Qty','Rate','GST %','Taxable','GST amount','Total'],...S.inwards.map(r=>[r.receiptDate,r.invoiceNumber,r.supplier,r.category,r.itemName,r.unit,r.quantity,r.rate,r.gstPercent,r.taxableAmount,r.gstAmount,r.total])]),
  'edit-user': d => { const u=S.users.find(x=>x.id===d.id); if(!u) return toast('User record not found','err'); openForm({title:'Edit workforce member',submit:'Save changes',html:fld('Full name','<input id="euName" required>')+fld('Mobile number','<input id="euMob" inputmode="tel" required>','Saved in normalized +91 format where applicable.')+fld('Role','<select id="euRole"><option value="operator">Operator</option><option value="incharge">Incharge</option><option value="storekeeper">Storekeeper (Fuel Ledger)</option><option value="storekeeper_fertilizer">Storekeeper (Fertilizers & Pesticides)</option></select>'),onSubmit:async()=>{const name=$('#euName').value.trim(), mob=normMobile($('#euMob').value), role=$('#euRole').value;if(!name){toast('Name is required','err');return false;}if(!/^\+\d{10,14}$/.test(mob)){toast('Enter a valid mobile number','err');return false;}if(S.users.some(x=>x.id!==u.id&&x.mobileNumber===mob)){toast('This mobile number is already registered','err');return false;}await updateDoc(doc(db,CONFIG.COL.users,u.id),{fullName:name,username:name,mobileNumber:mob,role});toast('User profile updated');}});setTimeout(()=>{if($('#euName'))$('#euName').value=u.fullName||u.username||'';if($('#euMob'))$('#euMob').value=u.mobileNumber||'';if($('#euRole'))$('#euRole').value=u.role||'operator';},0); },
  'add-user': () => openForm({ title: 'Register workforce member', submit: 'Add user',
    html: fld('Full name', '<input id="uName" placeholder="e.g. Rajesh Kumar">') + fld('Mobile number', '<input id="uMob" inputmode="tel" placeholder="98765 43210">', 'Saved as +91XXXXXXXXXX so the app login can match it.') + fld('Role', '<select id="uRole"><option value="operator">Operator</option><option value="incharge">Incharge</option><option value="storekeeper">Storekeeper (Fuel Ledger)</option><option value="storekeeper_fertilizer">Storekeeper (Fertilizers & Pesticides)</option></select>'),
    onSubmit: async () => { const name = $('#uName').value.trim(), mob = normMobile($('#uMob').value); if (!name) { toast('Name is required', 'err'); return false; } if (!/^\+\d{10,14}$/.test(mob)) { toast('Enter a valid mobile number', 'err'); return false; } if (S.users.some(u => u.mobileNumber === mob)) { toast('This mobile number is already registered', 'err'); return false; } await addDoc(collection(db, CONFIG.COL.users), { fullName: name, mobileNumber: mob, role: $('#uRole').value, username: name }); toast('User registered for mobile login'); } }),
  'add-local-expense': () => { openForm({title:'Add local bill',submit:'Save bill',size:'md',html:
    `<div class="row3">${fld('Date','<input id="exDate" type="date" value="'+today()+'">')}${fld('Paid by','<select id="exPaidBy"><option value="me">Me · to claim from office</option><option value="accounts">Accounts · paid by office</option></select>')}${fld('Shop / bill ref (optional)','<input id="exVendor" placeholder="e.g. Sri Hardware, #123" autocomplete="off">')}</div>`+
    '<div class="exp-rows-head"><span>Item name</span><span>Qty</span><span>Rate ₹</span><span>Amount ₹</span><span></span></div><div id="exRows">'+exRowHTML()+exRowHTML()+'</div>'+
    '<div class="exp-rows-foot"><button type="button" class="btn btn-sm" id="exAddRow">+ Add item</button><div class="exp-total">Bill total <b id="exTotal">₹0.00</b></div></div>'+
    '<div class="muted sm">Item names are free text. Items not in inventory will each prompt you to add them to the master.</div>',
    onSubmit: async()=>{
      const items=[]; let bad=false;
      qsa('#exRows .exp-row').forEach(r=>{
        const n=r.querySelector('.exi-name').value.trim(), rateRaw=r.querySelector('.exi-rate').value, q=num(r.querySelector('.exi-qty').value), rt=num(rateRaw);
        if(!n&&!rateRaw) return;
        if(!n||q<=0||rt<=0){bad=true;return;}
        const ex=findInventoryByName(n);
        items.push({itemName:n,qty:q,rate:rt,amount:Math.round(q*rt*100)/100,category:ex?(ex.category||''):'',inInventory:!!ex,_ex:ex,_stock:!!(r.querySelector('.exi-stock')&&r.querySelector('.exi-stock').checked)});
      });
      if(bad||!items.length){toast('Each item needs a name, a quantity above zero and a rate above zero.','err');return false;}
      const paidBy=$('#exPaidBy').value, total=Math.round(items.reduce((a,i)=>a+i.amount,0)*100)/100;
      const clean=items.map(({_ex,_stock,...rest})=>rest);
      const doc0={itemName:clean.length===1?clean[0].itemName:clean[0].itemName+' +'+(clean.length-1)+' more',items:clean,itemCount:clean.length,amount:total,paidBy,spentByMe:paidBy==='me',date:$('#exDate').value||today(),vendor:$('#exVendor').value.trim(),createdAt:serverTimestamp()};
      if(clean.length===1){doc0.qty=clean[0].qty;doc0.rate=clean[0].rate;}
      // Persist the bill and linked stock additions atomically, so a failed write cannot leave
      // an expense saved without its corresponding inventory movement.
      const ref=doc(collection(db,CONFIG.COL.expenses));
      const stockMovements=new Map();
      for(const item of items){
        if(!item._ex||!item._stock) continue;
        const id=String(item._ex.id);
        const movement=stockMovements.get(id)||{qty:0,rate:item.rate};
        movement.qty+=item.qty;
        if(!(movement.rate>0)&&item.rate>0) movement.rate=item.rate;
        stockMovements.set(id,movement);
      }
      await runTransaction(db,async tx=>{
        const movements=[];
        for(const [id,movement] of stockMovements){
          const itemRef=doc(db,CONFIG.COL.inventory,id);
          const snap=await tx.get(itemRef);
          if(!snap.exists()) throw new Error('An inventory item disappeared while saving this bill. Refresh and retry.');
          movements.push({id,ref:itemRef,data:snap.data(),movement});
        }
        tx.set(ref,doc0);
        for(const entry of movements){
          const update={stockQuantity:Math.max(0,num(entry.data.stockQuantity))+entry.movement.qty,updatedAt:serverTimestamp()};
          if(!num(entry.data.unitCost)&&entry.movement.rate>0) update.unitCost=entry.movement.rate;
          tx.update(entry.ref,update);
        }
      });
      toast('Bill saved · '+money(total,2));
      const seen=new Set(), queue=[];
      clean.forEach((i,idx)=>{const k=normName(i.itemName);if(!i.inInventory&&!seen.has(k)){seen.add(k);queue.push(idx);}});
      if(queue.length){closeModal();runNewItemQueue(ref.id,clean,queue,queue.length);return false;}
    }}); qsa('#exRows .exi-name')[0]?.focus(); },
  'exp-filter': d => { expenseModule.setFilter(d.f || 'all'); renderLocalExpenseLedger(); },
  'delete-local-expense': d => openForm({title:'Delete local expense',submit:'Delete',danger:true,html:'This expense record will be permanently deleted.',onSubmit:async()=>{await deleteDoc(doc(db,CONFIG.COL.expenses,d.id));toast('Expense deleted');}}),
  'add-part': () => openForm({ title: 'Create item master', submit: 'Create item',
    html: fld('Part / Product name', '<input id="pName" placeholder="e.g. Diesel or Petrol">', 'For Fuel Ops insights, use the exact item names Diesel or Petrol and choose category Fuel.') + fld('Category', '<select id="pCat" data-chg="part-category"><option value="Spare Parts">Spare Parts</option><option value="Fuel">Fuel</option><option value="Fertilizers">Fertilizers</option><option value="Pesticides">Pesticides</option><option value="Turf Enhancements">Turf Enhancements</option><option value="Tools">Tools</option><option value="Other">Other</option></select>') + `<div id="pModelWrap">${fld('Applicable Machine / Model', `<select id="pModel">${machineOptions("", "Generic (Use for All Machines)")}</select>`, 'Only relevant for machine spare parts.')}</div>` + `<div class="row2">${fld('Opening stock', '<input id="pStock" type="number" min="0" step="any" value="0">')}${fld('Automatic reorder threshold', '<div class="auto-reorder-form-note"><b>Calculated automatically</b><small>Uses recent issue history, lead-time policy and a safety buffer.</small></div>')}</div>` + fld('Unit of measure', '<select id="pUnit"><option>Nos</option><option>Kg</option><option>Litre</option><option>Gram</option><option>ML</option><option>Bag</option><option>Pack</option></select>') + fld('Unit cost · ₹ per stock unit', '<input id="pUnitCost" type="number" min="0" step="0.01" value="0">', '0 = unknown. Enter supplier cost to unlock stock valuation and turf plan costing.'),
    onSubmit: async () => { const n = $('#pName').value.trim(); if (!n) { toast('Part name is required', 'err'); return false; } const cat = $('#pCat').value, mVal = cat === 'Spare Parts' ? $('#pModel').value : ''; const item = { partName: n, category: cat, stockQuantity: Math.max(0,num($('#pStock').value)), unit: $('#pUnit').value, reorderLevel: 0, unitCost: Math.max(0, num($('#pUnitCost').value)) }; if (cat === 'Spare Parts') item.compatibleModel = mVal ? mName(mVal) : 'Generic'; await addDoc(collection(db, CONFIG.COL.inventory), item); toast('Item master created'); } }),
  stock: async d => { try { await updateDoc(doc(db, CONFIG.COL.inventory, d.id), { stockQuantity: increment(+d.d) }); } catch (e) { toast('Could not update stock', 'err'); } },
  'add-inc': () => openForm({ title: 'Report incident', submit: 'Submit report',
    html: fld('Machine', `<select id="iMach">${machineOptions('', 'General / no machine')}</select>`) + fld('Type', '<select id="iType"><option>Breakdown</option><option>Maintenance</option><option>Safety</option><option>Other</option></select>') + fld('What happened?', '<textarea id="iDesc" placeholder="Describe the issue"></textarea>') + fld('Estimated downtime · hours (optional)', '<input id="iDownHours" type="number" min="0" step="0.5" value="0">', 'Planning estimate only. Record actual downtime separately if you need realised loss reporting.'),
    onSubmit: async () => { const desc = $('#iDesc').value.trim(); if (!desc) { toast('Please describe the issue', 'err'); return false; } const mid = $('#iMach').value; await addDoc(collection(db, CONFIG.COL.logs), { machineId: mid ? mName(mid) : 'General', logType: $('#iType').value, issueDescription: desc, repairStatus: 'Pending', estimatedDowntimeHours: Math.max(0, num($('#iDownHours').value)), createdAt: Date.now(), reportedDate: today() }); toast('Incident reported'); } }),
  'inc-toggle': async d => { const l = S.logs.find(x => x.id === d.id); if (!l) return; try { await updateDoc(doc(db, CONFIG.COL.logs, d.id), { repairStatus: l.repairStatus === 'Resolved' ? 'Pending' : 'Resolved' }); } catch (e) { toast('Could not update incident', 'err'); } }
};
const C = {
  'users-search': v => { storeUiModule.setUsersSearchText(v || ''); renderUsersMaster(); },
  'users-role-filter': v => { storeUiModule.setUsersRoleFilter(v || 'all'); renderUsersMaster(); },
  rfrom: (v, d) => { const st = R[d.k]; if (!v) return; st.from = v; st.preset = 'custom'; if (st.to < v) st.to = v; RER[d.k](); },
  rto: (v, d) => { const st = R[d.k]; if (!v) return; st.to = v; st.preset = 'custom'; if (st.from > v) st.from = v; RER[d.k](); },
  lmachine: (v, d) => { R.ledger.machine = v; RER.ledger(); }, ltype: (v) => { R.ledger.type = v; RER.ledger(); },
  'turf-week': v => { if(v) { turfModule.setCurrentWeek(getSunday(v)); renderTurfCare(); } },
  'turf-app-category': v => { turfModule.setAppCategory(v); renderTurfApplications(); },
  'turf-app-status': v => { turfModule.setAppStatus(v); renderTurfApplications(); },
  'turf-product-category': v => { turfModule.setProductCategory(v); renderTurfCare(); },
  'spray-product': v => { const product = S.inventory.find(i => i.id === v && isTurfCategory(i.category)); const unit = $('#spUnit'); if (unit) unit.value = turfProductUnit(product) || 'Unit not set'; },
  'tp-product': (v, d) => { const product = S.inventory.find(i => i.id === v && isTurfCategory(i.category)); const unit = $('#tpUnit_' + d.day); if (unit) unit.value = turfProductUnit(product) || 'Unit not set'; calcTot(d.day); },
  'tp-start': v => { tpState.start = v; }, 'tp-weeks': v => { tpState.weeks = parseInt(v) || 1; }, 'tp-scope': (v, d) => calcTot(d.day), drdate: (v, d) => drawerRoute(d.id, v), smachine: (v) => { R.shifts.machine = v; RER.shifts(); }, sop: (v) => { R.shifts.op = v; RER.shifts(); },
  fleetsort: v => { F.sort = v; renderFleet(); },
  'inward-category': () => updateInwardItems(),
  'inward-gst': () => previewInward(),
  'part-category': v => { const w = $('#pModelWrap'); if (w) w.hidden = v !== 'Spare Parts'; const unit = $('#pUnit'); if (unit && v === 'Fuel') unit.value = 'Litre'; }
};
  return { H, C };
}
