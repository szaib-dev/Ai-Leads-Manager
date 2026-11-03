# Phase 5 — Realtime dashboard, history and analytics

Implemented November 3, 2026. Remote project: **lypfxcohmsosedwptebu** only. No UI rebuild, AI integration, new dependency, paid service, remote reset or unrelated-project change.

## Delivered behavior

- Dashboard cards show real active leads, confirmed calls, interested leads, unanswered calls, pending follow-ups, meetings and archived leads. Current lead-state cards are explicitly distinguished from historical metrics for the selected period.
- Overview and Activity share compact Today, Yesterday, Last 7 Days, Last 30 Days and custom-range controls, plus lead-page scope and display timezone. Custom ranges support any historical date, with at most 366 days per request. All date/page filters are temporary browser state. No Saved Views exist.
- Default timezone is **Asia/Karachi**. Common zones and validated custom IANA zones are supported. Only the display timezone preference is stored locally; it is not a synchronized lead filter. PostgreSQL converts local calendar boundaries to UTC, including daylight-saving days of 23/25 hours. End boundaries are exclusive. A lightweight local calendar subscription updates Today presets and follow-up categories at day rollover without continuous analytics reads. Follow-up schedule dates/times remain literal values and are never automatically shifted.
- Performance metrics include attempts, answered calls, no answer, voicemails, interested prospects, rejected calls, callbacks, scheduled follow-ups, meetings and distinct businesses contacted. Answer rate = answered attempts / attempts. Interest conversion = interested prospects / distinct businesses contacted. Zero denominators yield zero rates. A lightweight CSS chart uses at most seven aggregate buckets, preserving all selected-period totals.
- Activity is server-paginated at 20 events per page and shows exact date/time/seconds in the selected timezone, business, outcome, notes, immutable attempt number, status transitions, follow-up/archive actions and correction markers. Counts use historical call facts, never a lead's later current status. Corrected attempts remain auditable and are excluded from totals intentionally.

## Realtime architecture

Migration: **`supabase/migrations/202611030006_realtime_analytics.sql`**.

The migration creates the RLS-protected `workspace_sync` table, owner-only SELECT policy and database triggers on the necessary lead/action tables. Every transaction increments one owner checkpoint at most once, even if a CSV import inserts thousands of rows or a call changes status, schedule and activity together. Clients cannot forge checkpoints.

