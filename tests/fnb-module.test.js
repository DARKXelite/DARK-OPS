import test from "node:test";
import assert from "node:assert/strict";
import { pendingDays, orderBalance } from "../src/modules/fnb/fnb-module.js";

test("pending days are measured from the order date", () => {
  assert.equal(pendingDays({ orderDate: "2026-10-01" }, "2026-10-10"), 9);
});

test("pending days never go negative for future-dated orders", () => {
  assert.equal(pendingDays({ orderDate: "2026-10-11" }, "2026-10-10"), 0);
});

test("order balance accounts for partial receipts and never goes negative", () => {
  assert.equal(orderBalance({ orderedQty: 12, receivedQty: 5 }), 7);
  assert.equal(orderBalance({ orderedQty: 12, receivedQty: 14 }), 0);
});
