# Yuvomi (GitHub Pages)

A fork of [ulsklyc/yuvomi](https://github.com/ulsklyc/yuvomi) — the self-hosted family planner — adapted to run entirely in the browser with **local IndexedDB storage** and hosted on **GitHub Pages**.

No Docker, no backend server, and no cloud database. Your household data stays in your browser on this device.

## Live demo

After GitHub Pages is enabled for this repository, the app is available at:

**https://arpankayastha.github.io/genospace/**

Visiting `/Genospace/` (any casing) redirects to the lowercase URL.

## Local API (how API calls work in this build)

There is **no network backend**. When `window.__YUVOMI_LOCAL_MODE__` is true (set in `index.html` on GitHub Pages and when serving `public/` locally), every `api.get/post/put/patch/delete()` call goes through:

1. **`public/api.js`** — detects local mode and calls `localApiFetch()` instead of `fetch('/api/v1/…')`
2. **`public/local/api-router.js`** — parses the path and delegates to `handleLocalApi()`
3. **`public/local/handlers.js`** — routes to module handlers and reads/writes **`public/local/store.js`** (IndexedDB)

### What you need for an API route to work

| Requirement | Where |
|-------------|--------|
| Logged-in session | `localStorage` session via `/auth/login` or `/auth/setup` |
| Handler for the path | `handleLocalApi()` in `handlers.js`, or a dedicated `*-handlers.js` |
| State arrays / fields | `emptyState()` in `store.js` + `ensure*State()` on load |
| Persist after writes | `await saveState()` in the handler |

If a page calls e.g. `api.post('/birthdays', …)` but no handler exists, you get **`ApiError: Not found.`** (often shown as a toast, not always in the console).

### Currently implemented local API modules

- Auth (setup, login, logout, me)
- Preferences, dashboard (partial), reminders, tasks (+ reward points on completion), shopping, calendar, notes
- Budget, health (vitals, meds, labs, activities, cycle), birthdays, split-expenses (stubs)
- Contacts (+ categories), meals, recipes, rewards, housekeeping, documents (+ folders)
- Family members, search, pantry locations
- Weather / push / permissions (stubs); DMS cloud links (not available locally)

### GitHub Pages path prefix

Assets and routes use `/genospace/` (lowercase). The build sets `GITHUB_PAGES_BASE=/genospace` and injects `__YUVOMI_CANONICAL_BASE__`. Helpers in `app-path.js` (`assetUrl`, `toAppUrl`, `fromAppUrl`) apply that prefix.

## Development

```bash
# Serve the static app locally (any static file server)
npx --yes serve public -l 3000
```

Open http://localhost:3000 — local mode is enabled automatically. API calls use IndexedDB; no server required.

## Build for GitHub Pages

```bash
GITHUB_PAGES_BASE=/genospace node scripts/build-pages.mjs
```

This copies `public/` to `site/` and rewrites asset paths for subpath hosting.

## Enable GitHub Pages

After merging to `main`, the **Deploy GitHub Pages** workflow pushes the built site to the `gh-pages` branch.

1. Open **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**
3. Choose branch **`gh-pages`** and folder **`/ (root)`**
4. Save — the site will be at **https://arpankayastha.github.io/genospace/**

## Original project

- Source: https://github.com/ulsklyc/yuvomi
- License: MIT (see LICENSE)
