/**
 * Download CSV/binary exports via fetch (works with GitHub Pages base path + local mode).
 */

import { apiUrl } from '/app-path.js';

/**
 * @param {string} pathWithQuery - e.g. `/api/v1/budget/export?month=2026-01`
 * @param {string} [fallbackFilename]
 */
export async function downloadApiFile(pathWithQuery, fallbackFilename = 'export.csv') {
  const path = pathWithQuery.startsWith('/api/v1')
    ? pathWithQuery
    : `/api/v1${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`;
  const url = apiUrl(path);

  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const blob = await res.blob();
  let filename = fallbackFilename;
  const disposition = res.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="([^"]+)"/);
  if (match?.[1]) filename = match[1];

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
