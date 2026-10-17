export const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const sum = (a, k) => a.reduce((t, x) => t + num(x[k]), 0);