Only `workspace_sync` is added to `supabase_realtime`, with INSERT/UPDATE publication. Business records, notes, phone numbers, Maps URLs and DELETE payloads are not published. The migration refuses an unrelated existing publication configuration instead of silently changing it. This avoids per-row import message floods and the deleted-row authorization limitations described in [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

One authenticated subscription lives in the workspace provider per mounted session. It sets/refreshes the session JWT, filters by owner and relies on database RLS as the security boundary. No per-card channels, Presence or public Broadcast streams are used. The installed SDK waits for Postgres subscription readiness before reporting Live. Unmount/logout removes the channel, Auth listener, timers and network/visibility handlers. Late asynchronous callbacks cannot resurrect a stopped subscription.

Revision notifications are coalesced for 200 ms. Mounted data queries invalidate; inactive desktop/mobile variants do not fetch. Page summaries are read in a single MVCC snapshot with the subscription checkpoint. Local writes acknowledge their checkpoint to suppress duplicate notifications where possible. Global layout revalidation was removed from feature mutations; synchronization does not reload the application or reset sorting/filter inputs. Server-side timestamps and optimistic version checks continue preventing concurrent writes from overwriting each other.

Reconnect, foreground return and online events reconcile the checkpoint to catch missed changes. A visible session checks a tiny checkpoint every two minutes as a fallback for silently missed notifications. Hidden/offline sessions pause reads. The header distinguishes Live, Connecting, Reconnecting, Offline, delayed updates and ended sessions; it provides a reconnect action. Failed reads show retry states rather than invented statistics. Follow-up completion updates the row optimistically and rolls back its presentation on failure; call counts stay authoritative.

## Retention and historical attribution

The activity ledger gains an owner-scoped `page_id` foreign key and a frozen attempt number. Existing surviving details backfill attribution. New attempts get monotonically increasing ordinals, including corrected attempts, so history is not renumbered after undo. The ledger retains page attribution, timestamps, outcomes and anonymous subjects after business/attempt-detail removal. Current business names/notes are joined only while those detail records exist; purged entries show Removed business and no private notes.

**Legacy limit:** facts whose business details had already been permanently deleted before Phase 5 cannot have a missing historical page or original attempt ordinal reconstructed with certainty. They remain in overall totals, with unknown legacy metadata. No names/phone matching or fabricated allocation is performed.

No lead payloads are persisted in localStorage or a client query cache. Query payloads are dropped on invalidation and hidden/offline transitions; in-flight stale responses are ignored. Remote changes invalidate open server-owned selections/drafts so stale or purged record copies are not left open. Reopen the record after such a change. Temporary filter inputs remain independent. Next's existing private/no-store route behavior remains in place.

## Verification actually performed

- **25 unit tests passed**, including selected-timezone calendar presets, safe chart aggregation, coalesced revisions, local-write acknowledgement, reconnect catch-up, hidden-session pause, failed checkpoint reads, late-response cleanup, one channel per session, JWT refresh and listener removal, plus previous security/import/session contracts.
- **85 local SQL/concurrency check groups passed** using a newly created disposable PostgreSQL database. All six migrations were applied. Tests include Karachi midnight/exclusive end boundaries, New York DST, page scopes, conversion math, current-status independence, invalid zones/ranges, zero rates, frozen ordinals after correction, accurate notes, RLS checkpoints, anonymous retained page statistics, original Maps integrity and concurrent call confirmation safeguards.
- **Remote analytics SQL suite passed**, including timezone/DST boundaries and retained statistics, in a transaction ending with ROLLBACK. It did not alter the personal account or retain fixtures.
- **Live Realtime SDK verification passed with two independent authenticated sessions for one temporary account**, plus a different authenticated account attempting an unfiltered subscription. Verified call notifications and counts, status updates, follow-up scheduling/rescheduling/completion, one notification for an entire CSV batch, archive/removal, recent activity/notes/attempt numbers, token refresh, missed-change recovery after disconnect, idempotent retries and absence of cross-owner events. The script explicitly waits for actual Realtime notifications; HTTPS reads verify the resulting state. Temporary users and all their records were removed and every client channel was closed.
- **Real anonymous HTTPS checks passed:** thirteen public tables unreadable without authentication, seventeen lead/workflow/analytics RPCs not executable anonymously, private schema inaccessible, public registration still disabled.
- **Lint, strict TypeScript and production build passed.** The final production HTTP smoke test also passed all seven protected-route patterns, malformed-session rejection, real login-form rendering, signup absence and private/no-store responses. Its temporary server was stopped after testing.
- CLI access initially returned 403; the user restored the owning login. Migration 006 was previewed and applied only to the dedicated project. Remote database types were regenerated, and the migration list confirmed all six versions match.
- Final remote metadata audit confirmed thirteen RLS tables, only `workspace_sync` published, DELETE publication disabled, and zero remaining temporary test accounts/pages.

The live SDK test is **not two-browser UI testing**. Browser automation was checked and remains disabled in Work settings. Actual browser sessions, rendered Light/Dark views, Android device interactions and viewport inspection at 360/390/412/768/1024/1440 widths were therefore not performed. Existing responsive classes, touch targets, safe-area navigation and temporary mobile/desktop lead filters are preserved, but no visual-device pass is claimed. No actual phone call or Vercel deployment was performed.

## Files and setup

New modules: `src/lib/realtime` (controller, Supabase transport, expiring selections), `src/lib/analytics` (contracts, validated server actions, date filters), `src/components/analytics` (controls/metrics/styles), and `src/components/shared/sync-indicator.tsx`.

Existing provider, query hooks, lead/history dialogs, Overview, Activity and Follow-ups were connected to synchronization. `src/types/database.ts` was regenerated. New tests live in `tests/database/analytics.sql`, `tests/database/remote-analytics.sql`, `tests/unit/realtime-analytics.test.ts` and `tests/realtime-remote.mjs`.

No new application environment variables or private application credentials are needed. Use Node 22+ and the existing project URL/publishable key. The live verification script provisions temporary confirmed accounts with an administrative credential retrieved from the signed-in CLI into process memory only; it does not save/print that credential or expose it to application code, and sends no invitation/confirmation emails. Its cleanup runs in `finally`. Administrative CLI access is needed only to repeat that fixture test, not to run the dashboard.

```sh
npm test
npm run lint
npm run typecheck
npm run build
node --env-file=.env.local tests/remote-public.mjs
node tests/production-smoke.mjs
node --env-file=.env.local --import tsx tests/realtime-remote.mjs
```

```powershell
powershell -ExecutionPolicy Bypass -File tests/database/run.ps1
npx supabase@3.0.0 migration list --remote=lypfxcohmsosedwptebu
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-analytics.sql --yes
```

Review remote fixture scripts before running. SQL fixtures roll back; SDK test fixtures are explicitly deleted. Environment files, scratch output and any temporary fixture-account IDs are ignored by source control. AI remains deferred.
