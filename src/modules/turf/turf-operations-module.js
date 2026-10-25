/** Turf workboard, application logs, planning and variance workflows. */
export function createTurfOperationsModule(deps) {
  const { $, CONFIG, LOADED, S, addDays, addDoc, app, autoReorderDetails, closeModal, collection, dShort, db, downloadCSV, effectiveReorderLevel, esc, fld, fmt, getSunday, isTurfCategory, itemName, money, monthStart, normDate, num, openModal, qsa, setHTML, sum, toast, today, tpState, tsMs, turfCategoryClass, turfCategoryLabel, turfCostLine, turfPlanCategory, turfProductUnit, turfRecordDate, turfRecordProductName, turfRecordQuantity, turfRecordStatus } = deps;
let currentTurfWeekStart = "";
let turfSection = 'workboard';
let turfAppCategory = 'All categories';
let turfAppStatus = 'All statuses';
let turfAppSearch = '';
let turfProductCategory = 'All categories';
function setTurfSection(section) {
  turfSection = ['workboard','applications','products'].includes(section) ? section : 'workboard';
  renderTurfCare();
}
function renderTurfCategoryCards(targetId, products) {
  const categories = [
    { label:'Fertilizers', icon:'spa', cls:'fertilizer' },
    { label:'Pesticides', icon:'pest_control', cls:'pesticide' },
    { label:'Turf Enhancements', icon:'eco', cls:'enhancer' }
  ];
  const target = $(targetId);
  if (!target) return;
  setHTML(target, categories.map(cat => {
    const items = products.filter(i => turfCategoryLabel(i.category) === cat.label);
    const low = items.filter(i => num(i.stockQuantity) <= effectiveReorderLevel(i));
    return `<button class="turf-stock-category ${cat.cls}" data-act="turf-category-products" data-category="${esc(cat.label)}"><span class="turf-stock-cat-icon"><span class="material-symbols-rounded">${cat.icon}</span></span><span class="turf-stock-cat-main"><b>${esc(cat.label === 'Turf Enhancements' ? 'Turf enhancers' : cat.label)}</b><span>${items.length} product${items.length===1?'':'s'}</span></span><span class="turf-stock-cat-alert ${low.length?'warn':''}">${low.length} low</span></button>`;
  }).join(''));
}
function renderTurfApplications() {
  const target = $('#turfApplicationsTbl');
  if (!target) return;
  const all = [...(S.plans || [])].filter(p => isTurfCategory(turfPlanCategory(p)));
  const q = turfAppSearch.trim().toLowerCase();
  const rows = all.filter(p => {
    const category = turfPlanCategory(p);
    const status = turfRecordStatus(p);
    const searchText = [p.productName, p.targetArea, p.notes, category, status, p.date].join(' ').toLowerCase();
    return (turfAppCategory === 'All categories' || category === turfAppCategory) &&
      (turfAppStatus === 'All statuses' || status === turfAppStatus) && (!q || searchText.includes(q));
  }).sort((a,b) => turfRecordDate(b).localeCompare(turfRecordDate(a)) || tsMs(b.createdAt ?? b.timestamp)-tsMs(a.createdAt ?? a.timestamp));
  const count = $('#turfApplicationCount');
  if (count) count.textContent = `${rows.length} record${rows.length===1?'':'s'}`;
  setHTML(target, `<table><thead><tr><th>Date</th><th>Category</th><th>Product</th><th class="num">Quantity</th><th>Treated area</th><th>Status</th><th>Notes</th></tr></thead><tbody>${!LOADED.plans ? '<tr><td colspan="7">Loading application records…</td></tr>' : rows.length ? rows.map(p => {
    const category = turfPlanCategory(p), status = turfRecordStatus(p);
    return `<tr><td>${esc(turfRecordDate(p) || '—')}<div class="muted sm">${p.createdAt ? 'Entered '+esc(dShort(normDate(null,p.createdAt))) : ''}</div></td><td><span class="badge ${turfCategoryClass(category)}">${esc(category)}</span></td><td><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b></td><td class="num">${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || '')}</td><td>${esc(p.targetArea || p.area || p.location || 'Course')}</td><td><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></td><td class="muted">${esc(p.notes || p.reason || '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No application records match these filters.</td></tr>'}</tbody></table>`);
}
function renderTurfCare() {
  if (!currentTurfWeekStart) currentTurfWeekStart = getSunday(today());
  const weekStartEl = $('#turfWeekStart');
  if (weekStartEl && weekStartEl.value !== currentTurfWeekStart) weekStartEl.value = currentTurfWeekStart;

  // Keep the three workspaces focused. All panels still use the same live Firestore data.
  ['workboard','applications','products'].forEach(name => {
    const pane = $('#turf'+name.charAt(0).toUpperCase()+name.slice(1)+'Pane');
    if (pane) pane.hidden = turfSection !== name;
  });
  qsa('#v-turfcare .turf-view-tab').forEach(btn => {
    const active = btn.dataset.tab === turfSection;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  if ($('#turfLogSearch') && $('#turfLogSearch').value !== turfAppSearch) $('#turfLogSearch').value = turfAppSearch;
  if ($('#turfAppCategoryFilter')) $('#turfAppCategoryFilter').value = turfAppCategory;
  if ($('#turfAppStatusFilter')) $('#turfAppStatusFilter').value = turfAppStatus;
  if ($('#turfProductCategoryFilter')) $('#turfProductCategoryFilter').value = turfProductCategory;

  const turfItems = S.inventory.filter(i => isTurfCategory(i.category));
  const lowStock = turfItems.filter(i => num(i.stockQuantity) <= effectiveReorderLevel(i));
  const todayStr = today();
  const allPlans = (S.plans || []).filter(p => isTurfCategory(turfPlanCategory(p)));
  const plannedThisWeek = allPlans.filter(p => turfRecordDate(p) >= currentTurfWeekStart && turfRecordDate(p) <= addDays(currentTurfWeekStart,6) && turfRecordStatus(p) === 'Planned');
  const monthStartStr = monthStart(todayStr);
  const issuedAppliedMTD = allPlans.filter(p => turfRecordDate(p) >= monthStartStr && turfRecordDate(p) <= todayStr && turfRecordStatus(p)==='Issued').length;
  const overduePlans = allPlans.filter(p => turfRecordDate(p) && turfRecordDate(p) < todayStr && turfRecordStatus(p) === 'Planned');
  setHTML($('#turfKpiGrid'), [
    {label:'Scheduled this week',value:plannedThisWeek.length,sub:'Planned tasks in selected week',icon:'calendar_month',cls:'green'},
    {label:'Issued / applied · MTD',value:issuedAppliedMTD,sub:'Movement or application status recorded',icon:'task_alt',cls:'gold'},
    {label:'Past due',value:overduePlans.length,sub:'Not marked applied',icon:'event_busy',cls:overduePlans.length?'warn':'green'},
    {label:'Low-stock products',value:lowStock.length,sub:'At or below reorder level',icon:'inventory',cls:lowStock.length?'warn':'green'}
  ].map(k=>`<div class="turf-metric-card"><span class="turf-metric-icon ${k.cls}"><span class="material-symbols-rounded">${k.icon}</span></span><div class="turf-metric-copy"><span>${esc(k.label)}</span><b>${fmt(k.value,0)}</b><small>${esc(k.sub)}</small></div></div>`).join(''));

  // Weekly workboard: focus today (or the week's first day when browsing another week), with the remaining days stacked alongside.
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dates = Array.from({length:7},(_,i)=>addDays(currentTurfWeekStart,i));
  const weekPlans = allPlans.filter(p => (turfRecordDate(p) && turfRecordDate(p) >= currentTurfWeekStart && turfRecordDate(p) <= addDays(currentTurfWeekStart,6)) || (!turfRecordDate(p) && p.weekStart === currentTurfWeekStart));
  const plansForDay = (dateStr, idx) => weekPlans.filter(p => (turfRecordDate(p) ? turfRecordDate(p) === dateStr : p.weekStart === currentTurfWeekStart && num(p.dayIndex) === idx));
  const focusDate = dates.includes(todayStr) ? todayStr : currentTurfWeekStart;
  const focusIdx = dates.indexOf(focusDate);
  const makePlanRow = (plan, compact=false) => {
    const cat = turfPlanCategory(plan), status = turfRecordStatus(plan);
    const productName = turfRecordProductName(plan) || 'Unspecified product';
    const quantityLabel = `${fmt(turfRecordQuantity(plan),2)} ${plan.unit || plan.stockUnit || 'units'}`;
    const treatedArea = plan.targetArea || plan.area || plan.location || 'Course';
    const line = turfCostLine(plan);
    const costLabel = line.countable ? (line.cost !== null ? money(line.cost) : 'Unpriced') : 'Planned';
    return `<div class="turf-plan-item ${turfCategoryClass(cat)}" title="${esc(`${productName} · ${quantityLabel} · ${treatedArea} · ${status}`)}"><span class="turf-plan-inline-dot" aria-hidden="true"></span><span class="turf-plan-title">${esc(productName)} <small style="font-size:9px;font-weight:600;color:var(--muted)">· ${esc(treatedArea)}</small></span><span class="turf-plan-inline-qty">${fmt(turfRecordQuantity(plan),2)} ${esc(plan.unit || plan.stockUnit || 'units')}</span><span class="turf-plan-row-value">${esc(costLabel)}</span><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></div>`;
  };
  const focusPlans = plansForDay(focusDate, focusIdx);
  const focusLines = focusPlans.map(turfCostLine).filter(line => line.countable);
  const focusPriced = focusLines.filter(line => line.cost !== null);
  const focusCostLabel = !focusLines.length ? '₹0' : !focusPriced.length ? '₹—' : money(focusPriced.reduce((sum,line)=>sum+line.cost,0));
  const focusIssuedCount = focusLines.length;
  const focusCostHint = !focusLines.length ? 'No issued / applied records' : !focusPriced.length ? 'No compatible unit cost' : `${focusPriced.length} priced · ${focusLines.length-focusPriced.length} unpriced`;
  const otherDays = dates.map((dateStr,idx)=>({dateStr,idx,plans:plansForDay(dateStr,idx)})).filter(day=>day.dateStr!==focusDate);
  const dayCard = (day, featured=false) => {
    const {dateStr,idx,plans:dayPlans}=day;
    const todayClass = dateStr===todayStr ? ' today' : '';
    const headLabel = dateStr===todayStr ? 'Today' : featured ? 'Week focus' : dayNames[idx];
    if (featured) {
      const issuedCount = dayPlans.filter(p=>['Issued','Applied'].includes(turfRecordStatus(p))).length;
      const tasksCount = dayPlans.length;
      const planRows = dayPlans.length ? dayPlans.map(p=>makePlanRow(p)).join('') : '<div class="turf-empty-day featured-empty"><span class="material-symbols-rounded">event_available</span><b>No work planned</b><span>Add the first application task for this day.</span></div>';
      return `<article class="turf-day-card turf-day-featured${todayClass}">
        <div class="turf-featured-head"><div><span class="turf-focus-eyebrow">${dateStr===todayStr?'CURRENT DAY':'SELECTED WEEK'}</span><h3>${esc(dayNames[idx])}<span>${esc(dShort(dateStr))}</span></h3></div>${dateStr===todayStr?'<span class="turf-today-pill">Today</span>':'<span class="turf-focus-pill">Week focus</span>'}</div>
        <div class="turf-focus-metrics"><div><small>Scheduled products</small><b>${fmt(tasksCount,0)}</b></div><div><small>Issued / applied</small><b>${fmt(issuedCount,0)}</b></div><div title="Issued/applied quantity × matching Inventory Master unit cost"><small>Priced value</small><b>${esc(focusCostLabel)}</b><span>${esc(focusCostHint)}</span></div></div>
        <div class="turf-featured-list-heading"><span>PRODUCT & STATUS</span><span>QTY / VALUE</span></div>
        <div class="turf-day-plans turf-featured-plans">${planRows}</div>
        <div class="turf-featured-foot"><span>Recorded status only · cost requires a matching stock unit and unit rate</span><button class="turf-add-day" data-act="add-spray" data-day="${idx}" data-date="${dateStr}"><span class="material-symbols-rounded">add</span>Add task</button></div>
      </article>`;
    }
    const issuedCount=dayPlans.filter(p=>['Issued','Applied'].includes(turfRecordStatus(p))).length;
    const daySummary=dayPlans.length ? `${dayPlans.length} item${dayPlans.length===1?'':'s'} · ${issuedCount} issued/applied` : 'No work planned';
    const topNames=dayPlans.slice(0,2).map(p=>`${turfRecordProductName(p)||'Unspecified product'} · ${p.targetArea||p.area||p.location||'Course'} · ${fmt(turfRecordQuantity(p),2)} ${p.unit||p.stockUnit||'units'}`).join(' · ');
    return `<article class="turf-week-side-card${todayClass}"><div class="turf-week-side-date"><b>${esc(dayNames[idx])}</b><span>${esc(dShort(dateStr))}</span>${dateStr===todayStr?'<span class="turf-today-pill">Today</span>':''}</div><div class="turf-week-side-main"><div class="turf-week-side-summary">${esc(daySummary)}</div><div class="turf-week-side-products">${esc(topNames || 'Ready for scheduling')}${dayPlans.length>2?` · +${dayPlans.length-2} more`:''}</div></div><button class="turf-add-day compact" data-act="add-spray" data-day="${idx}" data-date="${dateStr}" aria-label="Add application for ${dayNames[idx]}"><span class="material-symbols-rounded">add</span><span>Add</span></button></article>`;
  };
  const focusDayMarkup=dayCard({dateStr:focusDate,idx:focusIdx,plans:focusPlans},true);
  setHTML($('#turfPlannerGrid'), `<div class="turf-week-layout"><div class="turf-week-focus-column">${focusDayMarkup}</div><div class="turf-week-side-stack" aria-label="Other days in selected week">${otherDays.map(day=>dayCard(day,false)).join('')}</div></div>`);

  // Needs-attention queue: overdue first, then the nearest upcoming planned tasks.
  const attention = allPlans.filter(p => turfRecordStatus(p) === 'Planned' && turfRecordDate(p))
    .sort((a,b) => ((turfRecordDate(a) < todayStr ? 0 : 1) - (turfRecordDate(b) < todayStr ? 0 : 1)) || turfRecordDate(a).localeCompare(turfRecordDate(b))).slice(0,5);
  const attCount = $('#turfActionCount'); if (attCount) attCount.textContent = String(overduePlans.length);
  setHTML($('#turfActionList'), attention.length ? attention.map(p => {
    const overdue = turfRecordDate(p) < todayStr, cat = turfPlanCategory(p);
    return `<div class="turf-attention-row"><span class="turf-attention-indicator ${overdue?'late':turfCategoryClass(cat)}"></span><div class="turf-attention-main"><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b><span>${esc(cat)} · ${esc(p.targetArea || p.area || p.location || 'Course')}</span><small>${esc(turfRecordDate(p))} · ${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || 'units')}</small></div><span class="badge ${overdue?'bad':'warn'}">${overdue?'Overdue':'Planned'}</span></div>`;
  }).join('') : '<div class="turf-empty-state"><span class="material-symbols-rounded">task_alt</span><b>Nothing overdue</b><span>No uncompleted plans need attention.</span></div>');

  renderTurfCategoryCards('#turfStockCategoryCards', turfItems);
  renderTurfCategoryCards('#turfStockCategoryCardsExpanded', turfItems);

  const recent = [...allPlans].sort((a,b) => turfRecordDate(b).localeCompare(turfRecordDate(a)) || tsMs(b.createdAt ?? b.timestamp)-tsMs(a.createdAt ?? a.timestamp)).slice(0,5);
  setHTML($('#turfRecentApplications'), recent.length ? recent.map(p => {
    const cat=turfPlanCategory(p), status=turfRecordStatus(p);
    return `<div class="turf-recent-row"><span class="turf-recent-type ${turfCategoryClass(cat)}"><span class="material-symbols-rounded">${cat==='Pesticides'?'pest_control':cat==='Turf Enhancements'?'eco':'spa'}</span></span><div class="turf-recent-main"><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b><span>${esc(p.targetArea || p.area || p.location || 'Course')} · ${esc(turfRecordDate(p) || 'No date')}</span></div><div class="turf-recent-qty"><b>${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || '')}</b><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></div></div>`;
  }).join('') : '<div class="turf-empty-state">No application records have been added yet.</div>');

  // Product register: category-first, concise and stock-oriented.
  const filteredProducts = turfItems.filter(i => turfProductCategory === 'All categories' || turfCategoryLabel(i.category) === turfProductCategory).sort((a,b)=>itemName(a).localeCompare(itemName(b)));
  setHTML($('#turfInvTbl'), `<table><thead><tr><th>Product</th><th>Category</th><th>Unit</th><th class="num">On hand</th><th class="num">Auto reorder at</th><th class="num">Unit rate</th><th>Status</th><th>Actions</th></tr></thead><tbody>${!LOADED.inventory?'<tr><td colspan="8">Loading products…</td></tr>':filteredProducts.length?filteredProducts.map(i=>{
    const low=num(i.stockQuantity)<=effectiveReorderLevel(i);
    return `<tr><td><b>${esc(itemName(i))}</b></td><td><span class="badge ${turfCategoryClass(i.category)}">${esc(turfCategoryLabel(i.category))}</span></td><td>${esc(i.unit || 'Nos')}</td><td class="num"><b>${fmt(i.stockQuantity,3)}</b></td><td class="num"><b>${fmt(effectiveReorderLevel(i),3)}</b><div class="muted sm">${autoReorderDetails(i).reliable?'Trend-based':'Provisional'}</div></td><td class="num">${num(i.unitCost)>0?money(i.unitCost,2):'—'}</td><td><span class="badge ${low?'warn':'ok'}">${low?'Reorder':'In stock'}</span></td><td class="right nowrap"><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}" title="Edit product"><span class="material-symbols-rounded">edit</span></button></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="empty">No turf products in this category. Add a product in the item master first.</td></tr>'}</tbody></table>`);
  renderTurfApplications();
  renderTurfAreaPlanDashboard();
}

function openAddSprayTaskForm(dayIdx, dateStr) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const products = S.inventory.filter(i => isTurfCategory(i.category));
  if (!products.length) { toast('Add turf products in Products & stock before planning applications.', 'warn'); setTurfSection('products'); return; }
  const options = '<option value="">Choose product…</option>' + products.map(p => `<option value="${esc(p.id)}">${esc(itemName(p))} · ${esc(turfCategoryLabel(p.category))} · ${esc(turfProductUnit(p)||'Unit not set')}</option>`).join('');
  const rows = Array.from({length:10},(_,i)=>`<div class="turf-batch-entry-row"><span class="turf-batch-row-num">${i+1}</span><select id="turfBatchProd${i}" aria-label="Product row ${i+1}">${options}</select><input id="turfBatchQty${i}" type="number" min="0.01" step="any" placeholder="Qty" aria-label="Quantity row ${i+1}"><span class="muted sm turf-batch-area" style="font-size:10px">Area selected above</span></div>`).join('');
  const areas=['Greens','Fairway','Nursery','Driving Range','Short Game Area','Roughs'];
  const weekdayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  openModal({title:`Plan treatments · ${dayNames[Number(dayIdx)] || 'Selected day'}`,sub:`${dShort(dateStr)} · Schedule up to 10 products`,size:'turf-batch-modal',body:`<div class="turf-batch-modal-body"><div class="muted sm">Choose the course area and validity window. Selected weekdays create a scheduled task for each matching date. Empty product rows are ignored; inventory is not deducted until issue is recorded.</div><div class="turf-plan-schedule-grid"><label>Course area<select id="turfBatchArea">${areas.map(a=>`<option value="${a}" ${a==='Greens'?'selected':''}>${a}</option>`).join('')}</select></label><label>Valid from<input type="date" id="turfBatchFrom" value="${esc(dateStr)}" required></label><label>Valid until<input type="date" id="turfBatchUntil" value="${esc(dateStr)}" required></label></div><fieldset class="turf-weekday-picks"><legend>Repeat on weekdays</legend>${weekdayNames.map((d,i)=>`<label><input type="checkbox" name="turfBatchWeekday" value="${i}" ${i===Number(dayIdx)?'checked':''}>${d.slice(0,3)}</label>`).join('')}</fieldset><div class="turf-batch-entry-grid" style="padding:0 8px"><label>Product</label><label>Planned quantity</label><label>Area</label></div><div class="turf-batch-entry-list">${rows}</div><label style="display:grid;gap:5px;font-size:10px;color:var(--muted);font-weight:700">Shared planning notes<textarea id="turfBatchNotes" rows="2" placeholder="Purpose, rate reference or planning notes"></textarea></label><input type="hidden" id="turfBatchDay" value="${Number(dayIdx)}"><input type="hidden" id="turfBatchDate" value="${esc(dateStr)}"></div>`,footer:`<button class="btn" data-act="close-modal">Cancel</button><button class="btn btn-primary" data-act="save-turf-batch"><span class="material-symbols-rounded">playlist_add_check</span>Save schedule</button>`});
}
async function saveTurfBatch() {
  const dayIdx = Number($('#turfBatchDay')?.value), fallbackDate = $('#turfBatchDate')?.value;
  const from = $('#turfBatchFrom')?.value || fallbackDate, until = $('#turfBatchUntil')?.value || fallbackDate;
  const area = $('#turfBatchArea')?.value || 'Greens';
  const weekdays = qsa('input[name="turfBatchWeekday"]:checked').map(x=>Number(x.value));
  const notes = $('#turfBatchNotes')?.value?.trim() || '';
  if(!from || !until || until < from){toast('Choose a valid date range.','err');return;}
  if(!weekdays.length){toast('Select at least one weekday.','err');return;}
  const rows=[];
  for(let i=0;i<10;i++){
    const productId=$(`#turfBatchProd${i}`)?.value, qty=num($(`#turfBatchQty${i}`)?.value);
    if(!productId && !(qty>0)) continue;
    const product=S.inventory.find(p=>p.id===productId&&isTurfCategory(p.category));
    if(!product){toast(`Choose a valid product in row ${i+1}.`,'err');return;}
    if(!(qty>0)){toast(`Enter a quantity greater than zero in row ${i+1}.`,'err');return;}
    const unit=turfProductUnit(product);if(!unit){toast(`Set the stock unit for ${itemName(product)} in Products & stock first.`,'err');return;}
    rows.push({product,qty,unit});
  }
  if(!rows.length){toast('Add at least one product and quantity.','warn');return;}
  const dates=[];for(let d=from;d<=until;d=addDays(d,1)){const date=new Date(`${d}T12:00:00`);if(weekdays.includes(date.getDay()))dates.push(d);if(d===until)break;}
  if(!dates.length){toast('No dates in this range match the selected weekdays.','err');return;}
  if(dates.length*rows.length>500){toast('This schedule creates more than 500 tasks. Narrow the date range or weekdays.','err');return;}
  try{
    for(const dateStr of dates){const dateObj=new Date(`${dateStr}T12:00:00`);for(const r of rows) await addDoc(collection(db,CONFIG.COL.plans),{weekStart:currentTurfWeekStart,date:dateStr,dayIndex:dateObj.getDay(),productId:r.product.id,productName:itemName(r.product),category:r.product.category||'Fertilizers',targetQty:r.qty,unit:r.unit,targetArea:area,area,validFrom:from,validUntil:until,repeatWeekdays:weekdays,notes,status:'Planned',createdAt:Date.now()});}
    closeModal();toast(`${rows.length} product${rows.length===1?'':'s'} scheduled for ${dates.length} date${dates.length===1?'':'s'} in ${area}.`);renderTurfCare();
  }catch(e){console.error(e);toast('Schedule save failed. Some tasks may have saved; refresh and verify before retrying.','err');}
}
function renderTurfAreaPlanDashboard(){
  const el=$('#opsTurfAreaPlan'); if(!el)return;
  const todayStr=today();
  const areaName=p=>String(p.targetArea||p.area||p.location||'').trim();
  const plannedQty=p=>num(p.targetQty??p.plannedQty??p.requestedQty??p.plannedQuantity??p.targetQuantity??(turfRecordStatus(p)==='Planned'?(p.quantity??p.qty):0));
  const plans=(S.plans||[]).filter(p=>isTurfCategory(turfPlanCategory(p))&&turfRecordDate(p)===todayStr&&turfRecordStatus(p)!=='Cancelled')
    .sort((a,b)=>areaName(a).localeCompare(areaName(b))||turfRecordProductName(a).localeCompare(turfRecordProductName(b)));
  const areas=['Greens','Fairway','Nursery','Driving Range','Short Game Area','Roughs'];
  const grouped=areas.map(area=>({area,rows:plans.filter(p=>areaName(p).toLowerCase()===area.toLowerCase())})).filter(g=>g.rows.length);
  const unknown=plans.filter(p=>!areas.some(a=>a.toLowerCase()===areaName(p).toLowerCase()));
  if(unknown.length)grouped.push({area:'Other / Unassigned',rows:unknown});
  el.innerHTML=grouped.length?grouped.map(g=>`<div class="ops-turf-area-row"><div class="ops-turf-area-row-head"><b>${esc(g.area)}</b><span>${g.rows.length} task${g.rows.length===1?'':'s'}</span></div>${g.rows.slice(0,6).map(p=>`<div class="ops-turf-area-task"><span>${esc(turfRecordProductName(p)||'Product')}</span><span>${esc(turfRecordStatus(p))}</span><b>${fmt(plannedQty(p),2)} ${esc(p.unit||p.stockUnit||'units')}</b></div>`).join('')}${g.rows.length>6?`<div class="muted sm">+${g.rows.length-6} more today</div>`:''}</div>`).join(''):'<div class="ops-product-compare-empty">No area-wise treatments scheduled for today.</div>';
}

function openTurfVarianceModal(from=monthStart(today()),to=today()) {
  const body=`<div class="turf-variance-filters"><label>From date<input type="date" id="turfVarianceFrom" value="${esc(from)}"></label><label>To date<input type="date" id="turfVarianceTo" value="${esc(to)}"></label><button class="btn btn-primary" data-act="apply-turf-variance">Apply range</button><button class="btn" data-act="export-turf-variance">Export CSV</button></div><div id="turfVarianceResults"></div>`;
  openModal({title:'Turf Ops · Planned vs issued variance',sub:'Product-level reconciliation · quantities remain separated by stock unit',size:'turf-cost-analytics',body,footer:'<button class="btn" data-act="close-modal">Close</button>'});
  renderTurfVariance(from,to);
}
function renderTurfVariance(from,to){
  const target=$('#turfVarianceResults');if(!target)return;
  const rows=(S.plans||[]).filter(p=>isTurfCategory(turfPlanCategory(p))&&turfRecordDate(p)>=from&&turfRecordDate(p)<=to&&turfRecordStatus(p)!=='Cancelled');
  const map = new Map();
  const firstQuantity = (record, keys) => {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) {
        return { found: true, value: Math.max(0, Number(value)) };
      }
    }
    return { found: false, value: 0 };
  };
  const planKeys = ['targetQty','plannedQty','requestedQty','plannedQuantity','targetQuantity'];
  const explicitIssuedKeys = ['issuedQty','issuedQuantity','issueQty','issueQuantity','quantityIssued','qtyIssued','quantityOut','qtyOut'];
  const actualKeys = ['actualQty','appliedQty','applicationQty','quantityUsed','usedQuantity','qtyUsed','dispensedQty'];
  for (const p of rows) {
    const status = turfRecordStatus(p);
    const hasPlan = planKeys.some(k => p[k] !== undefined && p[k] !== null && p[k] !== '');
    const explicitIssued = firstQuantity(p, explicitIssuedKeys);
    const actual = firstQuantity(p, actualKeys);
    const issued = status === 'Issued' || status === 'Applied' || (explicitIssued.found && explicitIssued.value > 0);
    const planned = status === 'Planned' || hasPlan || p.wasPlanned === true || p.fromPlan === true || p.planned === true;
    if (!issued && !planned) continue;

    const name = turfRecordProductName(p) || 'Unspecified product';
    const unit = String(p.unit ?? p.stockUnit ?? p.uom ?? p.unitOfMeasure ?? 'unit not set').trim();
    const productKey = String(p.productId ?? p.productID ?? p.itemId ?? p.inventoryId ?? name).trim().toLowerCase();
    const key = productKey + '|' + unit.toLowerCase();
    if (!map.has(key)) map.set(key, {name,unit,planned:0,issued:0,plannedCount:0,issuedCount:0});
    const row = map.get(key);

    const planQuantity = firstQuantity(p, planKeys);
    const plannedQty = planQuantity.found
      ? planQuantity.value
      : (status === 'Planned' ? firstQuantity(p, ['quantity','qty']).value : 0);

    // Legacy records that only store targetQty and status=Issued/Applied still represent issued movement.
    const issuedQuantity = explicitIssued.found
      ? explicitIssued.value
      : actual.found
        ? actual.value
        : (issued ? (plannedQty || firstQuantity(p, ['quantity','qty']).value) : 0);

    if (planned) { row.planned += plannedQty; row.plannedCount++; }
    if (issued) { row.issued += issuedQuantity; row.issuedCount++; }
  }
  const list=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));window.__turfVarianceRows=list.map(r=>({...r,variance:r.issued-r.planned}));
  target.innerHTML=list.length?`<div class="table-wrap"><table class="turf-variance-table"><thead><tr><th>Product</th><th>Planned</th><th>Issued</th><th>Variance</th><th>Records</th></tr></thead><tbody>${list.map(r=>`<tr><td><b>${esc(r.name)}</b><div class="muted sm">${esc(r.unit)}</div></td><td>${fmt(r.planned,2)}</td><td>${fmt(r.issued,2)}</td><td style="color:${r.issued>r.planned?'var(--bad)':r.issued<r.planned?'var(--warn)':'var(--ok)'};font-weight:800">${r.issued-r.planned>0?'+':''}${fmt(r.issued-r.planned,2)}</td><td>${r.plannedCount} / ${r.issuedCount}</td></tr>`).join('')}</tbody></table></div><p class="muted sm">Variance = issued quantity minus planned quantity. Product quantities are not combined across units.</p>`:'<div class="ops-product-compare-empty">No planned or issued turf records found in this date range.</div>';
}
function exportTurfVariance(){const rows=window.__turfVarianceRows||[];downloadCSV('turf-planned-vs-issued-variance.csv',[['Product','Unit','Planned quantity','Issued quantity','Variance','Planned records','Issued records'],...rows.map(r=>[r.name,r.unit,r.planned,r.issued,r.variance,r.plannedCount,r.issuedCount])]);}







