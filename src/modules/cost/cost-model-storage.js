/**
 * Persistent settings for the operating-cost model.
 * Storage is injected so validation can be tested without browser globals.
 */
export const COST_DEFAULTS = Object.freeze({
  dieselRate: 92.50,
  petrolRate: 0,
  labourPerHour: 0,
  downtimePerHour: 0,
  savingsPct: 10,
  improvementCost: 0
});

export function loadCostModel(storage) {
  try {
    const saved = JSON.parse(storage?.getItem("cloverOpsCostModel") || "{}");
    return {
      ...COST_DEFAULTS,
      ...Object.fromEntries(Object.keys(COST_DEFAULTS).map(key => [
        key,
        Number.isFinite(+saved[key]) && +saved[key] >= 0 ? +saved[key] : COST_DEFAULTS[key]
      ]))
    };
  } catch (_) {
    return { ...COST_DEFAULTS };
  }
}

export function persistCostModel(cost, storage) {
  try {
    storage?.setItem("cloverOpsCostModel", JSON.stringify(cost));
  } catch (_) {
    // Preferences are non-critical: a blocked/full storage area must not crash the app.
  }
}
