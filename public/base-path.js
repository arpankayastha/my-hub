/**
 * GitHub Pages base-path bootstrap and local-mode flag.
 * Inline copy lives in index.html; this file is kept for local root hosting.
 */
(function () {
  const m = location.pathname.match(/^\/([^/]+)(?:\/|$)/);
  const seg = m && m[1];
  window.__YUVOMI_BASE__ = (seg && !seg.includes('.')) ? '/' + seg : '';
  window.__YUVOMI_LOCAL_MODE__ = true;
})();
