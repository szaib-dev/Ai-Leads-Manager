# Phase 4 — calling workflows and verification

> Historical Phase 4 report. [Phase 5](PHASE_5_IMPLEMENTATION.md) adds Realtime synchronization and timezone-aware analytics. Its report describes current dashboard statistics and verification.

Implemented November 3, 2026 against the dedicated Supabase project **lypfxcohmsosedwptebu**. Existing layouts, theme tokens, lead tables/cards, Follow-ups design and mobile navigation are preserved. No AI integration or new backend service was added.

## Behavior

- The `+` button opens the outcome dialog. Only **Confirm attempt** writes a record. Outcomes: No Answer, Voicemail, Interested, Not Interested, Callback Requested, and the existing Meeting Booked option. Notes are optional. Database `clock_timestamp()` supplies the actual timestamp; the client cannot supply one. Request UUIDs make retries idempotent, and stale confirmations are rejected.
- The calling queue contains New and Interested leads. No Answer/Voicemail move exclusively to Attempts, with total attempts, consecutive failures, last attempt time, last notes and retry access. Pending callbacks/meetings move to Follow-ups. Archived leads appear in Archive. Completed follow-up tasks remain historical entries, rather than a second active calling workflow.
- Three **consecutive** unsuccessful outcomes archive as `attempts_exhausted`. A connected outcome resets that streak. Total attempts and original outcomes are preserved. Exhausted leads have no purge deadline. Restoring an exhausted lead does not erase its history or failure streak; another failed call may exhaust it again.
- Callbacks require a date and optionally a time. Follow-ups can be scheduled through an outcome or the lead status editor, rescheduled, have notes edited, completed without fabricating a call, or completed by recording an outcome. One pending task per lead prevents duplicate active schedules. Dates and times are stored exactly as entered. Daily call analytics explicitly use UTC; attempt history formats timestamps for the viewer.
- Not Interested immediately archives the lead, creates suppression fingerprints and sets a deadline exactly 480 hours later. Call buttons and phone links flag known suppression matches. A fresh server check runs when calling; the database also blocks attempts against archived/suppressed records. Opening Call never records an attempt.
- Phone comparison conservatively removes spaces, parentheses, periods and hyphens, supporting local and international digit strings. It does not infer country codes or fuzzy identity. Matching phones never delete/merge/skip an import. **Exact Maps URL equality remains the only automatic duplicate condition**, preserving originals across pages.

## Corrections and history

Lead details show paginated attempt history, original outcomes/notes, corrected markers and recent workflow changes. **Correct latest change** requires confirmation. Corrections proceed latest-first per lead; later changes must be reversed before an older action can be corrected. To change an accidental outcome, correct it and record the intended result.

Original attempts are never rewritten: correction sets a protected void marker, excludes that attempt from totals, restores the prior lead status/contact time/notes/archive state and affected schedule, and appends a compensating event. Timestamp and schedule baselines prevent undo from overwriting later work. Repeated undo is idempotent.

Correcting an accidental rejection removes only that rejection's suppression source. Other independent rejections of the same number remain blocked, including after their business details have been purged. Ordinary status editing does not silently clear permanent do-not-call protection. Legacy suppressions with no known correction source remain conservative permanent blocks.

Manual archive and deletion are confirmed. CSV imports containing Not Interested statuses require an additional retention confirmation. Imported callback/meeting statuses without dates get a task using today's UTC date, clearly marked **confirm the date**; the importer warns about this before submission. Untouched import-created tasks can be safely undone with their import; later calling/scheduling changes block unsafe import undo.

## Database and security

Migrations:

- `202611030004_calling_workflows.sql`: protected void markers, `workflow_changes`, suppression-source tracking, event kinds, routing, attempt/follow-up/correction RPCs, paginated read models, and the retention function.
- `202611030005_rejected_retention.sql`: enables supported Supabase Cron and registers `folio-rejected-retention` at `17 * * * *`.

