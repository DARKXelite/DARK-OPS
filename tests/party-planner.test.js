import test from "node:test";
import assert from "node:assert/strict";
import {
  unitKey, convertPortionToPurchaseUnit, calculateRecipeCost
} from "../src/modules/fnb/party-planner.js";

test("purchase UOP aliases normalize to compatible mass, volume and count units", () => {
  assert.equal(unitKey("Kgs."), "kg");
  assert.equal(unitKey("Gram"), "g");
  assert.equal(unitKey("Litre"), "l");
  assert.equal(unitKey("Pcs"), "nos");
  assert.equal(convertPortionToPurchaseUnit(150, "g", "Kg"), 0.15);
  assert.equal(convertPortionToPurchaseUnit(200, "ml", "Litre"), 0.2);
  assert.equal(convertPortionToPurchaseUnit(2, "pcs", "Nos"), 2);
  assert.equal(convertPortionToPurchaseUnit(1, "cup", "Kg"), null);
});

test("recipe costing scales portions by PAX and compares stock in purchase UOP", () => {
  const inventory = [
    { id: "rice", partName: "Rice", unit: "Kg", unitCost: 80, stockQuantity: 20 },
    { id: "chicken", partName: "Chicken", unit: "Kg", unitCost: 240, stockQuantity: 35 }
  ];
  const recipe = {
    ingredients: [
      { itemId: "rice", portionQty: 150, portionUnit: "g" },
      { itemId: "chicken", portionQty: 200, portionUnit: "g" }
    ]
  };
  const result = calculateRecipeCost(recipe, 250, inventory);
  assert.equal(result.priced, true);
  assert.equal(result.lines[0].requiredQty, 37.5);
  assert.equal(result.lines[0].lineCost, 3000);
  assert.equal(result.lines[0].shortage, 17.5);
  assert.equal(result.lines[1].requiredQty, 50);
  assert.equal(result.lines[1].lineCost, 12000);
  assert.equal(result.lines[1].shortage, 15);
  assert.equal(result.totalCost, 15000);
  assert.equal(result.costPerPax, 60);
});

test("unit mismatches are not silently priced", () => {
  const result = calculateRecipeCost({
    ingredients: [{ itemId: "oil", portionQty: 30, portionUnit: "g" }]
  }, 100, [{ id: "oil", unit: "Litre", unitCost: 150, stockQuantity: 5 }]);
  assert.equal(result.priced, false);
  assert.equal(result.lines[0].unitError, true);
  assert.equal(result.lines[0].lineCost, null);
  assert.equal(result.lines[0].shortage, null);
});
