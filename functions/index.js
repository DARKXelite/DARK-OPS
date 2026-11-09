const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const crypto = require("node:crypto");
const {
  normalizeMobile,
  validatePlatformProfile,
  authRoleForPlatformRole,
  androidLoginEmail,
  hashInvite,
  createInviteCode
} = require("./src/user-provisioning");

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const REGION = "asia-south1";

async function requireStaffAdmin(uid) {
  const snap = await db.doc("app_roles/" + uid).get();
  const role = snap.exists ? snap.data() : null;
  if (!role || role.active !== true || !["admin", "manager"].includes(role.role)) {
    throw new HttpsError("permission-denied", "Only an active administrator or manager can provision staff identities.");
  }
  return role;
}

function callableError(error) {
  if (error instanceof HttpsError) return error;
  logger.error("Staff identity provisioning failed", error);
  return new HttpsError("internal", "The staff identity could not be provisioned. No credentials were returned.");
}

exports.provisionAndroidStaff = onCall({ region: REGION, maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Administrator sign-in is required.");
  await requireStaffAdmin(request.auth.uid);

  const staffProfileId = String(request.data?.staffProfileId || "").trim();
  if (!staffProfileId || staffProfileId.includes("/") || staffProfileId.length > 150) {
    throw new HttpsError("invalid-argument", "A valid staff profile ID is required.");
  }

  const profileRef = db.doc("users/" + staffProfileId);
  let authUser;
  try {
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) throw new HttpsError("not-found", "Staff profile not found.");
    const profile = profileSnap.data();
    validatePlatformProfile(profile, "android");

    const duplicates = await db.collection("users").where("mobileNumber", "==", profile.mobileNumber).get();
    if (duplicates.size !== 1 || duplicates.docs[0].id !== staffProfileId) {
      throw new HttpsError("failed-precondition", "Mobile number must belong to exactly one staff profile.");
    }

    const email = androidLoginEmail(profile.mobileNumber);
    try {
      await auth.getUserByEmail(email);
      throw new HttpsError("already-exists", "An Android login identity already exists for this mobile number.");
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error.code !== "auth/user-not-found") throw error;
    }

    const initialPassword = crypto.randomBytes(48).toString("base64url");
    authUser = await auth.createUser({
      email,
      emailVerified: true,
      password: initialPassword,
      displayName: profile.fullName,
      disabled: false
    });

    const inviteCode = createInviteCode();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 30 * 60 * 1000);
    const role = authRoleForPlatformRole(profile.platformRole);
    const batch = db.batch();
    batch.set(db.doc("app_roles/" + authUser.uid), {
      role,
      active: true,
      displayName: profile.fullName,
      platform: "android",
      staffProfileId,
      platformRole: profile.platformRole,
      moduleAccess: profile.moduleAccess,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid
    });
    batch.update(profileRef, {
      authUid: authUser.uid,
      status: "active",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid
    });
    batch.set(db.doc("android_invites/" + staffProfileId), {
      authUid: authUser.uid,
      mobileNumber: profile.mobileNumber,
      codeHash: hashInvite(inviteCode),
      expiresAt,
      attempts: 0,
      usedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: request.auth.uid
    });
    await batch.commit();
    logger.info("Android staff identity provisioned", { staffProfileId, authUid: authUser.uid, actor: request.auth.uid });
    return { success: true, staffProfileId, activationCode: inviteCode, expiresAt: expiresAt.toDate().toISOString() };
  } catch (error) {
    if (authUser) {
      try { await auth.deleteUser(authUser.uid); } catch (cleanupError) { logger.error("Failed to clean up uncommitted Auth identity", cleanupError); }
    }
    throw callableError(error);
  }
});

