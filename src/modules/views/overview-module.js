/** Dashboard / executive overview feature module. */
export function createOverviewModule(deps) {
  const { LOADED, MON, S, addDays, app, autoReorderDetails, barChart, collection, dLong, dShort, daysBetween, effectiveReorderLevel, esc, fmt, fuelIn, fuelRecordDate, fuelTypeFromRecord, itemName, mKey, mName, monthStart, normDate, num, renderTurfAreaPlanDashboard, setHTML, sortFuel, timeOf, today, tsMs, turfCategoryClass, turfCategoryLabel, turfPlanCategory, turfProductForPlan, turfRecordDate, turfRecordProductName, turfRecordQuantity, turfRecordStatus, updateDayCostCards } = deps;
function renderOperationalIntelligence(t=today()) {
  const days=daysBetween(addDays(t,-29),t), fromWeek=addDays(t,-6), priorStart=addDays(t,-13), priorEnd=addDays(t,-7);
  const perMachineDay=new Map(), machineWeek=new Map(), hoursByMachineDay=new Map(), weekdayTotals=Array.from({length:7},()=>({litres:0,days:0}));
  days.forEach(d=>{const dow=new Date(d+'T12:00:00').getDay();weekdayTotals[dow].days++;});
  (S.shifts||[]).forEach(shift=>{const d=shift._d||normDate(shift.shiftDate,shift.timestamp??shift.startTime??shift.endTime);if(!d||d<days[0]||d>t)return;const key=mKey(shift.machineId||shift.machineName||shift.assetName);const dk=key+'|'+d;hoursByMachineDay.set(dk,(hoursByMachineDay.get(dk)||0)+Math.max(0,num(shift.engineHoursLogged??shift.engineHours??shift.hoursWorked)));});
  (S.fuel||[]).forEach(f=>{
    const d=fuelRecordDate(f); if(!d || d<days[0] || d>t) return;
    const liters=Math.max(0,num(f.litres ?? f.quantity ?? f.qty ?? f.fuelLitres ?? f.fuelQuantity));
    const name=f.machineName || mName(f.machineId) || 'Unassigned machine';
    const key=mKey(f.machineId||f.machineName||name);
    const dk=key+'|'+d, cur=perMachineDay.get(dk)||{key,name,date:d,litres:0,records:0}; cur.litres+=liters; cur.records++; perMachineDay.set(dk,cur);
    const dow=new Date(d+'T12:00:00').getDay(); weekdayTotals[dow].litres+=liters;
    const wk=machineWeek.get(key)||{key,name,current:0,prior:0,recordsCurrent:0,recordsPrior:0};
    if(d>=fromWeek){wk.current+=liters;wk.recordsCurrent++;} else if(d>=priorStart && d<=priorEnd){wk.prior+=liters;wk.recordsPrior++;}
    machineWeek.set(key,wk);
  });
  const dailyRows=[...perMachineDay.values()].sort((a,b)=>b.litres-a.litres);
  dailyRows.forEach(row=>{row.hours=hoursByMachineDay.get(row.key+'|'+row.date)||0;row.issuePerHour=row.hours>0?row.litres/row.hours:null;});
  const baselineByMachine=new Map();dailyRows.filter(row=>row.hours>0).forEach(row=>{const b=baselineByMachine.get(row.key)||{name:row.name,litres:0,hours:0,rates:[]};b.litres+=row.litres;b.hours+=row.hours;b.rates.push(row.issuePerHour);baselineByMachine.set(row.key,b);});
  const issueHourOutliers=[];dailyRows.forEach(row=>{const b=baselineByMachine.get(row.key);if(!b||b.rates.length<4||row.hours<0.75||row.issuePerHour===null)return;const rates=b.rates.slice().sort((a,b)=>a-b),mid=Math.floor(rates.length/2),median=rates.length%2?rates[mid]:(rates[mid-1]+rates[mid])/2;if(median>0&&row.issuePerHour>median*1.6)issueHourOutliers.push({...row,baseline:median});});
  issueHourOutliers.sort((a,b)=>(b.issuePerHour/b.baseline)-(a.issuePerHour/a.baseline));
  const weekdayRows=weekdayTotals.map((v,i)=>({day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],avg:v.days?v.litres/v.days:0,total:v.litres,days:v.days})).sort((a,b)=>b.avg-a.avg);
  const maxDay=dailyRows[0], topWeekday=weekdayRows[0];
  const issueDaysWithoutHours=dailyRows.filter(row=>row.litres>0 && row.hours<=0);
  const changes=[...machineWeek.values()].filter(x=>x.current>0&&x.prior>0&&x.recordsCurrent>=2).map(x=>({...x,change:(x.current-x.prior)/x.prior*100})).sort((a,b)=>b.change-a.change);
  const spike=changes.find(x=>x.change>=30), drop=changes.find(x=>x.change<=-30);
  const reliableFuel=(S.fuel||[]).filter(f=>fuelRecordDate(f)>=days[0]&&fuelRecordDate(f)<=t);
  const machineHtml=reliableFuel.length<3 ? '<div class="ops-intel-message">Not enough dated fuel issues to compare machine/day patterns yet. The dashboard will build a baseline as real issues are logged.</div>' :
    `<div class="ops-intel-stat-grid"><div class="ops-intel-stat"><small>Highest machine-day issue</small><b>${maxDay?`${fmt(maxDay.litres,1)} L`:'—'}</b><small>${maxDay?`${esc(maxDay.name)} · ${dShort(maxDay.date)}`:'No issues recorded'}</small></div><div class="ops-intel-stat"><small>Highest average weekday</small><b>${topWeekday?`${fmt(topWeekday.avg,1)} L/day`:'—'}</b><small>${topWeekday?`${topWeekday.day} · last 30 days`:'No baseline'}</small></div><div class="ops-intel-stat"><small>Issue/runtime outliers</small><b>${issueHourOutliers.length}</b><small>Compared with machine median L/hr</small></div></div>`+
    (issueDaysWithoutHours.length?`<div class="ops-intel-message alert">${issueDaysWithoutHours.length} machine-day(s) had a fuel issue but no matching same-day engine-hour entry. Check timing, missing shifts or whether fuel was issued for later use.</div>`:'')+
    (issueHourOutliers.length?`<div class="ops-intel-message warn">Issue/runtime signal: <b>${esc(issueHourOutliers[0].name)}</b> has ${fmt(issueHourOutliers[0].issuePerHour,2)} L issued per logged engine hour on ${dLong(issueHourOutliers[0].date)}, above its recent median of ${fmt(issueHourOutliers[0].baseline,2)} L/h. Fuel issue timing and tank refills can skew this; review records and runtime before concluding anything.</div>`:'')+
    (spike?`<div class="ops-intel-message warn">Usage signal: <b>${esc(spike.name)}</b> issued ${fmt(spike.current,1)} L in the last 7 days, up ${fmt(spike.change,0)}% versus the prior 7 days. Review run hours and issue notes before drawing conclusions.</div>`:drop?`<div class="ops-intel-message">${esc(drop.name)} recorded ${fmt(Math.abs(drop.change),0)}% less fuel this week than the prior week. Check whether operating hours or work assignments also changed.</div>`:`<div class="ops-intel-message">No machine's last-week fuel total is 30% or more above its preceding-week baseline, based on available logs. Compare litres with engine hours before treating a change as abnormal.</div>`);
  setHTML($('#opsMachineDayIntel'), machineHtml);
  const itemRows=S.inventory.map(i=>({item:i,reorder:autoReorderDetails(i)}));
  const urgent=itemRows.filter(x=>num(x.item.stockQuantity)<=x.reorder.level || (x.reorder.daysCover!==null && x.reorder.daysCover<x.reorder.leadDays)).sort((a,b)=>{
    const ra=Math.max(1,a.reorder.level), rb=Math.max(1,b.reorder.level);return (num(a.item.stockQuantity)/ra)-(num(b.item.stockQuantity)/rb);
  }).slice(0,6);
  const historyCount=itemRows.filter(x=>x.reorder.reliable).length;
  const reorderHtml=!S.inventory.length?'<div class="ops-intel-message">Add products to the Inventory Master. Automatic levels will be computed once the item is linked to actual usage records.</div>':
    `${urgent.length?urgent.map(({item,reorder})=>`<div class="ops-intel-row"><div class="ops-intel-main"><b>${esc(itemName(item))}</b><small>${esc(item.category||'Other')} · ${reorder.reliable?`${reorder.activeDays} use-days / ${reorder.windowDays}-day window · ${reorder.leadDays}-day lead time`:`Provisional threshold · ${reorder.leadDays}-day policy lead time`}</small></div><div class="ops-intel-value">${fmt(item.stockQuantity,2)} / ${fmt(reorder.level,2)} ${esc(item.unit||'units')}<small>${num(item.stockQuantity)<=reorder.level?'Reorder attention':'Coverage watch'}</small></div></div>`).join(''):'<div class="ops-intel-message">No items are currently below their calculated reorder threshold or projected to run out within policy lead time.</div>'}`+
    `<div class="ops-intel-message ${historyCount?'':'alert'}">${historyCount} of ${S.inventory.length} item(s) have enough dated usage history (at least 3 issue days across a 14+ day observation window). Other items use a provisional floor until history improves. Auto-reorder levels recalculate as records update.</div>`;
  setHTML($('#opsAutoReorderIntel'),reorderHtml);
  renderTurfUsageIntelligence(t);
}


