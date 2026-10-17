export function createCostAnalytics({
  state, cost, num, today, monthStart, addDays, fuelIn, shiftsIn, sum, svc,
  CONFIG, effectiveReorderLevel, fuelMasterRate, fuelTypeForCost, normDate
}) {
  const S = state;
  const COST = cost;
  function rateForFuelLog(f) {
    const recorded = num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre);
    if (recorded > 0) return recorded;
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
    const mHours = sum(shiftsIn(from, t), "engineHoursLogged"), d30Hours = sum(shiftsIn(thirty, t), "engineHoursLogged");
    const elapsed = Math.max(1, Number(t.slice(8, 10))), dim = new Date(+t.slice(0,4), +t.slice(5,7), 0).getDate();
    const plans = monthPlansCost(from, t), inv = inventoryCostSummary();
    const openIncidents = S.logs.filter(l => (l.repairStatus || "Pending") !== "Resolved");
    const downtimeHours = openIncidents.reduce((a, l) => a + Math.max(0, num(l.estimatedDowntimeHours)), 0);
    const maintenanceCost = (S.maintenance || []).filter(r => { const d = r.date || normDate(null, r.timestamp); return d >= from && d <= t; }).reduce((a, r) => a + Math.max(0, num(r.totalCost ?? r.cost ?? r.amount ?? r.serviceCost)), 0);
    const machineCosts = S.machines.map(m => {
      const fl = fuelIn(thirty, t).filter(f => f.machineId === m.id || f.machineId === m.assetName || f.machineName === m.assetName);
      const sh = shiftsIn(thirty, t).filter(x => x.machineId === m.id || x.machineId === m.assetName || x.machineName === m.assetName);
      const fuel = fuelCostSummary(fl), hours = sum(sh, "engineHoursLogged");
      return { name: m.assetName || "Unnamed machine", category: m.category || "Machine", litres: fuel.litres, pricedLitres: fuel.pricedLitres, fuelCost: fuel.cost, hours, lph: hours > 0 ? fuel.litres / hours : null, costPerHour: hours > 0 ? fuel.cost / hours : null, fuelCoverage: fuel.coverage };
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
  return { rateForFuelLog, fuelLogCost, fuelCostSummary, inventoryCostSummary, monthPlansCost, monthlyCostSnapshot };
}
