# Critical import, chat, and callback verification

Verified November 5, 2026 against hosted Supabase project `lypfxcohmsosedwptebu` and a local production Next.js build, using Node 24.

## Root causes and changes

- Reproduced the actual `website_leads_export.csv` failure: mapping `outreach_status` produced `status: Invalid option` on rows 2–81 because every value was `Not Contacted`. This now maps explicitly to `new`; unknown statuses, invalid URLs, malformed rows, and field limits still fail validation. Added deterministic export-header mappings for business phone, official website, outreach status, and editable notes.
- Restricted Maps uniqueness, insert protection, and preview classification to undeleted leads on undeleted pages. Historical calling facts and deletion markers remain. Page deletion never creates a suppression. Actual rejection suppression remains enforced independently. Preview lists row numbers, reasons, active duplicates, repeated Maps URLs within the file, and importable historical matches.
- The hosted database already had `ai_chat_messages.artifact` at inspection. Added an idempotent forward schema repair and PostgREST cache reload so deployments with the reported mismatch recover without replacing conversations. Schema errors are translated into a retry message, including historical message errors.
- Added `/dash/callbacks`, the “They'll Call Me Back” outcome, optional promised date/time, notes, in-app reminders, Waiting/Overdue/Completed states, and Called Back / Reschedule / Follow Up Myself / Not Interested actions. Changes use owner-scoped RPCs, lead version checks, workflow history/undo, and the existing realtime revision signal. Overdue is computed without creating attempts. Reminders appear in the callback queue; no OS notification or email delivery is configured.
- Centered ordinary chat content at 880px and retained wider generated results and the pinned composer. Attachment cards appear immediately; processing does not block typing. Filename and file survive failures, with retry, replacement, and removal controls.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test` (54 passing), and `npm run build`: passed under Node 24.
- Full PostgreSQL migration, authorization, imports, workflow, retention, analytics, AI, chat, and concurrent-write suite: passed. Focused callback/import suite rerun after callback consistency refinements: passed.
- Hosted transactional SQL regression: 80 exact-Maps records imported; page deleted; same 80 imported again; 80 active duplicates subsequently skipped. Historical call facts retained, deletion did not create do-not-call entries. Tested optional dates, overdue state, reminders/reschedule, completion, undo, follow-up conversion, and actual rejection protection.
- Production browser + real Supabase: actual 80-lead CSV imported through the normal dialog, page deleted, identical CSV imported again: **80 accepted / 0 invalid / 0 skipped** both times. Used a disposable account; original user pages and conversations were untouched.
- Browser chat checks: create, open, switch, refresh, and render saved artifact conversations; callback completion creates no extra attempt; attachment processing permits typing while Send is gated.
- Existing hosted chat-tools suite: streaming, evidence, generative results, selection/delete/undo, chat CSV approval/destination/history, automatic imports, missing-provider fallback, chat deletion preserving leads, mobile themes and composer: passed.
- Responsive browser coverage: 360, 390, 768, and 1440 CSS pixels. Physical handset testing was not available.

Forward migrations `202611050014`–`202611050016` were applied successfully to hosted Supabase. Browser screenshots and machine-readable results are in ignored `.local-test-output/`. Verification accounts and their imported records are removed after tests.

Reproduce the browser test with Node 24, configured `.env.local`, Supabase CLI access, a production build, and `node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/critical-browser-remote.mjs`. Set `REIMPORT_CSV` to override the local export path. Database regression: `powershell -NoProfile -File tests/database/run.ps1`.
