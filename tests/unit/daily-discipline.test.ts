import test from "node:test";
import assert from "node:assert/strict";
import { disciplineAt, readCompleted, scheduleForDay } from "../../src/lib/discipline/schedule";
const at = (local: string) => disciplineAt(new Date(local + "+05:00"));
test("Pakistan clock highlights exact activity boundaries and leaves breaks uncompleted", () => {
 assert.equal(at("2026-11-02T11:15:00").current?.id,"pakistan");
 assert.equal(at("2026-11-02T12:50:00").current,undefined);
 assert.equal(at("2026-11-02T12:50:00").next.id,"proposals");
 assert.equal(at("2026-11-02T09:00:00").next.id,"research");
 assert.equal(at("2026-11-02T04:00:00").current?.id,"sleep");
 assert.deepEqual(readCompleted("[]"),[]);
});
test("Friday research and weekend work replace calls without invented call targets", () => {
 assert.equal(at("2026-11-06T11:30:00").current?.title,"Pakistan lead research");
 assert.equal(at("2026-11-06T11:30:00").current?.target,undefined);
 for(const day of ["2026-11-07","2026-11-08"]) {
  const rows=scheduleForDay(day);assert.ok(rows.every(r=>!r.title.includes("cold calls")));assert.ok(rows.every(r=>!r.target?.includes("calls")));
 }
});
test("midnight follows previous evening rules but completion day is Pakistan calendar date", () => {
 const saturday=at("2026-11-07T00:05:00");
 assert.equal(saturday.day,"2026-11-07");assert.equal(saturday.current?.title,"USA/Canada cold calls");assert.equal(saturday.next.id,"tracking");
 const monday=at("2026-11-09T00:05:00");assert.equal(monday.current?.title,"Research, proposals & client work");
 assert.equal(at("2026-11-07T00:15:00").current?.id,"tracking");
 assert.equal(at("2026-11-07T00:45:00").current?.id,"reading");
 assert.equal(at("2026-11-07T01:00:00").current?.id,"sleep");
 assert.equal(at("2026-11-06T23:59:59").day,"2026-11-06");
});
test("checkoffs accept only manually stored known unique activity IDs", () => {
 assert.deepEqual(readCompleted('["reading","reading","invented",2,"gym"]'),["reading","gym"]);
 assert.deepEqual(readCompleted('{"reading":true}'),[]);assert.deepEqual(readCompleted('invalid'),[]);
 assert.equal(scheduleForDay("2026-11-02").length,12);
});
