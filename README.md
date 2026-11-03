# Folio — AI Lead Management Dashboard

Phase 6 adds the functional DeepSeek assistant, controlled bulk lead operations, approvals, action history and guarded undo on top of authenticated Realtime synchronization, date-based analytics and the existing lead/calling workflows. The approved responsive UI and themes are preserved. Active application screens use real records; fixture files are not workspace data.

See [Phase 2 setup](docs/PHASE_2_SETUP.md) for account/environment configuration, [Phase 3](docs/PHASE_3_IMPLEMENTATION.md) for imports, [Phase 4](docs/PHASE_4_IMPLEMENTATION.md) for calling/retention, and [Phase 5 implementation and verification](docs/PHASE_5_IMPLEMENTATION.md) for synchronization and analytics. See [Phase 6 implementation and verification](docs/PHASE_6_IMPLEMENTATION.md) for the live assistant, permissions, budget and testing limits.

## Run

Use Node.js 22 or newer. Copy `.env.example` to `.env.local`, configure the two public Supabase values, apply the versioned migrations and create a confirmed personal account as documented. Run `npm ci`, then `npm run dev`, and open http://127.0.0.1:3000/login. No public signup or unauthenticated demo bypass exists. Environment files and scratch databases are ignored by source control.

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

`npm start` runs the production build. Local SQL integration tests: `powershell -ExecutionPolicy Bypass -File tests/database/run.ps1` (requires PostgreSQL binaries; accepts `-PgBin`). The runner creates and removes only its own disposable database.

## Structure

- `src/app`: protected App Router routes and server layouts.
- `src/components/leads`: responsive tables/cards, page management, editing, CSV mapping/preview and history dialogs.
- `src/lib/leads`: authenticated server actions, typed contracts and row adapters.
- `src/lib/workflows`: validated calling/follow-up actions and paginated activity/history access.
- `src/lib/realtime`: authenticated owner-scoped synchronization, reconnect checkpoints and cleanup.
- `src/lib/analytics`, `src/components/analytics`: validated date ranges, IANA timezones and compact performance controls.
- `src/lib/imports`: CSV parsing, detection and validation shared with server ingestion.
- `src/lib/supabase`, `src/lib/auth`, `src/lib/db`: SSR clients, session verification and Phase 2 access utilities.
- `supabase/migrations`: schema, RLS, exact Maps uniqueness and transactional import RPCs.
- `src/types/database.ts`: generated remote database types.
- `src/components/providers.tsx`: real collection summaries, shared refresh revision and notifications.

## Data behavior

CSV imports support new collections, append and replacement, up to 10,000 rows / 3.5 MB per file. Each batch has an import ID. Replacement retains previous records for guarded undo. Only **exact Google Maps URL equality across an owner's collections** causes automatic skipping. Original URLs and records are preserved. Missing Maps URLs and shared names, phones, websites and addresses never cause duplicate skipping.

Lists fetch eight records at a time. Desktop and mobile filters, search, sorting and pagination use independent temporary component state. They are neither saved nor synced. Theme and display timezone are locally persisted preferences. No Saved Views exist.

Phase 5 also persists the user's display timezone locally, defaulting to Asia/Karachi. Date ranges and analytics page filters stay temporary. Realtime carries only an owner-scoped revision, once per transaction; authorized queries reload the mounted screens without refreshing the application. Business records and deleted-row payloads are not published. Statistics derive from confirmed historical facts and retain anonymous counts/page attribution after detail removal. Read the Phase 5 report for the distinction between current lead counts and period-based historical metrics.

Lead and collection deletion require confirmation and hide records rather than purging history. Imports are undone newest-first per collection; later edits, missing records or calling history block unsafe undo. Confirmed unsuccessful calls move to Attempts; three consecutive failures archive as Exhausted. A connected outcome resets the failure streak. Callbacks move to Follow-ups. Not Interested immediately archives and blocks outreach; a database Cron job removes rejected business details after 20 days while retaining anonymous calling facts and minimal suppression fingerprints. Exhausted leads have no automatic deletion deadline. Workflow corrections proceed latest-first per lead. Optional AI CSV mapping and natural-language lead management are available, with permission modes and owner-scoped database operations. Scheduling uses literal dates/times without automatic timezone conversion.


Optional CSV assistance and UI improvements are documented in [UI_AI_CSV_IMPROVEMENTS.md](docs/UI_AI_CSV_IMPROVEMENTS.md), including private DeepSeek configuration, budget safeguards, migration 007, and verification results.
