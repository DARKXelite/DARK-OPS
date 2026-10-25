/** Shared fleet, fuel, machine status and cost-domain calculations. */
export function createFleetDomainModule(deps) {
  const { CONFIG, COST, S, addDays, effectiveReorderLevel, fuelMasterRate, fuelTypeForCost, monthStart, normDate, num, sum, today, tsMs } = deps;
function rateForFuelLog(f) {
  const recorded = num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre);
  if (recorded > 0) return recorded;
  // Do not invent a fallback price: use the matching Fuel Inventory Master rate or leave it unpriced.
  return fuelMasterRate(fuelTypeForCost(f)).rate;
}
function fuelLogCost(f) { return Math.max(0, num(f.litres ?? f.quantity ?? f.qty)) * rateForFuelLog(f); }
function fuelCostSummary(rows) {
  let litres = 0, pricedLitres = 0, cost = 0;
  rows.forEach(f => { const L = Math.max(0, num(f.litres)), rate = rateForFuelLog(f); litres += L; if (rate > 0) { pricedLitres += L; cost += L * rate; } });
  return { litres, pricedLitres, unpricedLitres: Math.max(0, litres - pricedLitres), cost, coverage: litres > 0 ? pricedLitres / litres * 100 : 100 };
}
function inventoryCostSummary(items=S.inventory) {
  const priced = items.filter(i => num(i.unitCost) > 0);
  const unpriced = items.filter(i => num(i.stockQuantity) > 0 && num(i.unitCost) <= 0);
  return { value: priced.reduce((a, i) => a + Math.max(0, num(i.stockQuantity)) * num(i.unitCost), 0), pricedCount: priced.length, unpricedCount: unpriced.length, total: items.length,
    reorderValue: items.reduce((a, i) => a + Math.max(0, effectiveReorderLevel(i) - num(i.stockQuantity)) * Math.max(0, num(i.unitCost)), 0), low: items.filter(i => num(i.stockQuantity) <= effectiveReorderLevel(i)) };
}
function monthPlansCost(from, to) {
  const rows = (S.plans || []).filter(p => p.date && p.date >= from && p.date <= to);
  let cost = 0, priced = 0, unpriced = 0, totalQty = 0;
  rows.forEach(p => { const prod = S.inventory.find(i => i.id === p.productId) || S.inventory.find(i => i.partName === p.productName); const qty = Math.max(0, num(p.targetQty)); totalQty += qty; if (prod && num(prod.unitCost) > 0) { cost += qty * num(prod.unitCost); priced++; } else unpriced++; });
  return { rows, cost, priced, unpriced, totalQty };
}
function monthlyCostSnapshot() {
  const t = today(), from = monthStart(t), thirty = addDays(t, -29);
  const mFuel = fuelCostSummary(fuelIn(from, t)), d30Fuel = fuelCostSummary(fuelIn(thirty, t));
  const mHours = sum(shiftsIn(from, t), 'engineHoursLogged'), d30Hours = sum(shiftsIn(thirty, t), 'engineHoursLogged');
  const elapsed = Math.max(1, Number(t.slice(8, 10))), dim = new Date(+t.slice(0,4), +t.slice(5,7), 0).getDate();
  const plans = monthPlansCost(from, t), inv = inventoryCostSummary();
  const openIncidents = S.logs.filter(l => (l.repairStatus || 'Pending') !== 'Resolved');
  const downtimeHours = openIncidents.reduce((a, l) => a + Math.max(0, num(l.estimatedDowntimeHours)), 0);
  const maintenanceCost = (S.maintenance || []).filter(r => { const d = r.date || normDate(null, r.timestamp); return d >= from && d <= t; }).reduce((a, r) => a + Math.max(0, num(r.totalCost ?? r.cost ?? r.amount ?? r.serviceCost)), 0);
  const machineCosts = S.machines.map(m => {
    const fl = fuelIn(thirty, t).filter(f => f.machineId === m.id || f.machineId === m.assetName || f.machineName === m.assetName);
    const sh = shiftsIn(thirty, t).filter(x => x.machineId === m.id || x.machineId === m.assetName || x.machineName === m.assetName);
    const fuel = fuelCostSummary(fl), hours = sum(sh, 'engineHoursLogged');
    return { name: m.assetName || 'Unnamed machine', category: m.category || 'Machine', litres: fuel.litres, pricedLitres: fuel.pricedLitres, fuelCost: fuel.cost, hours, lph: hours > 0 ? fuel.litres / hours : null, costPerHour: hours > 0 ? fuel.cost / hours : null, fuelCoverage: fuel.coverage };
  }).filter(m => m.hours > 0 && m.litres > 0).sort((a,b) => (b.costPerHour ?? -1) - (a.costPerHour ?? -1));
  const projectedFuel = mFuel.cost / elapsed * dim;
  const savingsScenario = projectedFuel * COST.savingsPct / 100;
  const annualSavingsScenario = savingsScenario * 12;
  const paybackMonths = savingsScenario > 0 && COST.improvementCost > 0 ? COST.improvementCost / savingsScenario : null;
  const firstYearROI = COST.improvementCost > 0 ? ((annualSavingsScenario - COST.improvementCost) / COST.improvementCost) * 100 : null;
  return { t, from, thirty, mFuel, d30Fuel, mHours, d30Hours, elapsed, dim, projectedFuel, savingsScenario, annualSavingsScenario, paybackMonths, firstYearROI,
    fuelCostPerHour: d30Hours > 0 ? d30Fuel.cost / d30Hours : null, modeledVariableCostPerHour: d30Hours > 0 ? (d30Fuel.cost + d30Hours * COST.labourPerHour) / d30Hours : null, labourCostMTD: mHours * COST.labourPerHour, labourCost30d: d30Hours * COST.labourPerHour, plans, inv, openIncidents, downtimeHours, downtimeExposure: downtimeHours * COST.downtimePerHour,
    maintenanceCost, machineCosts, serviceDue: S.machines.filter(m => svc(m).remaining <= CONFIG.SERVICE_WARN), lowStock: inv.low };
}

