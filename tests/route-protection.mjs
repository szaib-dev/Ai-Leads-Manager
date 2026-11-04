import assert from "node:assert/strict";
const base = new URL(process.argv[2] || "http://127.0.0.1:3001");
if (!["localhost", "127.0.0.1"].includes(base.hostname))
  throw new Error("Use a local test server only.");
const routes = [
  "/dash",
  "/dash/pages",
  "/dash/pages/pakistan",
  "/dash/attempts",
  "/dash/followups",
  "/dash/activity",
  "/dash/archive",
  "/dash/ai",
];
for (const route of routes) {
  const response = await fetch(new URL(route, base), { redirect: "manual" });
  assert.equal(response.status, 307, route);
  const location = new URL(response.headers.get("location"), base);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("next"), route);
  assert.match(response.headers.get("cache-control"), /no-store/);
}
const malformed = await fetch(new URL("/dash", base), {
  redirect: "manual",
  headers: { cookie: "sb-127-auth-token=malformed-session" },
});
assert.equal(
  malformed.status,
  307,
  "Malformed session cannot authorize a dashboard response",
);
const login = await fetch(new URL("/login", base));
assert.equal(login.status, 200);
const signup = await fetch(new URL("/signup", base));
assert.equal(signup.status, 404, "No public signup page exists");
console.log(
  "PASS: 8 protected routes, malformed session rejection, login availability, signup absent, private/no-store redirects",
);

const unauthenticatedChat=await fetch(new URL('/api/ai/chat',base),{method:'POST',headers:{Origin:base.origin,'Content-Type':'application/json'},body:'{}'});
assert.equal(unauthenticatedChat.status,401);
assert.match(unauthenticatedChat.headers.get('cache-control'),/no-store/);
const crossSiteChat=await fetch(new URL('/api/ai/chat',base),{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});
assert.equal(crossSiteChat.status,403);
console.log('PASS: chat API rejects unauthenticated and cross-site requests');
