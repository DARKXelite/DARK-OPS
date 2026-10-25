import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc, increment, onSnapshot, getDocs, writeBatch, runTransaction, serverTimestamp, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithPhoneNumber, RecaptchaVerifier, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { createFnbModule } from "./modules/fnb/fnb-module.js";
import { ROLE_PERMISSIONS, ROLE_LABELS, canRole, permissionForAction, permissionForView, permissionForCollection } from "./modules/rbac.js";
import { $, $$ as qsa, esc, num, fmt, money, pad, ymd, today, addDays, monthStart, MON, dShort, dLong, fmtHrs, sum, tsMs, timeOf, ago, normDate, daysBetween, setHTML } from "./modules/core/formatters.js";
import { createUIPrimitivesModule } from "./modules/ui/ui-primitives.js";
import { createChartModule } from "./modules/ui/charts.js";
import { createWeatherModule } from "./modules/weather/weather-module.js";
import { createReorderIntelligenceModule } from "./modules/inventory/reorder-intelligence.js";
import { createCostAnalyticsModule } from "./modules/cost/cost-analytics.js";
import { createFleetModule } from "./modules/fleet/fleet-module.js";
import { createTurfDomainModule } from "./modules/turf/turf-domain.js";
import { createOverviewModule } from "./modules/views/overview-module.js";
import { createCourseMapModule } from "./modules/maps/course-map-module.js";
import { createStoreUiModule } from "./modules/store/store-ui-module.js";
import { createExpenseModule } from "./modules/expenses/expense-module.js";
import { createTurfOperationsModule } from "./modules/turf/turf-operations-module.js";
import { createActionHandlersModule } from "./modules/actions/action-handlers.js";


let uiModule = null, chartModule = null, weatherModule = null, reorderModule = null, costModule = null, fleetModule = null, turfDomainModule = null, overviewModule = null, mapModule = null, storeUiModule = null, expenseModule = null, turfModule = null;
function setCurModalRenderer(fn) { curModalRender = fn; }

const FUEL_RATE = 92.50; // Legacy reference rate; operational costing is managed in the local cost model.
/* ================= CONFIG ================= */
const firebaseConfig = {
  apiKey: "AIzaSyA0snhaIuA47xB0Ay-5nAgzBstDO5koi-M",
  authDomain: "clover-greens-ops.firebaseapp.com",
  databaseURL: "https://clover-greens-ops-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "clover-greens-ops",
  storageBucket: "clover-greens-ops.firebasestorage.app",
  messagingSenderId: "48049661517",
  appId: "1:48049661517:web:8075879055223c9cd61e04",
  measurementId: "G-N96JJT9QRL"
};
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

const app = initializeApp(firebaseConfig);
// App Check activates only when a public reCAPTCHA Enterprise site key is configured in Vercel.
// Do not enable Firebase App Check enforcement until this has been verified on production traffic.
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || "";
if (appCheckSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.error("Firebase App Check initialization failed; refusing to continue with a broken security configuration.", error);
    throw error;
  }
}
const db = getFirestore(app);
const auth = getAuth(app);

/* ================= HELPERS ================= */
/* ================= STATE ================= */
const S = { users: [], machines: [], fuel: [], shifts: [], zones: [], live: [], inventory: [], logs: [], maintenance: [], assignments: [], plans: [], inwards: [], expenses: [], fnbOrders: [], fnbReceipts: [], _v: 0 };
const COST_DEFAULTS = { dieselRate: 92.50, petrolRate: 0, labourPerHour: 0, downtimePerHour: 0, savingsPct: 10, improvementCost: 0 };
function loadCostModel() {
  try { const saved = JSON.parse(localStorage.getItem('cloverOpsCostModel') || '{}'); return { ...COST_DEFAULTS, ...Object.fromEntries(Object.keys(COST_DEFAULTS).map(k => [k, Number.isFinite(+saved[k]) && +saved[k] >= 0 ? +saved[k] : COST_DEFAULTS[k]])) }; }
  catch (_) { return { ...COST_DEFAULTS }; }
}
const COST = loadCostModel();
function saveCostModel() { try { localStorage.setItem('cloverOpsCostModel', JSON.stringify(COST)); } catch (_) {} }
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

