/** Function-based Chart module. Dependencies are injected from the application context. */
export function createChartModule(deps) {
  const { fmt, sc } = deps;
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

  return { barChart, sparkline };
}
