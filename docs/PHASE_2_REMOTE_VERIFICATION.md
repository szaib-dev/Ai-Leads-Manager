# Phase 2 remote setup verification

Project: **Ai-Dahboard-Leads-Management**, reference `lypfxcohmsosedwptebu`.

Only this explicitly authorized Supabase project was linked or modified. No remote database reset, migration repair, seed execution, unrelated-project modification, or Phase 3 UI/data integration was performed.

## Migration and configuration results

- Supabase CLI 3.0.0 linked the dedicated project after the user signed in to the owning account.
- Read-only preflight found no application tables/views in `public` or `private` and no remote application migration history.
- `db push --remote=lypfxcohmsosedwptebu --dry-run --skip-vault` listed exactly the two Phase 2 migrations, with no seeds or custom roles.
- Applied `202611030001_foundation.sql` and `202611030002_integrity_and_analytics.sql`. Remote migration history subsequently matched both local versions.
- `.env.local` was initially absent from this workspace despite the user having configured an environment file elsewhere. Created the ignored `.env.local` with the correct project URL and its publishable key obtained through the CLI. No secret/service-role key was fetched or written. No credential values were printed. `.env*` is ignored and only `.env.example` is excepted. The folder currently has no Git repository, so tracked-file status cannot be checked; retain these ignore rules when initializing source control.
- Restarted Next development under Node 22 at `http://127.0.0.1:3000`, loading the real project configuration. Use that port for the real browser session checks.
- Applied a narrowly declared Auth settings configuration: public registration disabled, anonymous sign-in disabled, email/password enabled, Site URL `http://127.0.0.1:3000`. The actual remote changes were public registration and Site URL; email/anonymous settings already matched. The CLI left ten undeclared remote properties unchanged; no secrets were sent. Follow-up config diff reported zero declared updates.
- HTTPS Auth settings independently confirmed signup disabled, email login enabled, and anonymous login disabled.
- Generated `src/types/database.ts` from this project's actual public schema. Feature-screen/mock types remain separate.
- With the generated remote types and real project environment, strict TypeScript, lint, all ten unit/SDK tests, and the production build passed.

## Real account and sessions

The user provisioned the personal account directly in Supabase Auth with Auto Confirm enabled; no personal password was provided to the agent.

- User confirmed real password login reached the dashboard.
- Read-only Auth database query confirmed one confirmed account, a real sign-in timestamp, and one active session.
- User confirmed dashboard reload, sign-out, attempted `/dash` visit redirecting to login, and successful sign-in again.
- No user password, access token, refresh token, or session cookie was read or printed by the agent.
- Independent HTTP tests without a session passed for all seven dashboard route types: redirects to login, malformed-cookie rejection, private/no-store headers, login availability, and no signup route.

The real browser sequence above is **user-confirmed**, supported by remote Auth metadata. Agent browser inspection was unavailable because local browser use was disabled in Work settings. Live forced session expiry/token refresh and replay of the personal user's authenticated Data API requests were not performed. SDK contract tests for refresh/persistence/logout were already executed locally in Phase 2.

## Real remote security tests

`tests/database/remote-security.sql` executed against the dedicated project and passed **17 checks**. All fixture writes occurred within one transaction, ended with ROLLBACK, and used an existing confirmed account as the ownership anchor. A second authenticated identity was simulated through database JWT claims; no extra Auth account was created.

Checks covered:

- RLS enabled on all ten application tables.
- Authenticated owner create/read access; ownership fields protected.
- Cross-owner read/update blocked and cross-owner page attachment rejected.
- Anonymous role denied lead/analytics reads.
- Exact Maps duplicate upsert skipped across pages without overwriting original notes/status.
- Same-name/same-phone leads and NULL Maps URLs permitted.
- Attempt timestamps server-owned, history immutable, retry request IDs preventing duplicate facts.
- Follow-up literal date/time preserved.
- Not Interested archive and twenty-day deadline populated; phone suppression flags outreach without deleting a lead.
- Direct physical deletion and fabricated operation history denied to authenticated clients.
- Privileged fixture purge retained daily counts while removing attempt detail.
- Analytics and suppression lookup remain owner-isolated.

`tests/remote-public.mjs` additionally passed **real HTTPS Data API/Auth checks using only the publishable key**: anonymous SELECT denied for each of the ten tables; private suppression-key schema inaccessible; Auth settings correct. No signup request or unsolicited email was sent.

Read-only post-test inspection confirmed zero application pages, leads, activity facts, and suppression records from the rolled-back fixtures. This app's dashboard still displays clearly labeled mock records and statistics; those are not remote database records.

## Readiness and remaining limits

Phase 2 remote schema, Auth configuration, personal-account sign-in, logout/protection, and owner-isolation checks are complete enough to begin Phase 3. Phase 3 has **not** started.

The existing UI is unchanged. Real-session expiry/refresh under long-lived use, authenticated PostgREST calls from the personal browser, and eventual Vercel deployment remain explicit verification limits. Before deployment, set Node 22 and the two public Supabase values on Vercel, rebuild, and change the Auth Site URL to the actual deployed HTTPS origin. No deployment is claimed here.

**Final administrative-access caveat:** after migrations, remote SQL tests, account/session metadata inspection and type generation had succeeded, a final read-only metadata recheck first failed with a transport error and then returned Management API HTTP 403 (insufficient privileges). No new database changes were attempted. The subsequent real HTTPS public Auth/Data API checks and rebuilt production route checks still passed. CLI/Management API access must be restored with the owning account before any further remote schema work. Earlier successful SQL results remain the actual executed verification; the final repeat was not successful.

Re-run non-mutating public checks locally with Node 22:

```sh
node --env-file=.env.local tests/remote-public.mjs
node tests/route-protection.mjs http://127.0.0.1:3000
```

The remote SQL suite is intentionally transaction-scoped and should only be run against the explicitly selected project after reviewing the file:

```sh
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-security.sql --yes
```
