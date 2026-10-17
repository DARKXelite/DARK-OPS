import test from "node:test";
import assert from "node:assert/strict";
import { createFirestoreRepository } from "../src/firebase/repository.js";

test("CRUD repository resolves logical keys to existing Firestore collections", async () => {
  const calls=[];
  const db={id:"db"};
  const CONFIG={COL:{machines:"machines",inventory:"inventory",zones:"CourseZones"}};
  const api={
    collection:(database,name)=>({kind:"collection",database,name}),
    doc:(database,name,id)=>({kind:"document",database,name,id}),
    addDoc:async(ref,data)=>{calls.push(["add",ref,data]);return {id:"new-record"};},
    updateDoc:async(ref,data)=>{calls.push(["update",ref,data]);return "updated";},
    deleteDoc:async(ref)=>{calls.push(["remove",ref]);return "removed";},
    increment:amount=>({increment:amount})
  };
  const repo=createFirestoreRepository({db,CONFIG,...api});
  const added=await repo.add("zones",{zoneName:"North green"});
  await repo.update("machines","machine-1",{status:"Active"});
  await repo.remove("inventory","stock-1");
  await repo.increment("inventory","stock-1","stockQuantity",-3);
  assert.equal(added.id,"new-record");
  assert.deepEqual(calls[0][1],{kind:"collection",database:db,name:"CourseZones"});
  assert.deepEqual(calls[1][1],{kind:"document",database:db,name:"machines",id:"machine-1"});
  assert.deepEqual(calls[2][1],{kind:"document",database:db,name:"inventory",id:"stock-1"});
  assert.deepEqual(calls[3][2],{stockQuantity:{increment:-3}});
});

test("repository accepts an explicit collection name for non-master collections", async () => {
  let seen;
  const repo=createFirestoreRepository({
    db:{},CONFIG:{COL:{}},
    collection:(_db,name)=>({name}),
    doc:(_db,name,id)=>({name,id}),
    addDoc:async(ref)=>{seen=ref;},
    updateDoc:async()=>{},deleteDoc:async()=>{},increment:n=>n
  });
  await repo.add("route_trails",{seq:1});
  assert.deepEqual(seen,{name:"route_trails"});
});
