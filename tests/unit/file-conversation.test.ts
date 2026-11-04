import test from "node:test";
import assert from "node:assert/strict";
import {
  isFileConfirmation,
  fileSummary,
  fileWriteAllowed,
  validateFileMapping,
  fileDecisionSchema,
} from "../../src/lib/ai/file-contracts";
import { parseCsv, mapRows } from "../../src/lib/imports/csv";
test("file evidence counts all rows while keeping examples bounded", () => {
  const summary = fileSummary(
    "name,phone,category\n" +
      Array.from(
        { length: 80 },
        (_, i) => `Business ${i},${i % 2 ? "123" : ""},Clinic`,
      ).join("\n"),
  );
  assert.equal(summary.rowCount, 80);
  assert.equal(summary.sample.length, 5);
  assert.equal(summary.columns[1].missing, 40);
  assert.deepEqual(summary.columns[2].mostCommon, [
    { value: "Clinic", count: 80 },
  ]);
});
test("analysis-only and negated import instructions cannot authorize writes", () => {
  for (const text of [
    "don't import it",
    "do not create a page",
    "just explain this file",
    "only analyze it",
    "explain before importing",
  ]) {
    assert.equal(fileWriteAllowed(text), false, text);
  }
  assert.equal(fileWriteAllowed("create a page and choose a name"), true);
});
test("file decisions cannot invent mapping indices or unsupported actions", () => {
  const csv = parseCsv("name,phone\nFixture,123");
  assert.throws(() => validateFileMapping(csv, { business_name: 5 }));
  assert.throws(() => validateFileMapping(csv, { business_name: 0, phone: 0 }));
  assert.equal(
    fileDecisionSchema.safeParse({
      action: "delete",
      pageId: null,
      pageName: "",
      reply: "",
      mapping: {},
    }).success,
    false,
  );
});

test("casual confirmations preserve an existing import instruction", () => {
  const history = [
    { role: "user", content: "Create a lead page, choose a name" },
    {
      role: "assistant",
      content: "I will create Florida Upholstery Leads. Shall I proceed?",
    },
  ];
  for (const text of ["hmm yeah", "yup that would be better", "okay", "sure"]) {
    assert.equal(isFileConfirmation(text), true);
    assert.equal(fileWriteAllowed(text, history), true);
  }
  for (const text of ["no", "not yet", "okay but wait", "don't do it"]) {
    assert.equal(isFileConfirmation(text), false);
  }
});
test("Not called export status means New, unknown statuses remain invalid", () => {
  const csv = parseCsv(
    "Business,Call status,Published business phone\nFixture,Not called,+12025550101",
  );
  const result = mapRows(csv, csv.mapping);
  assert.equal(result.valid[0].status, "new");
  assert.equal(result.valid[0].phone, "+12025550101");
  const bad = parseCsv("name,status\nFixture,Unknown");
  assert.match(
    mapRows(bad, bad.mapping).invalid[0].message,
    /Unrecognized status/,
  );
});
