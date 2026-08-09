/**
 * GitHub Pages base-path bootstrap and local-mode flag.
 * Inline copy lives in index.html; this file is kept for local root hosting.
 */
// GitHub Pages build injects window.__MY_HUB_CANONICAL_BASE__ (e.g. /my-hub).
(function () {
  const canonical = window.__MY_HUB_CANONICAL_BASE__;
  const m = location.pathname.match(/^\/([^/]+)(?:\/|$)/);
  const seg = m && m[1];
  const segPath = seg ? `/${seg}` : '';

  if (canonical && seg && seg.toLowerCase() === canonical.slice(1).toLowerCase()) {
    window.__MY_HUB_BASE__ = canonical;
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
    window.__MY_HUB_BASE__ = (seg && !seg.includes('.')) ? segPath : '';
  }
  window.__MY_HUB_LOCAL_MODE__ = true;
})();
