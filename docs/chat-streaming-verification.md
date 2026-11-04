# Chat streaming, presentation and confirmation verification

Verified November 5, 2026 with a production Next.js build, hosted Supabase and the real AI provider.

- Progress/status rows now share the 880px centered message boundary and disappear when text begins streaming.
- File conversations use genuine provider streaming for the user-facing reply. Intermediate deltas are delivered before completion, with existing partial-response preservation and usage accounting. File planning remains a separate validated step before any database action.
- Replies use natural paragraphs. Shared generation instructions and rendering remove em dashes, large headings, bold labels and indented list hierarchies, including restored history.
- `Not called`, `Not_called` and `Uncalled` map explicitly to New. Added deterministic Call status and Published business phone mappings. Unknown statuses still fail with readable errors. When no rows are valid the assistant no longer asks to import nonexistent valid rows.
- Import proposals are saved on the owned conversation file. Casual confirmations such as “hmm yeah”, “yup that would be better”, “okay” and “sure” accept the pending proposal without losing its destination, name or mappings. Completed imports clear the proposal; retries recover the original import. Analysis clears pending write intent, and rejection/invalid-row approvals remain explicit.

Validation passed: lint, TypeScript, 60 unit tests, 6 provider/streaming tests, focused PostgreSQL migration/workflow/RLS tests and the production build. Migration `202611050018_pending_file_imports.sql` was applied to hosted Supabase.

The hosted browser/API test used the actual `30_business_prospects.csv` from the reported issue. Its explanation arrived in 412 deltas before completion, with no em dashes or heading/bold syntax. The same file then imported all 30 records as New, without invalid rows. A rendered progress row matched the message column's left edge. Mobile 390px and desktop 1440px layouts had no page overflow.

Separate hosted scenarios saved proposals containing two valid rows and one invalid website. After refresh, “hmm yeah” and “yup that would be better” each imported exactly the two valid rows, retained the invalid-row count, and cleared the pending proposal. No real user pages or conversations were edited; test accounts were removed.

Reproduce after a production build with `node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/streaming-confirmation-browser-remote.mjs`. Screenshots and machine-readable results are in ignored `.local-test-output/chat-polish/`.
