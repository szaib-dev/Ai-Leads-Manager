import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo } from "../../src/lib/auth/return-to";
import { validateSupabaseConfig } from "../../src/lib/supabase/config";
import { loginSchema } from "../../src/lib/validation/auth";
import {
  mapsUrlSchema,
  pageRange,
  daySchema,
} from "../../src/lib/validation/domain";
import {
  operationSchema,
  requiresApproval,
} from "../../src/lib/operations/contracts";

test("return paths stay within the dashboard", () => {
  for (const path of [
    "https://evil.example/dash",
    "//evil.example/dash",
    "/dashboard",
    "/dash/../../evil",
    "/dash\\evil",
    "/dash/%5c%5cevil",
    "/dash/%0d%0aLocation:evil",
    null,
    {},
    "/login",
    "javascript:alert(1)",
  ])
    assert.equal(safeReturnTo(path), "/dash");
  assert.equal(
    safeReturnTo("/dash/followups?period=today"),
    "/dash/followups?period=today",
  );
});
test("missing configuration never enables authentication", () =>
  assert.equal(validateSupabaseConfig(), null));
test("private Supabase keys cannot be used as publishable credentials", () => {
  assert.throws(() => validateSupabaseConfig(undefined, "sb_secret_example"));
  assert.throws(() =>
    validateSupabaseConfig(
      "https://user:password@project.supabase.co",
      "sb_publishable_test",
    ),
  );
  assert.throws(() =>
    validateSupabaseConfig("https://project.supabase.co", "sb_secret_example"),
  );
  const jwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`;
  assert.throws(() =>
    validateSupabaseConfig("https://project.supabase.co", jwt),
  );
  assert.throws(() =>
    validateSupabaseConfig("http://remote.example", "sb_publishable_test"),
  );
  assert.deepEqual(
    validateSupabaseConfig("http://127.0.0.1:54321", "sb_publishable_test"),
    { url: "http://127.0.0.1:54321", key: "sb_publishable_test" },
  );
});
test("credentials are validated without changing the password", () => {
  assert.equal(
    loginSchema.parse({
      email: "  owner@example.com ",
      password: " password with spaces ",
    }).password,
    " password with spaces ",
  );
  assert.equal(
    loginSchema.safeParse({ email: "invalid", password: "" }).success,
    false,
  );
});
test("Maps validation preserves exact parameters, case, and fragments", () => {
  const value = "https://www.google.com/maps?cid=AbC&x=1#Location";
  assert.equal(mapsUrlSchema.parse(value), value);
  assert.equal(mapsUrlSchema.safeParse(" " + value).success, false);
  assert.equal(mapsUrlSchema.safeParse("javascript:alert(1)").success, false);
  assert.equal(
    mapsUrlSchema.safeParse("https://www.google.com/maps?x=" + "a".repeat(2048))
      .success,
    false,
  );
});
test("pagination is bounded and calendar dates are validated", () => {
  assert.deepEqual(pageRange({ page: 2, pageSize: 25 }), {
    page: 2,
    pageSize: 25,
    from: 25,
    to: 49,
  });
  assert.throws(() => pageRange({ pageSize: 1000 }));
  assert.throws(() => pageRange({ page: 0 }));
  assert.equal(daySchema.safeParse("2026-02-30").success, false);
});
test("AI commands reject SQL, forged ownership, and unrestricted predicates", () => {
  assert.equal(
    operationSchema.safeParse({ kind: "sql", sql: "delete from leads" })
      .success,
    false,
  );
  assert.equal(
    operationSchema.safeParse({
      kind: "import_undo",
      importId: "10000000-0000-4000-8000-000000000001",
      ownerId: "attacker",
    }).success,
    false,
  );
  assert.equal(
    operationSchema.safeParse({ kind: "lead_delete_matching", where: "1=1" })
      .success,
    false,
  );
  const command = operationSchema.parse({
    kind: "import_undo",
    importId: "10000000-0000-4000-8000-000000000001",
  });
  assert.equal(requiresApproval("strict", command), true);
  assert.equal(requiresApproval("balanced", command), true);
  assert.equal(requiresApproval("autonomous", command), false);
});