const LOADED = {};
let cur = 'overview', curModalRender = null;
const getCurrentView = () => cur;
const F = { q: '', cat: 'All', fuel: 'All', sort: 'service' };
const R = {
  fuel:   { preset: 'today', from: today(), to: today() },
  run:    { preset: 'today', from: today(), to: today() },
  ledger: { preset: 'today', from: today(), to: today(), machine: '', type: '' },
  shifts: { preset: 'last7', from: addDays(today(), -6), to: today(), machine: '', op: '' }
};
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
const PRESETS = [['today','Today'],['yesterday','Yesterday'],['last7','Last 7 days'],['month','This month'],['lastmonth','Last month'],['custom','Custom']];
function setPreset(st, p) {
  const t = today(); st.preset = p;
  if (p === 'today') { st.from = st.to = t; } else if (p === 'yesterday') { st.from = st.to = addDays(t, -1); }
  else if (p === 'last7') { st.from = addDays(t, -6); st.to = t; } else if (p === 'month') { st.from = monthStart(t); st.to = t; }
  else if (p === 'lastmonth') { const e = addDays(monthStart(t), -1); st.from = monthStart(e); st.to = e; }
}
const rangeBar = k => { const st = R[k]; return `<div class="rangebar"><div class="chips">${PRESETS.map(([p, l]) => `<button class="chip ${st.preset === p ? 'on' : ''}" data-act="rpreset" data-k="${k}" data-p="${p}">${l}</button>`).join('')}</div><div class="dates"><label>From<input type="date" value="${st.from}" max="${today()}" data-chg="rfrom" data-k="${k}"></label><label>To<input type="date" value="${st.to}" max="${today()}" data-chg="rto" data-k="${k}"></label></div></div>`; };
const rangeLabel = st => st.from === st.to ? dLong(st.from) : `${dLong(st.from)} – ${dLong(st.to)}`;
const RER = { fuel: () => renderFuelModal(), run: () => renderRunModal(), ledger: () => renderLedger(true), shifts: () => renderShifts(true) };

/* ================= OVERVIEW ================= */
function tile(act, icon, tone, label, value, unit, sub) {
  return `<button class="kpi" data-act="${act}"><div class="top"><span class="lbl">${label}</span><span class="ic ${tone}"><span class="material-symbols-rounded">${icon}</span></span></div><div class="val">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="sub">${sub || ''}</div><span class="material-symbols-rounded go">arrow_forward</span></button>`;
}
function deltaTxt(a, b, goodWhenDown = false) {
  if (!(b > 0)) return ''; const p = (a - b) / b * 100; if (Math.abs(p) < 1) return ' · same as yesterday';
  return ` · <span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '?' : '?'} ${fmt(Math.abs(p), 0)}%</span> vs yesterday`;
}
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
let activeNavGroup = 'insights';
function groupForView(v) { if (v === 'overview') return 'insights'; return Object.keys(NAV_GROUPS).find(k => NAV_GROUPS[k].view === v || NAV_GROUPS[k].pages.some(p => p[0] === v) || (k === 'fleetops' && v === 'zones')) || 'insights'; }
function renderGroupTabs() {
  const el = $('#groupTabs'); if (!el) return;
  activeNavGroup = groupForView(cur);
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
  cur = v;
  if (listenersStarted) syncListenersForView();
  document.body.classList.toggle('turf-board-mode', v === 'turfcare'); history.replaceState(null, '', '#' + v);
  qsa('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
  $('#pageTitle').textContent = VIEWS[v][0]; $('#pageSub').textContent = VIEWS[v][1]; $('#viewHead').style.display = (v === 'overview' || v === 'turfcare') ? 'none' : ''; window.scrollTo(0, 0);
  const mapMode = (v === 'radar' || v === 'zones');
  document.body.classList.toggle('map-mode', mapMode);
  activeNavGroup = groupForView(v);
  qsa('#nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.group === activeNavGroup));
  renderGroupTabs();
  if (v === 'radar') { initRadarMap(); setTimeout(() => mapModule.resizeMap('radar'), 80); }
  if (v === 'zones') { initZoneMap(); setTimeout(() => mapModule.resizeMap('zones'), 80); }
  renderAll();
}
let raf = 0; const scheduleRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderAll(); }); };
function renderAll() { try { (RENDER[cur] || (() => {}))(); updateBadges(); if (curModalRender) curModalRender(); } catch (e) { console.error(e); } }

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
  return (VIEW_COLLECTIONS[cur] || []).includes(k);
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
  const desired = new Set(VIEW_COLLECTIONS[cur] || []);
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
setInterval(() => { if (cur === 'radar') { updateBadges('live'); scheduleRender(); } }, 10000);

