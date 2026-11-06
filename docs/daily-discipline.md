# Daily Discipline — 2026-11-06

Overview contains a compact Daily Discipline card. Current activity, next activity, manual completion progress and daily goals stay visible; the full twelve-activity checklist expands on demand. Existing tokens/icons and checkbox component support both themes. No schema migration or dependencies were added.

All schedule calculations use Asia/Karachi independently of browser and dashboard analytics timezones. Friday replaces Pakistan calls with research; weekends replace both call blocks with research/proposals/client work. From midnight to 12:15 AM the continuing evening block uses the previous day's rules. Sleep is considered the current activity from 1:00 AM until breakfast, with the displayed bedtime deadline remaining 1:30 AM. Unscheduled gaps display Break / free time.

Manual checkoffs use a per-owner, per-Pakistan-calendar-date localStorage key, survive reload, synchronize across same-origin tabs, and reset at Pakistan midnight. They are device-local, not a cross-device database log. Passing time never checks an activity off. The progress bar counts checked activities, and calling/proposal goals never display fabricated achieved counts.

Navigation is Overview, Lead pages, WhatsApp Conversations, Attempts, Follow-ups, Awaiting Callbacks, Activity, Archive, AI workspace. The country/page folder section is unchanged.

Validation: 65 unit tests passed, lint/TypeScript/production build passed. The Playwright test used the existing local backend fixture because remote administrative test credentials were unavailable. Tested New York browser timezone against Pakistan schedule, desktop and 320/390px mobile, light/dark layouts, exact sidebar order, manual persistence across reload, unchecked past activities, expand/collapse and midnight reset. No production data was modified.

Browser command: LOCAL_UI_FIXTURE=1 node --env-file=.env.local tests/daily-discipline-browser-remote.mjs (set the variable using the host shell). The fixture builds a temporary local-target production bundle; run npm run build afterward to restore the normal environment bundle.
