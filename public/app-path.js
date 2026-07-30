/**
 * App path helpers for GitHub Pages subpath hosting.
 */

export function getBasePath() {
  if (typeof window === 'undefined') return '';
  const canonical =
    typeof window.__YUVOMI_CANONICAL_BASE__ === 'string'
      ? window.__YUVOMI_CANONICAL_BASE__
      : '';
  if (
    canonical
    && location.pathname.toLowerCase().startsWith(canonical.toLowerCase())
  ) {
    return canonical;
  }
  return window.__YUVOMI_BASE__ || '';
}

/** Browser URL for an in-app route (e.g. /tasks → /genospace/tasks). */
export function toAppUrl(path) {
  const base = getBasePath();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** toAppUrl with optional ?query (settings OAuth redirects). */
export function toAppUrlWithQuery(pathWithQuery) {
  const qIndex = pathWithQuery.indexOf('?');
  if (qIndex === -1) return toAppUrl(pathWithQuery);
  return `${toAppUrl(pathWithQuery.slice(0, qIndex))}${pathWithQuery.slice(qIndex)}`;
}

/** Prefix root-absolute asset URLs (modules, locales, styles) for GitHub Pages. */
export function assetUrl(path) {
  const base = getBasePath();
  if (!base || !path.startsWith('/')) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

/** Dynamic import() with GitHub Pages base path applied. */
export function importModule(path) {
  return import(assetUrl(path));
}

/** Strip GitHub Pages repo prefix from location.pathname (case-insensitive). */
export function fromAppUrl(pathname) {
  const base = getBasePath();
  const path = pathname || '/';
  if (!base) return path;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = path.match(new RegExp(`^${escaped}`, 'i'));
  if (match) {
    const rest = path.slice(match[0].length) || '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return path;
}
