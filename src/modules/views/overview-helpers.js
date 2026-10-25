/**
 * Small view-only helpers for the Insights dashboard.
 * They return markup and keep presentation logic separate from state/data services.
 */
export function createOverviewHelpers({ fmt }) {
  function tile(act, icon, tone, label, value, unit, sub) {
    return `<button class="kpi" data-act="${act}"><div class="top"><span class="lbl">${label}</span><span class="ic ${tone}"><span class="material-symbols-rounded">${icon}</span></span></div><div class="val">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="sub">${sub || ''}</div><span class="material-symbols-rounded go">arrow_forward</span></button>`;
  }
  function deltaTxt(a, b, goodWhenDown = false) {
    if (!(b > 0)) return ''; const p = (a - b) / b * 100; if (Math.abs(p) < 1) return ' · same as yesterday';
    return ` · <span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '?' : '?'} ${fmt(Math.abs(p), 0)}%</span> vs yesterday`;
  }
  return { tile, deltaTxt };
}
