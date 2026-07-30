# Changelog

All notable changes to **My Hub** (this personal fork).

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
- Household profile switcher in the mobile **More** sheet (PWA / no sidebar).

### Removed
- Budget “Copy from previous month” button (recurring entries still auto-fill future months).

## [1.1.10] - 2026-07-30

### Fixed
- Health page crash: restore missing `fromAppUrl` import (broken in 1.1.8).

## [1.1.9] - 2026-07-30

### Fixed
- App stuck on loading screen after 1.1.8 (duplicate `isValidFamilyRole` declaration in local permissions handler broke JS module load).

## [1.1.8] - 2026-07-30

### Added
- **Household profile switcher** in the sidebar: admins manage budget and health for each family member without logging out.
- Extended **family roles** (spouse, wife, husband, mother, father, son, daughter, sibling).
- Optional **biometric lock** when switching profiles (Settings → Account).

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
