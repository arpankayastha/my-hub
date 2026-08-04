/**
 * Modul: Service Worker
 * Zweck: Offline-Fähigkeit, differenzierte Caching-Strategien, Update-Notification
 * Abhängigkeiten: keine
 *
 * Caching-Strategien:
 *   APP_SHELL (HTML + kritische JS/CSS): Cache-First (frisch vorgeladen via install)
 *   PAGE_MODULES (Seiten-JS): Cache-First (frisch vorgeladen via install)
 *   ASSETS (Bilder, Icons): Cache-First, lazily gecacht, bei SW-Update geleert
 *   API: Network-First für eine Read-only-GET-Whitelist (Kalender, Tasks, …)
 *        → offline letzter Stand sichtbar; Mutationen/Auth immer direkt ans Netz.
 *        Cache wird bei Logout/Session-Ende geleert (CLEAR_API_CACHE-Message).
 *
 * Nach SW-Update: alle Requests gehen einmalig cache-bypassed ans Netz
 *   → bypassCacheUntil (in-memory + Cache API für SW-Restart-Robustheit)
 */

const APP_RELEASE   = '1.1.33';
const SHELL_CACHE   = `my-hub-shell-${APP_RELEASE}`;
const PAGES_CACHE   = `my-hub-pages-${APP_RELEASE}`;
const LOCALES_CACHE = `my-hub-locales-${APP_RELEASE}`;
const ASSETS_CACHE  = `my-hub-assets-${APP_RELEASE}`;
// API-Cache bewusst NICHT in ALL_CACHES: er wird bei jedem SW-Update neu benannt
// (Version im Namen) und bei Logout/Session-Ende gezielt geleert.
const API_CACHE     = `my-hub-api-${APP_RELEASE}`;
const BYPASS_CACHE  = 'my-hub-bypass-flag';
const ALL_CACHES    = [SHELL_CACHE, PAGES_CACHE, LOCALES_CACHE, ASSETS_CACHE];

// GET-API-Pfade (nach /api/v1), die für Read-only-Offline gecacht werden dürfen.
// NUR Lese-Endpunkte — niemals /auth/* oder Mutationen. Prefix-Match.
const API_CACHE_WHITELIST = ['/my-hub/calendar', '/my-hub/tasks', '/my-hub/shopping', '/my-hub/contacts', '/my-hub/dashboard'];

// App-Shell: sofort benötigt für ersten Render
const APP_SHELL = [
  '/my-hub/',
  '/my-hub/index.html',
  '/my-hub/api.js',
  '/my-hub/lang-init.js',
  '/my-hub/router.js',
  '/my-hub/i18n.js',
  '/my-hub/rrule-ui.js',
  '/my-hub/reminders.js',
  '/my-hub/push.js',
  '/my-hub/sw-register.js',
  '/my-hub/lucide.min.js',
  '/my-hub/styles/tokens.css',
  '/my-hub/styles/reset.css',
  '/my-hub/styles/pwa.css',
  '/my-hub/styles/layout.css',
  '/my-hub/styles/glass.css',
  '/my-hub/styles/app-glass-surfaces.css',
  '/my-hub/styles/liquid-glass-motion.css',
  '/my-hub/styles/module-liquid-glass.css',
  '/my-hub/styles/login.css',
  '/my-hub/styles/reminders.css',
  '/my-hub/styles/dashboard.css',
  '/my-hub/styles/tasks.css',
  '/my-hub/styles/shopping.css',
  '/my-hub/styles/meals.css',
  '/my-hub/styles/calendar.css',
  '/my-hub/styles/notes.css',
  '/my-hub/styles/contacts.css',
  '/my-hub/styles/birthdays.css',
  '/my-hub/styles/budget.css',
  '/my-hub/styles/documents.css',
  '/my-hub/styles/settings.css',
  '/my-hub/styles/recipes.css',
  '/my-hub/styles/pantry.css',
  '/my-hub/components/my-hub-install-prompt.js',
  '/my-hub/offline.html',
  '/my-hub/manifest.json',
  '/my-hub/favicon.ico',
  '/my-hub/icons/favicon-32.png',
  '/my-hub/icons/apple-touch-icon.png',
  '/my-hub/icons/icon-192.png',
  '/my-hub/icons/icon-512.png',
  '/my-hub/icons/icon-maskable-192.png',
  '/my-hub/icons/icon-maskable-512.png',
];