/* ================= EVENTS ================= */
let H = {}, C = {};
document.addEventListener('input', e => { if (e.target?.id === 'usersSearch') { const pos=e.target.selectionStart; storeUiModule.setUsersSearchText(e.target.value||''); renderUsersMaster(); const next=$('#usersSearch'); if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch(_){}} } });
document.addEventListener('change', e => { if (e.target?.id === 'usersRoleFilter') { storeUiModule.setUsersRoleFilter(e.target.value||'all'); renderUsersMaster(); } });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { qsa('.kmenu.open').forEach(x => x.classList.remove('open')); return; }
  if (el.dataset.act !== 'kebab') qsa('.kmenu.open').forEach(x => x.classList.remove('open'));
  const permission = permissionForAction(el.dataset.act, el.dataset);
  if (permission && !RBAC.can(permission)) { toast("Your role does not have permission for this action.", "err"); return; }
  const fn = H[el.dataset.act]; if (fn) fn(el.dataset, el, e);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && C[el.dataset.chg]) C[el.dataset.chg](el.value, el.dataset, el); });
document.addEventListener('change', async e => { const el=e.target.closest('[data-expense-paid]'); if(!el)return; try{await updateDoc(doc(db,CONFIG.COL.expenses,el.dataset.expensePaid),el.checked?{paidBy:'accounts',spentByMe:true,reclaimedAt:serverTimestamp()}:{paidBy:'me',spentByMe:true,reclaimedAt:null});toast(el.checked?'Reclaimed — marked as paid by accounts':'Marked as pending from office');}catch(err){el.checked=!el.checked;toast(err.message||'Could not update expense','err');} });
document.addEventListener('click', e => {
  if (e.target.closest('#exAddRow')) { const h=$('#exRows'); h.insertAdjacentHTML('beforeend',exRowHTML()); h.lastElementChild.querySelector('.exi-name').focus(); }
  const d=e.target.closest('.exi-del'); if(d){ const rows=qsa('#exRows .exp-row'); if(rows.length>1){d.closest('.exp-row').remove();} else {rows[0].querySelectorAll('input:not([readonly])').forEach(i=>i.value=i.classList.contains('exi-qty')?'1':'');rows[0].querySelector('.exi-match').innerHTML='';} exUpdateTotal(); }
});
document.addEventListener('input', e => {
  const t = e.target; if (!t || !t.classList) return;
  if (t.classList.contains('exi-qty') || t.classList.contains('exi-rate')) exUpdateTotal();
  if (t.classList.contains('exi-name')) {
    const box = t.closest('.exp-row').querySelector('.exi-match'); const n = t.value.trim();
    if (!n) { box.innerHTML = ''; return; }
    const m = findInventoryByName(n);
    box.innerHTML = m ? `<span class="exp-ok">In inventory: ${esc(itemName(m))} · stock ${fmt(num(m.stockQuantity), 2)} ${esc(m.unit || '')}</span><label class="expense-stock-option"><input class="exi-stock" type="checkbox"> Add qty to stock</label>` : '<span>New item — will ask to add to master</span>';
  }
});
document.addEventListener('input', e => { const el = e.target.closest('[data-inp]'); if (el && ['inQty','inRate','inCustomGst'].includes(el.id)) { previewInward(); } else if (el && el.dataset.inp === 'fleetq') { F.q = el.value; renderFleet(); } else if (el && el.dataset.inp === 'tp-qty') { calcTot(el.dataset.day); } else if (el && el.dataset.inp === 'turf-log-search') { turfModule.setAppSearch(el.value); renderTurfApplications(); } });
$('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeModal(); });
$('#drawerOv').addEventListener('mousedown', e => { if (e.target.id === 'drawerOv') closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

let tpState = { start: '', weeks: 1, days: [[],[],[],[],[],[],[]], activeDay: -1 };


/* ================= AUTH + RBAC BOOT ================= */
$('#dateChip').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
toggleDock(false);

const RBAC = {
  roles: ROLE_PERMISSIONS,
  session: { role: null, authenticated: false, uid: null, displayName: "" },
  can(permission) { return this.session.authenticated && canRole(this.session.role, permission); }
};
window.CLOVER_RBAC = RBAC;
buildNav();

function openRoleAdmin() {
  if (!RBAC.can("access.manage")) { toast("Only an administrator can assign app access.", "err"); return; }
  openForm({
    title: "Assign application access",
    sub: "The account must already exist in Firebase Authentication.",
    submit: "Save access role",
    html: fld("Firebase Auth user UID", '<input id="roleUid" required autocomplete="off" placeholder="Paste the user UID from Firebase Authentication">') +
      fld("Application role", '<select id="roleValue"><option value="manager">Operations manager</option><option value="storekeeper">Storekeeper</option><option value="operator">Field operator</option><option value="admin">Administrator</option></select>') +
      fld("Account status", '<select id="roleActive"><option value="true">Active</option><option value="false">Disabled</option></select>') +
      '<p class="muted sm">Roles are enforced again by Firestore security rules. Do not assign Administrator unless this person should have full access.</p>',
    onSubmit: async () => {
      const uid = $("#roleUid").value.trim();
      if (!uid || uid.includes("/") || uid.length > 128) { toast("Enter a valid Firebase Auth UID.", "err"); return false; }
      if (uid === RBAC.session.uid && $("#roleActive").value === "false") { toast("You cannot disable the administrator account in its own session.", "err"); return false; }
      const role = $("#roleValue").value;
      const active = $("#roleActive").value === "true";
      await setDoc(doc(db, "app_roles", uid), { role, active, updatedAt: serverTimestamp(), updatedBy: RBAC.session.uid }, { merge: true });
      toast("Application access role saved.");
    }
  });
}

document.body.classList.add("auth-locked");
$("#login").hidden = false;
let confirmationResult = null;
let recaptchaVerifier = null;
onAuthStateChanged(auth, async user => {
  stopListeners();
  RBAC.session.role = null; RBAC.session.authenticated = false; RBAC.session.uid = null; RBAC.session.displayName = "";
  const login = $("#login"), gate = $("#pinGate"), error = $("#loginErr");
  if (gate) gate.hidden = true;
  if (!user) {
    Object.keys(CONFIG.COL).forEach(k => { LOADED[k] = false; S[k] = []; });
    S._v++;
    if (login) login.hidden = false;
    if ($("#signoutBtn")) $("#signoutBtn").hidden = true;
    document.body.classList.add("auth-locked");
    buildNav();
    renderAll();
    return;
  }
  try {
    let roleSnap = await getDoc(doc(db, "app_roles", user.uid));
    // One-time bootstrap for the explicitly allowlisted first-owner UID.
    // Firestore rules must enforce the same UID, own-document-only, admin-only creation.
    const bootstrapAdminUid = "C1l8ArB3GlSaAQr6iw4O9RKGGik1";
    if (!roleSnap.exists() && user.uid === bootstrapAdminUid) {
      await setDoc(doc(db, "app_roles", user.uid), {
        role: "admin", active: true, displayName: "DARKX Administrator",
        updatedAt: serverTimestamp(), updatedBy: user.uid
      });
      roleSnap = await getDoc(doc(db, "app_roles", user.uid));
    }
    const roleData = roleSnap.exists() ? roleSnap.data() : null;
    if (!roleData || roleData.active !== true || !ROLE_PERMISSIONS[roleData.role]) {
      await signOut(auth);
      if (error) error.textContent = "This account has no active application role. Ask an administrator to assign access.";
      return;
    }
    RBAC.session.role = roleData.role;
    RBAC.session.authenticated = true;
    RBAC.session.uid = user.uid;
    RBAC.session.displayName = roleData.displayName || user.email || "";
    if (login) login.hidden = true;
    if ($("#signoutBtn")) $("#signoutBtn").hidden = false;
    document.body.classList.remove("auth-locked");
    buildNav();
    switchView((location.hash || "").slice(1) || "overview");
    startListeners();
    toast("Signed in · " + (ROLE_LABELS[roleData.role] || roleData.role));
  } catch (err) {
    console.error("RBAC role lookup failed", err);
    await signOut(auth);
    if (error) error.textContent = "Could not verify your application role. Check Firebase access rules and try again.";
  }
});
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const error = $("#loginErr");
  const sendBtn = $("#loginSubmit");
  const sendingOtp = !confirmationResult;
  error.textContent = "";
  sendBtn.disabled = true;
  try {
    if (sendingOtp) {
      const phone = $("#loginPhone").value.trim().replace(/[\s()-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        throw new Error("Enter your phone number in international format, including country code (for example, +91XXXXXXXXXX).");
      }
      if (!recaptchaVerifier) {
        recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "normal" });
      }
      confirmationResult = await signInWithPhoneNumber(auth, phone, recaptchaVerifier);
      $("#otpField").hidden = false;
      $("#loginPhone").readOnly = true;
      $("#loginSubmit").textContent = "Verify OTP";
      $("#loginOtp").focus();
      error.textContent = "OTP sent. Check your phone and enter the code.";
    } else {
      const code = $("#loginOtp").value.trim();
      if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit OTP.");
      await confirmationResult.confirm(code);
    }
  } catch (err) {
    console.error("Phone OTP sign-in failed", err);
    // Preserve the pending confirmation after a wrong OTP, but reset expired/failed
    // reCAPTCHA state after an SMS-send failure so the user can retry cleanly.
    if (sendingOtp) {
      confirmationResult = null;
      try { recaptchaVerifier?.clear(); } catch (_) {}
      recaptchaVerifier = null;
      $("#loginPhone").readOnly = false;
      $("#otpField").hidden = true;
      $("#loginOtp").value = "";
      $("#loginSubmit").textContent = "Send OTP";
    }
    error.textContent = err.message || "Could not complete phone verification. Check Firebase Phone sign-in and authorized domains.";
  } finally {
    sendBtn.disabled = false;
  }
});
$("#signoutBtn").addEventListener("click", async () => {
  try { await signOut(auth); } catch (err) { toast("Sign-out failed. Retry.", "err"); }
});



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

