# City folders and workspace polish

Country folders now contain custom-named cities and lead pages. Pages can stay directly in a country or move into a city. City deletion unassigns its pages within the country; country deletion moves the hierarchy's pages to Unassigned. Neither operation deletes leads or call history. Country totals include pages inside cities.

Create and move controls, imports, sidebar folders, breadcrumbs and last-location recovery support the hierarchy. Imports into a city commit the import and folder assignment in one transaction. Retrying a completed import never moves its page to a newly selected folder.

The chatbot can propose moving an entire existing lead page to an existing city in that page's country. It uses owner-verified page/city metadata, rejects ambiguous or filtered/selected-lead requests, and always requires approval. A frozen ten-minute plan validates page versions and destination names again on execution. Individual lead moves between lead pages retain their existing behavior. Example: “Move the Mirpur salons page into the Mirpur city folder.”

CSV import has a compact file card, progress steps, optional collapsed mapping assistance, separate scrolling content, and an always-visible action footer. Call outcomes use the same independent body/footer arrangement. Page cards have no arrow or grip handle; mouse dragging works over the card, touch uses a hold, and keyboard reordering remains available from the focused card. Interactive buttons continue to work independently. Sorting by total leads sits beside search and switches back to custom order after dragging.

Radix select/dropdown menus and dialogs animate opening and closing. Chat history animates width/position and becomes inert while closed. Native sidebar folder transitions progressively enhance supported browsers. Reduced-motion preferences disable the added motion. Page grids include bottom space above mobile navigation.

## Validation and deployment

- TypeScript, lint and 74 unit tests, including folder intent resolution and read-only/ambiguity guards.
- Full existing database regression/concurrency suite and targeted city regression. City checks cover arbitrary names, same-country uniqueness, ownership, frozen approvals, stale/cancel guards, transactional imports, idempotency and non-destructive deletion.
- `tests/workspace-city-import-ui.mjs` uses the actual Next.js app and isolated local transport fixtures for mouse dragging, lead-count sorting, custom city creation, page movement/creation, imports into cities, desktop/mobile footer bounds, chat-history transitions and folder approval. Its proof credential is fictional and never calls an AI provider.
- `docs/DEPLOY_CITY_FOLDERS.sql` wraps migration 202611130033 and its version registration in one transaction. The user reported successful installation through Supabase SQL Editor. The CLI session had rejected SQL access, so no new live database timing claim is made.

Local fixture checks establish UI behavior, not production database authorization or a physical-phone timing guarantee. Database security is exercised separately in PostgreSQL.
