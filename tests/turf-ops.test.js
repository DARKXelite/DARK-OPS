import test from "node:test";
import assert from "node:assert/strict";
import { filterTurfRecords } from "../src/modules/turf/turf-ops-module.js";
const categoryFor = p => p.category || "Other";
const statusFor = p => p.status || "Planned";
const dateFor = p => p.date || "";
const items = [
 {id:"a",productName:"Green Fertilizer",category:"Fertilizers",status:"Planned",date:"2026-10-20",targetArea:"North"},
 {id:"b",productName:"Leaf Pesticide",category:"Pesticides",status:"Issued",date:"2026-10-16",targetArea:"South"},
 {id:"c",productName:"Growth Enhancer",category:"Turf Enhancements",status:"Applied",date:"2026-10-18",targetArea:"North"}
];
const opts = extra => ({plans:items,isTurfCategory:c=>["Fertilizers","Pesticides","Turf Enhancements"].includes(c),categoryFor,statusFor,dateFor,timestampMs:()=>0,...extra});
test("turf record filter searches, filters and sorts descending by date",()=>{
 const rows=filterTurfRecords(opts({query:"north"}));
 assert.deepEqual(rows.map(x=>x.id),["a","c"]);
});
test("turf records can be filtered by category and status",()=>{
 assert.deepEqual(filterTurfRecords(opts({category:"Pesticides"})).map(x=>x.id),["b"]);
 assert.deepEqual(filterTurfRecords(opts({status:"Issued"})).map(x=>x.id),["b"]);
});
test("turf record filtering excludes non-turf categories",()=>{
 const plans=[...items,{id:"d",category:"Spare Parts",status:"Issued",date:"2026-10-22"}];
 assert.deepEqual(filterTurfRecords({...opts(),plans}).map(x=>x.id),["a","c","b"]);
});
