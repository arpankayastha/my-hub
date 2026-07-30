# Yuvomi (GitHub Pages)

A fork of [ulsklyc/yuvomi](https://github.com/ulsklyc/yuvomi) — the self-hosted family planner — adapted to run entirely in the browser with **local IndexedDB storage** and hosted on **GitHub Pages**.

No Docker, no backend server, and no cloud database. Your household data stays in your browser on this device.

## Live demo

After GitHub Pages is enabled for this repository, the app is available at:

**https://arpankayastha.github.io/Genospace/**

## What works locally

- First-run setup and login (credentials stored in browser IndexedDB)
- Dashboard, tasks, shopping lists, calendar events, and notes
- Preferences and module navigation
- Data persists across visits in the same browser

## What is not available in this build

This static build does not include server-side features from the original Yuvomi:

- CalDAV / Google Calendar sync, Web Push, email, backups, WebDAV
- Budget, health, documents, rewards, housekeeping, and other modules that need the full API
- Multi-device sync (data is per-browser only)

For the full self-hosted experience with every module, use the [original Yuvomi project](https://github.com/ulsklyc/yuvomi) with Docker.

## Development

```bash
# Serve the static app locally (any static file server)
npx --yes serve public -l 3000
```

Open http://localhost:3000 — local mode is enabled automatically.

## Build for GitHub Pages

```bash
node scripts/build-pages.mjs
```

This copies `public/` to `docs/` for GitHub Pages deployment.

## Original project

- Source: https://github.com/ulsklyc/yuvomi
- License: MIT (see LICENSE)
