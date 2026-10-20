import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryService } from "../src/modules/store/inventory-service.js";

function setup({ item = { category: "Fuel", stockQuantity: 10, unitCost: 80 }, itemExists = true, receiptExists = false } = {}) {
  const calls = [];
  const db = { mock: true };
  const CONFIG = { COL: { inventory: "inventory", inwards: "store_inwards", movements: "store_movements" } };
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
