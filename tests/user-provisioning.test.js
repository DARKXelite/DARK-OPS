import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMobile,
  validatePlatformProfile,
  authRoleForPlatformRole,
  androidLoginEmail,
  hashInvite,
  createInviteCode
} from "../functions/src/user-provisioning.js";

const androidProfile = {
  fullName: "Test Operator",
  mobileNumber: "+919876543210",
  platform: "android",
  platformRole: "operator",
  moduleAccess: ["fleet_ops", "inventory"],
  status: "pending",
  authUid: null
};

test("normalizes Indian mobile numbers consistently", () => {
  assert.equal(normalizeMobile("98765 43210"), "+919876543210");
  assert.equal(normalizeMobile("+91 98765-43210"), "+919876543210");
});

test("validates Android profile role and module grants", () => {
  assert.doesNotThrow(() => validatePlatformProfile(androidProfile, "android"));
  assert.throws(() => validatePlatformProfile({ ...androidProfile, platform: "web" }, "android"));
  assert.throws(() => validatePlatformProfile({ ...androidProfile, platformRole: "foe" }, "android"));
  assert.throws(() => validatePlatformProfile({ ...androidProfile, moduleAccess: ["reports"] }, "android"));
  assert.throws(() => validatePlatformProfile({ ...androidProfile, status: "active" }, "android"));
});

test("maps Android roles to the least-privileged legacy Firestore role", () => {
  assert.equal(authRoleForPlatformRole("storekeeper"), "storekeeper");
  assert.equal(authRoleForPlatformRole("workshop_manager"), "operator");
  assert.equal(authRoleForPlatformRole("captain"), "operator");
});

test("Android login alias is deterministic and does not expose the phone number", () => {
  const first = androidLoginEmail("+919876543210");
  assert.equal(first, androidLoginEmail("98765 43210"));
  assert.match(first, /^android-[a-f0-9]{32}@android\.clovergreens\.invalid$/);
  assert.ok(!first.includes("9876543210"));
});

test("activation codes are high entropy and stored as one-way hashes", () => {
  const code = createInviteCode();
  assert.ok(code.length >= 32);
  assert.notEqual(hashInvite(code), code);
  assert.equal(hashInvite(code), hashInvite(code));
  assert.notEqual(hashInvite(code), hashInvite(createInviteCode()));
});
