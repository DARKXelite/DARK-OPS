const HEADER_ALIASES = {
  itemName: ["item", "item name", "product", "product name", "material", "material name", "description", "particulars", "ingredient", "stock item", "name"],
  orderedQty: ["qty", "quantity", "order qty", "ordered qty", "required qty", "required quantity", "indent qty", "request qty", "order quantity", "quantity required"],
  unit: ["unit", "uom", "units", "measure", "measurement"],
  expectedRate: ["rate", "unit rate", "price", "unit price", "expected rate", "cost", "rate per unit", "price per unit"],
  supplier: ["supplier", "vendor", "vendor name", "supplier name", "party"],
  orderDate: ["date", "order date", "ordered date", "indent date", "request date"],
  category: ["category", "group", "item category"],
  notes: ["notes", "remarks", "reference", "indent no", "order no"]
};
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const headerKey = value => clean(value).toLowerCase().replace(/[_\-./]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const numberValue = value => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = clean(value).replace(/[₹$,\s]/g, "").replace(/,/g, "");
  if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const UNIT_PATTERN = "(kg|kgs|kilograms?|g|gm|gms|grams?|l|ltr|litres?|liters?|ml|nos?|pcs?|pieces?|packs?|pkt|packets?|boxes|box|bottles?|trays?|dozen|dz)";
function normalizeUnit(value) {
  const u = clean(value).toLowerCase().replace(/\.$/, "");
  if (/^(kg|kgs|kilogram|kilograms)$/.test(u)) return "Kg";
  if (/^(g|gm|gms|gram|grams)$/.test(u)) return "Gram";
  if (/^(l|ltr|litre|litres|liter|liters)$/.test(u)) return "Litre";
  if (/^(ml)$/.test(u)) return "Ml";
  if (/^(no|nos|pc|pcs|piece|pieces)$/.test(u)) return "Nos";
  if (/^(pack|packs|pkt|packet|packets)$/.test(u)) return "Pack";
  if (/^(box|boxes)$/.test(u)) return "Box";
  if (/^(bottle|bottles)$/.test(u)) return "Bottle";
  if (/^(tray|trays)$/.test(u)) return "Tray";
  if (/^(dozen|dz)$/.test(u)) return "Dozen";
  return clean(value) || "Nos";
}
function detectHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(headerKey);
    const map = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      const idx = cells.findIndex(cell => aliases.includes(cell));
      if (idx >= 0) map[field] = idx;
    }
    const score = (map.itemName != null ? 3 : 0) + (map.orderedQty != null ? 3 : 0) + Object.keys(map).length;
    if (map.itemName != null && map.orderedQty != null && (!best || score > best.score)) best = { index: i, map, score };
  }
  return best;
}
function normalizeDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const s = clean(value);
  if (!s) return "";
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const p = s.split("-").map(Number);
    return p[0] + "-" + String(p[1]).padStart(2,"0") + "-" + String(p[2]).padStart(2,"0");
  }
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return year + "-" + String(Number(m[2])).padStart(2,"0") + "-" + String(Number(m[1])).padStart(2,"0");
  }
  return "";
}
function rowFromMapped(cells, map) {
  const itemName = clean(cells[map.itemName]);
  const orderedQty = numberValue(cells[map.orderedQty]);
  if (!itemName || orderedQty == null || orderedQty <= 0) return null;
  const rate = map.expectedRate == null ? null : numberValue(cells[map.expectedRate]);
  return {
    itemName, orderedQty,
    unit: map.unit == null ? "Nos" : normalizeUnit(cells[map.unit]),
    expectedRate: rate != null && rate >= 0 ? rate : 0,
    supplier: map.supplier == null ? "" : clean(cells[map.supplier]),
    orderDate: map.orderDate == null ? "" : normalizeDate(cells[map.orderDate]),
    category: map.category == null ? "" : clean(cells[map.category]),
    notes: map.notes == null ? "" : clean(cells[map.notes]),
    sourceRow: null
  };
}
function parseLooseRow(cells) {
  const parts = cells.map(clean).filter(Boolean);
  if (!parts.length) return null;
  const quantityIndex = parts.findIndex(v => numberValue(v) != null && numberValue(v) > 0);
  if (quantityIndex >= 0) {
    const itemParts = parts.filter((_, i) => i !== quantityIndex && numberValue(parts[i]) == null && !new RegExp("^" + UNIT_PATTERN + "$", "i").test(parts[i]));
    const itemName = clean(itemParts[0]);
    if (itemName && itemName.length <= 120) {
      const unitPart = parts.find(v => new RegExp("^" + UNIT_PATTERN + "$", "i").test(v));
      const rateCandidates = parts.map(numberValue).filter(v => v != null && v >= 0 && v !== numberValue(parts[quantityIndex]));
      return { itemName, orderedQty: numberValue(parts[quantityIndex]), unit: normalizeUnit(unitPart || "Nos"), expectedRate: rateCandidates[0] || 0, supplier: "", orderDate: "", category: "", notes: "", sourceRow: null };
    }
  }
  const line = parts.join(" ").replace(/^\s*(?:\d+[.)]\s*)/, "").trim();
  const unit = new RegExp("(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*" + UNIT_PATTERN + "(?:\\s|$)", "i");
  const unitMatch = line.match(unit);
  if (unitMatch) {
    const qty = Number(unitMatch[1]);
    const before = line.slice(0, unitMatch.index).replace(/[\s:–—-]+$/, "").trim();
    const after = line.slice(unitMatch.index + unitMatch[0].length).replace(/^[\s:–—-]+/, "").trim();
    const itemName = before || after;
    if (itemName && qty > 0) return { itemName, orderedQty: qty, unit: normalizeUnit(unitMatch[2]), expectedRate: 0, supplier: "", orderDate: "", category: "", notes: "", sourceRow: null };
  }
  const qtyLast = line.match(/^(.+?)\s*(?:[-:=x×]\s*|\s+)(\d+(?:\.\d+)?)\s*$/i);
  if (qtyLast && Number(qtyLast[2]) > 0) return { itemName: qtyLast[1].trim(), orderedQty: Number(qtyLast[2]), unit: "Nos", expectedRate: 0, supplier: "", orderDate: "", category: "", notes: "", sourceRow: null };
  const qtyFirst = line.match(/^(\d+(?:\.\d+)?)\s*[x×]?\s+(.+)$/i);
  if (qtyFirst && Number(qtyFirst[1]) > 0) return { itemName: qtyFirst[2].trim(), orderedQty: Number(qtyFirst[1]), unit: "Nos", expectedRate: 0, supplier: "", orderDate: "", category: "", notes: "", sourceRow: null };
  return null;
}
export function parseOrderRows(rows) {
  const normalized = (rows || []).map(row => Array.isArray(row) ? row : [row]).filter(row => row.some(cell => clean(cell)));
  const header = detectHeader(normalized);
  const parsed = [], skipped = [];
  const start = header ? header.index + 1 : 0;
  normalized.slice(start).forEach((cells, offset) => {
    let item = header ? rowFromMapped(cells, header.map) : parseLooseRow(cells);
    if (!item && header) item = parseLooseRow(cells);
    if (item) { item.sourceRow = start + offset + 1; parsed.push(item); }
    else if (cells.some(cell => clean(cell))) skipped.push({ sourceRow: start + offset + 1, text: cells.map(clean).filter(Boolean).join(" | ") });
  });
  return { rows: parsed, skipped, headerDetected: Boolean(header), headerRow: header ? header.index + 1 : null };
}
export function parseTextOrders(text) {
  const lines = String(text || "").split(/\r?\n/).map((line, i) => ({ line: line.trim(), sourceRow: i + 1 })).filter(row => row.line && !/^(?:item\s+name|item\s*[,|\t]\s*(?:qty|quantity)|[-=_*]{3,})$/i.test(row.line));
  const parsed = [], skipped = [];
  lines.forEach(({ line, sourceRow }) => {
    const cells = line.includes("\t") ? line.split("\t") : /[|;]/.test(line) ? line.split(/[|;]/) : line.split(/\s{2,}/);
    let item = parseLooseRow(cells);
    if (!item && cells.length === 1) item = parseLooseRow([line.replace(/\s+-\s+/g, " - ")]);
    if (item) { item.sourceRow = sourceRow; parsed.push(item); }
    else skipped.push({ sourceRow, text: line });
  });
  return { rows: parsed, skipped, headerDetected: false, headerRow: null };
}
