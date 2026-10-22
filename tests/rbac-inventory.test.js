import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_PERMISSIONS, canRole, permissionForAction, permissionForCollection, permissionForView
} from "../src/modules/rbac.js";
import {
  normalizeStockUnit, findFnbInventoryMatch, canReceiveIntoInventory
} from "../src/modules/fnb/inventory-link.js";

test("role permissions separate administrator, manager, storekeeper and operator", () => {
  assert.equal(canRole("admin", "access.manage"), true);
  assert.equal(canRole("manager", "fnb.receive"), true);
  assert.equal(canRole("storekeeper", "inventory.write"), true);
  assert.equal(canRole("storekeeper", "access.manage"), false);
  assert.equal(canRole("operator", "inventory.write"), false);
  assert.equal(canRole("operator", "shifts.write"), true);
  assert.equal(canRole("unknown", "dashboard.read"), false);
  assert.equal(ROLE_PERMISSIONS.admin.includes("*"), true);
});

test("view and action policy map F&B, inventory and admin access", () => {
  assert.equal(permissionForView("fnb"), "fnb.read");
  assert.equal(permissionForView("registry"), "inventory.read");
  assert.equal(permissionForAction("fnb-import-orders"), "fnb.write");
  assert.equal(permissionForAction("fnb-receive"), "fnb.receive");
  assert.equal(permissionForAction("open-role-admin"), "access.manage");
  assert.equal(permissionForAction("del", { col: "inventory" }), "inventory.write");
  assert.equal(permissionForCollection("fnb_receipts", true), "fnb.receive");
});

test("F&B inventory matching is case-insensitive and excludes unrelated categories", () => {
  const items = [
    { id: "spare", partName: "Milk", category: "Spare Parts", unit: "Litre" },
    { id: "other", partName: "Rice", category: "Other", unit: "Kg" },
    { id: "fnb", partName: "  TOMATOES ", category: "F&B", unit: "Kg" }
  ];
  assert.equal(findFnbInventoryMatch(items, "tomatoes", "Vegetables").id, "fnb");
  assert.equal(findFnbInventoryMatch(items, "rice", "Dry Store").id, "other");
  assert.equal(findFnbInventoryMatch(items, "milk", "Dairy"), null);
});

test("stock units normalize common variants and mismatched units block receipt", () => {
  assert.equal(normalizeStockUnit("Kgs."), "kg");
  assert.equal(normalizeStockUnit("litres"), "l");
  assert.equal(canReceiveIntoInventory({ unit: "Kgs" }, "Kg"), true);
  assert.equal(canReceiveIntoInventory({ unit: "Litre" }, "Kg"), false);
  assert.equal(canReceiveIntoInventory(null, "Kg"), true);
});