let cmdOpen = false;
function toggleCmdPal() {
  cmdOpen = !cmdOpen;
  $("#cmdPal").classList.toggle("open", cmdOpen);
  $("#cmdOverlay").classList.toggle("open", cmdOpen);
  if (cmdOpen) { $("#cmdInp").value = ""; $("#cmdInp").focus(); renderCmd(""); }
}
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault(); toggleCmdPal();
  }
  if (e.key === "Escape" && cmdOpen) { toggleCmdPal(); }
});
$("#cmdOverlay").addEventListener("mousedown", () => { if(cmdOpen) toggleCmdPal(); });
document.addEventListener("input", e => { if (e.target.id === "cmdInp") renderCmd(e.target.value.toLowerCase()); });

function renderCmd(q) {
  const res = [];
  Object.entries(VIEWS).forEach(([view, meta]) => {
    if (!q || String(meta[0] || "").toLowerCase().includes(q) || String(meta[3] || "").toLowerCase().includes(q)) {
      res.push({ type: "Module", name: meta[0], view, icon: meta[2] });
    }
  });

  if (q) {
    S.machines.forEach(machine => {
      const name = String(machine.assetName || "");
      const id = String(machine.id || "");
      const category = String(machine.category || "");
      if (name.toLowerCase().includes(q) || id.toLowerCase().includes(q) || category.toLowerCase().includes(q)) {
        res.push({ type: "Machine Asset", name: name || id, view: "fleet", machineId: id, icon: "precision_manufacturing" });
      }
    });

    S.users.forEach(user => {
      const name = String(user.fullName || user.mobileNumber || "");
      if (name.toLowerCase().includes(q) || String(user.mobileNumber || "").includes(q) || String(user.role || "").toLowerCase().includes(q)) {
        res.push({ type: "Workforce · " + String(user.role || "unassigned"), name, view: "registry", icon: "person" });
      }
    });

    S.inventory.forEach(item => {
      const name = String(item.partName || "");
      const category = String(item.category || "");
      if (name.toLowerCase().includes(q) || category.toLowerCase().includes(q)) {
        const cat = category.toLowerCase();
        const view = cat.includes("fertilizer") || cat.includes("pesticide") || cat.includes("enhancement") ? "turfcare" : "registry";
        res.push({ type: "Inventory · " + category, name, view, icon: "inventory_2" });
      }
    });
  }

  const buttons = res.slice(0, 10).map(result => {
    const machineAttr = result.machineId ? ` data-cmd-machine="${esc(result.machineId)}"` : "";
    return `<button type="button" data-cmd-view="${esc(result.view)}"${machineAttr}><span class="material-symbols-rounded">${esc(result.icon)}</span><div><b>${esc(result.name)}</b><span class="t">${esc(result.type)}</span></div></button>`;
  });
  const target = $("#cmdRes");
  if (target) target.innerHTML = buttons.join("") || "<div class=\"empty\" style=\"padding:40px 12px\">No results found</div>";
}

