import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryService } from "../src/modules/store/inventory-service.js";

function setup({ item = { category: "Fuel", stockQuantity: 10, unitCost: 80 }, itemExists = true, receiptExists = false, plan = { productId: "turf-1", status: "Planned", targetQty: 10, targetArea: "Greens", productName: "Fertilizer" }, planExists = true } = {}) {
  const calls = [];
  const db = { mock: true };
  const CONFIG = { COL: { inventory: "inventory", inwards: "store_inwards", movements: "store_movements", plans: "turf_plans" } };
  const ref = (collection, id) => ({ collection, id });
  const service = createInventoryService({
    db, CONFIG,
    doc: (...args) => args.length === 1 ? ref(args[0].collection, "generated-" + (calls.length + 1)) :
      args.length === 2 ? ref(args[0], args[1]) : ref(args[1], args[2]),
    collection: (_db, name) => ({ collection: name }),
    runTransaction: async (_db, fn) => fn({
      get: async r => {
        calls.push(["get", r]);
        if (r.collection === "inventory") return { exists: () => itemExists, data: () => item };
        if (r.collection === "store_inwards") return { exists: () => receiptExists, data: () => ({}) };
        if (r.collection === "turf_plans") return { exists: () => planExists, data: () => plan };
        return { exists: () => false, data: () => ({}) };
      },
      set: (r, data) => calls.push(["set", r, data]),
      update: (r, data) => calls.push(["update", r, data])
    }),
    serverTimestamp: () => ({ serverTimestamp: true }),
    num: value => { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  });
  return { service, calls };
}
const receipt = {
  itemId: "diesel-1", expectedCategory: "Fuel", itemName: "Diesel", unit: "Litre",
  quantity: 25, rate: 90, gstPercent: 18, taxableAmount: 2250, gstAmount: 405, total: 2655,
  supplier: "Supplier A", invoiceNumber: "INV-100", receiptDate: "2026-10-17", notes: "Fuel delivery"
};

test("goods inward atomically updates stock, weighted average cost and receipt/movement ledgers", async () => {
  const { service, calls } = setup();
  await service.postGoodsInward(receipt);
  const itemUpdate = calls.find(c => c[0] === "update" && c[1].collection === "inventory");
  const receiptWrite = calls.find(c => c[0] === "set" && c[1].collection === "store_inwards");
  const movementWrite = calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  assert.equal(itemUpdate[2].stockQuantity, 35);
  assert.equal(itemUpdate[2].unitCost, 87.1429);
  assert.equal(receiptWrite[2].total, 2655);
  assert.equal(receiptWrite[2].transactionType, "INWARD");
  assert.equal(movementWrite[2].quantityDelta, 25);
  assert.equal(movementWrite[2].quantityAfter, 35);
});

test("goods inward rejects missing items, duplicate invoice/item and stale categories", async () => {
  await assert.rejects(setup({ itemExists: false }).service.postGoodsInward(receipt), /no longer exists/);
  await assert.rejects(setup({ receiptExists: true }).service.postGoodsInward(receipt), /already been posted/);
  await assert.rejects(setup({ item: { category: "Spare Parts", stockQuantity: 10, unitCost: 80 } }).service.postGoodsInward(receipt), /category changed/);
});

test("goods inward rejects invalid quantities and unreconciled invoice arithmetic", async () => {
  await assert.rejects(setup().service.postGoodsInward({ ...receipt, quantity: 0 }), /greater than zero/);
  await assert.rejects(setup().service.postGoodsInward({ ...receipt, taxableAmount: 1 }), /does not match/);
  await assert.rejects(setup().service.postGoodsInward({ ...receipt, total: 1 }), /does not reconcile/);
});

test("stock issue blocks negative stock and records before/after balances", async () => {
  const { service, calls } = setup({ item: { category: "Fuel", stockQuantity: 10, unitCost: 80 } });
  await assert.rejects(service.issueStock({ itemId: "diesel-1", quantity: 11, reason: "Fuel issue" }), /Insufficient stock/);
  assert.equal(calls.some(c => c[0] === "update"), false);
  const valid = setup({ item: { category: "Fuel", stockQuantity: 10, unitCost: 80 } });
  await valid.service.issueStock({ itemId: "diesel-1", quantity: 3, reason: "Fuel issue", issuedTo: "Workshop" });
  const update = valid.calls.find(c => c[0] === "update" && c[1].collection === "inventory");
  const movement = valid.calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  assert.equal(update[2].stockQuantity, 7);
  assert.equal(movement[2].quantityDelta, -3);
  assert.equal(movement[2].quantityBefore, 10);
  assert.equal(movement[2].quantityAfter, 7);
});

test("stock adjustment requires a reason, cannot be zero or create negative stock", async () => {
  const { service, calls } = setup({ item: { category: "Tools", stockQuantity: 4, unitCost: 20 } });
  await assert.rejects(service.adjustStock({ itemId: "tool-1", quantityDelta: -5, reason: "Count" }), /negative/);
  await assert.rejects(service.adjustStock({ itemId: "tool-1", quantityDelta: 0, reason: "Count" }), /non-zero/);
  await assert.rejects(service.adjustStock({ itemId: "tool-1", quantityDelta: -1, reason: "" }), /reason is required/);
  assert.equal(calls.some(c => c[0] === "update"), false);
  await service.adjustStock({ itemId: "tool-1", quantityDelta: 2, reason: "Physical stock count" });
  const movement = calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  assert.equal(movement[2].movementType, "ADJUSTMENT");
  assert.equal(movement[2].quantityAfter, 6);
});

test("opening stock is posted with an auditable opening movement", async () => {
  const { service, calls } = setup();
  await service.createItemWithOpeningBalance({ partName: "Spare belt", category: "Spare Parts", stockQuantity: 5, unitCost: 200, unit: "Nos" });
  assert.equal(calls.filter(c => c[0] === "set" && c[1].collection === "inventory").length, 1);
  const movement = calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  assert.equal(movement[2].movementType, "OPENING");
  assert.equal(movement[2].quantityAfter, 5);
});

test("local expense stock additions update weighted average cost and movement ledger", async () => {
  const { service, calls } = setup({ item: { category: "Tools", stockQuantity: 2, unitCost: 100 } });
  await service.postLocalPurchaseStock({ itemId: "tool-1", quantity: 3, rate: 150, reference: "expense-1" });
  const update = calls.find(c => c[0] === "update" && c[1].collection === "inventory");
  const movement = calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  assert.equal(update[2].stockQuantity, 5);
  assert.equal(update[2].unitCost, 130);
  assert.equal(movement[2].movementType, "LOCAL_PURCHASE");
  assert.equal(movement[2].reference, "expense-1");
});

test("turf plan issue atomically reduces stock, links movement, and advances plan status", async () => {
  const { service, calls } = setup({ item: { category: "Fertilizers", partName: "Fertilizer", unit: "Kg", stockQuantity: 10, unitCost: 80 } });
  await service.issueStockForTurfPlan({ planId: "plan-1", itemId: "turf-1", quantity: 6, issuedTo: "Greens", performedBy: "Storekeeper" });
  const stock = calls.find(c => c[0] === "update" && c[1].collection === "inventory");
  const move = calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  const plan = calls.find(c => c[0] === "update" && c[1].collection === "turf_plans");
  assert.equal(stock[2].stockQuantity, 4);
  assert.equal(move[2].movementType, "ISSUE");
  assert.equal(move[2].quantityDelta, -6);
  assert.equal(move[2].linkedPlanId, "plan-1");
  assert.equal(plan[2].status, "Issued");
  assert.equal(plan[2].issuedQty, 6);
  assert.equal(plan[2].issueMovementId, move[1].id);
});

test("turf plan issue rejects stale statuses, mismatched products and quantities above plan", async () => {
  await assert.rejects(setup({ plan: { productId: "turf-1", status: "Applied", targetQty: 10 } }).service.issueStockForTurfPlan({ planId: "plan-1", itemId: "turf-1", quantity: 1 }), /Only a Planned/);
  await assert.rejects(setup().service.issueStockForTurfPlan({ planId: "plan-1", itemId: "another-item", quantity: 1 }), /does not match/);
  await assert.rejects(setup().service.issueStockForTurfPlan({ planId: "plan-1", itemId: "turf-1", quantity: 11 }), /cannot exceed/);
});

test("turf completion returns unused stock with a traceable movement and requires exact reconciliation", async () => {
  const { service, calls } = setup({
    item: { category: "Fertilizers", partName: "Fertilizer", unit: "Kg", stockQuantity: 4, unitCost: 80 },
    plan: { productId: "turf-1", status: "Issued", issuedQty: 6, issueMovementId: "issue-1", issueReference: "TURFPLAN-plan-1", productName: "Fertilizer", targetArea: "Greens" }
  });
  await assert.rejects(service.completeTurfPlan({ planId: "plan-1", appliedQty: 4, returnedQty: 1, appliedBy: "Operator" }), /must equal the issued quantity/);
  await assert.rejects(service.completeTurfPlan({ planId: "plan-1", appliedQty: 4, returnedQty: 1, unaccountedQty: 1, appliedBy: "Operator" }), /notes/);
  await service.completeTurfPlan({ planId: "plan-1", appliedQty: 4, returnedQty: 1, unaccountedQty: 1, appliedBy: "Operator", applicationNotes: "One kg lost during handling" });
  const stock = calls.filter(c => c[0] === "update" && c[1].collection === "inventory").at(-1);
  const move = calls.find(c => c[0] === "set" && c[1].collection === "store_movements");
  const plan = calls.filter(c => c[0] === "update" && c[1].collection === "turf_plans").at(-1);
  assert.equal(stock[2].stockQuantity, 5);
  assert.equal(move[2].movementType, "TURF_RETURN");
  assert.equal(move[2].quantityDelta, 1);
  assert.equal(move[2].returnForMovementId, "issue-1");
  assert.equal(plan[2].status, "Applied");
  assert.equal(plan[2].appliedQty, 4);
  assert.equal(plan[2].returnedQty, 1);
  assert.equal(plan[2].unaccountedQty, 1);
});

test("legacy turf issue without a movement link cannot be marked applied", async () => {
  const { service, calls } = setup({ plan: { productId: "turf-1", status: "Issued", issuedQty: 6, targetArea: "Greens" } });
  await assert.rejects(service.completeTurfPlan({ planId: "plan-1", appliedQty: 6, appliedBy: "Operator" }), /no linked stock movement/);
  assert.equal(calls.some(c => c[0] === "update" && c[1].collection === "turf_plans"), false);
});
