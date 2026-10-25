import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("command palette uses data attributes, not executable inline handlers", async () => {
  const js = await read("../src/ops-app.js");
  const palette = await read("../src/modules/app/command-palette.js");
  assert.match(js, /createCommandPaletteModule/);
  const start = palette.indexOf("function renderCmd(q) {");
  assert.notEqual(start, -1, "command-palette renderer must exist in its module");
  const renderer = palette.slice(start);
  assert.doesNotMatch(renderer, /onclick\s*=/i, "generated result buttons must not compile record data as JavaScript");
  assert.match(renderer, /data-cmd-view=/, "results should describe actions as data");
  assert.match(renderer, /addEventListener\("click"/, "actions should be handled through a registered event listener");
  assert.match(renderer, /S\.machines\.find/, "machine navigation should resolve a trusted in-memory record by ID");
});

test("the active app fails closed and uses phone OTP authentication", async () => {
  const html = await read("../index.html");
  const js = await read("../src/ops-app.js");
  const auth = await read("../src/modules/app/auth-controller.js");
  assert.match(html, /<script type="module" src="\/src\/ops-app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
  assert.match(js, /REQUIRE_LOGIN:\s*true/);
  assert.match(js, /createAuthControllerModule/);
  assert.match(auth, /signInWithPhoneNumber/);
  assert.match(auth, /new RecaptchaVerifier/);
  assert.match(auth, /roleData\.active !== true/, "missing active flag must not count as active access");
});

test("owner bootstrap is restricted to the exact UID and admin role", async () => {
  const auth = await read("../src/modules/app/auth-controller.js");
  const rules = await read("../firestore.rules");
  const ownerUid = "C1l8ArB3GlSaAQr6iw4O9RKGGik1";
  assert.ok(auth.includes(ownerUid), "app bootstrap must use the documented owner UID");
  assert.ok(rules.includes(ownerUid), "Firestore bootstrap must use the same owner UID");
  assert.doesNotMatch(rules, /request\.auth\.token\.email/, "alternate email bootstrap must not grant administrator access");
  assert.match(auth, /if \(!roleSnap\.exists\(\) && user\.uid === bootstrapAdminUid\)/);
  assert.match(rules, /request\.auth\.uid == uid[\s\S]{0,160}request\.auth\.uid == 'C1l8ArB3GlSaAQr6iw4O9RKGGik1'[\s\S]{0,300}request\.resource\.data\.role == 'admin'[\s\S]{0,100}request\.resource\.data\.active == true/);
});

test("Firestore requires explicit active roles and denies unspecified collections", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /\.data\.active == true/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  const rolesBlock = rules.slice(rules.indexOf("match /app_roles/{uid}"), rules.indexOf("match /users/{id}"));
  assert.match(rolesBlock, /allow update: if admin\(\)/);
  assert.match(rolesBlock, /allow delete: if admin\(\)/);
});


test("composition root initializes mutable state before injecting feature modules", async () => {
  const js = await read("../src/ops-app.js");
  assert.match(js, /const LOADED = \{\}/);
  assert.match(js, /const F = \{ q: '', cat: 'All', fuel: 'All', sort: 'service' \}/);
  assert.match(js, /const R = \{/);
  assert.match(js, /let cur = 'overview', curModalRender = null/);
  assert.match(js, /function getCurrentView\(\) \{ return cur; \}/);
});

test("cost-model storage sanitizes saved values and tolerates storage failures", async () => {
  const module = await import("../src/modules/cost/cost-model-storage.js");
  const storage = {
    getItem: () => JSON.stringify({ dieselRate: -10, petrolRate: "invalid", savingsPct: 35 }),
    setItem: (key, value) => { storage.lastKey = key; storage.lastValue = value; }
  };
  const model = module.loadCostModel(storage);
  assert.equal(model.dieselRate, module.COST_DEFAULTS.dieselRate);
  assert.equal(model.petrolRate, module.COST_DEFAULTS.petrolRate);
  assert.equal(model.savingsPct, 35);
  module.persistCostModel(model, storage);
  assert.equal(storage.lastKey, "cloverOpsCostModel");
  assert.equal(JSON.parse(storage.lastValue).savingsPct, 35);
  assert.doesNotThrow(() => module.loadCostModel({ getItem: () => { throw new Error("blocked"); } }));
  assert.doesNotThrow(() => module.persistCostModel(model, { setItem: () => { throw new Error("blocked"); } }));
});

test("composition root initializes state and delegates app lifecycle to modules", async () => {
  const js = await read("../src/ops-app.js");
  assert.match(js, /const LOADED = \{\}/);
  assert.match(js, /const F = \{ q: '', cat: 'All', fuel: 'All', sort: 'service' \}/);
  assert.match(js, /const R = \{/);
  assert.match(js, /let cur = 'overview', curModalRender = null/);
  assert.match(js, /createNavigationController/);
  assert.match(js, /createFirestoreListenerController/);
  assert.match(js, /createAuthControllerModule/);
  assert.match(js, /registerAppEventDelegation/);
  assert.match(js, /createRangeControlsModule/);
});

test("Vercel config retains baseline browser security headers", async () => {
  const config = JSON.parse(await read("../vercel.json"));
  const headers = config.headers.flatMap(entry => entry.headers || []);
  const headerMap = new Map(headers.map(({ key, value }) => [key.toLowerCase(), value]));
  for (const name of [
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security"
  ]) {
    assert.ok(headerMap.has(name), `missing response header: ${name}`);
  }
  assert.equal(headerMap.get("x-content-type-options"), "nosniff");
  assert.equal(headerMap.get("x-frame-options"), "DENY");
});

test("legacy Firebase module cannot disable authentication and matches the web app config", async () => {
  const legacy = await read("../src/firebase/client.js");
  const active = await read("../src/ops-app.js");
  assert.match(legacy, /REQUIRE_LOGIN:\s*true/);
  assert.match(legacy, /1:48049661517:web:8075879055223c9cd61e04/);
  assert.match(active, /1:48049661517:web:8075879055223c9cd61e04/);
  assert.doesNotMatch(legacy, /REQUIRE_LOGIN:\s*false/);
});

test("F&B writes enforce order and receipt invariants", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /function validFnbOrderCreate\(\)/);
  assert.match(rules, /d\.orderedQty is number && d\.orderedQty > 0/);
  assert.match(rules, /d\.receivedQty is number && d\.receivedQty == 0/);
  assert.match(rules, /function validFnbReceiptOrderUpdate\(id\)/);
  assert.match(rules, /d\.receivedQty <= d\.orderedQty/);
  assert.match(rules, /function validFnbReceiptCreate\(id\)/);
  assert.match(rules, /quantityDelta > getAfter\(receiptPath\)\.data\.quantity - 0\.000001/);
  assert.match(rules, /getAfter\(orderPath\)\.data\.lastReceiptId == id/);
  assert.match(rules, /allow update, delete: if false;/);
});

test("store inward records validate schemas and protect F&B-linked records", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /function validNormalInwardCreate\(id\)/);
  assert.match(rules, /function validFnbInwardCreate\(id\)/);
  assert.match(rules, /getAfter\(itemPath\)\.data\.lastInwardId == id/);
  assert.match(rules, /getAfter\(itemPath\)\.data\.stockQuantity - get\(itemPath\)\.data\.stockQuantity > d\.quantity - 0\.000001/);
  assert.match(rules, /getAfter\(receiptPath\)\.data\.inwardId == id/);
  assert.match(rules, /resource\.data\.transactionType != 'FNB_RECEIPT'[\s\S]{0,120}request\.resource\.data\.transactionType != 'FNB_RECEIPT'/);
});

