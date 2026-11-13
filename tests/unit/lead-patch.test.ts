import {test} from "node:test";
import assert from "node:assert/strict";
import {patchLead} from "../../src/lib/realtime/lead-updates";
import type {Lead} from "../../src/types";
test("committed patches update matching rows and never overwrite a newer saved version",()=>{
 const row={id:"one",name:"Private business",status:"New",phone:"123",updatedAt:"2026-11-13T10:00:02Z"} as Lead;
 const old={id:"one",status:"Interested",updatedAt:"2026-11-13T10:00:01Z",archived:false,deleted:false} as const;
 assert.equal(patchLead([row],old)[0],row);
 const updated=patchLead([row],{...old,updatedAt:"2026-11-13T10:00:03Z",deleted:true})[0];
 assert.equal(updated.deleted,true);assert.equal(updated.phone,"123");assert.equal(updated.name,"Private business");
 assert.equal(patchLead([row],{...old,id:"other"})[0],row);
});
