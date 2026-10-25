/** Function-based CostAnalytics module. Dependencies are injected from the application context. */
export function createCostAnalyticsModule(deps) {
  const { $, qsa, CONFIG, COST, LOADED, S, addDays, autoReorderDetails, barChart, dLong, dShort, db, doc, downloadCSV, effectiveReorderLevel, esc, fld, fmt, fuelIn, fuelRecordDate, fuelTypeFromRecord, isTurfCategory, itemName, mName, money, monthStart, monthlyCostSnapshot, normDate, num, openForm, openModal, renderOverview, saveCostModel, sum, timeOf, toast, today, tsMs, turfCategoryClass, turfPlanCategory, turfProductForPlan, turfRecordDate, turfRecordProductName, turfRecordQuantity, turfRecordStatus, updateDoc, where } = deps;
const sortFuel = (a, b) => fuelRecordDate(b).localeCompare(fuelRecordDate(a)) || tsMs(b.timestamp ?? b.createdAt) - tsMs(a.timestamp ?? a.createdAt);

/* Daily costs use transaction rates or Inventory Master unit costs only.
   No local ROI assumptions or placeholder fuel prices are used here. */
function fuelTypeForCost(f) {
  return fuelTypeFromRecord(f);
}
function fuelMasterRate(type) {
  if (!type || type === 'Unspecified') return { rate: 0, source: 'Fuel type unspecified' };
  const sameName = S.inventory.filter(i => itemName(i).trim().toLowerCase() === type.toLowerCase());
  const fuelItems = sameName.filter(i => String(i.category || '').trim().toLowerCase() === 'fuel');
  const matches = fuelItems.length ? fuelItems : (sameName.length === 1 ? sameName : []);
  if (matches.length !== 1) return { rate: 0, source: matches.length > 1 ? 'Duplicate fuel master item' : 'Fuel master rate missing' };
  const rate = num(matches[0].unitCost);
  return rate > 0 ? { rate, source: 'Inventory Master' } : { rate: 0, source: 'Fuel unit cost not set' };
}
function fuelCostLine(f) {
  const qty = Math.max(0, num(f.litres ?? f.quantity ?? f.qty));
  const transactionRate = num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre);
  const fallback = transactionRate > 0 ? null : fuelMasterRate(fuelTypeForCost(f));
  const rate = transactionRate > 0 ? transactionRate : (fallback ? fallback.rate : 0);
  return { record: f, date: f._d || today(), time: timeOf(tsMs(f.timestamp)), name: f.machineName || mName(f.machineId) || 'Unassigned machine', category: fuelTypeForCost(f), qty, unit: 'L', rate, cost: rate > 0 ? qty * rate : null, source: transactionRate > 0 ? 'Transaction rate' : (fallback ? fallback.source : 'Transaction rate') };
}
function turfCostLine(p) {
  const product = turfProductForPlan(p);
  const category = turfPlanCategory(p);
  const status = turfRecordStatus(p);
  const stockUnit = String(product && (product.unit ?? product.stockUnit ?? product.uom ?? product.unitOfMeasure) || '').trim();
  const unit = String(p.unit ?? p.stockUnit ?? p.uom ?? p.unitOfMeasure ?? stockUnit ?? '').trim();
  const unitMatches = !!(unit && stockUnit && unit.toLowerCase() === stockUnit.toLowerCase());
  const rate = product ? Math.max(0, num(product.unitCost ?? product.unitRate ?? product.costPerUnit ?? product.rate)) : 0;
  const qty = Math.max(0, turfRecordQuantity(p));
  const rateUsable = !!(product && rate > 0 && unitMatches);
  const cost = ['Applied','Issued'].includes(status) && rateUsable ? qty * rate : null;
  let source = !product ? 'Product not linked to Inventory Master' : !unitMatches ? 'Unit missing or mismatch' : rate <= 0 ? 'Product unit cost not set' : 'Inventory Master';
  return { record: p, date: turfRecordDate(p), time: timeOf(tsMs(p.issuedAt ?? p.issueTimestamp ?? p.appliedAt ?? p.completedAt ?? p.timestamp ?? p.createdAt ?? p.createdTime)), name: turfRecordProductName(p) || (product ? itemName(product) : 'Unspecified product'), category, status, qty, unit: unit || stockUnit || 'Unit not set', rate, cost, source, countable: ['Applied','Issued'].includes(status) }; 
}
function dayFuelCostLines(day = today()) {
  return fuelIn(day, day).slice().sort(sortFuel).map(fuelCostLine);
}
function dayMaintenanceCostLines(day = today()) {
  return (S.maintenance || []).filter(r => {
    const date = r.date || r.maintenanceDate || r.serviceDate || normDate(null, r.timestamp);
    const raw = [r.totalCost, r.cost, r.amount, r.serviceCost].find(v => v !== undefined && v !== null && v !== '');
    return date === day && raw !== undefined;
  }).map(r => {
    const raw = [r.totalCost, r.cost, r.amount, r.serviceCost].find(v => v !== undefined && v !== null && v !== '');
    return { record:r, date:r.date || r.maintenanceDate || r.serviceDate || normDate(null, r.timestamp), time:timeOf(tsMs(r.timestamp)), name:r.machineName || mName(r.machineId) || 'Fleet maintenance', category:`Maintenance · ${r.type || 'Service'}`, qty:null, unit:'', rate:0, cost:Math.max(0,num(raw)), source:'Recorded maintenance cost', isMaintenance:true };
  });
}
function dayFleetCostLines(day = today()) {
  return [...dayFuelCostLines(day), ...dayMaintenanceCostLines(day)].sort((a,b) => (b.date || '').localeCompare(a.date || '') || tsMs(b.record.timestamp) - tsMs(a.record.timestamp));
}
function dayTurfCostLines(day = today()) {
  return (S.plans || []).filter(p => turfRecordDate(p) === day && isTurfCategory(turfPlanCategory(p))).map(turfCostLine).sort((a,b) => tsMs(b.record.issuedAt ?? b.record.issueTimestamp ?? b.record.appliedAt ?? b.record.completedAt ?? b.record.timestamp ?? b.record.createdAt ?? b.record.createdTime) - tsMs(a.record.issuedAt ?? a.record.issueTimestamp ?? a.record.appliedAt ?? a.record.completedAt ?? a.record.timestamp ?? a.record.createdAt ?? a.record.createdTime));
}
function summariseCostLines(lines, countableOnly = false) {
  const relevant = countableOnly ? lines.filter(x => x.countable) : lines;
  const priced = relevant.filter(x => x.cost !== null && Number.isFinite(x.cost));
  return { lines, relevant, priced, total: priced.reduce((sum, x) => sum + x.cost, 0), count: relevant.length, pricedCount: priced.length, unpricedCount: relevant.length - priced.length };
}
function turfDayProductValueRows(day = today()) {
  const grouped = new Map();
  dayTurfCostLines(day).filter(line => line.countable).forEach(line => {
    const product = turfProductForPlan(line.record);
    const identity = product?.id || `${String(line.name).trim().toLowerCase()}|${String(line.unit).trim().toLowerCase()}`;
    const key = `${identity}|${String(line.unit).trim().toLowerCase()}`;
    if (!grouped.has(key)) grouped.set(key, { name: line.name, category: line.category, unit: line.unit || 'unit not set', qty: 0, cost: 0, pricedQty: 0, unpricedQty: 0, count: 0 });
    const row = grouped.get(key);
    row.qty += Math.max(0, num(line.qty));
    row.count += 1;
    if (line.cost !== null && Number.isFinite(line.cost)) { row.cost += line.cost; row.pricedQty += Math.max(0, num(line.qty)); }
    else row.unpricedQty += Math.max(0, num(line.qty));
  });
  return [...grouped.values()].map(row => ({ ...row, cost: row.pricedQty > 0 ? row.cost : null }))
    .sort((a,b) => (b.cost === null ? -1 : b.cost) - (a.cost === null ? -1 : a.cost) || a.name.localeCompare(b.name));
}