function renderTurfUsageIntelligence(t=today()) {
  const target=$('#opsTurfUsageIntel'); if(!target)return;
  const from=addDays(t,-29), weekdayCounts=Array.from({length:7},()=>({logs:0,days:0}));
  daysBetween(from,t).forEach(d=>weekdayCounts[new Date(d+'T12:00:00').getDay()].days++);
  const rows=(S.plans||[]).map(p=>{
    const date=turfRecordDate(p), status=turfRecordStatus(p), item=turfProductForPlan(p);
    const category=turfCategoryLabel(p.category||item?.category||'');
    const name=turfRecordProductName(p)||itemName(item||{});
    const unit=String(p.unit||p.stockUnit||p.uom||p.unitOfMeasure||item?.unit||item?.stockUnit||item?.uom||'').trim();
    const qty=Math.max(0,turfRecordQuantity(p));
    return {p,date,status,item,category,name,unit,qty};
  }).filter(x=>x.date>=from&&x.date<=t&&['Issued','Applied'].includes(x.status)&&['Fertilizers','Pesticides','Turf Enhancements'].includes(x.category));
  const byProduct=new Map();
  rows.forEach(r=>{
    const key=(r.item?.id||r.name.toLowerCase())+'|'+r.unit;
    const v=byProduct.get(key)||{name:r.name,category:r.category,unit:r.unit,qty:0,records:0,days:new Set()};
    v.qty+=r.qty;v.records++;v.days.add(r.date);byProduct.set(key,v);
    weekdayCounts[new Date(r.date+'T12:00:00').getDay()].logs++;
  });
  const top=[...byProduct.values()].sort((a,b)=>b.records-a.records||b.qty-a.qty)[0];
  const peak=weekdayCounts.map((v,i)=>({day:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i],avg:v.days?v.logs/v.days:0,logs:v.logs})).sort((a,b)=>b.avg-a.avg)[0];
  const cats=['Fertilizers','Pesticides','Turf Enhancements'].map(category=>({category,count:rows.filter(r=>r.category===category).length}));
  if(!LOADED.plans){target.innerHTML='<div class="ops-intel-message">Waiting for application/issue records from Firebase.</div>';return;}
  if(!rows.length){target.innerHTML='<div class="ops-intel-message">No issued/applied turf-product records were found in the last 30 days. Planned jobs are excluded. Confirm the app writes transaction records with a date, product and issued/applied status.</div>';return;}
  target.innerHTML=`<div class="ops-intel-stat-grid"><div class="ops-intel-stat"><small>Issued/applied records</small><b>${rows.length}</b><small>Last 30 days</small></div><div class="ops-intel-stat"><small>Most frequent product</small><b>${esc(top?.name||'—')}</b><small>${top?`${top.records} record(s) · ${fmt(top.qty,2)} ${esc(top.unit||'units')}`:'No linked product'}</small></div><div class="ops-intel-stat"><small>Busiest weekday</small><b>${peak?.day||'—'}</b><small>${peak?`${fmt(peak.avg,1)} records per ${peak.day}`:''}</small></div></div>`+
    `<div class="ops-intel-category-counts">${cats.map(c=>`<div class="ops-intel-message"><b>${esc(c.category)}</b><br>${c.count} issued/applied record(s)</div>`).join('')}</div>`+
    `<div class="ops-intel-message">Counts use logged status and dates; product quantities stay in their original units. A plan marked Applied is a recorded status, not independent proof of physical application.</div>`;
}

