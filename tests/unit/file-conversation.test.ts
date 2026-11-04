import test from "node:test";
import assert from "node:assert/strict";
import {
  fileSummary,
  fileWriteAllowed,
  validateFileMapping,
  fileDecisionSchema,
} from "../../src/lib/ai/file-contracts";
import { parseCsv } from "../../src/lib/imports/csv";
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
