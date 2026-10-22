import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ROLE_PERMISSIONS, canRole } from "../src/modules/rbac.js";

test("every operational role has explicit, least-privilege permissions", () => {
  assert.equal(canRole("admin", "access.manage"), true);
  assert.equal(canRole("manager", "users.manage"), true);
  assert.equal(canRole("manager", "access.manage"), false);
  assert.equal(canRole("storekeeper", "inventory.write"), true);
  assert.equal(canRole("storekeeper", "fnb.receive"), true);
  assert.equal(canRole("storekeeper", "users.manage"), false);
  assert.equal(canRole("operator", "shifts.write"), true);
  assert.equal(canRole("operator", "inventory.write"), false);
  assert.equal(canRole("operator", "access.manage"), false);
  assert.equal(canRole("unassigned", "dashboard.read"), false);
  assert.ok(Object.keys(ROLE_PERMISSIONS).includes("admin"));
});

test("Firestore rules require authenticated role documents and deny unmatched collections", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /request\.auth != null/);
  assert.match(rules, /app_roles\/\$\(request\.auth\.uid\)/);
  assert.match(rules, /match \/inventory\/\{id\}/);
  assert.match(rules, /match \/fnb_orders\/\{id\}/);
  assert.match(rules, /match \/fnb_receipts\/\{id\}/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.doesNotMatch(rules, /allow read, write:\s*if true/);
});
