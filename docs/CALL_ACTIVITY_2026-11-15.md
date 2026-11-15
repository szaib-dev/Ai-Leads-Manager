# Confirmed call activity

Call outcome confirmation now covers No Answer, Voicemail, Interested, Not Interested, Follow-up, Meeting Booked, Awaiting Callback and Continue on WhatsApp. Explicit status saves from lead details and follow-ups record a call outcome too. Name/phone/note edits, imports, AI maintenance, reminder removal, conversation metadata and resetting to New do not invent call attempts.

Migration 202611150034 adds the WhatsApp call-outcome value and `record_call_activity`. Metadata edits and the attempt share one transaction, version check, idempotency key and undo snapshot. Existing call triggers stamp the occurrence time and update historical facts, total attempts, failed attempts and last-contact time. The original recorded date is independent of a future callback/meeting date. No historical status-only changes are backfilled as calls; their original audit events remain available.

Attempts opens an All attempts history for the last 30 days, with period/page/timezone filters and the original timestamps. Retry queue preserves the unsuccessful-lead workflow. Interested is green and Not Interested red in badges, status menus and call outcome choices. Toasts display at the top centre for 1,000ms, restarting for each new notice, including identical messages.

The browser cannot inspect whether a phone dialer connected. Selecting and confirming the outcome records the attempt; merely opening a dialer or switching an unconfirmed choice does not add duplicate calls.

## Verification

- PostgreSQL regression verifies all eight dated outcomes, counters, same-request retry, conflicting retry rejection, atomic metadata rollback, future scheduling, owner isolation and undo. The migration is tested in one transaction, matching the SQL Editor deployment file.
- `tests/call-activity-ui.mjs` exercises actual Next.js UI with isolated synthetic transport fixtures: all eight confirmations, manual status edits, metadata-only edits, All attempts dates, retry queue, red/green options, top-centred one-second toast timing and light/dark mobile layout. It does not claim production latency measurements.
- `docs/DEPLOY_CALL_ACTIVITY.sql` is the transaction-wrapped SQL Editor installation. Install it before publishing the app code that calls the new function.
