export function filterTurfRecords({ plans, query = "", category = "All categories", status = "All statuses", isTurfCategory, categoryFor, statusFor, dateFor, timestampMs }) {
  const all = [...(plans || [])].filter(plan => isTurfCategory(categoryFor(plan)));
  const q = String(query || "").trim().toLowerCase();
  return all.filter(plan => {
    const recordCategory = categoryFor(plan);
    const recordStatus = statusFor(plan);
    const searchText = [plan.productName, plan.targetArea, plan.notes, recordCategory, recordStatus, plan.date].join(" ").toLowerCase();
    return (category === "All categories" || recordCategory === category) &&
      (status === "All statuses" || recordStatus === status) && (!q || searchText.includes(q));
  }).sort((a,b) => dateFor(b).localeCompare(dateFor(a)) || timestampMs(b.createdAt ?? b.timestamp)-timestampMs(a.createdAt ?? a.timestamp));
}

export function createTurfOpsModule({
  $, $$, setHTML, esc, num, fmt, dShort, today, monthStart, addDays, tsMs, money,
  effectiveReorderLevel, autoReorderDetails, itemName, LOADED: loaded, S: state,
  isTurfCategory, turfCategoryLabel, turfRecordStatus, turfPlanCategory, turfRecordDate,
  turfRecordProductName, turfRecordQuantity, turfCategoryClass,
  getCurrentTurfWeekStart, setCurrentTurfWeekStart, getTurfSection,
  getTurfAppCategory, getTurfAppStatus, getTurfAppSearch, getTurfProductCategory
}) {
 const S = state, LOADED = loaded;
 const ui = {};
 Object.defineProperties(ui, {
  currentTurfWeekStart: { get: getCurrentTurfWeekStart, set: setCurrentTurfWeekStart },
  turfSection: { get: getTurfSection },
  turfAppCategory: { get: getTurfAppCategory },
  turfAppStatus: { get: getTurfAppStatus },
  turfAppSearch: { get: getTurfAppSearch },
  turfProductCategory: { get: getTurfProductCategory }
 });
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
  const rows = filterTurfRecords({
    plans:S.plans, query:ui.turfAppSearch, category:ui.turfAppCategory, status:ui.turfAppStatus,
    isTurfCategory, categoryFor:turfPlanCategory, statusFor:turfRecordStatus, dateFor:turfRecordDate, timestampMs:tsMs
  });
  const count = $('#turfApplicationCount');
  if (count) count.textContent = `${rows.length} record${rows.length===1?'':'s'}`;
  setHTML(target, `<table><thead><tr><th>Date</th><th>Category</th><th>Product</th><th class="num">Quantity</th><th>Treated area</th><th>Status</th><th>Notes</th></tr></thead><tbody>${!LOADED.plans ? '<tr><td colspan="7">Loading application records…</td></tr>' : rows.length ? rows.map(p => {
    const category = turfPlanCategory(p), status = turfRecordStatus(p);
    return `<tr><td>${esc(turfRecordDate(p) || '—')}<div class="muted sm">${p.createdAt ? 'Entered '+esc(dShort(normDate(null,p.createdAt))) : ''}</div></td><td><span class="badge ${turfCategoryClass(category)}">${esc(category)}</span></td><td><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b></td><td class="num">${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || '')}</td><td>${esc(p.targetArea || p.area || p.location || 'Course')}</td><td><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></td><td class="muted">${esc(p.notes || p.reason || '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No application records match these filters.</td></tr>'}</tbody></table>`);
}
function renderTurfCare() {
  if (!ui.currentTurfWeekStart) ui.currentTurfWeekStart = getSunday(today());
  const weekStartEl = $('#turfWeekStart');
  if (weekStartEl && weekStartEl.value !== ui.currentTurfWeekStart) weekStartEl.value = ui.currentTurfWeekStart;

  // Keep the three workspaces focused. All panels still use the same live Firestore data.
  ['workboard','applications','products'].forEach(name => {
    const pane = $('#turf'+name.charAt(0).toUpperCase()+name.slice(1)+'Pane');
    if (pane) pane.hidden = ui.turfSection !== name;
  });
  $$('#v-turfcare .turf-view-tab').forEach(btn => {
    const active = btn.dataset.tab === ui.turfSection;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  if ($('#turfLogSearch') && $('#turfLogSearch').value !== ui.turfAppSearch) $('#turfLogSearch').value = ui.turfAppSearch;
  if ($('#turfAppCategoryFilter')) $('#turfAppCategoryFilter').value = ui.turfAppCategory;
  if ($('#turfAppStatusFilter')) $('#turfAppStatusFilter').value = ui.turfAppStatus;
  if ($('#turfProductCategoryFilter')) $('#turfProductCategoryFilter').value = ui.turfProductCategory;

  const turfItems = S.inventory.filter(i => isTurfCategory(i.category));
  const lowStock = turfItems.filter(i => num(i.stockQuantity) <= effectiveReorderLevel(i));
  const todayStr = today();
  const allPlans = (S.plans || []).filter(p => isTurfCategory(turfPlanCategory(p)));
  const plannedThisWeek = allPlans.filter(p => turfRecordDate(p) >= ui.currentTurfWeekStart && turfRecordDate(p) <= addDays(ui.currentTurfWeekStart,6) && turfRecordStatus(p) === 'Planned');
  const monthStartStr = monthStart(todayStr);
  const issuedAppliedMTD = allPlans.filter(p => turfRecordDate(p) >= monthStartStr && turfRecordDate(p) <= todayStr && ['Applied','Issued'].includes(turfRecordStatus(p))).length;
  const overduePlans = allPlans.filter(p => turfRecordDate(p) && turfRecordDate(p) < todayStr && turfRecordStatus(p) === 'Planned');
  setHTML($('#turfKpiGrid'), [
    {label:'Scheduled this week',value:plannedThisWeek.length,sub:'Planned tasks in selected week',icon:'calendar_month',cls:'green'},
    {label:'Issued / applied · MTD',value:issuedAppliedMTD,sub:'Movement or application status recorded',icon:'task_alt',cls:'gold'},
    {label:'Past due',value:overduePlans.length,sub:'Not marked applied',icon:'event_busy',cls:overduePlans.length?'warn':'green'},
    {label:'Low-stock products',value:lowStock.length,sub:'At or below reorder level',icon:'inventory',cls:lowStock.length?'warn':'green'}
  ].map(k=>`<div class="turf-metric-card"><span class="turf-metric-icon ${k.cls}"><span class="material-symbols-rounded">${k.icon}</span></span><div class="turf-metric-copy"><span>${esc(k.label)}</span><b>${fmt(k.value,0)}</b><small>${esc(k.sub)}</small></div></div>`).join(''));

  // Selected week planner, compact days with a real action on each day.
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dates = Array.from({length:7},(_,i)=>addDays(ui.currentTurfWeekStart,i));
  const weekPlans = allPlans.filter(p => (turfRecordDate(p) && turfRecordDate(p) >= ui.currentTurfWeekStart && turfRecordDate(p) <= addDays(ui.currentTurfWeekStart,6)) || (!turfRecordDate(p) && p.weekStart === ui.currentTurfWeekStart));
  setHTML($('#turfPlannerGrid'), dates.map((dateStr,idx) => {
    const dayPlans = weekPlans.filter(p => turfRecordDate(p) ? turfRecordDate(p) === dateStr : p.weekStart === ui.currentTurfWeekStart && num(p.dayIndex) === idx);
    const todayClass = dateStr === todayStr ? ' today' : '';
    return `<article class="turf-day-card${todayClass}"><div class="turf-day-head"><div><b>${dayNames[idx]}</b><span>${dShort(dateStr)}</span></div>${dateStr===todayStr?'<span class="turf-today-pill">Today</span>':''}</div><div class="turf-day-plans">${dayPlans.length ? dayPlans.slice(0,3).map(plan => {
      const cat = turfPlanCategory(plan), status = turfRecordStatus(plan);
      return `<div class="turf-plan-item ${turfCategoryClass(cat)}"><div class="turf-plan-title">${esc(turfRecordProductName(plan) || 'Unspecified product')}</div><div class="turf-plan-meta">${fmt(turfRecordQuantity(plan),2)} ${esc(plan.unit || plan.stockUnit || 'units')} · ${esc(plan.targetArea || plan.area || plan.location || 'Course')}</div><div class="turf-plan-foot"><span class="turf-category-label">${esc(cat === 'Turf Enhancements' ? 'Enhancer' : cat.replace(/s$/,''))}</span><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></div></div>`;
    }).join('') : '<div class="turf-empty-day">No work planned</div>'}${dayPlans.length>3?`<div class="muted sm">+ ${dayPlans.length-3} more</div>`:''}</div><button class="turf-add-day" data-act="add-spray" data-day="${idx}" data-date="${dateStr}"><span class="material-symbols-rounded">add</span>Add task</button></article>`;
  }).join(''));

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
  const filteredProducts = turfItems.filter(i => ui.turfProductCategory === 'All categories' || turfCategoryLabel(i.category) === ui.turfProductCategory).sort((a,b)=>itemName(a).localeCompare(itemName(b)));
  setHTML($('#turfInvTbl'), `<table><thead><tr><th>Product</th><th>Category</th><th>Unit</th><th class="num">On hand</th><th class="num">Auto reorder at</th><th class="num">Unit rate</th><th>Status</th><th>Actions</th></tr></thead><tbody>${!LOADED.inventory?'<tr><td colspan="8">Loading products…</td></tr>':filteredProducts.length?filteredProducts.map(i=>{
    const low=num(i.stockQuantity)<=effectiveReorderLevel(i);
    return `<tr><td><b>${esc(itemName(i))}</b></td><td><span class="badge ${turfCategoryClass(i.category)}">${esc(turfCategoryLabel(i.category))}</span></td><td>${esc(i.unit || 'Nos')}</td><td class="num"><b>${fmt(i.stockQuantity,3)}</b></td><td class="num"><b>${fmt(effectiveReorderLevel(i),3)}</b><div class="muted sm">${autoReorderDetails(i).reliable?'Trend-based':'Provisional'}</div></td><td class="num">${num(i.unitCost)>0?money(i.unitCost,2):'—'}</td><td><span class="badge ${low?'warn':'ok'}">${low?'Reorder':'In stock'}</span></td><td class="right nowrap"><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}" title="Edit product"><span class="material-symbols-rounded">edit</span></button></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="empty">No turf products in this category. Add a product in the item master first.</td></tr>'}</tbody></table>`);
  renderTurfApplications();
}


 return { renderTurfCategoryCards, renderTurfApplications, renderTurfCare };
}
