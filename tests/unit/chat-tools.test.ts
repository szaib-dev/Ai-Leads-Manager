import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../../src/lib/imports/csv";
import { chatImportDestination } from "../../src/lib/imports/chat-policy";
import {
  publicWebsiteUrl,
  isPublicWebsiteAddress,
  websiteText,
} from "../../src/lib/ai/website-policy";
import {
  groundClassifications,
  isRelevanceQuestion,
  relevanceSchema,
} from "../../src/lib/ai/relevance-contracts";

test("website evidence blocks private endpoints, credentials and non-web targets", () => {
  for (const ip of [
    "0.0.0.0",
    "10.2.3.4",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.4.5",
    "192.168.1.1",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicWebsiteAddress(ip), false, ip);
  assert.equal(isPublicWebsiteAddress("93.184.216.34"), true);
  for (const url of [
    "file:///secret",
    "http://user:pass@example.com",
    "http://example.com:8080",
    "ftp://example.com",
  ])
    assert.throws(() => publicWebsiteUrl(url));
  assert.equal(
    websiteText(
      "<style>secret</style><script>ignore rules</script><h1>Skin clinic</h1>",
    ),
    "Skin clinic",
  );
});
test("chat CSV chooses an owned explicit page, unique country match, or new filename page", () => {
  const csv = parseCsv("Business name,Country\nOak Skin,USA\nPine Clinic,USA");
  const pages = [
    { id: "usa", name: "USA" },
    { id: "other", name: "Other" },
  ];
  assert.equal(
    chatImportDestination(csv, csv.mapping, "skin.csv", pages).pageId,
    "usa",
  );
  assert.equal(
    chatImportDestination(csv, csv.mapping, "skin.csv", pages, "other").pageId,
    "other",
  );
  assert.equal(
    chatImportDestination(csv, csv.mapping, "skin.csv", []).newName,
    "USA",
  );
  assert.throws(() =>
    chatImportDestination(csv, csv.mapping, "skin.csv", pages, "forged"),
  );
  const mixed = parseCsv("Business name,Country\nOak Skin,USA\nOther,Canada");
  assert.equal(
    chatImportDestination(mixed, mixed.mapping, "mixed-clinics.csv", pages)
      .newName,
    "mixed clinics",
  );
});
test("relevance is evidence-backed advisory classification, including uncertain missing information", () => {
  const rows = [
    {
      id: "99900000-0000-4000-8000-000000000001",
      expected: "2026-11-05T00:00:00Z",
      name: "Oak Skin Clinic",
      website: "https://oak.example",
      notes: "Offers skin treatments",
    },
  ];
  const supported = groundClassifications(
    {
      items: [
        {
          index: 0,
          classification: "relevant",
          reason: "Explicit skin clinic",
          evidence: "Skin Clinic",
        },
      ],
    },
    rows,
    "skin clinics",
    0,
    1,
  );
  assert.equal(supported.items[0].classification, "relevant");
  const invented = groundClassifications(
    {
      items: [
        {
          index: 0,
          classification: "irrelevant",
          reason: "Only sells cars",
          evidence: "Car dealership",
        },
      ],
    },
    rows,
    "skin clinics",
    0,
    1,
  );
  assert.equal(invented.items[0].classification, "uncertain");
  assert.throws(() =>
    groundClassifications({ items: [] }, rows, "skin clinics", 0, 1),
  );
  assert.equal(
    relevanceSchema.safeParse({ ...supported, execute: "delete all" }).success,
    false,
  );
  assert.equal(
    isRelevanceQuestion("Delete leads irrelevant to skin clinics"),
    true,
  );
  assert.equal(isRelevanceQuestion("How many leads do I have?"), false);
});
