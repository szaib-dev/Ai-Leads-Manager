# WhatsApp and realtime verification — 2026-11-05

Implemented locally; not deployed or live-database verified.

## Findings

- Workspace realtime publishes an owner-filtered, RLS-protected workspace_sync revision, rather than business records. Leads (including soft deletion), imports, attempts and followups already signal this table through database triggers. Auth token updates, reconnect checkpoint reads and visibility handling already exist.
- Provider acknowledged a workspace_state snapshot after independently invalidating mounted lead queries. A revision occurring between those reads could be acknowledged without the mounted query seeing it. Removed that acknowledgement; initial server checkpoint acknowledgement remains.
- Continuous changes could reset the debounce indefinitely. Delivery now uses a bounded batch window.
- Failed count refreshes consumed a revision. Asynchronous refresh failure now resets the checkpoint and reports stale so reconciliation retries.
- Fallback checkpoint interval reduced from 120 seconds to 15 seconds. Normal websocket delivery is still immediate plus the 200ms batching window. These are configured intervals, not measured production latency.
- Lead edits and attempts already had optimistic notifications, but list membership did not change. Lists now hide optimistic deletions and records routed elsewhere while retaining the underlying row for rollback. Deletion and archive/restore now publish optimistic changes. Successful saves no longer wait for count refreshes.
- Existing mutations serialize per owner using an advisory lock and perform authenticated server actions plus sequential record/count reads. No production timings or query plans were available, so no claim is made about the dominant database/network bottleneck. This change preserves those concurrency guarantees.

## WhatsApp

Apply migrations 202611050019 and 202611050020 in order (separate enum migration). The conversation RPC uses existing ownership checks, optimistic concurrency, routing and workflow history snapshots. No call_attempt is inserted. Notes, four conversation statuses and literal last-interaction dates are manual. Closed remains in the conversation list; Move to Archive explicitly archives. Lead details support existing followup scheduling and other status changes. Opening WhatsApp does not record an interaction. Phone numbers must include country code.

The new partial index supports the bounded 15-row WhatsApp queue. Publication repair restores missing workspace_sync membership without removing unrelated tables.

## Completed checks

- Node 24.22.1: 61 unit tests passed, including failed-refresh retry and existing reconnect, auth refresh, hidden-tab, coalescing and cleanup tests.
- ESLint passed.
- TypeScript passed.
- Production build passed with /dash/whatsapp.
- Default shell Node 20 is below package.json >=22 and caused three initial SSR/WebSocket tests to fail; all passed under Node 24.

## Blocked live checks

Supabase db push --linked --dry-run returned HTTP 403: account lacks privileges for the database login-role endpoint. No migrations were applied. Publication state, database plans, actual persisted WhatsApp transitions, two authenticated browser sessions, mobile interaction performance and end-to-end failure rollback remain unverified. No before/after response times are claimed.

After access is restored: apply migrations; inspect publication INSERT/UPDATE configuration and owner SELECT policy; run authenticated browser contexts against the same test account, exercise import/status/attempt/followup/delete and verify both records and counts, then disconnect/reconnect the second context and verify reconciliation. Throttle and abort mutation requests to verify rollback, preserve filters and pagination, measure click-to-render, server confirmation and second-context visibility separately, and verify attempts remain unchanged by WhatsApp actions. Repeat at a mobile viewport.