exports.redeemAndroidInvite = onCall({ region: REGION, maxInstances: 10 }, async request => {
  const mobileNumber = normalizeMobile(request.data?.mobileNumber);
  const inviteCode = String(request.data?.activationCode || "");
  const newPassword = String(request.data?.newPassword || "");
  if (!/^\+[1-9]\d{7,14}$/.test(mobileNumber) || inviteCode.length < 24 || inviteCode.length > 80) {
    throw new HttpsError("invalid-argument", "Enter the registered mobile number and activation code.");
  }
  if (newPassword.length < 12 || newPassword.length > 128) {
    throw new HttpsError("invalid-argument", "Choose a password between 12 and 128 characters.");
  }

  const matches = await db.collection("users")
    .where("mobileNumber", "==", mobileNumber)
    .where("platform", "==", "android")
    .limit(2).get();
  if (matches.size !== 1) throw new HttpsError("not-found", "No unique Android staff profile matches this mobile number.");
  const profileDoc = matches.docs[0];
  const profile = profileDoc.data();
  if (profile.status !== "active" || !profile.authUid) throw new HttpsError("failed-precondition", "This Android profile is not active.");

  const inviteRef = db.doc("android_invites/" + profileDoc.id);
  let invalidCode = false;
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(inviteRef);
      if (!snap.exists) throw new HttpsError("not-found", "Activation code is invalid or expired.");
      const data = snap.data();
      if (data.usedAt || data.expiresAt.toMillis() <= Date.now() || data.authUid !== profile.authUid) {
        throw new HttpsError("failed-precondition", "Activation code is invalid, expired or already used.");
      }
      if (data.attempts >= 5) throw new HttpsError("resource-exhausted", "Too many activation attempts. Ask an administrator to issue a new code.");
      if (hashInvite(inviteCode) !== data.codeHash) {
        tx.update(inviteRef, { attempts: admin.firestore.FieldValue.increment(1) });
        invalidCode = true;
        return;
      }
      tx.update(inviteRef, { usedAt: admin.firestore.FieldValue.serverTimestamp(), attempts: admin.firestore.FieldValue.increment(1) });
    });
  } catch (error) {
    throw callableError(error);
  }
  if (invalidCode) throw new HttpsError("permission-denied", "Activation code is incorrect.");

  try {
    await auth.updateUser(profile.authUid, { password: newPassword });
    const customToken = await auth.createCustomToken(profile.authUid);
    logger.info("Android staff activation completed", { staffProfileId: profileDoc.id, authUid: profile.authUid });
    return { success: true, customToken, loginEmail: androidLoginEmail(mobileNumber) };
  } catch (error) {
    logger.error("Android invite redemption failed after code consumption", error);
    throw new HttpsError("internal", "Activation could not be completed. Ask an administrator to issue a new code.");
  }
});

exports.linkWebStaffIdentity = onCall({ region: REGION, maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Administrator sign-in is required.");
  await requireStaffAdmin(request.auth.uid);
  const staffProfileId = String(request.data?.staffProfileId || "").trim();
  const authUid = String(request.data?.authUid || "").trim();
  if (!staffProfileId || staffProfileId.includes("/") || !authUid || authUid.includes("/") || authUid.length > 128) {
    throw new HttpsError("invalid-argument", "A valid staff profile ID and Firebase Auth UID are required.");
  }
  const profileRef = db.doc("users/" + staffProfileId);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) throw new HttpsError("not-found", "Staff profile not found.");
  const profile = profileSnap.data();
  validatePlatformProfile(profile, "web");
  let authUser;
  try { authUser = await auth.getUser(authUid); }
  catch { throw new HttpsError("not-found", "Firebase Auth identity not found."); }
  if (normalizeMobile(authUser.phoneNumber) !== normalizeMobile(profile.mobileNumber)) {
    throw new HttpsError("failed-precondition", "The Firebase Auth phone number does not match the staff profile mobile number.");
  }
  const existingRole = await db.doc("app_roles/" + authUid).get();
  if (existingRole.exists) throw new HttpsError("already-exists", "This Firebase Auth identity already has an application role. Do not overwrite an existing account.");
  const batch = db.batch();
  batch.set(db.doc("app_roles/" + authUid), {
    role: authRoleForPlatformRole(profile.platformRole),
    active: true,
    displayName: profile.fullName,
    platform: "web",
    staffProfileId,
    platformRole: profile.platformRole,
    moduleAccess: profile.moduleAccess,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid
  });
  batch.update(profileRef, {
    authUid,
    status: "active",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid
  });
  try { await batch.commit(); }
  catch (error) { throw callableError(error); }
  return { success: true, staffProfileId, authUid };
});

