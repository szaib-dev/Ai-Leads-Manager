# Phase 1 verification

Verified locally on November 3, 2026, using the rendered app in the in-app Chromium browser.

## Responsive routes

Final checks passed: `npm run lint` (zero warnings), `npm run typecheck`, and `npm run build` on Next.js 16.4.4. A production server returned HTTP 200 for all seven route types plus the USA and Canada detail pages. The production overview also rendered without browser console errors.

All seven route types were loaded at each width in both dark and light themes: 84 route/theme/width checks. Widths: 360, 390, 412, 768, 1024, and 1440 CSS pixels. No horizontal page overflow was detected. The Pakistan page represented `/dash/pages/[id]`; USA, Canada, and a newly created empty custom page were checked separately.

Visual inspections included the dark desktop overview and lead table, light tablet table and overview, narrow dark calling cards, light mobile outcome dialog, follow-ups, and Activity empty state. Mobile Call/Attempt controls and bottom navigation have at least 44px touch targets. Safe-area padding is implemented; physical Motorola and Samsung hardware were not available.

## Interaction checks

- Desktop sidebar collapses and expands; tablet icon navigation retains accessible names.
- Mobile bottom navigation and More menu reach Attempts, Follow-ups, Activity, and Archive.
- Search matches business names and phone numbers with spaces. Sorting, pagination, status filtering, reset, and empty results work.
- Mobile-only phone/status/sort changes leave desktop settings unchanged.
- Refresh resets filters, sorting, attempts, notes, and custom pages. Light/Dark selection persists; System is available and follows the browser preference.
- Saving an outcome records exactly one in-memory attempt and changes the lead status. No Answer moves into Attempts. Three failed attempts shows review status without automatic archiving/deletion.
- Notes edit and save. Follow-up outcome retains the exact entered date and optional time. The same call appears in Activity.
- Activity date changes show the correct sample day and an empty state when no calls exist.
- A custom page can be created, opened, and displays a clear empty state.
- Desktop archive and restore update both views.
- Valid phone links use normalized `tel:` URLs. No real telephone call was initiated during testing.
- CSV and AI entry points explain that the features are unavailable; no API is called.
- Dialogs use Radix focus handling, accessible titles/descriptions, and dismiss controls. Reduced motion is respected.

## Corrections made during testing

Added accessible labels to tablet navigation, normalized phone searches, and made scheduled date/time inputs submit their native form values after browser testing exposed a mismatch with controlled date inputs.

## Scope

Mock data and state only. Physical-device calling, database persistence, CSV import, deduplication, auth, AI, and automatic deletion are intentionally outside Phase 1. The future Google Maps URL duplicate rule is preserved in README.md.

Production dependency audit: zero vulnerabilities. The development-only ESLint dependency tree reports moderate advisories; forced downgrades or incompatible overrides were not applied.