const APP_LOCALES = [
  '/my-hub/locales/ar.json',
  '/my-hub/locales/cs.json',
  '/my-hub/locales/de.json',
  '/my-hub/locales/el.json',
  '/my-hub/locales/en.json',
  '/my-hub/locales/es.json',
  '/my-hub/locales/fa.json',
  '/my-hub/locales/fr.json',
  '/my-hub/locales/hi.json',
  '/my-hub/locales/hu.json',
  '/my-hub/locales/id.json',
  '/my-hub/locales/it.json',
  '/my-hub/locales/ja.json',
  '/my-hub/locales/ko.json',
  '/my-hub/locales/nl.json',
  '/my-hub/locales/pl.json',
  '/my-hub/locales/pt.json',
  '/my-hub/locales/ru.json',
  '/my-hub/locales/sv.json',
  '/my-hub/locales/tr.json',
  '/my-hub/locales/uk.json',
  '/my-hub/locales/vi.json',
  '/my-hub/locales/zh.json',
];

// Seiten-Module: lazy geladen, aber vorab gecacht für Offline
const PAGE_MODULES = [
  '/my-hub/pages/dashboard.js',
  '/my-hub/pages/tasks.js',
  '/my-hub/pages/shopping.js',
  '/my-hub/pages/meals.js',
  '/my-hub/pages/calendar.js',
  '/my-hub/pages/notes.js',
  '/my-hub/pages/contacts.js',
  '/my-hub/pages/birthdays.js',
  '/my-hub/pages/budget.js',
  '/my-hub/pages/budget-stats.js',
  '/my-hub/pages/budget-plans.js',
  '/my-hub/pages/split-expenses.js',
  '/my-hub/pages/subscriptions.js',
  '/my-hub/pages/documents.js',
  '/my-hub/pages/rewards.js',
  '/my-hub/pages/health.js',
  '/my-hub/pages/settings.js',
  '/my-hub/pages/login.js',
  '/my-hub/pages/recipes.js',
  '/my-hub/pages/pantry.js',
  '/my-hub/components/category-manager.js',
  '/my-hub/components/profile-switcher.js',
  '/my-hub/settings/currency.js',
  '/my-hub/utils/horizontal-swipe.js',
  '/my-hub/utils/sortable.js',
  '/my-hub/vendor/sortablejs/sortable.esm.min.js',
  // libphonenumber-js: lazy im Kontaktmodul, aber vorab gecacht → Telefon-
  // Formatierung funktioniert auch offline (Kernmodul). Versions-gecacht.
  '/my-hub/vendor/libphonenumber/core.min.mjs',
  '/my-hub/vendor/libphonenumber/metadata.min.json',
  '/my-hub/settings/registry.js',
  '/my-hub/settings/shell.js',
  '/my-hub/settings/components.js',
  '/my-hub/settings/module-order.js',
  '/my-hub/settings/pages/personal-account.js',
  '/my-hub/settings/pages/personal-appearance.js',
  '/my-hub/settings/pages/personal-device.js',
  '/my-hub/settings/pages/personal-calendar.js',
  '/my-hub/settings/pages/modules-navigation.js',
  '/my-hub/settings/pages/modules-kitchen.js',
  '/my-hub/settings/pages/modules-calendar.js',
  '/my-hub/settings/pages/modules-options.js',
  '/my-hub/settings/pages/modules-rewards.js',
  '/my-hub/settings/pages/sync-calendar.js',
  '/my-hub/settings/pages/sync-contacts.js',
  '/my-hub/settings/pages/sync-reminders.js',
  '/my-hub/settings/pages/notifications.js',
  '/my-hub/settings/pages/documents-storage.js',
  '/my-hub/settings/pages/documents-dms.js',
  '/my-hub/settings/pages/admin-family.js',
  '/my-hub/settings/pages/admin-api.js',
  '/my-hub/settings/pages/admin-backup.js',
  '/my-hub/settings/pages/admin-weather.js',
  '/my-hub/settings/pages/admin-system.js',
];

// --------------------------------------------------------
// Bypass-Flag: nach SW-Update einmalig alles frisch vom Netz laden.
// In-Memory-Variable (schnell) + Cache API (SW-Restart-sicher).
// --------------------------------------------------------
let bypassCacheUntil = 0;

// Beim SW-Prozess-Start: Flag aus Cache API wiederherstellen.
// Nötig falls Chrome den SW zwischen activate und erstem Fetch terminiert hat.
let _bypassInitDone = false;
const _bypassInit = (async () => {
  try {
    const c = await caches.open(BYPASS_CACHE);
    const r = await c.match('/my-hub/active');
    if (r) {
      const until = parseInt(r.headers.get('x-until') || '0');
      if (Date.now() < until) {
        bypassCacheUntil = until;
      } else {
        await c.delete('/my-hub/active'); // abgelaufen, aufräumen
      }
    }
  } catch { /* Fehler ignorieren */ }
  _bypassInitDone = true;
})();

