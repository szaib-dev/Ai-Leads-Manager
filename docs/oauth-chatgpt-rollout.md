# Folio OAuth 2.1 → ChatGPT MCP rollout (NOT LIVE)

This branch is a **disabled foundation**, not a complete working OAuth connection. Do **not** set `FOLIO_OAUTH_ENABLED=true` yet.

## Existing state

- `/mcp` is deployed with the original Folio API-key Bearer scheme (`folio_...`). A Supabase OAuth JWT will be rejected by that route.
- `/api/v1/requests` is the existing 13-action API with key-scoped owner checks, optimistic concurrency, audit, rate limits and idempotency.
- Current Folio app uses Supabase Auth for web sessions, with broad owner-based RLS. A normal OAuth access token is also a user JWT and, unless restricted, can access every endpoint granted to the `authenticated` role. Folio API-key scopes are **not** applied to OAuth tokens automatically.
- This branch adds `/oauth/consent`, `/api/oauth/decision`, and `/.well-known/oauth-protected-resource` for future OAuth authorization, plus a login return-path exception for consent.
- All new OAuth-related pages and routes return a disabled message unless `FOLIO_OAUTH_ENABLED=true`.

## Security work before enabling

1. Design per-client Folio permissions (read/add/edit/archive/delete/import leads, meetings, followups) and grant/revoke UX. Persist grants by `owner_id` + verified `client_id`; show exact permissions before approval. **Never equate `openid email profile` with permission to modify leads.**
2. Configure Supabase OAuth server with PKCE, DCR or verified ChatGPT OAuth client registration, authorization UI path `/oauth/consent`, production Site URL, exact allowlisted callback URL, asymmetric signing keys and an OAuth audience specific to the `/mcp` resource. Confirm the server supports and preserves the MCP `resource` parameter and token audience.
3. Add a dedicated OAuth token validation path to `/mcp`: verify JWT signature and issuer (not decoding alone), `exp`, `aud`, the verified `client_id`, the authenticated user and active owner/client grant, and permitted per-action scopes. Provide RFC 9728 `WWW-Authenticate` challenge and tool-level `securitySchemes`. Keep the legacy API-key path working.
4. Restrict OAuth tokens from directly exercising the dashboard's general `authenticated` role APIs and tables. Use a dedicated role, controlled auth hook, and narrow database grants/RLS or an equivalent enforced isolation boundary. Do not assume Folio MCP tool filtering alone protects database access. Maintain separation from the existing API-key scope model.
5. Route OAuth MCP calls to the same audited, owner-scoped lead and meeting implementations; keep 32KB limit, optimistic `expectedUpdatedAt`, idempotency and zero fabricated calls. Ensure revoked grants stop existing access and refresh-token reauthorization is correct.
6. Validate in a disposable account: OAuth discovery, DCR/PKCE, login and consent, code exchange, signed-token validation, audience mismatch, client mismatch, wrong scopes, revoked access, repeated write, stale lead revision, full read/write workflow, and direct Supabase API isolation. Include negative tests for CSRF, open redirects, replay and expired tokens.

## Planned setup once tested

1. Enable Supabase Authentication → OAuth Server and dynamic client registration, set the Auth Site URL and Authorization Path to `/oauth/consent`; configure appropriate redirect URIs and issuer.
2. Deploy the fully validated server with `FOLIO_OAUTH_ENABLED=true`.
3. In eligible ChatGPT browser settings add the custom MCP URL `https://ai-leads-manager-burak.vercel.app/mcp`, choose OAuth, and complete Folio sign-in and consent.
4. Verify `pages.list` read, a disposable lead write and revoke behavior. Do not test writes against production businesses.

## Notes

- This GitHub branch **does not** configure Supabase Auth dashboard settings, deploy any changes, or alter the previously created private plugin's API-key auth manifest.
- OAuth is a method of authentication, **not** a way to bypass ChatGPT plan entitlement for custom MCP tools.
- A 405 from typing `/mcp` into a browser only means GET isn't supported; it doesn't prove OAuth works.
- Never commit raw Folio API keys, OAuth client secrets, or signing keys. Rotate the previously shared key.
