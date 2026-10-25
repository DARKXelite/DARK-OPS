import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryService } from "../src/modules/store/inventory-service.js";

function setup({current={category:"Fuel",stockQuantity:10},exists=true}={}) {
 const calls=[];
 const db={mock:true}, CONFIG={COL:{inwards:"store_inwards",inventory:"inventory"}};
 const itemRef={collection:"inventory",id:"diesel-1"}, receiptRef={collection:"store_inwards",id:"receipt-1"};
 const service=createInventoryService({
  db,CONFIG,
  doc:(...args)=>args.length===1?receiptRef:{collection:args[1],id:args[2]},
  collection:(_db,name)=>({collection:name}),
  runTransaction:async(_db,fn)=>fn({
   get:async ref=>{calls.push(["get",ref]);return {exists:()=>exists,data:()=>current};},
   update:(ref,data)=>calls.push(["update",ref,data]),
   set:(ref,data)=>calls.push(["set",ref,data])
  }),
  serverTimestamp:()=>({serverTimestamp:true}),
  num:value=>{const n=parseFloat(value);return Number.isFinite(n)?n:0;}
 });
 return {service,calls,itemRef,receiptRef};
}
const receipt={
 itemId:"diesel-1",expectedCategory:"Fuel",itemName:"Diesel",unit:"Litre",
 quantity:25,rate:90,gstPercent:18,taxableAmount:2250,gstAmount:405,total:2655,
 supplier:"Supplier A",invoiceNumber:"GRN-100",receiptDate:"2026-10-17",notes:"Fuel delivery"
};
test("goods inward atomically updates stock and writes matching receipt",async()=>{
 const {service,calls,itemRef,receiptRef}=setup({current:{category:"Fuel",stockQuantity:10}});
 const result=await service.postGoodsInward(receipt);
 assert.equal(result.receiptRef,receiptRef);
 assert.deepEqual(calls[0],["get",itemRef]);
 assert.equal(calls[1][0],"update");
 assert.deepEqual(calls[1][1],itemRef);
 assert.equal(calls[1][2].stockQuantity,35);
 assert.equal(calls[1][2].unitCost,90);
 assert.equal(calls[2][0],"set");
 assert.deepEqual(calls[2][1],receiptRef);
 assert.equal(calls[2][2].total,2655);
 assert.equal(calls[2][2].transactionType,"INWARD");
});
test("goods inward rejects missing item and does not write either record",async()=>{
 const {service,calls}=setup({exists:false});
 await assert.rejects(service.postGoodsInward(receipt),/Item no longer exists/);
 assert.equal(calls.filter(c=>c[0]==="update"||c[0]==="set").length,0);
});
test("goods inward rejects a category changed since the form was opened",async()=>{
 const {service,calls}=setup({current:{category:"Spare Parts",stockQuantity:10}});
 await assert.rejects(service.postGoodsInward(receipt),/category changed/);
 assert.equal(calls.filter(c=>c[0]==="update"||c[0]==="set").length,0);
});


import { postFuelIssue } from "../src/modules/store/inventory-service.js";

function fuelSetup({ item = { category:"Fuel", partName:"Petrol", unit:"Litre", stockQuantity:100 }, exists = true } = {}) {
 const calls=[];
 const db={mock:true};
 const CONFIG={COL:{inventory:"inventory",fuel:"fuel_logs"}};
 const itemRef={collection:"inventory",id:"petrol-1"};
 const logRef={collection:"fuel_logs",id:"fuel-log-1"};
 const serviceDeps={
  db,CONFIG,
  doc:(...args)=>args.length===1?logRef:{collection:args[1],id:args[2]},
  collection:(_db,name)=>({collection:name}),
  runTransaction:async(_db,fn)=>fn({
   get:async ref=>{calls.push(["get",ref]);return {exists:()=>exists,data:()=>item};},
   update:(ref,data)=>calls.push(["update",ref,data]),
   set:(ref,data)=>calls.push(["set",ref,data])
  }),
  serverTimestamp:()=>({serverTimestamp:true}),
  num:value=>{const n=Number(value);return Number.isFinite(n)?n:0;}
 };
 return {serviceDeps,calls,itemRef,logRef};
}
const fuelIssue={itemId:"petrol-1",machineId:"m1",machineName:"Cart 1",fuelType:"Petrol",litres:12.5,issueDate:"2026-10-25",issuedBy:"Storekeeper",notes:"Shift issue"};

test("fuel issue atomically deducts inventory and writes the dashboard fuel log",async()=>{
 const {serviceDeps,calls,itemRef,logRef}=fuelSetup();
 const result=await postFuelIssue(serviceDeps,fuelIssue);
 assert.deepEqual(result,{logRef});
 assert.deepEqual(calls[0],["get",itemRef]);
 assert.equal(calls[1][0],"update");
 assert.deepEqual(calls[1][1],itemRef);
 assert.equal(calls[1][2].stockQuantity,87.5);
 assert.equal(calls[1][2].lastFuelIssueId,logRef.id);
 assert.equal(calls[2][0],"set");
 assert.deepEqual(calls[2][1],logRef);
 assert.equal(calls[2][2].fuelType,"Petrol");
 assert.equal(calls[2][2].litres,12.5);
 assert.equal(calls[2][2].transactionType,"FUEL_ISSUE");
});

test("fuel issue rejects over-issue without writing stock or a log",async()=>{
 const {serviceDeps,calls}=fuelSetup({item:{category:"Fuel",partName:"Petrol",unit:"Litre",stockQuantity:5}});
 await assert.rejects(postFuelIssue(serviceDeps,fuelIssue),/Insufficient Petrol stock/);
 assert.equal(calls.filter(c=>c[0]==="update"||c[0]==="set").length,0);
});

test("fuel issue rejects a mismatched fuel SKU",async()=>{
 const {serviceDeps,calls}=fuelSetup({item:{category:"Fuel",partName:"Diesel",unit:"Litre",stockQuantity:100}});
 await assert.rejects(postFuelIssue(serviceDeps,fuelIssue),/does not match the fuel type/);
 assert.equal(calls.filter(c=>c[0]==="update"||c[0]==="set").length,0);
});