// Keep generated results data-only. Never put record names or IDs into executable inline JavaScript.
$("#cmdRes").addEventListener("click", event => {
  const button = event.target.closest("button[data-cmd-view]");
  if (!button) return;
  const view = button.dataset.cmdView;
  if (!Object.prototype.hasOwnProperty.call(VIEWS, view)) return;
  switchView(view);
  const machineId = button.dataset.cmdMachine;
  if (machineId) {
    const machine = S.machines.find(item => String(item.id) === machineId);
    if (machine) {
      F.q = String(machine.assetName || "");
      const search = $("#fleetQ");
      if (search) search.value = F.q;
      renderFleet();
    }
  }
  toggleCmdPal();
});


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
  ReCaptchaEnterpriseProvider,
  RecaptchaVerifier,
  S,
  STORE_CATS,
  TILE,
  VIEWS,
  VIEW_COLLECTIONS,
  ZCOL,
  _mx,
  _mxv,
  activeNavGroup,
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
  cmdOpen,
  collection,
  collectionAffectsCurrentView,
  confirmDelete,
  confirmationResult,
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
  getAuth,
  getCurrentView,
  getDoc,
  getDocs,
  getFirestore,
  getSunday,
  groupForView,
  guessCategory,
  hoursFor,
  increment,
  initRadarMap,
  initZoneMap,
  initializeApp,
  initializeAppCheck,
  inventoryCostSummary,
  inventoryRowsMarkup,
  isTurfCategory,
  itemName,
  ledgerRows,
  listenerEpochs,
  listenersStarted,
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
  onAuthStateChanged,
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
  raf,
  rangeBar,
  rangeLabel,
  rateForFuelLog,
  recaptchaVerifier,
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
  signInWithPhoneNumber,
  signOut,
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
  unsubs,
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
