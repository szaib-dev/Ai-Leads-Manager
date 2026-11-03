# Lead workspace UI and optional AI CSV mapping

This change is limited to Maps links, lead-detail editing, shared select/checkbox controls, call-only history, and optional CSV assistance. It does not implement the broader natural-language lead management assistant.

## Behavior

- Google Maps actions are available in desktop lead rows and mobile cards. Missing links are hidden. Links open in a new tab with accessible business-specific labels.
- Lead details open in view mode. Edit enables the business form; Save commits a validated patch and Cancel discards business-field edits. Notes remain directly editable and save independently, without submitting the business form. Existing concurrency/version checks, status workflows, call protection, audit history, and undo remain in place.
- Shared Radix Select controls use the existing theme variables, portaled menus, keyboard navigation, collision handling, selected indicators and mobile touch targets. Native checkbox semantics are retained with consistent styling. Filters remain local, temporary, and independent between mobile/desktop.
- Calling History uses a paginated call-only projection. Status/archive/scheduling events remain in the audit model and Recent Activity. Corrected calls retain their original ordinal and are explicitly excluded from totals. No historical facts are rewritten. During rolling deployment, a bounded owner-scoped fallback uses existing tables and analytics if migration 007 is not yet available.
- Auto-map with AI is optional. It sends at most 100 headers and 3 sample rows, with headers truncated to 160 characters and cells to 80, never the entire CSV. Suggestions are reviewed before applying. Only supported fields and unique column indices are accepted. Manual mapping/import works without an API key or functioning provider/budget configuration.
- Optional formatting trims outer whitespace and normalizes phone whitespace. It preserves phone digits, leading zeros, plus signs and extensions. Maps URLs and notes are never rewritten. Missing values are not invented. The first five valid rows expose all mapped fields, invalid rows are reported, and unmapped columns are listed. Source CSV contents are unchanged.
- Only exact Google Maps URL equality remains an automatic duplicate condition. No phone/name/website/location deduplication is introduced.

## Configuration

`DEEPSEEK_API_KEY` is server-only and optional. Keep it in ignored `.env.local` locally and a private server environment variable on Vercel. No service-role credential belongs in application configuration.

Migration: `supabase/migrations/202611030007_call_history_ai_mapping.sql` adds the call-history RPC and private budget tables. The new private tables store billing metadata only, not CSV samples, business details, or provider credentials. Public RPCs require authentication; reserving/settling usage additionally requires a server-derived proof that browser clients cannot forge. Only its hash is stored in the database.

After applying the migration, run under Node 22+:

```sh
npm run ai:configure
```

This helper targets only `lypfxcohmsosedwptebu`, verifies the configured project URL, stores the proof hash and pricing configuration, and removes its ignored temporary SQL file. It never writes the provider API key into the database. Repeat after rotating the provider key. CLI access is required for this setup only.

Optional environment variables applied by the helper:

- `AI_MONTHLY_BUDGET_USD` (default `1.75`, maximum `2`)
- `AI_INPUT_USD_PER_MILLION` (default `0.30`)
- `AI_OUTPUT_USD_PER_MILLION` (default `1.20`)
- `AI_PRICING_VERIFIED_DATE` (default `2026-11-03`)

The model is `deepseek-flash` with thinking disabled and a 512-token output cap. Pricing was checked against the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing) on November 3, 2026. Estimates conservatively use peak, uncached input prices for all prompt tokens and ignore cache/off-peak discounts. Review actual provider prices before updating the verification date; requests stop after 30 days without a review. See the [thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode) and [JSON output documentation](https://api-docs.deepseek.com/guides/json_mode).

A global transactional reservation prevents concurrent sessions/accounts from spending the same remaining budget. Requests reserve a conservative upper bound before contacting DeepSeek, settle confirmed usage once, and retain the reservation when usage is unknown. Deleting an account does not reset global monthly costs. Duplicate request IDs and more than six requests per user per minute are rejected. These software estimates cannot guarantee the provider's final bill or control usage of the same key outside this application.

## Verification

- `npm test`: 29 tests passed, including 4 new CSV/AI mapping tests.
- `npm run test:ai`: 2 provider-contract tests passed with a fake transport, covering request configuration, invalid output, missing key, provider errors and prompt-injection-shaped output. These are not live-model claims.
- Disposable PostgreSQL: all seven migrations applied; existing security/import/workflow/analytics/concurrency tests and the new call-history/budget tests passed. Checks cover one row per call, complete internal audit, exact notes/ordinals, correction counts, notes-only patches, forged/null server proofs, cross-owner settlement/history access, stale pricing, request replay, cutoff, and cost retention.
- Lint, strict TypeScript, production build, and production HTTP route-protection smoke checks passed.
- Real remote public checks: signup disabled, 13 application tables unreadable anonymously, 17 existing RPCs inaccessible anonymously, private schema inaccessible.

Remote migration 007 was previewed and applied only to the dedicated project, then database types were regenerated. The remote SQL suite passed and rolled back all fixtures/configuration overrides. The expanded anonymous HTTPS checks passed for all 21 protected RPCs. One real DeepSeek request returned all seven expected field mappings: 324 input tokens and 122 output tokens, conservatively estimated at $0.0002436. The durable ledger confirmed that exact estimate after settlement; its temporary account was removed and the anonymous cost remained. A final remote metadata query confirmed migration 007, the $1.75 budget, configured server-proof hash, and zero temporary test accounts. No personal business records were used for the paid provider test.

The existing two-session live Realtime SDK regression also passed again: call/status synchronization, follow-up scheduling/rescheduling/completion, one batch notification for CSV imports, archive/removal, exact activity/ordinals, token refresh, reconnect catch-up, duplicate counting prevention and cross-owner event isolation. Channels were closed and fixture accounts removed. These are authenticated SDK session tests, not browser interaction tests. Browser automation reports that local browser use is disabled in Work settings; actual rendered light/dark and viewport/device interaction checks were not performed. Existing responsive layouts and navigation are preserved, but no browser/device pass is claimed.

To repeat live checks (temporary fixture accounts are explicitly removed; the SQL suite rolls back):

```sh
npx supabase@3.0.0 db push --remote=lypfxcohmsosedwptebu --dry-run
npx supabase@3.0.0 db push --remote=lypfxcohmsosedwptebu --yes
npm run ai:configure
npx supabase@3.0.0 db query --remote=lypfxcohmsosedwptebu --file tests/database/remote-ai-mapping.sql --yes
node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/remote-public.mjs --with-ai
node --conditions=react-server --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx tests/ai-live-remote.ts
```

The live provider test makes one paid mapping request with fictional business values, using the same reservation and settlement functions as the server action. Keep its token/cost metadata in the report; never log credentials or request contents.
