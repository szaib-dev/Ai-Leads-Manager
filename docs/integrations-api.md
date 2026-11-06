# Folio Integrations & API

Work is isolated on branch codex/integrations-api in the folio-integrations worktree. The shared main checkout was not overwritten after isolation.

## Settings and credentials

Settings -> Manage integrations opens /dash/settings/integrations. Generate a named key, select permissions and choose 30/90/365-day expiry. Defaults permit only reads. The 256-bit random secret is shown once; only SHA-256 and a short prefix are stored. Secrets are not placed in localStorage, audit records, repository files or URLs. Hide the secret after copying it into your connector's secure credential settings.

Each key has independent permissions for reading, adding, editing, importing, archiving and deleting leads; viewing/creating/rescheduling/cancelling meetings; and creating follow-ups. Pause/resume one key, permanently revoke it, or pause all external requests. Revoked keys cannot be re-enabled. Database checks enforce scope, owner, expiry and enabled state on every request, including retries. Dashboard actions do not depend on API keys.

## Endpoint

POST /api/v1/requests with Authorization: Bearer YOUR_SECRET and Content-Type: application/json. Requests are {"action":"leads.search","data":{"query":"Business name"}}. /api/v1/openapi.json supplies the operation schemas. A UUID Idempotency-Key header is mandatory for writes; reuse only to retry an identical operation. Search first, ask the user to disambiguate similar names, then use the exact ID and updated_at as expectedUpdatedAt. A stale timestamp or changed retry payload is rejected. The API does not record phone attempts.

Meetings require a future timestamp with explicit UTC offset plus an IANA timezone. Folio's existing timezone-less follow-up fields are stored in Asia/Karachi; the original timezone and UTC instant are included in notes. API clients should use the returned instant or notes when displaying another zone. These are Folio schedules, not calendar invitations.

An API-capable tool/connector must be configured separately; skill instructions alone cannot call this API. This release does not deliver outgoing event webhooks.

## Security and limits

Owner-scoped RPCs expose only safe key metadata, never hashes. Raw integration tables have RLS enabled and no anon/authenticated grants. The narrowly scoped public token gateway invokes existing lead/import/follow-up mutations, retains workflow history and emits their existing realtime signals. It does not use a Supabase service-role key. It restores caller JWT context before returning. Changes to key policy and in-flight operations are serialized per workspace. Existing meetings cannot be cancelled indirectly through lead-status/archive/delete permissions.

Limit: 60 identified requests/minute/key, 32 KB request body, bounded reads (50 leads), and up to 200 rows per append-only import subject to body size. Known-key successes and denials are audited with action/status/code/request ID; request bodies and tokens are excluded. Invalid headers or payloads rejected before key verification are not included in the owner audit. Master-switch, scope, pause and revoke checks precede receipt replay.

## Deployment and checks

Migration 202611060023_integrations.sql was applied to production project lypfxcohmsosedwptebu. No user keys were generated in production. Source is not merged into main or deployed yet. Include the branch's migration when merging so the migration ledger remains consistent.

Local PostgreSQL integration tests passed for permissions, anonymous/raw-table denial, owner isolation, retries, stale writes, pause/revoke, rate limits, timezone conversion, follow-ups and zero fabricated calls. Unit checks, lint, TypeScript and production build run from this isolated worktree. Hosted transactional testing and disposable-account browser testing initially encountered renewed HTTP 403 for administrative access; the browser fixture is an explicit local transport mock and is not a substitute for live-hosted verification.

Build in this Windows environment uses NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 to fetch Google Fonts through system trust. No TLS protection is disabled. LOCAL_UI_FIXTURE=1 node --env-file=.env.local tests/integrations-browser-remote.mjs runs the local UI flow. Rebuild normally afterward to restore production Supabase environment values.

Final local verification: 69 unit tests, lint, TypeScript, production build and the PostgreSQL integration suite passed. The local browser transport fixture passed the complete Settings and HTTP flow (secret generation/hiding, master pause, scope toggles, key pause/revoke, idempotent scheduling, queue invalidation, audit and mobile layout). This validates UI/handler integration locally; hosted end-to-end remains unverified because administrative access was denied.

## Hosted follow-up verification

After access was restored, the hosted SQL regression passed. A real HTTP/browser attempt exposed a PL/pgSQL name collision in lead search; migration 202611060024_integration_read_aliases.sql fixes search, lead-details notes and meeting-list aliases without changing the API signature. The expanded SQL regression (including these reads) then passed against hosted Supabase inside a rolled-back fixture transaction. Migration 024 is applied on the same project. No business records were changed.

Hosted end-to-end browser reruns remain pending: administrative key access and even SELECT 1 returned HTTP 403 again after the brief access window. The first failed browser run removed its disposable Auth account. A subsequent SQL-seeded HTTP approach was also blocked before fixture creation; that experimental script was not included in the regression suite. Do not describe hosted HTTP/browser verification as passed yet.
