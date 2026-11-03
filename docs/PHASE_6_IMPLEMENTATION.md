# Phase 6 — DeepSeek assistant

Implemented November 4, 2026. This completes the conversational assistant separately from the earlier optional CSV auto-mapping feature. The approved dashboard, navigation, themes and calling interfaces remain in place.

## Using the assistant

Open **AI assistant** in the header, sidebar, or mobile More menu. The previous Coming Soon dialog is replaced with a conversational workspace, matched-record previews, permission settings, token-cost budget information, pagination, and action history with undo. Enter sends a command; Shift+Enter inserts a line break. New chat clears the conversation. Lead rows/cards now have an optional Select for AI checkbox; selection stays local to this browser.

Examples:

- “Show all leads on this page with no phone number AND no website.”
- “Show all leads on this page without a phone number OR without a website.”
- “Remove leads from my latest import that have no phone number.”
- “Append the note ‘Call after lunch’ to the selected leads.”
- “Set all leads on this page country to Canada.”
- “Schedule all leads on this page for a follow-up on 2026-11-12.”
- “Move all leads with three failed attempts to Archive.”
- “Undo my last CSV import.”
- “Undo my last AI action on this page.”

The assistant can search, filter, edit supported business fields/notes/status, append notes, remove, archive, restore, move records between existing collections, undo an eligible AI action, and undo a CSV import. It cannot discover/create new leads, execute SQL/code, merge/deduplicate existing leads, alter Maps URLs/provenance, record fictional calls, or bypass ownership/do-not-call restrictions. Only exact Maps URL equality automatically skips incoming CSV duplicates; original records remain protected by the existing database rules.

Current-page, selected-lead, recent-import and previous-search references resolve against owner-scoped database records. Latest imports are ordered by their database batch sequence. Ambiguous page names/references fail safely. An overview-page request must explicitly choose a page/all pages, except a verified selection or an undo command. Natural-language undo respects the resolved collection scope; action-history undo targets its exact recorded operation. Conversation context is limited to six short messages; the UI retains at most twelve messages in memory and clears sensitive payloads on workspace invalidation, hidden/offline transitions, or sign-out. No chat or filters are stored in localStorage or saved as views.

## Permissions, previews and reversibility

| Mode | Behavior |
|---|---|
| Strict | Every modification requires an explicit approval button. Read-only searches execute immediately. |
| Balanced | Additive notes execute automatically; all other modifications require approval. |
| Autonomous | Permitted modifications execute automatically. Database restrictions still apply. |

Save mode changes explicitly in Permissions & budget. The authoritative setting lives in Supabase; execution rechecks it even if another device changed it after a preview.

Previews show the exact count, resolved collection/import/destination, proposed field values and a paginated sample. Their target IDs/versions are frozen for ten minutes; newly matching records are not silently added. Changed/removed records reject the entire operation. A retry of a confirmed operation returns its existing result and does not repeat writes.

Removals use soft deletion. Eligible AI modifications can be undone for seven days, using the existing immutable workflow snapshots, suppression-source corrections, follow-up snapshots and timestamp conflict checks. Undo is atomic and blocks newer conflicting edits or missing/expired records. A move preserves the original import ID; its undo restores the original collection and safe CSV undo baseline. CSV import undo delegates to the existing guarded batch operation; it can permanently remove untouched imported records and restore replacement records, but cannot undo called/changed batches unsafely. Import undo itself is not redoable.

Ordinary AI status/phone edits and restore cannot remove do-not-call protection. Explicit correction of an AI action through guarded undo may reverse only the rejection source it created, preserving other suppression sources. Exhaustion uses consecutive unsuccessful attempts and failed-call statuses, so interested/successfully contacted leads are protected. Scheduling requires an explicit date and follow-up/meeting status, with optional literal time and no automatic timezone conversion. Date-only plans are rejected before they can claim a schedule was created.

## Backend and security

- `src/lib/ai/assistant-contracts.ts`: strict Zod intents, bounded conditions/groups, request context, hard command restrictions, literal-edit/obvious-condition checks, permission contracts.
- `src/lib/ai/assistant-provider.ts`: fixed DeepSeek endpoint, JSON-only structured translation, thinking disabled, bounded context/output and usage validation. No dynamic tool names, SQL, or code path exists.
- `src/lib/ai/assistant-actions.ts`: authenticated Next.js Server Actions, verified database context, deterministic reference resolution, budget reservation/settlement, staging, confirmation, cancellation and history queries. No elevated application key is used.
- `src/components/ai`: existing-theme responsive dialog and local conversation state. It is lazy-loaded after opening the assistant. Queries stop while closed; workspace synchronization reuses the single existing channel.
- `src/components/providers.tsx` and lead components: ephemeral AI selection/recent-import context only; search/sorting/mobile/desktop filters remain independent and temporary.

