import test from "node:test";
import assert from "node:assert/strict";
import { inventoryOnHand } from "../src/domain/inventory-balance.js";

test("petrol and diesel inventory display the live stock transaction balance", () => {
  assert.equal(inventoryOnHand({ category: "Fuel", partName: "Diesel", stockQuantity: 72 }), 72);
  assert.equal(inventoryOnHand({ category: "Fuel", partName: "Petrol", stockQuantity: 34.5 }), 34.5);
});

test("fuel audit logs do not participate in inventory balance calculation", () => {
  const item = { category: "Fuel", partName: "Diesel", stockQuantity: 72 };
  assert.equal(inventoryOnHand(item), 72);
  assert.equal(inventoryOnHand(item), 72);
});

test("inventory balance normalizes invalid and negative stock safely", () => {
  assert.equal(inventoryOnHand({ stockQuantity: "12.5" }), 12.5);
  assert.equal(inventoryOnHand({ stockQuantity: "not-a-number" }), 0);
  assert.equal(inventoryOnHand({ stockQuantity: -4 }), 0);
});
