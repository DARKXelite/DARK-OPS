/**
 * Read-model and rendering functions for fuel ledger and shift history views.
 * Dependencies are injected so the functions can be tested and reused without globals.
 */
export function createLedgerViewsModule(context) {
  const {
    R, S, LOADED, $, setHTML, rangeBar, machineOptions,
    fuelIn, mKey, fuelTypeFromRecord, sortFuel, sum, splitFuel, fuelCostSummary,
    fmt, money, fmtHrs, timeOf, tsMs, esc, rateForFuelLog, fuelLogCost,
    mName, num, shiftsIn, dLong
  } = context;

  function ledgerRows() { const st = R.ledger; return fuelIn(st.from, st.to).filter(f => (!st.machine || mKey(f.machineId) === st.machine) && (!st.type || fuelTypeFromRecord(f) === st.type)).sort(sortFuel); }
  function renderLedger(force) {
    const st = R.ledger; if (!LOADED.fuel) { setHTML($('#ledgerCard'), '<div class="skeleton" style="height:300px"></div>'); return; }
    const rows = ledgerRows(), tot = sum(rows, 'litres'), sp = splitFuel(rows), cost = fuelCostSummary(rows);
    const html = `${rangeBar('ledger')}<div class="toolbar"><div style="width:220px"><select data-chg="lmachine" data-k="ledger">${machineOptions(st.machine)}</select></div><div style="width:160px"><select data-chg="ltype" data-k="ledger"><option value="">All fuels</option><option ${st.type === 'Diesel' ? 'selected' : ''}>Diesel</option><option ${st.type === 'Petrol' ? 'selected' : ''}>Petrol</option></select></div><div class="grow"></div><span class="badge mute">${rows.length} entries</span><span class="badge gold">${fmt(tot)} L total</span><span class="badge gold">${money(cost.cost)} modeled cost</span><span class="badge mute">${fmt(cost.coverage,0)}% priced volume</span><span class="badge mute">Diesel ${fmt(sp.Diesel)} L</span><span class="badge mute">Petrol ${fmt(sp.Petrol)} L</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Machine</th><th>Fuel</th><th class="num">Litres</th><th class="num">Rate / L</th><th class="num">Modeled cost</th><th>Issued by</th><th>Notes</th></tr></thead><tbody>${rows.length ? rows.map(f => `<tr><td>${dLong(f._d)}</td><td class="muted">${timeOf(tsMs(f.timestamp)) || '—'}</td><td><b>${esc(f.machineName || mName(f.machineId))}</b></td><td><span class="badge ${fuelTypeFromRecord(f) === 'Petrol' ? 'warn' : 'mute'}">${esc(fuelTypeFromRecord(f))}</span></td><td class="num"><b>${fmt(num(f.litres), 2)}</b></td><td class="num">${rateForFuelLog(f)>0?money(rateForFuelLog(f),2):'—'}</td><td class="num"><b>${rateForFuelLog(f)>0?money(fuelLogCost(f)):'Unpriced'}</b></td><td class="muted">${esc(f.issuedBy || '—')}</td><td class="muted">${esc(f.notes || f.reason || '')}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">No fuel issued for these filters.</td></tr>'}</tbody>${rows.length ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${fmt(tot, 2)}</td><td></td><td class="num">${money(cost.cost)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div><div class="roi-chart-note">Recorded cost uses the transaction rate when saved, otherwise the matching Fuel Inventory Master unit cost. Missing or duplicate master prices remain unpriced and are excluded from rupee totals; local assumptions are not applied.</div>`;
    if (force) $('#ledgerCard')._h = null; setHTML($('#ledgerCard'), html);
  }
  
  /* ================= SHIFTS VIEW ================= */
  function shiftRows() { const st = R.shifts; return shiftsIn(st.from, st.to).filter(s => (!st.machine || mKey(s.machineId) === st.machine) && (!st.op || s.operatorName === st.op)).sort((a, b) => (b._d || '').localeCompare(a._d || '')); }
  function renderShifts(force) {
    const st = R.shifts; if (!LOADED.shifts) { setHTML($('#shiftsCard'), '<div class="skeleton" style="height:300px"></div>'); return; }
    const rows = shiftRows(), ops = [...new Set(S.shifts.map(s => s.operatorName).filter(Boolean))].sort();
    const html = `${rangeBar('shifts')}<div class="toolbar"><div style="width:220px"><select data-chg="smachine" data-k="shifts">${machineOptions(st.machine)}</select></div><div style="width:200px"><select data-chg="sop" data-k="shifts"><option value="">All operators</option>${ops.map(o => `<option ${st.op === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div><div class="grow"></div><span class="badge mute">${rows.length} shifts</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Operator</th><th>Machine</th><th class="num">Distance</th><th class="num">Meter hrs</th><th class="num">GPS move</th><th class="num">GPS work</th><th>Source</th></tr></thead><tbody>${rows.length ? rows.map(s => `<tr><td>${dLong(s._d)}</td><td><b>${esc(s.operatorName || 'Unknown')}</b><div class="record-meta">${esc(s.operatorMobile || '')}</div></td><td>${esc(s.machineName || mName(s.machineId))}</td><td class="num">${fmt(num(s.distanceKm), 2)} km</td><td class="num">${fmtHrs(s.engineHoursLogged)}</td><td class="num">${s.gpsMovingHours != null ? fmtHrs(s.gpsMovingHours) : '—'}</td><td class="num">${s.gpsWorkHours != null ? fmtHrs(s.gpsWorkHours) : '—'}</td><td><span class="badge mute">${esc(s.hoursSource || '—')}</span></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No shifts for these filters.</td></tr>'}</tbody>${rows.length ? `<tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(sum(rows, 'distanceKm'), 2)} km</td><td class="num">${fmtHrs(sum(rows, 'engineHoursLogged'))}</td><td class="num">${fmtHrs(sum(rows, 'gpsMovingHours'))}</td><td class="num">${fmtHrs(sum(rows, 'gpsWorkHours'))}</td><td></td></tr></tfoot>` : ''}</table></div>`;
    if (force) $('#shiftsCard')._h = null; setHTML($('#shiftsCard'), html);
  }

  return { ledgerRows, renderLedger, shiftRows, renderShifts };
}
