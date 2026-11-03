import test from "node:test";
import assert from "node:assert/strict";
import { csvSample, validateSuggestion } from "../../src/lib/ai/contracts";
import { parseCsv, mapRows } from "../../src/lib/imports/csv";
import { cleanupSchema } from "../../src/lib/imports/cleanup";
test("AI samples are bounded to headers and three truncated rows, even for thousands of leads", () => {
  const csv = {
    headers: ["strange field"],
    rows: Array.from({ length: 5000 }, () => ["x".repeat(500)]),
  };
  const sample = csvSample(csv);
  assert.equal(sample.rows.length, 3);
  assert.equal(sample.rows[0][0].length, 80);
  assert.equal(JSON.stringify(sample).includes("x".repeat(81)), false);
});
test("AI output accepts only supported mappings and rejects code, extra fields, invented values and ambiguous indices", () => {
  assert.equal(
    validateSuggestion(
      {
        mapping: { business_name: 0, phone: 1 },
        cleanup: [],
        explanation: "Review",
      },
      2,
    ).mapping.phone,
    1,
  );
  for (const mapping of [
    { business_name: 2 },
    { business_name: 0, phone: 0 },
    { business_name: "Made up" },
    { sql: 0 },
  ])
    assert.throws(() =>
      validateSuggestion({ mapping, cleanup: [], explanation: "" }, 2),
    );
  assert.throws(() =>
    validateSuggestion(
      {
        mapping: { business_name: 0 },
        cleanup: [],
        explanation: "",
        sql: "delete",
      },
      2,
    ),
  );
  assert.throws(() => cleanupSchema.parse(["rewrite_maps"]));
});
test("Optional formatting preserves Maps equality, notes, phone digits, missing fields and all rows", () => {
  const csv = parseCsv(
    "name,phone,website,google maps url,notes\nExample,  +001  234 ext. 0  , https://example.com ,https://maps.google.com/?cid=AbC,  unchanged  \nExample,,,,",
  );
  const original = mapRows(csv, csv.mapping);
  assert.equal(original.invalid.length, 1);
  const cleaned = mapRows(csv, csv.mapping, [
    "trim_outer_whitespace",
    "normalize_phone_spacing",
  ]);
  assert.equal(cleaned.valid.length, 2);
  assert.equal(cleaned.valid[0].phone, "+001 234 ext. 0");
  assert.equal(cleaned.valid[0].website_url, "https://example.com");
  assert.equal(
    cleaned.valid[0].google_maps_url,
    "https://maps.google.com/?cid=AbC",
  );
  assert.equal(cleaned.valid[0].notes, "  unchanged  ");
  assert.equal(cleaned.valid[1].phone, "");
  assert.equal(csv.rows[0][2], " https://example.com ");
});
test("AI is optional: manual mapping works for unusual headers and preserves same-name and same-phone records", () => {
  const csv = parseCsv("establishment,dial\nSame,12345\nSame,12345\nNo phone,");
  const mapped = mapRows(csv, { business_name: 0, phone: 1 });
  assert.equal(mapped.valid.length, 3);
  assert.equal(mapped.valid[2].phone, "");
});