SQL migrations:

1. `202611040008_ai_assistant.sql`: staged controlled operations, owner-scoped RPCs, safe moves, permissions, privacy/expiry cleanup, batch mutations, workflow undo compatibility and bounded function timeouts.
2. `202611040009_ai_schedule_validation.sql`: rejects date-only/incomplete scheduled changes at the database boundary.

Both were previewed and applied only to `lypfxcohmsosedwptebu`. No reset or unrelated project changes were performed. Public database types were regenerated after the new schema/RPCs were applied; migration 009 preserves their signatures.

| Structure | Purpose |
|---|---|
| Existing `workspace_preferences` | Authenticated user's approval mode. |
| Existing `operations` + `ai_action` | PII-free action metadata, ownership, request idempotence, counts, status and undo deadline. |
| Private `ai_plans` | Short-lived validated command and verified import/undo references. Commands are cleared on completion/cancel/expiry. |
| Private `ai_targets` | Frozen owner-scoped IDs/versions and references to workflow corrections. |
| Existing `workflow_changes` + `ai_operation_id` | Existing before/after lead/follow-up snapshots reused for atomic correction. |
| Existing private `ai_runtime`/`ai_usage` | Shared CSV/chat pricing, monthly reservations, token accounting and conservative estimates. |

Every public structure retains owner RLS. Private plan/target tables have no client schema access. Staging/execution additionally require the existing server-derived proof; its hash, not the DeepSeek key, is stored privately. Model output never supplies owner IDs or arbitrary database queries. Imported notes/business records are not sent to the model; page/file names and prior conversation are explicitly untrusted metadata. Structured schemas, independent read/action/status alignment, literal-value/obvious-condition checks and database allowlists prevent output from becoming arbitrary execution.