function updateDayCostCards(day = today()) {
  const fleet = summariseCostLines(dayFleetCostLines(day));
  const turfLines = dayTurfCostLines(day);
  const turf = summariseCostLines(turfLines, true);
  const fleetValue = $('#opsFleetDayCostValue'), fleetMeta = $('#opsFleetDayCostMeta');
  const turfValue = $('#opsTurfDayCostValue'), turfMeta = $('#opsTurfDayCostMeta');
  if (fleetValue) fleetValue.textContent = fleet.count && !fleet.pricedCount ? '₹—' : money(fleet.total);
  if (fleetMeta) fleetMeta.textContent = !fleet.count ? 'No fuel or maintenance costs recorded today' : `${fleet.pricedCount} cost line(s) priced · ${fleet.unpricedCount} fuel issue(s) unpriced`;
  if (turfValue) turfValue.textContent = turf.count && !turf.pricedCount ? '₹—' : money(turf.total);
  if (turfMeta) {
    const plannedCount = turfLines.filter(x => x.status === 'Planned').length;
    const issueCount = turfLines.filter(x => x.status === 'Issued').length;
    turfMeta.textContent = !turf.count ? (plannedCount ? `${plannedCount} planned · no issues or applications recorded` : 'No turf issues or applications recorded today') : `${turf.pricedCount} priced · ${turf.unpricedCount} unpriced issue/application line(s)${issueCount ? ` · ${issueCount} issued` : ''}${plannedCount ? ` · ${plannedCount} planned` : ''}`;
  }
  const itemsTarget = $('#opsTurfDayCostItems');
  if (itemsTarget) {
    const rows = turfDayProductValueRows(day);
    itemsTarget.innerHTML = !LOADED.plans
      ? '<div class="ops-day-cost-item-empty">Loading issued product values…</div>'
      : rows.length
        ? rows.slice(0,4).map((row, idx) => `<div class="ops-day-cost-item"><span class="ops-day-cost-rank">${idx+1}</span><span class="ops-day-cost-product"><b title="${esc(row.name)}">${esc(row.name)}</b><small>${esc(row.category)} · ${fmt(row.qty,2)} ${esc(row.unit)}</small></span><span class="ops-day-cost-item-value ${row.cost === null ? 'unpriced' : ''}" title="${row.unpricedQty>0?'Partial value: some quantities have no compatible rate':'Value from matched Inventory Master unit cost'}">${row.cost === null ? 'Unpriced' : `${money(row.cost)}${row.unpricedQty>0?'*':''}`}</span></div>`).join('') + (rows.some(row=>row.unpricedQty>0 && row.cost!==null)?'<div class="ops-day-cost-more">* Partial value · some quantities are unpriced</div>':'') + (rows.length>4?`<div class="ops-day-cost-more">+ ${rows.length-4} more products · open analytics</div>`:'')
        : '<div class="ops-day-cost-item-empty">No issued/applied products recorded today.</div>';
  }
}
function openDayCostLedger(domain = 'fleet') {
  const day = today(), dayLabel = dLong(day), isFleet = domain !== 'turf';
  const summary = isFleet ? summariseCostLines(dayFleetCostLines(day)) : summariseCostLines(dayTurfCostLines(day), true);
  const rows = isFleet ? summary.lines : summary.lines;
  const bodyRows = rows.length ? rows.map(line => {
    const costCell = line.cost !== null ? money(line.cost) : (line.status === 'Planned' ? 'Plan only' : 'Unpriced');
    const status = line.isMaintenance ? '<span class="badge ok">Recorded cost</span>' : line.status ? `<span class="badge ${line.status === 'Applied' ? 'ok' : 'warn'}">${esc(line.status)}</span>` : '<span class="badge mute">Issued</span>';
    const quantityCell = isFleet ? (line.isMaintenance ? '—' : `${fmt(line.qty,2)} L`) : `${fmt(line.qty,2)} ${esc(line.unit)}`;
    return `<tr><td>${esc(line.time || '—')}</td><td><b>${esc(line.name)}</b><div class="record-meta">${esc(line.category)}</div></td><td class="num">${quantityCell}</td><td class="num">${line.rate > 0 ? money(line.rate,2) : '—'}</td><td class="num"><b>${esc(costCell)}</b></td><td>${isFleet ? `${status}<div class="record-meta">${esc(line.source)}</div>` : `${status}<div class="record-meta">${esc(line.source)}</div>`}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">No ${isFleet ? 'fuel issues' : 'turf application records'} for ${esc(dayLabel)}.</td></tr>`;
  const pricedVolume = summary.priced.reduce((sum, line) => sum + (line.isMaintenance ? 0 : num(line.qty)), 0);
  const title = isFleet ? 'Fleet Ops · Day Cost Ledger' : 'Turf Ops · Day Cost Ledger';
  const caveat = isFleet
    ? 'Includes fuel issues priced by transaction rate or matching Inventory Master unit cost, plus maintenance records with an explicit cost field. Unpriced fuel issues, labour and other overheads are excluded from the rupee total.'
    : 'Only records marked Issued or Applied contribute to the total. Cost is estimated from the recorded issue/application quantity × Inventory Master unit cost. Planned-only entries are excluded. Missing or mismatched units remain unpriced.';
  const head = `<div class="day-ledger-summary"><div><span>RECORDED COST · ${esc(dayLabel.toUpperCase())}</span><b>${summary.count && !summary.pricedCount ? '₹—' : money(summary.total)}</b><small>${summary.pricedCount} priced line(s) · ${summary.unpricedCount} unpriced line(s)${isFleet ? ` · ${fmt(pricedVolume,2)} L priced` : ''}</small></div><div class="day-ledger-meta"><span>${summary.count} cost line(s)</span><span>${isFleet ? 'Fuel issues' : 'Applied turf products'}</span></div></div>`;
  openModal({ title, sub: 'Daily cost entries · live records', body: `${head}<div class="table-wrap"><table><thead><tr><th>Time</th><th>${isFleet ? 'Machine / fuel type' : 'Product / category'}</th><th class="num">${isFleet ? 'Quantity' : 'Applied qty'}</th><th class="num">Rate</th><th class="num">Cost</th><th>${isFleet ? 'Rate source' : 'Status / rate source'}</th></tr></thead><tbody>${bodyRows}</tbody><tfoot><tr><td colspan="4">Priced total</td><td class="num">${summary.count && !summary.pricedCount ? '₹—' : money(summary.total)}</td><td></td></tr></tfoot></table></div><p class="day-ledger-note">${esc(caveat)}</p>`, footer: `<button class="btn" data-act="export-day-cost" data-domain="${isFleet ? 'fleet' : 'turf'}"><span class="material-symbols-rounded">download</span>Export CSV</button><button class="btn btn-primary" data-act="close-modal">Close</button>` });
}
function exportDayCostLedger(domain = 'fleet') {
  const day = today(), isFleet = domain !== 'turf';
  const lines = isFleet ? dayFleetCostLines(day) : dayTurfCostLines(day);
  const header = isFleet ? ['Date','Time','Machine','Fuel type','Litres','Rate per litre','Recorded cost','Rate source'] : ['Date','Time','Category','Product','Status','Quantity','Unit','Unit rate','Recorded cost','Cost source'];
  const rows = lines.map(line => isFleet
    ? [line.date,line.time,line.name,line.category,line.qty,line.rate || '',line.cost === null ? '' : line.cost,line.source]
    : [line.date,line.time,line.category,line.name,line.status,line.qty,line.unit,line.rate || '',line.cost === null ? '' : line.cost,line.source]);
  downloadCSV(`${isFleet ? 'fleet' : 'turf'}_day_cost_${day}.csv`, [header, ...rows]);
}

function buildTurfCostAnalytics(from, to) {
  const allRows = (S.plans || []).filter(p => {
    const date = turfRecordDate(p);
    return date && date >= from && date <= to && isTurfCategory(turfPlanCategory(p)) && ['Issued','Applied'].includes(turfRecordStatus(p));
  }).map(turfCostLine).sort((a,b) => (b.cost ?? -1) - (a.cost ?? -1) || b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const priced = allRows.filter(row => row.cost !== null && Number.isFinite(row.cost));
  const unpriced = allRows.filter(row => row.cost === null);
  const total = priced.reduce((sum,row)=>sum+row.cost,0);
  const productMap = new Map();
  allRows.forEach(row => {
    const product = turfProductForPlan(row.record);
    const key = `${product?.id || String(row.name).trim().toLowerCase()}|${String(row.unit).toLowerCase()}`;
    if (!productMap.has(key)) productMap.set(key,{name:row.name,category:row.category,unit:row.unit,qty:0,value:0,hasPriced:false,records:0,unpriced:0});
    const productRow=productMap.get(key); productRow.qty+=Math.max(0,num(row.qty)); productRow.records++;
    if(row.cost!==null){productRow.value+=row.cost;productRow.hasPriced=true;}else productRow.unpriced++;
  });
  const products=[...productMap.values()].map(row=>({...row,value:row.hasPriced?row.value:null})).sort((a,b)=>(b.value===null?-1:b.value)-(a.value===null?-1:a.value)||a.name.localeCompare(b.name));
  const startMs=new Date(from+'T00:00:00').getTime(), endMs=new Date(to+'T00:00:00').getTime();
  const spanDays=Math.max(1,Math.floor((endMs-startMs)/86400000)+1);
  const bucketSize=Math.max(1,Math.ceil(spanDays/28));
  const buckets=[];
  for(let offset=0;offset<spanDays;offset+=bucketSize){
    const bucketFrom=addDays(from,offset),bucketTo=addDays(from,Math.min(spanDays-1,offset+bucketSize-1));
    buckets.push({from:bucketFrom,to:bucketTo,label:bucketSize===1?dShort(bucketFrom):`${dShort(bucketFrom)}–${dShort(bucketTo)}`,value:0});
  }
  priced.forEach(row=>{const offset=Math.max(0,Math.floor((new Date(row.date+'T00:00:00').getTime()-startMs)/86400000));const idx=Math.min(buckets.length-1,Math.floor(offset/bucketSize));if(idx>=0&&buckets[idx])buckets[idx].value+=row.cost;});
  const productsChart=products.filter(row=>row.value!==null).slice(0,8).map(row=>({label:row.name.length>17?row.name.slice(0,16)+'…':row.name,value:row.value}));
  const linesHtml=allRows.length?allRows.map(row=>`<tr><td>${esc(row.date)}</td><td><span class="badge ${turfCategoryClass(row.category)}">${esc(row.category)}</span></td><td><b>${esc(row.name)}</b></td><td><span class="badge ${row.status==='Applied'?'ok':'gold'}">${esc(row.status)}</span></td><td class="num">${fmt(row.qty,3)} ${esc(row.unit)}</td><td class="num">${row.rate>0?`${money(row.rate,2)} / ${esc(row.unit)}`:'—'}</td><td class="num"><b>${row.cost===null?'Unpriced':money(row.cost)}</b></td><td>${esc(row.source)}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">No issued/applied turf-product records in this date range.</td></tr>';
  return `<div class="turf-cost-analytics-results">
    <div class="turf-cost-summary-grid">
      <div class="turf-cost-summary primary"><small>PRICED ISSUE / APPLICATION VALUE</small><b>${allRows.length&&!priced.length?'₹—':money(total)}</b><span>Inventory rate × logged issue/application quantity</span></div>
      <div class="turf-cost-summary"><small>ISSUED / APPLIED RECORDS</small><b>${fmt(allRows.length,0)}</b><span>Recorded status; physical use not independently verified</span></div>
      <div class="turf-cost-summary"><small>UNPRICED RECORDS</small><b>${fmt(unpriced.length,0)}</b><span>Missing product link, unit match, or inventory rate</span></div>
      <div class="turf-cost-summary"><small>PRODUCT / UNIT LINES</small><b>${fmt(products.length,0)}</b><span>Different stock units kept separate</span></div>
    </div>
    <div class="turf-cost-chart-grid">
      <section class="turf-cost-panel"><div class="turf-cost-panel-head"><div><small>SPEND TREND</small><h3>Recorded value over time</h3></div><span>${bucketSize===1?'Daily':bucketSize<8?'Weekly buckets':'Range buckets'}</span></div>${priced.length?barChart(buckets,{unit:'₹',h:210}):'<div class="turf-cost-chart-empty">No priced issue/application value in this range.</div>'}</section>
      <section class="turf-cost-panel"><div class="turf-cost-panel-head"><div><small>PRODUCT MIX</small><h3>Highest recorded value</h3></div><span>Top 8</span></div>${productsChart.length?barChart(productsChart,{unit:'₹',h:210}):'<div class="turf-cost-chart-empty">No products have a reliable cost in this range.</div>'}</section>
    </div>
    <section class="turf-cost-panel turf-cost-detail-panel"><div class="turf-cost-panel-head"><div><small>ERP DETAIL REGISTER</small><h3>Issued line items</h3></div><span>${fmt(allRows.length,0)} lines · value descending</span></div><div class="table-wrap"><table class="turf-cost-table"><thead><tr><th>Date</th><th>Category</th><th>Product</th><th>Status</th><th class="num">Quantity</th><th class="num">Unit rate</th><th class="num">Recorded value</th><th>Cost basis</th></tr></thead><tbody>${linesHtml}</tbody></table></div>
    <p class="turf-cost-caveat">Cost is an estimate from the linked Inventory Master unit cost. A value is calculated only when the product link and unit match and a positive unit cost exists. Planned-only records are excluded; unpriced rows are kept visible instead of being treated as ₹0.</p></section>
  </div>`;
}
function renderTurfCostAnalytics(from, to) {
  const fromInput=$('#turfCostFrom'),toInput=$('#turfCostTo');
  if(!fromInput||!toInput)return;
  if(!from||!to)return;
  if(from>to){const swap=from;from=to;to=swap;fromInput.value=from;toInput.value=to;}
  const results=$('#turfCostAnalyticsResults');
  if(results) results.innerHTML=buildTurfCostAnalytics(from,to);
}
function openTurfCostAnalytics() {
  const to=today(),from=monthStart(to);
  openModal({title:'Turf Ops · Cost Analytics',sub:'Issued product cost · date-filtered ERP register',size:'turf-cost-analytics',body:`
    <div class="turf-cost-filterbar"><div class="turf-cost-dates"><label>From<input id="turfCostFrom" type="date" value="${from}" max="${to}"></label><label>To<input id="turfCostTo" type="date" value="${to}" max="${to}"></label><button class="btn btn-primary" data-act="turf-cost-apply"><span class="material-symbols-rounded">filter_alt</span>Apply range</button></div><div class="turf-cost-presets"><button class="chip" data-act="turf-cost-preset" data-range="7d">7 days</button><button class="chip" data-act="turf-cost-preset" data-range="30d">30 days</button><button class="chip on" data-act="turf-cost-preset" data-range="mtd">Month to date</button></div></div>
    <div id="turfCostAnalyticsResults">${buildTurfCostAnalytics(from,to)}</div>`,footer:`<button class="btn" data-act="export-turf-cost-range"><span class="material-symbols-rounded">download</span>Export CSV</button><button class="btn btn-primary" data-act="close-modal">Close</button>`});
}
function applyTurfCostPreset(range) {
  const to=today();
  const from=range==='7d'?addDays(to,-6):range==='30d'?addDays(to,-29):monthStart(to);
  const fromInput=$('#turfCostFrom'),toInput=$('#turfCostTo');
  if(fromInput)fromInput.value=from;if(toInput)toInput.value=to;
  qsa('.turf-cost-presets .chip').forEach(btn=>btn.classList.toggle('on',btn.dataset.range===range));
  renderTurfCostAnalytics(from,to);
}
function exportTurfCostRange() {
  const from=$('#turfCostFrom')?.value,to=$('#turfCostTo')?.value;
  if(!from||!to){toast('Choose a valid date range first','err');return;}
  const low=from<=to?from:to,high=from<=to?to:from;
  const lines=(S.plans||[]).filter(p=>{const date=turfRecordDate(p);return date&&date>=low&&date<=high&&isTurfCategory(turfPlanCategory(p))&&['Issued','Applied'].includes(turfRecordStatus(p));}).map(turfCostLine).sort((a,b)=>(b.cost??-1)-(a.cost??-1));
  downloadCSV(`turf_cost_analytics_${low}_to_${high}.csv`,[['Date','Category','Product','Status','Quantity','Unit','Unit Rate','Recorded Value','Cost Basis'],...lines.map(row=>[row.date,row.category,row.name,row.status,row.qty,row.unit,row.rate||'',row.cost===null?'':row.cost,row.source])]);
}

function openCostModel() {
  openForm({ title:'Operating cost model', submit:'Save assumptions', html:
    `<div class="roi-card-intro" style="margin-bottom:14px">These rates affect dashboard estimates in this browser only. A transaction-level rate saved on a fuel record takes priority. Without a rate, that volume is marked unpriced; historical entries are not modified.</div>` +
    `<div class="row2">${fld('Diesel price · ₹ / L', `<input id="costDiesel" type="number" min="0" step="0.01" value="${num(COST.dieselRate)}">`, 'Prototype default: ₹92.50/L. Verify against your supplier invoice.')}${fld('Petrol price · ₹ / L', `<input id="costPetrol" type="number" min="0" step="0.01" value="${num(COST.petrolRate)}">`, '₹0 means petrol issues remain unpriced.')}</div>` +
    `<div class="row2">${fld('Labour cost · ₹ / run hour', `<input id="costLabour" type="number" min="0" step="1" value="${num(COST.labourPerHour)}">`, 'Optional planning assumption. Not included in fuel-only KPIs.')}${fld('Downtime exposure · ₹ / hour', `<input id="costDowntime" type="number" min="0" step="100" value="${num(COST.downtimePerHour)}">`, 'Optional value for estimating incident exposure, not accounting expense.')}</div>` +
    fld('Fuel-efficiency scenario · %', `<input id="costSavings" type="number" min="0" max="100" step="1" value="${num(COST.savingsPct)}">`, 'A what-if lever applied to projected month-end fuel spend. It is not a measured saving.') +
    fld('One-time improvement investment · ₹', `<input id="costInvestment" type="number" min="0" step="1000" value="${num(COST.improvementCost)}">`, 'Optional purchase / implementation cost for payback and first-year ROI. Leave at 0 until a real quote is available.') +
    `<div class="hint">Saved to this browser’s local storage only. For shared, auditable cost rates, move the settings into an authorised Firestore configuration document.</div>`,
    onSubmit: async()=>{ const v={dieselRate:num($('#costDiesel').value),petrolRate:num($('#costPetrol').value),labourPerHour:num($('#costLabour').value),downtimePerHour:num($('#costDowntime').value),savingsPct:num($('#costSavings').value),improvementCost:num($('#costInvestment').value)}; if(v.savingsPct>100){toast('Scenario percentage must be between 0 and 100','err');return false;} Object.assign(COST,v); saveCostModel(); toast('Cost model saved for this browser'); renderOverview(); }
  });
}
function exportROIReport() {
  const x=monthlyCostSnapshot(), start=x.from, end=x.t;
  const rows=[['Clover Greens Ops · ROI & Cost Report'],['Period',start,end],['Important','Fuel cost estimated from transaction prices where present, otherwise configured per-litre rate. Zero/missing prices are excluded.'],[],['SUMMARY','VALUE','NOTES'],
    ['Modeled fuel spend MTD',x.mFuel.cost,`${fmt(x.mFuel.litres)} L; priced volume ${fmt(x.mFuel.pricedLitres)} L; unpriced ${fmt(x.mFuel.unpricedLitres)} L`],
    ['Projected monthly fuel reduction scenario',x.savingsScenario,`${fmt(COST.savingsPct)}% of projected month-end fuel spend; not a realised saving`],['Annualised gross fuel savings scenario',x.annualSavingsScenario,'Projected monthly scenario × 12; assumes a comparable run rate'],['One-time improvement investment',COST.improvementCost,'User-entered estimate / quote'],['Payback period in months',x.paybackMonths==null?'':x.paybackMonths,'Only calculated when investment and positive monthly savings are entered'],['First-year ROI %',x.firstYearROI==null?'':x.firstYearROI,'(Annualised gross savings − one-time investment) ÷ investment'],['Fuel cost per engine hour · 30d',x.fuelCostPerHour==null?'':x.fuelCostPerHour,'Fuel only; matched logged engine hours'],['Labour cost proxy · MTD',x.labourCostMTD,`Based on ${money(COST.labourPerHour)}/recorded engine hour; assumption only`],['Projected month-end fuel spend',x.projectedFuel,'Run rate projection, not a budget'],['Inventory stock value · priced lines',x.inv.value,`${x.inv.unpricedCount} stocked line(s) lack unit cost`],['Priced reorder gap',x.inv.reorderValue,'Cost to reach reorder levels on priced items only'],['Priced turf plan lines · MTD',x.plans.cost,`${x.plans.priced} priced lines; ${x.plans.unpriced} unpriced lines`],['Maintenance costs recorded · MTD',x.maintenanceCost,'Only explicit cost fields from maintenance logs included'],['Open incidents',x.openIncidents.length,`${x.downtimeHours} estimated downtime hours entered`],['Estimated downtime exposure',x.downtimeExposure,'Only shown when downtime hours and hourly exposure rate are configured'],[],['MACHINE COST / HOUR · TRAILING 30 DAYS','CATEGORY','FUEL COST','RUN HOURS','LITRES','FUEL COST / HOUR']];
  x.machineCosts.forEach(m=>rows.push([m.name,m.category,m.fuelCost,m.hours,m.litres,m.costPerHour]));
  rows.push([],['INVENTORY','STOCK','AUTO REORDER AT','UNIT COST','STOCK VALUE','LOW STOCK']);
  S.inventory.slice().sort((a,b)=>(a.partName||'').localeCompare(b.partName||'')).forEach(i=>rows.push([itemName(i),num(i.stockQuantity),effectiveReorderLevel(i),num(i.unitCost)||'',num(i.unitCost)>0?num(i.stockQuantity)*num(i.unitCost):'',num(i.stockQuantity)<=effectiveReorderLevel(i)?'YES':'NO']));
  downloadCSV(`clover_greens_roi_${start}_to_${end}.csv`,rows);
}
function editInventoryCost(id) {
  const i=S.inventory.find(x=>x.id===id); if(!i)return;
  openForm({title:'Update inventory & unit cost',submit:'Save item',html:
    fld('Product / part name',`<input id="editPartName" value="${esc(i.partName||'')}">`)+
    fld('Category',`<select id="editPartCat">${['Fuel','Spare Parts','Fertilizers','Pesticides','Turf Enhancements','Tools','Other'].map(c=>`<option ${i.category===c?'selected':''}>${c}</option>`).join('')}</select>`)+
    `<div class="row2">${fld('Stock quantity',`<input id="editPartStock" type="number" min="0" step="any" value="${num(i.stockQuantity)}">`)}${fld('Automatic reorder policy',`<div class="auto-reorder-form-note"><b>${fmt(effectiveReorderLevel(i),2)} ${esc(i.unit||'units')}</b><small>${autoReorderDetails(i).method} · ${autoReorderDetails(i).leadDays}-day lead time</small></div>` )}</div>`+
    fld('Unit',`<select id="editPartUnit">${['Nos','Kg','Litre','Gram','ML','Bag','Pack'].map(u=>`<option ${i.unit===u?'selected':''}>${u}</option>`).join('')}</select>`)+
    fld('Unit cost · ₹ per stock unit',`<input id="editPartCost" type="number" min="0" step="0.01" value="${num(i.unitCost)}">`,'Set 0 if price is not yet known. Stock value uses quantity × unit cost.'),
    onSubmit:async()=>{const name=$('#editPartName').value.trim();if(!name){toast('Part name is required','err');return false;}await updateDoc(doc(db,CONFIG.COL.inventory,id),{partName:name,category:$('#editPartCat').value,stockQuantity:Math.max(0,num($('#editPartStock').value)),unit:$('#editPartUnit').value,unitCost:Math.max(0,num($('#editPartCost').value))});toast('Inventory and cost updated');}
  });
}

/* ================= FLEET ================= */

  return { sortFuel, fuelTypeForCost, fuelMasterRate, fuelCostLine, turfCostLine, dayFuelCostLines, dayMaintenanceCostLines, dayFleetCostLines, dayTurfCostLines, summariseCostLines, turfDayProductValueRows, updateDayCostCards, openDayCostLedger, exportDayCostLedger, buildTurfCostAnalytics, renderTurfCostAnalytics, openTurfCostAnalytics, applyTurfCostPreset, exportTurfCostRange, openCostModel, exportROIReport, editInventoryCost };
}
