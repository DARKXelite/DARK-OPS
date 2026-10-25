import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

const featureModules = [
  ["../src/modules/core/formatters.js", null],
  ["../src/modules/ui/ui-primitives.js", "createUIPrimitivesModule"],
  ["../src/modules/ui/charts.js", "createChartModule"],
  ["../src/modules/weather/weather-module.js", "createWeatherModule"],
  ["../src/modules/inventory/reorder-intelligence.js", "createReorderIntelligenceModule"],
  ["../src/modules/cost/cost-analytics.js", "createCostAnalyticsModule"],
  ["../src/modules/fleet/fleet-module.js", "createFleetModule"],
  ["../src/modules/turf/turf-domain.js", "createTurfDomainModule"],
  ["../src/modules/turf/turf-operations-module.js", "createTurfOperationsModule"],
  ["../src/modules/maps/course-map-module.js", "createCourseMapModule"],
  ["../src/modules/store/store-ui-module.js", "createStoreUiModule"],
  ["../src/modules/expenses/expense-module.js", "createExpenseModule"],
  ["../src/modules/views/overview-module.js", "createOverviewModule"],
  ["../src/modules/actions/action-handlers.js", "createActionHandlersModule"],
  ["../src/modules/domain/fleet-domain.js", "createFleetDomainModule"]
];

test("feature modules expose function-based factories and import cleanly", async () => {
  for (const [path, factory] of featureModules) {
    const source = await read(path);
    assert.ok(source.length > 0, `${path} must not be empty`);
    if (factory) {
      assert.match(source, new RegExp(`export function ${factory}\\(deps\\)`), `${path} must expose ${factory}`);
    }
  }
  await import("../src/modules/ui/ui-primitives.js");
  await import("../src/modules/ui/charts.js");
  await import("../src/modules/weather/weather-module.js");
  await import("../src/modules/inventory/reorder-intelligence.js");
  await import("../src/modules/cost/cost-analytics.js");
  await import("../src/modules/fleet/fleet-module.js");
  await import("../src/modules/turf/turf-domain.js");
  await import("../src/modules/turf/turf-operations-module.js");
  await import("../src/modules/maps/course-map-module.js");
  await import("../src/modules/store/store-ui-module.js");
  await import("../src/modules/expenses/expense-module.js");
  await import("../src/modules/views/overview-module.js");
  await import("../src/modules/actions/action-handlers.js");
  await import("../src/modules/domain/fleet-domain.js");
});

test("application entrypoint delegates feature implementations into modules", async () => {
  const app = await read("../src/ops-app.js");
  for (const importPath of [
    "core/formatters.js",
    "ui/ui-primitives.js",
    "ui/charts.js",
    "weather/weather-module.js",
    "inventory/reorder-intelligence.js",
    "cost/cost-analytics.js",
    "fleet/fleet-module.js",
    "turf/turf-domain.js",
    "turf/turf-operations-module.js",
    "maps/course-map-module.js",
    "store/store-ui-module.js",
    "expenses/expense-module.js",
    "views/overview-module.js",
    "actions/action-handlers.js",
    "domain/fleet-domain.js"
  ]) {
    assert.ok(app.includes(importPath), `entrypoint must import ${importPath}`);
  }
  for (const declaration of [
    /function renderFleet\(\) \{/,
    /function renderOverview\(\) \{/,
    /function renderTurfCare\(\) \{/,
    /function renderLocalExpenseLedger\(\) \{/,
    /function renderRegistry\(\) \{/,
    /function wxKind\(c\) \{/
  ]) {
    assert.doesNotMatch(app, declaration, "feature implementation must not regress into the entrypoint");
  }
});

test("modules initialize before weather startup and shared state writes go through setters", async () => {
  const app = await read("../src/ops-app.js");
  const context = app.indexOf("const APP_CONTEXT = {");
  const weatherInit = app.indexOf("weatherModule = createWeatherModule(APP_CONTEXT)");
  const firstWeatherStart = app.indexOf("renderWeather();", context);
  const turfInit = app.indexOf("turfModule = createTurfOperationsModule(APP_CONTEXT)");
  assert.notEqual(context, -1);
  assert.ok(weatherInit > context);
  assert.ok(firstWeatherStart > weatherInit, "weather must not execute before module initialization");
  assert.ok(turfInit > context);
  assert.match(app, /turfModule\.setCurrentWeek\(getSunday\(v\)\)/);
  assert.match(app, /turfModule\.setAppCategory\(v\)/);
  assert.match(app, /turfModule\.setProductCategory\(/);
  assert.match(app, /expenseModule\.setFilter\(/);
  assert.match(app, /storeUiModule\.setUsersSearchText\(/);
});

test("modularization preserves authentication and command-palette security anchors", async () => {
  const app = await read("../src/ops-app.js");
  const html = await read("../index.html");
  assert.match(html, /<script type="module" src="\/src\/ops-app\.js"><\/script>/);
  assert.match(app, /REQUIRE_LOGIN:\s*true/);
  assert.match(app, /signInWithPhoneNumber/);
  assert.match(app, /new RecaptchaVerifier/);
  assert.match(app, /VITE_FIREBASE_APP_CHECK_SITE_KEY/);
  assert.match(app, /function renderCmd\(q\) \{/);
});
