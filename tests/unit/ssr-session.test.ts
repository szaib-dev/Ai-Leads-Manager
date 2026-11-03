import test from "node:test";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";

// SDK contract tests with a fake Auth transport. These do NOT verify a live Supabase project.
const user = {
  id: "10000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "test@example.com",
  email_confirmed_at: "2026-11-03T00:00:00Z",
  created_at: "2026-11-03T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: {},
};
function token(expired = false) {
  return `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + (expired ? -300 : 3600), iat: Math.floor(Date.now() / 1000) - 600 })).toString("base64url")}.test-signature`;
}
function fixture(expired = false) {
  const jar = new Map<string, string>();
  let refreshes = 0;
  let rejectUser = false;
  const transport: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/logout")) return new Response(null, { status: 204 });
    if (url.includes("/user"))
      return rejectUser
        ? Response.json(
            { message: "Invalid session", code: "bad_jwt" },
            { status: 401 },
          )
        : Response.json(user);
    if (url.includes("/token")) {
      const refresh = url.includes("refresh_token");
      if (refresh) refreshes++;
      return Response.json({
        access_token: token(expired && !refresh),
        refresh_token: "test-refresh",
        expires_in: expired && !refresh ? -300 : 3600,
        token_type: "bearer",
        user,
      });
    }
    return Response.json({ keys: [] });
  };
  const client = () =>
    createServerClient("https://test.supabase.co", "sb_publishable_fixture", {
      global: { fetch: transport },
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) => {
          for (const value of values) {
            if (value.options.maxAge === 0) jar.delete(value.name);
            else jar.set(value.name, value.value);
          }
        },
      },
    });
  return {
    client,
    jar,
    refreshes: () => refreshes,
    reject: () => {
      rejectUser = true;
    },
  };
}
test("SSR session writes cookies and persists across request-scoped clients", async () => {
  const f = fixture();
  const signedIn = await f
    .client()
    .auth.signInWithPassword({
      email: "test@example.com",
      password: "test-only",
    });
  assert.equal(signedIn.error, null);
  assert.ok(f.jar.size > 0);
  const verified = await f.client().auth.getUser();
  assert.equal(verified.data.user?.id, user.id);
  const claims = await f.client().auth.getClaims();
  assert.equal(claims.data?.claims.sub, user.id);
  await f.client().auth.signOut({ scope: "local" });
  assert.equal(f.jar.size, 0);
  const signedOut = await f.client().auth.getUser();
  assert.equal(signedOut.data.user, null);
});
test("expired cookies refresh through setAll before user verification", async () => {
  const f = fixture(true);
  await f
    .client()
    .auth.signInWithPassword({
      email: "test@example.com",
      password: "test-only",
    });
  const verified = await f.client().auth.getUser();
  assert.equal(verified.data.user?.id, user.id);
  assert.ok(f.refreshes() > 0);
});
test("auth-server rejection does not authorize a cookie's cached user", async () => {
  const f = fixture();
  await f
    .client()
    .auth.signInWithPassword({
      email: "test@example.com",
      password: "test-only",
    });
  f.reject();
  const denied = await f.client().auth.getUser();
  assert.equal(denied.data.user, null);
  assert.ok(denied.error);
});
