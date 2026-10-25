/**
 * Firebase browser client bootstrap.
 *
 * Firebase web configuration is client-visible by design. Security is enforced
 * through Authentication, Firestore Rules, and optional Firebase App Check.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyA0snhaIuA47xB0Ay-5nAgzBstDO5koi-M",
  authDomain: "clover-greens-ops.firebaseapp.com",
  databaseURL: "https://clover-greens-ops-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "clover-greens-ops",
  storageBucket: "clover-greens-ops.firebasestorage.app",
  messagingSenderId: "48049661517",
  appId: "1:48049661517:web:8075879055223c9cd61e04",
  measurementId: "G-N96JJT9QRL"
});

export const app = initializeApp(firebaseConfig);
export const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || "";

if (appCheckSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.error("Firebase App Check initialization failed; refusing to continue with a broken security configuration.", error);
    throw error;
  }
}

export const db = getFirestore(app);
export const auth = getAuth(app);
