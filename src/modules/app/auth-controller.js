/**
 * Firebase phone-OTP authentication and application-role lifecycle.
 * Keeps all authentication state private to this module and exposes only the
 * administrator dialog entry point and an explicit initialize() lifecycle.
 */
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

export function createAuthControllerModule(context) {
  const {
    auth, $, RBAC, ROLE_LABELS, ROLE_PERMISSIONS, CONFIG, LOADED, S,
    getDoc, doc, setDoc, serverTimestamp, stopListeners, buildNav,
    renderAll, switchView, startListeners, toast, openForm, fld
  } = context;

  let confirmationResult = null;
  let recaptchaVerifier = null;

  function openRoleAdmin() {
    if (!RBAC.can("access.manage")) { toast("Only an administrator can assign app access.", "err"); return; }
    openForm({
      title: "Assign application access",
      sub: "The account must already exist in Firebase Authentication.",
      submit: "Save access role",
      html: fld("Firebase Auth user UID", '<input id="roleUid" required autocomplete="off" placeholder="Paste the user UID from Firebase Authentication">') +
        fld("Application role", '<select id="roleValue"><option value="manager">Operations manager</option><option value="storekeeper">Storekeeper</option><option value="operator">Field operator</option><option value="admin">Administrator</option></select>') +
        fld("Account status", '<select id="roleActive"><option value="true">Active</option><option value="false">Disabled</option></select>') +
        '<p class="muted sm">Roles are enforced again by Firestore security rules. Do not assign Administrator unless this person should have full access.</p>',
      onSubmit: async () => {
        const uid = $("#roleUid").value.trim();
        if (!uid || uid.includes("/") || uid.length > 128) { toast("Enter a valid Firebase Auth UID.", "err"); return false; }
        if (uid === RBAC.session.uid && $("#roleActive").value === "false") { toast("You cannot disable the administrator account in its own session.", "err"); return false; }
        const role = $("#roleValue").value;
        const active = $("#roleActive").value === "true";
        await setDoc(doc(db, "app_roles", uid), { role, active, updatedAt: serverTimestamp(), updatedBy: RBAC.session.uid }, { merge: true });
        toast("Application access role saved.");
      }
    });
  }

  function initialize() {
    window.CLOVER_RBAC = RBAC;
    buildNav();
    document.body.classList.add("auth-locked");
    $("#login").hidden = false;
    onAuthStateChanged(auth, async user => {
      stopListeners();
      RBAC.session.role = null; RBAC.session.authenticated = false; RBAC.session.uid = null; RBAC.session.displayName = "";
      const login = $("#login"), gate = $("#pinGate"), error = $("#loginErr");
      if (gate) gate.hidden = true;
      if (!user) {
        Object.keys(CONFIG.COL).forEach(k => { LOADED[k] = false; S[k] = []; });
        S._v++;
        if (login) login.hidden = false;
        if ($("#signoutBtn")) $("#signoutBtn").hidden = true;
        document.body.classList.add("auth-locked");
        buildNav();
        renderAll();
        return;
      }
      try {
        let roleSnap = await getDoc(doc(db, "app_roles", user.uid));
        // One-time bootstrap for the explicitly allowlisted first-owner UID.
        // Firestore rules must enforce the same UID, own-document-only, admin-only creation.
        const bootstrapAdminUid = "C1l8ArB3GlSaAQr6iw4O9RKGGik1";
        if (!roleSnap.exists() && user.uid === bootstrapAdminUid) {
          await setDoc(doc(db, "app_roles", user.uid), {
            role: "admin", active: true, displayName: "DARKX Administrator",
            updatedAt: serverTimestamp(), updatedBy: user.uid
          });
          roleSnap = await getDoc(doc(db, "app_roles", user.uid));
        }
        const roleData = roleSnap.exists() ? roleSnap.data() : null;
        if (!roleData || roleData.active !== true || !ROLE_PERMISSIONS[roleData.role]) {
          await signOut(auth);
          if (error) error.textContent = "This account has no active application role. Ask an administrator to assign access.";
          return;
        }
        RBAC.session.role = roleData.role;
        RBAC.session.authenticated = true;
        RBAC.session.uid = user.uid;
        RBAC.session.displayName = roleData.displayName || user.email || "";
        if (login) login.hidden = true;
        if ($("#signoutBtn")) $("#signoutBtn").hidden = false;
        document.body.classList.remove("auth-locked");
        buildNav();
        switchView((location.hash || "").slice(1) || "overview");
        startListeners();
        toast("Signed in · " + (ROLE_LABELS[roleData.role] || roleData.role));
      } catch (err) {
        console.error("RBAC role lookup failed", err);
        await signOut(auth);
        if (error) error.textContent = "Could not verify your application role. Check Firebase access rules and try again.";
      }
    });
    $("#loginForm").addEventListener("submit", async e => {
      e.preventDefault();
      const error = $("#loginErr");
      const sendBtn = $("#loginSubmit");
      const sendingOtp = !confirmationResult;
      error.textContent = "";
      sendBtn.disabled = true;
      try {
        if (sendingOtp) {
          const phone = $("#loginPhone").value.trim().replace(/[\s()-]/g, "");
          if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
            throw new Error("Enter your phone number in international format, including country code (for example, +91XXXXXXXXXX).");
          }
          if (!recaptchaVerifier) {
            recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "normal" });
          }
          confirmationResult = await signInWithPhoneNumber(auth, phone, recaptchaVerifier);
          $("#otpField").hidden = false;
          $("#loginPhone").readOnly = true;
          $("#loginSubmit").textContent = "Verify OTP";
          $("#loginOtp").focus();
          error.textContent = "OTP sent. Check your phone and enter the code.";
        } else {
          const code = $("#loginOtp").value.trim();
          if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit OTP.");
          await confirmationResult.confirm(code);
        }
      } catch (err) {
        console.error("Phone OTP sign-in failed", err);
        // Preserve the pending confirmation after a wrong OTP, but reset expired/failed
        // reCAPTCHA state after an SMS-send failure so the user can retry cleanly.
        if (sendingOtp) {
          confirmationResult = null;
          try { recaptchaVerifier?.clear(); } catch (_) {}
          recaptchaVerifier = null;
          $("#loginPhone").readOnly = false;
          $("#otpField").hidden = true;
          $("#loginOtp").value = "";
          $("#loginSubmit").textContent = "Send OTP";
        }
        error.textContent = err.message || "Could not complete phone verification. Check Firebase Phone sign-in and authorized domains.";
      } finally {
        sendBtn.disabled = false;
      }
    });
    $("#signoutBtn").addEventListener("click", async () => {
      try { await signOut(auth); } catch (err) { toast("Sign-out failed. Retry.", "err"); }
    });
  }

  return {
    initialize,
    openRoleAdmin,
    getConfirmationResult: () => confirmationResult,
    hasPendingOtp: () => Boolean(confirmationResult)
  };
}
