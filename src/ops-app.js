import { collection, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc, increment, onSnapshot, getDocs, writeBatch, runTransaction, serverTimestamp, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { createFnbModule } from "./modules/fnb/fnb-module.js";
import { ROLE_PERMISSIONS, ROLE_LABELS, canRole, permissionForAction, permissionForView, permissionForCollection } from "./modules/rbac.js";
import { $, $$ as qsa, esc, num, fmt, money, pad, ymd, today, addDays, monthStart, MON, dShort, dLong, fmtHrs, sum, tsMs, timeOf, ago, normDate, daysBetween, setHTML } from "./modules/core/formatters.js";
import { createUIPrimitivesModule } from "./modules/ui/ui-primitives.js";
import { createChartModule } from "./modules/ui/charts.js";
import { createWeatherModule } from "./modules/weather/weather-module.js";
import { createReorderIntelligenceModule } from "./modules/inventory/reorder-intelligence.js";
import { createCostAnalyticsModule } from "./modules/cost/cost-analytics.js";
import { COST_DEFAULTS, loadCostModel as loadStoredCostModel, persistCostModel } from "./modules/cost/cost-model-storage.js";
import { createFleetModule } from "./modules/fleet/fleet-module.js";
import { createTurfDomainModule } from "./modules/turf/turf-domain.js";
import { createOverviewModule } from "./modules/views/overview-module.js";
import { createOverviewHelpers } from "./modules/views/overview-helpers.js";
import { createCourseMapModule } from "./modules/maps/course-map-module.js";
import { createStoreUiModule } from "./modules/store/store-ui-module.js";
import { createExpenseModule } from "./modules/expenses/expense-module.js";
import { createTurfOperationsModule } from "./modules/turf/turf-operations-module.js";
import { createActionHandlersModule } from "./modules/actions/action-handlers.js";
import { createFleetDomainModule } from "./modules/domain/fleet-domain.js";
import { createLedgerViewsModule } from "./modules/views/ledger-views.js";
import { createRangeControlsModule } from "./modules/ui/range-controls.js";
import { createCommandPaletteModule } from "./modules/app/command-palette.js";
import { createAuthControllerModule } from "./modules/app/auth-controller.js";
import { registerAppEventDelegation } from "./modules/app/event-delegation.js";
import { createNavigationController } from "./modules/app/navigation-controller.js";
import { createFirestoreListenerController } from "./modules/app/firestore-listener-controller.js";
import { app, auth, db, firebaseConfig, appCheckSiteKey } from "./modules/firebase/client.js";


let uiModule = null, chartModule = null, weatherModule = null, reorderModule = null, costModule = null, fleetModule = null, turfDomainModule = null, overviewModule = null, mapModule = null, storeUiModule = null, expenseModule = null, turfModule = null, fleetDomainModule = null;
let listenerController = null;
function setCurModalRenderer(fn) { curModalRender = fn; }

const FUEL_RATE = 92.50; // Legacy reference rate; operational costing is managed in the local cost model.
/* ================= CONFIG ================= */
const CONFIG = {
  REQUIRE_LOGIN: true,         // Phone OTP authentication and app_roles/{uid} authorization required
  SERVICE_INTERVAL: 250,       // engine hours between services
  SERVICE_WARN: 25,            // amber when this many hours (or fewer) remain
  LAT: 12.756, LNG: 77.822,
  // For commercial production, set this to an HTTPS server-side proxy using a licensed Open-Meteo API plan.
  // Leave blank only for evaluation/development against Open-Meteo's public endpoint (non-commercial terms).
  WEATHER_PROXY_URL: '',
  STALE_SEC: 180,              // radar pin turns grey after this many seconds without an update
  WIND_LIMIT: 25,              // km/h, spraying advisory
  COL: { users:'users', machines:'machines', fuel:'fuel_logs', shifts:'shifts', zones:'CourseZones', live:'live_telemetry', inventory:'inventory', logs:'logs', maintenance:'maintenance_logs', assignments:'assignment_logs', plans:'turf_plans', inwards:'store_inwards', expenses:'local_expenses', fnbOrders:'fnb_orders', fnbReceipts:'fnb_receipts' }
};

/* ================= HELPERS ================= */
/* ================= STATE ================= */
const S = { users: [], machines: [], fuel: [], shifts: [], zones: [], live: [], inventory: [], logs: [], maintenance: [], assignments: [], plans: [], inwards: [], expenses: [], fnbOrders: [], fnbReceipts: [], _v: 0 };

const LOADED = {};
const F = { q: '', cat: 'All', fuel: 'All', sort: 'service' };
const R = {
  fuel:   { preset: 'today', from: today(), to: today() },
  run:    { preset: 'today', from: today(), to: today() },
  ledger: { preset: 'today', from: today(), to: today(), machine: '', type: '' },
  shifts: { preset: 'last7', from: addDays(today(), -6), to: today(), machine: '', op: '' }
};
let cur = 'overview', curModalRender = null;
function getCurrentView() { return cur; }

function loadCostModel() {
  try { return loadStoredCostModel(localStorage); }
  catch (_) { return { ...COST_DEFAULTS }; }
}
const COST = loadCostModel();
function saveCostModel() {
  try { persistCostModel(COST, localStorage); } catch (_) {}
}
function rateForFuelLog(...args) { return fleetDomainModule.rateForFuelLog(...args); }
function fuelLogCost(...args) { return fleetDomainModule.fuelLogCost(...args); }
function fuelCostSummary(...args) { return fleetDomainModule.fuelCostSummary(...args); }
function inventoryCostSummary(...args) { return fleetDomainModule.inventoryCostSummary(...args); }
function monthPlansCost(...args) { return fleetDomainModule.monthPlansCost(...args); }
function monthlyCostSnapshot(...args) { return fleetDomainModule.monthlyCostSnapshot(...args); }
function mx(...args) { return fleetDomainModule.mx(...args); }
function mKey(...args) { return fleetDomainModule.mKey(...args); }
function mName(...args) { return fleetDomainModule.mName(...args); }
function fuelTypeOf(...args) { return fleetDomainModule.fuelTypeOf(...args); }
function canonicalFuelType(...args) { return fleetDomainModule.canonicalFuelType(...args); }
function fuelTypeFromRecord(...args) { return fleetDomainModule.fuelTypeFromRecord(...args); }
function fuelRecordDate(...args) { return fleetDomainModule.fuelRecordDate(...args); }
function fuelIn(...args) { return fleetDomainModule.fuelIn(...args); }
function shiftsIn(...args) { return fleetDomainModule.shiftsIn(...args); }
function litresFor(...args) { return fleetDomainModule.litresFor(...args); }
function hoursFor(...args) { return fleetDomainModule.hoursFor(...args); }
function splitFuel(...args) { return fleetDomainModule.splitFuel(...args); }
function svc(...args) { return fleetDomainModule.svc(...args); }
function eff(...args) { return fleetDomainModule.eff(...args); }
function liveList(...args) { return fleetDomainModule.liveList(...args); }
const liveNow = (...args) => fleetDomainModule.liveNow(...args);
function liveKeys(...args) { return fleetDomainModule.liveKeys(...args); }

function toast(...args) { return uiModule.toast(...args); }
function setConn(...args) { return uiModule.setConn(...args); }
function openModal(...args) { return uiModule.openModal(...args); }
function closeModal(...args) { return uiModule.closeModal(...args); }
function openForm(...args) { return uiModule.openForm(...args); }
function confirmDelete(...args) { return uiModule.confirmDelete(...args); }
function openDrawer(...args) { return uiModule.openDrawer(...args); }
function closeDrawer(...args) { return uiModule.closeDrawer(...args); }
function downloadCSV(...args) { return uiModule.downloadCSV(...args); }
const fld = (label, inner, hint = '') => `<div class="field"><label class="f">${label}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const machineOptions = (sel = '', blank = 'All machines') => `<option value="">${blank}</option>` + [...S.machines].sort((a, b) => (a.assetName || '').localeCompare(b.assetName || '')).map(m => `<option value="${esc(m.id)}" ${sel === m.id ? 'selected' : ''}>${esc(m.assetName)}</option>`).join('');

/* ---- charts ---- */
function barChart(...args) { return chartModule.barChart(...args); }
function sparkline(...args) { return chartModule.sparkline(...args); }
function renderWeather(...args) { return weatherModule.renderWeather(...args); }
function loadWeather(...args) { return weatherModule.loadWeather(...args); }
function enableRainNotifications(...args) { return weatherModule.enableRainNotifications(...args); }
/* ================= RANGE CONTROLS ================= */
const rangeControls = createRangeControlsModule({
  R, today, addDays, monthStart, dLong, renderFuelModal, renderRunModal, renderLedger, renderShifts
});
const PRESETS = rangeControls.PRESETS;
const setPreset = (...args) => rangeControls.setPreset(...args);
const rangeBar = (...args) => rangeControls.rangeBar(...args);
const rangeLabel = (...args) => rangeControls.rangeLabel(...args);
const RER = rangeControls.RER;

/* ================= OVERVIEW ================= */
const overviewHelpers = createOverviewHelpers({ fmt });
const tile = (...args) => overviewHelpers.tile(...args);
const deltaTxt = (...args) => overviewHelpers.deltaTxt(...args);
const normItemName = (...args) => reorderModule.normItemName(...args);
function resolveInventoryItem(...args) { return reorderModule.resolveInventoryItem(...args); }
function buildReorderUsageIndex(...args) { return reorderModule.buildReorderUsageIndex(...args); }
function autoReorderDetails(...args) { return reorderModule.autoReorderDetails(...args); }
function effectiveReorderLevel(...args) { return reorderModule.effectiveReorderLevel(...args); }
function renderOperationalIntelligence(...args) { return overviewModule.renderOperationalIntelligence(...args); }
function renderTurfUsageIntelligence(...args) { return overviewModule.renderTurfUsageIntelligence(...args); }
function renderOverview(...args) { return overviewModule.renderOverview(...args); }

const sortFuel = (...args) => costModule.sortFuel(...args);
function fuelTypeForCost(...args) { return costModule.fuelTypeForCost(...args); }
function fuelMasterRate(...args) { return costModule.fuelMasterRate(...args); }
function fuelCostLine(...args) { return costModule.fuelCostLine(...args); }
function turfCostLine(...args) { return costModule.turfCostLine(...args); }
function dayFuelCostLines(...args) { return costModule.dayFuelCostLines(...args); }
function dayMaintenanceCostLines(...args) { return costModule.dayMaintenanceCostLines(...args); }
function dayFleetCostLines(...args) { return costModule.dayFleetCostLines(...args); }
function dayTurfCostLines(...args) { return costModule.dayTurfCostLines(...args); }
function summariseCostLines(...args) { return costModule.summariseCostLines(...args); }
function turfDayProductValueRows(...args) { return costModule.turfDayProductValueRows(...args); }
function updateDayCostCards(...args) { return costModule.updateDayCostCards(...args); }
function openDayCostLedger(...args) { return costModule.openDayCostLedger(...args); }
function exportDayCostLedger(...args) { return costModule.exportDayCostLedger(...args); }
function buildTurfCostAnalytics(...args) { return costModule.buildTurfCostAnalytics(...args); }
function renderTurfCostAnalytics(...args) { return costModule.renderTurfCostAnalytics(...args); }
function openTurfCostAnalytics(...args) { return costModule.openTurfCostAnalytics(...args); }
function applyTurfCostPreset(...args) { return costModule.applyTurfCostPreset(...args); }
function exportTurfCostRange(...args) { return costModule.exportTurfCostRange(...args); }
function openCostModel(...args) { return costModule.openCostModel(...args); }
function exportROIReport(...args) { return costModule.exportROIReport(...args); }
function editInventoryCost(...args) { return costModule.editInventoryCost(...args); }
function renderFleet(...args) { return fleetModule.renderFleet(...args); }
function machineCard(...args) { return fleetModule.machineCard(...args); }
function machineForm(...args) { return fleetModule.machineForm(...args); }
function drawerRoute(...args) { return fleetModule.drawerRoute(...args); }
function showShiftPathMap(...args) { return fleetModule.showShiftPathMap(...args); }
function drawerFuel(...args) { return fleetModule.drawerFuel(...args); }
function openFuelModal(...args) { return fleetModule.openFuelModal(...args); }
function renderFuelModal(...args) { return fleetModule.renderFuelModal(...args); }
function openRunModal(...args) { return fleetModule.openRunModal(...args); }
function runData(...args) { return fleetModule.runData(...args); }
function renderRunModal(...args) { return fleetModule.renderRunModal(...args); }
function normName(...args) { return expenseModule.normName(...args); }
function expAmount(...args) { return expenseModule.expAmount(...args); }
function expIsMine(...args) { return expenseModule.expIsMine(...args); }
function expIsReclaimed(...args) { return expenseModule.expIsReclaimed(...args); }
function findInventoryByName(...args) { return expenseModule.findInventoryByName(...args); }
function guessCategory(...args) { return expenseModule.guessCategory(...args); }
function lookupCategoryOnline(...args) { return expenseModule.lookupCategoryOnline(...args); }
function expItems(...args) { return expenseModule.expItems(...args); }
function renderLocalExpenseLedger(...args) { return expenseModule.renderLocalExpenseLedger(...args); }
function openNewItemPopup(...args) { return expenseModule.openNewItemPopup(...args); }
function exRowHTML(...args) { return expenseModule.exRowHTML(...args); }
function exUpdateTotal(...args) { return expenseModule.exUpdateTotal(...args); }
function runNewItemQueue(...args) { return expenseModule.runNewItemQueue(...args); }

const ledgerViewsModule = createLedgerViewsModule({
  R, S, LOADED, $, setHTML, rangeBar, machineOptions,
  fuelIn, mKey, fuelTypeFromRecord, sortFuel, sum, splitFuel, fuelCostSummary,
  fmt, money, fmtHrs, timeOf, tsMs, esc, rateForFuelLog, fuelLogCost,
  mName, num, shiftsIn, dLong
});
const ledgerRows = (...args) => ledgerViewsModule.ledgerRows(...args);
const renderLedger = (...args) => ledgerViewsModule.renderLedger(...args);
const shiftRows = (...args) => ledgerViewsModule.shiftRows(...args);
const renderShifts = (...args) => ledgerViewsModule.renderShifts(...args);

/* ================= MAPS ================= */
const ZCOL = { Course: '#E5C794', Green: '#1F9D55', Fairway: '#7DBB2E', Rough: '#C28A2F', Tee: '#5B8DEF', Other: '#9AA39D' };
const TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';
function courseZone(...args) { return mapModule.courseZone(...args); }
function fitToCourse(...args) { return mapModule.fitToCourse(...args); }
function addLocateControl(...args) { return mapModule.addLocateControl(...args); }
function initZoneMap(...args) { return mapModule.initZoneMap(...args); }
function initRadarMap(...args) { return mapModule.initRadarMap(...args); }
function drawZones(...args) { return mapModule.drawZones(...args); }
function updateRadar(...args) { return mapModule.updateRadar(...args); }
function renderRadarPanel(...args) { return mapModule.renderRadarPanel(...args); }
function renderZonePanel(...args) { return mapModule.renderZonePanel(...args); }
function zoneForm(...args) { return mapModule.zoneForm(...args); }

const STORE_CATS = ['Fuel','Fertilizers','Pesticides','Turf Enhancements','Spare Parts','Tools','F&B','Other'];

function normMobile(...args) { return storeUiModule.normMobile(...args); }
function itemName(...args) { return storeUiModule.itemName(...args); }
function renderUsersMaster(...args) { return storeUiModule.renderUsersMaster(...args); }
function inventoryRowsMarkup(...args) { return storeUiModule.inventoryRowsMarkup(...args); }
function renderRegistry(...args) { return storeUiModule.renderRegistry(...args); }
function openStoreRecordsEditor(...args) { return storeUiModule.openStoreRecordsEditor(...args); }
function openDataReset(...args) { return storeUiModule.openDataReset(...args); }
function renderStoreRecordsEditor(...args) { return storeUiModule.renderStoreRecordsEditor(...args); }
function deleteStoreItemFromEditor(...args) { return storeUiModule.deleteStoreItemFromEditor(...args); }
function deleteStoreInwardFromEditor(...args) { return storeUiModule.deleteStoreInwardFromEditor(...args); }
function openInward(...args) { return storeUiModule.openInward(...args); }
function updateInwardItems(...args) { return storeUiModule.updateInwardItems(...args); }
function previewInward(...args) { return storeUiModule.previewInward(...args); }
function renderIncidents(...args) { return storeUiModule.renderIncidents(...args); }
function renderRecords(...args) { return storeUiModule.renderRecords(...args); }
const fnbModule = createFnbModule({
  db, CONFIG, collection, addDoc, doc, updateDoc, runTransaction, serverTimestamp,
  num, esc, money, today, S, $, setHTML, toast
});

/* ================= NAV / RENDER LOOP ================= */
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
const navigationController = createNavigationController({
  NAV_GROUPS, VIEWS, RENDER, RBAC, permissionForView, S, liveNow,
  $, qsa, toast, initRadarMap, initZoneMap,
  resizeMap: view => mapModule.resizeMap(view),
  getCurrentView: () => cur,
  setCurrentView: view => { cur = view; },
  getCurrentModalRenderer: () => curModalRender,
  isListenerControllerStarted: () => Boolean(listenerController?.isStarted()),
  syncListenersForView
});
const badgeCounts = navigationController.badgeCounts;
function groupForView(...args) { return navigationController.groupForView(...args); }
function renderGroupTabs(...args) { return navigationController.renderGroupTabs(...args); }
function buildNav(...args) { return navigationController.buildNav(...args); }
function openNavGroup(...args) { return navigationController.openNavGroup(...args); }
function toggleDock(...args) { return navigationController.toggleDock(...args); }
function updateBadges(...args) { return navigationController.updateBadges(...args); }
function switchView(...args) { return navigationController.switchView(...args); }
function scheduleRender(...args) { return navigationController.scheduleRender(...args); }
function renderAll(...args) { return navigationController.renderAll(...args); }

/* ================= FIRESTORE LISTENERS ================= */
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

listenerController = createFirestoreListenerController({
  VIEW_COLLECTIONS,
  getCurrentView: () => cur,
  CONFIG, RBAC, permissionForCollection, setConn, S, LOADED,
  drawZones, updateBadges, onSnapshot, collection, db, normDate,
  scheduleRender, renderAll, toast
});
function collectionAffectsCurrentView(...args) { return listenerController.collectionAffectsCurrentView(...args); }
function stopOneListener(...args) { return listenerController.stopOneListener(...args); }
function syncListenersForView(...args) { return listenerController.syncListenersForView(...args); }
function startListeners(...args) { return listenerController.startListeners(...args); }
function stopListeners(...args) { return listenerController.stopListeners(...args); }

/* ================= EVENTS ================= */
let H = {}, C = {};
registerAppEventDelegation({
  $, qsa,
  getStoreUiModule: () => storeUiModule,
  getTurfModule: () => turfModule,
  getActionHandlers: () => H,
  getChangeHandlers: () => C,
  renderUsersMaster, permissionForAction, RBAC, toast, updateDoc, doc, db, CONFIG,
  serverTimestamp, exRowHTML, exUpdateTotal, findInventoryByName,
  esc, itemName, fmt, num, previewInward, F, renderFleet,
  calcTot, renderTurfApplications, closeModal, closeDrawer
});


let tpState = { start: '', weeks: 1, days: [[],[],[],[],[],[],[]], activeDay: -1 };


/* ================= AUTH + RBAC BOOT ================= */
$('#dateChip').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
toggleDock(false);

const RBAC = {
  roles: ROLE_PERMISSIONS,
  session: { role: null, authenticated: false, uid: null, displayName: "" },
  can(permission) { return this.session.authenticated && canRole(this.session.role, permission); }
};
let authController = null;
function openRoleAdmin(...args) {
  if (!authController) throw new Error("Authentication controller has not been initialized");
  return authController.openRoleAdmin(...args);
}
authController = createAuthControllerModule({
  auth, db, $, RBAC, ROLE_LABELS, ROLE_PERMISSIONS, CONFIG, LOADED, S,
  getDoc, doc, setDoc, serverTimestamp, stopListeners, buildNav,
  renderAll, switchView, startListeners, toast, openForm, fld
});
authController.initialize();


function getSunday(...args) { return turfDomainModule.getSunday(...args); }
function isTurfCategory(...args) { return turfDomainModule.isTurfCategory(...args); }
function turfCategoryLabel(...args) { return turfDomainModule.turfCategoryLabel(...args); }
function turfRecordDate(...args) { return turfDomainModule.turfRecordDate(...args); }
function turfRecordProductName(...args) { return turfDomainModule.turfRecordProductName(...args); }
function turfRecordQuantity(...args) { return turfDomainModule.turfRecordQuantity(...args); }
function turfRecordStatus(...args) { return turfDomainModule.turfRecordStatus(...args); }
function turfProductForPlan(...args) { return turfDomainModule.turfProductForPlan(...args); }
function turfPlanCategory(...args) { return turfDomainModule.turfPlanCategory(...args); }
function turfCategoryClass(...args) { return turfDomainModule.turfCategoryClass(...args); }
function setTurfSection(...args) { return turfModule.setTurfSection(...args); }
function renderTurfCategoryCards(...args) { return turfModule.renderTurfCategoryCards(...args); }
function renderTurfApplications(...args) { return turfModule.renderTurfApplications(...args); }
function renderTurfCare(...args) { return turfModule.renderTurfCare(...args); }
function turfProductUnit(...args) { return turfDomainModule.turfProductUnit(...args); }
function openAddSprayTaskForm(...args) { return turfModule.openAddSprayTaskForm(...args); }
function saveTurfBatch(...args) { return turfModule.saveTurfBatch(...args); }
function renderTurfAreaPlanDashboard(...args) { return turfModule.renderTurfAreaPlanDashboard(...args); }
function openTurfVarianceModal(...args) { return turfModule.openTurfVarianceModal(...args); }
function renderTurfVariance(...args) { return turfModule.renderTurfVariance(...args); }
function exportTurfVariance(...args) { return turfModule.exportTurfVariance(...args); }
function openTurfPlanner(...args) { return turfModule.openTurfPlanner(...args); }
function renderTp(...args) { return turfModule.renderTp(...args); }
function calcTot(...args) { return turfModule.calcTot(...args); }

const commandPaletteModule = createCommandPaletteModule({ $, VIEWS, S, esc, switchView, F, renderFleet });
function toggleCmdPal(...args) { return commandPaletteModule.toggleCmdPal(...args); }
function renderCmd(...args) { return commandPaletteModule.renderCmd(...args); }

// Injected service context shared by function-based feature modules.
const APP_CONTEXT = {
  $,
  ATTR,
  CONFIG,
  COST,
  COST_DEFAULTS,
  F,
  FUEL_RATE,
  LOADED,
  MON,
  NAV_GROUPS,
  PRESETS,
  R,
  RBAC,
  RENDER,
  RER,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  S,
  STORE_CATS,
  TILE,
  VIEWS,
  VIEW_COLLECTIONS,
  ZCOL,
  activeNavGroup: navigationController.getActiveNavGroup(),
  addDays,
  addDoc,
  addLocateControl,
  ago,
  app,
  appCheckSiteKey,
  applyTurfCostPreset,
  auth,
  autoReorderDetails,
  badgeCounts,
  barChart,
  buildNav,
  buildReorderUsageIndex,
  buildTurfCostAnalytics,
  calcTot,
  canRole,
  canonicalFuelType,
  chartModule,
  closeDrawer,
  closeModal,
  cmdOpen: commandPaletteModule.isOpen(),
  collection,
  collectionAffectsCurrentView,
  confirmDelete,
  costModule,
  courseZone,
  createChartModule,
  createCostAnalyticsModule,
  createFleetModule,
  createFnbModule,
  createReorderIntelligenceModule,
  createUIPrimitivesModule,
  createWeatherModule,
  cur,
  curModalRender,
  dLong,
  dShort,
  dayFleetCostLines,
  dayFuelCostLines,
  dayMaintenanceCostLines,
  dayTurfCostLines,
  daysBetween,
  db,
  deleteDoc,
  deleteStoreInwardFromEditor,
  deleteStoreItemFromEditor,
  deltaTxt,
  doc,
  downloadCSV,
  drawZones,
  drawerFuel,
  drawerRoute,
  editInventoryCost,
  eff,
  effectiveReorderLevel,
  enableRainNotifications,
  esc,
  exRowHTML,
  exUpdateTotal,
  expAmount,
  expIsMine,
  expIsReclaimed,
  expItems,
  exportDayCostLedger,
  exportROIReport,
  exportTurfCostRange,
  exportTurfVariance,
  findInventoryByName,
  firebaseConfig,
  fitToCourse,
  fld,
  fleetModule,
  fmt,
  fmtHrs,
  fnbModule,
  fuelCostLine,
  fuelCostSummary,
  fuelIn,
  fuelLogCost,
  fuelMasterRate,
  fuelRecordDate,
  fuelTypeForCost,
  fuelTypeFromRecord,
  fuelTypeOf,
  getCurrentView,
  getDoc,
  getDocs,
  getSunday,
  groupForView,
  guessCategory,
  hoursFor,
  increment,
  initRadarMap,
  initZoneMap,
  inventoryCostSummary,
  inventoryRowsMarkup,
  isTurfCategory,
  itemName,
  ledgerRows,
  listenerEpochs: listenerController.getListenerEpochs(),
  listenersStarted: listenerController.isStarted(),
  litresFor,
  liveKeys,
  liveList,
  liveNow,
  loadCostModel,
  loadWeather,
  lookupCategoryOnline,
  mKey,
  mName,
  machineCard,
  machineForm,
  machineOptions,
  money,
  monthPlansCost,
  monthStart,
  monthlyCostSnapshot,
  mx,
  normDate,
  normItemName,
  normMobile,
  normName,
  num,
  onSnapshot,
  openAddSprayTaskForm,
  openCostModel,
  openDataReset,
  openDayCostLedger,
  openDrawer,
  openForm,
  openFuelModal,
  openInward,
  openModal,
  openNavGroup,
  openNewItemPopup,
  openRoleAdmin,
  openRunModal,
  openStoreRecordsEditor,
  openTurfCostAnalytics,
  openTurfPlanner,
  openTurfVarianceModal,
  orderBy,
  pad,
  permissionForAction,
  permissionForCollection,
  permissionForView,
  previewInward,
  query,
  qsa,

  rangeBar,
  rangeLabel,
  rateForFuelLog,
  renderAll,
  renderCmd,
  renderFleet,
  renderFuelModal,
  renderGroupTabs,
  renderIncidents,
  renderLedger,
  renderLocalExpenseLedger,
  renderOperationalIntelligence,
  renderOverview,
  renderRadarPanel,
  renderRecords,
  renderRegistry,
  renderRunModal,
  renderShifts,
  renderStoreRecordsEditor,
  renderTp,
  renderTurfApplications,
  renderTurfAreaPlanDashboard,
  renderTurfCare,
  renderTurfCategoryCards,
  renderTurfCostAnalytics,
  renderTurfUsageIntelligence,
  renderTurfVariance,
  renderUsersMaster,
  renderWeather,
  renderZonePanel,
  reorderModule,
  resolveInventoryItem,
  runData,
  runNewItemQueue,
  runTransaction,
  saveCostModel,
  saveTurfBatch,
  serverTimestamp,
  setConn,
  setCurModalRenderer,
  setDoc,
  setHTML,
  setPreset,
  setTurfSection,
  shiftRows,
  shiftsIn,
  showShiftPathMap,
  sortFuel,
  sparkline,
  splitFuel,
  startListeners,
  stopListeners,
  stopOneListener,
  sum,
  summariseCostLines,
  svc,
  switchView,
  syncListenersForView,
  tile,
  timeOf,
  toast,
  today,
  toggleCmdPal,
  toggleDock,
  tpState,
  tsMs,
  turfCategoryClass,
  turfCategoryLabel,
  turfCostLine,
  turfDayProductValueRows,
  turfPlanCategory,
  turfProductForPlan,
  turfProductUnit,
  turfRecordDate,
  turfRecordProductName,
  turfRecordQuantity,
  turfRecordStatus,
  uiModule,
  unsubs: listenerController.getUnsubs(),
  updateBadges,
  updateDayCostCards,
  updateDoc,
  updateInwardItems,
  updateRadar,
  weatherModule,
  where,
  writeBatch,
  ymd,
  zoneForm,
};
uiModule = createUIPrimitivesModule(APP_CONTEXT);
chartModule = createChartModule(APP_CONTEXT);
turfDomainModule = createTurfDomainModule(APP_CONTEXT);
storeUiModule = createStoreUiModule(APP_CONTEXT);
expenseModule = createExpenseModule(APP_CONTEXT);
weatherModule = createWeatherModule(APP_CONTEXT);
reorderModule = createReorderIntelligenceModule(APP_CONTEXT);
costModule = createCostAnalyticsModule(APP_CONTEXT);
fleetDomainModule = createFleetDomainModule(APP_CONTEXT);
fleetModule = createFleetModule(APP_CONTEXT);
overviewModule = createOverviewModule(APP_CONTEXT);
mapModule = createCourseMapModule(APP_CONTEXT);
turfModule = createTurfOperationsModule(APP_CONTEXT);
const actionHandlers = createActionHandlersModule({ ...APP_CONTEXT, expenseModule, storeUiModule, turfModule, getCurrentView });
H = actionHandlers.H;
C = actionHandlers.C;

// Start weather only after every injected module is initialized.
renderWeather();
loadWeather();
setInterval(loadWeather, 30 * 60 * 1000);
