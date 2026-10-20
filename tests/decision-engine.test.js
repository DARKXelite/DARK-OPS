import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInventory } from "../src/modules/analytics/decision-engine.js";

const item = { id: "fert-1", partName: "Nitrogen Mix", category: "Fertilizers", unit: "Kg", stockQuantity: 4, unitCost: 100, reorderLevel: 2 };
const movements = [
  { id:"m1", itemId:"fert-1", movementType:"ISSUE", quantityDelta:-5, unitCost:100, createdAt:"2026-05-10" },
  { id:"m2", itemId:"fert-1", movementType:"ISSUE", quantityDelta:-8, unitCost:100, createdAt:"2026-06-10" },
  { id:"m3", itemId:"fert-1", movementType:"ISSUE", quantityDelta:-9, unitCost:100, createdAt:"2026-07-10" },
  { id:"m4", itemId:"fert-1", movementType:"ISSUE", quantityDelta:-12, unitCost:100, createdAt:"2026-08-10" },
  { id:"m5", itemId:"fert-1", movementType:"ISSUE", quantityDelta:-14, unitCost:100, createdAt:"2026-09-10" },
  { id:"m6", itemId:"fert-1", movementType:"ISSUE", quantityDelta:-18, unitCost:100, createdAt:"2026-10-10" }
];

test("decision engine builds explainable ABC/XYZ, forecast and reorder recommendations", () => {
  const result = analyzeInventory({ items:[item], movements, asOf:"2026-10-20", leadDays:7, orderCost:250, annualHoldingRate:0.2 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].abc, "A");
  assert.ok(["X","Y","Z"].includes(result.items[0].demandClass));
  assert.ok(result.items[0].reorderPoint > 0);
  assert.ok(result.items[0].safetyStock >= 0);
  assert.ok(result.items[0].eoq > 0);
  assert.ok(result.items[0].forecast30 >= 0);
  assert.ok(result.summary.totalIssuedValue > 0);
  assert.ok(result.limitations.some(x => x.includes("legacy fuel and turf")));
});

test("physical count variance is surfaced as an insight and quantified as exposure", () => {
  const result = analyzeInventory({
    items:[item], movements,
    counts:[{id:"c1",itemId:"fert-1",itemName:"Nitrogen Mix",countDate:"2026-10-20",expectedQuantity:4,countedQuantity:2,varianceQuantity:-2,unitCost:100,varianceValue:-200,status:"VARIANCE_REVIEW"}],
    asOf:"2026-10-20"
  });
  assert.equal(result.summary.varianceCount, 1);
  assert.equal(result.summary.varianceExposure, 200);
  assert.ok(result.insights.some(x => x.title.includes("physical count variance")));
  assert.equal(result.variances[0].varianceQuantity, -2);
});

test("robust anomaly detector flags an unusually large issue day when baseline is sufficient", () => {
  const rows = [1,2,2,3,2,1,3,18].map((q,i)=>({id:"a"+i,itemId:"fert-1",movementType:"ISSUE",quantityDelta:-q,createdAt:"2026-10-"+String(1+i).padStart(2,"0")}));
  const result = analyzeInventory({items:[item],movements:rows,asOf:"2026-10-20"});
  assert.ok(result.anomalies.some(a=>a.quantity===18));
});

test("unknown unit costs stay unpriced instead of being fabricated", () => {
  const result = analyzeInventory({items:[{...item,unitCost:0}],movements:[],asOf:"2026-10-20"});
  assert.equal(result.summary.unpricedCount,1);
  assert.equal(result.items[0].value,0);
  assert.ok(result.insights.some(x=>x.title.includes("unknown cost")));
});
