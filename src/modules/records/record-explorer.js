const asText = value => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(asText).join(" ");
  return Object.entries(value).map(([key, item]) => key + " " + asText(item)).join(" ");
};

/**
 * Normalize operational collections into one read-only activity feed.
 * Source documents are preserved verbatim so drill-down/export can retain provenance.
 */
export function buildOperationalRecordFeed(state = {}, sourceKeys = [], dateFor = () => "") {
  return sourceKeys.flatMap(source => (state[source] || []).map(record => ({
    id: String(record?.id ?? ""),
    source,
    date: String(dateFor(source, record) || ""),
    record
  })));
}

export function filterOperationalRecordFeed(rows = [], {
  source = "all", query = "", from = "", to = ""
} = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return rows.filter(row => {
    if (source !== "all" && row.source !== source) return false;
    if (from && (!row.date || row.date < from)) return false;
    if (to && (!row.date || row.date > to)) return false;
    if (!needle) return true;
    return [row.source, row.id, row.date, asText(row.record)].join(" ").toLowerCase().includes(needle);
  }).sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.id || "").localeCompare(String(a.id || ""))
  );
}

/** Counts lifecycle states without confusing "issued" with proof of application. */
export function summarizeTurfLifecycle(plans = [], asOf = "") {
  const rows = plans.filter(p => !asOf || String(p.date || p.appliedDate || p.plannedDate || "").slice(0, 10) <= asOf);
  const status = p => String(p.status ?? p.turfStatus ?? p.applicationStatus ?? "Planned").trim().toLowerCase();
  const counts = { planned: 0, issued: 0, applied: 0, cancelled: 0, overdue: 0, issuedWithoutMovementLink: 0, appliedWithoutRecordedQuantity: 0 };
  rows.forEach(p => {
    const s = status(p);
    if (s === "planned") {
      counts.planned++;
      const d = String(p.date || p.plannedDate || "").slice(0, 10);
      if (asOf && d && d < asOf) counts.overdue++;
    } else if (s === "issued") {
      counts.issued++;
      if (!p.issueMovementId) counts.issuedWithoutMovementLink++;
    } else if (s === "applied") {
      counts.applied++;
      if (!p.issueMovementId) counts.issuedWithoutMovementLink++;
      if (!(Number(p.appliedQty) > 0)) counts.appliedWithoutRecordedQuantity++;
    } else if (s === "cancelled") counts.cancelled++;
  });
  return { ...counts, total: rows.length, tracked: counts.issued + counts.applied };
}
