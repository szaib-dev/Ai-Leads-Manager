# Conversational files and standard callback leads

Verified November 5, 2026. This supersedes the previous chat import form and callback card interface.

## Behavior

- Selecting a CSV shows a compact attachment beside the composer. Typing remains available. Sending only the file gets an immediate acknowledgement and asks what the user wants to do; upload never imports records, including in Autonomous mode.
- The AI can explain the file and discuss its quality from full-file column counts plus bounded examples. Analysis does not create a page. File contents are untrusted data and cannot authorize an action.
- An explicit new-page instruction imports into a new page and can let the assistant choose the name. An existing-page instruction appends to that owned page. Ambiguous destinations prompt a conversational question; a short answer such as “Pakistan” completes the intended append.
- Attached files remain associated with their conversation after refresh. Import request IDs make retries recover the original result instead of creating another page. Original Maps deduplication, row validation, rejection protection, history, and undo remain.
- The chat mapping form, destination selector, and confirmation wizard are removed. Import success is stated naturally with a compact receipt containing page/undo actions.
- Awaiting Callbacks now renders the shared lead table/mobile cards, with normal search, filtering, details, notes, attempt history and status editing. There are no special Called Back/Reschedule/Follow Up Myself action cards. Existing callback data and history remain stored. Changing status to Not Interested uses the ordinary rejection confirmation and do-not-call protection, without creating another call attempt.

## Verification

- Lint, TypeScript, all 57 unit tests, and production build passed with Node 24.
- Full scratch PostgreSQL suite, including migrations, RLS, import/retention/workflow/AI regressions and concurrent imports/call confirmations, passed.
- Migration `202611050017_conversational_files.sql` applied to hosted Supabase. Hosted transaction verified upload causes no import, conversation binding and owner isolation, the regular callback list, and normal status editing to rejection.
- Real Supabase + production browser: attachment-only question; explanation without writes; ambiguous append question; “Pakistan” follow-up appends three records; refresh; explicit new-page creation with an assistant-chosen name. An instruction embedded inside CSV data did not create a page. Verified regular callback editing to Not Interested and unchanged call count.
- Real provider regression suite passed: streaming/evidence/results, import deduplication and undo/history, chat deletion preserving leads, Autonomous upload requiring intent, missing-provider file preservation, selection deletion/undo, and mobile theme/composer checks.
- Actual 80-lead export still passed the normal CSV import, page deletion and identical reimport scenario: 80 accepted, zero invalid, zero skipped, both times.
- Loaded mobile and desktop layouts checked at 360/390/768/1440 CSS pixels across the critical suite, and 390/768/1440 for the new conversational flow. No page overflow. Physical handset testing was not performed.

Run `npm run test:file-conversation-live` after a production build with the configured Supabase and AI environment. The test uses a disposable account and removes it afterwards. New SQL coverage is in `tests/database/conversational-files.sql`; machine-readable results and screenshots are in ignored `.local-test-output/file-conversation/`.
