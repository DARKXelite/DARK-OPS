export function filterAndSortMachines({ machines, query = "", category = "All", fuel = "All", sort = "service", serviceFor = () => ({ remaining: 0 }), num = value => Number(value) || 0 }) {
  const q = String(query || "").toLowerCase();
  let list = machines.filter(m =>
    (!q || `${m.assetName} ${m.category}`.toLowerCase().includes(q)) &&
    (category === "All" || m.category === category) &&
    (fuel === "All" || m.fuelType === fuel)
  ).map(m => ({ m, s: serviceFor(m) }));
  if (sort === "service") list.sort((a,b) => a.s.remaining - b.s.remaining);
  else if (sort === "hours") list.sort((a,b) => num(b.m.currentHours) - num(a.m.currentHours));
  else list.sort((a,b) => (a.m.assetName || "").localeCompare(b.m.assetName || ""));
  return list;
}

export function createFleetModule({
  $, $$, esc, num, fmt, setHTML, state, loaded, filters, liveKeys, svc, eff,
  CONFIG, openForm, fld, toast, firestoreData
}) {
  function renderFleet() {
    const cats = ["All", ...new Set(state.machines.map(m => m.category).filter(Boolean))];
    setHTML($("#catChips"), cats.map(c => `<button class="chip ${filters.cat === c ? "on" : ""}" data-act="fcat" data-v="${esc(c)}">${esc(c)}</button>`).join(""));
    setHTML($("#fuelChips"), ["All", "Diesel", "Petrol"].map(c => `<button class="chip ${filters.fuel === c ? "on" : ""}" data-act="ffuel" data-v="${c}">${c === "All" ? "All fuels" : c}</button>`).join(""));
    $("#fleetSort").value = filters.sort;
    if (!loaded.machines) { setHTML($("#fleetGrid"), Array(6).fill('<div class="skeleton" style="height:300px"></div>').join("")); return; }
    const live = liveKeys();
    const list = filterAndSortMachines({
      machines:state.machines, query:filters.q, category:filters.cat, fuel:filters.fuel, sort:filters.sort, serviceFor:svc, num
    });
    setHTML($("#fleetGrid"), list.length ? list.map(({ m, s }) => machineCard(m, s, live.has(m.assetName) || live.has(m.id))).join("") : '<div class="empty" style="grid-column:1/-1">No machines match. Use “Add machine” to register one.</div>');
  }

  function machineCard(m, s, isLive) {
    const e = eff(m);
    let status = '<span class="badge ok">Operational</span>';
    if (isLive) status = '<span class="badge gold live">Live shift</span>';
    else if (m.status && m.status !== "Active") status = `<span class="badge warn">${esc(m.status)}</span>`;
    else if (s.level === "over") status = '<span class="badge bad">Service overdue</span>';
    else if (s.level === "due") status = '<span class="badge warn">Service due</span>';
    const tr = e.trend == null ? "" : `<span class="${e.trend > 3 ? "up" : e.trend < -3 ? "down" : ""}">${e.trend > 3 ? "?" : e.trend < -3 ? "?" : "?"} ${fmt(Math.abs(e.trend), 0)}% vs prev. week</span>`;
    const ft = m.fuelType ? `<span class="badge ${m.fuelType === "Petrol" ? "warn" : "mute"}">${esc(m.fuelType)}</span>` : "";
    return `<div class="mcard ${isLive ? "live" : ""}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><div class="cat">${esc(m.category || "Machine")}</div><h4>${esc(m.assetName)}</h4></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${ft}${status}</div></div>
    <div class="mstats">
      <div class="mstat"><div class="k">Engine hours</div><div class="v">${fmt(num(m.currentHours))} <small>hrs</small></div></div>
      <div class="mstat"><div class="k">Fuel use</div><div class="v">${e.r == null ? "—" : fmt(e.r, 2)} <small>L/hr</small></div><div class="t">${fmt(e.L)} L · ${fmt(e.H)} hrs (30 d)</div></div>
    </div>
    ${tr ? `<div class="sm muted" style="margin-top:-4px">${tr}</div>` : ""}
    <div><div class="svc-line"><span>Service cycle · ${fmt(s.since, 0)} / ${CONFIG.SERVICE_INTERVAL} hrs</span><span class="${s.level === "ok" ? "" : s.level === "due" ? "up" : ""}" style="${s.level === "over" ? "color:var(--bad)" : ""}">${s.remaining <= 0 ? "Overdue by " + fmt(-s.remaining, 0) + " hrs" : "Due in " + fmt(s.remaining, 0) + " hrs"}</span></div><div class="bar"><i class="lvl-${s.level}" style="width:${s.pct}%"></i></div></div>
    <div class="mactions"><button class="btn btn-sm" data-act="drawer-route" data-id="${esc(m.id)}"><span class="material-symbols-rounded">route</span>Routes</button><button class="btn btn-sm" data-act="drawer-fuel" data-id="${esc(m.id)}"><span class="material-symbols-rounded">local_gas_station</span>Fuel log</button>
      <div class="kebab-wrap"><button class="btn btn-sm" style="flex:none;width:34px;padding:0" data-act="kebab" aria-label="More actions"><span class="material-symbols-rounded">more_horiz</span></button>
      <div class="kmenu"><button data-act="edit-machine" data-id="${esc(m.id)}"><span class="material-symbols-rounded">edit</span>Edit details</button><button data-act="svc-done" data-id="${esc(m.id)}"><span class="material-symbols-rounded">build_circle</span>Mark serviced</button><button class="danger" data-act="del" data-col="machines" data-id="${esc(m.id)}" data-label="${esc(m.assetName)}"><span class="material-symbols-rounded">delete</span>Delete</button></div></div>
    </div></div>`;
  }

  function machineForm(m) {
    const edit = !!m, cats = ["Greens Mower", "Fairway Mower", "Rough Mower", "Utility Vehicle", "Tractor", "Sprayer", "Buggy"];
    openForm({
      title: edit ? "Edit machine" : "Register machine",
      html: fld("Asset name", `<input id="fName" value="${esc(m?.assetName || "")}" placeholder="e.g. Toro Greensmaster 3150">`) +
        fld("Category", `<input id="fCat" list="catList" value="${esc(m?.category || "")}" placeholder="e.g. Fairway Mower"><datalist id="catList">${cats.map(c => `<option value="${c}">`).join("")}</datalist>`) +
        fld("Fuel type", `<select id="fFuel"><option value="Diesel" ${m?.fuelType !== "Petrol" ? "selected" : ""}>Diesel</option><option value="Petrol" ${m?.fuelType === "Petrol" ? "selected" : ""}>Petrol</option></select>`) +
        `<div class="row2">${fld("Current engine hours", `<input id="fHrs" type="number" min="0" step="0.1" value="${edit ? num(m.currentHours) : 0}">`)}${fld("Last serviced at (hrs)", `<input id="fLast" type="number" min="0" step="0.1" value="${edit && m.lastServiceHours != null ? m.lastServiceHours : ""}" placeholder="optional">`)}</div><div class="hint" style="margin-top:-6px">Leave “last serviced” blank to start the ${CONFIG.SERVICE_INTERVAL}-hr cycle from the current hours.</div>`,
      submit: edit ? "Save changes" : "Register",
      onSubmit: async () => {
        const name = $("#fName").value.trim();
        if (!name) { toast("Asset name is required", "err"); return false; }
        if (state.machines.some(x => x.assetName?.toLowerCase() === name.toLowerCase() && x.id !== m?.id)) { toast("A machine with this name already exists", "err"); return false; }
        const hrs = num($("#fHrs").value), lastRaw = $("#fLast").value.trim();
        const data = { assetName:name, category:$("#fCat").value.trim() || "Utility Vehicle", fuelType:$("#fFuel").value, currentHours:hrs,
          lastServiceHours:lastRaw === "" ? (edit && m.lastServiceHours != null ? m.lastServiceHours : hrs) : num(lastRaw) };
        if (edit) { await firestoreData.update("machines", m.id, data); toast("Machine updated"); }
        else { await firestoreData.add("machines", { ...data, status:"Active" }); toast("Machine registered"); }
      }
    });
  }

  return { renderFleet, machineForm, machineCard };
}
