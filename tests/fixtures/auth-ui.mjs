// Local Auth transport fixture for browser regression checks. NOT Supabase Auth or a production server.
// No application route imports this file. It exists only under tests and starts next dev explicitly.
import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
if (process.env.NODE_ENV === "production" || process.env.VERCEL)
  throw new Error("Local test fixture only");
const secret = randomBytes(32),
  revoked = new Set();
const user = {
  id: "10000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@example.com",
  created_at: "2026-11-03T00:00:00Z",
  email_confirmed_at: "2026-11-03T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: {},
};
function session() {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return {
    access_token: `${header}.${body}.${signature}`,
    refresh_token: randomBytes(32).toString("hex"),
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
}
const issued = new Set(),
  refreshTokens = new Set();
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  let text = "";
  for await (const part of request) {
    text += part;
    if (text.length > 10000) {
      response.writeHead(413).end();
      return;
    }
  }
  const url = new URL(request.url, "http://127.0.0.1:55433");
  if (url.pathname === "/auth/v1/token") {
    const body = JSON.parse(text || "{}");
    const valid =
      url.searchParams.get("grant_type") === "password"
        ? body.email === "fixture@example.com" &&
          body.password === "fixture-password"
        : refreshTokens.has(body.refresh_token);
    if (!valid) {
      response
        .writeHead(400)
        .end(
          JSON.stringify({
            message: "Invalid credentials",
            code: "invalid_credentials",
          }),
        );
      return;
    }
    refreshTokens.delete(body.refresh_token);
    const value = session();
    issued.add(value.access_token);
    refreshTokens.add(value.refresh_token);
    response.end(JSON.stringify(value));
    return;
  }
  const token = request.headers.authorization?.replace(/^Bearer /, "");
  if (
    url.pathname === "/auth/v1/user" &&
    issued.has(token) &&
    !revoked.has(token)
  ) {
    response.end(JSON.stringify(user));
    return;
  }
  if (url.pathname === "/auth/v1/logout") {
    revoked.add(token);
    response.writeHead(204).end();
    return;
  }
  response
    .writeHead(401)
    .end(JSON.stringify({ message: "Invalid token", code: "bad_jwt" }));
});
await new Promise((resolve) => server.listen(55433, "127.0.0.1", resolve));
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55433",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only",
    },
  },
);
console.log(
  "LOCAL AUTH FIXTURE — http://127.0.0.1:3000/login — fixture@example.com / fixture-password",
);
function stop() {
  app.kill();
  server.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", () => server.close());
