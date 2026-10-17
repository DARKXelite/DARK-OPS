import test from "node:test";
import assert from "node:assert/strict";
import { createLiveDataListeners } from "../src/firebase/live-listeners.js";
import { normDate } from "../src/utils/date.js";

test("snapshot lifecycle maps documents, normalizes dates, and notifies the active view", () => {
  const state = { fuel: [], machines: [], shifts: [], zones: [], live: [], inventory: [], logs: [], maintenance: [], assignments: [], plans: [], users: [], inwards: [], _v: 0 };
  const loaded = {};
  const CONFIG = { COL: { users:"users", machines:"machines", fuel:"fuel_logs", shifts:"shifts", zones:"CourseZones", live:"live_telemetry", inventory:"inventory", logs:"logs", maintenance:"maintenance_logs", assignments:"assignment_logs", plans:"turf_plans", inwards:"store_inwards" } };
  const collections = [];
  const unsubscribers = [];
  const renderKeys = [];
  const badgeKeys = [];
  const conn = [];
  const zonesUpdated = [];
  const svc = createLiveDataListeners({
    db: { fake: true }, CONFIG, state, loaded, normDate,
    getCurrentView: () => "overview",
    setConnection: value => conn.push(value),
    onZonesUpdated: () => zonesUpdated.push(true),
    updateBadges: key => badgeKeys.push(key),
    scheduleRender: () => renderKeys.push("render"),
    onReadError: () => assert.fail("unexpected listener error"),
    collection: (db, name) => { const ref = { db, name }; collections.push(name); return ref; },
    onSnapshot: (ref, next) => {
      if (ref.name === "fuel_logs") next({docChanges:()=>[{type:"added",doc:{id:"f1",data:()=>({date:"17/10/2026",litres:12})}}]});
      else if (ref.name === "turf_plans") next({docChanges:()=>[{type:"added",doc:{id:"t1",data:()=>({date:"2026-10-16",targetQty:3})}}]});
      else if (ref.name === "CourseZones") next({docChanges:()=>[]});
      else next({docChanges:()=>[]});
      const unsubscribe = () => unsubscribers.push(ref.name);
      return unsubscribe;
    }
  });
  svc.startListeners();
  assert.equal(state.fuel.length, 1);
  assert.equal(state.fuel[0]._d, "2026-10-17");
  assert.equal(state.plans[0]._d, "2026-10-16");
  assert.equal(loaded.fuel, true);
  assert.equal(loaded.plans, true);
  assert.ok(conn.includes("ok"));
  assert.ok(badgeKeys.includes("fuel"));
  assert.equal(zonesUpdated.length, 1);
  assert.ok(renderKeys.length > 0);
  assert.equal(collections.length, Object.keys(CONFIG.COL).length);
  svc.stopListeners();
  assert.equal(unsubscribers.length, Object.keys(CONFIG.COL).length);
});

test("listener lifecycle can be restarted without stacking subscriptions", () => {
  const state = { machines: [], _v: 0 };
  const loaded = {};
  const CONFIG = { COL: { machines: "machines" } };
  const unsubscribed = [];
  let listeners = 0;
  const svc = createLiveDataListeners({
    db: {}, CONFIG, state, loaded, normDate,
    getCurrentView: () => "overview", setConnection:()=>{}, onZonesUpdated:()=>{},
    updateBadges:()=>{}, scheduleRender:()=>{}, onReadError:()=>{},
    collection:(_db,name)=>name,
    onSnapshot:()=>{ listeners++; return ()=>unsubscribed.push(listeners); }
  });
  svc.startListeners();
  svc.startListeners();
  assert.equal(unsubscribed.length, 1);
  assert.equal(listeners, 2);
  svc.stopListeners();
  assert.equal(unsubscribed.length, 2);
});