exports.updateStaffAccess = onCall({ region: REGION, maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Administrator sign-in is required.");
  await requireStaffAdmin(request.auth.uid);
  const staffProfileId = String(request.data?.staffProfileId || "").trim();
  const platformRole = String(request.data?.platformRole || "");
  const moduleAccess = request.data?.moduleAccess;
  const fullName = String(request.data?.fullName || "").trim();
  const status = String(request.data?.status || "");
  if (!staffProfileId || staffProfileId.includes("/") || !["active", "suspended"].includes(status)) {
    throw new HttpsError("invalid-argument", "A valid linked staff profile and account status are required.");
  }
  const profileRef = db.doc("users/" + staffProfileId);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) throw new HttpsError("not-found", "Staff profile not found.");
  const profile = profileSnap.data();
  if (!profile.authUid || !["web", "android"].includes(profile.platform)) {
    throw new HttpsError("failed-precondition", "This profile has no linked platform identity.");
  }
  if (profile.platform === "android" && profile.mobileNumber !== normalizeMobile(profile.mobileNumber)) {
    throw new HttpsError("failed-precondition", "Android mobile number must remain normalized.");
  }
  if (!fullName || fullName.length > 100) throw new HttpsError("invalid-argument", "Enter a valid staff name.");
  const candidate = { ...profile, fullName, platformRole, moduleAccess, status: "pending", authUid: null };
  try { validatePlatformProfile(candidate, profile.platform); }
  catch (error) { throw new HttpsError("invalid-argument", error.message); }
  const roleRef = db.doc("app_roles/" + profile.authUid);
  const roleSnap = await roleRef.get();
  if (!roleSnap.exists || roleSnap.data().staffProfileId !== staffProfileId || roleSnap.data().platform !== profile.platform) {
    throw new HttpsError("failed-precondition", "The linked authorization record does not match this profile.");
  }
  const batch = db.batch();
  batch.update(profileRef, {
    fullName,
    username: fullName,
    platformRole,
    role: platformRole,
    moduleAccess,
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid
  });
  batch.update(roleRef, {
    role: authRoleForPlatformRole(platformRole),
    displayName: fullName,
    platformRole,
    moduleAccess,
    active: status === "active",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid
  });
  try {
    // Commit the deny/allow decision first. If Auth propagation fails, Firestore
    // still denies suspended users and an administrator can safely retry activation.
    await batch.commit();
    await auth.updateUser(profile.authUid, { displayName: fullName, disabled: status !== "active" });
  } catch (error) {
    throw callableError(error);
  }
  return { success: true, staffProfileId, status };
});

exports.reissueAndroidInvite = onCall({ region: REGION, maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Administrator sign-in is required.");
  await requireStaffAdmin(request.auth.uid);
  const staffProfileId = String(request.data?.staffProfileId || "").trim();
  if (!staffProfileId || staffProfileId.includes("/")) throw new HttpsError("invalid-argument", "A valid staff profile ID is required.");
  const profileRef = db.doc("users/" + staffProfileId);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) throw new HttpsError("not-found", "Staff profile not found.");
  const profile = profileSnap.data();
  if (profile.platform !== "android" || profile.status !== "active" || !profile.authUid) {
    throw new HttpsError("failed-precondition", "Only provisioned Android profiles can receive a replacement activation code.");
  }
  const roleSnap = await db.doc("app_roles/" + profile.authUid).get();
  if (!roleSnap.exists || roleSnap.data().staffProfileId !== staffProfileId || roleSnap.data().active !== true) {
    throw new HttpsError("failed-precondition", "The Android authorization record is not active.");
  }
  const inviteCode = createInviteCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);
  await db.doc("android_invites/" + staffProfileId).set({
    authUid: profile.authUid,
    mobileNumber: profile.mobileNumber,
    codeHash: hashInvite(inviteCode),
    expiresAt,
    attempts: 0,
    usedAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.uid
  });
  return { success: true, staffProfileId, activationCode: inviteCode, expiresAt: expiresAt.toDate().toISOString() };
});
