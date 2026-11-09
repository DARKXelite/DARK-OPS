const crypto = require("node:crypto");

const ANDROID_ROLES = new Set(["operator", "storekeeper", "captain", "marshal", "workshop_manager"]);
const WEB_ROLES = new Set(["operator", "foe", "marshal", "storekeeper", "workshop_manager", "golf_superintendent", "user"]);
const ANDROID_MODULES = new Set(["inventory", "breakfast_qr", "golf_qr", "turf_ops", "fleet_ops", "workshop_ops", "other_modules"]);
const WEB_MODULES = new Set(["fuel_fertilizer_dashboard", "inventory", "breakfast_qr", "golf_qr", "turf_ops", "fleet_ops", "workshop_ops", "reports", "fnb_ops", "other_modules"]);

function normalizeMobile(value) {
  const raw = String(value || "").trim().replace(/[\s()-]/g, "");
  if (/^\d{10}$/.test(raw)) return "+91" + raw;
  if (/^91\d{10}$/.test(raw)) return "+" + raw;
  return raw;
}

function validatePlatformProfile(profile, expectedPlatform) {
  if (!profile || profile.platform !== expectedPlatform) throw new Error("Staff profile platform does not match this provisioning flow.");
  if (profile.status !== "pending") throw new Error("Only pending staff profiles can be provisioned.");
  if (profile.authUid) throw new Error("This staff profile already has a linked authentication identity.");
  if (!/^\+[1-9]\d{7,14}$/.test(String(profile.mobileNumber || ""))) throw new Error("Staff mobile number is not normalized.");
  const roleSet = expectedPlatform === "android" ? ANDROID_ROLES : WEB_ROLES;
  const moduleSet = expectedPlatform === "android" ? ANDROID_MODULES : WEB_MODULES;
  if (!roleSet.has(profile.platformRole)) throw new Error("Invalid role for the selected platform.");
  if (!Array.isArray(profile.moduleAccess) || profile.moduleAccess.some(id => !moduleSet.has(id)) || new Set(profile.moduleAccess).size !== profile.moduleAccess.length) {
    throw new Error("Invalid module grants for the selected platform.");
  }
}

function authRoleForPlatformRole(platformRole) {
  return platformRole === "storekeeper" ? "storekeeper" : "operator";
}

function androidLoginEmail(mobileNumber) {
  const digest = crypto.createHash("sha256").update(normalizeMobile(mobileNumber)).digest("hex").slice(0, 32);
  return "android-" + digest + "@android.clovergreens.invalid";
}

function hashInvite(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function createInviteCode() {
  return crypto.randomBytes(24).toString("base64url");
}

module.exports = {
  normalizeMobile,
  validatePlatformProfile,
  authRoleForPlatformRole,
  androidLoginEmail,
  hashInvite,
  createInviteCode
};
