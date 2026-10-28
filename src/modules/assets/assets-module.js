/* Assets & Departments module. Fleet machines remain the canonical machine records. */
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const nowDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const state = { user:null, role:"", departments:[], types:[], machines:[], records:[], selectedDepartment:"all", search:"", error:"", unsub:[], departmentsLoaded:false, seedInFlight:false };
let root, navObserver, renderQueued = false;
const canManage = () => ["admin","manager"].includes(state.role);
const cleanKey = s => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60);
function notify(message, error=false) {
  let el = $("#assetsNotice", root);
  if (!el) return;
  el.textContent = message; el.className = "assets-notice" + (error ? " error" : "");
  el.hidden = false;
}
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
function addStyles() {
  if ($("#assetsModuleStyles")) return;
  const style = document.createElement("style");
  style.id = "assetsModuleStyles";
  style.textContent = `
    #v-assets{width:100%;min-height:50vh;color:var(--text,#f9f7f2)}
    #v-assets .assets-wrap{display:grid;gap:18px}
    #v-assets .assets-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    #v-assets .assets-toolbar input,#v-assets .assets-toolbar select,#v-assets .assets-form input,#v-assets .assets-form select,#v-assets .assets-form textarea{min-width:0;padding:10px 12px;border-radius:8px;border:1px solid var(--border,rgba(229,199,148,.2));background:#0b1510;color:#f9f7f2}
    #v-assets .assets-toolbar input{flex:1;min-width:190px}
    #v-assets .assets-toolbar select{min-width:190px}
    #v-assets .assets-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    #v-assets .assets-stat,#v-assets .assets-panel{background:rgba(25,61,45,.32);border:1px solid var(--border,rgba(229,199,148,.18));border-radius:12px;padding:16px}
    #v-assets .assets-stat small{display:block;color:var(--muted,#b8b3a8);text-transform:uppercase;font-size:10px;letter-spacing:.08em}
    #v-assets .assets-stat strong{display:block;margin-top:6px;font-size:24px}
    #v-assets .assets-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    #v-assets .assets-panel h3{margin:0;font-size:14px;text-transform:uppercase;letter-spacing:.04em}
    #v-assets .assets-panel p{margin:5px 0 0;color:var(--muted,#b8b3a8);font-size:12px}
    #v-assets .assets-table-wrap{overflow:auto}
    #v-assets table{width:100%;border-collapse:collapse;min-width:700px}
    #v-assets th,#v-assets td{text-align:left;padding:11px 10px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}
    #v-assets th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#cfc9b8}
    #v-assets td{font-size:12px}
    #v-assets .assets-sub{display:block;color:var(--muted,#b8b3a8);font-size:11px;margin-top:3px}
    #v-assets .assets-actions{display:flex;gap:6px;flex-wrap:wrap}
    #v-assets .assets-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:7px 11px;border:1px solid rgba(229,199,148,.25);border-radius:7px;background:rgba(255,255,255,.05);color:#f9f7f2;font:600 11px inherit;cursor:pointer}
    #v-assets .assets-btn.primary{background:#265942;border-color:rgba(229,199,148,.4)}
    #v-assets .assets-btn.danger{color:#ffb1a8;border-color:rgba(255,107,107,.3)}
    #v-assets .assets-tag{display:inline-flex;border-radius:5px;padding:3px 7px;background:rgba(229,199,148,.12);color:#e5c794;font-size:10px}
    #v-assets .assets-notice{padding:11px 13px;border:1px solid rgba(95,211,154,.25);border-radius:8px;background:rgba(34,82,60,.3);font-size:12px}
    #v-assets .assets-notice.error{border-color:rgba(255,107,107,.4);background:rgba(100,35,35,.25)}
    #v-assets .assets-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    #v-assets .assets-field{display:grid;gap:6px;min-width:0;font-size:11px;color:var(--muted,#b8b3a8)}
    #v-assets .assets-field.full{grid-column:1/-1}
    #v-assets .assets-field input,#v-assets .assets-field select,#v-assets .assets-field textarea{width:100%;font:inherit;font-size:12px;color:#f9f7f2}
    #v-assets .assets-field textarea{min-height:76px;resize:vertical}
    #v-assets .assets-empty{padding:26px;text-align:center;color:var(--muted,#b8b3a8);font-size:12px}
    #v-assets .assets-two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    #v-assets .assets-list{display:grid;gap:8px}
    #v-assets .assets-list-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:8px}
    #v-assets .assets-list-item b{font-size:12px}
    #v-assets .assets-list-item small{display:block;color:var(--muted,#b8b3a8);font-size:10px;margin-top:3px}
    #v-assets .assets-modal{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.75);display:grid;place-items:center;padding:18px}
    #v-assets .assets-modal-card{width:min(650px,100%);max-height:90vh;overflow:auto;background:#101c15;border:1px solid rgba(229,199,148,.3);border-radius:13px;padding:20px;box-shadow:0 20px 70px #000}
    #v-assets .assets-modal-card h3{margin:0 0 16px}
    #v-assets .assets-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
    @media(max-width:700px){#v-assets .assets-stats{grid-template-columns:1fr}#v-assets .assets-two-col{grid-template-columns:1fr}#v-assets .assets-form{grid-template-columns:1fr}#v-assets .assets-field.full{grid-column:auto}#v-assets .assets-panel{padding:12px}}
  `;
  document.head.appendChild(style);
}
function ensureView() {
  if (root) return;
  root = document.createElement("section");
  root.className = "view";
  root.id = "v-assets";
  root.innerHTML = `<div class="assets-wrap">
    <div id="assetsNotice" class="assets-notice" hidden></div>
    <div class="assets-stats"><div class="assets-stat"><small>Total assets</small><strong id="assetsTotal">—</strong></div><div class="assets-stat"><small>Fleet-linked assets</small><strong id="assetsFleetTotal">—</strong></div><div class="assets-stat"><small>Departments</small><strong id="assetsDeptTotal">—</strong></div></div>
    <div class="assets-toolbar"><input id="assetsSearch" placeholder="Search asset, serial number, category…" aria-label="Search assets"><select id="assetsDepartmentFilter" aria-label="Filter department"><option value="all">All departments</option></select><button class="assets-btn primary" data-assets-action="new-asset">＋ Add asset</button></div>
    <section class="assets-panel"><div class="assets-panel-head"><div><h3>Asset register</h3><p>Fleet machines are linked by their existing machine ID. No duplicate machine records.</p></div><button class="assets-btn" data-assets-action="masters">⚙ Masters</button></div><div class="assets-table-wrap" id="assetsTable"></div></section>
    <section class="assets-panel" id="assetsMasters" hidden><div class="assets-panel-head"><div><h3>Masters</h3><p>Manage departments, asset types and their custom fields.</p></div><button class="assets-btn" data-assets-action="close-masters">Close</button></div>
      <div class="assets-two-col"><div><h3 style="margin-bottom:10px">Departments</h3><form id="assetsDepartmentForm" class="assets-form"><label class="assets-field full">Department name<input name="name" required maxlength="80" placeholder="e.g. Gold Maintenance"></label><div class="assets-field full"><button class="assets-btn primary" type="submit">Add department</button></div></form><div class="assets-list" id="assetsDepartmentsList"></div></div>
      <div><h3 style="margin-bottom:10px">Asset types & fields</h3><form id="assetsTypeForm" class="assets-form"><label class="assets-field full">Type name<input name="name" required maxlength="80" placeholder="e.g. Workshop machinery"></label><label class="assets-field full">Department<select name="departmentId" required id="assetsTypeDepartment"></select></label><label class="assets-field full">Custom fields<textarea name="fields" rows="5" placeholder="One field per line: Serial number | text | required\nStarted date | date\nWarranty expiry | date\nPurchase cost | number"></textarea></label><div class="assets-field full"><small>Supported types: text, date, number, select, checkbox. For select options, use: Condition | select | Good, Fair, Poor</small><button class="assets-btn primary" type="submit">Save asset type</button></div></form><div class="assets-list" id="assetsTypesList"></div></div></div>
    </section>
  </div><div id="assetsModalHost"></div>`;
  $(".content")?.appendChild(root);
  $("#assetsSearch",root).addEventListener("input", e => { state.search=e.target.value.toLowerCase().trim(); renderTable(); });
  $("#assetsDepartmentFilter",root).addEventListener("change", e => { state.selectedDepartment=e.target.value; renderTable(); });
  $("#assetsDepartmentForm",root).addEventListener("submit", addDepartment);
  $("#assetsTypeForm",root).addEventListener("submit", addType);
  root.addEventListener("click", handleClick);
  root.addEventListener("submit", handleSubmit);
  root.addEventListener("change", event => {
    if (event.target.name === "assetDepartmentId" && event.target.closest("#assetsEditForm")) {
      const typeSelect = $("#assetsEditType",root);
      if (typeSelect) {
        const depId = event.target.value;
        typeSelect.innerHTML = '<option value="">Choose type</option>' + state.types.filter(t=>t.departmentId===depId).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
      }
      $("#assetsCustomFields",root).innerHTML = "";
    }
    if (event.target.id === "assetsEditType") {
      const type = state.types.find(t=>t.id===event.target.value);
      $("#assetsCustomFields",root).innerHTML = (type?.fields||[]).map(f => {
        if(f.type==="select") return `<label class="assets-field">${esc(f.label)}<select name="custom:${esc(f.key)}" ${f.required?"required":""}><option value="">Choose…</option>${(f.options||[]).map(o=>`<option>${esc(o)}</option>`).join("")}</select></label>`;
        if(f.type==="checkbox") return `<label class="assets-field"><span><input style="width:auto" name="custom:${esc(f.key)}" type="checkbox"> ${esc(f.label)}</span></label>`;
        return field(f.label,`custom:${f.key}`,"",f.type==="number"?"number":f.type==="date"?"date":"text",f.required);
      }).join("");
    }
  });
}
function injectNav() {
  const nav = $("#nav");
  if (!nav || !state.user || nav.querySelector('[data-assets-nav="1"]')) return;
  const button = document.createElement("button");
  button.className = "nav-btn";
  button.dataset.assetsNav = "1";
  button.title = "Assets";
  button.setAttribute("aria-label","Assets");
  button.innerHTML = '<span class="material-symbols-rounded">domain</span><span class="nl">Assets</span>';
  nav.appendChild(button);
}
function showAssets() {
  ensureView();
  $$(".view").forEach(v => v.classList.toggle("active", v === root));
  document.body.classList.remove("turf-board-mode","map-mode");
  const title = $("#pageTitle"), sub = $("#pageSub"), head = $("#viewHead"), tabs = $("#groupTabs");
  if (title) title.textContent = "ASSETS";
  if (sub) sub.textContent = "Department-wise asset register and lifecycle details";
  if (head) head.style.display = "";
  if (tabs) tabs.hidden = true;
  $$("#nav .nav-btn").forEach(b => b.classList.toggle("active", b === $('[data-assets-nav="1"]',document)));
  if (window.innerWidth < 900) $("#dockPill")?.classList.add("active");
  queueRender();
  loadRoleIfNeeded();
}
function hideAssets() { if (root) root.classList.remove("active"); const b = $('[data-assets-nav="1"]'); if (b) b.classList.remove("active"); }
function attachNav() {
  const nav = $("#nav");
  if (!nav) return;
  navObserver = new MutationObserver(() => injectNav());
  navObserver.observe(nav,{childList:true});
  injectNav();
  document.addEventListener("click", event => {
    const assetButton = event.target.closest?.('[data-assets-nav="1"]');
    if (assetButton) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      showAssets(); return;
    }
    if (event.target.closest?.("#nav .nav-btn")) hideAssets();
  }, true);
}
async function loadRoleIfNeeded() {
  if (!state.user || state.role) return;
  try {
    const snap = await getDoc(doc(db,"app_roles",state.user.uid));
    const data = snap.exists() ? snap.data() : {};
    state.role = data.active ? String(data.role || "") : "";
    if (!canManage()) {
      const masters = $('[data-assets-action="masters"]',root); if (masters) masters.hidden = true;
      $('[data-assets-action="new-asset"]',root).hidden = true;
    }
    queueRender();
  } catch (e) { console.error("Assets role lookup failed",e); }
}
function watchCollection(name,key) {
  const unsub = onSnapshot(query(collection(db,name),orderBy("name")), snap => {
    state[key] = snap.docs.map(d => ({id:d.id,...d.data()}));\n    if(key==="departments"){state.departmentsLoaded=true;ensureDefaultDepartment();}\n    queueRender();
  }, error => {
    console.error("Assets read failed",name,error);
    state.error = `Cannot read ${name}: ${error.code || error.message}`;
    queueRender();
  });
  state.unsub.push(unsub);
}
function startUser(user) {
  if (state.user?.uid === user?.uid) return;
  state.unsub.forEach(fn => fn()); state.unsub=[];
  state.user=user; state.role="";
  if (!user) { state.departments=[];state.types=[];state.records=[];state.machines=[];state.role="";return; }
  watchCollection("asset_departments","departments");
  watchCollection("asset_types","types");
  watchCollection("asset_records","records");
  loadRoleIfNeeded();
}
async function loadFleetMachines() {
  try {
    const snap = await getDocs(collection(db,"machines"));
    state.machines = snap.docs.map(d => ({id:d.id,...d.data(),_fleet:true}));
    queueRender();
  } catch (e) { console.error("Fleet asset lookup failed",e); }
}
function render() {
  if (!root) return;
  if (state.error) { notify(state.error,true); state.error=""; }
  $("#assetsTotal",root).textContent = state.machines.length + state.records.length;
  $("#assetsFleetTotal",root).textContent = state.machines.length;
  $("#assetsDeptTotal",root).textContent = state.departments.length;
  const filter = $("#assetsDepartmentFilter",root), typeDept=$("#assetsTypeDepartment",root);
  const deptOptions = state.departments.filter(d=>d.active!==false).map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("");
  if (filter) { const val=state.selectedDepartment; filter.innerHTML='<option value="all">All departments</option>'+deptOptions; filter.value=val==="all"||state.departments.some(d=>d.id===val)?val:"all"; }
  if (typeDept) { const old=typeDept.value; typeDept.innerHTML=deptOptions; if(state.departments.some(d=>d.id===old)) typeDept.value=old; }
  renderTable();
  renderMasters();
}
function departmentFor(asset) {
  const id = asset.assetDepartmentId || asset.departmentId || "";
  if (id) return state.departments.find(d=>d.id===id)?.name || asset.departmentName || "Unassigned";
  // Existing fleet machines are visible in the requested department by default, without writing to their records.
  return asset._fleet ? "Gold Maintenance" : "Unassigned";
}
function renderTable() {
  if (!root) return;
  const queryText=state.search, department=state.selectedDepartment;
  const assets = [
    ...state.machines.map(m=>({...m,_fleet:true,_name:m.assetName||m.name||"Unnamed machine",_type:m.assetTypeName||m.category||"Fleet machine"})),
    ...state.records.map(a=>({...a,_fleet:false,_name:a.name||"Unnamed asset",_type:a.assetTypeName||"Asset"}))
  ].filter(a=>{
    const depId=a.assetDepartmentId||a.departmentId||"";
    const depName=departmentFor(a);
    const selectedDepartmentName=state.departments.find(d=>d.id===department)?.name;
    const depOk=department==="all"||(depId===department)||(selectedDepartmentName && depName===selectedDepartmentName)||(department=== "unassigned" && depName==="Unassigned");
    const hay=`${a._name} ${a.serialNumber||""} ${a.serialNo||""} ${a._type} ${depName}`.toLowerCase();
    return depOk&&(!queryText||hay.includes(queryText));
  }).sort((a,b)=>a._name.localeCompare(b._name));
  const table=$("#assetsTable",root);
  if(!assets.length){table.innerHTML='<div class="assets-empty">No assets match this filter. Add a department in Masters or register an asset.</div>';return;}
  table.innerHTML=`<table><thead><tr><th>Asset</th><th>Department</th><th>Serial / ID</th><th>Started date</th><th>Source</th><th></th></tr></thead><tbody>${assets.map(a=>{
    const id=a._fleet?a.id:a.id, serial=a.serialNumber||a.serialNo||a.machineSerialNo||"—", started=a.startedDate||a.startDate||"—";
    return `<tr><td><b>${esc(a._name)}</b><span class="assets-sub">${esc(a._type)}</span></td><td>${esc(departmentFor(a))}</td><td>${esc(serial)}</td><td>${esc(started)}</td><td><span class="assets-tag">${a._fleet?"Fleet link":"Asset record"}</span></td><td><div class="assets-actions"><button class="assets-btn" data-assets-action="edit-asset" data-id="${esc(id)}" data-source="${a._fleet?"fleet":"record"}">Edit</button></div></td></tr>`;
  }).join("")}</tbody></table>`;
}
function renderMasters() {
  const d=$("#assetsDepartmentsList",root), t=$("#assetsTypesList",root);
  d.innerHTML=state.departments.map(x=>`<div class="assets-list-item"><div><b>${esc(x.name)}</b><small>${x.active===false?"Inactive":"Active"}</small></div><div class="assets-actions"><button class="assets-btn" data-assets-action="rename-department" data-id="${esc(x.id)}">Rename</button><button class="assets-btn danger" data-assets-action="toggle-department" data-id="${esc(x.id)}">${x.active===false?"Activate":"Disable"}</button></div></div>`).join("")||'<div class="assets-empty">No departments yet.</div>';
  t.innerHTML=state.types.map(x=>`<div class="assets-list-item"><div><b>${esc(x.name)}</b><small>${esc(state.departments.find(d=>d.id===x.departmentId)?.name||x.departmentName||"Department missing")} · ${(x.fields||[]).length} custom fields</small></div><button class="assets-btn" data-assets-action="edit-type" data-id="${esc(x.id)}">Edit</button></div>`).join("")||'<div class="assets-empty">No asset types yet.</div>';
}
function modal(title,body) {
  const host=$("#assetsModalHost",root);
  host.innerHTML=`<div class="assets-modal" data-assets-action="modal-backdrop"><div class="assets-modal-card" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${body}</div></div>`;
}
function field(label,name,value="",type="text",required=false) {
  return `<label class="assets-field">${esc(label)}<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${required?"required":""} maxlength="240"></label>`;
}
function openAssetForm(source,id) {
  const fleet=source==="fleet";
  const asset=fleet?state.machines.find(m=>m.id===id):state.records.find(m=>m.id===id);
  const a=asset||{};
  const selectedDep=a.assetDepartmentId||a.departmentId||(fleet?state.departments.find(d=>d.name.toLowerCase()==="gold maintenance")?.id:"")||"";
  const selectedType=a.assetTypeId||"";
  const depOptions=state.departments.filter(d=>d.active!==false).map(d=>`<option value="${esc(d.id)}" ${d.id===selectedDep?"selected":""}>${esc(d.name)}</option>`).join("");
  const typeOptions=state.types.filter(t=>!selectedDep||t.departmentId===selectedDep).map(t=>`<option value="${esc(t.id)}" ${t.id===selectedType?"selected":""}>${esc(t.name)}</option>`).join("");
  const fields=state.types.find(t=>t.id===selectedType)?.fields||[];
  const custom=fields.map(f=>{
    const v=(a.customFields||{})[f.key]??"";
    if(f.type==="select") return `<label class="assets-field">${esc(f.label)}<select name="custom:${esc(f.key)}" ${f.required?"required":""}><option value="">Choose…</option>${(f.options||[]).map(o=>`<option ${o===v?"selected":""}>${esc(o)}</option>`).join("")}</select></label>`;
    if(f.type==="checkbox") return `<label class="assets-field"><span><input style="width:auto" name="custom:${esc(f.key)}" type="checkbox" ${v?"checked":""}> ${esc(f.label)}</span></label>`;
    return field(f.label,`custom:${f.key}`,v,f.type==="number"?"number":f.type==="date"?"date":"text",f.required);
  }).join("");
  modal(fleet?"Edit fleet-linked asset":"Register asset",`<form id="assetsEditForm" class="assets-form" data-source="${source}" data-id="${esc(id||"")}">
    ${field("Asset name","name",a.assetName||a.name||"", "text",true)}
    <label class="assets-field">Department<select name="assetDepartmentId" required><option value="">Choose department</option>${depOptions}</select></label>
    <label class="assets-field">Asset type<select name="assetTypeId" id="assetsEditType" required><option value="">Choose type</option>${typeOptions}</select></label>
    ${field("Machine / asset serial number","serialNumber",a.serialNumber||a.serialNo||a.machineSerialNo||"")}
    ${field("Started / commissioned date","startedDate",a.startedDate||a.startDate||"","date")}
    ${field("Manufacturer","manufacturer",a.manufacturer||"")}
    ${field("Model","model",a.model||"")}
    ${field("Purchase date","purchaseDate",a.purchaseDate||"","date")}
    ${field("Warranty expiry","warrantyExpiry",a.warrantyExpiry||"","date")}
    <label class="assets-field full">Notes<textarea name="notes" maxlength="1500">${esc(a.notes||"")}</textarea></label>
    <div class="assets-field full"><small>Custom fields appear after selecting an asset type. Existing Fleet records stay in the machines collection.</small><div id="assetsCustomFields" class="assets-form">${custom}</div></div>
    <div class="assets-field full"><div class="assets-modal-actions"><button type="button" class="assets-btn" data-assets-action="close-modal">Cancel</button><button class="assets-btn primary" type="submit">Save asset details</button></div></div>
  </form>`);
}
function openTypeForm(type) {
  const t=type||{};
  const deptOptions=state.departments.filter(d=>d.active!==false).map(d=>`<option value="${esc(d.id)}" ${d.id===t.departmentId?"selected":""}>${esc(d.name)}</option>`).join("");
  const fields=(t.fields||[]).map(f=>`${f.label} | ${f.type}${f.required?" | required":""}${f.options?.length?" | "+f.options.join(", "):""}`).join("\n");
  modal(t.id?"Edit asset type":"Add asset type",`<form id="assetsTypeEditForm" class="assets-form" data-id="${esc(t.id||"")}">
    ${field("Type name","name",t.name||"","text",true)}
    <label class="assets-field">Department<select name="departmentId" required><option value="">Choose department</option>${deptOptions}</select></label>
    <label class="assets-field full">Custom fields<textarea name="fields" rows="7" placeholder="Serial number | text | required\nStarted date | date\nCondition | select | Good, Fair, Poor">${esc(fields)}</textarea></label>
    <div class="assets-field full"><small>One field per line. Types: text, date, number, select, checkbox. For select fields, list options after the type. Field labels become stable keys when first created.</small></div>
    <div class="assets-field full"><div class="assets-modal-actions"><button type="button" class="assets-btn" data-assets-action="close-modal">Cancel</button><button class="assets-btn primary" type="submit">Save type</button></div></div>
  </form>`);
}
function parseFields(text) {
  return String(text||"").split("\n").map(line=>line.trim()).filter(Boolean).map(line=>{
    const parts=line.split("|").map(s=>s.trim()), label=parts[0], type=(parts[1]||"text").toLowerCase();
    if(!label) return null;
    const safeType=["text","date","number","select","checkbox"].includes(type)?type:"text";
    const required=parts.some(p=>p.toLowerCase()==="required");
    const options=safeType==="select"?(parts.slice(2).join("|").split(",").map(s=>s.trim()).filter(Boolean)):undefined;
    return {key:cleanKey(label),label,type:safeType,required,...(options?{options}:{})};
  }).filter(f=>f&&f.key);
}
async function ensureDefaultDepartment() {\n  if(!canManage()||!state.departmentsLoaded||state.seedInFlight||state.departments.some(d=>d.name?.trim().toLowerCase()==="gold maintenance")) return;\n  state.seedInFlight=true;\n  try { await addDoc(collection(db,"asset_departments"),{name:"Gold Maintenance",normalizedName:"gold maintenance",active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:state.user.uid,updatedBy:state.user.uid}); }\n  catch(e) { console.warn("Could not create default Gold Maintenance department",e); }\n  finally { state.seedInFlight=false; }\n}\nasync function addDepartment(event) {
  event.preventDefault(); if(!canManage()) return notify("Only an admin or manager can change Masters.",true);
  const form=event.currentTarget, name=new FormData(form).get("name").trim();
  if(!name) return;
  if(state.departments.some(d=>d.name.toLowerCase()===name.toLowerCase())) return notify("That department already exists.",true);
  try { await addDoc(collection(db,"asset_departments"),{name,normalizedName:name.toLowerCase(),active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:state.user.uid,updatedBy:state.user.uid}); form.reset(); notify("Department added."); }
  catch(e){notify(`Could not save department: ${e.code||e.message}`,true);}
}
async function addType(event) {
  event.preventDefault(); if(!canManage()) return notify("Only an admin or manager can change Masters.",true);
  const form=event.currentTarget;\n  const f=new FormData(form),name=String(f.get("name")||"").trim(),departmentId=String(f.get("departmentId")||"");
  if(!name||!departmentId) return notify("Type name and department are required.",true);
  const department=state.departments.find(d=>d.id===departmentId); if(!department) return notify("Choose a valid department.",true);
  const fields=parseFields(f.get("fields"));
  const existing=state.types.find(t=>t.name.toLowerCase()===name.toLowerCase()&&t.departmentId===departmentId);
  try {
    const data={name,departmentId,departmentName:department.name,fields,active:true,updatedAt:serverTimestamp(),updatedBy:state.user.uid};
    if(existing) await updateDoc(doc(db,"asset_types",existing.id),data);
    else await addDoc(collection(db,"asset_types"),{...data,createdAt:serverTimestamp(),createdBy:state.user.uid});
    form.reset(); notify("Asset type and field definitions saved.");
  } catch(e){notify(`Could not save asset type: ${e.code||e.message}`,true);}
}
async function saveAsset(form) {
  if(!canManage()) return notify("Only an admin or manager can edit asset details.",true);
  const f=new FormData(form),source=form.dataset.source,id=form.dataset.id||"",fleet=source==="fleet";
  const name=String(f.get("name")||"").trim(),departmentId=String(f.get("assetDepartmentId")||""),typeId=String(f.get("assetTypeId")||"");
  if(!name||!departmentId||!typeId) return notify("Asset name, department and type are required.",true);
  const dep=state.departments.find(d=>d.id===departmentId),type=state.types.find(t=>t.id===typeId);
  if(!dep||!type||type.departmentId!==departmentId) return notify("Asset type must belong to the selected department.",true);
  const customFields={};
  for(const [key,value] of f.entries()) if(key.startsWith("custom:")) customFields[key.slice(7)]=value;
  form.querySelectorAll('input[type="checkbox"][name^="custom:"]').forEach(input=>customFields[input.name.slice(7)]=input.checked);
  const data={assetDepartmentId:departmentId,departmentId,departmentName:dep.name,assetTypeId:typeId,assetTypeName:type.name,serialNumber:String(f.get("serialNumber")||"").trim(),startedDate:String(f.get("startedDate")||""),manufacturer:String(f.get("manufacturer")||"").trim(),model:String(f.get("model")||"").trim(),purchaseDate:String(f.get("purchaseDate")||""),warrantyExpiry:String(f.get("warrantyExpiry")||""),notes:String(f.get("notes")||"").trim(),customFields,assetUpdatedAt:serverTimestamp(),assetUpdatedBy:state.user.uid};
  try {
    if(fleet) {
      const machine=state.machines.find(m=>m.id===id); if(!machine) throw new Error("Fleet machine no longer exists. Refresh and try again.");
      await updateDoc(doc(db,"machines",id),{...data,assetName:name});
    } else if(id) {
      await updateDoc(doc(db,"asset_records",id),{...data,name});
    } else {
      await addDoc(collection(db,"asset_records"),{...data,name,createdAt:serverTimestamp(),createdBy:state.user.uid});
    }
    $("#assetsModalHost",root).innerHTML=""; await loadFleetMachines(); notify("Asset details saved."); queueRender();
  } catch(e){notify(`Could not save asset: ${e.code||e.message}`,true);}
}
async function handleSubmit(event) {
  if(event.target.id==="assetsEditForm"){event.preventDefault();await saveAsset(event.target);}
  if(event.target.id==="assetsTypeEditForm"){
    event.preventDefault();if(!canManage())return notify("Only an admin or manager can change Masters.",true);
    const form=event.target,f=new FormData(form),name=String(f.get("name")||"").trim(),departmentId=String(f.get("departmentId")||"");
    const department=state.departments.find(d=>d.id===departmentId);if(!name||!department)return notify("Type name and department are required.",true);
    const id=form.dataset.id,existing=state.types.find(t=>t.id===id),data={name,departmentId,departmentName:department.name,fields:parseFields(f.get("fields")),active:true,updatedAt:serverTimestamp(),updatedBy:state.user.uid};
    try{if(id)await updateDoc(doc(db,"asset_types",id),data);else await addDoc(collection(db,"asset_types"),{...data,createdAt:serverTimestamp(),createdBy:state.user.uid});$("#assetsModalHost",root).innerHTML="";notify("Asset type saved.");}
    catch(e){notify(`Could not save asset type: ${e.code||e.message}`,true);}
  }
}
async function handleClick(event) {
  const button=event.target.closest("[data-assets-action]"); if(!button)return;
  const action=button.dataset.assetsAction,id=button.dataset.id;
  if(action==="masters"){if(!canManage())return notify("Only an admin or manager can manage Masters.",true);$("#assetsMasters",root).hidden=false;$("#assetsMasters",root).scrollIntoView({behavior:"smooth",block:"start"});}
  if(action==="close-masters")$("#assetsMasters",root).hidden=true;
  if(action==="new-asset"){if(!canManage())return notify("Only an admin or manager can add assets.",true);openAssetForm("record","");}
  if(action==="edit-asset"){if(!canManage())return notify("Only an admin or manager can edit assets.",true);openAssetForm(button.dataset.source,id);}
  if(action==="close-modal")$("#assetsModalHost",root).innerHTML="";
  if(action==="modal-backdrop"&&event.target===button)$("#assetsModalHost",root).innerHTML="";
  if(action==="edit-type")openTypeForm(state.types.find(t=>t.id===id));
  if(action==="rename-department"){
    if(!canManage())return;const d=state.departments.find(x=>x.id===id);if(!d)return;
    const name=prompt("Department name",d.name);if(!name||!name.trim())return;
    if(state.departments.some(x=>x.id!==id&&x.name.toLowerCase()===name.trim().toLowerCase()))return notify("That department already exists.",true);
    try{await updateDoc(doc(db,"asset_departments",id),{name:name.trim(),normalizedName:name.trim().toLowerCase(),updatedAt:serverTimestamp(),updatedBy:state.user.uid});notify("Department renamed.");}catch(e){notify(`Could not rename: ${e.code||e.message}`,true);}
  }
  if(action==="toggle-department"){
    if(!canManage())return;const d=state.departments.find(x=>x.id===id);if(!d)return;
    try{await updateDoc(doc(db,"asset_departments",id),{active:d.active===false,updatedAt:serverTimestamp(),updatedBy:state.user.uid});notify(d.active===false?"Department activated.":"Department disabled.");}catch(e){notify(`Could not update department: ${e.code||e.message}`,true);}
  }
}
function installAuthObserver() {
  const auth = getApps().length ? null : null;
  // The host application reveals its authenticated state by removing auth-locked.
  const bodyObserver=new MutationObserver(()=>{
    const user=window.__cloverOpsUser||null;
    if(user) startUser(user);
    if(!document.body.classList.contains("auth-locked")) { ensureView(); injectNav(); }
  });
  bodyObserver.observe(document.body,{attributes:true,attributeFilter:["class"]});
  // Read the Firebase auth user directly from the existing app auth instance.
  import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js").then(({getAuth,onAuthStateChanged})=>{
    onAuthStateChanged(getAuth(app),user=>{
      startUser(user);
      if(user){ensureView();injectNav();loadFleetMachines();}
    });
  }).catch(e=>console.error("Assets auth observer failed",e));
}
function boot() { addStyles(); attachNav(); installAuthObserver(); }
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
