/** Local expense, reimbursement and missing inventory-item workflows. */
export function createExpenseModule(deps) {
  const { $, CONFIG, S, STORE_CATS, addDoc, collection, db, doc, esc, fld, fmt, itemName, money, num, openForm, qsa, query, setHTML, toast, updateDoc } = deps;
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

function exRowHTML(){return '<div class="exp-row"><input class="exi-name" placeholder="Item name" autocomplete="off"><input class="exi-qty" type="number" min="0" step="any" value="1" inputmode="decimal"><input class="exi-rate" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal"><input class="exi-amt" readonly tabindex="-1" value="0.00"><button type="button" class="btn btn-sm exi-del" title="Remove item" aria-label="Remove item">✕</button><div class="exi-match muted sm"></div></div>';}
function exUpdateTotal(){let t=0;qsa('#exRows .exp-row').forEach(r=>{const a=Math.round(num(r.querySelector('.exi-qty').value)*num(r.querySelector('.exi-rate').value)*100)/100;r.querySelector('.exi-amt').value=a.toFixed(2);t+=a;});const el=$('#exTotal');if(el)el.textContent=money(t,2);}
function runNewItemQueue(expId,items,queue,total){
  const idx=queue.shift(); if(idx===undefined) return;
  const next=()=>setTimeout(()=>runNewItemQueue(expId,items,queue,total),60);
  openNewItemPopup({name:items[idx].itemName,qty:items[idx].qty,rate:items[idx].rate,expId,items,idx,next,pos:total-queue.length,total});
}

function setFilter(value) { expFilter = value || 'all'; }
function getFilter() { return expFilter; }
  return { normName, expAmount, expIsMine, expIsReclaimed, findInventoryByName, guessCategory, lookupCategoryOnline, expItems, renderLocalExpenseLedger, openNewItemPopup, exRowHTML, exUpdateTotal, runNewItemQueue, setFilter, getFilter };
}
