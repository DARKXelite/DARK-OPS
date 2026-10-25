/** Function-based Fleet module. Dependencies are injected from the application context. */
export function createFleetModule(deps) {
  const { ATTR, CONFIG, F, H, LOADED, R, S, TILE, addDays, addDoc, barChart, collection, dLong, dShort, daysBetween, db, doc, eff, esc, fld, fmt, fmtHrs, fuelCostSummary, fuelIn, fuelLogCost, fuelTypeFromRecord, getDocs, liveKeys, mKey, mName, money, monthStart, mx, num, openDrawer, openForm, openModal, pad, rangeBar, rangeLabel, rateForFuelLog, setCurModalRenderer, setHTML, shiftsIn, sortFuel, sparkline, splitFuel, sum, svc, timeOf, toast, today, tsMs, updateDoc } = deps;
function renderFleet() {
  const cats = ['All', ...new Set(S.machines.map(m => m.category).filter(Boolean))];
  setHTML($('#catChips'), cats.map(c => `<button class="chip ${F.cat === c ? 'on' : ''}" data-act="fcat" data-v="${esc(c)}">${esc(c)}</button>`).join(''));
  setHTML($('#fuelChips'), ['All', 'Diesel', 'Petrol'].map(c => `<button class="chip ${F.fuel === c ? 'on' : ''}" data-act="ffuel" data-v="${c}">${c === 'All' ? 'All fuels' : c}</button>`).join(''));
  $('#fleetSort').value = F.sort;
  if (!LOADED.machines) { setHTML($('#fleetGrid'), Array(6).fill('<div class="skeleton" style="height:300px"></div>').join('')); return; }
  const lk = liveKeys(), q = F.q.toLowerCase();
  let list = S.machines.filter(m => (!q || `${m.assetName} ${m.category}`.toLowerCase().includes(q)) && (F.cat === 'All' || m.category === F.cat) && (F.fuel === 'All' || m.fuelType === F.fuel));
  list = list.map(m => ({ m, s: svc(m) }));
  if (F.sort === 'service') list.sort((a, b) => a.s.remaining - b.s.remaining); else if (F.sort === 'hours') list.sort((a, b) => num(b.m.currentHours) - num(a.m.currentHours)); else list.sort((a, b) => (a.m.assetName || '').localeCompare(b.m.assetName || ''));
  setHTML($('#fleetGrid'), list.length ? list.map(({ m, s }) => machineCard(m, s, lk.has(m.assetName) || lk.has(m.id))).join('') : '<div class="empty" style="grid-column:1/-1">No machines match. Use “Add machine” to register one.</div>');
}
function machineCard(m, s, isLive) {
  const e = eff(m);
  let status = '<span class="badge ok">Operational</span>';
  if (isLive) status = '<span class="badge gold live">Live shift</span>';
  else if (m.status && m.status !== 'Active') status = `<span class="badge warn">${esc(m.status)}</span>`;
  else if (s.level === 'over') status = '<span class="badge bad">Service overdue</span>'; else if (s.level === 'due') status = '<span class="badge warn">Service due</span>';
  const tr = e.trend == null ? '' : `<span class="${e.trend > 3 ? 'up' : e.trend < -3 ? 'down' : ''}">${e.trend > 3 ? '?' : e.trend < -3 ? '?' : '?'} ${fmt(Math.abs(e.trend), 0)}% vs prev. week</span>`;
  const ft = m.fuelType ? `<span class="badge ${m.fuelType === 'Petrol' ? 'warn' : 'mute'}">${esc(m.fuelType)}</span>` : '';
  return `<div class="mcard ${isLive ? 'live' : ''}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><div class="cat">${esc(m.category || 'Machine')}</div><h4>${esc(m.assetName)}</h4></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${ft}${status}</div></div>
    <div class="mstats">
      <div class="mstat"><div class="k">Engine hours</div><div class="v">${fmt(num(m.currentHours))} <small>hrs</small></div></div>
      <div class="mstat"><div class="k">Fuel use</div><div class="v">${e.r == null ? '—' : fmt(e.r, 2)} <small>L/hr</small></div><div class="t">${fmt(e.L)} L · ${fmt(e.H)} hrs (30 d)</div></div>
    </div>
    ${tr ? `<div class="sm muted" style="margin-top:-4px">${tr}</div>` : ''}
    <div><div class="svc-line"><span>Service cycle · ${fmt(s.since, 0)} / ${CONFIG.SERVICE_INTERVAL} hrs</span><span class="${s.level === 'ok' ? '' : s.level === 'due' ? 'up' : ''}" style="${s.level === 'over' ? 'color:var(--bad)' : ''}">${s.remaining <= 0 ? 'Overdue by ' + fmt(-s.remaining, 0) + ' hrs' : 'Due in ' + fmt(s.remaining, 0) + ' hrs'}</span></div><div class="bar"><i class="lvl-${s.level}" style="width:${s.pct}%"></i></div></div>
    <div class="mactions"><button class="btn btn-sm" data-act="drawer-route" data-id="${esc(m.id)}"><span class="material-symbols-rounded">route</span>Routes</button><button class="btn btn-sm" data-act="drawer-fuel" data-id="${esc(m.id)}"><span class="material-symbols-rounded">local_gas_station</span>Fuel log</button>
      <div class="kebab-wrap"><button class="btn btn-sm" style="flex:none;width:34px;padding:0" data-act="kebab" aria-label="More actions"><span class="material-symbols-rounded">more_horiz</span></button>
      <div class="kmenu"><button data-act="edit-machine" data-id="${esc(m.id)}"><span class="material-symbols-rounded">edit</span>Edit details</button><button data-act="svc-done" data-id="${esc(m.id)}"><span class="material-symbols-rounded">build_circle</span>Mark serviced</button><button class="danger" data-act="del" data-col="machines" data-id="${esc(m.id)}" data-label="${esc(m.assetName)}"><span class="material-symbols-rounded">delete</span>Delete</button></div></div>
    </div></div>`;
}
function machineForm(m) {
  const edit = !!m, cats = ['Greens Mower', 'Fairway Mower', 'Rough Mower', 'Utility Vehicle', 'Tractor', 'Sprayer', 'Buggy'];
  openForm({
    title: edit ? 'Edit machine' : 'Register machine',
    html: fld('Asset name', `<input id="fName" value="${esc(m?.assetName || '')}" placeholder="e.g. Toro Greensmaster 3150">`) +
      fld('Category', `<input id="fCat" list="catList" value="${esc(m?.category || '')}" placeholder="e.g. Fairway Mower"><datalist id="catList">${cats.map(c => `<option value="${c}">`).join('')}</datalist>`) +
      fld('Fuel type', `<select id="fFuel"><option value="Diesel" ${m?.fuelType !== 'Petrol' ? 'selected' : ''}>Diesel</option><option value="Petrol" ${m?.fuelType === 'Petrol' ? 'selected' : ''}>Petrol</option></select>`) +
      `<div class="row2">${fld('Current engine hours', `<input id="fHrs" type="number" min="0" step="0.1" value="${edit ? num(m.currentHours) : 0}">`)}${fld('Last serviced at (hrs)', `<input id="fLast" type="number" min="0" step="0.1" value="${edit && m.lastServiceHours != null ? m.lastServiceHours : ''}" placeholder="optional">`)}</div><div class="hint" style="margin-top:-6px">Leave “last serviced” blank to start the ${CONFIG.SERVICE_INTERVAL}-hr cycle from the current hours.</div>`,
    submit: edit ? 'Save changes' : 'Register',
    onSubmit: async () => {
      const name = $('#fName').value.trim(); if (!name) { toast('Asset name is required', 'err'); return false; }
      if (S.machines.some(x => x.assetName?.toLowerCase() === name.toLowerCase() && x.id !== m?.id)) { toast('A machine with this name already exists', 'err'); return false; }
      const hrs = num($('#fHrs').value), lastRaw = $('#fLast').value.trim();
      const data = { assetName: name, category: $('#fCat').value.trim() || 'Utility Vehicle', fuelType: $('#fFuel').value, currentHours: hrs, lastServiceHours: lastRaw === '' ? (edit && m.lastServiceHours != null ? m.lastServiceHours : hrs) : num(lastRaw) };
      if (edit) { await updateDoc(doc(db, CONFIG.COL.machines, m.id), data); toast('Machine updated'); }
      else { await addDoc(collection(db, CONFIG.COL.machines), { ...data, status: 'Active' }); toast('Machine registered'); }
    }
  });
}

/* ================= DRAWERS ================= */
function drawerRoute(id, filterDate) {
  const m = mx().get(id); if (!m) return;
  const allShifts = S.shifts.filter(s => s.machineId === m.id || s.machineId === m.assetName);
  const selectedDate = filterDate || today();
  const rows = allShifts.filter(s => s._d === selectedDate).sort((a, b) => tsMs(b.timestamp || b.startTime) - tsMs(a.timestamp || a.startTime));

  const km = sum(rows, "distanceKm"), hrs = sum(rows, "engineHoursLogged");
  let body = `<div class="field"><label class="f">Pick Custom Date</label><input type="date" value="${selectedDate}" max="${today()}" data-chg="drdate" data-id="${esc(m.id)}"></div>
    <div class="stat-row" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><div class="k">Shifts</div><div class="v">${rows.length}</div></div><div class="stat"><div class="k">Distance</div><div class="v">${fmt(km)} <small>km</small></div></div><div class="stat"><div class="k">Run time</div><div class="v">${fmt(hrs)} <small>hrs</small></div></div></div>`;
  if (!rows.length) body += `<div class="empty">No recorded shifts on ${dLong(selectedDate)}.</div>`;
  rows.forEach(s => {
    body += `<div class="list-row"><div><b>${esc(s.operatorName || "Unknown")}</b><div class="muted sm">${fmtHrs(s.engineHoursLogged)} Â· ${fmt(num(s.distanceKm), 2)} km</div></div><button class="btn btn-sm btn-primary" data-act="view-path" data-sid="${esc(s.id)}" data-mname="${esc(m.assetName)}"><span class="material-symbols-rounded">route</span>View Path</button></div>`;
  });
  openDrawer(m.assetName, `GPS Route Log Â· ${dLong(selectedDate)}`, body);
}

async function showShiftPathMap(shiftId, machineName) {
  openModal({
    title: `Machine Path: ${esc(machineName)}`,
    sub: `Shift ID: ${shiftId}`,
    body: `<div id="shiftPathMap" style="height:380px;border-radius:12px;overflow:hidden;border:1px solid var(--border)"></div><div id="pathStats" class="muted sm" style="margin-top:12px">Loading GPS points...</div>`,
    footer: `<button class="btn btn-primary" data-act="close-modal">Close</button>`
  });

  setTimeout(async () => {
    const mapEl = $("#shiftPathMap");
    if (!mapEl) return;
    const map = L.map("shiftPathMap", { zoomControl: false }).setView([CONFIG.LAT, CONFIG.LNG], 16);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(map);

    try {
      let latlngs = [];
      let totalPtsCount = 0;
      let inZoneCount = 0;

      // 1. Try route_trails collection chunks
      const trailSnap = await getDocs(collection(db, "route_trails"));
      const chunks = trailSnap.docs.map(d => d.data()).filter(c => c.shiftId === shiftId).sort((a, b) => (a.seq || 0) - (b.seq || 0));

      if (chunks.length > 0) {
        chunks.forEach(chunk => {
          const flat = chunk.pts || [];
          for (let i = 0; i < flat.length; i += 3) {
            const lat = num(flat[i]), lng = num(flat[i+1]);
            if (lat !== 0 && lng !== 0 && !isNaN(lat) && !isNaN(lng)) {
              latlngs.push([lat, lng]);
            }
          }
        });
        totalPtsCount = latlngs.length;
      }

      // 2. Fallback to shifts/{shiftId}/points subcollection
      if (latlngs.length < 2) {
        const snap = await getDocs(collection(db, "shifts", shiftId, "points"));
        const pts = snap.docs.map(d => d.data()).sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
        totalPtsCount = pts.length;
        inZoneCount = pts.filter(p => p.inZone).length;
        latlngs = pts.map(p => [num(p.lat), num(p.lng)]).filter(p => !isNaN(p[0]) && !isNaN(p[1]) && p[0] !== 0);
      }

      if (latlngs.length < 2) {
        $("#pathStats").textContent = `Recorded ${totalPtsCount} point(s), insufficient path movement to draw route.`;
        return;
      }

      // Calculate path distance & speed insights
      let distKm = 0;
      for (let i = 1; i < latlngs.length; i++) {
        const p1 = L.latLng(latlngs[i-1][0], latlngs[i-1][1]);
        const p2 = L.latLng(latlngs[i][0], latlngs[i][1]);
        distKm += p1.distanceTo(p2) / 1000;
      }

      const line = L.polyline(latlngs, { color: "#E5C794", weight: 4, opacity: 0.9 }).addTo(map);

      L.circleMarker(latlngs[0], { radius: 8, color: "#5FD39A", fillColor: "#5FD39A", fillOpacity: 1 }).addTo(map).bindTooltip("Shift Start");
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 8, color: "#ff6b6b", fillColor: "#ff6b6b", fillOpacity: 1 }).addTo(map).bindTooltip("Shift End");

      map.fitBounds(line.getBounds().pad(0.1));
      $("#pathStats").textContent = `Trail Distance: ${fmt(distKm, 2)} km Â· Points Logged: ${totalPtsCount} ${inZoneCount ? "Â· In-Zone: " + inZoneCount : ""}`;
    } catch (e) {
      console.error(e);
      $("#pathStats").textContent = "Failed to load route points.";
    }
  }, 100);
}
function drawerFuel(id) {
  const m = mx().get(id); if (!m) return;
  const rows = S.fuel.filter(f => f.machineId === m.id || f.machineId === m.assetName).sort(sortFuel);
  const tot = sum(rows, 'litres'), rateCost = fuelCostSummary(rows), t = today(), days = daysBetween(addDays(t, -29), t), by = {}; rows.forEach(f => by[f._d] = (by[f._d] || 0) + num(f.litres));
  const l30 = days.reduce((a, d) => a + (by[d] || 0), 0), activeDays = new Set(rows.map(f => f._d)).size;
  let body = `<div class="stat-row" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))"><div class="stat"><div class="k">All-time</div><div class="v">${fmt(tot)} <small>L</small></div></div><div class="stat"><div class="k">Last 30 days</div><div class="v">${fmt(l30)} <small>L</small></div></div><div class="stat"><div class="k">Avg / fuel day</div><div class="v">${fmt(activeDays ? tot / activeDays : 0)} <small>L</small></div></div><div class="stat"><div class="k">Modeled all-time cost</div><div class="v">${money(rateCost.cost)}</div><div class="t">${fmt(rateCost.coverage,0)}% volume priced</div></div></div>
    <div class="muted sm" style="margin-bottom:4px">Daily litres · last 30 days</div>${sparkline(days.map(d => by[d] || 0))}`;
  if (!rows.length) body += '<div class="empty">No fuel logs yet.</div>';
  let last = ''; rows.forEach(f => { if (f._d !== last) { last = f._d; body += `<div class="day-h">${dLong(f._d)} · ${fmt(by[f._d])} L</div>`; } body += `<div class="list-row"><div><b>${fmt(num(f.litres))} L</b><div class="muted sm">${esc(f.notes || 'App fuel log')}${timeOf(tsMs(f.timestamp)) ? ' · ' + timeOf(tsMs(f.timestamp)) : ''}</div></div></div>`; });
  openDrawer(m.assetName, `Fuel issue log · ${m.fuelType || 'fuel type not set'}`, body);
}