// --------------------------------------------------------
// Install: App-Shell + Seiten-Module vorab cachen
// cache: 'reload' umgeht den HTTP-Cache → immer frische Dateien
// --------------------------------------------------------
self.addEventListener('install', (event) => {
  const freshShell   = APP_SHELL.map((url)    => new Request(url, { cache: 'reload' }));
  const freshModules = PAGE_MODULES.map((url) => new Request(url, { cache: 'reload' }));
  const freshLocales = APP_LOCALES.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c) => c.addAll(freshShell)),
      caches.open(PAGES_CACHE).then((c) => c.addAll(freshModules)),
      caches.open(LOCALES_CACHE).then((c) => c.addAll(freshLocales)),
    ]).then(() => self.skipWaiting())
  );
});

// --------------------------------------------------------
// Activate: Alte Cache-Versionen löschen + Bypass setzen + Clients informieren
// --------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Versions-Caches der laufenden Release behalten; alles andere entfernen —
          // inklusive alter Vorversions-Caches UND der Legacy-`my-hub-*`-Caches aus der
          // Zeit vor dem My Hub-Rename (Cache-Invalidierung, kein User-Eingriff nötig).
          .filter((key) => !ALL_CACHES.includes(key) && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
    // Assets-Cache leeren: lazily gecachte Bilder/Icons werden sonst nie erneuert.
    .then(() => caches.delete(ASSETS_CACHE))
    .then(async () => {
      // Bypass-Fenster setzen: nach SW-Update lädt die nächste Seite alles frisch.
      // KEIN künstliches waitUntil-Delay hier — Chrome würde clients.claim()
      // / controllerchange erst nach Ablauf der waitUntil-Promise feuern,
      // was dazu führt dass bypassCacheUntil gerade abläuft wenn der Reload kommt.
      const bypassUntil = Date.now() + 30000;
      bypassCacheUntil = bypassUntil;

      // Cache API: überlebt SW-Prozess-Terminierung zwischen activate und Reload
      try {
        const c = await caches.open(BYPASS_CACHE);
        await c.put('/my-hub/active', new Response('1', {
          headers: { 'x-until': String(bypassUntil) },
        }));
      } catch { /* Fehler ignorieren */ }

      self.clients.claim();
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
      });
    })
  );
});

// --------------------------------------------------------
// Fetch: Strategie je nach Request-Typ
// --------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;

  // API-Requests: nur GET-Whitelist read-only offline-cachen. Alles andere
  // (Mutationen, /auth/*, Nicht-Whitelist) unangetastet ans Netz durchreichen.
  if (url.pathname.startsWith('/my-hub/api/')) {
    if (request.method === 'GET' && isCacheableApiGet(url.pathname)) {
      event.respondWith(
        (_bypassInitDone ? Promise.resolve() : _bypassInit).then(() => {
          // Im Bypass-Fenster (nach SW-Update) API-Requests nicht anfassen:
          // frisch ans Netz, weder aus Cache bedienen noch hineinschreiben.
          if (Date.now() < bypassCacheUntil) return fetch(request);
          return networkFirstApi(request);
        })
      );
    }
    return;
  }

  if (request.method !== 'GET') return;

  // Erste Fetch-Events nach SW-Start: auf Cache-API-Initialisierung warten,
  // damit bypassCacheUntil korrekt gesetzt ist bevor wir entscheiden.
  if (!_bypassInitDone) {
    event.respondWith(
      _bypassInit.then(() => dispatchFetch(request, url))
    );
    return;
  }

  event.respondWith(dispatchFetch(request, url));
});

