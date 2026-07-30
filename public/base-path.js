/**
 * GitHub Pages base-path bootstrap and local-mode flag.
 * Inline copy lives in index.html; this file is kept for local root hosting.
 */
// GitHub Pages build injects window.__YUVOMI_CANONICAL_BASE__ (e.g. /genospace).
(function () {
  const canonical = window.__YUVOMI_CANONICAL_BASE__;
  const m = location.pathname.match(/^\/([^/]+)(?:\/|$)/);
  const seg = m && m[1];
  const segPath = seg ? `/${seg}` : '';

  if (canonical && seg && seg.toLowerCase() === canonical.slice(1).toLowerCase()) {
    window.__YUVOMI_BASE__ = canonical;
    if (segPath !== canonical) {
      location.replace(
        canonical
          + location.pathname.slice(segPath.length)
          + location.search
          + location.hash,
      );
      return;
    }
  } else {
    window.__YUVOMI_BASE__ = (seg && !seg.includes('.')) ? segPath : '';
  }
  window.__YUVOMI_LOCAL_MODE__ = true;
})();
