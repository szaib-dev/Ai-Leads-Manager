# OAuth security and staging verification — PR #3

Status: real staging OAuth flow verified; production OAuth remains disabled.
PR rebased onto main f13694c (includes PR #1 and PR #2). No main merge or production Supabase changes.

## Implementation and compatibility

The MCP resource verifies ES256 signatures using the configured Supabase JWKS,
issuer, canonical MCP audience, exp/iat, UUID owner/client, isolated role and
MCP access-token purpose. Each database call checks an owner/client capability
grant, expiry/revocation, integration settings and the existing action engine.
There is no service-role application key or Folio storage of OAuth credentials,
refresh tokens or signing secrets. OAuth credentials stay in the test process
or the external OAuth client; normal dashboard session cookies remain unchanged.

All 13 original `folio_*` tool names are preserved. API keys keep their endpoint.
MCP writes preserve optional generated idempotency keys and return them for retries.
Read-only/destructive annotations, safe callback redirects, narrow consent login
return paths and already-approved authorization redirects are retained from PRs 1/2.

The migration must remove PUBLIC execution because even NOINHERIT roles inherit
PUBLIC privileges. It now first materializes exactly that existing effective
access for anon/authenticated/service_role, then removes PUBLIC. Existing explicit
denials remain denials. A before/after PostgreSQL snapshot asserts identical
execution privileges for every existing public RPC for those three roles, including
a legacy PUBLIC-only canary. Future functions need explicit grants. Other custom
roles in any deployment need a separate inventory. No table/RLS policies, realtime
publication or existing integration RPC definitions are changed.

The OAuth role has no login, inherited roles, bypass-RLS or superuser rights,
no table grants and only one public RPC. Setup refuses a pre-existing privileged
role. The private executor preserves permissions, owner filters, audit, rate limits,
optimistic concurrency and idempotency. Revocation serializes with actions and also
blocks tokens obtained through subsequent refreshes. Consent grants expire in 90 days.

## Isolated environment actually prepared

- New independent Supabase project: **folio-oauth-pr3-staging**
- Reference: **eygaxwoblnztuktpexpp**, region ap-south-1.
- Production project **lypfxcohmsosedwptebu** was not changed or used for test data.
- All 25 repository migrations applied transactionally; migration history recorded.
- OAuth Server and Dynamic Client Registration enabled in staging only.
- Authorization Path: `/oauth/consent`.
- Site URL: `http://127.0.0.1:3005`.
- Custom Access Token Hook: `pg-functions://postgres/public/folio_access_token_hook`.
- JWT signing: ES256, verified using live staging JWKS.
- `private.oauth_config.resource`: `http://127.0.0.1:3005/mcp`.
- Local app test uses FOLIO_OAUTH_ENABLED=true in its child process only. HTTP
  resources are allowed exclusively for localhost/127.0.0.1; remote audiences need HTTPS.
- No production .env files were changed. No production leads were read or modified.

Preview branch creation was attempted without copying data, but Supabase returned
HTTP 402 (branching requires Pro). A separate staging project succeeded without a
plan change. Docker local Auth startup failed because its Linux engine pipe was
unavailable; the real tests instead used hosted staging Auth/Postgres plus local Next.js.

## Tests performed

`tests/oauth-staging.mjs` is a real hosted staging/browser test, not an Auth mock.
It retrieves only staging keys in memory, uses disposable users/records and removes
them in finally. The test is pinned to the staging reference, not production.
Run with Node 22: `node tests/oauth-staging.mjs` after CLI sign-in to the staging owner.

Verified in the successful full run:

- Normal password login with the hook enabled.
- Dynamic registration, real browser login, consent, state, S256 PKCE code exchange,
  refresh, authenticated MCP initialize and all 13 tool definitions.
- OAuth lead create/read/update and meeting scheduling.
- Real direct Supabase table/RPC denial using an OAuth access token.
- OAuth cross-user record access denied using two disposable accounts.
- Reduced Folio permissions denied; revoked grant rejected both existing and newly
  refreshed tokens; normal dashboard JWT rejected as an MCP credential.
- Actual browser CSV upload/review/import and imported lead display.
- Actual API-key HTTP read/update reflected in the browser through realtime.
- Actual API-key HTTP calls for all 13 actions.

Separate checks: full disposable PostgreSQL suite (all migrations, permissions
snapshot, imports, workflows, integration API, OAuth grants and concurrent writes),
72 unit tests, 6 AI provider/stream tests, ESLint, TypeScript, production build,
and production-build route-protection/disabled-OAuth smoke checks.
JWT malformed/unsigned/bad-signature/expired/wrong issuer/audience/claim cases use
locally signed adversarial unit fixtures, not fabricated claims accepted by the app.
No assertion is made that a naturally expired hosted token was waited out.

Initial browser-test failures were test navigation assumptions: /dash/pages is the
country browser, and successful import closes the dialog. The final test uses
/dash/countries/unassigned and verifies imported records and their lead page.
No dashboard product changes were needed for those failures.

## Remaining manual setup for a public HTTPS staging/ChatGPT connection

The verified browser flow uses a local app and real remote staging backend.
A public HTTPS staging deployment and an actual ChatGPT connection are NOT yet verified.
Vercel CLI credentials are absent and the browser is at Vercel login; no production
or preview environment settings were changed to work around that access barrier.

1. Sign into Vercel. Use an isolated staging project or a branch-scoped Preview
   environment for `codex/folio-oauth`. Do not alter Production environment variables.
   Under **Project > Settings > Environment Variables**, set Preview values:
   - NEXT_PUBLIC_SUPABASE_URL=https://eygaxwoblnztuktpexpp.supabase.co
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key from Supabase>
   - FOLIO_OAUTH_ENABLED=true (Preview/staging only)
   - FOLIO_OAUTH_RESOURCE=https://<public-staging-host>/mcp
   Deploy that branch; the HTTPS host must be reachable by the OAuth client.
2. In **Supabase > folio-oauth-pr3-staging > Authentication > URL Configuration**,
   change Site URL to `https://<public-staging-host>` (no /mcp suffix).
3. In **Authentication > OAuth Server**, verify enabled, Dynamic Client Registration
   enabled, Authorization Path `/oauth/consent`. In **Authentication > Hooks**, verify
   Custom Access Token selects public.folio_access_token_hook. In **Authentication >
   Signing Keys**, verify ES256 remains current. These settings already work in staging.
4. In **staging SQL Editor**, bind the identical resource:
   `update private.oauth_config set resource='https://<public-staging-host>/mcp';`
   Do not run this against lypfxcohmsosedwptebu. Reconnect clients after this change;
   old local-audience tokens should fail audience validation.
5. In ChatGPT's connector/app setup, use `https://<public-staging-host>/mcp` with OAuth.
   If preregistration is needed, use the exact redirect URI supplied by ChatGPT;
   do not guess it. Allow only the Folio permissions needed on consent.
6. Verify ChatGPT initialize/list/calls and revoke via `/oauth/connections`. Repeat
   the live checks against the HTTPS deployment, including Storage/Realtime denial
   for OAuth tokens. The local test currently directly checks the Data API and RPCs.
7. Supabase discovery advertises both S256 and plain PKCE. S256 succeeded, but
   provider-side rejection of plain PKCE still requires confirmation/hardening.
   Keep this explicit OAuth 2.1 security review item open.
8. Before any later production release, separately approve and audit custom-role
   grants, retire pre-hook OAuth authorizations/refresh tokens and wait out old
   authenticated-role access tokens. Nothing in this PR enables production OAuth.

The staging project remains available; test accounts and their data are deleted.
No subscription was upgraded. Delete/pause the staging project when no longer needed
through its dashboard if desired; that lifecycle action was not performed automatically.

## Official references

- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://supabase.com/docs/guides/auth/oauth-server/token-security
- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Installed Next.js route guide: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
