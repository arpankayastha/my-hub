/**
 * App path helpers for GitHub Pages subpath hosting.
 */

export function getBasePath() {
  return typeof window !== 'undefined' && window.__YUVOMI_BASE__ ? window.__YUVOMI_BASE__ : '';
}

/** Browser URL for an in-app route (e.g. /tasks → /Genospace/tasks). */
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

/** Strip GitHub Pages repo prefix from location.pathname. */
export function fromAppUrl(pathname) {
  const base = getBasePath();
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length) || '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return pathname || '/';
}
