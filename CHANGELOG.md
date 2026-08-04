# Changelog

All notable changes to **My Hub** (this personal fork).

## [1.1.23] - 2026-08-04

### Added
- Household profile switcher on Budget and Health (same users icon as Overview).
- Overview hero glance chips for monthly budget balance and today's med adherence.
- Budget and Health widgets shown by default on Overview.

### Changed
- Dark glass cards are more translucent on black so ambient blobs read stronger.
- Mobile PWA layout for category manager and budget entry modal (stacked forms, touch targets, sheet-style inline modals).

## [1.1.22] - 2026-08-04

### Changed
- Budget amounts display as whole numbers (no decimal cents) across Budget, Reports, Plan, Accounts, and the Overview budget widget. Entry form uses integer step and rounds on save.

## [1.1.21] - 2026-08-04

### Added
- Overview page redesign: hero badge, subtitle, and labeled widget section.
- Health profile tool (same household switcher as Overview) — person chip pills removed from all Health tabs.

### Changed
- Dark mode uses true black surfaces (`#000` base) for a deeper OLED-style UI.
- Budget “Current” month button is smaller (compact chip).

## [1.1.20] - 2026-08-04

### Added
- Liquid glass Phase 4: living backdrop visible through flagship pages, module-tinted drifting blobs on all routes, unified card hover lift, and staggered page-enter motion.
- Dashboard overview panel, Budget summary grid, and Health card grid layout refresh on glass routes.

### Fixed
- Dark-theme glass looked flat because `module-liquid-glass.css` suppressed blob opacity and `.app-content` painted an opaque layer over the backdrop.

## [1.1.19] - 2026-08-04

### Added
- Global glass surfaces (`app-glass-surfaces.css`) — login card, empty states, and shared monthly hero panels.
- Budget monthly hero: month title, transaction count, and income-vs-expenses flow bar (no day calendar).
- Health monthly overview hero: month label, 30-day adherence, due today, and streak above person chips.
- Liquid glass extended to Settings (module tint + frosted cards).

### Changed
- Overview, Budget, Health, and Settings use the scoped liquid-glass layer; Plan and Kitchen modules unchanged.

## [1.1.18] - 2026-08-04

### Added
- Liquid glass visual layer for Overview, Budget, and Health — frosted metric cards, richer typography, and module-tinted ambient backdrop (Forecast-inspired polish on the three flagship modules).

## [1.1.17] - 2026-08-02

### Added
- Budget month view: swipe left/right on the content area to change months (Budget and Plan tabs).

## [1.1.16] - 2026-08-01

### Fixed
- Personal → Account → My Profile save on GitHub Pages / local mode (`PATCH /auth/me/profile` and password change were missing from the local API).

## [1.1.15] - 2026-07-30

### Fixed
- Household profile isolation: each profile (Arpan, Ranjan, Wifey, …) sees only their own budget, board notes, and assigned tasks — including the admin’s own profile in shared budget mode.
- Profile switch now stores explicit self context so the default admin profile no longer shows other members’ data.
- Health profile switch uses the same context API.

### Changed
- Overview quick-actions (+): Budget, Health, and Board only (removed Task, Shopping, Calendar).

## [1.1.14] - 2026-07-30

### Fixed
- Profile switch now scopes budget to the selected member even when household budget mode is **shared** (no more cumulative totals across profiles).
- Budget list, summary, and dashboard widget filter by `owner_id` while acting as another household member.

## [1.1.13] - 2026-07-30

### Fixed
- Profile switch now scopes dashboard budget widget and greeting to the selected household member (local + server).
- Save/edit family members in local/GitHub Pages mode (`PATCH /auth/users/:id` was missing → “Not found”).
- Local user lookup uses numeric id matching so `acting_as` resolves reliably after context switch.

## [1.1.12] - 2026-07-30

### Changed
- Household profile switcher moved from the More sheet to the Overview header (users icon beside widget customize). Opens a high-contrast member picker modal on mobile and desktop.

## [1.1.11] - 2026-07-30

### Added
- Household profile switcher in mobile More sheet (PWA).

### Removed
- Budget “Copy from previous month” button.

## [1.1.10] - 2026-07-30

### Fixed
- Health page crash: restore missing `fromAppUrl` import (broken in 1.1.8).

## [1.1.9] - 2026-07-30

### Fixed
- App stuck on loading screen after 1.1.8 (duplicate `isValidFamilyRole` broke module load on GitHub Pages).

## [1.1.8] - 2026-07-30

### Added
- Household profile switcher for admins (manage each member's budget and health without re-login).
- Extended family roles (spouse, wife, husband, mother, father, son, daughter, sibling).
- Optional biometric lock when switching profiles (Settings → Account).

## [1.1.7] - 2026-07-30

### Fixed
- Budget category names always use English labels again (income and expenses), regardless of region (e.g. Hindi India / INR) or UI language. Custom renames still work.

## [1.1.6] - 2026-07-30

### Fixed
- Budget income categories show in the selected language (Hindi etc.) instead of German default names.
- Category rename still works: only user-changed names override locale labels.

### Changed
- Hindi locale: more budget expense category and subcategory labels translated.

## [1.1.5] - 2026-07-30

### Fixed
- Budget category rename now updates the displayed name (custom names no longer overridden by locale defaults).
- Local/GitHub Pages mode: personal budget scopes (mine vs household) and per-member entry ownership.

### Added
- Personal budget mode in local storage: each family member can track private income/expenses; shared entries appear in the household view (enable in Settings → Budget mode).

## [1.1.4] - 2026-07-30

### Fixed
- Budget tab scrolling after hide-amount controls were added.
- Recurring amount updates no longer change past months (series update keeps historical instances).
- Dashboard budget widget respects hide-amounts preference.

### Changed
- Hide amounts toggle is now an eye icon only (no text label).

## [1.1.3] - 2026-07-30

### Added
- Budget: hide/show amounts toggle for sensitive figures on screen.
- Budget: “Copy from previous month” for one-time entries.
- Local mode: full budget category/subcategory CRUD.
- Local mode: recurring budget entries auto-materialize in future months.
- Local mode: add family members from Settings → Administration → Family roles.

### Fixed
- Budget subcategory creation failed on GitHub Pages (missing local API routes).
- Add member from system settings failed in local mode.

## [1.1.2] - 2026-07-30

### Added
- Sapphire blue branding and hub-and-spoke logo (sidebar, login, PWA icons).

### Fixed
- Datepicker class name broken after My Hub rebrand (`MyHubDatepicker`).

## [1.1.1] - 2026-07-30

### Fixed
- Repair `MyHubDatepicker` JavaScript identifier after bulk rebrand rename.

## [1.1.0] - 2026-07-30

### Changed
- Rebrand to **My Hub** (display name, PWA, locales, internal identifiers).
- GitHub Pages base path: `/my-hub/`.
- Browser-only IndexedDB build for personal family management.

## [1.0.0] - 2026-07-30

### Added
- Initial personal family planner on GitHub Pages with local storage.