Workflow changes and their private snapshots belong to the lead and cascade away when that lead is permanently purged. The activity ledger remains PII-free: opaque subjects, timestamps, event kinds and outcomes. Business names/notes are joined only while details exist; after purge the interface displays Removed business. One call creates one `call_attempt` fact, while associated status/archive/follow-up events are separate audit facts and never increase call totals. Corrected facts retain their void marker even after detail deletion.

All twelve public application tables have RLS. New workflow records allow owner-only reads and no direct client writes. Direct attempt inserts, follow-up writes and status updates were revoked from authenticated clients; validated owner-derived RPCs now control these mutations. Definer functions use an empty search path, explicit ownership checks and per-owner transaction locking. No service-role key or database password was added to the application. Database types were regenerated from the real project.

The private retention function processes up to 500 due rejected leads per hourly run, deleting business details, attempt notes, schedules and undo snapshots through constrained relationships. Anonymous call facts and minimal HMAC suppression records survive. It expressly excludes Exhausted/manual archives. App clients cannot execute cleanup or read the private suppression-source/key schema. Native scratch PostgreSQL without `pg_cron` tests the purge function but skips job installation; the remote job was separately confirmed active. See [Supabase Cron](https://supabase.com/docs/guides/cron) for the database scheduler used here.

## Verification report

- **19 unit tests:** CSV/security/session contracts, safe phone targets and literal follow-up categories.
- **80 local SQL/concurrency check groups:** fresh migrations, Phase 2/3 regression checks before grant tightening, full Phase 4 routing/corrections/retention checks, exact Maps concurrency, concurrent retries producing exactly one attempt/fact, and concurrent distinct confirmations rejecting stale writers.
- **Both real remote Phase 4 suites passed**, using the existing confirmed account's ownership context and ending with ROLLBACK. Tested attempts, status routing, follow-ups, corrections, independent suppression sources, stale/cross-owner denial, retention and durable statistics.
- **Real HTTPS anonymous checks passed:** signup disabled, anonymous Auth disabled, twelve tables unreadable and fourteen lead/workflow RPCs not executable without authentication. Private schema inaccessible.
- **Protected-route HTTP checks passed in development and the current production build:** seven dashboard route patterns, malformed-session rejection, real login-form availability, signup absence and private/no-store responses. The isolated production smoke server was stopped after testing.
- **Lint, strict TypeScript and production build passed**, including all existing routes.
- Remote read-only verification confirmed twelve RLS tables, active hourly retention job, and no remaining Phase 4 fixture pages. Migrations 004/005 were applied only to the explicitly authorized project; no database reset or other-project modification occurred.

Browser automation was checked and remains disabled in Work settings. Consequently, authenticated browser clicking, real file-picker interaction, rendered light/dark inspection and viewport checks at 360/390/412/768/1024/1440 widths **were not performed**. Responsive classes, safe-area navigation and independent temporary desktop/mobile lead filters remain in place, but code inspection is not a substitute for device QA. No actual phone call or Vercel deployment was performed. The hourly job is configured and the actual purge function was executed in rollback tests; a naturally scheduled production run is not claimed unless separately observed.

## Setup and repeatable checks

No new environment variables are required. Keep the existing `.env.local` URL/publishable key private from source control; use Node 22+. There is no application administrative secret. All five migrations must be applied when setting up another environment. Account provisioning and Vercel Auth URLs remain as documented in Phase 2.

```sh
npm test
npm run lint
npm run typecheck
npm run build
node --env-file=.env.local tests/remote-public.mjs
node tests/route-protection.mjs http://127.0.0.1:3000
node tests/production-smoke.mjs
```

```powershell
powershell -ExecutionPolicy Bypass -File tests/database/run.ps1
npx supabase@3.0.0 migration list --remote=lypfxcohmsosedwptebu
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-workflows.sql --yes
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-workflow-integrity.sql --yes
```

Review remote scripts before use; fixture writes are transaction-scoped and rolled back. `remote-security.sql` is the historical Phase 2 suite and expects its original direct-write grants; use the Phase 4 suites/public checks for the current stricter schema. Runtime fixtures, generated scratch output and environment files remain ignored by source control.
