# Changelog

All notable changes to **My Hub** (this personal fork).

## [1.1.26] - 2026-08-04

### Fixed
- Cycle calendar: no longer marks past dates as predicted period before your logged start; overdue predictions do not backfill red days you did not log.
- Cycle calendar: fertile window and ovulation for the **current** cycle are shown correctly (not as next-month predictions).

### Changed
- Budget recurring: rolls forward one month at a time; “Apply recurring here” for planning ahead; past instances stay unchanged on edits.
- Budget statistics: filters stay visible on empty years; summary cards show zeros instead of trapping the page.
- Category/subcategory inline modals: solid panel on glass (no transparency overlap).
- Health: profile switcher aligned with Budget; quick-jump tabs on overview; dashboard health widget shows vitals, meds, cycle, and vaccination-style calendar events per profile.
- Cycle page: clearer ring labels (cycle day, period start date, next period date), horizontal timeline bar, and improved legend (logged vs predicted vs current cycle).

## [1.1.25] - 2026-08-04

### Changed
- Entry modals (Budget, Health vitals): compact mobile layout, title+amount side-by-side, category row with icon add button, sticky Save/Cancel footer, collapsible medical notice.

## [1.1.24] - 2026-08-04

### Changed
- Route error page: full-width readable report panel (version, URL, time, stack), one-click copy, mobile-friendly layout.

## [1.1.23] - 2026-08-04

### Added
- Household profile switcher on Budget and Health (same users icon as Overview).
- Overview hero glance chips for monthly budget balance and today's med adherence.
- Budget and Health widgets shown by default on Overview.

### Changed
- Dark glass cards are more translucent on black so ambient blobs read stronger.
- Mobile PWA layout for category manager and budget entry modal (stacked forms, touch targets, sheet-style inline modals).
- Service worker precaches Budget page dependencies and profile-switcher; avoids serving SPA HTML when a JS module fetch fails offline (fixes spurious "Failed to fetch dynamically imported module" on Budget).
