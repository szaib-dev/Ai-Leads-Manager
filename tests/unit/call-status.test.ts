import {test} from "node:test";
import assert from "node:assert/strict";
import {isCallStatus,callOutcomeStatus} from "../../src/lib/leads/call-status";
import {callOutcomes} from "../../src/lib/leads/workflow-contracts";
import {statusToDb} from "../../src/lib/leads/contracts";
test("every selectable call outcome maps to a recorded lead status, including WhatsApp",()=>{
 for(const outcome of callOutcomes)assert.ok(callOutcomeStatus[outcome]);
 for(const status of ["No Answer","Voicemail","Interested","Not Interested","Follow-up","Meeting Booked","Awaiting Callback","WhatsApp"]){assert.equal(isCallStatus(status),true);assert.ok(Object.values(callOutcomeStatus).includes(statusToDb[status]));}
 assert.equal(isCallStatus("New"),false);assert.equal(isCallStatus("Renamed business"),false);
});
