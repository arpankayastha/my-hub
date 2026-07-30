/**
 * GitHub Pages base-path bootstrap and local-mode flag.
 * Loaded synchronously before other scripts.
 */
(function () {
  const host = location.hostname;
  const parts = location.pathname.split('/').filter(Boolean);
  if (host.endsWith('github.io') && parts.length > 0) {
    window.__YUVOMI_BASE__ = '/' + parts[0];
  } else {
    window.__YUVOMI_BASE__ = '';
  }
  window.__YUVOMI_LOCAL_MODE__ = true;
})();
