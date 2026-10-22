import test from "node:test";
import assert from "node:assert/strict";
import { parseOrderRows, parseTextOrders } from "../src/modules/fnb/fnb-import.js";

test("detects flexible Excel header names and maps quantity, unit and supplier", () => {
  const result = parseOrderRows([
    ["Daily Indent Report"],
    ["Product Name", "Required Qty", "UOM", "Vendor Name", "Rate"],
    ["Tomatoes", 5, "Kgs", "Fresh Farm", 42],
    ["Milk", 12, "Ltr", "Dairy Co", 28]
  ]);
  assert.equal(result.headerDetected, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map(({ itemName, orderedQty, unit, supplier, expectedRate }) => ({ itemName, orderedQty, unit, supplier, expectedRate })),
    [
      { itemName: "Tomatoes", orderedQty: 5, unit: "Kg", supplier: "Fresh Farm", expectedRate: 42 },
      { itemName: "Milk", orderedQty: 12, unit: "Litre", supplier: "Dairy Co", expectedRate: 28 }
    ]
  );
});

test("parses common plain-text item and quantity layouts", () => {
  const result = parseTextOrders([
    "Tomatoes - 5 kg",
    "5 kg Onions",
    "Potatoes x 10",
    "Eggs: 30 nos",
    "this line has no quantity"
  ].join("\n"));
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows.map(row => [row.itemName, row.orderedQty, row.unit]), [
    ["Tomatoes", 5, "Kg"],
    ["Onions", 5, "Kg"],
    ["Potatoes", 10, "Nos"],
    ["Eggs", 30, "Nos"]
  ]);
  assert.equal(result.skipped.length, 1);
});

test("parses delimiter-separated rows without headers", () => {
  const result = parseTextOrders("Item\tQty\tUnit\nTomatoes\t5\tkg\nMilk\t2\tlitre");
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].itemName, "Tomatoes");
  assert.equal(result.rows[1].orderedQty, 2);
});