function dispatchFetch(request, url) {
  // Nach SW-Update: direkt vom Netz, kein SW-Cache, kein HTTP-Cache.
  // Gilt für ALLE Requests (JS, CSS, Images, HTML) im Bypass-Fenster.
  if (Date.now() < bypassCacheUntil) {
    return fetch(new Request(request, { cache: 'no-cache' })).catch(async () => {
      const cached = await caches.match(request)
        || await caches.match('/my-hub/index.html')
        || await caches.match('/my-hub/offline.html');
      return cached || new Response('Offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    });
  }

  // Bypass abgelaufen: Cache API Flag aufräumen (lazy, beim ersten Request danach)
  if (bypassCacheUntil !== 0) {
    bypassCacheUntil = 0;
    caches.open(BYPASS_CACHE).then(c => c.delete('/my-hub/active')).catch(() => {});
  }

  if (request.mode === 'navigate') {
    return networkFirst(request, SHELL_CACHE);
  }

  if (url.pathname.includes('/my-hub/locales/')) {
    return networkFirst(request, LOCALES_CACHE);
  }

  // Lazy geladene Seiten-Module liegen in PAGES_CACHE. Neben /pages/ gehören dazu
  // die Settings-Leaves unter /settings/, die Kategorie-Manager-Komponente sowie
  // der lazy nachgeladene Sortable-Wrapper und sein Vendor-Bundle — ohne diesen
  // Zweig würden sie via SHELL_CACHE bedient und offline (vor dem ersten Online-
  // Besuch) als index.html statt als JS-Modul ausgeliefert.
  if (
    url.pathname.includes('/my-hub/pages/') ||
    url.pathname.includes('/my-hub/settings/pages/') ||
    url.pathname.endsWith('/my-hub/components/category-manager.js') ||
    url.pathname.endsWith('/my-hub/components/profile-switcher.js') ||
    url.pathname.endsWith('/my-hub/settings/currency.js') ||
    url.pathname.endsWith('/my-hub/utils/horizontal-swipe.js') ||
    url.pathname.endsWith('/my-hub/utils/sortable.js') ||
    url.pathname.endsWith('/my-hub/vendor/sortablejs/sortable.esm.min.js') ||
    url.pathname.includes('/my-hub/vendor/libphonenumber/')
  ) {
    return networkFirst(request, PAGES_CACHE);
  }

  if (url.origin === self.location.origin && isMutableAppResource(url.pathname)) {
    return networkFirst(request, SHELL_CACHE);
  }

  if (isAsset(url.pathname) && url.origin === self.location.origin) {
    return cacheFirst(request, ASSETS_CACHE);
  }

  return cacheFirst(request, SHELL_CACHE);
}

// --------------------------------------------------------
// Strategie: Network-First (für Navigation Requests)
// --------------------------------------------------------
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const path = new URL(request.url).pathname;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Never serve SPA HTML as a JS/CSS module — that surfaces as
    // "Failed to fetch dynamically imported module" in the console.
    if (/\.(js|mjs|css)$/i.test(path)) {
      return new Response('Offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const shell = await cache.match('/my-hub/index.html');
    if (shell) return shell;

    const offline = await caches.match('/my-hub/offline.html');
    if (offline) return offline;

    return new Response('Keine Verbindung', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// --------------------------------------------------------
// Strategie: Network-First für GET-API (Read-only-Offline)
// Erfolg → Antwort klonen, x-cached-at-Header ergänzen, in API_CACHE legen.
// Netzfehler → Cache-Fallback, sonst 503-JSON {error:'offline'}.
// --------------------------------------------------------
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    // Nur erfolgreiche, gleichoriginäre (basic) Antworten cachen.
    if (response.ok && response.type === 'basic') {
      const cache   = await caches.open(API_CACHE);
      const cloned  = response.clone();
      const headers = new Headers(cloned.headers);
      headers.set('x-cached-at', String(Date.now()));
      const body = await cloned.blob();
      await cache.put(request, new Response(body, {
        status: cloned.status,
        statusText: cloned.statusText,
        headers,
      }));
    }
    return response;
  } catch {
    const cache  = await caches.open(API_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

// --------------------------------------------------------
// Strategie: Cache-First (für Shell, Pages, Assets)
// --------------------------------------------------------
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// --------------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------------
function isAsset(pathname) {
  return /\.(png|jpg|jpeg|ico|svg|webp|woff2?|gif)$/i.test(pathname);
}

function isMutableAppResource(pathname) {
  return pathname === '/my-hub/'
    || pathname === '/my-hub/index.html'
    || pathname === '/my-hub/manifest.json'
    || /\.(css|js|json|html)$/i.test(pathname);
}

// Prüft, ob ein API-Pfad (inkl. /api/v1-Prefix) zur Read-only-Offline-Whitelist
// gehört. Query-Strings sind nicht Teil von pathname → reiner Pfad-Prefix-Match.
function isCacheableApiGet(pathname) {
  if (!pathname.startsWith('/my-hub/api/v1')) return false;
  const rest = pathname.slice('/my-hub/api/v1'.length);
  return API_CACHE_WHITELIST.some((p) => rest === p || rest.startsWith(`${p}/`));
}

// --------------------------------------------------------
// Nachrichten vom Client: API-Cache leeren (Logout/Session-Ende)
// --------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

// --------------------------------------------------------
// Web Push
// --------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'My Hub', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'My Hub';
  const options = {
    body: payload.body || '',
    icon: '/my-hub/icons/icon-192.png',
    badge: '/my-hub/icons/icon-192.png',
    tag: payload.tag || 'my-hub-push',
    data: { url: payload.url || '/my-hub/reminders' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/my-hub/reminders';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        client.focus();
        if ('navigate' in client) {
          try { await client.navigate(targetUrl); } catch { /* cross-origin/navigation guard */ }
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(targetUrl);
  })());
});
