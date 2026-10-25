import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc, increment, onSnapshot, getDocs, writeBatch, runTransaction, serverTimestamp, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithPhoneNumber, RecaptchaVerifier, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { createFnbModule } from "./modules/fnb/fnb-module.js";
import { ROLE_PERMISSIONS, ROLE_LABELS, canRole, permissionForAction, permissionForView, permissionForCollection } from "./modules/rbac.js";


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
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const fmt = (n, d=1) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
const money = (n, d=0) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d === 0 ? 0 : 2 });
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const monthStart = s => s.slice(0, 8) + '01';
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dShort = s => s ? `${+s.slice(8,10)} ${MON[+s.slice(5,7)-1]}` : '';
const dLong = s => s ? `${+s.slice(8,10)} ${MON[+s.slice(5,7)-1]} ${s.slice(0,4)}` : '—';
const fmtHrs = h => { h = num(h); return `${Math.floor(h)}h ${pad(Math.round((h % 1) * 60) % 60)}m`; };
const sum = (a, k) => a.reduce((t, x) => t + num(x[k]), 0);
const tsMs = v => !v ? 0 : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v.toMillis ? v.toMillis() : (Date.parse(v) || 0);
const timeOf = ms => ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
const ago = ms => { if (!ms) return 'just now'; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s/60)}m ago` : `${Math.round(s/3600)}h ago`; };
function normDate(v, ts) {
  if (typeof v === 'string') {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  } else if (v && v.toDate) return ymd(v.toDate());
  else if (typeof v === 'number') return ymd(new Date(v < 1e12 ? v * 1000 : v));
  const t = tsMs(ts); return t ? ymd(new Date(t)) : '';
}
function daysBetween(a, b) { const out = []; let d = a, n = 0; while (d <= b && n++ < 400) { out.push(d); d = addDays(d, 1); } return out; }
function setHTML(el, html) { if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }

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
let cur = 'overview', curModalRender = null, W = null, Wfail = false;
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
function toast(msg, type = 'ok') {
  const t = document.createElement('div'); t.className = 'toast' + (type === 'err' ? ' err' : type === 'warn' ? ' warn' : '');
  t.innerHTML = `<span class="material-symbols-rounded">${type === 'err' ? 'error' : type === 'warn' ? 'warning' : 'check_circle'}</span><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t); setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, type === 'err' ? 6000 : 3500);
}
function setConn(state) { document.documentElement.dataset.firebaseState = state || 'connecting'; const dot=$('#connDot'); if(dot) dot.className='dot '+state; const label=$('#connText'); if(label) label.textContent=state==='ok'?'Connected':state==='err'?'Connection error':'Connecting'; }
function openModal({ title, sub = '', body = '', footer = '', size = '' }) {
  $('#modal').className = 'modal ' + size; $('#modal').setAttribute('aria-label', title || 'Dialog'); $('#mTitle').textContent = title; $('#mSub').textContent = sub;
  $('#mBody').innerHTML = body; $('#mBody')._h = null; $('#mFoot').innerHTML = footer; $('#mFoot').style.display = footer ? 'flex' : 'none';
  $('#overlay').classList.add('open');
}
function closeModal() { $('#overlay').classList.remove('open'); curModalRender = null; }
function openForm({ title, html, submit = 'Save', danger = false, onSubmit }) {
  curModalRender = null;
  openModal({ title, size: 'sm', body: html, footer: `<button class="btn" data-act="close-modal">Cancel</button><button class="btn ${danger ? 'btn-danger fill' : 'btn-primary'}" id="mSubmit">${esc(submit)}</button>` });
  const btn = $('#mSubmit');
  btn.onclick = async () => { btn.disabled = true; try { const ok = await onSubmit(); if (ok !== false) closeModal(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong', 'err'); } btn.disabled = false; };
  const first = $('#mBody input,#mBody select'); if (first) setTimeout(() => first.focus(), 30);
}
function confirmDelete(col, id, label) {
  openForm({ title: 'Delete record', html: `<p style="margin:0">Permanently delete <b>${esc(label)}</b>? This cannot be undone.</p>`, submit: 'Delete', danger: true,
    onSubmit: async () => { await deleteDoc(doc(db, CONFIG.COL[col] || col, id)); toast(`${label} deleted`); } });
}
function openDrawer(title, sub, body) { $('#dTitle').textContent = title; $('#dSub').textContent = sub; $('#dBody').innerHTML = body; $('#drawerOv').classList.add('open'); }
function closeDrawer() { $('#drawerOv').classList.remove('open'); }
function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const fld = (label, inner, hint = '') => `<div class="field"><label class="f">${label}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const machineOptions = (sel = '', blank = 'All machines') => `<option value="">${blank}</option>` + [...S.machines].sort((a, b) => (a.assetName || '').localeCompare(b.assetName || '')).map(m => `<option value="${esc(m.id)}" ${sel === m.id ? 'selected' : ''}>${esc(m.assetName)}</option>`).join('');

/* ---- charts ---- */
function barChart(items, { unit = '', h = 190 } = {}) {
  if (!items.length) return '<div class="empty">No data in this range</div>';
  const W_ = 640, pl = 38, pb = 26, pt = 16, pr = 8, max = Math.max(1, ...items.map(i => i.value)), n = items.length;
  const bw = (W_ - pl - pr) / n, bar = Math.min(38, bw * 0.62), ph = h - pt - pb, step = Math.ceil(n / 12);
  let g = '';
  [0, .5, 1].forEach(f => { const y = h - pb - f * ph; g += `<line x1="${pl}" x2="${W_ - pr}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)">${fmt(max * f, max < 10 ? 1 : 0)}</text>`; });
  items.forEach((it, i) => {
    const x = pl + i * bw + (bw - bar) / 2, bh = it.value / max * ph, y = h - pb - bh;
    g += `<rect x="${x}" y="${y}" width="${bar}" height="${Math.max(bh, it.value > 0 ? 2 : 0)}" rx="4" fill="var(--brand-2)" opacity=".92"><title>${esc(it.label)}: ${fmt(it.value, 1)} ${unit}</title></rect>`;
    if (n <= 14 && it.value > 0) g += `<text x="${x + bar / 2}" y="${y - 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--text)">${fmt(it.value, 1)}</text>`;
    if (i % step === 0) g += `<text x="${x + bar / 2}" y="${h - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(it.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W_} ${h}" width="100%" role="img" aria-label="Bar chart">${g}</svg>`;
}
function sparkline(vals) {
  if (!vals.length) return '';
  const w = 400, h = 56, max = Math.max(1, ...vals), st = w / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => `${(i * st).toFixed(1)},${(h - 4 - v / max * (h - 10)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="56" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--brand-2)" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}

/* ================= WEATHER ================= */
function wxKind(c) {
  if (c === 0) return 'clear'; if (c === 1 || c === 2) return 'partly'; if (c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog'; if (c >= 51 && c <= 57) return 'drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain'; if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm'; return 'cloud';
}
const WX_LABEL = { clear: 'Clear sky', partly: 'Partly cloudy', cloud: 'Overcast', fog: 'Foggy', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm' };
function wxScene(kind, day, wind, temp, label) {
  let h = '';
  const stars = [[8,12],[22,40],[35,18],[48,52],[60,10],[72,34],[84,16],[92,48],[14,70],[66,66]].map(([l, t], i) => `<i style="left:${l}%;top:${t}px;animation-delay:${i * .4}s"></i>`).join('');
  if (!day && (kind === 'clear' || kind === 'partly' || kind === 'cloud')) h += `<div class="stars">${stars}</div>`;
  if (kind === 'clear' || kind === 'partly') h += day ? '<div class="sun"><i></i></div>' : '<div class="moon"></div>';
  const nc = { clear: 0, partly: 2, cloud: 3, fog: 0, drizzle: 3, rain: 3, storm: 3, snow: 3 }[kind];
  for (let i = 0; i < nc; i++) h += `<div class="cl" style="top:${22 + i * 20}px;left:${8 + i * 28}%;--d:${16 + i * 5}s;transform:scale(${1 - i * .12})"></div>`;
  const nd = { drizzle: 14, rain: 34, storm: 46 }[kind] || 0;
  for (let i = 0; i < nd; i++) h += `<div class="drop" style="left:${(i * 37 + 5) % 100}%;animation-delay:${(i * 0.17) % 0.9}s;animation-duration:${(0.55 + (i % 4) * .08)}s"></div>`;
  if (kind === 'snow') for (let i = 0; i < 26; i++) h += `<div class="flake" style="left:${(i * 41 + 7) % 100}%;animation-delay:${(i * .31) % 4}s;animation-duration:${3 + (i % 4)}s"></div>`;
  if (kind === 'storm') h += '<svg class="bolt" viewBox="0 0 34 70"><polygon points="20,0 2,40 15,40 8,70 32,26 18,26" fill="#FFE27A"/></svg>';
  if (kind === 'fog') for (let i = 0; i < 4; i++) h += `<div class="fogbar" style="top:${30 + i * 28}px;animation-delay:${i * 1.3}s"></div>`;
  if (wind >= 18) for (let i = 0; i < 4; i++) h += `<div class="wl" style="top:${24 + i * 30}px;animation-delay:${i * .6}s;animation-duration:${2.4 - Math.min(1.2, wind / 40)}s"></div>`;
  return `<div class="wx-scene ${day ? 'day' : 'night'} k-${kind}">${h}<div class="wx-over"><div class="t">${temp}</div><div class="c">${esc(label)}</div></div></div>`;
}
function wxIcon(kind, day) {
  const cloud = (fill = '#C5CED8') => `<g class="ico-drift"><path d="M9 24h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 9.2 15.2 4.4 4.4 0 0 0 9 24z" fill="${fill}"/></g>`;
  const sun = '<circle cx="16" cy="16" r="5.5" fill="#F7B500"/><g class="ico-rot" stroke="#F7B500" stroke-width="2" stroke-linecap="round"><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"/></g>';
  const moon = '<path d="M21 6a10 10 0 1 0 5 17 8.5 8.5 0 0 1-5-17z" fill="#EFE8BE"/>';
  let b = '';
  if (kind === 'clear') b = day ? sun : moon;
  else if (kind === 'partly') b = (day ? '<circle cx="12" cy="11" r="4.5" fill="#F7B500"/>' : '<path d="M14 4a7 7 0 1 0 4 12 6 6 0 0 1-4-12z" fill="#EFE8BE"/>') + cloud();
  else if (kind === 'fog') b = '<g stroke="#AEB9C5" stroke-width="2.4" stroke-linecap="round"><path class="ico-drift" d="M6 11h20M4 17h22M8 23h18"/></g>';
  else if (kind === 'snow') b = cloud() + '<g fill="#fff" stroke="#9db0c4" stroke-width=".6"><circle class="ico-drop" cx="11" cy="27" r="1.6"/><circle class="ico-drop" style="animation-delay:.4s" cx="17" cy="27" r="1.6"/><circle class="ico-drop" style="animation-delay:.7s" cx="23" cy="27" r="1.6"/></g>';
  else if (kind === 'drizzle' || kind === 'rain') b = cloud('#9AA7B6') + `<g stroke="#4A90D9" stroke-width="2" stroke-linecap="round"><path class="ico-drop" d="M11 26v2"/><path class="ico-drop" style="animation-delay:.35s" d="M16 26v2"/><path class="ico-drop" style="animation-delay:.7s" d="M21 26v2"/></g>`;
  else if (kind === 'storm') b = cloud('#6D7488') + '<polygon class="ico-flash" points="17,18 11,27 16,27 14,32 22,22 17,22" fill="#F7C531"/>';
  else b = cloud();
  return `<svg class="ico" viewBox="0 0 32 32" aria-hidden="true">${b}</svg>`;
}
function advisory(w) {
  const k = wxKind(w.code);
  if (k === 'storm') return { t: 'bad', m: 'Thunderstorm — pull machines and staff off the course', i: 'thunderstorm' };
  if (k === 'rain' || k === 'drizzle' || w.precip > 0.4) return { t: 'warn', m: 'Rain — hold mowing and spraying', i: 'umbrella' };
  if (w.wind >= CONFIG.WIND_LIMIT) return { t: 'warn', m: `Wind ${Math.round(w.wind)} km/h — avoid spraying`, i: 'air' };
  if (w.temp >= 36) return { t: 'warn', m: 'High heat — schedule operators early morning', i: 'device_thermostat' };
  return { t: 'ok', m: 'Conditions suitable for normal operations', i: 'check_circle' };
}
let wxSig = '', wxForecastNotificationSignature = '';
const WX_RAIN_NOTIFIED_KEY = 'clover-greens-rain-notified-date-v1';
let wxLastNotifiedDateMemory = '';
function updateRainNotificationButton(){
  const b=$('#wxEnableNotify'); if(!b)return;
  const granted=typeof Notification!=='undefined'&&Notification.permission==='granted';
  b.classList.toggle('enabled',granted);
  b.innerHTML=`<span class="material-symbols-rounded">${granted?'notifications_active':'notifications'}</span><span>${granted?'Rain alerts enabled':'Enable rain alerts'}</span>`;
  b.title=granted?'Rain alerts can appear while this dashboard is open.':'Allow browser notifications for rain signals in the next seven days.';
}
function maybeNotifyRainForecast(){
  if(typeof Notification==='undefined'||Notification.permission!=='granted'||!W?.forecast)return;
  const risk=wxRainDays().sort((a,b)=>a.index-b.index)[0]; if(!risk)return;
  let last=''; try{last=localStorage.getItem(WX_RAIN_NOTIFIED_KEY)||'';}catch(_){/* storage may be blocked */}
  if(last===risk.date||wxLastNotifiedDateMemory===risk.date)return;
  const chance=Number.isFinite(risk.probability)?`${Math.round(risk.probability)}% chance of rain`:'rain is forecast';
  const body=`${wxDayLabel(risk.date,risk.index)} (${dLong(risk.date)}): ${chance}, ${fmt(risk.precipitation,1)} mm expected. Check spraying and mowing plans.`;
  try{
    new Notification('Clover Greens · rain outlook',{body,tag:`clover-greens-rain-${risk.date}`,renotify:false});
    wxLastNotifiedDateMemory=risk.date;
    try{localStorage.setItem(WX_RAIN_NOTIFIED_KEY,risk.date);}catch(_){/* session notification still delivered */}
  }catch(e){console.warn('Could not display rain notification:',e);}
}
async function enableRainNotifications(){
  if(typeof Notification==='undefined'){toast('This browser does not support system notifications. The on-page rain alert remains available.','warn');return;}
  if(!window.isSecureContext){toast('Browser rain notifications require the dashboard to be served over HTTPS. The on-page rain alert remains available.','warn');return;}
  try{
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    updateRainNotificationButton();
    if(permission!=='granted'){toast('Rain notifications were not enabled. The seven-day alert line will still update.','warn');return;}
    toast('Rain notifications enabled while this dashboard is open.','ok');
    maybeNotifyRainForecast();
  }catch(e){toast('Could not enable rain notifications: '+(e.message||'permission unavailable'),'err');}
}
function wxDayLabel(date, idx) {
  if (idx===0) return 'Today'; if (idx===1) return 'Tomorrow';
  return new Date(date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'});
}
function wxRainDays() {
  const days=W && W.forecast && Array.isArray(W.forecast.days)?W.forecast.days:[];
  return days.map((d,i)=>({...d,index:i})).filter(d=>(Number.isFinite(d.probability)&&d.probability>=45)||num(d.precipitation)>=1||['rain','drizzle','storm'].includes(wxKind(d.code)));
}
function renderRainNotice() {
  const btn=$('#wxRainNotice'); if(!btn)return;
  if(!W || !W.forecast){btn.className='wx-rain-notice calm';btn.innerHTML=`<span class="material-symbols-rounded">${Wfail?'cloud_off':'cloud_sync'}</span><span class="wx-rain-label">${Wfail?'Rain forecast unavailable':'Checking rain forecast…'}</span>`;return;}
  const risk=wxRainDays().sort((a,b)=>a.index-b.index)[0];
  if(risk){
    const chance=Number.isFinite(risk.probability)?`${Math.round(risk.probability)}%`:`${fmt(risk.precipitation,1)} mm`;
    btn.className='wx-rain-notice rain-risk';btn.title=`Rain signal ${risk.date}: probability ${Number.isFinite(risk.probability)?Math.round(risk.probability)+'%':'not available'}, expected precipitation ${fmt(risk.precipitation,1)} mm. Forecast model, not a rain gauge.`;
    btn.innerHTML=`<span class="material-symbols-rounded">notifications_active</span><span class="wx-rain-label">Rain · ${esc(wxDayLabel(risk.date,risk.index))} · ${esc(chance)}</span>`;
  } else {
    btn.className='wx-rain-notice calm';btn.title='No significant rainfall signal in the current seven-day forecast.';
    btn.innerHTML='<span class="material-symbols-rounded">notifications_none</span><span class="wx-rain-label">Low rain signal · 7 days</span>';
  }
}
function renderWeather() {
  renderRainNotice(); updateRainNotificationButton();
  const widget=$('#wxWidget');
  if (!W) {
    $('#wxChip').innerHTML = `<span class="wx-text">${Wfail?'Weather unavailable':'Syncing weather…'}</span>`;
    if(widget) widget.innerHTML=`<div class="wx-loading">${Wfail?'Weather service could not be reached. No conditions are fabricated.':'Fetching the course weather model…'}</div>`;
    const strip=$('#wxForecastStrip'); if(strip)strip.innerHTML=`<div class="wx-loading">${Wfail?'Seven-day rain forecast unavailable.':'Forecast loading…'}</div>`;
    const alert=$('#wxForecastAlert'); if(alert){alert.className='wx-forecast-alert clear';alert.innerHTML='<span class="material-symbols-rounded">cloud_off</span><span>Rain alerts are unavailable until a fresh forecast loads.</span>';}
    return;
  }
  const forecastDays=W.forecast?.days||[];
  const stamp=$('#wxSourceStamp');
  if(stamp){const fetched=W.forecast?.fetchedAt;const when=fetched?new Date(fetched).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'time unknown';stamp.textContent=W.forecast?.stale?`Forecast stale · last successful update ${when}`:`Open-Meteo model · updated ${when}`;}
  const sig=JSON.stringify([W.temp,W.hum,W.wind,W.code,W.day,W.precip,forecastDays.map(d=>[d.date,d.code,d.probability,d.precipitation])]);
  const kind=wxKind(W.code), label=WX_LABEL[kind], a=advisory(W);
  $('#wxChip').innerHTML=`${wxIcon(kind,W.day)}<span class="vdiv"></span><span class="wx-text">${Math.round(W.temp)}°C · ${esc(label)}</span><span class="wx-text wx-hum">${Math.round(W.hum)}% RH</span><span class="wx-text wx-wind">${Math.round(W.wind)} km/h</span>`;
  if(sig!==wxSig){
    wxSig=sig;
    if(widget) widget.innerHTML=wxScene(kind,W.day,W.wind,Math.round(W.temp)+'°C',label)+
      `<div class="wx-stats"><div><div class="k">Humidity</div><div class="v">${Math.round(W.hum)}%</div></div><div><div class="k">Wind</div><div class="v">${Math.round(W.wind)} km/h</div></div><div><div class="k">Precip now</div><div class="v">${fmt(W.precip,1)} mm</div></div></div>`+
      `<div class="advice ${a.t}"><span class="material-symbols-rounded">${a.i}</span>${esc(a.m)}</div>`;
    const strip=$('#wxForecastStrip');
    if(strip) strip.innerHTML=forecastDays.length?forecastDays.slice(0,7).map((d,i)=>{
      const k=wxKind(d.code), prob=Number.isFinite(d.probability)?Math.round(d.probability):null, rain=num(d.precipitation), risk=(prob!==null&&prob>=45)||rain>=1||['rain','drizzle','storm'].includes(k);
      return `<article class="wx-day ${risk?'rain':''} ${i===0?'today':''}"><div class="wx-day-name">${esc(wxDayLabel(d.date,i))}</div><div class="wx-day-date">${esc(dShort(d.date))}</div>${wxIcon(k,true)}<div class="wx-day-temps">${Math.round(num(d.high))}° / ${Math.round(num(d.low))}°</div><div class="wx-day-rain"><span class="material-symbols-rounded">water_drop</span>${prob===null?'—':prob+'%'}</div><div class="wx-day-mm">${fmt(rain,1)} mm</div><div class="wx-rain-meter"><i style="width:${prob===null?0:Math.max(0,Math.min(100,prob))}%"></i></div></article>`;
    }).join(''):'<div class="wx-loading">No daily forecast was returned.</div>';
    const nearest=wxRainDays().sort((x,y)=>x.index-y.index)[0], alert=$('#wxForecastAlert');
    if(alert){
      if(nearest){const riskText=Number.isFinite(nearest.probability)?`${Math.round(nearest.probability)}% rain chance`:'rain is forecast';alert.className='wx-forecast-alert';alert.innerHTML=`<span class="material-symbols-rounded">notifications_active</span><span><b>Rain signal · ${esc(wxDayLabel(nearest.date,nearest.index))}, ${esc(dLong(nearest.date))}</b><br>${riskText}; expected precipitation ${fmt(nearest.precipitation,1)} mm. Consider rescheduling spraying and checking ground conditions before mowing.</span>`;}
      else {alert.className='wx-forecast-alert clear';alert.innerHTML='<span class="material-symbols-rounded">notifications_none</span><span>No significant rain signal in this seven-day model forecast. Check again before time-sensitive spraying or course work.</span>';}
    }
  }
  // Keep the notice current even if the current conditions stay the same.
  renderRainNotice();
  const nearest=wxRainDays().sort((a,b)=>a.index-b.index)[0];
  const notifySig=nearest?nearest.date:'none';
  if(nearest && wxForecastNotificationSignature && notifySig!==wxForecastNotificationSignature){
    toast(`Updated rain forecast: ${wxDayLabel(nearest.date,nearest.index)} · ${Number.isFinite(nearest.probability)?Math.round(nearest.probability)+'% chance':fmt(nearest.precipitation,1)+' mm forecast'}`,'warn');
  }
  wxForecastNotificationSignature=notifySig;
  maybeNotifyRainForecast();
}
async function loadWeather() {
  try {
    const endpoint=String(CONFIG.WEATHER_PROXY_URL||'').trim() || 'https://api.open-meteo.com/v1/forecast';
    const q=`latitude=${CONFIG.LAT}&longitude=${CONFIG.LNG}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day,precipitation&hourly=precipitation_probability,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&forecast_days=7&wind_speed_unit=kmh&timezone=auto`;
    const url=`${endpoint}${endpoint.includes('?')?'&':'?'}${q}`;
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
    let r; try { r=await fetch(url,{cache:'no-store',signal:controller.signal}); } finally { clearTimeout(timeout); }
    if(!r.ok)throw new Error(`weather ${r.status}`);
    const data=await r.json(); if(!data.current || !data.daily)throw new Error('incomplete forecast payload');
    const c=data.current, d=data.daily;
    const days=(d.time||[]).slice(0,7).map((date,i)=>({date,code:num(d.weather_code?.[i]),high:num(d.temperature_2m_max?.[i]),low:num(d.temperature_2m_min?.[i]),prob:Number.isFinite(d.precipitation_probability_max?.[i])?d.precipitation_probability_max[i]:null,precipitation:num(d.precipitation_sum?.[i]),windMax:num(d.wind_speed_10m_max?.[i])}));
    W={temp:c.temperature_2m,hum:c.relative_humidity_2m,wind:c.wind_speed_10m,code:c.weather_code,day:c.is_day===1,precip:c.precipitation||0,forecast:{days,timezone:data.timezone||'auto',fetchedAt:Date.now(),stale:false}}; Wfail=false;
  } catch(e) {
    console.warn('Course weather forecast unavailable:',e);
    Wfail=true;
    if(W?.forecast) W.forecast.stale=true;
  }
  renderWeather();
}

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
const AUTO_REORDER_POLICY = {
  Fuel: { leadDays: 3, floor: 10 },
  Fertilizers: { leadDays: 7, floor: 1 },
  Pesticides: { leadDays: 7, floor: 1 },
  'Turf Enhancements': { leadDays: 7, floor: 1 },
  'Spare Parts': { leadDays: 14, floor: 1 },
  Tools: { leadDays: 7, floor: 1 },
  Other: { leadDays: 7, floor: 1 }
};
let _reorderIndexVersion = -1, _reorderUsageIndex = new Map(), _reorderDetailCache = new Map();
const normItemName = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
function resolveInventoryItem(id, name, preferredCategory='') {
  if (id) { const byId=S.inventory.find(i=>i.id===String(id)); if(byId) return byId; }
  const n=normItemName(name); if(!n) return null;
  const candidates=S.inventory.filter(i=>normItemName(itemName(i))===n);
  if(preferredCategory){ const preferred=candidates.find(i=>String(i.category||'').toLowerCase()===preferredCategory.toLowerCase()); if(preferred) return preferred; }
  return candidates.length===1 ? candidates[0] : null;
}
function buildReorderUsageIndex() {
  if (_reorderIndexVersion === S._v) return;
  _reorderIndexVersion = S._v; _reorderUsageIndex = new Map(); _reorderDetailCache = new Map();
  const push=(item,date,qty,meta={})=>{ if(!item || !date || !(qty>0)) return; const arr=_reorderUsageIndex.get(item.id)||[]; arr.push({date,qty,...meta}); _reorderUsageIndex.set(item.id,arr); };
  // Fuel history is machine-aware and tied to exact Diesel/Petrol inventory masters.
  (S.fuel||[]).forEach(f=>{
    const date=fuelRecordDate(f), type=fuelTypeFromRecord(f), name=type==='Unspecified'?'':type;
    const item=resolveInventoryItem(null,name,'Fuel');
    const qty=Math.max(0,num(f.litres ?? f.quantity ?? f.qty ?? f.fuelLitres ?? f.fuelQuantity));
    if(item) push(item,date,qty,{machine:f.machineName||mName(f.machineId)||'Unknown machine',source:'fuel'});
  });
  // Turf usage counts issued/applied entries, never still-planned work.
  (S.plans||[]).forEach(p=>{
    const status=turfRecordStatus(p); if(!['Issued','Applied'].includes(status)) return;
    const date=turfRecordDate(p), item=turfProductForPlan(p) || resolveInventoryItem(p.productId ?? p.itemId ?? p.inventoryId,turfRecordProductName(p));
    if(!item || !isTurfCategory(item.category)) return;
    const qty=Math.max(0,turfRecordQuantity(p));
    if(qty>0) push(item,date,qty,{source:'turf'});
  });
  // Parts consumption in maintenance/general logs, when these fields exist in the current schema.
  [...(S.logs||[]),...(S.maintenance||[])].forEach(log=>{
    const date=normDate(log.date ?? log.logDate ?? log.maintenanceDate ?? log.reportedDate,log.timestamp ?? log.createdAt ?? log.createdOn ?? log.updatedAt ?? log.completedAt);
    const nested=log.partsConsumed ?? log.itemsConsumed ?? log.consumedItems ?? log.partsUsed ?? log.inventoryItems ?? [];
    if(Array.isArray(nested)) nested.forEach(part=>{
      const item=resolveInventoryItem(part.partId ?? part.itemId ?? part.productId ?? part.inventoryId ?? part.stockItemId, part.partName ?? part.itemName ?? part.productName ?? part.name);
      const qty=Math.max(0,num(part.qty ?? part.quantity ?? part.usedQty ?? part.consumedQty ?? part.quantityUsed));
      if(item && !isTurfCategory(item.category) && String(item.category||'').toLowerCase()!=='fuel') push(item,date,qty,{source:'parts'});
    });
    const directId=log.itemId ?? log.partId ?? log.productId ?? log.inventoryId;
    if(directId){
      const item=resolveInventoryItem(directId,log.itemName ?? log.partName ?? log.productName);
      const qty=Math.max(0,num(log.quantityOut ?? log.issuedQty ?? log.qtyIssued ?? log.quantityUsed ?? log.qty ?? log.quantity));
      if(item && !isTurfCategory(item.category) && String(item.category||'').toLowerCase()!=='fuel') push(item,date,qty,{source:'parts'});
    }
  });
}
function autoReorderDetails(item) {
  buildReorderUsageIndex();
  if(_reorderDetailCache.has(item.id)) return _reorderDetailCache.get(item.id);
  const category=turfCategoryLabel(item.category)!=='Other'?turfCategoryLabel(item.category):String(item.category||'Other').trim();
  const key=AUTO_REORDER_POLICY[category]?category:'Other', policy=AUTO_REORDER_POLICY[key];
  const end=today(), start=addDays(end,-89), events=(_reorderUsageIndex.get(item.id)||[]).filter(e=>e.date>=start && e.date<=end);
  const earliest=events.length?events.map(e=>e.date).sort()[0]:start;
  const observedStart=earliest>start?earliest:start, observedDates=daysBetween(observedStart,end);
  const daily=new Map(observedDates.map(d=>[d,0]));
  events.forEach(e=>daily.set(e.date,(daily.get(e.date)||0)+e.qty));
  const values=[...daily.values()], total=values.reduce((a,b)=>a+b,0), mean=total/Math.max(1,values.length);
  const variance=values.reduce((a,v)=>a+Math.pow(v-mean,2),0)/Math.max(1,values.length), sd=Math.sqrt(variance);
  const activeDays=new Set(events.map(e=>e.date)).size;
  const reliable=events.length>=3 && activeDays>=3 && observedDates.length>=14;
  const legacy=Math.max(0,num(item.reorderLevel));
  const raw=reliable ? mean*policy.leadDays + 1.28*sd*Math.sqrt(policy.leadDays) : Math.max(legacy,policy.floor);
  const unit=String(item.unit||item.uom||item.stockUnit||'').toLowerCase();
  const integerUnit=/^(nos?|pieces?|pcs?|packs?|bags?|sets?|units?)$/.test(unit);
  const level=reliable ? (integerUnit?Math.ceil(raw):Math.ceil(raw*10)/10) : Math.max(legacy,policy.floor);
  const details={level,leadDays:policy.leadDays,meanDaily:mean,totalUsage:total,windowDays:observedDates.length,transactions:events.length,activeDays,reliable,method:reliable?`${observedDates.length}-day demand + safety buffer`:'Provisional floor',daysCover:mean>0?Math.max(0,num(item.stockQuantity))/mean:null,events};
  _reorderDetailCache.set(item.id,details); return details;
}
function effectiveReorderLevel(item) { return autoReorderDetails(item).level; }
function renderOperationalIntelligence(t=today()) {
  const days=daysBetween(addDays(t,-29),t), fromWeek=addDays(t,-6), priorStart=addDays(t,-13), priorEnd=addDays(t,-7);
  const perMachineDay=new Map(), machineWeek=new Map(), hoursByMachineDay=new Map(), weekdayTotals=Array.from({length:7},()=>({litres:0,days:0}));
  days.forEach(d=>{const dow=new Date(d+'T12:00:00').getDay();weekdayTotals[dow].days++;});
  (S.shifts||[]).forEach(shift=>{const d=shift._d||normDate(shift.shiftDate,shift.timestamp??shift.startTime??shift.endTime);if(!d||d<days[0]||d>t)return;const key=mKey(shift.machineId||shift.machineName||shift.assetName);const dk=key+'|'+d;hoursByMachineDay.set(dk,(hoursByMachineDay.get(dk)||0)+Math.max(0,num(shift.engineHoursLogged??shift.engineHours??shift.hoursWorked)));});
  (S.fuel||[]).forEach(f=>{
    const d=fuelRecordDate(f); if(!d || d<days[0] || d>t) return;
    const liters=Math.max(0,num(f.litres ?? f.quantity ?? f.qty ?? f.fuelLitres ?? f.fuelQuantity));
    const name=f.machineName || mName(f.machineId) || 'Unassigned machine';
    const key=mKey(f.machineId||f.machineName||name);
    const dk=key+'|'+d, cur=perMachineDay.get(dk)||{key,name,date:d,litres:0,records:0}; cur.litres+=liters; cur.records++; perMachineDay.set(dk,cur);
    const dow=new Date(d+'T12:00:00').getDay(); weekdayTotals[dow].litres+=liters;
    const wk=machineWeek.get(key)||{key,name,current:0,prior:0,recordsCurrent:0,recordsPrior:0};
    if(d>=fromWeek){wk.current+=liters;wk.recordsCurrent++;} else if(d>=priorStart && d<=priorEnd){wk.prior+=liters;wk.recordsPrior++;}
    machineWeek.set(key,wk);
  });
  const dailyRows=[...perMachineDay.values()].sort((a,b)=>b.litres-a.litres);
  dailyRows.forEach(row=>{row.hours=hoursByMachineDay.get(row.key+'|'+row.date)||0;row.issuePerHour=row.hours>0?row.litres/row.hours:null;});
  const baselineByMachine=new Map();dailyRows.filter(row=>row.hours>0).forEach(row=>{const b=baselineByMachine.get(row.key)||{name:row.name,litres:0,hours:0,rates:[]};b.litres+=row.litres;b.hours+=row.hours;b.rates.push(row.issuePerHour);baselineByMachine.set(row.key,b);});
  const issueHourOutliers=[];dailyRows.forEach(row=>{const b=baselineByMachine.get(row.key);if(!b||b.rates.length<4||row.hours<0.75||row.issuePerHour===null)return;const rates=b.rates.slice().sort((a,b)=>a-b),mid=Math.floor(rates.length/2),median=rates.length%2?rates[mid]:(rates[mid-1]+rates[mid])/2;if(median>0&&row.issuePerHour>median*1.6)issueHourOutliers.push({...row,baseline:median});});
  issueHourOutliers.sort((a,b)=>(b.issuePerHour/b.baseline)-(a.issuePerHour/a.baseline));
  const weekdayRows=weekdayTotals.map((v,i)=>({day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],avg:v.days?v.litres/v.days:0,total:v.litres,days:v.days})).sort((a,b)=>b.avg-a.avg);
  const maxDay=dailyRows[0], topWeekday=weekdayRows[0];
  const issueDaysWithoutHours=dailyRows.filter(row=>row.litres>0 && row.hours<=0);
  const changes=[...machineWeek.values()].filter(x=>x.current>0&&x.prior>0&&x.recordsCurrent>=2).map(x=>({...x,change:(x.current-x.prior)/x.prior*100})).sort((a,b)=>b.change-a.change);
  const spike=changes.find(x=>x.change>=30), drop=changes.find(x=>x.change<=-30);
  const reliableFuel=(S.fuel||[]).filter(f=>fuelRecordDate(f)>=days[0]&&fuelRecordDate(f)<=t);
  const machineHtml=reliableFuel.length<3 ? '<div class="ops-intel-message">Not enough dated fuel issues to compare machine/day patterns yet. The dashboard will build a baseline as real issues are logged.</div>' :
    `<div class="ops-intel-stat-grid"><div class="ops-intel-stat"><small>Highest machine-day issue</small><b>${maxDay?`${fmt(maxDay.litres,1)} L`:'—'}</b><small>${maxDay?`${esc(maxDay.name)} · ${dShort(maxDay.date)}`:'No issues recorded'}</small></div><div class="ops-intel-stat"><small>Highest average weekday</small><b>${topWeekday?`${fmt(topWeekday.avg,1)} L/day`:'—'}</b><small>${topWeekday?`${topWeekday.day} · last 30 days`:'No baseline'}</small></div><div class="ops-intel-stat"><small>Issue/runtime outliers</small><b>${issueHourOutliers.length}</b><small>Compared with machine median L/hr</small></div></div>`+
    (issueDaysWithoutHours.length?`<div class="ops-intel-message alert">${issueDaysWithoutHours.length} machine-day(s) had a fuel issue but no matching same-day engine-hour entry. Check timing, missing shifts or whether fuel was issued for later use.</div>`:'')+
    (issueHourOutliers.length?`<div class="ops-intel-message warn">Issue/runtime signal: <b>${esc(issueHourOutliers[0].name)}</b> has ${fmt(issueHourOutliers[0].issuePerHour,2)} L issued per logged engine hour on ${dLong(issueHourOutliers[0].date)}, above its recent median of ${fmt(issueHourOutliers[0].baseline,2)} L/h. Fuel issue timing and tank refills can skew this; review records and runtime before concluding anything.</div>`:'')+
    (spike?`<div class="ops-intel-message warn">Usage signal: <b>${esc(spike.name)}</b> issued ${fmt(spike.current,1)} L in the last 7 days, up ${fmt(spike.change,0)}% versus the prior 7 days. Review run hours and issue notes before drawing conclusions.</div>`:drop?`<div class="ops-intel-message">${esc(drop.name)} recorded ${fmt(Math.abs(drop.change),0)}% less fuel this week than the prior week. Check whether operating hours or work assignments also changed.</div>`:`<div class="ops-intel-message">No machine's last-week fuel total is 30% or more above its preceding-week baseline, based on available logs. Compare litres with engine hours before treating a change as abnormal.</div>`);
  setHTML($('#opsMachineDayIntel'), machineHtml);
  const itemRows=S.inventory.map(i=>({item:i,reorder:autoReorderDetails(i)}));
  const urgent=itemRows.filter(x=>num(x.item.stockQuantity)<=x.reorder.level || (x.reorder.daysCover!==null && x.reorder.daysCover<x.reorder.leadDays)).sort((a,b)=>{
    const ra=Math.max(1,a.reorder.level), rb=Math.max(1,b.reorder.level);return (num(a.item.stockQuantity)/ra)-(num(b.item.stockQuantity)/rb);
  }).slice(0,6);
  const historyCount=itemRows.filter(x=>x.reorder.reliable).length;
  const reorderHtml=!S.inventory.length?'<div class="ops-intel-message">Add products to the Inventory Master. Automatic levels will be computed once the item is linked to actual usage records.</div>':
    `${urgent.length?urgent.map(({item,reorder})=>`<div class="ops-intel-row"><div class="ops-intel-main"><b>${esc(itemName(item))}</b><small>${esc(item.category||'Other')} · ${reorder.reliable?`${reorder.activeDays} use-days / ${reorder.windowDays}-day window · ${reorder.leadDays}-day lead time`:`Provisional threshold · ${reorder.leadDays}-day policy lead time`}</small></div><div class="ops-intel-value">${fmt(item.stockQuantity,2)} / ${fmt(reorder.level,2)} ${esc(item.unit||'units')}<small>${num(item.stockQuantity)<=reorder.level?'Reorder attention':'Coverage watch'}</small></div></div>`).join(''):'<div class="ops-intel-message">No items are currently below their calculated reorder threshold or projected to run out within policy lead time.</div>'}`+
    `<div class="ops-intel-message ${historyCount?'':'alert'}">${historyCount} of ${S.inventory.length} item(s) have enough dated usage history (at least 3 issue days across a 14+ day observation window). Other items use a provisional floor until history improves. Auto-reorder levels recalculate as records update.</div>`;
  setHTML($('#opsAutoReorderIntel'),reorderHtml);
  renderTurfUsageIntelligence(t);
}


function renderTurfUsageIntelligence(t=today()) {
  const target=$('#opsTurfUsageIntel'); if(!target)return;
  const from=addDays(t,-29), weekdayCounts=Array.from({length:7},()=>({logs:0,days:0}));
  daysBetween(from,t).forEach(d=>weekdayCounts[new Date(d+'T12:00:00').getDay()].days++);
  const rows=(S.plans||[]).map(p=>{
    const date=turfRecordDate(p), status=turfRecordStatus(p), item=turfProductForPlan(p);
    const category=turfCategoryLabel(p.category||item?.category||'');
    const name=turfRecordProductName(p)||itemName(item||{});
    const unit=String(p.unit||p.stockUnit||p.uom||p.unitOfMeasure||item?.unit||item?.stockUnit||item?.uom||'').trim();
    const qty=Math.max(0,turfRecordQuantity(p));
    return {p,date,status,item,category,name,unit,qty};
  }).filter(x=>x.date>=from&&x.date<=t&&['Issued','Applied'].includes(x.status)&&['Fertilizers','Pesticides','Turf Enhancements'].includes(x.category));
  const byProduct=new Map();
  rows.forEach(r=>{
    const key=(r.item?.id||r.name.toLowerCase())+'|'+r.unit;
    const v=byProduct.get(key)||{name:r.name,category:r.category,unit:r.unit,qty:0,records:0,days:new Set()};
    v.qty+=r.qty;v.records++;v.days.add(r.date);byProduct.set(key,v);
    weekdayCounts[new Date(r.date+'T12:00:00').getDay()].logs++;
  });
  const top=[...byProduct.values()].sort((a,b)=>b.records-a.records||b.qty-a.qty)[0];
  const peak=weekdayCounts.map((v,i)=>({day:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i],avg:v.days?v.logs/v.days:0,logs:v.logs})).sort((a,b)=>b.avg-a.avg)[0];
  const cats=['Fertilizers','Pesticides','Turf Enhancements'].map(category=>({category,count:rows.filter(r=>r.category===category).length}));
  if(!LOADED.plans){target.innerHTML='<div class="ops-intel-message">Waiting for application/issue records from Firebase.</div>';return;}
  if(!rows.length){target.innerHTML='<div class="ops-intel-message">No issued/applied turf-product records were found in the last 30 days. Planned jobs are excluded. Confirm the app writes transaction records with a date, product and issued/applied status.</div>';return;}
  target.innerHTML=`<div class="ops-intel-stat-grid"><div class="ops-intel-stat"><small>Issued/applied records</small><b>${rows.length}</b><small>Last 30 days</small></div><div class="ops-intel-stat"><small>Most frequent product</small><b>${esc(top?.name||'—')}</b><small>${top?`${top.records} record(s) · ${fmt(top.qty,2)} ${esc(top.unit||'units')}`:'No linked product'}</small></div><div class="ops-intel-stat"><small>Busiest weekday</small><b>${peak?.day||'—'}</b><small>${peak?`${fmt(peak.avg,1)} records per ${peak.day}`:''}</small></div></div>`+
    `<div class="ops-intel-category-counts">${cats.map(c=>`<div class="ops-intel-message"><b>${esc(c.category)}</b><br>${c.count} issued/applied record(s)</div>`).join('')}</div>`+
    `<div class="ops-intel-message">Counts use logged status and dates; product quantities stay in their original units. A plan marked Applied is a recorded status, not independent proof of physical application.</div>`;
}

function renderOverview() {
  const t = today(), month = monthStart(t), weekStart = addDays(t, -6);
  const monthFuel = fuelIn(month, t).slice().sort(sortFuel);
  const todayFuel = fuelIn(t, t);
  const weekFuel = fuelIn(weekStart, t);
  const turfDate = p => turfRecordDate(p);
  const monthPlans = (S.plans || []).filter(p => { const d=turfDate(p); return d && d >= month && d <= t; });
  const fuelLitres = rows => rows.reduce((a, f) => a + Math.max(0, num(f.litres ?? f.quantity ?? f.qty)), 0);
  const machineTotals = new Map();
  monthFuel.forEach(f => {
    const name = f.machineName || mName(f.machineId) || 'Unassigned machine';
    const key = String(name);
    const item = machineTotals.get(key) || { name:key, litres:0, records:0 };
    item.litres += Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); item.records++;
    machineTotals.set(key, item);
  });
  const topMachines = [...machineTotals.values()].sort((a,b)=>b.litres-a.litres).slice(0,5);
  const recentFuel = monthFuel.slice(0,5);
  const days = daysBetween(weekStart, t);
  const litresByDay = {};
  weekFuel.forEach(f => { const d=fuelRecordDate(f); litresByDay[d] = (litresByDay[d] || 0) + Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); });
  const fuelUnits = fuelLitres(monthFuel);
  const fuelIssuedMTD = { Diesel: 0, Petrol: 0 };
  monthFuel.forEach(f => { const type = fuelTypeFromRecord(f); if (type in fuelIssuedMTD) fuelIssuedMTD[type] += Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); });
  const fuelIssuedToday = { Diesel: 0, Petrol: 0 };
  todayFuel.forEach(f => { const type = fuelTypeFromRecord(f); if (type in fuelIssuedToday) fuelIssuedToday[type] += Math.max(0, num(f.litres ?? f.quantity ?? f.qty)); });
  $('#opsPeriod').textContent = `${MON[+t.slice(5,7)-1].toUpperCase()} ${t.slice(0,4)} · MONTH TO DATE`;
  updateDayCostCards(t);

  // Category-aware turf insights. Prefer the category saved on the plan; fall back to the linked inventory item.
  const categoryForPlan = p => {
    const label = turfPlanCategory(p);
    if (label === 'Fertilizers') return 'fertilizer';
    if (label === 'Pesticides') return 'pesticide';
    if (label === 'Turf Enhancements') return 'enhancer';
    return '';
  };
  const categories = [
    {key:'fertilizer', label:'Fertilizers', ids:['opsFertilizerStats','opsFertilizerTrend','opsFertilizerRecent']},
    {key:'pesticide', label:'Pesticides', ids:['opsPesticideStats','opsPesticideTrend','opsPesticideRecent']},
    {key:'enhancer', label:'Turf Enhancers', ids:['opsEnhancerStats','opsEnhancerTrend','opsEnhancerRecent']}
  ];
  const allPlans = (S.plans || []).filter(p => { const d=turfRecordDate(p); return d && d <= t && categoryForPlan(p); });
  const weekPlans = allPlans.filter(p => turfRecordDate(p) >= weekStart);
  const monthTurfRows = monthPlans.filter(p => categoryForPlan(p));
  const appliedTurfRows = monthTurfRows.filter(p => ['Applied','Issued'].includes(turfRecordStatus(p))); 
  const overdueTurfRows = allPlans.filter(p => turfRecordStatus(p) === 'Planned' && turfRecordDate(p) < t);
  setHTML($('#opsFuelDomainStats'), [
    {label:'Diesel · today',value:LOADED.fuel ? `${fmt(fuelIssuedToday.Diesel,1)} L` : '—',foot:`${todayFuel.filter(f=>fuelTypeFromRecord(f)==='Diesel').length} issue record(s)`},
    {label:'Petrol · today',value:LOADED.fuel ? `${fmt(fuelIssuedToday.Petrol,1)} L` : '—',foot:`${todayFuel.filter(f=>fuelTypeFromRecord(f)==='Petrol').length} issue record(s)`},
    {label:'Total issued · MTD',value:LOADED.fuel ? `${fmt(fuelUnits,1)} L` : '—',foot:`${monthFuel.length} issue record(s) this month`}
  ].map(k=>`<div class="ops-domain-kpi"><span>${esc(k.label)}</span><b>${esc(k.value)}</b><small>${esc(k.foot)}</small></div>`).join(''));
  setHTML($('#opsTurfDomainStats'), [
    {label:'Application records',value:LOADED.plans ? fmt(monthTurfRows.length,0) : '—',foot:'Month to date'},
    {label:'Issued / applied',value:LOADED.plans ? fmt(appliedTurfRows.length,0) : '—',foot:'Movement or application status recorded'},
    {label:'Past due',value:LOADED.plans ? fmt(overdueTurfRows.length,0) : '—',foot:'Not marked applied'}
  ].map(k=>`<div class="ops-domain-kpi"><span>${esc(k.label)}</span><b>${esc(k.value)}</b><small>${esc(k.foot)}</small></div>`).join(''));

  // Planned-versus-issued reconciliation by product and scheduled date. Quantities remain grouped by unit.
  const compareRows = monthPlans.filter(p => categoryForPlan(p) && turfRecordStatus(p) !== 'Cancelled' && turfRecordDate(p) === today());
  const hasPlannedQuantity = p => ['targetQty','plannedQty','requestedQty','plannedQuantity','targetQuantity'].some(k => p[k] !== undefined && p[k] !== null && p[k] !== '');
  // Keep the planned amount visible even when the same plan record transitions to Issued/Applied.
  const plannedRows = compareRows.filter(p => hasPlannedQuantity(p) || turfRecordStatus(p) === 'Planned');
  const issuedRows = compareRows.filter(p => ['Issued','Applied'].includes(turfRecordStatus(p)) || num(p.issuedQty ?? p.issuedQuantity ?? p.issueQty ?? p.issueQuantity ?? p.quantityIssued ?? p.qtyIssued ?? p.quantityOut ?? p.qtyOut) > 0);
  const unitLabel = p => String(p.unit ?? p.stockUnit ?? p.unitOfMeasure ?? (turfProductForPlan(p)||{}).unit ?? 'unit not set').trim();
  const plannedKeys = new Set(plannedRows.map(p=>`${turfRecordDate(p)}|${turfRecordProductName(p).toLowerCase()}`));
  const outsidePlan = issuedRows.filter(p => {
    const linked = p.planId || p.plannedRecordId || p.plannedApplicationId || p.sourcePlanId;
    if (linked) return false;
    const key = `${turfRecordDate(p)}|${turfRecordProductName(p).toLowerCase()}`;
    // Same record can be converted from Planned to Issued, so an explicit plan reference counts as planned.
    const explicitUnplanned = p.wasPlanned === false || p.fromPlan === false || p.planned === false || p.unplanned === true || p.isUnplanned === true || /manual|unplanned|ad hoc/i.test(String(p.source || p.sourceType || p.issueSource || ''));
    const separateIssueRecord = Boolean(p.issueId || p.transactionId || p.transactionType || p.movementType || p.issueStatus || p.issuedAt || p.issuedDate || p.issueDate);
    return explicitUnplanned || (separateIssueRecord && !plannedKeys.has(key) && !(p.wasPlanned === true || p.fromPlan === true || p.planned === true));
  });

  // Compare quantities product-by-product so different stock units are never combined into a misleading total.
  const productCompare = new Map();
  const addCompareLine = (p, bucket) => {
    const product = turfProductForPlan(p);
    const id = p.productId ?? p.productID ?? p.itemId ?? p.inventoryId ?? (product && product.id);
    const name = turfRecordProductName(p) || (product ? itemName(product) : 'Unspecified product');
    const unit = unitLabel(p) || 'unit not set';
    const nameKey = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    const key = `${(product && product.id) || id || nameKey}|${unit.toLowerCase()}`;
    if (!productCompare.has(key)) productCompare.set(key, { name, unit, category: turfPlanCategory(p), plannedQty: 0, issuedQty: 0, plannedRecords: 0, issuedRecords: 0 });
    const row = productCompare.get(key);
    const plannedQty = num(p.targetQty ?? p.plannedQty ?? p.requestedQty ?? p.plannedQuantity ?? p.targetQuantity ?? (turfRecordStatus(p) === 'Planned' ? (p.quantity ?? p.qty) : 0));
    const issuedQty = num(p.issuedQty ?? p.issuedQuantity ?? p.issueQty ?? p.issueQuantity ?? p.quantityIssued ?? p.qtyIssued ?? p.quantityOut ?? p.qtyOut ?? (['Issued','Applied'].includes(turfRecordStatus(p)) ? (p.actualQty ?? p.appliedQty ?? p.applicationQty ?? p.quantityUsed ?? p.usedQuantity ?? p.qtyUsed ?? p.dispensedQty ?? p.quantity ?? p.qty ?? p.targetQty ?? p.plannedQty ?? p.requestedQty ?? p.plannedQuantity ?? p.targetQuantity) : 0));
    row.plannedQty += bucket === 'planned' ? Math.max(0, plannedQty) : 0;
    row.issuedQty += bucket === 'issued' ? Math.max(0, issuedQty) : 0;
    row[bucket === 'planned' ? 'plannedRecords' : 'issuedRecords'] += 1;
    if (row.category === 'Other' && turfPlanCategory(p) !== 'Other') row.category = turfPlanCategory(p);
  };
  plannedRows.forEach(p => addCompareLine(p, 'planned'));
  issuedRows.forEach(p => addCompareLine(p, 'issued'));
  const productCompareRows = [...productCompare.values()].sort((a,b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  const compare = $('#opsPlanIssueCompare');
  const periodLabel = $('#opsPlanIssuePeriod'); if (periodLabel) periodLabel.textContent = `Today · ${dShort(today())}`;
  if (compare) {
    compare.innerHTML = !LOADED.plans
      ? '<div class="ops-product-compare-empty">Loading planned and issued records…</div>'
      : productCompareRows.length
        ? `<div class="ops-product-compare-table" role="table" aria-label="Planned and issued turf products this month">
            <div class="ops-product-compare-head" role="row"><span role="columnheader">Product</span><span role="columnheader">Planned qty</span><span role="columnheader">Issued qty</span></div>
            ${productCompareRows.map(row => `<div class="ops-product-compare-row" role="row">
              <div class="ops-product-compare-name" role="cell"><span class="ops-product-compare-mark ${turfCategoryClass(row.category)}" aria-hidden="true"></span><div><b title="${esc(row.name)}">${esc(row.name)}</b><small>${esc(row.category)}</small></div></div>
              <div class="ops-product-compare-qty planned" role="cell"><b>${fmt(row.plannedQty,2)} <small>${esc(row.unit)}</small></b></div>
              <div class="ops-product-compare-qty issued" role="cell"><b>${fmt(row.issuedQty,2)} <small>${esc(row.unit)}</small></b></div>
            </div>`).join('')}
          </div>`
        : '<div class="ops-product-compare-empty">No planned or issued turf products recorded this month.</div>';
  }
  const outside = $('#opsUnplannedIssues');
  if (outside) outside.innerHTML = !LOADED.plans ? 'Waiting for turf records' : outsidePlan.length ? outsidePlan.slice(0,5).map(p=>`<div class="ops-unplanned-row"><b>${esc(turfRecordProductName(p)||'Unnamed product')}</b><span>${esc(turfRecordDate(p)||'Date missing')} · ${fmt(turfRecordQuantity(p),2)} ${esc(unitLabel(p))}</span></div>`).join('') + (outsidePlan.length>5?`<small>+${outsidePlan.length-5} more</small>`:'') : '<span class="ops-no-unplanned">No unplanned issues detected in the current month.</span>';

  setHTML($('#opsFuelTrend'), barChart(days.map(d=>({label:dShort(d),value:litresByDay[d]||0})), {unit:'L'}));
  const fuelMasterMatches = type => S.inventory.filter(i => itemName(i).trim().toLowerCase() === type.toLowerCase());
  const fuelMasterMarkup = ['Diesel','Petrol'].map(type => {
    const matches = fuelMasterMatches(type);
    const issued = fuelIssuedMTD[type] || 0;
    const issuedToday = fuelIssuedToday[type] || 0;
    if (!matches.length) return `<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${type}</div><div class="ops-list-meta">Not in Inventory Master yet · add name exactly as shown, category Fuel, unit Litre</div></div><div class="ops-list-value">${fmt(issued,1)} L<small>Today: ${fmt(issuedToday,1)} L</small></div></div>`;
    if (matches.length > 1) return `<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${type}</div><div class="ops-list-meta" style="color:var(--warn)">Multiple matching inventory items (${matches.length}); keep one master item per fuel type.</div></div><div class="ops-list-value">${fmt(issued,1)} L<small>Today: ${fmt(issuedToday,1)} L</small></div></div>`;
    const item = matches[0], stock = Math.max(0, num(item.stockQuantity)), reorder = effectiveReorderLevel(item);
    const unit = item.unit || 'unit not set';
    const low = stock <= reorder;
    return `<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(type)} <span class="badge ${low?'warn':'ok'}">${low?'Reorder':'Stock available'}</span></div><div class="ops-list-meta">On hand: ${fmt(stock,2)} ${esc(unit)} · Reorder at ${fmt(reorder,2)} ${esc(unit)}</div></div><div class="ops-list-value">${fmt(issued,1)} L<small>Today: ${fmt(issuedToday,1)} L</small></div></div>`;
  }).join('');
  setHTML($('#opsFuelInventory'), fuelMasterMarkup);
  setHTML($('#opsFuelMachines'), topMachines.length ? topMachines.map(m=>`<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(m.name)}</div><div class="ops-list-meta">${m.records} issue record(s)</div></div><div class="ops-list-value">${fmt(m.litres,1)} L</div></div>`).join('') : '<div class="ops-empty">No fuel issue records for this month.</div>');
  setHTML($('#opsRecentFuel'), recentFuel.length ? recentFuel.map(f=>`<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(f.machineName || mName(f.machineId) || 'Unassigned machine')}</div><div class="ops-list-meta">${dShort(f._d)}${timeOf(tsMs(f.timestamp))?' · '+timeOf(tsMs(f.timestamp)):''} · ${esc(fuelTypeFromRecord(f))}${f.issuedBy?' · '+esc(f.issuedBy):''}</div></div><div class="ops-list-value">${fmt(num(f.litres ?? f.quantity ?? f.qty),1)} L</div></div>`).join('') : '<div class="ops-empty">No fuel issue records yet.</div>');

  categories.forEach(cat => {
    const rows = monthPlans.filter(p => categoryForPlan(p) === cat.key);
    const appliedRows = rows.filter(p => turfRecordStatus(p) === 'Applied');
    const issuedRows = rows.filter(p => turfRecordStatus(p) === 'Issued');
    const plannedRows = rows.filter(p => turfRecordStatus(p) === 'Planned');
    const overdueRows = plannedRows.filter(p => turfRecordDate(p) && turfRecordDate(p) < t);
    const issuedByUnit = new Map();
    issuedRows.forEach(p => {
      const product = turfProductForPlan(p);
      const unit = String(p.unit || p.stockUnit || (product && product.unit) || 'Unit not set').trim();
      issuedByUnit.set(unit, (issuedByUnit.get(unit) || 0) + turfRecordQuantity(p));
    });
    const issuedSummary = [...issuedByUnit.entries()].map(([unit,qty]) => `${fmt(qty,2)} ${unit}`).join(' · ') || 'No issue quantities recorded';
    const recent = rows.slice().sort((a,b)=>turfRecordDate(b).localeCompare(turfRecordDate(a)) || tsMs(b.createdAt ?? b.timestamp)-tsMs(a.createdAt ?? a.timestamp)).slice(0,4);
    const trend = days.map(d => ({label:dShort(d),value:weekPlans.filter(p=>categoryForPlan(p)===cat.key && turfRecordDate(p)===d).length}));
    setHTML($('#'+cat.ids[0]), `<div class="ops-status-grid"><div class="ops-status-cell"><div class="ops-status-num">${LOADED.plans?fmt(rows.length,0):'—'}</div><div class="ops-status-label">Records · MTD</div></div><div class="ops-status-cell"><div class="ops-status-num">${LOADED.plans?fmt(appliedRows.length,0):'—'}</div><div class="ops-status-label">Applied</div></div><div class="ops-status-cell"><div class="ops-status-num">${LOADED.plans?fmt(issuedRows.length,0):'—'}</div><div class="ops-status-label">Issued</div></div></div><div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">Issued quantity · MTD</div><div class="ops-list-meta">${esc(issuedSummary)}</div></div><div class="ops-list-value">${issuedRows.length}</div></div><div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">Planned / overdue</div><div class="ops-list-meta">Planned records past their scheduled date</div></div><div class="ops-list-value" style="${overdueRows.length?'color:var(--warn)':''}">${plannedRows.length} / ${overdueRows.length}</div></div>`);
    setHTML($('#'+cat.ids[1]), barChart(trend, {unit:'records'}));
    setHTML($('#'+cat.ids[2]), recent.length ? recent.map(p=>`<div class="ops-list-row"><div class="ops-list-main"><div class="ops-list-title">${esc(turfRecordProductName(p) || 'Unspecified product')}</div><div class="ops-list-meta">${dShort(turfRecordDate(p))} · ${esc(p.targetArea || p.area || p.location || 'Course')} · ${esc(turfRecordStatus(p))}</div></div><div class="ops-list-value">${fmt(turfRecordQuantity(p),1)} ${esc(p.unit || p.stockUnit || 'units')}</div></div>`).join('') : `<div class="ops-empty">No ${cat.label.toLowerCase()} logs for this month.</div>`);
  });
  renderOperationalIntelligence(t);
  renderTurfAreaPlanDashboard(); // Keep the dashboard area summary in sync with the live plan collection.
}
const sortFuel = (a, b) => fuelRecordDate(b).localeCompare(fuelRecordDate(a)) || tsMs(b.timestamp ?? b.createdAt) - tsMs(a.timestamp ?? a.createdAt);

/* Daily costs use transaction rates or Inventory Master unit costs only.
   No local ROI assumptions or placeholder fuel prices are used here. */
function fuelTypeForCost(f) {
  return fuelTypeFromRecord(f);
}
function fuelMasterRate(type) {
  if (!type || type === 'Unspecified') return { rate: 0, source: 'Fuel type unspecified' };
  const sameName = S.inventory.filter(i => itemName(i).trim().toLowerCase() === type.toLowerCase());
  const fuelItems = sameName.filter(i => String(i.category || '').trim().toLowerCase() === 'fuel');
  const matches = fuelItems.length ? fuelItems : (sameName.length === 1 ? sameName : []);
  if (matches.length !== 1) return { rate: 0, source: matches.length > 1 ? 'Duplicate fuel master item' : 'Fuel master rate missing' };
  const rate = num(matches[0].unitCost);
  return rate > 0 ? { rate, source: 'Inventory Master' } : { rate: 0, source: 'Fuel unit cost not set' };
}
function fuelCostLine(f) {
  const qty = Math.max(0, num(f.litres ?? f.quantity ?? f.qty));
  const transactionRate = num(f.ratePerLitre ?? f.fuelRate ?? f.unitPrice ?? f.pricePerLitre);
  const fallback = transactionRate > 0 ? null : fuelMasterRate(fuelTypeForCost(f));
  const rate = transactionRate > 0 ? transactionRate : (fallback ? fallback.rate : 0);
  return { record: f, date: f._d || today(), time: timeOf(tsMs(f.timestamp)), name: f.machineName || mName(f.machineId) || 'Unassigned machine', category: fuelTypeForCost(f), qty, unit: 'L', rate, cost: rate > 0 ? qty * rate : null, source: transactionRate > 0 ? 'Transaction rate' : (fallback ? fallback.source : 'Transaction rate') };
}
function turfCostLine(p) {
  const product = turfProductForPlan(p);
  const category = turfPlanCategory(p);
  const status = turfRecordStatus(p);
  const stockUnit = String(product && (product.unit ?? product.stockUnit ?? product.uom ?? product.unitOfMeasure) || '').trim();
  const unit = String(p.unit ?? p.stockUnit ?? p.uom ?? p.unitOfMeasure ?? stockUnit ?? '').trim();
  const unitMatches = !!(unit && stockUnit && unit.toLowerCase() === stockUnit.toLowerCase());
  const rate = product ? Math.max(0, num(product.unitCost ?? product.unitRate ?? product.costPerUnit ?? product.rate)) : 0;
  const qty = Math.max(0, turfRecordQuantity(p));
  const rateUsable = !!(product && rate > 0 && unitMatches);
  const cost = ['Applied','Issued'].includes(status) && rateUsable ? qty * rate : null;
  let source = !product ? 'Product not linked to Inventory Master' : !unitMatches ? 'Unit missing or mismatch' : rate <= 0 ? 'Product unit cost not set' : 'Inventory Master';
  return { record: p, date: turfRecordDate(p), time: timeOf(tsMs(p.issuedAt ?? p.issueTimestamp ?? p.appliedAt ?? p.completedAt ?? p.timestamp ?? p.createdAt ?? p.createdTime)), name: turfRecordProductName(p) || (product ? itemName(product) : 'Unspecified product'), category, status, qty, unit: unit || stockUnit || 'Unit not set', rate, cost, source, countable: ['Applied','Issued'].includes(status) }; 
}
function dayFuelCostLines(day = today()) {
  return fuelIn(day, day).slice().sort(sortFuel).map(fuelCostLine);
}
function dayMaintenanceCostLines(day = today()) {
  return (S.maintenance || []).filter(r => {
    const date = r.date || r.maintenanceDate || r.serviceDate || normDate(null, r.timestamp);
    const raw = [r.totalCost, r.cost, r.amount, r.serviceCost].find(v => v !== undefined && v !== null && v !== '');
    return date === day && raw !== undefined;
  }).map(r => {
    const raw = [r.totalCost, r.cost, r.amount, r.serviceCost].find(v => v !== undefined && v !== null && v !== '');
    return { record:r, date:r.date || r.maintenanceDate || r.serviceDate || normDate(null, r.timestamp), time:timeOf(tsMs(r.timestamp)), name:r.machineName || mName(r.machineId) || 'Fleet maintenance', category:`Maintenance · ${r.type || 'Service'}`, qty:null, unit:'', rate:0, cost:Math.max(0,num(raw)), source:'Recorded maintenance cost', isMaintenance:true };
  });
}
function dayFleetCostLines(day = today()) {
  return [...dayFuelCostLines(day), ...dayMaintenanceCostLines(day)].sort((a,b) => (b.date || '').localeCompare(a.date || '') || tsMs(b.record.timestamp) - tsMs(a.record.timestamp));
}
function dayTurfCostLines(day = today()) {
  return (S.plans || []).filter(p => turfRecordDate(p) === day && isTurfCategory(turfPlanCategory(p))).map(turfCostLine).sort((a,b) => tsMs(b.record.issuedAt ?? b.record.issueTimestamp ?? b.record.appliedAt ?? b.record.completedAt ?? b.record.timestamp ?? b.record.createdAt ?? b.record.createdTime) - tsMs(a.record.issuedAt ?? a.record.issueTimestamp ?? a.record.appliedAt ?? a.record.completedAt ?? a.record.timestamp ?? a.record.createdAt ?? a.record.createdTime));
}
function summariseCostLines(lines, countableOnly = false) {
  const relevant = countableOnly ? lines.filter(x => x.countable) : lines;
  const priced = relevant.filter(x => x.cost !== null && Number.isFinite(x.cost));
  return { lines, relevant, priced, total: priced.reduce((sum, x) => sum + x.cost, 0), count: relevant.length, pricedCount: priced.length, unpricedCount: relevant.length - priced.length };
}
function turfDayProductValueRows(day = today()) {
  const grouped = new Map();
  dayTurfCostLines(day).filter(line => line.countable).forEach(line => {
    const product = turfProductForPlan(line.record);
    const identity = product?.id || `${String(line.name).trim().toLowerCase()}|${String(line.unit).trim().toLowerCase()}`;
    const key = `${identity}|${String(line.unit).trim().toLowerCase()}`;
    if (!grouped.has(key)) grouped.set(key, { name: line.name, category: line.category, unit: line.unit || 'unit not set', qty: 0, cost: 0, pricedQty: 0, unpricedQty: 0, count: 0 });
    const row = grouped.get(key);
    row.qty += Math.max(0, num(line.qty));
    row.count += 1;
    if (line.cost !== null && Number.isFinite(line.cost)) { row.cost += line.cost; row.pricedQty += Math.max(0, num(line.qty)); }
    else row.unpricedQty += Math.max(0, num(line.qty));
  });
  return [...grouped.values()].map(row => ({ ...row, cost: row.pricedQty > 0 ? row.cost : null }))
    .sort((a,b) => (b.cost === null ? -1 : b.cost) - (a.cost === null ? -1 : a.cost) || a.name.localeCompare(b.name));
}

function updateDayCostCards(day = today()) {
  const fleet = summariseCostLines(dayFleetCostLines(day));
  const turfLines = dayTurfCostLines(day);
  const turf = summariseCostLines(turfLines, true);
  const fleetValue = $('#opsFleetDayCostValue'), fleetMeta = $('#opsFleetDayCostMeta');
  const turfValue = $('#opsTurfDayCostValue'), turfMeta = $('#opsTurfDayCostMeta');
  if (fleetValue) fleetValue.textContent = fleet.count && !fleet.pricedCount ? '₹—' : money(fleet.total);
  if (fleetMeta) fleetMeta.textContent = !fleet.count ? 'No fuel or maintenance costs recorded today' : `${fleet.pricedCount} cost line(s) priced · ${fleet.unpricedCount} fuel issue(s) unpriced`;
  if (turfValue) turfValue.textContent = turf.count && !turf.pricedCount ? '₹—' : money(turf.total);
  if (turfMeta) {
    const plannedCount = turfLines.filter(x => x.status === 'Planned').length;
    const issueCount = turfLines.filter(x => x.status === 'Issued').length;
    turfMeta.textContent = !turf.count ? (plannedCount ? `${plannedCount} planned · no issues or applications recorded` : 'No turf issues or applications recorded today') : `${turf.pricedCount} priced · ${turf.unpricedCount} unpriced issue/application line(s)${issueCount ? ` · ${issueCount} issued` : ''}${plannedCount ? ` · ${plannedCount} planned` : ''}`;
  }
  const itemsTarget = $('#opsTurfDayCostItems');
  if (itemsTarget) {
    const rows = turfDayProductValueRows(day);
    itemsTarget.innerHTML = !LOADED.plans
      ? '<div class="ops-day-cost-item-empty">Loading issued product values…</div>'
      : rows.length
        ? rows.slice(0,4).map((row, idx) => `<div class="ops-day-cost-item"><span class="ops-day-cost-rank">${idx+1}</span><span class="ops-day-cost-product"><b title="${esc(row.name)}">${esc(row.name)}</b><small>${esc(row.category)} · ${fmt(row.qty,2)} ${esc(row.unit)}</small></span><span class="ops-day-cost-item-value ${row.cost === null ? 'unpriced' : ''}" title="${row.unpricedQty>0?'Partial value: some quantities have no compatible rate':'Value from matched Inventory Master unit cost'}">${row.cost === null ? 'Unpriced' : `${money(row.cost)}${row.unpricedQty>0?'*':''}`}</span></div>`).join('') + (rows.some(row=>row.unpricedQty>0 && row.cost!==null)?'<div class="ops-day-cost-more">* Partial value · some quantities are unpriced</div>':'') + (rows.length>4?`<div class="ops-day-cost-more">+ ${rows.length-4} more products · open analytics</div>`:'')
        : '<div class="ops-day-cost-item-empty">No issued/applied products recorded today.</div>';
  }
}
function openDayCostLedger(domain = 'fleet') {
  const day = today(), dayLabel = dLong(day), isFleet = domain !== 'turf';
  const summary = isFleet ? summariseCostLines(dayFleetCostLines(day)) : summariseCostLines(dayTurfCostLines(day), true);
  const rows = isFleet ? summary.lines : summary.lines;
  const bodyRows = rows.length ? rows.map(line => {
    const costCell = line.cost !== null ? money(line.cost) : (line.status === 'Planned' ? 'Plan only' : 'Unpriced');
    const status = line.isMaintenance ? '<span class="badge ok">Recorded cost</span>' : line.status ? `<span class="badge ${line.status === 'Applied' ? 'ok' : 'warn'}">${esc(line.status)}</span>` : '<span class="badge mute">Issued</span>';
    const quantityCell = isFleet ? (line.isMaintenance ? '—' : `${fmt(line.qty,2)} L`) : `${fmt(line.qty,2)} ${esc(line.unit)}`;
    return `<tr><td>${esc(line.time || '—')}</td><td><b>${esc(line.name)}</b><div class="record-meta">${esc(line.category)}</div></td><td class="num">${quantityCell}</td><td class="num">${line.rate > 0 ? money(line.rate,2) : '—'}</td><td class="num"><b>${esc(costCell)}</b></td><td>${isFleet ? `${status}<div class="record-meta">${esc(line.source)}</div>` : `${status}<div class="record-meta">${esc(line.source)}</div>`}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">No ${isFleet ? 'fuel issues' : 'turf application records'} for ${esc(dayLabel)}.</td></tr>`;
  const pricedVolume = summary.priced.reduce((sum, line) => sum + (line.isMaintenance ? 0 : num(line.qty)), 0);
  const title = isFleet ? 'Fleet Ops · Day Cost Ledger' : 'Turf Ops · Day Cost Ledger';
  const caveat = isFleet
    ? 'Includes fuel issues priced by transaction rate or matching Inventory Master unit cost, plus maintenance records with an explicit cost field. Unpriced fuel issues, labour and other overheads are excluded from the rupee total.'
    : 'Only records marked Issued or Applied contribute to the total. Cost is estimated from the recorded issue/application quantity × Inventory Master unit cost. Planned-only entries are excluded. Missing or mismatched units remain unpriced.';
  const head = `<div class="day-ledger-summary"><div><span>RECORDED COST · ${esc(dayLabel.toUpperCase())}</span><b>${summary.count && !summary.pricedCount ? '₹—' : money(summary.total)}</b><small>${summary.pricedCount} priced line(s) · ${summary.unpricedCount} unpriced line(s)${isFleet ? ` · ${fmt(pricedVolume,2)} L priced` : ''}</small></div><div class="day-ledger-meta"><span>${summary.count} cost line(s)</span><span>${isFleet ? 'Fuel issues' : 'Applied turf products'}</span></div></div>`;
  openModal({ title, sub: 'Daily cost entries · live records', body: `${head}<div class="table-wrap"><table><thead><tr><th>Time</th><th>${isFleet ? 'Machine / fuel type' : 'Product / category'}</th><th class="num">${isFleet ? 'Quantity' : 'Applied qty'}</th><th class="num">Rate</th><th class="num">Cost</th><th>${isFleet ? 'Rate source' : 'Status / rate source'}</th></tr></thead><tbody>${bodyRows}</tbody><tfoot><tr><td colspan="4">Priced total</td><td class="num">${summary.count && !summary.pricedCount ? '₹—' : money(summary.total)}</td><td></td></tr></tfoot></table></div><p class="day-ledger-note">${esc(caveat)}</p>`, footer: `<button class="btn" data-act="export-day-cost" data-domain="${isFleet ? 'fleet' : 'turf'}"><span class="material-symbols-rounded">download</span>Export CSV</button><button class="btn btn-primary" data-act="close-modal">Close</button>` });
}
function exportDayCostLedger(domain = 'fleet') {
  const day = today(), isFleet = domain !== 'turf';
  const lines = isFleet ? dayFleetCostLines(day) : dayTurfCostLines(day);
  const header = isFleet ? ['Date','Time','Machine','Fuel type','Litres','Rate per litre','Recorded cost','Rate source'] : ['Date','Time','Category','Product','Status','Quantity','Unit','Unit rate','Recorded cost','Cost source'];
  const rows = lines.map(line => isFleet
    ? [line.date,line.time,line.name,line.category,line.qty,line.rate || '',line.cost === null ? '' : line.cost,line.source]
    : [line.date,line.time,line.category,line.name,line.status,line.qty,line.unit,line.rate || '',line.cost === null ? '' : line.cost,line.source]);
  downloadCSV(`${isFleet ? 'fleet' : 'turf'}_day_cost_${day}.csv`, [header, ...rows]);
}

function buildTurfCostAnalytics(from, to) {
  const allRows = (S.plans || []).filter(p => {
    const date = turfRecordDate(p);
    return date && date >= from && date <= to && isTurfCategory(turfPlanCategory(p)) && ['Issued','Applied'].includes(turfRecordStatus(p));
  }).map(turfCostLine).sort((a,b) => (b.cost ?? -1) - (a.cost ?? -1) || b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const priced = allRows.filter(row => row.cost !== null && Number.isFinite(row.cost));
  const unpriced = allRows.filter(row => row.cost === null);
  const total = priced.reduce((sum,row)=>sum+row.cost,0);
  const productMap = new Map();
  allRows.forEach(row => {
    const product = turfProductForPlan(row.record);
    const key = `${product?.id || String(row.name).trim().toLowerCase()}|${String(row.unit).toLowerCase()}`;
    if (!productMap.has(key)) productMap.set(key,{name:row.name,category:row.category,unit:row.unit,qty:0,value:0,hasPriced:false,records:0,unpriced:0});
    const productRow=productMap.get(key); productRow.qty+=Math.max(0,num(row.qty)); productRow.records++;
    if(row.cost!==null){productRow.value+=row.cost;productRow.hasPriced=true;}else productRow.unpriced++;
  });
  const products=[...productMap.values()].map(row=>({...row,value:row.hasPriced?row.value:null})).sort((a,b)=>(b.value===null?-1:b.value)-(a.value===null?-1:a.value)||a.name.localeCompare(b.name));
  const startMs=new Date(from+'T00:00:00').getTime(), endMs=new Date(to+'T00:00:00').getTime();
  const spanDays=Math.max(1,Math.floor((endMs-startMs)/86400000)+1);
  const bucketSize=Math.max(1,Math.ceil(spanDays/28));
  const buckets=[];
  for(let offset=0;offset<spanDays;offset+=bucketSize){
    const bucketFrom=addDays(from,offset),bucketTo=addDays(from,Math.min(spanDays-1,offset+bucketSize-1));
    buckets.push({from:bucketFrom,to:bucketTo,label:bucketSize===1?dShort(bucketFrom):`${dShort(bucketFrom)}–${dShort(bucketTo)}`,value:0});
  }
  priced.forEach(row=>{const offset=Math.max(0,Math.floor((new Date(row.date+'T00:00:00').getTime()-startMs)/86400000));const idx=Math.min(buckets.length-1,Math.floor(offset/bucketSize));if(idx>=0&&buckets[idx])buckets[idx].value+=row.cost;});
  const productsChart=products.filter(row=>row.value!==null).slice(0,8).map(row=>({label:row.name.length>17?row.name.slice(0,16)+'…':row.name,value:row.value}));
  const linesHtml=allRows.length?allRows.map(row=>`<tr><td>${esc(row.date)}</td><td><span class="badge ${turfCategoryClass(row.category)}">${esc(row.category)}</span></td><td><b>${esc(row.name)}</b></td><td><span class="badge ${row.status==='Applied'?'ok':'gold'}">${esc(row.status)}</span></td><td class="num">${fmt(row.qty,3)} ${esc(row.unit)}</td><td class="num">${row.rate>0?`${money(row.rate,2)} / ${esc(row.unit)}`:'—'}</td><td class="num"><b>${row.cost===null?'Unpriced':money(row.cost)}</b></td><td>${esc(row.source)}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">No issued/applied turf-product records in this date range.</td></tr>';
  return `<div class="turf-cost-analytics-results">
    <div class="turf-cost-summary-grid">
      <div class="turf-cost-summary primary"><small>PRICED ISSUE / APPLICATION VALUE</small><b>${allRows.length&&!priced.length?'₹—':money(total)}</b><span>Inventory rate × logged issue/application quantity</span></div>
      <div class="turf-cost-summary"><small>ISSUED / APPLIED RECORDS</small><b>${fmt(allRows.length,0)}</b><span>Recorded status; physical use not independently verified</span></div>
      <div class="turf-cost-summary"><small>UNPRICED RECORDS</small><b>${fmt(unpriced.length,0)}</b><span>Missing product link, unit match, or inventory rate</span></div>
      <div class="turf-cost-summary"><small>PRODUCT / UNIT LINES</small><b>${fmt(products.length,0)}</b><span>Different stock units kept separate</span></div>
    </div>
    <div class="turf-cost-chart-grid">
      <section class="turf-cost-panel"><div class="turf-cost-panel-head"><div><small>SPEND TREND</small><h3>Recorded value over time</h3></div><span>${bucketSize===1?'Daily':bucketSize<8?'Weekly buckets':'Range buckets'}</span></div>${priced.length?barChart(buckets,{unit:'₹',h:210}):'<div class="turf-cost-chart-empty">No priced issue/application value in this range.</div>'}</section>
      <section class="turf-cost-panel"><div class="turf-cost-panel-head"><div><small>PRODUCT MIX</small><h3>Highest recorded value</h3></div><span>Top 8</span></div>${productsChart.length?barChart(productsChart,{unit:'₹',h:210}):'<div class="turf-cost-chart-empty">No products have a reliable cost in this range.</div>'}</section>
    </div>
    <section class="turf-cost-panel turf-cost-detail-panel"><div class="turf-cost-panel-head"><div><small>ERP DETAIL REGISTER</small><h3>Issued line items</h3></div><span>${fmt(allRows.length,0)} lines · value descending</span></div><div class="table-wrap"><table class="turf-cost-table"><thead><tr><th>Date</th><th>Category</th><th>Product</th><th>Status</th><th class="num">Quantity</th><th class="num">Unit rate</th><th class="num">Recorded value</th><th>Cost basis</th></tr></thead><tbody>${linesHtml}</tbody></table></div>
    <p class="turf-cost-caveat">Cost is an estimate from the linked Inventory Master unit cost. A value is calculated only when the product link and unit match and a positive unit cost exists. Planned-only records are excluded; unpriced rows are kept visible instead of being treated as ₹0.</p></section>
  </div>`;
}
function renderTurfCostAnalytics(from, to) {
  const fromInput=$('#turfCostFrom'),toInput=$('#turfCostTo');
  if(!fromInput||!toInput)return;
  if(!from||!to)return;
  if(from>to){const swap=from;from=to;to=swap;fromInput.value=from;toInput.value=to;}
  const results=$('#turfCostAnalyticsResults');
  if(results) results.innerHTML=buildTurfCostAnalytics(from,to);
}
function openTurfCostAnalytics() {
  const to=today(),from=monthStart(to);
  openModal({title:'Turf Ops · Cost Analytics',sub:'Issued product cost · date-filtered ERP register',size:'turf-cost-analytics',body:`
    <div class="turf-cost-filterbar"><div class="turf-cost-dates"><label>From<input id="turfCostFrom" type="date" value="${from}" max="${to}"></label><label>To<input id="turfCostTo" type="date" value="${to}" max="${to}"></label><button class="btn btn-primary" data-act="turf-cost-apply"><span class="material-symbols-rounded">filter_alt</span>Apply range</button></div><div class="turf-cost-presets"><button class="chip" data-act="turf-cost-preset" data-range="7d">7 days</button><button class="chip" data-act="turf-cost-preset" data-range="30d">30 days</button><button class="chip on" data-act="turf-cost-preset" data-range="mtd">Month to date</button></div></div>
    <div id="turfCostAnalyticsResults">${buildTurfCostAnalytics(from,to)}</div>`,footer:`<button class="btn" data-act="export-turf-cost-range"><span class="material-symbols-rounded">download</span>Export CSV</button><button class="btn btn-primary" data-act="close-modal">Close</button>`});
}
function applyTurfCostPreset(range) {
  const to=today();
  const from=range==='7d'?addDays(to,-6):range==='30d'?addDays(to,-29):monthStart(to);
  const fromInput=$('#turfCostFrom'),toInput=$('#turfCostTo');
  if(fromInput)fromInput.value=from;if(toInput)toInput.value=to;
  $$('.turf-cost-presets .chip').forEach(btn=>btn.classList.toggle('on',btn.dataset.range===range));
  renderTurfCostAnalytics(from,to);
}
function exportTurfCostRange() {
  const from=$('#turfCostFrom')?.value,to=$('#turfCostTo')?.value;
  if(!from||!to){toast('Choose a valid date range first','err');return;}
  const low=from<=to?from:to,high=from<=to?to:from;
  const lines=(S.plans||[]).filter(p=>{const date=turfRecordDate(p);return date&&date>=low&&date<=high&&isTurfCategory(turfPlanCategory(p))&&['Issued','Applied'].includes(turfRecordStatus(p));}).map(turfCostLine).sort((a,b)=>(b.cost??-1)-(a.cost??-1));
  downloadCSV(`turf_cost_analytics_${low}_to_${high}.csv`,[['Date','Category','Product','Status','Quantity','Unit','Unit Rate','Recorded Value','Cost Basis'],...lines.map(row=>[row.date,row.category,row.name,row.status,row.qty,row.unit,row.rate||'',row.cost===null?'':row.cost,row.source])]);
}

function openCostModel() {
  openForm({ title:'Operating cost model', submit:'Save assumptions', html:
    `<div class="roi-card-intro" style="margin-bottom:14px">These rates affect dashboard estimates in this browser only. A transaction-level rate saved on a fuel record takes priority. Without a rate, that volume is marked unpriced; historical entries are not modified.</div>` +
    `<div class="row2">${fld('Diesel price · ₹ / L', `<input id="costDiesel" type="number" min="0" step="0.01" value="${num(COST.dieselRate)}">`, 'Prototype default: ₹92.50/L. Verify against your supplier invoice.')}${fld('Petrol price · ₹ / L', `<input id="costPetrol" type="number" min="0" step="0.01" value="${num(COST.petrolRate)}">`, '₹0 means petrol issues remain unpriced.')}</div>` +
    `<div class="row2">${fld('Labour cost · ₹ / run hour', `<input id="costLabour" type="number" min="0" step="1" value="${num(COST.labourPerHour)}">`, 'Optional planning assumption. Not included in fuel-only KPIs.')}${fld('Downtime exposure · ₹ / hour', `<input id="costDowntime" type="number" min="0" step="100" value="${num(COST.downtimePerHour)}">`, 'Optional value for estimating incident exposure, not accounting expense.')}</div>` +
    fld('Fuel-efficiency scenario · %', `<input id="costSavings" type="number" min="0" max="100" step="1" value="${num(COST.savingsPct)}">`, 'A what-if lever applied to projected month-end fuel spend. It is not a measured saving.') +
    fld('One-time improvement investment · ₹', `<input id="costInvestment" type="number" min="0" step="1000" value="${num(COST.improvementCost)}">`, 'Optional purchase / implementation cost for payback and first-year ROI. Leave at 0 until a real quote is available.') +
    `<div class="hint">Saved to this browser’s local storage only. For shared, auditable cost rates, move the settings into an authorised Firestore configuration document.</div>`,
    onSubmit: async()=>{ const v={dieselRate:num($('#costDiesel').value),petrolRate:num($('#costPetrol').value),labourPerHour:num($('#costLabour').value),downtimePerHour:num($('#costDowntime').value),savingsPct:num($('#costSavings').value),improvementCost:num($('#costInvestment').value)}; if(v.savingsPct>100){toast('Scenario percentage must be between 0 and 100','err');return false;} Object.assign(COST,v); saveCostModel(); toast('Cost model saved for this browser'); renderOverview(); }
  });
}
function exportROIReport() {
  const x=monthlyCostSnapshot(), start=x.from, end=x.t;
  const rows=[['Clover Greens Ops · ROI & Cost Report'],['Period',start,end],['Important','Fuel cost estimated from transaction prices where present, otherwise configured per-litre rate. Zero/missing prices are excluded.'],[],['SUMMARY','VALUE','NOTES'],
    ['Modeled fuel spend MTD',x.mFuel.cost,`${fmt(x.mFuel.litres)} L; priced volume ${fmt(x.mFuel.pricedLitres)} L; unpriced ${fmt(x.mFuel.unpricedLitres)} L`],
    ['Projected monthly fuel reduction scenario',x.savingsScenario,`${fmt(COST.savingsPct)}% of projected month-end fuel spend; not a realised saving`],['Annualised gross fuel savings scenario',x.annualSavingsScenario,'Projected monthly scenario × 12; assumes a comparable run rate'],['One-time improvement investment',COST.improvementCost,'User-entered estimate / quote'],['Payback period in months',x.paybackMonths==null?'':x.paybackMonths,'Only calculated when investment and positive monthly savings are entered'],['First-year ROI %',x.firstYearROI==null?'':x.firstYearROI,'(Annualised gross savings − one-time investment) ÷ investment'],['Fuel cost per engine hour · 30d',x.fuelCostPerHour==null?'':x.fuelCostPerHour,'Fuel only; matched logged engine hours'],['Labour cost proxy · MTD',x.labourCostMTD,`Based on ${money(COST.labourPerHour)}/recorded engine hour; assumption only`],['Projected month-end fuel spend',x.projectedFuel,'Run rate projection, not a budget'],['Inventory stock value · priced lines',x.inv.value,`${x.inv.unpricedCount} stocked line(s) lack unit cost`],['Priced reorder gap',x.inv.reorderValue,'Cost to reach reorder levels on priced items only'],['Priced turf plan lines · MTD',x.plans.cost,`${x.plans.priced} priced lines; ${x.plans.unpriced} unpriced lines`],['Maintenance costs recorded · MTD',x.maintenanceCost,'Only explicit cost fields from maintenance logs included'],['Open incidents',x.openIncidents.length,`${x.downtimeHours} estimated downtime hours entered`],['Estimated downtime exposure',x.downtimeExposure,'Only shown when downtime hours and hourly exposure rate are configured'],[],['MACHINE COST / HOUR · TRAILING 30 DAYS','CATEGORY','FUEL COST','RUN HOURS','LITRES','FUEL COST / HOUR']];
  x.machineCosts.forEach(m=>rows.push([m.name,m.category,m.fuelCost,m.hours,m.litres,m.costPerHour]));
  rows.push([],['INVENTORY','STOCK','AUTO REORDER AT','UNIT COST','STOCK VALUE','LOW STOCK']);
  S.inventory.slice().sort((a,b)=>(a.partName||'').localeCompare(b.partName||'')).forEach(i=>rows.push([itemName(i),num(i.stockQuantity),effectiveReorderLevel(i),num(i.unitCost)||'',num(i.unitCost)>0?num(i.stockQuantity)*num(i.unitCost):'',num(i.stockQuantity)<=effectiveReorderLevel(i)?'YES':'NO']));
  downloadCSV(`clover_greens_roi_${start}_to_${end}.csv`,rows);
}
function editInventoryCost(id) {
  const i=S.inventory.find(x=>x.id===id); if(!i)return;
  openForm({title:'Update inventory & unit cost',submit:'Save item',html:
    fld('Product / part name',`<input id="editPartName" value="${esc(i.partName||'')}">`)+
    fld('Category',`<select id="editPartCat">${['Fuel','Spare Parts','Fertilizers','Pesticides','Turf Enhancements','Tools','Other'].map(c=>`<option ${i.category===c?'selected':''}>${c}</option>`).join('')}</select>`)+
    `<div class="row2">${fld('Stock quantity',`<input id="editPartStock" type="number" min="0" step="any" value="${num(i.stockQuantity)}">`)}${fld('Automatic reorder policy',`<div class="auto-reorder-form-note"><b>${fmt(effectiveReorderLevel(i),2)} ${esc(i.unit||'units')}</b><small>${autoReorderDetails(i).method} · ${autoReorderDetails(i).leadDays}-day lead time</small></div>` )}</div>`+
    fld('Unit',`<select id="editPartUnit">${['Nos','Kg','Litre','Gram','ML','Bag','Pack'].map(u=>`<option ${i.unit===u?'selected':''}>${u}</option>`).join('')}</select>`)+
    fld('Unit cost · ₹ per stock unit',`<input id="editPartCost" type="number" min="0" step="0.01" value="${num(i.unitCost)}">`,'Set 0 if price is not yet known. Stock value uses quantity × unit cost.'),
    onSubmit:async()=>{const name=$('#editPartName').value.trim();if(!name){toast('Part name is required','err');return false;}await updateDoc(doc(db,CONFIG.COL.inventory,id),{partName:name,category:$('#editPartCat').value,stockQuantity:Math.max(0,num($('#editPartStock').value)),unit:$('#editPartUnit').value,unitCost:Math.max(0,num($('#editPartCost').value))});toast('Inventory and cost updated');}
  });
}

/* ================= FLEET ================= */
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
  curModalRender = renderFuelModal;
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
  curModalRender = renderRunModal;
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
let expFilter = 'all';
const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const expAmount = x => (x.amount != null && x.amount !== '') ? num(x.amount) : num(x.qty) * num(x.rate);
/* Money originally spent from my pocket (still true after the office reimburses me). */
const expIsMine = x => x.spentByMe !== undefined ? !!x.spentByMe : ((x.paidBy || 'me') === 'me' || !!x.reclaimedAt);
const expIsReclaimed = x => expIsMine(x) && x.paidBy === 'accounts';
const findInventoryByName = n => S.inventory.find(i => normName(itemName(i)) === normName(n));
const EXP_CAT_RULES = [
  ['Fuel', /\b(diesel|petrol|gasoline|kerosene|fuel)\b/],
  ['Pesticides', /pesticid|fungicid|herbicid|insecticid|weedicid|miticid|rodenticid|glyphosate|weed ?killer|pest control/],
  ['Fertilizers', /fertili[sz]|\burea\b|\bnpk\b|\bdap\b|potash|compost|manure|ammonium|nitrate|phosphate|micronutrient|humic/],
  ['Turf Enhancements', /\bgrass|\bturf|\blawn|\bseed|topdress|top dress|\bsoil|\bsand\b|wetting agent|biostimulant|growth regulator|colou?rant|seaweed|\bmulch/],
  ['Tools', /\btools?\b|plier|wrench|spanner|screwdriver|\bdrill\b|hammer|\bsaw\b|shovel|spade|\brake\b|\bhoe\b|trowel|secateur|pruner|ladder|wheelbarrow|measuring tape|chisel|crowbar|file set|allen key/],
  ['Spare Parts', /bearing|\bbelts?\b|filter|spark ?plug|\bbolts?\b|\bnuts?\b|\bscrews?\b|washer|\bhose\b|\btyre|\btire|gasket|\bblades?\b|bushing|clutch|piston|\bcable\b|\bfuse\b|battery|\bbulb\b|oil seal|nozzle|valve|pulley|\bchain\b|sprocket|\baxle\b|\bspring\b|grease|lubric|engine oil|hydraulic oil|coolant|clamp|bracket|relay|spare|gear ?box|carburet|radiator/]
];
function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  for (const [cat, re] of EXP_CAT_RULES) if (re.test(t)) return cat;
  return 'Other';
}
/* Looks the item up on Wikipedia (CORS-enabled, no key). Falls back to name keywords if offline or nothing is found. */
async function lookupCategoryOnline(name) {
  const byName = guessCategory(name);
  const out = { category: byName, via: byName === 'Other' ? 'No match' : 'Item name keywords', title: '', snippet: '', url: '', online: false };
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=' + encodeURIComponent(name), { signal: ctl.signal });
    clearTimeout(timer);
    const hits = ((await r.json()).query || {}).search || [];
    if (hits.length) {
      out.online = true;
      const h = hits[0], snip = String(h.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      out.title = h.title; out.snippet = snip; out.url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(h.title.replace(/ /g, '_'));
      if (byName === 'Other') { const c = guessCategory(h.title + ' ' + snip); if (c !== 'Other') { out.category = c; out.via = 'Wikipedia: ' + h.title; } else out.via = 'Wikipedia found “' + h.title + '” but no clear category'; }
    }
  } catch (e) { out.offline = true; }
  return out;
}
const expItems = x => (Array.isArray(x.items) && x.items.length) ? x.items : [{ itemName: x.itemName, qty: x.qty, rate: x.rate, category: x.category, inInventory: x.inInventory }];
function renderLocalExpenseLedger() {
  const host = $('#localExpenseLedger');
  if (!host) return;
  const all = (S.expenses || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const mine = all.filter(expIsMine), direct = all.filter(x => !expIsMine(x));
  const spentByMe = mine.reduce((a, x) => a + expAmount(x), 0);
  const reclaimed = mine.filter(expIsReclaimed).reduce((a, x) => a + expAmount(x), 0);
  const toCollect = Math.max(0, spentByMe - reclaimed);
  const officeDirect = direct.reduce((a, x) => a + expAmount(x), 0);
  const rows = all.filter(x => expFilter === 'all' || (expFilter === 'pending' && expIsMine(x) && !expIsReclaimed(x)) || (expFilter === 'reclaimed' && expIsReclaimed(x)) || (expFilter === 'office' && !expIsMine(x)));
  const shown = rows.reduce((a, x) => a + expAmount(x), 0);
  const chip = (k, l) => `<button class="chip ${expFilter === k ? 'on' : ''}" data-act="exp-filter" data-f="${k}">${l}</button>`;
  const markup = `<section class="local-expenses"><div class="card-h"><div><h3>Local expenses &amp; reimbursements</h3><p class="muted sm">Add one bill with any number of items. Tick “Reclaimed” once the office pays you back.</p></div><button class="btn btn-primary btn-sm" data-act="add-local-expense"><span class="material-symbols-rounded">add</span>Add bill</button></div>
    <div class="local-expense-kpis"><div><small>Spent by me</small><b>${money(spentByMe, 2)}</b></div><div><small>Reclaimed from office (−)</small><b>− ${money(reclaimed, 2)}</b></div><div class="collect"><small>To collect from office</small><b>${money(toCollect, 2)}</b></div><div><small>Paid directly by office</small><b>${money(officeDirect, 2)}</b></div></div>
    <div class="chips exp-filter">${chip('all', 'All')}${chip('pending', 'To collect')}${chip('reclaimed', 'Reclaimed')}${chip('office', 'Office paid')}</div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Bill / items</th><th class="num">Bill amount</th><th>Paid by</th><th>Reclaimed</th><th></th></tr></thead><tbody>${rows.length ? rows.map(x => {
      const m = expIsMine(x), rc = expIsReclaimed(x), its = expItems(x);
      const lines = its.map(i => `<div class="exp-line"><span>${esc(i.itemName || '')}${i.category ? ` <i class="muted">· ${esc(i.category)}${i.inInventory ? ' · in master' : ''}</i>` : ''}</span><span class="muted">${fmt(i.qty, 3)} × ${money(i.rate, 2)}</span></div>`).join('');
      return `<tr><td>${esc(x.date || '—')}</td><td>${its.length > 1 || x.vendor ? `<b>${its.length > 1 ? its.length + ' items' : '1 item'}</b>` : ''}${x.vendor ? ` <span class="muted sm">· ${esc(x.vendor)}</span>` : ''}<div class="exp-lines">${lines}</div></td><td class="num"><b>${money(expAmount(x), 2)}</b></td><td><span class="badge ${x.paidBy === 'accounts' ? 'ok' : 'warn'}">${x.paidBy === 'accounts' ? 'Accounts' : 'Me'}</span></td><td>${m ? `<label class="expense-paid-toggle"><input type="checkbox" data-expense-paid="${esc(x.id)}" ${rc ? 'checked' : ''} aria-label="Mark bill as reclaimed from office"><span>${rc ? 'Reclaimed' : 'Pending'}</span></label>` : '<span class="muted sm">Paid by office</span>'}</td><td><button class="btn btn-sm" data-act="delete-local-expense" data-id="${esc(x.id)}">Delete</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No local expenses here yet. Select “Add bill” to start.</td></tr>'}</tbody>${rows.length ? `<tfoot><tr><td colspan="2">Total shown</td><td class="num">${money(shown, 2)}</td><td colspan="3"></td></tr></tfoot>` : ''}</table></div></section>`;
  setHTML(host, markup);
}
function openNewItemPopup({ name, qty, rate, expId, items, idx, next, pos, total }) {
  const catOpts = STORE_CATS.map(c => `<option>${esc(c)}</option>`).join('');
  openForm({ title: 'New item' + (total > 1 ? ' ' + pos + ' of ' + total : '') + ' — add to Inventory Master?', submit: 'Add to master',
    html: `<p class="muted sm" style="margin:0 0 10px">“${esc(name)}” is not in the Inventory Master. Press <b>Add to master</b> to create it, or Cancel to keep it as a local expense only.</p>` +
      fld('Item name', `<input id="exMasterName" value="${esc(name)}">`) +
      `<div class="row2">${fld('Category', `<select id="exMasterCat">${catOpts}</select>`)}${fld('Unit', '<select id="exMasterUnit"><option>Nos</option><option>Kg</option><option>Litre</option><option>Gram</option><option>ML</option><option>Bag</option><option>Pack</option></select>')}</div>` +
      '<div id="exLookup" class="exp-lookup">Searching online for a category…</div>' +
      '<div class="expense-online-tools"><button type="button" class="btn btn-sm" id="exSearchOnline">Search again</button><a class="btn btn-sm" id="exSearchWeb" target="_blank" rel="noopener" href="https://www.google.com/search?q=' + encodeURIComponent(name + ' product category') + '">Open web search</a></div>' +
      `<label class="expense-stock-option"><input id="exMasterStock" type="checkbox"> Also add the purchased quantity (${fmt(qty, 3)}) to stock</label>`,
    onSubmit: async () => {
      const nm = $('#exMasterName').value.trim(); if (!nm) { toast('Item name is required', 'err'); return false; }
      if (findInventoryByName(nm)) { toast('This item already exists in the master', 'err'); return false; }
      const cat = $('#exMasterCat').value;
      await addDoc(collection(db, CONFIG.COL.inventory), { partName: nm, category: cat, stockQuantity: $('#exMasterStock').checked ? qty : 0, unit: $('#exMasterUnit').value, unitCost: rate, reorderLevel: 0 });
      if (expId && items) { items[idx].category = cat; items[idx].inInventory = true; await updateDoc(doc(db, CONFIG.COL.expenses, expId), { items }); }
      toast('Added to Inventory Master as ' + cat);
      if (next) next();
    } });
  if (next) { const skip = () => next(); $('#mFoot [data-act="close-modal"]')?.addEventListener('click', skip); $('#modal .m-head .icon-btn')?.addEventListener('click', skip); }
  const sel = $('#exMasterCat'), nameEl = $('#exMasterName'); let touched = false;
  sel.addEventListener('change', () => { touched = true; });
  const run = async () => {
    const n = nameEl.value.trim(); const box = $('#exLookup'); if (!n || !box) return;
    box.textContent = 'Searching online for a category…';
    const r = await lookupCategoryOnline(n);
    if (!$('#exLookup')) return;
    if (!touched && STORE_CATS.includes(r.category)) sel.value = r.category;
    $('#exSearchWeb').href = 'https://www.google.com/search?q=' + encodeURIComponent(n + ' product category');
    box.innerHTML = `<b>Suggested: ${esc(r.category)}</b> <span class="muted sm">· ${esc(r.via)}${r.offline ? ' · offline, used item name only' : ''}</span>` + (r.snippet ? `<div class="muted sm">${esc(r.snippet)}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">source</a>` : ''}</div>` : '') + '<div class="muted sm">Please verify before saving. You can change the category above.</div>';
  };
  $('#exSearchOnline').onclick = () => { touched = false; run(); };
  run();
}

/* ================= FUEL LEDGER VIEW ================= */
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
let zoneMap = null, radarMap = null, drawn = null, drawCoords = [], zoneLayers = { zone: null, radar: null }, markers = {}, radarFitted = false;
const ZCOL = { Course: '#E5C794', Green: '#1F9D55', Fairway: '#7DBB2E', Rough: '#C28A2F', Tee: '#5B8DEF', Other: '#9AA39D' };
const TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';
function courseZone() {
  return S.zones.find(z => (z.zoneType || '').toLowerCase() === 'course')
    || S.zones.find(z => /course|boundary|property/i.test(z.zoneName || ''));
}
function fitToCourse(map) {
  if (!map) return;
  const cz = courseZone();
  if (cz && cz.coordinates && cz.coordinates.length >= 3) {
    const latlngs = cz.coordinates.map(q => [Number(q.lat), Number(q.lng)]).filter(q => !isNaN(q[0]));
    if (latlngs.length >= 3) {
      try { map.fitBounds(L.latLngBounds(latlngs).pad(0.08), { maxZoom: 18 }); return; } catch (e) {}
    }
  }
  // fallback: current location if available
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
    }, () => {}, { enableHighAccuracy: true, timeout: 5000 });
  }
}
function addLocateControl(map) {
  if (!map || map._locateBtn) return;
  const ctl = L.control({ position: 'bottomright' });
  ctl.onAdd = function () {
    const d = L.DomUtil.create('div', 'leaflet-bar');
    const a = L.DomUtil.create('a', '', d);
    a.href = '#'; a.title = 'My location'; a.innerHTML = '?'; a.style.cssText = 'font-size:18px;font-weight:700;color:#E5C794';
    L.DomEvent.on(a, 'click', L.DomEvent.stop).on(a, 'click', () => {
      if (!navigator.geolocation) return toast('Location not available', 'err');
      navigator.geolocation.getCurrentPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        map.setView(ll, Math.max(map.getZoom(), 17));
        if (map._meMarker) map._meMarker.setLatLng(ll);
        else map._meMarker = L.circleMarker(ll, { radius: 8, color: '#E5C794', fillColor: '#E5C794', fillOpacity: 0.9, weight: 2 }).addTo(map);
      }, () => toast('Could not get current location', 'err'), { enableHighAccuracy: true, timeout: 8000 });
    });
    return d;
  };
  ctl.addTo(map);
  map._locateBtn = true;
}

function initZoneMap() {
  if (zoneMap) { zoneMap.invalidateSize(); fitToCourse(zoneMap); return; }
  zoneMap = L.map('zoneMap', { zoomControl: false, drawControl: false }).setView([CONFIG.LAT, CONFIG.LNG], 16);
  L.control.zoom({ position: 'bottomright' }).addTo(zoneMap);
  L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(zoneMap);
  zoneLayers.zone = L.layerGroup().addTo(zoneMap);
  drawn = new L.FeatureGroup().addTo(zoneMap);
  addLocateControl(zoneMap);
  const drawControl = new L.Control.Draw({
    position: 'topleft',
    edit: { featureGroup: drawn, remove: true },
    draw: {
      polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#E5C794', weight: 2, fillOpacity: 0.2 } },
      polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
    }
  });
  zoneMap.addControl(drawControl);
  zoneMap.on(L.Draw.Event.CREATED, ev => {
    drawn.clearLayers();
    drawn.addLayer(ev.layer);
    const latlngs = ev.layer.getLatLngs();
    const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    drawCoords = ring.map(p => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }));
    zoneForm();
  });
  zoneMap.on(L.Draw.Event.DELETED, () => { drawCoords = []; drawn.clearLayers(); });
  drawZones();
  fitToCourse(zoneMap);
}
function initRadarMap() {
  if (radarMap) { radarMap.invalidateSize(); fitToCourse(radarMap); return; }
  radarMap = L.map('radarMap', { zoomControl: false }).setView([CONFIG.LAT, CONFIG.LNG], 16);
  L.control.zoom({ position: 'bottomright' }).addTo(radarMap);
  L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(radarMap);
  zoneLayers.radar = L.layerGroup().addTo(radarMap);
  addLocateControl(radarMap);
  drawZones(); updateRadar();
  fitToCourse(radarMap);
}
function drawZones() {
  [['zone', zoneMap, true], ['radar', radarMap, false]].forEach(([k, map, showLabel]) => {
    if (!map || !zoneLayers[k]) return;
    zoneLayers[k].clearLayers();
    S.zones.forEach(z => {
      if (!z.coordinates || !z.coordinates.length) return;
      const c = ZCOL[z.zoneType] || '#E5C794';
      const latlngs = z.coordinates.map(q => [Number(q.lat), Number(q.lng)]).filter(q => !isNaN(q[0]) && !isNaN(q[1]));
      if (latlngs.length < 3) return;
      const p = L.polygon(latlngs, {
        color: c,
        weight: showLabel ? 2.5 : 1.25,
        fillColor: c,
        fillOpacity: showLabel ? 0.22 : 0.08,
        dashArray: showLabel ? null : '4 4'
      }).addTo(zoneLayers[k]);
      const title = z.zoneName || 'Zone';
      const subtitle = z.zoneType || '';
      p.bindPopup(`<b>${esc(title)}</b>${subtitle ? '<br>' + esc(subtitle) : ''}`);
      if (showLabel) {
        p.bindTooltip(
          `<span style="font-weight:800">${esc(title)}</span>${subtitle ? ` <span style="opacity:.8;font-weight:600">· ${esc(subtitle)}</span>` : ''}`,
          { permanent: true, direction: 'center', className: 'place-label', opacity: 1 }
        );
      }
    });
  });
}
function updateRadar() {
  if (!radarMap) return;
  const ll = liveList(), seen = new Set();
  ll.forEach(l => {
    seen.add(l.id); const pos = [l.lat, l.lng], cls = l._stale ? 'pin stale' : 'pin';
    const icon = L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
    const label = esc(l._name);
    const tip = `<b>${esc(l._name)}</b><br>${esc(l.operatorName || '—')}<br>${fmt(l.speed || 0)} km/h · ${ago(l._ts)}`;
    if (markers[l.id]) {
      markers[l.id].setLatLng(pos).setIcon(icon);
      markers[l.id].setTooltipContent(label);
      markers[l.id].setPopupContent(tip);
    } else {
      markers[l.id] = L.marker(pos, { icon }).addTo(radarMap)
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -16], className: 'zlabel', opacity: 0.95 })
        .bindPopup(tip);
    }
  });
  Object.keys(markers).forEach(id => { if (!seen.has(id)) { radarMap.removeLayer(markers[id]); delete markers[id]; } });
  if (!radarFitted && ll.length) { radarMap.fitBounds(L.latLngBounds(ll.map(l => [l.lat, l.lng])).pad(.4), { maxZoom: 17 }); radarFitted = true; }
}
function renderRadarPanel() {
  const ll = liveList(), n = ll.filter(l => !l._stale).length;
  $('#radarCount').textContent = `${n} live`;
  const hudLive = $('#hudLive'); if (hudLive) hudLive.textContent = n;
  document.body.classList.toggle('has-live', n > 0);
  setHTML($('#radarList'), ll.length ? ll.map(l => `<div class="list-row" style="cursor:default"><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l._name)}</b><div class="muted sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.operatorName || '—')} · ${fmt(l.speed || 0)} km/h</div></div><div class="right" style="flex:none"><span class="badge ${l._stale ? 'mute' : 'gold live'}">${l._stale ? 'Stale' : 'Live'}</span><div class="muted sm">${ago(l._ts)}</div></div></div>`).join('') : '<div class="empty">No machines live</div>');
  updateRadar();
}
function renderZonePanel() {
  const hz = $('#hudZones'); if (hz) hz.textContent = `${S.zones.length} ZONES`;
  const order = { Course: 0, Green: 1, Fairway: 2, Rough: 3, Tee: 4, Other: 5 };
  const zones = [...S.zones].sort((a, b) => (order[a.zoneType] ?? 9) - (order[b.zoneType] ?? 9) || (a.zoneName || '').localeCompare(b.zoneName || ''));
  setHTML($('#zoneList'), zones.length ? zones.map(z => `<div class="list-row"><div><b>${esc(z.zoneName || 'Zone')}</b><div class="muted sm"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ZCOL[z.zoneType] || '#E5C794'};margin-right:5px"></span>${esc(z.zoneType || '-')}</div></div><button class="btn btn-danger btn-sm" data-act="del" data-col="zones" data-id="${esc(z.id)}" data-label="${esc(z.zoneName || 'this zone')}"><span class="material-symbols-rounded">delete</span></button></div>`).join('') : '<div class="empty">Draw Course boundary first</div>');
}
function zoneForm() {
  if (!drawCoords || drawCoords.length < 3) {
    toast('Draw a complete polygon first (at least 3 points)', 'err');
    return;
  }
  openForm({
    title: 'Save zone',
    html: fld('Area name', '<input id="zName" placeholder="e.g. Hole 7 Green" autocomplete="off">') +
      fld('Type', '<select id="zType"><option>Course</option><option>Green</option><option>Fairway</option><option>Rough</option><option>Tee</option><option>Other</option></select>'),
    submit: 'Save zone',
    onSubmit: async () => {
      const name = ($('#zName')?.value || '').trim();
      if (!name) { toast('Area name is required', 'err'); return false; }
      if (!drawCoords || drawCoords.length < 3) { toast('Polygon is incomplete', 'err'); return false; }
      try {
        const zType = $('#zType').value;
        await addDoc(collection(db, CONFIG.COL.zones), {
          zoneName: name,
          zoneType: zType,
          coordinates: drawCoords
        });
        drawCoords = [];
        if (drawn) drawn.clearLayers();
        toast('Zone saved');
        // If course boundary, refit maps
        setTimeout(() => { fitToCourse(zoneMap); fitToCourse(radarMap); }, 400);
        return true;
      } catch (e) {
        console.error(e);
        toast('Could not save zone', 'err');
        return false;
      }
    }
  });
  setTimeout(() => $('#zName')?.focus(), 120);
}

/* ================= REGISTRY & INCIDENTS ================= */
function normMobile(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, ''); const plus = d.startsWith('+'); d = d.replace(/\+/g, '');
  if (!plus && d.length === 10) return '+91' + d; if (!plus && d.length === 12 && d.startsWith('91')) return '+' + d; if (!plus && d.length === 11 && d.startsWith('0')) return '+91' + d.slice(1);
  return (plus ? '+' : '') + d;
}
let usersSearchText = '', usersRoleFilter = 'all';
function renderUsersMaster() {
  const q = usersSearchText.trim().toLowerCase();
  const all = [...(S.users || [])].sort((a, b) => (a.fullName || a.username || '').localeCompare(b.fullName || b.username || ''));
  const rows = all.filter(u => (!q || [u.fullName,u.username,u.mobileNumber,u.role].some(v => String(v||'').toLowerCase().includes(q))) && (usersRoleFilter === 'all' || String(u.role||'') === usersRoleFilter));
  const roles = [...new Set(all.map(u=>String(u.role||'').trim()).filter(Boolean))].sort();
  setHTML($('#usersTbl'), `<div class="user-tools"><label class="user-search"><span class="material-symbols-rounded">search</span><input id="usersSearch" value="${esc(usersSearchText)}" placeholder="Search name, mobile or role" aria-label="Search users"></label><label class="user-role-filter">Role<select id="usersRoleFilter"><option value="all">All roles</option>${roles.map(r=>`<option value="${esc(r)}" ${usersRoleFilter===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label><span class="muted sm user-count">${rows.length} of ${all.length} users</span>${RBAC.can('access.manage') ? '<button class="btn btn-sm" data-act="open-role-admin">Manage app access</button>' : ''}</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Record ID</th><th class="right">Actions</th></tr></thead><tbody>${!LOADED.users ? '<tr><td colspan="5"><div class="skeleton" style="height:80px"></div></td></tr>' : rows.length ? rows.map(u => `<tr><td><b>${esc(u.fullName || u.username || 'Staff')}</b><div class="muted sm">${u.username && u.username!==u.fullName ? esc(u.username) : 'Workforce profile'}</div></td><td>${esc(u.mobileNumber || '—')}</td><td><span class="badge ${u.role === 'incharge' ? 'gold' : String(u.role||'').startsWith('storekeeper') ? 'warn' : 'ok'}">${esc(u.role || '—')}</span></td><td><code>${esc(u.id)}</code></td><td class="right" style="white-space:nowrap"><button class="btn btn-sm" data-act="edit-user" data-id="${esc(u.id)}">Edit</button> <button class="btn btn-danger btn-sm" data-act="del" data-col="users" data-id="${esc(u.id)}" data-label="${esc(u.fullName || 'this user')}"><span class="material-symbols-rounded">delete</span></button></td></tr>`).join('') : `<tr><td colspan="5" class="empty">${all.length?'No users match these filters.':'No users yet. Add a workforce member to begin.'}</td></tr>`}</tbody></table></div>`);
  const search = $('#usersSearch'); if (search && document.activeElement?.id === 'usersSearch') { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}
const STORE_CATS = ['Fuel','Fertilizers','Pesticides','Turf Enhancements','Spare Parts','Tools','F&B','Other'];
const itemName = i => i.partName || i.itemName || 'Unnamed item';
const inventoryCategoryOpen = new Set();
function inventoryRowsMarkup(items) {
  return `<div class="table-wrap inv-category-table"><table><thead><tr><th>Item name</th><th>Unit</th><th class="num">On hand</th><th class="num">Auto reorder at</th><th class="num">Last unit rate</th><th class="num">Stock value</th><th>Status</th><th></th></tr></thead><tbody>${items.length ? items.map(i=>{
    const qty=num(i.stockQuantity), reorder=effectiveReorderLevel(i), policy=autoReorderDetails(i), low=qty<=reorder;
    return `<tr><td><b>${esc(itemName(i))}</b></td><td>${esc(i.unit||'Unit not set')}</td><td class="num"><b>${fmt(qty,3)}</b></td><td class="num"><b>${fmt(reorder,3)}</b><div class="muted sm">${policy.reliable?'Trend-based':'Provisional floor'}</div></td><td class="num">${num(i.unitCost)?money(i.unitCost,2):'—'}</td><td class="num">${money(qty*num(i.unitCost),2)}</td><td><span class="badge ${low?'warn':'ok'}">${low?'Reorder':'In stock'}</span></td><td><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}">Edit</button></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="empty">No items in this category.</td></tr>'}</tbody></table></div>`;
}
function renderRegistry() {
  const items=S.inventory.slice();
  const low=items.filter(i=>num(i.stockQuantity)<=effectiveReorderLevel(i)).length;
  const total=items.reduce((v,i)=>v+Math.max(0,num(i.stockQuantity))*Math.max(0,num(i.unitCost)),0);
  setHTML($('#storeKpis'), `<div class="kpi"><div class="kpi-label">SKUs</div><div class="kpi-value">${items.length}</div></div><div class="kpi"><div class="kpi-label">Low stock</div><div class="kpi-value">${low}</div></div><div class="kpi"><div class="kpi-label">Stock value (recorded rates)</div><div class="kpi-value">${money(total)}</div></div><div class="kpi"><div class="kpi-label">Goods receipts</div><div class="kpi-value">${S.inwards.length}</div></div>`);

  if (!LOADED.inventory) {
    setHTML($('#invTbl'), '<div class="card empty">Loading inventory…</div>');
  } else if (!items.length) {
    setHTML($('#invTbl'), '<div class="card empty">No inventory items yet. Use <b>New item master</b> to create your first SKU.</div>');
  } else {
    const groups = new Map();
    items.forEach(i => { const cat=String(i.category||'Other').trim()||'Other'; if(!groups.has(cat)) groups.set(cat,[]); groups.get(cat).push(i); });
    groups.forEach(rows=>rows.sort((a,b)=>itemName(a).localeCompare(itemName(b))));
    const rank = new Map(STORE_CATS.map((c,i)=>[c.toLowerCase(),i]));
    const cats = [...groups.keys()].sort((a,b)=>{
      const ra=rank.has(a.toLowerCase())?rank.get(a.toLowerCase()):999;
      const rb=rank.has(b.toLowerCase())?rank.get(b.toLowerCase()):999;
      return ra-rb || a.localeCompare(b);
    });
    const markup = cats.map(cat=>{
      const rows=groups.get(cat), lowRows=rows.filter(i=>num(i.stockQuantity)<=effectiveReorderLevel(i));
      const value=rows.reduce((v,i)=>v+Math.max(0,num(i.stockQuantity))*Math.max(0,num(i.unitCost)),0);
      const isOpen=inventoryCategoryOpen.has(cat);
      return `<details class="inv-category" data-inv-category="${esc(cat)}" ${isOpen?'open':''}><summary><span class="inv-cat-icon material-symbols-rounded">${cat==='Fuel'?'local_gas_station':cat==='Fertilizers'?'spa':cat==='Pesticides'?'pest_control':cat==='Turf Enhancements'?'eco':cat==='Spare Parts'?'build':cat==='Tools'?'handyman':'inventory_2'}</span><span class="inv-cat-main"><b>${esc(cat)}</b><small>${rows.length} item${rows.length===1?'':'s'} · ${money(value)} recorded stock value</small></span><span class="inv-cat-alert ${lowRows.length?'warn':''}">${lowRows.length?`${lowRows.length} reorder`:'Stock OK'}</span><span class="inv-cat-chevron material-symbols-rounded">expand_more</span></summary><div class="inv-category-body">${isOpen?inventoryRowsMarkup(rows):'<div class="inv-category-placeholder">Expand to view items in this category</div>'}</div></details>`;
    }).join('');
    setHTML($('#invTbl'), `<div class="inv-category-list">${markup}</div>`);
  }

  const receipts=[...S.inwards].sort((a,b)=>tsMs(b.createdAt)-tsMs(a.createdAt));
  setHTML($('#inwardTbl'), `<table><thead><tr><th>Date / Reference</th><th>Category / Item</th><th>Supplier</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Total</th></tr></thead><tbody>${!LOADED.inwards?'<tr><td colspan="7">Loading receipts…</td></tr>':receipts.length?receipts.slice(0,100).map(r=>`<tr><td>${esc(r.receiptDate||'—')}<div class="muted sm">${esc(r.invoiceNumber||r.id)}</div></td><td><span class="muted sm">${esc(r.category||'')}</span><div><b>${esc(r.itemName||'')}</b></div></td><td>${esc(r.supplier||'—')}</td><td class="num">${fmt(r.quantity,3)} ${esc(r.unit||'')}</td><td class="num">${money(r.rate,2)}</td><td class="num">${fmt(r.gstPercent,2)}%</td><td class="num"><b>${money(r.total,2)}</b></td></tr>`).join(''):'<tr><td colspan="7" class="empty">No goods receipts recorded.</td></tr>'}</tbody></table>`);
  renderLocalExpenseLedger();
}
// Collapse content when a category closes so large inventory masters do not leave hundreds of rows in the DOM.
document.addEventListener('toggle', e => {
  const details=e.target;
  if (!(details instanceof HTMLDetailsElement) || !details.matches('#invTbl details.inv-category[data-inv-category]')) return;
  const category=details.dataset.invCategory || '';
  const body=details.querySelector('.inv-category-body');
  if (!body) return;
  if (details.open) {
    inventoryCategoryOpen.add(category);
    const rows=S.inventory.filter(i=>(String(i.category||'Other').trim()||'Other')===category).sort((a,b)=>itemName(a).localeCompare(itemName(b)));
    setHTML(body, inventoryRowsMarkup(rows));
  } else {
    inventoryCategoryOpen.delete(category);
    setHTML(body, '<div class="inv-category-placeholder">Expand to view items in this category</div>');
  }
}, true);

let storeRecordsTab = 'items';
function openStoreRecordsEditor() {
  storeRecordsTab = 'items';
  renderStoreRecordsEditor();
}
const RESET_GROUPS = [
  {key:'users', label:'Users & access', col:'users', note:'User profiles and role records'},
  {key:'machines', label:'Machines / fleet', col:'machines', note:'Machine master records'},
  {key:'plans', label:'Turf plans & issues', col:'plans', note:'Planned tasks and recorded issue/application lines'},
  {key:'inventory', label:'Inventory master & stock', col:'inventory', note:'Item masters and current stock balances'},
  {key:'inwards', label:'Goods receipts', col:'inwards', note:'GRN / inward receipt records'},
  {key:'fuel', label:'Fuel issues', col:'fuel', note:'Fuel issue logs'},
  {key:'shifts', label:'Shifts & attendance', col:'shifts', note:'Shift records'},
  {key:'maintenance', label:'Maintenance records', col:'maintenance', note:'Service and repair history'},
  {key:'assignments', label:'Assignments', col:'assignments', note:'Operator / machine assignment history'},
  {key:'logs', label:'Operational logs', col:'logs', note:'General operational and issue logs'},
  {key:'zones', label:'Course zones', col:'zones', note:'Geofence / area configuration'},
  {key:'live', label:'Live telemetry', col:'live', note:'Latest live machine telemetry'},
];
function openDataReset() {
  const choices = RESET_GROUPS.map(g=>`<label class="reset-data-option"><input type="checkbox" name="resetGroup" value="${g.key}"><span><b>${esc(g.label)}</b><small>${esc(g.note)}</small></span></label>`).join('');
  openForm({title:'Reset selected data',submit:'Permanently reset selected',danger:true,html:`<div class="alert-box" style="margin-bottom:12px"><b>Destructive action.</b> Selected records will be permanently deleted from Firebase. This cannot be undone. Export or back up data first.</div><div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><button type="button" class="btn btn-sm" id="resetSelectAll">Select all</button><button type="button" class="btn btn-sm" id="resetSelectNone">Clear selection</button></div><div class="reset-data-list">${choices}</div><div class="field" style="margin-top:14px"><label class="f">Type RESET to confirm</label><input id="resetConfirmText" autocomplete="off" placeholder="Type RESET"></div><p class="muted sm">Inventory and goods receipts are separate selections. Resetting one does not automatically reset the other. Turf plans & issues share the turf_plans collection.</p>`,onSubmit:async()=>{
    const selected=$$('#mBody input[name="resetGroup"]:checked').map(el=>RESET_GROUPS.find(g=>g.key===el.value)).filter(Boolean);
    if(!selected.length){toast('Select at least one data group','err');return false;}
    if($('#resetConfirmText')?.value.trim()!=='RESET'){toast('Type RESET exactly to confirm','err');return false;}
    const summary=[];
    for(const group of selected){
      const snap=await getDocs(collection(db,CONFIG.COL[group.col]));
      let deleted=0; const docs=snap.docs;
      for(let i=0;i<docs.length;i+=400){const batch=writeBatch(db);docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));await batch.commit();deleted+=Math.min(400,docs.length-i);}
      summary.push(`${group.label}: ${deleted}`);
    }
    toast(`Reset complete · ${summary.join(' · ')}`);
    scheduleRender();
  }});
  $('#resetSelectAll')?.addEventListener('click',()=>$$('#mBody input[name="resetGroup"]').forEach(el=>el.checked=true));
  $('#resetSelectNone')?.addEventListener('click',()=>$$('#mBody input[name="resetGroup"]').forEach(el=>el.checked=false));
}
function renderStoreRecordsEditor() {
  const tabButtons = `<div class="turf-view-tabs" style="margin-bottom:14px"><button class="turf-view-tab ${storeRecordsTab==='items'?'active':''}" data-act="store-records-tab" data-tab="items">Item master <span class="turf-count-pill">${S.inventory.length}</span></button><button class="turf-view-tab ${storeRecordsTab==='inwards'?'active':''}" data-act="store-records-tab" data-tab="inwards">Goods receipts <span class="turf-count-pill">${S.inwards.length}</span></button></div>`;
  let body = '';
  if (storeRecordsTab === 'items') {
    const rows = [...S.inventory].sort((a,b)=>itemName(a).localeCompare(itemName(b)));
    body = `<div class="muted sm" style="margin-bottom:10px">Edit item details from the Store tab. Deleting an item removes its master record; review linked history before deleting.</div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="num">Stock</th><th>Unit</th><th></th></tr></thead><tbody>${rows.length?rows.map(i=>`<tr><td><b>${esc(itemName(i))}</b><div class="muted sm">ID: ${esc(i.id)}</div></td><td>${esc(i.category||'Other')}</td><td class="num">${fmt(i.stockQuantity,3)}</td><td>${esc(i.unit||'—')}</td><td class="right" style="white-space:nowrap"><button class="btn btn-sm" data-act="edit-part" data-id="${esc(i.id)}">Edit</button> <button class="btn btn-danger btn-sm" data-act="store-delete-item" data-id="${esc(i.id)}">Delete</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No item master records.</td></tr>'}</tbody></table></div>`;
  } else {
    const rows = [...S.inwards].sort((a,b)=>String(b.receiptDate||'').localeCompare(String(a.receiptDate||'')));
    body = `<div class="muted sm" style="margin-bottom:10px">Deleting a receipt also reverses its quantity from the linked item's current stock. If the current balance is lower than the receipt quantity, deletion is blocked to prevent a negative stock balance.</div><div class="table-wrap"><table><thead><tr><th>Date / GRN</th><th>Item</th><th>Supplier</th><th class="num">Qty</th><th class="num">Total</th><th></th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${esc(r.receiptDate||'—')}<div class="muted sm">${esc(r.invoiceNumber||r.id)}</div></td><td><b>${esc(r.itemName||'—')}</b><div class="muted sm">${esc(r.category||'')}</div></td><td>${esc(r.supplier||'—')}</td><td class="num">${fmt(r.quantity,3)} ${esc(r.unit||'')}</td><td class="num">${money(r.total,2)}</td><td class="right"><button class="btn btn-danger btn-sm" data-act="store-delete-inward" data-id="${esc(r.id)}">Delete</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">No goods receipt records.</td></tr>'}</tbody></table></div>`;
  }
  openModal({title:'Store records editor',sub:'Review, edit or permanently delete store records',size:'lg',body:tabButtons+body,footer:'<button class="btn" data-act="close-modal">Close</button>'});
}
function deleteStoreItemFromEditor(id) {
  const item=S.inventory.find(x=>x.id===id); if(!item)return;
  openForm({title:'Delete item master',submit:'Delete item',danger:true,html:`<p style="margin:0 0 10px">Permanently delete <b>${esc(itemName(item))}</b>?</p><p class="muted sm">Current stock: ${fmt(item.stockQuantity,3)} ${esc(item.unit||'units')}. This does not delete historical receipts or issue/application records linked to the item.</p>`,onSubmit:async()=>{await deleteDoc(doc(db,CONFIG.COL.inventory,id));toast('Item master deleted');}});
}
function deleteStoreInwardFromEditor(id) {
  const receipt=S.inwards.find(x=>x.id===id); if(!receipt)return;
  if(receipt.transactionType === "FNB_RECEIPT"){toast("This receipt is linked to F&B order history. Manage it through F&B to avoid a stock mismatch.","err");return;}
  openForm({title:'Delete goods receipt',submit:'Delete receipt & reverse stock',danger:true,html:`<p style="margin:0 0 10px">Delete GRN <b>${esc(receipt.invoiceNumber||receipt.id)}</b> for <b>${esc(receipt.itemName||'item')}</b>?</p><p class="muted sm">This will subtract ${fmt(receipt.quantity,3)} ${esc(receipt.unit||'units')} from the linked item's current stock. This cannot be undone.</p>`,onSubmit:async()=>{
    await runTransaction(db,async tx=>{
      const receiptRef=doc(db,CONFIG.COL.inwards,id), receiptSnap=await tx.get(receiptRef);
      if(!receiptSnap.exists())throw new Error('Receipt no longer exists. Refresh and retry.');
      const r=receiptSnap.data(), itemId=r.itemId;
      if(itemId){
        const itemRef=doc(db,CONFIG.COL.inventory,itemId), itemSnap=await tx.get(itemRef);
        if(itemSnap.exists()){
          const current=Math.max(0,num(itemSnap.data().stockQuantity)), qty=Math.max(0,num(r.quantity));
          if(current+1e-9<qty)throw new Error(`Cannot reverse receipt: current stock (${fmt(current,3)}) is below receipt quantity (${fmt(qty,3)}). Correct stock first.`);
          tx.update(itemRef,{stockQuantity:+(current-qty).toFixed(4),updatedAt:serverTimestamp()});
        }
      }
      tx.delete(receiptRef);
    });
    toast('Receipt deleted and stock reversed');
  }});
}

function openInward() {
  const cats=STORE_CATS.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  openForm({title:'Goods inward / Stock receipt',submit:'Post inward',html:
    `<div class="row2">${fld('Category',`<select id="inCat" data-chg="inward-category"><option value="">Select category</option>${cats}</select>`)}${fld('Item name',`<select id="inItem"><option value="">Select category first</option></select>`)}</div>`+
    `<div class="row2">${fld('Receipt date',`<input id="inDate" type="date" value="${today()}">`)}${fld('Supplier',`<input id="inSupplier" placeholder="Supplier name">`)}</div>`+
    fld('Invoice / GRN reference',`<input id="inInvoice" placeholder="Invoice or delivery challan no.">`)+
    `<div class="row2">${fld('Quantity',`<input id="inQty" type="number" min="0.001" step="any" placeholder="0">`)}${fld('Rate per unit (₹, before GST)',`<input id="inRate" type="number" min="0" step="0.01" placeholder="0">`)}</div>`+
    `<div class="row2">${fld('GST applicable',`<select id="inGst" data-chg="inward-gst"><option value="0">No / 0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select>`)}${fld('Custom GST %',`<input id="inCustomGst" type="number" min="0" max="100" step="0.01" placeholder="Optional">`)}</div>`+
    `<div id="inPreview" class="muted sm">Enter quantity and rate to calculate taxable amount and GST.</div>`+
    fld('Notes',`<input id="inNotes" placeholder="Optional receiving notes">`),
    onSubmit:async()=>{
      const itemId=$('#inItem').value, item=S.inventory.find(i=>i.id===itemId),qty=Number($('#inQty').value),rate=Number($('#inRate').value),gst=($('#inCustomGst').value.trim()!==''?Number($('#inCustomGst').value):Number($('#inGst').value));
      if(!item||$('#inCat').value!==item.category){toast('Select a valid item for the category','err');return false;}
      if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(rate)||rate<0||!Number.isFinite(gst)||gst<0||gst>100){toast('Check quantity, rate and GST','err');return false;}
      const ref=$('#inInvoice').value.trim(),supplier=$('#inSupplier').value.trim(),receiptDate=$('#inDate').value;
      if(!receiptDate||!supplier||!ref){toast('Date, supplier and invoice / GRN are required','err');return false;}
      const taxable=+(qty*rate).toFixed(2),tax=+(taxable*gst/100).toFixed(2),total=+(taxable+tax).toFixed(2);
      const receiptRef=doc(collection(db,CONFIG.COL.inwards));
      await runTransaction(db,async tx=>{
        const itemRef=doc(db,CONFIG.COL.inventory,itemId),snap=await tx.get(itemRef);
        if(!snap.exists())throw new Error('Item no longer exists');
        const current=snap.data();if(current.category!==item.category)throw new Error('Item category changed. Refresh and retry');
        const oldQty=Math.max(0,num(current.stockQuantity)),newQty=oldQty+qty;
        tx.update(itemRef,{stockQuantity:newQty,unitCost:rate,lastInwardId:receiptRef.id,updatedAt:serverTimestamp()});
        tx.set(receiptRef,{itemId,itemName:itemName(item),category:item.category,unit:item.unit||'Nos',quantity:qty,rate,gstPercent:gst,taxableAmount:taxable,gstAmount:tax,total,supplier,invoiceNumber:ref,receiptDate,notes:$('#inNotes').value.trim(),createdAt:serverTimestamp(),transactionType:'INWARD'});
      });toast('Goods inward posted and stock updated');
    }
  });
  updateInwardItems();
}
function updateInwardItems(){const c=$('#inCat')?.value,el=$('#inItem');if(!el)return;el.innerHTML='<option value="">Select item</option>'+S.inventory.filter(i=>i.category===c).sort((a,b)=>itemName(a).localeCompare(itemName(b))).map(i=>`<option value="${esc(i.id)}">${esc(itemName(i))} (${esc(i.unit||'Nos')})</option>`).join('');}
function previewInward(){const el=$('#inPreview');if(!el)return;const q=Math.max(0,num($('#inQty')?.value)),r=Math.max(0,num($('#inRate')?.value)),g=$('#inCustomGst')?.value.trim()!==''?num($('#inCustomGst').value):num($('#inGst')?.value);el.textContent=`Taxable ${money(q*r,2)} · GST ${money(q*r*g/100,2)} · Invoice total ${money(q*r*(1+g/100),2)}`;}
function renderIncidents() {
  if (!LOADED.logs) { setHTML($('#incList'), '<div class="skeleton" style="height:90px"></div>'); return; }
  const rows = [...S.logs].sort((a, b) => ((a.repairStatus === 'Resolved') - (b.repairStatus === 'Resolved')) || tsMs(b.createdAt) - tsMs(a.createdAt));
  setHTML($('#incList'), rows.length ? rows.map(l => { const done = l.repairStatus === 'Resolved'; return `<div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap"><div style="min-width:240px;flex:1"><div class="muted sm"><b>${esc(l.machineId || 'General')}</b> · ${esc(l.logType || 'Issue')}${l.reportedDate ? ' · ' + dLong(l.reportedDate) : ''}</div><div style="font-weight:600;margin-top:2px">${esc(l.issueDescription || '')}</div><div class="record-meta">${num(l.estimatedDowntimeHours)>0?`Estimated downtime ${fmt(l.estimatedDowntimeHours,1)} h · ${COST.downtimePerHour>0?money(num(l.estimatedDowntimeHours)*COST.downtimePerHour)+' estimated exposure':'set hourly exposure rate in Cost model'}`:'Downtime estimate not recorded'}</div></div><div style="display:flex;gap:8px;align-items:center"><span class="badge ${done ? 'ok' : 'bad'}">${done ? 'Resolved' : esc(l.repairStatus || 'Pending')}</span><button class="btn btn-sm" data-act="inc-toggle" data-id="${esc(l.id)}">${done ? 'Reopen' : 'Mark resolved'}</button><button class="btn btn-danger btn-sm" data-act="del" data-col="logs" data-id="${esc(l.id)}" data-label="this incident"><span class="material-symbols-rounded">delete</span></button></div></div>`; }).join('') : '<div class="card empty">No incident tickets. ??</div>');
}


/* ================= RECORDS (maintenance + assignments) ================= */
let recordsTab = 'maintenance';
function renderRecords() {
  const card = $('#recordsCard');
  if (!card) return;
  $$('#recordsChips .chip').forEach(c => c.classList.toggle('on', c.dataset.tab === recordsTab));
  if (recordsTab === 'maintenance') {
    const rows = [...(S.maintenance || [])].sort((a, b) => tsMs(b.timestamp) - tsMs(a.timestamp) || (b.date || '').localeCompare(a.date || ''));
    if (!LOADED.maintenance) { setHTML(card, '<div class="skeleton" style="height:240px"></div>'); return; }
    setHTML(card, `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Machine</th><th class="num">Hours at event</th><th>Parts</th><th>By</th><th>Notes</th><th></th></tr></thead><tbody>${rows.length ? rows.map(r => {
      const parts = Array.isArray(r.partsUsed) ? r.partsUsed.map(p => `${p.partName || p.partId || 'part'}×${p.qty || 1}`).join(', ') : '';
      return `<tr><td>${dLong(r.date || normDate(null, r.timestamp))}</td><td><span class="badge ${r.type === 'Service' ? 'ok' : r.type === 'Repair' ? 'warn' : 'gold'}">${esc(r.type || '—')}</span>${r.stockWarning ? ' <span class="badge bad">Stock</span>' : ''}</td><td><b>${esc(r.machineName || mName(r.machineId))}</b></td><td class="num">${r.hoursAtEvent != null ? fmt(num(r.hoursAtEvent)) : '—'}</td><td class="muted">${esc(parts || '—')}</td><td>${esc(r.performedBy || '—')}</td><td class="muted">${esc(r.notes || '')}</td><td></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No maintenance logs yet. Incharge can log Service / Backlapping / Repair from the app.</td></tr>'}</tbody></table></div>`);
  } else if (recordsTab === 'assignments') {
    const rows = [...(S.assignments || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!LOADED.assignments) { setHTML(card, '<div class="skeleton" style="height:240px"></div>'); return; }
    setHTML(card, `<div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Machine</th><th>Operator</th><th>By</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td>${r.at ? dLong(normDate(null, r.at)) + ' · ' + timeOf(r.at) : '—'}</td><td><span class="badge ${r.action === 'ASSIGN' ? 'ok' : 'mute'}">${esc(r.action || '—')}</span></td><td><b>${esc(r.machineName || mName(r.machineId))}</b></td><td>${esc(r.operatorName || '—')}<div class="record-meta">${esc(r.operatorMobile || '')}</div></td><td>${esc(r.by || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No assignment history yet.</td></tr>'}</tbody></table></div>`);
  } else {
    // fuel history reuse
    renderLedger(true);
    const ledger = $('#ledgerCard');
    if (ledger) setHTML(card, ledger.innerHTML);
  }
}

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
  $$('#nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.group === key));
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
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
  $('#pageTitle').textContent = VIEWS[v][0]; $('#pageSub').textContent = VIEWS[v][1]; $('#viewHead').style.display = (v === 'overview' || v === 'turfcare') ? 'none' : ''; window.scrollTo(0, 0);
  const mapMode = (v === 'radar' || v === 'zones');
  document.body.classList.toggle('map-mode', mapMode);
  activeNavGroup = groupForView(v);
  $$('#nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.group === activeNavGroup));
  renderGroupTabs();
  if (v === 'radar') { initRadarMap(); setTimeout(() => { if (radarMap) { radarMap.invalidateSize(); fitToCourse(radarMap); } }, 80); }
  if (v === 'zones') { initZoneMap(); setTimeout(() => { if (zoneMap) { zoneMap.invalidateSize(); fitToCourse(zoneMap); } }, 80); }
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
  'store-records-tab': d => { storeRecordsTab = d.tab || 'items'; renderStoreRecordsEditor(); },
  'store-delete-item': d => deleteStoreItemFromEditor(d.id),
  'store-delete-inward': d => deleteStoreInwardFromEditor(d.id),
  'nav-turfcare': () => { setTurfSection('workboard'); switchView('turfcare'); },
  'nav-inventory-master': () => switchView('registry'),
  'turf-tab': d => setTurfSection(d.tab),
  'turf-category-products': d => { turfProductCategory = d.category || 'All categories'; setTurfSection('products'); },
  'export-turf-applications': () => { const rows=[...S.plans].filter(p=>isTurfCategory(turfPlanCategory(p))).sort((a,b)=>turfRecordDate(a).localeCompare(turfRecordDate(b))); downloadCSV('turf-application-records.csv', [['Date','Category','Product','Quantity','Unit','Treated area','Status','Notes','Created at'], ...rows.map(p=>[turfRecordDate(p),turfPlanCategory(p),turfRecordProductName(p),turfRecordQuantity(p),p.unit||p.stockUnit||p.uom||'',p.targetArea||p.area||p.location||'',turfRecordStatus(p),p.notes||p.reason||'',p.createdAt ? new Date(tsMs(p.createdAt)).toISOString() : ''])]); },
  'rec-tab': d => { recordsTab = d.tab; renderRecords(); },
  'export-records': () => {
    if (recordsTab === 'maintenance') downloadCSV('maintenance.csv', [['Date','Type','Machine','Hours','Parts','By','Notes'], ...(S.maintenance||[]).map(r => [r.date, r.type, r.machineName||r.machineId, r.hoursAtEvent, JSON.stringify(r.partsUsed||[]), r.performedBy, r.notes])]);
    else if (recordsTab === 'assignments') downloadCSV('assignments.csv', [['At','Action','Machine','Operator','Mobile','By'], ...(S.assignments||[]).map(r => [r.at, r.action, r.machineName, r.operatorName, r.operatorMobile, r.by])]);
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
  kebab: (d, el, e) => { e.stopPropagation(); const menu = el.nextElementSibling, open = menu.classList.contains('open'); $$('.kmenu.open').forEach(x => x.classList.remove('open')); if (!open) menu.classList.add('open'); },
  'add-spray': d => openAddSprayTaskForm(d.day, d.date),
  'save-turf-batch': () => saveTurfBatch(),
  'open-turf-variance': () => openTurfVarianceModal(),
  'apply-turf-variance': () => { const a=$('#turfVarianceFrom')?.value||today(),b=$('#turfVarianceTo')?.value||today(); if(a>b){toast('From date must be on or before To date.','err');return;} renderTurfVariance(a,b); },
  'export-turf-variance': () => exportTurfVariance(), 
  "tp-area": d => { tpState.area = d.area || "Greens"; renderTp(); },
  "tp-category": d => { tpState.category = d.category || "Fertilizers"; renderTp(); },
  "tp-save-tab": () => saveTpCategoryTab(),
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
      $$('#exRows .exp-row').forEach(r=>{
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
    }}); $$('#exRows .exi-name')[0]?.focus(); },
  'exp-filter': d => { expFilter = d.f || 'all'; renderLocalExpenseLedger(); },
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
  'users-search': v => { usersSearchText = v || ''; renderUsersMaster(); },
  'users-role-filter': v => { usersRoleFilter = v || 'all'; renderUsersMaster(); },
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
document.addEventListener('input', e => { if (e.target?.id === 'usersSearch') { const pos=e.target.selectionStart; usersSearchText=e.target.value||''; renderUsersMaster(); const next=$('#usersSearch'); if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch(_){}} } });
document.addEventListener('change', e => { if (e.target?.id === 'usersRoleFilter') { usersRoleFilter=e.target.value||'all'; renderUsersMaster(); } });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { $$('.kmenu.open').forEach(x => x.classList.remove('open')); return; }
  if (el.dataset.act !== 'kebab') $$('.kmenu.open').forEach(x => x.classList.remove('open'));
  const permission = permissionForAction(el.dataset.act, el.dataset);
  if (permission && !RBAC.can(permission)) { toast("Your role does not have permission for this action.", "err"); return; }
  const fn = H[el.dataset.act]; if (fn) fn(el.dataset, el, e);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && C[el.dataset.chg]) C[el.dataset.chg](el.value, el.dataset, el); });
function exRowHTML(){return '<div class="exp-row"><input class="exi-name" placeholder="Item name" autocomplete="off"><input class="exi-qty" type="number" min="0" step="any" value="1" inputmode="decimal"><input class="exi-rate" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal"><input class="exi-amt" readonly tabindex="-1" value="0.00"><button type="button" class="btn btn-sm exi-del" title="Remove item" aria-label="Remove item">✕</button><div class="exi-match muted sm"></div></div>';}
function exUpdateTotal(){let t=0;$$('#exRows .exp-row').forEach(r=>{const a=Math.round(num(r.querySelector('.exi-qty').value)*num(r.querySelector('.exi-rate').value)*100)/100;r.querySelector('.exi-amt').value=a.toFixed(2);t+=a;});const el=$('#exTotal');if(el)el.textContent=money(t,2);}
function runNewItemQueue(expId,items,queue,total){
  const idx=queue.shift(); if(idx===undefined) return;
  const next=()=>setTimeout(()=>runNewItemQueue(expId,items,queue,total),60);
  openNewItemPopup({name:items[idx].itemName,qty:items[idx].qty,rate:items[idx].rate,expId,items,idx,next,pos:total-queue.length,total});
}
document.addEventListener('change', async e => { const el=e.target.closest('[data-expense-paid]'); if(!el)return; try{await updateDoc(doc(db,CONFIG.COL.expenses,el.dataset.expensePaid),el.checked?{paidBy:'accounts',spentByMe:true,reclaimedAt:serverTimestamp()}:{paidBy:'me',spentByMe:true,reclaimedAt:null});toast(el.checked?'Reclaimed — marked as paid by accounts':'Marked as pending from office');}catch(err){el.checked=!el.checked;toast(err.message||'Could not update expense','err');} });
document.addEventListener('click', e => {
  if (e.target.closest('#exAddRow')) { const h=$('#exRows'); h.insertAdjacentHTML('beforeend',exRowHTML()); h.lastElementChild.querySelector('.exi-name').focus(); }
  const d=e.target.closest('.exi-del'); if(d){ const rows=$$('#exRows .exp-row'); if(rows.length>1){d.closest('.exp-row').remove();} else {rows[0].querySelectorAll('input:not([readonly])').forEach(i=>i.value=i.classList.contains('exi-qty')?'1':'');rows[0].querySelector('.exi-match').innerHTML='';} exUpdateTotal(); }
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
      let phone = $("#loginPhone").value.trim().replace(/[\s()-]/g, "");
      if (/^\d{10}$/.test(phone)) phone = "+91" + phone;
      else if (/^91\d{10}$/.test(phone)) phone = "+" + phone;
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        throw new Error("Enter your phone number in international format, including country code (for example, +91XXXXXXXXXX).");
      }
      if (!recaptchaVerifier) {
        recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      }
      confirmationResult = await signInWithPhoneNumber(auth, phone, recaptchaVerifier);
      $("#loginPhoneStep").hidden = true;
      $("#loginOtpStep").hidden = false;
      $("#otpPhoneLabel").textContent = phone;
      $("#loginPhone").readOnly = true;
      $("#loginSubmit").querySelector("span:first-child").textContent = "Verify & continue";
      $("#loginOtp").value = "";
      $("#loginOtp").focus();
      error.textContent = "Code sent. Enter the six digits to verify automatically.";
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
      $("#loginPhoneStep").hidden = false;
      $("#loginOtpStep").hidden = true;
      $("#loginOtp").value = "";
      $("#loginSubmit").querySelector("span:first-child").textContent = "Send verification code";
    }
    error.textContent = err.message || "Could not complete phone verification. Check Firebase Phone sign-in and authorized domains.";
  } finally {
    sendBtn.disabled = false;
  }
});

// OTP autofill: submit verification as soon as the sixth digit arrives.
$("#loginOtp").addEventListener("input", () => {
  const input = $("#loginOtp");
  const digits = input.value.replace(/\D/g, "").slice(0, 6);
  if (input.value !== digits) input.value = digits;
  if (digits.length === 6 && confirmationResult && !$("#loginSubmit").disabled) {
    $("#loginForm").requestSubmit();
  }
});
$("#changePhone").addEventListener("click", () => {
  confirmationResult = null;
  try { recaptchaVerifier?.clear(); } catch (_) {}
  recaptchaVerifier = null;
  $("#recaptcha-container").replaceChildren();
  $("#loginOtp").value = "";
  $("#loginPhone").readOnly = false;
  $("#loginPhoneStep").hidden = false;
  $("#loginOtpStep").hidden = true;
  $("#loginSubmit").querySelector("span:first-child").textContent = "Send verification code";
  $("#loginErr").textContent = "";
  $("#loginPhone").focus();
});

$("#signoutBtn").addEventListener("click", async () => {
  try { await signOut(auth); } catch (err) { toast("Sign-out failed. Retry.", "err"); }
});



function getSunday(d) {
  const dt = new Date(d + "T00:00:00");
  const day = dt.getDay();
  const diff = dt.getDate() - day;
  return ymd(new Date(dt.setDate(diff)));
}
function isTurfCategory(category) {
  const c = String(category || '').toLowerCase();
  return /fertiliz|fertilis|pesticid|enhancement|turf enhancer|turf improver|growth enhancer/.test(c);
}
function turfCategoryLabel(category) {
  const c = String(category || '').toLowerCase();
  if (/fertiliz|fertilis/.test(c)) return 'Fertilizers';
  if (/pesticid/.test(c)) return 'Pesticides';
  if (/enhancement|turf enhancer|turf improver|growth enhancer/.test(c)) return 'Turf Enhancements';
  return 'Other';
}
function turfRecordDate(plan) {
  if (plan && plan._d) return plan._d;
  const dateValue = plan && (plan.date ?? plan.issuedDate ?? plan.applicationDate ?? plan.appliedDate ?? plan.issueDate ?? plan.transactionDate ?? plan.logDate ?? plan.plannedDate ?? plan.createdDate);
  return normDate(dateValue, plan && (plan.issuedAt ?? plan.issueTimestamp ?? plan.appliedAt ?? plan.completedAt ?? plan.timestamp ?? plan.createdAt ?? plan.createdOn ?? plan.updatedAt ?? plan.recordedAt ?? plan.createdTime));
}
function turfRecordProductName(plan) {
  if (!plan) return '';
  const nested = plan.product && typeof plan.product === 'object' ? (plan.product.name ?? plan.product.productName ?? plan.product.partName ?? plan.product.itemName) : plan.product;
  const nestedItem = plan.item && typeof plan.item === 'object' ? (plan.item.name ?? plan.item.productName ?? plan.item.partName ?? plan.item.itemName) : plan.item;
  return String(plan.productName ?? plan.itemName ?? plan.inventoryItemName ?? plan.inventoryName ?? plan.partName ?? plan.stockItemName ?? plan.productLabel ?? nested ?? nestedItem ?? plan.chemicalName ?? plan.fertilizerName ?? plan.materialName ?? plan.name ?? plan.title ?? '').trim();
}
function turfRecordQuantity(plan) {
  return num(plan && (plan.actualQty ?? plan.appliedQty ?? plan.applicationQty ?? plan.issuedQty ?? plan.issuedQuantity ?? plan.issueQty ?? plan.issueQuantity ?? plan.quantityIssued ?? plan.qtyIssued ?? plan.quantityOut ?? plan.qtyOut ?? plan.quantityUsed ?? plan.usedQuantity ?? plan.qtyUsed ?? plan.dispensedQty ?? plan.quantity ?? plan.qty ?? plan.targetQty ?? plan.plannedQty ?? plan.requestedQty));
}
function turfRecordStatus(plan) {
  const raw = String(plan && (plan.status ?? plan.applicationStatus ?? plan.issueStatus ?? plan.transactionType ?? plan.movementType ?? plan.recordType ?? plan.entryType ?? plan.logType ?? plan.actionType ?? plan.state ?? plan.action) || 'Planned').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bnot applied\b|\bpending\b|\bplanned\b|\bscheduled\b/.test(raw)) return 'Planned';
  if (/\b(applied|completed|complete|consumed|used|done)\b/.test(raw)) return 'Applied';
  if (/\b(issued|issue|dispensed|released|given out|outward|withdrawn|consumption|stock out|quantity out|out)\b/.test(raw)) return 'Issued';
  if (/\b(cancelled|canceled|void|rejected)\b/.test(raw)) return 'Cancelled';
  return 'Planned';
}
function turfProductForPlan(plan) {
  if (!plan) return null;
  const productId = plan.productId ?? plan.productID ?? plan.itemId ?? plan.inventoryId ?? plan.inventoryItemId ?? plan.inventoryItemDocId ?? plan.productDocId ?? plan.stockItemId ?? plan.skuId ?? (plan.product && typeof plan.product === 'object' ? (plan.product.id ?? plan.product.productId ?? plan.product.itemId) : null);
  const name = turfRecordProductName(plan).toLowerCase();
  return S.inventory.find(i => productId && i.id === productId)
    || S.inventory.find(i => name && itemName(i).trim().toLowerCase() === name)
    || S.inventory.find(i => name && String(i.name || i.productName || '').trim().toLowerCase() === name)
    || null;
}
function turfPlanCategory(plan) {
  const product = turfProductForPlan(plan);
  const fromPlan = plan && (plan.category ?? plan.productCategory ?? plan.itemCategory ?? plan.materialCategory ?? plan.productType ?? plan.itemType ?? plan.fertilizerType ?? plan.product?.category ?? plan.type);
  // Trust a recognized product-master category over a generic/mismatched label saved on the log.
  const productLabel = turfCategoryLabel(product && product.category);
  if (product && productLabel !== 'Other') return productLabel;
  const planLabel = turfCategoryLabel(fromPlan);
  if (planLabel !== 'Other') return planLabel;
  const name = turfRecordProductName(plan);
  const nameLabel = turfCategoryLabel(name);
  return nameLabel !== 'Other' ? nameLabel : 'Other';
}
function turfCategoryClass(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('pesticide')) return 'pesticide';
  if (c.includes('enhancement') || c.includes('enhancer')) return 'enhancer';
  return 'fertilizer';
}
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
  $$('#v-turfcare .turf-view-tab').forEach(btn => {
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

function turfProductUnit(product) { return String(product?.unit || product?.uom || product?.stockUnit || product?.unitOfMeasure || '').trim(); }

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
  const weekdays = $$('input[name="turfBatchWeekday"]:checked').map(x=>Number(x.value));
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





const TP_AREAS = [
  { name: 'Greens', icon: 'golf_course', detail: '18 individual greens' },
  { name: 'Fairways', icon: 'grass', detail: 'Fairway turf' },
  { name: 'Roughs', icon: 'landscape', detail: 'Rough turf' },
  { name: 'Tees', icon: 'flag', detail: 'Tee boxes' },
  { name: 'Nursery', icon: 'yard', detail: 'Growing nursery' },
  { name: 'Driving Range', icon: 'sports_golf', detail: 'Range turf' },
  { name: 'Short Game Area', icon: 'golf_course', detail: 'Practice greens' }
];
const TP_CATEGORIES = [
  { name: 'Fertilizers', icon: 'spa', description: 'Nutrients and soil feeding' },
  { name: 'Pesticides', icon: 'pest_control', description: 'Pest, weed and disease control' },
  { name: 'Turf Enhancements', icon: 'eco', description: 'Turf conditioners and enhancements' }
];
const TP_WEEKDAYS = [
  { label: 'Sun', long: 'Sunday', day: 0 },
  { label: 'Mon', long: 'Monday', day: 1 },
  { label: 'Tue', long: 'Tuesday', day: 2 },
  { label: 'Wed', long: 'Wednesday', day: 3 },
  { label: 'Thu', long: 'Thursday', day: 4 },
  { label: 'Fri', long: 'Friday', day: 5 },
  { label: 'Sat', long: 'Saturday', day: 6 }
];
function tpDayOfWeek(dateStr) { return new Date(dateStr + 'T12:00:00').getDay(); }
function tpDefaultWeekdays(dateStr) { return [tpDayOfWeek(dateStr)]; }
let tpState = { date: '', validUntil: '', weekdays: [], weekdaysTouched: false, area: 'Greens', category: 'Fertilizers', lines: {}, notes: {} };

function tpCanonicalArea(area) {
  const value = String(area || '').trim().toLowerCase();
  if (value === 'fairway') return 'fairways';
  if (value === 'short game' || value === 'short-game-area') return 'short game area';
  return value;
}
function tpLineKey(area, category, productId) {
  return [area, category, String(productId || '')].join('::');
}
function tpIsEditablePlan(plan) {
  const status = String(plan && plan.status || 'Planned').trim().toLowerCase();
  return !['issued', 'applied', 'completed', 'cancelled', 'canceled', 'used'].includes(status)
    && ['planned', 'scheduled', 'pending', ''].includes(status);
}
function tpPlanCategory(plan) {
  const linked = S.inventory.find(item => String(item.id) === String(plan && (plan.productId || plan.itemId || plan.inventoryId) || ''));
  return turfCategoryLabel(plan && plan.category || linked && linked.category);
}
function tpIsRepeatSeries(plan) {
  return !!(plan && plan.validFrom && plan.validUntil && Array.isArray(plan.repeatWeekdays));
}
function tpPlanDateInRange(plan, from, until) {
  const date = turfRecordDate(plan);
  return !!date && date >= from && date <= until;
}
function tpDateRangeOverlaps(aFrom, aUntil, bFrom, bUntil) {
  return !!aFrom && !!aUntil && aFrom <= bUntil && aUntil >= bFrom;
}
function tpSelectedDates() {
  const dates = [];
  const from = tpState.date, until = tpState.validUntil;
  if (!from || !until || until < from) return dates;
  const cursor = new Date(from + 'T12:00:00');
  const limit = new Date(until + 'T12:00:00');
  for (let guard = 0; guard < 370 && cursor <= limit; guard++) {
    const dateStr = ymd(cursor);
    if (tpState.weekdays.includes(cursor.getDay())) dates.push(dateStr);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
function tpMatchingPlanRecords(area, category) {
  return (S.plans || []).filter(plan =>
    tpCanonicalArea(plan.targetArea || plan.area) === tpCanonicalArea(area) &&
    tpPlanCategory(plan) === category &&
    tpIsEditablePlan(plan)
  );
}
function tpExistingProductPlans(area, category, productId) {
  const from = tpState.date;
  const until = tpState.validUntil || from;
  return tpMatchingPlanRecords(area, category).filter(plan =>
    tpPlanDateInRange(plan, from, until) &&
    String(plan.productId || plan.itemId || plan.inventoryId || '') === String(productId || '')
  ).sort((a, b) => {
    const aAnchor = a.validFrom === from ? 0 : 1;
    const bAnchor = b.validFrom === from ? 0 : 1;
    return aAnchor - bAnchor || turfRecordDate(a).localeCompare(turfRecordDate(b));
  });
}
function tpLineForProduct(product) {
  const key = tpLineKey(tpState.area, tpState.category, product.id);
  if (Object.prototype.hasOwnProperty.call(tpState.lines, key)) return tpState.lines[key];
  const existing = tpExistingProductPlans(tpState.area, tpState.category, product.id);
  if (!existing.length) return { qty: '', perGreen: false };
  const plan = existing[0];
  // Read legacy planner fields when present, but write only the application's established plan fields.
  const legacyPerGreen = num(plan.perGreenQty ?? plan.quantityPerGreen);
  const perGreen = tpState.area === 'Greens' && (legacyPerGreen > 0 || String(plan.scope || '').toLowerCase() === 'per_area');
  const total = num(plan.targetQty ?? plan.quantity ?? plan.qty);
  const qty = legacyPerGreen > 0 ? legacyPerGreen : perGreen ? total / 18 : total;
  return { qty, perGreen };
}
function tpLineTotal(line, area) {
  const qty = Math.max(0, num(line && line.qty));
  return qty * (area === 'Greens' && line && line.perGreen ? 18 : 1);
}
function tpUpdateRowTotal(element) {
  if (!element) return;
  const row = element.closest('.tp-product-row');
  if (!row) return;
  const qtyEl = row.querySelector('[data-tp-qty]');
  const perGreenEl = row.querySelector('[data-tp-per-green]');
  const unit = row.dataset.unit || '';
  const qty = Math.max(0, num(qtyEl && qtyEl.value));
  const perGreen = tpState.area === 'Greens' && !!(perGreenEl && perGreenEl.checked);
  const total = qty * (perGreen ? 18 : 1);
  const totalEl = row.querySelector('[data-tp-total]');
  if (totalEl) totalEl.textContent = qty > 0 ? fmt(total, 2) + ' ' + unit : '—';
  const meta = row.querySelector('[data-tp-rate-label]');
  if (meta) meta.textContent = perGreen ? fmt(qty, 2) + ' ' + unit + ' × 18 greens' : 'Total quantity for this area';
}
function openTurfPlanner() {
  const start = today();
  tpState = {
    date: start,
    validUntil: start,
    weekdays: tpDefaultWeekdays(start),
    weekdaysTouched: false,
    area: 'Greens',
    category: 'Fertilizers',
    lines: {},
    notes: {}
  };
  openModal({
    title: 'Turf Treatment Planner',
    sub: 'Build repeatable treatment plans by course area, category, date range and weekdays.',
    size: 'turf-planner-modal',
    body: '<div id="tpContainer"></div>',
    footer: '<button type="button" class="btn" data-act="close-modal">Close planner</button>'
  });
  renderTp();
}
function renderTp() {
  const container = $('#tpContainer');
  if (!container) return;
  const area = tpState.area;
  const category = tpState.category;
  const areasHtml = TP_AREAS.map(item =>
    '<button type="button" class="tp-area-button' + (item.name === area ? ' is-active' : '') + '" data-act="tp-area" data-area="' + esc(item.name) + '">' +
      '<span class="material-symbols-rounded">' + esc(item.icon) + '</span>' +
      '<span class="tp-area-copy"><b>' + esc(item.name) + '</b><small>' + esc(item.detail) + '</small></span>' +
      '<span class="material-symbols-rounded tp-area-chevron">chevron_right</span>' +
    '</button>'
  ).join('');
  const categoryTabs = TP_CATEGORIES.map(item =>
    '<button type="button" class="tp-category-tab' + (item.name === category ? ' is-active' : '') + '" data-act="tp-category" data-category="' + esc(item.name) + '">' +
      '<span class="material-symbols-rounded">' + esc(item.icon) + '</span><span>' + esc(item.name) + '</span>' +
    '</button>'
  ).join('');
  const products = S.inventory
    .filter(item => turfCategoryLabel(item.category) === category)
    .sort((a, b) => String(itemName(a)).localeCompare(String(itemName(b))));
  const rows = products.map(product => {
    const line = tpLineForProduct(product);
    const unit = turfProductUnit(product);
    const stock = Math.max(0, num(product.stockQuantity));
    const qtyValue = line.qty === '' || line.qty === null || line.qty === undefined ? '' : String(line.qty);
    const perGreen = area === 'Greens' && !!line.perGreen;
    const total = tpLineTotal(line, area);
    const canPlan = !!unit;
    return '<article class="tp-product-row" data-unit="' + esc(unit) + '">' +
      '<div class="tp-product-ident"><span class="tp-product-icon material-symbols-rounded">' + esc(category === 'Fertilizers' ? 'spa' : category === 'Pesticides' ? 'pest_control' : 'eco') + '</span>' +
      '<div class="tp-product-copy"><b>' + esc(itemName(product)) + '</b><span>' + esc(unit || 'Unit not set') + ' · Stock ' + fmt(stock, 2) + (num(product.unitCost) > 0 ? ' · ' + money(num(product.unitCost)) + '/' + esc(unit) : '') + '</span></div></div>' +
      '<div class="tp-qty-control"><label>Qty (' + esc(unit || 'unit') + ')' +
      '<input type="number" min="0" step="any" inputmode="decimal" value="' + esc(qtyValue) + '" placeholder="0" aria-label="Quantity for ' + esc(itemName(product)) + '" data-tp-qty data-product="' + esc(product.id) + '"' + (canPlan ? '' : ' disabled') + '></label></div>' +
      '<div class="tp-scope-control">' +
      (area === 'Greens' ? '<label class="tp-per-green"><input type="checkbox" data-tp-per-green data-product="' + esc(product.id) + '"' + (perGreen ? ' checked' : '') + (canPlan ? '' : ' disabled') + '><span><b>Per green</b><small>× 18 greens</small></span></label>' : '<span class="tp-scope-fixed">Whole area</span>') +
      '<div class="tp-total-label"><small>' + (perGreen ? '18-green total' : 'Total required') + '</small><b data-tp-total>' + (num(line.qty) > 0 ? fmt(total, 2) + ' ' + esc(unit) : '—') + '</b></div></div>' +
      '<span class="tp-rate-label" data-tp-rate-label>' + (perGreen ? fmt(num(line.qty), 2) + ' ' + esc(unit) + ' × 18 greens' : 'Total quantity for this area') + '</span>' +
      (!canPlan ? '<small class="tp-unit-warning">Set a unit of measure in Products &amp; Stock before planning this item.</small>' : '') +
      '</article>';
  }).join('');
  const noteKey = area + '::' + category;
  const note = tpState.notes[noteKey] || '';
  const existingCount = tpMatchingPlanRecords(area, category).filter(plan =>
    tpPlanDateInRange(plan, tpState.date, tpState.validUntil || tpState.date)
  ).length;
  const weekdaysHtml = TP_WEEKDAYS.map(item =>
    '<label class="tp-weekday-chip"><input type="checkbox" data-tp-weekday value="' + item.day + '"' +
    (tpState.weekdays.includes(item.day) ? ' checked' : '') + '><span>' + item.label + '</span></label>'
  ).join('');
  const plannedDates = tpSelectedDates();
  container.innerHTML =
    '<div class="tp-planner-toolbar"><div class="tp-planner-title"><span class="tp-eyebrow">APPLICATION PLAN</span><h3>Daily treatment allocation</h3><p>Set the active dates once, then configure each area and category.</p></div>' +
    '<div class="tp-date-range"><label><span>Plan from</span><input type="date" value="' + esc(tpState.date) + '" data-tp-date></label>' +
    '<span class="tp-range-arrow material-symbols-rounded">arrow_forward</span>' +
    '<label><span>Valid through</span><input type="date" min="' + esc(tpState.date) + '" value="' + esc(tpState.validUntil) + '" data-tp-until></label></div></div>' +
    '<div class="tp-repeat-strip"><div class="tp-repeat-heading"><span class="material-symbols-rounded">event_repeat</span><div><b>Repeat on</b><small>' + plannedDates.length + ' scheduled date' + (plannedDates.length === 1 ? '' : 's') + '</small></div></div>' +
    '<div class="tp-weekday-options">' + weekdaysHtml + '</div><span class="tp-repeat-help">Only selected weekdays between the start and end dates are scheduled.</span></div>' +
    '<div class="tp-planner-layout"><aside class="tp-area-sidebar"><div class="tp-sidebar-heading"><span>COURSE AREAS</span><small>' + TP_AREAS.length + ' areas</small></div>' + areasHtml +
    '<div class="tp-sidebar-foot"><span class="material-symbols-rounded">golf_course</span><div><b>Greens mode</b><small>Per-green quantity × 18</small></div></div></aside>' +
    '<section class="tp-workspace"><div class="tp-category-tabs">' + categoryTabs + '</div>' +
    '<div class="tp-category-heading"><div><span class="tp-eyebrow">' + esc(area.toUpperCase()) + '</span><h3>' + esc(category) + '</h3><p>' + esc((TP_CATEGORIES.find(item => item.name === category) || {}).description || 'Select products and quantities.') + '</p></div>' +
    '<span class="tp-planned-count">' + existingCount + ' planned line' + (existingCount === 1 ? '' : 's') + ' in this range</span></div>' +
    '<div class="tp-product-list">' + (rows || '<div class="tp-empty-state"><span class="material-symbols-rounded">inventory_2</span><b>No ' + esc(category.toLowerCase()) + ' found</b><p>Add products to this category in Products &amp; Stock first.</p></div>') + '</div>' +
    '<label class="tp-notes-field"><span>Notes <small>(optional · this area and category)</small></span><textarea rows="2" placeholder="Purpose, rate reference, weather or operator instructions" data-tp-note data-area="' + esc(area) + '" data-category="' + esc(category) + '">' + esc(note) + '</textarea></label>' +
    '<div class="tp-category-footer"><div class="tp-save-explainer"><span class="material-symbols-rounded">info</span><span>Creates one dated plan per selected weekday. Stock is not deducted until an issue is recorded.</span></div>' +
    '<button type="button" class="btn btn-primary tp-save-tab" data-act="tp-save-tab"><span class="material-symbols-rounded">save</span>Save ' + esc(category) + '</button></div></section></div>';
}
async function saveTpCategoryTab() {
  const saveButton = document.querySelector('[data-act="tp-save-tab"]');
  if (saveButton) saveButton.disabled = true;
  const from = tpState.date;
  const until = tpState.validUntil;
  const weekdays = [...tpState.weekdays].sort((a, b) => a - b);
  const area = tpState.area;
  const category = tpState.category;
  try {
    if (!from || !until || until < from) { toast('Choose a valid plan date range.', 'err'); return; }
    if (!weekdays.length) { toast('Select at least one weekday.', 'err'); return; }
    const spanDays = Math.floor((new Date(until + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000) + 1;
    if (spanDays > 366) { toast('Keep a plan validity period within 366 days.', 'err'); return; }
    const dates = tpSelectedDates();
    if (!dates.length) { toast('No dates in this range match the selected weekdays.', 'err'); return; }

    const products = S.inventory.filter(item => turfCategoryLabel(item.category) === category);
    const desiredLines = new Map();
    for (const product of products) {
      const line = tpLineForProduct(product);
      const qty = Math.max(0, num(line.qty));
      if (!(qty > 0)) continue;
      const unit = turfProductUnit(product);
      if (!unit) { toast('Set the stock unit for ' + itemName(product) + ' in Products & Stock first.', 'err'); return; }
      const perGreen = area === 'Greens' && !!line.perGreen;
      const totalQty = qty * (perGreen ? 18 : 1);
      desiredLines.set(String(product.id), { product, qty, unit, perGreen, totalQty });
      if (totalQty > num(product.stockQuantity)) {
        toast('Planned quantity for ' + itemName(product) + ' exceeds current stock. The plan can still be saved, but replenishment may be needed.', 'warn');
      }
    }

    const allCategoryPlans = tpMatchingPlanRecords(area, category);
    // The existing app already uses validFrom, validUntil and repeatWeekdays for turf schedules.
    // Replacing an overlapping recurring series keeps this planner compatible with that same record shape.
    const overlappingProducts = new Set();
    for (const productId of desiredLines.keys()) {
      const conflict = allCategoryPlans.find(plan =>
        String(plan.productId || plan.itemId || plan.inventoryId || '') === productId &&
        tpIsRepeatSeries(plan) &&
        plan.validFrom !== from &&
        tpDateRangeOverlaps(plan.validFrom, plan.validUntil, from, until)
      );
      if (conflict) overlappingProducts.add(productId);
    }
    if (overlappingProducts.size) {
      const names = [...overlappingProducts].map(id => itemName(S.inventory.find(item => String(item.id) === id) || { partName: id }));
      toast('A recurring plan already overlaps this date range for ' + names.join(', ') + '. Edit that plan using its original start date, or choose a non-overlapping range.', 'err');
      return;
    }
    // Treat records anchored on this exact start date as the same series being edited.
    // Other series are left intact; overlapping series for the same product are blocked above.
    const oldSeries = allCategoryPlans.filter(plan =>
      tpIsRepeatSeries(plan) &&
      plan.validFrom === from &&
      tpDateRangeOverlaps(plan.validFrom, plan.validUntil, from, until)
    );
    const selectedDateSet = new Set(dates);
    const selectedSingleDatePlans = allCategoryPlans.filter(plan =>
      !tpIsRepeatSeries(plan) &&
      selectedDateSet.has(turfRecordDate(plan))
    );
    const replaceRecords = [...new Map([...oldSeries, ...selectedSingleDatePlans].map(plan => [plan.id, plan])).values()];
    if (!desiredLines.size && !replaceRecords.length) {
      toast('Enter a quantity for at least one product before saving this tab.', 'warn');
      return;
    }

    const noteKey = area + '::' + category;
    const note = String(tpState.notes[noteKey] || '').trim();
    const storedArea = area === 'Fairways' ? 'Fairway' : area;
    const desiredByDateProduct = new Map();
    for (const date of dates) {
      for (const line of desiredLines.values()) {
        desiredByDateProduct.set(date + '::' + line.product.id, { date, ...line });
      }
    }
    const batch = writeBatch(db);
    let writeCount = 0;
    const handled = new Set();
    const baseDate = new Date(from + 'T12:00:00');
    for (const record of replaceRecords) {
      const recordDate = turfRecordDate(record);
      const productId = String(record.productId || record.itemId || record.inventoryId || '');
      const key = recordDate + '::' + productId;
      const desired = desiredByDateProduct.get(key);
      if (desired && !handled.has(key)) {
        const line = desired;
        const dateObj = new Date(line.date + 'T12:00:00');
        const fields = {
          weekStart: getSunday(line.date),
          date: line.date,
          dayIndex: dateObj.getDay(),
          productId: line.product.id,
          productName: itemName(line.product),
          category: line.product.category || category,
          targetQty: line.totalQty,
          unit: line.unit,
          targetArea: storedArea,
          area: storedArea,
          scope: line.perGreen ? 'per_area' : 'overall',
          validFrom: from,
          validUntil: until,
          repeatWeekdays: weekdays,
          notes: note || 'Planned via Turf Treatment Planner',
          status: 'Planned'
        };
        batch.update(doc(db, CONFIG.COL.plans, record.id), fields);
        handled.add(key);
        writeCount++;
      } else {
        batch.delete(doc(db, CONFIG.COL.plans, record.id));
        writeCount++;
      }
    }
    for (const [key, line] of desiredByDateProduct.entries()) {
      if (handled.has(key)) continue;
      const dateObj = new Date(line.date + 'T12:00:00');
      const ref = doc(collection(db, CONFIG.COL.plans));
      batch.set(ref, {
        weekStart: getSunday(line.date),
        date: line.date,
        dayIndex: dateObj.getDay(),
        productId: line.product.id,
        productName: itemName(line.product),
        category: line.product.category || category,
        targetQty: line.totalQty,
        unit: line.unit,
        targetArea: storedArea,
        area: storedArea,
        scope: line.perGreen ? 'per_area' : 'overall',
        validFrom: from,
        validUntil: until,
        repeatWeekdays: weekdays,
        notes: note || 'Planned via Turf Treatment Planner',
        status: 'Planned',
        createdAt: Date.now()
      });
      writeCount++;
    }
    if (!writeCount) { toast('No changes to save for this tab.'); return; }
    if (writeCount > 450) {
      toast('This plan would update ' + writeCount + ' records. Shorten the date range or select fewer products.', 'err');
      return;
    }
    await batch.commit();
    toast(category + ' scheduled for ' + area + ' on ' + dates.length + ' date' + (dates.length === 1 ? '' : 's') + '.');
    renderTp();
  } catch (error) {
    console.error('Turf planner save failed:', error);
    toast('Could not save this treatment plan. Check the connection and try again.', 'err');
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}
document.addEventListener('input', event => {
  const target = event.target;
  if (!target || !target.closest) return;
  const qtyInput = target.closest('[data-tp-qty]');
  if (qtyInput) {
    const productId = qtyInput.dataset.product;
    const key = tpLineKey(tpState.area, tpState.category, productId);
    const previous = tpState.lines[key] || tpLineForProduct({ id: productId });
    tpState.lines[key] = { ...previous, qty: qtyInput.value };
    tpUpdateRowTotal(qtyInput);
    return;
  }
  const noteInput = target.closest('[data-tp-note]');
  if (noteInput) {
    tpState.notes[noteInput.dataset.area + '::' + noteInput.dataset.category] = noteInput.value;
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (!target || !target.closest) return;
  const dateInput = target.closest('[data-tp-date]');
  if (dateInput) {
    if (!dateInput.value) return;
    tpState.date = dateInput.value;
    if (!tpState.validUntil || tpState.validUntil < tpState.date) tpState.validUntil = tpState.date;
    if (!tpState.weekdaysTouched) tpState.weekdays = tpDefaultWeekdays(tpState.date);
    tpState.lines = {};
    tpState.notes = {};
    renderTp();
    return;
  }
  const untilInput = target.closest('[data-tp-until]');
  if (untilInput) {
    if (!untilInput.value) return;
    tpState.validUntil = untilInput.value < tpState.date ? tpState.date : untilInput.value;
    renderTp();
    return;
  }
  const weekdayInput = target.closest('[data-tp-weekday]');
  if (weekdayInput) {
    const day = Number(weekdayInput.value);
    const selected = new Set(tpState.weekdays);
    if (weekdayInput.checked) selected.add(day);
    else selected.delete(day);
    tpState.weekdays = [...selected].sort((a, b) => a - b);
    tpState.weekdaysTouched = true;
    renderTp();
    return;
  }
  const perGreenInput = target.closest('[data-tp-per-green]');
  if (perGreenInput) {
    const productId = perGreenInput.dataset.product;
    const key = tpLineKey(tpState.area, tpState.category, productId);
    const previous = tpState.lines[key] || tpLineForProduct({ id: productId });
    tpState.lines[key] = { ...previous, perGreen: perGreenInput.checked };
    tpUpdateRowTotal(perGreenInput);
  }
});




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