Common bulk operations use set-based updates and one transaction, with per-lead workflow snapshots. Status/schedule changes reuse existing workflow services. Queries return at most twenty lead previews at a time; no thousands-of-record fetch is used to calculate match counts. Each operation is capped at 10,000 targets; larger requests must narrow scope. SQL execution is bounded to 60 seconds and staging to 30 seconds. The authenticated dashboard exports a 120-second Vercel function duration to allow planning plus a bounded database transaction on Fluid Compute; Vercel deployment itself was not performed. See [Supabase function timeouts](https://supabase.com/docs/guides/database/postgres/timeouts) and [Vercel duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).

Lead mutations trigger the existing PII-free workspace revision, once per transaction. No business tables or DELETE payloads are added to the Realtime publication. A confirmed response is reconciled with a fresh owner-scoped query if its own change notification invalidated local payloads; stale business data is not retained across a purge or disconnect.

Retention deletes lead-linked AI workflow snapshots and targets through their foreign keys. A BEFORE DELETE privacy trigger clears pending owner plans; the operation history retains only anonymous metadata/counts. A ten-minute PostgreSQL Cron maintenance task clears expired commands and removes expired private plans/targets. Existing 20-day rejection cleanup, anonymous calling facts, and suppression fingerprints remain unchanged.

## API configuration and cost controls

Required configuration remains:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://lypfxcohmsosedwptebu.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_public_publishable_key
DEEPSEEK_API_KEY=your_private_server_key
```

Keep the private key in ignored `.env.local` and server-only Vercel configuration. Local and deployed instances sharing this database must use the same configured provider key/proof; run `npm run ai:configure` after a key rotation. No service-role credential belongs in application configuration.

The optional settings `AI_MONTHLY_BUDGET_USD`, `AI_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION`, and `AI_PRICING_VERIFIED_DATE` are applied by `npm run ai:configure`. Existing configuration is already working remotely. Defaults are a $1.75 monthly cutoff, $0.30/$1.20 per million input/output tokens, and `deepseek-flash` with thinking disabled and 512 output tokens maximum. Rates were rechecked November 4, 2026 against [DeepSeek's official pricing](https://api-docs.deepseek.com/quick_start/pricing/); JSON handling follows the [official JSON output guide](https://api-docs.deepseek.com/guides/json_mode/).

Chat and CSV assistance share a global monthly ledger, so multiple devices/accounts cannot independently spend the same remaining balance. Each request reserves a conservative cost before contacting the provider. Known token usage settles once; failed/unknown usage retains its full reservation. Request IDs prevent replay, and requests are limited to six per user per minute. Deleting an account does not erase metered costs. All input is estimated at peak uncached rates, ignoring cheaper cache/off-peak discounts. Requests stop if pricing has not been reviewed in thirty days. These estimates cannot guarantee the provider's final bill or control other use of the API key.

## Verification

- Strict TypeScript, lint and production build passed. Production HTTP route-protection smoke tests are run against the built app.
- Unit tests cover strict schemas, AND/OR conditions, selection/context bounds, unsafe SQL/ownership fields, permanent duplicate restrictions, approval policies, dropped obvious conditions, invented edit values and date-only scheduling rejection.
- Provider contract tests use a fake transport for disabled thinking, bounded JSON, invalid/injected outputs, missing keys and request failures. Manual CSV import fallback remains tested.
- All nine migrations applied in a disposable PostgreSQL database; the full security/import/calling/analytics suite plus Phase 6 bulk/safety tests passed. This includes 4,000-record updates/undo, same-name/phone retention, exact AND/OR counts, idempotency, mode rechecks, stale plan rejection, move/import provenance, guarded import undo, DNC protection, follow-up routing/undo, soft-deleted restore/undo, expiry, and privacy-preserving retention.
- Real anonymous remote checks passed for 13 RLS tables, 28 protected RPCs, private-schema isolation, and disabled registration.
- The real production Next.js assistant Server Actions were tested over HTTP with real Supabase sessions and paid DeepSeek responses, using 4,000 fictional imported leads. Verified AND=666 vs OR=2667 results, current/latest-import context, selected IDs, previous search references, all permission modes, approved 2,000-record cleanup, idempotent retry, undo, automatic notes, autonomous archive/undo, CSV undo, explicit dedup refusal, cross-owner denial, and delivery to a second authenticated Realtime session. The cleanup/confirmation/read round trip measured 6,566 ms on this run. This is an observed fixture measurement, not a production latency guarantee.
- Temporary accounts/records were removed, subscriptions closed and temporary test servers stopped. Anonymous cost metadata remains in the budget ledger as intended. No personal business records were modified by verification.

A second live Server Action/DeepSeek run also passed literal country edits, page-scoped natural-language undo while preserving a newer action on another page, actual follow-up scheduling/undo, interested-status edits without fabricating calls, and clarification of “Clean my leads.” The first workflow run exposed a date-only scheduling plan; TypeScript validation, model instructions and migration 009 were corrected, and the complete live workflow test then passed.

The final remote audit confirmed all nine local/remote migration versions match, zero temporary Phase 6 users/pages remain, and only the existing workspace revision table is published. The current conservative monthly meter was $0.0095742 (23,514 input / 2,100 output tokens across metered requests), with the $1.75 software cutoff and November 4 pricing review configured. This meter includes existing usage and verification requests, not an isolated provider invoice. A production-bundle scan found the private API key in none of 27 browser JavaScript bundles.

Final automated checks: 37 unit tests, 3 provider-contract tests, and 99 SQL/concurrency check groups passed; lint, strict TypeScript, production build and all seven protected-route HTTP patterns passed.

Browser automation remains disabled in Work settings. Rendered browser clicks, actual light/dark screenshots, Android hardware and viewport inspection were not available; no visual/device pass is claimed. Existing responsive navigation/theme CSS is preserved, and assistant controls use responsive widths, overflow wrapping and touch-sized actions.

Repeat the focused checks under Node 22+:

```sh
npm test
npm run test:ai
npm run lint
npm run typecheck
npm run build
node tests/production-smoke.mjs
node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/remote-public.mjs --with-ai --with-assistant
node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/assistant-live-remote.mjs
node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/assistant-workflows-remote.mjs
```

```powershell
powershell -ExecutionPolicy Bypass -File tests/database/run.ps1
```

The live fixture scripts make paid API requests and require CLI administrative access solely for temporary account provisioning/cleanup. Review them before rerunning. They do not reset the remote database or use personal account passwords.
