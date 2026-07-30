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

/** Strip GitHub Pages repo prefix from location.pathname. */
export function fromAppUrl(pathname) {
  const base = getBasePath();
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length) || '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return pathname || '/';
}
