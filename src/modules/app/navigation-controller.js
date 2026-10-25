/**
 * Application navigation, route switching, dock state, view rendering, and badges.
 * The controller owns navigation-only state; Firebase/data state remains in the app shell.
 */
export function createNavigationController(context) {
  const {
    NAV_GROUPS, VIEWS, RENDER, RBAC, permissionForView, S, liveNow,
    $, qsa, toast, initRadarMap, initZoneMap, resizeMap,
    getCurrentView, setCurrentView, getCurrentModalRenderer,
    isListenerControllerStarted, syncListenersForView
  } = context;
  let activeNavGroup = "insights";

  function groupForView(v) { if (v === 'overview') return 'insights'; return Object.keys(NAV_GROUPS).find(k => NAV_GROUPS[k].view === v || NAV_GROUPS[k].pages.some(p => p[0] === v) || (k === 'fleetops' && v === 'zones')) || 'insights'; }
  function renderGroupTabs() {
    const el = $('#groupTabs'); if (!el) return;
    activeNavGroup = groupForView(getCurrentView());
    const g = NAV_GROUPS[activeNavGroup];
    if (!g || !g.pages.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const pages = g.pages.map(([v,label]) => `<button class="group-tab ${getCurrentView() === v || ((v === 'radar' || v === 'zones') && (getCurrentView() === 'radar' || getCurrentView() === 'zones')) ? 'active' : ''}" data-act="group-tab" data-v="${v}">${label}</button>`).join('');
    const mapToggle = (getCurrentView() === 'radar' || getCurrentView() === 'zones') ? `<div class="group-tab-divider"></div><button class="group-tab map-mode-tab ${getCurrentView() === 'radar' ? 'active' : ''}" data-act="map-mode" data-mode="radar">Live radar</button><button class="group-tab map-mode-tab ${getCurrentView() === 'zones' ? 'active' : ''}" data-act="map-mode" data-mode="zones">Geofences</button>` : '';
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
    if (isListenerControllerStarted()) syncListenersForView();
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
  function renderAll() { try { (RENDER[getCurrentView()] || (() => {}))(); updateBadges(); const modalRenderer = getCurrentModalRenderer(); if (modalRenderer) modalRenderer(); } catch (e) { console.error(e); } }

  return {
    groupForView, renderGroupTabs, buildNav, openNavGroup, toggleDock,
    updateBadges, switchView, renderAll, scheduleRender,
    badgeCounts, getActiveNavGroup: () => activeNavGroup
  };
}
