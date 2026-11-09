import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_ROLES,
  USER_MODULES,
  buildUserProfile,
  modulesForPlatform,
  rolesForPlatform,
  validateUserProfile
} from "../src/modules/user-management.js";

const validWeb = {
  fullName: "Test Operator",
  mobileNumber: "+919876543210",
  platform: "web",
  platformRole: "operator",
  moduleAccess: ["fuel_fertilizer_dashboard", "fleet_ops"],
  status: "pending"
};

test("platform catalogs expose separate role lists", () => {
  assert.deepEqual(rolesForPlatform("web").map(x => x.id), PLATFORM_ROLES.web.map(x => x.id));
  assert.deepEqual(rolesForPlatform("android").map(x => x.id), PLATFORM_ROLES.android.map(x => x.id));
  assert.equal(rolesForPlatform("both").length, 0);
});

test("Android Captain and Marshal receive only their platform role IDs", () => {
  assert.ok(rolesForPlatform("android").some(x => x.id === "captain"));
  assert.ok(rolesForPlatform("android").some(x => x.id === "marshal"));
  assert.ok(!rolesForPlatform("web").some(x => x.id === "captain"));
});

test("rejects a dual/unknown platform", () => {
  const result = validateUserProfile({ ...validWeb, platform: "both" });
  assert.equal(result.valid, false);
});

test("rejects a role that belongs to another platform", () => {
  const result = validateUserProfile({ ...validWeb, platformRole: "captain" });
  assert.equal(result.valid, false);
});

test("rejects modules unavailable on selected platform", () => {
  const result = validateUserProfile({
    ...validWeb,
    platform: "android",
    platformRole: "operator",
    moduleAccess: ["fuel_fertilizer_dashboard"]
  });
  assert.equal(result.valid, false);
});

test("builds additive profile while preserving legacy fields", () => {
  const profile = buildUserProfile(validWeb, {
    createdBy: "admin-uid",
    updatedBy: "admin-uid"
  });
  assert.equal(profile.platform, "web");
  assert.equal(profile.role, "operator");
  assert.equal(profile.username, "Test Operator");
  assert.equal(profile.authUid, null);
  assert.equal(profile.createdBy, "admin-uid");
  assert.ok(Array.isArray(profile.moduleAccess));
});

test("module catalog contains only known module IDs", () => {
  for (const module of [...modulesForPlatform("web"), ...modulesForPlatform("android")]) {
    assert.ok(Object.hasOwn(USER_MODULES, module.id));
  }
});
