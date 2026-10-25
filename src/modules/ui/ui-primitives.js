/** Function-based UIPrimitives module. Dependencies are injected from the application context. */
export function createUIPrimitivesModule(deps) {
  const { $, CONFIG, db, deleteDoc, doc, esc, setCurModalRenderer } = deps;
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
function closeModal() { $('#overlay').classList.remove('open'); setCurModalRenderer(null); }
function openForm({ title, html, submit = 'Save', danger = false, onSubmit }) {
  setCurModalRenderer(null);
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

  return { toast, setConn, openModal, closeModal, openForm, confirmDelete, openDrawer, closeDrawer, downloadCSV };
}