let _mx = null, _mxv = -1;
function mx() { if (_mxv !== S._v) { _mx = new Map(); S.machines.forEach(m => { _mx.set(m.id, m); if (m.assetName) _mx.set(m.assetName, m); }); _mxv = S._v; } return _mx; }
const mKey = id => { if (!id) return 'Unknown'; const m = mx().get(id); return m ? m.id : 'raw:' + id; };
const mName = id => { const m = mx().get(id); return m ? m.assetName : (id || '—'); };
const fuelTypeOf = id => { if (!id) return 'Unspecified'; const m = mx().get(id); return m && m.fuelType ? m.fuelType : 'Unspecified'; };
function canonicalFuelType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/diesel|\bdsl\b/.test(raw)) return 'Diesel';
  if (/petrol|gasoline|\bgas\b/.test(raw)) return 'Petrol';
  return '';
}
function fuelTypeFromRecord(f) {
  const direct = canonicalFuelType(f && (f.fuelType ?? f.fuel_type ?? f.fuel ?? f.fuelName ?? f.fuel_type_name ?? f.type));
  return direct || canonicalFuelType(fuelTypeOf(f && (f.machineId ?? f.machineID ?? f.machine ?? f.assetId))) || 'Unspecified';
}
function fuelRecordDate(f) {
  if (f && f._d) return f._d;
  const dateValue = f && (f.issueDate ?? f.issuedDate ?? f.date ?? f.transactionDate ?? f.createdDate);
  return normDate(dateValue, f && (f.issuedAt ?? f.issueTimestamp ?? f.timestamp ?? f.createdAt ?? f.createdOn ?? f.updatedAt ?? f.recordedAt));
}
const fuelIn = (a, b) => S.fuel.filter(f => { const d = fuelRecordDate(f); return d && d >= a && d <= b; });
const shiftsIn = (a, b) => S.shifts.filter(s => s._d && s._d >= a && s._d <= b);
const litresFor = (m, a, b) => S.fuel.reduce((t, f) => { const d=fuelRecordDate(f); return (d >= a && d <= b && (f.machineId === m.id || f.machineId === m.assetName)) ? t + num(f.litres ?? f.quantity ?? f.qty) : t; }, 0);
const hoursFor = (m, a, b) => S.shifts.reduce((t, s) => (s._d >= a && s._d <= b && (s.machineId === m.id || s.machineId === m.assetName)) ? t + num(s.engineHoursLogged) : t, 0);
function splitFuel(ent) { const o = { Diesel: 0, Petrol: 0, Unspecified: 0 }; ent.forEach(f => { const t = fuelTypeFromRecord(f); o[t] = (o[t] || 0) + num(f.litres ?? f.quantity ?? f.qty); }); return o; }

function svc(m) {
  const cur = num(m.currentHours), INT = CONFIG.SERVICE_INTERVAL;
  const last = (m.lastServiceHours !== undefined && m.lastServiceHours !== null && m.lastServiceHours !== '') ? num(m.lastServiceHours) : Math.floor(cur / INT) * INT;
  const since = Math.max(0, cur - last), remaining = INT - since;
  const level = remaining <= 0 ? 'over' : remaining <= CONFIG.SERVICE_WARN ? 'due' : 'ok';
  return { since, remaining, pct: Math.min(100, Math.max(2, since / INT * 100)), level };
}
function eff(m) {
  const t = today();
  const f = (a, b) => { const L = litresFor(m, a, b), H = hoursFor(m, a, b); return { L, H, r: H > 0 ? L / H : null }; };
  const d30 = f(addDays(t, -29), t), w1 = f(addDays(t, -6), t), w0 = f(addDays(t, -13), addDays(t, -7));
  let trend = null; if (w1.r != null && w0.r != null && w0.r > 0) trend = (w1.r - w0.r) / w0.r * 100;
  return { ...d30, trend };
}
function liveList() {
  const now = Date.now();
  return S.live.filter(l => l.isActive === true && l.lat != null && l.lng != null).map(l => {
    const ts = tsMs(l.lastUpdated ?? l.updatedAt ?? l.timestamp ?? l.lastUpdate ?? l.lastSeen);
    return { ...l, _ts: ts, _stale: ts ? (now - ts) / 1000 > CONFIG.STALE_SEC : false, _name: l.machineName || l.machineId || l.id };
  });
}
const liveNow = () => liveList().filter(l => !l._stale);
function liveKeys() { const s = new Set(); liveNow().forEach(l => { s.add(l._name); s.add(l.id); if (l.machineId) s.add(l.machineId); }); return s; }

/* ================= UI PRIMITIVES ================= */

  return { rateForFuelLog, fuelLogCost, fuelCostSummary, inventoryCostSummary, monthPlansCost, monthlyCostSnapshot, mx, mKey, mName, fuelTypeOf, canonicalFuelType, fuelTypeFromRecord, fuelRecordDate, fuelIn, shiftsIn, litresFor, hoursFor, splitFuel, svc, eff, liveList, liveNow, liveKeys };
}
