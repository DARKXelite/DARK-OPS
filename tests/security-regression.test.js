import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("command palette uses data attributes, not executable inline handlers", async () => {
  const js = await read("../src/ops-app.js");
  const start = js.indexOf("function renderCmd(q) {");
  assert.notEqual(start, -1, "active command-palette renderer must exist");
  const renderer = js.slice(start);
  assert.doesNotMatch(renderer, /onclick\s*=/i, "generated result buttons must not compile record data as JavaScript");
  assert.match(renderer, /data-cmd-view=/, "results should describe actions as data");
  assert.match(renderer, /addEventListener\("click"/, "actions should be handled through a registered event listener");
  assert.match(renderer, /S\.machines\.find/, "machine navigation should resolve a trusted in-memory record by ID");
});

test("the active app fails closed and uses phone OTP authentication", async () => {
  const html = await read("../index.html");
  const js = await read("../src/ops-app.js");
  assert.match(html, /<script type="module" src="\/src\/ops-app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
  assert.match(js, /REQUIRE_LOGIN:\s*true/);
  assert.match(js, /signInWithPhoneNumber/);
  assert.match(js, /new RecaptchaVerifier/);
  assert.match(js, /roleData\.active !== true/, "missing active flag must not count as active access");
});

test("owner bootstrap is restricted to the exact UID and admin role", async () => {
  const js = await read("../src/ops-app.js");
  const rules = await read("../firestore.rules");
  const ownerUid = "C1l8ArB3GlSaAQr6iw4O9RKGGik1";
  assert.ok(js.includes(ownerUid), "app bootstrap must use the documented owner UID");
  assert.ok(rules.includes(ownerUid), "Firestore bootstrap must use the same owner UID");
  assert.match(js, /if \(!roleSnap\.exists\(\) && user\.uid === bootstrapAdminUid\)/);
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