test("Firebase client initializes App Check before Firestore", async () => {
  const client = await read("../src/modules/firebase/client.js");
  const js = await read("../src/ops-app.js");
  const appCheckImport = client.indexOf("firebase-app-check.js");
  const activation = client.indexOf("initializeAppCheck(app");
  const firestore = client.indexOf("getFirestore(app)");
  assert.notEqual(appCheckImport, -1);
  assert.notEqual(activation, -1);
  assert.ok(activation < firestore, "App Check must initialize before Firestore is used");
  assert.match(client, /VITE_FIREBASE_APP_CHECK_SITE_KEY/);
  assert.match(client, /isTokenAutoRefreshEnabled:\s*true/);
  assert.match(js, /from "\.\/modules\/firebase\/client\.js"/);
});

test("realtime listeners are filtered by current role and collection permissions", async () => {
  const listeners = await read("../src/modules/app/firestore-listener-controller.js");
  const rbac = await read("../src/modules/rbac.js");
  assert.match(listeners, /RBAC\.can\(permissionForCollection\(CONFIG\.COL\[k\], false\)\)/);
  assert.match(listeners, /const shouldListen = desired\.has\(k\) && permitted/);
  assert.match(rbac, /store_inwards:\s*"inventory\.receipts\.read"/);
  assert.match(rbac, /operator: Object\.freeze\(\[[\s\S]*?"inventory\.read"/);
});

test("received F&B order history cannot be deleted", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /allow delete: if manager\(\) && !resource\.data\.keys\(\)\.hasAny\(\['lastReceiptId'\]\)/);
});

test("F&B receipt rules require matching inward and stock records", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /existsAfter\(inwardPath\)/);
  assert.match(rules, /getAfter\(inwardPath\)\.data\.fnbReceiptId == id/);
  assert.match(rules, /existsAfter\(inventoryPath\)/);
  assert.match(rules, /getAfter\(inventoryPath\)\.data\.lastReceiptId == id/);
  assert.match(rules, /getAfter\(inventoryPath\)\.data\.stockQuantity - get\(inventoryPath\)\.data\.stockQuantity > d\.quantity - 0\.000001/);
});

test("OTP send failures reset expired reCAPTCHA state without discarding a pending OTP on wrong-code errors", async () => {
  const js = await read("../src/modules/app/auth-controller.js");
  assert.match(js, /const sendingOtp = !confirmationResult/);
  assert.match(js, /if \(sendingOtp\) \{[\s\S]{0,240}confirmationResult = null/);
  assert.match(js, /recaptchaVerifier\?\.clear\(\)/);
  assert.match(js, /await confirmationResult\.confirm\(code\)/);
});

test("Firestore realtime listeners are scoped to the selected view", async () => {
  const js = await read("../src/ops-app.js");
  const listeners = await read("../src/modules/app/firestore-listener-controller.js");
  assert.match(listeners, /const desired = new Set\(VIEW_COLLECTIONS\[getCurrentView\(\)\] \|\| \[\]\)/);
  assert.match(listeners, /if \(!listenersStarted\) return/);
  assert.match(js, /function syncListenersForView\(\.\.\.args\)/);
  assert.match(listeners, /function stopOneListener\(k\)/);
  assert.match(listeners, /listenerEpochs\.get\(k\) !== epoch/);
  assert.match(js, /registry: \['inventory','inwards','expenses'\]/);
  assert.match(js, /expenses: \['expenses','inventory'\]/);
});
