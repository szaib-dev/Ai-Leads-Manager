# Phase 2 setup and architecture

> This describes the Phase 2 baseline. Phase 3 connects real leads/imports and [Phase 4](PHASE_4_IMPLEMENTATION.md) connects calling, follow-ups, activity and retention. Authentication setup below still applies.

The frontend is preserved. Authentication is real when configured; dashboard records, statistics, calls, archives, and follow-ups still use `src/components/providers.tsx` and the fictional fixtures. No feature screen writes to Supabase. The authenticated layout remounts mock state per user and removes it on logout. The footer identifies mock data.

## Runtime and local configuration

Use **Node 22 or newer** (the current Supabase SDK requires Node 22). `.nvmrc` selects 22; configure Vercel to use Node 22 as well.

1. Create a Supabase project on the Free plan. Save its database password securely outside this repository.
2. Copy `.env.example` to `.env.local` and supply exactly these two values from the project's API settings:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_actual_public_key
   ```

   A legacy **anon** JWT key is accepted in the publishable-key variable. Secret keys (`sb_secret_...`) and service-role JWTs are rejected by configuration validation. Neither a service-role key nor a database password belongs in the app's environment. No administrative Supabase client exists in this code.

3. Run `npm ci`, then `npm run dev`. Restart after changing environment variables. Without configuration, `/login` explains setup and disables sign-in; `/dash/**` redirects to `/login`. There is no unauthenticated demo bypass.

## Apply versioned migrations

Use the Supabase CLI against the intended project. The CLI will prompt for credentials; do not put passwords or tokens into shell history or tracked files.

```sh
npx supabase@3.0.0 login
npx supabase@3.0.0 projects list
npx supabase@3.0.0 link --project-ref YOUR_PROJECT_REF
npx supabase@3.0.0 migration list --remote
npx supabase@3.0.0 db push --remote --dry-run --skip-vault
npx supabase@3.0.0 db push --remote --skip-vault
npx supabase@3.0.0 migration list --remote
```

These commands target CLI 3.0.0. In CLI v3, database commands default to the local database; `--remote` is required for the linked remote project. Confirm the project reference and inspect existing remote migration history and schema before pushing. Stop if the target has unrelated application objects or migration conflicts. `--skip-vault` avoids changing Vault secrets as part of this schema-only setup. Do not use remote reset, migration-history repair, `--include-all`, or seed flags to bypass a mismatch.

Apply the files in order:

1. `supabase/migrations/202611030001_foundation.sql`
2. `supabase/migrations/202611030002_integrity_and_analytics.sql`

The migrations target modern Supabase PostgreSQL (15+ features; local CLI configuration selects 17). They were first tested on disposable PostgreSQL 18.3, then applied to the dedicated remote project `lypfxcohmsosedwptebu`. They create their own private schema and pgcrypto extension. The `private` schema must remain excluded from the Data API's exposed schemas. See `PHASE_2_REMOTE_VERIFICATION.md` for the actual remote results.

For a full local Supabase stack, Docker must be running, then use `npx supabase start` and `npx supabase db reset`. These commands affect the local development stack. The SQL security test bootstrap is for a separate disposable vanilla PostgreSQL database, **not** a hosted project or an existing Supabase auth schema.

## Manually provision the initial account

In Supabase Authentication settings:

1. Enable the email/password provider, disable public sign-ups, and leave anonymous sign-ins disabled. The checked-in `config.toml` disables sign-ups for the local stack; **apply the same settings manually to a hosted project**.
2. In Authentication → Users, create the personal user's email/password account directly. Mark its email confirmed using the dashboard's confirmation option so it can sign in without a public registration flow. Use a strong password. No invitation, organization, profile, or subscription record is needed.
3. Set Auth's Site URL to the app's actual origin. Add only intentionally supported origins to Auth redirect settings if later workflows require them. This phase's password login uses no email-link callback route.
4. Visit `/login` and sign in. For later password recovery, manage the manually provisioned account through Supabase; no public recovery/registration UI is included in this phase.

Users own their rows through `auth.uid()` defaults. There is no global tenant, team, or organization layer. Preferences default to Strict; a future authorized settings service can create/update a preferences row.

## Vercel

Import this existing Next.js project, select Node 22, and set the same two `NEXT_PUBLIC_SUPABASE_*` variables in the intended Production/Preview environments. Redeploy after changes because public environment values are built into browser assets. Set Supabase's Site URL to the deployed HTTPS origin. No other server, queue, paid service, or secret application key is required.

Do not deploy a build configured for `tests/fixtures/auth-ui.mjs`. That fixture is a local-only development process; it is never imported by an application route and refuses production/Vercel execution.

## Tables

| Table                      | Purpose and ownership                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `lead_pages`               | User-owned lead collections; indexed creation-order pagination.                                                                       |
| `imports`                  | File name, target page, status, row counters, timestamps, and immutable import ID; no raw CSV stored.                                 |
| `leads`                    | Business/contact data, exact Maps URL, status, limited extension fields, provenance, archive/retention and future soft-delete fields. |
| `call_attempts`            | Immutable per-attempt outcomes, notes, DB timestamp, and retry/idempotency request ID.                                                |
| `followups`                | Lead, literal date, optional literal time, notes, callback/meeting kind, completion and timestamps.                                   |
| `activity_events`          | Immutable application facts generated by triggers; no names, phone numbers, URLs, or notes. Survives physical lead deletion.          |
| `outreach_suppressions`    | Per-owner HMAC fingerprints for do-not-call checks; survives lead deletion.                                                           |
| `workspace_preferences`    | Future authoritative Strict/Balanced/Autonomous setting, default Strict. No client update grant yet.                                  |
| `operations`               | Future controlled-operation kind, source, status, request ID, scope, permission snapshot, counts and reversal linkage.                |
| `operation_items`          | Bounded before/after snapshots for future undo; tied to a lead and removed with its physical purge.                                   |
| `private.suppression_keys` | Per-user random HMAC key; not exposed to authenticated or anonymous clients.                                                          |

All ten public tables have owner-scoped SELECT RLS. Writable tables have owner-scoped INSERT/UPDATE policies and narrow column grants. Every cross-record relationship carries an owner key; import provenance must also match the page. Unauthenticated users have no application-table access. Ordinary clients cannot forge owner IDs, timestamps, provenance, analytics, suppression history, or operation audit rows, and cannot physically delete records.

## Integrity decisions

**Duplicates:** `leads_owner_maps_url_unique` is a partial unique index on `(owner_id, google_maps_url COLLATE "C")`, including archived and soft-deleted leads. A BEFORE INSERT guard serializes Maps-bearing lead creation per owner and returns no inserted row when the exact URL already exists. This closes the `ON CONFLICT DO UPDATE` loophole: even an upsert cannot overwrite the original. At normal READ COMMITTED isolation the volatile guard sees a preceding committed insert after waiting for the lock; stronger isolation may require a serialization retry, never an overwrite. The unique index is an additional integrity backstop. NULL URLs may repeat. No business name, phone, website, address, or location uniqueness constraint exists. Exact original URL strings are stored without following redirects, trimming, changing case, stripping parameters, or trying to equate short and long links. Maps URLs have a 2,048-byte limit so the raw equality index fits PostgreSQL btree limits. Validation rejects unsupported input rather than altering it. The Phase 3 importer must validate actual Maps links, count zero-row insert results as skipped Maps duplicates, use conflict-do-nothing as a backstop, and must **never** upsert/update the original record. Legitimate note/status editing uses UPDATE by lead ID; the original Maps URL and import reference are immutable. The CSV import workflow is deliberately not exposed yet.

**Attempts:** database time is used; clients cannot supply `occurred_at`. A stable `request_id` must be reused on retries. Insertion atomically emits one fact; the unique source constraint prevents duplicate counting. Changing a lead's status cannot rewrite an attempt. `lead_attempt_summary` exposes total, lifetime failed, consecutive failed, and latest outcome independently. There is no exhausted-lead archive job or full call-workflow RPC in this phase. Phase 4 must use consecutive unsuccessful outcomes and the current state; three total calls alone is never an archive condition.

**Rejection/retention:** setting a lead's status to `not_interested` archives it and sets `purge_after` to 480 hours after its first rejection. Re-saving an already rejected lead does not extend the deadline. An explicit status correction clears that rejection's archive/retention fields, but permanent suppression is retained for manual review. No cleanup scheduler is installed. A future privileged job must re-check rejection state and deadline in its deletion transaction. Physical lead deletion removes detailed attempts, notes, follow-ups and undo snapshots, while anonymized facts and DNC fingerprints remain. Deleting the entire Auth account intentionally removes all of that account's rows.

**Do-not-call:** exact Maps strings and conservative explicit international phone numbers are HMACed with a private per-owner key. Formatting punctuation may be removed from a `+`-prefixed international phone; country codes are never guessed. `is_lead_suppressed()` verifies ownership before comparing identifiers. It does not reject, merge, or delete an import. `assertOutreachAllowed()` is the internal service guard future outreach must use. A record with no Maps URL and no usable international phone cannot be automatically recognized on reimport; future outreach must expose manual review rather than guess identity from its name. Keep the private HMAC keys stable and included in protected DB backups; losing a key makes old fingerprints unusable.

**Statistics:** `daily_activity(date)` uses explicit UTC day boundaries and RLS. Call/outcome counts come from immutable attempt facts; interested prospects and businesses contacted use distinct random subject IDs. Meetings booked count distinct scheduled-meeting facts, rather than double-counting an attempt and its resulting schedule. Rescheduling one task doesn't create another scheduling fact. Detailed FKs are nulled during deletion; random source/subject IDs remain solely for idempotence and distinct counts. Schedule dates/times use `date` + `time without time zone`; there is no timezone automation.

**Undo and AI:** whitelist-only Zod command contracts support scoped import undo, missing-phone cleanup within an import, bounded bulk status changes, notes changes and restore. Extra keys, owner IDs, SQL strings and arbitrary predicates are rejected. `prepareControlledOperation()` is server-only, authorizes the caller and returns a non-executable plan. No AI executor, endpoint, model API or arbitrary SQL path exists. A future executor must load the authoritative permission setting, verify approval where required, resolve all targets with the user's session, revalidate scope, and transactionally write its audit/snapshots. Autonomous mode only changes approval policy; it cannot remove ownership checks or unique constraints. Future reversible removal uses `deleted_at` soft deletion; hard retention purges deliberately cannot be undone. Snapshots expire after a bounded undo window and must be cleaned by Phase 4/6 maintenance; no such job is implemented here.

## Authentication implementation

- `src/proxy.ts`: Next.js 16 Proxy refreshes cookies with `getClaims()`, forwards updates to render requests and responses, preserves refresh cookies on redirects, and sets private/no-store caching.
- `src/lib/auth/session.ts`: request-scoped cached `getUser()` Auth-server verification protects the dashboard layout and every data utility. Cookie contents or `getSession()` alone never authorize data access.
- `src/lib/auth/actions.ts`: validated password login and logout Server Actions; safe internal return paths; no registration action. Supabase provides password-auth rate limits. Next.js Server Actions enforce same-origin protections.
- Browser/server clients use supported `@supabase/ssr` cookie adapters, SameSite=Lax and Secure cookies in production. Cookies remain readable to the SDK's browser client; do not add HttpOnly to an SSR cookie flow that needs browser session refresh.
- Logout revokes this browser's refresh session when reachable, always clears the project's local auth cookies, and unmounts the authenticated mock workspace. Access JWTs have their normal short lifetime; test live project/session revocation after setup.

## Module and file map

New modules: `src/lib/supabase/*`, `src/lib/auth/*`, `src/lib/db/*`, `src/lib/domain/*`, `src/lib/validation/*`, `src/lib/operations/*`, `src/types/database.ts`, `src/proxy.ts`, `src/app/login/page.tsx`, `src/components/auth/*`, `supabase/*`, and `tests/*`.

Modified existing application files: `src/app/layout.tsx` (theme boundary), `src/app/dash/layout.tsx` (authorization + user-keyed mock provider), `src/components/providers.tsx` (explicit mock boundary, same interactions), and `src/components/dashboard/app-shell.tsx` (logout access and mock-data labels). Configuration/documentation: `next.config.ts` (reject secret public-key configuration before compilation), `package.json`, `package-lock.json`, `.gitignore`, `.nvmrc`, `.env.example`, and README. No feature-page layout, global CSS, follow-up component, navigation route, or theme token was redesigned.

`src/types/database.ts` was generated from the linked remote schema after applying both migrations. To regenerate after future schema changes, target the intended project explicitly and review the diff:

```sh
npx supabase@3.0.0 gen types typescript --remote=lypfxcohmsosedwptebu --schema public > src/types/database.ts
```

## Checks and verification limits

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` under Node 22. `tests/unit/ssr-session.test.ts` uses the actual SDK with a fake Auth transport to test cookie persistence, refresh, logout and server rejection. These are SDK contract checks, not live Supabase Auth tests.

On this Windows host, `powershell -File tests/database/run.ps1` creates a fresh database in an owned scratch PostgreSQL cluster on loopback port 55432, applies both migrations, runs the SQL security suite, and deletes the fresh test database. It never uses the existing system database on port 5432. Pass `-PgBin` if PostgreSQL binaries are elsewhere. The bootstrap only emulates the minimal `auth.users`/`auth.uid()` contract and roles; it doesn't emulate Auth or PostgREST. Run DB tests in a disposable environment only.

`npm run test:auth-ui` starts a loopback fake Auth service and a Next development server for browser regression checks. Its fictional credentials are printed by the fixture. Stop it before normal development. No data is written to Supabase, no bypass flag exists in production code, and no fake environment file is saved. With a local app running, `npm run test:routes -- http://127.0.0.1:3000` checks unauthenticated redirects, malformed-cookie rejection, private/no-store responses, and absence of a signup page. The default test port is 3001 when no URL is supplied.

Remote setup and real-account login/reload/logout checks have now been completed; see `PHASE_2_REMOTE_VERIFICATION.md`. SQL RLS checks ran on the remote project with real database roles and transaction-scoped JWT identity claims, and anonymous Data API checks ran over HTTPS. A signed-in user's Data API requests were not independently replayed because their session credentials were kept private. Automatic real-session expiry/refresh was not forced; SDK refresh contract tests cover that path locally. Physical Android hardware was unavailable. Vercel deployment remains a separate step.

References: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and the installed Next.js authentication/Proxy documentation under `node_modules/next/dist/docs/`.
