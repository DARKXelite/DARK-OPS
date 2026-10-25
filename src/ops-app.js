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


let uiModule = null, chartModule = null, weatherModule = null, reorderModule = null, costModule = null, fleetModule = null, turfDomainModule = null, overviewModule = null, mapModule = null, storeUiModule = null, expenseModule = null;
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
const H = {
  'cost-model': () => openCostModel(),
  'open-day-cost': d => d.domain === 'turf' ? openTurfCostAnalytics() : openDayCostLedger(d.domain),
  'export-day-cost': d => exportDayCostLedger(d.domain),
  'turf-cost-apply': () => renderTurfCostAnalytics($('#turfCostFrom')?.value, $('#turfCostTo')?.value),
  'turf-cost-preset': d => applyTurfCostPreset(d.range),
  'export-turf-cost-range': () => exportTurfCostRange(),
  'export-roi': () => exportROIReport(),
  'edit-part': d => editInventoryCost(d.id),
  'open-store-records': () => openStoreRecordsEditor(),
  'fnb-tab': d => { fnbModule.setTab(d.tab); renderAll(); },
  'fnb-save-order': () => fnbModule.saveOrder(),
  'fnb-receive': d => fnbModule.receive(d.id),
  'fnb-import-orders': () => fnbModule.importOrders(),
  'fnb-clear-import': () => fnbModule.clearImport(),
  'open-role-admin': () => openRoleAdmin(),
  'open-data-reset': () => openDataReset(),
  'store-records-tab': d => { storeUiModule.setStoreRecordsTab(d.tab || 'items'); renderStoreRecordsEditor(); },
  'store-delete-item': d => deleteStoreItemFromEditor(d.id),
  'store-delete-inward': d => deleteStoreInwardFromEditor(d.id),
  'nav-turfcare': () => { setTurfSection('workboard'); switchView('turfcare'); },
  'nav-inventory-master': () => switchView('registry'),
  'turf-tab': d => setTurfSection(d.tab),
  'turf-category-products': d => { turfProductCategory = d.category || 'All categories'; setTurfSection('products'); },
  'export-turf-applications': () => { const rows=[...S.plans].filter(p=>isTurfCategory(turfPlanCategory(p))).sort((a,b)=>turfRecordDate(a).localeCompare(turfRecordDate(b))); downloadCSV('turf-application-records.csv', [['Date','Category','Product','Quantity','Unit','Treated area','Status','Notes','Created at'], ...rows.map(p=>[turfRecordDate(p),turfPlanCategory(p),turfRecordProductName(p),turfRecordQuantity(p),p.unit||p.stockUnit||p.uom||'',p.targetArea||p.area||p.location||'',turfRecordStatus(p),p.notes||p.reason||'',p.createdAt ? new Date(tsMs(p.createdAt)).toISOString() : ''])]); },
  'rec-tab': d => { storeUiModule.setRecordsTab(d.tab); renderRecords(); },
  'export-records': () => {
    if (storeUiModule.getRecordsTab() === 'maintenance') downloadCSV('maintenance.csv', [['Date','Type','Machine','Hours','Parts','By','Notes'], ...(S.maintenance||[]).map(r => [r.date, r.type, r.machineName||r.machineId, r.hoursAtEvent, JSON.stringify(r.partsUsed||[]), r.performedBy, r.notes])]);
    else if (storeUiModule.getRecordsTab() === 'assignments') downloadCSV('assignments.csv', [['At','Action','Machine','Operator','Mobile','By'], ...(S.assignments||[]).map(r => [r.at, r.action, r.machineName, r.operatorName, r.operatorMobile, r.by])]);
    else H['export-ledger']();
  },
  dock: () => toggleDock(),
  'open-fuel': openFuelModal, 'open-run': openRunModal,
  'kpi-live': () => switchView('radar'), 'kpi-svc': () => { F.sort = 'service'; switchView('fleet'); }, 'kpi-inc': () => switchView('fleet'), 'kpi-stock': () => switchView('registry'),
  rpreset: d => { if (d.p === 'custom') R[d.k].preset = 'custom'; else setPreset(R[d.k], d.p); RER[d.k](); },
  'close-modal': closeModal, 'close-drawer': closeDrawer,
  fcat: d => { F.cat = d.v; renderFleet(); }, ffuel: d => { F.fuel = d.v; renderFleet(); },
  'add-machine': () => machineForm(null), 'edit-machine': d => machineForm(mx().get(d.id)),
  'svc-done': d => { const m = mx().get(d.id); openForm({ title: 'Mark as serviced', submit: 'Confirm service', html: `<p style="margin:0">Record that <b>${esc(m.assetName)}</b> was serviced at <b>${fmt(num(m.currentHours))} hrs</b>? The ${CONFIG.SERVICE_INTERVAL}-hr cycle restarts from here.</p>`, onSubmit: async () => { await updateDoc(doc(db, CONFIG.COL.machines, m.id), { lastServiceHours: num(m.currentHours), lastServiceDate: today() }); toast('Service recorded'); } }); },
  del: d => confirmDelete(d.col, d.id, d.label),
  kebab: (d, el, e) => { e.stopPropagation(); const menu = el.nextElementSibling, open = menu.classList.contains('open'); qsa('.kmenu.open').forEach(x => x.classList.remove('open')); if (!open) menu.classList.add('open'); },
  'add-spray': d => openAddSprayTaskForm(d.day, d.date),
  'save-turf-batch': () => saveTurfBatch(),
  'open-turf-variance': () => openTurfVarianceModal(),
  'apply-turf-variance': () => { const a=$('#turfVarianceFrom')?.value||today(),b=$('#turfVarianceTo')?.value||today(); if(a>b){toast('From date must be on or before To date.','err');return;} renderTurfVariance(a,b); },
  'export-turf-variance': () => exportTurfVariance(), 
  "open-planner": () => openTurfPlanner(),
  "tp-add-app": d => { tpState.activeDay = parseInt(d.day); renderTp(); },
  "tp-cancel": () => { tpState.activeDay = -1; renderTp(); },
  "tp-del-app": d => { tpState.days[d.day].splice(parseInt(d.app), 1); renderTp(); },
  "tp-save-app": d => {
    const dIdx = parseInt(d.day);
    const productId = document.getElementById("tpProd_" + dIdx)?.value;
    const product = S.inventory.find(i => i.id === productId && isTurfCategory(i.category));
    const scope = document.getElementById("tpScope_" + dIdx)?.value || "overall";
    const qty = num(document.getElementById("tpQty_" + dIdx)?.value);
    if (!product) { toast("Select a valid turf product from Inventory Master", "err"); return; }
    if (!turfProductUnit(product)) { toast("Set this product’s stock unit in Inventory Master first", "err"); return; }
    if (!(qty > 0)) { toast("Enter a quantity greater than zero", "err"); return; }
    const totQty = scope === "per_area" ? qty * 18 : qty;
    const stockUnit = turfProductUnit(product);
    if (totQty > num(product.stockQuantity)) toast(`Planned quantity exceeds available stock for ${itemName(product)}. Check replenishment.`, "warn");
    tpState.days[dIdx].push({ pId: product.id, area: document.getElementById("tpArea_" + dIdx).value, scope, qty, unit: stockUnit, totQty });
    tpState.activeDay = -1;
    renderTp();
  },
  "save-turf-plan": async () => {
    const btn = document.querySelector("[data-act='save-turf-plan']");
    if(btn) btn.disabled = true;
    let hasData = false;
    tpState.days.forEach(d => { if(d.length > 0) hasData = true; });
    if(!hasData) { toast("Cannot save an empty plan", "err"); if(btn) btn.disabled = false; return; }
    const invalidLine = tpState.days.flat().find(app => {
      const product = S.inventory.find(i => i.id === app.pId);
      return !product || !isTurfCategory(product.category) || !turfProductUnit(product) || !(num(app.totQty) > 0) || app.unit !== turfProductUnit(product);
    });
    if (invalidLine) { toast("A planned product is missing or its stock unit changed. Recheck the plan.", "err"); if(btn) btn.disabled = false; return; }

    try {
      const b = writeBatch(db);
      const baseDate = new Date(tpState.start + "T00:00:00");

      for (let w = 0; w < tpState.weeks; w++) {
        const weekStartStr = ymd(new Date(baseDate.getTime() + w * 7 * 86400000));

        tpState.days.forEach((apps, dIdx) => {
          const targetDateStr = addDays(weekStartStr, dIdx);
          apps.forEach(app => {
            const prod = S.inventory.find(i => i.id === app.pId);
            const docRef = doc(collection(db, CONFIG.COL.plans));
            b.set(docRef, {
              weekStart: weekStartStr,
              date: targetDateStr,
              dayIndex: dIdx,
              productId: app.pId,
              productName: prod ? prod.partName : "Unknown",
              category: prod ? prod.category : "Fertilizers",
              targetQty: app.totQty,
              unit: app.unit,
              targetArea: app.area,
              scope: app.scope,
              notes: "Planned via Weekly Planner",
              status: "Planned",
              createdAt: Date.now()
            });
          });
        });
      }
      await b.commit();
      toast("Weekly plan saved successfully!");
      closeModal();
      currentTurfWeekStart = tpState.start;
      renderTurfCare();
    } catch(e) {
      console.error(e);
      toast("Failed to save plan", "err");
    }
    if(btn) btn.disabled = false;
  },
  'home-insights': () => { switchView('overview'); toggleDock(false); },
  'weather-outlook': () => { if(cur!=='overview') switchView('overview'); $('#wxOutlookCard')?.scrollIntoView({behavior:'smooth',block:'start'}); },
  'enable-rain-notifications': () => enableRainNotifications(),
  'nav-group': d => { if (d.group === 'turfops') setTurfSection('workboard'); openNavGroup(d.group); },
  'group-tab': d => switchView(d.v),
  'map-mode': d => switchView(d.mode),
  'drawer-route': d => drawerRoute(d.id), 'view-path': d => showShiftPathMap(d.sid, d.mname), 'drawer-fuel': d => drawerFuel(d.id),
  'export-fuel': () => { const st = R.fuel; downloadCSV(`fuel_${st.from}_to_${st.to}.csv`, [['Date', 'Machine', 'Fuel type', 'Litres', 'Rate / L', 'Modeled cost', 'Pricing source', 'Notes'], ...fuelIn(st.from, st.to).sort(sortFuel).map(f => [f._d, mName(f.machineId), fuelTypeFromRecord(f), num(f.litres), rateForFuelLog(f)||'', rateForFuelLog(f)>0?fuelLogCost(f):'', num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre)>0?'Transaction rate':rateForFuelLog(f)>0?'Inventory Master rate':'Unpriced', f.notes || ''])]); },
  'export-ledger': () => { const st = R.ledger; downloadCSV(`fuel_ledger_${st.from}_to_${st.to}.csv`, [['Date', 'Machine', 'Fuel type', 'Litres', 'Rate / L', 'Modeled cost', 'Pricing source', 'Notes'], ...ledgerRows().map(f => [f._d, mName(f.machineId), fuelTypeFromRecord(f), num(f.litres), rateForFuelLog(f)||'', rateForFuelLog(f)>0?fuelLogCost(f):'', num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre)>0?'Transaction rate':rateForFuelLog(f)>0?'Inventory Master rate':'Unpriced', f.notes || ''])]); },
  'export-shifts': () => { const st = R.shifts; downloadCSV(`shifts_${st.from}_to_${st.to}.csv`, [['Date', 'Operator', 'Machine', 'Distance km', 'Engine hours'], ...shiftRows().map(s => [s._d, s.operatorName || '', mName(s.machineId), num(s.distanceKm), num(s.engineHoursLogged)])]); },
  'export-run': () => { const { st, rows } = runData(); downloadCSV(`running_hours_${st.from}_to_${st.to}.csv`, [['Machine', 'Category', 'Operators', 'Shifts', 'Run hours', 'Distance km', 'Fuel L', 'L/hr'], ...rows.map(r => [r.name, r.cat, [...r.ops].join('; '), r.n, +r.H.toFixed(2), +r.km.toFixed(2), +r.L.toFixed(2), r.H && r.L ? +(r.L / r.H).toFixed(2) : ''])]); },
  'add-inward': () => openInward(),
  'export-stock': () => downloadCSV('inventory_stock.csv',[['Category','Item','Unit','Stock','Auto reorder at','Rate basis','Unit rate'],...S.inventory.map(i=>[i.category,itemName(i),i.unit||'Nos',i.stockQuantity,effectiveReorderLevel(i),autoReorderDetails(i).method,i.unitCost])]),
  'export-inwards': () => downloadCSV('goods_inwards.csv',[['Date','Invoice','Supplier','Category','Item','Unit','Qty','Rate','GST %','Taxable','GST amount','Total'],...S.inwards.map(r=>[r.receiptDate,r.invoiceNumber,r.supplier,r.category,r.itemName,r.unit,r.quantity,r.rate,r.gstPercent,r.taxableAmount,r.gstAmount,r.total])]),
  'edit-user': d => { const u=S.users.find(x=>x.id===d.id); if(!u) return toast('User record not found','err'); openForm({title:'Edit workforce member',submit:'Save changes',html:fld('Full name','<input id="euName" required>')+fld('Mobile number','<input id="euMob" inputmode="tel" required>','Saved in normalized +91 format where applicable.')+fld('Role','<select id="euRole"><option value="operator">Operator</option><option value="incharge">Incharge</option><option value="storekeeper">Storekeeper (Fuel Ledger)</option><option value="storekeeper_fertilizer">Storekeeper (Fertilizers & Pesticides)</option></select>'),onSubmit:async()=>{const name=$('#euName').value.trim(), mob=normMobile($('#euMob').value), role=$('#euRole').value;if(!name){toast('Name is required','err');return false;}if(!/^\+\d{10,14}$/.test(mob)){toast('Enter a valid mobile number','err');return false;}if(S.users.some(x=>x.id!==u.id&&x.mobileNumber===mob)){toast('This mobile number is already registered','err');return false;}await updateDoc(doc(db,CONFIG.COL.users,u.id),{fullName:name,username:name,mobileNumber:mob,role});toast('User profile updated');}});setTimeout(()=>{if($('#euName'))$('#euName').value=u.fullName||u.username||'';if($('#euMob'))$('#euMob').value=u.mobileNumber||'';if($('#euRole'))$('#euRole').value=u.role||'operator';},0); },
  'add-user': () => openForm({ title: 'Register workforce member', submit: 'Add user',
    html: fld('Full name', '<input id="uName" placeholder="e.g. Rajesh Kumar">') + fld('Mobile number', '<input id="uMob" inputmode="tel" placeholder="98765 43210">', 'Saved as +91XXXXXXXXXX so the app login can match it.') + fld('Role', '<select id="uRole"><option value="operator">Operator</option><option value="incharge">Incharge</option><option value="storekeeper">Storekeeper (Fuel Ledger)</option><option value="storekeeper_fertilizer">Storekeeper (Fertilizers & Pesticides)</option></select>'),
    onSubmit: async () => { const name = $('#uName').value.trim(), mob = normMobile($('#uMob').value); if (!name) { toast('Name is required', 'err'); return false; } if (!/^\+\d{10,14}$/.test(mob)) { toast('Enter a valid mobile number', 'err'); return false; } if (S.users.some(u => u.mobileNumber === mob)) { toast('This mobile number is already registered', 'err'); return false; } await addDoc(collection(db, CONFIG.COL.users), { fullName: name, mobileNumber: mob, role: $('#uRole').value, username: name }); toast('User registered for mobile login'); } }),
  'add-local-expense': () => { openForm({title:'Add local bill',submit:'Save bill',size:'md',html:
    `<div class="row3">${fld('Date','<input id="exDate" type="date" value="'+today()+'">')}${fld('Paid by','<select id="exPaidBy"><option value="me">Me · to claim from office</option><option value="accounts">Accounts · paid by office</option></select>')}${fld('Shop / bill ref (optional)','<input id="exVendor" placeholder="e.g. Sri Hardware, #123" autocomplete="off">')}</div>`+
    '<div class="exp-rows-head"><span>Item name</span><span>Qty</span><span>Rate ₹</span><span>Amount ₹</span><span></span></div><div id="exRows">'+exRowHTML()+exRowHTML()+'</div>'+
    '<div class="exp-rows-foot"><button type="button" class="btn btn-sm" id="exAddRow">+ Add item</button><div class="exp-total">Bill total <b id="exTotal">₹0.00</b></div></div>'+
    '<div class="muted sm">Item names are free text. Items not in inventory will each prompt you to add them to the master.</div>',
    onSubmit: async()=>{
      const items=[]; let bad=false;
      qsa('#exRows .exp-row').forEach(r=>{
        const n=r.querySelector('.exi-name').value.trim(), rateRaw=r.querySelector('.exi-rate').value, q=num(r.querySelector('.exi-qty').value), rt=num(rateRaw);
        if(!n&&!rateRaw) return;
        if(!n||q<=0||rt<=0){bad=true;return;}
        const ex=findInventoryByName(n);
        items.push({itemName:n,qty:q,rate:rt,amount:Math.round(q*rt*100)/100,category:ex?(ex.category||''):'',inInventory:!!ex,_ex:ex,_stock:!!(r.querySelector('.exi-stock')&&r.querySelector('.exi-stock').checked)});
      });
      if(bad||!items.length){toast('Each item needs a name, a quantity above zero and a rate above zero.','err');return false;}
      const paidBy=$('#exPaidBy').value, total=Math.round(items.reduce((a,i)=>a+i.amount,0)*100)/100;
      const clean=items.map(({_ex,_stock,...rest})=>rest);
      const doc0={itemName:clean.length===1?clean[0].itemName:clean[0].itemName+' +'+(clean.length-1)+' more',items:clean,itemCount:clean.length,amount:total,paidBy,spentByMe:paidBy==='me',date:$('#exDate').value||today(),vendor:$('#exVendor').value.trim(),createdAt:serverTimestamp()};
      if(clean.length===1){doc0.qty=clean[0].qty;doc0.rate=clean[0].rate;}
      // Persist the bill and linked stock additions atomically, so a failed write cannot leave
      // an expense saved without its corresponding inventory movement.
      const ref=doc(collection(db,CONFIG.COL.expenses));
      const stockMovements=new Map();
      for(const item of items){
        if(!item._ex||!item._stock) continue;
        const id=String(item._ex.id);
        const movement=stockMovements.get(id)||{qty:0,rate:item.rate};
        movement.qty+=item.qty;
        if(!(movement.rate>0)&&item.rate>0) movement.rate=item.rate;
        stockMovements.set(id,movement);
      }
      await runTransaction(db,async tx=>{
        const movements=[];
        for(const [id,movement] of stockMovements){
          const itemRef=doc(db,CONFIG.COL.inventory,id);
          const snap=await tx.get(itemRef);
          if(!snap.exists()) throw new Error('An inventory item disappeared while saving this bill. Refresh and retry.');
          movements.push({id,ref:itemRef,data:snap.data(),movement});
        }
        tx.set(ref,doc0);
        for(const entry of movements){
          const update={stockQuantity:Math.max(0,num(entry.data.stockQuantity))+entry.movement.qty,updatedAt:serverTimestamp()};
          if(!num(entry.data.unitCost)&&entry.movement.rate>0) update.unitCost=entry.movement.rate;
          tx.update(entry.ref,update);
        }
      });
      toast('Bill saved · '+money(total,2));
      const seen=new Set(), queue=[];
      clean.forEach((i,idx)=>{const k=normName(i.itemName);if(!i.inInventory&&!seen.has(k)){seen.add(k);queue.push(idx);}});
      if(queue.length){closeModal();runNewItemQueue(ref.id,clean,queue,queue.length);return false;}
    }}); qsa('#exRows .exi-name')[0]?.focus(); },
  'exp-filter': d => { expenseModule.setFilter(d.f || 'all'); renderLocalExpenseLedger(); },
  'delete-local-expense': d => openForm({title:'Delete local expense',submit:'Delete',danger:true,html:'This expense record will be permanently deleted.',onSubmit:async()=>{await deleteDoc(doc(db,CONFIG.COL.expenses,d.id));toast('Expense deleted');}}),
  'add-part': () => openForm({ title: 'Create item master', submit: 'Create item',
    html: fld('Part / Product name', '<input id="pName" placeholder="e.g. Diesel or Petrol">', 'For Fuel Ops insights, use the exact item names Diesel or Petrol and choose category Fuel.') + fld('Category', '<select id="pCat" data-chg="part-category"><option value="Spare Parts">Spare Parts</option><option value="Fuel">Fuel</option><option value="Fertilizers">Fertilizers</option><option value="Pesticides">Pesticides</option><option value="Turf Enhancements">Turf Enhancements</option><option value="Tools">Tools</option><option value="Other">Other</option></select>') + `<div id="pModelWrap">${fld('Applicable Machine / Model', `<select id="pModel">${machineOptions("", "Generic (Use for All Machines)")}</select>`, 'Only relevant for machine spare parts.')}</div>` + `<div class="row2">${fld('Opening stock', '<input id="pStock" type="number" min="0" step="any" value="0">')}${fld('Automatic reorder threshold', '<div class="auto-reorder-form-note"><b>Calculated automatically</b><small>Uses recent issue history, lead-time policy and a safety buffer.</small></div>')}</div>` + fld('Unit of measure', '<select id="pUnit"><option>Nos</option><option>Kg</option><option>Litre</option><option>Gram</option><option>ML</option><option>Bag</option><option>Pack</option></select>') + fld('Unit cost · ₹ per stock unit', '<input id="pUnitCost" type="number" min="0" step="0.01" value="0">', '0 = unknown. Enter supplier cost to unlock stock valuation and turf plan costing.'),
    onSubmit: async () => { const n = $('#pName').value.trim(); if (!n) { toast('Part name is required', 'err'); return false; } const cat = $('#pCat').value, mVal = cat === 'Spare Parts' ? $('#pModel').value : ''; const item = { partName: n, category: cat, stockQuantity: Math.max(0,num($('#pStock').value)), unit: $('#pUnit').value, reorderLevel: 0, unitCost: Math.max(0, num($('#pUnitCost').value)) }; if (cat === 'Spare Parts') item.compatibleModel = mVal ? mName(mVal) : 'Generic'; await addDoc(collection(db, CONFIG.COL.inventory), item); toast('Item master created'); } }),
  stock: async d => { try { await updateDoc(doc(db, CONFIG.COL.inventory, d.id), { stockQuantity: increment(+d.d) }); } catch (e) { toast('Could not update stock', 'err'); } },
  'add-inc': () => openForm({ title: 'Report incident', submit: 'Submit report',
    html: fld('Machine', `<select id="iMach">${machineOptions('', 'General / no machine')}</select>`) + fld('Type', '<select id="iType"><option>Breakdown</option><option>Maintenance</option><option>Safety</option><option>Other</option></select>') + fld('What happened?', '<textarea id="iDesc" placeholder="Describe the issue"></textarea>') + fld('Estimated downtime · hours (optional)', '<input id="iDownHours" type="number" min="0" step="0.5" value="0">', 'Planning estimate only. Record actual downtime separately if you need realised loss reporting.'),
    onSubmit: async () => { const desc = $('#iDesc').value.trim(); if (!desc) { toast('Please describe the issue', 'err'); return false; } const mid = $('#iMach').value; await addDoc(collection(db, CONFIG.COL.logs), { machineId: mid ? mName(mid) : 'General', logType: $('#iType').value, issueDescription: desc, repairStatus: 'Pending', estimatedDowntimeHours: Math.max(0, num($('#iDownHours').value)), createdAt: Date.now(), reportedDate: today() }); toast('Incident reported'); } }),
  'inc-toggle': async d => { const l = S.logs.find(x => x.id === d.id); if (!l) return; try { await updateDoc(doc(db, CONFIG.COL.logs, d.id), { repairStatus: l.repairStatus === 'Resolved' ? 'Pending' : 'Resolved' }); } catch (e) { toast('Could not update incident', 'err'); } }
};
const C = {
  'users-search': v => { storeUiModule.setUsersSearchText(v || ''); renderUsersMaster(); },
  'users-role-filter': v => { storeUiModule.setUsersRoleFilter(v || 'all'); renderUsersMaster(); },
  rfrom: (v, d) => { const st = R[d.k]; if (!v) return; st.from = v; st.preset = 'custom'; if (st.to < v) st.to = v; RER[d.k](); },
  rto: (v, d) => { const st = R[d.k]; if (!v) return; st.to = v; st.preset = 'custom'; if (st.from > v) st.from = v; RER[d.k](); },
  lmachine: (v, d) => { R.ledger.machine = v; RER.ledger(); }, ltype: (v) => { R.ledger.type = v; RER.ledger(); },
  'turf-week': v => { if(v) { currentTurfWeekStart = getSunday(v); renderTurfCare(); } },
  'turf-app-category': v => { turfAppCategory = v; renderTurfApplications(); },
  'turf-app-status': v => { turfAppStatus = v; renderTurfApplications(); },
  'turf-product-category': v => { turfProductCategory = v; renderTurfCare(); },
  'spray-product': v => { const product = S.inventory.find(i => i.id === v && isTurfCategory(i.category)); const unit = $('#spUnit'); if (unit) unit.value = turfProductUnit(product) || 'Unit not set'; },
  'tp-product': (v, d) => { const product = S.inventory.find(i => i.id === v && isTurfCategory(i.category)); const unit = $('#tpUnit_' + d.day); if (unit) unit.value = turfProductUnit(product) || 'Unit not set'; calcTot(d.day); },
  'tp-start': v => { tpState.start = v; }, 'tp-weeks': v => { tpState.weeks = parseInt(v) || 1; }, 'tp-scope': (v, d) => calcTot(d.day), drdate: (v, d) => drawerRoute(d.id, v), smachine: (v) => { R.shifts.machine = v; RER.shifts(); }, sop: (v) => { R.shifts.op = v; RER.shifts(); },
  fleetsort: v => { F.sort = v; renderFleet(); },
  'inward-category': () => updateInwardItems(),
  'inward-gst': () => previewInward(),
  'part-category': v => { const w = $('#pModelWrap'); if (w) w.hidden = v !== 'Spare Parts'; const unit = $('#pUnit'); if (unit && v === 'Fuel') unit.value = 'Litre'; }
};
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
document.addEventListener('input', e => { const el = e.target.closest('[data-inp]'); if (el && ['inQty','inRate','inCustomGst'].includes(el.id)) { previewInward(); } else if (el && el.dataset.inp === 'fleetq') { F.q = el.value; renderFleet(); } else if (el && el.dataset.inp === 'tp-qty') { calcTot(el.dataset.day); } else if (el && el.dataset.inp === 'turf-log-search') { turfAppSearch = el.value; renderTurfApplications(); } });
$('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeModal(); });
$('#drawerOv').addEventListener('mousedown', e => { if (e.target.id === 'drawerOv') closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

let currentTurfWeekStart = "";
let turfSection = 'workboard';
let turfAppCategory = 'All categories';
let turfAppStatus = 'All statuses';
let turfAppSearch = '';
let turfProductCategory = 'All categories';

/* ================= AUTH + RBAC BOOT ================= */
$('#dateChip').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
toggleDock(false); renderWeather(); loadWeather(); setInterval(loadWeather, 30 * 60 * 1000);

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
function setTurfSection(section) {
  turfSection = ['workboard','applications','products'].includes(section) ? section : 'workboard';
  renderTurfCare();
}
function renderTurfCategoryCards(targetId, products) {
  const categories = [
    { label:'Fertilizers', icon:'spa', cls:'fertilizer' },
    { label:'Pesticides', icon:'pest_control', cls:'pesticide' },
    { label:'Turf Enhancements', icon:'eco', cls:'enhancer' }
  ];
  const target = $(targetId);
  if (!target) return;
  setHTML(target, categories.map(cat => {
    const items = products.filter(i => turfCategoryLabel(i.category) === cat.label);
    const low = items.filter(i => num(i.stockQuantity) <= effectiveReorderLevel(i));
    return `<button class="turf-stock-category ${cat.cls}" data-act="turf-category-products" data-category="${esc(cat.label)}"><span class="turf-stock-cat-icon"><span class="material-symbols-rounded">${cat.icon}</span></span><span class="turf-stock-cat-main"><b>${esc(cat.label === 'Turf Enhancements' ? 'Turf enhancers' : cat.label)}</b><span>${items.length} product${items.length===1?'':'s'}</span></span><span class="turf-stock-cat-alert ${low.length?'warn':''}">${low.length} low</span></button>`;
  }).join(''));
}
function renderTurfApplications() {
  const target = $('#turfApplicationsTbl');
  if (!target) return;
  const all = [...(S.plans || [])].filter(p => isTurfCategory(turfPlanCategory(p)));
  const q = turfAppSearch.trim().toLowerCase();
  const rows = all.filter(p => {
    const category = turfPlanCategory(p);
    const status = turfRecordStatus(p);
    const searchText = [p.productName, p.targetArea, p.notes, category, status, p.date].join(' ').toLowerCase();
    return (turfAppCategory === 'All categories' || category === turfAppCategory) &&
      (turfAppStatus === 'All statuses' || status === turfAppStatus) && (!q || searchText.includes(q));
  }).sort((a,b) => turfRecordDate(b).localeCompare(turfRecordDate(a)) || tsMs(b.createdAt ?? b.timestamp)-tsMs(a.createdAt ?? a.timestamp));
  const count = $('#turfApplicationCount');
  if (count) count.textContent = `${rows.length} record${rows.length===1?'':'s'}`;
  setHTML(target, `<table><thead><tr><th>Date</th><th>Category</th><th>Product</th><th class="num">Quantity</th><th>Treated area</th><th>Status</th><th>Notes</th></tr></thead><tbody>${!LOADED.plans ? '<tr><td colspan="7">Loading application records…</td></tr>' : rows.length ? rows.map(p => {
    const category = turfPlanCategory(p), status = turfRecordStatus(p);
    return `<tr><td>${esc(turfRecordDate(p) || '—')}<div class="muted sm">${p.createdAt ? 'Entered '+esc(dShort(normDate(null,p.createdAt))) : ''}</div></td><td><span class="badge ${turfCategoryClass(category)}">${esc(category)}</span></td><td><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b></td><td class="num">${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || '')}</td><td>${esc(p.targetArea || p.area || p.location || 'Course')}</td><td><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></td><td class="muted">${esc(p.notes || p.reason || '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No application records match these filters.</td></tr>'}</tbody></table>`);
}
function renderTurfCare() {
  if (!currentTurfWeekStart) currentTurfWeekStart = getSunday(today());
  const weekStartEl = $('#turfWeekStart');
  if (weekStartEl && weekStartEl.value !== currentTurfWeekStart) weekStartEl.value = currentTurfWeekStart;

  // Keep the three workspaces focused. All panels still use the same live Firestore data.
  ['workboard','applications','products'].forEach(name => {
    const pane = $('#turf'+name.charAt(0).toUpperCase()+name.slice(1)+'Pane');
    if (pane) pane.hidden = turfSection !== name;
  });
  qsa('#v-turfcare .turf-view-tab').forEach(btn => {
    const active = btn.dataset.tab === turfSection;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  if ($('#turfLogSearch') && $('#turfLogSearch').value !== turfAppSearch) $('#turfLogSearch').value = turfAppSearch;
  if ($('#turfAppCategoryFilter')) $('#turfAppCategoryFilter').value = turfAppCategory;
  if ($('#turfAppStatusFilter')) $('#turfAppStatusFilter').value = turfAppStatus;
  if ($('#turfProductCategoryFilter')) $('#turfProductCategoryFilter').value = turfProductCategory;

  const turfItems = S.inventory.filter(i => isTurfCategory(i.category));
  const lowStock = turfItems.filter(i => num(i.stockQuantity) <= effectiveReorderLevel(i));
  const todayStr = today();
  const allPlans = (S.plans || []).filter(p => isTurfCategory(turfPlanCategory(p)));
  const plannedThisWeek = allPlans.filter(p => turfRecordDate(p) >= currentTurfWeekStart && turfRecordDate(p) <= addDays(currentTurfWeekStart,6) && turfRecordStatus(p) === 'Planned');
  const monthStartStr = monthStart(todayStr);
  const issuedAppliedMTD = allPlans.filter(p => turfRecordDate(p) >= monthStartStr && turfRecordDate(p) <= todayStr && turfRecordStatus(p)==='Issued').length;
  const overduePlans = allPlans.filter(p => turfRecordDate(p) && turfRecordDate(p) < todayStr && turfRecordStatus(p) === 'Planned');
  setHTML($('#turfKpiGrid'), [
    {label:'Scheduled this week',value:plannedThisWeek.length,sub:'Planned tasks in selected week',icon:'calendar_month',cls:'green'},
    {label:'Issued / applied · MTD',value:issuedAppliedMTD,sub:'Movement or application status recorded',icon:'task_alt',cls:'gold'},
    {label:'Past due',value:overduePlans.length,sub:'Not marked applied',icon:'event_busy',cls:overduePlans.length?'warn':'green'},
    {label:'Low-stock products',value:lowStock.length,sub:'At or below reorder level',icon:'inventory',cls:lowStock.length?'warn':'green'}
  ].map(k=>`<div class="turf-metric-card"><span class="turf-metric-icon ${k.cls}"><span class="material-symbols-rounded">${k.icon}</span></span><div class="turf-metric-copy"><span>${esc(k.label)}</span><b>${fmt(k.value,0)}</b><small>${esc(k.sub)}</small></div></div>`).join(''));

  // Weekly workboard: focus today (or the week's first day when browsing another week), with the remaining days stacked alongside.
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dates = Array.from({length:7},(_,i)=>addDays(currentTurfWeekStart,i));
  const weekPlans = allPlans.filter(p => (turfRecordDate(p) && turfRecordDate(p) >= currentTurfWeekStart && turfRecordDate(p) <= addDays(currentTurfWeekStart,6)) || (!turfRecordDate(p) && p.weekStart === currentTurfWeekStart));
  const plansForDay = (dateStr, idx) => weekPlans.filter(p => (turfRecordDate(p) ? turfRecordDate(p) === dateStr : p.weekStart === currentTurfWeekStart && num(p.dayIndex) === idx));
  const focusDate = dates.includes(todayStr) ? todayStr : currentTurfWeekStart;
  const focusIdx = dates.indexOf(focusDate);
  const makePlanRow = (plan, compact=false) => {
    const cat = turfPlanCategory(plan), status = turfRecordStatus(plan);
    const productName = turfRecordProductName(plan) || 'Unspecified product';
    const quantityLabel = `${fmt(turfRecordQuantity(plan),2)} ${plan.unit || plan.stockUnit || 'units'}`;
    const treatedArea = plan.targetArea || plan.area || plan.location || 'Course';
    const line = turfCostLine(plan);
    const costLabel = line.countable ? (line.cost !== null ? money(line.cost) : 'Unpriced') : 'Planned';
    return `<div class="turf-plan-item ${turfCategoryClass(cat)}" title="${esc(`${productName} · ${quantityLabel} · ${treatedArea} · ${status}`)}"><span class="turf-plan-inline-dot" aria-hidden="true"></span><span class="turf-plan-title">${esc(productName)} <small style="font-size:9px;font-weight:600;color:var(--muted)">· ${esc(treatedArea)}</small></span><span class="turf-plan-inline-qty">${fmt(turfRecordQuantity(plan),2)} ${esc(plan.unit || plan.stockUnit || 'units')}</span><span class="turf-plan-row-value">${esc(costLabel)}</span><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></div>`;
  };
  const focusPlans = plansForDay(focusDate, focusIdx);
  const focusLines = focusPlans.map(turfCostLine).filter(line => line.countable);
  const focusPriced = focusLines.filter(line => line.cost !== null);
  const focusCostLabel = !focusLines.length ? '₹0' : !focusPriced.length ? '₹—' : money(focusPriced.reduce((sum,line)=>sum+line.cost,0));
  const focusIssuedCount = focusLines.length;
  const focusCostHint = !focusLines.length ? 'No issued / applied records' : !focusPriced.length ? 'No compatible unit cost' : `${focusPriced.length} priced · ${focusLines.length-focusPriced.length} unpriced`;
  const otherDays = dates.map((dateStr,idx)=>({dateStr,idx,plans:plansForDay(dateStr,idx)})).filter(day=>day.dateStr!==focusDate);
  const dayCard = (day, featured=false) => {
    const {dateStr,idx,plans:dayPlans}=day;
    const todayClass = dateStr===todayStr ? ' today' : '';
    const headLabel = dateStr===todayStr ? 'Today' : featured ? 'Week focus' : dayNames[idx];
    if (featured) {
      const issuedCount = dayPlans.filter(p=>['Issued','Applied'].includes(turfRecordStatus(p))).length;
      const tasksCount = dayPlans.length;
      const planRows = dayPlans.length ? dayPlans.map(p=>makePlanRow(p)).join('') : '<div class="turf-empty-day featured-empty"><span class="material-symbols-rounded">event_available</span><b>No work planned</b><span>Add the first application task for this day.</span></div>';
      return `<article class="turf-day-card turf-day-featured${todayClass}">
        <div class="turf-featured-head"><div><span class="turf-focus-eyebrow">${dateStr===todayStr?'CURRENT DAY':'SELECTED WEEK'}</span><h3>${esc(dayNames[idx])}<span>${esc(dShort(dateStr))}</span></h3></div>${dateStr===todayStr?'<span class="turf-today-pill">Today</span>':'<span class="turf-focus-pill">Week focus</span>'}</div>
        <div class="turf-focus-metrics"><div><small>Scheduled products</small><b>${fmt(tasksCount,0)}</b></div><div><small>Issued / applied</small><b>${fmt(issuedCount,0)}</b></div><div title="Issued/applied quantity × matching Inventory Master unit cost"><small>Priced value</small><b>${esc(focusCostLabel)}</b><span>${esc(focusCostHint)}</span></div></div>
        <div class="turf-featured-list-heading"><span>PRODUCT & STATUS</span><span>QTY / VALUE</span></div>
        <div class="turf-day-plans turf-featured-plans">${planRows}</div>
        <div class="turf-featured-foot"><span>Recorded status only · cost requires a matching stock unit and unit rate</span><button class="turf-add-day" data-act="add-spray" data-day="${idx}" data-date="${dateStr}"><span class="material-symbols-rounded">add</span>Add task</button></div>
      </article>`;
    }
    const issuedCount=dayPlans.filter(p=>['Issued','Applied'].includes(turfRecordStatus(p))).length;
    const daySummary=dayPlans.length ? `${dayPlans.length} item${dayPlans.length===1?'':'s'} · ${issuedCount} issued/applied` : 'No work planned';
    const topNames=dayPlans.slice(0,2).map(p=>`${turfRecordProductName(p)||'Unspecified product'} · ${p.targetArea||p.area||p.location||'Course'} · ${fmt(turfRecordQuantity(p),2)} ${p.unit||p.stockUnit||'units'}`).join(' · ');
    return `<article class="turf-week-side-card${todayClass}"><div class="turf-week-side-date"><b>${esc(dayNames[idx])}</b><span>${esc(dShort(dateStr))}</span>${dateStr===todayStr?'<span class="turf-today-pill">Today</span>':''}</div><div class="turf-week-side-main"><div class="turf-week-side-summary">${esc(daySummary)}</div><div class="turf-week-side-products">${esc(topNames || 'Ready for scheduling')}${dayPlans.length>2?` · +${dayPlans.length-2} more`:''}</div></div><button class="turf-add-day compact" data-act="add-spray" data-day="${idx}" data-date="${dateStr}" aria-label="Add application for ${dayNames[idx]}"><span class="material-symbols-rounded">add</span><span>Add</span></button></article>`;
  };
  const focusDayMarkup=dayCard({dateStr:focusDate,idx:focusIdx,plans:focusPlans},true);
  setHTML($('#turfPlannerGrid'), `<div class="turf-week-layout"><div class="turf-week-focus-column">${focusDayMarkup}</div><div class="turf-week-side-stack" aria-label="Other days in selected week">${otherDays.map(day=>dayCard(day,false)).join('')}</div></div>`);

  // Needs-attention queue: overdue first, then the nearest upcoming planned tasks.
  const attention = allPlans.filter(p => turfRecordStatus(p) === 'Planned' && turfRecordDate(p))
    .sort((a,b) => ((turfRecordDate(a) < todayStr ? 0 : 1) - (turfRecordDate(b) < todayStr ? 0 : 1)) || turfRecordDate(a).localeCompare(turfRecordDate(b))).slice(0,5);
  const attCount = $('#turfActionCount'); if (attCount) attCount.textContent = String(overduePlans.length);
  setHTML($('#turfActionList'), attention.length ? attention.map(p => {
    const overdue = turfRecordDate(p) < todayStr, cat = turfPlanCategory(p);
    return `<div class="turf-attention-row"><span class="turf-attention-indicator ${overdue?'late':turfCategoryClass(cat)}"></span><div class="turf-attention-main"><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b><span>${esc(cat)} · ${esc(p.targetArea || p.area || p.location || 'Course')}</span><small>${esc(turfRecordDate(p))} · ${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || 'units')}</small></div><span class="badge ${overdue?'bad':'warn'}">${overdue?'Overdue':'Planned'}</span></div>`;
  }).join('') : '<div class="turf-empty-state"><span class="material-symbols-rounded">task_alt</span><b>Nothing overdue</b><span>No uncompleted plans need attention.</span></div>');

  renderTurfCategoryCards('#turfStockCategoryCards', turfItems);
  renderTurfCategoryCards('#turfStockCategoryCardsExpanded', turfItems);

  const recent = [...allPlans].sort((a,b) => turfRecordDate(b).localeCompare(turfRecordDate(a)) || tsMs(b.createdAt ?? b.timestamp)-tsMs(a.createdAt ?? a.timestamp)).slice(0,5);
  setHTML($('#turfRecentApplications'), recent.length ? recent.map(p => {
    const cat=turfPlanCategory(p), status=turfRecordStatus(p);
    return `<div class="turf-recent-row"><span class="turf-recent-type ${turfCategoryClass(cat)}"><span class="material-symbols-rounded">${cat==='Pesticides'?'pest_control':cat==='Turf Enhancements'?'eco':'spa'}</span></span><div class="turf-recent-main"><b>${esc(turfRecordProductName(p) || 'Unspecified product')}</b><span>${esc(p.targetArea || p.area || p.location || 'Course')} · ${esc(turfRecordDate(p) || 'No date')}</span></div><div class="turf-recent-qty"><b>${fmt(turfRecordQuantity(p),2)} ${esc(p.unit || p.stockUnit || '')}</b><span class="badge ${status==='Applied'?'ok':status==='Issued'?'gold':'warn'}">${status}</span></div></div>`;
  }).join('') : '<div class="turf-empty-state">No application records have been added yet.</div>');

  // Product register: category-first, concise and stock-oriented.
  const filteredProducts = turfItems.filter(i => turfProductCategory === 'All categories' || turfCategoryLabel(i.category) === turfProductCategory).sort((a,b)=>itemName(a).localeCompare(itemName(b)));
  setHTML($('#turfInvTbl'), `<table><thead><tr><th>Product</th><th>Category</th><th>Unit</th><th class="num">On hand</th><th class="num">Auto reorder at</th><th class="num">Unit rate</th><th>Status</th><th>Actions</th></tr></thead><tbody>${!LOADED.inventory?'<tr><td colspan="8">Loading products…</td></tr>':filteredProducts.length?filteredProducts.map(i=>{
    const low=num(i.stockQuantity)<=effectiveReorderLevel(i);
    return `<tr><td><b>${esc(itemName(i))}</b></td><td><span class="badge ${turfCategoryClass(i.category)}">${esc(turfCategoryLabel(i.category))}</span></td><td>${esc(i.unit || 'Nos')}</td><td class="num"><b>${fmt(i.stockQuantity,3)}</b></td><td class="num"><b>${fmt(effectiveReorderLevel(i),3)}</b><div class="muted sm">${autoReorderDetails(i).reliable?'Trend-based':'Provisional'}</div></td><td class="num">${num(i.unitCost)>0?money(i.unitCost,2):'—'}</td><td><span class="badge ${low?'warn':'ok'}">${low?'Reorder':'In stock'}</span></td><td class="right nowrap"><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}" title="Edit product"><span class="material-symbols-rounded">edit</span></button></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="empty">No turf products in this category. Add a product in the item master first.</td></tr>'}</tbody></table>`);
  renderTurfApplications();
  renderTurfAreaPlanDashboard();
}

function turfProductUnit(...args) { return turfDomainModule.turfProductUnit(...args); }

function openAddSprayTaskForm(dayIdx, dateStr) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const products = S.inventory.filter(i => isTurfCategory(i.category));
  if (!products.length) { toast('Add turf products in Products & stock before planning applications.', 'warn'); setTurfSection('products'); return; }
  const options = '<option value="">Choose product…</option>' + products.map(p => `<option value="${esc(p.id)}">${esc(itemName(p))} · ${esc(turfCategoryLabel(p.category))} · ${esc(turfProductUnit(p)||'Unit not set')}</option>`).join('');
  const rows = Array.from({length:10},(_,i)=>`<div class="turf-batch-entry-row"><span class="turf-batch-row-num">${i+1}</span><select id="turfBatchProd${i}" aria-label="Product row ${i+1}">${options}</select><input id="turfBatchQty${i}" type="number" min="0.01" step="any" placeholder="Qty" aria-label="Quantity row ${i+1}"><span class="muted sm turf-batch-area" style="font-size:10px">Area selected above</span></div>`).join('');
  const areas=['Greens','Fairway','Nursery','Driving Range','Short Game Area','Roughs'];
  const weekdayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  openModal({title:`Plan treatments · ${dayNames[Number(dayIdx)] || 'Selected day'}`,sub:`${dShort(dateStr)} · Schedule up to 10 products`,size:'turf-batch-modal',body:`<div class="turf-batch-modal-body"><div class="muted sm">Choose the course area and validity window. Selected weekdays create a scheduled task for each matching date. Empty product rows are ignored; inventory is not deducted until issue is recorded.</div><div class="turf-plan-schedule-grid"><label>Course area<select id="turfBatchArea">${areas.map(a=>`<option value="${a}" ${a==='Greens'?'selected':''}>${a}</option>`).join('')}</select></label><label>Valid from<input type="date" id="turfBatchFrom" value="${esc(dateStr)}" required></label><label>Valid until<input type="date" id="turfBatchUntil" value="${esc(dateStr)}" required></label></div><fieldset class="turf-weekday-picks"><legend>Repeat on weekdays</legend>${weekdayNames.map((d,i)=>`<label><input type="checkbox" name="turfBatchWeekday" value="${i}" ${i===Number(dayIdx)?'checked':''}>${d.slice(0,3)}</label>`).join('')}</fieldset><div class="turf-batch-entry-grid" style="padding:0 8px"><label>Product</label><label>Planned quantity</label><label>Area</label></div><div class="turf-batch-entry-list">${rows}</div><label style="display:grid;gap:5px;font-size:10px;color:var(--muted);font-weight:700">Shared planning notes<textarea id="turfBatchNotes" rows="2" placeholder="Purpose, rate reference or planning notes"></textarea></label><input type="hidden" id="turfBatchDay" value="${Number(dayIdx)}"><input type="hidden" id="turfBatchDate" value="${esc(dateStr)}"></div>`,footer:`<button class="btn" data-act="close-modal">Cancel</button><button class="btn btn-primary" data-act="save-turf-batch"><span class="material-symbols-rounded">playlist_add_check</span>Save schedule</button>`});
}
async function saveTurfBatch() {
  const dayIdx = Number($('#turfBatchDay')?.value), fallbackDate = $('#turfBatchDate')?.value;
  const from = $('#turfBatchFrom')?.value || fallbackDate, until = $('#turfBatchUntil')?.value || fallbackDate;
  const area = $('#turfBatchArea')?.value || 'Greens';
  const weekdays = qsa('input[name="turfBatchWeekday"]:checked').map(x=>Number(x.value));
  const notes = $('#turfBatchNotes')?.value?.trim() || '';
  if(!from || !until || until < from){toast('Choose a valid date range.','err');return;}
  if(!weekdays.length){toast('Select at least one weekday.','err');return;}
  const rows=[];
  for(let i=0;i<10;i++){
    const productId=$(`#turfBatchProd${i}`)?.value, qty=num($(`#turfBatchQty${i}`)?.value);
    if(!productId && !(qty>0)) continue;
    const product=S.inventory.find(p=>p.id===productId&&isTurfCategory(p.category));
    if(!product){toast(`Choose a valid product in row ${i+1}.`,'err');return;}
    if(!(qty>0)){toast(`Enter a quantity greater than zero in row ${i+1}.`,'err');return;}
    const unit=turfProductUnit(product);if(!unit){toast(`Set the stock unit for ${itemName(product)} in Products & stock first.`,'err');return;}
    rows.push({product,qty,unit});
  }
  if(!rows.length){toast('Add at least one product and quantity.','warn');return;}
  const dates=[];for(let d=from;d<=until;d=addDays(d,1)){const date=new Date(`${d}T12:00:00`);if(weekdays.includes(date.getDay()))dates.push(d);if(d===until)break;}
  if(!dates.length){toast('No dates in this range match the selected weekdays.','err');return;}
  if(dates.length*rows.length>500){toast('This schedule creates more than 500 tasks. Narrow the date range or weekdays.','err');return;}
  try{
    for(const dateStr of dates){const dateObj=new Date(`${dateStr}T12:00:00`);for(const r of rows) await addDoc(collection(db,CONFIG.COL.plans),{weekStart:currentTurfWeekStart,date:dateStr,dayIndex:dateObj.getDay(),productId:r.product.id,productName:itemName(r.product),category:r.product.category||'Fertilizers',targetQty:r.qty,unit:r.unit,targetArea:area,area,validFrom:from,validUntil:until,repeatWeekdays:weekdays,notes,status:'Planned',createdAt:Date.now()});}
    closeModal();toast(`${rows.length} product${rows.length===1?'':'s'} scheduled for ${dates.length} date${dates.length===1?'':'s'} in ${area}.`);renderTurfCare();
  }catch(e){console.error(e);toast('Schedule save failed. Some tasks may have saved; refresh and verify before retrying.','err');}
}
function renderTurfAreaPlanDashboard(){
  const el=$('#opsTurfAreaPlan'); if(!el)return;
  const todayStr=today();
  const areaName=p=>String(p.targetArea||p.area||p.location||'').trim();
  const plannedQty=p=>num(p.targetQty??p.plannedQty??p.requestedQty??p.plannedQuantity??p.targetQuantity??(turfRecordStatus(p)==='Planned'?(p.quantity??p.qty):0));
  const plans=(S.plans||[]).filter(p=>isTurfCategory(turfPlanCategory(p))&&turfRecordDate(p)===todayStr&&turfRecordStatus(p)!=='Cancelled')
    .sort((a,b)=>areaName(a).localeCompare(areaName(b))||turfRecordProductName(a).localeCompare(turfRecordProductName(b)));
  const areas=['Greens','Fairway','Nursery','Driving Range','Short Game Area','Roughs'];
  const grouped=areas.map(area=>({area,rows:plans.filter(p=>areaName(p).toLowerCase()===area.toLowerCase())})).filter(g=>g.rows.length);
  const unknown=plans.filter(p=>!areas.some(a=>a.toLowerCase()===areaName(p).toLowerCase()));
  if(unknown.length)grouped.push({area:'Other / Unassigned',rows:unknown});
  el.innerHTML=grouped.length?grouped.map(g=>`<div class="ops-turf-area-row"><div class="ops-turf-area-row-head"><b>${esc(g.area)}</b><span>${g.rows.length} task${g.rows.length===1?'':'s'}</span></div>${g.rows.slice(0,6).map(p=>`<div class="ops-turf-area-task"><span>${esc(turfRecordProductName(p)||'Product')}</span><span>${esc(turfRecordStatus(p))}</span><b>${fmt(plannedQty(p),2)} ${esc(p.unit||p.stockUnit||'units')}</b></div>`).join('')}${g.rows.length>6?`<div class="muted sm">+${g.rows.length-6} more today</div>`:''}</div>`).join(''):'<div class="ops-product-compare-empty">No area-wise treatments scheduled for today.</div>';
}

function openTurfVarianceModal(from=monthStart(today()),to=today()) {
  const body=`<div class="turf-variance-filters"><label>From date<input type="date" id="turfVarianceFrom" value="${esc(from)}"></label><label>To date<input type="date" id="turfVarianceTo" value="${esc(to)}"></label><button class="btn btn-primary" data-act="apply-turf-variance">Apply range</button><button class="btn" data-act="export-turf-variance">Export CSV</button></div><div id="turfVarianceResults"></div>`;
  openModal({title:'Turf Ops · Planned vs issued variance',sub:'Product-level reconciliation · quantities remain separated by stock unit',size:'turf-cost-analytics',body,footer:'<button class="btn" data-act="close-modal">Close</button>'});
  renderTurfVariance(from,to);
}
function renderTurfVariance(from,to){
  const target=$('#turfVarianceResults');if(!target)return;
  const rows=(S.plans||[]).filter(p=>isTurfCategory(turfPlanCategory(p))&&turfRecordDate(p)>=from&&turfRecordDate(p)<=to&&turfRecordStatus(p)!=='Cancelled');
  const map = new Map();
  const firstQuantity = (record, keys) => {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) {
        return { found: true, value: Math.max(0, Number(value)) };
      }
    }
    return { found: false, value: 0 };
  };
  const planKeys = ['targetQty','plannedQty','requestedQty','plannedQuantity','targetQuantity'];
  const explicitIssuedKeys = ['issuedQty','issuedQuantity','issueQty','issueQuantity','quantityIssued','qtyIssued','quantityOut','qtyOut'];
  const actualKeys = ['actualQty','appliedQty','applicationQty','quantityUsed','usedQuantity','qtyUsed','dispensedQty'];
  for (const p of rows) {
    const status = turfRecordStatus(p);
    const hasPlan = planKeys.some(k => p[k] !== undefined && p[k] !== null && p[k] !== '');
    const explicitIssued = firstQuantity(p, explicitIssuedKeys);
    const actual = firstQuantity(p, actualKeys);
    const issued = status === 'Issued' || status === 'Applied' || (explicitIssued.found && explicitIssued.value > 0);
    const planned = status === 'Planned' || hasPlan || p.wasPlanned === true || p.fromPlan === true || p.planned === true;
    if (!issued && !planned) continue;

    const name = turfRecordProductName(p) || 'Unspecified product';
    const unit = String(p.unit ?? p.stockUnit ?? p.uom ?? p.unitOfMeasure ?? 'unit not set').trim();
    const productKey = String(p.productId ?? p.productID ?? p.itemId ?? p.inventoryId ?? name).trim().toLowerCase();
    const key = productKey + '|' + unit.toLowerCase();
    if (!map.has(key)) map.set(key, {name,unit,planned:0,issued:0,plannedCount:0,issuedCount:0});
    const row = map.get(key);

    const planQuantity = firstQuantity(p, planKeys);
    const plannedQty = planQuantity.found
      ? planQuantity.value
      : (status === 'Planned' ? firstQuantity(p, ['quantity','qty']).value : 0);

    // Legacy records that only store targetQty and status=Issued/Applied still represent issued movement.
    const issuedQuantity = explicitIssued.found
      ? explicitIssued.value
      : actual.found
        ? actual.value
        : (issued ? (plannedQty || firstQuantity(p, ['quantity','qty']).value) : 0);

    if (planned) { row.planned += plannedQty; row.plannedCount++; }
    if (issued) { row.issued += issuedQuantity; row.issuedCount++; }
  }
  const list=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));window.__turfVarianceRows=list.map(r=>({...r,variance:r.issued-r.planned}));
  target.innerHTML=list.length?`<div class="table-wrap"><table class="turf-variance-table"><thead><tr><th>Product</th><th>Planned</th><th>Issued</th><th>Variance</th><th>Records</th></tr></thead><tbody>${list.map(r=>`<tr><td><b>${esc(r.name)}</b><div class="muted sm">${esc(r.unit)}</div></td><td>${fmt(r.planned,2)}</td><td>${fmt(r.issued,2)}</td><td style="color:${r.issued>r.planned?'var(--bad)':r.issued<r.planned?'var(--warn)':'var(--ok)'};font-weight:800">${r.issued-r.planned>0?'+':''}${fmt(r.issued-r.planned,2)}</td><td>${r.plannedCount} / ${r.issuedCount}</td></tr>`).join('')}</tbody></table></div><p class="muted sm">Variance = issued quantity minus planned quantity. Product quantities are not combined across units.</p>`:'<div class="ops-product-compare-empty">No planned or issued turf records found in this date range.</div>';
}
function exportTurfVariance(){const rows=window.__turfVarianceRows||[];downloadCSV('turf-planned-vs-issued-variance.csv',[['Product','Unit','Planned quantity','Issued quantity','Variance','Planned records','Issued records'],...rows.map(r=>[r.name,r.unit,r.planned,r.issued,r.variance,r.plannedCount,r.issuedCount])]);}





