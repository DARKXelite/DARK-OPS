const VIEWS = {
  overview: ["Insights", "AI-assisted operating intelligence", "query_stats", "Insights"],
  fleet: ["Fleet Directory", "Machines & cycles", "precision_manufacturing", "Fleet Ops"],
  shifts: ["Shift Logs", "Run-time & utilisation", "history", "Fleet Ops"],
  turfcare: ["Turf Ops", "Agronomy & application control", "eco", "Turf Ops"],
  zones: ["Course Map", "Geofences & course boundaries", "polyline", "Fleet Ops"],
  fuel: ["Fuel Ledger", "Fuel issues & cost control", "local_gas_station", "Store & Masters"],
  registry: ["Inventory Master", "Item master, receipts & stock", "database", "Store & Masters"],
  users: ["Users Master", "Workforce directory", "group", "Store & Masters"],
  expenses: ["Local Expenses", "Out-of-pocket purchases & office reimbursement", "payments", "Store & Masters"],
  incidents: ["Incident Tickets", "Open issues & repair status", "report", "Fleet Ops"],
  records: ["Maintenance & Records", "Service, assignments & history", "folder_managed", "Fleet Ops"],
  radar: ["Course Map", "Live fleet tracking & geofences", "my_location", "Fleet Ops"]
};
const NAV_GROUPS = {
  fleetops: { label: "Fleet Ops", icon: "precision_manufacturing", view: "fleet", pages: [["fleet","Fleet"],["shifts","Run logs"],["records","Maintenance & records"],["incidents","Incidents"],["radar","Course map"]] },
  turfops: { label: "Turf Ops", icon: "eco", view: "turfcare", pages: [] },
  masters: { label: "Store & Masters", icon: "inventory_2", view: "fuel", pages: [["fuel","Fuel ledger"],["registry","Inventory"],["expenses","Local expenses"],["users","Users"]] }
};
export function createNavigation({
  $, $$, state, liveNow, getCurrentView, setCurrentView, getModalRenderer,
  renderers, initRadarMap, initZoneMap, getRadarMap, getZoneMap, fitToCourse
}) {
  let activeNavGroup = "insights";
  let raf = 0;
  const badgeCounts = { incidents: 0, radar: 0 };
  function groupForView(v) {
    if (v === "overview") return "insights";
    return Object.keys(NAV_GROUPS).find(k => NAV_GROUPS[k].view === v || NAV_GROUPS[k].pages.some(p => p[0] === v) || (k === "fleetops" && v === "zones")) || "insights";
  }
  function renderGroupTabs() {
    const el = $("#groupTabs"); if (!el) return;
    activeNavGroup = groupForView(getCurrentView());
    const g = NAV_GROUPS[activeNavGroup];
    if (!g || !g.pages.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const current = getCurrentView();
    const pages = g.pages.map(([v,label]) => '<button class="group-tab ' + (current === v || ((v === "radar" || v === "zones") && (current === "radar" || current === "zones")) ? "active" : "") + '" data-act="group-tab" data-v="' + v + '">' + label + '</button>').join("");
    const mapToggle = (current === "radar" || current === "zones")
      ? '<div class="group-tab-divider"></div><button class="group-tab map-mode-tab ' + (current === "radar" ? "active" : "") + '" data-act="map-mode" data-mode="radar">Live radar</button><button class="group-tab map-mode-tab ' + (current === "zones" ? "active" : "") + '" data-act="map-mode" data-mode="zones">Geofences</button>'
      : "";
    el.innerHTML = '<div class="group-tabs-inner">' + pages + mapToggle + '</div>';
  }
  function buildNav() {
    document.getElementById("nav").innerHTML = Object.entries(NAV_GROUPS).map(([key,g]) =>
      '<button class="nav-btn ' + (key === activeNavGroup ? "active" : "") + '" data-act="nav-group" data-group="' + key + '" title="' + g.label + '" aria-label="' + g.label + '"><span class="material-symbols-rounded">' + g.icon + '</span><span class="nl">' + g.label + '</span></button>'
    ).join("");
  }
  function openNavGroup(key) {
    const g = NAV_GROUPS[key] || NAV_GROUPS.insights;
    activeNavGroup = key;
    switchView(g.view);
    $$("#nav .nav-btn").forEach(b => b.classList.toggle("active", b.dataset.group === key));
    if (window.innerWidth < 900) toggleDock(false);
  }
  function toggleDock(force) {
    const open = typeof force === "boolean" ? force : !$("#dockPill").classList.contains("active");
    $("#dockPill").classList.toggle("active", open);
    $("#golfballFab").classList.toggle("hidden", open);
  }
  function updateBadges(changedCollection = null) {
    if (changedCollection === "logs") badgeCounts.incidents = state.logs.filter(l => (l.repairStatus || "Pending") !== "Resolved").length;
    if (changedCollection === "live") badgeCounts.radar = liveNow().length;
    [["incidents", badgeCounts.incidents], ["radar", badgeCounts.radar]].forEach(([k,n]) => {
      const el = $('[data-nb="' + k + '"]');
      if (el) { el.hidden = !n; el.textContent = n; }
    });
  }
  function switchView(v) {
    if (!VIEWS[v]) v = "overview";
    setCurrentView(v);
    document.body.classList.toggle("turf-board-mode", v === "turfcare");
    history.replaceState(null, "", "#" + v);
    $$(".view").forEach(x => x.classList.toggle("active", x.id === "v-" + v));
    $("#pageTitle").textContent = VIEWS[v][0];
    $("#pageSub").textContent = VIEWS[v][1];
    $("#viewHead").style.display = (v === "overview" || v === "turfcare") ? "none" : "";
    window.scrollTo(0, 0);
    const mapMode = v === "radar" || v === "zones";
    document.body.classList.toggle("map-mode", mapMode);
    activeNavGroup = groupForView(v);
    $$("#nav .nav-btn").forEach(b => b.classList.toggle("active", b.dataset.group === activeNavGroup));
    renderGroupTabs();
    if (v === "radar") {
      initRadarMap();
      setTimeout(() => { const map = getRadarMap(); if (map) { map.invalidateSize(); fitToCourse(map); } }, 80);
    }
    if (v === "zones") {
      initZoneMap();
      setTimeout(() => { const map = getZoneMap(); if (map) { map.invalidateSize(); fitToCourse(map); } }, 80);
    }
    renderAll();
  }
  function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderAll(); }); }
  function renderAll() {
    try {
      (renderers[getCurrentView()] || (() => {}))();
      updateBadges();
      const modalRenderer = getModalRenderer();
      if (modalRenderer) modalRenderer();
    } catch (e) { console.error(e); }
  }
  return { VIEWS, groupForView, renderGroupTabs, buildNav, openNavGroup, toggleDock, updateBadges, switchView, scheduleRender, renderAll };
}
