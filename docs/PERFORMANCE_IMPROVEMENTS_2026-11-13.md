# Performance implementation — 13 November 2026

The initial findings and measured baseline remain in `PERFORMANCE_CASE_STUDY_2026-11-13.md`. This follow-up records the changes shipped after that audit; it does not replace baseline numbers with estimates.

## Deployed changes

- Vercel functions now execute in Frankfurt (`fra1`), beside the existing Supabase database. Production inspection confirms the runtime region, not merely a configuration change.
- Routine country, workspace counts, workflow, analytics and call-history reads use the authenticated browser Supabase client. This removes their additional Next.js Server Action hop and action queue. SQL authorization and ownership remain authoritative; privileged server entry points retain verified authentication.
- Preferences load only when settings opens. Settings and CSV import dialogs load on demand. Preference queries are excluded from general lead-change invalidation.
- Header search uses a prefetching Next.js Link.
- Selection preview, delete and undo use authenticated direct database calls. The current list receives an immediate local deletion update; failures restore the local records. SQL still controls ownership, expected versions, idempotency, history and undo.
- Migration `202611130032` adds committed private lead metadata events. Mounted lead lists can apply status/archive/deletion metadata without waiting for another list read. Events contain no business names, phone numbers or notes. Owner-scoped revision reconciliation remains the recovery path, including missed events and updates that add rows to a list.
- Private event fanout is capped at 20 rows per transaction. Larger operations reconcile through existing revisions. Both permissive owner authorization and a restrictive topic-namespace policy protect against unrelated permissive policies widening access.

The private transport is controlled by `NEXT_PUBLIC_PRIVATE_PATCHES`. It defaults off for environments without the migration. The primary production app has the migration applied and the flag enabled. The existing revision transport remains active if the optional channel fails. Turning the flag off and redeploying provides a transport rollback without reverting database data.

## Verification

- TypeScript and ESLint pass.
- All 72 unit tests pass, including preserving newer lead versions when an older patch arrives.
- Full scratch PostgreSQL migration, security, workflow, import, analytics, assistant and integration regression suite passes.
- Database checks cover metadata-only messages, bounded fanout, owner access and rejection of another owner's topic. Concurrency checks cover duplicate imports and stale/retried call confirmations.
- Production deployment `dpl_7MLyzg21p8YuMQQUQebZ4kr8nVkR` is Ready and serves the primary production alias. Function inspection reports `fra1`.

Migration application and production policy inspection succeeded following the refreshed CLI login. Subsequent read-only SQL and administrative API-key requests returned HTTP 403. The administrative endpoint prevents provisioning the disposable account needed for the new live test; no real customer records were used instead.

The new live test is prepared to block the receiving browser's normal lead-list request, prove the private event updates status independently, check that events omit private details, and attempt cross-owner channel access. Its websocket decoder now supports both object and array Phoenix frames. The earlier readiness failure and the subsequent credential failures are **not** a passing private-channel test.

Run the combined live suite with Node 22+ and the project's public Supabase environment loaded:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/performance-verification-suite.mjs
```

It keeps the administrative credential only in process memory and cleans up synthetic accounts in fixture finally blocks. A fresh before/after timing report, real Supabase websocket authorization test and live delete/undo verification remain outstanding. Existing baseline measurements are not evidence of the new release's performance.

## Interpretation and next measurements

The baseline median cross-browser status visibility was about 1,198ms, including roughly 489ms between receiving the revision and seeing the refreshed row. The private patch path is intended to remove that reread from already displayed records. This is a mechanism change, not a measured promise of a particular saving. Initial navigation also includes authentication, network and server behavior; region alignment cannot eliminate all of those costs.

The next completed trace should compare write response, private-event receipt, revision receipt, visible row, client navigation and deletion separately. Collect repeated samples before reporting a p95. Production SQL execution plans, lock waits and 10k/50k-record scale behavior remain unmeasured. No additional general state library is required for these changes: the existing TanStack Query and Supabase clients supply caching, cancellation and realtime delivery.