let tpState = { start: '', weeks: 1, days: [[],[],[],[],[],[],[]], activeDay: -1 };

function openTurfPlanner() {
  tpState = { start: currentTurfWeekStart || getSunday(today()), weeks: 1, days: [[],[],[],[],[],[],[]], activeDay: -1 };
  openModal({
    title: 'Weekly Turf Application Planner',
    size: 'lg',
    body: '<div id="tpContainer"></div>',
    footer: '<button class="btn" data-act="close-modal">Cancel</button><button class="btn btn-primary" data-act="save-turf-plan">Save Weekly Plan</button>'
  });
  renderTp();
}

function renderTp() {
  const c = $('#tpContainer');
  if (!c) return;
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const products = S.inventory.filter(i => isTurfCategory(i.category));
  const pOptions = products.map((p,idx) => `<option value="${esc(p.id)}" ${idx===0?'selected':''}>${esc(itemName(p))} (${esc(turfCategoryLabel(p.category))} · Stock: ${fmt(p.stockQuantity,3)} ${esc(turfProductUnit(p) || 'UNIT NOT SET')})</option>`).join("");

  const unitTotals = {};
  tpState.days.forEach(day => day.forEach(app => { const u = String(app.unit || 'units'); unitTotals[u] = (unitTotals[u] || 0) + num(app.totQty); }));
  const plannedLines = tpState.days.reduce((n,day)=>n+day.length,0);
  const plannedByUnit = Object.entries(unitTotals).map(([unit,qty])=>`${fmt(qty,1)} ${unit}`).join(' · ');
  let h = `<div class="turf-plan-summary"><span class="material-symbols-rounded">summarize</span><div><b>Plan summary</b><span>${plannedLines ? `${plannedLines} planned application line(s) · ${plannedByUnit}` : 'Add products and treated areas to build this week’s plan.'}</span></div><small>Whole-course planning only. Inventory is deducted only when an issue is recorded.</small></div>`;

  h += `<div class="row2" style="margin-bottom:16px">
    ${fld('Week Starting (Sunday)', `<input type="date" id="tpStart" value="${tpState.start}" data-chg="tp-start">`)}
    ${fld('Repeat Plan', `<select id="tpWeeks" data-chg="tp-weeks"><option value="1" ${tpState.weeks==1?'selected':''}>1 Week (Current only)</option><option value="2" ${tpState.weeks==2?'selected':''}>2 Weeks</option><option value="3" ${tpState.weeks==3?'selected':''}>3 Weeks</option><option value="4" ${tpState.weeks==4?'selected':''}>4 Weeks</option></select>`)}
  </div>`;

  h += `<div style="display:flex;flex-direction:column;gap:8px">`;
  tpState.days.forEach((apps, dIdx) => {
    h += `<div class="card" style="padding:12px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h4 style="margin:0;color:var(--gold);font-size:14px">${daysOfWeek[dIdx]}</h4>
        <button class="btn btn-sm" data-act="tp-add-app" data-day="${dIdx}">+ Add Spray</button>
      </div>`;

    if (apps.length > 0) {
      h += `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">`;
      apps.forEach((app, aIdx) => {
        const p = S.inventory.find(x => x.id === app.pId);
        const pName = p ? p.partName : "Unknown";
        h += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.4);padding:8px 12px;border-radius:8px;border-left:3px solid var(--ok)">
          <div><b style="font-size:13px">${esc(pName)}</b> <div class="muted sm">(${app.scope === 'per_area' ? app.qty + ' ' + app.unit + ' per ' + app.area : app.qty + ' ' + app.unit + ' overall course'})</div></div>
          <div style="display:flex;align-items:center;gap:12px">
            <b style="color:var(--gold);font-size:13px">Total: ${app.totQty} ${app.unit}</b>
            <button class="icon-btn" style="width:28px;height:28px;min-height:0" data-act="tp-del-app" data-day="${dIdx}" data-app="${aIdx}"><span class="material-symbols-rounded" style="font-size:16px">close</span></button>
          </div>
        </div>`;
      });
      h += `</div>`;
    }

    if (tpState.activeDay === dIdx) {
       h += `<div style="margin-top:12px;padding:14px;background:rgba(0,0,0,0.6);border:1px solid var(--brand-2);border-radius:12px">
         <div class="row2">
           ${fld('Product', `<select id="tpProd_${dIdx}" data-chg="tp-product" data-day="${dIdx}">${pOptions || '<option value="">No turf products available</option>'}</select>`)}
           ${fld('Area Target', `<select id="tpArea_${dIdx}"><option>Greens</option><option>Fairways</option><option>Roughs</option><option>Tees</option><option>Nursery</option></select>`)}
         </div>
         <div class="row2">
           ${fld('Scope Strategy', `<select id="tpScope_${dIdx}" data-chg="tp-scope" data-day="${dIdx}"><option value="overall">Whole course</option></select>`)}
           <div style="display:flex;gap:8px">
             <div style="flex:1">${fld('Quantity', `<input type="number" id="tpQty_${dIdx}" value="1" min="0.1" step="0.1" data-inp="tp-qty" data-day="${dIdx}">`)}</div>
             <div style="flex:1">${fld('Stock unit', `<input id="tpUnit_${dIdx}" value="${esc(turfProductUnit(products[0]) || 'Unit not set')}" readonly aria-readonly="true">`)}</div>
           </div>
         </div>
         <div style="margin-top:6px;font-size:13px;color:var(--ok);font-weight:800" id="tpTot_${dIdx}">Calculated Total Need: 1</div>
         <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
           <button class="btn" data-act="tp-cancel">Cancel</button>
           <button class="btn btn-primary" data-act="tp-save-app" data-day="${dIdx}">Save to ${daysOfWeek[dIdx]}</button>
         </div>
       </div>`;
    }
    h += `</div>`;
  });
  h += `</div>`;
  setHTML(c, h);
}

function calcTot(dIdx) {
  const scopeEl = $(`#tpScope_${dIdx}`);
  const qtyEl = $(`#tpQty_${dIdx}`);
  const unitEl = $(`#tpUnit_${dIdx}`);
  if (!scopeEl || !qtyEl) return;
  const scope = scopeEl.value;
  const qty = num(qtyEl.value);
  let tot = scope === 'per_area' ? qty * 18 : qty;
  const tEl = $(`#tpTot_${dIdx}`);
  if(tEl) tEl.textContent = `Calculated Total Need: ${fmt(tot, 1)} ${unitEl ? unitEl.value : ''}`;
}





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
  C,
  CONFIG,
  COST,
  COST_DEFAULTS,
  F,
  FUEL_RATE,
  H,
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
  currentTurfWeekStart,
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
  turfAppCategory,
  turfAppSearch,
  turfAppStatus,
  turfCategoryClass,
  turfCategoryLabel,
  turfCostLine,
  turfDayProductValueRows,
  turfPlanCategory,
  turfProductCategory,
  turfProductForPlan,
  turfProductUnit,
  turfRecordDate,
  turfRecordProductName,
  turfRecordQuantity,
  turfRecordStatus,
  turfSection,
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
expenseModule = createExpenseModule(APP_CONTEXT);
storeUiModule = createStoreUiModule(APP_CONTEXT);
uiModule = createUIPrimitivesModule(APP_CONTEXT);
chartModule = createChartModule(APP_CONTEXT);
weatherModule = createWeatherModule(APP_CONTEXT);
reorderModule = createReorderIntelligenceModule(APP_CONTEXT);
costModule = createCostAnalyticsModule(APP_CONTEXT);
fleetModule = createFleetModule(APP_CONTEXT);

turfDomainModule = createTurfDomainModule(APP_CONTEXT);
overviewModule = createOverviewModule(APP_CONTEXT);
mapModule = createCourseMapModule(APP_CONTEXT);
