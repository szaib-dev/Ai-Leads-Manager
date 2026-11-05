# Country organization — 2026-11-06

Lead Pages now shows country cards, each opening the existing lead-page manager scoped to that folder. Existing pages remain in an explicit Unassigned area; no country classification was inferred from names, lead fields or imports. Queue URLs and session filter keys are unchanged.

## Data model and safety

Migration 202611060022_country_folders adds owner-scoped lead_countries and a nullable composite-owner country relationship on lead_pages. Names are unique per owner ignoring case/outer whitespace. Only authenticated users can execute mutations; ownership is checked in each RPC and SELECT uses RLS. Existing owner transaction locks serialize page/country moves and deletion.

Country deletion explicitly unassigns its pages before deleting the folder, retaining pages, leads, attempts, imports and history. Create-page plus country assignment is atomic. CSV imports use import_in_country so importing and assigning a newly created page are atomic too. Retrying a completed import never moves the page back after a subsequent manual move. Existing and automatic imports without a selected country keep their prior behavior.

## UX

- Country grid: three desktop columns, two tablet columns, one mobile column; existing charcoal/violet tokens; compact page/contact/remaining counts and thin progress indicators.
- Search countries and search/filter pages inside countries; existing page card design, rename, move, and confirmed page deletion retained.
- Compact country dialogs, optimistic country cards with rollback, initial skeletons and bounded query invalidation via the existing owner revision signal. No router.refresh or document reload.
- Sidebar country folders expand to pages, highlight the selected page/country, and have a bounded scroll area. On mobile, More -> Country folders opens the tree in the existing dialog system.
- Global calling and messaging workflows are unchanged. Page moves retain IDs, filter/session keys, lead history and selection identity.

## Verification

Migration applied to production project lypfxcohmsosedwptebu. Before migration and after test cleanup: 4 pages, 119 leads, 6 attempts, 17 workflow history entries; zero existing pages assigned and no production country records created.

The countries-remote.mjs test ran twice against the actual remote database and the local production build using disposable accounts and two authenticated Chromium contexts (including 390px mobile). Verified UI country creation, realtime visibility in session B, duplicate-name rejection, country rename, UI page creation, UI moving, atomic import country assignment, retry safety after later movement, country deletion unassigning pages without deleting leads, and cross-owner read/move denial. All fixtures were removed. Dark desktop/mobile screenshots inspected; 61 unit tests, lint, TypeScript and production build passed using Node 24.

Frontend source changes are local and have not been pushed or deployed. Database migration is applied.
