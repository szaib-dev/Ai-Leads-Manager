# AI workspace and dashboard verification - November 4, 2026

The assistant now uses `/dash/ai`, authenticated conversation history, genuine DeepSeek response streaming, backend activity stages, Markdown, inline operation previews and approvals, and retry-stable message IDs. Existing structured tools, spending limits, do-not-call checks, permissions, and undo remain enforced by the database.

Dashboard fixes include searchable IANA timezones with country names and UTC offsets, aligned dropdowns, stacked mobile calling history, 15-record server pagination, optimistic lead updates with rollback, and a minimal sidebar. Ordinary visibility/resume events preserve the view. Temporary filters and scroll recovery are scoped to the user and browser tab; no Saved Views or lead records are stored in browser storage.

## Verification

- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed with strict TypeScript.
- `npm test`: 45 passed.
- `npm run test:ai`: 6 passed, including progressive provider streaming, interrupted streams, and provider errors.
- `tests/database/run.ps1`: all migrations and SQL/security/concurrency checks passed. This includes 4,000-record operations, Strict/Balanced/Autonomous policies, cross-owner isolation, do-not-call protection, Maps-only duplicate rules, undo, chat retries and memory, and privacy redaction after physical record removal.
- Chromium browser checks passed at desktop 1440px and mobile 360px, 390px, and 412px: searchable timezone positioning, calling history, no horizontal overflow, composer clearance above bottom navigation, Enter/Shift+Enter, duplicate prevention, stable retries, Markdown tables, chat reopening and back/forward navigation, 15-lead pagination, status/attempt updates without navigation, visibility-resume state, reload recovery, and theme switching.
- Real DeepSeek streaming was exercised through the Next.js API using fictional database fixtures. The final run delivered six text deltas, beginning about 1.0 seconds after stream headers and continuing progressively. All-Leads and Pakistani-page counts resolved to 32 and 31 fixture records. Completed request replay retained exactly one user message. Verification calls were reserved and settled in a separate local ledger capped at $0.05.
- Production build and protected-route smoke test passed.

Migrations `202611040010` and `202611040011` were applied to the configured hosted project. The pricing review was updated after checking [DeepSeek's official pricing](https://api-docs.deepseek.com/quick_start/pricing). The date-only Karachi/UTC rejection is fixed; stale/future reviews and the spending cap still block requests.

## Reproduction and limits

Use Node 22+ (verification used Node 24). Run `npx playwright install chromium`, then `npm run test:workspace-ui` for isolated browser fixtures. Set `LIVE_PROVIDER=1` to additionally exercise the configured DeepSeek provider. `npm run test:workspace-live` targets the dedicated hosted project and requires administrative test-fixture access.

Hosted management access returned HTTP 403 again after migration/configuration succeeded, so a complete hosted two-session Realtime browser run remains unverified. The final browser run used an isolated HTTP database fixture; SQL authorization and Realtime controller/adapter checks ran separately. Native Android dialer return and physical Motorola/Samsung hardware were not available; browser visibility/resume and reload recovery were tested instead.
