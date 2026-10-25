/** Shared DOM, formatting and date helpers used by Clover Greens Ops modules. */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export const fmt = (n, d=1) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
export const money = (n, d=0) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d === 0 ? 0 : 2 });
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
export const monthStart = s => s.slice(0, 8) + '01';
export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const dShort = s => s ? `${+s.slice(8,10)} ${MON[+s.slice(5,7)-1]}` : '';
export const dLong = s => s ? `${+s.slice(8,10)} ${MON[+s.slice(5,7)-1]} ${s.slice(0,4)}` : '—';
export const fmtHrs = h => { h = num(h); return `${Math.floor(h)}h ${pad(Math.round((h % 1) * 60) % 60)}m`; };
export const sum = (a, k) => a.reduce((t, x) => t + num(x[k]), 0);
export const tsMs = v => !v ? 0 : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v.toMillis ? v.toMillis() : (Date.parse(v) || 0);
export const timeOf = ms => ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
export const ago = ms => { if (!ms) return 'just now'; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s/60)}m ago` : `${Math.round(s/3600)}h ago`; };
export function normDate(v, ts) {
  if (typeof v === 'string') {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  } else if (v && v.toDate) return ymd(v.toDate());
  else if (typeof v === 'number') return ymd(new Date(v < 1e12 ? v * 1000 : v));
  const t = tsMs(ts); return t ? ymd(new Date(t)) : '';
}
export function daysBetween(a, b) { const out = []; let d = a, n = 0; while (d <= b && n++ < 400) { out.push(d); d = addDays(d, 1); } return out; }
export function setHTML(el, html) { if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }
