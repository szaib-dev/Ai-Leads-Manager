# Workspace redesign — 13 November 2026

- Collection lead views start with New selected. Search, Attempts, Archive and Callbacks retain their own defaults. Explicit filters and the last collection location still recover within the browser session; a versioned view key resets the previous initial All filter once.
- Lead-page cards and Activity metrics have drag handles using dnd-kit pointer and keyboard sensors. Space picks up/drops, arrows move, and Escape cancels. Only identifiers are stored, scoped to the signed-in owner and collection. Order persists in this browser, including reloads; it is not a server-synchronized preference. Reordering a filtered subset preserves the hidden cards' slots.
- Activity replaces the repetitive summary table with a call overview, outcome bars and reorderable metrics. The complete definitions and historical metrics remain in an expandable section. Filters, timezone and pagination retain their existing semantics.
- Follow-ups uses summary cards, date groups and responsive reminder cards. Status opens a dedicated editor supporting the existing statuses and scheduled dates. Not Interested requires confirmation of the existing archive, permanent suppression and 20-day removal behavior. Status editing does not create a call attempt.
- A pending reminder can be removed through a visible trash button or its actions menu. This uses the existing cancel workflow and returns the lead to Interested. Delete lead is a separate confirmed action, available for pending and completed entries. Completed reminders remain historical rather than being silently deleted by the pending-reminder control.
- New chat no longer runs an empty-ID conversation query. Prose, generated operation cards and the composer share a bounded reading column. Tables scroll within their cards, operation headings are clearer, and a completed zero-record operation no longer offers an ineffective undo.
- The header search slash hint is removed.

## Validation

`tests/workspace-redesign-ui.mjs` runs against an isolated local HTTP fixture and the actual Next.js app in Edge. It checks New-only defaults, saved keyboard reordering for pages and metrics, status editing, reminder removal, lead deletion, new-chat error handling, generated-card alignment, zero-record undo, and 390px light/dark page overflow. The fixture includes a generated results table and fictional follow-up cards. Screenshots and the report are under ignored `.local-test-output/redesign-*`.

These browser checks verify UI behavior against a fixture; they do not claim fresh production database authorization, provider output or cross-device latency measurements. Existing database workflows and their ownership/version guards are reused without schema changes.
