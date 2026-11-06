# Workspace UI and query refresh — November 6, 2026

- Removed the duplicate Countries / Lead Pages tree from the desktop sidebar. Lead pages and country organization remain accessible through the main Leads section and mobile More menu.
- Replaced the WhatsApp navigation/action glyph with `FaWhatsapp` from React Icons.
- Added SVG browser icon, multi-size favicon.ico, and 180px Apple touch icon using the existing Folio waves and purple identity.
- Added a shared record skeleton to lead lists, conversations, activity, follow-ups, import history and lead history. Real request failures still display an error/retry instead of an indefinite skeleton.
- Added subtle page/interactive/sidebar transitions and disabled animations/transitions for reduced-motion preferences.
- Replaced mobile conversation tables with stacked, labelled rows using the same status editor, notes editor and action controls. Long imported addresses are bounded; desktop horizontal scrolling stays inside the table panel. Mobile bottom navigation remains within the viewport.
- Added Add lead on existing lead pages, with a target page selector and business/contact/location/notes form. Only the business name is required. A server action validates every field and uses the existing authenticated, owner-checked transactional insertion/deduplication path in append mode. The history records these entries as Manual entry. Request IDs protect retries; uncertain saves retain the original payload. No schema migration is required.
- Added TanStack Query for shared server-state storage, concurrent request deduplication, 30-second freshness, two-minute unused-cache collection and bounded retries. Query keys include owner, privacy epoch, feature and workspace revision. Existing realtime revisions and optimistic lead updates remain connected. Disconnection/sign-out clear private caches. No lead records are persisted in browser storage or a shared public Next.js server cache. New manual writes use Next.js path revalidation.

## Validation

Node 24.13.0: production build passed, ESLint passed with no warnings, 67 unit tests passed. `git diff --check` passed.

Browser command:

```powershell
$env:LOCAL_UI_FIXTURE='1'
node --env-file-if-exists=.env --env-file-if-exists=.env.local tests/workspace-refresh-remote.mjs
```

Passed using the actual Next.js app and the existing isolated HTTP backend fixture: manual lead submission into an existing page; loading skeleton before results; WhatsApp layouts at 320/390/430/1280px; all mobile navigation controls reachable; removed sidebar block; rendered WhatsApp glyph; all three favicon URLs; no browser runtime errors. Screenshots are in the ignored `.local-test-output/refresh-whatsapp-*.png` files. New unit cases validate manual-entry boundaries and query deduplication/isolation/invalidation.

The live Supabase variant could not obtain test-admin API-key access from the pre-existing CLI helper, so production database insertion and authorization were not reverified against a live account. The browser fixture is not evidence of SQL authorization; manual entry reuses the existing production transaction and authentication checks without changing them.
