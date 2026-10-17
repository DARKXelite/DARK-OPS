import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, js, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/app.css", import.meta.url), "utf8")
]);

test("page loads extracted CSS and JavaScript modules", () => {
  assert.match(html, /href="\/src\/styles\/app\.css"/);
  assert.match(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script\s+type="module"\s*>/i);
});

test("Firebase SDK imports stay pinned to the existing 10.7.1 CDN", () => {
  assert.match(js, /firebasejs\/10\.7\.1\/firebase-app\.js/);
  assert.match(js, /firebasejs\/10\.7\.1\/firebase-firestore\.js/);
  assert.match(js, /firebasejs\/10\.7\.1\/firebase-auth\.js/);
});

test("the extracted app keeps its existing operational screens and styling", () => {
  for (const name of ["Fleet Ops", "Turf Ops", "Fuel", "Inventory"]) {
    assert.ok(js.includes(name), `missing expected source reference: ${name}`);
  }
  assert.ok(css.includes(":root"));
  assert.ok(css.includes("--bg"));
});
