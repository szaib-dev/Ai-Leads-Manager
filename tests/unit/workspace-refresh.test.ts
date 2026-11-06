import { test } from "node:test";
import assert from "node:assert/strict";
import { manualLeadSchema } from "../../src/lib/leads/manual-contract";
import {
  createWorkspaceQueryClient,
  workspaceQueryKey,
} from "../../src/lib/query/cache";
const input = {
  pageId: "10000000-0000-4000-8000-000000000001",
  requestId: "10000000-0000-4000-8000-000000000002",
  lead: {
    business_name: "One business",
    phone: "",
    website_url: "",
    google_maps_url: "",
    country: "",
    location: "",
    notes: "",
    status: "new",
  },
};
test("a single manual lead needs only a name and an existing page; invalid URLs and owner injection are rejected", () => {
  assert.ok(manualLeadSchema.safeParse(input).success);
  assert.ok(
    !manualLeadSchema.safeParse({
      ...input,
      lead: { ...input.lead, business_name: " " },
    }).success,
  );
  assert.ok(!manualLeadSchema.safeParse({ ...input, pageId: "" }).success);
  assert.ok(
    !manualLeadSchema.safeParse({ ...input, ownerId: "other" }).success,
  );
  assert.ok(
    !manualLeadSchema.safeParse({
      ...input,
      lead: { ...input.lead, google_maps_url: "javascript:alert(1)" },
    }).success,
  );
});
test("workspace cache deduplicates simultaneous reads and isolates owner, privacy epoch and mutations", async () => {
  const client = createWorkspaceQueryClient();
  let reads = 0;
  const load = async () => {
    reads++;
    await new Promise((r) => setTimeout(r, 5));
    return { name: "Private lead" };
  };
  const key = workspaceQueryKey("owner-a", 0, "leads", "page", 0);
  try {
    await Promise.all([
      client.fetchQuery({ queryKey: key, queryFn: load }),
      client.fetchQuery({ queryKey: key, queryFn: load }),
    ]);
    assert.equal(reads, 1);
    await client.fetchQuery({ queryKey: key, queryFn: load });
    assert.equal(reads, 1);
    assert.equal(
      client.getQueryData(workspaceQueryKey("owner-b", 0, "leads", "page", 0)),
      undefined,
    );
    assert.equal(
      client.getQueryData(workspaceQueryKey("owner-a", 1, "leads", "page", 0)),
      undefined,
    );
    await client.fetchQuery({
      queryKey: workspaceQueryKey("owner-a", 0, "leads", "page", 1),
      queryFn: load,
    });
    assert.equal(reads, 2);
    await client.cancelQueries();
    client.clear();
    assert.equal(client.getQueryData(key), undefined);
  } finally {
    client.clear();
  }
});
