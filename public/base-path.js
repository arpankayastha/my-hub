/**
 * GitHub Pages base-path bootstrap and local-mode flag.
 * Inline copy lives in index.html; this file is kept for local root hosting.
 */
// GitHub Pages build injects window.__YUVOMI_CANONICAL_BASE__ (e.g. /Genospace).
(function () {
  const m = location.pathname.match(/^\/([^/]+)(?:\/|$)/);
  const seg = m && m[1];
  window.__YUVOMI_BASE__ = (seg && !seg.includes('.')) ? '/' + seg : '';
  const canonical = window.__YUVOMI_CANONICAL_BASE__;
  if (
    canonical
    && location.pathname.toLowerCase().startsWith(canonical.toLowerCase())
  ) {
    window.__YUVOMI_BASE__ = canonical;
  }
  if (
    canonical
    && window.__YUVOMI_BASE__
    && window.__YUVOMI_BASE__.toLowerCase() === canonical.toLowerCase()
    && window.__YUVOMI_BASE__ !== canonical
  ) {
    location.replace(
      canonical
        + location.pathname.slice(window.__YUVOMI_BASE__.length)
        + location.search
        + location.hash,
    );
    return;
  }
  window.__YUVOMI_LOCAL_MODE__ = true;
})();
