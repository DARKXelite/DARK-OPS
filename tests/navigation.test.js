import test from "node:test";
import assert from "node:assert/strict";
import { createNavigation } from "../src/ui/navigation.js";
const noop = () => {};
function setup() {
  const $ = () => null, $$ = () => [];
  let current = "overview";
  const nav = createNavigation({
    $, $$, state:{logs:[]}, liveNow:()=>[],
    getCurrentView:()=>current, setCurrentView:v=>{current=v;}, getModalRenderer:()=>null,
    renderers:{}, initRadarMap:noop, initZoneMap:noop, getRadarMap:()=>null, getZoneMap:()=>null, fitToCourse:noop
  });
  return {nav,getCurrentView:()=>current};
}
test("navigation groups operational views without DOM dependencies", () => {
  const {nav}=setup();
  assert.equal(nav.groupForView("overview"),"insights");
  assert.equal(nav.groupForView("fleet"),"fleetops");
  assert.equal(nav.groupForView("records"),"fleetops");
  assert.equal(nav.groupForView("incidents"),"fleetops");
  assert.equal(nav.groupForView("turfcare"),"turfops");
  assert.equal(nav.groupForView("registry"),"masters");
  assert.equal(nav.groupForView("expenses"),"masters");
});
test("unknown views resolve to the default insights group", () => {
  const {nav}=setup();
  assert.equal(nav.groupForView("not-a-view"),"insights");
});