function renderOverview() {
  const t = today(), month = monthStart(t), weekStart = addDays(t, -6);
  const monthFuel = fuelIn(month, t).slice().sort(sortFuel);
  const todayFuel = fuelIn(t, t);
  const weekFuel = fuelIn(weekStart, t);
  const turfDate = p => turfRecordDate(p);
  const monthPlans = (S.plans || []).filter(p => { const d=turfDate(p); return d && d >= month && d <= t; });
  const fuelLitres = rows => rows.reduce((a, f) => a + Math.max(0, num(f.litres ?? f.quantity ?? f.qty)), 0);
  const machineTotals = new Map();
  monthFuel.forEach(f => {
    const name = f.machineName || mName(f.machineId) || 'Unassigned machine';
    const key = String(name);
    const item = machineTotals.get(key) || { name:key, litres:0, records:0 };
    item.litres += Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); item.records++;
    machineTotals.set(key, item);
  });
  const topMachines = [...machineTotals.values()].sort((a,b)=>b.litres-a.litres).slice(0,5);
  const recentFuel = monthFuel.slice(0,5);
  const days = daysBetween(weekStart, t);
  const litresByDay = {};
  weekFuel.forEach(f => { const d=fuelRecordDate(f); litresByDay[d] = (litresByDay[d] || 0) + Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); });
  const fuelUnits = fuelLitres(monthFuel);
  const fuelIssuedMTD = { Diesel: 0, Petrol: 0 };
  monthFuel.forEach(f => { const type = fuelTypeFromRecord(f); if (type in fuelIssuedMTD) fuelIssuedMTD[type] += Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); });
  const fuelIssuedToday = { Diesel: 0, Petrol: 0 };
  todayFuel.forEach(f => { const type = fuelTypeFromRecord(f); if (type in fuelIssuedToday) fuelIssuedToday[type] += Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); });
  $('#opsPeriod').textContent = `${MON[+t.slice(5,7)-1].toUpperCase()} ${t.slice(0,4)} · MONTH TO DATE`;
  updateDayCostCards(t);

  // Category-aware turf insights. Prefer the category saved on the plan; fall back to the linked inventory item.
  const categoryForPlan = p => {
    const label = turfPlanCategory(p);
    if (label === 'Fertilizers') return 'fertilizer';
    if (label === 'Pesticides') return 'pesticide';
    if (label === 'Turf Enhancements') return 'enhancer';
    return '';
  };
  const categories = [
    {key:'fertilizer', label:'Fertilizers', ids:['opsFertilizerStats','opsFertilizerTrend','opsFertilizerRecent']},
    {key:'pesticide', label:'Pesticides', ids:['opsPesticideStats','opsPesticideTrend','opsPesticideRecent']},
    {key:'enhancer', label:'Turf Enhancers', ids:['opsEnhancerStats','opsEnhancerTrend','opsEnhancerRecent']}
  ];
  const allPlans = (S.plans || []).filter(p => { const d=turfRecordDate(p); return d && d <= t && categoryForPlan(p); });
  const weekPlans = allPlans.filter(p => turfRecordDate(p) >= weekStart);
  const monthTurfRows = monthPlans.filter(p => categoryForPlan(p));
  const appliedTurfRows = monthTurfRows.filter(p => ['Applied','Issued'].includes(turfRecordStatus(p))); 
  const overdueTurfRows = allPlans.filter(p => turfRecordStatus(p) === 'Planned' && turfRecordDate(p) < t);
  setHTML($('#opsFuelDomainStats'), [
    {label:'Diesel · today',value:LOADED.fuel ? `${fmt(fuelIssuedToday.Diesel,1)} L` : '—',foot:`${todayFuel.filter(f=>fuelTypeFromRecord(f)==='Diesel').length} issue record(s)`},
    {label:'Petrol · today',value:LOADED.fuel ? `${fmt(fuelIssuedToday.Petrol,1)} L` : '—',foot:`${todayFuel.filter(f=>fuelTypeFromRecord(f)==='Petrol').length} issue record(s)`},
    {label:'Total issued · MTD',value:LOADED.fuel ? `${fmt(fuelUnits,1)} L` : '—',foot:`${monthFuel.length} issue record(s) this month`}
  ].map(k=>`<div class="ops-domain-kpi"><span>${esc(k.label)}</span><b>${esc(k.value)}</b><small>${esc(k.foot)}</small></div>`).join(''));
  setHTML($('#opsTurfDomainStats'), [
    {label:'Application records',value:LOADED.plans ? fmt(monthTurfRows.length,0) : '—',foot:'Month to date'},
    {label:'Issued / applied',value:LOADED.plans ? fmt(appliedTurfRows.length,0) : '—',foot:'Movement or application status recorded'},
    {label:'Past due',value:LOADED.plans ? fmt(overdueTurfRows.length,0) : '—',foot:'Not marked applied'}
  ].map(k=>`<div class="ops-domain-kpi"><span>${esc(k.label)}</span><b>${esc(k.value)}</b><small>${esc(k.foot)}</small></div>`).join(''));

  // Planned-versus-issued reconciliation by product and scheduled date. Quantities remain grouped by unit.
  const compareRows = monthPlans.filter(p => categoryForPlan(p) && turfRecordStatus(p) !== 'Cancelled' && turfRecordDate(p) === today());
  const hasPlannedQuantity = p => ['targetQty','plannedQty','requestedQty','plannedQuantity','targetQuantity'].some(k => p[k] !== undefined && p[k] !== null && p[k] !== '');
  // Keep the planned amount visible even when the same plan record transitions to Issued/Applied.
  const plannedRows = compareRows.filter(p => hasPlannedQuantity(p) || turfRecordStatus(p) === 'Planned');
  const issuedRows = compareRows.filter(p => ['Issued','Applied'].includes(turfRecordStatus(p)) || num(p.issuedQty ?? p.issuedQuantity ?? p.issueQty ?? p.issueQuantity ?? p.quantityIssued ?? p.qtyIssued ?? p.quantityOut ?? p.qtyOut) > 0);
  const unitLabel = p => String(p.unit ?? p.stockUnit ?? p.unitOfMeasure ?? (turfProductForPlan(p)||{}).unit ?? 'unit not set').trim();
  const plannedKeys = new Set(plannedRows.map(p=>`${turfRecordDate(p)}|${turfRecordProductName(p).toLowerCase()}`));
  const outsidePlan = issuedRows.filter(p => {
    const linked = p.planId || p.plannedRecordId || p.plannedApplicationId || p.sourcePlanId;
    if (linked) return false;
    const key = `${turfRecordDate(p)}|${turfRecordProductName(p).toLowerCase()}`;
    // Same record can be converted from Planned to Issued, so an explicit plan reference counts as planned.
    const explicitUnplanned = p.wasPlanned === false || p.fromPlan === false || p.planned === false || p.unplanned === true || p.isUnplanned === true || /manual|unplanned|ad hoc/i.test(String(p.source || p.sourceType || p.issueSource || ''));
    const separateIssueRecord = Boolean(p.issueId || p.transactionId || p.transactionType || p.movementType || p.issueStatus || p.issuedAt || p.issuedDate || p.issueDate);
    return explicitUnplanned || (separateIssueRecord && !plannedKeys.has(key) && !(p.wasPlanned === true || p.fromPlan === true || p.planned === true));
  });

  // Compare quantities product-by-product so different stock units are never combined into a misleading total.
  const productCompare = new Map();
  const addCompareLine = (p, bucket) => {
    const product = turfProductForPlan(p);
    const id = p.productId ?? p.productID ?? p.itemId ?? p.inventoryId ?? (product && product.id);
    const name = turfRecordProductName(p) || (product ? itemName(product) : 'Unspecified product');
    const unit = unitLabel(p) || 'unit not set';
    const nameKey = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    const key = `${(product && product.id) || id || nameKey}|${unit.toLowerCase()}`;
    if (!productCompare.has(key)) productCompare.set(key, { name, unit, category: turfPlanCategory(p), plannedQty: 0, issuedQty: 0, plannedRecords: 0, issuedRecords: 0 });
    const row = productCompare.get(key);
    const plannedQty = num(p.targetQty ?? p.plannedQty ?? p.requestedQty ?? p.plannedQuantity ?? p.targetQuantity ?? (turfRecordStatus(p) === 'Planned' ? (p.quantity ?? p.qty) : 0));
    const issuedQty = num(p.issuedQty ?? p.issuedQuantity ?? p.issueQty ?? p.issueQuantity ?? p.quantityIssued ?? p.qtyIssued ?? p.quantityOut ?? p.qtyOut ?? (['Issued','Applied'].includes(turfRecordStatus(p)) ? (p.actualQty ?? p.appliedQty ?? p.applicationQty ?? p.quantityUsed ?? p.usedQuantity ?? p.qtyUsed ?? p.dispensedQty ?? p.quantity ?? p.qty ?? p.targetQty ?? p.plannedQty ?? p.requestedQty ?? p.plannedQuantity ?? p.targetQuantity) : 0));
    row.plannedQty += bucket === 'planned' ? Math.max(0, plannedQty) : 0;
    row.issuedQty += bucket === 'issued' ? Math.max(0, issuedQty) : 0;
    row[bucket === 'planned' ? 'plannedRecords' : 'issuedRecords'] += 1;
    if (row.category === 'Other' && turfPlanCategory(p) !== 'Other') row.category = turfPlanCategory(p);
  };
  plannedRows.forEach(p => addCompareLine(p, 'planned'));
  issuedRows.forEach(p => addCompareLine(p, 'issued'));
  const productCompareRows = [...productCompare.values()].sort((a,b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  const compare = $('#opsPlanIssueCompare');
  const periodLabel = $('#opsPlanIssuePeriod'); if (periodLabel) periodLabel.textContent = `Today · ${dShort(today())}`;
  if (compare) {
    compare.innerHTML = !LOADED.plans
      ? '<div class="ops-product-compare-empty">Loading planned and issued records…</div>'
      : productCompareRows.length
        ? `<div class="ops-product-compare-table" role="table" aria-label="Planned and issued turf products this month">
            <div class="ops-product-compare-head" role="row"><span role="columnheader">Product</span><span role="columnheader">Planned qty</span><span role="columnheader">Issued qty</span></div>
            ${productCompareRows.map(row => `<div class="ops-product-compare-row" role="row">
              <div class="ops-product-compare-name" role="cell"><span class="ops-product-compare-mark ${turfCategoryClass(row.category)}" aria-hidden="true"></span><div><b title="${esc(row.name)}">${esc(row.name)}</b><small>${esc(row.category)}</small></div></div>
              <div class="ops-product-compare-qty planned" role="cell"><b>${fmt(row.plannedQty,2)} <small>${esc(row.unit)}</small></b></div>
              <div class="ops-product-compare-qty issued" role="cell"><b>${fmt(row.issuedQty,2)} <small>${esc(row.unit)}</small></b></div>
            </div>`).join('')}
          </div>`
        : '<div class="ops-product-compare-empty">No planned or issued turf products recorded this month.</div>';
  }
  const outside = $('#opsUnplannedIssues');
  if (outside) outside.innerHTML = !LOADED.plans ? 'Waiting for turf records' : outsidePlan.length ? outsidePlan.slice(0,5).map(p=>`<div class="ops-unplanned-row"><b>${esc(turfRecordProductName(p)||'Unnamed product')}</b><span>${esc(turfRecordDate(p)||'Date missing')} · ${fmt(turfRecordQuantity(p),2)} ${esc(unitLabel(p))}</span></div>`).join('') + (outsidePlan.length>5?`<small>+${outsidePlan.length-5} more</small>`:'') : '<span class="ops-no-unplanned">No unplanned issues detected in the current month.</span>';

  setHTML($('#opsFuelTrend'), barChart(days.map(d=>({label:dShort(d),value:litresByDay[d]||0})), {unit:'L'}));
  const fuelMasterMatches = type => S.inventory.filter(i => itemName(i).trim().toLowerCase() === type.toLowerCase());
  const fuelMasterMarkup = ['Diesel','Petrol'].map(type => {
    const matches = fuelMasterMatches(type);
    const issued = fuelIssuedMTD[type] || 0;
    const issuedToday = fuelIssuedToday[type] || 0;
    if (!matches.length) return `<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${type}</div><div class="ops-list-meta">Not in Inventory Master yet · add name exactly as shown, category Fuel, unit Litre</div></div><div class="ops-list-value">${fmt(issued,1)} L<small>Today: ${fmt(issuedToday,1)} L</small></div></div>`;
    if (matches.length > 1) return `<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${type}</div><div class="ops-list-meta" style="color:var(--warn)">Multiple matching inventory items (${matches.length}); keep one master item per fuel type.</div></div><div class="ops-list-value">${fmt(issued,1)} L<small>Today: ${fmt(issuedToday,1)} L</small></div></div>`;
    const item = matches[0], stock = Math.max(0, num(item.stockQuantity)), reorder = effectiveReorderLevel(item);
    const unit = item.unit || 'unit not set';
    const low = stock <= reorder;
    return `<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(type)} <span class="badge ${low?'warn':'ok'}">${low?'Reorder':'Stock available'}</span></div><div class="ops-list-meta">On hand: ${fmt(stock,2)} ${esc(unit)} · Reorder at ${fmt(reorder,2)} ${esc(unit)}</div></div><div class="ops-list-value">${fmt(issued,1)} L<small>Today: ${fmt(issuedToday,1)} L</small></div></div>`;
  }).join('');
  setHTML($('#opsFuelInventory'), fuelMasterMarkup);
  setHTML($('#opsFuelMachines'), topMachines.length ? topMachines.map(m=>`<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(m.name)}</div><div class="ops-list-meta">${m.records} issue record(s)</div></div><div class="ops-list-value">${fmt(m.litres,1)} L</div></div>`).join('') : '<div class="ops-empty">No fuel issue records for this month.</div>');
  setHTML($('#opsRecentFuel'), recentFuel.length ? recentFuel.map(f=>`<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(f.machineName || mName(f.machineId) || 'Unassigned machine')}</div><div class="ops-list-meta">${dShort(f._d)}${timeOf(tsMs(f.timestamp))?' · '+timeOf(tsMs(f.timestamp)):''} · ${esc(fuelTypeFromRecord(f))}${f.issuedBy?' · '+esc(f.issuedBy):''}</div></div><div class="ops-list-value">${fmt(num(f.litres ?? f.quantity ?? f.qty),1)} L</div></div>`).join('') : '<div class="ops-empty">No fuel issue records yet.</div>');

  categories.forEach(cat => {
    const rows = monthPlans.filter(p => categoryForPlan(p) === cat.key);
    const appliedRows = rows.filter(p => turfRecordStatus(p) === 'Applied');
    const issuedRows = rows.filter(p => turfRecordStatus(p) === 'Issued');
    const plannedRows = rows.filter(p => turfRecordStatus(p) === 'Planned');
    const overdueRows = plannedRows.filter(p => turfRecordDate(p) && turfRecordDate(p) < t);
    const issuedByUnit = new Map();
    issuedRows.forEach(p => {
      const product = turfProductForPlan(p);
      const unit = String(p.unit || p.stockUnit || (product && product.unit) || 'Unit not set').trim();
      issuedByUnit.set(unit, (issuedByUnit.get(unit) || 0) + turfRecordQuantity(p));
    });
    const issuedSummary = [...issuedByUnit.entries()].map(([unit,qty]) => `${fmt(qty,2)} ${unit}`).join(' · ') || 'No issue quantities recorded';
    const recent = rows.slice().sort((a,b)=>turfRecordDate(b).localeCompare(turfRecordDate(a)) || tsMs(b.createdAt ?? b.timestamp)-tsMs(a.createdAt ?? a.timestamp)).slice(0,4);
    const trend = days.map(d => ({label:dShort(d),value:weekPlans.filter(p=>categoryForPlan(p)===cat.key && turfRecordDate(p)===d).length}));
    setHTML($('#'+cat.ids[0]), `<div class="ops-status-grid"><div class="ops-status-cell"><div class="ops-status-num">${LOADED.plans?fmt(rows.length,0):'—'}</div><div class="ops-status-label">Records · MTD</div></div><div class="ops-status-cell"><div class="ops-status-num">${LOADED.plans?fmt(appliedRows.length,0):'—'}</div><div class="ops-status-label">Applied</div></div><div class="ops-status-cell"><div class="ops-status-num">${LOADED.plans?fmt(issuedRows.length,0):'—'}</div><div class="ops-status-label">Issued</div></div></div><div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">Issued quantity · MTD</div><div class="ops-list-meta">${esc(issuedSummary)}</div></div><div class="ops-list-value">${issuedRows.length}</div></div><div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">Planned / overdue</div><div class="ops-list-meta">Planned records past their scheduled date</div></div><div class="ops-list-value" style="${overdueRows.length?'color:var(--warn)':''}">${plannedRows.length} / ${overdueRows.length}</div></div>`);
    setHTML($('#'+cat.ids[1]), barChart(trend, {unit:'records'}));
    setHTML($('#'+cat.ids[2]), recent.length ? recent.map(p=>`<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(turfRecordProductName(p) || 'Unspecified product')}</div><div class="ops-list-meta">${dShort(turfRecordDate(p))} · ${esc(p.targetArea || p.area || p.location || 'Course')} · ${esc(turfRecordStatus(p))}</div></div><div class="ops-list-value">${fmt(turfRecordQuantity(p),1)} ${esc(p.unit || p.stockUnit || 'units')}</div></div>`).join('') : `<div class="ops-empty">No ${cat.label.toLowerCase()} logs for this month.</div>`);
  });
  renderOperationalIntelligence(t);
  renderTurfAreaPlanDashboard(); // Keep the dashboard area summary in sync with the live plan collection.
}

  return { renderOperationalIntelligence, renderTurfUsageIntelligence, renderOverview };
}
