# OAuth implementation and release gate

Status: **disabled, not verified end to end; do not enable in production**.

The repository at baseline 91f44cd had the 13 integration actions and API-key
endpoint, but no MCP, consent, decision, or protected-resource routes.

The new MCP transport uses the existing action contracts and database engine.
API-key requests retain the original RPC. OAuth requests verify ES256 signatures
against the configured Supabase JWKS and require exact issuer, MCP audience,
expiration, issuance time, UUID subject/client ID, isolated role, and MCP purpose.
The database independently checks signed request claims and an owner/client grant
on every call. Permissions are Folio grants, **not** Supabase OIDC scopes.

Each consent creates a new grant principal with a 90-day lifetime. Previously
issued tokens predate the new grant and cannot use it. Revocation disables the
principal immediately, including requests with previously issued access tokens.
The original integration engine preserves owner filters, capability enforcement,
audit records, 60/minute rate limit, optimistic concurrency and idempotency.
Mutation tool arguments require a UUID `idempotencyKey`, reused for retries.
The grant lock serializes revocations and actions. No OAuth secret, refresh token,
or signing secret is stored by Folio. No elevated application key is introduced.

The migration removes PUBLIC execution on public-schema functions and its future
default. The non-inheriting `folio_oauth` role has only public-schema usage and
execution of `folio_oauth_request`; it has no authenticated membership or table
permissions. Review this PUBLIC privilege change against any additional deployed
functions absent from this checkout. Future migrations must retain these limits.

## Required setup in an isolated staging environment

1. Keep `FOLIO_OAUTH_ENABLED=false`. Apply migrations through 202611070025 to staging.
2. Insert the canonical staging HTTPS MCP URL into `private.oauth_config` as an
   administrator. Exactly one row is required. Set `FOLIO_OAUTH_RESOURCE` to the
   identical URL. No client-supplied Host or resource value controls validation.
3. Enable the Supabase Custom Access Token hook `public.folio_access_token_hook`.
   It preserves normal browser tokens; OAuth tokens get role `folio_oauth`, the
   MCP audience and `folio_purpose=mcp_access`. Verify both initial issuance and
   refresh issuance. Reject deployment if the hook does not see `client_id`.
4. Supabase must have OAuth Server and registration enabled, Site URL set to the
   staging Folio origin and Authorization Path `/oauth/consent`. ES256 must remain
   active. Register ChatGPT's exact callback URI. Use authorization code with
   **S256 PKCE**, never implicit flow. Supabase owns registration, authorization,
   code/PKCE validation, token exchange, refresh, and revocation endpoints;
   Folio does not proxy credentials or implement another token server.
5. Revoke all previously issued OAuth authorizations and refresh tokens, and wait
   out all pre-hook access tokens. Old tokens with `authenticated` role do not
   have the new role isolation. Audit custom schemas, storage, realtime, exposed
   schemas and deployed RPC privileges in the actual Supabase project as well.
6. Enable OAuth **in staging only**, then complete browser login, consent,
   authorization code/S256 exchange and MCP initialize/tools/list. Request the
   exact MCP resource in authorization and token requests. Check discovery via
   `/.well-known/oauth-protected-resource/mcp`, which points to the Supabase
   authorization issuer and its native RFC 8414 discovery document.
7. Test all token failures, missing permissions, revocation (including refresh),
   second-user access, direct REST/RPC/Storage/Realtime denials, and read/create/
   update/meeting/follow-up operations with disposable users and records. Confirm
   retries do not duplicate writes or call attempts and API keys still work.
8. Only after independent review and passing real integration tests should a
   separate approved release enable production. This PR does not deploy or enable it.

## Verification performed

- TypeScript, ESLint and production build passed.
- All 72 unit tests passed using Node 22.23.4. The default Node 20 runtime caused
  three existing SSR tests to fail; the repository requires Node >=22.
- Real disposable PostgreSQL migration and integration tests passed, including
  OAuth read/create/update/scheduling, permission rejection, cross-owner rejection,
  revocation, table and RPC privilege checks. Existing API-key database tests
  passed (rate limits, idempotency, owner isolation, scheduling and no fabricated calls).
- Live Supabase discovery and JWKS returned HTTP 200, ES256, authorization code
  and refresh grants. Discovery advertises both S256 and plain PKCE; the client
  must use S256, and strict server-wide rejection of plain needs confirmation.
- These are **not** an end-to-end OAuth result: no browser consent, real code
  exchange, refresh, authenticated MCP discovery or live disposable operation was
  completed. The new routes and required hook/config are not deployed. No staging
  deployment/configuration was supplied, and deployment is explicitly prohibited.
- npm install reports eight moderate dependency advisories; no unrelated forced
  dependency upgrades were applied.

## Official references

- [Supabase OAuth server setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Next.js route handler guide read from installed `node_modules/next/dist/docs/`.
