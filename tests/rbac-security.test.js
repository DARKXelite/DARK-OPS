import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_PERMISSIONS,
  canRole,
  permissionForAction,
  permissionForCollection,
  permissionForView
} from "../src/modules/rbac.js";

test("privileged actions remain administrator-only", () => {
  assert.equal(canRole("admin", "access.manage"), true);
  assert.equal(canRole("manager", "access.manage"), false);
  assert.equal(canRole("storekeeper", "access.manage"), false);
  assert.equal(canRole("operator", "access.manage"), false);
  assert.equal(permissionForAction("open-role-admin"), "access.manage");
  assert.equal(permissionForAction("open-data-reset"), "admin.only");
});

test("role permissions align with collection-level read scopes", () => {
  assert.equal(canRole("operator", "fleet.read"), true);
  assert.equal(canRole("operator", "inventory.read"), true);
  assert.equal(canRole("operator", "maintenance.read"), true);
  assert.equal(canRole("operator", "assignments.read"), true);
  assert.equal(canRole("operator", "inventory.receipts.read"), false);
  assert.equal(canRole("storekeeper", "inventory.receipts.read"), true);
  assert.equal(canRole("manager", "inventory.receipts.read"), true);
  assert.equal(permissionForCollection("store_inwards"), "inventory.receipts.read");
  assert.equal(permissionForCollection("fnb_orders"), "fnb.read");
  assert.equal(permissionForCollection("unexpected_collection"), "admin.only");
});

test("dashboard routes preserve role-based navigation permissions", () => {
  assert.equal(permissionForView("overview"), "dashboard.read");
  assert.equal(permissionForView("fleet"), "fleet.read");
  assert.equal(permissionForView("registry"), "inventory.read");
  assert.equal(canRole("operator", permissionForView("fleet")), true);
  assert.equal(canRole("operator", "users.manage"), false);
  assert.deepEqual(ROLE_PERMISSIONS.operator.includes("*"), false);
});
