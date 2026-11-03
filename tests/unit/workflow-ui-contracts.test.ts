import test from "node:test";
import assert from "node:assert/strict";
import { phoneLink } from "../../src/lib/utils";
import { followupCategory } from "../../src/types/followup";
test("call links preserve local/international digits and support punctuation without accepting unsafe targets", () => {
  assert.equal(phoneLink("+1 (202) 555.0199"), "tel:+12025550199");
  assert.equal(phoneLink("0300-555-0191"), "tel:03005550191");
  for (const value of [
    "javascript:alert(1)",
    "+12025550199;123",
    "+12025550199 ext 3",
    "123",
    "+1234567890123456",
  ])
    assert.equal(phoneLink(value), undefined);
});
test("follow-up categories compare literal dates and keep completed tasks historical", () => {
  const base = {
    id: "task",
    leadId: "lead",
    date: "2026-11-03",
    time: "00:15",
    note: "Call back",
    completed: false,
  };
  assert.equal(followupCategory(base, "2026-11-03"), "today");
  assert.equal(
    followupCategory({ ...base, date: "2026-11-02" }, "2026-11-03"),
    "overdue",
  );
  assert.equal(
    followupCategory({ ...base, date: "2026-11-04" }, "2026-11-03"),
    "upcoming",
  );
  assert.equal(
    followupCategory({ ...base, completed: true }, "2026-11-03"),
    "completed",
  );
});