/* ================= FUEL MODAL (KPI drill-down) ================= */
function openFuelModal() {
  setCurModalRenderer(renderFuelModal);
  openModal({ title: 'Fuel consumption', sub: 'Issued litres from the storekeeper ledger', body: '', footer: '<button class="btn" data-act="export-fuel"><span class="material-symbols-rounded">download</span>Export CSV</button><button class="btn btn-primary" data-act="close-modal">Close</button>' });
  renderFuelModal();
}
function renderFuelModal() {
  const st = R.fuel, t = today(), ent = fuelIn(st.from, st.to), tot = sum(ent, 'litres'), sp = splitFuel(ent), days = daysBetween(st.from, st.to);
  const quick = [['Today', t, t], ['Yesterday', addDays(t, -1), addDays(t, -1)], ['This month', monthStart(t), t], ['Last month', monthStart(addDays(monthStart(t), -1)), addDays(monthStart(t), -1)]].map(([l, a, b]) => { const e = fuelIn(a, b), s = splitFuel(e), c = fuelCostSummary(e); return `<div class="stat ${l === 'This month' ? 'hl' : ''}"><div class="k">${l}</div><div class="v">${fmt(sum(e, 'litres'))} <small>L</small></div><div class="t">${money(c.cost)} modeled · Diesel ${fmt(s.Diesel)} L · Petrol ${fmt(s.Petrol)} L</div></div>`; }).join('');
  const byDay = {}; ent.forEach(f => byDay[f._d] = (byDay[f._d] || 0) + num(f.litres));
  const dayShow = days.length > 120 ? days.slice(-120) : days;
  const mm = {}; ent.forEach(f => { const k = mKey(f.machineId); (mm[k] = mm[k] || { name: mName(f.machineId), type: fuelTypeFromRecord(f), L: 0, n: 0, H: 0, cost: 0, unpricedL: 0 }); mm[k].L += num(f.litres); mm[k].n++; const r=rateForFuelLog(f); if(r>0) mm[k].cost+=fuelLogCost(f); else mm[k].unpricedL+=num(f.litres); });
  shiftsIn(st.from, st.to).forEach(s => { const k = mKey(s.machineId); if (mm[k]) mm[k].H += num(s.engineHoursLogged); });
  const rows = Object.values(mm).sort((a, b) => b.L - a.L);
  const html = `<div class="stat-row">${quick}</div>${rangeBar('fuel')}
    <div class="stat-row"><div class="stat hl"><div class="k">Selected total</div><div class="v">${fmt(tot)} <small>L</small></div><div class="t">${esc(rangeLabel(st))}</div></div><div class="stat"><div class="k">Modeled fuel spend</div><div class="v">${money(fuelCostSummary(ent).cost)}</div><div class="t">${fmt(fuelCostSummary(ent).coverage,0)}% volume priced</div></div>
      <div class="stat"><div class="k">Diesel</div><div class="v">${fmt(sp.Diesel)} <small>L</small></div></div><div class="stat"><div class="k">Petrol</div><div class="v">${fmt(sp.Petrol)} <small>L</small></div></div>
      ${sp.Unspecified ? `<div class="stat"><div class="k">Type not set</div><div class="v">${fmt(sp.Unspecified)} <small>L</small></div></div>` : ''}
      <div class="stat"><div class="k">Avg per day</div><div class="v">${fmt(tot / Math.max(1, days.length))} <small>L</small></div><div class="t">${days.length} day${days.length === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="k">Entries</div><div class="v">${ent.length}</div></div></div>
    <div class="section-t">Daily consumption${days.length > 120 ? ' <span class="muted sm">(last 120 days shown)</span>' : ''}</div>${barChart(dayShow.map(d => ({ label: dShort(d), value: byDay[d] || 0 })), { unit: 'L' })}
    <div class="section-t">By machine</div><div class="table-wrap"><table><thead><tr><th>Machine</th><th>Fuel</th><th class="num">Entries</th><th class="num">Litres</th><th class="num">Modeled cost</th><th class="num">Run hrs</th><th class="num">L / hr</th></tr></thead><tbody>
    ${rows.length ? rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td><span class="badge ${r.type === 'Petrol' ? 'warn' : 'mute'}">${esc(r.type)}</span></td><td class="num">${r.n}</td><td class="num"><b>${fmt(r.L)}</b></td><td class="num"><b>${money(r.cost)}</b>${r.unpricedL>0?`<div class="muted sm">${fmt(r.unpricedL)} L unpriced</div>`:''}</td><td class="num">${r.H ? fmt(r.H) : '—'}</td><td class="num">${r.H ? fmt(r.L / r.H, 2) : '—'}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No fuel issued in this range.</td></tr>'}
    </tbody>${rows.length ? `<tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(tot)}</td><td class="num">${money(fuelCostSummary(ent).cost)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div>`;
  const body = $('#mBody'), sc = body.scrollTop; if (body._h !== html) { body.innerHTML = html; body._h = html; body.scrollTop = sc; }
}

/* ================= RUNNING HOURS MODAL (KPI drill-down) ================= */
function openRunModal() {
  setCurModalRenderer(renderRunModal);
  openModal({ title: 'Running hours', sub: 'Machine-wise engine run time from completed shifts', body: '', footer: '<button class="btn" data-act="export-run"><span class="material-symbols-rounded">download</span>Export CSV</button><button class="btn btn-primary" data-act="close-modal">Close</button>' });
  renderRunModal();
}
function runData() {
  const st = R.run, sh = shiftsIn(st.from, st.to), fu = fuelIn(st.from, st.to), lk = liveKeys(), g = {};
  const ensure = (id) => { const k = mKey(id), m = mx().get(id); return g[k] = g[k] || { name: mName(id), cat: m?.category || '—', ops: new Set(), n: 0, H: 0, km: 0, L: 0, live: m ? (lk.has(m.assetName) || lk.has(m.id)) : lk.has(id) }; };
  S.machines.forEach(m => ensure(m.id));
  sh.forEach(s => { const r = ensure(s.machineId); r.n++; r.H += num(s.engineHoursLogged); r.km += num(s.distanceKm); if (s.operatorName) r.ops.add(s.operatorName); });
  fu.forEach(f => { const k = mKey(f.machineId); if (g[k]) g[k].L += num(f.litres); });
  const rows = Object.values(g).sort((a, b) => b.H - a.H || a.name.localeCompare(b.name));
  return { st, sh, rows };
}
function renderRunModal() {
  const { st, sh, rows } = runData(), days = daysBetween(st.from, st.to), tot = sum(sh, 'engineHoursLogged'), km = sum(sh, 'distanceKm');
  const active = rows.filter(r => r.H > 0), maxH = Math.max(0.0001, ...rows.map(r => r.H)), top = active[0];
  const L = rows.reduce((a, r) => a + r.L, 0);
  const byDay = {}; sh.forEach(s => byDay[s._d] = (byDay[s._d] || 0) + num(s.engineHoursLogged));
  const html = `${rangeBar('run')}
    <div class="stat-row"><div class="stat hl"><div class="k">Total running time</div><div class="v">${fmt(tot)} <small>hrs</small></div><div class="t">${fmtHrs(tot)} · ${esc(rangeLabel(st))}</div></div>
      <div class="stat"><div class="k">Machines ran</div><div class="v">${active.length} <small>/ ${S.machines.length}</small></div></div>
      <div class="stat"><div class="k">Shifts</div><div class="v">${sh.length}</div></div>
      <div class="stat"><div class="k">Distance</div><div class="v">${fmt(km)} <small>km</small></div></div>
      <div class="stat"><div class="k">Fleet fuel rate</div><div class="v">${tot > 0 && L > 0 ? fmt(L / tot, 2) : '—'} <small>L/hr</small></div></div>
      <div class="stat"><div class="k">Longest runner</div><div class="v" style="font-size:16px">${top ? esc(top.name) : '—'}</div><div class="t">${top ? fmtHrs(top.H) : ''}</div></div></div>
    ${days.length > 1 ? `<div class="section-t">Fleet running hours per day</div>${barChart(days.slice(-120).map(d => ({ label: dShort(d), value: byDay[d] || 0 })), { unit: 'hrs' })}` : ''}
    <div class="section-t">Machine-wise running time</div>
    ${active.length ? active.map(r => `<div class="hrow"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</div><div class="bar"><i class="lvl-brand" style="width:${r.H / maxH * 100}%"></i></div><div class="right"><b>${fmtHrs(r.H)}</b></div></div>`).join('') : '<div class="empty">No machine ran in this range.</div>'}
    <div class="section-t">Detail</div><div class="table-wrap"><table><thead><tr><th>Machine</th><th>Category</th><th>Operator(s)</th><th class="num">Shifts</th><th class="num">Run time</th><th class="num">Distance</th><th class="num">Avg km/h</th><th class="num">Fuel (L)</th><th class="num">L / hr</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => { const ops = [...r.ops]; return `<tr style="${r.H ? '' : 'opacity:.55'}"><td><b>${esc(r.name)}</b></td><td>${esc(r.cat)}</td><td>${ops.length ? esc(ops.slice(0, 2).join(', ')) + (ops.length > 2 ? ` +${ops.length - 2}` : '') : '—'}</td><td class="num">${r.n || '—'}</td><td class="num"><b>${r.H ? fmtHrs(r.H) : '—'}</b></td><td class="num">${r.km ? fmt(r.km, 1) + ' km' : '—'}</td><td class="num">${r.H && r.km ? fmt(r.km / r.H, 1) : '—'}</td><td class="num">${r.L ? fmt(r.L) : '—'}</td><td class="num">${r.H && r.L ? fmt(r.L / r.H, 2) : '—'}</td><td>${r.live ? '<span class="badge gold live">Live now</span>' : r.H ? '<span class="badge ok">Ran</span>' : '<span class="badge mute">Idle</span>'}</td></tr>`; }).join('')}
    </tbody>${rows.length ? `<tfoot><tr><td colspan="3">Total</td><td class="num">${sh.length}</td><td class="num">${fmtHrs(tot)}</td><td class="num">${fmt(km, 1)} km</td><td></td><td class="num">${L ? fmt(L) : '—'}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div>`;
  const body = $('#mBody'), sc = body.scrollTop; if (body._h !== html) { body.innerHTML = html; body._h = html; body.scrollTop = sc; }
}

/* ================= LOCAL EXPENSES / STORE LEDGER ================= */

  return { renderFleet, machineCard, machineForm, drawerRoute, showShiftPathMap, drawerFuel, openFuelModal, renderFuelModal, openRunModal, runData, renderRunModal };
}
