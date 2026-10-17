import test from "node:test";
import assert from "node:assert/strict";
import { createTurfPlannerService } from "../src/modules/turf/planner-service.js";

test("weekly plan service batches dated Planned records with master product data", async () => {
  const writes=[];
  const inventory=[
    {id:"fert-1",partName:"Nitrogen Mix",category:"Fertilizers"},
    {id:"pest-1",partName:"Leaf Shield",category:"Pesticides"}
  ];
  const db={mock:true}, CONFIG={COL:{plans:"turf_plans"}};
  const service=createTurfPlannerService({
    db,CONFIG,collection:(_db,name)=>({kind:"collection",name}),
    doc:ref=>({kind:"document",collection:ref.name,id:"new-"+(writes.length+1)}),
    writeBatch:database=>{
      assert.equal(database,db);
      return {set:(ref,payload)=>writes.push({ref,payload}),commit:async()=>{writes.committed=true;}};
    },
    ymd:d=>d.toISOString().slice(0,10),
    addDays:(date,n)=>{const d=new Date(date+"T00:00:00");d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);},
    getInventory:()=>inventory, now:()=>123456
  });
  const result=await service.saveWeeklyPlan({
    start:"2026-10-18",weeks:2,
    days:[
      [{pId:"fert-1",totQty:12,unit:"Kg",area:"North green",scope:"overall"}],
      [{pId:"pest-1",totQty:3,unit:"Litre",area:"South green",scope:"per_area"}]
    ]
  });
  assert.equal(result.count,4);
  assert.equal(writes.length,4);
  assert.equal(writes[0].payload.weekStart,"2026-10-18");
  assert.equal(writes[0].payload.date,"2026-10-18");
  assert.equal(writes[0].payload.productName,"Nitrogen Mix");
  assert.equal(writes[0].payload.category,"Fertilizers");
  assert.equal(writes[0].payload.targetQty,12);
  assert.equal(writes[0].payload.status,"Planned");
  assert.equal(writes[0].payload.createdAt,123456);
  assert.equal(writes[1].payload.date,"2026-10-19");
  assert.equal(writes[2].payload.weekStart,"2026-10-25");
});
test("weekly plan service reports the number of generated rows", async () => {
  let commitCount=0;
  const svc=createTurfPlannerService({
    db:{},CONFIG:{COL:{plans:"turf_plans"}},collection:()=>({name:"turf_plans"}),doc:()=>({}),
    writeBatch:()=>({set:()=>{},commit:async()=>{commitCount++;}}),
    ymd:d=>d.toISOString().slice(0,10),addDays:(s,n)=>{const d=new Date(s+"T00:00:00");d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);},
    getInventory:()=>[],now:()=>1
  });
  const result=await svc.saveWeeklyPlan({start:"2026-10-18",weeks:1,days:[[],[],[],[],[],[],[]]});
  assert.equal(result.count,0);
  assert.equal(commitCount,1);
});
