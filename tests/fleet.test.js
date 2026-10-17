import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortMachines } from "../src/modules/fleet/fleet-module.js";

const machines = [
  {id:"m1",assetName:"Greens Mower",category:"Mower",fuelType:"Petrol",currentHours:100},
  {id:"m2",assetName:"Fairway Mower",category:"Mower",fuelType:"Diesel",currentHours:400},
  {id:"m3",assetName:"Utility Buggy",category:"Buggy",fuelType:"Petrol",currentHours:60}
];
const serviceFor = m => ({remaining:m.id==="m1"?30:m.id==="m2"?10:50,level:"ok"});
test("fleet filtering supports category and fuel without mutating source",()=>{
 const original=machines.slice();
 const rows=filterAndSortMachines({machines,category:"Mower",fuel:"Petrol",serviceFor});
 assert.deepEqual(rows.map(r=>r.m.id),["m1"]);
 assert.deepEqual(machines,original);
});
test("fleet sort orders by service urgency, engine hours, and name",()=>{
 assert.deepEqual(filterAndSortMachines({machines,sort:"service",serviceFor}).map(r=>r.m.id),["m2","m1","m3"]);
 assert.deepEqual(filterAndSortMachines({machines,sort:"hours",serviceFor}).map(r=>r.m.id),["m2","m1","m3"]);
 assert.deepEqual(filterAndSortMachines({machines,sort:"name",serviceFor}).map(r=>r.m.id),["m2","m1","m3"]);
});
test("fleet search matches asset or category case-insensitively",()=>{
 assert.deepEqual(filterAndSortMachines({machines,query:"BUGGY",serviceFor}).map(r=>r.m.id),["m3"]);
 assert.deepEqual(filterAndSortMachines({machines,query:"mower",serviceFor}).map(r=>r.m.id).sort(),["m1","m2"]);
});
