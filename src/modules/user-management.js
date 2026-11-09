/**
 * Canonical user-management contract shared by the Web and Android clients.
 *
 * This module defines staff-profile metadata and platform-specific role/module
 * vocabularies. It does not provision Firebase Authentication identities.
 */
export const USER_PLATFORMS = Object.freeze({
  WEB: "web",
  ANDROID: "android"
});

export const PLATFORM_ROLES = Object.freeze({
  web: Object.freeze([
    { id: "operator", label: "Operator" },
    { id: "foe", label: "Front Office Executive (FOE)" },
    { id: "marshal", label: "Marshal" },
    { id: "storekeeper", label: "Storekeeper" },
    { id: "workshop_manager", label: "Workshop Manager" },
    { id: "golf_superintendent", label: "Golf Superintendent" },
    { id: "user", label: "User" }
  ]),
  android: Object.freeze([
    { id: "operator", label: "Operator" },
    { id: "storekeeper", label: "Storekeeper" },
    { id: "captain", label: "Captain (Breakfast QR)" },
    { id: "marshal", label: "Marshal (Golf QR)" },
    { id: "workshop_manager", label: "Workshop Manager" }
  ])
});

export const USER_MODULES = Object.freeze({
  fuel_fertilizer_dashboard: Object.freeze({ label: "Fuel & Fertilizer Dashboard", platforms: ["web"] }),
  inventory: Object.freeze({ label: "Inventory", platforms: ["web", "android"] }),
  breakfast_qr: Object.freeze({ label: "Breakfast QR", platforms: ["web", "android"] }),
  golf_qr: Object.freeze({ label: "Golf QR", platforms: ["web", "android"] }),
  turf_ops: Object.freeze({ label: "Turf Ops", platforms: ["web", "android"] }),
  fleet_ops: Object.freeze({ label: "Fleet Ops", platforms: ["web", "android"] }),
  workshop_ops: Object.freeze({ label: "Workshop Ops", platforms: ["web", "android"] }),
  reports: Object.freeze({ label: "Reports & Analytics", platforms: ["web"] }),
  other_modules: Object.freeze({ label: "Other modules (future module grants)", platforms: ["web", "android"] })
});

export const USER_ACCOUNT_STATUSES = Object.freeze(["pending", "active", "suspended"]);

export function rolesForPlatform(platform) {
  return PLATFORM_ROLES[platform] || [];
}

export function modulesForPlatform(platform) {
  return Object.entries(USER_MODULES)
    .filter(([, module]) => module.platforms.includes(platform))
    .map(([id, module]) => ({ id, label: module.label }));
}

export function validateUserProfile(input) {
  const errors = [];
  const platform = String(input?.platform || "");
  const role = String(input?.platformRole || "");
  const name = String(input?.fullName || "").trim();
  const mobile = String(input?.mobileNumber || "").trim();
  const status = String(input?.status || "pending");
  const moduleAccess = Array.isArray(input?.moduleAccess) ? input.moduleAccess : [];

  if (!name) errors.push("Full name is required.");
  if (!/^\+\d{10,14}$/.test(mobile)) errors.push("Mobile number must be normalized to international format.");
  if (!Object.hasOwn(PLATFORM_ROLES, platform)) errors.push("Select exactly one supported platform.");
  if (Object.hasOwn(PLATFORM_ROLES, platform) && !PLATFORM_ROLES[platform].some(item => item.id === role)) {
    errors.push("The selected role is not available on the selected platform.");
  }
  if (!USER_ACCOUNT_STATUSES.includes(status)) errors.push("Invalid account status.");
  if (!Array.isArray(input?.moduleAccess)) errors.push("Module access must be an array.");
  const allowedModules = new Set(modulesForPlatform(platform).map(item => item.id));
  for (const moduleId of moduleAccess) {
    if (!allowedModules.has(moduleId)) errors.push(`Module "${moduleId}" is not available on ${platform || "the selected platform"}.`);
  }
  if (new Set(moduleAccess).size !== moduleAccess.length) errors.push("Module access cannot contain duplicates.");

  return { valid: errors.length === 0, errors };
}

/**
 * Build the additive user-profile payload. Existing workforce fields remain
 * present for compatibility with current operational views and reports.
 */
export function buildUserProfile(input, audit = {}) {
  const fullName = String(input?.fullName || "").trim();
  const mobileNumber = String(input?.mobileNumber || "").trim();
  const platform = String(input?.platform || "");
  const platformRole = String(input?.platformRole || "");
  const moduleAccess = [...new Set(Array.isArray(input?.moduleAccess) ? input.moduleAccess : [])];
  const status = String(input?.status || "pending");

  const result = validateUserProfile({ fullName, mobileNumber, platform, platformRole, moduleAccess, status });
  if (!result.valid) {
    const error = new Error("Invalid user profile.");
    error.validationErrors = result.errors;
    throw error;
  }

  return {
    fullName,
    username: fullName,
    mobileNumber,
    // Keep the legacy role field for existing workforce screens. New access
    // checks must use platform + platformRole + moduleAccess, not this field.
    role: platformRole,
    platform,
    platformRole,
    moduleAccess,
    status,
    schemaVersion: 1,
    authUid: null,
    createdAt: audit.createdAt ?? null,
    createdBy: audit.createdBy ?? null,
    updatedAt: audit.updatedAt ?? null,
    updatedBy: audit.updatedBy ?? null
  };
}
