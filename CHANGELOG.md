# Changelog

All notable changes to **My Hub** (this personal fork).

## [1.1.30] - 2026-08-04

### Fixed
- Budget recurring: deleting an entire series keeps past months and only removes current/future instances (series ends instead of wiping history).
- Budget recurring: new series no longer auto-fill when browsing future months; use “Apply recurring here” to plan ahead.

## [1.1.29] - 2026-08-04

### Changed
- Budget month summary (income / expenses / balance): compact three-column row on mobile instead of stacked full-width tiles.

## [1.1.28] - 2026-08-04

### Fixed
- CSV export (Budget, Health, Statistics): downloads use the GitHub Pages base path and work in local/PWA mode instead of 404 on `github.io/api/...`.
- Split expenses on GitHub Pages: groups persist in IndexedDB; group creation modal survives partial load failures.
- Budget mobile tabs: full-width scroll row so Split is reachable; Split tab moved earlier in the list.
- PWA icons regenerated from the current hub logo; apple-touch icon points to the correct asset.

### Changed
- Budget header: profile switcher beside the module title (aligned with Health tab bar layout).

## [1.1.27] - 2026-08-04

### Fixed
- Budget shared mode: all household entries visible and editable; profile switch still scopes the view.
- Dashboard widget layout stored per household profile (no longer overwrites every profile).

### Changed
- Settings shows app version; standalone changelog page removed (release notes remain in `changelog.md` for version checks).
- Budget and Health month overview share the same hero layout: stat chips, compact icon toolbar, overflow menu for copy/recurring/categories/CSV.
- Health overview quick navigation tabs are icon-only (labels in tooltips and screen readers).

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
