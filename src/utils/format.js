import { num } from "./number.js";

export const fmt = (n, d=1) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: d });
export const money = (n, d=0) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d === 0 ? 0 : 2 });
export const fmtHrs = h => { h = num(h); return `${Math.floor(h)}h ${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}m`; };