function openTurfPlanner() {
  tpState = { start: currentTurfWeekStart || getSunday(today()), weeks: 1, days: [[],[],[],[],[],[],[]], activeDay: -1 };
  openModal({
    title: 'Weekly Turf Application Planner',
    size: 'lg',
    body: '<div id="tpContainer"></div>',
    footer: '<button class="btn" data-act="close-modal">Cancel</button><button class="btn btn-primary" data-act="save-turf-plan">Save Weekly Plan</button>'
  });
  renderTp();
}

function renderTp() {
  const c = $('#tpContainer');
  if (!c) return;
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const products = S.inventory.filter(i => isTurfCategory(i.category));
  const pOptions = products.map((p,idx) => `<option value="${esc(p.id)}" ${idx===0?'selected':''}>${esc(itemName(p))} (${esc(turfCategoryLabel(p.category))} · Stock: ${fmt(p.stockQuantity,3)} ${esc(turfProductUnit(p) || 'UNIT NOT SET')})</option>`).join("");

  const unitTotals = {};
  tpState.days.forEach(day => day.forEach(app => { const u = String(app.unit || 'units'); unitTotals[u] = (unitTotals[u] || 0) + num(app.totQty); }));
  const plannedLines = tpState.days.reduce((n,day)=>n+day.length,0);
  const plannedByUnit = Object.entries(unitTotals).map(([unit,qty])=>`${fmt(qty,1)} ${unit}`).join(' · ');
  let h = `<div class="turf-plan-summary"><span class="material-symbols-rounded">summarize</span><div><b>Plan summary</b><span>${plannedLines ? `${plannedLines} planned application line(s) · ${plannedByUnit}` : 'Add products and treated areas to build this week’s plan.'}</span></div><small>Whole-course planning only. Inventory is deducted only when an issue is recorded.</small></div>`;

  h += `<div class="row2" style="margin-bottom:16px">
    ${fld('Week Starting (Sunday)', `<input type="date" id="tpStart" value="${tpState.start}" data-chg="tp-start">`)}
    ${fld('Repeat Plan', `<select id="tpWeeks" data-chg="tp-weeks"><option value="1" ${tpState.weeks==1?'selected':''}>1 Week (Current only)</option><option value="2" ${tpState.weeks==2?'selected':''}>2 Weeks</option><option value="3" ${tpState.weeks==3?'selected':''}>3 Weeks</option><option value="4" ${tpState.weeks==4?'selected':''}>4 Weeks</option></select>`)}
  </div>`;

  h += `<div style="display:flex;flex-direction:column;gap:8px">`;
  tpState.days.forEach((apps, dIdx) => {
    h += `<div class="card" style="padding:12px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h4 style="margin:0;color:var(--gold);font-size:14px">${daysOfWeek[dIdx]}</h4>
        <button class="btn btn-sm" data-act="tp-add-app" data-day="${dIdx}">+ Add Spray</button>
      </div>`;

    if (apps.length > 0) {
      h += `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">`;
      apps.forEach((app, aIdx) => {
        const p = S.inventory.find(x => x.id === app.pId);
        const pName = p ? p.partName : "Unknown";
        h += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.4);padding:8px 12px;border-radius:8px;border-left:3px solid var(--ok)">
          <div><b style="font-size:13px">${esc(pName)}</b> <div class="muted sm">(${app.scope === 'per_area' ? app.qty + ' ' + app.unit + ' per ' + app.area : app.qty + ' ' + app.unit + ' overall course'})</div></div>
          <div style="display:flex;align-items:center;gap:12px">
            <b style="color:var(--gold);font-size:13px">Total: ${app.totQty} ${app.unit}</b>
            <button class="icon-btn" style="width:28px;height:28px;min-height:0" data-act="tp-del-app" data-day="${dIdx}" data-app="${aIdx}"><span class="material-symbols-rounded" style="font-size:16px">close</span></button>
          </div>
        </div>`;
      });
      h += `</div>`;
    }

    if (tpState.activeDay === dIdx) {
       h += `<div style="margin-top:12px;padding:14px;background:rgba(0,0,0,0.6);border:1px solid var(--brand-2);border-radius:12px">
         <div class="row2">
           ${fld('Product', `<select id="tpProd_${dIdx}" data-chg="tp-product" data-day="${dIdx}">${pOptions || '<option value="">No turf products available</option>'}</select>`)}
           ${fld('Area Target', `<select id="tpArea_${dIdx}"><option>Greens</option><option>Fairways</option><option>Roughs</option><option>Tees</option><option>Nursery</option></select>`)}
         </div>
         <div class="row2">
           ${fld('Scope Strategy', `<select id="tpScope_${dIdx}" data-chg="tp-scope" data-day="${dIdx}"><option value="overall">Whole course</option></select>`)}
           <div style="display:flex;gap:8px">
             <div style="flex:1">${fld('Quantity', `<input type="number" id="tpQty_${dIdx}" value="1" min="0.1" step="0.1" data-inp="tp-qty" data-day="${dIdx}">`)}</div>
             <div style="flex:1">${fld('Stock unit', `<input id="tpUnit_${dIdx}" value="${esc(turfProductUnit(products[0]) || 'Unit not set')}" readonly aria-readonly="true">`)}</div>
           </div>
         </div>
         <div style="margin-top:6px;font-size:13px;color:var(--ok);font-weight:800" id="tpTot_${dIdx}">Calculated Total Need: 1</div>
         <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
           <button class="btn" data-act="tp-cancel">Cancel</button>
           <button class="btn btn-primary" data-act="tp-save-app" data-day="${dIdx}">Save to ${daysOfWeek[dIdx]}</button>
         </div>
       </div>`;
    }
    h += `</div>`;
  });
  h += `</div>`;
  setHTML(c, h);
}

function calcTot(dIdx) {
  const scopeEl = $(`#tpScope_${dIdx}`);
  const qtyEl = $(`#tpQty_${dIdx}`);
  const unitEl = $(`#tpUnit_${dIdx}`);
  if (!scopeEl || !qtyEl) return;
  const scope = scopeEl.value;
  const qty = num(qtyEl.value);
  let tot = scope === 'per_area' ? qty * 18 : qty;
  const tEl = $(`#tpTot_${dIdx}`);
  if(tEl) tEl.textContent = `Calculated Total Need: ${fmt(tot, 1)} ${unitEl ? unitEl.value : ''}`;
}






function setCurrentWeek(value) { currentTurfWeekStart = value || ''; }
function setAppCategory(value) { turfAppCategory = value || 'All categories'; }
function setAppStatus(value) { turfAppStatus = value || 'All statuses'; }
function setAppSearch(value) { turfAppSearch = value || ''; }
function setProductCategory(value) { turfProductCategory = value || 'All categories'; }

  return { setTurfSection, renderTurfCategoryCards, renderTurfApplications, renderTurfCare, openAddSprayTaskForm, saveTurfBatch, renderTurfAreaPlanDashboard, openTurfVarianceModal, renderTurfVariance, exportTurfVariance, openTurfPlanner, renderTp, calcTot, setCurrentWeek, setAppCategory, setAppStatus, setAppSearch, setProductCategory };
}
