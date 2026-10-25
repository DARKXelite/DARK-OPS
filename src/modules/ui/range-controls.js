/**
 * Date-range preset, label, and UI rendering helpers used by operational views.
 */
export function createRangeControlsModule(context) {
  const { R, today, addDays, monthStart, dLong, renderFuelModal, renderRunModal, renderLedger, renderShifts } = context;

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

  return { PRESETS, setPreset, rangeBar, rangeLabel, RER };
}
