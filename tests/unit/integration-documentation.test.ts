import test from "node:test";
import assert from "node:assert/strict";
import {documentedActions} from "../../src/lib/integrations/documentation";
import {requestSchema,permissions} from "../../src/lib/integrations/contracts";
test("public integration reference covers every supported action exactly once with valid request examples",()=>{
 const supported=requestSchema.options.map(option=>option.shape.action.value).sort();
 const documented=documentedActions.map(entry=>entry.request.action).sort();
 assert.deepEqual(documented,supported);assert.equal(new Set(documented).size,documented.length);
 for(const entry of documentedActions){assert.ok(requestSchema.safeParse(entry.request).success,entry.request.action);assert.ok(entry.scope in permissions);const read=["pages.list","leads.search","leads.get","meetings.list"].includes(entry.request.action);assert.equal(entry.write,!read);assert.equal(entry.scope,entry.request.action==="pages.list"||entry.request.action.startsWith("leads.")&&read?"leads.read":entry.request.action==="meetings.list"?"meetings.read":entry.request.action);}
});
