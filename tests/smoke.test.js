import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normDate, addDays, monthStart } from "../src/utils/date.js";
import { num } from "../src/utils/number.js";
import { createTurfRecordHelpers } from "../src/domain/turf-records.js";
import { createCostAnalytics } from "../src/analytics/cost-analytics.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("page shell loads extracted CSS and JavaScript modules", async () => {
  const html = await read("../index.html");
  assert.match(html, /href="\/src\/styles\/app\.css"/);
  assert.match(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script\s+type="module"\s*>/i);
});

test("Firebase client preserves SDK version and Firestore collections", async () => {
  const client = await read("../src/firebase/client.js");
  for (const sdk of ["firebase-app.js", "firebase-firestore.js", "firebase-auth.js"]) {
    assert.ok(client.includes("firebasejs/10.7.1/" + sdk), "missing pinned SDK " + sdk);
  }
  for (const collection of ["users", "machines", "fuel_logs", "shifts", "CourseZones", "live_telemetry", "inventory", "logs", "maintenance_logs", "assignment_logs", "turf_plans", "store_inwards"]) {
    assert.ok(client.includes(collection), "missing existing collection " + collection);
  }
});

test("dashboard entry imports the extracted services", async () => {
  const js = await read("../src/main.js");
  const css = await read("../src/styles/app.css");
  assert.match(js, /import \{[^}]*\baddDoc\b[^}]*\bupdateDoc\b[^}]*\bincrement\b[^}]*\} from .*firebase-firestore\.js/);
  assert.match(js, /createFirestoreRepository\(/);
  for (const modulePath of ["./modules/store/inventory-service.js", "./modules/turf/planner-service.js", "./modules/turf/turf-ops-module.js", "./modules/fleet/fleet-module.js", "./ui/navigation.js", "./firebase/client.js", "./utils/date.js", "./utils/format.js", "./ui/dom.js", "./domain/turf-records.js", "./analytics/cost-analytics.js"]) {
    assert.ok(js.includes(modulePath), "missing import " + modulePath);
  }
  assert.ok(css.includes(":root"));
  assert.ok(css.includes("--bg"));
});

test("date helpers normalize India-style and ISO dates", () => {
  assert.equal(normDate("2026-10-17"), "2026-10-17");
  assert.equal(normDate("17/10/2026"), "2026-10-17");
  assert.equal(addDays("2026-10-17", 1), "2026-10-18");
  assert.equal(monthStart("2026-10-17"), "2026-10-01");
  assert.equal(num("12.5"), 12.5);
});

test("turf record helpers normalize status, quantity and inventory matching", () => {
  const inventory = [{ id: "fert-1", partName: "Nitrogen Mix", category: "Fertilizers", unit: "Kg" }];
  const turf = createTurfRecordHelpers({ getInventory: () => inventory, normDate, num, itemName: i => i.partName });
  assert.equal(turf.isTurfCategory("Fertilizers"), true);
  assert.equal(turf.turfRecordStatus({ status: "Issued" }), "Issued");
  assert.equal(turf.turfRecordStatus({ status: "Applied" }), "Applied");
  assert.equal(turf.turfRecordQuantity({ issuedQty: "2.5" }), 2.5);
  assert.equal(turf.turfProductForPlan({ productName: "Nitrogen Mix" }).id, "fert-1");
  assert.equal(turf.turfPlanCategory({ productId: "fert-1", category: "Other" }), "Fertilizers");
});

test("cost analytics uses recorded or inventory rates and leaves unknown fuel unpriced", () => {
  const state = {
    fuel: [],
    shifts: [],
    inventory: [
      { id: "d", partName: "Diesel", category: "Fuel", unitCost: 92 },
      { id: "p", partName: "Petrol", category: "Fuel", unitCost: 0, stockQuantity: 50 }
    ],
    plans: [], logs: [], maintenance: [], machines: []
  };
  const cost = { dieselRate: 92.5, petrolRate: 0, labourPerHour: 0, downtimePerHour: 0, savingsPct: 10, improvementCost: 0 };
  const svc = createCostAnalytics({
    state, cost, num, today: () => "2026-10-17", monthStart: d => d.slice(0,8)+"01",
    addDays: (d,n) => { const x = new Date(d+"T00:00:00"); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); },
    fuelIn: (from,to) => state.fuel.filter(r => r.date >= from && r.date <= to),
    shiftsIn: () => [], sum: () => 0, svc: () => ({remaining:100}),
    CONFIG: { SERVICE_WARN: 25 }, effectiveReorderLevel: i => i.reorderLevel || 0,
    fuelMasterRate: type => { const matches = state.inventory.filter(i => i.partName.toLowerCase() === String(type).toLowerCase() && i.category === "Fuel"); return matches.length === 1 && matches[0].unitCost > 0 ? {rate:matches[0].unitCost,source:"Inventory Master"} : {rate:0,source:"Fuel master rate missing"}; },
    fuelTypeForCost: row => row.fuelType || "Unspecified", normDate
  });
  assert.equal(svc.fuelLogCost({ litres: 10, fuelType: "Diesel" }), 920);
  assert.equal(svc.fuelLogCost({ litres: 5, fuelType: "Petrol" }), 0);
  assert.equal(svc.fuelCostSummary([{litres:10,fuelType:"Diesel"},{litres:5,fuelType:"Petrol"}]).unpricedLitres, 5);
});
