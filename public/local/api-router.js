/**
 * Local API fetch implementation for GitHub Pages (no backend).
 */

import { initLocalStore, handleLocalApi } from './handlers.js';
import { installLocalFetchInterceptor } from './local-fetch.js';

let _ready = false;

async function ensureReady() {
  if (!_ready) {
    installLocalFetchInterceptor();
    await initLocalStore();
    _ready = true;
  }
}

function parseQuery(search) {
  const q = {};
  if (!search) return q;
  for (const part of search.replace(/^\?/, '').split('&')) {
    const [k, v] = part.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return q;
}

/**
 * @param {string} path - API path without /api/v1 prefix
 * @param {RequestInit} options
 */
export async function localApiFetch(path, options = {}) {
  await ensureReady();
  const method = (options.method || 'GET').toUpperCase();
  let body = null;
  if (options.body) {
    try {
      body = JSON.parse(options.body);
    } catch {
      body = options.body;
    }
  }

  const qIdx = path.indexOf('?');
  const cleanPath = qIdx >= 0 ? path.slice(0, qIdx) : path;
  const query = qIdx >= 0 ? parseQuery(path.slice(qIdx)) : {};

  try {
    const data = await handleLocalApi(method, cleanPath.replace(/^\//, ''), body, query);
    return data;
  } catch (err) {
    const status = err.status || 500;
    const payload = { error: err.message || 'Error', code: status };
    const apiErr = new Error(payload.error);
    apiErr.name = 'ApiError';
    apiErr.status = status;
    apiErr.data = payload;
    throw apiErr;
  }
}
