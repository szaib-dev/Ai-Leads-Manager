# Phase 3 — implementation and verification

> Historical Phase 3 report. [Phase 4](PHASE_4_IMPLEMENTATION.md) now connects calling, follow-ups, activity and retention; use that report for current behavior and checks.

Date: November 3, 2026. Remote target: **lypfxcohmsosedwptebu** only. No database reset, unrelated project change, service-role application client, or Phase 4 calling implementation was introduced.

## Delivered

The existing collection cards, lead tables/cards, detail panel, navigation, dark/light theme and Follow-ups design remain in place. Collection creation, renaming, descriptions and confirmed deletion persist in Supabase. Counts and lead lists are real. Business details, notes and status editing, confirmed lead deletion, archive/restore, phone links and website/Maps links operate on real records. Maps identifiers and import provenance are read-only in the editor to protect originals.

CSV import is available from collections and individual pages. It detects common headers, supports manual mapping, previews five valid records, reports invalid row numbers, checks exact Maps duplicates and requires explicit replacement confirmation. UTF-8 BOM, quoted commas/multiline notes and comma/semicolon/tab/pipe delimiters are supported. Phone values remain strings. Invalid records are reported and excluded; remaining valid records can be imported.

Limits: **3.5 MB**, **10,000 rows**, **100 columns** per file. Next's Server Action ceiling is 4 MB; CSV text is sent as FormData rather than an escaped JSON string. Raw files are not retained. The server independently reparses and validates input; client preview is never authoritative.

## Database and operations

Migration: `supabase/migrations/202611030003_real_leads_imports.sql`.

| Addition | Purpose |
| --- | --- |
| `lead_pages.deleted_at` | Hide deleted collections without cascading away history |
| Import mode, request ID, batch sequence, replaced count | Idempotent retries, ordered undo and batch reporting |
| `import_members` | Inserted/replaced membership and timestamp baselines; owner-only RLS reads |
| Trigram indexes | Name, phone and normalized phone search |
| `workspace_pages`, `workspace_leads` | Owner-scoped summaries and pagination |
| `manage_page`, `save_lead` | Authorized writes and optimistic conflict detection |
| `preview_import`, `commit_import`, `undo_import` | Duplicate preview, atomic import and guarded reversal |

Server Actions in `src/lib/leads/actions.ts` verify the user through the Phase 2 context, validate inputs and invoke typed RPCs. Mutating RPCs derive ownership from `auth.uid()`, use an empty SQL search path, enforce ownership explicitly and deny anonymous execution. They serialize writes per owner with the same advisory lock as the Phase 2 Maps guard. Reads use RLS; no service-role credential is used by the app.

### Duplicate integrity

Maps URLs are preserved byte-for-byte. Import validation accepts Google Maps and supported Google short-link formats without resolving redirects or normalizing parameters, case or fragments. The existing database uniqueness index and duplicate trigger enforce equality across all of an owner's pages, including hidden records. Incoming duplicates are skipped; original notes/status/history are never overwritten. Identical names, phones, websites and addresses remain independent leads. NULL Maps URLs remain independent leads.

### Replacement and undo

An import is one transaction. Replacement hides existing target-page records while preserving same-Maps originals represented in the incoming file. Existing matches on other pages are skipped, never moved. Hidden originals retain their Maps identifiers. Failure rolls back insertion and replacement visibility changes together.

Every inserted/replaced record is associated with its batch. A stable request UUID prevents double insertion after network retries within the same dialog. History shows ten batches per page. Confirmed undo proceeds newest-first per collection. It physically removes unchanged inserted records and restores replaced originals. It refuses changed/missing records, edited timestamps, later completed imports, or calling/follow-up history on inserted records. Undo is idempotent. An empty collection created by a new-page import remains after undo and can be deleted separately.

