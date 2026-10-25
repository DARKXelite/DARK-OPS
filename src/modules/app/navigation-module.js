/** Navigation, view rendering and scoped Firestore realtime subscriptions. */
export function createNavigationModule(deps) {
  const { $, CONFIG, RBAC, S, collection, db, doc, drawZones, fnbModule, getCurrentView, initRadarMap, initZoneMap, liveNow, normDate, onSnapshot, permissionForCollection, permissionForView, qsa, renderFleet, renderIncidents, renderLedger, renderLocalExpenseLedger, renderOverview, renderRadarPanel, renderRecords, renderRegistry, renderShifts, renderTurfCare, renderUsersMaster, renderZonePanel, resizeMap, setConn, setCurrentView, toast } = deps;
const VIEWS = {
  overview: ["Insights", "AI-assisted operating intelligence", "query_stats", "Insights"],
  fleet: ["Fleet Directory", "Machines & cycles", "precision_manufacturing", "Fleet Ops"],
  shifts: ["Shift Logs", "Run-time & utilisation", "history", "Fleet Ops"],
  turfcare: ["Turf Ops", "Agronomy & application control", "eco", "Turf Ops"],
  zones: ["Course Map", "Geofences & course boundaries", "polyline", "Fleet Ops"],
  fuel: ["Fuel Ledger", "Fuel issues & cost control", "local_gas_station", "Store & Ledgers"],
  registry: ["Inventory Master", "Item master, receipts & stock", "database", "Store & Ledgers"],
  expenses: ["Local Expenses", "Out-of-pocket purchases & office reimbursement", "payments", "Store & Ledgers"],
  users: ["Users Master", "Workforce directory", "group", "Store & Ledgers"],
  records: ["Maintenance & Records", "Service, assignments & history", "folder_managed", "Fleet Ops"],
  radar: ["Course Map", "Live fleet tracking & geofences", "my_location", "Fleet Ops"],
  fnb: ["F&B Operations", "Ordering, receivables & consumption analysis", "restaurant", "F&B"]
};
const RENDER = { overview: renderOverview, fleet: renderFleet, fuel: () => renderLedger(), shifts: () => renderShifts(), records: () => renderRecords(), radar: renderRadarPanel, zones: renderZonePanel, registry: renderRegistry, expenses: renderLocalExpenseLedger, users: renderUsersMaster, incidents: renderIncidents, turfcare: renderTurfCare, fnb: () => fnbModule.render() };
const NAV_GROUPS = {
  fleetops: { label: 'Fleet Ops', icon: 'precision_manufacturing', view: 'fleet', pages: [['fleet','Fleet'],['shifts','Run logs'],['records','Maintenance & records'],['radar','Course map']] },
  turfops: { label: 'Turf Ops', icon: 'eco', view: 'turfcare', pages: [] },
  masters: { label: 'Store & Ledgers', icon: 'inventory_2', view: 'fuel', pages: [['fuel','Fuel ledger'],['registry','Inventory'],['expenses','Local Expenses'],['users','Users']] },
  fnb: { label: 'F&B', icon: 'restaurant', view: 'fnb', pages: [] }
};
let activeNavGroup = 'insights';
function groupForView(v) { if (v === 'overview') return 'insights'; return Object.keys(NAV_GROUPS).find(k => NAV_GROUPS[k].view === v || NAV_GROUPS[k].pages.some(p => p[0] === v) || (k === 'fleetops' && v === 'zones')) || 'insights'; }
function renderGroupTabs() { const cur = getCurrentView();
  const el = $('#groupTabs'); if (!el) return;
  activeNavGroup = groupForView(getCurrentView());
  const g = NAV_GROUPS[activeNavGroup];
  if (!g || !g.pages.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const pages = g.pages.map(([v,label]) => `<button class="group-tab ${cur === v || ((v === 'radar' || v === 'zones') && (cur === 'radar' || cur === 'zones')) ? 'active' : ''}" data-act="group-tab" data-v="${v}">${label}</button>`).join('');
  const mapToggle = (cur === 'radar' || cur === 'zones') ? `<div class="group-tab-divider"></div><button class="group-tab map-mode-tab ${cur === 'radar' ? 'active' : ''}" data-act="map-mode" data-mode="radar">Live radar</button><button class="group-tab map-mode-tab ${cur === 'zones' ? 'active' : ''}" data-act="map-mode" data-mode="zones">Geofences</button>` : '';
  el.innerHTML = `<div class="group-tabs-inner">${pages}${mapToggle}</div>`;
}
function buildNav() {
  const entries = Object.entries(NAV_GROUPS).filter(([, g]) => RBAC.can(permissionForView(g.view)));
  document.getElementById('nav').innerHTML = entries.map(([key,g]) => `<button class="nav-btn ${key === activeNavGroup ? 'active' : ''}" data-act="nav-group" data-group="${key}" title="${g.label}" aria-label="${g.label}"><span class="material-symbols-rounded">${g.icon}</span><span class="nl">${g.label}</span></button>`).join('');
}
function openNavGroup(key) {
  const g = NAV_GROUPS[key] || NAV_GROUPS.insights;
  activeNavGroup = key;
  switchView(g.view);
  qsa('#nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.group === key));
  if (window.innerWidth < 900) toggleDock(false);
}
function toggleDock(force) { const dock = $('#dockPill'); if (!dock) return; const open = typeof force === 'boolean' ? force : !dock.classList.contains('active'); dock.classList.add('active'); }
const badgeCounts = { incidents: 0, radar: 0 };
function updateBadges(changedCollection = null) {
  if (changedCollection === 'logs') badgeCounts.incidents = S.logs.filter(l => (l.repairStatus || 'Pending') !== 'Resolved').length;
  if (changedCollection === 'live') badgeCounts.radar = liveNow().length;
  [['incidents', badgeCounts.incidents], ['radar', badgeCounts.radar]].forEach(([k, n]) => { const el = $(`[data-nb="${k}"]`); if (el) { el.hidden = !n; el.textContent = n; } });
}
function switchView(v) {
  if (!VIEWS[v]) v = 'overview';
  if (RBAC.session.authenticated && !RBAC.can(permissionForView(v))) { toast("Your role does not have access to this section.", "err"); v = "overview"; }
  setCurrentView(v);
  if (listenersStarted) syncListenersForView();
  document.body.classList.toggle('turf-board-mode', v === 'turfcare'); history.replaceState(null, '', '#' + v);
  qsa('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
  $('#pageTitle').textContent = VIEWS[v][0]; $('#pageSub').textContent = VIEWS[v][1]; $('#viewHead').style.display = (v === 'overview' || v === 'turfcare') ? 'none' : ''; window.scrollTo(0, 0);
  const mapMode = (v === 'radar' || v === 'zones');
  document.body.classList.toggle('map-mode', mapMode);
  activeNavGroup = groupForView(v);
  qsa('#nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.group === activeNavGroup));
  renderGroupTabs();
  if (v === 'radar') { initRadarMap(); setTimeout(() => resizeMap('radar'), 80); }
  if (v === 'zones') { initZoneMap(); setTimeout(() => resizeMap('zones'), 80); }
  renderAll();
}
let raf = 0; const scheduleRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderAll(); }); };
function renderAll() { try { (RENDER[getCurrentView()] || (() => {}))(); updateBadges(); if (curModalRender) curModalRender(); } catch (e) { console.error(e); } }

/* ================= FIRESTORE LISTENERS ================= */
let unsubs = new Map();
let listenersStarted = false;
const listenerEpochs = new Map();
const VIEW_COLLECTIONS = {
  overview: ['fuel','machines','shifts','inventory','plans','maintenance','logs'],
  fleet: ['machines','live','fuel','shifts'],
  fuel: ['fuel','machines','expenses','inventory'],
  shifts: ['shifts','machines'],
  records: ['maintenance','assignments','fuel','machines','inventory','users'],
  radar: ['live','zones','machines'],
  zones: ['zones'],
  registry: ['inventory','inwards','expenses'],
  expenses: ['expenses','inventory'],
  users: ['users'],
  incidents: ['logs','machines'],
  turfcare: ['inventory','plans'],
  fnb: ['fnbOrders','fnbReceipts','inventory']
};
function collectionAffectsCurrentView(k) {
  return (VIEW_COLLECTIONS[getCurrentView()] || []).includes(k);
}
function stopOneListener(k) {
  listenerEpochs.set(k, (listenerEpochs.get(k) || 0) + 1);
  const unsubscribe = unsubs.get(k);
  if (unsubscribe) {
    try { unsubscribe(); } catch (_) {}
    unsubs.delete(k);
  }
}
function syncListenersForView() {
  if (!listenersStarted) return;
  setConn('');
  const desired = new Set(VIEW_COLLECTIONS[getCurrentView()] || []);
  Object.keys(CONFIG.COL).forEach(k => {
    const permitted = RBAC.can(permissionForCollection(CONFIG.COL[k], false));
    const shouldListen = desired.has(k) && permitted;
    if (!shouldListen) {
      if (unsubs.has(k)) stopOneListener(k);
      // Clear data not active on this screen, so a role/view transition never keeps
      // displaying a stale collection snapshot. Unauthorised collections never subscribe.
      S[k] = [];
      LOADED[k] = !permitted;
      if (k === 'zones') drawZones();
      if (k === 'logs' || k === 'live') updateBadges(k);
      return;
    }
    if (unsubs.has(k)) return;

    const epoch = (listenerEpochs.get(k) || 0) + 1;
    listenerEpochs.set(k, epoch);
    const cache = new Map();
    LOADED[k] = false;
    S[k] = [];
    const unsubscribe = onSnapshot(collection(db, CONFIG.COL[k]), snap => {
      if (listenerEpochs.get(k) !== epoch) return;
      const firstSnapshot = !LOADED[k];
      const changes = snap.docChanges();
      changes.forEach(change => {
        if (change.type === 'removed') cache.delete(change.doc.id);
        else {
          const row = { id: change.doc.id, ...change.doc.data() };
          if (k === 'fuel') row._d = normDate(row.issueDate ?? row.issuedDate ?? row.date ?? row.transactionDate ?? row.createdDate, row.issuedAt ?? row.issueTimestamp ?? row.timestamp ?? row.createdAt ?? row.createdOn ?? row.updatedAt ?? row.recordedAt);
          if (k === 'plans') row._d = normDate(row.date ?? row.issuedDate ?? row.applicationDate ?? row.appliedDate ?? row.issueDate ?? row.transactionDate ?? row.logDate ?? row.plannedDate, row.issuedAt ?? row.issueTimestamp ?? row.timestamp ?? row.appliedAt ?? row.completedAt ?? row.createdAt ?? row.createdOn ?? row.updatedAt ?? row.recordedAt ?? row.createdTime);
          if (k === 'shifts') row._d = normDate(row.shiftDate, row.timestamp ?? row.startTime ?? row.endTime);
          cache.set(change.doc.id, row);
        }
      });
      if (firstSnapshot || changes.length) S[k] = [...cache.values()];
      LOADED[k] = true;
      S._v++;
      setConn('ok');
      if (k === 'zones') drawZones();
      updateBadges(k);
      if (firstSnapshot || changes.length) {
        if (collectionAffectsCurrentView(k)) scheduleRender();
      }
    }, err => {
      if (listenerEpochs.get(k) !== epoch) return;
      console.error(k, err);
      LOADED[k] = true;
      setConn('err');
      toast(`Cannot read “${CONFIG.COL[k]}”: ${err.code || err.message}`, 'err');
      if (collectionAffectsCurrentView(k)) scheduleRender();
    });
    unsubs.set(k, unsubscribe);
  });
}
function startListeners() {
  stopListeners();
  setConn('');
  Object.keys(CONFIG.COL).forEach(k => { LOADED[k] = false; S[k] = []; });
  S._v++;
  listenersStarted = true;
  syncListenersForView();
  // Clear the previous session's rendered data immediately, before the new snapshots arrive.
  renderAll();
}
function stopListeners() {
  listenersStarted = false;
  [...unsubs.keys()].forEach(stopOneListener);
}
// Only the radar needs a timed refresh for stale/live age labels. The Insights dashboard is event-driven.
setInterval(() => { if (getCurrentView() === 'radar') { updateBadges('live'); scheduleRender(); } }, 10000);

/* ================= EVENTS ================= */

  return { VIEWS, groupForView, renderGroupTabs, buildNav, openNavGroup, toggleDock, updateBadges, switchView, scheduleRender, renderAll, collectionAffectsCurrentView, stopOneListener, syncListenersForView, startListeners, stopListeners };
}
