import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  getAuth
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "firebase/functions";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

const projectId = "demo-clover-greens-ops";
const app = initializeApp({
  apiKey: "demo-api-key",
  authDomain: projectId + ".firebaseapp.com",
  projectId
}, "staff-provisioning-integration");
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "asia-south1");
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080 }
});

try {
  const adminCredential = await createUserWithEmailAndPassword(auth, "admin@clover-test.invalid", "Admin-test-password-123!");
  const adminUid = adminCredential.user.uid;
  const staffProfileId = "android-staff-integration-test";
  await env.withSecurityRulesDisabled(async context => {
    const seed = context.firestore();
    await setDoc(doc(seed, "app_roles", adminUid), {
      role: "admin",
      active: true,
      displayName: "Integration Admin",
      updatedAt: new Date(),
      updatedBy: adminUid
    });
    await setDoc(doc(seed, "users", staffProfileId), {
      fullName: "Integration Operator",
      username: "Integration Operator",
      mobileNumber: "+919876543210",
      role: "operator",
      platform: "android",
      platformRole: "operator",
      moduleAccess: ["inventory"],
      status: "pending",
      schemaVersion: 1,
      authUid: null,
      createdAt: new Date(),
      createdBy: adminUid,
      updatedAt: new Date(),
      updatedBy: adminUid
    });
  });

  const provision = httpsCallable(functions, "provisionAndroidStaff");
  const provisionResult = await provision({ staffProfileId });
  const activationCode = provisionResult.data.activationCode;
  assert.equal(provisionResult.data.success, true);
  assert.ok(activationCode.length >= 32);

  const profileAfterProvision = await getDoc(doc(db, "users", staffProfileId));
  assert.equal(profileAfterProvision.data().status, "active");
  assert.ok(profileAfterProvision.data().authUid);

  const roleAfterProvision = await getDoc(doc(db, "app_roles", profileAfterProvision.data().authUid));
  assert.equal(roleAfterProvision.data().platform, "android");
  assert.equal(roleAfterProvision.data().staffProfileId, staffProfileId);
  assert.deepEqual(roleAfterProvision.data().moduleAccess, ["inventory"]);

  await signOut(auth);
  const password = "Staff-password-long-123!";
  const redeem = httpsCallable(functions, "redeemAndroidInvite");
  const redemption = await redeem({
    mobileNumber: "+919876543210",
    activationCode,
    newPassword: password
  });
  assert.equal(redemption.data.success, true);
  assert.ok(redemption.data.customToken);
  assert.match(redemption.data.loginEmail, /^android-[a-f0-9]{32}@android\.clovergreens\.invalid$/);

  const staffCredential = await signInWithCustomToken(auth, redemption.data.customToken);
  assert.equal(staffCredential.user.uid, profileAfterProvision.data().authUid);
  const ownProfile = await getDoc(doc(db, "users", staffProfileId));
  assert.equal(ownProfile.data().platform, "android");

  await assert.rejects(() => redeem({
    mobileNumber: "+919876543210",
    activationCode,
    newPassword: "Another-password-long-123!"
  }));

  await signOut(auth);
  await signInWithEmailAndPassword(auth, redemption.data.loginEmail, password);
  assert.equal(auth.currentUser.uid, profileAfterProvision.data().authUid);

  await signOut(auth);
  await signInWithEmailAndPassword(auth, "admin@clover-test.invalid", "Admin-test-password-123!");
  const updateAccess = httpsCallable(functions, "updateStaffAccess");
  await updateAccess({
    staffProfileId,
    fullName: "Integration Operator",
    platformRole: "operator",
    moduleAccess: ["inventory"],
    status: "suspended"
  });
  const suspendedProfile = await getDoc(doc(db, "users", staffProfileId));
  const suspendedRole = await getDoc(doc(db, "app_roles", profileAfterProvision.data().authUid));
  assert.equal(suspendedProfile.data().status, "suspended");
  assert.equal(suspendedRole.data().active, false);

  await updateAccess({
    staffProfileId,
    fullName: "Integration Operator",
    platformRole: "operator",
    moduleAccess: ["inventory"],
    status: "active"
  });
  const reissue = httpsCallable(functions, "reissueAndroidInvite");
  const replacement = await reissue({ staffProfileId });
  assert.equal(replacement.data.success, true);
  assert.ok(replacement.data.activationCode.length >= 32);

  console.log("Firebase Functions integration: Android provision, activate, password login, suspend, reactivate and reissue passed.");
} finally {
  await signOut(auth).catch(() => {});
  await env.cleanup();
  await deleteApp(app);
}