Lead/collection deletion is soft deletion, not permanent purge. There is no general trash restoration UI in this phase. The Maps URL continues reserving its original record. Permanent do-not-call suppression remains even after import undo or status correction. Phone suppression never causes import duplicate skipping. No arbitrary SQL or AI endpoint is exposed.

### Performance and temporary filters

Lead reads return eight records plus counts, with a bounded SQL limit of 100. Search is debounced, stale responses ignored, and desktop/mobile filters, sorting and pagination are independent React state. They are not stored in URLs, localStorage, Supabase or Saved Views. Editing uses `updated_at` optimistic concurrency. The provider holds collection summaries rather than all real leads.

### Real versus mock

Collections, counts, lead lists, edits, archive visibility, imports and undo are real. Overview Active leads and collection shortcuts are real. Other calling statistics, daily history and Follow-ups retain labeled sample data and mock interactions. Recording a real lead attempt displays a Phase 4 notice instead of manufacturing an attempt. DeepSeek, scheduled cleanup and timezone handling remain deferred.

## Remote rollout

CLI access was restored by the user. Migration 003 was previewed and applied with CLI 3.0.0 using the explicit target `--remote=lypfxcohmsosedwptebu`. Remote database types were regenerated. Existing `.env.local` was reused; no additional environment variables or secrets are required. No other project's schema was changed.

Final migration listing confirmed all three local/remote versions match. A final read-only query confirmed zero remaining test collections and zero scale-fixture leads after the remote tests.

Deployment requires Node 22+, the existing two public Supabase environment values, all three versioned migrations and a confirmed account. Follow Phase 2 setup for Auth URLs/Vercel. Do not reapply applied SQL by hand or reset the remote database.

## Verification actually performed

- **17 unit tests passed**: CSV parsing/detection/mapping, malformed/oversized input, invalid rows, Maps formats, URL preservation, same-name/phone retention, 4,001-row parsing, plus existing Auth/session contracts.
- **Lint, TypeScript and production build passed**, using Node 22. All existing dashboard/login routes compiled.
- **63 local SQL/concurrency check groups passed**, applying all migrations to a fresh disposable PostgreSQL database. Coverage includes owner isolation, concurrent duplicates, original preservation, durable statistics, all import modes, retries, invalid replacement rollback, ordered/idempotent undo, edit/history protection, page management, 4,001-row import, eight-row pagination, Has Phone and normalized phone search.
- **Real remote Phase 3 SQL suite passed**, including a 4,001-row fixture in the confirmed account's JWT ownership context. All writes rolled back. Actual remote functions/constraints were tested.
- **17 real remote security checks passed** again: ownership, anonymous/cross-owner denial, attempt integrity, Maps-only skipping and retained aggregates after purge. RLS checked on all eleven tables.
- **Real HTTPS public-key checks passed**: registration disabled, email Auth enabled, anonymous Auth disabled, anonymous table reads denied on eleven tables, execution denied on seven Phase 3 RPCs, private schema inaccessible.
- **HTTP protection checks passed**: seven dashboard route patterns redirect without a session, malformed sessions rejected, login available, signup absent, private/no-store headers present.

Remote SQL fixtures used transaction-scoped JWT claims and rollback; no personal browser cookies or password were inspected. Phase 2 real login/reload/logout/protection was previously confirmed by the user. Phase 3 authenticated browser clicking, file-picker interaction, and visual checks at 360/390/412/768/desktop widths **were not performed** because local browser use is disabled in Work settings. Responsive classes are reused and import dialogs collapse to one column, but that is not rendered-device QA. No Vercel deployment is claimed.

## Repeatable checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
node --env-file=.env.local tests/remote-public.mjs
node tests/route-protection.mjs http://127.0.0.1:3000
```

```powershell
powershell -ExecutionPolicy Bypass -File tests/database/run.ps1
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-imports.sql --yes
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-security.sql --yes
```

Review remote SQL before execution; both scripts conclude with ROLLBACK. The local runner creates its own disposable database. Environment files and runtime output are excluded by `.gitignore`.
