import test from "node:test";
import assert from "node:assert/strict";
import {
  contextSchema,
  intentSchema,
  deletionCountryGuard,
  validateInstruction,
} from "../../src/lib/ai/assistant-contracts";
import { presentationFor, uiBlockSchema } from "../../src/lib/ai/presentation";
import { parseCsv, mapRows } from "../../src/lib/imports/csv";
import { automaticReadiness } from "../../src/lib/imports/automatic-policy";
import type { AiResult } from "../../src/lib/ai/assistant-contracts";
test("SQL null conversation references normalize before first-turn count queries", () => {
  const actualSqlShape = {
    pageId: undefined,
    selectedIds: [],
    recentImportId: null,
    previousResultId: null,
    history: [],
  };
  const context = contextSchema.parse(actualSqlShape);
  assert.equal(context.previousResultId, undefined);
  assert.equal(context.recentImportId, undefined);
  assert.equal(context.pageId, undefined);
  assert.equal(
    contextSchema.safeParse({ ...actualSqlShape, ownerId: "forged" }).success,
    false,
  );
});

test("deletion rejects dropped selected/import scope and optional missing-field predicates", () => {
  const intent = intentSchema.parse({
    action: "delete",
    page: "all",
    import: "none",
    selection: "none",
    filter: {
      logic: "and",
      groups: [
        {
          logic: "or",
          conditions: [
            { field: "phone", op: "missing", value: "" },
            { field: "country", op: "equals", value: "USA" },
          ],
        },
      ],
    },
    changes: {},
    destination: "",
    question: "",
  });
  assert.match(
    validateInstruction(intent, "Delete all USA leads without phone numbers")!,
    /missing-phone/,
  );
  assert.match(
    validateInstruction(intent, "Remove these 5 selected businesses")!,
    /selected records/,
  );
  assert.match(
    validateInstruction(
      intent,
      "Delete the leads from my latest import that have no websites",
    )!,
    /latest import scope/,
  );
});
test("generative UI accepts only known component schemas and grounded values", () => {
  const result = {
    action: "search",
    count: 32,
    rows: [],
    scope: { pageId: null },
    statistics: [
      { label: "new", count: 30 },
      { label: "interested", count: 2 },
    ],
  } as unknown as AiResult;
  assert.deepEqual(presentationFor(result, "How many leads do I have?"), [
    { type: "metric", label: "Matching leads across all pages", value: 32 },
  ]);
  assert.equal(
    presentationFor(result, "Show statistics by status")[0].type,
    "chart",
  );
  for (const data of [
    { type: "html", html: "<script>alert(1)</script>" },
    { type: "metric", label: "Count", value: 5, onClick: "delete all" },
    { type: "chart", title: "Fake", bars: [{ label: "New", count: -1 }] },
  ])
    assert.equal(uiBlockSchema.safeParse(data).success, false);
});
test("automatic imports require high confidence, consistent headers, valid rows and no review-only statuses", () => {
  const csv = parseCsv(
    "Business name,Phone,Extra\nOak Cafe,+12025550123,Original extra",
  );
  const suggestion = {
    mapping: { business_name: 0, phone: 1 },
    cleanup: [],
    explanation: "Mapped",
    confidence: "high",
  } as const;
  assert.equal(automaticReadiness(csv, { ...suggestion, cleanup: [] }), null);
  assert.match(
    automaticReadiness(csv, {
      ...suggestion,
      cleanup: [],
      confidence: "review",
    })!,
    /review/,
  );
  assert.match(
    automaticReadiness(csv, {
      ...suggestion,
      cleanup: [],
      mapping: { business_name: 0 },
    })!,
    /recognized header/,
  );
  const sensitive = parseCsv("Business name,Status\nOak Cafe,Not Interested");
  assert.match(
    automaticReadiness(sensitive, {
      mapping: { business_name: 0, status: 1 },
      cleanup: [],
      explanation: "",
      confidence: "high",
    })!,
    /confirmation/,
  );
  const unusual = parseCsv(
    "Trading label,Mysterious URL\nOak Cafe,https://maps.google.com/?cid=x",
  );
  assert.match(
    automaticReadiness(unusual, {
      mapping: { business_name: 0 },
      cleanup: [],
      explanation: "",
      confidence: "high",
    })!,
    /unmapped contact or URL/,
  );
  const mapped = mapRows(csv, { business_name: 0, phone: 1 }, [], true);
  assert.equal(mapped.valid[0].notes, "Extra: Original extra");
  assert.equal(mapped.valid[0].phone, "+12025550123");
});
test("deletion guard preserves an explicit country instead of silently broadening scope", () => {
  const intent = intentSchema.parse({
    action: "delete",
    page: "all",
    import: "none",
    selection: "none",
    filter: {
      logic: "and",
      groups: [
        {
          logic: "and",
          conditions: [{ field: "phone", op: "missing", value: "" }],
        },
      ],
    },
    changes: {},
    destination: "",
    question: "",
  });
  assert.match(
    deletionCountryGuard(intent, "Delete all USA leads without phone numbers")!,
    /country/,
  );
  assert.equal(
    deletionCountryGuard(
      intent,
      "Delete all USA leads without phone numbers",
      "USA",
    ),
    undefined,
  );
  intent.filter.groups[0].conditions.push({
    field: "country",
    op: "equals",
    value: "USA",
  });
  assert.equal(
    deletionCountryGuard(intent, "Delete all USA leads without phone numbers"),
    undefined,
  );
  intent.filter.groups[0].logic = "or";
  assert.match(
    deletionCountryGuard(intent, "Delete all USA leads without phone numbers")!,
    /country/,
  );
  intent.filter.groups[0].logic = "and";
  intent.filter.logic = "or";
  intent.filter.groups.push({
    logic: "and",
    conditions: [{ field: "website", op: "missing", value: "" }],
  });
  assert.match(
    deletionCountryGuard(intent, "Delete all USA leads without phone numbers")!,
    /country/,
  );
  assert.match(
    deletionCountryGuard(
      intent,
      "Delete all USA leads without phone numbers",
      "USA and Canada",
    )!,
    /country/,
  );
});
