# My Hub

Personal family system — calendar, tasks, shopping, meals, budget, contacts, and more. This build runs **entirely in the browser** with **IndexedDB** storage and is hosted on **GitHub Pages**.

No Docker, no backend server, and no cloud database. Your household data stays on this device.

## Live app

**https://arpankayastha.github.io/my-hub/**

## Local API (browser-only build)

When `window.__MY_HUB_LOCAL_MODE__` is true (set in `index.html`), every `api.get/post/put/patch/delete()` call goes through:

1. **`public/api.js`** — local mode → `localApiFetch()`
2. **`public/local/api-router.js`** — route parsing
3. **`public/local/handlers.js`** + **`public/local/store.js`** (IndexedDB)

### GitHub Pages base path

Assets and routes use **`/my-hub/`**. The deploy workflow sets `GITHUB_PAGES_BASE=/my-hub` and injects `__MY_HUB_CANONICAL_BASE__`. Path helpers live in `public/app-path.js`.

## Development

```bash
npx --yes serve public -l 3000
```

Open http://localhost:3000 — local mode is enabled automatically.

## Build for GitHub Pages

```bash
GITHUB_PAGES_BASE=/my-hub node scripts/build-pages.mjs
```

## Versioning

Bump together on each release:

- `package.json` / `package-lock.json` — `version`
- `public/sw.js` — `APP_RELEASE`
- `public/local/handlers.js` — `APP_VERSION`

## GitHub Pages setup

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: **`gh-pages`**, folder **`/ (root)`**
3. Site URL: **https://arpankayastha.github.io/my-hub/**

## License

MIT — see [LICENSE](LICENSE).
