import test from "node:test";
import assert from "node:assert/strict";
import {
  searchTimezones,
  timezoneLabel,
  timezoneOptions,
} from "../../src/lib/analytics/timezones";
import { replaceLead } from "../../src/lib/realtime/lead-updates";
import { fromDb } from "../../src/lib/leads/contracts";
test("timezone search matches cities, countries and IANA names with date-aware readable offsets", () => {
  const options = timezoneOptions("Asia/Karachi");
  for (const query of ["Karachi", "Pakistan", "Asia/Karachi"])
    assert.ok(
      searchTimezones(options, query).some((x) => x.value === "Asia/Karachi"),
    );
  assert.ok(
    searchTimezones(options, "New York").some(
      (x) => x.value === "America/New_York",
    ),
  );
  assert.ok(
    searchTimezones(options, "Toronto").some(
      (x) => x.value === "America/Toronto",
    ),
  );
  assert.match(
    timezoneLabel("Asia/Karachi", new Date("2026-01-01")),
    /Karachi, Pakistan \(UTC\+05:00\)/,
  );
  assert.match(
    timezoneLabel("America/New_York", new Date("2026-07-01")),
    /UTC-04:00/,
  );
  assert.match(
    timezoneLabel("America/New_York", new Date("2026-01-01")),
    /UTC-05:00/,
  );
});
test("optimistic updates touch only the matching lead and reject stale rollbacks", () => {
  const a = fromDb({
      id: "a",
      business_name: "A",
      updated_at: "2026-11-04T10:00:00Z",
    }),
    b = fromDb({ id: "b", business_name: "B" });
  const next = replaceLead([a, b], { ...a, status: "Interested" });
  assert.equal(next[0].status, "Interested");
  assert.equal(next[1], b);
  const confirmed = { ...next[0], updatedAt: "2026-11-04T10:01:00Z" };
  assert.equal(replaceLead([confirmed, b], a)[0], confirmed);
});
